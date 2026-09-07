// Status produksi TERTURUN — satu kosakata KANONIK level-unit, dibangun DI
// ATAS ledger yang sudah ada (unit_stage_logs + blocker turunan), BUKAN
// kolom baru (D-003/PHASE-0: state halus SELALU derived, tidak pernah
// mutable column — prinsip yang sama dipakai unit_stage_logs & stock).
//
// KENAPA FILE INI ADA: sebelum Production Core, kode punya TIGA kosakata
// derived berbeda untuk pertanyaan yang mirip tapi tidak sama:
//   - resolveCurrentTarget() di unitStageEngine.js -> FIRST/READY/
//     IN_PROGRESS/BLOCKED/DONE/MISMATCH — "tahap apa yang harus ditindak
//     berikutnya", dipakai MENULIS (start/complete/dst). TIDAK diganti file
//     ini — itu tetap satu-satunya otoritas transisi.
//   - status per-tahap di GET /units/:id/timeline -> NOT_STARTED/
//     IN_PROGRESS/BLOCKED/DONE/SKIPPED — status SATU baris tahap tertentu.
//   - qcState di GET /production/qc-queue -> READY/IN_PROGRESS/BLOCKED.
// Modul ini menambah SATU kosakata level-UNIT yang konsisten untuk
// permukaan baca (board, work-order list, command center nanti) — dipakai
// bersama ketiga hal di atas, bukan pengganti.
//
// Fungsi MURNI — tidak menyentuh Prisma/database. Diberi data yang sudah
// di-load pemanggil, kembalikan status. Lihat tests/productionState.test.js.

// Nilai enum ProductionPriority (schema.prisma) — disalin sebagai array
// literal, pola yang sama dengan `SAH` di services/scopeRevision.js. Prisma
// Client di stack ini (JS, bukan TS) tidak diimpor per-enum di tempat lain
// pada repo ini; menyalin sebagai konstanta domain menjaga validasi 400
// tetap murni tanpa bergantung ke bentuk Prisma Client.
export const PRODUCTION_PRIORITY_VALUES = ["NORMAL", "HIGH", "URGENT", "CRITICAL"];

export const PRODUCTION_STATUS = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  QUEUED: "QUEUED",
  IN_PROGRESS: "IN_PROGRESS",
  // Belum ada penulisnya sampai engine pause/resume dibangun (Slice 2 —
  // StageLogAction.PAUSE ada di enum tapi belum dipakai). Nilainya
  // disediakan SEKARANG supaya kontrak API (productionStatus) tidak
  // berubah lagi nanti begitu pause/resume menyusul.
  PAUSED: "PAUSED",
  BLOCKED: "BLOCKED",
  WAITING_QC: "WAITING_QC",
  REWORK: "REWORK",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
});

// UnitStatus yang berarti "seluruh routing produksinya sudah tuntas" —
// dari sudut pandang produksi, apa pun yang terjadi SETELAH ini (customer
// hold, dalam pengiriman, terkirim) adalah urusan Logistik, bukan Bengkel.
//
// Diekspor sejak Production Core Slice 2 — lib/domain/productionExceptions.js
// (deriveOverdue, blocker eligibility) memakai definisi yang SAMA PERSIS ini
// untuk "unit ini sudah selesai secara produksi", supaya "unit yang sudah
// COMPLETED tidak overdue/tidak bisa diblokir lagi" tidak pernah punya dua
// definisi yang bisa diam-diam menyimpang.
export const PRODUCTION_COMPLETE_UNIT_STATUSES = new Set([
  "READY_FOR_DELIVERY",
  "READY_ON_CUSTOMER_HOLD",
  "IN_TRANSIT_OUT",
  "DELIVERED",
]);

// Action StageLogAction yang berarti "sedang berjalan" (open work) — dua
// nilai karena START (pertama kali) dan RESUME (setelah PAUSE) sama-sama
// membuka satu segmen kerja.
const OPEN_WORK_ACTIONS = new Set(["START", "RESUME"]);

