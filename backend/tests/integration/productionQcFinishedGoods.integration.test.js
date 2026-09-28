// P6 QC V2 + rework + barang jadi + rekonsiliasi override V1: lifecycle AWAITING_QC -> ... -> run COMPLETED / unit READY_FOR_DELIVERY.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

let server;
let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (v) => ({ "Idempotency-Key": `p6-test-${v}-0001` });
const PHOTO = ["/media/job-photos/p6.jpg"];
const P = "/api/production-planning";
const W = `${P}/workshop/runs`;
const Q = `${P}/qc/runs`;

async function setFlag(flagKey, { enabled, unitIds }) {
  const data = { enabled, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "p6 test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
async function addCohort(...unitIds) {
  for (const flagKey of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
    const row = await testPrisma.v2FeatureFlag.findUnique({ where: { key: flagKey } });
    const current = row?.enabled ? (row.config?.unitIds ?? []) : [];
    await setFlag(flagKey, { enabled: true, unitIds: [...new Set([...current, ...unitIds])] });
  }
}

async function world() {
  const [lead, gudang, gudang2, qc, qc2, admin] = await Promise.all(
    ["PRODUCTION_LEAD", "WAREHOUSE", "WAREHOUSE", "QC_LEAD", "QC_LEAD", "ADMIN"].map((role) => createTestUser({ roles: [role] })),
  );
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-P6-${++seq}`, name: "Workshop P6" } });
  const operator = await testPrisma.productionOperator.create({ data: { userId: lead.user.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-P6-${++seq}`, name: "Gudang P6" } });
  const loc = (zone, locationType, extra = {}) => testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone, locationType, code: `${zone}-P6-${++seq}`, ...extra } });
  const fgArea = await loc("FG", "FINISHED_GOODS_AREA");
  const rcvArea = await loc("RCV", "RECEIVING_AREA");
  const fgInactive = await loc("FGX", "FINISHED_GOODS_AREA", { active: false });
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  const service = await testPrisma.serviceCatalog.findFirstOrThrow({ orderBy: { sortOrder: "asc" } });
  return { op: c(lead), gudang: c(gudang), gudang2: c(gudang2), qc: c(qc), qc2: c(qc2), admin: c(admin), workCenter, wc: workCenter.id, operator, fgArea, rcvArea, fgInactive, service };
}

async function acceptedUnit() {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const dapi = makeClient(server.baseUrl, driver.token);
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan P6" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `P6O-${++seq}`, value: 1000, category: "LAYANAN" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-P6-${++seq}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP" } });
  const route = await testPrisma.route.create({ data: { code: `P6-RTE-${++seq}`, date: new Date("2026-09-28T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: driver.user.id } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, driverId: driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-09-28T00:00:00.000Z") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  await addCohort(unit.id);
  const tag = `acc-${++seq}`;
  await dapi.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}-s`));
  await dapi.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${tag}-a`));
  const done = await dapi.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga", note: "ok", location: null }, key(`${tag}-c`));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: unit.id, direction: "INBOUND" } });
  const wh = await createTestUser({ roles: ["WAREHOUSE"] });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-IN-${++seq}`, name: "Gudang Masuk" } });
  const loc = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-IN-${++seq}` } });
  const acc = await makeClient(server.baseUrl, wh.token).post(`/api/inventory/unit-custody/${handoff.id}/accept`, { locationId: loc.id, expectedRevision: 1 }, key(`${tag}-x`));
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  return { unit, run: await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } }) };
}

// Unit BARU/SEWA lahir di workshop (tanpa pickup) -> run WORKSHOP_BORN lewat command P5.
async function bornUnit(w, category) {
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan ${category}` } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `P6B-${++seq}`, value: 1000, category } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-P6B-${++seq}`, orderId: order.id, seq: 1, status: "RECEIVED" } });
  await addCohort(unit.id);
  const reg = await w.op.api.post(W, { unitId: unit.id }, key(`born-${++seq}`));
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  return { unit, run: await testPrisma.productionRun.findUniqueOrThrow({ where: { id: reg.body.runId } }) };
}

// Plan MATERIAL_RESERVED + material ISSUED (P3-P4) untuk run/unit yang diberikan.
async function prepare(w, { born = null } = {}) {
  const { unit, run } = born ? await bornUnit(w, born) : await acceptedUnit();
  await testPrisma.unit.update({ where: { id: unit.id }, data: { serviceId: w.service.id } });
  const created = await w.op.api.post(`${P}/plans`, { runId: run.id }, key(`c-${++seq}`));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const planId = created.body.planId;
  const as = await w.op.api.post(`${P}/plans/${planId}/assign`, { workCenterId: w.wc, operatorId: w.operator.id, targetStartAt: "2026-09-28T01:00:00.000Z", targetCompleteAt: "2026-09-28T09:00:00.000Z", expectedRevision: 1 }, key(`as-${++seq}`));
  const material = await createTestMaterial({ name: `Mat P6 ${++seq}` });
  await seedBalance(material.id, 10);
  const bom = await w.op.api.post(`${P}/plans/${planId}/bom`, { lines: [{ materialId: material.id, qty: 2 }], expectedRevision: as.body.revision }, key(`b-${++seq}`));
  const res = await w.gudang.api.post(`${P}/plans/${planId}/reserve`, { expectedRevision: bom.body.revision }, key(`r-${++seq}`));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const req = await w.op.api.post(`${P}/plans/${planId}/material-request`, {}, key(`mr-${++seq}`));
  const pk = await w.gudang.api.post(`${P}/material-requests/${req.body.issueId}/pick`, { expectedRevision: 1 }, key(`pk-${++seq}`));
  assert.equal(pk.status, 200, JSON.stringify(pk.body));
  return { unit, run, planId, issueId: req.body.issueId, material };
}

const call = (who, runId, action, body, tag) => who.api.post(`${W}/${runId}/${action}`, body, key(tag));
const start = (w, runId, rev, tag) => call(w.op, runId, "start", { expectedRevision: rev, workCenterId: w.wc }, tag);
const complete = (w, runId, rev, tag) => call(w.op, runId, "complete", { expectedRevision: rev, workCenterId: w.wc, photoUrls: PHOTO }, tag);
const inspect = (who, runId, body, tag) => who.api.post(`${Q}/${runId}/inspect`, body, key(tag));
const passBody = (rev, extra = {}) => ({ expectedRevision: rev, result: "PASS", photoUrls: PHOTO, referenceWeightKg: 60, fitVerdict: "PAS", note: "lulus uji", ...extra });
const detail = async (w, runId) => (await w.op.api.get(`${Q}/${runId}`)).body;
const accept = (who, handoffId, rev, locationId, tag) => who.api.post(`/api/inventory/unit-custody/${handoffId}/accept`, { locationId, expectedRevision: rev }, key(tag));
const reject = (who, handoffId, rev, reason, tag) => who.api.post(`/api/inventory/unit-custody/${handoffId}/reject`, { reason, expectedRevision: rev }, key(tag));

async function runToAwaitingQc(w, runId, rev) {
  for (let guard = 0; guard < 30; guard += 1) {
    const s = await start(w, runId, rev, `all-s-${++seq}`);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const c = await complete(w, runId, s.body.revision, `all-c-${++seq}`);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    rev = c.body.revision;
    if (c.body.awaitingQc) return c.body;
  }
  throw new Error("tidak pernah mencapai AWAITING_QC");
}
// Setelah QC lulus/di-waive: eksekusi tahap SETELAH gerbang lewat command P5 sampai handoff barang jadi terbentuk.
async function runThroughPostQc(w, runId, rev) {
  const codes = [];
  for (let guard = 0; guard < 10; guard += 1) {
    const s = await start(w, runId, rev, `post-s-${++seq}`);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const c = await complete(w, runId, s.body.revision, `post-c-${++seq}`);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    codes.push(s.body.stage.code);
    rev = c.body.revision;
    if (c.body.handoffReady) return { ...c.body, codes };
  }
  throw new Error("handoff tidak pernah terbentuk");
}

const ledger = async () => ({
  movements: await testPrisma.stockMovement.count(),
  reservations: JSON.stringify((await testPrisma.materialReservation.groupBy({ by: ["status"], _count: true })).map((r) => [r.status, r._count]).sort()),
  journals: await testPrisma.finJournalEntry.count(),
  issues: await testPrisma.materialIssue.count(),
});
const fgHandoffs = (unitId) => testPrisma.unitCustodyHandoff.findMany({ where: { unitId, direction: "FINISHED_GOODS" }, orderBy: { offeredAt: "asc" } });
const phasesOf = async (runId) => Object.fromEntries((await testPrisma.productionPhaseRun.findMany({ where: { runId } })).map((p) => [p.phase, p.status]));
const snapshot = async (runId, unitId) => ({
  inspections: await testPrisma.qualityInspection.count(), fitTests: await testPrisma.qcFitTest.count(), commands: await testPrisma.v2Command.count(),
  outbox: await testPrisma.domainOutbox.count(), activities: await testPrisma.activityEvent.count(), stageLogs: await testPrisma.unitStageLog.count({ where: { unitId } }),
  fg: await testPrisma.unitCustodyHandoff.count({ where: { unitId, direction: "FINISHED_GOODS" } }),
  run: JSON.stringify(await testPrisma.productionRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true, revision: true, currentPhase: true } })),
  unit: JSON.stringify(await testPrisma.unit.findUniqueOrThrow({ where: { id: unitId }, select: { status: true, currentStageId: true, storageLocation: true } })),
});

async function toAwaitingQc(w, opts) {
  const p = await prepare(w, opts);
  const at = await runToAwaitingQc(w, p.run.id, 1);
  return { ...p, revision: at.revision };
}
// Lifecycle lengkap dari AWAITING_QC sampai unit siap kirim (dipakai lintas tipe unit).
async function finishLifecycle(w, p) {
  const pass = await inspect(w.qc, p.run.id, passBody(p.revision), `life-${++seq}`);
  assert.equal(pass.status, 200, JSON.stringify(pass.body));
  const post = await runThroughPostQc(w, p.run.id, pass.body.revision);
  const [handoff] = await fgHandoffs(p.unit.id);
  const acc = await accept(w.gudang, handoff.id, handoff.revision, w.fgArea.id, `life-acc-${++seq}`);
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  return { pass, post, handoff, acc };
}

