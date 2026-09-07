// Eksekusi tahap produksi — Production Core Slice 3.
//
// CORE DESIGN: unit_stage_logs SUDAH menjadi ledger APPEND-ONLY per-aksi
// (satu baris BARU untuk tiap START/PAUSE/RESUME/COMPLETE/FAIL/SKIP, TIDAK
// PERNAH di-UPDATE) — audit STEP 0 (lihat unitStageEngine.js) membuktikan
// ini SUDAH secara struktural sanggup merepresentasikan banyak siklus
// pause/resume sebagai baris tambahan, TANPA model baru (StageExecutionEvent
// dkk). File ini murni lapisan INTERPRETASI di atas baris-baris itu — tidak
// menyentuh Prisma, tidak menyentuh database.
//
// KOSAKATA:
//   ATTEMPT = satu percobaan mengerjakan satu tahap: dimulai dari SATU baris
//     START, berisi nol atau lebih pasangan PAUSE/RESUME, dan (mungkin)
//     ditutup oleh SATU baris terminal (COMPLETE/FAIL/SKIP). Attempt TERAKHIR
//     boleh masih TERBUKA (belum ada baris terminal) — itu attempt yang
//     sedang berjalan/dijeda SEKARANG.
//   TOUCH TIME  = total waktu SEDANG AKTIF dikerjakan (bukan dijeda).
//   PAUSED TIME = total waktu ANTARA PAUSE dan RESUME berikutnya.
//   ELAPSED     = touch + paused = rentang wall-clock dari START sampai
//     selesai/sekarang.

export const PAUSE_REASON_VALUES = ["BREAK", "PROCESS_DELAY", "OTHER"];

// blockReason yang SERING disalahartikan sebagai "alasan jeda" — ditolak
// eksplisit di validatePauseReason() dengan pesan yang mengarahkan ke jalur
// yang benar (Block Production), BUKAN diam-diam diterima sebagai pause.
// Ini Arsitektur PILIHAN A dari spec Slice 3C: pause TIDAK PERNAH boleh
// merepresentasikan kendala eksternal — enum PauseReason di schema.prisma
// bahkan tidak punya nilai untuk ini sama sekali (larangan di level skema),
// daftar di bawah HANYA untuk pesan error yang membantu kalau kliennya
// (frontend lama/klien luar) tetap mengirim salah satu nilai BlockReason ini.
const BLOCKER_LIKE_REASONS = new Set([
  "MATERIAL_SHORTAGE", "AWAITING_CUSTOMER_APPROVAL", "MACHINE_DOWN",
  "AWAITING_CUSTOMER", "AWAITING_OPERATOR", "AWAITING_TOOL",
]);

/**
 * Validasi PAUSE (spec Slice 3C/3N) — fungsi MURNI, pola sama dengan
 * validateBlockReason() di productionExceptions.js.
 *
 * @param {object} params
 * @param {string} params.reason
 * @param {string|null|undefined} params.note
 * @returns {string|null} pesan error, atau null kalau valid
 */
export function validatePauseReason({ reason, note }) {
  if (!reason) return "Alasan jeda wajib diisi";
  if (BLOCKER_LIKE_REASONS.has(reason)) {
    return 'Alasan ini adalah BLOKIR operasional, bukan jeda terkendali — gunakan "Tandai Terhambat" (Block Production), bukan Jeda';
  }
  if (!PAUSE_REASON_VALUES.includes(reason)) {
    return `Alasan jeda harus salah satu dari: ${PAUSE_REASON_VALUES.join(", ")}`;
  }
  if (reason === "OTHER" && (!note || note.trim().length < 3)) {
    return 'Alasan jeda "OTHER" wajib disertai catatan yang jelas';
  }
  return null;
}

// Aksi yang berarti "sedang berjalan aktif" — RESUME sama dengan START,
// dua-duanya membuka SATU segmen kerja baru.
const OPEN_WORK_ACTIONS = new Set(["START", "RESUME"]);
const TERMINAL_ACTIONS = new Set(["COMPLETE", "FAIL", "SKIP"]);

