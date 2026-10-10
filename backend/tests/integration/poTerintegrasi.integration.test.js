// PO TERINTEGRASI FINANCE–GUDANG — terhadap PostgreSQL sungguhan. Yang dikunci:
// (1) split delivery: PO 10 KG → datang 5 KG/1 lembar → 5 KG/1 lembar pada tanggal berbeda, tiap pengiriman = penerimaan sendiri, status Diterima Sebagian → Selesai;
// (2) over-receipt ditolak (Finance harus revisi PO), barang ditolak melepas sisa, klik/permintaan PARALEL dan replay tidak saling menimpa;
// (3) Finance & Gudang membaca data yang sama — Gudang TANPA harga/total/termin/faktur; aktor/peran/workspace dari sesi;
// (4) koreksi tanggal/jumlah wajib beralasan + audit sebelum–sesudah + kunci revisi; (5) pendamping: konversi tetap & jumlah aktual, tanpa pengaruh ke stok/nilai/jurnal;
// (6) termin dari tanggal tiba: satu faktur dua penerimaan = dua jadwal jatuh tempo, utang tidak ganda, pembayaran sebagian FIFO; (7) stok hanya berubah saat Simpan ke Stok, PO/kedatangan tanpa jurnal;
// (8) penerimaan tanpa PO dan data lama tidak berubah.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { bangunViewPO } from "../../src/services/finance/purchaseOrderDocument.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const H = 43_290;
const kunci = () => ({ "Idempotency-Key": `poi-${randomUUID()}` });
const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);
const hariIni = () => geser(0);
let nomorFaktur = 0;
const ref = () => `FAK-POI-${String(++nomorFaktur).padStart(4, "0")}`;

async function dunia({ termin = { paymentTermType: "HARI", paymentTermDays: 30 } } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const [fin, admin, gudang, approver, sales, prod] = await Promise.all(["FINANCE", "ADMIN", "WAREHOUSE", "APPROVER", "SALES", "PRODUCTION_LEAD"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-ESA", name: "PT ESA BUMINDO", ...termin } });
  const lem = await createTestMaterial({ code: "BUSA-R50", name: "Busa Rebonded R50", unit: "KG" });
  return { f: c(fin), a: c(admin), g: c(gudang), ap: c(approver), s: c(sales), p: c(prod), fin, admin, gudang, bank, supplier, lem };
}
async function poDisetujui(w, { qty = 10, harga = H, pendamping, orderDate = geser(-20), expectedDate, materialId } = {}) {
  const c = await w.f.post("/api/finance/purchase-orders", {
    supplierId: w.supplier.id, orderDate, ...(expectedDate && { expectedDate }),
    lines: [{ materialId: materialId ?? w.lem.id, qty, unitPrice: harga, ...(pendamping && { pendamping }) }],
  });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}
const tiba = (klien, poId, body, headers = kunci()) => klien.post(`/api/inventory/barang-akan-datang/${poId}/kedatangan`, { penerima: "Budi Gudang", catatan: "Barang tiba utuh", ...body }, headers);
const tibaFin = (klien, poId, body, headers = kunci()) => klien.post(`/api/finance/purchase-orders/${poId}/kedatangan`, { penerima: "Sari (Finance)", catatan: "Dicek lewat foto", ...body }, headers);
const isiPeriksa = async (w, receiptId, { baik, tolak = 0 }) => {
  const gr = (await w.g.get(`/api/inventory/goods-receipts/${receiptId}`)).body;
  for (const st of ["INSPECTION"]) assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${receiptId}`, { status: st })).status, 200);
  const r = await w.g.patch(`/api/inventory/goods-receipts/${receiptId}/lines/${gr.lines[0].id}`, { acceptedQty: baik, rejectedQty: tolak });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${receiptId}`, { status: "READY_FOR_PUTAWAY" })).status, 200);
};
const simpanStok = (w, receiptId) => w.g.post(`/api/inventory/goods-receipts/${receiptId}/putaway`, {});
const detailG = async (w, poId) => (await w.g.get(`/api/inventory/barang-akan-datang/${poId}`)).body;
const detailF = async (w, poId) => (await w.f.get(`/api/finance/purchase-orders/${poId}`)).body.kedatangan;
const cacah = async () => {
  const j = await testPrisma.finJournalLine.aggregate({ _sum: { debit: true, credit: true } });
  return { stok: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), d: String(j._sum.debit ?? 0), k: String(j._sum.credit ?? 0), tagihan: await testPrisma.finSupplierBill.count() };
};

// ═══ 1. Split delivery + dual quantity ═══
test("PO 10 KG (perkiraan 2 lembar) → datang 5 KG/1 lembar → 5 KG/1 lembar pada tanggal berbeda: dua penerimaan, Diterima Sebagian lalu Selesai; PDF 10 KG — perkiraan 2 lembar; stok/jurnal hanya saat Simpan ke Stok", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { pendamping: { satuan: "LEMBAR", mode: "AKTUAL", estimasi: 2 }, expectedDate: geser(5) });
  assert.equal(po.lines[0].pendamping.teks, "perkiraan 2 lembar");
  const view = await bangunViewPO(testPrisma, po.id);
  assert.equal(view.po.lines[0].pendampingTeks, "10 KG — perkiraan 2 lembar");
  assert.equal((await w.f.get(`/api/finance/purchase-orders/${po.id}/pdf`)).status, 200);

  let g = await detailG(w, po.id);
  assert.equal(g.statusAkanDatang.kode, "MENUNGGU_KEDATANGAN");
  assert.deepEqual([g.lines[0].dipesan, g.lines[0].datang, g.lines[0].belumDatang, g.lines[0].belumMasukStok], [10, 0, 10, 10]);
  const awal = await cacah();

  const t1 = geser(-6); const t2 = geser(-2);
  const r1 = await tiba(w.g, po.id, { tanggalTiba: t1, suratJalan: "SJ-001", lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: 5, jumlahPendamping: 1 }] });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.deepEqual(await cacah(), awal, "mencatat kedatangan TIDAK menulis stok/jurnal/tagihan");
  const gr1 = await testPrisma.goodsReceipt.findUnique({ where: { id: r1.body.receiptId } });
  assert.equal(gr1.status, "ARRIVED");
  assert.equal(gr1.arrivalWorkspace, "GUDANG"); assert.equal(gr1.arrivalActorRoles, "WAREHOUSE"); assert.equal(gr1.arrivalRecordedById, w.gudang.user.id);
  assert.equal(gr1.arrivedDate.toISOString().slice(0, 10), t1);
  g = r1.body.po;
  assert.deepEqual([g.lines[0].dipesan, g.lines[0].datang, g.lines[0].belumDatang, g.lines[0].belumDiperiksa, g.lines[0].ditolak, g.lines[0].baikBelumDisimpan, g.lines[0].masukStok, g.lines[0].belumMasukStok], [10, 5, 5, 5, 0, 0, 0, 10]);
  assert.equal(g.lines[0].pendamping.aktual, 1);
  assert.equal(g.statusAkanDatang.kode, "PERLU_DIPERIKSA");
  assert.ok(g.bendera.map((b) => b.kode).includes("DITERIMA_SEBAGIAN"));
  assert.deepEqual(g.penerimaan[0].kekurangan, ["Bukti kedatangan belum dilampirkan"], "surat jalan terisi; bukti belum → kekurangan terlihat");

  await isiPeriksa(w, r1.body.receiptId, { baik: 5 });
  assert.equal((await detailG(w, po.id)).statusAkanDatang.kode, "SIAP_DISIMPAN");
  assert.equal((await simpanStok(w, r1.body.receiptId)).status, 200);
  const sesudahSimpan = await testPrisma.goodsReceipt.findUnique({ where: { id: r1.body.receiptId } });
  assert.equal(sesudahSimpan.arrivedDate.toISOString().slice(0, 10), t1, "Simpan ke Stok TIDAK mengubah tanggal tiba");
  assert.equal((await testPrisma.finPurchaseOrder.findUnique({ where: { id: po.id } })).status, "DITERIMA_SEBAGIAN");
  assert.equal(await testPrisma.stockMovement.count(), 1);

  // pengiriman kedua dicatat FINANCE pada penerimaan yang sama
  const r2 = await tibaFin(w.f, po.id, { tanggalTiba: t2, suratJalan: "SJ-002", lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: 5, jumlahPendamping: 1 }] });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.notEqual(r2.body.receiptId, r1.body.receiptId, "satu penerimaan per pengiriman");
  const gr2 = await testPrisma.goodsReceipt.findUnique({ where: { id: r2.body.receiptId } });
  assert.equal(gr2.arrivalWorkspace, "FINANCE"); assert.equal(gr2.arrivalActorRoles, "FINANCE"); assert.equal(gr2.deliveryNote, "SJ-002");
  await isiPeriksa(w, r2.body.receiptId, { baik: 5 });
  assert.equal((await simpanStok(w, r2.body.receiptId)).status, 200);

  const f = await detailF(w, po.id);
  assert.equal(f.statusAkanDatang.kode, "SELESAI");
  assert.deepEqual([f.lines[0].dipesan, f.lines[0].datang, f.lines[0].belumDatang, f.lines[0].belumDiperiksa, f.lines[0].ditolak, f.lines[0].baikBelumDisimpan, f.lines[0].masukStok, f.lines[0].belumMasukStok], [10, 10, 0, 0, 0, 0, 10, 0]);
  assert.equal(f.lines[0].pendamping.aktual, 2);
  assert.deepEqual(f.penerimaan.map((r) => [r.suratJalan, r.tanggalTiba, r.dicatat.workspace]), [["SJ-001", t1, "GUDANG"], ["SJ-002", t2, "FINANCE"]]);
  assert.equal(await testPrisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } }), 2);
  // stok = KG (5+5), pendamping tidak memengaruhi stok/nilai
  const stok = await testPrisma.stockMovement.findMany({ orderBy: { createdAt: "asc" } });
  assert.deepEqual(stok.map((m) => [Number(m.qty), m.unitCost]), [[5, H], [5, H]]);
  const grni = await testPrisma.finJournalEntry.findMany({ where: { source: "PENERIMAAN_BAHAN" }, include: { lines: true } });
  assert.equal(grni.length, 2);
  assert.ok(grni.every((e) => e.lines.reduce((s, l) => s + Number(l.debit), 0) === 5 * H), "nilai persediaan = KG × harga PO (bukan lembar)");
  assert.equal(await testPrisma.goodsReceiptEvent.count(), 2);
});

