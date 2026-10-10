// P12B.5 — aksi V1 unit non-V2 di drawer Unit 360: peran = cermin izin backend, tanggal WIB, deteksi konflik, pagar V2 (unit cohort tak pernah memakai aksi V1),
// sumber V1/V2 tanpa duplikasi, dan panel "order asli di luar V2" di Ringkasan/Status/Rencana.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSIONS as P, ROLE_PERMISSIONS } from "../../backend/src/constants/permissions.js";
import {
  V1_ACTION_MATRIX, V1_ASSIGN_ROLES, V1_MATERIAL_ROLES, V1_QC_ROLES, V1_ROUTING_ROLES, V1_STAGE_ROLES, canAssignV1, canMaterialV1, canQcV1, canResolveBlockerV1, canRouteV1, completeFormValid, conflictMessage, detectConflict, draftOf, dueIsoOf,
  failFormValid, isDraftDirty, needsPhotoOf, pauseFormValid, productionPatchOf, qcFormValid, stageStateOf, wibDateOf,
} from "../src/features/production/unitV1ActionsModel.js";
import { isActiveV1, selectV1Units, summarizeV1, topV1Units } from "../src/features/production/nonV2OrdersModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const rolesWith = (perm) => Object.entries(ROLE_PERMISSIONS).filter(([, ps]) => ps.includes(perm)).map(([r]) => r);

test("peran tombol = cermin izin backend (UNIT_ROUTING_WRITE / UNIT_STAGE_WRITE) — tidak lebih luas, tidak lebih sempit dari peran produksi", () => {
  const routing = rolesWith(P.UNIT_ROUTING_WRITE).sort(); const stage = rolesWith(P.UNIT_STAGE_WRITE).sort();
  // peran yang MELIHAT tombol harus seluruhnya memegang izin server (tombol tak pernah memicu 403 yang pasti)
  for (const r of V1_ROUTING_ROLES) assert.ok(routing.includes(r), `${r} memegang UNIT_ROUTING_WRITE`);
  for (const r of V1_STAGE_ROLES) assert.ok(stage.includes(r), `${r} memegang UNIT_STAGE_WRITE`);
  // pemegang izin server yang relevan untuk Produksi tidak tertinggal
  for (const r of routing.filter((x) => ["ADMIN", "OWNER", "PRODUCTION_LEAD"].includes(x))) assert.ok(V1_ROUTING_ROLES.includes(r), r);
  for (const r of stage.filter((x) => ["PRODUCTION_WORKER", "PRODUCTION_LEAD", "QC_LEAD", "ADMIN", "OWNER"].includes(x))) assert.ok(V1_STAGE_ROLES.includes(r), r);
  assert.deepEqual([...V1_ROUTING_ROLES].sort(), ["ADMIN", "OWNER", "PRODUCTION_LEAD"].sort());
  for (const r of ["SALES", "FINANCE", "WAREHOUSE", "PRODUCTION_DOCUMENTER", "DRIVER"]) { assert.equal(canRouteV1([r]), false, r); assert.equal(canResolveBlockerV1([r]), false, r); }
  assert.equal(canRouteV1(["PRODUCTION_WORKER"]), false, "pekerja tak boleh mereprioritaskan pekerjaannya sendiri");
  assert.equal(canResolveBlockerV1(["PRODUCTION_WORKER"]), true);
  assert.equal(canRouteV1(["QC_LEAD"]), false); assert.equal(canRouteV1(null), false); assert.equal(canRouteV1(undefined), false);
});

test("target produksi memakai tanggal kalender WIB (bukan slice UTC yang salah sehari di halaman lama)", () => {
  assert.equal(wibDateOf("2026-10-19T17:00:00.000Z"), "2026-10-20");
  assert.equal(wibDateOf("2026-10-20T16:59:59.000Z"), "2026-10-20"); assert.equal(wibDateOf("2026-10-20T17:00:00.000Z"), "2026-10-21");
  assert.equal(wibDateOf(null), ""); assert.equal(wibDateOf(undefined), "");
  assert.equal(dueIsoOf("2026-10-20"), "2026-10-20T00:00:00+07:00"); assert.equal(dueIsoOf(""), null);
  assert.equal(new Date(dueIsoOf("2026-10-20")).toISOString(), "2026-10-19T17:00:00.000Z");
  assert.equal(wibDateOf(new Date(dueIsoOf("2026-12-31")).toISOString()), "2026-12-31", "bolak-balik utuh (akhir tahun)");
});

