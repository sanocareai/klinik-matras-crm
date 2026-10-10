// Invariant lifecycle fase Production Run V2 (production_phase_runs_v2). SATU-SATUNYA penulis transisi fase (update) untuk command P1–P6.
//
// Aturan (berlaku untuk run BARU: origin CUSTODY_PICKUP / WORKSHOP_BORN; run legacy/backfill — origin NULL / migrationSource terisi — TIDAK
// disentuh dan tidak diperiksa):
//  1. Paling banyak SATU fase "berjalan" (ACTIVE/BLOCKED) per run. Perpindahan fase = menutup fase sebelumnya DAN membuka berikutnya dalam SATU
//     panggilan transitionPhases (transaksi pemanggil): penutupan ditulis lebih dulu, lalu keadaan akhir divalidasi. Melanggar -> 409, rollback.
//  2. Run TIDAK boleh COMPLETED bila masih ada fase non-terminal (NOT_STARTED/ACTIVE/BLOCKED/MIGRATION_REVIEW) atau HANDOFF belum COMPLETED
//     (assertRunPhasesTerminal). TIDAK ada auto-close: fase yang tertinggal = bug sumber transisi -> ditolak 409, bukan disembunyikan.
//  3. Penutupan lewat ACCEPT_OVERRIDE (override manual V1) menandai fase sisa NOT_APPLICABLE secara eksplisit dengan alasan (requireHandoffCompleted:false).
// Modul ini hanya menulis lewat transaksi (tx) milik pemanggil.

export const PHASE_TERMINAL_STATUSES = Object.freeze(["COMPLETED", "NOT_APPLICABLE", "CANCELLED"]);
export const PHASE_IN_PROGRESS_STATUSES = Object.freeze(["ACTIVE", "BLOCKED"]);
export const PHASE_ORDER = Object.freeze(["INTAKE", "DIAGNOSIS", "PROCESS", "QC", "HANDOFF"]);

function lifecycleError(message, code, details) {
  return Object.assign(new Error(message), { statusCode: 409, code, ...(details ? { details } : {}) });
}

// Run baru (bukan legacy/backfill) — satu-satunya yang diperiksa invariant-nya.
export function isStrictLifecycleRun(run) {
  return Boolean(run?.origin) && !run?.migrationSource;
}

export const inProgressPhases = (phases) => phases.filter((p) => PHASE_IN_PROGRESS_STATUSES.includes(p.status)).map((p) => p.phase);
export const nonTerminalPhases = (phases) => phases.filter((p) => !PHASE_TERMINAL_STATUSES.includes(p.status)).map((p) => p.phase);

// Murni: keadaan fase setelah `updates` diterapkan. updates: [{ phase, data: { status?, ... } }].
export function projectPhases(phases, updates) {
  const byPhase = new Map(phases.map((p) => [p.phase, { ...p }]));
  for (const { phase, data } of updates) {
    const current = byPhase.get(phase);
    if (!current) throw lifecycleError(`Fase ${phase} tidak ada pada run ini`, "PHASE_MISSING", { phase });
    byPhase.set(phase, { ...current, ...data });
  }
  return [...byPhase.values()];
}

// Murni: pelanggaran invariant 1 pada keadaan akhir (null bila sah).
export function findPhaseInvariantViolation(phases) {
  const running = inProgressPhases(phases);
  if (running.length > 1) return { code: "PHASE_MULTIPLE_IN_PROGRESS", phases: running };
  return null;
}

// Murni: syarat penyelesaian run (invariant 2). requireHandoffCompleted=false hanya untuk penutupan override V1 eksplisit.
export function findRunCompletionViolation(phases, { requireHandoffCompleted = true } = {}) {
  const open = nonTerminalPhases(phases);
  if (open.length) return { code: "RUN_PHASES_NOT_TERMINAL", phases: open };
  if (requireHandoffCompleted && phases.find((p) => p.phase === "HANDOFF")?.status !== "COMPLETED") return { code: "RUN_HANDOFF_NOT_COMPLETED", phases: ["HANDOFF"] };
  return null;
}

// Terapkan transisi fase secara atomik dalam tx pemanggil. Baris fase dibaca ULANG (bukan snapshot lama) supaya perubahan sebelumnya pada
// command yang sama ikut terhitung. Run legacy: penulisan tetap dilakukan tanpa pemeriksaan (perilaku lama).
export async function transitionPhases(tx, runId, updates) {
  const run = await tx.productionRun.findUnique({ where: { id: runId }, select: { id: true, origin: true, migrationSource: true, phases: true } });
  if (!run) throw lifecycleError("Pekerjaan produksi tidak ditemukan untuk transisi fase", "PHASE_RUN_NOT_FOUND");
  if (isStrictLifecycleRun(run)) {
    const violation = findPhaseInvariantViolation(projectPhases(run.phases, updates));
    if (violation) {
      throw lifecycleError("Perpindahan fase ditolak: satu fase harus ditutup sebelum fase berikutnya dibuka (hanya satu fase berjalan per run)", violation.code, { phases: violation.phases });
    }
  }
  // Penutupan (status terminal) ditulis lebih dulu daripada pembukaan, mengikuti urutan input di dalam tiap kelompok.
  const isClosing = ({ data }) => data?.status !== undefined && PHASE_TERMINAL_STATUSES.includes(data.status);
  for (const update of [...updates.filter(isClosing), ...updates.filter((u) => !isClosing(u))]) {
    await tx.productionPhaseRun.update({ where: { runId_phase: { runId, phase: update.phase } }, data: update.data });
  }
}

// Panggil SEBELUM productionRun.status = COMPLETED (dan sesudah fase HANDOFF ditutup dalam transaksi yang sama). Run legacy: tidak diperiksa.
export async function assertRunPhasesTerminal(tx, runId, { requireHandoffCompleted = true } = {}) {
  const run = await tx.productionRun.findUnique({ where: { id: runId }, select: { id: true, origin: true, migrationSource: true, phases: true } });
  if (!run) throw lifecycleError("Pekerjaan produksi tidak ditemukan untuk pemeriksaan penyelesaian", "PHASE_RUN_NOT_FOUND");
  if (!isStrictLifecycleRun(run)) return;
  const violation = findRunCompletionViolation(run.phases, { requireHandoffCompleted });
  if (violation) {
    throw lifecycleError(
      "Production Run belum boleh diselesaikan: masih ada fase yang belum tertutup atau Handoff belum selesai — hubungi Production Lead",
      violation.code, { phases: violation.phases },
    );
  }
}

// Pemeriksaan DINI (sebelum menulis apa pun) untuk keputusan Gudang atas barang jadi: hanya HANDOFF yang boleh masih berjalan; fase lain sudah terminal.
export function assertPhasesReadyForHandoffDecision(run) {
  if (!isStrictLifecycleRun(run)) return;
  const others = run.phases.filter((p) => p.phase !== "HANDOFF");
  const open = others.filter((p) => !PHASE_TERMINAL_STATUSES.includes(p.status)).map((p) => p.phase);
  if (open.length) {
    throw lifecycleError("Keputusan Gudang ditolak: masih ada fase Production yang belum tertutup — hubungi Production Lead", "RUN_PHASES_NOT_TERMINAL", { phases: open });
  }
}
