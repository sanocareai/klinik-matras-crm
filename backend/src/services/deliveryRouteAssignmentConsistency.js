// Konsistensi header Route vs penugasan Job (driver, helper, kendaraan, tanggal) — SATU definisi yang dipakai
// backfill/exception migrasi V2 dan guard publish, supaya keduanya tidak pernah berbeda pengertian.
//
// Aturan waktu: route DRAFT belum boleh dianggap menyimpang (crew di header adalah RENCANA; job baru
// menerima crew saat publish). Validasi berlaku untuk PUBLISHED/IN_PROGRESS dan dijaga fail-closed saat publish.
export const ROUTE_JOB_ASSIGNMENT_MISMATCH = "ROUTE_JOB_ASSIGNMENT_MISMATCH";
export const SETTLED_JOB_STATUSES = Object.freeze(new Set(["COMPLETED", "FAILED", "RESCHEDULED"]));

const dateOnly = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);
const CREW_FIELDS = ["driverId", "helperId", "vehicleId"];

function jobDifferences(route, job) {
  const differences = [];
  for (const field of CREW_FIELDS) {
    const routeValue = route[field] ?? null;
    const jobValue = job[field] ?? null;
    if (routeValue !== jobValue) differences.push({ field, route: routeValue, job: jobValue });
  }
  const routeDate = dateOnly(route.date);
  const jobDate = dateOnly(job.scheduledDate);
  if (routeDate !== jobDate) differences.push({ field: "scheduledDate", route: routeDate, job: jobDate });
  return differences;
}

// Job settled tidak dihitung. Urut deterministik berdasarkan jobId.
export function routeJobAssignmentMismatches(route, jobs = route.jobs || []) {
  return jobs
    .filter((job) => !SETTLED_JOB_STATUSES.has(job.status))
    .map((job) => ({ jobId: job.id, differences: jobDifferences(route, job) }))
    .filter((item) => item.differences.length > 0)
    .sort((a, b) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0));
}

// Dipanggil DI DALAM transaksi publish, setelah header disalin ke job. Bila masih ada job yang tidak konsisten
// (mis. penulisan bersamaan atau regresi cascade) publish ditolak dan transaksi dibatalkan — route tetap DRAFT.
export function assertRouteAssignmentConsistentForPublish(route, jobs) {
  const mismatches = routeJobAssignmentMismatches(route, jobs);
  if (!mismatches.length) return;
  throw Object.assign(
    new Error(`Publish ditolak: ${mismatches.length} job tidak konsisten dengan header rute (driver/helper/kendaraan/tanggal)`),
    {
      statusCode: 409,
      code: "ROUTE_PUBLISH_ASSIGNMENT_INCONSISTENT",
      details: { routeId: route.id, mismatchedJobs: mismatches },
    },
  );
}
