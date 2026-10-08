// P8 Production Experience V2: papan meja, 12 tahap evidence-gated PIC Table/Corner, menunggu bahan, laporan Sales, cohort & peran.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import * as PT from "./setup/preTeardown.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

let server;
let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (v) => ({ "Idempotency-Key": `p8-test-${v}-0001` });
const V2 = "/api/production-v2";
const P = "/api/production-planning";
const DATE = "2026-09-30";

async function setFlag(flagKey, unitIds) {
  const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "p8 test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
async function setCohort(...unitIds) {
  for (const flagKey of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(flagKey, unitIds);
}
async function addCohort(...unitIds) {
  const row = await testPrisma.v2FeatureFlag.findUnique({ where: { key: V2_FLAGS.PRODUCTION_WRITER } });
  const current = row?.enabled ? (row.config?.unitIds ?? []) : [];
  await setCohort(...new Set([...current, ...unitIds]));
}

async function world() {
  const [lead, nadya, corner, qc, driver] = await Promise.all([
    createTestUser({ roles: ["PRODUCTION_LEAD"] }),
    createTestUser({ roles: ["WAREHOUSE", "PRODUCTION_WORKER"] }), // rangkap Operator + Gudang, bukan ADMIN: sejak 65e7e1f5 ADMIN/OWNER memegang QC_WRITE + PRODUCTION_EXECUTE_ANY (kontraknya diuji di productionQcFinishedGoods & adminAllLines), jadi pagar PIC/QC di sini diuji dengan pengguna biasa
    createTestUser({ roles: ["PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["QC_LEAD"] }),
    createTestUser({ roles: ["DRIVER"] }),
  ]);
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-P8-${++seq}`, name: "Workshop Utama" } });
  const nadyaOp = await testPrisma.productionOperator.create({ data: { userId: nadya.user.id, primaryWorkCenterId: workCenter.id } });
  const cornerOp = await testPrisma.productionOperator.create({ data: { userId: corner.user.id, primaryWorkCenterId: workCenter.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-P8-${++seq}`, name: "Gudang P8" } });
  const loc = (zone, locationType) => testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone, locationType, code: `${zone}-P8-${++seq}` } });
  const [rcv, fg] = [await loc("RCV", "RECEIVING_AREA"), await loc("FG", "FINISHED_GOODS_AREA")];
  const service = await testPrisma.serviceCatalog.findUniqueOrThrow({ where: { code: "UPG_FONDASI_LAPISAN" } });
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  const fondasi = await createTestMaterial({ name: `Pocket Spring ${++seq}` });
  const lapisan = await createTestMaterial({ name: `Latex D80 ${++seq}` });
  await seedBalance(fondasi.id, 10);
  await seedBalance(lapisan.id, 10);
  return { lead: c(lead), nadya: c(nadya), corner: c(corner), qc: c(qc), driver: c(driver), wc: workCenter.id, nadyaOp, cornerOp, rcv, fg, service, fondasi, lapisan };
}

