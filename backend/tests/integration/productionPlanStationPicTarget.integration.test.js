// Rencana Produksi: PIC bawaan per meja per tanggal, target pengecualian per kartu, status Lewat Target + alasan jadwal ulang wajib, riwayat append-only.
// Lewat command resmi (scheduleProductionPlan / setStationDayPic) dan endpoint HTTP; tidak ada penulisan langsung ke tabel rencana kecuali fixture awal.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUnit, createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { createProductionPlan, scheduleProductionPlan } from "../../src/services/productionPlanningCommandService.js";
import { getProductionBoard } from "../../src/services/productionExperienceReadService.js";

let server; let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (tag) => `pst-${tag}-${String(++seq).padStart(4, "0")}-abcdef`;
const day = (offset = 0) => new Date(Date.now() + 7 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);

async function setFlag(flagKey, unitIds) {
  const data = { enabled: true, scope: "GLOBAL", config: { unitIds }, reason: "plan station pic test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}

async function world() {
  const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  const worker1 = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  const worker2 = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  const wc = await testPrisma.workCenter.create({ data: { code: `WC-PST-${++seq}`, name: "Workshop PST" } });
  const op1 = await testPrisma.productionOperator.create({ data: { userId: worker1.user.id, primaryWorkCenterId: wc.id } });
  const op2 = await testPrisma.productionOperator.create({ data: { userId: worker2.user.id } });
  return { lead, api: makeClient(server.baseUrl, lead.token), wc, op1, op2, worker1, worker2 };
}

async function planFor(w, { n = 1 } = {}) {
  const plans = [];
  const units = [];
  for (let i = 0; i < n; i += 1) {
    const { unit } = await createTestUnit({ unitCode: `PST-UNIT-${++seq}`, status: "IN_PRODUCTION" });
    const run = await testPrisma.productionRun.create({
      data: {
        unitId: unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "PENDING_ARRIVAL", currentPhase: "INTAKE", revision: 1,
        phases: { create: ["INTAKE", "DIAGNOSIS", "PROCESS", "QC", "HANDOFF"].map((phase, j) => ({ phase, sequence: j + 1, status: j === 0 ? "ACTIVE" : "NOT_STARTED" })) },
      },
    });
    units.push(unit);
    plans.push({ unit, run });
  }
  await setFlag(V2_FLAGS.PRODUCTION_WRITER, units.map((u) => u.id));
  await setFlag(V2_FLAGS.PRODUCTION_READER, units.map((u) => u.id));
  const out = [];
  for (const p of plans) {
    const created = await createProductionPlan(testPrisma, { runId: p.run.id, actorId: w.lead.user.id, idempotencyKey: key("create") });
    out.push({ ...p, planId: created.planId, revision: created.revision });
  }
  return out;
}

const schedule = (w, p, body, tag = "sch") => scheduleProductionPlan(testPrisma, { planId: p.planId, actorId: w.lead.user.id, idempotencyKey: key(tag), expectedRevision: p.revision, ...body });
const planRow = (id) => testPrisma.productionRunPlan.findUniqueOrThrow({ where: { id } });
const events = (planId) => testPrisma.productionPlanScheduleEvent.findMany({ where: { planId }, orderBy: { createdAt: "asc" } });

test("PIC bawaan meja+tanggal dipakai saat penjadwalan tanpa operatorId; workshop dari workshop utama PIC; riwayat SCHEDULED tercatat", async () => {
  const w = await world();
  const [p] = await planFor(w);
  const d = day(1);
  const set = await w.api.put("/api/production-v2/stations/TABLE_2/pic", { productionDate: d, operatorId: w.op1.id }, { "Idempotency-Key": key("pic") });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.operatorName, w.worker1.user.name);

  const r = await schedule(w, p, { productionDate: d, stationCode: "TABLE_2", priority: 0 }); // tanpa operatorId/workCenterId
  assert.equal(r.operatorId, w.op1.id, "PIC bawaan meja dipakai");
  assert.equal(r.workCenterId, w.wc.id, "workshop dari workshop utama PIC");
  const ev = await events(p.planId);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "SCHEDULED");
  assert.equal(ev[0].toStation, "TABLE_2");

  // PIC eksplisit tetap menang atas PIC bawaan
  const [q] = await planFor(w);
  const r2 = await schedule(w, q, { productionDate: d, stationCode: "TABLE_2", priority: 0, operatorId: w.op2.id, workCenterId: w.wc.id }, "explicit");
  assert.equal(r2.operatorId, w.op2.id, "PIC yang dipilih per order menggantikan bawaan");
});

