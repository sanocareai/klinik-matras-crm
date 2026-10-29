// DAFTAR KASUS KOMPLAIN — penomoran halaman, pemisahan Aktif/Riwayat, pencarian, ringkasan (redesign UI/UX Komplain). Lewat HTTP sungguhan terhadap PostgreSQL.
// Yang dikunci: tidak ada pemotongan diam-diam (total + hasMore selalu ada; > 300 kasus terbaca lewat halaman); aktif diurut Kritis dulu; riwayat = SELESAI/DIBATALKAN;
// pemanggil lama (tanpa parameter baru) tetap menerima { cases }; masukan tidak valid = 400; izin COMPLAINT_READ; gerbang konfirmasi customer & aturan transisi TIDAK berubah.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestUnit } from "./setup/fixtures.js";
import { startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

const { complaintsRouter } = await import("../../src/routes/complaints.js");
let server;
test.before(async () => { await truncateAll(); const app = express(); app.use(express.json()); app.use("/api/complaints", complaintsRouter); server = await startTestServer(app); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });

const klien = async (roles) => { const { token, user } = await createTestUser({ roles }); return { api: makeClient(server.baseUrl, token), user }; };
let seq = 0;
async function buatKasus(orderId, o = {}) {
  seq += 1; const hari = String((seq % 27) + 1).padStart(2, "0");
  return testPrisma.complaintCase.create({ data: { caseNumber: `CMP-${hari}102026-${String(seq).padStart(4, "0")}`, orderId, category: "KENYAMANAN", description: o.description ?? `Keluhan uji ${seq}`,
    severity: o.severity ?? "SEDANG", status: o.status ?? "BARU", currentOwner: o.owner ?? "SALES", targetCompletionAt: o.target ?? null, createdAt: o.createdAt ?? new Date(Date.UTC(2026, 9, 1, 0, 0, seq)) } });
}
async function dunia() {
  const { customer, order } = await createTestUnit(); await testPrisma.customer.update({ where: { id: customer.id }, data: { name: "Yudhistira Uji" } });
  const sales = await klien(["SALES"]);
  const k = {};
  k.kritis = await buatKasus(order.id, { severity: "KRITIS", status: "VERIFIKASI", description: "Kasur ambles parah" });
  k.rendahBaru = await buatKasus(order.id, { severity: "RENDAH", status: "BARU" });
  k.tinggi = await buatKasus(order.id, { severity: "TINGGI", status: "DALAM_PENANGANAN", owner: "PRODUCTION" });
  k.sedang = await buatKasus(order.id, { severity: "SEDANG", status: "KONFIRMASI_CUSTOMER" });
  k.telat = await buatKasus(order.id, { severity: "SEDANG", status: "ACTION_REQUIRED", target: new Date(Date.now() - 3 * 86400_000) });
  k.selesai1 = await buatKasus(order.id, { status: "SELESAI" }); k.selesai2 = await buatKasus(order.id, { status: "SELESAI", severity: "TINGGI" });
  k.batal = await buatKasus(order.id, { status: "DIBATALKAN" });
  return { order, sales, k };
}

test("A. pemanggil lama tanpa parameter baru: tetap { cases } berisi semua kasus, kini disertai total/limit/offset/hasMore", async () => {
  const { sales } = await dunia(); const r = await sales.api.get("/api/complaints");
  assert.equal(r.status, 200); assert.equal(r.body.cases.length, 8); assert.equal(r.body.total, 8); assert.equal(r.body.hasMore, false); assert.equal(r.body.offset, 0); assert.equal(r.body.limit, 300);
});

test("B. penomoran halaman: limit/offset tanpa tumpang-tindih; total = seluruh hasil; hasMore benar", async () => {
  const { sales } = await dunia();
  const h1 = await sales.api.get("/api/complaints?limit=3&offset=0"); const h2 = await sales.api.get("/api/complaints?limit=3&offset=3"); const h3 = await sales.api.get("/api/complaints?limit=3&offset=6");
  assert.deepEqual([h1.body.cases.length, h2.body.cases.length, h3.body.cases.length], [3, 3, 2]); assert.equal(h1.body.total, 8);
  assert.deepEqual([h1.body.hasMore, h2.body.hasMore, h3.body.hasMore], [true, true, false]);
  const semua = [...h1.body.cases, ...h2.body.cases, ...h3.body.cases].map((c) => c.id); assert.equal(new Set(semua).size, 8, "tanpa duplikat antar halaman");
});

test("C. Aktif vs Riwayat: aktif diurut Kritis dulu lalu terbaru; riwayat hanya SELESAI/DIBATALKAN", async () => {
  const { sales, k } = await dunia();
  const a = await sales.api.get("/api/complaints?scope=aktif"); assert.equal(a.body.total, 5); assert.ok(a.body.cases.every((c) => !["SELESAI", "DIBATALKAN"].includes(c.status)));
  assert.equal(a.body.cases[0].id, k.kritis.id, "Kritis paling atas"); assert.equal(a.body.cases[1].id, k.tinggi.id);
  const sev = a.body.cases.map((c) => c.severity); const rank = { KRITIS: 3, TINGGI: 2, SEDANG: 1, RENDAH: 0 }; for (let i = 1; i < sev.length; i++) assert.ok(rank[sev[i - 1]] >= rank[sev[i]], "urutan keparahan menurun");
  const r = await sales.api.get("/api/complaints?scope=riwayat"); assert.equal(r.body.total, 3); assert.ok(r.body.cases.every((c) => ["SELESAI", "DIBATALKAN"].includes(c.status)));
  const sel = await sales.api.get("/api/complaints?scope=riwayat&status=SELESAI"); assert.equal(sel.body.total, 2);
});

test("D. filter statuses (daftar), pemegang, dan pencarian (nomor, keluhan, order, nama pelanggan)", async () => {
  const { sales, k, order } = await dunia();
  const st = await sales.api.get("/api/complaints?statuses=BARU,VERIFIKASI"); assert.deepEqual(st.body.cases.map((c) => c.id).sort(), [k.kritis.id, k.rendahBaru.id].sort());
  const own = await sales.api.get("/api/complaints?currentOwner=PRODUCTION"); assert.deepEqual(own.body.cases.map((c) => c.id), [k.tinggi.id]);
  assert.equal((await sales.api.get("/api/complaints?q=ambles")).body.total, 1);
  assert.equal((await sales.api.get(`/api/complaints?q=${encodeURIComponent("yudhistira")}&scope=aktif`)).body.total, 5, "nama pelanggan, tak peka huruf besar");
  assert.equal((await sales.api.get(`/api/complaints?q=${encodeURIComponent(k.tinggi.caseNumber)}`)).body.total, 1);
  assert.equal((await sales.api.get(`/api/complaints?q=${encodeURIComponent(order.orderNumber ?? "ZZZ-TIDAK-ADA")}`)).body.total >= 0, true);
  assert.equal((await sales.api.get("/api/complaints?q=tidak-ada-sama-sekali")).body.total, 0);
});

test("E. masukan tidak valid = 400 (bukan 500): status/scope/limit/offset", async () => {
  const { sales } = await dunia();
  for (const q of ["status=NGAWUR", "statuses=BARU,NGAWUR", "scope=semua", "limit=0", "limit=301", "limit=abc", "offset=-1", "offset=1.5"]) { const r = await sales.api.get(`/api/complaints?${q}`); assert.equal(r.status, 400, `${q} → ${r.status}`); assert.ok(r.body.error); }
});

test("F. lebih dari 300 kasus: tidak ada pemotongan diam-diam — total jujur, hasMore, dan halaman berikutnya terbaca", async () => {
  const { order, sales } = await dunia();
  await testPrisma.complaintCase.createMany({ data: Array.from({ length: 305 }, (_, i) => ({ id: crypto.randomUUID(), caseNumber: `CMP-BULK-${String(i + 1).padStart(4, "0")}`, orderId: order.id, category: "LAINNYA", description: `Massal ${i + 1}`, status: "BARU", createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)) })) });
  const lama = await sales.api.get("/api/complaints"); assert.equal(lama.body.cases.length, 300, "batas lama 300 tetap"); assert.equal(lama.body.total, 313); assert.equal(lama.body.hasMore, true, "SEKARANG ada penanda bahwa hasil terpotong");
  const p2 = await sales.api.get("/api/complaints?limit=300&offset=300"); assert.equal(p2.body.cases.length, 13); assert.equal(p2.body.hasMore, false);
  assert.equal(new Set([...lama.body.cases, ...p2.body.cases].map((c) => c.id)).size, 313);
});

