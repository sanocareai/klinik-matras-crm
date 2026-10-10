// TERMIN PEMBAYARAN & AGING UTANG SUPPLIER.
// Yang dikunci: (1) termin master supplier + snapshot di PO/faktur (master berubah → dokumen lama tetap); override = finance:admin + alasan; (2) alur barang-faktur-utang-pembayaran:
// PO tanpa jurnal, Simpan ke Stok tepat sekali, faktur membuat Utang tanpa menambah stok, pembayaran mengurangi utang & bank tepat sekali, biaya transfer terpisah;
// (3) aging menurut TANGGAL JATUH TEMPO (bukan tanggal barang datang), tiga status terpisah, tanpa tebak jatuh tempo data lama; (4) pembayaran sebagian, kelebihan bayar ditolak,
// paralel & replay Idempotency-Key, pembatalan = reversal; (5) izin; (6) export = layar.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { bawaSampaiSiap, catatTibaResmi } from "./setup/kedatangan.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { toMoney } from "../../src/services/finance/money.js";
import { tentukanTerminDokumen, hitungJatuhTempo, TerminError } from "../../src/services/finance/termin.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const H = 43_290;
const kunci = () => ({ "Idempotency-Key": `tm-${randomUUID()}` });
const geser = (hari, dari = new Date()) => new Date(dari.getTime() + 7 * 3600 * 1000 + hari * 86_400_000).toISOString().slice(0, 10);
const hariIni = () => geser(0);
let nomor = 0;
const ref = () => `FAK-T${String(++nomor).padStart(4, "0")}`;

async function dunia(supplierData = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  await testPrisma.finSetting.upsert({ where: { key: "inventory_perpetual_cutover_date" }, update: { value: "" }, create: { key: "inventory_perpetual_cutover_date", value: "" } });
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const gudang = await createTestUser({ roles: ["WAREHOUSE"] });
  const prod = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const approver = await createTestUser({ roles: ["APPROVER"] });
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-ESA", name: "PT ESA BUMINDO", paymentTermType: "HARI", paymentTermDays: 30, ...supplierData } });
  const lem = await createTestMaterial({ code: "LEM-1037", name: "LEM I-SR 1037 13 KG", unit: "KG" });
  return { f: c(fin), a: c(admin), g: c(gudang), p: c(prod), s: c(sales), ap: c(approver), fin, admin, gudang, prod, sales, approver, bank, supplier, lem };
}
async function poDisetujui(w, { qty = 10, harga = H, extra = {} } = {}) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty, unitPrice: harga }], ...extra });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}
async function penerimaan(w, poId, { datang, baik, tolak = 0, putaway = true, tanggal = null }) {
  const gr = await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: poId });
  assert.equal(gr.status, 201, JSON.stringify(gr.body));
  await bawaSampaiSiap(w.g, gr.body, { datang, baik, tolak, tanggal });
  if (putaway) assert.equal((await w.g.post(`/api/inventory/goods-receipts/${gr.body.id}/putaway`, {})).status, 200);
  if (tanggal) await testPrisma.goodsReceipt.update({ where: { id: gr.body.id }, data: { receivedDate: new Date(`${tanggal}T00:00:00Z`) } });
  return gr.body;
}
const faktur = (w, po, { qty, harga = H, billDate = hariIni(), extra = {}, klien = null } = {}) =>
  (klien ?? w.f).post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate, lines: [{ purchaseOrderLineId: po.lines[0].id, qty, unitPrice: harga }], ...extra });
const setujui = (w, id, body = {}) => w.ap.post(`/api/finance/bills/${id}/approve`, body);
const bayar = (w, billId, amount, extra = {}, headers) => w.a.post("/api/finance/supplier-payments", { supplierId: w.supplier.id, date: hariIni(), cashAccountId: w.bank.id, allocations: [{ billId, amount }], ...extra }, headers);
const aging = async (w, q = "") => (await w.f.get(`/api/finance/utang/aging${q}`)).body;
const barisBill = (j, billId) => j.baris.find((b) => b.billId === billId);

