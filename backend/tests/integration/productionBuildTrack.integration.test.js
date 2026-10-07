// Jalur PENGERJAAN PESANAN (order BARU/custom) — HTTP + DB sungguhan: jadwal -> PIC -> Pengerjaan Pesanan -> uji tekstur -> QC -> Corner -> Finish -> Gudang,
// TANPA pickup, konfirmasi tiba, Diagnosis, atau layanan teknis. Tahap 1–5 & 7 "tidak berlaku" (bukan dikerjakan). BOM/bahan/retur tetap tersedia sesuai pekerjaan nyata.
// Unit LAYANAN dan unit SEWA tidak berubah; jalur ditentukan dari jenis unit kanonis (Order.category), bukan awalan nomor resi.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { setAdaptationDefault } from "../../src/services/productionSettingsService.js";
import { unitUsesBuildTrack } from "../../src/services/unitStageEngine.js";
import { BUILD_NA_REASON } from "../../src/lib/domain/productionBuildTrack.js";

let server;
let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (v) => ({ "Idempotency-Key": `bt-test-${v}-${++seq}-0001` });
const V2 = "/api/production-v2";
const P = "/api/production-planning";
const DATE = "2026-10-20";
const NA_STEPS = [1, 2, 3, 4, 5, 7];

async function setFlag(flagKey, unitIds) {
  const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "build track test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
async function addCohort(...unitIds) {
  const row = await testPrisma.v2FeatureFlag.findUnique({ where: { key: V2_FLAGS.PRODUCTION_WRITER } });
  const merged = [...new Set([...(row?.enabled ? row.config?.unitIds ?? [] : []), ...unitIds])];
  for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(k, merged);
}

async function world() {
  const [lead, nadya, corner, qc, febri, ferdy, admin] = await Promise.all([
    createTestUser({ roles: ["PRODUCTION_LEAD"] }),
    createTestUser({ roles: ["WAREHOUSE", "PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["QC_LEAD"] }),
    createTestUser({ roles: ["PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["ADMIN"] }),
  ]);
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-BT-${++seq}`, name: "Workshop Utama" } });
  const nadyaOp = await testPrisma.productionOperator.create({ data: { userId: nadya.user.id, primaryWorkCenterId: workCenter.id } });
  const cornerOp = await testPrisma.productionOperator.create({ data: { userId: corner.user.id, primaryWorkCenterId: workCenter.id } });
  const febriOp = await testPrisma.productionOperator.create({ data: { userId: febri.user.id, primaryWorkCenterId: workCenter.id } });
  const ferdyOp = await testPrisma.productionOperator.create({ data: { userId: ferdy.user.id, primaryWorkCenterId: workCenter.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-BT-${++seq}`, name: "Gudang BT" } });
  const fg = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "FG", locationType: "FINISHED_GOODS_AREA", code: `FG-BT-${++seq}` } });
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  const bahanA = await createTestMaterial({ name: `Pocket Spring BT ${++seq}` });
  const bahanB = await createTestMaterial({ name: `Latex BT ${++seq}` });
  await seedBalance(bahanA.id, 10);
  await seedBalance(bahanB.id, 10);
  return { lead: c(lead), nadya: c(nadya), corner: c(corner), qc: c(qc), febri: c(febri), ferdy: c(ferdy), admin: c(admin), wc: workCenter.id, nadyaOp, cornerOp, febriOp, ferdyOp, fg, bahanA, bahanB };
}

// Order nyata Diproses + 1 unit RECEIVED, TANPA pickup/custody/log V1. category menentukan jalur; nomor resi sengaja bisa tidak berawalan NEW-.
async function mkOrder({ category = "BARU", orderNumber = null, unitStatus = "RECEIVED", productLine = "KASUR", productType = "KASUR_SEHAT", services = ["Kasur Custom Pocket Spring 170x210"] } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Bu Custom ${++seq}` } });
  const order = await testPrisma.order.create({
    data: {
      customerId: customer.id, orderNumber: orderNumber || `NEW-${seq}-BT`, value: 5_000_000, category, status: "PROCESSING", productLine, productType, beratBadan: 80, notes: "Ukuran khusus 170x210, tekstur medium-firm",
      items: { create: services.map((layananName) => ({ layananName, harga: 5_000_000 })) },
    },
  });
  const unit = await testPrisma.unit.create({ data: { unitCode: `BT-${++seq}-U1`, orderId: order.id, seq: 1, status: unitStatus, merk: "Custom", ukuran: "170x210" } });
  return { order, unit };
}

const ok = (res) => { assert.equal(res.status, 200, JSON.stringify(res.body)); return res.body; };
let fileSeq = 0;
async function media(who, runId, ...kinds) {
  const fd = new FormData();
  fd.append("runId", runId);
  for (const k of kinds) {
    const video = k === "v";
    fd.append("files", new Blob([Buffer.from(`${video ? "vid" : "img"}-${++fileSeq}-${Math.random()}`)], { type: video ? "video/mp4" : "image/jpeg" }), video ? "a.mp4" : "a.jpg");
  }
  const res = await fetch(`${server.baseUrl}${V2}/evidence/upload`, { method: "POST", headers: { Authorization: `Bearer ${who.token}` }, body: fd });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  return body.items.map((i) => i.url);
}
const card = async (w, runId) => { const res = await w.lead.api.get(`${V2}/runs/${runId}/card`); assert.equal(res.status, 200, JSON.stringify(res.body)); return res.body; };
async function step(w, who, runId, n, { payload = {}, media: m = [], rev = null } = {}) {
  const expectedRevision = rev ?? (await card(w, runId)).revision;
  return who.api.post(`${V2}/runs/${runId}/steps/${n}`, { expectedRevision, workCenterId: w.wc, payload, media: m }, key(`st-${n}`));
}
// Jadwal + PIC lewat command resmi yang sama dengan tombol Jadwalkan/drag (POST /plans {unitId}) — tidak ada pickup/tiba/diagnosis di jalur ini.
// corner: true (bawaan) | false (+ cornerReason) | null (tidak dikonfirmasi) — kebutuhan Corner dikonfirmasi pada rencana lewat command resmi.
async function confirmCorner(w, runId, required, reason, who = w.lead) {
  const c = await card(w, runId);
  return who.api.post(`${V2}/runs/${runId}/build/corner`, { expectedRevision: c.revision, required, ...(reason ? { reason } : {}) }, key("corner"));
}
async function scheduleOrder(w, unit, over = {}, { corner = true, cornerReason = "Tidak ada pekerjaan kain/jahit" } = {}) {
  await addCohort(unit.id);
  const res = await w.lead.api.post(`${V2}/plans`, { unitId: unit.id, productionDate: DATE, stationCode: "TABLE_1", priority: 0, workCenterId: w.wc, operatorId: w.nadyaOp.id, cornerOperatorId: w.cornerOp.id, ...over }, key("sch"));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
  if (corner !== null) ok(await confirmCorner(w, run.id, corner, corner ? null : cornerReason));
  return { planId: res.body.planId, run };
}
// BOM + reservasi + serah bahan oleh Gudang (stok keluar tepat sekali, saat Gudang menyerahkan).
async function issueMaterials(w, planId, lines) {
  const plan = (await w.lead.api.get(`${P}/plans/${planId}`)).body;
  const bom = ok(await w.lead.api.post(`${P}/plans/${planId}/bom`, { lines, expectedRevision: plan.revision }, key("bom")));
  ok(await w.nadya.api.post(`${P}/plans/${planId}/reserve`, { expectedRevision: bom.revision }, key("res")));
  const req = await w.nadya.api.post(`${P}/plans/${planId}/material-request`, {}, key("mr"));
  assert.equal(req.status, 201, JSON.stringify(req.body));
  ok(await w.nadya.api.post(`${P}/material-requests/${req.body.issueId}/pick`, { expectedRevision: 1 }, key("pk")));
}
const issueMoves = (unitId) => testPrisma.stockMovement.count({ where: { unitId, type: "ISSUE" } });

// Seluruh jalur kerja sampai Konfirmasi Selesai. flow KASUR: racikan + uji tekstur PIC + QC (berat badan); NON_KASUR (divan/sofa): tanpa uji tekstur, pemeriksaan hasil QC generik.
// Adaptasi AKTIF = QC dicatat "tidak dilakukan" pada Kirim ke Corner.
const RACIKAN = { fondasi: "Pocket spring 25 cm + penguat pinggir", lapisan: "Latex 3 cm + busa D23 2 cm" };
async function driveToFinish(w, runId, { adaptation = false, materials = [], flow = "KASUR" } = {}) {
  const kasur = flow === "KASUR";
  let c = await card(w, runId);
  assert.deepEqual([c.next.stepNo, c.next.action], [6, "START"], "langsung bisa dikerjakan setelah jadwal + PIC");
  ok(await step(w, w.nadya, runId, 6, {})); // mulai Pengerjaan Pesanan
  c = await card(w, runId);
  assert.deepEqual([c.next.stepNo, c.next.action], [6, kasur ? "EVIDENCE" : "COMPLETE"]);
  assert.equal(c.activeOp.stageLabel, "Pengerjaan Pesanan");
  const payload = kasur ? { note: "Rangka + pocket spring sesuai spesifikasi Sales 170x210", materials, racikan: RACIKAN } : { note: "Rangka kayu + dudukan sesuai ukuran pesanan", materials };
  const done6 = ok(await step(w, w.nadya, runId, 6, { payload, media: await media(w.nadya, runId, kasur ? "v" : "i") }));
  let awaitingQc = !!done6.awaitingQc;
  if (kasur) {
    const pas = ok(await step(w, w.nadya, runId, 8, { payload: { verdict: "PAS", testerWeightKg: 80 }, media: await media(w.nadya, runId, "v") }));
    awaitingQc = !!pas.awaitingQc;
  }
  if (adaptation) {
    assert.equal(awaitingQc, false, "adaptasi: tidak menunggu QC");
    assert.equal((await card(w, runId)).next.qcNotPerformed, true);
  } else {
    assert.equal(awaitingQc, true, "menunggu pemeriksaan PIC QC");
    const qcRun = (await w.qc.api.get(`${P}/qc/runs/${runId}`)).body;
    assert.equal(qcRun.track, "BUILD"); assert.equal(qcRun.qcProfile, kasur ? "KASUR" : "GENERIC");
    const body = { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], note: "lulus" };
    if (kasur) Object.assign(body, { referenceWeightKg: 80, fitVerdict: "PAS" });
    ok(await w.qc.api.post(`${P}/qc/runs/${runId}/inspect`, body, key("qc")));
  }
  ok(await step(w, w.nadya, runId, 9, { payload: { note: "siap dibungkus" }, media: await media(w.nadya, runId, "i") }));
  ok(await step(w, w.corner, runId, 10, { payload: { mattressStyle: "PILLOWTOP", fabricSpec: "Knit putih", borderColor: "Abu-abu" } }));
  ok(await step(w, w.corner, runId, 11, { payload: { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, media: await media(w.nadya, runId, "i") }));
  return ok(await step(w, w.corner, runId, 12, { payload: { confirm: true }, media: await media(w.nadya, runId, "i") }));
}

async function assertNoRestorationTraces(unit, run, { flow = "KASUR" } = {}) {
  const evidence = await testPrisma.productionStepEvidence.findMany({ where: { runId: run.id }, select: { stepNo: true } });
  const naSteps = flow === "KASUR" ? NA_STEPS : [...NA_STEPS, 8];
  assert.deepEqual(evidence.filter((e) => naSteps.includes(e.stepNo)), [], "tidak ada bukti untuk tahap yang tidak berlaku — tidak dicatat sebagai dikerjakan");
  assert.equal(await testPrisma.diagnosisReport.count({ where: { runId: run.id } }), 0, "tanpa Diagnosis");
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id, direction: "INBOUND" } }), 0, "tanpa pickup/custody masuk");
  assert.equal(await testPrisma.jobUnit.count({ where: { unitId: unit.id, job: { type: "PICKUP" } } }), 0, "tanpa job pickup");
  const logs = await testPrisma.unitStageLog.findMany({ where: { unitId: unit.id }, include: { stage: { select: { code: true } } } });
  for (const l of logs) assert.ok(!["pre_teardown_test", "teardown", "foundation_test", "diagnosis"].includes(l.stage.code), `log tahap bongkar/diagnosa: ${l.stage.code}`);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).serviceId, null, "layanan teknis tidak dipilih/dipetakan");
}

test("order BARU: jadwal + PIC -> langsung dikerjakan; tahap 1–5 & 7 TIDAK BERLAKU; spesifikasi & layanan Sales tampil; tanpa pickup/tiba/Diagnosis/layanan teknis; lifecycle sampai Gudang", async () => {
  const w = await world();
  const { unit } = await mkOrder({ category: "BARU" });
  const { run } = await scheduleOrder(w, unit);
  assert.equal(run.origin, "WORKSHOP_BORN"); assert.equal(run.status, "ACTIVE");
  assert.equal(await unitUsesBuildTrack(testPrisma, unit.id), true);

  // Kartu: jalur BUILD, tahap tidak berlaku (NA + alasan), tahap 6 bernama Pengerjaan Pesanan, spesifikasi & layanan Sales sebagai acuan.
  const c = await card(w, run.id);
  assert.equal(c.track, "BUILD");
  assert.deepEqual([c.next.actor, c.next.stepNo, c.next.action], ["TABLE", 6, "START"]);
  assert.equal(c.bucket, "ANTREAN");
  for (const n of NA_STEPS) { const s = c.steps.find((x) => x.no === n); assert.equal(s.status, "NA", `tahap ${n}`); assert.equal(s.naReason, BUILD_NA_REASON); }
  assert.equal(c.steps.find((x) => x.no === 6).label, "Pengerjaan Pesanan");
  assert.deepEqual(c.progress, { done: 0, skipped: 0, remaining: 6, total: 6 });
  assert.deepEqual(c.customer.salesServices, ["Kasur Custom Pocket Spring 170x210"]);
  assert.equal(c.customer.productType, "KASUR_SEHAT"); assert.equal(c.customer.request, "Ukuran khusus 170x210, tekstur medium-firm");
  assert.equal(c.unit.merk, "Custom"); assert.equal(c.unit.ukuran, "170x210");
  assert.equal(c.indicators.service, "TIDAK_BERLAKU"); assert.equal(c.indicators.bom, "OPSIONAL"); assert.equal(c.indicators.custody, "LAHIR_DI_WORKSHOP");
  assert.ok(!c.warnings.some((x) => /layanan|diagnosa/i.test(x.text)), "tidak ada peringatan layanan teknis/diagnosa");
  const phases = await testPrisma.productionPhaseRun.findMany({ where: { runId: run.id } });
  for (const ph of phases.filter((p) => ["INTAKE", "DIAGNOSIS"].includes(p.phase))) { assert.equal(ph.status, "NOT_APPLICABLE"); assert.equal(ph.reason, BUILD_NA_REASON); }

  // Unit 360: spesifikasi tampil, layanan teknis tidak berlaku.
  const ov = ok(await w.lead.api.get(`${V2}/units/${unit.id}/overview`));
  assert.equal(ov.production.track, "BUILD"); assert.equal(ov.service.applicable, false);
  assert.deepEqual(ov.salesContext.salesServices.value, ["Kasur Custom Pocket Spring 170x210"]);

  // PIC melihatnya di antrean Meja dengan aksi mulai; tahap bongkar/diagnosa ditolak (urutan dijaga server).
  const queue = ok(await w.nadya.api.get(`${V2}/worker/table`));
  const qi = queue.items.find((i) => i.runId === run.id);
  assert.ok(qi, "unit BARU masuk antrean PIC"); assert.equal(qi.track, "BUILD"); assert.deepEqual([qi.next.stepNo, qi.next.action], [6, "START"]);
  for (const n of [1, 3, 5]) {
    const early = await step(w, w.nadya, run.id, n, { payload: { conditionConfirmed: true, oldMaterials: ["PER"], diagnosis: "x".repeat(20) }, media: await media(w.nadya, run.id, "i") });
    assert.ok([409, 400, 403].includes(early.status), `tahap ${n} tidak boleh dikerjakan: ${early.status} ${JSON.stringify(early.body)}`);
  }
  assert.equal(await testPrisma.productionOperationRun.count({ where: { runId: run.id } }), 0, "penolakan tanpa efek");

  // Seluruh alur tanpa BOM/bahan (opsional) — langsung dikerjakan.
  const fin = await driveToFinish(w, run.id);
  assert.ok(fin.handoffId); assert.equal(fin.next.wait, "AWAITING_WAREHOUSE");
  const ops = await testPrisma.productionOperationRun.findMany({ where: { runId: run.id }, orderBy: { sequence: "asc" } });
  assert.deepEqual(ops.map((o) => o.stageCode), ["custom_build", "corner_sewing", "finished"], "tidak ada operasi bongkar/diagnosa/modul layanan");
  await assertNoRestorationTraces(unit, run);

  const fg = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: fin.handoffId } });
  ok(await w.nadya.api.post(`/api/inventory/unit-custody/${fg.id}/accept`, { locationId: w.fg.id, expectedRevision: fg.revision }, key("fg")));
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).status, "COMPLETED");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "READY_FOR_DELIVERY");
  const done = await card(w, run.id);
  assert.equal(done.bucket, "SELESAI"); assert.deepEqual(done.progress, { done: 6, skipped: 0, remaining: 0, total: 6 });
  assert.deepEqual(done.steps.filter((s) => s.status === "NA").map((s) => s.no), NA_STEPS, "tetap 'tidak berlaku', tidak pernah DONE/SKIPPED");
  const report = ok(await w.lead.api.get(`${V2}/runs/${run.id}/report`));
  assert.ok(report.media.after.length >= 1);
});

test("BOM, pemakaian bahan, dokumentasi hasil, dan retur tetap tersedia sesuai pekerjaan nyata (bahan bukan gerbang mulai)", async () => {
  const w = await world();
  const { unit } = await mkOrder({ category: "BARU" });
  const { planId, run } = await scheduleOrder(w, unit);
  // BOM + reservasi + serah bahan SETELAH jadwal (opsional); Gudang menyerahkan 2, pekerjaan memakai 1 -> sisa 1 diretur.
  const plan = (await w.lead.api.get(`${P}/plans/${planId}`)).body;
  const bom = ok(await w.lead.api.post(`${P}/plans/${planId}/bom`, { lines: [{ materialId: w.bahanA.id, qty: 2 }], expectedRevision: plan.revision }, key("bom")));
  ok(await w.nadya.api.post(`${P}/plans/${planId}/reserve`, { expectedRevision: bom.revision }, key("res")));
  const req = await w.nadya.api.post(`${P}/plans/${planId}/material-request`, {}, key("mr"));
  assert.equal(req.status, 201, JSON.stringify(req.body));
  ok(await w.nadya.api.post(`${P}/material-requests/${req.body.issueId}/pick`, { expectedRevision: 1 }, key("pk")));
  assert.equal((await card(w, run.id)).indicators.bom, "OK");

  // Bahan di bukti tahap 6 harus yang diserahkan Gudang (aturan lama tetap): melebihi = 422.
  ok(await step(w, w.nadya, run.id, 6, {}));
  const issuedMoves = await testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "ISSUE" } });
  const over = await step(w, w.nadya, run.id, 6, { payload: { note: "pakai spring", racikan: RACIKAN, materials: [{ materialId: w.bahanA.id, qty: 5 }] }, media: await media(w.nadya, run.id, "v") });
  assert.equal(over.status, 422); assert.equal(over.body.code, "STEP_MATERIAL_OVER_ISSUED");
  ok(await step(w, w.nadya, run.id, 6, { payload: { note: "pakai spring", racikan: RACIKAN, materials: [{ materialId: w.bahanA.id, qty: 1 }] }, media: await media(w.nadya, run.id, "v") }));
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "ISSUE" } }), issuedMoves, "mencatat pemakaian bahan di tahap TIDAK menulis stok keluar lagi (stok keluar hanya saat Gudang menyerahkan)");
  assert.equal((await testPrisma.productionStepEvidence.findFirstOrThrow({ where: { runId: run.id, stepNo: 6 } })).payload.materials.length, 1);

  // Dokumentasi hasil: matriks hanya memuat tahap yang berlaku; foto dari tahap 6/8/9/11/12 tersaji.
  ok(await step(w, w.nadya, run.id, 8, { payload: { verdict: "PAS", testerWeightKg: 80 }, media: await media(w.nadya, run.id, "v") }));
  const qcRun = (await w.qc.api.get(`${P}/qc/runs/${run.id}`)).body;
  ok(await w.qc.api.post(`${P}/qc/runs/${run.id}/inspect`, { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], referenceWeightKg: 80, fitVerdict: "PAS", note: "lulus" }, key("qc")));
  ok(await step(w, w.nadya, run.id, 9, { payload: { note: "ok" }, media: await media(w.nadya, run.id, "i") }));
  ok(await step(w, w.corner, run.id, 10, { payload: { mattressStyle: "PILLOWTOP", fabricSpec: "Knit", borderColor: "Abu" } }));
  ok(await step(w, w.corner, run.id, 11, { payload: { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, media: await media(w.nadya, run.id, "i") }));
  const fin = ok(await step(w, w.corner, run.id, 12, { payload: { confirm: true }, media: await media(w.nadya, run.id, "i") }));
  assert.ok(fin.handoffId);

  // Retur sisa bahan dibuat dari pekerjaan nyata (serah 2 - pakai 1 = 1) dan bisa diterima Gudang.
  const rets = await testPrisma.productionMaterialReturn.findMany({ where: { runId: run.id } });
  assert.equal(rets.length, 1); assert.equal(Number(rets[0].qty), 1); assert.equal(rets[0].status, "PENDING");
  const recv = ok(await w.nadya.api.post(`${V2}/material-returns/${rets[0].id}/receive`, { expectedRevision: rets[0].revision }, key("ret")));
  assert.ok(recv);
  const ov = ok(await w.lead.api.get(`${V2}/units/${unit.id}/overview`));
  assert.ok(ov.documentation, "dokumentasi hasil tersedia"); assert.ok(ov.materials, "pemakaian bahan tersedia");
  await assertNoRestorationTraces(unit, run);
});

test("adaptasi AKTIF: Pengerjaan Pesanan -> Corner tanpa putusan QC (tidak dilakukan, bukan lulus) -> selesai; tahap 1–5 & 7 tetap 'tidak berlaku'", async () => {
  const w = await world();
  await setAdaptationDefault(testPrisma, { enabled: true, actorId: w.lead.user.id });
  const { unit } = await mkOrder({ category: "BARU" });
  const { run } = await scheduleOrder(w, unit);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).adaptationPolicy, "ADAPTATION_V1");
  assert.equal((await card(w, run.id)).track, "BUILD");
  const fin = await driveToFinish(w, run.id, { adaptation: true });
  assert.equal(fin.handoffId, undefined, "adaptasi: tidak ada penawaran barang jadi ke Gudang"); assert.equal(fin.next.wait, "READY_TO_FINISH");
  assert.equal(await testPrisma.qualityInspection.count({ where: { runId: run.id } }), 0, "tanpa inspeksi QC");
  const rev = (await card(w, run.id)).revision;
  const done = ok(await w.nadya.api.post(`${V2}/runs/${run.id}/finish`, { expectedRevision: rev, workCenterId: w.wc, confirm: true }, key("fin-adapt")));
  assert.equal(done.completed, true); assert.equal(done.unitStatus, "READY_FOR_DELIVERY");
  const c = await card(w, run.id);
  assert.deepEqual(c.steps.filter((s) => s.status === "NA").map((s) => s.no), NA_STEPS);
  assert.equal(c.indicators.qc, "TIDAK_DILAKUKAN");
  await assertNoRestorationTraces(unit, run);
});

test("jalur ditentukan dari jenis unit KANONIS, bukan awalan resi: BARU tanpa NEW- = BUILD; LAYANAN berawalan NEW- = bukan; SEWA tidak berubah", async () => {
  const w = await world();
  const baru = await mkOrder({ category: "BARU", orderNumber: `RES-02102026-${++seq}` });
  const sewa = await mkOrder({ category: "SEWA", orderNumber: `SWA-${++seq}` });
  const layanan = await mkOrder({ category: "LAYANAN", orderNumber: `NEW-${++seq}-LAYANAN` });
  const rb = await scheduleOrder(w, baru.unit);
  assert.equal(await unitUsesBuildTrack(testPrisma, baru.unit.id), true, "BARU berawalan RES- tetap jalur pengerjaan");
  assert.equal((await card(w, rb.run.id)).track, "BUILD");

  await addCohort(sewa.unit.id);
  const rs = await w.lead.api.post(`${V2}/plans`, { unitId: sewa.unit.id, productionDate: DATE, stationCode: "TABLE_2", priority: 0, workCenterId: w.wc, operatorId: w.nadyaOp.id }, key("sch-sewa"));
  assert.equal(rs.status, 201, JSON.stringify(rs.body));
  const sewaRun = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: sewa.unit.id } });
  assert.equal(await unitUsesBuildTrack(testPrisma, sewa.unit.id), false, "SEWA belum diubah (perilaku lama)");
  const sc = await card(w, sewaRun.id);
  assert.equal(sc.track, "RESTORATION"); assert.equal(sc.progress.total, 12); assert.deepEqual([sc.next.stepNo, sc.next.action], [1, "START_WITH_EVIDENCE"]);

  // LAYANAN berawalan NEW-: tetap jalur restorasi (bukan WORKSHOP_BORN, bukan jalur pengerjaan) — alur onboarding LAYANAN tidak berubah.
  await addCohort(layanan.unit.id);
  const rl = await w.lead.api.post(`${V2}/plans`, { unitId: layanan.unit.id, productionDate: DATE, stationCode: "TABLE_3", priority: 0, workCenterId: w.wc, operatorId: w.nadyaOp.id }, key("sch-lay"));
  assert.equal(rl.status, 201, JSON.stringify(rl.body));
  const layRun = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: layanan.unit.id } });
  assert.notEqual(layRun.origin, "WORKSHOP_BORN", "LAYANAN tidak pernah lahir di workshop");
  assert.equal(await unitUsesBuildTrack(testPrisma, layanan.unit.id), false);
  const lc = await card(w, layRun.id);
  assert.equal(lc.track, "RESTORATION"); assert.equal(lc.progress.total, 12); assert.equal(lc.indicators.service, "BELUM");
});

test("Run lama/histori tidak berubah: Run WORKSHOP_BORN BARU yang sudah ada tanpa routing baru tetap terbaca; unit non-BARU memakai routing lama", async () => {
  const w = await world();
  const { unit } = await mkOrder({ category: "LAYANAN", orderNumber: `LY-${++seq}` });
  assert.equal(await unitUsesBuildTrack(testPrisma, unit.id), false);
  const { pathForUnit } = await import("../../src/services/unitStageEngine.js");
  const svc = await testPrisma.serviceCatalog.findFirstOrThrow({ orderBy: { sortOrder: "asc" } });
  await testPrisma.unit.update({ where: { id: unit.id }, data: { serviceId: svc.id } });
  const path = await pathForUnit(testPrisma, await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } }));
  assert.deepEqual(path.slice(0, 4).map((s) => s.code), ["pre_teardown_test", "teardown", "foundation_test", "diagnosis"], "routing LAYANAN tetap lengkap");
  assert.ok(!path.some((s) => s.code === "custom_build"));
  assert.ok(w);
});

const columnOf = async (w, runId) => {
  const cc = ok(await w.lead.api.get(`${V2}/command-center`));
  return cc.columns.find((col) => col.items.some((i) => i.runId === runId))?.key ?? null;
};

test("kasur custom: racikan wajib; pipeline = Tiba/Belum Mulai -> Pengerjaan Pesanan -> Uji Hasil -> Corner (bukan Fondasi Jadi); QC memegang racikan + spesifikasi; laporan memuat racikan", async () => {
  const w = await world();
  const { unit } = await mkOrder({ category: "BARU", productLine: "KASUR", productType: "KASUR_SPRING" });
  const { run } = await scheduleOrder(w, unit);
  let c = await card(w, run.id);
  assert.deepEqual(c.product, { class: "KASUR", flow: "KASUR", problem: null });
  assert.equal(await columnOf(w, run.id), "TIBA_BELUM_MULAI", "belum mulai");
  ok(await step(w, w.nadya, run.id, 6, {}));
  assert.equal(await columnOf(w, run.id), "PENGERJAAN", "Pengerjaan Pesanan BUKAN Fondasi Jadi/Uji Fondasi");
  assert.equal((await card(w, run.id)).bucketLabel, "Pengerjaan Pesanan");

  // racikan wajib untuk kasur; tanpa racikan ditolak tanpa efek
  const noRacikan = await step(w, w.nadya, run.id, 6, { payload: { note: "Pengerjaan selesai" }, media: await media(w.nadya, run.id, "i") });
  assert.equal(noRacikan.status, 400);
  assert.equal(await testPrisma.productionStepEvidence.count({ where: { runId: run.id } }), 0);
  ok(await step(w, w.nadya, run.id, 6, { payload: { note: "Pengerjaan selesai", racikan: RACIKAN }, media: await media(w.nadya, run.id, "i") })); // foto cukup, tanpa video
  assert.equal(await columnOf(w, run.id), "UJI_HASIL", "uji tekstur PIC sebelum QC");
  assert.equal((await card(w, run.id)).racikan.fondasi, RACIKAN.fondasi);
  ok(await step(w, w.nadya, run.id, 8, { payload: { verdict: "PAS", testerWeightKg: 80 }, media: await media(w.nadya, run.id, "v") }));
  assert.equal(await columnOf(w, run.id), "UJI_HASIL", "menunggu PIC QC");

  const qcRun = (await w.qc.api.get(`${P}/qc/runs/${run.id}`)).body;
  assert.equal(qcRun.qcProfile, "KASUR"); assert.deepEqual(qcRun.racikan, { fondasi: RACIKAN.fondasi, lapisan: RACIKAN.lapisan });
  assert.deepEqual(qcRun.salesServices, ["Kasur Custom Pocket Spring 170x210"]);
  const queue = ok(await w.qc.api.get(`${P}/qc/queue?tab=AWAITING_QC`));
  const qi = (queue.items || queue.runs || queue).find((r) => r.runId === run.id);
  assert.ok(qi, "run masuk antrean PIC QC"); assert.equal(qi.qcProfile, "KASUR");
  // kasur: berat acuan wajib
  const noWeight = await w.qc.api.post(`${P}/qc/runs/${run.id}/inspect`, { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], fitVerdict: "PAS" }, key("qc-noweight"));
  assert.equal(noWeight.status, 400); assert.equal(noWeight.body.code, "QC_WEIGHT_REQUIRED");
  ok(await w.qc.api.post(`${P}/qc/runs/${run.id}/inspect`, { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], referenceWeightKg: 80, fitVerdict: "PAS", note: "lulus" }, key("qc-ok")));
  assert.equal(await testPrisma.qcFitTest.count({ where: { unitId: unit.id } }), 1, "uji berat badan kasur tercatat sekali");
  ok(await step(w, w.nadya, run.id, 9, { payload: { note: "siap" }, media: await media(w.nadya, run.id, "i") }));
  ok(await step(w, w.corner, run.id, 10, { payload: { mattressStyle: "PILLOWTOP", fabricSpec: "Knit", borderColor: "Abu" } }));
  assert.equal(await columnOf(w, run.id), "CORNER");
  const ov = ok(await w.lead.api.get(`${V2}/units/${unit.id}/overview`));
  assert.deepEqual(ov.production.racikan, { fondasi: RACIKAN.fondasi, lapisan: RACIKAN.lapisan }); assert.equal(ov.production.product.class, "KASUR");
  ok(await step(w, w.corner, run.id, 11, { payload: { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, media: await media(w.nadya, run.id, "i") }));
  ok(await step(w, w.corner, run.id, 12, { payload: { confirm: true }, media: await media(w.nadya, run.id, "i") }));
  const report = ok(await w.lead.api.get(`${V2}/runs/${run.id}/report`));
  assert.equal(report.track, "BUILD"); assert.match(report.message, /SPESIFIKASI PESANAN/); assert.match(report.message, /Racikan Fondasi/); assert.doesNotMatch(report.message, /DIAGNOSA|BONGKAR|RESTORASI/);
  assert.deepEqual(report.build.salesServices, ["Kasur Custom Pocket Spring 170x210"]);
  c = await card(w, c.runId);
  assert.ok(c);
});

test("divan: tanpa uji tekstur/berat badan kasur — satu kiriman Pengerjaan Pesanan -> pemeriksaan hasil PIC QC (generik) -> Corner -> selesai -> Gudang", async () => {
  const w = await world();
  const { unit } = await mkOrder({ category: "BARU", productLine: "DIVAN", productType: "DIVAN_UTAMA", services: ["Divan Custom 160x200 + Sandaran"], orderNumber: `RES-DIVAN-${++seq}` });
  const { run } = await scheduleOrder(w, unit);
  const c = await card(w, run.id);
  assert.deepEqual(c.product, { class: "NON_KASUR", flow: "NON_KASUR", problem: null });
  assert.deepEqual(c.progress, { done: 0, skipped: 0, remaining: 5, total: 5 }, "6, 9–12");
  const s8 = c.steps.find((x) => x.no === 8);
  assert.equal(s8.status, "NA"); assert.match(s8.naReason, /non-kasur/i);
  assert.equal(c.racikan, null);
  assert.deepEqual(c.customer.salesServices, ["Divan Custom 160x200 + Sandaran"]);
  // payload kasur (racikan) diabaikan, uji tekstur (tahap 8) ditolak
  ok(await step(w, w.nadya, run.id, 6, {}));
  const early8 = await step(w, w.nadya, run.id, 8, { payload: { verdict: "PAS", testerWeightKg: 80 }, media: await media(w.nadya, run.id, "v") });
  assert.ok([400, 409].includes(early8.status), "uji tekstur kasur tidak diminta/diterima untuk divan: " + early8.status);

  const fin = await driveToFinishFrom6Started(w, run.id);
  assert.ok(fin.handoffId); assert.equal(fin.next.wait, "AWAITING_WAREHOUSE");
  // QC generik: tidak ada uji berat badan/tekstur yang dikarang
  assert.equal(await testPrisma.qcFitTest.count({ where: { unitId: unit.id } }), 0, "tanpa uji berat badan kasur");
  const insp = await testPrisma.qualityInspection.findMany({ where: { runId: run.id } });
  assert.equal(insp.length, 2, "FAIL (rework) lalu PASS"); assert.deepEqual(insp.sort((a, b) => a.version - b.version).map((i) => i.result), ["FAIL_REWORK", "PASS"]); assert.ok(insp.every((i) => i.qcFitTestId === null));
  assert.equal(await testPrisma.productionStepEvidence.count({ where: { runId: run.id, stepNo: 8 } }), 0, "tidak ada tahap uji tekstur");
  await assertNoRestorationTraces(unit, run, { flow: "NON_KASUR" });
  const fg = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: fin.handoffId } });
  ok(await w.nadya.api.post(`/api/inventory/unit-custody/${fg.id}/accept`, { locationId: w.fg.id, expectedRevision: fg.revision }, key("fg")));
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).status, "COMPLETED");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "READY_FOR_DELIVERY");
  const report = ok(await w.lead.api.get(`${V2}/runs/${run.id}/report`));
  assert.match(report.message, /pemeriksaan hasil/); assert.doesNotMatch(report.message, /Racikan|Uji PIC Meja|Hasil Tekstur/);
  assert.deepEqual((await card(w, run.id)).progress, { done: 5, skipped: 0, remaining: 0, total: 5 });
});

// Lanjutan setelah Pengerjaan Pesanan SUDAH dimulai (divan/sofa): kirim bukti (menutup tahap), QC generik, Corner, Finish.
async function driveToFinishFrom6Started(w, runId) {
  ok(await step(w, w.nadya, runId, 6, { payload: { note: "Rangka kayu + dudukan sesuai ukuran pesanan", racikan: RACIKAN }, media: await media(w.nadya, runId, "i") }));
  const qcRun = (await w.qc.api.get(`${P}/qc/runs/${runId}`)).body;
  assert.equal(qcRun.qcProfile, "GENERIC"); assert.equal(qcRun.state, "AWAITING_QC"); assert.equal(qcRun.racikan, null, "non-kasur: racikan kasur tidak disimpan");
  assert.equal(await columnOf(w, runId), "UJI_HASIL");
  const queue = ok(await w.qc.api.get(`${P}/qc/queue?tab=AWAITING_QC`));
  assert.equal((queue.items || queue.runs || queue).find((r) => r.runId === runId)?.qcProfile, "GENERIC");
  // Uji kasur ditolak server untuk non-kasur; keputusan lulus/gagal + foto + catatan cukup
  const withFit = await w.qc.api.post(`${P}/qc/runs/${runId}/inspect`, { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], fitVerdict: "PAS", referenceWeightKg: 80 }, key("qc-fit"));
  assert.equal(withFit.status, 422); assert.equal(withFit.body.code, "QC_GENERIC_NO_FIT");
  const noPhoto = await w.qc.api.post(`${P}/qc/runs/${runId}/inspect`, { expectedRevision: qcRun.revision, result: "PASS", photoUrls: [] }, key("qc-nophoto"));
  assert.equal(noPhoto.status, 400); assert.equal(noPhoto.body.code, "QC_EVIDENCE_REQUIRED");
  // FAIL -> rework ke Pengerjaan Pesanan -> kirim ulang -> lulus
  const reworkStage = qcRun.stages.find((x) => x.code === "custom_build");
  const failBody = { expectedRevision: qcRun.revision, result: "FAIL", photoUrls: ["/media/job-photos/qc.jpg"], note: "Rangka sedikit miring", reworkStageId: reworkStage.id };
  const failed = ok(await w.qc.api.post(`${P}/qc/runs/${runId}/inspect`, failBody, key("qc-fail")));
  assert.equal(failed.result, "FAIL"); assert.equal(failed.reworkStage.code, "custom_build");
  const afterFail = await card(w, runId);
  assert.deepEqual([afterFail.next.stepNo, afterFail.next.action], [6, "START"], "rework: kerjakan ulang Pengerjaan Pesanan");
  ok(await step(w, w.nadya, runId, 6, {}));
  ok(await step(w, w.nadya, runId, 6, { payload: { note: "Rangka diluruskan ulang" }, media: await media(w.nadya, runId, "i") }));
  const qc2 = (await w.qc.api.get(`${P}/qc/runs/${runId}`)).body;
  ok(await w.qc.api.post(`${P}/qc/runs/${runId}/inspect`, { expectedRevision: qc2.revision, result: "PASS", photoUrls: ["/media/job-photos/qc2.jpg"], note: "lurus, sesuai spesifikasi" }, key("qc-pass")));
  ok(await step(w, w.nadya, runId, 9, { payload: { note: "siap dibungkus" }, media: await media(w.nadya, runId, "i") }));
  ok(await step(w, w.corner, runId, 10, { payload: { mattressStyle: "PILLOWTOP", fabricSpec: "Kain sofa abu", borderColor: "Abu" } }));
  ok(await step(w, w.corner, runId, 11, { payload: { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, media: await media(w.nadya, runId, "i") }));
  return ok(await step(w, w.corner, runId, 12, { payload: { confirm: true }, media: await media(w.nadya, runId, "i") }));
}

test("sofa + adaptasi AKTIF: QC boleh tidak dilakukan (catatan jujur), Corner dilewati bila tidak diperlukan, Selesai Produksi langsung Siap Kirim tanpa penerimaan barang jadi", async () => {
  const w = await world();
  await setAdaptationDefault(testPrisma, { enabled: true, actorId: w.lead.user.id });
  const { unit } = await mkOrder({ category: "BARU", productLine: "SOFA", productType: "SOFA_L", services: ["Sofa L Custom"] });
  const { run } = await scheduleOrder(w, unit);
  assert.equal((await card(w, run.id)).product.flow, "NON_KASUR");
  ok(await step(w, w.nadya, run.id, 6, {}));
  const done6 = ok(await step(w, w.nadya, run.id, 6, { payload: { note: "Sofa L selesai dirakit" }, media: await media(w.nadya, run.id, "i") }));
  assert.equal(done6.awaitingQc, undefined, "adaptasi: tidak menunggu QC");
  const after = await card(w, run.id);
  assert.equal(after.next.qcNotPerformed, true);
  // QC "tidak dilakukan" dicatat jujur pada Kirim ke Corner (bukan lulus, bukan waive)
  ok(await step(w, w.nadya, run.id, 9, { payload: { note: "kirim ke Corner" }, media: await media(w.nadya, run.id, "i") }));
  const gateLog = await testPrisma.unitStageLog.findFirstOrThrow({ where: { unitId: unit.id, action: "SKIP" } });
  assert.match(gateLog.note, /QC TIDAK DILAKUKAN/); assert.doesNotMatch(gateLog.note, /WAIVED/);
  assert.equal(await testPrisma.qualityInspection.count({ where: { runId: run.id } }), 0);
  assert.equal(await testPrisma.qcFitTest.count({ where: { unitId: unit.id } }), 0);
  // Corner bila diperlukan: Selesai Produksi menutup sisa tahap Corner sebagai DILEWATI (bukan dikerjakan)
  const rev = (await card(w, run.id)).revision;
  const prev = ok(await w.nadya.api.get(`${V2}/runs/${run.id}/finish-preview`));
  assert.ok(prev.remainingStages.length >= 1);
  const done = ok(await w.nadya.api.post(`${V2}/runs/${run.id}/finish`, { expectedRevision: rev, workCenterId: w.wc, confirm: true }, key("fin-sofa")));
  assert.equal(done.completed, true); assert.equal(done.unitStatus, "READY_FOR_DELIVERY");
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id, direction: "FINISHED_GOODS" } }), 0, "tanpa kewajiban penerimaan barang jadi tambahan");
  const final = await card(w, run.id);
  assert.equal(final.indicators.qc, "TIDAK_DILAKUKAN");
  assert.ok(final.steps.filter((x) => x.status === "SKIPPED").length >= 1, "Corner dicatat dilewati");
  assert.deepEqual(final.steps.filter((x) => x.status === "NA").map((x) => x.no), [1, 2, 3, 4, 5, 7, 8]);
  await assertNoRestorationTraces(unit, run, { flow: "NON_KASUR" });
});

test("jenis produk belum jelas = UNCONFIRMED (tanpa fallback kasur): kebutuhan konfirmasi tampil, bukti/uji khusus kasur ditahan, order Sales TIDAK diubah; setelah Sales memperbaiki order, dibaca ulang", async () => {
  const w = await world();
  const konflik = await mkOrder({ category: "BARU", productLine: "KASUR", productType: "SOFA_L" });
  const bawaan = await mkOrder({ category: "BARU", productLine: "KASUR", productType: null });
  for (const [label, o, re] of [["konflik lini<->jenis", konflik, /tidak sesuai/], ["lini KASUR bawaan tanpa jenis", bawaan, /Jenis kasur belum diisi/]]) {
    const { run } = await scheduleOrder(w, o.unit, { stationCode: label.startsWith("konflik") ? "TABLE_1" : "TABLE_2" });
    const c = await card(w, run.id);
    assert.deepEqual([c.product.class, c.product.flow], ["BELUM_JELAS", "UNCONFIRMED"], label); assert.match(c.product.problem, re);
    assert.ok(c.warnings.some((x) => x.code === "JENIS_PRODUK" && /Jenis produk/.test(x.text)), "kebutuhan konfirmasi ditampilkan sebagai peringatan");
    assert.deepEqual([c.next.stepNo, c.next.action], [6, "START"], "pekerjaan fisik boleh dimulai");
    ok(await step(w, w.nadya, run.id, 6, {}));
    const waiting = await card(w, run.id);
    assert.deepEqual([waiting.next.action, waiting.next.wait, waiting.next.actor], ["WAIT", "PRODUCT_TYPE_UNCONFIRMED", "SALES"]);
    assert.match(waiting.next.problem, re);
    const blocked = await step(w, w.nadya, run.id, 6, { payload: { note: "Pengerjaan selesai", racikan: RACIKAN }, media: await media(w.nadya, run.id, "i") });
    assert.equal(blocked.status, 409); assert.equal(blocked.body.code, "STEP_WAITING_PRODUCT_TYPE_UNCONFIRMED");
    assert.equal(await testPrisma.productionStepEvidence.count({ where: { runId: run.id } }), 0, "tidak ada bukti yang tersimpan");
    const ov = ok(await w.lead.api.get(`${V2}/units/${o.unit.id}/overview`));
    assert.equal(ov.production.product.flow, "UNCONFIRMED"); assert.match(ov.production.product.problem, re);
  }
  // order Sales tidak diubah diam-diam
  assert.deepEqual((await testPrisma.order.findUniqueOrThrow({ where: { id: konflik.order.id }, select: { productLine: true, productType: true } })), { productLine: "KASUR", productType: "SOFA_L" });
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: bawaan.order.id }, select: { productType: true } })).productType, null);
  // Sales memperbaiki order (di luar produksi) -> klasifikasi dibaca ulang, alur kasur terbuka
  await testPrisma.order.update({ where: { id: bawaan.order.id }, data: { productType: "KASUR_SPRING" } });
  const runB = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: bawaan.unit.id } });
  const fixed = await card(w, runB.id);
  assert.deepEqual([fixed.product.class, fixed.product.flow, fixed.product.problem], ["KASUR", "KASUR", null]);
  assert.deepEqual([fixed.next.stepNo, fixed.next.action], [6, "EVIDENCE"]);
  ok(await step(w, w.nadya, runB.id, 6, { payload: { note: "Pengerjaan selesai", racikan: RACIKAN }, media: await media(w.nadya, runB.id, "i") }));
});

test("QC kasur ditahan bila jenis produk menjadi tidak jelas (order diubah Sales sesudah pengerjaan); WAIVED oleh pihak berwenang tidak termasuk 'pengujian'", async () => {
  const w = await world();
  const { unit, order } = await mkOrder({ category: "BARU", productLine: "KASUR", productType: "KASUR_SPRING" });
  const { run } = await scheduleOrder(w, unit);
  ok(await step(w, w.nadya, run.id, 6, {}));
  ok(await step(w, w.nadya, run.id, 6, { payload: { note: "Selesai", racikan: RACIKAN }, media: await media(w.nadya, run.id, "i") }));
  ok(await step(w, w.nadya, run.id, 8, { payload: { verdict: "PAS", testerWeightKg: 70 }, media: await media(w.nadya, run.id, "v") }));
  await testPrisma.order.update({ where: { id: order.id }, data: { productType: "SOFA_L" } }); // konflik dengan lini KASUR
  const qcRun = (await w.qc.api.get(`${P}/qc/runs/${run.id}`)).body;
  assert.equal(qcRun.qcProfile, "UNCONFIRMED"); assert.match(qcRun.productClassProblem, /tidak sesuai/);
  const body = { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], referenceWeightKg: 70, fitVerdict: "PAS" };
  const res = await w.qc.api.post(`${P}/qc/runs/${run.id}/inspect`, body, key("qc-unconf"));
  assert.equal(res.status, 409); assert.equal(res.body.code, "QC_PRODUCT_TYPE_UNCONFIRMED");
  const generic = await w.qc.api.post(`${P}/qc/runs/${run.id}/inspect`, { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"] }, key("qc-unconf2"));
  assert.equal(generic.status, 409, "tanpa fallback ke pemeriksaan generik juga");
  assert.equal(await testPrisma.qualityInspection.count({ where: { runId: run.id } }), 0); assert.equal(await testPrisma.qcFitTest.count({ where: { unitId: unit.id } }), 0);
  await testPrisma.order.update({ where: { id: order.id }, data: { productType: "KASUR_SPRING" } }); // Sales memperbaiki
  ok(await w.qc.api.post(`${P}/qc/runs/${run.id}/inspect`, body, key("qc-ok")));
});

test("PIC Bahan per pekerjaan: penugasan resmi, racikan + pemakaian oleh PIC Bahan, otorisasi, bahan hanya dari yang diserahkan, idempoten, stok keluar tepat sekali, sisa -> retur, terkunci setelah retur", async () => {
  const w = await world();
  const { unit } = await mkOrder({ category: "BARU", productLine: "KASUR", productType: "KASUR_SPRING" });
  const { planId, run } = await scheduleOrder(w, unit);
  await issueMaterials(w, planId, [{ materialId: w.bahanA.id, qty: 2 }, { materialId: w.bahanB.id, qty: 3 }]);
  const movesAtIssue = await issueMoves(unit.id);
  assert.equal(movesAtIssue, 2, "Gudang menyerahkan 2 bahan = 2 pergerakan ISSUE");

  // penugasan: hanya pemegang izin penjadwalan; operator harus sah (aktif, terdaftar) — tanpa akun/peran baru
  const assignBody = (operatorId, rev) => ({ operatorId, expectedRevision: rev });
  let rev = (await card(w, run.id)).revision;
  assert.equal((await w.nadya.api.post(`${V2}/runs/${run.id}/build/material-operator`, assignBody(w.febriOp.id, rev), key("as-nadya"))).status, 403, "PIC Meja tidak boleh menugaskan");
  const bad = await w.lead.api.post(`${V2}/runs/${run.id}/build/material-operator`, assignBody("00000000-0000-4000-8000-000000000000", rev), key("as-bad"));
  assert.equal(bad.status, 422); assert.equal(bad.body.code, "BUILD_OPERATOR_INVALID");
  const stale = await w.lead.api.post(`${V2}/runs/${run.id}/build/material-operator`, assignBody(w.febriOp.id, rev - 1), key("as-stale"));
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "STEP_REVISION_CONFLICT");
  const assigned = ok(await w.lead.api.post(`${V2}/runs/${run.id}/build/material-operator`, assignBody(w.febriOp.id, rev), { "Idempotency-Key": "bt-assign-febri-0001-aaaa" }));
  assert.equal(assigned.changed, true); assert.equal(assigned.materialOperator.id, w.febriOp.id);
  const replay = ok(await w.lead.api.post(`${V2}/runs/${run.id}/build/material-operator`, assignBody(w.febriOp.id, rev), { "Idempotency-Key": "bt-assign-febri-0001-aaaa" }));
  assert.equal(replay.replayed, true, "idempoten");
  assert.equal(await testPrisma.productionRunBuildSetting.count({ where: { runId: run.id } }), 1);
  // tidak ada peran/akun baru: PIC Bahan tetap PRODUCTION_WORKER biasa
  assert.deepEqual((await testPrisma.user.findUniqueOrThrow({ where: { id: w.febri.user.id }, select: { role: true } })).role, w.febri.user.role);

  // PIC Meja mulai; racikan belum dicatat -> menunggu PIC Bahan
  ok(await step(w, w.nadya, run.id, 6, {}));
  let c = await card(w, run.id);
  assert.equal(c.build.materialOperator.id, w.febriOp.id);
  assert.deepEqual([c.next.action, c.next.wait, c.next.actor], ["WAIT", "RACIKAN_NOT_RECORDED", "MATERIAL_PIC"]);
  const early = await step(w, w.nadya, run.id, 6, { payload: { note: "Pengerjaan selesai" }, media: await media(w.nadya, run.id, "i") });
  assert.equal(early.status, 409); assert.equal(early.body.code, "STEP_WAITING_RACIKAN_NOT_RECORDED");

  // otorisasi pencatatan: hanya PIC Bahan yang ditugaskan (atau ADMIN/OWNER lewat izin yang sudah ada)
  const rec = (who, body, k, r) => who.api.post(`${V2}/runs/${run.id}/build/materials`, { expectedRevision: r, ...body }, k ? { "Idempotency-Key": k } : key("rec"));
  rev = (await card(w, run.id)).revision;
  const good = { racikan: RACIKAN, materials: [{ materialId: w.bahanA.id, qty: 1 }], note: "Racikan awal" };
  for (const [who, name] of [[w.nadya, "PIC Meja"], [w.ferdy, "operator lain"], [w.lead, "Lead"]]) {
    const r = await rec(who, good, null, rev); assert.equal(r.status, 403, name); assert.match(r.body.code, /BUILD_MATERIAL_OPERATOR_MISMATCH|BUILD_NO_MATERIAL_OPERATOR/, name);
  }
  assert.equal(await testPrisma.productionBuildMaterialRecord.count({ where: { runId: run.id } }), 0);
  // validasi bahan: hanya yang SAH diserahkan, tidak melebihi
  const over = await rec(w.febri, { racikan: RACIKAN, materials: [{ materialId: w.bahanA.id, qty: 5 }] }, null, rev);
  assert.equal(over.status, 422); assert.equal(over.body.code, "STEP_MATERIAL_OVER_ISSUED");
  const other = await createTestMaterial({ name: "Tidak diserahkan" });
  const notIssued = await rec(w.febri, { racikan: RACIKAN, materials: [{ materialId: other.id, qty: 1 }] }, null, rev);
  assert.equal(notIssued.status, 422); assert.equal(notIssued.body.code, "STEP_MATERIAL_NOT_ISSUED");
  assert.equal((await rec(w.febri, {}, null, rev)).status, 400, "kosong ditolak");
  // pencatatan sah + idempoten
  const r1 = ok(await rec(w.febri, good, "bt-rec-febri-v1-aaaaaaaa", rev));
  assert.equal(r1.version, 1);
  const r1b = ok(await rec(w.febri, good, "bt-rec-febri-v1-aaaaaaaa", rev));
  assert.equal(r1b.replayed, true); assert.equal(await testPrisma.productionBuildMaterialRecord.count({ where: { runId: run.id } }), 1, "replay tidak menggandakan");
  rev = (await card(w, run.id)).revision;
  const same = ok(await rec(w.febri, good, null, rev));
  assert.equal(same.changed, false, "isi sama tidak membuat versi baru"); assert.equal(await testPrisma.productionBuildMaterialRecord.count({ where: { runId: run.id } }), 1);
  const r2 = ok(await rec(w.febri, { racikan: RACIKAN, materials: [{ materialId: w.bahanA.id, qty: 1 }, { materialId: w.bahanB.id, qty: 2 }], note: "Revisi pemakaian" }, null, rev));
  assert.equal(r2.version, 2);
  assert.equal(await issueMoves(unit.id), movesAtIssue, "pencatatan pemakaian TIDAK menulis stok keluar (tepat sekali, oleh Gudang)");
  // catatan append-only
  await assert.rejects(() => testPrisma.productionBuildMaterialRecord.updateMany({ where: { runId: run.id }, data: { note: "ubah" } }), /append-only|integrity/i);

  // tampilan: kartu, antrean PIC Bahan, Unit 360
  c = await card(w, run.id);
  assert.equal(c.build.record.version, 2); assert.equal(c.racikan.fondasi, RACIKAN.fondasi);
  assert.deepEqual(c.build.record.materials.map((m) => [m.code, m.qty]).sort(), [[(await testPrisma.material.findUniqueOrThrow({ where: { id: w.bahanA.id } })).code, 1], [(await testPrisma.material.findUniqueOrThrow({ where: { id: w.bahanB.id } })).code, 2]].sort());
  assert.deepEqual([c.next.stepNo, c.next.action], [6, "EVIDENCE"], "racikan tercatat -> PIC Meja bisa menutup pengerjaan");
  const q = ok(await w.febri.api.get(`${V2}/worker/material`));
  assert.deepEqual(q.items.map((i) => i.runId), [run.id]);
  assert.deepEqual(ok(await w.ferdy.api.get(`${V2}/worker/material`)).items, []); assert.deepEqual(ok(await w.nadya.api.get(`${V2}/worker/material`)).items, []);
  assert.deepEqual(ok(await w.admin.api.get(`${V2}/worker/material`)).items.map((i) => i.runId), [run.id], "ADMIN/OWNER melihat semuanya");
  const ov = ok(await w.lead.api.get(`${V2}/units/${unit.id}/overview`));
  const usedA = ov.materials.lines.find((m) => m.materialId === w.bahanA.id);
  assert.ok(usedA, "baris bahan ada"); assert.equal(Number(usedA.usedQty), 1, "pemakaian PIC Bahan tampil di tab Bahan");

  // PIC Meja tidak boleh mengulang pemakaian di bukti (satu sumber); racikan cukup dari catatan PIC Bahan
  const dup = await step(w, w.nadya, run.id, 6, { payload: { note: "Pengerjaan selesai", materials: [{ materialId: w.bahanA.id, qty: 1 }] }, media: await media(w.nadya, run.id, "i") });
  assert.equal(dup.status, 409); assert.equal(dup.body.code, "STEP_MATERIAL_BY_MATERIAL_PIC");
  ok(await step(w, w.nadya, run.id, 6, { payload: { note: "Pengerjaan selesai sesuai racikan" }, media: await media(w.nadya, run.id, "i") }));
  ok(await step(w, w.nadya, run.id, 8, { payload: { verdict: "PAS", testerWeightKg: 80 }, media: await media(w.nadya, run.id, "v") }));
  const qcRun = (await w.qc.api.get(`${P}/qc/runs/${run.id}`)).body;
  assert.deepEqual(qcRun.racikan, { fondasi: RACIKAN.fondasi, lapisan: RACIKAN.lapisan }, "PIC QC melihat racikan dari catatan PIC Bahan");
  ok(await w.qc.api.post(`${P}/qc/runs/${run.id}/inspect`, { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], referenceWeightKg: 80, fitVerdict: "PAS", note: "lulus" }, key("qc")));
  ok(await step(w, w.nadya, run.id, 9, { payload: { note: "siap" }, media: await media(w.nadya, run.id, "i") }));
  ok(await step(w, w.corner, run.id, 10, { payload: { mattressStyle: "PILLOWTOP", fabricSpec: "Knit", borderColor: "Abu" } }));
  ok(await step(w, w.corner, run.id, 11, { payload: { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, media: await media(w.nadya, run.id, "i") }));
  const fin = ok(await step(w, w.corner, run.id, 12, { payload: { confirm: true }, media: await media(w.nadya, run.id, "i") }));
  assert.ok(fin.handoffId);
  // sisa = diserahkan - dipakai (PIC Bahan versi terbaru): A 2-1=1, B 3-2=1
  const rets = await testPrisma.productionMaterialReturn.findMany({ where: { runId: run.id } });
  assert.deepEqual(rets.map((r) => [r.materialId, Number(r.qty)]).sort(), [[w.bahanA.id, 1], [w.bahanB.id, 1]].sort());
  assert.equal(await issueMoves(unit.id), movesAtIssue, "stok keluar tetap tepat sekali");
  // terkunci setelah retur dibuat
  const late = await rec(w.febri, { racikan: RACIKAN, materials: [{ materialId: w.bahanA.id, qty: 2 }] }, null, (await card(w, run.id)).revision);
  assert.equal(late.status, 409); assert.equal(late.body.code, "BUILD_MATERIALS_LOCKED");
  // Gudang menyelesaikan retur (aturan lama) lalu menerima barang jadi
  for (const r of rets) ok(await w.nadya.api.post(`${V2}/material-returns/${r.id}/receive`, { expectedRevision: r.revision }, key("ret")));
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "RETURN" } }), 2);
  const fg = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: fin.handoffId } });
  ok(await w.nadya.api.post(`/api/inventory/unit-custody/${fg.id}/accept`, { locationId: w.fg.id, expectedRevision: fg.revision }, key("fg")));
  const report = ok(await w.lead.api.get(`${V2}/runs/${run.id}/report`));
  assert.equal(report.build.materialOperator, (await testPrisma.user.findUniqueOrThrow({ where: { id: w.febri.user.id } })).name);
  assert.equal(report.materials.foundation.length, 2, "pemakaian PIC Bahan masuk laporan"); assert.match(report.message, /PIC Bahan/);
  assert.match(report.message, /Racikan Fondasi/);
  // histori: Run yang sama tetap bisa ditinjau; tidak ada peran/akun baru yang dibuat
  assert.equal(await testPrisma.activityEvent.count({ where: { eventType: { in: ["PRODUCTION_BUILD_MATERIAL_OPERATOR_SET", "PRODUCTION_BUILD_MATERIALS_RECORDED"] } } }), 3);
});

test("PIC Bahan: tanpa penugasan ditolak (403); ADMIN/OWNER boleh lewat izin yang sudah ada; produk non-kasur menolak racikan; penugasan ditolak bila pemakaian sudah ada di bukti PIC Meja", async () => {
  const w = await world();
  const kasur = await mkOrder({ category: "BARU", productLine: "KASUR", productType: "KASUR_SPRING" });
  const divan = await mkOrder({ category: "BARU", productLine: "DIVAN", productType: "DIVAN_UTAMA", services: ["Divan Custom"] });
  const rk = await scheduleOrder(w, kasur.unit, { stationCode: "TABLE_1" });
  const rd = await scheduleOrder(w, divan.unit, { stationCode: "TABLE_2" });
  await issueMaterials(w, rk.planId, [{ materialId: w.bahanA.id, qty: 2 }]);
  const rev = (await card(w, rk.run.id)).revision;
  const none = await w.febri.api.post(`${V2}/runs/${rk.run.id}/build/materials`, { expectedRevision: rev, racikan: RACIKAN }, key("rec-none"));
  assert.equal(none.status, 403); assert.equal(none.body.code, "BUILD_NO_MATERIAL_OPERATOR");
  const adm = ok(await w.admin.api.post(`${V2}/runs/${rk.run.id}/build/materials`, { expectedRevision: rev, racikan: RACIKAN, materials: [{ materialId: w.bahanA.id, qty: 1 }] }, key("rec-adm")));
  assert.equal(adm.version, 1); assert.equal((await testPrisma.productionBuildMaterialRecord.findFirstOrThrow({ where: { runId: rk.run.id } })).actorId, w.admin.user.id, "jejak atas nama pelaku sebenarnya");
  // non-kasur: racikan kasur ditolak
  ok(await w.lead.api.post(`${V2}/runs/${rd.run.id}/build/material-operator`, { operatorId: w.febriOp.id, expectedRevision: (await card(w, rd.run.id)).revision }, key("as-divan")));
  const rac = await w.febri.api.post(`${V2}/runs/${rd.run.id}/build/materials`, { expectedRevision: (await card(w, rd.run.id)).revision, racikan: RACIKAN }, key("rec-divan"));
  assert.equal(rac.status, 422); assert.equal(rac.body.code, "BUILD_RACIKAN_NOT_APPLICABLE");
  // penugasan ditolak bila pemakaian sudah ada di bukti PIC Meja (hindari hitung ganda)
  const k2 = await mkOrder({ category: "BARU", productLine: "KASUR", productType: "KASUR_BUSA" });
  const r2 = await scheduleOrder(w, k2.unit, { stationCode: "TABLE_3" });
  await issueMaterials(w, r2.planId, [{ materialId: w.bahanB.id, qty: 2 }]);
  ok(await step(w, w.nadya, r2.run.id, 6, {}));
  ok(await step(w, w.nadya, r2.run.id, 6, { payload: { note: "Pengerjaan", racikan: RACIKAN, materials: [{ materialId: w.bahanB.id, qty: 1 }] }, media: await media(w.nadya, r2.run.id, "i") }));
  const late = await w.lead.api.post(`${V2}/runs/${r2.run.id}/build/material-operator`, { operatorId: w.febriOp.id, expectedRevision: (await card(w, r2.run.id)).revision }, key("as-late"));
  assert.equal(late.status, 409); assert.equal(late.body.code, "BUILD_USAGE_ALREADY_IN_EVIDENCE");
  // jalur lama/LAYANAN: command ditolak
  const lay = await mkOrder({ category: "LAYANAN", orderNumber: `LY-${++seq}` });
  await addCohort(lay.unit.id);
  const notBuild = await w.lead.api.post(`${V2}/runs/${rk.run.id}/build/corner`, { expectedRevision: 1, required: "ya" }, key("corner-bad"));
  assert.equal(notBuild.status, 400);
});

test("Corner mengikuti kebutuhan yang dikonfirmasi pada rencana: belum dikonfirmasi menahan QC; tidak perlu = tahap 9–11 'tidak berlaku' beralasan (bukan selesai palsu); dikunci setelah gerbang QC", async () => {
  const w = await world();
  // (a) belum dikonfirmasi -> QC ditahan; konfirmasi diperlukan -> lanjut; setelah QC dikunci
  const a = await mkOrder({ category: "BARU", productLine: "KASUR", productType: "KASUR_SPRING" });
  const ra = await scheduleOrder(w, a.unit, {}, { corner: null });
  assert.deepEqual((await card(w, ra.run.id)).build.corner, { required: null, reason: null, confirmed: false });
  ok(await step(w, w.nadya, ra.run.id, 6, {}));
  ok(await step(w, w.nadya, ra.run.id, 6, { payload: { note: "Selesai", racikan: RACIKAN }, media: await media(w.nadya, ra.run.id, "i") }));
  ok(await step(w, w.nadya, ra.run.id, 8, { payload: { verdict: "PAS", testerWeightKg: 70 }, media: await media(w.nadya, ra.run.id, "v") }));
  let c = await card(w, ra.run.id);
  assert.deepEqual([c.next.wait, c.next.actor], ["CORNER_NOT_CONFIRMED", "PLANNER"]);
  const qcRun = (await w.qc.api.get(`${P}/qc/runs/${ra.run.id}`)).body;
  const qcBody = { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], referenceWeightKg: 70, fitVerdict: "PAS" };
  const held = await w.qc.api.post(`${P}/qc/runs/${ra.run.id}/inspect`, qcBody, key("qc-held"));
  assert.equal(held.status, 409); assert.equal(held.body.code, "QC_CORNER_NOT_CONFIRMED");
  // validasi konfirmasi + izin + idempoten
  assert.equal((await confirmCorner(w, ra.run.id, "ya")).status, 400, "pilihan wajib boolean");
  const noReason = await confirmCorner(w, ra.run.id, false); assert.equal(noReason.status, 400); assert.equal(noReason.body.code, "BUILD_CORNER_REASON_REQUIRED");
  assert.equal((await confirmCorner(w, ra.run.id, false, "x", w.nadya)).status, 403, "PIC Meja tidak boleh mengonfirmasi");
  assert.equal((await w.lead.api.post(`${V2}/runs/${ra.run.id}/build/corner`, { expectedRevision: 1, required: true }, key("corner-stale"))).status, 409);
  ok(await confirmCorner(w, ra.run.id, false, "Tidak ada pekerjaan kain")); // boleh berubah sebelum QC
  assert.equal((await card(w, ra.run.id)).steps.filter((x) => x.status === "NA").map((x) => x.no).join(), "1,2,3,4,5,7,9,10,11");
  const back = ok(await confirmCorner(w, ra.run.id, true)); assert.equal(back.changed, true);
  assert.equal(ok(await confirmCorner(w, ra.run.id, true)).changed, false, "tanpa perubahan = tanpa revisi baru");
  c = await card(w, ra.run.id); assert.equal(c.next.wait, "AWAITING_QC");
  ok(await w.qc.api.post(`${P}/qc/runs/${ra.run.id}/inspect`, { ...qcBody, expectedRevision: (await w.qc.api.get(`${P}/qc/runs/${ra.run.id}`)).body.revision }, key("qc-ok")));
  const locked = await confirmCorner(w, ra.run.id, false, "Terlambat mengubah");
  assert.equal(locked.status, 409); assert.equal(locked.body.code, "BUILD_CORNER_LOCKED");

  // (b) divan, Corner TIDAK diperlukan (non-adaptasi): jalur Meja -> QC generik -> Finish oleh PIC Meja; tanpa tahap/operasi Corner
  const b = await mkOrder({ category: "BARU", productLine: "DIVAN", productType: "DIVAN_UTAMA", services: ["Divan Polos Custom"] });
  const rb = await scheduleOrder(w, b.unit, { stationCode: "TABLE_2" }, { corner: false, cornerReason: "Divan polos, tidak ada kain/jahit" });
  c = await card(w, rb.run.id);
  assert.deepEqual(c.progress, { done: 0, skipped: 0, remaining: 2, total: 2 }, "hanya Pengerjaan Pesanan + Finish");
  for (const n of [8, 9, 10, 11]) { const st = c.steps.find((x) => x.no === n); assert.equal(st.status, "NA", "tahap " + n); }
  assert.match(c.steps.find((x) => x.no === 9).naReason, /Corner tidak diperlukan — Divan polos, tidak ada kain\/jahit/);
  assert.deepEqual(c.build.corner, { required: false, reason: "Divan polos, tidak ada kain/jahit", confirmed: true });
  ok(await step(w, w.nadya, rb.run.id, 6, {}));
  ok(await step(w, w.nadya, rb.run.id, 6, { payload: { note: "Divan polos selesai dirakit" }, media: await media(w.nadya, rb.run.id, "i") }));
  const qb = (await w.qc.api.get(`${P}/qc/runs/${rb.run.id}`)).body;
  assert.equal(qb.qcProfile, "GENERIC"); assert.deepEqual(qb.stages.map((st) => st.code), ["custom_build", "fit_test", "finished"], "tidak ada tahap Jahit Corner di jalur");
  ok(await w.qc.api.post(`${P}/qc/runs/${rb.run.id}/inspect`, { expectedRevision: qb.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], note: "rapi" }, key("qc-div")));
  c = await card(w, rb.run.id);
  assert.deepEqual([c.next.actor, c.next.stepNo, c.next.action], ["TABLE", 12, "FINISH"], "Finish oleh PIC Meja");
  const wrong = await step(w, w.nadya, rb.run.id, 9, { payload: { note: "kirim" }, media: await media(w.nadya, rb.run.id, "i") });
  assert.equal(wrong.status, 409, "tidak ada tahap Kirim ke Corner");
  const meja = ok(await w.nadya.api.get(`${V2}/worker/table`)); assert.ok(meja.items.some((i) => i.runId === rb.run.id), "tetap di antrean Meja");
  const corner = ok(await w.corner.api.get(`${V2}/worker/corner`)); assert.ok(!corner.items.some((i) => i.runId === rb.run.id), "tidak masuk antrean Corner");
  const fin = ok(await step(w, w.nadya, rb.run.id, 12, { payload: { confirm: true }, media: await media(w.nadya, rb.run.id, "i") }));
  assert.ok(fin.handoffId);
  const ops = await testPrisma.productionOperationRun.findMany({ where: { runId: rb.run.id }, orderBy: { sequence: "asc" } });
  assert.deepEqual(ops.map((o) => [o.stageCode, o.status]), [["custom_build", "COMPLETED"], ["finished", "COMPLETED"]], "tidak ada operasi Corner; tidak ada 'selesai palsu'");
  assert.equal(await testPrisma.productionStepEvidence.count({ where: { runId: rb.run.id, stepNo: { in: [9, 10, 11] } } }), 0);
  const fg = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: fin.handoffId } });
  ok(await w.nadya.api.post(`/api/inventory/unit-custody/${fg.id}/accept`, { locationId: w.fg.id, expectedRevision: fg.revision }, key("fg-div")));
  c = await card(w, rb.run.id);
  assert.deepEqual(c.progress, { done: 2, skipped: 0, remaining: 0, total: 2 }); assert.deepEqual(c.steps.filter((x) => x.status === "NA").map((x) => x.no), [1, 2, 3, 4, 5, 7, 8, 9, 10, 11]);
  const report = ok(await w.lead.api.get(`${V2}/runs/${rb.run.id}/report`));
  assert.match(report.message, /Corner : tidak diperlukan — Divan polos/);

  // (c) sofa + adaptasi AKTIF + Corner tidak diperlukan: Selesaikan Produksi; QC dicatat tidak dilakukan; Corner tidak ada (bukan 'dilewati')
  await setAdaptationDefault(testPrisma, { enabled: true, actorId: w.lead.user.id });
  const d = await mkOrder({ category: "BARU", productLine: "SOFA", productType: "SOFA_2_SEATER", services: ["Sofa 2 Seater Custom"] });
  const rd = await scheduleOrder(w, d.unit, { stationCode: "TABLE_3" }, { corner: false, cornerReason: "Sofa rangka saja, kain sudah dari customer" });
  ok(await step(w, w.nadya, rd.run.id, 6, {}));
  ok(await step(w, w.nadya, rd.run.id, 6, { payload: { note: "Sofa selesai dirakit" }, media: await media(w.nadya, rd.run.id, "i") }));
  c = await card(w, rd.run.id);
  assert.deepEqual([c.next.wait, c.next.stepNo], ["READY_TO_FINISH", 12]);
  const done = ok(await w.nadya.api.post(`${V2}/runs/${rd.run.id}/finish`, { expectedRevision: c.revision, workCenterId: w.wc, confirm: true }, key("fin-sofa")));
  assert.equal(done.completed, true); assert.equal(done.unitStatus, "READY_FOR_DELIVERY");
  const opsD = await testPrisma.productionOperationRun.findMany({ where: { runId: rd.run.id }, orderBy: { sequence: "asc" } });
  assert.ok(!opsD.some((o) => o.stageCode === "corner_sewing"), "tidak ada operasi/dilewati untuk Corner — tahap tidak ada di jalur");
  assert.deepEqual(opsD.map((o) => [o.stageCode, o.status]), [["custom_build", "COMPLETED"], ["fit_test", "SKIPPED"], ["finished", "SKIPPED"]]);
  assert.equal(await testPrisma.qualityInspection.count({ where: { runId: rd.run.id } }), 0);
  c = await card(w, rd.run.id);
  assert.equal(c.indicators.qc, "TIDAK_DILAKUKAN"); assert.deepEqual(c.steps.filter((x) => x.status === "NA").map((x) => x.no), [1, 2, 3, 4, 5, 7, 8, 9, 10, 11], "Corner = tidak berlaku, bukan selesai/dilewati");
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: d.unit.id, direction: "FINISHED_GOODS" } }), 0);
});
