#!/usr/bin/env node
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertSafeTestDatabase, jsonForOutput, writeReport } from "./common.js";
import { executeDeliveryJobCommand } from "../../src/services/deliveryJobCommandService.js";
import { executeDeliveryExecutionCommand } from "../../src/services/deliveryExecutionCommandService.js";
import { executeDeliveryRouteCommand } from "../../src/services/deliveryRouteCommandService.js";
import { readDriverDelta, readDriverFullSnapshot } from "../../src/services/driverSnapshotV2.js";

const prisma = new PrismaClient();
const identity = assertSafeTestDatabase();
const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const secret = `writer-rehearsal-secret-${runId}`;
const checks = [];
const pass = (name, evidence = {}) => checks.push({ name, status: "PASS", evidence });

async function main() {
  const order = await prisma.order.findFirst({ select: { id: true } });
  assert.ok(order, "Restore test tidak memiliki order untuk fixture rehearsal");
  const [driverA, driverB] = await Promise.all([
    prisma.user.create({ data: { name: `V2 Rehearsal Driver A ${runId}`, email: `v2-a-${runId}@example.invalid`, passwordHash: "REHEARSAL_NO_LOGIN", role: "DRIVER", active: false } }),
    prisma.user.create({ data: { name: `V2 Rehearsal Driver B ${runId}`, email: `v2-b-${runId}@example.invalid`, passwordHash: "REHEARSAL_NO_LOGIN", role: "DRIVER", active: false } }),
  ]);

  const jobCreated = await executeDeliveryJobCommand(prisma, {
    actorId: driverA.id,
    idempotencyKey: `rehearsal-job-create:${runId}`,
    commandType: "REHEARSAL_CREATE_JOB",
    request: { orderId: order.id },
    projectV1: async (tx) => {
      const job = await tx.job.create({ data: { type: "DELIVERY", orderId: order.id, status: "UNSCHEDULED" } });
      return { jobId: job.id };
    },
  });
  const routeCreated = await executeDeliveryRouteCommand(prisma, {
    actorId: driverA.id,
    idempotencyKey: `rehearsal-route-create:${runId}`,
    commandType: "REHEARSAL_CREATE_ROUTE",
    request: { driverId: driverA.id },
    projectV1: async (tx) => {
      const route = await tx.route.create({
        data: { code: `V2-${runId}`, date: new Date(), driverId: driverA.id, notes: "Synthetic retained rehearsal fixture", createdById: driverA.id },
      });
      return { routeId: route.id };
    },
  });
  pass("additive-create-writers", { jobId: jobCreated.jobId, routeId: routeCreated.routeId });

  const published = await executeDeliveryRouteCommand(prisma, {
    routeId: routeCreated.routeId,
    actorId: driverA.id,
    idempotencyKey: `rehearsal-publish:${runId}`,
    commandType: "REHEARSAL_PUBLISH_ROUTE",
    expectedRevision: routeCreated.routeRevision,
    forcePublication: true,
    projectV1: async (tx) => {
      await tx.route.update({ where: { id: routeCreated.routeId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      await tx.job.update({
        where: { id: jobCreated.jobId },
        data: { routeId: routeCreated.routeId, sequence: 1, scheduledDate: new Date(), driverId: driverA.id, status: "ASSIGNED" },
      });
      return { routeId: routeCreated.routeId };
    },
  });
  const publication1 = await prisma.routePublication.findUniqueOrThrow({
    where: { routeId_publicationVersion: { routeId: routeCreated.routeId, publicationVersion: 1 } },
    include: { assignments: true },
  });
  assert.equal(publication1.snapshot.stops.length, 1);
  assert.equal(publication1.assignments.length, 1);
  assert.equal(publication1.assignments[0].jobId, jobCreated.jobId);
  pass("publish-no-missing-stop", { publicationVersion: 1, stopCount: 1, assignmentCount: 1 });

  const snapshotA = await readDriverFullSnapshot(prisma, { userId: driverA.id, secret, limit: 10 });
  assert.equal(snapshotA.items.length, 1);
  assert.ok(snapshotA.deltaCursor);

  const reassignmentKey = `rehearsal-reassign:${runId}`;
  const reassigned = await executeDeliveryRouteCommand(prisma, {
    routeId: routeCreated.routeId,
    actorId: driverA.id,
    idempotencyKey: reassignmentKey,
    commandType: "REHEARSAL_REASSIGN_ROUTE",
    expectedRevision: published.routeRevision,
    reason: "Synthetic reassignment rehearsal",
    forcePublication: true,
    request: { driverId: driverB.id },
    projectV1: async (tx) => {
      await tx.route.update({ where: { id: routeCreated.routeId }, data: { driverId: driverB.id, lastEditReason: "Synthetic reassignment rehearsal" } });
      await tx.job.update({ where: { id: jobCreated.jobId }, data: { driverId: driverB.id } });
      return { routeId: routeCreated.routeId };
    },
  });
  const oldDriverDelta = await readDriverDelta(prisma, { userId: driverA.id, cursor: snapshotA.deltaCursor, secret });
  assert.deepEqual(oldDriverDelta.events.map((event) => event.kind), ["REMOVE_ROUTE"]);
  const oldDriverSnapshot = await readDriverFullSnapshot(prisma, { userId: driverA.id, secret, limit: 10 });
  assert.equal(oldDriverSnapshot.items.length, 0);
  const snapshotB = await readDriverFullSnapshot(prisma, { userId: driverB.id, secret, limit: 10 });
  assert.equal(snapshotB.items.length, 1);
  assert.equal(snapshotB.items[0].publicationVersion, 2);
  pass("reassignment-revokes-old-principal", { oldEvents: ["REMOVE_ROUTE"], newPublicationVersion: 2 });

  const replay = await executeDeliveryRouteCommand(prisma, {
    routeId: routeCreated.routeId,
    actorId: driverA.id,
    idempotencyKey: reassignmentKey,
    commandType: "REHEARSAL_REASSIGN_ROUTE",
    expectedRevision: published.routeRevision,
    reason: "Synthetic reassignment rehearsal",
    forcePublication: true,
    request: { driverId: driverB.id },
    projectV1: async () => { throw new Error("projector tidak boleh berjalan saat replay"); },
  });
  assert.equal(replay.replayed, true);
  assert.equal(await prisma.routePublication.count({ where: { routeId: routeCreated.routeId } }), 2);
  pass("idempotent-replay", { publicationCount: 2 });

  await assert.rejects(
    executeDeliveryRouteCommand(prisma, {
      routeId: routeCreated.routeId,
      actorId: driverA.id,
      idempotencyKey: `rehearsal-stale:${runId}`,
      commandType: "REHEARSAL_STALE_EDIT",
      expectedRevision: 1,
      projectV1: async () => ({ routeId: routeCreated.routeId }),
    }),
    (error) => error.code === "REVISION_CONFLICT",
  );
  pass("optimistic-concurrency-rejects-stale-route-revision");

  const beforeExecutionState = await prisma.deliveryJobState.findUniqueOrThrow({ where: { jobId: jobCreated.jobId } });
  const executed = await executeDeliveryExecutionCommand(prisma, {
    jobId: jobCreated.jobId,
    actorId: driverB.id,
    idempotencyKey: `rehearsal-job-start:${runId}`,
    commandType: "REHEARSAL_JOB_STARTED",
    expectedJobRevision: beforeExecutionState.jobRevision,
    request: { status: "EN_ROUTE" },
    projectV1: async (tx) => {
      await tx.job.update({ where: { id: jobCreated.jobId }, data: { status: "EN_ROUTE" } });
    },
  });
  assert.equal(executed.status, "EN_ROUTE");
  const offlineFirst = await readDriverDelta(prisma, { userId: driverB.id, cursor: snapshotB.deltaCursor, secret });
  const offlineReplay = await readDriverDelta(prisma, { userId: driverB.id, cursor: snapshotB.deltaCursor, secret });
  assert.deepEqual(offlineReplay.events, offlineFirst.events);
  assert.deepEqual(offlineFirst.events.map((event) => event.kind), ["UPSERT_JOB"]);
  pass("offline-delta-replay-is-deterministic", { eventKinds: ["UPSERT_JOB"] });

  const cancelled = await executeDeliveryRouteCommand(prisma, {
    routeId: routeCreated.routeId,
    actorId: driverA.id,
    idempotencyKey: `rehearsal-cancel:${runId}`,
    commandType: "REHEARSAL_CANCEL_ROUTE",
    expectedRevision: reassigned.routeRevision,
    reason: "Synthetic cancel rehearsal",
    forcePublication: true,
    projectV1: async (tx) => {
      await tx.route.update({ where: { id: routeCreated.routeId }, data: { status: "CANCELLED" } });
      return { routeId: routeCreated.routeId };
    },
  });
  const cancelDelta = await readDriverDelta(prisma, { userId: driverB.id, cursor: offlineFirst.cursor, secret });
  assert.deepEqual(cancelDelta.events.map((event) => event.kind), ["REMOVE_ROUTE"]);
  const afterCancelSnapshot = await readDriverFullSnapshot(prisma, { userId: driverB.id, secret, limit: 10 });
  assert.equal(afterCancelSnapshot.items.length, 0);
  assert.equal(await prisma.routePublication.count({ where: { routeId: routeCreated.routeId, status: "ACTIVE" } }), 0);
  pass("cancel-removes-route-without-ghost", { publicationVersion: cancelled.publicationVersion, activePublications: 0 });
  pass("app-full-refresh-loads-after-cancel", { itemCount: 0 });

  const lifecycleJob = await executeDeliveryJobCommand(prisma, {
    actorId: driverA.id,
    idempotencyKey: `rehearsal-lifecycle-job:${runId}`,
    commandType: "REHEARSAL_CREATE_LIFECYCLE_JOB",
    request: { orderId: order.id },
    projectV1: async (tx) => {
      const created = await tx.job.create({ data: { type: "DELIVERY", orderId: order.id, status: "UNSCHEDULED" } });
      return { jobId: created.id };
    },
  });
  const lifecycleRoute = await executeDeliveryRouteCommand(prisma, {
    actorId: driverA.id,
    idempotencyKey: `rehearsal-lifecycle-route:${runId}`,
    commandType: "REHEARSAL_CREATE_LIFECYCLE_ROUTE",
    request: { driverId: driverA.id },
    projectV1: async (tx) => {
      const created = await tx.route.create({
        data: { code: `V2-LIFE-${runId}`, date: new Date(), driverId: driverA.id, notes: "Synthetic lifecycle fixture", createdById: driverA.id },
      });
      return { routeId: created.id };
    },
  });
  const lifecyclePublished = await executeDeliveryRouteCommand(prisma, {
    routeId: lifecycleRoute.routeId,
    actorId: driverA.id,
    idempotencyKey: `rehearsal-lifecycle-publish:${runId}`,
    commandType: "REHEARSAL_PUBLISH_LIFECYCLE_ROUTE",
    expectedRevision: lifecycleRoute.routeRevision,
    forcePublication: true,
    projectV1: async (tx) => {
      await tx.route.update({ where: { id: lifecycleRoute.routeId }, data: { status: "IN_PROGRESS", publishedAt: new Date(), startedAt: new Date() } });
      await tx.job.update({
        where: { id: lifecycleJob.jobId },
        data: { routeId: lifecycleRoute.routeId, sequence: 1, scheduledDate: new Date(), driverId: driverA.id, status: "EN_ROUTE" },
      });
      return { routeId: lifecycleRoute.routeId };
    },
  });
  const lifecycleJobState = await prisma.deliveryJobState.findUniqueOrThrow({ where: { jobId: lifecycleJob.jobId } });
  await executeDeliveryExecutionCommand(prisma, {
    jobId: lifecycleJob.jobId,
    actorId: driverA.id,
    idempotencyKey: `rehearsal-lifecycle-complete:${runId}`,
    commandType: "REHEARSAL_JOB_COMPLETED",
    expectedJobRevision: lifecycleJobState.jobRevision,
    request: { status: "COMPLETED" },
    projectV1: async (tx) => {
      await tx.job.update({ where: { id: lifecycleJob.jobId }, data: { status: "COMPLETED", completedAt: new Date() } });
      await tx.route.update({ where: { id: lifecycleRoute.routeId }, data: { status: "COMPLETED", completedAt: new Date() } });
    },
  });
  const completedRouteState = await prisma.deliveryRouteState.findUniqueOrThrow({ where: { routeId: lifecycleRoute.routeId } });
  assert.equal(completedRouteState.lifecycleStatus, "COMPLETED");
  assert.equal(completedRouteState.routeRevision, lifecyclePublished.routeRevision + 1);
  assert.equal(completedRouteState.currentPublicationVersion, 2);
  pass("execution-auto-completion-advances-route-publication", {
    routeRevision: completedRouteState.routeRevision,
    publicationVersion: completedRouteState.currentPublicationVersion,
  });

  const notesBeforeFault = (await prisma.route.findUniqueOrThrow({ where: { id: routeCreated.routeId } })).notes;
  await assert.rejects(executeDeliveryRouteCommand(prisma, {
    routeId: routeCreated.routeId,
    actorId: driverA.id,
    idempotencyKey: `rehearsal-fault:${runId}`,
    commandType: "REHEARSAL_FAULT_INJECTION",
    expectedRevision: cancelled.routeRevision,
    projectV1: async (tx) => {
      await tx.route.update({ where: { id: routeCreated.routeId }, data: { notes: "MUST_ROLL_BACK" } });
      throw new Error("SYNTHETIC_FAULT_AFTER_V1_PROJECTION");
    },
  }), /SYNTHETIC_FAULT/);
  assert.equal((await prisma.route.findUniqueOrThrow({ where: { id: routeCreated.routeId } })).notes, notesBeforeFault);
  pass("fault-injection-rolls-back-v1-and-v2");

  const report = {
    reportType: "delivery-v2-writer-rehearsal",
    generatedAt: new Date().toISOString(),
    database: identity.database,
    runId,
    retainedSyntheticFixture: true,
    totals: { checks: checks.length, passed: checks.filter((check) => check.status === "PASS").length },
    checks,
  };
  writeReport(process.argv.find((arg) => arg.startsWith("--output="))?.slice(9), report);
  console.log(jsonForOutput(report));
}

main().catch((error) => {
  console.error("[delivery-v2-writer-rehearsal] GAGAL:", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
