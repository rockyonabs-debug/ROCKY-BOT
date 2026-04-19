import { createSessionClient } from "@abstract-foundation/agw-client/sessions";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { abstract } from "viem/chains";

const __dirname = dirname(fileURLToPath(import.meta.url));
const stored = JSON.parse(readFileSync(join(__dirname, "session-config.json"), "utf8"));
const sessionConfig = stored.session;
const sessionSigner = privateKeyToAccount(process.env.ROCKY_PRIVATE_KEY || process.env.ROCKY_EOA_PRIVATE_KEY);

// 14 apps rotando — una por día de la semana
const APP_IDS = [39n, 213n, 222n, 15n, 150n, 223n, 207n, 5n, 89n, 45n, 123n, 178n, 95n, 201n];

// Intentar votar con fallback al siguiente si ya votamos hoy
async function tryVote(appId) {
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

  return hash;
}

const day = new Date().getDay();
const startIndex = day === 0 ? 6 : day - 1;

let voted = false;
for (let i = 0; i < APP_IDS.length; i++) {
  const index = (startIndex + i) % APP_IDS.length;
  const appId = APP_IDS[index];
  try {
    console.log(`Intentando votar appId ${appId}...`);
    const hash = await tryVote(appId);
    console.log(`Voto enviado para appId ${appId}. TX: ${hash}`);
    voted = true;
    break;
  } catch (err) {
    if (err.message?.includes('execution reverted')) {
      console.log(`appId ${appId} ya votada hoy, probando siguiente...`);
      continue;
    }
    throw err;
  }
}

if (!voted) {
  console.log("Ya se votaron todas las apps disponibles hoy.");
}