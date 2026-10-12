// Aktivasi unit SAAT dijadwalkan (seret-lepas / Jadwalkan) — HTTP + DB sungguhan (DB uji terisolasi).
// Aturan: HANYA ADMIN/OWNER, HANYA unit eligible yang belum di cohort dan TIDAK punya Run apa pun (aktif/selesai/dibatalkan) maupun progres V1, HANYA bila diminta eksplisit
// (activateUnit=true). Unit dengan Run lama di luar cohort tetap Pengecualian — pengambilalihan Run lama tidak dibuka lewat Jadwalkan.
// Setiap kegagalan harus meninggalkan cohort, Run, rencana, PIC meja, target, command, jejak aktivitas, dan histori jadwal PERSIS seperti sebelumnya (tanpa data parsial).
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
const ACT = "PRODUCTION_RENCANA_UNIT_ACTIVATED";
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
  const [lead, admin, admin2, owner] = await Promise.all([
    createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["ADMIN"] }), createTestUser({ roles: ["ADMIN"] }), createTestUser({ roles: ["OWNER"] }),
  ]);
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  const wc = await testPrisma.workCenter.create({ data: { code: `WC-AK-${++seq}`, name: "Workshop Utama" } });
  return { lead: c(lead), admin: c(admin), admin2: c(admin2), owner: c(owner), wc };
}
async function mkOperator() {
  const u = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  await testPrisma.userRole.create({ data: { userId: u.user.id, role: "PRODUCTION_WORKER" } });
  const op = await testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: u.user.id, primaryWorkCenterId: w.wc.id, active: true } });
  return { ...u, op };
}
// Order nyata Diproses, unit RECEIVED, TANPA pickup/Run.
async function mkReal({ unitStatus = "RECEIVED", orderStatus = "PROCESSING" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Bu Aktivasi ${++seq}`, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ORD-AK-${++seq}`, value: 1_000_000, category: "LAYANAN", status: orderStatus } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `AK-${seq}-0`, orderId: order.id, seq: 1, status: unitStatus, merk: "Serta", ukuran: "160x200" } });
  return { unit, order, customer };
}
const body = (op, over = {}) => ({ productionDate: DATE, stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, ...over });
const drop = (who, unit, op, over = {}, headers = idem("drop")) => who.api.post(`${V2}/plans`, { unitId: unit.id, ...body(op, over), activateUnit: true }, headers);
const itemOf = (b, unit) => b.items.find((i) => i.unitId === unit.id);
const backlogFor = async (who) => (await who.api.get(`${V2}/backlog?pageSize=100`)).body;

