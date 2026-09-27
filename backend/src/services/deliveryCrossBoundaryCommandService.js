import { createHash, randomUUID } from "node:crypto";
import {
  projectDeliveryRouteAfterExternalMutation,
  syncAffectedJobStates,
} from "./deliveryRouteCommandService.js";
import { appendDriverFeedEvent } from "./driverFeedV2.js";
import {
  DELIVERY_WRITER_MODE, V2_FLAGS, isDeliveryWriterEnabledFor, loadV2Flags, resolveDeliveryWriterState, resolveJobRouteIds,
} from "./v2FeatureFlags.js";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function guarded(message, code) {
  return Object.assign(new Error(message), { statusCode: 503, code });
}

// Keputusan writer bersama (lihat resolveDeliveryWriterState). flagKey dipertahankan untuk kompatibilitas
// pemanggil; writer route dan execution adalah satu unit.
// eslint-disable-next-line no-unused-vars
async function writerState(tx, flagKey) {
  const flags = await loadV2Flags(tx);
  return { state: resolveDeliveryWriterState(flags), fence: flags[V2_FLAGS.DELIVERY_V1_WRITER_FENCE]?.enabled === true };
}

function assertNotFenced(fence, enabled) {
  if (fence && !enabled) {
    throw guarded("Mutation Delivery V1 sedang dipagari untuk final catch-up", "DELIVERY_V1_WRITER_FENCED");
  }
}

// Mode COHORT: batasi hasil mutation ke route cohort. Mengembalikan null bila tidak ada route cohort yang
// tersentuh (command tetap V1-only). Job tanpa route dan job di route non-cohort tidak diproyeksikan.
async function scopeMutationToCohort(tx, state, mutation) {
  const jobIds = unique(mutation.jobIds);
  const jobs = jobIds.length ? await tx.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, routeId: true } }) : [];
  const touchedRouteIds = unique([...(mutation.routeIds || []), ...jobs.map((job) => job.routeId)]);
  const cohortRouteIds = touchedRouteIds.filter((routeId) => state.routeIds.has(routeId));
  if (!cohortRouteIds.length) return null;
  const inCohort = new Set(cohortRouteIds);
  return {
    ...mutation,
    jobIds: jobs.filter((job) => inCohort.has(job.routeId)).map((job) => job.id),
    routeIds: cohortRouteIds,
    cancellations: (mutation.cancellations || []).filter((item) => item.routeId && inCohort.has(item.routeId)),
    deletedJobIds: mutation.deletedJobIds, // tetap diperiksa: penghapusan saat route cohort tersentuh ditolak
  };
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
  const { state, fence } = await writerState(tx, flagKey);
  if (state.mode === DELIVERY_WRITER_MODE.OFF) {
    assertNotFenced(fence, false);
    const legacy = await mutate(tx);
    return legacy?.value;
  }
  if (state.mode === DELIVERY_WRITER_MODE.COHORT) {
    // Route yang disentuh baru diketahui setelah mutation; mutation dan projection tetap satu transaksi.
    const mutation = (await mutate(tx)) || {};
    const scoped = await scopeMutationToCohort(tx, state, mutation);
    assertNotFenced(fence, Boolean(scoped));
    if (!scoped) return mutation.value;
    const command = await createCrossBoundaryCommand(tx, { actorId, commandType, aggregateHint, request });
    return projectCrossBoundaryMutation(tx, { command, mutation: scoped, actorId, commandType, reason });
  }

  const command = await createCrossBoundaryCommand(tx, { actorId, commandType, aggregateHint, request });
  const mutation = (await mutate(tx)) || {};
  return projectCrossBoundaryMutation(tx, { command, mutation, actorId, commandType, reason });
}

async function createCrossBoundaryCommand(tx, { actorId, commandType, aggregateHint, request }) {
  const idempotencyKey = `internal:${commandType}:${randomUUID()}`;
  const requestHash = digest({ commandType, aggregateHint, request });
  return tx.v2Command.create({
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
}

async function projectCrossBoundaryMutation(tx, { command, mutation, actorId, commandType, reason }) {
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
  const { state, fence } = await writerState(tx, V2_FLAGS.DELIVERY_ROUTE_WRITER);
  const enabled = state.mode === DELIVERY_WRITER_MODE.COHORT
    ? isDeliveryWriterEnabledFor(state, (await resolveJobRouteIds(tx, jobIds)).filter((routeId) => state.routeIds.has(routeId)))
    : state.mode === DELIVERY_WRITER_MODE.GLOBAL;
  assertNotFenced(fence, enabled);
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
