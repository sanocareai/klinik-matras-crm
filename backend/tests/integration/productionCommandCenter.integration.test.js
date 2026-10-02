// P9B — Command Center: GET /api/production-v2/command-center. Fokus: gerbang cohort/reader, konsistensi KPI vs daftar
// detail (SATU sumber data), gating order.value (ORDER_PRICE_READ), dan keamanan unit warisan OFFERED tanpa Run.
// Pemetaan kolom pipeline (Fondasi/Lapisan/Uji Tekstur/QC/Corner) SUDAH diuji tuntas murni (tests/productionExperience.test.js,
// commandCenterColumn) — file ini TIDAK mengulang kombinasi itu, fokus ke wiring DB + konsistensi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { todayWib } from "../../src/lib/domain/productionBoard.js";

let server;
let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (v) => ({ "Idempotency-Key": `p9b-cc-${v}-0001` });
const CC = "/api/production-v2/command-center";
// "Hari ini" mengikuti jam WIB SESUNGGUHNYA (sama seperti getProductionCommandCenter, yang selalu memakai now=new Date()
// tanpa override dari klien) — kalau dites di sekitar tengah malam WIB, DATE tetap konsisten dengan definisi "today" di
// server pada saat request GET dikirim (tidak mungkin drift di dalam satu run test yang berjalan hitungan detik).
const DATE = todayWib();

async function setFlag(flagKey, unitIds) {
  const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "p9b command-center test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
async function setCohort(...unitIds) {
  for (const flagKey of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(flagKey, unitIds);
}

async function world() {
  const [lead, admin, wh, driver] = await Promise.all([
    createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["ADMIN"] }),
    createTestUser({ roles: ["WAREHOUSE"] }), createTestUser({ roles: ["DRIVER"] }),
  ]);
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-CC-${++seq}`, name: "Workshop CC" } });
  const operator = await testPrisma.productionOperator.create({ data: { userId: lead.user.id, primaryWorkCenterId: workCenter.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-CC-${++seq}`, name: "Gudang CC" } });
  const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-CC-${++seq}` } });
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  return { lead: c(lead), admin: c(admin), wh: c(wh), driver: c(driver), wc: workCenter.id, operator, rcv };
}

async function orderWithUnit(w, { weightKg = 70 } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan CC ${++seq}`, city: "Bandung" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `CC-${++seq}`, value: 4_500_000, category: "LAYANAN", beratBadan: weightKg } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-CC-${++seq}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP" } });
  return { customer, order, unit };
}