// Sidik keadaan lengkap: kegagalan harus meninggalkan ini IDENTIK.
async function state() {
  const flags = await testPrisma.v2FeatureFlag.findMany({ where: { key: { in: [V2_FLAGS.PRODUCTION_READER, V2_FLAGS.PRODUCTION_WRITER] } }, orderBy: { key: "asc" } });
  return {
    flags: flags.map((f) => ({ key: f.key, enabled: f.enabled, config: f.config, reason: f.reason, updatedAt: f.updatedAt?.toISOString?.() ?? null })),
    runs: await testPrisma.productionRun.count(),
    plans: await testPrisma.productionRunPlan.count(),
    commands: await testPrisma.v2Command.count(),
    activations: await testPrisma.activityEvent.count({ where: { eventType: ACT } }),
    onboarded: await testPrisma.activityEvent.count({ where: { eventType: "PRODUCTION_RUN_ONBOARDED_RENCANA" } }),
    pics: await testPrisma.productionStationDayPic.count(),
    history: await testPrisma.productionPlanScheduleEvent.count(),
    handoffs: await testPrisma.unitCustodyHandoff.count(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
test("ADMIN dan OWNER: seret unit BELUM diaktifkan -> cohort reader+writer bertambah TEPAT unit itu (cohort lama utuh) + Run PENDING_ARRIVAL + rencana + jadwal; jejak atas nama pemutus; replay idempoten", async () => {
  const lain = await mkReal(); const a = await mkReal(); const b = await mkReal(); const op = await mkOperator();
  await setCohort(lain.unit.id);
  const bAdmin = await backlogFor(w.admin);
  assert.equal(itemOf(bAdmin, a.unit).rencana.activatable, true); assert.equal(itemOf(bAdmin, a.unit).rencana.action, "AWAIT_ACTIVATION"); assert.equal(itemOf(bAdmin, a.unit).rencana.onboardable, false);
  assert.equal(itemOf(await backlogFor(w.lead), a.unit).rencana.activatable, false, "Production Lead tidak ditawari aktivasi");

  const res = await drop(w.admin, a.unit, op, { priority: 1 }, { "Idempotency-Key": "aktif-adm-satu-0001" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.activated, true); assert.equal(res.body.onboarded, true); assert.equal(res.body.stationCode, "TABLE_1"); assert.equal(res.body.priority, 1);
  assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_READER), [lain.unit.id, a.unit.id].sort()); assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_WRITER), [lain.unit.id, a.unit.id].sort());
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: a.unit.id }, include: { plan: true } });
  assert.equal(run.status, "PENDING_ARRIVAL", "aktivasi tidak membuktikan kedatangan fisik"); assert.equal(run.plan.status, "PLANNED"); assert.equal(run.plan.stationCode, "TABLE_1"); assert.equal(run.plan.targetDate, null, "target = tanggal papan (tanpa pengecualian)");
  const ev = await testPrisma.activityEvent.findMany({ where: { entityId: a.unit.id, eventType: ACT } });
  assert.equal(ev.length, 1); assert.equal(ev[0].actorId, w.admin.user.id);
  // replay (kunci sama): tidak ada tambahan apa pun
  const before = await state();
  const replay = await w.admin.api.post(`${V2}/plans`, { unitId: a.unit.id, ...body(op, { priority: 1 }), activateUnit: true }, { "Idempotency-Key": "aktif-adm-satu-0001" });
  assert.equal(replay.status, 201); assert.equal(replay.body.replayed, true);
  assert.deepEqual(await state(), before, "replay tidak menulis apa pun");
  // OWNER juga boleh (unit lain)
  const o = await drop(w.owner, b.unit, op, { stationCode: "TABLE_2" });
  assert.equal(o.status, 201, JSON.stringify(o.body)); assert.equal(o.body.activated, true);
  assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_WRITER), [lain.unit.id, a.unit.id, b.unit.id].sort());
});

test("izin: Production Lead activateUnit = 403 berkode; tanpa activateUnit ADMIN tetap 503 'belum diaktifkan' — keadaan tidak berubah", async () => {
  const lain = await mkReal(); const unit = await mkReal(); const op = await mkOperator();
  await setCohort(lain.unit.id);
  const before = await state();
  const r1 = await drop(w.lead, unit.unit, op);
  assert.equal(r1.status, 403, JSON.stringify(r1.body)); assert.equal(r1.body.code, "RENCANA_ACTIVATION_FORBIDDEN");
  const r2 = await w.admin.api.post(`${V2}/plans`, { unitId: unit.unit.id, ...body(op) }, idem("tanpa-flag"));
  assert.equal(r2.status, 503); assert.equal(r2.body.code, "RENCANA_UNIT_NOT_ACTIVATED");
  const r3 = await w.admin.api.post(`${V2}/plans`, { unitId: unit.unit.id, ...body(op), activateUnit: "true" }, idem("string"));
  assert.equal(r3.status, 503, "hanya boolean true yang dianggap persetujuan");
  assert.deepEqual(await state(), before);
});

