// P9D — Diagnosis Produksi + Planned BOM Terpadu. Fokus: draft/submit/revisi, expectedRevision stale, submit
// bersamaan, isolasi multi-unit, bahan manual (tidak direservasi sampai dipetakan), Material Issue
// READY_TO_PICK/ISSUED memblokir revisi BOM, gerbang tahap 5 (layanan+BOM+bahan manual), writer OFF/non-cohort,
// assignment operator, dan BUKTI tidak ada stock movement/journal saat diagnosis.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

let server;
let seq = 0;
const key = (v) => ({ "Idempotency-Key": `p9d-${v}-0001` });
const V2 = "/api/production-v2";

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function setCohort(...unitIds) {
  for (const flagKey of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
    const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "p9d test" };
    await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
  }
}

async function world() {
  const [lead, nadya, corner, otherWorker, wh, driver] = await Promise.all([
    createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["ADMIN", "WAREHOUSE", "PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["PRODUCTION_WORKER"] }), createTestUser({ roles: ["PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["WAREHOUSE"] }), createTestUser({ roles: ["DRIVER"] }),
  ]);
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-P9D-${++seq}`, name: "Workshop P9D" } });
  const nadyaOp = await testPrisma.productionOperator.create({ data: { userId: nadya.user.id, primaryWorkCenterId: workCenter.id } });
  const cornerOp = await testPrisma.productionOperator.create({ data: { userId: corner.user.id, primaryWorkCenterId: workCenter.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-P9D-${++seq}`, name: "Gudang P9D" } });
  const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-P9D-${++seq}` } });
  const materials = [];
  for (let i = 0; i < 3; i++) {
    const m = await testPrisma.material.create({ data: { code: `P9D-MAT-${i}-${++seq}`, name: `Material P9D ${i}`, unit: "PCS", category: "RAW_MATERIAL", active: true } });
    await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 20, note: "seed p9d" } });
    materials.push(m);
  }
  const service = await testPrisma.serviceCatalog.findFirstOrThrow({ where: { active: true } });
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  return { lead: c(lead), nadya: c(nadya), corner: c(corner), otherWorker: c(otherWorker), wh: c(wh), driver: c(driver), wc: workCenter.id, nadyaOp, cornerOp, rcv, materials, service };
}

async function orderWithUnit(w) {
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan P9D ${++seq}`, city: "Bandung" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `P9D-${++seq}`, value: 5_500_000, category: "LAYANAN", beratBadan: 78, complaintCategory: ["SAKIT_PINGGANG"], notes: "Minta lebih empuk" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `P9D-UNIT-${++seq}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP", merk: "King Koil", ukuran: "180x200" } });
  return { customer, order, unit };
}

async function pickupJob(w, unitId, orderId) {
  const route = await testPrisma.route.create({ data: { code: `P9D-RTE-${++seq}`, date: new Date("2026-09-30T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId, routeId: route.id, driverId: w.driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-09-30T00:00:00.000Z") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId } });
  const tag = `p9d-pk-${++seq}`;
  await w.driver.api.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}-s`));
  await w.driver.api.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${tag}-a`));
  const done = await w.driver.api.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/p9d-pod.jpg"], recipientName: "Penjaga", note: "ok", location: null }, key(`${tag}-c`));
  assert.equal(done.status, 200, JSON.stringify(done.body));
}

async function acceptCustody(w, unitId) {
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId, direction: "INBOUND" } });
  const acc = await w.wh.api.post(`/api/inventory/unit-custody/${handoff.id}/accept`, { locationId: w.rcv.id, expectedRevision: 1 }, key(`p9d-accept-${unitId}`));
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  return testPrisma.productionRun.findFirstOrThrow({ where: { unitId } });
}

async function planOnBoard(w, runId) {
  const res = await w.lead.api.post(`${V2}/plans`, { runId, productionDate: "2026-09-30", stationCode: "TABLE_1", priority: 0, workCenterId: w.wc, operatorId: w.nadyaOp.id, cornerOperatorId: w.cornerOp.id }, key(`p9d-plan-${++seq}`));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

// Bawa unit sampai tepat SEBELUM tahap 5 (langkah 1-4 selesai) via jalur asli (bukan raw Prisma) — supaya op
// aktif + stageCode=diagnosis genuinely terbentuk lewat stage engine P5, bukan dipalsukan.
async function reachStep5(w, unit) {
  await pickupJob(w, unit.id, unit.orderId);
  const run = await acceptCustody(w, unit.id);
  await planOnBoard(w, run.id);
  const media1 = await mediaUpload(w.nadya, run.id, false);
  const s1 = await w.nadya.api.post(`${V2}/runs/${run.id}/steps/1`, { expectedRevision: 1, workCenterId: w.wc, payload: { conditionConfirmed: true }, media: [media1] }, key(`p9d-s1-${++seq}`));
  assert.equal(s1.status, 200, JSON.stringify(s1.body));
  const media2 = await mediaUpload(w.nadya, run.id, true);
  const s2 = await w.nadya.api.post(`${V2}/runs/${run.id}/steps/2`, { expectedRevision: s1.body.revision, workCenterId: w.wc, payload: { feelNote: "Terasa keras" }, media: [media2] }, key(`p9d-s2-${++seq}`));
  assert.equal(s2.status, 200, JSON.stringify(s2.body));
  const media3 = await mediaUpload(w.nadya, run.id, false);
  const s3 = await w.nadya.api.post(`${V2}/runs/${run.id}/steps/3`, { expectedRevision: s2.body.revision, workCenterId: w.wc, payload: { oldMaterials: ["PER"], note: "per keropos" }, media: [media3] }, key(`p9d-s3-${++seq}`));
  assert.equal(s3.status, 200, JSON.stringify(s3.body));
  const media4 = await mediaUpload(w.nadya, run.id, true);
  const s4 = await w.nadya.api.post(`${V2}/runs/${run.id}/steps/4`, { expectedRevision: s3.body.revision, workCenterId: w.wc, payload: { heightBeforeCm: 25, heightCompressedCm: 15, testerWeightKg: 70 }, media: [media4] }, key(`p9d-s4-${++seq}`));
  assert.equal(s4.status, 200, JSON.stringify(s4.body));
  return testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } });
}

let fileSeq = 0;
async function mediaUpload(who, runId, video = false) {
  const fd = new FormData();
  fd.append("runId", runId);
  fd.append("files", new Blob([Buffer.from(`p9d-${++fileSeq}-${Math.random()}`)], { type: video ? "video/mp4" : "image/jpeg" }), video ? "d.mp4" : "d.jpg");
  const res = await fetch(`${server.baseUrl}${V2}/evidence/upload`, { method: "POST", headers: { Authorization: `Bearer ${who.token}` }, body: fd });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  return body.items[0].url;
}

const diagnosisEndpoint = (runId) => `${V2}/diagnosis/${runId}`;
const draft = (who, runId, body) => who.api.post(`${diagnosisEndpoint(runId)}/draft`, body);
const submit = (who, runId, body, idem) => who.api.post(`${diagnosisEndpoint(runId)}/submit`, body, key(idem || `p9d-submit-${++seq}`));

function fullFindings(overrides = {}) {
  return {
    general: { condition: "Kasur kempes di tengah", mainDamage: "Fondasi keropos", damageLevel: "SEDANG", teardownNote: "Per karatan" },
    foundation: { oldCondition: "Per karatan", action: "REPLACE", size: "180x200", qty: "1" },
    layers: [{ oldCondition: "Busa tipis", action: "REPLACE", material: "Busa HD", thickness: "5cm", qty: "2" }],
    components: { spring: "Ganti per baru" },
    serviceNote: "Restorasi penuh fondasi dan lapisan atas sesuai keluhan sakit pinggang",
    ...overrides,
  };
}

test("draft: simpan lalu resume dengan expectedRevision benar; revisi basi -> 409", async () => {
  const w = await world();
  const { order, unit } = await orderWithUnit(w);
  await setCohort(unit.id);
  const run = await reachStep5(w, unit);

  const d1 = await draft(w.nadya, run.id, { expectedRevision: 0, workCenterId: w.wc, findings: { general: { condition: "Draft awal" } }, photoUrls: [] });
  assert.equal(d1.status, 200, JSON.stringify(d1.body));
  assert.equal(d1.body.revision, 1);
  assert.equal(d1.body.status, "DRAFT");

  const d2 = await draft(w.nadya, run.id, { expectedRevision: 1, workCenterId: w.wc, findings: { general: { condition: "Draft kedua" } }, photoUrls: [] });
  assert.equal(d2.status, 200, JSON.stringify(d2.body));
  assert.equal(d2.body.revision, 2);
  assert.equal(d2.body.diagnosisId, d1.body.diagnosisId, "baris DRAFT yang SAMA diperbarui di tempat, bukan baris baru");

  const stale = await draft(w.nadya, run.id, { expectedRevision: 1, workCenterId: w.wc, findings: {}, photoUrls: [] });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "DIAGNOSIS_REVISION_CONFLICT");

  const get = await w.nadya.api.get(diagnosisEndpoint(run.id));
  assert.equal(get.body.current.findings.general.condition, "Draft kedua");
});

test("submit: menulis Planned BOM + Unit.serviceId dalam satu transaksi; tahap 5 TETAP TERBUKA sampai lengkap; tidak ada stock movement/journal", async () => {
  const w = await world();
  const { order, unit } = await orderWithUnit(w);
  await setCohort(unit.id);
  const run = await reachStep5(w, unit);

  const stockBefore = await testPrisma.stockMovement.count();

  const photo = await mediaUpload(w.nadya, run.id);
  const res = await submit(w.nadya, run.id, {
    expectedRevision: 0, workCenterId: w.wc, findings: fullFindings(), photoUrls: [photo], recommendedServiceId: w.service.id,
    materials: [{ materialId: w.materials[0].id, qty: 2 }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, "RECORDED");
  assert.equal(res.body.bom.lineCount, 1);

  const stockAfter = await testPrisma.stockMovement.count();
  assert.equal(stockAfter, stockBefore, "submitDiagnosis TIDAK PERNAH menulis stock_movements");
  const journalCount = await testPrisma.finJournalEntry.count().catch(() => 0);
  assert.equal(journalCount, 0, "tidak ada jurnal keuangan dari diagnosis/BOM");

  const unitAfter = await testPrisma.unit.findUnique({ where: { id: unit.id } });
  assert.equal(unitAfter.serviceId, w.service.id, "Unit.serviceId ditulis oleh submitDiagnosis");

  const plan = await testPrisma.productionRunPlan.findFirst({ where: { runId: run.id } });
  const bomLines = await testPrisma.plannedBOMLine.findMany({ where: { planId: plan.id, status: "ACTIVE" } });
  assert.equal(bomLines.length, 1);

  // Layanan sudah diset dan BOM sudah ada, TAPI belum ada bahan manual di test ini — tutup tahap 5 seharusnya BERHASIL.
  const close = await w.nadya.api.post(`${V2}/runs/${run.id}/steps/5`, { expectedRevision: run.revision, workCenterId: w.wc, payload: { diagnosis: "Diagnosis dikirim" }, media: [] }, key(`p9d-close-${++seq}`));
  assert.equal(close.status, 200, JSON.stringify(close.body));
  assert.notEqual(close.body.next.stepNo, 5, "tahap sudah maju melewati 5");
});

test("submit dengan bahan manual: TIDAK masuk Planned BOM/reservasi; tahap 5 TETAP menunggu sampai dipetakan Production Lead", async () => {
  const w = await world();
  const { order, unit } = await orderWithUnit(w);
  await setCohort(unit.id);
  const run = await reachStep5(w, unit);

  const res = await submit(w.nadya, run.id, {
    expectedRevision: 0, workCenterId: w.wc, findings: fullFindings(), photoUrls: [await mediaUpload(w.nadya, run.id)], recommendedServiceId: w.service.id,
    materials: [], manualMaterials: [{ description: "Busa custom import", estimatedUnit: "meter", qty: 3, reason: "Tidak ada di katalog lokal" }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.manualMaterialCount, 1);

  const plan = await testPrisma.productionRunPlan.findFirst({ where: { runId: run.id } });
  const bomLines = await testPrisma.plannedBOMLine.findMany({ where: { planId: plan.id } });
  assert.equal(bomLines.length, 0, "bahan manual TIDAK PERNAH masuk Planned BOM sebelum dipetakan");
  const reservations = await testPrisma.materialReservation.findMany({ where: { planId: plan.id } });
  assert.equal(reservations.length, 0, "bahan manual TIDAK PERNAH direservasi");

  // Tahap 5 belum boleh selesai — layanan sudah diset TAPI bahan manual belum dipetakan DAN BOM masih kosong.
  // Payload `diagnosis` wajib pada panggilan PERTAMA ke steps/5 (mencatat evidence) — panggilan BERIKUTNYA
  // (setelah dipetakan) boleh kosong lewat pola reuseDiagnosis yang sudah ada (evidence sudah tercatat).
  const closeAttempt = await w.nadya.api.post(`${V2}/runs/${run.id}/steps/5`, { expectedRevision: run.revision, workCenterId: w.wc, payload: { diagnosis: "Diagnosis dikirim, menunggu pemetaan bahan manual" }, media: [] }, key(`p9d-close-blocked-${++seq}`));
  assert.equal(closeAttempt.status, 200, JSON.stringify(closeAttempt.body));
  assert.equal(closeAttempt.body.next.stepNo, 5, "tahap 5 tetap terbuka — bahan manual belum dipetakan");

  const manual = await testPrisma.diagnosisManualMaterial.findFirstOrThrow({ where: { diagnosisReport: { runId: run.id } } });
  const mapRes = await w.lead.api.post(`${V2}/diagnosis/manual-materials/${manual.id}/map`, { materialId: w.materials[1].id }, key(`p9d-map-${++seq}`));
  assert.equal(mapRes.status, 200, JSON.stringify(mapRes.body));

  const bomLinesAfter = await testPrisma.plannedBOMLine.findMany({ where: { planId: plan.id, status: "ACTIVE" } });
  assert.equal(bomLinesAfter.length, 1, "setelah dipetakan, bahan manual JADI baris BOM asli lewat setPlannedBOMInTx");

  const runFresh = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } });
  const closeAfterMap = await w.nadya.api.post(`${V2}/runs/${run.id}/steps/5`, { expectedRevision: runFresh.revision, workCenterId: w.wc, payload: {}, media: [] }, key(`p9d-close-after-map-${++seq}`));
  assert.equal(closeAfterMap.status, 200, JSON.stringify(closeAfterMap.body));
  assert.notEqual(closeAfterMap.body.next.stepNo, 5, "tahap 5 sekarang bisa selesai — semua bahan manual sudah dipetakan");
});

test("worker LAIN (bukan operator assigned) ditolak 403 untuk draft/submit", async () => {
  const w = await world();
  const { order, unit } = await orderWithUnit(w);
  await setCohort(unit.id);
  const run = await reachStep5(w, unit);
  const res = await submit(w.otherWorker, run.id, { expectedRevision: 0, workCenterId: w.wc, findings: fullFindings(), photoUrls: [await mediaUpload(w.nadya, run.id)], recommendedServiceId: w.service.id });
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.code, "WORKSHOP_OPERATOR_MISMATCH");
});

test("writer OFF / unit di luar cohort: draft dan submit ditolak 503, TIDAK ada baris diagnosis tertulis", async () => {
  const w = await world();
  const { unit } = await orderWithUnit(w);
  // TIDAK setCohort — writer/reader OFF untuk unit ini. P9A men-gate pembuatan ProductionRun otomatis di
  // belakang cohort yang SAMA, jadi run dibuat LANGSUNG lewat Prisma (pola sama dengan tes "legacy" P9C) — bukan
  // lewat jalur pickup asli (yang tidak akan pernah membuat run untuk unit di luar cohort).
  const run = await testPrisma.productionRun.create({ data: { unitId: unit.id, status: "ACTIVE", kind: "RESTORATION", currentPhase: "PROCESS" } });
  const res = await draft(w.nadya, run.id, { expectedRevision: 0, workCenterId: w.wc, findings: {}, photoUrls: [] });
  assert.equal(res.status, 503, JSON.stringify(res.body));
  const count = await testPrisma.diagnosisReport.count({ where: { runId: run.id } });
  assert.equal(count, 0);
});

test("Material Issue READY_TO_PICK memblokir revisi diagnosis yang mengubah BOM (409), diagnosis versi lama tetap RECORDED", async () => {
  const w = await world();
  const { order, unit } = await orderWithUnit(w);
  await setCohort(unit.id);
  const run = await reachStep5(w, unit);

  const first = await submit(w.nadya, run.id, {
    expectedRevision: 0, workCenterId: w.wc, findings: fullFindings(), photoUrls: [await mediaUpload(w.nadya, run.id)], recommendedServiceId: w.service.id,
    materials: [{ materialId: w.materials[0].id, qty: 2 }],
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));

  const plan = await testPrisma.productionRunPlan.findFirst({ where: { runId: run.id } });
  const reserveRes = await w.wh.api.post(`/api/production-planning/plans/${plan.id}/reserve`, { expectedRevision: plan.revision }, key(`p9d-reserve-${++seq}`));
  assert.equal(reserveRes.status, 200, JSON.stringify(reserveRes.body));

  const issueRes = await w.nadya.api.post(`/api/production-planning/plans/${plan.id}/material-request`, {}, key(`p9d-issue-${++seq}`));
  assert.equal(issueRes.status, 201, JSON.stringify(issueRes.body));

  const revisionAttempt = await submit(w.nadya, run.id, {
    expectedRevision: 1, workCenterId: w.wc, findings: fullFindings({ serviceNote: "Revisi setelah issue dibuat" }), photoUrls: [await mediaUpload(w.nadya, run.id)], recommendedServiceId: w.service.id,
    materials: [{ materialId: w.materials[0].id, qty: 5 }],
  });
  assert.equal(revisionAttempt.status, 409, JSON.stringify(revisionAttempt.body));
  assert.match(revisionAttempt.body.code, /PLAN_MATERIAL_ISSUE_ACTIVE|PLAN_MATERIAL_ALREADY_ISSUED/);

  const stillRecorded = await testPrisma.diagnosisReport.findFirst({ where: { runId: run.id, status: "RECORDED" } });
  assert.ok(stillRecorded, "diagnosis versi lama TETAP RECORDED — revisi yang gagal tidak memutasi apa pun");
});

test("multi-unit: diagnosis dan bahan manual unit A tidak pernah bocor ke unit B", async () => {
  const w = await world();
  const { unit: unitA } = await orderWithUnit(w);
  const { unit: unitB } = await orderWithUnit(w);
  await setCohort(unitA.id, unitB.id);
  const runA = await reachStep5(w, unitA);
  const runB = await reachStep5(w, unitB);

  await submit(w.nadya, runA.id, {
    expectedRevision: 0, workCenterId: w.wc, findings: fullFindings({ serviceNote: "Diagnosis unit A" }), photoUrls: [await mediaUpload(w.nadya, runA.id)], recommendedServiceId: w.service.id,
    manualMaterials: [{ description: "Bahan khusus A", estimatedUnit: "pcs", qty: 1, reason: "custom A" }],
  });

  const getB = await w.nadya.api.get(diagnosisEndpoint(runB.id));
  assert.equal(getB.body.current, null, "unit B belum punya diagnosis sama sekali — tidak bocor dari unit A");

  const draftB = await draft(w.nadya, runB.id, { expectedRevision: 0, workCenterId: w.wc, findings: { general: { condition: "Draft unit B" } }, photoUrls: [] });
  assert.equal(draftB.status, 200);

  const getA = await w.nadya.api.get(diagnosisEndpoint(runA.id));
  assert.equal(getA.body.current.status, "RECORDED");
  assert.equal(getA.body.current.findings.serviceNote, "Diagnosis unit A", "draft unit B tidak menimpa/mempengaruhi diagnosis unit A yang sudah RECORDED");
});
