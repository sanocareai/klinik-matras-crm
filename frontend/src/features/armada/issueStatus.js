// Status Kendala — turunan yang DIHITUNG BACKEND (deriveIssueStatus di
// backend/src/routes/armada.js), sama pola dengan podStatus.js/vehicleStatus.js.
// Hanya 2 nilai: OPEN (job GAGAL SAAT INI, perlu dijadwalkan ulang — tidak
// peduli riwayat reschedule-nya) dan RESCHEDULED (job yang SUDAH LEWAT dari
// FAILED dan pernah dijadwalkan ulang lewat halaman ini, murni riwayat).
export const ISSUE_STATUS = {
  OPEN:        { label: "Belum Dijadwalkan Ulang", tone: "red" },
  RESCHEDULED: { label: "Sudah Dijadwalkan Ulang",  tone: "orange" },
};

// Derive status ringkas job kendala/reschedule — SAMA logika dengan
// deriveIssueStatus() di backend/src/routes/armada.js, disalin ringkas di
// sini alih-alih backend mengirim field turunan lagi (endpoint yang tidak
// pre-compute-nya, mis. GET /armada/routes, TETAP bisa dipakai halaman yang
// butuh status kendala tanpa panggilan API kedua ke GET /armada/issues).
//
// DIPINDAH ke sini dari RiwayatRevisiKendala.jsx (22 September 2026, Delivery
// Control Tower) — SEBELUMNYA didefinisikan lokal di komponen .jsx itu,
// controlTowerRules.js (logika murni, TANPA import React sama sekali,
// supaya bisa dites `node --test` biasa) butuh fungsi yang SAMA tapi tidak
// bisa mengimpor dari file .jsx (menyeret React/Radix ikut ter-parse).
// issueStatus.js sudah plain JS sejak awal — rumah yang tepat, SATU sumber
// dipakai backend (referensi), RiwayatRevisiKendala.jsx, DAN
// controlTowerRules.js sekaligus.
// rescheduleCaseId (D-160, 13 September 2026) — OR tambahan, sama alasan
// dengan backend deriveIssueStatus (armada.js): jalur PROACTIVE sekarang
// ikut menulis rescheduleReason juga, tapi job LAMA (sebelum perbaikan
// ini) cuma punya rescheduleCase.
//
// BUG DIPERBAIKI (10 Nov 2026) — SAMA fix dengan backend deriveIssueStatus,
// lihat catatan panjang di sana: job FAILED SELALU "OPEN", titik, tidak
// peduli apakah pernah direschedule di siklus SEBELUMNYA. Sebelumnya job
// yang gagal lagi SETELAH sempat direschedule tetap terbaca "RESCHEDULED"
// (menyamarkan kegagalan yang sedang terjadi), bikin job itu hilang dari
// filter OPEN di tab Kendala & Reschedule DAN tidak pernah memicu
// exception GAGAL_ANTAR di Delivery Control Tower (controlTowerRules.js).
export function issueStatusOf(j) {
  if (j.status === "FAILED") return "OPEN";
  const pernahDireschedule = !!(j.rescheduleReason || j.rescheduleCase);
  if (pernahDireschedule) return "RESCHEDULED";
  return null;
}