test("PASS -> tahap setelah QC (corner_sewing, finished) -> handoff barang jadi -> Gudang ACCEPTED -> run COMPLETED + unit READY_FOR_DELIVERY (tanpa stok/HPP)", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const ledgerBefore = await ledger();
  const res = await inspect(w.qc, p.run.id, passBody(p.revision), "t1-pass");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.result, "PASS"); assert.equal(res.body.nextPhase, "PROCESS"); assert.equal(res.body.handoffId, undefined);

  const inspection = await testPrisma.qualityInspection.findFirstOrThrow({ where: { runId: p.run.id }, include: { items: true } });
  assert.equal(inspection.result, "PASS"); assert.equal(inspection.version, 1); assert.equal(inspection.disposition, "PASSED");
  assert.deepEqual(inspection.items.find((i) => i.itemCode === "OVERALL").photoUrls, PHOTO);
  const fit = await testPrisma.qcFitTest.findFirstOrThrow({ where: { unitId: p.unit.id } });
  assert.equal(fit.verdict, "PAS"); assert.equal(fit.referenceWeightKg, 60); assert.equal(inspection.qcFitTestId, fit.id, "proyeksi V1 terhubung ke inspeksi V2");
  assert.equal((await fgHandoffs(p.unit.id)).length, 0, "QC PASS TIDAK langsung membuat handoff");
  assert.deepEqual(await phasesOf(p.run.id), { INTAKE: "COMPLETED", DIAGNOSIS: "NOT_APPLICABLE", PROCESS: "ACTIVE", QC: "COMPLETED", HANDOFF: "NOT_STARTED" });
  let unitRow = await testPrisma.unit.findUniqueOrThrow({ where: { id: p.unit.id }, include: { currentStage: true } });
  assert.equal(unitRow.status, "IN_PRODUCTION"); assert.equal(unitRow.currentStage.code, "corner_sewing");
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } })).currentPhase, "PROCESS");

  const post = await runThroughPostQc(w, p.run.id, res.body.revision);
  assert.deepEqual(post.codes, ["corner_sewing", "finished"]);
  assert.equal(post.handoffReady, true); assert.ok(post.handoffId);
  const [handoff] = await fgHandoffs(p.unit.id);
  assert.equal(handoff.status, "OFFERED"); assert.equal(handoff.deliveryJobId, null); assert.equal(handoff.productionRunId, p.run.id);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } })).currentPhase, "HANDOFF");
  assert.equal((await phasesOf(p.run.id)).HANDOFF, "ACTIVE");
  unitRow = await testPrisma.unit.findUniqueOrThrow({ where: { id: p.unit.id } });
  assert.equal(unitRow.status, "IN_PRODUCTION", "unit BELUM READY_FOR_DELIVERY sebelum Gudang menerima");
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "warehouse.custody.offered", aggregateId: handoff.id } }), 1);

  // Gudang: lokasi wajib, aktif, dan bertipe sesuai; revisi basi ditolak.
  assert.equal((await w.gudang.api.post(`/api/inventory/unit-custody/${handoff.id}/accept`, { expectedRevision: 1 }, key("t1-noloc"))).status, 400);
  const badType = await accept(w.gudang, handoff.id, 1, w.rcvArea.id, "t1-badtype");
  assert.equal(badType.status, 422); assert.equal(badType.body.code, "CUSTODY_LOCATION_TYPE_INVALID");
  const inactive = await accept(w.gudang, handoff.id, 1, w.fgInactive.id, "t1-inactive");
  assert.equal(inactive.status, 422); assert.equal(inactive.body.code, "CUSTODY_LOCATION_INVALID");
  assert.equal((await accept(w.gudang, handoff.id, 9, w.fgArea.id, "t1-stale")).status, 409);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: p.unit.id } })).status, "IN_PRODUCTION");

  const acc = await accept(w.gudang, handoff.id, 1, w.fgArea.id, "t1-accept");
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  assert.equal(acc.body.runStatus, "COMPLETED"); assert.equal(acc.body.unitStatus, "READY_FOR_DELIVERY");
  const run = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } });
  assert.equal(run.status, "COMPLETED"); assert.ok(run.completedAt);
  assert.equal((await phasesOf(p.run.id)).HANDOFF, "COMPLETED");
  unitRow = await testPrisma.unit.findUniqueOrThrow({ where: { id: p.unit.id } });
  assert.equal(unitRow.status, "READY_FOR_DELIVERY"); assert.equal(unitRow.storageLocation, w.fgArea.code, "lokasi legacy diproyeksikan dari lokasi kanonis");
  const accepted = (await fgHandoffs(p.unit.id))[0];
  assert.equal(accepted.status, "ACCEPTED"); assert.equal(accepted.locationId, w.fgArea.id);
  assert.deepEqual(await ledger(), ledgerBefore, "QC/handoff tidak menulis stok/reservasi/jurnal/issue");

  const snap = await snapshot(p.run.id, p.unit.id);
  const replay = await accept(w.gudang, handoff.id, 1, w.fgArea.id, "t1-accept");
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.deepEqual(await snapshot(p.run.id, p.unit.id), snap, "replay tidak menambah apa pun");
});

test("FAIL -> rework pada tahap eksplisit -> WAJIB kembali ke QC -> QC ulang PASS; inspeksi lama immutable; tanpa dokumen/stok baru", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const d = await detail(w, p.run.id);
  const gate = d.stages.find((s) => s.isQcGate);
  const preGate = d.stages.filter((s) => !s.isQcGate && s.order < gate.order);
  const reworkStage = preGate.at(-1);
  const ledgerBefore = await ledger();
  const opsBefore = await testPrisma.productionOperationRun.count({ where: { runId: p.run.id } });

  const failBody = { expectedRevision: p.revision, result: "FAIL", photoUrls: PHOTO, referenceWeightKg: 55, fitVerdict: "TERLALU_KERAS", note: "kasur terlalu keras", reworkStageId: reworkStage.id };
  const fail = await inspect(w.qc, p.run.id, failBody, "t2-fail");
  assert.equal(fail.status, 200, JSON.stringify(fail.body));
  assert.equal(fail.body.result, "FAIL"); assert.equal(fail.body.nextPhase, "PROCESS"); assert.equal(fail.body.reworkStage.id, reworkStage.id);
  const v1 = await testPrisma.qualityInspection.findFirstOrThrow({ where: { runId: p.run.id, version: 1 }, include: { items: true } });
  assert.equal(v1.result, "FAIL_REWORK"); assert.match(v1.disposition, /^REWORK:/);
  assert.equal((await testPrisma.qcFitTest.findFirstOrThrow({ where: { unitId: p.unit.id } })).verdict, "TERLALU_KERAS");
  const gateFail = await testPrisma.unitStageLog.findFirstOrThrow({ where: { unitId: p.unit.id, stageId: gate.id, action: "FAIL" } });
  assert.equal(gateFail.blockReason, "QUALITY_ISSUE");
  const unitRow = await testPrisma.unit.findUniqueOrThrow({ where: { id: p.unit.id } });
  assert.equal(unitRow.currentStageId, reworkStage.id);
  assert.deepEqual(await phasesOf(p.run.id), { INTAKE: "COMPLETED", DIAGNOSIS: "NOT_APPLICABLE", PROCESS: "ACTIVE", QC: "NOT_STARTED", HANDOFF: "NOT_STARTED" });
  assert.equal((await fgHandoffs(p.unit.id)).length, 0);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } })).revision, p.revision + 1, "revisi run bertambah");

  // Tidak boleh langsung PASS/HANDOFF: QC ulang sebelum rework selesai ditolak.
  const again = await inspect(w.qc, p.run.id, passBody(fail.body.revision), "t2-again");
  assert.equal(again.status, 409); assert.equal(again.body.code, "QC_NOT_AWAITING");

  // Inspeksi immutable (trigger database): update/delete ditolak, termasuk butir.
  await assert.rejects(testPrisma.qualityInspection.update({ where: { id: v1.id }, data: { disposition: "PASSED" } }), /immutable/i);
  await assert.rejects(testPrisma.qualityInspection.delete({ where: { id: v1.id } }), /immutable/i);
  await assert.rejects(testPrisma.qualityInspectionItem.update({ where: { id: v1.items[0].id }, data: { result: "PASS" } }), /immutable/i);

  // Rework lewat command P5 pada tahap yang ditentukan, lalu WAJIB kembali ke gerbang QC (bukan handoff).
  const s = await start(w, p.run.id, fail.body.revision, "t2-rework-start");
  assert.equal(s.status, 200, JSON.stringify(s.body)); assert.equal(s.body.stage.id, reworkStage.id);
  const c = await complete(w, p.run.id, s.body.revision, "t2-rework-complete");
  assert.equal(c.status, 200, JSON.stringify(c.body)); assert.equal(c.body.awaitingQc, true); assert.equal(c.body.handoffReady, false);
  assert.equal((await testPrisma.productionOperationRun.count({ where: { runId: p.run.id } })), opsBefore + 1, "operasi bertambah");
  const blocked = await start(w, p.run.id, c.body.revision, "t2-start-after-rework");
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, "WORKSHOP_AWAITING_QC");
  assert.deepEqual(await ledger(), ledgerBefore, "rework tanpa bahan tambahan tidak membuat dokumen/stok/HPP");

  const pass = await inspect(w.qc2, p.run.id, passBody(c.body.revision), "t2-pass");
  assert.equal(pass.status, 200, JSON.stringify(pass.body)); assert.equal(pass.body.version, 2);
  const inspections = await testPrisma.qualityInspection.findMany({ where: { runId: p.run.id }, orderBy: { version: "asc" } });
  assert.deepEqual(inspections.map((i) => i.result), ["FAIL_REWORK", "PASS"]);
  assert.equal(inspections[0].disposition, v1.disposition, "histori inspeksi lama tidak berubah");
  const post = await runThroughPostQc(w, p.run.id, pass.body.revision);
  const [handoff] = await fgHandoffs(p.unit.id);
  assert.equal(post.handoffReady, true);
  const acc = await accept(w.gudang, handoff.id, 1, w.fgArea.id, "t2-accept");
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: p.unit.id } })).status, "READY_FOR_DELIVERY");
});

