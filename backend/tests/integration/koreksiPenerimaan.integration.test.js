// KOREKSI PENERIMAAN — terhadap PostgreSQL sungguhan. SATU pintu (koreksiKedatangan) diperluas; yang dikunci:
// (1) split 5+5 & pratinjau dampak IDENTIK dengan penerapan (tanpa menulis apa pun); (2) salah catat 6→5 sebelum Simpan ke Stok (dalam transaksi) dan SESUDAH (pembalik + pengganti + jurnal koreksi);
// (3) lembar aktual; (4) kaitan pengganti; (5) tanggal & termin: faktur belum disetujui dihitung ulang, faktur disetujui TERKUNCI; (6) diblokir dengan sebab & arah: faktur disetujui, stok sudah bergerak
// (Produksi), periode tertutup, melebihi PO, retur aktif (kontrak Retur); (7) replay & paralel; (8) izin, Idempotency-Key, Gudang tanpa nilai.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const H = 43_290;
const kunci = () => ({ "Idempotency-Key": `kp-${randomUUID()}` });
const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);
let nomorFaktur = 0;
const ref = () => `FAK-KP-${String(++nomorFaktur).padStart(4, "0")}`;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const [fin, admin, gudang, approver, sales, prod] = await Promise.all(["FINANCE", "ADMIN", "WAREHOUSE", "APPROVER", "SALES", "PRODUCTION_LEAD"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-ESA", name: "PT ESA BUMINDO", paymentTermType: "HARI", paymentTermDays: 30 } });
  const busa = await createTestMaterial({ code: "BUSA-R50", name: "Busa Rebonded R50", unit: "KG" });
  return { f: c(fin), a: c(admin), g: c(gudang), ap: c(approver), s: c(sales), p: c(prod), adminId: admin.user.id, bank, supplier, busa };
}
async function poDisetujui(w, { qty = 10, harga = H, pendamping } = {}) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: geser(-20), lines: [{ materialId: w.busa.id, qty, unitPrice: harga, ...(pendamping && { pendamping }) }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}
const tiba = (w, po, jumlah, { tanggal = geser(-5), lembar, pengganti, dari } = {}) => w.g.post(`/api/inventory/barang-akan-datang/${po.id}/kedatangan`, {
  penerima: "Budi Gudang", catatan: "Barang tiba utuh", tanggalTiba: tanggal, suratJalan: `SJ-${jumlah}`,
  lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: jumlah, ...(lembar !== undefined && { jumlahPendamping: lembar }), ...(pengganti && { pengganti: true, ...(dari && { penggantiDariBarisId: dari }) }) }],
}, kunci());
async function periksa(w, receiptId, { baik, tolak = 0 }) {
  const gr = (await w.g.get(`/api/inventory/goods-receipts/${receiptId}`)).body;
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${receiptId}`, { status: "INSPECTION" })).status, 200);
  const r = await w.g.patch(`/api/inventory/goods-receipts/${receiptId}/lines/${gr.lines[0].id}`, { acceptedQty: baik, rejectedQty: tolak });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${receiptId}`, { status: "READY_FOR_PUTAWAY" })).status, 200);
  return gr.lines[0].id;
}
const simpan = async (w, receiptId) => { const r = await w.g.post(`/api/inventory/goods-receipts/${receiptId}/putaway`, {}); assert.equal(r.status, 200, JSON.stringify(r.body)); };
async function terimaSimpan(w, po, jumlah, baik = jumlah, opsi = {}) {
  const t = await tiba(w, po, jumlah, opsi);
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const lineId = await periksa(w, t.body.receiptId, { baik, tolak: jumlah - baik });
  await simpan(w, t.body.receiptId);
  return { receiptId: t.body.receiptId, lineId };
}
const fakturDraf = async (w, po, qty, { setuju = false } = {}) => {
  const r = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate: geser(-1), lines: [{ purchaseOrderLineId: po.lines[0].id, qty, unitPrice: H }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (setuju) { const a = await w.ap.post(`/api/finance/bills/${r.body.billId}/approve`, {}); assert.equal(a.status, 200, JSON.stringify(a.body)); }
  return r.body.billId;
};
const revisi = async (id) => (await testPrisma.goodsReceipt.findUnique({ where: { id }, select: { arrivalRevision: true } })).arrivalRevision;
const kor = (klien, jalur, id, perubahan, { rev, alasan = "Salah catat saat input", pratinjau = false, headers } = {}) => klien.post(
  jalur === "G" ? `/api/inventory/barang-akan-datang/penerimaan/${id}/koreksi` : `/api/finance/purchase-orders/penerimaan/${id}/koreksi-kedatangan`,
  { revisi: rev, alasan, perubahan, ...(pratinjau && { pratinjau: true }) }, pratinjau ? undefined : (headers ?? kunci()));
async function saldo(systemKey) {
  const a = await testPrisma.finAccount.findUnique({ where: { systemKey } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: a.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Math.round((Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0)) * 100) / 100;
}
const stokTotal = async () => Number((await testPrisma.stockMovement.aggregate({ _sum: { qty: true } }))._sum.qty ?? 0);
const cacah = async () => ({ stok: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), event: await testPrisma.goodsReceiptEvent.count() });

// ═══ 1. Split 5+5 + pratinjau identik dengan penerapan ═══
test("SPLIT 5+5: koreksi pengiriman kedua 5→4 (sebelum diperiksa): pratinjau Finance & Gudang = hasil penerapan; pratinjau tidak menulis apa pun; riwayat sebelum–sesudah", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  const a = await tiba(w, po, 5, { tanggal: geser(-8) });
  const b = await tiba(w, po, 5, { tanggal: geser(-3) });
  const id = b.body.receiptId;
  const awal = await cacah();

  const pvG = await kor(w.g, "G", id, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 4 }] }, { rev: 1, pratinjau: true });
  const pvF = await kor(w.f, "F", id, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 4 }] }, { rev: 1, pratinjau: true });
  assert.equal(pvG.status, 200, JSON.stringify(pvG.body)); assert.equal(pvF.status, 200);
  assert.deepEqual(await cacah(), awal, "pratinjau tidak menulis stok/jurnal/riwayat");
  assert.equal(await revisi(id), 1, "revisi tidak naik oleh pratinjau");
  assert.equal(pvG.body.boleh, true); assert.equal(pvG.body.jalur, "LANGSUNG");
  const d = pvG.body.dampak.progres[0];
  assert.deepEqual([d.sebelum.datang, d.sesudah.datang, d.sebelum.belumDatang, d.sesudah.belumDatang], [10, 9, 0, 1]);
  assert.deepEqual(pvF.body.dampak.progres, pvG.body.dampak.progres, "Finance dan Gudang melihat dampak yang sama");
  assert.equal("jurnal" in pvG.body.dampak, false, "Gudang tanpa nilai");

  const ok = await kor(w.g, "G", id, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 4 }] }, { rev: 1 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.revisi, 2);
  assert.deepEqual(ok.body.dampak.progres, pvG.body.dampak.progres, "penerapan = pratinjau");
  const kuant = (await w.g.get(`/api/inventory/barang-akan-datang/${po.id}`)).body.lines[0];
  assert.deepEqual([kuant.datang, kuant.belumDatang], [9, 1]);
  const ev = await testPrisma.goodsReceiptEvent.findMany({ where: { goodsReceiptId: id, type: "KEDATANGAN_DIKOREKSI" } });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].reason, "Salah catat saat input");
  assert.equal(ev[0].before.lines[0].datang, 5); assert.equal(ev[0].after.lines[0].datang, 4);
  assert.equal(ev[0].after.jalur, "LANGSUNG");
  void a;
});

