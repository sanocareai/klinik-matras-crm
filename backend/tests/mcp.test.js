// Tes MCP server READ-ONLY (/mcp). Dijalankan dengan test runner bawaan Node:
//   npm test
//
// Sengaja TANPA database: yang diuji di sini adalah lapisan keamanan (token,
// rate limit, masking) dan kontrak MCP (initialize + tools/list). Query Prisma
// tidak disentuh — tools/list tidak pernah memanggil handler tool.
//
// Tes "tidak ada operasi tulis" di bawah adalah JARING PENGAMAN UTAMA file ini:
// satu baris prisma.*.update() yang tidak sengaja masuk ke tools.js akan
// membuat build gagal, bukan diam-diam memberi Claude.ai akses tulis ke CRM.

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { maskPhone, maskEmail, createRateLimiter } from "../src/mcp/security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_UJI = "token-rahasia-untuk-tes";

// ── Masking ────────────────────────────────────────────────────────────────
test("maskPhone menyamarkan bagian tengah nomor", () => {
  assert.equal(maskPhone("6285180160076"), "628****0076");
  assert.equal(maskPhone("628518728390"), "628****8390");
  assert.equal(maskPhone("6285180160076", true), "6285180160076");
  assert.equal(maskPhone(null), null);
  // Nomor pendek tidak boleh bocor sebagian.
  assert.equal(maskPhone("62812"), "*****");
});

test("maskEmail menyisakan domain tapi menyembunyikan identitas", () => {
  assert.equal(maskEmail("gilang@klinikmatras.com"), "gi****@klinikmatras.com");
  assert.equal(maskEmail("gilang@klinikmatras.com", true), "gilang@klinikmatras.com");
  assert.equal(maskEmail(null), null);
});

// ── Rate limit ─────────────────────────────────────────────────────────────
test("rate limiter menolak setelah melewati batas, lalu pulih di window berikutnya", () => {
  const cek = createRateLimiter({ limit: 3, windowMs: 60_000 });
  const t0 = 1_000_000;

  assert.equal(cek("ip-a", t0).allowed, true);
  assert.equal(cek("ip-a", t0).allowed, true);
  assert.equal(cek("ip-a", t0).allowed, true);
  assert.equal(cek("ip-a", t0).allowed, false, "request ke-4 harus ditolak");

  // IP lain punya jatah sendiri.
  assert.equal(cek("ip-b", t0).allowed, true);

  // Window berikutnya → jatah kembali penuh.
  assert.equal(cek("ip-a", t0 + 60_001).allowed, true);
});

// ── Server uji ─────────────────────────────────────────────────────────────
// Router di-import DINAMIS setelah env diset, karena MCP_RATE_LIMIT dibaca
// saat modul pertama kali dimuat.
//
// MCP_OAUTH_JWT_SECRET SENGAJA di-default-kan "" (mati) di sini, bukan
// dibiarkan ikut apa pun yang ada di backend/.env sungguhan (Prisma
// auto-load .env begitu PrismaClient dipakai di mana pun dalam proses tes
// ini) — tanpa ini, tes "token statis kosong = 503" bisa lolos/gagal
// tergantung isi .env developer yang menjalankannya, bukan logika kode.
async function jalankanServer(env = {}) {
  process.env.MCP_API_TOKEN = env.MCP_API_TOKEN ?? TOKEN_UJI;
  process.env.MCP_OAUTH_JWT_SECRET = env.MCP_OAUTH_JWT_SECRET ?? "";
  const { mcpRouter } = await import("../src/mcp/index.js");

  const app = express();
  app.use(express.json());
  app.use("/mcp", mcpRouter);

  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
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
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "tes", version: "1.0.0" },
  },
};

test("tanpa token / token salah ditolak 401", async (t) => {
  const { url, tutup } = await jalankanServer();
  t.after(tutup);

  const tanpa = await panggil(url, INIT, null);
  assert.equal(tanpa.status, 401);
  assert.match(tanpa.headers.get("www-authenticate") || "", /Bearer/);

  const salah = await panggil(url, INIT, "token-ngasal");
  assert.equal(salah.status, 401);
});

test("kedua jalur auth kosong = fitur mati (503), bukan terbuka bebas", async (t) => {
  const { url, tutup } = await jalankanServer({ MCP_API_TOKEN: "", MCP_OAUTH_JWT_SECRET: "" });
  t.after(tutup);

  const res = await panggil(url, INIT, "apa saja");
  assert.equal(res.status, 503);
});

