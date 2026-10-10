// PO FASE 2 — pencocokan faktur supplier per baris.
// Yang dikunci: (1) faktur yang menagih lebih dari barang baik belum ditagih TERTAHAN, faktur yang pas bisa diproses; (2) jumlah baik yang sama tidak bisa
// ditagih dua kali (beberapa faktur per penerimaan, satu faktur untuk beberapa penerimaan, persetujuan paralel, replay); (3) selisih harga wajib tinjauan
// Finance dan dijurnal ke Selisih Harga Pembelian; (4) faktur/pembayaran TIDAK mengubah stok; (5) izin; (6) alur tagihan lama tidak berubah.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { toMoney } from "../../src/services/finance/money.js";
import { blokirKoreksiTagihanBatch } from "../../src/services/finance/koreksiLanjutan.js";
import { bawaSampaiSiap, catatTibaResmi } from "./setup/kedatangan.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HARGA = 43_290;
const kunci = () => ({ "Idempotency-Key": `pf-${randomUUID()}` });
const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
let nomorFaktur = 0;
const ref = () => `FAK-${String(++nomorFaktur).padStart(4, "0")}`;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const gudang = await createTestUser({ roles: ["WAREHOUSE"] });
  const f = makeClient(server.baseUrl, fin.token);
  const a = makeClient(server.baseUrl, admin.token);
  const g = makeClient(server.baseUrl, gudang.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-ESA", name: "PT ESA BUMINDO" } });
  const lem = await createTestMaterial({ code: "LEM-1037", name: "LEM I-SR 1037 13 KG", unit: "KG" });
  return { f, a, g, fin, admin, gudang, bank, supplier, lem };
}

async function poDisetujui(w, { qty = 10, harga = HARGA, lines = null } = {}) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: lines ?? [{ materialId: w.lem.id, qty, unitPrice: harga }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}
async function penerimaan(w, poId, { jadwal, datang, baik, tolak = 0, putaway = true }) {
  const gr = await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: poId, ...(jadwal !== undefined && { lines: [{ purchaseOrderLineId: (await testPrisma.finPurchaseOrderLine.findFirst({ where: { purchaseOrderId: poId } })).id, orderedQty: jadwal }] }) });
  assert.equal(gr.status, 201, JSON.stringify(gr.body));
  await bawaSampaiSiap(w.g, gr.body, { datang, baik, tolak }); // jalur resmi: Catat Barang Tiba → periksa → siap simpan
  if (putaway) assert.equal((await w.g.post(`/api/inventory/goods-receipts/${gr.body.id}/putaway`, {})).status, 200);
  return gr.body;
}
const buatFaktur = (w, po, { qty, harga = HARGA, ref: nomor = ref(), receiptIds, extra = {}, klien = null } = {}) =>
  (klien ?? w.f).post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: nomor, billDate: hariIni(), lines: [{ purchaseOrderLineId: po.lines[0].id, qty, unitPrice: harga }], ...(receiptIds && { receiptIds }), ...extra });
const setujui = (w, billId, body = {}, klien = null) => (klien ?? w.f).post(`/api/finance/bills/${billId}/approve`, body);

async function saldoAkun(code) {
  const a = await testPrisma.finAccount.findUnique({ where: { code } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: a.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return toMoney(agg._sum.debit || 0).minus(toMoney(agg._sum.credit || 0)).toNumber();
}
async function jurnalTagihan(billId) {
  const e = await testPrisma.finJournalEntry.findMany({ where: { source: "TAGIHAN_SUPPLIER", sourceId: billId, idempotencyKey: { startsWith: "TAGIHAN_SUPPLIER:" } }, include: { lines: { include: { account: true } } } });
  return e.flatMap((x) => x.lines.map((l) => ({ kode: l.account.code, debit: Number(l.debit), kredit: Number(l.credit), uraian: l.description })));
}
async function snapshotStok() {
  const m = await testPrisma.stockMovement.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, qty: true, unitCost: true, type: true } });
  return JSON.stringify(m.map((x) => [x.id, String(x.qty), x.unitCost, x.type]));
}
const ev = async (w, billId) => (await w.f.get(`/api/finance/purchase-orders/faktur/${billId}`)).body;

// ═══ 1. PO 10 → 8 baik → faktur 10 tertahan, faktur 8 diproses ═════════════════════════════════════════════════════
test("PO 10 → 8 baik: faktur 10 TERTAHAN dengan alasan jelas (tanpa jurnal/alokasi), faktur 8 diproses dan menutup GRNI; stok tidak berubah", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  await penerimaan(w, po.id, { datang: 9, baik: 8, tolak: 1 });
  const stok0 = await snapshotStok();

  const f10 = await buatFaktur(w, po, { qty: 10 });
  assert.equal(f10.status, 201, JSON.stringify(f10.body));
  assert.equal(f10.body.tertahan, true);
  assert.match(f10.body.alasanTertahan[0], /faktur menagih 10 KG.*hanya 8/);
  const b10 = f10.body.barisFaktur[0];
  assert.deepEqual([b10.dipesan, b10.diterimaBaik, b10.sudahDitagih, b10.diajukanIni, b10.hargaPO, b10.hargaFaktur, b10.selisihHarga], [10, 8, 0, 10, HARGA, HARGA, 0]);
  assert.equal(f10.body.amount, 10 * HARGA);

  const tahan = await setujui(w, f10.body.billId);
  assert.equal(tahan.status, 409);
  assert.equal(tahan.body.code, "TAGIHAN_PO_TERTAHAN");
  assert.match(tahan.body.error, /TERTAHAN/);
  assert.match(tahan.body.error, /hanya 8/);
  assert.equal(await testPrisma.finSupplierBillAllocation.count(), 0);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "TAGIHAN_SUPPLIER" } }), 0);
  assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: f10.body.billId } })).status, "MENUNGGU_APPROVAL");

  const f8 = await buatFaktur(w, po, { qty: 8 });
  assert.equal(f8.status, 201);
  assert.equal(f8.body.tertahan, false);
  assert.equal(f8.body.perluTinjauanHarga, false);
  const ok = await setujui(w, f8.body.billId);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const j = await jurnalTagihan(f8.body.billId);
  assert.deepEqual(j.filter((l) => l.debit > 0).map((l) => [l.kode, l.debit]), [["2-1150", 8 * HARGA]]);
  assert.deepEqual(j.filter((l) => l.kredit > 0).map((l) => [l.kode, l.kredit]), [["2-1100", 8 * HARGA]]);
  assert.equal(await saldoAkun("2-1150"), 0, "GRNI tertutup");
  assert.equal(await saldoAkun("1-1400"), 8 * HARGA, "persediaan tidak bertambah lagi");
  assert.equal(await snapshotStok(), stok0, "faktur tidak menulis stok");

  // faktur 10 tetap tertahan; PO menampilkan ditagih 8
  const lagi = await ev(w, f10.body.billId);
  assert.equal(lagi.tertahan, true);
  assert.equal(lagi.barisFaktur[0].sudahDitagih, 8);
  assert.equal(lagi.barisFaktur[0].tersedia, 0);
  const d = (await w.f.get(`/api/finance/purchase-orders/${po.id}`)).body;
  assert.equal(d.lines[0].ditagih, 8);
  assert.equal(d.faktur.length, 2);
});

