// AUDIT command POST /production-v2/plans { unitId } (Rencana order nyata) dan konfirmasi tiba tanpa pickup — HTTP + DB sungguhan:
// izin, writer cohort (reader/writer/OFF), kunci unit + replay (serial, bersamaan), kapasitas di bawah beban paralel, kepemilikan V2 (V1 diblok TEPAT setelah Run lahir),
// tidak ada Run/plan/handoff ganda, dan catatan kedatangan petugas yang JUJUR (bukan bukti pickup/custody).
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

const V2 = "/api/production-v2"; const DATE = "2026-10-14";
let server; let seq = 0; let w;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.beforeEach(async () => { await truncateAll(); w = await world(); });

const idem = (tag) => ({ "Idempotency-Key": `audit-${tag}-${++seq}-00000` });
async function setFlag(key, unitIds) { const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "audit rencana" }; await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, ...data }, update: data }); }
const setCohort = async (...ids) => { for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(k, ids.length ? ids : null); };
async function world() {
  const mk = async (roles) => { const u = await createTestUser({ roles }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
  const [lead, admin, worker, sales, gudang, qc, finance, driver] = await Promise.all([["PRODUCTION_LEAD"], ["ADMIN"], ["PRODUCTION_WORKER"], ["SALES"], ["WAREHOUSE"], ["QC_LEAD"], ["FINANCE"], ["DRIVER"]].map(mk));
  const wc = await testPrisma.workCenter.create({ data: { code: `WC-AU-${++seq}`, name: "Workshop Audit" } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-AU-${++seq}`, name: "Gudang Audit" } });
  const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-AU-${++seq}` } });
  const picUser = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  const pic = await testPrisma.productionOperator.create({ data: { userId: picUser.user.id, primaryWorkCenterId: wc.id } });
  return { lead, admin, worker, sales, gudang, qc, finance, driver, wc, rcv, pic, picUser };
}
async function mkUnit({ category = "LAYANAN", pickup = true, status = "RECEIVED" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan Audit ${++seq}` } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ORD-AU-${seq}`, value: 1_000_000, category, status: "PROCESSING" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `AU-${seq}`, orderId: order.id, seq: 1, status } });
  let job = null;
  if (pickup) { job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", completedAt: new Date(), proofPhotoUrls: [`/media/job-photos/audit-${seq}.jpg`] } }); await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } }); }
  return { unit, job, order };
}
const body = (over = {}) => ({ productionDate: DATE, stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: w.pic.id, ...over });
const post = (who, unit, over = {}, headers = idem("p")) => who.api.post(`${V2}/plans`, { unitId: unit.id, ...body(over) }, headers);
const rows = async (unit) => ({
  runs: await testPrisma.productionRun.count({ where: { unitId: unit.id } }), plans: await testPrisma.productionRunPlan.count({ where: { run: { unitId: unit.id } } }),
  handoffs: await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id } }), commands: await testPrisma.v2Command.count({ where: { aggregateId: unit.id, commandType: "RENCANA_PLAN_SCHEDULE_UNIT" } }),
});
const NONE = { runs: 0, plans: 0, handoffs: 0, commands: 0 };

test("IZIN: hanya pemegang production_assignment:write (Lead/Admin); peran lain 403 dan tanpa login 401 — tidak ada baris yang lahir", async () => {
  const { unit } = await mkUnit(); await setCohort(unit.id);
  for (const who of [w.worker, w.sales, w.gudang, w.qc, w.finance, w.driver]) assert.equal((await post(who, unit)).status, 403, "peran tanpa izin menjadwalkan");
  assert.equal((await makeClient(server.baseUrl, null).post(`${V2}/plans`, { unitId: unit.id, ...body() }, idem("anon"))).status, 401);
  assert.deepEqual(await rows(unit), NONE);
  assert.equal((await post(w.admin, unit)).status, 201, "Admin berizin (semua lini)");
});

