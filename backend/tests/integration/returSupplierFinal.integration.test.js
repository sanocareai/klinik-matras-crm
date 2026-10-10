// RETUR SUPPLIER — FINALISASI SEBELUM MERGE (Okt 2026). Empat temuan review, masing-masing dikunci terhadap PostgreSQL sungguhan:
// (1) JURNAL LENGKAP saat harga PO ≠ harga faktur: persediaan, GRNI, utang, Selisih Harga seimbang TANPA residual (sebelum & sesudah faktur, dibayar sebagian, lunas);
// (2) AUDIT FIFO: sistem memakai rata-rata tertimbang tanpa lot → asal stok tercampur TIDAK pasti → kasus terburuk diblokir dengan pesan jelas; kolam satu-sumber tetap pasti;
// (3) PROGRES: masuk stok (bruto) · diretur · diterima bersih dari PO terpisah (Finance & Gudang, satu definisi);
// (4) GERBANG REKONSILIASI + pembatalan pemakaian saldo kredit yang diaudit.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { dasarHargaRataRata } from "../../src/services/finance/posting/inventory.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HARGA_PO = 40_000;
const HARGA_FAKTUR = 45_000;
const kunci = () => ({ "Idempotency-Key": `rtf-${randomUUID()}` });
const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);
let nomorFaktur = 0;
const ref = () => `FAK-RTF-${String(++nomorFaktur).padStart(4, "0")}`;
const BUKTI = ["https://contoh.invalid/foto-kondisi-1.jpg"];

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const [fin, admin, gudang, approver] = await Promise.all(["FINANCE", "ADMIN", "WAREHOUSE", "APPROVER"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-ESA", name: "PT ESA BUMINDO", paymentTermType: "HARI", paymentTermDays: 30 } });
  const busa = await createTestMaterial({ code: "BUSA-R50", name: "Busa Rebonded R50", unit: "KG" });
  return { f: c(fin), a: c(admin), g: c(gudang), ap: c(approver), adminId: admin.user.id, approverNama: approver.user.name, bank, supplier, busa };
}
async function poDisetujui(w, { qty = 5, harga = HARGA_PO, material = w.busa } = {}) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: geser(-20), lines: [{ materialId: material.id, qty, unitPrice: harga }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}
async function terimaDanSimpan(w, po, qty, { tanggal = geser(-5) } = {}) {
  const t = await w.g.post(`/api/inventory/barang-akan-datang/${po.id}/kedatangan`, { penerima: "Budi Gudang", catatan: "Barang tiba utuh", tanggalTiba: tanggal, lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: qty }] }, kunci());
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
async function fakturHarga(w, po, qty, harga = HARGA_FAKTUR, { setuju = true } = {}) {
  const r = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate: geser(-1), lines: [{ purchaseOrderLineId: po.lines[0].id, qty, unitPrice: harga }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (setuju) { const a = await w.ap.post(`/api/finance/bills/${r.body.billId}/approve`, { catatanTinjauanHarga: "Harga faktur supplier berbeda dari PO, ditinjau Finance (uji)" }); assert.equal(a.status, 200, JSON.stringify(a.body)); }
  return r.body.billId;
}
const bayar = (w, billId, amount) => w.a.post("/api/finance/supplier-payments", { supplierId: w.supplier.id, date: geser(0), cashAccountId: w.bank.id, allocations: [{ billId, amount }] }, kunci());
const buatRetur = (w, lineId, qty, extra = {}) => w.g.post("/api/inventory/retur-supplier", { reasonCode: "RUSAK", reason: "Busa pecah-pecah saat dibongkar", evidenceUrls: BUKTI, lines: [{ goodsReceiptLineId: lineId, qty }], ...extra }, kunci());
const keluar = (w, id, headers = kunci()) => w.g.post(`/api/inventory/retur-supplier/${id}/keluar`, { pic: "Budi Gudang", note: "Diserahkan ke kurir ESA", proofUrls: BUKTI }, headers);
const setujuiDN = (w, id) => w.ap.post(`/api/finance/retur-supplier/debit-note/${id}/setujui`, { note: "Sesuai bukti retur" }, kunci());
const pakaiProduksi = (materialId, qty, detik) => testPrisma.stockMovement.create({ data: { materialId, type: "ISSUE", qty: -qty, reason: "Dipakai produksi (uji)", createdAt: new Date(Date.now() + detik * 1000) } });

async function saldo(systemKey) {
  const a = await testPrisma.finAccount.findUnique({ where: { systemKey } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: a.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Math.round((Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0)) * 100) / 100; // debit − kredit
}
async function jurnalBaris(source, sourceId) {
  const e = await testPrisma.finJournalEntry.findFirst({ where: { source, sourceId, status: "POSTED" }, include: { lines: { include: { account: true } } } });
  assert.ok(e, `jurnal ${source} tidak ada`);
  const baris = e.lines.map((l) => [l.account.systemKey, Number(l.debit), Number(l.credit)]).sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1]));
  const d = baris.reduce((s, b) => s + b[1], 0); const c = baris.reduce((s, b) => s + b[2], 0);
  assert.equal(d, c, `jurnal ${source} tidak seimbang: debit ${d} ≠ kredit ${c}`);
  return baris;
}
async function neracaUji() {
  const [persediaan, grni, utang, selisih] = await Promise.all([SYSTEM_KEYS.PERSEDIAAN_BAHAN, SYSTEM_KEYS.UTANG_BELUM_DITAGIH, SYSTEM_KEYS.UTANG_USAHA, SYSTEM_KEYS.SELISIH_HARGA_PEMBELIAN].map(saldo));
  const agg = await testPrisma.finJournalLine.aggregate({ where: { entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return { persediaan, grni, utang, selisih, selisihBuku: Math.round((Number(agg._sum.debit) - Number(agg._sum.credit)) * 100) / 100 };
}
const stokTotal = async () => Number((await testPrisma.stockMovement.aggregate({ _sum: { qty: true } }))._sum.qty ?? 0);

// ═══ 1. JURNAL LENGKAP: harga PO Rp40.000/KG, harga faktur Rp45.000/KG, retur 2 KG ═══
test("JURNAL harga PO 40.000 ≠ faktur 45.000, retur 2 KG SESUDAH faktur disetujui: persediaan, GRNI, utang, Selisih Harga seimbang tanpa residual", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5 });
  const r = await terimaDanSimpan(w, po, 5);
  await fakturHarga(w, po, 5);
  // sebelum retur: persediaan 5×40.000, GRNI nol (ditutup faktur pada harga PO), utang 5×45.000, selisih 5×5.000 (beban)
  assert.deepEqual(await neracaUji(), { persediaan: 200_000, grni: 0, utang: -225_000, selisih: 25_000, selisihBuku: 0 });

  const rt = (await buatRetur(w, r.lineId, 2)).body;
  const k = await keluar(w, rt.returnId);
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.equal(k.body.status, "KELUAR");
  // Barang keluar: persediaan turun pada HARGA PEROLEHAN (2×40.000), GRNI didebit pada nilai yang sama — belum menyentuh utang
  assert.deepEqual(await jurnalBaris("RETUR_SUPPLIER", rt.returnId), [[SYSTEM_KEYS.PERSEDIAAN_BAHAN, 0, 80_000], [SYSTEM_KEYS.UTANG_BELUM_DITAGIH, 80_000, 0]]);
  assert.deepEqual(await neracaUji(), { persediaan: 120_000, grni: 80_000, utang: -225_000, selisih: 25_000, selisihBuku: 0 });

  // Pratinjau server: nilai debit note pada HARGA FAKTUR, nilai persediaan pada HARGA PEROLEHAN, selisih = 10.000
  const pv = (await w.f.get(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/pratinjau`)).body;
  assert.deepEqual([pv.nilai, pv.nilaiPersediaan, pv.selisihHarga, pv.kurangiSisaUtang, pv.jadiSaldoKredit], [90_000, 80_000, 10_000, 90_000, 0]);
  assert.deepEqual(pv.jurnal, [{ akun: "Utang Usaha", debit: 90_000, kredit: 0 }, { akun: "Utang Barang Belum Ditagih", debit: 0, kredit: 80_000 }, { akun: "Selisih Harga Pembelian", debit: 0, kredit: 10_000 }]);

  const s = await setujuiDN(w, k.body.debitNoteId);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.deepEqual(await jurnalBaris("DEBIT_NOTE_SUPPLIER", k.body.debitNoteId), [
    [SYSTEM_KEYS.SELISIH_HARGA_PEMBELIAN, 0, 10_000], [SYSTEM_KEYS.UTANG_BELUM_DITAGIH, 0, 80_000], [SYSTEM_KEYS.UTANG_USAHA, 90_000, 0],
  ]);
  // Akhir: persis 3 KG yang tersisa pada harganya masing-masing — tanpa sisa GRNI maupun selisih yatim
  assert.deepEqual(await neracaUji(), { persediaan: 3 * HARGA_PO, grni: 0, utang: -3 * HARGA_FAKTUR, selisih: 3 * (HARGA_FAKTUR - HARGA_PO), selisihBuku: 0 });
  assert.equal(await stokTotal(), 3);
  assert.equal((await neracaUji()).persediaan / (await stokTotal()), HARGA_PO, "nilai persediaan per KG = harga perolehan");
  // identik dengan dunia tanpa retur untuk 3 KG
});

test("JURNAL harga beda, retur 2 KG SEBELUM faktur: hasil akhir sama persis dengan retur sesudah faktur", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5 });
  const r = await terimaDanSimpan(w, po, 5);
  const rt = (await buatRetur(w, r.lineId, 2)).body;
  const k = await keluar(w, rt.returnId);
  assert.deepEqual([k.body.status, k.body.debitNoteId], ["SELESAI", null], "belum ditagih → tanpa debit note");
  assert.deepEqual(await neracaUji(), { persediaan: 120_000, grni: -120_000, utang: 0, selisih: 0, selisihBuku: 0 });
  // faktur 5 KG ditolak (hanya 3 KG yang boleh ditagih), 3 KG pada harga faktur 45.000 sah
  const f5 = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate: geser(-1), lines: [{ purchaseOrderLineId: po.lines[0].id, qty: 5, unitPrice: HARGA_FAKTUR }] });
  assert.equal((await w.ap.post(`/api/finance/bills/${f5.body.billId}/approve`, {})).status, 409);
  await w.ap.post(`/api/finance/bills/${f5.body.billId}/reject`, { reason: "Uji: melebihi barang tertagih setelah retur" });
  await fakturHarga(w, po, 3);
  assert.deepEqual(await neracaUji(), { persediaan: 3 * HARGA_PO, grni: 0, utang: -3 * HARGA_FAKTUR, selisih: 3 * (HARGA_FAKTUR - HARGA_PO), selisihBuku: 0 });
});

test("JURNAL harga beda, faktur DIBAYAR SEBAGIAN dan LUNAS: saldo kredit = kelebihan; Selisih Harga & GRNI tetap tanpa residual", async () => {
  // dibayar sebagian 200.000 dari 225.000 → sisa 25.000; debit note 90.000 = 25.000 mengurangi sisa + 65.000 saldo kredit
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5 });
  const r = await terimaDanSimpan(w, po, 5);
  const f = await fakturHarga(w, po, 5);
  assert.equal((await bayar(w, f, 200_000)).status, 201);
  const k = await keluar(w, (await buatRetur(w, r.lineId, 2)).body.returnId);
  const pv = (await w.f.get(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/pratinjau`)).body;
  assert.deepEqual([pv.kurangiSisaUtang, pv.jadiSaldoKredit], [25_000, 65_000]);
  assert.equal((await setujuiDN(w, k.body.debitNoteId)).status, 200);
  const kr = (await w.f.get("/api/finance/retur-supplier/kredit/daftar")).body.kredit[0];
  assert.equal(kr.sisa, 65_000);
  const n = await neracaUji();
  assert.equal(n.persediaan, 120_000); assert.equal(n.grni, 0); assert.equal(n.selisih, 15_000); assert.equal(n.selisihBuku, 0);
  assert.equal(n.utang, 65_000, "Utang Usaha bersaldo DEBIT 65.000 = saldo kredit supplier (bukan refund kas)");
  const bill = await testPrisma.finSupplierBill.findUnique({ where: { id: f } });
  assert.deepEqual([bill.status, Number(bill.creditApplied)], ["LUNAS", 25_000]);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PEMBAYARAN_SUPPLIER", status: "POSTED" } }), 1, "tidak ada refund kas/jurnal pembayaran baru");
});