// ═══ 2. Salah catat 6→5 SEBELUM Simpan ke Stok ═══
test("SALAH CATAT 6→5 sebelum Simpan ke Stok: koreksi datang+baik di tahap Siap Disimpan (satu transaksi) → Simpan ke Stok menulis 5; baik/ditolak sebelum diperiksa ditolak", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const L = po.lines[0].id;
  const t = await tiba(w, po, 6);
  const id = t.body.receiptId;
  // belum diperiksa: baik/ditolak belum bisa dikoreksi
  const dini = await kor(w.g, "G", id, { lines: [{ purchaseOrderLineId: L, jumlahBaik: 5 }] }, { rev: 1 });
  assert.equal(dini.status, 409); assert.equal(dini.body.code, "BELUM_DIPERIKSA");
  await periksa(w, id, { baik: 6 });
  // baik + ditolak ≤ datang
  const lebih = await kor(w.f, "F", id, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 5 }] }, { rev: 1 });
  assert.equal(lebih.status, 400); assert.equal(lebih.body.code, "BAIK_DITOLAK_MELEBIHI_DATANG");
  const ok = await kor(w.f, "F", id, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 5, jumlahBaik: 5 }] }, { rev: 1, alasan: "Dus keenam ternyata milik pengiriman lain" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.jalur, "LANGSUNG");
  assert.equal(await stokTotal(), 0, "belum ada stok sebelum Simpan ke Stok");
  await simpan(w, id);
  assert.equal(await stokTotal(), 5);
  assert.equal(await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), 5 * H);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH), -5 * H);
  const gr = await testPrisma.goodsReceiptLine.findFirst({ where: { goodsReceiptId: id } });
  assert.deepEqual([gr.receivedQty, gr.acceptedQty, gr.rejectedQty], [5, 5, 0]);
});

