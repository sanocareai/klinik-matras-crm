// Rencana Produksi untuk ORDER NYATA — kontrak layar: kartu backlog tanpa instruksi seret yang menyesatkan, aksi berikutnya yang jelas, Jadwalkan + seret memakai SATU pintu
// (unitId -> POST /production-v2/plans), PIC/workshop dari endpoint server dengan alasan + tautan bila kosong. Pola text-scan proyek ini; fungsi murni dieksekusi dari sumbernya.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { teksUkuranDariNotes } from "../src/utils/ukuranKasur.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const RENCANA = read("pages", "bengkel", "ProductionRencanaWorkspace.jsx");
const BACKLOG_CARD = read("features", "production", "BacklogCard.jsx");
const SCHEDULE = read("features", "production", "ScheduleModals.jsx");
const ACTIVATION = read("features", "production", "RencanaActivationModal.jsx");
const MODEL_SRC = read("features", "production", "unitCardModel.js");
const BACKLOG_SRC = fs.readFileSync(path.join(__dirname, "..", "..", "backend", "src", "services", "productionBacklog.js"), "utf8");
const API = read("api.js");
const USE_BACKLOG = read("features", "production", "useBacklog.js");

function loadOnboardView() {
  const fnSrc = MODEL_SRC.slice(MODEL_SRC.indexOf("export function viewOfOnboardCard"));
  const body = fnSrc.slice(0, fnSrc.indexOf("\n}\n") + 3).replace(/^export /, "");
  return new Function("teksUkuranDariNotes", `${body}\nreturn viewOfOnboardCard;`)(teksUkuranDariNotes);
}
const item = (priorityKey = "NORMAL") => ({
  unitId: "u-1", schedulable: false, view: null, rencana: { action: "ONBOARD_SCHEDULE", onboardable: true },
  card: { unit: { id: "u-1", unitCode: "U-1", merk: "Serta", ukuran: "160x200", photoUrl: "/media/unit-photo/u-1" }, customer: { name: "Bu Sari", orderNumber: "ORD-1", salesServices: ["Ganti Kain"] },
    orderStatus: { key: "DIPROSES", label: "Diproses" }, unitStatus: { key: "DIPROSES", label: "Diproses" }, presence: { key: "NOT_ARRIVED", label: "Belum tiba di workshop", confirmed: false }, priority: { key: priorityKey, label: priorityKey, rank: 0, complaintCases: [] } },
});

test("view sintetis kartu order nyata: runId sintetis + onboardUnitId, TANPA plan; prioritas Tinggi/Komplain jadi usulan 1, Normal 0", () => {
  const f = loadOnboardView();
  const v = f(item("NORMAL"));
  assert.equal(v.runId, "unit:u-1"); assert.equal(v.onboardUnitId, "u-1"); assert.equal(v.plan, null); assert.equal(v.suggestedPriority, 0);
  assert.equal(v.unit.unitCode, "U-1"); assert.equal(v.unit.photoUrl, "/media/unit-photo/u-1"); assert.deepEqual(v.customer.salesServices, ["Ganti Kain"]);
  assert.equal(v.presence.key, "NOT_ARRIVED", "kehadiran fisik TIDAK dipalsukan");
  assert.equal(f(item("HIGH")).suggestedPriority, 1); assert.equal(f(item("COMPLAINT")).suggestedPriority, 1);
  const orderSize = item(); orderSize.card.unit.ukuran = null;
  orderSize.card.customer.request = JSON.stringify({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: 145, ukuranPanjangCm: 205 });
  assert.equal(f(orderSize).unit.ukuran, "145 × 205 cm (Custom)");
  assert.equal(f({ card: null }), null);
});

