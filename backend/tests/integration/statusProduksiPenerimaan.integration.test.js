// KANDIDAT GABUNGAN: Status Produksi (daftar kerja + ruang kerja) x Penerimaan Workshop — HTTP + DB sungguhan (DB uji terisolasi; pesan WhatsApp ditangkap).
// Dibuktikan: penerimaan biasa TIDAK membuka Run; daftar kerja, ruang kerja, Gudang, KPI, dan aktivasi V2 berikutnya membaca SATU penerimaan yang sama (tidak ganda);
// koreksi "belum diterima" mengembalikan unit ke antrean di semua tempat; order terkunci Pengambilan tetap dijelaskan; saklar notifikasi OFF/ON tanpa pesan production.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { ujiNotifikasi } from "../../src/services/customerNotifications.js";
import { loadWorkshopTimelines } from "../../src/services/workshopTimelineService.js";
import { loadOrderMilestones } from "../../src/services/orderMilestoneService.js";

const P = "/api/production"; const V2 = "/api/production-v2";
let server; let seq = 0; let w; const pesan = [];
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); ujiNotifikasi.transport = async (m) => { pesan.push(m); }; });
test.after(async () => { ujiNotifikasi.transport = null; ujiNotifikasi.paksaAktif = null; await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.beforeEach(async () => { await truncateAll(); pesan.length = 0; ujiNotifikasi.paksaAktif = null; w = await world(); });

const tick = () => new Promise((r) => setTimeout(r, 120));
const idem = (t) => ({ "Idempotency-Key": `gab-${t}-${++seq}-0000` });
async function setCohort(...ids) { for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) { const d = { enabled: true, scope: "GLOBAL", config: { unitIds: ids }, reason: "gabungan" }; await testPrisma.v2FeatureFlag.upsert({ where: { key: k }, create: { key: k, ...d }, update: d }); } }
async function world() {
  const mk = async (role) => { const u = await createTestUser({ roles: [role] }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
  const [admin, gudang, sales] = await Promise.all([mk("ADMIN"), mk("WAREHOUSE"), mk("SALES")]);
  const wc = await testPrisma.workCenter.create({ data: { code: `WC-GB-${++seq}`, name: "Workshop" } });
  const wh = await testPrisma.warehouse.create({ data: { code: `WH-GB-${++seq}`, name: "Gudang" } });
  const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: wh.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-GB-${++seq}` } });
  const opU = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); await testPrisma.userRole.create({ data: { userId: opU.user.id, role: "PRODUCTION_WORKER" } });
  const op = await testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: opU.user.id, primaryWorkCenterId: wc.id, active: true } });
  return { admin, gudang, sales, wc, rcv, op };
}
async function mkPilot({ locked = true, status = "PICKUP" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan GB ${++seq}`, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `RES-GB-${++seq}`, value: 1_100_000, category: "LAYANAN", status, pickupConfirmedDate: new Date(), ...(locked ? { statusLocked: true, statusOverrideAt: new Date(), statusOverrideNote: "manual" } : {}), items: { create: [{ layananName: "Service Fondasi", harga: 1_100_000, sortOrder: 1 }] } } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `GB-${seq}-U1`, orderId: order.id, seq: 1, status: "RECEIVED", merk: "King Koil", ukuran: "160x200" } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", scheduledDate: new Date(), completedAt: new Date() } }); await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  return { customer, order, unit };
}
const baris = async (k) => (await w.admin.api.get(`${P}/work-list?q=${k.order.orderNumber}`)).body.orders.find((o) => o.orderId === k.order.id);
const terima = (k, b = {}) => w.gudang.api.post(`${P}/units/${k.unit.id}/penerimaan-workshop`, { fisikDiterima: true, locationId: w.rcv.id, ...b });
const jmlRun = () => testPrisma.productionRun.count(); const jmlHandoff = () => testPrisma.unitCustodyHandoff.count();
const kpi = async (u) => { const t = (await loadWorkshopTimelines(testPrisma, [u.id])).get(u.id).timestamps.find((x) => x.key === "receivedAt").at; return t ? new Date(t).getTime() : null; };

test("G1. penerimaan biasa TIDAK membuka Run; daftar kerja, ruang kerja, antrean Gudang, order, dan KPI membaca penerimaan yang sama; koreksi 'belum diterima' membalikkan semuanya", async () => {
  const k = await mkPilot(); const run0 = await jmlRun(); const ho0 = await jmlHandoff();
  let b = await baris(k);
  assert.equal(b.units[0].posisi.key, "SUDAH_DIJEMPUT"); assert.equal(b.ringkas.perhatian.kode, "BELUM_DITERIMA"); assert.equal(b.ringkas.tindakan.aksi, "CONFIRM_ARRIVAL"); assert.equal(b.units[0].alurMeja, null);
  assert.ok((await w.gudang.api.get(`${P}/penerimaan-workshop/menunggu`)).body.units.some((u) => u.unitId === k.unit.id));
  assert.equal((await terima(k)).status, 201);
  assert.equal(await jmlRun(), run0, "tanpa Run"); assert.equal(await jmlHandoff(), ho0, "tanpa serah-terima");
  assert.deepEqual(await Promise.all(["productionOperationRun", "unitStageLog", "qualityInspection", "stockMovement", "job"].map((a) => testPrisma[a].count())), [0, 0, 0, 0, 1]);
  b = await baris(k);
  assert.equal(b.units[0].posisi.key, "DI_WORKSHOP"); assert.equal(b.units[0].alurMeja, null, "Tahap Meja tidak dikarang"); assert.equal(b.statusOrder.label, "Pengambilan"); assert.equal(b.statusOrder.terkunci, true);
  assert.equal(b.ringkas.perhatian.kode, "ORDER_MASIH_PENGAMBILAN", "setelah diterima, penyebab berikutnya (status Sales terkunci) yang dijelaskan");
  const rk = (await w.admin.api.get(`${P}/units/${k.unit.id}/ruang-kerja`)).body; assert.equal(rk.alurMeja, null); assert.equal(rk.perhatian.kode, "ORDER_MASIH_PENGAMBILAN");
  const ad = (await w.admin.api.get(`${P}/units/${k.unit.id}/adopsi`)).body; assert.equal(ad.adopsi.tindakan.aksi, "UBAH_ORDER_DIPROSES"); assert.ok(ad.penerimaan.receivedBy.id === w.gudang.user.id);
  assert.equal((await w.gudang.api.get(`${P}/penerimaan-workshop/menunggu`)).body.units.some((u) => u.unitId === k.unit.id), false);
  assert.equal((await loadOrderMilestones(testPrisma, [{ id: k.order.id, status: "PICKUP" }])).get(k.order.id).key, "DITERIMA_WORKSHOP"); assert.ok(await kpi(k.unit));
  // koreksi: belum diterima fisik
  const kor = await w.admin.api.post(`${P}/units/${k.unit.id}/penerimaan-workshop/koreksi`, { jenis: "NOT_RECEIVED", alasan: "Kasur belum sampai", expectedRevisi: 0 }, idem("k")); assert.equal(kor.status, 201, JSON.stringify(kor.body));
  b = await baris(k); assert.equal(b.units[0].posisi.key, "SUDAH_DIJEMPUT"); assert.equal(b.ringkas.perhatian.kode, "BELUM_DITERIMA"); assert.equal(await kpi(k.unit), null);
  assert.ok((await w.gudang.api.get(`${P}/penerimaan-workshop/menunggu`)).body.units.some((u) => u.unitId === k.unit.id)); assert.equal(await jmlRun(), run0);
});

test("G2. aktivasi V2 sesudah penerimaan: Run ACTIVE, TEPAT satu penerimaan/serah-terima/peristiwa diterima; daftar kerja menampilkan tahap Meja; penerimaan tidak digandakan oleh Terima Unit", async () => {
  const lain = await mkPilot({ locked: false, status: "PROCESSING" }); await setCohort(lain.unit.id);
  const k = await mkPilot({ locked: false, status: "PROCESSING" });
  assert.equal((await terima(k)).status, 201);
  const akt = await w.admin.api.post(`${V2}/plans`, { unitId: k.unit.id, productionDate: "2026-10-22", stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: w.op.id, activateUnit: true }, idem("akt")); assert.equal(akt.status, 201, JSON.stringify(akt.body));
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: k.unit.id } }); assert.equal(run.status, "ACTIVE");
  assert.equal(await testPrisma.unitWorkshopReceipt.count({ where: { unitId: k.unit.id } }), 1); assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: k.unit.id } }), 1);
  assert.equal(await testPrisma.domainOutbox.count({ where: { aggregateId: k.unit.id, eventType: "production.unit.received-workshop" } }), 1);
  const lagi = await w.admin.api.post(`${V2}/units/${k.unit.id}/confirm-arrival`, {}, idem("tiba")); assert.ok(lagi.status >= 400, "tidak ada 'Unit Tiba' kedua");
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: k.unit.id } }), 1);
  const b = await baris(k); assert.equal(b.units[0].alurMeja.status, "ACTIVE"); assert.equal(b.units[0].posisi.key, "DI_WORKSHOP"); assert.equal(b.units[0].tindakan.aksi !== "CONFIRM_ARRIVAL", true);
  assert.equal((await w.gudang.api.post(`${P}/units/${k.unit.id}/penerimaan-workshop`, { fisikDiterima: true, locationId: w.rcv.id })).body.alreadyReceived, true, "klik ulang sesudah aktivasi = idempoten");
  const kor = await w.admin.api.post(`${P}/units/${k.unit.id}/penerimaan-workshop/koreksi`, { jenis: "NOT_RECEIVED", alasan: "coba batal", expectedRevisi: 0 }, idem("k2")); assert.equal(kor.status, 409); assert.equal(kor.body.code, "KOREKSI_PERLU_JALUR_RESMI");
  assert.equal((await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: k.unit.id } })).status, "ACTIVE", "Run tidak dibalik diam-diam");
});

