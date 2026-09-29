// P5 Eksekusi Workshop: start/jeda/lanjut/selesai tahap di atas stage engine V1, gerbang material P4, assignment P3, AWAITING_QC,
// dan unit BARU/SEWA lahir di workshop tanpa pickup.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { adminBypassProduction, failStage, recordQcFitTest, recordStageDone, resolveBlocker, skipStage } from "../../src/services/unitStageEngine.js";

let server;
let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (v) => ({ "Idempotency-Key": `ws-test-${v}-0001` });
const PHOTO = ["/media/job-photos/ws.jpg"];
async function setFlag(flagKey, { enabled, unitIds }) {
  const data = { enabled, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "workshop test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
const setWriter = (o) => setFlag(V2_FLAGS.PRODUCTION_WRITER, o);
const setReader = (o) => setFlag(V2_FLAGS.PRODUCTION_READER, o);

async function world() {
  const [planner, other, gudang] = await Promise.all([createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["WAREHOUSE"] })]);
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-P5-${++seq}`, name: "Workshop P5" } });
  const otherCenter = await testPrisma.workCenter.create({ data: { code: `WC-P5-${++seq}`, name: "Workshop Lain" } });
  const operator = await testPrisma.productionOperator.create({ data: { userId: planner.user.id } });
  const otherOperator = await testPrisma.productionOperator.create({ data: { userId: other.user.id } });
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  const service = await testPrisma.serviceCatalog.findFirstOrThrow({ orderBy: { sortOrder: "asc" } });
  return { op: c(planner), other: c(other), gudang: c(gudang), workCenter, otherCenter, operator, otherOperator, service, wc: workCenter.id };
}

async function acceptedUnit() {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const dapi = makeClient(server.baseUrl, driver.token);
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Workshop" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `WSO-${++seq}`, value: 1000, category: "LAYANAN" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-WS-${++seq}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP" } });
  const route = await testPrisma.route.create({ data: { code: `WS-RTE-${++seq}`, date: new Date("2026-09-28T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: driver.user.id } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, driverId: driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-09-28T00:00:00.000Z") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  await setWriter({ enabled: true, unitIds: [unit.id] });
  const tag = `acc-${++seq}`;
  await dapi.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}-s`));
  await dapi.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${tag}-a`));
  const done = await dapi.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga", note: "ok", location: null }, key(`${tag}-c`));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: unit.id } });
  const wh = await createTestUser({ roles: ["WAREHOUSE"] });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-WS-${++seq}`, name: "Gudang WS" } });
  const loc = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-WS-${++seq}` } });
  const acc = await makeClient(server.baseUrl, wh.token).post(`/api/inventory/unit-custody/${handoff.id}/accept`, { locationId: loc.id, expectedRevision: 1 }, key(`${tag}-x`));
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  return { unit, run: await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } }) };
}

// Run dengan plan MATERIAL_RESERVED; bila issued=true, material P4 sudah di-PICKED (ISSUED, reservasi CONSUMED).
async function preparedRun(w, { issued = true, extraCohort = [] } = {}) {
  const { unit, run } = await acceptedUnit();
  await testPrisma.unit.update({ where: { id: unit.id }, data: { serviceId: w.service.id } });
  await setWriter({ enabled: true, unitIds: [unit.id, ...extraCohort] });
  await setReader({ enabled: true, unitIds: [unit.id, ...extraCohort] });
  const P = "/api/production-planning";
  const created = await w.op.api.post(`${P}/plans`, { runId: run.id }, key(`c-${++seq}`));
  const planId = created.body.planId;
  const as = await w.op.api.post(`${P}/plans/${planId}/assign`, { workCenterId: w.wc, operatorId: w.operator.id, targetStartAt: "2026-09-28T01:00:00.000Z", targetCompleteAt: "2026-09-28T09:00:00.000Z", expectedRevision: 1 }, key(`as-${++seq}`));
  const material = await createTestMaterial({ name: `Mat WS ${++seq}` });
  await seedBalance(material.id, 10);
  const bom = await w.op.api.post(`${P}/plans/${planId}/bom`, { lines: [{ materialId: material.id, qty: 2 }], expectedRevision: as.body.revision }, key(`b-${++seq}`));
  const res = await w.gudang.api.post(`${P}/plans/${planId}/reserve`, { expectedRevision: bom.body.revision }, key(`r-${++seq}`));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  let issueId = null;
  if (issued) {
    const req = await w.op.api.post(`${P}/plans/${planId}/material-request`, {}, key(`mr-${++seq}`));
    issueId = req.body.issueId;
    const pk = await w.gudang.api.post(`${P}/material-requests/${issueId}/pick`, { expectedRevision: 1 }, key(`pk-${++seq}`));
    assert.equal(pk.status, 200, JSON.stringify(pk.body));
  }
  return { unit, run, planId, issueId, material };
}

const W = "/api/production-planning/workshop/runs";
const call = (who, runId, action, body, tag) => who.api.post(`${W}/${runId}/${action}`, body, key(tag));
const start = (w, who, runId, rev, tag, wc = w.wc) => call(who, runId, "start", { expectedRevision: rev, workCenterId: wc }, tag);
const pause = (w, who, runId, rev, tag, extra = {}) => call(who, runId, "pause", { expectedRevision: rev, workCenterId: w.wc, ...extra }, tag);
const resume = (w, who, runId, rev, tag) => call(who, runId, "resume", { expectedRevision: rev, workCenterId: w.wc }, tag);
const complete = (w, who, runId, rev, tag, extra = { photoUrls: PHOTO }) => call(who, runId, "complete", { expectedRevision: rev, workCenterId: w.wc, ...extra }, tag);
const detail = async (w, runId) => (await w.op.api.get(`${W}/${runId}`)).body;

const counts = async (unitId) => ({
  ops: await testPrisma.productionOperationRun.count(),
  logs: await testPrisma.unitStageLog.count({ where: { unitId } }),
  commands: await testPrisma.v2Command.count({ where: { commandType: { endsWith: "_WORKSHOP_STAGE" } } }),
  outbox: await testPrisma.domainOutbox.count({ where: { eventType: { startsWith: "production.stage" } } }),
});
const ledger = async () => ({
  movements: await testPrisma.stockMovement.count(),
  reservations: await testPrisma.materialReservation.groupBy({ by: ["status"], _count: true }).then((rows) => JSON.stringify(rows.map((r) => [r.status, r._count]).sort())),
  journals: await testPrisma.finJournalEntry.count(),
  issues: await testPrisma.materialIssue.count(),
});

// Jalankan seluruh tahap workshop sampai AWAITING_QC; kembalikan revisi terakhir.
async function runToAwaitingQc(w, runId, rev) {
  let last = null;
  for (let guard = 0; guard < 30; guard += 1) {
    const s = await start(w, w.op, runId, rev, `all-s-${++seq}`);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const c = await complete(w, w.op, runId, s.body.revision, `all-c-${++seq}`);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    rev = c.body.revision; last = c.body;
    if (c.body.awaitingQc) return last;
  }
  throw new Error("tidak pernah mencapai AWAITING_QC");
}

// P8: tahap INTAKE routing (uji sebelum bongkar, bongkar, uji fondasi, diagnosa) berjalan sebelum bahan diserahkan — BOM dibuat setelah
// diagnosa nyata. Gerbang material berlaku mulai tahap MODULE pertama.
async function runIntake(w, runId, rev) {
  for (let i = 0; i < 4; i += 1) {
    const s = await start(w, w.op, runId, rev, `intake-s-${++seq}`);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.ok(["pre_teardown_test", "teardown", "foundation_test", "diagnosis"].includes(s.body.stage.code), s.body.stage.code);
    const c = await complete(w, w.op, runId, s.body.revision, `intake-c-${++seq}`);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    rev = c.body.revision;
  }
  return rev;
}

test("intake boleh sebelum material ISSUED; tahap MODULE pertama ditolak sampai bahan diserahkan dan penolakan tidak menulis apa pun", async () => {
  const w = await world();
  const { run, unit } = await preparedRun(w, { issued: false });
  const rev = await runIntake(w, run.id, 1);
  const before = await counts(unit.id);
  const res = await start(w, w.op, run.id, rev, "noissue");
  assert.equal(res.status, 409); assert.equal(res.body.code, "WORKSHOP_MATERIAL_NOT_ISSUED");
  assert.deepEqual(await counts(unit.id), before);
  assert.equal(await testPrisma.productionOperationRun.count({ where: { runId: run.id, stageCode: { notIn: ["pre_teardown_test", "teardown", "foundation_test", "diagnosis"] } } }), 0);
});

test("intake ditolak bila rencana belum ditugaskan (DRAFT) — gerbang minimum tetap ada", async () => {
  const w = await world();
  const { unit, run } = await acceptedUnit();
  await setWriter({ enabled: true, unitIds: [unit.id] });
  const created = await w.op.api.post("/api/production-planning/plans", { runId: run.id }, key(`c-${++seq}`));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const res = await start(w, w.op, run.id, 1, "draft-start");
  assert.equal(res.status, 409, JSON.stringify(res.body)); assert.equal(res.body.code, "WORKSHOP_PLAN_NOT_ASSIGNED", "rencana DRAFT belum ditugaskan");
  assert.equal(await testPrisma.productionOperationRun.count({ where: { runId: run.id } }), 0);
});

test("start sukses + replay exact-once: tahap pertama ACTIVE, fase PROCESS ACTIVE, satu START di ledger V1; replay tidak menambah apa pun", async () => {
  const w = await world();
  const { run, unit } = await preparedRun(w);
  const first = await start(w, w.op, run.id, 1, "st-1");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.status, "ACTIVE"); assert.equal(first.body.revision, 2); assert.equal(first.body.stage.code, "pre_teardown_test");
  assert.equal((await testPrisma.productionPhaseRun.findUniqueOrThrow({ where: { runId_phase: { runId: run.id, phase: "PROCESS" } } })).status, "ACTIVE");
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: unit.id, action: "START" } }), 1);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "IN_PRODUCTION");
  const after = await counts(unit.id);
  const replay = await start(w, w.op, run.id, 1, "st-1");
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true); assert.equal(replay.body.revision, 2);
  assert.deepEqual(await counts(unit.id), after);
});

test("dua start bersamaan: operator sama (key beda) -> satu 200 satu 409; operator berbeda -> satu 200 satu 403; tepat satu START", async () => {
  const w = await world();
  const { run, unit } = await preparedRun(w);
  const [a, b] = await Promise.all([start(w, w.op, run.id, 1, "race-a"), start(w, w.op, run.id, 1, "race-b")]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: unit.id, action: "START" } }), 1);
  assert.equal(await testPrisma.productionOperationRun.count({ where: { runId: run.id, status: "ACTIVE" } }), 1);

  const w2 = await world();
  const second = await preparedRun(w2);
  const [c, d] = await Promise.all([start(w2, w2.op, second.run.id, 1, "race-c"), start(w2, w2.other, second.run.id, 1, "race-d")]);
  assert.deepEqual([c.status, d.status].sort(), [200, 403], JSON.stringify([c.body, d.body]));
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: second.unit.id, action: "START" } }), 1);
});

test("urutan tahap + satu tahap aktif: start kedua saat aktif 409; selesai tanpa foto (tahap wajib foto) 400; urutan mengikuti routing V1", async () => {
  const w = await world();
  const { run } = await preparedRun(w);
  const s1 = await start(w, w.op, run.id, 1, "ord-s1");
  const again = await start(w, w.op, run.id, s1.body.revision, "ord-s1b");
  assert.equal(again.status, 409); assert.equal(again.body.code, "WORKSHOP_STAGE_ALREADY_ACTIVE");
  const noPhoto = await complete(w, w.op, run.id, s1.body.revision, "ord-c-nophoto", {});
  assert.equal(noPhoto.status, 400); assert.equal(noPhoto.body.code, "WORKSHOP_STAGE_TRANSITION_INVALID");
  const c1 = await complete(w, w.op, run.id, s1.body.revision, "ord-c1");
  assert.equal(c1.status, 200, JSON.stringify(c1.body)); assert.equal(c1.body.awaitingQc, false);
  const s2 = await start(w, w.op, run.id, c1.body.revision, "ord-s2");
  assert.equal(s2.status, 200); assert.equal(s2.body.stage.code, "teardown"); assert.equal(s2.body.sequence, 2);
  const d = await detail(w, run.id);
  assert.deepEqual(d.stages.slice(0, 2).map((s) => s.status), ["COMPLETED", "ACTIVE"]);
});

test("pause wajib alasan (validasi + blokir bukan jeda), evidence foto tersimpan; resume; start saat dijeda ditolak; complete saat dijeda ditolak", async () => {
  const w = await world();
  const { run, unit } = await preparedRun(w);
  const s1 = await start(w, w.op, run.id, 1, "pz-s1");
  const noReason = await pause(w, w.op, run.id, s1.body.revision, "pz-none");
  assert.equal(noReason.status, 400); assert.equal(noReason.body.code, "WORKSHOP_PAUSE_REASON_INVALID");
  const blocker = await pause(w, w.op, run.id, s1.body.revision, "pz-blk", { reason: "MATERIAL_SHORTAGE" });
  assert.equal(blocker.status, 400);
  const p = await pause(w, w.op, run.id, s1.body.revision, "pz-ok", { reason: "BREAK", note: "istirahat", photoUrls: PHOTO });
  assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(p.body.status, "PAUSED");
  const log = await testPrisma.unitStageLog.findFirstOrThrow({ where: { unitId: unit.id, action: "PAUSE" } });
  assert.equal(log.pauseReason, "BREAK"); assert.deepEqual(log.photoUrls, PHOTO);
  const startPaused = await start(w, w.op, run.id, p.body.revision, "pz-s-paused");
  assert.equal(startPaused.status, 409); assert.equal(startPaused.body.code, "WORKSHOP_STAGE_ALREADY_ACTIVE");
  const completePaused = await complete(w, w.op, run.id, p.body.revision, "pz-c-paused");
  assert.equal(completePaused.status, 409); assert.equal(completePaused.body.code, "WORKSHOP_STAGE_STATE_INVALID");
  const pauseTwice = await pause(w, w.op, run.id, p.body.revision, "pz-twice", { reason: "BREAK" });
  assert.equal(pauseTwice.status, 409);
  const r = await resume(w, w.op, run.id, p.body.revision, "pz-resume");
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, "ACTIVE");
  const c = await complete(w, w.op, run.id, r.body.revision, "pz-c");
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const d = await detail(w, run.id);
  assert.deepEqual(d.history.map((h) => h.action), ["START", "PAUSE", "RESUME", "COMPLETE"]);
  assert.equal(d.history[1].pauseReason, "BREAK");
});

test("revisi basi -> 409 tanpa mutasi (start/pause/complete)", async () => {
  const w = await world();
  const { run, unit } = await preparedRun(w);
  const before = await counts(unit.id);
  const stale = await start(w, w.op, run.id, 7, "sr-start");
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "WORKSHOP_REVISION_CONFLICT");
  assert.deepEqual(await counts(unit.id), before);
  const s1 = await start(w, w.op, run.id, 1, "sr-s1");
  const mid = await counts(unit.id);
  assert.equal((await pause(w, w.op, run.id, 1, "sr-pause", { reason: "BREAK" })).status, 409);
  assert.equal((await complete(w, w.op, run.id, 1, "sr-complete")).status, 409);
  assert.deepEqual(await counts(unit.id), mid);
  assert.equal(s1.body.revision, 2);
});

test("operator/work center tidak sesuai assignment P3 ditolak (403/422) untuk seluruh perintah; tidak ada tulisan", async () => {
  const w = await world();
  const { run, unit } = await preparedRun(w);
  const before = await counts(unit.id);
  const wrongOperator = await start(w, w.other, run.id, 1, "op-wrong");
  assert.equal(wrongOperator.status, 403); assert.equal(wrongOperator.body.code, "WORKSHOP_OPERATOR_MISMATCH");
  const wrongCenter = await start(w, w.op, run.id, 1, "wc-wrong", w.otherCenter.id);
  assert.equal(wrongCenter.status, 422); assert.equal(wrongCenter.body.code, "WORKSHOP_WORK_CENTER_MISMATCH");
  const noCenter = await call(w.op, run.id, "start", { expectedRevision: 1 }, "wc-none");
  assert.equal(noCenter.status, 422);
  assert.deepEqual(await counts(unit.id), before);
  const s1 = await start(w, w.op, run.id, 1, "op-ok");
  assert.equal(s1.status, 200);
  assert.equal((await pause(w, w.other, run.id, s1.body.revision, "op-wrong-pause", { reason: "BREAK" })).status, 403);
  assert.equal((await complete(w, w.other, run.id, s1.body.revision, "op-wrong-complete")).status, 403);
});

test("selesai tahap workshop TERAKHIR -> AWAITING_QC: fase PROCESS COMPLETED, currentPhase QC, gerbang QC V1; BUKAN PASS QC/READY_FOR_DELIVERY; tanpa stok/HPP", async () => {
  const w = await world();
  const { run, unit } = await preparedRun(w);
  const ledgerBefore = await ledger();
  const last = await runToAwaitingQc(w, run.id, 1);
  assert.equal(last.awaitingQc, true);
  const runRow = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id }, include: { phases: true } });
  assert.equal(runRow.currentPhase, "QC"); assert.equal(runRow.status, "ACTIVE");
  const phase = (name) => runRow.phases.find((p) => p.phase === name).status;
  assert.equal(phase("PROCESS"), "COMPLETED"); assert.equal(phase("QC"), "NOT_STARTED"); assert.equal(phase("HANDOFF"), "NOT_STARTED");
  const unitRow = await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id }, include: { currentStage: true } });
  assert.equal(unitRow.currentStage.requiresQc, true, "unit berada di gerbang QC V1");
  assert.notEqual(unitRow.status, "READY_FOR_DELIVERY"); assert.equal(unitRow.status, "IN_PRODUCTION");
  assert.equal(await testPrisma.qualityInspection.count(), 0, "tidak ada hasil QC");
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: unit.id, stage: { requiresQc: true } } }), 0, "gerbang QC tidak disentuh");
  // Predikat yang sama dengan GET /api/production/qc-queue (router itu tidak dipasang di test app).
  const inQcQueue = await testPrisma.unit.findMany({ where: { currentStage: { requiresQc: true } }, select: { id: true } });
  assert.ok(inQcQueue.some((u) => u.id === unit.id), "unit tampil di antrean QC V1");
  const again = await start(w, w.op, run.id, last.revision, "aq-again");
  assert.equal(again.status, 409); assert.equal(again.body.code, "WORKSHOP_AWAITING_QC");
  assert.deepEqual(await ledger(), ledgerBefore, "P5 tidak menulis stock movement, reservasi, jurnal/HPP, atau issue");
  const ops = await testPrisma.productionOperationRun.findMany({ where: { runId: run.id } });
  assert.ok(ops.length >= 5 && ops.every((o) => o.status === "COMPLETED"));
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "production.run.awaiting_qc" } }), 1);
});

test("unit BARU/SEWA lahir di workshop: run WORKSHOP_BORN kanonis (tanpa custody/migrationSource), eligible P3, replay idempoten", async () => {
  const w = await world();
  const make = async (category, status) => {
    const customer = await testPrisma.customer.create({ data: { name: `Pelanggan ${category}` } });
    const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `BORN-${++seq}`, value: 1000, category } });
    return testPrisma.unit.create({ data: { unitCode: `UNIT-BORN-${++seq}`, orderId: order.id, seq: 1, status } });
  };
  const baru = await make("BARU", "RECEIVED");
  const sewa = await make("SEWA", "RECEIVED");
  const layanan = await make("LAYANAN", "RECEIVED");
  await setWriter({ enabled: true, unitIds: [baru.id, sewa.id, layanan.id] });
  await setReader({ enabled: true, unitIds: [baru.id, sewa.id, layanan.id] });
  const reg = (unitId, tag) => w.op.api.post(`${W.replace("/runs", "")}/runs`, { unitId }, key(tag));

  const a = await reg(baru.id, "born-baru");
  assert.equal(a.status, 201, JSON.stringify(a.body)); assert.equal(a.body.origin, "WORKSHOP_BORN");
  const b = await reg(sewa.id, "born-sewa");
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const bad = await reg(layanan.id, "born-layanan");
  assert.equal(bad.status, 422); assert.equal(bad.body.code, "WORKSHOP_BORN_CATEGORY_INVALID");
  const replay = await reg(baru.id, "born-baru");
  assert.equal(replay.status, 201); assert.equal(replay.body.runId, a.body.runId);
  const dup = await reg(baru.id, "born-baru-2");
  assert.equal(dup.status, 409); assert.equal(dup.body.code, "WORKSHOP_RUN_ALREADY_EXISTS");

  const run = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: a.body.runId }, include: { phases: true } });
  assert.equal(run.origin, "WORKSHOP_BORN"); assert.equal(run.migrationSource, null); assert.equal(run.kind, "NEW_PRODUCT");
  assert.equal(run.phases.find((p) => p.phase === "INTAKE").status, "NOT_APPLICABLE");
  assert.equal(run.phases.find((p) => p.phase === "PROCESS").status, "NOT_STARTED");
  assert.equal(await testPrisma.unitCustodyHandoff.count(), 0, "tidak ada custody palsu");
  const plan = await w.op.api.post("/api/production-planning/plans", { runId: run.id }, key("born-plan"));
  assert.equal(plan.status, 201, JSON.stringify(plan.body));
  const queue = await w.op.api.get("/api/production-planning/eligible-units");
  assert.ok(queue.body.items.every((i) => i.isLegacyException === false));
});

test("unit dengan jalur pickup/custody tidak boleh didaftarkan lahir di workshop; writer OFF -> 503 tanpa run", async () => {
  const w = await world();
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Pickup" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `BORN-${++seq}`, value: 1000, category: "BARU" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-BORN-${++seq}`, orderId: order.id, seq: 1, status: "RECEIVED" } });
  await setWriter({ enabled: true, unitIds: [unit.id] });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "UNSCHEDULED", sequence: 1, scheduledDate: new Date("2026-09-28T00:00:00.000Z") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  const res = await w.op.api.post(`${W.replace("/runs", "")}/runs`, { unitId: unit.id }, key("born-pickup"));
  assert.equal(res.status, 409); assert.equal(res.body.code, "WORKSHOP_BORN_HAS_PICKUP");
  await testPrisma.jobUnit.deleteMany({});
  await setWriter({ enabled: false, unitIds: [unit.id] });
  const off = await w.op.api.post(`${W.replace("/runs", "")}/runs`, { unitId: unit.id }, key("born-off"));
  assert.equal(off.status, 503); assert.equal(off.body.code, "WORKSHOP_WRITER_OFF");
  assert.equal(await testPrisma.productionRun.count(), 0);
});

