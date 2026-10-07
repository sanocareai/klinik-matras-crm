// Histori Waktu Route & Stop (7 Okt 2026) — GET /routes/:id/timeline,
// penulisan event (occurredAt/source) di tiap aksi lapangan, atomik dengan
// transisi status, retry idempoten, ROUTE_COMPLETED turunan dari aksi
// terakhir, JOB_RESCHEDULED (idempotency BARU ditambahkan di fase ini),
// dan koreksi POD_EDITED append-only muncul di linimasa.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server; let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

let idemSeq = 0;
function idem(prefix = "tl") {
  idemSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idemSeq}-abcdefgh`;
}
const hdr = (k) => ({ "Idempotency-Key": k });

async function fixtureRoute({ jobCount = 1 } = {}) {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const otherDriver = await createTestUser({ roles: ["DRIVER"] });
  const dispatcher = await createTestUser({ roles: ["DISPATCHER"] });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Timeline", city: "Jakarta" } });
  const route = await testPrisma.route.create({
    data: { code: `TL-RTE-${++seq}`, date: new Date("2026-10-07T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: driver.user.id },
  });
  const jobs = [];
  for (let i = 0; i < jobCount; i++) {
    const order = await testPrisma.order.create({
      data: { customerId: customer.id, orderNumber: `TL-ORD-${++seq}`, value: 1_000_000, category: "LAYANAN", status: "DELIVERED" },
    });
    jobs.push(await testPrisma.job.create({
      data: { type: "DELIVERY", orderId: order.id, routeId: route.id, driverId: driver.user.id, status: "ASSIGNED", sequence: i + 1 },
    }));
  }
  return {
    driver, otherDriver, dispatcher, admin, route, jobs,
    driverApi: makeClient(server.baseUrl, driver.token),
    otherDriverApi: makeClient(server.baseUrl, otherDriver.token),
    dispatcherApi: makeClient(server.baseUrl, dispatcher.token),
    adminApi: makeClient(server.baseUrl, admin.token),
  };
}

const TL = (routeId) => `/api/armada/routes/${routeId}/timeline`;

test("jalur lengkap: berangkat -> menuju -> tiba -> selesai muncul di linimasa dengan occurredAt, source, dan durasi antar-milestone", async () => {
  const f = await fixtureRoute();
  // occurredAt = "SEKARANG" persis sebelum tiap panggilan (pola SAMA dengan
  // klien nyata: submitOrQueue/executionQueue.js merekam waktu TAP, bukan
  // jadwal buatan) — tetap dekat dengan createdAt server walau test berjalan
  // sekian detik, jadi TIDAK memicu late-sync/suspicious-clock palsu.
  const sekarang = () => new Date().toISOString();

  const startRes = await f.driverApi.post(`/api/armada/routes/${f.route.id}/start`, {
    proofPhotoUrls: ["/media/job-photos/muatan.jpg"], occurredAt: sekarang(), clientPlatform: "DRIVER_APP",
  }, hdr(idem("start")));
  assert.equal(startRes.status, 200, JSON.stringify(startRes.body));

  const waktuMulai = sekarang();
  const towardRes = await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/start`, {
    occurredAt: waktuMulai, clientPlatform: "DRIVER_APP",
  }, hdr(idem("toward")));
  assert.equal(towardRes.status, 200, JSON.stringify(towardRes.body));

  const waktuTiba = sekarang();
  const arriveRes = await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/arrive`, {
    occurredAt: waktuTiba, clientPlatform: "DRIVER_APP",
  }, hdr(idem("arrive")));
  assert.equal(arriveRes.status, 200, JSON.stringify(arriveRes.body));

  const waktuSelesai = sekarang();
  const completeRes = await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/complete`, {
    proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Budi", note: null, location: null,
    occurredAt: waktuSelesai, clientPlatform: "DRIVER_APP",
  }, hdr(idem("complete")));
  assert.equal(completeRes.status, 200, JSON.stringify(completeRes.body));

  const tl = await f.driverApi.get(TL(f.route.id));
  assert.equal(tl.status, 200, JSON.stringify(tl.body));
  assert.equal(tl.body.routeEvents.length, 2); // ROUTE_STARTED + ROUTE_COMPLETED (job terakhir tuntas)
  const ruteBerangkat = tl.body.routeEvents.find((e) => e.action === "ROUTE_STARTED");
  assert.equal(ruteBerangkat.source, "DRIVER_APP");
  assert.equal(ruteBerangkat.actorName, f.driver.user.name);

  const job = tl.body.jobs[0];
  const actions = job.events.map((e) => e.action);
  assert.deepEqual(actions, ["JOB_STARTED", "JOB_ARRIVED", "JOB_COMPLETED"]);
  // Urutan waktu tetap benar (menuju <= tiba <= selesai) walau jaraknya
  // sekian detik nyata, bukan jadwal buatan — travel/service tersedia & >= 0.
  assert.ok(job.travelMs != null && job.travelMs >= 0, `travelMs: ${job.travelMs}`);
  assert.ok(job.serviceMs != null && job.serviceMs >= 0, `serviceMs: ${job.serviceMs}`);
  for (const e of job.events) {
    assert.equal(e.hasDeviceTime, true);
    assert.equal(e.isLateSync, false);
    assert.equal(e.isSuspiciousClock, false);
  }
});

