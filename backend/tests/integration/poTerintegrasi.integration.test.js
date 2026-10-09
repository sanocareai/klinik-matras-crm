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
  assert.deepEqual([g.lines[0].dipesan, g.lines[0].datang, g.lines[0].sisa], [10, 0, 10]);
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
  assert.deepEqual([g.lines[0].dipesan, g.lines[0].datang, g.lines[0].baik, g.lines[0].ditolak, g.lines[0].masukStok, g.lines[0].sisa], [10, 5, 0, 0, 0, 10]);
  assert.equal(g.lines[0].pendamping.aktual, 1);
  assert.equal(g.statusAkanDatang.kode, "PERLU_DIPERIKSA");
  assert.ok(g.bendera.map((b) => b.kode).includes("DITERIMA_SEBAGIAN"));
  assert.deepEqual(g.penerimaan[0].kekurangan, ["Bukti kedatangan belum diunggah"], "surat jalan terisi; bukti belum → kekurangan terlihat");

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
  assert.deepEqual([f.lines[0].dipesan, f.lines[0].datang, f.lines[0].baik, f.lines[0].ditolak, f.lines[0].masukStok, f.lines[0].sisa], [10, 10, 10, 0, 10, 0]);
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
test("total penerimaan melebihi PO ditolak (409, Finance revisi PO); barang ditolak melepas sisa; kedatangan paralel dan replay tidak menimpa", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  const a = await tiba(w.g, po.id, { tanggalTiba: geser(-3), lines: [{ purchaseOrderLineId: L, jumlahDatang: 6 }] });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const lebih = await tiba(w.g, po.id, { tanggalTiba: geser(-2), lines: [{ purchaseOrderLineId: L, jumlahDatang: 5 }] });
  assert.equal(lebih.status, 409); assert.equal(lebih.body.code, "MELEBIHI_PO");
  assert.match(lebih.body.error, /melebihi sisa PO/); assert.match(lebih.body.error, /merevisi jumlah PO/);
  assert.equal(await testPrisma.goodsReceipt.count(), 1, "penolakan tidak membuat penerimaan");
  // 6 datang, 2 ditolak saat pemeriksaan → sisa yang boleh datang = 10 − 0 − (6−2) = 6
  await isiPeriksa(w, a.body.receiptId, { baik: 4, tolak: 2 });
  assert.equal((await tiba(w.g, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 7 }] })).status, 409);
  const pengganti = await tiba(w.g, po.id, { tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: L, jumlahDatang: 6 }] });
  assert.equal(pengganti.status, 201, JSON.stringify(pengganti.body));
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
  assert.deepEqual(f.lines.map((l) => [l.dipesan, l.datang, l.baik, l.ditolak, l.masukStok, l.sisa]), g.lines.map((l) => [l.dipesan, l.datang, l.baik, l.ditolak, l.masukStok, l.sisa]));
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
  assert.equal(await testPrisma.goodsReceipt.count(), 0);
  const ok = await tiba(w.g, po.id, bagus);
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body.po.penerimaan[0].kekurangan.sort(), ["Bukti kedatangan belum diunggah", "Surat jalan belum diisi"].sort());
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
