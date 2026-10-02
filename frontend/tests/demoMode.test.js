// P12A — Mode Demo: gerbang (hanya-baca, tanpa jaringan), dataset (kunci, tanggal, media), cakupan 12 unit, dan pagar kode (admin-only, tidak tersimpan).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_LABEL, DemoMissError, DemoReadOnlyError, activateDemo, deactivateDemo, demoBlock, demoGate, installDemoNetworkGuard, isDemoActive, subscribeDemo, demoVersion,
} from "../src/features/production/demo/demoGate.js";
import { buildResolver, daysBetween, demoPhotoUrl, normalizeKey, rewriteMedia, shiftDeep, wibDay } from "../src/features/production/demo/demoDataset.js";
import { stripDemoParam } from "../src/lib/openTabs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");
const snapshot = JSON.parse(read("src/features/production/demo/demoSnapshot.json"));
const get = (u) => snapshot.entries.find((e) => e.url === u)?.data;

test("label & gerbang: nonaktif = lewat; aktif = bacaan data Production dari dataset, selain itu normal; non-GET ditolak SEBELUM jaringan", async () => {
  assert.equal(DEMO_LABEL, "MODE DEMO — bukan data operasional");
  assert.equal(demoGate("/production-v2/board", "GET"), null); assert.equal(demoBlock("Unggah"), null); assert.equal(isDemoActive(), false);
  let v = demoVersion(); const seen = []; const un = subscribeDemo(() => seen.push(demoVersion()));
  activateDemo((p) => ({ dari: "demo", p })); assert.equal(isDemoActive(), true); assert.ok(demoVersion() > v);
  assert.deepEqual(await demoGate("/production-v2/command-center", "GET"), { dari: "demo", p: "/production-v2/command-center" });
  for (const p of ["/production/operators", "/inventory/stock", "/master-data/service-catalog", "/production-planning/qc/queue?tab=AWAITING_QC", "/complaints?currentOwner=QC"]) assert.ok(demoGate(p, "GET") instanceof Promise, p);
  assert.equal(demoGate("/auth/me", "GET"), null, "auth/notifikasi tidak berisi data produksi"); assert.equal(demoGate("/conversations/latest-unread?since=x", "GET"), null);
  for (const m of ["POST", "PATCH", "PUT", "DELETE", "post"]) await assert.rejects(demoGate("/production-v2/plans", m), (e) => e instanceof DemoReadOnlyError && e.code === "DEMO_READ_ONLY" && /dinonaktifkan di Mode Demo/.test(e.message));
  await assert.rejects(demoGate("/auth/login", "POST"), DemoReadOnlyError, "bahkan jalur non-produksi ditolak bila bukan GET");
  await assert.rejects(demoBlock("Export"), DemoReadOnlyError);
  deactivateDemo(); assert.equal(isDemoActive(), false); assert.equal(demoGate("/production-v2/board", "GET"), null); un(); assert.ok(seen.length >= 2);
});

test("lapis jaringan: fetch/XHR non-GET ke /api dan export ditolak selama demo; GET biasa & jalur non-API lewat; tidak aktif = tidak berpengaruh", async () => {
  const calls = []; const xhr = []; class XHR { open(m, u) { xhr.push([m, u]); } }
  const win = { fetch: async (i, init) => { calls.push([init?.method || "GET", String(i)]); return "ok"; }, XMLHttpRequest: XHR };
  assert.equal(installDemoNetworkGuard(win), true); assert.equal(installDemoNetworkGuard(win), false, "sekali pasang");
  assert.equal(await win.fetch("/api/production-v2/plans", { method: "POST" }), "ok", "demo mati: lewat");
  activateDemo(() => ({}));
  await assert.rejects(win.fetch("/api/production-v2/plans", { method: "POST" }), DemoReadOnlyError);
  await assert.rejects(win.fetch("/api/production-v2/units/1/photo", { method: "DELETE" }), DemoReadOnlyError);
  await assert.rejects(win.fetch("/api/production-v2/reports/export?report=summary&format=xlsx"), DemoReadOnlyError);
  assert.equal(await win.fetch("/api/auth/me"), "ok"); assert.equal(await win.fetch("/demo/photo-01.png"), "ok"); assert.equal(await win.fetch("/api/production-v2/board", { method: "GET" }), "ok");
  assert.throws(() => new win.XMLHttpRequest().open("POST", "/api/production-v2/documentation/upload"), DemoReadOnlyError);
  assert.doesNotThrow(() => new win.XMLHttpRequest().open("GET", "/api/production-v2/board"));
  assert.deepEqual(calls.filter(([m]) => m !== "GET" && m !== undefined).length, 1, "satu-satunya non-GET yang lolos adalah sebelum demo aktif");
  deactivateDemo();
});