test("ROUTE_COMPLETED tercatat begitu job TERAKHIR tuntas, mewarisi actor/occurredAt/source dari aksi itu", async () => {
  const f = await fixtureRoute({ jobCount: 2 });
  await f.driverApi.post(`/api/armada/routes/${f.route.id}/start`, { proofPhotoUrls: ["/media/job-photos/m.jpg"] }, hdr(idem("start")));

  // Job 1 gagal.
  await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/start`, {}, hdr(idem("s1")));
  await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/fail`, {
    failureReason: "Customer tidak di tempat", failurePhotoUrls: ["/media/job-photos/g.jpg"],
  }, hdr(idem("f1")));
  let tl = await f.driverApi.get(TL(f.route.id));
  assert.equal(tl.body.routeEvents.find((e) => e.action === "ROUTE_COMPLETED"), undefined, "rute belum selesai, job 2 masih aktif");

  // Job 2 selesai -> SEKARANG rute tuntas.
  await f.driverApi.post(`/api/armada/jobs/${f.jobs[1].id}/start`, {}, hdr(idem("s2")));
  await f.driverApi.post(`/api/armada/jobs/${f.jobs[1].id}/arrive`, {}, hdr(idem("a2")));
  const finishKey = idem("c2");
  const finish = await f.driverApi.post(`/api/armada/jobs/${f.jobs[1].id}/complete`, {
    proofPhotoUrls: ["/media/job-photos/p.jpg"], recipientName: "Ani", occurredAt: "2026-10-07T05:00:00.000Z", clientPlatform: "DRIVER_APP",
  }, hdr(finishKey));
  assert.equal(finish.status, 200, JSON.stringify(finish.body));

  tl = await f.driverApi.get(TL(f.route.id));
  const selesaiRute = tl.body.routeEvents.find((e) => e.action === "ROUTE_COMPLETED");
  assert.ok(selesaiRute, "ROUTE_COMPLETED harus tercatat setelah job terakhir tuntas");
  assert.equal(selesaiRute.occurredAt, "2026-10-07T05:00:00.000Z");
  assert.equal(selesaiRute.actorName, f.driver.user.name);
  assert.equal(selesaiRute.source, "DRIVER_APP");

  const route = await testPrisma.route.findUnique({ where: { id: f.route.id } });
  assert.equal(route.status, "COMPLETED");
});

test("retry idempoten TIDAK menggandakan event: double-tap complete hanya SATU baris DeliveryExecutionEvent, occurredAt replay = occurredAt asli", async () => {
  const f = await fixtureRoute();
  await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/start`, {}, hdr(idem("s")));
  await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/arrive`, {}, hdr(idem("a")));
  const key = idem("complete-retry");
  const body = {
    proofPhotoUrls: ["/media/job-photos/p.jpg"], recipientName: "Budi",
    occurredAt: "2026-10-07T02:00:00.000Z", clientPlatform: "DRIVER_APP",
  };
  const pertama = await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/complete`, body, hdr(key));
  assert.equal(pertama.status, 200, JSON.stringify(pertama.body));
  // Retry dengan occurredAt BERBEDA (simulasi klien mengirim ulang dengan jam baru) — HARUS tetap dianggap replay, tidak menimpa.
  const kedua = await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/complete`, { ...body, occurredAt: "2026-10-07T09:00:00.000Z" }, hdr(key));
  assert.equal(kedua.status, 200, JSON.stringify(kedua.body));
  assert.equal(kedua.headers.get("idempotency-replayed"), "true");

  const jumlah = await testPrisma.deliveryExecutionEvent.count({ where: { idempotencyKey: key } });
  assert.equal(jumlah, 1);
  const tl = await f.driverApi.get(TL(f.route.id));
  const selesai = tl.body.jobs[0].events.find((e) => e.action === "JOB_COMPLETED");
  assert.equal(selesai.occurredAt, "2026-10-07T02:00:00.000Z", "occurredAt TETAP dari percobaan PERTAMA, bukan percobaan retry");
});

