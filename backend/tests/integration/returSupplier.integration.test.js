// RETUR SUPPLIER & DEBIT NOTE — terhadap PostgreSQL sungguhan. Yang dikunci:
// (1) pengganti vs kredit: permintaan pengganti TIDAK membuat dokumen/mengurangi tagihan; retur kredit = dokumen dengan alasan, bukti, tautan PO–penerimaan–baris;
// (2) retur SEBELUM faktur disetujui mengurangi jumlah yang boleh ditagih; SESUDAH disetujui faktur lama dipertahankan + Debit Note + jurnal tertaut;
// (3) faktur dibayar sebagian → sisa berkurang + saldo kredit; lunas → saldo kredit penuh, TANPA refund kas; saldo kredit dipakai SEKALI atas pilihan + konfirmasi Finance;
// (4) Gudang tanpa nilai; izin terpisah; blokir (dipakai Produksi, stok tidak cukup, periode tertutup); replay & paralel; pembatalan; paritas stok–GRNI–utang–jurnal.
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
const kunci = () => ({ "Idempotency-Key": `rts-${randomUUID()}` });
const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);
const hariIni = () => geser(0);
let nomorFaktur = 0;
const ref = () => `FAK-RTS-${String(++nomorFaktur).padStart(4, "0")}`;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const [fin, admin, gudang, approver, sales] = await Promise.all(["FINANCE", "ADMIN", "WAREHOUSE", "APPROVER", "SALES"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-ESA", name: "PT ESA BUMINDO", paymentTermType: "HARI", paymentTermDays: 30 } });
  const busa = await createTestMaterial({ code: "BUSA-R50", name: "Busa Rebonded R50", unit: "KG" });
  return { f: c(fin), a: c(admin), g: c(gudang), ap: c(approver), s: c(sales), fin, admin, gudang, bank, supplier, busa };
}
async function poDisetujui(w, { qty = 10, harga = H } = {}) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: geser(-20), lines: [{ materialId: w.busa.id, qty, unitPrice: harga }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}
const tiba = (w, poId, body) => w.g.post(`/api/inventory/barang-akan-datang/${poId}/kedatangan`, { penerima: "Budi Gudang", catatan: "Barang tiba utuh", tanggalTiba: geser(-5), ...body }, kunci());
async function terimaDanSimpan(w, po, qty, { tanggal = geser(-5) } = {}) {
  const t = await tiba(w, po.id, { tanggalTiba: tanggal, lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: qty }] });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const id = t.body.receiptId;
  const gr = (await w.g.get(`/api/inventory/goods-receipts/${id}`)).body;
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}`, { status: "INSPECTION" })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}/lines/${gr.lines[0].id}`, { acceptedQty: qty, rejectedQty: 0 })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}`, { status: "READY_FOR_PUTAWAY" })).status, 200);
  const p = await w.g.post(`/api/inventory/goods-receipts/${id}/putaway`, {});
  assert.equal(p.status, 200, JSON.stringify(p.body));
  return { receiptId: id, lineId: gr.lines[0].id };
}
async function faktur(w, po, qty, { setuju = true } = {}) {
  const r = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate: geser(-1), lines: [{ purchaseOrderLineId: po.lines[0].id, qty, unitPrice: H }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (setuju) { const a = await w.ap.post(`/api/finance/bills/${r.body.billId}/approve`, {}); assert.equal(a.status, 200, JSON.stringify(a.body)); }
  return r.body.billId;
}
const bayar = (w, billId, amount) => w.a.post("/api/finance/supplier-payments", { supplierId: w.supplier.id, date: hariIni(), cashAccountId: w.bank.id, allocations: [{ billId, amount }] }, kunci());
const BUKTI = ["https://contoh.invalid/foto-kondisi-1.jpg"];
const buatRetur = (w, lineId, qty, extra = {}) => w.g.post("/api/inventory/retur-supplier", { reasonCode: "RUSAK", reason: "Busa pecah-pecah saat dibongkar", evidenceUrls: BUKTI, lines: [{ goodsReceiptLineId: lineId, qty }], ...extra }, kunci());
const keluar = (w, id, extra = {}, headers = kunci()) => w.g.post(`/api/inventory/retur-supplier/${id}/keluar`, { pic: "Budi Gudang", note: "Diserahkan ke kurir ESA", proofUrls: BUKTI, ...extra }, headers);
async function saldo(systemKey) {
  const a = await testPrisma.finAccount.findUnique({ where: { systemKey } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: a.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0); // debit − kredit
}
const stokTotal = async () => (await testPrisma.stockMovement.aggregate({ _sum: { qty: true } }))._sum.qty?.toNumber?.() ?? Number((await testPrisma.stockMovement.aggregate({ _sum: { qty: true } }))._sum.qty ?? 0);
const NILAI_HARGA_KEYS = ["nilaiPersediaan", "hargaPerolehan", "saldoKredit", "kurangiSisa", "stockValue", "unitCost", "amount"];

// ═══ 1. Pengganti vs kredit ═══
test("PENGGANTI vs KREDIT: permintaan pengganti tidak membuat dokumen retur dan tidak mengubah tagihan; retur kredit wajib alasan, jumlah, bukti, tautan PO–penerimaan–baris", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const r1 = await terimaDanSimpan(w, po, 5);
  await terimaDanSimpan(w, po, 5, { tanggal: geser(-2) });
  const f = await faktur(w, po, 10);
  const sebelum = { dokumen: await testPrisma.supplierReturn.count(), bill: await testPrisma.finSupplierBill.findUnique({ where: { id: f } }), jurnal: await testPrisma.finJournalEntry.count() };

  // keputusan "minta pengganti" lewat endpoint retur ditolak dan diarahkan ke alur penolakan/pengganti PO
  const minta = await buatRetur(w, r1.lineId, 2, { decision: "PENGGANTI" });
  assert.equal(minta.status, 409); assert.equal(minta.body.code, "GUNAKAN_ALUR_PENOLAKAN");
  assert.match(minta.body.error, /penolakan dan pengiriman pengganti/);
  assert.equal(await testPrisma.supplierReturn.count(), sebelum.dokumen);
  assert.equal(Number((await testPrisma.finSupplierBill.findUnique({ where: { id: f } })).amount), Number(sebelum.bill.amount), "nilai tagihan tidak berubah");
  assert.equal(await testPrisma.finJournalEntry.count(), sebelum.jurnal);

  // retur kredit: setiap isian wajib
  for (const [nama, ubah] of [["alasan kode", { reasonCode: "" }], ["penjelasan", { reason: "xx" }], ["bukti", { evidenceUrls: [] }], ["baris", { lines: [] }], ["jumlah", { lines: [{ goodsReceiptLineId: r1.lineId, qty: 0 }] }]]) {
    const r = await buatRetur(w, r1.lineId, 2, ubah);
    assert.equal(r.status, 400, `${nama}: ${JSON.stringify(r.body)}`);
  }
  const ok = await buatRetur(w, r1.lineId, 2);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const rt = ok.body.retur;
  assert.deepEqual([rt.status, rt.keputusan, rt.alasanKode, rt.bukti.length, rt.lines[0].qty], ["DRAFT", "KREDIT", "RUSAK", 1, 2]);
  assert.equal(rt.po.id, po.id);
  assert.equal(rt.lines[0].goodsReceiptLineId, r1.lineId);
  assert.equal(rt.lines[0].purchaseOrderLineId, po.lines[0].id);
  assert.match(rt.nomor, /^RTS-/);
  assert.equal(await stokTotal(), 10, "draf tidak menyentuh stok");
});

// ═══ 2. Retur SEBELUM faktur disetujui ═══
test("RETUR SEBELUM FAKTUR: PO 5+5 KG, retur 2 KG → stok 8, GRNI turun, jumlah yang boleh ditagih 8; faktur 10 KG ditolak saat disetujui, faktur 8 KG sah; paritas stok–GRNI–utang", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const r1 = await terimaDanSimpan(w, po, 5);
  await terimaDanSimpan(w, po, 5, { tanggal: geser(-2) });
  assert.equal(await stokTotal(), 10);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH), -10 * H, "GRNI kredit 10 KG");

  const pre = await w.g.post("/api/inventory/retur-supplier/pratinjau", { reasonCode: "RUSAK", reason: "Busa pecah", lines: [{ goodsReceiptLineId: r1.lineId, qty: 2 }] });
  assert.equal(pre.status, 200, JSON.stringify(pre.body));
  assert.equal(pre.body.boleh, true);
  assert.deepEqual([pre.body.baris[0].bagianBelumDitagih, pre.body.baris[0].bagianSudahDitagih], [2, 0]);
  assert.equal(JSON.stringify(pre.body).includes("nilaiPersediaan"), false, "pratinjau Gudang tanpa nilai");

  const rt = (await buatRetur(w, r1.lineId, 2)).body;
  const k = await keluar(w, rt.returnId);
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.deepEqual([k.body.status, k.body.debitNoteId], ["SELESAI", null], "tanpa bagian yang sudah ditagih → tanpa debit note");
  assert.equal(await stokTotal(), 8);
  const mv = await testPrisma.stockMovement.findFirst({ where: { type: "SUPPLIER_RETURN" } });
  assert.equal(Number(mv.qty), -2);
  assert.equal(await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), 8 * H);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH), -8 * H, "GRNI sisa yang boleh ditagih = 8 KG");
  const jr = await testPrisma.finJournalEntry.findFirst({ where: { source: "RETUR_SUPPLIER" }, include: { lines: { include: { account: true } } } });
  assert.deepEqual(jr.lines.map((l) => [l.account.systemKey, Number(l.debit), Number(l.credit)]).sort(), [[SYSTEM_KEYS.PERSEDIAAN_BAHAN, 0, 2 * H], [SYSTEM_KEYS.UTANG_BELUM_DITAGIH, 2 * H, 0]].sort());

  // faktur 10 KG dicatat tetapi tidak bisa disetujui; 8 KG sah
  const f10 = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate: geser(-1), lines: [{ purchaseOrderLineId: po.lines[0].id, qty: 10, unitPrice: H }] });
  assert.equal(f10.status, 201);
  assert.equal((await w.ap.post(`/api/finance/bills/${f10.body.billId}/approve`, {})).status, 409, "10 KG melebihi barang yang boleh ditagih (8)");
  await w.ap.post(`/api/finance/bills/${f10.body.billId}/reject`, { reason: "Uji: melebihi barang tertagih setelah retur" });
  const f8 = await faktur(w, po, 8);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH), 0, "GRNI nol: semua barang yang ada sudah tertagih");
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -8 * H);
  assert.equal(Number((await testPrisma.finSupplierBill.findUnique({ where: { id: f8 } })).amount), 8 * H);
});

// ═══ 3. Retur SESUDAH faktur disetujui ═══
test("RETUR SESUDAH FAKTUR (belum dibayar): faktur lama tidak berubah; Debit Note menunggu Finance; setelah disetujui sisa utang berkurang + jurnal tertaut; Gudang tidak melihat nilai", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const r1 = await terimaDanSimpan(w, po, 5);
  await terimaDanSimpan(w, po, 5, { tanggal: geser(-2) });
  const f = await faktur(w, po, 10);
  const rt = (await buatRetur(w, r1.lineId, 3)).body;
  const k = await keluar(w, rt.returnId);
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.equal(k.body.status, "KELUAR");
  assert.ok(k.body.debitNoteId && /^DN-/.test(k.body.debitNumber));
  // Gudang melihat status yang sama, tanpa nilai
  const gG = (await w.g.get(`/api/inventory/retur-supplier/${rt.returnId}`)).body;
  const gF = (await w.f.get(`/api/finance/retur-supplier/${rt.returnId}`)).body;
  assert.deepEqual([gG.status, gG.tahap, gG.debitNote.status], [gF.status, gF.tahap, gF.debitNote.status]);
  assert.equal(gG.tahap, "Menunggu persetujuan debit note");
  const mentahG = JSON.stringify(gG);
  for (const kk of NILAI_HARGA_KEYS) assert.equal(mentahG.includes(`"${kk}"`), false, `Gudang tidak boleh melihat ${kk}`);
  assert.equal(gF.lines[0].nilaiPersediaan, 3 * H, "Finance melihat nilai");

  const bill = await testPrisma.finSupplierBill.findUnique({ where: { id: f } });
  assert.deepEqual([bill.status, Number(bill.amount), Number(bill.creditApplied)], ["DISETUJUI", 10 * H, 0], "faktur lama dipertahankan");
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -10 * H, "utang belum berkurang sebelum debit note disetujui");

  // izin: Gudang tidak boleh menyetujui; pratinjau server menyebut dampak
  assert.equal((await w.g.post(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/setujui`, {}, kunci())).status, 403);
  const pv = (await w.f.get(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/pratinjau`)).body;
  assert.deepEqual([pv.nilai, pv.kurangiSisaUtang, pv.jadiSaldoKredit], [3 * H, 3 * H, 0]);
  const setuju = await w.ap.post(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/setujui`, { note: "Sesuai retur", kurangiSisaDiharapkan: 3 * H }, kunci());
  assert.equal(setuju.status, 200, JSON.stringify(setuju.body));
  assert.deepEqual([setuju.body.kurangiSisaUtang, setuju.body.saldoKredit], [3 * H, 0]);

  const sesudah = await testPrisma.finSupplierBill.findUnique({ where: { id: f } });
  assert.deepEqual([sesudah.status, Number(sesudah.amount), Number(sesudah.creditApplied)], ["DISETUJUI", 10 * H, 3 * H]);
  const list = (await w.f.get("/api/finance/utang/aging")).body;
  const baris = list.baris.filter((b) => b.billId === f);
  assert.equal(baris.reduce((s, b) => s + b.sisaUtang, 0), 7 * H, "aging: sisa utang 7 KG");
  assert.equal(list.ringkasan.kartu.totalUtangAktif, 7 * H);
  // paritas: persediaan 7 KG, utang 7 KG, GRNI nol
  assert.equal(await stokTotal(), 7);
  assert.equal(await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), 7 * H);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -7 * H);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH), 0);
  const jn = await testPrisma.finJournalEntry.findMany({ where: { source: "DEBIT_NOTE_SUPPLIER", sourceId: k.body.debitNoteId } });
  assert.equal(jn.length, 1, "satu jurnal koreksi tertaut");
  assert.equal((await testPrisma.supplierReturn.findUnique({ where: { id: rt.returnId } })).status, "SELESAI");
  // tidak bisa menyetujui dua kali
  assert.equal((await w.ap.post(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/setujui`, {}, kunci())).status, 409);
});

// ═══ 4. Dibayar sebagian & lunas ═══
test("FAKTUR DIBAYAR SEBAGIAN: debit note mengurangi sisa lalu selebihnya saldo kredit; FAKTUR LUNAS: seluruhnya saldo kredit, tanpa refund kas", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const r1 = await terimaDanSimpan(w, po, 5);
  await terimaDanSimpan(w, po, 5, { tanggal: geser(-2) });
  const f = await faktur(w, po, 10);
  assert.equal((await bayar(w, f, 6 * H)).status, 201);
  const kasSebelum = await testPrisma.finJournalEntry.count({ where: { source: "PEMBAYARAN_SUPPLIER" } });

  const rt = (await buatRetur(w, r1.lineId, 5)).body;
  const k = await keluar(w, rt.returnId);
  const pv = (await w.f.get(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/pratinjau`)).body;
  assert.deepEqual([pv.nilai, pv.kurangiSisaUtang, pv.jadiSaldoKredit], [5 * H, 4 * H, 1 * H], "sisa utang 4 KG: 4 mengurangi, 1 menjadi kredit");
  assert.equal((await w.ap.post(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/setujui`, {}, kunci())).status, 200);
  const b = await testPrisma.finSupplierBill.findUnique({ where: { id: f } });
  assert.deepEqual([b.status, Number(b.creditApplied)], ["LUNAS", 4 * H], "6 dibayar + 4 kredit = lunas");
  const kredit = (await w.f.get("/api/finance/retur-supplier/kredit/daftar")).body.kredit;
  assert.deepEqual([kredit.length, kredit[0].sisa], [1, 1 * H]);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), 1 * H, "Utang Usaha bersaldo debit sebesar saldo kredit supplier");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PEMBAYARAN_SUPPLIER" } }), kasSebelum, "tidak ada refund kas otomatis");
  // pembayaran tambahan tidak boleh melebihi sisa (nol)
  assert.equal((await bayar(w, f, 1)).status, 409);

  // faktur lunas penuh: PO kedua
  const w2po = await poDisetujui(w);
  const s1 = await terimaDanSimpan(w, w2po, 4);
  const f2 = await faktur(w, w2po, 4);
  assert.equal((await bayar(w, f2, 4 * H)).status, 201);
  assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: f2 } })).status, "LUNAS");
  const rt2 = (await buatRetur(w, s1.lineId, 2)).body;
  const k2 = await keluar(w, rt2.returnId);
  const ok2 = await w.ap.post(`/api/finance/retur-supplier/debit-note/${k2.body.debitNoteId}/setujui`, {}, kunci());
  assert.equal(ok2.status, 200); assert.deepEqual([ok2.body.kurangiSisaUtang, ok2.body.saldoKredit], [0, 2 * H]);
  assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: f2 } })).status, "LUNAS", "faktur lunas tetap lunas");
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), 3 * H, "saldo kredit total 1 + 2 KG");
});

// ═══ 5. Pemakaian saldo kredit ═══
test("SALDO KREDIT: dipakai pada faktur berikutnya hanya atas pilihan + konfirmasi Finance, SEKALI; replay tidak menggandakan; tanpa jurnal baru", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const r1 = await terimaDanSimpan(w, po, 5);
  const f = await faktur(w, po, 5);
  assert.equal((await bayar(w, f, 5 * H)).status, 201);
  const rt = (await buatRetur(w, r1.lineId, 2)).body;
  const k = await keluar(w, rt.returnId);
  await w.ap.post(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/setujui`, {}, kunci());
  const kredit = (await w.f.get("/api/finance/retur-supplier/kredit/daftar")).body.kredit[0];
  assert.equal(kredit.sisa, 2 * H);

  // faktur berikutnya (supplier sama)
  const po2 = await poDisetujui(w);
  await terimaDanSimpan(w, po2, 4);
  const f2 = await faktur(w, po2, 4);
  // TIDAK otomatis: faktur baru tidak dikurangi sendiri
  assert.equal(Number((await testPrisma.finSupplierBill.findUnique({ where: { id: f2 } })).creditApplied), 0);
  const jurnalSebelum = await testPrisma.finJournalEntry.count();

  const pv = (await w.f.get(`/api/finance/retur-supplier/kredit/${kredit.id}/pratinjau?billId=${f2}&jumlah=${2 * H}`)).body;
  assert.deepEqual([pv.sisaKredit, pv.pilihan.sisaUtangSebelum, pv.pilihan.sisaUtangSesudah, pv.pilihan.sisaKreditSesudah], [2 * H, 4 * H, 2 * H, 0]);
  const tanpaKonfirmasi = await w.ap.post(`/api/finance/retur-supplier/kredit/${kredit.id}/terapkan`, { billId: f2, jumlah: 2 * H }, kunci());
  assert.equal(tanpaKonfirmasi.status, 400); assert.equal(tanpaKonfirmasi.body.code, "KONFIRMASI_WAJIB");
  const lebih = await w.ap.post(`/api/finance/retur-supplier/kredit/${kredit.id}/terapkan`, { billId: f2, jumlah: 3 * H, konfirmasi: true }, kunci());
  assert.equal(lebih.status, 409); assert.equal(lebih.body.code, "KREDIT_TIDAK_CUKUP");

  const h = kunci();
  const a1 = await w.ap.post(`/api/finance/retur-supplier/kredit/${kredit.id}/terapkan`, { billId: f2, jumlah: 2 * H, konfirmasi: true, sisaFakturDilihat: 4 * H }, h);
  const a2 = await w.ap.post(`/api/finance/retur-supplier/kredit/${kredit.id}/terapkan`, { billId: f2, jumlah: 2 * H, konfirmasi: true, sisaFakturDilihat: 4 * H }, h);
  assert.equal(a1.status, 201, JSON.stringify(a1.body)); assert.equal(a2.status, 201);
  assert.equal(a2.body.applicationId, a1.body.applicationId, "replay kunci sama = hasil sama");
  const lagi = await w.ap.post(`/api/finance/retur-supplier/kredit/${kredit.id}/terapkan`, { billId: f2, jumlah: 1, konfirmasi: true }, kunci());
  assert.equal(lagi.status, 409, "saldo habis: tidak bisa dipakai dua kali");
  assert.equal(await testPrisma.finSupplierCreditApplication.count({ where: { status: "AKTIF" } }), 1);
  const b = await testPrisma.finSupplierBill.findUnique({ where: { id: f2 } });
  assert.deepEqual([Number(b.creditApplied), b.status], [2 * H, "DISETUJUI"]);
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalSebelum, "alokasi kredit tidak membuat jurnal baru (Utang Usaha sudah bersaldo debit)");
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -2 * H, "utang bersih faktur kedua 2 KG setelah kredit");
  // melunasi sisa
  assert.equal((await bayar(w, f2, 3 * H)).status, 400, "melebihi sisa 2 KG");
  assert.equal((await bayar(w, f2, 2 * H)).status, 201);
  assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: f2 } })).status, "LUNAS");
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), 0);
  // izin: Gudang tidak boleh
  assert.equal((await w.g.post(`/api/finance/retur-supplier/kredit/${kredit.id}/terapkan`, { billId: f2, jumlah: 1, konfirmasi: true }, kunci())).status, 403);
});

