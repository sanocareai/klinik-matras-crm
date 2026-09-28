// Logika murni Eksekusi Workshop (Production Workshop + Warehouse V2, P5). Dipisah dari halaman JSX supaya bisa diuji
// dengan node --test biasa. Cermin aturan backend (productionWorkshopExecutionCommandService.js) — server tetap
// menegakkan ulang semuanya (material ISSUED, operator/work center, urutan tahap, satu tahap aktif, revisi).

export const QUEUE_SCOPES = Object.freeze([
  { key: "today", label: "Hari Ini" },
  { key: "all", label: "Semua" },
]);

export const RUN_STATE_BADGE = Object.freeze({
  READY_TO_START: { variant: "warning", label: "Siap Dimulai" },
  IN_PROGRESS: { variant: "info", label: "Sedang Dikerjakan" },
  PAUSED: { variant: "neutral", label: "Dijeda" },
  AWAITING_QC: { variant: "success", label: "Menunggu QC" },
});

export function runStateBadgeFor(state) {
  return RUN_STATE_BADGE[state] || { variant: "neutral", label: state || "—" };
}

export const STAGE_STATUS_LABEL = Object.freeze({
  NOT_STARTED: "Belum Dimulai",
  ACTIVE: "Berjalan",
  PAUSED: "Dijeda",
  COMPLETED: "Selesai",
});

// Alasan jeda yang diterima server (lib/domain/stageExecution.js). Kendala eksternal BUKAN jeda — pakai "Tandai Terhambat".
export const PAUSE_REASONS = Object.freeze([
  { value: "BREAK", label: "Istirahat" },
  { value: "PROCESS_DELAY", label: "Proses tertunda" },
  { value: "OTHER", label: "Lainnya (wajib catatan)" },
]);

export const HISTORY_ACTION_LABEL = Object.freeze({
  START: "Mulai", PAUSE: "Jeda", RESUME: "Lanjutkan", COMPLETE: "Selesai tahap", FAIL: "Gagal", SKIP: "Dilewati",
});

export function historyActionLabel(action) { return HISTORY_ACTION_LABEL[action] || action || "—"; }

// Aksi yang tersedia untuk sebuah run (state dari server). Tahap terakhir yang selesai -> Menunggu QC: tidak ada aksi
// (PASS QC / siap kirim adalah P6, bukan tugas layar ini).
export function availableActions(run) {
  const state = run?.state;
  const materialReady = run?.material ? !!run.material.ready : true;
  return {
    start: state === "READY_TO_START" && materialReady,
    pause: state === "IN_PROGRESS",
    resume: state === "PAUSED",
    complete: state === "IN_PROGRESS",
  };
}

export function startBlockedReason(run) {
  if (!run) return null;
  if (run.state === "AWAITING_QC") return "Seluruh tahap workshop selesai — unit menunggu QC.";
  if (run.state === "READY_TO_START" && run.material && !run.material.ready) {
    return `Belum bisa dimulai: ${run.material.reason || "bahan belum diserahkan Gudang"}.`;
  }
  return null;
}

export function currentStageOf(run) {
  return (run?.stages || []).find((s) => s.status === "ACTIVE" || s.status === "PAUSED") || null;
}

// Tahap berikutnya yang akan dimulai (pertama yang belum dimulai) — untuk label tombol "Mulai <tahap>".
export function nextStageOf(run) {
  return (run?.stages || []).find((s) => s.status === "NOT_STARTED") || null;
}

export function stageProgress(run) {
  const stages = run?.stages || [];
  const done = stages.filter((s) => s.status === "COMPLETED").length;
  return { done, total: stages.length, percent: stages.length ? Math.round((done / stages.length) * 100) : 0 };
}

// Validasi form Jeda: alasan wajib; "Lainnya" wajib catatan >= 3 karakter (sama dengan server).
export function validatePauseForm({ reason, note }) {
  if (!reason) return { valid: false, error: "Alasan jeda wajib dipilih" };
  if (!PAUSE_REASONS.some((r) => r.value === reason)) return { valid: false, error: "Alasan jeda tidak dikenal" };
  if (reason === "OTHER" && (!note || note.trim().length < 3)) return { valid: false, error: 'Alasan "Lainnya" wajib disertai catatan yang jelas' };
  return { valid: true, error: null };
}

// Selesai tahap: foto wajib bila tahap meminta (requiresPhoto).
export function validateCompleteForm({ stage, photoUrls = [] }) {
  if (stage?.requiresPhoto && photoUrls.length === 0) return { valid: false, error: "Tahap ini wajib dilengkapi foto" };
  return { valid: true, error: null };
}

// Pesan galat Indonesia untuk kode server yang relevan — sisanya memakai pesan server apa adanya.
export function workshopErrorMessage(error) {
  switch (error?.code) {
    case "WORKSHOP_REVISION_CONFLICT": return "Data sudah berubah (mungkin diproses petugas lain) — muat ulang detail.";
    case "WORKSHOP_MATERIAL_NOT_ISSUED": return "Bahan belum diserahkan Gudang — produksi belum bisa dimulai.";
    case "WORKSHOP_OPERATOR_MISMATCH": return "Anda bukan operator yang ditugaskan pada rencana ini.";
    case "WORKSHOP_WORK_CENTER_MISMATCH": return "Workshop tidak sesuai dengan rencana produksi.";
    case "WORKSHOP_STAGE_ALREADY_ACTIVE": return "Masih ada tahap yang berjalan/dijeda — selesaikan atau lanjutkan tahap itu dulu.";
    case "WORKSHOP_AWAITING_QC": return "Seluruh tahap workshop sudah selesai; unit menunggu QC.";
    case "WORKSHOP_PAUSE_REASON_INVALID": return error.message || "Alasan jeda tidak valid.";
    case "WORKSHOP_WRITER_OFF": return "Eksekusi workshop V2 belum aktif untuk unit ini.";
    default: return error?.message || "Gagal memproses perintah";
  }
}

export function emptyStateCopy({ readerMode, scope }) {
  if (readerMode === "OFF") {
    return {
      title: "Eksekusi workshop belum diaktifkan",
      description: "Fitur ini sedang dalam tahap uji coba (canary). Hubungi Admin bila Anda seharusnya sudah melihat antrean di sini.",
      belumAktif: true,
    };
  }
  return scope === "today"
    ? { title: "Tidak ada pekerjaan untuk hari ini", description: "Unit yang bahannya sudah diserahkan Gudang dan target mulainya hari ini akan muncul di sini.", belumAktif: false }
    : { title: "Antrean kerja kosong", description: "Unit yang bahannya sudah diserahkan Gudang akan muncul di sini.", belumAktif: false };
}
