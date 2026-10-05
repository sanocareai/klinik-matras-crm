// Simplifikasi Production slice 2 — kontrak UI flow adaptasi (text-scan, tanpa jsdom): Unit Tiba satu aksi, tanpa pilihan layanan, lewati tahap, Selesaikan Produksi (pratinjau + konfirmasi),
// progres dikerjakan/dilewati/tersisa, Tunda 4 alasan di papan, SATU Lanjutkan, Pengaturan Alur Kerja, dan larangan klaim palsu (QC lulus, custody diterima).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_URL = pathToFileURL(path.join(here, "..", "src") + path.sep).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(spec, ctx, next) { return spec.startsWith("@/") ? next(new URL(spec.slice(2), ${JSON.stringify(SRC_URL)}).href, ctx) : next(spec, ctx); }`));
const L = await import("../src/features/production/productionLabels.js");
const { jobFromV1, jobFromV2, primaryActionV1 } = await import("../src/features/production/workerApp/workerAppModel.js");
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("progres: dikerjakan / dilewati / tersisa; tanpa dilewati = bentuk lama; 12/12 = dikerjakan + dilewati", () => {
  assert.equal(L.progressText({ done: 4, total: 12 }), "4/12 tahap");
  assert.equal(L.progressText({ done: 3, skipped: 5, remaining: 4, total: 12 }), "3 dikerjakan · 5 dilewati · 4 tersisa");
  assert.equal(L.progressComplete({ done: 7, skipped: 5, total: 12 }), true); assert.equal(L.progressComplete({ done: 7, skipped: 4, total: 12 }), false);
  assert.equal(L.SKIP_LABEL, "Dilewati"); assert.equal(L.SKIP_REASON_LABEL, "Adaptasi sistem"); assert.equal(L.FINISH_ACTION_LABEL, "Selesaikan Produksi");
  assert.equal(L.delayKindText("ARAHAN"), "Tertunda — menunggu arahan"); assert.equal(L.delayKindText("KENDALA"), "Tertunda — kendala pengerjaan"); assert.equal(L.delayKindText("LAINNYA", "kain belum datang"), "Tertunda — kain belum datang");
});

test("kartu pekerja membawa progres lengkap + alasan tunda di papan (dari server)", () => {
  const j = jobFromV2({ runId: "r", revision: 1, unit: { id: "u", unitCode: "U1" }, customer: { name: "A" }, plan: { priority: 0 }, progress: { done: 3, skipped: 5, remaining: 4, total: 12 }, adaptation: { policy: "ADAPTATION_V1" }, activeOp: { status: "PAUSED", delayKind: "KENDALA", delayNote: null }, bucket: "BONGKAR" });
  assert.deepEqual(j.progress, { done: 3, skipped: 5, remaining: 4, total: 12, source: "server-v2" }); assert.equal(j.adaptation, true); assert.equal(j.delayKind, "KENDALA");
  const plain = jobFromV2({ runId: "r2", revision: 1, unit: { id: "u2", unitCode: "U2" }, customer: { name: "B" }, plan: { priority: 0 }, progress: { done: 1, total: 12 }, activeOp: { status: "ACTIVE" }, bucket: "BONGKAR" });
  assert.equal(plain.adaptation, false); assert.equal(plain.delayKind, null); assert.equal(plain.progress.skipped, 0);
});

