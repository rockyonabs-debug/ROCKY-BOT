import fetch from "node-fetch";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { abstract } from "viem/chains";

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: abstract, transport: http("https://api.mainnet.abs.xyz") });
const MOODY_AUTH_URL = "https://moody-auth-b7gubah0fsbsc2f3.westus-01.azurewebsites.net";
const PLAYFAB_TITLE = "2FE83";
const ADDRESS = "0xaF7B17E7bbF5A21DeB480711959da0830A93199b";

async function getNonce() {
  const res = await fetch(`${MOODY_AUTH_URL}/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: ADDRESS.toLowerCase() })
  });
  const text = await res.text();
  console.log("[MoodyAuth] Nonce raw:", text.substring(0, 300));
  return JSON.parse(text);
}

async function getOidcToken(nonceData) {
  const message = nonceData.message;
  const nonce = nonceData.nonce;
  const signature = await account.signMessage({ message });

  const res = await fetch(`${MOODY_AUTH_URL}/generate-oidc-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: ADDRESS, message, nonce, signature })
  });

  const text = await res.text();
  console.log("[MoodyAuth] OIDC raw:", text.substring(0, 300));
  const data = JSON.parse(text);
  return data.token;
}

async function getEntityToken(oidcToken) {
  const res = await fetch(`https://2fe83.playfabapi.com/Client/LoginWithOpenIdConnect?sdk=JavaScriptSDK-1.93.210927`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      TitleId: PLAYFAB_TITLE,
      IdToken: oidcToken,
      CreateAccount: false,
      ConnectionId: "moody-oidc"
    })
  });

  const text = await res.text();
  console.log("[MoodyAuth] PlayFab raw:", text.substring(0, 300));
  const data = JSON.parse(text);
  return data?.data?.EntityToken?.EntityToken;
}

export async function getMoodyEntityToken() {
  try {
    console.log("[MoodyAuth] 🔑 Renovando EntityToken...");
    const nonceData = await getNonce();
    const oidcToken = await getOidcToken(nonceData);
    const entityToken = await getEntityToken(oidcToken);
    if (entityToken) {
      console.log("[MoodyAuth] ✅ EntityToken renovado!");
      return entityToken;
    }
    console.log("[MoodyAuth] ❌ No se pudo obtener EntityToken");
    return null;
  } catch (err) {
    console.error("[MoodyAuth] ❌ Error:", err.message);
    return null;
  }
}