async function jobFor(w, { orderId, unitId, type = "PICKUP" }) {
  const route = await testPrisma.route.create({ data: { code: `CC-RTE-${++seq}`, date: new Date("2026-09-29T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
  const job = await testPrisma.job.create({ data: { type, orderId, routeId: route.id, driverId: w.driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-09-29T00:00:00.000Z") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId } });
  return job;
}

async function completePickup(w, job, tag) {
  await w.driver.api.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}-s`));
  await w.driver.api.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${tag}-a`));
  return w.driver.api.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga", note: "ok", location: null }, key(`${tag}-c`));
}

async function planOnBoard(w, runId, { productionDate = DATE, tag = `plan-${++seq}` } = {}) {
  const res = await w.lead.api.post("/api/production-v2/plans", {
    runId, productionDate, stationCode: "TABLE_1", priority: 0, workCenterId: w.wc, operatorId: w.operator.id,
  }, key(tag));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

test("reader OFF: command-center inert (bukan error), semua daftar kosong", async () => {
  const w = await world();
  const { order, unit } = await orderWithUnit(w);
  await jobFor(w, { orderId: order.id, unitId: unit.id });
  const res = await w.lead.api.get(CC);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.readerMode, "OFF");
  assert.deepEqual(res.body.columns, []);
  assert.deepEqual(res.body.attention, []);
});

test("unit di luar cohort tidak muncul di KPI, kolom, attention, maupun akan-masuk", async () => {
  const w = await world();
  const { order: orderA, unit: unitA } = await orderWithUnit(w);
  const { order: orderB, unit: unitB } = await orderWithUnit(w); // TIDAK dimasukkan cohort
  await setCohort(unitA.id);
  const jobA = await jobFor(w, { orderId: orderA.id, unitId: unitA.id });
  await jobFor(w, { orderId: orderB.id, unitId: unitB.id }); // akan-masuk unit B — harus TIDAK muncul
  assert.equal((await completePickup(w, jobA, "cohort-a")).status, 200);

  const res = await w.lead.api.get(CC);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.readerMode, "COHORT");
  const dalamPerjalanan = res.body.columns.find((c) => c.key === "DALAM_PERJALANAN");
  assert.equal(dalamPerjalanan.items.length, 1);
  assert.equal(dalamPerjalanan.items[0].unit.unitCode, unitA.unitCode);
  const akanMasuk = res.body.columns.find((c) => c.key === "AKAN_MASUK");
  assert.equal(akanMasuk.items.length, 0, "unit B (non-cohort) tidak boleh muncul di Akan Masuk");
});

test("KPI = panjang daftar detail yang SAMA dikirim ke klien (Dalam Perjalanan, Tiba/Belum Mulai, Dijadwalkan hari ini, Akan Masuk, Sedang Dikerjakan)", async () => {
  const w = await world();
  // Unit 1: pickup sukses, TIDAK dijadwalkan, run masih PENDING_ARRIVAL -> kolom Dalam Perjalanan (keadaan fisik,
  // bukan status jadwal, yang menentukan kolom sejak P9B.1).
  const u1 = await orderWithUnit(w);
  await setCohort(u1.unit.id);
  const j1 = await jobFor(w, { orderId: u1.order.id, unitId: u1.unit.id });
  assert.equal((await completePickup(w, j1, "u1")).status, 200);
  const run1 = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: u1.unit.id } });

  // Unit 2: pickup sukses + dijadwalkan hari ini (DATE) SEBELUM tiba (masih PENDING_ARRIVAL) -> TETAP kolom Dalam
  // Perjalanan (P9B.1: sudah dijadwalkan tidak lagi memindahkan kartu ke kolom lain) + attention TARGET_BELUM_MULAI.
  const u2 = await orderWithUnit(w);
  await setCohort(u1.unit.id, u2.unit.id);
  const j2 = await jobFor(w, { orderId: u2.order.id, unitId: u2.unit.id });
  assert.equal((await completePickup(w, j2, "u2")).status, 200);
  const run2 = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: u2.unit.id } });
  await planOnBoard(w, run2.id, { productionDate: DATE, tag: "u2-plan" });

  // Unit 3: pickup sukses, custody DITERIMA manual (run ACTIVE), dijadwalkan + tahap 1 DIMULAI -> Sedang Dikerjakan.
  const u3 = await orderWithUnit(w);
  await setCohort(u1.unit.id, u2.unit.id, u3.unit.id);
  const j3 = await jobFor(w, { orderId: u3.order.id, unitId: u3.unit.id });
  assert.equal((await completePickup(w, j3, "u3")).status, 200);
  const handoff3 = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: u3.unit.id, direction: "INBOUND" } });
  const accepted3 = await w.wh.api.post(`/api/inventory/unit-custody/${handoff3.id}/accept`, { locationId: w.rcv.id, expectedRevision: 1 }, key("u3-accept"));
  assert.equal(accepted3.status, 200, JSON.stringify(accepted3.body));
  const run3 = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: accepted3.body.productionRunId } });
  await planOnBoard(w, run3.id, { productionDate: DATE, tag: "u3-plan" });
  // Mulai tahap via mesin stage P5 (bukan lapisan bukti P8 — tidak butuh media) — cukup untuk activeOp.status=ACTIVE.
  const start3 = await w.lead.api.post(`/api/production-planning/workshop/runs/${run3.id}/start`, {
    expectedRevision: run3.revision, workCenterId: w.wc,
  }, key("u3-step1"));
  assert.equal(start3.status, 200, JSON.stringify(start3.body));

  // Unit 4: belum pickup — pickup TERJADWAL tapi belum selesai -> Akan Masuk.
  const u4 = await orderWithUnit(w);
  await setCohort(u1.unit.id, u2.unit.id, u3.unit.id, u4.unit.id);
  await jobFor(w, { orderId: u4.order.id, unitId: u4.unit.id });

  const res = await w.lead.api.get(CC);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const col = Object.fromEntries(res.body.columns.map((c) => [c.key, c]));

  assert.equal(col.AKAN_MASUK.count, col.AKAN_MASUK.items.length);
  assert.equal(col.AKAN_MASUK.items.length, 1);
  assert.equal(col.AKAN_MASUK.items[0].unit.unitCode, u4.unit.unitCode);
  assert.equal(res.body.kpi.akanMasuk, col.AKAN_MASUK.items.length);

  assert.equal(col.DALAM_PERJALANAN.count, col.DALAM_PERJALANAN.items.length);
  assert.ok(col.DALAM_PERJALANAN.items.some((i) => i.unit.unitCode === u1.unit.unitCode), "u1 belum tiba, belum dijadwalkan -> Dalam Perjalanan");
  assert.ok(col.DALAM_PERJALANAN.items.some((i) => i.unit.unitCode === u2.unit.unitCode), "u2 sudah dijadwalkan TAPI belum tiba -> tetap Dalam Perjalanan (jadwal cuma badge, P9B.1)");
  assert.equal(res.body.kpi.belumDijadwalkan, 1, "hanya u1 yang benar-benar belum punya plan sama sekali (u2 sudah dijadwalkan)");

  assert.equal(col.TIBA_BELUM_MULAI.count, col.TIBA_BELUM_MULAI.items.length);
  assert.ok(col.BONGKAR.items.some((i) => i.unit.unitCode === u3.unit.unitCode), "u3 sudah tiba (custody ACCEPTED) DAN sudah mulai -> Tahap Bongkar (revisi stage 2 Okt 2026)");
  assert.ok(!col.TIBA_BELUM_MULAI.items.some((i) => i.unit.unitCode === u3.unit.unitCode), "u3 sudah mulai -> bukan lagi Tiba/Belum Mulai");
  assert.ok(!col.TIBA_BELUM_MULAI.items.some((i) => i.unit.unitCode === u2.unit.unitCode), "u2 belum tiba -> TIDAK boleh muncul di Tiba/Belum Mulai walau sudah dijadwalkan");
  assert.equal(res.body.kpi.dijadwalkanHariIni, 2, "u2 dan u3 sama-sama punya plan.productionDate=hari ini, terlepas dari kolomnya masing-masing");

  assert.equal(res.body.kpi.sedangDikerjakan, 1, "hanya u3 yang punya operasi ACTIVE");

  const attentionCodes = (unitCode) => res.body.attention.filter((a) => a.unitCode === unitCode).map((a) => a.code);
  assert.ok(attentionCodes(u2.unit.unitCode).includes("TARGET_BELUM_MULAI"), "u2 target hari ini, belum ada bukti tahap sama sekali");
  assert.ok(!attentionCodes(u3.unit.unitCode).includes("TARGET_BELUM_MULAI"), "u3 sudah mulai, tidak boleh muncul sebagai belum mulai");

  assert.equal(res.body.kpi.target, 12, "target harian default BOARD_DEFAULTS");
  assert.equal(res.body.kpi.selesaiHariIni, res.body.completedToday.length);
  assert.equal(res.body.kpi.sisaPekerjaan, res.body.kpi.target - res.body.kpi.selesaiHariIni);
});