test("draf & PATCH: hanya bidang yang berubah dikirim; tanpa perubahan = tombol Simpan nonaktif; target dapat dikosongkan", () => {
  const unit = { priority: "HIGH", productionDueAt: "2026-10-19T17:00:00.000Z" };
  assert.deepEqual(draftOf(unit), { priority: "HIGH", due: "2026-10-20" });
  assert.deepEqual(draftOf({}), { priority: "NORMAL", due: "" });
  assert.equal(isDraftDirty({ priority: "HIGH", due: "2026-10-20" }, unit), false);
  assert.equal(isDraftDirty({ priority: "URGENT", due: "2026-10-20" }, unit), true);
  assert.deepEqual(productionPatchOf({ priority: "URGENT", due: "2026-10-20" }, unit), { priority: "URGENT" });
  assert.deepEqual(productionPatchOf({ priority: "HIGH", due: "2026-10-22" }, unit), { productionDueAt: "2026-10-22T00:00:00+07:00" });
  assert.deepEqual(productionPatchOf({ priority: "HIGH", due: "" }, unit), { productionDueAt: null });
  assert.deepEqual(productionPatchOf({ priority: "HIGH", due: "2026-10-20" }, unit), {});
});

test("deteksi konflik: bidang yang berubah di antara baca & tulis dilaporkan; yang tidak berubah tidak; pesan menyebut bidangnya", () => {
  const base = { unit: { serviceId: null, priority: "NORMAL", productionDueAt: null }, activeBlocker: { id: "b1" } };
  assert.deepEqual(detectConflict(base, JSON.parse(JSON.stringify(base))), []);
  assert.deepEqual(detectConflict(base, { ...base, unit: { ...base.unit, priority: "URGENT" } }), ["priority"]);
  assert.deepEqual(detectConflict(base, { ...base, unit: { ...base.unit, serviceId: "s1" } }, ["service"]), ["service"]);
  assert.deepEqual(detectConflict(base, { ...base, unit: { ...base.unit, productionDueAt: "2026-10-19T17:00:00.000Z" } }, ["priority", "due"]), ["due"]);
  assert.deepEqual(detectConflict(base, { ...base, activeBlocker: null }, ["blocker"]), ["blocker"]);
  assert.deepEqual(detectConflict(base, { ...base, activeBlocker: { id: "b2" } }, ["blocker"]), ["blocker"], "blokir baru ≠ blokir yang dilihat");
  assert.deepEqual(detectConflict({ unit: { priority: undefined } }, { unit: { priority: "NORMAL" } }, ["priority"]), [], "undefined = NORMAL");
  assert.match(conflictMessage(["priority", "due"]), /prioritas, target selesai/); assert.match(conflictMessage(["blocker"]), /penundaan pekerjaan/); assert.doesNotMatch(conflictMessage(["blocker"]), /Pekerjaan Tertunda/, "pesan konflik sistem tidak dilabeli Pekerjaan Tertunda");
});

