// JEJAK BIAYA BAHAN PER UNIT (PO → penerimaan → Material Issue → pemakaian PIC → waste/retur → faktur).
// Yang dikunci: (1) nilai & dasar harga DIBEKUKAN di transaksi pergerakan (tidak berubah oleh penerimaan bertanggal mundur); (2) biaya persediaan menurut harga PO,
// selisih harga faktur terpisah; (3) TANPA_HARGA bukan Rp0, ESTIMASI_HISTORIS/BELUM_FINAL tidak masuk total pasti; (4) retur mengurangi biaya saat Gudang menerima;
// (5) catatan PIC tidak memposting stok/jurnal; read-model tidak menulis apa pun; (6) izin harga; (7) replay, pembatalan, paralel.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { bawaSampaiSiap, catatTibaResmi } from "./setup/kedatangan.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { SETTING_KEYS } from "../../src/services/finance/settings.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const H1 = 43_290; const H2 = 50_000;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  // Tanpa cutover persediaan (status "biasa") supaya HPP pemakaian dokumen terjurnal di lingkungan uji; produksi sudah perpetual dengan persediaan awal terposting.
  await testPrisma.finSetting.upsert({ where: { key: SETTING_KEYS.INVENTORY_CUTOVER_DATE }, update: { value: "" }, create: { key: SETTING_KEYS.INVENTORY_CUTOVER_DATE, value: "" } });
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const gudang = await createTestUser({ roles: ["WAREHOUSE"] });
  const prod = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-ESA", name: "PT ESA BUMINDO" } });
  const lem = await createTestMaterial({ code: "LEM-1037", name: "LEM I-SR 1037 13 KG", unit: "KG" });
  const { unit, order } = await createTestUnit();
  return { f: c(fin), a: c(admin), g: c(gudang), p: c(prod), s: c(sales), fin, admin, gudang, prod, supplier, lem, unit, order };
}