test("normalisasi kunci: /api dibuang, urut param, from/to/since dibuang, date → selisih hari, q kosong dibuang", () => {
  const T = "2026-10-02";
  assert.equal(normalizeKey("/api/production-v2/board?date=2026-10-02", T), "/production-v2/board?date=@+0");
  assert.equal(normalizeKey("/production-v2/board?date=2026-09-29", T), "/production-v2/board?date=@-3");
  assert.equal(normalizeKey("/production-v2/board?date=2026-10-05", T), "/production-v2/board?date=@+3");
  assert.equal(normalizeKey("/production-v2/reports/summary?from=2026-09-03&to=2026-10-02&granularity=day", T), "/production-v2/reports/summary?granularity=day");
  assert.equal(normalizeKey("/production-v2/reports/summary?granularity=day&to=1&from=2", T), "/production-v2/reports/summary?granularity=day");
  assert.equal(normalizeKey("/production-v2/documentation/queue?filter=ALL&q=", T), "/production-v2/documentation/queue?filter=ALL");
  assert.equal(normalizeKey("/production-planning/qc/queue?tab=REWORK", T), "/production-planning/qc/queue?tab=REWORK");
  assert.equal(normalizeKey("/conversations/latest-unread?since=2026-10-02T01:00:00Z", T), "/conversations/latest-unread");
  assert.equal(daysBetween("2026-10-02", "2026-10-05"), 3); assert.equal(wibDay("2026-10-01T17:30:00Z"), "2026-10-02");
});

