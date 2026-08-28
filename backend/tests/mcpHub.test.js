// Tes SANO Hub Analytics MCP server READ-ONLY (/mcp-hub). Dijalankan dengan
// test runner bawaan Node: npm test
//
// Sengaja TANPA database asli untuk sebagian besar tes (kontrak MCP + guard
// kode) — perilaku terhadap data sungguhan sudah diverifikasi manual terhadap
// DB lokal & production (lihat docs/MCP-HUB-SERVER.md).
//
// Tes "tidak ada operasi tulis" di bawah adalah JARING PENGAMAN LAPIS KODE —
// pelengkap jaring LAPIS DATABASE (role mcp_hub_readonly, cuma GRANT SELECT,
// lihat db.js). Kalau satu baris .create()/.update() tidak sengaja masuk ke
// src/mcpHub/, tes ini gagal DULUAN sebelum sempat mengandalkan Postgres
// menolaknya di production.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_UJI = "token-hub-rahasia-untuk-tes";

// ── Server uji ─────────────────────────────────────────────────────────────
// MCP_OAUTH_JWT_SECRET didefault-kan "" (mati) supaya tes deterministik,
// sama alasan dengan mcp.test.js: Prisma auto-load .env sungguhan begitu
// PrismaClient dipakai di mana pun dalam proses tes.
async function jalankanServer(env = {}) {
  process.env.MCP_HUB_API_TOKEN = env.MCP_HUB_API_TOKEN ?? TOKEN_UJI;
  process.env.MCP_OAUTH_JWT_SECRET = env.MCP_OAUTH_JWT_SECRET ?? "";
  const { mcpHubRouter } = await import("../src/mcpHub/index.js");

  const app = express();
  app.use(express.json());
  app.use("/mcp-hub", mcpHubRouter);

  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}/mcp-hub`;
  return { url, tutup: () => new Promise((r) => server.close(r)) };
}

function panggil(url, body, token = TOKEN_UJI) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "tes", version: "1.0.0" } },
};

// ── Auth ─────────────────────────────────────────────────────────────────
test("tanpa token / token salah ditolak 401", async (t) => {
  const { url, tutup } = await jalankanServer();
  t.after(tutup);

  const tanpa = await panggil(url, INIT, null);
  assert.equal(tanpa.status, 401);
  assert.match(tanpa.headers.get("www-authenticate") || "", /Bearer/);

  const salah = await panggil(url, INIT, "token-ngasal");
  assert.equal(salah.status, 401);
});

test("MCP_HUB_API_TOKEN kosong = fitur mati (503), bukan terbuka bebas", async (t) => {
  const { url, tutup } = await jalankanServer({ MCP_HUB_API_TOKEN: "" });
  t.after(tutup);

  const res = await panggil(url, INIT, "apa saja");
  assert.equal(res.status, 503);
});

test("token /mcp (SANSS) TIDAK BISA dipakai untuk /mcp-hub — audience beda", async (t) => {
  // Token statis SANSS sengaja beda dari token hub -- pakai token statis
  // SANSS di sini seharusnya tetap ditolak (bukan token hub yang benar).
  const { url, tutup } = await jalankanServer();
  t.after(tutup);

  const res = await panggil(url, INIT, "token-punya-mcp-sanss-bukan-hub");
  assert.equal(res.status, 401);
});

test("initialize + tools/list: 5 tool, semua read-only, nama sesuai kontrak", async (t) => {
  const { url, tutup } = await jalankanServer();
  t.after(tutup);

  const initRes = await panggil(url, INIT);
  assert.equal(initRes.status, 200);
  const initTeks = await initRes.text();
  assert.match(initTeks, /sano-hub-analytics/);

  const listRes = await panggil(url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(listRes.status, 200);
  const teks = await listRes.text();
  const baris = teks.split("\n").find((l) => l.startsWith("data:")) ?? teks;
  const payload = JSON.parse(baris.replace(/^data:\s*/, ""));
  const tools = payload.result.tools;

  assert.equal(tools.length, 5, `harus persis 5 tool, dapat ${tools.length}`);
  for (const t2 of tools) {
    assert.equal(t2.annotations?.readOnlyHint, true, `tool ${t2.name} tidak ditandai readOnlyHint`);
    assert.equal(t2.annotations?.destructiveHint, false, `tool ${t2.name} tidak ditandai non-destruktif`);
  }
  const nama = tools.map((x) => x.name);
  assert.deepEqual(
    [...nama].sort(),
    ["get_gold_standard_examples", "get_quality_scores", "get_risk_profiles", "get_stale_lead_status", "get_weekly_narratives"].sort(),
    "nama tool adalah kontrak dengan Claude — jangan diganti diam-diam",
  );
});

test("GET /mcp-hub dijawab 405 (stateless, tidak ada SSE server→klien)", async (t) => {
  const { url, tutup } = await jalankanServer();
  t.after(tutup);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN_UJI}` } });
  assert.equal(res.status, 405);
});

// ── Jaring pengaman read-only (LAPIS KODE) ──────────────────────────────────
const FILE_HUB = ["db.js", "auth.js", "tools.js", "index.js"];

test("semua file src/mcpHub/*.js bebas operasi tulis Prisma & WhatsApp", () => {
  const terlarang = [
    /prisma\.[A-Za-z]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/,
    /\$executeRaw/,
    /\$transaction/,
    /wahaClient/,
    /sendText|sendMedia/,
  ];

  for (const nama of FILE_HUB) {
    const src = readFileSync(path.join(__dirname, "../src/mcpHub", nama), "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    for (const pola of terlarang) {
      assert.equal(pola.test(src), false, `${nama} mengandung pola terlarang: ${pola}`);
    }
  }
});

test("daftar FILE_HUB mencakup semua file src/mcpHub/*.js yang benar-benar ada", () => {
  const adaDiDisk = readdirSync(path.join(__dirname, "../src/mcpHub")).filter((f) => f.endsWith(".js")).sort();
  assert.deepEqual(adaDiDisk, [...FILE_HUB].sort(), "Ada file src/mcpHub/*.js yang belum terdaftar di FILE_HUB tes ini");
});

test("tools.js TIDAK PERNAH import `prisma` writable dari ../db.js — hanya prismaReadOnly", () => {
  // Ini jaring pengaman KODE untuk poin yang sama dengan bukti DB-level:
  // satu-satunya koneksi DB yang boleh dipakai handler tool adalah yang
  // rolenya read-only. Import `{ prisma }` dari "../db.js" (role writable
  // utama app) TIDAK BOLEH muncul di sini sama sekali.
  const src = readFileSync(path.join(__dirname, "../src/mcpHub/tools.js"), "utf8");
  assert.doesNotMatch(src, /from ["']\.\.\/db\.js["']/, "tools.js mengimpor db.js (role writable) langsung — harus lewat ./db.js (prismaReadOnly)");
  assert.match(src, /prismaReadOnly/, "tools.js harus memakai prismaReadOnly");
});

test("db.js: prismaReadOnly memakai MCP_HUB_READONLY_DATABASE_URL, BUKAN DATABASE_URL utama", () => {
  const src = readFileSync(path.join(__dirname, "../src/mcpHub/db.js"), "utf8");
  assert.match(src, /MCP_HUB_READONLY_DATABASE_URL/);
  assert.doesNotMatch(
    src.replace(/\/\/.*$/gm, ""), // buang komentar dulu (nama var disebut di komentar penjelasan)
    /process\.env\.DATABASE_URL\b/,
    "db.js hub tidak boleh fallback ke DATABASE_URL utama (writable)",
  );
});
