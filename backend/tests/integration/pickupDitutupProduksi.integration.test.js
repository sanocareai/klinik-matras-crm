// PRODUKSI MENANDAI TIBA SEBELUM DRIVER MENUTUP PICKUP — HTTP + DB sungguhan (DB uji terisolasi).
// Dibuktikan: tanpa tutupPickup tetap ditolak (perilaku lama); dengan tutupPickup unit → RECEIVED + catatan penerimaan + job pickup lengkap COMPLETED (catatan jelas) + order ikut sinkron;
// job yang masih memuat unit lain yang belum tiba TIDAK ditutup; sesudah itu driver menyelesaikan job tanpa memundurkan unit yang sudah dikerjakan.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { custodyHooks } from "../../src/services/unitCustodyCommandService.js";
import { CATATAN_PICKUP_DITUTUP } from "../../src/services/pickupDitutupProduksi.js";

let server; let seq = 0; let w;
const hookAsli = custodyHooks.unitReceivedAtWorkshop;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); custodyHooks.unitReceivedAtWorkshop = () => {}; });
test.after(async () => { custodyHooks.unitReceivedAtWorkshop = hookAsli; await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.beforeEach(async () => { await truncateAll(); w = await world(); });

const idem = (tag) => ({ "Idempotency-Key": `pdp-${tag}-${++seq}-0000` });
async function world() {
  const mk = async (role) => { const u = await createTestUser({ roles: [role] }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
  const [admin, lead, sales] = await Promise.all([mk("ADMIN"), mk("PRODUCTION_LEAD"), mk("SALES")]);
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-PDP-${++seq}`, name: "Gudang PDP" } });
  const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-PDP-${++seq}` } });
  return { admin, lead, sales, rcv };
}
// Order Pengambilan, unit masih Menunggu dijemput, job pickup terjadwal (belum ditutup driver). `unitLain` = unit kedua di job yang sama.
async function mkOrder({ unitLain = false, jobStatus = "SCHEDULED" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan PDP ${++seq}`, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `RES-PDP-${++seq}`, value: 1_000_000, category: "LAYANAN", status: "PICKUP", items: { create: [{ layananName: "Service Fondasi", harga: 1_000_000, sortOrder: 1 }] } } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `PDP-${seq}-U1`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP" } });
  const lain = unitLain ? await testPrisma.unit.create({ data: { unitCode: `PDP-${seq}-U2`, orderId: order.id, seq: 2, status: "AWAITING_PICKUP" } }) : null;
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: jobStatus, scheduledDate: new Date() } });
  for (const u of [unit, lain].filter(Boolean)) await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: u.id } });
  return { order, unit, lain, job };
}
const terima = (who, unit, body = {}) => who.api.post(`/api/production/units/${unit.id}/penerimaan-workshop`, { fisikDiterima: true, locationId: w.rcv.id, ...body }, idem("t"));

test("tanpa tutupPickup: unit yang belum dijemput tetap ditolak dan TIDAK ada yang berubah", async () => {
  const k = await mkOrder();
  const r = await terima(w.lead, k.unit);
  assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, "PENERIMAAN_STATUS_UNIT");
  assert.equal((await testPrisma.unit.findUnique({ where: { id: k.unit.id } })).status, "AWAITING_PICKUP");
  assert.equal((await testPrisma.job.findUnique({ where: { id: k.job.id } })).status, "SCHEDULED");
  assert.equal(await testPrisma.unitWorkshopReceipt.count(), 0);
});

test("dengan tutupPickup: unit diterima, job pickup ditutup dengan catatan, order keluar dari Pengambilan, riwayat tercatat; klik ulang = satu catatan", async () => {
  const k = await mkOrder();
  const r = await terima(w.lead, k.unit, { tutupPickup: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.pickup.ditutup, true); assert.deepEqual(r.body.pickup.jobDitutup, [k.job.id]);
  assert.equal((await testPrisma.unit.findUnique({ where: { id: k.unit.id } })).status, "RECEIVED");
  const job = await testPrisma.job.findUnique({ where: { id: k.job.id } });
  assert.equal(job.status, "COMPLETED"); assert.equal(job.proofNote, CATATAN_PICKUP_DITUTUP); assert.equal(job.completedById, w.lead.user.id);
  assert.equal(await testPrisma.unitWorkshopReceipt.count({ where: { unitId: k.unit.id } }), 1);
  assert.notEqual((await testPrisma.order.findUnique({ where: { id: k.order.id } })).status, "PICKUP");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: k.unit.id, eventType: "PICKUP_CLOSED_BY_WORKSHOP" } }), 1);
  const ulang = await terima(w.lead, k.unit, { tutupPickup: true });
  assert.equal(ulang.status, 200, JSON.stringify(ulang.body)); assert.equal(ulang.body.pickup, undefined);
  assert.equal(await testPrisma.unitWorkshopReceipt.count({ where: { unitId: k.unit.id } }), 1);
});

test("job memuat unit lain yang belum tiba: job TETAP terbuka; driver menutupnya kemudian tanpa memundurkan unit yang sudah dikerjakan", async () => {
  const k = await mkOrder({ unitLain: true, jobStatus: "ARRIVED" });
  const r = await terima(w.lead, k.unit, { tutupPickup: true });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.deepEqual(r.body.pickup.jobTetapBuka, [k.job.id]);
  assert.equal((await testPrisma.job.findUnique({ where: { id: k.job.id } })).status, "ARRIVED");
  await testPrisma.unit.update({ where: { id: k.unit.id }, data: { status: "IN_PRODUCTION" } }); // mulai dikerjakan sebelum driver menutup job
  const done = await w.admin.api.post(`/api/armada/jobs/${k.job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Workshop", note: "ok", location: null }, idem("c"));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal((await testPrisma.unit.findUnique({ where: { id: k.unit.id } })).status, "IN_PRODUCTION", "unit yang sudah dikerjakan tidak mundur");
  assert.equal((await testPrisma.unit.findUnique({ where: { id: k.lain.id } })).status, "RECEIVED", "unit lain tetap diterima seperti biasa");
});

test("lokasi bawaan workshop belum diatur: ditolak dan TIDAK ada yang berubah (pickup tidak ditutup tanpa catatan penerimaan)", async () => {
  const k = await mkOrder();
  const r = await terima(w.lead, k.unit, { tutupPickup: true, locationId: undefined });
  assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, "WORKSHOP_DEFAULT_LOCATION_NOT_CONFIGURED");
  assert.equal((await testPrisma.unit.findUnique({ where: { id: k.unit.id } })).status, "AWAITING_PICKUP");
  assert.equal((await testPrisma.job.findUnique({ where: { id: k.job.id } })).status, "SCHEDULED");
  assert.equal(await testPrisma.unitWorkshopReceipt.count(), 0);
});

test("izin: Sales tidak boleh menandai tiba (403), unit tidak berubah", async () => {
  const k = await mkOrder();
  const r = await terima(w.sales, k.unit, { tutupPickup: true });
  assert.equal(r.status, 403);
  assert.equal((await testPrisma.unit.findUnique({ where: { id: k.unit.id } })).status, "AWAITING_PICKUP");
});
