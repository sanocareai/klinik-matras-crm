// AUDIT PERGERAKAN STOK RESMI → PRATINJAU + POSTING TERKUNCI (Stock Count, Stock Adjustment, Damaged Stock, Return Record).
// Yang dikunci: (1) pratinjau BACA-SAJA (tidak menulis jurnal/gap/aktivitas) dan barisnya = baris jurnal yang diposting; (2) posting hanya bila sakelar AKTIF + tanggal mulai diisi + dokumen FINAL;
// (3) satu dokumen = satu jurnal (replay, paralel); (4) tanpa harga → gap, bukan Rp0, harga referensi Excel tidak dipakai; (5) Return Record / Retur ke Supplier / Konversi / baseline migrasi DITOLAK;
// (6) pembalikan resmi FINAL (tidak diposting ulang diam-diam); (7) atomik: galat sesudah posting membatalkan jurnal+aktivitas; (8) jurnal agregat TANPA dimensi unit/order, pemakaian PIC hanya informasi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { SETTING_KEYS, DEFAULTS } from "../../src/services/finance/settings.js";
import { pratinjau, postDokumenStok, balikDokumenStok } from "../../src/services/finance/stokResmi/index.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const KUNCI_AKTIF = [SETTING_KEYS.STOK_RESMI_OPNAME_AKTIF, SETTING_KEYS.STOK_RESMI_PENYESUAIAN_AKTIF, SETTING_KEYS.STOK_RESMI_RUSAK_AKTIF];
const KUNCI_SEJAK = [SETTING_KEYS.STOK_RESMI_OPNAME_SEJAK, SETTING_KEYS.STOK_RESMI_PENYESUAIAN_SEJAK, SETTING_KEYS.STOK_RESMI_RUSAK_SEJAK];
const set = (key, value) => testPrisma.finSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
async function dunia({ aktif = true, sejak = "2020-01-01", cutover = "" } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  await set(SETTING_KEYS.INVENTORY_CUTOVER_DATE, cutover);
  for (const k of KUNCI_AKTIF) await set(k, aktif ? "true" : "false");
  for (const k of KUNCI_SEJAK) await set(k, sejak);
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const gudang = await createTestUser({ roles: ["WAREHOUSE"] });
  const c = (u) => makeClient(server.baseUrl, u.token);
  return { a: c(admin), f: c(fin), g: c(gudang), adminUser: admin.user };
}
const terima = (materialId, qty, unitCost) => testPrisma.stockMovement.create({ data: { materialId, type: "RECEIPT", qty, unitCost, note: "seed penerimaan berharga", createdAt: new Date("2026-09-01T03:00:00Z") } });
const jurnalDari = (kunci) => testPrisma.finJournalEntry.findFirst({ where: { idempotencyKey: kunci }, include: { lines: { include: { account: { select: { systemKey: true, code: true } } } } } });
const nilai = (e, key, sisi) => e.lines.filter((l) => l.account.systemKey === key).reduce((a, l) => a + Number(l[sisi]), 0);
const hitung = async () => ({ jurnal: await testPrisma.finJournalEntry.count(), gap: await testPrisma.finPostingGap.count(), aktivitas: await testPrisma.activityEvent.count() });

/** Stock Count COMPLETED dengan satu pergerakan ADJUSTMENT (qty bertanda). */
async function hitungSelesai(materialId, delta, { nomor = "CC-010126-01", notes = null, selesai = new Date("2026-09-30T05:00:00Z") } = {}) {
  const c = await testPrisma.stockCount.create({ data: { countNumber: nomor, countType: "FULL_STOCK_OPNAME", countMethod: "FULL_WAREHOUSE", status: "COMPLETED", startedAt: new Date("2026-09-30T01:00:00Z"), completedAt: selesai, notes,
    lines: { create: [{ materialId, systemQty: 10, countedQty: 10 + delta }] } } });
  const m = await testPrisma.stockMovement.create({ data: { materialId, type: "ADJUSTMENT", qty: delta, stockCountId: c.id, note: "selisih opname", createdAt: selesai } });
  return { c, m };
}
async function penyesuaianPosted(materialId, delta, { tipe = "NEGATIVE", nomor = "ADJ-010126-01" } = {}) {
  const at = new Date("2026-09-30T05:00:00Z");
  const r = await testPrisma.stockAdjustmentRequest.create({ data: { adjustmentNumber: nomor, adjustmentType: tipe, materialId, beforeQty: 10, adjustmentQty: delta, reason: "koreksi uji", status: "POSTED", approvedAt: at, postedAt: at } });
  const m = await testPrisma.stockMovement.create({ data: { materialId, type: "ADJUSTMENT", qty: delta, stockAdjustmentRequestId: r.id, note: "penyesuaian", createdAt: at } });
  return { r, m };
}
async function rusakSelesai(materialId, qty, resolusi, { nomor = "DMG-010126-01" } = {}) {
  const at = new Date("2026-09-30T05:00:00Z");
  const r = await testPrisma.damagedStockRecord.create({ data: { recordNumber: nomor, materialId, qty, damageCategory: "TORN", status: "RESOLVED", resolution: resolusi, resolvedAt: at } });
  const m = await testPrisma.stockMovement.create({ data: { materialId, type: "WASTE", qty: -qty, damagedStockRecordId: r.id, note: "barang rusak", createdAt: at } });
  return { r, m };
}

