// Simplifikasi Production slice 2 — flow adaptasi (HTTP nyata): lokasi workshop bawaan, pemetaan layanan, Meja->Corner tanpa QC, lewati tahap, Selesaikan Produksi (pratinjau + konfirmasi),
// retur tertunda, stok keluar sekali, Tunda/Lanjutkan atomik & idempoten, replay, konkurensi, rollback transaksi, izin, run lama tidak berubah.
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

const key = (v) => ({ "Idempotency-Key": `s2-test-${v}-0001` });
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
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-S2-${++seq}`, name: "Workshop Utama" } });
  const nadyaOp = await testPrisma.productionOperator.create({ data: { userId: nadya.user.id, primaryWorkCenterId: workCenter.id } });
  const cornerOp = await testPrisma.productionOperator.create({ data: { userId: corner.user.id, primaryWorkCenterId: workCenter.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-S2-${++seq}`, name: "Gudang P8" } });
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
    data: { customerId: customer.id, orderNumber: `S2O-${++seq}`, value: 1000, category: "LAYANAN", beratBadan: 85, complaintCategory: ["SAKIT_PINGGANG"], notes: "Minta tekstur firm" },
  });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-S2-${++seq}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP", merk: "King Koil", ukuran: "180x200" } });
  const route = await testPrisma.route.create({ data: { code: `S2-RTE-${++seq}`, date: new Date("2026-09-29T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
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
  await PT.qcWhole(server, w.qc, runId); // fase 2: catatan PIC QC / lapisan awal (gerbang tahap 2)
  ok(await step(w, w.nadya, runId, 2, { payload: { feelNote: "Tengah terasa amblas" }, media: await media(w.nadya, runId, "v") }));
  await PT.layersBefore(server, w.nadya, runId); // fase 2: catatan PIC QC / lapisan awal (gerbang tahap 3)
  ok(await step(w, w.nadya, runId, 3, { payload: { oldMaterials: ["PER", { type: "BUSA", note: "kuning kempes" }] }, media: await media(w.nadya, runId, "i", "i") }));
  await PT.foundationTest(server, w.qc, runId); // fase 2: catatan PIC QC / lapisan awal (gerbang tahap 4)
  ok(await step(w, w.nadya, runId, 4, { payload: { heightBeforeCm: 24, heightCompressedCm: 17, testerWeightKg: 85, foundationIssues: ["Per tengah lemah"] }, media: await media(w.nadya, runId, "v") }));
}

const DIAG = { diagnosis: "Per tengah lemah dan busa penopang kempes sehingga pinggang melengkung saat tidur.", inputMethod: "TEXT" };

// ---------------------------------------------------------------- helper slice 2 ----------------------------------------------------------------------------------------------------
const admin = async () => { const u = await createTestUser({ roles: ["ADMIN"] }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
const setSetting = (k, value) => testPrisma.productionSetting.upsert({ where: { key: k }, create: { key: k, value }, update: { value } });
const enableAdaptationDefault = () => setSetting("adaptation_default_policy", { policy: "ADAPTATION_V1" });
const balanceOf = async (materialId) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId }, _sum: { qty: true } }))._sum.qty || 0);

