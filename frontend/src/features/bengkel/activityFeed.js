// Format aktivitas produksi (Production Core Slice 1) — cermin FRONTEND
// dari EVENT_TYPES/formatActivitySentence di
// backend/src/lib/activityLog.js. Pola SAMA dengan unitStatus.js: file ini
// HANYA berisi nilai yang benar-benar dikirim backend, dan memformat
// tanggal metadata dengan formatDate.js (backend sengaja menyimpan ISO
// mentah — "UTC di dalam, WIB di tepi", lihat utils/wib.js — pemformatan
// tampilan adalah tanggung jawab tepi ini).

import { formatTanggal } from "@/utils/formatDate.js";

const PRIORITY_LABEL = { NORMAL: "Normal", HIGH: "Tinggi", URGENT: "Mendesak", CRITICAL: "Kritis" };

/**
 * Ubah satu ActivityEvent (dari GET /api/activity) jadi kalimat Bahasa
 * Indonesia siap tampil. eventType yang belum dikenal TIDAK PERNAH
 * melempar error — linimasa tidak boleh gagal render gara-gara satu jenis
 * event baru yang frontend belum sempat diperbarui.
 */
export function formatActivitySentence(event) {
  const { eventType, metadata = {} } = event || {};
  switch (eventType) {
    case "PRIORITY_CHANGED":
      return `Prioritas diubah dari ${PRIORITY_LABEL[metadata.from] || "Normal"} ke ${PRIORITY_LABEL[metadata.to] || "Normal"}`;
    case "DUE_DATE_CHANGED":
      return metadata.to ? `Target produksi diatur ke ${formatTanggal(metadata.to)}` : "Target produksi dihapus";
    case "SERVICE_ASSIGNED":
      return `Layanan produksi ditetapkan: ${metadata.serviceLabel || "—"}`;
    default:
      return eventType || "Aktivitas";
  }
}
