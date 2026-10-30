// Test integrasi — Complaint / After-Sales Case lintas divisi (D-116, 11
// September 2026). Lewat HTTP sungguhan (router ASLI, bukan tiruan) terhadap
// PostgreSQL sungguhan, pola sama dengan documentFlows.integration.test.js.
//
// Mencakup alur lengkap yang diminta owner: Sales membuka kasus SAAT ORDER
// MASIH DIPRODUKSI (bukan cuma setelah DELIVERED — itu inti perbaikannya,
// laporan kasus Sony/Aida) -> Delivery Task (Job) -> job selesai -> auto-
// advance ke Produksi -> Material Requirement ke Warehouse -> QC -> siap
// kirim -> Delivery Task kedua (redelivery) -> job selesai -> auto-advance
// ke Sales -> follow-up -> confirm-customer -> SELESAI, plus edge case
// validasi transisi/permission.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestUnit, createTestMaterial } from "./setup/fixtures.js";
import { startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

const { complaintsRouter } = await import("../../src/routes/complaints.js");
const { armadaRouter } = await import("../../src/routes/armada.js");
const { materialIssueRouter } = await import("../../src/routes/materialIssue.js");
const { activityRouter } = await import("../../src/routes/activity.js");

function buildComplaintTestApp() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/complaints", complaintsRouter);
  app.use("/api/armada", armadaRouter);
  app.use("/api/inventory/material-issues", materialIssueRouter);
  app.use("/api/activity", activityRouter);
  return app;
}

let server;

test.before(async () => {
  await truncateAll();
  server = await startTestServer(buildComplaintTestApp());
});
// routing_stages = master data (TIDAK ikut truncateAll): stage fixture dilacak lalu dihapus supaya tidak bocor ke berkas lain di database yang sama.
const fixtureStageIds = [];
const dropFixtureStages = async () => { if (fixtureStageIds.length) await testPrisma.routingStage.deleteMany({ where: { id: { in: fixtureStageIds.splice(0) } } }); };
test.after(async () => {
  await server.close();
  await truncateAll();
  await dropFixtureStages();
  await testPrisma.$disconnect();
});
test.afterEach(async () => { await truncateAll(); await dropFixtureStages(); });

async function clientAs(roles) {
  const { token, user } = await createTestUser({ roles });
  return { api: makeClient(server.baseUrl, token), user };
}

// Bawa kasus sampai SIAP_DIKIRIM lalu buat Delivery Task DELIVERY (D-116) —
// titik awal bersama untuk semua tes gerbang redelivery di bawah (insiden
// Sony RES-27082026-183, 31 Oktober 2026). Job yang lahir TETAP UNSCHEDULED
// (lihat createDeliveryTask) — tiap tes mengubah statusnya sendiri sesuai
// skenario yang diuji.
async function setupKasusMenujuDikirimUlang(sales, dispatcher) {
  const { order, unit } = await createTestUnit();
  const create = await sales.api.post("/api/complaints", {
    orderId: order.id, unitId: unit.id, category: "KENYAMANAN", description: "Test gerbang redelivery",
  });
  const caseId = create.body.id;
  await sales.api.post(`/api/complaints/${caseId}/status`, { status: "VERIFIKASI" });
  await sales.api.post(`/api/complaints/${caseId}/status`, { status: "ACTION_REQUIRED" });
  await sales.api.post(`/api/complaints/${caseId}/status`, { status: "SIAP_DIKIRIM" });
  const redeliver = await dispatcher.api.post(`/api/complaints/${caseId}/delivery-task`, { jobType: "DELIVERY" });
  const deliveryJobId = redeliver.body.jobs.find((j) => j.type === "DELIVERY").id;
  return { caseId, order, unit, deliveryJobId };
}

async function makeRoutingStage() {
  const stage = await testPrisma.routingStage.create({
    data: { code: `qc-${Date.now()}-${Math.random()}`, labelId: "Uji Berat Badan", phase: "MODULE", sequence: 1, requiresQc: true },
  });
  fixtureStageIds.push(stage.id);
  return stage;
}

