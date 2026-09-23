import { executeDeliveryCrossBoundaryCommand } from "./deliveryCrossBoundaryCommandService.js";
import { V2_FLAGS } from "./v2FeatureFlags.js";

const CANCELLABLE_JOB_STATUSES = ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"];

function conflict(message, code, details = undefined) {
  return Object.assign(new Error(message), { statusCode: 409, code, ...(details ? { details } : {}) });
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

/**
 * Immutable order-cancellation owner for Delivery jobs.
 *
 * The caller owns `tx`. V1 remains compatible by projecting cancelled jobs
 * to FAILED, while the immutable tombstone distinguishes cancellation from
 * an operational driver failure. With the V2 execution writer enabled, the
 * shared command owner also republishes affected routes, revokes driver feed
 * access, advances job state to CANCELLED, and writes the outbox atomically.
 */
export async function cancelOrderDeliveryJobs(tx, {
  orderId,
  reason,
  actorId = null,
  cancelledAt = new Date(),
}) {
  const normalizedReason = String(reason || "Order dibatalkan").trim() || "Order dibatalkan";
  const executionActorId = actorId === "SYSTEM" ? null : actorId;
  const [candidates, activeRescheduleCount] = await Promise.all([
    tx.job.findMany({
      where: { orderId, status: { in: CANCELLABLE_JOB_STATUSES } },
      select: { id: true },
      orderBy: { id: "asc" },
    }),
    tx.rescheduleCase.count({ where: { job: { orderId }, status: "AKTIF" } }),
  ]);
  if (candidates.length === 0 && activeRescheduleCount === 0) {
    return { cancelledJobIds: [], replayed: true };
  }

  return executeDeliveryCrossBoundaryCommand(tx, {
    flagKey: V2_FLAGS.DELIVERY_EXECUTION_WRITER,
    actorId,
    commandType: "ORDER_CANCEL_DELIVERY_JOBS",
    aggregateHint: orderId,
    request: {
      orderId,
      reason: normalizedReason,
      jobIds: candidates.map((job) => job.id),
    },
    reason: `Order cancelled: ${normalizedReason}`,
    mutate: async (commandTx) => {
      await commandTx.$queryRaw`SELECT id FROM jobs WHERE order_id = ${orderId} AND status IN ('UNSCHEDULED', 'SCHEDULED', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED') FOR UPDATE`;
      const jobs = await commandTx.job.findMany({
        where: { orderId, status: { in: CANCELLABLE_JOB_STATUSES } },
        include: {
          cancellationV2: true,
          route: { select: { id: true, status: true, driverId: true, helperId: true } },
          stopAssignmentsV2: {
            where: { status: "ACTIVE" },
            select: { driverId: true, helperId: true },
          },
        },
        orderBy: { id: "asc" },
      });

      const inconsistent = jobs.find((job) => job.cancellationV2);
      if (inconsistent) {
        throw conflict(
          "Job sudah memiliki tombstone pembatalan tetapi projection V1 masih aktif",
          "JOB_CANCELLATION_STATE_CONFLICT",
          { jobId: inconsistent.id },
        );
      }
      const completedRouteJob = jobs.find((job) => job.route?.status === "COMPLETED");
      if (completedRouteJob) {
        throw conflict(
          "Job aktif berada pada rute yang sudah selesai; pembatalan otomatis dihentikan untuk pemeriksaan manual",
          "ORDER_CANCEL_ACTIVE_JOB_ON_COMPLETED_ROUTE",
          { jobId: completedRouteJob.id, routeId: completedRouteJob.routeId },
        );
      }
      const verifiedPodJob = jobs.find((job) => job.podStatus === "VERIFIED");
      if (verifiedPodJob) {
        throw conflict(
          "Job memiliki POD terverifikasi tetapi statusnya masih aktif; pembatalan otomatis dihentikan",
          "ORDER_CANCEL_ACTIVE_JOB_WITH_VERIFIED_POD",
          { jobId: verifiedPodJob.id },
        );
      }

      const cancellations = [];
      for (const job of jobs) {
        const tombstone = await commandTx.deliveryJobCancellation.create({
          data: {
            jobId: job.id,
            orderId,
            previousStatus: job.status,
            previousRouteId: job.routeId,
            previousDriverId: job.driverId,
            previousHelperId: job.helperId,
            previousVehicleId: job.vehicleId,
            reason: normalizedReason,
            actorId,
            cancelledAt,
          },
        });
        await commandTx.job.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            failureReason: `Order dibatalkan: ${normalizedReason}`,
          },
        });
        await commandTx.deliveryExecutionEvent.create({
          data: {
            idempotencyKey: `order-cancel:${orderId}:${job.id}`,
            action: "JOB_CANCELLED_BY_ORDER",
            actorId: executionActorId,
            jobId: job.id,
            routeId: job.routeId,
            payload: {
              orderId,
              reason: normalizedReason,
              previousStatus: job.status,
              cancelledAt: cancelledAt.toISOString(),
              tombstoneId: tombstone.id,
            },
          },
        });
        cancellations.push({
          tombstoneId: tombstone.id,
          jobId: job.id,
          orderId,
          routeId: job.routeId,
          previousStatus: job.status,
          reason: normalizedReason,
          actorId,
          cancelledAt: cancelledAt.toISOString(),
          recipientIds: unique([
            job.driverId,
            job.helperId,
            job.route?.driverId,
            job.route?.helperId,
            ...job.stopAssignmentsV2.flatMap((assignment) => [assignment.driverId, assignment.helperId]),
          ]),
        });
      }

      await commandTx.rescheduleCase.updateMany({
        where: { job: { orderId }, status: "AKTIF" },
        data: { status: "DIBATALKAN", cancelReason: "Order dibatalkan", resolvedAt: cancelledAt },
      });

      return {
        value: { cancelledJobIds: cancellations.map((item) => item.jobId), replayed: false },
        jobIds: cancellations.map((item) => item.jobId),
        routeIds: cancellations.map((item) => item.routeId),
        cancellations,
      };
    },
  });
}

export { CANCELLABLE_JOB_STATUSES };
