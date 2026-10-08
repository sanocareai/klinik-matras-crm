// Fase 2 Produksi LAYANAN — model formulir PIC QC (uji kasur utuh, uji fondasi awal), lapisan awal (total, media per layer), gerbang tahap di Meja, antrean PIC QC, laporan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SECTIONS, draftFromEntry, mediaPayload, payloadFromDraft, summarizeLayersDraft, validateDraft, maxMediaFor, minMediaFor,
} from "../src/features/production/componentNotes/componentNotesModel.js";
import { actionLabel, isQuickAction, validateStepForm, waitCopy } from "../src/features/production/experience.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const done = (id = "m1", extra = {}) => ({ id, kind: "video", status: "done", url: `/media/production-evidence/${id}.mp4`, caption: "", ...extra });

test("seksi pengujian terdaftar sebagai QC; media minimal 1 dan maksimal sesuai server", () => {
  assert.deepEqual(SECTIONS.filter((s) => s.qc).map((s) => s.key), ["WHOLE_TEST_BEFORE", "FOUNDATION_TEST_BEFORE", "FOUNDATION_TEST_AFTER", "WHOLE_TEST_AFTER"]);
  assert.equal(minMediaFor("WHOLE_TEST_BEFORE"), 1); assert.equal(minMediaFor("AFTER"), 0);
  assert.deepEqual([maxMediaFor("AFTER"), maxMediaFor("WHOLE_TEST_BEFORE"), maxMediaFor("LAYERS_BEFORE")], [8, 12, 24]);
});

test("QC sebelum bongkar: berat penguji TIDAK terisi otomatis; semua isian wajib divalidasi; tanpa media/konfirmasi frame ditolak", () => {
  const d = draftFromEntry("WHOLE_TEST_BEFORE", null);
  assert.equal(d.testerWeight, "", "tidak ada default / berat customer"); assert.equal(d.wholeDrop, ""); assert.equal(d.qcInFrame, false);
  const ok = { ...d, complaintMatch: "SEBAGIAN", feelNote: "tengah amblas", testerWeight: "75", testMethod: "berbaring di tengah", wholeDrop: "0", qcInFrame: true, media: [done()] };
  assert.equal(validateDraft("WHOLE_TEST_BEFORE", ok), null, "0 cm sah");
  for (const [over, re] of [[{ complaintMatch: "" }, /kesesuaian/i], [{ feelNote: "a" }, /feel awal/i], [{ testerWeight: "" }, /berat penguji aktual/i], [{ testerWeight: "0" }, /berat penguji/i], [{ testMethod: "x" }, /metode/i],
    [{ wholeDrop: "" }, /penurunan kasur utuh/i], [{ wholeDrop: "-2" }, /penurunan/i], [{ qcInFrame: false }, /PIC QC sedang menguji/i], [{ media: [] }, /minimal 1 foto\/video/i]]) {
    assert.match(validateDraft("WHOLE_TEST_BEFORE", { ...ok, ...over }), re, JSON.stringify(over));
  }
  const p = payloadFromDraft("WHOLE_TEST_BEFORE", ok);
  assert.deepEqual([p.testerWeightKg, p.wholeDropCm, p.qcInFrame], [75, 0, true]);
  assert.equal(draftFromEntry("WHOLE_TEST_BEFORE", { data: { ...p, testerWeightKg: 80 }, media: [] }).testerWeight, "80");
});

test("uji fondasi awal: penurunan TIDAK dikirim (server menghitung); dibebani lebih tinggi ditolak; media wajib", () => {
  const d = draftFromEntry("FOUNDATION_TEST_BEFORE", null);
  const ok = { ...d, system: "BONNELL", unloadedHeight: "25", loadedHeight: "15", testerWeight: "75", testMethod: "beban di tengah", media: [done()] };
  assert.equal(validateDraft("FOUNDATION_TEST_BEFORE", ok), null);
  assert.match(validateDraft("FOUNDATION_TEST_BEFORE", { ...ok, loadedHeight: "26" }), /tidak boleh lebih besar/);
  assert.match(validateDraft("FOUNDATION_TEST_BEFORE", { ...ok, unloadedHeight: "" }), /tanpa beban/);
  assert.match(validateDraft("FOUNDATION_TEST_BEFORE", { ...ok, testerWeight: "" }), /berat penguji/);
  assert.match(validateDraft("FOUNDATION_TEST_BEFORE", { ...ok, media: [] }), /minimal 1 foto\/video/);
  const p = payloadFromDraft("FOUNDATION_TEST_BEFORE", ok);
  assert.deepEqual([p.unloadedHeightCm, p.loadedHeightCm], [25, 15]); assert.equal("dropCm" in p, false); assert.equal("category" in p, false);
});

