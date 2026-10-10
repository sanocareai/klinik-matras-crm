// Logika murni antrean Penerimaan Barang Jadi Gudang (Production Workshop + Warehouse V2, P6). Custody yang sama dengan P1–P2
// (direction FINISHED_GOODS, tanpa Job pengiriman). Server menegakkan ulang semuanya (lokasi aktif + tipe, revisi, konsistensi run).

export const FG_TABS = Object.freeze([
  { key: "OFFERED", label: "Menunggu" },
  { key: "ACCEPTED", label: "Diterima" },
  { key: "REJECTED", label: "Ditolak" },
  { key: "HISTORY", label: "Riwayat" },
]);

// Lokasi tujuan barang jadi: area barang jadi atau area dispatch (mirror ALLOWED_LOCATION_TYPES.FINISHED_GOODS backend).
export const FG_LOCATION_TYPES = Object.freeze(["FINISHED_GOODS_AREA", "DISPATCH_AREA"]);

export const FG_STATUS_BADGE = Object.freeze({
  OFFERED: { variant: "warning", label: "Menunggu" },
  ACCEPTED: { variant: "success", label: "Diterima" },
  REJECTED: { variant: "danger", label: "Ditolak — kembali ke Produksi" },
  CANCELLED: { variant: "neutral", label: "Dibatalkan" },
  SUPERSEDED: { variant: "neutral", label: "Digantikan" },
});

export function fgStatusBadgeFor(status) {
  return FG_STATUS_BADGE[status] || { variant: "neutral", label: status || "—" };
}

export function isFgDecisionPending(status) { return status === "OFFERED"; }

export function locationsForFinishedGoods(locations) {
  return (locations || []).filter((l) => l?.active && FG_LOCATION_TYPES.includes(l.locationType));
}

export function validateAcceptForm({ locationId }) {
  return locationId ? { valid: true, error: null } : { valid: false, error: "Pilih lokasi penyimpanan barang jadi terlebih dahulu" };
}
export function validateRejectForm({ reason }) {
  return String(reason || "").trim().length >= 3 ? { valid: true, error: null } : { valid: false, error: "Alasan penolakan wajib diisi (minimal 3 karakter)" };
}

export function fgErrorMessage(error) {
  switch (error?.code) {
    case "CUSTODY_REVISION_CONFLICT":
    case "CUSTODY_NOT_OFFERED": return "Data sudah berubah (mungkin diproses petugas lain) — muat ulang antrean.";
    case "CUSTODY_LOCATION_INVALID": return "Lokasi tidak valid atau sudah nonaktif — pilih lokasi lain.";
    case "CUSTODY_LOCATION_TYPE_INVALID": return "Lokasi ini bukan area barang jadi/dispatch — pilih lokasi yang sesuai.";
    case "PRODUCTION_RUN_INCONSISTENT": return "Status unit tidak konsisten dengan pekerjaan produksi (kemungkinan diubah manual di V1). Hubungi Production Lead untuk rekonsiliasi.";
    case "PRODUCTION_RUN_EXCEPTION_OPEN": return "Ada konflik rekonsiliasi yang belum diselesaikan untuk unit ini.";
    case "CUSTODY_RUN_NOT_IN_HANDOFF":
    case "CUSTODY_RUN_NOT_ACTIVE": return "pekerjaan produksi tidak lagi berada di tahap handoff — muat ulang antrean.";
    case "RETURN_PENDING": return "Sisa bahan unit ini belum diterima Gudang — terima retur di Antrean Gudang (tab Retur) dulu, lalu terima barang jadi.";
    case "CUSTODY_WRITER_OFF": return "Penerimaan barang jadi V2 belum aktif untuk unit ini.";
    default: return error?.message || "Gagal memproses keputusan";
  }
}

export function fgEmptyStateCopy({ readerMode, tabKey }) {
  if (readerMode === "OFF") {
    return {
      title: "Penerimaan barang jadi belum diaktifkan",
      description: "Fitur ini sedang dalam tahap uji coba (canary). Hubungi Admin bila Anda seharusnya sudah melihat antrean di sini.",
      belumAktif: true,
    };
  }
  const label = FG_TABS.find((t) => t.key === tabKey)?.label?.toLowerCase() || "tab ini";
  return { title: `Tidak ada barang jadi di tab ${label}`, description: "Barang jadi yang lolos QC dan seluruh tahap produksinya selesai akan muncul di sini.", belumAktif: false };
}

export function acceptSummary(result, unitCode) {
  if (result?.replayed) return "Sudah diproses sebelumnya (tidak ada perubahan ganda).";
  return `Barang jadi ${unitCode} diterima — unit siap kirim.`;
}
export function rejectSummary(result, unitCode) {
  if (result?.replayed) return "Sudah diproses sebelumnya (tidak ada perubahan ganda).";
  return `Barang jadi ${unitCode} ditolak dan dikembalikan ke Produksi untuk tindakan koreksi.`;
}
