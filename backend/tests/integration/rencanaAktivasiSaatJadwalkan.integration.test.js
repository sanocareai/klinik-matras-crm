// Aktivasi unit SAAT dijadwalkan — HTTP + DB sungguhan (DB uji terisolasi). Pemegang izin Pengaturan Produksi (ADMIN/OWNER) boleh menjadwalkan/menyeret unit yang belum diaktifkan:
// unit otomatis ditambahkan ke cohort reader+writer di transaksi YANG SAMA dengan Run + rencana + jadwal. Selain ADMIN/OWNER tetap ditolak; progres V1 tetap ditolak; flag MATI tetap berhenti;
// kegagalan di mana pun = cohort tidak berubah (tidak ada unit setengah aktif).
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

const V2 = "/api/production-v2";
const DATE = "2026-10-12";
let server; let seq = 0; let w;

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.beforeEach(async () => { await truncateAll(); w = await world(); });

const idem = (tag) => ({ "Idempotency-Key": `aktif-${tag}-${++seq}-0000` });
async function setFlag(flagKey, unitIds) {
  const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "aktivasi test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
const setCohort = async (...ids) => { for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(k, ids.length ? ids : null); };
const cohortOf = async (key) => {
  const row = await testPrisma.v2FeatureFlag.findUnique({ where: { key } });
  return row?.enabled ? [...(row.config?.unitIds ?? [])].sort() : null;
};

async function world() {
  const [lead, admin] = await Promise.all([createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["ADMIN"] })]);
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  const wc = await testPrisma.workCenter.create({ data: { code: `WC-AK-${++seq}`, name: "Workshop Utama" } });
  return { lead: c(lead), admin: c(admin), wc };
}
async function mkOperator() {
  const u = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  await testPrisma.userRole.create({ data: { userId: u.user.id, role: "PRODUCTION_WORKER" } });
  const op = await testPrisma.productionOperator.create({ data: { userId: u.user.id, primaryWorkCenterId: w.wc.id, active: true } });
  return { ...u, op };
}
// Order nyata Diproses, unit RECEIVED, TANPA pickup (jalur "tanpa custody": Run PENDING_ARRIVAL, kedatangan dikonfirmasi petugas).
async function mkReal({ category = "LAYANAN" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Bu Aktivasi ${++seq}`, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ORD-AK-${++seq}`, value: 1_000_000, category, status: "PROCESSING" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `AK-${seq}-0`, orderId: order.id, seq: 1, status: "RECEIVED", merk: "Serta", ukuran: "160x200" } });
  return { unit, order, customer };
}
const body = (op, over = {}) => ({ productionDate: DATE, stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, ...over });
const post = (who, unit, op, over = {}, headers = idem("sch")) => who.api.post(`${V2}/plans`, { unitId: unit.id, ...body(op, over) }, headers);
const itemOf = (b, unit) => b.items.find((i) => i.unitId === unit.id);
const runCount = (unit) => testPrisma.productionRun.count({ where: { unitId: unit.id } });

test("ADMIN menyeret/menjadwalkan unit BELUM diaktifkan: unit masuk cohort reader+writer (cohort lama utuh) + Run + rencana dalam SATU transaksi; jejak aktivitas atas nama ADMIN", async () => {
  const lain = await mkReal(); const unit = await mkReal(); const op = await mkOperator();
  await setCohort(lain.unit.id);
  // server menandai kartu: ADMIN melihat activatable, Production Lead (tanpa izin Pengaturan Produksi) tidak
  const bAdmin = (await w.admin.api.get(`${V2}/backlog?pageSize=100`)).body;
  assert.equal(itemOf(bAdmin, unit.unit).rencana.action, "AWAIT_ACTIVATION"); assert.equal(itemOf(bAdmin, unit.unit).rencana.activatable, true);
  assert.equal(itemOf(bAdmin, unit.unit).rencana.onboardable, false);
  const bLead = (await w.lead.api.get(`${V2}/backlog?pageSize=100`)).body;
  assert.equal(itemOf(bLead, unit.unit).rencana.activatable, false);

  const res = await post(w.admin, unit.unit, op, { activateUnit: true }, { "Idempotency-Key": "aktif-adm-satu-0001" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.activated, true); assert.equal(res.body.onboarded, true); assert.equal(res.body.stationCode, "TABLE_1");
  const want = [lain.unit.id, unit.unit.id].sort();
  assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_READER), want); assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_WRITER), want);
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.unit.id }, include: { plan: true } });
  assert.equal(run.status, "PENDING_ARRIVAL", "aktivasi TIDAK membuktikan kedatangan fisik"); assert.equal(run.plan.stationCode, "TABLE_1");
  const ev = await testPrisma.activityEvent.findMany({ where: { entityId: unit.unit.id, eventType: "PRODUCTION_RENCANA_UNIT_ACTIVATED" } });
  assert.equal(ev.length, 1); assert.equal(ev[0].actorId, w.admin.user.id);
  // idempoten: replay tidak mengaktifkan/membuat apa pun lagi
  const replay = await w.admin.api.post(`${V2}/plans`, { unitId: unit.unit.id, ...body(op), activateUnit: true }, { "Idempotency-Key": "aktif-adm-satu-0001" });
  assert.equal(replay.status, 201); assert.equal(replay.body.replayed, true);
  assert.equal(await runCount(unit.unit), 1);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: unit.unit.id, eventType: "PRODUCTION_RENCANA_UNIT_ACTIVATED" } }), 1);
  assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_WRITER), want);
});

