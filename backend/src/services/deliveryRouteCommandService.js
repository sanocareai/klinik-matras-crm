import { createHash } from "node:crypto";
import {
  DELIVERY_V2_ROUTE_INCLUDE,
  buildDeliveryRouteSnapshot,
  deliveryJobSource,
  deliveryV2Checksum,
  routeRecipients,
} from "./deliveryV2Snapshot.js";
import { appendRouteFeedChanges } from "./driverFeedV2.js";

function conflict(message, code = "REVISION_CONFLICT") {
  return Object.assign(new Error(message), { statusCode: 409, code });
}

function requestHash(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function commandActor(actorId) {
  return actorId || "SYSTEM";
}

async function existingCommand(tx, actorId, idempotencyKey, hash) {
  const command = await tx.v2Command.findUnique({
    where: { actorId_idempotencyKey: { actorId: commandActor(actorId), idempotencyKey } },
  });
  if (!command) return null;
  if (command.requestHash !== hash) throw conflict("Idempotency-Key sudah dipakai untuk payload berbeda", "IDEMPOTENCY_CONFLICT");
  if (command.status !== "APPLIED" && command.status !== "ALREADY_APPLIED") {
    throw conflict("Command dengan Idempotency-Key ini masih diproses", "COMMAND_IN_PROGRESS");
  }
  return command;
}

async function lockRoute(tx, routeId) {
  await tx.$queryRaw`SELECT id FROM routes WHERE id = ${routeId}::uuid FOR UPDATE`;
}

async function syncAffectedJobStates(tx, jobIds) {
  if (!jobIds.length) return;
  const jobs = await tx.job.findMany({ where: { id: { in: [...new Set(jobIds)] } } });
  for (const job of jobs) {
    const source = deliveryJobSource(job);
    const checksum = deliveryV2Checksum(source);
    const current = await tx.deliveryJobState.findUnique({ where: { jobId: job.id } });
    await tx.deliveryJobState.upsert({
      where: { jobId: job.id },
      create: { jobId: job.id, jobRevision: 1, currentStatus: job.status, sourceChecksum: checksum },
      update: {
        jobRevision: current?.sourceChecksum === checksum ? current.jobRevision : { increment: 1 },
        currentStatus: job.status,
        sourceChecksum: checksum,
      },
    });
  }
}

function publicationStatus(routeStatus) {
  return routeStatus === "CANCELLED" ? "REVOKED" : "ACTIVE";
}

function visibleRecipients(routeStatus, snapshot) {
  return ["PUBLISHED", "IN_PROGRESS", "COMPLETED"].includes(routeStatus) ? routeRecipients(snapshot) : [];
}

function assignmentStatus(routeStatus, stopStatus) {
  if (routeStatus === "CANCELLED") return "REVOKED";
  if (["COMPLETED", "FAILED", "RESCHEDULED"].includes(stopStatus)) return "COMPLETED";
  return "ACTIVE";
}

export async function synchronizeDeliveryRouteLifecycle(tx, { routeId, actorId = null, reason = "Execution lifecycle sync" }) {
  if (!routeId) return null;
  const [route, state] = await Promise.all([
    tx.route.findUnique({ where: { id: routeId }, include: DELIVERY_V2_ROUTE_INCLUDE }),
    tx.deliveryRouteState.findUnique({ where: { routeId } }),
  ]);
  if (!route || !state || state.lifecycleStatus === route.status) return null;
  const previousPublication = state.currentPublicationVersion == null ? null : await tx.routePublication.findUnique({
    where: { routeId_publicationVersion: { routeId, publicationVersion: state.currentPublicationVersion } },
  });
  const nextRevision = state.routeRevision + 1;
  const nextPublicationVersion = (state.currentPublicationVersion || 0) + 1;
  const snapshot = buildDeliveryRouteSnapshot(route, { routeRevision: nextRevision, publicationVersion: nextPublicationVersion });
  const checksum = deliveryV2Checksum(snapshot);
  if (previousPublication?.status === "ACTIVE") {
    await tx.routePublication.update({
      where: { id: previousPublication.id },
      data: { status: route.status === "CANCELLED" ? "REVOKED" : "SUPERSEDED", supersededAt: new Date() },
    });
    await tx.routeStopAssignment.updateMany({
      where: { publicationId: previousPublication.id, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
  }
  const publication = await tx.routePublication.create({
    data: {
      routeId,
      publicationVersion: nextPublicationVersion,
      routeRevision: nextRevision,
      status: publicationStatus(route.status),
      snapshot,
      checksum,
      reason,
      publishedById: actorId,
      assignments: {
        create: snapshot.stops.map((stop) => ({
          jobId: stop.jobId,
          sequence: stop.sequence,
          driverId: snapshot.driverId,
          helperId: snapshot.helperId,
          vehicleId: snapshot.vehicleId,
          status: assignmentStatus(route.status, stop.status),
          revokedAt: route.status === "CANCELLED" ? new Date() : null,
          completedAt: stop.status === "COMPLETED" ? new Date() : null,
          sourceChecksum: deliveryV2Checksum(stop),
        })),
      },
    },
  });
  const oldRecipients = previousPublication ? routeRecipients(previousPublication.snapshot) : [];
  const newRecipients = visibleRecipients(route.status, snapshot);
  await appendRouteFeedChanges(tx, {
    oldRecipients, newRecipients, routeId, routeRevision: nextRevision,
    publicationVersion: nextPublicationVersion, checksum,
  });
  await tx.deliveryRouteState.update({
    where: { routeId },
    data: {
      routeRevision: nextRevision,
      currentPublicationVersion: nextPublicationVersion,
      lifecycleStatus: route.status,
      draftSnapshot: snapshot,
      draftChecksum: checksum,
      sourceChecksum: checksum,
    },
  });
  await tx.domainOutbox.create({
    data: {
      domain: "DELIVERY", eventType: "delivery.route.lifecycle.changed",
      aggregateType: "Route", aggregateId: routeId, aggregateRevision: nextRevision,
      dedupeKey: `delivery-route-lifecycle:${routeId}:${nextRevision}`,
      payload: { routeId, routeRevision: nextRevision, publicationVersion: nextPublicationVersion, status: route.status, checksum },
    },
  });
  return { routeRevision: nextRevision, publicationVersion: nextPublicationVersion, publication };
}

/**
 * Transactional V2-first command boundary for every planning mutation.
 * `projectV1` is an internal compatibility projector owned by the adapter;
 * it must use the supplied tx and return { routeId }. Nothing is committed
 * unless V2 state, publication/feed/outbox, and the V1 projection all pass.
 */
export async function executeDeliveryRouteCommand(prisma, {
  routeId = null,
  actorId,
  idempotencyKey,
  commandType,
  expectedRevision = null,
  reason = null,
  request = null,
  forcePublication = false,
  projectV1,
}) {
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{12,128}$/.test(idempotencyKey)) {
    throw Object.assign(new Error("Idempotency-Key wajib diisi (12-128 karakter)"), { statusCode: 400 });
  }
  if (typeof projectV1 !== "function") throw new TypeError("projectV1 wajib berupa function");
  const hash = requestHash({ commandType, routeId, expectedRevision, reason, request });
  const actor = commandActor(actorId);

  try {
    return await prisma.$transaction(async (tx) => {
      const replay = await existingCommand(tx, actor, idempotencyKey, hash);
      if (replay) return { replayed: true, ...replay.response };

      let beforeRoute = null;
      let state = null;
      let previousPublication = null;
      if (routeId) {
        await lockRoute(tx, routeId);
        [beforeRoute, state] = await Promise.all([
          tx.route.findUnique({ where: { id: routeId }, include: { jobs: { select: { id: true } } } }),
          tx.deliveryRouteState.findUnique({ where: { routeId } }),
        ]);
        if (!beforeRoute) throw Object.assign(new Error("Rute tidak ditemukan"), { statusCode: 404 });
        if (!state) throw conflict("Route belum memiliki baseline V2; jalankan catch-up dahulu", "V2_BASELINE_MISSING");
        if (expectedRevision != null && state.routeRevision !== Number(expectedRevision)) {
          throw conflict(`Route revision berubah: expected ${expectedRevision}, current ${state.routeRevision}`);
        }
        if (state.currentPublicationVersion != null) {
          previousPublication = await tx.routePublication.findUnique({
            where: { routeId_publicationVersion: { routeId, publicationVersion: state.currentPublicationVersion } },
          });
        }
      }

      const command = await tx.v2Command.create({
        data: {
          domain: "DELIVERY",
          actorId: actor,
          idempotencyKey,
          commandType,
          aggregateType: "Route",
          aggregateId: routeId || "PENDING_CREATE",
          expectedRevision: expectedRevision == null ? null : Number(expectedRevision),
          requestHash: hash,
        },
      });

      const projection = await projectV1(tx, { beforeRoute, state });
      const effectiveRouteId = projection?.routeId || routeId;
      if (!effectiveRouteId) throw new Error("Compatibility projector tidak mengembalikan routeId");
      if (!routeId) await lockRoute(tx, effectiveRouteId);

      const route = await tx.route.findUnique({ where: { id: effectiveRouteId }, include: DELIVERY_V2_ROUTE_INCLUDE });
      if (!route) throw Object.assign(new Error("Rute hasil projection tidak ditemukan"), { statusCode: 500 });
      const currentRevision = state?.routeRevision || 0;
      const nextRevision = currentRevision + 1;
      const shouldPublish = forcePublication || route.status !== "DRAFT" || state?.currentPublicationVersion != null;
      const nextPublicationVersion = shouldPublish ? (state?.currentPublicationVersion || 0) + 1 : null;
      const snapshot = buildDeliveryRouteSnapshot(route, {
        routeRevision: nextRevision,
        publicationVersion: nextPublicationVersion,
      });
      const checksum = deliveryV2Checksum(snapshot);

      let publication = null;
      const oldRecipients = previousPublication ? routeRecipients(previousPublication.snapshot) : [];
      const newRecipients = shouldPublish ? visibleRecipients(route.status, snapshot) : [];
      if (shouldPublish) {
        if (previousPublication?.status === "ACTIVE") {
          await tx.routePublication.update({
            where: { id: previousPublication.id },
            data: { status: route.status === "CANCELLED" ? "REVOKED" : "SUPERSEDED", supersededAt: new Date() },
          });
          await tx.routeStopAssignment.updateMany({
            where: { publicationId: previousPublication.id, status: "ACTIVE" },
            data: { status: "REVOKED", revokedAt: new Date() },
          });
        }
        publication = await tx.routePublication.create({
          data: {
            routeId: effectiveRouteId,
            publicationVersion: nextPublicationVersion,
            routeRevision: nextRevision,
            status: publicationStatus(route.status),
            snapshot,
            checksum,
            reason,
            publishedById: actorId || null,
            assignments: {
              create: snapshot.stops.map((stop) => ({
                jobId: stop.jobId,
                sequence: stop.sequence,
                driverId: snapshot.driverId,
                helperId: snapshot.helperId,
                vehicleId: snapshot.vehicleId,
                status: assignmentStatus(route.status, stop.status),
                revokedAt: route.status === "CANCELLED" ? new Date() : null,
                sourceChecksum: deliveryV2Checksum(stop),
              })),
            },
          },
        });
        await appendRouteFeedChanges(tx, {
          oldRecipients,
          newRecipients,
          routeId: effectiveRouteId,
          routeRevision: nextRevision,
          publicationVersion: nextPublicationVersion,
          checksum,
        });
      }

      await tx.deliveryRouteState.upsert({
        where: { routeId: effectiveRouteId },
        create: {
          routeId: effectiveRouteId,
          routeRevision: nextRevision,
          currentPublicationVersion: nextPublicationVersion,
          lifecycleStatus: route.status,
          draftSnapshot: snapshot,
          draftChecksum: checksum,
          sourceChecksum: checksum,
        },
        update: {
          routeRevision: nextRevision,
          currentPublicationVersion: nextPublicationVersion ?? state?.currentPublicationVersion ?? null,
          lifecycleStatus: route.status,
          draftSnapshot: snapshot,
          draftChecksum: checksum,
          sourceChecksum: checksum,
        },
      });

      const affectedJobIds = [...(beforeRoute?.jobs || []).map((job) => job.id), ...route.jobs.map((job) => job.id)];
      await syncAffectedJobStates(tx, affectedJobIds);
      await tx.domainOutbox.create({
        data: {
          domain: "DELIVERY",
          eventType: shouldPublish ? "delivery.route.publication.changed" : "delivery.route.draft.changed",
          aggregateType: "Route",
          aggregateId: effectiveRouteId,
          aggregateRevision: nextRevision,
          dedupeKey: `delivery-route-command:${command.id}`,
          payload: {
            routeId: effectiveRouteId,
            routeRevision: nextRevision,
            publicationVersion: nextPublicationVersion,
            status: route.status,
            checksum,
          },
        },
      });
      const response = {
        routeId: effectiveRouteId,
        routeRevision: nextRevision,
        publicationVersion: nextPublicationVersion,
        checksum,
        ...(projection?.commandResponse || {}),
      };
      await tx.v2Command.update({
        where: { id: command.id },
        data: {
          aggregateId: effectiveRouteId,
          appliedRevision: nextRevision,
          status: "APPLIED",
          response,
          completedAt: new Date(),
        },
      });
      return { replayed: false, ...response, route, publication, projectionResult: projection };
    }, { isolationLevel: "Serializable", timeout: 30_000 });
  } catch (error) {
    if (error?.code === "P2002") {
      const replay = await prisma.v2Command.findUnique({
        where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } },
      });
      if (replay?.requestHash === hash && ["APPLIED", "ALREADY_APPLIED"].includes(replay.status)) {
        return { replayed: true, ...replay.response };
      }
      throw conflict("Idempotency-Key sedang diproses atau dipakai untuk payload berbeda", "IDEMPOTENCY_CONFLICT");
    }
    if (error?.code === "P2034") throw conflict("Route berubah bersamaan; muat ulang dan ulangi command");
    throw error;
  }
}

export async function discardDeliveryRouteDraft(prisma, {
  routeId,
  actorId,
  idempotencyKey,
  expectedRevision = null,
}) {
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{12,128}$/.test(idempotencyKey)) {
    throw Object.assign(new Error("Idempotency-Key wajib diisi (12-128 karakter)"), { statusCode: 400 });
  }
  const actor = commandActor(actorId);
  const hash = requestHash({ commandType: "DISCARD_ROUTE_DRAFT", routeId, expectedRevision });
  try {
    return await prisma.$transaction(async (tx) => {
      const replay = await existingCommand(tx, actor, idempotencyKey, hash);
      if (replay) return { replayed: true, ...replay.response };
      await lockRoute(tx, routeId);
      const [route, state, publicationCount] = await Promise.all([
        tx.route.findUnique({ where: { id: routeId }, include: { jobs: { select: { id: true } } } }),
        tx.deliveryRouteState.findUnique({ where: { routeId } }),
        tx.routePublication.count({ where: { routeId } }),
      ]);
      if (!route) throw Object.assign(new Error("Rute tidak ditemukan"), { statusCode: 404 });
      if (!state) throw conflict("Route belum memiliki baseline V2", "V2_BASELINE_MISSING");
      if (expectedRevision != null && state.routeRevision !== Number(expectedRevision)) {
        throw conflict(`Route revision berubah: expected ${expectedRevision}, current ${state.routeRevision}`);
      }
      if (route.status !== "DRAFT" || publicationCount > 0) {
        throw conflict("Rute yang pernah dipublish tidak boleh dihapus", "PUBLISHED_HISTORY_IMMUTABLE");
      }
      if (state.migrationSource) {
        throw conflict("Draft hasil migrasi V1 dipertahankan sebagai data historis", "HISTORICAL_DATA_PROTECTED");
      }
      if (route.jobs.length > 0) {
        throw conflict("Lepaskan seluruh stop sebelum membuang draft rute", "DRAFT_HAS_STOPS");
      }
      const command = await tx.v2Command.create({
        data: {
          domain: "DELIVERY", actorId: actor, idempotencyKey,
          commandType: "DISCARD_ROUTE_DRAFT", aggregateType: "Route", aggregateId: routeId,
          expectedRevision: expectedRevision == null ? null : Number(expectedRevision), requestHash: hash,
        },
      });
      await tx.deliveryRouteState.delete({ where: { routeId } });
      await tx.route.delete({ where: { id: routeId } });
      const response = { routeId, discarded: true, routeRevision: state.routeRevision };
      await tx.v2Command.update({
        where: { id: command.id },
        data: { appliedRevision: state.routeRevision, status: "APPLIED", response, completedAt: new Date() },
      });
      await tx.domainOutbox.create({
        data: {
          domain: "DELIVERY", eventType: "delivery.route.draft.discarded",
          aggregateType: "Route", aggregateId: routeId, aggregateRevision: state.routeRevision,
          dedupeKey: `delivery-route-discard:${command.id}`, payload: response,
        },
      });
      return { replayed: false, ...response };
    }, { isolationLevel: "Serializable", timeout: 30_000 });
  } catch (error) {
    if (error?.code === "P2034") throw conflict("Route berubah bersamaan; muat ulang dan ulangi command");
    if (error?.code === "P2002") {
      const replay = await prisma.v2Command.findUnique({ where: { actorId_idempotencyKey: { actorId: actor, idempotencyKey } } });
      if (replay?.requestHash === hash && replay.status === "APPLIED") return { replayed: true, ...replay.response };
      throw conflict("Idempotency-Key sedang diproses atau dipakai untuk payload berbeda", "IDEMPOTENCY_CONFLICT");
    }
    throw error;
  }
}