test("kartu backlog: instruksi lama 'Belum bisa dijadwalkan' dihapus; aksi berikutnya dari server; handle seret + Jadwalkan HANYA bila onboardable", () => {
  assert.doesNotMatch(BACKLOG_CARD, /Belum bisa dijadwalkan/);
  assert.doesNotMatch(BACKLOG_CARD, /data-testid="not-schedulable"/);
  assert.match(BACKLOG_CARD, /const onboardable = !!r\?\.onboardable/);
  assert.match(BACKLOG_CARD, /const activatable = !onboardable && !!r\?\.activatable/);
  assert.match(BACKLOG_CARD, /const draggable = onboardable \|\| activatable/);
  assert.match(BACKLOG_CARD, /\{draggable && handle &&/, "handle seret hanya untuk kartu yang boleh dijadwalkan (onboardable) atau boleh diaktifkan saat dijadwalkan (activatable, ADMIN/OWNER dari server)");
  assert.match(BACKLOG_CARD, /data-testid="rencana-activate-note"/, "kartu yang diaktifkan saat dijadwalkan menjelaskan konsekuensinya");
  assert.match(BACKLOG_CARD, /data-testid="backlog-schedule"/);
  assert.match(BACKLOG_CARD, /Langkah berikutnya/);
  assert.match(BACKLOG_CARD, /data-testid="photo-note"/, "penjelasan foto kosong ditampilkan");
  // kartu non-onboardable tidak punya tombol jadwal di cabangnya
  // Setelah penyederhanaan kartu: cabang `draggable ? <Button …> : <p …>` — tombol hanya di cabang draggable; cabang lain hanya teks "Langkah berikutnya" tanpa Jadwalkan/handle.
  const awal = BACKLOG_CARD.indexOf("{draggable ? <Button");
  assert.ok(awal > 0, "cabang tombol Jadwalkan ditemukan");
  assert.equal((BACKLOG_CARD.match(/data-testid="backlog-schedule"/g) || []).length, 1, "tombol Jadwalkan hanya satu, di cabang draggable");
  const nonBranch = BACKLOG_CARD.slice(BACKLOG_CARD.indexOf(" : <p ", awal));
  assert.ok(nonBranch.length > 10 && nonBranch.indexOf("</p>") > 0, "cabang non-draggable ditemukan");
  assert.doesNotMatch(nonBranch.slice(0, nonBranch.indexOf("</p>")), /Jadwalkan|handle|onSchedule/);
});

test("kartu ringkas menampilkan ukuran unit asli dan aktivasi yang tetap butuh konfirmasi; peringatan PIC cukup sekali per papan", () => {
  assert.match(BACKLOG_CARD, /formatUkuranLabel\(c\.unit\.ukuran\) \|\| teksUkuranDariNotes\(c\.customer\.request\)/, "ukuran mengikuti unit lalu catatan order Sales");
  assert.match(BACKLOG_SRC, /notes: true/);
  assert.match(BACKLOG_SRC, /request: u\.order\?\.notes \?\? null/);
  assert.match(MODEL_SRC, /request: c\.customer\?\.request \?\? null/, "kartu yang diseret membawa sumber ukuran yang sama");
  assert.match(BACKLOG_CARD, /Ukuran belum dicatat/, "data kosong tidak ditebak dari layanan");
  assert.match(BACKLOG_CARD, /data-testid="backlog-size"/);
  assert.match(BACKLOG_CARD, /Perlu aktivasi/);
  assert.match(BACKLOG_CARD, /Aktifkan & Jadwalkan/);
  assert.match(RENCANA, /data-testid="meja-pic-warning"/);
  assert.equal((RENCANA.match(/Tetapkan lini di Pengaturan › Operator/g) || []).length, 1);
  assert.match(RENCANA, /slots > 0 && <div data-testid="meja-slot"/, "satu area lepas per meja kosong");
  // Regresi yang ditemukan lewat browser: peringatan PIC yang menjadi sibling grid dua kolom menempati kolom kanan dan mendorong papan Meja ke kolom 340px.
  // Peringatan dan grid Meja HARUS satu pembungkus kolom kanan.
  const panel = RENCANA.slice(RENCANA.indexOf('data-testid="meja-panel"'));
  assert.ok(panel.indexOf('data-testid="meja-pic-warning"') > 0 && panel.indexOf('data-testid="meja-pic-warning"') < panel.indexOf('data-testid="meja-grid"'), "peringatan di atas grid Meja, di dalam pembungkus yang sama");
  // Teks penting tidak terpotong: nama pelanggan & kode·order membungkus (bukan elipsis), tab status membungkus dan >= 40px.
  assert.doesNotMatch(BACKLOG_CARD, /truncate[^"]*text-\[14px\] font-bold/, "nama pelanggan tidak di-truncate");
  assert.match(BACKLOG_CARD, /break-words text-\[14px\] font-bold leading-tight text-ink \[overflow-wrap:anywhere\]/);
  assert.match(RENCANA, /aria-label="Saring status backlog" className="flex flex-wrap gap-1\.5"/);
  assert.match(RENCANA, /min-h-\[40px\] rounded-chip px-3 text-\[12\.5px\] font-semibold/);
});

test("halaman Rencana: kartu order nyata memakai Jadwalkan + seret yang SAMA; slot Meja tidak menyuruh menyeret bila tidak ada yang bisa diseret", () => {
  assert.match(RENCANA, /onSchedule=\{\(item\) => setSchedule\(viewOfOnboardCard\(item\)\)\}/);
  assert.match(RENCANA, /hasDraggable \?/, "teks slot bergantung pada ada-tidaknya unit yang bisa diseret");
  assert.match(RENCANA, /kosong — belum ada unit yang bisa dijadwalkan/);
  assert.match(RENCANA, /const hasDraggable = backlog\.length > 0 \|\| bl\.items\.some\(\(it\) => it\.rencana\?\.onboardable \|\| it\.rencana\?\.activatable\)/);
  assert.match(RENCANA, /handle=\{it\.rencana\?\.onboardable \|\| it\.rencana\?\.activatable \? <DragHandle/);
  // kartu order nyata (tanpa plan.id) tidak pernah dikirim langsung sebagai pemindahan: selalu formulir Jadwalkan dengan Meja terpilih
  assert.match(RENCANA, /if \(!plan\?\.id\) \{ setSchedule\(\{ \.\.\.view, presetStation: stationCode \}\); return; \}/);
  // drag onboardable lewat resolveDrop/decideDrop yang sama -> placeOn -> formulir (PIC wajib) -> satu command
  // PIC bawaan Meja dipakai bila ada (server memilihnya); tanpa PIC bawaan dan tanpa PIC rencana -> formulir agar petugas memilih (tidak ada tebakan).
  assert.match(RENCANA, /if \(!stationPic && !\(plan\?\.workCenter\?\.id && plan\?\.operator\?\.id\)\) \{ setSchedule\(\{ \.\.\.view, presetStation: stationCode \}\); return; \}/);
});

test("formulir Jadwalkan: unit tanpa Run dikirim sebagai unitId (Run dibuka server di transaksi yang sama); rencana lama tetap runId", () => {
  assert.match(SCHEDULE, /target\.onboardUnitId \? \{ unitId: target\.onboardUnitId, \.\.\.body \} : \{ runId: target\.runId, \.\.\.body \}/);
  assert.match(SCHEDULE, /suggestedPriority/);
  assert.match(SCHEDULE, /Pekerjaan produksi dibuka \(unit belum tiba di workshop/, "pesan sukses jujur: belum tiba");
  assert.match(SCHEDULE, /result\.origin === "WORKSHOP_BORN" \? " — Pekerjaan produksi dibuka \(unit dibuat di workshop\)"/, "unit BARU/SEWA lahir di workshop: tidak ada klaim 'belum tiba'");
  assert.match(API, /planProductionV2Unit: \(data, idempotencyKey = mutationKey\("p8-plan"\)\)/);
});

test("PIC/workshop: dimuat dari SATU endpoint server; kosong selalu disertai alasan + tautan; akun produksi bisa didaftarkan eksplisit; tidak ada Promise.all yang menelan galat", () => {
  assert.match(RENCANA, /api\.getPlanningRefs\(\)/);
  assert.doesNotMatch(RENCANA, /Promise\.all\(\[api\.getWorkCenters\(\), api\.getProductionOperators\(\)/);
  assert.match(API, /getPlanningRefs: \(\) => request\("\/production-v2\/planning\/refs"\)/);
  assert.match(SCHEDULE, /data-testid="refs-problems"/); assert.match(SCHEDULE, /<Link to=\{p\.link\}/);
  assert.match(SCHEDULE, /api\.createProductionOperator\(\{ userId: c\.userId, primaryWorkCenterId: workCenterId \|\| undefined \}\)/);
  assert.match(SCHEDULE, /data-testid="register-pic"/);
  assert.match(SCHEDULE, /refs\.canRegisterOperator/, "tombol daftar hanya untuk yang berizin");
  assert.match(RENCANA, /\.catch\(\(\) => \{\}\)/, "hanya bahan/stok (BOM) yang boleh gagal diam-diam, terpisah dari PIC");
  assert.match(RENCANA, /REFS_ERROR/, "galat memuat PIC ditampilkan, bukan ditelan");
});

test("ringkasan & aktivasi: hitungan dari server; modal aktivasi baca-saja dengan perintah konkret hanya untuk unit yang menunggu aktivasi", () => {
  assert.match(USE_BACKLOG, /rencanaCounts: last\?\.rencanaCounts \|\| \{\}/);
  assert.match(RENCANA, /<RencanaSummary counts=\{bl\.rencanaCounts\}/);
  assert.match(RENCANA, /data-testid="open-activation"/);
  assert.match(ACTIVATION, /api\.getRencanaEligibility\(\)/);
  assert.match(ACTIVATION, /filter\(\(u\) => u\.action === "AWAIT_ACTIVATION"\)/);
  assert.match(ACTIVATION, /RENCANA_BACKUP_OK=1 node scripts\/production-delivery-v2\/activate-rencana-units\.js --unit-codes=/);
  assert.doesNotMatch(ACTIVATION, /\.post\(|method: "POST"|method: "PUT"/, "modal aktivasi tidak pernah menulis apa pun");
  assert.match(ACTIVATION, /TIDAK terjadi otomatis/);
});

test("Unit 360: kedatangan yang dikonfirmasi petugas tanpa pickup dibaca dari catatan asli (siapa/kapan/lokasi) dan diberi label 'bukan bukti pickup'", () => {
  const DRAWER = read("features", "production", "UnitOverviewDrawer.jsx");
  assert.match(DRAWER, /data-testid="staff-arrival"/);
  assert.match(DRAWER, /dikonfirmasi petugas/); assert.match(DRAWER, /\(bukan bukti pickup\)/);
  assert.match(DRAWER, /d\.pickup\.staffArrival\.confirmedByName/);
});

test("konflik papan basi: galat penuh/revisi memuat ulang papan di belakang formulir dan memindahkan pilihan dari Meja yang kini penuh", () => {
  // Keadaan unit berubah saat modal terbuka (diaktifkan orang lain / Run muncul / progres V1) juga memuat ulang papan di belakang formulir.
  assert.match(SCHEDULE, /const STALE_CODES = \["PLAN_STATION_FULL", "PLAN_REVISION_CONFLICT", "STATION_ORDER_STALE", "RENCANA_ACTIVATION_STALE", "RENCANA_RUN_OUTSIDE_COHORT", "RENCANA_HAS_PRIOR_RUN", "RENCANA_HAS_V1_PROGRESS", "RENCANA_PARTIAL_ACTIVATION"\]/);
  assert.match(SCHEDULE, /if \(STALE_CODES\.includes\(e\?\.code\)\) onStale\?\.\(\)/);
  assert.match(SCHEDULE, /stationCapacity\(cur\)\.full && cur\.code !== plan\?\.stationCode/, "Meja rencana ini sendiri tidak dianggap penuh");
  assert.match(RENCANA, /onStale=\{load\}/);
});

test("aktivasi saat Jadwalkan: penanda dari server (bukan tebakan peran di browser); formulir mewajibkan centang eksplisit dan mengirim activateUnit; tanpa centang tidak terkirim", () => {
  assert.match(MODEL_SRC, /activatable: !!item\.rencana\?\.activatable/);
  assert.match(SCHEDULE, /const askActivate = !!target\.activatable && !!target\.onboardUnitId && !target\.plan/);
  assert.match(SCHEDULE, /if \(askActivate && !unschedule && !activateOk\) \{ setError\(/, "tanpa centang persetujuan -> tidak mengirim apa pun");
  assert.match(SCHEDULE, /\.\.\.\(askActivate \? \{ activateUnit: true \} : \{\}\)/);
  assert.match(SCHEDULE, /data-testid="schedule-activate-ok"/);
  const toView = loadOnboardView();
  const card = (id) => ({ unit: { id, unitCode: `RES-${id}-U1` }, customer: {}, priority: { key: "NORMAL" } });
  const aktif = toView({ card: card("u-9"), rencana: { action: "AWAIT_ACTIVATION", activatable: true } });
  assert.equal(aktif.activatable, true); assert.equal(aktif.onboardUnitId, "u-9"); assert.equal(aktif.plan, null);
  assert.equal(toView({ card: card("u-8"), rencana: { action: "AWAIT_ACTIVATION", activatable: false } }).activatable, false);
});

test("seret hanya aktif setelah data papan siap (bukan saat kolom Meja masih dirender dari daftar bawaan) — mencegah 'Meja tujuan tidak ditemukan' intermiten di HP", () => {
  assert.match(RENCANA, /usePlanDrag\(\{ enabled: !busy && !loading && !!board && reader !== "OFF"/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "features", "production", "planDnd.js"), "utf8"), /Meja tujuan tidak ditemukan\. Muat ulang halaman\./, "penolakan server-state tetap ada sebagai pengaman terakhir");
});
