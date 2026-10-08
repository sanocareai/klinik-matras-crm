// Fase 4 Produksi LAYANAN — perakitan, uji PIC QC setelah perbaikan, ringkasan perjalanan unit.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as M from "../src/features/production/componentNotes/componentNotesModel.js";
import * as B from "../../backend/src/lib/domain/productionComponents.js";
import { actionLabel, isQuickAction, validateStepForm, waitCopy } from "../src/features/production/experience.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const done = [{ id: "m", kind: "video", status: "done", url: "/media/production-evidence/" + "c".repeat(40) + ".mp4", caption: "" }];

test("seksi uji setelah perbaikan: terdaftar sebagai QC (paritas backend), media minimal 1, urutan tampil rencana -> aktual -> uji", () => {
  assert.deepEqual(M.SECTIONS.map((s) => [s.key, s.label]), Object.values(B.COMPONENT_SECTIONS).map((s) => [s.key, s.label]));
  assert.deepEqual(M.SECTIONS.filter((s) => s.qc).map((s) => s.key), B.QC_SECTION_KEYS);
  assert.equal(M.minMediaFor("FOUNDATION_TEST_AFTER"), 1); assert.equal(M.minMediaFor("WHOLE_TEST_AFTER"), 1); assert.equal(M.maxMediaFor("WHOLE_TEST_AFTER"), 12);
  assert.ok(M.DISPLAY_ORDER.indexOf("AFTER") < M.DISPLAY_ORDER.indexOf("FOUNDATION_TEST_AFTER") && M.DISPLAY_ORDER.indexOf("FOUNDATION_TEST_AFTER") < M.DISPLAY_ORDER.indexOf("WHOLE_TEST_AFTER"));
});

test("formulir uji fondasi baru: draf <-> payload (penurunan TIDAK dikirim, penanda metode sama dikirim), validasi sama dengan uji awal", () => {
  const d = { ...M.draftFromEntry("FOUNDATION_TEST_AFTER", null), system: "BONNELL", unloadedHeight: "25", loadedHeight: "23", testerWeight: "75", testMethod: "Beban di tengah rangka", sameMethod: true, media: done };
  assert.equal(M.validateDraft("FOUNDATION_TEST_AFTER", d), null);
  const p = M.payloadFromDraft("FOUNDATION_TEST_AFTER", d); assert.equal(p.sameMethodAsBefore, true); assert.equal("dropCm" in p, false); assert.deepEqual([p.unloadedHeightCm, p.loadedHeightCm], [25, 23]);
  assert.match(M.validateDraft("FOUNDATION_TEST_AFTER", { ...d, loadedHeight: "26" }), /tidak boleh lebih besar/); assert.match(M.validateDraft("FOUNDATION_TEST_AFTER", { ...d, testerWeight: "" }), /berat penguji/); assert.match(M.validateDraft("FOUNDATION_TEST_AFTER", { ...d, media: [] }), /minimal 1 foto\/video/);
  assert.equal("sameMethodAsBefore" in M.payloadFromDraft("FOUNDATION_TEST_BEFORE", d), false, "uji awal tidak berubah");
  assert.equal(M.draftFromEntry("FOUNDATION_TEST_AFTER", { data: { ...p, dropCm: 2 }, media: [] }).sameMethod, false, "membuka versi lama: konfirmasi sebanding TIDAK disalin — PIC QC mengonfirmasi ulang di setiap penyimpanan");
  assert.equal(M.draftFromEntry("WHOLE_TEST_AFTER", { data: { sameMethodAsBefore: true, complaintMatch: "SESUAI" }, media: [] }).sameMethod, false);
});