test("writer OFF / non-cohort: perintah V2 503 tanpa jejak; V1 tetap jalan normal; unit cohort dipagari dari V1 (409)", async () => {
  const w = await world();
  const { run, unit } = await preparedRun(w);
  const before = await counts(unit.id);
  // Unit cohort dengan run aktif: jalur V1 dipagari (V2 pemilik).
  const fenced = await w.op.api.post(`/api/units/${unit.id}/stages/start`, {});
  assert.equal(fenced.status, 409);
  assert.deepEqual(await counts(unit.id), before);
  // Writer OFF: V2 503, V1 kembali murni.
  await setWriter({ enabled: false, unitIds: [unit.id] });
  const off = await start(w, w.op, run.id, 1, "off-start");
  assert.equal(off.status, 503); assert.equal(off.body.code, "WORKSHOP_WRITER_OFF");
  assert.equal(await testPrisma.productionOperationRun.count(), 0);
  assert.equal((await testPrisma.v2Command.count({ where: { commandType: { endsWith: "_WORKSHOP_STAGE" } } })), 0);
  const v1 = await w.op.api.post(`/api/units/${unit.id}/stages/start`, {});
  assert.equal(v1.status, 200, JSON.stringify(v1.body));
  assert.equal(await testPrisma.productionOperationRun.count(), 0, "V1 tidak meninggalkan jejak V2");
  // Non-cohort (writer ON untuk unit lain): V2 503, V1 normal.
  const { unit: other } = await acceptedUnit();
  await setWriter({ enabled: true, unitIds: ["00000000-0000-0000-0000-000000000000"] });
  const v1other = await w.op.api.post(`/api/units/${other.id}/stages/start`, {});
  assert.equal(v1other.status, 200, JSON.stringify(v1other.body));
});

