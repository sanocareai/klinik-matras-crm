// P9A — One-Location Production Intake: pickup yang SUKSES membuka Production Run PENDING_ARRIVAL ("Masuk Produksi") SEGERA
// (dalam transaksi V1 yang sama), TANPA menunggu Gudang menerima custody secara manual. Tahap produksi baru boleh dimulai
// setelah "Unit Tiba di Workshop" (confirm-arrival) menutup fase intake. Regresi custody/planning/pickup LAMA sudah dijaga
// terpisah di unitCustodyInbound / unitCustodyContinuation / productionPlanning / productionWorkshopExecution
// .integration.test.js — file ini FOKUS ke kontrak baru P9A saja.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

let server;
let seq = 0;

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (v) => ({ "Idempotency-Key": `p9a-test-${v}-0001` });

async function setFlag(flagKey, { enabled, unitIds }) {
  const data = { enabled, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "p9a test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
const setWriter = (o) => setFlag(V2_FLAGS.PRODUCTION_WRITER, o);
const setReader = (o) => setFlag(V2_FLAGS.PRODUCTION_READER, o);

async function world() {
  const [op, wh1, wh2] = await Promise.all([
    createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["WAREHOUSE"] }), createTestUser({ roles: ["WAREHOUSE"] }),
  ]);
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-P9A-${++seq}`, name: "Workshop P9A" } });
  const operator = await testPrisma.productionOperator.create({ data: { userId: op.user.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-P9A-${++seq}`, name: "Gudang P9A" } });
  const loc = (locationType) => testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType, code: `RCV-P9A-${++seq}` } });
  const locations = { receiving: await loc("RECEIVING_AREA"), wip: await loc("WIP_AREA"), dispatch: await loc("DISPATCH_AREA") };
  return {
    op: { ...op, api: makeClient(server.baseUrl, op.token) },
    wh1: { ...wh1, api: makeClient(server.baseUrl, wh1.token) },
    wh2: { ...wh2, api: makeClient(server.baseUrl, wh2.token) },
    driver: { ...driver, api: makeClient(server.baseUrl, driver.token) },
    workCenter, operator, locations,
  };
}

async function orderWithUnits(unitCount = 1) {
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan P9A" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `P9A-${++seq}`, value: 1000, category: "LAYANAN" } });
  const units = [];
  for (let i = 0; i < unitCount; i += 1) {
    units.push(await testPrisma.unit.create({ data: { unitCode: `UNIT-P9A-${++seq}`, orderId: order.id, seq: i + 1, status: "AWAITING_PICKUP" } }));
  }
  return { customer, order, units };
}

