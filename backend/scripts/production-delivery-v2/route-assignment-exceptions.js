import { dateOnly, stableValue } from "./common.js";

export const ROUTE_JOB_ASSIGNMENT_MISMATCH = "ROUTE_JOB_ASSIGNMENT_MISMATCH";
export const SETTLED_JOB_STATUSES = new Set(["COMPLETED", "FAILED", "RESCHEDULED"]);

// Field yang dibandingkan antara header Route dan setiap Job aktif-nya.
const FIELDS = [
  ["driverId", (holder) => holder.driverId ?? null],
  ["helperId", (holder) => holder.helperId ?? null],
  ["vehicleId", (holder) => holder.vehicleId ?? null],
];

function jobDifferences(route, job) {
  const differences = [];
  for (const [field, read] of FIELDS) {
    if (read(job) !== read(route)) differences.push({ field, route: read(route), job: read(job) });
  }
  const routeDate = dateOnly(route.date);
  const jobDate = dateOnly(job.scheduledDate);
  if (routeDate !== jobDate) differences.push({ field: "scheduledDate", route: routeDate ?? null, job: jobDate ?? null });
  return differences;
}

// TEPAT SATU exception per route: seluruh Job yang menyimpang digabung ke evidence.mismatchedJobs,
// diurutkan deterministik berdasarkan jobId sehingga fingerprint evidence stabil antar-run.
// Job berstatus settled (COMPLETED/FAILED/RESCHEDULED) tidak dihitung, sama seperti aturan sebelumnya.
export function buildRouteAssignmentMismatchException(route) {
  const mismatchedJobs = route.jobs
    .filter((job) => !SETTLED_JOB_STATUSES.has(job.status))
    .map((job) => ({ jobId: job.id, differences: jobDifferences(route, job) }))
    .filter((item) => item.differences.length > 0)
    .sort((a, b) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0));
  if (!mismatchedJobs.length) return null;
  return {
    domain: "DELIVERY",
    aggregateType: "Route",
    aggregateId: route.id,
    code: ROUTE_JOB_ASSIGNMENT_MISMATCH,
    severity: "CRITICAL",
    status: "KEEP_V1",
    evidence: stableValue({
      routeId: route.id,
      routeCode: route.code ?? null,
      header: {
        driverId: route.driverId ?? null,
        helperId: route.helperId ?? null,
        vehicleId: route.vehicleId ?? null,
        scheduledDate: dateOnly(route.date) ?? null,
      },
      mismatchedJobCount: mismatchedJobs.length,
      mismatchedJobs,
    }),
  };
}
