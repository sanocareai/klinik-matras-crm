// Diekstrak murni dari JobListScreen.js (22 September 2026) — TIDAK ada
// import react-native/JSX di file ini SENGAJA, supaya bisa dites dengan
// `node --test` biasa (sama pola dengan backend/tests, tanpa perlu setup
// jest/RN Testing Library). Logika turunan daftar job — mengelompokkan
// aktif/riwayat, dan kartu "Mulai Perjalanan" per rute — dipindah ke sini
// APA ADANYA, tidak ada perubahan perilaku.
export const ACTIVE_STATUSES = ["ASSIGNED", "EN_ROUTE", "ARRIVED"];

export function deriveJobList(jobs, { showHistory = false } = {}) {
  const activeJobs = (jobs || []).filter((j) => ACTIVE_STATUSES.includes(j.status));
  const doneJobs = (jobs || []).filter((j) => j.status === "COMPLETED" || j.status === "FAILED");
  const listData = showHistory ? doneJobs : activeJobs;

  // Rute hari ini — kartu "Mulai Perjalanan sekali" per rute yang masih
  // punya job belum selesai (tab Aktif saja).
  const rutes = [];
  if (!showHistory) {
    const byId = new Map();
    for (const j of jobs || []) {
      if (!j.route || j.status === "COMPLETED" || j.status === "FAILED") continue;
      let r = byId.get(j.route.id);
      if (!r) {
        r = { route: j.route, assignedCount: 0, sampleJobId: null };
        byId.set(j.route.id, r);
      }
      if (j.status === "ASSIGNED") {
        r.assignedCount += 1;
        if (!r.sampleJobId) r.sampleJobId = j.id;
      }
    }
    rutes.push(...byId.values());
  }

  return { activeJobs, doneJobs, listData, rutes };
}
