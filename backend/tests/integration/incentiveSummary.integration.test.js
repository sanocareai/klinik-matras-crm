// Audit + hardening insentif driver (23 September 2026) — test real-Postgres
// untuk GET /armada/incentive-summary dan PATCH /armada/pod/:jobId/edit.
// Menutup gap yang ditemukan audit read-only sebelumnya: bug boundary WIB
// (job selesai dini hari di awal periode hilang diam-diam), redelivery
// ComplaintCase dihitung ganda, order dibatalkan tetap dihitung, dan nol
// audit trail untuk koreksi POD yang mengubah angka insentif periode
// lampau. Lihat catatan panjang di backend/src/routes/armada.js.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
let seq = 0;

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function buatOrder(customerId) {
  return testPrisma.order.create({
    data: { customerId, orderNumber: `INS-ORDER-${++seq}`, value: 1000, category: "LAYANAN" },
  });
}

async function buatJob({ orderId, driverId = null, helperId = null, type = "DELIVERY", status = "COMPLETED", completedAt, complaintCaseId = null }) {
  return testPrisma.job.create({
    data: {
      type, orderId, driverId, helperId, status, sequence: 1,
      completedAt: completedAt ? new Date(completedAt) : null,
      complaintCaseId,
      addressText: "Alamat tes insentif",
    },
  });
}

async function fixtureDasar() {
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const driver = await createTestUser({ roles: ["DRIVER"] });
  await testPrisma.user.update({ where: { id: driver.user.id }, data: { hasSim: true } });
  const helper = await createTestUser({ roles: ["DRIVER"] });
  await testPrisma.user.update({ where: { id: helper.user.id }, data: { hasSim: false } });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Insentif", city: "Jakarta" } });
  return {
    admin: { ...admin, api: makeClient(server.baseUrl, admin.token) },
    driver: { ...driver, api: makeClient(server.baseUrl, driver.token) },
    helper: { ...helper, api: makeClient(server.baseUrl, helper.token) },
    customer,
  };
}

test("boundary WIB: job selesai 03:00 WIB di tanggal AWAL periode tetap terhitung (bug lama: hilang diam-diam)", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  // 2026-08-31T20:00:00.000Z = 2026-09-01 03:00 WIB — secara bisnis
  // selesai TANGGAL 1 September WIB, harus ikut query from=2026-09-01.
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-08-31T20:00:00.000Z" });

  const res = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-01");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const baris = res.body.orang.find((o) => o.id === f.driver.user.id);
  assert.ok(baris, "driver harus muncul — job jam 03:00 WIB tidak boleh hilang");
  assert.equal(baris.totalAlamat, 1);
});

test("pickup+delivery order sama, tanggal WIB sama = 1 alamat", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, type: "PICKUP", completedAt: "2026-09-05T02:00:00.000Z" });
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, type: "DELIVERY", completedAt: "2026-09-05T08:00:00.000Z" });

  const res = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-05&to=2026-09-05");
  const baris = res.body.orang.find((o) => o.id === f.driver.user.id);
  assert.equal(baris.totalAlamat, 1, "pickup+delivery order sama, hari sama, harus digabung jadi 1");
  assert.deepEqual(new Set(baris.detail[0].types), new Set(["PICKUP", "DELIVERY"]));
});

test("order sama, tanggal WIB BERBEDA = 2 alamat (aturan existing, bukan diubah)", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, type: "PICKUP", completedAt: "2026-09-05T02:00:00.000Z" });
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, type: "DELIVERY", completedAt: "2026-09-07T08:00:00.000Z" });

  const res = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-10");
  const baris = res.body.orang.find((o) => o.id === f.driver.user.id);
  assert.equal(baris.totalAlamat, 2, "produksi makan waktu di antaranya — TETAP 2 alamat, bukan digabung");
});

test("driver dan helper di job yang sama masing-masing dapat nilai PENUH (bukan dibagi)", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, helperId: f.helper.user.id, completedAt: "2026-09-05T02:00:00.000Z" });

  const res = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-10");
  const driverBaris = res.body.orang.find((o) => o.id === f.driver.user.id);
  const helperBaris = res.body.orang.find((o) => o.id === f.helper.user.id);
  assert.equal(driverBaris.asDriver, 1);
  assert.equal(driverBaris.totalAlamat, 1);
  assert.equal(driverBaris.totalInsentif, 7000, "driver hasSim=true -> Rp7.000 PENUH, bukan dibagi 2");
  assert.equal(helperBaris.asHelper, 1);
  assert.equal(helperBaris.totalAlamat, 1);
  assert.equal(helperBaris.totalInsentif, 3000, "helper hasSim=false -> Rp3.000 PENUH, bukan dibagi 2");
});

