// P9 UX Realignment — kontrak struktur layar Production: satu Ringkasan, Status = pipeline (bukan planner), Rencana = planner
// harian per meja (backlog + Meja 1–4, drag-drop + fallback tombol), navigasi lima menu, kartu unit yang SAMA di Status/
// Rencana/QC, QC memakai Unit 360. Pola text-scan proyek ini (tanpa jsdom); fungsi murni dieksekusi dari sumbernya.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summaryFromV1, summaryFromV2 } from "../src/features/production/ringkasanModel.js";
import { PRODUCTION_NAV } from "../src/lib/productionNav.js";
import { rankOfView } from "../src/features/production/productionLabels.js";

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
  const PRODUCT_TYPE_LABELS = { KASUR_SPRING: "Kasur Spring", KASUR_BUSA: "Kasur Busa", KASUR_LAINNYA: "Lainnya" };
  return new Function("STEP_BY_NO", "bucketStyle", "PRODUCT_TYPE_LABELS", "rankOfView", `${src}\nreturn { priorityMeta, dataGaps, materialBadge, stageText, backlogOf, mergeQcWithViews, pipelineChips, mejaLabel, MEJA, humanizeRequest, isGantiKain, mattressInfo, salesNoteOf };`)(STEP_BY_NO, bucketStyle, PRODUCT_TYPE_LABELS, rankOfView);
}