test("penerimaan parsial kedua: faktur 2 diproses setelah penerimaan 2 ditempatkan; PO selesai, ditagih 10, GRNI nol", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  await penerimaan(w, po.id, { datang: 8, baik: 8 });
  const f8 = await buatFaktur(w, po, { qty: 8 });
  assert.equal((await setujui(w, f8.body.billId)).status, 200);

  const f2 = await buatFaktur(w, po, { qty: 2 });
  assert.equal(f2.body.tertahan, true, "belum ada penerimaan kedua");
  assert.equal((await setujui(w, f2.body.billId)).status, 409);

  await penerimaan(w, po.id, { datang: 2, baik: 2 });
  assert.equal((await ev(w, f2.body.billId)).tertahan, false);
  assert.equal((await setujui(w, f2.body.billId)).status, 200);
  assert.equal(await saldoAkun("2-1150"), 0);
  const d = (await w.f.get(`/api/finance/purchase-orders/${po.id}`)).body;
  assert.equal(d.status, "SELESAI");
  assert.equal(d.lines[0].ditagih, 10);
  assert.equal(d.totalDitagih, 10 * HARGA);
});

// ═══ 2. SATU FAKTUR ↔ BEBERAPA PENERIMAAN, BEBERAPA FAKTUR ↔ SATU PENERIMAAN ═══════════════════════════════════
test("satu faktur untuk beberapa penerimaan: alokasi FIFO per penerimaan, jurnal menutup GRNI per penerimaan; penerimaan terpilih membatasi", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const g1 = await penerimaan(w, po.id, { jadwal: 6, datang: 6, baik: 6 });
  const g2 = await penerimaan(w, po.id, { jadwal: 4, datang: 4, baik: 4 });

  const terbatas = await buatFaktur(w, po, { qty: 10, receiptIds: [g1.id] });
  assert.equal(terbatas.body.tertahan, true, "hanya penerimaan 1 (6) yang dipilih");
  assert.match(terbatas.body.alasanTertahan[0], /dari penerimaan terpilih/);

  const f = await buatFaktur(w, po, { qty: 10 });
  assert.equal(f.body.tertahan, false);
  assert.equal((await setujui(w, f.body.billId)).status, 200);
  const alok = await testPrisma.finSupplierBillAllocation.findMany({ where: { billId: f.body.billId }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(alok.map((a) => [a.goodsReceiptId, Number(a.qty)]).sort(), [[g1.id, 6], [g2.id, 4]].sort());
  const j = await jurnalTagihan(f.body.billId);
  const grni = j.filter((l) => l.kode === "2-1150" && l.debit > 0).map((l) => l.debit).sort((x, y) => x - y);
  assert.deepEqual(grni, [4 * HARGA, 6 * HARGA]);
  assert.equal(j.find((l) => l.kode === "2-1100").kredit, 10 * HARGA);
  assert.equal(await saldoAkun("2-1150"), 0);
  // faktur terpilih tadi kini tertahan (tersedia 0)
  assert.equal((await ev(w, terbatas.body.billId)).tertahan, true);
  assert.equal((await setujui(w, terbatas.body.billId)).status, 409);
});

test("beberapa faktur untuk satu penerimaan: 4 + 6 diproses, faktur ke-3 tertahan; tidak ada hitung ganda di GRNI/alokasi/PO", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  await penerimaan(w, po.id, { datang: 10, baik: 10 });
  const a = await buatFaktur(w, po, { qty: 4 });
  const b = await buatFaktur(w, po, { qty: 6 });
  const c = await buatFaktur(w, po, { qty: 1 });
  assert.equal((await setujui(w, a.body.billId)).status, 200);
  assert.equal((await setujui(w, b.body.billId)).status, 200);
  const tahan = await setujui(w, c.body.billId);
  assert.equal(tahan.status, 409);
  assert.equal(tahan.body.code, "TAGIHAN_PO_TERTAHAN");
  assert.equal(await saldoAkun("2-1150"), 0);
  assert.equal(await saldoAkun("2-1100"), -10 * HARGA, "utang usaha tepat sekali");
  const sum = (await testPrisma.finSupplierBillAllocation.findMany()).reduce((s, x) => s + Number(x.qty), 0);
  assert.equal(sum, 10);
  const d = (await w.f.get(`/api/finance/purchase-orders/${po.id}`)).body;
  assert.equal(d.lines[0].ditagih, 10);
  assert.equal(d.totalDitagih, 10 * HARGA);
});

