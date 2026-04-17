import { createPublicClient, http } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { abstract } from "viem/chains";
import { createAbstractClient } from "@abstract-foundation/agw-client";
import { createServer } from "http";
import { runGigaverseDungeon } from "./gigaverse.js";
import { doMoodyAssistants } from "./moody.js";
import { activateAssistants } from "./moody-assistants.js";

const RPC_URL = "https://api.mainnet.abs.xyz";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const AGW_ADDRESS = "0xF18eB4A8E35b23C1a4D67012D73d0670a8152c50";

const publicClient = createPublicClient({ chain: abstract, transport: http(RPC_URL) });
const account = privateKeyToAccount(PRIVATE_KEY);

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

createServer((req, res) => {
  if (req.url === "/agent.json") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Rocky",
      description: "Autonomous AI agent on Abstract Chain. Rockhopper penguin from Patagonia. Trades $PENGU with a grid strategy, plays Gigaverse dungeons daily, activates Moody AI Assistants, and votes for Abstract ecosystem apps.",
      image: "https://raw.githubusercontent.com/rockyonabs-debug/ROCKY-BOT/master/rocky.png",
      chain: "abstract-mainnet",
      chainId: 2741,
      wallet: "0xF18eB4A8E35b23C1a4D67012D73d0670a8152c50",
      version: "1.0.0",
      socials: { twitter: "https://x.com/Rocky_onabs" },
      capabilities: ["grid-trading", "gigaverse-dungeon", "moody-assistants", "ecosystem-voting"],
      services: [{ name: "web", endpoint: "https://rocky-bot-3fyr.onrender.com" }]
    }));
} else if (req.url === "/session-setup.html") {
    const fs = await import("fs");
    const html = fs.readFileSync("./session-setup.html", "utf8");
    res.setHeader("Content-Type", "text/html");
    res.end(html);
  } else {
    res.end("Rocky online 🐧");
  }
}).listen(process.env.PORT || 3000);

setInterval(() => {
  fetch("https://rocky-bot-3fyr.onrender.com").catch(() => {});
}, 5 * 60 * 1000);

async function getPrice() {
  const res = await fetch("https://api.dexscreener.com/latest/dex/pairs/abstract/0x87aBEc768E8B87A1DBb59Df0A0E08EF3bB2eA48d");
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.pair?.priceUsd) throw new Error("No price data");
  return parseFloat(data.pair.priceUsd);
}

async function runGrid() {
  try {
    const price = await getPrice();
    const ethBal = await publicClient.getBalance({ address: AGW_ADDRESS });
    const ethNum = Number(ethBal) / 1e18;
    log(`🐧 Grid | ETH: ${ethNum} | Price: $${price}`);
  } catch (err) {
    log(`❌ Grid error: ${err.message}`);
  }
}

async function doVote() {
  try {
    log("🗳️ Voting...");
    const agwClient = await createAbstractClient({
      signer: account, chain: abstract, transport: http(RPC_URL)
    });
    const hash = await agwClient.writeContract({
      address: "0x3B50dE27506f0a8C1f4122A1e6F470009a76ce2A",
      abi: [{ name: "vote", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] }],
      functionName: "vote",
      args: []
    });
    await publicClient.waitForTransactionReceipt({ hash });
    log(`✅ Vote done! tx: ${hash}`);
  } catch (err) {
    log(`❌ Vote error: ${err.shortMessage || err.message}`);
  }
}

async function doGigaverse() {
  try {
    const result = await runGigaverseDungeon();
    if (result) log(`🏰 Gigaverse done: ${JSON.stringify(result)}`);
  } catch (err) {
    log(`❌ Gigaverse error: ${err.message}`);
  }
}

async function doMoodyWakeUp() {
  try {
    log("[Moody] 🔥 Iniciando burn + wakeup...");
    await doMoodyAssistants();
    await activateAssistants();
    log("[Moody] ✅ Ciclo completo");
  } catch (err) {
    log(`❌ Moody error: ${err.message}`);
  }
}

const taskState = {
  lastGigaverse: 0,
  lastVote: 0,
  lastMoody: 0,
};

async function scheduler() {
  const now = Date.now();
  const hour = new Date().getUTCHours();

  await runGrid();

  if (hour === 6 && now - taskState.lastGigaverse > 20 * 60 * 60 * 1000) {
    taskState.lastGigaverse = now;
    doGigaverse();
  }

  if (hour === 7 && now - taskState.lastVote > 20 * 60 * 60 * 1000) {
    taskState.lastVote = now;
    doVote();
  }

  if ((hour === 15 || hour === 3) && now - taskState.lastMoody > 10 * 60 * 60 * 1000) {
    taskState.lastMoody = now;
    doMoodyWakeUp();
  }
}

// ── START ──
log("🐧 Rocky is online — Abstract Chain, let's go!");
log("Rocky agentId: 649");

const sessionPrivateKey = generatePrivateKey();
const sessionSigner = privateKeyToAccount(sessionPrivateKey);
log(`🔑 Session signer address: ${sessionSigner.address}`);
log(`🔑 Session private key: ${sessionPrivateKey}`);

setTimeout(doMoodyWakeUp, 2 * 60 * 1000);
scheduler();
setInterval(scheduler, 10 * 60 * 1000);