// ═══ 6. Blokir ═══
test("BLOKIR: bahan sudah dipakai Produksi, stok tidak cukup/direservasi, periode tertutup, penerimaan belum selesai; pesan jelas", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const r1 = await terimaDanSimpan(w, po, 5);
  // Produksi memakai 3 KG (ISSUE lewat ledger) → hanya 2 KG dari penerimaan ini yang masih boleh keluar
  await testPrisma.stockMovement.create({ data: { materialId: w.busa.id, type: "ISSUE", qty: -3, reason: "Dipakai produksi (uji)", createdAt: new Date(Date.now() + 1000) } });
  const kand = (await w.g.get(`/api/inventory/retur-supplier/kandidat/${po.id}`)).body.baris[0];
  assert.deepEqual([kand.diterima, kand.terpakaiProduksi, kand.bolehDiretur], [5, 3, 2]);
  const lebih = await buatRetur(w, r1.lineId, 3);
  assert.equal(lebih.status, 201, "draf boleh (rencana)");
  const kLebih = await keluar(w, lebih.body.returnId);
  assert.equal(kLebih.status, 409); assert.equal(kLebih.body.code, "JUMLAH_MELEBIHI");
  assert.match(kLebih.body.error, /melebihi yang boleh keluar \(2 KG\)/);
  assert.equal(await testPrisma.stockMovement.count({ where: { type: "SUPPLIER_RETURN" } }), 0, "tidak ada pergerakan");
  assert.equal((await w.g.post(`/api/inventory/retur-supplier/${lebih.body.returnId}/batal`, { reason: "Salah jumlah, diganti" }, kunci())).status, 200);

  // semua terpakai → alasan blokir DIPAKAI_PRODUKSI
  await testPrisma.stockMovement.create({ data: { materialId: w.busa.id, type: "ISSUE", qty: -2, reason: "Dipakai produksi (uji 2)", createdAt: new Date(Date.now() + 2000) } });
  const pre = await w.g.post("/api/inventory/retur-supplier/pratinjau", { reasonCode: "RUSAK", reason: "Busa pecah", lines: [{ goodsReceiptLineId: r1.lineId, qty: 1 }] });
  assert.equal(pre.body.boleh, false);
  assert.equal(pre.body.baris[0].blokir[0].kode, "DIPAKAI_PRODUKSI");
  assert.match(pre.body.baris[0].blokir[0].pesan, /sudah dipakai Produksi/);
  const draf = await buatRetur(w, r1.lineId, 1);
  assert.equal(draf.status, 201);
  const kk = await keluar(w, draf.body.returnId);
  assert.equal(kk.status, 409); assert.equal(kk.body.code, "DIPAKAI_PRODUKSI");
  assert.equal(await stokTotal(), 0, "stok tidak menjadi negatif");

  // penerimaan belum disimpan ke stok
  const t = await tiba(w, po.id, { lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: 5 }] });
  const gr = (await w.g.get(`/api/inventory/goods-receipts/${t.body.receiptId}`)).body;
  const bel = await buatRetur(w, gr.lines[0].id, 1);
  assert.equal(bel.status, 409); assert.equal(bel.body.code, "PENERIMAAN_BELUM_SELESAI");
});