async function saldo(systemKey) {
  const a = await testPrisma.finAccount.findUnique({ where: systemKey === "GRNI" ? { code: "2-1150" } : { systemKey } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: a.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return toMoney(agg._sum.debit || 0).minus(toMoney(agg._sum.credit || 0)).toNumber();
}
async function cacah() {
  const j = await testPrisma.finJournalLine.aggregate({ _sum: { debit: true, credit: true } });
  return { stok: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), d: String(j._sum.debit ?? 0), k: String(j._sum.credit ?? 0), bayar: await testPrisma.finSupplierPayment.count() };
}
async function billLegacy(w, { dueDate, amount = 1_000_000, status = "DISETUJUI", billDate = geser(-10), ref: r = ref() }) {
  return testPrisma.finSupplierBill.create({ data: { billNumber: `BILL-LGC-${++nomor}`, supplierRef: r, supplierId: w.supplier.id, billDate: new Date(`${billDate}T00:00:00Z`), dueDate: dueDate ? new Date(`${dueDate}T00:00:00Z`) : null, amount, description: "Tagihan lama", status, billType: "JASA_OPERASIONAL" } });
}

// ═══ UNIT: aturan termin ════════════════════════════════════════════════════════════════════════════════════════════
test("aturan termin: Tunai = tanggal faktur, 7/14/30/45/60 hari + tanggal faktur, tanggal khusus apa adanya; override = admin + alasan; tanpa termin = tidak menebak", () => {
  const tgl = new Date("2026-10-01T00:00:00Z");
  assert.equal(hitungJatuhTempo({ jenis: "TUNAI", hari: 0 }, tgl).toISOString().slice(0, 10), "2026-10-01");
  for (const [hari, hasil] of [[7, "2026-10-08"], [14, "2026-10-15"], [30, "2026-10-31"], [45, "2026-11-15"], [60, "2026-11-30"]]) assert.equal(hitungJatuhTempo({ jenis: "HARI", hari }, tgl).toISOString().slice(0, 10), hasil);
  assert.equal(hitungJatuhTempo({ jenis: "TANGGAL_KHUSUS" }, tgl, "2026-12-25").toISOString().slice(0, 10), "2026-12-25");
  assert.equal(hitungJatuhTempo({ jenis: "TANGGAL_KHUSUS" }, tgl), null);
  const sup = { paymentTermType: "HARI", paymentTermDays: 30 };
  // default
  const d = tentukanTerminDokumen({ supplier: sup, tanggalFaktur: tgl, userId: "u1" });
  assert.equal(d.dueDate.toISOString().slice(0, 10), "2026-10-31");
  assert.deepEqual([d.snapshot.termType, d.snapshot.termDays, d.snapshot.termBasis, d.snapshot.termSource], ["HARI", 30, "TANGGAL_FAKTUR", "MASTER_SUPPLIER"]);
  // tanggal sama dengan hasil termin → bukan override
  assert.equal(tentukanTerminDokumen({ supplier: sup, tanggalFaktur: tgl, masukan: { dueDate: "2026-10-31" } }).snapshot.termSource, "MASTER_SUPPLIER");
  // override tanpa izin / tanpa alasan
  assert.throws(() => tentukanTerminDokumen({ supplier: sup, tanggalFaktur: tgl, masukan: { dueDate: "2026-11-15", alasan: "x" } }), (e) => e instanceof TerminError && e.code === "TERMIN_OVERRIDE_TIDAK_BERHAK");
  assert.throws(() => tentukanTerminDokumen({ supplier: sup, tanggalFaktur: tgl, masukan: { terminJenis: "HARI", terminHari: 14 }, boleh: { override: true } }), (e) => e.code === "TERMIN_ALASAN_WAJIB");
  const o = tentukanTerminDokumen({ supplier: sup, tanggalFaktur: tgl, masukan: { terminJenis: "HARI", terminHari: 14, alasan: "Nego" }, boleh: { override: true }, userId: "u2" });
  assert.deepEqual([o.dueDate.toISOString().slice(0, 10), o.snapshot.termSource, o.snapshot.termOverrideReason, o.snapshot.termSetById], ["2026-10-15", "OVERRIDE_FAKTUR", "Nego", "u2"]);
  // hari di luar pilihan resmi ditolak
  assert.throws(() => tentukanTerminDokumen({ supplier: sup, tanggalFaktur: tgl, masukan: { terminJenis: "HARI", terminHari: 21, alasan: "x" }, boleh: { override: true } }), (e) => e instanceof TerminError);
  // supplier tanpa termin: tidak menebak; tanggal diketik = normal (tanpa alasan/izin)
  const tanpa = tentukanTerminDokumen({ supplier: {}, tanggalFaktur: tgl });
  assert.equal(tanpa.dueDate, null); assert.equal(tanpa.snapshot.termType, null);
  assert.equal(tentukanTerminDokumen({ supplier: {}, tanggalFaktur: tgl, masukan: { dueDate: "2026-11-02" } }).dueDate.toISOString().slice(0, 10), "2026-11-02");
  // data lama: hanya paymentTermDays → dibaca HARI
  assert.equal(tentukanTerminDokumen({ supplier: { paymentTermDays: 21 }, tanggalFaktur: tgl }).dueDate.toISOString().slice(0, 10), "2026-10-22");
});

// ═══ MASTER SUPPLIER + SNAPSHOT ═════════════════════════════════════════════════════════════════════════════════════
test("master supplier: pilihan termin resmi tersimpan; hari di luar pilihan ditolak; PO & faktur menyimpan snapshot — mengubah master TIDAK mengubah dokumen lama", async () => {
  const w = await dunia({ paymentTermType: null, paymentTermDays: null });
  for (const [t, hari] of [["TUNAI", null], ["HARI", 7], ["HARI", 14], ["HARI", 30], ["HARI", 45], ["HARI", 60], ["TANGGAL_KHUSUS", null]]) {
    const r = await w.f.post("/api/finance/suppliers", { name: `Sup ${t}${hari ?? ""}`, paymentTermType: t, paymentTermDays: hari });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.paymentTermType, t); assert.equal(r.body.paymentTermDays, t === "HARI" ? hari : null);
  }
  assert.equal((await w.f.post("/api/finance/suppliers", { name: "Sup 21", paymentTermType: "HARI", paymentTermDays: 21 })).status, 400);
  assert.equal((await w.f.post("/api/finance/suppliers", { name: "Sup X", paymentTermType: "NGAWUR" })).status, 400);
  assert.equal((await testPrisma.finSupplier.count({ where: { name: { in: ["Sup 21", "Sup X"] } } })).valueOf(), 0);
  const ubah = await w.f.patch(`/api/finance/suppliers/${w.supplier.id}`, { paymentTermType: "HARI", paymentTermDays: 30 });
  assert.equal(ubah.status, 200, JSON.stringify(ubah.body));
  const daftar = (await w.f.get("/api/finance/suppliers")).body.suppliers.find((s) => s.id === w.supplier.id);
  assert.equal(daftar.paymentTermType, "HARI");

  // PO mewarisi snapshot; faktur memakai snapshot PO
  const po = await poDisetujui(w);
  const poRow = await testPrisma.finPurchaseOrder.findUnique({ where: { id: po.id } });
  assert.deepEqual([poRow.termType, poRow.termDays, poRow.termSource], ["HARI", 30, "MASTER_SUPPLIER"]);
  const detailPo = (await w.f.get(`/api/finance/purchase-orders/${po.id}`)).body;
  assert.equal(detailPo.termin.label, "30 hari");
  // Gudang tidak melihat termin
  const gudangPo = (await w.g.get(`/api/inventory/purchase-orders/${po.id}`)).body;
  assert.equal(gudangPo?.termin, undefined);

  await penerimaan(w, po.id, { datang: 10, baik: 10 });
  const tglFaktur = geser(-3);
  const fk = await faktur(w, po, { qty: 10, billDate: tglFaktur });
  assert.equal(fk.status, 201, JSON.stringify(fk.body));
  const bill = await testPrisma.finSupplierBill.findUnique({ where: { id: fk.body.billId } });
  assert.equal(bill.dueDate.toISOString().slice(0, 10), geser(30), "jatuh tempo faktur atas PO = tanggal barang tiba + 30 hari (BUKAN tanggal faktur/PO)");
  assert.deepEqual([bill.termType, bill.termDays, bill.termBasis, bill.termSource, bill.termSetById], ["HARI", 30, "TANGGAL_TIBA", "PO", w.fin.user.id]);

  // master diubah → PO & faktur lama tidak berubah
  assert.equal((await w.f.patch(`/api/finance/suppliers/${w.supplier.id}`, { paymentTermType: "TUNAI", paymentTermDays: null })).status, 200);
  const poSesudah = await testPrisma.finPurchaseOrder.findUnique({ where: { id: po.id } });
  const billSesudah = await testPrisma.finSupplierBill.findUnique({ where: { id: bill.id } });
  assert.deepEqual([poSesudah.termType, poSesudah.termDays], ["HARI", 30]);
  assert.deepEqual([billSesudah.termType, billSesudah.termDays, billSesudah.dueDate.toISOString()], ["HARI", 30, bill.dueDate.toISOString()]);
  // PO baru memakai master baru
  const po2 = await poDisetujui(w);
  assert.deepEqual([(await testPrisma.finPurchaseOrder.findUnique({ where: { id: po2.id } })).termType], ["TUNAI"]);
});

