import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { abstract } from "viem/chains";
import { createAbstractClient } from "@abstract-foundation/agw-client";

const RPC_URL = "https://api.mainnet.abs.xyz";
const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const publicClient = createPublicClient({ chain: abstract, transport: http(RPC_URL) });

const MOODY_BURNER = "0x88ab096adf34d70140ed1be93b16155073665267";
const ABI = [{ name: "burnAssistants", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] }];

export async function doMoodyAssistants() {
  try {
    console.log("[Moody] 🔥 Activando AI Assistants...");
    const agwClient = await createAbstractClient({
      signer: account, chain: abstract, transport: http(RPC_URL)
    });
    const hash = await agwClient.writeContract({
      address: MOODY_BURNER,
      abi: ABI,
      functionName: "burnAssistants",
      args: []
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("[Moody] ✅ AI Assistants activados! tx:", hash);
  } catch (err) {
    console.error("[Moody] ❌ Error:", err.shortMessage || err.message);
  }
}