/**
 * Turunkan productionStatus SATU unit.
 *
 * Urutan prioritas (dari yang paling menang): CANCELLED > COMPLETED >
 * BLOCKED > REWORK > WAITING_QC/IN_PROGRESS > PAUSED > NOT_STARTED >
 * QUEUED (default). Urutan ini sengaja:
 *   - status kasar unit (cancelled/selesai) selalu menang atas apa pun yang
 *     terjadi di ledger tahap.
 *   - BLOCKED menang atas REWORK kalau kebetulan dua-duanya benar (unit
 *     yang sedang dirework lalu keblok lagi, mis. bahan habis).
 *   - REWORK menang atas WAITING_QC/IN_PROGRESS SENGAJA — "kenapa unit ini
 *     ada di tahap ini LAGI" (karena QC sebelumnya gagal) lebih penting
 *     ditampilkan daripada sekadar "sedang berjalan", bahkan saat memang
 *     sedang aktif dikerjakan. isReworkTarget berhenti true dengan
 *     sendirinya begitu currentStage pindah keluar dari modul rework
 *     (lulus QC lagi), jadi status ini tidak pernah "nyangkut".
 *
 * @param {object} params
 * @param {{status:string, serviceId?:string|null, currentStageId?:string|null}} params.unit
 * @param {{action:string}|null} [params.lastLog] - log TERAKHIR untuk currentStageId unit ini, null kalau tahap ini belum pernah disentuh sama sekali
 * @param {boolean|null} [params.hasOpenBlocker] - ada blocker terbuka untuk unit ini. `null`/`undefined` = belum ada tabel blocker (Slice 1) -> fallback ke definisi lama "lastLog.action === FAIL" (D-014/unitStageEngine.js isUnitBlocked), supaya fungsi ini BENAR sebelum maupun sesudah Slice 2 (blocker lifecycle) ada.
 * @param {boolean} [params.currentStageRequiresQc] - flag requiresQc tahap sekarang
 * @param {boolean} [params.isReworkTarget] - unit sedang diarahkan ke modul rework setelah QC gagal (currentStage = modul comfort-layer hasil recordQcFitTest REWORK, DAN belum ada open-work log baru di tahap itu)
 * @returns {string} salah satu nilai PRODUCTION_STATUS
 */
export function deriveProductionStatus({
  unit,
  lastLog = null,
  hasOpenBlocker = null,
  currentStageRequiresQc = false,
  isReworkTarget = false,
} = {}) {
  if (!unit || !unit.status) throw new Error("deriveProductionStatus butuh unit.status");

  if (unit.status === "CANCELLED") return PRODUCTION_STATUS.CANCELLED;
  if (PRODUCTION_COMPLETE_UNIT_STATUSES.has(unit.status)) return PRODUCTION_STATUS.COMPLETED;

  const blocked = hasOpenBlocker != null ? hasOpenBlocker : lastLog?.action === "FAIL";
  if (blocked) return PRODUCTION_STATUS.BLOCKED;

  if (isReworkTarget) return PRODUCTION_STATUS.REWORK;

  if (OPEN_WORK_ACTIONS.has(lastLog?.action)) {
    return currentStageRequiresQc ? PRODUCTION_STATUS.WAITING_QC : PRODUCTION_STATUS.IN_PROGRESS;
  }

  if (lastLog?.action === "PAUSE") return PRODUCTION_STATUS.PAUSED;

  if (!unit.serviceId && !unit.currentStageId) return PRODUCTION_STATUS.NOT_STARTED;

  return PRODUCTION_STATUS.QUEUED;
}

