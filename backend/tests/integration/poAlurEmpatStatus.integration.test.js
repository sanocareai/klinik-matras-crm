// ALUR PO → BARANG TIBA → SIMPAN KE STOK → FAKTUR SUPPLIER → PEMBAYARAN, dengan EMPAT STATUS TERPISAH (progres barang · faktur · utang · pembayaran) pada detail PO.
// Kasus Rp6 juta (permintaan Owner): bayar awal Rp4 juta, barang belum datang → stok 0 dan uang muka Rp4 juta; barang datang lalu Simpan ke Stok → stok naik, faktur TETAP belum ada/disetujui;
// faktur Rp6 juta disetujui + uang muka dialokasikan → sisa utang Rp2 juta; pelunasan Rp2 juta → lunas. Juga: pembayaran setelah faktur, replay, paralel, pembatalan resmi pembayaran,
// kedatangan bertahap + beberapa faktur tanpa hitung ganda, dan parity PO ↔ Supplier & Utang ↔ Aging ↔ jurnal.
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

const H = 60_000; // PO 100 KG × Rp60.000 = Rp6.000.000
const kunci = () => ({ "Idempotency-Key": `po4-${randomUUID()}` });
const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);
const hariIni = () => geser(0);
const BUKTI = `/media/finance-receipts/${"b".repeat(40)}.jpg`;
let nomorFaktur = 0;
const ref = () => `FAK-4S-${String(++nomorFaktur).padStart(4, "0")}`;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const [fin, admin, gudang, approver] = await Promise.all(["FINANCE", "ADMIN", "WAREHOUSE", "APPROVER"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-4S", name: "PT EMPAT STATUS", paymentTermType: "HARI", paymentTermDays: 30 } });
  const busa = await createTestMaterial({ code: "BUSA-4S", name: "Busa Empat Status", unit: "KG" });
  return { f: c(fin), a: c(admin), g: c(gudang), ap: c(approver), bank, supplier, busa };
}
async function poDisetujui(w, { qty = 100, harga = H } = {}) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: geser(-20), lines: [{ materialId: w.busa.id, qty, unitPrice: harga }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}
const tiba = (w, poId, body) => w.g.post(`/api/inventory/barang-akan-datang/${poId}/kedatangan`, { penerima: "Budi Gudang", catatan: "Barang tiba utuh", tanggalTiba: geser(-5), ...body }, kunci());
async function terimaDanSimpan(w, po, qty, { simpan = true } = {}) {
  const t = await tiba(w, po.id, { lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: qty }] });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const id = t.body.receiptId;
  if (!simpan) return { receiptId: id };
  const gr = (await w.g.get(`/api/inventory/goods-receipts/${id}`)).body;
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}`, { status: "INSPECTION" })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}/lines/${gr.lines[0].id}`, { acceptedQty: qty, rejectedQty: 0 })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}`, { status: "READY_FOR_PUTAWAY" })).status, 200);
  const p = await w.g.post(`/api/inventory/goods-receipts/${id}/putaway`, {});
  assert.equal(p.status, 200, JSON.stringify(p.body));
  return { receiptId: id };
}
async function catatFaktur(w, po, qty, { setuju = false } = {}) {
  const r = await w.f.post(`/api/finance/purchase-orders/${po.id}/faktur`, { supplierRef: ref(), billDate: geser(-1), lines: [{ purchaseOrderLineId: po.lines[0].id, qty, unitPrice: H }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (setuju) { const a = await w.ap.post(`/api/finance/bills/${r.body.billId}/approve`, {}); assert.equal(a.status, 200, JSON.stringify(a.body)); }
  return r.body.billId;
}
const bayarDP = (w, po, amount) => w.f.post(`/api/finance/purchase-orders/${po.id}/uang-muka`, { amount, date: hariIni(), cashAccountId: w.bank.id, receiptUrl: BUKTI, reference: "TRF-4S-001" }, kunci());
const terapkan = (w, advanceId, billId, amount) => w.f.post("/api/finance/purchase-orders/uang-muka/terapkan", { advanceId, billId, amount, konfirmasi: true }, kunci());
const bayarFaktur = (w, billId, amount, headers = kunci()) => w.a.post("/api/finance/supplier-payments", { supplierId: w.supplier.id, date: hariIni(), cashAccountId: w.bank.id, allocations: [{ billId, amount }] }, headers);
const detail = async (w, po) => (await w.f.get(`/api/finance/purchase-orders/${po.id}`)).body;
const kode = (d) => ({ barang: d.keuangan.statusEmpat.barang.kode, faktur: d.keuangan.statusEmpat.faktur.kode, utang: d.keuangan.statusEmpat.utang.kode, pembayaran: d.keuangan.statusEmpat.pembayaran.kode });
const total = (d) => [d.keuangan.nilaiPO, d.keuangan.totalFakturDisetujui, d.keuangan.sudahDibayar, d.keuangan.sisaUtang];
const stokTotal = async () => Number((await testPrisma.stockMovement.aggregate({ _sum: { qty: true } }))._sum.qty ?? 0);
async function saldo(systemKey) {
  const a = await testPrisma.finAccount.findUnique({ where: { systemKey } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: a.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
}
async function bukuSeimbang() {
  for (const e of await testPrisma.finJournalEntry.findMany({ include: { lines: true } })) {
    assert.equal(e.lines.reduce((a, l) => a + Number(l.debit), 0), e.lines.reduce((a, l) => a + Number(l.credit), 0), `jurnal ${e.entryNumber} seimbang`);
  }
}

test("KASUS Rp6 JUTA end-to-end: empat status berubah sendiri-sendiri; Simpan ke Stok TIDAK menyetujui/membuat faktur; faktur disetujui + uang muka dialokasikan → sisa utang Rp2 juta; pelunasan → lunas", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);

  // 0. PO disetujui: semuanya belum ada
  let d = await detail(w, po);
  assert.deepEqual(kode(d), { barang: "BELUM_DATANG", faktur: "BELUM_ADA", utang: "BELUM_ADA", pembayaran: "BELUM_ADA" });
  assert.deepEqual(total(d), [6_000_000, 0, 0, 0]);
  assert.match(d.keuangan.petunjukSimpanKeStok, /Simpan ke Stok.*tidak menyetujui faktur.*Catat Faktur dan Setujui.*Finance yang terpisah/);

  // 1. Bayar awal Rp4 juta, barang belum datang → stok tetap 0, uang muka 4 jt, tidak ada utang/GRNI
  const dp = await bayarDP(w, po, 4_000_000);
  assert.equal(dp.status, 201, JSON.stringify(dp.body));
  d = await detail(w, po);
  assert.deepEqual(kode(d), { barang: "BELUM_DATANG", faktur: "BELUM_ADA", utang: "BELUM_ADA", pembayaran: "UANG_MUKA_SAJA" });
  assert.deepEqual(total(d), [6_000_000, 0, 4_000_000, 0], "sudah dibayar 4 jt, tetapi bukan utang");
  assert.equal(await stokTotal(), 0);
  assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 4_000_000);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH), 0); assert.equal(await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), 0); assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), 0);
  assert.deepEqual(d.keuangan.riwayatPembayaran.map((x) => [x.jenis, x.jumlah, x.dibatalkan]), [["UANG_MUKA", 4_000_000, false]]);

  // 2. Barang datang sebagian (40 KG) dicatat tiba tetapi BELUM disimpan → stok tetap 0
  const tiba40 = await terimaDanSimpan(w, po, 40, { simpan: false });
  d = await detail(w, po);
  assert.equal(d.keuangan.statusEmpat.barang.kode, "DATANG_SEBAGIAN");
  assert.equal(await stokTotal(), 0, "tiba ≠ masuk stok");
  // lalu diperiksa dan Simpan ke Stok → stok +40
  const gr = (await w.g.get(`/api/inventory/goods-receipts/${tiba40.receiptId}`)).body;
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${tiba40.receiptId}`, { status: "INSPECTION" })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${tiba40.receiptId}/lines/${gr.lines[0].id}`, { acceptedQty: 40, rejectedQty: 0 })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${tiba40.receiptId}`, { status: "READY_FOR_PUTAWAY" })).status, 200);
  d = await detail(w, po);
  assert.ok(d.keuangan.statusEmpat.barang.rincian.some((t) => /Simpan ke Stok/.test(t)), "petunjuk Simpan ke Stok muncul saat ada barang baik belum disimpan");
  assert.equal((await w.g.post(`/api/inventory/goods-receipts/${tiba40.receiptId}/putaway`, {})).status, 200);
  assert.equal(await stokTotal(), 40);
  d = await detail(w, po);
  assert.equal(d.keuangan.statusEmpat.barang.kode, "DATANG_SEBAGIAN");
  // KUNCI: Simpan ke Stok tidak membuat/menyetujui faktur, tidak membuat utang usaha, dan tidak mengubah pembayaran
  assert.equal(await testPrisma.finSupplierBill.count({ where: { purchaseOrderId: po.id } }), 0, "tidak ada faktur otomatis");
  assert.deepEqual([d.keuangan.statusEmpat.faktur.kode, d.keuangan.statusEmpat.utang.kode, d.keuangan.statusEmpat.pembayaran.kode], ["BELUM_ADA", "BELUM_ADA", "UANG_MUKA_SAJA"]);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), 0);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH), -2_400_000, "GRNI 40 × 60.000 (kewajiban barang belum ditagih), bukan utang faktur");
  assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 4_000_000, "uang muka tidak berubah oleh penerimaan");

  // 3. Sisa 60 KG datang & disimpan → semua barang masuk stok; faktur masih belum ada
  await terimaDanSimpan(w, po, 60);
  assert.equal(await stokTotal(), 100);
  d = await detail(w, po);
  assert.deepEqual(kode(d), { barang: "LENGKAP", faktur: "BELUM_ADA", utang: "BELUM_ADA", pembayaran: "UANG_MUKA_SAJA" });

  // 4. Finance mencatat faktur Rp6 juta (belum disetujui) → menunggu persetujuan; belum menjadi utang
  const billId = await catatFaktur(w, po, 100);
  d = await detail(w, po);
  assert.deepEqual(kode(d), { barang: "LENGKAP", faktur: "MENUNGGU_PERSETUJUAN", utang: "BELUM_ADA", pembayaran: "UANG_MUKA_SAJA" });
  assert.deepEqual(total(d), [6_000_000, 0, 4_000_000, 0], "faktur belum disetujui tidak dihitung");
  assert.equal(d.keuangan.statusEmpat.faktur.jumlah.menunggu, 1);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), 0);

  // 5. Disetujui (aksi Finance terpisah) → utang 6 jt; uang muka belum dialokasikan → sisa utang masih 6 jt
  assert.equal((await w.ap.post(`/api/finance/bills/${billId}/approve`, {})).status, 200);
  d = await detail(w, po);
  assert.deepEqual(kode(d), { barang: "LENGKAP", faktur: "DISETUJUI_LENGKAP", utang: "ADA_UTANG", pembayaran: "UANG_MUKA_SAJA" });
  assert.deepEqual(total(d), [6_000_000, 6_000_000, 4_000_000, 6_000_000]);
  assert.ok(d.keuangan.statusEmpat.utang.rincian.some((t) => /uang muka yang belum diterapkan/.test(t)));
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -6_000_000);

  // 6. Alokasikan uang muka Rp4 juta → sisa utang Rp2 juta; sudah dibayar TETAP Rp4 juta (bukan 8 juta)
  const um = await testPrisma.finPurchase.findFirst({ where: { purchaseOrderId: po.id } });
  const ap = await terapkan(w, um.id, billId, 4_000_000);
  assert.equal(ap.status, 201, JSON.stringify(ap.body));
  d = await detail(w, po);
  assert.deepEqual(total(d), [6_000_000, 6_000_000, 4_000_000, 2_000_000], "sisa utang Rp2 juta; tidak ada hitung ganda");
  assert.deepEqual(kode(d), { barang: "LENGKAP", faktur: "DISETUJUI_LENGKAP", utang: "ADA_UTANG", pembayaran: "UANG_MUKA_SAJA" });
  assert.equal(d.keuangan.uangMukaBelumDiterapkan, 0);
  assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 0); assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -2_000_000);

  // 7. Pelunasan Rp2 juta setelah faktur → utang lunas; total kas keluar = 6 jt = nilai PO
  const bayar = await bayarFaktur(w, billId, 2_000_000);
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  d = await detail(w, po);
  assert.deepEqual(kode(d), { barang: "LENGKAP", faktur: "DISETUJUI_LENGKAP", utang: "LUNAS", pembayaran: "LUNAS" });
  assert.deepEqual(total(d), [6_000_000, 6_000_000, 6_000_000, 0]);
  assert.deepEqual(d.keuangan.riwayatPembayaran.map((x) => [x.jenis, x.jumlah, x.dibatalkan]), [["UANG_MUKA", 4_000_000, false], ["PEMBAYARAN_FAKTUR", 2_000_000, false]]);
  assert.equal(d.keuangan.riwayatPembayaran.reduce((a, x) => a + x.jumlah, 0), d.keuangan.sudahDibayar, "riwayat kas = sudah dibayar");
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), 0);
  assert.equal(await stokTotal(), 100);

  // 8. PARITY: PO ↔ Supplier & Utang ↔ Aging ↔ jurnal (utang aktif nol di semuanya)
  const ring = (await w.f.get("/api/finance/purchase-orders/uang-muka/ringkasan-supplier")).body;
  assert.deepEqual([ring.kartu.utangAktif, ring.kartu.uangMukaBelumDiterapkan, ring.kartu.totalUangMuka], [0, 0, 4_000_000]);
  const aging = (await w.f.get("/api/finance/utang/aging")).body;
  assert.equal(aging.ringkasan.kartu.totalUtangAktif, 0);
  await bukuSeimbang();
});