async function jobFor(w, { orderId, unitIds, type = "PICKUP" }) {
  const route = await testPrisma.route.create({ data: { code: `P9A-RTE-${++seq}`, date: new Date("2026-09-28T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
  const job = await testPrisma.job.create({ data: { type, orderId, routeId: route.id, driverId: w.driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-09-28T00:00:00.000Z") } });
  for (const unitId of unitIds) await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId } });
  return job;
}

async function completePickup(w, job, tag) {
  await w.driver.api.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}-start`));
  await w.driver.api.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${tag}-arrive`));
  return w.driver.api.post(`/api/armada/jobs/${job.id}/complete`, {
    proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga Rumah", note: "diserahkan", location: null,
  }, key(`${tag}-complete`));
}

async function failPickup(w, job, tag) {
  await w.driver.api.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}-start`));
  return w.driver.api.post(`/api/armada/jobs/${job.id}/fail`, {
    failureReason: "Customer tidak ada di rumah", failurePhotoUrls: ["/media/job-photos/fail.jpg"], note: "batal", location: null,
  }, key(`${tag}-fail`));
}

const board = (who, date = "2026-09-28") => who.api.get(`/api/production-v2/board?date=${date}`);
const confirmArrival = (who, unitId, locationId, tag) => who.api.post(`/api/production-v2/units/${unitId}/confirm-arrival`, { locationId }, key(tag));
const createPlan = (who, runId, tag) => who.api.post("/api/production-planning/plans", { runId }, key(tag));
const assignPlan = (who, planId, body, tag) => who.api.post(`/api/production-planning/plans/${planId}/assign`, body, key(tag));
const startStage = (who, runId, workCenterId, tag) => who.api.post(`/api/production-planning/workshop/runs/${runId}/start`, { expectedRevision: 1, workCenterId }, key(tag));

// ── 1. single-unit pickup ───────────────────────────────────────────────────────────────────────────────
test("single-unit pickup: unit langsung 'Masuk Produksi' (PENDING_ARRIVAL) segera, tampil di papan Belum Dijadwalkan TANPA menunggu Gudang menerima", async () => {
  const w = await world();
  const { order, units } = await orderWithUnits(1);
  const job = await jobFor(w, { orderId: order.id, unitIds: [units[0].id] });
  await setWriter({ enabled: true, unitIds: [units[0].id] });
  await setReader({ enabled: true, unitIds: [units[0].id] });
  const done = await completePickup(w, job, "single");
  assert.equal(done.status, 200, JSON.stringify(done.body));

  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: units[0].id } });
  assert.equal(run.status, "PENDING_ARRIVAL");
  assert.equal(run.currentPhase, null);
  assert.equal(run.startedAt, null);
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: units[0].id } });
  assert.equal(handoff.status, "OFFERED", "Gudang belum menerima apa pun — unit sudah masuk Produksi lewat pickup saja");

  const b = await board(w.op);
  assert.equal(b.status, 200, JSON.stringify(b.body));
  const card = b.body.unscheduled.units.find((u) => u.unit.id === units[0].id);
  assert.ok(card, "unit harus tampil di Belum Dijadwalkan segera setelah pickup");
  assert.equal(card.runId, run.id);
  assert.equal(card.inTransit, true);
});

// ── 2. multi-unit job ───────────────────────────────────────────────────────────────────────────────────
test("multi-unit job: satu Job membawa 2 unit sekaligus -> KEDUA unit langsung PENDING_ARRIVAL, tepat satu run per unit", async () => {
  const w = await world();
  const { order, units } = await orderWithUnits(2);
  const job = await jobFor(w, { orderId: order.id, unitIds: units.map((u) => u.id) });
  await setWriter({ enabled: true, unitIds: units.map((u) => u.id) });
  const done = await completePickup(w, job, "multi");
  assert.equal(done.status, 200, JSON.stringify(done.body));
  for (const u of units) {
    const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: u.id } });
    assert.equal(run.status, "PENDING_ARRIVAL");
  }
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: { in: units.map((u) => u.id) } } }), 2);
});

// ── 3. partial pickup ───────────────────────────────────────────────────────────────────────────────────
test("partial pickup: Order dua unit di dua Job berbeda — satu Job berhasil, satu Job gagal -> HANYA unit yang berhasil masuk Produksi", async () => {
  const w = await world();
  const { order, units } = await orderWithUnits(2);
  const jobOk = await jobFor(w, { orderId: order.id, unitIds: [units[0].id] });
  const jobFail = await jobFor(w, { orderId: order.id, unitIds: [units[1].id] });
  await setWriter({ enabled: true, unitIds: units.map((u) => u.id) });

  assert.equal((await completePickup(w, jobOk, "partial-ok")).status, 200);
  assert.equal((await failPickup(w, jobFail, "partial-fail")).status, 200);

  assert.equal(await testPrisma.productionRun.count({ where: { unitId: units[0].id } }), 1);
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: units[1].id } }), 0, "unit dari Job yang gagal tidak boleh masuk Produksi");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: units[1].id } })).status, "AWAITING_PICKUP");
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: units[1].id } }), 0);
});

// ── 4. idempotent replay ────────────────────────────────────────────────────────────────────────────────
test("idempotent replay: complete pickup diulang dengan Idempotency-Key sama -> tidak ada run/handoff kedua, papan tetap satu kartu", async () => {
  const w = await world();
  const { order, units } = await orderWithUnits(1);
  const job = await jobFor(w, { orderId: order.id, unitIds: [units[0].id] });
  await setWriter({ enabled: true, unitIds: [units[0].id] });
  await setReader({ enabled: true, unitIds: [units[0].id] });
  assert.equal((await completePickup(w, job, "replay")).status, 200);
  const replay = await w.driver.api.post(`/api/armada/jobs/${job.id}/complete`, {
    proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga Rumah", note: "diserahkan", location: null,
  }, key("replay-complete"));
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: units[0].id } }), 1);
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: units[0].id } }), 1);
  const b = await board(w.op);
  assert.equal(b.body.unscheduled.units.filter((u) => u.unit.id === units[0].id).length, 1);
});

// ── 5. dua completion bersamaan ─────────────────────────────────────────────────────────────────────────
test("dua completion pickup bersamaan (key berbeda) untuk Job yang sama -> tepat satu berhasil, tepat satu run/handoff", async () => {
  const w = await world();
  const { order, units } = await orderWithUnits(1);
  const job = await jobFor(w, { orderId: order.id, unitIds: [units[0].id] });
  await setWriter({ enabled: true, unitIds: [units[0].id] });
  await w.driver.api.post(`/api/armada/jobs/${job.id}/start`, {}, key("race-start"));
  await w.driver.api.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key("race-arrive"));
  const body = { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga Rumah", note: "diserahkan", location: null };
  const [a, b] = await Promise.all([
    w.driver.api.post(`/api/armada/jobs/${job.id}/complete`, body, key("race-complete-a")),
    w.driver.api.post(`/api/armada/jobs/${job.id}/complete`, body, key("race-complete-b")),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: units[0].id } }), 1);
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: units[0].id } }), 1);
});

// ── 6. dua konfirmasi kedatangan bersamaan ──────────────────────────────────────────────────────────────
test("dua konfirmasi 'Unit Tiba di Workshop' bersamaan untuk unit yang sama -> tepat satu berhasil, run tetap satu dan ACTIVE", async () => {
  const w = await world();
  const { order, units } = await orderWithUnits(1);
  const job = await jobFor(w, { orderId: order.id, unitIds: [units[0].id] });
  await setWriter({ enabled: true, unitIds: [units[0].id] });
  await setReader({ enabled: true, unitIds: [units[0].id] });
  assert.equal((await completePickup(w, job, "arrive-race")).status, 200);

  const [a, b] = await Promise.all([
    confirmArrival(w.op, units[0].id, w.locations.receiving.id, "arrive-race-a"),
    confirmArrival(w.op, units[0].id, w.locations.receiving.id, "arrive-race-b"),
  ]);
  // Pemenang: 200. Yang kalah: confirmUnitArrival mencari handoff OFFERED DI LUAR transaksi decide() sendiri —
  // kalau pencarian itu terjadi SEBELUM pemenang commit, decide() sendiri yang menolaknya (409 CUSTODY_NOT_OFFERED,
  // setelah mengunci baris & membaca ulang status ACCEPTED); kalau SESUDAH, pencarian awal sudah tidak menemukan
  // apa pun (404 CUSTODY_NOT_OFFERED_FOR_UNIT). Keduanya sah — yang wajib adalah TIDAK PERNAH dua-duanya 200.
  assert.ok(a.status === 200 || b.status === 200, JSON.stringify([a.body, b.body]));
  assert.notEqual(a.status === 200 && b.status === 200, true, "tidak boleh dua-duanya berhasil");
  const loserStatus = a.status === 200 ? b.status : a.status;
  assert.ok([404, 409].includes(loserStatus), JSON.stringify([a.body, b.body]));
  const loserBody = a.status === 200 ? b.body : a.body;
  assert.ok(["CUSTODY_NOT_OFFERED", "CUSTODY_NOT_OFFERED_FOR_UNIT"].includes(loserBody.code), JSON.stringify(loserBody));
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: units[0].id } });
  assert.equal(run.status, "ACTIVE");
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: units[0].id } }), 1);
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: units[0].id } });
  assert.equal(handoff.status, "ACCEPTED");
});

// ── 7. custody sudah ACCEPTED (lewat jalur Gudang lama) ─────────────────────────────────────────────────
test("custody sudah ACCEPTED lewat jalur Gudang manual -> confirm-arrival berikutnya 404, tidak membuat run kedua", async () => {
  const w = await world();
  const { order, units } = await orderWithUnits(1);
  const job = await jobFor(w, { orderId: order.id, unitIds: [units[0].id] });
  await setWriter({ enabled: true, unitIds: [units[0].id] });
  assert.equal((await completePickup(w, job, "already-accepted")).status, 200);
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: units[0].id } });
  const accepted = await w.wh1.api.post(`/api/inventory/unit-custody/${handoff.id}/accept`, { locationId: w.locations.receiving.id, expectedRevision: 1 }, key("manual-accept"));
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const runAfterAccept = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: units[0].id } });
  assert.equal(runAfterAccept.status, "ACTIVE");

  const again = await confirmArrival(w.op, units[0].id, w.locations.receiving.id, "already-accepted-confirm");
  assert.equal(again.status, 404);
  assert.equal(again.body.code, "CUSTODY_NOT_OFFERED_FOR_UNIT");
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: units[0].id } }), 1, "custody yang sudah ACCEPTED tidak dibuat ulang");
  assert.equal((await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: handoff.id } })).status, "ACCEPTED");
});

// ── 8. pickup gagal ─────────────────────────────────────────────────────────────────────────────────────
test("pickup gagal (job.fail): unit TIDAK pernah masuk antrean Produksi — tidak ada custody, tidak ada run", async () => {
  const w = await world();
  const { order, units } = await orderWithUnits(1);
  const job = await jobFor(w, { orderId: order.id, unitIds: [units[0].id] });
  await setWriter({ enabled: true, unitIds: [units[0].id] });
  await setReader({ enabled: true, unitIds: [units[0].id] });
  assert.equal((await failPickup(w, job, "fail-only")).status, 200);
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: units[0].id } }), 0);
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: units[0].id } }), 0);
  const b = await board(w.op);
  assert.ok(!b.body.unscheduled.units.some((u) => u.unit.id === units[0].id));
});

// ── 9. jadwalkan sebelum tiba ───────────────────────────────────────────────────────────────────────────
test("unit boleh dijadwalkan (plan+assign) SEBELUM kedatangan dikonfirmasi — run tetap PENDING_ARRIVAL", async () => {
  const w = await world();
  const { order, units } = await orderWithUnits(1);
  const job = await jobFor(w, { orderId: order.id, unitIds: [units[0].id] });
  await setWriter({ enabled: true, unitIds: [units[0].id] });
  await setReader({ enabled: true, unitIds: [units[0].id] });
  assert.equal((await completePickup(w, job, "presched")).status, 200);
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: units[0].id } });

  const eligible = await w.op.api.get("/api/production-planning/eligible-units");
  assert.equal(eligible.status, 200, JSON.stringify(eligible.body));
  assert.ok(eligible.body.items.some((it) => it.runId === run.id && it.inTransit === true));

  const created = await createPlan(w.op, run.id, "presched-create");
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const assigned = await assignPlan(w.op, created.body.planId, {
    workCenterId: w.workCenter.id, operatorId: w.operator.id, targetStartAt: "2026-09-29T01:00:00.000Z", targetCompleteAt: "2026-09-29T05:00:00.000Z", expectedRevision: 1,
  }, "presched-assign");
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(assigned.body.status, "PLANNED");
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).status, "PENDING_ARRIVAL", "menjadwalkan TIDAK boleh mengubah status run");
});

// ── 10. mulai tahap SEBELUM tiba ditolak ────────────────────────────────────────────────────────────────
test("memulai tahap produksi SEBELUM 'Unit Tiba di Workshop' ditolak 409 WORKSHOP_RUN_PENDING_ARRIVAL", async () => {
  const w = await world();
  const { order, units } = await orderWithUnits(1);
  const job = await jobFor(w, { orderId: order.id, unitIds: [units[0].id] });
  await setWriter({ enabled: true, unitIds: [units[0].id] });
  assert.equal((await completePickup(w, job, "gate")).status, 200);
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: units[0].id } });
  const created = await createPlan(w.op, run.id, "gate-create");
  await assignPlan(w.op, created.body.planId, {
    workCenterId: w.workCenter.id, operatorId: w.operator.id, targetStartAt: "2026-09-29T01:00:00.000Z", targetCompleteAt: "2026-09-29T05:00:00.000Z", expectedRevision: 1,
  }, "gate-assign");

  const res = await startStage(w.op, run.id, w.workCenter.id, "gate-start");
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, "WORKSHOP_RUN_PENDING_ARRIVAL");
  assert.equal(await testPrisma.productionOperationRun.count({ where: { runId: run.id } }), 0);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).status, "PENDING_ARRIVAL");
});

// ── 11. mulai tahap SETELAH tiba berhasil ───────────────────────────────────────────────────────────────
test("setelah 'Unit Tiba di Workshop': run jadi ACTIVE/INTAKE, dan memulai tahap pertama berhasil", async () => {
  const w = await world();
  const { order, units } = await orderWithUnits(1);
  const job = await jobFor(w, { orderId: order.id, unitIds: [units[0].id] });
  await setWriter({ enabled: true, unitIds: [units[0].id] });
  assert.equal((await completePickup(w, job, "arrive-ok")).status, 200);
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: units[0].id } });
  const created = await createPlan(w.op, run.id, "arrive-ok-create");
  await assignPlan(w.op, created.body.planId, {
    workCenterId: w.workCenter.id, operatorId: w.operator.id, targetStartAt: "2026-09-29T01:00:00.000Z", targetCompleteAt: "2026-09-29T05:00:00.000Z", expectedRevision: 1,
  }, "arrive-ok-assign");

  const confirmed = await confirmArrival(w.op, units[0].id, w.locations.wip.id, "arrive-ok-confirm");
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.status, "ACCEPTED");
  const activeRun = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(activeRun.status, "ACTIVE");
  assert.equal(activeRun.currentPhase, "INTAKE");
  assert.equal(activeRun.revision, 1, "promosi PENDING_ARRIVAL->ACTIVE tetap revisi 1 (basis 0), konsisten dengan run yang langsung dibuat ACTIVE");

  const started = await startStage(w.op, run.id, w.workCenter.id, "arrive-ok-start");
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.status, "ACTIVE");
});

// ── 12. writer OFF / non-cohort ─────────────────────────────────────────────────────────────────────────
test("writer OFF: pickup sukses identik V1, TIDAK ada jejak custody/run V2, dan papan tidak menampilkan unit ini", async () => {
  const w = await world();
  const { order, units } = await orderWithUnits(1);
  const job = await jobFor(w, { orderId: order.id, unitIds: [units[0].id] });
  await setWriter({ enabled: false, unitIds: [units[0].id] });
  await setReader({ enabled: true, unitIds: [units[0].id] });
  assert.equal((await completePickup(w, job, "writer-off")).status, 200);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: units[0].id } })).status, "RECEIVED");
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: units[0].id } }), 0);
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: units[0].id } }), 0);
  const b = await board(w.op);
  assert.ok(!b.body.unscheduled.units.some((u) => u.unit.id === units[0].id));
});

// ── 13. kanari OFFERED tanpa run sama sekali (warisan pra-P9A) — harus terbaca TANPA dimutasi ───────────
test("unit warisan OFFERED tanpa Production Run sama sekali (mis. canary pra-P9A) tampil di papan sebagai kartu 'dalam perjalanan' TANPA mutasi apa pun", async () => {
  const w = await world();
  const { order, units } = await orderWithUnits(1);
  const unit = units[0];
  // Simulasikan keadaan SEBELUM P9A ada: handoff OFFERED dibuat langsung di DB (BUKAN lewat offerUnitCustody/openPendingArrivalIntakeV2InTx),
  // persis seperti unit canary nyata yang sudah OFFERED sebelum kode ini pernah berjalan — TIDAK ADA ProductionRun untuk unit ini sama sekali.
  const job = await jobFor(w, { orderId: order.id, unitIds: [unit.id] });
  const handoff = await testPrisma.unitCustodyHandoff.create({
    data: { unitId: unit.id, deliveryJobId: job.id, direction: "INBOUND", status: "OFFERED", revision: 1 },
  });
  await setReader({ enabled: true, unitIds: [unit.id] });
  await setWriter({ enabled: true, unitIds: [unit.id] });

  assert.equal(await testPrisma.productionRun.count({ where: { unitId: unit.id } }), 0, "prasyarat: benar-benar tanpa run");

  // Baca papan DUA KALI — harus idempoten, tidak pernah menulis apa pun.
  const first = await board(w.op);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const card1 = first.body.unscheduled.units.find((u) => u.unit.id === unit.id);
  assert.ok(card1, "unit warisan tanpa run harus tetap terbaca sebagai kartu");
  assert.equal(card1.runId, null);
  assert.equal(card1.inTransit, true);
  assert.equal(card1.kind, "AWAITING_ARRIVAL_LEGACY");

  const second = await board(w.op);
  const card2 = second.body.unscheduled.units.find((u) => u.unit.id === unit.id);
  assert.deepEqual(card2, card1, "dua kali baca menghasilkan kartu yang identik — tidak ada state yang berubah akibat GET");

  const rowAfter = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: handoff.id } });
  assert.equal(rowAfter.status, "OFFERED");
  assert.equal(rowAfter.revision, 1, "GET papan tidak boleh memutasi custody sama sekali");
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: unit.id } }), 0, "GET papan tidak boleh membuat run apa pun");

  // Klik "Unit Tiba di Workshop" pada kartu warisan ini: harus jatuh ke jalur LAMA (buat run ACTIVE langsung, revisi 1) — sama seperti
  // sebelum P9A ada, TIDAK ada promosi PENDING_ARRIVAL (karena run itu tidak pernah dibuat untuk unit ini).
  const confirmed = await confirmArrival(w.op, unit.id, w.locations.receiving.id, "legacy-confirm");
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
  assert.equal(run.status, "ACTIVE");
  assert.equal(run.revision, 1);
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: unit.id } }), 1);
});
