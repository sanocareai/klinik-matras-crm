// Tes productionState.js (Production Core Slice 1) — logika MURNI, tanpa
// database. Ini kosakata KANONIK level-unit yang dipakai board/work-orders/
// qc-queue/unit-detail; kalau derivasinya salah di sini, salah di SEMUA
// permukaan itu sekaligus — makanya diuji lewat setiap cabang, bukan
// sekadar "jalan tanpa error".

import test from "node:test";
import assert from "node:assert/strict";

import {
  PRODUCTION_STATUS,
  deriveProductionStatus,
  describeProductionStatus,
  nextActionAllowed,
  ALLOWED_ACTIONS_BY_STATUS,
} from "../src/lib/domain/productionState.js";

const unit = (overrides = {}) => ({
  status: "IN_PRODUCTION", serviceId: "svc-1", currentStageId: "stage-1", ...overrides,
});

// --- status kasar unit menang mutlak ----------------------------------------
test("unit CANCELLED -> CANCELLED, apa pun isi ledgernya", () => {
  assert.equal(
    deriveProductionStatus({ unit: unit({ status: "CANCELLED" }), lastLog: { action: "START" } }),
    PRODUCTION_STATUS.CANCELLED
  );
});

test("unit dengan status penyelesaian produksi -> COMPLETED", () => {
  for (const status of ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"]) {
    assert.equal(
      deriveProductionStatus({ unit: unit({ status }) }),
      PRODUCTION_STATUS.COMPLETED,
      `status ${status} harus dianggap selesai dari sudut pandang produksi`
    );
  }
});

// --- belum masuk engine ------------------------------------------------------
test("unit tanpa serviceId dan currentStageId -> NOT_STARTED (backfill lama, belum diadopsi)", () => {
  assert.equal(
    deriveProductionStatus({ unit: unit({ serviceId: null, currentStageId: null, status: "RECEIVED" }) }),
    PRODUCTION_STATUS.NOT_STARTED
  );
});

test("currentStageId terisi tapi belum pernah disentuh log -> QUEUED", () => {
  assert.equal(deriveProductionStatus({ unit: unit(), lastLog: null }), PRODUCTION_STATUS.QUEUED);
});

// --- sedang berjalan / gerbang QC -------------------------------------------
test("log terakhir START -> IN_PROGRESS untuk tahap biasa", () => {
  assert.equal(
    deriveProductionStatus({ unit: unit(), lastLog: { action: "START" }, currentStageRequiresQc: false }),
    PRODUCTION_STATUS.IN_PROGRESS
  );
});

test("log terakhir START pada tahap requiresQc -> WAITING_QC, bukan IN_PROGRESS generik", () => {
  assert.equal(
    deriveProductionStatus({ unit: unit(), lastLog: { action: "START" }, currentStageRequiresQc: true }),
    PRODUCTION_STATUS.WAITING_QC
  );
});

test("RESUME dihitung sama dengan START (segmen kerja terbuka)", () => {
  assert.equal(
    deriveProductionStatus({ unit: unit(), lastLog: { action: "RESUME" } }),
    PRODUCTION_STATUS.IN_PROGRESS
  );
});

test("log terakhir PAUSE -> PAUSED", () => {
  assert.equal(deriveProductionStatus({ unit: unit(), lastLog: { action: "PAUSE" } }), PRODUCTION_STATUS.PAUSED);
});

// --- blocked -----------------------------------------------------------------
test("log terakhir FAIL -> BLOCKED lewat fallback lama (belum ada tabel blocker)", () => {
  // hasOpenBlocker TIDAK diberikan (undefined) -> fallback ke definisi lama
  // isUnitBlocked() di unitStageEngine.js: last.action === 'FAIL'. Ini yang
  // menjaga fungsi ini BENAR di Slice 1 (belum ada ProductionBlocker),
  // bukan cuma "kebetulan cocok".
  assert.equal(
    deriveProductionStatus({ unit: unit(), lastLog: { action: "FAIL", blockReason: "MATERIAL_SHORTAGE" } }),
    PRODUCTION_STATUS.BLOCKED
  );
});