test("order.value HANYA terkirim untuk role dengan ORDER_PRICE_READ (ADMIN) — TIDAK ada untuk PRODUCTION_LEAD", async () => {
  const w = await world();
  const u = await orderWithUnit(w, { weightKg: 65 });
  await setCohort(u.unit.id);
  const job = await jobFor(w, { orderId: u.order.id, unitId: u.unit.id });
  assert.equal((await completePickup(w, job, "value")).status, 200);

  const asAdmin = await w.admin.api.get(CC);
  assert.equal(asAdmin.status, 200, JSON.stringify(asAdmin.body));
  assert.equal(asAdmin.body.canSeeValue, true);
  const adminCol = asAdmin.body.columns.find((c) => c.key === "DALAM_PERJALANAN");
  const adminItem = adminCol.items.find((i) => i.unit.unitCode === u.unit.unitCode);
  assert.equal(adminItem.orderValue, 4_500_000);

  const asLead = await w.lead.api.get(CC);
  assert.equal(asLead.status, 200, JSON.stringify(asLead.body));
  assert.equal(asLead.body.canSeeValue, false);
  const leadCol = asLead.body.columns.find((c) => c.key === "DALAM_PERJALANAN");
  const leadItem = leadCol.items.find((i) => i.unit.unitCode === u.unit.unitCode);
  assert.equal(leadItem.orderValue, undefined, "field TIDAK boleh ada sama sekali untuk role tanpa ORDER_PRICE_READ");
  assert.equal(JSON.stringify(asLead.body).includes("4500000"), false, "nilai order tidak boleh bocor di respons sama sekali");
});

