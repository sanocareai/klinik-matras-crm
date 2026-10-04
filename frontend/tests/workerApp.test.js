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
  APP_MODES, NAV_TABS, allowedModes, initialsOf, isV1Actionable, jobFromV1, jobFromV2, materialRows, modeOfLane, orderJobs, picSummary, primaryActionV1,
  priorityOfV1, safeText, splitJobs, submitState, tabOf, v1Progress, v1WaitInfo,
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
// Item antrean V1 dari server (GET /production/v1-worker-queue). `over.unit` menimpa kolom unit; `over.state/stage/...` menimpa keadaan.
const stg = (id, label, extra = {}) => ({ id, code: id, labelId: label, phase: "INTAKE", requiresPhoto: false, requiresQc: false, lane: "TABLE", ...extra });
const wo = (over = {}) => ({
  unit: { id: "v1u", unitCode: "V1-1", status: "IN_PRODUCTION", merk: "Serta", ukuran: "160x200", priority: "HIGH", createdAt: "2026-10-01T00:00:00Z", order: { orderNumber: "RES-9", customer: { name: "Pak Budi" } }, ...(over.unit || {}) },
  state: "READY", lane: "TABLE", stage: stg("s1", "Uji Sebelum Bongkar"), prerequisite: null, waitingFor: null, ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "unit")),
});
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

test("V1: kartu dari antrean server + timeline; keadaan & label dari server; progres dari jalur server; TIDAK dipetakan ke 12 langkah V2", () => {
  const t = tl(["DONE", "DONE", "IN_PROGRESS", "NOT_STARTED"]);
  const j = jobFromV1(wo({ state: "IN_PROGRESS", stage: stg("s3", "Fondasi") }), t);
  assert.equal(j.source, "V1"); assert.equal(j.key, "v1:v1u");
  assert.deepEqual(j.progress, { done: 2, total: 4, source: "server-v1" }, "dihitung dari path V1 server, bukan 12");
  assert.equal(j.priority.value, 1); assert.equal(j.priority.label, "Tinggi");
  assert.equal(j.note, "Cepat ya"); assert.equal(j.salesName, "Fadlan"); assert.deepEqual(j.salesServices, ["Servis Spring & Busa"]);
  assert.equal(j.stage.label, "Sedang berjalan · Fondasi", "label tahap V1 apa adanya dari server");
  assert.doesNotMatch(j.stage.label, /Langkah \d+/, "bukan label langkah V2");
  assert.equal(j.active, true); assert.equal(j.v1.actionable, true);
  const bare = jobFromV1(wo(), null);
  assert.equal(bare.progress, null, "belum ada timeline -> progres kosong, bukan angka palsu"); assert.equal(v1Progress(null), null);
  assert.equal(priorityOfV1("CRITICAL").label, "Kritis"); assert.equal(priorityOfV1(undefined).value, 0);
});

test("V1: siap dikerjakan vs menunggu prasyarat vs menunggu penugasan — dibedakan dari server; hanya siap/berjalan/dijeda yang membuka aksi", () => {
  const ready = jobFromV1(wo({ state: "READY" }), null);
  assert.equal(ready.stage.bucketLabel, "Siap dikerjakan"); assert.equal(ready.v1.actionable, true); assert.equal(ready.v1.wait, null); assert.equal(ready.active, false);
  const pre = jobFromV1(wo({ state: "WAITING_PREREQUISITE", stage: stg("s3", "Uji Fondasi"), prerequisite: { stage: stg("s2", "Bongkar"), state: "READY", assignee: "PIC Lain", assigned: true } }), null);
  assert.equal(pre.stage.bucketLabel, "Menunggu tahap prasyarat"); assert.equal(pre.v1.actionable, false);
  assert.match(pre.v1.wait.text, /Bongkar — PIC Lain/); assert.match(pre.v1.wait.text, /giliran Anda/);
  const unassigned = jobFromV1(wo({ state: "WAITING_PREREQUISITE", prerequisite: { stage: stg("s2", "Bongkar"), state: "READY", assignee: null, assigned: false } }), null);
  assert.match(unassigned.v1.wait.text, /belum ditugaskan/);
  const wa = jobFromV1(wo({ state: "WAITING_ASSIGNMENT", stage: stg("s1", "Uji Sebelum Bongkar"), waitingFor: stg("s2", "Bongkar") }), null);
  assert.equal(wa.stage.bucketLabel, "Menunggu penugasan berikutnya"); assert.equal(wa.v1.actionable, false);
  assert.match(wa.v1.wait.text, /Bongkar belum ditugaskan/); assert.match(wa.v1.wait.text, /sampai Production Lead menugaskannya/);
  assert.equal(v1WaitInfo(wo({ state: "READY" })), null);
  for (const [st, ok] of [["READY", true], ["IN_PROGRESS", true], ["PAUSED", true], ["BLOCKED", false], ["WAITING_PREREQUISITE", false], ["WAITING_ASSIGNMENT", false], [undefined, false]]) assert.equal(isV1Actionable(st), ok, String(st));
});

