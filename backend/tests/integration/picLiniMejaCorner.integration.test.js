// Pemisahan PIC Meja Bongkar vs PIC Corner & Finishing — HTTP + DB sungguhan (Postgres uji terisolasi).
// Keputusan Owner: dua penugasan TERPISAH; operator hanya boleh jadi PIC suatu lini bila Admin menetapkannya eksplisit (work_lanes, bermula kosong);
// PIC Corner kosong TIDAK otomatis memakai PIC Meja; ADMIN/OWNER tidak masuk dropdown; PIC Bahan tidak terpengaruh.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

let server; let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (v) => ({ "Idempotency-Key": `lane-${v}-${++seq}-0001` });
const V2 = "/api/production-v2"; const P = "/api/production-planning"; const PR = "/api/production";
const DATE = "2026-10-20";
const ok = (res) => { assert.equal(res.status, 200, JSON.stringify(res.body)); return res.body; };

async function setFlag(k, unitIds) {
  const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "lane test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: k }, create: { key: k, ...data }, update: data });
}
async function addCohort(...unitIds) {
  const row = await testPrisma.v2FeatureFlag.findUnique({ where: { key: V2_FLAGS.PRODUCTION_WRITER } });
  const merged = [...new Set([...(row?.enabled ? row.config?.unitIds ?? [] : []), ...unitIds])];
  for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(k, merged);
}
// Operator: Meja (TABLE), Corner (CORNER, dua orang), tanpa lini (Ferdy/Febri — helper/dokumentasi/bahan), Admin (profil operator berlini lengkap tapi TIDAK boleh ditawarkan), nonaktif.
async function world({ lanes = true } = {}) {
  const [lead, admin, mejaU, cornerU, corner2U, helperU, qc, sales, adminProfileU] = await Promise.all([
    createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["ADMIN"] }),
    createTestUser({ roles: ["WAREHOUSE", "PRODUCTION_WORKER"] }), createTestUser({ roles: ["PRODUCTION_WORKER"] }), createTestUser({ roles: ["PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["PRODUCTION_WORKER"] }), createTestUser({ roles: ["QC_LEAD"] }), createTestUser({ roles: ["SALES"] }), createTestUser({ roles: ["ADMIN"] }),
  ]);
  const wc = await testPrisma.workCenter.create({ data: { code: `WC-LN-${++seq}`, name: "Workshop Utama" } });
  const op = (u, workLanes = [], active = true) => testPrisma.productionOperator.create({ data: { userId: u.user.id, primaryWorkCenterId: wc.id, active, workLanes: lanes ? workLanes : [] } });
  const [mejaOp, cornerOp, corner2Op, helperOp, adminProfileOp] = await Promise.all([op(mejaU, ["TABLE"]), op(cornerU, ["CORNER"]), op(corner2U, ["CORNER"]), op(helperU, []), op(adminProfileU, ["TABLE", "CORNER"])]);
  const inactiveU = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); const inactiveCornerOp = await op(inactiveU, ["CORNER"], false);
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  return { lead: c(lead), admin: c(admin), meja: c(mejaU), corner: c(cornerU), corner2: c(corner2U), helper: c(helperU), qc: c(qc), sales: c(sales), wc: wc.id, mejaOp, cornerOp, corner2Op, helperOp, adminProfileOp, inactiveCornerOp };
}
async function mkOrder({ services = ["Divan Custom 160x200 + Sandaran"], notes = "Ukuran khusus 160x200, motif polos warna abu" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Bu Lini ${++seq}` } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `NEW-${++seq}-LN`, value: 5_000_000, category: "BARU", status: "PROCESSING", productLine: "DIVAN", productType: "DIVAN_UTAMA", beratBadan: 80, notes, items: { create: services.map((layananName) => ({ layananName, harga: 5_000_000 })) } } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `LN-${++seq}-U1`, orderId: order.id, seq: 1, status: "RECEIVED", merk: "Custom", ukuran: "160x200" } });
  return { order, unit };
}
const card = async (w, runId) => ok(await w.lead.api.get(`${V2}/runs/${runId}/card`));
let fileSeq = 0;
async function media(who, runId, ...kinds) {
  const fd = new FormData(); fd.append("runId", runId);
  for (const k of kinds) fd.append("files", new Blob([Buffer.from(`img-${++fileSeq}-${Math.random()}`)], { type: "image/jpeg" }), "a.jpg");
  const res = await fetch(`${server.baseUrl}${V2}/evidence/upload`, { method: "POST", headers: { Authorization: `Bearer ${who.token}` }, body: fd });
  const body = await res.json(); assert.equal(res.status, 201, JSON.stringify(body)); return body.items.map((i) => i.url);
}
async function step(w, who, runId, n, { payload = {}, media: m = [] } = {}) {
  return who.api.post(`${V2}/runs/${runId}/steps/${n}`, { expectedRevision: (await card(w, runId)).revision, workCenterId: w.wc, payload, media: m }, key(`st-${n}`));
}
const plansBody = (w, unit, body = {}) => ({ unitId: unit.id, productionDate: DATE, stationCode: "TABLE_1", priority: 0, workCenterId: w.wc, ...body });
async function postPlan(w, unit, body) { await addCohort(unit.id); return w.lead.api.post(`${V2}/plans`, plansBody(w, unit, body), key("plan")); }
const planOf = (runId) => testPrisma.productionRunPlan.findFirstOrThrow({ where: { runId } });
const runOf = (unitId) => testPrisma.productionRun.findFirstOrThrow({ where: { unitId } });
const setCornerDecision = async (w, run, required = true) => { const c = await card(w, run.id); return ok(await w.lead.api.post(`${V2}/runs/${run.id}/build/corner`, { expectedRevision: c.revision, required, ...(required ? {} : { reason: "Tidak ada pekerjaan kain/jahit" }) }, key("corner"))); };
const assignCorner = (api, runId, body, k = key("assign")) => api.post(`${V2}/runs/${runId}/corner-operator`, body, k);
const names = (list) => list.map((o) => o.id).sort();

test("work_lanes bermula KOSONG: migration tidak menetapkan siapa pun (tanpa UPDATE/INSERT/nama), kolom default kosong, CHECK menolak nilai asing; operator baru lewat API juga kosong", async () => {
  const sql = fs.readFileSync(path.resolve("prisma/migrations/20261106090000_production_operator_work_lanes/migration.sql"), "utf8");
  const stmts = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/\b(UPDATE|INSERT|DELETE)\b/i.test(stmts), "migration tidak boleh mengisi/mengubah data operator");
  assert.ok(!/\bname\b|user_id|employee_code/i.test(stmts), "migration tidak berbasis nama/akun");
  const col = await testPrisma.$queryRawUnsafe(`SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'production_operators' AND column_name = 'work_lanes'`);
  assert.equal(col.length, 1); assert.equal(col[0].is_nullable, "NO"); assert.match(col[0].column_default, /ARRAY\[\]/);
  const w = await world({ lanes: false });
  const rows = await testPrisma.productionOperator.findMany({ select: { workLanes: true } });
  assert.ok(rows.length >= 5 && rows.every((r) => r.workLanes.length === 0), "semua operator bermula tanpa lini");
  const u = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  const created = await w.admin.api.post(`${PR}/operators`, { userId: u.user.id });
  assert.equal(created.status, 201, JSON.stringify(created.body)); assert.deepEqual(created.body.workLanes, []);
  await assert.rejects(testPrisma.$executeRawUnsafe(`UPDATE production_operators SET work_lanes = ARRAY['MEJA']::text[] WHERE id = '${w.mejaOp.id}'`), /production_operators_work_lanes_valid|check/i);
});

test("Pengaturan Operator: Admin menetapkan lini EKSPLISIT; nilai asing 400; tercatat di riwayat; tanpa perubahan tidak mencatat; tanpa workLanes tidak menyentuh lini; izin ditegakkan", async () => {
  const w = await world({ lanes: false });
  const bad = await w.admin.api.patch(`${PR}/operators/${w.cornerOp.id}`, { workLanes: ["MEJA"] });
  assert.equal(bad.status, 400); assert.equal((await testPrisma.productionOperator.findUniqueOrThrow({ where: { id: w.cornerOp.id } })).workLanes.length, 0);
  assert.equal((await w.admin.api.patch(`${PR}/operators/${w.cornerOp.id}`, { workLanes: "CORNER" })).status, 400);
  const r = await w.admin.api.patch(`${PR}/operators/${w.cornerOp.id}`, { workLanes: ["CORNER", "CORNER"] });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(r.body.workLanes, ["CORNER"]);
  const ev = await testPrisma.activityEvent.findMany({ where: { entityId: `operator-lanes:${w.cornerOp.id}` } });
  assert.equal(ev.length, 1); assert.equal(ev[0].actorId, w.admin.user.id); assert.equal(ev[0].metadata.to, "Corner & Finishing");
  assert.equal((await w.admin.api.patch(`${PR}/operators/${w.cornerOp.id}`, { workLanes: ["CORNER"] })).status, 200);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: `operator-lanes:${w.cornerOp.id}` } }), 1, "tanpa perubahan = tanpa riwayat baru");
  assert.equal((await w.admin.api.patch(`${PR}/operators/${w.cornerOp.id}`, { active: true })).status, 200);
  assert.deepEqual((await testPrisma.productionOperator.findUniqueOrThrow({ where: { id: w.cornerOp.id } })).workLanes, ["CORNER"], "PATCH tanpa workLanes tidak menyentuh lini");
  assert.equal((await w.sales.api.patch(`${PR}/operators/${w.cornerOp.id}`, { workLanes: ["TABLE"] })).status, 403);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: `operator-lanes:${w.cornerOp.id}` } }), 1);
});

test("dropdown per lini: ?lane= dan ?stageId= (diturunkan server) hanya operator AKTIF berlini itu; ADMIN/OWNER, nonaktif, dan operator tanpa lini (helper) tidak ditawarkan; daftar penuh Operator tetap utuh", async () => {
  const w = await world();
  const list = async (qs) => ok(await w.lead.api.get(`${PR}/operators${qs}`));
  assert.deepEqual(names((await list("?pilihan=1&lane=CORNER")).operators), names([w.cornerOp, w.corner2Op]));
  assert.deepEqual(names((await list("?pilihan=1&lane=TABLE")).operators), names([w.mejaOp]));
  assert.equal((await w.lead.api.get(`${PR}/operators?lane=MEJA`)).status, 400);
  const full = await list(""); assert.ok(full.operators.some((o) => o.id === w.adminProfileOp.id) && full.operators.some((o) => o.id === w.helperOp.id) && full.operators.some((o) => o.id === w.inactiveCornerOp.id), "daftar penuh halaman Operator tidak menyembunyikan profil");
  assert.ok(full.operators.every((o) => Array.isArray(o.workLanes)));
  const stages = await testPrisma.routingStage.findMany({ select: { id: true, code: true, requiresQc: true, phase: true, sequence: true } });
  const corner = stages.find((s) => s.code === "corner_sewing"); const fin = stages.find((s) => s.code === "finished"); const teardown = stages.find((s) => s.code === "teardown"); const qcStage = stages.find((s) => s.requiresQc);
  assert.ok(corner && fin && teardown && qcStage, "tahap routing baku tersedia");
  for (const s of [corner, fin]) { const r = await list(`?pilihan=1&stageId=${s.id}`); assert.equal(r.lane, "CORNER"); assert.deepEqual(names(r.operators), names([w.cornerOp, w.corner2Op])); }
  { const r = await list(`?pilihan=1&stageId=${teardown.id}`); assert.equal(r.lane, "TABLE"); assert.deepEqual(names(r.operators), names([w.mejaOp])); }
  { const r = await list(`?pilihan=1&stageId=${qcStage.id}`); assert.equal(r.lane, null, "gerbang QC bukan lini lantai"); assert.ok(!r.operators.some((o) => o.id === w.adminProfileOp.id)); }
  // refs penjadwalan membawa lini; tanpa operator berlini => alasan + tautan (bukan daftar kosong tanpa penjelasan)
  const refs = ok(await w.lead.api.get(`${V2}/planning/refs`));
  assert.ok(refs.operators.every((o) => Array.isArray(o.workLanes)) && !refs.operators.some((o) => o.id === w.adminProfileOp.id));
  assert.equal(refs.problems.some((p) => p.code === "NO_TABLE_PIC" || p.code === "NO_CORNER_PIC"), false);
  await testPrisma.productionOperator.updateMany({ data: { workLanes: [] } });
  const refs2 = ok(await w.lead.api.get(`${V2}/planning/refs`));
  assert.ok(refs2.problems.some((p) => p.code === "NO_TABLE_PIC") && refs2.problems.some((p) => p.code === "NO_CORNER_PIC"));
});

test("penjadwalan: PIC Meja harus berlini Meja Bongkar, PIC Corner harus Corner & Finishing; lintas lini / tanpa lini ditolak 422 TANPA menyentuh rencana; Corner tidak otomatis memakai PIC Meja; PIC Bahan tetap berfungsi", async () => {
  const w = await world();
  const { unit } = await mkOrder();
  // lintas lini: orang Corner sebagai PIC Meja; orang Meja / helper sebagai PIC Corner; helper sebagai PIC Meja
  let r = await postPlan(w, unit, { operatorId: w.cornerOp.id });
  assert.equal(r.status, 422, JSON.stringify(r.body)); assert.equal(r.body.code, "PLAN_OPERATOR_LANE_INVALID");
  r = await postPlan(w, unit, { operatorId: w.helperOp.id });
  assert.equal(r.status, 422); assert.equal(r.body.code, "PLAN_OPERATOR_LANE_INVALID");
  r = await postPlan(w, unit, { operatorId: w.mejaOp.id, cornerOperatorId: w.mejaOp.id });
  assert.equal(r.status, 422); assert.equal(r.body.code, "PLAN_CORNER_OPERATOR_LANE_INVALID");
  r = await postPlan(w, unit, { operatorId: w.mejaOp.id, cornerOperatorId: w.helperOp.id });
  assert.equal(r.status, 422); assert.equal(r.body.code, "PLAN_CORNER_OPERATOR_LANE_INVALID");
  assert.equal(await testPrisma.productionRunPlan.count({ where: { productionDate: { not: null } } }), 0, "penolakan tidak meninggalkan jadwal");
  // sah: PIC Meja saja => PIC Corner KOSONG (tidak disalin dari PIC Meja)
  r = await postPlan(w, unit, { operatorId: w.mejaOp.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const run = await runOf(unit.id); let plan = await planOf(run.id);
  assert.equal(plan.operatorId, w.mejaOp.id); assert.equal(plan.cornerOperatorId, null, "PIC Corner tidak otomatis = PIC Meja");
  // jadwal ulang (revisi) dengan PIC Corner berlini Corner => sah
  const re = await w.lead.api.post(`${V2}/plans/${plan.id}/schedule`, { productionDate: DATE, stationCode: "TABLE_1", priority: 0, workCenterId: w.wc, operatorId: w.mejaOp.id, cornerOperatorId: w.cornerOp.id, expectedRevision: plan.revision }, key("re"));
  assert.equal(re.status, 200, JSON.stringify(re.body)); plan = await planOf(run.id); assert.equal(plan.cornerOperatorId, w.cornerOp.id);
  // jadwal ulang tanpa mengubah PIC tetap lolos walau Admin kemudian mencabut lini (penugasan lama tidak dipatahkan diam-diam)
  await testPrisma.productionOperator.update({ where: { id: w.cornerOp.id }, data: { workLanes: [] } });
  const keep = await w.lead.api.post(`${V2}/plans/${plan.id}/schedule`, { productionDate: DATE, stationCode: "TABLE_1", priority: 1, workCenterId: w.wc, operatorId: w.mejaOp.id, cornerOperatorId: w.cornerOp.id, expectedRevision: plan.revision }, key("keep"));
  assert.equal(keep.status, 200, JSON.stringify(keep.body)); plan = await planOf(run.id); assert.equal(plan.cornerOperatorId, w.cornerOp.id);
  // tetapi MENGGANTI ke operator tanpa lini ditolak
  const swap = await w.lead.api.post(`${V2}/plans/${plan.id}/schedule`, { productionDate: DATE, stationCode: "TABLE_1", priority: 1, workCenterId: w.wc, operatorId: w.mejaOp.id, cornerOperatorId: w.helperOp.id, expectedRevision: plan.revision }, key("swap"));
  assert.equal(swap.status, 422); assert.equal(swap.body.code, "PLAN_CORNER_OPERATOR_LANE_INVALID");
  // PIC Bahan: operator TANPA lini (helper) tetap bisa ditugaskan & PIC Meja/Corner tidak berubah
  const c0 = await card(w, run.id);
  const mat = await w.lead.api.post(`${V2}/runs/${run.id}/build/material-operator`, { operatorId: w.helperOp.id, expectedRevision: c0.revision }, key("bahan"));
  assert.equal(mat.status, 200, JSON.stringify(mat.body)); assert.equal(mat.body.materialOperator.id, w.helperOp.id);
  const after = await planOf(run.id); assert.equal(after.operatorId, w.mejaOp.id); assert.equal(after.cornerOperatorId, w.cornerOp.id);
});

test("PIC bawaan Meja per tanggal: wajib berlini Meja Bongkar; jadwal tanpa PIC mengikuti PIC bawaan TANPA menyalin ke Corner; PIC bawaan basi (tanpa lini) ditolak saat dipakai, bukan dipakai diam-diam", async () => {
  const w = await world();
  const put = (operatorId) => w.lead.api.put(`${V2}/stations/TABLE_1/pic`, { productionDate: DATE, operatorId });
  let r = await put(w.cornerOp.id); assert.equal(r.status, 422, JSON.stringify(r.body)); assert.equal(r.body.code, "PLAN_OPERATOR_LANE_INVALID");
  r = await put(w.helperOp.id); assert.equal(r.status, 422);
  assert.equal(await testPrisma.productionStationDayPic.count(), 0);
  r = await put(w.mejaOp.id); assert.equal(r.status, 200, JSON.stringify(r.body));
  const a = await mkOrder();
  const ra = await postPlan(w, a.unit, {});
  assert.equal(ra.status, 201, JSON.stringify(ra.body));
  const planA = await planOf((await runOf(a.unit.id)).id);
  assert.equal(planA.operatorId, w.mejaOp.id, "mengikuti PIC bawaan Meja"); assert.equal(planA.cornerOperatorId, null, "PIC bawaan Meja tidak menjadi PIC Corner");
  // PIC bawaan lama yang kini tidak berlini (mis. data sebelum pemisahan) => ditolak jelas saat dipakai
  await testPrisma.productionStationDayPic.updateMany({ data: { operatorId: w.cornerOp.id } });
  const b = await mkOrder();
  const rb = await postPlan(w, b.unit, {});
  assert.equal(rb.status, 422, JSON.stringify(rb.body)); assert.equal(rb.body.code, "PLAN_OPERATOR_LANE_INVALID"); assert.equal(rb.body.details?.source, "STATION_PIC");
  // memilih PIC Meja eksplisit tetap bisa
  assert.equal((await postPlan(w, b.unit, { operatorId: w.mejaOp.id })).status, 201);
});

test("ganti PIC Corner: hanya operator berlini Corner & Finishing; ADMIN/OWNER, Meja-saja, tanpa lini ditolak; pergantian antar PIC Corner sah dan menyentuh HANYA cornerOperatorId; PIC sama = tanpa perubahan walau lininya dicabut", async () => {
  const w = await world();
  const { unit } = await mkOrder();
  assert.equal((await postPlan(w, unit, { operatorId: w.mejaOp.id })).status, 201);
  const run = await runOf(unit.id); await setCornerDecision(w, run, true);
  let plan = await planOf(run.id);
  for (const [who, code] of [[w.mejaOp, "CORNER_OPERATOR_LANE_INVALID"], [w.helperOp, "CORNER_OPERATOR_LANE_INVALID"], [w.adminProfileOp, "CORNER_OPERATOR_INVALID"], [w.inactiveCornerOp, "CORNER_OPERATOR_INVALID"]]) {
    const r = await assignCorner(w.lead.api, run.id, { operatorId: who.id, expectedRevision: plan.revision });
    assert.equal(r.status, 422, JSON.stringify(r.body)); assert.equal(r.body.code, code);
  }
  assert.equal((await planOf(run.id)).cornerOperatorId, null); assert.equal((await planOf(run.id)).revision, plan.revision, "penolakan tidak menaikkan revisi");
  const r1 = await assignCorner(w.lead.api, run.id, { operatorId: w.cornerOp.id, expectedRevision: plan.revision });
  assert.equal(r1.status, 200, JSON.stringify(r1.body)); assert.equal(r1.body.changed, true);
  plan = await planOf(run.id); assert.equal(plan.cornerOperatorId, w.cornerOp.id); assert.equal(plan.operatorId, w.mejaOp.id);
  const r2 = await assignCorner(w.lead.api, run.id, { operatorId: w.corner2Op.id, expectedRevision: plan.revision });
  assert.equal(r2.status, 200); assert.equal(r2.body.previousCornerOperator.id, w.cornerOp.id);
  plan = await planOf(run.id); assert.equal(plan.cornerOperatorId, w.corner2Op.id); assert.equal(plan.operatorId, w.mejaOp.id, "PIC Meja tidak ikut berubah");
  await testPrisma.productionOperator.update({ where: { id: w.corner2Op.id }, data: { workLanes: [] } });
  const same = await assignCorner(w.lead.api, run.id, { operatorId: w.corner2Op.id, expectedRevision: plan.revision });
  assert.equal(same.status, 200); assert.equal(same.body.changed, false);
});

test("V1 Tugaskan (Unit 360): tahap Meja hanya ke operator Meja, tahap Corner/Finish hanya ke operator Corner; lintas lini ditolak; gerbang QC tidak dibatasi lini; penugasan lama tidak dipatahkan", async () => {
  const w = await world();
  const service = await testPrisma.serviceCatalog.findFirstOrThrow({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Tugas" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ORD-LN-${++seq}`, value: 1_000_000, category: "LAYANAN" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `LNV1-${++seq}`, orderId: order.id, seq: 1, status: "RECEIVED", merk: "Serta", ukuran: "160x200" } });
  assert.equal((await w.lead.api.patch(`/api/units/${unit.id}/service`, { serviceId: service.id })).status, 200);
  const path = (await w.lead.api.get(`/api/units/${unit.id}/timeline`)).body.path.map((p) => p.stage);
  const tableStage = path.find((s) => s.code === "teardown") || path[0]; const cornerStage = path.find((s) => s.code === "corner_sewing"); const finStage = path.find((s) => s.code === "finished"); const qcStage = path.find((s) => s.requiresQc);
  assert.ok(tableStage && cornerStage && finStage && qcStage);
  const assign = (stage, operatorId) => w.lead.api.post(`/api/units/${unit.id}/stages/${stage.id}/assign`, { operatorId, workCenterId: null });
  for (const [stage, who] of [[tableStage, w.cornerOp], [tableStage, w.helperOp], [cornerStage, w.mejaOp], [cornerStage, w.helperOp], [finStage, w.mejaOp]]) {
    const r = await assign(stage, who.id); assert.ok(r.status >= 400 && r.status < 500, `${stage.code} ke operator salah lini: ${r.status}`); assert.match(r.body.error, /belum diberi lini/);
  }
  assert.equal(await testPrisma.stageAssignment.count({ where: { unitId: unit.id } }), 0, "penolakan tidak menyisakan penugasan");
  assert.equal((await assign(tableStage, w.mejaOp.id)).status, 200);
  assert.equal((await assign(cornerStage, w.cornerOp.id)).status, 200);
  assert.equal((await assign(finStage, w.corner2Op.id)).status, 200);
  assert.equal((await assign(qcStage, w.helperOp.id)).status, 200, "QC bukan lini lantai — tidak dibatasi Meja/Corner");
  // mengosongkan penugasan tetap bisa; cabut lini tidak membatalkan penugasan yang sudah ada (menyimpan ulang operator yang sama lolos)
  await testPrisma.productionOperator.update({ where: { id: w.cornerOp.id }, data: { workLanes: [] } });
  assert.equal((await assign(cornerStage, w.cornerOp.id)).status, 200, "operator sama = bukan penggantian");
  assert.equal((await assign(cornerStage, null)).status, 200);
});