async function poDisetujui(w, { qty, harga, material = w.lem }) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: material.id, qty, unitPrice: harga }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}
async function penerimaan(w, po, { baik }) {
  const gr = await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.id });
  assert.equal(gr.status, 201, JSON.stringify(gr.body));
  await bawaSampaiSiap(w.g, gr.body, { datang: baik, baik });
  assert.equal((await w.g.post(`/api/inventory/goods-receipts/${gr.body.id}/putaway`, {})).status, 200);
  return gr.body;
}
/** Material Issue penuh (Draft → ... → Issued) ke unit. */
async function issueKeUnit(w, materialId, qty, { sampaiIssue = true } = {}) {
  const c = await w.g.post("/api/inventory/material-issues", { sourceType: "PRODUCTION_WORK_ORDER", unitId: w.unit.id, lines: [{ materialId, requestedQty: qty }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  for (const st of ["WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"]) assert.equal((await w.g.patch(`/api/inventory/material-issues/${c.body.id}`, { status: st })).status, 200);
  if (!sampaiIssue) return c.body;
  const r = await w.g.post(`/api/inventory/material-issues/${c.body.id}/issue`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return c.body;
}
const jejak = async (w, klien = w.f) => (await klien.get(`/api/finance/biaya-bahan/unit/${w.unit.id}`)).body;
const bahanDari = (j, kode) => j.bahan.find((b) => b.kode === kode);
async function cacahLedger() {
  const j = await testPrisma.finJournalLine.aggregate({ _sum: { debit: true, credit: true } });
  return { stok: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), baris: await testPrisma.finJournalLine.count(), d: String(j._sum.debit ?? 0), k: String(j._sum.credit ?? 0), gap: await testPrisma.finPostingGap.count() };
}

// ═══ SATU UNIT, SKENARIO LENGKAP ═══════════════════════════════════════════════════════════════════════════════════
test("satu unit: penerimaan parsial PO, beberapa Material Issue, waste, retur, faktur beda harga, TANPA_HARGA, tanpa PO, pemakaian PIC — nilai beku & terpisah dari selisih faktur", async () => {
  const w = await dunia();
  const matB = await createTestMaterial({ code: "BHN-TANPA-HARGA", name: "Bahan tanpa harga", unit: "PCS" });
  const matC = await createTestMaterial({ code: "BHN-TANPA-PO", name: "Bahan tanpa PO", unit: "PCS" });

  // 1. PO1 10 KG @43.290; penerimaan PARSIAL 6 baik.
  const po1 = await poDisetujui(w, { qty: 10, harga: H1 });
  const r1 = await penerimaan(w, po1, { baik: 6 });
  // 2. Material Issue #1: 3 KG ke unit → nilai beku 3 × 43.290.
  const mi1 = await issueKeUnit(w, w.lem.id, 3);
  let j = await jejak(w);
  assert.equal(bahanDari(j, "LEM-1037").pergerakan[0].nilai, 129_870);
  assert.equal(bahanDari(j, "LEM-1037").pergerakan[0].hargaDasar, H1);
  assert.equal(bahanDari(j, "LEM-1037").pergerakan[0].sumber[0].poNumber, po1.poNumber);
  assert.equal(bahanDari(j, "LEM-1037").pergerakan[0].sumber[0].receiptNumber, r1.receiptNumber);
  // 3. PO2 10 KG @50.000; penerimaan parsial 4 baik → rata-rata tertimbang (6×43.290 + 4×50.000)/10 = 45.974.
  const po2 = await poDisetujui(w, { qty: 10, harga: H2 });
  const r2 = await penerimaan(w, po2, { baik: 4 });
  // 4. Material Issue #2: 5 KG → 5 × 45.974 = 229.870.
  const mi2 = await issueKeUnit(w, w.lem.id, 5);
  // 5. Transaksi BERTANGGAL MUNDUR: penerimaan baru dengan createdAt sebelum issue #1 dan harga sangat berbeda.
  const sebelumMundur = await jejak(w);
  await testPrisma.stockMovement.create({ data: { materialId: w.lem.id, type: "RECEIPT", qty: 100, unitCost: 90_000, createdAt: new Date(Date.now() - 3 * 86_400_000), note: "bertanggal mundur" } });
  const sesudahMundur = await jejak(w);
  assert.deepEqual(
    sesudahMundur.bahan.flatMap((b) => b.pergerakan.map((r) => [r.movementId, r.nilai, r.hargaDasar, r.status])),
    sebelumMundur.bahan.flatMap((b) => b.pergerakan.map((r) => [r.movementId, r.nilai, r.hargaDasar, r.status])),
    "nilai beku TIDAK berubah oleh penerimaan bertanggal mundur",
  );
  assert.equal(sesudahMundur.ringkasan.biayaPersediaan.nilai, sebelumMundur.ringkasan.biayaPersediaan.nilai);

  // 6. Waste 1 KG dan retur 2 KG (retur diterima Gudang → mengurangi biaya). Rata-rata kini ikut penerimaan mundur → dibekukan dari dasar saat itu.
  //    Untuk angka bulat, hapus pengaruh penerimaan mundur pada contoh angka: pakai unit KEDUA material agar contoh tetap deterministik.
  await testPrisma.stockMovement.deleteMany({ where: { note: "bertanggal mundur" } });
  const waste = await w.g.post("/api/inventory/movements/waste", { materialId: w.lem.id, qty: 1, reason: "Potong salah ukuran", unitId: w.unit.id });
  assert.equal(waste.status, 201, JSON.stringify(waste.body));
  const retur = await w.g.post("/api/inventory/movements/return", { materialId: w.lem.id, qty: 2, unitId: w.unit.id, note: "Sisa kembali" });
  assert.equal(retur.status, 201, JSON.stringify(retur.body));

  // 7. TANPA_HARGA: bahan tanpa harga perolehan di-issue.
  await seedBalance(matB.id, 10);
  await issueKeUnit(w, matB.id, 2);
  // 8. TANPA PO: penerimaan cepat dengan harga tanpa PO, lalu di-issue.
  assert.equal((await w.g.post("/api/inventory/movements/receipt", { materialId: matC.id, qty: 5, unitCost: 20_000, supplier: "Toko Lama" })).status, 201);
  await issueKeUnit(w, matC.id, 1);

  // 9. Faktur atas PO1 untuk penerimaan 1 (6 KG) @44.000 → selisih harga faktur DIPISAH dari biaya persediaan.
  const fk = await w.f.post(`/api/finance/purchase-orders/${po1.id}/faktur`, { supplierRef: "FAK-1", billDate: hariIni(), lines: [{ purchaseOrderLineId: po1.lines[0].id, qty: 6, unitPrice: 44_000 }] });
  assert.equal(fk.status, 201, JSON.stringify(fk.body));
  const ap = await w.f.post(`/api/finance/bills/${fk.body.billId}/approve`, { catatanTinjauanHarga: "Kenaikan harga disetujui" });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));

  // 10. Catatan PIC (bukan stok/jurnal): run + evidence tahap 6 (4 KG) & 7 (1 KG); retur sisa material C masih PENDING.
  const run = await testPrisma.productionRun.create({ data: { unitId: w.unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS", revision: 1 } });
  await testPrisma.productionStepEvidence.create({ data: { runId: run.id, stepNo: 6, stepCode: "PRODUKSI", version: 1, payload: { materials: [{ materialId: w.lem.id, qty: 4 }] }, actorId: w.prod.user.id } });
  await testPrisma.productionStepEvidence.create({ data: { runId: run.id, stepNo: 7, stepCode: "FINISHING", version: 1, payload: { materials: [{ materialId: w.lem.id, qty: 1 }] }, actorId: w.prod.user.id } });
  await testPrisma.productionMaterialReturn.create({ data: { runId: run.id, unitId: w.unit.id, materialId: matC.id, qty: 1, status: "PENDING" } });

  // ── hitung & periksa ──
  const sebelumBaca = await cacahLedger();
  j = await jejak(w);
  assert.deepEqual(await cacahLedger(), sebelumBaca, "membaca read-model TIDAK menulis stok/jurnal");

  const lem = bahanDari(j, "LEM-1037");
  assert.deepEqual(lem.pergerakan.map((r) => [r.tipe, r.nilai]), [["ISSUE", 129_870], ["ISSUE", 229_870], ["WASTE", 45_974], ["RETURN", -91_948]]);
  assert.equal(lem.pergerakan[1].hargaDasar, 45_974);
  assert.deepEqual(lem.pergerakan[1].sumber.map((s) => [s.poNumber, s.qty, s.unitCost]), [[po1.poNumber, 6, H1], [po2.poNumber, 4, H2]]);
  assert.deepEqual([lem.diserahkan, lem.dipakaiPIC, lem.waste, lem.retur, lem.sisaDiUnit], [8, 5, 1, 2, 0], "diserahkan 3+5, PIC 4+1, waste 1, retur 2, sisa 0");
  assert.deepEqual(lem.pemakaianPIC.map((p) => [p.stepNo, p.qty, p.oleh]), [[6, 4, w.prod.user.name], [7, 1, w.prod.user.name]]);
  assert.deepEqual(lem.pergerakan.map((r) => r.jurnal), ["TERBUKU", "TERBUKU", "BELUM_DIJURNAL", "BELUM_DIJURNAL"], "issue lewat dokumen sudah dijurnal; waste/retur cepat belum (jalur sinkron Finance)");

  // TANPA_HARGA bukan Rp0
  const b = bahanDari(j, "BHN-TANPA-HARGA").pergerakan[0];
  assert.equal(b.status, "TANPA_HARGA");
  assert.equal(b.nilai, null);
  assert.equal(b.hargaDasar, null);
  assert.equal(b.finalitas, "BELUM_FINAL");
  // tanpa PO tetap dinilai (harga ada) tetapi statusFaktur = TANPA_PO
  const c = bahanDari(j, "BHN-TANPA-PO").pergerakan[0];
  assert.equal(c.status, "DINILAI");
  assert.equal(c.nilai, 20_000);
  assert.equal(c.faktur.status, "TANPA_PO");

  // biaya persediaan = 129.870 + 229.870 − 91.948 + 20.000 = 287.792 (susut 45.974 DI LUAR biaya; TANPA_HARGA tidak dihitung)
  assert.equal(j.ringkasan.biayaPersediaan.nilai, 287_792);
  assert.equal(j.ringkasan.nilaiSusut, 45_974);
  assert.equal(j.ringkasan.biayaPersediaan.sebagian, true, "ada bagian belum final → sebagian");
  assert.equal(j.statusBiaya, "BELUM_FINAL");
  const jenis = j.belumFinal.map((x) => x.jenis);
  assert.ok(jenis.includes("TANPA_HARGA") && jenis.includes("RETUR_BELUM_DITERIMA") && jenis.includes("PRODUKSI_BELUM_SELESAI") && jenis.includes("FAKTUR_BELUM_ADA"), jenis.join(","));
  assert.equal(j.ringkasan.jumlahTanpaHarga, 1);
  // total eksplisit untuk API: pemakaian − retur = bersih; waste terpisah; status per baris DINILAI/TANPA_HARGA/BELUM_FINAL
  assert.deepEqual([j.ringkasan.totalBiaya, j.ringkasan.totalRetur, j.ringkasan.totalWaste, j.ringkasan.nilaiBersih], [379_740, 91_948, 45_974, 287_792]);
  assert.equal(j.ringkasan.totalBiaya - j.ringkasan.totalRetur, j.ringkasan.nilaiBersih);
  assert.deepEqual(lem.pergerakan.map((r) => r.statusBiaya), ["DINILAI", "DINILAI", "DINILAI", "DINILAI"]);
  assert.equal(b.statusBiaya, "TANPA_HARGA");
  // tautan dokumen sumber: PO, penerimaan, faktur
  assert.equal(lem.pergerakan[0].sumber[0].purchaseOrderId, po1.id);
  assert.equal(lem.pergerakan[0].sumber[0].goodsReceiptId, r1.id);
  assert.deepEqual(lem.pergerakan[0].faktur.dokumen.map((x) => x.id), [fk.body.billId]);

  // Panel PO (Finance): dekomposisi dari dasar harga beku — PO1 6 KG @43.290, PO2 4 KG @50.000; jumlah kedua PO = total unit
  const pp1 = (await w.f.get(`/api/finance/biaya-bahan/po/${po1.id}`)).body;
  const pp2 = (await w.f.get(`/api/finance/biaya-bahan/po/${po2.id}`)).body;
  assert.deepEqual([pp1.ringkasan.nilaiDiterima, pp1.ringkasan.nilaiDipakai, pp1.ringkasan.nilaiRetur, pp1.ringkasan.nilaiWaste, pp1.ringkasan.nilaiBersihDipakai, pp1.ringkasan.selisihHargaFaktur], [259_740, 259_740, 51_948, 25_974, 207_792, 4_260]);
  assert.deepEqual([pp2.ringkasan.nilaiDiterima, pp2.ringkasan.nilaiDipakai, pp2.ringkasan.nilaiRetur, pp2.ringkasan.nilaiWaste, pp2.ringkasan.selisihHargaFaktur], [200_000, 100_000, 40_000, 20_000, 0]);
  assert.equal(pp1.ringkasan.nilaiDipakai + pp2.ringkasan.nilaiDipakai, 359_740, "pemakaian kedua PO = pemakaian bahan LEM di unit");
  assert.equal(pp1.ringkasan.nilaiRetur + pp2.ringkasan.nilaiRetur, 91_948);
  assert.equal(pp1.ringkasan.nilaiWaste + pp2.ringkasan.nilaiWaste, 45_974);
  assert.equal(pp1.unit.length, 1);
  assert.equal(pp1.unit[0].unitId, w.unit.id);
  // selisih faktur TIDAK mengubah nilai pemakaian historis (sebelum/sesudah faktur sama)
  assert.equal(lem.pergerakan[0].nilai, 129_870);

  // Progres Gudang per penerimaan: Diterima → Diperiksa → Simpan ke Stok → Dipakai/Tersisa; harga TIDAK dikirim ke peran Gudang
  const g1 = (await w.g.get(`/api/inventory/goods-receipts/${r1.id}/jejak-pemakaian`)).body;
  const g2 = (await w.g.get(`/api/inventory/goods-receipts/${r2.id}/jejak-pemakaian`)).body;
  assert.deepEqual(g1.langkah.map((l) => l.selesai), [true, true, true, true]);
  assert.deepEqual([g1.bahan[0].masukStok, g1.bahan[0].dipakaiProduksi, g1.bahan[0].waste, g1.bahan[0].returDiterima, g1.bahan[0].tersisa], [6, 6, 0.6, 1.2, 0.6]);
  assert.deepEqual([g2.bahan[0].masukStok, g2.bahan[0].dipakaiProduksi, g2.bahan[0].waste, g2.bahan[0].returDiterima, g2.bahan[0].tersisa], [4, 2, 0.4, 0.8, 2.4]);
  const noMi = async (m) => (await testPrisma.materialIssue.findUnique({ where: { id: m.id } })).issueNumber;
  assert.deepEqual(g1.materialIssue.map((m) => [m.nomor, m.qty]), [[await noMi(mi1), 3], [await noMi(mi2), 3]]);
  assert.deepEqual(g2.materialIssue.map((m) => [m.nomor, m.qty]), [[await noMi(mi2), 2]]);
  assert.equal(g1.izinHarga, false);
  assert.equal(g1.bahan[0].nilaiDipakai, null);
  assert.ok(!JSON.stringify(g1).match(/43290|43.290|unitCost|hargaDasar/), "tidak ada harga di respons Gudang");
  assert.equal((await w.f.get(`/api/inventory/goods-receipts/${r1.id}/jejak-pemakaian`)).body.bahan[0].nilaiDipakai, 259_740, "Finance melihat nilai");
  assert.equal((await w.s.get(`/api/inventory/goods-receipts/${r1.id}/jejak-pemakaian`)).status, 403);
  assert.equal((await w.s.get(`/api/finance/biaya-bahan/po/${po1.id}`)).status, 403);
  assert.equal((await w.g.get(`/api/finance/biaya-bahan/po/${po1.id}`)).status, 403, "rute harga PO tertutup untuk Gudang");

  // selisih harga faktur terpisah (710 per KG pada lot 1): issue#1 3×710=2.130; issue#2 3×710=2.130 (2 KG dari lot 2 belum ada faktur); retur −1,2×710=−852 → 3.408
  assert.equal(j.ringkasan.selisihHargaFaktur.nilai, 3_408);
  assert.equal(lem.pergerakan[0].faktur.status, "FAKTUR_LENGKAP");
  assert.equal(lem.pergerakan[0].faktur.selisih, 2_130);
  assert.equal(lem.pergerakan[1].faktur.status, "FAKTUR_SEBAGIAN");
  assert.equal(lem.pergerakan[1].faktur.qtyBelumAdaFaktur, 2);
  // selisih faktur TIDAK masuk biaya persediaan (nilai beku tetap harga PO)
  assert.equal(lem.pergerakan[0].nilai, 129_870);

  // Material Issue tetap satu-satunya stok keluar: setiap pergerakan unit punya satu valuasi; issue ber-dokumen
  assert.equal(await testPrisma.finStockMovementValuation.count(), await testPrisma.stockMovement.count({ where: { unitId: w.unit.id } }));
  assert.equal(lem.pergerakan[0].dokumen.nomor, (await testPrisma.materialIssue.findUnique({ where: { id: mi1.id } })).issueNumber);
  assert.equal(lem.pergerakan[1].dokumen.nomor, (await testPrisma.materialIssue.findUnique({ where: { id: mi2.id } })).issueNumber);
  assert.ok(r1.id && r2.id);
});

// ═══ HISTORIS, PENDING, KOSONG ═══════════════════════════════════════════════════════════════════════════════════
test("pergerakan lama tanpa pembekuan = ESTIMASI_HISTORIS (BELUM_FINAL, tidak masuk total pasti); unit tanpa pergerakan = BELUM_ADA_PEMAKAIAN (bukan Rp0)", async () => {
  const w = await dunia();
  let j = await jejak(w);
  assert.equal(j.statusBiaya, "BELUM_ADA_PEMAKAIAN");
  assert.equal(j.ringkasan.biayaPersediaan.nilai, null, "tidak ada pemakaian → null, BUKAN 0");
  assert.deepEqual(j.bahan, []);

  await testPrisma.stockMovement.create({ data: { materialId: w.lem.id, type: "RECEIPT", qty: 10, unitCost: 40_000, createdAt: new Date(Date.now() - 5 * 86_400_000) } });
  // pergerakan "lama": ditulis langsung tanpa melalui postStockMovement → tanpa pembekuan
  await testPrisma.stockMovement.create({ data: { materialId: w.lem.id, type: "ISSUE", qty: -2, unitId: w.unit.id, createdAt: new Date(Date.now() - 2 * 86_400_000) } });
  j = await jejak(w);
  const r = bahanDari(j, "LEM-1037").pergerakan[0];
  assert.equal(r.status, "ESTIMASI_HISTORIS");
  assert.equal(r.nilai, null);
  assert.equal(r.estimasi, 80_000);
  assert.equal(j.ringkasan.biayaPersediaan.nilai, null, "hanya estimasi → tidak ada total pasti");
  assert.equal(j.ringkasan.estimasiBelumFinal, 80_000);
  assert.equal(j.ringkasan.jumlahEstimasiHistoris, 1);
  assert.ok(j.belumFinal.some((x) => x.jenis === "ESTIMASI_HISTORIS"));
  assert.equal(j.statusBiaya, "BELUM_FINAL");
});

test("semua baris TANPA_HARGA: total pasti null (bukan 0); estimasi dari harga terkini hanya informasi", async () => {
  const w = await dunia();
  await seedBalance(w.lem.id, 10); // RECEIPT tanpa harga
  await issueKeUnit(w, w.lem.id, 2);
  let j = await jejak(w);
  assert.equal(bahanDari(j, "LEM-1037").pergerakan[0].status, "TANPA_HARGA");
  assert.equal(j.ringkasan.biayaPersediaan.nilai, null);
  assert.equal(j.ringkasan.semuaTanpaNilai, true);
  // harga datang belakangan: nilai beku TIDAK ikut berubah; estimasi terkini hanya informasi
  await testPrisma.stockMovement.create({ data: { materialId: w.lem.id, type: "RECEIPT", qty: 5, unitCost: 40_000 } });
  j = await jejak(w);
  const r = bahanDari(j, "LEM-1037").pergerakan[0];
  assert.equal(r.status, "TANPA_HARGA");
  assert.equal(r.nilai, null);
  assert.equal(r.estimasi, 80_000);
  assert.equal(j.ringkasan.biayaPersediaan.nilai, null);
});

test("retur PENDING belum mengurangi biaya; setelah Gudang menerima (RETURN di ledger) biaya turun dan pending hilang dari daftar", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10, harga: H1 });
  await penerimaan(w, po, { baik: 10 });
  await issueKeUnit(w, w.lem.id, 4);
  const run = await testPrisma.productionRun.create({ data: { unitId: w.unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "COMPLETED", currentPhase: "HANDOFF", revision: 1 } });
  const pend = await testPrisma.productionMaterialReturn.create({ data: { runId: run.id, unitId: w.unit.id, materialId: w.lem.id, qty: 1, status: "PENDING" } });
  let j = await jejak(w);
  assert.equal(j.ringkasan.biayaPersediaan.nilai, 173_160);
  assert.equal(bahanDari(j, "LEM-1037").returPending, 1);
  assert.equal(j.statusBiaya, "BELUM_FINAL");
  assert.ok(j.belumFinal.some((x) => x.jenis === "RETUR_BELUM_DITERIMA"));
  // Gudang menerima: RETURN di ledger (jalur sah) → biaya turun 1 × 43.290
  assert.equal((await w.g.post("/api/inventory/movements/return", { materialId: w.lem.id, qty: 1, unitId: w.unit.id })).status, 201);
  await testPrisma.productionMaterialReturn.update({ where: { id: pend.id }, data: { status: "RECEIVED", receivedQty: 1 } });
  j = await jejak(w);
  assert.equal(j.ringkasan.biayaPersediaan.nilai, 129_870);
  assert.equal(bahanDari(j, "LEM-1037").returPending, 0);
  assert.equal(j.belumFinal.filter((x) => x.jenis === "RETUR_BELUM_DITERIMA").length, 0);
  assert.equal(j.produksiSelesai, true);
});

test("unit selesai, semua bernilai & faktur lengkap → FINAL_MENURUT_HARGA_PO dan total pasti", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5, harga: H1 });
  await penerimaan(w, po, { baik: 5 });
  await issueKeUnit(w, w.lem.id, 5);
  await testPrisma.productionRun.create({ data: { unitId: w.unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "COMPLETED", currentPhase: "HANDOFF", revision: 1 } });
  const fk = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: "FAK-OK", billDate: hariIni(), lines: [{ purchaseOrderLineId: po.lines[0].id, qty: 5, unitPrice: H1 }] });
  assert.equal((await w.f.post(`/api/finance/bills/${fk.body.billId}/approve`, {})).status, 200);
  const j = await jejak(w);
  assert.equal(j.statusBiaya, "FINAL_MENURUT_HARGA_PO");
  assert.equal(j.ringkasan.biayaPersediaan.nilai, 216_450);
  assert.equal(j.ringkasan.biayaPersediaan.lengkap, true);
  assert.equal(j.ringkasan.selisihHargaFaktur.nilai, 0);
  assert.equal(bahanDari(j, "LEM-1037").pergerakan[0].faktur.status, "FAKTUR_LENGKAP");
  assert.deepEqual(j.belumFinal, []);
});