test("FAIL: tahap rework harus eksplisit dan SEBELUM gerbang; galat me-rollback seluruh transaksi (tanpa inspeksi/qc_fit_tests/log)", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const d = await detail(w, p.run.id);
  const gate = d.stages.find((s) => s.isQcGate);
  const postGate = d.stages.find((s) => !s.isQcGate && s.order > gate.order);
  const before = await snapshot(p.run.id, p.unit.id);
  const base = { expectedRevision: p.revision, result: "FAIL", photoUrls: PHOTO, referenceWeightKg: 55, fitVerdict: "TERLALU_EMPUK", note: "kurang padat" };
  assert.equal((await inspect(w.qc, p.run.id, base, "t3-norework")).body.code, "QC_REWORK_STAGE_REQUIRED");
  for (const [tag, stageId] of [["gate", gate.id], ["post", postGate.id], ["unknown", "00000000-0000-0000-0000-000000000000"]]) {
    const res = await inspect(w.qc, p.run.id, { ...base, reworkStageId: stageId }, `t3-${tag}`);
    assert.equal(res.status, 422, `${tag}: ${JSON.stringify(res.body)}`);
  }
  assert.deepEqual(await snapshot(p.run.id, p.unit.id), before, "tidak ada jejak V1/V2 dari percobaan yang ditolak");
});

test("FAIL + bahan tambahan: request supplemental (P3/P4) terhubung ke inspeksi; rework TIDAK dimulai sebelum ISSUED; reservasi asli tidak disentuh; kekurangan stok me-rollback QC", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const extra = await createTestMaterial({ name: `Mat Tambahan ${++seq}` });
  await seedBalance(extra.id, 10);
  const d = await detail(w, p.run.id);
  const gate = d.stages.find((s) => s.isQcGate);
  const reworkStage = d.stages.filter((s) => !s.isQcGate && s.order < gate.order).at(-1);
  const baseReservation = await testPrisma.materialReservation.findFirstOrThrow({ where: { planId: p.planId } });
  const baseMovements = await testPrisma.stockMovement.count();
  const baseBody = { result: "FAIL", photoUrls: PHOTO, referenceWeightKg: 55, fitVerdict: "TERLALU_KERAS", note: "perlu tambahan busa", reworkStageId: reworkStage.id };

  // Kekurangan stok: seluruh QC FAIL dibatalkan.
  const before = await snapshot(p.run.id, p.unit.id);
  const short = await inspect(w.qc, p.run.id, { ...baseBody, expectedRevision: p.revision, supplementalMaterials: [{ materialId: extra.id, qty: 999 }] }, "t4-short");
  assert.equal(short.status, 409); assert.equal(short.body.code, "PLAN_MATERIAL_SHORTAGE");
  assert.deepEqual(await snapshot(p.run.id, p.unit.id), before);
  assert.equal(await testPrisma.materialIssue.count({ where: { reworkInspectionId: { not: null } } }), 0);

  const fail = await inspect(w.qc, p.run.id, { ...baseBody, expectedRevision: p.revision, supplementalMaterials: [{ materialId: extra.id, qty: 1 }] }, "t4-fail");
  assert.equal(fail.status, 200, JSON.stringify(fail.body));
  const issueId = fail.body.supplementalIssue.issueId;
  const issue = await testPrisma.materialIssue.findUniqueOrThrow({ where: { id: issueId }, include: { lines: true } });
  assert.equal(issue.reworkInspectionId, fail.body.inspectionId); assert.equal(issue.status, "READY_TO_PICK"); assert.equal(issue.lines.length, 1);
  const bomLine = await testPrisma.plannedBOMLine.findFirstOrThrow({ where: { supplementalInspectionId: fail.body.inspectionId } });
  assert.equal(bomLine.materialId, extra.id);
  const supplementalReservation = await testPrisma.materialReservation.findUniqueOrThrow({ where: { id: issue.lines[0].reservationId } });
  assert.equal(supplementalReservation.status, "ACTIVE");
  const baseAfter = await testPrisma.materialReservation.findUniqueOrThrow({ where: { id: baseReservation.id } });
  assert.equal(baseAfter.status, "CONSUMED"); assert.equal(baseAfter.revision, baseReservation.revision, "reservasi asli CONSUMED tidak dibuka/diubah");
  assert.equal(await testPrisma.stockMovement.count(), baseMovements, "belum ada stok keluar sebelum diserahkan");

  const blocked = await start(w, p.run.id, fail.body.revision, "t4-start-blocked");
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, "WORKSHOP_MATERIAL_NOT_ISSUED");
  const pick = await w.gudang.api.post(`${P}/material-requests/${issueId}/pick`, { expectedRevision: 1 }, key("t4-pick"));
  assert.equal(pick.status, 200, JSON.stringify(pick.body));
  assert.equal(await testPrisma.stockMovement.count({ where: { materialIssueId: issueId } }), 1, "stock movement lewat jalur P4");
  assert.equal(await testPrisma.stockMovement.count({ where: { materialIssueId: p.issueId } }), 1, "konsumsi bahan asli tidak digandakan");
  const started = await start(w, p.run.id, fail.body.revision, "t4-start-ok");
  assert.equal(started.status, 200, JSON.stringify(started.body));
});

test("bahan tambahan menyusul (rework-material): sekali per inspeksi, tidak setelah rework dimulai; batal sebelum serah -> plan tetap Bahan Direservasi dan rework boleh lanjut", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const extra = await createTestMaterial({ name: `Mat Susulan ${++seq}` });
  await seedBalance(extra.id, 5);
  const d = await detail(w, p.run.id);
  const gate = d.stages.find((s) => s.isQcGate);
  const reworkStage = d.stages.filter((s) => !s.isQcGate && s.order < gate.order).at(-1);
  const fail = await inspect(w.qc, p.run.id, { expectedRevision: p.revision, result: "FAIL", photoUrls: PHOTO, referenceWeightKg: 55, fitVerdict: "TERLALU_EMPUK", note: "kurang padat", reworkStageId: reworkStage.id }, "t5-fail");
  assert.equal(fail.status, 200, JSON.stringify(fail.body)); assert.equal(fail.body.supplementalIssue, undefined);
  assert.equal(await testPrisma.materialIssue.count({ where: { reworkInspectionId: { not: null } } }), 0, "tanpa tambahan bahan tidak ada dokumen kosong");

  const lines = [{ materialId: extra.id, qty: 2 }];
  const req = await w.op.api.post(`${Q}/${p.run.id}/rework-material`, { expectedRevision: fail.body.revision, lines }, key("t5-req"));
  assert.equal(req.status, 201, JSON.stringify(req.body));
  const dup = await w.op.api.post(`${Q}/${p.run.id}/rework-material`, { expectedRevision: req.body.revision, lines }, key("t5-dup"));
  assert.equal(dup.status, 409); assert.equal(dup.body.code, "QC_REWORK_MATERIAL_EXISTS");
  const cancel = await w.gudang.api.post(`${P}/material-requests/${req.body.supplementalIssue.issueId}/cancel`, { expectedRevision: 1, reason: "tidak jadi dipakai" }, key("t5-cancel"));
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal((await testPrisma.productionRunPlan.findUniqueOrThrow({ where: { id: p.planId } })).status, "MATERIAL_RESERVED", "reservasi asli tetap; plan tidak turun ke PLANNED");
  assert.equal(await testPrisma.materialReservation.count({ where: { planId: p.planId, status: "RELEASED" } }), 1);
  assert.equal(await testPrisma.plannedBOMLine.count({ where: { planId: p.planId, status: "CANCELLED" } }), 1);
  const rev = (await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } })).revision;
  const started = await start(w, p.run.id, rev, "t5-start");
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const late = await w.op.api.post(`${Q}/${p.run.id}/rework-material`, { expectedRevision: started.body.revision, lines }, key("t5-late"));
  assert.equal(late.status, 409);
});