test("antrean + eksekusi Corner: PIC Corner kosong => TIDAK muncul di antrean Corner siapa pun (termasuk PIC Meja) dan mulai ditolak 409 CORNER_OPERATOR_REQUIRED; setelah PIC Corner ditetapkan hanya dia yang melihat & memulai; antrean Meja tidak lagi memuat unit pasca-QC", async () => {
  const w = await world();
  const { unit } = await mkOrder();
  assert.equal((await postPlan(w, unit, { operatorId: w.mejaOp.id })).status, 201);
  const run = await runOf(unit.id); await setCornerDecision(w, run, true);
  // Meja -> QC lulus -> siap Corner
  ok(await step(w, w.meja, run.id, 6, {}));
  ok(await step(w, w.meja, run.id, 6, { payload: { note: "Rangka kayu + dudukan sesuai ukuran", racikan: { fondasi: "Kayu", lapisan: "Busa" } }, media: await media(w.meja, run.id, "i") }));
  const qcRun = ok(await w.qc.api.get(`${P}/qc/runs/${run.id}`));
  ok(await w.qc.api.post(`${P}/qc/runs/${run.id}/inspect`, { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], note: "lurus" }, key("qc")));
  ok(await step(w, w.meja, run.id, 9, { payload: { note: "siap dibungkus" }, media: await media(w.meja, run.id, "i") }));
  const queue = async (who, lane) => ok(await who.api.get(`${V2}/worker/${lane}`)).items.filter((i) => i.unit?.id === unit.id || i.unitId === unit.id || i.runId === run.id);
  const body = { mattressStyle: "PILLOWTOP", fabricSpec: "Kain sofa abu", borderColor: "Abu" };

  // PIC Corner KOSONG
  assert.equal((await queue(w.meja, "corner")).length, 0, "PIC Meja tidak otomatis melihat pekerjaan Corner");
  assert.equal((await queue(w.corner, "corner")).length, 0);
  assert.equal((await queue(w.meja, "table")).length, 0, "pasca-QC bukan pekerjaan antrean Meja");
  const s1 = await step(w, w.meja, run.id, 10, { payload: body }); assert.equal(s1.status, 409, JSON.stringify(s1.body)); assert.equal(s1.body.code, "CORNER_OPERATOR_REQUIRED");
  const s2 = await step(w, w.corner, run.id, 10, { payload: body }); assert.equal(s2.status, 409); assert.equal(s2.body.code, "CORNER_OPERATOR_REQUIRED");
  assert.equal(await testPrisma.productionOperationRun.count({ where: { runId: run.id, stageCode: "corner_sewing" } }), 0, "penolakan tidak memulai tahap");

  // Tetapkan PIC Corner (eksplisit) -> hanya dia
  const plan = await planOf(run.id);
  ok(await assignCorner(w.lead.api, run.id, { operatorId: w.cornerOp.id, expectedRevision: plan.revision }));
  assert.equal((await queue(w.corner, "corner")).length, 1, "PIC Corner melihat pekerjaannya");
  assert.equal((await queue(w.meja, "corner")).length, 0); assert.equal((await queue(w.corner2, "corner")).length, 0);
  const s3 = await step(w, w.meja, run.id, 10, { payload: body }); assert.equal(s3.status, 403); assert.equal(s3.body.code, "WORKSHOP_OPERATOR_MISMATCH");
  const s4 = await step(w, w.corner2, run.id, 10, { payload: body }); assert.equal(s4.status, 403);
  ok(await step(w, w.corner, run.id, 10, { payload: body }));
  const op = await testPrisma.productionOperationRun.findFirstOrThrow({ where: { runId: run.id, stageCode: "corner_sewing" } });
  assert.equal(op.planSnapshot.operatorId, w.cornerOp.id, "tahap Corner dicatat atas PIC Corner");
});