// ═══ KEUTUHAN: stok/jurnal hanya berubah pada command Gudang yang sah ═════════════════════════════════════════════
test("hanya command Gudang yang mengubah stok/jurnal: catatan PIC, membaca read-model, dan daftar unit TIDAK menulis apa pun; satu pergerakan = satu valuasi", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10, harga: H1 });
  await penerimaan(w, po, { baik: 10 });
  const sebelum = await cacahLedger();
  const val0 = await testPrisma.finStockMovementValuation.count();
  assert.equal(val0, 0, "penerimaan (tanpa unit) tidak dibekukan");

  // catatan PIC
  const run = await testPrisma.productionRun.create({ data: { unitId: w.unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS", revision: 1 } });
  await testPrisma.productionStepEvidence.create({ data: { runId: run.id, stepNo: 6, stepCode: "PRODUKSI", version: 1, payload: { materials: [{ materialId: w.lem.id, qty: 99 }] }, actorId: w.prod.user.id } });
  assert.deepEqual(await cacahLedger(), sebelum, "catatan PIC tidak memposting stok/jurnal");
  assert.equal(await testPrisma.finStockMovementValuation.count(), 0);

  // membaca
  await jejak(w); await w.f.get("/api/finance/biaya-bahan/unit"); await w.p.get(`/api/units/${w.unit.id}/jejak-bahan`);
  assert.deepEqual(await cacahLedger(), sebelum);
  assert.equal(await testPrisma.finStockMovementValuation.count(), 0);

  // PIC mengaku memakai 99 padahal tidak ada ISSUE → pembanding fisik, TIDAK jadi biaya
  const j = await jejak(w);
  assert.equal(bahanDari(j, "LEM-1037").dipakaiPIC, 99);
  assert.equal(bahanDari(j, "LEM-1037").diserahkan, 0);
  assert.equal(j.ringkasan.biayaPersediaan.nilai, null);

  // command Gudang sah: tepat +1 pergerakan dan +1 valuasi
  await issueKeUnit(w, w.lem.id, 2);
  assert.equal(await testPrisma.stockMovement.count(), sebelum.stok + 1);
  assert.equal(await testPrisma.finStockMovementValuation.count(), 1);
});

test("nilai beku append-only: UPDATE/DELETE pada valuasi ditolak database; CHECK menolak DINILAI tanpa nilai dan TANPA_HARGA bernilai", async () => {
  const w = await dunia();
  await seedBalance(w.lem.id, 10, { unitCost: 40_000 });
  await issueKeUnit(w, w.lem.id, 1);
  const v = await testPrisma.finStockMovementValuation.findFirst();
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`UPDATE fin_stock_movement_valuations SET value = 1 WHERE id = '${v.id}'`), /append-only/);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`DELETE FROM fin_stock_movement_valuations WHERE id = '${v.id}'`), /append-only/);
  const mov = await testPrisma.stockMovement.create({ data: { materialId: w.lem.id, type: "WASTE", qty: -1, unitId: w.unit.id, reason: "uji" } });
  await assert.rejects(() => testPrisma.finStockMovementValuation.create({ data: { movementId: mov.id, materialId: w.lem.id, unitId: w.unit.id, movementType: "WASTE", costKind: "SUSUT", qty: -1, status: "DINILAI" } }), /status_chk|check/i);
  await assert.rejects(() => testPrisma.finStockMovementValuation.create({ data: { movementId: mov.id, materialId: w.lem.id, unitId: w.unit.id, movementType: "WASTE", costKind: "SUSUT", qty: -1, status: "TANPA_HARGA", value: 0, unitCostBasis: 1 } }), /status_chk|check/i);
});

