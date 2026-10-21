// Milestone global "Diterima di Workshop" — fungsi MURNI (tanpa DB; diuji node --test). Lihat docs/MILESTONE-DITERIMA-WORKSHOP.md.
//
// Prinsip: status global adalah TURUNAN dari fakta yang sudah tercatat. Tidak ada enum/kolom yang diubah, tidak ada histori yang ditulis ulang, tidak ada bukti kedatangan yang dibuat.
// Pickup selesai (UnitStatus.RECEIVED diset saat pickup selesai) BUKAN bukti unit sudah diterima workshop; bukti hanya salah satu dari command resmi (custody, konfirmasi petugas, penerimaan workshop, lahir di workshop) (receivedBasisOf).
//
// Empat sumbu yang DIPISAH di read-model (jangan digabung jadi satu badge):
//   1. status global     — globalStatusOf   (Pengambilan · Diterima di Workshop · Diproses · Siap Kirim · Dalam Pengiriman · Terkirim)
//   2. keberadaan fisik  — physicalPresenceOf di productionDisplay.js (+ receivedBasis di sini)
//   3. tahap produksi    — langkah 1–12 (productionSteps.js; artinya tidak berubah)
//   4. status jadwal     — scheduleStatusOf (Belum dijadwalkan · Sudah dijadwalkan · Menunggu bahan · Siap dikerjakan)

export const GLOBAL_STATUS = Object.freeze({
  MENUNGGU_DIJEMPUT: Object.freeze({ key: "MENUNGGU_DIJEMPUT", label: "Menunggu Dijemput" }),
  PENGAMBILAN: Object.freeze({ key: "PENGAMBILAN", label: "Pengambilan" }),
  DITERIMA_WORKSHOP: Object.freeze({ key: "DITERIMA_WORKSHOP", label: "Diterima di Workshop" }),
  DIPROSES: Object.freeze({ key: "DIPROSES", label: "Diproses" }),
  SIAP_KIRIM: Object.freeze({ key: "SIAP_KIRIM", label: "Siap Kirim" }),
  DALAM_PENGIRIMAN: Object.freeze({ key: "DALAM_PENGIRIMAN", label: "Dalam Pengiriman" }),
  TERKIRIM: Object.freeze({ key: "TERKIRIM", label: "Terkirim" }),
  DIBATALKAN: Object.freeze({ key: "DIBATALKAN", label: "Dibatalkan" }),
});
/** Urutan alur (tanpa Dibatalkan) — dipakai tab/filter/hitungan. */
export const GLOBAL_STATUS_FLOW = Object.freeze(["MENUNGGU_DIJEMPUT", "PENGAMBILAN", "DITERIMA_WORKSHOP", "DIPROSES", "SIAP_KIRIM", "DALAM_PENGIRIMAN", "TERKIRIM"]);

/** Dasar bukti "diterima di workshop". Semuanya command resmi; tidak ada yang diturunkan dari status pickup. */
export const RECEIVED_BASIS = Object.freeze({
  CUSTODY: "CUSTODY", // Gudang/Produksi menerima handoff INBOUND (acceptUnitCustody) — "Terima Unit di Workshop"
  STAFF_CONFIRMED: "STAFF_CONFIRMED", // konfirmasi tiba petugas tanpa custody (confirmUnitArrival; unit tanpa pickup tercatat)
  BORN_IN_WORKSHOP: "BORN_IN_WORKSHOP", // unit BARU/SEWA didaftarkan lahir di workshop (registerWorkshopBornRun)
  WORKSHOP_RECEIPT: "WORKSHOP_RECEIPT", // petugas mencatat penerimaan fisik di workshop (unit_workshop_receipts) — tanpa Run/aktivasi Produksi V2
});
export const RECEIVED_BASIS_LABEL = Object.freeze({
  CUSTODY: "Diterima petugas lewat custody",
  STAFF_CONFIRMED: "Kedatangan dikonfirmasi petugas",
  BORN_IN_WORKSHOP: "Dibuat langsung di workshop",
  WORKSHOP_RECEIPT: "Penerimaan dicatat petugas",
});

