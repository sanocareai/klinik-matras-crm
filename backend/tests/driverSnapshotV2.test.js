import test from "node:test";
import assert from "node:assert/strict";
import { encodeDriverCursor } from "../src/services/driverFeedV2.js";
import { driverV2Eligibility, readDriverDelta, readDriverFullSnapshot } from "../src/services/driverSnapshotV2.js";

const SECRET = "test-secret-at-least-sixteen-characters";

test("job aktif pada route dibatalkan tidak membuat app gagal full refresh", async () => {
  const prisma = {
    job: {
      findMany: async () => [{ id: "j1", routeId: "r1", route: { id: "r1", status: "CANCELLED", deliveryStateV2: { currentPublicationVersion: 2 } } }],
    },
    v2MigrationException: { findMany: async () => [] },
  };
  const result = await driverV2Eligibility(prisma, "u1");
  assert.equal(result.eligible, true);
  assert.equal(result.activeAssignmentCount, 0);
  assert.deepEqual(result.blockers, []);
});

test("delta mendeteksi gap retention dan meminta full refresh", async () => {
  const prisma = {
    driverFeedState: {
      upsert: async () => ({ userId: "u1", nextSequence: 10n, retentionFloor: 5n, feedVersion: 1 }),
    },
    driverSyncEvent: { findMany: async () => { throw new Error("tidak boleh query event saat gap"); } },
  };
  const cursor = encodeDriverCursor({ mode: "DELTA", userId: "u1", feedVersion: 1, sequence: "2" }, SECRET);
  const result = await readDriverDelta(prisma, { userId: "u1", cursor, secret: SECRET });
  assert.equal(result.mode, "FULL_REFRESH_REQUIRED");
  assert.equal(result.reason, "CURSOR_GAP");
});

test("delta berurutan dan cursor maju hanya sampai event terakhir dalam page", async () => {
  const prisma = {
    driverFeedState: {
      upsert: async () => ({ userId: "u1", nextSequence: 5n, retentionFloor: 1n, feedVersion: 1 }),
    },
    driverSyncEvent: {
      findMany: async () => [
        { id: "e2", userId: "u1", sequence: 2n, kind: "UPSERT_ROUTE" },
        { id: "e3", userId: "u1", sequence: 3n, kind: "REMOVE_ROUTE" },
      ],
    },
  };
  const cursor = encodeDriverCursor({ mode: "DELTA", userId: "u1", feedVersion: 1, sequence: "1" }, SECRET);
  const result = await readDriverDelta(prisma, { userId: "u1", cursor, limit: 10, secret: SECRET });
  assert.deepEqual(result.events.map((item) => item.sequence), ["2", "3"]);
  assert.equal(result.hasMore, false);
});

function assignment(jobId, status) {
  return {
    jobId,
    sequence: Number(jobId.replace(/\D/g, "")) || 1,
    status,
    job: {
      status: status === "COMPLETED" ? "COMPLETED" : "ASSIGNED",
      arrivedAt: null,
      completedAt: status === "COMPLETED" ? new Date("2026-09-24T01:00:00.000Z") : null,
      failureReason: null,
      proofPhotoUrls: [],
      deliveryStateV2: { jobRevision: 1, currentStatus: status === "COMPLETED" ? "COMPLETED" : "ASSIGNED" },
    },
  };
}

test("dua route aktif menghasilkan 12 stop aktif dan 3 stop selesai yang relevan", async () => {
  const publishedAssignments = Array.from({ length: 6 }, (_, index) => assignment(`p${index + 1}`, "ACTIVE"));
  publishedAssignments.push(assignment("p7", "COMPLETED"));
  const inProgressAssignments = [
    ...Array.from({ length: 6 }, (_, index) => assignment(`i${index + 1}`, "ACTIVE")),
    ...Array.from({ length: 3 }, (_, index) => assignment(`i${index + 7}`, "COMPLETED")),
  ];
  const prisma = {
    job: { findMany: async () => [] },
    driverFeedState: { upsert: async () => ({ nextSequence: 1n, retentionFloor: 1n, feedVersion: 1 }) },
    routePublication: {
      findMany: async ({ where }) => {
        assert.equal(where.status, "ACTIVE");
        assert.equal(where.OR.length, 2);
        return [
          {
            routeId: "route-published", publicationVersion: 1, routeRevision: 1,
            checksum: "a", snapshot: { stops: publishedAssignments.map((item) => ({ jobId: item.jobId })) },
            route: { status: "PUBLISHED" }, assignments: publishedAssignments,
          },
          {
            routeId: "route-progress", publicationVersion: 2, routeRevision: 2,
            checksum: "b", snapshot: { stops: inProgressAssignments.map((item) => ({ jobId: item.jobId })) },
            route: { status: "IN_PROGRESS" }, assignments: inProgressAssignments,
          },
        ];
      },
    },
  };
  const result = await readDriverFullSnapshot(prisma, { userId: "u1", secret: SECRET });
  assert.equal(result.items.length, 2);
  assert.equal(result.items.flatMap((item) => item.liveStops).filter((stop) => stop.assignmentStatus === "ACTIVE").length, 12);
  assert.equal(result.items.flatMap((item) => item.liveStops).filter((stop) => stop.assignmentStatus === "COMPLETED").length, 3);
  assert.equal(result.items[0].liveStops.some((stop) => stop.assignmentStatus === "COMPLETED"), false);
  assert.equal(result.items[0].snapshot.stops.length, 6);
  assert.equal(result.items[1].snapshot.stops.length, 9);
});

test("missing-stop pada publication memblokir snapshot alih-alih menghilangkan stop diam-diam", async () => {
  const prisma = {
    job: { findMany: async () => [] },
    driverFeedState: { upsert: async () => ({ nextSequence: 1n, retentionFloor: 1n, feedVersion: 1 }) },
    routePublication: {
      findMany: async () => [{
        routeId: "route-broken", publicationVersion: 1, routeRevision: 1,
        checksum: "broken", snapshot: { stops: [{ jobId: "j1" }, { jobId: "j2" }] },
        route: { status: "PUBLISHED" }, assignments: [assignment("j1", "ACTIVE")],
      }],
    },
  };
  await assert.rejects(
    readDriverFullSnapshot(prisma, { userId: "u1", secret: SECRET }),
    (error) => error.code === "DRIVER_V2_SNAPSHOT_INTEGRITY_ERROR"
      && error.details.missingAssignmentJobIds[0] === "j2",
  );
});
