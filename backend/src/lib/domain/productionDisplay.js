// Production simplifikasi slice 1 — kosakata TAMPILAN sederhana (murni, tanpa database; diuji node --test).
// Hanya PEMETAAN label dari data yang sudah ada: tidak mengubah enum, histori, atau mekanisme apa pun di backend.
//
// Tiga sumbu yang SENGAJA dipisah (jangan digabung jadi satu badge):
//   1. STATUS ORDER/UNIT  — Pengambilan · Diproses · Siap Kirim · Terkirim   (displayStatusOfUnit / displayStatusOfOrder)
//   2. KEBERADAAN FISIK   — belum tiba · di workshop · sudah keluar          (physicalPresenceOf; tidak pernah memalsukan konfirmasi tiba)
//   3. TAHAP PENGERJAAN   — langkah 1–12 (label tahap dari productionSteps.js; bukan di file ini)

export const DISPLAY_STATUS = Object.freeze({
  PENGAMBILAN: Object.freeze({ key: "PENGAMBILAN", label: "Pengambilan" }),
  DIPROSES: Object.freeze({ key: "DIPROSES", label: "Diproses" }),
  SIAP_KIRIM: Object.freeze({ key: "SIAP_KIRIM", label: "Siap Kirim" }),
  TERKIRIM: Object.freeze({ key: "TERKIRIM", label: "Terkirim" }),
  DIBATALKAN: Object.freeze({ key: "DIBATALKAN", label: "Dibatalkan" }),
});
export const DISPLAY_STATUS_FILTERS = Object.freeze(["PENGAMBILAN", "DIPROSES", "SIAP_KIRIM", "TERKIRIM"]);

const UNIT_STATUS_MAP = Object.freeze({
  AWAITING_PICKUP: ["PENGAMBILAN", "Menunggu dijemput"],
  IN_TRANSIT_IN: ["PENGAMBILAN", "Dalam perjalanan ke workshop"],
  RECEIVED: ["DIPROSES", null],
  IN_PRODUCTION: ["DIPROSES", null],
  READY_FOR_DELIVERY: ["SIAP_KIRIM", null],
  READY_ON_CUSTOMER_HOLD: ["SIAP_KIRIM", "Ditahan pelanggan"],
  IN_TRANSIT_OUT: ["SIAP_KIRIM", "Dalam pengiriman"],
  DELIVERED: ["TERKIRIM", null],
  CANCELLED: ["DIBATALKAN", null],
});
const ORDER_STATUS_MAP = Object.freeze({
  PENDING: ["PENGAMBILAN", "Belum diambil"],
  PICKUP: ["PENGAMBILAN", null],
  PROCESSING: ["DIPROSES", null],
  READY: ["SIAP_KIRIM", null],
  SHIPPING: ["SIAP_KIRIM", "Dalam pengiriman"],
  DELIVERED: ["TERKIRIM", null],
  CANCELLED: ["DIBATALKAN", null],
});
const pick = (map, status) => { const m = map[status]; return m ? { ...DISPLAY_STATUS[m[0]], detail: m[1] } : null; };
export const displayStatusOfUnit = (unitStatus) => pick(UNIT_STATUS_MAP, unitStatus);
export const displayStatusOfOrder = (orderStatus) => pick(ORDER_STATUS_MAP, orderStatus);

/** Unit yang sudah selesai dikerjakan: tidak tampil di backlog Rencana maupun Papan Meja (histori tetap utuh di data & laporan). */
export const isFinishedUnitStatus = (unitStatus) => ["SIAP_KIRIM", "TERKIRIM", "DIBATALKAN"].includes(UNIT_STATUS_MAP[unitStatus]?.[0]);
/** Unit yang boleh masuk backlog/papan kerja: status unit Diproses. */
export const isWorkableUnitStatus = (unitStatus) => UNIT_STATUS_MAP[unitStatus]?.[0] === "DIPROSES";

/**
 * Backlog Rencana Produksi (default): unit dari order NYATA berstatus Diproses.
 * "Nyata" = order ada, bukan dibatalkan, dan pelanggannya bukan SPAM / staf internal (konvensi tanpaOrderSpam + isInternalStaff). Order dan unit sama-sama harus Diproses:
 * order bobot "weakest link" tetap Diproses walau satu unit sudah Siap Kirim, jadi status UNIT juga diperiksa.
 */