// ═══ 3. BEDA HARGA ═══════════════════════════════════════════════════════════════════════════════════════════════
test("beda harga: wajib tinjauan Finance (tanpa toleransi), lalu Selisih Harga Pembelian dijurnal (lebih mahal = debit, lebih murah = kredit)", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 16 });
  await penerimaan(w, po.id, { datang: 16, baik: 16 });

  const mahal = await buatFaktur(w, po, { qty: 8, harga: 45_000 });
  assert.equal(mahal.body.perluTinjauanHarga, true);
  const b = mahal.body.barisFaktur[0];
  assert.deepEqual([b.hargaPO, b.hargaFaktur, b.selisihHarga, b.selisihNilai], [HARGA, 45_000, 1_710, 13_680]);
  const tolak = await setujui(w, mahal.body.billId);
  assert.equal(tolak.status, 409);
  assert.equal(tolak.body.code, "SELISIH_HARGA_PERLU_TINJAUAN");
  assert.match(tolak.body.error, /Tidak ada toleransi otomatis/);
  assert.equal((await setujui(w, mahal.body.billId, { catatanTinjauanHarga: "ok" })).status, 409, "catatan terlalu pendek");
  assert.equal(await testPrisma.finSupplierBillAllocation.count(), 0, "penolakan tidak meninggalkan alokasi");

  const ok = await setujui(w, mahal.body.billId, { catatanTinjauanHarga: "Kenaikan harga disetujui Owner via WA 8 Okt" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const j = await jurnalTagihan(mahal.body.billId);
  assert.equal(j.find((l) => l.kode === "2-1150").debit, 8 * HARGA);
  assert.equal(j.find((l) => l.kode === "2-1100").kredit, 8 * 45_000);
  const kodeSelisih = (await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.SELISIH_HARGA_PEMBELIAN } })).code;
  const sel = j.find((l) => l.kode === kodeSelisih);
  assert.equal(sel.debit, 13_680);
  const e = await ev(w, mahal.body.billId);
  assert.match(e.catatanTinjauan, /Owner/);
  assert.equal(e.ditinjauOleh, w.fin.user.id);
  assert.equal(await saldoAkun("2-1150"), -(8 * HARGA), "GRNI tutup hanya sebesar harga PO; sisa 8 belum ditagih");

  const murah = await buatFaktur(w, po, { qty: 8, harga: 40_000 });
  assert.equal((await setujui(w, murah.body.billId, { catatanTinjauanHarga: "Diskon supplier" })).status, 200);
  const j2 = await jurnalTagihan(murah.body.billId);
  assert.equal(j2.find((l) => l.kredit > 0 && l.kode !== "2-1100").kredit, 8 * (HARGA - 40_000), "selisih menguntungkan = kredit");
  assert.equal(await saldoAkun("2-1150"), 0);
});

// ═══ 4. BATAL / RETUR ═══════════════════════════════════════════════════════════════════════════════════════════
test("barang ditolak tidak bisa ditagih; membatalkan faktur melepas klaim sehingga jumlah itu bisa ditagih ulang", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  await penerimaan(w, po.id, { datang: 10, baik: 8, tolak: 2 });
  const sembilan = await buatFaktur(w, po, { qty: 9 });
  assert.equal(sembilan.body.tertahan, true, "2 barang ditolak/retur tidak ikut tertagih");

  const f = await buatFaktur(w, po, { qty: 8 });
  assert.equal((await setujui(w, f.body.billId)).status, 200);
  const dobel = await buatFaktur(w, po, { qty: 8 });
  assert.equal((await setujui(w, dobel.body.billId)).status, 409, "8 yang sama tidak boleh ditagih dua kali");

  const batal = await w.a.post(`/api/finance/bills/${f.body.billId}/cancel`, { reason: "Faktur salah nomor" });
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  assert.equal(await saldoAkun("2-1150"), -(8 * HARGA), "jurnal dibalik: barang kembali belum ditagih");
  assert.equal((await ev(w, dobel.body.billId)).tertahan, false, "klaim dilepas");
  assert.equal((await setujui(w, dobel.body.billId)).status, 200);
  assert.equal(await saldoAkun("2-1150"), 0);
  assert.equal(await saldoAkun("2-1100"), -(8 * HARGA));
});

// ═══ 5. REPLAY & PARALEL ════════════════════════════════════════════════════════════════════════════════════════
test("replay: buat faktur dengan Idempotency-Key sama → satu faktur; setujui dua kali → 409 tanpa jurnal/alokasi ganda", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  await penerimaan(w, po.id, { datang: 8, baik: 8 });
  const h = kunci();
  const body = { supplierRef: "FAK-REPLAY", billDate: hariIni(), lines: [{ purchaseOrderLineId: po.lines[0].id, qty: 8, unitPrice: HARGA }] };
  const a = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, body, h);
  const b = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, body, h);
  assert.equal(a.status, 201);
  assert.equal(b.headers.get("idempotent-replayed"), "true");
  assert.equal(b.body.billId, a.body.billId);
  assert.equal(await testPrisma.finSupplierBill.count({ where: { purchaseOrderId: po.id } }), 1);

  assert.equal((await setujui(w, a.body.billId)).status, 200);
  const lagi = await setujui(w, a.body.billId);
  assert.equal(lagi.status, 409);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "TAGIHAN_SUPPLIER", sourceId: a.body.billId } }), 1);
  assert.equal(await testPrisma.finSupplierBillAllocation.count({ where: { billId: a.body.billId } }), 1);
  // nomor faktur yang sama tidak bisa dicatat/disetujui dua kali
  const kembar = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, body);
  assert.equal(kembar.status, 201);
  const tolakKembar = await setujui(w, kembar.body.billId);
  assert.equal(tolakKembar.status, 409);
  assert.equal(tolakKembar.body.code, "FAKTUR_GANDA");
});

test("dua persetujuan paralel untuk jumlah baik yang sama (8 + 8, baik 8): tepat satu berhasil, satu tertahan; alokasi 8, GRNI nol", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  await penerimaan(w, po.id, { datang: 8, baik: 8 });
  const a = await buatFaktur(w, po, { qty: 8 });
  const b = await buatFaktur(w, po, { qty: 8 });
  const [r1, r2] = await Promise.all([setujui(w, a.body.billId), setujui(w, b.body.billId, {}, w.a)]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409], JSON.stringify([r1.body, r2.body]));
  const kalah = [r1, r2].find((r) => r.status === 409);
  assert.equal(kalah.body.code, "TAGIHAN_PO_TERTAHAN");
  const sum = (await testPrisma.finSupplierBillAllocation.findMany()).reduce((s, x) => s + Number(x.qty), 0);
  assert.equal(sum, 8, "jumlah baik yang sama tidak ditagih dua kali");
  assert.equal(await saldoAkun("2-1150"), 0);
  assert.equal(await saldoAkun("2-1100"), -(8 * HARGA));
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "TAGIHAN_SUPPLIER", idempotencyKey: { startsWith: "TAGIHAN_SUPPLIER:" } } }), 1);
});

