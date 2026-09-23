// Provenance UnitRevision -> Job, APPEND-ONLY (audit insentif, 24 September
// 2026) — UnitRevision.jobId (FK tunggal) DITIMPA saat revisi naik dari
// PICKUP ke DELIVERY (create-delivery-job), jadi job PICKUP lama kehilangan
// satu-satunya jejak yang membuktikan asalnya begitu tahap DELIVERY dibuat
// — celah yang sebelumnya JUJUR didokumentasikan sebagai risiko tersisa.
// Test ini membuktikan UnitRevisionJobLink (tabel riwayat lengkap, tidak
// pernah ditimpa) menutup celah itu lewat jalur endpoint SUNGGUHAN (bukan
// fixture DB langsung seperti test insentif lain) — supaya benar-benar
// membuktikan penulisan link terjadi di transaksi yang sama dengan
// pembuatan job, bukan cuma logika query bacanya.
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

async function fixtureDasar() {
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const driver = await createTestUser({ roles: ["DRIVER"] });
  await testPrisma.user.update({ where: { id: driver.user.id }, data: { hasSim: true } });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Revisi", city: "Jakarta" } });
  const order = await testPrisma.order.create({
    data: { customerId: customer.id, orderNumber: `REV-ORDER-${++seq}`, value: 1000, category: "LAYANAN" },
  });
  const unit = await testPrisma.unit.create({
    data: { unitCode: `REV-UNIT-${++seq}`, orderId: order.id, seq: 1, status: "DELIVERED" },
  });
  return {
    admin: { ...admin, api: makeClient(server.baseUrl, admin.token) },
    driver: { ...driver, api: makeClient(server.baseUrl, driver.token) },
    customer, order, unit,
  };
}

// Helper: job biasa (bukan revisi) yang selesai — dipakai memastikan
// GET /incentive-summary tetap menghitung alamat SAH di test-test di bawah.
async function buatJobNormal({ orderId, driverId, completedAt }) {
  return testPrisma.job.create({
    data: { type: "DELIVERY", orderId, driverId, status: "COMPLETED", sequence: 1, completedAt: new Date(completedAt), addressText: "Alamat sah" },
  });
}

test("POST /revisions/:id/create-pickup-job menautkan UnitRevisionJobLink role PICKUP", async () => {
  const f = await fixtureDasar();
  const revRes = await f.admin.api.post("/api/armada/revisions", { unitId: f.unit.id, trigger: "KENYAMANAN", complaint: "Terlalu keras" });
  assert.equal(revRes.status, 201, JSON.stringify(revRes.body));
  const revisionId = revRes.body.id;

  const pickupRes = await f.admin.api.post(`/api/armada/revisions/${revisionId}/create-pickup-job`, {});
  assert.equal(pickupRes.status, 201, JSON.stringify(pickupRes.body));
  const pickupJobId = pickupRes.body.jobId;

  const link = await testPrisma.unitRevisionJobLink.findUnique({ where: { jobId: pickupJobId } });
  assert.ok(link, "link harus tertulis di transaksi yang sama dengan pembuatan job PICKUP");
  assert.equal(link.unitRevisionId, revisionId);
  assert.equal(link.role, "PICKUP");
});

