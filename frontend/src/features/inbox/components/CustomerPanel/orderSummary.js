import {
  ORDER_STATUS_LABELS, ORDER_STATUS_BUCKET_LABELS, orderStatusBucket,
  PRODUCT_LINE_LABELS, PRODUCT_TYPE_LABELS, parseOrderNotes,
} from "@/utils/format.js";

// Helper ringkasan order yang dipakai BERSAMA oleh ActiveOrderCard (tab
// Overview) dan OrderHistoryList (tab Order) — ditaruh terpisah supaya
// label status/produk keduanya TIDAK PERNAH drift satu sama lain (kelas
// masalah yang sudah pernah kejadian di project ini: label "Penawaran"
// nyangkut di satu tempat, lihat catatan STAGE_LABELS di utils/format.js).

// Status yang TIDAK LAGI butuh tindakan operasional.
export const TERMINAL_STATUSES = new Set(["DELIVERED", "CANCELLED", "SEWA_DIAMBIL"]);

export function statusLabel(status) {
  return ORDER_STATUS_BUCKET_LABELS[orderStatusBucket(status)] || ORDER_STATUS_LABELS[status] || status;
}

export function productSummary(order) {
  const line = PRODUCT_LINE_LABELS[order.productLine] || "Kasur";
  const type = order.productType ? (PRODUCT_TYPE_LABELS[order.productType] || order.productType) : "";
  const { ukuranKasur } = parseOrderNotes(order.notes);
  return [type ? `${line} ${type}` : line, ukuranKasur].filter(Boolean).join(" · ");
}

export function formatTanggalPendek(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}