test("persetujuan paralel faktur yang SAMA: satu berhasil, satu 409", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  await penerimaan(w, po.id, { datang: 10, baik: 10 });
  const a = await buatFaktur(w, po, { qty: 10 });
  const [r1, r2] = await Promise.all([setujui(w, a.body.billId), setujui(w, a.body.billId, {}, w.a)]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal(await testPrisma.finSupplierBillAllocation.count(), 1);
  assert.equal(await saldoAkun("2-1100"), -(10 * HARGA));
});

test("putaway penerimaan dan persetujuan faktur bersamaan tidak membuat klaim melebihi barang baik", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  await penerimaan(w, po.id, { datang: 5, baik: 5 });
  const siap = await penerimaan(w, po.id, { datang: 5, baik: 5, putaway: false });
  const f = await buatFaktur(w, po, { qty: 10 });
  const [put, ap] = await Promise.all([w.g.post(`/api/inventory/goods-receipts/${siap.id}/putaway`, {}), setujui(w, f.body.billId)]);
  assert.equal(put.status, 200);
  const sum = (await testPrisma.finSupplierBillAllocation.findMany()).reduce((s, x) => s + Number(x.qty), 0);
  if (ap.status === 200) assert.equal(sum, 10); else { assert.equal(ap.status, 409); assert.equal(sum, 0); }
  assert.ok(sum <= 10);
  if (ap.status === 409) assert.equal((await setujui(w, f.body.billId)).status, 200, "setelah putaway selesai faktur bisa disetujui");
});

// ═══ 6. TIDAK MENAMBAH STOK; PEMBAYARAN SUPPLIER ═════════════════════════════════════════════════════════════
test("faktur dan pembayaran supplier atas PO tidak menambah stok; pembayaran melunasi utang usaha", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  await penerimaan(w, po.id, { datang: 10, baik: 10 });
  const stok0 = await snapshotStok();
  const f = await buatFaktur(w, po, { qty: 10 });
  assert.equal((await setujui(w, f.body.billId)).status, 200);
  const bayar = await w.a.post("/api/finance/supplier-payments", { supplierId: w.supplier.id, date: hariIni(), cashAccountId: w.bank.id, allocations: [{ billId: f.body.billId, amount: 10 * HARGA }] });
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  assert.equal(await snapshotStok(), stok0);
  assert.equal(await saldoAkun("2-1100"), 0);
  assert.equal(await saldoAkun("1-1400"), 10 * HARGA);
  assert.equal(await saldoAkun("5-1100"), 0, "bukan beban");
  // faktur yang sudah dibayar tidak bisa dibatalkan sebelum pembayaran dibatalkan (perilaku lama)
  assert.equal((await w.a.post(`/api/finance/bills/${f.body.billId}/cancel`, { reason: "x" })).status, 409);
});

// ═══ 7. IZIN ═══════════════════════════════════════════════════════════════════════════════════════════════════
test("izin: Akuntan mencatat tapi tidak menyetujui; Penyetuju menyetujui; Gudang/Sales tidak menyentuh faktur PO; batal = Admin Finance", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  await penerimaan(w, po.id, { datang: 8, baik: 8 });
  const klien = async (peran) => makeClient(server.baseUrl, (await createTestUser({ roles: [peran] })).token);
  const akuntan = await klien("ACCOUNTANT");
  const penyetuju = await klien("APPROVER");
  const sales = await klien("SALES");

  for (const c of [w.g, sales]) {
    assert.equal((await buatFaktur(w, po, { qty: 8, klien: c })).status, 403);
    assert.equal((await c.get(`/api/finance/purchase-orders/${po.id}/penagihan`)).status, 403);
  }
  assert.equal((await penyetuju.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: "X", lines: [] })).status, 403, "penyetuju tidak mencatat");
  const f = await buatFaktur(w, po, { qty: 8, klien: akuntan });
  assert.equal(f.status, 201);
  assert.equal((await setujui(w, f.body.billId, {}, akuntan)).status, 403);
  assert.equal((await setujui(w, f.body.billId, {}, w.g)).status, 403);
  assert.equal((await setujui(w, f.body.billId, {}, penyetuju)).status, 200);
  assert.equal((await ev({ f: penyetuju }, f.body.billId)).status, "DISETUJUI");
  assert.equal((await w.f.post(`/api/finance/bills/${f.body.billId}/cancel`, { reason: "x" })).status, 403, "FINANCE tidak punya izin batalkan");
  assert.equal((await w.a.post(`/api/finance/bills/${f.body.billId}/cancel`, { reason: "salah faktur" })).status, 200);
});

