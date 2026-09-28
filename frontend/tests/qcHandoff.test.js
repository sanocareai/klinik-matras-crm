// Logika murni antrean QC Production V2 dan penerimaan barang jadi Gudang (P6). Lihat src/features/production/qcHandoff.js dan src/features/warehouse/finishedGoods.js.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFLICT_KIND_LABEL, QC_MODES, QC_TABS, buildInspectionBody, canRecordInspection, emptyStateCopy, inspectionBadgeFor, nextInspectionSummary, qcErrorMessage,
  qcStateBadgeFor, reworkStageOptions, resolutionLabel, validateInspectionForm, validateNoteForm,
} from "../src/features/production/qcHandoff.js";
import {
  FG_TABS, acceptSummary, fgEmptyStateCopy, fgErrorMessage, fgStatusBadgeFor, isFgDecisionPending, locationsForFinishedGoods, rejectSummary, validateAcceptForm, validateRejectForm,
} from "../src/features/warehouse/finishedGoods.js";

const PHOTO = ["/media/a.jpg"];

test("tab dan badge QC: kosakata Indonesia, urutan tab, status tak dikenal netral", () => {
  assert.deepEqual(QC_TABS.map((t) => t.key), ["AWAITING_QC", "REWORK", "HANDOFF", "REJECTED", "CONFLICT"]);
  assert.equal(qcStateBadgeFor("AWAITING_QC").label, "Menunggu QC");
  assert.equal(qcStateBadgeFor("REJECTED").label, "Ditolak Gudang");
  assert.deepEqual(qcStateBadgeFor("X"), { variant: "neutral", label: "X" });
  assert.equal(inspectionBadgeFor("PASS").label, "Lulus");
  assert.equal(inspectionBadgeFor("OVERRIDDEN").label, "QC Di-waive", "waive tidak pernah tampil sebagai Lulus");
  assert.equal(inspectionBadgeFor("FAIL_REWORK").variant, "danger");
  assert.deepEqual(QC_MODES.map((m) => m.key), ["PASS", "FAIL", "WAIVED"]);
});

test("form QC Lulus: foto + berat acuan wajib; selain Pas hanya dengan override + edukasi", () => {
  const base = { mode: "PASS", photoUrls: PHOTO, referenceWeightKg: "60", fitVerdict: "PAS" };
  assert.equal(validateInspectionForm(base).valid, true);
  assert.equal(validateInspectionForm({ ...base, photoUrls: [] }).valid, false);
  assert.equal(validateInspectionForm({ ...base, referenceWeightKg: "" }).valid, false);
  assert.equal(validateInspectionForm({ ...base, referenceWeightKg: "60.5" }).valid, false);
  assert.equal(validateInspectionForm({ ...base, fitVerdict: "TERLALU_KERAS" }).valid, false);
  assert.equal(validateInspectionForm({ ...base, fitVerdict: "TERLALU_KERAS", customerPreferenceOverride: "LEBIH_KERAS", educationGiven: true }).valid, true);
});

test("form QC Gagal: hasil uji, catatan, tahap rework eksplisit; bahan tambahan tanpa duplikat dan qty > 0", () => {
  const base = { mode: "FAIL", photoUrls: PHOTO, referenceWeightKg: 50, fitVerdict: "TERLALU_EMPUK", note: "kurang padat", reworkStageId: "s1", materials: [] };
  assert.equal(validateInspectionForm(base).valid, true);
  assert.equal(validateInspectionForm({ ...base, fitVerdict: "PAS" }).valid, false);
  assert.equal(validateInspectionForm({ ...base, note: " " }).valid, false);
  assert.equal(validateInspectionForm({ ...base, reworkStageId: "" }).valid, false);
  assert.equal(validateInspectionForm({ ...base, materials: [{ materialId: "m1", qty: 0 }] }).valid, false);
  assert.equal(validateInspectionForm({ ...base, materials: [{ materialId: "m1", qty: 1 }, { materialId: "m1", qty: 2 }] }).valid, false);
  assert.equal(validateInspectionForm({ ...base, materials: [{ materialId: "m1", qty: 1 }] }).valid, true);
});

