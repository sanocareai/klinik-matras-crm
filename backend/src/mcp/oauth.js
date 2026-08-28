// OAuth 2.1 authorization server untuk MCP — HANYA melayani Claude.ai
// (custom connector browser, yang UI-nya cuma punya field OAuth Client
// ID/Secret, tidak ada input header kustom seperti Claude Code/Desktop).
//
// Ini jalur auth KEDUA untuk /mcp, hidup BERDAMPINGAN dengan token statis
// MCP_API_TOKEN (Claude Code) — lihat requireMcpToken di security.js yang
// menerima dua-duanya. Menambah ini TIDAK mengubah cara Claude Code connect.
//
// ⚠️ HANYA user ber-role ADMIN yang boleh login+approve di sini (keputusan
// sadar didiskusikan dengan owner produk): tool MCP membaca SEMUA data
// pelanggan lintas sales, bukan cuma milik sendiri, jadi ini setara dengan
// "siapa yang boleh pegang MCP_API_TOKEN" — sebelumnya cuma admin yang
// pegang token itu.

import express from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { rolesOf } from "../middleware/authorize.js";
import { createRateLimiter, rateLimitKey } from "./security.js";
import {
  ALLOWED_REDIRECT_URI,
  OAUTH_SCOPE,
  ACCESS_TOKEN_TTL_SEC,
  AUTH_CODE_TTL_SEC,
  REFRESH_TOKEN_TTL_DAYS,
  publicUrl,
  computeCodeChallengeS256,
  verifyPkce,
  randomToken,
  hashToken,
  signAccessToken,
  validateRedirectUris,
} from "./oauthCrypto.js";

// --- Multi-resource (RFC 8707) -- SATU authorization server, DUA connector
// MCP yang berbeda (SANSS CRM di /mcp, SANO Hub Analytics di /mcp-hub sejak
// 29 Agt 2026). Admin login SAMA untuk keduanya, tapi access token yang
// diterbitkan untuk satu resource TIDAK BOLEH bisa dipakai ke resource lain
// (lihat oauthCrypto.js, fungsi verifyAccessToken) -- makanya setiap
// authorization code & refresh token MENYIMPAN resource-nya sendiri (kolom
// resource, lihat schema.prisma), bukan cuma dipercaya dari parameter token
// request.
const KNOWN_RESOURCES = {
  "/mcp": "SANSS CRM (data pelanggan, order, pipeline, percakapan - baca-saja)",
  "/mcp-hub": "SANO Hub Analytics (quality score, risk profile, stale lead, gold standard, narasi mingguan - baca-saja)",
};

// resourceParam = nilai mentah query/body resource= dari Claude (URL penuh).
// Absen = default "/mcp" (kompatibilitas mundur -- link lama SANSS yang
// belum pernah menyertakan resource tetap jalan).
function resolveResource(resourceParam) {
  const target = resourceParam ? resourceParam : `${publicUrl()}/mcp`;
  for (const path of Object.keys(KNOWN_RESOURCES)) {
    if (target === `${publicUrl()}${path}`) {
      return { path, url: `${publicUrl()}${path}`, label: KNOWN_RESOURCES[path] };
    }
  }
  return null;
}

// Sama seperti loadRoles() di routes/auth.js (tidak diekspor dari sana, jadi
// diduplikasi di sini) — WAJIB baca dari tabel user_roles (D-010), BUKAN
// cuma User.role tunggal. CLAUDE.md §9 mendokumentasikan bug nyata (D-010)
// akibat kode yang cek `user.role === "ADMIN"` langsung dan mengabaikan role
// yang diberikan lewat halaman "Pengguna & Peran" — jangan mengulang itu.
async function loadRoles(user) {
  const rows = await prisma.userRole.findMany({ where: { userId: user.id }, select: { role: true } });
  const roles = rows.map((r) => r.role);
  return roles.length > 0 ? roles : [user.role];
}

