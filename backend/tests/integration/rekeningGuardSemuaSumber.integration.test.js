// KONTROL REKENING PADA SEMUA JALUR POSTING (15 Okt 2026). Aturan: posting BARU yang menyentuh akun Kas/Bank wajib menyebut rekening pada sisi Kas/Bank SAJA; lawan (beban/utang/piutang) tidak boleh
// ditandai rekening; transfer antar-rekening berpasangan & seimbang; biaya BI-FAST/admin = Dr Beban Administrasi Bank + Cr rekening sumber (bukan uang masuk). Data lama tidak diubah.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal, pastikanTransferBerpasangan, normalizeLines, JournalError } from "../../src/services/finance/journal.js";
import { postCashTransfer } from "../../src/services/finance/posting/cash.js";
import { postVehicleExpense, postAdSpend } from "../../src/services/finance/posting/expense.js";
import { barisBiayaAdmin } from "../../src/services/finance/transferFee.js";
import { saldoKasBank } from "../../src/services/finance/reports.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const a = (where) => testPrisma.finAccount.findUnique({ where });
  const akunBank = await a({ systemKey: SYSTEM_KEYS.BANK });
  const akunKas = await a({ systemKey: SYSTEM_KEYS.KAS });
  const modal = await a({ code: "3-1100" });
  const bebanAdmin = await a({ code: "6-1700" });
  const beban = await testPrisma.finAccount.findFirst({ where: { type: "BEBAN", isPostable: true, NOT: { code: "6-1700" } } });
  const ptSano = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const kem = await testPrisma.finCashAccount.create({ data: { name: "KEM", kind: "BANK", accountId: akunBank.id } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Uang Kas", kind: "KAS", accountId: akunKas.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  return { akunBank, akunKas, modal, bebanAdmin, beban, ptSano, kem, kas, admin: makeClient(server.baseUrl, admin.token), adminUser: admin.user };
}
const post = (w, source, lines, extra = {}) => testPrisma.$transaction((tx) => postJournal(tx, { date: "2026-10-01", description: "uji", source, lines, userId: w.adminUser.id, ...extra }));
const saldo = async (nama) => (await saldoKasBank(testPrisma)).find((s) => s.name === nama).saldo;

test("SEMUA sumber jurnal: baris pada akun Bank/Kas TANPA rekening ditolak dengan pesan Indonesia dan tidak ada yang tersimpan (bukan hanya jurnal manual)", async () => {
  const w = await dunia();
  for (const source of ["PENGELUARAN", "PEMBELIAN", "PEMBAYARAN_ORDER", "REFUND", "PEMBAYARAN_SUPPLIER", "KASBON", "BIAYA_IKLAN", "TRANSFER_KAS", "MANUAL", "PEMASUKAN_LAIN"]) {
    await assert.rejects(() => post(w, source, [{ accountId: w.beban.id, debit: 1000 }, { accountId: w.akunBank.id, credit: 1000 }]), (e) => e instanceof JournalError && /akun kas\/bank wajib memilih rekeningnya/.test(e.message), source);
  }
  await assert.rejects(() => post(w, "PENGELUARAN", [{ accountId: w.beban.id, debit: 1000 }, { accountId: w.akunKas.id, credit: 1000 }]), /wajib memilih rekeningnya/, "akun Kas juga");
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
  // dengan rekening: lolos untuk semua sumber
  await post(w, "PENGELUARAN", [{ accountId: w.beban.id, debit: 1000 }, { accountId: w.akunBank.id, credit: 1000, cashAccountId: w.ptSano.id }]);
  assert.equal(await saldo("PT Sano"), -1000);
});

test("Lawan (beban/utang/piutang) tidak boleh ditandai rekening; satu baris hanya rekening akunnya sendiri; rekening KAS tidak boleh dipasang pada akun Bank", async () => {
  const w = await dunia();
  await assert.rejects(() => post(w, "PENGELUARAN", [{ accountId: w.beban.id, debit: 1000, cashAccountId: w.ptSano.id }, { accountId: w.akunBank.id, credit: 1000, cashAccountId: w.ptSano.id }]), /hanya boleh dipakai pada akun kas\/bank-nya sendiri/);
  await assert.rejects(() => post(w, "PENGELUARAN", [{ accountId: w.beban.id, debit: 1000 }, { accountId: w.akunBank.id, credit: 1000, cashAccountId: w.kas.id }]), /hanya boleh dipakai pada akun kas\/bank-nya sendiri/);
});

test("Biaya BI-FAST/admin: Dr Beban Administrasi Bank (tanpa rekening) + Cr rekening sumber bersama nominal utama — saldo turun nominal + biaya, tidak pernah dianggap uang masuk (barisBiayaAdmin & transfer)", async () => {
  const w = await dunia();
  const baris = await testPrisma.$transaction((tx) => barisBiayaAdmin(tx, { fee: 2_500, cashAccount: w.ptSano }));
  assert.equal(baris.length, 1);
  assert.equal(baris[0].accountId, w.bebanAdmin.id);
  assert.equal(baris[0].cashAccountId, undefined, "baris biaya tidak membawa rekening");
  const t = await testPrisma.finCashTransfer.create({ data: { transferNumber: "TRF-G1", date: new Date("2026-10-01T00:00:00Z"), amount: 5_000_000, fromAccountId: w.ptSano.id, toAccountId: w.kem.id, feeAmount: 2_500, createdById: w.adminUser.id } });
  await testPrisma.$transaction((tx) => postCashTransfer(tx, { transferId: t.id, userId: w.adminUser.id }));
  assert.equal(await saldo("PT Sano"), -5_002_500);
  assert.equal(await saldo("KEM"), 5_000_000);
  const beban = await testPrisma.finJournalLine.findFirst({ where: { accountId: w.bebanAdmin.id } });
  assert.equal(beban.cashAccountId, null);
  assert.equal(Number(beban.debit), 2_500);
  // upaya menandai baris biaya ke rekening ditolak
  await assert.rejects(() => post(w, "PEMBAYARAN_SUPPLIER", [{ accountId: w.beban.id, debit: 100_000 }, { accountId: w.bebanAdmin.id, debit: 2_500, cashAccountId: w.ptSano.id }, { accountId: w.akunBank.id, cashAccountId: w.ptSano.id, credit: 102_500 }]), /hanya boleh dipakai pada akun kas\/bank-nya sendiri/);
});

test("TRANSFER berpasangan & seimbang: pasangan tunggal sah (± biaya); satu sisi, rekening sama, tidak seimbang, biaya tertanda rekening, atau tiga rekening DITOLAK", async () => {
  const w = await dunia();
  const D = (cashAccountId, debit, credit = 0, accountId) => ({ accountId: accountId ?? w.akunBank.id, cashAccountId, debit, credit });
  const sah = [D(w.kem.id, 5_000_000), D(w.ptSano.id, 0, 5_002_500), { accountId: w.bebanAdmin.id, debit: 2_500, credit: 0 }];
  await post(w, "TRANSFER_KAS", sah);
  assert.equal(await saldo("PT Sano"), -5_002_500);
  const ditolak = [
    ["sumber = tujuan", [D(w.ptSano.id, 100), D(w.ptSano.id, 0, 100)], /tidak boleh sama/],
    ["tidak seimbang (kredit ≠ debit + biaya)", [D(w.kem.id, 5_000_000), D(w.ptSano.id, 0, 5_001_000), { accountId: w.bebanAdmin.id, debit: 2_500, credit: 0 }], /tidak seimbang/],
    ["biaya tidak tercatat tetapi kredit lebih besar", [D(w.kem.id, 5_000_000), D(w.ptSano.id, 0, 5_002_500)], /tidak seimbang/],
    ["tiga rekening", [D(w.kem.id, 3_000_000), D(w.ptSano.id, 2_000_000), D(w.kas.id, 0, 5_000_000, w.akunKas.id)], /berpasangan/],
    ["hanya satu sisi rekening", [D(w.kem.id, 100), { accountId: w.modal.id, debit: 0, credit: 100 }], /berpasangan/],
    ["baris selain rekening berupa kredit", [D(w.kem.id, 100), D(w.ptSano.id, 0, 100), { accountId: w.modal.id, debit: 0, credit: 5 }, { accountId: w.beban.id, debit: 5 }], /hanya boleh biaya administrasi/],
  ];
  for (const [nama, lines, pola] of ditolak) await assert.rejects(() => post(w, "TRANSFER_KAS", lines), pola, nama);
  assert.equal(await testPrisma.finJournalEntry.count(), 1);
  // pemeriksa murni
  const n = (lines) => normalizeLines(lines).lines;
  assert.doesNotThrow(() => pastikanTransferBerpasangan(n(sah)));
  assert.throws(() => pastikanTransferBerpasangan(n([D(w.ptSano.id, 100), D(w.ptSano.id, 0, 100)])), JournalError);
});

test("Jurnal MANUAL baru via API ke Kas/Bank tanpa rekening ditolak 400 (pesan Indonesia) dan tidak tersimpan; dengan rekening sah", async () => {
  const w = await dunia();
  const tanpa = await w.admin.post("/api/finance/journal", { date: "2026-10-01", description: "Fee Farhan Agustus", lines: [{ accountId: w.beban.id, debit: 6_715_170 }, { accountId: w.akunBank.id, credit: 6_715_170 }] });
  assert.equal(tanpa.status, 400);
  assert.match(tanpa.body.error, /wajib memilih rekeningnya/);
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
  const ok = await w.admin.post("/api/finance/journal", { date: "2026-10-01", description: "Fee Farhan Agustus", lines: [{ accountId: w.beban.id, debit: 6_715_170 }, { accountId: w.akunBank.id, credit: 6_715_170, cashAccountId: w.ptSano.id }] });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

test("Jalur otomatis lama (biaya kendaraan Kas lapangan, belanja iklan Bank): tanpa pemetaan rekening → FinPostingGap REKENING_BELUM_DIPETAKAN dan TIDAK ada jurnal tanpa rekening; dengan pemetaan → baris bertanda rekening", async () => {
  const w = await dunia();
  const ad = await testPrisma.adSpend.create({ data: { source: "META_ADS", year: 2026, month: 9, amount: 1_500_000 } });
  const r1 = await testPrisma.$transaction((tx) => postAdSpend(tx, { adSpendId: ad.id, userId: w.adminUser.id }));
  assert.equal(r1.gap, true);
  assert.equal(await testPrisma.finJournalEntry.count(), 0, "tidak ada jurnal tanpa rekening");
  const gap = await testPrisma.finPostingGap.findFirst({ where: { source: "BIAYA_IKLAN" } });
  assert.equal(gap.reason, "REKENING_BELUM_DIPETAKAN");
  // dipetakan: CARD → PT Sano
  await testPrisma.finSetting.upsert({ where: { key: "cash_account_card" }, create: { key: "cash_account_card", value: w.ptSano.id }, update: { value: w.ptSano.id } });
  await testPrisma.finPostingGap.deleteMany({});
  const r2 = await testPrisma.$transaction((tx) => postAdSpend(tx, { adSpendId: ad.id, userId: w.adminUser.id }));
  assert.equal(r2.posted, true, JSON.stringify(r2));
  assert.equal(await saldo("PT Sano"), -1_500_000);
  const kredit = await testPrisma.finJournalLine.findFirst({ where: { accountId: w.akunBank.id } });
  assert.equal(kredit.cashAccountId, w.ptSano.id);
  assert.equal(typeof postVehicleExpense, "function");
});

test("Tidak ada baris Kas/Bank tanpa rekening yang lahir dari jalur mana pun setelah semua uji ini (invarian akhir)", async () => {
  const w = await dunia();
  await post(w, "PEMBAYARAN_ORDER", [{ accountId: w.akunBank.id, debit: 500, cashAccountId: w.ptSano.id }, { accountId: w.modal.id, credit: 500 }]);
  await post(w, "PENGELUARAN", [{ accountId: w.beban.id, debit: 100 }, { accountId: w.akunKas.id, credit: 100, cashAccountId: w.kas.id }]);
  const tanpa = await testPrisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM fin_journal_lines l WHERE l.account_id IN (SELECT account_id FROM fin_cash_accounts) AND l.cash_account_id IS NULL`);
  assert.equal(tanpa[0].n, 0);
  const salah = await testPrisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM fin_journal_lines l JOIN fin_cash_accounts c ON c.id = l.cash_account_id WHERE c.account_id <> l.account_id`);
  assert.equal(salah[0].n, 0);
});
