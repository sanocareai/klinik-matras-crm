// P9C — Unit 360: GET /api/production-v2/units/:unitId/overview. Fokus: 5 keadaan unit (OFFERED tanpa run,
// PENDING_ARRIVAL, ACTIVE, COMPLETED, legacy), isolasi multi-unit order, gating harga/role, reader OFF/non-cohort,
// dan bahwa endpoint TIDAK PERNAH menebak — field yang tidak punya sumber kanonis ditandai gap secara eksplisit.
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
const key = (v) => ({ "Idempotency-Key": `p9c-${v}-0001` });
const V2 = "/api/production-v2";

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function setFlag(flagKey, unitIds) {
  const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "p9c test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
async function setCohort(...unitIds) {
  for (const flagKey of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(flagKey, unitIds);
}

async function world() {
  const [lead, admin, nadya, corner, qcUser, wh, driver] = await Promise.all([
    createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["ADMIN"] }),
    createTestUser({ roles: ["ADMIN", "WAREHOUSE", "PRODUCTION_WORKER"] }), createTestUser({ roles: ["PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["QC_LEAD"] }), createTestUser({ roles: ["WAREHOUSE"] }), createTestUser({ roles: ["DRIVER"] }),
  ]);
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-P9C-${++seq}`, name: "Workshop P9C" } });
  const nadyaOp = await testPrisma.productionOperator.create({ data: { userId: nadya.user.id, primaryWorkCenterId: workCenter.id } });
  const cornerOp = await testPrisma.productionOperator.create({ data: { userId: corner.user.id, primaryWorkCenterId: workCenter.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-P9C-${++seq}`, name: "Gudang P9C" } });
  const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-P9C-${++seq}` } });
  const service = await testPrisma.serviceCatalog.findFirstOrThrow({ where: { code: "UPG_FONDASI_LAPISAN" } });
  const fondasi = await testPrisma.material.create({ data: { code: `P9C-MAT-F-${++seq}`, name: "Pocket Spring P9C", unit: "PCS", category: "RAW_MATERIAL", active: true } });
  await testPrisma.stockMovement.create({ data: { materialId: fondasi.id, type: "RECEIPT", qty: 10, note: "seed p9c" } });
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  return { lead: c(lead), admin: c(admin), nadya: c(nadya), corner: c(corner), qcUser: c(qcUser), wh: c(wh), driver: c(driver), wc: workCenter.id, nadyaOp, cornerOp, rcv, service, fondasi };
}

async function orderWithUnits(w, count = 1, { weightKg = 78 } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan P9C ${++seq}`, city: "Bandung" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `P9C-${++seq}`, value: 5_500_000, category: "LAYANAN", beratBadan: weightKg, complaintCategory: ["SAKIT_PINGGANG"], notes: "Minta lebih empuk" } });
  const units = await Promise.all(Array.from({ length: count }, (_, i) => testPrisma.unit.create({ data: { unitCode: `P9C-UNIT-${++seq}`, orderId: order.id, seq: i + 1, status: "AWAITING_PICKUP", merk: "King Koil", ukuran: "180x200" } })));
  return { customer, order, units };
}

async function pickupJob(w, unitIds, orderId) {
  const route = await testPrisma.route.create({ data: { code: `P9C-RTE-${++seq}`, date: new Date("2026-09-30T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId, routeId: route.id, driverId: w.driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-09-30T00:00:00.000Z") } });
  for (const unitId of unitIds) await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId } });
  const tag = `p9c-pk-${++seq}`;
  await w.driver.api.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}-s`));
  await w.driver.api.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${tag}-a`));
  const done = await w.driver.api.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/p9c-pod.jpg"], recipientName: "Penjaga", note: "ok", location: null }, key(`${tag}-c`));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return job;
}

async function acceptCustody(w, unitId) {
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId, direction: "INBOUND" } });
  const acc = await w.wh.api.post(`/api/inventory/unit-custody/${handoff.id}/accept`, { locationId: w.rcv.id, expectedRevision: 1 }, key(`p9c-accept-${unitId}`));
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  return testPrisma.productionRun.findFirstOrThrow({ where: { unitId } });
}