test("MCP_API_TOKEN kosong TAPI MCP_OAUTH_JWT_SECRET terisi = tetap aktif (401 di header WWW-Authenticate memuat resource_metadata)", async (t) => {
  const { url, tutup } = await jalankanServer({ MCP_API_TOKEN: "", MCP_OAUTH_JWT_SECRET: "secret-oauth-tes" });
  t.after(tutup);

  const res = await panggil(url, INIT, null);
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") || "", /resource_metadata=/);
});

test("initialize + tools/list berhasil dan semua tool ditandai read-only", async (t) => {
  const { url, tutup } = await jalankanServer();
  t.after(tutup);

  const initRes = await panggil(url, INIT);
  assert.equal(initRes.status, 200);
  const initTeks = await initRes.text();
  assert.match(initTeks, /klinik-matras-crm/);

  const listRes = await panggil(url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(listRes.status, 200);
  const teks = await listRes.text();
  // Mode stateless membalas SSE (`event: message\ndata: {...}`) kecuali
  // enableJsonResponse — ambil baris data-nya.
  const baris = teks.split("\n").find((l) => l.startsWith("data:")) ?? teks;
  const payload = JSON.parse(baris.replace(/^data:\s*/, ""));
  const tools = payload.result.tools;

  assert.ok(tools.length >= 10, `harus ada minimal 10 tool, dapat ${tools.length}`);
  for (const t2 of tools) {
    assert.equal(t2.annotations?.readOnlyHint, true, `tool ${t2.name} tidak ditandai readOnlyHint`);
    assert.equal(t2.annotations?.destructiveHint, false, `tool ${t2.name} tidak ditandai non-destruktif`);
  }
  // Nama tool yang jadi kontrak dengan Claude — jangan diganti diam-diam.
  const nama = tools.map((x) => x.name);
  for (const wajib of ["cari_pelanggan", "detail_pelanggan", "cari_order", "statistik_crm"]) {
    assert.ok(nama.includes(wajib), `tool ${wajib} hilang`);
  }
});

test("GET /mcp dijawab 405 (stateless, tidak ada SSE server→klien)", async (t) => {
  const { url, tutup } = await jalankanServer();
  t.after(tutup);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN_UJI}` } });
  assert.equal(res.status, 405);
});

// ── Jaring pengaman read-only ──────────────────────────────────────────────
// SEMUA file tool wajib ikut dipindai. Kalau menambah file toolsXxx.js baru,
// TAMBAHKAN ke daftar ini — kalau lupa, file baru itu tidak terlindungi sama
// sekali dan operasi tulis bisa lolos diam-diam ke Claude.
const FILE_TOOL = ["tools.js", "toolsShared.js", "toolsChat.js", "toolsTraffic.js"];

test("semua file tool MCP bebas operasi tulis Prisma & pengiriman WhatsApp", () => {
  const terlarang = [
    /prisma\.[A-Za-z]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/,
    /\$executeRaw/,
    /\$transaction/,
    /wahaClient/,
    /sendText|sendMedia/,
  ];

  for (const nama of FILE_TOOL) {
    // Komentar dibuang dulu — header file-file itu MENYEBUT pola terlarang ini
    // sebagai aturan, dan tanpa ini tes gagal karena dokumentasinya sendiri.
    const src = readFileSync(path.join(__dirname, "../src/mcp", nama), "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");

    for (const pola of terlarang) {
      assert.equal(pola.test(src), false, `${nama} mengandung pola terlarang: ${pola}`);
    }
    // $queryRaw boleh (agregat), TAPI harus murni SELECT.
    for (const m of src.matchAll(/\$queryRaw`([^`]*)`/g)) {
      assert.match(m[1].trim(), /^\s*SELECT\b/i, `${nama}: $queryRaw bukan SELECT murni`);
    }
  }
});

test("daftar FILE_TOOL mencakup semua file tools*.js yang benar-benar ada", () => {
  // Tanpa cek ini, file tool baru bisa lolos dari pemindaian di atas hanya
  // karena penulisnya lupa menambahkannya ke FILE_TOOL.
  const adaDiDisk = readdirSync(path.join(__dirname, "../src/mcp"))
    .filter((f) => /^tools.*\.js$/.test(f))
    .sort();
  assert.deepEqual(adaDiDisk, [...FILE_TOOL].sort(),
    "Ada file tools*.js yang belum terdaftar di FILE_TOOL tes ini");
});