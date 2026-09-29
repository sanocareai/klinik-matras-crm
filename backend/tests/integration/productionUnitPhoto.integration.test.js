// P9B.1 — foto identitas unit: resolusi pickup driver (hanya job SATU unit), fallback unggah manual, dan
// akses baca bertanda-tangan/terautentikasi. Lihat services/productionUnitPhotoService.js.
import "./setup/env.js";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { resolveUnitPhoto } from "../../src/services/productionUnitPhotoService.js";
import { UNIT_PHOTO_DIR } from "../../src/lib/productionUnitPhotoStore.js";

let server;
let seq = 0;
const key = (value) => ({ "Idempotency-Key": `unit-photo-test-${value}-0001` });

async function setFlag(flagKey, { enabled, unitIds }) {
  const data = { enabled, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "unit photo test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
const setWriter = (opts) => setFlag(V2_FLAGS.PRODUCTION_WRITER, opts);
const setReader = (opts) => setFlag(V2_FLAGS.PRODUCTION_READER, opts);

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

// Job pickup dengan SATU ATAU BEBERAPA unit, ACCEPTED (custody INBOUND) — precondition resolveUnitPhoto.
async function pickupUnits(count, { proofPhotoUrls }) {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const driverApi = makeClient(server.baseUrl, driver.token);
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Foto" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `PHO-${++seq}`, value: 1000, category: "LAYANAN" } });
  const units = await Promise.all(
    Array.from({ length: count }, (_, i) => testPrisma.unit.create({ data: { unitCode: `UNIT-PHO-${++seq}`, orderId: order.id, seq: i + 1, status: "AWAITING_PICKUP" } }))
  );
  const route = await testPrisma.route.create({ data: { code: `PHO-RTE-${++seq}`, date: new Date("2026-09-30T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: driver.user.id } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, driverId: driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-09-30T00:00:00.000Z") } });
  for (const unit of units) await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  // PENTING: setWriter/setReader menimpa SELURUH config (bukan menambah) — satu panggilan dengan SEMUA
  // unitId, bukan satu panggilan per unit (yang akan membuat unit sebelumnya "hilang" dari cohort).
  const allUnitIds = units.map((u) => u.id);
  await setWriter({ enabled: true, unitIds: allUnitIds });
  const tag = `pickup-${++seq}`;
  await driverApi.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}-start`));
  await driverApi.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${tag}-arrive`));
  const done = await driverApi.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls, recipientName: "Penjaga Rumah", note: "diserahkan", location: null }, key(`${tag}-complete`));
  assert.equal(done.status, 200, JSON.stringify(done.body));

  const wh = await createTestUser({ roles: ["WAREHOUSE"] });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-PHO-${++seq}`, name: "Gudang Foto" } });
  const location = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-PHO-${++seq}` } });
  const whApi = makeClient(server.baseUrl, wh.token);
  for (const unit of units) {
    const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: unit.id } });
    const accepted = await whApi.post(`/api/inventory/unit-custody/${handoff.id}/accept`, { locationId: location.id, expectedRevision: 1 }, key(`accept-${unit.id}`));
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  }
  await setWriter({ enabled: true, unitIds: allUnitIds });
  await setReader({ enabled: true, unitIds: allUnitIds });
  return units;
}

test("job pickup SATU unit dengan foto -> resolveUnitPhoto mengembalikan DRIVER_PICKUP", async () => {
  const [unit] = await pickupUnits(1, { proofPhotoUrls: ["/media/job-photos/pod-tunggal.jpg"] });
  const resolved = await resolveUnitPhoto(testPrisma, unit.id);
  assert.equal(resolved.source, "DRIVER_PICKUP");
  assert.equal(resolved.jobPhotoFilename, "pod-tunggal.jpg");
});

test("job pickup DUA unit (satu job) dengan foto -> TIDAK PERNAH diberikan ke unit manapun (tidak menebak atribusi)", async () => {
  const [unitA, unitB] = await pickupUnits(2, { proofPhotoUrls: ["/media/job-photos/pod-ganda.jpg"] });
  assert.equal(await resolveUnitPhoto(testPrisma, unitA.id), null);
  assert.equal(await resolveUnitPhoto(testPrisma, unitB.id), null);
});

test("unit tanpa foto pickup sama sekali -> resolveUnitPhoto null (bukan menebak)", async () => {
  const [unit] = await pickupUnits(1, { proofPhotoUrls: ["/media/job-photos/tanpa-ext-aneh"] });
  // URL tidak berpola job-photos yang valid (tanpa ekstensi dikenal) -> ditolak, bukan ditebak jadi jpg.
  assert.equal(await resolveUnitPhoto(testPrisma, unit.id), null);
});

