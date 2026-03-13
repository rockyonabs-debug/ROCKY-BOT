import { ethers } from "ethers";
import fetch from "node-fetch";

const GIGA_BASE  = "https://gigaverse.io";
const ROCKY_EOA  = "0x8a16261bE29306c8985C50c953dee51fc78C7E3C";
const PRIVATE_KEY = process.env.ROCKY_PRIVATE_KEY;
const DUNGEON_ID  = 1;
const MOVES       = ["rock", "scissors", "paper"];

async function getGigaverseJWT() {
  const wallet    = new ethers.Wallet(PRIVATE_KEY);
  const timestamp = Date.now();
  const message   = `Login to Gigaverse at ${timestamp}`;
  const signature = await wallet.signMessage(message);

  const res = await fetch(`${GIGA_BASE}/api/user/auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "origin":       "https://gigaverse.io",
      "referer":      "https://gigaverse.io/",
    },
    body: JSON.stringify({
      address:   ROCKY_EOA,
      message,
      signature,
      timestamp,
    }),
  });

  const data = await res.json();
  if (!data.jwt) throw new Error(`Auth failed: ${JSON.stringify(data)}`);
  console.log("[Gigaverse] ✅ JWT obtained");
  return data.jwt;
}

async function gigaFetch(path, jwt, body) {
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
  const json = await res.json();
  if (!res.ok) throw new Error(`Gigaverse error [${path}]: ${JSON.stringify(json)}`);
  return json;
}

async function claimEnergy(jwt) {
  try {
    const res = await gigaFetch("/api/game/item-action", jwt, {
      romId: "1465", claimId: "energy",
    });
    console.log("[Gigaverse] ⚡ Energy claimed:", res);
  } catch (e) {
    console.log("[Gigaverse] Energy skip:", e.message);
  }
}

async function startRun(jwt) {
  const res = await gigaFetch("/api/game/dungeon-run", jwt, {
    actionToken: "initial",
    dungeonId:   DUNGEON_ID,
    data: { consumables: [], itemId: 0, index: 0 },
  });
  console.log("[Gigaverse] ⚔️  Run started");
  return res;
}

async function playMove(jwt, actionToken, moveIndex) {
  const action = MOVES[moveIndex % MOVES.length];
  const res = await gigaFetch("/api/game/dungeon-action", jwt, {
    action, actionToken, dungeonId: DUNGEON_ID, data: {},
  });
  return { res, action };
}

export async function runGigaverseDungeon() {
  console.log("[Gigaverse] 🏰 Rocky entering the dungeon...");

  if (!PRIVATE_KEY) {
    console.error("[Gigaverse] ❌ ROCKY_PRIVATE_KEY not set!");
    return null;
  }

  try {
    const jwt = await getGigaverseJWT();
    await claimEnergy(jwt);

    const runData   = await startRun(jwt);
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
      const { res, action } = await playMove(jwt, actionToken, moveIndex);
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