test("hasOpenBlocker eksplisit MENANG atas lastLog.action (siap dipakai begitu tabel blocker ada)", () => {
  assert.equal(
    deriveProductionStatus({ unit: unit(), lastLog: { action: "START" }, hasOpenBlocker: true }),
    PRODUCTION_STATUS.BLOCKED,
    "blocker terbuka harus menang walau log terakhir START (mis. di-resume tapi blocker belum diresolve)"
  );
  assert.equal(
    deriveProductionStatus({ unit: unit(), lastLog: { action: "FAIL" }, hasOpenBlocker: false }),
    PRODUCTION_STATUS.QUEUED,
    "hasOpenBlocker:false eksplisit tidak boleh diam-diam jatuh balik ke fallback FAIL — FAIL tanpa blocker terbuka bukan lagi kondisi terblokir"
  );
});

test("BLOCKED menang atas REWORK kalau unit yang sedang dirework kena blok lagi", () => {
  assert.equal(
    deriveProductionStatus({
      unit: unit(), lastLog: { action: "FAIL", blockReason: "MATERIAL_SHORTAGE" }, isReworkTarget: true,
    }),
    PRODUCTION_STATUS.BLOCKED
  );
});

// --- rework --------------------------------------------------------------
test("isReworkTarget=true -> REWORK, bahkan saat sedang aktif dikerjakan", () => {
  // REWORK menang atas WAITING_QC/IN_PROGRESS SENGAJA — lihat komentar di
  // productionState.js: "kenapa unit ini ada di tahap ini LAGI" lebih
  // penting ditampilkan daripada sekadar "sedang berjalan".
  assert.equal(
    deriveProductionStatus({ unit: unit(), lastLog: null, isReworkTarget: true }),
    PRODUCTION_STATUS.REWORK
  );
  assert.equal(
    deriveProductionStatus({ unit: unit(), lastLog: { action: "START" }, isReworkTarget: true }),
    PRODUCTION_STATUS.REWORK
  );
});

// --- describeProductionStatus ------------------------------------------------
test("describeProductionStatus mengembalikan blockReason HANYA untuk BLOCKED", () => {
  assert.equal(
    describeProductionStatus(PRODUCTION_STATUS.BLOCKED, { blockReason: "MACHINE_DOWN" }),
    "MACHINE_DOWN"
  );
  assert.equal(describeProductionStatus(PRODUCTION_STATUS.IN_PROGRESS, { blockReason: "MACHINE_DOWN" }), null);
  assert.equal(describeProductionStatus(PRODUCTION_STATUS.BLOCKED, null), null);
});

// --- tabel transisi (dukungan tes, bukan otoritas — lihat komentar file) ----
test("nextActionAllowed: PAUSED hanya boleh resume", () => {
  assert.ok(nextActionAllowed(PRODUCTION_STATUS.PAUSED, "resume"));
  assert.ok(!nextActionAllowed(PRODUCTION_STATUS.PAUSED, "complete"));
  assert.ok(!nextActionAllowed(PRODUCTION_STATUS.PAUSED, "start"));
});

test("nextActionAllowed: status terminal tidak mengizinkan command apa pun", () => {
  assert.deepEqual(
    ["start", "pause", "resume", "complete", "fail", "skip", "qc"].filter(
      (a) => nextActionAllowed(PRODUCTION_STATUS.COMPLETED, a)
    ),
    []
  );
  assert.deepEqual(
    ["start", "pause", "resume", "complete", "fail", "skip", "qc"].filter(
      (a) => nextActionAllowed(PRODUCTION_STATUS.CANCELLED, a)
    ),
    []
  );
});

test("nextActionAllowed: BLOCKED hanya boleh start (retry), sama seperti startStage() di engine", () => {
  assert.ok(nextActionAllowed(PRODUCTION_STATUS.BLOCKED, "start"));
  assert.ok(!nextActionAllowed(PRODUCTION_STATUS.BLOCKED, "complete"));
});

test("setiap nilai PRODUCTION_STATUS punya baris di tabel transisi (tidak ada yang lupa didaftarkan)", () => {
  for (const status of Object.values(PRODUCTION_STATUS)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(ALLOWED_ACTIONS_BY_STATUS, status),
      `status ${status} tidak punya baris di ALLOWED_ACTIONS_BY_STATUS — nextActionAllowed diam-diam jatuh ke [] untuknya`
    );
  }
});