test("formulir uji kasur jadi: berat penguji tidak terisi otomatis; penurunan 0 sah; media wajib; pesan khusus kasur jadi", () => {
  const e = M.draftFromEntry("WHOLE_TEST_AFTER", null); assert.equal(e.testerWeight, ""); assert.equal(e.sameMethod, false);
  const d = { ...e, complaintMatch: "SESUAI", feelNote: "Tengah kokoh", testerWeight: "75", testMethod: "Berbaring di tengah", wholeDrop: "0", qcInFrame: true, sameMethod: true, media: done };
  assert.equal(M.validateDraft("WHOLE_TEST_AFTER", d), null); assert.equal(M.payloadFromDraft("WHOLE_TEST_AFTER", d).sameMethodAsBefore, true);
  assert.match(M.validateDraft("WHOLE_TEST_AFTER", { ...d, media: [] }), /uji kasur jadi/); assert.match(M.validateDraft("WHOLE_TEST_AFTER", { ...d, testerWeight: "" }), /berat penguji aktual/);
});

test("kesebandingan = KONFIRMASI PIC QC (tanpa toleransi berat otomatis): klien = server; belum dikonfirmasi -> dua angka mentah + alasan, tanpa selisih", () => {
  const before = { testerWeightKg: 75, testMethod: "Beban di tengah", dropCm: 10 };
  for (const [after, comparable, diff] of [
    [{ testerWeightKg: 75, dropCm: 2, sameMethodAsBefore: true }, true, 8],
    [{ testerWeightKg: 60, dropCm: 2, sameMethodAsBefore: true }, true, 8], // berat beda TAPI PIC QC mengonfirmasi sebanding -> selisih tampil
    [{ testerWeightKg: 75, dropCm: 2, sameMethodAsBefore: false }, false, null], // berat sama TAPI belum dikonfirmasi -> tidak sebanding
    [{ testerWeightKg: 60, dropCm: 2, sameMethodAsBefore: false }, false, null],
  ]) {
    const c = M.compareTestsView(before, { testMethod: "Beban di tengah", ...after }, "dropCm"); assert.deepEqual([c.comparable, c.differenceCm], [comparable, diff], JSON.stringify(after));
    const server = B.buildMeasurements({ foundationTest: { version: 1, data: B.normalizeSectionData("FOUNDATION_TEST_BEFORE", { system: "BONNELL", unloadedHeightCm: 25, loadedHeightCm: 15, testerWeightKg: 75, testMethod: "Beban di tengah" }) }, foundationAfter: { version: 1, data: B.normalizeSectionData("FOUNDATION_TEST_AFTER", { system: "BONNELL", unloadedHeightCm: 25, loadedHeightCm: 23, testerWeightKg: after.testerWeightKg, testMethod: "Beban di tengah", sameMethodAsBefore: after.sameMethodAsBefore }) } }).comparisons.foundation;
    assert.deepEqual([server.comparable, server.differenceCm], [c.comparable, c.differenceCm], "paritas klien/server");
  }
  const no = M.compareTestsView(before, { testerWeightKg: 60, testMethod: "Duduk di tengah", dropCm: 2, sameMethodAsBefore: false }, "dropCm");
  assert.match(no.text, /belum valid.*PIC QC belum mengonfirmasi.*Awal turun 10 cm \(berat 75 kg; Beban di tengah\) · sekarang turun 2 cm \(berat 60 kg; Duduk di tengah\).*tanpa selisih/);
  assert.match(M.compareTestsView(before, { testerWeightKg: 60, testMethod: "x", dropCm: 2, sameMethodAsBefore: true }, "dropCm").text, /dikonfirmasi PIC QC.*berat penguji berbeda \(awal 75 kg, baru 60 kg\), dikonfirmasi sebanding oleh PIC QC/);
  assert.equal(M.compareTestsView(null, null, "dropCm").available, false); assert.equal("COMPARABLE_WEIGHT_TOLERANCE_KG" in M, false, "tidak ada ambang berat otomatis");
  const prev = M.draftComparison("FOUNDATION_TEST_AFTER", { unloadedHeight: "25", loadedHeight: "23", testerWeight: "75", testMethod: "Beban di tengah", sameMethod: false }, { foundation: { testerWeightKg: 75, testMethod: "Beban di tengah", dropCm: 10 } }); assert.equal(prev.comparable, false, "berat sama pun tidak otomatis sebanding");
  assert.equal(M.draftComparison("FOUNDATION_TEST_AFTER", { unloadedHeight: "", loadedHeight: "", testerWeight: "", sameMethod: false }, { foundation: { testerWeightKg: 75, dropCm: 10 } }).available, false, "belum diisi: tidak ada klaim");
});