// Unit sampai pickup selesai (custody INBOUND OFFERED), TANPA diterima Gudang.
async function offeredUnit(w) {
  const customer = await testPrisma.customer.create({ data: { name: `Ibu Tiba ${++seq}` } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `S2T-${++seq}`, value: 1000, category: "LAYANAN" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-S2T-${++seq}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP" } });
  const route = await testPrisma.route.create({ data: { code: `S2T-RTE-${++seq}`, date: new Date("2026-09-29T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, driverId: w.driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-09-29T00:00:00.000Z") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  await addCohort(unit.id);
  const tag = `off-${++seq}`;
  await w.driver.api.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}-s`));
  await w.driver.api.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${tag}-a`));
  ok(await w.driver.api.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga", note: "ok", location: null }, key(`${tag}-c`)));
  return { unit, order };
}

// Run sampai uji tekstur PAS (tahap 8). usedLapisan = qty lapisan yang dipakai (sisa = 2 - usedLapisan menjadi retur wajib).
async function runThrough8(w, { usedLapisan = 2 } = {}) {
  const { unit, run } = await acceptedUnit(w);
  const planned = await planOnBoard(w, run.id);
  await throughIntake(w, run.id);
  ok(await step(w, w.nadya, run.id, 5, { payload: DIAG }));
  await testPrisma.unit.update({ where: { id: unit.id }, data: { serviceId: w.service.id, serviceLine: w.service.serviceLine } });
  const issueId = await setBomAndIssue(w, planned.planId);
  ok(await step(w, w.nadya, run.id, 5, {}));
  await pick(w, issueId);
  ok(await step(w, w.nadya, run.id, 6, {}));
  ok(await step(w, w.nadya, run.id, 6, { payload: { note: "Pocket spring baru + penguat pinggir", materials: [{ materialId: w.fondasi.id, qty: 1 }] }, media: await media(w.nadya, run.id, "v") }));
  ok(await step(w, w.nadya, run.id, 7, { payload: usedLapisan ? { materials: [{ materialId: w.lapisan.id, qty: usedLapisan }] } : { note: "lapisan tidak dipakai" }, media: await media(w.nadya, run.id, "i") }));
  const pas = ok(await step(w, w.nadya, run.id, 8, { payload: { verdict: "PAS", testerWeightKg: 85 }, media: await media(w.nadya, run.id, "v") }));
  return { unit, run, planned, issueId, pas };
}
async function cornerSteps(w, runId) {
  ok(await step(w, w.corner, runId, 10, { payload: { mattressStyle: "PILLOWTOP", fabricSpec: "Knitting putih quilting", borderColor: "Abu-abu tua" } }));
  ok(await step(w, w.corner, runId, 11, { payload: { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, media: await media(w.nadya, runId, "i", "v") }));
  return ok(await step(w, w.corner, runId, 12, { payload: { confirm: true }, media: await media(w.nadya, runId, "i") }));
}
const finishPost = async (w, who, runId, { confirm = true, tag = `fin-${++seq}`, wc = w.wc } = {}) => {
  const c = await card(w, runId);
  return who.api.post(`${V2}/runs/${runId}/finish`, { expectedRevision: c.revision, workCenterId: wc, ...(confirm ? { confirm: true } : {}) }, key(tag));
};
async function toFinishReady(w, opts) {
  const r = await runThrough8(w, opts);
  ok(await step(w, w.nadya, r.run.id, 9, { payload: { note: "siap dibungkus" }, media: await media(w.nadya, r.run.id, "i") }));
  const fin12 = await cornerSteps(w, r.run.id);
  return { ...r, fin12 };
}

test("A. Unit Tiba di Workshop satu aksi: lokasi bawaan belum dikonfigurasi = 409 untuk Admin (tanpa lokasi acak/tiba palsu); izin atur; lokasi valid -> custody ACCEPTED nyata", async () => {
  const w = await world(); const a = await admin();
  const { unit } = await offeredUnit(w);
  const cfg0 = ok(await w.lead.api.get(`${V2}/arrival-config`));
  assert.deepEqual([cfg0.configured, cfg0.valid, cfg0.needs], [false, false, "ADMIN_CONFIGURATION"]);
  const noLoc = await w.lead.api.post(`${V2}/units/${unit.id}/confirm-arrival`, {}, key("arr-0"));
  assert.equal(noLoc.status, 409); assert.equal(noLoc.body.code, "WORKSHOP_DEFAULT_LOCATION_NOT_CONFIGURED"); assert.match(noLoc.body.error, /Admin/);
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id, status: "ACCEPTED" } }), 0, "tidak ada kedatangan palsu");
  assert.equal((await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } })).status, "PENDING_ARRIVAL");

  assert.equal((await w.lead.api.put(`${V2}/settings/workshop-location`, { locationId: w.rcv.id })).status, 403);
  assert.equal((await w.lead.api.get(`${V2}/settings`)).status, 200, "Lead boleh melihat");
  assert.equal((await w.corner.api.get(`${V2}/settings`)).status, 403);
  const wrongType = await a.api.put(`${V2}/settings/workshop-location`, { locationId: w.fg.id });
  assert.equal(wrongType.status, 422); assert.equal(wrongType.body.code, "SETTING_LOCATION_INVALID");
  ok(await a.api.put(`${V2}/settings/workshop-location`, { locationId: w.rcv.id }));
  assert.equal(ok(await w.lead.api.get(`${V2}/arrival-config`)).valid, true);

  await testPrisma.storageLocation.update({ where: { id: w.rcv.id }, data: { active: false } });
  const inactive = await w.lead.api.post(`${V2}/units/${unit.id}/confirm-arrival`, {}, key("arr-1"));
  assert.equal(inactive.status, 409); assert.equal(inactive.body.code, "WORKSHOP_DEFAULT_LOCATION_INVALID");
  await testPrisma.storageLocation.update({ where: { id: w.rcv.id }, data: { active: true } });

  const arrived = ok(await w.lead.api.post(`${V2}/units/${unit.id}/confirm-arrival`, {}, key("arr-2")));
  assert.equal(arrived.status, "ACCEPTED"); assert.equal(arrived.locationId, w.rcv.id);
  const replay = ok(await w.lead.api.post(`${V2}/units/${unit.id}/confirm-arrival`, {}, key("arr-2")));
  assert.equal(replay.replayed, true);
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id, direction: "INBOUND", status: "ACCEPTED" } }), 1);
  assert.equal((await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } })).status, "ACTIVE");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).storageLocation, (await testPrisma.storageLocation.findUniqueOrThrow({ where: { id: w.rcv.id } })).code);
});

test("B. Diagnosis tanpa layanan teknis: pakai pemetaan Sales->produksi kanonis; belum dipetakan = 409 ke Pengaturan Admin (nama tidak ditebak); operator tidak memilih layanan", async () => {
  const w = await world(); const a = await admin();
  const { unit, run } = await acceptedUnit(w);
  await planOnBoard(w, run.id);
  await throughIntake(w, run.id);
  const item = await testPrisma.orderItem.create({ data: { orderId: unit.orderId, layananName: w.service.labelId, harga: 1000, sortOrder: 0 } }); // nama SAMA dengan layanan produksi — tidak boleh dipakai menebak
  const photo = (await media(w.nadya, run.id, "i"))[0];
  const body = {
    expectedRevision: 0, workCenterId: w.wc, photoUrls: [photo], materials: [{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.lapisan.id, qty: 2 }],
    findings: { general: { condition: "Kasur kempes di tengah", mainDamage: "Fondasi keropos", damageLevel: "SEDANG", teardownNote: "Per karatan" }, foundation: { oldCondition: "Per karatan", action: "REPLACE", size: "180x200", qty: "1" }, layers: [{ oldCondition: "Busa tipis", action: "REPLACE", material: "Busa HD", thickness: "5cm", qty: "2" }], components: { spring: "Ganti per baru" }, serviceNote: "Restorasi penuh fondasi dan lapisan atas sesuai keluhan sakit pinggang" },
  };
  const needs = await w.nadya.api.post(`${V2}/diagnosis/${run.id}/submit`, body, key("diag-nomap"));
  assert.equal(needs.status, 409); assert.equal(needs.body.code, "DIAGNOSIS_SERVICE_MAPPING_NEEDED"); assert.equal(needs.body.details.needs, "ADMIN_CONFIGURATION"); assert.match(needs.body.error, /Pengaturan Produksi/);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).serviceId, null, "nama tidak ditebak");
  assert.equal(await testPrisma.diagnosisReport.count({ where: { runId: run.id, status: "RECORDED" } }), 0, "gagal = rollback penuh");

  const pi = await testPrisma.priceItem.create({ data: { code: `S2-PI-${++seq}`, name: w.service.labelId, productLine: "KASUR", kind: "SERVICE" } });
  await testPrisma.orderItem.update({ where: { id: item.id }, data: { priceItemId: pi.id } });
  assert.equal((await w.lead.api.put(`${V2}/settings/service-mappings/${pi.id}`, { serviceId: w.service.id })).status, 403);
  const list = ok(await a.api.get(`${V2}/settings/service-mappings`));
  assert.equal(list.items.find((i) => i.id === pi.id).mapped, false);
  ok(await a.api.put(`${V2}/settings/service-mappings/${pi.id}`, { serviceId: w.service.id }));
  const done = await w.nadya.api.post(`${V2}/diagnosis/${run.id}/submit`, body, key("diag-map"));
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).serviceId, w.service.id);
  const ev = await testPrisma.activityEvent.findFirstOrThrow({ where: { entityId: unit.id, eventType: "SERVICE_ASSIGNED" } });
  assert.equal(ev.metadata.resolvedBy, "MAPPING");
});

