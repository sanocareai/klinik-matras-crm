import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createMigrationExceptionWithResolutionCarryForward } from "../../scripts/production-delivery-v2/migration-exception-persistence.js";

test.beforeEach(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await testPrisma.$disconnect(); });

async function migrationRun() {
  return testPrisma.v2MigrationRun.create({
    data: { kind: "INITIAL_BACKFILL", status: "VERIFIED", startedAt: new Date(), finishedAt: new Date() },
  });
}

const exception = {
  domain: "PRODUCTION",
  aggregateType: "Unit",
  aggregateId: "34d3d6d6-cca8-4c66-b397-e597b607a412",
  code: "CURRENT_STAGE_WITHOUT_SERVICE",
  severity: "HIGH",
  status: "KEEP_V1",
  evidence: { currentStageId: "same-stage" },
};

test("catch-up membawa forward resolusi admin hanya saat evidence byte-stable secara kanonis", async () => {
  const firstRun = await migrationRun();
  const resolvedAt = new Date("2026-09-25T00:00:00.000Z");
  await testPrisma.v2MigrationException.create({
    data: {
      runId: firstRun.id,
      ...exception,
      status: "RESOLVED",
      resolution: { provenance: "PRODUCTION_ADMIN_BYPASS", disposition: "HISTORICAL_ADMINISTRATIVE_BYPASS" },
      resolvedById: "OWNER_TEST",
      resolvedAt,
    },
  });
  const nextRun = await migrationRun();
  const carried = await testPrisma.$transaction((tx) => createMigrationExceptionWithResolutionCarryForward(tx, {
    runId: nextRun.id,
    exception,
  }));
  assert.equal(carried.status, "RESOLVED");
  assert.equal(carried.resolution.provenance, "PRODUCTION_ADMIN_BYPASS");
  assert.equal(carried.resolvedById, "OWNER_TEST");
  assert.equal(carried.resolvedAt.toISOString(), resolvedAt.toISOString());

  const changedRun = await migrationRun();
  const reopened = await testPrisma.$transaction((tx) => createMigrationExceptionWithResolutionCarryForward(tx, {
    runId: changedRun.id,
    exception: { ...exception, evidence: { currentStageId: "changed-stage" } },
  }));
  // Evidence berubah setelah RESOLVED: dibuka lagi (OPEN, fail-closed) dengan histori resolusi lama tetap ada.
  assert.equal(reopened.status, "OPEN");
  assert.equal(reopened.resolvedAt, null);
  assert.equal(reopened.resolution.reopened, true);
  assert.equal(reopened.resolution.previous.resolution.provenance, "PRODUCTION_ADMIN_BYPASS");
  assert.equal(reopened.resolution.previous.resolvedById, "OWNER_TEST");
});

test("resolusi selain provenance owner-approved tidak dibawa forward", async () => {
  const firstRun = await migrationRun();
  await testPrisma.v2MigrationException.create({
    data: {
      runId: firstRun.id,
      ...exception,
      status: "RESOLVED",
      resolution: { provenance: "AUTOMATIC_GUESS" },
      resolvedAt: new Date(),
    },
  });
  const nextRun = await migrationRun();
  const created = await testPrisma.$transaction((tx) => createMigrationExceptionWithResolutionCarryForward(tx, {
    runId: nextRun.id,
    exception,
  }));
  assert.equal(created.status, "KEEP_V1");
  assert.equal(created.resolution, null);
});
