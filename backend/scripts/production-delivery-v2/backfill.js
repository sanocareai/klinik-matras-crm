#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  checksum, dateOnly, jsonForOutput, parseArgs, requireApplyConfirmation, stableValue, writeReport,
} from "./common.js";

const prisma = new PrismaClient();
const args = parseArgs();
const apply = requireApplyConfirmation(args);
const RULE_VERSION = "production-delivery-v2-backfill-v1";
const SETTLED_JOB = new Set(["COMPLETED", "FAILED", "RESCHEDULED"]);

function productionKind(unit) {
  if (unit.order.category === "SEWA") return "FULFILLMENT_ONLY";
  if (unit.order.category === "BARU") return unit.stageLogs.length ? "NEW_PRODUCT" : "FULFILLMENT_ONLY";
  return "RESTORATION";
}

function productionStatus(unit) {
  if (["AWAITING_PICKUP", "IN_TRANSIT_IN"].includes(unit.status)) return "PENDING_ARRIVAL";
  if (unit.status === "CANCELLED") return "CANCELLED";
  if (["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"].includes(unit.status)) return "COMPLETED";
  if (unit.blockers.some((blocker) => !blocker.resolvedAt)) return "BLOCKED";
  return "ACTIVE";
}

function phasePlan(unit, kind, runStatus) {
  const result = ["INTAKE", "DIAGNOSIS", "PROCESS", "QC", "HANDOFF"].map((phase, sequence) => ({
    phase, sequence: sequence + 1, status: "NOT_STARTED", reason: null,
  }));
  const byPhase = Object.fromEntries(result.map((item) => [item.phase, item]));
  if (kind === "FULFILLMENT_ONLY") {
    byPhase.DIAGNOSIS.status = "NOT_APPLICABLE";
    byPhase.DIAGNOSIS.reason = "Tidak ada bukti diagnosis restorasi pada V1";
    byPhase.PROCESS.status = "NOT_APPLICABLE";
    byPhase.PROCESS.reason = "Fulfillment tanpa proses restorasi";
    byPhase.QC.status = "NOT_APPLICABLE";
    byPhase.QC.reason = "Readiness diperiksa pada handoff";
  }
  const seen = new Set(unit.stageLogs.map((log) => log.stage.phase));
  for (const phase of seen) byPhase[phase] && (byPhase[phase].status = "COMPLETED");
  if (["RECEIVED", "IN_PRODUCTION", "READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"].includes(unit.status)) {
    byPhase.INTAKE.status = "COMPLETED";
  }
  if (unit.currentStage?.phase && !["COMPLETED", "CANCELLED"].includes(runStatus)) {
    byPhase[unit.currentStage.phase].status = unit.blockers.some((b) => !b.resolvedAt) ? "BLOCKED" : "ACTIVE";
  }
  if (runStatus === "COMPLETED") {
    byPhase.HANDOFF.status = ["IN_TRANSIT_OUT", "DELIVERED"].includes(unit.status) ? "COMPLETED" : "ACTIVE";
  }
  if (runStatus === "CANCELLED") {
    for (const phase of result.filter((item) => item.status === "NOT_STARTED")) phase.status = "CANCELLED";
  }
  return result;
}

function operationPlan(unit) {
  const routeStages = unit.productionRoute?.stages || [];
  const source = routeStages.length
    ? routeStages.map((item) => ({
        stageId: item.stageId, stageCode: item.stage.code, stageLabel: item.stage.labelId,
        sequence: item.sequence, required: item.required,
        planSnapshot: stableValue({ workCenterId: item.workCenterId, routeVersion: unit.productionRoute.version }),
      }))
    : [...new Map(unit.stageLogs.map((log) => [log.stageId, {
        stageId: log.stageId, stageCode: log.stage.code, stageLabel: log.stage.labelId,
        sequence: 0, required: true, planSnapshot: { inferredFrom: "UnitStageLog" },
      }])).values()].map((item, index) => ({ ...item, sequence: index + 1 }));
  return source.map((operation) => {
    const logs = unit.stageLogs.filter((log) => log.stageId === operation.stageId);
    const last = logs.at(-1);
    const status = !last ? "NOT_STARTED" : ({
      START: "ACTIVE", RESUME: "ACTIVE", PAUSE: "PAUSED", FAIL: "BLOCKED", COMPLETE: "COMPLETED", SKIP: "SKIPPED",
    }[last.action] || "NOT_STARTED");
    return { ...operation, status, startedAt: logs.find((log) => log.startedAt)?.startedAt || null, completedAt: last?.endedAt || null };
  });
}