test("override termin: Finance biasa ditolak 403, admin tanpa alasan 400, admin + alasan tersimpan (sumber, alasan, aktor, waktu); PO boleh diganti dengan aturan sama; tanggal khusus supplier tidak butuh alasan", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  await penerimaan(w, po.id, { datang: 10, baik: 10 });
  const tolak = await faktur(w, po, { qty: 5, extra: { dueDate: geser(60) } });
  assert.equal(tolak.status, 403, JSON.stringify(tolak.body));
  assert.equal(tolak.body.code, "TERMIN_OVERRIDE_TIDAK_BERHAK");
  assert.equal((await faktur(w, po, { qty: 5, extra: { terminJenis: "HARI", terminHari: 14 }, klien: w.a })).status, 400, "admin tanpa alasan");
  assert.equal((await faktur(w, po, { qty: 5, extra: { terminJenis: "HARI", terminHari: 21, alasanTermin: "x" }, klien: w.a })).status, 400, "hari di luar pilihan");
  const ok = await faktur(w, po, { qty: 5, extra: { terminJenis: "HARI", terminHari: 14, alasanTermin: "Nego dengan supplier" }, klien: w.a });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const b = await testPrisma.finSupplierBill.findUnique({ where: { id: ok.body.billId } });
  assert.deepEqual([b.termType, b.termDays, b.termSource, b.termOverrideReason, b.termSetById], ["HARI", 14, "OVERRIDE_FAKTUR", "Nego dengan supplier", w.admin.user.id]);
  assert.equal(b.dueDate.toISOString().slice(0, 10), geser(14));
  assert.ok(b.termSetAt);
  // detail aging menampilkan sumber + alasan + aktor
  await setujui(w, ok.body.billId);
  const d = (await w.f.get(`/api/finance/utang/aging/${ok.body.billId}`)).body;
  assert.deepEqual([d.termin.sumber, d.termin.alasanOverride, d.termin.oleh], ["OVERRIDE_FAKTUR", "Nego dengan supplier", w.admin.user.name]);

  // PO: override butuh admin + alasan
  const buatPo = (klien, extra) => klien.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 1, unitPrice: H }], ...extra });
  assert.equal((await buatPo(w.f, { terminJenis: "HARI", terminHari: 60, alasanTermin: "x" })).status, 403, "PO: Finance biasa ditolak");
  assert.equal((await buatPo(w.a, { terminJenis: "HARI", terminHari: 60 })).status, 400, "PO: alasan wajib");
  const poOk = await buatPo(w.a, { terminJenis: "HARI", terminHari: 60, alasanTermin: "Kontrak tahunan" });
  assert.equal(poOk.status, 201, JSON.stringify(poOk.body));
  const poRow = await testPrisma.finPurchaseOrder.findUnique({ where: { id: poOk.body.id } });
  assert.deepEqual([poRow.termDays, poRow.termSource, poRow.termOverrideReason], [60, "PO", "Kontrak tahunan"]);

  // supplier dengan TANGGAL_KHUSUS: mengetik tanggal = normal, tanpa alasan, dengan Finance biasa
  const khusus = await testPrisma.finSupplier.create({ data: { code: "SUP-KHS", name: "Supplier Khusus", paymentTermType: "TANGGAL_KHUSUS" } });
  const bill = await w.f.post("/api/finance/bills", { supplierId: khusus.id, billDate: hariIni(), dueDate: geser(21), amount: 500_000, description: "Jasa", billType: "JASA_OPERASIONAL", expenseCategoryId: (await testPrisma.finExpenseCategory.findFirst()).id });
  assert.equal(bill.status, 201, JSON.stringify(bill.body));
  const kr = await testPrisma.finSupplierBill.findUnique({ where: { id: bill.body.id } });
  assert.deepEqual([kr.termType, kr.termSource, kr.dueDate.toISOString().slice(0, 10)], ["TANGGAL_KHUSUS", "MASTER_SUPPLIER", geser(21)]);
});

