import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { abstract } from "viem/chains";
import { createAbstractClient } from "@abstract-foundation/agw-client";

const RPC_URL     = "https://api.mainnet.abs.xyz";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const AGW_ADDRESS = "0xF18eB4A8E35b23C1a4D67012D73d0670a8152c50";
const SEASON_ID   = 3n;
const BAKERY_ID   = 73n;
const COOKS_PER_DAY = 3;

const SEASON_MANAGER  = "0x327E83B8517f60973473B2f2cA0eC3a0FEBB5676";
const PLAYER_REGISTRY = "0x663D69eCFF14b4dbD245cdac03f2e1DEb68Ed250";
const CLAN_REGISTRY   = "0xbffCc2C852f6b6E5CFeF8630a43B6CD06194E1AC";
const BAKERY_CONTRACT = "0xaEB8Eef0deAbA98E3B65f6311DD7F997e72B837a";

const SEASON_ABI = [
  { name: "isSeasonActive", type: "function", inputs: [], outputs: [{ type: "bool" }] },
];

const PLAYER_ABI = [
  { name: "isRegistered",     type: "function", inputs: [{ name: "player", type: "address" }, { name: "season", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "getBuyInAmount",   type: "function", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "getCookieBalance", type: "function", inputs: [{ name: "player", type: "address" }, { name: "season", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "register",         type: "function", stateMutability: "payable", inputs: [{ name: "season", type: "uint256" }, { name: "clanId", type: "uint256" }], outputs: [] },
];

const CLAN_ABI = [
  { name: "getPlayerClan", type: "function", inputs: [{ name: "player", type: "address" }, { name: "season", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { name: "joinClan",      type: "function", stateMutability: "nonpayable", inputs: [{ name: "season", type: "uint256" }, { name: "clanId", type: "uint256" }], outputs: [] },
];

const BAKERY_ABI = [
  { name: "bake", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
];

const publicClient = createPublicClient({ chain: abstract, transport: http(RPC_URL) });
const account      = privateKeyToAccount(PRIVATE_KEY);

async function readContract(address, abi, functionName, args = []) {
  return await publicClient.readContract({ address, abi, functionName, args });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function doBakery() {
  console.log("[Bakery] 🍪 Rocky starting bakery routine...");

  try {
    const agwClient = await createAbstractClient({
      signer: account, chain: abstract, transport: http(RPC_URL)
    });

    // 1. Verificar temporada activa
    const isActive = await readContract(SEASON_MANAGER, SEASON_ABI, "isSeasonActive");
    if (!isActive) {
      console.log("[Bakery] ❌ No hay temporada activa");
      return null;
    }
    console.log("[Bakery] ✅ Temporada", SEASON_ID.toString(), "activa");

    // 2. Ver si Rocky está registrado
    const isRegistered = await readContract(PLAYER_REGISTRY, PLAYER_ABI, "isRegistered", [AGW_ADDRESS, SEASON_ID]);
    console.log("[Bakery] 📋 Registrado:", isRegistered);

    if (!isRegistered) {
      const buyIn = await readContract(PLAYER_REGISTRY, PLAYER_ABI, "getBuyInAmount");
      console.log("[Bakery] 💰 Buy-in:", buyIn.toString(), "wei");
      console.log("[Bakery] ▶️ Registrándose en bakery 73...");
      const regHash = await agwClient.writeContract({
        address: PLAYER_REGISTRY, abi: PLAYER_ABI,
        functionName: "register", args: [SEASON_ID, BAKERY_ID],
        value: buyIn
      });
      await publicClient.waitForTransactionReceipt({ hash: regHash });
      console.log("[Bakery] ✅ Registrado! tx:", regHash);
    }

    // 3. Verificar que está en la bakery
    const currentClan = await readContract(CLAN_REGISTRY, CLAN_ABI, "getPlayerClan", [AGW_ADDRESS, SEASON_ID]);
    console.log("[Bakery] 🏠 Bakery actual:", currentClan.toString());

    if (currentClan === 0n) {
      console.log("[Bakery] ▶️ Uniéndose a bakery 73...");
      const joinHash = await agwClient.writeContract({
        address: CLAN_REGISTRY, abi: CLAN_ABI,
        functionName: "joinClan", args: [SEASON_ID, BAKERY_ID]
      });
      await publicClient.waitForTransactionReceipt({ hash: joinHash });
      console.log("[Bakery] ✅ Unido a bakery 73! tx:", joinHash);
    }

    // 4. Hornear 3 veces con 30 segundos entre cada una
    let lastCookies = 0n;
    for (let i = 1; i <= COOKS_PER_DAY; i++) {
      console.log(`[Bakery] 🍪 Cook ${i}/${COOKS_PER_DAY}...`);
      const bakeHash = await agwClient.writeContract({
        address: BAKERY_CONTRACT, abi: BAKERY_ABI,
        functionName: "bake", args: []
      });
      await publicClient.waitForTransactionReceipt({ hash: bakeHash });
      console.log(`[Bakery] ✅ Cook ${i} hecho! tx:`, bakeHash);

      lastCookies = await readContract(PLAYER_REGISTRY, PLAYER_ABI, "getCookieBalance", [AGW_ADDRESS, SEASON_ID]);
      console.log(`[Bakery] 🍪 Balance: ${lastCookies.toString()} cookies`);

      if (i < COOKS_PER_DAY) await sleep(30000); // 30 segundos entre cooks
    }

    return { cookies: lastCookies.toString() };

  } catch (err) {
    console.error("[Bakery] ❌ Error:", err.shortMessage || err.message);
    return null;
  }
}
