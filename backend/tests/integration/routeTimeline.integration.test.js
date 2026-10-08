// Histori waktu rute & stop (fase 2 Checklist Persiapan Perjalanan) — HTTP + DB sungguhan.
// Event ditulis ATOMIK dengan transisi status di ledger eksekusi yang sudah ada (tanpa ledger ganda), idempoten saat retry, mempertahankan waktu kejadian
// dari antrean offline, menandai jam perangkat janggal, koreksi append-only, histori lama "Tidak tersedia", dan akses foto checklist (tanpa login /
// driver lain / berwenang).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server; let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (v) => ({ "Idempotency-Key": `tl-${v}-${++seq}-abcdefgh` });
const keyed = (k, extra = {}) => ({ "Idempotency-Key": `${k}-kunci-idempoten`, ...extra }); // kunci wajib 12–128 karakter

async function fixture({ jobs: jobCount = 2 } = {}) {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const otherDriver = await createTestUser({ roles: ["DRIVER"] });
  const dispatcher = await createTestUser({ roles: ["DISPATCHER"] });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Timeline", city: "Jakarta" } });
  const route = await testPrisma.route.create({ data: { code: `TL-RTE-${++seq}`, date: new Date("2026-10-07T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: driver.user.id } });
  const jobs = [];
  for (let i = 0; i < jobCount; i += 1) {
    const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `TL-ORD-${++seq}`, value: 1000, category: "LAYANAN" } });
    jobs.push(await testPrisma.job.create({ data: { type: i === 1 ? "PICKUP" : "DELIVERY", orderId: order.id, routeId: route.id, driverId: driver.user.id, status: "ASSIGNED", sequence: i + 1 } }));
  }
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  return { driver: c(driver), otherDriver: c(otherDriver), dispatcher: c(dispatcher), route, jobs };
}
// Bukti Kelengkapan Standar (7 Okt 2026) — SELALU wajib minimal 1 foto
// sebelum start bisa sukses (lihat routePrepChecklist.js); tes di file ini
// soal histori waktu, bukan soal checklist — kirim 1 foto seadanya tiap
// kali SEBELUM start supaya gerbang itu tidak mengganggu apa yang diuji.
async function kirimKelengkapan(token, routeId) {
  const fd = new FormData();
  fd.append("photos", new Blob([await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer()], { type: "image/jpeg" }), "k.jpg");
  const res = await fetch(`${server.baseUrl}/api/armada/routes/${routeId}/kelengkapan`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  if (res.status !== 201) throw new Error(`gagal kirim kelengkapan fixture rute ${routeId}: ${res.status} ${await res.text()}`);
}
const routeStart = async (f, k, headers = {}) => {
  await kirimKelengkapan(f.driver.token, f.route.id);
  return f.driver.api.post(`/api/armada/routes/${f.route.id}/start`, { proofPhotoUrls: ["/media/job-photos/load.jpg"] }, keyed(k, headers));
};
const jobPost = (f, i, action, body, k, headers = {}) => f.driver.api.post(`/api/armada/jobs/${f.jobs[i].id}/${action}`, body, keyed(k, headers));
const pod = { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Budi Penerima", location: null };
const events = (routeId) => testPrisma.deliveryExecutionEvent.findMany({ where: { routeId }, orderBy: { createdAt: "asc" } });
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

test("alur lengkap: event permanen untuk berangkat/menuju/tiba/selesai/rute selesai — actor, sumber, waktu kejadian & waktu diterima server tersimpan", async () => {
  const f = await fixture({ jobs: 1 });
  const H = (min, source = "DRIVER_APP") => ({ "X-Event-Occurred-At": ago(min), "X-Action-Source": source });
  assert.equal((await routeStart(f, "tl-rs-0001", H(0.2))).status, 200);
  assert.equal((await jobPost(f, 0, "start", {}, "tl-js-0001", H(0.2))).status, 200);
  assert.equal((await jobPost(f, 0, "arrive", { location: null }, "tl-ja-0001", H(0.2, "DRIVER_WEB"))).status, 200);
  assert.equal((await jobPost(f, 0, "complete", pod, "tl-jc-0001", H(0.2))).status, 200);

  const all = await events(f.route.id);
  assert.deepEqual(all.map((e) => e.action), ["ROUTE_STARTED", "JOB_STARTED", "JOB_ARRIVED", "JOB_COMPLETED", "ROUTE_COMPLETED"]);
  for (const e of all.slice(0, 4)) { assert.equal(e.actorId, f.driver.user.id); assert.ok(e.occurredAt && e.createdAt); assert.equal(e.timeQuality, "LANGSUNG"); }
  assert.deepEqual(all.map((e) => e.source), ["DRIVER_APP", "DRIVER_APP", "DRIVER_WEB", "DRIVER_APP", "DRIVER_APP"], "rute selesai mewarisi sumber & waktu aksi pemicunya (ditandai derived)");
  assert.equal(all[4].actorId, f.driver.user.id); assert.equal(all[4].payload.triggerJobId, f.jobs[0].id);
  const done = await testPrisma.route.findUnique({ where: { id: f.route.id } });
  assert.equal(done.status, "COMPLETED");
  assert.equal(all[4].payload.derived, true, "rute selesai = turunan transisi job terakhir, di transaksi yang sama");

  const tl = await f.driver.api.get(`/api/armada/routes/${f.route.id}/timeline`);
  assert.equal(tl.status, 200, JSON.stringify(tl.body));
  assert.deepEqual(tl.body.routeEvents.map((e) => e.label), ["Berangkat dari Sano", "Rute selesai"]);
  assert.deepEqual(tl.body.stops[0].events.map((e) => e.label), ["Menuju lokasi", "Tiba di lokasi", "Pengiriman selesai"]);
  assert.match(tl.body.stops[0].events[0].atText, /WIB$/);
  assert.equal(tl.body.stops[0].events[1].sourceLabel, "Driver Web");
  assert.equal(tl.body.canCorrect, false, "driver tidak boleh mengoreksi");
});

test("retry (Idempotency-Key sama) tidak menggandakan event; kunci sama untuk aksi lain ditolak; rute selesai hanya sekali", async () => {
  const f = await fixture({ jobs: 1 });
  await routeStart(f, "tl-rs-0002");
  await jobPost(f, 0, "start", {}, "tl-js-0002");
  const a = await jobPost(f, 0, "arrive", { location: null }, "tl-ja-0002");
  const aReplay = await jobPost(f, 0, "arrive", { location: null }, "tl-ja-0002");
  assert.equal(a.status, 200); assert.equal(aReplay.status, 200); assert.equal(aReplay.headers.get("idempotency-replayed"), "true");
  const c = await jobPost(f, 0, "complete", pod, "tl-jc-0002");
  const cReplay = await jobPost(f, 0, "complete", pod, "tl-jc-0002");
  assert.equal(c.status, 200); assert.equal(cReplay.headers.get("idempotency-replayed"), "true");
  const counts = Object.fromEntries((await events(f.route.id)).reduce((m, e) => m.set(e.action, (m.get(e.action) || 0) + 1), new Map()));
  assert.deepEqual(counts, { ROUTE_STARTED: 1, JOB_STARTED: 1, JOB_ARRIVED: 1, JOB_COMPLETED: 1, ROUTE_COMPLETED: 1 });
});

test("atomik: transisi yang ditolak (409) tidak meninggalkan event; event ditulis bersama perubahan status", async () => {
  const f = await fixture({ jobs: 1 });
  const bad = await jobPost(f, 0, "arrive", { location: null }, "tl-ja-0003"); // ASSIGNED belum EN_ROUTE
  assert.equal(bad.status, 409);
  assert.equal(await testPrisma.deliveryExecutionEvent.count({ where: { jobId: f.jobs[0].id } }), 0, "tidak ada event yatim");
  assert.equal((await testPrisma.job.findUnique({ where: { id: f.jobs[0].id } })).status, "ASSIGNED");
  await jobPost(f, 0, "start", {}, "tl-js-0003");
  assert.equal((await testPrisma.job.findUnique({ where: { id: f.jobs[0].id } })).status, "EN_ROUTE");
  assert.equal(await testPrisma.deliveryExecutionEvent.count({ where: { jobId: f.jobs[0].id, action: "JOB_STARTED" } }), 1);
});

test("offline: waktu kejadian dari antrean dipertahankan + label sinkron terlambat; jam perangkat janggal ditandai & tidak dipakai untuk durasi", async () => {
  const f = await fixture({ jobs: 1 });
  await routeStart(f, "tl-rs-0004");
  await jobPost(f, 0, "start", {}, "tl-js-0004", { "X-Event-Occurred-At": ago(50), "X-Action-Source": "DRIVER_APP" });
  await jobPost(f, 0, "arrive", { location: null }, "tl-ja-0004", { "X-Event-Occurred-At": ago(20), "X-Action-Source": "DRIVER_APP" });
  const [, started, arrived] = await events(f.route.id);
  assert.equal(started.timeQuality, "SINKRON_TERLAMBAT"); assert.equal(arrived.timeQuality, "SINKRON_TERLAMBAT");
  assert.ok(Math.abs(started.occurredAt.getTime() - (Date.now() - 50 * 60000)) < 5000, "waktu kejadian = waktu dari antrean, bukan waktu server");
  assert.ok(started.createdAt.getTime() - started.occurredAt.getTime() > 40 * 60000, "waktu diterima server tersimpan terpisah");
  let tl = (await f.driver.api.get(`/api/armada/routes/${f.route.id}/timeline`)).body;
  assert.equal(tl.stops[0].events[0].lateSync, true); assert.match(tl.stops[0].events[0].flags.join(" "), /terlambat/);
  assert.equal(tl.stops[0].travelDurationText, "30 menit");

  const f2 = await fixture({ jobs: 1 });
  await routeStart(f2, "tl-rs-0005");
  await jobPost(f2, 0, "start", {}, "tl-js-0005", { "X-Event-Occurred-At": new Date(Date.now() + 3 * 3600_000).toISOString(), "X-Action-Source": "DRIVER_APP" });
  await jobPost(f2, 0, "arrive", { location: null }, "tl-ja-0005", { "X-Event-Occurred-At": "bukan-tanggal", "X-Action-Source": "DRIVER_APP" });
  const odd = await events(f2.route.id);
  assert.equal(odd[1].timeQuality, "JAM_PERANGKAT_MASA_DEPAN"); assert.equal(odd[2].timeQuality, "JAM_PERANGKAT_TIDAK_VALID");
  tl = (await f2.driver.api.get(`/api/armada/routes/${f2.route.id}/timeline`)).body;
  assert.ok(tl.stops[0].events.every((e) => e.suspect)); assert.equal(tl.stops[0].travelDurationText, null);
  assert.equal(await testPrisma.job.count({ where: { routeId: f2.route.id, status: "ARRIVED" } }), 1, "jam janggal tidak memblokir transisi");
});

test("klien lama tanpa header: sumber KLIEN_LAMA, waktu server; gagal + reschedule tercatat; stop lain tetap berjalan", async () => {
  const f = await fixture({ jobs: 2 });
  await routeStart(f, "tl-rs-0006");
  await jobPost(f, 1, "start", {}, "tl-js-0006");
  const fail = await jobPost(f, 1, "fail", { failureReason: "Customer minta reschedule", failurePhotoUrls: ["/media/job-photos/gagal.jpg"], location: null }, "tl-jf-0006");
  assert.equal(fail.status, 200, JSON.stringify(fail.body));
  const e = (await events(f.route.id)).find((x) => x.action === "JOB_FAILED");
  assert.equal(e.source, "KLIEN_LAMA"); assert.equal(e.timeQuality, "WAKTU_SERVER");
  assert.equal(e.payload.rescheduleRequested, true);
  const next = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const re = await f.dispatcher.api.post(`/api/armada/issues/${f.jobs[1].id}/reschedule`, { scheduledDate: next, reason: "Customer minta hari lain", customerConfirmed: true }, key("resched"));
  if (re.status === 200 || re.status === 201) {
    const ev = await testPrisma.deliveryExecutionEvent.findMany({ where: { jobId: f.jobs[1].id, action: "JOB_RESCHEDULED" } });
    assert.equal(ev.length, 1, "reschedule = event permanen di ledger yang sama");
    assert.equal(ev[0].actorId, f.dispatcher.user.id);
    const tl = (await f.dispatcher.api.get(`/api/armada/routes/${f.route.id}/timeline`)).body;
    const stop = tl.stops.find((s) => s.jobId === f.jobs[1].id);
    assert.ok(stop.events.some((x) => x.label === "Dijadwalkan ulang"), "job yang dilepas dari rute tetap punya riwayat");
  } else assert.fail(`reschedule gagal: ${re.status} ${JSON.stringify(re.body)}`);
});

test("reschedule: retry (Idempotency-Key sama) TIDAK menggandakan JobIssueLog/RescheduleCase/event; replay walau status job sudah berubah (rekonsiliasi gate review, 7 Okt 2026)", async () => {
  // Temuan audit: idempotencyKey event SEBELUMNYA diturunkan dari issueLog.id
  // yang baru dibuat DI DALAM request itu sendiri — tidak pernah sama dua
  // kali, jadi retry membuat baris baru lagi. Diperbaiki: key stabil dari
  // klien, dicek lewat findExecutionReplay SEBELUM mutasi (bukan sesudah
  // cek status — job sudah tidak FAILED lagi persis setelah sukses pertama).
  const f = await fixture({ jobs: 1 });
  await routeStart(f, "tl-rs-resch-retry");
  await jobPost(f, 0, "start", {}, "tl-js-resch-retry");
  await jobPost(f, 0, "fail", { failureReason: "Alamat tidak ditemukan", failurePhotoUrls: ["/media/job-photos/g.jpg"], location: null }, "tl-jf-resch-retry");
  assert.equal((await testPrisma.job.findUnique({ where: { id: f.jobs[0].id } })).status, "FAILED");

  const next = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const body = { scheduledDate: next, reason: "Dijadwalkan ulang oleh dispatcher", customerConfirmed: true };
  const rescheduleKey = keyed("tl-resch-retry");

  const pertama = await f.dispatcher.api.post(`/api/armada/issues/${f.jobs[0].id}/reschedule`, body, rescheduleKey);
  assert.equal(pertama.status, 200, JSON.stringify(pertama.body));
  assert.notEqual((await testPrisma.job.findUnique({ where: { id: f.jobs[0].id } })).status, "FAILED", "job sudah tidak FAILED setelah sukses pertama (tanpa driverId -> deriveStatus SCHEDULED, bukan ASSIGNED)");

  // Retry PERSIS sama (Idempotency-Key sama) — job SEKARANG sudah bukan
  // FAILED lagi. Sebelum perbaikan, guard status (dicek sebelum replay)
  // salah menolak ini dengan "Hanya job berstatus Gagal...".
  const kedua = await f.dispatcher.api.post(`/api/armada/issues/${f.jobs[0].id}/reschedule`, body, rescheduleKey);
  assert.equal(kedua.status, 200, JSON.stringify(kedua.body));
  assert.equal(kedua.headers.get("idempotency-replayed"), "true");

  assert.equal(await testPrisma.jobIssueLog.count({ where: { jobId: f.jobs[0].id, type: "RESCHEDULED" } }), 1, "retry tidak boleh menggandakan JobIssueLog");
  assert.equal(await testPrisma.rescheduleCase.count({ where: { jobId: f.jobs[0].id } }), 1, "retry tidak boleh menggandakan RescheduleCase");
  assert.equal(await testPrisma.deliveryExecutionEvent.count({ where: { jobId: f.jobs[0].id, action: "JOB_RESCHEDULED" } }), 1, "retry tidak boleh menggandakan event di ledger");
});

test("histori lama tanpa event: 'Tidak tersedia', tanpa durasi, tanpa mengarang waktu (tidak ada backfill)", async () => {
  const f = await fixture({ jobs: 1 });
  await testPrisma.job.update({ where: { id: f.jobs[0].id }, data: { status: "COMPLETED" } }); // status terlanjur selesai, tanpa jejak waktu sama sekali
  await testPrisma.route.update({ where: { id: f.route.id }, data: { status: "COMPLETED" } });
  const tl = (await f.dispatcher.api.get(`/api/armada/routes/${f.route.id}/timeline`)).body;
  assert.deepEqual(tl.stops[0].missing.map((m) => m.atText), ["Tidak tersedia", "Tidak tersedia", "Tidak tersedia"]);
  assert.deepEqual(tl.routeMissing.map((m) => m.atText), ["Tidak tersedia", "Tidak tersedia"]);
  assert.equal(tl.stops[0].travelDurationText, null); assert.equal(tl.stops[0].serviceDurationText, null); assert.equal(tl.routeDurationText, null);
  assert.equal(await testPrisma.deliveryExecutionEvent.count({ where: { routeId: f.route.id } }), 0, "membaca histori tidak menulis/backfill event");
});

test("koreksi append-only: butuh ROUTE_WRITE + alasan + waktu; event asli tidak berubah; idempoten; driver ditolak; hanya tonggak yang sudah punya event", async () => {
  const f = await fixture({ jobs: 1 });
  await routeStart(f, "tl-rs-0007"); await jobPost(f, 0, "start", {}, "tl-js-0007");
  const target = (await events(f.route.id)).find((e) => e.action === "JOB_STARTED");
  const before = JSON.stringify(target);
  const url = `/api/armada/routes/${f.route.id}/timeline/corrections`;
  const body = { eventId: target.id, correctedOccurredAt: ago(30), reason: "Driver lupa menekan Menuju Lokasi" };
  assert.equal((await f.driver.api.post(url, body, key("c-drv"))).status, 403, "driver tidak boleh mengoreksi");
  assert.equal((await f.dispatcher.api.post(url, { ...body, reason: "" }, key("c-r"))).status, 400);
  assert.equal((await f.dispatcher.api.post(url, { ...body, correctedOccurredAt: new Date(Date.now() + 86400000).toISOString() }, key("c-f"))).status, 400);
  assert.equal((await f.dispatcher.api.post(url, { ...body, eventId: "00000000-0000-4000-8000-000000000000" }, key("c-x"))).status, 404);
  const k = key("c-ok");
  const ok = await f.dispatcher.api.post(url, body, k);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await f.dispatcher.api.post(url, body, k)).headers.get("idempotency-replayed"), "true");
  assert.equal(await testPrisma.deliveryExecutionEvent.count({ where: { action: "TIME_CORRECTED" } }), 1, "retry tidak menggandakan koreksi");
  assert.equal(JSON.stringify(await testPrisma.deliveryExecutionEvent.findUnique({ where: { id: target.id } })), before, "event asli TIDAK diubah");
  const corr = await testPrisma.deliveryExecutionEvent.findFirst({ where: { action: "TIME_CORRECTED" } });
  assert.equal(corr.actorId, f.dispatcher.user.id); assert.equal(corr.payload.reason, "Driver lupa menekan Menuju Lokasi"); assert.equal(corr.payload.targetEventId, target.id);
  const tl = (await f.dispatcher.api.get(`/api/armada/routes/${f.route.id}/timeline`)).body;
  const e = tl.stops[0].events[0];
  assert.equal(e.effectiveSource, "KOREKSI"); assert.equal(e.corrections.length, 1); assert.equal(tl.canCorrect, true);
  assert.ok(Math.abs(new Date(e.at).getTime() - (Date.now() - 30 * 60000)) < 5000);
});

test("akses timeline: driver lain & tanpa login ditolak; crew rute dan dispatcher boleh", async () => {
  const f = await fixture({ jobs: 1 });
  const url = `/api/armada/routes/${f.route.id}/timeline`;
  assert.equal((await f.otherDriver.api.get(url)).status, 403);
  assert.equal((await fetch(`${server.baseUrl}${url}`)).status, 401);
  assert.equal((await f.driver.api.get(url)).status, 200);
  assert.equal((await f.dispatcher.api.get(url)).status, 200);
});

// ------------------------------------------------------------------ Foto checklist: tidak boleh bocor
async function jpeg(tone) { return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: tone % 256, g: 40, b: 50 } } }).jpeg().toBuffer(); }
async function uploadProof(f) {
  const item = await f.dispatcher.api.post(`/api/armada/routes/${f.route.id}/prep-checklist/items`, { title: "Kaki kasur", required: true, photoRequired: true });
  assert.equal(item.status, 201, JSON.stringify(item.body));
  const fd = new FormData(); fd.append("photo", new Blob([await jpeg(++seq)], { type: "image/jpeg" }), "p.jpg");
  const res = await fetch(`${server.baseUrl}/api/armada/routes/${f.route.id}/prep-checklist/items/${item.body.item.id}/proof`, { method: "POST", headers: { Authorization: `Bearer ${f.driver.token}`, "Idempotency-Key": `tl-proof-${seq}-abcdefgh` }, body: fd });
  const body = await res.json(); assert.equal(res.status, 201, JSON.stringify(body)); return body;
}