test("Run LAMA di luar cohort (aktif, tanpa log tahap V1) tetap PENGECUALIAN: kartu tidak ditawarkan, aktivasi 422 RENCANA_RUN_OUTSIDE_COHORT, Run lama tidak diambil alih", async () => {
  const lain = await mkReal(); const x = await mkReal(); const op = await mkOperator();
  await testPrisma.productionRun.create({ data: { unitId: x.unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS" } });
  await setCohort(lain.unit.id);
  const it = itemOf(await backlogFor(w.admin), x.unit);
  assert.equal(it.rencana.action, "EXCEPTION"); assert.equal(it.rencana.code, "RUN_OUTSIDE_COHORT"); assert.equal(it.rencana.activatable, false); assert.equal(it.rencana.onboardable, false);
  const before = await state();
  const r = await drop(w.admin, x.unit, op);
  assert.equal(r.status, 422, JSON.stringify(r.body)); assert.equal(r.body.code, "RENCANA_RUN_OUTSIDE_COHORT");
  assert.deepEqual(await state(), before);
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: x.unit.id } }), 1); assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_WRITER), [lain.unit.id]);
});

test("unit yang PERNAH punya Run (selesai/dibatalkan) atau punya progres tahap V1: tidak ditawarkan dan ditolak 422, tanpa menulis apa pun", async () => {
  const lain = await mkReal(); const op = await mkOperator();
  const selesai = await mkReal(); const v1 = await mkReal();
  await testPrisma.productionRun.create({ data: { unitId: selesai.unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "CANCELLED", currentPhase: "HANDOFF" } });
  await testPrisma.unitStageLog.create({ data: { unitId: v1.unit.id, stageId: (await testPrisma.routingStage.findFirstOrThrow()).id, action: "START", actorId: w.lead.user.id, startedAt: new Date() } });
  await setCohort(lain.unit.id);
  const b = await backlogFor(w.admin);
  assert.equal(itemOf(b, selesai.unit).rencana.activatable, false); assert.equal(itemOf(b, v1.unit).rencana.activatable, false);
  const before = await state();
  const r1 = await drop(w.admin, selesai.unit, op); assert.equal(r1.status, 422, JSON.stringify(r1.body)); assert.equal(r1.body.code, "RENCANA_HAS_PRIOR_RUN");
  const r2 = await drop(w.admin, v1.unit, op); assert.equal(r2.status, 422, JSON.stringify(r2.body)); assert.equal(r2.body.code, "RENCANA_HAS_V1_PROGRESS");
  assert.deepEqual(await state(), before);
});

test("eligibility berubah saat modal terbuka: unit dibatalkan/selesai -> 422; unit sudah diaktifkan+dijadwalkan orang lain -> 409 RENCANA_ACTIVATION_STALE (jadwal orang lain tidak digeser)", async () => {
  const lain = await mkReal(); const gone = await mkReal(); const taken = await mkReal(); const op = await mkOperator();
  await setCohort(lain.unit.id);
  const b = await backlogFor(w.admin);
  assert.equal(itemOf(b, gone.unit).rencana.activatable, true); assert.equal(itemOf(b, taken.unit).rencana.activatable, true); // modal dibuka dari keadaan ini
  // (a) berubah menjadi Siap Kirim sementara modal terbuka
  await testPrisma.unit.update({ where: { id: gone.unit.id }, data: { status: "READY_FOR_DELIVERY" } });
  let before = await state();
  const r1 = await drop(w.admin, gone.unit, op); assert.equal(r1.status, 422, JSON.stringify(r1.body)); assert.equal(r1.body.code, "RENCANA_UNIT_FINISHED");
  assert.deepEqual(await state(), before);
  // (b) Admin lain sudah mengaktifkan + menjadwalkan ke Meja 2
  const first = await drop(w.admin2, taken.unit, op, { stationCode: "TABLE_2" });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  before = await state();
  const planBefore = await testPrisma.productionRunPlan.findFirstOrThrow({ where: { run: { unitId: taken.unit.id } } });
  const stale = await drop(w.admin, taken.unit, op, { stationCode: "TABLE_3" });
  assert.equal(stale.status, 409, JSON.stringify(stale.body)); assert.equal(stale.body.code, "RENCANA_ACTIVATION_STALE");
  assert.deepEqual(await state(), before);
  const planAfter = await testPrisma.productionRunPlan.findFirstOrThrow({ where: { run: { unitId: taken.unit.id } } });
  assert.equal(planAfter.stationCode, "TABLE_2"); assert.equal(planAfter.revision, planBefore.revision);
});