test("tanpa PIC bawaan dan tanpa operatorId: ditolak dengan pesan yang menjelaskan; tidak ada operator dibuat otomatis", async () => {
  const w = await world();
  const [p] = await planFor(w);
  const opsBefore = await testPrisma.productionOperator.count();
  await assert.rejects(() => schedule(w, p, { productionDate: day(1), stationCode: "TABLE_1", priority: 0 }), (e) => {
    assert.equal(e.code, "PLAN_OPERATOR_REQUIRED");
    assert.match(e.message, /PIC .*belum dipilih/);
    return true;
  });
  assert.equal(await testPrisma.productionOperator.count(), opsBefore, "tidak ada operator dibuat");
  assert.equal((await planRow(p.planId)).productionDate, null, "tidak ada yang tertulis");
});

test("PIC bawaan: hanya operator aktif; nonaktif ditolak; dapat dihapus; terbaca di papan dengan penanda bila PIC kemudian nonaktif", async () => {
  const w = await world();
  const d = day(2);
  const bad = await w.api.put("/api/production-v2/stations/TABLE_1/pic", { productionDate: d, operatorId: "00000000-0000-4000-8000-000000000000" }, { "Idempotency-Key": key("pic") });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.code, "PLAN_OPERATOR_INVALID");
  const badStation = await w.api.put("/api/production-v2/stations/TABLE_9/pic", { productionDate: d, operatorId: w.op1.id }, { "Idempotency-Key": key("pic") });
  assert.equal(badStation.status, 400);

  await w.api.put("/api/production-v2/stations/TABLE_1/pic", { productionDate: d, operatorId: w.op1.id }, { "Idempotency-Key": key("pic") });
  let board = await getProductionBoard(testPrisma, { date: d, unitIds: [] });
  let st = board.stations.find((s) => s.code === "TABLE_1");
  assert.equal(st.defaultPic.operatorId, w.op1.id);
  assert.equal(st.defaultPic.active, true);

  await testPrisma.productionOperator.update({ where: { id: w.op1.id }, data: { active: false } });
  board = await getProductionBoard(testPrisma, { date: d, unitIds: [] });
  st = board.stations.find((s) => s.code === "TABLE_1");
  assert.equal(st.defaultPic.active, false, "PIC nonaktif ditandai, tidak dipakai diam-diam");

  const cleared = await w.api.put("/api/production-v2/stations/TABLE_1/pic", { productionDate: d, operatorId: null }, { "Idempotency-Key": key("pic") });
  assert.equal(cleared.status, 200);
  board = await getProductionBoard(testPrisma, { date: d, unitIds: [] });
  assert.equal(board.stations.find((s) => s.code === "TABLE_1").defaultPic, null);
});

test("tanggal papan = target bawaan; target per kartu = pengecualian; target tidak boleh lebih awal dari tanggal papan; order lain tidak berubah", async () => {
  const w = await world();
  const [a, b] = await planFor(w, { n: 2 });
  const d = day(1);
  const ra = await schedule(w, a, { productionDate: d, stationCode: "TABLE_1", priority: 0, operatorId: w.op1.id, workCenterId: w.wc.id });
  assert.equal(ra.targetDate, null, "tanpa pengecualian: target mengikuti tanggal papan");
  const rb = await schedule(w, b, { productionDate: d, stationCode: "TABLE_1", priority: 0, operatorId: w.op1.id, workCenterId: w.wc.id });
  assert.equal(rb.targetDate, null);

  const exc = await scheduleProductionPlan(testPrisma, { planId: a.planId, actorId: w.lead.user.id, idempotencyKey: key("exc"), expectedRevision: ra.revision,
    productionDate: d, stationCode: "TABLE_1", priority: 0, operatorId: w.op1.id, workCenterId: w.wc.id, targetDate: day(3) });
  assert.equal(exc.targetDate, day(3));
  assert.equal((await planRow(b.planId)).targetDate, null, "target order lain tidak berubah");

  await assert.rejects(() => scheduleProductionPlan(testPrisma, { planId: a.planId, actorId: w.lead.user.id, idempotencyKey: key("early"), expectedRevision: exc.revision,
    productionDate: d, stationCode: "TABLE_1", priority: 0, operatorId: w.op1.id, workCenterId: w.wc.id, targetDate: day(0) }), (e) => e.code === "PLAN_TARGET_BEFORE_DATE");

  const ev = await events(a.planId);
  assert.deepEqual(ev.map((e) => e.kind), ["SCHEDULED", "TARGET_CHANGED"]);
  assert.equal(ev[1].toTargetDate.toISOString().slice(0, 10), day(3));
  assert.equal(ev[1].fromTargetDate, null);
});