test("foto checklist TIDAK publik: tanpa login 401; driver lain 403; crew rute & dispatcher 200; tautan bertanda-tangan 200 tapi rusak/kedaluwarsa 403", async () => {
  const f = await fixture({ jobs: 1 });
  const proof = await uploadProof(f);
  assert.match(proof.photoUrl, /^\/media\/route-prep-proofs\/[0-9a-f-]{36}\.jpg\?exp=\d+&sig=[0-9a-f]+$/);
  const bare = proof.photoUrl.split("?")[0];
  const get = (path, headers = {}) => fetch(`${server.baseUrl}${path}`, { headers });
  assert.equal((await get(bare)).status, 401, "tanpa login & tanpa tanda tangan = ditolak");
  assert.equal((await get(bare, { Authorization: `Bearer ${f.otherDriver.token}` })).status, 403, "driver lain ditolak");
  const own = await get(bare, { Authorization: `Bearer ${f.driver.token}` }); assert.equal(own.status, 200); assert.equal(own.headers.get("content-type"), "image/jpeg");
  assert.equal((await get(bare, { Authorization: `Bearer ${f.dispatcher.token}` })).status, 200, "pengguna berwenang");
  assert.equal((await get(proof.photoUrl)).status, 200, "tautan bertanda-tangan (untuk <img>) sah");
  assert.equal((await get(proof.photoUrl.replace(/sig=[0-9a-f]{4}/, "sig=0000"))).status, 403, "tanda tangan rusak");
  assert.equal((await get(`${bare}?exp=1&sig=${"0".repeat(64)}`)).status, 403, "kedaluwarsa/palsu");
  assert.equal((await get(`/media/route-prep-proofs/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}.jpg`, { Authorization: `Bearer ${f.dispatcher.token}` })).status, 403, "berkas tak terdaftar sebagai bukti = ditolak, bukan 404 yang membocorkan keberadaan");
  assert.equal((await get("/media/route-prep-proofs/..%2f..%2f.env")).status, 404, "path traversal");
  // tidak ada salinan di direktori statis publik job-photos
  const { PREP_PROOF_DIR } = await import("../../src/routes/routePrepProofMedia.js");
  const nama = bare.split("/").pop();
  const jobPhotosDir = new URL("../../data/job-photos/", import.meta.url);
  assert.equal((await import("node:fs")).existsSync(new URL(nama, jobPhotosDir)), false, "tidak ada salinan di direktori statis publik job-photos");
  assert.equal((await import("node:fs")).existsSync(`${PREP_PROOF_DIR}/${nama}`), true, "berkas ada hanya di direktori terlindungi");
  // crew rute lain, mis. driver kedua yang bukan driver/helper rute ini, tetap ditolak walau punya JOB_OWN_READ
  const list = await f.driver.api.get(`/api/armada/routes/${f.route.id}/prep-checklist`);
  assert.match(list.body.items[0].bukti.photoUrl, /\?exp=\d+&sig=/, "daftar checklist mengeluarkan URL bertanda-tangan");
});
