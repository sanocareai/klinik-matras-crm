#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { checksum, dateOnly, jsonForOutput, parseArgs, stableValue, writeReport } from "./common.js";

const prisma = new PrismaClient();
const args = parseArgs();

function currentRouteSnapshot(route) {
  const activeJobs = route.jobs.filter((job) => !job.cancellationV2);
  return stableValue({
    routeId: route.id, code: route.code, date: dateOnly(route.date), status: route.status,
    driverId: route.driverId, helperId: route.helperId, vehicleId: route.vehicleId,
    notes: route.notes, manualMapsUrl: route.manualMapsUrl,
    stops: activeJobs.map((job, index) => ({
      jobId: job.id, sequence: job.sequence ?? index + 1, status: job.status,
      scheduledDate: dateOnly(job.scheduledDate), driverId: job.driverId,
      helperId: job.helperId, vehicleId: job.vehicleId,
    })),
  });
}

function comparableRouteSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  return stableValue({
    routeId: snapshot.routeId,
    code: snapshot.code,
    date: dateOnly(snapshot.date),
    status: snapshot.status,
    driverId: snapshot.driverId ?? null,
    helperId: snapshot.helperId ?? null,
    vehicleId: snapshot.vehicleId ?? null,
    notes: snapshot.notes ?? null,
    manualMapsUrl: snapshot.manualMapsUrl ?? null,
    stops: (snapshot.stops || []).map((job, index) => ({
      jobId: job.jobId,
      sequence: job.sequence ?? index + 1,
      status: job.status,
      scheduledDate: dateOnly(job.scheduledDate),
      driverId: job.driverId ?? null,
      helperId: job.helperId ?? null,
      vehicleId: job.vehicleId ?? null,
    })),
  });
}

async function main() {
  const [routes, jobs, productionRuns] = await Promise.all([
    prisma.route.findMany({
      include: {
        jobs: { include: { cancellationV2: true }, orderBy: [{ sequence: "asc" }, { createdAt: "asc" }] },
        deliveryStateV2: true,
        publicationsV2: { orderBy: { publicationVersion: "desc" }, take: 1 },
      },
      orderBy: { id: "asc" },
    }),
    prisma.job.findMany({ include: { deliveryStateV2: true }, orderBy: { id: "asc" } }),
    prisma.productionRun.findMany({ include: { unit: true }, orderBy: { unitId: "asc" } }),
  ]);
  const comparisons = [];
  for (const route of routes) {
    const snapshot = currentRouteSnapshot(route);
    const publication = route.publicationsV2[0] || null;
    const canonicalSnapshot = publication?.snapshot || route.deliveryStateV2?.draftSnapshot || null;
    const comparableV2 = comparableRouteSnapshot(canonicalSnapshot);
    const differences = [];
    if (!route.deliveryStateV2) differences.push("MISSING_ROUTE_STATE_V2");
    if (route.status !== "DRAFT" && !publication) differences.push("MISSING_CURRENT_PUBLICATION");
    if (comparableV2 && checksum(comparableV2) !== checksum(snapshot)) differences.push("ROUTE_PROJECTION_MISMATCH");
    if (route.deliveryStateV2 && route.deliveryStateV2.lifecycleStatus !== route.status) differences.push("ROUTE_LIFECYCLE_STATUS_MISMATCH");
    comparisons.push({
      domain: "DELIVERY", aggregateType: "Route", aggregateId: route.id,
      status: differences.length ? "MISMATCH" : "MATCH",
      v1Checksum: checksum(snapshot), v2Checksum: comparableV2 ? checksum(comparableV2) : null, differences,
    });
  }
  for (const job of jobs) {
    const source = stableValue({ id: job.id, routeId: job.routeId, driverId: job.driverId, status: job.status, updatedAt: job.updatedAt });
    const differences = [];
    if (!job.deliveryStateV2) differences.push("MISSING_JOB_STATE_V2");
    if (job.deliveryStateV2 && job.deliveryStateV2.currentStatus !== job.status) differences.push("JOB_STATUS_MISMATCH");
    if (job.deliveryStateV2 && job.deliveryStateV2.sourceChecksum !== checksum(source)) differences.push("JOB_SOURCE_CHECKSUM_MISMATCH");
    comparisons.push({
      domain: "DELIVERY", aggregateType: "Job", aggregateId: job.id,
      status: differences.length ? "MISMATCH" : "MATCH", v1Checksum: checksum(source),
      v2Checksum: job.deliveryStateV2?.sourceChecksum || null, differences,
    });
  }
  for (const run of productionRuns) {
    const differences = [];
    const terminal = ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"].includes(run.unit.status);
    if (terminal && run.status !== "COMPLETED") differences.push("TERMINAL_UNIT_RUN_NOT_COMPLETED");
    if (run.unit.status === "IN_PRODUCTION" && !["ACTIVE", "BLOCKED", "MIGRATION_REVIEW"].includes(run.status)) differences.push("ACTIVE_UNIT_RUN_STATUS_MISMATCH");
    comparisons.push({
      domain: "PRODUCTION", aggregateType: "Unit", aggregateId: run.unitId,
      status: differences.length ? "MISMATCH" : "MATCH", v1Checksum: null, v2Checksum: run.sourceChecksum, differences,
    });
  }
  if (args.record) {
    if (process.env.ALLOW_V2_SHADOW_RECORD !== "YES") throw new Error("Mode record ditolak. Set ALLOW_V2_SHADOW_RECORD=YES.");
    await prisma.v2ShadowComparison.createMany({ data: comparisons });
  }
  const report = {
    reportType: "production-delivery-v2-shadow-comparison",
    generatedAt: new Date().toISOString(), recorded: !!args.record,
    totals: {
      all: comparisons.length,
      match: comparisons.filter((item) => item.status === "MATCH").length,
      mismatch: comparisons.filter((item) => item.status === "MISMATCH").length,
    },
    comparisons,
  };
  writeReport(args.output, report);
  console.log(jsonForOutput(report));
  if (report.totals.mismatch > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error("[v2-shadow] GAGAL:", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