// ═══ 3. Salah catat 6→5 SESUDAH Simpan ke Stok ═══
test("SALAH CATAT 6→5 sesudah Simpan ke Stok: pembalik + pengganti + jurnal koreksi; catatan lama dipertahankan; stok/GRNI/persediaan konsisten; PO Selesai → Diterima Sebagian", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 6 });
  const L = po.lines[0].id;
  const r = await terimaSimpan(w, po, 6);
  assert.equal((await testPrisma.finPurchaseOrder.findUnique({ where: { id: po.id } })).status, "SELESAI");
  assert.deepEqual([await stokTotal(), await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH)], [6, 6 * H, -6 * H]);
  const jurnalAsal = await testPrisma.finJournalEntry.findFirst({ where: { source: "PENERIMAAN_BAHAN", sourceId: r.receiptId } });

  const body = { lines: [{ purchaseOrderLineId: L, jumlahDatang: 5, jumlahBaik: 5 }] };
  const pvG = await kor(w.g, "G", r.receiptId, body, { rev: 1, pratinjau: true });
  assert.equal(pvG.status, 200, JSON.stringify(pvG.body));
  assert.equal(pvG.body.jalur, "PEMBALIK_PENGGANTI");
  assert.deepEqual([pvG.body.dampak.stok[0].baikSebelum, pvG.body.dampak.stok[0].baikSesudah, pvG.body.dampak.stok[0].selisihQtyStok], [6, 5, -1]);
  assert.equal("jurnal" in pvG.body.dampak, false, "Gudang tanpa nilai jurnal");
  const pvF = await kor(w.f, "F", r.receiptId, body, { rev: 1, pratinjau: true });
  assert.deepEqual([pvF.body.dampak.jurnal.arah, pvF.body.dampak.jurnal.nilai], ["KURANG", H]);
  assert.deepEqual([await stokTotal(), await testPrisma.stockMovement.count()], [6, 1], "pratinjau tidak menulis");
  assert.equal(pvF.body.dampak.statusPO.sesudah, "DITERIMA_SEBAGIAN");

  const ok = await kor(w.f, "F", r.receiptId, body, { rev: 1, alasan: "Dus keenam salah hitung di surat jalan" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  // stok: catatan lama utuh (+6), pembalik (−6), pengganti (+5)
  const gerak = await testPrisma.stockMovement.findMany({ where: { goodsReceiptId: r.receiptId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  assert.deepEqual(gerak.map((m) => [m.type, Number(m.qty)]), [["RECEIPT", 6], ["RECEIPT", -6], ["RECEIPT", 5]]);
  assert.ok(gerak.every((m) => m.unitCost === H), "harga perolehan sama");
  assert.match(gerak[1].note, /Pembalik/); assert.match(gerak[2].note, /Pengganti/);
  assert.equal(await stokTotal(), 5);
  // buku: jurnal asli tetap POSTED; satu jurnal koreksi selisih 1 KG; saldo konsisten
  const asal = await testPrisma.finJournalEntry.findUnique({ where: { id: jurnalAsal.id } });
  assert.equal(asal.status, "POSTED");
  const koreksi = await testPrisma.finJournalEntry.findMany({ where: { source: "PENERIMAAN_BAHAN", sourceId: r.receiptId, idempotencyKey: { contains: ":KOREKSI:" } }, include: { lines: { include: { account: true } } } });
  assert.equal(koreksi.length, 1);
  assert.deepEqual(koreksi[0].lines.map((l) => [l.account.systemKey, Number(l.debit), Number(l.credit)]).sort(), [[SYSTEM_KEYS.PERSEDIAAN_BAHAN, 0, H], [SYSTEM_KEYS.UTANG_BELUM_DITAGIH, H, 0]].sort());
  assert.deepEqual([await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH)], [5 * H, -5 * H], "persediaan 5 KG, GRNI 5 KG, tanpa residual");
  // data & PO
  const line = await testPrisma.goodsReceiptLine.findFirst({ where: { goodsReceiptId: r.receiptId } });
  assert.deepEqual([line.receivedQty, line.acceptedQty], [5, 5]);
  assert.equal((await testPrisma.finPurchaseOrder.findUnique({ where: { id: po.id } })).status, "DITERIMA_SEBAGIAN");
  const ev = await testPrisma.goodsReceiptEvent.findFirst({ where: { goodsReceiptId: r.receiptId, type: "KEDATANGAN_DIKOREKSI" } });
  assert.equal(ev.after.jalur, "PEMBALIK_PENGGANTI"); assert.equal(ev.after.pergerakanStok.length, 2); assert.ok(ev.after.jurnalKoreksi);
  assert.equal(ev.before.lines[0].baik, 6); assert.equal(ev.after.lines[0].baik, 5);

  // rata-rata harga mengikuti ledger (pembalik dikurangkan dari receipt)
  const { dasarHargaRataRata } = await import("../../src/services/finance/posting/inventory.js");
  const d = await dasarHargaRataRata(testPrisma, w.busa.id);
  assert.equal(Number(d.totalQty), 5);

  // naik lagi 5→6 (salah catat ke arah sebaliknya): persediaan bertambah satu KG, PO kembali Selesai
  const naik = await kor(w.f, "F", r.receiptId, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 6, jumlahBaik: 6 }] }, { rev: 2, alasan: "Ternyata dus keenam memang ada" });
  assert.equal(naik.status, 200, JSON.stringify(naik.body));
  assert.deepEqual([await stokTotal(), await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH)], [6, 6 * H, -6 * H]);
  assert.equal((await testPrisma.finPurchaseOrder.findUnique({ where: { id: po.id } })).status, "SELESAI");
});