test("QC_WAIVED: hanya QC_WAIVE (ADMIN/OWNER), alasan + audit wajib, tercatat OVERRIDDEN (bukan PASS), tanpa qc_fit_tests; lanjut seperti PASS", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const waive = (who, extra, tag) => inspect(who, p.run.id, { expectedRevision: p.revision, result: "WAIVED", ...extra }, tag);
  const noAuth = await waive(w.qc, { reason: "Pelanggan minta dilewati karena mendesak sekali" }, "t6-qc");
  assert.equal(noAuth.status, 403); assert.equal(noAuth.body.code, "QC_WAIVE_FORBIDDEN");
  const lead = await waive(w.op, { reason: "Pelanggan minta dilewati karena mendesak sekali" }, "t6-lead");
  assert.equal(lead.status, 403, "Production Lead tidak boleh mem-waive QC-nya sendiri");
  const short = await waive(w.admin, { reason: "singkat" }, "t6-short");
  assert.equal(short.status, 400); assert.equal(short.body.code, "QC_WAIVE_REASON_REQUIRED");
  const adminPass = await inspect(w.admin, p.run.id, passBody(p.revision), "t6-adminpass");
  assert.equal(adminPass.status, 403); assert.equal(adminPass.body.code, "QC_WRITE_REQUIRED", "ADMIN tidak boleh mencatat PASS (tidak memegang QC_WRITE)");
  assert.equal(await testPrisma.qualityInspection.count(), 0);

  const reason = "Owner menyetujui pengiriman tanpa QC karena unit hanya perlu jahit ulang ringan";
  const ok = await waive(w.admin, { reason }, "t6-ok");
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.result, "WAIVED"); assert.equal(ok.body.dbResult, "OVERRIDDEN"); assert.equal(ok.body.qcFitTestId, null);
  const inspection = await testPrisma.qualityInspection.findFirstOrThrow({ where: { runId: p.run.id } });
  assert.equal(inspection.result, "OVERRIDDEN"); assert.notEqual(inspection.result, "PASS"); assert.equal(inspection.disposition, "QC_WAIVED");
  assert.equal(inspection.overrideReason, reason); assert.equal(inspection.inspectorId, w.admin.user.id); assert.equal(inspection.qcFitTestId, null);
  assert.equal(await testPrisma.qcFitTest.count(), 0, "tidak ada berat acuan dikarang");
  const skip = await testPrisma.unitStageLog.findFirstOrThrow({ where: { unitId: p.unit.id, action: "SKIP" } });
  assert.match(skip.note, /QC_WAIVED/);
  assert.equal(await testPrisma.activityEvent.count({ where: { eventType: "PRODUCTION_QC_WAIVED", entityId: p.unit.id } }), 1, "audit waive tercatat");
  assert.equal((await phasesOf(p.run.id)).QC, "COMPLETED");

  const post = await runThroughPostQc(w, p.run.id, ok.body.revision);
  const [handoff] = await fgHandoffs(p.unit.id);
  assert.equal(post.handoffReady, true);
  const offered = await testPrisma.domainOutbox.findFirstOrThrow({ where: { eventType: "warehouse.custody.offered", aggregateId: handoff.id } });
  assert.equal(offered.payload.qcBasis, "QC_WAIVED");
  const acc = await accept(w.gudang, handoff.id, 1, w.fgArea.id, "t6-accept");
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
});

test("validasi input QC: foto wajib (PASS/FAIL), berat acuan, hasil uji vs PASS, catatan FAIL; PASS tidak boleh memuat butir NOT_OK", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const before = await snapshot(p.run.id, p.unit.id);
  const cases = [
    ["nophoto", passBody(p.revision, { photoUrls: [] }), 400, "QC_EVIDENCE_REQUIRED"],
    ["noweight", passBody(p.revision, { referenceWeightKg: undefined }), 400, "QC_WEIGHT_REQUIRED"],
    ["keras", passBody(p.revision, { fitVerdict: "TERLALU_KERAS" }), 422, "QC_VERDICT_NOT_PASSING"],
    ["itemnok", passBody(p.revision, { items: [{ itemCode: "JAHITAN", label: "Jahitan rapi", result: "NOT_OK" }] }), 422, "QC_ITEM_CONTRADICTS"],
    ["badresult", passBody(p.revision, { result: "MAYBE" }), 400, "QC_RESULT_INVALID"],
    ["failnote", { expectedRevision: p.revision, result: "FAIL", photoUrls: PHOTO, referenceWeightKg: 50, fitVerdict: "TERLALU_KERAS", reworkStageId: "x" }, 400, "QC_NOTE_REQUIRED"],
    ["failverdict", { expectedRevision: p.revision, result: "FAIL", photoUrls: PHOTO, referenceWeightKg: 50, note: "buruk", reworkStageId: "x" }, 422, "QC_FAIL_VERDICT_REQUIRED"],
    ["failnophoto", { expectedRevision: p.revision, result: "FAIL", referenceWeightKg: 50, fitVerdict: "TERLALU_KERAS", note: "buruk", reworkStageId: "x" }, 400, "QC_EVIDENCE_REQUIRED"],
    ["norev", { ...passBody(p.revision), expectedRevision: undefined }, 400, "EXPECTED_REVISION_REQUIRED"],
  ];
  for (const [tag, body, status, code] of cases) {
    const res = await inspect(w.qc, p.run.id, body, `t7-${tag}`);
    assert.equal(res.status, status, `${tag}: ${JSON.stringify(res.body)}`); assert.equal(res.body.code, code, tag);
  }
  const noKey = await w.qc.api.post(`${Q}/${p.run.id}/inspect`, passBody(p.revision));
  assert.equal(noKey.status, 400); assert.equal(noKey.body.code, "IDEMPOTENCY_KEY_INVALID");
  assert.deepEqual(await snapshot(p.run.id, p.unit.id), before);
  const early = await prepare(w);
  const tooEarly = await inspect(w.qc, early.run.id, passBody(1), "t7-early");
  assert.equal(tooEarly.status, 409); assert.equal(tooEarly.body.code, "QC_NOT_AWAITING", "QC hanya untuk run AWAITING_QC");
});

test("penolakan Gudang atas barang jadi: alasan wajib, histori dipertahankan, kasus kembali ke Production; TAWARKAN ULANG lalu diterima", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const pass = await inspect(w.qc, p.run.id, passBody(p.revision), "t8-pass");
  await runThroughPostQc(w, p.run.id, pass.body.revision);
  const [first] = await fgHandoffs(p.unit.id);
  const noReason = await reject(w.gudang, first.id, 1, "  ", "t8-noreason");
  assert.equal(noReason.status, 400);
  const rejected = await reject(w.gudang, first.id, 1, "Cover sobek di sudut kiri", "t8-reject");
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body)); assert.equal(rejected.body.returnedToProduction, true);
  let run = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } });
  assert.equal(run.status, "ACTIVE"); assert.equal(run.currentPhase, "HANDOFF");
  assert.equal((await phasesOf(p.run.id)).HANDOFF, "BLOCKED");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: p.unit.id } })).status, "IN_PRODUCTION");
  const queue = await w.op.api.get(`${P}/qc/queue?tab=REJECTED`);
  assert.equal(queue.body.items.length, 1); assert.equal(queue.body.items[0].runId, p.run.id);

  const res = (body, tag) => w.op.api.post(`${Q}/${p.run.id}/handoff-rejection`, body, key(tag));
  assert.equal((await res({ expectedRevision: run.revision, action: "REOFFER", note: "" }, "t8-nonote")).status, 400);
  const reoffer = await res({ expectedRevision: run.revision, action: "REOFFER", note: "Sudut cover sudah dijahit ulang" }, "t8-reoffer");
  assert.equal(reoffer.status, 200, JSON.stringify(reoffer.body));
  const handoffs = await fgHandoffs(p.unit.id);
  assert.deepEqual(handoffs.map((h) => h.status), ["REJECTED", "OFFERED"], "riwayat penolakan dipertahankan; tawaran baru dibuat");
  assert.equal(handoffs[0].reason, "Cover sobek di sudut kiri");
  assert.equal((await phasesOf(p.run.id)).HANDOFF, "ACTIVE");
  const replay = await res({ expectedRevision: run.revision, action: "REOFFER", note: "Sudut cover sudah dijahit ulang" }, "t8-reoffer");
  assert.equal(replay.body.replayed, true); assert.equal((await fgHandoffs(p.unit.id)).length, 2);
  const acc = await accept(w.gudang, handoffs[1].id, 1, w.fgArea.id, "t8-accept");
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  run = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } });
  assert.equal(run.status, "COMPLETED");
});

test("penolakan Gudang -> REWORK (tahap eksplisit sebelum QC): run kembali ke PROCESS, WAJIB QC ulang sebelum handoff berikutnya", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const pass = await inspect(w.qc, p.run.id, passBody(p.revision), "t9-pass");
  await runThroughPostQc(w, p.run.id, pass.body.revision);
  const [first] = await fgHandoffs(p.unit.id);
  assert.equal((await reject(w.gudang, first.id, 1, "Ukuran tidak sesuai pesanan", "t9-reject")).status, 200);
  const d = await detail(w, p.run.id);
  const gate = d.stages.find((s) => s.isQcGate);
  const target = d.stages.filter((s) => !s.isQcGate && s.order < gate.order).at(-1);
  const run = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } });
  const post = d.stages.find((s) => !s.isQcGate && s.order > gate.order);
  const badTarget = await w.op.api.post(`${Q}/${p.run.id}/handoff-rejection`, { expectedRevision: run.revision, action: "REWORK", note: "kembalikan", reworkStageId: post.id }, key("t9-badtarget"));
  assert.equal(badTarget.status, 422);
  const rework = await w.op.api.post(`${Q}/${p.run.id}/handoff-rejection`, { expectedRevision: run.revision, action: "REWORK", note: "ganti ukuran", reworkStageId: target.id }, key("t9-rework"));
  assert.equal(rework.status, 200, JSON.stringify(rework.body)); assert.equal(rework.body.nextPhase, "PROCESS");
  assert.deepEqual(await phasesOf(p.run.id), { INTAKE: "COMPLETED", DIAGNOSIS: "NOT_APPLICABLE", PROCESS: "ACTIVE", QC: "NOT_STARTED", HANDOFF: "NOT_STARTED" });
  const s = await start(w, p.run.id, rework.body.revision, "t9-start");
  assert.equal(s.status, 200, JSON.stringify(s.body)); assert.equal(s.body.stage.id, target.id);
  const c = await complete(w, p.run.id, s.body.revision, "t9-complete");
  assert.equal(c.body.awaitingQc, true); assert.equal(c.body.handoffReady, false, "selesai rework menuju QC, bukan handoff");
  const pass2 = await inspect(w.qc, p.run.id, passBody(c.body.revision), "t9-pass2");
  assert.equal(pass2.status, 200, JSON.stringify(pass2.body)); assert.equal(pass2.body.version, 2);
  await runThroughPostQc(w, p.run.id, pass2.body.revision);
  const handoffs = await fgHandoffs(p.unit.id);
  assert.deepEqual(handoffs.map((h) => h.status), ["REJECTED", "OFFERED"]);
});