// Unit LAYANAN lewat pickup nyata (V1) + custody INBOUND diterima Nadya (Gudang).
async function acceptedUnit(w, { cohort = true, v2 = false } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Ibu Maya ${++seq}` } });
  const order = await testPrisma.order.create({
    data: { customerId: customer.id, orderNumber: `P8O-${++seq}`, value: 1000, category: "LAYANAN", beratBadan: 85, complaintCategory: ["SAKIT_PINGGANG"], notes: "Minta tekstur firm" },
  });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-P8-${++seq}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP", merk: "King Koil", ukuran: "180x200" } });
  const route = await testPrisma.route.create({ data: { code: `P8-RTE-${++seq}`, date: new Date("2026-09-29T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, driverId: w.driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-09-29T00:00:00.000Z") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  if (cohort) await addCohort(unit.id);
  const tag = `acc-${++seq}`;
  await w.driver.api.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}-s`));
  await w.driver.api.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${tag}-a`));
  const done = await w.driver.api.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga", note: "ok", location: null }, key(`${tag}-c`));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  if (!cohort) return { unit, run: null };
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: unit.id, direction: "INBOUND" } });
  const acc = await w.nadya.api.post(`/api/inventory/unit-custody/${handoff.id}/accept`, { locationId: w.rcv.id, expectedRevision: 1 }, key(`${tag}-x`));
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  // Fase 4: tes ini TIDAK menguji gerbang perakitan -> Run disematkan ke kebijakan V1 (jalur modul lama: uji tekstur Meja, tanpa uji QC fondasi baru/kasur jadi). Gerbang perakitan diuji di productionAssembly.integration.test.js.
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
  return { unit, run: v2 ? run : await testPrisma.productionRun.update({ where: { id: run.id }, data: { qcGatePolicyVersion: "QC_GATE_V1" } }) };
}

async function planOnBoard(w, runId, { station = "TABLE_1", corner = true, tag = `plan-${++seq}` } = {}) {
  const res = await w.lead.api.post(`${V2}/plans`, {
    runId, productionDate: DATE, stationCode: station, priority: 1, workCenterId: w.wc, operatorId: w.nadyaOp.id, ...(corner ? { cornerOperatorId: w.cornerOp.id } : {}),
  }, key(tag));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

let fileSeq = 0;
async function upload(who, runId, kinds) {
  const fd = new FormData();
  fd.append("runId", runId);
  for (const k of kinds) {
    const video = k === "v";
    fd.append("files", new Blob([Buffer.from(`${video ? "vid" : "img"}-${++fileSeq}-${Math.random()}`)], { type: video ? "video/mp4" : "image/jpeg" }), video ? "a.mp4" : "a.jpg");
  }
  const res = await fetch(`${server.baseUrl}${V2}/evidence/upload`, { method: "POST", headers: { Authorization: `Bearer ${who.token}` }, body: fd });
  return { status: res.status, body: await res.json() };
}
async function media(who, runId, ...kinds) {
  const res = await upload(who, runId, kinds);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.items.map((i) => i.url);
}
const card = async (w, runId) => {
  const res = await w.lead.api.get(`${V2}/runs/${runId}/card`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
};
async function step(w, who, runId, n, { payload = {}, media: m = [], rev = null, wc = w.wc, tag = `st-${n}-${++seq}` } = {}) {
  const expectedRevision = rev ?? (await card(w, runId)).revision;
  return who.api.post(`${V2}/runs/${runId}/steps/${n}`, { expectedRevision, workCenterId: wc, payload, media: m }, key(tag));
}
const ok = (res) => { assert.equal(res.status, 200, JSON.stringify(res.body)); return res.body; };
const evidenceCount = (runId) => testPrisma.productionStepEvidence.count({ where: { runId } });

async function setBomAndIssue(w, planId) {
  const plan = (await w.lead.api.get(`${P}/plans/${planId}`)).body;
  const bom = ok(await w.lead.api.post(`${P}/plans/${planId}/bom`, { lines: [{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.lapisan.id, qty: 2 }], expectedRevision: plan.revision }, key(`bom-${++seq}`)));
  const reserve = ok(await w.nadya.api.post(`${P}/plans/${planId}/reserve`, { expectedRevision: bom.revision }, key(`res-${++seq}`)));
  assert.equal(reserve.status, "MATERIAL_RESERVED");
  const req = await w.nadya.api.post(`${P}/plans/${planId}/material-request`, {}, key(`mr-${++seq}`));
  assert.equal(req.status, 201, JSON.stringify(req.body));
  return req.body.issueId;
}
const pick = async (w, issueId) => ok(await w.nadya.api.post(`${P}/material-requests/${issueId}/pick`, { expectedRevision: 1 }, key(`pk-${++seq}`)));

// Tahap 1–4 (intake) sampai operasi diagnosa berjalan.
async function throughIntake(w, runId) {
  ok(await step(w, w.nadya, runId, 1, { payload: { conditionConfirmed: true, conditionNote: "kain luar kusam" }, media: await media(w.nadya, runId, "i") }));
  await PT.qcWhole(server, w.qc, runId); // fase 2: catatan PIC QC / lapisan awal (gerbang tahap 2)
  ok(await step(w, w.nadya, runId, 2, { payload: { feelNote: "Tengah terasa amblas" }, media: await media(w.nadya, runId, "v") }));
  await PT.layersBefore(server, w.nadya, runId); // fase 2: catatan PIC QC / lapisan awal (gerbang tahap 3)
  ok(await step(w, w.nadya, runId, 3, { payload: { oldMaterials: ["PER", { type: "BUSA", note: "kuning kempes" }] }, media: await media(w.nadya, runId, "i", "i") }));
  await PT.foundationTest(server, w.qc, runId); // fase 2: catatan PIC QC / lapisan awal (gerbang tahap 4)
  ok(await step(w, w.nadya, runId, 4, { payload: { heightBeforeCm: 24, heightCompressedCm: 17, testerWeightKg: 85, foundationIssues: ["Per tengah lemah"] }, media: await media(w.nadya, runId, "v") }));
}

const DIAG = { diagnosis: "Per tengah lemah dan busa penopang kempes sehingga pinggang melengkung saat tidur.", inputMethod: "TEXT" };

test("lifecycle 12 tahap penuh: custody -> papan -> intake -> diagnosa (menunggu layanan) -> bahan -> fondasi -> lapisan -> uji tekstur (rework) -> QC P6 -> Corner -> handoff -> Gudang ACCEPTED", async () => {
  const w = await world();
  const { unit, run } = await acceptedUnit(w);
  const planned = await planOnBoard(w, run.id);
  assert.equal(planned.stationCode, "TABLE_1"); assert.equal(planned.productionDate, DATE); assert.equal(planned.status, "PLANNED");

  const board = ok(await w.lead.api.get(`${V2}/board?date=${DATE}`));
  assert.equal(board.readerMode, "COHORT");
  assert.equal(board.kpi.target, 12); assert.equal(board.kpi.planned, 1);
  const t1 = board.stations.find((s) => s.code === "TABLE_1");
  assert.equal(t1.items.length, 1); assert.equal(t1.capacity, 3);
  const cardOnBoard = t1.items[0];
  assert.equal(cardOnBoard.customer.weightKg, 85); assert.deepEqual(cardOnBoard.customer.complaints, ["Sakit pinggang"]); assert.equal(cardOnBoard.customer.request, "Minta tekstur firm");
  assert.equal(cardOnBoard.next.stepNo, 1); assert.equal(cardOnBoard.bucket, "ANTREAN");
  assert.ok(!cardOnBoard.warnings.some((x) => x.code === "LAYANAN_BELUM"), "Slice 1: layanan teknis tidak ditampilkan — tidak ada peringatan layanan teknis di kartu");
  assert.equal(JSON.stringify(board).includes("phone"), false, "tanpa nomor telepon customer");

  // Tahap tidak bisa dilewati.
  const skip = await step(w, w.nadya, run.id, 3, { payload: { oldMaterials: ["PER"] }, media: await media(w.nadya, run.id, "i") });
  assert.equal(skip.status, 409); assert.equal(skip.body.code, "STEP_OUT_OF_ORDER"); assert.equal(skip.body.details.expectedStep, 1);
  assert.equal(await evidenceCount(run.id), 0);

  await throughIntake(w, run.id);
  let c = await card(w, run.id);
  assert.equal(c.next.stepNo, 5); assert.equal(c.activeOp.stageLabel, "Diagnosa"); assert.equal(c.bucket, "DIAGNOSA");

  // Diagnosa tanpa layanan: bukti tercatat, tahap TIDAK ditutup (tidak lompat ke QC), menunggu Planner.
  ok(await step(w, w.nadya, run.id, 5, { payload: DIAG }));
  c = await card(w, run.id);
  assert.equal(c.next.wait, "SERVICE_NOT_SET"); assert.equal(c.currentPhase, "PROCESS"); assert.equal(c.activeOp.stageLabel, "Diagnosa");
  const blocked = await step(w, w.nadya, run.id, 5, {});
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, "STEP_WAITING_SERVICE_NOT_SET");

  // Layanan teknis unit cohort HANYA lewat command Diagnosis (V2); jalur V1 ditutup untuk unit cohort.
  const v1Try = await w.lead.api.patch(`/api/units/${unit.id}/service`, { serviceId: w.service.id });
  assert.equal(v1Try.status, 409); assert.equal(v1Try.body.code, "UNIT_V2_OWNED", "PATCH layanan V1 tidak boleh melewati Diagnosis untuk unit cohort");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).serviceId, null, "penolakan tanpa efek");
  const diagPhoto = (await media(w.nadya, run.id, "i"))[0];
  const diag = await w.nadya.api.post(`${V2}/diagnosis/${run.id}/submit`, {
    expectedRevision: 0, workCenterId: w.wc, photoUrls: [diagPhoto], recommendedServiceId: w.service.id,
    findings: { general: { condition: "Kasur kempes di tengah", mainDamage: "Fondasi keropos", damageLevel: "SEDANG", teardownNote: "Per karatan" }, foundation: { oldCondition: "Per karatan", action: "REPLACE", size: "180x200", qty: "1" }, layers: [{ oldCondition: "Busa tipis", action: "REPLACE", material: "Busa HD", thickness: "5cm", qty: "2" }], components: { spring: "Ganti per baru" }, serviceNote: "Restorasi penuh fondasi dan lapisan atas sesuai keluhan sakit pinggang" },
    materials: [{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.lapisan.id, qty: 2 }],
  }, key(`diag-${++seq}`));
  assert.equal(diag.status, 201, JSON.stringify(diag.body));
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).serviceId, w.service.id, "layanan ditetapkan oleh submitDiagnosis");
  // Gudang reservasi + serah bahan (BOM sudah ditulis Diagnosis; setBomAndIssue menetapkan ulang baris yang sama).
  const issueId = await setBomAndIssue(w, planned.planId);
  c = await card(w, run.id);
  assert.equal(c.next.action, "COMPLETE"); assert.equal(c.next.stepNo, 5);
  // Lanjutkan diagnosa (tanpa isian baru) -> modul fondasi TIDAK otomatis mulai karena bahan belum diserahkan.
  const cont = ok(await step(w, w.nadya, run.id, 5, {}));
  assert.equal(cont.autoStarted, undefined);
  assert.equal(cont.next.wait, "MATERIAL_NOT_READY");
  assert.equal((await card(w, run.id)).bucket, "MENUNGGU_BAHAN");
  await pick(w, issueId);
  c = await card(w, run.id);
  assert.deepEqual([c.next.stepNo, c.next.action], [6, "START"]);
  ok(await step(w, w.nadya, run.id, 6, {}));

  // Tahap 6: bahan harus dari bahan yang diserahkan; jumlah tidak boleh melebihi.
  const overIssued = await step(w, w.nadya, run.id, 6, { payload: { note: "pocket spring baru", materials: [{ materialId: w.fondasi.id, qty: 5 }] }, media: await media(w.nadya, run.id, "v") });
  assert.equal(overIssued.status, 422); assert.equal(overIssued.body.code, "STEP_MATERIAL_OVER_ISSUED");
  const s6 = ok(await step(w, w.nadya, run.id, 6, { payload: { note: "Pocket spring baru + penguat pinggir", materials: [{ materialId: w.fondasi.id, qty: 1 }] }, media: await media(w.nadya, run.id, "v") }));
  assert.equal(s6.autoStarted.stage.code, "comfort_layer_upgrade");
  assert.deepEqual([s6.next.stepNo, s6.next.action], [7, "EVIDENCE"]);

  // Tahap 7 + uji tekstur TERLALU KERAS -> rework wajib (ulang bukti lapisan) -> PAS -> AWAITING_QC.
  ok(await step(w, w.nadya, run.id, 7, { payload: { materials: [{ materialId: w.lapisan.id, qty: 2 }] }, media: await media(w.nadya, run.id, "i") }));
  const keras = ok(await step(w, w.nadya, run.id, 8, { payload: { verdict: "TERLALU_KERAS", testerWeightKg: 85 }, media: await media(w.nadya, run.id, "v") }));
  assert.equal(keras.verdict, "TERLALU_KERAS"); assert.deepEqual([keras.next.stepNo, keras.next.action, keras.next.rework], [7, "EVIDENCE", true]);
  assert.equal((await card(w, run.id)).bucket, "QC", "rework tampil di Andon sebagai QC/Rework");
  const retest = await step(w, w.nadya, run.id, 8, { payload: { verdict: "PAS", testerWeightKg: 85 }, media: await media(w.nadya, run.id, "v") });
  assert.equal(retest.status, 409); assert.equal(retest.body.code, "STEP_OUT_OF_ORDER", "uji ulang tanpa perbaikan lapisan ditolak");
  ok(await step(w, w.nadya, run.id, 7, { payload: { materials: [{ materialId: w.lapisan.id, qty: 2 }], note: "Lapisan atas diganti lebih empuk" }, media: await media(w.nadya, run.id, "i") }));
  const pas = ok(await step(w, w.nadya, run.id, 8, { payload: { verdict: "PAS", testerWeightKg: 85 }, media: await media(w.nadya, run.id, "v") }));
  assert.equal(pas.awaitingQc, true); assert.equal(pas.next.wait, "AWAITING_QC");
  assert.equal(await testPrisma.productionStepEvidence.count({ where: { runId: run.id, stepNo: 7 } }), 2, "histori bukti lapisan disimpan dua versi");
  const earlyHandoff = await step(w, w.nadya, run.id, 9, { payload: {}, media: await media(w.nadya, run.id, "i") });
  assert.equal(earlyHandoff.status, 409); assert.equal(earlyHandoff.body.code, "STEP_WAITING_AWAITING_QC");

  // QC resmi hanya pemegang QC_WRITE (Nadya ditolak).
  const qcRun = (await w.qc.api.get(`${P}/qc/runs/${run.id}`)).body;
  const passBody = { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], referenceWeightKg: 85, fitVerdict: "PAS", note: "lulus" };
  assert.equal((await w.lead.api.post(`${P}/qc/runs/${run.id}/inspect`, passBody, key("lead-qc"))).status, 403, "Production Lead tidak memegang QC_WRITE");
  ok(await w.qc.api.post(`${P}/qc/runs/${run.id}/inspect`, passBody, key("qc-pass")));

  // Tahap 9 milik PIC meja; tahap 10–12 milik PIC Corner.
  const cornerOn9 = await step(w, w.corner, run.id, 9, { payload: {}, media: await media(w.nadya, run.id, "i") });
  assert.equal(cornerOn9.status, 403);
  ok(await step(w, w.nadya, run.id, 9, { payload: { note: "siap dibungkus" }, media: await media(w.nadya, run.id, "i") }));
  const spec = { mattressStyle: "PILLOWTOP", fabricSpec: "Knitting putih quilting", borderColor: "Abu-abu tua" };
  const tableOn10 = await step(w, w.nadya, run.id, 10, { payload: spec });
  assert.equal(tableOn10.status, 403, "Corner ditugaskan: PIC meja tidak boleh mulai jahit");
  ok(await step(w, w.corner, run.id, 10, { payload: spec }));
  assert.equal((await card(w, run.id)).bucket, "CORNER");
  const cornerQueue = ok(await w.corner.api.get(`${V2}/worker/corner`));
  assert.deepEqual(cornerQueue.items.map((i) => i.runId), [run.id]);
  ok(await step(w, w.corner, run.id, 11, { payload: { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, media: await media(w.nadya, run.id, "i", "v") }));
  const noPhoto = await step(w, w.corner, run.id, 12, { payload: { confirm: true } });
  assert.equal(noPhoto.status, 400, "tahap Finish wajib foto");
  const fin = ok(await step(w, w.corner, run.id, 12, { payload: { confirm: true }, media: await media(w.nadya, run.id, "i") }));
  assert.ok(fin.handoffId); assert.equal(fin.next.wait, "AWAITING_WAREHOUSE");

  // Konfirmasi Selesai BUKAN siap kirim; laporan & broadcast jujur PENDING.
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "IN_PRODUCTION");
  const reportEvents = await testPrisma.domainOutbox.findMany({ where: { eventType: "production.report.ready", aggregateId: run.id } });
  assert.equal(reportEvents.length, 1); assert.equal(reportEvents[0].status, "PENDING"); assert.equal(reportEvents[0].deliveredAt, null);
  const report = ok(await w.lead.api.get(`${V2}/runs/${run.id}/report`));
  assert.equal(report.broadcast.status, "PENDING"); assert.equal(report.broadcast.consumerAvailable, false);
  assert.ok(report.media.before.length >= 3 && report.media.process.length >= 3 && report.media.after.length >= 3);
  assert.equal(report.measurement.dropCm, 10, "turunan dari uji fondasi awal PIC QC (25→15 cm)"); assert.equal(report.measurement.source, "QC_FONDASI_AWAL"); assert.equal(report.finalTest.verdict, "PAS"); assert.equal(report.textureTests.length, 2);
  assert.equal(report.materials.foundation[0].qty, 1); assert.equal(report.materials.layer.length, 1, "versi terakhir per operasi, bukan dobel");
  assert.match(report.message, /penurunan fondasi 10 cm/); assert.match(report.message, /tidak dijumlahkan/); assert.match(report.message, /menunggu diterima Gudang/);
  assert.ok(report.media.before.every((m) => /\?exp=\d+&sig=[a-f0-9]+$/.test(m.url)), "media laporan bertanda tangan");

  // Gudang menerima barang jadi -> run COMPLETED, unit READY_FOR_DELIVERY, semua fase terminal, 12/12 tahap.
  const fg = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: fin.handoffId } });
  ok(await w.nadya.api.post(`/api/inventory/unit-custody/${fg.id}/accept`, { locationId: w.fg.id, expectedRevision: fg.revision }, key("fg-accept")));
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).status, "COMPLETED");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "READY_FOR_DELIVERY");
  const phases = await testPrisma.productionPhaseRun.findMany({ where: { runId: run.id } });
  assert.ok(phases.every((p) => ["COMPLETED", "NOT_APPLICABLE", "CANCELLED"].includes(p.status)), JSON.stringify(phases.map((p) => [p.phase, p.status])));
  const finalCard = await card(w, run.id);
  assert.equal(finalCard.bucket, "SELESAI"); assert.deepEqual(finalCard.progress, { done: 12, skipped: 0, remaining: 0, total: 12 });
  assert.equal(await testPrisma.stockMovement.count({ where: { materialIssueId: issueId } }), 2, "stok keluar SEKALI per bahan saat Gudang menyerahkan, tidak digandakan oleh bukti");

  // Bukti immutable di database.
  const anyEvidence = await testPrisma.productionStepEvidence.findFirstOrThrow({ where: { runId: run.id } });
  await assert.rejects(testPrisma.productionStepEvidence.update({ where: { id: anyEvidence.id }, data: { stepCode: "X" } }), /immutable/);
  await assert.rejects(testPrisma.productionStepEvidence.delete({ where: { id: anyEvidence.id } }), /immutable/);
});

test("replay & revisi: Idempotency-Key sama = respons sama tanpa data ganda; isian beda = 409; revisi basi = 409 tanpa tulisan; media belum terunggah = 422", async () => {
  const w = await world();
  const { run } = await acceptedUnit(w);
  await planOnBoard(w, run.id);
  const rev = (await card(w, run.id)).revision;
  const m = await media(w.nadya, run.id, "i");
  const body = { expectedRevision: rev, workCenterId: w.wc, payload: { conditionConfirmed: true }, media: m };
  const first = ok(await w.nadya.api.post(`${V2}/runs/${run.id}/steps/1`, body, key("replay-1")));
  const again = ok(await w.nadya.api.post(`${V2}/runs/${run.id}/steps/1`, body, key("replay-1")));
  assert.equal(again.replayed, true); assert.equal(again.evidenceId, first.evidenceId); assert.equal(again.revision, first.revision);
  assert.equal(await evidenceCount(run.id), 1);
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "production.step.recorded", aggregateId: run.id } }), 1);
  assert.equal(await testPrisma.productionOperationRun.count({ where: { runId: run.id } }), 1);
  const conflict = await w.nadya.api.post(`${V2}/runs/${run.id}/steps/1`, { ...body, payload: { conditionConfirmed: true, conditionNote: "beda" } }, key("replay-1"));
  assert.equal(conflict.status, 409); assert.equal(conflict.body.code, "IDEMPOTENCY_CONFLICT");

  await PT.qcWhole(server, w.qc, run.id); // fase 2: catatan PIC QC (gerbang tahap 2) — ditulis SEBELUM snapshot: yang diuji di sini hanya percobaan tahap basi/ghost/tanpa video
  const before = { ev: await evidenceCount(run.id), ops: await testPrisma.productionOperationRun.count(), cmds: await testPrisma.v2Command.count() };
  const stale = await w.nadya.api.post(`${V2}/runs/${run.id}/steps/2`, { expectedRevision: rev, workCenterId: w.wc, payload: { feelNote: "empuk" }, media: await media(w.nadya, run.id, "v") }, key("stale-2"));
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "STEP_REVISION_CONFLICT"); assert.match(stale.body.error, /Muat ulang/);
  assert.deepEqual({ ev: await evidenceCount(run.id), ops: await testPrisma.productionOperationRun.count(), cmds: await testPrisma.v2Command.count() }, before);

  // Fase 2: tahap 2 memakai media catatan PIC QC (bukan unggahan Meja). Validasi media Meja yang sama kini diuji di tahap 3 (dokumentasi bongkar).
  ok(await step(w, w.nadya, run.id, 2, {}));
  await PT.layersBefore(server, w.nadya, run.id);
  const evBefore = await evidenceCount(run.id);
  const ghost = await step(w, w.nadya, run.id, 3, { payload: {}, media: [`/media/production-evidence/${"d".repeat(40)}.jpg`] });
  assert.equal(ghost.status, 422); assert.equal(ghost.body.code, "STEP_MEDIA_NOT_FOUND");
  const noMedia = await step(w, w.nadya, run.id, 3, { payload: {}, media: [] });
  assert.equal(noMedia.status, 400); assert.equal(noMedia.body.code, "STEP_EVIDENCE_INVALID");
  assert.equal(await evidenceCount(run.id), evBefore, "bukti tidak lengkap tidak menulis apa pun");
});

test("Menunggu Bahan Baku: operasi dijeda sah (PROCESS_DELAY), muncul di antrean Gudang & Andon, lanjut hanya setelah Gudang menyelesaikan", async () => {
  const w = await world();
  const { unit, run } = await acceptedUnit(w);
  const planned = await planOnBoard(w, run.id);
  await throughIntake(w, run.id);
  await testPrisma.unit.update({ where: { id: unit.id }, data: { serviceId: w.service.id, serviceLine: w.service.serviceLine } }); // layanan teknis cohort = hasil Diagnosis V2; jalur V1 ditutup (409 UNIT_V2_OWNED)
  const issueId = await setBomAndIssue(w, planned.planId);
  await pick(w, issueId);
  ok(await step(w, w.nadya, run.id, 5, { payload: DIAG }));
  let c = await card(w, run.id);
  assert.equal(c.activeOp.stageLabel, "Upgrade Fondasi", "diagnosa selesai + bahan siap -> fondasi otomatis mulai");

  const extra = await createTestMaterial({ name: `PE Encasement ${++seq}` });
  const report = await w.nadya.api.post(`${V2}/runs/${run.id}/material-shortage`, { expectedRevision: c.revision, workCenterId: w.wc, items: [{ materialId: extra.id, qty: 2, note: "kurang 2 lembar" }], note: "stok di meja habis" }, key("short-1"));
  assert.equal(report.status, 201, JSON.stringify(report.body)); assert.equal(report.body.paused, true);
  assert.equal((await testPrisma.productionOperationRun.findFirstOrThrow({ where: { runId: run.id, status: "PAUSED" } })).stageCode, "foundation_upgrade");
  const pauseLog = await testPrisma.unitStageLog.findFirstOrThrow({ where: { unitId: unit.id, action: "PAUSE" } });
  assert.equal(pauseLog.pauseReason, "PROCESS_DELAY"); assert.match(pauseLog.note, /Menunggu bahan baku/);
  const dup = await w.nadya.api.post(`${V2}/runs/${run.id}/material-shortage`, { expectedRevision: report.body.revision, workCenterId: w.wc, items: [{ materialId: extra.id }] }, key("short-2"));
  assert.equal(dup.status, 409); assert.equal(dup.body.code, "SHORTAGE_ALREADY_OPEN");

  c = await card(w, run.id);
  assert.equal(c.next.wait, "MATERIAL_SHORTAGE"); assert.equal(c.bucket, "MENUNGGU_BAHAN");
  const andon = ok(await w.lead.api.get(`${V2}/andon?date=${DATE}`));
  assert.equal(andon.counts.MENUNGGU_BAHAN, 1);
  assert.deepEqual(andon.stations.find((s) => s.code === "TABLE_1").items[0].shortage, [extra.name]);
  const wq = ok(await w.nadya.api.get(`${V2}/warehouse/queue`));
  assert.equal(wq.shortages.length, 1); assert.equal(wq.shortages[0].items[0].qty, 2);
  const resumeEarly = await step(w, w.nadya, run.id, 6, {});
  assert.equal(resumeEarly.status, 409); assert.equal(resumeEarly.body.code, "STEP_WAITING_MATERIAL_SHORTAGE");

  const worker = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  assert.equal((await makeClient(server.baseUrl, worker.token).post(`${V2}/material-shortages/${wq.shortages[0].id}/resolve`, { expectedRevision: 1 }, key("res-worker"))).status, 403, "hanya Gudang (INVENTORY_WRITE)");
  ok(await w.nadya.api.post(`${V2}/material-shortages/${wq.shortages[0].id}/resolve`, { expectedRevision: 1, note: "diserahkan" }, key("res-wh")));
  c = await card(w, run.id);
  assert.deepEqual([c.next.stepNo, c.next.action], [6, "RESUME"]);
  ok(await step(w, w.nadya, run.id, 6, {}));
  assert.equal((await testPrisma.productionOperationRun.findFirstOrThrow({ where: { runId: run.id, stageCode: "foundation_upgrade" } })).status, "ACTIVE");
});

test("cohort & peran: unit non-cohort tetap V1 (tanpa artefak V2), reader OFF = kosong, upload/langkah ditolak; kapasitas meja 3; ganti PIC saat tahap berjalan ditolak", async () => {
  const w = await world();
  const inCohort = await acceptedUnit(w);
  await planOnBoard(w, inCohort.run.id);
  const outside = await acceptedUnit(w, { cohort: false });
  const outsideRun = await testPrisma.productionRun.findFirst({ where: { unitId: outside.unit.id } });
  assert.equal(outsideRun, null, "pickup unit non-cohort = V1 murni, tanpa run V2");
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: outside.unit.id } }), 0);

  const board = ok(await w.lead.api.get(`${V2}/board?date=${DATE}`));
  assert.equal(JSON.stringify(board).includes(outside.unit.unitCode), false);

  // Writer dimatikan untuk unit cohort: upload & langkah fail-closed, tanpa tulisan.
  await setFlag(V2_FLAGS.PRODUCTION_WRITER, ["00000000-0000-0000-0000-000000000001"]);
  const up = await upload(w.nadya, inCohort.run.id, ["i"]);
  assert.equal(up.status, 503); assert.equal(up.body.code, "EVIDENCE_WRITER_OFF");
  const st = await w.nadya.api.post(`${V2}/runs/${inCohort.run.id}/steps/1`, { expectedRevision: 2, workCenterId: w.wc, payload: { conditionConfirmed: true }, media: [] }, key("off-1"));
  assert.equal(st.status, 503); assert.equal(st.body.code, "STEP_WRITER_OFF");
  assert.equal(await evidenceCount(inCohort.run.id), 0);
  // Config rusak = OFF (bukan GLOBAL).
  await testPrisma.v2FeatureFlag.update({ where: { key: V2_FLAGS.PRODUCTION_READER }, data: { enabled: true, config: {} } });
  const inertBoard = ok(await w.lead.api.get(`${V2}/board?date=${DATE}`));
  assert.equal(inertBoard.readerMode, "OFF"); assert.deepEqual(inertBoard.stations, []);
  assert.equal((await w.lead.api.get(`${V2}/runs/${inCohort.run.id}/card`)).status, 404);
  await setCohort(inCohort.unit.id);

  // Izin server: pekerja tanpa PRODUCTION_ASSIGNMENT_WRITE tidak bisa menjadwalkan.
  const planRow = await testPrisma.productionRunPlan.findFirstOrThrow({ where: { runId: inCohort.run.id } });
  const noPerm = await w.corner.api.post(`${V2}/plans/${planRow.id}/schedule`, { expectedRevision: planRow.revision, productionDate: DATE, stationCode: "TABLE_2", workCenterId: w.wc, operatorId: w.nadyaOp.id }, key("sched-worker"));
  assert.equal(noPerm.status, 403);

  // Kapasitas: 3 unit lahir-di-workshop mengisi Meja 2, unit keempat ditolak 409.
  const born = [];
  for (let i = 0; i < 4; i += 1) {
    const customer = await testPrisma.customer.create({ data: { name: `Born ${++seq}` } });
    const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `P8B-${++seq}`, value: 1, category: "BARU" } });
    const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-P8B-${++seq}`, orderId: order.id, seq: 1, status: "RECEIVED" } });
    await addCohort(unit.id);
    const reg = await w.lead.api.post(`${P}/workshop/runs`, { unitId: unit.id }, key(`born-${seq}`));
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    born.push(reg.body.runId);
  }
  for (let i = 0; i < 3; i += 1) await planOnBoard(w, born[i], { station: "TABLE_2" });
  const full = await w.lead.api.post(`${V2}/plans`, { runId: born[3], productionDate: DATE, stationCode: "TABLE_2", workCenterId: w.wc, operatorId: w.nadyaOp.id }, key("full"));
  assert.equal(full.status, 409); assert.equal(full.body.code, "PLAN_STATION_FULL");
  const fourthPlan = await testPrisma.productionRunPlan.findFirstOrThrow({ where: { runId: born[3] } });
  assert.equal(fourthPlan.stationCode, null, "rencana dibuat tapi tetap di Belum Dijadwalkan");
  const unsched = ok(await w.lead.api.get(`${V2}/board?date=${DATE}`)).unscheduled.plans;
  assert.ok(unsched.some((p) => p.runId === born[3]));
  ok(await w.lead.api.post(`${V2}/plans/${fourthPlan.id}/schedule`, { expectedRevision: fourthPlan.revision, productionDate: DATE, stationCode: "TABLE_3", workCenterId: w.wc, operatorId: w.nadyaOp.id }, key("move-3")));

  // Ganti PIC saat tahap berjalan ditolak; keluarkan dari papan tetap boleh.
  ok(await step(w, w.nadya, inCohort.run.id, 1, { payload: { conditionConfirmed: true }, media: await media(w.nadya, inCohort.run.id, "i") }));
  const plan1 = await testPrisma.productionRunPlan.findFirstOrThrow({ where: { runId: inCohort.run.id } });
  const swap = await w.lead.api.post(`${V2}/plans/${plan1.id}/schedule`, { expectedRevision: plan1.revision, productionDate: DATE, stationCode: "TABLE_1", workCenterId: w.wc, operatorId: w.cornerOp.id }, key("swap"));
  assert.equal(swap.status, 409); assert.equal(swap.body.code, "PLAN_RUN_IN_PROGRESS");

  // Media: URL bertanda tangan bisa diputar; tanda tangan rusak ditolak; Bearer non-cohort ditolak.
  const c = await card(w, inCohort.run.id);
  const signed = c.evidence[0].media[0].url;
  assert.equal((await fetch(`${server.baseUrl}${signed}`)).status, 200);
  assert.equal((await fetch(`${server.baseUrl}${signed.replace(/sig=[a-f0-9]{4}/, "sig=0000")}`)).status, 403);
  const raw = signed.split("?")[0];
  assert.equal((await fetch(`${server.baseUrl}${raw}`)).status, 401);
  assert.equal((await fetch(`${server.baseUrl}${raw}`, { headers: { Authorization: `Bearer ${w.lead.token}` } })).status, 200);
  await setCohort(born[0] ? (await testPrisma.productionRun.findUniqueOrThrow({ where: { id: born[0] } })).unitId : "x");
  assert.equal((await fetch(`${server.baseUrl}${raw}`, { headers: { Authorization: `Bearer ${w.lead.token}` } })).status, 403, "bukti unit di luar reader cohort tidak terlihat");
});