test("JURNAL harga faktur LEBIH KECIL dari harga PO: selisih menjadi keuntungan dan tetap seimbang saat retur", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5, harga: 45_000 });
  const r = await terimaDanSimpan(w, po, 5);
  await fakturHarga(w, po, 5, 40_000);
  assert.deepEqual(await neracaUji(), { persediaan: 225_000, grni: 0, utang: -200_000, selisih: -25_000, selisihBuku: 0 });
  const k = await keluar(w, (await buatRetur(w, r.lineId, 2)).body.returnId);
  assert.equal((await setujuiDN(w, k.body.debitNoteId)).status, 200);
  assert.deepEqual(await jurnalBaris("DEBIT_NOTE_SUPPLIER", k.body.debitNoteId), [
    [SYSTEM_KEYS.SELISIH_HARGA_PEMBELIAN, 10_000, 0], [SYSTEM_KEYS.UTANG_BELUM_DITAGIH, 0, 90_000], [SYSTEM_KEYS.UTANG_USAHA, 80_000, 0],
  ]);
  assert.deepEqual(await neracaUji(), { persediaan: 135_000, grni: 0, utang: -120_000, selisih: -15_000, selisihBuku: 0 });
});

test("JURNAL pembatalan: debit note + retur dibatalkan → semua akun kembali ke kondisi sebelum retur (tanpa residual)", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5 });
  const r = await terimaDanSimpan(w, po, 5);
  await fakturHarga(w, po, 5);
  const awal = await neracaUji();
  const rt = (await buatRetur(w, r.lineId, 2)).body;
  const k = await keluar(w, rt.returnId);
  await setujuiDN(w, k.body.debitNoteId);
  assert.equal((await w.a.post(`/api/finance/retur-supplier/debit-note/${k.body.debitNoteId}/batal`, { reason: "Retur dibatalkan supplier" }, kunci())).status, 200);
  assert.equal((await w.g.post(`/api/inventory/retur-supplier/${rt.returnId}/batal`, { reason: "Barang kembali ke gudang" }, kunci())).status, 200);
  assert.deepEqual(await neracaUji(), awal);
  assert.equal(await stokTotal(), 5);
});