// ═══ 2. Over-receipt, ditolak melepas sisa, paralel, replay ═══
test("total penerimaan melebihi PO ditolak (409, Finance revisi PO); barang ditolak TETAP terhitung sudah datang (tidak melepas batas PO); kedatangan paralel dan replay tidak menimpa", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  const a = await tiba(w.g, po.id, { tanggalTiba: geser(-3), lines: [{ purchaseOrderLineId: L, jumlahDatang: 6 }] });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const lebih = await tiba(w.g, po.id, { tanggalTiba: geser(-2), lines: [{ purchaseOrderLineId: L, jumlahDatang: 5 }] });
  assert.equal(lebih.status, 409); assert.equal(lebih.body.code, "MELEBIHI_PO");
  assert.match(lebih.body.error, /melebihi sisa PO/); assert.match(lebih.body.error, /merevisi jumlah PO/);
  assert.equal(await testPrisma.goodsReceipt.count({ where: { arrivalRevision: { gt: 0 } } }), 1, "penolakan tidak mencatat kedatangan apa pun (draf kosong yang tersisa dipakai ulang)");
  // 6 datang, 2 ditolak saat pemeriksaan → yang ditolak TETAP sudah datang: pengiriman biasa maksimal 10 − 6 = 4; 2 ditolak menunggu pengganti
  await isiPeriksa(w, a.body.receiptId, { baik: 4, tolak: 2 });
  const lebihLagi = await tiba(w.g, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 5 }] });
  assert.equal(lebihLagi.status, 409); assert.equal(lebihLagi.body.code, "MELEBIHI_PO");
  assert.match(lebihLagi.body.error, /tandai sebagai pengiriman pengganti/, "pesan menunjuk jalur pengganti untuk 2 yang menunggu");
  const biasa = await tiba(w.g, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 4 }] });
  assert.equal(biasa.status, 201, JSON.stringify(biasa.body));
  // Finance menaikkan PO → bisa menerima lebih
  assert.equal((await w.a.post(`/api/finance/purchase-orders/${po.id}/revisi-jumlah`, { lineId: L, qty: 12, reason: "Supplier kirim lebih, disepakati" })).status, 200);
  assert.equal((await tiba(w.g, po.id, { tanggalTiba: hariIni(), lines: [{ purchaseOrderLineId: L, jumlahDatang: 2 }] })).status, 201);
});

test("PARALEL: dua kedatangan serentak melebihi PO → satu berhasil; replay kunci sama = hasil sama; klik ganda pada penerimaan terjadwal tidak menimpa; koreksi paralel dengan revisi sama → satu yang menang", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  const k1 = kunci(); const k2 = kunci();
  const [x, y] = await Promise.all([
    tiba(w.g, po.id, { tanggalTiba: geser(-2), lines: [{ purchaseOrderLineId: L, jumlahDatang: 6 }] }, k1),
    tiba(w.f ? w.g : w.g, po.id, { tanggalTiba: geser(-2), penerima: "Andi", lines: [{ purchaseOrderLineId: L, jumlahDatang: 6 }] }, k2),
  ]);
  assert.deepEqual([x.status, y.status].sort(), [201, 409], JSON.stringify([x.body, y.body]));
  assert.equal(await testPrisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } }), 1);
  const menang = x.status === 201 ? { r: x, k: k1, body: { tanggalTiba: geser(-2), lines: [{ purchaseOrderLineId: L, jumlahDatang: 6 }] } } : { r: y, k: k2, body: { tanggalTiba: geser(-2), penerima: "Andi", lines: [{ purchaseOrderLineId: L, jumlahDatang: 6 }] } };
  const ulang = await tiba(w.g, po.id, menang.body, menang.k);
  assert.equal(ulang.status, 201); assert.equal(ulang.body.receiptId, menang.r.body.receiptId, "replay = respons pertama");
  assert.equal(await testPrisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } }), 1);

  // klik ganda pada penerimaan terjadwal (Gudang membuat jadwal dulu)
  const w2 = await dunia().catch(() => null);
  void w2;
  const jadwal = await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: L, orderedQty: 4 }] });
  assert.equal(jadwal.status, 201, JSON.stringify(jadwal.body));
  const dua = await Promise.all([1, 2, 3].map(() => tiba(w.g, po.id, { receiptId: jadwal.body.id, tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 4 }] })));
  assert.equal(dua.filter((r) => r.status === 201).length, 1, JSON.stringify(dua.map((r) => [r.status, r.body?.code])));
  assert.ok(dua.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.body.code === "KEDATANGAN_SUDAH_DICATAT"));
  assert.equal(await testPrisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } }), 2);

  // koreksi paralel dengan revisi yang sama
  const gr = await testPrisma.goodsReceipt.findUnique({ where: { id: menang.r.body.receiptId } });
  const koreksi = (penerima) => w.g.post(`/api/inventory/barang-akan-datang/penerimaan/${gr.id}/koreksi`, { revisi: gr.arrivalRevision, alasan: "Salah ketik PIC", perubahan: { penerima } }, kunci());
  const [c1, c2] = await Promise.all([koreksi("Citra"), koreksi("Dodi")]);
  assert.deepEqual([c1.status, c2.status].sort(), [200, 409], JSON.stringify([c1.body, c2.body]));
  assert.equal([c1, c2].find((r) => r.status === 409).body.code, "REVISI_USANG");
  assert.equal((await testPrisma.goodsReceipt.findUnique({ where: { id: gr.id } })).arrivalRevision, gr.arrivalRevision + 1);
});

// ═══ 3. Satu sumber, hak akses ═══
test("Finance dan Gudang melihat angka yang sama; Gudang TIDAK melihat harga/total/termin/faktur/utang; Finance melihat lengkap; izin tulis dipisah", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { expectedDate: geser(-3) });
  const L = po.lines[0].id;
  const r = await tiba(w.g, po.id, { tanggalTiba: geser(-4), lines: [{ purchaseOrderLineId: L, jumlahDatang: 4 }] });
  assert.equal(r.status, 201);
  const gud = await w.g.get("/api/inventory/barang-akan-datang");
  assert.equal(gud.status, 200);
  const teks = JSON.stringify(gud.body) + JSON.stringify(await detailG(w, po.id));
  for (const dilarang of ["hargaSatuan", "unitPrice", "nilaiDipesan", "nilaiMasukStok", "totalDipesan", "termin", "faktur", "jatuhTempo", "utang", "pembayaran", String(H)]) assert.equal(teks.includes(dilarang), false, `Gudang tidak boleh melihat: ${dilarang}`);
  const g = await detailG(w, po.id); const f = await detailF(w, po.id);
  assert.deepEqual(f.lines.map((l) => l.progres), g.lines.map((l) => l.progres), "Finance & Gudang: angka progres IDENTIK (satu helper server)");
  assert.equal(f.lines[0].hargaSatuan, H); assert.equal(f.totalDipesan, 10 * H);
  assert.equal(f.penerimaan[0].jatuhTempo.status, "TERJADWAL");
  assert.equal(f.penerimaan[0].jatuhTempo.jatuhTempo, geser(-4 + 30), "30 hari dari tanggal TIBA");
  assert.equal(g.statusAkanDatang.kode, "PERLU_DIPERIKSA");
  assert.ok(g.bendera.map((b) => b.kode).includes("TERLAMBAT"), "estimasi lewat dan masih ada sisa → Terlambat");
  // filter status + hitungan
  const daftar = (await w.g.get("/api/inventory/barang-akan-datang?status=TERLAMBAT")).body;
  assert.equal(daftar.purchaseOrders.length, 1); assert.equal(daftar.hitungan.TERLAMBAT, 1); assert.equal(daftar.hitungan.MENUNGGU_KEDATANGAN, 0);
  // draf tidak terlihat Gudang
  const draf = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 1, unitPrice: H }] });
  assert.equal((await w.g.get(`/api/inventory/barang-akan-datang/${draf.body.id}`)).status, 404);
  assert.equal((await w.g.get("/api/inventory/barang-akan-datang")).body.purchaseOrders.length, 1);
  // izin
  assert.equal((await w.s.get("/api/inventory/barang-akan-datang")).status, 403, "Sales tidak punya akses");
  assert.equal((await tiba(w.s, po.id, { tanggalTiba: hariIni(), lines: [{ purchaseOrderLineId: L, jumlahDatang: 1 }] })).status, 403);
  assert.equal((await w.g.get("/api/finance/purchase-orders/kedatangan")).status, 403, "Gudang tidak masuk jalur Finance");
  assert.equal((await tibaFin(w.g, po.id, { tanggalTiba: hariIni(), lines: [{ purchaseOrderLineId: L, jumlahDatang: 1 }] })).status, 403);
  // Finance mencatat tiba, tetapi TIDAK boleh memeriksa/menyimpan ke stok (inventory:write hanya Gudang)
  const rf = await tibaFin(w.f, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 2 }] });
  assert.equal(rf.status, 201, JSON.stringify(rf.body));
  assert.equal((await w.f.patch(`/api/inventory/goods-receipts/${rf.body.receiptId}`, { status: "INSPECTION" })).status, 403);
  assert.equal((await w.f.post(`/api/inventory/goods-receipts/${rf.body.receiptId}/putaway`, {})).status, 403);
  assert.equal((await w.s.post(`/api/inventory/goods-receipts/${rf.body.receiptId}/putaway`, {})).status, 403, "Sales pun tidak");
});

// ═══ 4. Wajib isi + jalur lama ditutup ═══
test("wajib: tanggal tiba, jumlah datang, PIC/penerima, catatan; surat jalan & bukti opsional; jalur lama (ganti status ke Tiba / isi jumlah datang langsung) tidak lagi melewati syarat", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  const bagus = { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 3 }] };
  for (const [nama, ubah] of [["tanggal", { tanggalTiba: undefined }], ["PIC", { penerima: "" }], ["catatan", { catatan: "" }], ["jumlah", { lines: [] }], ["tanggal masa depan", { tanggalTiba: geser(2) }], ["sebelum tanggal PO", { tanggalTiba: geser(-40) }]]) {
    const r = await tiba(w.g, po.id, { ...bagus, ...ubah });
    assert.equal(r.status, 400, `${nama}: ${JSON.stringify(r.body)}`);
  }
  assert.equal((await w.g.post(`/api/inventory/barang-akan-datang/${po.id}/kedatangan`, { penerima: "Budi", catatan: "x", ...bagus })).status, 428, "Idempotency-Key wajib");
  assert.equal(await testPrisma.goodsReceipt.count({ where: { arrivalRevision: { gt: 0 } } }), 0, "tidak ada kedatangan tercatat");
  const ok = await tiba(w.g, po.id, bagus);
  assert.equal(ok.status, 201);
  assert.equal(await testPrisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } }), 1, "isian yang pasti salah tidak meninggalkan draf; draf dari penolakan lain dipakai ulang");
  assert.deepEqual(ok.body.po.penerimaan.find((r) => r.id === ok.body.receiptId).kekurangan.sort(), ["Bukti kedatangan belum dilampirkan", "Surat jalan belum dilampirkan"].sort());
  // jalur lama untuk penerimaan PO baru: ganti status → Tiba ditolak; jumlah datang langsung ditolak
  const jadwal = await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: L, orderedQty: 2 }] });
  assert.equal(jadwal.status, 201);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${jadwal.body.id}`, { status: "SCHEDULED" })).status, 200);
  const jalanLama = await w.g.patch(`/api/inventory/goods-receipts/${jadwal.body.id}`, { status: "ARRIVED" });
  assert.equal(jalanLama.status, 400); assert.match(jalanLama.body.error, /Catat Barang Tiba/);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${jadwal.body.id}/lines/${jadwal.body.lines[0].id}`, { receivedQty: 2 })).status, 400);
  // penerimaan TANPA PO: jalur lama tetap bebas
  const mat = await createTestMaterial({ code: "KAIN-1", name: "Kain", unit: "METER" });
  const lama = await w.g.post("/api/inventory/goods-receipts", { sourceType: "MANUAL", lines: [{ materialId: mat.id }] });
  assert.equal(lama.status, 201);
  for (const st of ["SCHEDULED", "ARRIVED"]) assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${lama.body.id}`, { status: st })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${lama.body.id}/lines/${lama.body.lines[0].id}`, { receivedQty: 3 })).status, 200);
  const dilihat = (await w.g.get("/api/inventory/barang-akan-datang")).body.purchaseOrders;
  assert.equal(dilihat.length, 1, "penerimaan tanpa PO tidak masuk Barang Akan Datang");
  const baris = await testPrisma.goodsReceipt.findUnique({ where: { id: lama.body.id } });
  assert.equal(baris.arrivedDate, null); assert.equal(baris.arrivalRevision, 0);
});

