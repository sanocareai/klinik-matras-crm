#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const TARGET_ROUTE_CODE = "RTE-240926-02";
const PENDING_OPS_JOB_ID = "7d34e05d-b7f2-43cd-8842-31e13645492f";
const EXCEPTION_CODE = "ROUTE_JOB_ASSIGNMENT_MISMATCH";

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    routeId: job.routeId,
    driverId: job.driverId,
    helperId: job.helperId,
    vehicleId: job.vehicleId,
    scheduledDate: job.scheduledDate,
    arrivedAt: job.arrivedAt,
    completedAt: job.completedAt,
    hasFailureReason: Boolean(job.failureReason),
    issueCount: job._count?.issueLogs ?? 0,
    executionEventCount: job._count?.executionEvents ?? 0,
    rescheduleCount: job._count?.rescheduleCases ?? 0,
    order: job.order,
    route: job.route,
    latestExecutionEvent: job.executionEvents?.[0] || null,
    activeAssignments: job.stopAssignmentsV2,
  };
}

export async function buildDriverV2OpsDecisionPack(prisma) {
  const [targetRoute, pendingJob, mismatch, flags] = await Promise.all([
    prisma.route.findUnique({
      where: { code: TARGET_ROUTE_CODE },
      select: {
        id: true, code: true, status: true, date: true, driverId: true, helperId: true, vehicleId: true,
        jobs: {
          orderBy: [{ sequence: "asc" }, { id: "asc" }],
          select: { id: true, status: true, sequence: true, driverId: true, helperId: true, vehicleId: true },
        },
        deliveryStateV2: { select: { routeRevision: true, currentPublicationVersion: true, lifecycleStatus: true } },
        publicationsV2: {
          where: { status: "ACTIVE" },
          select: {
            id: true, publicationVersion: true, routeRevision: true, status: true,
            assignments: {
              orderBy: { sequence: "asc" },
              select: {
                id: true, jobId: true, status: true, sequence: true,
                driverId: true, helperId: true, vehicleId: true,
                job: {
                  select: {
                    status: true, routeId: true, driverId: true, helperId: true,
                    vehicleId: true, scheduledDate: true, completedAt: true,
                    cancellationV2: { select: { id: true, cancelledAt: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.job.findUnique({
      where: { id: PENDING_OPS_JOB_ID },
      select: {
        id: true, status: true, routeId: true, driverId: true, helperId: true, vehicleId: true,
        scheduledDate: true, arrivedAt: true, completedAt: true, failureReason: true,
        order: { select: { id: true, orderNumber: true, status: true } },
        route: { select: { id: true, code: true, status: true } },
        executionEvents: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, action: true, createdAt: true } },
        stopAssignmentsV2: { where: { status: "ACTIVE" }, select: { id: true, publicationId: true, status: true } },
        _count: { select: { issueLogs: true, executionEvents: true, rescheduleCases: true } },
      },
    }),
    prisma.v2MigrationException.findFirst({
      where: { code: EXCEPTION_CODE, status: { in: ["OPEN", "KEEP_V1"] } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.v2FeatureFlag.findMany({
      orderBy: { key: "asc" },
      select: { key: true, enabled: true, scope: true, updatedAt: true },
    }),
  ]);

  let mismatchAggregate = null;
  if (mismatch?.aggregateId) {
    const [route, job] = await Promise.all([
      prisma.route.findUnique({
        where: { id: mismatch.aggregateId },
        select: {
          id: true, code: true, status: true, date: true,
          driverId: true, helperId: true, vehicleId: true,
          jobs: {
            orderBy: [{ sequence: "asc" }, { id: "asc" }],
            select: {
              id: true, status: true, sequence: true, scheduledDate: true,
              driverId: true, helperId: true, vehicleId: true,
              cancellationV2: { select: { id: true, cancelledAt: true } },
            },
          },
          deliveryStateV2: {
            select: {
              routeRevision: true, currentPublicationVersion: true,
              lifecycleStatus: true, migrationSource: true, sourceChecksum: true,
            },
          },
          publicationsV2: {
            orderBy: { publicationVersion: "asc" },
            select: {
              id: true, publicationVersion: true, routeRevision: true,
              status: true, checksum: true,
              assignments: {
                orderBy: { sequence: "asc" },
                select: { id: true, jobId: true, status: true, sequence: true },
              },
            },
          },
        },
      }),
      mismatch.evidence?.jobId ? prisma.job.findUnique({
        where: { id: mismatch.evidence.jobId },
        select: {
          id: true, status: true, routeId: true, scheduledDate: true, driverId: true, helperId: true, vehicleId: true,
          order: { select: { id: true, orderNumber: true, status: true } },
          route: { select: { id: true, code: true, status: true } },
          stopAssignmentsV2: { select: { id: true, status: true, vehicleId: true, publicationId: true } },
        },
      }) : null,
    ]);
    mismatchAggregate = { route, job };
  }

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    flags,
    targetRoute,
    pendingOpsJob: publicJob(pendingJob),
    assignmentMismatch: mismatch ? {
      id: mismatch.id,
      aggregateId: mismatch.aggregateId,
      status: mismatch.status,
      severity: mismatch.severity,
      code: mismatch.code,
      evidence: mismatch.evidence,
      createdAt: mismatch.createdAt,
      aggregate: mismatchAggregate,
    } : null,
  };
}

const prisma = new PrismaClient();
buildDriverV2OpsDecisionPack(prisma)
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