async function planOnBoard(w, runId, { station = "TABLE_1", priority = 0 } = {}) {
  const res = await w.lead.api.post(`${V2}/plans`, { runId, productionDate: "2026-09-30", stationCode: station, priority, workCenterId: w.wc, operatorId: w.nadyaOp.id, cornerOperatorId: w.cornerOp.id }, key(`p9c-plan-${++seq}`));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

const overview = async (who, unitId) => who.api.get(`${V2}/units/${unitId}/overview`);

let fileSeq = 0;
async function mediaUpload(who, runId) {
  const fd = new FormData();
  fd.append("runId", runId);
  fd.append("files", new Blob([Buffer.from(`img-${++fileSeq}-${Math.random()}`)], { type: "image/jpeg" }), "a.jpg");
  const res = await fetch(`${server.baseUrl}${V2}/evidence/upload`, { method: "POST", headers: { Authorization: `Bearer ${who.token}` }, body: fd });
  const body = await res.json();
  assert.equal(res.status, 201, JSON.stringify(body));
  return body.items.map((i) => i.url);
}

test("unit OFFERED tanpa run sama sekali (Kadar-Wati-like) -> overview lengkap tanpa error, production/materials/qc kosong dengan alasan jelas", async () => {
  // Kadar Wati adalah data WARISAN pra-P9A: OFFERED tanpa run sama sekali. Jalur pickup NYATA sekarang SELALU
  // langsung membuat run PENDING_ARRIVAL saat offer (P9A) — untuk mereproduksi kasus warisan yang genuine,
  // handoff dibuat LANGSUNG lewat Prisma (bukan API driver), pola sama dengan
  // productionCommandCenter.integration.test.js "unit warisan OFFERED tanpa Production Run".
  const w = await world();
  const { order, units: [unit] } = await orderWithUnits(w);
  await setCohort(unit.id);
  const route = await testPrisma.route.create({ data: { code: `P9C-LEG-RTE-${++seq}`, date: new Date("2026-09-30T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, driverId: w.driver.user.id, status: "COMPLETED", sequence: 1, scheduledDate: new Date("2026-09-30T00:00:00.000Z"), completedAt: new Date(), proofPhotoUrls: ["/media/job-photos/p9c-legacy.jpg"] } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  await testPrisma.unitCustodyHandoff.create({ data: { unitId: unit.id, deliveryJobId: job.id, direction: "INBOUND", status: "OFFERED", revision: 1 } });
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: unit.id } }), 0, "precondition: belum ada run sama sekali");

  const res = await overview(w.lead, unit.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.identity.unitCode, unit.unitCode);
  assert.equal(res.body.identity.orderNumber, order.orderNumber);
  assert.equal(res.body.pickup.exists, true);
  assert.equal(res.body.pickup.custodyStatus, "OFFERED");
  assert.equal(res.body.pickup.isSingleUnitJob, true);
  assert.equal(res.body.production.runId, null);
  assert.equal(res.body.production.steps.length, 0);
  assert.deepEqual(res.body.materials, { lines: [], shortageOpen: false, shortageItems: [] });
  assert.deepEqual(res.body.qc, []);
  assert.ok(res.body.warnings.some((w2) => w2.code === "BELUM_ADA_RUN"));
  assert.equal(res.body.customer.name.scope, "ORDER");
  assert.equal(res.body.customer.name.value, (await testPrisma.customer.findUniqueOrThrow({ where: { id: order.customerId } })).name);
});

test("PENDING_ARRIVAL: run sudah ada (dibuat otomatis saat offer) tapi belum dikonfirmasi tiba", async () => {
  const w = await world();
  const { order, units: [unit] } = await orderWithUnits(w);
  await setCohort(unit.id);
  await pickupJob(w, [unit.id], order.id);
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
  assert.equal(run.status, "PENDING_ARRIVAL");

  const res = await overview(w.lead, unit.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.production.runId, run.id);
  assert.equal(res.body.production.runStatus, "PENDING_ARRIVAL");
  assert.equal(res.body.identity.bucket, "DALAM_PERJALANAN");
  assert.equal(res.body.pickup.arrivedAtWorkshop, null, "belum accept -> belum ada waktu tiba workshop");
});

test("ACTIVE: custody diterima, dijadwalkan, tahap 1 dimulai", async () => {
  const w = await world();
  const { order, units: [unit] } = await orderWithUnits(w);
  await setCohort(unit.id);
  await pickupJob(w, [unit.id], order.id);
  const run = await acceptCustody(w, unit.id);
  await planOnBoard(w, run.id);
  const card = (await w.lead.api.get(`${V2}/runs/${run.id}/card`)).body;
  const step1 = await w.nadya.api.post(`${V2}/runs/${run.id}/steps/1`, {
    expectedRevision: card.revision, workCenterId: w.wc, payload: { conditionConfirmed: true }, media: await mediaUpload(w.nadya, run.id),
  }, key("p9c-step1"));
  assert.equal(step1.status, 200, JSON.stringify(step1.body));

  const res = await overview(w.lead, unit.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.production.runStatus, "ACTIVE");
  assert.ok(res.body.pickup.arrivedAtWorkshop, "sudah accept -> ada waktu tiba workshop");
  assert.equal(res.body.production.steps.find((s) => s.no === 1).status, "DONE");
  assert.equal(res.body.planning.stationLabel, "Meja 1");
  assert.ok(res.body.activity.some((a) => a.kind === "EVIDENCE"));
});

test("multi-unit order: dua unit dipickup DALAM SATU job -> foto tidak diatribusikan ke keduanya, dan materials/QC/evidence unit A tidak pernah bocor ke unit B", async () => {
  const w = await world();
  const { order, units: [unitA, unitB] } = await orderWithUnits(w, 2);
  await setCohort(unitA.id, unitB.id);
  await pickupJob(w, [unitA.id, unitB.id], order.id);
  const runA = await acceptCustody(w, unitA.id);
  await planOnBoard(w, runA.id, { station: "TABLE_1" });
  const cardA = (await w.lead.api.get(`${V2}/runs/${runA.id}/card`)).body;
  await w.nadya.api.post(`${V2}/runs/${runA.id}/steps/1`, { expectedRevision: cardA.revision, workCenterId: w.wc, payload: { conditionConfirmed: true }, media: await mediaUpload(w.nadya, runA.id) }, key("p9c-mu-step1"));

  const resA = await overview(w.lead, unitA.id);
  const resB = await overview(w.lead, unitB.id);
  assert.equal(resA.body.pickup.isSingleUnitJob, false, "job punya 2 unit -> bukan single-unit");
  assert.equal(resA.body.identity.photoUrl, null, "job multi-unit -> tidak pernah dapat foto pickup");
  assert.equal(resB.body.identity.photoUrl, null);
  assert.equal(resA.body.production.runId, runA.id);
  // unit B: run PENDING_ARRIVAL sudah otomatis ada sejak offer (P9A) walau belum diterima Gudang — TAPI harus
  // run MILIK UNIT B SENDIRI, bukan runA, dan tahap/BOM/QC-nya harus kosong (tidak ikut terisi tahap 1 unit A).
  assert.notEqual(resB.body.production.runId, null);
  assert.notEqual(resA.body.production.runId, resB.body.production.runId);
  assert.equal(resB.body.production.runStatus, "PENDING_ARRIVAL");
  assert.equal(resB.body.production.steps.find((s) => s.no === 1)?.status, "PENDING", "tahap 1 unit A TIDAK boleh bocor ke unit B");
  assert.deepEqual(resB.body.materials.lines, []);
  assert.deepEqual(resB.body.qc, []);
  // salesContext ORDER-scoped SAMA untuk keduanya (bukan bug — ditandai eksplisit scope:"ORDER")
  assert.deepEqual(resA.body.salesContext.complaints, resB.body.salesContext.complaints);
  assert.equal(resA.body.salesContext.complaints.scope, "ORDER");
});

test("legacy: run dengan migrationSource terisi (data lama) tetap terbaca aman, tanpa crash", async () => {
  const w = await world();
  const { order, units: [unit] } = await orderWithUnits(w);
  await setCohort(unit.id);
  const run = await testPrisma.productionRun.create({ data: { unitId: unit.id, kind: "RESTORATION", status: "ACTIVE", currentPhase: "PROCESS", migrationSource: "legacy-import", migrationSourceId: "LEG-1", origin: "WORKSHOP_BORN" } });
  const res = await overview(w.lead, unit.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.production.runId, run.id);
  assert.equal(res.body.pickup.exists, false, "unit lahir di workshop -> tidak ada custody INBOUND, bukan error");
});

test("role tanpa ORDER_PRICE_READ tidak menerima orderValue sama sekali; ADMIN menerima", async () => {
  const w = await world();
  const { order, units: [unit] } = await orderWithUnits(w);
  await setCohort(unit.id);
  await pickupJob(w, [unit.id], order.id);

  const asLead = await overview(w.lead, unit.id);
  assert.equal(asLead.body.permissions.canSeeValue, false);
  assert.equal(asLead.body.orderValue, undefined, "field tidak boleh ada sama sekali, bukan null");
  assert.equal(JSON.stringify(asLead.body).includes("5500000"), false);

  const asAdmin = await overview(w.admin, unit.id);
  assert.equal(asAdmin.body.permissions.canSeeValue, true);
  assert.equal(asAdmin.body.orderValue, 5_500_000);
});

test("reader OFF -> 404 (bukan bocor); unit di luar cohort -> 404", async () => {
  const w = await world();
  const { order, units: [unitIn, unitOut] } = await orderWithUnits(w, 2);
  await pickupJob(w, [unitIn.id, unitOut.id], order.id);
  await setCohort(unitIn.id); // hanya unitIn masuk cohort

  await setFlag(V2_FLAGS.PRODUCTION_READER, null);
  const resReaderOff = await overview(w.lead, unitIn.id);
  assert.equal(resReaderOff.status, 404);
  await setCohort(unitIn.id);
  const resOutOfCohort = await overview(w.lead, unitOut.id);
  assert.equal(resOutOfCohort.status, 404, "unit di luar cohort tidak boleh terbaca lewat Unit 360");
});

test("data Sales belum lengkap (berat badan kosong) -> dataGaps eksplisit, bukan ditebak", async () => {
  const w = await world();
  const { order, units: [unit] } = await orderWithUnits(w, 1, { weightKg: null });
  await setCohort(unit.id);
  await pickupJob(w, [unit.id], order.id);
  const res = await overview(w.lead, unit.id);
  assert.equal(res.body.salesContext.weightKg.value, null);
  assert.ok(res.body.salesContext.dataGaps.includes("Berat badan customer belum dicatat Sales"));
});

test("QC: hasil PASS lewat inspeksi resmi tampil di overview dengan pemeriksa dan foto bertanda tangan", async () => {
  const w = await world();
  const { order, units: [unit] } = await orderWithUnits(w, 1, { weightKg: 80 });
  await setCohort(unit.id);
  await pickupJob(w, [unit.id], order.id);
  const run = await acceptCustody(w, unit.id);
  await planOnBoard(w, run.id);
  // Lompat langsung ke inspeksi QC via command resmi (tanpa menjalani 8 tahap intake — cukup untuk menguji bacaan Unit 360, bukan alur bisnis).
  await testPrisma.qualityInspection.create({ data: { runId: run.id, version: 1, checklistVersion: "v1", result: "PASS", inspectorId: w.qcUser.user.id, inspectedAt: new Date(), items: { create: [{ itemCode: "JAHITAN", label: "Jahitan rapi", result: "OK", photoUrls: ["/media/production-evidence/" + "a".repeat(40) + ".jpg"] }] } } });
  const res = await overview(w.lead, unit.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.qc.length, 1);
  assert.equal(res.body.qc[0].result, "PASS");
  assert.equal(res.body.qc[0].inspectorName, w.qcUser.user.name);
  assert.equal(res.body.qc[0].items[0].photoUrls.length, 1);
  assert.match(res.body.qc[0].items[0].photoUrls[0], /\?exp=\d+&sig=[a-f0-9]+$/, "foto QC harus bertanda tangan, bukan URL mentah");
});
