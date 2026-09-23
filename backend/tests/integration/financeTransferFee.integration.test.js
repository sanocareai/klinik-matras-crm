// Biaya admin transfer bank di SEMUA jalur uang keluar. Yang dikunci:
//  - server yang menghitung (nominal preset dari klien DIABAIKAN),
//  - satu dokumen = satu transaksi; biaya admin = BARIS jurnal terpisah di
//    jurnal yang SAMA (bukan pengeluaran kedua),
//  - kredit kas/bank = nominal diterima + biaya (Total Keluar Rekening),
//  - preset dapat dikonfigurasi per rekening,
//  - validasi: Transfer hanya untuk rekening bank, Custom wajib nominal wajar.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postPaymentReceived } from "../../src/services/finance/posting/orderRevenue.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Tunai", kind: "KAS", accountId: akunKas.id } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const bank2 = await testPrisma.finCashAccount.create({ data: { name: "Mandiri Cadangan", kind: "BANK", accountId: akunBank.id } });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  const katBeli = await testPrisma.finPurchaseCategory.findFirst();
  const { token, user } = await createTestUser({ roles: ["ADMIN"] });
  return { kas, bank, bank2, kat, katBeli, user, c: makeClient(server.baseUrl, token) };
}

async function jurnal(source, sourceId) {
  const es = await testPrisma.finJournalEntry.findMany({
    where: { source, sourceId, status: "POSTED" }, include: { lines: { include: { account: { select: { code: true } } } } },
  });
  return es;
}
const ringkas = (entry) => entry.lines.map((l) => ({ k: l.account.code, d: Number(l.debit), c: Number(l.credit) }));
const totalDebit = (e) => e.lines.reduce((a, l) => a + Number(l.debit), 0);
const totalKredit = (e) => e.lines.reduce((a, l) => a + Number(l.credit), 0);

const badan = (ctx, extra = {}) => ({
  date: "2026-09-20", amount: 100_000, description: "Beli perlengkapan", categoryId: ctx.kat.id,
  mode: "LANGSUNG", cashAccountId: ctx.bank.id, ...extra,
});

