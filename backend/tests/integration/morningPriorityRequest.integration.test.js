// Usulan Prioritas Pagi (Route Planner -> Produksi, 3 Oktober 2026) — lihat catatan desain lengkap di
// services/morningPriority.js. Alur: DISPATCHER mengusulkan (hanya order PROCESSING, idempoten per
// order), PRODUCTION_LEAD/ADMIN menyetujui (priority ditulis ke unit aktif) atau menolak; DISPATCHER
// TIDAK PERNAH bisa menulis Unit.priority langsung (403 kalau dicoba).
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

test("DISPATCHER mengusulkan order PROCESSING; idempoten (klik dua kali = satu baris PENDING); order bukan PROCESSING ditolak", async () => {
  await truncateAll();
  const { order } = await buatOrderProcessing();
  const dispatcher = makeClient(server.baseUrl, (await createTestUser({ roles: ["DISPATCHER"] })).token);

  const a = await dispatcher.post("/api/morning-priority-requests", { orderId: order.id, note: "customer minta pagi ini" });
  assert.equal(a.status, 201);
  assert.equal(a.body.status, "PENDING");
  assert.equal(a.body.suggestedPriority, "HIGH");

  const b = await dispatcher.post("/api/morning-priority-requests", { orderId: order.id });
  assert.equal(b.status, 201, "klik kedua tetap 2xx, bukan error");
  assert.equal(b.body.id, a.body.id, "baris yang sama dikembalikan, bukan duplikat");

  const rows = await testPrisma.morningPriorityRequest.findMany({ where: { orderId: order.id } });
  assert.equal(rows.length, 1, "tidak ada baris dobel di database");

  const { order: orderReady } = await buatOrderProcessing({ unitStatus: "READY_FOR_DELIVERY" });
  await testPrisma.order.update({ where: { id: orderReady.id }, data: { status: "READY" } });
  const ditolak = await dispatcher.post("/api/morning-priority-requests", { orderId: orderReady.id });
  assert.equal(ditolak.status, 400);
  assert.match(ditolak.body.error, /Diproses/);
});

test("DISPATCHER TIDAK bisa approve/dismiss (403) — hanya mengusulkan; PRODUCTION_LEAD yang memutuskan", async () => {
  await truncateAll();
  const { order } = await buatOrderProcessing();
  const dispatcher = makeClient(server.baseUrl, (await createTestUser({ roles: ["DISPATCHER"] })).token);
  const created = (await dispatcher.post("/api/morning-priority-requests", { orderId: order.id })).body;

  assert.equal((await dispatcher.patch(`/api/morning-priority-requests/${created.id}/approve`, {})).status, 403);
  assert.equal((await dispatcher.patch(`/api/morning-priority-requests/${created.id}/dismiss`, {})).status, 403);

  // Jalur langsung PATCH /units/:id/production juga tetap tertutup untuk dispatcher — bukti pemisahan
  // tugas ini bukan cuma di endpoint baru, konsisten dengan izin yang sudah ada sebelumnya.
  const unit = await testPrisma.unit.findFirst({ where: { orderId: order.id } });
  assert.equal((await dispatcher.patch(`/api/units/${unit.id}/production`, { priority: "URGENT" })).status, 403);
});