test("Complaint end-to-end: dibuka SAAT ORDER MASIH DIPRODUKSI (bukan DELIVERED) sampai SELESAI, lintas Sales/Delivery/Produksi/Warehouse/QC", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const prodLead = await clientAs(["PRODUCTION_LEAD"]);
  const warehouse = await clientAs(["WAREHOUSE"]);
  const qcLead = await clientAs(["QC_LEAD"]);

  const { order, unit } = await createTestUnit({ status: "IN_PRODUCTION" });
  // Order TIDAK diubah ke DELIVERED sama sekali — inti perbaikan D-116.
  const orderCheck = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.notEqual(orderCheck.status, "DELIVERED");

  // 1. Sales membuka kasus dari Order Detail.
  const create = await sales.api.post("/api/complaints", {
    orderId: order.id, unitId: unit.id,
    category: "KENYAMANAN", severity: "TINGGI", warrantyStatus: "DALAM_GARANSI",
    description: "Customer minta kasur dipendekin lagi",
  });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const caseId = create.body.id;
  assert.equal(create.body.status, "BARU");
  assert.equal(create.body.currentOwner, "SALES");
  assert.match(create.body.caseNumber, /^CMP-\d{8}-\d{3}$/);

  // Order.hasComplaint ikut menyala (parity D-109) TANPA Order.status berubah.
  const orderAfterCreate = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.equal(orderAfterCreate.hasComplaint, true);
  assert.notEqual(orderAfterCreate.status, "DELIVERED");

  // 2. Verifikasi -> Action Required (Sales).
  let r = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "VERIFIKASI" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "ACTION_REQUIRED" });
  assert.equal(r.status, 200);

  // 3. Dispatcher bikin Delivery Task (PICKUP) — TIDAK mensyaratkan Unit
  // DELIVERED sama sekali, ini yang tidak bisa dilakukan UnitRevision lama.
  const pickup = await dispatcher.api.post(`/api/complaints/${caseId}/delivery-task`, { jobType: "PICKUP" });
  assert.equal(pickup.status, 201, JSON.stringify(pickup.body));
  assert.equal(pickup.body.status, "DIJADWALKAN");
  assert.equal(pickup.body.currentOwner, "DELIVERY");
  assert.equal(pickup.body.jobs.length, 1);
  const pickupJobId = pickup.body.jobs[0].id;

  // Job lahir UNSCHEDULED (D-108) — dispatcher menjadwalkannya dulu seperti
  // job biasa (scheduledDate -> deriveStatus ke SCHEDULED) sebelum diselesaikan.
  const schedule1 = await dispatcher.api.patch(`/api/armada/jobs/${pickupJobId}`, { scheduledDate: "2026-09-12" });
  assert.equal(schedule1.status, 200, JSON.stringify(schedule1.body));

  // 4. Job pengambilan diselesaikan dispatcher -> auto-advance ke Produksi.
  const complete1 = await dispatcher.api.post(`/api/armada/jobs/${pickupJobId}/complete`, {
    proofPhotoUrls: ["/media/job-photos/test1.jpg"],
  });
  assert.equal(complete1.status, 200, JSON.stringify(complete1.body));

  const afterPickup = await sales.api.get(`/api/complaints/${caseId}`);
  assert.equal(afterPickup.body.status, "DALAM_PENANGANAN");
  assert.equal(afterPickup.body.currentOwner, "PRODUCTION");
  // Unit ikut RECEIVED (mekanisme job-completion yang SUDAH ADA, dipakai apa
  // adanya — bukan model "Production Job" baru).
  const unitAfterPickup = await testPrisma.unit.findUnique({ where: { id: unit.id } });
  assert.equal(unitAfterPickup.status, "RECEIVED");

  // 5. Produksi butuh material -> Warehouse mencatat Material Requirement
  // (dijaga INVENTORY_WRITE, permission ASLI Warehouse — pola sama dengan
  // POST /inventory/material-issues yang sudah ada, PRODUCTION_LEAD memang
  // TIDAK memegang INVENTORY_WRITE sejak awal).
  const material = await createTestMaterial();
  const matReq = await warehouse.api.post(`/api/complaints/${caseId}/material-requirement`, {
    requiredDate: "2026-09-15", priority: "URGENT",
    lines: [{ materialId: material.id, requestedQty: 2 }],
  });
  assert.equal(matReq.status, 201, JSON.stringify(matReq.body));
  assert.equal(matReq.body.status, "MENUNGGU_MATERIAL");
  assert.equal(matReq.body.currentOwner, "WAREHOUSE");
  assert.equal(matReq.body.materialIssues.length, 1);
  const issueId = matReq.body.materialIssues[0].id;

  const issueRow = await testPrisma.materialIssue.findUnique({ where: { id: issueId } });
  assert.equal(issueRow.sourceType, "COMPLAINT_REWORK");
  assert.equal(issueRow.complaintCaseId, caseId);
  assert.equal(issueRow.unitId, unit.id);

  // Warehouse approve+issue material (jalur asli, TIDAK diubah oleh fitur ini).
  await warehouse.api.patch(`/api/inventory/material-issues/${issueId}`, { status: "WAITING_APPROVAL" });
  await warehouse.api.patch(`/api/inventory/material-issues/${issueId}`, { status: "APPROVED" });

  // 6. Material sudah ada di tangan -> balik DALAM_PENANGANAN -> QC.
  r = await prodLead.api.post(`/api/complaints/${caseId}/status`, { status: "DALAM_PENANGANAN" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await prodLead.api.post(`/api/complaints/${caseId}/status`, { status: "QC" });
  assert.equal(r.status, 200);

  // 7. QC menautkan hasil tes ulang.
  const stage = await makeRoutingStage();
  const qcTest = await testPrisma.qcFitTest.create({
    data: { unitId: unit.id, stageId: stage.id, verdict: "PAS", referenceWeightKg: 70, testedById: qcLead.user.id },
  });
  const linkQc = await qcLead.api.post(`/api/complaints/${caseId}/link-qc`, { qcFitTestId: qcTest.id });
  assert.equal(linkQc.status, 200, JSON.stringify(linkQc.body));
  assert.equal(linkQc.body.qcFitTest.id, qcTest.id);

  // 8. QC lulus -> siap dikirim.
  r = await qcLead.api.post(`/api/complaints/${caseId}/status`, { status: "SIAP_DIKIRIM" });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  // 9. Dispatcher bikin Delivery Task KEDUA (redelivery).
  const redeliver = await dispatcher.api.post(`/api/complaints/${caseId}/delivery-task`, { jobType: "DELIVERY" });
  assert.equal(redeliver.status, 201, JSON.stringify(redeliver.body));
  assert.equal(redeliver.body.status, "DIKIRIM_ULANG");
  assert.equal(redeliver.body.jobs.length, 2);
  const deliveryJob = redeliver.body.jobs.find((j) => j.type === "DELIVERY");

  const schedule2 = await dispatcher.api.patch(`/api/armada/jobs/${deliveryJob.id}`, { scheduledDate: "2026-09-13" });
  assert.equal(schedule2.status, 200, JSON.stringify(schedule2.body));

  const complete2 = await dispatcher.api.post(`/api/armada/jobs/${deliveryJob.id}/complete`, {
    proofPhotoUrls: ["/media/job-photos/test2.jpg"],
  });
  assert.equal(complete2.status, 200, JSON.stringify(complete2.body));

  // 10. Auto-advance ke KONFIRMASI_CUSTOMER (giliran Sales).
  const afterRedeliver = await sales.api.get(`/api/complaints/${caseId}`);
  assert.equal(afterRedeliver.body.status, "KONFIRMASI_CUSTOMER");
  assert.equal(afterRedeliver.body.currentOwner, "SALES");

  // 11. Sales follow-up (bisa berkali-kali, dicatat sebagai activity).
  const followUp = await sales.api.post(`/api/complaints/${caseId}/follow-up`, { note: "Sudah ditelepon, customer akan cek dulu" });
  assert.equal(followUp.status, 201, JSON.stringify(followUp.body));

  const timeline = await sales.api.get(`/api/activity?entityType=complaint&entityId=${caseId}`);
  assert.equal(timeline.status, 200, JSON.stringify(timeline.body));
  assert.ok(timeline.body.events.some((e) => e.eventType === "COMPLAINT_FOLLOW_UP_LOGGED"));
  assert.ok(timeline.body.events.some((e) => e.eventType === "COMPLAINT_CREATED"));

  // 12. Customer konfirmasi puas -> SELESAI. HANYA bisa lewat endpoint ini.
  const confirm = await sales.api.post(`/api/complaints/${caseId}/confirm-customer`, {});
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  assert.equal(confirm.body.status, "SELESAI");
  assert.ok(confirm.body.customerConfirmedAt);
  assert.equal(confirm.body.customerConfirmedBy.id, sales.user.id);

  // Order.hasComplaint ikut resolved (parity D-109).
  const orderFinal = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.ok(orderFinal.complaintResolvedAt);
  assert.equal(orderFinal.complaintResolvedById, sales.user.id);
});