// P12B.6 — rollback writer OFF -> aksi V1 -> writer ON pada Run non-terminal. Proyeksi V2 tidak dijamin sama dengan state V1 -> command V2 harus berhenti, bukan lanjut diam-diam.
test("ROLLBACK writer OFF -> aksi V1 -> writer ON: V2 mendeteksi drift (409 PRODUCTION_RUN_V1_DRIFT) di langkah/rencana/bahan dan berhenti; hanya pembatalan Run yang merekonsiliasi", async () => {
  const w = await world();
  const { unit, run } = await acceptedUnit(w);
  const planned = await planOnBoard(w, run.id);
  await throughIntake(w, run.id);
  const projection = async () => ({
    run: (await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).revision,
    ops: (await testPrisma.productionOperationRun.findMany({ where: { runId: run.id }, orderBy: { sequence: "asc" } })).map((o) => `${o.sequence}:${o.status}`).join(","),
    evidence: await evidenceCount(run.id), commands: Number((await testPrisma.$queryRawUnsafe("select count(*)::int c from v2_commands"))[0].c),
  });
  const markers = () => testPrisma.activityEvent.count({ where: { entityId: unit.id, eventType: "PRODUCTION_V1_WRITE_ON_V2_RUN" } });
  const P0 = await projection();

  // (a) writer ON + Run aktif: V1 ditolak, tanpa penanda.
  assert.equal((await w.lead.api.patch(`/api/units/${unit.id}/service`, { serviceId: w.service.id })).status, 409);
  assert.equal(await markers(), 0);

  // (b) ROLLBACK: writer OFF (reader tetap). V1 bekerja (jalur kerja sah) tetapi meninggalkan penanda drift di transaksi yang sama.
  await setFlag(V2_FLAGS.PRODUCTION_WRITER, null);
  assert.equal((await w.lead.api.patch(`/api/units/${unit.id}/service`, { serviceId: w.service.id })).status, 200);
  assert.equal((await w.lead.api.patch(`/api/units/${unit.id}/production`, { priority: "HIGH" })).status, 200);
  const mat = await createTestMaterial({ name: `Drift ${++seq}` }); await seedBalance(mat.id, 5);
  assert.equal((await w.corner.api.post(`/api/units/${unit.id}/materials`, { materialId: mat.id, qty: 1 })).status, 201);
  assert.equal(await markers(), 3, "satu penanda per aksi V1 yang berhasil");
  const failed = await w.lead.api.patch(`/api/units/${unit.id}/service`, { serviceId: w.service.id, expectedServiceId: null }); // CAS usang -> 409, TIDAK menulis penanda (transaksi rollback)
  assert.equal(failed.status, 409); assert.equal(await markers(), 3, "mutasi V1 yang gagal tidak meninggalkan penanda (satu transaksi)");
  const mk = await testPrisma.activityEvent.findFirstOrThrow({ where: { entityId: unit.id, eventType: "PRODUCTION_V1_WRITE_ON_V2_RUN" } });
  assert.equal(mk.metadata.runId, run.id);

  // (c) writer ON kembali: seluruh command V2 yang menyentuh Run berhenti 409 PRODUCTION_RUN_V1_DRIFT; proyeksi V2 TIDAK berubah satu byte pun.
  await addCohort(unit.id);
  const drift = (r, label) => { assert.equal(r.status, 409, `${label}: ${JSON.stringify(r.body)}`); assert.equal(r.body.code, "PRODUCTION_RUN_V1_DRIFT", label); assert.equal(r.body.details?.count ?? r.body.count, 3, label); };
  drift(await step(w, w.nadya, run.id, 5, { payload: DIAG }), "langkah tahap 5");
  const plan = (await w.lead.api.get(`${P}/plans/${planned.planId}`)).body;
  drift(await w.lead.api.post(`${P}/plans/${planned.planId}/bom`, { lines: [{ materialId: w.fondasi.id, qty: 1 }], expectedRevision: plan.revision }, key(`drift-bom-${++seq}`)), "BOM rencana");
  drift(await w.nadya.api.post(`${V2}/diagnosis/${run.id}/draft`, { expectedRevision: 0, workCenterId: w.wc, findings: {}, photoUrls: [] }), "draft diagnosis");
  assert.deepEqual(await projection(), P0, "proyeksi V2 tidak berubah: tidak ada lanjutan diam-diam");
  const ov = (await w.lead.api.get(`${V2}/units/${unit.id}/overview`)).body;
  assert.equal(ov.ownership.v2ExecutionOwned, true); assert.equal(ov.ownership.v1Drift.count, 3, "Unit 360 menampilkan drift");
  assert.equal((await w.lead.api.patch(`/api/units/${unit.id}/service`, { serviceId: w.service.id })).status, 409, "V1 kembali ditolak karena V2 memiliki unit lagi");

  // (d) rekonsiliasi = batalkan Run (command resmi, tidak memakai gerbang drift). Setelah itu V2 tidak memiliki unit: V1 bekerja lagi tanpa penanda baru.
  const cancel = await w.lead.api.post(`${P}/qc/runs/${run.id}/cancel`, { expectedRevision: (await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).revision, reason: "Rekonsiliasi drift V1 setelah rollback writer" }, key(`drift-cancel-${++seq}`));
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).status, "CANCELLED");
  assert.equal((await w.lead.api.patch(`/api/units/${unit.id}/production`, { priority: "NORMAL" })).status, 200);
  assert.equal(await markers(), 3, "Run terminal: aksi V1 tidak lagi menandai drift");
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Fase 3 LAYANAN — PIC Bahan per pekerjaan memakai command & tabel yang SAMA dengan jalur pengerjaan; pemakaian aktual satu sumber; tanpa stok ganda.
// ---------------------------------------------------------------------------------------------------------------------------------------------------
test("Fase 3 LAYANAN: PIC Bahan ditugaskan per pekerjaan; pemakaian aktual hanya dari bahan yang diserahkan; tidak ganda dengan bukti Meja; stok tidak bergerak; SEWA ditolak", async () => {
  const w = await world();
  const febriU = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  const febri = { ...febriU, api: makeClient(server.baseUrl, febriU.token) };
  const febriOp = await testPrisma.productionOperator.create({ data: { userId: febri.user.id, primaryWorkCenterId: w.wc } });
  const { unit, run } = await acceptedUnit(w);
  const planned = await planOnBoard(w, run.id, { station: "TABLE_1", corner: false });
  await throughIntake(w, run.id);
  ok(await step(w, w.nadya, run.id, 5, { payload: DIAG }));
  const diagPhoto = (await media(w.nadya, run.id, "i"))[0];
  const diag = await w.nadya.api.post(`${V2}/diagnosis/${run.id}/submit`, {
    expectedRevision: 0, workCenterId: w.wc, photoUrls: [diagPhoto], recommendedServiceId: w.service.id,
    findings: { general: { condition: "Kasur kempes", mainDamage: "Fondasi keropos", damageLevel: "SEDANG", teardownNote: "Per karatan" }, foundation: { oldCondition: "Per karatan", action: "REPLACE", size: "180x200", qty: "1" }, layers: [{ oldCondition: "Busa tipis", action: "REPLACE", material: "Busa HD", thickness: "5cm", qty: "2" }], components: { spring: "Ganti per baru" }, serviceNote: "Restorasi penuh fondasi dan lapisan atas sesuai keluhan sakit pinggang" },
    materials: [{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.lapisan.id, qty: 2 }],
  }, key(`diag-${++seq}`));
  assert.equal(diag.status, 201, JSON.stringify(diag.body));
  const issueId = await setBomAndIssue(w, planned.planId);
  ok(await step(w, w.nadya, run.id, 5, {})); // lanjutkan diagnosa; modul fondasi menunggu bahan
  await pick(w, issueId);
  const movesAtIssue = await testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "ISSUE" } });
  ok(await step(w, w.nadya, run.id, 6, {})); // mulai modul fondasi

  // Penugasan: hanya izin penjadwalan; operator harus sah. Unit LAYANAN sebelum punya PIC Bahan = perilaku lama (tidak ada blok).
  let c = await card(w, run.id);
  assert.equal(c.materialPic, null, "belum ada PIC Bahan"); assert.equal(c.track, "RESTORATION");
  assert.equal((await w.nadya.api.post(`${V2}/runs/${run.id}/build/material-operator`, { operatorId: febriOp.id, expectedRevision: c.revision }, key("as-nadya"))).status, 403);
  const assigned = ok(await w.lead.api.post(`${V2}/runs/${run.id}/build/material-operator`, { operatorId: febriOp.id, expectedRevision: c.revision }, key("as-febri")));
  assert.equal(assigned.changed, true); assert.equal(assigned.materialOperator.id, febriOp.id);
  c = await card(w, run.id);
  assert.equal(c.materialPic.materialOperator.id, febriOp.id); assert.equal(c.materialPic.usageRecorded, false);
  assert.deepEqual([c.next.action, c.next.wait, c.next.actor], ["WAIT", "USAGE_NOT_RECORDED", "MATERIAL_PIC"], "Meja menunggu pemakaian bahan dicatat PIC Bahan");
  const blocked = await step(w, w.nadya, run.id, 6, { payload: { note: "isi fondasi", materials: [{ materialId: w.fondasi.id, qty: 1 }] }, media: await media(w.nadya, run.id, "v") });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, "STEP_WAITING_USAGE_NOT_RECORDED");

  // Antrean PIC Bahan memuat pekerjaan LAYANAN ini hanya untuk Febri.
  const q = ok(await febri.api.get(`${V2}/worker/material`));
  assert.deepEqual(q.items.map((i) => i.runId), [run.id]); assert.equal(q.items[0].track, "RESTORATION");
  assert.deepEqual(ok(await w.corner.api.get(`${V2}/worker/material`)).items, [], "bukan PIC Bahan pekerjaan ini");

  // Pemakaian aktual: otorisasi PIC; racikan teks ditolak (racikan LAYANAN ada di Catatan Komponen); tidak boleh melebihi yang diserahkan; stok tidak bergerak.
  const rec = (who, rev, b, k = key("rec")) => who.api.post(`${V2}/runs/${run.id}/build/materials`, { expectedRevision: rev, ...b }, k);
  const rev = (await card(w, run.id)).revision;
  assert.equal((await rec(w.nadya, rev, { materials: [{ materialId: w.fondasi.id, qty: 1 }] })).status, 403, "bukan PIC Bahan");
  const rac = await rec(febri, rev, { racikan: { fondasi: "pocket spring baru", lapisan: "latex" } }); assert.equal(rac.status, 422); assert.equal(rac.body.code, "BUILD_RACIKAN_NOT_APPLICABLE_LAYANAN");
  const over = await rec(febri, rev, { materials: [{ materialId: w.fondasi.id, qty: 5 }] }); assert.equal(over.status, 422);
  const good = ok(await rec(febri, rev, { materials: [{ materialId: w.fondasi.id, qty: 1 }], note: "dipakai untuk fondasi" }));
  assert.equal(good.changed, true);
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "ISSUE" } }), movesAtIssue, "mencatat pemakaian TIDAK menulis stok keluar (hanya Gudang saat menyerahkan)");
  c = await card(w, run.id);
  assert.equal(c.materialPic.usageRecorded, true); assert.equal(c.materialPic.record.materials[0].qty, 1);
  assert.equal(c.next.action, "COMPLETE", "Meja boleh menutup tahap 6 setelah PIC Bahan mencatat");

  // Tidak ganda: bukti Meja tidak boleh memuat bahan lagi (satu sumber); tahap 6/7 tanpa bahan sah.
  const dup = await step(w, w.nadya, run.id, 6, { payload: { note: "isi fondasi", materials: [{ materialId: w.fondasi.id, qty: 1 }] }, media: await media(w.nadya, run.id, "v") });
  assert.equal(dup.status, 409); assert.equal(dup.body.code, "STEP_MATERIAL_BY_MATERIAL_PIC");
  const s6 = ok(await step(w, w.nadya, run.id, 6, { payload: { note: "Pocket spring baru dipasang" }, media: await media(w.nadya, run.id, "v") }));
  assert.equal(s6.next.stepNo, 7);
  const dup7 = await step(w, w.nadya, run.id, 7, { payload: { materials: [{ materialId: w.lapisan.id, qty: 1 }] }, media: await media(w.nadya, run.id, "i") });
  assert.equal(dup7.status, 409); assert.equal(dup7.body.code, "STEP_MATERIAL_BY_MATERIAL_PIC");
  ok(await step(w, w.nadya, run.id, 7, { payload: {}, media: await media(w.nadya, run.id, "i") }));
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "ISSUE" } }), movesAtIssue, "stok keluar tidak ganda");

  // Sisa = diserahkan - pemakaian PIC (tidak dihitung dua kali): fondasi 1 diserahkan, 1 dipakai -> tanpa sisa; lapisan 2 diserahkan, 0 tercatat -> sisa 2.
  const { computeRunLeftovers } = await import("../../src/services/productionMaterialReturnService.js");
  const left = await computeRunLeftovers(testPrisma, await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } }));
  const leftOf = (id) => Number((left || []).find((l) => l.materialId === id)?.leftoverQty ?? (left || []).find((l) => l.materialId === id)?.qty ?? 0);
  assert.equal(leftOf(w.fondasi.id), 0, "pemakaian fondasi hanya dihitung sekali"); assert.equal(leftOf(w.lapisan.id), 2);

  // SEWA tidak termasuk.
  const sewaOrder = await testPrisma.order.create({ data: { customerId: (await testPrisma.customer.create({ data: { name: "Sewa 1" } })).id, orderNumber: `SW-${++seq}`, value: 1, category: "SEWA", status: "PROCESSING" } });
  const sewaUnit = await testPrisma.unit.create({ data: { unitCode: `SW-${seq}-U1`, orderId: sewaOrder.id, seq: 1, status: "RECEIVED" } });
  await addCohort(sewaUnit.id);
  const sp = await w.lead.api.post(`${V2}/plans`, { unitId: sewaUnit.id, productionDate: DATE, stationCode: "TABLE_2", priority: 0, workCenterId: w.wc, operatorId: w.nadyaOp.id }, key("sewa"));
  assert.equal(sp.status, 201, JSON.stringify(sp.body));
  const sRun = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: sewaUnit.id } });
  const sAssign = await w.lead.api.post(`${V2}/runs/${sRun.id}/build/material-operator`, { operatorId: febriOp.id, expectedRevision: (await card(w, sRun.id)).revision }, key("sewa-as"));
  assert.equal(sAssign.status, 409); assert.equal(sAssign.body.code, "BUILD_NOT_APPLICABLE");
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Fase 3 LAYANAN — rencana bahan (BOM) oleh PIC Bahan yang DITUGASKAN: command planning yang sama, otorisasi per pekerjaan, revisi/idempotensi, tanpa akses luas.
// ---------------------------------------------------------------------------------------------------------------------------------------------------
test("Fase 3 LAYANAN: PIC Bahan mengisi & merevisi BOM rencana lewat command planning yang sama; non-PIC/Lead/Gudang ditolak; revisi basi 409; replay idempoten; terkunci setelah serah; tanpa stok", async () => {
  const w = await world();
  const febriU = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); const febri = { ...febriU, api: makeClient(server.baseUrl, febriU.token) };
  const ferdyU = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); const ferdy = { ...ferdyU, api: makeClient(server.baseUrl, ferdyU.token) };
  const febriOp = await testPrisma.productionOperator.create({ data: { userId: febri.user.id, primaryWorkCenterId: w.wc } });
  await testPrisma.productionOperator.create({ data: { userId: ferdy.user.id, primaryWorkCenterId: w.wc } });
  const adminU = await createTestUser({ roles: ["ADMIN"] }); const admin = { ...adminU, api: makeClient(server.baseUrl, adminU.token) };
  const { unit, run } = await acceptedUnit(w);
  const planned = await planOnBoard(w, run.id, { station: "TABLE_1", corner: false });
  await throughIntake(w, run.id);
  ok(await step(w, w.nadya, run.id, 5, { payload: DIAG }));
  const diagPhoto = (await media(w.nadya, run.id, "i"))[0];
  const diag = await w.nadya.api.post(`${V2}/diagnosis/${run.id}/submit`, {
    expectedRevision: 0, workCenterId: w.wc, photoUrls: [diagPhoto], recommendedServiceId: w.service.id,
    findings: { general: { condition: "Kasur kempes", mainDamage: "Fondasi keropos", damageLevel: "SEDANG", teardownNote: "Per karatan" }, foundation: { oldCondition: "Per karatan", action: "REPLACE", size: "180x200", qty: "1" }, layers: [{ oldCondition: "Busa tipis", action: "REPLACE", material: "Busa HD", thickness: "5cm", qty: "2" }], components: { spring: "Ganti per baru" }, serviceNote: "Restorasi penuh fondasi dan lapisan atas sesuai keluhan sakit pinggang" },
    materials: [{ materialId: w.fondasi.id, qty: 1 }],
  }, key(`diag-${++seq}`));
  assert.equal(diag.status, 201, JSON.stringify(diag.body));
  const url = `${V2}/runs/${run.id}/build/plan-bom`;
  const planRev = async () => (await card(w, run.id)).plan.revision;
  const movesAt = () => testPrisma.stockMovement.count({ where: { unitId: unit.id } });
  const m0 = await movesAt();

  // belum ada PIC Bahan -> semua ditolak (kecuali ADMIN/OWNER lewat izin lintas-lini yang sudah ada)
  const noPic = await febri.api.post(url, { expectedRevision: await planRev(), lines: [{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.lapisan.id, qty: 2 }] }, key("nopic"));
  assert.equal(noPic.status, 403); assert.equal(noPic.body.code, "BUILD_NO_MATERIAL_OPERATOR");
  const c0 = await card(w, run.id);
  ok(await w.lead.api.post(`${V2}/runs/${run.id}/build/material-operator`, { operatorId: febriOp.id, expectedRevision: c0.revision }, key("as")));

  // akses TIDAK diperluas: Lead, Gudang/Meja, dan PIC Bahan pekerjaan lain ditolak di endpoint ini
  const body = (rev, lines) => ({ expectedRevision: rev, lines });
  for (const [who, tag] of [[w.lead, "lead"], [w.nadya, "gudang-meja"], [ferdy, "pic-lain"]]) {
    const r = await who.api.post(url, body(await planRev(), [{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.lapisan.id, qty: 2 }]), key(tag));
    assert.equal(r.status, 403, `${tag}: ${JSON.stringify(r.body)}`); assert.equal(r.body.code, "BUILD_MATERIAL_OPERATOR_MISMATCH");
  }
  assert.equal((await card(w, run.id)).bom.length, 1, "penolakan tanpa efek");

  // PIC yang ditugaskan: isi BOM (tambah bahan ke-2) -> revisi rencana naik; baris lama tetap, baris baru aktif
  const rev1 = await planRev();
  const k1 = key("ok1");
  const r1 = await febri.api.post(url, body(rev1, [{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.lapisan.id, qty: 2 }]), k1);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const replay = await febri.api.post(url, body(rev1, [{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.lapisan.id, qty: 2 }]), k1);
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true, "replay idempoten (kunci sama)");
  assert.equal(await testPrisma.plannedBOMLine.count({ where: { planId: planned.planId, status: "ACTIVE" } }), 2);
  const stale = await febri.api.post(url, body(rev1, [{ materialId: w.fondasi.id, qty: 3 }]), key("stale"));
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "PLAN_REVISION_CONFLICT", "revisi rencana basi ditolak");
  const diffKey = await febri.api.post(url, body(rev1, [{ materialId: w.fondasi.id, qty: 9 }]), k1);
  assert.equal(diffKey.status, 409); assert.equal(diffKey.body.code, "IDEMPOTENCY_CONFLICT", "kunci sama + isi beda = ditolak");

  // revisi: qty fondasi 1 -> 2, lapisan dibuang; baris lama SUPERSEDED (histori), tanpa stok
  const r2 = await febri.api.post(url, body(await planRev(), [{ materialId: w.fondasi.id, qty: 2 }]), key("rev2"));
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  const active = await testPrisma.plannedBOMLine.findMany({ where: { planId: planned.planId, status: "ACTIVE" } });
  assert.deepEqual(active.map((l) => [l.materialId, Number(l.qty)]), [[w.fondasi.id, 2]]);
  assert.ok(await testPrisma.plannedBOMLine.count({ where: { planId: planned.planId, status: "SUPERSEDED" } }) >= 2, "histori BOM dipertahankan");
  const bad = await febri.api.post(url, body(await planRev(), [{ materialId: w.fondasi.id, qty: 0 }]), key("zero")); assert.equal(bad.status, 400);
  const dup = await febri.api.post(url, body(await planRev(), [{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.fondasi.id, qty: 1 }]), key("dup")); assert.equal(dup.status, 400);
  assert.equal(await movesAt(), m0, "menyimpan rencana bahan TIDAK mengeluarkan stok");
  assert.equal(await testPrisma.materialReservation.count({ where: { planId: planned.planId } }), 0, "tidak ada reservasi dari PIC Bahan");

  // ADMIN lewat izin lintas-lini yang sudah ada tetap boleh (tidak diubah)
  assert.equal((await admin.api.post(url, body(await planRev(), [{ materialId: w.fondasi.id, qty: 2 }, { materialId: w.lapisan.id, qty: 1 }]), key("admin"))).status, 200);
  // Gudang mereservasi & menyerahkan -> BOM terkunci untuk PIC Bahan (command planning menolak)
  const plan = (await w.lead.api.get(`${P}/plans/${planned.planId}`)).body;
  const reserve = ok(await w.nadya.api.post(`${P}/plans/${planned.planId}/reserve`, { expectedRevision: plan.revision }, key("res")));
  assert.equal(reserve.status, "MATERIAL_RESERVED");
  const req = await w.nadya.api.post(`${P}/plans/${planned.planId}/material-request`, {}, key("mr")); assert.equal(req.status, 201);
  const locked = await febri.api.post(url, body(await planRev(), [{ materialId: w.fondasi.id, qty: 5 }]), key("locked"));
  assert.equal(locked.status, 409); assert.equal(locked.body.code, "PLAN_MATERIAL_ISSUE_ACTIVE");
  await pick(w, req.body.issueId);
  const locked2 = await febri.api.post(url, body(await planRev(), [{ materialId: w.fondasi.id, qty: 5 }]), key("locked2"));
  assert.equal(locked2.status, 409); assert.equal(locked2.body.code, "PLAN_MATERIAL_ALREADY_ISSUED");
  // rantai: BOM rencana, diserahkan, dipakai TERPISAH tapi tertaut lewat kartu (tanpa stok baru saat mencatat pemakaian)
  const issuedMoves = await testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "ISSUE" } });
  const cd = await card(w, run.id);
  assert.deepEqual(cd.bom.map((b) => [b.materialId, b.qty]).sort(), [[w.fondasi.id, 2], [w.lapisan.id, 1]].sort());
  assert.deepEqual(cd.issuedMaterials.map((i) => i.materialId).sort(), [w.fondasi.id, w.lapisan.id].sort(), "diserahkan = yang direservasi/dipick");
  const used = await febri.api.post(`${V2}/runs/${run.id}/build/materials`, { expectedRevision: cd.revision, materials: [{ materialId: w.fondasi.id, qty: 1 }] }, key("used"));
  assert.equal(used.status, 200, JSON.stringify(used.body));
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "ISSUE" } }), issuedMoves, "stok keluar tepat sekali (Gudang), tidak ganda");
  const cf = await card(w, run.id);
  assert.equal(cf.materialPic.record.materials[0].qty, 1); assert.equal(cf.bom.length, 2);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Fase 4 LAYANAN — perakitan fondasi & lapisan -> uji PIC QC -> serah ke gerbang QC (Run V2). HTTP + DB sungguhan.