test("bukan ADMIN/OWNER (Production Lead): activateUnit ditolak 403 berkode; tanpa activateUnit tetap 503 'belum diaktifkan'; cohort & Run tak berubah", async () => {
  const lain = await mkReal(); const unit = await mkReal(); const op = await mkOperator();
  await setCohort(lain.unit.id);
  const r1 = await w.lead.api.post(`${V2}/plans`, { unitId: unit.unit.id, ...body(op), activateUnit: true }, idem("lead"));
  assert.equal(r1.status, 403, JSON.stringify(r1.body)); assert.equal(r1.body.code, "RENCANA_ACTIVATION_FORBIDDEN");
  const r2 = await post(w.lead, unit.unit, op);
  assert.equal(r2.status, 503); assert.equal(r2.body.code, "RENCANA_UNIT_NOT_ACTIVATED");
  assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_WRITER), [lain.unit.id]);
  assert.equal(await runCount(unit.unit), 0);
});

test("ADMIN tanpa activateUnit: perilaku lama tetap (503 belum diaktifkan) — aktivasi tidak pernah terjadi tanpa permintaan eksplisit", async () => {
  const lain = await mkReal(); const unit = await mkReal(); const op = await mkOperator();
  await setCohort(lain.unit.id);
  const r = await post(w.admin, unit.unit, op);
  assert.equal(r.status, 503); assert.equal(r.body.code, "RENCANA_UNIT_NOT_ACTIVATED");
  assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_READER), [lain.unit.id]); assert.equal(await runCount(unit.unit), 0);
});

test("progres V1 tetap ditolak walau ADMIN meminta aktivasi: 422, cohort & riwayat V1 utuh, tanpa Run", async () => {
  const lain = await mkReal(); const v1 = await mkReal(); const op = await mkOperator();
  await testPrisma.unitStageLog.create({ data: { unitId: v1.unit.id, stageId: (await testPrisma.routingStage.findFirstOrThrow()).id, action: "START", actorId: w.lead.user.id, startedAt: new Date() } });
  await setCohort(lain.unit.id);
  const bAdmin = (await w.admin.api.get(`${V2}/backlog?pageSize=100`)).body;
  assert.equal(itemOf(bAdmin, v1.unit).rencana.activatable, false, "kartu progres V1 tidak ditawarkan untuk diaktifkan");
  const r = await w.admin.api.post(`${V2}/plans`, { unitId: v1.unit.id, ...body(op), activateUnit: true }, idem("v1"));
  assert.equal(r.status, 422, JSON.stringify(r.body)); assert.equal(r.body.code, "RENCANA_HAS_V1_PROGRESS");
  assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_WRITER), [lain.unit.id]);
  assert.equal(await runCount(v1.unit), 0); assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: v1.unit.id } }), 1);
});

test("flag MATI: aktivasi tidak menyalakan flag — 503 RENCANA_ACTIVATION_FLAGS_OFF, tidak ada Run, kartu tidak ditawarkan", async () => {
  const unit = await mkReal(); const op = await mkOperator();
  await setCohort(); // kedua flag OFF
  const bAdmin = (await w.admin.api.get(`${V2}/backlog?pageSize=100`)).body;
  assert.equal(itemOf(bAdmin, unit.unit).rencana.activatable, false);
  const r = await w.admin.api.post(`${V2}/plans`, { unitId: unit.unit.id, ...body(op), activateUnit: true }, idem("off"));
  assert.equal(r.status, 503, JSON.stringify(r.body)); assert.equal(r.body.code, "RENCANA_ACTIVATION_FLAGS_OFF");
  assert.equal(await cohortOf(V2_FLAGS.PRODUCTION_WRITER), null); assert.equal(await runCount(unit.unit), 0);
});

test("ATOMIK: jadwal gagal (PIC tidak valid) membatalkan aktivasi — cohort kembali seperti semula, tanpa Run yatim", async () => {
  const lain = await mkReal(); const unit = await mkReal();
  await setCohort(lain.unit.id);
  const r = await w.admin.api.post(`${V2}/plans`, { unitId: unit.unit.id, productionDate: DATE, stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: "00000000-0000-4000-8000-000000000000", activateUnit: true }, idem("atom"));
  assert.ok(r.status >= 400 && r.status < 500, `harus ditolak: ${r.status} ${JSON.stringify(r.body)}`);
  assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_READER), [lain.unit.id]); assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_WRITER), [lain.unit.id]);
  assert.equal(await runCount(unit.unit), 0);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: unit.unit.id, eventType: "PRODUCTION_RENCANA_UNIT_ACTIVATED" } }), 0);
});
