// Pemisahan tugas penyesuaian stok — SATU tempat aturan "pemohon != penyetuju" dan "penyetuju wajib peran penyetuju".
// Dipakai dua jalur yang menulis movement ADJUSTMENT: Stock Adjustment (APPROVED) dan Stock Count (complete dengan selisih).
// Koreksi satu-langkah POST /inventory/movements/adjustment DITUTUP untuk semua peran (tidak ada penulisan ledger di sana).
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";

export class SegregationError extends Error {
  constructor(message, code) { super(message); this.statusCode = 403; this.code = code; }
}

/** Pelaku wajib pemegang INVENTORY_ADJUSTMENT_APPROVE. */
export function wajibPenyetujuPenyesuaian(user) {
  if (!hasPermission(user, P.INVENTORY_ADJUSTMENT_APPROVE)) {
    throw new SegregationError("Persetujuan penyesuaian stok hanya oleh peran penyetuju (Owner/Finance), bukan peran yang menulis ledger", "BUKAN_PENYETUJU");
  }
}

/** Pelaku tidak boleh sama dengan salah satu pihak yang mengajukan/menghitung. */
export function wajibBukanPihakPengaju(user, pihakIds, { label = "pemohon" } = {}) {
  const ids = pihakIds.filter(Boolean);
  if (user?.id && ids.includes(user.id)) {
    throw new SegregationError(`Anda adalah ${label} dokumen ini — persetujuan harus oleh orang lain`, "PENYETUJU_SAMA_DENGAN_PENGAJU");
  }
}