test("lapisan awal: total dari ketebalan yang diketahui, 'belum lengkap' bila ada kosong, bukan 0; media dapat ditautkan ke lapisan", () => {
  const L = (t, id) => ({ id, material: { kind: "UNKNOWN" }, thickness: t, condition: "BAIK", note: "" });
  assert.match(summarizeLayersDraft({ layers: [L("6", "a"), L("4", "b")] }).text, /Total tinggi lapisan 10 cm \(2 lapisan\)/);
  const partial = summarizeLayersDraft({ layers: [L("6", "a"), L("", "b")] });
  assert.deepEqual([partial.total, partial.complete], [6, false]); assert.match(partial.text, /belum lengkap/);
  const none = summarizeLayersDraft({ layers: [L("", "a")] }); assert.equal(none.total, null); assert.match(none.text, /belum dicatat/);
  assert.equal(summarizeLayersDraft({ layersUnknown: true, layers: [] }).total, null);
  const draft = { layers: [L("6", "a"), L("4", "b")], media: [done("m1", { layerRowId: "b" }), done("m2")] };
  assert.deepEqual(mediaPayload(draft, "LAYERS_BEFORE").map((m) => m.layerOrder), [2, undefined]);
  assert.equal(mediaPayload(draft, "AFTER").some((m) => "layerOrder" in m), false);
  const back = draftFromEntry("LAYERS_BEFORE", { data: { layers: [{ material: { kind: "UNKNOWN" }, thicknessCm: 6, condition: "BAIK" }, { material: { kind: "UNKNOWN" }, thicknessCm: 4, condition: "BAIK" }] }, media: [{ url: "/media/production-evidence/x.mp4", kind: "video", layerOrder: 2 }] });
  assert.equal(back.media[0].kind, "video"); assert.equal(back.media[0].layerRowId, back.layers[1].id);
});

test("Meja: tahap 2/4 'Lanjutkan' satu ketuk setelah PIC QC mencatat; menunggu PIC QC dijelaskan; tahap 3 menuntut lapisan awal; tanpa gerbang = perilaku lama", () => {
  assert.equal(isQuickAction({ action: "COMPLETE", stepNo: 2, continueOnly: true }), true);
  assert.equal(isQuickAction({ action: "COMPLETE", stepNo: 3 }), false);
  assert.equal(actionLabel({ action: "COMPLETE", stepNo: 4, continueOnly: true }), "Lanjutkan");
  assert.match(waitCopy({ wait: "QC_BEFORE_PENDING" }).title, /Menunggu QC sebelum bongkar/);
  assert.match(waitCopy({ wait: "FOUNDATION_TEST_PENDING" }).text, /PIC QC perlu mencatat uji fondasi awal/);
  const m = [{ status: "done", kind: "image", url: "/media/production-evidence/a.jpg" }];
  assert.match(validateStepForm(3, { oldMaterials: [] }, { mediaItems: m, gated: true, layersRequired: true }), /lapisan awal/);
  assert.equal(validateStepForm(3, { oldMaterials: [] }, { mediaItems: m, gated: true, layersRequired: false }), null, "centang material lama opsional bila lapisan sudah tercatat");
  assert.match(validateStepForm(3, { oldMaterials: [] }, { mediaItems: m }), /Centang minimal satu material lama/, "jalur lama tidak berubah");
  assert.match(validateStepForm(3, { oldMaterials: ["PER"] }, { mediaItems: [], gated: true, layersRequired: false }), /minimal 1 foto/, "dokumentasi bongkar tetap wajib media");
});

test("kontrak komponen: PIC QC saja yang melihat tombol uji; antrean PIC QC di Hub QC; laporan memuat blok pengujian terpisah; konteks Sales rujukan saja", () => {
  const panel = src("features", "production", "componentNotes", "ComponentNotesPanel.jsx");
  assert.match(panel, /\(s\.qc \? !!data\.canWriteQc : canWrite\)/); assert.match(panel, /<PreTestBlock measurements=\{data\.measurements\} assembly=\{data\.assembly\} \/>/); assert.match(panel, /data-testid="section-video"/);
  assert.match(src("pages", "bengkel", "ProductionQcHub.jsx"), /<PreTestQueue \/>/);
  assert.match(src("pages", "bengkel", "ProductionReportV2.jsx"), /<PreTestBlock measurements=\{report\.components\?\.measurements\} assembly=\{report\.components\?\.assembly\} \/>/);
  const block = src("features", "production", "componentNotes", "PreTestBlock.jsx");
  assert.match(block, /data-testid="pretest-separation"/); assert.match(block, /NOT_RECORDED/); assert.doesNotMatch(block, /amblas/i, "tidak ada kategori amblas otomatis");
  const sheet = src("features", "production", "componentNotes", "ComponentNoteSheet.jsx");
  assert.match(src("features", "production", "componentNotes", "SalesContextBox.jsx"), /data-testid="sales-context"/); assert.match(sheet, /SalesContextBox/); assert.match(src("features", "production", "componentNotes", "SalesContextBox.jsx"), /rujukan saja/); assert.doesNotMatch(sheet, /testerWeight: .*customerWeight|customerWeightKg \?\? /, "berat customer tidak mengisi berat penguji");
  assert.match(sheet, /dihitung sistem/); assert.match(src("api.js"), /getComponentQcQueue/);
});

test("lembar komponen TIDAK di-portal (drawer Unit 360 menutup bila fokus/klik di luar); induk panel tidak bergaya kaca agar `fixed` tidak terpotong", () => {
  assert.doesNotMatch(src("features", "production", "componentNotes", "ComponentNoteSheet.jsx"), /createPortal/);
  assert.doesNotMatch(src("features", "production", "componentNotes", "PreTestQueue.jsx"), /rounded-card/, "antrean di Hub QC: wildcard kaca memberi backdrop-filter pada rounded-card");
  assert.match(src("features", "production", "UnitOverviewDrawer.jsx"), /kpi-glass-guard[^"]*"[^>]*data-testid="unit360-component-notes"/);
});