test("Navigasi Production (P12B.2): OPERASIONAL 6 menu; MODE KERJA akordeon default tertutup; KONTROL & LAPORAN 3 menu; ADMINISTRASI = Pengaturan; tanpa Legacy", () => {
  const sec = Object.fromEntries(PRODUCTION_NAV.map((x) => [x.section, x]));
  assert.deepEqual(PRODUCTION_NAV.map((x) => x.section), ["OPERASIONAL", "MODE KERJA", "KONTROL & LAPORAN", "ADMINISTRASI"]);
  assert.deepEqual(sec["OPERASIONAL"].items.map((i) => i.label), ["Ringkasan", "Order Produksi", "Status Produksi", "Rencana Produksi", "Bahan Produksi"]); // Slice 1: QC disembunyikan sementara
  assert.deepEqual(sec["MODE KERJA"].items.map((i) => i.label), ["Aplikasi Meja", "Aplikasi Corner", "Aplikasi Dokumentasi", "Andon TV"]);
  assert.ok(sec["MODE KERJA"].collapsible && sec["MODE KERJA"].defaultClosed, "akordeon, default tertutup");
  assert.deepEqual(sec["KONTROL & LAPORAN"].items.map((i) => i.label), ["KPI & Laporan", "Biaya Produksi", "Komplain & Revisi"]);
  assert.deepEqual(sec["ADMINISTRASI"].items.map((i) => i.label), ["Pengaturan"]);
  assert.match(LAYOUT, /PRODUCTION_NAV\.map/, "Layout membangun menu dari lib/productionNav.js");
  assert.doesNotMatch(LAYOUT, /LEGACY \(ADMIN\)|Inspeksi QC \(lama\)/, "tanpa section Legacy");
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
  assert.match(RENCANA, /data-drop="backlog"/);
  assert.match(RENCANA, /data-drop="meja"/);
  assert.match(RENCANA, /<DragHandle /);
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

test("QC hub (P12B.2): tab 'Inspeksi QC (lama)' DIHAPUS dari UI — satu pengalaman QC untuk semua peran", () => {
  assert.doesNotMatch(QC_HUB, /Inspeksi QC|ProductionQcQueue|isAdmin/);
  assert.match(QC_HUB, /<ProductionQc \/>/);
});

test("Kartu foto-pertama: foto besar di atas, placeholder eksplisit 'Belum ada foto', prioritas merah TIDAK hanya warna (ikon+teks)", () => {
  assert.match(CARD, /Belum ada foto/);
  assert.match(CARD, /data-testid="photo-empty"/);
  assert.match(CARD, /Flame|ChevronsUp/);
  assert.match(CARD, /data-testid="priority-tag"/);
  assert.match(CARD, /Layanan Sales: /);
  assert.match(CARD, /data-testid="sales-note"/);
});

test("unitCardModel: prioritas Komplain merah + ikon; Tinggi (termasuk Mendesak lama) oranye + ikon; Normal tanpa ikon", () => {
  const { priorityMeta } = loadModel();
  assert.deepEqual([priorityMeta(3).tone, priorityMeta(3).icon, priorityMeta(3).label], ["red", "urgent", "Komplain"]);
  assert.deepEqual([priorityMeta(2).tone, priorityMeta(2).icon, priorityMeta(2).label], ["orange", "high", "Tinggi"], "Mendesak lama tampil Tinggi");
  assert.deepEqual([priorityMeta(1).tone, priorityMeta(1).icon, priorityMeta(1).label], ["orange", "high", "Tinggi"]);
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
test("Kontrak layanan (Slice 1): kartu hanya menampilkan 'Layanan Sales'", () => {
  assert.match(CARD, /Layanan Sales: /);
  assert.doesNotMatch(CARD, /data-testid="tech-service"|Layanan Teknis/, "Slice 1: layanan teknis tidak tampil di kartu");
});
test("Kontrak layanan (Slice 1): Unit 360 hanya menampilkan 'Layanan Sales' (badge ORDER = read-only); layanan teknis tidak tampil", () => {
  const D = read("features", "production", "UnitOverviewDrawer.jsx");
  assert.doesNotMatch(D, /Layanan Teknis|Layanan teknis/);
  assert.match(D, /label="Layanan Sales" field=\{d\.salesContext\.salesServices\}/);
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
test("Rencana: MejaColumn menerima onHandleDown & drag; kartu meja dan backlog punya handle seret (antar-meja / balik ke backlog)", () => {
  assert.match(RENCANA, /<MejaColumn [\s\S]*?onHandleDown=\{onHandleDown\}/);
  assert.ok(RENCANA.includes("handle={<DragHandle unitCode={v.unit.unitCode} disabled={busy} onPointerDown={(e) => onHandleDown(e, v)} />}"));
  assert.equal((RENCANA.match(/<DragHandle /g) || []).length, 2, "backlog + meja");
});

// ---- Temuan sandbox QA (fix/production-v2-sandbox-findings) ----
test("Sandbox#1 Revisi Diagnosis tidak lagi kosong: wizard di-seed dari diagnosis server (temuan, layanan, BOM, manual belum terpetakan, foto)", () => {
  const W = read("features", "production", "DiagnosisWizard.jsx");
  assert.match(W, /export function serverSeed\(cur\)/);
  assert.match(W, /const seed = local \|\| \(server \? serverSeed\(server\) : null\)/);
  assert.match(W, /filter\(\(m\) => m\.status === "NEEDS_MAPPING"\)/, "hanya bahan manual belum terpetakan yang dibawa");
  assert.match(read("features", "production", "workerApp", "workerSheets.jsx"), /current: diagState\.current/); // P12C: lembar diagnosis diekstrak dari WorkerLane
  assert.match(read("features", "production", "UnitOverviewDrawer.jsx"), /current: data\.diagnosis\?\.current \?\? null/);
});
test("Sandbox#3 PIC/Gudang tidak memicu 403 daftar workshop/operator di Status & Rencana", () => {
  assert.match(STATUS, /if \(!canRoute\) return;/);
  assert.match(RENCANA, /if \(!canUploadPhoto\) \{/);
});
test("Sandbox#5/#6 Rencana: reservasi tampil kode·nama (bukan UUID) dan ada tombol 'Ajukan Pengambilan Bahan' di UI baru", () => {
  assert.match(RENCANA, /matLabel\(r\.materialId\)/);
  assert.doesNotMatch(RENCANA, /<span>\{r\.materialId\}<\/span>/);
  assert.match(RENCANA, /api\.requestMaterialPickup\(plan\.id\)/);
  assert.match(RENCANA, /Ajukan Pengambilan Bahan/);
});
test("Sandbox#8 Unit 360 Bahan: kolom Rencana · Diserahkan · Terpakai · Sisa · Waste (bukan 'Terpakai' = reservasi dikonsumsi)", () => {
  const D = read("features", "production", "UnitOverviewDrawer.jsx");
  assert.match(D, /\["Bahan", "Rencana", "Diserahkan", "Terpakai", "Sisa", "Waste", "Status"\]/);
  for (const col of ["diserahkan", "terpakai", "sisa", "waste"]) assert.ok(D.includes(`data-col="${col}"`), col);
  assert.match(D, /l\.usedQty \?\? 0/); assert.match(D, /l\.leftoverQty \?\? 0/); assert.match(D, /l\.wasteQty \?\? 0/);
});
test("Sandbox#9 QC: pemilih bahan rework memakai pencarian produksi (bukan /inventory/materials yang 403 untuk QC)", () => {
  assert.doesNotMatch(QC, /api\.getMaterials/);
  assert.match(QC, /function MaterialPicker/);
  assert.match(QC, /api\.searchProductionV2Materials\(t\)/);
  assert.match(QC, /<MaterialPicker value=\{row\.materialId\}/);
});

test("Sandbox#10 Gudang: retur & waste bisa ditautkan ke unit (unitId) supaya Sisa/Waste muncul di Unit 360", () => {
  const G = read("pages", "Gudang.jsx");
  assert.ok(G.includes("api.returnStock({ materialId: material.materialId, qty: qtyNum, unitId,"));
  assert.ok(G.includes("api.wasteStock({ materialId: material.materialId, qty: qtyNum, reason: reason.trim(), unitId,"));
  assert.ok(G.includes("r?.unit?.id ?? r?.id"), "by-code mengembalikan { unit: { id } } — baca unit.id bertingkat");
  assert.ok(G.includes('type === "issue" || type === "return" || type === "waste"'));
});

// Revisi kartu Rencana Produksi (2 Okt 2026): layanan cukup dari Sales (tanpa Layanan Teknis), + jenis/merk/ukuran kasur,
// + catatan Sales, + Ganti Kain berwarna beda (krusial: harus sesuai keinginan customer).
const PLAN = read("features", "production", "PlanCard.jsx");
test("Rencana Produksi: PlanCard dan UnitCard tanpa Layanan Teknis & tanpa harga (Slice 1)", () => {
  assert.ok(!/showTechService|Layanan Teknis|tech-service/.test(CARD), "UnitCard: tanpa Layanan Teknis");
  assert.ok(!/Layanan Teknis|tech-service|formatRupiah|orderValue/.test(PLAN), "PlanCard: tanpa Layanan Teknis dan tanpa harga");
  assert.ok(!/Layanan Teknis|formatRupiah|orderValue/.test(RENCANA));
  assert.equal((RENCANA.match(/<PlanCard /g) || []).length, 3, "backlog + meja + ghost seret");
  assert.ok(!/<UnitCard /.test(RENCANA), "Rencana tidak lagi memakai UnitCard");
});
test("Kartu unit: baris Kasur (jenis·merk·ukuran) & Catatan Sales ada di kartu Status/QC/Akan Masuk (UnitCard)", () => {
  assert.match(CARD, /data-testid="mattress-info"/);
  assert.equal((CARD.match(/<MattressLine view=/g) || []).length, 2);
  assert.equal((CARD.match(/<SalesNote view=/g) || []).length, 2);
});
test("PlanCard: tiga blok berbeda (Layanan Sales biru · Kasur netral · Catatan Sales kuning + 'Sales: nama'), teks kosong, operasional terpisah, dua kolom via container query", () => {
  for (const t of ['kind="sales" label="Layanan Sales"', 'kind="kasur" label="Kasur"', 'kind="note" label="Catatan Sales"']) assert.ok(PLAN.includes(t), t);
  for (const t of ["Layanan belum dicatat Sales", "Data kasur belum lengkap", "Catatan Sales belum tersedia", "Sales: {c.salesName}"]) assert.ok(PLAN.includes(t), t);
  for (const t of ["Tahap", "Bahan", "Target", "Meja", "PIC usulan", "tahap</span>"]) assert.ok(PLAN.includes(t), t);
  assert.match(PLAN, /testid="row-stage"/); assert.match(PLAN, /testid="row-material"/, "status bahan terpisah dari nama tahap");
  assert.match(PLAN, /@container/); assert.match(PLAN, /@\[34rem\]:grid-cols-2/);
  assert.match(PLAN, /formatTanggal\(plan\.productionDate\)/, "target format Indonesia");
  assert.match(PLAN, /Urutan \$\{seq\}/);
  assert.match(PLAN, /h-\[68px\]|variant="plan"/);
  const css = fs.readFileSync(path.join(__dirname, "..", "src", "index.css"), "utf8");
  for (const c of [".plan-block-sales", ".plan-block-kasur", ".plan-block-note", ".plan-prio-urgent", ".plan-prio-high", ".plan-prio-normal"]) assert.ok(css.includes(c), c);
});
test("Prioritas kanonis (Slice 1): KOMPLAIN merah tua + api + garis tebal; TINGGI oranye; NORMAL netral; overdue badge terpisah; tidak diinfer dari catatan", () => {
  const M = loadModel();
  const u = M.priorityMeta(3), h = M.priorityMeta(1), n = M.priorityMeta(0);
  assert.deepEqual([u.label, u.icon, u.badgeClass, u.stripeWidth], ["Komplain", "urgent", "plan-prio-urgent", 7]);
  assert.deepEqual([h.label, h.icon, h.badgeClass, h.stripeWidth], ["Tinggi", "high", "plan-prio-high", 5]);
  assert.deepEqual([n.label, n.icon, n.badgeClass], ["Normal", null, "plan-prio-normal"]);
  assert.ok(u.stripeWidth > h.stripeWidth && h.stripeWidth > n.stripeWidth, "garis kiri makin tebal makin mendesak");
  assert.match(PLAN, /view\.timer\?\.late && <Badge variant="red">Terlambat<\/Badge>/, "overdue = badge terpisah");
  assert.match(PLAN, /priorityMeta\(rankOfView\(view\)\)/, "peringkat dari server (Komplain resmi / plan.priority)");
  assert.ok(!/request|notes|catatan/i.test(PLAN.slice(PLAN.indexOf("const p = priorityMeta"), PLAN.indexOf("const p = priorityMeta") + 80)), "tidak diinfer dari teks");
});
test("Ganti Kain: kartu berwarna beda (oranye) + kotak peringatan yang selalu tampil; hanya dikenali dari layanan Sales", () => {
  // P12A.2: latar kartu NORMAL; penanda = garis kiri oranye + kotak peringatan oranye (bukan tint/ring seluruh kartu)
  assert.ok(!/GANTI_KAIN_STYLE|kpi-glass-guard|ring-2 ring-orange/.test(CARD) && !/GANTI_KAIN_STYLE|kpi-glass-guard|ring-2 ring-orange/.test(PLAN));
  for (const src of [CARD, PLAN]) {
    assert.match(src, /data-testid="ganti-kain-note"/); assert.match(src, /data-ganti-kain=/);
    assert.ok(src.includes("Ganti Kain — pastikan sesuai permintaan customer")); assert.ok(src.includes("Catatan kain belum tersedia — konfirmasi ke Sales"));
  }
  assert.match(CARD, /data-testid="ganti-kain-stripe"[\s\S]{0,120}bg-orange/); assert.match(PLAN, /data-testid="ganti-kain-stripe"/);
  const M = loadModel();
  assert.equal(M.isGantiKain({ customer: { salesServices: ["Ganti Kain"] } }), true);
  assert.equal(M.isGantiKain({ customer: { salesServices: ["Full Service (Service + Tambah Busa + Ganti Kain)"] } }), true);
  assert.equal(M.isGantiKain({ customer: { salesServices: ["Full Service"] } }), false);
  assert.equal(M.isGantiKain({ customer: { salesServices: [], request: "ganti kain polos" } }), false, "tidak menebak dari teks bebas");
  assert.equal(M.isGantiKain({ customer: {} }), false);
});
test("mattressInfo/salesNoteOf: jenis dari tipe produk, merk/ukuran dari unit lalu catatan order; catatan Sales tanpa merk/ukuran; kosong = null", () => {
  const M = loadModel();
  assert.deepEqual(M.mattressInfo({ unit: { merk: "Serta", ukuran: "160 × 200" }, customer: { productType: "KASUR_SPRING" } }), { jenis: "Kasur Spring", merk: "Serta", ukuran: "160 × 200" });
  assert.deepEqual(M.mattressInfo({ unit: {}, customer: { productType: "KASUR_LAINNYA", request: JSON.stringify({ merkKasur: "Zinus", ukuranKasur: "90x200 cm (Single)", jenisKasurLainnya: "Kasur lipat" }) } }), { jenis: "Lainnya (Kasur lipat)", merk: "Zinus", ukuran: "90x200 cm (Single)" });
  assert.deepEqual(M.mattressInfo({ unit: {}, customer: {} }), { jenis: null, merk: null, ukuran: null });
  assert.equal(M.salesNoteOf({ customer: { request: JSON.stringify({ merkKasur: "Zinus", ukuranKasur: "x", keluhanCustomer: "Kain polos abu-abu" }) } }), "Kain polos abu-abu", "merk/ukuran tidak diulang di catatan");
  assert.equal(M.salesNoteOf({ customer: { request: "Segera — pindah rumah" } }), "Segera — pindah rumah");
  assert.equal(M.salesNoteOf({ customer: { request: JSON.stringify({ merkKasur: "Zinus" }) } }), null);
  assert.equal(M.salesNoteOf({ customer: { request: "  " } }), null);
});