// Regresi NYATA (11 September 2026, laporan owner: screenshot Jadwal &
// Penugasan — "di delivery masih belum bisa masuk rute" untuk kasus Sony
// RES-27082026-183). Akar masalah: STALE_UNSCHEDULED_JOB (D-064/D-108,
// services/jobStatus.js) menyembunyikan job UNSCHEDULED yang order induknya
// SUDAH DELIVERED, dirancang untuk membuang job basi peninggalan pre-
// Delivery-Hub — tapi TANPA pengecualian untuk ComplaintCase, filter yang
// SAMA ikut membuang job PICKUP yang justru BARU dibuat untuk kasus
// komplain (yang SELALU order.status=DELIVERED, itulah intinya). Job dari
// UnitRevision sudah dikecualikan sejak D-108 (`revisionLinks: { none: {} }`)
// — ComplaintCase butuh pengecualian yang SAMA (`complaintCaseId: null`).
test("Regresi: job PICKUP dari ComplaintCase pada order yang SUDAH DELIVERED TETAP muncul di GET /armada/jobs", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const { order, unit } = await createTestUnit({ status: "DELIVERED" });
  await testPrisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });

  const create = await sales.api.post("/api/complaints", {
    orderId: order.id, unitId: unit.id, category: "KENYAMANAN", description: "Test regresi STALE_UNSCHEDULED_JOB",
  });
  const caseId = create.body.id;
  await sales.api.post(`/api/complaints/${caseId}/status`, { status: "VERIFIKASI" });
  await sales.api.post(`/api/complaints/${caseId}/status`, { status: "ACTION_REQUIRED" });
  const pickup = await dispatcher.api.post(`/api/complaints/${caseId}/delivery-task`, { jobType: "PICKUP" });
  assert.equal(pickup.status, 201, JSON.stringify(pickup.body));
  const jobId = pickup.body.jobs[0].id;

  const jobRow = await testPrisma.job.findUnique({ where: { id: jobId } });
  assert.equal(jobRow.status, "UNSCHEDULED");
  assert.equal(jobRow.complaintCaseId, caseId);

  // GET /armada/jobs TANPA filter apa pun ("Semua waktu") — job ini WAJIB
  // ada di hasil, TIDAK boleh disaring diam-diam sebagai "job basi".
  const list = await dispatcher.api.get("/api/armada/jobs");
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const found = (list.body.jobs || []).find((j) => j.id === jobId);
  assert.ok(found, "Job dari ComplaintCase HARUS muncul di GET /armada/jobs walau order-nya sudah DELIVERED");
});