test("HARGA RATA-RATA setelah retur: barang yang sudah diretur tidak ikut menghitung rata-rata; pembatalan retur mengembalikannya", async () => {
  const w = await dunia();
  const poA = await poDisetujui(w, { qty: 10, harga: 30_000 });
  await terimaDanSimpan(w, poA, 10, { tanggal: geser(-8) });
  const poB = await poDisetujui(w, { qty: 5, harga: 40_000 });
  const b = await terimaDanSimpan(w, poB, 5, { tanggal: geser(-3) });
  const avg = async () => Number((await dasarHargaRataRata(testPrisma, w.busa.id)).harga.toFixed(2));
  assert.equal(await avg(), Number(((300_000 + 200_000) / 15).toFixed(2)));
  const rt = (await buatRetur(w, b.lineId, 2)).body;
  assert.equal((await keluar(w, rt.returnId)).status, 200);
  const d = await dasarHargaRataRata(testPrisma, w.busa.id);
  assert.equal(Number(d.totalQty), 13, "13 KG yang benar-benar ada");
  assert.equal(Number(d.totalNilai), 300_000 + 3 * 40_000);
  assert.equal(await avg(), Number((420_000 / 13).toFixed(2)));
  assert.equal((await w.g.post(`/api/inventory/retur-supplier/${rt.returnId}/batal`, { reason: "Supplier menolak menerima" }, kunci())).status, 200);
  assert.equal(await avg(), Number((500_000 / 15).toFixed(2)), "pembatalan retur mengembalikan jumlah");
});

// ═══ 2. AUDIT FIFO → asal stok ═══
test("ASAL STOK pasti: kolam stok hanya satu penerimaan → pemakaian Produksi PASTI dari penerimaan itu (DIPAKAI_PRODUKSI, jumlah tepat)", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5 });
  const r = await terimaDanSimpan(w, po, 5);
  await pakaiProduksi(w.busa.id, 3, 1);
  const kand = (await w.g.get(`/api/inventory/retur-supplier/kandidat/${po.id}`)).body.baris[0];
  assert.deepEqual([kand.diterima, kand.terpakaiProduksi, kand.bolehDiretur, kand.asalStokPasti, kand.peringatan.length], [5, 3, 2, true, 0]);
  await pakaiProduksi(w.busa.id, 2, 2);
  const pre = (await w.g.post("/api/inventory/retur-supplier/pratinjau", { reasonCode: "RUSAK", reason: "Busa pecah", lines: [{ goodsReceiptLineId: r.lineId, qty: 1 }] })).body;
  assert.equal(pre.baris[0].blokir[0].kode, "DIPAKAI_PRODUKSI");
  assert.match(pre.baris[0].blokir[0].pesan, /kolam stoknya hanya penerimaan ini, jadi pasti/);
});

