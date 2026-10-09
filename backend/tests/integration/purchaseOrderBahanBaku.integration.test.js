// PURCHASE ORDER BAHAN BAKU (Fase 1 integrasi Finance → Gudang).
// Yang dikunci: (1) simpan/setujui/ubah/revisi/batalkan PO TIDAK mengubah stok, jurnal, atau utang; (2) stok masuk & jurnal
// Dr Persediaan / Cr Utang Barang Belum Ditagih hanya lahir saat PUTAWAY penerimaan; (3) jumlah baik kumulatif tidak bisa melebihi PO
// (juga saat dua putaway paralel); (4) izin; (5) jalur penerimaan tanpa PO tetap seperti sebelumnya.
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
import { toMoney } from "../../src/services/finance/money.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HARGA = 43_290;
const kunci = () => ({ "Idempotency-Key": `po-${randomUUID()}` });
const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

async function dunia({ qty = 10 } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const gudang = await createTestUser({ roles: ["WAREHOUSE"] });
  const f = makeClient(server.baseUrl, fin.token);
  const a = makeClient(server.baseUrl, admin.token);
  const g = makeClient(server.baseUrl, gudang.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-ESA", name: "PT ESA BUMINDO" } });
  const lem = await createTestMaterial({ code: "LEM-1037", name: "LEM I-SR 1037 13 KG", unit: "KG" });
  return { f, a, g, fin, admin, gudang, supplier, lem, qty };
}

/** PO disetujui. */
async function poDisetujui(w, { qty = w.qty, harga = HARGA, lines = null } = {}) {
  const c = await w.f.post("/api/finance/purchase-orders", {
    supplierId: w.supplier.id, orderDate: hariIni(), expectedDate: hariIni(), notes: "Lem rutin",
    lines: lines ?? [{ materialId: w.lem.id, qty, unitPrice: harga }],
  });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}

const buatPenerimaan = (w, poId, body = {}) => w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: poId, ...body });
async function maju(w, grId, dari = "DRAFT") {
  const urut = ["SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"];
  for (const st of urut.slice(dari === "DRAFT" ? 0 : urut.indexOf(dari) + 1)) {
    const r = await w.g.patch(`/api/inventory/goods-receipts/${grId}`, { status: st });
    assert.equal(r.status, 200, `gagal maju ke ${st}: ${JSON.stringify(r.body)}`);
  }
}
const isi = (w, grId, lineId, body) => w.g.patch(`/api/inventory/goods-receipts/${grId}/lines/${lineId}`, body);

/** Penerimaan dari PO yang sudah siap putaway: datang lewat Catat Barang Tiba (jalur resmi), lalu baik/ditolak diisi saat pemeriksaan. */
async function penerimaanSiap(w, poId, { datang, baik, tolak = 0 }) {
  const gr = await buatPenerimaan(w, poId);
  assert.equal(gr.status, 201, JSON.stringify(gr.body));
  await bawaSampaiSiap(w.g, gr.body, { datang, baik, tolak });
  return gr.body;
}

