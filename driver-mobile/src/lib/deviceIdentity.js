const DEVICE_ID_KEY = "driver-device-id:v1";

function randomPart() {
  return Math.random().toString(36).slice(2, 12);
}

export async function getOrCreateDeviceId(storage) {
  const existing = String(await storage.getItem(DEVICE_ID_KEY) || "").trim();
  if (existing) return existing;
  const created = `drv-${Date.now().toString(36)}-${randomPart()}${randomPart()}`;
  await storage.setItem(DEVICE_ID_KEY, created);
  return created;
}

export { DEVICE_ID_KEY };