// ═══ 5. Koreksi + audit ═══
test("koreksi tanggal/jumlah: alasan wajib, tercatat sebelum–sesudah, revisi naik; jumlah terkunci setelah pemeriksaan; jatuh tempo mengikuti tanggal tiba hasil koreksi", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  const t1 = geser(-5);
  const r = await tiba(w.g, po.id, { tanggalTiba: t1, lines: [{ purchaseOrderLineId: L, jumlahDatang: 5 }] });
  const id = r.body.receiptId;
  const k = (perubahan, body = {}) => w.f.post(`/api/finance/purchase-orders/penerimaan/${id}/koreksi-kedatangan`, { revisi: 1, alasan: "Tanggal di surat jalan berbeda", perubahan, ...body }, kunci());
  assert.equal((await k({ tanggalTiba: geser(-7) }, { alasan: "" })).status, 400, "alasan wajib");
  assert.equal((await k({ tanggalTiba: geser(-7) }, { revisi: 5 })).status, 409, "revisi usang");
  assert.equal((await k({})).status, 400, "tanpa perubahan");
  assert.equal((await k({ tanggalTiba: geser(-60) })).status, 400, "sebelum tanggal PO");
  const ok = await k({ tanggalTiba: geser(-7), lines: [{ purchaseOrderLineId: L, jumlahDatang: 4 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.revisi, 2);
  const ev = await testPrisma.goodsReceiptEvent.findMany({ orderBy: { createdAt: "asc" } });
  assert.deepEqual(ev.map((e) => e.type), ["KEDATANGAN_DICATAT", "KEDATANGAN_DIKOREKSI"]);
  assert.equal(ev[1].reason, "Tanggal di surat jalan berbeda"); assert.equal(ev[1].workspace, "FINANCE");
  assert.equal(ev[1].before.tanggalTiba, t1); assert.equal(ev[1].after.tanggalTiba, geser(-7));
  assert.equal(ev[1].before.lines[0].datang, 5); assert.equal(ev[1].after.lines[0].datang, 4);
  assert.equal((await detailF(w, po.id)).penerimaan[0].jatuhTempo.jatuhTempo, geser(-7 + 30));
  // riwayat append-only di DB
  await assert.rejects(() => testPrisma.goodsReceiptEvent.update({ where: { id: ev[0].id }, data: { reason: "diubah" } }), /append-only/);
  await assert.rejects(() => testPrisma.goodsReceiptEvent.delete({ where: { id: ev[0].id } }), /append-only/);
  // setelah pemeriksaan jumlah datang terkunci, tanggal tetap boleh
  await isiPeriksa(w, id, { baik: 4 });
  const kunciJml = await w.f.post(`/api/finance/purchase-orders/penerimaan/${id}/koreksi-kedatangan`, { revisi: 2, alasan: "Salah hitung", perubahan: { lines: [{ purchaseOrderLineId: L, jumlahDatang: 3 }] } }, kunci());
  assert.equal(kunciJml.status, 409); assert.equal(kunciJml.body.code, "JUMLAH_TERKUNCI");
  assert.equal((await w.g.post(`/api/inventory/barang-akan-datang/penerimaan/${id}/koreksi`, { revisi: 2, alasan: "Tanggal tiba bergeser sehari", perubahan: { tanggalTiba: geser(-6) } }, kunci())).status, 200);
});

// ═══ 6. Pendamping: konversi tetap & aktual ═══
test("pendamping: konversi tetap (1 DUS = 12 KALENG, dihitung server) dan jumlah aktual tanpa rasio; tidak mengubah stok/nilai/jurnal; tidak bisa digabung konversi satuan; kekurangan terlihat", async () => {
  const w = await dunia();
  const kaleng = await createTestMaterial({ code: "LEM-KLG", name: "Lem Kaleng", unit: "KG" });
  // tidak boleh digabung konversi satuan beli → stok
  const gabung = await w.a.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: kaleng.id, qty: 2, unitPrice: H, satuanBeli: "BOX", faktorKonversi: 12, pendamping: { satuan: "KALENG", mode: "TETAP", rasio: 12 } }] });
  assert.equal(gabung.status, 400, JSON.stringify(gabung.body));
  // validasi masukan
  for (const p of [{ satuan: "KALENG", mode: "TETAP" }, { satuan: "KALENG", mode: "TETAP", rasio: 0 }, { satuan: "LEMBAR", mode: "AKTUAL", rasio: 3 }, { mode: "AKTUAL" }, { satuan: "LEMBAR", mode: "ACAK" }]) {
    const r = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 1, unitPrice: H, pendamping: p }] });
    assert.equal(r.status, 400, JSON.stringify(p));
  }
  const tetap = await poDisetujui(w, { qty: 3, pendamping: { satuan: "KALENG", mode: "TETAP", rasio: 12 }, materialId: kaleng.id });
  assert.equal(tetap.lines[0].pendamping.estimasi, 36); assert.equal(tetap.lines[0].pendamping.teks, "setara 36 kaleng");
  const aktual = await poDisetujui(w, { qty: 10, pendamping: { satuan: "LEMBAR", mode: "AKTUAL" } });
  assert.equal(aktual.lines[0].pendamping.estimasi, null);
  assert.equal((await bangunViewPO(testPrisma, aktual.id)).po.lines[0].pendampingTeks, "10 KG — jumlah lembar dicatat saat barang tiba");

  // TETAP: server menghitung aktual = datang × rasio (angka dari klien diabaikan)
  const a = await tiba(w.g, tetap.id, { tanggalTiba: geser(-2), lines: [{ purchaseOrderLineId: tetap.lines[0].id, jumlahDatang: 2, jumlahPendamping: 999 }] });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.po.lines[0].pendamping.aktual, 24);
  // AKTUAL: tanpa angka → kekurangan; 1 lembar ≠ berat tetap (angka lembar tidak diturunkan dari KG)
  const b = await tiba(w.g, aktual.id, { tanggalTiba: geser(-2), lines: [{ purchaseOrderLineId: aktual.lines[0].id, jumlahDatang: 5 }] });
  assert.equal(b.status, 201);
  assert.ok(b.body.po.penerimaan[0].kekurangan.some((x) => /lembar aktual belum diisi/.test(x)));
  assert.equal(b.body.po.lines[0].pendamping.aktual, null);
  const koreksi = await w.g.post(`/api/inventory/barang-akan-datang/penerimaan/${b.body.receiptId}/koreksi`, { revisi: 1, alasan: "Hitung lembar saat bongkar", perubahan: { lines: [{ purchaseOrderLineId: aktual.lines[0].id, jumlahPendamping: 1 }] } }, kunci());
  assert.equal(koreksi.status, 200, JSON.stringify(koreksi.body));
  assert.equal(koreksi.body.po.lines[0].pendamping.aktual, 1);
  assert.equal((await tiba(w.g, aktual.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: aktual.lines[0].id, jumlahDatang: 1, jumlahPendamping: -2 }] })).status, 400);
  // baris tanpa pendamping menolak angka pendamping
  const biasa = await poDisetujui(w, { qty: 4 });
  assert.equal((await tiba(w.g, biasa.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: biasa.lines[0].id, jumlahDatang: 2, jumlahPendamping: 1 }] })).status, 400);

  // nilai/stok/jurnal ditentukan KG × harga, tidak oleh pendamping
  for (const [po, rid, baik] of [[tetap, a.body.receiptId, 2], [aktual, b.body.receiptId, 5]]) { await isiPeriksa(w, rid, { baik }); assert.equal((await simpanStok(w, rid)).status, 200); void po; }
  const stok = await testPrisma.stockMovement.findMany({ orderBy: { createdAt: "asc" } });
  assert.deepEqual(stok.map((m) => [Number(m.qty), m.unitCost]), [[2, H], [5, H]]);
});

