// Pagar keselamatan seed/reset staging QA-PV2 (P12A). Perintah HANYA berjalan di environment STAGING/TEST dengan database bertanda staging/qa/test.
// Production (APP_ENV kosong, DATABASE_URL klinik_matras, host terdaftar) ditolak SEBELUM satu query pun dijalankan.
import { databaseUrlProblem } from "../../src/lib/stagingGuard.js";

export const PREFIX = "QA-PV2";
export const EMAIL_PREFIX = "qa-pv2-";
export const ALLOWED_APP_ENVS = Object.freeze(["staging", "test"]);

// Tabel yang sudah berisi pada database yang BARU dimigrasi (data baseline migration) — TIDAK pernah dikosongkan oleh reset. Dijaga tes terhadap DB migrasi baru.
export const BASELINE_TABLES = Object.freeze([
  "_prisma_migrations", "fin_accounts", "routing_stages", "service_catalog", "service_catalog_modules", "storage_locations", "team_contacts", "warehouses",
]);

export class QaPv2SafetyError extends Error {
  constructor(message) { super(`QA-PV2 DITOLAK: ${message}`); this.name = "QaPv2SafetyError"; this.code = "QA_PV2_SAFETY"; }
}

// Dipanggil paling awal oleh CLI/library. Mengembalikan { appEnv, database } bila aman; melempar QaPv2SafetyError bila tidak.
export function assertQaPv2Safe({ env = process.env, databaseUrl = env.DATABASE_URL } = {}) {
  const appEnv = String(env.APP_ENV || "").trim().toLowerCase();
  if (!ALLOWED_APP_ENVS.includes(appEnv)) throw new QaPv2SafetyError(`APP_ENV harus ${ALLOWED_APP_ENVS.join(" atau ")} (sekarang: "${appEnv || "kosong"}")`);
  if (!databaseUrl) throw new QaPv2SafetyError("DATABASE_URL kosong");
  const problem = databaseUrlProblem(databaseUrl);
  if (problem) throw new QaPv2SafetyError(problem);
  if (String(env.NODE_ENV || "").toLowerCase() === "production" && appEnv !== "staging") throw new QaPv2SafetyError("NODE_ENV=production tanpa APP_ENV=staging");
  const m = String(databaseUrl).match(/\/([^/?]+)(\?.*)?$/);
  return { appEnv, database: m ? decodeURIComponent(m[1]) : "" };
}

export const qaCode = (suffix) => `${PREFIX}-${suffix}`;
export const isQaCode = (v) => typeof v === "string" && v.startsWith(`${PREFIX}-`);