/**
 * Ubah satu baris UnitStageLog jadi event ternormalisasi untuk
 * computeExecutionTiming(). SATU aturan kunci: untuk baris SELAIN START,
 * timestamp yang dipakai SELALU `createdAt` (kapan transisi itu SUNGGUH
 * terjadi — selalu ada, selalu real). Untuk START, dipakai `startedAt` KALAU
 * ada; kalau tidak (recordStageDone retrospektif menulis startedAt: null
 * saat tidak ada START real yang bisa dipasangkan — lihat
 * unitStageEngine.js), `timingKnown` jadi false dan SELURUH rekonstruksi
 * attempt ini WAJIB mengembalikan "tidak diketahui", bukan mengarang angka.
 *
 * @param {{action:string, startedAt?:Date|string|null, createdAt:Date|string}} row
 */
export function toExecutionEvent(row) {
  if (row.action === "START") {
    const known = !!row.startedAt;
    return { type: "START", at: new Date(known ? row.startedAt : row.createdAt), timingKnown: known };
  }
  return { type: row.action, at: new Date(row.createdAt), timingKnown: true };
}

/**
 * Rekonstruksi ELAPSED/TOUCH/PAUSED satu attempt dari deretan event
 * ternormalisasi (SUDAH terurut kronologis, event pertama HARUS START).
 * Fungsi MURNI — tidak menyentuh database/Date.now() kecuali lewat `now`.
 *
 * ATURAN LEGACY (spec "LEGACY EXECUTION COMPATIBILITY"): kalau timing
 * attempt ini TIDAK diketahui (START retrospektif tanpa startedAt asli),
 * SELURUH angka dikembalikan `null` + `timingKnown:false` — TIDAK PERNAH
 * fallback ke 0, supaya "0 menit" tidak pernah disalahartikan sebagai
 * "memang secepat itu".
 *
 * Kalau attempt SUDAH selesai (event terakhir COMPLETE/FAIL/SKIP) TAPI
 * tidak pernah ada PAUSE/RESUME sama sekali (kondisi SEMUA data lama
 * sebelum Slice 3), hasilnya otomatis touch = elapsed, paused = 0 — bukan
 * kasus khusus, murni konsekuensi alami loop di bawah (tidak ada segmen
 * yang "hilang").
 *
 * @param {object} params
 * @param {{type:string, at:Date, timingKnown:boolean}[]} params.events
 * @param {Date} [params.now]
 * @returns {{elapsedSeconds:number|null, touchSeconds:number|null, pausedSeconds:number|null, currentlyPaused:boolean, timingKnown:boolean}}
 */
export function computeExecutionTiming({ events, now = new Date() }) {
  const unknown = { elapsedSeconds: null, touchSeconds: null, pausedSeconds: null, currentlyPaused: false, timingKnown: false };
  if (!events || events.length === 0) return unknown;

  const start = events[0];
  if (start.type !== "START" || !start.timingKnown) return unknown;

  let touchSeconds = 0;
  let pausedSeconds = 0;
  let segmentStart = start.at;
  let currentlyPaused = false;
  let terminalAt = null;

  for (let i = 1; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === "PAUSE") {
      if (!currentlyPaused) touchSeconds += (ev.at - segmentStart) / 1000;
      segmentStart = ev.at;
      currentlyPaused = true;
    } else if (ev.type === "RESUME") {
      if (currentlyPaused) pausedSeconds += (ev.at - segmentStart) / 1000;
      segmentStart = ev.at;
      currentlyPaused = false;
    } else if (TERMINAL_ACTIONS.has(ev.type)) {
      if (!currentlyPaused) touchSeconds += (ev.at - segmentStart) / 1000;
      // Kalau attempt ditutup SAAT sedang paused (seharusnya tidak terjadi —
      // engine mewajibkan resume dulu sebelum complete/fail — tapi kalau
      // data lama/anomali punya urutan begini, waktu jeda sampai penutupan
      // TETAP dihitung sebagai paused, bukan hilang).
      if (currentlyPaused) pausedSeconds += (ev.at - segmentStart) / 1000;
      terminalAt = ev.at;
      segmentStart = ev.at;
    }
  }

  if (!terminalAt) {
    // Attempt masih terbuka — segmen SEKARANG dihitung sampai `now`.
    if (currentlyPaused) pausedSeconds += (now - segmentStart) / 1000;
    else touchSeconds += (now - segmentStart) / 1000;
  }

  const endAt = terminalAt || now;
  return {
    elapsedSeconds: Math.max(0, Math.round((endAt - start.at) / 1000)),
    touchSeconds: Math.max(0, Math.round(touchSeconds)),
    pausedSeconds: Math.max(0, Math.round(pausedSeconds)),
    currentlyPaused: !terminalAt && currentlyPaused,
    timingKnown: true,
  };
}

