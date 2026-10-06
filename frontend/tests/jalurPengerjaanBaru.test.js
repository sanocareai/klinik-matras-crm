// Jalur PENGERJAAN PESANAN (BARU/custom): label tahap 6, tahap tidak berlaku, bahan opsional, tanpa Diagnosis/layanan teknis di UI.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_STEP, STEP_BY_NO, actionLabel, bucketLabelOf, buildStepPayload, indicatorList, isNonKasur, mediaRuleFor, productFlowOf, stepOf, validateStepForm } from "../src/features/production/experience.js";
import { buildInspectionBody, validateInspectionForm } from "../src/features/production/qcHandoff.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");
const VID = { status: "done", kind: "video", url: "/media/x.mp4" };

test("tahap 6 bernama Pengerjaan Pesanan hanya pada jalur BUILD; jalur lama tidak berubah", () => {
  assert.equal(stepOf(6, "BUILD").label, "Pengerjaan Pesanan");
  assert.equal(stepOf(6, "RESTORATION").label, STEP_BY_NO[6].label);
  assert.equal(stepOf(6, undefined).label, "Fondasi Baru");
  assert.equal(stepOf(8, "BUILD").label, STEP_BY_NO[8].label);
  assert.equal(BUILD_STEP.no, 6);
});

test("tombol aksi memakai label jalur: Mulai Pengerjaan Pesanan / Kirim Bukti Pengerjaan Pesanan", () => {
  assert.equal(actionLabel({ action: "START", stepNo: 6 }, { track: "BUILD" }), "Mulai Pengerjaan Pesanan");
  assert.equal(actionLabel({ action: "START", stepNo: 6 }, {}), "Mulai Fondasi Baru");
  assert.equal(actionLabel({ action: "EVIDENCE", stepNo: 6 }, { track: "BUILD" }), "Kirim Bukti Pengerjaan Pesanan");
});

test("validasi tahap 6 BUILD kasur: racikan wajib (fondasi dan/atau lapisan), bahan opsional, foto cukup tanpa video; jalur lama tetap wajib bahan+video", () => {
  const IMGM = { status: "done", kind: "image", url: "/media/x.jpg" };
  const ok = { materials: [], note: "Sesuai spesifikasi", racikanFondasi: "Pocket spring 25 cm", racikanLapisan: "" };
  assert.equal(validateStepForm(6, ok, { mediaItems: [IMGM], track: "BUILD", flow: "KASUR" }), null, "foto cukup, bahan opsional, racikan fondasi saja cukup");
  assert.equal(validateStepForm(6, { ...ok, racikanFondasi: "", racikanLapisan: "Latex 3 cm" }, { mediaItems: [VID], track: "BUILD", flow: "KASUR" }), null);
  assert.match(validateStepForm(6, { ...ok, racikanFondasi: "" }, { mediaItems: [VID], track: "BUILD", flow: "KASUR" }), /racikan/i);
  assert.match(validateStepForm(6, { ...ok, note: "" }, { mediaItems: [VID], track: "BUILD", flow: "KASUR" }), /pengerjaan pesanan/i);
  assert.match(validateStepForm(6, ok, { mediaItems: [], track: "BUILD", flow: "KASUR" }), /foto|video/i, "bukti tetap wajib");
  assert.equal(validateStepForm(6, { materials: [], note: "Divan sesuai ukuran pesanan" }, { mediaItems: [IMGM], track: "BUILD", flow: "NON_KASUR" }), null, "divan/sofa: tanpa racikan kasur");
  assert.match(validateStepForm(6, { materials: [], note: "Isi fondasi" }, { mediaItems: [VID] }), /bahan Gudang/);
  assert.match(validateStepForm(6, { materials: [{ materialId: "m", qty: 1 }], note: "Isi fondasi" }, { mediaItems: [IMGM] }), /video/i, "restorasi: video wajib");
});

test("payload tahap 6 BUILD: racikan hanya untuk kasur; non-kasur dan restorasi tidak mengirim racikan", () => {
  const f = { materials: [{ materialId: "m1", qty: "2" }], note: " ok ", racikanFondasi: " PS 25 ", racikanLapisan: "" };
  assert.deepEqual(buildStepPayload(6, f, { track: "BUILD", flow: "KASUR" }), { materials: [{ materialId: "m1", qty: 2 }], note: "ok", racikan: { fondasi: "PS 25", lapisan: undefined } });
  assert.equal("racikan" in buildStepPayload(6, f, { track: "BUILD", flow: "NON_KASUR" }), false);
  assert.equal("racikan" in buildStepPayload(6, f), false);
});

