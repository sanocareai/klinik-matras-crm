import { createHash } from "node:crypto";
import { appendDriverFeedEvent } from "./driverFeedV2.js";
import { deliveryJobSource, deliveryV2Checksum, isDriverActiveRouteStatusV2 } from "./deliveryV2Snapshot.js";
import { synchronizeDeliveryRouteLifecycle } from "./deliveryRouteCommandService.js";

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function conflict(message, code = "JOB_REVISION_CONFLICT") {
  return Object.assign(new Error(message), { statusCode: 409, code });
}

export async function executeDeliveryExecutionCommand(prisma, {
  jobId,
  actorId,
  idempotencyKey,
  commandType,
  expectedJobRevision = null,
  request = null,
  projectV1,
}) {
  if (!jobId) throw Object.assign(new Error("jobId wajib diisi"), { statusCode: 400 });
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{12,128}$/.test(idempotencyKey)) {
    throw Object.assign(new Error("Idempotency-Key wajib diisi (12-128 karakter)"), { statusCode: 400 });
  }
  if (typeof projectV1 !== "function") throw new TypeError("projectV1 wajib berupa function");
  const actor = actorId || "SYSTEM";
  const requestHash = hash({ jobId, commandType, expectedJobRevision, request });

  try {
    return await prisma.$transaction(async (tx) => {
      const replay = await tx.v2Command.findUnique({
        where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } },
      });
      if (replay) {
        if (replay.requestHash !== requestHash) throw conflict("Idempotency-Key dipakai untuk payload berbeda", "IDEMPOTENCY_CONFLICT");
        if (replay.status !== "APPLIED") throw conflict("Command masih diproses", "COMMAND_IN_PROGRESS");
        return { replayed: true, ...replay.response };
      }

      await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
      const before = await tx.job.findUnique({ where: { id: jobId } });
      if (!before) throw Object.assign(new Error("Job tidak ditemukan"), { statusCode: 404 });
      const state = await tx.deliveryJobState.findUnique({ where: { jobId } });
      if (!state) throw conflict("Job belum memiliki baseline V2; jalankan catch-up dahulu", "V2_BASELINE_MISSING");
      if (expectedJobRevision != null && state.jobRevision !== Number(expectedJobRevision)) {
        throw conflict(`Job revision berubah: expected ${expectedJobRevision}, current ${state.jobRevision}`);
      }
      const command = await tx.v2Command.create({
        data: {
          domain: "DELIVERY",
          actorId: actor,
          idempotencyKey,
          commandType,
          aggregateType: "Job",
          aggregateId: jobId,
          expectedRevision: expectedJobRevision == null ? null : Number(expectedJobRevision),
          requestHash,
        },
      });
      const projectionResult = await projectV1(tx, { before, state });
      const job = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
      const source = deliveryJobSource(job);
      const sourceChecksum = deliveryV2Checksum(source);
      const nextRevision = state.sourceChecksum === sourceChecksum ? state.jobRevision : state.jobRevision + 1;
      await tx.deliveryJobState.update({
        where: { jobId },
        data: { jobRevision: nextRevision, currentStatus: job.status, sourceChecksum },
      });

      let publicationVersion = null;
      let routeRevision = null;
      let routeVisibleToDriverV2 = false;
      if (job.routeId) {
        await synchronizeDeliveryRouteLifecycle(tx, {
          routeId: job.routeId,
          actorId,
          reason: `Execution command ${commandType}`,
        });
        const routeState = await tx.deliveryRouteState.findUnique({ where: { routeId: job.routeId } });
        publicationVersion = routeState?.currentPublicationVersion ?? null;
        routeRevision = routeState?.routeRevision ?? null;
        routeVisibleToDriverV2 = isDriverActiveRouteStatusV2(routeState?.lifecycleStatus);
      }
      const feedRecipients = routeVisibleToDriverV2
        ? [...new Set([job.driverId, job.helperId].filter(Boolean))].sort()
        : [];
      for (const userId of feedRecipients) {
        await appendDriverFeedEvent(tx, {
          userId,
          kind: "UPSERT_JOB",
          aggregateType: "Job",
          aggregateId: jobId,
          aggregateRevision: nextRevision,
          publicationVersion,
          payload: {
            jobId,
            routeId: job.routeId,
            routeRevision,
            jobRevision: nextRevision,
            status: job.status,
            sourceChecksum,
          },
        });
      }
      await tx.domainOutbox.create({
        data: {
          domain: "DELIVERY",
          eventType: "delivery.job.execution.changed",
          aggregateType: "Job",
          aggregateId: jobId,
          aggregateRevision: nextRevision,
          dedupeKey: `delivery-execution-command:${command.id}`,
          payload: {
            jobId,
            routeId: job.routeId,
            jobRevision: nextRevision,
            status: job.status,
            publicationVersion,
          },
        },
      });
      const response = { jobId, jobRevision: nextRevision, status: job.status, publicationVersion };
      await tx.v2Command.update({
        where: { id: command.id },
        data: { appliedRevision: nextRevision, status: "APPLIED", response, completedAt: new Date() },
      });
      return { replayed: false, ...response, job, projectionResult };
    }, { isolationLevel: "Serializable", timeout: 30_000 });
  } catch (error) {
    if (error?.code === "P2034") throw conflict("Job berubah bersamaan; muat ulang dan replay command");
    if (error?.code === "P2002") {
      const replay = await prisma.v2Command.findUnique({
        where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } },
      });
      if (replay?.requestHash === requestHash && replay.status === "APPLIED") {
        return { replayed: true, ...replay.response };
      }
      throw conflict("Idempotency-Key sedang diproses atau sudah dipakai", "IDEMPOTENCY_CONFLICT");
    }
    throw error;
  }
}
