// P12B.2 — Mode Latihan: akses per peran, halaman per peran, checklist baca-saja, default OFF/reset, dan NOL mutasi.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TRAINING_CHECKLISTS, TRAINING_DENIED_ROLES, TRAINING_LABEL, TRAINING_PAGES, TRAINING_ROLES, canUseTraining, checklistsForRoles, pageAllowedForTraining, pagesForRoles,
} from "../src/features/production/demo/demoRoles.js";
import { DEMO_LABEL, DemoReadOnlyError, activateDemo, deactivateDemo, demoBlock, demoGate, installDemoNetworkGuard, isDemoActive } from "../src/features/production/demo/demoGate.js";
import { buildResolver } from "../src/features/production/demo/demoDataset.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const snapshot = JSON.parse(src("features", "production", "demo", "demoSnapshot.json"));

test("label: 'Mode Latihan' dan banner 'MODE LATIHAN — bukan data operasional' (gerbang, server, dan UI sepakat)", () => {
  assert.equal(TRAINING_LABEL, "MODE LATIHAN — bukan data operasional");
  assert.equal(DEMO_LABEL, TRAINING_LABEL);
  const ctl = src("features", "production", "demo", "DemoControls.jsx");
  assert.match(ctl, /aria-label="Mode Latihan"/); assert.doesNotMatch(strip(ctl), /Lihat Data Demo|MODE DEMO/);
  assert.match(ctl, /data-testid="demo-badge"/); assert.match(ctl, /\{DEMO_LABEL\}/);
  assert.match(fs.readFileSync(path.join(here, "..", "..", "backend", "src", "routes", "productionExperience.js"), "utf8"), /label: "MODE LATIHAN — bukan data operasional"/);
});