test("reader OFF: antrean kerja/detail kosong-inert; antrean hari ini + filter mine; detail memuat tahap, status material, histori", async () => {
  const w = await world();
  const { run } = await preparedRun(w);
  const q = await w.op.api.get("/api/production-planning/workshop/queue?scope=today&mine=1");
  assert.equal(q.status, 200); assert.equal(q.body.items.length, 1);
  assert.equal(q.body.items[0].state, "READY_TO_START"); assert.equal(q.body.items[0].operator.id, w.operator.id);
  const otherQ = await w.other.api.get("/api/production-planning/workshop/queue?scope=today&mine=1");
  assert.equal(otherQ.body.items.length, 0, "operator lain tidak melihat antrean milik operator ini");
  const future = await testPrisma.productionRunPlan.updateMany({ where: { runId: run.id }, data: { targetStartAt: new Date(Date.now() + 3 * 86400_000) } });
  assert.equal(future.count, 1);
  assert.equal((await w.op.api.get("/api/production-planning/workshop/queue?scope=today")).body.items.length, 0, "target mulai besok bukan antrean hari ini");
  assert.equal((await w.op.api.get("/api/production-planning/workshop/queue?scope=all")).body.items.length, 1);
  const d = await detail(w, run.id);
  assert.equal(d.material.ready, true); assert.ok(d.stages.length >= 5); assert.equal(d.qcGate.label, "Uji Berat Badan");
  await setReader({ enabled: false });
  const off = await w.op.api.get("/api/production-planning/workshop/queue");
  assert.deepEqual(off.body, { items: [], readerMode: "OFF" });
  assert.equal((await w.op.api.get(`${W}/${run.id}`)).body.items?.length, 0);
});