async function stokMasuk(materialId) {
  const baris = await testPrisma.stockMovement.findMany({ where: { materialId } });
  return baris.reduce((s, m) => s + Number(m.qty), 0);
}
async function saldoAkun(code) {
  const a = await testPrisma.finAccount.findUnique({ where: { code } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: a.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return toMoney(agg._sum.debit || 0).minus(toMoney(agg._sum.credit || 0)).toNumber();
}
/** Jejak seluruh efek keuangan/stok: dipakai membuktikan "tidak berubah". */
async function jejak() {
  const agg = await testPrisma.finJournalLine.aggregate({ _sum: { debit: true, credit: true } });
  return {
    stok: await testPrisma.stockMovement.count(),
    jurnal: await testPrisma.finJournalEntry.count(),
    baris: await testPrisma.finJournalLine.count(),
    debit: String(agg._sum.debit ?? 0), kredit: String(agg._sum.credit ?? 0),
    tagihan: await testPrisma.finSupplierBill.count(),
    posting: await testPrisma.finPostingGap.count(),
  };
}
const detail = async (w, id) => (await w.f.get(`/api/finance/purchase-orders/${id}`)).body;

// ═══ 1. PO TIDAK MENGUBAH STOK / JURNAL / UTANG ═══════════════════════════════════════════════════════════════════
test("simpan, ubah, setujui, revisi, dan batalkan PO TIDAK mengubah stok, jurnal, atau utang", async () => {
  const w = await dunia();
  const sebelum = await jejak();

  const draf = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 10, unitPrice: HARGA }] });
  assert.equal(draf.status, 201, JSON.stringify(draf.body));
  assert.equal(draf.body.status, "DRAFT");
  assert.match(draf.body.poNumber, /^PO-\d{8}-001$/);
  const ubah = await w.f.patch(`/api/finance/purchase-orders/${draf.body.id}`, { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 12, unitPrice: HARGA }] });
  assert.equal(ubah.status, 200, JSON.stringify(ubah.body));
  assert.equal((await w.f.post(`/api/finance/purchase-orders/${draf.body.id}/approve`, {})).status, 200);
  const rev = await w.f.post(`/api/finance/purchase-orders/${draf.body.id}/revisi-jumlah`, { lineId: ubah.body.lines[0].id, qty: 15, reason: "Tambah stok akhir bulan" });
  assert.equal(rev.status, 200, JSON.stringify(rev.body));
  const lain = await poDisetujui(w, { qty: 3 });
  assert.equal((await w.a.post(`/api/finance/purchase-orders/${lain.id}/cancel`, { reason: "Salah supplier" })).status, 200);

  assert.deepEqual(await jejak(), sebelum, "stok/jurnal/tagihan/gap TIDAK boleh berubah oleh operasi PO apa pun");
  assert.equal(await saldoAkun("2-1150"), 0);
  assert.equal(await saldoAkun("1-1400"), 0);
});

test("riwayat PO mencatat siapa, kapan, dan sebelum/sesudah revisi jumlah", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const rev = await w.f.post(`/api/finance/purchase-orders/${po.id}/revisi-jumlah`, { lineId: po.lines[0].id, qty: 12, reason: "Permintaan produksi naik" });
  assert.equal(rev.status, 200);
  const d = await detail(w, po.id);
  assert.deepEqual(d.riwayat.map((e) => e.type), ["DIBUAT", "DISETUJUI", "REVISI_JUMLAH"]);
  const r = d.riwayat[2];
  assert.equal(r.actor.id, w.fin.user.id);
  assert.equal(r.note, "Permintaan produksi naik");
  assert.equal(r.metadata.sebelum, 10);
  assert.equal(r.metadata.sesudah, 12);
  assert.ok(r.createdAt);
});

