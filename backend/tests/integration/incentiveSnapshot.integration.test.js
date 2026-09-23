// Snapshot Insentif Driver — test real-Postgres (24 September 2026). Lihat
// komentar panjang di schema.prisma model IncentiveSnapshot dan
// routes/incentiveSnapshot.js untuk penjelasan alur DRAFT->REVIEWED->
// APPROVED, proteksi overlap (IncentiveSourceClaim), dan pembekuan nilai.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
let seq = 0;
const K = () => ({ "Idempotency-Key": randomUUID() });

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function buatOrder(customerId) {
  return testPrisma.order.create({ data: { customerId, orderNumber: `SNP-ORDER-${++seq}`, value: 1000, category: "LAYANAN" } });
}
async function buatJob({ orderId, driverId = null, helperId = null, type = "DELIVERY", status = "COMPLETED", completedAt, complaintCaseId = null }) {
  return testPrisma.job.create({
    data: { type, orderId, driverId, helperId, status, sequence: 1, completedAt: completedAt ? new Date(completedAt) : null, complaintCaseId, addressText: "Alamat tes snapshot" },
  });
}

async function fixtureDasar() {
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const approver = await createTestUser({ roles: ["APPROVER"] });
  const sales = await createTestUser({ roles: ["SALES"] }); // TANPA permission snapshot apa pun — dipakai test unauthorized
  const driver = await createTestUser({ roles: ["DRIVER"] });
  await testPrisma.user.update({ where: { id: driver.user.id }, data: { hasSim: true } });
  const helper = await createTestUser({ roles: ["DRIVER"] });
  await testPrisma.user.update({ where: { id: helper.user.id }, data: { hasSim: false } });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Snapshot", city: "Jakarta" } });
  return {
    admin: { ...admin, api: makeClient(server.baseUrl, admin.token) },
    finance: { ...finance, api: makeClient(server.baseUrl, finance.token) },
    approver: { ...approver, api: makeClient(server.baseUrl, approver.token) },
    sales: { ...sales, api: makeClient(server.baseUrl, sales.token) },
    driver: { ...driver, api: makeClient(server.baseUrl, driver.token) },
    helper: { ...helper, api: makeClient(server.baseUrl, helper.token) },
    customer,
  };
}

// ── Batas periode WIB ────────────────────────────────────────────────────
test("Snapshot bulanan: job selesai 03:00 WIB tanggal 1 tetap terhitung (batas WIB, bukan UTC)", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-08-31T20:00:00.000Z" }); // = 2026-09-01 03:00 WIB

  const res = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "monthly", year: 2026, month: 9 }, K());
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.periodFrom, "2026-09-01");
  const baris = res.body.lines.find((l) => l.userId === f.driver.user.id);
  assert.ok(baris, "job jam 03:00 WIB tanggal 1 harus ikut terhitung di snapshot bulanan");
  assert.equal(baris.totalAlamat, 1);
});

test("Snapshot bulanan mencakup SATU BULAN PENUH (1 s/d akhir bulan), bukan cuma s/d hari ini", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-08-30T02:00:00.000Z" });

  const res = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "monthly", year: 2026, month: 8 }, K());
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.periodTo, "2026-08-31", "akhir bulan Agustus, bukan tanggal hari ini");
});

// ── Tarif SIM/tanpa SIM dibekukan ────────────────────────────────────────
test("Tarif & hasSim DIBEKUKAN di snapshot — perubahan hasSim SETELAHNYA tidak mengubah angka yang sudah dibuat", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });

  const res = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const baris = res.body.lines.find((l) => l.userId === f.driver.user.id);
  assert.equal(baris.hasSim, true);
  assert.equal(baris.ratePerAlamat, 7000);
  assert.equal(baris.totalRupiah, 7000);

  // hasSim berubah SETELAH snapshot dibuat.
  await testPrisma.user.update({ where: { id: f.driver.user.id }, data: { hasSim: false } });

  const ulang = await f.finance.api.get(`/api/armada/incentive-snapshots/${res.body.id}`);
  const barisUlang = ulang.body.lines.find((l) => l.userId === f.driver.user.id);
  assert.equal(barisUlang.hasSim, true, "baris snapshot TETAP hasSim=true (dibekukan)");
  assert.equal(barisUlang.ratePerAlamat, 7000, "tarif TETAP Rp7.000 (dibekukan)");
  assert.equal(barisUlang.totalRupiah, 7000);

  // TAPI live comparison HARUS mencerminkan hasSim yang baru (estimasi live tetap jalan).
  assert.equal(ulang.body.liveComparison.berubah, true);
  const liveBaris = ulang.body.liveComparison.orang.find((o) => o.id === f.driver.user.id);
  assert.equal(liveBaris.hasSim, false);
  assert.equal(liveBaris.totalInsentif, 3000, "live recompute ikut berubah — estimasi live TIDAK dibekukan");
});

