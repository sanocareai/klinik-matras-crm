// STATUS KERJA DARI JADWAL — jadwal Rencana Admin AKTIF (tanpa Pelaksanaan Meja/Run) harus terbaca "Dijadwalkan" di semua tempat yang membaca status kerja
// (Ringkasan unit, tindakan berikutnya, daftar + filter, ekspor Excel Order Produksi, Riwayat). HTTP + DB sungguhan, DB uji terisolasi, bukan production.
// Dibuktikan: ACTIVE → Dijadwalkan; CLEARED → kembali Belum dijadwalkan (riwayat tetap); ADOPTED (diambil alih Meja V2) → tetap Dijadwalkan; tanpa jadwal → Belum dijadwalkan;
// jadwal SAJA tidak pernah menjadi "Sudah dikerjakan" dan tidak mengaku ada pemakaian bahan; pemakaian aktual → "Sudah dikerjakan" (fakta "Dikerjakan tanpa jadwal" hanya bila memang tanpa jadwal aktif).
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { addDays, todayWib } from "../../src/lib/domain/productionRencanaAdmin.js";
import { buildRencanaExport } from "../../src/services/productionRencanaExportService.js";
import { normalizeExportQuery } from "../../src/lib/domain/productionRencanaExport.js";
import { BOARD_DEFAULTS } from "../../src/lib/domain/productionBoard.js";

const P = "/api/production"; const V2 = "/api/production-v2";
let server; let seq = 0; let w;
const dow = (k) => new Date(`${k}T00:00:00Z`).getUTCDay();
const HARI_INI = (() => { let k = todayWib(); while (dow(k) === 0) k = addDays(k, 1); return k; })();
const H = (n) => { let k = HARI_INI; let c = 0; while (c < n) { k = addDays(k, 1); if (dow(k) !== 0) c += 1; } return k; };

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.beforeEach(async () => { await truncateAll(); w = await world(); });

