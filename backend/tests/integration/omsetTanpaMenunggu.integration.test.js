// Regresi (30 September 2026, keputusan Owner): order berstatus PENDING
// ("Menunggu" — customer sudah fix tapi minta dikerjakan nanti) BELUM PASTI,
// jadi tidak boleh ikut omset/Nilai di laporan. Juga menguji endpoint baru
// /analytics/stage-by-sales (kartu "Sales per Stage" tab Ringkasan).
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
async function orderUntuk(customerId, status, value) {
  seq += 1;
  return testPrisma.order.create({
    data: { customerId, orderNumber: `OMS-${Date.now()}-${seq}`, category: "LAYANAN", status, value },
  });
}

test("Order Menunggu (PENDING) & CANCELLED tidak masuk Nilai Penjualan; status lain tetap masuk", async () => {
  const admin = await login(["ADMIN"]);
  const c = await testPrisma.customer.create({ data: { phone: "6281200000001", name: "Pak Fix Nanti", pipelineStage: "TRANSACTION" } });
  await orderUntuk(c.id, "PENDING", 5_000_000);
  await orderUntuk(c.id, "CANCELLED", 7_000_000);
  await orderUntuk(c.id, "PROCESSING", 2_000_000);
  await orderUntuk(c.id, "DELIVERED", 1_000_000);

  const r = await raw("GET", "/api/analytics/business-summary", { token: admin.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.uang.grossValue, 3_000_000);
  assert.equal(r.body.uang.totalOrders, 2);
});

test("/stage-by-sales: hitungan per stage & per sales, nilai Menunggu dipisah, mandek ≥14 hari", async () => {
  const admin = await login(["ADMIN"]);
  const sales = await createLoginUser({ roles: ["SALES"] });
  const lama = new Date(Date.now() - 20 * 86_400_000);
  const a = await testPrisma.customer.create({ data: { phone: "6281200000011", name: "A", pipelineStage: "PROSPECT", assignedSalesId: sales.user.id } });
  await testPrisma.customer.create({ data: { phone: "6281200000012", name: "B", pipelineStage: "NEW", assignedSalesId: sales.user.id } });
  const t = await testPrisma.customer.create({ data: { phone: "6281200000013", name: "C", pipelineStage: "TRANSACTION" } });
  await orderUntuk(t.id, "PENDING", 4_000_000);
  await orderUntuk(t.id, "READY", 1_500_000);
  // updatedAt @updatedAt — set lewat raw supaya benar-benar 20 hari lalu.
  await testPrisma.$executeRaw`UPDATE "Customer" SET "updatedAt" = ${lama} WHERE id = ${a.id}`;

  const r = await raw("GET", "/api/analytics/stage-by-sales", { token: admin.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.totalLeads, 3);
  const st = Object.fromEntries(r.body.stages.map((s) => [s.stage, s]));
  assert.equal(st.PROSPECT.count, 1);
  assert.equal(st.PROSPECT.stale, 1);
  assert.equal(st.NEW.stale, 0);
  assert.equal(st.TRANSACTION.value, 1_500_000);
  assert.equal(st.TRANSACTION.pendingValue, 4_000_000);

  const baris = r.body.sales.find((s) => s.userId === sales.user.id);
  assert.equal(baris.total, 2);
  assert.equal(baris.byStage.PROSPECT, 1);
  assert.equal(baris.byStage.NEW, 1);
  assert.equal(baris.stale, 1);
  const tanpaSales = r.body.sales.find((s) => s.userId === null);
  assert.equal(tanpaSales.total, 1);
  assert.equal(r.body.sales.at(-1).userId, null); // "Belum ditugaskan" selalu paling bawah
});
