// Regresi (30 September 2026, keputusan Owner): order Menunggu (PENDING) belum
// pasti → (1) tidak masuk basis KOMISI sales, (2) tidak masuk total nilai papan
// Pipeline pelanggan, dan (3) papan Pipeline BERBASIS ORDER mengelompokkan order
// per status pengerjaan.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";

let server;
let raw;
test.before(async () => {
  await truncateAll();
  server = await startTestServer(buildTestApp());
  raw = makeRaw(server.baseUrl);
});
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function login(roles) {
  const u = await createLoginUser({ roles });
  const r = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
  assert.equal(r.status, 200);
  return { ...u, token: r.body.token };
}

let seq = 0;
async function order(customerId, status, value, extra = {}) {
  seq += 1;
  return testPrisma.order.create({
    data: { customerId, orderNumber: `PKM-${Date.now()}-${seq}`, category: "LAYANAN", status, value, ...extra },
  });
}

test("Komisi sales: order Menunggu yang sudah LUNAS/paidAt tidak masuk collectedValue", async () => {
  const admin = await login(["ADMIN"]);
  const sales = await createLoginUser({ roles: ["SALES"] });
  const c = await testPrisma.customer.create({ data: { phone: "6281200001001", name: "Komisi", pipelineStage: "TRANSACTION", assignedSalesId: sales.user.id } });
  await testPrisma.conversation.create({ data: { customerId: c.id, channel: "WHATSAPP", assignedToId: sales.user.id, type: "INDIVIDUAL" } });
  const paid = { paymentStatus: "LUNAS", paidAt: new Date() };
  await order(c.id, "PENDING", 4_000_000, paid);
  await order(c.id, "PROCESSING", 1_000_000, paid);

  const r = await raw("GET", "/api/analytics/sales-report", { token: admin.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = r.body.rows.find((x) => x.userId === sales.user.id);
  assert.ok(row, "baris sales ada");
  assert.equal(row.collectedValue, 1_000_000);
});

test("Papan Pipeline pelanggan: totalValue tanpa Menunggu, pendingValue terpisah", async () => {
  const admin = await login(["ADMIN"]);
  const c = await testPrisma.customer.create({ data: { phone: "6281200001002", name: "Papan", pipelineStage: "TRANSACTION" } });
  await order(c.id, "PENDING", 4_000_000);
  await order(c.id, "READY", 1_500_000);
  await order(c.id, "CANCELLED", 9_000_000);

  const r = await raw("GET", "/api/pipeline/board", { token: admin.token });
  assert.equal(r.status, 200);
  const kartu = r.body.TRANSACTION.find((x) => x.id === c.id);
  assert.equal(kartu.totalValue, 1_500_000);
  assert.equal(kartu.pendingValue, 4_000_000);
  assert.equal(kartu.orderCount, 2);
});

test("/pipeline/order-board: order dikelompokkan per status, pelanggan SPAM dikecualikan, ada sales & nilai", async () => {
  const admin = await login(["ADMIN"]);
  const sales = await createLoginUser({ roles: ["SALES"] });
  const c = await testPrisma.customer.create({ data: { phone: "6281200001003", name: "Order Board", pipelineStage: "PROSPECT", assignedSalesId: sales.user.id } });
  const spam = await testPrisma.customer.create({ data: { phone: "6281200001004", name: "Spam", pipelineStage: "SPAM" } });
  await order(c.id, "PENDING", 4_000_000);
  await order(c.id, "PROCESSING", 2_000_000);
  await order(c.id, "DELIVERED", 1_000_000);
  await order(spam.id, "PROCESSING", 8_000_000);

  const r = await raw("GET", "/api/pipeline/order-board", { token: admin.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.board.PENDING.length, 1);
  assert.equal(r.body.board.PROCESSING.length, 1); // order milik SPAM tidak ikut
  assert.equal(r.body.board.DELIVERED.length, 1);
  assert.equal(r.body.board.READY.length, 0);
  const p = r.body.board.PENDING[0];
  assert.equal(p.value, 4_000_000);
  assert.equal(p.customerName, "Order Board");
  assert.equal(p.assignedSalesName, sales.user.name);
  assert.ok(r.body.statuses.includes("CANCELLED"));

  const tanpaAuth = await raw("GET", "/api/pipeline/order-board");
  assert.equal(tanpaAuth.status, 401);
});