test("BLOKIR periode tertutup: barang tidak bisa dikonfirmasi keluar dan debit note tidak bisa disetujui pada periode tertutup, dengan pesan jelas; tanpa efek samping", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const r1 = await terimaDanSimpan(w, po, 5);
  const f = await faktur(w, po, 5);
  const draf = (await buatRetur(w, r1.lineId, 2)).body;
  const hari = new Date(`${hariIni()}T00:00:00Z`);
  await testPrisma.finPeriod.upsert({ where: { year_month: { year: hari.getUTCFullYear(), month: hari.getUTCMonth() + 1 } }, update: { status: "CLOSED" }, create: { year: hari.getUTCFullYear(), month: hari.getUTCMonth() + 1, status: "CLOSED" } });
  const k = await keluar(w, draf.returnId);
  assert.equal(k.status, 409); assert.equal(k.body.code, "PERIODE_TERTUTUP"); assert.match(k.body.error, /sudah ditutup/);
  assert.equal(await testPrisma.stockMovement.count({ where: { type: "SUPPLIER_RETURN" } }), 0);
  assert.equal((await testPrisma.supplierReturn.findUnique({ where: { id: draf.returnId } })).status, "DRAFT");
  // buka kembali → keluar → tutup lagi → debit note ditolak
  await testPrisma.finPeriod.updateMany({ data: { status: "OPEN" } });
  const k2 = await keluar(w, draf.returnId);
  assert.equal(k2.status, 200, JSON.stringify(k2.body));
  await testPrisma.finPeriod.updateMany({ data: { status: "CLOSED" } });
  const s = await w.ap.post(`/api/finance/retur-supplier/debit-note/${k2.body.debitNoteId}/setujui`, {}, kunci());
  assert.equal(s.status, 409); assert.equal(s.body.code, "PERIODE_TERTUTUP");
  assert.equal(Number((await testPrisma.finSupplierBill.findUnique({ where: { id: f } })).creditApplied), 0, "tanpa efek samping");
  assert.equal((await testPrisma.finSupplierDebitNote.findUnique({ where: { id: k2.body.debitNoteId } })).status, "MENUNGGU");
});

