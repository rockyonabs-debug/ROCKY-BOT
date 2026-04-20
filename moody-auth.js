import fetch from "node-fetch";

const PLAYFAB_URL = "https://2fe83.playfabapi.com/Authentication/GetEntityToken?sdk=JavaScriptSDK-1.93.210927";

let cachedEntityToken = null;

async function getEntityTokenFromSession(sessionTicket) {
  const res = await fetch(PLAYFAB_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Authorization": sessionTicket },
    body: JSON.stringify({})
  });
  const data = await res.json();
  return data?.data?.EntityToken || null;
}

export async function getMoodyEntityToken() {
  try {
    if (cachedEntityToken) {
      console.log("[MoodyAuth] ✅ Usando entityToken cacheado");
      return cachedEntityToken;
    }

    const sessionTicket = process.env.MOODY_SESSION_TICKET;
    if (!sessionTicket) {
      console.log("[MoodyAuth] ❌ No hay MOODY_SESSION_TICKET en las variables de entorno");
      return null;
    }

    console.log("[MoodyAuth] 🔑 Obteniendo entityToken desde sessionTicket...");
    const entityToken = await getEntityTokenFromSession(sessionTicket);
    if (entityToken) {
      cachedEntityToken = entityToken;
      console.log("[MoodyAuth] ✅ EntityToken obtenido!");
      return entityToken;
    }

    console.log("[MoodyAuth] ❌ SessionTicket expirado — actualizá MOODY_SESSION_TICKET en Render");
    return null;
  } catch (err) {
    console.error("[MoodyAuth] ❌ Error:", err.message);
    return null;
  }
}