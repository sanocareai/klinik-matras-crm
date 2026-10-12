// Milestone Fase 2 — status global tingkat ORDER di API (orders, customer, pipeline, jobs armada, MCP-shape), antrean Gudang, Unit 360 + KPI waktu alur.
// Semua dari bukti yang tercatat; tidak ada tulis oleh pembacaan; status pembayaran tidak memengaruhi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { loadOrderMilestones } from "../../src/services/orderMilestoneService.js";
import { loadWorkshopTimelines } from "../../src/services/workshopTimelineService.js";

let server; let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function users() {
  const [admin, lead, wh, sales] = await Promise.all(["ADMIN", "PRODUCTION_LEAD", "WAREHOUSE", "SALES"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  return { admin: c(admin), lead: c(lead), wh: c(wh), sales: c(sales) };
}
async function mkOrder({ status = "PROCESSING", paymentStatus = "BELUM_BAYAR", name = null } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: name || `Pelanggan F2 ${++seq}`, pipelineStage: "TRANSACTION" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `F2-${++seq}`, value: 1_000_000, category: "LAYANAN", status, paymentStatus } });
  return { customer, order };
}
const mkUnit = (order, status, extra = {}) => testPrisma.unit.create({ data: { unitCode: `F2-U${++seq}`, orderId: order.id, seq, status, merk: "Serta", ukuran: "160x200", ...extra } });
// INBOUND wajib terikat Job pickup (constraint DB job_by_direction) -> buat job pickup selesai + handoff.
async function inbound(unit, status = "ACCEPTED", at = new Date("2026-10-12T02:00:00Z")) {
  const route = await testPrisma.route.create({ data: { code: `F2-RTE-${++seq}`, date: new Date("2026-10-12T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date() } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: unit.orderId, routeId: route.id, status: "COMPLETED", sequence: 1, completedAt: at } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  return testPrisma.unitCustodyHandoff.create({ data: { unitId: unit.id, deliveryJobId: job.id, direction: "INBOUND", status, revision: status === "ACCEPTED" ? 2 : 1, offeredAt: at, ...(status === "ACCEPTED" ? { acceptedAt: at } : {}) } });
}
const accepted = (unit, at) => inbound(unit, "ACCEPTED", at);
const orderRow = async (api, id) => (await api.get("/api/orders?limit=500")).body.items.find((o) => o.id === id);

test("order multi-unit: status unit tertinggal + rincian; unit batal tidak ikut; Siap Kirim/Terkirim tidak tampil selagi ada unit tertinggal; pembayaran tidak memengaruhi", async () => {
  const w = await users();
  // A: 2 unit Diterima di Workshop (custody) + 1 Diproses + 1 batal
  const A = await mkOrder({ paymentStatus: "BELUM_BAYAR" });
  const a1 = await mkUnit(A.order, "RECEIVED"); await accepted(a1);
  const a2 = await mkUnit(A.order, "RECEIVED"); await accepted(a2);
  await mkUnit(A.order, "IN_PRODUCTION");
  await mkUnit(A.order, "CANCELLED");
  // B: satu Terkirim, satu masih Diproses -> order Diproses (bukan Terkirim)
  const B = await mkOrder({ status: "PROCESSING", paymentStatus: "LUNAS" });
  await mkUnit(B.order, "DELIVERED"); await mkUnit(B.order, "IN_PRODUCTION");
  // C: semua Terkirim
  const C = await mkOrder({ status: "DELIVERED" });
  await mkUnit(C.order, "DELIVERED"); await mkUnit(C.order, "DELIVERED");
  // D: pickup selesai tanpa bukti terima (RECEIVED tersimpan) -> Pengambilan
  const D = await mkOrder(); await mkUnit(D.order, "RECEIVED");
  // E: order tanpa unit -> legacy (tidak dikarang)
  const E = await mkOrder({ status: "PROCESSING" });
  const before = JSON.stringify(await testPrisma.unit.findMany({ select: { unitCode: true, status: true }, orderBy: { unitCode: "asc" } }));
  const ra = await orderRow(w.admin.api, A.order.id).then((o) => o.milestone);
  assert.equal(ra.key, "DITERIMA_WORKSHOP"); assert.equal(ra.total, 3); assert.equal(ra.cancelled, 1); assert.equal(ra.mixed, true);
  assert.equal(ra.summary, "Diterima di Workshop · 2 dari 3 unit"); assert.equal(ra.aheadText, "1 unit Diproses");
  assert.equal((await orderRow(w.admin.api, A.order.id)).status, "PROCESSING", "field status lama tetap");
  const rb = (await orderRow(w.admin.api, B.order.id)).milestone;
  assert.equal(rb.key, "DIPROSES"); assert.notEqual(rb.key, "TERKIRIM"); assert.equal(rb.summary, "Diproses · 1 dari 2 unit"); assert.equal(rb.aheadText, "1 unit Terkirim");
  assert.equal((await orderRow(w.admin.api, C.order.id)).milestone.key, "TERKIRIM");
  const rd = (await orderRow(w.admin.api, D.order.id)).milestone; assert.equal(rd.key, "PENGAMBILAN"); assert.equal(rd.legacy, false);
  const re = (await orderRow(w.admin.api, E.order.id)).milestone; assert.equal(re.legacy, true); assert.equal(re.key, null); assert.equal(re.label, "Diproses");
  // pembayaran (BELUM_BAYAR vs LUNAS) tidak mengubah status global
  assert.equal((await orderRow(w.admin.api, A.order.id)).paymentStatus, "BELUM_BAYAR");
  assert.equal(JSON.stringify(await testPrisma.unit.findMany({ select: { unitCode: true, status: true }, orderBy: { unitCode: "asc" } })), before, "membaca tidak mengubah status unit");
});

test("customer detail, papan order Pipeline, dan papan pelanggan membawa milestone yang sama; kolom papan tetap menurut Order.status", async () => {
  const w = await users();
  const A = await mkOrder({ name: "Pelanggan Multi" });
  const a1 = await mkUnit(A.order, "RECEIVED"); await accepted(a1); await mkUnit(A.order, "READY_FOR_DELIVERY");
  // detail pelanggan: router customers tidak dipasang di test app -> kontrak diperiksa lewat service yang sama + pemasangan di sumber
  const ms = (await loadOrderMilestones(testPrisma, [{ id: A.order.id, status: "PROCESSING" }])).get(A.order.id);
  assert.equal(ms.key, "DITERIMA_WORKSHOP"); assert.equal(ms.summary, "Diterima di Workshop · 1 dari 2 unit");
  const src = fs.readFileSync(new URL("../../src/routes/customers.js", import.meta.url), "utf8");
  assert.match(src, /loadOrderMilestones\(prisma, orders\)[\s\S]*o\.milestone = /);
  const board = (await w.admin.api.get("/api/pipeline/order-board")).body;
  const card = board.board.PROCESSING.find((c) => c.id === A.order.id);
  assert.ok(card, "kolom papan = Order.status tersimpan"); assert.equal(card.milestone.key, "DITERIMA_WORKSHOP");
  const kanban = (await w.admin.api.get("/api/pipeline/board")).body;
  const kc = Object.values(kanban).flat().find((c) => c.id === A.customer.id);
  assert.equal(kc.latestOrderStatus, "PROCESSING"); assert.equal(kc.latestOrderMilestone.key, "DITERIMA_WORKSHOP");
});

test("Delivery: daftar job membawa orderMilestone; antrean Gudang membawa status global unit (Pengambilan sampai diterima)", async () => {
  const w = await users();
  const A = await mkOrder({ status: "PICKUP" });
  const u1 = await mkUnit(A.order, "AWAITING_PICKUP");
  const u2 = await mkUnit(A.order, "RECEIVED");
  const route = await testPrisma.route.create({ data: { code: `F2-RTE-${++seq}`, date: new Date("2026-10-12T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date() } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: A.order.id, routeId: route.id, status: "SCHEDULED", sequence: 1, scheduledDate: new Date("2026-10-12T00:00:00.000Z") } });
  await testPrisma.jobUnit.createMany({ data: [{ jobId: job.id, unitId: u1.id }, { jobId: job.id, unitId: u2.id }] });
  const jobs = (await w.admin.api.get("/api/armada/jobs")).body.jobs;
  const j = jobs.find((x) => x.id === job.id);
  assert.equal(j.orderMilestone.key, "MENUNGGU_DIJEMPUT"); assert.equal(j.orderMilestone.summary, "Menunggu Dijemput · 1 dari 2 unit"); assert.equal(j.orderMilestone.aheadText, "1 unit Pengambilan");
  // antrean Gudang: handoff INBOUND OFFERED untuk u2 (pickup selesai, belum diterima) -> Pengambilan, dengan keterangan menunggu Terima Unit
  await testPrisma.unitCustodyHandoff.create({ data: { unitId: u2.id, deliveryJobId: job.id, direction: "INBOUND", status: "OFFERED", revision: 1 } });
  for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
    const data = { enabled: true, scope: "GLOBAL", config: { unitIds: [u1.id, u2.id] }, reason: "f2" };
    await testPrisma.v2FeatureFlag.upsert({ where: { key: k }, create: { key: k, ...data }, update: data });
  }
  const q = (await w.wh.api.get("/api/inventory/unit-custody?status=OFFERED")).body;
  const item = (q.items || q).find((x) => x.unit.id === u2.id);
  assert.equal(item.globalStatus.key, "PENGAMBILAN"); assert.match(item.globalStatus.detail, /menunggu Terima Unit di Workshop|Konfirmasi workshop belum tercatat/);
});

test("KPI waktu alur: enam durasi dari timestamp tercatat (selesai produksi ≠ diterima Gudang); histori tak lengkap = tidak tersedia; tidak ada tulis", async () => {
  const w = await users();
  const T0 = Date.parse("2026-10-12T01:00:00.000Z"); const at = (m) => new Date(T0 + m * 60_000);
  const { order } = await mkOrder({ status: "DELIVERED" });
  const unit = await mkUnit(order, "DELIVERED");
  const route = await testPrisma.route.create({ data: { code: `F2-RTE-${++seq}`, date: new Date("2026-10-12T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date() } });
  const pick = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, status: "COMPLETED", sequence: 1, completedAt: at(0) } });
  const del = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, routeId: route.id, status: "COMPLETED", sequence: 2, completedAt: at(540) } });
  await testPrisma.jobUnit.createMany({ data: [{ jobId: pick.id, unitId: unit.id }, { jobId: del.id, unitId: unit.id }] });
  await testPrisma.unitCustodyHandoff.create({ data: { unitId: unit.id, deliveryJobId: pick.id, direction: "INBOUND", status: "ACCEPTED", revision: 2, offeredAt: at(5), acceptedAt: at(30) } });
  await testPrisma.unitCustodyHandoff.create({ data: { unitId: unit.id, direction: "FINISHED_GOODS", status: "ACCEPTED", revision: 2, offeredAt: at(300), acceptedAt: at(330) } });
  const run = await testPrisma.productionRun.create({ data: { unitId: unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "COMPLETED", currentPhase: "HANDOFF", revision: 1 } });
  await testPrisma.productionOperationRun.create({ data: { runId: run.id, stageCode: "a", stageLabel: "A", sequence: 1, status: "COMPLETED", startedAt: at(90), completedAt: at(200) } });
  await testPrisma.productionOperationRun.create({ data: { runId: run.id, stageCode: "b", stageLabel: "B", sequence: 2, status: "SKIPPED", completedAt: at(50) } }); // SKIPPED bukan awal produksi
  await testPrisma.deliveryExecutionEvent.create({ data: { idempotencyKey: `f2-evt-${++seq}-aaaaaaaa`, action: "JOB_STARTED", jobId: del.id, occurredAt: at(480), createdAt: at(481) } });
  const before = { events: await testPrisma.deliveryExecutionEvent.count(), outbox: await testPrisma.domainOutbox.count(), handoffs: await testPrisma.unitCustodyHandoff.count() };
  const tl = (await loadWorkshopTimelines(testPrisma, [unit.id])).get(unit.id);
  const m = Object.fromEntries(tl.durations.map((d) => [d.key, d.minutes]));
  assert.deepEqual(m, { pickupToReceived: 30, receivedToStart: 60, productionDuration: 210, finishedToWarehouse: 30, readyToDelivery: 150, deliveryDuration: 60 });
  // unit lama tanpa data: tidak ada durasi, tidak ada timestamp dibuat
  const old = await mkUnit((await mkOrder()).order, "DELIVERED");
  const t2 = (await loadWorkshopTimelines(testPrisma, [old.id])).get(old.id);
  assert.ok(t2.durations.every((d) => d.available === false && d.text === "Data waktu belum tersedia"));
  assert.deepEqual({ events: await testPrisma.deliveryExecutionEvent.count(), outbox: await testPrisma.domainOutbox.count(), handoffs: await testPrisma.unitCustodyHandoff.count() }, before);
  // Unit 360 (unit tanpa Run dalam cohort) + laporan agregat
  for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
    const data = { enabled: true, scope: "GLOBAL", config: { unitIds: [unit.id, old.id] }, reason: "f2" };
    await testPrisma.v2FeatureFlag.upsert({ where: { key: k }, create: { key: k, ...data }, update: data });
  }
  const ov = await w.lead.api.get(`/api/production-v2/units/${old.id}/overview`);
  assert.equal(ov.status, 200, JSON.stringify(ov.body).slice(0, 200));
  assert.equal(ov.body.timeline.durations.length, 6); assert.ok(ov.body.timeline.durations.every((d) => !d.available));
  const rep = await w.lead.api.get("/api/production-v2/reports/milestone-durations?from=2026-10-01&to=2026-10-31");
  assert.equal(rep.status, 200, JSON.stringify(rep.body).slice(0, 200));
  const agg = Object.fromEntries(rep.body.durations.map((d) => [d.key, d]));
  assert.equal(agg.productionDuration.n, 1); assert.equal(agg.productionDuration.avgMinutes, 210); assert.equal(agg.productionDuration.missing, 1);
  assert.equal(agg.deliveryDuration.avgText, "1 jam");
  assert.equal((await w.sales.api.get("/api/production-v2/reports/milestone-durations")).status, 403);
});

test("pembaca milestone tidak membaca status pembayaran dan tidak memuat status order dari unit yang batal", async () => {
  const { order } = await mkOrder({ paymentStatus: "LUNAS" });
  await mkUnit(order, "CANCELLED");
  const ms = await loadOrderMilestones(testPrisma, [order]);
  assert.equal(ms.get(order.id).key, "DIBATALKAN"); // semua unit batal -> Dibatalkan
});