test("PAGAR V2: aksi V1 hanya dirender di fallback unit non-V2; drawer cohort & V2Owners tidak punya jalur tulis V1 (tanpa bypass diagnosis/QC/custody)", () => {
  const drawer = strip(src("features", "production", "UnitOverviewDrawer.jsx"));
  assert.doesNotMatch(drawer, /setUnitService|updateUnitProduction|resolveBlocker|startUnitStage|completeUnitStage|recordQcFitTest|UnitV1Actions/, "drawer V2 tanpa API V1");
  assert.match(drawer, /\{unavailable && <div data-testid="unit-overview-fallback"><UnitOrderFallback /);
  const v1 = strip(src("features", "production", "UnitV1Actions.jsx"));
  for (const api of ["setUnitService", "updateUnitProduction"]) assert.match(v1, new RegExp(`api\\.${api}\\(`), api);
  assert.doesNotMatch(v1, /api\.resolveBlocker\(/, "slice 2: SATU aksi Lanjutkan (resume-work) — tombol selesaikan-blokir terpisah dihapus");
  assert.doesNotMatch(v1, /startUnitStage|completeUnitStage|failUnitStage|recordQcFitTest|skipUnitStage|assignUnitStage|changeUnitRoute|production-v2|recordProductionV2Step/, "tidak ada tahap/QC/custody/V2");
  // UnitV1Actions hanya diimpor oleh fallback
  const users = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.jsx?$/.test(e.name) && /from "[^"]*UnitV1Actions/.test(fs.readFileSync(p, "utf8")) && !p.endsWith("UnitV1Actions.jsx")) users.push(path.basename(p)); } };
  walk(path.join(here, "..", "src")); assert.deepEqual(users, ["UnitOrderFallback.jsx"]);
  for (const c of ["UnitV1Stage", "UnitV1Materials"]) { const u2 = []; const w2 = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w2(p); else if (/\.jsx?$/.test(e.name) && new RegExp(`from "[^"]*${c}`).test(fs.readFileSync(p, "utf8"))) u2.push(path.basename(p)); } }; w2(path.join(here, "..", "src")); assert.deepEqual(u2, ["UnitOrderFallback.jsx"], c); }
  const owners = strip(src("features", "production", "UnitOverviewDrawer.jsx"));
  assert.match(owners, /function V2Owners\(\{ d \}\)/); assert.doesNotMatch(owners, /Layanan teknis diisi lewat/); assert.match(owners, /Prioritas Normal\/Tinggi dan target diubah di <b>Rencana Produksi<\/b>/);
});