// ── Audit P5 (SHA 1e74ab3e): regresi temuan ────────────────────────────────────────────────────────────────────────────
const rejects409 = (promise, pattern = /dikelola Production V2/) => assert.rejects(promise, (error) => error.statusCode === 409 && pattern.test(error.message));

test("AUDIT F1/F2/F3: SEMUA penulis ledger tahap V1 dipagari untuk unit V2 (fail/qc/bypass/recordDone/skip/HTTP fail) — tanpa log/blocker/QC baru; resolveBlocker tetap jalan", async () => {
  const w = await world();
  const { run, unit } = await preparedRun(w);
  const s1 = await start(w, w.op, run.id, 1, "f1-start");
  assert.equal(s1.status, 200, JSON.stringify(s1.body));
  const stageId = s1.body.stage.id;
  const qcStage = await testPrisma.routingStage.findFirstOrThrow({ where: { requiresQc: true } });
  const snapshot = async () => ({
    logs: await testPrisma.unitStageLog.count({ where: { unitId: unit.id } }),
    blockers: await testPrisma.productionBlocker.count({ where: { unitId: unit.id } }),
    qc: await testPrisma.qcFitTest.count({ where: { unitId: unit.id } }),
    unit: JSON.stringify(await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id }, select: { status: true, currentStageId: true } })),
    ops: JSON.stringify(await testPrisma.productionOperationRun.findMany({ where: { runId: run.id }, select: { status: true } })),
  });
  const before = await snapshot();
  await rejects409(failStage(unit.id, stageId, { actorId: w.op.user.id, blockReason: "MACHINE_DOWN", note: "mesin mati" }));
  await rejects409(recordStageDone(unit.id, { actorId: w.op.user.id, photoUrls: PHOTO }));
  await rejects409(skipStage(unit.id, { actorId: w.op.user.id, note: "lewati" }));
  await rejects409(recordQcFitTest(unit.id, qcStage.id, { actorId: w.op.user.id, verdict: "PAS", referenceWeightKg: 60, photoUrls: PHOTO }));
  await rejects409(adminBypassProduction(unit.id, { actorId: w.op.user.id, note: "bypass admin uji" }));
  const http = await w.op.api.post(`/api/units/${unit.id}/stages/${stageId}/fail`, { blockReason: "MACHINE_DOWN", note: "mesin mati" });
  assert.equal(http.status, 409, JSON.stringify(http.body));
  assert.deepEqual(await snapshot(), before, "penolakan tidak boleh meninggalkan jejak V1 apa pun");
  // V2 tetap konsisten setelah semua upaya V1 ditolak.
  const p = await pause(w, w.op, run.id, s1.body.revision, "f1-pause", { reason: "BREAK" });
  assert.equal(p.status, 200, JSON.stringify(p.body));

  // Blokir V1 (unit di luar V2) dapat diselesaikan: resolveBlocker tidak lagi ReferenceError dan tidak dipagari.
  const legacyUnit = (await acceptedUnit()).unit;
  await setWriter({ enabled: false, unitIds: [legacyUnit.id] });
  const started = await w.op.api.post(`/api/units/${legacyUnit.id}/stages/start`, {});
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const failed = await failStage(legacyUnit.id, started.body.stage.id, { actorId: w.op.user.id, blockReason: "MACHINE_DOWN", note: "mesin mati" });
  assert.ok(failed.blocker.id);
  const resolved = await w.op.api.post(`/api/units/${legacyUnit.id}/blockers/${failed.blocker.id}/resolve`, { resolutionNote: "sudah normal" });
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
  assert.ok(resolved.body.resolvedAt);
});