// ═══ 8. VALIDASI, EDIT, KOREKSI, UNBILLED ═════════════════════════════════════════════════════════════════════
test("validasi faktur: nomor faktur wajib, jumlah 3 desimal/harga 2 desimal, tanpa baris ganda, supplier harus sama, PO draf ditolak, nominal dihitung dari baris", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  await penerimaan(w, po.id, { datang: 10, baik: 10 });
  const pl = po.lines[0].id;
  const kirim = (patch) => w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate: hariIni(), lines: [{ purchaseOrderLineId: pl, qty: 1, unitPrice: HARGA }], ...patch });
  assert.equal((await kirim({ supplierRef: "" })).status, 400);
  assert.equal((await kirim({ lines: [] })).status, 400);
  assert.equal((await kirim({ lines: [{ purchaseOrderLineId: pl, qty: 0, unitPrice: 1 }] })).status, 400);
  assert.equal((await kirim({ lines: [{ purchaseOrderLineId: pl, qty: 1.2345, unitPrice: 1 }] })).status, 400);
  assert.equal((await kirim({ lines: [{ purchaseOrderLineId: pl, qty: 1, unitPrice: 0 }] })).status, 400);
  assert.equal((await kirim({ lines: [{ purchaseOrderLineId: pl, qty: 1, unitPrice: 1.234 }] })).status, 400);
  assert.equal((await kirim({ lines: [{ purchaseOrderLineId: pl, qty: 1, unitPrice: 1 }, { purchaseOrderLineId: pl, qty: 1, unitPrice: 1 }] })).status, 400);
  assert.equal((await kirim({ lines: [{ purchaseOrderLineId: randomUUID(), qty: 1, unitPrice: 1 }] })).status, 400);
  const lain = await testPrisma.finSupplier.create({ data: { code: "SUP-LAIN", name: "Supplier Lain" } });
  assert.equal((await kirim({ supplierId: lain.id })).status, 400);
  const salah = await kirim({ amount: 999 });
  assert.equal(salah.status, 400);
  assert.equal(salah.body.code, "NOMINAL_TIDAK_SAMA");
  const benar = await kirim({ amount: HARGA });
  assert.equal(benar.status, 201);
  assert.equal(benar.body.amount, HARGA);

  const draf = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 1, unitPrice: HARGA }] });
  assert.equal((await w.f.post(`/api/finance/purchase-orders/${draf.body.id}/faktur`, { supplierRef: "D", lines: [{ purchaseOrderLineId: draf.body.lines[0].id, qty: 1, unitPrice: HARGA }] })).status, 409);
});

test("edit faktur yang belum disetujui lewat PATCH faktur (nominal dihitung ulang); PATCH tagihan biasa tidak boleh menyentuh nominal; koreksi faktur atas PO diblokir", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  await penerimaan(w, po.id, { datang: 8, baik: 8 });
  const f = await buatFaktur(w, po, { qty: 10 });
  assert.equal(f.body.tertahan, true);
  assert.equal((await w.f.patch(`/api/finance/purchase-orders/faktur/${f.body.billId}`, { lines: [{ purchaseOrderLineId: po.lines[0].id, qty: 8, unitPrice: HARGA }] })).status, 400, "alasan wajib");
  const ubah = await w.f.patch(`/api/finance/purchase-orders/faktur/${f.body.billId}`, { reason: "Faktur dikoreksi supplier", supplierRef: "FAK-REV", lines: [{ purchaseOrderLineId: po.lines[0].id, qty: 8, unitPrice: HARGA }] });
  assert.equal(ubah.status, 200, JSON.stringify(ubah.body));
  assert.equal(ubah.body.tertahan, false);
  assert.equal(ubah.body.amount, 8 * HARGA);
  assert.equal(ubah.body.supplierRef, "FAK-REV");

  const tolakNominal = await w.f.patch(`/api/finance/bills/${f.body.billId}`, { reason: "x", amount: 1 });
  assert.equal(tolakNominal.status, 409);
  assert.equal((await w.f.patch(`/api/finance/bills/${f.body.billId}`, { reason: "uraian", description: "Lem rutin Oktober" })).status, 200, "data administratif tetap bisa diedit");

  assert.equal((await setujui(w, f.body.billId)).status, 200);
  assert.equal((await w.f.patch(`/api/finance/purchase-orders/faktur/${f.body.billId}`, { reason: "x", lines: [{ purchaseOrderLineId: po.lines[0].id, qty: 1, unitPrice: HARGA }] })).status, 409, "sudah masuk buku");
  const blokir = (await blokirKoreksiTagihanBatch(testPrisma, [f.body.billId])).get(f.body.billId);
  assert.equal(blokir.kode, "FAKTUR_ATAS_PO");
});

test("tagihan lama (satu penerimaan) dan faktur atas PO tidak saling menagih ulang penerimaan yang sama; alur lama tidak berubah", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const g1 = await penerimaan(w, po.id, { datang: 4, baik: 4 });
  const g2 = await penerimaan(w, po.id, { datang: 6, baik: 6 });

  // tagihan LAMA menaut penerimaan 1 → menutup GRNI seluruh penerimaan (alur lama persis)
  const lama = await w.a.post("/api/finance/bills", { supplierId: w.supplier.id, supplierRef: "LAMA-1", billDate: hariIni(), amount: 4 * HARGA, description: "Lem penerimaan 1", billType: "BAHAN_BAKU", goodsReceiptId: g1.id });
  assert.equal(lama.status, 201, JSON.stringify(lama.body));
  assert.equal((await w.a.post(`/api/finance/bills/${lama.body.id}/approve`, {})).status, 200);
  assert.equal(await saldoAkun("2-1150"), -(6 * HARGA));

  // faktur atas PO untuk 10: hanya 6 yang tersedia (4 sudah ditagih lewat tagihan lama)
  const f = await buatFaktur(w, po, { qty: 10 });
  assert.equal(f.body.tertahan, true);
  assert.equal(f.body.barisFaktur[0].sudahDitagih, 4);
  const f6 = await buatFaktur(w, po, { qty: 6 });
  assert.equal((await setujui(w, f6.body.billId)).status, 200);
  assert.equal(await saldoAkun("2-1150"), 0);

  // tagihan lama atas penerimaan 2 sesudah faktur atas PO mengklaimnya → ditolak
  const lama2 = await w.a.post("/api/finance/bills", { supplierId: w.supplier.id, supplierRef: "LAMA-2", billDate: hariIni(), amount: 6 * HARGA, description: "Lem penerimaan 2", billType: "BAHAN_BAKU", goodsReceiptId: g2.id });
  assert.equal(lama2.status, 201);
  const tolak = await w.a.post(`/api/finance/bills/${lama2.body.id}/approve`, {});
  assert.equal(tolak.status, 409);
  assert.equal(tolak.body.code, "PENERIMAAN_SUDAH_DITAGIH");
});

