// Fase 3 Produksi LAYANAN — analisis & racikan: konteks analisis, racikan rencana vs hasil aktual (lapisan atas->bawah, ketebalan, total), atribut katalog, PIC Bahan per pekerjaan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as M from "../src/features/production/componentNotes/componentNotesModel.js";
import * as B from "../../backend/src/lib/domain/productionComponents.js";
import { buildMaterialRecordBody, isPicRestoration, materialsByPic, stepMaterialsByPic, validateMaterialRecord, validateStepForm, buildStepPayload, waitCopy } from "../src/features/production/experience.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const CAT = { kind: "CATALOG", materialId: "11111111-1111-4111-8111-111111111111", code: "FOAM-1", name: "Busa HR", unit: "PCS", supplier: "CV Busa", itemGroup: "HR FOAM" };

test("PLAN_RACIKAN terdaftar (paritas backend), ditampilkan sebelum hasil aktual, fokus di tahap diagnosa", () => {
  assert.deepEqual(M.SECTIONS.map((s) => [s.key, s.label]), Object.values(B.COMPONENT_SECTIONS).map((s) => [s.key, s.label]));
  assert.equal(M.SECTION_BY_KEY.PLAN_RACIKAN.label, "Racikan rencana"); assert.equal(!!M.SECTION_BY_KEY.PLAN_RACIKAN.qc, false, "PIC Meja dan PIC QC sama-sama boleh menentukan racikan");
  assert.ok(M.DISPLAY_ORDER.indexOf("PLAN_RACIKAN") < M.DISPLAY_ORDER.indexOf("AFTER"), "rencana tampil sebelum hasil aktual");
  assert.deepEqual(M.focusFor(5), ["LAYERS_BEFORE", "FOUNDATION_BEFORE", "PLAN_RACIKAN"]); assert.match(M.focusCopy(5).title, /racikan rencana/i);
  assert.deepEqual(M.focusFor(6), ["AFTER"]);
});

test("draf racikan rencana <-> payload: tindakan dipertahankan/diperbaiki/diganti, lapisan atas->bawah, ketebalan opsional; validasi sama dengan hasil akhir", () => {
  const d = M.draftFromEntry("PLAN_RACIKAN", null);
  assert.equal(M.validateDraft("PLAN_RACIKAN", { ...d, foundationOn: false }), "Isi fondasi atau minimal satu lapisan pada racikan rencana.");
  const draft = { ...d, foundationOn: true, foundation: { action: "REPAIR", system: "BONNELL", material: { kind: "MANUAL", text: "Per cadangan" }, note: "" }, layers: [
    { id: "a", action: "REPLACE", fromOrder: "", material: CAT, thickness: "7", note: "" }, { id: "b", action: "KEEP", fromOrder: "2", material: null, thickness: "", note: "" }, { id: "c", action: "REPLACE", fromOrder: "", material: { kind: "UNKNOWN" }, thickness: "", note: "" }] };
  assert.equal(M.validateDraft("PLAN_RACIKAN", draft), null);
  const p = M.payloadFromDraft("PLAN_RACIKAN", draft);
  assert.deepEqual(p.layers.map((l) => [l.action, l.fromOrder, l.thicknessCm]), [["REPLACE", null, 7], ["KEEP", 2, null], ["REPLACE", null, null]]);
  assert.equal(M.validateDraft("PLAN_RACIKAN", { ...draft, layers: [{ ...draft.layers[0], material: null }] }), "Lapisan 1: pilih bahan, “Bahan manual”, atau “Tidak diketahui”.", "ganti wajib menyebut bahan (katalog/manual/tidak diketahui)");
  assert.match(M.validateDraft("PLAN_RACIKAN", { ...draft, layers: [{ ...draft.layers[0], thickness: "150" }] }), /ketebalan/i);
  const back = M.draftFromEntry("PLAN_RACIKAN", { version: 1, data: { foundation: { action: "REPAIR", system: "BONNELL", material: { kind: "MANUAL", text: "x1" }, note: null }, layers: [{ action: "REPLACE", fromOrder: null, material: CAT, thicknessCm: 7, note: null }], note: null }, media: [] });
  assert.equal(back.layers[0].material.supplier, "CV Busa", "atribut katalog yang ada tetap terbawa di draf"); assert.equal(back.layers[0].thickness, "7");
});

