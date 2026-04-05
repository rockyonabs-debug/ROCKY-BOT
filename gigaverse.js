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
  if (text.includes("<!DOCTYPE")) throw new Error("JWT expirado — respuesta HTML");
  try {
    return JSON.parse(text);
  } catch(e) {
    throw new Error(`Not JSON: ${text.substring(0, 200)}`);
  }
}

async function getDungeonState() {
  return await gigaFetch("/api/game/dungeon/state", null, "GET");
}

async function startRun() {
  return await gigaFetch("/api/game/dungeon/action", {
    action: "start_run", actionToken: 0, dungeonId: 1, data: BASE_DATA,
  });
}

async function pickLoot(actionToken) {
  return await gigaFetch("/api/game/dungeon/action", {
    action: "loot_one", actionToken, dungeonId: 0, data: BASE_DATA,
  });
}

async function playMove(actionToken, action) {
  return await gigaFetch("/api/game/dungeon/action", {
    action, actionToken, dungeonId: 0, data: BASE_DATA,
  });
}

function chooseBestMove(me) {
  const moves = [
    { name: "rock",     c: me?.rock?.currentCharges    ?? 1 },
    { name: "scissors", c: me?.scissor?.currentCharges ?? 1 },
    { name: "paper",    c: me?.paper?.currentCharges   ?? 1 },
  ];
  const available = moves.filter(m => m.c > 0);
  if (available.length === 0) return "rock";
  return available.sort((a,b) => b.c - a.c)[0].name;
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
    let actionToken = state?.data?.actionToken ?? 0;
    let currentMe   = activeRun?.players?.[0] ?? {};

    console.log("[Gigaverse] 📋 token:", actionToken, "| run:", !!activeRun, "| loot:", activeRun?.lootPhase);

    // 2. Loot pendiente
    if (activeRun && activeRun.lootPhase) {
      console.log("[Gigaverse] 🎁 Loot pendiente...");
      const lr    = await pickLoot(actionToken);
      actionToken = lr?.data?.actionToken ?? lr?.actionToken ?? actionToken;
      if (lr?.data?.run?.players?.[0]) currentMe = lr.data.run.players[0];
      console.log("[Gigaverse] ✅ Loot elegido, token:", actionToken);
    }
    // 3. Sin run activa — iniciar nueva
    else if (!activeRun || !actionToken) {
      console.log("[Gigaverse] ▶️ Iniciando nueva run...");
      const sd    = await startRun();
      console.log("[Gigaverse] START:", JSON.stringify(sd).substring(0, 300));
      actionToken = sd?.data?.actionToken ?? sd?.actionToken ?? 0;
      if (sd?.data?.run?.players?.[0]) currentMe = sd.data.run.players[0];
      console.log("[Gigaverse] ⚔️ Run iniciada, token:", actionToken);
    } else {
      console.log("[Gigaverse] 🔄 Run activa, token:", actionToken);
    }

    let moveIndex = 0;
    let totalWins = 0;
    let totalLoss = 0;
    let failCount = 0;

    while (moveIndex < 50) {
      await sleep(1500);

      const move = chooseBestMove(currentMe);
      const res  = await playMove(actionToken, move);

      const success   = res?.success !== false;
      const nextToken = res?.data?.actionToken ?? res?.actionToken ?? null;
      const run       = res?.data?.run ?? {};
      const players   = run?.players ?? [];
      const me        = players[0] ?? {};
      const hp        = me?.health?.current ?? "?";
      const loot      = run?.lootPhase === true;
      const dead      = typeof me?.health?.current === "number" && me.health.current === 0;
      const result    = loot ? "win" : dead ? "lose" : "fighting";

      if (nextToken) actionToken = nextToken;
      if (me?.rock)  currentMe  = me;

      if (!success) {
        failCount++;
        console.log(`[Gigaverse] ⚠️ Falló ${failCount}/3, token: ${actionToken}`);
        if (failCount >= 3) { console.log("[Gigaverse] ❌ Abortando"); break; }
        await sleep(2000);
        continue;
      }

      failCount = 0;
      console.log(`[Gigaverse] Move ${moveIndex+1}: ${move.toUpperCase()} → ${result} | HP: ${hp} | R:${me?.rock?.currentCharges} S:${me?.scissor?.currentCharges} P:${me?.paper?.currentCharges}`);

      if (result === "win")  totalWins++;
      if (result === "lose") totalLoss++;

      if (loot) {
        console.log("[Gigaverse] 🎁 Eligiendo loot...");
        await sleep(1000);
        const lr       = await pickLoot(actionToken);
        const newToken = lr?.data?.actionToken ?? lr?.actionToken ?? null;
        if (newToken) actionToken = newToken;
        if (lr?.data?.run?.players?.[0]) currentMe = lr.data.run.players[0];
        console.log("[Gigaverse] ✅ Loot elegido, token:", actionToken);
      }

      if (dead) { console.log("[Gigaverse] 💀 Rocky murió"); break; }

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
