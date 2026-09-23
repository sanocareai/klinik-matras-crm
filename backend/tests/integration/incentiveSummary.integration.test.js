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