test("AUDIT F1: writer OFF / non-cohort -> failStage & recordStageDone berperilaku V1 murni (tanpa jejak V2)", async () => {
  const w = await world();
  const { run, unit } = await preparedRun(w);
  const s1 = await start(w, w.op, run.id, 1, "off-fail-start");
  assert.equal(s1.status, 200);
  const commandsBefore = await testPrisma.v2Command.count();
  await setWriter({ enabled: false, unitIds: [unit.id] });
  const failed = await failStage(unit.id, s1.body.stage.id, { actorId: w.op.user.id, blockReason: "MACHINE_DOWN", note: "mesin mati" });
  assert.equal(failed.log.action, "FAIL");
  await setWriter({ enabled: true, unitIds: ["00000000-0000-0000-0000-000000000000"] });
  const done = await recordStageDone(unit.id, { actorId: w.op.user.id, photoUrls: PHOTO });
  assert.ok(done, "non-cohort: V1 mencatat tahap selesai");
  assert.equal(await testPrisma.v2Command.count(), commandsBefore, "jalur V1 tidak membuat command/outbox V2");
});

test("AUDIT F4: bukti material — reservasi CONSUMED tanpa baris issue ISSUED milik plan yang sama (atau issuedQty kurang / issue CANCELLED) TIDAK cukup", async () => {
  const w = await world();
  const { run, issueId } = await preparedRun(w);
  const before = await testPrisma.unitStageLog.count();
  await testPrisma.materialIssueLine.updateMany({ where: { materialIssueId: issueId }, data: { reservationId: null } });
  const intakeRev = await runIntake(w, run.id, 1);
  const beforeModule = await testPrisma.unitStageLog.count();
  const noLink = await start(w, w.op, run.id, intakeRev, "mat-nolink");
  assert.equal(noLink.status, 409); assert.equal(noLink.body.code, "WORKSHOP_MATERIAL_NOT_ISSUED");
  assert.equal(await testPrisma.unitStageLog.count(), beforeModule);
  assert.ok(before >= 0);

  const w2 = await world();
  const second = await preparedRun(w2);
  await testPrisma.materialIssueLine.updateMany({ where: { materialIssueId: second.issueId }, data: { issuedQty: 0.5 } });
  const shortRev = await runIntake(w2, second.run.id, 1);
  const short = await start(w2, w2.op, second.run.id, shortRev, "mat-short");
  assert.equal(short.status, 409); assert.equal(short.body.code, "WORKSHOP_MATERIAL_NOT_ISSUED");

  const w3 = await world();
  const third = await preparedRun(w3);
  await testPrisma.materialIssue.updateMany({ where: { id: third.issueId }, data: { status: "CANCELLED" } });
  const cancelledRev = await runIntake(w3, third.run.id, 1);
  assert.equal((await start(w3, w3.op, third.run.id, cancelledRev, "mat-cancelled")).status, 409, "issue terminal CANCELLED bukan bukti");
});

