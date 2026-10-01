// P9 UX Realignment — kontrak struktur layar Production: satu Ringkasan, Status = pipeline (bukan planner), Rencana = planner
// harian per meja (backlog + Meja 1–4, drag-drop + fallback tombol), navigasi lima menu, kartu unit yang SAMA di Status/
// Rencana/QC, QC memakai Unit 360. Pola text-scan proyek ini (tanpa jsdom); fungsi murni dieksekusi dari sumbernya.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summaryFromV1, summaryFromV2 } from "../src/features/production/ringkasanModel.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Komentar dibuang: tes memeriksa KODE, bukan catatan yang (wajar) menyebut komponen lama.
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const LAYOUT = read("components", "Layout.jsx");
const RINGKASAN = read("pages", "bengkel", "ProductionRingkasan.jsx");
const STATUS = read("pages", "bengkel", "ProductionPlannerV2.jsx");
const RENCANA = read("pages", "bengkel", "ProductionRencanaWorkspace.jsx");
const QC = read("pages", "bengkel", "ProductionQc.jsx");
const QC_HUB = read("pages", "bengkel", "ProductionQcHub.jsx");
const CARD = read("features", "production", "UnitCard.jsx");
const MODEL_SRC = read("features", "production", "unitCardModel.js");

// unitCardModel mengimpor lewat alias "@/" — muat dari sumber dengan stub untuk impor itu.
function loadModel() {
  const src = MODEL_SRC.replace(/^import .*$/gm, "").replace(/^export /gm, "");
  const STEP_BY_NO = { 5: { label: "Diagnosa" }, 1: { label: "Sebelum Bongkar" } };
  const bucketStyle = (k) => ({ label: k || "Antrean" });
  return new Function("STEP_BY_NO", "bucketStyle", `${src}\nreturn { priorityMeta, dataGaps, materialBadge, stageText, backlogOf, mergeQcWithViews, pipelineChips, mejaLabel, MEJA, humanizeRequest };`)(STEP_BY_NO, bucketStyle);
}