function unitPlan(unit) {
  const kind = productionKind(unit);
  const status = productionStatus(unit);
  const operations = operationPlan(unit);
  const routeSnapshot = unit.productionRoute ? stableValue({
    id: unit.productionRoute.id, code: unit.productionRoute.code, version: unit.productionRoute.version,
    stages: unit.productionRoute.stages.map((item) => ({
      stageId: item.stageId, code: item.stage.code, label: item.stage.labelId,
      sequence: item.sequence, required: item.required, workCenterId: item.workCenterId,
    })),
  }) : null;
  const source = stableValue({
    unitId: unit.id, status: unit.status, serviceId: unit.serviceId, currentStageId: unit.currentStageId,
    updatedAt: unit.updatedAt, logs: unit.stageLogs, blockers: unit.blockers, qcFitTests: unit.qcFitTests,
    productionRoute: routeSnapshot,
  });
  return {
    unitId: unit.id, kind, status,
    currentPhase: unit.currentStage?.phase || (status === "PENDING_ARRIVAL" ? null : status === "COMPLETED" ? "HANDOFF" : "INTAKE"),
    routeSnapshot, routeChecksum: routeSnapshot ? checksum(routeSnapshot) : null,
    sourceChecksum: checksum(source), phases: phasePlan(unit, kind, status), operations,
  };
}

function routeSnapshot(route) {
  return stableValue({
    routeId: route.id, code: route.code, date: dateOnly(route.date), status: route.status,
    driverId: route.driverId, helperId: route.helperId, vehicleId: route.vehicleId,
    notes: route.notes, manualMapsUrl: route.manualMapsUrl,
    stops: route.jobs.map((job, index) => ({
      jobId: job.id, sequence: job.sequence ?? index + 1, status: job.status,
      scheduledDate: dateOnly(job.scheduledDate), driverId: job.driverId,
      helperId: job.helperId, vehicleId: job.vehicleId,
    })),
  });
}

function buildExceptions(units, routes, jobs) {
  const result = [];
  const push = (domain, aggregateType, aggregateId, code, severity, evidence, status = "KEEP_V1") => {
    result.push({ domain, aggregateType, aggregateId: aggregateId || "GLOBAL", code, severity, status, evidence: stableValue(evidence) });
  };
  for (const unit of units) {
    if (unit.status === "IN_PRODUCTION" && !unit.currentStageId && unit.stageLogs.length === 0) {
      push("PRODUCTION", "Unit", unit.id, "ACTIVE_WITHOUT_EXECUTION_EVIDENCE", "CRITICAL", { status: unit.status });
    }
    if (unit.currentStageId && !unit.serviceId) {
      push("PRODUCTION", "Unit", unit.id, "CURRENT_STAGE_WITHOUT_SERVICE", "HIGH", { currentStageId: unit.currentStageId });
    }
    const open = unit.blockers.filter((blocker) => !blocker.resolvedAt);
    if (open.length > 1) push("PRODUCTION", "Unit", unit.id, "MULTIPLE_OPEN_BLOCKERS", "CRITICAL", { blockerIds: open.map((b) => b.id) });
    if (unit.productionRoute && unit.stageLogs.some((log) => !unit.productionRoute.stages.some((stage) => stage.stageId === log.stageId))) {
      push("PRODUCTION", "Unit", unit.id, "EXECUTION_STAGE_OUTSIDE_ROUTE_SNAPSHOT", "HIGH", {
        stageIds: unit.stageLogs.map((log) => log.stageId), routeStageIds: unit.productionRoute.stages.map((stage) => stage.stageId),
      });
    }
  }
  for (const route of routes) {
    if (["PUBLISHED", "IN_PROGRESS"].includes(route.status) && !route.driverId) {
      push("DELIVERY", "Route", route.id, "ACTIVE_ROUTE_WITHOUT_DRIVER", "CRITICAL", { code: route.code, status: route.status });
    }
    const duplicateSequences = Object.entries(route.jobs.reduce((acc, job) => {
      const key = String(job.sequence);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})).filter(([key, count]) => key !== "null" && count > 1);
    if (duplicateSequences.length) push("DELIVERY", "Route", route.id, "DUPLICATE_STOP_SEQUENCE", "CRITICAL", { duplicateSequences });
    for (const job of route.jobs.filter((item) => !SETTLED_JOB.has(item.status))) {
      const mismatch = {
        driverId: job.driverId === route.driverId,
        helperId: job.helperId === route.helperId,
        vehicleId: job.vehicleId === route.vehicleId,
        date: dateOnly(job.scheduledDate) === dateOnly(route.date),
      };
      if (Object.values(mismatch).some((same) => !same)) {
        push("DELIVERY", "Route", route.id, "ROUTE_JOB_ASSIGNMENT_MISMATCH", "CRITICAL", { jobId: job.id, match: mismatch });
      }
    }
  }
  for (const job of jobs.filter((item) => !item.routeId && item.driverId && ["ASSIGNED", "EN_ROUTE", "ARRIVED"].includes(item.status))) {
    push("DELIVERY", "Job", job.id, "ACTIVE_ORPHAN_JOB", "HIGH", { status: job.status, driverId: job.driverId });
  }
  return result;
}

