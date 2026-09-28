// Logika murni Eksekusi Workshop. Lihat src/features/production/workshopExecution.js.
import test from "node:test";
import assert from "node:assert/strict";
import {
  PAUSE_REASONS, availableActions, currentStageOf, emptyStateCopy, historyActionLabel, nextStageOf, runStateBadgeFor,
  stageProgress, startBlockedReason, validateCompleteForm, validatePauseForm, workshopErrorMessage,
} from "../src/features/production/workshopExecution.js";

const stages = [
  { id: "a", label: "Uji Sebelum Bongkar", status: "COMPLETED", requiresPhoto: true },
  { id: "b", label: "Bongkar", status: "ACTIVE", requiresPhoto: true },
  { id: "c", label: "Pasang", status: "NOT_STARTED", requiresPhoto: false },
];

test("badge status run: kosakata Indonesia; status tak dikenal netral", () => {
  assert.deepEqual(runStateBadgeFor("READY_TO_START"), { variant: "warning", label: "Siap Dimulai" });
  assert.equal(runStateBadgeFor("PAUSED").label, "Dijeda");
  assert.equal(runStateBadgeFor("AWAITING_QC").label, "Menunggu QC");
  assert.deepEqual(runStateBadgeFor("X"), { variant: "neutral", label: "X" });
});

test("aksi tersedia mengikuti state: mulai hanya bila siap + material siap; jeda/selesai saat berjalan; lanjutkan saat dijeda; AWAITING_QC tanpa aksi", () => {
  assert.deepEqual(availableActions({ state: "READY_TO_START", material: { ready: true } }), { start: true, pause: false, resume: false, complete: false });
  assert.equal(availableActions({ state: "READY_TO_START", material: { ready: false } }).start, false);
  assert.deepEqual(availableActions({ state: "IN_PROGRESS" }), { start: false, pause: true, resume: false, complete: true });
  assert.deepEqual(availableActions({ state: "PAUSED" }), { start: false, pause: false, resume: true, complete: false });
  assert.deepEqual(availableActions({ state: "AWAITING_QC" }), { start: false, pause: false, resume: false, complete: false });
  assert.deepEqual(availableActions(null), { start: false, pause: false, resume: false, complete: false });
});

test("alasan start diblokir: menunggu QC dan bahan belum diserahkan", () => {
  assert.match(startBlockedReason({ state: "AWAITING_QC" }), /menunggu QC/);
  assert.match(startBlockedReason({ state: "READY_TO_START", material: { ready: false, reason: "bahan belum diserahkan" } }), /bahan belum diserahkan/);
  assert.equal(startBlockedReason({ state: "READY_TO_START", material: { ready: true } }), null);
  assert.equal(startBlockedReason(null), null);
});

test("tahap: sekarang, berikutnya, progres", () => {
  const run = { stages };
  assert.equal(currentStageOf(run).id, "b");
  assert.equal(nextStageOf(run).id, "c");
  assert.deepEqual(stageProgress(run), { done: 1, total: 3, percent: 33 });
  assert.deepEqual(stageProgress({}), { done: 0, total: 0, percent: 0 });
  assert.equal(currentStageOf({ stages: [{ status: "PAUSED", id: "p" }] }).id, "p");
});

test("form jeda: alasan wajib; hanya alasan server; Lainnya wajib catatan", () => {
  assert.deepEqual(PAUSE_REASONS.map((r) => r.value), ["BREAK", "PROCESS_DELAY", "OTHER"]);
  assert.equal(validatePauseForm({ reason: "", note: "" }).valid, false);
  assert.equal(validatePauseForm({ reason: "MATERIAL_SHORTAGE" }).valid, false);
  assert.equal(validatePauseForm({ reason: "OTHER", note: " " }).valid, false);
  assert.equal(validatePauseForm({ reason: "OTHER", note: "ganti alat" }).valid, true);
  assert.equal(validatePauseForm({ reason: "BREAK" }).valid, true);
});

test("form selesai tahap: foto wajib hanya bila tahap meminta", () => {
  assert.equal(validateCompleteForm({ stage: { requiresPhoto: true }, photoUrls: [] }).valid, false);
  assert.equal(validateCompleteForm({ stage: { requiresPhoto: true }, photoUrls: ["/x.jpg"] }).valid, true);
  assert.equal(validateCompleteForm({ stage: { requiresPhoto: false }, photoUrls: [] }).valid, true);
});

test("pesan galat: kode dikenal dipetakan; lainnya pakai pesan server; ada fallback", () => {
  assert.match(workshopErrorMessage({ code: "WORKSHOP_REVISION_CONFLICT" }), /muat ulang/);
  assert.match(workshopErrorMessage({ code: "WORKSHOP_MATERIAL_NOT_ISSUED" }), /belum diserahkan/);
  assert.match(workshopErrorMessage({ code: "WORKSHOP_OPERATOR_MISMATCH" }), /operator/);
  assert.equal(workshopErrorMessage({ code: "LAIN", message: "pesan server" }), "pesan server");
  assert.equal(workshopErrorMessage({}), "Gagal memproses perintah");
});

test("label histori dan status kosong: reader OFF tampil belum aktif, bukan galat", () => {
  assert.equal(historyActionLabel("PAUSE"), "Jeda");
  assert.equal(historyActionLabel("ZZZ"), "ZZZ");
  assert.equal(emptyStateCopy({ readerMode: "OFF", scope: "today" }).belumAktif, true);
  assert.equal(emptyStateCopy({ readerMode: "ON", scope: "today" }).belumAktif, false);
  assert.match(emptyStateCopy({ readerMode: "ON", scope: "today" }).title, /hari ini/);
});
