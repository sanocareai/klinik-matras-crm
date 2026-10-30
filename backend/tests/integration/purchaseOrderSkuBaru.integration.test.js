// SKU BARU LANGSUNG DARI PURCHASE ORDER + KATALOG SUPPLIER + KONVERSI SATUAN.
// Yang dikunci: (1) hanya finance:admin yang membuat SKU dari form PO; (2) SKU, katalog supplier, dan PO atomik — gagal simpan PO membatalkan semuanya;
// (3) membuat SKU/menyimpan PO TIDAK menyentuh stok/jurnal/GRNI/utang; (4) duplikat pasti diblokir, mirip butuh konfirmasi + alasan; (5) kode SKU
// dibuat server dan aman paralel; (6) konversi satuan BOX→CAN: stok & nilai penerimaan tepat; (7) kunci kode/satuan setelah ada pergerakan;
// (8) Perlengkapan Stok tidak muncul sebagai bahan Produksi; (9) barang sama dari supplier berbeda = SKU yang sama + katalog baru.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { bawaSampaiSiap, catatTibaResmi } from "./setup/kedatangan.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { bangunViewPO } from "../../src/services/finance/purchaseOrderDocument.js";
import { normalisasiNama, prefixDariNama, validasiFaktor, periksaKonversiBaris } from "../../src/services/finance/skuBaru.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HARGA_BOX = 43_290;
const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const gudang = await createTestUser({ roles: ["WAREHOUSE"] });
  const produksi = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  const f = makeClient(server.baseUrl, fin.token);
  const a = makeClient(server.baseUrl, admin.token);
  const g = makeClient(server.baseUrl, gudang.token);
  const p = makeClient(server.baseUrl, produksi.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-ESA", name: "PT ESA BUMINDO" } });
  const supplier2 = await testPrisma.finSupplier.create({ data: { code: "SUP-BTA", name: "CV BINTANG" } });
  return { f, a, g, p, admin, supplier, supplier2 };
}

const baru = (o = {}) => ({
  nama: "Lem Semprot 500 ML", kategori: "Perekat", jenis: "BAHAN_PRODUKSI", spesifikasi: "Kaleng semprot 500 ml",
  satuanBeli: "BOX", satuanStok: "CAN", faktorKonversi: 12, namaSupplier: "LEM SPRAY 500", kodeSupplier: "LS-500", moq: 2, estimasiKirimHari: 5, lokasi: "Rak B2", ...o,
});
const poBody = (w, lines, extra = {}) => ({ supplierId: w.supplier.id, orderDate: hariIni(), lines, ...extra });
const barisBaru = (o = {}, q = 2, harga = HARGA_BOX) => ({ materialBaru: baru(o), qty: q, unitPrice: harga });

async function jejak() {
  const agg = await testPrisma.finJournalLine.aggregate({ _sum: { debit: true, credit: true } });
  return {
    stok: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), baris: await testPrisma.finJournalLine.count(),
    debit: String(agg._sum.debit ?? 0), kredit: String(agg._sum.credit ?? 0), tagihan: await testPrisma.finSupplierBill.count(), pembayaran: await testPrisma.finSupplierPayment?.count?.() ?? 0,
  };
}
const hitung = async () => ({
  material: await testPrisma.material.count(), origin: await testPrisma.finMaterialSkuOrigin.count(), katalog: await testPrisma.finSupplierMaterial.count(), po: await testPrisma.finPurchaseOrder.count(),
});

// ═══ fungsi murni ═══
test("normalisasi nama, prefix kode, dan validasi faktor/presisi", () => {
  assert.equal(normalisasiNama("  Lem  Semprot 500-ML "), "lem semprot 500 ml");
  assert.equal(normalisasiNama("Kain 2 x 3"), "kain 2x3");
  assert.equal(prefixDariNama("Lem Semprot"), "LEM");
  assert.equal(prefixDariNama("Ab"), "ABX");
  assert.equal(validasiFaktor("CAN", "CAN").toString(), "1");
  assert.equal(validasiFaktor("BOX", "CAN", 12).toString(), "12");
  for (const salah of [undefined, "", 0, -3, "abc", 1.23456, 2_000_000]) assert.throws(() => validasiFaktor("BOX", "CAN", salah), /faktor|Faktor/i, `faktor ${salah} harus ditolak`);
  assert.equal(periksaKonversiBaris({ qty: 2, faktor: 12, hargaBeli: HARGA_BOX }).toString(), "24");
  assert.throws(() => periksaKonversiBaris({ qty: 1.001, faktor: 12.0001, hargaBeli: 1000 }), /presisi/i);
  assert.throws(() => periksaKonversiBaris({ qty: 1, faktor: 100000, hargaBeli: 10 }), /Rp1/);
});