// ═══ 7. Termin dari tanggal tiba ═══
test("termin: tidak berjalan saat PO dibuat; satu faktur untuk dua penerimaan = dua jadwal jatuh tempo; total faktur/utang tidak ganda; pembayaran sebagian FIFO; aging satu baris per penerimaan", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const L = po.lines[0].id;
  const d0 = await detailF(w, po.id);
  assert.equal(d0.terminStatus, "MENUNGGU_TANGGAL_PENERIMAAN");
  assert.equal(d0.termin.label, "30 hari");
  const t1 = geser(-12); const t2 = geser(-4);
  const r1 = await tiba(w.g, po.id, { tanggalTiba: t1, suratJalan: "SJ-1", lines: [{ purchaseOrderLineId: L, jumlahDatang: 6 }] });
  const r2 = await tiba(w.g, po.id, { tanggalTiba: t2, suratJalan: "SJ-2", lines: [{ purchaseOrderLineId: L, jumlahDatang: 4 }] });
  for (const r of [r1, r2]) { await isiPeriksa(w, r.body.receiptId, { baik: r === r1 ? 6 : 4 }); assert.equal((await simpanStok(w, r.body.receiptId)).status, 200); }
  assert.equal((await testPrisma.finPurchaseOrder.findUnique({ where: { id: po.id } })).status, "SELESAI");
  const sebelumFaktur = await cacah();

  // SATU faktur untuk SEMUA penerimaan (10 KG × harga faktur sama)
  const fk = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate: hariIni(), lines: [{ purchaseOrderLineId: L, qty: 10, unitPrice: H }] });
  assert.equal(fk.status, 201, JSON.stringify(fk.body));
  assert.equal(fk.body.termBasis, "TANGGAL_TIBA");
  assert.equal(fk.body.dueDate.slice(0, 10), geser(-12 + 30), "sebelum disetujui: jatuh tempo terawal dari tanggal tiba, BUKAN tanggal faktur");
  const setuju = await w.ap.post(`/api/finance/bills/${fk.body.billId}/approve`, {});
  assert.equal(setuju.status, 200, JSON.stringify(setuju.body));
  const bill = await testPrisma.finSupplierBill.findUnique({ where: { id: fk.body.billId } });
  assert.equal(Number(bill.amount), 10 * H);
  assert.equal(bill.dueDate.toISOString().slice(0, 10), geser(-12 + 30));

  const ev = (await w.f.get(`/api/finance/purchase-orders/faktur/${fk.body.billId}`)).body;
  assert.equal(ev.jadwalJatuhTempo.length, 2);
  assert.deepEqual(ev.jadwalJatuhTempo.map((j) => [j.tanggalTiba, j.jatuhTempo, j.nilai]), [[t1, geser(-12 + 30), 6 * H], [t2, geser(-4 + 30), 4 * H]]);
  assert.equal(ev.jadwalJatuhTempo.reduce((s, j) => s + j.nilai, 0), 10 * H, "Σ jadwal = nilai faktur (tidak digandakan)");

  // utang SATU (jurnal faktur sekali), pembayaran sebagian menutup jadwal pertama dulu
  const jurnalFaktur = await testPrisma.finJournalEntry.findMany({ where: { source: "TAGIHAN_SUPPLIER", sourceId: fk.body.billId }, include: { lines: { include: { account: true } } } });
  assert.equal(jurnalFaktur.length, 1);
  const utang = jurnalFaktur[0].lines.filter((l) => l.account.code === "2-1100").reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);
  assert.equal(utang, 10 * H, "satu utang senilai faktur");
  const bayar = await w.a.post("/api/finance/supplier-payments", { supplierId: w.supplier.id, date: hariIni(), cashAccountId: w.bank.id, allocations: [{ billId: fk.body.billId, amount: 6 * H + 1000 }] }, kunci());
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  const ev2 = (await w.f.get(`/api/finance/purchase-orders/faktur/${fk.body.billId}`)).body;
  assert.deepEqual(ev2.jadwalJatuhTempo.map((j) => [j.status, j.dibayar, j.sisa]), [["LUNAS", 6 * H, 0], ["DIBAYAR_SEBAGIAN", 1000, 4 * H - 1000]]);

  const aging = (await w.f.get("/api/finance/utang/aging?termasukLunas=1")).body;
  const baris = aging.baris.filter((b) => b.billId === fk.body.billId);
  assert.equal(baris.length, 2, "satu baris per penerimaan");
  assert.equal(baris.reduce((s, b) => s + b.sisaUtang, 0), 4 * H - 1000, "sisa utang total tidak ganda");
  assert.equal(baris.reduce((s, b) => s + b.nilaiFaktur, 0), 10 * H);
  assert.deepEqual(baris.map((b) => b.tanggalJatuhTempo).sort(), [geser(-12 + 30), geser(-4 + 30)]);
  assert.deepEqual(baris.map((b) => [b.jadwal.nomorPenerimaan, b.kelompok === "LUNAS"]).sort().map((x) => x[1]), [true, false], "jadwal pertama lunas (FIFO), kedua masih terbuka");
  assert.equal(aging.ringkasan.kartu.jumlahFakturAktif, 1, "dihitung per faktur, bukan per jadwal");
  assert.equal(aging.ringkasan.kartu.totalUtangAktif, 4 * H - 1000);
  const detail = (await w.f.get(`/api/finance/utang/aging/${fk.body.billId}`)).body;
  assert.equal(detail.jadwalPerPenerimaan.length, 2);
  assert.equal(detail.nilaiFaktur, 10 * H);

  // koreksi tanggal tiba menggeser jatuh tempo; stok/jurnal faktur tidak berubah
  const stokSebelum = await testPrisma.stockMovement.count();
  assert.equal((await w.f.post(`/api/finance/purchase-orders/penerimaan/${r1.body.receiptId}/koreksi-kedatangan`, { revisi: 1, alasan: "Tanggal tiba di surat jalan lebih awal", perubahan: { tanggalTiba: geser(-15) } }, kunci())).status, 200);
  assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: fk.body.billId } })).dueDate.toISOString().slice(0, 10), geser(-15 + 30));
  assert.equal(await testPrisma.stockMovement.count(), stokSebelum);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "TAGIHAN_SUPPLIER", sourceId: fk.body.billId } }), 1);
  void sebelumFaktur;
});

test("termin COD: jatuh tempo pada tanggal tiba; penerimaan lama tanpa tanggal tiba = 'Tanggal belum ditetapkan' (tidak ditebak/backfill); penerimaan belum tiba = 'Menunggu tanggal penerimaan'", async () => {
  const w = await dunia({ termin: { paymentTermType: "TUNAI" } });
  const po = await poDisetujui(w, { qty: 6 });
  const L = po.lines[0].id;
  const t = geser(-3);
  const baru = await tiba(w.g, po.id, { tanggalTiba: t, lines: [{ purchaseOrderLineId: L, jumlahDatang: 2 }] });
  const jd = (await detailF(w, po.id)).penerimaan[0].jatuhTempo;
  assert.deepEqual([jd.status, jd.jatuhTempo, jd.mulai, jd.termin], ["TERJADWAL", t, t, "Tunai/COD"]);
  // penerimaan terjadwal yang belum tiba
  const jadwal = await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: L, orderedQty: 2 }] });
  // penerimaan LAMA: sudah masuk stok tanpa catatan kedatangan (dibuat langsung seperti dokumen sebelum fitur ini)
  const lama = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-LAMA-01", sourceType: "PURCHASE_ORDER", purchaseOrderId: po.id, status: "COMPLETED", receivedDate: new Date(`${geser(-9)}T00:00:00Z`), lines: { create: [{ materialId: w.lem.id, purchaseOrderLineId: L, orderedQty: 1, receivedQty: 1, acceptedQty: 1, rejectedQty: 0 }] } } });
  const f = await detailF(w, po.id);
  const per = Object.fromEntries(f.penerimaan.map((r) => [r.id, r.jatuhTempo]));
  assert.equal(per[jadwal.body.id].status, "MENUNGGU_TANGGAL_PENERIMAAN"); assert.equal(per[jadwal.body.id].label, "Menunggu tanggal penerimaan");
  assert.equal(per[lama.id].status, "TANGGAL_BELUM_DITETAPKAN"); assert.equal(per[lama.id].label, "Tanggal belum ditetapkan");
  assert.equal((await testPrisma.goodsReceipt.findUnique({ where: { id: lama.id } })).arrivedDate, null, "tidak di-backfill dari tanggal lain");
  assert.equal(baru.status, 201);
});

// ═══ 8. Stok/jurnal ═══
test("PO, kedatangan, koreksi, dan faktur tidak menulis stok; stok & jurnal persediaan lahir tepat sekali saat Simpan ke Stok", async () => {
  const w = await dunia();
  const awal = await cacah();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  assert.deepEqual(await cacah(), awal, "PO tanpa stok/jurnal");
  const r = await tiba(w.g, po.id, { tanggalTiba: geser(-2), lines: [{ purchaseOrderLineId: L, jumlahDatang: 3 }] });
  await w.g.post(`/api/inventory/barang-akan-datang/penerimaan/${r.body.receiptId}/koreksi`, { revisi: 1, alasan: "Ralat catatan", perubahan: { catatan: "Barang tiba, dus sedikit penyok" } }, kunci());
  assert.deepEqual(await cacah(), awal, "kedatangan + koreksi tanpa stok/jurnal");
  await isiPeriksa(w, r.body.receiptId, { baik: 3 });
  assert.deepEqual(await cacah(), awal, "pemeriksaan tanpa stok/jurnal");
  assert.equal((await simpanStok(w, r.body.receiptId)).status, 200);
  assert.equal((await simpanStok(w, r.body.receiptId)).status, 400, "Simpan ke Stok kedua ditolak");
  const sesudah = await cacah();
  assert.equal(sesudah.stok, 1); assert.equal(sesudah.jurnal, 1);
  const fk = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate: hariIni(), lines: [{ purchaseOrderLineId: L, qty: 3, unitPrice: H }] });
  assert.equal(fk.status, 201);
  assert.equal((await w.ap.post(`/api/finance/bills/${fk.body.billId}/approve`, {})).status, 200);
  assert.equal((await cacah()).stok, 1, "faktur tidak menambah stok");
});

// ═══ 9. Definisi progres PO (satu helper server) ═══
const BERKAS10 = ["dipesan", "datang", "belumDatang", "belumDiperiksa", "ditolak", "menungguPengganti", "baikBelumDisimpan", "masukStok", "belumDipenuhiSupplier", "belumMasukStok"];
const BERKAS = ["dipesan", "datangAsli", "pengganti", "datang", "belumDatang", "belumDiperiksa", "ditolak", "menungguPengganti", "baikBelumDisimpan", "masukStok", "belumDipenuhiSupplier", "belumMasukStok"];
const angka = (p) => Object.fromEntries(BERKAS10.map((k) => [k, p[k]]));

test("progres PO 10 KG: datang 5 lalu 3, baik & masuk stok baru 5 → Datang 8, Belum datang 2, Belum diperiksa 3, Masuk stok 5, Belum masuk stok 5 — angka SAMA di Finance, Gudang, daftar, dan detail", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  const r1 = await tiba(w.g, po.id, { tanggalTiba: geser(-6), lines: [{ purchaseOrderLineId: L, jumlahDatang: 5 }] });
  await isiPeriksa(w, r1.body.receiptId, { baik: 5 });
  assert.equal((await simpanStok(w, r1.body.receiptId)).status, 200);
  const r2 = await tibaFin(w.f, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 3 }] });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));

  const harapan = { dipesan: 10, datang: 8, belumDatang: 2, belumDiperiksa: 3, ditolak: 0, menungguPengganti: 0, baikBelumDisimpan: 0, masukStok: 5, belumDipenuhiSupplier: 2, belumMasukStok: 5 };
  const g = (await detailG(w, po.id)).lines[0]; const f = (await detailF(w, po.id)).lines[0];
  assert.deepEqual(angka(g), harapan, "Gudang (halaman Barang Akan Datang)");
  assert.deepEqual(angka(f), harapan, "Finance (kedatangan lengkap)");
  assert.equal(g.datang - g.belumDiperiksa - g.ditolak - g.baikBelumDisimpan - g.masukStok, 0, "invarian: datang = belum diperiksa + ditolak + baik belum disimpan + masuk stok");
  assert.equal(g.belumDatang, g.dipesan - g.datang, "belum datang = dipesan − datang fisik");
  // detail PO Finance, detail PO Gudang, dan daftar keduanya
  const det = (await w.f.get(`/api/finance/purchase-orders/${po.id}`)).body;
  assert.deepEqual(angka(det.lines[0].progres), harapan, "detail PO Finance");
  assert.deepEqual(angka((await w.g.get(`/api/inventory/purchase-orders/${po.id}`)).body.lines[0].progres), harapan, "detail PO Gudang");
  const daftarF = (await w.f.get("/api/finance/purchase-orders")).body.purchaseOrders.find((p) => p.id === po.id);
  const daftarG = (await w.g.get("/api/inventory/barang-akan-datang")).body.purchaseOrders.find((p) => p.id === po.id);
  assert.deepEqual(angka(daftarF.lines[0].progres), harapan, "daftar Finance");
  assert.deepEqual(angka(daftarG.lines[0]), harapan, "daftar Gudang");
  // ringkasan kartu dari server, identik; definisi dikirim server (tanpa label "Sisa")
  assert.equal(daftarF.progres.teks, daftarG.progres.teks);
  assert.equal(daftarF.progres.teks, "5 / 10 KG masuk stok · 8 sudah datang");
  assert.equal(daftarF.progres.persenMasukStok, 50);
  assert.deepEqual(det.progresDefinisi.map((d) => d.kunci), BERKAS);
  assert.ok(det.progresDefinisi.every((d) => d.definisi.length > 10) && !JSON.stringify(det.progresDefinisi).includes('"Sisa"'));
  assert.deepEqual(Object.fromEntries(BERKAS10.map((k) => [k, det.progres.total[k]])), harapan, "total PO satu satuan = jumlah baris");
  assert.equal(det.totalBelumMasukStok, 5 * H, "nilai belum masuk stok = belum masuk stok × harga");
  assert.equal(JSON.stringify(daftarG).includes("totalBelumMasukStok"), false, "Gudang tanpa nilai");
});

