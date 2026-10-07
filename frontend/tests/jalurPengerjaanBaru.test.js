// Jalur PENGERJAAN PESANAN (BARU/custom): label tahap 6, tahap tidak berlaku, bahan opsional, tanpa Diagnosis/layanan teknis di UI.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_STEP, STEP_BY_NO, actionLabel, bucketLabelOf, buildStepPayload, indicatorList, buildMaterialRecordBody, isNonKasur, isUnconfirmed, materialsByPic, mediaRuleFor, productFlowOf, stepOf, validateMaterialRecord, validateStepForm, waitCopy } from "../src/features/production/experience.js";
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
  assert.equal(productFlowOf({ track: "BUILD" }), "UNCONFIRMED", "klasifikasi belum ada -> TIDAK ada fallback ke kasur");
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
  assert.match(src("pages", "bengkel", "ProductionQc.jsx"), /run\.qcProfile === "GENERIC" \? "Pemeriksaan Hasil"/, "gerbang QC divan/sofa tidak bernama Uji Berat Badan");
});

test("jenis belum jelas (UNCONFIRMED): tanpa fallback kasur — catatan/dokumentasi UMUM boleh dikirim (tanpa racikan), kebutuhan konfirmasi dijelaskan", () => {
  const IMGM = { status: "done", kind: "image", url: "/media/x.jpg" };
  assert.equal(isUnconfirmed({ track: "BUILD", product: { flow: "UNCONFIRMED" } }), true);
  assert.equal(isUnconfirmed({ track: "BUILD" }), true, "klasifikasi belum ada = belum jelas");
  assert.equal(validateStepForm(6, { note: "Rangka dirakit" }, { mediaItems: [IMGM], track: "BUILD", flow: "UNCONFIRMED" }), null, "catatan umum + foto cukup");
  assert.match(validateStepForm(6, { note: "" }, { mediaItems: [IMGM], track: "BUILD", flow: "UNCONFIRMED" }), /Jelaskan pengerjaan/, "penjelasan tetap wajib");
  assert.match(validateStepForm(6, { note: "Rangka dirakit" }, { mediaItems: [], track: "BUILD", flow: "UNCONFIRMED" }), /minimal 1 foto/, "dokumentasi tetap wajib");
  assert.deepEqual(buildStepPayload(6, { note: "Rangka dirakit", racikanFondasi: "Pocket spring" }, { track: "BUILD", flow: "UNCONFIRMED" }), { materials: [], note: "Rangka dirakit" }, "racikan khusus jenis produk TIDAK dikirim");
  assert.equal(actionLabel({ action: "EVIDENCE", stepNo: 6, general: true, hold: "PRODUCT_TYPE_UNCONFIRMED" }, { track: "BUILD" }), "Kirim Catatan & Dokumentasi Umum");
  const w = waitCopy({ wait: "PRODUCT_TYPE_UNCONFIRMED", problem: "Lini produk (KASUR) tidak sesuai jenis produk (SOFA_L)" });
  assert.match(w.title, /perlu dikonfirmasi/); assert.match(w.text, /tidak sesuai jenis produk/); assert.match(w.text, /tidak mengubah order/); assert.match(w.text, /dokumentasi umum tetap bisa disimpan/);
  assert.match(waitCopy({ wait: "CORNER_NOT_CONFIRMED" }).title, /Corner belum dikonfirmasi/);
  assert.match(waitCopy({ wait: "RACIKAN_NOT_RECORDED" }).title, /PIC Bahan/);
});