test("kontrak custody yang sama untuk WORKSHOP_BORN (BARU/SEWA) dan unit hasil pickup: tanpa custody palsu, run COMPLETED, unit READY_FOR_DELIVERY", async () => {
  const w = await world();
  for (const born of ["BARU", "SEWA", null]) {
    const p = await toAwaitingQc(w, { born });
    const { acc } = await finishLifecycle(w, p);
    assert.equal(acc.body.unitStatus, "READY_FOR_DELIVERY");
    const run = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } });
    assert.equal(run.status, "COMPLETED"); assert.equal(run.migrationSource, null);
    assert.equal(run.origin, born ? "WORKSHOP_BORN" : "CUSTODY_PICKUP");
    const inbound = await testPrisma.unitCustodyHandoff.count({ where: { unitId: p.unit.id, direction: "INBOUND" } });
    assert.equal(inbound, born ? 0 : 1, born ? "unit lahir di workshop TIDAK punya custody INBOUND palsu" : "unit pickup punya satu custody INBOUND asli");
    const fg = await fgHandoffs(p.unit.id);
    assert.equal(fg.length, 1); assert.equal(fg[0].status, "ACCEPTED"); assert.equal(fg[0].deliveryJobId, null);
    assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: p.unit.id } })).status, "READY_FOR_DELIVERY");
  }
});