test("pratinjau termin untuk formulir: default dihitung server; supplier tanpa termin meminta tanggal; PO beda supplier ditolak", async () => {
  const w = await dunia();
  const r = (await w.f.post("/api/finance/utang/termin/pratinjau", { supplierId: w.supplier.id, billDate: "2026-10-01" })).body;
  assert.deepEqual([r.ada, r.jenis, r.hari, r.label, r.sumber, r.dueDate, r.dasar], [true, "HARI", 30, "30 hari", "MASTER_SUPPLIER", "2026-10-31", "TANGGAL_FAKTUR"]);
  const kosong = await testPrisma.finSupplier.create({ data: { code: "SUP-0", name: "Tanpa Termin" } });
  const k = (await w.f.post("/api/finance/utang/termin/pratinjau", { supplierId: kosong.id, billDate: "2026-10-01" })).body;
  assert.deepEqual([k.ada, k.dueDate, k.perluTanggal], [false, null, true]);
  assert.equal((await w.s.post("/api/finance/utang/termin/pratinjau", { supplierId: w.supplier.id })).status, 403);
});

// ═══ ALUR BARANG – FAKTUR – UTANG – PEMBAYARAN ══════════════════════════════════════════════════════════════════════
test("alur penuh: PO tanpa jurnal → Simpan ke Stok sekali (Dr Persediaan/Cr GRNI) → barang dipakai sebelum dibayar → faktur Dr GRNI/Cr Utang tanpa stok → bayar sebagian (biaya transfer terpisah) → lunas", async () => {
  const w = await dunia();
  const awal = await cacah();
  const po = await poDisetujui(w, { qty: 10 });
  assert.deepEqual(await cacah(), awal, "PO tidak membuat stok/jurnal");

  // barang datang & diperiksa: stok belum berubah
  const gr = await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.id });
  await bawaSampaiSiap(w.g, gr.body, { datang: 10, baik: 10, tolak: 0 });
  assert.deepEqual(await cacah(), awal, "datang & diperiksa belum mengubah stok/jurnal");
  // Simpan ke Stok — klik ganda: sekali
  const ganda = await Promise.all([1, 2].map(() => w.g.post(`/api/inventory/goods-receipts/${gr.body.id}/putaway`, {})));
  assert.deepEqual(ganda.map((x) => x.status).sort(), [200, 400]);
  const sesudahStok = await cacah();
  assert.equal(sesudahStok.stok - awal.stok, 1); assert.equal(sesudahStok.jurnal - awal.jurnal, 1);
  assert.equal(await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), 10 * H);
  assert.equal(await saldo("GRNI"), -10 * H);

  // barang dipakai Produksi meskipun faktur belum ada/dibayar
  const unit = (await (await import("./setup/fixtures.js")).createTestUnit()).unit;
  const mi = await w.g.post("/api/inventory/material-issues", { sourceType: "PRODUCTION_WORK_ORDER", unitId: unit.id, lines: [{ materialId: w.lem.id, requestedQty: 4 }] });
  for (const st of ["WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"]) await w.g.patch(`/api/inventory/material-issues/${mi.body.id}`, { status: st });
  assert.equal((await w.g.post(`/api/inventory/material-issues/${mi.body.id}/issue`, {})).status, 200);

  // faktur: Utang lahir, stok tidak berubah
  const stokSebelumFaktur = (await cacah()).stok;
  const fk = await faktur(w, po, { qty: 10 });
  assert.equal(fk.status, 201, JSON.stringify(fk.body));
  assert.equal((await setujui(w, fk.body.billId)).status, 200);
  assert.equal((await cacah()).stok, stokSebelumFaktur, "faktur tidak menambah stok");
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -10 * H);
  assert.equal(await saldo("GRNI"), 0, "GRNI ditutup oleh faktur");

  // tiga status terpisah: barang SELESAI, faktur DISETUJUI, pembayaran belum jatuh tempo — meski barang sudah dipakai
  let j = await aging(w);
  let b = barisBill(j, fk.body.billId);
  assert.deepEqual([b.statusBarang, b.statusFaktur, b.statusPembayaran, b.kelompok], ["SELESAI", "DISETUJUI", "BELUM_JATUH_TEMPO", "LEBIH_30"].map((x, i) => (i === 3 ? "H15_30" : x)));
  assert.equal(b.sisaUtang, 10 * H);

  // bayar sebagian lewat transfer BI-FAST: Dr Utang jumlah, Cr bank jumlah+biaya, Dr beban admin = biaya
  const bank0 = await saldo(SYSTEM_KEYS.BANK);
  const p1 = await bayar(w, fk.body.billId, 4 * H, { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" });
  assert.equal(p1.status, 201, JSON.stringify(p1.body));
  const biaya = p1.body.transferFeeAmount;
  assert.ok(biaya > 0);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -6 * H, "utang berkurang tepat sebesar pembayaran (biaya transfer tidak mengurangi utang)");
  assert.equal(await saldo(SYSTEM_KEYS.BANK) - bank0, -(4 * H + biaya), "bank keluar = pembayaran + biaya transfer, sekali");
  assert.equal(await saldo(SYSTEM_KEYS.BEBAN_ADMIN_BANK), biaya, "biaya transfer = Dr Beban Administrasi Bank, bukan nilai bahan/faktur");
  assert.equal(await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), 6 * H, "persediaan = 10 − 4 dipakai Produksi; biaya transfer tidak menambah nilainya");
  const faktoBill = await testPrisma.finSupplierBill.findUnique({ where: { id: fk.body.billId } });
  assert.equal(Number(faktoBill.amount), 10 * H, "nilai faktur tidak berubah");
  assert.equal(faktoBill.status, "DIBAYAR_SEBAGIAN");

  j = await aging(w); b = barisBill(j, fk.body.billId);
  assert.deepEqual([b.dibayar, b.sisaUtang, b.dibayarSebagian, b.tanggalJatuhTempo, b.statusPembayaran], [4 * H, 6 * H, true, faktoBill.dueDate.toISOString().slice(0, 10), "DIBAYAR_SEBAGIAN"]);
  assert.equal(b.pembayaran.length, 1); assert.equal(b.pembayaran[0].biayaTransfer, biaya);
  assert.equal(b.rekeningPembayaran, "Bank Uji");

  // kelebihan bayar ditolak; sisa dilunasi
  const lebih = await bayar(w, fk.body.billId, 6 * H + 1);
  assert.equal(lebih.status, 400); assert.match(lebih.body.error, /melebihi sisa utang/);
  assert.equal((await bayar(w, fk.body.billId, 6 * H)).status, 201);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), 0);
  j = await aging(w, "?termasukLunas=1");
  b = barisBill(j, fk.body.billId);
  assert.deepEqual([b.kelompok, b.statusPembayaran, b.sisaUtang], ["LUNAS", "LUNAS", 0]);
  const akhir = await cacah(); seimbang(akhir);
});
function seimbang(c) { assert.equal(c.d, c.k, "jurnal seimbang"); }

