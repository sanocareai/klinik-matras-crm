// Tes lib/domain/stageExecution.js (Production Core Slice 3) — logika MURNI,
// tanpa database. Ini yang membuktikan rekonstruksi Touch/Paused/Elapsed
// TIDAK PERNAH mengarang angka (legacy fallback), dan bahwa PAUSED tetap
// state TERPISAH dari BLOCKED walau lewat kode yang sama (groupIntoAttempts/
// computeExecutionTiming) — kalau salah satu asumsi ini keliru, salah di
// SEMUA permukaan yang memakainya (Unit Detail, timeline, work-orders,
// command-center), makanya diuji per skenario, bukan sekadar "tidak error".

import test from "node:test";
import assert from "node:assert/strict";

import {
  PAUSE_REASON_VALUES,
  validatePauseReason,
  toExecutionEvent,
  computeExecutionTiming,
  groupIntoAttempts,
  deriveStageLogStatus,
  summarizeAttempt,
  OPEN_WORK_ACTIONS,
  TERMINAL_ACTIONS,
} from "../src/lib/domain/stageExecution.js";

const MIN = 60; // detik, untuk bikin test case gampang dibaca (mis. 15*MIN = 15 menit)

// Baris UnitStageLog minimal untuk toExecutionEvent()/groupIntoAttempts() —
// helper TES, bukan bagian modul (dua-duanya cuma butuh {action, startedAt?, createdAt}).
function row(action, atSeconds, overrides = {}) {
  const at = new Date(atSeconds * 1000);
  return {
    action,
    startedAt: action === "START" ? at : null,
    createdAt: at,
    actorId: null,
    blockReason: null,
    pauseReason: action === "PAUSE" ? "BREAK" : null,
    note: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validatePauseReason — validasi MURNI, arsitektur PAUSED vs BLOCKED
// ---------------------------------------------------------------------------

test("validatePauseReason: reason kosong ditolak", () => {
  assert.match(validatePauseReason({ reason: undefined, note: null }), /wajib diisi/);
});

test("validatePauseReason: reason berbentuk BlockReason ditolak dengan pesan pengarah ke Block Production", () => {
  for (const blockerLike of ["MATERIAL_SHORTAGE", "AWAITING_CUSTOMER_APPROVAL", "MACHINE_DOWN", "AWAITING_CUSTOMER", "AWAITING_OPERATOR", "AWAITING_TOOL"]) {
    const err = validatePauseReason({ reason: blockerLike, note: null });
    assert.match(err, /BLOKIR|Block Production|Tandai Terhambat/i, `reason "${blockerLike}" harus ditolak sebagai pause`);
  }
});

test("validatePauseReason: reason tidak dikenal ditolak", () => {
  assert.match(validatePauseReason({ reason: "ALASAN_NGARANG", note: null }), /salah satu dari/);
});

test("validatePauseReason: BREAK/PROCESS_DELAY sah tanpa note", () => {
  assert.equal(validatePauseReason({ reason: "BREAK", note: null }), null);
  assert.equal(validatePauseReason({ reason: "PROCESS_DELAY", note: undefined }), null);
});

test("validatePauseReason: OTHER wajib note yang jelas (>=3 karakter)", () => {
  assert.match(validatePauseReason({ reason: "OTHER", note: null }), /catatan/);
  assert.match(validatePauseReason({ reason: "OTHER", note: "ab" }), /catatan/);
  assert.equal(validatePauseReason({ reason: "OTHER", note: "Menunggu instruksi supervisor" }), null);
});

test("PAUSE_REASON_VALUES tidak overlap dengan kosakata BlockReason (Pilihan Arsitektur A)", () => {
  const blockerVocab = ["MATERIAL_SHORTAGE", "AWAITING_CUSTOMER_APPROVAL", "MACHINE_DOWN", "QUALITY_ISSUE", "AWAITING_CUSTOMER", "AWAITING_OPERATOR", "AWAITING_TOOL"];
  for (const v of PAUSE_REASON_VALUES) {
    assert.ok(!blockerVocab.includes(v), `PauseReason "${v}" tidak boleh muncul di kosakata BlockReason`);
  }
});

// ---------------------------------------------------------------------------
// computeExecutionTiming — Touch/Paused/Elapsed
// ---------------------------------------------------------------------------

test("timing: START -> COMPLETE tanpa jeda sama sekali, touch = elapsed, paused = 0", () => {
  const events = [row("START", 0), row("COMPLETE", 60 * MIN)].map(toExecutionEvent);
  const t = computeExecutionTiming({ events });
  assert.equal(t.timingKnown, true);
  assert.equal(t.elapsedSeconds, 60 * MIN);
  assert.equal(t.touchSeconds, 60 * MIN);
  assert.equal(t.pausedSeconds, 0);
  assert.equal(t.currentlyPaused, false);
});

test("timing: satu jeda — 60m elapsed, 45m touch, 15m paused (spec)", () => {
  // START t=0, PAUSE t=45m, RESUME t=60m (jeda 15m), COMPLETE t=60m — total
  // wall-clock 60m, touch 45m (0-45), paused 15m (45-60), tapi COMPLETE di
  // titik yang sama dengan RESUME (attempt ditutup segera setelah resume) —
  // supaya ELAPSED tetap genap 60m sesuai spec, tulis COMPLETE persis di t=60m.
  const events = [
    row("START", 0),
    row("PAUSE", 45 * MIN),
    row("RESUME", 60 * MIN),
    row("COMPLETE", 60 * MIN),
  ].map(toExecutionEvent);
  const t = computeExecutionTiming({ events });
  assert.equal(t.timingKnown, true);
  assert.equal(t.elapsedSeconds, 60 * MIN);
  assert.equal(t.touchSeconds, 45 * MIN);
  assert.equal(t.pausedSeconds, 15 * MIN);
});

test("timing: multi-pause — jeda diakumulasi dari beberapa siklus PAUSE/RESUME", () => {
  // START 0 -> PAUSE 10m (touch 10m) -> RESUME 20m (paused 10m) ->
  // PAUSE 50m (touch +30m = 40m) -> RESUME 60m (paused +10m = 20m) ->
  // COMPLETE 80m (touch +20m = 60m). Elapsed 80m = touch 60m + paused 20m.
  const events = [
    row("START", 0),
    row("PAUSE", 10 * MIN),
    row("RESUME", 20 * MIN),
    row("PAUSE", 50 * MIN),
    row("RESUME", 60 * MIN),
    row("COMPLETE", 80 * MIN),
  ].map(toExecutionEvent);
  const t = computeExecutionTiming({ events });
  assert.equal(t.elapsedSeconds, 80 * MIN);
  assert.equal(t.touchSeconds, 60 * MIN);
  assert.equal(t.pausedSeconds, 20 * MIN);
});

test("timing: sedang dijeda SEKARANG — segmen jeda aktif TIDAK dihitung sebagai touch", () => {
  const now = new Date(30 * MIN * 1000);
  const events = [row("START", 0), row("PAUSE", 10 * MIN)].map(toExecutionEvent);
  const t = computeExecutionTiming({ events, now });
  assert.equal(t.currentlyPaused, true);
  assert.equal(t.touchSeconds, 10 * MIN); // hanya segmen sebelum PAUSE
  assert.equal(t.pausedSeconds, 20 * MIN); // dari PAUSE sampai `now`
  assert.equal(t.elapsedSeconds, 30 * MIN);
});

test("timing: sedang berjalan SEKARANG (belum ditutup) — segmen aktif IKUT dihitung sebagai touch", () => {
  const now = new Date(45 * MIN * 1000);
  const events = [row("START", 0)].map(toExecutionEvent);
  const t = computeExecutionTiming({ events, now });
  assert.equal(t.currentlyPaused, false);
  assert.equal(t.touchSeconds, 45 * MIN);
  assert.equal(t.pausedSeconds, 0);
  assert.equal(t.elapsedSeconds, 45 * MIN);
});

test("timing: legacy — START tanpa startedAt (retrospektif) -> timingKnown false, TIDAK PERNAH 0", () => {
  const legacyStart = { action: "START", startedAt: null, createdAt: new Date(0) };
  const legacyComplete = { action: "COMPLETE", startedAt: null, createdAt: new Date(60 * MIN * 1000) };
  const events = [toExecutionEvent(legacyStart), toExecutionEvent(legacyComplete)];
  const t = computeExecutionTiming({ events });
  assert.equal(t.timingKnown, false);
  assert.equal(t.elapsedSeconds, null);
  assert.equal(t.touchSeconds, null);
  assert.equal(t.pausedSeconds, null);
});

test("timing: events kosong -> timingKnown false, bukan crash", () => {
  const t = computeExecutionTiming({ events: [] });
  assert.equal(t.timingKnown, false);
});

// ---------------------------------------------------------------------------
// groupIntoAttempts / deriveStageLogStatus — PAUSED vs BLOCKED tetap terpisah
// ---------------------------------------------------------------------------

test("groupIntoAttempts: satu START membuka satu attempt, baris berikutnya menempel sampai START lagi", () => {
  const rows = [row("START", 0), row("PAUSE", 10), row("RESUME", 20), row("COMPLETE", 30), row("START", 40)];
  const attempts = groupIntoAttempts(rows);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].events.length, 4);
  assert.equal(attempts[1].events.length, 1);
});

