// Simplifikasi Production slice 1 — kontrak tampilan: 4 status, prioritas Normal/Tinggi/Komplain, Layanan Sales saja, tanpa label V1/V2, "Pekerjaan Tertunda".
// Pola text-scan proyek ini (tanpa jsdom); fungsi murni dieksekusi langsung. Paritas dengan backend/src/lib/domain/productionDisplay.js dijaga di sini.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "../src/features/production/productionLabels.js";
import * as B from "../../backend/src/lib/domain/productionDisplay.js";
import { PRODUCTION_NAV } from "../src/lib/productionNav.js";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Model pekerja mengimpor lewat alias "@/" (Vite): daftarkan hook resolusi alias agar modul ASLI yang diuji.
const SRC_URL = pathToFileURL(path.join(here, "..", "src") + path.sep).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(spec, ctx, next) { return spec.startsWith("@/") ? next(new URL(spec.slice(2), ${JSON.stringify(SRC_URL)}).href, ctx) : next(spec, ctx); }`));
const { jobFromV1, jobFromV2, primaryActionV1 } = await import("../src/features/production/workerApp/workerAppModel.js");
const read = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PRODUCTION_UI = [
  ["features", "production"], ["pages", "bengkel"], ["pages", "produksi"], ["features", "bengkel"],
];
function* walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) yield* walk(p); else if (/\.(jsx|js)$/.test(e.name)) yield p; } }
const uiFiles = () => PRODUCTION_UI.flatMap((d) => [...walk(path.join(here, "..", "src", ...d))]);
// Teks tampilan = isi string/JSX; di sini cukup menyaring komentar baris & blok (istilah internal kode boleh).
const textOf = (f) => strip(fs.readFileSync(f, "utf8"));

test("paritas label frontend ↔ backend: status, alasan tunda, teks status kartu", () => {
  assert.deepEqual(L.DISPLAY_STATUS_TABS.map((t) => t.key), [...B.DISPLAY_STATUS_FILTERS]);
  assert.deepEqual(L.DISPLAY_STATUS_TABS.map((t) => t.label), ["Pengambilan", "Diproses", "Siap Kirim", "Terkirim"]);
  for (const k of Object.keys(B.DELAY_REASONS)) { assert.equal(L.DELAY_REASONS[k].label, B.DELAY_REASONS[k].label, k); assert.equal(L.DELAY_REASONS[k].submitAs, B.DELAY_REASONS[k].submitAs, k); }
  for (const r of ["MATERIAL_SHORTAGE", "AWAITING_CUSTOMER_APPROVAL", "AWAITING_CUSTOMER", "AWAITING_OPERATOR", "MACHINE_DOWN", "QUALITY_ISSUE", "AWAITING_TOOL", "OTHER"]) {
    assert.equal(L.delayStatusText(r), B.delayStatusText(r), r);
    assert.equal(L.delayReasonOfBlock(r).key, B.delayReasonOfBlock(r).key, r);
  }
  assert.equal(L.delayStatusText("OTHER", "mesin jahit macet"), B.delayStatusText("OTHER", "mesin jahit macet"));
});

test("Pekerjaan Tertunda: tombol, pertanyaan, 4 pilihan, 'Lainnya' wajib keterangan, status kartu 'Tertunda — <alasan>'", () => {
  assert.equal(L.DELAY_ACTION_LABEL, "Tunda Pekerjaan"); assert.equal(L.DELAY_QUESTION, "Kenapa pekerjaan ditunda?"); assert.equal(L.RESUME_ACTION_LABEL, "Lanjutkan Pekerjaan"); assert.equal(L.DELAY_TITLE, "Pekerjaan Tertunda");
  assert.deepEqual(L.DELAY_REASON_OPTIONS.map((r) => r.label), ["Menunggu bahan", "Menunggu arahan", "Kendala pengerjaan", "Lainnya"]);
  assert.equal(L.delayFormValid({ key: "LAINNYA", note: "" }), false); assert.equal(L.delayFormValid({ key: "LAINNYA", note: "ab" }), false); assert.equal(L.delayFormValid({ key: "LAINNYA", note: "mesin macet" }), true);
  for (const k of ["BAHAN", "ARAHAN", "KENDALA"]) assert.equal(L.delayFormValid({ key: k, note: "" }), true, k);
  assert.equal(L.delayStatusText("MATERIAL_SHORTAGE"), "Tertunda — menunggu bahan");
  assert.equal(L.delayStatusText("AWAITING_CUSTOMER"), "Tertunda — menunggu arahan");
  assert.equal(L.delayStatusText("MACHINE_DOWN"), "Tertunda — kendala pengerjaan");
  assert.equal(L.delayStatusText("OTHER", "kain belum datang"), "Tertunda — kain belum datang");
});

test("pemetaan ke kontrak backend yang ada: tidak ada enum baru; BAHAN→MATERIAL_SHORTAGE, ARAHAN→AWAITING_CUSTOMER, KENDALA→MACHINE_DOWN, LAINNYA→OTHER; pause TIDAK disamakan dengan blocker", () => {
  assert.deepEqual(Object.fromEntries(L.DELAY_REASON_OPTIONS.map((r) => [r.key, L.blockReasonFor(r.key)])), { BAHAN: "MATERIAL_SHORTAGE", ARAHAN: "AWAITING_CUSTOMER", KENDALA: "MACHINE_DOWN", LAINNYA: "OTHER" });
  const backendEnums = fs.readFileSync(path.join(here, "..", "..", "backend", "prisma", "schema.prisma"), "utf8");
  const enumBody = backendEnums.match(/enum BlockReason \{([^}]+)\}/)[1];
  for (const r of L.DELAY_REASON_OPTIONS) assert.match(enumBody, new RegExp(`\\b${r.submitAs}\\b`), `${r.submitAs} ada di enum BlockReason`);
  // sheet "Jeda" tetap memakai alasan Jeda (PauseReason) — bukan alasan tunda
  const panels = strip(read("features", "production", "workerApp", "V1Panels.jsx"));
  assert.match(panels, /api\.pauseUnitStage\(unitId, stage\.id, \{ reason: pauseReason/); assert.match(panels, /api\.failUnitStage\(unitId, stage\.id, \{ blockReason: blockReasonFor\(blockReason\)/);
  const drawer = strip(read("features", "production", "UnitV1Stage.jsx"));
  assert.match(drawer, /api\.pauseUnitStage\(unit\.id, stage\.id, \{ reason: pauseReason/); assert.match(drawer, /api\.failUnitStage\(unit\.id, stage\.id, \{ blockReason: blockReasonFor\(reason\), note \}/);
});

test("Lanjutkan Pekerjaan: tombol hanya bila aksi pemulihan sah; bila menunggu Gudang/Lead tampil siapa yang bertindak (tanpa tombol palsu)", () => {
  assert.deepEqual(L.resumeInfo({ source: "BLOCKER", reason: "MACHINE_DOWN", canResume: true }), { kind: "BUTTON", label: "Lanjutkan Pekerjaan" });
  const shortage = L.resumeInfo({ source: "SHORTAGE", reason: "MATERIAL_SHORTAGE", canResume: false });
  assert.equal(shortage.kind, "WAIT"); assert.equal(shortage.who, "Gudang"); assert.match(shortage.text, /Gudang/);
  const arahan = L.resumeInfo({ source: "BLOCKER", reason: "AWAITING_CUSTOMER", canResume: false });
  assert.equal(arahan.kind, "WAIT"); assert.equal(arahan.who, "Production Lead");
  assert.match(L.resumeInfo({ source: "BLOCKER", reason: "MACHINE_DOWN", canResume: false }).text, /Production Lead/);
  // Aplikasi Meja/Corner: tahap tertunda → tidak ada tombol (resolusi di Unit 360), dengan penjelasan siapa yang bertindak
  const t = { unit: { currentStageId: "s1" }, path: [{ stage: { id: "s1", labelId: "Bongkar" }, status: "BLOCKED", isCurrent: true }], needsService: false, activeBlocker: { reason: "MATERIAL_SHORTAGE" } };
  const a = primaryActionV1(t, ["PRODUCTION_WORKER"], { state: "BLOCKED" });
  assert.equal(a.kind, "NONE"); assert.match(a.reason, /Gudang/); assert.doesNotMatch(a.reason, /Pekerjaan Tertunda/, "pesan penjelasan bukan label status");
});

test("pesan izin/konflik sistem TIDAK dilabeli 'Pekerjaan Tertunda'", () => {
  const experience = strip(read("features", "production", "experience.js"));
  const model = strip(read("features", "production", "unitV1ActionsModel.js"));
  for (const code of ["WORKSHOP_OPERATOR_MISMATCH", "PLAN_REVISION_CONFLICT", "STEP_WRITER_OFF"]) {
    const line = experience.split("\n").find((l) => l.includes(`"${code}"`)) || "";
    assert.ok(line, code); assert.doesNotMatch(line, /Pekerjaan Tertunda|Tertunda/, code);
  }
  assert.doesNotMatch(model, /Pekerjaan Tertunda/);
  assert.match(experience, /status === 403\) return "Anda tidak punya akses untuk aksi ini\."/);
});

test("kartu pekerja (Meja/Corner): V2 'Tertunda — menunggu bahan' dan V1 'Tertunda — <alasan>' dari server; status & prioritas tanpa label sumber", () => {
  const wait = jobFromV2({ runId: "r", revision: 1, unit: { id: "u", unitCode: "U1" }, customer: { name: "A", salesServices: ["Servis Spring"] }, bucket: "MENUNGGU_BAHAN", plan: { priority: 1 }, unitStatus: { key: "DIPROSES", label: "Diproses" }, presence: { key: "ARRIVED_CONFIRMED", label: "Sudah tiba" } });
  assert.equal(wait.materialWaiting, true); assert.equal(wait.status.label, "Diproses"); assert.equal(wait.priority.label, "Tinggi");
  const v1 = jobFromV1({ state: "BLOCKED", stage: { id: "s1", labelId: "Bongkar" }, unit: { id: "u2", unitCode: "U2", priority: "URGENT", status: "IN_PRODUCTION", order: { orderNumber: "R1", customer: { name: "B" } } } }, { activeBlocker: { reason: "AWAITING_CUSTOMER", note: null }, salesServices: ["Ganti Kain"], path: [] });
  assert.match(v1.stage.label, /^Tertunda — menunggu arahan/); assert.equal(v1.priority.label, "Tinggi", "Mendesak lama tampil Tinggi"); assert.equal(v1.status.label, "Diproses");
  const kom = jobFromV1({ state: "READY", stage: null, unit: { id: "u3", unitCode: "U3", priority: "NORMAL", status: "RECEIVED", priorityDisplay: { key: "COMPLAINT", label: "Komplain", complaintCases: [{ caseNumber: "CMP-1" }] }, order: { orderNumber: "R2", customer: { name: "C" } } } }, null);
  assert.equal(kom.priority.label, "Komplain"); assert.equal(kom.priority.key, "COMPLAINT");
});

test("status: peta unit → 4 label; DELIVERED = Terkirim; siap kirim/pengiriman keluar = Siap Kirim; tidak memalsukan konfirmasi tiba", () => {
  assert.equal(L.statusOf({ status: "AWAITING_PICKUP" }).label, "Pengambilan"); assert.equal(L.statusOf({ status: "IN_TRANSIT_IN" }).label, "Pengambilan");
  assert.equal(L.statusOf({ status: "RECEIVED" }).label, "Diproses"); assert.equal(L.statusOf({ status: "IN_PRODUCTION" }).label, "Diproses");
  for (const s of ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT"]) assert.equal(L.statusOf({ status: s }).label, "Siap Kirim", s);
  assert.equal(L.statusOf({ status: "DELIVERED" }).label, "Terkirim");
  assert.equal(L.viewPresence({ unit: { status: "IN_PRODUCTION" } }), null, "keberadaan fisik hanya dari bukti server — tidak diturunkan di klien");
  assert.equal(L.viewPresence({ presence: { key: "NOT_ARRIVED", label: "Belum tiba di workshop" } }).label, "Belum tiba di workshop");
});

test("prioritas: Normal/Tinggi/Komplain; Mendesak/Kritis lama tampil Tinggi; Komplain hanya dari server; peringkat Komplain > Tinggi > Normal", () => {
  assert.equal(L.priorityOf({ priority: "URGENT" }).label, "Tinggi"); assert.equal(L.priorityOf({ priority: "CRITICAL" }).label, "Tinggi"); assert.equal(L.priorityOf({ priority: 2 }).label, "Tinggi");
  assert.equal(L.priorityOf({ priority: "NORMAL" }).label, "Normal"); assert.equal(L.priorityOf({ plan: { priority: 1 } }).label, "Tinggi");
  assert.equal(L.priorityOf({ priority: "NORMAL", notes: "komplain pelanggan", complaintCategory: "X" }).key, "NORMAL", "teks/catatan tidak pernah menjadi Komplain");
  assert.equal(L.priorityOf({ priority: { key: "COMPLAINT", label: "Komplain" } }).key, "COMPLAINT");
  assert.ok(L.rankOfView({ priority: { key: "COMPLAINT" }, plan: { priority: 0 } }) > L.rankOfView({ plan: { priority: 2 } }));
  assert.ok(L.rankOfView({ plan: { priority: 1 } }) > L.rankOfView({ plan: { priority: 0 } }));
  assert.deepEqual(L.PRIORITY_CHOICES.map((c) => c.label), ["Normal", "Tinggi"], "pengguna hanya memilih Normal/Tinggi; Komplain turunan");
});

test("Layanan Sales saja: tidak ada label 'Layanan Teknis' di layar Production (kecuali input Diagnosis yang dipertahankan)", () => {
  const offenders = [];
  for (const f of uiFiles()) {
    const base = path.basename(f);
    if (base === "DiagnosisWizard.jsx") continue; // input Diagnosis (keputusan: dipertahankan; tidak memengaruhi serviceId tebakan)
    if (/Layanan [Tt]eknis|Jenis layanan/.test(textOf(f))) offenders.push(path.relative(path.join(here, ".."), f));
  }
  assert.deepEqual(offenders, []);
});

test("tanpa label/badge V1/V2 & tanpa tab 'Kerja V1' pada teks tampilan layar Production", () => {
  const offenders = [];
  const jsxText = /(>|["'`])[^<>"'`\n]*\b(V1|V2)\b[^<>"'`\n]*(<|["'`])/;
  for (const f of uiFiles()) {
    if (/[\\/](demo|__tests__)[\\/]/.test(f) && !/demoRoles\.js$/.test(f)) continue;
    const lines = textOf(f).split("\n");
    lines.forEach((l, i) => {
      if (/data-testid|data-source|import |from "|source:|source ===|\.source|api\.|kind: "V1"|kind === "V1"|"V1"|"V2"|v1\b|v2\b|V1_|_V1|V2_|_V2|useV1|v1Source|V1Detail|V2Detail|V1Panels|V1Action|V1Unit|V1Material|V1Stage|loadV1|refreshV1|retryV1|fetchV1|getV1|readerMode|Ownership|\.v1/.test(l)) return;
      if (jsxText.test(l)) offenders.push(`${path.basename(f)}:${i + 1}: ${l.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, []);
  assert.ok(!/Kerja V1/.test(uiFiles().map(textOf).join("\n")));
});

