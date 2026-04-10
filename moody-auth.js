import fetch from "node-fetch";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { abstract } from "viem/chains";

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const MOODY_AUTH_URL = "https://moody-auth-b7gubah0fsbsc2f3.westus-01.azurewebsites.net";
const PLAYFAB_TITLE = "2FE83";
const ADDRESS = "0xaF7B17E7bbF5A21DeB480711959da0830A93199b";

async function getNonce() {
  const res = await fetch(`${MOODY_AUTH_URL}/nonce`);
  const data = await res.json();
  return data.nonce;
}

async function getOidcToken(nonce) {
  const issuedAt = new Date().toISOString();
  const message = `moodymadness.com wants you to sign in with your Ethereum account:\n${ADDRESS.toLowerCase()}\n\n\nURI: https://moodymadness.com/\nVersion: 1\nChain ID: 2741\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
  
  const signature = await account.signMessage({ message });

  const res = await fetch(`${MOODY_AUTH_URL}/generate-oidc-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: ADDRESS, message, nonce, signature })
  });

  const data = await res.json();
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

  const data = await res.json();
  return data?.data?.EntityToken?.EntityToken;
}

export async function getMoodyEntityToken() {
  try {
    console.log("[MoodyAuth] 🔑 Renovando EntityToken...");
    const nonce = await getNonce();
    const oidcToken = await getOidcToken(nonce);
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
