// Diekstrak murni dari JobListScreen.js (22 September 2026) — TIDAK ada
// import react-native/JSX di file ini SENGAJA, supaya bisa dites dengan
// `node --test` biasa (sama pola dengan backend/tests, tanpa perlu setup
// jest/RN Testing Library).
//
// BUG NYATA ditemukan 22 September 2026 (audit produksi RTE-220926-01/02,
// laporan Agung/Apriansyah "stop hilang dari app"): daftar ini SEBELUMNYA
// TIDAK menyertakan "SCHEDULED" — status yang backend sendiri anggap
// "aktif" (lihat ACTIVE_JOB_STATUSES di backend/src/services/jobStatus.js:
// UNSCHEDULED, SCHEDULED, ASSIGNED, EN_ROUTE, ARRIVED). Akibatnya stop yang
// SUDAH masuk rute published tapi BELUM disentuh driver (belum tap
// "Mulai") — status-nya SCHEDULED, bukan ASSIGNED — diam-diam HILANG dari
// tab Aktif walau server sudah mengembalikannya dengan benar lewat
// GET /armada/my-jobs. Di RTE-220926-01 (8 stop, 3 di antaranya SCHEDULED)
// ini SENDIRIAN sudah cukup membuat app Agung kelihatan cuma "1 stop"
// padahal server benar. SEKARANG disamakan dengan definisi backend.
export const ACTIVE_STATUSES = ["SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"];

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
