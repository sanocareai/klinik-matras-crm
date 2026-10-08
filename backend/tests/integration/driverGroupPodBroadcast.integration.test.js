// Dokumentasi POD ke Grup Driver (8 Okt 2026, diaktifkan kembali) + kontrak status Unit/Order saat
// driver menyelesaikan pickup/delivery. Simulasi pengiriman WAHA TANPA grup nyata: WAHA_BASE_URL
// tidak mengarah ke server sungguhan di lingkungan tes, jadi percobaan kirim gagal secara alami —
// itulah yang dipakai untuk membuktikan "kegagalan WhatsApp tidak menggagalkan job" tanpa mock.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

async function kirimKelengkapan(token, routeId) {
  const fd = new FormData();
  fd.append("photos", new Blob([await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer()], { type: "image/jpeg" }), "k.jpg");
  const res = await fetch(`${server.baseUrl}/api/armada/routes/${routeId}/kelengkapan`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  if (res.status !== 201) throw new Error(`gagal kirim kelengkapan fixture rute ${routeId}: ${res.status} ${await res.text()}`);
}

let server;
let seq = 0;
let envSebelum;

test.before(async () => {
  await truncateAll();
  server = await startTestServer(buildTestApp());
  envSebelum = process.env.POD_BROADCAST_AKTIF;
});
test.after(async () => {
  await truncateAll(); await server.close(); await testPrisma.$disconnect();
  if (envSebelum === undefined) delete process.env.POD_BROADCAST_AKTIF; else process.env.POD_BROADCAST_AKTIF = envSebelum;
});
test.afterEach(async () => { await truncateAll(); delete process.env.POD_BROADCAST_AKTIF; });

const key = (value) => ({ "Idempotency-Key": `pod-broadcast-${value}-9f3c` });

// unitCount unit per job; statusLocked opsional untuk order; stageIdPerUnit[i] (opsional) = beri
// currentStageId NYATA ke unit ke-i (selain itu NULL — unit "legacy"/belum masuk stage engine).
async function fixture({ jobType = "PICKUP", unitCount = 1, statusLocked = false, stageIdPerUnit = [] } = {}) {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan POD-WA ${++seq}` } });
  const order = await testPrisma.order.create({
    data: { customerId: customer.id, orderNumber: `PODWA-${++seq}`, value: 1000, category: "LAYANAN", statusLocked },
  });
  const route = await testPrisma.route.create({
    data: { code: `PODWA-RTE-${++seq}`, date: new Date("2026-10-08T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: driver.user.id },
  });
  const job = await testPrisma.job.create({
    data: { type: jobType, orderId: order.id, routeId: route.id, driverId: driver.user.id, status: "ASSIGNED", sequence: 1 },
  });
  const units = [];
  for (let i = 0; i < unitCount; i += 1) {
    const unit = await testPrisma.unit.create({
      data: {
        unitCode: `UNITWA-${seq}-${i}`, orderId: order.id, seq: i + 1,
        status: jobType === "PICKUP" ? "AWAITING_PICKUP" : "READY_FOR_DELIVERY",
        merk: "King Koil", ukuran: i === 0 ? "160x200" : "180x200",
        ...(stageIdPerUnit[i] ? { currentStageId: stageIdPerUnit[i] } : {}),
      },
    });
    await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
    units.push(unit);
  }
  return { driver: { ...driver, api: makeClient(server.baseUrl, driver.token) }, customer, order, route, job, units };
}

// Jalankan route start (kirim kelengkapan dulu) -> job toward -> arrive -> SIAP complete.
async function sampaiSiapComplete(f) {
  await kirimKelengkapan(f.driver.token, f.route.id);
  ok(await f.driver.api.post(`/api/armada/routes/${f.route.id}/start`, { proofPhotoUrls: ["/media/job-photos/load.jpg"] }, key(`start-${f.job.id}`)));
  await jobTowardDanTiba(f);
}
// Dipakai utk job KEDUA pada rute yang SUDAH berangkat (route/:id/start satu kali per rute, bukan
// per job) — langsung toward->tiba tanpa mengulang kelengkapan/route-start (sudah dibekukan).
async function jobTowardDanTiba(f) {
  ok(await f.driver.api.post(`/api/armada/jobs/${f.job.id}/start`, {}, key(`toward-${f.job.id}`)));
  ok(await f.driver.api.post(`/api/armada/jobs/${f.job.id}/arrive`, { location: null }, key(`arrive-${f.job.id}`)));
}
const ok = (res) => { assert.equal(res.status, 200, JSON.stringify(res.body)); return res.body; };
const complete = (f, tag = "complete") => f.driver.api.post(`/api/armada/jobs/${f.job.id}/complete`, {
  proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penerima POD-WA", note: "ok", location: null,
}, key(tag));

test("Pickup selesai: unit jadi RECEIVED, order jadi PROCESSING — termasuk unit LEGACY (currentStageId NULL) berkat forceStagedUnitIds", async () => {
  const f = await fixture({ jobType: "PICKUP", unitCount: 1 });
  assert.equal(f.units[0].currentStageId, null, "unit baru dibuat tanpa currentStageId — kasus legacy yang relevan");
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status, "PENDING");
  await sampaiSiapComplete(f);
  const res = ok(await complete(f));
  assert.equal(res.status, "COMPLETED");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: f.units[0].id } })).status, "RECEIVED");
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status, "PROCESSING", "unit legacy TETAP ikut agregasi weakest-link untuk unit yang baru saja disentuh job ini");
});

test("Delivery selesai: unit DELIVERED, order DELIVERED HANYA bila SEMUA unit aktif sudah terkirim (weakest-link multi-unit)", async () => {
  // SENGAJA unitCount:1 pada job pertama — unit kedua dibuat terpisah dan TIDAK ditautkan ke job1
  // sama sekali (jobUnit.updateMany job1 hanya menyentuh unit yang jadi jobUnit-nya sendiri), supaya
  // menyelesaikan job1 TIDAK ikut mengubah status unit kedua.
  const f = await fixture({ jobType: "DELIVERY", unitCount: 1 });
  await sampaiSiapComplete(f);
  // Unit kedua di order yang SAMA, BELUM terkirim (job TERPISAH yang belum selesai) — beri currentStageId
  // NYATA (bukan legacy) supaya ikut terhitung agregasi lewat jalur BIASA (bukan fix forceStagedUnitIds,
  // yang hanya berlaku untuk unit yang baru saja disentuh job PICKUP/DELIVERY ini).
  const stageLama = await testPrisma.routingStage.create({ data: { code: `podwa-stage-${++seq}`, labelId: "Tahap Uji", phase: "MODULE", sequence: 1, requiresQc: false } });
  const unit2 = await testPrisma.unit.create({ data: { unitCode: `UNITWA-${seq}-wl2`, orderId: f.order.id, seq: 2, status: "READY_FOR_DELIVERY", merk: "King Koil", ukuran: "180x200", currentStageId: stageLama.id } });
  const res = ok(await complete(f));
  assert.equal(res.status, "COMPLETED");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: f.units[0].id } })).status, "DELIVERED");
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status, "READY", "order TIDAK boleh DELIVERED selagi unit kedua masih tertinggal (weakest-link)");

  // Sekarang unit kedua ikut terkirim (job KEDUA, terpisah) -> order baru boleh DELIVERED.
  const job2 = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: f.order.id, routeId: f.route.id, driverId: f.driver.user.id, status: "ASSIGNED", sequence: 2 } });
  await testPrisma.jobUnit.create({ data: { jobId: job2.id, unitId: unit2.id } });
  const f2 = { ...f, job: job2 };
  await jobTowardDanTiba(f2);
  ok(await complete(f2, "complete-2"));
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit2.id } })).status, "DELIVERED");
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status, "DELIVERED");
});

test("Order statusLocked=true TIDAK ditimpa oleh penyelesaian job — dicatat, bukan dipaksa", async () => {
  const f = await fixture({ jobType: "PICKUP", unitCount: 1, statusLocked: true });
  await testPrisma.order.update({ where: { id: f.order.id }, data: { status: "SHIPPING" } }); // nilai sengaja tidak masuk akal, supaya kelihatan jelas kalau TERTIMPA
  await sampaiSiapComplete(f);
  ok(await complete(f));
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: f.units[0].id } })).status, "RECEIVED", "unit tetap diupdate — guard hanya di sisi Order");
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status, "SHIPPING", "statusLocked menang mutlak, order TIDAK disentuh sinkronisasi otomatis");
  assert.equal(await testPrisma.orderStatusTransition.count({ where: { orderId: f.order.id } }), 0, "tidak ada baris transisi status ditulis untuk order terkunci");
});

test("Idempotency replay TIDAK menggandakan perubahan status Unit/Order maupun transisi tercatat", async () => {
  const f = await fixture({ jobType: "PICKUP", unitCount: 1 });
  await sampaiSiapComplete(f);
  const pertama = ok(await complete(f));
  const ulang = ok(await complete(f));
  assert.equal(ulang.status, "COMPLETED");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: f.units[0].id } })).status, "RECEIVED");
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).status, "PROCESSING");
  assert.equal(await testPrisma.orderStatusTransition.count({ where: { orderId: f.order.id } }), 1, "replay tidak menggandakan baris transisi status order");
  assert.equal(await testPrisma.deliveryExecutionEvent.count({ where: { jobId: f.job.id, action: "JOB_COMPLETED" } }), 1, "replay tidak menggandakan event eksekusi");
});

test("Kill-switch POD_BROADCAST_AKTIF=false: job tetap selesai normal, caption tidak pernah dicoba dikirim", async () => {
  process.env.POD_BROADCAST_AKTIF = "false";
  const f = await fixture({ jobType: "PICKUP", unitCount: 1 });
  const group = await testPrisma.conversation.create({ data: { type: "GROUP", channel: "WHATSAPP", isDriverGroup: true, groupName: "SANO DRIVETHRU", groupJid: `120363${++seq}@g.us` } });
  await sampaiSiapComplete(f);
  const res = ok(await complete(f));
  assert.equal(res.status, "COMPLETED", "kill-switch tidak pernah menghalangi penyelesaian job itu sendiri");
  assert.equal(await testPrisma.message.count({ where: { conversationId: group.id } }), 0, "kill-switch aktif: TIDAK ADA percobaan kirim ke grup sama sekali (early return, bukan dicoba-lalu-gagal)");
});

test("Grup driver belum ditetapkan ATAU WAHA tidak terjangkau: job tetap selesai (best-effort, kegagalan tercatat di log bukan di response)", async () => {
  const fTanpaGrup = await fixture({ jobType: "PICKUP", unitCount: 1 });
  await sampaiSiapComplete(fTanpaGrup);
  const resTanpaGrup = ok(await complete(fTanpaGrup, "complete-tanpa-grup"));
  assert.equal(resTanpaGrup.status, "COMPLETED", "tanpa grup driver ditetapkan: job tetap selesai, diam-diam (bukan error)");

  // Grup SUDAH ditetapkan tapi WAHA_BASE_URL di lingkungan tes tidak menunjuk server sungguhan —
  // percobaan kirim GAGAL secara alami (ECONNREFUSED/timeout), membuktikan kegagalan WAHA tidak
  // pernah menggagalkan response job yang sudah beres (try/catch best-effort di notifyDriverGroup).
  const fDenganGrup = await fixture({ jobType: "DELIVERY", unitCount: 1 });
  await testPrisma.conversation.create({ data: { type: "GROUP", channel: "WHATSAPP", isDriverGroup: true, groupName: "SANO DRIVETHRU", groupJid: `120364${++seq}@g.us` } });
  await sampaiSiapComplete(fDenganGrup);
  const resDenganGrup = ok(await complete(fDenganGrup, "complete-dengan-grup"));
  assert.equal(resDenganGrup.status, "COMPLETED", "WAHA tidak terjangkau di lingkungan tes -> kegagalan kirim TIDAK menggagalkan penyelesaian job");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: fDenganGrup.units[0].id } })).status, "DELIVERED");
});

test("Target broadcast HANYA Conversation isDriverGroup=true — grup WA lain (bukan SANO DRIVETHRU) tidak pernah dipilih", async () => {
  const bukanGrupDriver = await testPrisma.conversation.create({ data: { type: "GROUP", channel: "WHATSAPP", isDriverGroup: false, groupName: "Grup Lain", groupJid: `120365${++seq}@g.us` } });
  const f = await fixture({ jobType: "PICKUP", unitCount: 1 });
  await sampaiSiapComplete(f);
  ok(await complete(f));
  assert.equal(await testPrisma.message.count({ where: { conversationId: bukanGrupDriver.id } }), 0, "grup WA yang bukan isDriverGroup=true TIDAK PERNAH menjadi target, walau ada di database");
});