test("PRODUCTION_LEAD menyetujui: priority diterapkan ke SEMUA unit aktif order (bukan DELIVERED/CANCELLED), tercatat di ActivityEvent per unit", async () => {
  await truncateAll();
  const { order, units } = await buatOrderProcessing({ unitCount: 3 });
  // satu unit SUDAH delivered duluan (mis. kiriman bertahap) — TIDAK boleh ikut diubah prioritasnya
  await testPrisma.unit.update({ where: { id: units[2].id }, data: { status: "DELIVERED" } });

  const dispatcher = makeClient(server.baseUrl, (await createTestUser({ roles: ["DISPATCHER"] })).token);
  const lead = makeClient(server.baseUrl, (await createTestUser({ roles: ["PRODUCTION_LEAD"] })).token);

  const created = (await dispatcher.post("/api/morning-priority-requests", { orderId: order.id, suggestedPriority: "URGENT" })).body;
  const approved = await lead.patch(`/api/morning-priority-requests/${created.id}/approve`, {});
  assert.equal(approved.status, 200);
  assert.equal(approved.body.status, "APPROVED");
  assert.equal(approved.body.appliedPriority, "URGENT");

  const u0 = await testPrisma.unit.findUnique({ where: { id: units[0].id } });
  const u1 = await testPrisma.unit.findUnique({ where: { id: units[1].id } });
  const u2delivered = await testPrisma.unit.findUnique({ where: { id: units[2].id } });
  assert.equal(u0.priority, "URGENT");
  assert.equal(u1.priority, "URGENT");
  assert.equal(u2delivered.priority, "NORMAL", "unit yang sudah DELIVERED tidak ikut diubah");

  const events = await testPrisma.activityEvent.findMany({ where: { entityType: "unit", eventType: "PRIORITY_CHANGED", entityId: { in: [units[0].id, units[1].id] } } });
  assert.equal(events.length, 2, "tiap unit yang berubah tercatat satu baris aktivitas");

  // Usulan yang sudah diputuskan tidak bisa diputuskan dua kali.
  const lagi = await lead.patch(`/api/morning-priority-requests/${created.id}/approve`, {});
  assert.equal(lagi.status, 409);
});

test("PRODUCTION_LEAD menolak (dismiss): status DISMISSED, priority unit TIDAK tersentuh", async () => {
  await truncateAll();
  const { order, units } = await buatOrderProcessing();
  const dispatcher = makeClient(server.baseUrl, (await createTestUser({ roles: ["DISPATCHER"] })).token);
  const lead = makeClient(server.baseUrl, (await createTestUser({ roles: ["PRODUCTION_LEAD"] })).token);

  const created = (await dispatcher.post("/api/morning-priority-requests", { orderId: order.id })).body;
  const dismissed = await lead.patch(`/api/morning-priority-requests/${created.id}/dismiss`, {});
  assert.equal(dismissed.status, 200);
  assert.equal(dismissed.body.status, "DISMISSED");

  const u0 = await testPrisma.unit.findUnique({ where: { id: units[0].id } });
  assert.equal(u0.priority, "NORMAL");
});

test("GET daftar: default PENDING saja; dispatcher dan production_lead sama-sama bisa membaca; SALES ditolak", async () => {
  await truncateAll();
  const { order: o1 } = await buatOrderProcessing();
  const { order: o2 } = await buatOrderProcessing();
  const dispatcher = makeClient(server.baseUrl, (await createTestUser({ roles: ["DISPATCHER"] })).token);
  const lead = makeClient(server.baseUrl, (await createTestUser({ roles: ["PRODUCTION_LEAD"] })).token);
  const sales = makeClient(server.baseUrl, (await createTestUser({ roles: ["SALES"] })).token);

  const r1 = (await dispatcher.post("/api/morning-priority-requests", { orderId: o1.id })).body;
  await dispatcher.post("/api/morning-priority-requests", { orderId: o2.id });
  await lead.patch(`/api/morning-priority-requests/${r1.id}/dismiss`, {});

  const pendingDariDispatcher = await dispatcher.get("/api/morning-priority-requests");
  assert.equal(pendingDariDispatcher.status, 200);
  assert.equal(pendingDariDispatcher.body.length, 1, "hanya yang masih PENDING; yang sudah ditolak tidak ikut default");

  const pendingDariLead = await lead.get("/api/morning-priority-requests");
  assert.equal(pendingDariLead.status, 200);
  assert.equal(pendingDariLead.body.length, 1);
  assert.ok(pendingDariLead.body[0].order.orderNumber, "menyertakan info order untuk ditampilkan di papan");

  assert.equal((await sales.get("/api/morning-priority-requests")).status, 403);
});