test("Navigasi Production: OPERASIONAL hanya 5 menu; Aplikasi Meja/Corner/Andon di 'MODE KERJA & PERANGKAT'; Legacy admin-only & tertutup", () => {
  const prod = LAYOUT.slice(LAYOUT.indexOf("bengkel: {"), LAYOUT.indexOf("// Workspace ke-5"));
  const operasional = prod.slice(prod.indexOf('section: "OPERASIONAL"'), prod.indexOf('section: "MODE KERJA & PERANGKAT"'));
  const labels = [...operasional.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Ringkasan", "Status Produksi", "Rencana Produksi", "Quality Control", "Laporan Produksi"]);
  const mode = prod.slice(prod.indexOf('section: "MODE KERJA & PERANGKAT"'), prod.indexOf('section: "PENGATURAN & ADMINISTRASI"'));
  for (const l of ["Aplikasi Meja", "Aplikasi Corner", "Andon TV"]) assert.ok(mode.includes(`"${l}"`), l);
  assert.match(prod, /section: "LEGACY \(ADMIN\)",\s*adminOnly: true,[\s\S]*?collapsibleDefaultClosed: true/);
});

test("Ringkasan: SATU dashboard — tidak lagi menumpuk CommandCenterSummary + hero 'Pusat Kendali Produksi' V1", () => {
  assert.doesNotMatch(RINGKASAN, /CommandCenterSummary|WorkspaceHero|Pusat Kendali Produksi/);
  assert.match(RINGKASAN, /data-testid="kpi-row"/);
  assert.match(RINGKASAN, /data-testid="attention-card"/);
  assert.match(RINGKASAN, /data-testid="pic-card"/);
  assert.equal((RINGKASAN.match(/Butuh Perhatian/g) || []).length, 1, "hanya satu daftar perhatian");
});

test("Ringkasan adaptor V2: 7 KPI (target, selesai, aktif, antre, terlambat, bahan, QC) dari angka server apa adanya", () => {
  const cc = {
    kpi: { target: 12, selesaiHariIni: 3, sedangDikerjakan: 4, terlambat: 1, menungguBahan: 2, menungguQc: 5 },
    columns: [{ key: "TIBA_BELUM_MULAI", label: "Tiba / Belum Mulai", count: 6, items: [{ runId: "r1", unit: { id: "u1" } }] }],
    attention: [{ severity: "critical", code: "X", text: "t", unitCode: "U", runId: "r1", orderNumber: "O1" }, { severity: "warning", code: "Y", text: "t2", unitCode: "V", runId: "zzz" }],
    picActivity: [{ name: "Sari", stationLabel: "Meja 2", active: 2, completedToday: 1 }],
  };
  const s = summaryFromV2(cc);
  assert.deepEqual(s.tiles.map((t) => t.key), ["target", "done", "active", "queue", "late", "material", "qc"]);
  assert.equal(s.tiles.find((t) => t.key === "done").value, 3);
  assert.equal(s.tiles.find((t) => t.key === "done").of, 12);
  assert.equal(s.tiles.find((t) => t.key === "queue").value, 6);
  assert.equal(s.tiles.find((t) => t.key === "late").tone, "red");
  assert.equal(s.attention[0].to, "/bengkel/production-v2?unit=u1");
  assert.equal(s.attention[1].to, null, "run tak dikenal -> tanpa tautan (bukan tautan palsu)");
  assert.equal(s.pic.length, 1);
});

test("Ringkasan adaptor V1 (Production V2 OFF): bentuk & urutan KPI SAMA dengan V2", () => {
  const s = summaryFromV1({ summary: { targetToday: 8, completedToday: 2, inProgress: 3, blocked: 1, overdue: 0, unitsWithDueDate: 0 }, flow: { queued: 5, waitingQc: 1 }, exceptions: [{ type: "BLOCKED", unitCode: "U1", reason: "macet", href: "/x" }] });
  assert.deepEqual(s.tiles.map((t) => t.key), ["target", "done", "active", "queue", "late", "material", "qc"]);
  assert.equal(s.tiles.find((t) => t.key === "late").value, "—", "tanpa target tanggal -> strip, bukan nol palsu");
  assert.equal(s.attention[0].severity, "critical");
});

test("Status Produksi: pipeline murni — tanpa navigator tanggal, KPI ganda, Kalender, Andon, atau drop-target; crash 'Daftar' hilang", () => {
  assert.doesNotMatch(STATUS, /Kalender|WeekStrip|Besok \(H-1\)|Hari sebelumnya|Andon TV|onDrop|draggable|belumDijadwalkanItems/);
  assert.match(STATUS, /data-testid="pipeline"/);
  assert.match(STATUS, /data-testid="mobile-column"/);
  assert.match(STATUS, /UnitCard/);
  assert.match(STATUS, /Unit Tiba di Workshop/);
});

test("Rencana Produksi: planner harian — backlog 'Belum Dijadwalkan', Meja 1–4 berkapasitas, drag-drop + fallback Jadwalkan/Pindahkan", () => {
  assert.match(RENCANA, /data-testid="backlog-panel"/);
  assert.match(RENCANA, /data-testid="meja-column"/);
  assert.match(RENCANA, /data-testid="meja-slot"/);
  assert.match(RENCANA, /onDrop=/);
  assert.match(RENCANA, /draggable/);
  assert.match(RENCANA, /Jadwalkan<\/Button>/);
  assert.match(RENCANA, /Pindahkan<\/Button>/);
  assert.match(RENCANA, /scheduleProductionV2Plan/);
  assert.match(RENCANA, /seq=\{idx \+ 1\}/);
  assert.match(RENCANA, /cfg\?\.dailyTarget/);
  assert.match(RENCANA, /Kelola Rencana/, "BOM/reservasi P3 tetap dijangkau lewat Unit 360");
});

test("Kartu unit SAMA dipakai Status, Rencana, dan QC; klik membuka Unit 360", () => {
  for (const [name, src] of [["status", STATUS], ["rencana", RENCANA], ["qc", QC]]) assert.match(src, /UnitCard/, name);
  assert.match(QC, /UnitOverviewDrawer/);
  assert.match(QC, /manageLabel="Putusan QC"/);
  assert.match(CARD, /Buka Unit 360/);
});

test("QC hub: tab 'Inspeksi QC (lama)' hanya ADMIN (legacy) — staf lain satu pengalaman", () => {
  assert.match(QC_HUB, /isAdmin &&/);
});

test("Kartu foto-pertama: foto besar di atas, placeholder eksplisit 'Belum ada foto', prioritas merah TIDAK hanya warna (ikon+teks)", () => {
  assert.match(CARD, /Belum ada foto/);
  assert.match(CARD, /data-testid="photo-empty"/);
  assert.match(CARD, /Flame|ChevronsUp/);
  assert.match(CARD, /data-testid="priority-tag"/);
  assert.match(CARD, /Layanan Sales: /);
  assert.match(CARD, /data-testid="sales-note"/);
});

test("unitCardModel: prioritas Tinggi/Mendesak merah + ikon; Normal tanpa ikon", () => {
  const { priorityMeta } = loadModel();
  assert.deepEqual([priorityMeta(2).tone, priorityMeta(2).icon, priorityMeta(2).label], ["red", "urgent", "Mendesak"]);
  assert.deepEqual([priorityMeta(1).tone, priorityMeta(1).icon, priorityMeta(1).label], ["red", "high", "Tinggi"]);
  assert.equal(priorityMeta(0).icon, null);
});

test("unitCardModel: indikator kekurangan data hanya yang terbukti kosong", () => {
  const { dataGaps } = loadModel();
  const full = { unit: { photoUrl: "u" }, customer: { weightKg: 70, salesServices: ["Paket"] }, plan: { operator: { name: "A" } } };
  assert.deepEqual(dataGaps(full), []);
  assert.deepEqual(dataGaps({ unit: {}, customer: { weightKg: null, salesServices: [] }, plan: { operator: null } }),
    ["Foto unit belum ada", "Berat badan belum diisi Sales", "Layanan Sales belum tercatat", "PIC meja belum ditetapkan"]);
  assert.ok(!dataGaps({ unit: { photoUrl: "u" }, customer: { weightKg: 1, salesServices: ["x"] }, plan: null }).includes("PIC meja belum ditetapkan"), "tanpa rencana bukan kekurangan PIC");
});

test("unitCardModel: backlog = run aktif tanpa meja, urut prioritas; pickup 'Akan Masuk' & tanpa runId tidak ikut", () => {
  const { backlogOf } = loadModel();
  const cols = [
    { items: [{ kind: "UPCOMING_PICKUP", unit: { id: "x" } }, { runId: "a", plan: { stationCode: "TABLE_1", priority: 2 } }, { runId: "b", plan: { priority: 1 } }] },
    { items: [{ runId: "c", plan: null }, { handoffId: "legacy", unit: { id: "y" } }, { runId: "d", plan: { priority: 2 } }] },
  ];
  assert.deepEqual(backlogOf(cols).map((v) => v.runId), ["d", "b", "c"]);
});

test("unitCardModel: badge bahan — BOM belum ada bukan kekurangan (null); kekurangan nyata merah", () => {
  const { materialBadge } = loadModel();
  assert.equal(materialBadge({ materialStatus: { key: "BOM_BELUM_ADA" } }), null);
  assert.equal(materialBadge({ materialStatus: { key: "SUDAH_DISERAHKAN" } }).tone, "green");
  assert.equal(materialBadge({ shortage: { items: [] }, materialStatus: { key: "SUDAH_DISERAHKAN" } }).tone, "red");
});

test("unitCardModel: kartu QC dipetakan ke view Command Center lewat runId (fallback null bila tak ada)", () => {
  const { mergeQcWithViews } = loadModel();
  const out = mergeQcWithViews([{ runId: "a" }, { runId: "zz" }], [{ items: [{ runId: "a", unit: { id: "u" } }] }]);
  assert.equal(out[0].view.unit.id, "u");
  assert.equal(out[1].view, null);
});

// Kontrak layanan: Layanan Dipesan (Sales) read-only vs Layanan Teknis (hasil Diagnosis) — tampil TERPISAH di kartu, Unit 360, wizard.
test("Kontrak layanan: kartu menampilkan 'Layanan Sales' DAN 'Layanan Teknis' sebagai dua baris terpisah", () => {
  assert.match(CARD, /Layanan Sales: /);
  assert.match(CARD, /data-testid="tech-service"/);
  assert.match(CARD, /Layanan Teknis: /);
});
test("Kontrak layanan: Unit 360 — 'Layanan Teknis (Produksi)' terpisah dari 'Layanan Dipesan (Sales)' (badge ORDER = read-only)", () => {
  const D = read("features", "production", "UnitOverviewDrawer.jsx");
  assert.match(D, /label="Layanan Teknis \(Produksi\)"/);
  assert.match(D, /label="Layanan Dipesan \(Sales\)" field=\{d\.salesContext\.salesServices\}/);
});
test("Kontrak layanan: wizard menampilkan Layanan Dipesan (Sales) hanya-baca & menegaskan layanan teknis tidak mengubah order", () => {
  const W = read("features", "production", "DiagnosisWizard.jsx");
  assert.match(W, /data-testid="sales-ordered-service"/);
  assert.match(W, /tidak mengubah order, item, atau harga/);
});
test("humanizeRequest: JSON intake Sales jadi kalimat terbaca; teks biasa & JSON tak dikenal tidak diubah", () => {
  const { humanizeRequest } = loadModel();
  assert.equal(humanizeRequest('{"merkKasur":"Lainnya","ukuranKasur":"120x200 cm","keluhanCustomer":"Di buat menopang bb 95","jenisKasurLainnya":""}'), "Merk: Lainnya · Ukuran: 120x200 cm · Keluhan: Di buat menopang bb 95");
  assert.equal(humanizeRequest("Req sampai lomasi jam 10:00 pagi"), "Req sampai lomasi jam 10:00 pagi");
  assert.equal(humanizeRequest("{bukan json}"), "{bukan json}");
  assert.equal(humanizeRequest(null), null);
});

// Regresi (ditemukan uji drag-drop nyata): kartu di dalam kolom Meja tidak bisa diseret karena prop dragStart tidak diteruskan.
test("Rencana: MejaColumn menerima & dipasangi dragStart (kartu di meja bisa diseret antar-meja / balik ke backlog)", () => {
  assert.match(RENCANA, /<MejaColumn [\s\S]*?dragStart=\{dragStart\}/);
  assert.ok(RENCANA.includes("onDragStart={(e) => dragStart(e, v.runId)}"));
});
