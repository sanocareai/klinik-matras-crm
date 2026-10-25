// SSO Task & Meeting (D-200) — aturan MURNI: konfigurasi, allow-list tujuan,
// pembuatan/hash kode, dan pemetaan peran. Tanpa database, tanpa Express —
// dites langsung (tests/hubSso.test.js). Bagian yang menyentuh DB ada di
// services/hubSso.js; kontrak lengkap di docs/HUB-SSO.md.
//
// Semua di sini FAIL-CLOSED: konfigurasi yang meragukan berarti fitur mati,
// tujuan yang tidak persis dikenal berarti ditolak, peran yang tidak
// terpetakan berarti tanpa akses.

import crypto from "node:crypto";
import { PERMISSIONS as P } from "../../constants/permissions.js";
import { hasPermission, rolesOf } from "../../middleware/authorize.js";

/** Umur kode handoff. Tetap (bukan env): angka yang bisa disetel adalah angka yang bisa salah disetel. */
export const HANDOFF_TTL_SECONDS = 60;
/** 32 byte = 256 bit. */
export const HANDOFF_CODE_BYTES = 32;
/** Kode base64url dari 32 byte selalu 43 karakter. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** SHA-256 heksadesimal dari `state` HUB — selalu 64 karakter hex kecil. */
const STATE_HASH_PATTERN = /^[a-f0-9]{64}$/;
/** Same-domain embedding (Okt 2026) — HUB_BASE_URL sekarang boleh punya path
 * dasar (mis. "/workspace", HUB mount di origin yang SAMA dengan SANSS lewat
 * basePath Next.js + reverse proxy), bukan cuma origin polos. Pola ini
 * SENGAJA ketat — segmen alfanumerik sederhana saja, tanpa titik/encoded
 * slash/trailing slash — supaya tidak ada ruang untuk trik path-traversal
 * atau open-redirect lewat variabel ini; bukan pelemahan, perluasan yang
 * tetap sama kerasnya terhadap bentuk liar apa pun. */
const BASE_PATH_PATTERN = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
export const SERVICE_TOKEN_MIN_LENGTH = 32;
/** Baris handoff lama dibersihkan setelah ini (jejak audit ada di activity_events, bukan di sini). */
export const HANDOFF_RETENTION_MS = 24 * 3600 * 1000;

// ─── Konfigurasi ────────────────────────────────────────────────────────────

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Loopback, RFC1918, link-local, ULA, `*.localhost`, `host.docker.internal`,
 *  atau nama satu-label (service Docker/compose, mis. `hub`). Domain/IP
 *  publik BUKAN privat. Sama persis dengan `isPrivateHost` di sisi HUB
 *  (src/lib/sso.ts) — dua tempat, satu aturan. */
export function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "host.docker.internal") return true;
  if (h.includes(":")) {
    return h === "::1" || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
  }
  return !h.includes("."); // satu label, bukan IP
}

/**
 * Baca konfigurasi SSO dari env.
 *
 *  - enabled : HUB_SSO_ENABLED harus PERSIS "true". "1", "TRUE", "yes", kosong,
 *              atau tak ada = mati. Mati berarti seluruh /api/hub menjawab 404.
 *  - ready   : enabled DAN semua isian valid. Enabled tapi tidak ready berarti
 *              503 (bukan jalan dengan konfigurasi setengah benar).
 *  - baseUrl : HANYA dari HUB_BASE_URL — origin saja, https (http hanya untuk
 *              localhost). Tidak pernah dari request (Host, Origin, body).
 *              Dipakai untuk membangun postUrl (/sso/callback) di respons
 *              /handoff — TUJUAN publik, boleh diberitahukan ke browser.
 *  - hubInternalUrl: alamat PRIVAT HUB (tahap 4) — dipakai SANSS memanggil
 *              POST {hubInternalUrl}/api/sso/revoke saat logout/nonaktif/
 *              cabut akses. Domain/IP publik ditolak (arah panggilan ini
 *              server-ke-server, sama seperti SANSS_INTERNAL_URL di sisi HUB).
 *  - serviceToken: rahasia server-ke-server, minimal 32 karakter dan BUKAN
 *              JWT_SECRET (dua rahasia terpisah = bocornya satu tidak
 *              membuka yang lain — inti D-200: tidak berbagi JWT secret).
 *              Dipakai KEDUA ARAH (HUB→SANSS exchange/introspect/revoke DAN
 *              SANSS→HUB revoke) — satu rahasia bersama, bukan JWT_SECRET.
 */
