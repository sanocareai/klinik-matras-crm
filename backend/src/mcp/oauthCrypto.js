// Primitif OAuth 2.1 untuk MCP — fungsi MURNI (tidak sentuh Prisma/Express),
// supaya gampang dites tanpa DB (lihat tests/mcp-oauth.test.js).
//
// File terpisah dari oauth.js (yang berisi router) dan security.js (yang
// berisi middleware) khusus untuk MENGHINDARI circular import: security.js
// perlu verifyAccessToken() dari sini, dan oauth.js (router) juga perlu ini
// PLUS beberapa hal dari security.js (rate limiter). Kalau primitif ini
// ditaruh di salah satu dari keduanya, dua-duanya akan saling impor.

import crypto from "crypto";
import jwt from "jsonwebtoken";

// Server ini HANYA melayani Claude — bukan authorization server serba guna.
// Dynamic Client Registration (POST /oauth/register) MENOLAK redirect_uri
// apa pun selain persis ini (lihat docs/connectors/building/authentication
// Anthropic: "register the following redirect URI" untuk Claude.ai web/
// Desktop/mobile/Cowork). Ini yang membuat seluruh alur aman meski client_id
// bisa didaftarkan siapa saja lewat DCR — tidak ada tempat lain code/token
// bisa dikirim.
export const ALLOWED_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

export const OAUTH_SCOPE = "mcp:read";
export const ACCESS_TOKEN_TTL_SEC = 60 * 60; // 1 jam
export const AUTH_CODE_TTL_SEC = 60; // cukup untuk satu round-trip redirect
export const REFRESH_TOKEN_TTL_DAYS = 30;

// Origin publik server ini — dipakai di URL metadata OAuth (issuer,
// authorization_endpoint, dst). Env var eksplisit (bukan dibaca dari Host
// header request) supaya tidak bisa dipalsukan lewat Host header — pola yang
// sama seperti WAHA_BUSINESS_NUMBER/GOOGLE_MAPS_API_KEY: konfigurasi
// eksplisit, bukan ditebak dari request.
export function publicUrl() {
  return (process.env.MCP_PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/+$/, "");
}

// OAuth dianggap "dikonfigurasi" kalau secret access-token-nya sudah diisi.
// Secret ini SENGAJA terpisah dari JWT_SECRET (login CRM) — supaya token MCP
// tidak pernah bisa dipakai silang sebagai token login CRM atau sebaliknya,
// walau dua-duanya sama-sama JWT HS256.
export function oauthConfigured() {
  const s = process.env.MCP_OAUTH_JWT_SECRET;
  return typeof s === "string" && s.trim().length > 0;
}

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─── PKCE (RFC 7636), WAJIB metode S256 ─────────────────────────────────────

export function computeCodeChallengeS256(verifier) {
  return b64url(crypto.createHash("sha256").update(verifier).digest());
}

export function verifyPkce(verifier, expectedChallenge) {
  if (!verifier || !expectedChallenge) return false;
  const actual = computeCodeChallengeS256(verifier);
  const a = Buffer.from(actual);
  const b = Buffer.from(expectedChallenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ─── Token acak (authorization code, client_id, refresh token) ─────────────

export function randomToken(bytesLen = 32) {
  return b64url(crypto.randomBytes(bytesLen));
}

// Refresh token TIDAK disimpan apa adanya di DB (sama seperti password tidak
// disimpan plaintext) — cuma hash-nya. Ini bukan credential rahasia yang
// perlu diperlambat (bcrypt) seperti password manusia; token 256-bit acak
// sudah tidak bisa ditebak, jadi SHA-256 cukup (pola sama seperti hash API
// key di banyak sistem OAuth).
export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ─── Access token (JWT, bukan disimpan di DB — cukup diverifikasi tanda
// tangannya, sama seperti JWT login CRM di middleware/auth.js) ─────────────

// `resource` = resource server yang token ini berlaku (RFC 8707) — jadi
// klaim `aud` JWT. Default "${publicUrl()}/mcp" SENGAJA dipertahankan supaya
// pemanggil lama (SANSS CRM, sebelum multi-resource ada) tidak perlu berubah
// dan token yang sudah beredar untuk mereka tetap tervalidasi identik.
export function signAccessToken({ userId, clientId, resource }) {
  return jwt.sign(
    { clientId, scope: OAUTH_SCOPE },
    process.env.MCP_OAUTH_JWT_SECRET,
    {
      subject: userId,
      issuer: publicUrl(),
      audience: resource || `${publicUrl()}/mcp`,
      expiresIn: ACCESS_TOKEN_TTL_SEC,
    },
  );
}

// Balas payload kalau valid, null kalau tidak (tanda tangan salah,
// kedaluwarsa, issuer/audience tidak cocok, atau secret OAuth belum
// dikonfigurasi sama sekali).
// `resource` = audience yang DIHARAPKAN — router `/mcp` dan `/mcp-hub`
// masing-masing verifikasi dgn audience-nya SENDIRI, supaya token yang
// diterbitkan untuk satu resource TIDAK BISA dipakai ke resource lain
// (cross-resource token confusion). Default "${publicUrl()}/mcp" menjaga
// perilaku lama identik utk pemanggil yang belum menyebut resource.
export function verifyAccessToken(token, resource) {
  if (!oauthConfigured()) return null;
  try {
    const payload = jwt.verify(token, process.env.MCP_OAUTH_JWT_SECRET, {
      issuer: publicUrl(),
      audience: resource || `${publicUrl()}/mcp`,
    });
    return { userId: payload.sub, clientId: payload.clientId, scope: payload.scope };
  } catch {
    return null;
  }
}

// ─── Validasi redirect_uris saat Dynamic Client Registration ───────────────
//
// Kebijakan KETAT: SEMUA nilai di array harus persis ALLOWED_REDIRECT_URI.
// Bukan "salah satu cocok" — kalau client mendaftarkan redirect_uri lain
// SAMA SEKALI ditolak, supaya tidak ada baris client dengan campuran
// redirect_uri sah dan tidak sah yang bisa dieksploitasi belakangan.
export function validateRedirectUris(redirectUris) {
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return { valid: false, reason: "redirect_uris wajib diisi" };
  }
  const semuaCocok = redirectUris.every((u) => u === ALLOWED_REDIRECT_URI);
  if (!semuaCocok) {
    return { valid: false, reason: `redirect_uris hanya boleh berisi "${ALLOWED_REDIRECT_URI}"` };
  }
  return { valid: true };
}
