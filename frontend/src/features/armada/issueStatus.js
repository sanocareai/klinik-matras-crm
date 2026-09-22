// Status Kendala — turunan yang DIHITUNG BACKEND (deriveIssueStatus di
// backend/src/routes/armada.js), sama pola dengan podStatus.js/vehicleStatus.js.
// Hanya 2 nilai: OPEN (job gagal, belum dijadwalkan ulang) dan RESCHEDULED
// (job gagal yang sudah/pernah dijadwalkan ulang lewat halaman ini).
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
export function issueStatusOf(j) {
  const pernahDireschedule = !!(j.rescheduleReason || j.rescheduleCase);
  if (j.status === "FAILED") return pernahDireschedule ? "RESCHEDULED" : "OPEN";
  if (pernahDireschedule) return "RESCHEDULED";
  return null;
}