// ═══ 2. ALUR PENERIMAAN: 10 → 9 datang → 8 baik / 1 ditolak → +8 ═════════════════════════════════════════════════
test("PO 10 → datang 9 → baik 8 / ditolak 1 → Putaway: stok +8, jurnal Dr Persediaan / Cr GRNI = 8 × harga, lalu parsial berikutnya menyelesaikan PO", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const gr = await penerimaanSiap(w, po.id, { datang: 9, baik: 8, tolak: 1 });

  // Dokumen terisi dari PO (supplier, referensi, jenis sumber, baris) — Gudang tidak mengetik ulang.
  assert.equal(gr.sourceType, "PURCHASE_ORDER");
  assert.equal(gr.sourceReference, po.poNumber);
  assert.equal(gr.supplier, "PT ESA BUMINDO");
  assert.equal(gr.purchaseOrderId, po.id);
  assert.equal(gr.lines[0].orderedQty, 10, "dijadwalkan = sisa PO");
  assert.equal(gr.lines[0].purchaseOrderLineId, po.lines[0].id);

  // Sebelum putaway: belum ada stok & jurnal; PO belum berubah.
  assert.equal(await stokMasuk(w.lem.id), 0);
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
  assert.equal((await detail(w, po.id)).status, "DISETUJUI");

  const put = await w.g.post(`/api/inventory/goods-receipts/${gr.id}/putaway`, { location: "RAK-B02" });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(await stokMasuk(w.lem.id), 8, "stok naik sebesar jumlah BAIK saja");
  const mv = await testPrisma.stockMovement.findMany({ where: { goodsReceiptId: gr.id } });
  assert.equal(mv.length, 1);
  assert.equal(mv[0].unitCost, HARGA, "stok dinilai dengan harga satuan PO");

  const jurnal = await testPrisma.finJournalEntry.findFirst({ where: { source: "PENERIMAAN_BAHAN", sourceId: gr.id }, include: { lines: { include: { account: true } } } });
  assert.ok(jurnal, "jurnal penerimaan lahir saat putaway");
  const dr = jurnal.lines.find((l) => Number(l.debit) > 0);
  const cr = jurnal.lines.find((l) => Number(l.credit) > 0);
  assert.equal(dr.account.code, "1-1400");
  assert.equal(cr.account.code, "2-1150");
  assert.equal(Number(dr.debit), 8 * HARGA);
  assert.equal(Number(cr.credit), 8 * HARGA);
  assert.equal(await saldoAkun("2-1100"), 0, "tidak ada utang usaha: tagihan belum datang");

  let d = await detail(w, po.id);
  assert.equal(d.status, "DITERIMA_SEBAGIAN");
  let b = d.lines[0];
  assert.deepEqual([b.dipesan, b.diterimaBaik, b.ditolak, b.belumDiterima, b.ditagih], [10, 8, 1, 2, 0]);
  assert.equal(b.hargaSatuan, HARGA);
  assert.equal(b.nilaiDiterima, 8 * HARGA);
  assert.equal(d.penerimaan.length, 1);
  assert.equal(d.penerimaan[0].lines[0].purchaseOrderLineId, po.lines[0].id, "tautan per baris PO ↔ penerimaan");

  // Penerimaan parsial berikutnya: jadwal default = sisa 2.
  const gr2 = await penerimaanSiap(w, po.id, { datang: 2, baik: 2 });
  assert.equal(gr2.lines[0].orderedQty, 2);
  assert.equal((await w.g.post(`/api/inventory/goods-receipts/${gr2.id}/putaway`, {})).status, 200);
  assert.equal(await stokMasuk(w.lem.id), 10);
  d = await detail(w, po.id);
  assert.equal(d.status, "SELESAI");
  b = d.lines[0];
  assert.deepEqual([b.diterimaBaik, b.belumDiterima], [10, 0]);
  assert.equal(await saldoAkun("2-1150"), -(10 * HARGA));
  assert.equal((await detail(w, po.id)).riwayat.filter((e) => e.type === "PENERIMAAN_DITEMPATKAN").length, 2);

  // PO selesai tidak bisa dibuatkan penerimaan baru.
  const lagi = await buatPenerimaan(w, po.id);
  assert.equal(lagi.status, 409);
});

test("PO dengan banyak baris: penerimaan berisi sebagian baris; status sebagian sampai semua baris terpenuhi", async () => {
  const w = await dunia();
  const busa = await createTestMaterial({ code: "BUSA-R50", name: "Busa R50", unit: "SHEET" });
  const po = await poDisetujui(w, { lines: [{ materialId: w.lem.id, qty: 4, unitPrice: HARGA }, { materialId: busa.id, qty: 6, unitPrice: 120_000 }] });
  const [bLem, bBusa] = po.lines;

  const gr = await buatPenerimaan(w, po.id, { lines: [{ purchaseOrderLineId: bLem.id }] });
  assert.equal(gr.status, 201, JSON.stringify(gr.body));
  assert.equal(gr.body.lines.length, 1);
  await bawaSampaiSiap(w.g, gr.body, { datang: 4, baik: 4 });
  assert.equal((await w.g.post(`/api/inventory/goods-receipts/${gr.body.id}/putaway`, {})).status, 200);
  assert.equal((await detail(w, po.id)).status, "DITERIMA_SEBAGIAN");

  const gr2 = await buatPenerimaan(w, po.id); // default: hanya baris yang masih punya sisa
  assert.equal(gr2.body.lines.length, 1);
  assert.equal(gr2.body.lines[0].purchaseOrderLineId, bBusa.id);
  assert.equal(gr2.body.lines[0].orderedQty, 6);
});