test("perubahan hasSim mengubah estimasi periode LAMA (live recompute dipertahankan, bukan dikunci)", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });

  const sebelum = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-10");
  const baris1 = sebelum.body.orang.find((o) => o.id === f.driver.user.id);
  assert.equal(baris1.totalInsentif, 7000);

  await testPrisma.user.update({ where: { id: f.driver.user.id }, data: { hasSim: false } });
  const sesudah = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-10");
  const baris2 = sesudah.body.orang.find((o) => o.id === f.driver.user.id);
  assert.equal(baris2.totalInsentif, 3000, "SENGAJA berubah — live recompute dipertahankan sesuai instruksi, bukan snapshot/ledger");
});

test("job FAILED dan RESCHEDULED tidak dihitung", async () => {
  const f = await fixtureDasar();
  const orderA = await buatOrder(f.customer.id);
  const orderB = await buatOrder(f.customer.id);
  await buatJob({ orderId: orderA.id, driverId: f.driver.user.id, status: "FAILED", completedAt: "2026-09-05T02:00:00.000Z" });
  await buatJob({ orderId: orderB.id, driverId: f.driver.user.id, status: "RESCHEDULED", completedAt: "2026-09-05T02:00:00.000Z" });

  const res = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-10");
  const baris = res.body.orang.find((o) => o.id === f.driver.user.id);
  assert.ok(!baris, "tidak ada job COMPLETED sama sekali — driver tidak boleh muncul di daftar");
});

test("redelivery dari ComplaintCase tidak dihitung ulang", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  // Job pertama (bukan komplain) — order sama, tanggal beda dari redelivery.
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-01T02:00:00.000Z" });
  const kasus = await testPrisma.complaintCase.create({
    data: { caseNumber: `CMP-TEST-${++seq}`, orderId: order.id, category: "KUALITAS_PRODUK", description: "Kain tidak sesuai" },
  });
  // Redelivery — orderId SAMA, tanggal BEDA, complaintCaseId TERISI.
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-10T02:00:00.000Z", complaintCaseId: kasus.id });

  const res = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-15");
  const baris = res.body.orang.find((o) => o.id === f.driver.user.id);
  assert.equal(baris.totalAlamat, 1, "redelivery komplain TIDAK menambah alamat baru");
});

test("order berstatus CANCELLED tidak dihitung walau job-nya COMPLETED", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  await testPrisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });

  const res = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-10");
  const baris = res.body.orang.find((o) => o.id === f.driver.user.id);
  assert.ok(!baris, "order dibatalkan setelah selesai — driver tidak boleh dapat kredit alamat ini");
});

test("freelance dan kurir eksternal tidak dihitung (regression — sudah benar sebelumnya, dipin di sini)", async () => {
  const f = await fixtureDasar();
  await testPrisma.user.update({ where: { id: f.driver.user.id }, data: { isFreelance: true } });
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });

  const res = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-10");
  const baris = res.body.orang.find((o) => o.id === f.driver.user.id);
  assert.ok(!baris, "isFreelance=true — tidak boleh muncul di daftar insentif");
});

test("driver tanpa JOB_READ (JOB_OWN_READ saja) cuma lihat barisnya sendiri — tidak bocor ke driver lain", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  await buatJob({ orderId: await buatOrder(f.customer.id).then((o) => o.id), driverId: f.helper.user.id, completedAt: "2026-09-05T02:00:00.000Z" });

  const res = await f.driver.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-10");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.orang.length, 1);
  assert.equal(res.body.orang[0].id, f.driver.user.id);
});

test("PATCH /pod/:jobId/edit mengubah driver mencatat ActivityEvent dengan nilai lama dan baru", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  const job = await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });

  const res = await f.admin.api.patch(`/api/armada/pod/${job.id}/edit`, {
    reason: "Driver salah dipilih saat input manual",
    driverId: f.helper.user.id,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const events = await testPrisma.activityEvent.findMany({ where: { entityType: "job", entityId: job.id, eventType: "POD_EDITED" } });
  assert.equal(events.length, 1, "harus tercatat TEPAT 1 ActivityEvent untuk 1 kali koreksi");
  assert.equal(events[0].metadata.changes.driverId.from, f.driver.user.id);
  assert.equal(events[0].metadata.changes.driverId.to, f.helper.user.id);
  assert.equal(events[0].metadata.reason, "Driver salah dipilih saat input manual");
});