// ─── Halaman login + consent (server-rendered, tanpa build frontend baru) ──
//
// Login DAN consent digabung jadi SATU langkah (bukan 2 layar terpisah) —
// wajar untuk tool internal 2 admin, bukan aplikasi konsumen. Palet warna
// dari CLAUDE.md §10 supaya terasa satu produk dengan CRM, walau ini
// halaman server-rendered terpisah dari SPA React.
function renderLoginPage({ hidden, error, resourceLabel }) {
  const hiddenInputs = Object.entries(hidden)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`)
    .join("\n      ");

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Masuk — Klinik Matras CRM</title>
<style>
  :root {
    --primary: #2563eb; --danger: #dc2626; --bg: #f8fafc; --card-bg: #ffffff;
    --border: #e5e7eb; --text-primary: #111827; --text-secondary: #6b7280;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--bg); font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--text-primary); padding: 16px;
  }
  .card { width: 100%; max-width: 380px; background: var(--card-bg); border: 1px solid var(--border);
    border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { color: var(--text-secondary); font-size: 14px; margin: 0 0 24px; line-height: 1.5; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
  input[type=email], input[type=password] {
    width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px;
  }
  button { width: 100%; margin-top: 20px; padding: 11px; background: var(--primary); color: #fff; border: none;
    border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:hover { opacity: .92; }
  .error { background: #fef2f2; color: var(--danger); border: 1px solid #fecaca; border-radius: 8px;
    padding: 10px 12px; font-size: 13px; margin-bottom: 16px; }
  .badge { display: inline-block; font-size: 11px; font-weight: 600; color: var(--primary); background: #eff6ff;
    padding: 3px 8px; border-radius: 999px; margin-bottom: 12px; }
</style>
</head>
<body>
  <div class="card">
    <span class="badge">Klinik Matras CRM</span>
    <h1>Izinkan akses Claude (baca-saja)</h1>
    <p class="sub">Masuk sebagai Admin untuk mengizinkan Claude membaca:<br>
      <strong>${escapeHtml(resourceLabel || "data CRM")}</strong>.<br>
      Claude TIDAK bisa mengubah data apa pun lewat koneksi ini.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <form method="POST">
      ${hiddenInputs}
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required autofocus>
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required>
      <button type="submit">Masuk &amp; Izinkan</button>
    </form>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function errorPage(title, detail) {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 16px;color:#111827">
<h2 style="color:#dc2626">${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p></body></html>`;
}

// ─── /.well-known/* — resource & authorization server metadata ─────────────

export const wellKnownRouter = express.Router();

// RFC 9728 — memberi tahu Claude DI MANA authorization server-nya, dipakai
// sebagai target `resource_metadata` di header WWW-Authenticate 401 /mcp
// (lihat security.js).
wellKnownRouter.get("/.well-known/oauth-protected-resource", (req, res) => {
  res.json({
    resource: `${publicUrl()}/mcp`,
    authorization_servers: [publicUrl()],
  });
});

// SANO Hub Analytics (29 Agt 2026) -- resource TERPISAH, authorization
// server SAMA (lihat KNOWN_RESOURCES di atas). Path well-known ini SENGAJA
// beda dari yang di atas (bukan query param) supaya masing-masing 401 bisa
// menunjuk resource_metadata yang benar-benar spesifik ke resource-nya.
wellKnownRouter.get("/.well-known/oauth-protected-resource/mcp-hub", (req, res) => {
  res.json({
    resource: `${publicUrl()}/mcp-hub`,
    authorization_servers: [publicUrl()],
  });
});

// RFC 8414 — metadata authorization server. PENTING: token_endpoint_auth_methods_supported
// HARUS ["none"] (public client, PKCE) — kalau tidak, sesuai docs Anthropic,
// Claude tidak akan memilih CIMD dan mencoba DCR seperti biasa, yang memang
// jalur yang kita dukung di sini.
wellKnownRouter.get("/.well-known/oauth-authorization-server", (req, res) => {
  const base = publicUrl();
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [OAUTH_SCOPE],
  });
});

// ─── /oauth/* — register, authorize, token ──────────────────────────────────

export const mcpOAuthRouter = express.Router();
mcpOAuthRouter.use(express.urlencoded({ extended: false }));

// Login form ke /oauth/authorize adalah permukaan yang menghadap internet
// dan menerima email+password — beri limit ketat (beda dari /mcp yang
// sudah dijaga token). 10/menit per IP cukup untuk pemakaian wajar (2 admin)
// tapi memperlambat brute-force secara berarti.
const oauthLoginLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