test("daftar penerimaan belum ditagih: penerimaan sebagian ditagih tetap tampil, yang habis teralokasi hilang", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const g = await penerimaan(w, po.id, { datang: 10, baik: 10 });
  const daftar = async () => (await w.a.get("/api/finance/bills/unbilled-receipts")).body.receipts.map((r) => r.id);
  assert.ok((await daftar()).includes(g.id));
  const a = await buatFaktur(w, po, { qty: 4 });
  await setujui(w, a.body.billId);
  assert.ok((await daftar()).includes(g.id), "masih ada sisa 6 belum ditagih");
  const b = await buatFaktur(w, po, { qty: 6 });
  await setujui(w, b.body.billId);
  assert.ok(!(await daftar()).includes(g.id), "seluruhnya sudah teralokasi");
});

test("penagihan PO: pandangan per baris dan penerimaan (dipesan, diterima baik, sudah ditagih, tersedia)", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  await penerimaan(w, po.id, { datang: 9, baik: 8, tolak: 1 });
  const f = await buatFaktur(w, po, { qty: 3 });
  await setujui(w, f.body.billId);
  const p = (await w.f.get(`/api/finance/purchase-orders/${po.id}/penagihan`)).body;
  assert.equal(p.bisaDifakturkan, true);
  const l = p.barisPO[0];
  assert.deepEqual([l.dipesan, l.diterimaBaik, l.sudahDitagih, l.tersedia, l.hargaPO], [10, 8, 3, 5, HARGA]);
  assert.equal(p.penerimaan.length, 1);
  assert.deepEqual([p.penerimaan[0].diterimaBaik, p.penerimaan[0].sudahDitagih, p.penerimaan[0].tersedia], [8, 3, 5]);
  assert.equal(p.fakturTerbuka.length, 0);
});

// ═══ 9. PARITAS JURNAL DENGAN ALUR LAMA ═════════════════════════════════════════════════════════════════════════
test("paritas: faktur atas PO dan tagihan lama atas penerimaan yang sama nilainya menghasilkan bentuk jurnal yang identik (Dr GRNI / Cr Utang Usaha)", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const g = await penerimaan(w, po.id, { datang: 10, baik: 10 });
  const lamaPath = await w.a.post("/api/finance/bills", { supplierId: w.supplier.id, supplierRef: "PAR-LAMA", billDate: hariIni(), amount: 10 * HARGA, description: "Paritas lama", billType: "BAHAN_BAKU", goodsReceiptId: g.id });
  assert.equal((await w.a.post(`/api/finance/bills/${lamaPath.body.id}/approve`, {})).status, 200);
  const jLama = (await jurnalTagihan(lamaPath.body.id)).map((l) => [l.kode, l.debit, l.kredit]);
  // membatalkan tagihan lama → penerimaan kembali belum ditagih, lalu tagih lewat PO
  assert.equal((await w.a.post(`/api/finance/bills/${lamaPath.body.id}/cancel`, { reason: "paritas" })).status, 200);
  const f = await buatFaktur(w, po, { qty: 10 });
  assert.equal((await setujui(w, f.body.billId)).status, 200);
  const jPo = (await jurnalTagihan(f.body.billId)).map((l) => [l.kode, l.debit, l.kredit]);
  assert.deepEqual(jPo.sort(), jLama.sort());
});

// ═══ 10. PRESISI 3 DESIMAL & ALOKASI GRNI ═══════════════════════════════════════════════════════════════════════
// Audit Gudang produksi (8 Okt 2026): satuan KG/SHEET/ROLL/CAN/METER memakai pecahan hingga 1 desimal; ledger stok Decimal(12,4); PO/faktur Decimal(14,3).
// Pecahan 3 desimal tidak boleh diturunkan presisinya, dan penutupan GRNI per alokasi harus menjumlah TEPAT ke nilai stok baris penerimaan.
const H3 = 43_291; // 0,125 × 43.291 = 5.411,375 → pembulatan SATU kali ke 5.411,38

test("qty eksak: penerimaan 0,125 KG × 43.291 dinilai 5.411,38 (bukan qty dibulatkan 0,13 × 43.291); PO/faktur menerima 3 desimal, menolak 4", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 0.125, harga: H3 });
  assert.equal(po.lines[0].dipesan, 0.125);
  await penerimaan(w, po.id, { datang: 0.125, baik: 0.125 });
  assert.equal(await saldoAkun("1-1400"), 5411.38);
  assert.equal(await saldoAkun("2-1150"), -5411.38);
  const l4 = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 1.2345, unitPrice: 1000 }] });
  assert.equal(l4.status, 400);
  const f4 = await buatFaktur(w, po, { qty: 0.1234 });
  assert.equal(f4.status, 400);
});

test("alokasi GRNI: 3 faktur x 0,125 atas satu baris 0,375 -> nilai alokasi 5.411,38 + 5.411,38 + sisa 5.411,37 = nilai stok 16.234,13; GRNI tepat nol", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 0.375, harga: H3 });
  await penerimaan(w, po.id, { datang: 0.375, baik: 0.375 });
  assert.equal(await saldoAkun("1-1400"), 16234.13);
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const f = await buatFaktur(w, po, { qty: 0.125, harga: H3 });
    assert.equal(f.status, 201, JSON.stringify(f.body));
    const ok = await setujui(w, f.body.billId);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    ids.push(f.body.billId);
  }
  const nilai = [];
  for (const id of ids) nilai.push(Number((await testPrisma.finSupplierBillAllocation.findFirst({ where: { billId: id } })).poValue));
  assert.deepEqual(nilai, [5411.38, 5411.38, 5411.37]);
  assert.equal(await saldoAkun("2-1150"), 0, "GRNI tepat nol (tanpa sisa sen)");
  // Faktur 0,125 x 43.291 = 5.411,375 -> 5.411,38 per faktur (pembulatan SATU kali per baris, seperti faktur supplier); tiga faktur = 16.234,14 vs nilai stok 16.234,13:
  // selisih 1 sen masuk Selisih Harga Pembelian lewat kebijakan existing (harga sama dengan PO, jadi tanpa tinjauan harga).
  assert.equal(await saldoAkun("2-1100"), -16234.14);
  assert.equal(await saldoAkun((await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.SELISIH_HARGA_PEMBELIAN } })).code), 0.01);
  const lagi = await buatFaktur(w, po, { qty: 0.001, harga: H3 });
  assert.equal((await setujui(w, lagi.body.billId)).status, 409, "tidak ada barang baik tersisa");
});