test("Slice 1: hanya Layanan Sales yang tampil; layanan teknis historis tidak ditampilkan; pemilih rute hanya bila rute BELUM ada; Sales tidak pernah menjadi nilai default layanan teknis", () => {
  const v1 = src("features", "production", "UnitV1Actions.jsx");
  assert.match(v1, /Layanan Dipesan \(Sales\)[\s\S]{0,200}ORDER · baca-saja/); assert.doesNotMatch(v1, /Layanan Teknis \(Produksi\)|labelId \|\| "Belum ditetapkan"/);
  assert.match(v1, /data\.salesServices/); assert.match(v1, /\{!unit\.service && \(canRoute/);
  assert.doesNotMatch(strip(v1), /setServiceId\(.*salesServices/, "tidak menyalin layanan Sales ke layanan teknis");
});

test("unit di luar rencana papan tanpa duplikasi: unit berencana tidak muncul di daftar 'belum masuk papan'; unit terkirim bukan 'aktif'; urutan tertunda → prioritas", () => {
  const units = [
    { id: "a", unitCode: "A", status: "AWAITING_PICKUP", inProductionV2: true },
    { id: "b", unitCode: "B", status: "AWAITING_PICKUP", inProductionV2: false, priority: "NORMAL" },
    { id: "c", unitCode: "C", status: "IN_PRODUCTION", inProductionV2: false, priority: "URGENT" },
    { id: "d", unitCode: "D", status: "IN_PRODUCTION", inProductionV2: false, productionStatus: "BLOCKED" },
    { id: "e", unitCode: "E", status: "DELIVERED", inProductionV2: false },
    { id: "f", unitCode: "F", status: "AWAITING_PICKUP" /* penanda hilang = V1 (server lama) */ },
  ];
  assert.deepEqual(selectV1Units(units).map((u) => u.id), ["b", "c", "d", "f"]);
  assert.equal(isActiveV1(units[0]), false); assert.equal(isActiveV1(units[4]), false); assert.equal(isActiveV1(null), false);
  const ids = new Set(selectV1Units(units).map((u) => u.id)); for (const u of units.filter((x) => x.inProductionV2)) assert.ok(!ids.has(u.id));
  assert.deepEqual(topV1Units(units).map((u) => u.id), ["d", "c", "b", "f"]);
  assert.equal(topV1Units(units, 2).length, 2);
  const s = summarizeV1(units); assert.equal(s.total, 4); assert.equal(s.blocked, 1);
  assert.equal(s.byStatus.reduce((n, x) => n + x.count, 0), 4);
  assert.deepEqual(summarizeV1([]), { total: 0, blocked: 0, byStatus: [] });
});

test("unit di luar rencana papan menyatu di papan/daftar UTAMA tanpa label sumber — bukan panel/workspace kedua", () => {
  assert.equal(fs.existsSync(path.join(here, "..", "src", "features", "production", "NonV2OrdersPanel.jsx")), false, "panel V1 terpisah dihapus");
  const hook = strip(src("features", "production", "v1Source.jsx"));
  assert.deepEqual([...new Set([...hook.matchAll(/\bapi\.(?!js\b)(\w+)/g)].map((m) => m[1]))], ["getWorkOrders"]);
  assert.doesNotMatch(hook, /api\.(create|update|set|delete|post|patch|record|resolve)\w*/);
  assert.match(hook, /if \(!demo\) load\(\)/); assert.match(hook, /demo \? \[\] : selectV1Units/, "tersembunyi di Mode Latihan");
  assert.doesNotMatch(hook, /source-badge|SourceBadge|>V1<|>V2</, "tanpa label sumber");
  const planner = strip(src("pages", "bengkel", "ProductionPlannerV2.jsx"));
  assert.match(planner, /<V1UnitCard key=\{u\.id\} unit=\{u\} onOpen=\{openOverview\} \/>/); assert.match(planner, /\["Unit", "Customer", "Layanan Sales", "Status"/); assert.doesNotMatch(planner, /"Sumber"|SourceBadge/); assert.match(planner, /data-testid="v1-row"/);
  assert.match(planner, /chipsAll/); assert.match(planner, /onChanged=\{reloadV1\}/); assert.doesNotMatch(planner, /NonV2OrdersPanel/);
  const rencana = strip(src("pages", "bengkel", "ProductionRencanaWorkspace.jsx"));
  assert.doesNotMatch(rencana, /NonV2OrdersPanel|PANEL_COPY/);
  const ring = strip(src("pages", "bengkel", "ProductionRingkasan.jsx"));
  assert.match(ring, /data-testid="v1-attention"/); assert.doesNotMatch(ring, /NonV2OrdersPanel|source-badge|SourceBadge/);
  const wo = strip(src("pages", "bengkel", "ProductionWorkOrders.jsx"));
  assert.doesNotMatch(wo, /SourceBadge|sourceOf|order-source-filter|filterBySource/, "tanpa label/filter sumber");
});

test("peran QC/bahan/penugasan = cermin izin backend (QC_WRITE / UNIT_MATERIAL_WRITE / PRODUCTION_ASSIGNMENT_WRITE)", () => {
  const pairs = [[P.QC_WRITE, V1_QC_ROLES, canQcV1], [P.UNIT_MATERIAL_WRITE, V1_MATERIAL_ROLES, canMaterialV1], [P.PRODUCTION_ASSIGNMENT_WRITE, V1_ASSIGN_ROLES, canAssignV1]];
  for (const [perm, ui, fn] of pairs) {
    const server = rolesWith(perm);
    for (const r of ui) assert.ok(server.includes(r), `${r} memegang ${perm}`);
    for (const r of server.filter((x) => ["PRODUCTION_WORKER", "PRODUCTION_LEAD", "QC_LEAD", "ADMIN", "OWNER", "WAREHOUSE"].includes(x))) assert.ok(ui.includes(r), `${r} tidak tertinggal`);
    for (const r of ["SALES", "FINANCE", "DRIVER", "PRODUCTION_DOCUMENTER"]) assert.equal(fn([r]), false, r);
  }
  assert.equal(canQcV1(["PRODUCTION_WORKER"]), false); assert.equal(canAssignV1(["QC_LEAD"]), false); assert.equal(canMaterialV1(["QC_LEAD"]), false);
});

test("keadaan tahap → tombol: stageStateOf menurunkan satu keadaan dari timeline; tanpa lewati/rute", () => {
  const stage = (o = {}) => ({ id: "s1", labelId: "Bongkar", requiresQc: false, requiresPhoto: true, ...o });
  const mk = (cur, status, extra = {}) => ({ unit: { currentStageId: cur ? "s1" : null }, path: [{ stage: stage(extra.stage), status, isCurrent: !!cur }, { stage: stage({ id: "s2", labelId: "Berikut" }), status: "NOT_STARTED", isCurrent: false }], needsService: false });
  assert.equal(stageStateOf({ unit: { currentStageId: null }, path: [], needsService: true }).kind, "NEEDS_SERVICE");
  assert.equal(stageStateOf(mk(false, "NOT_STARTED")).kind, "NOT_STARTED"); assert.equal(stageStateOf(mk(false, "NOT_STARTED")).first.labelId, "Bongkar");
  assert.equal(stageStateOf(mk(true, "NOT_STARTED")).kind, "READY"); assert.equal(stageStateOf(mk(true, "READY")).kind, "READY");
  assert.equal(stageStateOf(mk(true, "IN_PROGRESS")).kind, "IN_PROGRESS");
  assert.equal(stageStateOf(mk(true, "IN_PROGRESS", { stage: { requiresQc: true } })).kind, "IN_PROGRESS_QC");
  assert.equal(stageStateOf(mk(true, "PAUSED")).kind, "PAUSED"); assert.equal(stageStateOf(mk(true, "BLOCKED")).kind, "BLOCKED");
  assert.equal(stageStateOf({ unit: { currentStageId: "s9" }, path: [], needsService: false }).kind, "ALL_DONE");
  assert.equal(needsPhotoOf(stageStateOf(mk(true, "IN_PROGRESS"))), true); assert.equal(needsPhotoOf(stageStateOf(mk(true, "IN_PROGRESS", { stage: { requiresPhoto: false } }))), false);
  const code = strip(src("features", "production", "UnitV1Stage.jsx"));
  for (const a of ["startUnitStage", "completeUnitStage", "failUnitStage", "pauseUnitStage", "resumeProductionWork", "recordQcFitTest", "assignUnitStage", "uploadUnitPhotos"]) assert.match(code, new RegExp(`api\\.${a}\\(`), a);
  assert.doesNotMatch(code, /skipUnitStage|changeUnitRoute|adminBypass|production-v2/, "aksi berisiko tidak dibuka");
});

test("validasi form tahap: alasan OTHER wajib catatan; QC wajib berat acuan, edukasi bila override, foto bila tahap mewajibkan", () => {
  assert.equal(failFormValid({ reason: "OTHER", note: "x" }), false); assert.equal(failFormValid({ reason: "OTHER", note: "alasan" }), true); assert.equal(failFormValid({ reason: "MATERIAL_SHORTAGE", note: "" }), true);
  assert.equal(pauseFormValid({ reason: "OTHER", note: "" }), false); assert.equal(pauseFormValid({ reason: "BREAK", note: "" }), true);
  assert.equal(qcFormValid({ referenceWeightKg: "70", needsPhoto: false, photos: [] }), false, "verdict wajib dipilih"); assert.equal(qcFormValid({ verdict: "PAS", referenceWeightKg: "", needsPhoto: false, photos: [] }), false); assert.equal(qcFormValid({ verdict: "PAS", referenceWeightKg: "70", needsPhoto: false, photos: [] }), true);
  assert.equal(qcFormValid({ verdict: "PAS", referenceWeightKg: "70", override: "X", educationGiven: false, needsPhoto: false, photos: [] }), false);
  assert.equal(qcFormValid({ verdict: "PAS", referenceWeightKg: "70", needsPhoto: true, photos: [] }), false); assert.equal(qcFormValid({ verdict: "PAS", referenceWeightKg: "70", needsPhoto: true, photos: ["u"] }), true);
  assert.equal(completeFormValid({ needsPhoto: true, photos: [] }), false); assert.equal(completeFormValid({ needsPhoto: false, photos: [] }), true);
});

test("MATRIKS aksi: setiap aksi halaman lama terdaftar dengan status TERSEDIA/DIBATASI/SENGAJA_DIHENTIKAN + alasan; yang dihentikan tidak punya UI", () => {
  const byKey = Object.fromEntries(V1_ACTION_MATRIX.map((a) => [a.key, a]));
  for (const k of ["service", "production", "start", "complete", "pause", "fail", "resolveBlocker", "qc", "material", "assign", "skip", "route", "scopeRevision", "adminBypass"]) assert.ok(byKey[k], k);
  assert.deepEqual(V1_ACTION_MATRIX.filter((a) => a.status === "SENGAJA_DIHENTIKAN").map((a) => a.key), ["skip", "route", "scopeRevision", "adminBypass"]);
  for (const a of V1_ACTION_MATRIX.filter((x) => x.status === "SENGAJA_DIHENTIKAN")) { assert.ok(a.note.length > 30, `${a.key}: alasan + guard`); assert.deepEqual(a.roles, []); }
  for (const a of V1_ACTION_MATRIX.filter((x) => x.status !== "SENGAJA_DIHENTIKAN")) assert.ok(a.roles.length > 0 && a.cohort, a.key);
  const ui = ["UnitV1Actions.jsx", "UnitV1Stage.jsx", "UnitV1Materials.jsx"].map((f) => strip(src("features", "production", f))).join("\n");
  for (const a of ["skipUnitStage", "changeUnitRoute", "proposeScopeRevision"]) assert.doesNotMatch(ui, new RegExp(a), a);
});

test("PlannerV2 RunDrawer: penetapan layanan V1 dihapus (server menutup 409 UNIT_V2_OWNED) dan layanan teknis tidak ditampilkan (Slice 1)", () => {
  const planner = strip(src("pages", "bengkel", "ProductionPlannerV2.jsx"));
  assert.doesNotMatch(planner, /setUnitService/); assert.doesNotMatch(planner, /rundrawer-service-owner|Layanan teknis|Jenis layanan/);
  assert.deepEqual([...strip(src("pages", "bengkel", "ProductionPlannerV2.jsx")).matchAll(/api\.(setUnitService|updateUnitProduction)/g)], []);
  const api = src("api.js");
  assert.match(api, /setUnitService: \(unitId, serviceId, expectedServiceId\)/); assert.match(api, /expected \? \{ expected \} : \{\}/);
  const act = strip(src("features", "production", "UnitV1Actions.jsx"));
  // Tidak ada pilihan layanan: rute diturunkan server dari Layanan Sales (serviceId null); UI tidak punya pemilih jenis pengerjaan.
  assert.match(act, /api\.setUnitService\(unit\.id, null, unit\.serviceId \?\? null\)/);
  assert.doesNotMatch(act, /v1-service-select|Pilih jenis pengerjaan|getServiceCatalog/);
  assert.match(act, /v1-route-reason/); assert.match(act, /Yang memperbaiki:/); assert.match(act, /expected: \{ priority: unit\.priority \|\| "NORMAL", productionDueAt: unit\.productionDueAt \|\| null \}/);
  assert.match(act, /e\.code === "UNIT_CONFLICT"/);
});

test("kepemilikan (Slice 1): aksi pekerjaan langsung hanya di dalam tab 'Pekerjaan' bila server melaporkan papan TIDAK memegang eksekusi; tanpa tab 'Kerja V1'; engine & endpoint V1 memakai SATU predikat", () => {
  const drawer = strip(src("features", "production", "UnitOverviewDrawer.jsx"));
  assert.match(drawer, /data\?\.ownership\?\.v2ExecutionOwned === false/);
  assert.doesNotMatch(drawer, /Kerja V1|\["v1"/);
  assert.match(drawer, /tab === "pekerjaan" && \(/); assert.match(drawer, /\{v1Workable && <div data-testid="pekerjaan-actions"><UnitOrderFallback v2View/);
  const fb = strip(src("features", "production", "UnitOrderFallback.jsx"));
  assert.match(fb, /data-testid="unit-v2-not-owned-notice"/); assert.match(fb, /Unit ini belum punya rencana di papan produksi/);
  const be = (...p) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "backend", "src", ...p), "utf8");
  const engine = be("services", "unitStageEngine.js");
  assert.match(engine, /guardV1UnitWrite\(tx, unitId/); assert.doesNotMatch(engine, /resolveProductionWriterState/);
  const routes = be("routes", "units.js");
  assert.doesNotMatch(routes, /assertUnitNotInV2Cohort|assertUnitNotV2Owned\(prisma/); assert.match(routes, /guardV1UnitWrite\(tx, /);
  // gerbang V1 dijalankan DI DALAM transaksi mutasi (kunci unit -> kepemilikan -> tulis) untuk SEMUA endpoint V1, termasuk rute/penugasan/bahan
  assert.match(routes, /changeUnitRoute\(req\.params\.id, \{ actorId: req\.user\.id, guardV1:/); assert.match(routes, /guardV1: "penugasan work center\/operator"/);
  assert.match(routes, /prisma\.\$transaction\(async \(tx\) => \{\s+await guardV1UnitWrite\(tx, unit\.id, \{ what: "pemakaian bahan"/);
  // peringatan drift (rollback writer OFF -> aksi V1 -> writer ON) tampil di drawer
  assert.match(drawer, /data-testid="unit-v1-drift-notice"/); assert.match(drawer, /data\.ownership\?\.v1Drift/);
});