test("C. Lifecycle ADAPTASI penuh: Meja -> Corner TANPA putusan QC; Selesaikan Produksi (pratinjau + konfirmasi) -> Siap Kirim; QC TIDAK DILAKUKAN; tanpa custody ACCEPTED; stok keluar sekali; satu job Delivery", async () => {
  const w = await world(); await enableAdaptationDefault();
  const { unit, run, issueId, pas } = await runThrough8(w);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).adaptationPolicy, "ADAPTATION_V1");
  assert.equal(pas.awaitingQc, undefined, "adaptasi: tahap kerja terakhir tidak masuk antrean QC");
  assert.deepEqual([pas.next.actor, pas.next.stepNo, pas.next.action, pas.next.qcNotPerformed], ["TABLE", 9, "HANDOFF", true]);

  const nine = ok(await step(w, w.nadya, run.id, 9, { payload: { note: "siap dibungkus" }, media: await media(w.nadya, run.id, "i") }));
  assert.deepEqual([nine.next.actor, nine.next.stepNo, nine.next.action], ["CORNER", 10, "START_CORNER"]);
  const gateLog = await testPrisma.unitStageLog.findFirstOrThrow({ where: { unitId: unit.id, action: "SKIP" } });
  assert.match(gateLog.note, /QC TIDAK DILAKUKAN/); assert.doesNotMatch(gateLog.note, /WAIVED/);
  assert.equal(await testPrisma.qcFitTest.count({ where: { unitId: unit.id } }), 0, "tidak ada hasil uji yang dikarang");
  assert.equal(await testPrisma.qualityInspection.count({ where: { runId: run.id } }), 0);
  assert.equal((await testPrisma.productionOperationRun.findFirstOrThrow({ where: { runId: run.id, status: "SKIPPED" } })).planSnapshot.qcNotPerformed, true);
  const fin12 = await cornerSteps(w, run.id);
  assert.equal(fin12.handoffId, undefined, "tidak ada penawaran barang jadi"); assert.equal(fin12.next.wait, "READY_TO_FINISH");
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id, direction: "FINISHED_GOODS" } }), 0);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "IN_PRODUCTION");

  const prev = ok(await w.nadya.api.get(`${V2}/runs/${run.id}/finish-preview`));
  assert.equal(prev.adaptation, true); assert.equal(prev.canFinish, true); assert.deepEqual(prev.remainingStages, []); assert.deepEqual(prev.expectedReturns, []);
  const before = { ev: await evidenceCount(run.id), cmds: await testPrisma.v2Command.count() };
  const noConfirm = await finishPost(w, w.nadya, run.id, { confirm: false });
  assert.equal(noConfirm.status, 400); assert.equal(noConfirm.body.code, "FINISH_CONFIRM_REQUIRED");
  assert.deepEqual({ ev: await evidenceCount(run.id), cmds: await testPrisma.v2Command.count() }, before);
  assert.equal((await finishPost(w, w.driver, run.id)).status, 403, "bukan PIC yang ditugaskan (Meja maupun Corner)");
  const rev = (await card(w, run.id)).revision;
  const done = ok(await w.nadya.api.post(`${V2}/runs/${run.id}/finish`, { expectedRevision: rev, workCenterId: w.wc, confirm: true }, key("fin-c")));
  assert.deepEqual([done.completed, done.unitStatus, done.qc, done.handoffGudang], [true, "READY_FOR_DELIVERY", "SUDAH_DILAKUKAN", "TIDAK_DIWAJIBKAN"].map((v, i) => (i === 2 ? "TIDAK_DILAKUKAN" : v)));

  const r = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id }, include: { phases: true } });
  assert.equal(r.status, "COMPLETED");
  const ph = Object.fromEntries(r.phases.map((p) => [p.phase, p.status]));
  assert.equal(ph.QC, "NOT_APPLICABLE"); assert.equal(ph.HANDOFF, "NOT_APPLICABLE"); assert.equal(ph.PROCESS, "COMPLETED");
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id, direction: "FINISHED_GOODS" } }), 0, "tidak ada custody ACCEPTED palsu");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "READY_FOR_DELIVERY");
  assert.equal(await testPrisma.jobUnit.count({ where: { unitId: unit.id, job: { type: "DELIVERY" } } }), 1, "satu handoff Delivery, tanpa job ganda");
  assert.equal(await testPrisma.stockMovement.count({ where: { materialIssueId: issueId } }), 2, "stok keluar sekali per bahan");
  assert.equal(await testPrisma.productionMaterialReturn.count({ where: { runId: run.id } }), 0, "terpakai semua: tidak ada retur");

  const cmds = await testPrisma.v2Command.count();
  const again = ok(await w.nadya.api.post(`${V2}/runs/${run.id}/finish`, { expectedRevision: rev, workCenterId: w.wc, confirm: true }, key("fin-c")));
  assert.equal(again.replayed, true); assert.equal(await testPrisma.v2Command.count(), cmds);
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "production.run.completed", aggregateId: run.id } }), 1);
  // KPI/laporan unit: adaptasi tanpa tahap dilewati tetap dibedakan dari proses lengkap; QC "Tidak dilakukan" bukan lulus
  const kpi = ok(await w.lead.api.get(`${V2}/reports/units`));
  const kRow = kpi.tables[0].rows.find((r) => r.runId === run.id);
  assert.ok(kRow, "run ada di laporan unit"); assert.equal(kRow.completion, "Adaptasi (semua tahap dikerjakan)"); assert.equal(kRow.skippedSteps, 0); assert.equal(kRow.qcFirst, "Tidak dilakukan");
});