test("sinkronisasi terlambat (offline): occurredAt jauh sebelum createdAt -> isLateSync true dengan selisih benar", async () => {
  const f = await fixtureRoute();
  await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/start`, {}, hdr(idem("s")));
  const occurredAt = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 menit lalu — tap asli saat offline
  const r = await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/arrive`, { occurredAt, clientPlatform: "DRIVER_APP" }, hdr(idem("a")));
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const tl = await f.driverApi.get(TL(f.route.id));
  const tiba = tl.body.jobs[0].events.find((e) => e.action === "JOB_ARRIVED");
  assert.equal(tiba.occurredAt, occurredAt);
  assert.equal(tiba.isLateSync, true);
  assert.equal(tiba.isSuspiciousClock, false);
  assert.ok(tiba.lateSyncMs >= 14 * 60 * 1000);
});

test("jam perangkat janggal: occurredAt di masa depan -> isSuspiciousClock true, aksi TETAP tercatat (tidak ditolak)", async () => {
  const f = await fixtureRoute();
  await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/start`, {}, hdr(idem("s")));
  const occurredAt = new Date(Date.now() + 3600_000).toISOString(); // 1 jam ke depan — jam HP driver ngaco
  const r = await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/arrive`, { occurredAt, clientPlatform: "DRIVER_APP" }, hdr(idem("a")));
  assert.equal(r.status, 200, JSON.stringify(r.body), "jam janggal TETAP diterima, cuma dilabeli saat tampil");

  const tl = await f.driverApi.get(TL(f.route.id));
  const tiba = tl.body.jobs[0].events.find((e) => e.action === "JOB_ARRIVED");
  assert.equal(tiba.isSuspiciousClock, true);
});

test("klien lama TANPA occurredAt/clientPlatform tetap kompatibel — default ke waktu server, source null", async () => {
  const f = await fixtureRoute();
  const r = await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/start`, {}, hdr(idem("legacy")));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const tl = await f.driverApi.get(TL(f.route.id));
  const mulai = tl.body.jobs[0].events.find((e) => e.action === "JOB_STARTED");
  assert.ok(mulai.occurredAt, "default ke sekarang, bukan null/dikosongkan");
  assert.equal(mulai.source, null);
  assert.equal(mulai.hasDeviceTime, true); // tetap ada occurredAt (default now), bukan "tanpa device time"
});

test("milestone tanpa baris event (job belum sampai tahap itu) tidak muncul sama sekali — konsumen (frontend) yang menampilkan Tidak tersedia", async () => {
  const f = await fixtureRoute();
  await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/start`, {}, hdr(idem("s")));
  const tl = await f.driverApi.get(TL(f.route.id));
  const actions = tl.body.jobs[0].events.map((e) => e.action);
  assert.deepEqual(actions, ["JOB_STARTED"]); // belum tiba/selesai -> TIDAK ADA di daftar, bukan null di dalamnya
  assert.equal(tl.body.jobs[0].serviceMs, null);
  assert.equal(tl.body.jobs[0].travelMs, null);
});

test("akses linimasa: driver LAIN (bukan pemilik rute) ditolak 403; dispatcher lihat rute mana pun", async () => {
  const f = await fixtureRoute();
  const ditolak = await f.otherDriverApi.get(TL(f.route.id));
  assert.equal(ditolak.status, 403, JSON.stringify(ditolak.body));
  const boleh = await f.dispatcherApi.get(TL(f.route.id));
  assert.equal(boleh.status, 200);
});