test("ASAL STOK tidak pasti: dua penerimaan tercampur, Produksi memakai 4 KG → retur dibatasi ke jumlah yang pasti masih ada (kasus terburuk), bukan asumsi FIFO", async () => {
  const w = await dunia();
  const poLama = await poDisetujui(w, { qty: 5 });
  await terimaDanSimpan(w, poLama, 5, { tanggal: geser(-9) });
  const poBaru = await poDisetujui(w, { qty: 5 });
  const baru = await terimaDanSimpan(w, poBaru, 5, { tanggal: geser(-3) });
  await pakaiProduksi(w.busa.id, 4, 1);

  // FIFO "mengira" penerimaan baru utuh (5 KG). Kenyataannya sistem tidak melacak lot: yang pasti hanya 5 − 4 = 1 KG.
  const kand = (await w.g.get(`/api/inventory/retur-supplier/kandidat/${poBaru.id}`)).body.baris[0];
  assert.deepEqual([kand.asalStokPasti, kand.terpakaiProduksi, kand.bolehDiretur], [false, 4, 1]);
  assert.equal(kand.peringatan[0].kode, "ASAL_STOK_TIDAK_PASTI");
  assert.match(kand.peringatan[0].pesan, /tidak bisa dipastikan/);
  assert.match(kand.peringatan[0].pesan, /tidak melacak lot fisik/);
  assert.match(kand.peringatan[0].pesan, /Yang pasti masih ada dari penerimaan ini: 1 KG/);

  const pre = (await w.g.post("/api/inventory/retur-supplier/pratinjau", { reasonCode: "RUSAK", reason: "Busa pecah", lines: [{ goodsReceiptLineId: baru.lineId, qty: 4 }] })).body;
  assert.equal(pre.boleh, false);
  assert.equal(pre.baris[0].blokir[0].kode, "JUMLAH_MELEBIHI");
  assert.match(pre.baris[0].blokir[0].pesan, /Asal stok BUSA-R50 tidak bisa dipastikan/);

  // konfirmasi keluar 4 KG diblokir dengan kode & pesan yang sama; stok tidak berubah
  const draf = await buatRetur(w, baru.lineId, 4);
  assert.equal(draf.status, 201, "draf = rencana");
  const k4 = await keluar(w, draf.body.returnId);
  assert.equal(k4.status, 409, JSON.stringify(k4.body));
  assert.equal(k4.body.code, "ASAL_STOK_TIDAK_PASTI");
  assert.match(k4.body.error, /melebihi yang boleh keluar \(1 KG\)/);
  assert.equal(await testPrisma.stockMovement.count({ where: { type: "SUPPLIER_RETURN" } }), 0);
  await w.g.post(`/api/inventory/retur-supplier/${draf.body.returnId}/batal`, { reason: "Jumlah melebihi yang pasti" }, kunci());

  // jumlah yang PASTI aman (1 KG) tetap bisa keluar
  const k1 = await keluar(w, (await buatRetur(w, baru.lineId, 1)).body.returnId);
  assert.equal(k1.status, 200, JSON.stringify(k1.body));
});

test("ASAL STOK tidak pasti: seluruh jumlah penerimaan mungkin sudah terpakai → DIBLOKIR total (ASAL_STOK_TIDAK_PASTI) dengan arah penyelesaian; stok tidak negatif", async () => {
  const w = await dunia();
  const poLama = await poDisetujui(w, { qty: 5 });
  await terimaDanSimpan(w, poLama, 5, { tanggal: geser(-9) });
  const poBaru = await poDisetujui(w, { qty: 5 });
  const baru = await terimaDanSimpan(w, poBaru, 5, { tanggal: geser(-3) });
  await pakaiProduksi(w.busa.id, 5, 1);
  const kand = (await w.g.get(`/api/inventory/retur-supplier/kandidat/${poBaru.id}`)).body.baris[0];
  assert.equal(kand.bolehDiretur, 0);
  assert.equal(kand.blokir[0].kode, "ASAL_STOK_TIDAK_PASTI");
  assert.match(kand.blokir[0].pesan, /alur koreksi stok \(opname\/penyesuaian\)/);
  const draf = await buatRetur(w, baru.lineId, 1);
  const k = await keluar(w, draf.body.returnId);
  assert.equal(k.status, 409); assert.equal(k.body.code, "ASAL_STOK_TIDAK_PASTI");
  assert.equal(await stokTotal(), 5);
  // penerimaan LAMA pun tidak bisa diasumsikan utuh: pemakaian bisa saja dari mana pun di kolam
  const kandLama = (await w.g.get(`/api/inventory/retur-supplier/kandidat/${poLama.id}`)).body.baris[0];
  assert.equal(kandLama.asalStokPasti, false);
});

test("ASAL STOK pasti bila belum ada pemakaian: kolam tercampur tetapi tidak ada pengeluaran → seluruh jumlah boleh diretur", async () => {
  const w = await dunia();
  const poLama = await poDisetujui(w, { qty: 5 });
  await terimaDanSimpan(w, poLama, 5, { tanggal: geser(-9) });
  const poBaru = await poDisetujui(w, { qty: 5 });
  const baru = await terimaDanSimpan(w, poBaru, 5, { tanggal: geser(-3) });
  const kand = (await w.g.get(`/api/inventory/retur-supplier/kandidat/${poBaru.id}`)).body.baris[0];
  assert.deepEqual([kand.asalStokPasti, kand.bolehDiretur, kand.peringatan.length], [true, 5, 0]);
  assert.equal((await keluar(w, (await buatRetur(w, baru.lineId, 5)).body.returnId)).status, 200);
});

