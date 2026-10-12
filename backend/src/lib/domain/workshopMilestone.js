// Milestone global "Diterima di Workshop" — fungsi MURNI (tanpa DB; diuji node --test). Lihat docs/MILESTONE-DITERIMA-WORKSHOP.md.
//
// Prinsip: status global adalah TURUNAN dari fakta yang sudah tercatat. Tidak ada enum/kolom yang diubah, tidak ada histori yang ditulis ulang, tidak ada bukti kedatangan yang dibuat.
// Pickup selesai (UnitStatus.RECEIVED diset saat pickup selesai) BUKAN bukti unit sudah diterima workshop; bukti hanya salah satu dari tiga command resmi (receivedBasisOf).
//
// Empat sumbu yang DIPISAH di read-model (jangan digabung jadi satu badge):
//   1. status global     — globalStatusOf   (Pengambilan · Diterima di Workshop · Diproses · Siap Kirim · Dalam Pengiriman · Terkirim)
//   2. keberadaan fisik  — physicalPresenceOf di productionDisplay.js (+ receivedBasis di sini)
//   3. tahap produksi    — langkah 1–12 (productionSteps.js; artinya tidak berubah)
//   4. status jadwal     — scheduleStatusOf (Belum dijadwalkan · Sudah dijadwalkan · Menunggu bahan · Siap dikerjakan)

export const GLOBAL_STATUS = Object.freeze({
  PENGAMBILAN: Object.freeze({ key: "PENGAMBILAN", label: "Pengambilan" }),
  DITERIMA_WORKSHOP: Object.freeze({ key: "DITERIMA_WORKSHOP", label: "Diterima di Workshop" }),
  DIPROSES: Object.freeze({ key: "DIPROSES", label: "Diproses" }),
  SIAP_KIRIM: Object.freeze({ key: "SIAP_KIRIM", label: "Siap Kirim" }),
  DALAM_PENGIRIMAN: Object.freeze({ key: "DALAM_PENGIRIMAN", label: "Dalam Pengiriman" }),
  TERKIRIM: Object.freeze({ key: "TERKIRIM", label: "Terkirim" }),
  DIBATALKAN: Object.freeze({ key: "DIBATALKAN", label: "Dibatalkan" }),
});
/** Urutan alur (tanpa Dibatalkan) — dipakai tab/filter/hitungan. */
export const GLOBAL_STATUS_FLOW = Object.freeze(["PENGAMBILAN", "DITERIMA_WORKSHOP", "DIPROSES", "SIAP_KIRIM", "DALAM_PENGIRIMAN", "TERKIRIM"]);

/** Dasar bukti "diterima di workshop". Semuanya command resmi; tidak ada yang diturunkan dari status pickup. */
export const RECEIVED_BASIS = Object.freeze({
  CUSTODY: "CUSTODY", // Gudang/Produksi menerima handoff INBOUND (acceptUnitCustody) — "Terima Unit di Workshop"
  STAFF_CONFIRMED: "STAFF_CONFIRMED", // konfirmasi tiba petugas tanpa custody (confirmUnitArrival; unit tanpa pickup tercatat)
  BORN_IN_WORKSHOP: "BORN_IN_WORKSHOP", // unit BARU/SEWA didaftarkan lahir di workshop (registerWorkshopBornRun)
});
export const RECEIVED_BASIS_LABEL = Object.freeze({
  CUSTODY: "Diterima petugas lewat custody",
  STAFF_CONFIRMED: "Kedatangan dikonfirmasi petugas",
  BORN_IN_WORKSHOP: "Dibuat langsung di workshop",
});

export const LEGACY_NOT_CONFIRMED = "Konfirmasi workshop belum tercatat";
export const PICKUP_DONE_WAITING_RECEIVE = "Pickup selesai — menunggu Terima Unit di Workshop";

/** Dasar bukti terima dari fakta mentah; null = TIDAK ADA bukti (jangan ditebak). Prioritas: custody > konfirmasi petugas > lahir di workshop. */
export function receivedBasisOf({ inboundAccepted = false, staffConfirmed = false, bornInWorkshop = false } = {}) {
  if (inboundAccepted) return RECEIVED_BASIS.CUSTODY;
  if (staffConfirmed) return RECEIVED_BASIS.STAFF_CONFIRMED;
  if (bornInWorkshop) return RECEIVED_BASIS.BORN_IN_WORKSHOP;
  return null;
}

const mk = (key, detail = null, extra = {}) => ({ ...GLOBAL_STATUS[key], detail, ...extra });

/**
 * Status global satu unit.
 * @param {object} p
 * @param {string} p.unitStatus      UnitStatus tersimpan
 * @param {string|null} [p.receivedBasis]  hasil receivedBasisOf (null = tidak ada bukti terima)
 * @param {boolean} [p.started]      pekerjaan produksi pertama benar-benar dimulai (operasi V2 non-lewati / log tahap V1)
 * @param {boolean} [p.pickupCompleted] ada Job pickup yang SELESAI untuk unit ini (hanya untuk kalimat detail)
 */
