// Kontrak notifikasi "unit sampai bengkel": HANYA command penerimaan workshop yang sah memicunya, SEKALI per transisi (replay tidak mengulang), dan pickup selesai TIDAK memicunya.
// Hook efek samping diganti spy — tidak ada pesan nyata; DELIVERY_NOTIF_AKTIF tetap false (dijaga di tes ini lewat pembacaan sumber).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { custodyHooks } from "../../src/services/unitCustodyCommandService.js";

let server; let seq = 0;
const calls = [];
const originalHook = custodyHooks.unitReceivedAtWorkshop;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); custodyHooks.unitReceivedAtWorkshop = async (unitId) => { calls.push(unitId); }; });
test.after(async () => { custodyHooks.unitReceivedAtWorkshop = originalHook; await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { calls.length = 0; await truncateAll(); });

const key = (v) => ({ "Idempotency-Key": `notif-diterima-${v}-0001` });
async function setCohort(...unitIds) {
  for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
    const data = { enabled: true, scope: "GLOBAL", config: { unitIds }, reason: "notif test" };
    await testPrisma.v2FeatureFlag.upsert({ where: { key: k }, create: { key: k, ...data }, update: data });
  }
}
async function world() {
  const [lead, wh, driver] = await Promise.all([createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["WAREHOUSE"] }), createTestUser({ roles: ["DRIVER"] })]);
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-NT-${++seq}`, name: "Gudang NT" } });
  const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-NT-${++seq}` } });
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  return { lead: c(lead), wh: c(wh), driver: c(driver), rcv };
}
async function pickupDone(w, tag) {
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan NT ${++seq}`, city: "Bandung" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `NT-${++seq}`, value: 1_000_000, category: "LAYANAN" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-NT-${++seq}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP" } });
  const cohort = new Set((await testPrisma.v2FeatureFlag.findUnique({ where: { key: V2_FLAGS.PRODUCTION_READER } }))?.config?.unitIds || []); cohort.add(unit.id); await setCohort(...cohort);
  const route = await testPrisma.route.create({ data: { code: `NT-RTE-${++seq}`, date: new Date("2026-10-01T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, driverId: w.driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-10-01T00:00:00.000Z") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  await w.driver.api.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}-s`));
  await w.driver.api.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${tag}-a`));
  const done = await w.driver.api.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga", note: "ok", location: null }, key(`${tag}-c`));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return { unit, order };
}
const received = (unitId) => testPrisma.domainOutbox.findMany({ where: { eventType: "production.unit.received-workshop", aggregateId: unitId } });
const tick = () => new Promise((r) => setTimeout(r, 50));

test("pickup selesai TIDAK memicu 'unit sampai bengkel' dan tidak membuat event diterima-workshop", async () => {
  const w = await world();
  const { unit } = await pickupDone(w, "p1");
  await tick();
  assert.equal(calls.length, 0, "hook tidak dipanggil saat pickup selesai");
  assert.equal((await received(unit.id)).length, 0);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "RECEIVED", "status tersimpan tetap RECEIVED (tidak diubah)");
});

test("Terima Unit di Workshop (custody diterima): hook dipanggil TEPAT SEKALI; ulangan Idempotency-Key sama tidak memicu lagi; satu event outbox per handoff", async () => {
  const w = await world();
  const { unit } = await pickupDone(w, "p2");
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: unit.id, direction: "INBOUND" } });
  const body = { locationId: w.rcv.id, expectedRevision: handoff.revision };
  const first = await w.wh.api.post(`/api/inventory/unit-custody/${handoff.id}/accept`, body, key("acc"));
  assert.equal(first.status, 200, JSON.stringify(first.body)); await tick();
  assert.deepEqual(calls, [unit.id]);
  const again = await w.wh.api.post(`/api/inventory/unit-custody/${handoff.id}/accept`, body, key("acc"));
  assert.equal(again.status, 200); await tick();
  assert.equal(calls.length, 1, "replay tidak mengirim ulang");
  const ev = await received(unit.id); assert.equal(ev.length, 1); assert.equal(ev[0].payload.basis, "CUSTODY");
  // kunci berbeda untuk handoff yang sama (sudah ACCEPTED) ditolak — tidak ada transisi kedua
  const other = await w.wh.api.post(`/api/inventory/unit-custody/${handoff.id}/accept`, body, key("acc-lain"));
  assert.notEqual(other.status, 200); await tick();
  assert.equal(calls.length, 1); assert.equal((await received(unit.id)).length, 1);
});

test("Terima Unit lewat route Production (confirm-arrival): memicu sekali; penolakan (tanpa handoff) tidak memicu", async () => {
  const w = await world();
  const { unit } = await pickupDone(w, "p3");
  const r = await w.lead.api.post(`/api/production-v2/units/${unit.id}/confirm-arrival`, { locationId: w.rcv.id }, key("arr"));
  assert.equal(r.status, 200, JSON.stringify(r.body)); await tick();
  assert.deepEqual(calls, [unit.id]);
  const dup = await w.lead.api.post(`/api/production-v2/units/${unit.id}/confirm-arrival`, { locationId: w.rcv.id }, key("arr"));
  assert.equal(dup.status, 200); await tick();
  assert.equal(calls.length, 1);
  const ghost = await testPrisma.unit.create({ data: { unitCode: `UNIT-NT-${++seq}`, orderId: (await testPrisma.order.findFirstOrThrow()).id, seq: 2, status: "RECEIVED" } });
  const bad = await w.lead.api.post(`/api/production-v2/units/${ghost.id}/confirm-arrival`, { locationId: w.rcv.id }, key("arr-bad"));
  assert.ok(bad.status >= 400); await tick();
  assert.equal(calls.length, 1, "unit tanpa penerimaan sah tidak memicu");
});

test("kontrak sumber: DELIVERY_NOTIF_AKTIF tetap false; armada.js tidak lagi memanggil notifyUnitReceived; pesan pickup tidak lagi memakai pemicu pickup", () => {
  const cn = fs.readFileSync(new URL("../../src/services/customerNotifications.js", import.meta.url), "utf8");
  assert.match(cn, /const DELIVERY_NOTIF_AKTIF = false;/);
  const arm = fs.readFileSync(new URL("../../src/routes/armada.js", import.meta.url), "utf8");
  assert.doesNotMatch(arm, /\bnotifyUnitReceived\(/);
  assert.match(arm, /owned\.type !== "PICKUP"\) notifyDelivered/);
});