// ═══ 4. Lembar aktual ═══
test("LEMBAR aktual: dikoreksi sebelum dan SESUDAH Simpan ke Stok tanpa efek stok/jurnal; riwayat mencatat sebelum–sesudah", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10, pendamping: { satuan: "LEMBAR", mode: "AKTUAL", estimasi: 2 } });
  const L = po.lines[0].id;
  const t = await tiba(w, po, 5, { lembar: 1 });
  const id = t.body.receiptId;
  assert.equal((await kor(w.g, "G", id, { lines: [{ purchaseOrderLineId: L, jumlahPendamping: 2 }] }, { rev: 1 })).status, 200);
  await periksa(w, id, { baik: 5 });
  await simpan(w, id);
  const sebelum = await cacah();
  const gudang = await kor(w.g, "G", id, { lines: [{ purchaseOrderLineId: L, jumlahPendamping: 3 }] }, { rev: 2, alasan: "Hitung ulang lembar di gudang" });
  assert.equal(gudang.status, 200, JSON.stringify(gudang.body));
  assert.equal(gudang.body.jalur, "LANGSUNG");
  const sesudah = await cacah();
  assert.deepEqual([sesudah.stok, sesudah.jurnal], [sebelum.stok, sebelum.jurnal], "lembar tidak menyentuh stok/jurnal");
  assert.equal(Number((await testPrisma.goodsReceiptLine.findFirst({ where: { goodsReceiptId: id } })).companionQty), 3);
  const ev = await testPrisma.goodsReceiptEvent.findFirst({ where: { goodsReceiptId: id, type: "KEDATANGAN_DIKOREKSI" }, orderBy: { createdAt: "desc" } });
  assert.equal(ev.before.lines[0].pendamping, 2); assert.equal(ev.after.lines[0].pendamping, 3);
  const negatif = await kor(w.g, "G", id, { lines: [{ purchaseOrderLineId: L, jumlahPendamping: -1 }] }, { rev: 3 });
  assert.equal(negatif.status, 400);
});

