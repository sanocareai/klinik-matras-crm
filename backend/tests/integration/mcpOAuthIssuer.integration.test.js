import "./setup/env.js";
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import express from "express";
import { testPrisma, truncateAll } from "./setup/testDb.js";

// Issuer production persis (RFC 9207: `iss` HARUS sama dengan `issuer` metadata).
const ISSUER = "https://app.sanomatrassehat.com";
const RESOURCE = `${ISSUER}/mcp-chatgpt`;
const STABLE = "https://chatgpt.com/connector_platform_oauth_redirect";
const PASSWORD = "password-tes-oauth-iss";

process.env.MCP_OAUTH_JWT_SECRET = "integration-only-oauth-iss-secret";
process.env.MCP_PUBLIC_URL = ISSUER;
delete process.env.MCP_CHATGPT_REDIRECT_URIS;

const { wellKnownRouter, mcpOAuthRouter } = await import("../../src/mcp/oauth.js");
const { chatGptMcpRouter } = await import("../../src/mcp/chatgptPlugin.js");
const { computeCodeChallengeS256, verifyAccessToken, randomToken } = await import("../../src/mcp/oauthCrypto.js");

let server;
let base;
const emailAdmin = `admin-iss-${Date.now()}@example.test`;
const emailBukanAdmin = `gudang-iss-${Date.now()}@example.test`;

function parseMcp(text) {
  const line = text.split("\n").find((value) => value.startsWith("data:"));
  return JSON.parse((line || text).replace(/^data:\s*/, ""));
}

async function daftarClient(redirectUris) {
  const res = await fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: redirectUris }),
  });
  return { res, body: await res.json() };
}

function formAuthorize({ clientId, redirectUri, state, challenge, email = emailAdmin, password = PASSWORD, resource = RESOURCE }) {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "mcp:read",
    resource,
    email,
    password,
  });
  if (state !== undefined) p.set("state", state);
  return p;
}