test("deriveStageLogStatus: PAUSE -> PAUSED, FAIL -> BLOCKED — dua state TERPISAH, tidak pernah tertukar", () => {
  assert.equal(deriveStageLogStatus("PAUSE"), "PAUSED");
  assert.equal(deriveStageLogStatus("FAIL"), "BLOCKED");
  assert.notEqual(deriveStageLogStatus("PAUSE"), deriveStageLogStatus("FAIL"));
});

test("deriveStageLogStatus: START/RESUME -> IN_PROGRESS, COMPLETE -> DONE, SKIP -> SKIPPED, lainnya -> NOT_STARTED", () => {
  assert.equal(deriveStageLogStatus("START"), "IN_PROGRESS");
  assert.equal(deriveStageLogStatus("RESUME"), "IN_PROGRESS");
  assert.equal(deriveStageLogStatus("COMPLETE"), "DONE");
  assert.equal(deriveStageLogStatus("SKIP"), "SKIPPED");
  assert.equal(deriveStageLogStatus(undefined), "NOT_STARTED");
});

test("OPEN_WORK_ACTIONS/TERMINAL_ACTIONS: kosakata tidak overlap", () => {
  for (const a of OPEN_WORK_ACTIONS) assert.ok(!TERMINAL_ACTIONS.has(a));
  assert.ok(OPEN_WORK_ACTIONS.has("START"));
  assert.ok(OPEN_WORK_ACTIONS.has("RESUME"));
  assert.ok(TERMINAL_ACTIONS.has("COMPLETE"));
  assert.ok(TERMINAL_ACTIONS.has("FAIL"));
  assert.ok(TERMINAL_ACTIONS.has("SKIP"));
});