test("alokasi GRNI: batal faktur di tengah lalu tagih ulang tetap menutup GRNI tepat nol", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 0.375, harga: H3 });
  await penerimaan(w, po.id, { datang: 0.375, baik: 0.375 });
  const a = await buatFaktur(w, po, { qty: 0.125, harga: H3 }); await setujui(w, a.body.billId);
  const b = await buatFaktur(w, po, { qty: 0.125, harga: H3 }); await setujui(w, b.body.billId);
  const c = await buatFaktur(w, po, { qty: 0.125, harga: H3 }); await setujui(w, c.body.billId);
  assert.equal((await w.a.post(`/api/finance/bills/${a.body.billId}/cancel`, { reason: "salah faktur" })).status, 200);
  assert.equal(await saldoAkun("2-1150"), -5411.38, "klaim A dilepas: nilai A kembali ke GRNI");
  const d = await buatFaktur(w, po, { qty: 0.125, harga: H3 });
  assert.equal((await setujui(w, d.body.billId)).status, 200);
  assert.equal(await saldoAkun("2-1150"), 0);
  // Faktur 0,125 x 43.291 = 5.411,375 -> 5.411,38 per faktur (pembulatan SATU kali per baris, seperti faktur supplier); tiga faktur = 16.234,14 vs nilai stok 16.234,13:
  // selisih 1 sen masuk Selisih Harga Pembelian lewat kebijakan existing (harga sama dengan PO, jadi tanpa tinjauan harga).
  assert.equal(await saldoAkun("2-1100"), -16234.14);
  assert.equal(await saldoAkun((await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.SELISIH_HARGA_PEMBELIAN } })).code), 0.01);
  const aktif = await testPrisma.finSupplierBillAllocation.findMany({ where: { bill: { status: { in: ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"] } } } });
  assert.equal(Math.round(aktif.reduce((s, x) => s + Number(x.poValue), 0) * 100), 1623413, "jumlah nilai alokasi aktif = nilai stok baris");
});

test("penerimaan parsial 3 desimal: 0,333 + 0,333 + 0,334 untuk PO 1; satu faktur gabungan menutup GRNI nol", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 1, harga: H3 });
  await penerimaan(w, po.id, { jadwal: 0.333, datang: 0.333, baik: 0.333 });
  await penerimaan(w, po.id, { jadwal: 0.333, datang: 0.333, baik: 0.333 });
  await penerimaan(w, po.id, { jadwal: 0.334, datang: 0.334, baik: 0.334 });
  const d = (await w.f.get(`/api/finance/purchase-orders/${po.id}`)).body;
  assert.equal(d.status, "SELESAI");
  assert.equal(d.lines[0].diterimaBaik, 1);
  const f = await buatFaktur(w, po, { qty: 1, harga: H3 });
  assert.equal(f.body.tertahan, false);
  assert.equal((await setujui(w, f.body.billId)).status, 200);
  assert.equal(await saldoAkun("2-1150"), 0);
  // Nilai stok dibulatkan per penerimaan: 14.415,90 + 14.415,90 + 14.459,19 = 43.290,99 (bukan 43.291); faktur 43.291 -> selisih 1 sen ke Selisih Harga Pembelian.
  assert.equal(await saldoAkun("1-1400"), 43290.99);
  assert.equal(await saldoAkun("2-1100"), -H3);
  assert.equal(await saldoAkun((await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.SELISIH_HARGA_PEMBELIAN } })).code), 0.01);
  assert.equal(await testPrisma.finSupplierBillAllocation.count({ where: { billId: f.body.billId } }), 3);
});

test("penerimaan tertaut PO menolak jumlah datang/baik/ditolak lebih dari 3 desimal", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const gr = await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.id });
  await w.g.patch(`/api/inventory/goods-receipts/${gr.body.id}`, { status: "SCHEDULED" });
  const L = gr.body.lines[0].purchaseOrderLineId;
  const tiba = await catatTibaResmi(w.g, { poId: po.id, receiptId: gr.body.id, lines: [{ purchaseOrderLineId: L, jumlahDatang: 1.2345 }] });
  assert.equal(tiba.status, 400); assert.match(tiba.body.error, /3 angka/);
  assert.equal((await catatTibaResmi(w.g, { poId: po.id, receiptId: gr.body.id, lines: [{ purchaseOrderLineId: L, jumlahDatang: 2 }] })).status, 201);
  await w.g.patch(`/api/inventory/goods-receipts/${gr.body.id}`, { status: "INSPECTION" });
  const r = await w.g.patch(`/api/inventory/goods-receipts/${gr.body.id}/lines/${gr.body.lines[0].id}`, { acceptedQty: 1.2345 });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /3 angka/);
});

// ═══ 11. PEMBATALAN FAKTUR PO: DIBAYAR, DIREKONSILIASI, PERIODE TERTUTUP ════════════════════════════════════════
async function fakturDisetujui(w, { qty = 8 } = {}) {
  const po = await poDisetujui(w, { qty: 10 });
  await penerimaan(w, po.id, { datang: qty, baik: qty });
  const f = await buatFaktur(w, po, { qty });
  assert.equal((await setujui(w, f.body.billId)).status, 200);
  return { po, billId: f.body.billId, qty };
}
/** true = klaim masih utuh (faktur baru atas qty yang sama tertahan); false = klaim lepas. Faktur uji ditolak kembali. */
async function klaimUtuh(w, po, qty) {
  const g = await buatFaktur(w, po, { qty });
  const e = await ev(w, g.body.billId);
  await w.a.post(`/api/finance/bills/${g.body.billId}/reject`, { reason: "uji" });
  return e.tertahan;
}
const statusTagihan = async (id) => (await testPrisma.finSupplierBill.findUnique({ where: { id } })).status;
const jurnalAktifTagihan = (id) => testPrisma.finJournalEntry.count({ where: { source: "TAGIHAN_SUPPLIER", sourceId: id, status: "POSTED", idempotencyKey: { startsWith: "TAGIHAN_SUPPLIER:" } } });