// ═══ 5. Kaitan pengganti ═══
test("PENGGANTI: kaitan dipindah antar penolakan (kapasitas dihormati), tujuan tanpa penolakan/lebih kecil ditolak; dilepas jadi pengiriman asli dibatasi sisa PO", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const L = po.lines[0].id;
  // dua penolakan: A (4 datang, 2 baik, 2 ditolak) dan C (4 datang, 3 baik, 1 ditolak)
  const A = await tiba(w, po, 4, { tanggal: geser(-9) });
  const lineA = await periksa(w, A.body.receiptId, { baik: 2, tolak: 2 }); await simpan(w, A.body.receiptId);
  const C = await tiba(w, po, 4, { tanggal: geser(-7) });
  const lineC = await periksa(w, C.body.receiptId, { baik: 3, tolak: 1 }); await simpan(w, C.body.receiptId);
  // pengganti 1 KG, otomatis ke penolakan tertua (A)
  const B = await tiba(w, po, 1, { tanggal: geser(-3), pengganti: true, dari: lineA });
  assert.equal(B.status, 201, JSON.stringify(B.body));
  const idB = B.body.receiptId;
  const lineB = (await testPrisma.goodsReceiptLine.findFirst({ where: { goodsReceiptId: idB } }));
  assert.equal(lineB.replacementForLineId, lineA);

  // pindah ke C (sisa penolakan C = 1) → boleh; progres PO tidak berubah (total menunggu pengganti sama)
  const pv = await kor(w.g, "G", idB, { lines: [{ purchaseOrderLineId: L, penggantiDariBarisId: lineC }] }, { rev: 1, pratinjau: true });
  assert.equal(pv.status, 200, JSON.stringify(pv.body)); assert.equal(pv.body.boleh, true); assert.equal(pv.body.dampak.progres.length, 0);
  const ok = await kor(w.g, "G", idB, { lines: [{ purchaseOrderLineId: L, penggantiDariBarisId: lineC }] }, { rev: 1, alasan: "Pengganti ini untuk penolakan GR kedua" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await testPrisma.goodsReceiptLine.findUnique({ where: { id: lineB.id } })).replacementForLineId, lineC);
  const ev = await testPrisma.goodsReceiptEvent.findFirst({ where: { goodsReceiptId: idB, type: "KEDATANGAN_DIKOREKSI" } });
  assert.notEqual(ev.before.lines[0].penggantiDari, ev.after.lines[0].penggantiDari);
  // jumlah pengganti 2 > sisa penolakan C (1) → ditolak
  const lebih = await kor(w.g, "G", idB, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 2 }] }, { rev: 2 });
  assert.equal(lebih.status, 409); assert.equal(lebih.body.code, "MELEBIHI_PENOLAKAN");
  // menunjuk baris tanpa penolakan (baris pengganti itu sendiri / penerimaan yang sama) → ditolak jelas
  const sama = await kor(w.g, "G", idB, { lines: [{ purchaseOrderLineId: L, penggantiDariBarisId: lineB.id }] }, { rev: 2 });
  assert.equal(sama.status, 409); assert.equal(sama.body.code, "KAITAN_TIDAK_VALID");
  // lepas kaitan → pengiriman asli 1 KG (sisa PO 10 − 8 = 2 cukup)
  const lepas = await kor(w.f, "F", idB, { lines: [{ purchaseOrderLineId: L, penggantiDariBarisId: null }] }, { rev: 2, alasan: "Bukan pengganti; tambahan pesanan" });
  assert.equal(lepas.status, 200, JSON.stringify(lepas.body));
  const q = (await w.g.get(`/api/inventory/barang-akan-datang/${po.id}`)).body.lines[0];
  assert.deepEqual([q.datangAsli, q.pengganti, q.menungguPengganti], [9, 0, 3]);
});