test("PENERIMAAN belum dibukukan ke Persediaan: retur diblokir (PENERIMAAN_BELUM_DIBUKUKAN) — tidak membalik GRNI", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5 });
  const r = await terimaDanSimpan(w, po, 5);
  // simulasi "Posting Tertunda"/penerimaan sebelum cutover: jurnal nilai penerimaan tidak ada (dibalik)
  const jr = await testPrisma.finJournalEntry.findFirst({ where: { source: "PENERIMAAN_BAHAN", sourceId: r.receiptId } });
  assert.ok(jr);
  await testPrisma.$executeRawUnsafe(`ALTER TABLE fin_journal_entries DISABLE TRIGGER USER`);
  try { await testPrisma.$executeRawUnsafe(`UPDATE fin_journal_entries SET status = 'REVERSED' WHERE id = '${jr.id}'::uuid`); } finally { await testPrisma.$executeRawUnsafe(`ALTER TABLE fin_journal_entries ENABLE TRIGGER USER`); }
  const pre = (await w.g.post("/api/inventory/retur-supplier/pratinjau", { reasonCode: "RUSAK", reason: "Busa pecah", lines: [{ goodsReceiptLineId: r.lineId, qty: 1 }] })).body;
  assert.equal(pre.boleh, false);
  assert.equal(pre.baris[0].blokir[0].kode, "PENERIMAAN_BELUM_DIBUKUKAN");
  assert.match(pre.baris[0].blokir[0].pesan, /belum dibukukan ke Persediaan/);
  const draf = await buatRetur(w, r.lineId, 1);
  assert.equal(draf.status, 409); assert.equal(draf.body.code, "PENERIMAAN_BELUM_DIBUKUKAN");
});

// ═══ 3. PROGRES: bruto · retur · bersih ═══
test("PROGRES stok: masuk stok (bruto), diretur, diterima bersih dari PO terpisah di Finance & Gudang; retur tidak membuka lagi 'belum dipenuhi supplier'; draf tidak dihitung", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const a = await terimaDanSimpan(w, po, 5, { tanggal: geser(-8) });
  await terimaDanSimpan(w, po, 5, { tanggal: geser(-3) });
  const angka = (l) => ({ masukStok: l.masukStok, diretur: l.diretur, diterimaBersih: l.diterimaBersih, belumDatang: l.belumDatang, belumDipenuhiSupplier: l.belumDipenuhiSupplier, belumMasukStok: l.belumMasukStok });
  const baca = async () => {
    const [g, p] = await Promise.all([w.g.get(`/api/inventory/barang-akan-datang/${po.id}`), w.f.get(`/api/finance/purchase-orders/${po.id}`)]);
    assert.equal(g.status, 200); assert.equal(p.status, 200, JSON.stringify(p.body));
    return { g: g.body, f: p.body.kedatangan, p: p.body };
  };
  let s = await baca();
  assert.deepEqual(angka(s.g.lines[0]), { masukStok: 10, diretur: 0, diterimaBersih: 10, belumDatang: 0, belumDipenuhiSupplier: 0, belumMasukStok: 0 });

  const draf = (await buatRetur(w, a.lineId, 2)).body;
  s = await baca();
  assert.equal(s.g.lines[0].diretur, 0, "draf (barang belum keluar) tidak mengurangi diterima bersih dari PO");

  assert.equal((await keluar(w, draf.returnId)).status, 200);
  s = await baca();
  const mau = { masukStok: 10, diretur: 2, diterimaBersih: 8, belumDatang: 0, belumDipenuhiSupplier: 0, belumMasukStok: 0 };
  assert.deepEqual(angka(s.g.lines[0]), mau, "Gudang");
  assert.deepEqual(angka(s.f.lines[0]), mau, "Finance (kartu kedatangan) — angka sama dengan Gudang");
  assert.deepEqual(angka(s.p.lines[0].progres), mau, "Finance (detail PO)");
  assert.ok(s.g.progresDefinisi.some((d) => d.kunci === "diretur") && s.g.progresDefinisi.some((d) => d.kunci === "diterimaBersih"));
  assert.match(s.g.progres.teks, /2 diretur \(diterima bersih dari PO 8\)/);
  // per penerimaan
  const grA = s.g.penerimaan.flatMap((x) => x.lines).find((x) => x.id === a.lineId);
  assert.deepEqual([grA.masukStok, grA.diretur, grA.diterimaBersih], [5, 2, 3]);
  // nilai hanya untuk Finance (harga PO)
  assert.equal(JSON.stringify(s.g).includes("nilaiDiterimaBersih"), false, "Gudang tanpa nilai");
  assert.deepEqual([s.p.totalDiterima, s.p.totalDiretur, s.p.totalDiterimaBersih], [10 * HARGA_PO, 2 * HARGA_PO, 8 * HARGA_PO]);
  assert.equal(s.f.totalDiterimaBersih, 8 * HARGA_PO);

  // jejak penerimaan (Gudang): bruto − diretur = bersih; tersisa ikut berkurang
  const jejak = (await w.g.get(`/api/inventory/goods-receipts/${a.receiptId}/jejak-pemakaian`)).body.bahan[0];
  assert.deepEqual([jejak.masukStok, jejak.returSupplier, jejak.diterimaBersih, jejak.tersisa], [5, 2, 3, 3]);

  // pembatalan retur (barang kembali) → bersih kembali
  assert.equal((await w.g.post(`/api/inventory/retur-supplier/${draf.returnId}/batal`, { reason: "Supplier menolak menerima" }, kunci())).status, 200);
  s = await baca();
  assert.deepEqual(angka(s.g.lines[0]), { masukStok: 10, diretur: 0, diterimaBersih: 10, belumDatang: 0, belumDipenuhiSupplier: 0, belumMasukStok: 0 });
});