/**
 * Pecah SELURUH baris ledger satu (unit, stage) — SUDAH terurut kronologis
 * ASC — jadi daftar attempt. Attempt baru dimulai di setiap baris START;
 * baris lain menempel ke attempt yang sedang terbuka. Attempt TERAKHIR
 * boleh tidak punya baris terminal (masih berjalan/dijeda).
 *
 * Baris yang bukan START dan muncul SEBELUM ada START sama sekali diabaikan
 * (defensif — seharusnya mustahil terjadi lewat engine ini, tapi fungsi ini
 * tidak boleh crash kalau suatu saat data historis ternyata janggal).
 *
 * @param {object[]} rows - baris UnitStageLog SATU (unitId, stageId), urut createdAt ASC
 * @returns {{events: object[]}[]}
 */
export function groupIntoAttempts(rows) {
  const attempts = [];
  let current = null;
  for (const row of rows) {
    if (row.action === "START") {
      current = { events: [row] };
      attempts.push(current);
    } else if (current) {
      current.events.push(row);
    }
  }
  return attempts;
}

/**
 * Status EKSEKUSI satu attempt — kosakata level-TAHAP (BUKAN
 * PRODUCTION_STATUS level-unit di productionState.js; lihat catatan di sana
 * soal kenapa dua kosakata ini terpisah). Dipakai timeline per-tahap
 * (GET /units/:id/timeline) dan Execution History (Slice 3O).
 */
export function deriveStageLogStatus(lastAction) {
  switch (lastAction) {
    case "START":
    case "RESUME":
      return "IN_PROGRESS";
    case "PAUSE":
      return "PAUSED";
    case "FAIL":
      return "BLOCKED";
    case "COMPLETE":
      return "DONE";
    case "SKIP":
      return "SKIPPED";
    default:
      return "NOT_STARTED";
  }
}

/**
 * Ringkas SATU attempt jadi bentuk siap-tampil (Execution History, spec
 * Slice 3O/3L) — actorId/reason/note diambil dari baris TERAKHIR attempt
 * (siapa yang paling akhir menyentuhnya), timing dari computeExecutionTiming().
 *
 * @param {{events: object[]}} attempt - hasil groupIntoAttempts()
 * @param {Date} [now]
 */
export function summarizeAttempt(attempt, now = new Date()) {
  const rows = attempt.events;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const timing = computeExecutionTiming({ events: rows.map(toExecutionEvent), now });

  return {
    status: deriveStageLogStatus(last.action),
    startedAt: first.startedAt || first.createdAt || null,
    startTimingKnown: !!first.startedAt,
    endedAt: TERMINAL_ACTIONS.has(last.action) ? last.createdAt : null,
    timing,
    performedBy: last.actorId ?? null,
    startedBy: first.actorId ?? null,
    blockReason: last.action === "FAIL" ? last.blockReason : null,
    pauseReason: last.action === "PAUSE" ? last.pauseReason : null,
    note: last.note ?? null,
    rows,
  };
}

export { OPEN_WORK_ACTIONS, TERMINAL_ACTIONS };
