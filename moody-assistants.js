import fetch from "node-fetch";
import { getMoodyEntityToken } from "./moody-auth.js";

const PLAYFAB_URL = "https://2fe83.playfabapi.com/CloudScript/ExecuteFunction?sdk=JavaScriptSDK-1.93.210927";
const PROFILE_ID = "A65036813206D95A";
const TIMEZONE = -10800000;
const DRINK_IDS = ["98FF330F5B6A3D64", "98FF330F5B6A3D64", "98FF330F5B6A3D64", "98FF330F5B6A3D64", "98FF330F5B6A3D64"];
const SLOTS = ["slot_001", "slot_002", "slot_003"];

async function wakeUpAssistant(entityToken, slotId) {
  const res = await fetch(PLAYFAB_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-EntityToken": entityToken,
      "origin": "https://moodymadness.com",
      "referer": "https://moodymadness.com/",
    },
    body: JSON.stringify({
      FunctionName: "PostAiAssistantWakeUp",
      FunctionParameter: {
        ProfileID: PROFILE_ID,
        SlotId: slotId,
        DrinkItemInstanceId: DRINK_IDS,
        TimeZone: TIMEZONE
      }
    })
  });
  const data = await res.json();
  if (data.code === 200) {
    console.log(`[Moody] ✅ Asistente ${slotId} activado!`);
  } else {
    console.log(`[Moody] ❌ Error ${slotId}:`, JSON.stringify(data).substring(0, 200));
  }
  return data;
}

export async function activateAssistants() {
  console.log("[Moody] 🤖 Activando AI Assistants...");
  
  const entityToken = await getMoodyEntityToken();
  if (!entityToken) {
    console.log("[Moody] ❌ Sin EntityToken, abortando");
    return;
  }

  for (const slot of SLOTS) {
    await wakeUpAssistant(entityToken, slot);
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log("[Moody] ✅ Todos los asistentes procesados");
}