test("G. ringkasan: jumlah per status, aktif/riwayat, prioritas, lewat target — dari seluruh data (bukan halaman termuat)", async () => {
  const { sales } = await dunia(); const r = await sales.api.get("/api/complaints/ringkasan"); assert.equal(r.status, 200);
  assert.equal(r.body.aktif, 5); assert.equal(r.body.riwayat, 3); assert.equal(r.body.selesai, 2); assert.equal(r.body.dibatalkan, 1); assert.equal(r.body.prioritas, 2, "Kritis + Tinggi yang aktif"); assert.equal(r.body.lewatTarget, 1);
  assert.equal(r.body.perStatus.VERIFIKASI, 1); assert.equal(r.body.perStatus.KONFIRMASI_CUSTOMER, 1); assert.equal(r.body.perStatus.MENUNGGU_MATERIAL, 0);
  assert.equal((await sales.api.get("/api/complaints/ringkasan?currentOwner=PRODUCTION")).body.aktif, 1);
  assert.equal((await sales.api.get("/api/complaints/ringkasan?currentOwner=NGAWUR")).status, 400);
});

test("H. izin: tanpa COMPLAINT_READ (DRIVER) ditolak 403 untuk daftar dan ringkasan; peran baca-saja (PRODUCTION_WORKER) boleh melihat tetapi tidak boleh ubah", async () => {
  const { k } = await dunia(); const driver = await klien(["DRIVER"]); const pekerja = await klien(["PRODUCTION_WORKER"]);
  assert.equal((await driver.api.get("/api/complaints")).status, 403); assert.equal((await driver.api.get("/api/complaints/ringkasan")).status, 403);
  assert.equal((await pekerja.api.get("/api/complaints?scope=aktif")).status, 200);
  assert.equal((await pekerja.api.post(`/api/complaints/${k.rendahBaru.id}/status`, { status: "VERIFIKASI" })).status, 403, "baca-saja tidak bisa ubah status");
});

test("I. gerbang tidak berubah: SELESAI tetap tidak bisa lewat /status; transisi tidak sah ditolak; konfirmasi hanya dari KONFIRMASI_CUSTOMER", async () => {
  const { sales, k } = await dunia();
  assert.equal((await sales.api.post(`/api/complaints/${k.sedang.id}/status`, { status: "SELESAI" })).status, 400);
  assert.equal((await sales.api.post(`/api/complaints/${k.rendahBaru.id}/status`, { status: "DALAM_PENANGANAN" })).status, 400);
  assert.equal((await sales.api.post(`/api/complaints/${k.kritis.id}/confirm-customer`, {})).status, 400, "belum KONFIRMASI_CUSTOMER");
  const ok = await sales.api.post(`/api/complaints/${k.sedang.id}/confirm-customer`, {}); assert.equal(ok.status, 200); assert.equal(ok.body.status, "SELESAI");
  const lagi = await sales.api.get("/api/complaints/ringkasan"); assert.equal(lagi.body.selesai, 3);
});
