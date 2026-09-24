import { createHash } from "node:crypto";
import { appendDriverFeedEvent } from "./driverFeedV2.js";

const TERMINAL_ROUTE_STATUSES = new Set(["COMPLETED", "CANCELLED"]);

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function conflict(message, code) {
  return Object.assign(new Error(message), { statusCode: 409, code });
}

// Koreksi historis terukur untuk assignment V2 yang tertinggal. Job/Route/
// Order dan bukti eksekusi tidak disentuh. Command, assignment revocation,
// feed, activity, dan outbox commit atau rollback dalam transaksi yang sama.
export async function revokeHistoricalFailedJobAssignment(prisma, {
  jobId,
  actorId,
  idempotencyKey,
  reason,
  provenance = "PRODUCTION_ADMIN_BYPASS",
}) {
  if (!jobId || !actorId || !idempotencyKey || !reason) throw new TypeError("jobId, actorId, idempotencyKey, dan reason wajib diisi");
  const requestHash = digest({ jobId, reason, provenance });

  return prisma.$transaction(async (tx) => {
    const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId, idempotencyKey } } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw conflict("Idempotency key dipakai untuk koreksi berbeda", "IDEMPOTENCY_CONFLICT");
      if (!["APPLIED", "ALREADY_APPLIED"].includes(replay.status)) throw conflict("Koreksi historis masih diproses", "COMMAND_IN_PROGRESS");
      return { replayed: true, ...replay.response };
    }

    await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM route_stop_assignments_v2 WHERE job_id = ${jobId}::uuid FOR UPDATE`;
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: {
        id: true, status: true, orderId: true, routeId: true, driverId: true, helperId: true,
        order: { select: { status: true } },
        route: { select: { status: true } },
        deliveryStateV2: { select: { jobRevision: true } },
        stopAssignmentsV2: {
          where: { status: "ACTIVE" },
          select: {
            id: true, driverId: true, helperId: true,
            publication: { select: { routeId: true, publicationVersion: true, routeRevision: true } },
          },
        },
      },
    });
    if (!job) throw Object.assign(new Error("Job tidak ditemukan"), { statusCode: 404 });
    if (job.status !== "FAILED") throw conflict(`Job berstatus ${job.status}, bukan FAILED`, "HISTORICAL_REVOKE_UNSAFE_JOB_STATUS");
    if (!job.route || !TERMINAL_ROUTE_STATUSES.has(job.route.status)) {
      throw conflict(`Route berstatus ${job.route?.status || "NONE"}; assignment aktif tidak aman dicabut otomatis`, "HISTORICAL_REVOKE_NON_TERMINAL_ROUTE");
    }
    if (job.order.status !== "CANCELLED") {
      throw conflict(`Order berstatus ${job.order.status}; butuh keputusan Ops sebelum revoke`, "HISTORICAL_REVOKE_ORDER_NOT_CANCELLED");
    }
    if (!job.deliveryStateV2) throw conflict("Job belum memiliki baseline V2", "V2_BASELINE_MISSING");

    const command = await tx.v2Command.create({
      data: {
        domain: "DELIVERY", actorId, idempotencyKey,
        commandType: "REVOKE_HISTORICAL_FAILED_ASSIGNMENT",
        aggregateType: "Job", aggregateId: jobId,
        expectedRevision: job.deliveryStateV2.jobRevision,
        requestHash,
      },
    });
    const assignmentIds = job.stopAssignmentsV2.map((item) => item.id);
    const now = new Date();
    if (assignmentIds.length) {
      await tx.routeStopAssignment.updateMany({
        where: { id: { in: assignmentIds }, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: now },
      });
    }

    const recipients = unique(job.stopAssignmentsV2.flatMap((item) => [item.driverId, item.helperId]));
    const publicationVersion = Math.max(0, ...job.stopAssignmentsV2.map((item) => item.publication.publicationVersion)) || null;
    const routeRevision = Math.max(0, ...job.stopAssignmentsV2.map((item) => item.publication.routeRevision)) || null;
    for (const userId of recipients) {
      await appendDriverFeedEvent(tx, {
        userId, kind: "REMOVE_JOB", aggregateType: "Job", aggregateId: jobId,
        aggregateRevision: job.deliveryStateV2.jobRevision, publicationVersion,
        payload: { jobId, routeId: job.routeId, revoked: true, reason, provenance },
      });
      await appendDriverFeedEvent(tx, {
        userId, kind: "REMOVE_ROUTE", aggregateType: "Route", aggregateId: job.routeId,
        aggregateRevision: routeRevision, publicationVersion,
        payload: { routeId: job.routeId, revoked: true, reason, provenance },
      });
    }

    await tx.activityEvent.create({
      data: {
        entityType: "job", entityId: jobId,
        eventType: "HISTORICAL_ASSIGNMENT_REVOKED", actorId,
        metadata: {
          provenance, reason, routeId: job.routeId,
          assignmentIds, preserved: ["JOB", "ROUTE", "ORDER", "EVENTS", "AUDIT_TRAIL"],
        },
      },
    });
    await tx.domainOutbox.create({
      data: {
        domain: "DELIVERY", eventType: "delivery.assignment.historical.revoked",
        aggregateType: "Job", aggregateId: jobId,
        aggregateRevision: job.deliveryStateV2.jobRevision,
        dedupeKey: `delivery-historical-assignment-revoked:${command.id}`,
        payload: { jobId, routeId: job.routeId, assignmentIds, recipients, reason, provenance },
      },
    });
    const response = {
      jobId, routeId: job.routeId, assignmentIds, revokedCount: assignmentIds.length,
      recipients, provenance, alreadyApplied: assignmentIds.length === 0,
    };
    await tx.v2Command.update({
      where: { id: command.id },
      data: {
        status: assignmentIds.length ? "APPLIED" : "ALREADY_APPLIED",
        appliedRevision: job.deliveryStateV2.jobRevision,
        response,
        completedAt: now,
      },
    });
    return { replayed: false, ...response };
  }, { isolationLevel: "Serializable", timeout: 30_000 });
}