test("pagar Sales: dropdown READY/DELIVERED/CANCELLED, batalkan, dan buka kembali ditolak 409 untuk unit cohort dengan run aktif; unit non-cohort tetap V1", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const orderId = p.unit.orderId;
  const sales = await createTestUser({ roles: ["PRODUCTION_LEAD"] }); // ORDER_WRITE (jalur override manual V1)
  const api = makeClient(server.baseUrl, sales.token);
  const before = await snapshot(p.run.id, p.unit.id);
  for (const body of [{ status: "READY" }, { status: "DELIVERED", deliveryConfirmedDate: "2026-09-30" }]) {
    const res = await api.patch(`/api/orders/${orderId}`, body);
    assert.equal(res.status, 409, `${body.status}: ${JSON.stringify(res.body)}`); assert.match(res.body.error, /Production V2/);
  }
  assert.deepEqual(await snapshot(p.run.id, p.unit.id), before, "unit dan run tidak berubah");
  // Unit yang BELUM mulai dikerjakan (V1 mengizinkan batal): pagar V2 yang menolak, bukan aturan V1.
  const fresh = await acceptedUnit();
  const freshBefore = await snapshot(fresh.run.id, fresh.unit.id);
  const cancel = await api.post(`/api/orders/${fresh.unit.orderId}/cancel`, { reason: "salah input" });
  assert.equal(cancel.status, 409, JSON.stringify(cancel.body)); assert.match(cancel.body.error, /Production V2/);
  const cancelPatch = await api.patch(`/api/orders/${fresh.unit.orderId}`, { status: "CANCELLED" });
  assert.equal(cancelPatch.status, 409, JSON.stringify(cancelPatch.body)); assert.match(cancelPatch.body.error, /Production V2/);
  assert.deepEqual(await snapshot(fresh.run.id, fresh.unit.id), freshBefore);

  // Non-cohort: perilaku V1 murni (dropdown READY menyamakan status unit seperti biasa).
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan V1" } });
  const v1Order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `P6V1-${++seq}`, value: 1000, category: "BARU" } });
  const v1Unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-P6V1-${++seq}`, orderId: v1Order.id, seq: 1, status: "IN_PRODUCTION" } });
  const ok = await api.patch(`/api/orders/${v1Order.id}`, { status: "READY" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: v1Unit.id } })).status, "READY_FOR_DELIVERY");
});

test("override V1 (unit diubah manual): command P5/P6/Gudang fail-closed; konflik dicatat sekali; resolusi idempoten (restore/cancel/accept override)", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  await testPrisma.unit.update({ where: { id: p.unit.id }, data: { status: "READY_FOR_DELIVERY" } }); // simulasi override manual di luar jalur V2
  const before = await snapshot(p.run.id, p.unit.id);
  const blocked = await inspect(w.qc, p.run.id, passBody(p.revision), "t11-blocked");
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, "PRODUCTION_RUN_INCONSISTENT"); assert.equal(blocked.body.details.kind, "UNIT_MARKED_READY");
  assert.deepEqual(await snapshot(p.run.id, p.unit.id), before, "tidak menebak/menimpa diam-diam");
  const p5 = await start(w, p.run.id, p.revision, "t11-p5");
  assert.equal(p5.status, 409);
  const queue = await w.op.api.get(`${P}/qc/queue?tab=CONFLICT`);
  assert.equal(queue.body.items.length, 1); assert.equal(queue.body.items[0].conflict.kind, "UNIT_MARKED_READY"); assert.equal(queue.body.items[0].conflict.open, false);

  const open = await w.op.api.post(`${P}/exceptions/open`, { runId: p.run.id }, key("t11-open"));
  assert.equal(open.status, 201, JSON.stringify(open.body)); assert.equal(open.body.kind, "UNIT_MARKED_READY"); assert.equal(open.body.alreadyOpen, false);
  const open2 = await w.op.api.post(`${P}/exceptions/open`, { runId: p.run.id }, key("t11-open2"));
  assert.equal(open2.body.alreadyOpen, true); assert.equal(await testPrisma.productionRunException.count({ where: { runId: p.run.id, status: "OPEN" } }), 1, "satu exception OPEN per run");
  const list = await w.op.api.get(`${P}/exceptions?status=OPEN`);
  assert.equal(list.body.items.length, 1); assert.deepEqual(list.body.items[0].allowedResolutions.sort(), ["ACCEPT_OVERRIDE", "RESTORE_UNIT_STATUS"]);

  const resolve = (who, body, tag) => who.api.post(`${P}/exceptions/${open.body.exceptionId}/resolve`, body, key(tag));
  assert.equal((await resolve(w.op, { expectedRevision: 1, resolution: "CANCEL_RUN", note: "coba batal" }, "t11-badres")).body.code, "QC_RESOLUTION_NOT_ALLOWED");
  const noAuth = await resolve(w.op, { expectedRevision: 1, resolution: "ACCEPT_OVERRIDE", note: "terima override" }, "t11-noauth");
  assert.equal(noAuth.status, 403); assert.equal(noAuth.body.code, "QC_WAIVE_FORBIDDEN");
  assert.equal((await resolve(w.op, { expectedRevision: 5, resolution: "RESTORE_UNIT_STATUS", note: "pulihkan" }, "t11-stale")).status, 409);
  const restored = await resolve(w.op, { expectedRevision: 1, resolution: "RESTORE_UNIT_STATUS", note: "Unit belum siap kirim, status dikembalikan" }, "t11-restore");
  assert.equal(restored.status, 200, JSON.stringify(restored.body)); assert.equal(restored.body.unitStatus, "IN_PRODUCTION");
  const after = await snapshot(p.run.id, p.unit.id);
  const replay = await resolve(w.op, { expectedRevision: 1, resolution: "RESTORE_UNIT_STATUS", note: "Unit belum siap kirim, status dikembalikan" }, "t11-restore");
  assert.equal(replay.body.replayed, true); assert.deepEqual(await snapshot(p.run.id, p.unit.id), after);
  const exception = await testPrisma.productionRunException.findUniqueOrThrow({ where: { id: open.body.exceptionId } });
  assert.equal(exception.status, "RESOLVED"); assert.equal(exception.resolution, "RESTORE_UNIT_STATUS"); assert.equal(exception.resolvedById, w.op.user.id);
  const run = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } });
  const pass = await inspect(w.qc, p.run.id, passBody(run.revision), "t11-pass-after");
  assert.equal(pass.status, 200, JSON.stringify(pass.body));

  // UNIT_SHIPPED: hanya ACCEPT_OVERRIDE (QC_WAIVE); run ditutup tanpa bukti QC/custody yang dikarang.
  const q = await toAwaitingQc(w);
  await testPrisma.unit.update({ where: { id: q.unit.id }, data: { status: "DELIVERED" } });
  const oq = await w.admin.api.post(`${P}/exceptions/open`, { runId: q.run.id }, key("t11-open-q"));
  assert.equal(oq.status, 201, JSON.stringify(oq.body)); assert.equal(oq.body.kind, "UNIT_SHIPPED");
  const restoreShipped = await w.admin.api.post(`${P}/exceptions/${oq.body.exceptionId}/resolve`, { expectedRevision: 1, resolution: "RESTORE_UNIT_STATUS", note: "coba pulihkan" }, key("t11-shipped-restore"));
  assert.equal(restoreShipped.status, 409);
  const accepted = await w.admin.api.post(`${P}/exceptions/${oq.body.exceptionId}/resolve`, { expectedRevision: 1, resolution: "ACCEPT_OVERRIDE", note: "Unit sudah dikirim oleh dispatcher" }, key("t11-shipped-accept"));
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body)); assert.equal(accepted.body.runStatus, "COMPLETED");
  assert.equal(await testPrisma.qualityInspection.count({ where: { runId: q.run.id } }), 0, "tidak ada inspeksi dikarang");
  assert.equal((await fgHandoffs(q.unit.id)).length, 0);

  // UNIT_CANCELLED: CANCEL_RUN; penawaran barang jadi yang menunggu ikut dibatalkan (riwayat tetap).
  const r = await toAwaitingQc(w);
  const passR = await inspect(w.qc, r.run.id, passBody(r.revision), "t11-pass-r");
  await runThroughPostQc(w, r.run.id, passR.body.revision);
  await testPrisma.unit.update({ where: { id: r.unit.id }, data: { status: "CANCELLED" } });
  const blockedAccept = await accept(w.gudang, (await fgHandoffs(r.unit.id))[0].id, 1, w.fgArea.id, "t11-accept-blocked");
  assert.equal(blockedAccept.status, 409); assert.equal(blockedAccept.body.code, "PRODUCTION_RUN_INCONSISTENT");
  assert.equal((await fgHandoffs(r.unit.id))[0].status, "OFFERED");
  const sweep = await w.op.api.post(`${P}/exceptions/sweep`, {}, key("t11-sweep"));
  assert.equal(sweep.status, 200, JSON.stringify(sweep.body)); assert.equal(sweep.body.openedCount, 1);
  const sweepReplay = await w.op.api.post(`${P}/exceptions/sweep`, {}, key("t11-sweep"));
  assert.equal(sweepReplay.body.replayed, true); assert.equal(await testPrisma.productionRunException.count({ where: { runId: r.run.id } }), 1);
  const ex = sweep.body.opened[0];
  const cancelled = await w.op.api.post(`${P}/exceptions/${ex.exceptionId}/resolve`, { expectedRevision: 1, resolution: "CANCEL_RUN", note: "Order dibatalkan customer" }, key("t11-cancel-run"));
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body)); assert.equal(cancelled.body.runStatus, "CANCELLED");
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: r.run.id } })).status, "CANCELLED");
  assert.deepEqual((await fgHandoffs(r.unit.id)).map((h) => h.status), ["CANCELLED"]);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: r.unit.id } })).status, "CANCELLED", "status unit tidak ditimpa");
});

test("batalkan Production Run (Production Lead): run CANCELLED, exception OPEN ikut selesai; setelahnya Sales boleh membatalkan order", async () => {
  const w = await world();
  const p = await acceptedUnit(); // run aktif, unit belum mulai dikerjakan (V1 mengizinkan batal order)
  p.revision = p.run.revision;
  const sales = makeClient(server.baseUrl, (await createTestUser({ roles: ["PRODUCTION_LEAD"] })).token);
  const blockedCancel = await sales.post(`/api/orders/${p.unit.orderId}/cancel`, { reason: "batal" });
  assert.equal(blockedCancel.status, 409); assert.match(blockedCancel.body.error, /Production V2/);
  const noReason = await w.op.api.post(`${Q}/${p.run.id}/cancel`, { expectedRevision: p.revision, reason: "" }, key("t12-noreason"));
  assert.equal(noReason.status, 400);
  const cancel = await w.op.api.post(`${Q}/${p.run.id}/cancel`, { expectedRevision: p.revision, reason: "Customer membatalkan pesanan" }, key("t12-cancel"));
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } })).status, "CANCELLED");
  const replay = await w.op.api.post(`${Q}/${p.run.id}/cancel`, { expectedRevision: p.revision, reason: "Customer membatalkan pesanan" }, key("t12-cancel"));
  assert.equal(replay.body.replayed, true);
  assert.equal((await inspect(w.qc, p.run.id, passBody(cancel.body.revision), "t12-qc")).status, 409, "run terminal tidak menerima QC");
  assert.deepEqual((await phasesOf(p.run.id)).INTAKE, "CANCELLED");
  const ok = await sales.post(`/api/orders/${p.unit.orderId}/cancel`, { reason: "batal" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test("concurrency: dua petugas QC -> tepat satu pemenang; QC vs override; dua petugas Gudang -> tepat satu pemenang", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const [a, b] = await Promise.all([inspect(w.qc, p.run.id, passBody(p.revision), "t13-a"), inspect(w.qc2, p.run.id, passBody(p.revision), "t13-b")]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
  assert.equal(await testPrisma.qualityInspection.count({ where: { runId: p.run.id } }), 1);
  assert.equal(await testPrisma.qcFitTest.count({ where: { unitId: p.unit.id } }), 1);
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: p.unit.id, action: "START", stage: { requiresQc: true } } }), 1);

  // Dua petugas Gudang atas handoff yang sama.
  const winner = a.status === 200 ? a : b;
  await runThroughPostQc(w, p.run.id, winner.body.revision);
  const [handoff] = await fgHandoffs(p.unit.id);
  const [g1, g2] = await Promise.all([accept(w.gudang, handoff.id, 1, w.fgArea.id, "t13-g1"), accept(w.gudang2, handoff.id, 1, w.fgArea.id, "t13-g2")]);
  assert.deepEqual([g1.status, g2.status].sort(), [200, 409], JSON.stringify([g1.body, g2.body]));
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "production.run.completed", aggregateId: p.run.id } }), 1);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } })).status, "COMPLETED");

  // QC vs override manual: hasil konsisten apa pun pemenangnya (tidak ada inspeksi setengah jadi).
  const q = await toAwaitingQc(w);
  const [qcRes] = await Promise.all([
    inspect(w.qc, q.run.id, passBody(q.revision), "t13-qcov"),
    testPrisma.unit.update({ where: { id: q.unit.id }, data: { status: "CANCELLED" } }),
  ]);
  const inspections = await testPrisma.qualityInspection.count({ where: { runId: q.run.id } });
  const fitTests = await testPrisma.qcFitTest.count({ where: { unitId: q.unit.id } });
  if (qcRes.status === 200) assert.deepEqual([inspections, fitTests], [1, 1]); else { assert.equal(qcRes.body.code, "PRODUCTION_RUN_INCONSISTENT"); assert.deepEqual([inspections, fitTests], [0, 0]); }
  const next = await inspect(w.qc, q.run.id, passBody(q.revision + 1), "t13-after");
  assert.equal(next.status, 409, "setelah override, command berikutnya tidak melanjutkan state tidak konsisten");
});

test("replay QC (kunci sama) tidak menggandakan inspeksi, qc_fit_tests, command, outbox, audit, atau ledger V1; revisi basi 409 tanpa jejak", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const stale = await inspect(w.qc, p.run.id, passBody(p.revision + 3), "t14-stale");
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "QC_REVISION_CONFLICT");
  assert.equal(await testPrisma.qualityInspection.count(), 0);
  const first = await inspect(w.qc, p.run.id, passBody(p.revision), "t14-pass");
  assert.equal(first.status, 200);
  const snap = await snapshot(p.run.id, p.unit.id);
  const replay = await inspect(w.qc, p.run.id, passBody(p.revision), "t14-pass");
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true); assert.equal(replay.body.inspectionId, first.body.inspectionId);
  assert.deepEqual(await snapshot(p.run.id, p.unit.id), snap);
  const conflict = await inspect(w.qc, p.run.id, passBody(p.revision, { note: "beda" }), "t14-pass");
  assert.equal(conflict.status, 409); assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT");
});

test("writer OFF / non-cohort: QC V2 503 tanpa jejak; jalur V1 (qc fit test) tetap jalan untuk unit di luar cohort; reader OFF inert; antrean custody lama tidak memuat barang jadi", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  await setFlag(V2_FLAGS.PRODUCTION_WRITER, { enabled: false, unitIds: [p.unit.id] });
  const before = await snapshot(p.run.id, p.unit.id);
  const off = await inspect(w.qc, p.run.id, passBody(p.revision), "t15-off");
  assert.equal(off.status, 503); assert.equal(off.body.code, "QC_WRITER_OFF");
  assert.deepEqual(await snapshot(p.run.id, p.unit.id), before);

  await addCohort(p.unit.id);
  const pass = await inspect(w.qc, p.run.id, passBody(p.revision), "t15-on");
  await runThroughPostQc(w, p.run.id, pass.body.revision);
  const oldQueue = await w.gudang.api.get("/api/inventory/unit-custody?status=OFFERED");
  assert.equal(oldQueue.body.items.filter((i) => i.direction === "FINISHED_GOODS").length, 0, "antrean custody lama tidak memuat barang jadi tanpa direction eksplisit");
  const fgQueue = await w.gudang.api.get("/api/inventory/unit-custody?status=OFFERED&direction=FINISHED_GOODS");
  assert.equal(fgQueue.body.items.length, 1); assert.equal(fgQueue.body.items[0].deliveryJob, null); assert.equal(fgQueue.body.items[0].productionRun.id, p.run.id);

  await setFlag(V2_FLAGS.PRODUCTION_READER, { enabled: false });
  const readerOff = await w.qc.api.get(`${P}/qc/queue`);
  assert.deepEqual(readerOff.body, { items: [], readerMode: "OFF" });
  assert.deepEqual((await w.qc.api.get(`${P}/exceptions`)).body, { items: [], readerMode: "OFF" });
  assert.equal((await w.qc.api.get(`${Q}/${p.run.id}`)).body.items?.length, 0);
});

test("migration: CHECK job-by-direction menjaga INBOUND/RETURN wajib punya Job dan FINISHED_GOODS tanpa Job; trigger immutability aktif", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const inbound = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: p.unit.id, direction: "INBOUND" } });
  await assert.rejects(testPrisma.unitCustodyHandoff.create({ data: { unitId: p.unit.id, deliveryJobId: null, direction: "INBOUND", status: "CANCELLED" } }), /job_by_direction/);
  await assert.rejects(testPrisma.unitCustodyHandoff.create({ data: { unitId: p.unit.id, deliveryJobId: inbound.deliveryJobId, direction: "FINISHED_GOODS", status: "CANCELLED" } }), /job_by_direction/);
  const fg = await testPrisma.unitCustodyHandoff.create({ data: { unitId: p.unit.id, deliveryJobId: null, direction: "FINISHED_GOODS", status: "CANCELLED" } });
  assert.equal(fg.deliveryJobId, null);
});

test("jalur V1 non-cohort tidak berubah: QC PAS via endpoint V1 lalu tahap terakhir langsung READY_FOR_DELIVERY (deferReady tidak bocor); tanpa jejak V2", async () => {
  const w = await world();
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan V1 QC" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `P6V1Q-${++seq}`, value: 1000, category: "BARU" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-P6V1Q-${++seq}`, orderId: order.id, seq: 1, status: "RECEIVED", serviceId: w.service.id } });
  const api = w.qc.api; // QC_LEAD: UNIT_STAGE_WRITE + QC_WRITE
  let gateReached = false;
  for (let guard = 0; guard < 30 && !gateReached; guard += 1) {
    const started = await api.post(`/api/units/${unit.id}/stages/start`, {});
    assert.equal(started.status, 200, JSON.stringify(started.body));
    if (started.body.stage.requiresQc) { gateReached = true; break; }
    const done = await api.post(`/api/units/${unit.id}/stages/${started.body.stage.id}/complete`, { photoUrls: PHOTO });
    assert.equal(done.status, 200, JSON.stringify(done.body));
  }
  assert.equal(gateReached, true);
  const gate = await testPrisma.routingStage.findFirstOrThrow({ where: { requiresQc: true } });
  const qc = await api.post(`/api/units/${unit.id}/stages/${gate.id}/qc`, { verdict: "PAS", referenceWeightKg: 60, photoUrls: PHOTO });
  assert.equal(qc.status, 200, JSON.stringify(qc.body)); assert.equal(qc.body.result, "PASSED");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id }, include: { currentStage: true } })).currentStage.code, "corner_sewing");
  for (let guard = 0; guard < 5; guard += 1) {
    const started = await api.post(`/api/units/${unit.id}/stages/start`, {});
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const done = await api.post(`/api/units/${unit.id}/stages/${started.body.stage.id}/complete`, { photoUrls: PHOTO });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const row = await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } });
    if (row.status === "READY_FOR_DELIVERY") break;
  }
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "READY_FOR_DELIVERY", "V1: tahap terakhir selesai -> unit siap kirim seperti sebelum P6");
  assert.equal(await testPrisma.qcFitTest.count({ where: { unitId: unit.id } }), 1);
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: unit.id } }), 0);
  assert.equal(await testPrisma.qualityInspection.count(), 0);
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id } }), 0);
});

