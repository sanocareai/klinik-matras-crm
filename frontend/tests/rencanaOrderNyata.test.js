// Rencana Produksi untuk ORDER NYATA — kontrak layar: kartu backlog tanpa instruksi seret yang menyesatkan, aksi berikutnya yang jelas, Jadwalkan + seret memakai SATU pintu
// (unitId -> POST /production-v2/plans), PIC/workshop dari endpoint server dengan alasan + tautan bila kosong. Pola text-scan proyek ini; fungsi murni dieksekusi dari sumbernya.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const RENCANA = read("pages", "bengkel", "ProductionRencanaWorkspace.jsx");
const BACKLOG_CARD = read("features", "production", "BacklogCard.jsx");
const SCHEDULE = read("features", "production", "ScheduleModals.jsx");
const ACTIVATION = read("features", "production", "RencanaActivationModal.jsx");
const MODEL_SRC = read("features", "production", "unitCardModel.js");
const API = read("api.js");
const USE_BACKLOG = read("features", "production", "useBacklog.js");

function loadOnboardView() {
  const fnSrc = MODEL_SRC.slice(MODEL_SRC.indexOf("export function viewOfOnboardCard"));
  const body = fnSrc.slice(0, fnSrc.indexOf("\n}\n") + 3).replace(/^export /, "");
  return new Function(`${body}\nreturn viewOfOnboardCard;`)();
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
  assert.equal(f({ card: null }), null);
});

test("kartu backlog: instruksi lama 'Belum bisa dijadwalkan' dihapus; aksi berikutnya dari server; handle seret + Jadwalkan HANYA bila onboardable", () => {
  assert.doesNotMatch(BACKLOG_CARD, /Belum bisa dijadwalkan/);
  assert.doesNotMatch(BACKLOG_CARD, /data-testid="not-schedulable"/);
  assert.match(BACKLOG_CARD, /const onboardable = !!r\?\.onboardable/);
  assert.match(BACKLOG_CARD, /\{onboardable && handle &&/, "handle seret hanya untuk kartu yang boleh dijadwalkan");
  assert.match(BACKLOG_CARD, /data-testid="backlog-schedule"/);
  assert.match(BACKLOG_CARD, /Langkah berikutnya/);
  assert.match(BACKLOG_CARD, /data-testid="photo-note"/, "penjelasan foto kosong ditampilkan");
  // kartu non-onboardable tidak punya tombol jadwal di cabangnya
  const nonBranch = BACKLOG_CARD.slice(BACKLOG_CARD.indexOf(") : r ? ("));
  assert.doesNotMatch(nonBranch.slice(0, nonBranch.indexOf(") : null}")), /Jadwalkan|handle/);
});

test("halaman Rencana: kartu order nyata memakai Jadwalkan + seret yang SAMA; slot Meja tidak menyuruh menyeret bila tidak ada yang bisa diseret", () => {
  assert.match(RENCANA, /onSchedule=\{\(item\) => setSchedule\(viewOfOnboardCard\(item\)\)\}/);
  assert.match(RENCANA, /hasDraggable \?/, "teks slot bergantung pada ada-tidaknya unit yang bisa diseret");
  assert.match(RENCANA, /kosong — belum ada unit yang bisa dijadwalkan/);
  assert.match(RENCANA, /const hasDraggable = backlog\.length > 0 \|\| bl\.items\.some\(\(it\) => it\.rencana\?\.onboardable\)/);
  // drag onboardable lewat resolveDrop/decideDrop yang sama -> placeOn -> formulir (PIC wajib) -> satu command
  assert.match(RENCANA, /if \(!\(plan\?\.workCenter\?\.id && plan\?\.operator\?\.id\)\) \{ setSchedule\(\{ \.\.\.view, presetStation: stationCode \}\); return; \}/);
});

test("formulir Jadwalkan: unit tanpa Run dikirim sebagai unitId (Run dibuka server di transaksi yang sama); rencana lama tetap runId", () => {
  assert.match(SCHEDULE, /target\.onboardUnitId \? \{ unitId: target\.onboardUnitId, \.\.\.body \} : \{ runId: target\.runId, \.\.\.body \}/);
  assert.match(SCHEDULE, /suggestedPriority/);
  assert.match(SCHEDULE, /Run produksi dibuka \(unit belum tiba di workshop/, "pesan sukses jujur: belum tiba");
  assert.match(SCHEDULE, /result\.origin === "WORKSHOP_BORN" \? " — Run produksi dibuka \(unit dibuat di workshop\)"/, "unit BARU/SEWA lahir di workshop: tidak ada klaim 'belum tiba'");
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
  assert.match(SCHEDULE, /const STALE_CODES = \["PLAN_STATION_FULL", "PLAN_REVISION_CONFLICT", "STATION_ORDER_STALE"\]/);
  assert.match(SCHEDULE, /if \(STALE_CODES\.includes\(e\?\.code\)\) onStale\?\.\(\)/);
  assert.match(SCHEDULE, /stationCapacity\(cur\)\.full && cur\.code !== plan\?\.stationCode/, "Meja rencana ini sendiri tidak dianggap penuh");
  assert.match(RENCANA, /onStale=\{load\}/);
});
