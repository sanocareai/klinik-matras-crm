// Status Pengajuan Biaya (web) — label, badge, filter, aturan edit, dan riwayat revisi. Murni tanpa React
// supaya mudah diuji. Aturan edit MENGIKUTI kontrak backend (services/expenseSubmission/service.js):
//   edit + ajukan = DRAFT atau PERLU_REVISI; tarik = MENUNGGU_PERSETUJUAN; batalkan = DRAFT, PERLU_REVISI,
//   atau MENUNGGU_PERSETUJUAN (sebelum ada FinExpense final). Halaman ini TIDAK menambah mutation baru.

export const STATUS_LABEL = {
  DRAFT: "Draf",
  PERLU_REVISI: "Perlu Revisi",
  MENUNGGU_PERSETUJUAN: "Menunggu Persetujuan",
  OTOMATIS_DISETUJUI: "Disetujui Otomatis",
  DISETUJUI: "Disetujui",
  DIBAYAR: "Dibayar",
  DITOLAK: "Ditolak",
  DIBATALKAN: "Dibatalkan",
};

export const STATUS_VARIANT = {
  DRAFT: "neutral",
  PERLU_REVISI: "orange",
  MENUNGGU_PERSETUJUAN: "orange",
  OTOMATIS_DISETUJUI: "green",
  DISETUJUI: "accent",
  DIBAYAR: "green",
  DITOLAK: "red",
  DIBATALKAN: "neutral",
};

export const STATUS_FILTERS = ["", "DRAFT", "PERLU_REVISI", "MENUNGGU_PERSETUJUAN", "OTOMATIS_DISETUJUI", "DISETUJUI", "DIBAYAR", "DITOLAK", "DIBATALKAN"];

/** Label aman: status yang belum dikenal klien tetap tampil sebagai teks wajar, tidak pernah memecahkan halaman. */
export function statusLabel(status) {
  if (!status) return "—";
  return STATUS_LABEL[status] || `Status tidak dikenal (${status})`;
}

export function statusVariant(status) {
  return STATUS_VARIANT[status] || "neutral";
}

/** Pemohon boleh mengedit / mengajukan (ulang). */
export function bolehEditAjukan(status) {
  return status === "DRAFT" || status === "PERLU_REVISI";
}

export function bolehTarik(status) {
  return status === "MENUNGGU_PERSETUJUAN";
}

export function bolehBatalkan(status) {
  return status === "DRAFT" || status === "PERLU_REVISI";
}

export function labelAjukan(status) {
  return status === "PERLU_REVISI" ? "Ajukan Ulang" : "Ajukan";
}

/** Kalimat Indonesia untuk satu baris audit. */
export function deskripsiAudit(a) {
  const alasan = a.reason ? ` — ${a.reason}` : "";
  if (a.field === "status") {
    if (a.after === "PERLU_REVISI") return `Diminta revisi${alasan}`;
    if (a.after === "MENUNGGU_PERSETUJUAN") return a.before === "PERLU_REVISI" ? "Diajukan ulang setelah revisi" : "Diajukan";
    if (a.after === "DRAFT") return a.before == null ? "Draf dibuat" : "Ditarik kembali oleh pemohon";
    if (a.after === "DIBATALKAN") return `Dibatalkan${alasan}`;
    if (a.after === "OTOMATIS_DISETUJUI") return `Disetujui otomatis${alasan}`;
    return `Status menjadi ${statusLabel(a.after)}${alasan}`;
  }
  if (a.field === "draft") return a.reason === "Perbaikan setelah diminta revisi" ? "Diperbaiki setelah diminta revisi" : "Draf diubah";
  if (a.field === "bukti") return `Foto struk diunggah${a.after ? ` (${a.after})` : ""}`;
  return `Koreksi ${a.field}: "${a.before || "-"}" menjadi "${a.after || "-"}"${alasan}`;
}

/**
 * Histori revisi dari audit trail (urut lama -> baru): permintaan revisi (siapa, kapan, alasan) dan
 * pengajuan ulang setelahnya. Dibedakan dari tarik/batalkan yang bukan bagian riwayat revisi.
 */
export function riwayatRevisi(auditTrail = []) {
  return [...auditTrail]
    .filter((a) => a.field === "status" && (a.after === "PERLU_REVISI" || a.before === "PERLU_REVISI"))
    .sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt))
    .map((a) => (a.after === "PERLU_REVISI"
      ? { jenis: "diminta", waktu: a.createdAt, oleh: a.actor?.name || null, alasan: a.reason || null }
      : a.after === "MENUNGGU_PERSETUJUAN"
        ? { jenis: "diajukan-ulang", waktu: a.createdAt, oleh: a.actor?.name || null, alasan: null }
        : { jenis: "diakhiri", waktu: a.createdAt, oleh: a.actor?.name || null, alasan: a.reason || null }));
}
