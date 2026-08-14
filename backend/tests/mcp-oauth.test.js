// Tes primitif OAuth 2.1 untuk MCP (backend/src/mcp/oauthCrypto.js).
// Dijalankan dengan test runner bawaan Node: npm test
//
// SENGAJA tanpa DB — sama seperti authorize.test.js, ini menguji fungsi
// MURNI. Alur penuh (login+password+DB, DCR, redirect) di-smoke-test manual
// lewat curl (lihat docs/MCP-SERVER.md), bukan di sini.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

// node --test menjalankan semua file tes dalam SATU proses — env var yang
// diset di sini bocor ke file tes lain (mis. mcp.test.js) kalau tidak
// dibersihkan. Simpan nilai lama, kembalikan setelah file ini selesai.
const asliSecret = process.env.MCP_OAUTH_JWT_SECRET;
const asliPublicUrl = process.env.MCP_PUBLIC_URL;
process.env.MCP_OAUTH_JWT_SECRET = "rahasia-tes-oauth-mcp";
process.env.MCP_PUBLIC_URL = "http://localhost:4000";
after(() => {
  if (asliSecret === undefined) delete process.env.MCP_OAUTH_JWT_SECRET;
  else process.env.MCP_OAUTH_JWT_SECRET = asliSecret;
  if (asliPublicUrl === undefined) delete process.env.MCP_PUBLIC_URL;
  else process.env.MCP_PUBLIC_URL = asliPublicUrl;
});

const {
  ALLOWED_REDIRECT_URI,
  computeCodeChallengeS256,
  verifyPkce,
  randomToken,
  hashToken,
  signAccessToken,
  verifyAccessToken,
  validateRedirectUris,
  oauthConfigured,
  publicUrl,
} = await import("../src/mcp/oauthCrypto.js");

// ── PKCE (RFC 7636) ─────────────────────────────────────────────────────────
test("computeCodeChallengeS256 cocok dengan contoh resmi RFC 7636 Appendix B", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(computeCodeChallengeS256(verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("verifyPkce: verifier benar diterima, verifier salah ditolak", () => {
  const verifier = randomToken(32);
  const challenge = computeCodeChallengeS256(verifier);
  assert.equal(verifyPkce(verifier, challenge), true);
  assert.equal(verifyPkce("verifier-salah", challenge), false);
  assert.equal(verifyPkce(verifier, "challenge-salah"), false);
  assert.equal(verifyPkce(null, challenge), false);
  assert.equal(verifyPkce(verifier, null), false);
});

// ── Token acak & hash ────────────────────────────────────────────────────────
test("randomToken menghasilkan string unik tiap panggilan", () => {
  const a = randomToken(32);
  const b = randomToken(32);
  assert.notEqual(a, b);
  assert.ok(a.length > 30);
});

test("hashToken deterministik (input sama -> hash sama) dan tidak reversibel secara trivial", () => {
  const t = randomToken(32);
  assert.equal(hashToken(t), hashToken(t));
  assert.notEqual(hashToken(t), t);
});

// ── Access token (JWT) ───────────────────────────────────────────────────────
test("signAccessToken + verifyAccessToken: roundtrip berhasil, klaim sesuai", () => {
  const token = signAccessToken({ userId: "user-1", clientId: "client-1" });
  const payload = verifyAccessToken(token);
  assert.ok(payload);
  assert.equal(payload.userId, "user-1");
  assert.equal(payload.clientId, "client-1");
  assert.equal(payload.scope, "mcp:read");
});

test("verifyAccessToken menolak token kedaluwarsa", () => {
  const expired = jwt.sign(
    { clientId: "client-1", scope: "mcp:read" },
    process.env.MCP_OAUTH_JWT_SECRET,
    { subject: "user-1", issuer: publicUrl(), audience: `${publicUrl()}/mcp`, expiresIn: -10 },
  );
  assert.equal(verifyAccessToken(expired), null);
});

test("verifyAccessToken menolak token dengan secret berbeda (tanda tangan salah)", () => {
  const tokenSecretLain = jwt.sign(
    { clientId: "client-1", scope: "mcp:read" },
    "secret-yang-berbeda",
    { subject: "user-1", issuer: publicUrl(), audience: `${publicUrl()}/mcp`, expiresIn: 3600 },
  );
  assert.equal(verifyAccessToken(tokenSecretLain), null);
});

test("verifyAccessToken menolak token dengan audience/issuer tidak cocok (mis. token login CRM biasa)", () => {
  const tokenAudienceLain = jwt.sign(
    { clientId: "client-1", scope: "mcp:read" },
    process.env.MCP_OAUTH_JWT_SECRET,
    { subject: "user-1", issuer: "https://bukan-server-ini.example", audience: "https://lain.example/mcp", expiresIn: 3600 },
  );
  assert.equal(verifyAccessToken(tokenAudienceLain), null);
});

test("verifyAccessToken null total kalau MCP_OAUTH_JWT_SECRET belum diset (fail-closed)", () => {
  const asli = process.env.MCP_OAUTH_JWT_SECRET;
  const token = signAccessToken({ userId: "user-1", clientId: "client-1" });
  delete process.env.MCP_OAUTH_JWT_SECRET;
  try {
    assert.equal(oauthConfigured(), false);
    assert.equal(verifyAccessToken(token), null);
  } finally {
    process.env.MCP_OAUTH_JWT_SECRET = asli;
  }
});

// ── Validasi redirect_uris (Dynamic Client Registration) ───────────────────
test("validateRedirectUris: hanya menerima persis redirect URI Claude", () => {
  assert.equal(validateRedirectUris([ALLOWED_REDIRECT_URI]).valid, true);
  assert.equal(validateRedirectUris([]).valid, false);
  assert.equal(validateRedirectUris(null).valid, false);
  assert.equal(validateRedirectUris(["https://evil.example/callback"]).valid, false);
  // Satu benar satu tidak -> DITOLAK SELURUHNYA, bukan diterima sebagian.
  assert.equal(validateRedirectUris([ALLOWED_REDIRECT_URI, "https://evil.example/callback"]).valid, false);
});
