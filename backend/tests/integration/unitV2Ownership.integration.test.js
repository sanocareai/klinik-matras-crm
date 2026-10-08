// P12B.6 — (1) pagar server: unit DIMILIKI V2 (writer ON + Run non-terminal) menolak 409 UNIT_V2_OWNED pada jalur V1 (layanan, prioritas/target, rute, penugasan, bahan, tahap); selain itu jalur V1 tetap bekerja (matriks 5 keadaan di akhir berkas);
// (2) konflik ATOMIK di DB (compare-and-set) termasuk lomba paralel; (3) ID rusak → 400 bukan 500; (4) lifecycle unit non-cohort via HTTP nyata (tahap, QC, bahan, penugasan,
// jeda/lanjut, hambatan) dengan izin per peran; (5) NOL artefak V2 dari seluruh aksi V1.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { assignCurrentStageTo, createTestUser, createTestMaterial, seedBalance } from "./setup/fixtures.js";
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
  await assignCurrentStageTo(id, W.who.worker.user.id); // P12C.2: aksi tahap hanya untuk PIC yang ditugaskan
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
    await assignCurrentStageTo(id, W.who.worker.user.id); // P12C.2: tahap Meja/Corner ditugaskan ke PIC sebelum dikerjakan
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

// ---- Matriks kepemilikan: SATU definisi (writer ON untuk unit + Run non-terminal) dipakai engine tahap DAN endpoint V1 layanan/prioritas/rute/penugasan/bahan. ----
test("MATRIKS KEPEMILIKAN: writer OFF, reader-only, cohort tanpa Run → jalur V1 bekerja; Run aktif → V1 ditolak 409; Run terminal → V1 bekerja lagi (tak ada unit terkunci tanpa jalur sah)", async () => {
  const mat = await createTestMaterial(); await seedBalance(mat.id, 100);
  let n = 0;
  const mk = (tag) => testPrisma.unit.create({ data: { unitCode: `OWN-M-${tag}`, orderId: W.v1.orderId, seq: 20 + (++n), status: "AWAITING_PICKUP" } });
  const U = { off: await mk("OFF"), readerOnly: await mk("RDR"), noRun: await mk("NORUN"), active: await mk("ACT"), done: await mk("DONE"), cancelled: await mk("CNX") };
  const run = (unit, status) => testPrisma.productionRun.create({ data: { unitId: unit.id, status, kind: "RESTORATION", currentPhase: status === "ACTIVE" ? "PROCESS" : null } });
  // Unit aktif diberi layanan lewat V1 SEBELUM dimiliki V2 supaya rute/tahap nyata terbentuk (uji penolakan engine di tahap sungguhan).
  assert.equal((await W.who.lead.http.patch(`/api/units/${U.active.id}/service`, { serviceId: W.services[0].id })).status, 200);
  const path0 = (await W.who.lead.http.get(`/api/units/${U.active.id}/timeline`)).body.path ?? [];
  assert.ok(path0.length > 0, "rute unit aktif terbentuk");
  await run(U.active, "ACTIVE"); await run(U.done, "COMPLETED"); await run(U.cancelled, "CANCELLED");
  await flag(V2_FLAGS.PRODUCTION_READER, [U.readerOnly.id, U.noRun.id, U.active.id, U.done.id, U.cancelled.id]);
  await flag(V2_FLAGS.PRODUCTION_WRITER, [U.noRun.id, U.active.id, U.done.id, U.cancelled.id]);
  const lead = W.who.lead.http; const worker = W.who.worker.http;
  const owned = (r) => r.status === 409 && r.body?.code === "UNIT_V2_OWNED";
  const overviewOwnership = async (unit) => { const r = await lead.get(`/api/production-v2/units/${unit.id}/overview`); return { status: r.status, owned: r.body?.ownership?.v2ExecutionOwned }; };

  // Keadaan yang TIDAK dimiliki V2: seluruh jalur V1 bekerja (layanan, prioritas/target, bahan) dan tidak ada penolakan UNIT_V2_OWNED di rute/penugasan/tahap.
  for (const [name, unit] of Object.entries({ off: U.off, readerOnly: U.readerOnly, noRun: U.noRun, done: U.done, cancelled: U.cancelled })) {
    const svc = await lead.patch(`/api/units/${unit.id}/service`, { serviceId: W.services[0].id, expectedServiceId: null });
    assert.equal(svc.status, 200, `${name} service: ${JSON.stringify(svc.body)}`);
    const prod = await lead.patch(`/api/units/${unit.id}/production`, { priority: "HIGH" });
    assert.equal(prod.status, 200, `${name} production: ${JSON.stringify(prod.body)}`);
    const mt = await worker.post(`/api/units/${unit.id}/materials`, { materialId: mat.id, qty: 1 });
    assert.equal(mt.status, 201, `${name} bahan: ${JSON.stringify(mt.body)}`);
    await assignCurrentStageTo(unit.id, W.who.worker.user.id); // P12C.2
    for (const [what, r] of [["route", await lead.post(`/api/units/${unit.id}/route`, {})], ["assign", await lead.post(`/api/units/${unit.id}/stages/${randomUUID()}/assign`, { workCenterId: null, operatorId: null })], ["stage", await worker.post(`/api/units/${unit.id}/stages/start`, {})]]) {
      assert.ok(!owned(r), `${name} ${what} tidak boleh ditolak sebagai milik V2: ${JSON.stringify(r.body)}`);
      if (what === "stage") assert.equal(r.status, 200, `${name} mulai tahap V1 berjalan: ${JSON.stringify(r.body)}`);
    }
  }
  // Reader cohort: Unit 360 melaporkan V2 TIDAK memegang eksekusi → drawer menawarkan tab "Kerja V1" (kontrak sama dengan guard server).
  for (const [name, unit] of Object.entries({ readerOnly: U.readerOnly, noRun: U.noRun, done: U.done, cancelled: U.cancelled })) {
    const ov = await overviewOwnership(unit); assert.equal(ov.status, 200, `${name} overview`); assert.equal(ov.owned, false, `${name} ownership`);
  }
  assert.equal((await lead.get(`/api/production-v2/units/${U.off.id}/overview`)).status, 404, "writer/reader OFF: Unit 360 tak tersedia (drawer memakai jalur V1)");

  // Run AKTIF + writer ON: V2 memiliki — SEMUA jalur V1 ditolak 409 UNIT_V2_OWNED tanpa mengubah data.
  const id = U.active.id;
  const before = await testPrisma.unit.findUniqueOrThrow({ where: { id } });
  const logsBefore = await testPrisma.unitStageLog.count({ where: { unitId: id } });
  const calls = [
    ["service", () => lead.patch(`/api/units/${id}/service`, { serviceId: W.services[0].id })],
    ["production", () => lead.patch(`/api/units/${id}/production`, { priority: "URGENT" })],
    ["route", () => lead.post(`/api/units/${id}/route`, {})],
    ["assign", () => lead.post(`/api/units/${id}/stages/${randomUUID()}/assign`, { workCenterId: null, operatorId: null })],
    ["material", () => worker.post(`/api/units/${id}/materials`, { materialId: mat.id, qty: 1 })],
  ];
  for (const [name, call] of calls) { const r = await call(); assert.ok(owned(r), `aktif ${name}: ${r.status} ${JSON.stringify(r.body)}`); }
  const stage = await worker.post(`/api/units/${id}/stages/start`, {});
  assert.equal(stage.status, 409, "tahap V1 pada unit milik V2 ditolak engine"); assert.match(JSON.stringify(stage.body), /Production V2/);
  const after = await testPrisma.unit.findUniqueOrThrow({ where: { id } });
  assert.deepEqual([after.serviceId, after.priority, after.productionDueAt, after.productionRouteId], [before.serviceId, before.priority, before.productionDueAt, before.productionRouteId]);
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: id } }), 0);
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: id } }), logsBefore, "penolakan tahap tidak menulis log");
  const ov = await overviewOwnership(U.active); assert.equal(ov.status, 200); assert.equal(ov.owned, true, "Run aktif + writer ON → V2 memiliki (tab Kerja V1 tidak ditawarkan)");

  // Unit milik V2 tetap DAPAT DIBACA lewat timeline V1.
  assert.equal((await lead.get(`/api/units/${id}/timeline`)).status, 200);
});