test("D. Lewati tahap (adaptasi): SKIPPED + actor + alasan 'Adaptasi sistem', tanpa foto/hasil uji; progres dikerjakan/dilewati/tersisa; izin; run tanpa kebijakan ditolak; kebijakan tersimpan per run", async () => {
  const w = await world(); await enableAdaptationDefault();
  const { unit, run } = await acceptedUnit(w);
  await planOnBoard(w, run.id);
  const rev = (await card(w, run.id)).revision;
  assert.equal((await w.corner.api.post(`${V2}/runs/${run.id}/steps/1/skip`, { expectedRevision: rev, workCenterId: w.wc }, key("sk-403"))).status, 403, "bukan PIC");
  const wrongStep = await w.nadya.api.post(`${V2}/runs/${run.id}/steps/3/skip`, { expectedRevision: rev, workCenterId: w.wc }, key("sk-order"));
  assert.equal(wrongStep.status, 409); assert.equal(wrongStep.body.code, "STEP_OUT_OF_ORDER");
  const s = ok(await w.nadya.api.post(`${V2}/runs/${run.id}/steps/1/skip`, { expectedRevision: rev, workCenterId: w.wc, note: "unit sudah dibongkar di tempat lain" }, key("sk-1")));
  assert.deepEqual(s.skippedSteps, [1, 2]);
  const rows = await testPrisma.productionStepEvidence.findMany({ where: { runId: run.id }, orderBy: { stepNo: "asc" } });
  assert.deepEqual(rows.map((r) => r.stepNo), [1, 2]);
  for (const r of rows) { assert.equal(r.payload.outcome, "SKIPPED"); assert.equal(r.payload.reason, "Adaptasi sistem"); assert.deepEqual(r.media, []); assert.ok(r.actorId, "actor tercatat"); assert.ok(r.createdAt, "waktu tercatat"); }
  const log = await testPrisma.unitStageLog.findFirstOrThrow({ where: { unitId: unit.id, action: "SKIP" } });
  assert.match(log.note, /SKIPPED — Adaptasi sistem/); assert.deepEqual(log.photoUrls, []);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: unit.id, eventType: "PRODUCTION_STEP_SKIPPED" } }), 1);
  const c = await card(w, run.id);
  assert.equal(c.progress.skipped, 2); assert.equal(c.progress.done, 0); assert.equal(c.progress.remaining, c.progress.total - 2);
  assert.deepEqual(c.steps.filter((x) => x.status === "SKIPPED").map((x) => x.no), [1, 2]);
  const again = ok(await w.nadya.api.post(`${V2}/runs/${run.id}/steps/1/skip`, { expectedRevision: rev, workCenterId: w.wc, note: "unit sudah dibongkar di tempat lain" }, key("sk-1")));
  assert.equal(again.replayed, true); assert.equal(await testPrisma.productionStepEvidence.count({ where: { runId: run.id, stepNo: 1 } }), 1);

  await testPrisma.productionSetting.deleteMany({});
  const old = await acceptedUnit(w);
  await planOnBoard(w, old.run.id, { station: "TABLE_2" });
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: old.run.id } })).adaptationPolicy, null);
  const noPolicy = await w.nadya.api.post(`${V2}/runs/${old.run.id}/steps/1/skip`, { expectedRevision: (await card(w, old.run.id)).revision, workCenterId: w.wc }, key("sk-old"));
  assert.equal(noPolicy.status, 409); assert.equal(noPolicy.body.code, "ADAPTATION_NOT_ENABLED");
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).adaptationPolicy, "ADAPTATION_V1", "kebijakan tersimpan PER RUN");
  const rev2 = (await card(w, old.run.id)).revision;
  assert.equal((await w.corner.api.post(`${V2}/runs/${old.run.id}/adaptation`, { expectedRevision: rev2 }, key("ap-403"))).status, 403);
  const ap = ok(await w.lead.api.post(`${V2}/runs/${old.run.id}/adaptation`, { expectedRevision: rev2, reason: "keputusan Owner" }, key("ap-1")));
  assert.equal(ap.changed, true);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: old.run.id } })).adaptationPolicy, "ADAPTATION_V1");
});

