// Bug nyata dilaporkan 10 Nov 2026 (job RSC-09112026-019/040): badge
// "Kendala Job" tampil SUDAH DIJADWALKAN ULANG padahal job itu GAGAL LAGI
// setelah sempat direschedule — form "Jadwalkan Ulang" masih kosong
// menunggu diisi, tapi deriveIssueStatus() membaca rescheduleReason dari
// SIKLUS LAMA dan menyamarkan kegagalan yang sedang terjadi SEKARANG.
// Dampak nyata: job begini hilang dari GET /armada/issues?status=OPEN dan
// tidak pernah memicu exception GAGAL_ANTAR di Delivery Control Tower
// (lihat frontend/src/features/armada/controlTowerRules.test.js untuk
// cermin tes murni logikanya).
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

const key = (v) => ({ "Idempotency-Key": `isr-${v}-${++seq}-abcdefgh` });

async function fixture() {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const dispatcher = await createTestUser({ roles: ["DISPATCHER"] });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Refail", city: "Jakarta" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ISR-ORD-${++seq}`, value: 1000, category: "LAYANAN" } });
  const job = await testPrisma.job.create({
    data: { type: "DELIVERY", orderId: order.id, driverId: driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-11-01T00:00:00.000Z") },
  });
  return {
    driver: { ...driver, api: makeClient(server.baseUrl, driver.token) },
    dispatcher: { ...dispatcher, api: makeClient(server.baseUrl, dispatcher.token) },
    job,
  };
}

async function gagalkan(f, jobId, alasan) {
  return f.driver.api.post(`/api/armada/jobs/${jobId}/fail`, {
    failureReason: alasan, failurePhotoUrls: ["/media/job-photos/fail.jpg"],
  }, key("fail"));
}

test("job GAGAL (pertama kali, belum pernah reschedule) -> issueStatus OPEN", async () => {
  const f = await fixture();
  const gagal = await gagalkan(f, f.job.id, "Customer tidak di tempat");
  assert.equal(gagal.status, 200, JSON.stringify(gagal.body));

  const res = await f.dispatcher.api.get("/api/armada/issues");
  const baris = res.body.jobs.find((j) => j.id === f.job.id);
  assert.ok(baris, "job gagal harus muncul di daftar Kendala & Reschedule");
  assert.equal(baris.issueStatus, "OPEN");

  const open = await f.dispatcher.api.get("/api/armada/issues?status=OPEN");
  assert.ok(open.body.jobs.some((j) => j.id === f.job.id), "harus tersaring status=OPEN");
  const resc = await f.dispatcher.api.get("/api/armada/issues?status=RESCHEDULED");
  assert.ok(!resc.body.jobs.some((j) => j.id === f.job.id), "TIDAK boleh tersaring status=RESCHEDULED");
});

test("BUG NYATA: job GAGAL, direschedule (berhasil), lalu GAGAL LAGI -> issueStatus TETAP OPEN, bukan RESCHEDULED", async () => {
  const f = await fixture();
  assert.equal((await gagalkan(f, f.job.id, "Customer minta reschedule")).status, 200);

  const next = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const resched = await f.dispatcher.api.post(`/api/armada/issues/${f.job.id}/reschedule`, {
    scheduledDate: next, driverId: f.driver.user.id, reason: "Customer minta hari lain", customerConfirmed: true,
  }, key("resched"));
  assert.equal(resched.status, 200, JSON.stringify(resched.body));
  assert.equal(resched.body.status, "ASSIGNED", "driverId diisi + tanggal ada -> ASSIGNED, siap gagal lagi");
  assert.ok(resched.body.rescheduleCase, "kasus reschedule harus terbuka");

  // Job yang sudah direschedule itu GAGAL LAGI (siklus kedua) — rescheduleReason
  // dari siklus PERTAMA tetap tertinggal di kolom Job (field tunggal, bukan
  // dikosongkan), persis skenario laporan nyata.
  const gagalLagi = await gagalkan(f, f.job.id, "Customer tidak di tempat lagi");
  assert.equal(gagalLagi.status, 200, JSON.stringify(gagalLagi.body));
  const jobDiDb = await testPrisma.job.findUnique({ where: { id: f.job.id } });
  assert.equal(jobDiDb.status, "FAILED");
  assert.ok(jobDiDb.rescheduleReason, "rescheduleReason siklus lama TIDAK dikosongkan — prasyarat bug");
  assert.ok(jobDiDb.rescheduleCaseId, "rescheduleCaseId siklus lama TIDAK dikosongkan — prasyarat bug");

  const res = await f.dispatcher.api.get("/api/armada/issues");
  const baris = res.body.jobs.find((j) => j.id === f.job.id);
  assert.ok(baris, "job yang gagal lagi harus tetap muncul di daftar");
  assert.equal(baris.issueStatus, "OPEN", "job FAILED SAAT INI harus OPEN walau pernah direschedule sebelumnya — SEBELUM fix ini salah jadi RESCHEDULED");

  // Konsekuensi nyata: filter status=OPEN (dipakai dispatcher mencari kerjaan
  // yang BUTUH tindakan) harus tetap menemukan job ini.
  const open = await f.dispatcher.api.get("/api/armada/issues?status=OPEN");
  assert.ok(open.body.jobs.some((j) => j.id === f.job.id), "harus tersaring status=OPEN walau pernah direschedule — SEBELUM fix job ini hilang dari sini");
  const resc = await f.dispatcher.api.get("/api/armada/issues?status=RESCHEDULED");
  assert.ok(!resc.body.jobs.some((j) => j.id === f.job.id), "TIDAK boleh tersaring status=RESCHEDULED selama job masih FAILED SEKARANG");
});

test("job yang SUDAH LEWAT dari FAILED (berhasil direschedule, belum gagal lagi) -> issueStatus RESCHEDULED (riwayat, bukan OPEN)", async () => {
  const f = await fixture();
  assert.equal((await gagalkan(f, f.job.id, "Customer minta reschedule")).status, 200);

  const next = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const resched = await f.dispatcher.api.post(`/api/armada/issues/${f.job.id}/reschedule`, {
    scheduledDate: next, driverId: f.driver.user.id, reason: "Customer minta hari lain", customerConfirmed: true,
  }, key("resched2"));
  assert.equal(resched.status, 200, JSON.stringify(resched.body));

  const res = await f.dispatcher.api.get("/api/armada/issues");
  const baris = res.body.jobs.find((j) => j.id === f.job.id);
  assert.ok(baris, "job yang masih punya rescheduleReason tetap muncul di daftar riwayat");
  assert.equal(baris.issueStatus, "RESCHEDULED", "job yang SUDAH LEWAT dari FAILED tetap RESCHEDULED untuk riwayat, perilaku ini TIDAK berubah oleh fix");
});
