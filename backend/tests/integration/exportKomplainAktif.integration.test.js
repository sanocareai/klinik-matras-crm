// Regresi (30 September 2026): export "Diproses" admin produksi harus bisa
// menyertakan order KOMPLAIN aktif walau status order sudah Terkirim & tanggal
// buatnya di luar rentang — TANPA mengubah status order.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";

let server;
let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let seq = 0;
async function order(customerId, status, createdAt) {
  seq += 1;
  return testPrisma.order.create({ data: { customerId, orderNumber: `EXP-${Date.now()}-${seq}`, category: "LAYANAN", status, value: 1_000_000, ...(createdAt && { createdAt }) } });
}

test("includeActiveComplaint: order Terkirim dgn komplain aktif ikut, tanpa flag tidak; komplain SELESAI tidak ikut", async () => {
  const u = await createLoginUser({ roles: ["ADMIN"] });
  const login = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
  const token = login.body.token;
  const c = await testPrisma.customer.create({ data: { phone: "6281200002001", name: "Komplain Export" } });
  const lama = new Date(Date.now() - 60 * 86_400_000);

  const proses = await order(c.id, "PROCESSING");
  const komplain = await order(c.id, "DELIVERED", lama);
  const selesai = await order(c.id, "DELIVERED", lama);
  const biasa = await order(c.id, "DELIVERED", lama);
  await testPrisma.complaintCase.create({ data: { caseNumber: `CMP-T-${Date.now()}-1`, orderId: komplain.id, category: "LAINNYA", description: "Kasur kempis lagi", status: "DALAM_PENANGANAN" } });
  await testPrisma.complaintCase.create({ data: { caseNumber: `CMP-T-${Date.now()}-2`, orderId: selesai.id, category: "LAINNYA", description: "Sudah beres", status: "SELESAI" } });

  const hari = new Date().toISOString().slice(0, 10);
  const q = `from=${hari}&to=${hari}&limit=100`;

  const tanpa = await raw("GET", `/api/orders?${q}`, { token });
  assert.equal(tanpa.status, 200, JSON.stringify(tanpa.body));
  assert.deepEqual(tanpa.body.items.map((o) => o.id).sort(), [proses.id].sort());

  const dengan = await raw("GET", `/api/orders?${q}&includeActiveComplaint=true`, { token });
  assert.equal(dengan.status, 200);
  const ids = dengan.body.items.map((o) => o.id);
  assert.ok(ids.includes(proses.id));
  assert.ok(ids.includes(komplain.id), "order komplain aktif ikut");
  assert.ok(!ids.includes(selesai.id), "komplain SELESAI tidak ikut");
  assert.ok(!ids.includes(biasa.id), "order Terkirim biasa tidak ikut");
  const k = dengan.body.items.find((o) => o.id === komplain.id);
  assert.equal(k.status, "DELIVERED"); // status TIDAK berubah
  assert.equal(k.complaintCases[0].description, "Kasur kempis lagi");
});