test("Lanjutkan Pekerjaan: SATU aksi — jeda & tertunda memakai tombol yang sama; menunggu bahan tanpa tombol palsu (siapa yang bertindak)", () => {
  const tl = (status, extra = {}) => ({ unit: { currentStageId: "s1" }, path: [{ stage: { id: "s1", labelId: "Bongkar", requiresQc: false, requiresPhoto: true }, status, isCurrent: true }], needsService: false, ...extra });
  const W = ["PRODUCTION_WORKER"];
  assert.equal(primaryActionV1(tl("PAUSED"), W).kind, "RESUME_WORK"); assert.equal(primaryActionV1(tl("BLOCKED", { activeBlocker: { reason: "AWAITING_CUSTOMER" } }), W).kind, "RESUME_WORK");
  const mat = primaryActionV1(tl("BLOCKED", { activeBlocker: { reason: "MATERIAL_SHORTAGE" } }), W); assert.equal(mat.kind, "NONE"); assert.match(mat.reason, /Gudang/);
  const panels = strip(src("features", "production", "workerApp", "V1Panels.jsx")); const stage = strip(src("features", "production", "UnitV1Stage.jsx")); const detail = strip(src("features", "production", "workerApp", "JobDetail.jsx"));
  assert.match(panels, /api\.resumeProductionWork\(unitId\)/); assert.match(stage, /api\.resumeProductionWork\(unit\.id\)/); assert.match(detail, /api\.resumeProductionWork\(card\.unit\.id/);
  assert.doesNotMatch(panels + stage, /api\.resumeUnitStage\(|api\.resolveBlocker\(/, "tidak ada dua jalur Lanjutkan di UI");
});

test("Unit Tiba di Workshop: SATU aksi tanpa pilihan lokasi; kebutuhan konfigurasi Admin ditampilkan; modal pilih-lokasi tidak dipakai", () => {
  const planner = strip(src("pages", "bengkel", "ProductionPlannerV2.jsx"));
  assert.match(planner, /api\.confirmProductionV2UnitArrival\(item\.unit\.id, \{\}\)/); assert.doesNotMatch(planner, /ArrivalModal|getProductionV2ReceivingLocations|locationId/);
  assert.match(planner, /WORKSHOP_DEFAULT_LOCATION_NOT_CONFIGURED/);
  const api = src("api.js"); assert.match(api, /confirmProductionV2UnitArrival: \(unitId, data = \{\}/);
});

test("Diagnosis: tanpa layanan teknis tambahan untuk operator; mapping hilang diarahkan ke Pengaturan Admin (pesan server)", async () => {
  const w = strip(src("features", "production", "DiagnosisWizard.jsx"));
  assert.doesNotMatch(w, /recommendedServiceId|getServiceCatalog|<select[^>]*layanan/i);
  const { friendlyError } = await import("../src/features/production/experience.js");
  const msg = "Layanan Sales belum dipetakan. Admin perlu memetakannya di Pengaturan Produksi › Alur Kerja.";
  assert.equal(friendlyError({ status: 409, code: "DIAGNOSIS_SERVICE_MAPPING_NEEDED", message: msg }), msg, "pesan server (arahan ke Pengaturan Admin) ditampilkan apa adanya");
  const settings = strip(src("pages", "bengkel", "ProductionWorkflowSettings.jsx"));
  assert.match(settings, /Pemetaan layanan Sales → layanan produksi/); assert.match(settings, /tidak ditebak dari namanya/);
});

test("Lewati Tahap & Selesaikan Produksi: konfirmasi eksplisit; pratinjau dari server; retur wajib ditampilkan; tanpa klaim QC lulus/custody diterima/foto", () => {
  const ad = strip(src("features", "production", "workerApp", "adaptationSheets.jsx"));
  assert.match(ad, /api\.getProductionV2FinishPreview\(card\.runId\)/); assert.match(ad, /confirm: true/);
  assert.match(ad, /const can = prev\?\.canFinish && agree && !gate\.disabled/, "tombol selesai nonaktif sebelum pratinjau dimuat, tidak ada penghalang, dan konfirmasi dicentang");
  assert.match(ad, /data-testid="finish-agree"/); assert.match(ad, /data-testid="finish-remaining"/); assert.match(ad, /data-testid="finish-returns"/); assert.match(ad, /Sisa bahan wajib dikembalikan ke Gudang/);
  assert.match(ad, /DILEWATI/); assert.match(ad, /QC dicatat tidak dilakukan/);
  assert.match(ad, /Tidak ada foto atau hasil uji yang dibuat/);
  assert.doesNotMatch(ad, /QC lulus|PASS|WAIVED|ACCEPTED|diterima Gudang\b(?!\.)/, "tidak mengklaim QC lulus / custody diterima");
  assert.match(ad, /api\.skipProductionV2Step\(card\.runId, next\.stepNo/);
  const detail = strip(src("features", "production", "workerApp", "JobDetail.jsx"));
  assert.match(detail, /const canSkip = adaptation && mineNow && !card\.activeOp/); assert.match(detail, /data-testid="open-finish-primary"/);
  const model = strip(src("features", "production", "unitOrderFallbackModel.js")); assert.ok(model.length > 0);
});

test("Tunda Pekerjaan di papan: 4 alasan (Menunggu bahan → daftar bahan; lainnya → jeda sah dengan alasan); 'Lainnya' wajib keterangan; pesan sistem tidak dilabeli tertunda", () => {
  const ad = strip(src("features", "production", "workerApp", "adaptationSheets.jsx"));
  assert.match(ad, /DELAY_REASON_OPTIONS\.map/); assert.match(ad, /delayFormValid\(\{ key, note \}\)/); assert.match(ad, /api\.delayProductionV2Run\(card\.runId/); assert.match(ad, /onPickMaterial\(\)/);
  assert.deepEqual(L.DELAY_REASON_OPTIONS.map((r) => r.label), ["Menunggu bahan", "Menunggu arahan", "Kendala pengerjaan", "Lainnya"]);
  assert.equal(L.delayFormValid({ key: "LAINNYA", note: "" }), false);
});

test("Unit 360: mode adaptasi terlihat (progres, QC tidak dilakukan); penerapan pada run berjalan = aksi eksplisit pemegang izin; run lama tidak berubah otomatis", () => {
  const d = strip(src("features", "production", "UnitOverviewDrawer.jsx"));
  assert.match(d, /progressText\(d\.production\.progress\)/); assert.match(d, /data-testid="adaptation-panel"/); assert.match(d, /data-testid="adaptation-apply"/);
  assert.match(d, /QC tidak dilakukan \(mode adaptasi\) — bukan lulus dan bukan di-waive/);
  assert.match(d, /canApply, onApplied|if \(!canApply \|\| \["COMPLETED", "CANCELLED"\]\.includes\(p\.runStatus\)\) return null/);
  assert.doesNotMatch(d, /useEffect\([^)]*applyProductionV2Adaptation/, "tidak pernah diterapkan otomatis");
});

test("Pengaturan Alur Kerja: tab terdaftar; menulis hanya bila server mengizinkan; lokasi tidak dipilih otomatis", () => {
  const page = strip(src("pages", "bengkel", "ProductionSettings.jsx")); assert.match(page, /"alur-kerja": \(\) => <ProductionWorkflowSettings \/>/);
  const wf = strip(src("pages", "bengkel", "ProductionWorkflowSettings.jsx"));
  for (const id of ["workshop-location-select", "adaptation-default-toggle", "mapping-row", "workshop-location-state"]) assert.ok(wf.includes(id), id);
  assert.match(wf, /Tidak pernah dipilih otomatis/); assert.match(wf, /Run yang sudah ada tidak berubah/);
});

test("worker V1: kartu tertunda menampilkan 'Tertunda — <alasan>' dari server dan membuka aksi Lanjutkan", () => {
  const j = jobFromV1({ state: "BLOCKED", stage: { id: "s1", labelId: "Bongkar" }, unit: { id: "u", unitCode: "U", priority: "NORMAL", status: "IN_PRODUCTION", order: { orderNumber: "R", customer: { name: "C" } } } }, { activeBlocker: { reason: "AWAITING_CUSTOMER" }, path: [] });
  assert.match(j.stage.label, /^Tertunda — menunggu arahan/); assert.equal(j.v1.actionable, true);
});
