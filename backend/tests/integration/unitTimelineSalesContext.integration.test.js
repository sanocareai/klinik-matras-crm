// P12C — GET /api/units/:id/timeline membawa `salesContext` (catatan order, nama Sales, foto unit bertanda tangan) supaya kartu V1 di Aplikasi Meja setara kartu V2.
// BACA-SAJA, tanpa harga; izin tetap UNIT_READ; unit tanpa foto -> photoUrl null (jujur).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

test("timeline membawa salesContext: catatan order + nama Sales (assignedSales) + photoUrl null bila tidak ada foto; tidak membocorkan harga", async () => {
  const sales = await createTestUser({ roles: ["SALES"] });
  const worker = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Maya", assignedSalesId: sales.user.id } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: "ORD-CTX", value: 4_321_000, category: "LAYANAN", notes: "Kain biru motif bunga" } });
  await testPrisma.orderItem.create({ data: { orderId: order.id, layananName: "Ganti Kain", harga: 4_321_000, sortOrder: 0 } });
  const unit = await testPrisma.unit.create({ data: { unitCode: "CTX-1", orderId: order.id, seq: 1, status: "RECEIVED" } });
  const api = makeClient(server.baseUrl, worker.token);
  const res = await api.get(`/api/units/${unit.id}/timeline`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.salesServices, ["Ganti Kain"]);
  assert.equal(res.body.salesContext.request, "Kain biru motif bunga");
  assert.equal(res.body.salesContext.salesName, sales.user.name);
  assert.ok(sales.user.name);
  assert.equal(res.body.salesContext.photoUrl, null, "tidak ada foto -> null, bukan URL palsu");
  assert.doesNotMatch(JSON.stringify(res.body.salesContext), /harga|4321000/i);
  assert.doesNotMatch(JSON.stringify(res.body.salesServices), /4321000/);
  // Tanpa Sales/catatan: nilai kosong jujur (null), endpoint tetap 200.
  const customer2 = await testPrisma.customer.create({ data: { name: "Pak Budi" } });
  const order2 = await testPrisma.order.create({ data: { customerId: customer2.id, orderNumber: "ORD-CTX2", value: 1_000, category: "LAYANAN" } });
  const unit2 = await testPrisma.unit.create({ data: { unitCode: "CTX-2", orderId: order2.id, seq: 1, status: "RECEIVED" } });
  const res2 = await api.get(`/api/units/${unit2.id}/timeline`);
  assert.equal(res2.status, 200);
  assert.deepEqual(res2.body.salesContext, { request: null, salesName: null, photoUrl: null });
  // Izin tetap UNIT_READ: tanpa token -> 401.
  assert.equal((await makeClient(server.baseUrl, null).get(`/api/units/${unit.id}/timeline`)).status, 401);
});
