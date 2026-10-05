// P8 Production Experience V2: papan meja, 12 tahap evidence-gated PIC Table/Corner, menunggu bahan, laporan Sales, cohort & peran.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
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
async function acceptedUnit(w, { cohort = true } = {}) {
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
  return { unit, run: await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } }) };
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
  ok(await step(w, w.nadya, runId, 2, { payload: { feelNote: "Tengah terasa amblas" }, media: await media(w.nadya, runId, "v") }));
  ok(await step(w, w.nadya, runId, 3, { payload: { oldMaterials: ["PER", { type: "BUSA", note: "kuning kempes" }] }, media: await media(w.nadya, runId, "i", "i") }));
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
  assert.equal(report.measurement.dropCm, 7); assert.equal(report.finalTest.verdict, "PAS"); assert.equal(report.textureTests.length, 2);
  assert.equal(report.materials.foundation[0].qty, 1); assert.equal(report.materials.layer.length, 1, "versi terakhir per operasi, bukan dobel");
  assert.match(report.message, /amblas 7 cm/); assert.match(report.message, /menunggu diterima Gudang/);
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

  const before = { ev: await evidenceCount(run.id), ops: await testPrisma.productionOperationRun.count(), cmds: await testPrisma.v2Command.count() };
  const stale = await w.nadya.api.post(`${V2}/runs/${run.id}/steps/2`, { expectedRevision: rev, workCenterId: w.wc, payload: { feelNote: "empuk" }, media: await media(w.nadya, run.id, "v") }, key("stale-2"));
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "STEP_REVISION_CONFLICT"); assert.match(stale.body.error, /Muat ulang/);
  assert.deepEqual({ ev: await evidenceCount(run.id), ops: await testPrisma.productionOperationRun.count(), cmds: await testPrisma.v2Command.count() }, before);

  const ghost = await step(w, w.nadya, run.id, 2, { payload: { feelNote: "empuk" }, media: [`/media/production-evidence/${"d".repeat(40)}.mp4`] });
  assert.equal(ghost.status, 422); assert.equal(ghost.body.code, "STEP_MEDIA_NOT_FOUND");
  const missingVideo = await step(w, w.nadya, run.id, 2, { payload: { feelNote: "empuk" }, media: await media(w.nadya, run.id, "i") });
  assert.equal(missingVideo.status, 400); assert.equal(missingVideo.body.code, "STEP_EVIDENCE_INVALID");
  assert.equal(await evidenceCount(run.id), 1, "bukti tidak lengkap tidak menulis apa pun");
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