test("pratinjau BACA-SAJA: tidak menulis jurnal/gap/aktivitas; baris pratinjau = baris jurnal yang kemudian diposting (selisih kurang → Dr Selisih Stok / Cr Persediaan)", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-SO-1", unit: "KG" });
  await terima(m.id, 10, 40_000); await terima(m.id, 10, 50_000); // rata-rata 45.000
  const { c } = await hitungSelesai(m.id, -2);
  const sebelum = await hitung();
  const p = await w.f.get(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/pratinjau`);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.deepEqual(await hitung(), sebelum, "pratinjau tidak boleh menulis apa pun");
  assert.equal(p.body.status, "SIAP");
  assert.equal(p.body.siapDiposting, true);
  assert.equal(p.body.nilai.total, 90_000);
  assert.equal(p.body.jurnal.seimbang, true);
  assert.equal(p.body.jurnal.kunciIdempotensi, `SELISIH_OPNAME:${c.id}`);
  assert.equal(p.body.atribusi.keOrder, false); assert.equal(p.body.atribusi.keUnit, false);
  const dr = p.body.jurnal.baris.find((b) => b.debit > 0); const kr = p.body.jurnal.baris.find((b) => b.kredit > 0);
  assert.equal(dr.akun.systemKey, "SELISIH_STOK"); assert.equal(kr.akun.systemKey, "PERSEDIAAN_BAHAN");

  const r = await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "Selisih opname disetujui Finance" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const e = await jurnalDari(`SELISIH_OPNAME:${c.id}`);
  assert.ok(e); assert.equal(e.status, "POSTED");
  assert.equal(nilai(e, "SELISIH_STOK", "debit"), dr.debit);
  assert.equal(nilai(e, "PERSEDIAAN_BAHAN", "credit"), kr.kredit);
  assert.equal(e.lines.every((l) => !l.unitId && !l.orderId), true, "jurnal agregat: tanpa dimensi unit/order");
  // setelah diposting pratinjau melaporkan SUDAH_DIPOSTING dan tidak siap lagi
  const p2 = await w.f.get(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/pratinjau`);
  assert.equal(p2.body.siapDiposting, false);
  assert.ok(p2.body.penolakan.some((x) => x.kode === "SUDAH_DIPOSTING"));
});

test("selisih lebih (opname +) → Dr Persediaan / Cr Selisih Stok; penyesuaian jenis DAMAGE → Beban Susut; susut barang rusak DISPOSE → Beban Susut", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-MIX-1", unit: "KG" });
  await terima(m.id, 20, 10_000);
  const { c } = await hitungSelesai(m.id, +3);
  assert.equal((await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "Selisih lebih opname" })).status, 201);
  const e1 = await jurnalDari(`SELISIH_OPNAME:${c.id}`);
  assert.equal(nilai(e1, "PERSEDIAAN_BAHAN", "debit"), 30_000); assert.equal(nilai(e1, "SELISIH_STOK", "credit"), 30_000);

  const { r } = await penyesuaianPosted(m.id, -1, { tipe: "DAMAGE" });
  assert.equal((await w.a.post(`/api/finance/stok-resmi/STOCK_ADJUSTMENT/${r.id}/posting`, { alasan: "Kerusakan terbukti" })).status, 201);
  const e2 = await jurnalDari(`SELISIH_PENYESUAIAN:${r.id}`);
  assert.equal(nilai(e2, "BEBAN_SUSUT_BAHAN", "debit"), 10_000); assert.equal(nilai(e2, "PERSEDIAAN_BAHAN", "credit"), 10_000);

  const { r: d } = await rusakSelesai(m.id, 2, "DISPOSE");
  assert.equal((await w.a.post(`/api/finance/stok-resmi/DAMAGED_STOCK/${d.id}/posting`, { alasan: "Dimusnahkan" })).status, 201);
  const e3 = await jurnalDari(`SUSUT_BARANG_RUSAK:${d.id}`);
  assert.equal(nilai(e3, "BEBAN_SUSUT_BAHAN", "debit"), 20_000); assert.equal(nilai(e3, "PERSEDIAAN_BAHAN", "credit"), 20_000);
});

