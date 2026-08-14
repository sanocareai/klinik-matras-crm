// Lapisan keamanan MCP server — auth token, rate limit, masking nomor HP.
//
// Semua fungsi di sini SENGAJA murni/tanpa DB supaya bisa dites tanpa Postgres
// (lihat tests/mcp.test.js). Jangan tambahkan query Prisma di file ini.
// verifyAccessToken/oauthConfigured dari oauthCrypto.js juga murni (JWT saja,
// tanpa DB) — makanya aman diimpor di sini tanpa melanggar aturan itu.

import crypto from "crypto";
import { verifyAccessToken, oauthConfigured, publicUrl } from "./oauthCrypto.js";

// ─── MASKING NOMOR TELEPON ──────────────────────────────────────────────────
//
// KENAPA: nomor WhatsApp pelanggan adalah PII paling sensitif di CRM ini —
// kalau bocor, seseorang bisa langsung menghubungi pelanggan Klinik Matras.
// MCP dipakai oleh LLM eksternal (Claude.ai), jadi DEFAULT-nya nomor selalu
// disamarkan. Tool punya param `unmask` untuk kasus yang memang butuh nomor
// penuh (mis. sales minta nomor untuk follow-up) — itu keputusan sadar
// pemanggil, bukan default.
//
// Format: 3 digit depan + **** + 4 digit belakang → 628****0076
export function maskPhone(phone, unmask = false) {
  if (!phone) return null;
  if (unmask) return phone;
  // Nomor terlalu pendek untuk disamarkan sebagian → samarkan total.
  if (phone.length <= 7) return "*".repeat(phone.length);
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

// Email juga PII. Disamarkan dengan aturan yang sama: awal + domain tetap
// terbaca (berguna untuk membedakan orang), bagian tengah disembunyikan.
export function maskEmail(email, unmask = false) {
  if (!email) return null;
  if (unmask) return email;
  const at = email.indexOf("@");
  if (at < 1) return "****";
  const nama = email.slice(0, at);
  const domain = email.slice(at);
  return `${nama.slice(0, 2)}****${domain}`;
}

// ─── AUTH: BEARER TOKEN DARI ENV ────────────────────────────────────────────
//
// SENGAJA BUKAN JWT user. Alasannya: MCP bukan "user" — dia integrasi
// mesin-ke-mesin yang aksesnya lintas seluruh data (bukan per-role), dan JWT
// user berumur 7 hari sehingga tidak cocok untuk koneksi yang dipasang sekali
// lalu ditinggal. Token ini dicabut/dirotasi dengan mengganti MCP_API_TOKEN
// di .env lalu restart backend.
export function mcpStaticTokenConfigured() {
  const t = process.env.MCP_API_TOKEN;
  return typeof t === "string" && t.trim().length > 0;
}

// "Aktif" sekarang berarti SALAH SATU dari dua jalur auth terisi: token
// statis (Claude Code/Desktop) ATAU secret OAuth (claude.ai browser, lihat
// oauth.js). Fail-closed tetap berlaku — kalau DUA-DUANYA kosong, /mcp mati
// total (503), bukan diam-diam terbuka.
export function mcpAuthConfigured() {
  return mcpStaticTokenConfigured() || oauthConfigured();
}

// Perbandingan konstan-waktu supaya panjang/isi token tidak bisa ditebak dari
// selisih waktu respons. `timingSafeEqual` melempar kalau panjang beda, jadi
// dua-duanya di-hash dulu ke panjang tetap.
function tokenCocok(diberikan, benar) {
  const a = crypto.createHash("sha256").update(String(diberikan)).digest();
  const b = crypto.createHash("sha256").update(String(benar)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Header WWW-Authenticate 401 — SELALU sertakan `resource_metadata` kalau
// OAuth dikonfigurasi, supaya Claude.ai browser bisa mulai discovery flow-nya
// (lihat docs/connectors/building/authentication Anthropic: "Always return
// a 401 with a WWW-Authenticate header whose resource_metadata parameter
// points at your protected resource metadata document"). Claude Code/Desktop
// yang sudah kirim token statis tidak pernah melihat header ini sama sekali.
function setWwwAuthenticate(res) {
  const params = ['realm="klinik-matras-mcp"'];
  if (oauthConfigured()) {
    params.push(`resource_metadata="${publicUrl()}/.well-known/oauth-protected-resource"`);
  }
  res.set("WWW-Authenticate", `Bearer ${params.join(", ")}`);
}

export function requireMcpToken(req, res, next) {
  // Kalau tidak ada satu pun jalur auth diisi di .env, MCP dianggap MATI —
  // bukan "terbuka". Fail-closed: lupa mengisi env tidak boleh berarti data
  // CRM terbuka bebas.
  if (!mcpAuthConfigured()) {
    return res.status(503).json({
      error: "MCP server nonaktif — isi MCP_API_TOKEN atau MCP_OAUTH_JWT_SECRET di .env backend",
    });
  }

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (token && mcpStaticTokenConfigured() && tokenCocok(token, process.env.MCP_API_TOKEN.trim())) {
    req.mcpAuth = { type: "static" };
    return next();
  }

  if (token) {
    const payload = verifyAccessToken(token);
    if (payload) {
      req.mcpAuth = { type: "oauth", userId: payload.userId, clientId: payload.clientId };
      return next();
    }
  }

  // WWW-Authenticate wajib menurut RFC 6750 untuk 401 — klien MCP memakai
  // ini untuk membedakan "token salah" dari "endpoint tidak ada", dan
  // claude.ai browser memakai resource_metadata di dalamnya untuk memulai
  // OAuth discovery.
  setWwwAuthenticate(res);
  return res.status(401).json({ error: "Token MCP tidak valid" });
}

// ─── RATE LIMIT ─────────────────────────────────────────────────────────────
//
// Fixed window sederhana di memori. TIDAK pakai library baru (CLAUDE.md §3
// mengunci stack) dan tidak perlu Redis — backend ini satu proses tunggal di
// satu VPS. Kalau suatu hari backend di-scale ke >1 instance, hitungannya jadi
// per-instance; ganti ke store bersama saat itu tiba, jangan sekarang.
export const MCP_RATE_LIMIT = Number(process.env.MCP_RATE_LIMIT_PER_MIN || 60);
const WINDOW_MS = 60_000;

export function createRateLimiter({ limit = MCP_RATE_LIMIT, windowMs = WINDOW_MS } = {}) {
  const hits = new Map(); // key → { count, resetAt }

  return function cek(key, now = Date.now()) {
    // Buang entri kedaluwarsa supaya Map tidak tumbuh selamanya.
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);

    const entri = hits.get(key);
    if (!entri || entri.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: limit - 1, retryAfter: 0 };
    }

    entri.count += 1;
    if (entri.count > limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil((entri.resetAt - now) / 1000),
      };
    }
    return { allowed: true, remaining: limit - entri.count, retryAfter: 0 };
  };
}

// Kunci rate limit = IP pemanggil. Backend duduk di belakang nginx, jadi
// `req.ip` selalu 127.0.0.1 — IP asli ada di X-Forwarded-For yang diisi nginx.
// Header ini bisa dipalsukan kalau backend diekspos langsung ke internet;
// di arsitektur kita port 4000 hanya bisa diakses lewat nginx (lihat CLAUDE.md
// §4), jadi aman. Ini rate limit anti-penyalahgunaan, bukan kontrol akses —
// kontrol akses ada di requireMcpToken.
export function rateLimitKey(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || "unknown";
}

const cekRate = createRateLimiter();

export function mcpRateLimit(req, res, next) {
  const { allowed, remaining, retryAfter } = cekRate(rateLimitKey(req));
  res.set("X-RateLimit-Limit", String(MCP_RATE_LIMIT));
  res.set("X-RateLimit-Remaining", String(remaining));
  if (!allowed) {
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: `Terlalu banyak permintaan. Batas ${MCP_RATE_LIMIT} request/menit.`,
    });
  }
  next();
}