import { dateOnly, stableValue } from "./common.js";
import {
  ROUTE_JOB_ASSIGNMENT_MISMATCH, SETTLED_JOB_STATUSES, routeJobAssignmentMismatches,
} from "../../src/services/deliveryRouteAssignmentConsistency.js";

export { ROUTE_JOB_ASSIGNMENT_MISMATCH, SETTLED_JOB_STATUSES };

// TEPAT SATU exception per route: seluruh Job yang menyimpang digabung ke evidence.mismatchedJobs,
// diurutkan deterministik berdasarkan jobId sehingga fingerprint evidence stabil antar-run.
// Route DRAFT TIDAK menghasilkan exception (crew header hanyalah rencana; job menerima crew saat publish).
export function buildRouteAssignmentMismatchException(route) {
  if (route.status === "DRAFT") return null;
  const mismatchedJobs = routeJobAssignmentMismatches(route);
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