test("sakelar MATI (default): posting 409 FITUR_BELUM_AKTIF tanpa jurnal; tanggal mulai kosong / dokumen sebelum tanggal mulai juga ditolak", async () => {
  const mati = await dunia({ aktif: false });
  const m = await createTestMaterial({ code: "BHN-MATI", unit: "KG" });
  await terima(m.id, 10, 10_000);
  const { c } = await hitungSelesai(m.id, -1);
  const r = await mati.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "uji sakelar mati" });
  assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, "FITUR_BELUM_AKTIF");
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
  const p = await mati.f.get(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/pratinjau`);
  assert.equal(p.status, 200); assert.equal(p.body.siapDiposting, false);
  assert.ok(p.body.peringatan.some((x) => x.kode === "FITUR_BELUM_AKTIF"));

  await set(SETTING_KEYS.STOK_RESMI_OPNAME_AKTIF, "true"); await set(SETTING_KEYS.STOK_RESMI_OPNAME_SEJAK, "");
  const k = await mati.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "uji tanggal kosong" });
  assert.equal(k.status, 422); assert.equal(k.body.code, "TANGGAL_AKTIVASI_BELUM_DIISI");

  await set(SETTING_KEYS.STOK_RESMI_OPNAME_SEJAK, "2026-10-01"); // dokumen 30 Sep → sebelum tanggal mulai
  const k2 = await mati.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "uji periode" });
  assert.equal(k2.status, 422); assert.equal(k2.body.code, "DI_LUAR_PERIODE_AKTIVASI");
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
});

test("dokumen belum FINAL ditolak (Stock Count belum COMPLETED), tetapi pratinjau tetap menampilkan niat selisihnya", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-BLM", unit: "KG" });
  await terima(m.id, 10, 10_000);
  const c = await testPrisma.stockCount.create({ data: { countNumber: "CC-010126-09", countType: "CYCLE_COUNT", countMethod: "BY_ITEM", status: "WAITING_REVIEW", startedAt: new Date("2026-09-30T01:00:00Z"), lines: { create: [{ materialId: m.id, systemQty: 10, countedQty: 8 }] } } });
  const p = await w.f.get(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/pratinjau`);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.status, "BELUM_FINAL"); assert.equal(p.body.siapDiposting, false);
  assert.equal(p.body.nilai.total, 20_000);
  const r = await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "coba posting terlalu dini" });
  assert.equal(r.status, 422); assert.equal(r.body.code, "DOKUMEN_BELUM_FINAL");
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
});

test("jenis yang DITOLAK: Return Record, Retur ke Supplier, Konversi, baseline migrasi — 422 dengan kode, tanpa jurnal", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-TOLAK", unit: "KG" });
  await terima(m.id, 50, 10_000);
  const at = new Date("2026-09-30T05:00:00Z");
  const rr = await testPrisma.returnRecord.create({ data: { returnNumber: "RTN-010126-01", returnType: "CUSTOMER_RETURN", materialId: m.id, qty: 2, status: "COMPLETED", resolution: "RETURN_TO_AVAILABLE", completedAt: at } });
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RETURN", qty: 2, returnRecordId: rr.id, createdAt: at } });
  const { r: ds } = await rusakSelesai(m.id, 1, "RETURN_TO_SUPPLIER", { nomor: "DMG-010126-02" });
  const { r: cv } = await penyesuaianPosted(m.id, -1, { tipe: "CONVERSION", nomor: "ADJ-010126-02" });
  const { c: bl } = await hitungSelesai(m.id, +5, { nomor: "BASELINE-0001", notes: "Backfill saldo pembuka dari migrasi" });
  const kasus = [
    ["RETURN_RECORD", rr.id, "ASAL_RETUR_TIDAK_TERBUKTI"], ["DAMAGED_STOCK", ds.id, "RETUR_SUPPLIER_BUKAN_SUSUT"],
    ["STOCK_ADJUSTMENT", cv.id, "KONVERSI_BUTUH_PASANGAN"], ["STOCK_COUNT", bl.id, "BASELINE_MIGRASI_TIDAK_DIJURNALKAN"],
  ];
  for (const [jenis, id, kode] of kasus) {
    const p = await w.f.get(`/api/finance/stok-resmi/${jenis}/${id}/pratinjau`);
    assert.equal(p.status, 200); assert.equal(p.body.status, "DITOLAK", jenis); assert.equal(p.body.siapDiposting, false, jenis);
    assert.ok(p.body.penolakan.some((x) => x.kode === kode), `${jenis} harus menolak dengan ${kode}: ${JSON.stringify(p.body.penolakan)}`);
    const r = await w.a.post(`/api/finance/stok-resmi/${jenis}/${id}/posting`, { alasan: "uji penolakan" });
    assert.equal(r.status, 422, `${jenis}: ${JSON.stringify(r.body)}`); assert.equal(r.body.code, kode);
  }
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
  assert.equal(await testPrisma.finPostingGap.count(), 0);
});

