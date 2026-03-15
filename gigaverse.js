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

function chooseBestMove(me) {
  const moves = [
    { name: "rock",     charges: me?.rock?.currentCharges    ?? 0 },
    { name: "scissors", charges: me?.scissor?.currentCharges ?? 0 },
    { name: "paper",    charges: me?.paper?.currentCharges   ?? 0 },
  ];
  const available = moves.filter(m => m.charges > 0);
  if (available.length === 0) return "rock";
  available.sort((a, b) => b.charges - a.charges);
  return available[0].name;
}

async function playMove(actionToken, me) {
  const action = chooseBestMove(me);
  const res = await gigaFetch("/api/game/dungeon/action", {
    action, actionToken, dungeonId: 0, data: BASE_DATA,
  });
  return { res, action };
}

export async function runGigaverseDungeon() {
  console.log("[Gigaverse] 🏰 Rocky entering the dungeon...");

  if (!process.env.GIGAVERSE_JWT) {
    console.error("[Gigaverse] ❌ GIGAVERSE_JWT not set!");
    return null;
  }

  try {
    let state       = await getDungeonState();
    let activeRun   = state?.data?.run;
    let actionToken = state?.data?.actionToken;

    console.log("[Gigaverse] 📋 actionToken:", actionToken, "| run:", !!activeRun, "| loot:", activeRun?.lootPhase);

    if (activeRun && !actionToken) {
      console.log("[Gigaverse] 🔄 Resyncing...");
      await sleep(3000);
      state       = await getDungeonState();
      activeRun   = state?.data?.run;
      actionToken = state?.data?.actionToken;
      console.log("[Gigaverse] 📋 Post-resync token:", actionToken);
    }

    if (activeRun && activeRun.lootPhase) {
      console.log("[Gigaverse] 🎁 Loot phase al arrancar...");
      const lootRes = await pickLoot(actionToken);
      actionToken   = lootRes?.data?.actionToken ?? lootRes?.actionToken ?? actionToken;
      await sleep(2000);
      state       = await getDungeonState();
      activeRun   = state?.data?.run;
      actionToken = state?.data?.actionToken ?? actionToken;
      console.log("[Gigaverse] ✅ Loot + resync, token:", actionToken);
    } else if (!activeRun || !actionToken) {
      console.log("[Gigaverse] ▶️ Iniciando nueva run...");
      const startData = await startRun();
      actionToken     = startData?.data?.actionToken ?? startData?.actionToken ?? "";
      activeRun       = startData?.data?.run ?? null;
      console.log("[Gigaverse] ⚔️ Run iniciada, token:", actionToken);
    } else {
      console.log("[Gigaverse] 🔄 Run activa, token:", actionToken);
    }

    let currentMe = activeRun?.players?.[0] ?? {};
    let moveIndex = 0;
    let totalWins = 0;
    let totalLoss = 0;
    let failCount = 0;

    while (moveIndex < 50) {
      await sleep(1500);

      const { res, action } = await playMove(actionToken, currentMe);

      const run       = res?.data?.run ?? res?.run ?? {};
      const players   = run?.players ?? [];
      const me        = players[0] ?? {};
      const hp        = me?.health?.current ?? "?";
      const nextToken = res?.data?.actionToken ?? res?.actionToken ?? null;
      const success   = res?.success !== false;
      const lootPhase = run?.lootPhase === true;
      const isDead    = me?.health?.current === 0;
      const result    = lootPhase ? "win" : isDead ? "lose" : "fighting";

      if (nextToken) actionToken = nextToken;
      if (me?.rock) currentMe = me;

      if (!success) {
        failCount++;
        console.log(`[Gigaverse] ⚠️ Falló ${failCount}/5, token: ${actionToken}`);
        if (failCount >= 5) { console.log("[Gigaverse] ❌ Abortando"); break; }
        await sleep(2000);
        continue;
      }

      failCount = 0;
      console.log(`[Gigaverse] Move ${moveIndex + 1}: ${action.toUpperCase()} → ${result} | HP: ${hp} | R:${me?.rock?.currentCharges} S:${me?.scissor?.currentCharges} P:${me?.paper?.currentCharges}`);

      if (result === "win")  totalWins++;
      if (result === "lose") totalLoss++;

      if (lootPhase) {
        console.log("[Gigaverse] 🎁 Eligiendo loot...");
        await sleep(1000);
        const lootRes  = await pickLoot(actionToken);
        console.log("[Gigaverse] LOOT:", JSON.stringify(lootRes).substring(0, 150));
        await sleep(2000);
        const newState = await getDungeonState();
        const newToken = newState?.data?.actionToken ?? lootRes?.data?.actionToken ?? lootRes?.actionToken ?? null;
        if (newToken) actionToken = newToken;
        const newMe = newState?.data?.run?.players?.[0];
        if (newMe) currentMe = newMe;
        console.log("[Gigaverse] ✅ Post-loot resync, token:", actionToken);
      }

      if (isDead) { console.log("[Gigaverse] 💀 Rocky murió"); break; }

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