// PNG minimal (signature 8-byte + padding) — cukup untuk sniffImageType, tidak perlu PNG valid penuh.
const FAKE_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("bukan-png-asli-tapi-signature-cocok")]);

async function uploadPhoto(who, unitId, { bytes = FAKE_PNG, mimeType = "image/png", filename = "foto.png" } = {}) {
  const fd = new FormData();
  fd.append("photo", new Blob([bytes], { type: mimeType }), filename);
  const res = await fetch(`${server.baseUrl}/api/production-v2/units/${unitId}/photo`, { method: "POST", headers: { Authorization: `Bearer ${who.token}` }, body: fd });
  let body = null; try { body = await res.json(); } catch { /* respons kosong */ }
  return { status: res.status, body };
}

test("unggah manual berhasil ketika unit belum punya foto pickup, lalu bisa dibaca lewat URL bertanda-tangan", async () => {
  const [unit] = await pickupUnits(2, { proofPhotoUrls: ["/media/job-photos/pod-ganda-2.jpg"] }); // 2 unit -> tidak ada pickup photo utk keduanya
  const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  const res = await uploadPhoto(lead, unit.id);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.ok(res.body.photoUrl.startsWith(`/media/unit-photo/${unit.id}?exp=`));

  const rows = await testPrisma.unitPhoto.findMany({ where: { unitId: unit.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "PRODUCTION_MANUAL");
  assert.ok(fs.existsSync(path.join(UNIT_PHOTO_DIR, rows[0].storageKey)));

  const read = await fetch(`${server.baseUrl}${res.body.photoUrl}`);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("content-type"), "image/png");
});

test("unggah manual DITOLAK (409) bila unit sudah punya foto pickup driver", async () => {
  const [unit] = await pickupUnits(1, { proofPhotoUrls: ["/media/job-photos/pod-ada.jpg"] });
  const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  const res = await uploadPhoto(lead, unit.id);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "UNIT_PHOTO_PICKUP_EXISTS");
});

test("unggah manual DITOLAK (403) untuk role tanpa PRODUCTION_ASSIGNMENT_WRITE (PRODUCTION_WORKER)", async () => {
  const [unit] = await pickupUnits(2, { proofPhotoUrls: ["/media/job-photos/pod-ganda-3.jpg"] });
  const worker = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  const res = await uploadPhoto(worker, unit.id);
  assert.equal(res.status, 403);
});

test("unggah manual DITOLAK (415) bila isi berkas bukan JPEG/PNG/WebP asli (magic-byte gagal walau Content-Type dipalsukan)", async () => {
  const [unit] = await pickupUnits(2, { proofPhotoUrls: ["/media/job-photos/pod-ganda-4.jpg"] });
  const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  const res = await uploadPhoto(lead, unit.id, { bytes: Buffer.from("ini teks biasa, bukan gambar"), mimeType: "image/jpeg", filename: "palsu.jpg" });
  assert.equal(res.status, 415);
  assert.equal(res.body.code, "UNIT_PHOTO_INVALID_TYPE");
});

test("unggah ulang berkas IDENTIK -> idempoten, tidak menggandakan baris (replay)", async () => {
  const [unit] = await pickupUnits(2, { proofPhotoUrls: ["/media/job-photos/pod-ganda-5.jpg"] });
  const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  const first = await uploadPhoto(lead, unit.id);
  assert.equal(first.status, 201);
  const second = await uploadPhoto(lead, unit.id);
  assert.equal(second.status, 201);
  const rows = await testPrisma.unitPhoto.findMany({ where: { unitId: unit.id } });
  assert.equal(rows.length, 1, "berkas identik tidak boleh membuat baris kedua");
});

test("reader OFF: GET /media/unit-photo/:unitId lewat Bearer -> 403 (bukan bocor sebelum flag aktif)", async () => {
  const [unit] = await pickupUnits(2, { proofPhotoUrls: ["/media/job-photos/pod-ganda-6.jpg"] });
  const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  await uploadPhoto(lead, unit.id);
  await setReader({ enabled: false, unitIds: [] });
  const res = await fetch(`${server.baseUrl}/media/unit-photo/${unit.id}`, { headers: { Authorization: `Bearer ${lead.token}` } });
  assert.equal(res.status, 403);
});
