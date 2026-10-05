// Simplifikasi Production slice 3 — Catatan Komponen kanonis: model murni (draf<->payload, validasi, fokus tahap, saran), paritas dengan domain backend, dan kontrak UI (text-scan, tanpa jsdom).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_URL = pathToFileURL(path.join(here, "..", "src") + path.sep).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(spec, ctx, next) { return spec.startsWith("@/") ? next(new URL(spec.slice(2), ${JSON.stringify(SRC_URL)}).href, ctx) : next(spec, ctx); }`));
const M = await import("../src/features/production/componentNotes/componentNotesModel.js");
const B = await import("../../backend/src/lib/domain/productionComponents.js");
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const CAT = { kind: "CATALOG", materialId: "11111111-1111-4111-8111-111111111111", code: "BSA-1", name: "Busa HD", unit: "SHEET" };

test("paritas: konstanta frontend = domain backend (seksi, kondisi, sistem fondasi, tindakan, batas, label)", () => {
  assert.deepEqual(M.SECTIONS.map((s) => [s.key, s.label]), Object.values(B.COMPONENT_SECTIONS).map((s) => [s.key, s.label]));
  assert.deepEqual(M.CONDITIONS, B.CONDITIONS); assert.deepEqual(M.FOUNDATION_SYSTEMS, B.FOUNDATION_SYSTEMS); assert.deepEqual(M.ACTIONS, B.COMPONENT_ACTIONS);
  assert.equal(M.MAX_LAYERS, B.LIMITS.MAX_LAYERS); assert.equal(M.MAX_MEDIA, B.LIMITS.MAX_MEDIA);
  assert.equal(M.MANUAL_LABEL, B.MANUAL_MATERIAL_LABEL); assert.equal(M.UNKNOWN_LABEL, B.UNKNOWN_LABEL); assert.equal(M.NOT_RECORDED, B.NOT_RECORDED_LABEL);
  for (const ref of [CAT, { kind: "MANUAL", text: "Kapuk" }, { kind: "UNKNOWN" }]) assert.equal(M.materialText(ref), B.materialLabel(ref));
});

test("fokus per tahap: bongkar/uji/diagnosis -> catat SEBELUM; pengerjaan pengganti dst -> SESUDAH; tidak pernah syarat", () => {
  assert.deepEqual(M.focusFor(3), ["LAYERS_BEFORE", "FOUNDATION_BEFORE"]); assert.deepEqual(M.focusFor(5), ["LAYERS_BEFORE", "FOUNDATION_BEFORE"]);
  assert.deepEqual(M.focusFor(6), ["AFTER"]); assert.deepEqual(M.focusFor(7), ["AFTER"]); assert.deepEqual(M.focusFor(12), ["AFTER"]);
  assert.deepEqual(M.focusFor(null), []); assert.deepEqual(M.focusFor(0), []);
  assert.match(M.focusCopy(3).title, /sebelum dibongkar/); assert.match(M.focusCopy(6).title, /hasil pengerjaan/); assert.equal(M.focusCopy(null), null);
  const panel = strip(src("features", "production", "componentNotes", "ComponentNotesPanel.jsx"));
  assert.match(panel, /Tidak wajib untuk melanjutkan tahap/);
});

test("draf <-> payload: lapisan sebelum (katalog/manual/tidak diketahui, ketebalan opsional) dan 'lapisan tidak diketahui'", () => {
  const draft = M.draftFromEntry("LAYERS_BEFORE", null);
  assert.equal(draft.layers.length, 0); assert.equal(draft.layersUnknown, false);
  draft.layers = [
    { id: "a", material: CAT, thickness: "5", condition: "KEMPES", note: " amblas " },
    { id: "b", material: { kind: "MANUAL", text: "Kapuk bekas" }, thickness: "", condition: "AUS", note: "" },
    { id: "c", material: { kind: "UNKNOWN" }, thickness: "2,5", condition: "TIDAK_DIKETAHUI", note: "" },
  ];
  assert.equal(M.validateDraft("LAYERS_BEFORE", draft), null);
  const p = M.payloadFromDraft("LAYERS_BEFORE", draft);
  assert.deepEqual(p.layers.map((l) => [l.material.kind, l.thicknessCm, l.condition, l.note]), [["CATALOG", 5, "KEMPES", "amblas"], ["MANUAL", null, "AUS", null], ["UNKNOWN", 2.5, "TIDAK_DIKETAHUI", null]]);
  const unknown = { ...M.draftFromEntry("LAYERS_BEFORE", null), layersUnknown: true };
  assert.equal(M.validateDraft("LAYERS_BEFORE", unknown), null); assert.deepEqual(M.payloadFromDraft("LAYERS_BEFORE", unknown).layers, []);
  // round-trip dari entri server
  const back = M.draftFromEntry("LAYERS_BEFORE", { version: 2, data: { layersUnknown: false, note: "n", layers: [{ material: CAT, thicknessCm: 5, condition: "KEMPES", note: null }] }, media: [{ url: "/m/a.png", previewUrl: "/m/a.png?sig=1", caption: "c" }] });
  assert.equal(back.layers[0].thickness, "5"); assert.equal(back.media[0].status, "done"); assert.equal(back.media[0].caption, "c");
  assert.deepEqual(M.mediaPayload(back), [{ url: "/m/a.png", caption: "c" }]);
});

