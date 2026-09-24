import test from "node:test";
import assert from "node:assert/strict";
import { decodeDriverCursor, encodeDriverCursor } from "../src/services/driverFeedV2.js";
import {
  buildDeliveryRouteSnapshot,
  deliveryV2Checksum,
  hasDriverVisibleRouteSnapshotV2,
  isDriverActiveRouteStatusV2,
  isDriverVisibleAssignmentV2,
  routeRecipients,
} from "../src/services/deliveryV2Snapshot.js";

const SECRET = "test-secret-at-least-sixteen-characters";

test("cursor driver opaque, terikat principal dan mode", () => {
  const cursor = encodeDriverCursor({ mode: "DELTA", userId: "driver-a", sequence: "8", feedVersion: 2 }, SECRET);
  assert.equal(decodeDriverCursor(cursor, { userId: "driver-a", mode: "DELTA", secret: SECRET }).sequence, "8");
  assert.throws(() => decodeDriverCursor(cursor, { userId: "driver-b", mode: "DELTA", secret: SECRET }), /scope/);
  assert.throws(() => decodeDriverCursor(`${cursor}x`, { userId: "driver-a", secret: SECRET }), /tidak valid/);
});

test("snapshot deterministik dan recipient dideduplikasi", () => {
  const route = {
    id: "route-1", code: "RTE-1", date: new Date("2026-09-23T00:00:00Z"), status: "PUBLISHED",
    driverId: "u1", helperId: "u1", jobs: [{ id: "j1", sequence: 1, type: "DELIVERY", status: "ASSIGNED", units: [] }],
  };
  const first = buildDeliveryRouteSnapshot(route, { routeRevision: 3, publicationVersion: 2 });
  const second = buildDeliveryRouteSnapshot({ ...route }, { routeRevision: 3, publicationVersion: 2 });
  assert.equal(deliveryV2Checksum(first), deliveryV2Checksum(second));
  assert.deepEqual(routeRecipients(first), ["u1"]);
});

test("predicate kanonis mengecualikan 30 route selesai dan route cancelled", () => {
  const terminalRoutes = [
    ...Array.from({ length: 30 }, () => ({ status: "COMPLETED" })),
    { status: "CANCELLED" },
  ];
  assert.equal(terminalRoutes.filter((route) => isDriverActiveRouteStatusV2(route.status)).length, 0);
  assert.equal(isDriverVisibleAssignmentV2("COMPLETED", "ACTIVE"), false);
  assert.equal(isDriverVisibleAssignmentV2("CANCELLED", "ACTIVE"), false);
});

test("completed stop hanya menjadi konteks pada route IN_PROGRESS", () => {
  assert.equal(isDriverVisibleAssignmentV2("PUBLISHED", "ACTIVE"), true);
  assert.equal(isDriverVisibleAssignmentV2("PUBLISHED", "COMPLETED"), false);
  assert.equal(isDriverVisibleAssignmentV2("IN_PROGRESS", "ACTIVE"), true);
  assert.equal(isDriverVisibleAssignmentV2("IN_PROGRESS", "COMPLETED"), true);
  assert.equal(hasDriverVisibleRouteSnapshotV2({ status: "PUBLISHED", stops: [{ status: "COMPLETED" }] }), false);
  assert.equal(hasDriverVisibleRouteSnapshotV2({ status: "IN_PROGRESS", stops: [{ status: "COMPLETED" }] }), true);
  assert.equal(hasDriverVisibleRouteSnapshotV2({ status: "PUBLISHED", stops: [{ status: "ASSIGNED" }] }), true);
});
