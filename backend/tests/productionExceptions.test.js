// Tes productionExceptions.js (Production Core Slice 2) — logika MURNI,
// tanpa database. Ini "mesin" overdue/at-risk/exception/health yang
// dipakai Command Center dan GET /units/:id/timeline; kalau salah di sini,
// salah di SEMUA permukaan itu sekaligus.

import test from "node:test";
import assert from "node:assert/strict";

import {
  SEVERITY,
  EXCEPTION_TYPE,
  RISK_CONFIG,
  BLOCK_REASON_VALUES,
  isProductionEligible,
  validateBlockReason,
  deriveOverdue,
  deriveAtRisk,
  deriveWorkspaceHealth,
  buildExceptionsForUnit,
  buildExceptions,
} from "../src/lib/domain/productionExceptions.js";

const HOUR = 3_600_000;
const NOW = new Date("2026-09-06T12:00:00.000Z");

const unit = (overrides = {}) => ({
  id: "u1", unitCode: "RES-06092026-001-U1", status: "IN_PRODUCTION",
  productionDueAt: null, orderId: "o1", order: { orderNumber: "RES-06092026-001", customer: { name: "Budi" } },
  ...overrides,
});

// --- OVERDUE -----------------------------------------------------------
test("tanpa productionDueAt -> tidak overdue", () => {
  assert.deepEqual(deriveOverdue({ unit: unit(), now: NOW }), { isOverdue: false, overdueMinutes: 0 });
});

test("due date di MASA DEPAN -> tidak overdue", () => {
  const u = unit({ productionDueAt: new Date(NOW.getTime() + 2 * HOUR) });
  assert.equal(deriveOverdue({ unit: u, now: NOW }).isOverdue, false);
});

test("due date sudah LEWAT + status belum selesai -> overdue, overdueMinutes dihitung benar", () => {
  const u = unit({ productionDueAt: new Date(NOW.getTime() - 90 * 60_000) }); // 90 menit lalu
  const r = deriveOverdue({ unit: u, now: NOW });
  assert.equal(r.isOverdue, true);
  assert.equal(r.overdueMinutes, 90);
});

test("due date sudah lewat TAPI unit sudah COMPLETED -> TIDAK overdue (bukan lagi kondisi AKTIF)", () => {
  for (const status of ["READY_FOR_DELIVERY", "DELIVERED", "IN_TRANSIT_OUT", "READY_ON_CUSTOMER_HOLD"]) {
    const u = unit({ status, productionDueAt: new Date(NOW.getTime() - HOUR) });
    assert.equal(deriveOverdue({ unit: u, now: NOW }).isOverdue, false, `status ${status} harus tidak overdue`);
  }
});

test("due date sudah lewat TAPI unit CANCELLED -> tidak overdue", () => {
  const u = unit({ status: "CANCELLED", productionDueAt: new Date(NOW.getTime() - HOUR) });
  assert.equal(deriveOverdue({ unit: u, now: NOW }).isOverdue, false);
});

// --- AT RISK -------------------------------------------------------------
test("due date jauh di masa depan (di luar DUE_SOON_HOURS) -> tidak at-risk", () => {
  const u = unit({ productionDueAt: new Date(NOW.getTime() + (RISK_CONFIG.DUE_SOON_HOURS + 2) * HOUR) });
  assert.equal(deriveAtRisk({ unit: u, now: NOW }).isAtRisk, false);
});

test("due date DALAM jendela DUE_SOON_HOURS -> at-risk DENGAN alasan yang jelas", () => {
  const u = unit({ productionDueAt: new Date(NOW.getTime() + (RISK_CONFIG.DUE_SOON_HOURS - 1) * HOUR) });
  const risk = deriveAtRisk({ unit: u, now: NOW });
  assert.equal(risk.isAtRisk, true);
  assert.ok(risk.riskLevel === "WARNING" || risk.riskLevel === "HIGH");
  assert.ok(risk.riskReasons.length > 0, "at-risk TIDAK BOLEH tanpa riskReasons");
  assert.ok(risk.riskReasons.some((r) => r.code === "DUE_SOON"));
  assert.match(risk.riskReasons[0].label, /due in/i);
});