test("AUDIT F5: unit lahir-di-workshop harus segar — status non-RECEIVED, currentStage, atau log tahap V1 ditolak (tidak boleh melompati custody/legacy)", async () => {
  const w = await world();
  const make = async (status, extra = {}) => {
    const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Born" } });
    const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `BORN-${++seq}`, value: 1000, category: "BARU" } });
    return testPrisma.unit.create({ data: { unitCode: `UNIT-BORN-${++seq}`, orderId: order.id, seq: 1, status, ...extra } });
  };
  const inProduction = await make("IN_PRODUCTION");
  const ready = await make("READY_FOR_DELIVERY");
  const legacyStage = await testPrisma.routingStage.findFirstOrThrow({ orderBy: { sequence: "asc" } });
  const withStage = await make("RECEIVED", { currentStageId: legacyStage.id });
  const withLog = await make("RECEIVED");
  await testPrisma.unitStageLog.create({ data: { unitId: withLog.id, stageId: legacyStage.id, action: "START", actorId: w.op.user.id, startedAt: new Date() } });
  const fresh = await make("RECEIVED");
  await setWriter({ enabled: true, unitIds: [inProduction.id, ready.id, withStage.id, withLog.id, fresh.id] });
  const reg = (unitId, tag) => w.op.api.post("/api/production-planning/workshop/runs", { unitId }, key(tag));
  assert.equal((await reg(inProduction.id, "fresh-a")).body.code, "WORKSHOP_BORN_STATUS_INVALID");
  assert.equal((await reg(ready.id, "fresh-b")).body.code, "WORKSHOP_BORN_STATUS_INVALID");
  assert.equal((await reg(withStage.id, "fresh-c")).body.code, "WORKSHOP_BORN_UNIT_NOT_FRESH");
  assert.equal((await reg(withLog.id, "fresh-d")).body.code, "WORKSHOP_BORN_UNIT_NOT_FRESH");
  assert.equal(await testPrisma.productionRun.count(), 0, "tidak ada run terbentuk untuk unit legacy/berjalan");
  assert.equal((await reg(fresh.id, "fresh-e")).status, 201);
});