test("total tinggi (pratinjau): KEEP/REPAIR mewarisi catatan awal; kosong = belum lengkap bukan 0; paritas dengan server", () => {
  const before = [{ thicknessCm: 6 }, { thicknessCm: 4 }];
  const rows = [{ action: "REPLACE", fromOrder: "", thickness: "7" }, { action: "KEEP", fromOrder: "2", thickness: "" }, { action: "REPLACE", fromOrder: "", thickness: "" }];
  const s = M.summarizeResultDraft({ layers: rows }, before);
  assert.deepEqual([s.total, s.complete], [11, false]); assert.match(s.text, /belum lengkap/);
  const full = M.summarizeResultDraft({ layers: rows.slice(0, 2) }, before); assert.deepEqual([full.total, full.complete], [11, true]);
  assert.equal(M.summarizeResultDraft({ layers: [] }, before).total, null); assert.equal(M.summarizeResultDraft({ layers: [{ action: "REPLACE", fromOrder: "", thickness: "" }] }, []).total, null);
  const server = B.summarizeResultLayers({ layers: [{ action: "REPLACE", material: { kind: "UNKNOWN" }, thicknessCm: 7 }, { action: "KEEP", fromOrder: 2 }, { action: "REPLACE", material: { kind: "UNKNOWN" } }] }, { layers: before });
  assert.deepEqual([server.totalThicknessCm, server.totalComplete], [s.total, s.complete], "pratinjau klien = hitungan server");
});

test("atribut katalog: paritas klien <-> server; hanya yang tersedia; kosong tidak dikarang; manual/tidak diketahui tetap sah", () => {
  for (const ref of [CAT, { kind: "CATALOG", code: "X", name: "Y", unit: "KG" }, { kind: "CATALOG", code: "X", name: "Y", unit: "KG", density: 44 }, { kind: "MANUAL", text: "Latex bekas" }, { kind: "UNKNOWN" }, null]) {
    assert.deepEqual(M.materialAttributes(ref), B.materialAttributes(ref), JSON.stringify(ref));
  }
  assert.deepEqual(M.materialAttributes({ kind: "CATALOG", code: "X", name: "Y", unit: "KG" }).map((a) => a.key), ["code", "name", "unit"], "tanpa supplier/kelompok bila master kosong");
  assert.equal(M.materialAttributes(CAT).some((a) => ["density", "thicknessCm"].includes(a.key)), false, "densitas/ketebalan katalog tidak ada di master -> tidak ditampilkan");
  const picker = strip(src("features", "production", "componentNotes", "MaterialPicker.jsx"));
  assert.match(picker, /export function MaterialAttrs/); assert.match(picker, /data-testid="material-attrs"/); assert.match(picker, /material-mode-manual|"MANUAL"/); assert.match(picker, /UNKNOWN_LABEL/);
});

test("kontrak UI: konteks analisis (Sales + komponen lama + QC awal + uji fondasi) baca-saja dari satu endpoint; rencana vs aktual; racikan rencana di lembar yang sama", () => {
  const ac = strip(src("features", "production", "componentNotes", "AnalysisContext.jsx"));
  for (const id of ["analysis-context", "analysis-old-components", "analysis-layers", "analysis-qc", "analysis-whole", "analysis-foundation-test", "sales-context"]) assert.ok(ac.includes(id) || id === "sales-context", id);
  assert.match(ac, /SalesContextBox/); assert.doesNotMatch(ac, /api\./, "tanpa pengambilan data sendiri (data dari panel/endpoint yang sama)");
  const pva = strip(src("features", "production", "componentNotes", "PlanVsActual.jsx"));
  for (const id of ["plan-vs-actual", "pva-plan", "pva-actual", "pva-total", "pva-layer-row", "pva-unavailable"]) assert.ok(pva.includes(id), id);
  assert.match(strip(src("features", "production", "componentNotes", "BeforeAfterSummary.jsx")), /<PlanVsActual comparison=\{comparison\} \/>/);
  const sheet = strip(src("features", "production", "componentNotes", "ComponentNoteSheet.jsx"));
  assert.match(sheet, /section === "PLAN_RACIKAN"/); assert.match(sheet, /plan-total-preview/); assert.match(sheet, /<AnalysisContext data=\{analysis\} \/>/); assert.match(sheet, /planned/);
  const panel = strip(src("features", "production", "componentNotes", "ComponentNotesPanel.jsx"));
  assert.match(panel, /showAnalysis && <AnalysisContext data=\{data\} \/>/); assert.match(panel, /analysis=\{sheet === "PLAN_RACIKAN" \? data : null\}/);
  const jd = strip(src("features", "production", "workerApp", "JobDetail.jsx"));
  assert.match(jd, /showAnalysis=\{card\.track !== "BUILD"\}/, "konteks analisis di Meja untuk LAYANAN; jalur BUILD tidak berubah");
});

