// Corner di Rencana Produksi — HTTP + DB sungguhan: papan Corner (4 kelompok dari cornerStatusOf, hambatan/aktor/QC/permintaan Sales) dan command "Tetapkan/Ganti PIC Corner"
// (hanya cornerOperatorId; kunci + expectedRevision + Idempotency-Key; konflik 409; pekerjaan Corner yang berjalan tidak dialihkan). Alur nyata Meja -> QC -> Corner.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
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

const key = (v) => ({ "Idempotency-Key": `corner-${v}-${++seq}-0001` });
const V2 = "/api/production-v2"; const P = "/api/production-planning";
const DATE = "2026-10-20";
const ok = (res) => { assert.equal(res.status, 200, JSON.stringify(res.body)); return res.body; };

async function setFlag(k, unitIds) {
  const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "corner test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: k }, create: { key: k, ...data }, update: data });
}
async function addCohort(...unitIds) {
  const row = await testPrisma.v2FeatureFlag.findUnique({ where: { key: V2_FLAGS.PRODUCTION_WRITER } });
  const merged = [...new Set([...(row?.enabled ? row.config?.unitIds ?? [] : []), ...unitIds])];
  for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(k, merged);
}
async function world() {
  const [lead, lead2, nadya, corner, corner2, qc, admin, sales] = await Promise.all([
    createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["WAREHOUSE", "PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["PRODUCTION_WORKER"] }), createTestUser({ roles: ["PRODUCTION_WORKER"] }), createTestUser({ roles: ["QC_LEAD"] }),
    createTestUser({ roles: ["ADMIN"] }), createTestUser({ roles: ["SALES"] }),
  ]);
  const wc = await testPrisma.workCenter.create({ data: { code: `WC-CR-${++seq}`, name: "Workshop Utama" } });
  const op = (u, active = true) => testPrisma.productionOperator.create({ data: { userId: u.user.id, primaryWorkCenterId: wc.id, active } });
  const [nadyaOp, cornerOp, corner2Op, adminOp] = await Promise.all([op(nadya), op(corner), op(corner2), op(admin)]);
  const inactive = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); const inactiveOp = await op(inactive, false);
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  return { lead: c(lead), lead2: c(lead2), nadya: c(nadya), corner: c(corner), corner2: c(corner2), qc: c(qc), admin: c(admin), sales: c(sales), wc: wc.id, nadyaOp, cornerOp, corner2Op, adminOp, inactiveOp };
}
async function mkOrder({ services = ["Divan Custom 160x200 + Sandaran"], notes = "Ukuran khusus 160x200, motif polos warna abu" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Bu Corner ${++seq}` } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `NEW-${++seq}-CR`, value: 5_000_000, category: "BARU", status: "PROCESSING", productLine: "DIVAN", productType: "DIVAN_UTAMA", beratBadan: 80, notes, items: { create: services.map((layananName) => ({ layananName, harga: 5_000_000 })) } } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `CR-${++seq}-U1`, orderId: order.id, seq: 1, status: "RECEIVED", merk: "Custom", ukuran: "160x200" } });
  return { order, unit };
}
const card = async (w, runId) => ok(await w.lead.api.get(`${V2}/runs/${runId}/card`));
let fileSeq = 0;
async function media(who, runId, ...kinds) {
  const fd = new FormData(); fd.append("runId", runId);
  for (const k of kinds) fd.append("files", new Blob([Buffer.from(`img-${++fileSeq}-${Math.random()}`)], { type: k === "v" ? "video/mp4" : "image/jpeg" }), k === "v" ? "a.mp4" : "a.jpg");
  const res = await fetch(`${server.baseUrl}${V2}/evidence/upload`, { method: "POST", headers: { Authorization: `Bearer ${who.token}` }, body: fd });
  const body = await res.json(); assert.equal(res.status, 201, JSON.stringify(body)); return body.items.map((i) => i.url);
}
async function step(w, who, runId, n, { payload = {}, media: m = [] } = {}) {
  return who.api.post(`${V2}/runs/${runId}/steps/${n}`, { expectedRevision: (await card(w, runId)).revision, workCenterId: w.wc, payload, media: m }, key(`st-${n}`));
}
async function schedule(w, unit, { corner = true, cornerOperatorId = undefined, station = "TABLE_1" } = {}) {
  await addCohort(unit.id);
  const res = await w.lead.api.post(`${V2}/plans`, { unitId: unit.id, productionDate: DATE, stationCode: station, priority: 0, workCenterId: w.wc, operatorId: w.nadyaOp.id, ...(cornerOperatorId ? { cornerOperatorId } : {}) }, key("sch"));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
  if (corner !== null) {
    const c = await card(w, run.id);
    ok(await w.lead.api.post(`${V2}/runs/${run.id}/build/corner`, { expectedRevision: c.revision, required: corner, ...(corner ? {} : { reason: "Tidak ada pekerjaan kain/jahit" }) }, key("corner")));
  }
  return { planId: res.body.planId, run };
}
const board = async (api) => ok(await api.get(`${V2}/corner-board`));
const find = (b, unitCode) => { for (const g of b.groups) { const it = g.items.find((i) => i.unit.unitCode === unitCode); if (it) return { group: g.key, item: it }; } return null; };
const assign = (api, runId, body, k = key("assign")) => api.post(`${V2}/runs/${runId}/corner-operator`, body, k);
const planOf = (runId) => testPrisma.productionRunPlan.findFirstOrThrow({ where: { runId } });
const pickFields = (p) => ({ stationCode: p.stationCode, productionDate: p.productionDate?.toISOString().slice(0, 10), targetDate: p.targetDate, stationSequence: p.stationSequence, operatorId: p.operatorId, workCenterId: p.workCenterId, cornerWorkCenterId: p.cornerWorkCenterId, priority: p.priority });

test("alur Meja → QC → Corner: kelompok berpindah mengikuti state server; PIC, QC, hambatan, aktor; PIC diganti tanpa menyentuh jadwal; pekerjaan berjalan tidak dialihkan", async () => {
  const w = await world();
  const { unit } = await mkOrder();
  const { run, planId } = await schedule(w, unit); // tanpa PIC Corner
  let b = await board(w.lead.api);
  let f = find(b, unit.unitCode);
  assert.equal(f.group, "MENUNGGU_PRASYARAT"); assert.equal(f.item.corner.status, "BELUM_SAMPAI"); assert.equal(f.item.pic.corner, null);
  assert.equal(f.item.blockers.find((x) => x.code === "PIC_CORNER_UNSET").severity, "info", "PIC kosong belum menahan selagi Meja/QC belum selesai");
  assert.equal(f.item.needsAction.actor.label, "PIC Meja"); assert.equal(f.item.assign.allowed, true);
  assert.deepEqual(b.groups.map((g) => g.key), ["MENUNGGU_PRASYARAT", "SIAP_CORNER", "SEDANG_DIKERJAKAN", "SELESAI"]);
  assert.equal(f.item.customer.name.startsWith("Bu Corner"), true); assert.equal(f.item.unit.id, unit.id);

  // Tetapkan PIC Corner: HANYA cornerOperatorId + revisi; Meja/tanggal/target/PIC Meja/urutan tidak berubah; tanpa entri jadwal ulang
  const plan0 = await planOf(run.id); const fields0 = pickFields(plan0);
  const eventsBefore = await testPrisma.productionPlanScheduleEvent.count({ where: { planId } });
  const k1 = key("a1");
  const r1 = await assign(w.lead.api, run.id, { operatorId: w.cornerOp.id, expectedRevision: plan0.revision }, k1);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.changed, true); assert.equal(r1.body.cornerOperator.id, w.cornerOp.id); assert.equal(r1.body.previousCornerOperator, null); assert.equal(r1.body.revision, plan0.revision + 1);
  const plan1 = await planOf(run.id);
  assert.equal(plan1.cornerOperatorId, w.cornerOp.id); assert.deepEqual(pickFields(plan1), fields0, "Meja/tanggal/target/PIC Meja/urutan/work center tidak berubah");
  assert.equal(await testPrisma.productionPlanScheduleEvent.count({ where: { planId } }), eventsBefore, "bukan jadwal ulang");
  const act = await testPrisma.activityEvent.findMany({ where: { entityId: unit.id, eventType: "PRODUCTION_CORNER_OPERATOR_SET" } });
  assert.equal(act.length, 1); assert.equal(act[0].metadata.toOperatorId, w.cornerOp.id); assert.equal(act[0].actorId, w.lead.user.id);
  const cmd = await testPrisma.v2Command.findFirstOrThrow({ where: { commandType: "SET_CORNER_OPERATOR" } });
  assert.equal(cmd.status, "APPLIED"); assert.equal(cmd.response.cornerOperator.id, w.cornerOp.id);
  // replay (kunci sama) tidak menggandakan riwayat
  const rp = await assign(w.lead.api, run.id, { operatorId: w.cornerOp.id, expectedRevision: plan0.revision }, k1);
  assert.equal(rp.status, 200); assert.equal(rp.body.replayed, true);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: unit.id, eventType: "PRODUCTION_CORNER_OPERATOR_SET" } }), 1);
  assert.equal(await testPrisma.v2Command.count({ where: { commandType: "SET_CORNER_OPERATOR" } }), 1);
  assert.equal((await planOf(run.id)).revision, plan0.revision + 1);
  // kunci sama + isian berbeda -> 409 IDEMPOTENCY_CONFLICT
  const bad = await assign(w.lead.api, run.id, { operatorId: w.corner2Op.id, expectedRevision: plan0.revision }, k1);
  assert.equal(bad.status, 409); assert.equal(bad.body.code, "IDEMPOTENCY_CONFLICT");

  // Ganti PIC (revisi baru), dibaca papan
  const r2 = await assign(w.lead.api, run.id, { operatorId: w.corner2Op.id, expectedRevision: plan1.revision });
  assert.equal(r2.status, 200); assert.equal(r2.body.previousCornerOperator.id, w.cornerOp.id); assert.equal(r2.body.changed, true);
  f = find(await board(w.lead.api), unit.unitCode); assert.equal(f.item.pic.corner.id, w.corner2Op.id); assert.equal(f.item.plan.revision, plan1.revision + 1);
  // operator sama = tanpa perubahan/riwayat
  const same = await assign(w.lead.api, run.id, { operatorId: w.corner2Op.id, expectedRevision: plan1.revision + 1 });
  assert.equal(same.status, 200); assert.equal(same.body.changed, false); assert.equal(same.body.revision, plan1.revision + 1);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: unit.id, eventType: "PRODUCTION_CORNER_OPERATOR_SET" } }), 2);

  // QC: menunggu -> gagal (rework di Meja) -> lulus
  ok(await step(w, w.nadya, run.id, 6, {}));
  ok(await step(w, w.nadya, run.id, 6, { payload: { note: "Rangka kayu + dudukan sesuai ukuran", racikan: { fondasi: "Kayu", lapisan: "Busa" } }, media: await media(w.nadya, run.id, "i") }));
  f = find(await board(w.lead.api), unit.unitCode);
  assert.equal(f.group, "MENUNGGU_PRASYARAT"); assert.equal(f.item.qc.key, "MENUNGGU"); assert.equal(f.item.needsAction.actor.label, "PIC QC");
  const qcRun = ok(await w.qc.api.get(`${P}/qc/runs/${run.id}`));
  const reworkStage = qcRun.stages.find((x) => x.code === "custom_build");
  ok(await w.qc.api.post(`${P}/qc/runs/${run.id}/inspect`, { expectedRevision: qcRun.revision, result: "FAIL", photoUrls: ["/media/job-photos/qc.jpg"], note: "Rangka miring", reworkStageId: reworkStage.id }, key("qc-fail")));
  f = find(await board(w.lead.api), unit.unitCode);
  assert.equal(f.group, "MENUNGGU_PRASYARAT", "QC gagal belum boleh ke Corner"); assert.equal(f.item.qc.key, "GAGAL"); assert.equal(f.item.primaryBlocker.code, "QC_FAILED"); assert.equal(f.item.primaryBlocker.actor.label, "PIC Meja");
  assert.equal(f.item.assign.allowed, true, "Corner belum berjalan: PIC masih boleh diganti");
  ok(await step(w, w.nadya, run.id, 6, {}));
  ok(await step(w, w.nadya, run.id, 6, { payload: { note: "Rangka diluruskan" }, media: await media(w.nadya, run.id, "i") }));
  const qc2 = ok(await w.qc.api.get(`${P}/qc/runs/${run.id}`));
  ok(await w.qc.api.post(`${P}/qc/runs/${run.id}/inspect`, { expectedRevision: qc2.revision, result: "PASS", photoUrls: ["/media/job-photos/qc2.jpg"], note: "lurus" }, key("qc-pass")));
  f = find(await board(w.lead.api), unit.unitCode);
  assert.equal(f.item.qc.key, "LULUS");
  ok(await step(w, w.nadya, run.id, 9, { payload: { note: "siap dibungkus" }, media: await media(w.nadya, run.id, "i") }));
  f = find(await board(w.lead.api), unit.unitCode);
  assert.equal(f.group, "SIAP_CORNER"); assert.equal(f.item.corner.status, "MENUNGGU_CORNER"); assert.equal(f.item.needsAction.actor.label, "PIC Corner");
  assert.equal(f.item.assign.allowed, true);
  // PIC Corner mulai (Aplikasi Corner) -> kelompok pindah; pengalihan ditolak, jadwal/PIC utuh
  // PIC yang BERHAK memulai = PIC Corner yang ditugaskan (corner2 setelah penggantian); PIC lama ditolak server
  const oldPic = await step(w, w.corner, run.id, 10, { payload: { mattressStyle: "PILLOWTOP", fabricSpec: "Kain sofa abu", borderColor: "Abu" } });
  assert.equal(oldPic.status, 403); assert.equal(oldPic.body.code, "WORKSHOP_OPERATOR_MISMATCH");
  ok(await step(w, w.corner2, run.id, 10, { payload: { mattressStyle: "PILLOWTOP", fabricSpec: "Kain sofa abu", borderColor: "Abu" } }));
  f = find(await board(w.lead.api), unit.unitCode);
  assert.equal(f.group, "SEDANG_DIKERJAKAN"); assert.equal(f.item.assign.allowed, false); assert.equal(f.item.assign.code, "CORNER_WORK_STARTED");
  const planStarted = await planOf(run.id);
  const blocked = await assign(w.lead.api, run.id, { operatorId: w.cornerOp.id, expectedRevision: planStarted.revision });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, "CORNER_WORK_STARTED");
  assert.equal((await planOf(run.id)).cornerOperatorId, planStarted.cornerOperatorId, "pekerjaan aktif tidak dipindahkan diam-diam");
  ok(await step(w, w.corner2, run.id, 11, { payload: { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, media: await media(w.nadya, run.id, "i") }));
  ok(await step(w, w.corner2, run.id, 12, { payload: { confirm: true }, media: await media(w.nadya, run.id, "i") }));
  f = find(await board(w.lead.api), unit.unitCode);
  assert.equal(f.group, "SELESAI"); assert.deepEqual(f.item.blockers, []); assert.equal(f.item.needsAction, null);
});

test("keputusan Corner: tidak diperlukan tetap di Meja (alasan + pemutus), belum diputuskan = Menunggu prasyarat dengan aktor Kepala Produksi; pengalihan ditolak berkode", async () => {
  const w = await world();
  const no = await mkOrder(); const noRun = (await schedule(w, no.unit, { corner: false })).run;
  const undecided = await mkOrder(); const undRun = (await schedule(w, undecided.unit, { corner: null })).run;
  const yes = await mkOrder(); await schedule(w, yes.unit, { corner: true });
  const b = await board(w.lead.api);
  assert.equal(find(b, no.unit.unitCode), null, "Corner tidak diperlukan bukan pekerjaan Corner");
  assert.equal(b.notApplicable, 1);
  assert.ok(find(b, yes.unit.unitCode)); assert.equal(find(b, undecided.unit.unitCode).group, "MENUNGGU_PRASYARAT");
  assert.equal(find(b, undecided.unit.unitCode).item.primaryBlocker.code, "CORNER_NOT_CONFIRMED"); assert.equal(find(b, undecided.unit.unitCode).item.primaryBlocker.actor.label, "Kepala Produksi");
  // kartu Meja membawa alasan + pemutus
  const meja = ok(await w.lead.api.get(`${V2}/board?date=${DATE}`));
  const mejaCard = meja.stations.flatMap((s) => s.items).find((v) => v.runId === noRun.id);
  assert.equal(mejaCard.corner.status, "TIDAK_BERLAKU"); assert.equal(mejaCard.cornerDecision.required, false);
  assert.equal(mejaCard.cornerDecision.reason, "Tidak ada pekerjaan kain/jahit"); assert.equal(mejaCard.cornerDecision.decidedBy, w.lead.user.name);
  const p1 = await planOf(noRun.id);
  const r1 = await assign(w.lead.api, noRun.id, { operatorId: w.cornerOp.id, expectedRevision: p1.revision });
  assert.equal(r1.status, 409); assert.equal(r1.body.code, "CORNER_NOT_REQUIRED");
  const p2 = await planOf(undRun.id);
  const r2 = await assign(w.lead.api, undRun.id, { operatorId: w.cornerOp.id, expectedRevision: p2.revision });
  assert.equal(r2.status, 409); assert.equal(r2.body.code, "CORNER_DECISION_PENDING");
  assert.equal((await planOf(noRun.id)).cornerOperatorId, null); assert.equal((await planOf(undRun.id)).cornerOperatorId, null);
});

test("konflik: dua Lead bersamaan (tepat satu menang), perubahan jadwal Meja oleh orang lain, revisi basi; UI memuat data terbaru; operator/izin tidak sah", async () => {
  const w = await world();
  const { unit } = await mkOrder(); const { run, planId } = await schedule(w, unit, { cornerOperatorId: w.cornerOp.id });
  const p0 = await planOf(run.id);
  // dua Lead bersamaan, revisi sama, operator berbeda
  const [a, b2] = await Promise.all([
    assign(w.lead.api, run.id, { operatorId: w.corner2Op.id, expectedRevision: p0.revision }),
    assign(w.lead2.api, run.id, { operatorId: w.cornerOp.id, expectedRevision: p0.revision }),
  ]);
  const statuses = [a.status, b2.status].sort();
  assert.deepEqual(statuses, [200, 409], `tepat satu menang: ${a.status}/${b2.status}`);
  const loser = a.status === 409 ? a : b2;
  assert.equal(loser.body.code, "PLAN_REVISION_CONFLICT"); assert.equal(loser.body.details.revision, p0.revision + 1);
  const p1 = await planOf(run.id); assert.equal(p1.revision, p0.revision + 1);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: unit.id, eventType: "PRODUCTION_CORNER_OPERATOR_SET" } }), 1);
  // perubahan jadwal Meja oleh orang lain (pindah Meja) -> perintah PIC Corner dengan revisi lama ditolak; penugasan orang lain tidak tertimpa
  const move = await w.lead2.api.post(`${V2}/plans/${planId}/schedule`, { expectedRevision: p1.revision, productionDate: DATE, stationCode: "TABLE_2", priority: 0, workCenterId: w.wc, operatorId: w.nadyaOp.id, cornerOperatorId: p1.cornerOperatorId }, key("move"));
  assert.equal(move.status, 200, JSON.stringify(move.body));
  const p2 = await planOf(run.id); assert.equal(p2.stationCode, "TABLE_2");
  const stale = await assign(w.lead.api, run.id, { operatorId: w.corner2Op.id, expectedRevision: p1.revision });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "PLAN_REVISION_CONFLICT");
  const p3 = await planOf(run.id); assert.equal(p3.cornerOperatorId, p2.cornerOperatorId); assert.equal(p3.stationCode, "TABLE_2"); assert.equal(p3.revision, p2.revision);
  // sebaliknya: jadwal Meja dengan revisi basi setelah PIC Corner diganti ditolak oleh command jadwal
  const okAssign = await assign(w.lead.api, run.id, { operatorId: w.cornerOp.id === p3.cornerOperatorId ? w.corner2Op.id : w.cornerOp.id, expectedRevision: p3.revision });
  assert.equal(okAssign.status, 200);
  const staleMove = await w.lead2.api.post(`${V2}/plans/${planId}/schedule`, { expectedRevision: p3.revision, productionDate: DATE, stationCode: "TABLE_3", priority: 0, workCenterId: w.wc, operatorId: w.nadyaOp.id, cornerOperatorId: p3.cornerOperatorId }, key("move2"));
  assert.equal(staleMove.status, 409); assert.equal(staleMove.body.code, "PLAN_REVISION_CONFLICT");
  // muat ulang: papan memberi revisi + PIC terbaru
  const f = find(await board(w.lead.api), unit.unitCode);
  assert.equal(f.item.plan.revision, (await planOf(run.id)).revision); assert.equal(f.item.plan.stationCode, "TABLE_2");
  // operator tidak sah: Admin/Owner, nonaktif, tidak ada, bukan UUID
  const cur = await planOf(run.id);
  for (const [opId, status, code] of [[w.adminOp.id, 422, "CORNER_OPERATOR_INVALID"], [w.inactiveOp.id, 422, "CORNER_OPERATOR_INVALID"], ["00000000-0000-4000-8000-000000000000", 422, "CORNER_OPERATOR_INVALID"], ["bukan-uuid", 400, "CORNER_OPERATOR_REQUIRED"]]) {
    const r = await assign(w.lead.api, run.id, { operatorId: opId, expectedRevision: cur.revision });
    assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.code, code);
  }
  assert.equal((await planOf(run.id)).revision, cur.revision);
  // izin: Sales/PIC Meja/QC tidak punya izin penugasan; tanpa Idempotency-Key = 400
  for (const who of [w.sales, w.nadya, w.qc]) assert.equal((await assign(who.api, run.id, { operatorId: w.cornerOp.id, expectedRevision: cur.revision })).status, 403);
  const noKey = await w.lead.api.post(`${V2}/runs/${run.id}/corner-operator`, { operatorId: w.cornerOp.id, expectedRevision: cur.revision });
  assert.equal(noKey.status, 400);
  const noRev = await assign(w.lead.api, run.id, { operatorId: w.cornerOp.id });
  assert.equal(noRev.status, 400);
});

test("kartu tertunda + permintaan Sales: ganti kain tanpa motif/warna -> peringatan Sales; papan hanya-baca; Sales/Gudang boleh membaca, tidak menulis", async () => {
  const w = await world();
  const { unit } = await mkOrder({ services: ["Divan Custom 160x200", "Ganti Kain Sarung"], notes: "Ukuran khusus 160x200" });
  const { run } = await schedule(w, unit, { corner: true, cornerOperatorId: w.cornerOp.id });
  const f = find(await board(w.lead.api), unit.unitCode);
  assert.equal(f.item.request.fabricChangeRequested, true); assert.deepEqual(f.item.request.fabricItems, ["Ganti Kain Sarung"]);
  assert.equal(f.item.request.needsSalesConfirmation, true); assert.deepEqual(f.item.request.missing, ["motif", "warna"]);
  assert.equal(f.item.request.notes, "Ukuran khusus 160x200");
  assert.equal(f.item.pic.corner.id, w.cornerOp.id); assert.equal(f.item.pic.table.id, w.nadyaOp.id);
  const asSales = await w.sales.api.get(`${V2}/corner-board`); assert.equal(asSales.status, 200);
  assert.ok(find(asSales.body, unit.unitCode));
  assert.equal((await w.sales.api.post(`${V2}/corner-board`, {})).status, 404, "papan Corner hanya GET");
  // tidak ada field urutan/kapasitas/target Corner yang dikarang
  const text = JSON.stringify(f.item); assert.ok(!/cornerSequence|cornerCapacity|cornerTarget/.test(text));
  void run;
});