test("WRITER COHORT: reader saja / writer saja / flag MATI / unit di luar cohort ditolak berkode SEBELUM menyentuh data; hanya reader+writer yang lolos", async () => {
  const { unit } = await mkUnit(); const other = await mkUnit();
  const cases = [
    ["flag mati (keduanya)", async () => { await setFlag(V2_FLAGS.PRODUCTION_WRITER, null); await setFlag(V2_FLAGS.PRODUCTION_READER, null); }, 503, "RENCANA_UNIT_NOT_ACTIVATED"],
    ["reader saja", async () => { await setFlag(V2_FLAGS.PRODUCTION_WRITER, null); await setFlag(V2_FLAGS.PRODUCTION_READER, [unit.id]); }, 422, "RENCANA_PARTIAL_ACTIVATION"],
    ["writer saja", async () => { await setFlag(V2_FLAGS.PRODUCTION_WRITER, [unit.id]); await setFlag(V2_FLAGS.PRODUCTION_READER, null); }, 422, "RENCANA_PARTIAL_ACTIVATION"],
    ["cohort berisi unit lain", async () => { await setCohort(other.unit.id); }, 503, "RENCANA_UNIT_NOT_ACTIVATED"],
  ];
  for (const [label, arrange, status, code] of cases) {
    await arrange(); const r = await post(w.lead, unit);
    assert.equal(r.status, status, `${label}: ${JSON.stringify(r.body)}`); assert.equal(r.body.code, code, label); assert.deepEqual(await rows(unit), NONE, `${label}: tidak ada baris`);
  }
  await setCohort(unit.id); assert.equal((await post(w.lead, unit)).status, 201);
});

test("REPLAY + KUNCI: kunci SAMA bersamaan -> satu membuat, satu replay (bukan 409 'duplikat'); kunci sama isi beda 409; kunci berbeda sesudahnya memakai Run yang sama", async () => {
  const { unit } = await mkUnit(); await setCohort(unit.id);
  const h = { "Idempotency-Key": "audit-same-key-0001" };
  const [a, b] = await Promise.all([post(w.lead, unit, {}, h), post(w.lead, unit, {}, h)]);
  assert.deepEqual([a.status, b.status], [201, 201], JSON.stringify([a.body, b.body]));
  assert.equal([a.body.replayed, b.body.replayed].filter(Boolean).length, 1, "tepat satu replay"); assert.equal(a.body.runId, b.body.runId); assert.equal(a.body.planId, b.body.planId);
  assert.deepEqual(await rows(unit), { runs: 1, plans: 1, handoffs: 1, commands: 1 });
  assert.equal((await post(w.lead, unit, { stationCode: "TABLE_2" }, h)).status, 409, "kunci sama, isi beda");
  const again = await post(w.lead, unit, { stationCode: "TABLE_2" }); assert.equal(again.status, 201); assert.equal(again.body.runId, a.body.runId); assert.equal(again.body.onboarded, false);
  assert.deepEqual(await rows(unit), { runs: 1, plans: 1, handoffs: 1, commands: 2 });
  // pelaku berbeda dengan kunci yang sama = command berbeda (kunci per aktor), tetap tidak membuat Run ganda
  const viaAdmin = await post(w.admin, unit, { stationCode: "TABLE_3" }, h); assert.equal(viaAdmin.status, 201); assert.equal(viaAdmin.body.runId, a.body.runId);
  assert.equal((await rows(unit)).runs, 1);
});