test("DUA ADMIN BERSAMAAN: unit yang sama (kunci berbeda) -> tepat satu sukses, satu 409; satu Run, satu rencana, satu jejak aktivasi, unit tercantum SEKALI di cohort", async () => {
  const lain = await mkReal(); const unit = await mkReal(); const op = await mkOperator();
  await setCohort(lain.unit.id);
  const [r1, r2] = await Promise.all([drop(w.admin, unit.unit, op, { stationCode: "TABLE_1" }), drop(w.admin2, unit.unit, op, { stationCode: "TABLE_2" })]);
  assert.deepEqual([r1.status, r2.status].sort(), [201, 409], JSON.stringify([r1.body, r2.body]));
  assert.equal([r1, r2].find((r) => r.status === 409).body.code, "RENCANA_ACTIVATION_STALE");
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: unit.unit.id } }), 1);
  assert.equal(await testPrisma.productionRunPlan.count({ where: { run: { unitId: unit.unit.id } } }), 1);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: unit.unit.id, eventType: ACT } }), 1);
  assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_WRITER), [lain.unit.id, unit.unit.id].sort()); assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_READER), await cohortOf(V2_FLAGS.PRODUCTION_WRITER));
});

test("DUA ADMIN BERSAMAAN pada unit BERBEDA: keduanya sukses, cohort memuat keduanya (tidak ada tulis-hilang pada daftar cohort)", async () => {
  const lain = await mkReal(); const a = await mkReal(); const b = await mkReal(); const op = await mkOperator();
  await setCohort(lain.unit.id);
  const [r1, r2] = await Promise.all([drop(w.admin, a.unit, op, { stationCode: "TABLE_1" }), drop(w.admin2, b.unit, op, { stationCode: "TABLE_2" })]);
  assert.equal(r1.status, 201, JSON.stringify(r1.body)); assert.equal(r2.status, 201, JSON.stringify(r2.body));
  const want = [lain.unit.id, a.unit.id, b.unit.id].sort();
  assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_READER), want); assert.deepEqual(await cohortOf(V2_FLAGS.PRODUCTION_WRITER), want);
});

