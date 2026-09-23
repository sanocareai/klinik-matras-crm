import { createHash } from "node:crypto";
import { deliveryJobSource, deliveryV2Checksum } from "./deliveryV2Snapshot.js";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function commandError(message, code = "JOB_REVISION_CONFLICT") {
  return Object.assign(new Error(message), { statusCode: 409, code });
}

export async function executeDeliveryJobCommand(prisma, {
  jobId = null,
  actorId,
  idempotencyKey,
  commandType,
  expectedJobRevision = null,
  request = null,
  projectV1,
}) {
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{12,128}$/.test(idempotencyKey)) {
    throw Object.assign(new Error("Idempotency-Key wajib diisi (12-128 karakter)"), { statusCode: 400 });
  }
  const actor = actorId || "SYSTEM";
  const requestHash = digest({ jobId, commandType, expectedJobRevision, request });
  try {
    return await prisma.$transaction(async (tx) => {
    const replay = await tx.v2Command.findUnique({
      where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } },
    });
    if (replay) {
      if (replay.requestHash !== requestHash) throw commandError("Idempotency-Key dipakai untuk payload berbeda", "IDEMPOTENCY_CONFLICT");
      if (replay.status !== "APPLIED") throw commandError("Command masih diproses", "COMMAND_IN_PROGRESS");
      return { replayed: true, ...replay.response };
    }
    let before = null;
    let state = null;
    if (jobId) {
      await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
      before = await tx.job.findUnique({ where: { id: jobId } });
      if (!before) throw Object.assign(new Error("Job tidak ditemukan"), { statusCode: 404 });
      if (before.routeId) throw commandError("Job anggota rute wajib dimutasi melalui DeliveryRouteCommandService", "ROUTE_COMMAND_REQUIRED");
      state = await tx.deliveryJobState.findUnique({ where: { jobId } });
      if (!state) throw commandError("Job belum memiliki baseline V2", "V2_BASELINE_MISSING");
      if (expectedJobRevision != null && state.jobRevision !== Number(expectedJobRevision)) {
        throw commandError(`Job revision berubah: expected ${expectedJobRevision}, current ${state.jobRevision}`);
      }
    }
    const command = await tx.v2Command.create({
      data: {
        domain: "DELIVERY",
        actorId: actor,
        idempotencyKey,
        commandType,
        aggregateType: "Job",
        aggregateId: jobId || "PENDING_CREATE",
        expectedRevision: expectedJobRevision == null ? null : Number(expectedJobRevision),
        requestHash,
      },
    });
    const projected = await projectV1(tx, { before, state });
    const effectiveJobId = projected?.jobId || jobId;
    if (!effectiveJobId) throw new Error("Compatibility projector tidak mengembalikan jobId");
    const job = await tx.job.findUniqueOrThrow({ where: { id: effectiveJobId } });
    if (job.routeId) throw commandError("Projection menempelkan job ke route tanpa route publication", "ROUTE_COMMAND_REQUIRED");
    const source = deliveryJobSource(job);
    const sourceChecksum = deliveryV2Checksum(source);
    const nextRevision = state ? (state.sourceChecksum === sourceChecksum ? state.jobRevision : state.jobRevision + 1) : 1;
    await tx.deliveryJobState.upsert({
      where: { jobId: effectiveJobId },
      create: { jobId: effectiveJobId, jobRevision: nextRevision, currentStatus: job.status, sourceChecksum },
      update: { jobRevision: nextRevision, currentStatus: job.status, sourceChecksum },
    });
    await tx.domainOutbox.create({
      data: {
        domain: "DELIVERY",
        eventType: "delivery.job.plan.changed",
        aggregateType: "Job",
        aggregateId: effectiveJobId,
        aggregateRevision: nextRevision,
        dedupeKey: `delivery-job-command:${command.id}`,
        payload: { jobId: effectiveJobId, jobRevision: nextRevision, status: job.status },
      },
    });
    const response = {
      jobId: effectiveJobId,
      jobRevision: nextRevision,
      status: job.status,
      ...(projected?.commandResponse || {}),
    };
    await tx.v2Command.update({
      where: { id: command.id },
      data: {
        aggregateId: effectiveJobId,
        appliedRevision: nextRevision,
        status: "APPLIED",
        response,
        completedAt: new Date(),
      },
    });
    return { replayed: false, ...response, job };
    }, { isolationLevel: "Serializable", timeout: 30_000 });
  } catch (error) {
    if (error?.code === "P2002") {
      const replay = await prisma.v2Command.findUnique({
        where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } },
      });
      if (replay?.requestHash === requestHash && replay.status === "APPLIED") {
        return { replayed: true, ...replay.response };
      }
      throw commandError("Idempotency-Key sedang diproses atau dipakai untuk payload berbeda", "IDEMPOTENCY_CONFLICT");
    }
    if (error?.code === "P2034") throw commandError("Job berubah bersamaan; muat ulang dan replay command");
    throw error;
  }
}

