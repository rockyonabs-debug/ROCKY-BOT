import { createSessionClient } from "@abstract-foundation/agw-client/sessions";
import { abstract } from "viem/chains";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const stored = JSON.parse(readFileSync(join(__dirname, "session-config.json"), "utf8"));
const sessionConfig = stored.session;

const sessionSigner = privateKeyToAccount(process.env.ROCKY_EOA_PRIVATE_KEY);

const APP_IDS = [39n, 213n, 222n, 15n, 150n, 223n, 207n];
const day = new Date().getDay();
const index = day === 0 ? 6 : day - 1;
const appId = APP_IDS[index];

console.log(`Votando appId ${appId} desde AGW personal...`);

const sessionClient = createSessionClient({
  account: "0xaF7B17E7bbF5A21DeB480711959da0830A93199b",
  chain: abstract,
  signer: sessionSigner,
  session: {
    ...sessionConfig,
    expiresAt: BigInt(sessionConfig.expiresAt),
    feeLimit: {
      ...sessionConfig.feeLimit,
      limitType: Number(sessionConfig.feeLimit.limitType),
      limit: BigInt(sessionConfig.feeLimit.limit),
      period: BigInt(sessionConfig.feeLimit.period),
    },
    callPolicies: sessionConfig.callPolicies.map(p => ({
      ...p,
      valueLimit: {
        ...p.valueLimit,
        limitType: Number(p.valueLimit.limitType),
        limit: BigInt(p.valueLimit.limit),
        period: BigInt(p.valueLimit.period),
      },
      maxValuePerUse: BigInt(p.maxValuePerUse),
    })),
  },
  transport: http("https://api.mainnet.abs.xyz"),
});

const hash = await sessionClient.writeContract({
  address: "0x3B50dE27506f0a8C1f4122A1e6F470009a76ce2A",
  abi: [{ 
    name: "voteForApp", 
    type: "function", 
    inputs: [{ name: "appId", type: "uint256" }], 
    outputs: [], 
    stateMutability: "nonpayable" 
  }],
  functionName: "voteForApp",
  args: [appId],
});

console.log(`Voto enviado para appId ${appId}. TX: ${hash}`);