test("validasi ramah operator: wajib kondisi/bahan, tidak menebak; Bahan manual min 2 huruf; ketebalan 0–100; koreksi wajib alasan", () => {
  const base = () => M.draftFromEntry("LAYERS_BEFORE", null);
  assert.match(M.validateDraft("LAYERS_BEFORE", base()), /minimal satu lapisan|tidak diketahui/);
  const d = { ...base(), layers: [{ id: "a", material: null, thickness: "", condition: "BAIK", note: "" }] };
  assert.match(M.validateDraft("LAYERS_BEFORE", d), /Lapisan 1: pilih bahan/);
  d.layers[0].material = { kind: "MANUAL", text: "x" }; assert.match(M.validateDraft("LAYERS_BEFORE", d), /Lapisan 1: pilih bahan/);
  d.layers[0].material = { kind: "UNKNOWN" }; d.layers[0].condition = ""; assert.match(M.validateDraft("LAYERS_BEFORE", d), /pilih kondisi/);
  d.layers[0].condition = "BAIK"; d.layers[0].thickness = "250"; assert.match(M.validateDraft("LAYERS_BEFORE", d), /ketebalan/);
  d.layers[0].thickness = ""; assert.equal(M.validateDraft("LAYERS_BEFORE", d), null);
  assert.match(M.validateDraft("LAYERS_BEFORE", d, { correcting: true }), /alasan koreksi/); assert.equal(M.validateDraft("LAYERS_BEFORE", { ...d, reason: "salah input" }, { correcting: true }), null);
  const f = M.draftFromEntry("FOUNDATION_BEFORE", null);
  assert.match(M.validateDraft("FOUNDATION_BEFORE", f), /jenis\/sistem fondasi/); f.system = "TIDAK_DIKETAHUI"; assert.match(M.validateDraft("FOUNDATION_BEFORE", f), /kondisi fondasi/); f.condition = "TIDAK_DIKETAHUI"; assert.equal(M.validateDraft("FOUNDATION_BEFORE", f), null);
  const a = M.draftFromEntry("AFTER", null);
  assert.equal(a.foundationOn, true); assert.match(M.validateDraft("AFTER", a), /Fondasi: pilih/);
  a.foundation.action = "REPLACE"; assert.match(M.validateDraft("AFTER", a), /jenis fondasi baru/); a.foundation.system = "POCKET_SPRING"; assert.equal(M.validateDraft("AFTER", a), null);
  a.layers = [{ id: "x", action: "REPLACE", fromOrder: "", material: null, thickness: "", note: "" }]; assert.match(M.validateDraft("AFTER", a), /Lapisan 1: pilih bahan/);
  a.layers[0] = { ...a.layers[0], action: "KEEP" }; assert.equal(M.validateDraft("AFTER", a), null, "dipertahankan tidak memerlukan bahan");
  const empty = { ...M.draftFromEntry("AFTER", null), foundationOn: false }; assert.match(M.validateDraft("AFTER", empty), /fondasi atau minimal satu lapisan/);
  const p = M.payloadFromDraft("AFTER", { ...a, foundation: { ...a.foundation, material: CAT } });
  assert.equal(p.foundation.action, "REPLACE"); assert.equal(p.layers[0].action, "KEEP"); assert.equal(p.layers[0].fromOrder, null);
});

test("saran dari bahan terpakai mengisi formulir Sesudah saja (belum tersimpan, bisa diubah); tidak menimpa isian operator", () => {
  const sug = { foundation: [CAT], layers: [{ ...CAT, materialId: "22222222-2222-4222-8222-222222222222", name: "Latex" }] };
  const filled = M.applySuggestions(M.draftFromEntry("AFTER", null), sug);
  assert.equal(filled.foundation.action, "REPLACE"); assert.equal(filled.foundation.material.kind, "CATALOG"); assert.equal(filled.layers.length, 1); assert.equal(filled.layers[0].action, "REPLACE");
  const mine = { ...M.draftFromEntry("AFTER", null), layers: [{ id: "k", action: "KEEP", fromOrder: "", material: null, thickness: "", note: "" }] };
  assert.equal(M.applySuggestions(mine, sug).layers.length, 1, "lapisan operator tidak ditimpa");
  assert.equal(M.applySuggestions(M.draftFromEntry("AFTER", null), null).layers.length, 0);
});

