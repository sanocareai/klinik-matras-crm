import test from "node:test";
import assert from "node:assert/strict";
import { encodeDriverCursor } from "../src/services/driverFeedV2.js";
import { driverV2Eligibility, readDriverDelta } from "../src/services/driverSnapshotV2.js";

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