test("PEMBAYARAN SETELAH FAKTUR (tanpa uang muka): faktur disetujui → pembayaran sebagian lalu pelunasan; replay Idempotency-Key = satu pembayaran; status & total konsisten dengan Supplier & Utang dan aging", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  await terimaDanSimpan(w, po, 100);
  const billId = await catatFaktur(w, po, 100, { setuju: true });
  let d = await detail(w, po);
  assert.deepEqual(kode(d), { barang: "LENGKAP", faktur: "DISETUJUI_LENGKAP", utang: "ADA_UTANG", pembayaran: "BELUM_ADA" });
  assert.deepEqual(total(d), [6_000_000, 6_000_000, 0, 6_000_000]);

  const kunciTetap = kunci();
  const b1 = await bayarFaktur(w, billId, 1_500_000, kunciTetap);
  assert.equal(b1.status, 201, JSON.stringify(b1.body));
  const ulang = await bayarFaktur(w, billId, 1_500_000, kunciTetap);
  assert.ok([200, 201].includes(ulang.status), JSON.stringify(ulang.body));
  assert.equal(await testPrisma.finSupplierPayment.count(), 1, "replay tidak membuat pembayaran kedua");
  d = await detail(w, po);
  assert.deepEqual(kode(d), { barang: "LENGKAP", faktur: "DISETUJUI_LENGKAP", utang: "ADA_UTANG", pembayaran: "DIBAYAR_SEBAGIAN" });
  assert.deepEqual(total(d), [6_000_000, 6_000_000, 1_500_000, 4_500_000]);
  const aging = (await w.f.get("/api/finance/utang/aging")).body;
  assert.equal(aging.ringkasan.kartu.totalUtangAktif, 4_500_000, "aging = sisa utang PO");
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_USAHA), -4_500_000, "jurnal = sisa utang PO");

  // dua pembayaran PARALEL atas sisa yang sama: tidak melebihi sisa utang
  const [x, y] = await Promise.all([bayarFaktur(w, billId, 4_500_000), bayarFaktur(w, billId, 4_500_000)]);
  assert.equal([x, y].filter((r) => r.status === 201).length, 1, `tepat satu yang berhasil: ${x.status}/${y.status}`);
  d = await detail(w, po);
  assert.deepEqual(kode(d), { barang: "LENGKAP", faktur: "DISETUJUI_LENGKAP", utang: "LUNAS", pembayaran: "LUNAS" });
  assert.deepEqual(total(d), [6_000_000, 6_000_000, 6_000_000, 0]);
  await bukuSeimbang();
});

