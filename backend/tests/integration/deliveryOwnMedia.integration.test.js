// Akses FOTO STRUK milik sendiri pada Pengajuan Biaya DELIVERY — tanpa finance:read.
// Matriks: pemilik vs orang lain, DELIVERY vs workspace lain/Finance, status editable vs terkunci,
// URL bertanda-tangan (bentuk, batas pemilik, kedaluwarsa, rusak), dan tidak ada pelebaran finance:read.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { signFile } from "../../src/lib/mediaSigning.js";

let server;
let raw;
test.before(async () => {
  await truncateAll();
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  server = await startTestServer(buildTestApp());
  raw = makeRaw(server.baseUrl);
});
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx)); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const P = "/api/finance/expense-submissions";
let n = 0;
const K = (p = "med") => ({ "Idempotency-Key": `${p}-${Date.now()}-${++n}-abcdef` });
const body = (extra = {}) => ({ workspace: "DELIVERY", expenseType: "BBM", date: "2026-09-20", amount: 500_000, vendorName: "SPBU Uji", metadata: { liters: 10 }, ...extra });
let warna = 0;

async function fixture() {
  const a = await createTestUser({ roles: ["DRIVER"] });
  const b = await createTestUser({ roles: ["DRIVER"] });
  const dispatcher = await createTestUser({ roles: ["DISPATCHER"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const approver = await createTestUser({ roles: ["APPROVER"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  return { a, b, dispatcher, finance, approver, sales };
}
// Gambar UNIK per pemanggilan (nama file = hash isi) supaya tiap pengajuan punya berkas sendiri.
async function gambar() {
  warna += 1;
  return sharp({ create: { width: 16, height: 16, channels: 3, background: { r: warna % 256, g: (warna * 7) % 256, b: (warna * 13) % 256 } } }).jpeg().toBuffer();
}
async function unggah(token, id, headers = K("up")) {
  const fd = new FormData();
  fd.append("bukti", new Blob([await gambar()], { type: "image/jpeg" }), "s.jpg");
  const res = await fetch(`${server.baseUrl}${P}/${id}/bukti`, { method: "POST", headers: { Authorization: `Bearer ${token}`, ...headers }, body: fd });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function buatDenganBukti(u) {
  const c = await raw("POST", P, { token: u.token, headers: K(), body: body() });
  const up = await unggah(u.token, c.body.id);
  assert.equal(up.status, 201, JSON.stringify(up.body));
  return { id: c.body.id, url: up.body.url, file: up.body.url.split("/").pop() };
}
const ambil = (path, token) => fetch(`${server.baseUrl}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const media = (u, token) => ambil(u, token);
const thumb = (url) => url.replace(/\.jpg$/, "_t.jpg");

test("pemilik (Driver, tanpa finance:read) membaca foto struknya sendiri, dan miniaturnya, lewat Bearer", async () => {
  const f = await fixture();
  const s = await buatDenganBukti(f.a);
  const r = await media(s.url, f.a.token);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/jpeg");
  assert.match(r.headers.get("cache-control"), /private/);
  assert.equal((await media(thumb(s.url), f.a.token)).status, 200);
  assert.equal((await media(s.url, null)).status, 401, "tanpa login ditolak");
});

test("orang lain: driver lain, Sales (izin pengajuan), Approver tanpa kepemilikan — driver lain & Sales ditolak; finance:read tetap boleh", async () => {
  const f = await fixture();
  const s = await buatDenganBukti(f.a);
  assert.equal((await media(s.url, f.b.token)).status, 403, "driver lain");
  assert.equal((await media(s.url, f.sales.token)).status, 403, "Sales pemegang finance:expense:submit bukan pemilik");
  assert.equal((await media(s.url, f.dispatcher.token)).status, 403, "Dispatcher bukan pemilik");
  assert.equal((await media(s.url, f.finance.token)).status, 200, "Finance (finance:read) tetap boleh — perilaku lama");
  assert.equal((await media(s.url, f.approver.token)).status, 200, "Approver (finance:read) tetap boleh");
});

test("pemegang izin pengajuan lama tanpa finance:read (Dispatcher) membaca foto pengajuan DELIVERY yang ia buat, bukan milik orang lain", async () => {
  const f = await fixture();
  const punyaDispatcher = await buatDenganBukti(f.dispatcher);
  const punyaDriver = await buatDenganBukti(f.a);
  assert.equal((await media(punyaDispatcher.url, f.dispatcher.token)).status, 200);
  assert.equal((await media(punyaDriver.url, f.dispatcher.token)).status, 403);
});

test("DELIVERY vs workspace lain: pemilik TIDAK bisa membaca foto pada pengajuan non-DELIVERY, dan tidak bisa membaca foto FinExpense/Finance", async () => {
  const f = await fixture();
  // pengajuan workspace lain milik driver A (dibuat langsung di DB; via API mustahil) + foto bukti
  const s = await buatDenganBukti(f.a);
  await testPrisma.expenseSubmission.update({ where: { id: s.id }, data: { division: "PRODUKSI" } });
  assert.equal((await media(s.url, f.a.token)).status, 403, "bukan DELIVERY");
  await testPrisma.expenseSubmission.update({ where: { id: s.id }, data: { division: "DELIVERY" } });
  assert.equal((await media(s.url, f.a.token)).status, 200, "kembali DELIVERY");
  // foto acak yang tidak terkait pengajuan siapa pun (mis. nota Finance) — 403, bukan 200
  const asing = "a".repeat(40) + ".jpg";
  assert.equal((await media(`/media/finance-receipts/${asing}`, f.a.token)).status, 403);
  // tidak ada endpoint baru: daftar global tetap tertutup
  assert.equal((await raw("GET", "/api/finance/expenses", { token: f.a.token })).status, 403);
  assert.equal((await raw("GET", `${P}?division=FINANCE`, { token: f.a.token })).body.submissions.length, 1, "hanya milik sendiri");
});

test("URL bertanda-tangan: hanya untuk pemilik, bentuk tidak membocorkan path penyimpanan, bisa dibuka tanpa Bearer", async () => {
  const f = await fixture();
  const s = await buatDenganBukti(f.a);
  const mine = await raw("POST", "/api/finance/media/sign", { token: f.a.token, body: { urls: [s.url] } });
  assert.equal(mine.status, 200);
  const info = mine.body.signed[s.url];
  assert.ok(info, "pemilik mendapat URL");
  assert.match(info.url, /^\/media\/finance-receipts\/[a-f0-9]{40}\.jpg\?exp=\d+&sig=[a-f0-9]{64}$/);
  assert.doesNotMatch(info.url, /data|backend|[A-Za-z]:\\|\.\.\//, "tanpa path disk");
  const sisa = new Date(info.expiresAt).getTime() - Date.now();
  assert.ok(sisa > 0 && sisa <= 10 * 60_000 + 1000, `umur pendek (<=10 menit), sisa ${sisa}ms`);
  assert.equal((await media(info.url, null)).status, 200, "URL bertanda-tangan berlaku tanpa Bearer");
  assert.equal((await media(info.thumbUrl, null)).status, 200);
  // orang lain tidak mendapat URL untuk foto ini
  const other = await raw("POST", "/api/finance/media/sign", { token: f.b.token, body: { urls: [s.url] } });
  assert.deepEqual(other.body.signed, {});
});

test("URL kedaluwarsa, tanda tangan rusak, dan berkas lain ditolak", async () => {
  const f = await fixture();
  const s = await buatDenganBukti(f.a);
  const lama = signFile(s.file, { now: Date.now() - 3600_000 }); // exp 1 jam lalu, tanda tangan sah tetapi sudah lewat
  assert.equal((await media(`${s.url}?exp=${lama.exp}&sig=${lama.sig}`, null)).status, 403, "kedaluwarsa");
  const baru = signFile(s.file);
  const rusak = baru.sig.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
  assert.equal((await media(`${s.url}?exp=${baru.exp}&sig=${rusak}`, null)).status, 403, "sig rusak");
  const lain = signFile("b".repeat(40) + ".jpg");
  assert.equal((await media(`${s.url}?exp=${lain.exp}&sig=${lain.sig}`, null)).status, 403, "sig milik berkas lain");
  assert.equal((await media(`${s.url}?exp=${baru.exp + 1}&sig=${baru.sig}`, null)).status, 403, "exp dimanipulasi");
});

test("status editable vs terkunci: mengganti bukti hanya saat DRAF/PERLU_REVISI; membaca tetap boleh setelah diajukan; versi lama tetap milik pemilik", async () => {
  const f = await fixture();
  const s = await buatDenganBukti(f.a);
  const ganti = await unggah(f.a.token, s.id);
  assert.equal(ganti.status, 201, "DRAF boleh mengganti");
  assert.equal(ganti.body.version, 2);
  assert.equal((await media(s.url, f.a.token)).status, 200, "versi lama tetap terbaca pemilik");
  const aj = await raw("POST", `${P}/${s.id}/ajukan`, { token: f.a.token, headers: K("aj") });
  assert.equal(aj.status, 200, JSON.stringify(aj.body));
  assert.equal((await unggah(f.a.token, s.id)).status, 409, "MENUNGGU_PERSETUJUAN terkunci");
  assert.equal((await media(ganti.body.url, f.a.token)).status, 200, "tetap bisa dibaca saat terkunci");
  const rev = await raw("POST", `${P}/${s.id}/minta-revisi`, { token: f.approver.token, headers: K("rv"), body: { reason: "Foto buram" } });
  assert.equal(rev.status, 200);
  assert.equal((await unggah(f.a.token, s.id)).status, 201, "PERLU_REVISI boleh mengganti");
  await raw("POST", `${P}/${s.id}/batalkan`, { token: f.a.token, headers: K("bt"), body: {} });
  assert.equal((await unggah(f.a.token, s.id)).status, 409, "DIBATALKAN terkunci");
});

test("penggantian bukti: orang lain (Driver/Dispatcher) tidak bisa; Finance tetap bisa (perilaku lama); tidak ada jalur hapus", async () => {
  const f = await fixture();
  const s = await buatDenganBukti(f.a);
  assert.equal((await unggah(f.b.token, s.id)).status, 404, "driver lain");
  assert.equal((await unggah(f.dispatcher.token, s.id)).status, 404, "Dispatcher bukan pemilik");
  assert.equal((await unggah(f.finance.token, s.id)).status, 201, "staf Finance boleh melampirkan");
  const del = await raw("DELETE", `${P}/${s.id}/bukti`, { token: f.a.token, headers: K("del") });
  assert.ok([404, 405].includes(del.status), `tidak ada endpoint hapus bukti (status ${del.status})`);
});

test("tidak ada pelebaran finance:read: pemilik tidak bisa memakai jalur bukti pembayaran maupun media pembelian", async () => {
  const f = await fixture();
  await buatDenganBukti(f.a);
  assert.equal((await media("/api/finance/media/payment-proofs/abc.jpg", f.a.token)).status, 403);
  const capabilities = await raw("GET", "/api/auth/me", { token: f.a.token });
  assert.equal(capabilities.body.capabilities.financeRead, false);
});
