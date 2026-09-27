// Foto driver/helper untuk Delivery Control: respons AGREGAT (daftar driver/helper, rute, tracking) membawa avatarUrl
// (URL media publik /uploads/avatars/<file>, sama dengan web) tanpa fetch per pengguna dan tanpa membocorkan path storage.
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

const URL_FOTO = /^\/uploads\/avatars\/[\w.-]+$/;
const hariIniWIB = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

test("drivers, helpers, routes, dan tracking membawa avatarUrl aditif; tanpa foto = null; tidak ada path storage", async () => {
  await truncateAll();
  const { user: driver } = await createTestUser({ roles: ["DRIVER"] });
  const { user: helper } = await createTestUser({ roles: ["HELPER"] });
  await testPrisma.user.update({ where: { id: driver.id }, data: { avatarUrl: "/uploads/avatars/driver-1.png" } });
  // helper sengaja tanpa foto -> fallback inisial di klien
  await testPrisma.userRole.createMany({ data: [{ userId: driver.id, role: "DRIVER" }, { userId: helper.id, role: "HELPER" }] });

  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Foto" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 0, status: "DELIVERED" } });
  const date = new Date(`${hariIniWIB()}T00:00:00.000Z`);
  const route = await testPrisma.route.create({ data: { code: "RTE-FOTO", status: "PUBLISHED", date, driverId: driver.id, helperId: helper.id } });
  const job = await testPrisma.job.create({
    data: { type: "DELIVERY", orderId: order.id, routeId: route.id, status: "EN_ROUTE", sequence: 1, scheduledDate: date, driverId: driver.id, helperId: helper.id },
  });
  await testPrisma.jobPositionPing.create({ data: { jobId: job.id, driverId: driver.id, lat: -6.2, lng: 106.8, accuracy: 12, recordedAt: new Date() } });

  const admin = makeClient(server.baseUrl, (await createTestUser({ roles: ["ADMIN"] })).token);

  const drivers = await admin.get("/api/armada/drivers");
  assert.equal(drivers.status, 200);
  assert.equal(drivers.body.find((u) => u.id === driver.id).avatarUrl, "/uploads/avatars/driver-1.png");

  const helpers = await admin.get("/api/armada/helpers");
  assert.equal(helpers.status, 200);
  assert.equal(helpers.body.find((u) => u.id === helper.id).avatarUrl, null);

  const rute = await admin.get(`/api/armada/routes?date=${hariIniWIB()}`);
  assert.equal(rute.status, 200);
  const r = rute.body.routes.find((x) => x.id === route.id);
  assert.equal(r.driver.avatarUrl, "/uploads/avatars/driver-1.png");
  assert.equal(r.helper.avatarUrl, null);

  const tracking = await admin.get("/api/armada/tracking");
  assert.equal(tracking.status, 200);
  const t = tracking.body.find((x) => x.routeId === route.id);
  assert.equal(t.driverAvatarUrl, "/uploads/avatars/driver-1.png");
  assert.equal(t.lastPosition.lat, -6.2);

  const semua = JSON.stringify([drivers.body, helpers.body, rute.body, tracking.body]);
  for (const m of semua.matchAll(/"(?:avatarUrl|driverAvatarUrl|helperAvatarUrl)":"([^"]*)"/g)) assert.match(m[1], URL_FOTO, "hanya URL media publik");
  assert.doesNotMatch(semua, /[A-Za-z]:\\|\/backend\/|passwordHash/, "tanpa path storage/rahasia");
});