// ═══ 7. Replay & paralel ═══
test("REPLAY & PARALEL: keluar dengan kunci sama = satu pergerakan; dua keluar serentak → satu berhasil; dua retur 3+3 pada 5 KG → satu keluar; dua persetujuan serentak → satu", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const r1 = await terimaDanSimpan(w, po, 5);
  await faktur(w, po, 5);
  const a = (await buatRetur(w, r1.lineId, 3)).body;
  const h = kunci();
  const k1 = await keluar(w, a.returnId, {}, h);
  const k2 = await keluar(w, a.returnId, {}, h);
  assert.equal(k1.status, 200); assert.equal(k2.status, 200);
  assert.equal(k2.body.debitNoteId, k1.body.debitNoteId);
  assert.equal(await testPrisma.stockMovement.count({ where: { type: "SUPPLIER_RETURN" } }), 1);
  assert.equal(await testPrisma.finSupplierDebitNote.count(), 1);

  // dua retur 3+3 pada sisa 2 KG: draf boleh, keluar hanya muat 2 → keduanya ditolak melebihi
  const b = (await buatRetur(w, r1.lineId, 2)).body;
  const c = (await buatRetur(w, r1.lineId, 2)).body;
  const [x, y] = await Promise.all([keluar(w, b.returnId), keluar(w, c.returnId)]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409], JSON.stringify([x.body, y.body]));
  assert.equal(await stokTotal(), 0, "5 − 3 − 2 = 0, tidak negatif");
  assert.equal(await testPrisma.stockMovement.count({ where: { type: "SUPPLIER_RETURN" } }), 2);

  // persetujuan serentak (dua penyetuju)
  const [p, q] = await Promise.all([
    w.ap.post(`/api/finance/retur-supplier/debit-note/${k1.body.debitNoteId}/setujui`, {}, kunci()),
    w.a.post(`/api/finance/retur-supplier/debit-note/${k1.body.debitNoteId}/setujui`, {}, kunci()),
  ]);
  assert.deepEqual([p.status, q.status].sort(), [200, 409]);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "DEBIT_NOTE_SUPPLIER", sourceId: k1.body.debitNoteId } }), 1);
  assert.equal(Number((await testPrisma.finSupplierBill.findFirst()).creditApplied), 3 * H, "kredit diterapkan sekali");
});