// ═══ 3. BATAS JUMLAH ════════════════════════════════════════════════════════════════════════════════════════════
test("jumlah baik yang melebihi sisa PO ditolak saat diisi (pesan jelas) dan di putaway meski isian diakali lewat DB — tanpa stok tertulis", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const gr = await buatPenerimaan(w, po.id);
  const lineId = gr.body.lines[0].id;

  // Jumlah DATANG yang melebihi sisa PO ditolak sejak dicatat (jalur resmi Catat Barang Tiba).
  const lebih = await catatTibaResmi(w.g, { poId: po.id, receiptId: gr.body.id, lines: [{ purchaseOrderLineId: gr.body.lines[0].purchaseOrderLineId, jumlahDatang: 11 }] });
  assert.equal(lebih.status, 409);
  assert.match(lebih.body.error, /melebihi sisa PO/);
  assert.match(lebih.body.error, /merevisi jumlah PO/);

  await bawaSampaiSiap(w.g, gr.body, { datang: 5 });
  const lewatBatas = await isi(w, gr.body.id, lineId, { acceptedQty: 4, rejectedQty: 3 });
  assert.equal(lewatBatas.status, 400, "baik + ditolak tidak boleh melebihi yang datang");

  // Akali lewat DB (mis. data lama / skrip): penegakan akhir di putaway tetap menahan.
  await testPrisma.goodsReceiptLine.update({ where: { id: lineId }, data: { receivedQty: 11, acceptedQty: 11 } });
  const put = await w.g.post(`/api/inventory/goods-receipts/${gr.body.id}/putaway`, {});
  assert.equal(put.status, 409, JSON.stringify(put.body));
  assert.match(put.body.error, /tidak ada stok yang tertulis/);
  assert.equal(await stokMasuk(w.lem.id), 0);
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
  assert.equal((await testPrisma.goodsReceipt.findUnique({ where: { id: gr.body.id } })).status, "READY_FOR_PUTAWAY");
});

test("penanganan selisih eksplisit: revisi jumlah naik memungkinkan penerimaan lebih; turun di bawah yang sudah masuk ditolak; turun ke jumlah masuk = SELESAI", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const gr = await penerimaanSiap(w, po.id, { datang: 8, baik: 8 });
  assert.equal((await w.g.post(`/api/inventory/goods-receipts/${gr.id}/putaway`, {})).status, 200);

  const rev = (qty, reason = "Penyesuaian") => w.f.post(`/api/finance/purchase-orders/${po.id}/revisi-jumlah`, { lineId: po.lines[0].id, qty, reason });
  assert.equal((await rev(7)).status, 409, "tidak boleh di bawah 8 yang sudah masuk stok");
  assert.equal((await rev(10)).status, 409, "jumlah sama dengan sekarang");
  assert.equal((await w.f.post(`/api/finance/purchase-orders/${po.id}/revisi-jumlah`, { lineId: po.lines[0].id, qty: 9 })).status, 400, "alasan wajib");

  const kurang = await rev(8, "Supplier tidak sanggup kirim sisanya");
  assert.equal(kurang.status, 200, JSON.stringify(kurang.body));
  assert.equal(kurang.body.status, "SELESAI", "dikurangi ke jumlah yang sudah masuk → PO selesai");
  assert.equal((await rev(9)).status, 409, "PO selesai tidak bisa direvisi");
});

// ═══ 4. KONKURENSI & REPLAY ═════════════════════════════════════════════════════════════════════════════════════
test("dua penerimaan bersamaan (6 + 6 untuk PO 10): putaway paralel → tepat satu berhasil, satu 409, stok 6, satu jurnal", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const g1 = await penerimaanSiap(w, po.id, { datang: 6, baik: 6 });
  // Penerimaan kedua DIAKALI lewat DB (jalur resmi sudah menolak datang 6 + 6 > PO 10): penegakan akhir di putaway tetap menahan salah satunya.
  const g2 = await penerimaanSiap(w, po.id, { datang: 4, baik: 4 });
  await testPrisma.goodsReceiptLine.update({ where: { id: g2.lines[0].id }, data: { receivedQty: 6, acceptedQty: 6 } });

  const [r1, r2] = await Promise.all([
    w.g.post(`/api/inventory/goods-receipts/${g1.id}/putaway`, {}),
    w.g.post(`/api/inventory/goods-receipts/${g2.id}/putaway`, {}),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409], JSON.stringify([r1.body, r2.body]));
  assert.equal(await stokMasuk(w.lem.id), 6);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENERIMAAN_BAHAN" } }), 1);
  assert.equal(await saldoAkun("2-1150"), -(6 * HARGA));
  const d = await detail(w, po.id);
  assert.equal(d.lines[0].diterimaBaik, 6);
  assert.equal(d.status, "DITERIMA_SEBAGIAN");
});