test("PEMBATALAN RESMI pembayaran faktur: riwayat menandai Dibatalkan, sudah dibayar & sisa utang kembali, status pembayaran mundur; uang muka dan stok tidak tersentuh", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  assert.equal((await bayarDP(w, po, 4_000_000)).status, 201);
  await terimaDanSimpan(w, po, 100);
  const billId = await catatFaktur(w, po, 100, { setuju: true });
  const um = await testPrisma.finPurchase.findFirst({ where: { purchaseOrderId: po.id } });
  assert.equal((await terapkan(w, um.id, billId, 4_000_000)).status, 201);
  const bayar = await bayarFaktur(w, billId, 2_000_000);
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  let d = await detail(w, po);
  assert.equal(d.keuangan.statusEmpat.pembayaran.kode, "LUNAS");

  const idBayar = (await testPrisma.finSupplierPayment.findFirst()).id;
  const batal = await w.a.post(`/api/finance/supplier-payments/${idBayar}/cancel`, { reason: "Salah rekening tujuan" });
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  d = await detail(w, po);
  assert.deepEqual(total(d), [6_000_000, 6_000_000, 4_000_000, 2_000_000]);
  assert.deepEqual(kode(d), { barang: "LENGKAP", faktur: "DISETUJUI_LENGKAP", utang: "ADA_UTANG", pembayaran: "UANG_MUKA_SAJA" });
  const jejak = d.keuangan.riwayatPembayaran.find((x) => x.jenis === "PEMBAYARAN_FAKTUR");
  assert.equal(jejak.dibatalkan, true, "tetap tampil di riwayat sebagai Dibatalkan");
  assert.equal(await stokTotal(), 100);
  assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PEMBELIAN), 0, "penerapan uang muka tidak ikut dibatalkan");
  await bukuSeimbang();
});