test("pergeseran tanggal: ISO datetime & tanggal ikut digeser ke 'hari ini'; string lain utuh; media → fixture lokal deterministik tanpa URL asal", () => {
  assert.deepEqual(shiftDeep({ a: "2026-10-02T08:00:00.000Z", b: "2026-10-02", c: ["2026-10-03T00:00:00Z", "QA-PV2-U01", 5, null], d: { e: "2026-10-02T08:00:00Z" } }, 3), { a: "2026-10-05T08:00:00.000Z", b: "2026-10-05", c: ["2026-10-06T00:00:00.000Z", "QA-PV2-U01", 5, null], d: { e: "2026-10-05T08:00:00.000Z" } });
  const same = { x: "2026-10-02" }; assert.equal(shiftDeep(same, 0), same);
  const r = rewriteMedia({ photoUrl: "/media/unit-photo/abc?exp=1&sig=2", list: ["/media/job-photos/QA-PV2-pod-01.png", "/media/production-evidence/" + "a".repeat(40) + ".jpg", "bukan-media"], n: 1 });
  assert.match(r.photoUrl, /^\/demo\/photo-(0[1-9]|1[0-2])\.png$/); assert.ok(r.list.slice(0, 2).every((u) => /^\/demo\/photo-\d\d\.png$/.test(u))); assert.equal(r.list[2], "bukan-media");
  assert.equal(demoPhotoUrl("/media/unit-photo/abc?exp=1&sig=2"), demoPhotoUrl("/media/unit-photo/abc?exp=9&sig=9"), "tanda tangan berbeda → foto sama");
  assert.doesNotMatch(JSON.stringify(rewriteMedia(snapshot)), /\/media\//, "tidak ada URL /media/ (foto customer/staging) yang lolos");
});

test("resolver: tanggal digeser ke hari ini, board di luar rentang → hari terdekat, salinan terisolasi, miss → DemoMissError, filter tak dikenal → versi dasar", () => {
  const snap = { today: "2026-10-02", entries: [
    { url: "/production-v2/board?date=2026-10-02", data: { date: "2026-10-02", at: "2026-10-02T08:00:00.000Z", stations: [1] } },
    { url: "/production-v2/board?date=2026-10-03", data: { date: "2026-10-03", stations: [2] } },
    { url: "/production-v2/documentation/queue?filter=ALL", data: { items: [1, 2, 3] } },
    { url: "/production/operators", data: [{ media: "/media/job-photos/x.png" }] },
  ] };
  const now = new Date("2026-10-10T03:00:00Z"); // 10 Okt 10:00 WIB → Δ = 8 hari
  const resolve = buildResolver(snap, { now });
  assert.deepEqual(resolve("/api/production-v2/board?date=2026-10-10"), { date: "2026-10-10", at: "2026-10-10T08:00:00.000Z", stations: [1] });
  assert.equal(resolve("/production-v2/board?date=2026-10-11").stations[0], 2);
  assert.equal(resolve("/production-v2/board?date=2026-12-31").stations[0], 2, "jauh di luar rentang → hari terdekat");
  const a = resolve("/production-v2/documentation/queue?filter=ALL"); a.items.push(99); assert.equal(resolve("/production-v2/documentation/queue?filter=ALL").items.length, 3);
  assert.equal(resolve("/production-v2/documentation/queue?filter=ALL&q=").items.length, 3);
  assert.match(resolve("/production/operators")[0].media, /^\/demo\/photo-\d\d\.png$/);
  assert.throws(() => resolve("/production-v2/tidak-ada"), (e) => e instanceof DemoMissError && e.code === "DEMO_MISS");
});

test("snapshot QA-PV2: 12 unit bernomor U01–U12, seluruh keadaan matriks hadir (meja 1–4, 3 prioritas, perjalanan/tiba, diagnosis, bahan, kerja, QC, rework, Corner, retur, siap kirim, dokumentasi)", () => {
  assert.deepEqual(snapshot.unitCodes, Array.from({ length: 12 }, (_, i) => `QA-PV2-U${String(i + 1).padStart(2, "0")}`));
  const cc = get("/production-v2/command-center"); const items = cc.columns.flatMap((c) => c.items);
  assert.equal(items.length + (cc.completedToday?.length || 0), 12, "11 di kolom pipeline + 1 selesai hari ini"); assert.equal(cc.readerMode, "COHORT");
  const buckets = Object.fromEntries(cc.columns.map((c) => [c.key, c.count]));
  for (const k of ["AKAN_MASUK", "DALAM_PERJALANAN", "TIBA_BELUM_MULAI", "BONGKAR", "UJI_FONDASI", "FONDASI", "LAPISAN", "UJI_TEKSTUR", "CORNER", "SIAP_KIRIM"]) assert.ok(buckets[k] >= 1, k);
  const board = get(`/production-v2/board?date=${snapshot.today}`);
  assert.equal(board.unscheduled.plans.length + board.unscheduled.units.length, 3, "3 belum dijadwalkan (2 punya rencana tanpa tanggal/meja + 1 belum direncanakan)");
  for (const st of ["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"]) assert.ok((board.stations.find((s) => s.code === st)?.items || []).length >= 1, `${st} terisi`);
  const prios = new Set([...board.unscheduled.plans, ...board.unscheduled.units, ...board.stations.flatMap((s) => s.items)].map((i) => i.plan?.priority ?? 0)); assert.deepEqual([...prios].sort(), [0, 1, 2]);
  const text = (x) => JSON.stringify(x);
  assert.ok(items.some((i) => i.shortage), "menunggu bahan"); assert.ok(items.some((i) => i.bucket === "QC" || i.qc), "menunggu QC");
  assert.ok(get("/production-planning/qc/queue?tab=REWORK").items?.length >= 1 || get("/production-planning/qc/queue?tab=REWORK").length >= 1 || text(get("/production-planning/qc/queue?tab=REWORK")).includes("QA-PV2-U08"), "QC gagal → rework");
  const wq = get("/production-v2/warehouse/queue"); assert.ok(wq.returns.length >= 1, "menunggu retur"); assert.ok(wq.shortages.length >= 1); assert.ok(wq.finishedGoods.length >= 0);
  const dq = get("/production-v2/documentation/queue?filter=ALL"); assert.equal(dq.items.length, 11, "11 unit punya Run (U12 = Akan Masuk, pickup terjadwal, belum punya Run)");
  assert.ok(dq.counts.LENGKAP >= 1 && dq.counts.BEFORE_KURANG + dq.counts.PROSES_KURANG + dq.counts.AFTER_KURANG >= 1, "dokumentasi lengkap & kurang");
  assert.ok(items.some((i) => i.unit.service === null || i.unit.service?.label == null), "diagnosis belum lengkap (layanan teknis belum ditetapkan)");
  assert.ok(items.some((i) => i.plan?.cornerOperatorName || i.plan?.cornerOperator), "PIC Corner terisi");
});

test("isi kartu: customer dummy, nomor order/resi, foto, layanan Sales, layanan teknis, request Sales, PIC, meja, prioritas, target, progres, status bahan/QC/retur/dokumentasi", () => {
  const cc = get("/production-v2/command-center"); const all = cc.columns.flatMap((c) => c.items);
  const upcoming = all.filter((i) => i.kind === "UPCOMING_PICKUP");
  assert.equal(upcoming.length, 1, "Akan Masuk — Pickup Terjadwal terisi 1 unit (forecast, belum punya Run)");
  assert.ok(upcoming[0].customer.salesServices.length && upcoming[0].scheduledDate && !upcoming[0].runId && !upcoming[0].progress, "forecast: tanpa Run/progres");
  const items = all.filter((i) => i.kind !== "UPCOMING_PICKUP");
  for (const i of items) {
    assert.match(i.customer.name, /^QA-PV2 /); assert.match(i.customer.orderNumber, /^QA-PV2-RES-\d{4}$/); assert.match(i.unit.unitCode, /^QA-PV2-U\d{2}$/);
    assert.ok(Array.isArray(i.customer.salesServices) && i.customer.salesServices.length, `layanan Sales ${i.unit.unitCode}`);
    assert.ok(i.progress.total === 12 && Number.isInteger(i.progress.done)); assert.ok(i.bucketLabel && i.materialStatus !== undefined);
  }
  assert.ok(items.filter((i) => i.customer.request).length >= 8, "request Sales terisi");
  assert.ok(items.filter((i) => i.unit.photoUrl).length >= 10, "foto (pickup/manual)");
  assert.ok(items.some((i) => i.plan?.stationCode) && items.some((i) => i.plan?.operator || i.plan?.operatorName), "PIC & meja");
  const raw = JSON.stringify(snapshot);
  assert.doesNotMatch(raw, /\b62\d{9,13}\b|@(?!staging\.invalid)[a-z0-9.-]+\.[a-z]{2,}/i, "tanpa nomor telepon/email nyata");
  assert.equal((raw.match(/QA-PV2/g) || []).length > 100, true);
});

test("pagar kode: pembungkus 7 halaman + KPI gudang; api.js memanggil gerbang; admin-only; tidak ada penyimpanan lokal; dataset hanya lewat import() dinamis", () => {
  const reg = read("src/routes/pageRegistry.jsx");
  for (const [route, comp] of [["/produksi/dokumentasi", "ProductionDocumentation"], ["/bengkel/kpi", "ProductionKpi"], ["/bengkel/production-v2", "ProductionPlannerV2"], ["/bengkel/rencana-produksi", "ProductionRencanaWorkspace"], ["/bengkel/ringkasan", "ProductionRingkasan"], ["/bengkel/quality-control", "ProductionQcHub"], ["/warehouse/antrean-produksi", "WarehouseProductionQueue"]]) {
    assert.match(reg, new RegExp(`path: "${route}", render: \\(\\) => <DemoPage><${comp}`), route);
  }
  const api = read("src/api.js");
  assert.match(api, /import \{ demoGate, demoBlock \} from "\.\/features\/production\/demo\/demoGate\.js"/);
  assert.match(api, /async function request\(path, options = \{\}\) \{[\s\S]{0,260}demoGate\(path, options\.method \|\| "GET"\)/);
  assert.match(api, /function uploadWithProgress[\s\S]{0,120}demoBlock/); assert.match(api, /async function requestFormData[\s\S]{0,120}demoBlock/); assert.match(api, /exportProductionReport: async \(qs\) => \{\s*const demo = demoBlock/);
  assert.doesNotMatch(api, /demoSnapshot|demoLoader/, "dataset tidak diimpor statis oleh api.js");
  const ctl = read("src/features/production/demo/DemoControls.jsx");
  assert.match(ctl, /canUseDemo = \(roles = \[\]\) => roles\.some\(\(r\) => r === "ADMIN" \|\| r === "OWNER"\)/);
  assert.match(ctl, /await api\.getDemoAccess\(\)[\s\S]{0,200}import\("\.\/demoLoader\.js"\)/, "izin server dulu, dataset sesudahnya");
  const code = ctl.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /localStorage\.setItem|sessionStorage|document\.cookie/, "demo tidak disimpan");
  assert.match(ctl, /data-testid="demo-badge"/); assert.match(ctl, /DEMO_LABEL/);
  for (const f of ["src/features/production/demo/demoGate.js", "src/features/production/demo/demoDataset.js", "src/features/production/demo/DemoControls.jsx", "src/features/production/demo/demoLoader.js"]) assert.doesNotMatch(read(f), /method:\s*"(POST|PUT|PATCH|DELETE)"|\.post\(|\.patch\(/, `${f} baca-saja`);
  assert.match(read("src/features/production/demo/demoLoader.js"), /import snapshot from "\.\/demoSnapshot\.json"/);
  assert.match(read("src/features/production/UnitCard.jsx"), /draggable=\{draggable && !isDemoActive\(\)\}/);
  assert.doesNotMatch(reg, /demoSnapshot/);
});

test("tombol mutasi di semua halaman Production ditandai data-mutates (dinonaktifkan DemoPage); tab tersimpan tidak membawa ?demo=1", () => {
  const must = [
    ["src/pages/bengkel/ProductionPlannerV2.jsx", 4], ["src/features/production/ScheduleModals.jsx", 3], ["src/pages/bengkel/ProductionQc.jsx", 10], ["src/pages/bengkel/ProductionRencanaWorkspace.jsx", 10],
    ["src/pages/warehouse/WarehouseProductionQueue.jsx", 5], ["src/pages/produksi/ProductionDocumentation.jsx", 3], ["src/features/production/DocumentationDraftUi.jsx", 4], ["src/features/production/UnitOverviewDrawer.jsx", 3],
    ["src/features/production/DiagnosisWizard.jsx", 1], ["src/features/production/UnitPhotoThumb.jsx", 1], ["src/features/production/TargetPanel.jsx", 1], ["src/features/production/ReportParts.jsx", 2],
  ];
  for (const [f, min] of must) assert.ok((read(f).match(/data-mutates/g) || []).length >= min, `${f} ≥ ${min} tombol bertanda`);
  assert.equal(stripDemoParam("/bengkel/kpi?tab=gudang&demo=1"), "/bengkel/kpi?tab=gudang"); assert.equal(stripDemoParam("/bengkel/kpi?demo=1"), "/bengkel/kpi");
  assert.equal(stripDemoParam("/bengkel/kpi?tab=meja"), "/bengkel/kpi?tab=meja"); assert.equal(stripDemoParam("/x?demo=1&y=2"), "/x?y=2");
  const tabs = read("src/lib/openTabs.js"); assert.match(tabs, /JSON\.stringify\(\{ tabs: cleanTabs\(tabs\), activeId \}\)/); assert.match(tabs, /tabs: cleanTabs\(parsed\.tabs\)/);
});

test("audit rilis: snapshot publik 100% sintetis (tanpa /media/, tanda tangan, JWT, telepon, email non-staging.invalid, host eksternal); ekspor menolak sisa; rumus foto = frontend", async () => {
  const raw = read("src/features/production/demo/demoSnapshot.json");
  assert.equal((raw.match(/\/media\//g) || []).length, 0); assert.equal((raw.match(/[?&](sig|exp)=/g) || []).length, 0); assert.equal((raw.match(/eyJ[A-Za-z0-9_-]{20,}/g) || []).length, 0);
  assert.equal((raw.match(/\b(?:\+?62|0)8\d{8,12}\b/g) || []).length, 0, "tanpa nomor telepon");
  assert.deepEqual([...new Set(raw.match(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g) || [])].filter((e) => !e.endsWith("@staging.invalid")), [], "tanpa email nyata");
  assert.deepEqual([...new Set(raw.match(/https?:\/\/[^"\s\\]+/g) || [])], [], "tanpa host eksternal");
  assert.equal(/passw|secret|api_?key/i.test(raw), false);
  const names = new Set(); (function w(x) { if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (/^(customerName|name|actorName|operatorName)$/.test(k) && typeof v === "string") names.add(v); w(v); } })(snapshot);
  for (const n of names) assert.match(n, /^QA-PV2 /, `nama non-sintetis: ${n}`);
  for (const e of snapshot.entries) assert.doesNotMatch(JSON.stringify(e.data).replace(/"(orderNumber|unitCode)":"QA-PV2[^"]*"/g, ""), /"(orderNumber|unitCode)":"/);
  const exp = read("../backend/scripts/staging/export-demo-snapshot.js"); assert.match(exp, /process\.exit\(3\)/); assert.ok(exp.includes("[?&](sig|exp)=") && exp.includes("process.exit(3)"), "ekspor gagal bila tersisa /media/ atau tanda tangan");
  const sample = "/media/unit-photo/abc?exp=1&sig=2"; const h = (str) => { let x = 2166136261; for (let i = 0; i < str.length; i += 1) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
  assert.equal(`/demo/photo-${String((h(sample.split("?")[0]) % 12) + 1).padStart(2, "0")}.png`, demoPhotoUrl(sample), "rumus ekspor = rumus frontend");
});

test("UI demo: catatan 11 vs 12 unit, tooltip Bahasa Indonesia untuk tombol/seret-lepas dinonaktifkan, tombol Excel/PDF & unggah bertanda data-mutates", () => {
  const ctl = read("src/features/production/demo/DemoControls.jsx");
  assert.match(ctl, /Pipeline Status Produksi hanya menampilkan 11 unit karena 1 unit \(QA-PV2-U11\) sudah selesai/); assert.match(ctl, /data-testid="demo-unit-note"/);
  assert.match(ctl, /DEMO_DISABLED_TIP = "Dinonaktifkan di Mode Demo/); assert.match(ctl, /el\.title = DEMO_DISABLED_TIP/);
  assert.match(read("src/features/production/UnitCard.jsx"), /Seret-lepas dinonaktifkan di Mode Demo/);
  assert.match(read("src/features/production/ReportParts.jsx"), /data-mutates disabled=\{disabled \|\| !!busy\} onClick=\{\(\) => go\("xlsx"\)\}/);
  assert.match(read("src/features/production/UnitPhotoThumb.jsx"), /data-mutates onClick=\{\(\) => inputRef\.current\?\.click\(\)\}/);
});