async function postAuthorize(params) {
  return fetch(`${base}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    redirect: "manual",
  });
}

test.before(async () => {
  await truncateAll();
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const admin = await testPrisma.user.create({ data: { name: "Admin OAuth ISS", email: emailAdmin, passwordHash, role: "ADMIN" } });
  await testPrisma.userRole.create({ data: { userId: admin.id, role: "ADMIN" } });
  await testPrisma.user.create({ data: { name: "Gudang OAuth ISS", email: emailBukanAdmin, passwordHash, role: "WAREHOUSE" } });

  const app = express();
  app.use(express.json());
  app.use(wellKnownRouter);
  app.use(mcpOAuthRouter);
  app.use("/mcp-chatgpt", chatGptMcpRouter);
  // Meniru catch-all SPA produksi (index.js: app.get("*")): jawaban HTML 200 untuk path tak dikenal.
  app.get("*", (_req, res) => res.status(200).type("html").send("<!doctype html><html><body>SPA React</body></html>"));
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  delete process.env.MCP_CHATGPT_REDIRECT_URIS;
  await truncateAll();
  await new Promise((resolve) => server.close(resolve));
  await testPrisma.$disconnect();
});

test("metadata authorization server mengiklankan dukungan iss (RFC 9207) dengan issuer yang sama", async () => {
  const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
  assert.equal(res.status, 200);
  const meta = await res.json();
  assert.equal(meta.authorization_response_iss_parameter_supported, true);
  assert.equal(meta.issuer, ISSUER);
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(meta.token_endpoint_auth_methods_supported, ["none"]);
  assert.deepEqual(meta.scopes_supported, ["mcp:read"]);
  assert.equal(meta.registration_endpoint, `${ISSUER}/oauth/register`);
});

test("openid-configuration bukan HTML dan tidak mengiklankan OIDC: 404 JSON", async () => {
  for (const path of ["/.well-known/openid-configuration", "/.well-known/openid-configuration/mcp-chatgpt"]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 404, path);
    assert.match(res.headers.get("content-type") || "", /application\/json/, path);
    const body = await res.json();
    assert.equal(body.error, "not_found");
    assert.equal(body.issuer, undefined);
    assert.equal(body.authorization_endpoint, undefined);
  }
  // Pembanding: path tak dikenal lain TETAP jatuh ke SPA — hanya OIDC yang dirapikan.
  const spa = await fetch(`${base}/.well-known/entah-apa`);
  assert.match(spa.headers.get("content-type") || "", /text\/html/);
});

test("DCR menerima callback stabil ChatGPT, menolak URI asing dan mirip-mirip (exact-match, tanpa wildcard)", async () => {
  const ok = await daftarClient([STABLE]);
  assert.equal(ok.res.status, 201);
  assert.deepEqual(ok.body.redirect_uris, [STABLE]);

  const ditolak = [
    "https://evil.example/callback",
    `${STABLE}/`,
    `${STABLE}?x=1`,
    `${STABLE}/evil`,
    "http://chatgpt.com/connector_platform_oauth_redirect",
    "https://CHATGPT.com/connector_platform_oauth_redirect",
    "https://chatgpt.com/connector/oauth/abc123",
    "https://chatgpt.com/*",
    "https://*.chatgpt.com/connector_platform_oauth_redirect",
  ];
  for (const uri of ditolak) {
    const r = await daftarClient([uri]);
    assert.equal(r.res.status, 400, uri);
    assert.equal(r.body.error, "invalid_redirect_uri", uri);
  }
  // Satu sah + satu asing -> seluruh registrasi ditolak.
  const campur = await daftarClient([STABLE, "https://evil.example/callback"]);
  assert.equal(campur.res.status, 400);
});

test("alur penuh ADMIN: redirect sukses memuat code, state yang sama, dan iss; token hanya untuk /mcp-chatgpt dengan enam tool", async () => {
  const { body: client } = await daftarClient([STABLE]);
  const verifier = randomToken(32);
  const challenge = computeCodeChallengeS256(verifier);
  const state = "s t&a=t/e?é#1+2";

  const page = await fetch(`${base}/oauth/authorize?` + new URLSearchParams({
    response_type: "code", client_id: client.client_id, redirect_uri: STABLE,
    code_challenge: challenge, code_challenge_method: "S256", scope: "mcp:read", resource: RESOURCE, state,
  }));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Masuk &amp; Izinkan/);

  const res = await postAuthorize(formAuthorize({ clientId: client.client_id, redirectUri: STABLE, state, challenge }));
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get("location"));
  assert.equal(`${location.origin}${location.pathname}`, STABLE);
  assert.deepEqual([...location.searchParams.keys()].sort(), ["code", "iss", "state"]);
  assert.equal(location.searchParams.get("iss"), ISSUER);
  assert.equal(location.searchParams.get("state"), state);
  assert.ok(location.searchParams.get("code").length >= 32);
  // Encoding query aman: nilai mentah state tidak boleh muncul apa adanya.
  assert.ok(!res.headers.get("location").includes(state));

  const tokenRes = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code: location.searchParams.get("code"),
      client_id: client.client_id, redirect_uri: STABLE, code_verifier: verifier,
    }).toString(),
  });
  assert.equal(tokenRes.status, 200);
  const tok = await tokenRes.json();
  assert.equal(tok.token_type, "Bearer");
  assert.equal(tok.scope, "mcp:read");

  const payload = verifyAccessToken(tok.access_token, RESOURCE);
  assert.ok(payload, "token harus valid untuk audience /mcp-chatgpt");
  assert.equal(payload.scope, "mcp:read");
  assert.equal(verifyAccessToken(tok.access_token, `${ISSUER}/mcp`), null, "token tidak boleh berlaku untuk /mcp");
  assert.equal(verifyAccessToken(tok.access_token, `${ISSUER}/mcp-hub`), null, "token tidak boleh berlaku untuk /mcp-hub");

  const list = await fetch(`${base}/mcp-chatgpt`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(list.status, 200);
  const tools = parseMcp(await list.text()).result.tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "sales_daftar_produk", "sales_performa_iklan", "sales_ringkasan_penjualan",
    "sales_ringkasan_pipeline", "sales_ringkasan_sumber_lead", "sales_tren_traffic_lead",
  ]);
  for (const t of tools) {
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.equal(t.annotations.destructiveHint, false, t.name);
    assert.equal("unmask" in (t.inputSchema.properties || {}), false, t.name);
  }

  // Kode otorisasi sekali pakai: penukaran kedua ditolak.
  const ulang = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code: location.searchParams.get("code"),
      client_id: client.client_id, redirect_uri: STABLE, code_verifier: verifier,
    }).toString(),
  });
  assert.equal(ulang.status, 400);
});

test("tanpa state: redirect hanya memuat code dan iss", async () => {
  const { body: client } = await daftarClient([STABLE]);
  const res = await postAuthorize(formAuthorize({ clientId: client.client_id, redirectUri: STABLE, challenge: computeCodeChallengeS256(randomToken(32)) }));
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get("location"));
  assert.deepEqual([...location.searchParams.keys()].sort(), ["code", "iss"]);
  assert.equal(location.searchParams.get("iss"), ISSUER);
});

test("batasan tetap: bukan-ADMIN 403, password salah 401, redirect asing 400 — tidak ada redirect/code pada semuanya", async () => {
  const { body: client } = await daftarClient([STABLE]);
  const challenge = computeCodeChallengeS256(randomToken(32));

  const bukanAdmin = await postAuthorize(formAuthorize({ clientId: client.client_id, redirectUri: STABLE, challenge, email: emailBukanAdmin, state: "x" }));
  assert.equal(bukanAdmin.status, 403);
  assert.equal(bukanAdmin.headers.get("location"), null);

  const salah = await postAuthorize(formAuthorize({ clientId: client.client_id, redirectUri: STABLE, challenge, password: "salah", state: "x" }));
  assert.equal(salah.status, 401);
  assert.equal(salah.headers.get("location"), null);

  // redirect_uri tidak terdaftar pada client ini -> 400 di halaman kita, TIDAK redirect.
  const asing = await postAuthorize(formAuthorize({ clientId: client.client_id, redirectUri: "https://evil.example/callback", challenge, state: "x" }));
  assert.equal(asing.status, 400);
  assert.equal(asing.headers.get("location"), null);

  // resource yang tidak dikenal ditolak.
  const resourceAsing = await postAuthorize(formAuthorize({ clientId: client.client_id, redirectUri: STABLE, challenge, resource: "https://evil.example/mcp-chatgpt" }));
  assert.equal(resourceAsing.status, 400);
  assert.equal(resourceAsing.headers.get("location"), null);
});

test("callback tambahan dari environment tetap exact-match dan ikut menerima iss", async () => {
  const extra = "https://chatgpt.example.test/connector/oauth/uji-integrasi";
  assert.equal((await daftarClient([extra])).res.status, 400);
  process.env.MCP_CHATGPT_REDIRECT_URIS = extra;
  try {
    const reg = await daftarClient([extra]);
    assert.equal(reg.res.status, 201);
    assert.equal((await daftarClient([`${extra}/`])).res.status, 400);
    const res = await postAuthorize(formAuthorize({ clientId: reg.body.client_id, redirectUri: extra, state: "ok", challenge: computeCodeChallengeS256(randomToken(32)) }));
    assert.equal(res.status, 302);
    assert.equal(new URL(res.headers.get("location")).searchParams.get("iss"), ISSUER);
  } finally {
    delete process.env.MCP_CHATGPT_REDIRECT_URIS;
  }
});

test("log diagnostik DCR: registrasi valid tidak mencatat penolakan; penolakan mencatat hanya URI yang ditolak", async () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    const sebelum = await testPrisma.mcpOAuthClient.count();
    const sah = await daftarClient([STABLE]);
    assert.equal(sah.res.status, 201);
    assert.equal(await testPrisma.mcpOAuthClient.count(), sebelum + 1);
    const logPenolakan = () => warn.mock.calls.map((c) => c.arguments.join(" ")).filter((l) => l.includes("mcp_oauth_register_rejected"));
    assert.equal(logPenolakan().length, 0);

    const asing = "https://chatgpt.com/connector/oauth/uji-integrasi-log";
    const ditolak = await daftarClient([STABLE, asing]);
    assert.equal(ditolak.res.status, 400);
    assert.equal(await testPrisma.mcpOAuthClient.count(), sebelum + 1, "penolakan tidak boleh menulis klien");
    const baris = logPenolakan();
    assert.equal(baris.length, 1);
    assert.deepEqual(JSON.parse(baris[0]).redirect_uris, [asing]);
  } finally {
    warn.mock.restore();
  }
});
