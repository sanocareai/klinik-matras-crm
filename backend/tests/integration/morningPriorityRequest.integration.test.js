// Usulan Prioritas Pagi (Route Planner <-> Produksi, 3 Oktober 2026) — lihat catatan desain lengkap di
// services/morningPriority.js. Alur (DIREVISI hari yang sama — "gaperlu menunggu persetujuan produksi"):
// DISPATCHER menandai order PROCESSING, priority BERLAKU LANGSUNG ke unit aktif; idempoten per order
// (tandai ulang = update, bukan baris baru); DISPATCHER maupun Production bisa membatalkan.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function buatOrderProcessing({ unitCount = 2, unitStatus = "IN_PRODUCTION" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Prioritas Pagi" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 0, status: "PROCESSING", orderNumber: `RES-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` } });
  const units = [];
  for (let seq = 1; seq <= unitCount; seq += 1) {
    units.push(await testPrisma.unit.create({ data: { orderId: order.id, seq, unitCode: `${order.orderNumber}-U${seq}`, status: unitStatus } }));
  }
  return { order, units };
}

test("DISPATCHER menandai order PROCESSING: BERLAKU LANGSUNG ke unit aktif (bukan DELIVERED/CANCELLED), tanpa menunggu siapa pun", async () => {
  await truncateAll();
  const { order, units } = await buatOrderProcessing({ unitCount: 3 });
  await testPrisma.unit.update({ where: { id: units[2].id }, data: { status: "DELIVERED" } });
  const dispatcher = makeClient(server.baseUrl, (await createTestUser({ roles: ["DISPATCHER"] })).token);

  const r = await dispatcher.post("/api/morning-priority-requests", { orderId: order.id, note: "customer minta pagi ini", suggestedPriority: "URGENT" });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, "APPROVED", "langsung berlaku, tanpa status PENDING perantara");
  assert.equal(r.body.appliedPriority, "URGENT");

  const u0 = await testPrisma.unit.findUnique({ where: { id: units[0].id } });
  const u1 = await testPrisma.unit.findUnique({ where: { id: units[1].id } });
  const u2delivered = await testPrisma.unit.findUnique({ where: { id: units[2].id } });
  assert.equal(u0.priority, "URGENT");
  assert.equal(u1.priority, "URGENT");
  assert.equal(u2delivered.priority, "NORMAL", "unit yang sudah DELIVERED tidak ikut diubah");

  const events = await testPrisma.activityEvent.findMany({ where: { entityType: "unit", eventType: "PRIORITY_CHANGED", entityId: { in: [units[0].id, units[1].id] } } });
  assert.equal(events.length, 2, "tiap unit yang berubah tercatat satu baris aktivitas");

  const orderBukanProcessing = await buatOrderProcessing({ unitStatus: "READY_FOR_DELIVERY" });
  await testPrisma.order.update({ where: { id: orderBukanProcessing.order.id }, data: { status: "READY" } });
  const ditolak = await dispatcher.post("/api/morning-priority-requests", { orderId: orderBukanProcessing.order.id });
  assert.equal(ditolak.status, 400);
  assert.match(ditolak.body.error, /Diproses/);
});

test("Tandai ulang order yang SUDAH ditandai: UPDATE baris yang sama (bukan duplikat), priority ikut berubah ke nilai baru", async () => {
  await truncateAll();
  const { order, units } = await buatOrderProcessing({ unitCount: 1 });
  const dispatcher = makeClient(server.baseUrl, (await createTestUser({ roles: ["DISPATCHER"] })).token);

  const a = await dispatcher.post("/api/morning-priority-requests", { orderId: order.id, suggestedPriority: "HIGH" });
  const b = await dispatcher.post("/api/morning-priority-requests", { orderId: order.id, suggestedPriority: "CRITICAL" });
  assert.equal(b.body.id, a.body.id, "baris yang sama diperbarui, bukan baris baru");
  assert.equal(b.body.appliedPriority, "CRITICAL");

  const rows = await testPrisma.morningPriorityRequest.findMany({ where: { orderId: order.id } });
  assert.equal(rows.length, 1);
  const unit = await testPrisma.unit.findUnique({ where: { id: units[0].id } });
  assert.equal(unit.priority, "CRITICAL");
});