test("setelah DELIVERY dibuat: link PICKUP TETAP ADA, DELIVERY juga tertaut, UnitRevision.jobId pindah ke DELIVERY (kompatibilitas)", async () => {
  const f = await fixtureDasar();
  const revRes = await f.admin.api.post("/api/armada/revisions", { unitId: f.unit.id, trigger: "GARANSI", complaint: "Amblas" });
  const revisionId = revRes.body.id;

  const pickupRes = await f.admin.api.post(`/api/armada/revisions/${revisionId}/create-pickup-job`, {});
  const pickupJobId = pickupRes.body.jobId;
  // Selesaikan job PICKUP secara langsung (bypass alur lapangan penuh —
  // fokus test ini SEMPIT: provenance link, bukan siklus produksi) lalu
  // dorong status revisi ke READY_REDELIVER supaya create-delivery-job
  // diizinkan (guard endpoint itu).
  await testPrisma.job.update({ where: { id: pickupJobId }, data: { status: "COMPLETED", completedAt: new Date("2026-09-15T02:00:00.000Z"), driverId: f.driver.user.id } });
  await testPrisma.unitRevision.update({ where: { id: revisionId }, data: { status: "READY_REDELIVER" } });

  const deliveryRes = await f.admin.api.post(`/api/armada/revisions/${revisionId}/create-delivery-job`, {});
  assert.equal(deliveryRes.status, 201, JSON.stringify(deliveryRes.body));
  const deliveryJobId = deliveryRes.body.jobId;
  assert.notEqual(deliveryJobId, pickupJobId);

  // UnitRevision.jobId (kolom LAMA, dipertahankan utk kompatibilitas) —
  // SEKARANG menunjuk job DELIVERY (perilaku existing, TIDAK diubah).
  const revisiTerbaru = await testPrisma.unitRevision.findUnique({ where: { id: revisionId } });
  assert.equal(revisiTerbaru.jobId, deliveryJobId, "jobId kolom lama tetap berperilaku SAMA seperti sebelumnya (ditimpa) — kompatibilitas API existing");

  // Tabel RIWAYAT baru — KEDUANYA harus tetap ada, tidak ada yang ditimpa.
  const linkPickup = await testPrisma.unitRevisionJobLink.findUnique({ where: { jobId: pickupJobId } });
  const linkDelivery = await testPrisma.unitRevisionJobLink.findUnique({ where: { jobId: deliveryJobId } });
  assert.ok(linkPickup, "link PICKUP HARUS tetap ada walau jobId kolom lama sudah dipindah ke DELIVERY — inilah inti fix slice ini");
  assert.equal(linkPickup.role, "PICKUP");
  assert.ok(linkDelivery, "link DELIVERY juga harus tertulis");
  assert.equal(linkDelivery.role, "DELIVERY");

  const jumlahLink = await testPrisma.unitRevisionJobLink.count({ where: { unitRevisionId: revisionId } });
  assert.equal(jumlahLink, 2, "TEPAT 2 baris riwayat untuk 1 revisi yang sudah lewat 2 tahap — bukan 1 yang ditimpa");
});

test("keduanya (PICKUP dan DELIVERY hasil revisi) TIDAK dapat insentif, job normal order lain TETAP dihitung", async () => {
  const f = await fixtureDasar();
  // Order KEDUA — pengiriman SAH, tidak ada hubungan dengan revisi.
  const orderNormal = await testPrisma.order.create({ data: { customerId: f.customer.id, orderNumber: `REV-ORDER-NORMAL-${++seq}`, value: 1000, category: "LAYANAN" } });
  await buatJobNormal({ orderId: orderNormal.id, driverId: f.driver.user.id, completedAt: "2026-09-03T02:00:00.000Z" });

  const revRes = await f.admin.api.post("/api/armada/revisions", { unitId: f.unit.id, trigger: "KENYAMANAN", complaint: "Kurang empuk" });
  const revisionId = revRes.body.id;
  const pickupRes = await f.admin.api.post(`/api/armada/revisions/${revisionId}/create-pickup-job`, {});
  const pickupJobId = pickupRes.body.jobId;
  await testPrisma.job.update({ where: { id: pickupJobId }, data: { status: "COMPLETED", completedAt: new Date("2026-09-10T02:00:00.000Z"), driverId: f.driver.user.id } });
  await testPrisma.unitRevision.update({ where: { id: revisionId }, data: { status: "READY_REDELIVER" } });
  const deliveryRes = await f.admin.api.post(`/api/armada/revisions/${revisionId}/create-delivery-job`, {});
  const deliveryJobId = deliveryRes.body.jobId;
  await testPrisma.job.update({ where: { id: deliveryJobId }, data: { status: "COMPLETED", completedAt: new Date("2026-09-12T02:00:00.000Z"), driverId: f.driver.user.id } });

  const res = await f.admin.api.get("/api/armada/incentive-summary?from=2026-09-01&to=2026-09-15");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const baris = res.body.orang.find((o) => o.id === f.driver.user.id);
  assert.equal(baris.totalAlamat, 1, "hanya order normal yang dihitung — job PICKUP & DELIVERY hasil revisi TIDAK menambah alamat, walau UnitRevision.jobId sudah pindah ke DELIVERY");
});

test("retry create-pickup-job pada revisi yang SAMA tidak membuat link ganda (ditolak guard existing, tidak diubah)", async () => {
  const f = await fixtureDasar();
  const revRes = await f.admin.api.post("/api/armada/revisions", { unitId: f.unit.id, trigger: "KENYAMANAN", complaint: "Kain kasar" });
  const revisionId = revRes.body.id;

  const pertama = await f.admin.api.post(`/api/armada/revisions/${revisionId}/create-pickup-job`, {});
  assert.equal(pertama.status, 201);

  // Retry (double-tap / klik ulang) — endpoint MENOLAK (guard existing:
  // "Revisi ini sudah punya job pengambilan"), TIDAK diubah slice ini.
  const retry = await f.admin.api.post(`/api/armada/revisions/${revisionId}/create-pickup-job`, {});
  assert.equal(retry.status, 400, JSON.stringify(retry.body));

  const jumlahLink = await testPrisma.unitRevisionJobLink.count({ where: { unitRevisionId: revisionId } });
  assert.equal(jumlahLink, 1, "retry ditolak SEBELUM sempat membuat job kedua — link tetap TEPAT 1, bukan 2");
});