async function loadSource() {
  const [units, routes, jobs] = await Promise.all([
    prisma.unit.findMany({
      include: {
        order: { select: { id: true, category: true } },
        service: { select: { id: true, code: true, serviceLine: true } },
        currentStage: { select: { id: true, code: true, labelId: true, phase: true } },
        productionRoute: { include: { stages: { include: { stage: { select: { id: true, code: true, labelId: true, phase: true } } }, orderBy: { sequence: "asc" } } } },
        stageLogs: { include: { stage: { select: { id: true, code: true, labelId: true, phase: true } } }, orderBy: { createdAt: "asc" } },
        blockers: { orderBy: { openedAt: "asc" } },
        qcFitTests: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { id: "asc" },
    }),
    prisma.route.findMany({ include: { jobs: { orderBy: [{ sequence: "asc" }, { createdAt: "asc" }] } }, orderBy: { id: "asc" } }),
    prisma.job.findMany({ select: { id: true, routeId: true, driverId: true, status: true, updatedAt: true }, orderBy: { id: "asc" } }),
  ]);
  return { units, routes, jobs };
}

async function applyPlan(source, productionPlans, exceptions) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.v2MigrationRun.create({
      data: { kind: "INITIAL_BACKFILL", status: "RUNNING", sourceChecksum: checksum(source), startedAt: new Date(), metadata: { ruleVersion: RULE_VERSION } },
    });
    for (const plan of productionPlans) {
      const productionRun = await tx.productionRun.upsert({
        where: { migrationSource_migrationSourceId: { migrationSource: "UNIT_V1", migrationSourceId: plan.unitId } },
        create: {
          unitId: plan.unitId, kind: plan.kind, status: plan.status, currentPhase: plan.currentPhase,
          routeSnapshot: plan.routeSnapshot, routeChecksum: plan.routeChecksum,
          migrationSource: "UNIT_V1", migrationSourceId: plan.unitId,
          migrationRuleVersion: RULE_VERSION, migrationConfidence: exceptions.some((e) => e.aggregateId === plan.unitId) ? "REVIEW" : "HIGH",
          sourceChecksum: plan.sourceChecksum,
        },
        update: {
          kind: plan.kind, status: plan.status, currentPhase: plan.currentPhase,
          routeSnapshot: plan.routeSnapshot, routeChecksum: plan.routeChecksum,
          migrationRuleVersion: RULE_VERSION, migrationConfidence: exceptions.some((e) => e.aggregateId === plan.unitId) ? "REVIEW" : "HIGH",
          sourceChecksum: plan.sourceChecksum,
        },
      });
      for (const phase of plan.phases) {
        await tx.productionPhaseRun.upsert({
          where: { runId_phase: { runId: productionRun.id, phase: phase.phase } },
          create: { runId: productionRun.id, ...phase }, update: phase,
        });
      }
      for (const operation of plan.operations) {
        await tx.productionOperationRun.upsert({
          where: { runId_sequence: { runId: productionRun.id, sequence: operation.sequence } },
          create: { runId: productionRun.id, ...operation }, update: operation,
        });
      }
    }
    for (const route of source.routes) {
      const snapshot = routeSnapshot(route);
      await tx.deliveryRouteState.upsert({
        where: { routeId: route.id },
        create: { routeId: route.id, routeRevision: 1, currentPublicationVersion: route.status === "DRAFT" ? null : 1, migrationSource: "ROUTE_V1", sourceChecksum: checksum(snapshot) },
        update: { migrationSource: "ROUTE_V1", sourceChecksum: checksum(snapshot) },
      });
      if (route.status !== "DRAFT") {
        const publication = await tx.routePublication.upsert({
          where: { routeId_publicationVersion: { routeId: route.id, publicationVersion: 1 } },
          create: {
            routeId: route.id, publicationVersion: 1, routeRevision: 1,
            status: route.status === "CANCELLED" ? "REVOKED" : "ACTIVE",
            snapshot, checksum: checksum(snapshot), reason: "Baseline migrasi V1", migrationBaseline: true,
            publishedAt: route.publishedAt || route.createdAt,
          },
          update: { snapshot, checksum: checksum(snapshot) },
        });
        for (let index = 0; index < route.jobs.length; index += 1) {
          const job = route.jobs[index];
          await tx.routeStopAssignment.upsert({
            where: { publicationId_jobId: { publicationId: publication.id, jobId: job.id } },
            create: {
              publicationId: publication.id, jobId: job.id, sequence: job.sequence ?? index + 1,
              driverId: route.driverId, helperId: route.helperId, vehicleId: route.vehicleId,
              status: route.status === "CANCELLED" ? "REVOKED" : job.status === "COMPLETED" ? "COMPLETED" : "ACTIVE",
              revokedAt: route.status === "CANCELLED" ? route.updatedAt : null,
              completedAt: job.completedAt, sourceChecksum: checksum(stableValue(job)),
            },
            update: { sourceChecksum: checksum(stableValue(job)) },
          });
        }
      }
    }
    for (const job of source.jobs) {
      await tx.deliveryJobState.upsert({
        where: { jobId: job.id },
        create: { jobId: job.id, jobRevision: 1, currentStatus: job.status, sourceChecksum: checksum(stableValue(job)) },
        update: { currentStatus: job.status, sourceChecksum: checksum(stableValue(job)) },
      });
    }
    for (const exception of exceptions) {
      await tx.v2MigrationException.create({ data: { runId: run.id, ...exception } });
    }
    const resultChecksum = checksum({ productionPlans, routes: source.routes.map(routeSnapshot), jobs: source.jobs, exceptions });
    await tx.v2MigrationRun.update({
      where: { id: run.id },
      data: { status: "VERIFIED", finishedAt: new Date(), resultChecksum, counts: { units: source.units.length, routes: source.routes.length, jobs: source.jobs.length, exceptions: exceptions.length } },
    });
    return { migrationRunId: run.id, resultChecksum };
  }, { timeout: 120_000 });
}

async function main() {
  const source = await loadSource();
  const productionPlans = source.units.map(unitPlan);
  const exceptions = buildExceptions(source.units, source.routes, source.jobs);
  const report = {
    reportType: "production-delivery-v2-backfill",
    mode: apply ? "APPLY" : "DRY_RUN",
    generatedAt: new Date().toISOString(), ruleVersion: RULE_VERSION,
    counts: { units: source.units.length, routes: source.routes.length, jobs: source.jobs.length, exceptions: exceptions.length },
    sourceChecksum: checksum(source),
    planChecksum: checksum({ productionPlans, routes: source.routes.map(routeSnapshot), jobs: source.jobs, exceptions }),
    exceptions,
  };
  if (apply) report.applyResult = await applyPlan(source, productionPlans, exceptions);
  writeReport(args.output, report);
  console.log(jsonForOutput(report));
}

main().catch((error) => {
  console.error("[v2-backfill] GAGAL:", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