// ---- RACE: command V1 bersamaan dengan pembukaan Run V2. Kunci unit tunggal (lockUnitOwnership) di gerbang V1 DAN pembuka Run V2. ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function openRunHolding(unitId, ms) { // pembukaan Run V2 NYATA (openProductionIntakeV2) yang menahan kunci unit sebelum commit
  const { openProductionIntakeV2 } = await import("../../src/services/unitCustodyCommandService.js");
  return testPrisma.$transaction(async (tx) => { const r = await openProductionIntakeV2(tx, { unitId, actorId: null }); await sleep(ms); return r; }, { timeout: 30000, maxWait: 10000 });
}

test("RACE deterministik: V1 yang tiba SAAT Run V2 sedang dibuka menunggu kunci unit lalu ditolak; tidak ada tulisan V1 setelah ownership V2 aktif", async () => {
  const mat = await createTestMaterial(); await seedBalance(mat.id, 100);
  let n = 0;
  const mk = (tag) => testPrisma.unit.create({ data: { unitCode: `OWN-R-${tag}`, orderId: W.v1.orderId, seq: 100 + (++n), status: "AWAITING_PICKUP" } });
  const names = ["service", "production", "route", "assign", "material", "stage"];
  const U = Object.fromEntries(await Promise.all(names.map(async (k) => [k, await mk(k)])));
  assert.equal((await W.who.lead.http.patch(`/api/units/${U.stage.id}/service`, { serviceId: W.services[0].id })).status, 200); // rute + tahap nyata untuk uji engine
  await flag(V2_FLAGS.PRODUCTION_WRITER, Object.values(U).map((u) => u.id)); await flag(V2_FLAGS.PRODUCTION_READER, Object.values(U).map((u) => u.id));
  const lead = W.who.lead.http; const worker = W.who.worker.http;
  const calls = {
    service: (u) => lead.patch(`/api/units/${u.id}/service`, { serviceId: W.services[1].id }),
    production: (u) => lead.patch(`/api/units/${u.id}/production`, { priority: "URGENT" }),
    route: (u) => lead.post(`/api/units/${u.id}/route`, {}),
    assign: (u) => lead.post(`/api/units/${u.id}/stages/${randomUUID()}/assign`, { workCenterId: null, operatorId: null }),
    material: (u) => worker.post(`/api/units/${u.id}/materials`, { materialId: mat.id, qty: 1 }),
    stage: (u) => worker.post(`/api/units/${u.id}/stages/start`, {}),
  };
  for (const name of names) {
    const unit = U[name]; const before = await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } });
    const logs0 = await testPrisma.unitStageLog.count({ where: { unitId: unit.id } });
    const holder = openRunHolding(unit.id, 900);
    await sleep(250); // holder sudah memegang kunci unit (Run belum commit)
    const t0 = Date.now(); const r = await calls[name](unit); const waited = Date.now() - t0;
    await holder;
    assert.ok(waited >= 400, `${name}: V1 harus MENUNGGU kunci unit (menunggu ${waited}ms)`);
    assert.equal(r.status, 409, `${name}: ${JSON.stringify(r.body)}`);
    if (name !== "stage") assert.equal(r.body.code, "UNIT_V2_OWNED", name); // engine tahap: UNIT_V2_OWNED dipetakan ke pesan engine; wajib 409
    const after = await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } });
    assert.deepEqual([after.serviceId, after.priority, after.productionRouteId, after.currentStageId], [before.serviceId, before.priority, before.productionRouteId, before.currentStageId], `${name}: unit tidak berubah`);
    assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: unit.id } }), logs0, `${name}: tak ada log tahap V1`);
    assert.equal(await testPrisma.stockMovement.count({ where: { unitId: unit.id } }), 0, `${name}: tak ada pemakaian bahan V1`);
    assert.equal(await testPrisma.productionRun.count({ where: { unitId: unit.id } }), 1, `${name}: Run V2 terbentuk`);
    assert.equal(await testPrisma.activityEvent.count({ where: { entityId: unit.id, eventType: "PRODUCTION_V1_WRITE_ON_V2_RUN" } }), 0, `${name}: V1 ditolak bersih, tanpa penanda`);
  }
});