test("Edge case: transisi status TIDAK VALID ditolak (BARU langsung ke DALAM_PENANGANAN)", async () => {
  const sales = await clientAs(["SALES"]);
  const { order } = await createTestUnit();
  const create = await sales.api.post("/api/complaints", { orderId: order.id, category: "LAINNYA", description: "Test" });
  const caseId = create.body.id;

  const r = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "DALAM_PENANGANAN" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /tidak bisa langsung menjadi/);
});

test("Edge case: SELESAI tidak bisa dicapai lewat POST /:id/status, wajib lewat confirm-customer", async () => {
  const sales = await clientAs(["SALES"]);
  const { order } = await createTestUnit();
  const create = await sales.api.post("/api/complaints", { orderId: order.id, category: "LAINNYA", description: "Test" });
  const caseId = create.body.id;

  const r = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "SELESAI" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /konfirmasi customer/);
});

test("Edge case: confirm-customer ditolak kalau status belum KONFIRMASI_CUSTOMER", async () => {
  const sales = await clientAs(["SALES"]);
  const { order } = await createTestUnit();
  const create = await sales.api.post("/api/complaints", { orderId: order.id, category: "LAINNYA", description: "Test" });
  const caseId = create.body.id;

  const r = await sales.api.post(`/api/complaints/${caseId}/confirm-customer`, {});
  assert.equal(r.status, 400);
});

test("Edge case: DIBATALKAN wajib alasan", async () => {
  const sales = await clientAs(["SALES"]);
  const { order } = await createTestUnit();
  const create = await sales.api.post("/api/complaints", { orderId: order.id, category: "LAINNYA", description: "Test" });
  const caseId = create.body.id;

  const noReason = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "DIBATALKAN" });
  assert.equal(noReason.status, 400);
  assert.match(noReason.body.error, /Alasan pembatalan wajib/);

  const withReason = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "DIBATALKAN", note: "Customer batal komplain" });
  assert.equal(withReason.status, 200, JSON.stringify(withReason.body));
  assert.equal(withReason.body.cancelReason, "Customer batal komplain");
});