test("P9 UX: layanan yang DIPESAN di Sales (nama saja) tampil di kartu Akan Masuk & kartu Run — harga item TIDAK bocor ke role tanpa ORDER_PRICE_READ", async () => {
  const w = await world();
  const u = await orderWithUnit(w, { weightKg: 70 });
  await testPrisma.orderItem.createMany({ data: [{ orderId: u.order.id, layananName: "Paket Upgrade Fondasi + Lapisan MS", harga: 3_690_001, sortOrder: 0 }, { orderId: u.order.id, layananName: "Tambah Busa", harga: 777_002, sortOrder: 1 }] });
  await setCohort(u.unit.id);
  const job = await jobFor(w, { orderId: u.order.id, unitId: u.unit.id });

  const before = await w.lead.api.get(CC); // pickup belum selesai -> kartu Akan Masuk
  const upcoming = before.body.columns.find((c) => c.key === "AKAN_MASUK").items.find((i) => i.unit.unitCode === u.unit.unitCode);
  assert.deepEqual(upcoming.customer.salesServices, ["Paket Upgrade Fondasi + Lapisan MS", "Tambah Busa"]);

  assert.equal((await completePickup(w, job, "svc")).status, 200);
  const after = await w.lead.api.get(CC);
  const item = after.body.columns.find((c) => c.key === "DALAM_PERJALANAN").items.find((i) => i.unit.unitCode === u.unit.unitCode);
  assert.deepEqual(item.customer.salesServices, ["Paket Upgrade Fondasi + Lapisan MS", "Tambah Busa"]);
  const raw = JSON.stringify(after.body) + JSON.stringify(before.body);
  assert.equal(raw.includes("3690001") || raw.includes("777002"), false, "harga item order tidak boleh ada di respons PRODUCTION_LEAD");
});

test("data Sales belum lengkap (berat badan kosong) -> attention DATA_SALES_BELUM_LENGKAP", async () => {
  const w = await world();
  const u = await orderWithUnit(w, { weightKg: null });
  await setCohort(u.unit.id);
  const job = await jobFor(w, { orderId: u.order.id, unitId: u.unit.id });
  assert.equal((await completePickup(w, job, "noweight")).status, 200);
  const res = await w.lead.api.get(CC);
  const codes = res.body.attention.filter((a) => a.unitCode === u.unit.unitCode).map((a) => a.code);
  assert.ok(codes.includes("DATA_SALES_BELUM_LENGKAP"));
});

test("unit warisan OFFERED tanpa Production Run sama sekali tampil di Dalam Perjalanan TANPA mutasi", async () => {
  const w = await world();
  const u = await orderWithUnit(w);
  await testPrisma.orderItem.create({ data: { orderId: u.order.id, layananName: "Paket Warisan", harga: 123456, sortOrder: 0 } });
  await setCohort(u.unit.id);
  const job = await jobFor(w, { orderId: u.order.id, unitId: u.unit.id });
  const handoff = await testPrisma.unitCustodyHandoff.create({ data: { unitId: u.unit.id, deliveryJobId: job.id, direction: "INBOUND", status: "OFFERED", revision: 1 } });

  assert.equal(await testPrisma.productionRun.count({ where: { unitId: u.unit.id } }), 0);
  const res = await w.lead.api.get(CC);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const dalamPerjalanan = res.body.columns.find((c) => c.key === "DALAM_PERJALANAN");
  const item = dalamPerjalanan.items.find((i) => i.unit.unitCode === u.unit.unitCode);
  assert.ok(item, "unit warisan tanpa run harus tetap tampil di Dalam Perjalanan (P9B.1: kolom 'Belum Dijadwalkan' sudah dihapus)");
  assert.equal(item.kind, "AWAITING_ARRIVAL_LEGACY");
  assert.ok(res.body.kpi.dalamPerjalanan >= 1);
  // Kontrak layanan: kartu warisan membawa pelanggan + Layanan DIPESAN Sales (nama saja); harga item tidak bocor.
  assert.ok(item.customer?.name, "kartu warisan harus membawa nama pelanggan");
  assert.deepEqual(item.customer.salesServices, ["Paket Warisan"]);
  assert.equal(JSON.stringify(res.body).includes("123456"), false, "harga item order tidak boleh bocor ke PRODUCTION_LEAD");

  const rowAfter = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: handoff.id } });
  assert.equal(rowAfter.status, "OFFERED");
  assert.equal(rowAfter.revision, 1);
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: u.unit.id } }), 0, "GET command-center tidak boleh membuat run apa pun");
});