// ---------------------------------------------------------------------------
// Tabel transisi — DOKUMENTASI + dukungan tes, BUKAN otoritas.
// ---------------------------------------------------------------------------
// unitStageEngine.js TETAP satu-satunya penjaga transisi legal sungguhan
// (server-side, per PRD "illegal transitions must be rejected"). Tabel di
// bawah menjawab pertanyaan yang lebih sempit: "command APA yang masuk akal
// ditawarkan UI untuk productionStatus ini" — dipakai frontend untuk
// menampilkan tombol yang tepat, dan oleh tests/productionState.test.js
// untuk mengunci kontrak itu supaya tidak diam-diam menyimpang dari engine.
export const ALLOWED_ACTIONS_BY_STATUS = {
  [PRODUCTION_STATUS.NOT_STARTED]: ["start"],
  [PRODUCTION_STATUS.QUEUED]: ["start", "skip"],
  [PRODUCTION_STATUS.IN_PROGRESS]: ["pause", "complete", "fail"],
  [PRODUCTION_STATUS.PAUSED]: ["resume"],
  [PRODUCTION_STATUS.BLOCKED]: ["start"], // retry — sama dengan startStage() setelah FAIL
  [PRODUCTION_STATUS.WAITING_QC]: ["qc", "fail"],
  [PRODUCTION_STATUS.REWORK]: ["start"],
  [PRODUCTION_STATUS.COMPLETED]: [],
  [PRODUCTION_STATUS.CANCELLED]: [],
};

/** true kalau `action` masuk akal ditawarkan untuk productionStatus `status`. */
export function nextActionAllowed(status, action) {
  return (ALLOWED_ACTIONS_BY_STATUS[status] || []).includes(action);
}

/**
 * Alasan singkat di balik `status` — dipakai board/command-center supaya
 * kartu BLOCKED langsung menunjukkan kenapa (spec: "BLOCKED cards must
 * strongly expose reason"), bukan cuma label status kosong. Sengaja HANYA
 * BLOCKED yang diisi di Slice ini — status lain belum punya sumber "alasan"
 * yang bisa dipercaya (mis. PAUSED butuh reason terstruktur yang baru
 * dibangun di Slice 2).
 *
 * Sejak Production Core Slice 2, `blocker` (baris ProductionBlocker aktif,
 * kalau ada) diutamakan atas `lastLog.blockReason` — dua-duanya SEHARUSNYA
 * selalu sama (satu failStage() menulis keduanya sekaligus), tapi blocker
 * adalah sumber kanonik ke depannya (openedAt/resolvedAt/catatan resolusi
 * ikut di sana, lastLog hanya punya blockReason mentah).
 *
 * @param {string} status - salah satu PRODUCTION_STATUS
 * @param {{blockReason?:string|null}|null} lastLog - log yang sama dipakai deriveProductionStatus
 * @param {{reason?:string|null}|null} [blocker] - baris ProductionBlocker aktif (Slice 2), opsional untuk kompatibilitas mundur
 * @returns {string|null} nilai enum BlockReason, atau null kalau tidak relevan
 */
export function describeProductionStatus(status, lastLog, blocker = null) {
  if (status === PRODUCTION_STATUS.BLOCKED) return blocker?.reason || lastLog?.blockReason || null;
  return null;
}

/**
 * true kalau QC test TERBARU unit ini gagal (bukan PAS, tanpa override
 * customer) DAN currentStage-nya sekarang adalah modul (fase MODULE) —
 * ROUTING.md §4: "QC gagal -> balik ke modul lapisan, dihitung rework".
 *
 * Definisi ini SATU-SATUNYA (Production Core Slice 2) — sebelumnya dihitung
 * inline hanya di GET /units/:id/timeline; ditarik jadi fungsi bersama
 * supaya permukaan LIST (board/work-orders/command-center) memakai definisi
 * yang SAMA PERSIS, bukan salinan kedua yang bisa diam-diam menyimpang.
 *
 * @param {object} params
 * @param {{verdict:string, customerPreferenceOverride?:string|null}|null} params.latestQc - QcFitTest TERBARU unit ini, null kalau belum pernah QC
 * @param {string|null|undefined} params.currentStagePhase - phase RoutingStage unit.currentStageId sekarang
 * @returns {boolean}
 */
export function isReworkTarget({ latestQc, currentStagePhase }) {
  return !!(
    latestQc && latestQc.verdict !== "PAS" && !latestQc.customerPreferenceOverride &&
    currentStagePhase === "MODULE"
  );
}
