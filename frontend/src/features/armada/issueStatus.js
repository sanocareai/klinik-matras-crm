// Status Kendala — turunan yang DIHITUNG BACKEND (deriveIssueStatus di
// backend/src/routes/armada.js), sama pola dengan podStatus.js/vehicleStatus.js.
// Hanya 2 nilai: OPEN (job gagal, belum dijadwalkan ulang) dan RESCHEDULED
// (job gagal yang sudah/pernah dijadwalkan ulang lewat halaman ini).
export const ISSUE_STATUS = {
  OPEN:        { label: "Belum Dijadwalkan Ulang", tone: "red" },
  RESCHEDULED: { label: "Sudah Dijadwalkan Ulang",  tone: "orange" },
};
