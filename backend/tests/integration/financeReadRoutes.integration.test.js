// Smoke test SEMUA endpoint GET /api/finance/* terhadap Postgres sungguhan.
//
// KENAPA FILE INI ADA. 17 September 2026, pengguna melaporkan halaman
// "Pembayaran & Verifikasi" gagal total: GET /customer-payments melempar
// PrismaClientValidationError karena select-nya menyertakan `job.jobNumber`
// — kolom yang TIDAK PERNAH ada di model Job. Bug itu lolos SELURUH unit
// test (stub tidak pernah memvalidasi nama field terhadap schema) DAN
// lolos code review, dan baru ketahuan lewat pemakaian nyata di production.
//
// Prisma memvalidasi bentuk `select`/`include` SEBELUM mengeksekusi query —
// jadi bug kelas ini muncul SEKALIPUN tabelnya kosong (tidak butuh baris
// yang cocok). Itu artinya seluruh 25 endpoint GET finance bisa disapu
// bersih dengan setup data MINIMAL (bagan akun + satu rekening kas), tanpa
// perlu membuat skenario bisnis lengkap per endpoint — tesnya cuma
// membuktikan SATU hal: "select/include tidak pernah menunjuk field yang
// tidak ada", bukan kebenaran isi datanya (itu tugas
// financeLedger.integration.test.js).
//
// Assert-nya SENGAJA longgar (status < 500), bukan strict 200 — endpoint
// dengan :id/:accountId yang diisi UUID acak wajar membalas 404, itu bukan
// bug. Yang tidak boleh terjadi cuma 500 (PrismaClientValidationError,
// TypeError, dst).

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";

let server;
let client;

test.before(async () => {
  await truncateAll();
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));

  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const rekeningKas = await testPrisma.finCashAccount.create({
    data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id },
  });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, rekeningKas.id);

  server = await startTestServer(buildTestApp());
  const { token } = await createTestUser({ roles: ["FINANCE"] });
  client = makeClient(server.baseUrl, token);
});
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const idAcak = randomUUID();

// Path lengkap PERSIS seperti dipanggil frontend — daftar ini dijaga
// sinkron manual dengan `financeRouter.get(...)`/`financeTxRouter.get(...)`
// di routes/finance.js & routes/financeTransactions.js. Kalau menambah
// endpoint GET baru di salah satu file itu, tambahkan barisnya di sini.
const ENDPOINTS = [
  "/accounts",
  "/cash-accounts",
  "/expense-categories",
  "/purchase-categories",
  "/periods",
  "/journal",
  `/journal/${idAcak}`,
  "/invoices",
  "/gaps",
  "/settings",
  "/reports/trial-balance",
  "/reports/income-statement",
  "/reports/balance-sheet",
  "/reports/cash-flow",
  `/reports/ledger/${idAcak}`,
  "/reports/receivables",
  "/reports/payables",
  "/dashboard",
  "/expenses",
  "/purchases",
  "/suppliers",
  "/bills",
  "/bills/unbilled-receipts",
  "/supplier-payments",
  "/transfers",
  "/other-income",
  "/customer-payments",
  "/refunds",
  "/bank-statements",
  `/bank-statements/${idAcak}`,
];

for (const path of ENDPOINTS) {
  test(`GET /api/finance${path} tidak pernah 500 (select/include cocok dengan schema sungguhan)`, async () => {
    const res = await client.get(`/api/finance${path}`);
    assert.ok(
      res.status < 500,
      `GET /api/finance${path} → HTTP ${res.status}: ${JSON.stringify(res.body)}`
    );
  });
}