test("form Waive QC: alasan minimal 10 karakter; tanpa syarat foto/berat", () => {
  assert.equal(validateInspectionForm({ mode: "WAIVED", reason: "singkat" }).valid, false);
  assert.equal(validateInspectionForm({ mode: "WAIVED", reason: "Alasan yang cukup panjang" }).valid, true);
});

test("buildInspectionBody: hanya field relevan per mode; override + edukasi hanya untuk hasil selain Pas; baris bahan kosong dibuang", () => {
  const pass = buildInspectionBody({ mode: "PASS", photoUrls: PHOTO, referenceWeightKg: "60", note: " ok " }, 4);
  assert.deepEqual(pass, { expectedRevision: 4, result: "PASS", photoUrls: PHOTO, referenceWeightKg: 60, note: "ok", fitVerdict: "PAS" });
  const override = buildInspectionBody({ mode: "PASS", photoUrls: PHOTO, referenceWeightKg: 60, fitVerdict: "TERLALU_KERAS", customerPreferenceOverride: "LEBIH_KERAS", educationGiven: true }, 4);
  assert.equal(override.customerPreferenceOverride, "LEBIH_KERAS"); assert.equal(override.educationGiven, true);
  const fail = buildInspectionBody({ mode: "FAIL", photoUrls: PHOTO, referenceWeightKg: 50, fitVerdict: "TERLALU_KERAS", note: "keras", reworkStageId: "s1", materials: [{ materialId: "", qty: 1 }, { materialId: "m1", qty: "2" }] }, 5);
  assert.deepEqual(fail.supplementalMaterials, [{ materialId: "m1", qty: 2 }]); assert.equal(fail.reworkStageId, "s1");
  assert.deepEqual(buildInspectionBody({ mode: "WAIVED", reason: " Alasan yang cukup panjang " }, 6), { expectedRevision: 6, result: "WAIVED", reason: "Alasan yang cukup panjang" });
});

test("tahap rework hanya SEBELUM gerbang QC; aksi QC hanya saat Menunggu QC tanpa konflik", () => {
  const run = { state: "AWAITING_QC", conflict: null, stages: [{ id: "a", order: 1 }, { id: "b", order: 2 }, { id: "qc", order: 3, isQcGate: true }, { id: "c", order: 4 }] };
  assert.deepEqual(reworkStageOptions(run).map((s) => s.id), ["a", "b"]);
  assert.deepEqual(reworkStageOptions({ stages: [] }), []);
  assert.equal(canRecordInspection(run), true);
  assert.equal(canRecordInspection({ ...run, conflict: { open: false } }), false);
  assert.equal(canRecordInspection({ ...run, state: "REWORK" }), false);
});

test("form tindak lanjut penolakan: catatan wajib; rework wajib tahap", () => {
  assert.equal(validateNoteForm({ note: "", action: "REOFFER" }).valid, false);
  assert.equal(validateNoteForm({ note: "sudah dijahit ulang", action: "REOFFER" }).valid, true);
  assert.equal(validateNoteForm({ note: "ganti ukuran", action: "REWORK" }).valid, false);
  assert.equal(validateNoteForm({ note: "ganti ukuran", action: "REWORK", reworkStageId: "s1" }).valid, true);
});