// ═══ REPLAY, PEMBATALAN, PARALEL ═════════════════════════════════════════════════════════════════════════════════
test("replay: issue kedua kali ditolak tanpa stok/valuasi ganda; pembatalan Material Issue sebelum keluar tidak membuat biaya", async () => {
  const w = await dunia();
  await seedBalance(w.lem.id, 10, { unitCost: 40_000 });
  const mi = await issueKeUnit(w, w.lem.id, 3);
  const ulang = await w.g.post(`/api/inventory/material-issues/${mi.id}/issue`, {});
  assert.ok(ulang.status >= 400 && ulang.status < 500);
  assert.equal(await testPrisma.stockMovement.count({ where: { materialIssueId: mi.id } }), 1);
  assert.equal(await testPrisma.finStockMovementValuation.count(), 1);

  const dibatalkan = await issueKeUnit(w, w.lem.id, 2, { sampaiIssue: false });
  let j = await jejak(w);
  assert.ok(j.belumFinal.some((x) => x.jenis === "ISSUE_BELUM_KELUAR"), "issue yang belum keluar dilaporkan, bukan sebagai biaya");
  assert.equal(j.ringkasan.biayaPersediaan.nilai, 120_000);
  assert.equal((await w.g.patch(`/api/inventory/material-issues/${dibatalkan.id}/cancel`, { reason: "Salah unit" })).status, 200);
  assert.equal(await testPrisma.finStockMovementValuation.count(), 1, "pembatalan tidak membuat valuasi");
  j = await jejak(w);
  assert.equal(j.belumFinal.filter((x) => x.jenis === "ISSUE_BELUM_KELUAR").length, 0);
  assert.equal(j.ringkasan.biayaPersediaan.nilai, 120_000);
  assert.equal(await testPrisma.stockMovement.count({ where: { materialIssueId: dibatalkan.id } }), 0);
});

