import fetch from "node-fetch";

const GIGA_BASE = "https://gigaverse.io";
const MOVES     = ["rock", "scissors", "paper"];
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
    action:      "start_run",
    actionToken: "",
    dungeonId:   1,
    data:        BASE_DATA,
  });
}

async function playMove(actionToken, moveIndex) {
  const action = MOVES[moveIndex % MOVES.length];
  const res = await gigaFetch("/api/game/dungeon/action", {
    action,
    actionToken,
    dungeonId: 0,
    data:      BASE_DATA,
  });
  return { res, action };
}

async function pickLoot(actionToken) {
  return await gigaFetch("/api/game/dungeon/action", {
    action:      "loot_one",
    actionToken,
    dungeonId:   0,
    data:        BASE_DATA,
  });
}

export async function runGigaverseDungeon() {
  console.log("[Gigaverse] 🏰 Rocky entering the dungeon...");

  if (!process.env.GIGAVERSE_JWT) {
    console.error("[Gigaverse] ❌ GIGAVERSE_JWT not set!");
    return null;
  }

  try {
    const state     = await getDungeonState();
    const activeRun = state?.data?.run;
    let actionToken = state?.data?.actionToken;

    console.log("[Gigaverse] 📋 State | actionToken:", actionToken, "| lootPhase:", activeRun?.lootPhase, "| run:", !!activeRun);

    // Si hay loot phase activa, elegimos loot primero
    if (activeRun && activeRun.lootPhase) {
      console.log("[Gigaverse] 🎁 Loot phase activa, eligiendo loot...");
      const lootRes  = await pickLoot(actionToken);
      console.log("[Gigaverse] LOOT RAW:", JSON.stringify(lootRes).substring(0, 400));
      actionToken    = lootRes?.data?.actionToken ?? lootRes?.actionToken ?? actionToken;
      console.log("[Gigaverse] ✅ Loot elegido, token:", actionToken);
    }
    // Si no hay token válido o no hay run, iniciamos nueva
    else if (!activeRun || !actionToken) {
      console.log("[Gigaverse] ▶️ Iniciando nueva run...");
      const startData = await startRun();
      console.log("[Gigaverse] startRun RAW:", JSON.stringify(startData).substring(0, 300));
      actionToken     = startData?.data?.actionToken ?? startData?.actionToken ?? "";
      console.log("[Gigaverse] ⚔️ Run iniciada, token:", actionToken);
    } else {
      console.log("[Gigaverse] 🔄 Run activa, token:", actionToken);
    }

    let moveIndex = 0;
    let totalWins = 0;
    let totalLoss = 0;
    let failCount = 0;

    while (moveIndex < 30) {
      await sleep(1500);
      const { res, action } = await playMove(actionToken, moveIndex);

      const run       = res?.data?.run ?? res?.run ?? {};
      const players   = run?.players ?? [];
      const me        = players[0] ?? {};
      const hp        = me?.health?.current ?? "?";
      const iWon      = me?.thisPlayerWin ?? false;
      const iLost     = players[1]?.thisPlayerWin ?? false;
      const result    = iWon ? "win" : iLost ? "lose" : "?";
      const nextToken = res?.data?.actionToken ?? res?.actionToken ?? null;
      const success   = res?.success !== false;
      const lootPhase = run?.lootPhase === true;
      const isDead    = me?.health?.current === 0;

      if (nextToken) actionToken = nextToken;

      if (!success) {
        failCount++;
        console.log(`[Gigaverse] ⚠️ Falló intento ${failCount}, token: ${actionToken}`);
        if (failCount >= 5) { console.log("[Gigaverse] ❌ Abortando"); break; }
        await sleep(2000);
        continue;
      }

      failCount = 0;
      console.log(`[Gigaverse] Move ${moveIndex + 1}: ${action.toUpperCase()} → ${result} | HP: ${hp}`);

      if (result === "win")  totalWins++;
      if (result === "lose") totalLoss++;

      if (lootPhase) {
        console.log("[Gigaverse] 🎁 Eligiendo loot...");
        await sleep(1000);
        const lootRes  = await pickLoot(actionToken);
        console.log("[Gigaverse] LOOT RAW:", JSON.stringify(lootRes).substring(0, 400));
        const newToken = lootRes?.data?.actionToken ?? lootRes?.actionToken ?? null;
        if (newToken) actionToken = newToken;
        console.log("[Gigaverse] ✅ Loot elegido, token:", actionToken);
      }

      if (isDead) {
        console.log("[Gigaverse] 💀 Rocky murió");
        break;
      }

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
