import { createHash, randomUUID } from "node:crypto";
import {
  projectDeliveryRouteAfterExternalMutation,
  syncAffectedJobStates,
} from "./deliveryRouteCommandService.js";
import { appendDriverFeedEvent } from "./driverFeedV2.js";
import { V2_FLAGS, isFlagEnabled, loadV2Flags } from "./v2FeatureFlags.js";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function guarded(message, code) {
  return Object.assign(new Error(message), { statusCode: 503, code });
}

async function writerMode(tx, flagKey) {
  const flags = await loadV2Flags(tx);
  const fence = flags[V2_FLAGS.DELIVERY_V1_WRITER_FENCE]?.enabled === true;
  const enabled = isFlagEnabled(flags, flagKey);
  if (fence && !enabled) {
    throw guarded("Mutation Delivery V1 sedang dipagari untuk final catch-up", "DELIVERY_V1_WRITER_FENCED");
  }
  return { enabled, flags };
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

/**
 * Single command owner for Delivery mutations initiated by Sales,
 * Production, complaint, or lifecycle compatibility code. `mutate` writes
 * the V1 compatibility projection and reports every affected aggregate.
 * V1 + V2 commit (or roll back) together in the caller-owned transaction.
 */
export async function executeDeliveryCrossBoundaryCommand(tx, {
  flagKey = V2_FLAGS.DELIVERY_ROUTE_WRITER,
  actorId = null,
  commandType,
  aggregateHint = "PENDING",
  request = null,
  reason = null,
  mutate,
}) {
  if (typeof mutate !== "function") throw new TypeError("mutate wajib berupa function");
  const { enabled } = await writerMode(tx, flagKey);
  if (!enabled) {
    const legacy = await mutate(tx);
    return legacy?.value;
  }

  const idempotencyKey = `internal:${commandType}:${randomUUID()}`;
  const requestHash = digest({ commandType, aggregateHint, request });
  const command = await tx.v2Command.create({
    data: {
      domain: "DELIVERY",
      actorId: actorId || "SYSTEM",
      idempotencyKey,
      commandType,
      aggregateType: "CrossBoundary",
      aggregateId: String(aggregateHint || "PENDING"),
      requestHash,
    },
  });

  const mutation = (await mutate(tx)) || {};
  const deletedJobIds = unique(mutation.deletedJobIds);
  if (deletedJobIds.length > 0) {
    throw Object.assign(new Error(
      "Job historis tidak boleh dihapus saat writer Delivery V2 aktif; diperlukan keputusan bisnis untuk tombstone/cancel semantics"
    ), { statusCode: 409, code: "HISTORICAL_DATA_PROTECTED", details: { jobIds: deletedJobIds } });
  }

  const jobIds = unique(mutation.jobIds);
  await syncAffectedJobStates(tx, jobIds);
  const jobs = jobIds.length
    ? await tx.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, routeId: true, status: true } })
    : [];
  if (jobs.length !== jobIds.length) {
    throw Object.assign(new Error("Mutation lintas-boundary menghilangkan Job tanpa tombstone V2"), {
      statusCode: 409,
      code: "DELIVERY_JOB_DISAPPEARED",
    });
  }
  const routeIds = unique([...(mutation.routeIds || []), ...jobs.map((job) => job.routeId)]);
  const routeResults = [];
  for (const routeId of routeIds) {
    routeResults.push(await projectDeliveryRouteAfterExternalMutation(tx, {
      routeId,
      actorId,
      reason: reason || `Cross-boundary command ${commandType}`,
      dedupeKey: `delivery-cross-boundary-route:${command.id}:${routeId}`,
    }));
  }

  const routeJobIds = new Set(jobs.filter((job) => job.routeId).map((job) => job.id));
  const states = jobIds.length
    ? await tx.deliveryJobState.findMany({ where: { jobId: { in: jobIds } } })
    : [];
  const stateByJobId = new Map(states.map((state) => [state.jobId, state]));
  const routeResultById = new Map(routeIds.map((routeId, index) => [routeId, routeResults[index]]));

  for (const cancellation of mutation.cancellations || []) {
    const state = stateByJobId.get(cancellation.jobId);
    const routeResult = cancellation.routeId ? routeResultById.get(cancellation.routeId) : null;
    for (const userId of unique(cancellation.recipientIds)) {
      await appendDriverFeedEvent(tx, {
        userId,
        kind: "REMOVE_JOB",
        aggregateType: "Job",
        aggregateId: cancellation.jobId,
        aggregateRevision: state?.jobRevision ?? null,
        publicationVersion: routeResult?.publicationVersion ?? null,
        payload: {
          jobId: cancellation.jobId,
          routeId: cancellation.routeId || null,
          revoked: true,
          reason: cancellation.reason,
          cancelledAt: cancellation.cancelledAt,
        },
      });
    }
    await tx.domainOutbox.create({
      data: {
        domain: "DELIVERY",
        eventType: "delivery.job.cancelled",
        aggregateType: "Job",
        aggregateId: cancellation.jobId,
        aggregateRevision: state?.jobRevision ?? null,
        dedupeKey: `delivery-job-cancelled:${cancellation.tombstoneId}`,
        payload: {
          jobId: cancellation.jobId,
          orderId: cancellation.orderId,
          routeId: cancellation.routeId || null,
          previousStatus: cancellation.previousStatus,
          reason: cancellation.reason,
          actorId: cancellation.actorId || null,
          cancelledAt: cancellation.cancelledAt,
        },
      },
    });
  }

  for (const state of states) {
    if (routeJobIds.has(state.jobId)) continue;
    await tx.domainOutbox.create({
      data: {
        domain: "DELIVERY",
        eventType: "delivery.job.plan.changed",
        aggregateType: "Job",
        aggregateId: state.jobId,
        aggregateRevision: state.jobRevision,
        dedupeKey: `delivery-cross-boundary-job:${command.id}:${state.jobId}`,
        payload: { jobId: state.jobId, jobRevision: state.jobRevision, status: state.currentStatus },
      },
    });
  }

  const appliedRevision = Math.max(
    0,
    ...states.map((state) => state.jobRevision),
    ...routeResults.filter(Boolean).map((item) => item.routeRevision),
  );
  const response = {
    jobIds,
    routeIds,
    cancelledJobIds: (mutation.cancellations || []).map((item) => item.jobId),
    appliedRevision,
  };
  await tx.v2Command.update({
    where: { id: command.id },
    data: { status: "APPLIED", appliedRevision, response, completedAt: new Date() },
  });
  return mutation.value;
}