// ═══ 4. GERBANG REKONSILIASI ═══
async function cocokkan(bankId, journalLineId) {
  const st = await testPrisma.finBankStatement.create({ data: { cashAccountId: bankId, periodStart: new Date(`${geser(-30)}T00:00:00Z`), periodEnd: new Date(`${geser(0)}T00:00:00Z`), openingBalance: 0, closingBalance: 0 } });
  await testPrisma.finBankStatementLine.create({ data: { statementId: st.id, date: new Date(`${geser(0)}T00:00:00Z`), description: "Uji cocok", amount: 1, status: "COCOK", matchedLineId: journalLineId, matchedAt: new Date() } });
}
const barisJurnal = async (source, sourceId) => (await testPrisma.finJournalLine.findFirst({ where: { entry: { source, sourceId, status: "POSTED" } }, orderBy: { id: "asc" } })).id;

test("REKONSILIASI: faktur/jurnal yang sudah dicocokkan dengan mutasi bank → setujui DN, batal DN, batal retur, pakai & batal kredit DIBLOKIR dengan alasan jelas", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5 });
  const r = await terimaDanSimpan(w, po, 5);
  const f = await fakturHarga(w, po, 5);
  const bill = await testPrisma.finSupplierBill.findUnique({ where: { id: f } });
  const rt = (await buatRetur(w, r.lineId, 2)).body;
  const k = await keluar(w, rt.returnId);
  const dnId = k.body.debitNoteId;

  // (a) jurnal faktur tercocok → debit note tidak bisa disetujui
  await cocokkan(w.bank.id, await barisJurnal("TAGIHAN_SUPPLIER", f));
  const s1 = await setujuiDN(w, dnId);
  assert.equal(s1.status, 409, JSON.stringify(s1.body)); assert.equal(s1.body.code, "SUDAH_DIREKONSILIASI");
  assert.match(s1.body.error, new RegExp(`Faktur ${bill.billNumber}: jurnalnya sudah dicocokkan dengan mutasi bank`));
  assert.match(s1.body.error, /Lepas pencocokannya di Rekonsiliasi Bank/);
  assert.equal((await testPrisma.finSupplierDebitNote.findUnique({ where: { id: dnId } })).status, "MENUNGGU", "tidak ada perubahan");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "DEBIT_NOTE_SUPPLIER" } }), 0);

  // (b) lepas pencocokan → boleh disetujui
  await testPrisma.finBankStatementLine.deleteMany({});
  assert.equal((await setujuiDN(w, dnId)).status, 200);

  // (c) jurnal debit note tercocok → batal DN diblokir; jurnal retur tercocok → batal retur diblokir
  await cocokkan(w.bank.id, await barisJurnal("DEBIT_NOTE_SUPPLIER", dnId));
  const b1 = await w.a.post(`/api/finance/retur-supplier/debit-note/${dnId}/batal`, { reason: "Ingin dibatalkan" }, kunci());
  assert.equal(b1.status, 409); assert.equal(b1.body.code, "SUDAH_DIREKONSILIASI");
  assert.match(b1.body.error, /Debit note DN-/);
  await testPrisma.finBankStatementLine.deleteMany({});
  assert.equal((await w.a.post(`/api/finance/retur-supplier/debit-note/${dnId}/batal`, { reason: "Ingin dibatalkan" }, kunci())).status, 200);
  await cocokkan(w.bank.id, await barisJurnal("RETUR_SUPPLIER", rt.returnId));
  const b2 = await w.g.post(`/api/inventory/retur-supplier/${rt.returnId}/batal`, { reason: "Barang kembali ke gudang" }, kunci());
  assert.equal(b2.status, 409); assert.equal(b2.body.code, "SUDAH_DIREKONSILIASI");
  assert.match(b2.body.error, /Retur RTS-/);
  assert.equal(await stokTotal(), 3, "stok tidak berubah oleh pembatalan yang ditolak");
  await testPrisma.finBankStatementLine.deleteMany({});
});

test("REKONSILIASI: pembayaran faktur yang sudah direkonsiliasi TIDAK memblokir debit note (skenario lunas → saldo kredit tetap jalan); pakai/batal kredit diblokir bila jurnal fakturnya tercocok", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5 });
  const r = await terimaDanSimpan(w, po, 5);
  const f = await fakturHarga(w, po, 5);
  assert.equal((await bayar(w, f, 225_000)).status, 201);
  // jurnal pembayaran (baris kas) dicocokkan dengan mutasi bank lewat API sungguhan
  const baris = await testPrisma.finJournalLine.findFirst({ where: { cashAccountId: w.bank.id, entry: { source: "PEMBAYARAN_SUPPLIER", status: "POSTED" } } });
  assert.ok(baris);
  await cocokkan(w.bank.id, baris.id);
  const k = await keluar(w, (await buatRetur(w, r.lineId, 2)).body.returnId);
  assert.equal((await setujuiDN(w, k.body.debitNoteId)).status, 200, "pembayaran terekonsiliasi tidak menghalangi debit note");
  const kr = (await w.f.get("/api/finance/retur-supplier/kredit/daftar")).body.kredit[0];
  assert.equal(kr.sisa, 90_000);

  // faktur berikutnya; jurnal fakturnya dicocokkan → pakai kredit diblokir
  const po2 = await poDisetujui(w, { qty: 3 });
  await terimaDanSimpan(w, po2, 3, { tanggal: geser(-2) });
  const f2 = await fakturHarga(w, po2, 3);
  await cocokkan(w.bank.id, await barisJurnal("TAGIHAN_SUPPLIER", f2));
  const pakai = await w.ap.post(`/api/finance/retur-supplier/kredit/${kr.id}/terapkan`, { billId: f2, jumlah: 50_000, konfirmasi: true }, kunci());
  assert.equal(pakai.status, 409); assert.equal(pakai.body.code, "SUDAH_DIREKONSILIASI");
  assert.equal(Number((await testPrisma.finSupplierBill.findUnique({ where: { id: f2 } })).creditApplied), 0);
  await testPrisma.finBankStatementLine.deleteMany({});
  const ok = await w.ap.post(`/api/finance/retur-supplier/kredit/${kr.id}/terapkan`, { billId: f2, jumlah: 50_000, konfirmasi: true }, kunci());
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  await cocokkan(w.bank.id, await barisJurnal("TAGIHAN_SUPPLIER", f2));
  const batal = await w.a.post(`/api/finance/retur-supplier/kredit-pemakaian/${ok.body.applicationId}/batal`, { reason: "Salah memilih faktur" }, kunci());
  assert.equal(batal.status, 409); assert.equal(batal.body.code, "SUDAH_DIREKONSILIASI");
  assert.equal(await testPrisma.finSupplierCreditApplication.count({ where: { status: "AKTIF" } }), 1);
});

