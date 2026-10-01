// Regresi (30 September 2026, keputusan Owner): pembayaran Tunai di CRM Sales juga memilih rekening —
// HANYA Sano KEM (rekening PT tidak ditawarkan) — dan pembayarannya terbukukan ke Finance di rekening itu.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";

let server;
let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const kem = await testPrisma.finCashAccount.create({ data: { name: "KEM - Sano Bank", kind: "BANK", accountId: akunBank.id } });
  const pt = await testPrisma.finCashAccount.create({ data: { name: "PT Sano Bank", kind: "BANK", accountId: akunBank.id } });
  const u = await createLoginUser({ roles: ["SALES"] });
  const login = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
  const cust = await testPrisma.customer.create({ data: { phone: "6281200003001", name: "Bayar Tunai" } });
  const order = await testPrisma.order.create({ data: { customerId: cust.id, orderNumber: `PAY-${Date.now()}`, category: "LAYANAN", status: "PROCESSING", value: 2_000_000 } });
  return { token: login.body.token, kem, pt, order };
}

test("Tunai hanya menawarkan rekening KEM; Transfer menawarkan Bank (termasuk PT)", async () => {
  const { token, kem, pt } = await siapkan();
  const tunai = await raw("GET", "/api/orders/payment-accounts?method=CASH", { token });
  assert.equal(tunai.status, 200);
  assert.deepEqual(tunai.body.map((a) => a.id), [kem.id]);
  const transfer = await raw("GET", "/api/orders/payment-accounts?method=TRANSFER", { token });
  assert.deepEqual(transfer.body.map((a) => a.id).sort(), [kem.id, pt.id].sort());
  const lama = await raw("GET", "/api/orders/payment-accounts", { token });
  assert.equal(lama.body.length, 2); // tanpa ?method= perilaku lama
});

test("Bayar Tunai ke KEM: tersimpan dengan rekening & masuk buku besar Finance; ke rekening PT ditolak", async () => {
  const { token, kem, pt, order } = await siapkan();

  const ditolak = await raw("POST", `/api/orders/${order.id}/payments`, { token, body: { amount: 500_000, method: "CASH", cashAccountId: pt.id, proofPhotoUrl: "/media/payment-proofs/uji-bukti.jpg" } });
  assert.equal(ditolak.status, 400, JSON.stringify(ditolak.body));

  const ok = await raw("POST", `/api/orders/${order.id}/payments`, { token, body: { amount: 500_000, method: "CASH", cashAccountId: kem.id, proofPhotoUrl: "/media/payment-proofs/uji-bukti.jpg" } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.payment.cashAccountId, kem.id);
  assert.equal(ok.body.jurnal?.posted, true, "harus terbukukan ke Finance: " + JSON.stringify(ok.body.jurnal));

  const baris = await testPrisma.finJournalLine.findMany({ where: { orderId: order.id, cashAccountId: kem.id } });
  assert.equal(baris.length, 1);
  assert.equal(Number(baris[0].debit), 500_000);
});
