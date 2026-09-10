// Status & jenis Revisi — enum NYATA dari backend (RevisionStatus/
// RevisionTrigger di prisma/schema.prisma), pola yang sama dengan
// podStatus.js/issueStatus.js.
//
// ⚠️ Ini BUKAN "Retur" dalam arti refund/replace/reject — lihat catatan
// panjang di schema.prisma model UnitRevision. Kalau customer merasa
// tekstur kasur kurang pas (trial 7/30 hari) atau ada klaim garansi
// amblas (10/20 tahun), tim membawa kembali kasurnya, merevisi, lalu
// mengantar ulang — diulang sampai customer bilang "yes".
export const REVISION_STATUS = {
  REQUESTED:        { label: "Diajukan",              tone: "neutral" },
  PICKUP_SCHEDULED: { label: "Jemput Dijadwalkan",     tone: "accent" },
  IN_REWORK:        { label: "Sedang Direvisi",        tone: "orange" },
  READY_REDELIVER:  { label: "Siap Antar Ulang",       tone: "accent" },
  REDELIVERED:      { label: "Sudah Diantar Ulang",    tone: "accent" },
  CONFIRMED:        { label: "Selesai (Customer OK)",  tone: "green" },
  CANCELLED:        { label: "Dibatalkan",             tone: "red" },
};

// KOMPLAIN_ANTAR (10 September 2026, kasus Richard RES-30082026-201) —
// customer QC di tempat SAAT serah terima & minta revisi HARI ITU JUGA,
// beda dari KENYAMANAN (baru ketahuan setelah trial berhari-hari) atau
// GARANSI (klaim bertahun-tahun kemudian).
export const REVISION_TRIGGER = {
  KENYAMANAN:     { label: "Trial Kenyamanan",    tone: "accent" },
  GARANSI:        { label: "Klaim Garansi",       tone: "orange" },
  KOMPLAIN_ANTAR: { label: "Komplain Saat Antar", tone: "red" },
};

export function customerOfUnit(unit) {
  return unit?.order?.customer?.name || null;
}
