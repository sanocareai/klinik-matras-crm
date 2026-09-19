// Test integrasi TAB PEMBELIAN (FinPurchase) terhadap PostgreSQL sungguhan.
//
// Yang dikunci di sini adalah ARAH JURNAL-nya — inti alasan tab ini dipisah
// dari Pengeluaran: pembelian bisa mendebet akun ASET (uang muka, aset
// tetap), bukan cuma BEBAN. Kalau suatu saat category.accountId diabaikan
// atau posting diarahkan ke akun beban, laporan neraca & laba rugi salah
// diam-diam — test ini yang harus menangkapnya.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { toMoney } from "../../src/services/finance/money.js";
import { STATUS_DIHITUNG } from "../../src/services/finance/journal.js";

// Kebijakan bukti (services/finance/receipts.js): dokumen yang disetujui butuh nota.
const NOTA_TES = "/media/finance-receipts/tes.jpg";

let server;
test.before(async () => {
  await truncateAll();
  server = await startTestServer(buildTestApp());
});
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkanFinance() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const rekeningKas = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, rekeningKas.id);
  return { rekeningKas };
}

async function kategori(code) {
  return testPrisma.finPurchaseCategory.findUnique({ where: { code } });
}

// Saldo bersih (debit - kredit) sebuah akun COA dari jurnal yang dihitung
// (POSTED + REVERSED — lihat komentar STATUS_DIHITUNG di financeCorrection test).
async function saldoAkun(code) {
  const akun = await testPrisma.finAccount.findUnique({ where: { code } });
  const baris = await testPrisma.finJournalLine.findMany({
    where: { accountId: akun.id, entry: { status: { in: STATUS_DIHITUNG } } },
    select: { debit: true, credit: true },
  });
  return baris.reduce((acc, b) => acc.plus(toMoney(b.debit)).minus(toMoney(b.credit)), toMoney(0)).toFixed(2);
}

test("Pasang Akun Bawaan: 5 kategori pembelian, 1-1500 dapat systemKey, kategori pengeluaran BAHAN_BAKU_MANUAL dinonaktifkan", async () => {
  await siapkanFinance();

  const kodes = (await testPrisma.finPurchaseCategory.findMany({ select: { code: true } })).map((k) => k.code).sort();
  assert.deepEqual(kodes, ["ASET_KENDARAAN", "ASET_PERALATAN", "ASET_TAK_BERWUJUD", "BAHAN_BAKU_MANUAL", "UANG_MUKA_PEMBELIAN"]);

  const uangMuka = await testPrisma.finAccount.findUnique({ where: { code: "1-1500" } });
  assert.equal(uangMuka.systemKey, SYSTEM_KEYS.UANG_MUKA_PEMBELIAN);

  const lama = await testPrisma.finExpenseCategory.findUnique({ where: { code: "BAHAN_BAKU_MANUAL" } });
  assert.equal(lama.active, false, "kategori lama tetap ada (histori aman) tapi tidak bisa dipilih lagi");
});

test("Backfill systemKey: instalasi lama yang 1-1500-nya dibuat tanpa systemKey ikut diperbaiki saat Pasang Akun Bawaan dijalankan ulang", async () => {
  await siapkanFinance();
  await testPrisma.finAccount.update({ where: { code: "1-1500" }, data: { systemKey: null } });

  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));

  const akun = await testPrisma.finAccount.findUnique({ where: { code: "1-1500" } });
  assert.equal(akun.systemKey, SYSTEM_KEYS.UANG_MUKA_PEMBELIAN);
});

test("Uang Muka Pembelian (LANGSUNG): Dr 1-1500 ASET / Cr Kas — BUKAN beban", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);

  const kat = await kategori("UANG_MUKA_PEMBELIAN");
  const created = await client.post("/api/finance/purchases", { receiptUrl: NOTA_TES,
    date: "2026-09-10", amount: 2_000_000, description: "DP mesin corner",
    categoryId: kat.id, mode: "LANGSUNG", cashAccountId: rekeningKas.id,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.match(created.body.purchaseNumber, /^PUR-/);
  assert.equal(created.body.status, "MENUNGGU_APPROVAL");
  assert.equal(await saldoAkun("1-1500"), "0.00", "belum disetujui = belum menyentuh buku besar");

  const approved = await client.post(`/api/finance/purchases/${created.body.id}/approve`, {});
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "DIBAYAR", "mode LANGSUNG langsung lunas saat disetujui");

  assert.equal(await saldoAkun("1-1500"), "2000000.00", "DP tercatat sebagai aset Uang Muka Pembelian");
  assert.equal(await saldoAkun("1-1100"), "-2000000.00", "kas berkurang");
  assert.equal(await saldoAkun("5-1150"), "0.00", "tidak ada yang nyasar ke beban pokok");
});

test("Bahan Baku mode REIMBURSEMENT: approve → Dr 5-1150 / Cr Utang Reimbursement; bayar → utang lunas; cancel → semua balik nol", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);

  const kat = await kategori("BAHAN_BAKU_MANUAL");
  const created = await client.post("/api/finance/purchases", { receiptUrl: NOTA_TES,
    date: "2026-09-11", amount: 500_000, description: "Busa rebonded",
    categoryId: kat.id, mode: "REIMBURSEMENT",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const approved = await client.post(`/api/finance/purchases/${created.body.id}/approve`, {});
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "DISETUJUI");
  assert.equal(await saldoAkun("5-1150"), "500000.00");
  assert.equal(await saldoAkun("2-1300"), "-500000.00", "utang reimbursement ke karyawan lahir");
  assert.equal(await saldoAkun("1-1100"), "0.00", "uang belum keluar");

  const paid = await client.post(`/api/finance/purchases/${created.body.id}/pay`, { cashAccountId: rekeningKas.id });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.status, "DIBAYAR");
  assert.equal(await saldoAkun("2-1300"), "0.00", "utang reimbursement lunas");
  assert.equal(await saldoAkun("1-1100"), "-500000.00");

  const cancel = await client.post(`/api/finance/purchases/${created.body.id}/cancel`, { reason: "salah input" });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal(cancel.body.status, "DIBATALKAN");
  assert.equal(await saldoAkun("5-1150"), "0.00", "pengakuan pembelian dibalik");
  assert.equal(await saldoAkun("2-1300"), "0.00");
  assert.equal(await saldoAkun("1-1100"), "0.00", "jurnal pembayaran JUGA dibalik — bukan cuma salah satunya");
});

test("Kategori pembelian nonaktif ditolak saat membuat pembelian baru", async () => {
  await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);

  const kat = await kategori("ASET_KENDARAAN");
  await testPrisma.finPurchaseCategory.update({ where: { id: kat.id }, data: { active: false } });

  const res = await client.post("/api/finance/purchases", { receiptUrl: NOTA_TES,
    date: "2026-09-12", amount: 1_000_000, description: "Ban mobil", categoryId: kat.id, mode: "UTANG",
  });
  assert.equal(res.status, 404, JSON.stringify(res.body));
});