// RFC 7591 — Dynamic Client Registration. Endpoint ini efektif cuma pernah
// dipakai Claude, karena redirect_uris SELAIN callback Claude ditolak keras
// (validateRedirectUris) — lihat komentar ALLOWED_REDIRECT_URI di oauthCrypto.js.
mcpOAuthRouter.post("/oauth/register", express.json(), async (req, res) => {
  const { redirect_uris } = req.body || {};
  const check = validateRedirectUris(redirect_uris);
  if (!check.valid) {
    return res.status(400).json({ error: "invalid_redirect_uri", error_description: check.reason });
  }

  const clientId = randomToken(16);
  await prisma.mcpOAuthClient.create({
    data: { clientId, redirectUris: [ALLOWED_REDIRECT_URI] },
  });

  res.status(201).json({
    client_id: clientId,
    redirect_uris: [ALLOWED_REDIRECT_URI],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });
});

// Validasi bersama dipakai GET (tampilkan form) & POST (proses login) —
// supaya request yang parameternya dirusak tidak pernah sampai ke redirect.
async function validateAuthorizeParams(q) {
  const { response_type, client_id, redirect_uri, code_challenge, code_challenge_method, resource } = q;

  if (response_type !== "code") return { ok: false, msg: "response_type harus 'code'" };
  if (code_challenge_method !== "S256") return { ok: false, msg: "code_challenge_method harus 'S256'" };
  if (!code_challenge) return { ok: false, msg: "code_challenge wajib diisi" };
  if (redirect_uri !== ALLOWED_REDIRECT_URI) return { ok: false, msg: "redirect_uri tidak dikenali" };

  // resource (RFC 8707) -- WAJIB dikenali (lihat KNOWN_RESOURCES). Absen =
  // default /mcp untuk kompatibilitas mundur (lihat resolveResource()).
  const resolvedResource = resolveResource(resource);
  if (!resolvedResource) return { ok: false, msg: "resource tidak dikenali server ini" };

  const client = await prisma.mcpOAuthClient.findUnique({ where: { clientId: client_id } });
  if (!client) return { ok: false, msg: "client_id tidak dikenali — coba tambah ulang konektornya di Claude" };

  return { ok: true, resource: resolvedResource };
}

mcpOAuthRouter.get("/oauth/authorize", async (req, res) => {
  const check = await validateAuthorizeParams(req.query);
  if (!check.ok) {
    // TIDAK redirect di sini — parameter belum tervalidasi berarti
    // redirect_uri juga belum terpercaya. Tampilkan error di halaman kita.
    return res.status(400).send(errorPage("Permintaan tidak valid", check.msg));
  }

  const { response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method, scope } = req.query;
  res.send(renderLoginPage({
    hidden: {
      response_type, client_id, redirect_uri, state: state || "", code_challenge, code_challenge_method,
      scope: scope || OAUTH_SCOPE,
      resource: check.resource.url,
    },
    resourceLabel: check.resource.label,
  }));
});

mcpOAuthRouter.post("/oauth/authorize", async (req, res) => {
  const limitKey = rateLimitKey(req);
  if (!oauthLoginLimiter(limitKey).allowed) {
    return res.status(429).send(errorPage("Terlalu banyak percobaan", "Coba lagi dalam beberapa menit."));
  }

  const check = await validateAuthorizeParams(req.body);
  if (!check.ok) {
    return res.status(400).send(errorPage("Permintaan tidak valid", check.msg));
  }

  const { email, password, response_type, client_id, redirect_uri, state, code_challenge, scope } = req.body;
  const hidden = {
    response_type, client_id, redirect_uri, state: state || "", code_challenge, code_challenge_method: "S256",
    scope: scope || OAUTH_SCOPE,
    resource: check.resource.url,
  };
  const resourceLabel = check.resource.label;

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user && (await bcrypt.compare(password, user.passwordHash));
  if (!valid) {
    return res.status(401).send(renderLoginPage({ hidden, error: "Email atau password salah.", resourceLabel }));
  }
  if (user.active === false) {
    return res.status(403).send(renderLoginPage({ hidden, error: "Akun ini sudah dinonaktifkan.", resourceLabel }));
  }

  const roles = await loadRoles(user);
  if (!rolesOf({ roles }).includes("ADMIN")) {
    return res.status(403).send(renderLoginPage({
      hidden,
      error: "Hanya Admin yang bisa mengizinkan koneksi Claude ke CRM ini.",
      resourceLabel,
    }));
  }

  const code = randomToken(32);
  await prisma.mcpAuthorizationCode.create({
    data: {
      code,
      clientId: client_id,
      userId: user.id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      scope: scope || OAUTH_SCOPE,
      resource: check.resource.url,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SEC * 1000),
    },
  });

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);
  res.redirect(302, redirectUrl.toString());
});

