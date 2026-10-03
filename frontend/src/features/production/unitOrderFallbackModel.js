// P12B.4 — model murni (tanpa JSX) isi fallback Unit 360 untuk unit non-V2; import relatif supaya dapat diuji `node --test`.
import { formatTanggal } from "../../utils/formatDate.js";
import { formatUkuranLabel } from "../../utils/ukuranKasur.js";
import { PRODUCTION_PRIORITY_REAL, PRODUCTION_STATUS_REAL, SERVICE_LINE_REAL, UNIT_STATUS_REAL } from "../bengkel/unitStatus.js";

export const V2_SECTIONS_UNAVAILABLE = Object.freeze([
  ["Proses", "diagnosis dan tahap kerja Production V2"],
  ["Bahan", "reservasi, penyerahan, dan retur bahan"],
  ["Dokumentasi", "12 kategori foto dokumentasi"],
  ["QC & Handoff", "putusan QC dan serah-terima barang jadi"],
  ["Aktivitas", "jejak aktivitas Production V2"],
]);

export const dash = (v) => (v === null || v === undefined || v === "" ? "—" : v);

// Susunan fakta (murni, diuji): hanya data yang benar-benar ada pada unit; yang kosong tampil "—", tidak ditebak.
export function unitFacts(t) {
  const u = t?.unit || {};
  return [
    ["Order", u.order?.orderNumber],
    ["Pelanggan", u.order?.customer?.name],
    ["Kasur", [u.merk, formatUkuranLabel(u.ukuran)].filter(Boolean).join(" · ") || null],
    ["Lini", u.serviceLine ? (SERVICE_LINE_REAL[u.serviceLine]?.label || u.serviceLine) : null],
    ["Layanan", u.service?.labelId],
    ["Status unit", UNIT_STATUS_REAL[u.status]?.label || u.status],
    ["Progres produksi", t?.productionStatus ? (PRODUCTION_STATUS_REAL[t.productionStatus]?.label || t.productionStatus) : null],
    ["Tahap sekarang", u.currentStage?.labelId],
    ["Prioritas", u.priority && u.priority !== "NORMAL" ? (PRODUCTION_PRIORITY_REAL[u.priority]?.label || u.priority) : "Normal"],
    ["Target selesai", u.productionDueAt ? formatTanggal(u.productionDueAt) : null],
    ["Update terakhir", u.updatedAt ? formatTanggal(u.updatedAt) : null],
  ];
}