test("layanan Sales tetap acuan: wizard diagnosis tidak punya pilihan layanan teknis (hanya baca)", () => {
  const w = strip(src("features", "production", "DiagnosisWizard.jsx"));
  assert.match(w, /data-testid="sales-ordered-service"/); assert.match(w, /hanya baca/); assert.match(src("features", "production", "DiagnosisWizard.jsx"), /operator TIDAK memilih layanan lagi/i);
  assert.doesNotMatch(w, /<select[^>]*(service|layanan)/i, "tidak ada dropdown layanan teknis");
  assert.doesNotMatch(w, /recommendedServiceId\s*:\s*[^u\n]/, "layanan teknis tidak dikirim dari pilihan operator");
});

test("PIC Bahan LAYANAN: pemakaian aktual dicatat PIC Bahan; Meja tidak mengisi bahan lagi (tahap 6 dan 7); racikan tidak diketik ulang; menunggu bila belum tercatat", () => {
  const picked = { track: "RESTORATION", materialPic: { materialOperator: { id: "op1", name: "Febri" }, record: null } };
  const none = { track: "RESTORATION", materialPic: null }; const build = { track: "BUILD", build: { materialOperator: { id: "op1" } } };
  assert.equal(isPicRestoration(picked), true); assert.equal(isPicRestoration(none), false); assert.equal(isPicRestoration(build), false);
  assert.equal(materialsByPic(picked), true); assert.equal(materialsByPic(none), false); assert.equal(materialsByPic(build), true);
  assert.equal(stepMaterialsByPic(picked, 6), true); assert.equal(stepMaterialsByPic(picked, 7), true); assert.equal(stepMaterialsByPic(none, 6), false);
  assert.equal(stepMaterialsByPic(build, 6), true); assert.equal(stepMaterialsByPic(build, 7), false, "jalur BUILD tidak berubah");
  const media = [{ status: "done", kind: "video" }];
  assert.equal(validateStepForm(6, { note: "Fondasi baru dipasang" }, { mediaItems: media, track: "RESTORATION", byPic: true }), null);
  assert.match(validateStepForm(6, { note: "Fondasi baru dipasang" }, { mediaItems: media, track: "RESTORATION", byPic: false }), /bahan Gudang/);
  assert.equal(validateStepForm(7, {}, { mediaItems: [{ status: "done", kind: "image" }], track: "RESTORATION", byPic: true }), null);
  assert.deepEqual(buildStepPayload(7, { materials: [{ materialId: "m", qty: "1" }] }, { track: "RESTORATION", byPic: true }).materials, []);
  assert.deepEqual(buildStepPayload(6, { materials: [{ materialId: "m", qty: "1" }], note: "x" }, { track: "RESTORATION", byPic: true }).materials, []);
  assert.match(waitCopy({ wait: "USAGE_NOT_RECORDED" }).text, /PIC Bahan/);
  // lembar PIC Bahan LAYANAN: hanya bahan dari yang diserahkan Gudang; tanpa racikan
  const issued = [{ materialId: "m1", qty: 2, name: "Pocket" }];
  assert.equal(validateMaterialRecord({ materials: [] }, { flow: "RESTORATION", issued }), "Isi pemakaian bahan.");
  assert.match(validateMaterialRecord({ materials: [{ materialId: "m9", qty: "1" }] }, { flow: "RESTORATION", issued }), /diserahkan Gudang/);
  assert.match(validateMaterialRecord({ materials: [{ materialId: "m1", qty: "3" }] }, { flow: "RESTORATION", issued }), /melebihi/);
  assert.equal(validateMaterialRecord({ materials: [{ materialId: "m1", qty: "1" }] }, { flow: "RESTORATION", issued }), null);
  const body = buildMaterialRecordBody({ racikanFondasi: "tidak boleh terkirim", materials: [{ materialId: "m1", qty: "1" }] }, { flow: "RESTORATION", revision: 4 });
  assert.equal("racikan" in body, false); assert.deepEqual(body.materials, [{ materialId: "m1", qty: 1 }]);
  const sheet = strip(src("features", "production", "workerApp", "materialSheet.jsx"));
  assert.match(sheet, /restoration \? "RESTORATION"/); assert.match(sheet, /material-restoration-note/);
  assert.match(strip(src("features", "production", "workerApp", "JobDetail.jsx")), /data-testid="pic-bahan-usage"/);
});

test("dokumentasi tidak wajib pada analisis/racikan (frontend): racikan rencana tanpa minimal media; konteks analisis tidak mengunggah apa pun", () => {
  assert.equal(M.minMediaFor("PLAN_RACIKAN"), 0); assert.equal(M.maxMediaFor("PLAN_RACIKAN"), 8);
  const d = { ...M.draftFromEntry("PLAN_RACIKAN", null), foundationOn: true, foundation: { action: "KEEP", system: "", material: null, note: "" } };
  assert.equal(M.validateDraft("PLAN_RACIKAN", d), null, "tanpa foto/video pun sah");
});
