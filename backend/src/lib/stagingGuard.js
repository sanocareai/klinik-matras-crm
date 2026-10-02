// Pagar STAGING (P12A). Staging = proses backend dengan APP_ENV=staging pada database/volume/jaringan TERPISAH dari production.
// Modul ini murni infrastruktur keselamatan, tanpa efek di production (APP_ENV tidak diset -> semua fungsi no-op):
//   1. assertStagingDatabaseUrl  — menolak database yang tampak seperti production (nama DB harus bertanda staging/qa/test).
//   2. installEgressGuard        — memblokir SEMUA koneksi keluar ke host non-privat (fetch, http(s).request, net.Socket.connect): WhatsApp
//                                  (WAHA), email/SMTP, webhook otomasi, push (FCM/Expo/Web Push), Instagram, Maps, penyedia AI. Lapisan kedua
//                                  setelah jaringan Docker `internal: true` (lapisan OS) di docker-compose.staging.yml.
//   3. neutralizeExternalEnv     — membuang konfigurasi/kredensial eksternal dari process.env sebelum modul lain membacanya.
//   4. backgroundJobsEnabled     — semua job latar (kirim WA/broadcast/rekap/alert) mati di staging.
import net from "node:net";
import http from "node:http";
import https from "node:https";

export const appEnv = () => String(process.env.APP_ENV || "").trim().toLowerCase();
export const isStaging = () => appEnv() === "staging";
export const backgroundJobsEnabled = () => !isStaging() && process.env.DISABLE_BACKGROUND_JOBS !== "1";

export class EgressBlockedError extends Error {
  constructor(target) { super(`Staging memblokir koneksi keluar ke "${target}" (egress guard)`); this.name = "EgressBlockedError"; this.code = "EGRESS_BLOCKED"; }
}

// Nama database yang BOLEH untuk staging/QA/test. Production = "klinik_matras" (tanpa penanda) -> ditolak.
const STAGING_DB_NAME = /(^|[_-])(staging|qa|qa_pv2|test)([_-]|$)/i;
export function parseDatabaseUrl(url) {
  let u; try { u = new URL(String(url)); } catch { return null; }
  return { host: u.hostname, port: u.port || "5432", database: decodeURIComponent(u.pathname.replace(/^\//, "")), user: decodeURIComponent(u.username) };
}
export function databaseUrlProblem(url, { productionHosts = String(process.env.PRODUCTION_DB_HOSTS || "").split(",").map((x) => x.trim()).filter(Boolean) } = {}) {
  const p = parseDatabaseUrl(url);
  if (!p) return "DATABASE_URL tidak valid";
  if (!p.database) return "DATABASE_URL tanpa nama database";
  if (p.database === "klinik_matras") return `database "${p.database}" adalah database production`;
  if (!STAGING_DB_NAME.test(p.database)) return `nama database "${p.database}" tidak bertanda staging/qa/test`;
  if (productionHosts.some((h) => h && p.host === h)) return `host "${p.host}" terdaftar sebagai host production`;
  return null;
}
export function assertStagingDatabaseUrl(url, opts) {
  const problem = databaseUrlProblem(url, opts);
  if (problem) throw new Error(`STAGING DITOLAK: ${problem}`);
}

// Host yang boleh dihubungi: loopback, rentang privat RFC1918/link-local/ULA, dan nama satu-label (DNS jaringan Docker, mis. "postgres-staging").
export function isAllowedEgressHost(host) {
  const h = String(host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true; // unix socket / tanpa host
  if (h === "localhost" || h === "::1" || h === "::") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./); if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  if (/^[a-z0-9_-]+$/.test(h) && !/^\d+(\.\d+){3}$/.test(h)) return true; // satu label, bukan IPv4 publik
  return false;
}

const EXTERNAL_ENV = [
  "WAHA_BASE_URL", "WAHA_API_KEY", "WAHA_SESSION", "WAHA_BUSINESS_NUMBER", "AUTOMATION_WEBHOOK_URL", "AUTOMATION_WEBHOOK_SECRET", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY",
  "IG_ACCESS_TOKEN", "LOCATIONIQ_API_KEY", "GOOGLE_MAPS_API_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_EMAIL", "FINANCE_PUSH_ENABLED", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_URL",
  "EMAIL_ALERT_TO", "ALERT_EMAIL", "FCM_SERVICE_ACCOUNT", "FCM_SERVICE_ACCOUNT_JSON", "GOOGLE_APPLICATION_CREDENTIALS", "EXPO_ACCESS_TOKEN", "MOBILE_FINANCE_UPDATE_URL", "MCP_HUB_API_TOKEN", "MCP_API_TOKEN",
];
export function neutralizeExternalEnv(env = process.env) {
  const removed = [];
  for (const k of EXTERNAL_ENV) if (env[k] !== undefined) { delete env[k]; removed.push(k); }
  return removed;
}

let installed = false;
export function installEgressGuard() {
  if (installed) return false;
  installed = true;
  const blockUrl = (u) => { try { const x = new URL(String(u?.url || u?.href || u)); return isAllowedEgressHost(x.hostname) ? null : x.hostname; } catch { return null; } };
  const realFetch = globalThis.fetch;
  if (typeof realFetch === "function") {
    globalThis.fetch = (input, init) => { const bad = blockUrl(input); return bad ? Promise.reject(new EgressBlockedError(bad)) : realFetch(input, init); };
  }
  const hostOf = (args) => {
    const [a, b] = args;
    if (typeof a === "string" || a instanceof URL) { try { return new URL(String(a)).hostname; } catch { return b?.hostname || b?.host || ""; } }
    return a?.hostname || a?.host || "";
  };
  for (const mod of [http, https]) {
    for (const fn of ["request", "get"]) {
      const orig = mod[fn];
      mod[fn] = function guarded(...args) { const h = hostOf(args); if (!isAllowedEgressHost(h)) throw new EgressBlockedError(h); return orig.apply(this, args); };
    }
  }
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    // net.connect()/Socket.connect() mengirim argumen ter-normalisasi: [options, callback] (Array bertanda) — buka dulu.
    let first = args[0];
    if (Array.isArray(first)) first = first[0];
    const opts = first && typeof first === "object" ? first : null;
    let host = opts ? opts.host : (args.length >= 2 && typeof args[1] === "string" ? args[1] : "");
    if (opts && opts.path) host = "";
    if (host && !isAllowedEgressHost(host)) { const err = new EgressBlockedError(host); process.nextTick(() => this.destroy(err)); return this; }
    return origConnect.apply(this, args);
  };
  return true;
}

// Dipanggil sekali di awal proses (src/index.js). No-op bila bukan staging.
export function bootstrapStaging({ log = console.log } = {}) {
  if (!isStaging()) return { staging: false };
  assertStagingDatabaseUrl(process.env.DATABASE_URL);
  const removed = neutralizeExternalEnv();
  installEgressGuard();
  process.env.DISABLE_BACKGROUND_JOBS = "1";
  log(`[staging] APP_ENV=staging — egress guard aktif, job latar mati, ${removed.length} variabel eksternal dinetralkan`);
  return { staging: true, removed };
}