test("Edge case: PATCH /:id menolak body yang berisi status/currentOwner", async () => {
  const sales = await clientAs(["SALES"]);
  const { order } = await createTestUnit();
  const create = await sales.api.post("/api/complaints", { orderId: order.id, category: "LAINNYA", description: "Test" });
  const caseId = create.body.id;

  const r = await sales.api.patch(`/api/complaints/${caseId}`, { status: "VERIFIKASI", rootCause: "harusnya ini tetap ditolak" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /POST \/:id\/status/);
});

test("Edge case: unit yang dipilih harus benar-benar bagian dari order yang sama", async () => {
  const sales = await clientAs(["SALES"]);
  const { order: order1 } = await createTestUnit();
  const { unit: unitDariOrderLain } = await createTestUnit();

  const r = await sales.api.post("/api/complaints", {
    orderId: order1.id, unitId: unitDariOrderLain.id, category: "LAINNYA", description: "Test",
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /bukan bagian dari order ini/);
});

test("Edge case: deskripsi keluhan wajib diisi", async () => {
  const sales = await clientAs(["SALES"]);
  const { order } = await createTestUnit();
  const r = await sales.api.post("/api/complaints", { orderId: order.id, category: "LAINNYA", description: "   " });
  assert.equal(r.status, 400);
});

test("Edge case: role TANPA COMPLAINT_WRITE (DRIVER) tidak bisa membuka kasus", async () => {
  const driver = await clientAs(["DRIVER"]);
  const { order } = await createTestUnit();
  const r = await driver.api.post("/api/complaints", { orderId: order.id, category: "LAINNYA", description: "Test" });
  assert.equal(r.status, 403);
});

test("Edge case: COMPLAINT_WRITE BUKAN pintu belakang ke aksi divisi lain — Sales tanpa JOB_WRITE ditolak bikin Delivery Task", async () => {
  const sales = await clientAs(["SALES"]);
  const { order } = await createTestUnit();
  const create = await sales.api.post("/api/complaints", { orderId: order.id, category: "LAINNYA", description: "Test" });
  const caseId = create.body.id;

  const r = await sales.api.post(`/api/complaints/${caseId}/delivery-task`, { jobType: "PICKUP" });
  assert.equal(r.status, 403, "SALES punya COMPLAINT_WRITE tapi TIDAK punya JOB_WRITE — harus ditolak");
});

test("Edge case: kategori tidak valid ditolak", async () => {
  const sales = await clientAs(["SALES"]);
  const { order } = await createTestUnit();
  const r = await sales.api.post("/api/complaints", { orderId: order.id, category: "BUKAN_KATEGORI_VALID", description: "Test" });
  assert.equal(r.status, 400);
});

test("Edge case: order tidak ditemukan -> 404", async () => {
  const sales = await clientAs(["SALES"]);
  const r = await sales.api.post("/api/complaints", { orderId: "00000000-0000-0000-0000-000000000000", category: "LAINNYA", description: "Test" });
  assert.equal(r.status, 404);
});

// ─── GERBANG REDELIVERY (31 Oktober 2026, insiden Sony RES-27082026-183) ──
// Kronologi nyata yang direplikasi di tes-tes ini: ADMIN mendorong kasus
// sampai DIKIRIM_ULANG, job DELIVERY baru lahir ASSIGNED ke driver, lalu
// 27 MENIT KEMUDIAN kasus didorong manual ke KONFIRMASI_CUSTOMER lalu
// SELESAI lewat POST /:id/status + /confirm-customer — TANPA job itu
// pernah COMPLETED. Job pengiriman ulang nyangkut di tab Aktif driver
// selamanya sementara kasus sudah bilang "selesai". Lihat laporan audit
// + assertRedeliveryCompleted di services/complaintCase.js.

test("Gerbang redelivery — bypass transisi langsung: job masih ASSIGNED, POST /:id/status ke KONFIRMASI_CUSTOMER ditolak 409", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const { caseId, deliveryJobId } = await setupKasusMenujuDikirimUlang(sales, dispatcher);

  await testPrisma.job.update({ where: { id: deliveryJobId }, data: { status: "ASSIGNED" } });

  const r = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "KONFIRMASI_CUSTOMER" });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /belum tuntas/);
  assert.match(r.body.error, /Ditugaskan/);

  const caseRow = await testPrisma.complaintCase.findUnique({ where: { id: caseId } });
  assert.equal(caseRow.status, "DIKIRIM_ULANG", "status TIDAK boleh berubah kalau gerbang menolak");
});

test("Gerbang redelivery: EN_ROUTE dan ARRIVED juga ditolak (masih dalam perjalanan, belum sampai)", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);

  for (const status of ["EN_ROUTE", "ARRIVED"]) {
    const { caseId, deliveryJobId } = await setupKasusMenujuDikirimUlang(sales, dispatcher);
    await testPrisma.job.update({ where: { id: deliveryJobId }, data: { status } });
    const r = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "KONFIRMASI_CUSTOMER" });
    assert.equal(r.status, 409, `status job ${status} seharusnya masih diblokir: ${JSON.stringify(r.body)}`);
  }
});

