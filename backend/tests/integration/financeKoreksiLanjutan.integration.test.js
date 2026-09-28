// B3.8 — KOREKSI FINANCE LANJUTAN (tagihan supplier & refund yang sudah disetujui). Yang dikunci:
//  - Koreksi = dokumen lama DIBATALKAN + jurnal lama REVERSED (isi tetap) + dokumen baru (replaces, UNIQUE) + jurnal pengganti,
//    dalam SATU transaksi: gagal di mana pun = dokumen lama & jurnal lama tetap utuh (tidak ada setengah koreksi).
//  - Pratinjau tidak menulis apa pun; menyimpan butuh PIN step-up; alasan wajib; permission server (FINANCE_ADMIN).
//  - Blokir: pembayaran supplier aktif, sudah direkonsiliasi, sudah diganti, pengakuan pendapatan berubah (refund), melebihi uang diterima.
//  - Koreksi paralel: satu menang, satu 409. Riwayat menelusuri rantai versi.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postPaymentReceived, postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const bank2 = await testPrisma.finCashAccount.create({ data: { name: "Mandiri", kind: "BANK", accountId: akunBank.id } });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  const kat2 = await testPrisma.finExpenseCategory.findUnique({ where: { code: "ADMIN_BANK" } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-K", name: "CV Tekstil" } });
  return {
    bank, bank2, kat, kat2, admin, finance, supplier,
    a: makeClient(server.baseUrl, admin.token),                             // membawa step-up otomatis
    aTanpa: makeClient(server.baseUrl, admin.token, { tanpaStepUp: true }),  // untuk menguji PIN
    f: makeClient(server.baseUrl, finance.token),
  };
}

const jurnalPer = (source, sourceId) => testPrisma.finJournalEntry.findMany({
  where: { source, sourceId }, include: { lines: { include: { account: { select: { code: true } } } } }, orderBy: { createdAt: "asc" },
});
const sumD = (e) => e.lines.reduce((a, l) => a + Number(l.debit), 0);
async function pastikanBukuSeimbang() {
  const lines = await testPrisma.finJournalLine.findMany({ select: { debit: true, credit: true } });
  const d = lines.reduce((a, l) => a + Number(l.debit), 0);
  const k = lines.reduce((a, l) => a + Number(l.credit), 0);
  assert.equal(d, k, `buku besar harus seimbang (debit ${d} vs kredit ${k})`);
}
async function saldoAkun(systemKey) {
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: akun.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(agg._sum.debit || 0) - Number(agg._sum.credit || 0);
}
async function mutasiRekening(cashAccountId) {
  const rek = await testPrisma.finCashAccount.findUnique({ where: { id: cashAccountId } });
  const baris = await testPrisma.finJournalLine.findMany({ where: { cashAccountId, accountId: rek.accountId, entry: { status: { in: ["POSTED", "REVERSED"] } } } });
  return baris.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
}