test("progres: barang ditolak TETAP sudah datang secara fisik; baik belum disimpan = baik − masuk stok; invarian datang = diperiksa + ditolak + baik belum disimpan + masuk stok", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  const r1 = await tiba(w.g, po.id, { tanggalTiba: geser(-5), lines: [{ purchaseOrderLineId: L, jumlahDatang: 5 }] });
  await isiPeriksa(w, r1.body.receiptId, { baik: 5 });
  await simpanStok(w, r1.body.receiptId);
  const r2 = await tiba(w.g, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 3 }] });
  await isiPeriksa(w, r2.body.receiptId, { baik: 2, tolak: 1 }); // siap disimpan, belum Simpan ke Stok
  const f1 = { dipesan: 10, datang: 8, belumDatang: 2, belumDiperiksa: 0, ditolak: 1, menungguPengganti: 1, baikBelumDisimpan: 2, masukStok: 5, belumDipenuhiSupplier: 3, belumMasukStok: 5 };
  const p = (await detailG(w, po.id)).lines[0];
  assert.deepEqual(angka(p), f1, "FIXTURE: datang 8, baik 7, ditolak 1, masuk stok 5");
  assert.deepEqual(angka((await detailF(w, po.id)).lines[0]), f1, "Finance sama");
  assert.equal(p.datang, p.belumDiperiksa + p.ditolak + p.baikBelumDisimpan + p.masukStok);
  assert.equal(p.belumDipenuhiSupplier, p.belumDatang + p.menungguPengganti);
  assert.equal((await simpanStok(w, r2.body.receiptId)).status, 200);
  assert.deepEqual(angka((await detailG(w, po.id)).lines[0]), { dipesan: 10, datang: 8, belumDatang: 2, belumDiperiksa: 0, ditolak: 1, menungguPengganti: 1, baikBelumDisimpan: 0, masukStok: 7, belumDipenuhiSupplier: 3, belumMasukStok: 3 });
});

// ═══ 10. Finance-first / Gudang-first / paralel / replay ═══
test("Finance-first: Finance menekan Catat Barang Tiba dari PO tanpa penerimaan; draf dibuat/dipakai idempoten; Gudang melihat penerimaan yang SAMA dan melanjutkan pemeriksaan sampai Simpan ke Stok", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  assert.equal(await testPrisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } }), 0, "belum ada penerimaan — Gudang tidak perlu membuatnya");
  const d1 = await w.f.post(`/api/finance/purchase-orders/${po.id}/draf-penerimaan`, {});
  const d2 = await w.f.post(`/api/finance/purchase-orders/${po.id}/draf-penerimaan`, {});
  const d3 = await w.g.post(`/api/inventory/barang-akan-datang/${po.id}/draf-penerimaan`, {});
  assert.equal(d1.status, 200, JSON.stringify(d1.body));
  assert.deepEqual([d1.body.dibuat, d2.body.dibuat, d3.body.dibuat], [true, false, false]);
  assert.ok(d1.body.receiptId === d2.body.receiptId && d2.body.receiptId === d3.body.receiptId, "draf yang sama untuk Finance & Gudang");
  assert.equal(await testPrisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } }), 1);
  assert.equal((await w.s.post(`/api/finance/purchase-orders/${po.id}/draf-penerimaan`, {})).status, 403, "Sales tidak boleh");

  // Finance mencatat tiba tanpa menyebut penerimaan → memakai draf itu
  const h = kunci();
  const t = await tibaFin(w.f, po.id, { tanggalTiba: geser(-1), suratJalan: "SJ-FIN-1", lines: [{ purchaseOrderLineId: L, jumlahDatang: 6 }] }, h);
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(t.body.receiptId, d1.body.receiptId, "dicatat pada draf yang sama");
  assert.equal(await testPrisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } }), 1, "tetap satu penerimaan");
  // replay (kunci sama) → hasil sama, tidak menambah penerimaan/kejadian
  const ulang = await tibaFin(w.f, po.id, { tanggalTiba: geser(-1), suratJalan: "SJ-FIN-1", lines: [{ purchaseOrderLineId: L, jumlahDatang: 6 }] }, h);
  assert.equal(ulang.status, 201); assert.equal(ulang.body.receiptId, t.body.receiptId);
  assert.equal(await testPrisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } }), 1);
  assert.equal(await testPrisma.goodsReceiptEvent.count({ where: { goodsReceiptId: t.body.receiptId } }), 1);
  // kunci BERBEDA setelah tercatat → tidak menimpa dan tidak melebihi PO
  const lain = await tibaFin(w.f, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 5 }] });
  assert.equal(lain.status, 409, "6 + 5 > 10: tidak menimpa dan tidak melebihi PO");
  assert.equal(await testPrisma.goodsReceipt.count({ where: { purchaseOrderId: po.id, arrivalRevision: { gt: 0 } } }), 1);

  // Gudang melihat penerimaan itu dan melanjutkan
  const g = await detailG(w, po.id);
  assert.equal(g.statusAkanDatang.kode, "PERLU_DIPERIKSA");
  const kartu = g.penerimaan.find((r) => r.id === t.body.receiptId);
  assert.deepEqual([kartu.dicatat.workspace, kartu.suratJalan], ["FINANCE", "SJ-FIN-1"]);
  await isiPeriksa(w, t.body.receiptId, { baik: 6 });
  assert.equal((await detailG(w, po.id)).statusAkanDatang.kode, "SIAP_DISIMPAN");
  assert.equal((await w.f.post(`/api/inventory/goods-receipts/${t.body.receiptId}/putaway`, {})).status, 403, "Finance tidak boleh Simpan ke Stok");
  assert.equal((await simpanStok(w, t.body.receiptId)).status, 200);
  assert.deepEqual(angka((await detailG(w, po.id)).lines[0]), { dipesan: 10, datang: 6, belumDatang: 4, belumDiperiksa: 0, ditolak: 0, menungguPengganti: 0, baikBelumDisimpan: 0, masukStok: 6, belumDipenuhiSupplier: 4, belumMasukStok: 4 });
});

test("Finance-first TANPA draf lebih dulu (satu panggilan) membuat draf lalu mencatat; Gudang-first (draf dari Penerimaan Baru) dipakai Finance; PO terpenuhi tidak bisa membuat draf", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 4 });
  const L = po.lines[0].id;
  const t = await tibaFin(w.f, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 1 }] });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(await testPrisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } }), 1);
  // Gudang-first: Gudang membuat penerimaan (Penerimaan Baru) → Finance mencatat tiba tanpa menyebut penerimaan → draf Gudang yang dipakai
  const gr = await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.id });
  assert.equal(gr.status, 201, JSON.stringify(gr.body));
  const t2 = await tibaFin(w.f, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 2 }] });
  assert.equal(t2.status, 201, JSON.stringify(t2.body));
  assert.equal(t2.body.receiptId, gr.body.id, "memakai draf buatan Gudang");
  assert.equal(await testPrisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } }), 2, "tidak ada penerimaan kembar");
  // 1 + 2 datang dari 4; tutup sisanya → tidak ada lagi yang boleh datang
  const t3 = await tibaFin(w.f, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 1 }] });
  assert.equal(t3.status, 201);
  const lagi = await w.f.post(`/api/finance/purchase-orders/${po.id}/draf-penerimaan`, {});
  assert.equal(lagi.status, 409); assert.equal(lagi.body.code, "PO_SUDAH_TERPENUHI");
});

test("PARALEL Finance–Gudang pada draf yang sama: tepat satu berhasil, satu 409 sudah dicatat; tidak menimpa dan tidak menggandakan; draf paralel = satu penerimaan", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  // dua petugas membuka dialog bersamaan → satu draf
  const ds = await Promise.all([w.f.post(`/api/finance/purchase-orders/${po.id}/draf-penerimaan`, {}), w.g.post(`/api/inventory/barang-akan-datang/${po.id}/draf-penerimaan`, {}), w.f.post(`/api/finance/purchase-orders/${po.id}/draf-penerimaan`, {})]);
  assert.deepEqual(ds.map((d) => d.status), [200, 200, 200]);
  assert.equal(new Set(ds.map((d) => d.body.receiptId)).size, 1);
  assert.equal(await testPrisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } }), 1);
  const rid = ds[0].body.receiptId;
  // keduanya menekan Catat serentak (jumlah berbeda) pada draf yang sama
  const [a, b] = await Promise.all([
    tibaFin(w.f, po.id, { receiptId: rid, tanggalTiba: geser(-1), penerima: "Sari", lines: [{ purchaseOrderLineId: L, jumlahDatang: 4 }] }),
    tiba(w.g, po.id, { receiptId: rid, tanggalTiba: geser(-1), penerima: "Budi", lines: [{ purchaseOrderLineId: L, jumlahDatang: 6 }] }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409], JSON.stringify([a.body, b.body]));
  const kalah = a.status === 409 ? a : b;
  assert.equal(kalah.body.code, "KEDATANGAN_SUDAH_DICATAT");
  assert.match(kalah.body.error, /sudah dicatat/);
  const gr = await testPrisma.goodsReceipt.findUnique({ where: { id: rid }, include: { lines: true, events: true } });
  const menang = a.status === 201 ? { ws: "FINANCE", qty: 4, nama: "Sari" } : { ws: "GUDANG", qty: 6, nama: "Budi" };
  assert.deepEqual([gr.arrivalWorkspace, Number(gr.lines[0].receivedQty), gr.arrivalReceiver, gr.arrivalRevision, gr.events.length], [menang.ws, menang.qty, menang.nama, 1, 1], "data pemenang utuh — tidak tertimpa");
  assert.equal(await testPrisma.goodsReceipt.count({ where: { purchaseOrderId: po.id } }), 1);
});

