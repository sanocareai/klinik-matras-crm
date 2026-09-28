// P4 Pengambilan Bahan Produksi: request dari plan MATERIAL_RESERVED, PICKED Gudang (ledger + HPP + reservasi CONSUMED).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { computeStockSnapshot } from "../../src/services/inventoryLedger.js";

let server;
let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (v) => ({ "Idempotency-Key": `issue-test-${v}-0001` });
async function setFlag(flagKey, { enabled, unitIds }) {
  const data = { enabled, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "material issue test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
const setWriter = (o) => setFlag(V2_FLAGS.PRODUCTION_WRITER, o);
const setReader = (o) => setFlag(V2_FLAGS.PRODUCTION_READER, o);

async function world() {
  const [planner, gudang1, gudang2] = await Promise.all([createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["WAREHOUSE"] }), createTestUser({ roles: ["WAREHOUSE"] })]);
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-P4-${++seq}`, name: "Workshop Tes P4" } });
  const operator = await testPrisma.productionOperator.create({ data: { userId: planner.user.id } });
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  return { planner: c(planner), gudang1: c(gudang1), gudang2: c(gudang2), workCenter, operator };
}

async function acceptedUnit() {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const dapi = makeClient(server.baseUrl, driver.token);
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Issue" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ISS-${++seq}`, value: 1000, category: "LAYANAN" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-ISS-${++seq}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP" } });
  const route = await testPrisma.route.create({ data: { code: `ISS-RTE-${++seq}`, date: new Date("2026-09-28T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: driver.user.id } });
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
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-ISS-${++seq}`, name: "Gudang Issue" } });
  const loc = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-ISS-${++seq}` } });
  const acc = await makeClient(server.baseUrl, wh.token).post(`/api/inventory/unit-custody/${handoff.id}/accept`, { locationId: loc.id, expectedRevision: 1 }, key(`${tag}-x`));
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
  return { unit, run };
}

// Plan MATERIAL_RESERVED dengan N material (stok on-hand = stock per material).
async function reservedPlan(w, specs = [{ qty: 5, stock: 10 }]) {
  const { unit, run } = await acceptedUnit();
  const created = await w.planner.api.post("/api/production-planning/plans", { runId: run.id }, key(`c-${++seq}`));
  const planId = created.body.planId;
  const as = await w.planner.api.post(`/api/production-planning/plans/${planId}/assign`, { workCenterId: w.workCenter.id, operatorId: w.operator.id, targetStartAt: "2026-09-29T01:00:00.000Z", targetCompleteAt: "2026-09-29T05:00:00.000Z", expectedRevision: 1 }, key(`as-${++seq}`));
  const materials = [];
  for (const spec of specs) { const m = await createTestMaterial({ name: `Mat ${++seq}` }); await seedBalance(m.id, spec.stock); materials.push(m); }
  const bom = await w.planner.api.post(`/api/production-planning/plans/${planId}/bom`, { lines: specs.map((s, i) => ({ materialId: materials[i].id, qty: s.qty })), expectedRevision: as.body.revision }, key(`b-${++seq}`));
  const res = await w.gudang1.api.post(`/api/production-planning/plans/${planId}/reserve`, { expectedRevision: bom.body.revision }, key(`r-${++seq}`));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  await setWriter({ enabled: true, unitIds: [unit.id] });
  await setReader({ enabled: true, unitIds: [unit.id] });
  return { planId, unit, materials, planRevision: res.body.revision };
}

const request = (who, planId, tag) => who.api.post(`/api/production-planning/plans/${planId}/material-request`, {}, key(tag));
const pick = (who, id, rev, tag) => who.api.post(`/api/production-planning/material-requests/${id}/pick`, { expectedRevision: rev }, key(tag));
const cancel = (who, id, rev, tag) => who.api.post(`/api/production-planning/material-requests/${id}/cancel`, { expectedRevision: rev, reason: "batal uji" }, key(tag));
const onHand = async (materialId) => Number((await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS b FROM stock_movements WHERE material_id = ${materialId}::uuid`)[0].b);
const counts = async () => ({
  movements: await testPrisma.stockMovement.count(),
  issues: await testPrisma.materialIssue.count(),
  commands: await testPrisma.v2Command.count({ where: { commandType: { in: ["REQUEST_MATERIAL_PICKUP", "PICK_MATERIAL_ISSUE", "CANCEL_MATERIAL_ISSUE"] } } }),
  outbox: await testPrisma.domainOutbox.count({ where: { eventType: { startsWith: "warehouse.material_issue" } } }),
  activities: await testPrisma.activityEvent.count({ where: { eventType: { startsWith: "PRODUCTION_MATERIAL_ISSUE" } } }),
  journals: await testPrisma.finJournalEntry.count(),
});

test("request -> pick sukses: stok BERKURANG hanya saat pick, reservasi CONSUMED, issue ISSUED, plan tetap MATERIAL_RESERVED", async () => {
  const w = await world();
  const { planId, materials } = await reservedPlan(w, [{ qty: 5, stock: 10 }, { qty: 2, stock: 3 }]);
  const before = await counts();
  const req = await request(w.planner, planId, "req-ok");
  assert.equal(req.status, 201, JSON.stringify(req.body));
  assert.equal(req.body.status, "READY_TO_PICK");
  assert.equal((await counts()).movements, before.movements, "request TIDAK menulis stock movement");
  assert.equal(await onHand(materials[0].id), 10);

  const picked = await pick(w.gudang1, req.body.issueId, req.body.revision, "pick-ok");
  assert.equal(picked.status, 200, JSON.stringify(picked.body));
  assert.equal(picked.body.status, "ISSUED");
  assert.equal(await onHand(materials[0].id), 5);
  assert.equal(await onHand(materials[1].id), 1);
  const moves = await testPrisma.stockMovement.findMany({ where: { materialIssueId: req.body.issueId } });
  assert.equal(moves.length, 2);
  assert.ok(moves.every((m) => m.type === "ISSUE" && Number(m.qty) < 0));
  assert.equal(await testPrisma.materialReservation.count({ where: { planId, status: "CONSUMED" } }), 2);
  assert.equal(await testPrisma.materialReservation.count({ where: { planId, status: "ACTIVE" } }), 0);
  const lines = await testPrisma.materialIssueLine.findMany({ where: { materialIssueId: req.body.issueId } });
  assert.ok(lines.every((l) => l.issuedQty === l.requestedQty && l.reservationId));
  assert.equal((await testPrisma.productionRunPlan.findUniqueOrThrow({ where: { id: planId } })).status, "MATERIAL_RESERVED");
  const snap = await computeStockSnapshot(testPrisma);
  const row = snap.find((r) => r.materialId === materials[0].id);
  assert.equal(row.balance, 5); assert.equal(row.reserved, 0); assert.equal(row.available, 5);
});

test("client tidak bisa mengarang material/qty: body baris diabaikan; request hanya dari plan MATERIAL_RESERVED", async () => {
  const w = await world();
  const { planId, materials } = await reservedPlan(w, [{ qty: 5, stock: 10 }]);
  const liar = await w.planner.api.post(`/api/production-planning/plans/${planId}/material-request`, { lines: [{ materialId: materials[0].id, qty: 999 }] }, key("liar"));
  assert.equal(liar.status, 201);
  const line = await testPrisma.materialIssueLine.findFirstOrThrow({ where: { materialIssueId: liar.body.issueId } });
  assert.equal(line.requestedQty, 5);
  const { run, unit } = await acceptedUnit();
  await setWriter({ enabled: true, unitIds: [unit.id] });
  const draft = await w.planner.api.post("/api/production-planning/plans", { runId: run.id }, key("draft-plan"));
  const bad = await request(w.planner, draft.body.planId, "req-draft");
  assert.equal(bad.status, 409);
  assert.equal(bad.body.code, "PLAN_NOT_MATERIAL_RESERVED");
});

test("satu issue aktif per plan: request kedua (key berbeda) 409; replay key sama idempoten tanpa baris baru", async () => {
  const w = await world();
  const { planId } = await reservedPlan(w);
  const a = await request(w.planner, planId, "dup-a");
  const b = await request(w.planner, planId, "dup-b");
  assert.equal(b.status, 409); assert.equal(b.body.code, "MATERIAL_ISSUE_ALREADY_ACTIVE");
  const before = await counts();
  const replay = await request(w.planner, planId, "dup-a");
  assert.equal(replay.status, 201); assert.equal(replay.body.issueId, a.body.issueId);
  assert.deepEqual(await counts(), before);
});

test("replay pick exact-once: movement, jurnal HPP, audit, outbox tidak bertambah; stok berkurang sekali", async () => {
  const w = await world();
  const { planId, materials } = await reservedPlan(w, [{ qty: 4, stock: 10 }]);
  const req = await request(w.planner, planId, "rp-req");
  const first = await pick(w.gudang1, req.body.issueId, 1, "rp-pick");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const after = await counts();
  const second = await pick(w.gudang1, req.body.issueId, 1, "rp-pick");
  assert.equal(second.status, 200); assert.equal(second.body.replayed, true);
  assert.deepEqual(await counts(), after);
  assert.equal(await onHand(materials[0].id), 6);
  const third = await pick(w.gudang1, req.body.issueId, 2, "rp-pick-other");
  assert.equal(third.status, 409); assert.equal(third.body.code, "MATERIAL_ISSUE_ALREADY_PICKED");
  assert.deepEqual(await counts(), after);
  assert.ok(after.journals <= 1, "HPP maksimal satu jurnal per issue");
});

test("dua petugas pick bersamaan pada issue yang sama: tepat satu berhasil, satu 409; stok berkurang sekali", async () => {
  const w = await world();
  const { planId, materials } = await reservedPlan(w, [{ qty: 3, stock: 10 }]);
  const req = await request(w.planner, planId, "race-req");
  const [a, b] = await Promise.all([pick(w.gudang1, req.body.issueId, 1, "race-a"), pick(w.gudang2, req.body.issueId, 1, "race-b")]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(await onHand(materials[0].id), 7);
  assert.equal(await testPrisma.stockMovement.count({ where: { materialIssueId: req.body.issueId } }), 1);
});

test("revisi basi -> 409 dan tidak ada mutasi", async () => {
  const w = await world();
  const { planId, materials } = await reservedPlan(w);
  const req = await request(w.planner, planId, "stale-req");
  const before = await counts();
  const stale = await pick(w.gudang1, req.body.issueId, 9, "stale-pick");
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "MATERIAL_ISSUE_REVISION_CONFLICT");
  assert.deepEqual(await counts(), before);
  assert.equal(await onHand(materials[0].id), 10);
});

test("stok fisik kurang (drift setelah reservasi): pick gagal 409 atomik; multi-material rollback total, tidak ada movement", async () => {
  const w = await world();
  const { planId, materials } = await reservedPlan(w, [{ qty: 4, stock: 10 }, { qty: 6, stock: 10 }]);
  const req = await request(w.planner, planId, "short-req");
  const ordered = [...materials].sort((x, y) => x.id.localeCompare(y.id));
  await seedBalance(ordered[1].id, -8); // material yang diproses SESUDAH yang pertama tinggal 2 < kebutuhan
  const before = await counts();
  const res = await pick(w.gudang1, req.body.issueId, 1, "short-pick");
  assert.equal(res.status, 409); assert.equal(res.body.code, "MATERIAL_ISSUE_SHORTAGE");
  assert.equal((await counts()).movements, before.movements, "tidak ada movement sebagian");
  assert.equal(await onHand(ordered[0].id), 10, "material pertama TIDAK berkurang (rollback)");
  assert.equal(await testPrisma.materialReservation.count({ where: { planId, status: "ACTIVE" } }), 2);
  assert.equal((await testPrisma.materialIssue.findUniqueOrThrow({ where: { id: req.body.issueId } })).status, "READY_TO_PICK");
  assert.ok((await onHand(ordered[1].id)) >= 0, "stok negatif dilarang");
});

test("cancel sebelum pick: issue CANCELLED, reservasi RELEASED, plan kembali PLANNED, stok tak berubah; pick sesudahnya ditolak", async () => {
  const w = await world();
  const { planId, materials } = await reservedPlan(w, [{ qty: 5, stock: 10 }]);
  const req = await request(w.planner, planId, "cn-req");
  const c = await cancel(w.planner, req.body.issueId, 1, "cn-cancel");
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.status, "CANCELLED"); assert.equal(c.body.planStatus, "PLANNED");
  assert.equal(await testPrisma.materialReservation.count({ where: { planId, status: "RELEASED" } }), 1);
  assert.equal(await testPrisma.materialReservation.count({ where: { planId, status: "ACTIVE" } }), 0);
  assert.equal(await onHand(materials[0].id), 10);
  assert.equal(await testPrisma.stockMovement.count({ where: { materialIssueId: req.body.issueId } }), 0);
  const again = await request(w.planner, planId, "cn-req2");
  assert.equal(again.status, 409); assert.equal(again.body.code, "PLAN_NOT_MATERIAL_RESERVED");
  const picked = await pick(w.gudang1, req.body.issueId, c.body.revision, "cn-pick-after");
  assert.equal(picked.status, 409); assert.equal(picked.body.code, "MATERIAL_ISSUE_CANCELLED");
});

test("cancel setelah pick ditolak 409 dan tidak mengubah apa pun", async () => {
  const w = await world();
  const { planId, materials } = await reservedPlan(w);
  const req = await request(w.planner, planId, "ca-req");
  const p = await pick(w.gudang1, req.body.issueId, 1, "ca-pick");
  assert.equal(p.status, 200);
  const before = await counts();
  const c = await cancel(w.planner, req.body.issueId, p.body.revision, "ca-cancel");
  assert.equal(c.status, 409); assert.equal(c.body.code, "MATERIAL_ISSUE_ALREADY_PICKED");
  assert.deepEqual(await counts(), before);
  assert.equal(await testPrisma.materialReservation.count({ where: { planId, status: "CONSUMED" } }), 1);
  assert.equal(await onHand(materials[0].id), 5);
});

test("V1 tidak bocor/berubah: antrean V1 tidak memuat issue V2; endpoint V1 menolak memutasi issue V2 (409)", async () => {
  const w = await world();
  const { planId } = await reservedPlan(w);
  const req = await request(w.planner, planId, "v1-req");
  const list = await w.gudang1.api.get("/api/inventory/material-issues");
  assert.equal(list.status, 200);
  assert.equal(list.body.issues.some((i) => i.id === req.body.issueId), false);
  const attempts = [
    ["patch", `/api/inventory/material-issues/${req.body.issueId}`, { status: "APPROVED" }],
    ["post", `/api/inventory/material-issues/${req.body.issueId}/issue`, {}],
    ["patch", `/api/inventory/material-issues/${req.body.issueId}/cancel`, { reason: "x" }],
  ];
  for (const [method, path, body] of attempts) {
    const res = await w.gudang1.api[method](path, body);
    assert.equal(res.status, 409, `${method} ${path}`);
  }
  assert.equal((await testPrisma.materialIssue.findUniqueOrThrow({ where: { id: req.body.issueId } })).status, "READY_TO_PICK");
});

test("reserved tidak dihitung dua kali: issue V2 READY_TO_PICK tidak menambah reserved V1; reserved V1 + V2 dijumlahkan", async () => {
  const w = await world();
  const { planId, materials } = await reservedPlan(w, [{ qty: 6, stock: 10 }]);
  await request(w.planner, planId, "dc-req");
  const row = (await computeStockSnapshot(testPrisma)).find((r) => r.materialId === materials[0].id);
  assert.equal(row.reserved, 6, "hanya reservasi V2 aktif, bukan 12");
  assert.equal(row.available, 4);
  const v1 = await testPrisma.materialIssue.create({ data: { issueNumber: `MI-DC-${++seq}`, sourceType: "MANUAL", status: "APPROVED" } });
  await testPrisma.materialIssueLine.create({ data: { materialIssueId: v1.id, materialId: materials[0].id, requestedQty: 3 } });
  const row2 = (await computeStockSnapshot(testPrisma)).find((r) => r.materialId === materials[0].id);
  assert.equal(row2.reserved, 9); assert.equal(row2.available, 1);
});

test("writer OFF / unit non-cohort: request/pick/cancel 503, tanpa jejak V2 baru; reader OFF: antrean kosong (inert)", async () => {
  const w = await world();
  const { planId, unit } = await reservedPlan(w);
  const req = await request(w.planner, planId, "off-req");
  await setWriter({ enabled: false, unitIds: [unit.id] });
  const before = await counts();
  const r2 = await request(w.planner, planId, "off-req2");
  assert.equal(r2.status, 503); assert.equal(r2.body.code, "MATERIAL_ISSUE_WRITER_OFF");
  const p = await pick(w.gudang1, req.body.issueId, 1, "off-pick");
  assert.equal(p.status, 503);
  const c = await cancel(w.planner, req.body.issueId, 1, "off-cancel");
  assert.equal(c.status, 503);
  assert.deepEqual(await counts(), before);
  await setReader({ enabled: false });
  const q = await w.gudang1.api.get("/api/production-planning/material-requests");
  assert.deepEqual(q.body, { items: [], readerMode: "OFF" });
});

test("antrean Gudang: planned vs reserved vs picked per baris; filter status", async () => {
  const w = await world();
  const { planId } = await reservedPlan(w, [{ qty: 5, stock: 10 }]);
  const req = await request(w.planner, planId, "q-req");
  const q = await w.gudang1.api.get("/api/production-planning/material-requests?status=READY_TO_PICK");
  assert.equal(q.status, 200); assert.equal(q.body.items.length, 1);
  const line = q.body.items[0].lines[0];
  assert.equal(line.planned, 5); assert.equal(line.reserved, 5); assert.equal(line.picked, 0); assert.equal(line.reservationStatus, "ACTIVE");
  await pick(w.gudang1, req.body.issueId, 1, "q-pick");
  const done = await w.gudang1.api.get("/api/production-planning/material-requests?status=ISSUED");
  assert.equal(done.body.items[0].lines[0].picked, 5);
  assert.equal(done.body.items[0].lines[0].reservationStatus, "CONSUMED");
  const empty = await w.gudang1.api.get("/api/production-planning/material-requests?status=READY_TO_PICK");
  assert.equal(empty.body.items.length, 0);
});

test("guard P3: selama ada permintaan aktif atau setelah ISSUED, lepas reservasi/ubah BOM/batal rencana/reservasi ulang ditolak 409", async () => {
  const w = await world();
  const { planId, materials, planRevision } = await reservedPlan(w, [{ qty: 5, stock: 10 }]);
  const req = await request(w.planner, planId, "gd-req");
  const rel = () => w.gudang1.api.post(`/api/production-planning/plans/${planId}/release`, { expectedRevision: planRevision, reason: "coba lepas" }, key(`gd-rel-${++seq}`));
  const bom = () => w.planner.api.post(`/api/production-planning/plans/${planId}/bom`, { lines: [{ materialId: materials[0].id, qty: 1 }], expectedRevision: planRevision }, key(`gd-bom-${++seq}`));
  const can = () => w.planner.api.post(`/api/production-planning/plans/${planId}/cancel`, { expectedRevision: planRevision, reason: "coba batal" }, key(`gd-can-${++seq}`));
  for (const attempt of [rel, bom, can]) {
    const res = await attempt();
    assert.equal(res.status, 409); assert.equal(res.body.code, "PLAN_MATERIAL_ISSUE_ACTIVE");
  }
  assert.equal(await testPrisma.materialReservation.count({ where: { planId, status: "ACTIVE" } }), 1, "reservasi tidak tersentuh");
  await pick(w.gudang1, req.body.issueId, 1, "gd-pick");
  for (const attempt of [rel, bom, can]) {
    const res = await attempt();
    assert.equal(res.status, 409); assert.equal(res.body.code, "PLAN_MATERIAL_ALREADY_ISSUED");
  }
  assert.equal(await onHand(materials[0].id), 5);
});