test("Lewat Target: jadwal ulang tanggal wajib alasan terstruktur + catatan; riwayat menyimpan target lama, aktor, waktu; pindah meja di tanggal sama tidak butuh alasan", async () => {
  const w = await world();
  const [p] = await planFor(w);
  const lampau = day(-2);
  // fixture: rencana yang sudah terjadwal pada tanggal lampau (target sudah lewat) — ditulis langsung karena command menolak tanggal lampau tidak ada; ini keadaan nyata hari berganti
  const r0 = await schedule(w, p, { productionDate: day(0), stationCode: "TABLE_1", priority: 0, operatorId: w.op1.id, workCenterId: w.wc.id });
  await testPrisma.productionRunPlan.update({ where: { id: p.planId }, data: { productionDate: new Date(`${lampau}T00:00:00.000Z`) } });
  const fresh = await planRow(p.planId);

  await assert.rejects(() => scheduleProductionPlan(testPrisma, { planId: p.planId, actorId: w.lead.user.id, idempotencyKey: key("tnr"), expectedRevision: fresh.revision,
    productionDate: day(1), stationCode: "TABLE_1", priority: 0, operatorId: w.op1.id, workCenterId: w.wc.id }), (e) => {
    assert.equal(e.code, "PLAN_RESCHEDULE_REASON_REQUIRED");
    assert.match(e.message, /sudah lewat/);
    return true;
  });
  await assert.rejects(() => scheduleProductionPlan(testPrisma, { planId: p.planId, actorId: w.lead.user.id, idempotencyKey: key("badcode"), expectedRevision: fresh.revision,
    productionDate: day(1), stationCode: "TABLE_1", priority: 0, operatorId: w.op1.id, workCenterId: w.wc.id, rescheduleReason: "NGARANG", rescheduleNote: "catatan cukup panjang" }), (e) => e.code === "PLAN_RESCHEDULE_REASON_INVALID");
  await assert.rejects(() => scheduleProductionPlan(testPrisma, { planId: p.planId, actorId: w.lead.user.id, idempotencyKey: key("shortnote"), expectedRevision: fresh.revision,
    productionDate: day(1), stationCode: "TABLE_1", priority: 0, operatorId: w.op1.id, workCenterId: w.wc.id, rescheduleReason: "WAITING_MATERIAL", rescheduleNote: "abc" }), (e) => e.code === "PLAN_RESCHEDULE_REASON_REQUIRED");
  assert.equal((await planRow(p.planId)).productionDate.toISOString().slice(0, 10), lampau, "penolakan tidak mengubah jadwal");
  assert.equal((await events(p.planId)).length, 1, "tidak ada riwayat dari percobaan yang ditolak");

  const ok = await scheduleProductionPlan(testPrisma, { planId: p.planId, actorId: w.lead.user.id, idempotencyKey: key("tnr-ok"), expectedRevision: fresh.revision,
    productionDate: day(1), stationCode: "TABLE_1", priority: 0, operatorId: w.op1.id, workCenterId: w.wc.id, rescheduleReason: "WAITING_MATERIAL", rescheduleNote: "Menunggu kain dari supplier" });
  assert.equal(ok.productionDate, day(1));
  const ev = await events(p.planId);
  const last = ev[ev.length - 1];
  assert.equal(last.kind, "RESCHEDULED");
  assert.equal(last.missedTarget, true);
  assert.equal(last.reasonCode, "WAITING_MATERIAL");
  assert.equal(last.note, "Menunggu kain dari supplier");
  assert.equal(last.fromDate.toISOString().slice(0, 10), lampau);
  assert.equal(last.actorId, w.lead.user.id);
  assert.ok(last.createdAt);

  // riwayat lewat endpoint, terbaru dulu, dengan nama aktor
  const hist = await w.api.get(`/api/production-v2/plans/${p.planId}/schedule-history`);
  assert.equal(hist.status, 200, JSON.stringify(hist.body));
  assert.equal(hist.body.events[0].kind, "RESCHEDULED");
  assert.equal(hist.body.events[0].reasonLabel, "Menunggu bahan");
  assert.ok(hist.body.events[0].actorName);

  // riwayat append-only: UPDATE/DELETE ditolak trigger DB
  await assert.rejects(() => testPrisma.productionPlanScheduleEvent.update({ where: { id: last.id }, data: { note: "diubah" } }));
  await assert.rejects(() => testPrisma.productionPlanScheduleEvent.delete({ where: { id: last.id } }));

  // pindah meja pada tanggal yang sama: tidak butuh alasan, tidak ditandai lewat target
  const cur = await planRow(p.planId);
  const moved = await scheduleProductionPlan(testPrisma, { planId: p.planId, actorId: w.lead.user.id, idempotencyKey: key("move"), expectedRevision: cur.revision,
    productionDate: day(1), stationCode: "TABLE_3", priority: 0, operatorId: w.op1.id, workCenterId: w.wc.id });
  assert.equal(moved.stationCode, "TABLE_3");
  const ev2 = await events(p.planId);
  assert.equal(ev2[ev2.length - 1].missedTarget, false);
});