// ═══ 8. Pembatalan ═══
test("PEMBATALAN: draf; barang keluar sebelum debit note disetujui → stok kembali + jurnal dibalik; debit note disetujui → batal DN (admin) mengembalikan sisa utang; kredit terpakai menahan pembatalan; faktur tidak bisa dibatalkan selama ada debit note", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const r1 = await terimaDanSimpan(w, po, 5);
  const f = await faktur(w, po, 5);
  const bersih = { stok: await stokTotal(), pers: await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), utang: await saldo(SYSTEM_KEYS.UTANG_USAHA), grni: await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH) };

  // a) draf dibatalkan: alasan wajib
  const d = (await buatRetur(w, r1.lineId, 1)).body;
  assert.equal((await w.g.post(`/api/inventory/retur-supplier/${d.returnId}/batal`, {}, kunci())).status, 400);
  assert.equal((await w.g.post(`/api/inventory/retur-supplier/${d.returnId}/batal`, { reason: "Salah pilih barang" }, kunci())).status, 200);

  // b) barang keluar, debit note menunggu → batal retur oleh Gudang: stok kembali, jurnal dibalik, DN dibatalkan
  const r = (await buatRetur(w, r1.lineId, 2)).body;
  const k = await keluar(w, r.returnId);
  assert.equal(await stokTotal(), 3);
  assert.equal((await w.f.post(`/api/finance/retur-supplier/${r.returnId}/batal`, { reason: "Coba dari Finance" }, kunci())).status, 403, "Finance hanya membatalkan draf");
  const bt = await w.g.post(`/api/inventory/retur-supplier/${r.returnId}/batal`, { reason: "Supplier menolak retur, barang kembali" }, kunci());
  assert.equal(bt.status, 200, JSON.stringify(bt.body));
  assert.equal(await stokTotal(), 5);
  assert.deepEqual(await Promise.all([saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), saldo(SYSTEM_KEYS.UTANG_USAHA), saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH)]), [bersih.pers, bersih.utang, bersih.grni], "paritas kembali");
  assert.equal((await testPrisma.finSupplierDebitNote.findUnique({ where: { id: k.body.debitNoteId } })).status, "DIBATALKAN");
  assert.equal((await testPrisma.supplierReturn.findUnique({ where: { id: r.returnId } })).status, "DIBATALKAN");
  assert.equal((await w.g.post(`/api/inventory/retur-supplier/${r.returnId}/batal`, { reason: "Ulang batal" }, kunci())).status, 409);

  // c) retur → debit note disetujui → Gudang tidak bisa membatalkan retur; faktur tidak bisa dibatalkan; batal DN (admin) mengembalikan
  const r2 = (await buatRetur(w, r1.lineId, 2)).body;
  const k2 = await keluar(w, r2.returnId);
  assert.equal((await w.ap.post(`/api/finance/retur-supplier/debit-note/${k2.body.debitNoteId}/setujui`, {}, kunci())).status, 200);
  assert.equal((await w.g.post(`/api/inventory/retur-supplier/${r2.returnId}/batal`, { reason: "Ingin batal setelah disetujui" }, kunci())).status, 409);
  const batalFaktur = await w.a.post(`/api/finance/bills/${f}/cancel`, { reason: "Salah faktur" });
  assert.equal(batalFaktur.status, 409); assert.match(batalFaktur.body.error, /debit note aktif/);
  assert.equal((await w.ap.post(`/api/finance/retur-supplier/debit-note/${k2.body.debitNoteId}/batal`, { reason: "Salah setuju" }, kunci())).status, 403, "batal DN disetujui = finance:admin");
  const bdn = await w.a.post(`/api/finance/retur-supplier/debit-note/${k2.body.debitNoteId}/batal`, { reason: "Retur ditolak supplier, kredit dibatalkan" }, kunci());
  assert.equal(bdn.status, 200, JSON.stringify(bdn.body));
  assert.equal(Number((await testPrisma.finSupplierBill.findUnique({ where: { id: f } })).creditApplied), 0);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -5 * H, "utang faktur kembali penuh");
  // retur masih KELUAR (barang belum kembali) → debit note ulang
  assert.equal((await testPrisma.supplierReturn.findUnique({ where: { id: r2.returnId } })).status, "KELUAR");
  const ulang = await w.f.post(`/api/finance/retur-supplier/${r2.returnId}/debit-note`, {}, kunci());
  assert.equal(ulang.status, 201, JSON.stringify(ulang.body));
});