test("urutan kunci plan -> unit -> run: QC FAIL + bahan tambahan bersamaan dengan assign P3 dan start P5 tidak deadlock dan tidak saling merusak", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const extra = await createTestMaterial({ name: `Mat Lock ${++seq}` });
  await seedBalance(extra.id, 10);
  const d = await detail(w, p.run.id);
  const gate = d.stages.find((s) => s.isQcGate);
  const reworkStage = d.stages.filter((s) => !s.isQcGate && s.order < gate.order).at(-1);
  const assignNow = async (tag) => {
    const plan = await testPrisma.productionRunPlan.findUniqueOrThrow({ where: { id: p.planId } });
    return w.op.api.post(`${P}/plans/${p.planId}/assign`, { workCenterId: w.wc, operatorId: w.operator.id, targetStartAt: "2026-09-28T02:00:00.000Z", targetCompleteAt: "2026-09-28T10:00:00.000Z", expectedRevision: plan.revision }, key(tag));
  };
  const body = { expectedRevision: p.revision, result: "FAIL", photoUrls: PHOTO, referenceWeightKg: 55, fitVerdict: "TERLALU_KERAS", note: "perlu busa", reworkStageId: reworkStage.id, supplementalMaterials: [{ materialId: extra.id, qty: 1 }] };
  const [qc, a1, a2, st] = await Promise.all([inspect(w.qc, p.run.id, body, "lock-qc"), assignNow("lock-a1"), assignNow("lock-a2"), start(w, p.run.id, p.revision, "lock-start")]);
  assert.equal(qc.status, 200, JSON.stringify(qc.body));
  for (const res of [a1, a2]) assert.ok([200, 409].includes(res.status), JSON.stringify(res.body));
  assert.equal(st.status, 409, "start P5 ditolak (AWAITING_QC atau bahan tambahan belum diserahkan) — tidak pernah menembus");
  assert.equal(await testPrisma.qualityInspection.count({ where: { runId: p.run.id } }), 1);
  assert.equal(await testPrisma.materialIssue.count({ where: { reworkInspectionId: { not: null } } }), 1);
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: p.unit.id, action: "START", stage: { id: reworkStage.id } } }), 1, "hanya START rework dari pra-QC; tidak ada START dobel");
});

// ── Hotfix pra-P7B: invariant lifecycle fase + flag fail-closed ───────────────────────────────────────────────────────────────
const IN_PROGRESS = ["ACTIVE", "BLOCKED"];
const TERMINAL = ["COMPLETED", "NOT_APPLICABLE", "CANCELLED"];
const inProgressCount = async (runId) => (await testPrisma.productionPhaseRun.count({ where: { runId, status: { in: IN_PROGRESS } } }));
const fullSnapshot = async (runId, unitId) => ({
  ...(await snapshot(runId, unitId)),
  handoffs: JSON.stringify((await testPrisma.unitCustodyHandoff.findMany({ where: { unitId }, orderBy: { id: "asc" }, select: { id: true, status: true, revision: true, direction: true } }))),
  phases: JSON.stringify(await phasesOf(runId)),
});

test("lifecycle fresh: custody INBOUND -> planning -> material -> PROCESS -> QC -> corner_sewing -> finished -> HANDOFF -> Gudang ACCEPTED -> run COMPLETED; tidak ada fase terbuka dan tidak pernah dua fase berjalan", async () => {
  const w = await world();
  const p = await prepare(w);
  // Setelah custody + planning + material: hanya INTAKE yang berjalan; fase lain belum dimulai.
  assert.deepEqual(await phasesOf(p.run.id), { INTAKE: "ACTIVE", DIAGNOSIS: "NOT_STARTED", PROCESS: "NOT_STARTED", QC: "NOT_STARTED", HANDOFF: "NOT_STARTED" });
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } })).origin, "CUSTODY_PICKUP");

  // Start pertama = perpindahan INTAKE -> PROCESS secara atomik: INTAKE selesai, DIAGNOSIS tidak berlaku, PROCESS berjalan.
  const s1 = await start(w, p.run.id, 1, "lc-s1");
  assert.equal(s1.status, 200, JSON.stringify(s1.body));
  assert.deepEqual(await phasesOf(p.run.id), { INTAKE: "COMPLETED", DIAGNOSIS: "NOT_APPLICABLE", PROCESS: "ACTIVE", QC: "NOT_STARTED", HANDOFF: "NOT_STARTED" });
  assert.equal(await inProgressCount(p.run.id), 1);
  const diagnosis = await testPrisma.productionPhaseRun.findUniqueOrThrow({ where: { runId_phase: { runId: p.run.id, phase: "DIAGNOSIS" } } });
  assert.match(diagnosis.reason, /Diagnosis V2 belum tersedia/);
  const intake = await testPrisma.productionPhaseRun.findUniqueOrThrow({ where: { runId_phase: { runId: p.run.id, phase: "INTAKE" } } });
  assert.ok(intake.completedAt);

  let c = await complete(w, p.run.id, s1.body.revision, "lc-c1");
  let rev = c.body.revision;
  for (let guard = 0; guard < 30 && !c.body.awaitingQc; guard += 1) {
    const s = await start(w, p.run.id, rev, `lc-s-${guard}`);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(await inProgressCount(p.run.id), 1);
    c = await complete(w, p.run.id, s.body.revision, `lc-c-${guard}`);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    rev = c.body.revision;
  }
  assert.equal(c.body.awaitingQc, true);
  assert.deepEqual(await phasesOf(p.run.id), { INTAKE: "COMPLETED", DIAGNOSIS: "NOT_APPLICABLE", PROCESS: "COMPLETED", QC: "NOT_STARTED", HANDOFF: "NOT_STARTED" });
  assert.equal(await inProgressCount(p.run.id), 0, "menunggu QC: tidak ada fase berjalan");

  const pass = await inspect(w.qc, p.run.id, passBody(rev), "lc-pass");
  assert.equal(pass.status, 200, JSON.stringify(pass.body));
  assert.deepEqual(await phasesOf(p.run.id), { INTAKE: "COMPLETED", DIAGNOSIS: "NOT_APPLICABLE", PROCESS: "ACTIVE", QC: "COMPLETED", HANDOFF: "NOT_STARTED" });
  assert.equal(await inProgressCount(p.run.id), 1);

  const post = await runThroughPostQc(w, p.run.id, pass.body.revision);
  assert.deepEqual(post.codes, ["corner_sewing", "finished"]);
  assert.deepEqual(await phasesOf(p.run.id), { INTAKE: "COMPLETED", DIAGNOSIS: "NOT_APPLICABLE", PROCESS: "COMPLETED", QC: "COMPLETED", HANDOFF: "ACTIVE" });
  assert.equal(await inProgressCount(p.run.id), 1, "HANDOFF satu-satunya fase berjalan");

  const [handoff] = await fgHandoffs(p.unit.id);
  const acc = await accept(w.gudang, handoff.id, handoff.revision, w.fgArea.id, "lc-accept");
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  assert.equal(acc.body.runStatus, "COMPLETED");
  assert.deepEqual(await phasesOf(p.run.id), { INTAKE: "COMPLETED", DIAGNOSIS: "NOT_APPLICABLE", PROCESS: "COMPLETED", QC: "COMPLETED", HANDOFF: "COMPLETED" });
  const phases = await testPrisma.productionPhaseRun.findMany({ where: { runId: p.run.id } });
  assert.ok(phases.every((phase) => TERMINAL.includes(phase.status)), "semua fase terminal");
  assert.equal(await inProgressCount(p.run.id), 0);
  const run = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } });
  assert.equal(run.status, "COMPLETED"); assert.ok(run.completedAt);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: p.unit.id } })).status, "READY_FOR_DELIVERY");
});