test("KEDATANGAN BERTAHAP + DUA FAKTUR + DUA UANG MUKA: tiap tahap status benar; uang muka tidak dihitung ganda saat diterapkan ke dua faktur; kelebihan bayar ditandai", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  assert.equal((await bayarDP(w, po, 2_000_000)).status, 201);
  assert.equal((await bayarDP(w, po, 1_000_000)).status, 201);
  await terimaDanSimpan(w, po, 50);
  const f1 = await catatFaktur(w, po, 50, { setuju: true });
  let d = await detail(w, po);
  assert.deepEqual(kode(d), { barang: "DATANG_SEBAGIAN", faktur: "DISETUJUI_SEBAGIAN", utang: "ADA_UTANG", pembayaran: "UANG_MUKA_SAJA" });
  assert.deepEqual(total(d), [6_000_000, 3_000_000, 3_000_000, 3_000_000]);
  const dps = await testPrisma.finPurchase.findMany({ where: { purchaseOrderId: po.id }, orderBy: { amount: "desc" } });
  assert.equal((await terapkan(w, dps[0].id, f1, 2_000_000)).status, 201);
  assert.equal((await terapkan(w, dps[1].id, f1, 1_000_000)).status, 201);
  d = await detail(w, po);
  assert.deepEqual(total(d), [6_000_000, 3_000_000, 3_000_000, 0], "sisa utang faktur 1 = 0 setelah 3 jt uang muka; sudah dibayar tetap 3 jt");
  assert.equal(d.keuangan.statusEmpat.utang.kode, "LUNAS");
  await terimaDanSimpan(w, po, 50);
  const f2 = await catatFaktur(w, po, 50, { setuju: true });
  d = await detail(w, po);
  assert.deepEqual(kode(d), { barang: "LENGKAP", faktur: "DISETUJUI_LENGKAP", utang: "ADA_UTANG", pembayaran: "UANG_MUKA_SAJA" });
  assert.deepEqual(total(d), [6_000_000, 6_000_000, 3_000_000, 3_000_000]);
  assert.equal((await bayarFaktur(w, f2, 3_000_000)).status, 201);
  d = await detail(w, po);
  assert.deepEqual(kode(d), { barang: "LENGKAP", faktur: "DISETUJUI_LENGKAP", utang: "LUNAS", pembayaran: "LUNAS" });
  assert.deepEqual(total(d), [6_000_000, 6_000_000, 6_000_000, 0]);
  await bukuSeimbang();
});
