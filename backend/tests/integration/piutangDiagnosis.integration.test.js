// DIAGNOSIS PIUTANG — setiap order bersaldo di akun Piutang Usaha masuk SATU kategori dengan alasan + tindakan, dan seluruh kategori menjumlah kembali
// ke saldo neraca (selisih 0). Yang dikunci: kelima kategori (termasuk saldo KREDIT yang tidak tampil di umurPiutang), pemisahan "belum diakui", izin
// (SALES 403), dan kontrak umurPiutang() tidak berubah.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postRevenueRecognition, postPaymentReceived } from "../../src/services/finance/posting/orderRevenue.js";
import { umurPiutang } from "../../src/services/finance/reports.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let n = 0;
async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const kelola = async (nama, { value, status = "DELIVERED", paymentStatus = "BELUM_BAYAR" }) => {
    const customer = await testPrisma.customer.create({ data: { name: nama, assignedSalesId: sales.user.id } });
    return testPrisma.order.create({ data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `DGN-${String(++n).padStart(3, "0")}`, status, paymentStatus } });
  };
  const diakui = (o) => testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: admin.user.id }));
  const bayar = async (o, amount, { jurnal = true, verifikasi = false, createdAt } = {}) => {
    const p = await testPrisma.payment.create({ data: { orderId: o.id, amount, method: "TRANSFER", cashAccountId: bank.id, recordedById: admin.user.id, ...(createdAt && { createdAt }) } });
    if (verifikasi) await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: admin.user.id } });
    if (jurnal) await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: admin.user.id }));
    return p;
  };
  return { admin, sales, kelola, diakui, bayar, a: makeClient(server.baseUrl, admin.token), s: makeClient(server.baseUrl, sales.token) };
}