// ── UnitRevision ("Lapor Revisi") — hardening 24 September 2026 ────────────
// Job pickup/delivery UnitRevision tidak dibuat lewat endpoint penuh di sini
// (POST /revisions/:id/create-pickup-job dkk butuh banyak setup produksi yang
// tidak relevan buat tes ini) — fixture langsung menulis baris UnitRevision +
// UnitRevisionJobLink, meniru HASIL AKHIR endpoint itu (jobId terisi DAN
// baris riwayat provenance tertulis, persis yang dilakukan ketiga endpoint
// pembuat job revisi di transaksi mereka — lihat
// unitRevisionJobLink.integration.test.js untuk pembuktian lewat endpoint
// SUNGGUHAN). Pola sama dengan fixture ComplaintCase di atas.
async function buatUnitRevisionUntukJob({ orderId, jobId, status = "IN_REWORK", role = "PICKUP" }) {
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-TEST-${++seq}`, orderId, seq: 1 } });
  const revision = await testPrisma.unitRevision.create({
    data: { unitId: unit.id, trigger: "KENYAMANAN", complaint: "Kasur kurang empuk", status, jobId },
  });
  await testPrisma.unitRevisionJobLink.create({ data: { unitRevisionId: revision.id, jobId, role } });
  return revision;
}

test("UnitRevision PICKUP tidak dihitung", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  // Job pengiriman pertama (sah) — order sama, tanggal BEDA dari job revisi.
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-01T02:00:00.000Z" });
  const jobPickupRevisi = await buatJob({ orderId: order.id, driverId: f.driver.user.id, type: "PICKUP", completedAt: "2026-09-10T02:00:00.000Z" });
  await buatUnitRevisionUntukJob({ orderId: order.id, jobId: jobPickupRevisi.id, status: "IN_REWORK" });

  const res = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-15");
  const baris = res.body.orang.find((o) => o.id === f.driver.user.id);
  assert.equal(baris.totalAlamat, 1, "job PICKUP hasil revisi TIDAK menambah alamat baru");
});

test("UnitRevision DELIVERY tidak dihitung", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-01T02:00:00.000Z" });
  const jobKirimUlang = await buatJob({ orderId: order.id, driverId: f.driver.user.id, type: "DELIVERY", completedAt: "2026-09-12T02:00:00.000Z" });
  await buatUnitRevisionUntukJob({ orderId: order.id, jobId: jobKirimUlang.id, status: "REDELIVERED", role: "DELIVERY" });

  const res = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-15");
  const baris = res.body.orang.find((o) => o.id === f.driver.user.id);
  assert.equal(baris.totalAlamat, 1, "job DELIVERY pengiriman ulang hasil revisi TIDAK menambah alamat baru");
});

test("job normal TETAP dihitung walau ada UnitRevision lain (exclude tidak bocor ke job sah)", async () => {
  const f = await fixtureDasar();
  const orderNormal = await buatOrder(f.customer.id);
  const orderRevisi = await buatOrder(f.customer.id);
  await buatJob({ orderId: orderNormal.id, driverId: f.driver.user.id, completedAt: "2026-09-03T02:00:00.000Z" });
  const jobAsliRevisi = await buatJob({ orderId: orderRevisi.id, driverId: f.driver.user.id, completedAt: "2026-09-01T02:00:00.000Z" });
  const jobPickupRevisi = await buatJob({ orderId: orderRevisi.id, driverId: f.driver.user.id, type: "PICKUP", completedAt: "2026-09-10T02:00:00.000Z" });
  await buatUnitRevisionUntukJob({ orderId: orderRevisi.id, jobId: jobPickupRevisi.id });

  const res = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-15");
  const baris = res.body.orang.find((o) => o.id === f.driver.user.id);
  // orderNormal (3 Sep) + jobAsliRevisi (1 Sep, PENGIRIMAN PERTAMA yang sah,
  // BUKAN job revisinya) = 2 alamat. jobPickupRevisi (10 Sep) TIDAK ikut.
  assert.equal(baris.totalAlamat, 2, "job normal & pengiriman pertama order revisi tetap dihitung, cuma job revisinya sendiri yang dibuang");
});

// ── Dedup — pembuktian bukan sekadar "raw job <= 2" ─────────────────────────
test("dedup: TIGA job COMPLETED di order+tanggal WIB yang SAMA tetap 1 alamat (bukan cuma batas 2)", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  // 3 job nyata di hari yang sama: PICKUP, lalu DELIVERY, lalu DELIVERY
  // kedua (mis. re-entry data/duplikat pencatatan) — dedup harus tetap
  // collapse ke 1 alamat berdasar (orderId, tanggalWIB), bukan berhenti
  // menghitung dobel di 2 job pertama saja.
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, type: "PICKUP", completedAt: "2026-09-05T01:00:00.000Z" });
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, type: "DELIVERY", completedAt: "2026-09-05T05:00:00.000Z" });
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, type: "DELIVERY", completedAt: "2026-09-05T09:00:00.000Z" });

  const res = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-10");
  const baris = res.body.orang.find((o) => o.id === f.driver.user.id);
  assert.equal(baris.totalAlamat, 1, "3 job hari sama, order sama -> TETAP 1 alamat");
  assert.equal(baris.totalInsentif, 7000, "1 alamat x tarif, BUKAN 3x walau raw job-nya 3");
});

test("dedup: user berbeda (driver A vs driver B) di order+tanggal sama masing-masing punya alamat sendiri (tidak tercampur)", async () => {
  const f = await fixtureDasar();
  const orderA = await buatOrder(f.customer.id);
  const orderB = await buatOrder(f.customer.id);
  await buatJob({ orderId: orderA.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  await buatJob({ orderId: orderB.id, driverId: f.helper.user.id, completedAt: "2026-09-05T02:00:00.000Z" });

  const res = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-10");
  const barisDriver = res.body.orang.find((o) => o.id === f.driver.user.id);
  const barisHelper = res.body.orang.find((o) => o.id === f.helper.user.id);
  assert.equal(barisDriver.totalAlamat, 1);
  assert.equal(barisHelper.totalAlamat, 1);
});

// ── Audit hasSim (24 September 2026) ────────────────────────────────────────
test("PATCH /drivers/:id mengubah hasSim mencatat TEPAT SATU ActivityEvent HAS_SIM_CHANGED", async () => {
  const f = await fixtureDasar();
  const res = await f.admin.api.patch(`/api/armada/drivers/${f.driver.user.id}`, { hasSim: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const events = await testPrisma.activityEvent.findMany({ where: { entityType: "user", entityId: f.driver.user.id, eventType: "HAS_SIM_CHANGED" } });
  assert.equal(events.length, 1, "harus tercatat TEPAT 1 event untuk 1 kali perubahan");
  assert.equal(events[0].metadata.from, true, "driver fixture awalnya hasSim=true");
  assert.equal(events[0].metadata.to, false);
  assert.equal(events[0].actorId, f.admin.user.id, "actor = admin yang melakukan PATCH");
  assert.equal(events[0].metadata.source, "armada.drivers.patch");
});

test("PATCH /drivers/:id dengan hasSim NILAI SAMA (tidak berubah) tidak mencatat event", async () => {
  const f = await fixtureDasar();
  // Driver fixture sudah hasSim=true — kirim ulang true (tidak berubah).
  const res = await f.admin.api.patch(`/api/armada/drivers/${f.driver.user.id}`, { hasSim: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const events = await testPrisma.activityEvent.findMany({ where: { entityType: "user", entityId: f.driver.user.id, eventType: "HAS_SIM_CHANGED" } });
  assert.equal(events.length, 0, "nilai dikirim ulang sama persis -> tidak ada perubahan nyata, tidak boleh ada event palsu");
});

test("PATCH /drivers/:id mengubah HANYA isFreelance tidak memicu event HAS_SIM_CHANGED palsu", async () => {
  const f = await fixtureDasar();
  const res = await f.admin.api.patch(`/api/armada/drivers/${f.driver.user.id}`, { isFreelance: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const events = await testPrisma.activityEvent.findMany({ where: { entityType: "user", entityId: f.driver.user.id, eventType: "HAS_SIM_CHANGED" } });
  assert.equal(events.length, 0, "field yang berubah cuma isFreelance, hasSim tidak disentuh sama sekali -> tidak boleh ada event HAS_SIM_CHANGED");
});

test("PATCH /pod/:jobId/edit TANPA mengubah driver/helper/completedAt tidak mencatat ActivityEvent (cuma ganti foto)", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  const job = await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });

  const res = await f.admin.api.patch(`/api/armada/pod/${job.id}/edit`, {
    reason: "Foto kurang jelas, diganti",
    proofPhotoUrls: ["/media/job-photos/baru.jpg"],
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const events = await testPrisma.activityEvent.findMany({ where: { entityType: "job", entityId: job.id, eventType: "POD_EDITED" } });
  assert.equal(events.length, 0, "edit foto saja tidak mempengaruhi insentif — tidak perlu audit trail nilai lama/baru");
});