test("putaway PENERIMAAN YANG SAMA dua kali bersamaan: satu berhasil, stok hanya sekali", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const g = await penerimaanSiap(w, po.id, { datang: 10, baik: 10 });
  const [r1, r2] = await Promise.all([
    w.g.post(`/api/inventory/goods-receipts/${g.id}/putaway`, {}),
    w.g.post(`/api/inventory/goods-receipts/${g.id}/putaway`, {}),
  ]);
  assert.deepEqual([r1.status, r2.status].filter((s) => s === 200).length, 1);
  assert.equal(await stokMasuk(w.lem.id), 10);
  assert.equal((await detail(w, po.id)).status, "SELESAI");
});

test("replay: setujui dua kali → 409; putaway ulang → ditolak tanpa stok ganda; buat PO dengan Idempotency-Key sama → satu PO", async () => {
  const w = await dunia();
  const h = kunci();
  const body = { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 10, unitPrice: HARGA }] };
  const a = await w.f.post("/api/finance/purchase-orders", body, h);
  const b = await w.f.post("/api/finance/purchase-orders", body, h);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.headers.get("idempotent-replayed"), "true");
  assert.equal(b.body.id, a.body.id);
  assert.equal(await testPrisma.finPurchaseOrder.count(), 1);

  assert.equal((await w.f.post(`/api/finance/purchase-orders/${a.body.id}/approve`, {})).status, 200);
  const lagi = await w.f.post(`/api/finance/purchase-orders/${a.body.id}/approve`, {});
  assert.equal(lagi.status, 409);

  const g = await penerimaanSiap(w, a.body.id, { datang: 10, baik: 10 });
  assert.equal((await w.g.post(`/api/inventory/goods-receipts/${g.id}/putaway`, {})).status, 200);
  assert.equal((await w.g.post(`/api/inventory/goods-receipts/${g.id}/putaway`, {})).status, 400);
  assert.equal(await stokMasuk(w.lem.id), 10);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENERIMAAN_BAHAN" } }), 1);
});

test("dua persetujuan PO bersamaan: satu berhasil, satu 409 (tanpa riwayat ganda)", async () => {
  const w = await dunia();
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 1, unitPrice: HARGA }] });
  const [r1, r2] = await Promise.all([
    w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {}),
    w.a.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {}),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal(await testPrisma.finPurchaseOrderEvent.count({ where: { purchaseOrderId: c.body.id, type: "DISETUJUI" } }), 1);
});

