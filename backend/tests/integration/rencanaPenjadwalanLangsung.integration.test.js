// PENJADWALAN LANGSUNG (seret ke Meja / Pilih meja / beberapa unit) — HTTP + DB sungguhan, DB uji terisolasi, bukan production.
// Dibuktikan: (L1) unit dengan Run LAMA di luar cohort bisa dijadwalkan Admin TANPA menyentuh Run/tahap/riwayat lama dan TANPA penanda drift V1; (L2) unit yang sudah punya jadwal di rencana Meja
// tidak bisa mendapat jadwal Admin kedua (cegah jadwal ganda); (L3) satu antrean "Belum dijadwalkan" (siap + menunggu tiba, label Belum tiba, order beberapa unit); (L4) penempatan BERSAMA beberapa unit:
// semua-atau-tidak-sama-sekali, AUTO, idempoten, revisi basi/unit selesai membatalkan SELURUH batch; (L5) Urungkan batch tidak menimpa perubahan orang lain; (L6) jadwal tidak mengubah status unit
// selesai/batal dan tidak membuat Run/QC/penerimaan/stok/Material Issue; (L7) kapasitas bersama + status kerja Dijadwalkan + Riwayat + Excel dari sumber yang sama.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { addDays, todayWib } from "../../src/lib/domain/productionRencanaAdmin.js";
import { buildRencanaExport } from "../../src/services/productionRencanaExportService.js";
import { normalizeExportQuery } from "../../src/lib/domain/productionRencanaExport.js";
import { BOARD_DEFAULTS } from "../../src/lib/domain/productionBoard.js";

const P = "/api/production";
let server; let seq = 0; let w;

const dow = (k) => new Date(`${k}T00:00:00Z`).getUTCDay();
const HARI_INI = (() => { let k = todayWib(); while (dow(k) === 0) k = addDays(k, 1); return k; })();
const H = (n) => { let k = HARI_INI; let c = 0; const step = n >= 0 ? 1 : -1; while (c < Math.abs(n)) { k = addDays(k, step); if (dow(k) !== 0) c += 1; } return k; };

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.beforeEach(async () => { await truncateAll(); w = await world(); });

