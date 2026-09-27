import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { applyPlan, buildExceptions, loadSource, unitPlan } from "../../scripts/production-delivery-v2/backfill-core.js";

const DATE = new Date("2026-09-28T00:00:00.000Z");
const CODE = "ROUTE_JOB_ASSIGNMENT_MISMATCH";
let server;

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function backfill() {
  const source = await loadSource(testPrisma);
  return applyPlan(testPrisma, source, source.units.map(unitPlan), buildExceptions(source.units, source.routes, source.jobs));
}

// Route DRAFT: crew hanya ada di header; job belum punya crew (perilaku normal perencanaan).
async function draftRoute() {
  const [{ token }, { user: driver }, { user: helper }] = await Promise.all([
    createTestUser({ roles: ["DISPATCHER"] }), createTestUser({ roles: ["DRIVER"] }), createTestUser({ roles: ["HELPER"] }),
  ]);
  const customer = await testPrisma.customer.create({ data: { name: "Fixture" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 0, status: "PROCESSING" } });
  const route = await testPrisma.route.create({ data: { code: `RTE-${Date.now()}`, status: "DRAFT", date: DATE, driverId: driver.id, helperId: helper.id } });
  for (let sequence = 1; sequence <= 3; sequence += 1) {
    await testPrisma.job.create({
      data: { type: "DELIVERY", orderId: order.id, routeId: route.id, status: "SCHEDULED", sequence, scheduledDate: DATE },
    });
  }
  return { token, driver, helper, route };
}

test("route DRAFT dengan job tanpa crew tidak menghasilkan exception", async () => {
  await draftRoute();
  const result = await backfill();
  assert.equal(result.status, "VERIFIED");
  assert.equal(await testPrisma.v2MigrationException.count({ where: { code: CODE } }), 0);
});

test("publish konsisten lolos: crew disalin ke job dan tidak ada exception setelah backfill", async () => {
  const fx = await draftRoute();
  const response = await makeClient(server.baseUrl, fx.token).post(`/api/armada/routes/${fx.route.id}/publish`, {});
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const jobs = await testPrisma.job.findMany({ where: { routeId: fx.route.id } });
  assert.equal(jobs.every((job) => job.driverId === fx.driver.id && job.helperId === fx.helper.id), true);
  assert.equal((await testPrisma.route.findUnique({ where: { id: fx.route.id } })).status, "PUBLISHED");
  await backfill();
  assert.equal(await testPrisma.v2MigrationException.count({ where: { code: CODE } }), 0);
});

test("publish yang meninggalkan job tidak konsisten ditolak (409) dan route tetap DRAFT", async () => {
  const fx = await draftRoute();
  // Simulasi penulisan bersamaan/regresi cascade: trigger mengembalikan driver_id job ke nilai lama.
  await testPrisma.$executeRawUnsafe("CREATE OR REPLACE FUNCTION test_keep_job_driver() RETURNS trigger AS $$ BEGIN NEW.driver_id := OLD.driver_id; RETURN NEW; END $$ LANGUAGE plpgsql");
  await testPrisma.$executeRawUnsafe("CREATE TRIGGER test_keep_job_driver BEFORE UPDATE OF driver_id ON jobs FOR EACH ROW EXECUTE FUNCTION test_keep_job_driver()");
  try {
    const response = await makeClient(server.baseUrl, fx.token).post(`/api/armada/routes/${fx.route.id}/publish`, {});
    assert.equal(response.status, 409, JSON.stringify(response.body));
    assert.match(response.body.error, /Publish ditolak/);
  } finally {
    await testPrisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS test_keep_job_driver ON jobs");
    await testPrisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS test_keep_job_driver()");
  }
  const route = await testPrisma.route.findUnique({ where: { id: fx.route.id } });
  assert.equal(route.status, "DRAFT", "transaksi publish dibatalkan seluruhnya");
  assert.equal(route.publishedAt, null);
  const jobs = await testPrisma.job.findMany({ where: { routeId: fx.route.id } });
  assert.equal(jobs.every((job) => job.driverId === null && job.status === "SCHEDULED"), true);
});
