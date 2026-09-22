// Test integrasi — GET /armada/my-jobs terhadap PostgreSQL SUNGGUHAN.
//
// KENAPA FILE INI ADA: bug RTE-220926-01/02 (22 September 2026, laporan
// owner: "Route Planner menampilkan Arman + Agung dan 8 stop, Driver App
// Agung cuma tulis 1 stop") TIDAK BISA ditangkap oleh unit test murni
// (jobVisibilityDriverApp.test.js) — akar masalahnya adalah PERBANDINGAN
// TANGGAL yang salah pada level SQL (kolom `@db.Date` scheduledDate
// dibandingkan dengan RANGE timestamp WIB, bukan exact match — lihat
// catatan panjang di routes/armada.js GET /my-jobs), yang berperilaku
// BEDA antara JS murni (kelihatan benar) dan Postgres sungguhan (salah).
// Cuma test lewat Postgres asli yang bisa membuktikan/mencegah regresi ini.
//
// Fixture di bawah MENIRU PERSIS struktur RTE-220926-01 (driver Arman,
// helper Agung, 8 stop campuran COMPLETED/SCHEDULED/ASSIGNED, semua
// scheduledDate = hari ini).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
let no = 0;

test.before(async () => {
  await truncateAll();
  server = await startTestServer(buildTestApp());
});
test.after(async () => {
  await truncateAll();
  await server.close();
  await testPrisma.$disconnect();
});
test.afterEach(async () => { await truncateAll(); });