export async function assertLegacyDeliveryJobDeleteAllowed(tx, { operation, jobIds = [] } = {}) {
  const { enabled } = await writerMode(tx, V2_FLAGS.DELIVERY_ROUTE_WRITER);
  if (!enabled) return true;
  throw Object.assign(new Error(
    `Operasi ${operation || "legacy job delete"} dihentikan: writer V2 mempertahankan histori dan belum memiliki keputusan tombstone yang disetujui`
  ), { statusCode: 409, code: "HISTORICAL_DATA_PROTECTED", details: { jobIds: unique(jobIds) } });
}

export async function assertLegacyDeliveryRepairAllowed(client, scriptName) {
  const flags = await loadV2Flags(client);
  const blockingKeys = [
    V2_FLAGS.DELIVERY_ROUTE_WRITER,
    V2_FLAGS.DELIVERY_EXECUTION_WRITER,
    V2_FLAGS.DRIVER_SNAPSHOT_READER,
    V2_FLAGS.DELIVERY_WEB_READER,
    V2_FLAGS.DELIVERY_V1_WRITER_FENCE,
  ].filter((key) => flags[key]?.enabled === true);
  if (blockingKeys.length === 0) return true;
  throw guarded(
    `${scriptName || "Repair script"} ditolak karena mode Delivery V2/fence aktif (${blockingKeys.join(", ")}); gunakan repair command V2 terotorisasi`,
    "LEGACY_DELIVERY_REPAIR_FENCED",
  );
}