test("AUDIT F6: override manual V1 (unit jadi READY_FOR_DELIVERY/CANCELLED) menghentikan eksekusi V2 (409) tanpa menulis ledger tahap", async () => {
  const w = await world();
  const { run, unit } = await preparedRun(w);
  const s1 = await start(w, w.op, run.id, 1, "ovr-start");
  assert.equal(s1.status, 200);
  const logs = await testPrisma.unitStageLog.count({ where: { unitId: unit.id } });
  await testPrisma.unit.update({ where: { id: unit.id }, data: { status: "READY_FOR_DELIVERY" } });
  for (const [name, res] of [
    ["pause", await pause(w, w.op, run.id, s1.body.revision, "ovr-pause", { reason: "BREAK" })],
    ["complete", await complete(w, w.op, run.id, s1.body.revision, "ovr-complete")],
  ]) { assert.equal(res.status, 409, name); assert.equal(res.body.code, "WORKSHOP_UNIT_NOT_IN_PRODUCTION", name); }
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: unit.id } }), logs);

  const w2 = await world();
  const second = await preparedRun(w2);
  await testPrisma.unit.update({ where: { id: second.unit.id }, data: { status: "CANCELLED" } });
  const cancelled = await start(w2, w2.op, second.run.id, 1, "ovr-start-cancelled");
  assert.equal(cancelled.status, 409); assert.equal(cancelled.body.code, "WORKSHOP_UNIT_NOT_IN_PRODUCTION");
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: second.unit.id } }), 0);
});