test("Gerbang redelivery: job FAILED (gagal kirim) tetap ditolak -- gagal BUKAN selesai", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const { caseId, deliveryJobId } = await setupKasusMenujuDikirimUlang(sales, dispatcher);

  await testPrisma.job.update({
    where: { id: deliveryJobId },
    data: { status: "FAILED", failureReason: "Alamat tidak ditemukan", failurePhotoUrls: ["/media/job-photos/fail.jpg"] },
  });

  const r = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "KONFIRMASI_CUSTOMER" });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /Gagal/);
});

test("Gerbang redelivery: job COMPLETED tapi proofPhotoUrls KOSONG (data lama/legacy) tetap ditolak", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const { caseId, deliveryJobId } = await setupKasusMenujuDikirimUlang(sales, dispatcher);

  await testPrisma.job.update({
    where: { id: deliveryJobId },
    data: { status: "COMPLETED", completedAt: new Date(), proofPhotoUrls: [] },
  });

  const r = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "KONFIRMASI_CUSTOMER" });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /tanpa bukti/);
});

test("Gerbang redelivery: job DELIVERY LAMA yang tidak terkait komplain ini (complaintCaseId null) TIDAK dipakai sebagai bukti", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const { order, unit } = await createTestUnit();

  // Job pengiriman ORIGINAL (bukan dari komplain) sudah COMPLETED+POD duluan
  // -- persis pola Order.status DELIVERED dari pengiriman asli yang TIDAK
  // boleh dipakai sebagai bukti redelivery (rule 3 instruksi).
  await testPrisma.job.create({
    data: { type: "DELIVERY", orderId: order.id, status: "COMPLETED", completedAt: new Date(), proofPhotoUrls: ["/media/job-photos/original.jpg"] },
  });

  const create = await sales.api.post("/api/complaints", { orderId: order.id, unitId: unit.id, category: "KENYAMANAN", description: "Test" });
  const caseId = create.body.id;
  await sales.api.post(`/api/complaints/${caseId}/status`, { status: "VERIFIKASI" });
  await sales.api.post(`/api/complaints/${caseId}/status`, { status: "ACTION_REQUIRED" });
  await sales.api.post(`/api/complaints/${caseId}/status`, { status: "SIAP_DIKIRIM" });
  await dispatcher.api.post(`/api/complaints/${caseId}/delivery-task`, { jobType: "DELIVERY" });
  // Job redelivery BARU sengaja tidak disentuh -- masih UNSCHEDULED, 0 bukti.

  const r = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "KONFIRMASI_CUSTOMER" });
  assert.equal(r.status, 409, "job lama yang tidak terkait kasus ini tidak boleh ikut dihitung sebagai bukti redelivery");
});

test("Gerbang redelivery: status Route (termasuk COMPLETED) TIDAK relevan -- yang diperiksa status Job itu sendiri", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const { caseId, deliveryJobId } = await setupKasusMenujuDikirimUlang(sales, dispatcher);

  const route = await testPrisma.route.create({ data: { code: `RTE-TEST-${Date.now()}`, date: new Date("2026-09-01"), status: "COMPLETED" } });
  await testPrisma.job.update({
    where: { id: deliveryJobId },
    data: { status: "COMPLETED", completedAt: new Date(), proofPhotoUrls: ["/media/job-photos/ok.jpg"], routeId: route.id },
  });

  const r = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "KONFIRMASI_CUSTOMER" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test("Gerbang redelivery -- defense in depth: confirmCustomer tetap menolak walau status dipaksa KONFIRMASI_CUSTOMER lewat jalur lain", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const { caseId, deliveryJobId } = await setupKasusMenujuDikirimUlang(sales, dispatcher);
  await testPrisma.job.update({ where: { id: deliveryJobId }, data: { status: "ASSIGNED" } });

  // Simulasikan status kasus sudah KONFIRMASI_CUSTOMER lewat jalur di luar
  // transitionStatus (migrasi data/skrip lama) -- transitionStatus BUKAN
  // satu-satunya penjaga, confirmCustomer wajib cek lagi sendiri.
  await testPrisma.complaintCase.update({ where: { id: caseId }, data: { status: "KONFIRMASI_CUSTOMER" } });

  const r = await sales.api.post(`/api/complaints/${caseId}/confirm-customer`, {});
  assert.equal(r.status, 409, JSON.stringify(r.body));

  const caseRow = await testPrisma.complaintCase.findUnique({ where: { id: caseId } });
  assert.equal(caseRow.status, "KONFIRMASI_CUSTOMER", "TIDAK boleh ikut naik ke SELESAI");
  assert.equal(caseRow.customerConfirmedAt, null);
});