test("urutan: yang sedang dikerjakan dulu; V2 mengikuti urutan SERVER (manual menang); V1 sesudah V2 mengikuti urutan SERVER (tanpa pengurutan ulang klien); satu antrean, bukan dua", () => {
  const q1 = jobFromV2(v2Item({ runId: "q1", bucket: "ANTREAN", activeOp: null, next: { actor: "TABLE", stepNo: 1, action: "START_WITH_EVIDENCE" } }));
  const q2 = jobFromV2(v2Item({ runId: "q2", bucket: "ANTREAN", activeOp: null, plan: { priority: 2, stationLabel: "Meja 2" } }));
  const act = jobFromV2(v2Item({ runId: "act" }));
  const mk = (id, state, priority) => jobFromV1(wo({ state, unit: { id, unitCode: id, priority } }), null);
  const lo = mk("lo", "READY", "NORMAL"), hi = mk("hi", "READY", "URGENT"), w = mk("w", "WAITING_ASSIGNMENT", "URGENT"), run = mk("run", "IN_PROGRESS", "NORMAL");
  // urutan masukan = urutan server (berjalan > siap > menunggu; prioritas): klien TIDAK menyusunnya ulang
  const ordered = orderJobs([lo, q1, hi, q2, act, w, run]).map((j) => j.id);
  assert.deepEqual(ordered, ["act", "run", "q1", "q2", "lo", "hi", "w"], "q2 tidak melompati q1; V1 menjaga urutan masukan; hanya yang sedang dikerjakan naik");
  const { active, queue } = splitJobs([lo, q1, act]);
  assert.equal(active.id, "act"); assert.equal(queue.length, 2); assert.ok(!queue.includes(active));
  const noDup = orderJobs([q1, q2, act, lo, hi, w, run]).map((j) => j.key);
  assert.equal(new Set(noDup).size, noDup.length, "tidak ada kartu ganda");
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
  // keadaan antrean dari server membatasi: menunggu prasyarat/penugasan TIDAK membuka aksi walau timeline tampak siap (tahap berikutnya milik orang lain)
  for (const st of ["WAITING_PREREQUISITE", "WAITING_ASSIGNMENT", "BLOCKED"]) assert.equal(primaryActionV1(tl(["READY"]), W, { state: st }).kind, "NONE", st);
  assert.equal(primaryActionV1(tl(["READY"]), W, { state: "READY" }).kind, "START");
  assert.equal(primaryActionV1(tl(["DONE", "IN_PROGRESS"]), W, { state: "IN_PROGRESS" }).kind, "COMPLETE");
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

test("WorkerLane: URL ?t=&job= untuk tautan dalam; Akun memakai user/onLogout dari konteks; V1 di kedua lini (Meja & Corner kanonik dari server)", () => {
  const lane = strip(fs.readFileSync(path.join(here, "..", "src", "pages", "produksi", "WorkerLane.jsx"), "utf8"));
  assert.match(lane, /params\.get\("t"\)/); assert.match(lane, /params\.get\("job"\)/); assert.match(lane, /onLogout/);
  const hook = strip(read("useWorkerJobs.js"));
  assert.match(hook, /api\.getV1WorkerQueue\(laneKey\)/, "V1 dari read-model server untuk KEDUA lini (Corner membaca penugasan tahap Corner kanonik)");
  // hook mengirim laneKey huruf kecil ("corner"/"table"); klien API wajib menormalkannya, kalau tidak Corner diam-diam membaca antrean Meja (ditemukan QA browser)
  assert.match(strip(read("../../../api.js")), /getV1WorkerQueue: \(lane\) => request\(`\/production\/v1-worker-queue\?lane=\$\{String\(lane \|\| ""\)\.toUpperCase\(\) === "CORNER" \? "CORNER" : "TABLE"\}`\)/, "lane 'corner' (huruf kecil) harus menjadi CORNER");
  assert.doesNotMatch(hook, /getWorkOrders|assignedOperator|myV1Units/, "tidak lagi menebak dari daftar work-order");
  assert.match(hook, /const reloadAll = useCallback\(async \(\) => \{ await Promise\.all\(\[loadQueue\(\{ withV1: false \}\), loadV1\(\)\]\)/, "setelah aksi: V2 dan V1 dimuat ulang");
  const v1p = strip(read("V1Panels.jsx"));
  assert.match(v1p, /beforeAction/); assert.match(v1p, /Aksi tidak dikirim|if \(g\?\.ok === false\)/, "penjaga tombol basi sebelum aksi V1");
  const det = strip(read("JobDetail.jsx"));
  assert.match(det, /const ok = !!it && isV1Actionable\(it\.state\) && it\.state === v1\.state && it\.stage\?\.id === v1\.stage\?\.id/, "validasi ulang ke server: masih milik PIC ini, tahap & keadaan sama");
  assert.match(det, /timeline && v1\.actionable && <V1ActionBar/); assert.match(det, /data-testid="v1-info-bar"/, "keadaan menunggu: batang info, bukan tombol");
  assert.match(strip(fs.readFileSync(path.join(here, "..", "src", "App.jsx"), "utf8")), /onLogout: handleLogout/);
});

test("serah-terima (P12C.2): kode penolakan server dikenali = kode guard backend; pesan 'Pekerjaan sudah dialihkan' disimpan di induk dan bertahan setelah antrean dimuat ulang", async () => {
  const { HANDOFF_CODES, HANDOFF_TITLE, handoffNotice, isHandoffError } = await import("../src/features/production/workerApp/workerAppModel.js");
  const { V1_ACTOR_CODES } = await import(pathToFileURL(path.join(here, "..", "..", "backend", "src", "lib", "domain", "v1StageActor.js")).href);
  // klien mengenali TEPAT kode guard server untuk "bukan milik Anda lagi" (bukan kode lain seperti UNRESOLVED/NOT_OPERATOR)
  assert.deepEqual([...HANDOFF_CODES].sort(), [V1_ACTOR_CODES.NOT_YOURS, V1_ACTOR_CODES.CHANGED, V1_ACTOR_CODES.NOT_ASSIGNED].sort());
  for (const code of HANDOFF_CODES) assert.equal(isHandoffError({ status: 403, code }), true);
  for (const e of [null, undefined, new Error("x"), { code: "UNIT_V2_OWNED" }, { code: V1_ACTOR_CODES.NOT_OPERATOR }, { code: V1_ACTOR_CODES.UNRESOLVED }]) assert.equal(isHandoffError(e), false);
  const n = handoffNotice({ unitCode: "U-7", orderNumber: "RES-9" });
  assert.equal(n.title, "Pekerjaan sudah dialihkan"); assert.equal(HANDOFF_TITLE, "Pekerjaan sudah dialihkan");
  assert.match(n.text, /U-7 · RES-9/); assert.match(n.text, /Aksi Anda tidak dikirim/);
  assert.match(handoffNotice({}).text, /^Unit ini:/);
  // kontrak komponen: state ada di WorkerLane (bukan di detail yang unmount), banner tetap tampil di semua tab/layar, hanya hilang karena 'Mengerti' atau unit kembali ke antrean
  const lane = strip(fs.readFileSync(path.join(here, "..", "src", "pages", "produksi", "WorkerLane.jsx"), "utf8"));
  assert.match(lane, /const \[handoff, setHandoff\] = useState\(null\)/);
  assert.match(lane, /data-testid="handoff-notice"/); assert.match(lane, /data-testid="handoff-dismiss"/);
  assert.match(lane, /onHandoff=\{onHandoff\}/);
  assert.match(lane, /jobs\.some\(\(j\) => j\.source === "V1" && j\.unitCode === handoff\.unitCode\)\) setHandoff\(null\)/, "kembali ke antrean -> pesan lama dibersihkan");
  const bar = strip(read("V1Panels.jsx"));
  assert.match(bar, /isHandoffError\(e\)\) onHandoff\?\.\(\)/, "penolakan SERVER (403/409 guard) memicu pesan, bukan hanya penjaga klien");
  assert.match(bar, /g\?\.ok === false\) \{[^\n]*onHandoff\?\.\(\)/, "penjaga klien juga memicu pesan yang sama");
  assert.match(strip(read("JobDetail.jsx")), /onHandoff=\{\(\) => onHandoff\?\.\(job\)\}/);
});
