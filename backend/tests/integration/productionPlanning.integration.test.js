// P3 Planning Produksi H-1: rencana, assignment, Planned BOM, reservasi bahan Gudang.
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

const key = (value) => ({ "Idempotency-Key": `plan-test-${value}-0001` });

async function setFlag(flagKey, { enabled, unitIds }) {
  const data = { enabled, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "planning test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
const setWriter = (opts) => setFlag(V2_FLAGS.PRODUCTION_WRITER, opts);
const setReader = (opts) => setFlag(V2_FLAGS.PRODUCTION_READER, opts);

async function world() {
  const [planner, gudang1, gudang2] = await Promise.all([
    createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["WAREHOUSE"] }), createTestUser({ roles: ["WAREHOUSE"] }),
  ]);
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-PLN-${++seq}`, name: "Workshop Tes" } });
  const operator = await testPrisma.productionOperator.create({ data: { userId: planner.user.id } });
  return {
    planner: { ...planner, api: makeClient(server.baseUrl, planner.token) },
    gudang1: { ...gudang1, api: makeClient(server.baseUrl, gudang1.token) },
    gudang2: { ...gudang2, api: makeClient(server.baseUrl, gudang2.token) },
    workCenter, operator,
  };
}

// Unit lewat custody ACCEPTED (P1-P2) -> ProductionRun ACTIVE/INTAKE. Ini precondition eligibility P3.
async function acceptedUnit(w) {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const driverApi = makeClient(server.baseUrl, driver.token);
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Plan" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `PLN-${++seq}`, value: 1000, category: "LAYANAN" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-PLN-${++seq}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP" } });
  const route = await testPrisma.route.create({ data: { code: `PLN-RTE-${++seq}`, date: new Date("2026-09-28T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: driver.user.id } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, driverId: driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-09-28T00:00:00.000Z") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  await setWriter({ enabled: true, unitIds: [unit.id] });
  const tag = `accepted-${++seq}`;
  await driverApi.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}-start`));
  await driverApi.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${tag}-arrive`));
  const done = await driverApi.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga Rumah", note: "diserahkan", location: null }, key(`${tag}-complete`));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: unit.id } });
  const wh = await createTestUser({ roles: ["WAREHOUSE"] });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-PLN-${++seq}`, name: "Gudang Plan" } });
  const location = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-PLN-${++seq}` } });
  const accepted = await makeClient(server.baseUrl, wh.token).post(`/api/inventory/unit-custody/${handoff.id}/accept`, { locationId: location.id, expectedRevision: 1 }, key(`${tag}-accept`));
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
  await setWriter({ enabled: true, unitIds: [unit.id] });
  await setReader({ enabled: true, unitIds: [unit.id] });
  return { unit, run };
}

const create = (who, runId, tag) => who.api.post("/api/production-planning/plans", { runId }, key(tag));
const assign = (who, planId, body, tag) => who.api.post(`/api/production-planning/plans/${planId}/assign`, body, key(tag));
const setBom = (who, planId, body, tag) => who.api.post(`/api/production-planning/plans/${planId}/bom`, body, key(tag));
const reserve = (who, planId, body, tag) => who.api.post(`/api/production-planning/plans/${planId}/reserve`, body, key(tag));
const release = (who, planId, body, tag) => who.api.post(`/api/production-planning/plans/${planId}/release`, body, key(tag));
const cancel = (who, planId, body, tag) => who.api.post(`/api/production-planning/plans/${planId}/cancel`, body, key(tag));

const v2Counts = async () => ({
  plans: await testPrisma.productionRunPlan.count(),
  bomLines: await testPrisma.plannedBOMLine.count(),
  reservations: await testPrisma.materialReservation.count(),
  commands: await testPrisma.v2Command.count({ where: { domain: "PRODUCTION", commandType: { in: ["CREATE_PLAN", "ASSIGN_PLAN", "SET_PLANNED_BOM", "RESERVE_MATERIAL", "RELEASE_RESERVATIONS", "CANCEL_PLAN"] } } }),
});

test("create planning dan replay idempoten: satu plan DRAFT, replay Idempotency-Key sama tidak menambah", async () => {
  const w = await world();
  const { run } = await acceptedUnit(w);
  const res1 = await create(w.planner, run.id, "create-1");
  assert.equal(res1.status, 201, JSON.stringify(res1.body));
  assert.equal(res1.body.status, "DRAFT");
  assert.equal(res1.body.revision, 1);
  const before = await v2Counts();
  const res2 = await create(w.planner, run.id, "create-1");
  assert.equal(res2.status, 201, JSON.stringify(res2.body));
  assert.equal(res2.body.planId, res1.body.planId);
  assert.deepEqual(await v2Counts(), before, "replay tidak menambah baris");
});

test("membuat plan kedua untuk run yang sama (key berbeda) -> 409 PLAN_ALREADY_EXISTS", async () => {
  const w = await world();
  const { run } = await acceptedUnit(w);
  await create(w.planner, run.id, "dup-1");
  const res = await create(w.planner, run.id, "dup-2");
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "PLAN_ALREADY_EXISTS");
});

test("dua planner bersamaan membuat plan untuk run yang sama -> hanya satu plan aktif", async () => {
  const w = await world();
  const { run } = await acceptedUnit(w);
  const [r1, r2] = await Promise.all([create(w.planner, run.id, "race-1"), create(w.planner, run.id, "race-2")]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  assert.equal(await testPrisma.productionRunPlan.count({ where: { runId: run.id } }), 1);
});

test("assign: revisi basi -> 409 PLAN_REVISION_CONFLICT; assign valid -> DRAFT jadi PLANNED", async () => {
  const w = await world();
  const { run } = await acceptedUnit(w);
  const created = await create(w.planner, run.id, "assign-1");
  const planId = created.body.planId;
  const stale = await assign(w.planner, planId, { workCenterId: w.workCenter.id, operatorId: w.operator.id, targetStartAt: "2026-09-29T01:00:00.000Z", targetCompleteAt: "2026-09-29T05:00:00.000Z", expectedRevision: 99 }, "assign-stale");
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "PLAN_REVISION_CONFLICT");
  const ok = await assign(w.planner, planId, { workCenterId: w.workCenter.id, operatorId: w.operator.id, targetStartAt: "2026-09-29T01:00:00.000Z", targetCompleteAt: "2026-09-29T05:00:00.000Z", expectedRevision: 1 }, "assign-ok");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, "PLANNED");
  assert.equal(ok.body.revision, 2);
});

test("Planned BOM create/update: dua baris dibuat, lalu diubah -> baris lama SUPERSEDED, baris baru ACTIVE", async () => {
  const w = await world();
  const { run } = await acceptedUnit(w);
  const created = await create(w.planner, run.id, "bom-1");
  const planId = created.body.planId;
  const m1 = await createTestMaterial({ name: "Busa HR" });
  const m2 = await createTestMaterial({ name: "Kain Quilt" });
  const set1 = await setBom(w.planner, planId, { lines: [{ materialId: m1.id, qty: 2 }, { materialId: m2.id, qty: 3 }], expectedRevision: 1 }, "bom-set-1");
  assert.equal(set1.status, 200, JSON.stringify(set1.body));
  assert.equal(set1.body.lineCount, 2);
  assert.equal(await testPrisma.plannedBOMLine.count({ where: { planId, status: "ACTIVE" } }), 2);

  const m3 = await createTestMaterial({ name: "Resleting" });
  const set2 = await setBom(w.planner, planId, { lines: [{ materialId: m1.id, qty: 2 }, { materialId: m3.id, qty: 1 }], expectedRevision: set1.body.revision }, "bom-set-2");
  assert.equal(set2.status, 200, JSON.stringify(set2.body));
  assert.equal(await testPrisma.plannedBOMLine.count({ where: { planId, status: "ACTIVE" } }), 2, "m1 tak berubah, m2 diganti m3");
  assert.equal(await testPrisma.plannedBOMLine.count({ where: { planId, materialId: m2.id, status: "SUPERSEDED" } }), 1);
  assert.equal(await testPrisma.plannedBOMLine.count({ where: { planId, materialId: m3.id, status: "ACTIVE" } }), 1);
});

async function planReadyToReserve(w, { qty = 5 } = {}) {
  const { run, unit } = await acceptedUnit(w);
  const created = await create(w.planner, run.id, `ready-${++seq}`);
  const planId = created.body.planId;
  const assigned = await assign(w.planner, planId, { workCenterId: w.workCenter.id, operatorId: w.operator.id, targetStartAt: "2026-09-29T01:00:00.000Z", targetCompleteAt: "2026-09-29T05:00:00.000Z", expectedRevision: 1 }, `ready-assign-${seq}`);
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  const material = await createTestMaterial({ name: `Material ${seq}` });
  const bom = await setBom(w.planner, planId, { lines: [{ materialId: material.id, qty }], expectedRevision: assigned.body.revision }, `ready-bom-${seq}`);
  assert.equal(bom.status, 200, JSON.stringify(bom.body));
  return { planId, material, unit, revision: bom.body.revision };
}

test("reservasi cukup: berhasil, status MATERIAL_RESERVED, TIDAK mengurangi on-hand (stock_movements tidak bertambah)", async () => {
  const w = await world();
  const { planId, material, revision } = await planReadyToReserve(w, { qty: 5 });
  await seedBalance(material.id, 10);
  const before = await testPrisma.stockMovement.count();
  const res = await reserve(w.gudang1, planId, { expectedRevision: revision }, "reserve-ok");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, "MATERIAL_RESERVED");
  assert.equal(await testPrisma.stockMovement.count(), before, "reservasi tidak menulis stock_movements");
  const reservation = await testPrisma.materialReservation.findFirstOrThrow({ where: { planId } });
  assert.equal(reservation.status, "ACTIVE");
  assert.equal(Number(reservation.qty), 5);
});

test("reservasi kurang: gagal atomik (409 PLAN_MATERIAL_SHORTAGE), tidak ada reservasi tersisa, status tetap PLANNED", async () => {
  const w = await world();
  const { planId, material, revision } = await planReadyToReserve(w, { qty: 5 });
  await seedBalance(material.id, 2);
  const res = await reserve(w.gudang1, planId, { expectedRevision: revision }, "reserve-shortage");
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "PLAN_MATERIAL_SHORTAGE");
  assert.equal(await testPrisma.materialReservation.count({ where: { planId } }), 0);
  assert.equal((await testPrisma.productionRunPlan.findUniqueOrThrow({ where: { id: planId } })).status, "PLANNED");
});

test("reservasi memperhitungkan reserved V1 (MaterialIssueLine APPROVED) — tidak buta terhadap jalur Warehouse lama", async () => {
  const w = await world();
  const { planId, material, revision } = await planReadyToReserve(w, { qty: 5 });
  await seedBalance(material.id, 6);
  // 4 dari 6 sudah "dijanjikan" V1 lewat Material Issue APPROVED -> available untuk V2 cuma 2, kurang dari kebutuhan 5.
  const issue = await testPrisma.materialIssue.create({ data: { issueNumber: `MI-TEST-${++seq}`, sourceType: "MANUAL", status: "APPROVED" } });
  await testPrisma.materialIssueLine.create({ data: { materialIssueId: issue.id, materialId: material.id, requestedQty: 4 } });
  const res = await reserve(w.gudang1, planId, { expectedRevision: revision }, "reserve-v1-aware");
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "PLAN_MATERIAL_SHORTAGE");
});

test("dua plan berebut stok terakhir untuk material yang sama -> hanya satu reservasi berhasil", async () => {
  const w = await world();
  const material = await createTestMaterial({ name: "Material Rebutan" });
  await seedBalance(material.id, 10);
  const planA = await planReadyToReserve(w, { qty: 6 });
  // planReadyToReserve membuat material sendiri; timpa BOM keduanya ke material yang SAMA (rebutan).
  await setBom(w.planner, planA.planId, { lines: [{ materialId: material.id, qty: 6 }], expectedRevision: planA.revision }, "race-bom-a");
  const planB = await planReadyToReserve(w, { qty: 6 });
  await setBom(w.planner, planB.planId, { lines: [{ materialId: material.id, qty: 6 }], expectedRevision: planB.revision }, "race-bom-b");
  // setWriter (dipanggil acceptedUnit per fixture) MENIMPA config, bukan menambah — pastikan cohort mencakup KEDUA unit sebelum reservasi bersamaan.
  await setWriter({ enabled: true, unitIds: [planA.unit.id, planB.unit.id] });

  const [r1, r2] = await Promise.all([
    reserve(w.gudang1, planA.planId, { expectedRevision: planA.revision + 1 }, "race-reserve-a"),
    reserve(w.gudang2, planB.planId, { expectedRevision: planB.revision + 1 }, "race-reserve-b"),
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(await testPrisma.materialReservation.count({ where: { materialId: material.id, status: "ACTIVE" } }), 1);
});

test("perubahan BOM setelah reservasi melepas SEMUA reservasi aktif (atomik, tanpa orphan) dan kembali ke PLANNED", async () => {
  const w = await world();
  const { planId, material, revision } = await planReadyToReserve(w, { qty: 5 });
  await seedBalance(material.id, 10);
  const reserved = await reserve(w.gudang1, planId, { expectedRevision: revision }, "orphan-reserve");
  assert.equal(reserved.status, 200, JSON.stringify(reserved.body));
  assert.equal(await testPrisma.materialReservation.count({ where: { planId, status: "ACTIVE" } }), 1);

  const material2 = await createTestMaterial({ name: "Material Pengganti" });
  const changed = await setBom(w.planner, planId, { lines: [{ materialId: material2.id, qty: 1 }], expectedRevision: reserved.body.revision }, "orphan-bom-change");
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal(changed.body.status, "PLANNED", "kembali ke PLANNED, harus reservasi ulang eksplisit");
  assert.equal(changed.body.releasedReservations, 1);
  assert.equal(await testPrisma.materialReservation.count({ where: { planId, status: "ACTIVE" } }), 0, "tidak ada reservasi yatim tersisa");
  assert.equal(await testPrisma.materialReservation.count({ where: { planId, status: "RELEASED" } }), 1);
});

test("writer OFF / unit di luar cohort: createProductionPlan gagal 503, TIDAK ada jejak baris V2 sama sekali", async () => {
  const w = await world();
  const { run, unit } = await acceptedUnit(w);
  await setWriter({ enabled: false, unitIds: [unit.id] });
  const before = await v2Counts();
  const res = await create(w.planner, run.id, "writer-off");
  assert.equal(res.status, 503);
  assert.equal(res.body.code, "PLANNING_WRITER_OFF");
  assert.deepEqual(await v2Counts(), before);
});

test("reader OFF: eligible-units dan plans list kosong dengan readerMode OFF (bukan error)", async () => {
  const w = await world();
  const { run, unit } = await acceptedUnit(w);
  await create(w.planner, run.id, "reader-off-create");
  await setReader({ enabled: false });
  const eligible = await w.planner.api.get("/api/production-planning/eligible-units");
  assert.equal(eligible.status, 200);
  assert.deepEqual(eligible.body, { items: [], readerMode: "OFF" });
  const plans = await w.planner.api.get("/api/production-planning/plans");
  assert.equal(plans.status, 200);
  assert.deepEqual(plans.body, { items: [], readerMode: "OFF" });
  void unit;
});

test("rollback/no-op aman: release tanpa reservasi aktif -> releasedCount 0; cancel plan DRAFT bersih; mutasi setelah CANCELLED ditolak", async () => {
  const w = await world();
  const { run } = await acceptedUnit(w);
  const created = await create(w.planner, run.id, "noop-1");
  const planId = created.body.planId;
  const releaseNoop = await release(w.gudang1, planId, { expectedRevision: 1, reason: "cek no-op" }, "noop-release");
  assert.equal(releaseNoop.status, 200, JSON.stringify(releaseNoop.body));
  assert.equal(releaseNoop.body.releasedCount, 0);
  assert.equal(releaseNoop.body.status, "DRAFT");

  const cancelled = await cancel(w.planner, planId, { expectedRevision: releaseNoop.body.revision, reason: "batal H-1" }, "noop-cancel");
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.status, "CANCELLED");

  const again = await assign(w.planner, planId, { workCenterId: w.workCenter.id, operatorId: w.operator.id, targetStartAt: "2026-09-29T01:00:00.000Z", targetCompleteAt: "2026-09-29T05:00:00.000Z", expectedRevision: cancelled.body.revision }, "noop-after-cancel");
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "PLAN_CANCELLED");
});

test("eligibility: unit tanpa custody ACCEPTED dan tanpa migrationSource -> 422 PLAN_UNIT_NOT_ELIGIBLE; legacy exception (migrationSource) diterima", async () => {
  const w = await world();
  const order = await testPrisma.order.create({ data: { customerId: (await testPrisma.customer.create({ data: { name: "Pelanggan Legacy" } })).id, orderNumber: `LEG-${++seq}`, value: 1000, category: "LAYANAN" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-LEG-${++seq}`, orderId: order.id, seq: 1, status: "IN_PRODUCTION" } });
  const run = await testPrisma.productionRun.create({
    data: {
      unitId: unit.id, kind: "RESTORATION", status: "ACTIVE", currentPhase: "INTAKE", revision: 1,
      phases: { create: [{ phase: "INTAKE", sequence: 1, status: "ACTIVE" }, { phase: "DIAGNOSIS", sequence: 2, status: "NOT_STARTED" }, { phase: "PROCESS", sequence: 3, status: "NOT_STARTED" }, { phase: "QC", sequence: 4, status: "NOT_STARTED" }, { phase: "HANDOFF", sequence: 5, status: "NOT_STARTED" }] },
    },
  });
  await setWriter({ enabled: true, unitIds: [unit.id] });
  const notEligible = await create(w.planner, run.id, "legacy-not-eligible");
  assert.equal(notEligible.status, 422);
  assert.equal(notEligible.body.code, "PLAN_UNIT_NOT_ELIGIBLE");

  await testPrisma.productionRun.update({ where: { id: run.id }, data: { migrationSource: "excel-import-2026", migrationSourceId: "row-42" } });
  const eligibleNow = await create(w.planner, run.id, "legacy-eligible");
  assert.equal(eligibleNow.status, 201, JSON.stringify(eligibleNow.body));
});

test("regresi P1-P2 custody: accept -> ProductionRun ACTIVE tetap terjadi apa adanya, tidak terpengaruh kode planning baru", async () => {
  const w = await world();
  const { unit, run } = await acceptedUnit(w);
  assert.equal(run.status, "ACTIVE");
  assert.equal(run.currentPhase, "INTAKE");
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: unit.id } });
  assert.equal(handoff.status, "ACCEPTED");
  assert.equal(await testPrisma.productionRunPlan.count({ where: { runId: run.id } }), 0, "belum ada plan sampai diminta eksplisit");
});