test("pesan galat dan ringkasan: revisi basi, konflik, waive; ringkasan hasil per skenario", () => {
  assert.match(qcErrorMessage({ code: "QC_REVISION_CONFLICT" }), /muat ulang/);
  assert.match(qcErrorMessage({ code: "PRODUCTION_RUN_INCONSISTENT" }), /rekonsiliasi/);
  assert.match(qcErrorMessage({ code: "QC_WAIVE_FORBIDDEN" }), /ADMIN\/OWNER/);
  assert.equal(qcErrorMessage({ code: "LAIN", message: "pesan server" }), "pesan server");
  assert.equal(qcErrorMessage({}), "Gagal memproses perintah");
  assert.match(nextInspectionSummary({ result: "PASS", nextPhase: "PROCESS" }), /Jahit Corner/);
  assert.match(nextInspectionSummary({ result: "PASS", nextPhase: "HANDOFF" }), /ditawarkan ke Gudang/);
  assert.match(nextInspectionSummary({ result: "FAIL", reworkStage: { label: "Lapisan" }, supplementalIssue: { issueId: "x" } }), /bahan tambahan/);
  assert.match(nextInspectionSummary({ result: "WAIVED" }), /di-waive/);
  assert.match(nextInspectionSummary({ replayed: true }), /sudah diproses/);
  assert.match(conflictKindLabelSafe("UNIT_SHIPPED"), /dikirim/);
  assert.equal(resolutionLabel("ACCEPT_OVERRIDE"), "Terima override (tanpa QC/custody)");
  assert.equal(resolutionLabel("X"), "X");
});
function conflictKindLabelSafe(kind) { return CONFLICT_KIND_LABEL[kind] || kind; }

test("status kosong QC: reader OFF = fitur canary (bukan galat); tab kosong biasa", () => {
  assert.equal(emptyStateCopy({ readerMode: "OFF", tab: "AWAITING_QC" }).belumAktif, true);
  const copy = emptyStateCopy({ readerMode: "COHORT", tab: "REJECTED" });
  assert.equal(copy.belumAktif, false); assert.match(copy.title, /ditolak gudang/);
});

test("Gudang barang jadi: tab, badge, lokasi hanya area barang jadi/dispatch aktif, form terima/tolak, galat, kosong", () => {
  assert.deepEqual(FG_TABS.map((t) => t.key), ["OFFERED", "ACCEPTED", "REJECTED", "HISTORY"]);
  assert.equal(fgStatusBadgeFor("REJECTED").label, "Ditolak — kembali ke Produksi");
  assert.equal(fgStatusBadgeFor("X").label, "X");
  assert.equal(isFgDecisionPending("OFFERED"), true);
  assert.equal(isFgDecisionPending("ACCEPTED"), false);
  const locations = [
    { id: "1", active: true, locationType: "FINISHED_GOODS_AREA" }, { id: "2", active: true, locationType: "DISPATCH_AREA" },
    { id: "3", active: false, locationType: "FINISHED_GOODS_AREA" }, { id: "4", active: true, locationType: "RECEIVING_AREA" }, { id: "5", active: true, locationType: "QUARANTINE_AREA" },
  ];
  assert.deepEqual(locationsForFinishedGoods(locations).map((l) => l.id), ["1", "2"]);
  assert.equal(validateAcceptForm({ locationId: "" }).valid, false);
  assert.equal(validateAcceptForm({ locationId: "1" }).valid, true);
  assert.equal(validateRejectForm({ reason: " " }).valid, false);
  assert.equal(validateRejectForm({ reason: "cover sobek" }).valid, true);
  assert.match(fgErrorMessage({ code: "CUSTODY_REVISION_CONFLICT" }), /muat ulang/);
  assert.match(fgErrorMessage({ code: "CUSTODY_LOCATION_TYPE_INVALID" }), /barang jadi/);
  assert.match(fgErrorMessage({ code: "PRODUCTION_RUN_INCONSISTENT" }), /rekonsiliasi/);
  assert.equal(fgEmptyStateCopy({ readerMode: "OFF", tabKey: "OFFERED" }).belumAktif, true);
  assert.match(fgEmptyStateCopy({ readerMode: "GLOBAL", tabKey: "OFFERED" }).title, /menunggu/);
  assert.match(acceptSummary({}, "UNIT-1"), /siap kirim/);
  assert.match(rejectSummary({}, "UNIT-1"), /dikembalikan ke Produksi/);
  assert.match(acceptSummary({ replayed: true }, "UNIT-1"), /Sudah diproses/);
});