test("due date SANGAT dekat (dalam DUE_CRITICAL_HOURS) -> riskLevel HIGH", () => {
  const u = unit({ productionDueAt: new Date(NOW.getTime() + (RISK_CONFIG.DUE_CRITICAL_HOURS - 0.5) * HOUR) });
  assert.equal(deriveAtRisk({ unit: u, now: NOW }).riskLevel, "HIGH");
});

test("unit dengan blocker terbuka -> at-risk (walau tanpa due date sama sekali), alasan menyebut blocked", () => {
  const risk = deriveAtRisk({ unit: unit(), now: NOW, hasOpenBlocker: true, blockerReason: "MATERIAL_SHORTAGE" });
  assert.equal(risk.isAtRisk, true);
  assert.equal(risk.riskLevel, "HIGH");
  assert.ok(risk.riskReasons.some((r) => r.code === "BLOCKED"));
});

test("unit SUDAH OVERDUE -> TIDAK diklasifikasikan at-risk (overdue lebih kuat)", () => {
  const u = unit({ productionDueAt: new Date(NOW.getTime() - HOUR) });
  const risk = deriveAtRisk({ unit: u, now: NOW, hasOpenBlocker: true, blockerReason: "MATERIAL_SHORTAGE" });
  assert.equal(risk.isAtRisk, false);
  assert.deepEqual(risk.riskReasons, []);
});

test("unit yang sudah COMPLETED tidak pernah at-risk, walau due date lewat", () => {
  const u = unit({ status: "DELIVERED", productionDueAt: new Date(NOW.getTime() - HOUR) });
  assert.equal(deriveAtRisk({ unit: u, now: NOW, hasOpenBlocker: true, blockerReason: "OTHER" }).isAtRisk, false);
});

test("tanpa due date DAN tanpa blocker -> tidak at-risk (tidak ada dasar risiko)", () => {
  assert.equal(deriveAtRisk({ unit: unit(), now: NOW }).isAtRisk, false);
});

// --- validasi OPEN BLOCKER -------------------------------------------------
test("validateBlockReason: reason kosong ditolak", () => {
  assert.match(validateBlockReason({ reason: undefined, note: null }), /wajib diisi/);
});

test("validateBlockReason: reason tidak dikenal ditolak", () => {
  assert.match(validateBlockReason({ reason: "ALIEN_INVASION", note: null }), /harus salah satu dari/);
});

test("validateBlockReason: seluruh BLOCK_REASON_VALUES diterima (kecuali OTHER butuh catatan)", () => {
  for (const reason of BLOCK_REASON_VALUES) {
    if (reason === "OTHER") continue;
    assert.equal(validateBlockReason({ reason, note: null }), null, `${reason} seharusnya valid tanpa catatan`);
  }
});

test('validateBlockReason: OTHER tanpa catatan bermakna ditolak', () => {
  assert.match(validateBlockReason({ reason: "OTHER", note: null }), /catatan yang jelas/);
  assert.match(validateBlockReason({ reason: "OTHER", note: "  " }), /catatan yang jelas/);
  assert.match(validateBlockReason({ reason: "OTHER", note: "ab" }), /catatan yang jelas/);
});

test('validateBlockReason: OTHER dengan catatan bermakna diterima', () => {
  assert.equal(validateBlockReason({ reason: "OTHER", note: "atap bocor, area kerja tidak aman" }), null);
});

// --- EXCEPTION ENGINE ------------------------------------------------------
test("unit blocked -> exception BLOCKED, severity HIGH, durationMinutes dihitung dari openedAt", () => {
  const blocker = { reason: "MATERIAL_SHORTAGE", note: "Foam D23 habis", openedAt: new Date(NOW.getTime() - 137 * 60_000) };
  const exceptions = buildExceptionsForUnit({ unit: unit(), now: NOW, blocker });
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].type, EXCEPTION_TYPE.BLOCKED);
  assert.equal(exceptions[0].severity, SEVERITY.HIGH);
  assert.equal(exceptions[0].durationMinutes, 137);
  assert.match(exceptions[0].reason, /Foam D23 habis/);
});