test("AUDIT lock order: start bersamaan dengan assign P3 (2x) dan V1 fail pada run/unit/plan yang sama tidak deadlock dan tidak saling merusak", async () => {
  const w = await world();
  const { run, unit, planId } = await preparedRun(w);
  const P = "/api/production-planning";
  const firstStage = await testPrisma.routingStage.findFirstOrThrow({ orderBy: { sequence: "asc" } });
  const assignNow = async (tag) => {
    const plan = await testPrisma.productionRunPlan.findUniqueOrThrow({ where: { id: planId } });
    return w.op.api.post(`${P}/plans/${planId}/assign`, { workCenterId: w.wc, operatorId: w.operator.id, targetStartAt: "2026-09-28T02:00:00.000Z", targetCompleteAt: "2026-09-28T10:00:00.000Z", expectedRevision: plan.revision }, key(tag));
  };
  const v1Fail = failStage(unit.id, firstStage.id, { actorId: w.op.user.id, blockReason: "MACHINE_DOWN", note: "mesin mati" }).then(() => "V1_FAIL_LOLOS", (error) => `V1_${error.statusCode ?? error.code}`);
  const outcomes = await Promise.all([start(w, w.op, run.id, 1, "lock-start"), assignNow("lock-assign-1"), assignNow("lock-assign-2"), v1Fail]);
  const [startRes, assignA, assignB, v1] = outcomes;
  assert.equal(startRes.status, 200, JSON.stringify(startRes.body));
  // V1 fail bisa saja kalah lomba dari start (unit belum punya tahap berjalan -> 400) atau menang lomba pagar (409); tidak pernah lolos.
  assert.ok(["V1_409", "V1_400"].includes(v1), v1);
  for (const res of [assignA, assignB]) assert.ok([200, 409].includes(res.status), JSON.stringify(res.body));
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: unit.id, action: "START" } }), 1);
  assert.equal(await testPrisma.productionBlocker.count({ where: { unitId: unit.id } }), 0);
  const rev = (await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).revision;
  assert.equal((await pause(w, w.op, run.id, rev, "lock-pause", { reason: "BREAK" })).status, 200);
});
