// P12B.4 — model murni (tanpa JSX) isi fallback Unit 360 untuk unit non-V2; import relatif supaya dapat diuji `node --test`.
import { formatTanggal } from "../../utils/formatDate.js";
import { formatUkuranLabel } from "../../utils/ukuranKasur.js";
import { PRODUCTION_STATUS_REAL, UNIT_STATUS_REAL } from "../bengkel/unitStatus.js";

// Bagian yang tersedia setelah unit masuk rencana produksi (tanpa menyebut jalur teknis V1/V2).
export const V2_SECTIONS_UNAVAILABLE = Object.freeze([
  ["Proses", "diagnosis dan tahap kerja"],
  ["Bahan", "reservasi, penyerahan, dan retur bahan"],
  ["Dokumentasi", "12 kategori foto dokumentasi"],
  ["QC & Handoff", "putusan QC dan serah-terima barang jadi"],
  ["Aktivitas", "jejak aktivitas pekerjaan"],
]);

export const dash = (v) => (v === null || v === undefined || v === "" ? "—" : v);

// Susunan fakta (murni, diuji): hanya data yang benar-benar ada pada unit; yang kosong tampil "—", tidak ditebak. Layanan, prioritas, dan target TIDAK ada di sini
// (ditampilkan sekali di UnitV1Actions — tanpa duplikasi).
export function unitFacts(t) {
  const u = t?.unit || {};
  return [
    ["Order", u.order?.orderNumber],
    ["Pelanggan", u.order?.customer?.name],
    ["Kasur", [u.merk, formatUkuranLabel(u.ukuran)].filter(Boolean).join(" · ") || null],
    ["Status unit", UNIT_STATUS_REAL[u.status]?.label || u.status],
    ["Progres produksi", t?.productionStatus ? (PRODUCTION_STATUS_REAL[t.productionStatus]?.label || t.productionStatus) : null],
    ["Tahap sekarang", u.currentStage?.labelId],
    ["Update terakhir", u.updatedAt ? formatTanggal(u.updatedAt) : null],
  ];
}