test("Batalkan: DISPATCHER maupun PRODUCTION_LEAD sama-sama bisa (koordinasi dua arah, bukan gerbang satu arah); priority kembali NORMAL", async () => {
  await truncateAll();
  const { order: o1, units: u1 } = await buatOrderProcessing();
  const { order: o2, units: u2 } = await buatOrderProcessing();
  const dispatcher = makeClient(server.baseUrl, (await createTestUser({ roles: ["DISPATCHER"] })).token);
  const lead = makeClient(server.baseUrl, (await createTestUser({ roles: ["PRODUCTION_LEAD"] })).token);

  const r1 = (await dispatcher.post("/api/morning-priority-requests", { orderId: o1.id })).body;
  const r2 = (await dispatcher.post("/api/morning-priority-requests", { orderId: o2.id })).body;

  // Dispatcher sendiri boleh batalkan punyanya
  const batal1 = await dispatcher.patch(`/api/morning-priority-requests/${r1.id}/dismiss`, {});
  assert.equal(batal1.status, 200);
  assert.equal(batal1.body.status, "DISMISSED");
  assert.equal((await testPrisma.unit.findUnique({ where: { id: u1[0].id } })).priority, "NORMAL");

  // Production juga boleh batalkan punya dispatcher
  const batal2 = await lead.patch(`/api/morning-priority-requests/${r2.id}/dismiss`, {});
  assert.equal(batal2.status, 200);
  assert.equal((await testPrisma.unit.findUnique({ where: { id: u2[0].id } })).priority, "NORMAL");

  // Dibatalkan dua kali -> 409
  assert.equal((await dispatcher.patch(`/api/morning-priority-requests/${r1.id}/dismiss`, {})).status, 409);
});

test("SALES tidak berhak sama sekali (403) — baca maupun menandai; PATCH /units/:id/production langsung tetap tertutup untuk DISPATCHER (pemisahan tugas umum tidak melebar)", async () => {
  await truncateAll();
  const { order, units } = await buatOrderProcessing();
  const sales = makeClient(server.baseUrl, (await createTestUser({ roles: ["SALES"] })).token);
  const dispatcher = makeClient(server.baseUrl, (await createTestUser({ roles: ["DISPATCHER"] })).token);

  assert.equal((await sales.get("/api/morning-priority-requests")).status, 403);
  assert.equal((await sales.post("/api/morning-priority-requests", { orderId: order.id })).status, 403);

  // Dispatcher TETAP tidak bisa lewat endpoint produksi umum — kemampuannya SEMPIT, cuma lewat endpoint ini.
  assert.equal((await dispatcher.patch(`/api/units/${units[0].id}/production`, { priority: "URGENT" })).status, 403);
});

test("GET daftar: default APPROVED (yang sedang berlaku); dispatcher dan production_lead sama-sama bisa membaca", async () => {
  await truncateAll();
  const { order: o1 } = await buatOrderProcessing();
  const { order: o2 } = await buatOrderProcessing();
  const dispatcher = makeClient(server.baseUrl, (await createTestUser({ roles: ["DISPATCHER"] })).token);
  const lead = makeClient(server.baseUrl, (await createTestUser({ roles: ["PRODUCTION_LEAD"] })).token);

  const r1 = (await dispatcher.post("/api/morning-priority-requests", { orderId: o1.id })).body;
  await dispatcher.post("/api/morning-priority-requests", { orderId: o2.id });
  await lead.patch(`/api/morning-priority-requests/${r1.id}/dismiss`, {});

  const aktifDariDispatcher = await dispatcher.get("/api/morning-priority-requests");
  assert.equal(aktifDariDispatcher.status, 200);
  assert.equal(aktifDariDispatcher.body.length, 1, "hanya yang masih APPROVED; yang sudah dibatalkan tidak ikut default");

  const aktifDariLead = await lead.get("/api/morning-priority-requests");
  assert.equal(aktifDariLead.status, 200);
  assert.equal(aktifDariLead.body.length, 1);
  assert.ok(aktifDariLead.body[0].order.orderNumber, "menyertakan info order untuk ditampilkan di papan");

  const semua = await lead.get("/api/morning-priority-requests?status=ALL");
  assert.equal(semua.body.length, 2, "status=ALL menampilkan yang sudah dibatalkan juga");
});