async function tagihanDisetujui(ctx, extra = {}) {
  const b = await ctx.a.post("/api/finance/bills", { supplierId: ctx.supplier.id, billDate: "2026-09-10", amount: 1_000_000, description: "Jasa jahit", billType: "JASA_OPERASIONAL", expenseCategoryId: ctx.kat.id, supplierRef: "INV-77", ...extra });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const ap = await ctx.a.post(`/api/finance/bills/${b.body.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  return b.body;
}

// ── TAGIHAN SUPPLIER ─────────────────────────────────────────────────────
test("Koreksi tagihan disetujui: versi pengganti, jurnal lama REVERSED (isi tetap), pengganti bernilai baru, Utang Usaha bergeser SEKALI, buku seimbang", async () => {
  const ctx = await siapkan();
  const b = await tagihanDisetujui(ctx);
  const asli = (await jurnalPer("TAGIHAN_SUPPLIER", b.id))[0];
  assert.equal(sumD(asli), 1_000_000);
  assert.equal(await saldoAkun(SYSTEM_KEYS.UTANG_USAHA), -1_000_000);

  const tanpaAlasan = await ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { amount: 1_200_000 });
  assert.equal(tanpaAlasan.status, 400);
  assert.equal(tanpaAlasan.body.code, "ALASAN_WAJIB");

  // PRATINJAU: tanpa PIN, tidak menulis apa pun.
  const sebelumJurnal = await testPrisma.finJournalEntry.count();
  const pv = await ctx.aTanpa.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "Nominal di faktur berbeda", amount: 1_200_000, preview: true });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.equal(pv.body.pratinjau.jurnalDibalik.length, 1);
  assert.equal(pv.body.pratinjau.jurnalPengganti[0].totalDebit, 1_200_000);
  assert.equal(pv.body.pratinjau.seimbang, true);
  assert.equal(await testPrisma.finJournalEntry.count(), sebelumJurnal, "pratinjau di-ROLLBACK");
  assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: b.id } })).status, "DISETUJUI");
  assert.equal(await testPrisma.finSupplierBill.count(), 1);

  // Simpan sungguhan tanpa PIN → 403.
  const tanpaPin = await ctx.aTanpa.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "Nominal di faktur berbeda", amount: 1_200_000 });
  assert.equal(tanpaPin.status, 403);
  assert.ok(["STEPUP_DIPERLUKAN", "STEPUP_PIN_BELUM_DIATUR"].includes(tanpaPin.body.code));
  assert.equal(await testPrisma.finJournalEntry.count(), sebelumJurnal);

  const k = await ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "Nominal di faktur berbeda", amount: 1_200_000, description: "Jasa jahit (revisi)" });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const lama = await testPrisma.finSupplierBill.findUnique({ where: { id: b.id } });
  const baru = await testPrisma.finSupplierBill.findUnique({ where: { id: k.body.baruId } });
  assert.equal(lama.status, "DIBATALKAN");
  assert.match(lama.rejectReason, /^Dikoreksi — Nominal di faktur berbeda/);
  assert.equal(baru.status, "DISETUJUI");
  assert.equal(baru.replacesBillId, lama.id);
  assert.equal(Number(baru.amount), 1_200_000);
  assert.equal(baru.description, "Jasa jahit (revisi)");
  assert.equal(baru.supplierRef, "INV-77", "data yang tidak diubah ikut terbawa");

  const jl = await jurnalPer("TAGIHAN_SUPPLIER", b.id);
  assert.equal(jl.length, 1);
  assert.equal(jl[0].status, "REVERSED");
  assert.equal(sumD(jl[0]), 1_000_000, "isi jurnal lama TIDAK berubah");
  const jb = await jurnalPer("TAGIHAN_SUPPLIER", baru.id);
  assert.equal(jb.length, 1);
  assert.equal(jb[0].status, "POSTED");
  assert.equal(sumD(jb[0]), 1_200_000);
  assert.equal(await saldoAkun(SYSTEM_KEYS.UTANG_USAHA), -1_200_000, "Utang Usaha = nominal baru, bukan dobel");
  await pastikanBukuSeimbang();

  // Koreksi ulang versi LAMA ditolak (sudah diganti); versi baru boleh dikoreksi lagi (rantai).
  const ulang = await ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "lagi", amount: 900_000 });
  assert.equal(ulang.status, 409);
  assert.equal(ulang.body.code, "SUDAH_DIGANTI");
  const k2 = await ctx.a.post(`/api/finance/bills/${baru.id}/koreksi`, { reason: "Ternyata 1,1 juta", amount: 1_100_000 });
  assert.equal(k2.status, 201, JSON.stringify(k2.body));
  assert.equal(await saldoAkun(SYSTEM_KEYS.UTANG_USAHA), -1_100_000);

  const rw = await ctx.a.get(`/api/finance/riwayat-versi/bills/${k2.body.baruId}`);
  assert.equal(rw.status, 200, JSON.stringify(rw.body));
  assert.equal(rw.body.rantai.length, 3, "rantai 3 versi");
  assert.ok(rw.body.rantai[2].terbaru);
  assert.ok(rw.body.versi.filter((v) => v.aksi === "Dikoreksi").length === 2, "tiap koreksi tampil SEKALI");
  assert.equal(rw.body.jurnal.length, 5, "3 jurnal tagihan + 2 jurnal balik");
});

test("Tagihan: blokir bila ada pembayaran supplier aktif; menu di daftar mencerminkan alasan; boleh lagi setelah pembayaran dibatalkan", async () => {
  const ctx = await siapkan();
  const b = await tagihanDisetujui(ctx);
  const bayar = await ctx.a.post("/api/finance/supplier-payments", { supplierId: ctx.supplier.id, date: "2026-09-21", cashAccountId: ctx.bank.id, allocations: [{ billId: b.id, amount: 400_000 }] });
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));

  const list = await ctx.a.get("/api/finance/bills");
  const item = list.body.bills.find((x) => x.id === b.id);
  assert.equal(item.koreksi.aktif, false);
  assert.equal(item.koreksi.kode, "ADA_PEMBAYARAN");
  const blok = await ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "salah", amount: 900_000 });
  assert.equal(blok.status, 409);
  assert.equal(blok.body.code, "ADA_PEMBAYARAN");
  assert.equal((await jurnalPer("TAGIHAN_SUPPLIER", b.id))[0].status, "POSTED", "tidak ada yang tersentuh");

  assert.equal((await ctx.a.post(`/api/finance/supplier-payments/${bayar.body.id}/cancel`, { reason: "salah rekening" })).status, 200);
  const ok = await ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "Nominal salah", amount: 900_000 });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const list2 = await ctx.a.get("/api/finance/bills");
  assert.equal(list2.body.bills.find((x) => x.id === b.id).koreksi.kode, "SUDAH_DIGANTI");
  assert.equal(list2.body.bills.find((x) => x.id === ok.body.baruId).koreksi.aktif, true);
  await pastikanBukuSeimbang();
});

test("Tagihan: permission server (FINANCE bukan FINANCE_ADMIN → 403), jenis tagihan tidak bisa diubah, tanpa perubahan ditolak", async () => {
  const ctx = await siapkan();
  const b = await tagihanDisetujui(ctx);
  assert.equal((await ctx.f.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "x", amount: 900_000 })).status, 403);
  const jenis = await ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "x", billType: "BAHAN_BAKU" });
  assert.equal(jenis.status, 409);
  assert.equal(jenis.body.code, "JENIS_TIDAK_BISA_DIUBAH");
  const sama = await ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "x", amount: 1_000_000 });
  assert.equal(sama.status, 400);
  assert.equal(sama.body.code, "TANPA_PERUBAHAN");
  const kat = await ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "Salah kategori", expenseCategoryId: ctx.kat2.id });
  assert.equal(kat.status, 201, JSON.stringify(kat.body));
  const baru = await jurnalPer("TAGIHAN_SUPPLIER", kat.body.baruId);
  assert.ok(baru[0].lines.some((l) => Number(l.debit) === 1_000_000), "beban pindah ke akun kategori baru");
  await pastikanBukuSeimbang();
});

test("Tagihan: sudah dicocokkan ke mutasi bank → SUDAH_DIREKONSILIASI; /info (administratif) tanpa jurnal & tanpa PIN, alasan wajib, audit sebelum/sesudah", async () => {
  const ctx = await siapkan();
  const b = await tagihanDisetujui(ctx);
  const baris = await testPrisma.finJournalLine.findFirst({ where: { entry: { source: "TAGIHAN_SUPPLIER", sourceId: b.id } } });
  const st = await testPrisma.finBankStatement.create({ data: { cashAccountId: ctx.bank.id, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30"), openingBalance: 0, closingBalance: 0, status: "DRAFT" } });
  await testPrisma.finBankStatementLine.create({ data: { statementId: st.id, date: new Date("2026-09-10"), description: "x", amount: 1, status: "COCOK", matchedLineId: baris.id } });
  const k = await ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "x", amount: 900_000 });
  assert.equal(k.status, 409);
  assert.equal(k.body.code, "SUDAH_DIREKONSILIASI");

  const sebelum = await testPrisma.finJournalEntry.count();
  assert.equal((await ctx.aTanpa.post(`/api/finance/bills/${b.id}/info`, { supplierRef: "INV-78" })).status, 400, "alasan wajib");
  const info = await ctx.aTanpa.post(`/api/finance/bills/${b.id}/info`, { reason: "Salah ketik nomor faktur", supplierRef: "INV-78", dueDate: "2026-10-15" });
  assert.equal(info.status, 200, JSON.stringify(info.body));
  assert.equal(info.body.before.supplierRef, "INV-77");
  assert.equal(info.body.after.supplierRef, "INV-78");
  assert.equal(await testPrisma.finJournalEntry.count(), sebelum, "info tidak menyentuh jurnal");
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: b.id, eventType: "DOCUMENT_EDITED" }, orderBy: { createdAt: "desc" } });
  assert.equal(ev.metadata.reason, "Salah ketik nomor faktur");
  assert.equal((await ctx.f.post(`/api/finance/bills/${b.id}/info`, { reason: "ok", supplierRef: "INV-79" })).status, 200, "FINANCE_POST boleh edit informasi");
});

test("Tagihan: dua koreksi paralel → satu menang, satu 409; hanya satu dokumen pengganti dan satu set jurnal", async () => {
  const ctx = await siapkan();
  const b = await tagihanDisetujui(ctx);
  const hasil = await Promise.all([
    ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "A", amount: 1_300_000 }),
    ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "B", amount: 1_400_000 }),
  ]);
  const status = hasil.map((h) => h.status).sort();
  assert.deepEqual(status, [201, 409], JSON.stringify(hasil.map((h) => h.body)));
  assert.equal(await testPrisma.finSupplierBill.count(), 2);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 1);
  assert.ok([-1_300_000, -1_400_000].includes(await saldoAkun(SYSTEM_KEYS.UTANG_USAHA)));
  await pastikanBukuSeimbang();
});

test("Tagihan: kegagalan di tengah koreksi (kategori tidak valid) → ROLLBACK total, dokumen & jurnal lama utuh", async () => {
  const ctx = await siapkan();
  const b = await tagihanDisetujui(ctx);
  const gagal = await ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "coba", amount: 1_100_000, expenseCategoryId: "00000000-0000-4000-8000-000000000000" });
  assert.ok([400, 404].includes(gagal.status), JSON.stringify(gagal.body));
  const utuh = await testPrisma.finSupplierBill.findUnique({ where: { id: b.id } });
  assert.equal(utuh.status, "DISETUJUI");
  assert.equal(Number(utuh.amount), 1_000_000);
  assert.equal(await testPrisma.finSupplierBill.count(), 1);
  assert.equal((await jurnalPer("TAGIHAN_SUPPLIER", b.id))[0].status, "POSTED");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 0);
});

// ── REFUND ───────────────────────────────────────────────────────────────
async function refundDisetujui(ctx, { nominalBayar = 2_000_000, nominalRefund = 300_000, diakui = false } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Erni" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: nominalBayar, category: "LAYANAN", orderNumber: `TES-${Date.now()}-${Math.floor(Math.random() * 1e6)}` } });
  const payment = await testPrisma.payment.create({ data: { orderId: order.id, amount: nominalBayar, method: "CASH", recordedById: ctx.admin.user.id } });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: payment.id, userId: ctx.admin.user.id }));
  if (diakui) await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: ctx.admin.user.id }));
  const r = await ctx.a.post("/api/finance/refunds", { orderId: order.id, date: "2026-09-22", amount: nominalRefund, reason: "Kasur tidak sesuai", cashAccountId: ctx.bank.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ap = await ctx.a.post(`/api/finance/refunds/${r.body.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  return { order, refund: r.body };
}

test("Koreksi refund disetujui: nominal+rekening+biaya transfer → versi pengganti, kas pulih lalu keluar sekali, order dihitung ulang; PIN & alasan wajib", async () => {
  const ctx = await siapkan();
  const { order, refund } = await refundDisetujui(ctx);
  assert.equal(await mutasiRekening(ctx.bank.id), -300_000);

  assert.equal((await ctx.a.post(`/api/finance/refunds/${refund.id}/koreksi`, { amount: 250_000 })).status, 400, "alasan wajib");
  const pv = await ctx.aTanpa.post(`/api/finance/refunds/${refund.id}/koreksi`, { reason: "Disepakati ulang", amount: 250_000, cashAccountId: ctx.bank2.id, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST", preview: true });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.equal(pv.body.pratinjau.jurnalPengganti[0].totalDebit, 252_500);
  assert.equal(await mutasiRekening(ctx.bank2.id), 0, "pratinjau tidak menulis");
  assert.equal((await ctx.aTanpa.post(`/api/finance/refunds/${refund.id}/koreksi`, { reason: "Disepakati ulang", amount: 250_000 })).status, 403);

  const k = await ctx.a.post(`/api/finance/refunds/${refund.id}/koreksi`, { reason: "Disepakati ulang", amount: 250_000, cashAccountId: ctx.bank2.id, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const lama = await testPrisma.finRefund.findUnique({ where: { id: refund.id } });
  const baru = await testPrisma.finRefund.findUnique({ where: { id: k.body.baruId } });
  assert.equal(lama.status, "DIBATALKAN");
  assert.equal(baru.status, "DISETUJUI");
  assert.equal(baru.replacesRefundId, lama.id);
  assert.equal(Number(baru.amount), 250_000);
  assert.equal(Number(baru.transferFeeAmount), 2500);
  assert.equal(baru.reason, "Kasur tidak sesuai", "alasan refund terbawa");
  assert.equal(await mutasiRekening(ctx.bank.id), 0, "kas rekening lama pulih lewat reversal");
  assert.equal(await mutasiRekening(ctx.bank2.id), -252_500);
  const jl = await jurnalPer("REFUND", lama.id);
  assert.equal(jl[0].status, "REVERSED");
  assert.equal(sumD(jl[0]), 300_000, "isi jurnal lama tetap");
  await pastikanBukuSeimbang();

  const ord = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.ok(ord.paymentStatus, "status bayar order dihitung ulang");
  const rw = await ctx.a.get(`/api/finance/riwayat-versi/refunds/${baru.id}`);
  assert.equal(rw.status, 200);
  assert.equal(rw.body.rantai.length, 2);
  assert.ok(rw.body.versi.some((v) => v.aksi === "Dikoreksi" && v.alasan === "Disepakati ulang"));
  assert.equal((await ctx.a.post(`/api/finance/refunds/${refund.id}/koreksi`, { reason: "lagi", amount: 100_000 })).body.code, "SUDAH_DIGANTI");
  assert.equal((await ctx.f.post(`/api/finance/refunds/${baru.id}/koreksi`, { reason: "x", amount: 100_000 })).status, 403);
});

test("Refund: nominal melebihi uang diterima → 409 dan ROLLBACK total (refund lama tetap DISETUJUI, jurnal lama POSTED)", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx, { nominalBayar: 500_000, nominalRefund: 300_000 });
  const k = await ctx.a.post(`/api/finance/refunds/${refund.id}/koreksi`, { reason: "salah ketik", amount: 900_000 });
  assert.equal(k.status, 409, JSON.stringify(k.body));
  assert.equal(k.body.code, "MELEBIHI_UANG_DITERIMA");
  assert.equal((await testPrisma.finRefund.findUnique({ where: { id: refund.id } })).status, "DISETUJUI");
  assert.equal(await testPrisma.finRefund.count(), 1);
  assert.equal((await jurnalPer("REFUND", refund.id))[0].status, "POSTED");
  assert.equal(await mutasiRekening(ctx.bank.id), -300_000);
  await pastikanBukuSeimbang();
});

test("Refund: diblokir bila sudah dicocokkan ke mutasi bank, periode rekonsiliasi SELESAI, atau pengakuan pendapatan berubah sejak refund dibukukan", async () => {
  const ctx = await siapkan();
  // (a) dicocokkan ke mutasi bank
  const a = await refundDisetujui(ctx);
  const baris = await testPrisma.finJournalLine.findFirst({ where: { cashAccountId: ctx.bank.id, entry: { source: "REFUND", sourceId: a.refund.id } } });
  const st = await testPrisma.finBankStatement.create({ data: { cashAccountId: ctx.bank.id, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30"), openingBalance: 0, closingBalance: -300000, status: "DRAFT" } });
  await testPrisma.finBankStatementLine.create({ data: { statementId: st.id, date: new Date("2026-09-22"), description: "Refund", amount: -300000, status: "COCOK", matchedLineId: baris.id } });
  const k1 = await ctx.a.post(`/api/finance/refunds/${a.refund.id}/koreksi`, { reason: "x", amount: 200_000 });
  assert.equal(k1.status, 409);
  assert.equal(k1.body.code, "SUDAH_DIREKONSILIASI");

  // (b) periode SELESAI untuk rekening tujuan/tanggal baru
  const b = await refundDisetujui(ctx);
  await testPrisma.finBankStatement.create({ data: { cashAccountId: ctx.bank2.id, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30"), openingBalance: 0, closingBalance: 0, status: "SELESAI" } });
  const k2 = await ctx.a.post(`/api/finance/refunds/${b.refund.id}/koreksi`, { reason: "pindah rekening", cashAccountId: ctx.bank2.id });
  assert.equal(k2.status, 409, JSON.stringify(k2.body));
  assert.equal(k2.body.code, "PERIODE_REKON_SELESAI");

  // (c) refund dibukukan SEBELUM pendapatan diakui (akun lawan = Uang Muka), lalu pendapatan diakui → ambigu
  const c = await refundDisetujui(ctx);
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: c.order.id, userId: ctx.admin.user.id }));
  const k3 = await ctx.a.post(`/api/finance/refunds/${c.refund.id}/koreksi`, { reason: "koreksi", amount: 200_000 });
  assert.equal(k3.status, 409, JSON.stringify(k3.body));
  assert.equal(k3.body.code, "PENGAKUAN_PENDAPATAN_BERUBAH");
  const list = await ctx.a.get("/api/finance/refunds");
  assert.equal(list.body.refunds.find((r) => r.id === c.refund.id).koreksi.kode, "PENGAKUAN_PENDAPATAN_BERUBAH");
});

test("Refund yang dibukukan SETELAH pendapatan diakui (Retur Penjualan) bisa dikoreksi; /info mengubah alasan & lampiran tanpa jurnal", async () => {
  const ctx = await siapkan();
  const { refund } = await refundDisetujui(ctx, { diakui: true });
  const j0 = await testPrisma.finJournalEntry.count();
  const info = await ctx.aTanpa.post(`/api/finance/refunds/${refund.id}/info`, { reason: "Perjelas alasan", alasanRefund: "Kasur tidak sesuai ukuran" });
  assert.equal(info.status, 200, JSON.stringify(info.body));
  assert.equal(await testPrisma.finJournalEntry.count(), j0);
  assert.equal((await testPrisma.finRefund.findUnique({ where: { id: refund.id } })).reason, "Kasur tidak sesuai ukuran");
  const k = await ctx.a.post(`/api/finance/refunds/${refund.id}/koreksi`, { reason: "Nominal dikurangi", amount: 200_000 });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const jb = await jurnalPer("REFUND", k.body.baruId);
  assert.ok(jb[0].lines.some((l) => l.account.code && Number(l.debit) === 200_000));
  assert.equal(await mutasiRekening(ctx.bank.id), -200_000);
  await pastikanBukuSeimbang();
});

test("Kasbon & Pembayaran Supplier: riwayat-versi tersedia (dipakai tombol Riwayat di UI)", async () => {
  const ctx = await siapkan();
  const b = await tagihanDisetujui(ctx);
  const bayar = await ctx.a.post("/api/finance/supplier-payments", { supplierId: ctx.supplier.id, date: "2026-09-21", cashAccountId: ctx.bank.id, allocations: [{ billId: b.id, amount: 300_000 }] });
  assert.equal(bayar.status, 201);
  const rp = await ctx.a.get(`/api/finance/riwayat-versi/supplier-payments/${bayar.body.id}`);
  assert.equal(rp.status, 200, JSON.stringify(rp.body));
  assert.ok(rp.body.jurnal.length >= 1);
  assert.equal((await ctx.f.get(`/api/finance/riwayat-versi/supplier-payments/${bayar.body.id}`)).status, 200);
});

// ── Temuan review Opus (invarian reversal) ───────────────────────────────
test("Periode akuntansi tertutup memblokir koreksi tagihan & refund (jurnal lama dibalik pada tanggal aslinya); menu jujur; tidak ada yang tersentuh", async () => {
  const ctx = await siapkan();
  const b = await tagihanDisetujui(ctx);            // 2026-09-10
  const { refund } = await refundDisetujui(ctx);     // 2026-09-22
  await testPrisma.finPeriod.upsert({ where: { year_month: { year: 2026, month: 9 } }, update: { status: "CLOSED" }, create: { year: 2026, month: 9, status: "CLOSED" } });
  const kb = await ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "x", amount: 900_000 });
  assert.equal(kb.status, 409); assert.equal(kb.body.code, "PERIODE_AKUNTANSI_TUTUP"); assert.match(kb.body.error, /09\/2026/);
  const kr = await ctx.a.post(`/api/finance/refunds/${refund.id}/koreksi`, { reason: "x", amount: 200_000 });
  assert.equal(kr.status, 409); assert.equal(kr.body.code, "PERIODE_AKUNTANSI_TUTUP");
  assert.equal((await ctx.a.get("/api/finance/bills")).body.bills.find((x) => x.id === b.id).koreksi.kode, "PERIODE_AKUNTANSI_TUTUP");
  assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: b.id } })).status, "DISETUJUI");
  assert.equal(await testPrisma.finRefund.count(), 1);
});