test("E. Retur tertunda: sisa bahan wajib kembali ke Gudang sebelum produksi diselesaikan (tidak dilewati diam-diam); stok RETURN sekali; pratinjau menampilkan sisa", async () => {
  const w = await world(); await enableAdaptationDefault();
  const { unit, run, issueId } = await toFinishReady(w, { usedLapisan: 1 });
  const prev = ok(await w.nadya.api.get(`${V2}/runs/${run.id}/finish-preview`));
  assert.equal(prev.expectedReturns.length, 1); assert.equal(prev.expectedReturns[0].qty, 1);
  const stockBefore = await balanceOf(w.lapisan.id);
  const first = ok(await finishPost(w, w.nadya, run.id, { tag: "fin-e1" }));
  assert.equal(first.completed, false); assert.equal(first.waitingFor, "GUDANG_RETUR"); assert.match(first.message, /Gudang/);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).status, "ACTIVE");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "IN_PRODUCTION");
  const rows = await testPrisma.productionMaterialReturn.findMany({ where: { runId: run.id } });
  assert.equal(rows.length, 1); assert.equal(rows[0].status, "PENDING");
  assert.equal(await balanceOf(w.lapisan.id), stockBefore, "stok belum berubah sebelum Gudang menerima");
  const second = ok(await finishPost(w, w.nadya, run.id, { tag: "fin-e2" }));
  assert.equal(second.completed, false); assert.equal(await testPrisma.productionMaterialReturn.count({ where: { runId: run.id } }), 1);
  ok(await w.nadya.api.post(`${V2}/material-returns/${rows[0].id}/receive`, { expectedRevision: rows[0].revision }, key("rcv-e")));
  assert.equal(await balanceOf(w.lapisan.id), stockBefore + 1);
  const done = ok(await finishPost(w, w.nadya, run.id, { tag: "fin-e3" }));
  assert.equal(done.completed, true);
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "RETURN" } }), 1, "stok RETURN tepat sekali");
  assert.equal(await testPrisma.stockMovement.count({ where: { materialIssueId: issueId } }), 2, "ISSUE tidak berubah");
});

test("C2. PIC Corner yang ditugaskan juga boleh menutup (tahap terakhir dikerjakan Corner); PIC Meja tetap boleh; non-PIC ditolak tanpa tulisan", async () => {
  const w = await world(); await enableAdaptationDefault();
  const { unit, run } = await toFinishReady(w, { usedLapisan: 2 });
  const before = { ev: await evidenceCount(run.id), cmds: await testPrisma.v2Command.count() };
  assert.equal((await finishPost(w, w.driver, run.id, { tag: "fin-c2-no" })).status, 403);
  assert.equal((await finishPost(w, w.qc, run.id, { tag: "fin-c2-qc" })).status, 403);
  assert.deepEqual({ ev: await evidenceCount(run.id), cmds: await testPrisma.v2Command.count() }, before, "penolakan tidak menulis apa pun");
  const done = ok(await finishPost(w, w.corner, run.id, { tag: "fin-c2-ok" }));
  assert.equal(done.completed, true); assert.equal(done.unitStatus, "READY_FOR_DELIVERY");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "READY_FOR_DELIVERY");
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id, direction: "FINISHED_GOODS" } }), 0, "tanpa custody ACCEPTED palsu");
});

test("F. Selesaikan Produksi menutup SEMUA tahap tersisa sebagai DILEWATI (pratinjau menyebutnya); yang sudah dilewati tidak digandakan; tanpa foto/hasil/QC/custody palsu; operasi aktif memblokir", async () => {
  const w = await world(); await enableAdaptationDefault();
  const { unit, run } = await acceptedUnit(w);
  await planOnBoard(w, run.id);
  const rev = (await card(w, run.id)).revision;
  ok(await w.nadya.api.post(`${V2}/runs/${run.id}/steps/1/skip`, { expectedRevision: rev, workCenterId: w.wc }, key("sk-f")));
  const prev = ok(await w.nadya.api.get(`${V2}/runs/${run.id}/finish-preview`));
  assert.equal(prev.canFinish, true); assert.ok(prev.remainingStages.length >= 2); assert.ok(prev.willSkipSteps.length >= 8); assert.match(prev.statement, /DILEWATI/);
  assert.equal(prev.progress.worked, 0);
  const done = ok(await finishPost(w, w.nadya, run.id, { tag: "fin-f1" }));
  assert.equal(done.completed, true);
  const ev = await testPrisma.productionStepEvidence.findMany({ where: { runId: run.id } });
  assert.ok(ev.every((e) => e.payload.outcome === "SKIPPED" && e.media.length === 0 && e.payload.reason === "Adaptasi sistem"), "semua bukti = SKIPPED");
  assert.equal(new Set(ev.map((e) => e.stepNo)).size, ev.length, "tahap 1-2 yang sudah dilewati tidak digandakan");
  assert.equal(await testPrisma.qualityInspection.count({ where: { runId: run.id } }), 0);
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id, direction: "FINISHED_GOODS" } }), 0);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).status, "COMPLETED");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "READY_FOR_DELIVERY");
  // Laporan run: bukti SKIPPED bukan pekerjaan — tanpa PIC/hasil/finishing palsu, QC "tidak dilakukan", tahap dilewati terdaftar, pesan Sales tidak berisi nilai kosong
  const rep = ok(await w.lead.api.get(`${V2}/runs/${run.id}/report`));
  assert.equal(rep.adaptation, true); assert.equal(rep.ready, true); assert.equal(rep.qcStatus, "TIDAK_DILAKUKAN"); assert.equal(rep.qc, null);
  assert.equal(rep.finalTest, null); assert.equal(rep.finishing, null); assert.deepEqual(rep.textureTests, []); assert.equal(rep.cornerChecklist, null);
  assert.equal(rep.skippedSteps.length, ev.length); assert.ok(rep.skippedSteps.every((s) => s.label && s.reason === "Adaptasi sistem"));
  assert.equal(rep.mediaCount, 0, "tidak ada foto palsu");
  { const kRow = ok(await w.lead.api.get(`${V2}/reports/units`)).tables[0].rows.find((r) => r.runId === run.id); assert.equal(kRow.completion, "Adaptasi (tahap dilewati)"); assert.ok(kRow.skippedSteps > 0); assert.equal(kRow.qcFirst, "Tidak dilakukan"); }
  assert.doesNotMatch(rep.message, /undefined|Hasil Tekstur|Finishing\s+:/); assert.match(rep.message, /Tahap dilewati \(Adaptasi sistem\)/); assert.match(rep.message, /tidak dilakukan \(mode adaptasi\) — bukan lulus/); assert.match(rep.message, /SIAP KIRIM \(mode adaptasi/);
  // pekerjaan nyata (bukan dilewati) memblokir: tahap 1 dikerjakan -> operasi aktif
  const g = await acceptedUnit(w);
  await planOnBoard(w, g.run.id, { station: "TABLE_3" });
  ok(await step(w, w.nadya, g.run.id, 1, { payload: { conditionConfirmed: true }, media: await media(w.nadya, g.run.id, "i") }));
  const p2 = ok(await w.nadya.api.get(`${V2}/runs/${g.run.id}/finish-preview`));
  assert.equal(p2.canFinish, false); assert.equal(p2.blockers[0].code, "ACTIVE_OPERATION"); assert.equal(p2.progress.worked, 1);
  const blocked = await finishPost(w, w.nadya, g.run.id, { tag: "fin-f0" });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, "FINISH_ACTIVE_OPERATION");
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: g.run.id } })).status, "ACTIVE");
});