export const LEGACY_NOT_CONFIRMED = "Konfirmasi workshop belum tercatat";
export const PICKUP_DONE_WAITING_RECEIVE = "Pickup selesai — menunggu Terima Unit di Workshop";

/** Dasar bukti terima dari fakta mentah; null = TIDAK ADA bukti (jangan ditebak). Prioritas: custody > konfirmasi petugas > penerimaan workshop > lahir di workshop. */
export function receivedBasisOf({ inboundAccepted = false, staffConfirmed = false, workshopReceipt = false, bornInWorkshop = false } = {}) {
  if (inboundAccepted) return RECEIVED_BASIS.CUSTODY;
  if (staffConfirmed) return RECEIVED_BASIS.STAFF_CONFIRMED;
  if (workshopReceipt) return RECEIVED_BASIS.WORKSHOP_RECEIPT;
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
 * @param {boolean} [p.pickupInProgress] ada Job pickup yang SEDANG berlangsung (EN_ROUTE/ARRIVED). UnitStatus tetap AWAITING_PICKUP sepanjang job pickup berjalan,
 *   jadi "Menunggu Dijemput" vs "Pengambilan" dibedakan oleh job pickup, bukan oleh status unit.
 */
export function globalStatusOf({ unitStatus, receivedBasis = null, started = false, pickupCompleted = false, pickupInProgress = false } = {}) {
  const evidence = { received: !!receivedBasis, receivedBasis: receivedBasis || null, started: !!started, pickupCompleted: !!pickupCompleted, pickupInProgress: !!pickupInProgress };
  switch (unitStatus) {
    case "CANCELLED": return mk("DIBATALKAN", null, { evidence });
    case "DELIVERED": return mk("TERKIRIM", null, { evidence });
    case "IN_TRANSIT_OUT": return mk("DALAM_PENGIRIMAN", null, { evidence });
    case "READY_FOR_DELIVERY": return mk("SIAP_KIRIM", null, { evidence });
    case "READY_ON_CUSTOMER_HOLD": return mk("SIAP_KIRIM", "Ditahan pelanggan", { evidence });
    case "AWAITING_PICKUP": return pickupInProgress ? mk("PENGAMBILAN", "Pickup sedang berlangsung", { evidence }) : mk("MENUNGGU_DIJEMPUT", null, { evidence });
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

/** Status global tingkat ORDER = unit aktif yang PALING TERTINGGAL (weakest link); unit dibatalkan diabaikan. Hanya objek status (kompatibel dengan pemakai lama); rincian di orderRollupOf. */
export function globalStatusOfOrder(unitGlobals = []) {
  const r = orderRollupOf(unitGlobals);
  return r ? { key: r.key, label: r.label } : null;
}

const plural = (n) => `${n} unit`;
/**
 * Rollup status global tingkat ORDER dari status global tiap unit — read-model tampilan, BUKAN enum baru.
 *  - semua unit aktif sama -> status itu;
 *  - berbeda -> status unit aktif yang paling tertinggal, dengan rincian progres ("Diterima di Workshop · 2 dari 3 unit");
 *  - unit batal tidak ikut penyebut operasional; order tidak pernah tampil Siap Kirim / Terkirim selagi masih ada unit aktif yang tertinggal.
 * @param {Array<{key:string}|null>} unitGlobals hasil globalStatusOf per unit (null = unit tanpa status yang dikenal -> diabaikan)
 * @returns {null | { key, label, total, cancelled, mixed, counts, laggingCount, progressText, aheadText, summary, items }}
 *   null bila tidak ada unit sama sekali. total=0 (semua batal) -> status Dibatalkan.
 */
export function orderRollupOf(unitGlobals = []) {
  const known = (unitGlobals || []).filter((g) => g && GLOBAL_STATUS[g.key]);
  if (!known.length) return null;
  const active = known.filter((g) => g.key !== "DIBATALKAN");
  const cancelled = known.length - active.length;
  if (!active.length) return { ...GLOBAL_STATUS.DIBATALKAN, total: 0, cancelled, mixed: false, counts: {}, laggingCount: 0, progressText: null, aheadText: null, summary: GLOBAL_STATUS.DIBATALKAN.label, items: [] };
  const counts = {};
  for (const g of active) counts[g.key] = (counts[g.key] || 0) + 1;
  const items = GLOBAL_STATUS_FLOW.filter((k) => counts[k]).map((k) => ({ key: k, label: GLOBAL_STATUS[k].label, count: counts[k] }));
  const lag = items[0]; // alur terurut: elemen pertama = paling tertinggal
  const total = active.length;
  const mixed = items.length > 1;
  const ahead = items.slice(1);
  const progressText = mixed ? `${lag.count} dari ${total} unit masih ${lag.label}` : (total > 1 ? `Semua ${plural(total)}` : null);
  const aheadText = mixed ? ahead.map((i) => `${plural(i.count)} ${i.label}`).join(", ") : null;
  const summary = mixed ? `${lag.label} · ${lag.count} dari ${total} unit` : (total > 1 ? `${lag.label} · ${plural(total)}` : lag.label);
  return { key: lag.key, label: lag.label, total, cancelled, mixed, counts, laggingCount: lag.count, progressText, aheadText, summary, items };
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
export function milestoneOf({ unitStatus, receivedBasis = null, started = false, pickupCompleted = false, pickupInProgress = false, scheduled = false, materialWaiting = false } = {}) {
  const global = globalStatusOf({ unitStatus, receivedBasis, started, pickupCompleted, pickupInProgress });
  return {
    globalStatus: global,
    receivedBasis: receivedBasis || null,
    receivedBasisLabel: receivedBasis ? RECEIVED_BASIS_LABEL[receivedBasis] : null,
    scheduleStatus: scheduleStatusOf({ scheduled, materialWaiting, receivedBasis, started: global?.evidence?.started ?? started }),
  };
}

// ---- Tingkat ORDER: bentuk tampilan yang dikirim ke semua workspace ----------------------------------------------------------------------------
const LEGACY_ORDER_LABEL = Object.freeze({
  PENDING: "Pengambilan", PICKUP: "Pengambilan", PROCESSING: "Diproses", READY: "Siap Kirim", SHIPPING: "Dalam Pengiriman", DELIVERED: "Terkirim", CANCELLED: "Dibatalkan",
});
const EMPTY_VIEW = { mixed: false, total: 0, counts: {}, items: [], progressText: null, aheadText: null, laggingCount: 0, cancelled: 0 };
/**
 * Status global tingkat order untuk UI/API. rollup = orderRollupOf(status global tiap unit) atau null (order tanpa unit).
 * Order tanpa unit / order sewa (SEWA_*) TIDAK dikarang: legacy=true, key=null, label dari Order.status tersimpan (peta lama).
 * Order dibatalkan (Order.status) = Dibatalkan apa pun status unitnya. Field Order.status lama TIDAK dihapus — read-model ini sumber UI baru.
 */
export function orderMilestoneView({ orderStatus, rollup = null } = {}) {
  if (orderStatus === "CANCELLED") return { key: "DIBATALKAN", label: GLOBAL_STATUS.DIBATALKAN.label, summary: GLOBAL_STATUS.DIBATALKAN.label, legacy: false, ...EMPTY_VIEW };
  const sewa = typeof orderStatus === "string" && orderStatus.startsWith("SEWA_");
  if (!rollup || sewa) {
    const label = sewa ? null : LEGACY_ORDER_LABEL[orderStatus] || null;
    return { key: null, label, summary: label, legacy: true, ...EMPTY_VIEW };
  }
  return { key: rollup.key, label: rollup.label, summary: rollup.summary, legacy: false, mixed: rollup.mixed, total: rollup.total, counts: rollup.counts, items: rollup.items, progressText: rollup.progressText, aheadText: rollup.aheadText, laggingCount: rollup.laggingCount, cancelled: rollup.cancelled };
}