test("pembatalan faktur PO yang sudah DIBAYAR ditolak (klaim utuh); setelah pembayaran dibatalkan lewat alur resmi, pembatalan sah melepas klaim", async () => {
  const w = await dunia();
  const { po, billId, qty } = await fakturDisetujui(w);
  const bayar = await w.a.post("/api/finance/supplier-payments", { supplierId: w.supplier.id, date: hariIni(), cashAccountId: w.bank.id, allocations: [{ billId, amount: qty * HARGA }] });
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  const tolak = await w.a.post(`/api/finance/bills/${billId}/cancel`, { reason: "salah" });
  assert.equal(tolak.status, 409);
  assert.match(tolak.body.error, /pembayaran aktif/);
  assert.equal(await statusTagihan(billId), "LUNAS");
  assert.equal(await jurnalAktifTagihan(billId), 1);
  assert.equal(await testPrisma.finSupplierBillAllocation.count({ where: { billId } }), 1);
  assert.equal(await klaimUtuh(w, po, qty), true, "klaim tetap utuh");

  const batalBayar = await w.a.post(`/api/finance/supplier-payments/${bayar.body.id}/cancel`, { reason: "salah rekening" });
  assert.equal(batalBayar.status, 200, JSON.stringify(batalBayar.body));
  assert.equal(await klaimUtuh(w, po, qty), true, "membatalkan pembayaran TIDAK melepas klaim barang");
  const batal = await w.a.post(`/api/finance/bills/${billId}/cancel`, { reason: "faktur keliru" });
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  assert.equal(await klaimUtuh(w, po, qty), false, "klaim lepas setelah pembatalan sah");
  assert.equal(await saldoAkun("2-1150"), -(qty * HARGA));
  assert.equal(await saldoAkun("2-1100"), 0);
});

test("pembatalan faktur PO yang jurnalnya sudah DIREKONSILIASI ditolak (jurnal tetap, klaim utuh); setelah pencocokan dilepas, pembatalan sah", async () => {
  const w = await dunia();
  const { po, billId, qty } = await fakturDisetujui(w);
  const baris = await testPrisma.finJournalLine.findFirst({ where: { entry: { source: "TAGIHAN_SUPPLIER", sourceId: billId } } });
  const st = await testPrisma.finBankStatement.create({ data: { cashAccountId: w.bank.id, periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31"), openingBalance: 0, closingBalance: 0, status: "DRAFT" } });
  const sl = await testPrisma.finBankStatementLine.create({ data: { statementId: st.id, date: new Date("2026-10-05"), description: "x", amount: 1, status: "COCOK", matchedLineId: baris.id } });
  const tolak = await w.a.post(`/api/finance/bills/${billId}/cancel`, { reason: "salah" });
  assert.equal(tolak.status, 409);
  assert.equal(tolak.body.code, "SUDAH_DIREKONSILIASI");
  assert.equal(await statusTagihan(billId), "DISETUJUI");
  assert.equal(await jurnalAktifTagihan(billId), 1);
  assert.equal(await klaimUtuh(w, po, qty), true);
  await testPrisma.finBankStatementLine.update({ where: { id: sl.id }, data: { matchedLineId: null, status: "BELUM_COCOK" } });
  assert.equal((await w.a.post(`/api/finance/bills/${billId}/cancel`, { reason: "salah" })).status, 200);
  assert.equal(await klaimUtuh(w, po, qty), false);
});

test("pembatalan faktur PO di periode tertutup: bila pembalikan ditolak SELURUH pembatalan batal (status, jurnal, klaim utuh); setelah periode dibuka, sah", async () => {
  const w = await dunia();
  const { po, billId, qty } = await fakturDisetujui(w);
  const hari = new Date(`${hariIni()}T00:00:00.000Z`);
  const y = hari.getUTCFullYear(); const m = hari.getUTCMonth() + 1;
  await testPrisma.finPeriod.upsert({ where: { year_month: { year: y, month: m } }, update: { status: "CLOSED" }, create: { year: y, month: m, status: "CLOSED" } });
  const sebelum = { jurnal: await testPrisma.finJournalEntry.count(), alok: await testPrisma.finSupplierBillAllocation.count() };
  const tolak = await w.a.post(`/api/finance/bills/${billId}/cancel`, { reason: "salah" });
  assert.ok(tolak.status >= 400 && tolak.status < 500, `harus ditolak, dapat ${tolak.status} ${JSON.stringify(tolak.body)}`);
  assert.equal(await statusTagihan(billId), "DISETUJUI");
  assert.equal(await jurnalAktifTagihan(billId), 1);
  assert.equal(await testPrisma.finJournalEntry.count(), sebelum.jurnal, "tidak ada jurnal pembalik setengah jadi");
  assert.equal(await testPrisma.finSupplierBillAllocation.count(), sebelum.alok);
  await testPrisma.finPeriod.update({ where: { year_month: { year: y, month: m } }, data: { status: "OPEN" } });
  assert.equal(await klaimUtuh(w, po, qty), true, "klaim utuh");
  assert.equal((await w.a.post(`/api/finance/bills/${billId}/cancel`, { reason: "salah" })).status, 200);
  assert.equal(await klaimUtuh(w, po, qty), false);
});

test("pembatalan paralel dua kali pada faktur PO yang sama: satu berhasil, satu 409; saldo GRNI kembali sekali", async () => {
  const w = await dunia();
  const { po, billId, qty } = await fakturDisetujui(w);
  const [r1, r2] = await Promise.all([
    w.a.post(`/api/finance/bills/${billId}/cancel`, { reason: "paralel 1" }),
    w.a.post(`/api/finance/bills/${billId}/cancel`, { reason: "paralel 2" }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal(await saldoAkun("2-1150"), -(qty * HARGA));
  assert.equal(await saldoAkun("2-1100"), 0);
  assert.equal(await klaimUtuh(w, po, qty), false);
});