test("pembayaran: dua pembayaran paralel melewati sisa → satu berhasil; Idempotency-Key yang sama diputar ulang tanpa jurnal ganda; kunci sama isi beda 422; pembatalan = reversal (riwayat tetap, sisa kembali)", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  await penerimaan(w, po.id, { datang: 10, baik: 10 });
  const fk = await faktur(w, po, { qty: 10 });
  await setujui(w, fk.body.billId);
  const nilai = 10 * H;

  const awal = await cacah();
  const paralel = await Promise.all([bayar(w, fk.body.billId, Math.round(nilai * 0.6)), bayar(w, fk.body.billId, Math.round(nilai * 0.6))]);
  assert.deepEqual(paralel.map((r) => r.status).sort(), [201, 400], JSON.stringify(paralel.map((r) => r.body)));
  assert.equal((await cacah()).jurnal - awal.jurnal, 1, "tepat satu jurnal pembayaran");
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -(nilai - Math.round(nilai * 0.6)));

  // replay kunci sama (isi sama)
  const k = kunci();
  const sisa = nilai - Math.round(nilai * 0.6);
  const p1 = await bayar(w, fk.body.billId, 1000, {}, k);
  assert.equal(p1.status, 201);
  const sebelumReplay = await cacah();
  const p2 = await bayar(w, fk.body.billId, 1000, {}, k);
  assert.equal(p2.status, 201); assert.equal(p2.headers.get("idempotent-replayed"), "true");
  assert.equal(p2.body.id, p1.body.id);
  assert.deepEqual(await cacah(), sebelumReplay, "replay tidak membuat pembayaran/jurnal baru");
  assert.equal((await bayar(w, fk.body.billId, 2000, {}, k)).status, 422, "kunci sama, isi beda");
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -(sisa - 1000));

  // pembatalan: reversal, baris pembayaran tetap, sisa kembali, jatuh tempo tidak berubah
  const dueSebelum = (await testPrisma.finSupplierBill.findUnique({ where: { id: fk.body.billId } })).dueDate.toISOString();
  const batal = await w.a.post(`/api/finance/supplier-payments/${p1.body.id}/cancel`, { reason: "Salah rekening" });
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  assert.ok(await testPrisma.finSupplierPayment.findUnique({ where: { id: p1.body.id } }), "baris pembayaran tidak dihapus");
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -sisa, "utang kembali (reversal)");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { status: "REVERSED" } }) >= 1, true);
  assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: fk.body.billId } })).dueDate.toISOString(), dueSebelum);
  seimbang(await cacah());
  // Finance biasa tidak boleh membatalkan
  assert.equal((await w.f.post(`/api/finance/supplier-payments/${paralel.find((r) => r.status === 201).body.id}/cancel`, { reason: "x" })).status, 403);
});

