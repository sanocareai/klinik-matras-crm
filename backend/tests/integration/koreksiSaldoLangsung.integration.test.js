// KOREKSI SALDO LANGSUNG ADMIN (keputusan Owner 9 Nov 2026) — Postgres SUNGGUHAN terisolasi, rute ASLI.
// Yang dikunci: ADMIN/OWNER mengoreksi tanpa pengajuan dari keempat pintu; Gudang tetap wajib persetujuan; satu pergerakan ADJUSTMENT; klik ganda tidak memposting dua kali;
// saldo bergeser & hasil minus ditolak tanpa menyimpan apa pun; tidak ada yang mengaku "disetujui"; jurnal/valuasi/Harga Berlaku tidak tersentuh; jejak pelaku tercatat.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ROLE_PERMISSIONS, PERMISSIONS as P } from "../../src/constants/permissions.js";
import { PENANDA_LANGSUNG } from "../../src/services/koreksiSaldoBahan.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function akun(roles) { const u = await createTestUser({ roles }); return { ...u, c: makeClient(server.baseUrl, u.token) }; }
const saldo = async (id) => { const [{ s }] = await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${id}::uuid`; return s; };
let seq = 0; const kunci = () => `langsung-${Date.now()}-${++seq}-uji`;
const BASE = "/api/inventory/adjustments/koreksi-saldo";
const ajukan = (c, body, key = kunci()) => c.post(`${BASE}/ajukan`, body, { "Idempotency-Key": key });
const form = (c, body, key = kunci()) => c.post("/api/inventory/adjustments", body, { "Idempotency-Key": key });
const finansial = async () => ({ jurnal: await testPrisma.finJournalEntry.count(), baris: await testPrisma.finJournalLine.count(), valuasi: await testPrisma.finStockMovementValuation.count(), harga: await testPrisma.materialHargaBerlaku.count(), opr: await testPrisma.stockMovementBiayaOperasional.count() });

test("matriks: izin langsung milik ADMIN dan OWNER saja; ADMIN tetap bukan penyetuju", () => {
  const punya = (r) => (ROLE_PERMISSIONS[r] || []).includes(P.INVENTORY_KOREKSI_LANGSUNG);
  assert.equal(punya("ADMIN"), true); assert.equal(punya("OWNER"), true);
  for (const r of ["WAREHOUSE", "FINANCE", "SALES", "PRODUCTION_WORKER"]) assert.equal(punya(r), false, r);
  assert.equal((ROLE_PERMISSIONS.ADMIN || []).includes(P.INVENTORY_ADJUSTMENT_APPROVE), false);
});

test("L1 ADMIN dari Stok bahan: saldo langsung berubah, satu pergerakan, tanpa penyetuju, jejak pelaku; Finance tidak tersentuh", async () => {
  const admin = await akun(["ADMIN"]); const m = await createTestMaterial({ unit: "KG" }); await seedBalance(m.id, 10);
  const f0 = await finansial(); const n0 = await testPrisma.stockMovement.count();
  const pr = await admin.c.post(`${BASE}/pratinjau`, { materialId: m.id, jumlahFisik: 7 });
  assert.equal(pr.status, 200, JSON.stringify(pr.body)); assert.equal(pr.body.langsung, true); assert.equal(pr.body.izin.langsung, true); assert.equal(await saldo(m.id), 10, "pratinjau tidak menulis");
  const r = await ajukan(admin.c, { materialId: m.id, jumlahFisik: 7, saldoDilihat: pr.body.saldoDilihat, alasan: "Hitung fisik gudang" });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.status, "POSTED"); assert.equal(r.body.langsung, true);
  assert.equal(await saldo(m.id), 7);
  assert.equal(await testPrisma.stockMovement.count(), n0 + 1);
  const mv = await testPrisma.stockMovement.findFirst({ where: { stockAdjustmentRequestId: r.body.id } });
  assert.equal(mv.type, "ADJUSTMENT"); assert.equal(Number(mv.qty), -3); assert.equal(mv.createdById, admin.user.id);
  const dok = await testPrisma.stockAdjustmentRequest.findUnique({ where: { id: r.body.id } });
  assert.equal(dok.approvedById, null, "tidak ada yang mengaku menyetujui"); assert.equal(dok.approvedAt, null); assert.equal(dok.postedById, admin.user.id); assert.equal(dok.requestedById, admin.user.id); assert.ok(dok.notes.includes(PENANDA_LANGSUNG));
  assert.deepEqual(await finansial(), f0, "tanpa jurnal, valuasi, harga");
  const det = await admin.c.get(`/api/inventory/adjustments/${r.body.id}`);
  assert.equal(det.body.koreksiLangsung, true); assert.deepEqual(det.body.tampilan.aksi, []);
  const riwayat = await admin.c.get(`${BASE}/bahan/${m.id}`);
  assert.equal(riwayat.body.riwayat[0].langsung, true); assert.equal(riwayat.body.riwayat[0].pergerakan.qty, -3);
});

test("L2 klik ganda dan serentak: satu dokumen, satu pergerakan", async () => {
  const admin = await akun(["ADMIN"]); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const key = kunci(); const body = { materialId: m.id, jumlahFisik: 4, saldoDilihat: 10, alasan: "Hitung fisik gudang" };
  const hasil = await Promise.allSettled([ajukan(admin.c, body, key), ajukan(admin.c, body, key), ajukan(admin.c, body, key)]);
  const sukses = hasil.filter((h) => h.status === "fulfilled" && [200, 201].includes(h.value.status));
  assert.ok(sukses.length >= 1, JSON.stringify(hasil.map((h) => h.value?.status)));
  assert.equal(await saldo(m.id), 4); assert.equal(await testPrisma.stockAdjustmentRequest.count({ where: { materialId: m.id } }), 1);
  const ulang = await ajukan(admin.c, body, key); assert.equal(ulang.status, 200); assert.equal(ulang.body.ulang, true); assert.equal(await saldo(m.id), 4);
  // dari form: kunci yang sama dengan isian perubahan tidak memposting lagi walau saldo sudah berubah
  const m2 = await createTestMaterial(); await seedBalance(m2.id, 10); const k2 = kunci(); const b2 = { materialId: m2.id, adjustmentType: "COUNT_DIFFERENCE", adjustmentQty: -3, reason: "Hitung ulang rak" };
  assert.equal((await form(admin.c, b2, k2)).status, 201); const u2 = await form(admin.c, b2, k2); assert.equal(u2.status, 200); assert.equal(await saldo(m2.id), 7);
});

test("L3 ditolak tanpa menyimpan apa pun: saldo bergeser, tidak ada selisih, alasan pendek, hasil minus", async () => {
  const admin = await akun(["ADMIN"]); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const nol = async () => { assert.equal(await saldo(m.id), 10); assert.equal(await testPrisma.stockAdjustmentRequest.count({ where: { materialId: m.id } }), 0); assert.equal(await testPrisma.koreksiSaldoBahan.count(), 0); };
  assert.equal((await ajukan(admin.c, { materialId: m.id, jumlahFisik: 7, saldoDilihat: 9, alasan: "Hitung fisik" })).body.code, "SALDO_BERGESER"); await nol();
  assert.equal((await ajukan(admin.c, { materialId: m.id, jumlahFisik: 10, saldoDilihat: 10, alasan: "Hitung fisik" })).body.code, "TIDAK_ADA_SELISIH"); await nol();
  assert.equal((await ajukan(admin.c, { materialId: m.id, jumlahFisik: 7, saldoDilihat: 10, alasan: "abc" })).body.code, "ALASAN_WAJIB"); await nol();
  assert.equal((await ajukan(admin.c, { materialId: m.id, jumlahFisik: -1, saldoDilihat: 10, alasan: "Hitung fisik" })).body.code, "JUMLAH_MINUS"); await nol();
  assert.equal((await form(admin.c, { materialId: m.id, adjustmentType: "COUNT_DIFFERENCE", adjustmentQty: -11, reason: "Hitung fisik" })).body.code, "HASIL_MINUS"); await nol();
  assert.equal((await form(admin.c, { materialId: m.id, adjustmentType: "COUNT_DIFFERENCE", adjustmentQty: -3, saldoDilihat: 9, reason: "Hitung fisik" })).body.code, "SALDO_BERGESER"); await nol();
});

test("L4 form Penyesuaian: saldo yang benar dan perubahan; jenis dipertahankan; konversi tetap lewat persetujuan; tab lama tanpa kunci tetap draf", async () => {
  const admin = await akun(["ADMIN"]); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const a = await form(admin.c, { materialId: m.id, adjustmentType: "DAMAGE", saldoBaru: 6, reason: "Rusak terkena air" });
  assert.equal(a.status, 201, JSON.stringify(a.body)); assert.equal(a.body.status, "POSTED"); assert.equal(a.body.adjustmentType, "DAMAGE"); assert.equal(a.body.material.id, m.id); assert.equal(await saldo(m.id), 6);
  const b = await form(admin.c, { materialId: m.id, adjustmentType: "COUNT_DIFFERENCE", adjustmentQty: 2, reason: "Temuan rak belakang", notes: "catatan" });
  assert.equal(b.body.status, "POSTED"); assert.ok(b.body.notes.startsWith("catatan")); assert.equal(await saldo(m.id), 8);
  const k = await form(admin.c, { materialId: m.id, adjustmentType: "CONVERSION", adjustmentQty: 1, reason: "Konversi satuan" });
  assert.equal(k.body.status, "DRAFT"); assert.equal(await saldo(m.id), 8);
  const lama = await admin.c.post("/api/inventory/adjustments", { materialId: m.id, adjustmentType: "COUNT_DIFFERENCE", adjustmentQty: 1, reason: "Tab lama" });
  assert.equal(lama.body.status, "DRAFT"); assert.equal(await saldo(m.id), 8);
});

test("L5 saldo minus warisan bisa dikoreksi ke fisik; bahan tanpa catatan mendapat catatan pertama; koreksi ke 0 menjadi nol terverifikasi", async () => {
  const admin = await akun(["ADMIN"]); const m = await createTestMaterial(); await seedBalance(m.id, -5);
  const r = await ajukan(admin.c, { materialId: m.id, jumlahFisik: 3, saldoDilihat: -5, alasan: "Hitung fisik" }); assert.equal(r.body.status, "POSTED", JSON.stringify(r.body)); assert.equal(await saldo(m.id), 3);
  const baru = await createTestMaterial(); const r2 = await ajukan(admin.c, { materialId: baru.id, jumlahFisik: 2, saldoDilihat: 0, alasan: "Hitung fisik" }); assert.equal(r2.body.status, "POSTED"); assert.equal(await saldo(baru.id), 2);
  const r3 = await ajukan(admin.c, { materialId: baru.id, jumlahFisik: 0, saldoDilihat: 2, alasan: "Fisik kosong" }); assert.equal(r3.body.status, "POSTED");
  assert.equal((await admin.c.get(`${BASE}/bahan/${baru.id}`)).body.keadaanSaldo, "NOL_TERVERIFIKASI");
});

test("L6 OWNER dan pemegang peran ganda ikut langsung; Gudang murni TETAP wajib persetujuan; Finance murni tetap tidak bisa menulis", async () => {
  const owner = await akun(["OWNER"]); const ganda = await akun(["ADMIN", "WAREHOUSE"]); const gudang = await akun(["WAREHOUSE"]); const fin = await akun(["FINANCE"]);
  const m1 = await createTestMaterial(); await seedBalance(m1.id, 10);
  assert.equal((await ajukan(owner.c, { materialId: m1.id, jumlahFisik: 9, saldoDilihat: 10, alasan: "Hitung fisik" })).body.status, "POSTED");
  assert.equal((await ajukan(ganda.c, { materialId: m1.id, jumlahFisik: 8, saldoDilihat: 9, alasan: "Hitung fisik" })).body.status, "POSTED"); assert.equal(await saldo(m1.id), 8);
  const m2 = await createTestMaterial(); await seedBalance(m2.id, 10);
  const pr = await gudang.c.post(`${BASE}/pratinjau`, { materialId: m2.id, jumlahFisik: 7 }); assert.equal(pr.body.langsung, false);
  const g = await ajukan(gudang.c, { materialId: m2.id, jumlahFisik: 7, saldoDilihat: 10, alasan: "Hitung fisik" });
  assert.equal(g.body.status, "WAITING_APPROVAL"); assert.equal(g.body.langsung, false); assert.equal(await saldo(m2.id), 10);
  assert.equal((await form(gudang.c, { materialId: m2.id, adjustmentType: "COUNT_DIFFERENCE", adjustmentQty: -1, reason: "Hitung fisik" })).body.status, "DRAFT"); assert.equal(await saldo(m2.id), 10);
  assert.equal((await ajukan(fin.c, { materialId: m2.id, jumlahFisik: 7, saldoDilihat: 10, alasan: "Hitung fisik" })).status, 403);
  assert.equal((await form(fin.c, { materialId: m2.id, adjustmentType: "COUNT_DIFFERENCE", saldoBaru: 7, reason: "Hitung fisik" })).status, 403);
  // Pengajuan Gudang yang berjalan menahan koreksi Admin atas bahan yang sama, supaya tidak ada dua keputusan atas saldo yang sama.
  const admin = await akun(["ADMIN"]);
  assert.equal((await ajukan(admin.c, { materialId: m2.id, jumlahFisik: 5, saldoDilihat: 10, alasan: "Hitung fisik" })).body.code, "SUDAH_ADA_PENGAJUAN_AKTIF"); assert.equal(await saldo(m2.id), 10);
});

test("L7 ADMIN tetap tidak dapat menyetujui pengajuan orang lain; jalur /post menolak dokumen tanpa persetujuan", async () => {
  const gudang = await akun(["WAREHOUSE"]); const admin = await akun(["ADMIN"]); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const g = await ajukan(gudang.c, { materialId: m.id, jumlahFisik: 7, saldoDilihat: 10, alasan: "Hitung fisik" });
  assert.equal((await admin.c.patch(`/api/inventory/adjustments/${g.body.id}`, { status: "APPROVED" })).status, 403);
  assert.equal((await admin.c.post(`/api/inventory/adjustments/${g.body.id}/post`, {})).status, 400); assert.equal(await saldo(m.id), 10);
});