test("pembatalan faktur: selisih harga faktur kembali 'belum ada faktur'; biaya persediaan (harga PO) tidak berubah", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5, harga: H1 });
  await penerimaan(w, po, { baik: 5 });
  await issueKeUnit(w, w.lem.id, 5);
  const fk = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: "FAK-X", billDate: hariIni(), lines: [{ purchaseOrderLineId: po.lines[0].id, qty: 5, unitPrice: 44_000 }] });
  assert.equal((await w.f.post(`/api/finance/bills/${fk.body.billId}/approve`, { catatanTinjauanHarga: "naik harga" })).status, 200);
  let j = await jejak(w);
  assert.equal(j.ringkasan.selisihHargaFaktur.nilai, 3_550);
  assert.equal(j.ringkasan.biayaPersediaan.nilai, 216_450);
  assert.equal((await w.a.post(`/api/finance/bills/${fk.body.billId}/cancel`, { reason: "faktur salah" })).status, 200);
  j = await jejak(w);
  assert.equal(j.ringkasan.selisihHargaFaktur.nilai, 0);
  assert.equal(bahanDari(j, "LEM-1037").pergerakan[0].faktur.status, "FAKTUR_BELUM_ADA");
  assert.equal(j.ringkasan.biayaPersediaan.nilai, 216_450, "biaya persediaan tetap menurut harga PO");
});