// ═══ 5. PEMBATALAN ═════════════════════════════════════════════════════════════════════════════════════════════
test("pembatalan: draf oleh Finance; PO disetujui butuh Admin Finance; ditahan bila ada penerimaan berjalan; ditolak bila sudah ada barang masuk", async () => {
  const w = await dunia();
  const draf = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 1, unitPrice: HARGA }] });
  assert.equal((await w.f.post(`/api/finance/purchase-orders/${draf.body.id}/cancel`, {})).status, 400, "alasan wajib");
  const c1 = await w.f.post(`/api/finance/purchase-orders/${draf.body.id}/cancel`, { reason: "Salah input" });
  assert.equal(c1.status, 200);
  assert.equal(c1.body.status, "DIBATALKAN");
  assert.equal((await w.f.post(`/api/finance/purchase-orders/${draf.body.id}/approve`, {})).status, 409, "PO batal tidak bisa disetujui");

  const po = await poDisetujui(w, { qty: 10 });
  const tolakIzin = await w.f.post(`/api/finance/purchase-orders/${po.id}/cancel`, { reason: "x" });
  assert.equal(tolakIzin.status, 403, "FINANCE tidak punya izin batalkan PO yang sudah disetujui");

  const berjalan = await buatPenerimaan(w, po.id);
  const tahan = await w.a.post(`/api/finance/purchase-orders/${po.id}/cancel`, { reason: "Batal order" });
  assert.equal(tahan.status, 409);
  assert.match(tahan.body.error, new RegExp(berjalan.body.receiptNumber));
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${berjalan.body.id}/reject`, { reason: "Tidak jadi" })).status, 200);

  const ok = await w.a.post(`/api/finance/purchase-orders/${po.id}/cancel`, { reason: "Batal order" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, "DIBATALKAN");
  assert.equal((await buatPenerimaan(w, po.id)).status, 409, "PO batal tidak bisa dibuatkan penerimaan");
  assert.equal((await w.a.post(`/api/finance/purchase-orders/${po.id}/cancel`, { reason: "lagi" })).status, 409);

  // PO yang sudah punya barang masuk tidak bisa dibatalkan.
  const po2 = await poDisetujui(w, { qty: 5 });
  const g = await penerimaanSiap(w, po2.id, { datang: 2, baik: 2 });
  await w.g.post(`/api/inventory/goods-receipts/${g.id}/putaway`, {});
  const gagalBatal = await w.a.post(`/api/finance/purchase-orders/${po2.id}/cancel`, { reason: "Batal" });
  assert.equal(gagalBatal.status, 409);
  assert.match(gagalBatal.body.error, /tidak bisa dibatalkan/);
});

// ═══ 6. IZIN ═══════════════════════════════════════════════════════════════════════════════════════════════════
test("izin: Gudang & Sales tidak bisa menyentuh PO Finance; Akuntan membuat tapi tidak menyetujui; Penyetuju menyetujui tapi tidak membuat", async () => {
  const w = await dunia();
  const sales = makeClient(server.baseUrl, (await createTestUser({ roles: ["SALES"] })).token);
  const akuntan = makeClient(server.baseUrl, (await createTestUser({ roles: ["ACCOUNTANT"] })).token);
  const penyetuju = makeClient(server.baseUrl, (await createTestUser({ roles: ["APPROVER"] })).token);
  const body = { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 1, unitPrice: HARGA }] };

  for (const c of [w.g, sales]) {
    assert.equal((await c.get("/api/finance/purchase-orders")).status, 403);
    assert.equal((await c.post("/api/finance/purchase-orders", body)).status, 403);
  }
  const dibuat = await akuntan.post("/api/finance/purchase-orders", body);
  assert.equal(dibuat.status, 201);
  assert.equal((await akuntan.post(`/api/finance/purchase-orders/${dibuat.body.id}/approve`, {})).status, 403);
  assert.equal((await penyetuju.post("/api/finance/purchase-orders", body)).status, 403);
  assert.equal((await penyetuju.post(`/api/finance/purchase-orders/${dibuat.body.id}/approve`, {})).status, 200);
  assert.equal((await akuntan.post(`/api/finance/purchase-orders/${dibuat.body.id}/revisi-jumlah`, { lineId: dibuat.body.lines[0].id, qty: 2, reason: "x" })).status, 403);

  // Sales tidak bisa membaca PO lewat pintu Gudang; Gudang tidak bisa membuat/menyetujui PO.
  assert.equal((await sales.get("/api/inventory/purchase-orders")).status, 403);
});

test("Gudang membaca PO yang disetujui TANPA harga & nilai; draf tidak terlihat; penerimaan dari PO tidak membocorkan harga", async () => {
  const w = await dunia();
  const draf = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 1, unitPrice: HARGA }] });
  const po = await poDisetujui(w, { qty: 10 });

  const daftar = await w.g.get("/api/inventory/purchase-orders");
  assert.equal(daftar.status, 200);
  assert.deepEqual(daftar.body.purchaseOrders.map((p) => p.id), [po.id], "hanya PO disetujui yang tampil");
  assert.equal((await w.g.get(`/api/inventory/purchase-orders/${draf.body.id}`)).status, 404);

  const gd = await w.g.get(`/api/inventory/purchase-orders/${po.id}`);
  assert.equal(gd.status, 200);
  const json = JSON.stringify(gd.body);
  assert.doesNotMatch(json, /hargaSatuan|nilaiDipesan|nilaiDiterima|totalDipesan|unitPrice|\b43290\b/);
  assert.equal(gd.body.lines[0].dipesan, 10);
  assert.equal(gd.body.lines[0].belumDiterima, 10);

  const gr = await buatPenerimaan(w, po.id);
  const detailGr = await w.g.get(`/api/inventory/goods-receipts/${gr.body.id}`);
  assert.doesNotMatch(JSON.stringify(detailGr.body), /hargaSatuan|unitPrice|\b43290\b/);
  assert.equal(detailGr.body.poRingkas.poNumber, po.poNumber);
  assert.equal(detailGr.body.purchaseOrder.poNumber, po.poNumber);
});

// ═══ 7. JALUR TANPA PO & TAUTAN KE TAGIHAN ═════════════════════════════════════════════════════════════════════
test("penerimaan TANPA PO tetap berjalan seperti sebelumnya: tanpa tautan PO, stok tanpa harga (celah lama tetap terlihat sebagai gap)", async () => {
  const w = await dunia();
  const gr = await w.g.post("/api/inventory/goods-receipts", { sourceType: "SUPPLIER_DELIVERY", supplier: "Toko Lama", lines: [{ materialId: w.lem.id, orderedQty: 5 }] });
  assert.equal(gr.status, 201);
  assert.equal(gr.body.purchaseOrderId, null);
  assert.equal(gr.body.purchaseOrder, null);
  assert.equal(gr.body.lines[0].purchaseOrderLineId, null);
  await maju(w, gr.body.id);
  await isi(w, gr.body.id, gr.body.lines[0].id, { receivedQty: 5, acceptedQty: 5 });
  assert.equal((await w.g.post(`/api/inventory/goods-receipts/${gr.body.id}/putaway`, {})).status, 200);
  const mv = await testPrisma.stockMovement.findFirst({ where: { goodsReceiptId: gr.body.id } });
  assert.equal(mv.unitCost, null, "jalur lama tidak mengarang harga");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENERIMAAN_BAHAN" } }), 0);
  assert.equal(await testPrisma.finPostingGap.count({ where: { reason: "TANPA_HARGA_PEROLEHAN" } }), 1);

  // Sumber 'Purchase Order' manual (teks bebas) di jalur lama tetap diterima, tanpa tautan PO.
  const manual = await w.g.post("/api/inventory/goods-receipts", { sourceType: "PURCHASE_ORDER", sourceReference: "PO-LAMA-77", lines: [{ materialId: w.lem.id }] });
  assert.equal(manual.status, 201);
  assert.equal(manual.body.purchaseOrderId, null);
});

test("penerimaan dari PO: supplier & referensi dikunci; baris yang bukan milik PO ditolak; PO draf tidak bisa dibuatkan penerimaan", async () => {
  const w = await dunia();
  const draf = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 1, unitPrice: HARGA }] });
  assert.equal((await buatPenerimaan(w, draf.body.id)).status, 409);

  const po = await poDisetujui(w, { qty: 10 });
  const lain = await poDisetujui(w, { qty: 3 });
  assert.equal((await buatPenerimaan(w, po.id, { lines: [{ purchaseOrderLineId: lain.lines[0].id }] })).status, 400);
  assert.equal((await buatPenerimaan(w, po.id, { lines: [{ purchaseOrderLineId: po.lines[0].id, orderedQty: 11 }] })).status, 409, "jadwal tidak boleh melebihi sisa");

  const gr = await buatPenerimaan(w, po.id, { supplier: "Supplier Palsu", sourceType: "MANUAL" });
  assert.equal(gr.body.supplier, "PT ESA BUMINDO", "isian bebas diabaikan: isi dari PO");
  assert.equal(gr.body.sourceType, "PURCHASE_ORDER");
  const ubah = await w.g.patch(`/api/inventory/goods-receipts/${gr.body.id}`, { supplier: "Lain" });
  assert.equal(ubah.status, 400);
  const sama = await w.g.patch(`/api/inventory/goods-receipts/${gr.body.id}`, { supplier: "PT ESA BUMINDO", deliveryNote: "SJ-0457" });
  assert.equal(sama.status, 200, "isian yang sama + surat jalan boleh");
  assert.equal(sama.body.deliveryNote, "SJ-0457");
});

test("tagihan supplier atas penerimaan dari PO: nilai penerimaan terisi dari harga PO, tagihan disetujui seperti biasa, PO menampilkan 'sudah ditagih'; alur tagihan tidak berubah", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const g = await penerimaanSiap(w, po.id, { datang: 9, baik: 8, tolak: 1 });
  await w.g.post(`/api/inventory/goods-receipts/${g.id}/putaway`, {});
  const nilai = 8 * HARGA;

  const bill = await w.a.post("/api/finance/bills", { supplierId: w.supplier.id, supplierRef: "2327/CR/EB/10/2026", billDate: hariIni(), amount: nilai, description: "Lem", billType: "BAHAN_BAKU", goodsReceiptId: g.id });
  assert.equal(bill.status, 201, JSON.stringify(bill.body));
  let d = await detail(w, po.id);
  assert.equal(d.lines[0].ditagih, 0, "tagihan belum disetujui → belum dihitung ditagih");

  const setuju = await w.a.post(`/api/finance/bills/${bill.body.id}/approve`, {});
  assert.equal(setuju.status, 200, JSON.stringify(setuju.body));
  assert.equal(await saldoAkun("2-1150"), 0, "GRNI tertutup oleh tagihan");
  assert.equal(await saldoAkun("2-1100"), -nilai);
  assert.equal(await saldoAkun("1-1400"), nilai, "persediaan tidak bertambah dua kali");

  d = await detail(w, po.id);
  assert.equal(d.lines[0].ditagih, 8);
  assert.equal(d.lines[0].nilaiDitagih, nilai);
  assert.equal(d.penerimaan[0].finSupplierBills[0].billNumber, bill.body.billNumber);
  assert.equal(d.penerimaan[0].finSupplierBills[0].status, "DISETUJUI");
  assert.equal(d.totalDitagih, nilai);
});

// ═══ 8. VALIDASI MASUKAN ════════════════════════════════════════════════════════════════════════════════════════
test("validasi PO: harga bulat > 0, jumlah > 0 maks 3 desimal, tanpa item ganda, estimasi tidak mendahului tanggal PO, supplier & item aktif", async () => {
  const w = await dunia();
  const dasar = { supplierId: w.supplier.id, orderDate: "2026-10-08", lines: [{ materialId: w.lem.id, qty: 1, unitPrice: HARGA }] };
  const coba = (patch) => w.f.post("/api/finance/purchase-orders", { ...dasar, ...patch });
  const baris = (patch) => [{ ...dasar.lines[0], ...patch }];

  assert.equal((await coba({ lines: baris({ unitPrice: 100.5 }) })).status, 400, "pecahan rupiah per satuan");
  assert.equal((await coba({ lines: baris({ unitPrice: 0 }) })).status, 400);
  assert.equal((await coba({ lines: baris({ qty: 0 }) })).status, 400);
  assert.equal((await coba({ lines: baris({ qty: -1 }) })).status, 400);
  assert.equal((await coba({ lines: baris({ qty: 1.2345 }) })).status, 400);
  assert.equal((await coba({ lines: [] })).status, 400);
  assert.equal((await coba({ lines: [dasar.lines[0], dasar.lines[0]] })).status, 400, "item ganda");
  assert.equal((await coba({ expectedDate: "2026-10-01" })).status, 400);
  assert.equal((await coba({ supplierId: null })).status, 400);
  assert.equal((await coba({ orderDate: "" })).status, 400);
  assert.equal((await coba({ lines: baris({ materialId: randomUUID() }) })).status, 404);

  await testPrisma.finSupplier.update({ where: { id: w.supplier.id }, data: { active: false } });
  assert.equal((await coba({})).status, 409, "supplier nonaktif");
  await testPrisma.finSupplier.update({ where: { id: w.supplier.id }, data: { active: true } });
  await testPrisma.material.update({ where: { id: w.lem.id }, data: { active: false } });
  assert.equal((await coba({})).status, 409, "item nonaktif");
  await testPrisma.material.update({ where: { id: w.lem.id }, data: { active: true } });
  assert.equal((await coba({ lines: baris({ qty: 2.125 }) })).status, 201, "3 desimal diizinkan");

  // Draf bisa diubah; yang sudah disetujui tidak.
  const po = await poDisetujui(w, { qty: 1 });
  const ubah = await w.f.patch(`/api/finance/purchase-orders/${po.id}`, dasar);
  assert.equal(ubah.status, 409);
});

test("nomor PO unik berurutan per bulan (PO-DDMMYYYY-NNN)", async () => {
  const w = await dunia();
  const nomor = [];
  for (let i = 0; i < 3; i++) {
    const r = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: "2026-10-08", lines: [{ materialId: w.lem.id, qty: 1, unitPrice: HARGA }] });
    nomor.push(r.body.poNumber);
  }
  assert.deepEqual(nomor, ["PO-08102026-001", "PO-08102026-002", "PO-08102026-003"]);
});
