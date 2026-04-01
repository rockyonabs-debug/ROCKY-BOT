import fetch from "node-fetch";

const GIGA_BASE = "https://gigaverse.io";
const BASE_DATA = { consumables: [], itemId: 0, expectedAmount: 0, index: 0, isJuiced: false, gearInstanceIds: [] };

async function gigaFetch(path, body, method = "POST") {
  const jwt = process.env.GIGAVERSE_JWT;
  const res = await fetch(`${GIGA_BASE}${path}`, {
    method,
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${jwt}`,
      "origin":        "https://gigaverse.io",
      "referer":       "https://gigaverse.io/",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch(e) {
    throw new Error(`Not JSON: ${text.substring(0, 300)}`);
  }
}

async function getDungeonState() {
  return await gigaFetch("/api/game/dungeon/state", null, "GET");
}

async function startRun() {
  return await gigaFetch("/api/game/dungeon/action", {
    action: "start_run", actionToken: "", dungeonId: 1, data: BASE_DATA,
  });
}

async function pickLoot(actionToken) {
  return await gigaFetch("/api/game/dungeon/action", {
    action: "loot_one", actionToken, dungeonId: 0, data: BASE_DATA,
  });
}

async function playMove(actionToken, action) {
  const res = await gigaFetch("/api/game/dungeon/action", {
    action, actionToken, dungeonId: 0, data: BASE_DATA,
  });
  return res;
}

export async function runGigaverseDungeon() {
  console.log("[Gigaverse] 🏰 Rocky entering the dungeon...");

  if (!process.env.GIGAVERSE_JWT) {
    console.error("[Gigaverse] ❌ GIGAVERSE_JWT not set!");
    return null;
  }

  try {
    // 1. Estado actual
    const state     = await getDungeonState();
    const activeRun = state?.data?.run;
    let actionToken = state?.data?.actionToken;
    let currentMe   = activeRun?.players?.[0] ?? {};

    console.log("[Gigaverse] 📋 token:", actionToken, "| run:", !!activeRun, "| loot:", activeRun?.lootPhase);

    // 2. Si hay loot pendiente, elegirlo
    if (activeRun && activeRun.lootPhase) {
      console.log("[Gigaverse] 🎁 Loot phase...");
      const lr = await pickLoot(actionToken);
      actionToken = lr?.data?.actionToken ?? lr?.actionToken ?? actionToken;
      currentMe   = lr?.data?.run?.players?.[0] ?? currentMe;
    }
    // 3. Si no hay run activa, iniciar una
    else if (!activeRun || !actionToken) {
      console.log("[Gigaverse] ▶️ Iniciando run...");
      const sd = await startRun();
      console.log("[Gigaverse] START RAW:", JSON.stringify(sd).substring(0, 500));
      actionToken = sd?.data?.actionToken ?? sd?.actionToken ?? "";
      currentMe   = sd?.data?.run?.players?.[0] ?? {};
    }

    let moveIndex = 0;
    let totalWins = 0;
    let totalLoss = 0;
    let failCount = 0;
    const MOVES = ["rock", "scissors", "paper"];

    while (moveIndex < 50) {
      await sleep(1500);

      // Elegir movimiento según cargas disponibles
      const charges = [
        { name: "rock",     c: currentMe?.rock?.currentCharges    ?? 1 },
        { name: "scissors", c: currentMe?.scissor?.currentCharges ?? 1 },
        { name: "paper",    c: currentMe?.paper?.currentCharges   ?? 1 },
      ];
      const available = charges.filter(m => m.c > 0);
      const move = available.length > 0
        ? available.sort((a,b) => b.c - a.c)[0].name
        : MOVES[moveIndex % 3];

      const res = await playMove(actionToken, move);

      // Log RAW siempre para debug
      console.log(`[Gigaverse] RAW move ${moveIndex+1}:`, JSON.stringify(res).substring(0, 500));

      const success   = res?.success !== false;
      const nextToken = res?.data?.actionToken ?? res?.actionToken ?? null;

      if (nextToken) actionToken = nextToken;

      if (!success) {
        failCount++;
        console.log(`[Gigaverse] ⚠️ Falló ${failCount}/3`);
        if (failCount >= 3) break;
        await sleep(2000);
        continue;
      }

      failCount = 0;

      // Extraer datos del run — probamos múltiples rutas
      const run     = res?.data?.run ?? res?.run ?? {};
      const players = run?.players ?? [];
      const me      = players[0] ?? {};
      const enemy   = players[1] ?? {};
      const hp      = me?.health?.current ?? "?";
      const loot    = run?.lootPhase === true;
      const dead    = me?.health?.current === 0;
      const result  = loot ? "win" : dead ? "lose" : "fighting";

      if (me?.rock) currentMe = me;

      console.log(`[Gigaverse] Move ${moveIndex+1}: ${move.toUpperCase()} → ${result} | HP: ${hp} | R:${me?.rock?.currentCharges} S:${me?.scissor?.currentCharges} P:${me?.paper?.currentCharges}`);

      if (result === "win")  { totalWins++; }
      if (result === "lose") { totalLoss++; }

      if (loot) {
        console.log("[Gigaverse] 🎁 Loot...");
        await sleep(1000);
        const lr = await pickLoot(actionToken);
        console.log("[Gigaverse] LOOT RAW:", JSON.stringify(lr).substring(0, 300));
        const nt = lr?.data?.actionToken ?? lr?.actionToken ?? null;
        if (nt) actionToken = nt;
        const nm = lr?.data?.run?.players?.[0];
        if (nm) currentMe = nm;
      }

      if (dead) { console.log("[Gigaverse] 💀 Muerto"); break; }

      moveIndex++;
    }

    const summary = { wins: totalWins, losses: totalLoss, moves: moveIndex };
    console.log("[Gigaverse] 📊 Summary:", summary);
    return summary;

  } catch (err) {
    console.error("[Gigaverse] ❌ Error:", err.message);
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
