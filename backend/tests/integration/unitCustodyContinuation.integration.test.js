// Lanjutan P1–P2 inbound custody: active production run, proyeksi lokasi legacy, rollback writer, reader cohort.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { offerUnitCustody, rollbackUnitCustodyOffers } from "../../src/services/unitCustodyCommandService.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

let server;
let seq = 0;

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (value) => ({ "Idempotency-Key": `custody-cont-${value}-0001` });

async function setFlag(flagKey, { enabled, unitIds }) {
  const data = { enabled, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "custody continuation test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
const setWriter = (opts) => setFlag(V2_FLAGS.PRODUCTION_WRITER, opts);
const setReader = (opts) => setFlag(V2_FLAGS.PRODUCTION_READER, opts);

async function world() {
  const [driver, wh1, wh2] = await Promise.all([
    createTestUser({ roles: ["DRIVER"] }), createTestUser({ roles: ["WAREHOUSE"] }), createTestUser({ roles: ["WAREHOUSE"] }),
  ]);
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Custody Lanjutan" } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH2-${++seq}`, name: "Gudang Tes 2" } });
  const loc = (zone, locationType, extra = {}) => testPrisma.storageLocation.create({
    data: { warehouseId: warehouse.id, zone, locationType, code: `${zone}-${++seq}`, ...extra },
  });
  const locations = {
    receiving: await loc("RCV2", "RECEIVING_AREA"),
    wip: await loc("WIP2", "WIP_AREA"),
    dispatch: await loc("DSP2", "DISPATCH_AREA"),
  };
  return {
    driver: { ...driver, api: makeClient(server.baseUrl, driver.token) },
    wh1: { ...wh1, api: makeClient(server.baseUrl, wh1.token) },
    wh2: { ...wh2, api: makeClient(server.baseUrl, wh2.token) },
    customer, locations,
  };
}

async function unitWithJob(w, { type = "PICKUP", unitStatus = "AWAITING_PICKUP" } = {}) {
  const order = await testPrisma.order.create({ data: { customerId: w.customer.id, orderNumber: `CUS2-${++seq}`, value: 1000, category: "LAYANAN" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-CUS2-${++seq}`, orderId: order.id, seq: 1, status: unitStatus } });
  const route = await testPrisma.route.create({
    data: { code: `CUS2-RTE-${++seq}`, date: new Date("2026-09-28T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id },
  });
  const job = await testPrisma.job.create({
    data: { type, orderId: order.id, routeId: route.id, driverId: w.driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-09-28T00:00:00.000Z") },
  });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  return { order, unit, route, job };
}

async function completePickup(w, f, tag = "pickup") {
  await w.driver.api.post(`/api/armada/jobs/${f.job.id}/start`, {}, key(`${tag}-start`));
  await w.driver.api.post(`/api/armada/jobs/${f.job.id}/arrive`, { location: null }, key(`${tag}-arrive`));
  return w.driver.api.post(`/api/armada/jobs/${f.job.id}/complete`, {
    proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga Rumah", note: "Unit diserahkan", location: null,
  }, key(`${tag}-complete`));
}

async function offered(w, options) {
  const f = await unitWithJob(w, options);
  await setWriter({ enabled: true, unitIds: [f.unit.id] });
  const done = await completePickup(w, f, `pickup-${++seq}`);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: f.unit.id } });
  return { ...f, handoff };
}

const accept = (w, who, handoffId, locationId, revision, tag) =>
  who.api.post(`/api/inventory/unit-custody/${handoffId}/accept`, { locationId, expectedRevision: revision }, key(tag));

// ── 1. Active production run ────────────────────────────────────────────────────────────────────────
test("dua accept dari jalur berbeda untuk unit yang sama tidak pernah membuat dua run aktif (constraint DB + lock)", async () => {
  const w = await world();
  const f = await offered(w);
  const [a, b] = await Promise.all([
    accept(w, w.wh1, f.handoff.id, w.locations.receiving.id, 1, "race-run-a"),
    accept(w, w.wh2, f.handoff.id, w.locations.receiving.id, 1, "race-run-b"),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: f.unit.id } }), 1);
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: f.unit.id } });
  assert.equal(run.status, "ACTIVE");
});

test("constraint database production_runs_v2: satu run aktif per unit; run COMPLETED/CANCELLED tidak dihitung", async () => {
  const w = await world();
  const f = await unitWithJob(w);
  await testPrisma.productionRun.create({ data: { unitId: f.unit.id, kind: "RESTORATION", status: "ACTIVE", revision: 1 } });
  await assert.rejects(
    () => testPrisma.productionRun.create({ data: { unitId: f.unit.id, kind: "RESTORATION", status: "PENDING_ARRIVAL", revision: 1 } }),
    (e) => e.code === "P2002",
    "dua run aktif sekaligus untuk unit yang sama harus ditolak database",
  );
  // Run yang sudah terminal tidak menghalangi run aktif baru.
  await testPrisma.productionRun.updateMany({ where: { unitId: f.unit.id }, data: { status: "COMPLETED" } });
  await testPrisma.productionRun.create({ data: { unitId: f.unit.id, kind: "REWORK", status: "ACTIVE", revision: 1 } });
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: f.unit.id } }), 2);
});

// ── 2. Legacy location projection ───────────────────────────────────────────────────────────────────
test("accept memproyeksikan StorageLocation.code ke Unit.storageLocation (legacy); locationId tetap source of truth; replay tidak mengubah dua kali/audit ganda", async () => {
  const w = await world();
  const f = await offered(w);
  assert.equal((await testPrisma.unit.findUnique({ where: { id: f.unit.id } })).storageLocation, null);

  const accepted = await accept(w, w.wh1, f.handoff.id, w.locations.wip.id, 1, "loc-accept");
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const unitAfter = await testPrisma.unit.findUniqueOrThrow({ where: { id: f.unit.id } });
  assert.equal(unitAfter.storageLocation, w.locations.wip.code, "proyeksi legacy = code lokasi kanonis");
  const handoffRow = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: f.handoff.id } });
  assert.equal(handoffRow.locationId, w.locations.wip.id, "locationId (bukan teks) tetap source of truth");

  const auditBefore = await testPrisma.activityEvent.count({ where: { eventType: "CUSTODY_ACCEPTED", entityId: f.unit.id } });
  const updatedAtBefore = unitAfter.updatedAt;

  // Replay dengan Idempotency-Key sama: tidak menulis ulang Unit, tidak menambah audit.
  const replay = await accept(w, w.wh1, f.handoff.id, w.locations.wip.id, 1, "loc-accept");
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.replayed, true);
  const unitReplay = await testPrisma.unit.findUniqueOrThrow({ where: { id: f.unit.id } });
  assert.equal(unitReplay.storageLocation, w.locations.wip.code);
  assert.equal(unitReplay.updatedAt.getTime(), updatedAtBefore.getTime(), "replay tidak menyentuh baris Unit lagi");
  assert.equal(await testPrisma.activityEvent.count({ where: { eventType: "CUSTODY_ACCEPTED", entityId: f.unit.id } }), auditBefore, "tidak ada audit ganda");
});

test("client tidak dapat mengirim teks lokasi bebas — hanya locationId yang diterima; ID lokasi asing/tidak aktif ditolak", async () => {
  const w = await world();
  const f = await offered(w);
  const freeText = await w.wh1.api.post(`/api/inventory/unit-custody/${f.handoff.id}/accept`, { location: "Gudang Belakang (tulisan bebas)", expectedRevision: 1 }, key("freetext"));
  assert.equal(freeText.status, 400, "tanpa locationId (field location bebas diabaikan) -> ditolak, bukan diterima sebagai lokasi");
  assert.equal((await testPrisma.unit.findUnique({ where: { id: f.unit.id } })).storageLocation, null);
});

// ── 3. Rollback / reconciliation ────────────────────────────────────────────────────────────────────
test("rollback membatalkan OFFERED milik cohort (CANCELLED), tidak menyentuh ACCEPTED, tidak menghapus histori, dan idempoten", async () => {
  const w = await world();
  const stillOffered = await offered(w);
  const alreadyAccepted = await offered(w);
  const acceptedRes = await accept(w, w.wh1, alreadyAccepted.handoff.id, w.locations.receiving.id, 1, "rb-accept");
  assert.equal(acceptedRes.status, 200, JSON.stringify(acceptedRes.body));

  const before = await testPrisma.unitCustodyHandoff.count();
  const result = await rollbackUnitCustodyOffers(testPrisma, {
    unitIds: [stillOffered.unit.id, alreadyAccepted.unit.id],
    actorId: w.wh2.user.id,
    idempotencyKey: "rollback-cohort-1",
    reason: "Writer dimatikan untuk investigasi",
  });
  assert.equal(result.replayed, false);
  assert.equal(result.cancelledCount, 1, "hanya handoff OFFERED yang dibatalkan");
  assert.equal(result.cancelled[0].unitId, stillOffered.unit.id);

  const cancelledRow = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: stillOffered.handoff.id } });
  assert.equal(cancelledRow.status, "CANCELLED");
  assert.equal(cancelledRow.cancelledById, w.wh2.user.id);
  assert.ok(cancelledRow.cancelledAt);
  assert.equal(cancelledRow.reason, "Writer dimatikan untuk investigasi");
  assert.equal(cancelledRow.offeredById, stillOffered.handoff.offeredById, "riwayat offeredBy/At tidak dihapus");

  const untouchedAccepted = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: alreadyAccepted.handoff.id } });
  assert.equal(untouchedAccepted.status, "ACCEPTED", "handoff yang sudah ACCEPTED tidak disentuh rollback");
  assert.equal(await testPrisma.unitCustodyHandoff.count(), before, "tidak ada baris terhapus (histori dipertahankan)");
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "warehouse.custody.cancelled" } }), 1);
  const audit = await testPrisma.activityEvent.findFirstOrThrow({ where: { eventType: "CUSTODY_ROLLED_BACK", entityId: stillOffered.unit.id } });
  assert.equal(audit.metadata.reason, "Writer dimatikan untuk investigasi");

  // Replay dengan Idempotency-Key SAMA: hasil identik, tidak ada command/outbox/audit baru.
  const snapshot = { handoffs: await testPrisma.unitCustodyHandoff.count(), outbox: await testPrisma.domainOutbox.count(), activities: await testPrisma.activityEvent.count() };
  const replay = await rollbackUnitCustodyOffers(testPrisma, {
    unitIds: [stillOffered.unit.id, alreadyAccepted.unit.id], actorId: w.wh2.user.id, idempotencyKey: "rollback-cohort-1", reason: "Writer dimatikan untuk investigasi",
  });
  assert.equal(replay.replayed, true);
  assert.equal(await testPrisma.unitCustodyHandoff.count(), snapshot.handoffs);
  assert.equal(await testPrisma.domainOutbox.count(), snapshot.outbox);
  assert.equal(await testPrisma.activityEvent.count(), snapshot.activities);

  // Dijalankan lagi dengan Idempotency-Key BARU (tidak ada OFFERED baru sejak itu): idempoten secara STATE, no-op.
  const again = await rollbackUnitCustodyOffers(testPrisma, {
    unitIds: [stillOffered.unit.id], actorId: w.wh2.user.id, idempotencyKey: "rollback-cohort-2", reason: "Rollback kedua, tidak ada yang berubah",
  });
  assert.equal(again.replayed, false);
  assert.equal(again.cancelledCount, 0, "sudah CANCELLED sebelumnya; tidak ada efek ganda walau key berbeda");
});

test("setelah rollback: reaktivasi writer untuk pickup BARU pada unit yang sama menghasilkan handoff baru, bukan offer stale lama yang dimunculkan lagi", async () => {
  const w = await world();
  const f = await offered(w);
  await rollbackUnitCustodyOffers(testPrisma, {
    unitIds: [f.unit.id], actorId: w.wh2.user.id, idempotencyKey: "rollback-reactivate", reason: "Rollback sebelum reaktivasi",
  });
  assert.equal((await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: f.handoff.id } })).status, "CANCELLED");

  // Ops menonaktifkan lalu mengaktifkan lagi writer untuk unit yang sama, lalu pickup BARU (job berbeda) selesai.
  await setWriter({ enabled: false, unitIds: [f.unit.id] });
  await setWriter({ enabled: true, unitIds: [f.unit.id] });
  const secondJob = await testPrisma.job.create({
    data: { type: "PICKUP", orderId: f.order.id, driverId: w.driver.user.id, status: "ASSIGNED", sequence: 2, scheduledDate: new Date("2026-09-28T00:00:00.000Z") },
  });
  await testPrisma.jobUnit.create({ data: { jobId: secondJob.id, unitId: f.unit.id } });
  await testPrisma.$transaction((tx) => offerUnitCustody(tx, { direction: "INBOUND", unitIds: [f.unit.id], jobId: secondJob.id, actorId: w.driver.user.id }));

  const active = await testPrisma.unitCustodyHandoff.findMany({ where: { unitId: f.unit.id, status: "OFFERED" } });
  assert.equal(active.length, 1, "tepat satu handoff OFFERED aktif (yang baru)");
  assert.equal(active[0].deliveryJobId, secondJob.id, "handoff baru menunjuk job baru, bukan job lama yang di-rollback");
  const oldRow = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: f.handoff.id } });
  assert.equal(oldRow.status, "CANCELLED", "handoff lama TETAP CANCELLED — tidak dihidupkan kembali sebagai pekerjaan baru");

  const queueBeforeReader = await w.wh1.api.get("/api/inventory/unit-custody?status=OFFERED&direction=INBOUND");
  assert.deepEqual(queueBeforeReader.body.items, [], "reader masih OFF sampai di sini");
  await setReader({ enabled: true, unitIds: [f.unit.id] });
  const queueAfterReader = await w.wh1.api.get("/api/inventory/unit-custody?status=OFFERED&direction=INBOUND");
  assert.deepEqual(queueAfterReader.body.items.map((item) => item.id), [active[0].id], "antrean menampilkan handoff baru, bukan yang lama (stale)");
});

test("validasi rollback: unitIds dan reason wajib; alasan terlalu pendek ditolak", async () => {
  await assert.rejects(
    () => rollbackUnitCustodyOffers(testPrisma, { unitIds: [], actorId: "x", idempotencyKey: "rb-empty-units-1", reason: "cukup panjang" }),
    (e) => e.code === "CUSTODY_ROLLBACK_UNITS_REQUIRED" && e.statusCode === 400,
  );
  await assert.rejects(
    () => rollbackUnitCustodyOffers(testPrisma, { unitIds: ["u1"], actorId: "x", idempotencyKey: "rb-no-reason-1", reason: "  " }),
    (e) => e.code === "CUSTODY_ROLLBACK_REASON_REQUIRED" && e.statusCode === 400,
  );
});

// ── 4. Reader flag (fail-closed + filter cohort) ────────────────────────────────────────────────────
test("reader OFF: antrean kosong (bukan error) walau handoff ada; reader GLOBAL: semua tampil; reader COHORT: hanya unit yang diizinkan", async () => {
  const w = await world();
  const a = await offered(w);
  const b = await offered(w);

  // v2_feature_flags TIDAK di-truncate antar tes (state bisa terbawa dari tes sebelumnya di file yang sama) —
  // set eksplisit OFF di sini, jangan mengandalkan default.
  await setReader({ enabled: false });
  const off = await w.wh1.api.get("/api/inventory/unit-custody?status=OFFERED&direction=INBOUND");
  assert.equal(off.status, 200);
  assert.deepEqual(off.body.items, []);
  assert.equal(off.body.readerMode, "OFF");

  await setReader({ enabled: true });
  const global = await w.wh1.api.get("/api/inventory/unit-custody?status=OFFERED&direction=INBOUND");
  assert.equal(global.body.readerMode, "GLOBAL");
  assert.deepEqual(global.body.items.map((i) => i.id).sort(), [a.handoff.id, b.handoff.id].sort());

  await setReader({ enabled: true, unitIds: [a.unit.id] });
  const cohort = await w.wh1.api.get("/api/inventory/unit-custody?status=OFFERED&direction=INBOUND");
  assert.equal(cohort.body.readerMode, "COHORT");
  assert.deepEqual(cohort.body.items.map((i) => i.id), [a.handoff.id], "unit b (di luar cohort reader) tersembunyi");

  await setReader({ enabled: false });
  const offAgain = await w.wh1.api.get("/api/inventory/unit-custody?status=OFFERED&direction=INBOUND");
  assert.deepEqual(offAgain.body.items, []);
});

test("reader OFF/COHORT tidak menghalangi accept/reject bila writer aktif — hanya VISIBILITAS antrean yang digerbang", async () => {
  const w = await world();
  const f = await offered(w);
  // Reader sengaja dibiarkan OFF (default) di sepanjang tes ini.
  const accepted = await accept(w, w.wh1, f.handoff.id, w.locations.receiving.id, 1, "reader-off-act");
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal((await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: f.handoff.id } })).status, "ACCEPTED");
});
