import fetch from "node-fetch";
import { privateKeyToAccount } from "viem/accounts";
import { abstract } from "viem/chains";
import { createWalletClient, http } from "viem";

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: abstract, transport: http("https://api.mainnet.abs.xyz") });
const MOODY_AUTH_URL = "https://moody-auth-b7gubah0fsbsc2f3.westus-01.azurewebsites.net";
const PLAYFAB_TITLE = "2FE83";
const ADDRESS = "0xaF7B17E7bbF5A21DeB480711959da0830A93199b";

let cachedSessionTicket = process.env.MOODY_SESSION_TICKET || null;
let cachedEntityToken = null;

async function getNonce() {
  const res = await fetch(`${MOODY_AUTH_URL}/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: ADDRESS.toLowerCase() })
  });
  return JSON.parse(await res.text());
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
  const data = JSON.parse(await res.text());
  return data.token;
}

async function getSessionTicket(oidcToken) {
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
  const data = JSON.parse(await res.text());
  return data?.data?.SessionTicket;
}

async function getEntityTokenFromSession(sessionTicket) {
  const res = await fetch(`https://2fe83.playfabapi.com/Authentication/GetEntityToken?sdk=JavaScriptSDK-1.93.210927`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Authorization": sessionTicket }
  ,
    body: JSON.stringify({})
  });
  const data = JSON.parse(await res.text());
  return data?.data?.EntityToken;
}

export async function getMoodyEntityToken() {
  try {
    // Si tenemos entityToken cacheado, usarlo
    if (cachedEntityToken) {
      console.log("[MoodyAuth] ✅ Usando entityToken cacheado");
      return cachedEntityToken;
    }

    // Si tenemos sessionTicket, obtener entityToken directamente
    if (cachedSessionTicket) {
      console.log("[MoodyAuth] 🔑 Obteniendo entityToken desde sessionTicket...");
      const entityToken = await getEntityTokenFromSession(cachedSessionTicket);
      if (entityToken) {
        cachedEntityToken = entityToken;
        console.log("[MoodyAuth] ✅ EntityToken obtenido!");
        return entityToken;
      }
      console.log("[MoodyAuth] ⚠️ SessionTicket expirado, renovando...");
      cachedSessionTicket = null;
    }

    // Renovar todo desde cero con SIWE
    console.log("[MoodyAuth] 🔑 Renovando desde SIWE...");
    const nonceData = await getNonce();
    const oidcToken = await getOidcToken(nonceData);
    const sessionTicket = await getSessionTicket(oidcToken);
    if (!sessionTicket) { console.log("[MoodyAuth] ❌ No sessionTicket"); return null; }
    
    cachedSessionTicket = sessionTicket;
    const entityToken = await getEntityTokenFromSession(sessionTicket);
    if (entityToken) {
      cachedEntityToken = entityToken;
      console.log("[MoodyAuth] ✅ Auth completa!");
      return entityToken;
    }
    return null;
  } catch (err) {
    console.error("[MoodyAuth] ❌ Error:", err.message);
    return null;
  }
}