test("UI: satu panel yang sama dipasang di Meja/Corner, Dokumentasi, Unit 360; laporan memakai ringkasan yang sama; membaca SATU endpoint", () => {
  const detail = strip(src("features", "production", "workerApp", "JobDetail.jsx")); const doc = strip(src("features", "production", "docApp", "DocDetail.jsx"));
  const drawer = strip(src("features", "production", "UnitOverviewDrawer.jsx")); const report = strip(src("pages", "bengkel", "ProductionReportV2.jsx"));
  assert.match(detail, /<ComponentNotesPanel unitId=\{card\.unit\.id\} unitCode=\{card\.unit\.unitCode\} stepNo=\{next\?\.stepNo \?\? null\} \/>/);
  assert.match(doc, /<ComponentNotesPanel unitId=\{detail\.unit\.id\}/); assert.match(drawer, /<ComponentNotesPanel unitId=\{d\.identity\.unitId\}/);
  assert.match(report, /<BeforeAfterSummary comparison=\{report\.components\.comparison\} \/>/); assert.match(report, /data-testid="report-components"/);
  const panel = strip(src("features", "production", "componentNotes", "ComponentNotesPanel.jsx"));
  assert.match(panel, /api\.getComponentNotes\(unitId\)/); assert.doesNotMatch(panel, /getProductionV2Card|getUnitOverview|getProductionV2Report|getProductionV2DocDetail/, "tidak membaca sumber lain / tidak meminta input ulang");
  const api = src("api.js"); for (const fn of ["getComponentNotes", "searchComponentMaterials", "uploadComponentNoteMedia", "saveComponentNote"]) assert.match(api, new RegExp(`${fn}:`));
});

test("Formulir: simpan = command server dengan expectedVersion + Idempotency-Key; koreksi wajib alasan; konflik -> muat versi terbaru; data-mutates (Mode Latihan); 'Bahan manual'/'Tidak diketahui'; tanpa klaim stok", () => {
  const s = strip(src("features", "production", "componentNotes", "ComponentNoteSheet.jsx")); const picker = strip(src("features", "production", "componentNotes", "MaterialPicker.jsx"));
  assert.match(s, /api\.saveComponentNote\(unitId, section, \{ expectedVersion: entry\?\.version \?\? 0, data: payloadFromDraft\(section, draft\), media: mediaPayload\(draft\), reason: correcting \? draft\.reason\.trim\(\) : undefined \}, keyRef\.current\)/);
  assert.match(s, /data-mutates data-testid="component-save"/); assert.match(s, /COMPONENT_VERSION_CONFLICT/); assert.match(s, /data-testid="component-reload"/); assert.match(s, /Alasan koreksi \*/);
  assert.match(s, /tidak memotong stok dan bukan daftar bahan\/pemakaian/); assert.match(s, /api\.uploadComponentNoteMedia\(unitId, \[file\], onProgress\)/);
  assert.match(picker, /MANUAL_LABEL/); assert.match(picker, /UNKNOWN_LABEL/); assert.match(picker, /api\.searchComponentMaterials/); assert.doesNotMatch(picker + s, /stok:|qty|harga|price/i, "formulir tidak menyentuh stok/harga/qty");
  const panel = strip(src("features", "production", "componentNotes", "ComponentNotesPanel.jsx")); assert.match(panel, /data-mutates onClick=\{\(\) => setSheet\(s\.key\)\}/);
  assert.match(panel, /DEMO_MISS/, "Mode Latihan tanpa data komponen: panel disembunyikan, bukan galat");
});

test("Ringkasan Sebelum→Sesudah: data belum dicatat tampil 'Belum dicatat'; komponen yang tetap digunakan ditandai; tidak ada hasil karangan", () => {
  const sum = strip(src("features", "production", "componentNotes", "BeforeAfterSummary.jsx"));
  assert.match(sum, /NOT_RECORDED/); assert.match(sum, /data-testid="ba-kept"/); assert.match(sum, /Tetap digunakan:/); assert.match(sum, /data-testid="before-after-gaps"/); assert.match(sum, /Belum ada catatan komponen untuk unit ini/);
});