test("gerbang putusan LULUS per putaran (UI): jenis racikan fondasi/lapisan/keduanya; catatan putaran lama tidak dihitung", () => {
  assert.equal(M.decisionGate(null).ok, true); assert.equal(M.decisionGate({ applicable: false }).ok, true);
  const mk = (o) => ({ applicable: true, round: 2, hasFoundation: true, hasLayers: true, current: { foundationTest: { version: 1, ok: true }, after: { version: 2, ok: true }, wholeTest: { version: 1, ok: true } }, ...o });
  assert.deepEqual(M.decisionGate(mk({})).parts, ["uji fondasi baru", "hasil aktual susunan", "uji kasur jadi"]);
  const stale = M.decisionGate(mk({ current: { foundationTest: { version: 1, ok: true }, after: { version: 2, ok: false }, wholeTest: { version: 1, ok: false } } }));
  assert.equal(stale.ok, false); assert.match(stale.message, /putaran 2.*hasil aktual susunan \(belum diperbarui pada putaran ini\).*uji kasur jadi \(belum diuji ulang pada putaran ini\)/);
  assert.equal(M.decisionGate(mk({ hasFoundation: false, hasLayers: true, current: { foundationTest: null, after: { version: 1, ok: true }, wholeTest: { version: 1, ok: true } } })).ok, true, "hanya lapisan: tanpa uji fondasi baru");
  assert.equal(M.decisionGate(mk({ hasFoundation: true, hasLayers: false, current: { foundationTest: null, after: { version: 1, ok: true }, wholeTest: { version: 1, ok: true } } })).ok, false, "hanya fondasi: uji fondasi baru tetap wajib");
});

test("hasil aktual vs rencana: salin dari rencana; deteksi perbedaan lokal; alasan wajib bila beda; payload memuat alasan", () => {
  const plan = { data: { foundation: { action: "REPLACE", system: "BONNELL", material: { kind: "MANUAL", text: "Pocket spring" }, note: null }, layers: [{ action: "REPLACE", material: { kind: "MANUAL", text: "Latex 3 cm" }, thicknessCm: 3, fromOrder: null, note: null }, { action: "REPLACE", material: { kind: "MANUAL", text: "Busa HD" }, thicknessCm: 5, fromOrder: null, note: null }] }, version: 1 };
  const base = M.draftFromEntry("AFTER", null); const copied = M.draftFromPlan(plan, base);
  assert.deepEqual(copied.layers.map((l) => [l.action, l.thickness]), [["REPLACE", "3"], ["REPLACE", "5"]]); assert.equal(copied.foundationOn, true);
  assert.deepEqual(M.draftDeviations(copied, plan), [], "salinan rencana = tanpa perbedaan");
  const edited = { ...copied, layers: copied.layers.map((l, i) => (i === 1 ? { ...l, thickness: "4" } : l)) };
  assert.deepEqual(M.draftDeviations(edited, plan), ["Lapisan 2"]);
  assert.match(M.validateDraft("AFTER", edited, { plan }), /berbeda dari rencana \(Lapisan 2\).*alasan/); assert.equal(M.validateDraft("AFTER", { ...edited, deviationNote: "Busa D44 5 cm habis" }, { plan }), null);
  assert.equal(M.payloadFromDraft("AFTER", { ...edited, deviationNote: " Busa habis " }).deviationNote, "Busa habis"); assert.equal("deviationNote" in M.payloadFromDraft("AFTER", copied), false);
  assert.deepEqual(M.draftDeviations({ ...copied, foundationOn: false, layers: [] }, plan), [], "bagian belum diisi tidak dihitung beda");
  assert.equal(M.draftFromEntry("AFTER", { data: { layers: [], foundation: null, deviationNote: "x" }, media: [] }).deviationNote, "x");
});

