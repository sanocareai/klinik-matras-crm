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
  const [lead, nadya, corner, qc] = await Promise.all([
    createTestUser({ roles: ["PRODUCTION_LEAD"] }),
    createTestUser({ roles: ["WAREHOUSE", "PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["QC_LEAD"] }),
  ]);
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-BT-${++seq}`, name: "Workshop Utama" } });
  const nadyaOp = await testPrisma.productionOperator.create({ data: { userId: nadya.user.id, primaryWorkCenterId: workCenter.id } });
  const cornerOp = await testPrisma.productionOperator.create({ data: { userId: corner.user.id, primaryWorkCenterId: workCenter.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-BT-${++seq}`, name: "Gudang BT" } });
  const fg = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "FG", locationType: "FINISHED_GOODS_AREA", code: `FG-BT-${++seq}` } });
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  const bahanA = await createTestMaterial({ name: `Pocket Spring BT ${++seq}` });
  const bahanB = await createTestMaterial({ name: `Latex BT ${++seq}` });
  await seedBalance(bahanA.id, 10);
  await seedBalance(bahanB.id, 10);
  return { lead: c(lead), nadya: c(nadya), corner: c(corner), qc: c(qc), wc: workCenter.id, nadyaOp, cornerOp, fg, bahanA, bahanB };
}

// Order nyata Diproses + 1 unit RECEIVED, TANPA pickup/custody/log V1. category menentukan jalur; nomor resi sengaja bisa tidak berawalan NEW-.
async function mkOrder({ category = "BARU", orderNumber = null, unitStatus = "RECEIVED" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Bu Custom ${++seq}` } });
  const order = await testPrisma.order.create({
    data: {
      customerId: customer.id, orderNumber: orderNumber || `NEW-${seq}-BT`, value: 5_000_000, category, status: "PROCESSING", productType: "MULTIBED", beratBadan: 80, notes: "Ukuran khusus 170x210, tekstur medium-firm",
      items: { create: [{ layananName: "Kasur Custom Pocket Spring 170x210", harga: 5_000_000 }] },
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
async function scheduleOrder(w, unit, over = {}) {
  await addCohort(unit.id);
  const res = await w.lead.api.post(`${V2}/plans`, { unitId: unit.id, productionDate: DATE, stationCode: "TABLE_1", priority: 0, workCenterId: w.wc, operatorId: w.nadyaOp.id, cornerOperatorId: w.cornerOp.id, ...over }, key("sch"));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
  return { planId: res.body.planId, run };
}

// Seluruh jalur kerja sampai Konfirmasi Selesai; adaptasi AKTIF = QC dicatat "tidak dilakukan" pada Kirim ke Corner.
async function driveToFinish(w, runId, { adaptation = false, materials = [] } = {}) {
  let c = await card(w, runId);
  assert.deepEqual([c.next.stepNo, c.next.action], [6, "START"], "langsung bisa dikerjakan setelah jadwal + PIC");
  ok(await step(w, w.nadya, runId, 6, {})); // mulai Pengerjaan Pesanan
  c = await card(w, runId);
  assert.deepEqual([c.next.stepNo, c.next.action], [6, "EVIDENCE"]);
  assert.equal(c.activeOp.stageLabel, "Pengerjaan Pesanan");
  ok(await step(w, w.nadya, runId, 6, { payload: { note: "Rangka + pocket spring sesuai spesifikasi Sales 170x210", materials }, media: await media(w.nadya, runId, "v") }));
  const pas = ok(await step(w, w.nadya, runId, 8, { payload: { verdict: "PAS", testerWeightKg: 80 }, media: await media(w.nadya, runId, "v") }));
  if (adaptation) {
    assert.equal((await card(w, runId)).next.qcNotPerformed, true);
  } else {
    assert.equal(pas.awaitingQc, true);
    const qcRun = (await w.qc.api.get(`${P}/qc/runs/${runId}`)).body;
    ok(await w.qc.api.post(`${P}/qc/runs/${runId}/inspect`, { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], referenceWeightKg: 80, fitVerdict: "PAS", note: "lulus" }, key("qc")));
  }
  ok(await step(w, w.nadya, runId, 9, { payload: { note: "siap dibungkus" }, media: await media(w.nadya, runId, "i") }));
  ok(await step(w, w.corner, runId, 10, { payload: { mattressStyle: "PILLOWTOP", fabricSpec: "Knit putih", borderColor: "Abu-abu" } }));
  ok(await step(w, w.corner, runId, 11, { payload: { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, media: await media(w.nadya, runId, "i") }));
  return ok(await step(w, w.corner, runId, 12, { payload: { confirm: true }, media: await media(w.nadya, runId, "i") }));
}

async function assertNoRestorationTraces(unit, run) {
  const evidence = await testPrisma.productionStepEvidence.findMany({ where: { runId: run.id }, select: { stepNo: true } });
  assert.deepEqual(evidence.filter((e) => NA_STEPS.includes(e.stepNo)), [], "tidak ada bukti untuk tahap yang tidak berlaku — tidak dicatat sebagai dikerjakan");
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
  assert.equal(c.customer.productType, "MULTIBED"); assert.equal(c.customer.request, "Ukuran khusus 170x210, tekstur medium-firm");
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
  const over = await step(w, w.nadya, run.id, 6, { payload: { note: "pakai spring", materials: [{ materialId: w.bahanA.id, qty: 5 }] }, media: await media(w.nadya, run.id, "v") });
  assert.equal(over.status, 422); assert.equal(over.body.code, "STEP_MATERIAL_OVER_ISSUED");
  ok(await step(w, w.nadya, run.id, 6, { payload: { note: "pakai spring", materials: [{ materialId: w.bahanA.id, qty: 1 }] }, media: await media(w.nadya, run.id, "v") }));
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