test("validasi kedatangan: tanggal, jumlah, PIC, catatan wajib; surat jalan/bukti boleh kosong dan tampil Belum dilampirkan; pendamping aktual tidak boleh negatif; koreksi wajib alasan; aktor dari sesi bukan dari isian", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { pendamping: { satuan: "LEMBAR", mode: "AKTUAL", estimasi: 2 } });
  const L = po.lines[0].id;
  const dasar = { tanggalTiba: geser(-1), penerima: "Budi", catatan: "ok", lines: [{ purchaseOrderLineId: L, jumlahDatang: 5 }] };
  const post = (b) => w.g.post(`/api/inventory/barang-akan-datang/${po.id}/kedatangan`, b, kunci());
  for (const [nama, ubah] of [["tanggal", { tanggalTiba: undefined }], ["PIC", { penerima: "  " }], ["catatan", { catatan: "" }], ["jumlah", { lines: [{ purchaseOrderLineId: L, jumlahDatang: 0 }] }], ["tanggal masa depan", { tanggalTiba: geser(3) }]]) {
    const r = await post({ ...dasar, ...ubah });
    assert.equal(r.status, 400, `${nama}: ${JSON.stringify(r.body)}`);
  }
  const neg = await post({ ...dasar, lines: [{ purchaseOrderLineId: L, jumlahDatang: 5, jumlahPendamping: -1 }] });
  assert.equal(neg.status, 400); assert.match(neg.body.error, /tidak boleh negatif/);
  // aktor/peran/workspace palsu di isian diabaikan: diambil dari sesi
  const ok = await post({ ...dasar, lines: [{ purchaseOrderLineId: L, jumlahDatang: 5, jumlahPendamping: 1 }], actorId: "x", workspace: "FINANCE", roles: "ADMIN", arrivalWorkspace: "FINANCE" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const gr = await testPrisma.goodsReceipt.findUnique({ where: { id: ok.body.receiptId } });
  assert.deepEqual([gr.arrivalWorkspace, gr.arrivalActorRoles, gr.arrivalRecordedById], ["GUDANG", "WAREHOUSE", w.gudang.user.id]);
  const kartu = ok.body.po.penerimaan.find((r) => r.id === ok.body.receiptId);
  assert.deepEqual(kartu.kekurangan, ["Surat jalan belum dilampirkan", "Bukti kedatangan belum dilampirkan"]);
  assert.equal(kartu.suratJalan, null); assert.deepEqual(kartu.bukti, []);
  // koreksi tanpa alasan ditolak; pendamping negatif saat koreksi ditolak
  const k0 = await w.g.post(`/api/inventory/barang-akan-datang/penerimaan/${ok.body.receiptId}/koreksi`, { revisi: 1, perubahan: { catatan: "baru" } }, kunci());
  assert.equal(k0.status, 400);
  const k1 = await w.g.post(`/api/inventory/barang-akan-datang/penerimaan/${ok.body.receiptId}/koreksi`, { revisi: 1, alasan: "Salah hitung lembar", perubahan: { lines: [{ purchaseOrderLineId: L, jumlahPendamping: -2 }] } }, kunci());
  assert.equal(k1.status, 400); assert.match(k1.body.error, /tidak boleh negatif/);
});

// ═══ 11. Audit aging/export: satu faktur, beberapa baris penerimaan ═══
test("AUDIT aging: satu faktur dua penerimaan — total faktur/utang sekali; jadwal = faktur; pembayaran FIFO tanpa ganda; kartu = tabel = detail = Excel; filter jatuh tempo per baris; batal pembayaran mengembalikan jadwal; batal faktur melepas jadwal", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  const t1 = geser(-12); const t2 = geser(-4);
  const r1 = await tiba(w.g, po.id, { tanggalTiba: t1, lines: [{ purchaseOrderLineId: L, jumlahDatang: 5 }] });
  await isiPeriksa(w, r1.body.receiptId, { baik: 5 }); await simpanStok(w, r1.body.receiptId);
  const r2 = await tiba(w.g, po.id, { tanggalTiba: t2, lines: [{ purchaseOrderLineId: L, jumlahDatang: 5 }] });
  await isiPeriksa(w, r2.body.receiptId, { baik: 5 }); await simpanStok(w, r2.body.receiptId);
  const fk = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate: geser(-1), lines: [{ purchaseOrderLineId: L, qty: 10, unitPrice: H }] });
  assert.equal(fk.status, 201, JSON.stringify(fk.body));
  assert.equal((await w.ap.post(`/api/finance/bills/${fk.body.billId}/approve`, {})).status, 200);
  const billId = fk.body.billId;
  const due1 = geser(-12 + 30); const due2 = geser(-4 + 30);

  const aging = async (q = "") => (await w.f.get(`/api/finance/utang/aging${q}`)).body;
  const ambilExcel = async (jalur, filter = {}) => {
    const res = await fetch(`${server.baseUrl}/api/finance/export/${jalur}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${w.fin.token}` }, body: JSON.stringify({ filter }) });
    assert.equal(res.status, 200, jalur);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer())); return wb;
  };
  const totalSheet = (wb, nama, kolom) => { let hasil = null; wb.getWorksheet(nama).eachRow((r) => { if (String(r.values[1] ?? "").startsWith("TOTAL")) hasil = Number(r.values[kolom]); }); return hasil; };
  const barisSheet = (wb, nama) => { let n = 0; wb.getWorksheet(nama).eachRow((r) => { if (String(r.values[2] ?? "") === po.poNumber) n += 1; }); return n; };

  // ── a. tidak dibayar: tiap angka satu kali
  let j = await aging();
  const rows = j.baris.filter((b) => b.billId === billId);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.tanggalJatuhTempo).sort(), [due1, due2]);
  assert.equal(rows.reduce((s, r) => s + r.nilaiFaktur, 0), 10 * H, "total jadwal = total faktur");
  assert.equal(rows.reduce((s, r) => s + r.sisaUtang, 0), 10 * H);
  assert.equal(j.ringkasan.kartu.totalUtangAktif, 10 * H);
  assert.equal(j.ringkasan.kartu.jumlahFakturAktif, 1, "dihitung per faktur");
  const det = (await w.f.get(`/api/finance/utang/aging/${billId}`)).body;
  assert.equal(det.jadwalPerPenerimaan.reduce((s, x) => s + x.nilai, 0), 10 * H);
  assert.equal(det.jadwalPerPenerimaan.reduce((s, x) => s + x.sisa, 0), 10 * H);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "TAGIHAN_SUPPLIER", sourceId: billId } }), 1, "satu jurnal utang untuk satu faktur");
  let xl = await ambilExcel("aging-utang");
  assert.equal(totalSheet(xl, "Utang Aktif", 15), 10 * H, "Excel Aging: total sisa = kartu layar");
  assert.equal(barisSheet(xl, "Utang Aktif"), 2, "Excel: dua baris jadwal");
  // laporan Supplier & Utang: satu faktur = satu baris, nilai sekali; umur utang per jadwal (jumlah = sisa faktur)
  const xs = await ambilExcel("supplier-utang");
  assert.equal(totalSheet(xs, "Tagihan", 11), 10 * H, "Supplier & Utang: sisa faktur dihitung sekali");
  const umur = (await w.f.get("/api/finance/reports/payables")).body;
  assert.equal(umur.baris.filter((b) => b.billId === billId).length, 2, "umur utang: satu baris per jadwal");
  assert.equal(umur.baris.filter((b) => b.billId === billId).reduce((s, b) => s + b.sisa, 0), 10 * H);
  assert.equal(umur.total, 10 * H);

  // ── b. bayar sebagian (FIFO): jadwal pertama lunas, kedua tersisa; tidak ada nominal ganda
  const bayar = await w.a.post("/api/finance/supplier-payments", { supplierId: w.supplier.id, date: hariIni(), cashAccountId: w.bank.id, allocations: [{ billId, amount: 6 * H }] }, kunci());
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  j = await aging("?termasukLunas=1");
  const r = j.baris.filter((b) => b.billId === billId).sort((a, b) => a.tanggalJatuhTempo.localeCompare(b.tanggalJatuhTempo));
  assert.deepEqual(r.map((x) => [x.dibayar, x.sisaUtang]), [[5 * H, 0], [H, 4 * H]]);
  assert.equal(r.reduce((s, x) => s + x.dibayar, 0), 6 * H, "pembayaran tidak digandakan antar baris");
  assert.equal((await aging()).ringkasan.kartu.totalUtangAktif, 4 * H);
  xl = await ambilExcel("aging-utang");
  assert.equal(totalSheet(xl, "Utang Aktif", 15), 4 * H, "Excel = kartu setelah pembayaran sebagian");
  assert.equal(totalSheet(await ambilExcel("supplier-utang"), "Tagihan", 11), 4 * H);
  assert.equal((await w.f.get("/api/finance/reports/payables")).body.total, 4 * H);

  // ── c. periode/filter jatuh tempo menilai tiap baris sendiri
  const hanyaKedua = await aging(`?termasukLunas=1&jatuhTempoDari=${due2}&jatuhTempoSampai=${due2}`);
  assert.deepEqual(hanyaKedua.baris.filter((b) => b.billId === billId).map((x) => x.tanggalJatuhTempo), [due2]);
  assert.equal(hanyaKedua.ringkasan.kartu.totalUtangAktif, 4 * H, "hanya baris di periode yang dihitung");
  const hanyaPertama = await aging(`?termasukLunas=1&jatuhTempoDari=${due1}&jatuhTempoSampai=${due1}`);
  assert.deepEqual(hanyaPertama.baris.filter((b) => b.billId === billId).map((x) => x.tanggalJatuhTempo), [due1]);
  const keduanya = await aging(`?termasukLunas=1&jatuhTempoDari=${due1}&jatuhTempoSampai=${due2}`);
  assert.equal(keduanya.baris.filter((b) => b.billId === billId).length, 2);
  assert.equal(keduanya.baris.filter((b) => b.billId === billId).reduce((s, x) => s + x.nilaiFaktur, 0), 10 * H, "dua baris di periode: faktur tetap sekali");
  const xlFilter = await ambilExcel("aging-utang", { jatuhTempoDari: due2, jatuhTempoSampai: due2 });
  assert.equal(totalSheet(xlFilter, "Utang Aktif", 15), 4 * H, "Excel dengan filter = layar dengan filter sama");
  const luar = await aging(`?jatuhTempoDari=${geser(60)}`);
  assert.equal(luar.baris.filter((b) => b.billId === billId).length, 0);

  // ── d. batal pembayaran → jadwal kembali
  const batalBayar = await w.a.post(`/api/finance/supplier-payments/${bayar.body.id ?? bayar.body.payment?.id}/cancel`, { reason: "Salah rekening, dibatalkan" }, kunci());
  assert.equal(batalBayar.status, 200, JSON.stringify(batalBayar.body));
  j = await aging();
  const sesudahBatal = j.baris.filter((b) => b.billId === billId);
  assert.deepEqual(sesudahBatal.map((x) => [x.dibayar, x.sisaUtang]).sort(), [[0, 5 * H], [0, 5 * H]]);
  assert.equal(j.ringkasan.kartu.totalUtangAktif, 10 * H);
  assert.equal(totalSheet(await ambilExcel("aging-utang"), "Utang Aktif", 15), 10 * H);

  // ── e. batal faktur → seluruh jadwal terlepas (tidak ada baris/utang), penagihan PO bisa dibuat ulang
  const batalFaktur = await w.a.post(`/api/finance/bills/${billId}/cancel`, { reason: "Faktur supplier diganti" }, kunci());
  assert.equal(batalFaktur.status, 200, JSON.stringify(batalFaktur.body));
  j = await aging("?termasukLunas=1");
  assert.equal(j.baris.filter((b) => b.billId === billId).length, 0, "tidak ada baris jadwal tersisa");
  assert.equal(j.ringkasan.kartu.totalUtangAktif, 0);
  assert.equal((await w.f.get("/api/finance/reports/payables")).body.total, 0);
  const ulang = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate: geser(-1), lines: [{ purchaseOrderLineId: L, qty: 10, unitPrice: H }] });
  assert.equal(ulang.status, 201, "alokasi faktur yang dibatalkan dilepas; PO bisa ditagih ulang");
});

// ═══ 12. Penolakan lalu pengiriman PENGGANTI ═══
const dataPengganti = async (w) => {
  // PO 10 KG: GR1 5 baik masuk stok; GR2 datang 3 → baik 2, ditolak 1, masuk stok (fixture: datang 8, baik 7, ditolak 1, masuk stok 5 sebelum GR2 disimpan)
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  const r1 = await tiba(w.g, po.id, { tanggalTiba: geser(-8), suratJalan: "SJ-1", lines: [{ purchaseOrderLineId: L, jumlahDatang: 5 }] });
  await isiPeriksa(w, r1.body.receiptId, { baik: 5 }); await simpanStok(w, r1.body.receiptId);
  const r2 = await tiba(w.g, po.id, { tanggalTiba: geser(-5), suratJalan: "SJ-2", lines: [{ purchaseOrderLineId: L, jumlahDatang: 3 }] });
  await isiPeriksa(w, r2.body.receiptId, { baik: 2, tolak: 1 });
  return { po, L, r1, r2 };
};
const punya = (g, k) => g.lines[0][k];

