import { executeDeliveryRouteCommand } from "./deliveryRouteCommandService.js";

const ACTIVE_JOB_STATUSES = new Set(["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"]);
const TERMINAL_JOB_STATUSES = new Set(["COMPLETED", "FAILED", "RESCHEDULED"]);

export const DELIVERY_ROUTE_RECONCILIATION_MODE = Object.freeze({
  TERMINAL_ASSIGNMENTS: "TERMINAL_ASSIGNMENTS",
  PUBLISHED_CATCH_UP: "PUBLISHED_CATCH_UP",
});

function conflict(message, code, details = undefined) {
  return Object.assign(new Error(message), { statusCode: 409, code, ...(details ? { details } : {}) });
}

function dateOnly(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

function equalNullable(left, right) {
  return (left ?? null) === (right ?? null);
}

function sorted(values) {
  return [...values].sort();
}

function assertUniqueSequences(jobs) {
  const seen = new Set();
  for (const job of jobs) {
    if (job.sequence == null) continue;
    if (seen.has(job.sequence)) {
      throw conflict(`Sequence ${job.sequence} dipakai lebih dari satu Job`, "ROUTE_RECONCILIATION_DUPLICATE_SEQUENCE");
    }
    seen.add(job.sequence);
  }
}

async function loadRouteEvidence(tx, routeId, mode) {
  const route = await tx.route.findUnique({
    where: { id: routeId },
    include: {
      jobs: {
        orderBy: [{ sequence: "asc" }, { id: "asc" }],
        include: { cancellationV2: { select: { id: true } } },
      },
      deliveryStateV2: true,
    },
  });
  if (!route) throw Object.assign(new Error("Rute tidak ditemukan"), { statusCode: 404 });
  const allowedStatuses = mode === DELIVERY_ROUTE_RECONCILIATION_MODE.TERMINAL_ASSIGNMENTS
    ? ["PUBLISHED", "IN_PROGRESS", "COMPLETED"]
    : ["PUBLISHED", "IN_PROGRESS"];
  if (!allowedStatuses.includes(route.status)) {
    throw conflict(`Route berstatus ${route.status}; rekonsiliasi publication tidak aman`, "ROUTE_RECONCILIATION_UNSAFE_STATUS");
  }
  if (!route.driverId) {
    throw conflict("Route aktif tidak memiliki driver", "ROUTE_RECONCILIATION_DRIVER_MISSING");
  }
  const jobs = route.jobs.filter((job) => !job.cancellationV2);
  if (!jobs.length) throw conflict("Route tidak memiliki Job kanonis", "ROUTE_RECONCILIATION_EMPTY_ROUTE");
  assertUniqueSequences(jobs);
  return { route, jobs };
}

async function validateTerminalAssignments(tx, route, jobs, expected) {
  if (jobs.some((job) => !TERMINAL_JOB_STATUSES.has(job.status))) {
    throw conflict("Mode terminal hanya aman bila seluruh Job V1 terbukti terminal", "ROUTE_RECONCILIATION_NON_TERMINAL_JOB", {
      jobs: jobs.filter((job) => !TERMINAL_JOB_STATUSES.has(job.status)).map((job) => ({ id: job.id, status: job.status })),
    });
  }
  if (expected?.v1JobCount != null && jobs.length !== expected.v1JobCount) {
    throw conflict(`Jumlah Job V1 berubah: expected ${expected.v1JobCount}, current ${jobs.length}`, "ROUTE_RECONCILIATION_SOURCE_CHANGED");
  }
  const publicationVersion = route.deliveryStateV2?.currentPublicationVersion;
  if (!publicationVersion) throw conflict("Route belum memiliki publication V2 aktif", "ROUTE_RECONCILIATION_PUBLICATION_MISSING");
  const publication = await tx.routePublication.findUnique({
    where: { routeId_publicationVersion: { routeId: route.id, publicationVersion } },
    include: {
      assignments: {
        orderBy: [{ sequence: "asc" }, { id: "asc" }],
        include: { job: { select: { id: true, status: true, routeId: true } } },
      },
    },
  });
  if (!publication || publication.status !== "ACTIVE") {
    throw conflict("Publication current tidak ACTIVE", "ROUTE_RECONCILIATION_PUBLICATION_NOT_ACTIVE");
  }
  if (expected?.v2AssignmentCount != null && publication.assignments.length !== expected.v2AssignmentCount) {
    throw conflict(`Jumlah assignment V2 berubah: expected ${expected.v2AssignmentCount}, current ${publication.assignments.length}`, "ROUTE_RECONCILIATION_SOURCE_CHANGED");
  }
  const canonicalIds = new Set(jobs.map((job) => job.id));
  const active = publication.assignments.filter((assignment) => assignment.status === "ACTIVE");
  const unsafe = active.filter((assignment) => {
    if (canonicalIds.has(assignment.jobId)) return !TERMINAL_JOB_STATUSES.has(assignment.job.status);
    return !assignment.job.routeId || assignment.job.routeId === route.id;
  });
  if (unsafe.length) {
    throw conflict("Ada assignment aktif yang belum terbukti terminal atau berpindah route", "ROUTE_RECONCILIATION_ASSIGNMENT_AMBIGUOUS", {
      assignments: unsafe.map((item) => ({ id: item.id, jobId: item.jobId, jobStatus: item.job.status, jobRouteId: item.job.routeId })),
    });
  }
  const extra = publication.assignments.filter((assignment) => !canonicalIds.has(assignment.jobId));
  return {
    sourceJobIds: sorted(canonicalIds),
    priorPublicationId: publication.id,
    priorPublicationVersion: publication.publicationVersion,
    priorAssignmentCount: publication.assignments.length,
    activeAssignmentIds: sorted(active.map((assignment) => assignment.id)),
    terminalAssignmentIds: sorted(publication.assignments.filter((assignment) => canonicalIds.has(assignment.jobId)).map((assignment) => assignment.id)),
    extraAssignments: extra.map((assignment) => ({
      assignmentId: assignment.id,
      jobId: assignment.jobId,
      jobStatus: assignment.job.status,
      currentRouteId: assignment.job.routeId,
    })),
  };
}

async function validatePublishedCatchUp(tx, route, jobs, exceptionId, expected) {
  if (route.status !== "PUBLISHED") {
    throw conflict(`Catch-up mensyaratkan route PUBLISHED, current ${route.status}`, "ROUTE_CATCHUP_NOT_PUBLISHED");
  }
  if (route.deliveryStateV2?.currentPublicationVersion != null) {
    throw conflict("Route sudah memiliki publication V2; catch-up baru ditolak", "ROUTE_CATCHUP_ALREADY_PUBLISHED");
  }
  if (expected?.v1JobCount != null && jobs.length !== expected.v1JobCount) {
    throw conflict(`Jumlah Job V1 berubah: expected ${expected.v1JobCount}, current ${jobs.length}`, "ROUTE_RECONCILIATION_SOURCE_CHANGED");
  }
  const invalid = jobs.filter((job) => !ACTIVE_JOB_STATUSES.has(job.status) || !(
    equalNullable(job.driverId, route.driverId)
    && equalNullable(job.helperId, route.helperId)
    && equalNullable(job.vehicleId, route.vehicleId)
    && dateOnly(job.scheduledDate) === dateOnly(route.date)
  ));
  if (invalid.length) {
    throw conflict("Sumber V1 masih ambigu; route tetap KEEP_V1", "ROUTE_JOB_ASSIGNMENT_AMBIGUOUS", {
      jobs: invalid.map((job) => ({
        id: job.id,
        status: job.status,
        match: {
          driverId: equalNullable(job.driverId, route.driverId),
          helperId: equalNullable(job.helperId, route.helperId),
          vehicleId: equalNullable(job.vehicleId, route.vehicleId),
          date: dateOnly(job.scheduledDate) === dateOnly(route.date),
        },
      })),
    });
  }
  const duplicateAssignment = await tx.routeStopAssignment.findFirst({
    where: { publication: { routeId: route.id }, jobId: { in: jobs.map((job) => job.id) } },
    select: { id: true, jobId: true, publicationId: true },
  });
  if (duplicateAssignment) {
    throw conflict("Assignment V2 route sudah ada di luar state current", "ROUTE_CATCHUP_DUPLICATE_ASSIGNMENT", duplicateAssignment);
  }
  let exception = null;
  if (exceptionId) {
    exception = await tx.v2MigrationException.findUnique({ where: { id: exceptionId } });
    if (!exception || exception.aggregateId !== route.id || exception.code !== "ROUTE_JOB_ASSIGNMENT_MISMATCH") {
      throw conflict("Exception catch-up tidak cocok dengan route", "ROUTE_CATCHUP_EXCEPTION_MISMATCH");
    }
    if (!["OPEN", "KEEP_V1"].includes(exception.status)) {
      throw conflict(`Exception berstatus ${exception.status}`, "ROUTE_CATCHUP_EXCEPTION_ALREADY_CLOSED");
    }
  }
  return {
    sourceJobIds: jobs.map((job) => job.id),
    exactCrew: { driverId: route.driverId, helperId: route.helperId, vehicleId: route.vehicleId },
    scheduledDate: dateOnly(route.date),
    exceptionId: exception?.id || null,
  };
}

// Satu command owner administratif untuk memperbarui read model/publication
// V2 dari state V1 terbaru. Compatibility projection V1 sengaja no-op;
// seluruh perubahan publication, assignment, feed, outbox, activity, dan
// penyelesaian exception berada dalam transaksi serializable yang sama.
export async function reconcileDeliveryRouteFromV1(prisma, {
  routeId,
  actorId,
  idempotencyKey,
  mode,
  reason,
  exceptionId = null,
  expected = {},
}) {
  if (!Object.values(DELIVERY_ROUTE_RECONCILIATION_MODE).includes(mode)) throw new TypeError("Mode rekonsiliasi tidak dikenal");
  return executeDeliveryRouteCommand(prisma, {
    routeId,
    actorId,
    idempotencyKey,
    commandType: mode === DELIVERY_ROUTE_RECONCILIATION_MODE.TERMINAL_ASSIGNMENTS
      ? "RECONCILE_TERMINAL_ROUTE_ASSIGNMENTS"
      : "CATCH_UP_PUBLISHED_ROUTE_FROM_V1",
    reason,
    request: { mode, exceptionId, expected },
    forcePublication: true,
    projectV1: async (tx) => {
      const { route, jobs } = await loadRouteEvidence(tx, routeId, mode);
      const evidence = mode === DELIVERY_ROUTE_RECONCILIATION_MODE.TERMINAL_ASSIGNMENTS
        ? await validateTerminalAssignments(tx, route, jobs, expected)
        : await validatePublishedCatchUp(tx, route, jobs, exceptionId, expected);
      if (evidence.exceptionId) {
        await tx.v2MigrationException.update({
          where: { id: evidence.exceptionId },
          data: {
            status: "RESOLVED",
            resolvedById: actorId,
            resolvedAt: new Date(),
            resolution: {
              action: "CANONICAL_V1_CATCH_UP",
              reason,
              exactCrew: evidence.exactCrew,
              sourceJobIds: evidence.sourceJobIds,
            },
          },
        });
      }
      await tx.activityEvent.create({
        data: {
          entityType: "route",
          entityId: routeId,
          eventType: mode === DELIVERY_ROUTE_RECONCILIATION_MODE.TERMINAL_ASSIGNMENTS
            ? "DELIVERY_V2_ASSIGNMENTS_RECONCILED"
            : "DELIVERY_V2_ROUTE_CAUGHT_UP",
          actorId,
          metadata: { mode, reason, evidence, preserved: ["JOB", "ROUTE", "PUBLICATION", "FEED", "AUDIT_TRAIL"] },
        },
      });
      return { routeId, commandResponse: { mode, evidence } };
    },
  });
}