test("G. Tunda/Lanjutkan di papan: alasan Menunggu arahan/Kendala/Lainnya (Lainnya wajib keterangan); Lanjutkan SATU aksi atomik+idempoten; Menunggu bahan tidak terbuka sebelum Gudang menyelesaikan; izin", async () => {
  const w = await world();
  const { unit, run } = await acceptedUnit(w);
  const planned = await planOnBoard(w, run.id);
  await throughIntake(w, run.id);
  await testPrisma.unit.update({ where: { id: unit.id }, data: { serviceId: w.service.id, serviceLine: w.service.serviceLine } });
  const issueId = await setBomAndIssue(w, planned.planId);
  await pick(w, issueId);
  ok(await step(w, w.nadya, run.id, 5, { payload: DIAG }));
  let c = await card(w, run.id);
  assert.equal(c.activeOp.status, "ACTIVE");
  const bad = await w.nadya.api.post(`${V2}/runs/${run.id}/delay`, { expectedRevision: c.revision, workCenterId: w.wc, reason: "BAHAN" }, key("dl-bad"));
  assert.equal(bad.status, 400); assert.equal(bad.body.code, "DELAY_REASON_INVALID");
  const noNote = await w.nadya.api.post(`${V2}/runs/${run.id}/delay`, { expectedRevision: c.revision, workCenterId: w.wc, reason: "LAINNYA" }, key("dl-note"));
  assert.equal(noNote.status, 400); assert.equal(noNote.body.code, "DELAY_NOTE_REQUIRED");
  assert.equal((await w.corner.api.post(`${V2}/runs/${run.id}/delay`, { expectedRevision: c.revision, workCenterId: w.wc, reason: "ARAHAN" }, key("dl-403"))).status, 403);
  const d = ok(await w.nadya.api.post(`${V2}/runs/${run.id}/delay`, { expectedRevision: c.revision, workCenterId: w.wc, reason: "KENDALA", note: "mesin potong macet" }, key("dl-ok")));
  assert.equal(d.status, "PAUSED"); assert.equal(d.delayKind, "KENDALA");
  const op = await testPrisma.productionOperationRun.findFirstOrThrow({ where: { runId: run.id, status: "PAUSED" } });
  assert.deepEqual([op.delayKind, op.delayNote], ["KENDALA", "mesin potong macet"]);
  const pause = await testPrisma.unitStageLog.findFirstOrThrow({ where: { unitId: unit.id, action: "PAUSE" } });
  assert.equal(pause.pauseReason, "PROCESS_DELAY", "kontrak jeda yang ada dipakai; enum tidak berubah");
  assert.equal((await w.nadya.api.post(`${V2}/runs/${run.id}/delay`, { expectedRevision: d.revision, workCenterId: w.wc, reason: "ARAHAN" }, key("dl-again"))).body.code, "DELAY_ALREADY_DELAYED");

  assert.equal((await w.corner.api.post(`${V2}/units/${unit.id}/resume-work`, {}, key("rs-403"))).status, 403);
  const r1 = ok(await w.nadya.api.post(`${V2}/units/${unit.id}/resume-work`, {}, key("rs-1")));
  assert.deepEqual([r1.resumed, r1.alreadyActive, r1.path], [true, false, "PAPAN"]);
  const replay = ok(await w.nadya.api.post(`${V2}/units/${unit.id}/resume-work`, {}, key("rs-1")));
  assert.equal(replay.replayed, true);
  const second = ok(await w.nadya.api.post(`${V2}/units/${unit.id}/resume-work`, {}, key("rs-2")));
  assert.deepEqual([second.resumed, second.alreadyActive], [false, true]);
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: unit.id, action: "RESUME" } }), 1, "tepat satu RESUME");
  const opAfter = await testPrisma.productionOperationRun.findUniqueOrThrow({ where: { id: op.id } });
  assert.deepEqual([opAfter.status, opAfter.delayKind], ["ACTIVE", null]);

  c = await card(w, run.id);
  ok(await w.nadya.api.post(`${V2}/runs/${run.id}/delay`, { expectedRevision: c.revision, workCenterId: w.wc, reason: "ARAHAN" }, key("dl-2")));
  const [x, y] = await Promise.all([1, 2].map((n) => w.nadya.api.post(`${V2}/units/${unit.id}/resume-work`, {}, key(`rs-par-${n}`))));
  assert.ok([x.status, y.status].every((s) => [200, 409, 500].includes(s)), `${x.status}/${y.status}`);
  assert.ok([x.status, y.status].includes(200));
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: unit.id, action: "RESUME" } }), 2, "satu RESUME per penundaan, tidak ganda");

  c = await card(w, run.id);
  const extra = await createTestMaterial({ name: `S2 Extra ${++seq}` });
  const sh = await w.nadya.api.post(`${V2}/runs/${run.id}/material-shortage`, { expectedRevision: c.revision, workCenterId: w.wc, items: [{ materialId: extra.id, qty: 1 }] }, key("sh-1"));
  assert.equal(sh.status, 201, JSON.stringify(sh.body));
  const early = await w.nadya.api.post(`${V2}/units/${unit.id}/resume-work`, {}, key("rs-early"));
  assert.equal(early.status, 409); assert.equal(early.body.code, "RESUME_WAITING_MATERIAL"); assert.equal(early.body.details.waitingFor, "GUDANG");
  const shortage = await testPrisma.productionMaterialShortage.findFirstOrThrow({ where: { runId: run.id, status: "OPEN" } });
  ok(await w.nadya.api.post(`${V2}/material-shortages/${shortage.id}/resolve`, { expectedRevision: shortage.revision, note: "diserahkan" }, key("sh-res")));
  const late = ok(await w.nadya.api.post(`${V2}/units/${unit.id}/resume-work`, {}, key("rs-late")));
  assert.equal(late.resumed, true);
});