test("tanpa harga perolehan: gap TANPA_HARGA_PEROLEHAN, TIDAK ada jurnal Rp0; harga referensi Excel tidak dipakai", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-NOHARGA", unit: "KG", referenceUnitCost: 99_000, referenceUnitCostMonth: "2026-08" });
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 10, note: "stok awal tanpa harga", createdAt: new Date("2026-09-01T03:00:00Z") } });
  const { c } = await hitungSelesai(m.id, -2);
  const p = await w.f.get(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/pratinjau`);
  assert.equal(p.body.status, "MENUNGGU_HARGA"); assert.equal(p.body.nilai.total, 0);
  assert.equal(p.body.gapTanpaHarga.length, 1); assert.equal(p.body.gapTanpaHarga[0].kode, "TANPA_HARGA_PEROLEHAN");
  assert.equal(p.body.jurnal.baris.length, 0);
  const r = await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "posting tanpa harga" });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, "GAP_DICATAT");
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
  const gaps = await testPrisma.finPostingGap.findMany({ where: { source: "PEMAKAIAN_BAHAN", sourceId: c.id, resolvedAt: null } });
  assert.equal(gaps.length, 1); assert.equal(gaps[0].reason, "TANPA_HARGA_PEROLEHAN");
  // harga masuk kemudian → posting ulang membuat jurnal & menutup gap
  await terima(m.id, 5, 20_000); // harga perolehan masuk (tanggal efektif sebelum pergerakan opname)
  const r2 = await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "harga sudah ada" });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal(await testPrisma.finJournalEntry.count(), 1);
  assert.equal((await testPrisma.finPostingGap.findMany({ where: { source: "PEMAKAIAN_BAHAN", sourceId: c.id, resolvedAt: null } })).length, 0);
});

test("idempotensi & replay: posting dua kali = satu jurnal; paralel 6 permintaan = satu jurnal", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-PAR", unit: "KG" });
  await terima(m.id, 10, 10_000);
  const { c } = await hitungSelesai(m.id, -2);
  const url = `/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`;
  const hasil = await Promise.all(Array.from({ length: 6 }, () => w.a.post(url, { alasan: "paralel uji" })));
  assert.ok(hasil.every((h) => [200, 201].includes(h.status)), JSON.stringify(hasil.map((h) => h.status)));
  assert.equal(hasil.filter((h) => h.status === 201).length, 1, "tepat satu yang membuat jurnal");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { idempotencyKey: `SELISIH_OPNAME:${c.id}` } }), 1);
  const ulang = await w.a.post(url, { alasan: "replay uji" });
  assert.equal(ulang.status, 200); assert.equal(ulang.body.status, "SUDAH_DIPOSTING"); assert.equal(ulang.body.dibuat, false);
  assert.equal(await testPrisma.finJournalEntry.count(), 1);
});

test("pembalikan: jurnal REVERSED + jurnal balik; pembalikan ulang idempoten; posting ulang TIDAK membuat jurnal baru (final)", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-REV", unit: "KG" });
  await terima(m.id, 10, 10_000);
  const { c } = await hitungSelesai(m.id, -2);
  await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "posting awal" });
  const b = await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/pembalikan`, { alasan: "salah hitung fisik" });
  assert.equal(b.status, 201, JSON.stringify(b.body)); assert.equal(b.body.status, "DIBALIK");
  const e = await jurnalDari(`SELISIH_OPNAME:${c.id}`);
  assert.equal(e.status, "REVERSED");
  assert.equal(await testPrisma.finJournalEntry.count(), 2);
  const b2 = await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/pembalikan`, { alasan: "pembalikan ulang" });
  assert.equal(b2.status, 200); assert.equal(b2.body.status, "SUDAH_DIBALIK");
  const lagi = await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "coba posting ulang" });
  assert.equal(lagi.status, 200); assert.equal(lagi.body.status, "SUDAH_DIBALIK");
  assert.equal(await testPrisma.finJournalEntry.count(), 2, "tidak ada jurnal ketiga");
  // belum pernah dijurnal → tidak ada yang dibalik
  const { c: c2 } = await hitungSelesai(m.id, -1, { nomor: "CC-010126-02" });
  const x = await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c2.id}/pembalikan`, { alasan: "tidak ada jurnal" });
  assert.equal(x.status, 409); assert.equal(x.body.code, "BELUM_DIPOSTING");
});

test("atomik: galat SETELAH posting di transaksi yang sama membatalkan jurnal, gap, dan aktivitas", async () => {
  await dunia();
  const m = await createTestMaterial({ code: "BHN-ATOM", unit: "KG" });
  await terima(m.id, 10, 10_000);
  const { c } = await hitungSelesai(m.id, -2);
  const sebelum = await hitung();
  await assert.rejects(testPrisma.$transaction(async (tx) => {
    const h = await postDokumenStok(tx, { jenis: "STOCK_COUNT", id: c.id, userId: null, alasan: "uji atomik rollback" });
    assert.equal(h.status, "DIPOSTING");
    throw new Error("galat sengaja");
  }), /galat sengaja/);
  assert.deepEqual(await hitung(), sebelum);
  // dan setelahnya posting normal tetap bisa (kunci tidak 'terpakai' oleh transaksi yang dibatalkan)
  await testPrisma.$transaction((tx) => postDokumenStok(tx, { jenis: "STOCK_COUNT", id: c.id, userId: null, alasan: "uji atomik sukses" }));
  assert.equal(await testPrisma.finJournalEntry.count(), 1);
});

