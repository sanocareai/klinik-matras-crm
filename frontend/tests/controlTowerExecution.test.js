import test from "node:test";
import assert from "node:assert/strict";
import { deriveRouteExceptions, deriveRouteProgress } from "../src/features/armada/controlTowerRules.js";

test("Control Tower menghitung reschedule sebagai stop settled", () => {
  const progress = deriveRouteProgress({ jobs: [{ status: "COMPLETED" }, { status: "FAILED" }, { status: "RESCHEDULED" }] });
  assert.deepEqual({ done: progress.done, total: progress.total }, { done: 3, total: 3 });
});

test("pending sync perangkat muncul sebagai exception dari payload route yang sama", () => {
  const exceptions = deriveRouteExceptions({
    status: "IN_PROGRESS", date: "2026-09-22", driverId: "d", vehicleId: "v",
    driver: { name: "Driver", driverPendingSyncCount: 2 }, jobs: [{ status: "EN_ROUTE" }],
  }, { now: new Date("2026-09-22T04:00:00Z") });
  assert.equal(exceptions.find((item) => item.type === "PENDING_SYNC")?.severity, "warning");
});