test("transaksi paralel pada unit yang sama: dua waste + satu retur bersamaan → tiap pergerakan tepat satu valuasi, saldo & total konsisten", async () => {
  const w = await dunia();
  await seedBalance(w.lem.id, 10, { unitCost: 40_000 });
  const hasil = await Promise.all([
    w.g.post("/api/inventory/movements/waste", { materialId: w.lem.id, qty: 1, reason: "paralel A", unitId: w.unit.id }),
    w.g.post("/api/inventory/movements/waste", { materialId: w.lem.id, qty: 2, reason: "paralel B", unitId: w.unit.id }),
    w.g.post("/api/inventory/movements/return", { materialId: w.lem.id, qty: 1, unitId: w.unit.id }),
  ]);
  assert.deepEqual(hasil.map((r) => r.status), [201, 201, 201]);
  assert.equal(await testPrisma.finStockMovementValuation.count(), 3);
  const per = await testPrisma.finStockMovementValuation.groupBy({ by: ["movementId"], _count: { _all: true } });
  assert.ok(per.every((p) => p._count._all === 1));
  const saldo = (await testPrisma.stockMovement.findMany({ where: { materialId: w.lem.id } })).reduce((s, m) => s + Number(m.qty), 0);
  assert.equal(saldo, 10 - 1 - 2 + 1);
  const j = await jejak(w);
  assert.equal(j.ringkasan.nilaiSusut, 120_000);
  assert.equal(j.ringkasan.biayaPersediaan.nilai, -40_000, "hanya retur (−40.000) di biaya; waste di luar biaya");
});

