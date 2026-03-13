import fetch from "node-fetch";

const GIGA_BASE  = "https://gigaverse.io";
const DUNGEON_ID = 1;
const MOVES      = ["rock", "scissors", "paper"];

async function gigaFetch(path, body) {
  const jwt = process.env.GIGAVERSE_JWT;
  const res = await fetch(`${GIGA_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${jwt}`,
      "origin":        "https://gigaverse.io",
      "referer":       "https://gigaverse.io/",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch(e) {
    throw new Error(`Not JSON: ${text.substring(0, 200)}`);
  }
}

async function claimEnergy() {
  try {
    const res = await gigaFetch("/api/game/item-action", {
      romId: "1465", claimId: "energy",
    });
    console.log("[Gigaverse] ⚡ Energy:", JSON.stringify(res));
  } catch (e) {
    console.log("[Gigaverse] Energy skip:", e.message);
  }
}

async function startRun() {
  const res = await gigaFetch("/api/game/dungeon-run", {
    actionToken: "initial",
    dungeonId:   DUNGEON_ID,
    data: { consumables: [], itemId: 0, index: 0 },
  });
  console.log("[Gigaverse] ⚔️ startRun response:", JSON.stringify(res));
  return res;
}

async function playMove(actionToken, moveIndex) {
  const action = MOVES[moveIndex % MOVES.length];
  const res = await gigaFetch("/api/game/dungeon-action", {
    action, actionToken, dungeonId: DUNGEON_ID, data: {},
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
    await claimEnergy();

    const runData   = await startRun();
    let actionToken = runData?.data?.run?.actionToken
                   ?? runData?.actionToken
                   ?? null;

    if (!actionToken) {
      console.error("[Gigaverse] ❌ No actionToken:", JSON.stringify(runData));
      return null;
    }

    let moveIndex = 0;
    let totalWins = 0;
    let totalLoss = 0;

    while (moveIndex < 30) {
      await sleep(1200);
      const { res, action } = await playMove(actionToken, moveIndex);
      const runState = res?.data?.run ?? res?.run ?? {};
      const result   = runState?.lastResult ?? res?.result ?? "?";
      const hp       = runState?.playerHp   ?? res?.playerHp ?? "?";

      console.log(`[Gigaverse] Move ${moveIndex + 1}: ${action.toUpperCase()} → ${result} | HP: ${hp}`);

      if (result === "win")  totalWins++;
      if (result === "lose") totalLoss++;

      const nextToken = runState?.actionToken ?? res?.actionToken ?? null;
      if (nextToken) actionToken = nextToken;

      const isOver = runState?.status === "completed"
                  || runState?.status === "dead"
                  || hp === 0
                  || res?.runOver === true;

      if (isOver) break;
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