// ── Driver/helper ─────────────────────────────────────────────────────────
test("Snapshot membekukan peran driver DAN helper masing-masing nilai penuh", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, helperId: f.helper.user.id, completedAt: "2026-09-05T02:00:00.000Z" });

  const res = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const driverLine = res.body.lines.find((l) => l.userId === f.driver.user.id);
  const helperLine = res.body.lines.find((l) => l.userId === f.helper.user.id);
  assert.equal(driverLine.asDriver, 1); assert.equal(driverLine.totalRupiah, 7000);
  assert.equal(helperLine.asHelper, 1); assert.equal(helperLine.totalRupiah, 3000);
  assert.equal(driverLine.details[0].asDriver, true);
  assert.equal(driverLine.details[0].asHelper, false);
  assert.equal(helperLine.details[0].asHelper, true);
  assert.equal(helperLine.details[0].asDriver, false);
  assert.deepEqual(driverLine.details[0].jobIds, helperLine.details[0].jobIds, "jobIds sumber sama (job yang sama)");
});

// ── Dedup source key ──────────────────────────────────────────────────────
test("Dedup source key: PICKUP+DELIVERY order sama tanggal sama -> SATU baris detail", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, type: "PICKUP", completedAt: "2026-09-05T02:00:00.000Z" });
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, type: "DELIVERY", completedAt: "2026-09-05T08:00:00.000Z" });

  const res = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());
  const baris = res.body.lines.find((l) => l.userId === f.driver.user.id);
  assert.equal(baris.totalAlamat, 1);
  assert.equal(baris.details.length, 1);
  assert.equal(baris.details[0].jobIds.length, 2, "kedua jobId (pickup+delivery) tercatat di SATU baris detail");

  const claim = await testPrisma.incentiveSourceClaim.count({ where: { userId: f.driver.user.id, orderId: order.id } });
  assert.equal(claim, 1, "SATU klaim source key, bukan dua");
});

// ── Custom range overlap ───────────────────────────────────────────────────
test("Custom range overlap: alamat yang sudah diklaim snapshot AKTIF lain DITOLAK (409), bukan double-count", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-15T02:00:00.000Z" });

  const pertama = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-20" }, K());
  assert.equal(pertama.status, 201, JSON.stringify(pertama.body));

  // Range custom KEDUA yang beririsan (mencakup 15 Sept yang sama).
  const kedua = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-10", to: "2026-09-30" }, K());
  assert.equal(kedua.status, 409, JSON.stringify(kedua.body));

  assert.equal(await testPrisma.incentiveSnapshot.count({ where: { status: "DRAFT" } }), 1, "snapshot kedua TIDAK boleh terbentuk sama sekali (transaksi batal total)");
});

test("Preview menunjukkan peringatan overlap kalender SEBELUM snapshot dibuat", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-15T02:00:00.000Z" });
  await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-20" }, K());

  const preview = await f.finance.api.post("/api/armada/incentive-snapshots/preview", { mode: "custom", from: "2026-09-10", to: "2026-09-30" });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.peringatan.overlapKalender.length, 1);
  assert.equal(preview.body.peringatan.klaimBentrok, 1);
});