test("Redelivery sukses + retry/double-click: job complete -> auto-advance -> confirm-customer SELESAI; panggilan kedua gagal bersih tanpa menimpa data", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const { caseId, deliveryJobId } = await setupKasusMenujuDikirimUlang(sales, dispatcher);

  await dispatcher.api.patch(`/api/armada/jobs/${deliveryJobId}`, { scheduledDate: "2026-09-13" });
  const complete = await dispatcher.api.post(`/api/armada/jobs/${deliveryJobId}/complete`, { proofPhotoUrls: ["/media/job-photos/ok.jpg"] });
  assert.equal(complete.status, 200, JSON.stringify(complete.body));

  const afterComplete = await sales.api.get(`/api/complaints/${caseId}`);
  assert.equal(afterComplete.body.status, "KONFIRMASI_CUSTOMER", "job tuntas+POD -> auto-advance, gerbang otomatis terpenuhi");

  const first = await sales.api.post(`/api/complaints/${caseId}/confirm-customer`, {});
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.status, "SELESAI");
  const firstConfirmedAt = first.body.customerConfirmedAt;

  const second = await sales.api.post(`/api/complaints/${caseId}/confirm-customer`, {});
  assert.equal(second.status, 400, JSON.stringify(second.body));

  const caseRow = await testPrisma.complaintCase.findUnique({ where: { id: caseId } });
  assert.equal(caseRow.customerConfirmedAt.toISOString(), new Date(firstConfirmedAt).toISOString(), "retry TIDAK boleh menimpa timestamp konfirmasi pertama");
});

test("waive-redelivery: alasan wajib, lalu melewati gerbang dengan audit trail -- jalur resolusi tanpa pengiriman ulang fisik", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const { caseId, deliveryJobId } = await setupKasusMenujuDikirimUlang(sales, dispatcher);

  const blocked = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "KONFIRMASI_CUSTOMER" });
  assert.equal(blocked.status, 409);

  const noReason = await sales.api.post(`/api/complaints/${caseId}/waive-redelivery`, {});
  assert.equal(noReason.status, 400);

  const waive = await sales.api.post(`/api/complaints/${caseId}/waive-redelivery`, {
    reason: "Customer pilih refund, redelivery dibatalkan",
  });
  assert.equal(waive.status, 200, JSON.stringify(waive.body));
  assert.ok(waive.body.redeliveryWaivedAt);
  assert.equal(waive.body.redeliveryWaivedReason, "Customer pilih refund, redelivery dibatalkan");
  assert.equal(waive.body.redeliveryWaivedBy.id, sales.user.id);

  const advance = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "KONFIRMASI_CUSTOMER" });
  assert.equal(advance.status, 200, JSON.stringify(advance.body));

  const confirm = await sales.api.post(`/api/complaints/${caseId}/confirm-customer`, {});
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  assert.equal(confirm.body.status, "SELESAI");

  // Job itu sendiri TIDAK ikut berubah -- waive hanya membuka gerbang, bukan
  // berpura-pura job sudah dikerjakan.
  const jobRow = await testPrisma.job.findUnique({ where: { id: deliveryJobId } });
  assert.equal(jobRow.status, "UNSCHEDULED");

  const timeline = await sales.api.get(`/api/activity?entityType=complaint&entityId=${caseId}`);
  assert.ok(timeline.body.events.some((e) => e.eventType === "COMPLAINT_REDELIVERY_WAIVED"));
});

test("waive-redelivery: tidak relevan di status yang belum pernah ada rencana redelivery", async () => {
  const sales = await clientAs(["SALES"]);
  const { order } = await createTestUnit();
  const create = await sales.api.post("/api/complaints", { orderId: order.id, category: "LAINNYA", description: "Test" });
  const r = await sales.api.post(`/api/complaints/${create.body.id}/waive-redelivery`, { reason: "Tidak relevan" });
  assert.equal(r.status, 400);
});

test("Pembatalan komplain TIDAK menyentuh Job/POD terkait -- tidak membatalkan job berjalan diam-diam (rule pembatalan existing)", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const { caseId, deliveryJobId } = await setupKasusMenujuDikirimUlang(sales, dispatcher);
  await testPrisma.job.update({ where: { id: deliveryJobId }, data: { status: "EN_ROUTE" } });

  const cancel = await sales.api.post(`/api/complaints/${caseId}/status`, { status: "DIBATALKAN", note: "Customer menarik komplain" });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));

  const jobRow = await testPrisma.job.findUnique({ where: { id: deliveryJobId } });
  assert.equal(jobRow.status, "EN_ROUTE", "job yang sedang berjalan TIDAK boleh ikut dibatalkan diam-diam oleh pembatalan komplain");
  assert.equal(jobRow.proofPhotoUrls.length, 0);
});