const idem = (tag) => ({ "Idempotency-Key": `pl-${tag}-${++seq}-0000` });
async function world() {
  const mk = async (role) => { const u = await createTestUser({ roles: [role] }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
  const [admin, sales, lead] = await Promise.all([mk("ADMIN"), mk("SALES"), mk("PRODUCTION_LEAD")]);
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-PL-${++seq}`, name: "Gudang PL" } });
  const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-PL-${++seq}` } });
  return { admin, sales, lead, rcv };
}
// Satu order dengan `jumlah` unit (order beberapa unit).
async function mkOrder({ jumlah = 1, orderStatus = "PROCESSING", unitStatus = "RECEIVED", received = false } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan PL ${++seq}`, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `RES-PL-${++seq}`, value: 1_000_000 * jumlah, category: "LAYANAN", status: orderStatus, pickupConfirmedDate: new Date(), items: { create: [{ layananName: "Service Fondasi", harga: 1_000_000, sortOrder: 1 }] } } });
  const units = [];
  for (let i = 1; i <= jumlah; i += 1) {
    const unit = await testPrisma.unit.create({ data: { unitCode: `${order.orderNumber}-U${i}`, orderId: order.id, seq: i, status: unitStatus, merk: "King Koil", ukuran: "160x200" } });
    const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", scheduledDate: new Date(), completedAt: new Date() } }); await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
    if (received) await testPrisma.unitWorkshopReceipt.create({ data: { unitId: unit.id, seq: i, locationId: w.rcv.id, receivedById: w.admin.user.id } });
    units.push(unit);
  }
  return { order, customer, units };
}
const mkUnit = async (o = {}) => (await mkOrder({ ...o, jumlah: 1 })).units[0];
const efek = async () => Object.fromEntries(await Promise.all(["productionRun", "productionOperationRun", "unitStageLog", "qualityInspection", "unitCustodyHandoff", "stockMovement", "materialIssue", "materialReservation", "productionStepEvidence", "productionRunPlan", "unitWorkshopReceipt", "domainOutbox", "finJournalEntry"].map(async (a) => [a, await testPrisma[a].count()])));
const jadwalkan = (who, unit, body = {}, headers = idem("jdw")) => who.api.post(`${P}/units/${unit.id}/jadwal`, { productionDate: H(2), stationCode: "TABLE_1", expectedRevision: 0, ...body }, headers);
const batch = (who, units, body = {}, headers = idem("jb")) => who.api.post(`${P}/rencana/jadwal-batch`, { productionDate: H(2), stationCode: "TABLE_2", units: units.map((u) => ({ unitId: u.id, expectedRevision: 0 })), ...body }, headers);
const antrean = async (tab, extra = "") => (await w.admin.api.get(`${P}/rencana/antrean?tab=${tab}&pageSize=100${extra}`)).body;
const hari = async (d) => (await w.admin.api.get(`${P}/rencana/hari?date=${d}`)).body;
const adopsi = async (unit) => (await w.admin.api.get(`${P}/units/${unit.id}/adopsi`)).body;
const daftar = async (filter) => (await w.admin.api.get(`${P}/work-orders?statusKerja=${filter}&pageSize=50`)).body.units.map((u) => u.id);
const driftCount = (unit) => testPrisma.activityEvent.count({ where: { entityId: unit.id, eventType: "PRODUCTION_V1_WRITE_ON_V2_RUN" } });

test("L1. unit dengan Run LAMA di luar cohort: tampil di antrean (bukan Butuh keputusan), bisa dijadwalkan, dipindah, diurungkan — Run/tahap/riwayat lama utuh, TANPA penanda drift V1", async () => {
  const u = await mkUnit({ received: true });
  const run = await testPrisma.productionRun.create({ data: { unitId: u.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS" } });
  const it = (await antrean("BELUM")).items.find((x) => x.unitId === u.id);
  assert.ok(it, "unit lama ada di antrean Belum dijadwalkan"); assert.equal(it.perluKeputusan, false); assert.equal(it.jalur, "ADMIN");
  assert.equal((await antrean("KEPUTUSAN")).items.some((x) => x.unitId === u.id), false, "tidak lagi dilempar ke Butuh keputusan hanya karena Run lama");
  const e0 = await efek(); const runAwal = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } });
  const r = await jadwalkan(w.admin, u, { productionDate: H(1), stationCode: "TABLE_3" }); assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(await efek(), e0, "jadwal tidak menyentuh tabel operasional (Run, tahap, QC, penerimaan, stok, Material Issue, jurnal)");
  assert.deepEqual(await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } }), runAwal, "Run lama persis sama (status, fase, revisi, updatedAt)");
  assert.equal(await driftCount(u), 0, "menjadwalkan bukan tulisan V1 pada Run: tidak ada penanda drift yang memblokir command V2 kelak");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: u.id } })).status, "RECEIVED");
  const ad = await adopsi(u); assert.equal(ad.adopsi.kerja.key, "DIJADWALKAN"); assert.equal(ad.adopsi.jadwal.sumber, "ADMIN"); assert.deepEqual(await daftar("DIJADWALKAN"), [u.id]);
  const pindah = await jadwalkan(w.admin, u, { productionDate: H(3), stationCode: "TABLE_4", expectedRevision: 1 }); assert.equal(pindah.status, 201);
  const un = await w.admin.api.post(`${P}/units/${u.id}/jadwal/undo`, { eventId: pindah.body.eventId }, idem("undo")); assert.equal(un.status, 201, JSON.stringify(un.body));
  const rw = (await w.admin.api.get(`${P}/units/${u.id}/jadwal`)).body; assert.deepEqual(rw.events.map((e) => e.kind), ["SCHEDULED", "RESCHEDULED", "UNDONE"]);
  assert.equal(await driftCount(u), 0);
});

test("L2. unit yang SUDAH punya jadwal bertanggal di rencana Meja tidak mendapat jadwal Admin kedua (409 JADWAL_SUDAH_DI_RENCANA_MEJA); tanpa efek", async () => {
  const u = await mkUnit({ received: true });
  const run = await testPrisma.productionRun.create({ data: { unitId: u.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS" } });
  await testPrisma.productionRunPlan.create({ data: { runId: run.id, status: "PLANNED", productionDate: new Date(`${H(1)}T00:00:00.000Z`), stationCode: "TABLE_1" } });
  const it = (await antrean("TERJADWAL")).items.find((x) => x.unitId === u.id); assert.ok(it); assert.equal(it.jalur, "V2", "kartu tidak bisa diseret: jadwalnya milik rencana Meja");
  const e0 = await efek(); const r = await jadwalkan(w.admin, u, { productionDate: H(2) });
  assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, "JADWAL_SUDAH_DI_RENCANA_MEJA"); assert.match(r.body.error, /Papan Meja/);
  assert.equal(await testPrisma.productionUnitSchedule.count({ where: { unitId: u.id } }), 0); assert.deepEqual(await efek(), e0);
});

test("L3. SATU antrean 'Belum dijadwalkan' = siap + menunggu tiba (label), order beberapa unit bernomor, saudara siap tersedia; Terjadwal/Keputusan terpisah", async () => {
  const siap = await mkUnit({ received: true }); const tiba = await mkUnit({ received: false });
  const o3 = await mkOrder({ jumlah: 3, received: true }); const keputusan = await mkUnit({ received: true, orderStatus: "PICKUP" });
  const a = await antrean("BELUM"); const ids = a.items.map((x) => x.unitId);
  assert.ok(ids.includes(siap.id) && ids.includes(tiba.id), "unit belum tiba ikut antrean yang sama"); assert.equal(ids.includes(keputusan.id), false, "unit dengan hambatan nyata tidak di antrean ini");
  assert.equal(a.items.find((x) => x.unitId === tiba.id).diterima, false); assert.equal(a.items.find((x) => x.unitId === siap.id).diterima, true);
  assert.equal(a.counts.BELUM, a.counts.SIAP + a.counts.MENUNGGU_TIBA); assert.equal(a.counts.BELUM, 5, JSON.stringify(a.counts));
  const t2 = a.items.find((x) => x.unitId === o3.units[1].id);
  assert.equal(t2.jumlahUnitOrder, 3); assert.equal(t2.unitKe, 2); assert.deepEqual(t2.saudaraSiap.map((s) => s.unitId).sort(), [o3.units[0].id, o3.units[2].id].sort());
  assert.ok(t2.saudaraSiap.every((s) => s.revisiJadwal === 0 && s.unitCas && "priority" in s.unitCas), "snapshot saudara cukup untuk menjadwalkan bersama tanpa menimpa perubahan orang lain");
  assert.equal(a.items.find((x) => x.unitId === siap.id).jumlahUnitOrder, 1);
  assert.equal((await antrean("SIAP")).items.some((x) => x.unitId === tiba.id), false, "penyaring lama tetap bekerja");
  assert.equal((await jadwalkan(w.admin, siap)).status, 201);
  assert.equal((await antrean("BELUM")).items.some((x) => x.unitId === siap.id), false); assert.ok((await antrean("TERJADWAL")).items.some((x) => x.unitId === siap.id));
  assert.ok((await antrean("KEPUTUSAN")).items.some((x) => x.unitId === keputusan.id));
  // unit order yang sama: unit dijadwalkan tidak lagi disarankan sebagai saudara siap
  assert.equal((await jadwalkan(w.admin, o3.units[0])).status, 201);
  assert.deepEqual((await antrean("BELUM")).items.find((x) => x.unitId === o3.units[1].id).saudaraSiap.map((s) => s.unitId), [o3.units[2].id]);
});

test("L4. batch: tiga unit satu order ditempatkan BERSAMA di satu meja; kapasitas kurang = tidak ada yang tersimpan (dengan penjelasan); AUTO memilih meja yang muat semua; idempoten", async () => {
  const o = await mkOrder({ jumlah: 3, received: true }); const e0 = await efek();
  const ok = await batch(w.admin, o.units, { stationCode: "TABLE_2" }, { "Idempotency-Key": "pl-batch-ok-0001" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.stationCode, "TABLE_2"); assert.equal(ok.body.hasil.length, 3); assert.ok(ok.body.hasil.every((h) => h.eventId));
  assert.deepEqual(await efek(), e0, "batch pun hanya menulis jadwal");
  const m = await hari(H(2)); assert.equal(m.stations.find((s) => s.code === "TABLE_2").items.length, 3);
  const ulang = await batch(w.admin, o.units, { stationCode: "TABLE_2" }, { "Idempotency-Key": "pl-batch-ok-0001" });
  assert.equal(ulang.status, 200, JSON.stringify(ulang.body)); assert.equal(ulang.body.replayed, true); assert.equal(await testPrisma.productionUnitSchedule.count(), 3, "klik ganda/ulang tidak menggandakan");
  assert.equal((await batch(w.admin, o.units, { stationCode: "TABLE_3" }, { "Idempotency-Key": "pl-batch-ok-0001" })).status, 409, "kunci sama untuk isian berbeda ditolak");
  // kapasitas: Meja 2 penuh (3/3) → dua unit baru ditolak seluruhnya
  const o2 = await mkOrder({ jumlah: 2, received: true });
  const penuh = await batch(w.admin, o2.units, { stationCode: "TABLE_2" }); assert.equal(penuh.status, 409, JSON.stringify(penuh.body)); assert.equal(penuh.body.code, "PLAN_STATION_FULL");
  assert.match(penuh.body.error, /hanya punya 0 tempat kosong/); assert.match(penuh.body.error, /Tidak ada yang disimpan/);
  assert.equal(await testPrisma.productionUnitSchedule.count(), 3, "tidak ada yang setengah tersimpan");
  // Meja 1 punya 2 tempat saja → tiga unit tidak muat; AUTO memilih meja yang muat semuanya
  const o3 = await mkOrder({ jumlah: 3, received: true }); await jadwalkan(w.admin, (await mkUnit({ received: true })), { stationCode: "TABLE_1" });
  const kurang = await batch(w.admin, o3.units, { stationCode: "TABLE_1" }); assert.equal(kurang.status, 409, JSON.stringify(kurang.body)); assert.match(kurang.body.error, /Meja 1 hanya punya 2 tempat kosong.*3 unit dipilih/);
  const auto = await batch(w.admin, o3.units, { stationCode: "AUTO" }); assert.equal(auto.status, 201, JSON.stringify(auto.body)); assert.equal(auto.body.stationCode, "TABLE_3", "Meja 1 sisa 2 (kurang), Meja 2 penuh → Meja 3");
  assert.equal(await testPrisma.productionUnitSchedule.count(), 7);
});

test("L4b. batch: Meja hanya punya sisa kurang dari jumlah unit → tolak semua; AUTO melewati meja yang tidak muat; AUTO tanpa meja yang muat = tolak dengan sisa per meja", async () => {
  const pengisi = []; for (let i = 0; i < 2; i += 1) { const u = await mkUnit({ received: true }); pengisi.push(u); assert.equal((await jadwalkan(w.admin, u, { stationCode: "TABLE_1" })).status, 201); } // Meja 1: sisa 1
  const o = await mkOrder({ jumlah: 2, received: true });
  const t = await batch(w.admin, o.units, { stationCode: "TABLE_1" }); assert.equal(t.status, 409, JSON.stringify(t.body)); assert.match(t.body.error, /Meja 1 hanya punya 1 tempat kosong.*2 unit dipilih/); assert.equal(await testPrisma.productionUnitSchedule.count(), 2);
  const auto = await batch(w.admin, o.units, { stationCode: "AUTO" }); assert.equal(auto.status, 201, JSON.stringify(auto.body)); assert.equal(auto.body.stationCode, "TABLE_2", "AUTO melewati Meja 1 (sisa 1) → Meja 2 muat 2 unit");
  // semua meja tersisa < 4: AUTO dengan 4 unit ditolak dengan rincian sisa
  const o4 = await mkOrder({ jumlah: 4, received: true }); const penuh = await batch(w.admin, o4.units, { stationCode: "AUTO" });
  assert.equal(penuh.status, 409, JSON.stringify(penuh.body)); assert.match(penuh.body.error, /Tidak ada satu meja dengan 4 tempat kosong/); assert.match(penuh.body.error, /Meja 1: 1/); assert.equal(penuh.body.detail.butuh, 4);
  assert.equal(await testPrisma.productionUnitSchedule.count(), 4);
});

test("L4c. batch ATOMIK: satu unit ditolak (revisi basi / unit selesai / Minggu / hari lewat / bukan unit) → seluruh batch batal; pesan menyebut unit penyebab", async () => {
  const o = await mkOrder({ jumlah: 3, received: true }); const e0 = await efek();
  await jadwalkan(w.admin, o.units[1], { stationCode: "TABLE_4" }); // revisi unit 2 sekarang 1; klien memegang 0 → basi
  const basi = await batch(w.admin, o.units, { stationCode: "TABLE_2" }); assert.equal(basi.status, 409, JSON.stringify(basi.body)); assert.equal(basi.body.code, "JADWAL_REVISI_BASI"); assert.match(basi.body.error, new RegExp(o.units[1].unitCode)); assert.match(basi.body.error, /Tidak ada unit yang disimpan/);
  assert.equal(await testPrisma.productionUnitSchedule.count(), 1, "unit 1 dan 3 TIDAK tersimpan walau diproses lebih dulu");
  await testPrisma.unit.update({ where: { id: o.units[2].id }, data: { status: "READY_FOR_DELIVERY" } });
  const sel = await batch(w.admin, [o.units[0], o.units[2]], { stationCode: "TABLE_2" }); assert.equal(sel.status, 422, JSON.stringify(sel.body)); assert.equal(sel.body.code, "JADWAL_UNIT_FINISHED"); assert.equal(await testPrisma.productionUnitSchedule.count(), 1);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: o.units[2].id } })).status, "READY_FOR_DELIVERY", "unit selesai tidak mundur status karena penjadwalan");
  let minggu = H(1); while (dow(minggu) !== 0) minggu = addDays(minggu, 1);
  assert.equal((await batch(w.admin, [o.units[0]], { productionDate: minggu })).status, 422); assert.equal((await batch(w.admin, [o.units[0]], { productionDate: addDays(HARI_INI, -1) })).status, 422);
  assert.equal((await batch(w.admin, [{ id: "00000000-0000-4000-8000-000000000000" }])).status, 404); assert.equal((await batch(w.admin, [])).status, 400);
  assert.equal((await batch(w.admin, [o.units[0], o.units[0]])).status, 400, "unit ganda");
  assert.deepEqual({ ...(await efek()), productionRunPlan: 0 }, { ...e0, productionRunPlan: 0 });
});

test("L5. Urungkan batch: semua atau tidak sama sekali; ditolak bila salah satu sudah diubah orang lain (perubahan orang lain TIDAK ditimpa)", async () => {
  const o = await mkOrder({ jumlah: 3, received: true });
  const b = await batch(w.admin, o.units, { stationCode: "TABLE_2" }); assert.equal(b.status, 201);
  const items = b.body.hasil.map((h) => ({ unitId: h.unitId, eventId: h.eventId }));
  // orang lain memindahkan unit 2 sesudah batch
  const lain = await jadwalkan(w.lead, o.units[1], { productionDate: H(3), stationCode: "TABLE_4", expectedRevision: 1 }); assert.equal(lain.status, 201);
  const gagal = await w.admin.api.post(`${P}/rencana/jadwal-batch/undo`, { items }, idem("ub")); assert.equal(gagal.status, 409, JSON.stringify(gagal.body)); assert.equal(gagal.body.code, "JADWAL_UNDO_TIDAK_BISA"); assert.match(gagal.body.error, new RegExp(o.units[1].unitCode)); assert.match(gagal.body.error, /Tidak ada perubahan yang diurungkan/);
  const sch = await testPrisma.productionUnitSchedule.findMany({ where: { unitId: { in: o.units.map((u) => u.id) } }, orderBy: { revision: "asc" } });
  assert.equal(sch.filter((s) => s.stationCode === "TABLE_2").length, 2, "unit 1 dan 3 tetap di Meja 2 (urung dibatalkan seluruhnya)"); assert.ok(sch.some((s) => s.stationCode === "TABLE_4"), "perubahan orang lain utuh");
  // batch lain tanpa campur tangan → bisa diurungkan seluruhnya
  const o2 = await mkOrder({ jumlah: 2, received: true }); const b2 = await batch(w.admin, o2.units, { stationCode: "TABLE_3" });
  const ok = await w.admin.api.post(`${P}/rencana/jadwal-batch/undo`, { items: b2.body.hasil.map((h) => ({ unitId: h.unitId, eventId: h.eventId })) }, { "Idempotency-Key": "pl-undo-ok-0001" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(await testPrisma.productionUnitSchedule.count({ where: { unitId: { in: o2.units.map((u) => u.id) }, status: "ACTIVE" } }), 0, "kembali belum dijadwalkan");
  assert.equal((await antrean("BELUM")).items.filter((x) => o2.units.some((u) => u.id === x.unitId)).length, 2);
});

test("L6. izin: hanya-lihat (Sales) tidak bisa menjadwalkan/batch/undo (403, tanpa efek); batas jumlah unit; kunci wajib", async () => {
  const o = await mkOrder({ jumlah: 2, received: true });
  assert.equal((await batch(w.sales, o.units)).status, 403); assert.equal((await w.sales.api.post(`${P}/rencana/jadwal-batch/undo`, { items: [{ unitId: o.units[0].id, eventId: "x" }] }, idem("s"))).status, 403);
  assert.equal(await testPrisma.productionUnitSchedule.count(), 0);
  assert.equal((await w.admin.api.post(`${P}/rencana/jadwal-batch`, { productionDate: H(1), stationCode: "TABLE_1", units: o.units.map((u) => ({ unitId: u.id, expectedRevision: 0 })) })).status, 400, "Idempotency-Key wajib");
  const banyak = Array.from({ length: 21 }, (_, i) => ({ unitId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, expectedRevision: 0 }));
  assert.equal((await w.admin.api.post(`${P}/rencana/jadwal-batch`, { productionDate: H(1), stationCode: "TABLE_1", units: banyak }, idem("b"))).status, 400, "maks. 20 unit");
});

test("L7. satu sumber: kapasitas hari/meja, kalender, daftar+filter status kerja, drawer (adopsi), Riwayat unit, dan Excel Rencana membaca jadwal Admin yang sama; unit belum tiba berlabel dan bisa direncanakan", async () => {
  const tiba = await mkUnit({ received: false }); const siap = await mkUnit({ received: true });
  assert.equal((await jadwalkan(w.admin, tiba, { stationCode: "TABLE_1" })).status, 201, "unit belum tiba boleh direncanakan"); assert.equal((await jadwalkan(w.admin, siap, { stationCode: "TABLE_1" })).status, 201);
  const m = (await w.admin.api.get(`${P}/rencana/minggu?start=${H(2)}`)).body.days.find((d) => d.date === H(2));
  assert.equal(m.terencana, 2); assert.equal(m.stations.find((s) => s.code === "TABLE_1").count, 2); assert.equal(m.stations.find((s) => s.code === "TABLE_1").capacity, 3);
  const dayItems = (await hari(H(2))).stations.find((s) => s.code === "TABLE_1").items; assert.deepEqual(dayItems.map((x) => x.unitId).sort(), [tiba.id, siap.id].sort()); assert.equal(dayItems.find((x) => x.unitId === tiba.id).diterima, false);
  assert.deepEqual((await daftar("DIJADWALKAN")).sort(), [tiba.id, siap.id].sort());
  for (const u of [tiba, siap]) { const ad = await adopsi(u); assert.equal(ad.adopsi.kerja.key, "DIJADWALKAN"); assert.equal(ad.adopsi.jadwal.tanggal, H(2)); assert.equal(ad.adopsi.jadwal.meja, "TABLE_1"); assert.ok(ad.adopsi.posisi, "posisi fisik tetap jujur"); }
  assert.equal((await adopsi(tiba)).adopsi.posisi.key !== "DI_WORKSHOP", true, "penjadwalan tidak menyatakan barang diterima");
  assert.ok(!(await adopsi(tiba)).riwayat.some((e) => e.kind === "STATUS_KERJA_OTOMATIS"), "tidak menyatakan pekerjaan dilakukan");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: tiba.id, eventType: "PRODUCTION_ADMIN_SCHEDULE_SET" } }), 1, "Riwayat: satu catatan aktivitas");
  const q = normalizeExportQuery({ from: H(0), to: H(5), stations: [], includeUnscheduled: true }, { today: HARI_INI, stations: BOARD_DEFAULTS.stations });
  const ex = await buildRencanaExport(testPrisma, { cohortUnitIds: [], query: q, canIncludeValue: false });
  for (const u of [tiba, siap]) { const r = ex.rows.find((x) => x.unitCode === u.unitCode); assert.ok(r, u.unitCode); assert.equal(r.sumberJadwal, "Rencana Admin"); assert.equal(r.tanggal, H(2)); assert.equal(r.meja !== "Belum Dijadwalkan", true); }
  // batch mengisi meja sisa → kapasitas bersama dihitung (Meja 1 sisa 1: dua unit batal, satu unit boleh)
  const o = await mkOrder({ jumlah: 2, received: true }); const tolak = await batch(w.admin, o.units, { productionDate: H(2), stationCode: "TABLE_1" }); assert.equal(tolak.status, 409);
  const satu = await batch(w.admin, [o.units[0]], { productionDate: H(2), stationCode: "TABLE_1" }); assert.equal(satu.status, 201);
  assert.equal((await jadwalkan(w.admin, o.units[1], { productionDate: H(2), stationCode: "TABLE_1" })).status, 409, "jalur satu unit memakai kapasitas yang sama");
});
