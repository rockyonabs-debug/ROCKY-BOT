import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { abstract } from "viem/chains";
import { createAbstractClient } from "@abstract-foundation/agw-client";
import { createServer } from "http";
import { readFileSync } from "fs";
import { execSync } from "child_process";
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
    try {
      const html = readFileSync("./session-setup.html", "utf8");
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    } catch {
      res.end("session-setup.html not found");
    }
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

// Daily vote from personal AGW via session key
let lastVoteDate = null;
async function doPersonalVote() {
  const today = new Date().toDateString();
  if (lastVoteDate === today) { log("🗳️ Already voted today — skipping"); return; }
  try {
    log("🗳️ Casting daily vote from personal AGW...");
    const result = execSync("node upvote.mjs", {
      cwd: process.cwd(),
      env: { ...process.env },
      timeout: 60000
    }).toString();
    lastVoteDate = today;
    log(`✅ Personal vote done: ${result}`);
  } catch (err) {
    log(`❌ Personal vote error: ${err.message}`);
  }
}

log("🐧 Rocky is online — Abstract Chain, let's go!");
log("Rocky agentId: 649");

runGrid();
setInterval(runGrid, 10 * 60 * 1000);
doPersonalVote();
setInterval(doPersonalVote, 24 * 60 * 60 * 1000);