test("JOB_RESCHEDULED tercatat di linimasa dan retry TIDAK menggandakan JobIssueLog/RescheduleCase (idempotency baru)", async () => {
  const f = await fixtureRoute();
  const mulai = await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/start`, {}, hdr(idem("s")));
  assert.equal(mulai.status, 200, JSON.stringify(mulai.body));
  const gagal = await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/fail`, {
    failureReason: "Alamat tidak ditemukan", failurePhotoUrls: ["/media/job-photos/g.jpg"],
  }, hdr(idem("f")));
  assert.equal(gagal.status, 200, JSON.stringify(gagal.body));
  assert.equal((await testPrisma.job.findUnique({ where: { id: f.jobs[0].id } })).status, "FAILED");

  const key = idem("reschedule");
  const body = { scheduledDate: "2026-10-10", reason: "Dijadwalkan ulang oleh dispatcher", occurredAt: "2026-10-07T03:00:00.000Z", clientPlatform: "WEB" };
  const pertama = await f.dispatcherApi.post(`/api/armada/issues/${f.jobs[0].id}/reschedule`, body, hdr(key));
  assert.equal(pertama.status, 200, JSON.stringify(pertama.body));
  const kedua = await f.dispatcherApi.post(`/api/armada/issues/${f.jobs[0].id}/reschedule`, body, hdr(key));
  assert.equal(kedua.status, 200, JSON.stringify(kedua.body));
  assert.equal(kedua.headers.get("idempotency-replayed"), "true");

  assert.equal(await testPrisma.jobIssueLog.count({ where: { jobId: f.jobs[0].id, type: "RESCHEDULED" } }), 1, "retry tidak boleh menggandakan riwayat");
  assert.equal(await testPrisma.rescheduleCase.count({ where: { jobId: f.jobs[0].id } }), 1);
  assert.equal(await testPrisma.deliveryExecutionEvent.count({ where: { idempotencyKey: key } }), 1);

  const tl = await f.driverApi.get(TL(f.route.id));
  const dijadwalUlang = tl.body.jobs[0].events.find((e) => e.action === "JOB_RESCHEDULED");
  assert.ok(dijadwalUlang, "JOB_RESCHEDULED harus muncul di linimasa rute (routeId diambil dari job SEBELUM dilepas)");
  assert.equal(dijadwalUlang.occurredAt, "2026-10-07T03:00:00.000Z");
});

test("koreksi POD append-only: PATCH /pod/:jobId/edit mengubah completedAt, linimasa menampilkan koreksi DENGAN alasan+actor, bukan menimpa event asli", async () => {
  const f = await fixtureRoute();
  await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/start`, {}, hdr(idem("s")));
  await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/arrive`, {}, hdr(idem("a")));
  const asliWaktu = "2026-10-07T04:00:00.000Z";
  await f.driverApi.post(`/api/armada/jobs/${f.jobs[0].id}/complete`, {
    proofPhotoUrls: ["/media/job-photos/p.jpg"], recipientName: "Budi", occurredAt: asliWaktu, clientPlatform: "DRIVER_APP",
  }, hdr(idem("c")));

  const koreksi = await f.adminApi.patch(`/api/armada/pod/${f.jobs[0].id}/edit`, {
    reason: "Waktu selesai salah dicatat, sebenarnya lebih pagi",
    completedAt: "2026-10-07T03:30:00.000Z",
  });
  assert.equal(koreksi.status, 200, JSON.stringify(koreksi.body));

  const tl = await f.driverApi.get(TL(f.route.id));
  const job = tl.body.jobs[0];
  // Event JOB_COMPLETED ASLI tidak pernah berubah (append-only) — occurredAt tetap waktu tap asli.
  const selesaiEvent = job.events.find((e) => e.action === "JOB_COMPLETED");
  assert.equal(selesaiEvent.occurredAt, asliWaktu);
  // Koreksi muncul TERPISAH, dengan alasan + actor.
  assert.equal(job.corrections.length, 1);
  assert.equal(job.corrections[0].reason, "Waktu selesai salah dicatat, sebenarnya lebih pagi");
  assert.equal(job.corrections[0].actorName, f.admin.user.name);
  assert.equal(job.corrections[0].to, "2026-10-07T03:30:00.000Z");
});
