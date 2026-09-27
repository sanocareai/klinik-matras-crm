// Logika murni halaman Rencana Produksi. Lihat src/features/production/planning.js.
import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_TABS, bomLineAvailability, canAssignPlan, canCancelPlan, canEditBOM, canReleaseReservations, canReservePlan,
  emptyStateCopy, planStatusBadgeFor, validateAssignmentForm, validateBOMLines,
} from "../src/features/production/planning.js";

test("tab: Antrean/Draf/Direncanakan/Bahan Direservasi/Dibatalkan, dalam urutan itu", () => {
  assert.deepEqual(PLAN_TABS.map((t) => t.key), ["ELIGIBLE", "DRAFT", "PLANNED", "MATERIAL_RESERVED", "CANCELLED"]);
});

test("planStatusBadgeFor: setiap status punya label Indonesia; status tak dikenal jatuh ke netral", () => {
  assert.deepEqual(planStatusBadgeFor("DRAFT"), { variant: "neutral", label: "Draf" });
  assert.deepEqual(planStatusBadgeFor("PLANNED"), { variant: "warning", label: "Direncanakan" });
  assert.deepEqual(planStatusBadgeFor("MATERIAL_RESERVED"), { variant: "success", label: "Bahan Direservasi" });
  assert.deepEqual(planStatusBadgeFor("CANCELLED"), { variant: "danger", label: "Dibatalkan" });
  assert.deepEqual(planStatusBadgeFor("APA_SAJA"), { variant: "neutral", label: "APA_SAJA" });
  assert.equal(planStatusBadgeFor(undefined).label, "—");
});

test("aturan transisi murni: hanya CANCELLED yang mengunci semua aksi; reservasi hanya boleh dari PLANNED", () => {
  for (const status of ["DRAFT", "PLANNED", "MATERIAL_RESERVED"]) {
    assert.equal(canAssignPlan({ status }), true, status);
    assert.equal(canEditBOM({ status }), true, status);
    assert.equal(canReleaseReservations({ status }), true, status);
    assert.equal(canCancelPlan({ status }), true, status);
  }
  assert.equal(canAssignPlan({ status: "CANCELLED" }), false);
  assert.equal(canEditBOM({ status: "CANCELLED" }), false);
  assert.equal(canReleaseReservations({ status: "CANCELLED" }), false);
  assert.equal(canCancelPlan({ status: "CANCELLED" }), false);
  assert.equal(canReservePlan({ status: "DRAFT" }), false);
  assert.equal(canReservePlan({ status: "PLANNED" }), true);
  assert.equal(canReservePlan({ status: "MATERIAL_RESERVED" }), false);
  assert.equal(canReservePlan(null), false);
});

test("validateAssignmentForm: workshop/operator/target wajib; selesai harus setelah mulai", () => {
  assert.equal(validateAssignmentForm({}).valid, false);
  const missingWc = validateAssignmentForm({ operatorId: "o1", targetStartAt: "2026-09-29T01:00", targetCompleteAt: "2026-09-29T05:00" });
  assert.equal(missingWc.valid, false);
  assert.match(missingWc.errors.workCenterId, /wajib dipilih/);
  const badRange = validateAssignmentForm({ workCenterId: "w1", operatorId: "o1", targetStartAt: "2026-09-29T05:00", targetCompleteAt: "2026-09-29T01:00" });
  assert.equal(badRange.valid, false);
  assert.match(badRange.errors.targetCompleteAt, /setelah target mulai/);
  const ok = validateAssignmentForm({ workCenterId: "w1", operatorId: "o1", targetStartAt: "2026-09-29T01:00", targetCompleteAt: "2026-09-29T05:00" });
  assert.equal(ok.valid, true);
});

test("validateBOMLines: minimal satu baris, qty > 0, tanpa material duplikat", () => {
  assert.equal(validateBOMLines([]).valid, false);
  assert.equal(validateBOMLines([{ materialId: "m1", qty: 0 }]).valid, false);
  assert.equal(validateBOMLines([{ materialId: "m1", qty: "abc" }]).valid, false);
  assert.equal(validateBOMLines([{ materialId: "m1", qty: 1 }, { materialId: "m1", qty: 2 }]).valid, false);
  assert.equal(validateBOMLines([{ materialId: "m1", qty: 1 }, { materialId: "m2", qty: 2.5 }]).valid, true);
});

test("bomLineAvailability: available dari stockRow.available bila ada, jika tidak dihitung balance-reserved; shortage & sufficient konsisten", () => {
  const withAvailable = bomLineAvailability({ balance: 10, reserved: 3, available: 7 }, 5);
  assert.deepEqual(withAvailable, { onHand: 10, reserved: 3, available: 7, needed: 5, shortage: 0, sufficient: true });
  const shortfall = bomLineAvailability({ balance: 10, reserved: 3, available: 7 }, 9);
  assert.equal(shortfall.shortage, 2);
  assert.equal(shortfall.sufficient, false);
  const noRow = bomLineAvailability(null, 5);
  assert.equal(noRow.available, 0);
  assert.equal(noRow.sufficient, false);
});

test("emptyStateCopy: reader OFF menjelaskan fitur canary (bukan pesan error), bukan 'tidak ada data'", () => {
  const off = emptyStateCopy({ readerMode: "OFF", tabKey: "ELIGIBLE" });
  assert.equal(off.belumAktif, true);
  assert.match(off.title, /belum diaktifkan/i);
  assert.match(off.description, /canary|Admin/i);
});

test("emptyStateCopy: reader aktif tapi tab kosong -> pesan netral menyebut nama tab", () => {
  const cohort = emptyStateCopy({ readerMode: "COHORT", tabKey: "MATERIAL_RESERVED" });
  assert.equal(cohort.belumAktif, false);
  assert.match(cohort.title, /bahan direservasi/i);
});