test("periode tertutup: posting ditolak penuh (tanpa jurnal/gap/aktivitas parsial) dan bisa diposting setelah periode dibuka", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-TUTUP", unit: "KG" });
  await terima(m.id, 10, 10_000);
  const { c } = await hitungSelesai(m.id, -1); // tanggal dokumen 30 Sep 2026 WIB
  await testPrisma.finPeriod.upsert({ where: { year_month: { year: 2026, month: 9 } }, update: { status: "CLOSED" }, create: { year: 2026, month: 9, status: "CLOSED" } });
  const sebelum = await hitung();
  const r = await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "periode tertutup uji" });
  assert.ok([400, 409, 422].includes(r.status), JSON.stringify(r.body));
  assert.deepEqual(await hitung(), sebelum, "gagal = tidak ada jejak parsial");
  await testPrisma.finPeriod.update({ where: { year_month: { year: 2026, month: 9 } }, data: { status: "OPEN" } });
  const ok = await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "periode dibuka uji" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

test("cutover Opname baru: dokumen bertanggal setelah cutover tanpa persediaan awal diposting → gap PERSEDIAAN_AWAL_BELUM_DIPOSTING, bukan jurnal negatif; pratinjau MENUNGGU_PERSEDIAAN_AWAL", async () => {
  const w = await dunia({ cutover: "2026-09-15" });
  const m = await createTestMaterial({ code: "BHN-CUT", unit: "KG" });
  await terima(m.id, 10, 10_000);
  const { c } = await hitungSelesai(m.id, -2);
  const p = await w.f.get(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/pratinjau`);
  assert.equal(p.body.status, "MENUNGGU_PERSEDIAAN_AWAL"); assert.equal(p.body.statusCutover.status, "tunggu_pembuka");
  assert.equal(p.body.jurnal.akanDibukukan, false);
  assert.ok(p.body.peringatan.some((x) => x.kode === "PERSEDIAAN_AWAL_BELUM_DIPOSTING"));
  const r = await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "sebelum persediaan awal" });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, "GAP_DICATAT");
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
  const gaps = await testPrisma.finPostingGap.findMany({ where: { source: "PEMAKAIAN_BAHAN", sourceId: c.id, resolvedAt: null } });
  assert.equal(gaps.length, 1); assert.equal(gaps[0].reason, "PERSEDIAAN_AWAL_BELUM_DIPOSTING");
});

test("pergerakan opname TIDAK mengubah stok/jurnal produksi: posting hanya menambah SATU jurnal agregat, ledger stok & jurnal HPP Material Issue tidak disentuh", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-ISOLASI", unit: "KG" });
  await terima(m.id, 20, 10_000);
  const iss = await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ISSUE", qty: -3, note: "pemakaian lantai", createdAt: new Date("2026-09-20T03:00:00Z") } });
  const { c } = await hitungSelesai(m.id, -2);
  const stokSebelum = await testPrisma.stockMovement.findMany({ orderBy: { id: "asc" } });
  const r = await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "isolasi uji" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(await testPrisma.stockMovement.findMany({ orderBy: { id: "asc" } }), stokSebelum, "ledger stok tidak berubah");
  assert.equal(await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${iss.id}`), null, "ISSUE historis tidak ikut dijurnal (tanpa backfill)");
  assert.equal(await testPrisma.finJournalEntry.count(), 1);
  assert.equal(await testPrisma.finStockMovementValuation.count(), 0, "nilai beku jejak biaya unit tidak ditulis");
});

test("pembatasan izin: Gudang tidak boleh pratinjau/posting; Finance boleh pratinjau tetapi tidak posting; dokumen/jenis tak dikenal → 400/404", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-IZIN", unit: "KG" });
  await terima(m.id, 10, 10_000);
  const { c } = await hitungSelesai(m.id, -1);
  assert.equal((await w.g.get(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/pratinjau`)).status, 403);
  assert.equal((await w.g.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "izin gudang" })).status, 403);
  assert.equal((await w.f.get(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/pratinjau`)).status, 200);
  assert.equal((await w.f.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "izin finance" })).status, 403);
  assert.equal((await w.a.get(`/api/finance/stok-resmi/NGAWUR/${c.id}/pratinjau`)).status, 400);
  assert.equal((await w.a.get(`/api/finance/stok-resmi/STOCK_COUNT/bukan-uuid/pratinjau`)).status, 400);
  assert.equal((await w.a.get(`/api/finance/stok-resmi/STOCK_COUNT/00000000-0000-4000-8000-000000000000/pratinjau`)).status, 404);
  assert.equal((await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "x" })).status, 400);
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
});