// ---------------------------------------------------------------------------------------------------------------------------------------------------
async function toModuleStart(w, { v2 = true, service = null, corner = false } = {}) {
  const { unit, run } = await acceptedUnit(w, { v2 });
  const svc = service ? await testPrisma.serviceCatalog.findUniqueOrThrow({ where: { code: service } }) : w.service;
  const planned = await planOnBoard(w, run.id, { station: "TABLE_1", corner });
  await throughIntake(w, run.id);
  ok(await step(w, w.nadya, run.id, 5, { payload: DIAG }));
  const diagPhoto = (await media(w.nadya, run.id, "i"))[0];
  const diag = await w.nadya.api.post(`${V2}/diagnosis/${run.id}/submit`, {
    expectedRevision: 0, workCenterId: w.wc, photoUrls: [diagPhoto], recommendedServiceId: svc.id,
    findings: { general: { condition: "Kasur kempes", mainDamage: "Fondasi keropos", damageLevel: "SEDANG", teardownNote: "Per karatan" }, foundation: { oldCondition: "Per karatan", action: "REPLACE", size: "180x200", qty: "1" }, layers: [{ oldCondition: "Busa tipis", action: "REPLACE", material: "Busa HD", thickness: "5cm", qty: "2" }], components: { spring: "Ganti per baru" }, serviceNote: "Restorasi penuh fondasi dan lapisan atas sesuai keluhan sakit pinggang" },
    materials: [{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.lapisan.id, qty: 2 }],
  }, key(`diag-${++seq}`));
  assert.equal(diag.status, 201, JSON.stringify(diag.body));
  const issueId = await setBomAndIssue(w, planned.planId);
  ok(await step(w, w.nadya, run.id, 5, {}));
  await pick(w, issueId);
  const first = await card(w, run.id);
  ok(await step(w, w.nadya, run.id, first.next.stepNo, {})); // mulai modul pertama sesuai jenis racikan (6 fondasi / 7 lapisan)
  return { unit, run, planned, startStep: first.next.stepNo };
}
const cn = (who, unitId, sec, body) => who.api.post(`${V2}/component-notes/units/${unitId}/sections/${sec}`, body, key(`cn-${sec}-${++seq}`));
const notesOf = async (who, unitId) => { const r = await who.api.get(`${V2}/component-notes/units/${unitId}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const stockCounts = async (unitId) => ({ all: await testPrisma.stockMovement.count({ where: { unitId } }), issue: await testPrisma.stockMovement.count({ where: { unitId, type: "ISSUE" } }), ret: await testPrisma.productionMaterialReturn.count({}), bom: await testPrisma.plannedBOMLine.count({}), res: await testPrisma.materialReservation.count({}) });

test("Fase 4: perakitan V2 — Meja rakit fondasi → PIC QC uji fondasi baru → Meja hasil aktual+lapisan → PIC QC uji kasur jadi → Meja lanjut ke gerbang QC; perbedaan dari rencana wajib beralasan; tanpa stok tambahan", async () => {
  const w = await world();
  const { unit, run } = await toModuleStart(w);
  assert.equal((await card(w, run.id)).qcGatePolicy, "QC_GATE_V2");
  // racikan rencana (Fase 3): fondasi diganti + 2 lapisan atas->bawah
  const plan = await cn(w.nadya, unit.id, "PLAN_RACIKAN", { expectedVersion: 0, media: [], data: { foundation: { action: "REPLACE", system: "BONNELL", material: { kind: "MANUAL", text: "Pocket spring 25 cm" } }, layers: [{ action: "REPLACE", material: { kind: "MANUAL", text: "Latex 3 cm" }, thicknessCm: 3 }, { action: "REPLACE", material: { kind: "MANUAL", text: "Busa HD D44" }, thicknessCm: 5 }] } });
  assert.equal(plan.status, 201, JSON.stringify(plan.body));
  const s0 = await stockCounts(unit.id);

  // 1) Meja merakit fondasi (tahap 6): bukti tersimpan -> tahap 7 mulai, TAPI menunggu uji fondasi baru PIC QC
  ok(await step(w, w.nadya, run.id, 6, { payload: { note: "Pocket spring baru dipasang", materials: [{ materialId: w.fondasi.id, qty: 1 }] }, media: await media(w.nadya, run.id, "v") }));
  let c = await card(w, run.id);
  assert.deepEqual([c.next.action, c.next.wait, c.next.actor, c.next.stepNo], ["WAIT", "FOUNDATION_NEW_TEST_PENDING", "QC", 7]);
  const early7 = await step(w, w.nadya, run.id, 7, { payload: { materials: [{ materialId: w.lapisan.id, qty: 2 }] }, media: await media(w.nadya, run.id, "i") });
  assert.equal(early7.status, 409); assert.equal(early7.body.code, "STEP_WAITING_FOUNDATION_NEW_TEST_PENDING");
  const queue = ok(await w.qc.api.get(`${V2}/component-notes/qc-queue`));
  assert.deepEqual(queue.items.filter((i) => i.unitId === unit.id).map((i) => i.section), ["FOUNDATION_TEST_AFTER"]);
  // izin: hanya PIC QC menulis uji (Meja/Lead/Dokumentasi/Sales 403)
  const body = { expectedVersion: 0, data: PT.FOUNDATION_AFTER, media: await PT.uploadVideo(server, w.qc, unit.id) };
  assert.equal((await cn(w.nadya, unit.id, "FOUNDATION_TEST_AFTER", body)).status, 403); assert.equal((await cn(w.lead, unit.id, "FOUNDATION_TEST_AFTER", body)).status, 403);

  // 2) PIC QC: validasi (berat penguji wajib, dibebani <= tanpa beban, media wajib) lalu simpan; penurunan dihitung SERVER
  const bad1 = await cn(w.qc, unit.id, "FOUNDATION_TEST_AFTER", { ...body, data: { ...PT.FOUNDATION_AFTER, testerWeightKg: undefined } }); assert.equal(bad1.status, 422); assert.equal(bad1.body.code, "COMPONENT_TESTER_WEIGHT_REQUIRED");
  const bad2 = await cn(w.qc, unit.id, "FOUNDATION_TEST_AFTER", { ...body, data: { ...PT.FOUNDATION_AFTER, loadedHeightCm: 27 } }); assert.equal(bad2.body.code, "COMPONENT_LOADED_TALLER");
  const bad3 = await cn(w.qc, unit.id, "FOUNDATION_TEST_AFTER", { ...body, media: [] }); assert.equal(bad3.body.code, "COMPONENT_MEDIA_REQUIRED");
  const ft = await cn(w.qc, unit.id, "FOUNDATION_TEST_AFTER", { ...body, data: { ...PT.FOUNDATION_AFTER, dropCm: 99 } }); assert.equal(ft.status, 201, JSON.stringify(ft.body));
  let n = await notesOf(w.qc, unit.id);
  assert.equal(n.measurements.foundationAfter.dropCm, 2, "25 − 23 = 2 (nilai klien 99 diabaikan)");
  // sebanding: metode ditandai sama + berat 75 vs 75 -> selisih dihitung; kasur utuh & fondasi TIDAK dijumlahkan
  assert.equal(n.measurements.comparisons.foundation.comparable, true); assert.equal(n.measurements.comparisons.foundation.differenceCm, 8);
  assert.equal(n.measurements.combinedEstimate, null); assert.doesNotMatch(JSON.stringify(n.measurements), /"total(Drop|Penurunan)"|"sum"|"category"|"kategori"/i, "tanpa penjumlahan & tanpa kategori otomatis (kata bebas PIC QC tidak dihitung)");
  // berat penguji beda TETAPI PIC QC mengonfirmasi sebanding -> selisih tetap tampil (tanpa ambang berat otomatis)
  const ft2 = await cn(w.qc, unit.id, "FOUNDATION_TEST_AFTER", { expectedVersion: 1, reason: "Penguji berbeda", data: { ...PT.FOUNDATION_AFTER, testerWeightKg: 60 }, media: await PT.uploadVideo(server, w.qc, unit.id) }); assert.equal(ft2.status, 201);
  n = await notesOf(w.qc, unit.id); const cmpF = n.measurements.comparisons.foundation;
  assert.deepEqual([cmpF.comparable, cmpF.differenceCm, cmpF.beforeDropCm, cmpF.afterDropCm], [true, 8, 10, 2], "dikonfirmasi sebanding -> selisih tampil walau berat beda"); assert.match(cmpF.text, /dikonfirmasi PIC QC.*berat penguji berbeda/);
  // belum dikonfirmasi (sameMethodAsBefore=false) -> DUA angka mentah + alasan, tanpa selisih, walau berat sama
  const ft3 = await cn(w.qc, unit.id, "FOUNDATION_TEST_AFTER", { expectedVersion: 2, reason: "Metode berbeda", data: { ...PT.FOUNDATION_AFTER, sameMethodAsBefore: false }, media: await PT.uploadVideo(server, w.qc, unit.id) }); assert.equal(ft3.status, 201);
  const cmp3 = (await notesOf(w.qc, unit.id)).measurements.comparisons.foundation;
  assert.deepEqual([cmp3.comparable, cmp3.differenceCm, cmp3.reasons, cmp3.beforeDropCm, cmp3.afterDropCm], [false, null, ["METODE_BELUM_DIKONFIRMASI_SEBANDING"], 10, 2]); assert.match(cmp3.text, /belum valid.*PIC QC belum mengonfirmasi metode pengujian sebanding.*tanpa selisih/);
  // konflik versi + replay idempoten + tanpa perubahan
  const stale = await cn(w.qc, unit.id, "FOUNDATION_TEST_AFTER", { expectedVersion: 1, reason: "basi", data: PT.FOUNDATION_AFTER, media: await PT.uploadVideo(server, w.qc, unit.id) }); assert.equal(stale.status, 409); assert.equal(stale.body.code, "COMPONENT_VERSION_CONFLICT");
  const rk = key("rep"); const repBody = { expectedVersion: 3, reason: "Kembalikan metode sama", data: PT.FOUNDATION_AFTER, media: await PT.uploadVideo(server, w.qc, unit.id) };
  const r1 = await w.qc.api.post(`${V2}/component-notes/units/${unit.id}/sections/FOUNDATION_TEST_AFTER`, repBody, rk); const r2 = await w.qc.api.post(`${V2}/component-notes/units/${unit.id}/sections/FOUNDATION_TEST_AFTER`, repBody, rk);
  assert.deepEqual([r1.status, r2.status, r2.body.replayed, r2.body.version], [201, 200, true, 4]);
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: unit.id, section: "FOUNDATION_TEST_AFTER" } }), 4, "riwayat berversi 1..4, tanpa ganda");

  // 3) Meja: tahap 7 butuh hasil aktual (AFTER) dulu; hasil yang BEDA dari rencana wajib beralasan
  c = await card(w, run.id); assert.deepEqual([c.next.action, c.next.gated, c.next.layersAfterRequired], ["EVIDENCE", true, true]);
  const need = await step(w, w.nadya, run.id, 7, { payload: { materials: [{ materialId: w.lapisan.id, qty: 2 }] }, media: await media(w.nadya, run.id, "i") }); assert.equal(need.status, 409); assert.equal(need.body.code, "STEP_AFTER_REQUIRED");
  const beda = { foundation: { action: "REPLACE", system: "BONNELL", material: { kind: "MANUAL", text: "Pocket spring 25 cm" } }, layers: [{ action: "REPLACE", material: { kind: "MANUAL", text: "Latex 3 cm" }, thicknessCm: 3 }, { action: "REPLACE", material: { kind: "MANUAL", text: "Busa HD D44" }, thicknessCm: 4 }] };
  const noWhy = await cn(w.nadya, unit.id, "AFTER", { expectedVersion: 0, data: beda, media: [] }); assert.equal(noWhy.status, 422); assert.equal(noWhy.body.code, "COMPONENT_DEVIATION_REASON_REQUIRED"); assert.equal(noWhy.body.details.items[0].part, "LAPISAN_2");
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: unit.id, section: "AFTER" } }), 0);
  assert.equal((await cn(w.qc, unit.id, "AFTER", { expectedVersion: 0, data: { ...beda, deviationNote: "Busa D44 5 cm habis" }, media: [] })).status, 201, "pemegang izin tulis komponen boleh mencatat hasil aktual (dengan alasan perbedaan); tidak diperluas ke role lain");
  assert.equal((await cn(w.driver, unit.id, "AFTER", { expectedVersion: 1, reason: "x", data: beda, media: [] })).status, 403, "role tanpa izin komponen (Driver) tidak menulis");
  // koreksi beralasan oleh Meja: versi 2 = alasan perbedaan; rencana TIDAK ditimpa
  const fix = await cn(w.nadya, unit.id, "AFTER", { expectedVersion: 1, reason: "Tambah alasan perbedaan", data: { ...beda, deviationNote: "Busa D44 5 cm habis; dipakai 4 cm" }, media: [] }); assert.equal(fix.status, 201, JSON.stringify(fix.body));
  n = await notesOf(w.nadya, unit.id);
  assert.equal(n.sections.PLAN_RACIKAN.version, 1, "rencana tetap v1"); assert.equal(n.sections.AFTER.version, 2); assert.equal(n.sections.AFTER.data.deviationNote, "Busa D44 5 cm habis; dipakai 4 cm");
  assert.equal(n.comparison.planVsActual.available, true); assert.equal(n.comparison.planVsActual.total.differenceCm, -1); assert.deepEqual(n.comparison.planVsActual.layers.map((l) => l.status), ["SAMA", "BERBEDA"]);
  // bukti tahap 7 menaut versi AFTER (tanpa menyalin)
  const s7 = ok(await step(w, w.nadya, run.id, 7, { payload: { materials: [{ materialId: w.lapisan.id, qty: 2 }] }, media: await media(w.nadya, run.id, "i") }));
  assert.deepEqual((await testPrisma.productionStepEvidence.findFirstOrThrow({ where: { runId: run.id, stepNo: 7, NOT: { stepCode: { startsWith: "DOC_" } } }, orderBy: { version: "desc" } })).payload.afterRef, { section: "AFTER", version: 2 });
  c = await card(w, run.id); assert.deepEqual([c.next.action, c.next.wait, c.next.stepNo], ["WAIT", "FINISHED_TEST_PENDING", 8]);
  const early8 = await step(w, w.nadya, run.id, 8, { payload: { verdict: "PAS", testerWeightKg: 85 }, media: await media(w.nadya, run.id, "v") }); assert.equal(early8.status, 409); assert.equal(early8.body.code, "STEP_WAITING_FINISHED_TEST_PENDING", "uji tekstur Meja tidak dipakai di jalur ini");

  // 4) PIC QC uji kasur jadi (feel, kesesuaian keluhan, berat aktual, metode, penurunan kasur utuh)
  assert.deepEqual((await w.qc.api.get(`${V2}/component-notes/qc-queue`)).body.items.filter((i) => i.unitId === unit.id).map((i) => i.section), ["WHOLE_TEST_AFTER"]);
  const wb = (over = {}) => ({ expectedVersion: 0, data: { ...PT.WHOLE_AFTER, ...over }, media: [] });
  const w1 = await cn(w.qc, unit.id, "WHOLE_TEST_AFTER", { ...wb(), media: [] }); assert.equal(w1.body.code, "COMPONENT_MEDIA_REQUIRED");
  assert.equal((await cn(w.qc, unit.id, "WHOLE_TEST_AFTER", { ...wb({ qcInFrame: false }), media: await PT.uploadVideo(server, w.qc, unit.id) })).body.code, "COMPONENT_QC_IN_FRAME_REQUIRED");
  assert.equal((await cn(w.nadya, unit.id, "WHOLE_TEST_AFTER", { ...wb(), media: await PT.uploadVideo(server, w.qc, unit.id) })).status, 403);
  const wt = await cn(w.qc, unit.id, "WHOLE_TEST_AFTER", { ...wb(), media: await PT.uploadVideo(server, w.qc, unit.id) }); assert.equal(wt.status, 201, JSON.stringify(wt.body));
  n = await notesOf(w.qc, unit.id);
  assert.deepEqual([n.measurements.wholeAfter.wholeDropCm, n.measurements.comparisons.whole.comparable, n.measurements.comparisons.whole.differenceCm], [1, true, 3], "kasur utuh awal 4 cm -> 1 cm (berat & metode sama)");
  assert.equal(n.measurements.foundationAfter.dropCm, 2, "penurunan fondasi dan kasur utuh terpisah, tidak dijumlahkan (2 vs 1)");
  // 5) Meja menyerahkan ke gerbang QC (tanpa isian); bukti menaut versi catatan QC
  c = await card(w, run.id); assert.deepEqual([c.next.action, c.next.continueOnly, c.next.qcRecorded, c.next.stepNo], ["TEST", true, true, 8]);
  const s8 = ok(await step(w, w.nadya, run.id, 8, {}));
  assert.deepEqual((await testPrisma.productionStepEvidence.findFirstOrThrow({ where: { runId: run.id, stepNo: 8 }, orderBy: { version: "desc" } })).payload, { qcRef: { section: "WHOLE_TEST_AFTER", version: 1 } });
  c = await card(w, run.id); assert.equal(c.next.wait, "AWAITING_QC"); assert.equal(s8.next.wait, "AWAITING_QC");
  // antrean PIC QC: putusan QC (jalur yang ada) muncul sebagai tautan
  assert.deepEqual((await w.qc.api.get(`${V2}/component-notes/qc-queue`)).body.items.filter((i) => i.unitId === unit.id).map((i) => i.section), ["QC_DECISION"]);

  // 6) Efek bahan: rencana/rakitan/uji TIDAK menambah pergerakan stok, BOM, reservasi, atau retur
  const s1 = await stockCounts(unit.id);
  assert.deepEqual(s1, s0, "tanpa stock movement/BOM/reservasi/retur tambahan dari rakit, uji, hasil aktual");
  const cd = await card(w, run.id);
  assert.deepEqual(cd.bom.map((b) => [b.materialId, b.qty]).sort(), [[w.fondasi.id, 1], [w.lapisan.id, 2]].sort(), "BOM rencana tertaut ke unit");
  assert.deepEqual(cd.issuedMaterials.map((i) => [i.materialId, i.qty]).sort(), [[w.fondasi.id, 1], [w.lapisan.id, 2]].sort(), "diserahkan Gudang = BOM");

  // 7) Laporan + pesan Sales: kondisi awal -> racikan -> hasil akhir; kosong = Belum dicatat
  const rep = await w.lead.api.get(`${V2}/runs/${run.id}/report`); assert.equal(rep.status, 200, JSON.stringify(rep.body).slice(0, 200));
  assert.equal(rep.body.components.measurements.foundationAfter.dropCm, 2); assert.equal(rep.body.components.measurements.wholeAfter.wholeDropCm, 1);
  const { assemblyMessageLines } = await import("../../src/services/productionComponentNoteService.js");
  const msg = assemblyMessageLines(rep.body.components.measurements, { always: true }).join("\n");
  assert.match(msg, /Uji Fondasi Baru .*penurunan fondasi 2 cm/); assert.match(msg, /Uji Kasur Jadi .*penurunan kasur utuh 1 cm/); assert.match(msg, /tidak dijumlahkan/); assert.doesNotMatch(msg, /amblas \d/i);
  assert.match(assemblyMessageLines({ recorded: {}, comparisons: {} }, { always: true }).join("\n"), /Uji Fondasi Baru : Belum dicatat[\s\S]*Uji Kasur Jadi {2}: Belum dicatat/);
});

// ---- Fase 4 (finalisasi): helper jenis racikan, rework, bahan tambahan lewat PIC Bahan, retur ----
const QP = "/api/production-planning/qc/runs";
const AFTER_FOUNDATION_ONLY = { foundation: { action: "REPLACE", system: "BONNELL", material: { kind: "MANUAL", text: "Pocket spring 25 cm" } }, layers: [] };
async function picBahan(w, runId) {
  const u = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); const pic = { ...u, api: makeClient(server.baseUrl, u.token) };
  const op = await testPrisma.productionOperator.create({ data: { userId: pic.user.id, primaryWorkCenterId: w.wc } });
  ok(await w.lead.api.post(`${V2}/runs/${runId}/build/material-operator`, { operatorId: op.id, expectedRevision: (await card(w, runId)).revision }, key("pic-as")));
  return pic;
}
async function qcFail(w, runId, { stageCode = null, note = "Tengah masih agak turun" } = {}) {
  const det = (await w.qc.api.get(`${QP}/${runId}`)).body; const gate = det.stages.find((s) => s.isQcGate);
  const pre = det.stages.filter((s) => !s.isQcGate && s.order < gate.order);
  const stage = stageCode ? pre.find((s) => s.code === stageCode) : pre.at(-1);
  assert.ok(stage, `tahap rework ${stageCode} tidak ada: ${pre.map((s) => s.code)}`);
  const r = await w.qc.api.post(`${QP}/${runId}/inspect`, { expectedRevision: (await card(w, runId)).revision, result: "FAIL", photoUrls: ["/media/job-photos/p6.jpg"], referenceWeightKg: 75, fitVerdict: "TERLALU_EMPUK", note, reworkStageId: stage.id }, key(`qcfail-${++seq}`));
  assert.equal(r.status, 200, JSON.stringify(r.body)); return r;
}
const qcPass = async (w, runId) => w.qc.api.post(`${QP}/${runId}/inspect`, { expectedRevision: (await card(w, runId)).revision, result: "PASS", photoUrls: ["/media/job-photos/p6.jpg"], referenceWeightKg: 60, fitVerdict: "PAS", note: "lulus uji" }, key(`qcpass-${++seq}`));
const queueSections = async (w, unitId) => (await w.qc.api.get(`${V2}/component-notes/qc-queue`)).body.items.filter((i) => i.unitId === unitId).map((i) => i.section);
const reworkReq = (who, runId, rev, lines, k) => who.api.post(`${V2}/runs/${runId}/build/rework-material`, { expectedRevision: rev, lines }, k || key(`rw-${++seq}`));
const issueMoves = (unitId) => testPrisma.stockMovement.count({ where: { unitId, type: "ISSUE" } });
const Kinds = [
  { name: "fondasi + lapisan", service: "UPG_FONDASI_LAPISAN", foundation: true, layers: true },
  { name: "hanya fondasi", service: "UPG_FONDASI", foundation: true, layers: false },
  { name: "hanya lapisan", service: "UPG_LAPISAN", foundation: false, layers: true },
];

test("Fase 4: TIGA jenis racikan (fondasi+lapisan, hanya fondasi, hanya lapisan) — tiap jenis wajib melewati hasil aktual + uji QC sebelum Meja menyerahkan; tanpa celah satu modul; stok tidak berubah", async () => {
  const w = await world();
  for (const k of Kinds) {
    const { unit, run, startStep } = await toModuleStart(w, { service: k.service });
    const s0 = await stockCounts(unit.id);
    let c = await card(w, run.id);
    assert.deepEqual([c.assembly.applicable, c.assembly.hasFoundation, c.assembly.hasLayers, c.assembly.round], [true, k.foundation, k.layers, 1], k.name);
    assert.equal(startStep, k.foundation ? 6 : 7, `${k.name}: modul pertama`);
    const afterOver = k.foundation && !k.layers ? AFTER_FOUNDATION_ONLY : {};
    if (k.foundation) {
      ok(await step(w, w.nadya, run.id, 6, { payload: { note: "Fondasi dipasang", materials: [{ materialId: w.fondasi.id, qty: 1 }] }, media: await media(w.nadya, run.id, "v") }));
      c = await card(w, run.id);
      assert.deepEqual([c.next.action, c.next.wait, c.next.actor], ["WAIT", "FOUNDATION_NEW_TEST_PENDING", "QC"], `${k.name}: tunggu uji fondasi baru`);
      assert.deepEqual(await queueSections(w, unit.id), ["FOUNDATION_TEST_AFTER"]);
      const early = await step(w, w.nadya, run.id, 8, {}); assert.equal(early.status, 409, `${k.name}: serah dini ditolak`);
      assert.equal(c.assembly.current.foundationTest?.ok ?? false, false);
      await PT.foundationAfter(server, w.qc, run.id);
    } else {
      assert.equal((await queueSections(w, unit.id)).includes("FOUNDATION_TEST_AFTER"), false, "hanya lapisan: tidak menunggu uji fondasi baru");
      assert.equal(c.assembly.hasFoundation, false);
    }
    // hasil aktual susunan wajib sebelum modul terakhir dianggap selesai
    c = await card(w, run.id);
    if (k.layers) {
      assert.deepEqual([c.next.action, c.next.gated, c.next.layersAfterRequired], ["EVIDENCE", true, true], `${k.name}: bukti lapisan menuntut hasil aktual`);
      const noAfter = await step(w, w.nadya, run.id, 7, { payload: { materials: [{ materialId: w.lapisan.id, qty: 2 }] }, media: await media(w.nadya, run.id, "i") }); assert.equal(noAfter.body.code, "STEP_AFTER_REQUIRED");
    } else {
      assert.deepEqual([c.next.action, c.next.wait, c.next.actor], ["WAIT", "AFTER_PENDING", "TABLE"], "hanya fondasi: hasil aktual dulu");
      assert.equal((await step(w, w.nadya, run.id, 8, {})).status, 409);
    }
    assert.equal((await PT.afterRecord(server, w.nadya, run.id, afterOver)).status, 201);
    if (k.layers) ok(await step(w, w.nadya, run.id, 7, { payload: { materials: [{ materialId: w.lapisan.id, qty: 2 }] }, media: await media(w.nadya, run.id, "i") }));
    c = await card(w, run.id);
    assert.deepEqual([c.next.action, c.next.wait, c.next.actor, c.next.stepNo], ["WAIT", "FINISHED_TEST_PENDING", "QC", 8], `${k.name}: tunggu uji kasur jadi`);
    assert.deepEqual(await queueSections(w, unit.id), ["WHOLE_TEST_AFTER"]);
    const skip = await step(w, w.nadya, run.id, 8, { payload: { verdict: "PAS", testerWeightKg: 85 }, media: await media(w.nadya, run.id, "v") }); assert.equal(skip.body.code, "STEP_WAITING_FINISHED_TEST_PENDING", "uji tekstur Meja tidak menggantikan uji QC");
    await PT.wholeAfter(server, w.qc, run.id);
    c = await card(w, run.id); assert.deepEqual([c.next.action, c.next.continueOnly, c.next.qcRecorded], ["TEST", true, true]);
    ok(await step(w, w.nadya, run.id, 8, {}));
    c = await card(w, run.id); assert.equal(c.next.wait, "AWAITING_QC", k.name);
    assert.deepEqual([c.assembly.current.after.ok, c.assembly.current.wholeTest.ok, c.assembly.current.foundationTest?.ok ?? null], [true, true, k.foundation ? true : null], "ketiga fakta putaran ini lengkap");
    assert.deepEqual(await stockCounts(unit.id), s0, `${k.name}: rakit/uji/hasil aktual tidak menambah stok, BOM, reservasi, retur`);
    const pass = await qcPass(w, run.id); assert.equal(pass.status, 200, `${k.name}: ${JSON.stringify(pass.body)}`);
    assert.deepEqual((await testPrisma.qualityInspection.findMany({ where: { runId: run.id }, orderBy: { version: "asc" } })).map((i) => i.result), ["PASS"]);
  }
});

test("Fase 4: hasil aktual berbahan KATALOG yang SAMA dengan rencana tidak minta alasan; bahan katalog berbeda tetap wajib beralasan (perbandingan setelah ref katalog di-resolve)", async () => {
  const w = await world();
  const { unit } = await toModuleStart(w);
  const cat = (m) => ({ kind: "CATALOG", materialId: m.id });
  const plan = { foundation: { action: "REPLACE", system: "BONNELL", material: cat(w.fondasi) }, layers: [{ action: "REPLACE", material: cat(w.lapisan), thicknessCm: 3 }] };
  assert.equal((await cn(w.nadya, unit.id, "PLAN_RACIKAN", { expectedVersion: 0, media: [], data: plan })).status, 201);
  const other = await createTestMaterial({ name: `Latex Lain ${++seq}` });
  const diff = await cn(w.nadya, unit.id, "AFTER", { expectedVersion: 0, media: [], data: { ...plan, layers: [{ action: "REPLACE", material: cat(other), thicknessCm: 3 }] } });
  assert.equal(diff.status, 422); assert.equal(diff.body.code, "COMPONENT_DEVIATION_REASON_REQUIRED"); assert.deepEqual(diff.body.details.items.map((i) => [i.part, i.diffs]), [["LAPISAN_1", ["BAHAN"]]], "hanya bahan yang benar-benar beda");
  const same = await cn(w.nadya, unit.id, "AFTER", { expectedVersion: 0, media: [], data: plan });
  assert.equal(same.status, 201, JSON.stringify(same.body)); assert.equal(same.body.version, 1, "bahan katalog identik = sesuai rencana, tanpa alasan");
  const n = await notesOf(w.nadya, unit.id); assert.deepEqual(n.comparison.planVsActual.layers.map((l) => l.status), ["SAMA"]); assert.equal(n.comparison.planVsActual.foundation.status, "SAMA");
});

// Rework (QC GAGAL) dengan permintaan bahan lewat PIC Bahan, serah Gudang (pick yang ada), replay/konflik, dan retur tepat sekali.
async function reworkScenario({ target, kindService = "UPG_FONDASI_LAPISAN" }) {
  const w = await world();
  const { unit, run } = await toModuleStart(w, { service: kindService, corner: true });
  const fondasiRework = target === "FONDASI";
  const pic = await picBahan(w, run.id); // PIC Bahan ditugaskan sebelum pemakaian tercatat (aturan yang ada: tidak bisa ditetapkan setelah pemakaian masuk bukti)
  // jalur PIC Bahan: pemakaian aktual dicatat PIC Bahan (snapshot kumulatif, versi terbaru = keadaan sekarang); bukti Meja tidak memuat bahan
  const usage = async (materials) => pic.api.post(`${V2}/runs/${run.id}/build/materials`, { expectedRevision: (await card(w, run.id)).revision, materials }, key(`use-${++seq}`));
  ok(await usage([{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.lapisan.id, qty: 2 }]));
  // putaran 1 lengkap -> QC GAGAL (alasan + tahap rework)
  ok(await step(w, w.nadya, run.id, 6, { payload: { note: "Fondasi dipasang" }, media: await media(w.nadya, run.id, "v") }));
  await PT.foundationAfter(server, w.qc, run.id); await PT.afterRecord(server, w.nadya, run.id);
  ok(await step(w, w.nadya, run.id, 7, { payload: {}, media: await media(w.nadya, run.id, "i") }));
  await PT.wholeAfter(server, w.qc, run.id, { complaintMatch: "SEBAGIAN", feelNote: "Tengah masih agak turun", wholeDropCm: 2 });
  ok(await step(w, w.nadya, run.id, 8, {}));
  await qcFail(w, run.id, { stageCode: fondasiRework ? "foundation_upgrade" : null });
  const s0 = await stockCounts(unit.id); const issue0 = await issueMoves(unit.id);

  // putaran 2 terbuka: riwayat putaran 1 tetap terlihat, fakta putaran ini belum ada
  let c = await card(w, run.id);
  assert.deepEqual([c.assembly.round, c.assembly.rounds.length, c.assembly.rework.open, c.assembly.rework.issue], [2, 1, true, null]);
  assert.equal(c.assembly.rounds[0].round, 1);
  assert.deepEqual([c.assembly.current.after.ok, c.assembly.current.wholeTest.ok], [false, false], "catatan lama (putaran 1) bukan hasil putaran terbaru");
  assert.equal(c.assembly.current.foundationTest.ok, true, "uji fondasi putaran 1 berlaku sampai fondasi dirakit ulang");

  // permintaan bahan rework: hanya PIC Bahan yang DITUGASKAN
  const ferdyU = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); const ferdy = { ...ferdyU, api: makeClient(server.baseUrl, ferdyU.token) };
  await testPrisma.productionOperator.create({ data: { userId: ferdy.user.id, primaryWorkCenterId: w.wc } });
  const lines = fondasiRework ? [{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.lapisan.id, qty: 2 }] : [{ materialId: w.lapisan.id, qty: 2 }];
  c = await card(w, run.id);
  for (const [who, tag] of [[w.lead, "lead"], [w.nadya, "gudang-meja"], [ferdy, "pic-lain"], [w.qc, "qc"]]) {
    const r = await reworkReq(who, run.id, c.revision, lines); assert.equal(r.status, 403, `${tag}: ${JSON.stringify(r.body)}`);
  }
  assert.equal(await testPrisma.materialIssue.count({ where: { reworkInspectionId: { not: null } } }), 0, "penolakan tanpa efek");
  assert.equal((await reworkReq(pic, run.id, c.revision, [{ materialId: w.lapisan.id, qty: 0 }])).status, 400, "jumlah harus > 0");
  const rk = key("rw-ok");
  const req = await reworkReq(pic, run.id, c.revision, lines, rk); assert.equal(req.status, 201, JSON.stringify(req.body));
  const issueId = req.body.supplementalIssue.issueId; assert.ok(issueId);
  const replay = await reworkReq(pic, run.id, c.revision, lines, rk); assert.equal(replay.body.replayed, true, "replay idempoten"); assert.equal(replay.body.supplementalIssue.issueId, issueId);
  const diff = await reworkReq(pic, run.id, c.revision, [{ materialId: w.lapisan.id, qty: 9 }], rk); assert.equal(diff.status, 409); assert.equal(diff.body.code, "IDEMPOTENCY_CONFLICT");
  const c1 = await card(w, run.id);
  const stale = await reworkReq(pic, run.id, c.revision, lines); assert.equal(stale.status, 409, "revisi basi ditolak");
  const dupe = await reworkReq(pic, run.id, c1.revision, lines); assert.equal(dupe.status, 409); assert.equal(dupe.body.code, "QC_REWORK_MATERIAL_EXISTS", "satu permintaan per inspeksi");
  assert.equal(await testPrisma.materialIssue.count({ where: { reworkInspectionId: { not: null }, status: { not: "CANCELLED" } } }), 1);
  assert.equal(await issueMoves(unit.id), issue0, "meminta bahan TIDAK mengeluarkan stok (Gudang yang menyerahkan)");
  assert.equal(c1.assembly.rework.issue.issueId, issueId);

  // sebelum Gudang menyerahkan bahan tambahan, rework belum bisa dimulai Meja dan pemakaian tambahan belum bisa dicatat
  assert.deepEqual([c1.next.action, c1.next.wait, c1.next.actor], ["WAIT", "MATERIAL_NOT_READY", "WAREHOUSE"], JSON.stringify(c1.next));
  const cumulative = fondasiRework ? [{ materialId: w.fondasi.id, qty: 2 }, { materialId: w.lapisan.id, qty: 3 }] : [{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.lapisan.id, qty: 3 }];
  const overEarly = await usage(cumulative); assert.equal(overEarly.status, 422); assert.equal(overEarly.body.code, "STEP_MATERIAL_OVER_ISSUED", "bahan tambahan belum diserahkan Gudang -> belum bisa dicatat terpakai");
  // Gudang menyerahkan memakai command pick yang ada: stok keluar tepat sekali
  const pk = await pick(w, issueId); assert.ok(pk);
  assert.equal(await issueMoves(unit.id), issue0 + lines.length, "satu pergerakan ISSUE per baris tambahan");
  const pk2 = await w.nadya.api.post(`${P}/material-requests/${issueId}/pick`, { expectedRevision: 1 }, key(`pk2-${++seq}`)); assert.notEqual(pk2.status, 200, "pick ulang ditolak");
  assert.equal(await issueMoves(unit.id), issue0 + lines.length, "tidak ada stok keluar ganda");
  c = await card(w, run.id); assert.equal(c.assembly.rework.issue.status, "ISSUED");
  assert.equal(c.next.action, "START", JSON.stringify(c.next));
  ok(await step(w, w.nadya, run.id, c.next.stepNo, {}));
  const late = await reworkReq(pic, run.id, (await card(w, run.id)).revision, lines); assert.equal(late.status, 409); assert.match(late.body.code, /^QC_(NOT_IN_REWORK|REWORK_ALREADY_STARTED)$/, "hanya sebelum rework dimulai");
  c = await card(w, run.id);
  const lap = c.issuedMaterials.find((i) => i.materialId === w.lapisan.id);
  assert.deepEqual([lap.qty, lap.usedQty, lap.remainingQty], [4, 2, 2], "diserahkan 2+2, terpakai 2, sisa 2 (kumulatif lintas putaran)");

  const overAll = await usage([{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.lapisan.id, qty: 5 }]); assert.equal(overAll.status, 422, "melebihi total diserahkan ditolak");
  ok(await usage(cumulative));
  if (fondasiRework) {
    ok(await step(w, w.nadya, run.id, 6, { payload: { note: "Fondasi baru" }, media: await media(w.nadya, run.id, "v") }));
    c = await card(w, run.id); assert.equal(c.next.wait, "FOUNDATION_NEW_TEST_PENDING", "fondasi dirakit ulang -> uji fondasi baru wajib ulang");
    assert.equal(c.assembly.current.foundationTest.ok, false);
    assert.equal((await PT.foundationAfter(server, w.qc, run.id, {}, { expectedVersion: 1, reason: "Uji ulang setelah fondasi diperbaiki" })).status, 201);
  }
  // LAPISAN: hasil aktual berubah (lebih tebal). FONDASI: hasil ternyata SAMA dengan putaran 1 -> dikonfirmasi ulang dengan alasan tetap menjadi versi baru (gerbang menuntut catatan lebih baru dari putusan gagal).
  const reAfter = await PT.afterRecord(server, w.nadya, run.id, fondasiRework ? {} : { layers: [{ action: "REPLACE", material: { kind: "MANUAL", text: "Busa HD lebih tebal" }, thicknessCm: 6 }] }, { expectedVersion: 1, reason: "Perbaikan setelah QC gagal" });
  assert.equal(reAfter.status, 201); assert.equal(reAfter.body.version, 2); assert.equal(reAfter.body.unchanged, false, "konfirmasi ulang beralasan = versi baru walau isi sama");
  ok(await step(w, w.nadya, run.id, 7, { payload: {}, media: await media(w.nadya, run.id, "i") }));
  c = await card(w, run.id); assert.deepEqual([c.next.wait, c.next.stepNo], ["FINISHED_TEST_PENDING", 8], "uji kasur jadi putaran 1 tidak dipakai");
  assert.equal((await step(w, w.nadya, run.id, 8, {})).status, 409);
  await PT.wholeAfter(server, w.qc, run.id, { complaintMatch: "SESUAI", feelNote: "Tengah kokoh", wholeDropCm: 1 }, { expectedVersion: 1, reason: "Uji ulang setelah perbaikan" });
  ok(await step(w, w.nadya, run.id, 8, {}));
  c = await card(w, run.id); assert.equal(c.next.wait, "AWAITING_QC");
  assert.deepEqual([c.assembly.round, c.assembly.current.foundationTest.ok, c.assembly.current.after.ok, c.assembly.current.wholeTest.ok], [2, true, true, true]);
  const pass = await qcPass(w, run.id); assert.equal(pass.status, 200, JSON.stringify(pass.body));
  assert.deepEqual((await testPrisma.qualityInspection.findMany({ where: { runId: run.id }, orderBy: { version: "asc" } })).map((i) => i.result), ["FAIL_REWORK", "PASS"], "inspeksi lama immutable");
  const n = await notesOf(w.qc, unit.id);
  assert.deepEqual([n.sections.AFTER.version, n.sections.WHOLE_TEST_AFTER.version, n.sections.FOUNDATION_TEST_AFTER.version], [2, 2, fondasiRework ? 2 : 1], "riwayat berversi tetap tersimpan");
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: unit.id, section: "AFTER" } }), 2);

  // selesai lewat Corner -> retur sisa TEPAT SEKALI (lapisan diserahkan 2+2, terpakai 2+1 = sisa 1; fondasi habis)
  ok(await step(w, w.nadya, run.id, 9, { payload: { note: "siap dibungkus" }, media: await media(w.nadya, run.id, "i") }));
  ok(await step(w, w.corner, run.id, 10, { payload: { mattressStyle: "PILLOWTOP", fabricSpec: "Knitting putih quilting", borderColor: "Abu-abu tua" } }));
  ok(await step(w, w.corner, run.id, 11, { payload: { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, media: await media(w.nadya, run.id, "i", "v") }));
  ok(await step(w, w.corner, run.id, 12, { payload: { confirm: true }, media: await media(w.nadya, run.id, "i") }));
  const rets = await testPrisma.productionMaterialReturn.findMany({ where: { runId: run.id } });
  assert.equal(rets.length, 1, JSON.stringify(rets.map((r) => [r.materialId, Number(r.qty)]))); assert.deepEqual([rets[0].materialId, Number(rets[0].qty), rets[0].status], [w.lapisan.id, 1, "PENDING"]);
  const rkey = key("ret"); const recv = await w.nadya.api.post(`${V2}/material-returns/${rets[0].id}/receive`, { expectedRevision: rets[0].revision }, rkey); assert.equal(recv.status, 200, JSON.stringify(recv.body));
  const again = await w.nadya.api.post(`${V2}/material-returns/${rets[0].id}/receive`, { expectedRevision: rets[0].revision }, rkey); assert.equal(again.body.replayed, true, "replay retur idempoten");
  const twice = await w.nadya.api.post(`${V2}/material-returns/${rets[0].id}/receive`, { expectedRevision: rets[0].revision + 1 }, key("ret2")); assert.equal(twice.status, 409); assert.equal(twice.body.code, "RETURN_ALREADY_RECEIVED");
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "RETURN" } }), 1, "retur masuk stok tepat sekali");
  assert.equal(await issueMoves(unit.id), issue0 + lines.length, "total stok keluar = putaran 1 + bahan tambahan, tanpa ganda");
  void s0;
}
test("Fase 4: rework LAPISAN — QC gagal -> PIC Bahan minta bahan -> Gudang serah (pick) -> hasil aktual & uji kasur jadi ulang -> lulus; replay/konflik; stok & retur tepat sekali", async () => { await reworkScenario({ target: "LAPISAN" }); });
test("Fase 4: rework FONDASI — uji fondasi baru wajib ulang bersama hasil aktual & uji kasur jadi; bahan tambahan fondasi+lapisan lewat PIC Bahan; stok & retur tepat sekali", async () => { await reworkScenario({ target: "FONDASI" }); });

test("Fase 4: Run lama (NULL) dan V1 TIDAK terkunci gerbang perakitan; V1 -> V2 hanya lewat penerapan eksplisit; adaptasi/SEWA/NEW tidak terkena", async () => {
  const w = await world();
  const old = await toModuleStart(w, { v2: false }); // V1 (rilis Fase 2/3)
  ok(await step(w, w.nadya, old.run.id, 6, { payload: { note: "Fondasi dipasang", materials: [{ materialId: w.fondasi.id, qty: 1 }] }, media: await media(w.nadya, old.run.id, "v") }));
  let c = await card(w, old.run.id);
  assert.deepEqual([c.qcGatePolicy, c.next.action, c.next.wait ?? null, c.next.stepNo], ["QC_GATE_V1", "EVIDENCE", null, 7], "V1: jalur modul lama persis (tanpa tunggu uji fondasi baru)");
  // NULL (Run sebelum Fase 2): idem
  await testPrisma.productionRun.update({ where: { id: old.run.id }, data: { qcGatePolicyVersion: null } });
  c = await card(w, old.run.id); assert.deepEqual([c.qcGatePolicy, c.next.action, c.next.wait ?? null], [null, "EVIDENCE", null]);
  // penerapan eksplisit V2 ke Run berjalan (beralasan, tercatat); sesudahnya gerbang berlaku
  const gate = await w.lead.api.post(`${V2}/runs/${old.run.id}/qc-gate`, { expectedRevision: c.revision, reason: "Putaran perakitan ini ikut gerbang V2", version: "QC_GATE_V2" }, key("v2"));
  assert.equal(gate.status, 200, JSON.stringify(gate.body)); assert.deepEqual([gate.body.policy, gate.body.changed], ["QC_GATE_V2", true]);
  c = await card(w, old.run.id); assert.deepEqual([c.qcGatePolicy, c.next.action, c.next.wait], ["QC_GATE_V2", "WAIT", "FOUNDATION_NEW_TEST_PENDING"]);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: old.unit.id, eventType: "PRODUCTION_QC_GATE_APPLIED" } }), 1);
  const noDown = await w.lead.api.post(`${V2}/runs/${old.run.id}/qc-gate`, { expectedRevision: c.revision, reason: "ulang", version: "QC_GATE_V1" }, key("v1again")); assert.equal(noDown.body.changed, false, "tidak diturunkan");
  assert.equal((await w.lead.api.post(`${V2}/runs/${old.run.id}/qc-gate`, { expectedRevision: c.revision, reason: "x", version: "QC_GATE_V9" }, key("v9"))).status, 400);
  // SEWA & BARU: tidak ada gerbang perakitan
  const sewa = await mkSewaRun(w); assert.equal((await card(w, sewa.id)).next.wait ?? null, null);
});
async function mkSewaRun(w) {
  const customer = await testPrisma.customer.create({ data: { name: `Sewa F4 ${++seq}` } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `F4S-${++seq}`, value: 1, category: "SEWA", status: "PROCESSING" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `F4S-${seq}-U1`, orderId: order.id, seq: 1, status: "RECEIVED" } });
  await addCohort(unit.id);
  const r = await w.lead.api.post(`${V2}/plans`, { unitId: unit.id, productionDate: DATE, stationCode: "TABLE_3", priority: 0, workCenterId: w.wc, operatorId: w.nadyaOp.id }, key("sewa"));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
}
