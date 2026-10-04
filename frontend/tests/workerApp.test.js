// P12C — Aplikasi Meja/Corner mode aplikasi: model murni (kartu V2/V1, urutan, aksi V1, offline, mode multi-role) + kontrak komponen (bottom nav maks. 4,
// tanpa sidebar desktop, foto-pertama, tombol hanya lewat jalur server). Logika murni dieksekusi langsung; komponen diperiksa dari sumber (tanpa jsdom).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Model mengimpor lewat alias "@/" (Vite). Untuk menguji modul ASLI (bukan salinan/stub) daftarkan hook resolusi alias -> src/ sebelum import dinamis.
const SRC_URL = pathToFileURL(path.join(here, "..", "src") + path.sep).href;
register("data:text/javascript," + encodeURIComponent(`export async function resolve(spec, ctx, next) { return spec.startsWith("@/") ? next(new URL(spec.slice(2), ${JSON.stringify(SRC_URL)}).href, ctx) : next(spec, ctx); }`));
const {
  APP_MODES, NAV_TABS, allowedModes, initialsOf, jobFromV1, jobFromV2, materialRows, modeOfLane, myV1Units, orderJobs, picSummary, primaryActionV1,
  priorityOfV1, safeText, splitJobs, submitState, tabOf, v1Progress,
} = await import("../src/features/production/workerApp/workerAppModel.js");
const WA = path.join(here, "..", "src", "features", "production", "workerApp");
const read = (n) => fs.readFileSync(path.join(WA, n), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const v2Item = (over = {}) => ({
  runId: "run-1", revision: 4, status: "ACTIVE", bucket: "DIAGNOSA", next: { actor: "TABLE", stepNo: 5, action: "COMPLETE" }, activeOp: { stageLabel: "Diagnosa", status: "ACTIVE" },
  unit: { id: "u1", unitCode: "UNIT-1", merk: "King Koil", ukuran: "180x200", photoUrl: "/media/unit-photo/u1?sig=x" },
  customer: { name: "Ibu Maya", orderNumber: "RES-1", salesServices: ["Servis Spring & Busa"], request: "Minta tekstur firm", salesName: "Kiki", complaints: [], weightKg: 80 },
  plan: { priority: 1, stationLabel: "Meja 2", stationSequence: 1 }, progress: { done: 4, total: 12 }, timer: { late: false, elapsedMinutes: 30 }, materialStatus: { key: "SIAP_DIAMBIL" }, shortage: null,
  ...over,
});
const wo = (over = {}) => ({ id: "v1u", unitCode: "V1-1", status: "IN_PRODUCTION", inProductionV2: false, merk: "Serta", ukuran: "160x200", priority: "HIGH", executionState: "NOT_STARTED", createdAt: "2026-10-01T00:00:00Z", order: { orderNumber: "RES-9", customer: { name: "Pak Budi" } }, assignedOperator: { id: "op1", name: "Meja 1" }, workCenter: { name: "Workshop" }, ...over });
const tl = (statuses, over = {}) => ({
  salesServices: ["Servis Spring & Busa"], salesContext: { request: "Cepat ya", salesName: "Fadlan", photoUrl: null },
  needsService: false, unit: { currentStageId: "s1", order: {} },
  path: statuses.map((st, i) => ({ stage: { id: `s${i + 1}`, labelId: `Tahap ${i + 1}`, requiresPhoto: i === 1, requiresQc: false }, status: st, isCurrent: st !== "DONE" && statuses.slice(0, i).every((x) => x === "DONE") })),
  ...over,
});

test("bottom navigation: tepat 4 tab bernama Kerja, Bahan, Aktivitas, Akun; tab tak dikenal -> Kerja", () => {
  assert.deepEqual(NAV_TABS.map((t) => t.label), ["Kerja", "Bahan", "Aktivitas", "Akun"]);
  assert.ok(NAV_TABS.length <= 4);
  assert.equal(tabOf("akun"), "akun"); assert.equal(tabOf("../etc"), "kerja"); assert.equal(tabOf(null), "kerja");
});

test("mode aplikasi: multi-role hanya melihat mode yang diizinkan; peran tanpa izin lantai tidak melihat apa pun", () => {
  assert.deepEqual(allowedModes(["PRODUCTION_WORKER"]).map((m) => m.key), ["meja", "corner"]);
  assert.deepEqual(allowedModes(["PRODUCTION_DOCUMENTER"]).map((m) => m.key), ["dokumentasi"]);
  assert.deepEqual(allowedModes(["PRODUCTION_WORKER", "PRODUCTION_DOCUMENTER"]).map((m) => m.key), ["meja", "corner", "dokumentasi"]);
  assert.deepEqual(allowedModes(["ADMIN"]).map((m) => m.key), APP_MODES.map((m) => m.key));
  for (const r of [["SALES"], ["FINANCE"], ["DRIVER"], ["WAREHOUSE"], ["QC_LEAD"], []]) assert.deepEqual(allowedModes(r), [], r.join());
  assert.equal(modeOfLane("CORNER").to, "/produksi/corner"); assert.equal(modeOfLane("TABLE").to, "/produksi/meja");
});

test("kartu V2: semua nilai dari server (foto, Sales, kasur, catatan + nama Sales, prioritas, tahap, progres)", () => {
  const j = jobFromV2(v2Item());
  assert.equal(j.source, "V2"); assert.equal(j.key, "v2:run-1");
  assert.equal(j.photoUrl, "/media/unit-photo/u1?sig=x"); assert.equal(j.customerName, "Ibu Maya"); assert.equal(j.orderNumber, "RES-1");
  assert.deepEqual(j.salesServices, ["Servis Spring & Busa"]); assert.match(j.kasur, /King Koil/); assert.match(j.kasur, /180x200/);
  assert.equal(j.note, "Minta tekstur firm"); assert.equal(j.salesName, "Kiki");
  assert.equal(j.priority.value, 1); assert.equal(j.priority.label, "Tinggi");
  assert.equal(j.stage.label, "Langkah 5 · Diagnosa");
  assert.deepEqual(j.progress, { done: 4, total: 12, source: "server-v2" });
  assert.equal(j.gantiKain, false); assert.equal(j.active, true);
});

test("Ganti Kain dikenali dari layanan Sales; catatan kosong -> penanda 'catatan belum tersedia'; foto kosong tetap valid", () => {
  const a = jobFromV2(v2Item({ customer: { name: "X", salesServices: ["Ganti Kain Premium"], request: null }, unit: { id: "u", unitCode: "U", photoUrl: null } }));
  assert.equal(a.gantiKain, true); assert.equal(a.gantiKainNoteMissing, true); assert.equal(a.photoUrl, null);
  const b = jobFromV2(v2Item({ customer: { name: "X", salesServices: ["Ganti Kain"], request: "Kain biru motif bunga" } }));
  assert.equal(b.gantiKain, true); assert.equal(b.gantiKainNoteMissing, false);
  assert.equal(jobFromV2(v2Item({ customer: { name: "X", salesServices: ["Servis Spring"] } })).gantiKain, false, "bukan tebakan dari kata lain");
});

test("menunggu bahan: bucket MENUNGGU_BAHAN atau laporan kekurangan -> materialWaiting; baris Bahan diurutkan kekurangan > menunggu > status > kosong > V1", () => {
  const a = jobFromV2(v2Item({ runId: "a", bucket: "MENUNGGU_BAHAN" }));
  const b = jobFromV2(v2Item({ runId: "b", shortage: { items: [{ materialId: "m", name: "Busa", qty: 2 }] } }));
  const c = jobFromV2(v2Item({ runId: "c" }));
  const d = jobFromV2(v2Item({ runId: "d", materialStatus: { key: "BOM_BELUM_ADA" } }));
  const e = jobFromV1(wo(), null);
  assert.equal(a.materialWaiting, true); assert.equal(b.materialWaiting, true); assert.equal(c.materialWaiting, false);
  assert.deepEqual(materialRows([e, d, c, a, b]).map((r) => r.kind), ["SHORTAGE", "WAITING", "STATUS", "NONE", "V1"]);
});

test("V1: kartu dari work-orders + timeline; progres dari jalur server; TIDAK dipetakan ke 12 langkah V2", () => {
  const t = tl(["DONE", "DONE", "IN_PROGRESS", "NOT_STARTED"]);
  const j = jobFromV1(wo({ executionState: "IN_PROGRESS" }), t);
  assert.equal(j.source, "V1"); assert.equal(j.key, "v1:v1u");
  assert.deepEqual(j.progress, { done: 2, total: 4, source: "server-v1" }, "dihitung dari path V1 server, bukan 12");
  assert.equal(j.priority.value, 1); assert.equal(j.priority.label, "Tinggi");
  assert.equal(j.note, "Cepat ya"); assert.equal(j.salesName, "Fadlan"); assert.deepEqual(j.salesServices, ["Servis Spring & Busa"]);
  assert.match(j.stage.label, /^Tahap · /, "label tahap V1 apa adanya dari server");
  assert.doesNotMatch(j.stage.label, /Langkah \d+/, "bukan label langkah V2");
  assert.equal(j.active, true);
  const bare = jobFromV1(wo(), null);
  assert.equal(bare.progress, null, "belum ada timeline -> progres kosong, bukan angka palsu"); assert.equal(v1Progress(null), null);
  assert.equal(priorityOfV1("CRITICAL").label, "Kritis"); assert.equal(priorityOfV1(undefined).value, 0);
});

test("unit V1 milik saya: hanya yang ditugaskan ke operator yang sama, status kerja, di luar cohort V2", () => {
  const units = [wo(), wo({ id: "x2", assignedOperator: { id: "op2" } }), wo({ id: "x3", inProductionV2: true }), wo({ id: "x4", status: "DELIVERED" }), wo({ id: "x5", assignedOperator: null })];
  assert.deepEqual(myV1Units(units, "op1").map((u) => u.id), ["v1u"]);
  assert.deepEqual(myV1Units(units, null), []); assert.deepEqual(myV1Units(null, "op1"), []);
});

test("urutan: yang sedang dikerjakan dulu; V2 mengikuti urutan SERVER (manual menang); V1 sesudah V2 menurut prioritas lalu umur; satu antrean, bukan dua", () => {
  const q1 = jobFromV2(v2Item({ runId: "q1", bucket: "ANTREAN", activeOp: null, next: { actor: "TABLE", stepNo: 1, action: "START_WITH_EVIDENCE" } }));
  const q2 = jobFromV2(v2Item({ runId: "q2", bucket: "ANTREAN", activeOp: null, plan: { priority: 2, stationLabel: "Meja 2" } }));
  const act = jobFromV2(v2Item({ runId: "act" }));
  const lo = jobFromV1(wo({ id: "lo", priority: "NORMAL", createdAt: "2026-10-01" }), null);
  const hi = jobFromV1(wo({ id: "hi", priority: "URGENT", createdAt: "2026-10-03" }), null);
  const old = jobFromV1(wo({ id: "old", priority: "NORMAL", createdAt: "2026-09-01" }), null);
  const ordered = orderJobs([lo, q1, hi, q2, act, old]).map((j) => j.id);
  assert.deepEqual(ordered, ["act", "q1", "q2", "hi", "old", "lo"], "q2 (prioritas 2) TIDAK melompati q1: urutan V2 dari server tidak diubah");
  const { active, queue } = splitJobs([lo, q1, act]);
  assert.equal(active.id, "act"); assert.equal(queue.length, 2); assert.ok(!queue.includes(active));
});

test("aksi utama V1: satu aksi sesuai keadaan tahap server + izin; QC & blokir TIDAK ada di aplikasi", () => {
  const W = ["PRODUCTION_WORKER"];
  assert.equal(primaryActionV1(tl(["NOT_STARTED", "NOT_STARTED"], { unit: { currentStageId: null } }), W).kind, "START");
  assert.equal(primaryActionV1(tl(["READY", "NOT_STARTED"]), W).kind, "START");
  const run = primaryActionV1(tl(["DONE", "IN_PROGRESS"]), W);
  assert.equal(run.kind, "COMPLETE"); assert.equal(run.needsPhoto, true, "tahap ke-2 wajib foto -> dari server"); assert.deepEqual(run.secondary, ["PAUSE", "BLOCK"]);
  assert.equal(primaryActionV1(tl(["PAUSED"]), W).kind, "RESUME");
  const blocked = primaryActionV1(tl(["BLOCKED"]), W); assert.equal(blocked.kind, "NONE"); assert.match(blocked.reason, /Production Lead/);
  const qc = tl(["IN_PROGRESS"]); qc.path[0].stage.requiresQc = true;
  const q = primaryActionV1(qc, W); assert.equal(q.kind, "NONE"); assert.match(q.reason, /QC/);
  assert.equal(primaryActionV1(tl(["DONE"]), W).kind, "NONE");
  assert.equal(primaryActionV1(tl([], { needsService: true, path: [] }), W).kind, "NONE");
  assert.equal(primaryActionV1(tl(["READY"]), ["SALES"]).kind, "NONE", "peran tanpa izin tahap: tidak ada tombol");
  assert.equal(primaryActionV1(tl(["READY"]), ["SALES"]).reason.length > 0, true);
});

test("offline: kirim dinonaktifkan dengan penjelasan jujur (belum ada yang terkirim); online normal; sibuk menonaktifkan", () => {
  const off = submitState({ online: false, busy: false });
  assert.equal(off.disabled, true); assert.match(off.reason, /Offline/); assert.match(off.reason, /belum ada yang terkirim/i);
  assert.deepEqual(submitState({ online: true, busy: false }), { disabled: false, reason: null });
  assert.equal(submitState({ online: true, busy: true }).disabled, true);
});

test("teks panjang & aman: inisial foto kosong, safeText memotong dan menyembunyikan UUID; nama sangat panjang tidak merusak model", () => {
  assert.equal(initialsOf("Ibu Maya Sari"), "IM"); assert.equal(initialsOf(""), "?");
  assert.equal(safeText("Gagal 6da4999c-390d-4f3c-856d-2c5efc9c03d8 ok"), "Gagal … ok");
  assert.ok(safeText("x".repeat(400)).length <= 140);
  const long = "Ibu Maria Magdalena Kusuma Wardhani Prasetyo Hadiningrat dari Perumahan Taman Sari Indah Blok Z No. 99 ".repeat(3);
  const j = jobFromV2(v2Item({ customer: { name: long, salesServices: ["Servis Spring & Busa + Ganti Kain + Fondasi Baru + Lapisan Latex Premium + Cover"], request: long } }));
  assert.equal(j.customerName, long.trim(), "nama panjang utuh (hanya dirapikan), dipotong oleh CSS clamp bukan model"); assert.equal(j.gantiKain, true);
  assert.equal(picSummary([j], { lane: "TABLE", user: { name: "Operator" } }).stations.length, 1);
});

test("komponen: bottom nav maks. 4 & tanpa sidebar; kartu foto-pertama memuat semua informasi yang diminta; selektor stabil", () => {
  const shell = strip(read("WorkerAppShell.jsx"));
  assert.match(shell, /NAV_TABS\.map/); assert.match(shell, /data-testid="worker-nav"/); assert.match(shell, /data-testid=\{`nav-\$\{t\.key\}`\}/);
  assert.doesNotMatch(shell, /Sidebar|sidebar|Layout\.jsx|TabsProvider/, "mode aplikasi: tanpa sidebar desktop");
  const card = strip(read("JobCard.jsx"));
  for (const id of ["job-photo", "job-customer", "job-ids", "layanan-sales", "job-kasur", "sales-note", "sales-name", "ganti-kain-note", "priority-chip", "source-badge", "stage-chip", "job-progress", "material-waiting", "worker-unit-card"]) assert.ok(card.includes(`data-testid="${id}"`), id);
  assert.match(card, /Foto belum ada/); assert.match(card, /onError=\{\(\) => setBroken\(true\)\}/, "foto gagal dimuat -> placeholder, bukan ikon rusak");
  assert.match(card, /Ganti Kain — pastikan sesuai permintaan customer/); assert.match(card, /Progres belum tersedia dari server/);
  assert.doesNotMatch(card, /orderValue|formatRupiah|harga/i, "tanpa harga");
  const css = read("worker-app.css");
  assert.match(css, /\.wa-nav-inner \{ display: grid; grid-template-columns: repeat\(4, 1fr\)/);
  assert.match(css, /@media \(min-width: 768px\)/); assert.match(css, /@media \(min-width: 1280px\)/);
  assert.match(css, /\[data-theme="dark"\] \.wa-photo-empty/, "mode gelap setara untuk placeholder foto");
});

test("komponen: setiap aksi tulis lewat command server yang ada; tidak ada status berhasil lokal; offline menonaktifkan kirim", () => {
  const detail = strip(read("JobDetail.jsx"));
  assert.match(detail, /api\.recordProductionV2Step\(card\.runId, next\.stepNo/); assert.match(detail, /intentKeys\.keyFor\(card\.runId, next\.stepNo, card\.revision\)/, "Idempotency-Key per niat");
  assert.match(detail, /expectedRevision: card\.revision/, "konflik revisi tetap kontrak server");
  assert.match(detail, /const mineNow = !!next && next\.action !== "WAIT"/, "tombol hanya bila `next` server mengizinkan");
  assert.match(detail, /setNotice\("Tersimpan\."\); await afterChange\(\)/, "pesan sukses SETELAH server menerima");
  const sheets = strip(read("workerSheets.jsx"));
  assert.match(sheets, /submitState\(\{ online, busy \}\)/); assert.match(sheets, /disabled=\{gate\.disabled\}/); assert.match(sheets, /data-testid="offline-submit-note"/);
  assert.match(sheets, /validateStepForm\(stepNo, form, \{ mediaItems: media \}\)/, "foto wajib divalidasi sebelum kirim");
  const v1 = strip(read("V1Panels.jsx"));
  for (const call of ["api.startUnitStage", "api.resumeUnitStage", "api.completeUnitStage", "api.pauseUnitStage", "api.failUnitStage", "api.addUnitMaterial"]) assert.ok(v1.includes(call), call);
  assert.doesNotMatch(v1, /skipUnitStage|changeUnitRoute|recordQcFitTest|resolveBlocker|assignUnitStage/, "aksi berisiko/QC/penugasan TIDAK ada di aplikasi lantai");
  assert.match(v1, /completeFormValid\(\{ needsPhoto: action\.needsPhoto, photos \}\)/, "foto wajib V1 dari server");
});

test("WorkerLane: URL ?t=&job= untuk tautan dalam; Akun memakai user/onLogout dari konteks; V1 hanya di Meja (bukan Corner)", () => {
  const lane = strip(fs.readFileSync(path.join(here, "..", "src", "pages", "produksi", "WorkerLane.jsx"), "utf8"));
  assert.match(lane, /params\.get\("t"\)/); assert.match(lane, /params\.get\("job"\)/); assert.match(lane, /onLogout/);
  assert.match(strip(read("useWorkerJobs.js")), /if \(lane === "CORNER" \|\| !operatorId\)/, "V1 tidak ditampilkan di Corner (tidak ada konsep Table/Corner di tahap V1)");
  assert.match(strip(fs.readFileSync(path.join(here, "..", "src", "App.jsx"), "utf8")), /onLogout: handleLogout/);
});