export function globalStatusOf({ unitStatus, receivedBasis = null, started = false, pickupCompleted = false } = {}) {
  const evidence = { received: !!receivedBasis, receivedBasis: receivedBasis || null, started: !!started, pickupCompleted: !!pickupCompleted };
  switch (unitStatus) {
    case "CANCELLED": return mk("DIBATALKAN", null, { evidence });
    case "DELIVERED": return mk("TERKIRIM", null, { evidence });
    case "IN_TRANSIT_OUT": return mk("DALAM_PENGIRIMAN", null, { evidence });
    case "READY_FOR_DELIVERY": return mk("SIAP_KIRIM", null, { evidence });
    case "READY_ON_CUSTOMER_HOLD": return mk("SIAP_KIRIM", "Ditahan pelanggan", { evidence });
    case "AWAITING_PICKUP": return mk("PENGAMBILAN", "Menunggu dijemput", { evidence });
    case "IN_TRANSIT_IN": return mk("PENGAMBILAN", "Dalam perjalanan ke workshop", { evidence });
    case "RECEIVED":
    case "IN_PRODUCTION": {
      // IN_PRODUCTION diset engine tahap saat tahap pertama mulai -> fakta "sudah dimulai" (histori V1 tanpa log tetap konsisten).
      const sudahMulai = !!started || unitStatus === "IN_PRODUCTION";
      if (sudahMulai) return mk("DIPROSES", receivedBasis ? null : LEGACY_NOT_CONFIRMED, { evidence: { ...evidence, started: true } });
      if (receivedBasis) return mk("DITERIMA_WORKSHOP", null, { evidence });
      // Tanpa bukti terima: tetap Pengambilan (kontrak), dengan kalimat jujur sesuai ada/tidaknya catatan pickup.
      return mk("PENGAMBILAN", pickupCompleted ? PICKUP_DONE_WAITING_RECEIVE : LEGACY_NOT_CONFIRMED, { evidence });
    }
    default: return null;
  }
}

/** Status global tingkat ORDER = unit yang PALING AWAL di alur (weakest link), unit dibatalkan diabaikan. null bila tidak ada unit aktif. */
export function globalStatusOfOrder(unitGlobals = []) {
  const aktif = unitGlobals.filter((g) => g && g.key !== "DIBATALKAN");
  if (!aktif.length) return unitGlobals.some((g) => g?.key === "DIBATALKAN") ? GLOBAL_STATUS.DIBATALKAN : null;
  return aktif.reduce((m, g) => (GLOBAL_STATUS_FLOW.indexOf(g.key) < GLOBAL_STATUS_FLOW.indexOf(m.key) ? g : m));
}

// ---- Sumbu 4: status jadwal ------------------------------------------------------------------------------------------------------------
export const SCHEDULE_STATUS = Object.freeze({
  BELUM_DIJADWALKAN: Object.freeze({ key: "BELUM_DIJADWALKAN", label: "Belum dijadwalkan" }),
  SUDAH_DIJADWALKAN: Object.freeze({ key: "SUDAH_DIJADWALKAN", label: "Sudah dijadwalkan" }),
  MENUNGGU_BAHAN: Object.freeze({ key: "MENUNGGU_BAHAN", label: "Menunggu bahan" }),
  SIAP_DIKERJAKAN: Object.freeze({ key: "SIAP_DIKERJAKAN", label: "Siap dikerjakan" }),
});
/**
 * Status jadwal — TERPISAH dari status global: "sudah dijadwalkan" TIDAK berarti Diproses.
 * @param {boolean} scheduled         rencana punya meja + tanggal
 * @param {boolean} materialWaiting   ada kekurangan bahan terbuka / bahan belum disiapkan setelah diagnosa
 * @param {string|null} receivedBasis bukti terima (null = unit belum diterima workshop)
 * @param {boolean} started           pekerjaan sudah dimulai
 */
export function scheduleStatusOf({ scheduled = false, materialWaiting = false, receivedBasis = null, started = false } = {}) {
  if (!scheduled) return SCHEDULE_STATUS.BELUM_DIJADWALKAN;
  if (materialWaiting) return SCHEDULE_STATUS.MENUNGGU_BAHAN;
  if (receivedBasis || started) return SCHEDULE_STATUS.SIAP_DIKERJAKAN;
  return SCHEDULE_STATUS.SUDAH_DIJADWALKAN;
}

/** Rakitan read-model empat sumbu untuk satu unit/run (dipakai toRunView, backlog, Unit 360, daftar Order Produksi). */
export function milestoneOf({ unitStatus, receivedBasis = null, started = false, pickupCompleted = false, scheduled = false, materialWaiting = false } = {}) {
  const global = globalStatusOf({ unitStatus, receivedBasis, started, pickupCompleted });
  return {
    globalStatus: global,
    receivedBasis: receivedBasis || null,
    receivedBasisLabel: receivedBasis ? RECEIVED_BASIS_LABEL[receivedBasis] : null,
    scheduleStatus: scheduleStatusOf({ scheduled, materialWaiting, receivedBasis, started: global?.evidence?.started ?? started }),
  };
}