// ── Dua request create/approve paralel ────────────────────────────────────
test("BALAPAN: dua create snapshot overlap bersamaan -> tepat SATU berhasil", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-15T02:00:00.000Z" });

  const hasil = await Promise.all([
    f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-20" }, K()),
    f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-10", to: "2026-09-30" }, K()),
  ]);
  const statuses = hasil.map((h) => h.status).sort();
  assert.deepEqual(statuses, [201, 409], JSON.stringify(hasil.map((h) => h.body)));
  assert.equal(await testPrisma.incentiveSnapshot.count(), 1);
});

test("BALAPAN: dua approve bersamaan pada snapshot REVIEWED yang sama -> tepat SATU 200, satu 409", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const buat = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());
  await f.finance.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/review`, {}, K());

  const hasil = await Promise.all([
    f.approver.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/approve`, {}, K()),
    f.approver.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/approve`, {}, K()),
  ]);
  assert.deepEqual(hasil.map((h) => h.status).sort(), [200, 409], JSON.stringify(hasil.map((h) => h.body)));
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "incentive_snapshot", entityId: buat.body.id, eventType: "INCENTIVE_SNAPSHOT_APPROVED" } }), 1);
});

// ── Retry idempoten ────────────────────────────────────────────────────────
test("Retry create dengan Idempotency-Key SAMA: respons diputar ulang, TIDAK ada snapshot kedua", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const kunci = K();
  const body = { mode: "custom", from: "2026-09-01", to: "2026-09-10" };

  const a = await f.finance.api.post("/api/armada/incentive-snapshots", body, kunci);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  // Tunggu baris idempotency selesai ditandai DONE (middleware menulisnya di res.on("finish")).
  await new Promise((r) => setTimeout(r, 200));

  const b = await f.finance.api.post("/api/armada/incentive-snapshots", body, kunci);
  assert.equal(b.headers.get("idempotent-replayed"), "true");
  assert.equal(b.body.id, a.body.id);
  assert.equal(await testPrisma.incentiveSnapshot.count(), 1);
});

// ── Job berubah setelah snapshot ───────────────────────────────────────────
test("Job diedit SETELAH snapshot dibuat: baris snapshot tetap, liveComparison menandai 'berubah'", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  const job = await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const buat = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());
  assert.equal(buat.body.totalRupiah, 7000);

  // Job dipindah ke driver LAIN setelah snapshot dibuat (mis. koreksi POD).
  await testPrisma.job.update({ where: { id: job.id }, data: { driverId: f.helper.user.id } });

  const ulang = await f.finance.api.get(`/api/armada/incentive-snapshots/${buat.body.id}`);
  assert.equal(ulang.body.totalRupiah, 7000, "baris snapshot TETAP (angka yang sudah dibekukan tidak ikut berubah)");
  assert.equal(ulang.body.liveComparison.berubah, true, "liveComparison HARUS menandai data sudah berubah sejak snapshot dibuat");
});

// ── Unauthorized review/approve ────────────────────────────────────────────
test("Unauthorized: user tanpa permission review/approve ditolak 403, status snapshot tidak berubah", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const buat = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());

  const tolakReview = await f.sales.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/review`, {}, K());
  assert.equal(tolakReview.status, 403, JSON.stringify(tolakReview.body));
  const tolakApprove = await f.sales.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/approve`, {}, K());
  assert.equal(tolakApprove.status, 403, JSON.stringify(tolakApprove.body));
  const tolakCreate = await f.sales.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-10-01", to: "2026-10-05" }, K());
  assert.equal(tolakCreate.status, 403, JSON.stringify(tolakCreate.body));

  const masihDraft = await testPrisma.incentiveSnapshot.findUnique({ where: { id: buat.body.id } });
  assert.equal(masihDraft.status, "DRAFT");
});

test("Approve LANGSUNG dari DRAFT (belum direview) ditolak — alur wajib DRAFT->REVIEWED->APPROVED", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const buat = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());

  const res = await f.approver.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/approve`, {}, K());
  assert.equal(res.status, 409, JSON.stringify(res.body));
});

