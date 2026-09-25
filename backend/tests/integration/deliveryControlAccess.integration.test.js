// Gerbang Sano Delivery Control — penegakan di SERVER (bukan cuma UI).
// Matriks: Admin/Owner/Dispatcher boleh; Leader Driver, Driver, Helper, Finance, Sales,
// dan tanpa login ditolak. Kompatibilitas: login dan /auth/me tetap bekerja seperti
// semula dan hanya mendapat field capabilities tambahan.
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

async function klien(role) {
  const u = await createTestUser({ roles: [role] });
  return makeClient(server.baseUrl, u.token);
}

test("GET /delivery-control/session: Admin, Owner, Dispatcher diizinkan dan menerima capabilities", async () => {
  for (const role of ["ADMIN", "OWNER", "DISPATCHER"]) {
    const res = await (await klien(role)).get("/api/delivery-control/session");
    assert.equal(res.status, 200, `${role}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.capabilities.deliveryControlApp, true, role);
    assert.ok(res.body.id && res.body.name, role);
    assert.equal("passwordHash" in res.body, false, "tidak membocorkan hash");
    assert.equal("active" in res.body, false, "field internal tidak ikut");
  }
});

test("GET /delivery-control/session: Leader Driver, Driver, Helper, Finance, Sales, Gudang DITOLAK 403", async () => {
  for (const role of ["LEADER_DRIVER", "DRIVER", "HELPER", "FINANCE", "SALES", "WAREHOUSE", "PRODUCTION_LEAD", "ACCOUNTANT", "APPROVER"]) {
    const res = await (await klien(role)).get("/api/delivery-control/session");
    assert.equal(res.status, 403, role);
  }
});

test("GET /delivery-control/session: tanpa token 401", async () => {
  const res = await makeClient(server.baseUrl, null).get("/api/delivery-control/session");
  assert.equal(res.status, 401);
});

test("akun multi-role Driver + Dispatcher masuk lewat izin Dispatcher; Driver + Helper tidak", async () => {
  const a = await createTestUser({ roles: ["DRIVER", "DISPATCHER"] });
  assert.equal((await makeClient(server.baseUrl, a.token).get("/api/delivery-control/session")).status, 200);
  const b = await createTestUser({ roles: ["DRIVER", "HELPER"] });
  assert.equal((await makeClient(server.baseUrl, b.token).get("/api/delivery-control/session")).status, 403);
});

test("kompatibilitas: /auth/me tetap membawa field lama + capabilities baru; Driver melihat deliveryControlApp=false", async () => {
  const driver = await klien("DRIVER");
  const me = await driver.get("/api/auth/me");
  assert.equal(me.status, 200);
  for (const k of ["id", "name", "role", "roles", "portals", "capabilities"]) assert.ok(k in me.body, k);
  assert.equal(me.body.capabilities.deliveryControlApp, false);
  assert.equal(typeof me.body.capabilities.financeApp, "boolean", "field capabilities lama tetap ada");
  const admin = await klien("ADMIN");
  assert.equal((await admin.get("/api/auth/me")).body.capabilities.deliveryControlApp, true);
});