test("pengaturan: tiga sakelar per jenis, SEMUA default mati + tanpa tanggal; PATCH memvalidasi nilai & tanggal (kalender valid)", async () => {
  const w = await dunia({ aktif: false, sejak: "" });
  for (const k of KUNCI_AKTIF) assert.equal(DEFAULTS[k], "false", k);
  for (const k of KUNCI_SEJAK) assert.equal(DEFAULTS[k], "", k);
  assert.equal(Object.keys(DEFAULTS).filter((k) => k.startsWith("stok_resmi_")).length, 6);
  await testPrisma.finSetting.deleteMany({ where: { key: { startsWith: "stok_resmi_" } } }); // tanpa baris sama sekali = default
  const s = await w.a.get("/api/finance/settings");
  assert.equal(s.status, 200);
  const baca = (k) => String(s.body.settings?.[k] ?? s.body[k]);
  for (const k of KUNCI_AKTIF) assert.equal(baca(k), "false", k);
  for (const k of KUNCI_SEJAK) assert.equal(baca(k), "", k);
  for (const k of KUNCI_AKTIF) assert.equal((await w.a.patch("/api/finance/settings", { settings: { [k]: "mungkin" } })).status, 400, k);
  for (const k of KUNCI_SEJAK) {
    assert.equal((await w.a.patch("/api/finance/settings", { settings: { [k]: "1 Oktober" } })).status, 400, k);
    assert.equal((await w.a.patch("/api/finance/settings", { settings: { [k]: "2026-13-45" } })).status, 400, k);
    assert.equal((await w.a.patch("/api/finance/settings", { settings: { [k]: "2026-02-31" } })).status, 400, k);
    assert.equal((await w.a.patch("/api/finance/settings", { settings: { [k]: "2026-10-16" } })).status, 200, k);
    assert.equal((await w.a.patch("/api/finance/settings", { settings: { [k]: "" } })).status, 200, k);
    assert.equal((await testPrisma.finSetting.findUnique({ where: { key: k } })).value, "", k);
  }
  assert.equal((await w.f.patch("/api/finance/settings", { settings: { [KUNCI_AKTIF[0]]: "true" } })).status, 403, "Finance biasa tidak boleh menyalakan sakelar");
});

test("matriks jurnal: GET /stok-resmi/matriks memuat 6 aksi dan menandai yang DITOLAK", async () => {
  const w = await dunia();
  const r = await w.f.get("/api/finance/stok-resmi/matriks");
  assert.equal(r.status, 200);
  assert.equal(r.body.matriks.length, 6);
  assert.equal(r.body.matriks.filter((x) => x.posting === "DITOLAK").length, 3, JSON.stringify(r.body.matriks.map((x) => [x.jenis, x.aksi, x.posting])));
});

test("sakelar PER JENIS: menyalakan satu jenis tidak membuka jenis lain; tanggal mulai per jenis; Return Record tidak punya sakelar", async () => {
  const w = await dunia({ aktif: false });
  const m = await createTestMaterial({ code: "BHN-PERJENIS", unit: "KG" });
  await terima(m.id, 20, 10_000);
  await set(SETTING_KEYS.STOK_RESMI_OPNAME_AKTIF, "true"); await set(SETTING_KEYS.STOK_RESMI_OPNAME_SEJAK, "2020-01-01");
  const { c } = await hitungSelesai(m.id, -1);
  const { r } = await penyesuaianPosted(m.id, -1);
  const { r: d } = await rusakSelesai(m.id, 1, "DISPOSE");
  const rr = await testPrisma.returnRecord.create({ data: { returnNumber: "RTN-010126-07", returnType: "CUSTOMER_RETURN", materialId: m.id, qty: 1, status: "COMPLETED", resolution: "RETURN_TO_AVAILABLE", completedAt: new Date("2026-09-30T05:00:00Z") } });
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RETURN", qty: 1, returnRecordId: rr.id, createdAt: new Date("2026-09-30T05:00:00Z") } });
  assert.equal((await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "opname boleh" })).status, 201);
  const adj = await w.a.post(`/api/finance/stok-resmi/STOCK_ADJUSTMENT/${r.id}/posting`, { alasan: "penyesuaian belum" });
  assert.equal(adj.status, 409); assert.equal(adj.body.code, "FITUR_BELUM_AKTIF");
  const dm = await w.a.post(`/api/finance/stok-resmi/DAMAGED_STOCK/${d.id}/posting`, { alasan: "rusak belum" });
  assert.equal(dm.status, 409); assert.equal(dm.body.code, "FITUR_BELUM_AKTIF");
  await set(SETTING_KEYS.STOK_RESMI_PENYESUAIAN_AKTIF, "true"); await set(SETTING_KEYS.STOK_RESMI_PENYESUAIAN_SEJAK, "2026-10-01");
  assert.equal((await w.a.post(`/api/finance/stok-resmi/STOCK_ADJUSTMENT/${r.id}/posting`, { alasan: "tanggal mulai setelah dokumen" })).body.code, "DI_LUAR_PERIODE_AKTIVASI");
  assert.equal((await w.a.post(`/api/finance/stok-resmi/DAMAGED_STOCK/${d.id}/posting`, { alasan: "rusak masih mati" })).body.code, "FITUR_BELUM_AKTIF");
  for (const k of KUNCI_AKTIF) await set(k, "true");
  for (const k of KUNCI_SEJAK) await set(k, "2020-01-01");
  const rt = await w.a.post(`/api/finance/stok-resmi/RETURN_RECORD/${rr.id}/posting`, { alasan: "retur tetap ditolak" });
  assert.equal(rt.status, 422); assert.equal(rt.body.code, "ASAL_RETUR_TIDAK_TERBUKTI");
  const rb = await w.a.post(`/api/finance/stok-resmi/RETURN_RECORD/${rr.id}/pembalikan`, { alasan: "retur tetap ditolak" });
  assert.equal(rb.status, 409);
  assert.equal(await testPrisma.finJournalEntry.count(), 1, "hanya jurnal opname");
});