export function isBacklogEligible({ orderStatus, unitStatus, customerExcluded = false }) {
  if (customerExcluded || !orderStatus) return false;
  return displayStatusOfOrder(orderStatus)?.key === "DIPROSES" && isWorkableUnitStatus(unitStatus);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Keberadaan fisik. TIDAK PERNAH menyatakan "sudah tiba" tanpa bukti: konfirmasi tiba = custody INBOUND ACCEPTED (Gudang) atau run lahir di workshop.
// ---------------------------------------------------------------------------------------------------------------------------------------
export const PRESENCE = Object.freeze({
  NOT_ARRIVED: Object.freeze({ key: "NOT_ARRIVED", label: "Belum tiba di workshop" }),
  ARRIVED_CONFIRMED: Object.freeze({ key: "ARRIVED_CONFIRMED", label: "Sudah tiba di workshop" }),
  AT_WORKSHOP_UNCONFIRMED: Object.freeze({ key: "AT_WORKSHOP_UNCONFIRMED", label: "Di workshop (konfirmasi tiba belum tercatat)" }),
  LEFT_WORKSHOP: Object.freeze({ key: "LEFT_WORKSHOP", label: "Sudah keluar dari workshop" }),
});
export function physicalPresenceOf({ unitStatus, runStatus = null, runOrigin = null, inboundAccepted = false }) {
  const s = UNIT_STATUS_MAP[unitStatus]?.[0];
  if (runStatus === "PENDING_ARRIVAL" || unitStatus === "AWAITING_PICKUP" || unitStatus === "IN_TRANSIT_IN") return { ...PRESENCE.NOT_ARRIVED, confirmed: false };
  if (unitStatus === "IN_TRANSIT_OUT" || s === "TERKIRIM") return { ...PRESENCE.LEFT_WORKSHOP, confirmed: true };
  if (inboundAccepted || runOrigin === "WORKSHOP_BORN") return { ...PRESENCE.ARRIVED_CONFIRMED, confirmed: true };
  return { ...PRESENCE.AT_WORKSHOP_UNCONFIRMED, confirmed: false };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Prioritas pengguna: Normal · Tinggi · Komplain.
//   - Normal/Tinggi = keputusan manusia yang SUDAH tersimpan (plan.priority 0/1/2 atau enum ProductionPriority). Nilai lama Mendesak/Kritis
//     (2, URGENT, CRITICAL) hanya DITAMPILKAN sebagai Tinggi — data tersimpan tidak diubah.
//   - Komplain = TURUNAN dari ComplaintCase resmi yang masih terbuka (bukan pencarian teks pada catatan/keluhan order, bukan Order.hasComplaint).
// ---------------------------------------------------------------------------------------------------------------------------------------
export const PRIORITY_KEYS = Object.freeze({
  NORMAL: Object.freeze({ key: "NORMAL", label: "Normal", rank: 0 }),
  HIGH: Object.freeze({ key: "HIGH", label: "Tinggi", rank: 1 }),
  COMPLAINT: Object.freeze({ key: "COMPLAINT", label: "Komplain", rank: 2 }),
});
/** Nilai tersimpan -> 0 (Normal) | 1 (Tinggi). Menerima angka plan (0/1/2) atau enum unit. */
export function storedPriorityLevel(stored) {
  if (typeof stored === "number") return stored >= 1 ? 1 : 0;
  return ["HIGH", "URGENT", "CRITICAL"].includes(stored) ? 1 : 0;
}
export function priorityDisplay({ stored = 0, complaintCases = [] } = {}) {
  if (complaintCases.length) return { ...PRIORITY_KEYS.COMPLAINT, complaintCases: complaintCases.map((c) => ({ id: c.id, caseNumber: c.caseNumber })) };
  return { ...(storedPriorityLevel(stored) === 1 ? PRIORITY_KEYS.HIGH : PRIORITY_KEYS.NORMAL), complaintCases: [] };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Pekerjaan Tertunda (bahasa sederhana). 8 nilai BlockReason di backend DITAMPILKAN sebagai 4 alasan; saat MENGAJUKAN, tiap alasan dipetakan ke SATU
// nilai enum yang sudah ada (tidak ada enum baru). Mekanisme pause (PauseReason) dan blocker TIDAK disamakan — hanya blocker yang dilabeli di sini.
// ---------------------------------------------------------------------------------------------------------------------------------------
export const DELAY_REASONS = Object.freeze({
  BAHAN: Object.freeze({ key: "BAHAN", label: "Menunggu bahan", submitAs: "MATERIAL_SHORTAGE" }),
  ARAHAN: Object.freeze({ key: "ARAHAN", label: "Menunggu arahan", submitAs: "AWAITING_CUSTOMER" }),
  KENDALA: Object.freeze({ key: "KENDALA", label: "Kendala pengerjaan", submitAs: "MACHINE_DOWN" }),
  LAINNYA: Object.freeze({ key: "LAINNYA", label: "Lainnya", submitAs: "OTHER" }),
});
const BLOCK_TO_DELAY = Object.freeze({
  MATERIAL_SHORTAGE: "BAHAN",
  AWAITING_CUSTOMER_APPROVAL: "ARAHAN", AWAITING_CUSTOMER: "ARAHAN", AWAITING_OPERATOR: "ARAHAN",
  MACHINE_DOWN: "KENDALA", QUALITY_ISSUE: "KENDALA", AWAITING_TOOL: "KENDALA",
  OTHER: "LAINNYA",
});
export const delayReasonOfBlock = (blockReason) => DELAY_REASONS[BLOCK_TO_DELAY[blockReason]] || DELAY_REASONS.LAINNYA;
/** Teks status kartu: "Tertunda — <alasan>"; alasan Lainnya memakai keterangan bila ada. */
export function delayStatusText(blockReason, note = null) {
  const r = delayReasonOfBlock(blockReason);
  const extra = r.key === "LAINNYA" && String(note || "").trim() ? String(note).trim().slice(0, 80) : null;
  return `Tertunda — ${extra || r.label.toLowerCase()}`;
}

// Filter status tampilan -> nilai UnitStatus (untuk where di server) dan hitungan per status tampilan dari hitungan per UnitStatus.
export const DISPLAY_STATUS_UNIT_FILTER = Object.freeze(Object.fromEntries(
  DISPLAY_STATUS_FILTERS.map((k) => [k, Object.entries(UNIT_STATUS_MAP).filter(([, v]) => v[0] === k).map(([s]) => s)]),
));
export function displayStatusCountsOf(statusCounts) {
  const out = Object.fromEntries(DISPLAY_STATUS_FILTERS.map((k) => [k, 0]));
  for (const { status, count } of statusCounts || []) { const k = UNIT_STATUS_MAP[status]?.[0]; if (k && k in out) out[k] += count; }
  return out;
}
