#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { DRIVER_ACTIVE_ROUTE_STATUSES_V2, isDriverVisibleAssignmentV2 } from "../../src/services/deliveryV2Snapshot.js";
import { loadV2Flags } from "../../src/services/v2FeatureFlags.js";
import { jsonForOutput, parseArgs, writeReport } from "./common.js";

const prisma = new PrismaClient();
const args = parseArgs();

async function main() {
  const [flags, publications, failedAssignedJobs, unresolvedAdminBypass] = await Promise.all([
    loadV2Flags(prisma),
    prisma.routePublication.findMany({
      where: { status: "ACTIVE" },
      select: {
        routeId: true,
        publicationVersion: true,
        route: { select: { code: true, status: true } },
        assignments: { select: { jobId: true, status: true, driverId: true, helperId: true } },
      },
      orderBy: { routeId: "asc" },
    }),
    prisma.job.findMany({
      where: {
        status: "FAILED",
        routeId: { not: null },
        stopAssignmentsV2: { some: { status: "ACTIVE" } },
      },
      select: {
        id: true,
        status: true,
        driverId: true,
        helperId: true,
        arrivedAt: true,
        completedAt: true,
        failureReason: true,
        proofPhotoUrls: true,
        route: { select: { id: true, code: true, status: true } },
        order: { select: { id: true, orderNumber: true, status: true } },
        units: { select: { unit: { select: { id: true, unitCode: true, status: true } } } },
        issueLogs: { select: { id: true, createdAt: true } },
        executionEvents: { select: { id: true, action: true, createdAt: true }, orderBy: { createdAt: "asc" } },
        rescheduleCases: { select: { id: true, status: true } },
        stopAssignmentsV2: { where: { status: "ACTIVE" }, select: { id: true, publicationId: true } },
      },
      orderBy: { id: "asc" },
    }),
    prisma.v2MigrationException.count({
      where: {
        code: "CURRENT_STAGE_WITHOUT_SERVICE",
        aggregateId: { in: [
          "34d3d6d6-cca8-4c66-b397-e597b607a412",
          "8052716f-d30a-4421-a265-c7a6061bdb75",
          "97dd6710-0f4a-4872-9deb-c7440a0f73a8",
          "c54c7a5b-6149-479e-91b1-0c86b62753e7",
          "d4e4f0ae-a008-4913-ad68-3da6e1839a55",
        ] },
        status: { in: ["OPEN", "KEEP_V1"] },
      },
    }),
  ]);

  const routes = publications.map((publication) => ({
    routeId: publication.routeId,
    code: publication.route.code,
    routeStatus: publication.route.status,
    publicationVersion: publication.publicationVersion,
    activeSnapshotEligible: DRIVER_ACTIVE_ROUTE_STATUSES_V2.includes(publication.route.status),
    visibleStops: publication.assignments.filter((assignment) => (
      isDriverVisibleAssignmentV2(publication.route.status, assignment.status)
    )).length,
    activeStops: publication.assignments.filter((assignment) => assignment.status === "ACTIVE").length,
    completedStops: publication.assignments.filter((assignment) => assignment.status === "COMPLETED").length,
  }));
  const report = {
    reportType: "driver-v2-cutover-readiness",
    generatedAt: new Date().toISOString(),
    flags: Object.fromEntries(Object.entries(flags).map(([key, value]) => [key, Boolean(value.enabled)])),
    allFlagsOff: Object.values(flags).every((value) => !value.enabled),
    unresolvedAdminBypass,
    publicationSummary: {
      activeRows: publications.length,
      terminalRowsExcludedByPredicate: routes.filter((route) => !route.activeSnapshotEligible).length,
      activeSnapshotRoutes: routes.filter((route) => route.activeSnapshotEligible).length,
      visibleStops: routes.reduce((sum, route) => sum + route.visibleStops, 0),
    },
    routes,
    failedAssignedJobs: failedAssignedJobs.map((job) => ({
      id: job.id,
      status: job.status,
      driverId: job.driverId,
      helperId: job.helperId,
      arrivedAt: job.arrivedAt,
      completedAt: job.completedAt,
      hasFailureReason: Boolean(job.failureReason),
      proofPhotoCount: job.proofPhotoUrls.length,
      route: job.route,
      order: job.order,
      units: job.units,
      issueLogs: job.issueLogs,
      executionEvents: job.executionEvents,
      rescheduleCases: job.rescheduleCases,
      activeAssignments: job.stopAssignmentsV2,
    })),
  };
  writeReport(args.output, report);
  console.log(jsonForOutput(report));
}

main().catch((error) => {
  console.error("[driver-cutover-audit] GAGAL:", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
