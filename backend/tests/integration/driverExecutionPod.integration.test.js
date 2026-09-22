import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
let seq = 0;

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function fixture() {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const helper = await createTestUser({ roles: ["DRIVER"] });
  const outsider = await createTestUser({ roles: ["DRIVER"] });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan POD", city: "Jakarta" } });
  const route = await testPrisma.route.create({
    data: {
      code: `POD-RTE-${++seq}`, date: new Date("2026-09-22T00:00:00.000Z"), status: "PUBLISHED",
      publishedAt: new Date(), driverId: driver.user.id, helperId: helper.user.id,
    },
  });
  const jobs = [];
  for (let i = 0; i < 2; i += 1) {
    const order = await testPrisma.order.create({
      data: { customerId: customer.id, orderNumber: `POD-ORDER-${++seq}`, value: 1000, category: "LAYANAN" },
    });
    jobs.push(await testPrisma.job.create({
      data: {
        type: "DELIVERY", orderId: order.id, routeId: route.id,
        driverId: driver.user.id, helperId: helper.user.id, status: "ASSIGNED", sequence: i + 1,
      },
    }));
  }
  return {
    driver: { ...driver, api: makeClient(server.baseUrl, driver.token) },
    helper: { ...helper, api: makeClient(server.baseUrl, helper.token) },
    outsider: { ...outsider, api: makeClient(server.baseUrl, outsider.token) },
    route, jobs,
  };
}

const key = (value) => ({ "Idempotency-Key": `driver-test-${value}-123456` });

test("route start -> pilih stop -> tiba -> POD; double tap idempoten dan dua crew konsisten", async () => {
  const f = await fixture();
  const started = await f.driver.api.post(`/api/armada/routes/${f.route.id}/start`, {
    proofPhotoUrls: ["/media/job-photos/load.jpg"],
  }, key("route-start"));
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const routeStarted = await testPrisma.route.findUnique({ where: { id: f.route.id } });
  assert.equal(routeStarted.status, "IN_PROGRESS");
  assert.ok(routeStarted.startedAt);
  assert.deepEqual((await testPrisma.job.findMany({ where: { routeId: f.route.id }, orderBy: { sequence: "asc" } })).map((j) => j.status), ["ASSIGNED", "ASSIGNED"]);
  const secondRouteStart = await f.helper.api.post(`/api/armada/routes/${f.route.id}/start`, {
    proofPhotoUrls: ["/media/job-photos/load.jpg"],
  }, key("route-start-other-key"));
  assert.equal(secondRouteStart.status, 409);

  const unauthorized = await f.outsider.api.post(`/api/armada/jobs/${f.jobs[0].id}/start`, {}, key("unauthorized"));
  assert.equal(unauthorized.status, 403);

  const toward = await f.driver.api.post(`/api/armada/jobs/${f.jobs[0].id}/start`, {}, key("toward"));
  assert.equal(toward.status, 200, JSON.stringify(toward.body));

  const [arriveA, arriveB] = await Promise.all([
    f.driver.api.post(`/api/armada/jobs/${f.jobs[0].id}/arrive`, { location: null }, key("arrive-a")),
    f.helper.api.post(`/api/armada/jobs/${f.jobs[0].id}/arrive`, { location: null }, key("arrive-b")),
  ]);
  assert.deepEqual([arriveA.status, arriveB.status].sort(), [200, 409]);

  const completeBody = {
    proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Budi Penerima",
    note: "Diterima baik", location: null, driverId: f.outsider.user.id, helperId: null,
  };
  const first = await f.driver.api.post(`/api/armada/jobs/${f.jobs[0].id}/complete`, completeBody, key("complete"));
  const replay = await f.driver.api.post(`/api/armada/jobs/${f.jobs[0].id}/complete`, completeBody, key("complete"));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  const completed = await testPrisma.job.findUnique({ where: { id: f.jobs[0].id } });
  assert.equal(completed.proofRecipientName, "Budi Penerima");
  assert.equal(completed.completedById, f.driver.user.id);
  assert.equal(completed.driverId, f.driver.user.id);
  assert.equal(completed.helperId, f.helper.user.id);
  assert.equal(await testPrisma.deliveryExecutionEvent.count({ where: { idempotencyKey: "driver-test-complete-123456" } }), 1);

  const reusedForOtherStop = await f.driver.api.post(`/api/armada/jobs/${f.jobs[1].id}/start`, {}, key("toward"));
  assert.equal(reusedForOtherStop.status, 409);

  await f.helper.api.post(`/api/armada/jobs/${f.jobs[1].id}/start`, {}, key("toward-two"));
  const failed = await f.helper.api.post(`/api/armada/jobs/${f.jobs[1].id}/fail`, {
    failureReason: "Customer minta reschedule",
    failurePhotoUrls: ["/media/job-photos/fail.jpg"], note: "Minta besok", location: null,
  }, key("fail-two"));
  assert.equal(failed.status, 200, JSON.stringify(failed.body));

  const finalRoute = await testPrisma.route.findUnique({ where: { id: f.route.id } });
  assert.equal(finalRoute.status, "COMPLETED");
  assert.ok(finalRoute.completedAt);
  const sameSnapshot = await f.helper.api.get("/api/armada/my-jobs?date=2026-09-22");
  assert.equal(sameSnapshot.status, 200);
  assert.equal(sameSnapshot.body.jobs.find((j) => j.id === f.jobs[0].id).status, "COMPLETED");
  assert.equal(sameSnapshot.body.jobs.find((j) => j.id === f.jobs[1].id).status, "FAILED");
});

test("POD invalid, file URL eksternal, dan complete sebelum tiba ditolak", async () => {
  const f = await fixture();
  const beforeArrive = await f.driver.api.post(`/api/armada/jobs/${f.jobs[0].id}/complete`, {
    proofPhotoUrls: ["/media/job-photos/a.jpg"], recipientName: "Budi",
  }, key("invalid-state"));
  assert.equal(beforeArrive.status, 409);
  const badFile = await f.driver.api.post(`/api/armada/jobs/${f.jobs[0].id}/complete`, {
    proofPhotoUrls: ["https://evil.example/a.jpg"], recipientName: "Budi",
  }, key("invalid-file"));
  assert.equal(badFile.status, 400);
  const missingRecipient = await f.driver.api.post(`/api/armada/jobs/${f.jobs[0].id}/complete`, {
    proofPhotoUrls: ["/media/job-photos/a.jpg"],
  }, key("invalid-recipient"));
  assert.equal(missingRecipient.status, 400);
});