test("G3. saklar notifikasi: OFF = tidak ada pesan; ON = satu pesan faktual (transport uji, tanpa WhatsApp production); production mengabaikan pengait uji", async () => {
  ujiNotifikasi.paksaAktif = false; const a = await mkPilot({ locked: false }); await terima(a); await tick(); assert.equal(pesan.length, 0, "OFF");
  ujiNotifikasi.paksaAktif = true; const b = await mkPilot({ locked: false }); await terima(b); await tick(); await terima(b); await tick();
  assert.equal(pesan.length, 1, "ON: satu pesan, klik ulang tidak mengirim lagi"); assert.match(pesan[0].text, /sudah kami terima di workshop Sano Care/); assert.doesNotMatch(pesan[0].text, /sampai dengan selamat|segera mulai/);
  const lama = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  try { const c = await mkPilot({ locked: false }); await terima(c); await tick(); assert.equal(pesan.length, 1, "NODE_ENV=production: flag asli (OFF) berlaku"); } finally { process.env.NODE_ENV = lama; }
});

test("G4. akun Sales: membaca daftar kerja dan ruang kerja, tidak bisa mencatat penerimaan maupun koreksi; tanpa login ditolak", async () => {
  const k = await mkPilot({ locked: false });
  assert.equal((await w.sales.api.get(`${P}/work-list`)).status, 200); assert.equal((await w.sales.api.get(`${P}/units/${k.unit.id}/ruang-kerja`)).status, 200);
  assert.equal((await w.sales.api.post(`${P}/units/${k.unit.id}/penerimaan-workshop`, { fisikDiterima: true, locationId: w.rcv.id })).status, 403);
  await terima(k); assert.equal((await w.sales.api.post(`${P}/units/${k.unit.id}/penerimaan-workshop/koreksi`, { jenis: "LOCATION", locationId: w.rcv.id, alasan: "x", expectedRevisi: 0 })).status, 403);
  assert.equal((await fetch(server.baseUrl + `${P}/work-list`)).status, 401);
});