// ═══ IZIN HARGA ═════════════════════════════════════════════════════════════════════════════════════════════════
test("izin harga: Produksi (unit:read) melihat kuantitas/status/dokumen TANPA nominal; Finance melihat nilai; Sales ditolak; unit tak dikenal 404", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5, harga: H1 });
  await penerimaan(w, po, { baik: 5 });
  await issueKeUnit(w, w.lem.id, 2);

  const prod = await w.p.get(`/api/units/${w.unit.id}/jejak-bahan`);
  assert.equal(prod.status, 200);
  assert.equal(prod.body.izinHarga, false);
  const baris = bahanDari(prod.body, "LEM-1037").pergerakan[0];
  assert.equal(baris.qty, -2);
  assert.equal(baris.status, "DINILAI");
  assert.equal(baris.nilai, null);
  assert.equal(baris.hargaDasar, null);
  assert.equal(prod.body.ringkasan.biayaPersediaan.nilai, null);
  assert.equal(baris.sumber[0].unitCost, null);
  assert.doesNotMatch(JSON.stringify(prod.body), /43290|86580/);
  assert.equal(baris.sumber[0].poNumber, po.poNumber, "jejak dokumen tetap terlihat");

  const adm = await w.a.get(`/api/units/${w.unit.id}/jejak-bahan`);
  assert.equal(adm.body.izinHarga, true);
  assert.equal(bahanDari(adm.body, "LEM-1037").pergerakan[0].nilai, 86_580);

  assert.equal((await w.s.get(`/api/units/${w.unit.id}/jejak-bahan`)).status, 403);
  assert.equal((await w.p.get(`/api/finance/biaya-bahan/unit/${w.unit.id}`)).status, 403, "Produksi tidak membuka rute Finance");
  assert.equal((await w.s.get("/api/finance/biaya-bahan/unit")).status, 403);
  assert.equal((await w.f.get("/api/finance/biaya-bahan/unit/00000000-0000-4000-8000-000000000000")).status, 404);
  assert.equal((await w.f.get("/api/finance/biaya-bahan/unit/bukan-uuid")).status, 404);

  const daftar = await w.f.get("/api/finance/biaya-bahan/unit");
  assert.equal(daftar.status, 200);
  assert.equal(daftar.body.units.length, 1);
  assert.equal(daftar.body.units[0].unitCode, w.unit.unitCode);
  assert.equal(daftar.body.units[0].biayaPersediaan, 86_580);
  assert.equal((await w.f.get(`/api/finance/biaya-bahan/unit?q=${w.unit.unitCode.slice(0, 6)}`)).body.units.length, 1);
  assert.equal((await w.f.get("/api/finance/biaya-bahan/unit?q=tidak-ada-zzz")).body.units.length, 0);
});

test("kegagalan pembekuan tidak menggagalkan perintah Gudang: pergerakan tetap tercatat dan tampil ESTIMASI_HISTORIS (bukan angka palsu)", async () => {
  const { catatValuasiPergerakan } = await import("../../src/services/finance/biayaBahan.js");
  const log = [];
  const tx = {
    $executeRawUnsafe: async (s) => { log.push(s); },
    finStockMovementValuation: { create: async () => { throw new Error("gagal tulis"); } },
    stockMovement: { findMany: async () => [] },
    finInventoryOpeningLine: { findUnique: async () => null },
    finPeriod: {}, goodsReceipt: { findMany: async () => [] },
  };
  const hasil = await catatValuasiPergerakan(tx, { id: "00000000-0000-4000-8000-000000000001", materialId: "00000000-0000-4000-8000-000000000002", unitId: "00000000-0000-4000-8000-000000000003", type: "ISSUE", qty: -1, createdAt: new Date() }).catch((e) => ({ galat: e.message }));
  assert.equal(hasil, null, JSON.stringify(hasil));
  assert.ok(log.some((s) => /ROLLBACK TO SAVEPOINT/.test(s)));
});
