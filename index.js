import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { abstract } from "viem/chains";
import { createAbstractClient } from "@abstract-foundation/agw-client";
import { createServer } from "http";
import { runGigaverseDungeon } from "./gigaverse.js";
import { deployMoodyBurner } from "./deploy-moody-burner.js";

const RPC_URL = "https://api.mainnet.abs.xyz";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const AGW_ADDRESS = "0xF18eB4A8E35b23C1a4D67012D73d0670a8152c50";

const publicClient = createPublicClient({ chain: abstract, transport: http(RPC_URL) });
const account = privateKeyToAccount(PRIVATE_KEY);

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

createServer((req, res) => res.end("Rocky online")).listen(process.env.PORT || 3000);

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

// ── START ──
log("🐧 Rocky is online — Abstract Chain, let's go!");
log("Rocky agentId: 649");

deployMoodyBurner();
runGrid();
setTimeout(doGigaverse, 2 * 60 * 1000);
setTimeout(doVote, 5 * 60 * 1000);

setInterval(runGrid, 10 * 60 * 1000);
setInterval(doVote, 24 * 60 * 60 * 1000);
setInterval(doGigaverse, 24 * 60 * 60 * 1000);