test("fase tertinggal (non-terminal selain HANDOFF): Gudang accept DAN reject ditolak 409 dan semuanya rollback — unit, run, custody, command, audit, outbox tidak berubah; tidak ada auto-close", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const pass = await inspect(w.qc, p.run.id, passBody(p.revision), "lg-pass");
  await runThroughPostQc(w, p.run.id, pass.body.revision);
  const [handoff] = await fgHandoffs(p.unit.id);
  assert.equal(handoff.status, "OFFERED");

  // Simulasi bug sumber transisi: (a) DIAGNOSIS tertinggal NOT_STARTED, (b) INTAKE tertinggal ACTIVE.
  for (const [phase, status, code] of [["DIAGNOSIS", "NOT_STARTED", "RUN_PHASES_NOT_TERMINAL"], ["INTAKE", "ACTIVE", "RUN_PHASES_NOT_TERMINAL"], ["INTAKE", "BLOCKED", "RUN_PHASES_NOT_TERMINAL"]]) {
    await testPrisma.productionPhaseRun.update({ where: { runId_phase: { runId: p.run.id, phase } }, data: { status } });
    const before = await fullSnapshot(p.run.id, p.unit.id);
    const acc = await accept(w.gudang, handoff.id, handoff.revision, w.fgArea.id, `lg-acc-${phase}-${status}`);
    assert.equal(acc.status, 409, JSON.stringify(acc.body)); assert.equal(acc.body.code, code); assert.deepEqual(acc.body.details.phases, [phase]);
    const rej = await reject(w.gudang, handoff.id, handoff.revision, "Uji penolakan dengan fase tertinggal", `lg-rej-${phase}-${status}`);
    assert.equal(rej.status, 409, JSON.stringify(rej.body)); assert.equal(rej.body.code, code);
    assert.deepEqual(await fullSnapshot(p.run.id, p.unit.id), before, `rollback penuh (${phase}:${status})`);
    assert.equal((await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: handoff.id } })).status, "OFFERED");
    assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } })).status, "ACTIVE");
    assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: p.unit.id } })).status, "IN_PRODUCTION");
    assert.equal((await phasesOf(p.run.id))[phase], status, "fase tertinggal TIDAK ditutup otomatis");
    await testPrisma.productionPhaseRun.update({ where: { runId_phase: { runId: p.run.id, phase } }, data: { status: phase === "DIAGNOSIS" ? "NOT_APPLICABLE" : "COMPLETED" } });
  }
  // Setelah sumbernya diperbaiki (fase terminal) keputusan Gudang berjalan normal.
  const ok = await accept(w.gudang, handoff.id, handoff.revision, w.fgArea.id, "lg-acc-ok");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.runStatus, "COMPLETED");
});

test("start P5: DIAGNOSIS sedang berjalan / INTAKE BLOCKED -> 409 tanpa perubahan (tidak menutup fase orang lain diam-diam)", async () => {
  const w = await world();
  const p = await prepare(w);
  for (const [phase, status, code] of [["DIAGNOSIS", "ACTIVE", "WORKSHOP_DIAGNOSIS_OPEN"], ["DIAGNOSIS", "BLOCKED", "WORKSHOP_DIAGNOSIS_OPEN"]]) {
    await testPrisma.productionPhaseRun.update({ where: { runId_phase: { runId: p.run.id, phase } }, data: { status } });
    const before = await fullSnapshot(p.run.id, p.unit.id);
    const res = await start(w, p.run.id, 1, `st-${phase}-${status}`);
    assert.equal(res.status, 409, JSON.stringify(res.body)); assert.equal(res.body.code, code);
    assert.deepEqual(await fullSnapshot(p.run.id, p.unit.id), before);
    assert.equal(await testPrisma.productionOperationRun.count({ where: { runId: p.run.id } }), 0);
    await testPrisma.productionPhaseRun.update({ where: { runId_phase: { runId: p.run.id, phase } }, data: { status: "NOT_STARTED" } });
  }
  await testPrisma.productionPhaseRun.update({ where: { runId_phase: { runId: p.run.id, phase: "INTAKE" } }, data: { status: "BLOCKED" } });
  const before = await fullSnapshot(p.run.id, p.unit.id);
  const res = await start(w, p.run.id, 1, "st-intake-blocked");
  assert.equal(res.status, 409, JSON.stringify(res.body)); assert.equal(res.body.code, "WORKSHOP_INTAKE_NOT_CLOSABLE");
  assert.deepEqual(await fullSnapshot(p.run.id, p.unit.id), before);
  await testPrisma.productionPhaseRun.update({ where: { runId_phase: { runId: p.run.id, phase: "INTAKE" } }, data: { status: "ACTIVE" } });
  assert.equal((await start(w, p.run.id, 1, "st-ok")).status, 200, "setelah kondisi normal, start berjalan");
});

test("rework (QC FAIL) dan penolakan Gudang -> rework tidak pernah menghasilkan dua fase berjalan; tetap tertutup semua saat selesai", async () => {
  const w = await world();
  const p = await toAwaitingQc(w);
  const d = await detail(w, p.run.id);
  const gate = d.stages.find((s) => s.isQcGate);
  const reworkStage = d.stages.filter((s) => !s.isQcGate && s.order < gate.order).at(-1);
  const fail = await inspect(w.qc, p.run.id, { expectedRevision: p.revision, result: "FAIL", photoUrls: PHOTO, referenceWeightKg: 55, fitVerdict: "TERLALU_KERAS", note: "perlu busa", reworkStageId: reworkStage.id }, "rw-fail");
  assert.equal(fail.status, 200, JSON.stringify(fail.body));
  assert.deepEqual(await phasesOf(p.run.id), { INTAKE: "COMPLETED", DIAGNOSIS: "NOT_APPLICABLE", PROCESS: "ACTIVE", QC: "NOT_STARTED", HANDOFF: "NOT_STARTED" });
  assert.equal(await inProgressCount(p.run.id), 1);
  let rev = fail.body.revision;
  let c;
  for (let guard = 0; guard < 30; guard += 1) {
    const s = await start(w, p.run.id, rev, `rw-s-${guard}`);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    c = await complete(w, p.run.id, s.body.revision, `rw-c-${guard}`);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    rev = c.body.revision;
    assert.ok((await inProgressCount(p.run.id)) <= 1);
    if (c.body.awaitingQc) break;
  }
  const pass = await inspect(w.qc, p.run.id, passBody(rev), "rw-pass");
  assert.equal(pass.status, 200, JSON.stringify(pass.body));
  await runThroughPostQc(w, p.run.id, pass.body.revision);
  const [first] = await fgHandoffs(p.unit.id);
  const rej = await reject(w.gudang, first.id, first.revision, "Bantalan belum rata", "rw-rej");
  assert.equal(rej.status, 200, JSON.stringify(rej.body));
  assert.equal((await phasesOf(p.run.id)).HANDOFF, "BLOCKED");
  assert.equal(await inProgressCount(p.run.id), 1, "HANDOFF BLOCKED satu-satunya fase berjalan");
  const run = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: p.run.id } });
  const reoffer = await w.op.api.post(`${Q}/${p.run.id}/handoff-rejection`, { expectedRevision: run.revision, action: "REOFFER", note: "sudah dirapikan" }, key("rw-reoffer"));
  assert.equal(reoffer.status, 200, JSON.stringify(reoffer.body));
  const second = (await fgHandoffs(p.unit.id)).find((h) => h.status === "OFFERED");
  const acc = await accept(w.gudang, second.id, second.revision, w.fgArea.id, "rw-acc");
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  const phases = await testPrisma.productionPhaseRun.findMany({ where: { runId: p.run.id } });
  assert.ok(phases.every((phase) => TERMINAL.includes(phase.status)), JSON.stringify(phases.map((x) => [x.phase, x.status])));
});

test("unit non-cohort tetap V1: flag ON dengan config rusak/tanpa cohort tidak memagari Sales dan command V2 ditolak 503; cohort valid memagari hanya unit di dalamnya", async () => {
  const w = await world();
  const inCohort = await acceptedUnit();      // masuk cohort lewat addCohort
  const outCohort = await acceptedUnit();     // ditambahkan lalu dikeluarkan dari cohort di bawah
  const sales = makeClient(server.baseUrl, (await createTestUser({ roles: ["PRODUCTION_LEAD"] })).token);

  // Cohort sah berisi keduanya -> keduanya dipagari.
  assert.equal((await sales.post(`/api/orders/${inCohort.unit.orderId}/cancel`, { reason: "batal" })).status, 409);
  assert.equal((await sales.post(`/api/orders/${outCohort.unit.orderId}/cancel`, { reason: "batal" })).status, 409);

  // Cohort hanya unit A: unit B kini V1-only (pagar Sales tidak berlaku, command V2 ditolak).
  await setFlag(V2_FLAGS.PRODUCTION_WRITER, { enabled: true, unitIds: [inCohort.unit.id] });
  await setFlag(V2_FLAGS.PRODUCTION_READER, { enabled: true, unitIds: [inCohort.unit.id] });
  const v2OnB = await w.op.api.post(`${Q}/${outCohort.run.id}/cancel`, { expectedRevision: outCohort.run.revision, reason: "coba V2" }, key("nc-b-cancel"));
  assert.equal(v2OnB.status, 503, JSON.stringify(v2OnB.body));
  assert.equal((await sales.post(`/api/orders/${inCohort.unit.orderId}/cancel`, { reason: "batal" })).status, 409, "unit cohort tetap dipagari");
  const cancelB = await sales.post(`/api/orders/${outCohort.unit.orderId}/cancel`, { reason: "batal" });
  assert.equal(cancelB.status, 200, JSON.stringify(cancelB.body));
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: outCohort.run.id } })).status, "ACTIVE", "V2 tidak menyentuh unit non-cohort");

  // Config rusak (ON tanpa unitIds / array kosong / UUID invalid / ganda): tidak ada mode GLOBAL — semua unit V1-only.
  for (const [index, unitIds] of [undefined, [], ["bukan-uuid"], [inCohort.unit.id, inCohort.unit.id]].entries()) {
    await setFlag(V2_FLAGS.PRODUCTION_WRITER, { enabled: true, unitIds });
    await setFlag(V2_FLAGS.PRODUCTION_READER, { enabled: true, unitIds });
    const res = await w.op.api.post(`${Q}/${inCohort.run.id}/cancel`, { expectedRevision: inCohort.run.revision, reason: "coba V2" }, key(`nc-a-${index}`));
    assert.equal(res.status, 503, `unitIds=${JSON.stringify(unitIds)}: ${JSON.stringify(res.body)}`);
    const queue = await w.qc.api.get(`${P}/qc/queue`);
    assert.deepEqual(queue.body.items, [], "reader fail-closed: antrean kosong");
    assert.equal(queue.body.readerMode, "OFF");
  }
  const orderA = await sales.post(`/api/orders/${inCohort.unit.orderId}/cancel`, { reason: "batal" });
  assert.equal(orderA.status, 200, JSON.stringify(orderA.body));
});
