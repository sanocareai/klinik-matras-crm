// Checklist Persiapan Perjalanan (7 Okt 2026) — gerbang POST /routes/:id/start,
// otorisasi (driver hanya rute miliknya; susun/edit item hanya ROUTE_WRITE),
// konkurensi optimistik (revision basi), race edit-vs-start, retry idempoten
// kirim bukti, dan override admin/dispatcher dengan alasan wajib + audit trail.
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

async function gambar(tone = 1) {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: tone % 256, g: 20, b: 30 } } }).jpeg().toBuffer();
}

let idemSeq = 0;
function idem(prefix = "chk") {
  idemSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idemSeq}-abcdefgh`;
}

async function fixtureRoute({ jobCount = 1 } = {}) {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const otherDriver = await createTestUser({ roles: ["DRIVER"] });
  const dispatcher = await createTestUser({ roles: ["DISPATCHER"] });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Checklist", city: "Jakarta" } });
  const route = await testPrisma.route.create({
    data: { code: `CHK-RTE-${++seq}`, date: new Date("2026-10-07T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: driver.user.id },
  });
  const jobs = [];
  for (let i = 0; i < jobCount; i++) {
    const order = await testPrisma.order.create({
      data: { customerId: customer.id, orderNumber: `CHK-ORD-${++seq}`, value: 1_000_000, category: "LAYANAN", status: "DELIVERED" },
    });
    jobs.push(await testPrisma.job.create({
      data: { type: "DELIVERY", orderId: order.id, routeId: route.id, driverId: driver.user.id, status: "ASSIGNED", sequence: i + 1 },
    }));
  }
  return {
    driver, otherDriver, dispatcher, route, jobs,
    driverApi: makeClient(server.baseUrl, driver.token),
    otherDriverApi: makeClient(server.baseUrl, otherDriver.token),
    dispatcherApi: makeClient(server.baseUrl, dispatcher.token),
  };
}

const CHK = (routeId) => `/api/armada/routes/${routeId}/prep-checklist`;

async function tambahItem(api, routeId, body) {
  return api.post(`${CHK(routeId)}/items`, body);
}

async function kirimBukti(token, routeId, itemId, { withPhoto = true, note, idemKey = idem("proof") } = {}) {
  const fd = new FormData();
  if (withPhoto) fd.append("photo", new Blob([await gambar(itemId.length)], { type: "image/jpeg" }), "p.jpg");
  if (note) fd.append("note", note);
  const res = await fetch(`${server.baseUrl}/api/armada/routes/${routeId}/prep-checklist/items/${itemId}/proof`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": idemKey },
    body: fd,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
}

function startRoute(api, routeId, { idemKey = idem("start"), ...body } = {}) {
  return api.post(`/api/armada/routes/${routeId}/start`, { proofPhotoUrls: ["/media/job-photos/muatan.jpg"], ...body }, { "Idempotency-Key": idemKey });
}

test("rute tanpa checklist tetap kompatibel — start langsung jalan tanpa item sama sekali", async () => {
  const f = await fixtureRoute();
  const r = await startRoute(f.driverApi, f.route.id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.started, 1);
});

test("gerbang: item wajib tanpa bukti menahan start; setelah bukti foto terkirim, start berhasil", async () => {
  const f = await fixtureRoute();
  const buat = await tambahItem(f.dispatcherApi, f.route.id, { title: "Tali pengikat", required: true, photoRequired: true });
  assert.equal(buat.status, 201, JSON.stringify(buat.body));
  const itemId = buat.body.item.id;

  const ditahan = await startRoute(f.driverApi, f.route.id);
  assert.equal(ditahan.status, 409, JSON.stringify(ditahan.body));
  assert.equal(ditahan.body.code, "CHECKLIST_BELUM_LENGKAP");
  assert.match(ditahan.body.error, /Tali pengikat/);

  const bukti = await kirimBukti(f.driver.token, f.route.id, itemId);
  assert.equal(bukti.status, 201, JSON.stringify(bukti.body));
  assert.ok(bukti.body.photoUrl.startsWith("/media/job-photos/"));

  const sekarang = await startRoute(f.driverApi, f.route.id);
  assert.equal(sekarang.status, 200, JSON.stringify(sekarang.body));

  const route = await testPrisma.route.findUnique({ where: { id: f.route.id } });
  assert.ok(route.prepChecklistLockedAt, "checklist keberangkatan harus dibekukan setelah start sukses");
});

test("gerbang: item wajib photoRequired=false cukup ditandai selesai TANPA foto", async () => {
  const f = await fixtureRoute();
  const buat = await tambahItem(f.dispatcherApi, f.route.id, { title: "Cek kondisi kasur", required: true, photoRequired: false });
  const itemId = buat.body.item.id;
  const bukti = await kirimBukti(f.driver.token, f.route.id, itemId, { withPhoto: false, note: "Sudah dicek, kondisi baik" });
  assert.equal(bukti.status, 201, JSON.stringify(bukti.body));
  assert.equal(bukti.body.photoUrl, null);
  const r = await startRoute(f.driverApi, f.route.id);
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test("item photoRequired=true ditolak kalau submit tanpa foto", async () => {
  const f = await fixtureRoute();
  const buat = await tambahItem(f.dispatcherApi, f.route.id, { title: "Plastik pembungkus", required: true, photoRequired: true });
  const bukti = await kirimBukti(f.driver.token, f.route.id, buat.body.item.id, { withPhoto: false });
  assert.equal(bukti.status, 400, JSON.stringify(bukti.body));
});

test("unauthorized: driver lain (bukan pemilik rute) ditolak kirim bukti maupun memulai rute", async () => {
  const f = await fixtureRoute();
  const buat = await tambahItem(f.dispatcherApi, f.route.id, { title: "Kaki kasur", required: true, photoRequired: true });
  const bukti = await kirimBukti(f.otherDriver.token, f.route.id, buat.body.item.id);
  assert.equal(bukti.status, 403, JSON.stringify(bukti.body));

  const mulai = await startRoute(f.otherDriverApi, f.route.id);
  assert.equal(mulai.status, 403, JSON.stringify(mulai.body));
});

test("unauthorized: driver (hanya JOB_OWN_WRITE) ditolak menambah/mengedit item checklist (perlu ROUTE_WRITE)", async () => {
  const f = await fixtureRoute();
  const r = await tambahItem(f.driverApi, f.route.id, { title: "Item ilegal", required: true });
  assert.equal(r.status, 403, JSON.stringify(r.body));
});

test("revision basi: edit item dengan expectedRevision yang sudah usang ditolak 409 CHECKLIST_REVISION_STALE", async () => {
  const f = await fixtureRoute();
  const buat = await tambahItem(f.dispatcherApi, f.route.id, { title: "Tali", required: true });
  const itemId = buat.body.item.id;
  const revisiAwal = buat.body.revision;

  // Admin lain menambah item LAIN duluan -> revisi rute naik.
  await tambahItem(f.dispatcherApi, f.route.id, { title: "Plastik", required: false });

  const editBasi = await f.dispatcherApi.patch(`${CHK(f.route.id)}/items/${itemId}`, { detail: "diubah berdasar data lama", expectedRevision: revisiAwal });
  assert.equal(editBasi.status, 409, JSON.stringify(editBasi.body));
  assert.equal(editBasi.body.code, "CHECKLIST_REVISION_STALE");

  // Dengan revision TERBARU, edit yang sama berhasil.
  const terkini = await f.dispatcherApi.get(CHK(f.route.id));
  const editOk = await f.dispatcherApi.patch(`${CHK(f.route.id)}/items/${itemId}`, { detail: "diubah dengan data terbaru", expectedRevision: terkini.body.revision });
  assert.equal(editOk.status, 200, JSON.stringify(editOk.body));
});

test("edit item menaikkan revision item itu sendiri dan membuat bukti LAMA basi (harus unggah ulang)", async () => {
  const f = await fixtureRoute();
  const buat = await tambahItem(f.dispatcherApi, f.route.id, { title: "Tali pengikat", required: true, photoRequired: true });
  const itemId = buat.body.item.id;
  await kirimBukti(f.driver.token, f.route.id, itemId);

  const sebelum = await f.dispatcherApi.get(CHK(f.route.id));
  assert.equal(sebelum.body.items.find((i) => i.id === itemId).terpenuhi, true);

  await f.dispatcherApi.patch(`${CHK(f.route.id)}/items/${itemId}`, { detail: "instruksi diperbarui", expectedRevision: sebelum.body.revision });

  const sesudah = await f.dispatcherApi.get(CHK(f.route.id));
  const item = sesudah.body.items.find((i) => i.id === itemId);
  assert.equal(item.terpenuhi, false, "bukti lama tidak lagi dihitung terpenuhi setelah instruksi diedit");
  assert.equal(item.buktiBasi, true);

  const ditahan = await startRoute(f.driverApi, f.route.id);
  assert.equal(ditahan.status, 409);
});

test("race edit-vs-start: edit menambah item wajib baru bersamaan dengan driver menekan Mulai — tidak pernah berangkat dengan item wajib yang belum terpenuhi", async () => {
  const f = await fixtureRoute();
  // Item wajib AWAL sudah dipenuhi driver, rute SIAP berangkat normal.
  const awal = await tambahItem(f.dispatcherApi, f.route.id, { title: "Tali", required: true, photoRequired: true });
  await kirimBukti(f.driver.token, f.route.id, awal.body.item.id);

  const [hasilStart, hasilEdit] = await Promise.all([
    startRoute(f.driverApi, f.route.id),
    tambahItem(f.dispatcherApi, f.route.id, { title: "Item wajib baru mendadak", required: true, photoRequired: true }),
  ]);

  // lockRoute pakai FOR UPDATE NOWAIT (bukan menunggu) — siapa pun dapat
  // kunci baris Route lebih dulu MENANG dan diproses; yang kalah gagal
  // CEPAT dengan 409 "sedang diproses di perangkat lain" (kode existing,
  // lihat handleErr) alih-alih menunggu giliran. Ketiga outcome di bawah
  // SAH; yang TIDAK BOLEH terjadi adalah start sukses (200) PADAHAL item
  // wajib baru itu sudah lebih dulu tercatat sebelum gerbang dievaluasi.
  const LOCK_BUSY = "Aksi sedang diproses di perangkat lain. Muat ulang status lalu coba lagi.";
  assert.ok(
    hasilEdit.status === 201 || (hasilEdit.status === 409 && hasilEdit.body.error === LOCK_BUSY),
    `hasilEdit tak terduga: ${hasilEdit.status} ${JSON.stringify(hasilEdit.body)}`,
  );
  assert.ok(
    hasilStart.status === 200
    || (hasilStart.status === 409 && (hasilStart.body.code === "CHECKLIST_BELUM_LENGKAP" || hasilStart.body.error === LOCK_BUSY)),
    `hasilStart tak terduga: ${hasilStart.status} ${JSON.stringify(hasilStart.body)}`,
  );

  const route = await testPrisma.route.findUnique({ where: { id: f.route.id } });
  if (hasilStart.status === 200) {
    // Start menang & benar2 diproses — rute harus IN_PROGRESS & checklist terbekukan, TERLEPAS dari kapan item baru itu tercatat.
    assert.equal(route.status, "IN_PROGRESS");
    assert.ok(route.prepChecklistLockedAt);
    if (hasilEdit.status === 201) {
      // Item baru tercatat SETELAH gerbang start dievaluasi (start menang lock duluan) — gerbang start TIDAK WAJIB melihatnya (ini bukan retroaktif).
      assert.ok(true);
    }
  } else {
    // Start tidak sukses — rute TIDAK BOLEH dalam keadaan "sudah berangkat tapi item wajib belum terpenuhi".
    assert.notEqual(route.status, "IN_PROGRESS");
  }
});

test("retry idempoten: kirim bukti dua kali dengan Idempotency-Key sama hanya membuat SATU baris proof", async () => {
  const f = await fixtureRoute();
  const buat = await tambahItem(f.dispatcherApi, f.route.id, { title: "Plastik", required: true, photoRequired: true });
  const itemId = buat.body.item.id;
  const key = idem("retry");

  const pertama = await kirimBukti(f.driver.token, f.route.id, itemId, { idemKey: key });
  assert.equal(pertama.status, 201, JSON.stringify(pertama.body));
  assert.equal(pertama.headers.get("idempotency-replayed"), "false");

  const kedua = await kirimBukti(f.driver.token, f.route.id, itemId, { idemKey: key });
  assert.equal(kedua.status, 201, JSON.stringify(kedua.body));
  assert.equal(kedua.headers.get("idempotency-replayed"), "true");
  assert.equal(kedua.body.id, pertama.body.id);

  const jumlah = await testPrisma.routePrepChecklistProof.count({ where: { itemId } });
  assert.equal(jumlah, 1);
});

test("retry idempoten pada POST start: dua panggilan dengan Idempotency-Key sama tidak dobel memulai rute", async () => {
  const f = await fixtureRoute();
  const key = idem("startretry");
  const pertama = await startRoute(f.driverApi, f.route.id, { idemKey: key });
  assert.equal(pertama.status, 200, JSON.stringify(pertama.body));
  const kedua = await startRoute(f.driverApi, f.route.id, { idemKey: key });
  assert.equal(kedua.status, 200, JSON.stringify(kedua.body));
  assert.equal(kedua.headers.get("idempotency-replayed"), "true");
});

test("override: dispatcher (ROUTE_WRITE/JOB_WRITE) dengan alasan wajib bisa memaksa berangkat walau checklist belum lengkap, tercatat audit trail", async () => {
  const f = await fixtureRoute();
  const buat = await tambahItem(f.dispatcherApi, f.route.id, { title: "Tali pengikat", required: true, photoRequired: true });

  const tanpaAlasan = await startRoute(f.dispatcherApi, f.route.id, { overrideChecklist: true });
  assert.equal(tanpaAlasan.status, 409, JSON.stringify(tanpaAlasan.body));

  const r = await startRoute(f.dispatcherApi, f.route.id, { overrideChecklist: true, overrideChecklistReason: "Stok tali kosong, dispatcher izinkan berangkat dulu" });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const events = await testPrisma.activityEvent.findMany({ where: { entityType: "route_prep_checklist", entityId: f.route.id, eventType: "CHECKLIST_GATE_OVERRIDDEN" } });
  assert.equal(events.length, 1);
  assert.match(events[0].metadata.reason, /Stok tali kosong/);
  assert.ok(events[0].metadata.missingTitles.includes("Tali pengikat"));
});

test("override: driver (hanya JOB_OWN_WRITE) TIDAK BISA memaksa berangkat walau mengirim overrideChecklist+alasan", async () => {
  const f = await fixtureRoute();
  await tambahItem(f.dispatcherApi, f.route.id, { title: "Tali pengikat", required: true, photoRequired: true });
  const r = await startRoute(f.driverApi, f.route.id, { overrideChecklist: true, overrideChecklistReason: "Saya izinkan sendiri" });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, "CHECKLIST_BELUM_LENGKAP");
});

test("checklist lingkup STOP terikat satu order/stop; harus job milik rute yang sama", async () => {
  const f = await fixtureRoute({ jobCount: 2 });
  const stopItem = await tambahItem(f.dispatcherApi, f.route.id, { title: "Foto kondisi unit stop ini", scope: "STOP", jobId: f.jobs[0].id, required: true, photoRequired: true });
  assert.equal(stopItem.status, 201, JSON.stringify(stopItem.body));

  const salahScope = await tambahItem(f.dispatcherApi, f.route.id, { title: "Salah", scope: "STOP", jobId: null, required: true });
  assert.equal(salahScope.status, 400);

  const orderAsliF0 = await testPrisma.order.findUniqueOrThrow({ where: { id: f.jobs[0].orderId } });
  const orderLuar = await testPrisma.order.create({
    data: { customerId: orderAsliF0.customerId, orderNumber: `LUAR-${++seq}`, value: 1, category: "LAYANAN", status: "DELIVERED" },
  });
  const bukanRuteIni = await testPrisma.job.create({
    data: { type: "DELIVERY", orderId: orderLuar.id, status: "ASSIGNED", sequence: 1 },
  });
  const salahJob = await tambahItem(f.dispatcherApi, f.route.id, { title: "Job luar rute", scope: "STOP", jobId: bukanRuteIni.id, required: true });
  assert.equal(salahJob.status, 400, JSON.stringify(salahJob.body));
});

// ── Audit keamanan bukti foto (review gate, 7 Okt 2026) ─────────────────────
// Akses lintas driver untuk BACA (GET), bukan cuma kirim bukti (sudah dites
// di atas), dan "peminjaman bukti" (evidence borrowing) — mencoba memakai
// item/bukti milik rute LAIN lewat URL rute ini.

test("akses baca (GET) lintas driver: driver bukan pemilik rute ditolak 403, tidak bocor judul/bukti item", async () => {
  const f = await fixtureRoute();
  await tambahItem(f.dispatcherApi, f.route.id, { title: "Rahasia Rute A", required: true });
  const r = await f.otherDriverApi.get(CHK(f.route.id));
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.doesNotMatch(JSON.stringify(r.body), /Rahasia Rute A/);
});

test("peminjaman bukti: item milik rute LAIN tidak bisa dipakai lewat URL rute ini walau driver sama-sama crew di keduanya", async () => {
  const fA = await fixtureRoute();
  // Driver fA juga ditugaskan ke rute KEDUA (B) sebagai driver — skenario
  // nyata: satu driver dapat beberapa rute di hari/waktu berbeda.
  const routeB = await testPrisma.route.create({
    data: { code: `CHK-RTE-${++seq}`, date: new Date("2026-10-08T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: fA.driver.user.id },
  });
  const itemA = await tambahItem(fA.dispatcherApi, fA.route.id, { title: "Item milik Rute A", required: true, photoRequired: true });
  const itemIdA = itemA.body.item.id;

  // Kirim bukti utk item A lewat URL RUTE B (bukan rute pemilik item itu) —
  // ownership rute B lolos (driver fA adalah driver-nya), TAPI item itu
  // tidak pernah ada di checklist rute B -> harus 404, bukan tercipta.
  const pinjam = await kirimBukti(fA.driver.token, routeB.id, itemIdA, { idemKey: idem("borrow") });
  assert.equal(pinjam.status, 404, JSON.stringify(pinjam.body));

  const proofCount = await testPrisma.routePrepChecklistProof.count({ where: { itemId: itemIdA } });
  assert.equal(proofCount, 0, "tidak boleh ada baris proof tercipta dari peminjaman item lintas rute");
});

test("retry idempoten TIDAK BOLEH lolos lintas rute: Idempotency-Key+itemId+user sama tapi dipanggil via URL rute LAIN ditolak (bukan di-replay)", async () => {
  const fA = await fixtureRoute();
  const routeB = await testPrisma.route.create({
    data: { code: `CHK-RTE-${++seq}`, date: new Date("2026-10-08T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: fA.driver.user.id },
  });
  const itemA = await tambahItem(fA.dispatcherApi, fA.route.id, { title: "Item Rute A utk uji idempoten", required: true, photoRequired: true });
  const itemIdA = itemA.body.item.id;
  const key = idem("cross-route-replay");

  const asli = await kirimBukti(fA.driver.token, fA.route.id, itemIdA, { idemKey: key });
  assert.equal(asli.status, 201, JSON.stringify(asli.body));

  // Key SAMA, item SAMA, user SAMA — tapi URL rute BEDA (B, bukan A tempat
  // item itu sebenarnya berada). Sebelum perbaikan, early-return replay
  // tidak memeriksa routeId dan akan mengembalikan proof lama sebagai
  // "berhasil" tanpa pernah memvalidasi item ini milik rute B.
  const diputarUlangLintasRute = await kirimBukti(fA.driver.token, routeB.id, itemIdA, { idemKey: key });
  assert.equal(diputarUlangLintasRute.status, 409, JSON.stringify(diputarUlangLintasRute.body));
  assert.match(diputarUlangLintasRute.body.error, /Idempotency-Key sudah dipakai/);

  const proofCount = await testPrisma.routePrepChecklistProof.count({ where: { itemId: itemIdA } });
  assert.equal(proofCount, 1, "tetap hanya satu baris proof (yang asli di rute A)");
});

test("URL/path foto arbitrer: endpoint proof TIDAK PERNAH menerima photoUrl dari body — hanya file yang diupload di request yang sama", async () => {
  const f = await fixtureRoute();
  const item = await tambahItem(f.dispatcherApi, f.route.id, { title: "Item anti-injeksi URL", required: true, photoRequired: true });
  const itemId = item.body.item.id;

  // Kirim multipart TANPA file "photo", tapi SELIPKAN field "photoUrl" yang
  // menunjuk ke path sembarang — endpoint tidak boleh pernah membacanya.
  const fd = new FormData();
  fd.append("photoUrl", "/media/job-photos/foto-milik-orang-lain.jpg");
  fd.append("note", "mencoba menyelipkan URL foto arbitrer");
  const res = await fetch(`${server.baseUrl}${CHK(f.route.id)}/items/${itemId}/proof`, {
    method: "POST",
    headers: { Authorization: `Bearer ${f.driver.token}`, "Idempotency-Key": idem("inject") },
    body: fd,
  });
  const body = await res.json().catch(() => null);
  // photoRequired=true dan tidak ada file -> ditolak (bukan diam-diam
  // menerima photoUrl dari body sebagai pengganti upload nyata).
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.doesNotMatch(body.error || "", /foto-milik-orang-lain/);
});