test("papan menandai Lewat Target dari server (targetMissed) dan tidak untuk rencana yang tanggalnya hari ini/depan", async () => {
  const w = await world();
  const [late, ok] = await planFor(w, { n: 2 });
  const r1 = await schedule(w, late, { productionDate: day(0), stationCode: "TABLE_1", priority: 0, operatorId: w.op1.id, workCenterId: w.wc.id });
  await schedule(w, ok, { productionDate: day(0), stationCode: "TABLE_2", priority: 0, operatorId: w.op1.id, workCenterId: w.wc.id });
  const lampau = day(-1);
  await testPrisma.productionRunPlan.update({ where: { id: late.planId }, data: { productionDate: new Date(`${lampau}T00:00:00.000Z`) } });
  void r1;
  const board = await getProductionBoard(testPrisma, { date: lampau, unitIds: [late.unit.id, ok.unit.id] });
  const v = board.stations.flatMap((s) => s.items).find((x) => x.unit.id === late.unit.id);
  assert.equal(v.plan.targetMissed, true);
  assert.equal(v.plan.targetEffective, lampau);
  const board2 = await getProductionBoard(testPrisma, { date: day(0), unitIds: [late.unit.id, ok.unit.id] });
  const v2 = board2.stations.flatMap((s) => s.items).find((x) => x.unit.id === ok.unit.id);
  assert.equal(v2.plan.targetMissed, false);
});

test("replay Idempotency-Key yang sama dengan payload sama tidak menggandakan riwayat; payload berbeda = konflik", async () => {
  const w = await world();
  const [p] = await planFor(w);
  const k = key("replay");
  const body = { productionDate: day(1), stationCode: "TABLE_1", priority: 0, operatorId: w.op1.id, workCenterId: w.wc.id };
  const a = await scheduleProductionPlan(testPrisma, { planId: p.planId, actorId: w.lead.user.id, idempotencyKey: k, expectedRevision: p.revision, ...body });
  const b = await scheduleProductionPlan(testPrisma, { planId: p.planId, actorId: w.lead.user.id, idempotencyKey: k, expectedRevision: p.revision, ...body });
  assert.equal(b.replayed, true);
  assert.equal(a.revision, b.revision);
  assert.equal((await events(p.planId)).length, 1);
  await assert.rejects(() => scheduleProductionPlan(testPrisma, { planId: p.planId, actorId: w.lead.user.id, idempotencyKey: k, expectedRevision: p.revision, ...body, stationCode: "TABLE_2" }), (e) => /Idempotency|payload/i.test(e.message));
});