// RFC 6749 §4.1.3 / §6 — token endpoint. Dua grant_type: authorization_code
// (tukar code pertama kali) dan refresh_token (perpanjang tanpa login ulang).
mcpOAuthRouter.post("/oauth/token", async (req, res) => {
  const { grant_type } = req.body;

  if (grant_type === "authorization_code") {
    return handleAuthorizationCodeGrant(req, res);
  }
  if (grant_type === "refresh_token") {
    return handleRefreshTokenGrant(req, res);
  }
  return res.status(400).json({ error: "unsupported_grant_type" });
});

async function handleAuthorizationCodeGrant(req, res) {
  const { code, client_id, redirect_uri, code_verifier } = req.body;

  const row = code
    ? await prisma.mcpAuthorizationCode.findUnique({ where: { code } })
    : null;

  const cocok =
    row &&
    !row.usedAt &&
    row.expiresAt > new Date() &&
    row.clientId === client_id &&
    row.redirectUri === redirect_uri &&
    verifyPkce(code_verifier, row.codeChallenge);

  if (!cocok) {
    // RFC 6749 §5.2: invalid_grant untuk code salah/kedaluwarsa/dipakai lagi/
    // PKCE tidak cocok — generik SENGAJA, jangan bocorkan alasan spesifiknya.
    return res.status(400).json({ error: "invalid_grant" });
  }

  // Sekali pakai — tandai SEBELUM mengeluarkan token, bukan sesudah, supaya
  // dua request paralel dengan code yang sama tidak dua-duanya lolos.
  await prisma.mcpAuthorizationCode.update({ where: { code }, data: { usedAt: new Date() } });

  const { accessToken, refreshToken } = await issueTokenPair({ userId: row.userId, clientId: row.clientId, scope: row.scope, resource: row.resource });
  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: refreshToken,
    scope: row.scope,
  });
}

async function handleRefreshTokenGrant(req, res) {
  const { refresh_token, client_id } = req.body;
  if (!refresh_token) return res.status(400).json({ error: "invalid_grant" });

  const tokenHash = hashToken(refresh_token);
  const row = await prisma.mcpRefreshToken.findUnique({ where: { tokenHash } });

  const cocok = row && !row.revokedAt && row.expiresAt > new Date() && row.clientId === client_id;
  if (!cocok) {
    return res.status(400).json({ error: "invalid_grant" });
  }

  // ROTASI wajib (public client, PKCE) — token lama langsung mati begitu
  // dipakai. Reuse token yang sudah di-revoke setelah ini adalah sinyal
  // token itu dicuri; kita tidak membangun deteksi pencurian otomatis untuk
  // skala 2 admin, tapi rotasi sendiri sudah menutup celah replay biasa.
  await prisma.mcpRefreshToken.update({ where: { tokenHash }, data: { revokedAt: new Date() } });

  const { accessToken, refreshToken } = await issueTokenPair({ userId: row.userId, clientId: row.clientId, scope: row.scope, resource: row.resource });
  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: refreshToken,
    scope: row.scope,
  });
}

async function issueTokenPair({ userId, clientId, scope, resource }) {
  const accessToken = signAccessToken({ userId, clientId, resource });
  const refreshToken = randomToken(32);
  await prisma.mcpRefreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      clientId,
      userId,
      scope,
      resource,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    },
  });
  return { accessToken, refreshToken };
}
