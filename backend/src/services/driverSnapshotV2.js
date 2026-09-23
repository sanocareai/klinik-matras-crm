import { decodeDriverCursor, encodeDriverCursor } from "./driverFeedV2.js";

const ACTIVE_JOB_STATUSES = ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"];

function boundedLimit(value, fallback = 50, max = 100) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function driverV2Eligibility(prisma, userId) {
  const jobs = await prisma.job.findMany({
    where: {
      status: { in: ACTIVE_JOB_STATUSES },
      OR: [{ driverId: userId }, { helperId: userId }],
    },
    select: {
      id: true,
      routeId: true,
      route: {
        select: {
          id: true,
          status: true,
          deliveryStateV2: { select: { currentPublicationVersion: true } },
        },
      },
    },
  });
  const aggregateIds = [...new Set(jobs.flatMap((job) => [job.id, job.routeId]).filter(Boolean))];
  const exceptions = aggregateIds.length ? await prisma.v2MigrationException.findMany({
    where: {
      aggregateId: { in: aggregateIds },
      status: { in: ["OPEN", "KEEP_V1"] },
    },
    select: { aggregateType: true, aggregateId: true, code: true, status: true },
  }) : [];
  const blockers = [];
  const effectiveJobs = jobs.filter((job) => !job.routeId || !["DRAFT", "CANCELLED"].includes(job.route?.status));
  for (const job of effectiveJobs) {
    if (!job.routeId) blockers.push({ jobId: job.id, code: "ACTIVE_JOB_WITHOUT_ROUTE" });
    else if (!job.route?.deliveryStateV2?.currentPublicationVersion) blockers.push({ jobId: job.id, routeId: job.routeId, code: "ACTIVE_ASSIGNMENT_NOT_PUBLISHED_V2" });
    else if (!["PUBLISHED", "IN_PROGRESS"].includes(job.route.status)) blockers.push({ jobId: job.id, routeId: job.routeId, code: "ACTIVE_JOB_ROUTE_NOT_VISIBLE" });
  }
  blockers.push(...exceptions.map((item) => ({ ...item, code: `MIGRATION_${item.status}:${item.code}` })));
  return { eligible: blockers.length === 0, activeAssignmentCount: effectiveJobs.length, blockers };
}

async function feedState(prisma, userId) {
  return prisma.driverFeedState.upsert({
    where: { userId },
    create: { userId, nextSequence: 1n, retentionFloor: 1n, feedVersion: 1 },
    update: {},
  });
}

export async function readDriverFullSnapshot(prisma, { userId, cursor = null, limit, secret }) {
  const eligibility = await driverV2Eligibility(prisma, userId);
  if (!eligibility.eligible) {
    throw Object.assign(new Error("Driver belum eligible untuk snapshot V2 lengkap"), {
      statusCode: 409,
      code: "DRIVER_V2_COHORT_INELIGIBLE",
      details: eligibility,
    });
  }
  const size = boundedLimit(limit);
  const state = await feedState(prisma, userId);
  const parsed = cursor ? decodeDriverCursor(cursor, { userId, mode: "SNAPSHOT", secret }) : null;
  if (parsed && parsed.feedVersion !== state.feedVersion) {
    throw Object.assign(new Error("Feed version berubah; full refresh wajib diulang"), { statusCode: 409, code: "FULL_REFRESH_REQUIRED" });
  }
  const boundarySequence = parsed?.boundarySequence ?? (state.nextSequence - 1n).toString();
  const afterRouteId = parsed?.afterRouteId || null;
  const publications = await prisma.routePublication.findMany({
    where: {
      status: "ACTIVE",
      ...(afterRouteId ? { routeId: { gt: afterRouteId } } : {}),
      assignments: {
        some: {
          status: { in: ["ACTIVE", "COMPLETED"] },
          OR: [{ driverId: userId }, { helperId: userId }],
        },
      },
    },
    orderBy: { routeId: "asc" },
    take: size + 1,
    select: {
      routeId: true,
      publicationVersion: true,
      routeRevision: true,
      checksum: true,
      snapshot: true,
      assignments: {
        orderBy: { sequence: "asc" },
        select: {
          jobId: true,
          sequence: true,
          status: true,
          job: {
            select: {
              status: true,
              arrivedAt: true,
              completedAt: true,
              failureReason: true,
              proofPhotoUrls: true,
              deliveryStateV2: { select: { jobRevision: true, currentStatus: true } },
            },
          },
        },
      },
    },
  });
  const hasMore = publications.length > size;
  const items = publications.slice(0, size).map((publication) => ({
    routeId: publication.routeId,
    publicationVersion: publication.publicationVersion,
    routeRevision: publication.routeRevision,
    checksum: publication.checksum,
    snapshot: publication.snapshot,
    liveStops: publication.assignments.map((assignment) => ({
      jobId: assignment.jobId,
      sequence: assignment.sequence,
      assignmentStatus: assignment.status,
      jobRevision: assignment.job.deliveryStateV2?.jobRevision ?? null,
      status: assignment.job.deliveryStateV2?.currentStatus ?? assignment.job.status,
      arrivedAt: assignment.job.arrivedAt,
      completedAt: assignment.job.completedAt,
      failureReason: assignment.job.failureReason,
      proofPhotoUrls: assignment.job.proofPhotoUrls,
    })),
  }));
  const nextSnapshotCursor = hasMore ? encodeDriverCursor({
    mode: "SNAPSHOT",
    userId,
    feedVersion: state.feedVersion,
    boundarySequence,
    afterRouteId: items.at(-1).routeId,
  }, secret) : null;
  const deltaCursor = !hasMore ? encodeDriverCursor({
    mode: "DELTA",
    userId,
    feedVersion: state.feedVersion,
    sequence: boundarySequence,
  }, secret) : null;
  return {
    mode: "FULL_SNAPSHOT",
    items,
    hasMore,
    nextSnapshotCursor,
    deltaCursor,
    boundarySequence,
    feedVersion: state.feedVersion,
  };
}