export function hubSsoConfig(env = process.env) {
  if (env.HUB_SSO_ENABLED !== "true") {
    return { enabled: false, ready: false, baseUrl: null, hubInternalUrl: null, serviceToken: null, problems: [] };
  }

  const problems = [];

  let baseUrl = null;
  const rawBase = typeof env.HUB_BASE_URL === "string" ? env.HUB_BASE_URL.trim() : "";
  if (!rawBase) {
    problems.push("HUB_BASE_URL belum diisi");
  } else {
    try {
      const u = new URL(rawBase);
      const local = LOCAL_HOSTS.has(u.hostname);
      if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) {
        problems.push("HUB_BASE_URL harus https (http hanya untuk localhost)");
      } else if (u.username || u.password) {
        problems.push("HUB_BASE_URL tidak boleh memuat kredensial");
      } else if (u.search || u.hash) {
        problems.push("HUB_BASE_URL tidak boleh memuat query atau fragment");
      } else if (u.pathname !== "/" && u.pathname !== "" && !BASE_PATH_PATTERN.test(u.pathname)) {
        problems.push("HUB_BASE_URL harus origin saja, atau origin + path dasar sederhana (mis. /workspace)");
      } else {
        // Path dasar (mis. "/workspace") dipertahankan apa adanya — basePath
        // Next.js HUB di origin yang sama dengan SANSS (same-domain
        // embedding). Root ("/" atau "") tetap menghasilkan origin polos
        // seperti sebelumnya, TIDAK diberi trailing slash tambahan.
        const basePath = u.pathname === "/" ? "" : u.pathname;
        baseUrl = `${u.origin}${basePath}`;
      }
    } catch {
      problems.push("HUB_BASE_URL bukan URL yang valid");
    }
  }

  let hubInternalUrl = null;
  const rawInternal = typeof env.HUB_INTERNAL_URL === "string" ? env.HUB_INTERNAL_URL.trim() : "";
  if (!rawInternal) {
    problems.push("HUB_INTERNAL_URL belum diisi");
  } else {
    try {
      const u = new URL(rawInternal);
      if (u.username || u.password) {
        problems.push("HUB_INTERNAL_URL tidak boleh memuat kredensial");
      } else if (u.search || u.hash) {
        problems.push("HUB_INTERNAL_URL tidak boleh memuat query atau fragment");
      } else if (u.pathname !== "/" && u.pathname !== "" && !BASE_PATH_PATTERN.test(u.pathname)) {
        problems.push("HUB_INTERNAL_URL harus origin saja, atau origin + path dasar sederhana (mis. /workspace)");
      } else if (!isPrivateHost(u.hostname)) {
        problems.push("HUB_INTERNAL_URL harus alamat privat/loopback (panggilan revoke bersifat server-ke-server)");
      } else {
        // basePath Next.js HUB berlaku di proses itu sendiri, lepas dari
        // jalur jaringan yang menjangkaunya (langsung ke port container pun
        // tetap lewat router Next.js yang sama) — jadi /api/sso/revoke
        // SUNGGUHAN ada di {origin}{basePath}/api/sso/revoke, bukan
        // {origin}/api/sso/revoke, begitu HUB_BASE_URL (di atas) punya path.
        const basePath = u.pathname === "/" ? "" : u.pathname;
        hubInternalUrl = `${u.origin}${basePath}`;
      }
    } catch {
      problems.push("HUB_INTERNAL_URL bukan URL yang valid");
    }
  }

  const token = typeof env.HUB_SERVICE_TOKEN === "string" ? env.HUB_SERVICE_TOKEN : "";
  if (token.length < SERVICE_TOKEN_MIN_LENGTH) {
    problems.push(`HUB_SERVICE_TOKEN minimal ${SERVICE_TOKEN_MIN_LENGTH} karakter`);
  } else if (env.JWT_SECRET && token === env.JWT_SECRET) {
    problems.push("HUB_SERVICE_TOKEN tidak boleh sama dengan JWT_SECRET");
  }

  const ready = problems.length === 0;
  return {
    enabled: true,
    ready,
    baseUrl: ready ? baseUrl : null,
    hubInternalUrl: ready ? hubInternalUrl : null,
    serviceToken: ready ? token : null,
    problems,
  };
}

/** Bentuk `state_hash` yang sah (cek murah sebelum menyentuh DB). */
export function isWellFormedStateHash(hash) {
  return typeof hash === "string" && STATE_HASH_PATTERN.test(hash);
}