const idem = (tag) => ({ "Idempotency-Key": `skj-${tag}-${++seq}-0000` });
async function world() {
  const mk = async (role) => { const u = await createTestUser({ roles: [role] }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
  const admin = await mk("ADMIN");
  const wc = await testPrisma.workCenter.create({ data: { code: `WC-SKJ-${++seq}`, name: "Workshop Utama" } });
  return { admin, wc };
}
async function mkOperator() {
  const u = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  await testPrisma.userRole.create({ data: { userId: u.user.id, role: "PRODUCTION_WORKER" } });
  return testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: u.user.id, primaryWorkCenterId: w.wc.id, active: true } });
}
async function mkUnit({ received = false } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan SKJ ${++seq}`, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `RES-SKJ-${++seq}`, value: 1_000_000, category: "LAYANAN", status: "PROCESSING", pickupConfirmedDate: new Date(), items: { create: [{ layananName: "Service Fondasi", harga: 1_000_000, sortOrder: 1 }] } } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `SKJ-${seq}-U1`, orderId: order.id, seq: 1, status: "RECEIVED", merk: "King Koil", ukuran: "160x200" } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", scheduledDate: new Date(), completedAt: new Date() } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  if (received) {
    const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-SKJ-${++seq}`, name: "Gudang SKJ" } });
    const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-SKJ-${++seq}` } });
    await testPrisma.unitWorkshopReceipt.create({ data: { unitId: unit.id, seq: 1, locationId: rcv.id, receivedById: w.admin.user.id } });
  }
  return unit;
}
const jadwalkan = (unit, body = {}) => w.admin.api.post(`${P}/units/${unit.id}/jadwal`, { productionDate: H(2), stationCode: "TABLE_1", expectedRevision: 0, ...body }, idem("jdw"));
const keluarkan = (unit, rev) => w.admin.api.post(`${P}/units/${unit.id}/jadwal/keluarkan`, { expectedRevision: rev }, idem("klr"));
const adopsi = async (unit) => (await w.admin.api.get(`${P}/units/${unit.id}/adopsi`)).body;
const kerja = async (unit) => (await adopsi(unit)).adopsi.kerja;
const pakaiBaru = (unit, m, qty) => w.admin.api.post(`/api/units/${unit.id}/materials`, { materialId: m.id, qty }, idem("pb"));
const mat = async (code) => { const m = await createTestMaterial({ code, unit: "METER", itemGroup: "KAIN" }); await seedBalance(m.id, 20); return m; };
const daftar = async (filter) => (await w.admin.api.get(`${P}/work-orders?statusKerja=${filter}&pageSize=50`)).body.units.map((u) => u.id);
const barisExcel = async (unit) => {
  const res = await fetch(`${server.baseUrl}${P}/work-orders/export.xlsx`, { headers: { Authorization: `Bearer ${w.admin.token}` } }); assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer())); const ws = wb.getWorksheet("Ringkasan Unit"); const head = ws.getRow(1).values.slice(1);
  const row = ws.getRows(2, ws.rowCount - 1).find((r) => r.values[head.indexOf("Kode Unit") + 1] === unit.unitCode); assert.ok(row, "unit ada di Excel");
  return Object.fromEntries(head.map((h, i) => [h, row.values[i + 1]]));
};
const efek = async () => ({ run: await testPrisma.productionRun.count(), plan: await testPrisma.productionRunPlan.count(), mi: await testPrisma.materialIssue.count(), sm: await testPrisma.stockMovement.count(), progres: await testPrisma.productionUnitWorkProgress.count(), qc: await testPrisma.qualityInspection.count(), stage: await testPrisma.unitStageLog.count() });

test("J1. TANPA jadwal: Belum dijadwalkan di Ringkasan, daftar, Excel", async () => {
  const u = await mkUnit();
  const ad = await adopsi(u); assert.equal(ad.adopsi.kerja.key, "BELUM_DIJADWALKAN"); assert.equal(ad.adopsi.jadwal, null);
  assert.deepEqual(await daftar("BELUM_DIJADWALKAN"), [u.id]); assert.deepEqual(await daftar("DIJADWALKAN"), []);
  const x = await barisExcel(u); assert.equal(x["Status Kerja (Administratif)"], "Belum dijadwalkan");
});

test("J2. jadwal Rencana Admin ACTIVE tanpa Meja/Run → 'Dijadwalkan' di Ringkasan, tindakan, daftar+filter, Excel, Riwayat; BUKAN 'Sudah dikerjakan'; tanpa pemakaian bahan; tanpa efek operasional", async () => {
  const u = await mkUnit(); const e0 = await efek();
  const r = await jadwalkan(u); assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(await efek(), e0, "jadwal Admin tidak membuat Run/rencana Meja/Material Issue/stok/progres/QC/tahap");
  const ad = await adopsi(u); const k = ad.adopsi.kerja;
  assert.equal(k.key, "DIJADWALKAN"); assert.equal(k.label, "Dijadwalkan"); assert.equal(k.source, "JADWAL"); assert.equal(k.tanpaJadwal, false); assert.ok(!k.faktaJadwal, "tidak ada fakta 'tanpa jadwal'");
  assert.equal(ad.adopsi.jadwal.sumber, "ADMIN"); assert.equal(ad.adopsi.jadwal.tanggal, H(2)); assert.equal(ad.adopsi.jadwal.meja, "TABLE_1");
  assert.deepEqual({ baru: ad.adopsi.pemakaianBahan.baruCatatan, lama: ad.adopsi.pemakaianBahan.komponenLamaDipakaiKembali }, { baru: 0, lama: 0 }, "jadwal tidak mengaku ada pemakaian bahan");
  assert.notEqual(ad.adopsi.tindakan.label, "Jadwalkan di Rencana Produksi", "tidak lagi menyuruh menjadwalkan unit yang sudah terjadwal");
  assert.deepEqual(await daftar("DIJADWALKAN"), [u.id]); assert.deepEqual(await daftar("BELUM_DIJADWALKAN"), []); assert.deepEqual(await daftar("DIKERJAKAN"), []);
  const x = await barisExcel(u);
  assert.equal(x["Status Kerja (Administratif)"], "Dijadwalkan"); assert.equal(x["Sumber Status Kerja"], "Dari jadwal"); assert.ok(!x["Fakta Jadwal"], "Excel tanpa 'tanpa jadwal'");
  assert.equal(x["Pemakaian Bahan Baru (jumlah catatan)"] ?? 0, 0); assert.equal(x["Komponen Lama Dipakai Kembali (jumlah)"] ?? 0, 0);
  const rw = (await w.admin.api.get(`${P}/units/${u.id}/jadwal`)).body; assert.deepEqual(rw.events.map((e) => e.kind), ["SCHEDULED"]);
  // Ekspor Excel Rencana: sudah berlabel sumber "Rencana Admin" untuk jadwal tanpa Run (tidak menyebut unit ini belum dijadwalkan)
  const q = normalizeExportQuery({ from: H(0), to: H(5), stations: [], includeUnscheduled: true }, { today: HARI_INI, stations: BOARD_DEFAULTS.stations });
  const ex = await buildRencanaExport(testPrisma, { cohortUnitIds: [], query: q, canIncludeValue: false });
  const bx = ex.rows.find((x) => x.unitCode === u.unitCode); assert.ok(bx, "unit ada di ekspor Rencana"); assert.equal(bx.sumberJadwal, "Rencana Admin"); assert.equal(bx.meja !== "Belum Dijadwalkan", true); assert.equal(bx.tanggal, H(2));
  assert.ok(!ad.riwayat.some((e) => e.kind === "STATUS_KERJA_OTOMATIS"), "jadwal tidak menulis peristiwa 'Sudah dikerjakan'");
});

test("J3. jadwal ACTIVE dipindah (RESCHEDULED) tetap 'Dijadwalkan'; dikeluarkan (CLEARED) → kembali 'Belum dijadwalkan' di semua tempat; riwayat jadwal TIDAK hilang", async () => {
  const u = await mkUnit(); assert.equal((await jadwalkan(u)).status, 201);
  const pindah = await jadwalkan(u, { productionDate: H(3), expectedRevision: 1 }); assert.equal(pindah.status, 201, JSON.stringify(pindah.body));
  assert.equal((await kerja(u)).key, "DIJADWALKAN");
  const kl = await keluarkan(u, 2); assert.equal(kl.status, 201, JSON.stringify(kl.body));
  const ad = await adopsi(u); assert.equal(ad.adopsi.kerja.key, "BELUM_DIJADWALKAN"); assert.equal(ad.adopsi.jadwal, null); assert.equal(ad.adopsi.kerja.tanpaJadwal, false);
  assert.deepEqual(await daftar("BELUM_DIJADWALKAN"), [u.id]); assert.deepEqual(await daftar("DIJADWALKAN"), []);
  assert.equal((await barisExcel(u))["Status Kerja (Administratif)"], "Belum dijadwalkan");
  const rw = (await w.admin.api.get(`${P}/units/${u.id}/jadwal`)).body; assert.deepEqual(rw.events.map((e) => e.kind), ["SCHEDULED", "RESCHEDULED", "UNSCHEDULED"]);
  assert.equal((await testPrisma.productionUnitSchedule.findUniqueOrThrow({ where: { unitId: u.id } })).status, "CLEARED");
});

test("J4. ADOPTED (diambil alih Meja V2): tetap 'Dijadwalkan' lewat rencana Meja; tidak ada hitungan ganda; pemakaian bahan tetap nol", async () => {
  const op = await mkOperator(); const u = await mkUnit({ received: true }); const lain = await mkUnit();
  // kohort V2 berisi unit LAIN (pola yang sama dengan tes aktivasi Rencana Admin): unit uji diaktifkan eksplisit lewat POST plans activateUnit.
  for (const key of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, enabled: true, scope: "GLOBAL", config: { unitIds: [lain.id] }, reason: "status kerja jadwal" }, update: { enabled: true, scope: "GLOBAL", config: { unitIds: [lain.id] } } });
  assert.equal((await jadwalkan(u, { stationCode: "TABLE_2" })).status, 201); assert.equal((await kerja(u)).key, "DIJADWALKAN");
  const akt = await w.admin.api.post(`${V2}/plans`, { unitId: u.id, productionDate: H(3), stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.id, activateUnit: true }, idem("akt")); assert.equal(akt.status, 201, JSON.stringify(akt.body));
  assert.equal((await testPrisma.productionUnitSchedule.findUniqueOrThrow({ where: { unitId: u.id } })).status, "ADOPTED");
  const ad = await adopsi(u); assert.equal(ad.adopsi.kerja.key, "DIJADWALKAN"); assert.equal(ad.adopsi.jadwal.sumber, "V2"); assert.equal(ad.adopsi.jadwal.tanggal, H(3));
  assert.deepEqual({ baru: ad.adopsi.pemakaianBahan.baruCatatan, lama: ad.adopsi.pemakaianBahan.komponenLamaDipakaiKembali }, { baru: 0, lama: 0 });
  assert.deepEqual(await daftar("DIJADWALKAN"), [u.id]); assert.equal((await barisExcel(u))["Status Kerja (Administratif)"], "Dijadwalkan");
});

test("J5. PEMAKAIAN AKTUAL + jadwal ACTIVE → 'Sudah dikerjakan' (pemakaian mengalahkan jadwal) TANPA fakta 'Dikerjakan tanpa jadwal'; jadwal dikeluarkan sesudahnya → fakta 'tanpa jadwal' muncul", async () => {
  const u = await mkUnit(); const m = await mat("KAIN-J5"); assert.equal((await jadwalkan(u)).status, 201); assert.equal((await kerja(u)).key, "DIJADWALKAN");
  const p = await pakaiBaru(u, m, 2); assert.equal(p.status, 201, JSON.stringify(p.body));
  const k1 = await kerja(u); assert.equal(k1.key, "DIKERJAKAN"); assert.equal(k1.label, "Sudah dikerjakan"); assert.equal(k1.source, "PEMAKAIAN_BAHAN"); assert.equal(k1.tanpaJadwal, false); assert.ok(!k1.faktaJadwal);
  assert.deepEqual(await daftar("DIKERJAKAN"), [u.id]); assert.deepEqual(await daftar("DIJADWALKAN"), []);
  const x = await barisExcel(u); assert.equal(x["Status Kerja (Administratif)"], "Sudah dikerjakan"); assert.ok(!x["Fakta Jadwal"]); assert.equal(x["Pemakaian Bahan Baru (jumlah catatan)"], 1);
  assert.equal((await keluarkan(u, 1)).status, 201);
  const k2 = await kerja(u); assert.equal(k2.key, "DIKERJAKAN"); assert.equal(k2.tanpaJadwal, true); assert.equal(k2.faktaJadwal, "Dikerjakan tanpa jadwal");
});

test("J6. daftar kerja (work list) & panel memakai aturan yang sama: unit berjadwal Admin tidak lagi berstatus 'Belum dijadwalkan' dan tidak terhitung 'perlu dijadwalkan'", async () => {
  const sudah = await mkUnit(); const belum = await mkUnit(); assert.equal((await jadwalkan(sudah)).status, 201);
  const hasil = await w.admin.api.get(`${P}/work-orders?pageSize=50`); assert.equal(hasil.status, 200);
  const per = Object.fromEntries(hasil.body.units.map((x) => [x.id, x.adopsi.kerja.key]));
  assert.equal(per[sudah.id], "DIJADWALKAN"); assert.equal(per[belum.id], "BELUM_DIJADWALKAN");
  const ant = (await w.admin.api.get(`${P}/rencana/antrean?tab=SEMUA`)).body; const baris = (id) => ant.items.find((i) => i.unitId === id);
  assert.ok(baris(sudah.id) && baris(belum.id), JSON.stringify(ant.counts));
  assert.notEqual(baris(sudah.id).tab, baris(belum.id).tab, "antrean memisahkan unit berjadwal dari yang belum (aturan antrean tetap konsisten dengan status kerja)");
});

test("J7. TINDAKAN BERIKUTNYA unit Dijadwalkan (sudah diterima di workshop): satu tindakan 'Buka pekerjaan' (membuka halaman, tidak mengubah status); target selesai & rencana bahan OPSIONAL — tidak ada langkah wajib 'Tetapkan target'/'Susun rencana bahan', sama dengan atau tanpa keduanya", async () => {
  const u = await mkUnit({ received: true }); assert.equal((await jadwalkan(u)).status, 201);
  const tanpa = (await adopsi(u)).adopsi; assert.equal(tanpa.kerja.key, "DIJADWALKAN"); assert.equal(tanpa.targetSelesai?.at ?? null, null, "unit ini memang tanpa target");
  assert.equal(tanpa.tindakan.aksi, "OPEN_WORK"); assert.equal(tanpa.tindakan.label, "Buka pekerjaan"); assert.match(tanpa.tindakan.detail, /Membuka halaman tidak mengubah status/); assert.match(tanpa.tindakan.detail, /Target selesai dan rencana bahan opsional/); assert.ok(!/wajib|harus/i.test(tanpa.tindakan.label + tanpa.tindakan.detail));
  const m = await mat("KAIN-J7"); const put = await w.admin.api.put(`${P}/units/${u.id}/material-plan`, { lines: [{ materialId: m.id, qty: 2 }], expectedRevision: 0 }); assert.equal(put.status, 200);
  const ada = await jadwalkan(u, { productionDate: H(3), expectedRevision: 1, targetDate: H(5) }); assert.equal(ada.status, 201, JSON.stringify(ada.body));
  const dengan = (await adopsi(u)).adopsi; assert.ok(dengan.targetSelesai?.at, "kini ada target"); assert.equal(dengan.tindakan.aksi, "OPEN_WORK"); assert.equal(dengan.tindakan.label, tanpa.tindakan.label);
  const belum = await mkUnit({ received: true }); const bj = (await adopsi(belum)).adopsi.tindakan;
  assert.equal(bj.label, "Jadwalkan di Rencana Produksi"); assert.match(bj.detail, /Target selesai opsional/);
});

// ═══ UX STATUS KERJA JUJUR (22 Okt 2026): "Buka pekerjaan" hanya membuka; "Sudah dikerjakan" tercatat lewat pemakaian bahan (otomatis) atau tombol manual berkonfirmasi ═══
const workList = async (q, filter = "SEMUA", klien = null) => { const r = await (klien ?? w.admin.api).get(`${P}/work-list?q=${encodeURIComponent(q)}&filter=${filter}&scope=aktif`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const unitDiList = (body, unit) => body.orders.flatMap((o) => o.units).find((x) => x.id === unit.id) ?? null;
const catatManual = (unit, status, klien = null, extra = {}) => (klien ?? w.admin.api).post(`${P}/units/${unit.id}/work-progress`, { status, ...extra });
const jejakUx = async () => ({ ...(await efek()), jurnal: await testPrisma.finJournalEntry.count() });

test("K1. unit Dijadwalkan: tindakan 'Buka pekerjaan' (OPEN_WORK); membuka/menyegarkan halaman berkali-kali TIDAK mengubah status, riwayat, stok, Run, atau jurnal", async () => {
  const u = await mkUnit({ received: true }); assert.equal((await jadwalkan(u)).status, 201);
  const sebelum = await jejakUx();
  for (let i = 0; i < 3; i++) { // kembali/refresh = baca ulang saja
    const ad = (await adopsi(u)); assert.equal(ad.adopsi.tindakan.aksi, "OPEN_WORK"); assert.equal(ad.adopsi.tindakan.label, "Buka pekerjaan"); assert.equal(ad.adopsi.kerja.key, "DIJADWALKAN");
    assert.deepEqual(ad.kerjaManual.riwayat, [], "tidak ada catatan manual dari membuka halaman");
    await w.admin.api.get(`${P}/units/${u.id}/ruang-kerja`);
  }
  const li = unitDiList(await workList(u.unitCode), u); assert.ok(li, "unit di daftar kerja"); assert.equal(li.kerja.key, "DIJADWALKAN");
  const ord = (await workList(u.unitCode)).orders[0]; assert.equal(ord.ringkas.tindakan.aksi, "OPEN_WORK"); assert.equal(ord.ringkas.tindakan.label, "Buka pekerjaan");
  assert.deepEqual(await jejakUx(), sebelum, "membuka halaman tidak menulis apa pun");
});

test("K2. tanda manual 'Sudah dikerjakan' TANPA bahan baru (unit Dijadwalkan DAN belum dijadwalkan): hanya satu catatan status; tanpa stok, Run, QC, atau jurnal palsu; sumber = 'Dicatat manual'", async () => {
  for (const jadwal of [true, false]) {
    const u = await mkUnit({ received: true }); if (jadwal) assert.equal((await jadwalkan(u)).status, 201);
    const sebelum = await jejakUx();
    const r = await catatManual(u, "DIKERJAKAN"); assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.dicatat, true);
    const sesudah = await jejakUx();
    assert.deepEqual({ ...sesudah, progres: undefined }, { ...sebelum, progres: undefined }, "hanya catatan status kerja yang bertambah");
    assert.equal(sesudah.progres, sebelum.progres + 1);
    const k = await kerja(u); assert.equal(k.key, "DIKERJAKAN"); assert.equal(k.label, "Sudah dikerjakan"); assert.equal(k.source, "MANUAL"); assert.equal(k.sourceLabel, "Dicatat manual");
    assert.equal(k.tanpaJadwal, !jadwal);
  }
});

test("K3. klik ganda / dua permintaan serentak 'Sudah dikerjakan': tepat SATU catatan; yang kedua tidak menulis", async () => {
  const u = await mkUnit({ received: true });
  const awal = (await adopsi(u)).kerjaManual.terakhirId;
  const [a, b] = await Promise.all([catatManual(u, "DIKERJAKAN", null, { expectedLatestId: awal }), catatManual(u, "DIKERJAKAN", null, { expectedLatestId: awal })]);
  assert.ok([a.status, b.status].every((s) => [200, 201, 409].includes(s)), JSON.stringify([a.body, b.body]));
  assert.ok([a.status, b.status].includes(201), "satu berhasil");
  assert.equal(await testPrisma.productionUnitWorkProgress.count({ where: { unitId: u.id } }), 1, "tepat satu catatan");
  const lagi = await catatManual(u, "DIKERJAKAN"); assert.equal(lagi.status, 200); assert.equal(lagi.body.dicatat, false);
  assert.equal(await testPrisma.productionUnitWorkProgress.count({ where: { unitId: u.id } }), 1);
});

test("K4. KONSISTEN setelah dicatat manual: Ringkasan, daftar kerja + filter, daftar unit + filter, Riwayat, dan Excel sama-sama 'Sudah dikerjakan' dengan sumber 'Dicatat manual'", async () => {
  const u = await mkUnit({ received: true }); assert.equal((await jadwalkan(u)).status, 201);
  assert.equal((await catatManual(u, "DIKERJAKAN", null, { note: "dikerjakan di workshop" })).status, 201);
  const ad = await adopsi(u); assert.equal(ad.adopsi.kerja.key, "DIKERJAKAN"); assert.equal(ad.adopsi.kerja.source, "MANUAL");
  const wl = await workList(u.unitCode, "DIKERJAKAN"); const li = unitDiList(wl, u); assert.ok(li, "ada di filter 'Sudah dikerjakan'"); assert.equal(li.kerja.label, "Sudah dikerjakan"); assert.equal(li.kerja.sourceLabel, "Dicatat manual");
  assert.equal(unitDiList(await workList(u.unitCode, "BELUM_DIJADWALKAN"), u), null); assert.deepEqual(await daftar("DIKERJAKAN"), [u.id]); assert.deepEqual(await daftar("DIJADWALKAN"), []);
  const x = await barisExcel(u); assert.equal(x["Status Kerja (Administratif)"], "Sudah dikerjakan"); assert.equal(x["Sumber Status Kerja"], "Dicatat manual");
  assert.equal(ad.kerjaManual.riwayat.at(-1).label, "Sudah dikerjakan"); assert.equal(ad.kerjaManual.riwayat.at(-1).note, "dikerjakan di workshop");
  const rw = ad.riwayat.find((e) => e.kind === "EVENT_PRODUCTION_STATUS_KERJA_MANUAL"); assert.ok(rw, "catatan manual tampil di Riwayat unit");
  assert.match(rw.label, /dicatat manual oleh [^:]+: Sudah dikerjakan/); assert.match(rw.label, /dicatat manual/); assert.match(rw.label, /bukan dari pemakaian bahan/); assert.ok(!/DIKERJAKAN/.test(rw.label), "label, bukan kode mentah");
});

test("K5. pemakaian bahan aktual membuat status 'Sudah dikerjakan' OTOMATIS (sumber 'Otomatis dari pemakaian bahan') tanpa syarat rencana/jadwal/Meja/Corner/QC; konsisten di daftar, Excel, dan Riwayat", async () => {
  const u = await mkUnit({ received: true }); const m = await mat("KAIN-K5");
  assert.equal((await pakaiBaru(u, m, 1)).status, 201);
  const ad = await adopsi(u); assert.equal(ad.adopsi.kerja.key, "DIKERJAKAN"); assert.equal(ad.adopsi.kerja.source, "PEMAKAIAN_BAHAN"); assert.equal(ad.adopsi.kerja.sourceLabel, "Otomatis dari pemakaian bahan");
  assert.equal(unitDiList(await workList(u.unitCode, "DIKERJAKAN"), u).kerja.sourceLabel, "Otomatis dari pemakaian bahan");
  assert.equal((await barisExcel(u))["Sumber Status Kerja"], "Otomatis dari pemakaian bahan");
  assert.ok(ad.riwayat.some((e) => e.kind === "STATUS_KERJA_OTOMATIS" && e.sumber === "PEMAKAIAN_BAHAN"), "peristiwa otomatis ada di Riwayat");
  assert.equal(await testPrisma.productionRun.count(), 0, "tanpa Run palsu"); assert.equal(await testPrisma.productionRunPlan.count(), 0, "tanpa rencana Meja palsu");
});

test("K6. akun HANYA-LIHAT (Sales): bisa membuka ruang kerja & melihat tindakan 'Buka pekerjaan', tetapi TIDAK bisa mencatat status kerja (403) dan tidak ada yang tertulis", async () => {
  const sales = await createTestUser({ roles: ["SALES"] }); const lihat = makeClient(server.baseUrl, sales.token);
  const u = await mkUnit({ received: true }); assert.equal((await jadwalkan(u)).status, 201);
  const ad = (await lihat.get(`${P}/units/${u.id}/adopsi`)); assert.equal(ad.status, 200); assert.equal(ad.body.adopsi.tindakan.aksi, "OPEN_WORK"); assert.equal(ad.body.izin.statusKerja, false);
  assert.equal((await lihat.get(`${P}/units/${u.id}/ruang-kerja`)).status, 200);
  const sebelum = await jejakUx();
  const tolak = await catatManual(u, "DIKERJAKAN", lihat); assert.equal(tolak.status, 403);
  assert.deepEqual(await jejakUx(), sebelum); assert.equal((await kerja(u)).key, "DIJADWALKAN");
});

test("K7. tidak ada status antara 'Sedang dikerjakan'; nilai manual tetap {Belum dijadwalkan, Dijadwalkan, Sudah dikerjakan, Tertunda, Selesai}", async () => {
  const u = await mkUnit({ received: true });
  const ad = await adopsi(u); assert.deepEqual(ad.kerjaManual.nilaiBoleh.map((n) => n.key), ["BELUM_DIJADWALKAN", "DIJADWALKAN", "DIKERJAKAN", "TERTUNDA", "SELESAI"]);
  assert.ok(!JSON.stringify(ad).includes("Sedang dikerjakan"), "tidak ada status 'Sedang dikerjakan'");
  assert.equal((await catatManual(u, "SEDANG_DIKERJAKAN")).status, 400);
});