test("FIXTURE: PO 10 KG datang 8, baik 7, ditolak 1, masuk stok 5 → datang fisik 8, belum datang 2, menunggu pengganti 1, baik belum disimpan 2, belum dipenuhi supplier 3, belum masuk stok 5 (Finance = Gudang)", async () => {
  const w = await dunia();
  const { po } = await dataPengganti(w);
  const harapan = { dipesan: 10, datang: 8, belumDatang: 2, belumDiperiksa: 0, ditolak: 1, menungguPengganti: 1, baikBelumDisimpan: 2, masukStok: 5, belumDipenuhiSupplier: 3, belumMasukStok: 5 };
  const g = await detailG(w, po.id); const f = await detailF(w, po.id);
  assert.deepEqual(angka(g.lines[0]), harapan);
  assert.deepEqual(angka(f.lines[0]), harapan);
  assert.deepEqual(g.lines[0].asalPengganti.map((a) => [a.sisa]), [[1]], "baris penolakan asal yang menunggu pengganti terlihat");
  assert.deepEqual(angka((await w.f.get(`/api/finance/purchase-orders/${po.id}`)).body.lines[0].progres), harapan);
});

test("PENGGANTI 1 KG: datang fisik 9; menunggu pengganti 0; batas PO tidak naik (belum datang tetap 2, bukan 11); hubungan ke baris asal tersimpan; stok/GRNI/faktur/termin tidak ganda", async () => {
  const w = await dunia();
  const { po, L, r1, r2 } = await dataPengganti(w);
  await simpanStok(w, r2.body.receiptId); // GR2 masuk stok: baik 2
  assert.equal(await testPrisma.stockMovement.count(), 2);
  const awal = await cacah();
  const asalLine = await testPrisma.goodsReceiptLine.findFirst({ where: { goodsReceiptId: r2.body.receiptId } });

  // pengganti ditandai pengganti → tidak dipandang pasokan baru
  const rp = await tiba(w.g, po.id, { tanggalTiba: geser(-2), suratJalan: "SJ-3", lines: [{ purchaseOrderLineId: L, jumlahDatang: 1, pengganti: true }] });
  assert.equal(rp.status, 201, JSON.stringify(rp.body));
  const baris = await testPrisma.goodsReceiptLine.findFirst({ where: { goodsReceiptId: rp.body.receiptId } });
  assert.equal(baris.replacementForLineId, asalLine.id, "hubungan ke baris penolakan asal tersimpan");
  assert.deepEqual(await cacah(), awal, "mencatat pengganti tidak menulis stok/jurnal/tagihan");
  const kartu = rp.body.po.penerimaan.find((r) => r.id === rp.body.receiptId);
  assert.equal(kartu.lines[0].penggantiDari.nomor, (await testPrisma.goodsReceipt.findUnique({ where: { id: r2.body.receiptId } })).receiptNumber);
  assert.deepEqual(angka(rp.body.po.lines[0]), { dipesan: 10, datang: 9, belumDatang: 2, belumDiperiksa: 1, ditolak: 1, menungguPengganti: 0, baikBelumDisimpan: 0, masukStok: 7, belumDipenuhiSupplier: 2, belumMasukStok: 3 });
  assert.equal(rp.body.po.lines[0].pengganti, 1);
  const ev = await testPrisma.goodsReceiptEvent.findFirst({ where: { goodsReceiptId: rp.body.receiptId } });
  assert.equal(ev.after.lines[0].penggantiDari, kartu.lines[0].penggantiDari.nomor, "audit menyebut penerimaan asal");

  // batas PO tetap 10: pengganti kedua ditolak (tidak ada penolakan menunggu); pengiriman biasa > belum datang (2) ditolak — bukan 3 apalagi 11
  const lagi = await tiba(w.g, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 1, pengganti: true }] });
  assert.equal(lagi.status, 409); assert.equal(lagi.body.code, "TANPA_PENOLAKAN");
  const biasa3 = await tiba(w.g, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 3 }] });
  assert.equal(biasa3.status, 409); assert.equal(biasa3.body.code, "MELEBIHI_PO");
  assert.match(biasa3.body.error, /belum datang 2/);

  // pengganti diperiksa baik → masuk stok SEKALI, nilai sesuai harga PO
  await isiPeriksa(w, rp.body.receiptId, { baik: 1 });
  assert.equal((await simpanStok(w, rp.body.receiptId)).status, 200);
  const stok = await testPrisma.stockMovement.findMany({ orderBy: { createdAt: "asc" } });
  assert.deepEqual(stok.map((m) => Number(m.qty)), [5, 2, 1], "stok = barang baik saja; yang ditolak tidak masuk dan pengganti masuk sekali");
  const grni = await testPrisma.finJournalEntry.findMany({ where: { source: "PENERIMAAN_BAHAN" }, include: { lines: true } });
  assert.deepEqual(grni.map((e) => e.lines.reduce((s, l) => s + Number(l.debit), 0)).sort((a, b) => a - b), [H, 2 * H, 5 * H], "tiap penerimaan bernilai baik × harga PO; tidak ada nilai ganda");
  assert.equal((await testPrisma.finPurchaseOrder.findUnique({ where: { id: po.id } })).status, "DITERIMA_SEBAGIAN");

  // sisa 2 dikirim biasa → PO selesai; fisik 11 = 10 baik + 1 ditolak; tidak melewati batas
  const sisa = await tiba(w.g, po.id, { tanggalTiba: geser(-1), suratJalan: "SJ-4", lines: [{ purchaseOrderLineId: L, jumlahDatang: 2 }] });
  assert.equal(sisa.status, 201, JSON.stringify(sisa.body));
  await isiPeriksa(w, sisa.body.receiptId, { baik: 2 }); await simpanStok(w, sisa.body.receiptId);
  const akhir = (await detailF(w, po.id));
  assert.deepEqual(angka(akhir.lines[0]), { dipesan: 10, datang: 11, belumDatang: 0, belumDiperiksa: 0, ditolak: 1, menungguPengganti: 0, baikBelumDisimpan: 0, masukStok: 10, belumDipenuhiSupplier: 0, belumMasukStok: 0 });
  assert.equal(akhir.statusAkanDatang.kode, "SELESAI");
  assert.equal((await testPrisma.finPurchaseOrder.findUnique({ where: { id: po.id } })).status, "SELESAI");

  // faktur 10 KG: satu utang, jadwal termin per penerimaan baik (4 penerimaan), nilai sekali
  const fk = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate: geser(-1), lines: [{ purchaseOrderLineId: L, qty: 10, unitPrice: H }] });
  assert.equal(fk.status, 201, JSON.stringify(fk.body));
  assert.equal((await w.ap.post(`/api/finance/bills/${fk.body.billId}/approve`, {})).status, 200);
  const aging = (await w.f.get("/api/finance/utang/aging")).body;
  const jadwal = aging.baris.filter((b) => b.billId === fk.body.billId);
  assert.equal(jadwal.length, 4, "satu jadwal per penerimaan yang membawa barang baik");
  assert.equal(jadwal.reduce((s, b) => s + b.nilaiFaktur, 0), 10 * H, "nilai faktur sekali, bukan 11 KG");
  assert.equal(aging.ringkasan.kartu.totalUtangAktif, 10 * H);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "TAGIHAN_SUPPLIER", sourceId: fk.body.billId } }), 1);
  void r1;
});

test("pengganti: ditolak lagi membuka pengganti baru; replay kunci sama = satu pengganti; PARALEL dua pengganti pada penolakan 1 KG → satu berhasil", async () => {
  const w = await dunia();
  const { po, L, r2 } = await dataPengganti(w);
  await simpanStok(w, r2.body.receiptId);
  // replay: kunci sama dua kali → satu baris pengganti
  const h = kunci();
  const a1 = await tiba(w.g, po.id, { tanggalTiba: geser(-2), lines: [{ purchaseOrderLineId: L, jumlahDatang: 1, pengganti: true }] }, h);
  const a2 = await tiba(w.g, po.id, { tanggalTiba: geser(-2), lines: [{ purchaseOrderLineId: L, jumlahDatang: 1, pengganti: true }] }, h);
  assert.equal(a1.status, 201); assert.equal(a2.status, 201); assert.equal(a2.body.receiptId, a1.body.receiptId);
  assert.equal(await testPrisma.goodsReceiptLine.count({ where: { replacementForLineId: { not: null } } }), 1);
  // pengganti ini ditolak lagi → menunggu pengganti kembali 1
  await isiPeriksa(w, a1.body.receiptId, { baik: 0, tolak: 1 });
  let p = (await detailG(w, po.id)).lines[0];
  assert.deepEqual([p.datang, p.belumDatang, p.ditolak, p.menungguPengganti, p.belumDipenuhiSupplier], [9, 2, 2, 1, 3]);
  // paralel: dua draf terpisah (Finance & Gudang) mencatat pengganti 1 KG bersamaan pada penolakan yang tersisa 1 KG
  const d1 = await w.f.post(`/api/finance/purchase-orders/${po.id}/draf-penerimaan`, {});
  const d2 = await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.id });
  assert.notEqual(d1.body.receiptId, d2.body.id);
  const [b1, b2] = await Promise.all([
    tibaFin(w.f, po.id, { receiptId: d1.body.receiptId, tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 1, pengganti: true }] }),
    tiba(w.g, po.id, { receiptId: d2.body.id, tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 1, pengganti: true }] }),
  ]);
  assert.deepEqual([b1.status, b2.status].sort(), [201, 409], JSON.stringify([b1.body, b2.body]));
  assert.equal([b1, b2].find((x) => x.status === 409).body.code, "TANPA_PENOLAKAN");
  p = (await detailG(w, po.id)).lines[0];
  assert.deepEqual([p.datang, p.menungguPengganti, p.belumDatang], [10, 0, 2], "tepat satu pengganti tercatat; belum datang tetap 2");
});