test("akses: tujuh peran latihan boleh; Sales/Finance/Driver/anonim ditolak", () => {
  assert.deepEqual([...TRAINING_ROLES].sort(), ["ADMIN", "OWNER", "PRODUCTION_DOCUMENTER", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE"]);
  for (const r of TRAINING_ROLES) assert.equal(canUseTraining([r]), true, r);
  for (const r of ["SALES", "FINANCE", "DRIVER", "HELPER", "DISPATCHER", "LEADER_DRIVER", "APPROVER"]) assert.equal(canUseTraining([r]), false, r);
  for (const r of TRAINING_DENIED_ROLES) assert.equal(canUseTraining([r]), false, r);
  assert.equal(canUseTraining([]), false); assert.equal(canUseTraining(undefined), false); assert.equal(canUseTraining(null), false);
  assert.equal(canUseTraining(["SALES", "PRODUCTION_LEAD"]), true, "peran ganda: cukup satu peran latihan");
});

test("tiap peran hanya melihat halaman sesuai izinnya (matriks halaman latihan)", () => {
  const labels = (roles) => pagesForRoles(roles).map((p) => p.label);
  assert.deepEqual(labels(["ADMIN"]), TRAINING_PAGES.map((p) => p.label), "ADMIN semua");
  assert.deepEqual(labels(["OWNER"]), TRAINING_PAGES.map((p) => p.label));
  assert.deepEqual(labels(["PRODUCTION_LEAD"]), ["Ringkasan", "Status Produksi", "Rencana Produksi", "Quality Control", "KPI & Laporan", "Aplikasi Meja", "Aplikasi Corner", "Aplikasi Dokumentasi", "KPI Gudang"]);
  assert.deepEqual(labels(["PRODUCTION_WORKER"]), ["Aplikasi Meja", "Aplikasi Corner"]);
  assert.deepEqual(labels(["QC_LEAD"]), ["Status Produksi", "Quality Control", "Antrean PIC QC"]);
  assert.deepEqual(labels(["WAREHOUSE"]), ["Antrean Gudang", "KPI Gudang"]);
  assert.deepEqual(labels(["PRODUCTION_DOCUMENTER"]), ["Aplikasi Dokumentasi"]);
  assert.deepEqual(labels(["SALES"]), []); assert.deepEqual(labels(["FINANCE"]), []);
});

test("gerbang halaman: peran non-admin yang membuka halaman di luar izinnya TIDAK mendapat data latihan (fail-closed)", () => {
  assert.equal(pageAllowedForTraining(["ADMIN"], "/bengkel/rencana-produksi"), true);
  assert.equal(pageAllowedForTraining(["PRODUCTION_WORKER"], "/produksi/meja"), true);
  assert.equal(pageAllowedForTraining(["PRODUCTION_WORKER"], "/bengkel/rencana-produksi"), false);
  assert.equal(pageAllowedForTraining(["PRODUCTION_WORKER"], "/bengkel/kpi"), false);
  assert.equal(pageAllowedForTraining(["QC_LEAD"], "/bengkel/quality-control"), true);
  assert.equal(pageAllowedForTraining(["QC_LEAD"], "/warehouse/antrean-produksi"), false);
  assert.equal(pageAllowedForTraining(["WAREHOUSE"], "/warehouse/antrean-produksi"), true);
  assert.equal(pageAllowedForTraining(["WAREHOUSE"], "/bengkel/quality-control"), false);
  assert.equal(pageAllowedForTraining(["PRODUCTION_DOCUMENTER"], "/produksi/dokumentasi"), true);
  assert.equal(pageAllowedForTraining(["PRODUCTION_DOCUMENTER"], "/produksi/meja"), false);
  assert.equal(pageAllowedForTraining(["SALES"], "/bengkel/ringkasan"), false);
  assert.equal(pageAllowedForTraining(["PRODUCTION_LEAD"], "/path/tidak/dikenal"), false);
  assert.equal(pageAllowedForTraining(["PRODUCTION_LEAD"], "/bengkel/kpi?demo=1"), true, "query diabaikan");
  const ctl = strip(src("features", "production", "demo", "DemoControls.jsx"));
  assert.match(ctl, /const eligible = canUseDemo\(roles\) && pageAllowedForTraining\(roles, location\.pathname\)/);
});

test("halaman latihan terpasang: seluruh halaman dibungkus DemoPage, termasuk Aplikasi Meja & Corner; data tersedia di snapshot", () => {
  const reg = src("routes", "pageRegistry.jsx");
  // P12C: Aplikasi Meja/Corner menerima ctx (user/onLogout) untuk tab Akun; P12D: Aplikasi Dokumentasi juga (kerangka sama).
  // slotBar: bar Mode Latihan pindah ke tab Akun (aplikasi lantai mobile) — perilaku demo tidak berubah.
  for (const [to, comp, args, slot] of [["/produksi/meja", "WorkerLane lane=\"TABLE\"", "ctx", " slotBar"], ["/produksi/corner", "WorkerLane lane=\"CORNER\"", "ctx", " slotBar"], ["/produksi/dokumentasi", "ProductionDocumentation", "ctx", " slotBar"]]) assert.match(reg, new RegExp(`path: "${to}", render: \\(${args}\\) => <DemoPage${slot}><${comp}`), to);
  for (const to of ["/bengkel/ringkasan", "/bengkel/production-v2", "/bengkel/rencana-produksi", "/bengkel/quality-control", "/bengkel/kpi", "/warehouse/antrean-produksi", "/warehouse/kpi"]) assert.match(reg, new RegExp(`path: "${to}", render: \\(\\) => <DemoPage>`), to);
  const urls = new Set(snapshot.entries.map((e) => e.url));
  for (const u of ["/production-v2/worker/table", "/production-v2/worker/corner"]) assert.ok(urls.has(u), u);
  for (const p of TRAINING_PAGES) assert.ok(reg.includes(`path: "${p.to}"`), `${p.to} terdaftar`);
});

test("antrean Meja/Corner di snapshot konsisten dengan kartu unit (daftar & detail tidak saling bertentangan) dan tanpa data nyata", () => {
  const resolve = buildResolver(snapshot);
  const table = resolve("/production-v2/worker/table"); const corner = resolve("/production-v2/worker/corner");
  assert.equal(table.readerMode, "COHORT"); assert.ok(table.items.length >= 5 && corner.items.length >= 1);
  for (const item of [...table.items, ...corner.items]) {
    const card = resolve(`/production-v2/runs/${item.runId}/card`);
    assert.equal(card.unit.unitCode, item.unit.unitCode); assert.deepEqual(card.next, item.next);
    assert.match(item.unit.unitCode, /^QA-PV2-U\d+$/);
  }
  assert.equal(new Set(table.items.map((i) => i.runId)).size, table.items.length);
  assert.doesNotMatch(JSON.stringify(snapshot), /\/media\/|[?&](sig|exp)=|eyJ[A-Za-z0-9_-]{20,}/);
});

test("default OFF, tidak tersimpan, dan reset saat logout/keluar halaman", () => {
  assert.equal(isDemoActive(), false, "default OFF");
  activateDemo(() => ({})); assert.equal(isDemoActive(), true);
  deactivateDemo(); assert.equal(isDemoActive(), false);
  const app = strip(src("App.jsx"));
  assert.match(app, /function handleLogout\(\) \{[\s\S]{0,700}deactivateDemo\(\)/, "logout mematikan Mode Latihan");
  const ctl = strip(src("features", "production", "demo", "DemoControls.jsx"));
  assert.doesNotMatch(ctl, /localStorage\.setItem|sessionStorage|document\.cookie/);
  assert.match(ctl, /useEffect\(\(\) => \(\) => \{ if \(visible\) deactivateDemo\(\); \}, \[visible\]\)/, "meninggalkan halaman = mati");
  assert.match(strip(src("lib", "openTabs.js")), /stripDemoParam/);
});

test("NOL mutasi: semua metode non-GET, unggah, dan export ditolak SEBELUM jaringan; GET data produksi dilayani dataset", async () => {
  const calls = []; const XHR = class { open() { calls.push(["XHR"]); } };
  const win = { fetch: async (i, init) => { calls.push([init?.method || "GET", String(i)]); return "ok"; }, XMLHttpRequest: XHR };
  installDemoNetworkGuard(win);
  const resolve = buildResolver(snapshot);
  activateDemo(resolve);
  try {
    for (const m of ["POST", "PATCH", "PUT", "DELETE"]) {
      await assert.rejects(demoGate("/production-v2/runs/x/steps/1", m), DemoReadOnlyError, m);
      await assert.rejects(win.fetch("/api/production-v2/runs/x/steps/1", { method: m }), DemoReadOnlyError, `fetch ${m}`);
    }
    await assert.rejects(Promise.resolve(demoBlock("Unggah foto")), DemoReadOnlyError); await assert.rejects(win.fetch("/api/production-v2/reports/export?kind=summary"), DemoReadOnlyError);
    assert.throws(() => new win.XMLHttpRequest().open("POST", "/api/production-v2/plans"), DemoReadOnlyError);
    const queue = await demoGate("/production-v2/worker/table", "GET");
    assert.ok(queue.items.length > 0, "antrean Meja dilayani dataset");
    assert.equal(calls.length, 0, "tidak ada satu pun permintaan jaringan");
  } finally { deactivateDemo(); }
});

test("tombol aksi Aplikasi Meja/Corner bertanda data-mutates (dinonaktifkan di Mode Latihan); membuka lembar isian tetap baca-saja", () => {
  // P12C: tombol ada di workerApp/* — SETIAP titik kirim ke server bertanda data-mutates (Mode Latihan menonaktifkannya); membuka lembar tetap baca-saja.
  const sheets = src("features", "production", "workerApp", "workerSheets.jsx");
  assert.equal((sheets.match(/data-mutates/g) || []).length, 2, "kirim tahap, kirim kekurangan bahan");
  assert.match(sheets, /<button type="button" data-mutates onClick=\{submit\} disabled=\{gate\.disabled\}/);
  assert.match(src("features", "production", "workerApp", "JobDetail.jsx"), /data-mutates=\{next\.action === "RESUME" \|\| isQuickAction\(next\) \? "" : undefined\}/);
  // slice 2: setiap tombol kirim pada lembar adaptasi (lewati / selesaikan / tunda) juga bertanda data-mutates
  const ad = src("features", "production", "workerApp", "adaptationSheets.jsx");
  for (const id of ["skip-confirm", "finish-confirm", "delay-confirm"]) assert.match(ad, new RegExp("data-mutates data-testid=\"" + id + "\""), id);
  const v1 = src("features", "production", "workerApp", "V1Panels.jsx");
  for (const id of ["v1-primary", "v1-complete-save", "v1-pause-save", "v1-block-save", "v1-material-save"]) assert.match(v1, new RegExp(`data-mutates[^>]*data-testid="${id}"`), id);
  for (const open of ["v1-pause-open", "v1-block-open"]) assert.doesNotMatch(v1.match(new RegExp(`<button[^>]*data-testid="${open}"[^>]*>`))[0], /data-mutates/, `${open}: hanya membuka lembar`);
});

test("checklist: baca-saja (tanpa tombol/input/centang/handler), isi sesuai peran", () => {
  const keys = (roles) => checklistsForRoles(roles).map((c) => c.key);
  assert.deepEqual(keys(["PRODUCTION_LEAD"]), ["PRODUCTION_LEAD"]);
  assert.deepEqual(keys(["PRODUCTION_WORKER"]), ["PRODUCTION_WORKER", "CORNER"]);
  assert.deepEqual(keys(["QC_LEAD"]), ["QC_LEAD"]); assert.deepEqual(keys(["WAREHOUSE"]), ["WAREHOUSE"]); assert.deepEqual(keys(["PRODUCTION_DOCUMENTER"]), ["PRODUCTION_DOCUMENTER"]);
  assert.deepEqual(keys(["ADMIN"]), ["PRODUCTION_LEAD", "PRODUCTION_WORKER", "CORNER", "QC_LEAD", "WAREHOUSE", "PRODUCTION_DOCUMENTER"]);
  assert.deepEqual(keys(["SALES"]), []);
  const text = (k) => TRAINING_CHECKLISTS[k].items.join(" ").toLowerCase();
  for (const w of ["jadwal", "prioritas", "meja", "target"]) assert.ok(text("PRODUCTION_LEAD").includes(w), `Lead: ${w}`);
  for (const w of ["antrean", "diagnosis", "bahan", "bukti"]) assert.ok(text("PRODUCTION_WORKER").includes(w), `Operator: ${w}`);
  assert.ok(text("CORNER").includes("tahap 9–12"));
  for (const w of ["pass", "fail", "rework"]) assert.ok(text("QC_LEAD").includes(w), `QC: ${w}`);
  for (const w of ["unit tiba", "bahan", "retur", "barang jadi"]) assert.ok(text("WAREHOUSE").includes(w), `Gudang: ${w}`);
  for (const w of ["kategori foto", "draf offline"]) assert.ok(text("PRODUCTION_DOCUMENTER").includes(w), `Dokumenter: ${w}`);
  const ctl = strip(src("features", "production", "demo", "DemoControls.jsx"));
  const panel = ctl.slice(ctl.indexOf("function TrainingChecklist"), ctl.indexOf("function DemoBar"));
  assert.doesNotMatch(panel, /<button|<input|onClick|onChange|type="checkbox"|href=|<Link/);
  assert.match(panel, /<ol /);
});

test("bar Mode Latihan menampilkan halaman & checklist sesuai peran, serta pesan penolakan server", () => {
  const ctl = strip(src("features", "production", "demo", "DemoControls.jsx"));
  assert.match(ctl, /const pages = pagesForRoles\(roles\)/); assert.match(ctl, /pages\.map\(\(\{ label, to \}\)/);
  assert.match(ctl, /<TrainingChecklist roles=\{roles\} \/>/); assert.match(ctl, /akses Mode Latihan ditolak server/);
});
