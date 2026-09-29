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

// ---------------------------------------------------------------------------
// Writer Delivery V2: SATU keputusan bersama untuk armada.js dan cross-boundary service.
//
// - delivery_v2_writer_route dan delivery_v2_writer_execution adalah satu unit: keduanya wajib ON.
//   Hanya satu ON -> keduanya dianggap OFF (WRITER_PAIR_INCOMPLETE).
// - Tanpa config.routeIds di kedua flag -> mode GLOBAL (perilaku legacy; bukan untuk canary).
// - config.routeIds terisi -> mode COHORT; daftar kedua flag WAJIB identik, bila tidak -> OFF
//   (WRITER_COHORT_MISMATCH). config.userIds pada flag writer tidak dipakai untuk command berbasis
//   route; bila diisi tanpa routeIds -> OFF (WRITER_USER_COHORT_UNSUPPORTED), sama dengan efek legacy.
// - Mode COHORT: command tanpa route (termasuk system/background) -> V1-only; command yang
//   menyentuh route di dalam DAN di luar cohort sekaligus -> ditolak 409 (WRITER_COHORT_BOUNDARY)
//   agar projection route cohort tidak pernah tertinggal diam-diam.
// Diagnostic hanya berisi kode, tanpa ID atau data sensitif.
// ---------------------------------------------------------------------------
export const DELIVERY_WRITER_MODE = Object.freeze({ OFF: "OFF", GLOBAL: "GLOBAL", COHORT: "COHORT" });

