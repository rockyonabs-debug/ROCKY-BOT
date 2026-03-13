import { ethers } from "ethers";
import fetch from "node-fetch";

const PRIVY_APP_ID = "cm04asygd041fmry9zmcyn5o5";
const PRIVY_BASE   = "https://auth.privy.io";
const GIGA_BASE    = "https://gigaverse.io";
const DUNGEON_ID   = 1;
const CHAIN_ID     = 2741;

const ROCKY_EOA    = "0x8a16261bE29306c8985C50c953dee51fc78C7E3C";
const PRIVATE_KEY  = process.env.ROCKY_PRIVATE_KEY;

const MOVES        = ["rock", "scissors", "paper"];

const PRIVY_HEADERS = {
  "Content-Type":  "application/json",
  "privy-app-id":  PRIVY_APP_ID,
  "origin":        "https://gigaverse.io",
  "referer":       "https://gigaverse.io/",
};

async function getPrivyToken() {
  const wallet = new ethers.Wallet(PRIVATE_KEY);

  const initRes = await fetch(`${PRIVY_BASE}/api/v1/siwe/init`, {
    method: "POST",
    headers: PRIVY_HEADERS,
    body: JSON.stringify({ address: ROCKY_EOA }),
  });

  if (!initRes.ok) {
    const err = await initRes.text();
    throw new Error(`Privy init failed: ${err}`);
  }

  const { nonce } = await initRes.json();

  const domain   = "gigaverse.io";
  const origin   = "https://gigaverse.io";
  const issuedAt = new Date().toISOString();
  const message  = [
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

  const signature = await wallet.signMessage(message);

  const authRes = await fetch(`${PRIVY_BASE}/api/v1/siwe/authenticate`, {
    method: "POST",
    headers: PRIVY_HEADERS,
    body: JSON.stringify({
      message,
      signature,
      chainId:          `eip155:${CHAIN_ID}`,
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
  if (!token) throw new Error("No token: " + JSON.stringify(authData));

  console.log("[Gigaverse] ✅ Privy token obtained");
  return token;
}

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
  if (!res.ok) throw new Error(`Gigaverse error [${path}]: ${JSON.stringify(json)}`);
  return json;
}

async function claimEnergy(token) {
  try {
    const res = await gigaFetch("/api/game/item-action", token, {
      romId:   "1465",
      claimId: "energy",
    });
    console.log("[Gigaverse] ⚡ Energy claimed:", res);
  } catch (e) {
    console.log("[Gigaverse] Energy skip:", e.message);
  }
}

async function startRun(token) {
  const res = await gigaFetch("/api/game/dungeon-run", token, {
    actionToken: "initial",
    dungeonId:   DUNGEON_ID,
    data: { consumables: [], itemId: 0, index: 0 },
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

export async function runGigaverseDungeon() {
  console.log("[Gigaverse] 🏰 Rocky entering the dungeon...");

  if (!PRIVATE_KEY) {
    console.error("[Gigaverse] ❌ ROCKY_PRIVATE_KEY not set!");
    return null;
  }

  try {
    const token = await getPrivyToken();
    await claimEnergy(token);

    const runData   = await startRun(token);
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
    const MAX_MOVES = 30;

    while (moveIndex < MAX_MOVES) {
      await sleep(1200);

      const { res, action } = await playMove(token, actionToken, moveIndex);
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