test("POST /jobs/:id/report-revision (driver lapor di lokasi) juga menautkan link role PICKUP", async () => {
  const f = await fixtureDasar();
  // Job DELIVERY awal milik driver ini — syarat report-revision.
  const jobKirim = await testPrisma.job.create({
    data: { type: "DELIVERY", orderId: f.order.id, driverId: f.driver.user.id, status: "COMPLETED", sequence: 1, completedAt: new Date("2026-09-05T02:00:00.000Z"), addressText: "Alamat" },
  });
  await testPrisma.jobUnit.create({ data: { jobId: jobKirim.id, unitId: f.unit.id } });

  const res = await f.driver.api.post(`/api/armada/jobs/${jobKirim.id}/report-revision`, {
    complaint: "Kain sobek pas dicek customer", photoUrls: ["/media/job-photos/bukti1.jpg"],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const pickupJobId = res.body.pickupJob.id;

  const link = await testPrisma.unitRevisionJobLink.findUnique({ where: { jobId: pickupJobId } });
  assert.ok(link, "jalur ketiga (driver lapor di lokasi) juga WAJIB menautkan link, sama seperti dua endpoint dispatcher");
  assert.equal(link.role, "PICKUP");
  assert.equal(link.unitRevisionId, res.body.revision.id);
});

// ── Migration test PostgreSQL nyata: constraint tabel bekerja sungguhan ────
test("migration: constraint unique(jobId) mencegah SATU job tertaut ke DUA revisi berbeda", async () => {
  const f = await fixtureDasar();
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: f.order.id, status: "UNSCHEDULED", sequence: 1 } });
  const rev1 = await testPrisma.unitRevision.create({ data: { unitId: f.unit.id, trigger: "KENYAMANAN", complaint: "A" } });
  const rev2 = await testPrisma.unitRevision.create({ data: { unitId: f.unit.id, trigger: "GARANSI", complaint: "B" } });

  await testPrisma.unitRevisionJobLink.create({ data: { unitRevisionId: rev1.id, jobId: job.id, role: "PICKUP" } });
  await assert.rejects(
    () => testPrisma.unitRevisionJobLink.create({ data: { unitRevisionId: rev2.id, jobId: job.id, role: "PICKUP" } }),
    /Unique constraint/i,
    "constraint job_id UNIQUE di database sungguhan harus menolak job yang sama dipakai revisi lain"
  );
});

test("migration: constraint unique(unitRevisionId, jobId) mencegah baris duplikat persis", async () => {
  const f = await fixtureDasar();
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: f.order.id, status: "UNSCHEDULED", sequence: 1 } });
  const rev = await testPrisma.unitRevision.create({ data: { unitId: f.unit.id, trigger: "KENYAMANAN", complaint: "A" } });

  await testPrisma.unitRevisionJobLink.create({ data: { unitRevisionId: rev.id, jobId: job.id, role: "PICKUP" } });
  await assert.rejects(
    () => testPrisma.unitRevisionJobLink.create({ data: { unitRevisionId: rev.id, jobId: job.id, role: "PICKUP" } }),
    /Unique constraint/i
  );
});

test("migration: FK Restrict — job yang sudah tertaut link tidak bisa dihapus lewat SQL mentah tanpa CASCADE", async () => {
  const f = await fixtureDasar();
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: f.order.id, status: "UNSCHEDULED", sequence: 1 } });
  const rev = await testPrisma.unitRevision.create({ data: { unitId: f.unit.id, trigger: "KENYAMANAN", complaint: "A" } });
  await testPrisma.unitRevisionJobLink.create({ data: { unitRevisionId: rev.id, jobId: job.id, role: "PICKUP" } });

  await assert.rejects(
    () => testPrisma.$executeRawUnsafe(`DELETE FROM "jobs" WHERE id = $1::uuid`, job.id),
    /violates foreign key constraint/i,
    "job yang punya baris provenance TIDAK BOLEH terhapus diam-diam (Restrict, bukan Cascade/SetNull)"
  );
});