test("H. Rollback transaksi: kegagalan di akhir Selesaikan Produksi (trigger DB) membatalkan SEMUA tulisan; tidak ada SKIP/bukti/fase/unit berubah; stok tidak bergerak", async () => {
  const w = await world(); await enableAdaptationDefault();
  const { unit, run } = await toFinishReady(w);
  const snap = async () => ({
    ev: await evidenceCount(run.id), logs: await testPrisma.unitStageLog.count({ where: { unitId: unit.id } }), ops: await testPrisma.productionOperationRun.count({ where: { runId: run.id } }),
    phases: JSON.stringify((await testPrisma.productionPhaseRun.findMany({ where: { runId: run.id }, orderBy: { phase: "asc" } })).map((p) => [p.phase, p.status])),
    unit: (await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, run: (await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).revision, mov: await testPrisma.stockMovement.count({ where: { unitId: unit.id } }),
    outbox: await testPrisma.domainOutbox.count({ where: { aggregateId: run.id } }), act: await testPrisma.activityEvent.count({ where: { entityId: unit.id } }),
  });
  const before = await snap();
  await testPrisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION s2_fail_complete() RETURNS trigger AS $$ BEGIN IF NEW.status = 'COMPLETED' THEN RAISE EXCEPTION 's2 rollback uji'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await testPrisma.$executeRawUnsafe(`CREATE TRIGGER s2_fail_complete_trg BEFORE UPDATE ON production_runs_v2 FOR EACH ROW EXECUTE FUNCTION s2_fail_complete()`);
  try {
    const res = await finishPost(w, w.nadya, run.id, { tag: "fin-h" });
    assert.equal(res.status, 500);
    assert.deepEqual(await snap(), before, "rollback penuh");
    assert.equal(await testPrisma.v2Command.count({ where: { idempotencyKey: "s2-test-fin-h-0001" } }), 0, "command tidak tercatat APPLIED");
  } finally {
    await testPrisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS s2_fail_complete_trg ON production_runs_v2");
    await testPrisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS s2_fail_complete()");
  }
  assert.equal(ok(await finishPost(w, w.nadya, run.id, { tag: "fin-h2" })).completed, true);
});

test("I. Konkurensi Selesaikan Produksi: dua perintah bersamaan -> tepat satu penutupan, satu job Delivery, satu outbox completed", async () => {
  const w = await world(); await enableAdaptationDefault();
  const { unit, run } = await toFinishReady(w);
  const rev = (await card(w, run.id)).revision;
  const post = (n) => w.nadya.api.post(`${V2}/runs/${run.id}/finish`, { expectedRevision: rev, workCenterId: w.wc, confirm: true }, key(`fin-par-${n}`));
  const [a, b] = await Promise.all([post(1), post(2)]);
  assert.equal([a.status, b.status].filter((s) => s === 200).length, 1, `${a.status}/${b.status}`);
  assert.ok([a.status, b.status].every((s) => [200, 404, 409].includes(s)), `${a.status}/${b.status}`);
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "production.run.completed", aggregateId: run.id } }), 1);
  assert.equal(await testPrisma.jobUnit.count({ where: { unitId: unit.id, job: { type: "DELIVERY" } } }), 1);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "READY_FOR_DELIVERY");
});

