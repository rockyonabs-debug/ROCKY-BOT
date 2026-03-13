import fetch from "node-fetch";

const GIGA_BASE = "https://gigaverse.io";
const MOVES     = ["rock", "scissors", "paper"];

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

async function startRun(actionToken) {
  return await gigaFetch("/api/game/dungeon/action", {
    action:      "start",
    actionToken: actionToken,
    dungeonId:   1,
    data:        { consumables: [], itemId: 0, index: 0 },
  });
}

async function playMove(actionToken, moveIndex, dungeonId) {
  const action = MOVES[moveIndex % MOVES.length];
  const res = await gigaFetch("/api/game/dungeon/action", {
    action,
    actionToken,
    dungeonId,
    data: {},
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
    const state     = await getDungeonState();
    const activeRun = state?.data?.run;
    let actionToken = state?.data?.actionToken ?? 0;

    // Obtenemos el dungeonId real de la run activa o del entity
    let dungeonId = activeRun?.DUNGEON_ID_CID
                 ?? state?.data?.entity?.DUNGEON_ID_CID
                 ?? 1;

    console.log("[Gigaverse] 🗺️ dungeonId:", dungeonId, "| actionToken:", actionToken);

    if (activeRun && !activeRun.lootPhase) {
      console.log("[Gigaverse] 🔄 Run activa encontrada, continuando...");
    } else {
      console.log("[Gigaverse] ▶️ Iniciando nueva run...");
      const startData = await startRun(actionToken);
      console.log("[Gigaverse] startRun response:", JSON.stringify(startData));
      actionToken = startData?.data?.actionToken
                 ?? startData?.actionToken
                 ?? actionToken;
      dungeonId   = startData?.data?.run?.DUNGEON_ID_CID
                 ?? startData?.data?.entity?.DUNGEON_ID_CID
                 ?? dungeonId;
      console.log("[Gigaverse] ⚔️ Run iniciada | dungeonId:", dungeonId, "| actionToken:", actionToken);
    }

    let moveIndex = 0;
    let totalWins = 0;
    let totalLoss = 0;
    let failCount = 0;

    while (moveIndex < 30) {
      await sleep(1500);
      const { res, action } = await playMove(actionToken, moveIndex, dungeonId);
      console.log("[Gigaverse] RAW:", JSON.stringify(res));

      const run       = res?.data?.run ?? res?.run ?? {};
      const players   = run?.players ?? [];
      const me        = players[0] ?? {};
      const hp        = me?.health?.current ?? "?";
      const iWon      = me?.thisPlayerWin ?? false;
      const iLost     = players[1]?.thisPlayerWin ?? false;
      const result    = iWon ? "win" : iLost ? "lose" : "?";
      const nextToken = res?.data?.actionToken ?? res?.actionToken ?? null;
      const success   = res?.success !== false;
      const isOver    = run?.lootPhase === true || me?.health?.current === 0;

      if (nextToken) actionToken = nextToken;

      if (!success) {
        failCount++;
        console.log(`[Gigaverse] ⚠️ Falló intento ${failCount}, token: ${actionToken}`);
        if (failCount >= 3) {
          console.log("[Gigaverse] ❌ Abortando");
          break;
        }
        continue;
      }

      failCount = 0;
      console.log(`[Gigaverse] Move ${moveIndex + 1}: ${action.toUpperCase()} → ${result} | HP: ${hp}`);

      if (result === "win")  totalWins++;
      if (result === "lose") totalLoss++;
      if (isOver) { console.log("[Gigaverse] 🏁 Run terminada"); break; }

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