test("RACE acak: V1 paralel dengan pembukaan Run V2 — hasil selalu serial (V1 sukses SEBELUM Run, atau ditolak 409); tak pernah 5xx atau tulisan setelah ownership", async () => {
  const mat = await createTestMaterial(); await seedBalance(mat.id, 100);
  const units = []; for (let i = 0; i < 8; i++) units.push(await testPrisma.unit.create({ data: { unitCode: `OWN-RR-${i}`, orderId: W.v1.orderId, seq: 200 + i, status: "AWAITING_PICKUP" } }));
  await flag(V2_FLAGS.PRODUCTION_WRITER, units.map((u) => u.id)); await flag(V2_FLAGS.PRODUCTION_READER, units.map((u) => u.id));
  const results = await Promise.all(units.map(async (u, i) => {
    const call = i % 2 === 0 ? W.who.lead.http.patch(`/api/units/${u.id}/service`, { serviceId: W.services[0].id }) : W.who.worker.http.post(`/api/units/${u.id}/materials`, { materialId: mat.id, qty: 1 });
    const [r] = await Promise.all([call, openRunHolding(u.id, 30)]);
    return { u, i, r };
  }));
  for (const { u, i, r } of results) {
    assert.ok([200, 201, 409].includes(r.status), `unit ${i}: status tak terduga ${r.status} ${JSON.stringify(r.body)}`);
    const row = await testPrisma.unit.findUniqueOrThrow({ where: { id: u.id } });
    const moves = await testPrisma.stockMovement.count({ where: { unitId: u.id } });
    if (r.status === 409) { assert.equal(r.body.code, "UNIT_V2_OWNED"); assert.equal(i % 2 === 0 ? row.serviceId : moves, i % 2 === 0 ? null : 0, `unit ${i}: ditolak = tak menulis`); }
    else assert.equal(i % 2 === 0 ? !!row.serviceId : moves === 1, true, `unit ${i}: sukses = tertulis`);
    assert.equal(await testPrisma.productionRun.count({ where: { unitId: u.id } }), 1);
    assert.equal(await testPrisma.activityEvent.count({ where: { entityId: u.id, eventType: "PRODUCTION_V1_WRITE_ON_V2_RUN" } }), 0, "V1 yang sukses terjadi SEBELUM Run ada: tanpa penanda drift");
  }
});