test("lima kategori + saldo kredit + belum diakui, semuanya menjumlah ke saldo neraca", async () => {
  const { kelola, diakui, bayar, a } = await siapkan();

  const sah = await kelola("Tagihan Sah", { value: 1_000_000 });
  await diakui(sah);

  const dp = await kelola("Tagihan DP", { value: 2_000_000, paymentStatus: "DP" });
  await bayar(dp, 500_000);
  await diakui(dp);

  const lunasTanpa = await kelola("Lunas Tanpa Payment", { value: 3_000_000, paymentStatus: "LUNAS" });
  await diakui(lunasTanpa);

  // Payment historis (sebelum cutoff 2026-09-18) yang terverifikasi tetapi TIDAK PERNAH dijurnal; pendapatan diakui sesudahnya (kasus Stanley).
  const historis = await kelola("Payment Belum Menutup", { value: 1_500_000, paymentStatus: "LUNAS" });
  await bayar(historis, 1_500_000, { jurnal: false, verifikasi: true, createdAt: new Date("2026-09-10T05:00:00Z") });
  await diakui(historis);

  // Nilai order dikurangi SETELAH diakui: diakui 2.000.000, kini 1.200.000, sudah dibayar 1.200.000 → piutang tersisa 800.000.
  const turun = await kelola("Nilai Turun", { value: 2_000_000, paymentStatus: "LUNAS" });
  await diakui(turun);
  await testPrisma.order.update({ where: { id: turun.id }, data: { value: 1_200_000 } });
  await bayar(turun, 1_200_000);

  // Nilai order dinaikkan SETELAH diakui: diakui 250.000, kini 1.250.000, dibayar 1.250.000 → saldo KREDIT −1.000.000 (tidak tampil di umurPiutang).
  const naik = await kelola("Nilai Naik", { value: 250_000, paymentStatus: "LUNAS" });
  await diakui(naik);
  await testPrisma.order.update({ where: { id: naik.id }, data: { value: 1_250_000 } });
  await bayar(naik, 1_250_000);

  // Saldo kredit tanpa selisih nilai: dibayar melebihi tagihan.
  const lebih = await kelola("Lebih Bayar", { value: 1_000_000, paymentStatus: "LUNAS" });
  await diakui(lebih);
  await bayar(lebih, 1_500_000);

  // Belum diakui: belum diserahkan (wajar) dan sudah diserahkan tetapi pendapatan belum pernah diakui (perlu dicek).
  await kelola("Belum Diserahkan", { value: 5_000_000, status: "PROCESSING" });
  const terlewat = await kelola("Terkirim Belum Diakui", { value: 700_000, status: "DELIVERED" });

  const r = await a.get("/api/finance/reports/receivables/diagnosis");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body;

  const per = Object.fromEntries(d.baris.map((b) => [b.customerName, b]));
  assert.equal(per["Tagihan Sah"].kategori, "TAGIHAN_SAH");
  assert.equal(per["Tagihan Sah"].saldoPiutang, 1_000_000);
  assert.equal(per["Tagihan DP"].kategori, "TAGIHAN_SAH");
  assert.equal(per["Tagihan DP"].saldoPiutang, 1_500_000);
  assert.equal(per["Lunas Tanpa Payment"].kategori, "LUNAS_TANPA_PAYMENT");
  assert.match(per["Lunas Tanpa Payment"].tindakan, /Lunas di CRM/);
  assert.equal(per["Payment Belum Menutup"].kategori, "PAYMENT_BELUM_MENUTUP");
  assert.match(per["Payment Belum Menutup"].tindakan, /historis/i, "payment sebelum saldo awal → arahkan ke penuntasan historis");
  assert.equal(per["Nilai Turun"].kategori, "NILAI_BEDA_PENGAKUAN");
  assert.equal(per["Nilai Turun"].saldoPiutang, 800_000);
  assert.match(per["Nilai Turun"].penjelasan, /kelebihan diakui/);
  assert.equal(per["Nilai Naik"].kategori, "NILAI_BEDA_PENGAKUAN");
  assert.equal(per["Nilai Naik"].saldoPiutang, -1_000_000);
  assert.match(per["Nilai Naik"].penjelasan, /kurang diakui/);
  assert.equal(per["Lebih Bayar"].kategori, "KREDIT_LAINNYA");
  assert.equal(per["Lebih Bayar"].saldoPiutang, -500_000);

  // Rekonsiliasi: Σ kategori = saldo neraca = Σ saldo semua baris.
  assert.equal(d.rekonsiliasi.selisih, 0);
  const jumlahBaris = d.baris.reduce((s, b) => s + b.saldoPiutang, 0);
  assert.equal(d.neraca, jumlahBaris);
  assert.equal(d.neraca, 1_000_000 + 1_500_000 + 3_000_000 + 1_500_000 + 800_000 - 1_000_000 - 500_000);
  assert.equal(d.rekonsiliasi.perKategori.TAGIHAN_SAH.jumlah, 2);
  assert.equal(d.rekonsiliasi.perKategori.NILAI_BEDA_PENGAKUAN.total, -200_000);

  // Saldo neraca di buku besar sama dengan angka diagnosis (sumber yang sama dengan neraca).
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PIUTANG_USAHA } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: akun.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  assert.equal(Number(agg._sum.debit) - Number(agg._sum.credit), d.neraca);

  // Belum diakui: 2 order; yang sudah diserahkan tetapi belum diakui disebut sendiri.
  assert.equal(d.belumDiakui.jumlah, 2);
  assert.equal(d.belumDiakui.total, 5_700_000);
  assert.deepEqual(d.belumDiakui.sudahDiserahBelumDiakui.map((x) => x.orderNumber), [terlewat.orderNumber]);

  // Kontrak umurPiutang TIDAK berubah: saldo kredit tidak muncul di daftar lamanya (itulah celah yang ditutup diagnosis).
  const lama = await umurPiutang(testPrisma, {});
  assert.ok(!lama.baris.some((b) => b.sisaTagihan < 0));
});

test("izin: SALES 403, tanpa login 401; tanpa data → bentuk respons tetap utuh", async () => {
  const { s } = await siapkan();
  assert.equal((await s.get("/api/finance/reports/receivables/diagnosis")).status, 403);
  assert.equal((await makeClient(server.baseUrl, null).get("/api/finance/reports/receivables/diagnosis")).status, 401);

  await truncateAll();
  const { a } = await siapkan();
  const r = await a.get("/api/finance/reports/receivables/diagnosis");
  assert.equal(r.status, 200);
  assert.equal(r.body.neraca, 0);
  assert.deepEqual(r.body.baris, []);
  assert.equal(r.body.rekonsiliasi.selisih, 0);
  assert.equal(r.body.belumDiakui.jumlah, 0);
  assert.ok(r.body.kategori.TAGIHAN_SAH);
});
