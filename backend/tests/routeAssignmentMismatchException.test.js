import test from "node:test";
import assert from "node:assert/strict";
import { checksum } from "../scripts/production-delivery-v2/common.js";
import { buildRouteAssignmentMismatchException } from "../scripts/production-delivery-v2/route-assignment-exceptions.js";

const DATE = new Date("2026-09-25T00:00:00.000Z");
const route = (jobs, extra = {}) => ({
  id: "route-1", code: "RTE-1", date: DATE, driverId: "drv", helperId: "hlp", vehicleId: "veh", jobs, ...extra,
});
const job = (id, extra = {}) => ({ id, status: "ASSIGNED", scheduledDate: DATE, driverId: "drv", helperId: "hlp", vehicleId: "veh", ...extra });

test("route tanpa job menyimpang tidak menghasilkan exception", () => {
  assert.equal(buildRouteAssignmentMismatchException(route([job("a"), job("b")])), null);
});

test("banyak job menyimpang digabung menjadi TEPAT SATU exception dengan evidence.mismatchedJobs", () => {
  const result = buildRouteAssignmentMismatchException(route([
    job("c", { driverId: "other" }), job("a", { helperId: null }), job("b"), job("d", { vehicleId: "v2", scheduledDate: new Date("2026-09-26T00:00:00.000Z") }),
  ]));
  assert.equal(result.code, "ROUTE_JOB_ASSIGNMENT_MISMATCH");
  assert.equal(result.aggregateId, "route-1");
  assert.equal(result.evidence.mismatchedJobCount, 3);
  assert.deepEqual(result.evidence.mismatchedJobs.map((item) => item.jobId), ["a", "c", "d"], "urut deterministik berdasarkan jobId");
});

test("setiap job mencatat field berbeda beserta nilai header route dan nilai job", () => {
  const result = buildRouteAssignmentMismatchException(route([
    job("d", { driverId: "x", vehicleId: null, scheduledDate: new Date("2026-09-26T00:00:00.000Z") }),
  ]));
  assert.deepEqual(result.evidence.header, { driverId: "drv", helperId: "hlp", vehicleId: "veh", scheduledDate: "2026-09-25" });
  assert.deepEqual(result.evidence.mismatchedJobs[0].differences, [
    { field: "driverId", route: "drv", job: "x" },
    { field: "vehicleId", route: "veh", job: null },
    { field: "scheduledDate", route: "2026-09-25", job: "2026-09-26" },
  ]);
});

test("job settled (COMPLETED/FAILED/RESCHEDULED) tidak dihitung", () => {
  const settled = ["COMPLETED", "FAILED", "RESCHEDULED"].map((status, i) => job(`s${i}`, { status, driverId: "other" }));
  assert.equal(buildRouteAssignmentMismatchException(route(settled)), null);
});

test("fingerprint evidence identik walau urutan job masukan berbeda; berubah bila ada mismatch baru", () => {
  const jobs = [job("a", { driverId: "x" }), job("b", { helperId: "y" }), job("c", { vehicleId: "z" })];
  const one = buildRouteAssignmentMismatchException(route(jobs));
  const two = buildRouteAssignmentMismatchException(route([...jobs].reverse()));
  assert.equal(checksum(one.evidence), checksum(two.evidence));
  const more = buildRouteAssignmentMismatchException(route([...jobs, job("d", { driverId: "q" })]));
  assert.notEqual(checksum(one.evidence), checksum(more.evidence));
});
