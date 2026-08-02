// Status POD — turunan yang DIHITUNG BACKEND (derivePodStatus di
// backend/src/routes/armada.js), bukan dari deliveryMock.js. Sama alasannya
// dengan jobStatus.js & vehicleStatus.js: menyamakan sumber turunan supaya
// filter tab selalu cocok dengan yang ditampilkan backend.
export const POD_STATUS = {
  INCOMPLETE:     { label: "Belum Lengkap",        tone: "neutral" },
  PENDING_REVIEW: { label: "Menunggu Verifikasi",  tone: "orange" },
  VERIFIED:       { label: "Terverifikasi",        tone: "green" },
  REJECTED:       { label: "Ditolak",              tone: "red" },
};