// ═══ 6. Tanggal & termin ═══
test("TANGGAL & TERMIN: faktur belum disetujui dihitung ulang (pratinjau menunjukkan jatuh tempo lama→baru); faktur DISETUJUI terkunci (TERMIN_TERKUNCI, arah tindakan), tidak ada yang berubah", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5 });
  const L = po.lines[0].id;
  const r = await terimaSimpan(w, po, 5, 5, { tanggal: geser(-10) });
  const billId = await fakturDraf(w, po, 5);
  const due = async () => (await testPrisma.finSupplierBill.findUnique({ where: { id: billId } })).dueDate.toISOString().slice(0, 10);
  assert.equal(await due(), geser(-10 + 30));

  const pv = await kor(w.f, "F", r.receiptId, { tanggalTiba: geser(-12) }, { rev: 1, pratinjau: true });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  const t = pv.body.dampak.termin[0];
  assert.deepEqual([t.berubah, t.jatuhTempoSebelum, t.jatuhTempo, t.terkunci], [true, geser(-10 + 30), geser(-12 + 30), false]);
  assert.equal(await due(), geser(-10 + 30), "pratinjau tidak menulis");
  const ok = await kor(w.f, "F", r.receiptId, { tanggalTiba: geser(-12) }, { rev: 1, alasan: "Tanggal di surat jalan lebih awal" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await due(), geser(-12 + 30));

  // setelah faktur disetujui: terkunci
  assert.equal((await w.ap.post(`/api/finance/bills/${billId}/approve`, {})).status, 200);
  const pvKunci = await kor(w.f, "F", r.receiptId, { tanggalTiba: geser(-15) }, { rev: 2, pratinjau: true });
  assert.equal(pvKunci.status, 200); assert.equal(pvKunci.body.boleh, false);
  assert.equal(pvKunci.body.blokir[0].kode, "TERMIN_TERKUNCI");
  assert.match(pvKunci.body.blokir[0].arah, /batalkan faktur/);
  const awal = await cacah();
  const kunciOk = await kor(w.f, "F", r.receiptId, { tanggalTiba: geser(-15) }, { rev: 2 });
  assert.equal(kunciOk.status, 409); assert.equal(kunciOk.body.code, "TERMIN_TERKUNCI"); assert.ok(kunciOk.body.arah);
  assert.deepEqual(await cacah(), awal);
  assert.equal(await due(), geser(-12 + 30), "faktur disetujui tidak diubah diam-diam");
  // PIC / surat jalan tetap boleh (tidak memengaruhi termin)
  assert.equal((await kor(w.g, "G", r.receiptId, { penerima: "Budi (koreksi)", suratJalan: "SJ-KOREKSI" }, { rev: 2, alasan: "Ralat PIC dan surat jalan" })).status, 200);
  void L;
});