test("blocker dengan reason AWAITING_CUSTOMER_APPROVAL -> exception WAITING_APPROVAL, bukan BLOCKED generik", () => {
  const blocker = { reason: "AWAITING_CUSTOMER_APPROVAL", note: null, openedAt: NOW };
  const exceptions = buildExceptionsForUnit({ unit: unit(), now: NOW, blocker });
  assert.equal(exceptions[0].type, EXCEPTION_TYPE.WAITING_APPROVAL);
});

test("unit overdue -> exception OVERDUE; overdue PARAH (>= SEVERE_OVERDUE_HOURS) -> severity CRITICAL", () => {
  const ringan = unit({ productionDueAt: new Date(NOW.getTime() - 30 * 60_000) });
  const parah = unit({ productionDueAt: new Date(NOW.getTime() - (RISK_CONFIG.SEVERE_OVERDUE_HOURS + 1) * HOUR) });

  const excRingan = buildExceptionsForUnit({ unit: ringan, now: NOW });
  assert.equal(excRingan[0].type, EXCEPTION_TYPE.OVERDUE);
  assert.equal(excRingan[0].severity, SEVERITY.HIGH);

  const excParah = buildExceptionsForUnit({ unit: parah, now: NOW });
  assert.equal(excParah[0].severity, SEVERITY.CRITICAL);
});

test("unit at-risk (belum overdue, tidak blocked) -> exception AT_RISK dengan riskReasons ikut terbawa", () => {
  const u = unit({ productionDueAt: new Date(NOW.getTime() + HOUR) });
  const exceptions = buildExceptionsForUnit({ unit: u, now: NOW });
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].type, EXCEPTION_TYPE.AT_RISK);
  assert.ok(Array.isArray(exceptions[0].riskReasons) && exceptions[0].riskReasons.length > 0);
});

test("unit BLOCKED tidak pernah menghasilkan exception AT_RISK ganda untuk unit yang sama", () => {
  // Unit ini SECARA TEKNIS juga "at-risk" (due segera + blocked), tapi
  // exception BLOCKED sudah lebih spesifik & actionable — tidak boleh
  // dobel jadi 2 baris untuk kondisi yang sama.
  const u = unit({ productionDueAt: new Date(NOW.getTime() + HOUR) });
  const blocker = { reason: "MATERIAL_SHORTAGE", note: null, openedAt: NOW };
  const exceptions = buildExceptionsForUnit({ unit: u, now: NOW, blocker });
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].type, EXCEPTION_TYPE.BLOCKED);
  assert.ok(!exceptions.some((e) => e.type === EXCEPTION_TYPE.AT_RISK));
});

test("unit rework (tidak blocked) -> exception REWORK", () => {
  const exceptions = buildExceptionsForUnit({ unit: unit(), now: NOW, isReworkTarget: true });
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].type, EXCEPTION_TYPE.REWORK);
});

test("unit rework YANG JUGA blocked -> hanya exception BLOCKED yang muncul (lebih actionable)", () => {
  const blocker = { reason: "MATERIAL_SHORTAGE", note: null, openedAt: NOW };
  const exceptions = buildExceptionsForUnit({ unit: unit(), now: NOW, blocker, isReworkTarget: true });
  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0].type, EXCEPTION_TYPE.BLOCKED);
});

test("unit overdue YANG JUGA blocked -> DUA exception terpisah (BLOCKED dan OVERDUE)", () => {
  const u = unit({ productionDueAt: new Date(NOW.getTime() - HOUR) });
  const blocker = { reason: "MATERIAL_SHORTAGE", note: null, openedAt: NOW };
  const exceptions = buildExceptionsForUnit({ unit: u, now: NOW, blocker });
  const types = exceptions.map((e) => e.type).sort();
  assert.deepEqual(types, [EXCEPTION_TYPE.BLOCKED, EXCEPTION_TYPE.OVERDUE].sort());
});

test("unit sehat (tidak overdue/at-risk/blocked/rework) -> tidak menghasilkan exception apa pun", () => {
  assert.deepEqual(buildExceptionsForUnit({ unit: unit(), now: NOW }), []);
});

