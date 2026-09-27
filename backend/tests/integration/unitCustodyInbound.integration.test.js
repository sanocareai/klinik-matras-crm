import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { offerUnitCustody } from "../../src/services/unitCustodyCommandService.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

let server;
let seq = 0;

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (value) => ({ "Idempotency-Key": `custody-test-${value}-0001` });

async function setWriter({ enabled, unitIds }) {
  const data = { enabled, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "custody test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: V2_FLAGS.PRODUCTION_WRITER }, create: { key: V2_FLAGS.PRODUCTION_WRITER, ...data }, update: data });
}

async function world() {
  const [driver, wh1, wh2] = await Promise.all([
    createTestUser({ roles: ["DRIVER"] }), createTestUser({ roles: ["WAREHOUSE"] }), createTestUser({ roles: ["WAREHOUSE"] }),
  ]);
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Custody" } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-${++seq}`, name: "Gudang Tes" } });
  const loc = (zone, locationType, extra = {}) => testPrisma.storageLocation.create({
    data: { warehouseId: warehouse.id, zone, locationType, code: `${zone}-${++seq}`, ...extra },
  });
  const locations = {
    receiving: await loc("RCV", "RECEIVING_AREA"),
    dispatch: await loc("DSP", "DISPATCH_AREA"),
    returnArea: await loc("RET", "RETURN_AREA"),
    inactive: await loc("OLD", "RECEIVING_AREA", { active: false }),
  };
  return {
    driver: { ...driver, api: makeClient(server.baseUrl, driver.token) },
    wh1: { ...wh1, api: makeClient(server.baseUrl, wh1.token) },
    wh2: { ...wh2, api: makeClient(server.baseUrl, wh2.token) },
    customer, locations,
  };
}

async function unitWithJob(w, { type = "PICKUP", unitStatus = type === "PICKUP" ? "AWAITING_PICKUP" : "READY_FOR_DELIVERY" } = {}) {
  const order = await testPrisma.order.create({ data: { customerId: w.customer.id, orderNumber: `CUS-${++seq}`, value: 1000, category: "LAYANAN" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-CUS-${++seq}`, orderId: order.id, seq: 1, status: unitStatus } });
  const route = await testPrisma.route.create({
    data: { code: `CUS-RTE-${++seq}`, date: new Date("2026-09-28T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id },
  });
  const job = await testPrisma.job.create({
    data: { type, orderId: order.id, routeId: route.id, driverId: w.driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-09-28T00:00:00.000Z") },
  });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  return { order, unit, route, job };
}

async function completePickup(w, f, tag = "pickup") {
  const start = await w.driver.api.post(`/api/armada/jobs/${f.job.id}/start`, {}, key(`${tag}-start`));
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const arrive = await w.driver.api.post(`/api/armada/jobs/${f.job.id}/arrive`, { location: null }, key(`${tag}-arrive`));
  assert.equal(arrive.status, 200, JSON.stringify(arrive.body));
  return w.driver.api.post(`/api/armada/jobs/${f.job.id}/complete`, {
    proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga Rumah", note: "Unit diserahkan", location: null,
  }, key(`${tag}-complete`));
}

const counts = async () => ({
  handoffs: await testPrisma.unitCustodyHandoff.count(),
  commands: await testPrisma.v2Command.count({ where: { domain: "WAREHOUSE" } }),
  outbox: await testPrisma.domainOutbox.count({ where: { eventType: { startsWith: "warehouse.custody" } } }),
  runs: await testPrisma.productionRun.count(),
  activities: await testPrisma.activityEvent.count({ where: { eventType: { startsWith: "CUSTODY_" } } }),
});

async function offered(w, options) {
  const f = await unitWithJob(w, options);
  await setWriter({ enabled: true, unitIds: [f.unit.id] });
  const done = await completePickup(w, f);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: f.unit.id } });
  return { ...f, handoff };
}

test("flag OFF: pickup selesai identik dengan V1 (RECEIVED) dan TIDAK membuat custody, command, outbox, run, atau audit custody", async () => {
  const w = await world();
  const f = await unitWithJob(w);
  await setWriter({ enabled: false, unitIds: [f.unit.id] });
  const before = await counts();
  const done = await completePickup(w, f);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal((await testPrisma.unit.findUnique({ where: { id: f.unit.id } })).status, "RECEIVED");
  assert.equal((await testPrisma.job.findUnique({ where: { id: f.job.id } })).status, "COMPLETED");
  assert.deepEqual(await counts(), before);
  assert.equal(before.handoffs, 0);
});

test("cohort ON: V1 tetap RECEIVED; custody OFFERED + command + outbox + audit tepat satu; replay dan unit non-cohort tidak menambah", async () => {
  const w = await world();
  const inCohort = await unitWithJob(w);
  const outside = await unitWithJob(w);
  await setWriter({ enabled: true, unitIds: [inCohort.unit.id] });

  const done = await completePickup(w, inCohort);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal((await testPrisma.unit.findUnique({ where: { id: inCohort.unit.id } })).status, "RECEIVED", "V1 tidak berubah");
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: inCohort.unit.id } });
  assert.equal(handoff.status, "OFFERED");
  assert.equal(handoff.direction, "INBOUND");
  assert.equal(handoff.deliveryJobId, inCohort.job.id);
  assert.equal(handoff.locationId, null);
  assert.equal(handoff.revision, 1);
  assert.equal(handoff.offeredById, w.driver.user.id);
  const command = await testPrisma.v2Command.findUniqueOrThrow({ where: { id: handoff.commandId } });
  assert.equal(command.commandType, "OFFER_INBOUND_CUSTODY");
  assert.equal(command.status, "APPLIED");
  assert.deepEqual(await counts(), { handoffs: 1, commands: 1, outbox: 1, runs: 0, activities: 1 });
  const outbox = await testPrisma.domainOutbox.findFirstOrThrow({ where: { aggregateId: handoff.id } });
  assert.equal(outbox.eventType, "warehouse.custody.offered");
  assert.equal(outbox.payload.direction, "INBOUND");

  // Replay complete dengan Idempotency-Key sama: tidak ada handoff/command/outbox baru.
  const replay = await w.driver.api.post(`/api/armada/jobs/${inCohort.job.id}/complete`, {
    proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga Rumah", note: "Unit diserahkan", location: null,
  }, key("pickup-complete"));
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.deepEqual(await counts(), { handoffs: 1, commands: 1, outbox: 1, runs: 0, activities: 1 });

  // Unit di luar cohort tetap V1-only.
  const other = await completePickup(w, outside, "outside");
  assert.equal(other.status, 200, JSON.stringify(other.body));
  assert.equal((await testPrisma.unit.findUnique({ where: { id: outside.unit.id } })).status, "RECEIVED");
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: outside.unit.id } }), 0);
});

test("antrean inbound, validasi lokasi/revisi, accept membuka Production Intake V2, replay idempoten, double accept ditolak", async () => {
  const w = await world();
  const f = await offered(w);

  const queue = await w.wh1.api.get("/api/inventory/unit-custody?status=OFFERED&direction=INBOUND");
  assert.equal(queue.status, 200, JSON.stringify(queue.body));
  assert.equal(queue.body.items.length, 1);
  assert.equal(queue.body.items[0].id, f.handoff.id);
  assert.equal(queue.body.items[0].revision, 1);
  assert.equal(queue.body.items[0].unit.unitCode, f.unit.unitCode);
  assert.equal((await w.driver.api.get("/api/inventory/unit-custody")).status, 403, "driver tidak boleh membaca antrean Gudang");

  const url = `/api/inventory/unit-custody/${f.handoff.id}/accept`;
  const noKey = await w.wh1.api.post(url, { locationId: w.locations.receiving.id, expectedRevision: 1 });
  assert.equal(noKey.status, 400);
  assert.match(noKey.body.error, /Idempotency-Key wajib/);
  const noLocation = await w.wh1.api.post(url, { expectedRevision: 1 }, key("a1"));
  assert.equal(noLocation.status, 400);
  assert.match(noLocation.body.error, /Lokasi penyimpanan wajib dipilih/);
  const noRevision = await w.wh1.api.post(url, { locationId: w.locations.receiving.id }, key("a2"));
  assert.equal(noRevision.status, 400);
  const wrongType = await w.wh1.api.post(url, { locationId: w.locations.dispatch.id, expectedRevision: 1 }, key("a3"));
  assert.equal(wrongType.status, 422);
  assert.equal(wrongType.body.code, "CUSTODY_LOCATION_TYPE_INVALID");
  const inactive = await w.wh1.api.post(url, { locationId: w.locations.inactive.id, expectedRevision: 1 }, key("a4"));
  assert.equal(inactive.status, 422);
  assert.equal(inactive.body.code, "CUSTODY_LOCATION_INVALID");
  const stale = await w.wh1.api.post(url, { locationId: w.locations.receiving.id, expectedRevision: 9 }, key("a5"));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "CUSTODY_REVISION_CONFLICT");
  assert.equal((await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: f.handoff.id } })).status, "OFFERED");

  const before = await counts();
  const accepted = await w.wh1.api.post(url, { locationId: w.locations.receiving.id, expectedRevision: 1 }, key("accept"));
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.status, "ACCEPTED");
  assert.equal(accepted.body.revision, 2);
  const row = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: f.handoff.id } });
  assert.equal(row.status, "ACCEPTED");
  assert.equal(row.locationId, w.locations.receiving.id);
  assert.equal(row.acceptedById, w.wh1.user.id);
  assert.ok(row.acceptedAt);
  assert.ok(row.productionRunId, "Production Intake V2 dibuka");
  const run = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: row.productionRunId }, include: { phases: { orderBy: { sequence: "asc" } } } });
  assert.equal(run.unitId, f.unit.id);
  assert.equal(run.status, "ACTIVE");
  assert.equal(run.currentPhase, "INTAKE");
  assert.deepEqual(run.phases.map((p) => `${p.phase}:${p.status}`), ["INTAKE:ACTIVE", "DIAGNOSIS:NOT_STARTED", "PROCESS:NOT_STARTED", "QC:NOT_STARTED", "HANDOFF:NOT_STARTED"]);
  const after = await counts();
  assert.equal(after.commands, before.commands + 1);
  assert.equal(after.outbox, before.outbox + 1, "tepat satu warehouse.custody.accepted");
  assert.equal(after.runs, 1);
  assert.equal(after.activities, before.activities + 1);
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "production.run.opened" } }), 1);
  assert.equal((await testPrisma.unit.findUnique({ where: { id: f.unit.id } })).status, "RECEIVED", "Unit.status tetap milik V1");

  // Replay dengan key yang sama: tidak menambah baris apa pun.
  const snapshot = await counts();
  const replay = await w.wh1.api.post(url, { locationId: w.locations.receiving.id, expectedRevision: 1 }, key("accept"));
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);
  assert.deepEqual(await counts(), snapshot);
  const conflict = await w.wh1.api.post(url, { locationId: w.locations.returnArea.id, expectedRevision: 1 }, key("accept"));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT");

  // Double accept (petugas lain, key berbeda) dan reject setelah accepted ditolak.
  const second = await w.wh2.api.post(url, { locationId: w.locations.receiving.id, expectedRevision: 2 }, key("second"));
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "CUSTODY_NOT_OFFERED");
  const rejectLate = await w.wh2.api.post(`/api/inventory/unit-custody/${f.handoff.id}/reject`, { reason: "Terlambat menolak", expectedRevision: 2 }, key("late"));
  assert.equal(rejectLate.status, 409);
  assert.deepEqual(await counts(), snapshot);
});

test("accept memakai run PENDING_ARRIVAL hasil backfill (tidak membuat run kedua)", async () => {
  const w = await world();
  const f = await unitWithJob(w);
  const run = await testPrisma.productionRun.create({
    data: { unitId: f.unit.id, kind: "RESTORATION", status: "PENDING_ARRIVAL", revision: 1,
      phases: { create: ["INTAKE", "DIAGNOSIS", "PROCESS", "QC", "HANDOFF"].map((phase, i) => ({ phase, sequence: i + 1, status: "NOT_STARTED" })) } },
  });
  await setWriter({ enabled: true, unitIds: [f.unit.id] });
  assert.equal((await completePickup(w, f)).status, 200);
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: f.unit.id } });
  const accepted = await w.wh1.api.post(`/api/inventory/unit-custody/${handoff.id}/accept`, { locationId: w.locations.receiving.id, expectedRevision: 1 }, key("reuse"));
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: f.unit.id } }), 1);
  const updated = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id }, include: { phases: true } });
  assert.equal(updated.status, "ACTIVE");
  assert.equal(updated.revision, 2);
  assert.equal(updated.phases.find((p) => p.phase === "INTAKE").status, "ACTIVE");
});

test("concurrency: dua petugas menerima handoff yang sama -> tepat satu berhasil, satu 409", async () => {
  const w = await world();
  const f = await offered(w);
  const url = `/api/inventory/unit-custody/${f.handoff.id}/accept`;
  const [a, b] = await Promise.all([
    w.wh1.api.post(url, { locationId: w.locations.receiving.id, expectedRevision: 1 }, key("race-a")),
    w.wh2.api.post(url, { locationId: w.locations.receiving.id, expectedRevision: 1 }, key("race-b")),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.body.code, "CUSTODY_NOT_OFFERED");
  const row = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: f.handoff.id } });
  assert.equal(row.status, "ACCEPTED");
  assert.equal(row.revision, 2);
  assert.equal(await testPrisma.productionRun.count(), 1);
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "warehouse.custody.accepted" } }), 1);
  assert.equal(await testPrisma.v2Command.count({ where: { commandType: "ACCEPT_CUSTODY" } }), 1);
});

test("reject: alasan wajib; riwayat tidak dihapus; audit + outbox + antrean exception; tidak membuka run; accept setelah reject ditolak", async () => {
  const w = await world();
  const f = await offered(w);
  const url = `/api/inventory/unit-custody/${f.handoff.id}/reject`;
  const noReason = await w.wh1.api.post(url, { expectedRevision: 1 }, key("r1"));
  assert.equal(noReason.status, 400);
  assert.match(noReason.body.error, /Alasan penolakan wajib diisi/);
  assert.equal((await w.wh1.api.post(url, { reason: "  ", expectedRevision: 1 }, key("r2"))).status, 400);
  assert.equal((await w.wh1.api.post(url, { reason: "Kondisi unit rusak parah", expectedRevision: 5 }, key("r3"))).status, 409);

  const rejected = await w.wh1.api.post(url, { reason: "Kondisi unit rusak parah", expectedRevision: 1 }, key("reject"));
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.status, "REJECTED");
  const row = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: f.handoff.id } });
  assert.equal(row.status, "REJECTED");
  assert.equal(row.reason, "Kondisi unit rusak parah");
  assert.equal(row.rejectedById, w.wh1.user.id);
  assert.equal(row.locationId, null);
  assert.equal(await testPrisma.productionRun.count(), 0);
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "warehouse.custody.rejected" } }), 1);
  const audit = await testPrisma.activityEvent.findFirstOrThrow({ where: { eventType: "CUSTODY_REJECTED", entityId: f.unit.id } });
  assert.equal(audit.metadata.reason, "Kondisi unit rusak parah");
  const exceptions = await w.wh1.api.get("/api/inventory/unit-custody?status=REJECTED");
  assert.equal(exceptions.body.items.length, 1);
  assert.equal(exceptions.body.items[0].reason, "Kondisi unit rusak parah");

  const acceptLater = await w.wh2.api.post(`/api/inventory/unit-custody/${f.handoff.id}/accept`, { locationId: w.locations.receiving.id, expectedRevision: 2 }, key("later"));
  assert.equal(acceptLater.status, 409);
  assert.equal(await testPrisma.unitCustodyHandoff.count(), 1, "riwayat tetap ada");
});

test("writer dimatikan setelah penawaran: accept/reject ditolak 503 dan handoff tidak berubah", async () => {
  const w = await world();
  const f = await offered(w);
  await setWriter({ enabled: false, unitIds: [f.unit.id] });
  const accept = await w.wh1.api.post(`/api/inventory/unit-custody/${f.handoff.id}/accept`, { locationId: w.locations.receiving.id, expectedRevision: 1 }, key("off1"));
  assert.equal(accept.status, 503);
  assert.equal(accept.body.code, "CUSTODY_WRITER_OFF");
  const reject = await w.wh1.api.post(`/api/inventory/unit-custody/${f.handoff.id}/reject`, { reason: "Tidak jadi", expectedRevision: 1 }, key("off2"));
  assert.equal(reject.status, 503);
  const row = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: f.handoff.id } });
  assert.equal(row.status, "OFFERED");
  assert.equal(row.revision, 1);
  assert.equal(await testPrisma.productionRun.count(), 0);
});

test("pengiriman gagal: V1 kembali READY_FOR_DELIVERY; handoff RETURN OFFERED tanpa lokasi; accept ke lokasi retur tidak membuka run", async () => {
  const w = await world();
  const f = await unitWithJob(w, { type: "DELIVERY" });
  await setWriter({ enabled: true, unitIds: [f.unit.id] });
  assert.equal((await w.driver.api.post(`/api/armada/jobs/${f.job.id}/start`, {}, key("del-start"))).status, 200);
  assert.equal((await testPrisma.unit.findUnique({ where: { id: f.unit.id } })).status, "IN_TRANSIT_OUT");
  assert.equal(await testPrisma.unitCustodyHandoff.count(), 0, "start pengiriman tidak membuat custody");
  const failed = await w.driver.api.post(`/api/armada/jobs/${f.job.id}/fail`, {
    failureReason: "Customer tidak di tempat", failurePhotoUrls: ["/media/job-photos/fail.jpg"], note: "Kembali ke gudang", location: null,
  }, key("del-fail"));
  assert.equal(failed.status, 200, JSON.stringify(failed.body));
  assert.equal((await testPrisma.unit.findUnique({ where: { id: f.unit.id } })).status, "READY_FOR_DELIVERY");
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: f.unit.id } });
  assert.equal(handoff.direction, "RETURN");
  assert.equal(handoff.status, "OFFERED");
  assert.equal(handoff.locationId, null, "lokasi tidak ditetapkan saat menawarkan");
  assert.equal((await testPrisma.v2Command.findUniqueOrThrow({ where: { id: handoff.commandId } })).commandType, "OFFER_RETURN_CUSTODY");

  const url = `/api/inventory/unit-custody/${handoff.id}/accept`;
  const wrong = await w.wh1.api.post(url, { locationId: w.locations.receiving.id, expectedRevision: 1 }, key("ret-wrong"));
  assert.equal(wrong.status, 422);
  assert.equal(wrong.body.code, "CUSTODY_LOCATION_TYPE_INVALID");
  const ok = await w.wh1.api.post(url, { locationId: w.locations.returnArea.id, expectedRevision: 1 }, key("ret-ok"));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.productionRunId, null);
  assert.equal(await testPrisma.productionRun.count(), 0, "unit yang kembali tidak membuka intake produksi");
  assert.equal((await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: handoff.id } })).status, "ACCEPTED");
});

test("constraint database: (job, unit) unik dan satu handoff aktif per unit dan direction", async () => {
  const w = await world();
  const a = await unitWithJob(w);
  const otherJob = await testPrisma.job.create({ data: { type: "PICKUP", orderId: a.order.id, status: "ASSIGNED", sequence: 1 } });
  const base = { unitId: a.unit.id, direction: "INBOUND", status: "OFFERED" };
  await testPrisma.unitCustodyHandoff.create({ data: { ...base, deliveryJobId: a.job.id } });
  await assert.rejects(() => testPrisma.unitCustodyHandoff.create({ data: { ...base, deliveryJobId: a.job.id } }), (e) => e.code === "P2002", "job+unit ganda ditolak");
  await assert.rejects(() => testPrisma.unitCustodyHandoff.create({ data: { ...base, deliveryJobId: otherJob.id } }), (e) => e.code === "P2002", "dua handoff aktif per unit+direction ditolak");
  // Handoff non-aktif tidak menghalangi; direction berbeda boleh.
  await testPrisma.unitCustodyHandoff.update({ where: { deliveryJobId_unitId: { deliveryJobId: a.job.id, unitId: a.unit.id } }, data: { status: "REJECTED" } });
  await testPrisma.unitCustodyHandoff.create({ data: { ...base, deliveryJobId: otherJob.id } });
  const returnJob = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: a.order.id, status: "FAILED", sequence: 1 } });
  await testPrisma.unitCustodyHandoff.create({ data: { unitId: a.unit.id, direction: "RETURN", status: "OFFERED", deliveryJobId: returnJob.id } });
});

test("handoff aktif lama tergantikan (SUPERSEDED) saat ada pickup baru; riwayat dipertahankan", async () => {
  const w = await world();
  const f = await unitWithJob(w);
  const second = await testPrisma.job.create({ data: { type: "PICKUP", orderId: f.order.id, status: "ASSIGNED", sequence: 2 } });
  await setWriter({ enabled: true, unitIds: [f.unit.id] });
  const offer = (jobId) => testPrisma.$transaction((tx) => offerUnitCustody(tx, { direction: "INBOUND", unitIds: [f.unit.id], jobId, actorId: w.driver.user.id }));
  await offer(f.job.id);
  const again = await offer(f.job.id);
  assert.equal(again[0].replayed, true, "penawaran ulang untuk job yang sama idempoten");
  await offer(second.id);
  const rows = await testPrisma.unitCustodyHandoff.findMany({ where: { unitId: f.unit.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(rows.map((r) => r.status), ["SUPERSEDED", "OFFERED"]);
  assert.equal(rows[0].revision, 2);
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "warehouse.custody.superseded" } }), 1);
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "warehouse.custody.offered" } }), 2);
});

test("atomik: kegagalan penawaran custody membatalkan pickup selesai V1 seluruhnya", async () => {
  const w = await world();
  const f = await unitWithJob(w);
  await setWriter({ enabled: true, unitIds: [f.unit.id] });
  // Sabotase: command internal dengan key deterministik sudah ada -> pembuatan command custody gagal (P2002).
  await testPrisma.v2Command.create({
    data: { domain: "WAREHOUSE", actorId: w.driver.user.id, idempotencyKey: `internal:OFFER_INBOUND_CUSTODY:${f.job.id}:${f.unit.id}`, commandType: "SABOTASE", aggregateType: "UnitCustodyHandoff", aggregateId: f.job.id, requestHash: "x", status: "APPLIED" },
  });
  assert.equal((await w.driver.api.post(`/api/armada/jobs/${f.job.id}/start`, {}, key("atom-start"))).status, 200);
  assert.equal((await w.driver.api.post(`/api/armada/jobs/${f.job.id}/arrive`, { location: null }, key("atom-arrive"))).status, 200);
  const done = await w.driver.api.post(`/api/armada/jobs/${f.job.id}/complete`, {
    proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga Rumah", note: "x", location: null,
  }, key("atom-complete"));
  assert.notEqual(done.status, 200, "V1 tidak boleh sukses bila proyeksi V2 gagal");
  assert.notEqual((await testPrisma.job.findUnique({ where: { id: f.job.id } })).status, "COMPLETED");
  assert.notEqual((await testPrisma.unit.findUnique({ where: { id: f.unit.id } })).status, "RECEIVED");
  assert.equal(await testPrisma.unitCustodyHandoff.count(), 0);
});