// ═══ 7. Diblokir dengan sebab & arah ═══
test("DIBLOKIR sesudah stok: faktur disetujui, stok sudah dipakai Produksi, melebihi PO, periode tertutup — sebab + arah jelas, tidak ada yang tertulis; koreksi tanpa efek stok tetap boleh", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 8 });
  const L = po.lines[0].id;
  const r = await terimaSimpan(w, po, 6);
  const baik = (n) => ({ lines: [{ purchaseOrderLineId: L, jumlahDatang: Math.max(n, 6), jumlahBaik: n }] });

  // melebihi PO (sisa 8): 9
  const lebih = await kor(w.f, "F", r.receiptId, baik(9), { rev: 1 });
  assert.equal(lebih.status, 409); assert.equal(lebih.body.code, "MELEBIHI_PO");

  // periode hari ini tertutup
  const t = new Date(Date.now() + 7 * 3600 * 1000);
  await testPrisma.finPeriod.upsert({ where: { year_month: { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 } }, update: { status: "CLOSED" }, create: { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, status: "CLOSED" } });
  const tutup = await kor(w.f, "F", r.receiptId, baik(5), { rev: 1 });
  assert.equal(tutup.status, 409); assert.equal(tutup.body.code, "PERIODE_TERTUTUP"); assert.match(tutup.body.arah, /membuka kembali/);
  await testPrisma.finPeriod.deleteMany({});

  // Produksi memakai bahan setelah disimpan → asal stok tidak pasti
  await testPrisma.stockMovement.create({ data: { materialId: w.busa.id, type: "ISSUE", qty: -2, reason: "Dipakai produksi (uji)", createdAt: new Date(Date.now() + 1000) } });
  const awal = await cacah();
  const pakai = await kor(w.g, "G", r.receiptId, baik(5), { rev: 1 });
  assert.equal(pakai.status, 409); assert.equal(pakai.body.code, "STOK_SUDAH_BERGERAK");
  assert.match(pakai.body.error, /rata-rata tertimbang tanpa lot/); assert.match(pakai.body.arah, /opname\/penyesuaian/);
  assert.deepEqual(await cacah(), awal, "tidak ada yang tertulis");
  await testPrisma.stockMovement.deleteMany({ where: { type: "ISSUE" } });

  // faktur disetujui mengklaim baris
  await fakturDraf(w, po, 6, { setuju: true });
  const faktur = await kor(w.f, "F", r.receiptId, baik(5), { rev: 1 });
  assert.equal(faktur.status, 409); assert.equal(faktur.body.code, "FAKTUR_DISETUJUI"); assert.match(faktur.body.arah, /batalkan faktur/);
  // koreksi tanpa efek stok (PIC) tetap boleh dan jumlah ditolak (tanpa efek stok)
  assert.equal((await kor(w.g, "G", r.receiptId, { penerima: "Budi (ralat)" }, { rev: 1, alasan: "Ralat nama PIC" })).status, 200);
});

// ═══ 8. Retur aktif (kontrak Retur Supplier ee6eec49) ═══
test("RETUR AKTIF: koreksi kuantitas ditolak 409 RETUR_AKTIF untuk retur draf, keluar, dan selesai; boleh setelah retur dibatalkan", { skip: !testPrisma.supplierReturnLine }, async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const L = po.lines[0].id;
  const r = await terimaSimpan(w, po, 6);
  const buat = async (qty) => {
    const x = await w.g.post("/api/inventory/retur-supplier", { reasonCode: "RUSAK", reason: "Busa pecah-pecah saat dibongkar", evidenceUrls: ["https://contoh.invalid/foto.jpg"], lines: [{ goodsReceiptLineId: r.lineId, qty }] }, kunci());
    assert.equal(x.status, 201, JSON.stringify(x.body));
    return x.body.returnId;
  };
  const koreksiBaik = (rev = 1, n = 5) => kor(w.g, "G", r.receiptId, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 6, jumlahBaik: n }] }, { rev });
  // draf
  const draf = await buat(1);
  const k1 = await koreksiBaik();
  assert.equal(k1.status, 409); assert.equal(k1.body.code, "RETUR_AKTIF"); assert.match(k1.body.error, /Draf/);
  // barang sudah keluar (tanpa faktur → langsung Selesai)
  const keluar = await w.g.post(`/api/inventory/retur-supplier/${draf}/keluar`, { pic: "Budi Gudang", note: "Diserahkan", proofUrls: ["https://contoh.invalid/serah.jpg"] }, kunci());
  assert.equal(keluar.status, 200, JSON.stringify(keluar.body));
  const k2 = await koreksiBaik();
  assert.equal(k2.status, 409); assert.equal(k2.body.code, "RETUR_AKTIF"); assert.match(k2.body.error, /RTS-/);
  // koreksi ke jumlah datang saja (kuantitas) juga ditolak
  const k3 = await kor(w.g, "G", r.receiptId, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 7 }] }, { rev: 1 });
  assert.equal(k3.status, 409); assert.equal(k3.body.code, "RETUR_AKTIF");
  // lepas retur → boleh
  assert.equal((await w.g.post(`/api/inventory/retur-supplier/${draf}/batal`, { reason: "Supplier menarik sendiri barangnya" }, kunci())).status, 200);
  const k4 = await koreksiBaik();
  assert.equal(k4.status, 200, JSON.stringify(k4.body));
});

