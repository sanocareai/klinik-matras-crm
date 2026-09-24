import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import {
  ADMIN_BYPASS_HISTORY_UNIT_IDS,
  resolveAdminBypassHistory,
} from "../../scripts/production-delivery-v2/resolve-admin-bypass-history.js";

test.beforeEach(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await testPrisma.$disconnect(); });

test("lima KEEP_V1 diselesaikan atomik, idempoten, searchable, tanpa fabrikasi bukti", async () => {
  const stage = await testPrisma.routingStage.create({
    data: {
      code: `admin-bypass-history-${Date.now()}`,
      labelId: "Administrative history",
      phase: "FINISH",
      sequence: 999,
    },
  });
  const run = await testPrisma.v2MigrationRun.create({
    data: { kind: "INITIAL_BACKFILL", status: "VERIFIED", startedAt: new Date(), finishedAt: new Date() },
  });

  for (const [index, unitId] of ADMIN_BYPASS_HISTORY_UNIT_IDS.entries()) {
    const customer = await testPrisma.customer.create({ data: { name: `Admin bypass ${index + 1}` } });
    const order = await testPrisma.order.create({
      data: {
        customerId: customer.id,
        orderNumber: `ADMIN-BYPASS-${index + 1}`,
        value: 0,
        status: "DELIVERED",
      },
    });
    await testPrisma.unit.create({
      data: {
        id: unitId,
        unitCode: `ADMIN-BYPASS-U${index + 1}`,
        orderId: order.id,
        seq: 1,
        status: "DELIVERED",
        currentStageId: stage.id,
        serviceId: null,
      },
    });
    await testPrisma.productionRun.create({
      data: {
        unitId,
        kind: "RESTORATION",
        status: "COMPLETED",
        currentPhase: "HANDOFF",
        migrationSource: "UNIT_V1",
        migrationSourceId: unitId,
        migrationConfidence: "REVIEW",
      },
    });
    await testPrisma.activityEvent.create({
      data: {
        entityType: "unit",
        entityId: unitId,
        eventType: "PRODUCTION_ADMIN_BYPASS",
        actorType: "USER",
        metadata: { provenance: "fixture" },
      },
    });
    await testPrisma.v2MigrationException.create({
      data: {
        runId: run.id,
        domain: "PRODUCTION",
        aggregateType: "Unit",
        aggregateId: unitId,
        code: "CURRENT_STAGE_WITHOUT_SERVICE",
        severity: "HIGH",
        status: "KEEP_V1",
        evidence: { currentStageId: stage.id },
      },
    });
  }

  const first = await resolveAdminBypassHistory(testPrisma, { apply: true });
  assert.equal(first.targetCount, 5);
  assert.equal(first.updated, 5);
  assert.equal(first.activeExceptionCount, 0);
  assert.equal(first.searchableHistory.every((item) => item.status === "RESOLVED"), true);
  assert.equal(first.searchableHistory.every((item) => item.provenance === "PRODUCTION_ADMIN_BYPASS"), true);

  const replay = await resolveAdminBypassHistory(testPrisma, { apply: true });
  assert.equal(replay.updated, 0);
  assert.equal(replay.activeExceptionCount, 0);
  assert.equal(await testPrisma.v2MigrationException.count({ where: { runId: run.id } }), 5);
  assert.equal(await testPrisma.activityEvent.count({ where: { eventType: "PRODUCTION_ADMIN_BYPASS" } }), 5);

  const units = await testPrisma.unit.findMany({ where: { id: { in: ADMIN_BYPASS_HISTORY_UNIT_IDS } } });
  assert.equal(units.every((unit) => unit.serviceId == null && unit.currentStageId === stage.id), true);
  assert.equal(await testPrisma.diagnosisReport.count(), 0);
  assert.equal(await testPrisma.qualityInspection.count(), 0);
  assert.equal(await testPrisma.productionHandoff.count(), 0);
});
