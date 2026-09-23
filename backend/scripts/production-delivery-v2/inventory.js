#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { checksum, databaseIdentity, jsonForOutput, parseArgs, writeReport } from "./common.js";

const prisma = new PrismaClient();
const args = parseArgs();

async function grouped(model, by) {
  const rows = await model.groupBy({ by: [by], _count: { _all: true } });
  return Object.fromEntries(rows.map((row) => [String(row[by]), row._count._all]));
}

function sampled(rows, limit = 25) {
  if (!Array.isArray(rows)) return rows;
  return {
    count: rows.length,
    sample: rows.slice(0, limit),
    truncated: rows.length > limit,
  };
}

async function main() {
  const [
    orderCount, unitCount, jobCount, routeCount,
    unitsByStatus, jobsByStatus, jobsByType, routesByStatus,
    orphanActiveJobs, duplicateJobUnits, routeAssignmentMismatches,
    duplicateRouteSequences, openBlockersByUnit, unitsWithoutRouteSnapshot,
    activeDevices, executionEvents, positionPings,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.unit.count(),
    prisma.job.count(),
    prisma.route.count(),
    grouped(prisma.unit, "status"),
    grouped(prisma.job, "status"),
    grouped(prisma.job, "type"),
    grouped(prisma.route, "status"),
    prisma.job.findMany({
      where: { routeId: null, status: { in: ["ASSIGNED", "EN_ROUTE", "ARRIVED"] }, driverId: { not: null } },
      select: { id: true, status: true, driverId: true, scheduledDate: true, updatedAt: true },
      orderBy: { updatedAt: "asc" },
    }),
    prisma.$queryRaw`
      SELECT ju.unit_id, COUNT(DISTINCT ju.job_id)::int AS count
      FROM job_units ju
      JOIN jobs j ON j.id = ju.job_id
      WHERE j.status NOT IN ('COMPLETED', 'FAILED', 'RESCHEDULED')
      GROUP BY ju.unit_id
      HAVING COUNT(DISTINCT ju.job_id) > 1
      ORDER BY COUNT(DISTINCT ju.job_id) DESC, ju.unit_id
    `,
    prisma.$queryRaw`
      SELECT j.id AS job_id, j.route_id, j.status::text AS job_status,
             r.status::text AS route_status,
             r.driver_id AS route_driver_id, j.driver_id AS job_driver_id,
             r.helper_id AS route_helper_id, j.helper_id AS job_helper_id,
             r.vehicle_id AS route_vehicle_id, j.vehicle_id AS job_vehicle_id,
             r.date::text AS route_date, j.scheduled_date::text AS job_date
      FROM jobs j
      JOIN routes r ON r.id = j.route_id
      WHERE j.status NOT IN ('COMPLETED', 'FAILED', 'RESCHEDULED')
        AND (
          j.driver_id IS DISTINCT FROM r.driver_id OR
          j.helper_id IS DISTINCT FROM r.helper_id OR
          j.vehicle_id IS DISTINCT FROM r.vehicle_id OR
          j.scheduled_date IS DISTINCT FROM r.date
        )
      ORDER BY r.date, r.code, j.sequence NULLS LAST, j.id
    `,
    prisma.$queryRaw`
      SELECT route_id, sequence, COUNT(*)::int AS count
      FROM jobs
      WHERE route_id IS NOT NULL AND sequence IS NOT NULL
      GROUP BY route_id, sequence
      HAVING COUNT(*) > 1
      ORDER BY route_id, sequence
    `,
    prisma.$queryRaw`
      SELECT unit_id, COUNT(*)::int AS count
      FROM production_blockers
      WHERE resolved_at IS NULL
      GROUP BY unit_id
      HAVING COUNT(*) > 1
      ORDER BY unit_id
    `,
    prisma.unit.count({ where: { status: { in: ["RECEIVED", "IN_PRODUCTION"] }, productionRouteId: null } }),
    prisma.mobileSession.count({ where: { revokedAt: null } }).catch(() => 0),
    prisma.deliveryExecutionEvent.count(),
    prisma.jobPositionPing.count(),
  ]);

  const report = {
    reportType: "production-delivery-v2-inventory",
    generatedAt: new Date().toISOString(),
    database: databaseIdentity(),
    baseline: { orderCount, unitCount, jobCount, routeCount, executionEvents, positionPings, activeDevices },
    distributions: { unitsByStatus, jobsByStatus, jobsByType, routesByStatus },
    anomalies: {
      orphanActiveJobs: sampled(orphanActiveJobs),
      duplicateActiveJobUnits: sampled(duplicateJobUnits),
      routeAssignmentMismatches: sampled(routeAssignmentMismatches),
      duplicateRouteSequences: sampled(duplicateRouteSequences),
      openBlockersByUnit: sampled(openBlockersByUnit),
      unitsWithoutRouteSnapshot,
    },
  };
  report.dataChecksum = checksum({ baseline: report.baseline, distributions: report.distributions, anomalies: report.anomalies });
  writeReport(args.output, report);
  console.log(jsonForOutput(report));
}

main().catch((error) => {
  console.error("[v2-inventory] GAGAL:", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