// ═══ izin ═══
test("hanya finance:admin yang bisa membuat SKU baru dari PO; Finance biasa 403 dan tidak ada yang tertulis", async () => {
  const w = await dunia();
  const sebelum = await hitung();
  const r = await w.f.post("/api/finance/purchase-orders", poBody(w, [barisBaru()]));
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.code, "BUAT_SKU_BUTUH_ADMIN");
  assert.deepEqual(await hitung(), sebelum);
  assert.equal((await w.f.post("/api/finance/purchase-orders/sku/cek-duplikat", { materialBaru: baru() })).status, 403);
  assert.equal((await w.g.post("/api/finance/purchase-orders", poBody(w, [barisBaru()]))).status, 403);
});

// ═══ membuat SKU + katalog + PO atomik, tanpa efek stok/jurnal ═══
test("Admin membuat SKU baru dari form PO: kode PFX-NNN, asal tercatat, katalog supplier terhubung, tanpa stok/jurnal/utang", async () => {
  const w = await dunia();
  const sebelum = await jejak();
  const r = await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru()]));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(await jejak(), sebelum, "membuat SKU/menyimpan PO tidak boleh menyentuh stok, jurnal, GRNI, utang, tagihan");

  const baris = r.body.lines[0];
  assert.match(baris.kode, /^LEM-\d{3}$/);
  assert.equal(baris.satuan, "BOX");
  assert.equal(baris.satuanStok, "CAN");
  assert.deepEqual(baris.konversi, { satuanBeli: "BOX", faktor: 12, satuanStok: "CAN" });
  assert.equal(baris.namaSupplier, "LEM SPRAY 500");
  assert.equal(baris.hargaSatuan, HARGA_BOX);

  const m = await testPrisma.material.findUnique({ where: { id: baris.materialId }, include: { skuOrigin: true } });
  assert.equal(m.unit, "CAN");
  assert.equal(m.kind, "BAHAN_PRODUKSI");
  assert.equal(m.category, "RAW_MATERIAL");
  assert.equal(m.createdVia, "PO");
  assert.equal(m.createdById, w.admin.user.id);
  assert.equal(m.skuOrigin.firstPurchaseOrderId, r.body.id);
  assert.equal(m.skuOrigin.firstSupplierId, w.supplier.id);
  assert.equal(m.skuOrigin.initialData.nama, "Lem Semprot 500 ML");
  const kat = await testPrisma.finSupplierMaterial.findMany({ where: { materialId: m.id } });
  assert.equal(kat.length, 1);
  assert.equal(kat[0].supplierSku, "LS-500");
  assert.equal(Number(kat[0].conversionFactor), 12);
  assert.equal(Number(kat[0].moq), 2);
  assert.equal(kat[0].leadTimeDays, 5);
  assert.equal(kat[0].lastPrice, null, "harga terakhir baru terisi saat PO disetujui");
  const ev = await testPrisma.finPurchaseOrderEvent.findFirst({ where: { purchaseOrderId: r.body.id, type: "DIBUAT" } });
  assert.equal(ev.metadata.skuBaru[0].kode, m.code);

  // Persetujuan: harga terakhir katalog = informasi saja.
  const s = await w.a.post(`/api/finance/purchase-orders/${r.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const kat2 = await testPrisma.finSupplierMaterial.findUnique({ where: { id: kat[0].id } });
  assert.equal(kat2.lastPrice, HARGA_BOX);
  assert.deepEqual(await jejak(), sebelum);

  const asal = await w.f.get(`/api/finance/purchase-orders/sku/${m.id}`);
  assert.equal(asal.status, 200);
  assert.equal(asal.body.asal.poPertama.poNumber, r.body.poNumber);
  assert.equal(asal.body.terkunci.satuanStok, false);
});

test("gagal menyimpan PO membatalkan SKU baru, asal SKU, dan katalog supplier (atomik)", async () => {
  const w = await dunia();
  const sebelum = await hitung();
  const r = await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru(), barisBaru({ nama: "Busa Lembaran 20 MM", kodeSupplier: "BL-20", satuanBeli: "CAN", faktorKonversi: undefined }, 1, 0)]));
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.deepEqual(await hitung(), sebelum, "baris pertama sah, baris kedua gagal → tidak ada SKU/katalog/PO yang tertinggal");
  const r2 = await w.a.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, lines: [barisBaru()] });
  assert.equal(r2.status, 400);
  assert.deepEqual(await hitung(), sebelum);
});

test("campuran material yang ada + barang baru dalam satu PO; ubah draf tidak menggandakan SKU", async () => {
  const w = await dunia();
  const lem = await createTestMaterial({ code: "LEM-1037", name: "LEM I-SR 1037 13 KG", unit: "KG" });
  const r = await w.a.post("/api/finance/purchase-orders", poBody(w, [{ materialId: lem.id, qty: 5, unitPrice: 100_000 }, barisBaru()]));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.lines.length, 2);
  const skuId = r.body.lines.find((l) => l.konversi).materialId;
  // Frontend mengirim ulang baris yang sudah jadi SKU dengan materialId — tidak dibuat dua kali.
  const u = await w.a.patch(`/api/finance/purchase-orders/${r.body.id}`, poBody(w, [{ materialId: lem.id, qty: 6, unitPrice: 100_000 }, { materialId: skuId, qty: 3, unitPrice: HARGA_BOX, satuanBeli: "BOX", faktorKonversi: 12 }]));
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(await testPrisma.material.count({ where: { createdVia: "PO" } }), 1);
  assert.equal(await testPrisma.finSupplierMaterial.count({ where: { materialId: skuId } }), 1);
  assert.equal(u.body.lines.find((l) => l.materialId === skuId).dipesan, 3);
});

// ═══ duplikat ═══
test("duplikat pasti diblokir dengan kandidat; mirip butuh konfirmasi + alasan yang tersimpan", async () => {
  const w = await dunia();
  await createTestMaterial({ code: "LEM-009", name: "Lem Semprot 500 ML", unit: "CAN" });
  const pasti = await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru()]));
  assert.equal(pasti.status, 409, JSON.stringify(pasti.body));
  assert.equal(pasti.body.code, "SKU_DUPLIKAT_PASTI");
  assert.equal(pasti.body.kandidat[0].kode, "LEM-009");
  assert.equal(await testPrisma.finPurchaseOrder.count(), 0);

  const pv = await w.a.post("/api/finance/purchase-orders/sku/cek-duplikat", { supplierId: w.supplier.id, materialBaru: baru() });
  assert.equal(pv.status, 200);
  assert.equal(pv.body.bolehLanjut, false);

  await createTestMaterial({ code: "BUS-001", name: "Busa Lembaran HD 26", unit: "SHEET" });
  const mirip = await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru({ nama: "Busa Lembaran HD 26 Premium", satuanBeli: "SHEET", satuanStok: "SHEET", faktorKonversi: undefined, kodeSupplier: "BH-26" }, 4, 150_000)]));
  assert.equal(mirip.status, 409, JSON.stringify(mirip.body));
  assert.equal(mirip.body.code, "SKU_MIRIP_BUTUH_KONFIRMASI");
  const tanpaAlasan = await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru({ nama: "Busa Lembaran HD 26 Premium", satuanBeli: "SHEET", satuanStok: "SHEET", faktorKonversi: undefined, kodeSupplier: "BH-26", konfirmasiMirip: true }, 4, 150_000)]));
  assert.equal(tanpaAlasan.status, 409);
  const ok = await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru({ nama: "Busa Lembaran HD 26 Premium", satuanBeli: "SHEET", satuanStok: "SHEET", faktorKonversi: undefined, kodeSupplier: "BH-26", konfirmasiMirip: true, alasanMirip: "Beda ketebalan, bukan barang yang sama" }, 4, 150_000)]));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const o = await testPrisma.finMaterialSkuOrigin.findFirst({ where: { materialId: ok.body.lines[0].materialId } });
  assert.equal(o.duplicateOverrideReason, "Beda ketebalan, bukan barang yang sama");
  assert.ok(Array.isArray(o.duplicateCandidates) && o.duplicateCandidates.length >= 1);
});

test("barang sama dari supplier berbeda memakai SKU internal yang sama + relasi Katalog Supplier baru", async () => {
  const w = await dunia();
  const r1 = await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru()]));
  assert.equal(r1.status, 201);
  const skuId = r1.body.lines[0].materialId;
  const r2 = await w.a.post("/api/finance/purchase-orders", { supplierId: w.supplier2.id, orderDate: hariIni(), lines: [{ materialId: skuId, qty: 1, unitPrice: 50_000, satuanBeli: "BOX", faktorKonversi: 6, namaSupplier: "SPRAY LEM 500CC", kodeSupplier: "SL-5", estimasiKirimHari: 3 }] });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal(r2.body.lines[0].materialId, skuId);
  const kat = await testPrisma.finSupplierMaterial.findMany({ where: { materialId: skuId }, orderBy: { createdAt: "asc" } });
  assert.equal(kat.length, 2);
  assert.deepEqual(kat.map((k) => Number(k.conversionFactor)), [12, 6]);
  assert.equal(await testPrisma.material.count({ where: { createdVia: "PO" } }), 1, "tidak ada SKU kedua");
  const lis = await w.f.get(`/api/finance/purchase-orders/katalog-supplier?materialId=${skuId}`);
  assert.equal(lis.status, 200);
  assert.equal(lis.body.katalog.length, 2);
});

// ═══ kode SKU & konkurensi ═══
test("kode SKU dibuat server berurutan per prefix; permintaan paralel tidak mendapat kode atau SKU ganda", async () => {
  const w = await dunia();
  const nama = ["Lem Kayu 1 KG", "Lem Karet 2 KG", "Lem Kain 3 KG", "Lem Busa 4 KG"];
  const hasil = await Promise.all(nama.map((n, i) => w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru({ nama: n, kodeSupplier: `K-${i}`, satuanBeli: "CAN", faktorKonversi: undefined }, 1, 10_000)]))));
  assert.deepEqual(hasil.map((h) => h.status), [201, 201, 201, 201], JSON.stringify(hasil.map((h) => h.body)));
  const kode = hasil.map((h) => h.body.lines[0].kode).sort();
  assert.deepEqual(kode, ["LEM-001", "LEM-002", "LEM-003", "LEM-004"]);

  // Nama sama diklik ganda (paralel): tepat satu yang menang.
  const kembar = await Promise.all([0, 1].map(() => w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru({ nama: "Pita Tepi 5 CM", kodeSupplier: "PT-5", satuanBeli: "CAN", faktorKonversi: undefined }, 1, 10_000)]))));
  assert.deepEqual(kembar.map((k) => k.status).sort(), [201, 409]);
  assert.equal(await testPrisma.material.count({ where: { name: "Pita Tepi 5 CM" } }), 1);
  assert.equal(await testPrisma.finPurchaseOrder.count(), 5);
});

test("replay Idempotency-Key tidak membuat SKU atau PO ganda", async () => {
  const w = await dunia();
  const h = { "Idempotency-Key": `po-${randomUUID()}` };
  const a1 = await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru()]), h);
  const a2 = await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru()]), h);
  assert.equal(a1.status, 201, JSON.stringify(a1.body));
  assert.equal(a2.status, 201);
  assert.equal(a2.body.id, a1.body.id);
  assert.deepEqual(await hitung(), { material: 1, origin: 1, katalog: 1, po: 1 });
});

test("jasa/non-stok tidak boleh lewat alur ini; satuan, jenis, dan faktor divalidasi", async () => {
  const w = await dunia();
  const sebelum = await hitung();
  const jasa = await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru({ jenis: "JASA" })]));
  assert.equal(jasa.status, 400);
  assert.match(jasa.body.error, /Pengeluaran|Pengajuan Biaya|Tagihan Supplier/);
  assert.equal((await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru({ jenis: undefined })]))).status, 400);
  assert.equal((await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru({ satuanStok: "XYZ" })]))).status, 400);
  assert.equal((await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru({ faktorKonversi: 0 })]))).status, 400);
  assert.equal((await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru({ faktorKonversi: undefined })]))).status, 400);
  assert.equal((await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru({ nama: "" })]))).status, 400);
  assert.deepEqual(await hitung(), sebelum);
});

// ═══ konversi satuan sampai stok & jurnal ═══
test("konversi BOX→CAN: PO 2 BOX → stok +24 CAN, nilai penerimaan = nilai PO, harga stok eksak, kedua angka tampil", async () => {
  const w = await dunia();
  const po = (await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru()]))).body;
  assert.equal((await w.a.post(`/api/finance/purchase-orders/${po.id}/approve`, {})).status, 200);
  const skuId = po.lines[0].materialId;

  const gr = (await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.id })).body;
  assert.equal(gr.lines[0].purchaseOrderLine.purchaseUnit, "BOX", "penerimaan Gudang membawa satuan beli");
  await bawaSampaiSiap(w.g, gr, { datang: 2, baik: 2, tolak: 0 });
  const put = await w.g.post(`/api/inventory/goods-receipts/${gr.id}/putaway`, { location: "RAK-B02" });
  assert.equal(put.status, 200, JSON.stringify(put.body));

  const mv = await testPrisma.stockMovement.findMany({ where: { goodsReceiptId: gr.id } });
  assert.equal(mv.length, 1);
  assert.equal(Number(mv[0].qty), 24, "2 BOX × 12 = 24 CAN");
  assert.equal(Number(mv[0].unitCostExact), 3607.5);
  assert.equal(mv[0].unitCost, 3608);
  const jurnal = await testPrisma.finJournalEntry.findFirst({ where: { source: "PENERIMAAN_BAHAN", sourceId: gr.id }, include: { lines: { include: { account: true } } } });
  assert.ok(jurnal);
  const dr = jurnal.lines.find((l) => Number(l.debit) > 0);
  assert.equal(dr.account.code, "1-1400");
  assert.equal(Number(dr.debit), 2 * HARGA_BOX, "nilai persediaan = nilai PO persis, bukan 24 × 3.608");
  assert.equal(await testPrisma.material.findUnique({ where: { id: skuId } }).then((m) => m.unit), "CAN");

  const d = (await w.a.get(`/api/finance/purchase-orders/${po.id}`)).body;
  assert.equal(d.lines[0].diterimaBaik, 2);
  assert.equal(d.lines[0].satuan, "BOX");
  assert.equal(d.status, "SELESAI");
  assert.equal(d.totalDiterima, 2 * HARGA_BOX);
});

test("penerimaan berkonversi yang melebihi presisi stok ditolak sebelum stok tertulis", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "KAIN-001", name: "Kain Lapis", unit: "KG" });
  const po = (await w.a.post("/api/finance/purchase-orders", poBody(w, [{ materialId: m.id, qty: 5, unitPrice: 90_000, satuanBeli: "BOX", faktorKonversi: 12.5001 }]))).body;
  assert.equal((await w.a.post(`/api/finance/purchase-orders/${po.id}/approve`, {})).status, 200);
  const gr = (await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.id })).body;
  await bawaSampaiSiap(w.g, gr, { datang: 0.333, sampaiInspeksi: true });
  // 0,333 BOX × 12,5001 = 4,16253 → 5 desimal > presisi stok 4.
  const isi = await w.g.patch(`/api/inventory/goods-receipts/${gr.id}/lines/${gr.lines[0].id}`, { acceptedQty: 0.333, rejectedQty: 0 });
  assert.equal(isi.status, 400, JSON.stringify(isi.body));
  assert.equal(await testPrisma.stockMovement.count(), 0);
});

// ═══ perbaikan & kunci SKU ═══
test("SKU boleh diperbaiki Admin sebelum ada pergerakan; sesudahnya kode & satuan stok terkunci dan nama butuh alasan", async () => {
  const w = await dunia();
  const po = (await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru({ satuanBeli: "CAN", faktorKonversi: undefined })]))).body;
  const id = po.lines[0].materialId;
  assert.equal((await w.f.patch(`/api/finance/purchase-orders/sku/${id}`, { nama: "X" })).status, 403);
  assert.equal((await w.a.patch(`/api/finance/purchase-orders/sku/${id}`, { code: "ABC-999" })).status, 409);
  const ubah = await w.a.patch(`/api/finance/purchase-orders/sku/${id}`, { nama: "Lem Semprot 500 ML (Revisi)", spesifikasi: "Kaleng 500 ml, aerosol", satuanStok: "PCS" });
  assert.equal(ubah.status, 200, JSON.stringify(ubah.body));
  assert.equal(ubah.body.satuanStok, "PCS");

  // Beri pergerakan stok → terkunci.
  assert.equal((await w.a.post(`/api/finance/purchase-orders/${po.id}/approve`, {})).status, 200);
  const gr = (await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.id })).body;
  await bawaSampaiSiap(w.g, gr, { datang: 2, baik: 2, tolak: 0 });
  assert.equal((await w.g.post(`/api/inventory/goods-receipts/${gr.id}/putaway`, {})).status, 200);

  const kunci = await w.a.patch(`/api/finance/purchase-orders/sku/${id}`, { satuanStok: "KG" });
  assert.equal(kunci.status, 409);
  assert.equal(kunci.body.code, "SATUAN_TERKUNCI");
  assert.equal((await w.a.patch(`/api/finance/purchase-orders/sku/${id}`, { nama: "Nama Baru" })).status, 400);
  const ok = await w.a.patch(`/api/finance/purchase-orders/sku/${id}`, { nama: "Lem Semprot 500 ML Aerosol", alasan: "Koreksi ejaan" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.sudahBergerak, true);
  assert.equal(ok.body.terkunci.satuanStok, true);
  const log = await testPrisma.activityEvent.findFirst({ where: { entityId: id, eventType: "MATERIAL_UPDATED" }, orderBy: { createdAt: "desc" } });
  assert.equal(log.metadata.aksi, "sku_diperbaiki");
  assert.equal(log.metadata.alasan, "Koreksi ejaan");
});

// ═══ Produksi vs Gudang ═══
test("Perlengkapan Stok tidak muncul sebagai pilihan bahan Produksi; Bahan Produksi tetap tampil; material lama tak terpengaruh", async () => {
  const w = await dunia();
  const lama = await createTestMaterial({ code: "OLD-001", name: "Material Lama", unit: "KG" });
  const bahan = (await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru()]))).body.lines[0];
  const perl = (await w.a.post("/api/finance/purchase-orders", poBody(w, [barisBaru({ nama: "Sarung Tangan Kerja", jenis: "PERLENGKAPAN_STOK", kategori: "APD", satuanBeli: "CAN", faktorKonversi: undefined, kodeSupplier: "ST-1" }, 10, 20_000)]))).body.lines[0];

  const gudang = (await w.g.get("/api/inventory/materials?active=true")).body.map((m) => m.id);
  assert.ok(gudang.includes(perl.materialId) && gudang.includes(bahan.materialId) && gudang.includes(lama.id), "Gudang melihat semuanya");
  const prod = (await w.g.get("/api/inventory/materials?active=true&untuk=produksi")).body.map((m) => m.id);
  assert.ok(prod.includes(bahan.materialId) && prod.includes(lama.id));
  assert.ok(!prod.includes(perl.materialId), "Perlengkapan Stok tidak jadi pilihan bahan Produksi");
  const m = await testPrisma.material.findUnique({ where: { id: perl.materialId } });
  assert.equal(m.kind, "PERLENGKAPAN_STOK");
  assert.equal(m.category, "CONSUMABLE");
});

// ═══ PDF ═══
test("PDF/view PO memuat catatan 'Setara dengan' hanya untuk baris berkonversi", async () => {
  const w = await dunia();
  const lem = await createTestMaterial({ code: "LEM-1037", name: "LEM I-SR 1037 13 KG", unit: "KG" });
  const po = (await w.a.post("/api/finance/purchase-orders", poBody(w, [{ materialId: lem.id, qty: 5, unitPrice: 100_000 }, barisBaru()]))).body;
  const view = await bangunViewPO(testPrisma, po.id);
  const biasa = view.po.lines.find((l) => l.kode === "LEM-1037");
  const konv = view.po.lines.find((l) => l.kode !== "LEM-1037");
  assert.equal(biasa.setaraQty, undefined);
  assert.equal(konv.setaraQty, 24);
  assert.equal(konv.setaraSatuan, "CAN");
  const pdf = await w.f.get(`/api/finance/purchase-orders/${po.id}/pdf`);
  assert.equal(pdf.status, 200);
});