test("kapasitas Meja penuh: 409 PLAN_STATION_FULL, aktivasi ikut batal (cohort, Run, rencana, command, jejak, PIC, histori utuh)", async () => {
  const fillers = []; for (let i = 0; i < 3; i += 1) fillers.push(await mkReal());
  const target = await mkReal(); const op = await mkOperator();
  await setCohort(...fillers.map((f) => f.unit.id));
  for (const f of fillers) assert.equal((await w.lead.api.post(`${V2}/plans`, { unitId: f.unit.id, ...body(op) }, idem("fill"))).status, 201);
  const before = await state();
  const r = await drop(w.admin, target.unit, op, { stationCode: "TABLE_1" });
  assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, "PLAN_STATION_FULL");
  assert.deepEqual(await state(), before);
  assert.ok(!(await cohortOf(V2_FLAGS.PRODUCTION_WRITER)).includes(target.unit.id));
  // Meja lain tetap berhasil dan mengaktifkan
  const ok = await drop(w.admin, target.unit, op, { stationCode: "TABLE_2" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.ok((await cohortOf(V2_FLAGS.PRODUCTION_WRITER)).includes(target.unit.id));
});

test("flag MATI: aktivasi tidak menyalakan flag — 503 RENCANA_ACTIVATION_FLAGS_OFF; kartu tidak ditawarkan; keadaan utuh", async () => {
  const unit = await mkReal(); const op = await mkOperator();
  await setCohort(); // kedua flag OFF
  assert.equal(itemOf(await backlogFor(w.admin), unit.unit).rencana.activatable, false);
  const before = await state();
  const r = await drop(w.admin, unit.unit, op);
  assert.equal(r.status, 503, JSON.stringify(r.body)); assert.equal(r.body.code, "RENCANA_ACTIVATION_FLAGS_OFF");
  assert.deepEqual(await state(), before); assert.equal(await cohortOf(V2_FLAGS.PRODUCTION_WRITER), null);
});

test("PIC: kosong tanpa PIC bawaan Meja = 422 PLAN_OPERATOR_REQUIRED (utuh); PIC tidak valid = 422 (utuh); dengan PIC bawaan Meja server memakainya tanpa operatorId", async () => {
  const lain = await mkReal(); const a = await mkReal(); const op = await mkOperator();
  await setCohort(lain.unit.id);
  let before = await state();
  const kosong = await w.admin.api.post(`${V2}/plans`, { unitId: a.unit.id, productionDate: DATE, stationCode: "TABLE_2", workCenterId: w.wc.id, activateUnit: true }, idem("pic-kosong"));
  assert.equal(kosong.status, 422, JSON.stringify(kosong.body)); assert.equal(kosong.body.code, "PLAN_OPERATOR_REQUIRED");
  assert.deepEqual(await state(), before);
  const nonaktif = await mkOperator(); await testPrisma.productionOperator.update({ where: { id: nonaktif.op.id }, data: { active: false } });
  before = await state();
  const buruk = await drop(w.admin, a.unit, nonaktif, { stationCode: "TABLE_2" });
  assert.equal(buruk.status, 422, JSON.stringify(buruk.body)); assert.equal(buruk.body.code, "PLAN_OPERATOR_INVALID");
  assert.deepEqual(await state(), before);
  // PIC bawaan Meja 2 untuk tanggal papan -> tanpa operatorId berhasil dan memakai PIC itu
  const set = await w.lead.api.put(`${V2}/stations/TABLE_2/pic`, { productionDate: DATE, operatorId: op.op.id }, idem("pic-set"));
  assert.ok(set.status < 300, JSON.stringify(set.body));
  const ok = await w.admin.api.post(`${V2}/plans`, { unitId: a.unit.id, productionDate: DATE, stationCode: "TABLE_2", workCenterId: w.wc.id, activateUnit: true }, idem("pic-bawaan"));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const plan = await testPrisma.productionRunPlan.findFirstOrThrow({ where: { run: { unitId: a.unit.id } } });
  assert.equal(plan.operatorId, op.op.id); assert.ok((await cohortOf(V2_FLAGS.PRODUCTION_WRITER)).includes(a.unit.id));
});

test("target: tanpa targetDate = tanggal papan; target khusus tersimpan; target lebih awal dari tanggal produksi ditolak dan membatalkan aktivasi (utuh)", async () => {
  const lain = await mkReal(); const a = await mkReal(); const b = await mkReal(); const op = await mkOperator();
  await setCohort(lain.unit.id);
  const before = await state();
  const buruk = await drop(w.admin, a.unit, op, { targetDate: "2026-10-01" });
  assert.ok(buruk.status >= 400 && buruk.status < 500, `harus ditolak: ${buruk.status} ${JSON.stringify(buruk.body)}`);
  assert.deepEqual(await state(), before);
  const ok = await drop(w.admin, b.unit, op, { targetDate: "2026-10-15", stationCode: "TABLE_3" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const plan = await testPrisma.productionRunPlan.findFirstOrThrow({ where: { run: { unitId: b.unit.id } } });
  assert.equal(plan.targetDate?.toISOString().slice(0, 10), "2026-10-15");
});

test("konflik revisi setelah aktivasi: penjadwalan ulang dengan expectedRevision basi = 409 PLAN_REVISION_CONFLICT dan keadaan tidak berubah", async () => {
  const lain = await mkReal(); const a = await mkReal(); const op = await mkOperator();
  await setCohort(lain.unit.id);
  const first = await drop(w.admin, a.unit, op);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const plan = await testPrisma.productionRunPlan.findFirstOrThrow({ where: { run: { unitId: a.unit.id } } });
  const before = await state();
  const r = await w.admin.api.post(`${V2}/plans/${plan.id}/schedule`, { expectedRevision: plan.revision + 7, productionDate: DATE, stationCode: "TABLE_2", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id }, idem("rev"));
  assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, "PLAN_REVISION_CONFLICT");
  assert.deepEqual(await state(), before);
});
