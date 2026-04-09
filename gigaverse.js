import fetch from "node-fetch";

const GIGA_BASE = "https://gigaverse.io/api";
const JWT = () => process.env.GIGAVERSE_JWT;

async function gigaFetch(path, body, method = "POST") {
  const res = await fetch(`${GIGA_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${JWT()}`,
      "origin": "https://gigaverse.io",
      "referer": "https://gigaverse.io/",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (text.includes("<!DOCTYPE")) throw new Error("JWT expirado — respuesta HTML");
  let json;
  try { json = JSON.parse(text); } catch(e) { throw new Error(`Not JSON: ${text.substring(0, 200)}`); }
  if (!res.ok) {
    // Intentar extraer token del error (ej: "Invalid action token X != Y")
    const match = text.match(/Invalid action token \d+ != (\d+)/);
    if (match) json._recoveryToken = match[1];
    json._status = res.status;
  }
  return json;
}

async function getState() {
  return await gigaFetch("/game/dungeon/state", null, "GET");
}

async function startRun(dungeonId = 1) {
  return await gigaFetch("/game/dungeon/action", {
    action: "start_run",
    dungeonId,
    actionToken: "",
    data: { consumables: [], itemId: 0, expectedAmount: 0, index: 0, isJuiced: false, gearInstanceIds: [] }
  });
}

async function doMove(action, actionToken, dungeonId) {
  return await gigaFetch("/game/dungeon/action", {
    action,
    dungeonId,
    actionToken,
    data: { consumables: [], itemId: 0, expectedAmount: 0, index: 0, isJuiced: false, gearInstanceIds: [] }
  });
}

async function doLoot(actionToken, dungeonId) {
  return await gigaFetch("/game/dungeon/action", {
    action: "loot_one",
    dungeonId,
    actionToken,
    data: { consumables: [], itemId: 0, expectedAmount: 0, index: 0, isJuiced: false, gearInstanceIds: [] }
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function chooseMoveByCharges(me) {
  if (!me) return "rock";
  const moves = [
    { name: "rock",    c: me?.rock?.currentCharges    ?? 1 },
    { name: "scissor", c: me?.scissor?.currentCharges ?? 1 },
    { name: "paper",   c: me?.paper?.currentCharges   ?? 1 },
  ];
  const available = moves.filter(m => m.c > 0);
  if (!available.length) return "rock";
  return available.sort((a,b) => b.c - a.c)[0].name;
}

export async function runGigaverseDungeon() {
  console.log("[Gigaverse] 🏰 Rocky entering the dungeon...");

  try {
    // 1. Verificar estado actual
    const state = await getState();
    console.log("[Gigaverse] STATE RAW:", JSON.stringify(state).substring(0, 400));

    let run       = state?.data?.run;
    let token     = state?.data?.actionToken ?? "";
    let dungeonId = run?.dungeonId ?? run?.DUNGEON_ID_CID ?? 1;
    let me        = run?.players?.[0] ?? {};

    // 2. Si hay loot pendiente, resolverlo
    if (run && run.lootPhase === true) {
      console.log("[Gigaverse] 🎁 Loot pendiente, eligiendo...");
      const lr = await doLoot(token, dungeonId);
      console.log("[Gigaverse] LOOT RAW:", JSON.stringify(lr).substring(0, 300));
      token     = lr?.data?.actionToken ?? lr?.actionToken ?? token;
      run       = lr?.data?.run ?? run;
      me        = run?.players?.[0] ?? me;
    }

    // 3. Si no hay run activa, iniciar una nueva
    if (!run) {
      console.log("[Gigaverse] ▶️ Iniciando nueva run...");
      const sr = await startRun(1);
      console.log("[Gigaverse] START RAW:", JSON.stringify(sr).substring(0, 400));
      
      if (sr._status === 400 && sr._recoveryToken) {
        console.log("[Gigaverse] 🔄 Recovery token:", sr._recoveryToken);
        const sr2 = await startRun(1);
        token     = sr2?.data?.actionToken ?? sr2?.actionToken ?? "";
        run       = sr2?.data?.run ?? {};
      } else {
        token     = sr?.data?.actionToken ?? sr?.actionToken ?? "";
        run       = sr?.data?.run ?? {};
      }
      
      dungeonId = run?.dungeonId ?? run?.DUNGEON_ID_CID ?? 1;
      me        = run?.players?.[0] ?? {};
      console.log("[Gigaverse] ⚔️ Run iniciada | dungeonId:", dungeonId, "| token:", token);
    } else {
      console.log("[Gigaverse] 🔄 Run activa | dungeonId:", dungeonId, "| token:", token);
    }

    let wins = 0, losses = 0, moveIndex = 0, failCount = 0;

    while (moveIndex < 50) {
      await sleep(1500);

      const move = chooseMoveByCharges(me);
      const res  = await doMove(move, token, dungeonId);

      // Log RAW para debug
      if (moveIndex < 3) {
        console.log(`[Gigaverse] RAW move ${moveIndex+1}:`, JSON.stringify(res).substring(0, 400));
      }

      // 400 recovery
      if (res._status === 400) {
        console.log("[Gigaverse] ⚠️ 400 — resyncing state...");
        const st = await getState();
        token     = st?.data?.actionToken ?? token;
        run       = st?.data?.run ?? run;
        me        = run?.players?.[0] ?? me;
        dungeonId = run?.dungeonId ?? dungeonId;
        failCount++;
        if (failCount >= 3) { console.log("[Gigaverse] ❌ Demasiados errores, abortando"); break; }
        continue;
      }

      failCount = 0;

      // Extraer datos
      const newToken  = res?.data?.actionToken ?? res?.actionToken ?? null;
      const newRun
