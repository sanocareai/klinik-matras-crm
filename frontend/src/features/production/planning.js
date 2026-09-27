// Logika murni halaman Rencana Produksi (Production Workshop + Warehouse V2, P3). Dipisah dari
// ProductionPlanning.jsx supaya bisa diuji dengan node --test biasa (tanpa render React), pola sama dengan
// features/warehouse/unitCustody.js. Cermin aturan backend (productionPlanningCommandService.js) — kalau
// backend memperluas aturan, konstanta di sini harus disesuaikan sadar, bukan diam-diam ikut berubah.

// Tab "ANTREAN" bersumber dari GET /eligible-units (bukan status Plan); tab lain dari GET /plans?status=.
export const PLAN_TABS = Object.freeze([
  { key: "ELIGIBLE", label: "Antrean" },
  { key: "DRAFT", label: "Draf" },
  { key: "PLANNED", label: "Direncanakan" },
  { key: "MATERIAL_RESERVED", label: "Bahan Direservasi" },
  { key: "CANCELLED", label: "Dibatalkan" },
]);

export const PLAN_STATUS_BADGE = Object.freeze({
  DRAFT: { variant: "neutral", label: "Draf" },
  PLANNED: { variant: "warning", label: "Direncanakan" },
  MATERIAL_RESERVED: { variant: "success", label: "Bahan Direservasi" },
  CANCELLED: { variant: "danger", label: "Dibatalkan" },
});

export function planStatusBadgeFor(status) {
  return PLAN_STATUS_BADGE[status] || { variant: "neutral", label: status || "—" };
}

// Aturan transisi murni (cermin backend) — dipakai untuk menyembunyikan/menonaktifkan aksi yang pasti ditolak
// server, BUKAN pengganti validasi server (server tetap menegakkan ulang semuanya).
export function canAssignPlan(plan) { return !!plan && plan.status !== "CANCELLED"; }
export function canEditBOM(plan) { return !!plan && plan.status !== "CANCELLED"; }
export function canReservePlan(plan) { return !!plan && plan.status === "PLANNED"; }
export function canReleaseReservations(plan) { return !!plan && plan.status !== "CANCELLED"; }
export function canCancelPlan(plan) { return !!plan && plan.status !== "CANCELLED"; }

// Validasi target waktu form assignment (cermin backend: selesai harus setelah mulai).
export function validateAssignmentForm({ workCenterId, operatorId, targetStartAt, targetCompleteAt }) {
  const errors = {};
  if (!workCenterId) errors.workCenterId = "Workshop wajib dipilih";
  if (!operatorId) errors.operatorId = "Operator wajib dipilih";
  if (!targetStartAt) errors.targetStartAt = "Target mulai wajib diisi";
  if (!targetCompleteAt) errors.targetCompleteAt = "Target selesai wajib diisi";
  if (targetStartAt && targetCompleteAt && new Date(targetCompleteAt).getTime() <= new Date(targetStartAt).getTime()) {
    errors.targetCompleteAt = "Target selesai harus setelah target mulai";
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

// Ketersediaan bahan untuk satu baris Planned BOM, dari snapshot stok (GET /inventory/stock: balance/reserved/
// available) — dipakai editor BOM untuk menampilkan tersedia/sudah direservasi/kebutuhan/kekurangan SEBELUM
// submit (UX; keputusan sebenarnya tetap di server saat /reserve, yang juga menghitung reservasi V2 aktif).
export function bomLineAvailability(stockRow, qty) {
  const onHand = Number(stockRow?.balance ?? 0);
  const reserved = Number(stockRow?.reserved ?? 0);
  const available = stockRow?.available != null ? Number(stockRow.available) : onHand - reserved;
  const needed = Number(qty || 0);
  const shortage = Math.max(0, needed - available);
  return { onHand, reserved, available, needed, shortage, sufficient: shortage <= 1e-6 };
}

export function validateBOMLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return { valid: false, error: "Planned BOM wajib memuat minimal satu bahan" };
  const seen = new Set();
  for (const line of lines) {
    if (!line.materialId) return { valid: false, error: "Pilih material untuk setiap baris" };
    if (seen.has(line.materialId)) return { valid: false, error: "Satu material tidak boleh muncul dua kali" };
    seen.add(line.materialId);
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty <= 0) return { valid: false, error: "Jumlah bahan wajib lebih dari nol" };
  }
  return { valid: true, error: null };
}

// readerMode datang dari server: "OFF" = fitur belum diaktifkan untuk siapa pun (fail-closed, bukan error).
export function emptyStateCopy({ readerMode, tabKey }) {
  if (readerMode === "OFF") {
    return {
      title: "Rencana produksi belum diaktifkan",
      description: "Fitur ini sedang dalam tahap uji coba (canary). Hubungi Admin bila Anda seharusnya sudah melihat rencana di sini.",
      belumAktif: true,
    };
  }
  const label = PLAN_TABS.find((tab) => tab.key === tabKey)?.label?.toLowerCase() || "tab ini";
  return { title: `Tidak ada unit/rencana di tab ${label}`, description: "Unit yang sudah punya custody/lokasi sah akan muncul di antrean.", belumAktif: false };
}
