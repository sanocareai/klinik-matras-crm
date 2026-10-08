// Tes log diagnostik penolakan DCR (POST /oauth/register). Tanpa DB: jalur penolakan
// kembali sebelum menyentuh Prisma; jalur registrasi valid diuji di integration test (DB sungguhan).
import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";

const asliChatGpt = process.env.MCP_CHATGPT_REDIRECT_URIS;
delete process.env.MCP_CHATGPT_REDIRECT_URIS;
after(() => {
  if (asliChatGpt !== undefined) process.env.MCP_CHATGPT_REDIRECT_URIS = asliChatGpt;
});

const { mcpOAuthRouter, rejectedRedirectUrisForLog } = await import("../src/mcp/oauth.js");
const { CHATGPT_STABLE_REDIRECT_URI } = await import("../src/mcp/oauthCrypto.js");

const app = express();
app.use(mcpOAuthRouter);
const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => new Promise((resolve) => server.close(resolve)));

// Nilai sensitif tiruan: TIDAK BOLEH muncul di log mana pun.
const RAHASIA = {
  client_secret: "rahasia-klien-XYZ-123",
  password: "password-XYZ-456",
  access_token: "token-akses-XYZ-789",
  code: "kode-otorisasi-XYZ-000",
  code_verifier: "verifier-pkce-XYZ-111",
  email: "orang.pribadi@example.test",
};
const HEADER_RAHASIA = { Authorization: "Bearer bearer-XYZ-222", Cookie: "sesi=cookie-XYZ-333" };

async function register(body, headers = {}) {
  const res = await fetch(`${base}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function logPenolakan(warn) {
  return warn.mock.calls.map((c) => c.arguments.join(" ")).filter((l) => l.includes("mcp_oauth_register_rejected"));
}

test("URI asing: tetap 400, log berisi event + waktu + hanya URI yang ditolak", async () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    const asing = "https://chatgpt.com/connector/oauth/abc123-uji";
    const r = await register({ redirect_uris: [CHATGPT_STABLE_REDIRECT_URI, asing] });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "invalid_redirect_uri");
    const baris = logPenolakan(warn);
    assert.equal(baris.length, 1);
    const log = JSON.parse(baris[0]);
    assert.deepEqual(Object.keys(log).sort(), ["at", "event", "redirect_uris"]);
    assert.equal(log.event, "mcp_oauth_register_rejected");
    assert.ok(!Number.isNaN(Date.parse(log.at)));
    // Hanya yang ditolak: callback stabil yang SAH tidak ikut tercatat.
    assert.deepEqual(log.redirect_uris, [asing]);
  } finally {
    warn.mock.restore();
  }
});

test("setiap URI dipotong 300 karakter, maksimal 10 entri, non-string tidak dibocorkan isinya", async () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    const panjang = "https://evil.example/" + "a".repeat(1000);
    const banyak = Array.from({ length: 25 }, (_, i) => `https://evil.example/${i}`);
    const r = await register({ redirect_uris: [panjang, ...banyak, { rahasia: RAHASIA.password }, 42] });
    assert.equal(r.status, 400);
    const log = JSON.parse(logPenolakan(warn)[0]);
    assert.equal(log.redirect_uris.length, 10);
    assert.equal(log.redirect_uris[0].length, 300);
    assert.ok(log.redirect_uris[0].startsWith("https://evil.example/aaa"));
    assert.ok(!JSON.stringify(log).includes(RAHASIA.password));

    const objek = rejectedRedirectUrisForLog([{ x: RAHASIA.password }, 42, null, "https://evil.example/ok"]);
    assert.deepEqual(objek, ["<object>", "<number>", "<object>", "https://evil.example/ok"]);
  } finally {
    warn.mock.restore();
  }
});

test("data sensitif lain (field body, header Authorization/Cookie) tidak ikut tercatat", async () => {
  const warn = mock.method(console, "warn", () => {});
  const error = mock.method(console, "error", () => {});
  const info = mock.method(console, "log", () => {});
  try {
    const r = await register({ redirect_uris: ["https://evil.example/cb"], ...RAHASIA }, HEADER_RAHASIA);
    assert.equal(r.status, 400);
    const semua = [warn, error, info].flatMap((m) => m.mock.calls.map((c) => c.arguments.join(" "))).join("\n");
    assert.ok(semua.includes("https://evil.example/cb"));
    for (const nilai of [...Object.values(RAHASIA), "bearer-XYZ-222", "cookie-XYZ-333", "Authorization", "Cookie", "127.0.0.1"]) {
      assert.ok(!semua.includes(nilai), `log tidak boleh memuat: ${nilai}`);
    }
  } finally {
    warn.mock.restore();
    error.mock.restore();
    info.mock.restore();
  }
});

test("URI bernewline tidak bisa memalsukan baris log tambahan", async () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    await register({ redirect_uris: ["https://evil.example/a\n{\"event\":\"palsu\"}"] });
    const keluaran = warn.mock.calls.map((c) => c.arguments.join(" "));
    assert.equal(keluaran.length, 1);
    assert.ok(!keluaran[0].includes("\n"));
    assert.equal(JSON.parse(keluaran[0]).event, "mcp_oauth_register_rejected");
  } finally {
    warn.mock.restore();
  }
});

test("redirect_uris kosong atau bukan array: tetap 400, log tanpa URI", async () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    for (const body of [{}, { redirect_uris: [] }, { redirect_uris: "https://evil.example/cb" }]) {
      const r = await register(body);
      assert.equal(r.status, 400);
    }
    const baris = logPenolakan(warn).map((l) => JSON.parse(l));
    assert.equal(baris.length, 3);
    for (const b of baris) assert.deepEqual(b.redirect_uris, []);
  } finally {
    warn.mock.restore();
  }
});
