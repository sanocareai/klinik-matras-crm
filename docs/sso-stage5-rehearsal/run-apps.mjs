// Rehearsal staging SSO Task & Meeting (D-200) — start/stop kedua app
// SUNGGUHAN di belakang reverse proxy TLS lokal (lihat setup-proxy.mjs). DB
// staging dibuat lewat backend/scripts/stage5-rehearsal/staging-db.mjs di
// masing-masing repo (lihat rehearsal.mjs).
//
// Semua path/port/DB di bawah bisa ditimpa lewat env var — TIDAK ADA
// rahasia tertanam (token/secret dibuat acak tiap jalan).
//
// SANSS_DIR default dihitung RELATIF terhadap file ini (repo SANSS ini
// sendiri — portable lintas clone/worktree). HUB_DIR TIDAK bisa ditebak
// (repo terpisah) — isi STAGE5_HUB_DIR kalau lokasinya bukan ../../../SANO-HUB.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSanssDir = path.resolve(__dirname, "../../backend");
// HUB hidup di repo TERPISAH — lokasinya tidak bisa ditebak dari sini.
// Nilai di bawah cocok untuk mesin dev tempat skrip ini pertama dibuat;
// di mesin lain SELALU isi STAGE5_HUB_DIR.
const defaultHubDir = "C:\\Users\\rudya\\SANO-HUB";

export const SANSS_DIR = process.env.STAGE5_SANSS_DIR || defaultSanssDir;
export const HUB_DIR = process.env.STAGE5_HUB_DIR || defaultHubDir;
if (!fs.existsSync(path.join(HUB_DIR, "package.json"))) {
  console.error(
    `[stage5] HUB_DIR="${HUB_DIR}" sepertinya bukan checkout SANO-HUB (tidak ada package.json). ` +
      `Set env STAGE5_HUB_DIR ke lokasi yang benar.`,
  );
}
export const SANSS_PORT = Number(process.env.STAGE5_SANSS_PORT || 41800); // backend langsung (internal)
export const HUB_PORT = Number(process.env.STAGE5_HUB_PORT || 31800); // backend langsung (internal)
// Same-domain embedding (Okt 2026) — SATU origin publik, bukan dua: HUB di
// /workspace (basePath), SANSS di semua jalur lain, keduanya lewat proxy+TLS
// yang SAMA (lihat setup-proxy.mjs). HUB_PUBLIC lama dihapus — jangan
// tambahkan lagi; setiap kode yang perlu URL publik HUB memakai
// `${PUBLIC}/workspace` secara eksplisit (lihat hubEnv/sanssEnv di bawah).
export const PUBLIC = process.env.STAGE5_PUBLIC || "https://localhost:8443";
export const SANSS_DB = process.env.STAGE5_SANSS_DB || "postgresql://klinik:KlinikMatras2026Aman@localhost:5432/klinik_matras_staging_s5";
export const HUB_DB = process.env.STAGE5_HUB_DB || "postgresql://sano:sano_local_dev@127.0.0.1:5434/sano_hub_staging_s5?schema=public";
// Diisi oleh run.mjs setelah tmp-staging-db.mjs migrate (HUB_WORKSPACE_ID
// baru setiap kali database staging dibuat ulang — TIDAK pernah tetap).
export let HUB_WORKSPACE_ID = process.env.STAGE5_HUB_WORKSPACE_ID || "";
export function setHubWorkspaceId(id) {
  HUB_WORKSPACE_ID = id;
}
export const SHARED_TOKEN = crypto.randomBytes(48).toString("base64url");
export const JWT_SECRET = crypto.randomBytes(32).toString("hex");
export const AUTH_SECRET = crypto.randomBytes(32).toString("base64");
export const TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");

const procs = {};
export function startProc(key, cmd, args, cwd, env) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => (out += d.toString()));
  p.stderr.on("data", (d) => (out += d.toString()));
  p.__log = () => out;
  procs[key] = p;
  return p;
}
export function stopProc(key) {
  const p = procs[key];
  if (!p || p.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    p.once("exit", resolve);
    p.kill("SIGTERM");
    setTimeout(() => {
      if (p.exitCode === null) p.kill("SIGKILL");
    }, 4000);
  });
}
export async function waitReady(url, timeoutMs = 45000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status < 500) return true;
    } catch {}
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
}