// ---------------------------------------------------------------------------
// summarizeAttempt — bentuk siap-tampil (Execution History)
// ---------------------------------------------------------------------------

test("summarizeAttempt: attempt selesai normal — status DONE, timing lengkap, performedBy dari baris terakhir", () => {
  const rows = [
    row("START", 0, { actorId: "u1" }),
    row("PAUSE", 10 * MIN, { actorId: "u1", pauseReason: "BREAK" }),
    row("RESUME", 20 * MIN, { actorId: "u2" }),
    row("COMPLETE", 50 * MIN, { actorId: "u2" }),
  ];
  const summary = summarizeAttempt({ events: rows });
  assert.equal(summary.status, "DONE");
  assert.equal(summary.startTimingKnown, true);
  assert.equal(summary.timing.touchSeconds, 40 * MIN); // (0-10)+(20-50)
  assert.equal(summary.timing.pausedSeconds, 10 * MIN);
  assert.equal(summary.performedBy, "u2"); // baris terakhir
  assert.equal(summary.startedBy, "u1");
});

test("summarizeAttempt: attempt masih dijeda (belum ditutup) — status PAUSED, endedAt null, pauseReason terisi", () => {
  const rows = [row("START", 0, { actorId: "u1" }), row("PAUSE", 10 * MIN, { actorId: "u1", pauseReason: "PROCESS_DELAY" })];
  const summary = summarizeAttempt({ events: rows }, new Date(20 * MIN * 1000));
  assert.equal(summary.status, "PAUSED");
  assert.equal(summary.endedAt, null);
  assert.equal(summary.pauseReason, "PROCESS_DELAY");
  assert.equal(summary.timing.currentlyPaused, true);
});

test("summarizeAttempt: attempt legacy (startedAt null) — startTimingKnown false, timing null (tidak mengarang)", () => {
  const rows = [
    { action: "START", startedAt: null, createdAt: new Date(0), actorId: "u1" },
    { action: "COMPLETE", startedAt: null, createdAt: new Date(60 * MIN * 1000), actorId: "u1" },
  ];
  const summary = summarizeAttempt({ events: rows });
  assert.equal(summary.startTimingKnown, false);
  assert.equal(summary.timing.timingKnown, false);
  assert.equal(summary.timing.touchSeconds, null);
});

// ---------------------------------------------------------------------------
// Skenario "state-machine legality" — didokumentasikan di sini sebagai tabel
// kebenaran atas deriveStageLogStatus (kosakata level-BARIS/attempt).
// Penegakan LEGALITAS transisi yang sesungguhnya ada di unitStageEngine.js
// (findOpenWork/resolveCurrentTarget, butuh Prisma — diverifikasi lewat
// review kode + tes authorize/integration, bukan di sini) — tabel ini
// mengunci PEMETAAN action->status yang jadi dasar keputusan itu supaya
// tidak diam-diam menyimpang.
// ---------------------------------------------------------------------------

test("tabel status: setiap StageLogAction memetakan ke TEPAT SATU status non-ambigu", () => {
  const table = {
    START: "IN_PROGRESS",
    RESUME: "IN_PROGRESS",
    PAUSE: "PAUSED",
    FAIL: "BLOCKED",
    COMPLETE: "DONE",
    SKIP: "SKIPPED",
  };
  for (const [action, expected] of Object.entries(table)) {
    assert.equal(deriveStageLogStatus(action), expected, `action ${action}`);
  }
});