test("createDeliveryTask: job redelivery lahir TANPA route (biarkan belum terjadwal, bukan menempel diam-diam)", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const { deliveryJobId } = await setupKasusMenujuDikirimUlang(sales, dispatcher);
  const jobRow = await testPrisma.job.findUnique({ where: { id: deliveryJobId } });
  assert.equal(jobRow.routeId, null);
  assert.equal(jobRow.status, "UNSCHEDULED");
});

test("PATCH /routes/:id/jobs menolak menempel job redelivery komplain yang BELUM tuntas ke rute yang sudah Selesai", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const admin = await clientAs(["ADMIN"]);
  const { deliveryJobId } = await setupKasusMenujuDikirimUlang(sales, dispatcher);

  const route = await testPrisma.route.create({ data: { code: `RTE-DONE-${Date.now()}`, date: new Date("2026-09-01"), status: "COMPLETED" } });

  const r = await admin.api.patch(`/api/armada/routes/${route.id}/jobs`, { jobIds: [deliveryJobId], reason: "Tambahkan stop ketinggalan" });
  assert.equal(r.status, 409, JSON.stringify(r.body));

  const jobRow = await testPrisma.job.findUnique({ where: { id: deliveryJobId } });
  assert.equal(jobRow.routeId, null, "job TIDAK boleh ikut tertempel walau request ditolak");
});

test("PATCH /routes/:id/jobs menolak menempel job redelivery komplain ke rute yang Dibatalkan (guard generik yang SUDAH ada, bukan admin-override)", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const admin = await clientAs(["ADMIN"]);
  const { deliveryJobId } = await setupKasusMenujuDikirimUlang(sales, dispatcher);

  const route = await testPrisma.route.create({ data: { code: `RTE-CANCEL-${Date.now()}`, date: new Date("2026-09-01"), status: "CANCELLED" } });

  // Rute Dibatalkan sudah ditolak oleh guard generik ("route.status !==
  // DRAFT") BUKAN admin override ("stop ketinggalan") -- tidak ada jalur
  // mengubah anggota rute CANCELLED sama sekali, bahkan untuk ADMIN.
  const r = await admin.api.patch(`/api/armada/routes/${route.id}/jobs`, { jobIds: [deliveryJobId], reason: "Coba tempel ke rute batal" });
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.match(r.body.error, /CANCELLED tidak bisa diubah/);

  const jobRow = await testPrisma.job.findUnique({ where: { id: deliveryJobId } });
  assert.equal(jobRow.routeId, null);
});

test("PATCH /routes/:id/jobs TETAP mengizinkan 'stop ketinggalan' biasa (job BUKAN komplain aktif) ke rute Selesai -- fitur lama 8 Sep tidak boleh rusak", async () => {
  const admin = await clientAs(["ADMIN"]);
  const { order } = await createTestUnit();
  const ordinaryJob = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, status: "UNSCHEDULED" } });

  const route = await testPrisma.route.create({ data: { code: `RTE-DONE2-${Date.now()}`, date: new Date("2026-09-01"), status: "COMPLETED" } });

  const r = await admin.api.patch(`/api/armada/routes/${route.id}/jobs`, { jobIds: [ordinaryJob.id], reason: "Tambahkan stop ketinggalan" });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const jobRow = await testPrisma.job.findUnique({ where: { id: ordinaryJob.id } });
  assert.equal(jobRow.routeId, route.id);
});

test("PATCH /routes/:id/jobs TETAP mengizinkan job komplain yang SUDAH tuntas (COMPLETED) ditempel ke rute Selesai -- bookkeeping retroaktif yang sah", async () => {
  const sales = await clientAs(["SALES"]);
  const dispatcher = await clientAs(["DISPATCHER"]);
  const admin = await clientAs(["ADMIN"]);
  const { deliveryJobId } = await setupKasusMenujuDikirimUlang(sales, dispatcher);
  await testPrisma.job.update({
    where: { id: deliveryJobId },
    data: { status: "COMPLETED", completedAt: new Date(), proofPhotoUrls: ["/media/job-photos/ok.jpg"] },
  });

  const route = await testPrisma.route.create({ data: { code: `RTE-DONE3-${Date.now()}`, date: new Date("2026-09-01"), status: "COMPLETED" } });

  const r = await admin.api.patch(`/api/armada/routes/${route.id}/jobs`, { jobIds: [deliveryJobId], reason: "Catat retroaktif" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
