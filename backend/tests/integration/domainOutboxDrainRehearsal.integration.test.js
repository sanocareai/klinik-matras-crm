import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { rehearseExactOnceOutboxDrain } from "../../scripts/production-delivery-v2/outbox-drain-rehearsal.js";

test.beforeEach(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await testPrisma.$disconnect(); });

test("seluruh outbox pending didrain tepat sekali oleh worker bersaing dan replay tidak menduplikasi", async () => {
  const eventTypes = [
    "delivery.route.changed",
    "delivery.job.plan.changed",
    "delivery.job.cancelled",
    "delivery.assignment.reschedule.revoked",
  ];
  await testPrisma.domainOutbox.createMany({
    data: Array.from({ length: 32 }, (_, index) => ({
      domain: "DELIVERY",
      eventType: eventTypes[index % eventTypes.length],
      aggregateType: index % 2 === 0 ? "Route" : "Job",
      aggregateId: `rehearsal-${index}`,
      aggregateRevision: index + 1,
      dedupeKey: `rc-outbox-rehearsal-${index}`,
      payload: { synthetic: true, index },
    })),
  });

  const report = await rehearseExactOnceOutboxDrain(testPrisma, {
    workerIds: ["rc-worker-a", "rc-worker-b", "rc-worker-c"],
    databaseUrl: process.env.TEST_DATABASE_URL,
  });

  assert.equal(report.pendingBefore, 32);
  assert.equal(report.pendingAfter, 0);
  assert.equal(report.processingAfter, 0);
  assert.equal(report.failedAfter, 0);
  assert.equal(report.deliveredAfter, 32);
  assert.equal(report.uniqueDeliveries, 32);
  assert.equal(report.duplicateDeliveries, 0);
  assert.equal(report.replay.claimed, 0);
  assert.equal(report.replay.delivered, 0);
  assert.equal(report.workers.reduce((sum, worker) => sum + worker.delivered, 0), 32);
  assert.equal(await testPrisma.domainOutbox.count({ where: { attempts: 1 } }), 32);
});
