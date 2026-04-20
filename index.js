import { createPublicClient, http, parseEther, formatEther, encodePacked, encodeAbiParameters } from "viem";
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

const PENGU = "0x9eBe3A824Ca958e4b3Da772D2065518F009CBa62";
const WETH = "0x3439153EB7AF838Ad19d56E1571FBD09333C2809";
const ROUTER = "0xE1b076ea612Db28a0d768660e4D81346c02ED75e";
const PAIR = "0xda7d037fda848177141e037f9d0c67cae7b53262";
const ETH_RESERVE = parseEther("0.003");
const TRADE_SIZE = parseEther("0.0003");
const GRID_SPACING = 0.02;
const GRID_LEVELS = 5;

const ERC20_ABI = [
  { name: "balanceOf", type: "function", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }
];
const ROUTER_ABI = [{ name: "execute", type: "function", stateMutability: "payable", inputs: [{ name: "commands", type: "bytes" }, { name: "inputs", type: "bytes[]" }], outputs: [] }];

let basePrice = null;
let grid = [];

function buildGrid(price) {
  return Array.from({ length: GRID_LEVELS }, (_, i) => ({
    level: i + 1,
    buyPrice: price * (1 - GRID_SPACING * (i + 1)),
    sellPrice: price * (1 + GRID_SPACING * (i + 1)),
    filled: false
  }));
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

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
      capabilities: ["grid-trading", "gigaverse-dungeon", "moody-assistants", "ecosystem-voting"],
      services: [{ name: "web", endpoint: "https://rocky-bot-3fyr.onrender.com" }]
    }));
  } else if (req.url === "/session-setup.html") {
    try {
      const html = readFileSync("./session-setup.html", "utf8");
      res.setHeader("Content-Type", "text/html");
      res.end(html);
    } catch { res.end("session-setup.html not found"); }
  } else {
    res.end("Rocky online 🐧");
  }
}).listen(process.env.PORT || 3000);

setInterval(() => { fetch("https://rocky-bot-3fyr.onrender.com").catch(() => {}); }, 5 * 60 * 1000);

async function getPrice() {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/abstract/${PAIR}`);
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
  const data = await res.json();
  if (!data?.pair?.priceUsd) throw new Error("No price data");
  return parseFloat(data.pair.priceUsd);
}

async function runGrid() {
  try {
    const agwClient = await createAbstractClient({ signer: account, chain: abstract, transport: http(RPC_URL) });
    const price = await getPrice();
    const ethBal = await publicClient.getBalance({ address: AGW_ADDRESS });
    const penguBal = await publicClient.readContract({ address: PENGU, abi: ERC20_ABI, functionName: "balanceOf", args: [AGW_ADDRESS] });
    log(`🐧 Grid | ETH: ${formatEther(ethBal)} | PENGU: ${(Number(penguBal)/1e18).toFixed(2)} | Price: $${price}`);
    if (!basePrice) { basePrice = price; grid = buildGrid(price); log(`Grid init at $${price}`); return; }
    for (const level of grid) {
      if (!level.filled && price <= level.buyPrice) {
        const ethFree = ethBal - ETH_RESERVE;
        if (ethFree < TRADE_SIZE) { log(`⛔ Buy blocked — low ETH`); break; }
        const commands = "0x0b00";
        const wrapInput = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], ["0x0000000000000000000000000000000000000002", TRADE_SIZE]);
        const path = encodePacked(["address", "uint24", "address"], [WETH, 3000, PENGU]);
        const swapInput = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }], [AGW_ADDRESS, TRADE_SIZE, 0n, path, false]);
        const hash = await agwClient.writeContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "execute", value: TRADE_SIZE, args: [commands, [wrapInput, swapInput]] });
        level.filled = true;
        log(`✅ Bought PENGU! tx: ${hash}`);
        break;
      }
    }
    for (const level of grid) {
      if (level.filled && price >= level.sellPrice) {
        if (penguBal <= 0n) { log(`⛔ Sell blocked`); break; }
        const sellAmount = penguBal / 4n;
        const approveHash = await agwClient.writeContract({ address: PENGU, abi: ERC20_ABI, functionName: "approve", args: [ROUTER, sellAmount] });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        const path = encodePacked(["address", "uint24", "address"], [PENGU, 3000, WETH]);
        const swapInput = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }], [AGW_ADDRESS, sellAmount, 0n, path, true]);
        const hash = await agwClient.writeContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "execute", args: ["0x00", [swapInput]] });
        level.filled = false;
        log(`✅ Sold PENGU! tx: ${hash}`);
        break;
      }
    }
    if (Math.abs(price - basePrice) / basePrice > 0.25) { basePrice = price; grid = buildGrid(price); log(`🔄 Grid reset`); }
  } catch (err) {
    log(`❌ Grid error: ${err.shortMessage || err.message}`);
  }
}

let lastVoteDate = null;
async function doPersonalVote() {
  const today = new Date().toDateString();
  if (lastVoteDate === today) { log("🗳️ Already voted today — skipping"); return; }
  try {
    log("🗳️ Casting daily vote from personal AGW...");
    const result = execSync("node upvote.mjs", { cwd: process.cwd(), env: { ...process.env }, timeout: 60000 }).toString();
    lastVoteDate = today;
    log(`✅ Personal vote done: ${result}`);
  } catch (err) {
    log(`❌ Personal vote error: ${err.message}`);
  }
}

// Moody: quema + wake up 1 minuto después, cada 12 horas + 1 minuto de margen
async function doMoodyComplete() {
  log("🔥 Moody Burns iniciando...");
  await doMoodyAssistants();
  log("⏳ Esperando 60s para wake up...");
  await new Promise(r => setTimeout(r, 60000));
  log("🤖 Moody Wake Up iniciando...");
  await activateAssistants();
}

function scheduleAt(hour, minute, label, fn) {
  const now = new Date();
  const utcNow = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const next = new Date(utcNow);
  next.setHours(hour, minute, 0, 0);
  if (utcNow >= next) next.setDate(next.getDate() + 1);
  const ms = next - utcNow;
  log(`⏰ ${label} in ${Math.round(ms / 60000)} min`);
  setTimeout(() => { fn(); setInterval(fn, 24 * 60 * 60 * 1000); }, ms);
}

log("🐧 Rocky is online — Abstract Chain, let's go!");
log("Rocky agentId: 649");

runGrid();
setInterval(runGrid, 10 * 60 * 1000);

scheduleAt(18, 30, "Vote (18:30 UTC)", doPersonalVote);
scheduleAt(11, 0, "Gigaverse (11:00 UTC)", runGigaverseDungeon);

async function moodyLoop() {
  while (true) {
    log("🔥 Moody Burns iniciando...");
    await doMoodyAssistants();
    log("⏳ Esperando 60s para wake up...");
    await new Promise(r => setTimeout(r, 60000));
    log("🤖 Moody Wake Up iniciando...");
    await activateAssistants();
    log("✅ Moody ciclo completo. Próximo en 12h 1min.");
    await new Promise(r => setTimeout(r, (12 * 60 + 1) * 60 * 1000));
  }
}

scheduleAt(13, 0, "Moody primer ciclo (13:00 UTC)", moodyLoop);
setTimeout(function() {
  log("Test forzado Moody...");
  doMoodyAssistants().then(function() {
    return new Promise(function(r) { setTimeout(r, 60000); });
  }).then(function() {
    return activateAssistants();
  }).catch(function(e) { log("Test error: " + e.message); });
}, 60000);