test("PEMBATALAN kredit: debit note yang kreditnya sudah dipakai tidak bisa dibatalkan sampai pemakaian dibatalkan", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const r1 = await terimaDanSimpan(w, po, 5);
  const f = await faktur(w, po, 5);
  assert.equal((await bayar(w, f, 5 * H)).status, 201);
  const k = await keluar(w, (await buatRetur(w, r1.lineId, 2)).body.returnId);
  await w.ap.post(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/setujui`, {}, kunci());
  const kredit = (await w.f.get("/api/finance/retur-supplier/kredit/daftar")).body.kredit[0];
  const po2 = await poDisetujui(w); await terimaDanSimpan(w, po2, 3); const f2 = await faktur(w, po2, 3);
  const app = await w.ap.post(`/api/finance/retur-supplier/kredit/${kredit.id}/terapkan`, { billId: f2, jumlah: 2 * H, konfirmasi: true }, kunci());
  assert.equal(app.status, 201);
  const tahan = await w.a.post(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/batal`, { reason: "Ingin dibatalkan" }, kunci());
  assert.equal(tahan.status, 409); assert.equal(tahan.body.code, "KREDIT_SUDAH_DIPAKAI");
  const lepas = await w.a.post(`/api/finance/retur-supplier/kredit-pemakaian/${app.body.applicationId}/batal`, { reason: "Salah pilih faktur" }, kunci());
  assert.equal(lepas.status, 200, JSON.stringify(lepas.body));
  assert.equal(Number((await testPrisma.finSupplierBill.findUnique({ where: { id: f2 } })).creditApplied), 0);
  assert.equal((await w.a.post(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/batal`, { reason: "Sekarang boleh dibatalkan" }, kunci())).status, 200);
});

// ═══ 9. Izin & batas dengan Koreksi Penerimaan ═══
test("IZIN: Sales ditolak di semua pintu; Gudang tanpa nilai & tidak bisa menyetujui; Finance tidak bisa mengeluarkan barang; baris dengan retur aktif terkunci terhadap koreksi jumlah (trigger)", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const r1 = await terimaDanSimpan(w, po, 5);
  const rt = (await buatRetur(w, r1.lineId, 2)).body;
  for (const [m, p] of [["get", "/api/inventory/retur-supplier"], ["get", "/api/finance/retur-supplier"], ["get", `/api/inventory/retur-supplier/${rt.returnId}`]]) assert.equal((await w.s[m](p)).status, 403, p);
  assert.equal((await w.s.post("/api/inventory/retur-supplier", { reasonCode: "RUSAK" }, kunci())).status, 403);
  assert.equal((await w.f.post(`/api/finance/retur-supplier/${rt.returnId}/keluar`, {}, kunci())).status, 404, "Finance tidak punya pintu keluar barang");
  assert.equal((await w.g.get("/api/finance/retur-supplier")).status, 403, "Gudang tidak punya finance:read");
  assert.equal((await w.g.post("/api/inventory/retur-supplier", { reasonCode: "RUSAK", reason: "x", lines: [] })).status, 428, "Idempotency-Key wajib");
  const daftarG = JSON.stringify((await w.g.get("/api/inventory/retur-supplier")).body);
  for (const kk of NILAI_HARGA_KEYS) assert.equal(daftarG.includes(`"${kk}"`), false, kk);

  // batas dengan Koreksi Penerimaan: setelah barang keluar, baris penerimaan terkunci terhadap koreksi jumlah
  const k = await keluar(w, rt.returnId);
  assert.equal(k.status, 200);
  await assert.rejects(() => testPrisma.goodsReceiptLine.update({ where: { id: r1.lineId }, data: { acceptedQty: 4 } }), /Retur Supplier aktif/);
  // batalkan retur → baris bebas lagi
  assert.equal((await w.g.post(`/api/inventory/retur-supplier/${rt.returnId}/batal`, { reason: "Dibatalkan untuk koreksi penerimaan" }, kunci())).status, 200);
  await testPrisma.goodsReceiptLine.update({ where: { id: r1.lineId }, data: { acceptedQty: 4 } });
});