const nonEmptyList = (value) => (Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string" && item))].sort() : []);
let lastDiagnostic = null;
function diagnostic(code) {
  if (code && code !== lastDiagnostic) console.warn(`[delivery-v2-writer] ${code}: writer V2 dianggap OFF (fail-closed ke V1)`);
  lastDiagnostic = code;
}

export function resolveDeliveryWriterState(flags) {
  const route = flags[V2_FLAGS.DELIVERY_ROUTE_WRITER];
  const execution = flags[V2_FLAGS.DELIVERY_EXECUTION_WRITER];
  const off = (code) => { diagnostic(code); return { mode: DELIVERY_WRITER_MODE.OFF, routeIds: new Set(), diagnostic: code }; };
  const routeOn = route?.enabled === true;
  const executionOn = execution?.enabled === true;
  if (!routeOn && !executionOn) return off(null);
  if (routeOn !== executionOn) return off("WRITER_PAIR_INCOMPLETE");
  const routeCohort = nonEmptyList(route.config?.routeIds);
  const executionCohort = nonEmptyList(execution.config?.routeIds);
  if (routeCohort.join("|") !== executionCohort.join("|")) return off("WRITER_COHORT_MISMATCH");
  if (routeCohort.length === 0) {
    if (nonEmptyList(route.config?.userIds).length || nonEmptyList(execution.config?.userIds).length) return off("WRITER_USER_COHORT_UNSUPPORTED");
    diagnostic(null);
    return { mode: DELIVERY_WRITER_MODE.GLOBAL, routeIds: new Set(), diagnostic: null };
  }
  diagnostic(null);
  return { mode: DELIVERY_WRITER_MODE.COHORT, routeIds: new Set(routeCohort), diagnostic: null };
}

// routeIds = route authoritative yang disentuh command (sudah di-resolve dari database oleh pemanggil).
export function isDeliveryWriterEnabledFor(state, routeIds = []) {
  if (state.mode === DELIVERY_WRITER_MODE.OFF) return false;
  if (state.mode === DELIVERY_WRITER_MODE.GLOBAL) return true;
  const touched = [...new Set((routeIds || []).filter(Boolean))];
  if (touched.length === 0) return false;
  const inside = touched.filter((routeId) => state.routeIds.has(routeId)).length;
  if (inside === 0) return false;
  if (inside === touched.length) return true;
  throw Object.assign(new Error("Command menyentuh route di dalam dan di luar cohort writer V2 sekaligus; pisahkan operasinya"), {
    statusCode: 409, code: "WRITER_COHORT_BOUNDARY",
  });
}

// Resolusi route authoritative dari database untuk command berbasis job.
export async function resolveJobRouteIds(client, jobIds = []) {
  const ids = [...new Set((jobIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const rows = await client.job.findMany({ where: { id: { in: ids } }, select: { routeId: true } });
  return [...new Set(rows.map((row) => row.routeId).filter(Boolean))];
}

// Satu pintu untuk semua pemanggil: context { routeId, routeIds, jobId, jobIds }.
// Job di-resolve ke route dari database; route context yang diberikan pemanggil ikut dihitung.
export async function deliveryWriterDecision(client, flags, context = {}) {
  const state = resolveDeliveryWriterState(flags);
  if (state.mode !== DELIVERY_WRITER_MODE.COHORT) return { state, enabled: state.mode === DELIVERY_WRITER_MODE.GLOBAL };
  const routeIds = [
    ...(context.routeId ? [context.routeId] : []),
    ...(context.routeIds || []),
    ...await resolveJobRouteIds(client, [...(context.jobId ? [context.jobId] : []), ...(context.jobIds || [])]),
  ];
  return { state, enabled: isDeliveryWriterEnabledFor(state, routeIds) };
}

// ---------------------------------------------------------------------------
// Writer Production/Warehouse V2 (custody unit) — memakai flag production_v2_writer yang sudah ada.
// - flag OFF -> OFF (perilaku V1 murni).
// - ON tanpa cohort sah (lihat resolveProductionCohort) -> OFF; tidak ada GLOBAL.
// - ON dengan config.unitIds sah -> COHORT: unitId wajib ada dan cocok; selain itu V1-only (fail-closed).
// Tidak ada userIds: aktor berbeda (driver, petugas gudang) semuanya tercakup oleh cohort unit.
// ---------------------------------------------------------------------------
export const PRODUCTION_WRITER_MODE = Object.freeze({ OFF: "OFF", COHORT: "COHORT" });

// Keputusan flag Production V2 (writer dan reader memakai fungsi yang sama) — FAIL-CLOSED.
// - flag OFF / tidak ada -> OFF (tanpa diagnostic).
// - ON dengan config.unitIds = array UUID valid, unik, tidak kosong -> COHORT.
// - ON dengan config hilang/rusak (bukan objek), unitIds hilang/kosong/bukan array, elemen bukan UUID, UUID ganda,
//   atau kunci yang belum didukung (userIds, mode, global) -> OFF dengan diagnostic kode. TIDAK ADA mode GLOBAL:
//   "ON tanpa cohort" tidak pernah berarti "semua unit". Bila kelak GLOBAL diperlukan, ia butuh konfigurasi eksplisit
//   terpisah dan perubahan kode; unitIds yang hilang tidak boleh menyalakannya.
// UUID dinormalisasi ke huruf kecil (id unit di PostgreSQL selalu huruf kecil). Diagnostic hanya berisi kode, tanpa ID.
export const PRODUCTION_FLAG_DIAGNOSTIC = Object.freeze({
  CONFIG_INVALID: "PRODUCTION_FLAG_CONFIG_INVALID",
  COHORT_MISSING: "PRODUCTION_FLAG_COHORT_MISSING",
  COHORT_INVALID: "PRODUCTION_FLAG_COHORT_INVALID",
  COHORT_DUPLICATE: "PRODUCTION_FLAG_COHORT_DUPLICATE",
  UNSUPPORTED_KEY: "PRODUCTION_FLAG_UNSUPPORTED_KEY",
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCTION_UNSUPPORTED_KEYS = ["userIds", "mode", "global"];
const productionDiagnosticSeen = new Map();

function resolveProductionCohort(flag, label, offMode) {
  const off = (code) => {
    if (productionDiagnosticSeen.get(label) !== code) console.warn(`[production-v2-${label}] ${code}: flag ON tetapi cohort tidak sah — dianggap OFF (fail-closed ke V1)`);
    productionDiagnosticSeen.set(label, code);
    return { mode: offMode, unitIds: new Set(), diagnostic: code };
  };
  if (flag?.enabled !== true) { productionDiagnosticSeen.set(label, null); return { mode: offMode, unitIds: new Set(), diagnostic: null }; }
  const config = flag.config;
  if (config === null || typeof config !== "object" || Array.isArray(config)) return off(PRODUCTION_FLAG_DIAGNOSTIC.CONFIG_INVALID);
  if (PRODUCTION_UNSUPPORTED_KEYS.some((key) => Object.prototype.hasOwnProperty.call(config, key))) return off(PRODUCTION_FLAG_DIAGNOSTIC.UNSUPPORTED_KEY);
  if (config.unitIds === undefined || config.unitIds === null) return off(PRODUCTION_FLAG_DIAGNOSTIC.COHORT_MISSING);
  if (!Array.isArray(config.unitIds)) return off(PRODUCTION_FLAG_DIAGNOSTIC.COHORT_INVALID);
  if (config.unitIds.length === 0) return off(PRODUCTION_FLAG_DIAGNOSTIC.COHORT_MISSING);
  if (config.unitIds.some((item) => typeof item !== "string" || !UUID_PATTERN.test(item))) return off(PRODUCTION_FLAG_DIAGNOSTIC.COHORT_INVALID);
  const unitIds = config.unitIds.map((item) => item.toLowerCase());
  if (new Set(unitIds).size !== unitIds.length) return off(PRODUCTION_FLAG_DIAGNOSTIC.COHORT_DUPLICATE);
  productionDiagnosticSeen.set(label, null);
  return { mode: "COHORT", unitIds: new Set(unitIds), diagnostic: null };
}

export function resolveProductionWriterState(flags) {
  return resolveProductionCohort(flags[V2_FLAGS.PRODUCTION_WRITER], "writer", PRODUCTION_WRITER_MODE.OFF);
}

// Hanya unit yang tercantum di cohort; context tanpa unitId (atau bukan string) -> V1/inert.
const inCohort = (state, unitId) => state.mode === "COHORT" && typeof unitId === "string" && state.unitIds.has(unitId.toLowerCase());

export function isProductionWriterEnabledFor(state, unitId) {
  return inCohort(state, unitId);
}

export async function productionWriterEnabledForUnit(client, unitId) {
  const flags = await loadV2Flags(client);
  return isProductionWriterEnabledFor(resolveProductionWriterState(flags), unitId);
}

// ---------------------------------------------------------------------------
// Reader Production/Warehouse V2 (antrean custody Gudang). Simetris dengan writer, flag terpisah
// (production_v2_reader) sehingga UI dapat diperlihatkan ke Gudang tanpa ikut mengaktifkan writer/surface
// Production V2 lain. Fail-closed: flag OFF -> antrean kosong (bukan error); ON tanpa cohort sah -> OFF; ON dengan unitIds sah -> COHORT,
// hanya unit itu yang tampil. Tidak ada GLOBAL.
// ---------------------------------------------------------------------------
export const PRODUCTION_READER_MODE = Object.freeze({ OFF: "OFF", COHORT: "COHORT" });

export function resolveProductionReaderState(flags) {
  return resolveProductionCohort(flags[V2_FLAGS.PRODUCTION_READER], "reader", PRODUCTION_READER_MODE.OFF);
}

// unitIds=null pada mode COHORT berarti "daftar unitId yang boleh dilihat" (dipakai memfilter query list).
export function isProductionReaderEnabledFor(state, unitId) {
  return inCohort(state, unitId);
}