// ═══ AGING ══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("aging menurut TANGGAL JATUH TEMPO (bukan tanggal barang datang): kelompok, kartu = jumlah baris, urutan prioritas, data lama tanpa jatuh tempo tidak ditebak", async () => {
  const w = await dunia();
  // A: barang tiba 31 hari lalu, termin 30 hari dari TANGGAL TIBA → jatuh tempo kemarin → TERLAMBAT
  const poA = await poDisetujui(w, { extra: { orderDate: geser(-40) } }); await penerimaan(w, poA.id, { datang: 10, baik: 10, tanggal: geser(-31) });
  const A = await faktur(w, poA, { qty: 10 });
  await setujui(w, A.body.billId);
  // B: barang tiba 10 hari lalu, termin 45 hari dari tanggal tiba → jatuh tempo 35 hari lagi → LEBIH_30
  const poB = await poDisetujui(w, { extra: { orderDate: geser(-20) } }); await penerimaan(w, poB.id, { datang: 10, baik: 10, tanggal: geser(-10) });
  const B = await faktur(w, poB, { qty: 10, extra: { terminJenis: "HARI", terminHari: 45, alasanTermin: "Nego" }, klien: w.a });
  await setujui(w, B.body.billId);
  // legacy langsung: hari ini, 3 hari, 10 hari, 20 hari, tanpa tanggal, lunas
  const L0 = await billLegacy(w, { dueDate: geser(0), amount: 100_000 });
  const L3 = await billLegacy(w, { dueDate: geser(3), amount: 200_000 });
  const L10 = await billLegacy(w, { dueDate: geser(10), amount: 300_000 });
  const L20 = await billLegacy(w, { dueDate: geser(20), amount: 400_000 });
  const Ln = await billLegacy(w, { dueDate: null, amount: 500_000 });
  const Ll = await billLegacy(w, { dueDate: geser(-5), amount: 600_000, status: "LUNAS" });
  await testPrisma.finSupplierPayment.create({ data: { paymentNumber: "PAYOUT-LGC-1", supplierId: w.supplier.id, date: new Date(`${geser(-5)}T00:00:00Z`), amount: 600_000, cashAccountId: w.bank.id, allocations: { create: [{ billId: Ll.id, amount: 600_000 }] } } });

  const j = await aging(w);
  const k = (id) => barisBill(j, id).kelompok;
  assert.deepEqual([k(A.body.billId), k(B.body.billId), k(L0.id), k(L3.id), k(L10.id), k(L20.id), k(Ln.id)], ["TERLAMBAT", "LEBIH_30", "HARI_INI", "H1_7", "H8_14", "H15_30", "TANPA_JATUH_TEMPO"]);
  assert.equal(j.baris.some((r) => r.billId === Ll.id), false, "lunas tidak tampil secara bawaan");
  assert.equal(barisBill(j, A.body.billId).hariTerlambat, 1);
  assert.equal(barisBill(j, B.body.billId).tanggalBarangDiterima, geser(-10));
  assert.equal(barisBill(j, B.body.billId).statusPembayaran, "BELUM_JATUH_TEMPO");
  assert.equal(barisBill(j, A.body.billId).statusPembayaran, "TERLAMBAT");
  assert.equal(barisBill(j, L0.id).statusPembayaran, "JATUH_TEMPO_HARI_INI");
  assert.equal(barisBill(j, L3.id).statusPembayaran, "JATUH_TEMPO_7_HARI");
  assert.equal(barisBill(j, Ln.id).statusPembayaran, "TANPA_JATUH_TEMPO");
  assert.equal(barisBill(j, Ln.id).termin.sumber, null);
  assert.equal(barisBill(j, L3.id).termin.sumber, "DATA_LAMA", "tanggal manual lama diberi label data lama, tidak dianggap hasil termin");
  // urutan prioritas
  assert.deepEqual(j.baris.slice(0, 3).map((r) => r.kelompok), ["TERLAMBAT", "HARI_INI", "H1_7"]);
  assert.equal(j.baris.at(-1).kelompok, "TANPA_JATUH_TEMPO");
  // indikator
  assert.deepEqual([barisBill(j, A.body.billId).indikator, barisBill(j, L0.id).indikator, barisBill(j, L3.id).indikator, barisBill(j, L10.id).indikator, barisBill(j, B.body.billId).indikator, barisBill(j, Ln.id).indikator], ["merah", "jingga", "jingga", "biru", "netral", "netral"]);

  // kartu = jumlah baris (satu helper)
  const A_ = 10 * H; const aktif = j.baris;
  const sum = (rows) => rows.reduce((a, r) => a + r.sisaUtang, 0);
  const kt = j.ringkasan.kartu;
  assert.equal(kt.totalUtangAktif, sum(aktif)); assert.equal(kt.totalUtangAktif, A_ + A_ + 100_000 + 200_000 + 300_000 + 400_000 + 500_000);
  assert.equal(kt.totalTerlambat, A_);
  assert.equal(kt.jatuhTempo7Hari, 100_000 + 200_000);
  assert.equal(kt.jatuhTempo30Hari, 100_000 + 200_000 + 300_000 + 400_000);
  assert.deepEqual([kt.tanpaJatuhTempo, kt.jumlahTanpaJatuhTempo], [500_000, 1]);
  assert.equal(j.ringkasan.perKelompok.reduce((a, g) => a + (g.kunci === "LUNAS" ? 0 : g.sisaUtang), 0), kt.totalUtangAktif);
  // tab kelompok membatasi baris tetapi kartu tetap sama
  const tab = await aging(w, "?kelompok=TERLAMBAT");
  assert.deepEqual(tab.baris.map((r) => r.billId), [A.body.billId]);
  assert.deepEqual(tab.ringkasan.kartu, kt);
  // lunas hanya bila diminta
  const lunas = await aging(w, "?kelompok=LUNAS");
  assert.deepEqual(lunas.baris.map((r) => r.billId), [Ll.id]); assert.equal(lunas.baris[0].statusPembayaran, "LUNAS");
  assert.equal(lunas.baris[0].indikator, "hijau");
  // filter supplier & q & jatuh tempo
  assert.equal((await aging(w, `?supplierId=${randomUUID()}`)).baris.length, 0);
  assert.equal((await aging(w, `?q=${encodeURIComponent(barisBill(j, L3.id).nomorFaktur)}`)).baris.length, 1);
  assert.equal((await aging(w, `?jatuhTempoDari=${geser(1)}&jatuhTempoSampai=${geser(10)}`)).baris.length, 2);
});