/** Bandingkan token layanan tanpa membocorkan panjang/isi lewat waktu respons. */
export function safeEqualToken(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string" || !expected) return false;
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// ─── Permintaan internal ────────────────────────────────────────────────────

function isPrivateAddress(addr = "") {
  return (
    addr === "::1" || addr === "127.0.0.1" || addr.startsWith("::ffff:127.") ||
    addr.startsWith("10.") || addr.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(addr) ||
    addr.startsWith("::ffff:10.") || addr.startsWith("::ffff:192.168.") || addr.startsWith("::ffff:172.")
  );
}

// Header yang DITAMBAHKAN reverse proxy. Permintaan dari internet selalu lewat
// nginx dan membawa minimal salah satunya; klien tidak bisa membuangnya.
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded", "via"];

/**
 * "Hanya server": soket dari alamat loopback/privat DAN tanpa jejak proxy.
 * Ini lapisan tambahan — pagar utamanya tetap token layanan. Konsekuensi
 * untuk HUB: panggil backend SANSS langsung lewat alamat loopback/privat
 * (mis. http://127.0.0.1:4000), BUKAN lewat URL publik di belakang nginx.
 */
export function isInternalRequest(req) {
  const addr = req.socket?.remoteAddress || "";
  if (!isPrivateAddress(addr)) return false;
  return !PROXY_HEADERS.some((h) => req.headers?.[h] !== undefined);
}

// ─── Tujuan (allow-list) ────────────────────────────────────────────────────

const ID = "[A-Za-z0-9_-]{8,64}";
/** Halaman HUB yang boleh menjadi tujuan pendaratan. Tanpa query/fragment. */
const EXACT_DESTINATIONS = new Set([
  "/", "/dashboard", "/my-tasks", "/inbox", "/goals", "/dashboards",
  "/meetings", "/meetings/action-item-saya",
]);
const DESTINATION_PATTERNS = [
  new RegExp(`^/meetings/${ID}$`),
  new RegExp(`^/projects/${ID}/(board|list|calendar|gantt|docs|forms|sprints)$`),
];

/**
 * Tujuan pendaratan di HUB. Mengembalikan jalur kanonik, atau null bila tidak
 * lolos. Kosong/tak ada = "/" (default). Karena yang lolos hanya kecocokan
 * PERSIS dengan daftar di atas, semua bentuk open-redirect (`//evil.com`,
 * `/\\evil.com`, `https://…`, `javascript:`, `%2F%2F`, `..`, `?next=`, `#`,
 * spasi/kontrol) gugur tanpa perlu daftar larangan.
 */
export function resolveDestination(input) {
  if (input === undefined || input === null || input === "") return "/";
  if (typeof input !== "string" || input.length > 200) return null;
  if (EXACT_DESTINATIONS.has(input)) return input;
  return DESTINATION_PATTERNS.some((re) => re.test(input)) ? input : null;
}

// ─── Kode ───────────────────────────────────────────────────────────────────

/** Kode acak 256-bit, base64url (43 karakter). Dikirim ke browser sekali; TIDAK PERNAH disimpan/dilog. */
export function newHandoffCode() {
  return crypto.randomBytes(HANDOFF_CODE_BYTES).toString("base64url");
}

/** Bentuk kode yang sah (cek murah sebelum menyentuh DB). */
export function isWellFormedCode(code) {
  return typeof code === "string" && CODE_PATTERN.test(code);
}

/** Yang disimpan di database. SHA-256 cukup: masukannya 256-bit acak, tak bisa ditebak/dikamus. */
export function hashHandoffCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

// ─── Peran ──────────────────────────────────────────────────────────────────

/**
 * Peran di workspace Task & Meeting dari role SANSS — atau null (tanpa akses).
 * Diturunkan dari PERMISSION, bukan dari nama role, supaya pemetaan hidup di
 * satu tempat (constants/permissions.js) dan default-nya menolak:
 *   OWNER (SANSS) → "OWNER"; HUB_ADMIN → "ADMIN"; HUB_ACCESS → "MEMBER"; selain itu null.
 * @param {{ roles?: string[], role?: string }} user  bentuk JWT/DB: roles[] atau role tunggal
 */
export function hubRoleFor(user) {
  if (!hasPermission(user, P.HUB_ACCESS)) return null;
  if (rolesOf(user).includes("OWNER")) return "OWNER";
  if (hasPermission(user, P.HUB_ADMIN)) return "ADMIN";
  return "MEMBER";
}

/** Alasan pencabutan yang dikenal — selain ini dicatat sebagai "other". */
export const REVOKE_REASONS = Object.freeze(["logout", "deactivated", "role_changed", "admin", "other"]);
export function normalizeRevokeReason(reason) {
  return REVOKE_REASONS.includes(reason) ? reason : "other";
}