// ═══ 5. PEMBATALAN PEMAKAIAN KREDIT YANG DIAUDIT ═══
test("BATAL PEMAKAIAN KREDIT diaudit: alasan wajib, hanya Admin Keuangan, Idempotency-Key wajib, replay aman, jejak (siapa/kapan/alasan) + dampak benar", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5 });
  const r = await terimaDanSimpan(w, po, 5);
  const f = await fakturHarga(w, po, 5);
  assert.equal((await bayar(w, f, 225_000)).status, 201);
  const k = await keluar(w, (await buatRetur(w, r.lineId, 2)).body.returnId);
  await setujuiDN(w, k.body.debitNoteId);
  const kr = (await w.f.get("/api/finance/retur-supplier/kredit/daftar")).body.kredit[0];
  const po2 = await poDisetujui(w, { qty: 4 });
  await terimaDanSimpan(w, po2, 4, { tanggal: geser(-2) });
  const f2 = await fakturHarga(w, po2, 4);
  const pakai = await w.ap.post(`/api/finance/retur-supplier/kredit/${kr.id}/terapkan`, { billId: f2, jumlah: 90_000, konfirmasi: true, note: "Potong faktur kedua" }, kunci());
  assert.equal(pakai.status, 201, JSON.stringify(pakai.body));
  const appId = pakai.body.applicationId;

  // data dialog dari server: siapa, kapan, dampak
  const daftar = (await w.f.get("/api/finance/retur-supplier/kredit/daftar")).body.kredit[0];
  const pm = daftar.pemakaian[0];
  assert.deepEqual([pm.id, pm.jumlah, pm.oleh, pm.sisaFaktur, pm.catatan], [appId, 90_000, w.approverNama, 4 * HARGA_FAKTUR - 90_000, "Potong faktur kedua"]);
  assert.ok(pm.oleh && pm.pada);

  // izin & masukan
  assert.equal((await w.f.post(`/api/finance/retur-supplier/kredit-pemakaian/${appId}/batal`, { reason: "Salah memilih faktur" }, kunci())).status, 403, "Finance biasa tidak boleh");
  assert.equal((await w.g.post(`/api/finance/retur-supplier/kredit-pemakaian/${appId}/batal`, { reason: "Salah memilih faktur" }, kunci())).status, 403, "Gudang tidak boleh");
  assert.equal((await w.a.post(`/api/finance/retur-supplier/kredit-pemakaian/${appId}/batal`, { reason: "Salah memilih faktur" })).status, 428, "Idempotency-Key wajib");
  assert.equal((await w.a.post(`/api/finance/retur-supplier/kredit-pemakaian/${appId}/batal`, { reason: "xx" }, kunci())).status, 400, "alasan minimal 5 karakter");
  assert.equal((await w.a.post(`/api/finance/retur-supplier/kredit-pemakaian/${appId}/batal`, {}, kunci())).status, 400, "alasan wajib");
  assert.equal(await testPrisma.finSupplierCreditApplication.count({ where: { status: "AKTIF" } }), 1, "penolakan tidak mengubah apa pun");

  const h = kunci();
  const b1 = await w.a.post(`/api/finance/retur-supplier/kredit-pemakaian/${appId}/batal`, { reason: "Salah memilih faktur" }, h);
  const b2 = await w.a.post(`/api/finance/retur-supplier/kredit-pemakaian/${appId}/batal`, { reason: "Salah memilih faktur" }, h);
  assert.equal(b1.status, 200, JSON.stringify(b1.body)); assert.equal(b2.status, 200, "replay kunci sama = hasil sama");
  const lagi = await w.a.post(`/api/finance/retur-supplier/kredit-pemakaian/${appId}/batal`, { reason: "Dibatalkan lagi" }, kunci());
  assert.equal(lagi.status, 409); assert.equal(lagi.body.code, "SUDAH_DIBATALKAN");

  // dampak: sisa utang faktur kembali, saldo kredit kembali
  const app = await testPrisma.finSupplierCreditApplication.findUnique({ where: { id: appId } });
  assert.deepEqual([app.status, app.cancelReason, app.cancelledById], ["DIBATALKAN", "Salah memilih faktur", w.adminId]);
  assert.ok(app.cancelledAt);
  assert.equal(Number((await testPrisma.finSupplierBill.findUnique({ where: { id: f2 } })).creditApplied), 0);
  const kr2 = (await w.f.get("/api/finance/retur-supplier/kredit/daftar")).body.kredit[0];
  assert.deepEqual([kr2.sisa, kr2.terpakai, kr2.pemakaian.length], [90_000, 0, 0]);

  // jejak audit: tepat satu peristiwa pembatalan (replay tidak menggandakan) memuat alasan & pelaku
  const peristiwa = await testPrisma.activityEvent.findMany({ where: { entityType: "fin_supplier_bill", entityId: f2 } });
  const batal = peristiwa.filter((e) => e.metadata?.aksi === "batal_pakai_saldo_kredit");
  assert.equal(batal.length, 1);
  assert.equal(batal[0].actorId, w.adminId);
  assert.equal(batal[0].metadata.alasan, "Salah memilih faktur");
  assert.equal(Number(batal[0].metadata.jumlah), 90_000);
  assert.equal(peristiwa.filter((e) => e.metadata?.aksi === "pakai_saldo_kredit").length, 1, "pemakaian awal juga tercatat");
});

