// GERBANG KONFIRMASI MUAT UNIT — mode MATI / KAPABEL / KETAT, terhadap PostgreSQL sungguhan; plus manifest pada snapshot Driver V2 (jalur aplikasi RN).
// Kasus: 3/3, 2/3, pengecualian beralasan (audit sekali), klien lama vs klien baru, replay, endpoint config, dan V2 membawa unit lengkap + muat.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { buildDeliveryRouteSnapshot, DELIVERY_V2_ROUTE_INCLUDE, deliveryJobSource, deliveryV2Checksum } from "../../src/services/deliveryV2Snapshot.js";
import { readDriverFullSnapshot } from "../../src/services/driverSnapshotV2.js";
import { manifestJob } from "../../src/services/deliveryManifestAttach.js";
import { modeGerbangUnit, klienMampuKonfirmasi } from "../../src/services/deliveryUnitLoad.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); delete process.env.DELIVERY_UNIT_CONFIRM_REQUIRED; });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const kunci = () => ({ "Idempotency-Key": `gate-${randomUUID()}` });
const BARU = { "X-Capability": "unit-load" };

/** Rute terbit + 1 job DELIVERY ARRIVED milik driver + 3 unit (U1–U3) tertaut. */
async function seed() {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const customer = await testPrisma.customer.create({ data: { name: "Pak Indra Antariksa (projek kos)", phone: "6281200001111" } });
  const order = await testPrisma.order.create({
    data: { customerId: customer.id, orderNumber: `NEW-GATE-${Date.now()}`, value: 7_200_000, category: "BARU", quantity: 3, status: "READY", notes: JSON.stringify({ merkKasur: "Kasur Sorong 3in1 custom", ukuranKasur: "100x200" }) },
  });
  const units = [];
  for (let i = 1; i <= 3; i += 1) units.push(await testPrisma.unit.create({ data: { orderId: order.id, unitCode: `${order.orderNumber}-U${i}`, seq: i, merk: "Kasur Sorong 3in1 custom", ukuran: "100 x 200", status: "READY_FOR_DELIVERY" } }));
  const route = await testPrisma.route.create({ data: { code: `GATE-${Date.now()}-${Math.random()}`, date: new Date("2026-10-15T00:00:00.000Z"), status: "IN_PROGRESS", publishedAt: new Date(), driverId: driver.user.id } });
  const job = await testPrisma.job.create({
    data: { type: "DELIVERY", orderId: order.id, routeId: route.id, driverId: driver.user.id, scheduledDate: new Date("2026-10-15T00:00:00.000Z"), status: "ARRIVED", arrivedAt: new Date(), sequence: 1 },
  });
  for (const u of units) await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: u.id } });
  await testPrisma.deliveryJobState.create({ data: { jobId: job.id, jobRevision: 1, currentStatus: job.status, sourceChecksum: deliveryV2Checksum(deliveryJobSource(job)), migrationSource: "TEST_BASELINE" } });
  const fullRoute = await testPrisma.route.findUniqueOrThrow({ where: { id: route.id }, include: DELIVERY_V2_ROUTE_INCLUDE });
  const snapshot = buildDeliveryRouteSnapshot(fullRoute, { routeRevision: 1, publicationVersion: 1 });
  const checksum = deliveryV2Checksum(snapshot);
  await testPrisma.deliveryRouteState.create({ data: { routeId: route.id, routeRevision: 1, currentPublicationVersion: 1, lifecycleStatus: route.status, draftSnapshot: snapshot, draftChecksum: checksum, sourceChecksum: checksum, migrationSource: "TEST_BASELINE" } });
  await testPrisma.routePublication.create({
    data: { routeId: route.id, publicationVersion: 1, routeRevision: 1, status: "ACTIVE", snapshot, checksum, migrationBaseline: true,
      assignments: { create: [{ jobId: job.id, sequence: 1, driverId: driver.user.id, status: "ACTIVE", sourceChecksum: deliveryV2Checksum(snapshot.stops[0]) }] } },
  });
  return { driver, order, units, route, job, c: makeClient(server.baseUrl, driver.token) };
}
const pod = { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Pak Indra" };
const status = async (jobId) => (await testPrisma.job.findUnique({ where: { id: jobId } })).status;

test("mode: pembacaan env dan deteksi kapabilitas klien", () => {
  assert.equal(modeGerbangUnit({}), "MATI");
  assert.equal(modeGerbangUnit({ DELIVERY_UNIT_CONFIRM_REQUIRED: "0" }), "MATI");
  assert.equal(modeGerbangUnit({ DELIVERY_UNIT_CONFIRM_REQUIRED: "capable" }), "KAPABEL");
  assert.equal(modeGerbangUnit({ DELIVERY_UNIT_CONFIRM_REQUIRED: "1" }), "KETAT");
  assert.equal(modeGerbangUnit({ DELIVERY_UNIT_CONFIRM_REQUIRED: "strict" }), "KETAT");
  assert.equal(klienMampuKonfirmasi({ get: (h) => (h === "x-capability" ? "foo, unit-load" : "") }), true);
  assert.equal(klienMampuKonfirmasi({ get: () => "" }), false);
});

test("config: melaporkan mode dan apakah klien PEMANGGIL ditegakkan", async () => {
  const w = await seed();
  process.env.DELIVERY_UNIT_CONFIRM_REQUIRED = "";
  const mati = await w.c.get("/api/armada/unit-load/config");
  assert.equal(mati.status, 200, JSON.stringify(mati.body));
  assert.deepEqual([mati.body.mode, mati.body.ditegakkanUntukKlienIni], ["MATI", false]);
  process.env.DELIVERY_UNIT_CONFIRM_REQUIRED = "capable";
  const lama = await w.c.get("/api/armada/unit-load/config");
  assert.deepEqual([lama.body.mode, lama.body.klienMampu, lama.body.ditegakkanUntukKlienIni], ["KAPABEL", false, false]);
  const resp = await fetch(`${server.baseUrl}/api/armada/unit-load/config`, { headers: { Authorization: `Bearer ${w.driver.token}`, ...BARU } });
  const baru = await resp.json();
  assert.deepEqual([baru.mode, baru.klienMampu, baru.ditegakkanUntukKlienIni], ["KAPABEL", true, true]);
  process.env.DELIVERY_UNIT_CONFIRM_REQUIRED = "1";
  assert.equal((await w.c.get("/api/armada/unit-load/config")).body.ditegakkanUntukKlienIni, true);
});

test("MATI (default): 0/3 tetap bisa diselesaikan — perilaku produksi sekarang tidak berubah", async () => {
  const w = await seed();
  const r = await w.c.post(`/api/armada/jobs/${w.job.id}/complete`, pod, { ...kunci(), ...BARU });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  assert.equal(await status(w.job.id), "COMPLETED");
  assert.equal(await testPrisma.deliveryExecutionEvent.count({ where: { jobId: w.job.id, action: { in: ["UNIT_LOAD_EXCEPTION", "UNIT_LOAD_LEGACY_CLIENT"] } } }), 0);
});

test("KAPABEL: klien BARU ditegakkan (2/3 ditolak, 3/3 lolos, pengecualian diaudit sekali); klien LAMA lolos + sinyal dicatat", async () => {
  process.env.DELIVERY_UNIT_CONFIRM_REQUIRED = "capable";
  // klien baru, 2/3 → 409
  const a = await seed();
  const dua = await a.c.post(`/api/armada/jobs/${a.job.id}/unit-load`, { unitIds: [a.units[0].id, a.units[1].id] }, BARU);
  assert.equal(dua.status, 200, JSON.stringify(dua.body));
  assert.equal(dua.body.muat.label, "Barang dimuat 2/3 unit");
  const tolak = await a.c.post(`/api/armada/jobs/${a.job.id}/complete`, pod, { ...kunci(), ...BARU });
  assert.equal(tolak.status, 409);
  assert.equal(tolak.body.code, "UNIT_BELUM_DIKONFIRMASI");
  assert.match(tolak.body.error, /2\/3/);
  assert.equal(await status(a.job.id), "ARRIVED");
  // 3/3 → lolos (konfirmasi sisa unit, replay konfirmasi idempoten)
  await a.c.post(`/api/armada/jobs/${a.job.id}/unit-load`, { semua: true }, BARU);
  await a.c.post(`/api/armada/jobs/${a.job.id}/unit-load`, { semua: true }, BARU);
  assert.equal(await testPrisma.jobUnitLoad.count({ where: { jobId: a.job.id } }), 3);
  const ok = await a.c.post(`/api/armada/jobs/${a.job.id}/complete`, pod, { ...kunci(), ...BARU });
  assert.ok([200, 201].includes(ok.status), JSON.stringify(ok.body));
  assert.equal(await status(a.job.id), "COMPLETED");
  await truncateAll();

  // klien baru, 0/3 + pengecualian beralasan → lolos, audit tepat sekali (replay tidak menggandakan)
  const b = await seed();
  const h = { ...kunci(), ...BARU };
  const pengecualian = { ...pod, pengecualianUnit: { alasan: "Aplikasi offline, 3 unit dihitung manual di lokasi" } };
  const tanpaAlasan = await b.c.post(`/api/armada/jobs/${b.job.id}/complete`, { ...pod, pengecualianUnit: { alasan: "x" } }, { ...kunci(), ...BARU });
  assert.equal(tanpaAlasan.status, 409);
  const sah = await b.c.post(`/api/armada/jobs/${b.job.id}/complete`, pengecualian, h);
  assert.ok([200, 201].includes(sah.status), JSON.stringify(sah.body));
  const ulang = await b.c.post(`/api/armada/jobs/${b.job.id}/complete`, pengecualian, h);
  assert.ok([200, 201, 409].includes(ulang.status));
  assert.equal(await testPrisma.deliveryExecutionEvent.count({ where: { jobId: b.job.id, action: "UNIT_LOAD_EXCEPTION" } }), 1);
  assert.equal(await testPrisma.job.count({ where: { orderId: b.order.id } }), 1, "tidak ada job ganda");
  await truncateAll();

  // klien LAMA (tanpa header) → tidak ditolak, tetapi tercatat sebagai sinyal kesiapan KETAT
  const c = await seed();
  const lama = await c.c.post(`/api/armada/jobs/${c.job.id}/complete`, pod, kunci());
  assert.ok([200, 201].includes(lama.status), JSON.stringify(lama.body));
  assert.equal(await status(c.job.id), "COMPLETED");
  const sinyal = await testPrisma.deliveryExecutionEvent.findMany({ where: { jobId: c.job.id, action: "UNIT_LOAD_LEGACY_CLIENT" } });
  assert.equal(sinyal.length, 1);
  assert.equal(sinyal[0].payload.dimuat, 0);
  assert.equal(sinyal[0].payload.total, 3);
});

test("KETAT: klien lama pun ditolak (tanpa header), Admin/dispatcher input manual tidak terkena", async () => {
  process.env.DELIVERY_UNIT_CONFIRM_REQUIRED = "1";
  const w = await seed();
  const lama = await w.c.post(`/api/armada/jobs/${w.job.id}/complete`, pod, kunci());
  assert.equal(lama.status, 409);
  assert.equal(lama.body.code, "UNIT_BELUM_DIKONFIRMASI");
  assert.equal(await status(w.job.id), "ARRIVED");
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const manual = await makeClient(server.baseUrl, admin.token).post(`/api/armada/jobs/${w.job.id}/complete`, pod, kunci());
  assert.ok([200, 201].includes(manual.status), JSON.stringify(manual.body));
});

test("Konfirmasi muat: unit asing ditolak, job selesai ditolak, bukan pemilik job ditolak", async () => {
  const w = await seed();
  const asing = await w.c.post(`/api/armada/jobs/${w.job.id}/unit-load`, { unitIds: [randomUUID()] }, BARU);
  assert.equal(asing.status, 400);
  const lain = await createTestUser({ roles: ["DRIVER"] });
  const bukanPemilik = await makeClient(server.baseUrl, lain.token).post(`/api/armada/jobs/${w.job.id}/unit-load`, { semua: true }, BARU);
  assert.ok([403, 404].includes(bukanPemilik.status), String(bukanPemilik.status));
  await testPrisma.job.update({ where: { id: w.job.id }, data: { status: "COMPLETED", completedAt: new Date() } });
  const selesai = await w.c.post(`/api/armada/jobs/${w.job.id}/unit-load`, { semua: true }, BARU);
  assert.equal(selesai.status, 409);
});

test("V2 (aplikasi RN): job snapshot membawa unit lengkap + progres muat; manifest identik dengan jalur V1; tanpa harga", async () => {
  const w = await seed();
  await w.c.post(`/api/armada/jobs/${w.job.id}/unit-load`, { unitIds: [w.units[0].id, w.units[1].id] }, BARU);
  const snap = await readDriverFullSnapshot(testPrisma, { userId: w.driver.user.id, secret: "delivery-gate-test-secret-0123" });
  assert.equal(snap.items.length, 1);
  const j = snap.items[0].jobs[0];
  assert.equal(j.units.length, 3);
  assert.ok(j.units.every((ju) => ju.unit.unitCode && ju.unit.seq), "unit memuat kode & seq");
  const m = manifestJob(j);
  assert.equal(m.unit, 3);
  assert.equal(m.ringkas, "1 stop • 3 unit • 1 jenis produk");
  assert.deepEqual(m.baris[0].unitLabel, ["U1", "U2", "U3"]);
  assert.equal(m.muat.dimuat, 2);
  assert.equal(m.muat.label, "Barang dimuat 2/3 unit");
  const v1 = (await w.c.get("/api/armada/my-jobs")).body;
  const jv1 = (v1.jobs || []).find((x) => x.id === w.job.id);
  assert.deepEqual(jv1.manifest.baris.map((b) => [b.qty, b.nama, b.ukuran, b.unitLabel]), m.baris.map((b) => [b.qty, b.nama, b.ukuran, b.unitLabel]), "V1 = V2");
  assert.doesNotMatch(JSON.stringify(m), /harga|price|nominal|7200000|"value"/i);
});

test("V2 lewat HTTP: router menempelkan manifest pada /armada/v2/me/snapshot", async () => {
  const w = await seed();
  for (const key of [V2_FLAGS.DELIVERY_ROUTE_WRITER, V2_FLAGS.DELIVERY_EXECUTION_WRITER, V2_FLAGS.DRIVER_SNAPSHOT_READER]) {
    await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, enabled: true, scope: "GLOBAL", config: {}, reason: "uji gerbang muat" }, update: { enabled: true, scope: "GLOBAL", config: {}, reason: "uji gerbang muat" } });
  }
  const r = await w.c.get("/api/armada/v2/me/snapshot");
  if (r.status === 503 || r.status === 409) { assert.ok(false, `snapshot V2 tidak aktif di uji: ${r.status} ${JSON.stringify(r.body)}`); }
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const job = r.body.items[0].jobs[0];
  assert.equal(job.manifest?.unit, 3);
  assert.equal(job.manifest.stop, 1);
});