// ═══ 9. Replay & paralel ═══
test("REPLAY & PARALEL: kunci sama = satu koreksi; dua koreksi serentak dengan revisi sama → satu menang (REVISI_USANG); pembalik/pengganti tidak ganda", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 8 });
  const L = po.lines[0].id;
  const r = await terimaSimpan(w, po, 6);
  const h = kunci();
  const body = { lines: [{ purchaseOrderLineId: L, jumlahDatang: 5, jumlahBaik: 5 }] };
  const a1 = await kor(w.g, "G", r.receiptId, body, { rev: 1, headers: h });
  const a2 = await kor(w.g, "G", r.receiptId, body, { rev: 1, headers: h }); // replay kunci sama
  assert.deepEqual([a1.status, a2.status], [200, 200], `${JSON.stringify(a1.body)} / ${JSON.stringify(a2.body)}`);
  assert.equal(a2.body.revisi, a1.body.revisi, "replay = hasil yang sama");
  assert.equal(await revisi(r.receiptId), 2, "kunci sama = satu koreksi");
  assert.equal(await testPrisma.stockMovement.count({ where: { goodsReceiptId: r.receiptId } }), 3);

  // paralel: dua koreksi BERBEDA pada revisi yang sama (2) → tepat satu berhasil
  const [b1, b2] = await Promise.all([
    kor(w.g, "G", r.receiptId, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 4, jumlahBaik: 4 }] }, { rev: 2, alasan: "Koreksi A" }),
    kor(w.f, "F", r.receiptId, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 3, jumlahBaik: 3 }] }, { rev: 2, alasan: "Koreksi B" }),
  ]);
  const st = [b1.status, b2.status].sort();
  assert.deepEqual(st, [200, 409], `${JSON.stringify(b1.body)} / ${JSON.stringify(b2.body)}`);
  const kalah = b1.status === 409 ? b1 : b2;
  assert.equal(kalah.body.code, "REVISI_USANG");
  assert.equal(await revisi(r.receiptId), 3);
  // ledger: tiap koreksi = tepat satu pembalik + satu pengganti; stok akhir = jumlah baik terakhir
  const gerak = await testPrisma.stockMovement.findMany({ where: { goodsReceiptId: r.receiptId, type: "RECEIPT" } });
  assert.equal(gerak.length, 5);
  const akhir = (await testPrisma.goodsReceiptLine.findFirst({ where: { goodsReceiptId: r.receiptId } })).acceptedQty;
  assert.equal(await stokTotal(), akhir);
});

// ═══ 10. Izin, kunci, nilai ═══
test("IZIN & KUNCI: anon 401, Sales 403; pratinjau tanpa Idempotency-Key 200; penerapan tanpa kunci 428; tanpa alasan 400; Gudang tanpa nilai, Finance dengan nilai", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 8 });
  const L = po.lines[0].id;
  const r = await terimaSimpan(w, po, 6);
  const path = `/api/inventory/barang-akan-datang/penerimaan/${r.receiptId}/koreksi`;
  const body = { revisi: 1, alasan: "Salah catat", perubahan: { lines: [{ purchaseOrderLineId: L, jumlahDatang: 5, jumlahBaik: 5 }] } };
  const anon = makeClient(server.baseUrl, "");
  assert.equal((await anon.post(path, body, kunci())).status, 401);
  assert.equal((await w.s.post(path, body, kunci())).status, 403);
  assert.equal((await w.g.post(path, { ...body, pratinjau: true })).status, 200, "pratinjau tidak butuh Idempotency-Key");
  assert.equal((await w.g.post(path, body)).status, 428, "penerapan butuh kunci");
  assert.equal((await w.g.post(path, { ...body, alasan: "" }, kunci())).status, 400);
  assert.equal((await w.g.post(path, { ...body, alasan: "abc" }, kunci())).status, 400);
  const pvG = (await w.g.post(path, { ...body, pratinjau: true })).body;
  const pvF = (await w.f.post(`/api/finance/purchase-orders/penerimaan/${r.receiptId}/koreksi-kedatangan`, { ...body, pratinjau: true })).body;
  assert.equal(JSON.stringify(pvG).includes("nilaiSelisih"), false); assert.equal(JSON.stringify(pvG).includes('"jurnal"'), false);
  assert.ok(pvF.dampak.jurnal.nilai > 0);
  assert.equal(await revisi(r.receiptId), 1, "tidak ada yang diterapkan");
});