export async function readDriverDelta(prisma, { userId, cursor, limit, secret }) {
  const size = boundedLimit(limit, 100, 250);
  const parsed = decodeDriverCursor(cursor, { userId, mode: "DELTA", secret });
  if (!parsed) throw Object.assign(new Error("Delta cursor wajib diisi"), { statusCode: 400 });
  const state = await feedState(prisma, userId);
  const sequence = BigInt(parsed.sequence);
  if (parsed.feedVersion !== state.feedVersion || sequence < state.retentionFloor - 1n || sequence >= state.nextSequence) {
    return {
      mode: "FULL_REFRESH_REQUIRED",
      reason: parsed.feedVersion !== state.feedVersion ? "FEED_VERSION_CHANGED" : "CURSOR_GAP",
      feedVersion: state.feedVersion,
    };
  }
  const rows = await prisma.driverSyncEvent.findMany({
    where: { userId, feedVersion: state.feedVersion, sequence: { gt: sequence } },
    orderBy: { sequence: "asc" },
    take: size + 1,
  });
  const hasMore = rows.length > size;
  const events = rows.slice(0, size);
  const lastSequence = events.at(-1)?.sequence ?? sequence;
  return {
    mode: "DELTA",
    events: events.map((event) => ({ ...event, sequence: event.sequence.toString() })),
    hasMore,
    cursor: encodeDriverCursor({
      mode: "DELTA",
      userId,
      feedVersion: state.feedVersion,
      sequence: lastSequence.toString(),
    }, secret),
    feedVersion: state.feedVersion,
  };
}

export async function acknowledgeDriverCursor(prisma, { userId, deviceId, cursor, secret, device = {} }) {
  const parsed = decodeDriverCursor(cursor, { userId, mode: "DELTA", secret });
  if (!parsed) throw Object.assign(new Error("Cursor wajib diisi"), { statusCode: 400 });
  return prisma.driverDevice.upsert({
    where: { userId_deviceId: { userId, deviceId } },
    create: {
      userId,
      deviceId,
      platform: device.platform || null,
      appVersion: device.appVersion || null,
      buildNumber: device.buildNumber || null,
      runtimeVersion: device.runtimeVersion || null,
      lastSeenAt: new Date(),
      lastAppliedCursor: BigInt(parsed.sequence),
    },
    update: {
      platform: device.platform || undefined,
      appVersion: device.appVersion || undefined,
      buildNumber: device.buildNumber || undefined,
      runtimeVersion: device.runtimeVersion || undefined,
      lastSeenAt: new Date(),
      lastAppliedCursor: BigInt(parsed.sequence),
    },
  });
}
