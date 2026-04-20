import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { abstract } from "viem/chains";
import { createAbstractClient } from "@abstract-foundation/agw-client";

const RPC_URL = "https://api.mainnet.abs.xyz";
const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const publicClient = createPublicClient({ chain: abstract, transport: http(RPC_URL) });

const ERC1155 = "0x35ffe9d966e35bd1b0e79f0d91e438701ea1c644";
const AGW_PERSONAL = "0xaF7B17E7bbF5A21DeB480711959da0830A93199b";
const TOKEN_ID = 70n;

const ABI = [{
  name: "burn",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "account", type: "address" },
    { name: "id", type: "uint256" },
    { name: "value", type: "uint256" }
  ],
  outputs: []
}];

export async function doMoodyAssistants() {
  try {
    console.log("[Moody] 🔥 Quemando energia para los 3 slots...");
    const agwClient = await createAbstractClient({
      signer: account, chain: abstract, transport: http(RPC_URL)
    });
    for (let i = 1; i <= 3; i++) {
      console.log(`[Moody] 🔥 Quemando slot ${i}...`);
      const hash = await agwClient.writeContract({
        address: ERC1155,
        abi: ABI,
        functionName: "burn",
        args: [AGW_PERSONAL, TOKEN_ID, 1n]
      });
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`[Moody] ✅ Slot ${i} quemado! tx: ${hash}`);
      await new Promise(r => setTimeout(r, 3000));
    }
    console.log("[Moody] ✅ Los 3 slots quemados!");
  } catch (err) {
    console.error("[Moody] ❌ Error:", err.shortMessage || err.message);
  }
}