test("SAKELAR MATI menolak SETIAP endpoint posting & pembalikan di SEMUA jenis dan kondisi dokumen — nol perubahan stok, jurnal, gap, aktivitas bisnis", async () => {
  const w = await dunia({ aktif: false });
  const m = await createTestMaterial({ code: "BHN-MATI-SEMUA", unit: "KG" });
  await terima(m.id, 30, 10_000);
  const { c } = await hitungSelesai(m.id, -1);
  const { c: bl } = await hitungSelesai(m.id, +5, { nomor: "BASELINE-0002", notes: "Backfill saldo pembuka dari migrasi" });
  const { r } = await penyesuaianPosted(m.id, -1);
  const { r: cv } = await penyesuaianPosted(m.id, -1, { tipe: "CONVERSION", nomor: "ADJ-010126-05" });
  const { r: d } = await rusakSelesai(m.id, 1, "DISPOSE");
  const { r: ds } = await rusakSelesai(m.id, 1, "RETURN_TO_SUPPLIER", { nomor: "DMG-010126-05" });
  const rr = await testPrisma.returnRecord.create({ data: { returnNumber: "RTN-010126-05", returnType: "CUSTOMER_RETURN", materialId: m.id, qty: 1, status: "COMPLETED", resolution: "RETURN_TO_AVAILABLE", completedAt: new Date("2026-09-30T05:00:00Z") } });
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RETURN", qty: 1, returnRecordId: rr.id, createdAt: new Date("2026-09-30T05:00:00Z") } });
  const dok = [["STOCK_COUNT", c.id], ["STOCK_COUNT", bl.id], ["STOCK_ADJUSTMENT", r.id], ["STOCK_ADJUSTMENT", cv.id], ["DAMAGED_STOCK", d.id], ["DAMAGED_STOCK", ds.id], ["RETURN_RECORD", rr.id]];
  const potret = async () => ({ ...(await hitung()), stok: await testPrisma.stockMovement.findMany({ orderBy: { id: "asc" } }) });
  const sebelum = await potret();
  for (const klien of [w.a, w.f]) for (const [jenis, id] of dok) {
    for (const aksi of ["posting", "pembalikan"]) {
      const x = await klien.post(`/api/finance/stok-resmi/${jenis}/${id}/${aksi}`, { alasan: "uji sakelar mati semua" });
      assert.ok([403, 409, 422].includes(x.status), `${jenis} ${aksi}: ${x.status} ${JSON.stringify(x.body)}`);
    }
  }
  assert.deepEqual(await potret(), sebelum, "tidak ada satu pun perubahan stok/jurnal/gap/aktivitas");
  for (const [jenis, id] of dok) {
    await assert.rejects(testPrisma.$transaction((tx) => postDokumenStok(tx, { jenis, id, userId: null, alasan: "langsung mati" })), (e) => [409, 422].includes(e.statusCode));
    await assert.rejects(testPrisma.$transaction((tx) => balikDokumenStok(tx, { jenis, id, userId: null, alasan: "langsung mati" })), (e) => e.statusCode === 409);
  }
  assert.deepEqual(await potret(), sebelum);
});