test("Pengeluaran LANGSUNG + BI-FAST: server mengisi Rp2.500 (nominal klien diabaikan); SATU pengeluaran, SATU jurnal 3 baris seimbang", async () => {
  const ctx = await siapkan();
  const r = await ctx.c.post("/api/finance/expenses", badan(ctx, { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST", transferFeeAmount: 999_999 }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.transferFeeAmount, 2500, "preset dihitung server, bukan dari klien");
  assert.equal(r.body.nominalDiterima, 100_000);
  assert.equal(r.body.totalKeluarRekening, 102_500);

  const ap = await ctx.c.post(`/api/finance/expenses/${r.body.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));

  assert.equal(await testPrisma.finExpense.count(), 1, "tidak boleh ada pengeluaran kedua");
  const es = await jurnal("PENGELUARAN", r.body.id);
  assert.equal(es.length, 1, "satu jurnal saja");
  assert.equal(totalDebit(es[0]), totalKredit(es[0]));
  assert.equal(totalKredit(es[0]), 102_500);
  const admin = es[0].lines.find((l) => l.account.code === "6-1700");
  assert.ok(admin && Number(admin.debit) === 2500, "baris biaya admin terpisah ke Beban Administrasi Bank");
  const kredit = es[0].lines.find((l) => Number(l.credit) > 0);
  assert.equal(Number(kredit.credit), 102_500, "kas/bank keluar = nominal + biaya");
  assert.equal(kredit.cashAccountId, ctx.bank.id);
});

test("Preset: Sesama Bank Rp0 tanpa baris biaya; Transfer Online Rp6.500", async () => {
  const ctx = await siapkan();
  const a = await ctx.c.post("/api/finance/expenses", badan(ctx, { paymentMethod: "TRANSFER", transferFeeType: "SESAMA_BANK" }));
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.transferFeeAmount, 0);
  await ctx.c.post(`/api/finance/expenses/${a.body.id}/approve`, {});
  const ea = await jurnal("PENGELUARAN", a.body.id);
  assert.equal(ea[0].lines.length, 2, "biaya 0 -> tidak ada baris biaya admin");

  const b = await ctx.c.post("/api/finance/expenses", badan(ctx, { paymentMethod: "TRANSFER", transferFeeType: "TRANSFER_ONLINE" }));
  assert.equal(b.body.transferFeeAmount, 6500);
  assert.equal(b.body.totalKeluarRekening, 106_500);
});

test("Custom: nominal dari klien dipakai setelah divalidasi; kosong/negatif/berlebihan ditolak", async () => {
  const ctx = await siapkan();
  const ok = await ctx.c.post("/api/finance/expenses", badan(ctx, { paymentMethod: "TRANSFER", transferFeeType: "LAINNYA", transferFeeAmount: 7777 }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.transferFeeAmount, 7777);
  for (const [nilai, pesan] of [[undefined, /nominal biaya admin/i], [-1, /negatif/i], [5_000_000, /batas wajar/i], ["abc", /bukan angka/i]]) {
    const r = await ctx.c.post("/api/finance/expenses", badan(ctx, { paymentMethod: "TRANSFER", transferFeeType: "LAINNYA", transferFeeAmount: nilai }));
    assert.equal(r.status, 400, `nilai ${nilai} → ${JSON.stringify(r.body)}`);
    assert.match(r.body.error, pesan);
  }
});

test("Validasi: Transfer dari kas tunai ditolak; biaya tanpa Transfer ditolak; jenis wajib; cara bayar tak dikenal ditolak", async () => {
  const ctx = await siapkan();
  const dariKas = await ctx.c.post("/api/finance/expenses", badan(ctx, { cashAccountId: ctx.kas.id, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" }));
  assert.equal(dariKas.status, 400);
  assert.match(dariKas.body.error, /kas tunai/i);
  const tunaiBerbiaya = await ctx.c.post("/api/finance/expenses", badan(ctx, { paymentMethod: "TUNAI", transferFeeType: "BI_FAST" }));
  assert.equal(tunaiBerbiaya.status, 400);
  const tanpaJenis = await ctx.c.post("/api/finance/expenses", badan(ctx, { paymentMethod: "TRANSFER" }));
  assert.equal(tanpaJenis.status, 400);
  const aneh = await ctx.c.post("/api/finance/expenses", badan(ctx, { paymentMethod: "QRIS" }));
  assert.equal(aneh.status, 400);
  assert.equal(await testPrisma.finExpense.count(), 0, "penolakan tidak boleh meninggalkan dokumen");
});

test("Tanpa memilih cara bayar: perilaku lama utuh (biaya 0, jurnal 2 baris)", async () => {
  const ctx = await siapkan();
  const r = await ctx.c.post("/api/finance/expenses", badan(ctx));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.transferFeeAmount, 0);
  await ctx.c.post(`/api/finance/expenses/${r.body.id}/approve`, {});
  assert.equal((await jurnal("PENGELUARAN", r.body.id))[0].lines.length, 2);
});

test("Preset dapat dikonfigurasi per rekening; validasi & reset ke bawaan", async () => {
  const ctx = await siapkan();
  const set = await ctx.c.patch(`/api/finance/cash-accounts/${ctx.bank.id}`, { transferFeePresets: { BI_FAST: 3000, TRANSFER_ONLINE: 7000 } });
  assert.equal(set.status, 200, JSON.stringify(set.body));

  const daftar = await ctx.c.get("/api/finance/cash-accounts");
  const b1 = daftar.body.accounts.find((a) => a.id === ctx.bank.id);
  assert.equal(b1.presetBiayaTransfer.BI_FAST, 3000);
  assert.equal(b1.presetBiayaTransfer.SESAMA_BANK, 0, "yang tidak ditimpa tetap bawaan");
  const b2 = daftar.body.accounts.find((a) => a.id === ctx.bank2.id);
  assert.equal(b2.presetBiayaTransfer.BI_FAST, 2500, "rekening lain tidak terpengaruh");

  const r1 = await ctx.c.post("/api/finance/expenses", badan(ctx, { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" }));
  assert.equal(r1.body.transferFeeAmount, 3000);
  const r2 = await ctx.c.post("/api/finance/expenses", badan(ctx, { cashAccountId: ctx.bank2.id, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" }));
  assert.equal(r2.body.transferFeeAmount, 2500);

  const buruk = await ctx.c.patch(`/api/finance/cash-accounts/${ctx.bank.id}`, { transferFeePresets: { BI_FAST: -5 } });
  assert.equal(buruk.status, 400);
  const reset = await ctx.c.patch(`/api/finance/cash-accounts/${ctx.bank.id}`, { transferFeePresets: null });
  assert.equal(reset.status, 200);
  const r3 = await ctx.c.post("/api/finance/expenses", badan(ctx, { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" }));
  assert.equal(r3.body.transferFeeAmount, 2500);
});

test("Pengeluaran UTANG: biaya dipilih saat DIBAYAR; jurnal pembayaran Dr Utang, Dr Beban Admin / Cr Bank (total keluar)", async () => {
  const ctx = await siapkan();
  const r = await ctx.c.post("/api/finance/expenses", badan(ctx, { mode: "UTANG", cashAccountId: undefined, payeeName: "Toko Maju" }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.transferFeeAmount, 0);
  await ctx.c.post(`/api/finance/expenses/${r.body.id}/approve`, {});
  const bayar = await ctx.c.post(`/api/finance/expenses/${r.body.id}/pay`, {
    cashAccountId: ctx.bank.id, paymentMethod: "TRANSFER", transferFeeType: "TRANSFER_ONLINE",
  });
  assert.equal(bayar.status, 200, JSON.stringify(bayar.body));
  assert.equal(bayar.body.transferFeeAmount, 6500);
  const es = await jurnal("PENGELUARAN", r.body.id);
  const bayarJurnal = es.find((e) => e.idempotencyKey?.startsWith("PENGELUARAN_DIBAYAR"));
  assert.ok(bayarJurnal);
  assert.equal(totalDebit(bayarJurnal), totalKredit(bayarJurnal));
  assert.equal(totalKredit(bayarJurnal), 106_500);
  assert.equal(await testPrisma.finExpense.count(), 1);
});

test("Koreksi pengeluaran: mengganti BI-FAST -> Sesama Bank memperbaiki jurnal (reversal + repost), tanpa dokumen baru", async () => {
  const ctx = await siapkan();
  const r = await ctx.c.post("/api/finance/expenses", badan(ctx, { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" }));
  await ctx.c.post(`/api/finance/expenses/${r.body.id}/approve`, {});
  const k = await ctx.c.post(`/api/finance/expenses/${r.body.id}/koreksi`, { reason: "Salah pilih metode", transferFeeType: "SESAMA_BANK" });
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.equal(k.body.transferFeeAmount, 0);
  const aktif = await jurnal("PENGELUARAN", r.body.id);
  assert.equal(aktif.length, 1, "hanya satu jurnal aktif setelah koreksi");
  assert.equal(totalKredit(aktif[0]), 100_000);
  assert.equal(await testPrisma.finExpense.count(), 1);
});

test("Pembelian LANGSUNG + Transfer Online: jurnal PEMBELIAN memuat baris biaya admin", async () => {
  const ctx = await siapkan();
  const r = await ctx.c.post("/api/finance/purchases", {
    date: "2026-09-20", amount: 200_000, description: "Busa", categoryId: ctx.katBeli.id, mode: "LANGSUNG",
    cashAccountId: ctx.bank.id, paymentMethod: "TRANSFER", transferFeeType: "TRANSFER_ONLINE",
    receiptUrl: "/media/finance-receipts/" + "a".repeat(40) + ".jpg",
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.totalKeluarRekening, 206_500);
  const ap = await ctx.c.post(`/api/finance/purchases/${r.body.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const es = await jurnal("PEMBELIAN", r.body.id);
  assert.equal(es.length, 1);
  assert.equal(totalKredit(es[0]), 206_500);
  assert.equal(totalDebit(es[0]), 206_500);
});

test("Pembayaran supplier: biaya admin bukan bagian alokasi tagihan; utang turun sebesar tagihan, kas keluar tagihan + biaya", async () => {
  const ctx = await siapkan();
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-FEE", name: "CV Tekstil" } });
  const bill = await testPrisma.finSupplierBill.create({
    data: {
      billNumber: "BILL-FEE-1", supplierRef: "INV-1", supplierId: supplier.id, billDate: new Date("2026-09-10T00:00:00Z"),
      amount: 1_000_000, description: "Kain", expenseCategoryId: ctx.kat.id, status: "DISETUJUI", createdById: ctx.user.id,
    },
  });
  const r = await ctx.c.post("/api/finance/supplier-payments", {
    supplierId: supplier.id, date: "2026-09-21", cashAccountId: ctx.bank.id, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST",
    allocations: [{ billId: bill.id, amount: 1_000_000 }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.amount, 1_000_000);
  assert.equal(r.body.totalKeluarRekening, 1_002_500);
  const es = await jurnal("PEMBAYARAN_SUPPLIER", r.body.id);
  assert.equal(es.length, 1);
  assert.equal(totalKredit(es[0]), 1_002_500);
  const utang = es[0].lines.find((l) => l.account.code !== "6-1700" && Number(l.debit) > 0);
  assert.equal(Number(utang.debit), 1_000_000);
  const alokasi = await testPrisma.finSupplierPaymentAllocation.findMany({ where: { paymentId: r.body.id } });
  assert.equal(alokasi.reduce((a, x) => a + Number(x.amount), 0), 1_000_000);
});

test("Kasbon: piutang karyawan = nominal; biaya admin jadi beban, bukan menambah piutang", async () => {
  const ctx = await siapkan();
  const r = await ctx.c.post("/api/finance/kasbon", {
    date: "2026-09-19", amount: 500_000, employeeName: "imam", urgency: "biaya berobat anak",
    cashAccountId: ctx.bank.id, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST",
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.amount, 500_000);
  assert.equal(r.body.totalKeluarRekening, 502_500);
  assert.equal(r.body.sisa, 500_000, "sisa kasbon tetap nominal, tanpa biaya admin");
  const es = await jurnal("KASBON", r.body.id);
  assert.equal(es.length, 1);
  assert.equal(totalKredit(es[0]), 502_500);
  const piutang = es[0].lines.find((l) => l.account.code === "1-1350");
  assert.equal(Number(piutang.debit), 500_000);
});

test("Refund: biaya admin ditanggung perusahaan, nominal refund ke pelanggan tetap utuh", async () => {
  const ctx = await siapkan();
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Erni" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 2_000_000, category: "LAYANAN", orderNumber: `TES-${Date.now()}` } });
  const payment = await testPrisma.payment.create({ data: { orderId: order.id, amount: 2_000_000, method: "CASH", recordedById: ctx.user.id } });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: payment.id, userId: ctx.user.id }));

  const r = await ctx.c.post("/api/finance/refunds", {
    orderId: order.id, date: "2026-09-22", amount: 300_000, reason: "Kasur tidak sesuai",
    cashAccountId: ctx.bank.id, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST",
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.totalKeluarRekening, 302_500);
  const ap = await ctx.c.post(`/api/finance/refunds/${r.body.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const es = await jurnal("REFUND", r.body.id);
  assert.equal(es.length, 1);
  assert.equal(totalKredit(es[0]), 302_500);
  assert.equal(totalDebit(es[0]), 302_500);
});

test("Pembatalan pengeluaran ber-biaya admin membalik SELURUH jurnal termasuk baris biaya", async () => {
  const ctx = await siapkan();
  const r = await ctx.c.post("/api/finance/expenses", badan(ctx, { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" }));
  await ctx.c.post(`/api/finance/expenses/${r.body.id}/approve`, {});
  const cancel = await ctx.c.post(`/api/finance/expenses/${r.body.id}/cancel`, { reason: "Salah input" });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  const beban = await testPrisma.finJournalLine.findMany({
    where: { account: { code: "6-1700" }, entry: { status: { in: ["POSTED", "REVERSED"] } } }, include: { entry: true },
  });
  assert.ok(beban.some((l) => Number(l.debit) === 2500), "baris biaya admin memang pernah terposting");
  const net = beban.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
  assert.equal(net, 0, "biaya admin netto 0 setelah pembatalan (jurnal asli + jurnal balik)");
});

// ═════════════════════════════════════════════════════════════════════════
// Transaksi TERTUNDA (UTANG / REIMBURSEMENT / belum dibayar): biaya admin baru
// dijurnal saat /pay — bukan saat create/approve. Plus koreksi & pratinjau server.
// ═════════════════════════════════════════════════════════════════════════

const nota = "/media/finance-receipts/" + "b".repeat(40) + ".jpg";
const barisAdmin = (e) => e.lines.filter((l) => l.account.code === "6-1700");

async function siapkanTertunda(ctx, { mode = "UTANG", extra = {} } = {}) {
  const body = { date: "2026-09-20", amount: 100_000, description: "Beli perlengkapan", categoryId: ctx.kat.id, mode, payeeName: "Toko Maju", receiptUrl: nota, ...extra };
  if (mode === "REIMBURSEMENT") body.reimburseToId = ctx.user.id;
  const r = await ctx.c.post("/api/finance/expenses", body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

for (const mode of ["UTANG", "REIMBURSEMENT"]) {
  test(`${mode}: biaya dijurnal HANYA saat /pay; create ber-biaya ditolak; jurnal pengakuan tanpa baris biaya`, async () => {
    const ctx = await siapkan();
    const tolak = await ctx.c.post("/api/finance/expenses", {
      date: "2026-09-20", amount: 100_000, description: "x", categoryId: ctx.kat.id, mode, reimburseToId: ctx.user.id,
      paymentMethod: "TRANSFER", transferFeeType: "BI_FAST",
    });
    assert.equal(tolak.status, 400, JSON.stringify(tolak.body));
    assert.match(tolak.body.error, /baru dicatat saat langkah Bayar/i);
    assert.equal(await testPrisma.finExpense.count(), 0);

    const e = await siapkanTertunda(ctx, { mode });
    assert.equal(e.transferFeeAmount, 0);
    const ap = await ctx.c.post(`/api/finance/expenses/${e.id}/approve`, {});
    assert.equal(ap.status, 200, JSON.stringify(ap.body));

    let es = await jurnal("PENGELUARAN", e.id);
    assert.equal(es.length, 1);
    assert.equal(barisAdmin(es[0]).length, 0, "pengakuan beban tidak boleh memuat biaya admin");
    assert.equal(es[0].lines.filter((l) => l.cashAccountId).length, 0, "belum ada uang keluar");

    const bayar = await ctx.c.post(`/api/finance/expenses/${e.id}/pay`, { cashAccountId: ctx.bank.id, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" });
    assert.equal(bayar.status, 200, JSON.stringify(bayar.body));
    es = await jurnal("PENGELUARAN", e.id);
    assert.equal(es.length, 2);
    const bayarJ = es.find((x) => x.idempotencyKey?.startsWith("PENGELUARAN_DIBAYAR"));
    const pengakuan = es.find((x) => x !== bayarJ);
    assert.equal(barisAdmin(pengakuan).length, 0, "jurnal pengakuan tetap tanpa biaya");
    assert.equal(Number(barisAdmin(bayarJ)[0].debit), 2500);
    assert.equal(totalKredit(bayarJ), 102_500);
    assert.equal(totalDebit(bayarJ), 102_500);
    assert.equal(await testPrisma.finExpense.count(), 1);
  });
}

test("Belum dibayar dari Pengajuan Biaya (sumberDana BELUM_DIBAYAR): approve tanpa biaya; biaya baru saat /pay", async () => {
  const ctx = await siapkan();
  const c = ctx.c;
  const created = await c.post("/api/finance/expense-submissions", {
    workspace: "DELIVERY", expenseType: "BBM", date: "2026-09-20", amount: 500_000, vendorName: "SPBU Uji",
    metadata: { liters: 10 }, sumberDana: "BELUM_DIBAYAR",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const aj = await c.post(`/api/finance/expense-submissions/${created.body.id}/ajukan`, {}, { "Idempotency-Key": "fee-belum-dibayar" });
  assert.equal(aj.status, 200, JSON.stringify(aj.body));
  const feId = aj.body.finExpenseId;
  const fe = await testPrisma.finExpense.findUnique({ where: { id: feId } });
  assert.equal(fe.mode, "UTANG");
  assert.equal(Number(fe.transferFeeAmount), 0);
  await testPrisma.finExpense.update({ where: { id: feId }, data: { receiptUrl: nota } });
  assert.equal((await c.post(`/api/finance/expenses/${feId}/approve`, {})).status, 200);
  assert.equal(barisAdmin((await jurnal("PENGELUARAN", feId))[0]).length, 0);
  const bayar = await c.post(`/api/finance/expenses/${feId}/pay`, { cashAccountId: ctx.bank.id, paymentMethod: "TRANSFER", transferFeeType: "TRANSFER_ONLINE" });
  assert.equal(bayar.status, 200, JSON.stringify(bayar.body));
  const semua = await jurnal("PENGELUARAN", feId);
  assert.equal(semua.filter((j) => barisAdmin(j).length > 0).length, 1, "tepat satu jurnal (pembayaran) memuat biaya");
  assert.equal(await testPrisma.finExpense.count(), 1);
});

test("Koreksi: UTANG yang BELUM dibayar tidak boleh membawa biaya admin; setelah DIBAYAR biaya bisa dikoreksi (hanya jurnal pembayaran diganti)", async () => {
  const ctx = await siapkan();
  const e = await siapkanTertunda(ctx, { mode: "UTANG" });
  await ctx.c.post(`/api/finance/expenses/${e.id}/approve`, {});

  const tolak = await ctx.c.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "coba", paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" });
  assert.equal(tolak.status, 400, JSON.stringify(tolak.body));
  assert.match(tolak.body.error, /baru dicatat saat langkah Bayar/i);

  await ctx.c.post(`/api/finance/expenses/${e.id}/pay`, { cashAccountId: ctx.bank.id, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" });

  const ok = await ctx.c.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "Ternyata sesama bank", paymentMethod: "TRANSFER", transferFeeType: "SESAMA_BANK" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.transferFeeAmount, 0);
  const aktif = await jurnal("PENGELUARAN", e.id);
  const bayarJ = aktif.filter((x) => x.idempotencyKey?.includes("PENGELUARAN_DIBAYAR"));
  assert.equal(bayarJ.length, 1, "satu jurnal pembayaran aktif");
  assert.equal(totalKredit(bayarJ[0]), 100_000);
  assert.equal(barisAdmin(bayarJ[0]).length, 0);
});

test("Koreksi LANGSUNG: pindah ke kas tunai wajib Tunai (biaya 0); tetap Transfer ke kas ditolak; jurnal aktif tunggal", async () => {
  const ctx = await siapkan();
  const r = await ctx.c.post("/api/finance/expenses", badan(ctx, { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" }));
  await ctx.c.post(`/api/finance/expenses/${r.body.id}/approve`, {});

  const salah = await ctx.c.post(`/api/finance/expenses/${r.body.id}/koreksi`, { reason: "Pindah rekening", cashAccountId: ctx.kas.id });
  assert.equal(salah.status, 400, "rekening pindah ke kas sementara masih ber-Transfer -> ditolak");
  assert.match(salah.body.error, /kas tunai/i);
  assert.equal((await jurnal("PENGELUARAN", r.body.id)).length, 1, "penolakan tidak mengubah jurnal");

  const ok = await ctx.c.post(`/api/finance/expenses/${r.body.id}/koreksi`, { reason: "Pindah rekening", cashAccountId: ctx.kas.id, paymentMethod: "TUNAI" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.transferFeeAmount, 0);
  const aktif = await jurnal("PENGELUARAN", r.body.id);
  assert.equal(aktif.length, 1);
  assert.equal(barisAdmin(aktif[0]).length, 0);
  assert.equal(totalKredit(aktif[0]), 100_000);
  assert.equal(await testPrisma.finExpense.count(), 1);
});

test("Koreksi pembelian LANGSUNG: metode transfer berubah -> jurnal PEMBELIAN diganti, satu dokumen", async () => {
  const ctx = await siapkan();
  const r = await ctx.c.post("/api/finance/purchases", {
    date: "2026-09-20", amount: 200_000, description: "Busa", categoryId: ctx.katBeli.id, mode: "LANGSUNG", cashAccountId: ctx.bank.id,
    paymentMethod: "TRANSFER", transferFeeType: "TRANSFER_ONLINE", receiptUrl: nota,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await ctx.c.post(`/api/finance/purchases/${r.body.id}/approve`, {})).status, 200);
  const k = await ctx.c.post(`/api/finance/purchases/${r.body.id}/koreksi`, { reason: "Salah metode", transferFeeType: "LAINNYA", paymentMethod: "TRANSFER", transferFeeAmount: 4000 });
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.equal(k.body.transferFeeAmount, 4000);
  const aktif = await jurnal("PEMBELIAN", r.body.id);
  assert.equal(aktif.length, 1);
  assert.equal(totalKredit(aktif[0]), 204_000);
  assert.equal(await testPrisma.finPurchase.count(), 1);
});

test("Pembelian UTANG: create ber-biaya ditolak", async () => {
  const ctx = await siapkan();
  const r = await ctx.c.post("/api/finance/purchases", {
    date: "2026-09-20", amount: 200_000, description: "Busa", categoryId: ctx.katBeli.id, mode: "UTANG",
    paymentMethod: "TRANSFER", transferFeeType: "BI_FAST",
  });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(await testPrisma.finPurchase.count(), 0);
});

test("Pratinjau SERVER: angka & aturan sama dengan saat menyimpan (preset per rekening, custom, error)", async () => {
  const ctx = await siapkan();
  const p1 = await ctx.c.post("/api/finance/transfer-fee/preview", { cashAccountId: ctx.bank.id, amount: 100_000, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST", transferFeeAmount: 1 });
  assert.equal(p1.status, 200, JSON.stringify(p1.body));
  assert.deepEqual([p1.body.nominalDiterima, p1.body.biayaAdmin, p1.body.totalKeluarRekening], [100_000, 2500, 102_500], "nominal preset dari klien diabaikan");

  await ctx.c.patch(`/api/finance/cash-accounts/${ctx.bank.id}`, { transferFeePresets: { BI_FAST: 3200 } });
  const p2 = await ctx.c.post("/api/finance/transfer-fee/preview", { cashAccountId: ctx.bank.id, amount: 100_000, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" });
  assert.equal(p2.body.biayaAdmin, 3200);
  const simpan = await ctx.c.post("/api/finance/expenses", badan(ctx, { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" }));
  assert.equal(simpan.body.totalKeluarRekening, p2.body.totalKeluarRekening);

  const c = await ctx.c.post("/api/finance/transfer-fee/preview", { cashAccountId: ctx.bank.id, amount: 50_000, paymentMethod: "TRANSFER", transferFeeType: "LAINNYA", transferFeeAmount: 9000 });
  assert.equal(c.body.totalKeluarRekening, 59_000);
  const buruk = await ctx.c.post("/api/finance/transfer-fee/preview", { cashAccountId: ctx.kas.id, amount: 50_000, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" });
  assert.equal(buruk.status, 400);
  const tanpaLogin = await fetch(`${server.baseUrl}/api/finance/transfer-fee/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(tanpaLogin.status, 401);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENGELUARAN" } }), 0, "pratinjau tidak menulis apa pun");
});