test("J. Run lama (tanpa kebijakan adaptasi) TIDAK berubah: QC tetap wajib, Corner menunggu QC resmi; default adaptasi tidak menyentuh run yang sudah ada", async () => {
  const w = await world();
  const { run, pas } = await runThrough8(w);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).adaptationPolicy, null);
  assert.equal(pas.awaitingQc, true); assert.equal(pas.next.wait, "AWAITING_QC");
  await enableAdaptationDefault();
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).adaptationPolicy, null, "tidak berubah otomatis");
  const early = await step(w, w.nadya, run.id, 9, { payload: {}, media: await media(w.nadya, run.id, "i") });
  assert.equal(early.status, 409); assert.equal(early.body.code, "STEP_WAITING_AWAITING_QC");
  const fin = await finishPost(w, w.nadya, run.id, { tag: "fin-j" });
  assert.equal(fin.status, 409); assert.equal(fin.body.code, "FINISH_ADAPTATION_NOT_ENABLED");
});

test("K. Izin pengaturan: PRODUCTION_SETTINGS_WRITE hanya Admin/Owner; operator/QC/Gudang/Driver ditolak; perubahan tercatat", async () => {
  const w = await world(); const a = await admin();
  for (const [who, name] of [[w.nadya, "operator+gudang"], [w.corner, "corner"], [w.qc, "qc"], [w.driver, "driver"]]) {
    assert.equal((await who.api.put(`${V2}/settings/adaptation-default`, { enabled: true })).status, 403, name);
    assert.equal((await who.api.put(`${V2}/settings/workshop-location`, { locationId: w.rcv.id })).status, 403, name);
  }
  assert.equal((await a.api.put(`${V2}/settings/adaptation-default`, { enabled: "ya" })).status, 400);
  ok(await a.api.put(`${V2}/settings/adaptation-default`, { enabled: true }));
  assert.equal(ok(await a.api.get(`${V2}/settings`)).adaptationDefault.enabled, true);
  assert.equal(await testPrisma.activityEvent.count({ where: { eventType: "PRODUCTION_SETTING_CHANGED" } }), 1);
});

test("L. Lanjutkan Pekerjaan di LUAR papan (jalur lama): SATU aksi atomik+idempoten; penundaan 'Menunggu bahan' hanya dibuka pemegang izin Gudang/Admin; penugasan & kepemilikan tetap ditegakkan", async () => {
  const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] }); const leadApi = makeClient(server.baseUrl, lead.token);
  const picU = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); const pic = makeClient(server.baseUrl, picU.token);
  const otherU = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); const other = makeClient(server.baseUrl, otherU.token);
  const adm = await admin();
  const picOp = await testPrisma.productionOperator.create({ data: { userId: picU.user.id } });
  await testPrisma.productionOperator.create({ data: { userId: otherU.user.id } });
  const service = await testPrisma.serviceCatalog.findFirstOrThrow({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Luar Papan" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `S2L-${++seq}`, value: 1_000_000, category: "LAYANAN" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `S2L-U${++seq}`, orderId: order.id, seq: 1, status: "RECEIVED" } });
  assert.equal((await leadApi.patch(`/api/units/${unit.id}/service`, { serviceId: service.id })).status, 200);
  const path = (await leadApi.get(`/api/units/${unit.id}/timeline`)).body.path.map((p) => p.stage);
  assert.equal((await leadApi.post(`/api/units/${unit.id}/stages/${path[0].id}/assign`, { operatorId: picOp.id, workCenterId: null })).status, 200);
  assert.equal((await pic.post(`/api/units/${unit.id}/stages/start`, {})).status, 200);
  const fail = (reason) => pic.post(`/api/units/${unit.id}/stages/${path[0].id}/fail`, { blockReason: reason, note: "uji" });
  const resume = (who, k) => who.post(`${V2}/units/${unit.id}/resume-work`, {}, key(k));

  assert.equal((await fail("AWAITING_CUSTOMER")).status, 200);
  assert.equal((await resume(other, "l-other")).status, 403, "bukan PIC yang ditugaskan");
  assert.equal((await resume(leadApi, "l-lead")).status, 403, "Lead tanpa penugasan");
  assert.equal(await testPrisma.productionBlocker.count({ where: { unitId: unit.id, resolvedAt: null } }), 1, "penolakan tanpa efek");
  const r1 = ok(await resume(pic, "l-1"));
  assert.deepEqual([r1.resumed, r1.alreadyActive, r1.path], [true, false, "LUAR_PAPAN"]);
  assert.equal(await testPrisma.productionBlocker.count({ where: { unitId: unit.id, resolvedAt: null } }), 0, "penundaan ditutup atomik bersama START");
  assert.equal(ok(await resume(pic, "l-1")).replayed, true);
  const again = ok(await resume(pic, "l-2"));
  assert.deepEqual([again.resumed, again.alreadyActive], [false, true]);
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: unit.id, action: "START" } }), 2, "START awal + satu START lanjut (tidak ganda)");

  // Menunggu bahan: PIC tanpa izin Gudang ditolak; Admin (execute-any + inventory) boleh
  assert.equal((await fail("MATERIAL_SHORTAGE")).status, 200);
  const early = await resume(pic, "l-mat");
  assert.equal(early.status, 409); assert.equal(early.body.code, "RESUME_WAITING_MATERIAL");
  assert.equal(await testPrisma.productionBlocker.count({ where: { unitId: unit.id, resolvedAt: null } }), 1);
  const byAdmin = ok(await resume(adm.api, "l-adm"));
  assert.equal(byAdmin.resumed, true);

  // Konkurensi: dua Lanjutkan bersamaan pada satu penundaan -> tepat satu START baru
  assert.equal((await fail("AWAITING_CUSTOMER")).status, 200);
  const startsBefore = await testPrisma.unitStageLog.count({ where: { unitId: unit.id, action: "START" } });
  const [x, y] = await Promise.all([resume(pic, "l-par-1"), resume(pic, "l-par-2")]);
  assert.ok([x.status, y.status].includes(200), `${x.status}/${y.status}`);
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: unit.id, action: "START" } }), startsBefore + 1);
});
