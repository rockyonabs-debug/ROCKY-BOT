import fetch from "node-fetch";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAYFAB_URL = "https://2fe83.playfabapi.com/CloudScript/ExecuteFunction?sdk=JavaScriptSDK-1.93.210927";

function getStoredToken() {
  // Intentar leer desde variable de entorno
  if (process.env.MOODY_ENTITY_TOKEN) return process.env.MOODY_ENTITY_TOKEN;
  // Intentar leer desde archivo local
  const filePath = join(__dirname, 'moody-playfab.json');
  if (existsSync(filePath)) {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    return data.entityToken || null;
  }
  return null;
}

export async function getMoodyEntityToken() {
  const token = getStoredToken();
  if (token) {
    console.log("[MoodyAuth] ✅ Usando token guardado");
    return token;
  }
  console.log("[MoodyAuth] ❌ No hay token disponible - actualizá MOODY_ENTITY_TOKEN en Render");
  return null;
}