test("TANPA RUN/PLAN GANDA di bawah beban: 6 permintaan bersamaan (kunci berbeda) untuk satu unit -> tepat 1 Run, 1 plan, 1 handoff; semua yang berhasil menunjuk Run yang sama", async () => {
  const { unit } = await mkUnit(); await setCohort(unit.id);
  const rs = await Promise.all(["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4", "TABLE_1", "TABLE_2"].map((st) => post(w.lead, unit, { stationCode: st })));
  const ok = rs.filter((r) => r.status === 201); assert.ok(ok.length >= 1, JSON.stringify(rs.map((r) => r.status)));
  for (const r of rs.filter((x) => x.status !== 201)) assert.ok([409].includes(r.status), `selain 201 hanya 409 terkontrol: ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(new Set(ok.map((r) => r.body.runId)).size, 1);
  const c = await rows(unit); assert.equal(c.runs, 1); assert.equal(c.plans, 1); assert.equal(c.handoffs, 1);
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: unit.id, status: { notIn: ["COMPLETED", "CANCELLED"] } } }), 1);
});

test("KAPASITAS di bawah beban: 5 unit berbeda bersamaan ke Meja yang sama (kapasitas 3) -> tepat 3 berhasil, 2 ditolak 409 PLAN_STATION_FULL TANPA Run/plan/handoff tersisa", async () => {
  const units = []; for (let i = 0; i < 5; i += 1) units.push((await mkUnit()).unit);
  await setCohort(...units.map((u) => u.id));
  const rs = await Promise.all(units.map((u) => post(w.lead, u)));
  const okIdx = rs.map((r, i) => (r.status === 201 ? i : -1)).filter((i) => i >= 0); const failed = rs.filter((r) => r.status !== 201);
  assert.equal(okIdx.length, 3, JSON.stringify(rs.map((r) => [r.status, r.body?.code])));
  for (const r of failed) { assert.equal(r.status, 409); assert.equal(r.body.code, "PLAN_STATION_FULL"); }
  for (let i = 0; i < units.length; i += 1) assert.deepEqual(await rows(units[i]), okIdx.includes(i) ? { runs: 1, plans: 1, handoffs: 1, commands: 1 } : NONE, `unit ${i}`);
  assert.equal(await testPrisma.productionRunPlan.count({ where: { stationCode: "TABLE_1", status: { not: "CANCELLED" } } }), 3);
});

test("KEPEMILIKAN V2: sebelum Run lahir jalur V1 tetap bekerja; SESUDAH penjadwalan V1 ditolak 409 UNIT_V2_OWNED; penolakan penjadwalan tidak mengambil alih unit", async () => {
  const { unit } = await mkUnit(); const refused = await mkUnit(); await setCohort(unit.id, refused.unit.id);
  const own = async (u) => (await w.lead.api.get(`${V2}/units/${u.id}/overview`)).body?.ownership?.v2ExecutionOwned;
  assert.equal(await own(unit), false, "di cohort tanpa Run: belum dimiliki V2");
  assert.equal((await w.lead.api.patch(`/api/units/${unit.id}/production`, { priority: "HIGH" })).status, 200, "V1 masih bekerja sebelum Run");
  // penjadwalan yang GAGAL (PIC tidak valid) tidak boleh meninggalkan kepemilikan
  assert.equal((await post(w.lead, refused.unit, { operatorId: "00000000-0000-0000-0000-000000000000" })).status, 422);
  assert.equal(await own(refused.unit), false); assert.equal((await w.lead.api.patch(`/api/units/${refused.unit.id}/production`, { priority: "HIGH" })).status, 200);
  assert.equal((await post(w.lead, unit)).status, 201);
  assert.equal(await own(unit), true, "Run lahir -> dimiliki V2");
  const v1 = await w.lead.api.patch(`/api/units/${unit.id}/production`, { priority: "NORMAL" }); assert.equal(v1.status, 409); assert.equal(v1.body.code, "UNIT_V2_OWNED");
});

test("KONFIRMASI TIBA tanpa pickup = catatan PETUGAS yang sebenarnya: pelaku, waktu, lokasi tercatat; TIDAK ada handoff/job/foto pickup karangan; Unit 360 membacanya sebagai konfirmasi petugas", async () => {
  const { unit } = await mkUnit({ pickup: false }); await setCohort(unit.id);
  assert.equal((await post(w.lead, unit)).status, 201);
  const before = { handoffs: await testPrisma.unitCustodyHandoff.count(), jobs: await testPrisma.job.count(), photos: await testPrisma.unitPhoto.count() };
  const ov0 = (await w.lead.api.get(`${V2}/units/${unit.id}/overview`)).body; assert.equal(ov0.pickup.exists, false); assert.equal(ov0.pickup.staffArrival, null, "belum dikonfirmasi: tidak ada klaim tiba");
  const t0 = Date.now();
  const arr = await w.admin.api.post(`${V2}/units/${unit.id}/confirm-arrival`, { locationId: w.rcv.id }, { "Idempotency-Key": "audit-arrival-0000001" });
  assert.equal(arr.status, 200, JSON.stringify(arr.body)); assert.equal(arr.body.custody, false);
  assert.deepEqual({ handoffs: await testPrisma.unitCustodyHandoff.count(), jobs: await testPrisma.job.count(), photos: await testPrisma.unitPhoto.count() }, before, "tidak ada custody/pickup/foto yang dikarang");
  const ev = await testPrisma.activityEvent.findFirstOrThrow({ where: { entityId: unit.id, eventType: "PRODUCTION_ARRIVAL_CONFIRMED_NO_CUSTODY" } });
  assert.equal(ev.actorId, w.admin.user.id, "pelaku = petugas yang menekan konfirmasi (bukan sistem)"); assert.equal(ev.metadata.locationCode, w.rcv.code);
  assert.ok(Math.abs(ev.createdAt.getTime() - t0) < 60_000, "waktu = saat konfirmasi");
  const cmd = await testPrisma.v2Command.findFirstOrThrow({ where: { aggregateId: unit.id, commandType: "CONFIRM_ARRIVAL_NO_CUSTODY" } }); assert.equal(cmd.actorId, w.admin.user.id);
  const ov = (await w.lead.api.get(`${V2}/units/${unit.id}/overview`)).body;
  assert.equal(ov.pickup.exists, false, "tetap TIDAK ada pickup/custody"); assert.equal(ov.pickup.staffArrival.confirmedByName, w.admin.user.name); assert.equal(ov.pickup.staffArrival.locationCode, w.rcv.code); assert.ok(ov.pickup.staffArrival.confirmedAt);
  assert.equal(ov.photoUrl ?? null, null, "tidak ada foto pickup palsu");
  // pelaku lain tanpa izin tahap tidak bisa mengonfirmasi; konfirmasi kedua (kunci baru) tidak membuat catatan ganda
  assert.equal((await w.sales.api.post(`${V2}/units/${unit.id}/confirm-arrival`, { locationId: w.rcv.id }, idem("sales-arr"))).status, 403);
  const second = await w.admin.api.post(`${V2}/units/${unit.id}/confirm-arrival`, { locationId: w.rcv.id }, idem("arr2")); assert.equal(second.status, 404, "Run sudah ACTIVE: tidak ada yang menunggu konfirmasi");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: unit.id, eventType: "PRODUCTION_ARRIVAL_CONFIRMED_NO_CUSTODY" } }), 1);
});

test("WORKSHOP_BORN tetap memakai jalurnya sendiri: BARU tanpa pickup -> Run WORKSHOP_BORN lewat registerWorkshopBornRun (command REGISTER_WORKSHOP_RUN), tanpa konfirmasi tiba dan tanpa catatan 'tiba tanpa custody'", async () => {
  const { unit } = await mkUnit({ category: "BARU", pickup: false }); await setCohort(unit.id);
  const r = await post(w.lead, unit); assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.origin, "WORKSHOP_BORN");
  assert.equal(await testPrisma.v2Command.count({ where: { aggregateId: unit.id, commandType: "REGISTER_WORKSHOP_RUN" } }), 1, "command resmi P5 yang menulis Run");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: unit.id, eventType: "PRODUCTION_WORKSHOP_RUN_REGISTERED" } }), 1);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: unit.id, eventType: "PRODUCTION_ARRIVAL_CONFIRMED_NO_CUSTODY" } }), 0);
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id } }), 0);
  const arr = await w.admin.api.post(`${V2}/units/${unit.id}/confirm-arrival`, { locationId: w.rcv.id }, idem("born-arr")); assert.equal(arr.status, 404, "unit lahir di workshop tidak punya 'kedatangan' untuk dikonfirmasi");
});
