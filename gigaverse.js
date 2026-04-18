import fetch from "node-fetch";
import { privateKeyToAccount } from "viem/accounts";

const GIGA_BASE = "https://gigaverse.io/api";
const PLAYER_ADDRESS = "0xaF7B17E7bbF5A21DeB480711959da0830A93199b";
const ENERGY_PER_RUN = 40;
const MIN_ENERGY = 40;

let sessionJWT = null;

function getJWT() {
  return sessionJWT || process.env.GIGAVERSE_JWT || "";
}

async function renewJWT() {
  console.log("[Gigaverse] 🔑 Renewing JWT via SIWE...");
  const account = privateKeyToAccount(process.env.PRIVATE_KEY);
  const timestamp = Date.now();
  const message = `Login to Gigaverse at ${timestamp}`;
  const signature = await account.signMessage({ message });

  const res = await fetch(`${GIGA_BASE}/user/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "origin": "https://gigaverse.io", "referer": "https://gigaverse.io/" },
    body: JSON.stringify({
      address: PLAYER_ADDRESS,
      message,
      signature,
      agent_metadata: { type: "gigaverse-play-skill", model: "claude-sonnet-4-6" },
    }),
  });

  const data = await res.json();
  if (!data?.token) throw new Error(`JWT renewal failed: ${JSON.stringify(data)}`);
  sessionJWT = data.token;
  console.log("[Gigaverse] ✅ JWT renewed successfully");
  return sessionJWT;
}

async function gigaFetch(path, body, method = "POST", retry = true) {
  const res = await fetch(`${GIGA_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getJWT()}`,
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
  if (res.status === 401 && retry) {
    console.log("[Gigaverse] 🔄 401 — renewing JWT and retrying...");
    await renewJWT();
    return gigaFetch(path, body, method, false);
  }
  return json;
}

async function getEnergy(retry = true) {
  const res = await fetch(`${GIGA_BASE}/offchain/player/energy/${PLAYER_ADDRESS}`, {
    headers: { "Authorization": `Bearer ${getJWT()}` }
  });
  if (res.status === 401 && retry) {
    console.log("[Gigaverse] 🔄 401 on energy — renewing JWT...");
    await renewJWT();
    return getEnergy(false);
  }
  const data = await res.json();
  const energy = data?.entities?.[0]?.parsedData?.energyValue ?? 0;
  console.log(`[Gigaverse] ⚡ Energía: ${energy}`);
  return energy;
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

async function playOneRun() {
  const state = await getState();

  if (state._status === 401) {
    console.error("[Gigaverse] ❌ JWT inválido — actualizá GIGAVERSE_JWT en Render");
    return { dead: true, error: true };
  }

  let run       = state?.data?.run;
  let token     = state?.data?.actionToken ?? "";
  let dungeonId = run?.dungeonId ?? run?.DUNGEON_ID_CID ?? 1;
  let me        = run?.players?.[0] ?? {};

  if (run && run.lootPhase === true) {
    console.log("[Gigaverse] 🎁 Loot pendiente...");
    const lr = await doLoot(token, dungeonId);
    token     = lr?.data?.actionToken ?? lr?.actionToken ?? token;
    run       = lr?.data?.run ?? run;
    me        = run?.players?.[0] ?? me;
  }

  if (!run) {
    console.log("[Gigaverse] ▶️ Iniciando nueva run...");
    const sr = await startRun();
    console.log("[Gigaverse] START:", JSON.stringify(sr).substring(0, 200));

    if (sr._status === 400) {
      console.log("[Gigaverse] ❌ No se pudo iniciar run");
      return { dead: true, error: true };
    }

    token     = sr?.data?.actionToken ?? sr?.actionToken ?? "";
    run       = sr?.data?.run ?? {};
    dungeonId = run?.dungeonId ?? run?.DUNGEON_ID_CID ?? 1;
    me        = run?.players?.[0] ?? {};
  }

  let wins = 0, moveIndex = 0, failCount = 0, dead = false;

  while (moveIndex < 100) {
    await sleep(1200);

    const move = chooseMoveByCharges(me);
    const res  = await doMove(move, token, dungeonId);

    if (res._status === 401) {
      console.error("[Gigaverse] ❌ JWT expirado");
      return { dead: true, error: true };
    }

    if (res._status === 400) {
      failCount++;
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
    dead            = typeof newMe?.health?.current === "number" && newMe.health.current === 0;
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

    if (dead) {
      console.log("[Gigaverse] 💀 Rocky murió");
      break;
    }

    moveIndex++;
  }

  return { dead, wins, moves: moveIndex };
}

export async function runGigaverseDungeon() {
  console.log("[Gigaverse] 🏰 Rocky starting daily dungeon grind...");
  if (!getJWT()) await renewJWT();

  let totalWins = 0;
  let totalRuns = 0;
  let energy = await getEnergy();

  while (energy >= MIN_ENERGY) {
    console.log(`[Gigaverse] 🔄 Run ${totalRuns + 1} | Energía: ${energy}`);
    
    const result = await playOneRun();
    
    if (result.error) {
      console.log("[Gigaverse] ❌ Error crítico, deteniendo");
      break;
    }

    totalRuns++;
    totalWins += result.wins ?? 0;

    console.log(`[Gigaverse] ✅ Run ${totalRuns} terminada | Wins: ${result.wins}`);

    // Esperar 5 segundos entre runs
    await sleep(5000);

    // Verificar energía restante
    energy = await getEnergy();
    
    if (energy < MIN_ENERGY) {
      console.log(`[Gigaverse] ⚡ Sin energía suficiente (${energy}), terminando por hoy`);
      break;
    }
  }

  const summary = { totalRuns, totalWins, energiaFinal: energy };
  console.log("[Gigaverse] 📊 Daily summary:", summary);
  return summary;
}
