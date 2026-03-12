// ============================================================
// gigaverse.js — Rocky's autonomous dungeon module
// Abstract Chain agent: 0x8a16261bE29306c8985C50c953dee51fc78C7E3C
// ============================================================

import { ethers } from "ethers";
import fetch from "node-fetch";

// ── Config ────────────────────────────────────────────────────
const PRIVY_APP_ID = "cm04asygd041fmry9zmcyn5o5";
const PRIVY_BASE   = "https://auth.privy.io";
const GIGA_BASE    = "https://gigaverse.io";
const DUNGEON_ID   = 1;
const CHAIN_ID     = 2741; // Abstract chain

const ROCKY_EOA    = "0x8a16261bE29306c8985C50c953dee51fc78C7E3C";
const PRIVATE_KEY  = process.env.ROCKY_PRIVATE_KEY; // set in Railway env vars

// Combat moves — Rocky rotates Sword→Spell→Shield
const MOVES        = ["rock", "scissors", "paper"]; // sword / spell / shield

// ── Privy Auth ────────────────────────────────────────────────

async function getPrivyToken() {
  const wallet = new ethers.Wallet(PRIVATE_KEY);

  // 1. Get init nonce
  const initRes = await fetch(`${PRIVY_BASE}/api/v1/siwe/init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "privy-app-id": PRIVY_APP_ID,
    },
    body: JSON.stringify({ address: ROCKY_EOA }),
  });

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`Privy init failed: ${err}`);
  }

  const { nonce } = await initRes.json();

  // 2. Build SIWE message
  const domain     = "gigaverse.io";
  const origin     = "https://gigaverse.io";
  const issuedAt   = new Date().toISOString();
  const message    = [
    `${domain} wants you to sign in with your Ethereum account:`,
    ROCKY_EOA,
    "",
    "By signing, you are proving you own this wallet and logging in. This does not initiate a transaction or cost any fees.",
    "",
    `URI: ${origin}`,
    "Version: 1",
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    "Resources:",
    "- https://privy.io",
  ].join("\n");

  // 3. Sign the message
  const signature = await wallet.signMessage(message);

  // 4. Authenticate with Privy
  const authRes = await fetch(`${PRIVY_BASE}/api/v1/siwe/authenticate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "privy-app-id": PRIVY_APP_ID,
    },
    body: JSON.stringify({
      message,
      signature,
      chainId: `eip155:${CHAIN_ID}`,
      walletClientType: "metamask",
      connectorType:    "injected",
    }),
  });

  if (!authRes.ok) {
    const err = await authRes.text();
    throw new Error(`Privy auth failed: ${err}`);
  }

  const authData = await authRes.json();
  const token = authData.token;

  if (!token) throw new Error("No token in Privy response: " + JSON.stringify(authData));

  console.log("[Gigaverse] ✅ Privy token obtained");
  return token;
}

// ── Gigaverse API calls ───────────────────────────────────────

async function gigaFetch(path, token, body) {
  const res = await fetch(`${GIGA_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(`Gigaverse API error [${path}]: ${JSON.stringify(json)}`);
  return json;
}

async function claimEnergy(token) {
  try {
    const res = await gigaFetch("/api/game/item-action", token, {
      romId:   "1465",
      claimId: "energy",
    });
    console.log("[Gigaverse] ⚡ Energy claimed:", res);
    return true;
  } catch (e) {
    // Energy already claimed or not available — not a fatal error
    console.log("[Gigaverse] Energy already claimed or unavailable:", e.message);
    return false;
  }
}

async function startRun(token, actionToken) {
  const res = await gigaFetch("/api/game/dungeon-run", token, {
    actionToken,
    dungeonId: DUNGEON_ID,
    data: {
      consumables: [],
      itemId:      0,
      index:       0,
    },
  });
  console.log("[Gigaverse] ⚔️  Run started");
  return res;
}

async function playMove(token, actionToken, moveIndex) {
  const action = MOVES[moveIndex % MOVES.length];
  const res = await gigaFetch("/api/game/dungeon-action", token, {
    action,
    actionToken,
    dungeonId: DUNGEON_ID,
    data: {},
  });
  return { res, action };
}

// ── Main dungeon loop ─────────────────────────────────────────

export async function runGigaverseDungeon() {
  console.log("[Gigaverse] 🏰 Rocky entering the dungeon...");

  if (!PRIVATE_KEY) {
    console.error("[Gigaverse] ❌ ROCKY_PRIVATE_KEY env var not set!");
    return null;
  }

  try {
    // 1. Authenticate
    const token = await getPrivyToken();

    // 2. Claim energy
    await claimEnergy(token);

    // 3. Start run — first action token is a placeholder
    const runData = await startRun(token, "initial");
    let actionToken = runData?.data?.run?.actionToken
                   ?? runData?.actionToken
                   ?? null;

    if (!actionToken) {
      console.error("[Gigaverse] ❌ No actionToken in startRun response:", JSON.stringify(runData));
      return null;
    }

    // 4. Fight loop
    let moveIndex  = 0;
    let totalWins  = 0;
    let totalLoss  = 0;
    let runActive  = true;
    const MAX_MOVES = 30; // safety cap

    while (runActive && moveIndex < MAX_MOVES) {
      await sleep(1200); // be polite to the API

      const { res, action } = await playMove(token, actionToken, moveIndex);

      const runState = res?.data?.run ?? res?.run ?? {};
      const result   = runState?.lastResult ?? res?.result ?? "?";
      const hp       = runState?.playerHp   ?? res?.playerHp ?? "?";

      console.log(`[Gigaverse] Move ${moveIndex + 1}: ${action.toUpperCase()} → ${result} | HP: ${hp}`);

      if (result === "win")  totalWins++;
      if (result === "lose") totalLoss++;

      // Update action token for next move
      const nextToken = runState?.actionToken ?? res?.actionToken ?? null;
      if (nextToken) actionToken = nextToken;

      // Check if run ended
      const isOver = runState?.status === "completed"
                  || runState?.status === "dead"
                  || hp === 0
                  || res?.runOver === true;

      if (isOver) {
        runActive = false;
        console.log("[Gigaverse] 🏁 Run ended");
      }

      moveIndex++;
    }

    const summary = {
      wins:   totalWins,
      losses: totalLoss,
      moves:  moveIndex,
    };

    console.log("[Gigaverse] 📊 Summary:", summary);
    return summary;

  } catch (err) {
    console.error("[Gigaverse] ❌ Error:", err.message);
    return null;
  }
}

// ── Scheduler (call this from index.js) ──────────────────────

export function scheduleGigaverse(tweetFn) {
  // Run every 4 hours
  const INTERVAL_MS = 4 * 60 * 60 * 1000;

  async function doRun() {
    const result = await runGigaverseDungeon();

    if (result && tweetFn) {
      const tweet = buildDungeonTweet(result);
      await tweetFn(tweet);
    }
  }

  // Run once on start, then every 4h
  doRun();
  setInterval(doRun, INTERVAL_MS);
  console.log("[Gigaverse] 🗓️  Scheduler started — running every 4 hours");
}

function buildDungeonTweet({ wins, losses, moves }) {
  const survived = losses === 0;
  const intro = survived
    ? "⚔️ Just cleared a dungeon in @gigaverse_io!"
    : "💀 Fell in the dungeon at @gigaverse_io...";

  return `${intro}\n\nW: ${wins} | L: ${losses} | Moves: ${moves}\n\nThe dungeon doesn't care if you're human or AI. Only that you survive. 🏰\n\n#Gigaverse #AbstractChain #AIAgent`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