test("aksi Meja tahap 7–8: menunggu uji fondasi baru / kasur jadi dijelaskan; hasil aktual wajib sebelum bukti lapisan; uji kasur jadi = satu ketuk 'Lanjutkan ke Gerbang QC'", () => {
  assert.match(waitCopy({ wait: "FOUNDATION_NEW_TEST_PENDING" }).title, /Menunggu uji fondasi baru/); assert.match(waitCopy({ wait: "FINISHED_TEST_PENDING" }).text, /Lanjutkan ke Gerbang QC/);
  const test8 = { action: "TEST", stepNo: 8, continueOnly: true }; assert.equal(isQuickAction(test8), true); assert.equal(actionLabel(test8), "Lanjutkan ke Gerbang QC");
  assert.equal(isQuickAction({ action: "TEST", stepNo: 8 }), false, "uji tekstur lama tetap formulir"); assert.equal(actionLabel({ action: "TEST", stepNo: 8 }), "Kirim Uji Tekstur Akhir");
  const media = [{ status: "done", kind: "image", url: "/media/production-evidence/" + "a".repeat(40) + ".jpg" }];
  assert.match(validateStepForm(7, {}, { mediaItems: media, track: "RESTORATION", byPic: true, gated: true, layersAfterRequired: true }), /hasil aktual/);
  assert.equal(validateStepForm(7, {}, { mediaItems: media, track: "RESTORATION", byPic: true, gated: true, layersAfterRequired: false }), null);
  assert.match(validateStepForm(7, {}, { mediaItems: media, track: "RESTORATION", gated: true, layersAfterRequired: false }), /bahan Gudang/, "bahan tetap dari PIC Bahan/Meja sesuai aturan lama");
});

test("kontrak UI: ringkasan perjalanan di panel (Meja/Corner/Dokumentasi/Unit 360/PIC QC) dan laporan; uji setelah perbaikan terpisah; antrean QC memuat jenis baru + tautan putusan", () => {
  const j = strip(src("features", "production", "componentNotes", "JourneySummary.jsx"));
  for (const id of ["journey-summary", "journey-awal", "journey-racikan", "journey-akhir", "journey-cmp-foundation", "journey-cmp-whole", "journey-separation"]) assert.ok(j.includes(id), id);
  assert.match(j, /NOT_RECORDED/); assert.doesNotMatch(j, /amblas/i, "tanpa label amblas otomatis");
  assert.match(strip(src("features", "production", "componentNotes", "ComponentNotesPanel.jsx")), /<JourneySummary data=\{data\} \/>/);
  assert.match(strip(src("pages", "bengkel", "ProductionReportV2.jsx")), /<JourneySummary data=\{\{ measurements: report\.components\.measurements, comparison: report\.components\.comparison, assembly: report\.components\.assembly \}\} \/>/);
  const pre = strip(src("features", "production", "componentNotes", "PreTestBlock.jsx")); for (const id of ["posttest-foundation", "posttest-whole", "foundation-compare", "whole-compare", "foundation-after-drop"]) assert.ok(pre.includes(id), id);
  const q = strip(src("features", "production", "componentNotes", "PreTestQueue.jsx")); assert.match(q, /pretest-decision-open/); assert.match(q, /<QcDecisionSheet/); assert.match(q, /analysis=\{detail\}/);
  const sheet = strip(src("features", "production", "componentNotes", "ComponentNoteSheet.jsx")); for (const id of ["same-method", "test-compare", "copy-plan", "deviation-note", "deviation-warning"]) assert.ok(sheet.includes(id), id);
  assert.match(sheet, /section === "WHOLE_TEST_AFTER" && <WholeTestForm[^>]* after /); assert.match(sheet, /section === "FOUNDATION_TEST_AFTER" && <FoundationTestForm[^>]* after /);
});

test("riwayat putaran: kode tahap rework tampil sebagai teks Indonesia (kode tak dikenal tanpa garis bawah)", () => {
  assert.equal(M.reworkDispositionText("REWORK:comfort_layer_upgrade"), "rework → Lapisan Baru");
  assert.equal(M.reworkDispositionText("REWORK:foundation_upgrade"), "rework → Fondasi Baru");
  assert.equal(M.reworkDispositionText("REWORK:some_new_stage"), "rework → some new stage");
  assert.equal(M.reworkDispositionText(null), "");
});