test("buildExceptions: urutan severity CRITICAL > HIGH > WARNING, deterministik", () => {
  const units = [
    unit({ id: "at-risk", productionDueAt: new Date(NOW.getTime() + HOUR) }), // WARNING/HIGH
    unit({ id: "overdue-parah", productionDueAt: new Date(NOW.getTime() - (RISK_CONFIG.SEVERE_OVERDUE_HOURS + 1) * HOUR) }), // CRITICAL
    unit({ id: "blocked", productionDueAt: null }), // HIGH (lewat blocker)
  ];
  const blockersByUnitId = { blocked: { reason: "MATERIAL_SHORTAGE", note: null, openedAt: NOW } };
  const exceptions = buildExceptions({ units, blockersByUnitId, now: NOW });

  assert.equal(exceptions[0].unitId, "overdue-parah");
  assert.equal(exceptions[0].severity, SEVERITY.CRITICAL);
  // Dua sisanya sama-sama HIGH (blocked selalu HIGH; at-risk HIGH kalau
  // dalam jendela DUE_CRITICAL_HOURS — di sini 1 jam < 2 jam default,
  // jadi keduanya HIGH) — urutan di antara HIGH yang sama ditentukan
  // urgencyMinutes, TIDAK diuji persis di sini, cukup pastikan tidak ada
  // yang WARNING/INFO nyelip di depan CRITICAL/HIGH.
  const ranks = { CRITICAL: 3, HIGH: 2, WARNING: 1, INFO: 0 };
  for (let i = 1; i < exceptions.length; i++) {
    assert.ok(
      ranks[exceptions[i - 1].severity] >= ranks[exceptions[i].severity],
      "exceptions harus terurut severity menurun"
    );
  }
});

// --- WORKSPACE HEALTH --------------------------------------------------
test("deriveWorkspaceHealth: tidak ada masalah -> STABLE, reasons kosong", () => {
  assert.deepEqual(
    deriveWorkspaceHealth({ blockedCount: 0, overdueCount: 0, atRiskCount: 0 }),
    { level: "STABLE", reasons: [] }
  );
});

test("deriveWorkspaceHealth: ada blocked/overdue/at-risk (di bawah ambang CRITICAL) -> ATTENTION dengan alasan", () => {
  const h = deriveWorkspaceHealth({ blockedCount: 1, overdueCount: 1, atRiskCount: 2 });
  assert.equal(h.level, "ATTENTION");
  assert.ok(h.reasons.some((r) => r.includes("1 unit blocked")));
  assert.ok(h.reasons.some((r) => r.includes("1 unit overdue")));
});

test("deriveWorkspaceHealth: blocked/overdue MELEWATI ambang -> CRITICAL", () => {
  assert.equal(
    deriveWorkspaceHealth({ blockedCount: RISK_CONFIG.HEALTH_CRITICAL_BLOCKED_COUNT, overdueCount: 0, atRiskCount: 0 }).level,
    "CRITICAL"
  );
  assert.equal(
    deriveWorkspaceHealth({ blockedCount: 0, overdueCount: RISK_CONFIG.HEALTH_CRITICAL_OVERDUE_COUNT, atRiskCount: 0 }).level,
    "CRITICAL"
  );
});

test("deriveWorkspaceHealth: satu unit overdue PARAH (severeOverdueCount > 0) langsung CRITICAL walau count kecil", () => {
  assert.equal(
    deriveWorkspaceHealth({ blockedCount: 0, overdueCount: 1, atRiskCount: 0, severeOverdueCount: 1 }).level,
    "CRITICAL"
  );
});

// --- isProductionEligible ---------------------------------------------
test("isProductionEligible: false untuk CANCELLED dan status selesai produksi, true untuk sisanya", () => {
  assert.equal(isProductionEligible("CANCELLED"), false);
  assert.equal(isProductionEligible("DELIVERED"), false);
  assert.equal(isProductionEligible("IN_PRODUCTION"), true);
  assert.equal(isProductionEligible("AWAITING_PICKUP"), true);
});