test("tagihan lama tetap identik: migrasi tidak mengubah baris lama, jatuh tempo lama dipertahankan, tanpa jatuh tempo ditandai belum diisi; tagihan manual bisa dibuka", async () => {
  const w = await dunia();
  const lama = await billLegacy(w, { dueDate: null });
  const sebelum = JSON.stringify(await testPrisma.finSupplierBill.findUnique({ where: { id: lama.id } }));
  const j = await aging(w);
  const b = barisBill(j, lama.id);
  assert.deepEqual([b.kelompok, b.tanggalJatuhTempo, b.termin.jenis, b.termin.sumber], ["TANPA_JATUH_TEMPO", null, null, null]);
  assert.equal(JSON.stringify(await testPrisma.finSupplierBill.findUnique({ where: { id: lama.id } })), sebelum, "membaca aging tidak mengubah tagihan");
  assert.equal(lama.termType ?? null, null);
  const daftar = (await w.f.get("/api/finance/bills")).body.bills;
  assert.ok(daftar.some((x) => x.id === lama.id));
});

// ═══ JADWAL BAYAR ═══════════════════════════════════════════════════════════════════════════════════════════════════
test("draf jadwal bayar: hanya rencana (tanpa jurnal/pembayaran), masuk kartu 'sudah dijadwalkan', bisa dihapus; izin finance:post; faktur lunas/belum disetujui ditolak", async () => {
  const w = await dunia();
  const b = await billLegacy(w, { dueDate: geser(5), amount: 700_000 });
  const awal = await cacah();
  const put = (klien, body, id = b.id) => klien.put ? klien.put(`/api/finance/bills/${id}/jadwal-bayar`, body) : null;
  // klien tes hanya punya get/post/patch → pakai fetch langsung
  const panggil = async (klien, token, body, id = b.id) => {
    const r = await fetch(`${server.baseUrl}/api/finance/bills/${id}/jadwal-bayar`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  void put;
  assert.equal((await panggil(null, w.approver.token, { date: geser(4), cashAccountId: w.bank.id })).status, 403, "APPROVER (tanpa finance:post) tidak boleh");
  assert.equal((await panggil(null, w.fin.token, { date: geser(4) })).status, 400, "rekening wajib");
  const ok = await panggil(null, w.fin.token, { date: geser(4), cashAccountId: w.bank.id, note: "Setelah gajian" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.jadwalBayar.tanggal, ok.body.jadwalBayar.rekening, ok.body.jadwalBayar.oleh], [geser(4), "Bank Uji", w.fin.user.name]);
  assert.deepEqual(await cacah(), awal, "jadwal bayar tidak menjurnal/membayar");
  const j = await aging(w);
  assert.deepEqual([j.ringkasan.kartu.sudahDijadwalkan, j.ringkasan.kartu.jumlahDijadwalkan], [700_000, 1]);
  assert.equal(barisBill(j, b.id).rekeningPembayaran, "Bank Uji");
  assert.equal((await panggil(null, w.fin.token, { date: null })).status, 200);
  assert.equal((await aging(w)).ringkasan.kartu.sudahDijadwalkan, 0);
  const lunas = await billLegacy(w, { dueDate: geser(5), status: "LUNAS" });
  assert.equal((await panggil(null, w.fin.token, { date: geser(4), cashAccountId: w.bank.id }, lunas.id)).status, 409);
  const draf = await billLegacy(w, { dueDate: geser(5), status: "MENUNGGU_APPROVAL" });
  assert.equal((await panggil(null, w.fin.token, { date: geser(4), cashAccountId: w.bank.id }, draf.id)).status, 409);
});

// ═══ IZIN ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
test("izin: aging/detail/export hanya finance:read; Gudang, Produksi, Sales ditolak; tanpa token 401; Gudang tidak melihat harga, termin, atau rekening di PO", async () => {
  const w = await dunia();
  const b = await billLegacy(w, { dueDate: geser(5) });
  const anon = async (path, method = "GET") => (await fetch(`${server.baseUrl}${path}`, { method })).status;
  for (const p of ["/api/finance/utang/aging", `/api/finance/utang/aging/${b.id}`]) assert.equal(await anon(p), 401);
  assert.equal(await anon("/api/finance/export/aging-utang", "POST"), 401);
  for (const [nama, klien] of [["gudang", w.g], ["produksi", w.p], ["sales", w.s]]) {
    assert.equal((await klien.get("/api/finance/utang/aging")).status, 403, nama);
    assert.equal((await klien.get(`/api/finance/utang/aging/${b.id}`)).status, 403, nama);
    assert.equal((await klien.post("/api/finance/export/aging-utang", { filter: {} })).status, 403, nama);
  }
  for (const klien of [w.f, w.a, w.ap]) assert.equal((await klien.get("/api/finance/utang/aging")).status, 200);
  assert.equal((await w.f.get(`/api/finance/utang/aging/${randomUUID()}`)).status, 404);
  // rute Gudang untuk PO tidak membawa harga/termin
  const po = await poDisetujui(w);
  const g = JSON.stringify((await w.g.get(`/api/inventory/purchase-orders/${po.id}`)).body);
  assert.ok(!/termin|unitPrice|hargaSatuan|nilai/i.test(g), g.slice(0, 300));
});

// ═══ EXPORT ═════════════════════════════════════════════════════════════════════════════════════════════════════════
test("export Excel Aging Utang: enam sheet, angka numerik, total = kartu layar, tanggal WIB, formula injection dinetralkan, sheet kosong menjelaskan alasannya, filter sama dengan layar", async () => {
  const w = await dunia();
  const nakal = await testPrisma.finSupplier.create({ data: { code: "SUP-X", name: "=HYPERLINK(\"http://x\")" } });
  await testPrisma.finSupplierBill.create({ data: { billNumber: "BILL-X-1", supplierRef: "+SUM(1)", supplierId: nakal.id, billDate: new Date(`${geser(-2)}T00:00:00Z`), dueDate: new Date(`${geser(-1)}T00:00:00Z`), amount: 250_000, description: "x", status: "DISETUJUI", billType: "JASA_OPERASIONAL" } });
  await billLegacy(w, { dueDate: geser(2), amount: 125_000 });
  await billLegacy(w, { dueDate: null, amount: 75_000 });
  const lunas = await billLegacy(w, { dueDate: geser(-9), amount: 50_000, status: "LUNAS" });
  await testPrisma.finSupplierPayment.create({ data: { paymentNumber: "PAYOUT-LGC-2", supplierId: w.supplier.id, date: new Date(`${geser(-9)}T00:00:00Z`), amount: 50_000, cashAccountId: w.bank.id, allocations: { create: [{ billId: lunas.id, amount: 50_000 }] } } });
  const sebagian = await billLegacy(w, { dueDate: geser(12), amount: 400_000, status: "DIBAYAR_SEBAGIAN" });
  await testPrisma.finSupplierPayment.create({ data: { paymentNumber: "PAYOUT-LGC-3", supplierId: w.supplier.id, date: new Date(`${geser(-1)}T00:00:00Z`), amount: 100_000, cashAccountId: w.bank.id, allocations: { create: [{ billId: sebagian.id, amount: 100_000 }] } } });

  const layar = await aging(w);
  const kt = layar.ringkasan.kartu;
  const ambil = (filter = {}, token = w.fin.token) => fetch(`${server.baseUrl}/api/finance/export/aging-utang`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ filter }) });
  const res = await ambil();
  assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual(wb.worksheets.map((s) => s.name).slice(0, 6), ["Ringkasan Aging", "Utang Aktif", "Jatuh Tempo", "Dibayar Sebagian", "Lunas", "Tanpa Jatuh Tempo"]);
  const baris = (n) => { const out = []; wb.getWorksheet(n).eachRow((r) => out.push(r.values.slice(1))); return out; };
  const total = (n) => baris(n).find((r) => String(r[0] ?? "").startsWith("TOTAL"));
  // total export = kartu layar
  assert.equal(Number(total("Ringkasan Aging")[3]), kt.totalUtangAktif);
  assert.equal(Number(total("Utang Aktif")[14]), kt.totalUtangAktif, JSON.stringify(total("Utang Aktif")));
  assert.equal(typeof total("Utang Aktif")[14], "number");
  assert.equal(Number(total("Dibayar Sebagian")[14]), kt.dibayarSebagian);
  assert.equal(Number(total("Tanpa Jatuh Tempo")[14]), kt.tanpaJatuhTempo);
  assert.equal(Number(total("Jatuh Tempo")[14]), kt.totalTerlambat + 125_000);
  assert.equal(Number(total("Lunas")[12]), 50_000);
  // injection
  const aktif = baris("Utang Aktif");
  assert.ok(aktif.some((r) => String(r[0]).startsWith("'=HYPERLINK")), "nama supplier berawalan '=' dinetralkan");
  assert.ok(aktif.some((r) => String(r[2]).startsWith("'+SUM")), "no. faktur berawalan '+' dinetralkan");
  // kolom sensitif disembunyikan untuk Finance biasa (alasan termin, catatan jadwal) dan ada untuk admin
  const header = (n) => baris(n).find((r) => r[0] === "Supplier");
  assert.ok(!header("Utang Aktif").includes("Alasan Ganti Termin"));
  const resAdmin = await ambil({}, w.admin.token);
  const wbA = new ExcelJS.Workbook(); await wbA.xlsx.load(Buffer.from(await resAdmin.arrayBuffer()));
  let ada = false; wbA.getWorksheet("Utang Aktif").eachRow((r) => { if (r.values.includes("Alasan Ganti Termin")) ada = true; });
  assert.ok(ada, "admin melihat kolom sensitif");
  // filter supplier = layar; hasil kosong menjelaskan alasan
  const resKosong = await ambil({ supplierId: randomUUID() });
  const wbK = new ExcelJS.Workbook(); await wbK.xlsx.load(Buffer.from(await resKosong.arrayBuffer()));
  const teksKosong = []; wbK.getWorksheet("Utang Aktif").eachRow((r) => teksKosong.push(String(r.values[1] ?? "")));
  assert.ok(teksKosong.some((t) => /Tidak ada utang aktif untuk filter ini/.test(t)));
  const resSup = await ambil({ supplierId: nakal.id });
  const wbS = new ExcelJS.Workbook(); await wbS.xlsx.load(Buffer.from(await resSup.arrayBuffer()));
  const totSup = []; wbS.getWorksheet("Utang Aktif").eachRow((r) => { if (String(r.values[1] ?? "").startsWith("TOTAL")) totSup.push(r.values[15]); });
  assert.equal(Number(totSup[0]), (await aging(w, `?supplierId=${nakal.id}`)).ringkasan.kartu.totalUtangAktif);
});