test("pengganti: dibatasi sisa penolakan; ditolak asal tidak boleh turun di bawah pengganti; penerimaan asal yang sudah punya pengganti tidak bisa ditolak seluruhnya; koreksi jumlah pengganti dibatasi", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  const r1 = await tiba(w.g, po.id, { tanggalTiba: geser(-5), lines: [{ purchaseOrderLineId: L, jumlahDatang: 6 }] });
  await isiPeriksa(w, r1.body.receiptId, { baik: 4, tolak: 2 }); // siap disimpan
  const lebih = await tiba(w.g, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 3, pengganti: true }] });
  assert.equal(lebih.status, 409); assert.equal(lebih.body.code, "MELEBIHI_PENOLAKAN");
  const rp = await tiba(w.g, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 1, pengganti: true }] });
  assert.equal(rp.status, 201, JSON.stringify(rp.body));
  // asal: ditolak tidak boleh di bawah 1 (sudah diganti 1)
  const asalLine = await testPrisma.goodsReceiptLine.findFirst({ where: { goodsReceiptId: r1.body.receiptId } });
  const turun = await w.g.patch(`/api/inventory/goods-receipts/${r1.body.receiptId}/lines/${asalLine.id}`, { rejectedQty: 0, acceptedQty: 6 });
  assert.equal(turun.status, 400); assert.match(turun.body.error, /pengiriman pengganti/);
  const tolakSemua = await w.g.patch(`/api/inventory/goods-receipts/${r1.body.receiptId}/reject`, { reason: "Salah kirim" });
  assert.equal(tolakSemua.status, 400); assert.match(tolakSemua.body.error, /pengganti/);
  // koreksi jumlah pengganti: maksimal sisa penolakan (2) — 3 ditolak, 2 boleh
  const lagi = await w.g.post(`/api/inventory/barang-akan-datang/penerimaan/${rp.body.receiptId}/koreksi`, { revisi: 1, alasan: "Ternyata dua yang datang", perubahan: { lines: [{ purchaseOrderLineId: L, jumlahDatang: 3 }] } }, kunci());
  assert.equal(lagi.status, 409); assert.equal(lagi.body.code, "MELEBIHI_PENOLAKAN");
  const ok = await w.g.post(`/api/inventory/barang-akan-datang/penerimaan/${rp.body.receiptId}/koreksi`, { revisi: 1, alasan: "Ternyata dua yang datang", perubahan: { lines: [{ purchaseOrderLineId: L, jumlahDatang: 2 }] } }, kunci());
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const p = (await detailF(w, po.id)).lines[0];
  assert.deepEqual([p.datang, p.menungguPengganti, p.belumDatang], [8, 0, 4]);
});

// ═══ 13. Bridge kuantitas 10 KG: asli 5 + asli 3 (2 baik, 1 ditolak) + pengganti 1 + asli terakhir 2 ═══
test("BRIDGE 10 KG: asli 10, pengganti 1, total fisik 11, baik/masuk stok 10, ditolak 1 — nilai PO/GRNI/faktur/utang/pembayaran 10 KG saja; faktur 10 KG ditolak selama baik tertagih < 10; Σ jadwal = faktur", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  const fak = (qty) => w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate: geser(-1), lines: [{ purchaseOrderLineId: L, qty, unitPrice: H }] });
  // Faktur boleh DICATAT (Menunggu Persetujuan, tertahan + alasan) tetapi TIDAK PERNAH bisa disetujui/dibukukan melebihi barang baik yang dapat ditagih: tidak ada utang, jurnal, atau alokasi.
  const tolakFaktur = async (qty, baikSaatIni) => {
    const r = await fak(qty);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const ev = (await w.f.get(`/api/finance/purchase-orders/faktur/${r.body.billId}`)).body;
    assert.equal(ev.tertahan, true, `faktur ${qty} KG tertahan saat baik tertagih baru ${baikSaatIni} KG`);
    assert.match(ev.alasanTertahan.join(" "), /barang baik yang belum ditagih hanya/);
    const setuju = await w.ap.post(`/api/finance/bills/${r.body.billId}/approve`, {});
    assert.equal(setuju.status, 409, `faktur ${qty} KG HARUS ditolak saat disetujui; baik tertagih baru ${baikSaatIni} KG: ${JSON.stringify(setuju.body).slice(0, 200)}`);
    const b = await testPrisma.finSupplierBill.findUnique({ where: { id: r.body.billId } });
    assert.equal(b.status, "MENUNGGU_APPROVAL");
    assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "TAGIHAN_SUPPLIER", sourceId: b.id } }), 0, "tanpa jurnal utang");
    assert.equal(await testPrisma.finSupplierBillAllocation.count({ where: { billId: b.id } }), 0, "tanpa alokasi");
    assert.equal((await w.ap.post(`/api/finance/bills/${b.id}/reject`, { reason: "Uji: melebihi barang baik" })).status, 200);
  };
  const tolakFaktur10 = (baik) => tolakFaktur(10, baik);
  const simpan = async (rid, baik, tolak = 0) => { await isiPeriksa(w, rid, { baik, tolak }); assert.equal((await simpanStok(w, rid)).status, 200); };

  // 1) pengiriman asli 5 KG baik
  const a1 = await tiba(w.g, po.id, { tanggalTiba: geser(-12), lines: [{ purchaseOrderLineId: L, jumlahDatang: 5 }] });
  await simpan(a1.body.receiptId, 5); await tolakFaktur10(5);
  // 2) pengiriman asli 3 KG: 2 baik + 1 ditolak
  const a2 = await tiba(w.g, po.id, { tanggalTiba: geser(-8), lines: [{ purchaseOrderLineId: L, jumlahDatang: 3 }] });
  await simpan(a2.body.receiptId, 2, 1); await tolakFaktur10(7);
  let p = (await detailF(w, po.id)).lines[0];
  assert.deepEqual(angka(p), { dipesan: 10, datang: 8, belumDatang: 2, belumDiperiksa: 0, ditolak: 1, menungguPengganti: 1, baikBelumDisimpan: 0, masukStok: 7, belumDipenuhiSupplier: 3, belumMasukStok: 3 });
  // 3) pengganti 1 KG baik
  const g = await tiba(w.g, po.id, { tanggalTiba: geser(-4), lines: [{ purchaseOrderLineId: L, jumlahDatang: 1, pengganti: true }] });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  await simpan(g.body.receiptId, 1); await tolakFaktur10(8);
  p = (await detailF(w, po.id)).lines[0];
  assert.deepEqual([p.datangAsli, p.pengganti, p.datang, p.belumDatang, p.menungguPengganti, p.belumDipenuhiSupplier, p.masukStok], [8, 1, 9, 2, 0, 2, 8], "pengganti menutup penolakan, BELUM menutup jumlah dipesan");
  // 4) pengiriman asli terakhir 2 KG baik
  const a3 = await tiba(w.g, po.id, { tanggalTiba: geser(-2), lines: [{ purchaseOrderLineId: L, jumlahDatang: 2 }] });
  assert.equal(a3.status, 201, JSON.stringify(a3.body));
  await isiPeriksa(w, a3.body.receiptId, { baik: 2 });
  await tolakFaktur10(8); // sudah diperiksa tetapi belum Simpan ke Stok: belum bisa ditagih
  assert.equal((await simpanStok(w, a3.body.receiptId)).status, 200);

  // ── JEMBATAN KUANTITAS (angka dari satu helper server, Finance = Gudang)
  const akhir = { dipesan: 10, datangAsli: 10, pengganti: 1, datang: 11, belumDatang: 0, belumDiperiksa: 0, ditolak: 1, menungguPengganti: 0, baikBelumDisimpan: 0, masukStok: 10, belumDipenuhiSupplier: 0, belumMasukStok: 0 };
  const barisG = (await detailG(w, po.id)).lines[0]; const barisF = (await detailF(w, po.id)).lines[0];
  assert.deepEqual(Object.fromEntries(Object.keys(akhir).map((k) => [k, barisG[k]])), akhir, "Gudang");
  assert.deepEqual(Object.fromEntries(Object.keys(akhir).map((k) => [k, barisF[k]])), akhir, "Finance");
  assert.equal(akhir.datangAsli + akhir.pengganti, akhir.datang, "asli + pengganti = total fisik");
  assert.equal(akhir.datang - akhir.ditolak, akhir.masukStok, "total fisik − ditolak = baik/masuk stok");
  assert.equal(akhir.masukStok, akhir.dipesan, "baik/masuk stok maksimum = dipesan");
  assert.equal((await detailF(w, po.id)).statusAkanDatang.kode, "SELESAI");

  // ── nilai: hanya 10 KG (bukan 11)
  const poFin = (await w.f.get(`/api/finance/purchase-orders/${po.id}`)).body;
  assert.equal(poFin.totalDipesan, 10 * H, "nilai PO");
  assert.equal(poFin.totalDiterima, 10 * H, "nilai masuk stok");
  const stok = await testPrisma.stockMovement.findMany();
  assert.equal(stok.reduce((s, m) => s + Number(m.qty), 0), 10, "stok masuk total 10 KG");
  assert.equal(stok.reduce((s, m) => s + Number(m.qty) * Number(m.unitCost), 0), 10 * H, "nilai persediaan 10 KG × harga PO");
  const grni = await testPrisma.finJournalEntry.findMany({ where: { source: "PENERIMAAN_BAHAN" }, include: { lines: true } });
  assert.equal(grni.length, 4, "satu jurnal per penerimaan yang disimpan");
  assert.equal(grni.reduce((s, e) => s + e.lines.reduce((x, l) => x + Number(l.debit), 0), 0), 10 * H, "GRNI/persediaan Dr = 10 KG");
  assert.equal(grni.reduce((s, e) => s + e.lines.reduce((x, l) => x + Number(l.credit), 0), 0), 10 * H, "GRNI Cr = 10 KG");

  // ── faktur 10 KG sah: satu faktur, jadwal per penerimaan, Σ jadwal = faktur
  await tolakFaktur(11, 10); // 11 KG tidak pernah boleh (nilai PO hanya 10 KG)
  const ok = await fak(10);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await w.ap.post(`/api/finance/bills/${ok.body.billId}/approve`, {})).status, 200);
  const bill = await testPrisma.finSupplierBill.findUnique({ where: { id: ok.body.billId } });
  assert.equal(Number(bill.amount), 10 * H, "faktur = 10 KG");
  const aging = (await w.f.get("/api/finance/utang/aging")).body;
  const jadwal = aging.baris.filter((b) => b.billId === ok.body.billId);
  assert.equal(jadwal.length, 4, "satu jadwal per penerimaan yang membawa barang baik (pengganti ikut)");
  assert.equal(jadwal.reduce((s, b) => s + b.nilaiFaktur, 0), 10 * H, "Σ jadwal = total faktur (tepat)");
  assert.equal(jadwal.reduce((s, b) => s + b.sisaUtang, 0), 10 * H);
  assert.equal(aging.ringkasan.kartu.totalUtangAktif, 10 * H, "utang = 10 KG");
  const utang = await testPrisma.finJournalEntry.findMany({ where: { source: "TAGIHAN_SUPPLIER", sourceId: ok.body.billId }, include: { lines: { include: { account: true } } } });
  assert.equal(utang.length, 1);
  assert.equal(utang[0].lines.filter((l) => l.account.code === "2-1100").reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0), 10 * H, "jurnal utang usaha 10 KG");
  // faktur kedua apa pun tidak bisa menagih lagi
  await tolakFaktur(1, "habis ditagih"); // tidak ada barang baik tersisa untuk ditagih

  // ── pembayaran penuh = 10 KG
  const bayar = await w.a.post("/api/finance/supplier-payments", { supplierId: w.supplier.id, date: hariIni(), cashAccountId: w.bank.id, allocations: [{ billId: ok.body.billId, amount: 10 * H }] }, kunci());
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  assert.equal(Number(bayar.body.amount), 10 * H);
  assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: ok.body.billId } })).status, "LUNAS");
  const lebih = await w.a.post("/api/finance/supplier-payments", { supplierId: w.supplier.id, date: hariIni(), cashAccountId: w.bank.id, allocations: [{ billId: ok.body.billId, amount: H }] }, kunci());
  assert.ok([400, 409].includes(lebih.status), "tidak bisa membayar lebih dari faktur 10 KG");
});