test("Validasi input: tanggal yang tidak ada di kalender (2026-02-31) ditolak; id rusak → 400 (bukan 500)", async () => {
  const ctx = await siapkan();
  const b = await tagihanDisetujui(ctx);
  const t = await ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "x", billDate: "2026-02-31" });
  assert.equal(t.status, 400); assert.equal(t.body.code, "TANGGAL_TIDAK_VALID");
  const s = await ctx.a.post(`/api/finance/bills/${b.id}/koreksi`, { reason: "x", supplierId: "bukan-uuid" });
  assert.equal(s.status, 400); assert.equal(s.body.code, "ID_TIDAK_VALID");
  const { refund } = await refundDisetujui(ctx);
  const r = await ctx.a.post(`/api/finance/refunds/${refund.id}/koreksi`, { reason: "x", cashAccountId: "ngawur" });
  assert.equal(r.status, 400); assert.equal(r.body.code, "ID_TIDAK_VALID");
  assert.equal((await ctx.a.post(`/api/finance/bills/00000000-0000-4000-8000-000000000000/koreksi`, { reason: "x", amount: 5 })).status, 404);
  assert.equal((await ctx.a.post(`/api/finance/bills/bukan-uuid/koreksi`, { reason: "x", amount: 5 })).status, 404);
});