// ── APPROVED immutable ─────────────────────────────────────────────────────
test("APPROVED immutable: review/approve/reject SETELAH APPROVED semuanya ditolak", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const buat = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());
  await f.finance.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/review`, {}, K());
  await f.approver.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/approve`, {}, K());

  const reReview = await f.finance.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/review`, {}, K());
  assert.equal(reReview.status, 409);
  const reApprove = await f.approver.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/approve`, {}, K());
  assert.equal(reApprove.status, 409);
  const reReject = await f.approver.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/reject`, { reason: "coba tolak" }, K());
  assert.equal(reReject.status, 409);

  const akhir = await testPrisma.incentiveSnapshot.findUnique({ where: { id: buat.body.id } });
  assert.equal(akhir.status, "APPROVED");
});

// ── Rejection & adjustment audit trail ─────────────────────────────────────
test("Reject: alasan wajib, ActivityEvent tercatat, klaim source key DILEPAS (bisa di-snapshot ulang)", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const buat = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());

  const tanpaAlasan = await f.finance.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/reject`, {}, K());
  assert.equal(tanpaAlasan.status, 400);

  const res = await f.finance.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/reject`, { reason: "Data POD masih dikoreksi" }, K());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.status, "REJECTED");
  assert.equal(res.body.rejectionReason, "Data POD masih dikoreksi");

  const event = await testPrisma.activityEvent.findFirst({ where: { entityType: "incentive_snapshot", entityId: buat.body.id, eventType: "INCENTIVE_SNAPSHOT_REJECTED" } });
  assert.ok(event); assert.equal(event.metadata.reason, "Data POD masih dikoreksi");

  assert.equal(await testPrisma.incentiveSourceClaim.count({ where: { snapshotId: buat.body.id } }), 0, "klaim harus dilepas setelah reject");
  assert.equal(await testPrisma.incentiveSnapshotDetail.count({ where: { snapshotId: buat.body.id } }), 1, "histori detail TETAP ada (tidak dihapus)");

  // Periode yang sama sekarang BISA di-snapshot ulang (klaim sudah lepas).
  const ulang = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());
  assert.equal(ulang.status, 201, JSON.stringify(ulang.body));
});

test("Adjustment: snapshot baru mereferensikan snapshot APPROVED asal, mencatat event di KEDUANYA, snapshot asal tidak berubah", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const asal = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());
  await f.finance.api.post(`/api/armada/incentive-snapshots/${asal.body.id}/review`, {}, K());
  await f.approver.api.post(`/api/armada/incentive-snapshots/${asal.body.id}/approve`, {}, K());

  // Order KEDUA pada periode SAMA — tanpa adjustment, ini akan bentrok
  // klaim dengan snapshot asal (tanggal 5 Sept sudah diklaim)? Tidak —
  // order berbeda, tanggal sama boleh, jadi tambahkan job di tanggal yang
  // SAMA PERSIS dengan snapshot asal (order sama) untuk membuktikan
  // adjustment BOLEH menyentuh ulang klaim snapshot yang dikoreksinya.
  const adjust = await f.finance.api.post(`/api/armada/incentive-snapshots/${asal.body.id}/adjust`, { mode: "custom", from: "2026-09-01", to: "2026-09-10", reason: "Koreksi driver salah" }, K());
  assert.equal(adjust.status, 201, JSON.stringify(adjust.body));
  assert.equal(adjust.body.adjustsSnapshotId, asal.body.id);

  const eventAsal = await testPrisma.activityEvent.findFirst({ where: { entityType: "incentive_snapshot", entityId: asal.body.id, eventType: "INCENTIVE_SNAPSHOT_ADJUSTED" } });
  assert.ok(eventAsal, "snapshot ASAL harus mencatat event ADJUSTED");
  assert.equal(eventAsal.metadata.adjustmentSnapshotId, adjust.body.id);

  const eventBaru = await testPrisma.activityEvent.findFirst({ where: { entityType: "incentive_snapshot", entityId: adjust.body.id, eventType: "INCENTIVE_SNAPSHOT_CREATED" } });
  assert.ok(eventBaru); assert.equal(eventBaru.metadata.adjustsSnapshotId, asal.body.id);

  const asalTerbaru = await testPrisma.incentiveSnapshot.findUnique({ where: { id: asal.body.id } });
  assert.equal(asalTerbaru.status, "APPROVED", "snapshot asal TIDAK berubah statusnya");
  assert.equal(asalTerbaru.totalRupiah, asal.body.totalRupiah, "angka snapshot asal TIDAK diedit sama sekali");
});

test("Adjustment DITOLAK kalau snapshot asal belum APPROVED (masih DRAFT/REVIEWED)", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const draft = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());

  const res = await f.finance.api.post(`/api/armada/incentive-snapshots/${draft.body.id}/adjust`, { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());
  assert.equal(res.status, 409, JSON.stringify(res.body));
});

// ── Kandidat UnitRevision belum terverifikasi (catatan, TIDAK mengubah total) ─
test("Kandidat UnitRevision 502368c9 ditandai sebagai catatan bila job-nya muncul, TIDAK mengubah total maupun link otomatis", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  // Pakai id job KANDIDAT yang sama persis dengan investigasi read-only
  // sebelumnya (hardcoded di routes/incentiveSnapshot.js) — di database
  // TES ini job-nya BARU (fixture lokal), bukan job produksi asli, MURNI
  // untuk membuktikan mekanisme penandaan bekerja kalau id itu muncul.
  await testPrisma.job.create({
    data: {
      id: "7410ff7b-a476-41be-8bb3-cf5756a8d308", type: "PICKUP", orderId: order.id, driverId: f.driver.user.id,
      status: "COMPLETED", sequence: 1, completedAt: new Date("2026-09-05T02:00:00.000Z"), addressText: "Alamat tes",
    },
  });

  const res = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const baris = res.body.lines.find((l) => l.userId === f.driver.user.id);
  assert.equal(baris.totalAlamat, 1, "total TIDAK berubah — job tetap dihitung apa adanya, cuma ditandai");
  assert.ok(baris.details[0].kandidatBelumTerverifikasi, "harus ada catatan kandidat belum terverifikasi");
  assert.match(baris.details[0].kandidatBelumTerverifikasi[0], /Menunggu konfirmasi Ops/);

  const link = await testPrisma.unitRevisionJobLink.count({ where: { jobId: "7410ff7b-a476-41be-8bb3-cf5756a8d308" } });
  assert.equal(link, 0, "TIDAK ADA link otomatis dibuat ke unit_revision_job_links");
});

// ── Regression: seluruh rumus insentif existing berlaku di dalam Snapshot ──
test("Regression lewat endpoint Snapshot: ComplaintCase, UnitRevision, CANCELLED, FAILED tetap dikecualikan", async () => {
  const f = await fixtureDasar();
  const orderNormal = await buatOrder(f.customer.id);
  await buatJob({ orderId: orderNormal.id, driverId: f.driver.user.id, completedAt: "2026-09-01T02:00:00.000Z" });

  const orderComplaint = await buatOrder(f.customer.id);
  await buatJob({ orderId: orderComplaint.id, driverId: f.driver.user.id, completedAt: "2026-09-02T02:00:00.000Z" });
  const kasus = await testPrisma.complaintCase.create({ data: { caseNumber: `CMP-SNP-${++seq}`, orderId: orderComplaint.id, category: "KUALITAS_PRODUK", description: "tes" } });
  await buatJob({ orderId: orderComplaint.id, driverId: f.driver.user.id, completedAt: "2026-09-08T02:00:00.000Z", complaintCaseId: kasus.id });

  const orderCancelled = await buatOrder(f.customer.id);
  await buatJob({ orderId: orderCancelled.id, driverId: f.driver.user.id, completedAt: "2026-09-03T02:00:00.000Z" });
  await testPrisma.order.update({ where: { id: orderCancelled.id }, data: { status: "CANCELLED" } });

  const orderFailed = await buatOrder(f.customer.id);
  await buatJob({ orderId: orderFailed.id, driverId: f.driver.user.id, status: "FAILED", completedAt: "2026-09-04T02:00:00.000Z" });

  const res = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const baris = res.body.lines.find((l) => l.userId === f.driver.user.id);
  assert.equal(baris.totalAlamat, 2, "hanya orderNormal + job PERTAMA orderComplaint yang dihitung (2 alamat)");
});