function sanssEnv(overrides = {}) {
  const base = fs.readFileSync(`${SANSS_DIR}\\.env`, "utf8");
  const parsed = {};
  for (const line of base.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) parsed[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return {
    ...parsed,
    // P12A (stagingGuard.js) — forward-port Stage 6: main sekarang punya un
    // pagar staging formal (DB production ditolak keras, egress non-privat
    // diblokir, kredensial eksternal WAHA/SMTP/FCM/Maps/AI dinetralkan dari
    // process.env, job latar dimatikan). SANSS_DB sudah bertanda "staging"
    // (lolos pagar nama-DB) dan panggilan HUB<->SANSS di rehearsal ini semua
    // loopback (lolos egress guard) — jadi menyalakan ini murni tambahan
    // keamanan: kredensial WAHA/SMTP/Maps/AI ASLI yang ikut terbaca dari
    // .env lewat `...parsed` di atas dinetralkan SEBELUM modul lain
    // membacanya, bukan cuma WAHA_API_KEY yang ditimpa manual di bawah.
    APP_ENV: "staging",
    DATABASE_URL: SANSS_DB,
    PORT: String(SANSS_PORT),
    JWT_SECRET,
    HUB_SSO_ENABLED: overrides.HUB_SSO_ENABLED ?? "false",
    HUB_BASE_URL: `${PUBLIC}/workspace`, // publik + basePath — dipakai bikin postUrl ke browser
    HUB_INTERNAL_URL: overrides.HUB_INTERNAL_URL ?? `http://127.0.0.1:${HUB_PORT}/workspace`, // langsung, BUKAN lewat nginx; basePath tetap berlaku (next.config.ts)
    HUB_SERVICE_TOKEN: SHARED_TOKEN,
    WAHA_API_KEY: "",
    NODE_ENV: "production",
  };
}
export async function startSanss(overrides = {}) {
  startProc("sanss", "node", ["src/index.js"], SANSS_DIR, sanssEnv(overrides));
  const ok = await waitReady(`http://127.0.0.1:${SANSS_PORT}/api/auth/login`, 30000);
  if (!ok) console.error("SANSS log:", procs.sanss.__log().slice(-2000));
  return ok;
}

function hubEnv(overrides = {}) {
  return {
    DATABASE_URL: HUB_DB,
    DIRECT_DATABASE_URL: HUB_DB,
    PORT: String(HUB_PORT),
    HOSTNAME: "0.0.0.0",
    NODE_ENV: "production",
    AUTH_SECRET,
    // Harus origin POLOS, TANPA /workspace — dikonfirmasi lewat
    // verify:prod-boot (HUB repo): Auth.js memperlakukan path pada AUTH_URL
    // sebagai basePath Auth.js SENDIRI, yang balik membuat setiap aksi
    // Auth.js (providers/session/signin) 400 karena Next.js SUDAH memotong
    // /workspace dari request sebelum sampai ke Route Handler — dua lapis
    // basePath yang tidak boleh ditumpuk. basePath Next.js (next.config.ts)
    // sudah cukup; AUTH_URL tetap origin saja, skema https literal
    // (keputusan secure-cookie Auth.js, lihat Tahap 4).
    AUTH_URL: PUBLIC,
    NEXTAUTH_URL: PUBLIC,
    NEXT_PUBLIC_APP_URL: PUBLIC,
    HUB_WORKSPACE_ID,
    MOCK_INTEGRATIONS: "true",
    TOKEN_ENCRYPTION_KEY: TOKEN_ENC_KEY,
    DEV_AUTH_EMAIL: "",
    SANSS_SSO_ENABLED: overrides.SANSS_SSO_ENABLED ?? "false",
    SANSS_INTERNAL_URL: `http://127.0.0.1:${SANSS_PORT}`, // langsung, BUKAN lewat nginx; SANSS tanpa basePath, tetap origin saja
    SANSS_SERVICE_TOKEN: SHARED_TOKEN,
    SANSS_PUBLIC_ORIGIN: PUBLIC,
  };
}
export async function startHub(overrides = {}) {
  startProc("hub", "node", ["server.js"], `${HUB_DIR}\\.next\\standalone`, hubEnv(overrides));
  // /workspace, bukan "/" — basePath membuat setiap jalur TANPA prefiks ini 404.
  const ok = await waitReady(`http://127.0.0.1:${HUB_PORT}/workspace/login`, 45000);
  if (!ok) console.error("HUB log:", procs.hub.__log().slice(-2000));
  return ok;
}

export function getLog(key) {
  return procs[key]?.__log?.() ?? "(proses tidak ditemukan)";
}

export async function stopAll() {
  await stopProc("sanss");
  await stopProc("hub");
}