test("override ADMIN tetap bekerja tanpa PIC Corner, dan tahap Corner TIDAK dicatat atas PIC Meja (operator snapshot kosong)", async () => {
  const w = await world();
  const { unit } = await mkOrder();
  assert.equal((await postPlan(w, unit, { operatorId: w.mejaOp.id })).status, 201);
  const run = await runOf(unit.id); await setCornerDecision(w, run, true);
  ok(await step(w, w.meja, run.id, 6, {}));
  ok(await step(w, w.meja, run.id, 6, { payload: { note: "Rangka kayu + dudukan sesuai ukuran", racikan: { fondasi: "Kayu", lapisan: "Busa" } }, media: await media(w.meja, run.id, "i") }));
  const qcRun = ok(await w.qc.api.get(`${P}/qc/runs/${run.id}`));
  ok(await w.qc.api.post(`${P}/qc/runs/${run.id}/inspect`, { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], note: "lurus" }, key("qc")));
  ok(await step(w, w.meja, run.id, 9, { payload: { note: "siap dibungkus" }, media: await media(w.meja, run.id, "i") }));
  ok(await step(w, w.admin, run.id, 10, { payload: { mattressStyle: "PILLOWTOP", fabricSpec: "Kain sofa abu", borderColor: "Abu" } }));
  const op = await testPrisma.productionOperationRun.findFirstOrThrow({ where: { runId: run.id, stageCode: "corner_sewing" } });
  assert.equal(op.planSnapshot.operatorId, null, "bukan PIC Meja");
});