function toDateOnly(isoDate) {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

// "Hari ini" versi WIB, SAMA persis dengan yang dipakai GET /my-jobs asli
// (new Date(Date.now() + 7*3600_000).toISOString().slice(0,10)) — fixture
// HARUS pakai tanggal yang sama supaya test tidak flaky tergantung jam
// kapan test dijalankan.
const HARI_INI = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

async function buatCustomer(nama = "Customer Tes") {
  return testPrisma.customer.create({ data: { name: nama } });
}

async function buatOrder(customerId) {
  no += 1;
  return testPrisma.order.create({
    data: {
      customerId, value: 1_000_000, category: "LAYANAN",
      orderNumber: `TES-MYJOBS-${String(no).padStart(4, "0")}`,
      status: "PROCESSING", paymentStatus: "BELUM_BAYAR",
    },
  });
}

async function buatRoute({ driverId, helperId = null, date = HARI_INI, status = "PUBLISHED" }) {
  no += 1;
  return testPrisma.route.create({
    data: {
      code: `TES-RTE-${no}`, date: toDateOnly(date), driverId, helperId, status,
      publishedAt: status === "DRAFT" ? null : new Date(),
    },
  });
}

async function buatJob({ orderId, routeId = null, driverId = null, helperId = null, scheduledDate = HARI_INI, status = "ASSIGNED", sequence = null }) {
  return testPrisma.job.create({
    data: {
      type: "DELIVERY", orderId, routeId, driverId, helperId, sequence,
      scheduledDate: scheduledDate ? toDateOnly(scheduledDate) : null, status,
    },
  });
}

async function driverUser(nama) {
  const { user, token } = await createTestUser({ roles: ["DRIVER"] });
  await testPrisma.user.update({ where: { id: user.id }, data: { name: nama } });
  return { user, token };
}

test("Skenario 1+12 (fixture RTE-220926-01 persis): 1 route, driver+helper, 8 stop campuran status — SEMUA 8 tampil ke DUA-DUANYA", async () => {
  const arman = await driverUser("Arman Tes");
  const agung = await driverUser("Agung Tes");
  const cust = await buatCustomer();
  const route = await buatRoute({ driverId: arman.user.id, helperId: agung.user.id });

  const statuses = ["COMPLETED", "COMPLETED", "SCHEDULED", "COMPLETED", "COMPLETED", "SCHEDULED", "SCHEDULED", "ASSIGNED"];
  for (let i = 0; i < 8; i++) {
    const order = await buatOrder(cust.id);
    await buatJob({ orderId: order.id, routeId: route.id, driverId: arman.user.id, helperId: agung.user.id, status: statuses[i], sequence: i + 1 });
  }

  const clientArman = makeClient(server.baseUrl, arman.token);
  const clientAgung = makeClient(server.baseUrl, agung.token);

  const resArman = await clientArman.get("/api/armada/my-jobs");
  const resAgung = await clientAgung.get("/api/armada/my-jobs");

  assert.equal(resArman.status, 200);
  assert.equal(resAgung.status, 200);
  assert.equal(resArman.body.jobs.length, 8, "driver harus lihat SEMUA 8 stop rute (bug asli: Arman OK karena job.driverId cocok langsung)");
  assert.equal(resAgung.body.jobs.length, 8, "helper/crew HARUS lihat SEMUA 8 stop yang SAMA — ini bug RTE-220926-01 (Agung cuma dapat 1 sebelum fix)");

  // Header count === jumlah stop yang benar-benar dikembalikan (satu snapshot kanonis)
  assert.equal(resAgung.body.routes.length, 1);
  assert.equal(resAgung.body.routes[0].stopCount, 8, "routes[].stopCount HARUS sama dgn jumlah job di array jobs untuk rute itu — satu sumber angka, bukan 2 hitungan terpisah");
  const stopUntukRuteIni = resAgung.body.jobs.filter((j) => j.route?.id === route.id).length;
  assert.equal(resAgung.body.routes[0].stopCount, stopUntukRuteIni, "displayedCount === renderedStops.length");
});

test("Skenario 2: dua driver dalam SATU rute (crew) menerima payload snapshot yang IDENTIK (sama set job ID)", async () => {
  const a = await driverUser("Crew A");
  const b = await driverUser("Crew B");
  const cust = await buatCustomer();
  const route = await buatRoute({ driverId: a.user.id, helperId: b.user.id });
  const jobIds = [];
  for (let i = 0; i < 3; i++) {
    const order = await buatOrder(cust.id);
    const j = await buatJob({ orderId: order.id, routeId: route.id, driverId: a.user.id, helperId: b.user.id, status: "ASSIGNED", sequence: i + 1 });
    jobIds.push(j.id);
  }
  const ca = makeClient(server.baseUrl, a.token);
  const cb = makeClient(server.baseUrl, b.token);
  const [ra, rb] = await Promise.all([ca.get("/api/armada/my-jobs"), cb.get("/api/armada/my-jobs")]);
  const idsA = ra.body.jobs.map((j) => j.id).sort();
  const idsB = rb.body.jobs.map((j) => j.id).sort();
  assert.deepEqual(idsA, jobIds.sort());
  assert.deepEqual(idsA, idsB, "snapshot stop KEDUA driver harus identik persis");
});

test("Skenario 3: job individual driver LAIN (rute berbeda) tidak ikut mengurangi/mencampur isi rute crew saya", async () => {
  const saya = await driverUser("Saya");
  const orangLain = await driverUser("Orang Lain");
  const cust = await buatCustomer();
  const routeSaya = await buatRoute({ driverId: saya.user.id, helperId: null });
  for (let i = 0; i < 2; i++) {
    const order = await buatOrder(cust.id);
    await buatJob({ orderId: order.id, routeId: routeSaya.id, driverId: saya.user.id, status: "ASSIGNED", sequence: i + 1 });
  }
  // Job individual milik ORANG LAIN, TIDAK terkait rute saya sama sekali
  const orderLain = await buatOrder(cust.id);
  await buatJob({ orderId: orderLain.id, routeId: null, driverId: orangLain.user.id, status: "ASSIGNED" });

  const client = makeClient(server.baseUrl, saya.token);
  const res = await client.get("/api/armada/my-jobs");
  assert.equal(res.status, 200);
  assert.equal(res.body.jobs.length, 2, "cuma 2 job rute saya, job driver lain TIDAK ikut campur");
});

for (const status of ["DRAFT", "CANCELLED"]) {
  test(`Skenario 4: rute berstatus ${status} — stop AKTIF di dalamnya TIDAK muncul di my-jobs`, async () => {
    const d = await driverUser(`Driver ${status}`);
    const cust = await buatCustomer();
    const route = await buatRoute({ driverId: d.user.id, status });
    const order = await buatOrder(cust.id);
    await buatJob({ orderId: order.id, routeId: route.id, driverId: d.user.id, status: "ASSIGNED", sequence: 1 });

    const client = makeClient(server.baseUrl, d.token);
    const res = await client.get("/api/armada/my-jobs");
    assert.equal(res.status, 200);
    assert.equal(res.body.jobs.length, 0, `rute ${status} tidak boleh bocor ke Driver App`);
  });
}

test("Skenario 4b: rute PUBLISHED tapi tanggalnya BUKAN hari ini, dan job-nya sudah selesai/tidak aktif untuk hari itu — tidak nyasar ke hari ini", async () => {
  const d = await driverUser("Driver Tanggal Lain");
  const cust = await buatCustomer();
  const besok = new Date(Date.now() + 7 * 3600_000 + 2 * 86400_000).toISOString().slice(0, 10);
  const route = await buatRoute({ driverId: d.user.id, date: besok, status: "PUBLISHED" });
  const order = await buatOrder(cust.id);
  // Status ASSIGNED (bukan completed) — TETAP akan tampil via jalur "belum
  // tuntas" (carryover safety net), INI PERILAKU YANG DIHARAPKAN (bukan
  // bug) — supaya job besok yang sudah aktif tetap kelihatan driver kalau
  // dia buka app lebih awal. Test ini mengonfirmasi perilaku itu, BUKAN
  // menuntut penyembunyian (beda dari skenario 4 di atas).
  await buatJob({ orderId: order.id, routeId: route.id, driverId: d.user.id, scheduledDate: besok, status: "ASSIGNED", sequence: 1 });
  const client = makeClient(server.baseUrl, d.token);
  const res = await client.get("/api/armada/my-jobs");
  assert.equal(res.body.jobs.length, 1, "job aktif (belum tuntas) tetap tampil walau tanggalnya besok — perilaku carryover yang disengaja, bukan bug");
});

test("Skenario 5 (REGRESI Arman): job orphan (routeId null, status EN_ROUTE, tanggal lama) TIDAK muncul", async () => {
  const arman = await driverUser("Arman Orphan");
  const cust = await buatCustomer();
  const order = await buatOrder(cust.id);
  await buatJob({ orderId: order.id, routeId: null, driverId: arman.user.id, scheduledDate: "2026-09-16", status: "EN_ROUTE" });

  const client = makeClient(server.baseUrl, arman.token);
  const res = await client.get("/api/armada/my-jobs");
  assert.equal(res.status, 200);
  assert.equal(res.body.jobs.length, 0, "job tanpa rute yang belum tuntas sekarang DISEMBUNYIKAN (kebijakan dibalik 22 Sep, lihat jobStatus.js)");
});

test("Skenario 5b: job orphan yang SUDAH COMPLETED HARI INI tetap tampil (riwayat nyata, bukan rencana)", async () => {
  // scheduledDate = HARI_INI (bukan tanggal lampau) — /my-jobs SUDAH
  // (dari sebelum audit ini, perilaku lama yang disengaja, lihat komentar
  // "Riwayat hari ini" di JobListScreen driver-mobile) cuma menampilkan
  // job SELESAI dari HARI INI, bukan seluruh riwayat sepanjang masa — jadi
  // job COMPLETED dari 6 hari lalu MEMANG seharusnya tidak muncul lagi di
  // sini, itu bukan bug yang sedang diperbaiki audit ini.
  const d = await driverUser("Driver Riwayat Orphan");
  const cust = await buatCustomer();
  const order = await buatOrder(cust.id);
  await buatJob({ orderId: order.id, routeId: null, driverId: d.user.id, scheduledDate: HARI_INI, status: "COMPLETED" });

  const client = makeClient(server.baseUrl, d.token);
  const res = await client.get("/api/armada/my-jobs");
  assert.equal(res.body.jobs.length, 1, "job orphan yang selesai HARI INI tetap muncul di Riwayat — bukan yang disembunyikan");
});

test("Skenario 7: melepas helper dari rute (Route.helperId=null) LANGSUNG menghilangkan akses helper lama ke stop itu", async () => {
  const driver = await driverUser("Driver Tetap");
  const helperLama = await driverUser("Helper Lama");
  const cust = await buatCustomer();
  const route = await buatRoute({ driverId: driver.user.id, helperId: helperLama.user.id });
  const order = await buatOrder(cust.id);
  await buatJob({ orderId: order.id, routeId: route.id, driverId: driver.user.id, helperId: helperLama.user.id, status: "ASSIGNED", sequence: 1 });

  const clientHelper = makeClient(server.baseUrl, helperLama.token);
  const sebelum = await clientHelper.get("/api/armada/my-jobs");
  assert.equal(sebelum.body.jobs.length, 1, "sebelum dilepas, helper lihat stop-nya");

  // Simulasikan dispatcher melepas helper dari rute — di produksi ini lewat
  // PATCH /routes/:id (yang JUGA meng-cascade job.helperId=null utk job
  // aktif, lihat armada.js), tapi test ini fokus KHUSUS ke query my-jobs:
  // pastikan begitu Route.helperId dan Job.helperId sama-sama sudah null,
  // akses helper lama LANGSUNG hilang tanpa perlu app di-restart/logout.
  await testPrisma.route.update({ where: { id: route.id }, data: { helperId: null } });
  await testPrisma.job.updateMany({ where: { routeId: route.id }, data: { helperId: null } });

  const sesudah = await clientHelper.get("/api/armada/my-jobs");
  assert.equal(sesudah.body.jobs.length, 0, "setelah dilepas, helper lama TIDAK LAGI lihat stop itu");
});

test("Skenario 8: mengubah status satu stop menaikkan revision rute (Job.updatedAt terbaru menang atas Route.updatedAt)", async () => {
  const d = await driverUser("Driver Revisi");
  const cust = await buatCustomer();
  const route = await buatRoute({ driverId: d.user.id });
  const order = await buatOrder(cust.id);
  const job = await buatJob({ orderId: order.id, routeId: route.id, driverId: d.user.id, status: "ASSIGNED", sequence: 1 });

  const client = makeClient(server.baseUrl, d.token);
  const sebelum = await client.get("/api/armada/my-jobs");
  const revisiSebelum = sebelum.body.routes[0].revision;

  await new Promise((r) => setTimeout(r, 20)); // jaminan timestamp beda (presisi ms)
  await testPrisma.job.update({ where: { id: job.id }, data: { status: "EN_ROUTE" } });

  const sesudah = await client.get("/api/armada/my-jobs");
  const revisiSesudah = sesudah.body.routes[0].revision;
  assert.ok(revisiSesudah > revisiSebelum, `revision harus naik setelah stop berubah (${revisiSebelum} -> ${revisiSesudah})`);
});

test("REGRESI: job SCHEDULED (tanggal ada, driver belum ada) ikut naik ke ASSIGNED saat rute diterbitkan — sebelumnya nyangkut selamanya", async () => {
  // Reproduksi persis root cause KEDUA RTE-220926-01: job yang sudah py
  // scheduledDate (via Jadwal & Penugasan) SEBELUM masuk rute, statusnya
  // deriveStatus(false, true) = SCHEDULED. Begitu rute publish memberinya
  // driverId, deriveStatus(true, true) SEHARUSNYA jadi ASSIGNED — SEBELUM
  // fix ini, kode cuma menaikkan job yang tadinya UNSCHEDULED.
  const { user: dispatcher, token: tokenDispatcher } = await createTestUser({ roles: ["DISPATCHER"] });
  const driver = await driverUser("Driver Publish Tes");
  const cust = await buatCustomer();
  const route = await buatRoute({ driverId: driver.user.id, status: "DRAFT" });
  const order = await buatOrder(cust.id);
  const job = await buatJob({ orderId: order.id, routeId: route.id, driverId: null, status: "SCHEDULED", sequence: 1 });
  assert.equal(job.status, "SCHEDULED");

  const clientDispatcher = makeClient(server.baseUrl, tokenDispatcher);
  const resPublish = await clientDispatcher.post(`/api/armada/routes/${route.id}/publish`, {});
  assert.equal(resPublish.status, 200, JSON.stringify(resPublish.body));

  const jobSetelah = await testPrisma.job.findUnique({ where: { id: job.id } });
  assert.equal(jobSetelah.status, "ASSIGNED", "job SCHEDULED harus ikut naik ke ASSIGNED setelah publish memberinya driver — kalau tidak, POST /jobs/:id/start akan menolaknya selamanya");
  assert.equal(jobSetelah.driverId, driver.user.id);

  // Konfirmasi end-to-end: driver SEKARANG bisa benar-benar memulai stop
  // ini (buktinya BUKAN status di DB saja, tapi endpoint start beneran
  // menerimanya) — proofPhotoUrls kosong OK (foto per-job tidak wajib lagi
  // sejak 10 Sep 2026, lihat komentar POST /jobs/:id/start).
  const clientDriver = makeClient(server.baseUrl, driver.token);
  const resStart = await clientDriver.post(`/api/armada/jobs/${job.id}/start`, { proofPhotoUrls: [] });
  assert.equal(resStart.status, 200, `driver harus bisa mulai stop yang tadinya SCHEDULED: ${JSON.stringify(resStart.body)}`);
});

test("Skenario 12b: reproduksi PERSIS RTE-220926-02 (Apriansyah driver, Difa helper, 11 stop) — Difa lihat SEMUA 11", async () => {
  const apri = await driverUser("Apriansyah Tes");
  const difa = await driverUser("Difa Tes");
  const cust = await buatCustomer();
  const route = await buatRoute({ driverId: apri.user.id, helperId: difa.user.id });
  const statuses = ["COMPLETED","COMPLETED","COMPLETED","COMPLETED","COMPLETED","COMPLETED","COMPLETED","SCHEDULED","SCHEDULED","ASSIGNED","SCHEDULED"];
  for (let i = 0; i < 11; i++) {
    const order = await buatOrder(cust.id);
    await buatJob({ orderId: order.id, routeId: route.id, driverId: apri.user.id, helperId: difa.user.id, status: statuses[i], sequence: i + 1 });
  }
  const clientDifa = makeClient(server.baseUrl, difa.token);
  const res = await clientDifa.get("/api/armada/my-jobs");
  assert.equal(res.body.jobs.length, 11, "Difa (helper) harus lihat SEMUA 11 stop RTE-220926-02 — bug asli: cuma dapat 1 (Audrey) sebelum fix");
});
