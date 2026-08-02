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

export const REVISION_TRIGGER = {
  KENYAMANAN: { label: "Trial Kenyamanan", tone: "accent" },
  GARANSI:    { label: "Klaim Garansi",    tone: "orange" },
};

export function customerOfUnit(unit) {
  return unit?.order?.customer?.name || null;
}
