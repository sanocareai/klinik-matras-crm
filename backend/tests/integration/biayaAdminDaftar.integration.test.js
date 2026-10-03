// BIAYA ADMIN IKUT NOMINAL (2 Okt 2026): daftar transfer antar rekening, pembayaran supplier, dan refund mengirim ringkasan biaya (nominalDiterima, biayaAdmin, totalKeluarRekening) dari SERVER.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postCashTransfer } from "../../src/services/finance/posting/cash.js";
import { bentukPembayaranSupplier } from "../../src/services/finance/supplierRead.js";
import { ringkasBiaya } from "../../src/services/finance/transferFee.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

test("Daftar transfer: baris berbiaya membawa nominalDiterima, biayaAdmin, totalKeluarRekening; tanpa biaya total = nominal", async () => {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const a = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const b = await testPrisma.finCashAccount.create({ data: { name: "KEM", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  for (const [no, fee] of [["TRF-A", 2_500], ["TRF-B", 0]]) {
    const tf = await testPrisma.finCashTransfer.create({ data: { transferNumber: no, date: new Date("2026-10-01T00:00:00Z"), amount: 5_000_000, fromAccountId: a.id, toAccountId: b.id, feeAmount: fee, createdById: admin.user.id } });
    await testPrisma.$transaction((tx) => postCashTransfer(tx, { transferId: tf.id, userId: admin.user.id }));
  }
  const r = await makeClient(server.baseUrl, admin.token).get("/api/finance/transfers?from=2026-10-01&to=2026-10-31");
  assert.equal(r.status, 200);
  const A = r.body.transfers.find((t) => t.transferNumber === "TRF-A");
  assert.equal(A.nominalDiterima, 5_000_000);
  assert.equal(A.biayaAdmin, 2_500);
  assert.equal(A.totalKeluarRekening, 5_002_500);
  const B = r.body.transfers.find((t) => t.transferNumber === "TRF-B");
  assert.equal(B.biayaAdmin, 0);
  assert.equal(B.totalKeluarRekening, 5_000_000);
});

test("Pembayaran supplier: bentuk daftar membawa biaya admin dan total keluar rekening (murni)", () => {
  const p = bentukPembayaranSupplier({ id: "p1", amount: "6493500.00", transferFeeAmount: "2500.00", allocations: [{ id: "a", amount: "6493500.00" }] });
  assert.equal(p.amount, 6_493_500);
  assert.equal(p.transferFeeAmount, 2_500);
  assert.equal(p.biayaAdmin, 2_500);
  assert.equal(p.totalKeluarRekening, 6_496_000, "sama dengan kredit bank pada jurnal PAYOUT");
  const tanpa = bentukPembayaranSupplier({ id: "p2", amount: "1000.00", allocations: [] });
  assert.equal(tanpa.totalKeluarRekening, 1_000);
  assert.deepEqual(ringkasBiaya({ amount: 100, transferFeeAmount: 2.5 }), { nominalDiterima: 100, biayaAdmin: 2.5, totalKeluarRekening: 102.5 });
});