test("istilah lama hilang dari UI Production: 'Blokir Produksi', 'Terblokir', 'Blocker', 'Terhambat', 'Tandai terhambat', 'Menunggu Bahan Baku', 'Mendesak/Kritis' sebagai label", () => {
  const offenders = [];
  const OLD = /Blokir Produksi|Selesaikan blokir|Konfirmasi selesai|Tandai terhambat|Catat hambatan|Alasan hambatan|Menunggu Bahan Baku|\bTerblokir\b|\bTerhambat\b|Unit Terblokir/;
  for (const f of uiFiles()) {
    textOf(f).split("\n").forEach((l, i) => { if (OLD.test(l) && !/^\s*\/\//.test(l)) offenders.push(`${path.basename(f)}:${i + 1}: ${l.trim().slice(0, 100)}`); });
  }
  assert.deepEqual(offenders, []);
});

test("QC disembunyikan dari menu (slice 1) — rute & halaman tetap ada (lifecycle diubah di slice 2, bukan di sini)", () => {
  const labels = PRODUCTION_NAV.flatMap((s) => s.items.map((i) => i.label));
  assert.ok(!labels.includes("Quality Control"));
  const registry = strip(read("routes", "pageRegistry.jsx"));
  assert.match(registry, /ProductionQc/, "halaman QC tetap terdaftar (akses langsung/tautan lama tidak patah)");
});

test("satu bagian 'Pekerjaan' di Unit 360 memakai endpoint/ownership/permission yang sah; tidak ada endpoint baru", () => {
  const drawer = strip(read("features", "production", "UnitOverviewDrawer.jsx"));
  assert.match(drawer, /\["pekerjaan", "Pekerjaan"\]/); assert.doesNotMatch(drawer, /Kerja V1/);
  assert.match(drawer, /data\?\.ownership\?\.v2ExecutionOwned === false/, "aksi langsung hanya bila server melaporkan papan tidak memegang eksekusi");
  const actions = ["UnitV1Actions.jsx", "UnitV1Stage.jsx", "UnitV1Materials.jsx"].map((f) => strip(read("features", "production", f))).join("\n");
  const calls = new Set([...actions.matchAll(/\bapi\.(?!js\b)(\w+)/g)].map((m) => m[1]));
  const allowed = new Set(["getServiceCatalog", "getUnitTimeline", "setUnitService", "updateUnitProduction", "resolveBlocker", "uploadUnitPhotos", "startUnitStage", "completeUnitStage", "failUnitStage", "pauseUnitStage", "resumeUnitStage", "recordQcFitTest", "assignUnitStage", "getWorkCenters", "getProductionOperators", "getUnitMaterials", "getMaterials", "addUnitMaterial"]);
  for (const c of calls) assert.ok(allowed.has(c), `endpoint tak dikenal: ${c}`);
});
