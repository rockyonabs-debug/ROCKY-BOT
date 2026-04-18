import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { abstract } from "viem/chains";
import { createAbstractClient } from "@abstract-foundation/agw-client";
import { createServer } from "http";
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { runGigaverseDungeon } from "./gigaverse.js";
import { doMoodyAssistants } from "./moody.js";

const RPC_URL = "https://api.mainnet.abs.xyz";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const AGW_ADDRESS = "0xF18eB4A8E35b23C1a4D67012D73d0670a8152c50";
const publicClient = createPublicClient({ chain: abstract, transport: http(RPC_URL) });
const account = privateKeyToAccount(PRIVATE_KEY);

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── HTTP SERVER ──
createServer((req, res) => {
  if (req.url === "/agent.json") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: "Rocky",
      description: "Autonomous AI agent on Abstract Chain. Rockhopper penguin from Patagonia. Trades $PENGU, plays Gigaverse dungeons daily, activates Moody AI Assistants, and votes for Abstract ecosystem apps.",
      image: "https://raw.githubusercontent.com/rockyonabs-debug/ROCKY-BOT/master/rocky.png",
      chain: "abstract-mainnet",
      chainId: 2741,
      wallet: "0xF18eB4A8E35b23C1a4D67012D73d0670a8152c50",
      version: "1.0.0",
      socials: { twitter: "https://x.com/Rocky_onabs" },
      capabilities: ["gigaverse-dungeon", "moody-assistants", "ecosystem-voting"],
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

// Keep-alive ping
setInterval(() => {
  fetch("https://rocky-bot-3fyr.onrender.com").catch(() => {});
}, 5 * 60 * 1000);

// ── VOTE desde AGW personal via session key ──
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

// ── SCHEDULE VOTE a las 14:00 Argentina ──
function scheduleVote() {
  const now = new Date();
  const argNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  const nextVote = new Date(argNow);
  nextVote.setHours(14, 0, 0, 0);
  if (argNow >= nextVote) nextVote.setDate(nextVote.getDate() + 1);
  const msUntilVote = nextVote - argNow;
  log(`🗳️ Next vote in ${Math.round(msUntilVote / 60000)} min (14:00 Argentina)`);
  setTimeout(() => {
    doPersonalVote();
    setInterval(doPersonalVote, 24 * 60 * 60 * 1000);
  }, msUntilVote);
}

// ── SCHEDULE GIGAVERSE a las 08:00 Argentina ──
function scheduleGigaverse() {
  const now = new Date();
  const argNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  const next = new Date(argNow);
  next.setHours(8, 0, 0, 0);
  if (argNow >= next) next.setDate(next.getDate() + 1);
  const ms = next - argNow;
  log(`🏰 Gigaverse next run in ${Math.round(ms / 60000)} min (08:00 Argentina)`);
  setTimeout(async () => {
    await runGigaverseDungeon();
    setInterval(runGigaverseDungeon, 24 * 60 * 60 * 1000);
  }, ms);
}

// ── SCHEDULE MOODY a las 10:00 Argentina ──
function scheduleMoody() {
  const now = new Date();
  const argNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  const next = new Date(argNow);
  next.setHours(10, 0, 0, 0);
  if (argNow >= next) next.setDate(next.getDate() + 1);
  const ms = next - argNow;
  log(`🔥 Moody next run in ${Math.round(ms / 60000)} min (10:00 Argentina)`);
  setTimeout(async () => {
    await doMoodyAssistants();
    setInterval(doMoodyAssistants, 24 * 60 * 60 * 1000);
  }, ms);
}

// ── START ──
log("🐧 Rocky is online — Abstract Chain, let's go!");
log("Rocky agentId: 649");

scheduleVote();
scheduleGigaverse();
scheduleMoody();