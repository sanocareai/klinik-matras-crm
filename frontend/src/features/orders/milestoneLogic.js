// Logika murni badge milestone order (tanpa React/alias) supaya bisa dites langsung.
// CERMIN ORDER_STATUS_LABELS (utils/format.js) — diimpor langsung tidak bisa karena format.js menarik alias "@/" (tidak terbaca node --test). Tes paritas menjaga keduanya sama.
export const STATUS_ORDER_LABEL = Object.freeze({
  PENDING: "Menunggu", PICKUP: "Pengambilan", PROCESSING: "Diproses", READY: "Siap Kirim", SHIPPING: "Pengiriman", DELIVERED: "Terkirim", CANCELLED: "Dibatalkan", SEWA_DIKIRIM: "Pengiriman", SEWA_DIAMBIL: "Pengambilan Kembali",
});

// "Dalam Pengiriman" (milestone) dan "Pengiriman" (status order) = hal yang sama → dinormalkan sebelum dibandingkan.
const normal = (t) => String(t ?? "").trim().toLowerCase().replace(/^dalam\s+/, "");

/**
 * Badge milestone yang HANYA mengulang status order tidak ditampilkan (mis. status "Terkirim" + badge "Terkirim · 3 unit" = dua status untuk hal yang sama).
 * Badge tetap tampil bila menambah informasi: label beda dari status order (mis. "Diterima di Workshop" saat status "Diproses") atau unit berbeda posisi (mixed).
 */
export function milestoneRedundan(order, milestone) {
  if (!order || !milestone || milestone.mixed) return false;
  const statusLabel = STATUS_ORDER_LABEL[order.status];
  return !!statusLabel && normal(statusLabel) === normal(milestone.label);
}