test("aturan media per jalur & alur produk dari klasifikasi server", () => {
  assert.deepEqual(mediaRuleFor(6, "BUILD"), { min: 1, video: false });
  assert.deepEqual(mediaRuleFor(6, undefined), { min: 1, video: true });
  assert.equal(productFlowOf({ track: "BUILD", product: { flow: "NON_KASUR" } }), "NON_KASUR");
  assert.equal(productFlowOf({ track: "BUILD" }), "KASUR", "klasifikasi belum ada -> alur kasur (tidak melonggarkan)");
  assert.equal(productFlowOf({ track: "RESTORATION" }), null);
  assert.equal(isNonKasur({ track: "BUILD", product: { flow: "NON_KASUR" } }), true);
});

test("QC non-kasur (GENERIC): tanpa berat acuan/uji berat badan; kasur tetap wajib", () => {
  const generic = { mode: "PASS", photoUrls: ["/media/p.jpg"], note: "" };
  assert.deepEqual(validateInspectionForm(generic, { profile: "GENERIC" }), { valid: true, errors: [] });
  assert.equal(validateInspectionForm(generic).valid, false, "profil kasur: berat acuan wajib");
  assert.equal(validateInspectionForm({ ...generic, photoUrls: [] }, { profile: "GENERIC" }).valid, false, "foto bukti tetap wajib");
  assert.equal(validateInspectionForm({ mode: "FAIL", photoUrls: ["/p.jpg"], note: "Rangka miring", reworkStageId: "s1", materials: [] }, { profile: "GENERIC" }).valid, true);
  assert.equal(validateInspectionForm({ mode: "FAIL", photoUrls: ["/p.jpg"], note: "ab", reworkStageId: "", materials: [] }, { profile: "GENERIC" }).valid, false);
  assert.deepEqual(buildInspectionBody(generic, 4, { profile: "GENERIC" }), { expectedRevision: 4, result: "PASS", photoUrls: ["/media/p.jpg"], note: undefined });
  const fail = buildInspectionBody({ mode: "FAIL", photoUrls: ["/p.jpg"], note: "Rangka miring", reworkStageId: "s1", materials: [] }, 5, { profile: "GENERIC" });
  assert.equal("referenceWeightKg" in fail, false); assert.equal("fitVerdict" in fail, false); assert.equal(fail.reworkStageId, "s1");
});

test("bucket Fondasi Baru bernama Pengerjaan Pesanan pada jalur BUILD", () => {
  assert.equal(bucketLabelOf("FONDASI", "BUILD"), "Pengerjaan Pesanan");
  assert.equal(bucketLabelOf("FONDASI", "RESTORATION"), "Fondasi Baru");
  assert.equal(bucketLabelOf("QC", "BUILD"), "QC / Rework");
});

test("indikator layanan TIDAK_BERLAKU tampil hijau (bukan kekurangan data); BOM OPSIONAL netral", () => {
  const list = indicatorList({ service: "TIDAK_BERLAKU", bom: "OPSIONAL" });
  assert.equal(list.find((i) => i.key === "service").tone, "green");
  assert.equal(list.find((i) => i.key === "bom").tone, "neutral");
});

test("Unit 360: tahap tidak berlaku ditulis 'tidak berlaku'; panel Diagnosis diganti catatan pada jalur BUILD", () => {
  const drawer = src("features", "production", "UnitOverviewDrawer.jsx");
  assert.match(drawer, /data-testid="step-na"[^>]*>tidak berlaku</);
  assert.match(drawer, /d\.production\.track === "BUILD"/);
  assert.match(drawer, /data-testid="build-track-note"/);
});

test("lembar bukti & detail pekerja memakai label per jalur (card.track)", () => {
  assert.match(src("features", "production", "workerApp", "workerSheets.jsx"), /stepOf\(stepNo, card\.track\)/);
  assert.match(src("features", "production", "workerApp", "JobDetail.jsx"), /track: card\.track/);
  assert.match(src("features", "production", "components", "StepForm.jsx"), /Penjelasan pengerjaan pesanan/);
  assert.match(src("features", "production", "components", "StepForm.jsx"), /data-testid="racikan-fields"/);
  assert.match(src("pages", "bengkel", "ProductionQc.jsx"), /qc-generic-note/);
  assert.match(src("pages", "bengkel", "ProductionQc.jsx"), /qc-racikan/);
});