test("PRATINJAU benar-benar baca-saja: 24 panggilan paralel di semua jenis/kondisi tidak mengubah satu baris pun di tabel mana pun; transaksi READ ONLY menolak tulis di level Postgres", async () => {
  const w = await dunia({ aktif: true });
  const m = await createTestMaterial({ code: "BHN-RO", unit: "KG" });
  await terima(m.id, 30, 10_000);
  const { c } = await hitungSelesai(m.id, -2);
  const { c: bl } = await hitungSelesai(m.id, +5, { nomor: "BASELINE-0003", notes: "Backfill saldo pembuka dari migrasi" });
  const sedang = await testPrisma.stockCount.create({ data: { countNumber: "CC-010126-08", countType: "CYCLE_COUNT", countMethod: "BY_ITEM", status: "WAITING_REVIEW", startedAt: new Date("2026-09-30T01:00:00Z"), lines: { create: [{ materialId: m.id, systemQty: 30, countedQty: 27 }] } } });
  const { r } = await penyesuaianPosted(m.id, -1);
  const { r: d } = await rusakSelesai(m.id, 1, "DISPOSE");
  const rr = await testPrisma.returnRecord.create({ data: { returnNumber: "RTN-010126-08", returnType: "CUSTOMER_RETURN", materialId: m.id, qty: 1, status: "COMPLETED", resolution: "RETURN_TO_AVAILABLE", completedAt: new Date("2026-09-30T05:00:00Z") } });
  const dok = [["STOCK_COUNT", c.id], ["STOCK_COUNT", bl.id], ["STOCK_COUNT", sedang.id], ["STOCK_ADJUSTMENT", r.id], ["DAMAGED_STOCK", d.id], ["RETURN_RECORD", rr.id]];
  const tabel = (await testPrisma.$queryRawUnsafe("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name <> '_prisma_migrations' order by 1")).map((x) => x.table_name);
  const potret = async () => { const o = {}; for (const t of tabel) o[t] = (await testPrisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from "${t}" x`))[0]; return o; };
  const sebelum = await potret();
  const hasil = await Promise.all(Array.from({ length: 4 }, () => dok.map(([jenis, id]) => w.f.get(`/api/finance/stok-resmi/${jenis}/${id}/pratinjau`))).flat());
  assert.ok(hasil.every((h) => h.status === 200), JSON.stringify(hasil.map((h) => h.status)));
  assert.deepEqual(await potret(), sebelum, "pratinjau paralel tidak mengubah satu baris pun di tabel mana pun");
  await assert.rejects(testPrisma.$transaction(async (tx) => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); await tx.finSetting.create({ data: { key: "uji_ro", value: "x" } }); }), /read-only|READ ONLY/i);
  for (const [jenis, id] of dok) {
    const p = await testPrisma.$transaction(async (tx) => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); return pratinjau(tx, jenis, id, {}); });
    assert.ok(p.status, jenis);
  }
});

test("izin: pratinjau = finance:read (ADMIN/OWNER/FINANCE/ACCOUNTANT/APPROVER); posting & pembalikan = finance:admin saja (ADMIN/OWNER); peran lain 403 dan tidak menulis", async () => {
  await dunia({ aktif: true });
  const m = await createTestMaterial({ code: "BHN-IZIN2", unit: "KG" });
  await terima(m.id, 10, 10_000);
  const { c } = await hitungSelesai(m.id, -1);
  const url = `/api/finance/stok-resmi/STOCK_COUNT/${c.id}`;
  const klien = async (role) => makeClient(server.baseUrl, (await createTestUser({ roles: [role] })).token);
  for (const role of ["ADMIN", "OWNER", "FINANCE", "ACCOUNTANT", "APPROVER"]) assert.equal((await (await klien(role)).get(`${url}/pratinjau`)).status, 200, role);
  for (const role of ["SALES", "WAREHOUSE", "PRODUCTION_LEAD", "QC_LEAD", "DISPATCHER", "DRIVER", "PRODUCTION_WORKER"]) {
    const k = await klien(role);
    assert.equal((await k.get(`${url}/pratinjau`)).status, 403, role);
    assert.equal((await k.get("/api/finance/stok-resmi/matriks")).status, 403, role);
  }
  for (const role of ["FINANCE", "ACCOUNTANT", "APPROVER", "SALES", "WAREHOUSE", "PRODUCTION_LEAD"]) {
    const k = await klien(role);
    assert.equal((await k.post(`${url}/posting`, { alasan: "tanpa izin admin" })).status, 403, role);
    assert.equal((await k.post(`${url}/pembalikan`, { alasan: "tanpa izin admin" })).status, 403, role);
  }
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
  assert.equal((await (await klien("OWNER")).post(`${url}/posting`, { alasan: "owner boleh" })).status, 201);
});

test("pembalikan tanpa sakelar jenisnya ditolak 409 (tidak ada jalur belakang saat fitur mati); sakelar jenis lain tidak membantu", async () => {
  const w = await dunia({ aktif: true });
  const m = await createTestMaterial({ code: "BHN-REVOFF", unit: "KG" });
  await terima(m.id, 10, 10_000);
  const { c } = await hitungSelesai(m.id, -1);
  assert.equal((await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/posting`, { alasan: "posting lalu matikan" })).status, 201);
  await set(SETTING_KEYS.STOK_RESMI_OPNAME_AKTIF, "false");
  const r = await w.a.post(`/api/finance/stok-resmi/STOCK_COUNT/${c.id}/pembalikan`, { alasan: "sakelar opname mati" });
  assert.equal(r.status, 409); assert.equal(r.body.code, "FITUR_BELUM_AKTIF");
  assert.equal((await jurnalDari(`SELISIH_OPNAME:${c.id}`)).status, "POSTED");
});
