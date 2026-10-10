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

  // Server memfilter per hari WIB (UTC+7); tanggal UTC salah antara 00.00-07.00 WIB.
  const hari = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
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

test("Job pickup/kirim KOMPLAIN tidak menggantikan jadwal order asli (pickupJob/deliveryJob tetap yang asli, komplain terpisah)", async () => {
  const u = await createLoginUser({ roles: ["ADMIN"] });
  const login = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
  const token = login.body.token;
  const c = await testPrisma.customer.create({ data: { phone: "6281200002002", name: "Jadwal Komplain" } });
  const o = await order(c.id, "DELIVERED");
  const kasus = await testPrisma.complaintCase.create({ data: { caseNumber: `CMP-J-${Date.now()}`, orderId: o.id, category: "LAINNYA", description: "Pegal lagi", status: "DIJADWALKAN" } });
  const hari = (n) => new Date(Date.UTC(2026, 8, n));
  // Job ASLI dibuat lebih dulu; job KOMPLAIN lebih baru (dulu job terbaru ini yang menimpa tampilan).
  await testPrisma.job.create({ data: { type: "PICKUP", orderId: o.id, scheduledDate: hari(10), createdAt: new Date(Date.now() - 5 * 86_400_000) } });
  await testPrisma.job.create({ data: { type: "DELIVERY", orderId: o.id, scheduledDate: hari(12), createdAt: new Date(Date.now() - 4 * 86_400_000) } });
  await testPrisma.job.create({ data: { type: "PICKUP", orderId: o.id, scheduledDate: hari(25), complaintCaseId: kasus.id } });
  await testPrisma.job.create({ data: { type: "DELIVERY", orderId: o.id, scheduledDate: hari(27), complaintCaseId: kasus.id } });

  const hariIni = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const r = await raw("GET", `/api/orders?from=${hariIni}&to=${hariIni}&limit=50`, { token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const item = r.body.items.find((x) => x.id === o.id);
  assert.equal(item.pickupJob.scheduledDate.slice(0, 10), "2026-09-10");
  assert.equal(item.deliveryJob.scheduledDate.slice(0, 10), "2026-09-12");
  assert.equal(item.complaintPickupJob.scheduledDate.slice(0, 10), "2026-09-25");
  assert.equal(item.complaintDeliveryJob.scheduledDate.slice(0, 10), "2026-09-27");
});