test("PIC Bahan: PIC Meja tidak mengisi ulang racikan/bahan (satu sumber); validasi & body pencatatan mengikuti server", () => {
  const IMGM = { status: "done", kind: "image", url: "/media/x.jpg" };
  const card = { track: "BUILD", product: { flow: "KASUR" }, build: { materialOperator: { id: "op", name: "Febri" } } };
  assert.equal(materialsByPic(card), true); assert.equal(materialsByPic({ track: "BUILD", build: { record: { version: 1 } } }), true); assert.equal(materialsByPic({ track: "BUILD", build: {} }), false); assert.equal(materialsByPic({ track: "RESTORATION" }), false);
  assert.equal(validateStepForm(6, { note: "Selesai" }, { mediaItems: [IMGM], track: "BUILD", flow: "KASUR", byPic: true }), null, "racikan dari PIC Bahan");
  assert.match(validateStepForm(6, { note: "Selesai" }, { mediaItems: [IMGM], track: "BUILD", flow: "KASUR", byPic: false }), /racikan/i);
  const p = buildStepPayload(6, { note: "ok", materials: [{ materialId: "m", qty: "2" }], racikanFondasi: "PS" }, { track: "BUILD", flow: "KASUR", byPic: true });
  assert.deepEqual(p, { materials: [], note: "ok" }, "tidak mengirim bahan/racikan bila dicatat PIC Bahan");
  const issued = [{ materialId: "m1", name: "Pocket Spring", qty: 2 }, { materialId: "m2", name: "Latex", qty: 3 }];
  const good = { racikanFondasi: "Pocket spring 25 cm", racikanLapisan: "", materials: [{ materialId: "m1", qty: "1" }], note: "" };
  assert.equal(validateMaterialRecord(good, { flow: "KASUR", issued }), null);
  assert.match(validateMaterialRecord({ ...good, materials: [{ materialId: "m1", qty: "5" }] }, { flow: "KASUR", issued }), /melebihi yang diserahkan Gudang/);
  assert.match(validateMaterialRecord({ ...good, materials: [{ materialId: "zzz", qty: "1" }] }, { flow: "KASUR", issued }), /dari bahan yang diserahkan Gudang/);
  assert.match(validateMaterialRecord({ racikanFondasi: "", racikanLapisan: "", materials: [] }, { flow: "KASUR", issued }), /Isi racikan/);
  assert.match(validateMaterialRecord({ racikanFondasi: "ab", materials: [{ materialId: "m1", qty: "1" }] }, { flow: "KASUR", issued }), /minimal 3/);
  assert.match(validateMaterialRecord(good, { flow: "UNCONFIRMED", issued }), /Jenis produk belum jelas/, "racikan kasur ditahan");
  assert.equal(validateMaterialRecord({ materials: [{ materialId: "m1", qty: "1" }] }, { flow: "UNCONFIRMED", issued }), null, "pemakaian bahan tetap bisa dicatat");
  assert.equal(validateMaterialRecord({ materials: [{ materialId: "m1", qty: "1" }] }, { flow: "NON_KASUR", issued }), null);
  assert.deepEqual(buildMaterialRecordBody(good, { flow: "KASUR", revision: 7 }), { expectedRevision: 7, materials: [{ materialId: "m1", qty: 1 }], racikan: { fondasi: "Pocket spring 25 cm", lapisan: undefined } });
  assert.equal("racikan" in buildMaterialRecordBody(good, { flow: "NON_KASUR", revision: 7 }), false, "non-kasur tidak mengirim racikan");
});

test("UI jalur pengerjaan: antrean/lembar PIC Bahan, panel rencana (Corner + PIC Bahan) di Unit 360, QC menahan putusan bila jenis belum jelas / Corner belum dikonfirmasi", () => {
  const sheet = src("features", "production", "workerApp", "materialSheet.jsx");
  assert.match(sheet, /api\.recordProductionV2BuildMaterials\(card\.runId, body, key\)/, "command resmi, bukan status lokal");
  assert.match(sheet, /material-record-submit/); assert.match(sheet, /intentKeysMaterial\.keyFor/, "Idempotency-Key per niat");
  assert.match(src("features", "production", "workerApp", "JobDetail.jsx"), /open-material-record/); assert.match(src("features", "production", "workerApp", "JobDetail.jsx"), /lane === "MATERIAL"/);
  assert.match(src("routes", "pageRegistry.jsx"), /path: "\/produksi\/bahan"/);
  assert.match(src("features", "production", "workerApp", "useWorkerJobs.js"), /lane === "MATERIAL" \? "material"/);
  const panel = src("features", "production", "BuildPlanPanel.jsx");
  assert.match(panel, /confirmProductionV2BuildCorner/); assert.match(panel, /setProductionV2BuildMaterialOperator/); assert.match(panel, /build-corner-save/); assert.match(panel, /build-pic-save/);
  assert.match(panel, /Corner tidak diperlukan wajib beralasan/); assert.match(panel, /Produksi tidak mengubah order/);
  assert.match(src("features", "production", "UnitOverviewDrawer.jsx"), /<BuildPlanPanel d=\{d\} canPlan=\{canApplyAdaptation\}/);
  const qc = src("pages", "bengkel", "ProductionQc.jsx");
  assert.match(qc, /qc-unconfirmed-hold/); assert.match(qc, /qc-corner-hold/); assert.match(qc, /unconfirmed && mode !== "WAIVED"/);
  assert.match(src("pages", "bengkel", "ProductionPlannerV2.jsx"), /\{canRoute && <MorningPriorityApprovalPanel \/>\}/, "403 morning-priority: tidak diminta oleh peran tanpa izin");
});