test("DEFINISI server: 'Diterima bersih dari PO' (bukan 'stok bersih'), tegas bukan stok tersedia; kunci lama tidak ada", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5 });
  const g = (await w.g.get(`/api/inventory/barang-akan-datang/${po.id}`)).body;
  const d = g.progresDefinisi.find((x) => x.kunci === "diterimaBersih");
  assert.equal(d.label, "Diterima bersih dari PO");
  assert.match(d.definisi, /BUKAN stok tersedia/);
  assert.match(d.definisi, /dipakai Produksi atau direservasi/);
  assert.equal(g.progresDefinisi.some((x) => x.kunci === "stokBersih"), false);
  assert.equal(JSON.stringify(g).includes("stokBersih"), false, "kunci lama tidak boleh bocor di respons Gudang");
  assert.equal(/stok bersih/i.test(JSON.stringify(g.progresDefinisi)), false, "tidak ada label 'stok bersih' di definisi server");
});

// ═══ 6. KONTRAK DENGAN KOREKSI PENERIMAAN ═══
test("KOREKSI PENERIMAAN dengan retur aktif tertolak jelas: guard RETUR_AKTIF (draf & barang keluar), jalur koreksi/ubah yang ada menolak, trigger DB sebagai pagar terakhir", async () => {
  const { pastikanTanpaReturAktif, ReturError } = await import("../../src/services/finance/returSupplier.js");
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 5 });
  const r = await terimaDanSimpan(w, po, 5);
  const tolak = async (opsi) => { try { await pastikanTanpaReturAktif(testPrisma, opsi); return null; } catch (e) { assert.ok(e instanceof ReturError, String(e)); return e; } };

  // tanpa retur: lolos
  assert.equal(await tolak({ goodsReceiptLineId: r.lineId }), null);
  assert.equal(await tolak({ goodsReceiptId: r.receiptId }), null);

  // retur DRAF: guard menolak (rencana retur akan rusak bila jumlah baik berubah)
  const draf = (await buatRetur(w, r.lineId, 2)).body;
  const e1 = await tolak({ goodsReceiptLineId: r.lineId });
  assert.equal(e1.code, "RETUR_AKTIF"); assert.equal(e1.statusCode, 409);
  assert.ok(e1.message.includes(`punya Retur Supplier aktif: ${draf.returnNumber} (Draf`), e1.message);
  assert.match(e1.message, /Batalkan retur itu dulu \(Gudang\), baru koreksi penerimaan ini/);
  assert.deepEqual(e1.detail?.retur, [draf.returnNumber]);

  // barang SUDAH keluar: guard menolak lewat baris maupun penerimaan; jalur yang sudah ada menolak jelas; trigger DB menolak
  assert.equal((await keluar(w, draf.returnId)).status, 200);
  const e2 = await tolak({ goodsReceiptId: r.receiptId });
  assert.equal(e2.code, "RETUR_AKTIF");
  assert.match(e2.message, /Selesai; 2 KG BUSA-R50/, "belum ditagih → tanpa debit note → retur langsung Selesai; pesan tetap menyebut status & jumlah");
  const det = (await w.g.get(`/api/inventory/barang-akan-datang/${po.id}`)).body;
  const rec = det.penerimaan.find((x) => x.id === r.receiptId);
  const koreksi = await w.g.post(`/api/inventory/barang-akan-datang/penerimaan/${r.receiptId}/koreksi`, { revisi: rec.revisi, alasan: "Salah ketik jumlah datang", perubahan: { lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: 4 }] } }, kunci());
  assert.equal(koreksi.status, 409, JSON.stringify(koreksi.body));
  assert.match(koreksi.body.error, /tidak bisa dikoreksi lagi: penerimaan sudah masuk pemeriksaan\/penyimpanan/);
  const ubah = await w.g.patch(`/api/inventory/goods-receipts/${r.receiptId}/lines/${r.lineId}`, { acceptedQty: 3 });
  assert.ok([400, 409].includes(ubah.status), `status ${ubah.status}`);
  assert.match(ubah.body.error, /tidak bisa diubah lagi/);
  await assert.rejects(testPrisma.goodsReceiptLine.update({ where: { id: r.lineId }, data: { acceptedQty: 3 } }), /Retur Supplier aktif/);
  assert.equal(Number((await testPrisma.goodsReceiptLine.findUnique({ where: { id: r.lineId } })).acceptedQty), 5, "jumlah baik tidak berubah");

  // retur dibatalkan → guard lolos
  assert.equal((await w.g.post(`/api/inventory/retur-supplier/${draf.returnId}/batal`, { reason: "Supplier menarik sendiri barangnya" }, kunci())).status, 200);
  assert.equal(await tolak({ goodsReceiptLineId: r.lineId }), null);
  assert.equal(await tolak({ goodsReceiptId: r.receiptId }), null);
});