export async function discardDeliveryJobDraft(prisma, {
  jobId,
  actorId,
  idempotencyKey,
  expectedJobRevision = null,
}) {
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{12,128}$/.test(idempotencyKey)) {
    throw Object.assign(new Error("Idempotency-Key wajib diisi (12-128 karakter)"), { statusCode: 400 });
  }
  const actor = actorId || "SYSTEM";
  const requestHash = digest({ jobId, commandType: "DISCARD_JOB_DRAFT", expectedJobRevision });
  try {
    return await prisma.$transaction(async (tx) => {
      const replay = await tx.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
      if (replay) {
        if (replay.requestHash !== requestHash) throw commandError("Idempotency-Key dipakai untuk payload berbeda", "IDEMPOTENCY_CONFLICT");
        if (replay.status !== "APPLIED") throw commandError("Command masih diproses", "COMMAND_IN_PROGRESS");
        return { replayed: true, ...replay.response };
      }
      await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
      const [job, state, executionCount, assignmentCount] = await Promise.all([
        tx.job.findUnique({ where: { id: jobId } }),
        tx.deliveryJobState.findUnique({ where: { jobId } }),
        tx.deliveryExecutionEvent.count({ where: { jobId } }),
        tx.routeStopAssignment.count({ where: { jobId } }),
      ]);
      if (!job) throw Object.assign(new Error("Job tidak ditemukan"), { statusCode: 404 });
      if (!state) throw commandError("Job belum memiliki baseline V2", "V2_BASELINE_MISSING");
      if (expectedJobRevision != null && state.jobRevision !== Number(expectedJobRevision)) {
        throw commandError(`Job revision berubah: expected ${expectedJobRevision}, current ${state.jobRevision}`);
      }
      if (job.routeId || !["UNSCHEDULED", "SCHEDULED", "ASSIGNED"].includes(job.status)) {
        throw commandError("Hanya job draft yang belum masuk rute yang dapat dibuang", "JOB_NOT_DISCARDABLE");
      }
      if (state.migrationSource || executionCount > 0 || assignmentCount > 0) {
        throw commandError("Job historis atau yang pernah dieksekusi tidak boleh dihapus", "HISTORICAL_DATA_PROTECTED");
      }
      const command = await tx.v2Command.create({
        data: {
          domain: "DELIVERY", actorId: actor, idempotencyKey,
          commandType: "DISCARD_JOB_DRAFT", aggregateType: "Job", aggregateId: jobId,
          expectedRevision: expectedJobRevision == null ? null : Number(expectedJobRevision), requestHash,
        },
      });
      await tx.deliveryJobState.delete({ where: { jobId } });
      await tx.job.delete({ where: { id: jobId } });
      const response = { jobId, discarded: true, jobRevision: state.jobRevision };
      await tx.v2Command.update({
        where: { id: command.id },
        data: { appliedRevision: state.jobRevision, status: "APPLIED", response, completedAt: new Date() },
      });
      await tx.domainOutbox.create({
        data: {
          domain: "DELIVERY", eventType: "delivery.job.draft.discarded",
          aggregateType: "Job", aggregateId: jobId, aggregateRevision: state.jobRevision,
          dedupeKey: `delivery-job-discard:${command.id}`, payload: response,
        },
      });
      return { replayed: false, ...response };
    }, { isolationLevel: "Serializable", timeout: 30_000 });
  } catch (error) {
    if (error?.code === "P2034") throw commandError("Job berubah bersamaan; muat ulang dan replay command");
    if (error?.code === "P2002") {
      const replay = await prisma.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
      if (replay?.requestHash === requestHash && replay.status === "APPLIED") return { replayed: true, ...replay.response };
      throw commandError("Idempotency-Key sedang diproses atau dipakai untuk payload berbeda", "IDEMPOTENCY_CONFLICT");
    }
    throw error;
  }
}
