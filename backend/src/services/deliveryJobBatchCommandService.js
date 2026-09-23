import { createHash } from "node:crypto";
import { deliveryJobSource, deliveryV2Checksum } from "./deliveryV2Snapshot.js";

function conflict(message, code = "JOB_REVISION_CONFLICT") {
  return Object.assign(new Error(message), { statusCode: 409, code });
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

export async function executeDeliveryJobBatchCommand(prisma, {
  jobIds,
  actorId,
  idempotencyKey,
  commandType,
  request = null,
  projectV1,
}) {
  const ids = [...new Set(jobIds || [])].sort();
  if (ids.length === 0) throw Object.assign(new Error("jobIds wajib diisi"), { statusCode: 400 });
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{12,128}$/.test(idempotencyKey)) {
    throw Object.assign(new Error("Idempotency-Key wajib diisi (12-128 karakter)"), { statusCode: 400 });
  }
  const actor = actorId || "SYSTEM";
  const requestHash = digest({ ids, commandType, request });
  const aggregateId = `batch:${digest(ids).slice(0, 32)}`;
  try {
    return await prisma.$transaction(async (tx) => {
      const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
      if (replay) {
        if (replay.requestHash !== requestHash) throw conflict("Idempotency-Key dipakai untuk payload berbeda", "IDEMPOTENCY_CONFLICT");
        if (replay.status !== "APPLIED") throw conflict("Command masih diproses", "COMMAND_IN_PROGRESS");
        return { replayed: true, ...replay.response };
      }
      await tx.$queryRawUnsafe(`SELECT id FROM jobs WHERE id IN (${ids.map((_, index) => `$${index + 1}::uuid`).join(",")}) ORDER BY id FOR UPDATE`, ...ids);
      const jobs = await tx.job.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
      if (jobs.length !== ids.length) throw Object.assign(new Error("Sebagian job tidak ditemukan"), { statusCode: 404 });
      if (jobs.some((job) => job.routeId)) throw conflict("Job anggota rute wajib diubah melalui route command", "ROUTE_COMMAND_REQUIRED");
      const states = await tx.deliveryJobState.findMany({ where: { jobId: { in: ids } } });
      if (states.length !== ids.length) throw conflict("Sebagian job belum memiliki baseline V2", "V2_BASELINE_MISSING");
      const command = await tx.v2Command.create({
        data: { domain: "DELIVERY", actorId: actor, idempotencyKey, commandType, aggregateType: "JobBatch", aggregateId, requestHash },
      });
      await projectV1(tx, { jobs, states });
      const updated = await tx.job.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
      const stateByJob = new Map(states.map((state) => [state.jobId, state]));
      const revisions = {};
      for (const job of updated) {
        const sourceChecksum = deliveryV2Checksum(deliveryJobSource(job));
        const state = stateByJob.get(job.id);
        const jobRevision = state.sourceChecksum === sourceChecksum ? state.jobRevision : state.jobRevision + 1;
        revisions[job.id] = jobRevision;
        await tx.deliveryJobState.update({
          where: { jobId: job.id },
          data: { jobRevision, currentStatus: job.status, sourceChecksum },
        });
        await tx.domainOutbox.create({
          data: {
            domain: "DELIVERY", eventType: "delivery.job.plan.changed", aggregateType: "Job",
            aggregateId: job.id, aggregateRevision: jobRevision,
            dedupeKey: `delivery-job-batch:${command.id}:${job.id}`,
            payload: { jobId: job.id, jobRevision, status: job.status, batchCommandId: command.id },
          },
        });
      }
      const response = { jobIds: ids, revisions };
      await tx.v2Command.update({
        where: { id: command.id },
        data: { appliedRevision: Math.max(...Object.values(revisions)), status: "APPLIED", response, completedAt: new Date() },
      });
      return { replayed: false, ...response };
    }, { isolationLevel: "Serializable", timeout: 30_000 });
  } catch (error) {
    if (error?.code === "P2034") throw conflict("Urutan job berubah bersamaan; muat ulang dan replay command");
    if (error?.code === "P2002") {
      const replay = await prisma.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
      if (replay?.requestHash === requestHash && replay.status === "APPLIED") return { replayed: true, ...replay.response };
      throw conflict("Idempotency-Key sedang diproses atau dipakai untuk payload berbeda", "IDEMPOTENCY_CONFLICT");
    }
    throw error;
  }
}
