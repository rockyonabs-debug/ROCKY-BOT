import fetch from "node-fetch";
import { privateKeyToAccount } from "viem/accounts";

const GIGA_BASE = "https://gigaverse.io/api";
const account = privateKeyToAccount(process.env.PRIVATE_KEY);

let cachedJWT = process.env.GIGAVERSE_JWT || "";

async function refreshJWT() {
  console.log("[Gigaverse] 🔑 Renovando JWT...");
  const timestamp = Date.now();
  const message = `Login to Gigaverse at ${timestamp}`;
  const signature = await account.signMessage({ message });
  
  const res = await fetch(`${GIGA_BASE}/user/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signature,
      address: account.address,
      message,
      timestamp,
      agent_metadata: { type: "gigaverse-play-skill", model: "rocky-agent" }
    })
  });
  
  const data = await res.json();
  if (data.token) {
    cachedJWT = data.token;
    console.log("[Gigaverse] ✅ JWT renovado!");
    return true;
  }
  console.log("[Gigaverse] ❌ Auth failed:", JSON.stringify(data));
  return false;
}

async function gigaFetch(path, body, method = "POST") {
  const res = await fetch(`${GIGA_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cachedJWT}`,
      "origin": "https://gigaverse.io",
      "referer": "https://gigaverse.io/",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (text.includes("<!DOCTYPE")) throw new Error("Respuesta HTML inesperada");
  let json;
  try { json = JSON.parse(text); } catch(e) { throw new Error(`Not JSON: ${text.substring(0, 200)}`); }
  json._status = res.status;
  return json;
}

async function getState() {
  return await gigaFetch("/game/dungeon/state", null, "GET");
}

async function startRun() {
  return await gigaFetch("/game/dungeon/action", {
    action: "start_run", dungeonId: 1, actionToken: "",
    data: { consumables: [], itemId: 0, expectedAmount: 0, index: 0, isJuiced: false, gearInstanceIds: [] }
  });
}

async function doMove(action, actionToken, dungeonId) {
  return await gigaFetch("/game/dungeon/action", {
    action, dungeonId, actionToken,
    data: { consumables: [], itemId: 0, expectedAmount: 0, index: 0, isJuiced: false, gearInstanceIds: [] }
  });
}

async function doLoot(actionToken, dungeonId) {
  return await gigaFetch("/game/dungeon/action", {
    action: "loot_one", dungeonId, actionToken,
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
    // 1. Verificar/renovar JWT
    const stateCheck = await getState();
    if (stateCheck._status === 401 || stateCheck.error === "Invalid token") {
      const ok = await refreshJWT();
      if (!ok) { console.error("[Gigaverse] ❌ No se pudo renovar JWT"); return null; }
    }

    // 2. Estado actual
    const state = await getState();
    console.log("[Gigaverse] STATE:", JSON.stringify(state).substring(0, 300));

    let run       = state?.data?.run;
    let token     = state?.data?.actionToken ?? "";
    let dungeonId = run?.dungeonId ?? run?.DUNGEON_ID_CID ?? 1;
    let me        = run?.players?.[0] ?? {};

    // 3. Loot pendiente
    if (run && run.lootPhase === true) {
      console.log("[Gigaverse] 🎁 Loot pendiente...");
      const lr = await doLoot(token, dungeonId);
      token     = lr?.data?.actionToken ?? lr?.actionToken ?? token;
      run       = lr?.data?.run ?? run;
      me        = run?.players?.[0] ?? me;
    }

    // 4. Sin run activa — iniciar nueva
    if (!run) {
      console.log("[Gigaverse] ▶️ Iniciando nueva run...");
      const sr  = await startRun();
      console.log("[Gigaverse] START:", JSON.stringify(sr).substring(0, 300));
      token     = sr?.data?.actionToken ?? sr?.actionToken ?? "";
      run       = sr?.data?.run ?? {};
      dungeonId = run?.dungeonId ?? run?.DUNGEON_ID_CID ?? 1;
      me        = run?.players?.[0] ?? {};
    } else {
      console.log("[Gigaverse] 🔄 Run activa | token:", token);
    }

    let wins = 0, losses = 0, moveIndex = 0, failCount = 0;

    while (moveIndex < 50) {
      await sleep(1200);

      const move = chooseMoveByCharges(me);
      const res  = await doMove(move, token, dungeonId);

      // 401 — renovar JWT y reintentar
      if (res._status === 401) {
        console.log("[Gigaverse] 🔑 JWT expirado mid-run, renovando...");
        await refreshJWT();
        continue;
      }

      // 400 — resync
      if (res._status === 400) {
        failCount++;
        console.log(`[Gigaverse] ⚠️ 400 error (${failCount}/3)`);
        if (failCount >= 3) { console.log("[Gigaverse] ❌ Abortando"); break; }
        await sleep(2000);
        continue;
      }

      failCount = 0;

      const newToken  = res?.data?.actionToken ?? res?.actionToken ?? null;
      const newRun    = res?.data?.run ?? res?.run ?? {};
      const players   = newRun?.players ?? [];
      const newMe     = players[0] ?? {};
      const hp        = newMe?.health?.current ?? "?";
      const lootPhase = newRun?.lootPhase === true;
      const dead      = typeof newMe?.health?.current === "number" && newMe.health.current === 0;
      const result    = lootPhase ? "WIN" : dead ? "DEAD" : "fighting";

      if (newToken) token = newToken;
      if (newMe?.rock) { me = newMe; dungeonId = newRun?.dungeonId ?? dungeonId; }

      console.log(`[Gigaverse] Move ${moveIndex+1}: ${move.toUpperCase()} → ${result} | HP: ${hp} | R:${newMe?.rock?.currentCharges} S:${newMe?.scissor?.currentCharges} P:${newMe?.paper?.currentCharges}`);

      if (lootPhase) {
        wins++;
        console.log("[Gigaverse] 🎁 Eligiendo loot...");
        await sleep(1000);
        const lr = await doLoot(token, dungeonId);
        const nt = lr?.data?.actionToken ?? lr?.actionToken ?? null;
        if (nt) token = nt;
        const nm = lr?.data?.run?.players?.[0];
        if (nm) me = nm;
        dungeonId = lr?.data?.run?.dungeonId ?? dungeonId;
      }

      if (dead) { losses++; console.log("[Gigaverse] 💀 Rocky murió"); break; }

      moveIndex++;
    }

    const summary = { wins, losses, moves: moveIndex };
    console.log("[Gigaverse] 📊 Summary:", summary);
    return summary;

  } catch(err) {
    console.error("[Gigaverse] ❌ Error:", err.message);
    return null;
  }
}
