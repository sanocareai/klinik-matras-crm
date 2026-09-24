// Feature flags rebuild Production + Delivery V2.
// Fail-closed: tabel belum dimigrasi/error DB berarti seluruh jalur V2 OFF.
// Tidak ada environment variable yang dapat diam-diam menyalakan cutover.

export const V2_FLAGS = Object.freeze({
  DELIVERY_ROUTE_WRITER: "delivery_v2_writer_route",
  DELIVERY_EXECUTION_WRITER: "delivery_v2_writer_execution",
  DRIVER_SNAPSHOT_READER: "driver_v2_snapshot_reader",
  DELIVERY_WEB_READER: "delivery_web_v2_reader",
  PRODUCTION_WRITER: "production_v2_writer",
  PRODUCTION_READER: "production_v2_reader",
  DELIVERY_V1_WRITER_FENCE: "delivery_v1_writer_fence",
  PRODUCTION_V1_WRITER_FENCE: "production_v1_writer_fence",
});

export const V2_FLAG_DEFAULTS = Object.freeze(Object.values(V2_FLAGS).map((key) => Object.freeze({
  key, enabled: false, scope: "GLOBAL", config: {}, reason: "Default OFF — menunggu gate Chunk 0",
})));

export async function ensureV2Flags(tx) {
  for (const flag of V2_FLAG_DEFAULTS) {
    await tx.v2FeatureFlag.upsert({ where: { key: flag.key }, create: flag, update: {} });
  }
}

export async function loadV2Flags(client) {
  try {
    const rows = await client.v2FeatureFlag.findMany({ where: { key: { in: Object.values(V2_FLAGS) } } });
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    return Object.fromEntries(Object.values(V2_FLAGS).map((key) => [key, byKey[key] || { key, enabled: false, scope: "GLOBAL", config: {} }]));
  } catch {
    return Object.fromEntries(Object.values(V2_FLAGS).map((key) => [key, { key, enabled: false, scope: "GLOBAL", config: {}, unavailable: true }]));
  }
}

export function assertDeliveryReaderGate(flags) {
  const routeWriter = flags[V2_FLAGS.DELIVERY_ROUTE_WRITER]?.enabled === true;
  const executionWriter = flags[V2_FLAGS.DELIVERY_EXECUTION_WRITER]?.enabled === true;
  const driverReader = flags[V2_FLAGS.DRIVER_SNAPSHOT_READER]?.enabled === true;
  const webReader = flags[V2_FLAGS.DELIVERY_WEB_READER]?.enabled === true;
  if ((driverReader || webReader) && !(routeWriter && executionWriter)) {
    const error = new Error("Reader Delivery V2 tidak boleh aktif sebelum seluruh writer Delivery V2 aktif");
    error.code = "V2_READER_GATE_VIOLATION";
    throw error;
  }
  return true;
}

export function isFlagEnabled(flags, key, { userId = null, deviceId = null } = {}) {
  const flag = flags[key];
  if (!flag?.enabled) return false;
  const config = flag.config || {};
  if (Array.isArray(config.userIds) && config.userIds.length > 0 && !config.userIds.includes(userId)) return false;
  if (Array.isArray(config.deviceIds) && config.deviceIds.length > 0 && !config.deviceIds.includes(deviceId)) return false;
  return true;
}

// Satu keputusan reader untuk Driver Mobile. Endpoint konfigurasi dan test
// memakai fungsi yang sama agar client tidak pernah menebak mode dari error
// snapshot atau mencampur hasil V1/V2. Fail-closed ke V1 bila writer gate
// belum lengkap, tabel flag tidak tersedia, atau cohort tidak cocok.
export function resolveDriverReaderMode(flags, { userId = null, deviceId = null } = {}) {
  try {
    assertDeliveryReaderGate(flags);
  } catch {
    return { readerMode: "V1", reason: "DELIVERY_V2_GATE_NOT_READY" };
  }
  if (!isFlagEnabled(flags, V2_FLAGS.DRIVER_SNAPSHOT_READER, { userId, deviceId })) {
    return { readerMode: "V1", reason: "COHORT_NOT_ENABLED" };
  }
  return { readerMode: "V2", reason: "COHORT_ENABLED" };
}