test("Koreksi tagihan bahan baku PERIODIK tidak terkunci oleh penerimaan Gudang supplier yang sama yang datang KEMUDIAN (supplier tidak berubah)", async () => {
  const ctx = await siapkan();
  const sup = await testPrisma.finSupplier.create({ data: { code: "SUP-SKY", name: "PT Sky Foam", aliases: ["Skyfoam"] } });
  const b = await ctx.a.post("/api/finance/bills", { supplierId: sup.id, billDate: "2026-09-09", amount: 5_000_000, description: "Busa rebonded", billType: "BAHAN_BAKU" });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal((await ctx.a.post(`/api/finance/bills/${b.body.id}/approve`, {})).status, 200);
  // penerimaan Gudang supplier yang sama datang KEMUDIAN, sudah dibukukan, belum ditagih
  const { createTestMaterial } = await import("./setup/fixtures.js");
  const { postGoodsReceiptValue } = await import("../../src/services/finance/posting/supplier.js");
  const material = await createTestMaterial({ unit: "PCS" });
  const gr = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-250926-77", sourceType: "MANUAL", supplier: "Skyfoam", status: "COMPLETED" } });
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 10, unitCost: 50_000, goodsReceiptId: gr.id } });
  await testPrisma.$transaction((tx) => postGoodsReceiptValue(tx, { goodsReceiptId: gr.id, userId: ctx.admin.user.id }));

  const k = await ctx.a.post(`/api/finance/bills/${b.body.id}/koreksi`, { reason: "Nominal di faktur 4,8 juta", amount: 4_800_000 });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const baru = await jurnalPer("TAGIHAN_SUPPLIER", k.body.baruId);
  assert.ok(baru[0].lines.some((l) => Number(l.debit) === 4_800_000), "Dr 5-1100 sebesar nominal baru");
  await pastikanBukuSeimbang();
});
