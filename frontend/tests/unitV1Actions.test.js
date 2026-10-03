// P12B.5 — aksi V1 unit non-V2 di drawer Unit 360: peran = cermin izin backend, tanggal WIB, deteksi konflik, pagar V2 (unit cohort tak pernah memakai aksi V1),
// sumber V1/V2 tanpa duplikasi, dan panel "order asli di luar V2" di Ringkasan/Status/Rencana.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSIONS as P, ROLE_PERMISSIONS } from "../../backend/src/constants/permissions.js";
import {
  V1_ROUTING_ROLES, V1_STAGE_ROLES, canResolveBlockerV1, canRouteV1, conflictMessage, detectConflict, draftOf, dueIsoOf, isDraftDirty, productionPatchOf, wibDateOf,
} from "../src/features/production/unitV1ActionsModel.js";
import { PANEL_COPY, isActiveV1, selectV1Units, summarizeV1, topV1Units } from "../src/features/production/nonV2OrdersModel.js";

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
  assert.match(conflictMessage(["priority", "due"]), /prioritas, target selesai/); assert.match(conflictMessage(["blocker"]), /blokir produksi/);
});

test("PAGAR V2: aksi V1 hanya dirender di fallback unit non-V2; drawer cohort & V2Owners tidak punya jalur tulis V1 (tanpa bypass diagnosis/QC/custody)", () => {
  const drawer = strip(src("features", "production", "UnitOverviewDrawer.jsx"));
  assert.doesNotMatch(drawer, /setUnitService|updateUnitProduction|resolveBlocker|startUnitStage|completeUnitStage|recordQcFitTest|UnitV1Actions/, "drawer V2 tanpa API V1");
  assert.match(drawer, /\{unavailable && <div data-testid="unit-overview-fallback"><UnitOrderFallback /);
  const v1 = strip(src("features", "production", "UnitV1Actions.jsx"));
  for (const api of ["setUnitService", "updateUnitProduction", "resolveBlocker"]) assert.match(v1, new RegExp(`api\\.${api}\\(`), api);
  assert.doesNotMatch(v1, /startUnitStage|completeUnitStage|failUnitStage|recordQcFitTest|skipUnitStage|assignUnitStage|changeUnitRoute|production-v2|recordProductionV2Step/, "tidak ada tahap/QC/custody/V2");
  // UnitV1Actions hanya diimpor oleh fallback
  const users = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.jsx?$/.test(e.name) && /from "[^"]*UnitV1Actions/.test(fs.readFileSync(p, "utf8")) && !p.endsWith("UnitV1Actions.jsx")) users.push(path.basename(p)); } };
  walk(path.join(here, "..", "src")); assert.deepEqual(users, ["UnitOrderFallback.jsx"]);
  const owners = strip(src("features", "production", "UnitOverviewDrawer.jsx"));
  assert.match(owners, /function V2Owners\(\{ d \}\)/); assert.match(owners, /Layanan teknis diisi lewat <b>Diagnosis<\/b>/); assert.match(owners, /Prioritas dan target diubah di <b>Rencana Produksi<\/b>/);
});

test("Layanan Sales read-only terpisah dari Layanan Teknis: label & sumber berbeda, Sales tidak pernah menjadi nilai default layanan teknis", () => {
  const v1 = src("features", "production", "UnitV1Actions.jsx");
  assert.match(v1, /Layanan Dipesan \(Sales\)[\s\S]{0,200}ORDER · baca-saja/); assert.match(v1, /Layanan Teknis \(Produksi\)/);
  assert.match(v1, /data\.salesServices/); assert.match(v1, /unit\.service\?\.labelId \|\| "Belum ditetapkan"/);
  assert.doesNotMatch(strip(v1), /setServiceId\(.*salesServices/, "tidak menyalin layanan Sales ke layanan teknis");
});

test("sumber V1/V2 tanpa duplikasi: unit V2 tidak pernah muncul di panel V1; unit terkirim bukan 'aktif'; urutan terhambat → prioritas", () => {
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
  for (const k of ["ringkasan", "status", "rencana"]) assert.match(PANEL_COPY[k], /sumber V1/);
  assert.match(PANEL_COPY.rencana, /tidak membuat Run/);
});

test("panel order asli terpasang di Ringkasan, Status Produksi, dan Rencana Produksi; hanya membaca (tanpa Run/backfill/tulis); tersembunyi di Mode Latihan", () => {
  for (const [f, page] of [["ProductionRingkasan.jsx", "ringkasan"], ["ProductionPlannerV2.jsx", "status"], ["ProductionRencanaWorkspace.jsx", "rencana"]]) {
    assert.match(src("pages", "bengkel", f), new RegExp(`<NonV2OrdersPanel page="${page}" />`), f);
  }
  const panel = strip(src("features", "production", "NonV2OrdersPanel.jsx"));
  assert.deepEqual([...new Set([...panel.matchAll(/\bapi\.(?!js\b)(\w+)/g)].map((m) => m[1]))], ["getWorkOrders"]);
  assert.doesNotMatch(panel, /api\.(create|update|set|delete|post|patch|record|resolve)\w*/);
  assert.match(panel, /if \(!demo\) load\(\)/); assert.match(panel, /if \(demo \|\| units === false/);
  assert.match(panel, /<UnitOverviewDrawer unitId=\{openId\} onClose=\{\(\) => setOpenId\(null\)\} onChanged=\{load\} \/>/);
});
