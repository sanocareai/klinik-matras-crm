// P12B.6 — (1) pagar server: unit COHORT V2 menolak 409 UNIT_V2_OWNED pada jalur V1 (layanan, prioritas/target, rute, penugasan, bahan); unit non-cohort tetap bisa;
// (2) konflik ATOMIK di DB (compare-and-set) termasuk lomba paralel; (3) ID rusak → 400 bukan 500; (4) lifecycle unit non-cohort via HTTP nyata (tahap, QC, bahan, penugasan,
// jeda/lanjut, hambatan) dengan izin per peran; (5) NOL artefak V2 dari seluruh aksi V1.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

let server; let W;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function world() {
  const who = {};
  for (const [k, roles] of [["lead", ["PRODUCTION_LEAD"]], ["worker", ["PRODUCTION_WORKER"]], ["qc", ["QC_LEAD"]], ["sales", ["SALES"]], ["admin", ["ADMIN"]], ["owner", ["OWNER"]], ["gudang", ["WAREHOUSE"]]]) {
    const u = await createTestUser({ roles }); who[k] = { ...u, http: makeClient(server.baseUrl, u.token) };
  }
  const services = await testPrisma.serviceCatalog.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, take: 2 });
  const mk = async (code) => {
    const customer = await testPrisma.customer.create({ data: { name: `Pelanggan ${code}` } });
    const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ORD-${code}`, value: 1_000_000, category: "LAYANAN" } });
    await testPrisma.orderItem.create({ data: { orderId: order.id, layananName: "Servis", harga: 1_000_000, sortOrder: 0 } });
    const unit = await testPrisma.unit.create({ data: { unitCode: code, orderId: order.id, seq: 1, status: "AWAITING_PICKUP" } });
    return unit;
  };
  return { who, services, v1: await mk("OWN-V1"), v2r: await mk("OWN-V2R"), v2w: await mk("OWN-V2W"), lc: await mk("OWN-LC") };
}
const flag = async (key, unitIds) => { const data = { enabled: !!unitIds, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "uji kepemilikan V2" }; await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, ...data }, update: data }); };
const v2Footprint = async () => ({
  runs: await testPrisma.productionRun.count(), custody: await testPrisma.unitCustodyHandoff.count(), outbox: await testPrisma.domainOutbox.count(),
  commands: Number((await testPrisma.$queryRawUnsafe("select count(*)::int c from v2_commands"))[0].c), plans: await testPrisma.productionRunPlan.count(),
  opRuns: Number((await testPrisma.$queryRawUnsafe("select count(*)::int c from production_operation_runs_v2"))[0].c),
});
let FOOT0;

test("setup: unit non-cohort, unit cohort-reader, unit cohort-writer, unit lifecycle", async () => {
  W = await world();
  await flag(V2_FLAGS.PRODUCTION_READER, [W.v2r.id]); await flag(V2_FLAGS.PRODUCTION_WRITER, [W.v2w.id]);
  FOOT0 = await v2Footprint();
});

test("PAGAR V2: unit cohort (reader ATAU writer) ditolak 409 UNIT_V2_OWNED pada layanan/prioritas/rute/penugasan/bahan; data tidak berubah", async () => {
  const mat = await createTestMaterial(); await seedBalance(mat.id, 50);
  for (const unit of [W.v2r, W.v2w]) {
    const id = unit.id; const lead = W.who.lead.http;
    const calls = [
      ["service", () => lead.patch(`/api/units/${id}/service`, { serviceId: W.services[0].id })],
      ["production", () => lead.patch(`/api/units/${id}/production`, { priority: "URGENT" })],
      ["route", () => lead.post(`/api/units/${id}/route`, {})],
      ["assign", () => lead.post(`/api/units/${id}/stages/${randomUUID()}/assign`, { workCenterId: null, operatorId: null })],
      ["material", () => W.who.worker.http.post(`/api/units/${id}/materials`, { materialId: mat.id, qty: 1 })],
    ];
    for (const [name, call] of calls) { const r = await call(); assert.equal(r.status, 409, `${unit.unitCode} ${name}: ${JSON.stringify(r.body)}`); assert.equal(r.body.code, "UNIT_V2_OWNED", `${unit.unitCode} ${name}`); assert.match(r.body.error, /Production V2/); }
    const after = await testPrisma.unit.findUniqueOrThrow({ where: { id } });
    assert.equal(after.serviceId, null); assert.equal(after.priority, "NORMAL"); assert.equal(after.productionDueAt, null); assert.equal(after.productionRouteId, null);
    assert.equal(await testPrisma.stockMovement.count({ where: { unitId: id } }), 0, "tidak ada pemakaian bahan V1 untuk unit cohort");
  }
  // pemilik V2 tetap dapat DIBACA (Unit 360 / timeline) — hanya jalur tulis V1 yang ditutup
  assert.equal((await W.who.lead.http.get(`/api/units/${W.v2r.id}/timeline`)).status, 200);
});

test("unit NON-cohort tetap bisa lewat jalur V1 (service, production, bahan) — pagar tidak buta", async () => {
  const id = W.v1.id; const lead = W.who.lead.http;
  assert.equal((await lead.patch(`/api/units/${id}/service`, { serviceId: W.services[0].id })).status, 200);
  assert.equal((await lead.patch(`/api/units/${id}/production`, { priority: "HIGH", productionDueAt: "2026-10-21T00:00:00+07:00" })).status, 200);
  const mat = await createTestMaterial(); await seedBalance(mat.id, 20);
  assert.equal((await W.who.worker.http.post(`/api/units/${id}/materials`, { materialId: mat.id, qty: 2 })).status, 201);
  const flags = await testPrisma.v2FeatureFlag.findMany({ where: { key: { in: [V2_FLAGS.PRODUCTION_READER, V2_FLAGS.PRODUCTION_WRITER] } } });
  assert.ok(flags.every((f) => !JSON.stringify(f.config).includes(id)), "cohort tidak berubah");
});

test("KONFLIK ATOMIK layanan: dua penulis paralel dengan expectedServiceId sama → tepat satu 200, satu 409 UNIT_CONFLICT; hasil = nilai pemenang", async () => {
  const u = (await testPrisma.unit.create({ data: { unitCode: "OWN-CS", orderId: W.v1.orderId, seq: 2, status: "AWAITING_PICKUP" } }));
  const [a, b] = await Promise.all([
    W.who.lead.http.patch(`/api/units/${u.id}/service`, { serviceId: W.services[0].id, expectedServiceId: null }),
    W.who.admin.http.patch(`/api/units/${u.id}/service`, { serviceId: W.services[1].id, expectedServiceId: null }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
  const loser = a.status === 409 ? a : b; const winnerSvc = a.status === 200 ? W.services[0].id : W.services[1].id;
  assert.equal(loser.body.code, "UNIT_CONFLICT"); assert.equal(loser.body.current.serviceId, winnerSvc);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: u.id } })).serviceId, winnerSvc);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: u.id, eventType: "SERVICE_ASSIGNED" } }), 1, "satu jejak aktivitas — penulis kalah tidak menulis");
  // expected usang → 409; expected benar → 200; tanpa expected (klien lama) → tetap 200
  assert.equal((await W.who.lead.http.patch(`/api/units/${u.id}/service`, { serviceId: W.services[1].id, expectedServiceId: null })).status, 409);
  assert.equal((await W.who.lead.http.patch(`/api/units/${u.id}/service`, { serviceId: W.services[1].id, expectedServiceId: winnerSvc })).status, 200);
  assert.equal((await W.who.lead.http.patch(`/api/units/${u.id}/service`, { serviceId: W.services[0].id })).status, 200, "kompatibel tanpa expected");
});

test("KONFLIK ATOMIK prioritas/target: paralel → satu menang; expected usang ditolak dengan nilai terkini; yang kalah tidak menimpa", async () => {
  const u = (await testPrisma.unit.create({ data: { unitCode: "OWN-CP", orderId: W.v1.orderId, seq: 3, status: "AWAITING_PICKUP" } }));
  const exp = { priority: "NORMAL", productionDueAt: null };
  const [a, b] = await Promise.all([
    W.who.lead.http.patch(`/api/units/${u.id}/production`, { priority: "URGENT", expected: exp }),
    W.who.admin.http.patch(`/api/units/${u.id}/production`, { priority: "CRITICAL", expected: exp }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
  const winner = a.status === 200 ? "URGENT" : "CRITICAL"; const loser = a.status === 409 ? a : b;
  assert.equal(loser.body.code, "UNIT_CONFLICT"); assert.equal(loser.body.current.priority, winner); assert.match(loser.body.error, /prioritas/);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: u.id } })).priority, winner);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: u.id, eventType: "PRIORITY_CHANGED" } }), 1);
  // target: expected usang
  assert.equal((await W.who.lead.http.patch(`/api/units/${u.id}/production`, { productionDueAt: "2026-11-01T00:00:00+07:00", expected: { priority: winner, productionDueAt: "2026-10-01T00:00:00+07:00" } })).status, 409);
  const ok = await W.who.lead.http.patch(`/api/units/${u.id}/production`, { productionDueAt: "2026-11-01T00:00:00+07:00", expected: { priority: winner, productionDueAt: null } });
  assert.equal(ok.status, 200); assert.equal(ok.body.productionDueAt, "2026-10-31T17:00:00.000Z");
  // nilai sama persis → tidak menulis apa pun (tidak ada konflik palsu)
  assert.equal((await W.who.lead.http.patch(`/api/units/${u.id}/production`, { priority: winner, expected: { priority: winner } })).status, 200);
});

test("blokir paralel: dua penyelesaian bersamaan → satu 200, satu 409 (sudah ada guard atomik engine)", async () => {
  const id = W.lc.id;
  assert.equal((await W.who.lead.http.patch(`/api/units/${id}/service`, { serviceId: W.services[0].id })).status, 200);
  assert.equal((await W.who.worker.http.post(`/api/units/${id}/stages/start`, {})).status, 200);
  const stageId = (await testPrisma.unit.findUniqueOrThrow({ where: { id }, select: { currentStageId: true } })).currentStageId;
  assert.equal((await W.who.worker.http.post(`/api/units/${id}/stages/${stageId}/fail`, { blockReason: "MATERIAL_SHORTAGE", note: "uji" })).status, 200);
  const blocker = (await W.who.lead.http.get(`/api/units/${id}/timeline`)).body.activeBlocker;
  const [a, b] = await Promise.all([W.who.worker.http.post(`/api/units/${id}/blockers/${blocker.id}/resolve`, {}), W.who.qc.http.post(`/api/units/${id}/blockers/${blocker.id}/resolve`, {})]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
});

test("ID RUSAK → 400 jelas (bukan 500): path unit/tahap/blokir, serviceId, materialId, overview V2; UUID valid tak dikenal tetap 404", async () => {
  const lead = W.who.lead.http;
  for (const [m, p, body] of [
    ["get", "/api/units/abc", undefined], ["get", "/api/units/abc/timeline", undefined], ["get", "/api/units/abc/materials", undefined],
    ["patch", "/api/units/abc/service", { serviceId: W.services[0].id }], ["patch", "/api/units/abc/production", { priority: "HIGH" }], ["post", "/api/units/abc/stages/start", {}],
    ["post", `/api/units/${W.v1.id}/stages/abc/complete`, {}], ["post", `/api/units/${W.v1.id}/blockers/abc/resolve`, {}],
    ["patch", `/api/units/${W.v1.id}/service`, { serviceId: "abc" }], ["post", `/api/units/${W.v1.id}/materials`, { materialId: "abc", qty: 1 }],
    ["get", "/api/production-v2/units/abc/overview", undefined],
  ]) { const r = await lead[m](p, body); assert.equal(r.status, 400, `${m} ${p} → ${r.status} ${JSON.stringify(r.body)}`); assert.equal(r.body.code, "ID_INVALID", p); }
  assert.equal((await lead.get(`/api/units/${randomUUID()}/timeline`)).status, 404);
  assert.equal((await lead.get(`/api/units/by-code/KODE-TAK-ADA`)).status, 404, "by-code tidak terpengaruh");
});

test("LIFECYCLE non-cohort via HTTP nyata: layanan → tahap berjalan → jeda/lanjut → QC (QC_LEAD) → bahan → penugasan; izin per peran ditegakkan; hambatan", async () => {
  const id = W.lc.id; const lead = W.who.lead.http; const worker = W.who.worker.http; const qc = W.who.qc.http;
  const tl = async () => (await lead.get(`/api/units/${id}/timeline`)).body;
  // izin: Sales tak boleh mengeksekusi; Worker tak boleh QC / assign / reprioritas
  assert.equal((await W.who.sales.http.post(`/api/units/${id}/stages/start`, {})).status, 403);
  assert.equal((await worker.post(`/api/units/${id}/stages/${randomUUID()}/qc`, { verdict: "PAS", referenceWeightKg: 70 })).status, 403, "Worker tanpa QC_WRITE");
  assert.equal((await worker.patch(`/api/units/${id}/production`, { priority: "HIGH" })).status, 403);
  assert.equal((await worker.post(`/api/units/${id}/stages/${randomUUID()}/assign`, {})).status, 403, "assign butuh PRODUCTION_ASSIGNMENT_WRITE");
  // blokir tahap awal sudah diselesaikan di tes paralel; lanjut jalankan tahap sampai gerbang QC
  let t = await tl(); let guard = 0;
  while (t.path.find((p) => p.isCurrent)?.stage.requiresQc !== true && guard++ < 12) {
    const cur = t.path.find((p) => p.isCurrent);
    if (cur.status === "READY" || cur.status === "NOT_STARTED" || cur.status === "BLOCKED") assert.equal((await worker.post(`/api/units/${id}/stages/start`, {})).status, 200);
    if (cur.stage.id) {
      const p = await worker.post(`/api/units/${id}/stages/${cur.stage.id}/pause`, { reason: "BREAK" });
      if (p.status === 200) assert.equal((await worker.post(`/api/units/${id}/stages/${cur.stage.id}/resume`, {})).status, 200, "jeda → lanjut");
      const c = await worker.post(`/api/units/${id}/stages/${cur.stage.id}/complete`, { photoUrls: ["/media/unit-photos/uji.jpg"], note: "selesai (uji)" });
      assert.equal(c.status, 200, `complete ${cur.stage.labelId}: ${JSON.stringify(c.body)}`);
    }
    t = await tl();
  }
  const gate = t.path.find((p) => p.isCurrent);
  assert.equal(gate.stage.requiresQc, true, "sampai gerbang QC");
  if (gate.status !== "IN_PROGRESS") assert.equal((await worker.post(`/api/units/${id}/stages/start`, {})).status, 200);
  const q = await qc.post(`/api/units/${id}/stages/${gate.stage.id}/qc`, { verdict: "PAS", referenceWeightKg: 72, educationGiven: false, note: "uji", photoUrls: ["/media/unit-photos/qc.jpg"] });
  assert.equal(q.status, 200, JSON.stringify(q.body));
  const after = await tl();
  assert.equal(after.qcFitTests.length, 1); assert.equal(after.qcFitTests[0].verdict, "PAS");
  assert.notEqual(after.path.find((p) => p.isCurrent)?.stage.id, gate.stage.id, "maju dari gerbang QC");
  // penugasan (Lead) + bahan (Worker) pada tahap sekarang
  const wc = await testPrisma.workCenter.create({ data: { code: "WC-OWN", name: "Meja Uji" } });
  const cur = after.path.find((p) => p.isCurrent);
  assert.equal((await lead.post(`/api/units/${id}/stages/${cur.stage.id}/assign`, { workCenterId: wc.id, operatorId: null })).status, 200);
  assert.equal((await tl()).workCenter.id, wc.id, "penugasan tersimpan");
  const mat = await createTestMaterial(); await seedBalance(mat.id, 9);
  assert.equal((await worker.post(`/api/units/${id}/materials`, { materialId: mat.id, qty: 3 })).status, 201);
  const used = (await worker.get(`/api/units/${id}/materials`)).body;
  assert.equal(used.totals.find((x) => x.material.id === mat.id).usedQty, 3, "pemakaian bahan tercatat (stok V1)");
});

test("NOL artefak V2: seluruh aksi V1 (layanan, prioritas, tahap, QC, bahan, penugasan, blokir) tidak membuat Run/rencana/custody/command/outbox/operation V2", async () => {
  assert.deepEqual(await v2Footprint(), FOOT0);
  const flags = await testPrisma.v2FeatureFlag.findMany({ where: { key: { in: [V2_FLAGS.PRODUCTION_READER, V2_FLAGS.PRODUCTION_WRITER] } }, orderBy: { key: "asc" } });
  assert.equal(flags.length, 2);
  assert.ok(flags.every((f) => f.config.unitIds.length === 1), "cohort tidak diperluas (tepat satu unit per flag)");
  assert.deepEqual(flags.map((f) => f.config.unitIds[0]).sort(), [W.v2r.id, W.v2w.id].sort());
});
