// RENCANA ADMIN — jadwal produksi per unit TANPA Production Run (HTTP + DB sungguhan, DB uji terisolasi, bukan production).
// Dibuktikan: jadwal Admin TIDAK membuat Run/tahap/QC/custody/penerimaan/stok/Material Issue/jurnal/job/outbox/pesan; satu baris per unit (pindah = memperbarui baris yang sama);
// kapasitas meja dihitung bersama rencana V2; revisi basi/klik ganda/kunci idempotensi; undo hanya bila belum ada dampak; aktivasi V2 mengambil alih jadwal (tidak ada dua sumber);
// unit batal/terkirim tidak tampil; PKR belum lengkap ditolak; izin hanya-lihat; kalender mingguan + antrean + riwayat.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { custodyHooks } from "../../src/services/unitCustodyCommandService.js";
import { addDays, mondayOf, todayWib } from "../../src/lib/domain/productionRencanaAdmin.js";

const P = "/api/production"; const V2 = "/api/production-v2";
let server; let seq = 0; let w; const notif = []; const hookAsli = custodyHooks.unitReceivedAtWorkshop;
// Hari kerja = Senin–Sabtu (Minggu libur: Rencana Admin ditolak). H(n) = n hari KERJA dari hari kerja terdekat (Minggu dilewati) supaya tes tidak bergantung hari berjalannya.
const dow = (k) => new Date(`${k}T00:00:00Z`).getUTCDay();
const HARI_INI = (() => { let k = todayWib(); while (dow(k) === 0) k = addDays(k, 1); return k; })();
const H = (n) => { let k = HARI_INI; let c = 0; const step = n >= 0 ? 1 : -1; while (c < Math.abs(n)) { k = addDays(k, step); if (dow(k) !== 0) c += 1; } return k; };

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); custodyHooks.unitReceivedAtWorkshop = (id) => { notif.push(id); }; });
test.after(async () => { custodyHooks.unitReceivedAtWorkshop = hookAsli; await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.beforeEach(async () => { await truncateAll(); notif.length = 0; w = await world(); });

const idem = (tag) => ({ "Idempotency-Key": `ra-${tag}-${++seq}-0000` });
async function world() {
  const mk = async (role) => { const u = await createTestUser({ roles: [role] }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
  const [admin, gudang, sales, lead] = await Promise.all([mk("ADMIN"), mk("WAREHOUSE"), mk("SALES"), mk("PRODUCTION_LEAD")]);
  const wc = await testPrisma.workCenter.create({ data: { code: `WC-RA-${++seq}`, name: "Workshop Utama" } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-RA-${++seq}`, name: "Gudang RA" } });
  const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-RA-${++seq}` } });
  return { admin, gudang, sales, lead, wc, rcv };
}
async function mkOperator() {
  const u = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  await testPrisma.userRole.create({ data: { userId: u.user.id, role: "PRODUCTION_WORKER" } });
  const op = await testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: u.user.id, primaryWorkCenterId: w.wc.id, active: true } });
  return { ...u, op };
}
async function mkUnit({ orderStatus = "PROCESSING", unitStatus = "RECEIVED", pickup = true, received = false, ukuran = "160x200" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan RA ${++seq}`, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `RES-RA-${++seq}`, value: 1_000_000, category: "LAYANAN", status: orderStatus, pickupConfirmedDate: new Date(), items: { create: [{ layananName: "Service Fondasi", harga: 1_000_000, sortOrder: 1 }] } } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `RA-${seq}-U1`, orderId: order.id, seq: 1, status: unitStatus, merk: "King Koil", ukuran } });
  if (pickup) { const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", scheduledDate: new Date(), completedAt: new Date() } }); await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } }); }
  if (received) await testPrisma.unitWorkshopReceipt.create({ data: { unitId: unit.id, seq: 1, locationId: w.rcv.id, receivedById: w.gudang.user.id } });
  return { customer, order, unit };
}
const efek = async () => Object.fromEntries(await Promise.all(["productionRun", "productionOperationRun", "unitStageLog", "qualityInspection", "unitCustodyHandoff", "stockMovement", "materialIssue", "materialReservation", "job", "productionStepEvidence", "productionRunPlan", "unitWorkshopReceipt", "domainOutbox", "finJournalEntry"].map(async (a) => [a, await testPrisma[a].count()])));
async function setFlag(key, unitIds) { const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "rencana admin test" }; await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, ...data }, update: data }); }
const setCohort = async (...ids) => { for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(k, ids.length ? ids : null); };
const jadwalkan = (who, unit, body = {}, headers = idem("jdw")) => who.api.post(`${P}/units/${unit.id}/jadwal`, { productionDate: H(2), stationCode: "TABLE_1", expectedRevision: 0, ...body }, headers);
const minggu = async (who = w.admin, start = HARI_INI) => (await who.api.get(`${P}/rencana/minggu?start=${start}`)).body;
const hari = async (d, who = w.admin) => (await who.api.get(`${P}/rencana/hari?date=${d}`)).body;
const antrean = async (tab, extra = "", who = w.admin) => (await who.api.get(`${P}/rencana/antrean?tab=${tab}${extra}`)).body;

test("R1. unit BELUM diterima workshop dijadwalkan Admin: satu baris jadwal + riwayat; TANPA Run/QC/custody/penerimaan/stok/Material Issue/jurnal/job/outbox/pesan", async () => {
  const k = await mkUnit(); const e0 = await efek();
  const r = await jadwalkan(w.admin, k.unit, { productionDate: H(2), stationCode: "TABLE_2", targetDate: H(4), priority: "HIGH" });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.revision, 1); assert.equal(r.body.kind, "SCHEDULED");
  const e1 = await efek();
  assert.deepEqual(e1, e0, "jadwal Admin tidak menyentuh tabel operasional mana pun");
  assert.equal(notif.length, 0, "tidak ada pesan pelanggan");
  const u = await testPrisma.unit.findUniqueOrThrow({ where: { id: k.unit.id } });
  assert.equal(u.status, "RECEIVED", "status unit tidak berubah"); assert.equal(u.priority, "HIGH"); assert.ok(u.productionDueAt);
  assert.equal(await testPrisma.productionUnitSchedule.count({ where: { unitId: k.unit.id } }), 1);
  const rw = (await w.admin.api.get(`${P}/units/${k.unit.id}/jadwal`)).body;
  assert.equal(rw.events.length, 1); assert.equal(rw.events[0].kind, "SCHEDULED"); assert.equal(rw.events[0].ke.meja, "TABLE_2"); assert.ok(rw.events[0].actor);
  const m = await minggu(); const d = m.days.find((x) => x.date === H(2));
  assert.equal(d.terencana, 1); assert.equal(d.admin, 1); assert.equal(d.v2, 0); assert.equal(d.stations.find((s) => s.code === "TABLE_2").count, 1);
  const item = (await hari(H(2))).stations.find((s) => s.code === "TABLE_2").items[0];
  assert.equal(item.sumber, "ADMIN"); assert.equal(item.diterima, false, "posisi fisik jujur: belum diterima"); assert.ok(!item.perhatian.some((f) => f.code === "BELUM_DITERIMA"), "masih jauh: belum jadi perhatian");
  assert.equal((await jadwalkan(w.admin, k.unit, { productionDate: H(1), stationCode: "TABLE_2", expectedRevision: 1 })).status, 201);
  const dekat = (await hari(H(1))).stations.find((s) => s.code === "TABLE_2").items[0]; assert.ok(dekat.perhatian.some((f) => f.code === "BELUM_DITERIMA"), "H-1 belum diterima ditandai perhatian");
  assert.equal((await minggu()).days.find((x) => x.date === H(1)).perhatian, 1);
  assert.equal(item.prioritas.key, "HIGH"); assert.equal(item.targetSelesai, H(4));
  assert.deepEqual(await efek(), e0, "memindahkan jadwal pun tidak menyentuh tabel operasional");
});

test("R2. unit sudah diterima TANPA V2: tampil di Siap dijadwalkan, lalu Terjadwal; penerimaan tidak dibuat/diubah oleh jadwal", async () => {
  const k = await mkUnit({ received: true });
  const a0 = await antrean("SIAP"); assert.ok(a0.items.some((i) => i.unitId === k.unit.id && i.diterima && i.jalur === "ADMIN"), JSON.stringify(a0.counts));
  assert.equal((await jadwalkan(w.lead, k.unit)).status, 201, "Kepala Produksi (UNIT_ROUTING_WRITE) boleh menjadwalkan");
  assert.equal((await antrean("SIAP")).items.some((i) => i.unitId === k.unit.id), false);
  const t = await antrean("TERJADWAL"); const it = t.items.find((i) => i.unitId === k.unit.id);
  assert.equal(it.jadwal.sumber, "ADMIN"); assert.equal(it.jadwal.tanggal, H(2)); assert.match(it.alasan, /Dijadwalkan/);
  assert.equal(await testPrisma.unitWorkshopReceipt.count(), 1, "penerimaan yang ada tidak digandakan");
  assert.equal(await testPrisma.productionRun.count(), 0);
});

test("R3. antrean menurut tindakan memberi ALASAN konkret: Menunggu unit tiba · Butuh keputusan (order masih Pengambilan padahal diterima; PKR belum lengkap)", async () => {
  const belum = await mkUnit(); const keputusan = await mkUnit({ received: true, orderStatus: "PICKUP" });
  const tiba = await antrean("MENUNGGU_TIBA"); assert.ok(tiba.items.some((i) => i.unitId === belum.unit.id && /dijadwalkan lebih awal|Sudah dijemput|Belum/.test(i.alasan)), JSON.stringify(tiba.items.map((i) => i.alasan)));
  const k = await antrean("KEPUTUSAN"); const it = k.items.find((i) => i.unitId === keputusan.unit.id);
  assert.ok(it, "order Pengambilan + unit diterima = butuh keputusan"); assert.match(it.alasan, /status order masih Pengambilan/); assert.ok(it.tindakanBerikut);
  assert.equal(k.counts.KEPUTUSAN, 1); assert.equal(k.counts.MENUNGGU_TIBA, 1);
  const cari = await antrean("SEMUA", `&q=${encodeURIComponent(belum.unit.unitCode)}`); assert.equal(cari.total, 1, "pencarian kode unit di server");
  const urut = await antrean("SEMUA", "&sort=TERLAMA"); assert.equal(urut.items[0].unitId, belum.unit.id);
});

test("R4. kapasitas JUJUR: 3 unit per meja dihitung bersama rencana V2; meja penuh = 409; pindah hari/meja memperbarui BARIS YANG SAMA (tidak menggandakan unit)", async () => {
  const us = []; for (let i = 0; i < 4; i++) us.push(await mkUnit({ received: true }));
  for (let i = 0; i < 3; i++) assert.equal((await jadwalkan(w.admin, us[i].unit, { productionDate: H(1), stationCode: "TABLE_3" })).status, 201);
  const penuh = await jadwalkan(w.admin, us[3].unit, { productionDate: H(1), stationCode: "TABLE_3" });
  assert.equal(penuh.status, 409); assert.equal(penuh.body.code, "PLAN_STATION_FULL");
  const d = (await minggu()).days.find((x) => x.date === H(1)); assert.equal(d.stations.find((s) => s.code === "TABLE_3").count, 3); assert.equal(d.kapasitas, 12);
  // pindah: baris sama, revisi naik, slot lama longgar
  const pindah = await jadwalkan(w.admin, us[0].unit, { productionDate: H(3), stationCode: "TABLE_4", expectedRevision: 1 });
  assert.equal(pindah.status, 201); assert.equal(pindah.body.kind, "RESCHEDULED"); assert.equal(pindah.body.revision, 2);
  assert.equal(await testPrisma.productionUnitSchedule.count(), 3, "tidak ada baris ganda");
  assert.equal((await jadwalkan(w.admin, us[3].unit, { productionDate: H(1), stationCode: "TABLE_3" })).status, 201, "slot lama kini longgar");
  // revisi basi
  const basi = await jadwalkan(w.admin, us[0].unit, { productionDate: H(2), stationCode: "TABLE_1", expectedRevision: 1 });
  assert.equal(basi.status, 409); assert.equal(basi.body.code, "JADWAL_REVISI_BASI");
  // meja berisi rencana V2 juga dihitung
  const v2 = await mkUnit({ received: true }); const op = await mkOperator(); const lainnya = await mkUnit({ orderStatus: "PROCESSING" }); await setCohort(lainnya.unit.id);
  assert.equal((await w.admin.api.post(`${V2}/plans`, { unitId: v2.unit.id, productionDate: H(5), stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("v2a"))).status, 201);
  const aa = await mkUnit({ received: true }); const bb = await mkUnit({ received: true }); const cc = await mkUnit({ received: true });
  assert.equal((await jadwalkan(w.admin, aa.unit, { productionDate: H(5), stationCode: "TABLE_1" })).status, 201);
  assert.equal((await jadwalkan(w.admin, bb.unit, { productionDate: H(5), stationCode: "TABLE_1" })).status, 201);
  assert.equal((await jadwalkan(w.admin, cc.unit, { productionDate: H(5), stationCode: "TABLE_1" })).body.code, "PLAN_STATION_FULL", "1 V2 + 2 Admin = penuh");
});

test("R5. klik ganda: kunci idempotensi sama = satu perubahan; kunci isian beda ditolak; permintaan serentak = tepat satu menang", async () => {
  const k = await mkUnit({ received: true }); const kunci = { "Idempotency-Key": "ra-ganda-0001-aaaa" };
  const a = await jadwalkan(w.admin, k.unit, {}, kunci); const b = await jadwalkan(w.admin, k.unit, {}, kunci);
  assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(b.body.replayed, true);
  assert.equal((await jadwalkan(w.admin, k.unit, { stationCode: "TABLE_2" }, kunci)).body.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(await testPrisma.productionUnitScheduleEvent.count(), 1);
  const k2 = await mkUnit({ received: true });
  const par = await Promise.all([1, 2, 3].map((i) => jadwalkan(w.admin, k2.unit, { stationCode: "TABLE_2" }, idem(`par${i}`))));
  assert.equal(par.filter((r) => r.status === 201).length, 1, par.map((r) => r.status).join()); assert.equal(par.filter((r) => r.status === 409).length, 2);
  assert.equal(await testPrisma.productionUnitSchedule.count({ where: { unitId: k2.unit.id } }), 1);
});

test("R6. UNDO salah pindah: hanya perubahan TERAKHIR yang belum berubah lagi; mengembalikan tanggal/meja/target; dicatat sebagai UNDONE; ditolak setelah ada perubahan lain", async () => {
  const k = await mkUnit({ received: true });
  await jadwalkan(w.admin, k.unit, { productionDate: H(1), stationCode: "TABLE_1", targetDate: H(3) });
  const pindah = await jadwalkan(w.admin, k.unit, { productionDate: H(2), stationCode: "TABLE_2", expectedRevision: 1, targetDate: H(5) });
  const rw = (await w.admin.api.get(`${P}/units/${k.unit.id}/jadwal`)).body; const ev = rw.events[rw.events.length - 1];
  assert.equal(ev.undoable, true); assert.equal(rw.events[0].undoable, false);
  assert.equal((await w.admin.api.post(`${P}/units/${k.unit.id}/jadwal/undo`, { eventId: rw.events[0].id }, idem("u0"))).status, 409, "bukan perubahan terakhir");
  const undo = await w.admin.api.post(`${P}/units/${k.unit.id}/jadwal/undo`, { eventId: ev.id }, idem("u1"));
  assert.equal(undo.status, 201, JSON.stringify(undo.body)); assert.equal(undo.body.productionDate, H(1)); assert.equal(undo.body.stationCode, "TABLE_1");
  assert.equal(targetKey((await testPrisma.unit.findUniqueOrThrow({ where: { id: k.unit.id } })).productionDueAt), H(3), "target dikembalikan");
  const rw2 = (await w.admin.api.get(`${P}/units/${k.unit.id}/jadwal`)).body; assert.equal(rw2.events.at(-1).kind, "UNDONE"); assert.equal(rw2.events.length, 3, "riwayat tidak dihapus");
  assert.equal((await w.admin.api.post(`${P}/units/${k.unit.id}/jadwal/undo`, { eventId: rw2.events.at(-1).id }, idem("u2"))).status, 409, "undo tidak bisa di-undo lagi");
  // undo penjadwalan pertama = kembali tidak terjadwal
  const k2 = await mkUnit({ received: true }); await jadwalkan(w.admin, k2.unit);
  const e2 = (await w.admin.api.get(`${P}/units/${k2.unit.id}/jadwal`)).body.events[0];
  assert.equal((await w.admin.api.post(`${P}/units/${k2.unit.id}/jadwal/undo`, { eventId: e2.id }, idem("u3"))).status, 201);
  assert.equal((await minggu()).days.reduce((a, d) => a + d.admin, 0), 1, "hanya jadwal k yang tersisa");
  assert.equal(pindah.status, 201);
});
const targetKey = (at) => (at ? new Date(new Date(at).getTime() + 7 * 3600_000).toISOString().slice(0, 10) : null);

test("R7. keluarkan dari jadwal (riwayat tetap); order dibatalkan / unit terkirim TIDAK tampil di kalender dan tidak memakai kapasitas", async () => {
  const a = await mkUnit({ received: true }); const b = await mkUnit({ received: true }); const c = await mkUnit({ received: true });
  for (const k of [a, b, c]) await jadwalkan(w.admin, k.unit, { productionDate: H(1), stationCode: "TABLE_1" });
  const keluar = await w.admin.api.post(`${P}/units/${a.unit.id}/jadwal/keluarkan`, { expectedRevision: 1, note: "ditunda" }, idem("kel")); assert.equal(keluar.status, 201, JSON.stringify(keluar.body));
  assert.equal((await minggu()).days.find((d) => d.date === H(1)).terencana, 2);
  assert.equal((await w.admin.api.post(`${P}/units/${a.unit.id}/jadwal/keluarkan`, { expectedRevision: 2 }, idem("kel2"))).body.code, "JADWAL_TIDAK_AKTIF");
  await testPrisma.order.update({ where: { id: b.order.id }, data: { status: "CANCELLED" } });
  await testPrisma.unit.update({ where: { id: c.unit.id }, data: { status: "DELIVERED" } });
  const d = (await minggu()).days.find((x) => x.date === H(1)); assert.equal(d.terencana, 0, "batal/terkirim tidak tampil");
  const lagi = await mkUnit({ received: true });
  assert.equal((await jadwalkan(w.admin, lagi.unit, { productionDate: H(1), stationCode: "TABLE_1" })).status, 201, "kapasitas meja tidak dipakai unit batal/terkirim");
  assert.equal((await jadwalkan(w.admin, b.unit)).body.code, "JADWAL_UNIT_CANCELLED", "order batal tidak bisa dijadwalkan");
  assert.equal((await jadwalkan(w.admin, c.unit)).body.code, "JADWAL_UNIT_FINISHED");
});

test("R8. kesiapan bahan jujur: tanpa rencana / stok kurang / lengkap — tidak mengubah stok dan tidak memblokir penjadwalan", async () => {
  const k = await mkUnit({ received: true }); const kain = await createTestMaterial({ name: "Kain Uji RA", unit: "METER", itemGroup: "KAIN" });
  await testPrisma.stockMovement.create({ data: { materialId: kain.id, type: "RECEIPT", qty: 10, note: "saldo awal", createdAt: new Date(Date.now() - 5 * 864e5) } });
  await jadwalkan(w.admin, k.unit, { productionDate: HARI_INI, stationCode: "TABLE_1" });
  let it = (await hari(HARI_INI)).stations[0].items[0]; assert.equal(it.bahan.key, "TIDAK_ADA_RENCANA"); assert.ok(it.perhatian.some((f) => f.code === "BAHAN_BELUM_ADA"));
  const e0 = await efek();
  assert.equal((await w.admin.api.put(`${P}/units/${k.unit.id}/material-plan`, { expectedRevision: 0, lines: [{ materialId: kain.id, qty: 25 }] })).status, 200);
  it = (await hari(HARI_INI)).stations[0].items[0]; assert.equal(it.bahan.key, "KURANG"); assert.match(it.bahan.label, /Kain Uji RA/);
  assert.equal((await w.admin.api.put(`${P}/units/${k.unit.id}/material-plan`, { expectedRevision: 1, lines: [{ materialId: kain.id, qty: 4 }] })).status, 200);
  it = (await hari(HARI_INI)).stations[0].items[0]; assert.equal(it.bahan.key, "LENGKAP");
  const e1 = await efek(); assert.equal(e1.stockMovement, e0.stockMovement); assert.equal(e1.materialIssue, 0);
});

test("R9. unit AKTIF V2: tidak bisa dijadwalkan lewat Rencana Admin (409 UNIT_V2_OWNED); rencana V2 tampil di kalender yang sama berlabel V2", async () => {
  const op = await mkOperator(); const v2 = await mkUnit({ received: true }); const lain = await mkUnit(); await setCohort(lain.unit.id);
  assert.equal((await w.admin.api.post(`${V2}/plans`, { unitId: v2.unit.id, productionDate: H(2), stationCode: "TABLE_2", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("v2"))).status, 201);
  const tolak = await jadwalkan(w.admin, v2.unit); assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "UNIT_V2_OWNED");
  const it = (await hari(H(2))).stations.find((s) => s.code === "TABLE_2").items[0];
  assert.equal(it.sumber, "V2"); assert.equal(it.sumberLabel, "Pelaksanaan Meja"); assert.ok(it.v2.runId); assert.ok(it.pic);
  const d = (await minggu()).days.find((x) => x.date === H(2)); assert.equal(d.v2, 1); assert.equal(d.admin, 0);
});

test("R10. AKTIVASI V2 mengambil alih jadwal Admin: baris ADOPTED + event ADOPTED, tidak ada dua jadwal/dua hitungan kapasitas; Run baru hanya karena aktivasi eksplisit", async () => {
  const op = await mkOperator(); const k = await mkUnit({ received: true }); const lain = await mkUnit(); await setCohort(lain.unit.id);
  await jadwalkan(w.admin, k.unit, { productionDate: H(2), stationCode: "TABLE_2" });
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: k.unit.id } }), 0, "sebelum aktivasi: tidak ada Run");
  const akt = await w.admin.api.post(`${V2}/plans`, { unitId: k.unit.id, productionDate: H(3), stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("akt"));
  assert.equal(akt.status, 201, JSON.stringify(akt.body));
  const sch = await testPrisma.productionUnitSchedule.findUniqueOrThrow({ where: { unitId: k.unit.id } });
  assert.equal(sch.status, "ADOPTED"); assert.ok(sch.adoptedPlanId); assert.equal(sch.revision, 2);
  const rw = (await w.admin.api.get(`${P}/units/${k.unit.id}/jadwal`)).body; assert.equal(rw.events.at(-1).kind, "ADOPTED"); assert.equal(rw.events.at(-1).undoable, false);
  const m = await minggu(w.admin, H(2)); assert.equal(m.days.find((d) => d.date === H(2)).terencana, 0, "jadwal Admin lama tidak tampil lagi"); const d3 = (await minggu(w.admin, H(3))).days.find((d) => d.date === H(3)); assert.equal(d3.terencana, 1); assert.equal(d3.v2, 1); assert.equal(d3.admin, 0);
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: k.unit.id } }), 1, "Run hanya karena aktivasi V2 eksplisit");
});

test("R11. PKR belum lengkap ditolak (422) tanpa menulis; tanggal lewat ditolak; target sebelum tanggal ditolak; meja tidak dikenal ditolak", async () => {
  const k = await mkUnit({ received: true }); const e0 = await efek();
  assert.equal((await jadwalkan(w.admin, k.unit, { productionDate: H(-1) })).body.code, "JADWAL_TANGGAL_LEWAT");
  assert.equal((await jadwalkan(w.admin, k.unit, { productionDate: H(3), targetDate: H(1) })).body.code, "JADWAL_TARGET_SEBELUM_TANGGAL");
  assert.equal((await jadwalkan(w.admin, k.unit, { stationCode: "TABLE_9" })).body.code, "JADWAL_MEJA_INVALID");
  assert.equal((await jadwalkan(w.admin, k.unit, { productionDate: "bukan-tanggal" })).body.code, "JADWAL_TANGGAL_INVALID");
  assert.equal((await w.admin.api.post(`${P}/units/${k.unit.id}/jadwal`, { productionDate: H(2) }, {})).body.code, "IDEMPOTENCY_KEY_INVALID");
  assert.deepEqual(await efek(), e0); assert.equal(await testPrisma.productionUnitSchedule.count(), 0);
  await testPrisma.customer.update({ where: { id: k.customer.id }, data: { isInternalStaff: true } });
  assert.equal((await jadwalkan(w.admin, k.unit)).body.code, "JADWAL_INTERNAL_OR_SPAM");
});

test("R12. IZIN: hanya-lihat (Sales/Gudang) boleh membaca kalender+antrean tetapi tidak menjadwalkan/undo/keluarkan (403); izin dilaporkan ke UI", async () => {
  const k = await mkUnit({ received: true }); await jadwalkan(w.admin, k.unit);
  for (const who of [w.sales, w.gudang]) {
    assert.equal((await who.api.get(`${P}/rencana/minggu`)).status, 200); assert.equal((await who.api.get(`${P}/rencana/antrean?tab=SEMUA`)).status, 200);
    assert.equal((await jadwalkan(who, k.unit, { expectedRevision: 1 })).status, 403);
    assert.equal((await who.api.post(`${P}/units/${k.unit.id}/jadwal/keluarkan`, { expectedRevision: 1 }, idem("x"))).status, 403);
    assert.equal((await who.api.post(`${P}/units/${k.unit.id}/jadwal/undo`, { eventId: "00000000-0000-4000-8000-000000000000" }, idem("y"))).status, 403);
  }
  assert.equal((await minggu(w.sales)).izin.jadwalkan, false); assert.equal((await minggu(w.admin)).izin.jadwalkan, true);
  assert.equal(await testPrisma.productionUnitScheduleEvent.count(), 1);
});

test("R13. target selesai + prioritas memakai kolom Unit yang SAMA (satu sumber): hitungan target per hari, perubahan nilai di luar (CAS) ditolak, tidak ada salinan di tabel jadwal", async () => {
  const k = await mkUnit({ received: true });
  await jadwalkan(w.admin, k.unit, { productionDate: H(1), stationCode: "TABLE_1", targetDate: H(3) });
  assert.equal((await minggu(w.admin, H(3))).days.find((d) => d.date === H(3)).targetSelesai, 1);
  // orang lain mengubah target lewat jalur unit yang sama; form Admin yang basi (expectedUnit lama) ditolak
  const lama = (await testPrisma.unit.findUniqueOrThrow({ where: { id: k.unit.id } }));
  await testPrisma.unit.update({ where: { id: k.unit.id }, data: { productionDueAt: new Date(`${H(6)}T03:00:00Z`) } });
  const basi = await jadwalkan(w.admin, k.unit, { productionDate: H(1), stationCode: "TABLE_1", expectedRevision: 1, targetDate: H(2), expectedUnit: { priority: lama.priority, productionDueAt: lama.productionDueAt } });
  assert.equal(basi.status, 409); assert.equal(basi.body.code, "JADWAL_UNIT_BERUBAH");
  const rows = await testPrisma.$queryRawUnsafe("select column_name from information_schema.columns where table_name = 'production_unit_schedules'");
  assert.ok(!rows.some((r) => /target|priority|pic|operator/.test(r.column_name)), "tabel jadwal tidak menyalin target/prioritas/PIC");
});

test("R14. riwayat jadwal append-only di database; Status Produksi/Order Produksi membaca jadwal yang sama", async () => {
  const k = await mkUnit({ received: true }); await jadwalkan(w.admin, k.unit, { productionDate: H(2), stationCode: "TABLE_4" });
  await assert.rejects(testPrisma.productionUnitScheduleEvent.updateMany({ data: { note: "ubah" } }), /append-only/);
  await assert.rejects(testPrisma.productionUnitScheduleEvent.deleteMany({}), /append-only/);
  const wl = (await w.admin.api.get(`${P}/work-list?q=${encodeURIComponent(k.order.orderNumber)}`)).body.orders.find((o) => o.orderId === k.order.id);
  assert.equal(wl.units[0].jadwal?.sumber, "ADMIN"); assert.equal(wl.units[0].jadwal.tanggal, H(2)); assert.equal(wl.units[0].jadwal.meja, "TABLE_4");
  const ad = (await w.admin.api.get(`${P}/units/${k.unit.id}/adopsi`)).body; assert.equal(ad.adopsi.jadwal?.tanggal, H(2));
  assert.equal(mondayOf(H(2)) <= H(2), true);
});

test("R15. EKSPOR Excel memuat Rencana Admin + pelaksanaan V2 pada satu tabel: tanggal, meja, PIC, status rencana, status V2; angka tetap angka; baca-saja (tidak menulis apa pun)", async () => {
  const op = await mkOperator(); const a = await mkUnit({ received: true }); const v2 = await mkUnit({ received: true }); const lain = await mkUnit(); await setCohort(lain.unit.id);
  await jadwalkan(w.admin, a.unit, { productionDate: H(2), stationCode: "TABLE_2", targetDate: H(4), priority: "HIGH" });
  assert.equal((await w.admin.api.post(`${V2}/plans`, { unitId: v2.unit.id, productionDate: H(2), stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("v2x"))).status, 201);
  const e0 = await efek(); const s0 = await testPrisma.productionUnitScheduleEvent.count();
  const r = await w.admin.api.post(`${V2}/rencana/export`, { from: H(2), to: H(2), stations: [], includeUnscheduled: false });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  const kolom = r.body.columns.map((c) => c.key); for (const k of ["tanggal", "meja", "picMeja", "sumberJadwal", "modePelaksanaan", "target"]) assert.ok(kolom.includes(k), `kolom ${k}`);
  const ra = r.body.rows.find((x) => x.unitCode === a.unit.unitCode); const rv = r.body.rows.find((x) => x.unitCode === v2.unit.unitCode);
  assert.ok(ra && rv, "kedua sumber ada pada satu tabel");
  assert.equal(ra.sumberJadwal, "Rencana Admin"); assert.equal(ra.modePelaksanaan, "Hanya jadwal (belum dibuka di Meja)"); assert.equal(ra.tanggal, H(2)); assert.equal(ra.meja, "Meja 2"); assert.equal(ra.target, H(4)); assert.equal(ra.prioritas, "Tinggi"); assert.equal(ra.picMeja, "Belum ada PIC");
  assert.equal(rv.sumberJadwal, "Pelaksanaan Meja"); assert.match(rv.modePelaksanaan, /Berjalan di Meja|Menunggu unit tiba/); assert.equal(rv.tanggal, H(2)); assert.equal(rv.meja, "Meja 1");
  assert.equal(r.body.summary.rencanaAdmin, 1); assert.equal(r.body.summary.pelaksanaanV2, 1);
  assert.equal(typeof ra.no, "number"); assert.equal(typeof ra.urutan, "number", "urutan tetap angka, bukan teks");
  assert.deepEqual(await efek(), e0, "ekspor baca-saja"); assert.equal(await testPrisma.productionUnitScheduleEvent.count(), s0);
  // pencarian per Meja: hanya Meja 2 → hanya unit Admin
  const m2 = await w.admin.api.post(`${V2}/rencana/export`, { from: H(2), to: H(2), stations: ["TABLE_2"], includeUnscheduled: false });
  assert.deepEqual(m2.body.rows.map((x) => x.unitCode), [a.unit.unitCode]);
  // unit batal tidak ikut
  await testPrisma.order.update({ where: { id: a.order.id }, data: { status: "CANCELLED" } });
  assert.equal((await w.admin.api.post(`${V2}/rencana/export`, { from: H(2), to: H(2), stations: [], includeUnscheduled: false })).body.rows.some((x) => x.unitCode === a.unit.unitCode), false);
});

test("R16. integrasi Gudang: jadwal Admin tidak mengubah antrean 'Menunggu dicatat diterima'; penerimaan oleh petugas menghapus tanda 'belum diterima' di kalender TANPA mengubah jadwal atau membuka Run; unit tetap bisa dijadwalkan ulang", async () => {
  const k = await mkUnit(); await jadwalkan(w.admin, k.unit, { productionDate: H(1), stationCode: "TABLE_1" });
  const menunggu = async () => (await w.gudang.api.get(`${P}/penerimaan-workshop/menunggu?q=${encodeURIComponent(k.unit.unitCode)}`)).body.units.some((u) => u.unitId === k.unit.id);
  assert.equal(await menunggu(), true, "jadwal tidak mengeluarkan unit dari antrean Gudang");
  const sebelum = (await hari(H(1))).stations[0].items[0]; assert.equal(sebelum.diterima, false); assert.ok(sebelum.perhatian.some((f) => f.code === "BELUM_DITERIMA"));
  const e0 = await efek();
  const trm = await w.gudang.api.post(`${P}/units/${k.unit.id}/penerimaan-workshop`, { fisikDiterima: true, locationId: w.rcv.id }); assert.equal(trm.status, 201, JSON.stringify(trm.body));
  const e1 = await efek(); assert.equal(e1.unitWorkshopReceipt, e0.unitWorkshopReceipt + 1); assert.equal(e1.productionRun, e0.productionRun, "penerimaan tidak membuka Run"); assert.equal(e1.productionRunPlan, e0.productionRunPlan);
  const sesudah = (await hari(H(1))).stations[0].items[0]; assert.equal(sesudah.diterima, true); assert.ok(!sesudah.perhatian.some((f) => f.code === "BELUM_DITERIMA")); assert.equal(sesudah.revisi, sebelum.revisi, "jadwal tidak berubah oleh penerimaan");
  assert.equal(await menunggu(), false);
  assert.equal((await antrean("TERJADWAL")).items.find((i) => i.unitId === k.unit.id).diterima, true);
  assert.equal((await jadwalkan(w.admin, k.unit, { productionDate: H(3), stationCode: "TABLE_2", expectedRevision: sebelum.revisi })).status, 201, "dijadwalkan ulang setelah diterima");
});

test("R17. KAPASITAS Minggu konsisten: Senin–Sabtu = 72 slot rutin; Minggu libur (kapasitas 0, Rencana Admin ditolak 422); unit di hari Minggu lewat jalur Meja tetap tampil dan dilaporkan TERPISAH dari slot rutin; ekspor menandainya", async () => {
  const mingguDepan = (() => { let k = H(1); while (new Date(`${k}T00:00:00Z`).getUTCDay() !== 0) k = addDays(k, 1); return k; })();
  const k = await mkUnit({ received: true });
  const tolak = await jadwalkan(w.admin, k.unit, { productionDate: mingguDepan, stationCode: "TABLE_1" });
  assert.equal(tolak.status, 422); assert.equal(tolak.body.code, "JADWAL_HARI_LIBUR"); assert.equal(await testPrisma.productionUnitSchedule.count(), 0, "ditolak sebelum menulis");
  // unit lewat jalur Meja dijadwalkan pada hari Minggu (data lama/pengecualian): tampil, tidak dihitung sebagai slot rutin
  const op = await mkOperator(); const v2 = await mkUnit({ received: true }); const lain = await mkUnit(); await setCohort(lain.unit.id);
  assert.equal((await w.admin.api.post(`${V2}/plans`, { unitId: v2.unit.id, productionDate: mingguDepan, stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("v2min"))).status, 201);
  const m = await minggu(w.admin, mingguDepan); const d = m.days.find((x) => x.date === mingguDepan);
  assert.equal(m.kapasitas.totalMinggu, 72); assert.equal(m.ringkasan.slotKerja, 72); assert.equal(m.ringkasan.hariKerja, 6);
  assert.equal(d.hariKerja, false); assert.equal(d.libur, true); assert.equal(d.kapasitas, 0); assert.equal(d.penuh, false); assert.equal(d.terencana, 1);
  assert.ok(d.stations.every((s) => s.capacity === 0), "meja pada hari libur tanpa kapasitas rutin");
  assert.equal(m.ringkasan.terencanaKerja, m.days.filter((x) => x.hariKerja).reduce((a, x) => a + x.terencana, 0)); assert.equal(m.ringkasan.diLuarHariKerja, 1);
  assert.ok(m.days.filter((x) => x.hariKerja).every((x) => x.kapasitas === 12), "Senin–Sabtu 12 slot");
  const h = await hari(mingguDepan); assert.equal(h.libur, true); assert.equal(h.stations.find((s) => s.code === "TABLE_1").items.length, 1, "unit di hari libur tetap tampil");
  const ex = await w.admin.api.post(`${V2}/rencana/export`, { from: mingguDepan, to: mingguDepan, stations: [], includeUnscheduled: false });
  assert.equal(ex.body.rows.find((x) => x.unitCode === v2.unit.unitCode).libur, true); assert.equal(ex.body.summary.diLuarHariKerja, 1);
  // hari kerja biasa tidak terpengaruh
  const senin = addDays(mingguDepan, 1); assert.equal((await jadwalkan(w.admin, k.unit, { productionDate: senin, stationCode: "TABLE_2" })).status, 201);
});
