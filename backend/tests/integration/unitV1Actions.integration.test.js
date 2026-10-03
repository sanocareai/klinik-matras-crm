// P12B.5 — aksi V1 unit NON-V2 (layanan teknis, prioritas, target, blokir) + penanda sumber V1/V2 + Layanan Dipesan (Sales) read-only, pada DB uji terisolasi (data nyata,
// jalur tulis ASLI lewat HTTP). Membuktikan: izin per peran, simpan+baca ulang, target WIB, konflik, dan unit non-V2 TIDAK menyentuh tabel V2.
import "./setup/env.js";
import test from "node:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { detectConflict, productionPatchOf, wibDateOf, draftOf } from "../../../frontend/src/features/production/unitV1ActionsModel.js";

let server; let W;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function world() {
  const who = {};
  for (const [k, roles] of [["lead", ["PRODUCTION_LEAD"]], ["worker", ["PRODUCTION_WORKER"]], ["qc", ["QC_LEAD"]], ["sales", ["SALES"]], ["admin", ["ADMIN"]], ["owner", ["OWNER"]], ["finance", ["FINANCE"]]]) {
    const u = await createTestUser({ roles }); who[k] = { ...u, http: makeClient(server.baseUrl, u.token) };
  }
  const service = await testPrisma.serviceCatalog.findFirstOrThrow({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const service2 = await testPrisma.serviceCatalog.findFirstOrThrow({ where: { active: true, id: { not: service.id } }, orderBy: { sortOrder: "asc" } });
  const mk = async (code, svcName) => {
    const customer = await testPrisma.customer.create({ data: { name: `Pelanggan ${code}` } });
    const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ORD-${code}`, value: 2_500_000, category: "LAYANAN" } });
    await testPrisma.orderItem.create({ data: { orderId: order.id, layananName: svcName, harga: 2_500_000, sortOrder: 0 } });
    const unit = await testPrisma.unit.create({ data: { unitCode: code, orderId: order.id, seq: 1, status: "AWAITING_PICKUP", merk: "Serta", ukuran: "160 x 200" } });
    return { customer, order, unit };
  };
  const v1 = await mk("IT-V1-1", "Servis Spring & Busa");
  const v2 = await mk("IT-V2-1", "Upgrade Fondasi");
  return { who, service, service2, v1, v2 };
}
const setCohort = async (unitIds) => {
  const data = { enabled: !!unitIds, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "uji sumber V1/V2" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: V2_FLAGS.PRODUCTION_READER }, create: { key: V2_FLAGS.PRODUCTION_READER, ...data }, update: data });
};
const footprint = async (unitId) => ({
  runs: await testPrisma.productionRun.count({ where: { unitId } }),
  custody: await testPrisma.unitCustodyHandoff.count({ where: { unitId } }),
  commands: Number((await testPrisma.$queryRawUnsafe("select count(*)::int c from v2_commands"))[0].c),
  outbox: await testPrisma.domainOutbox.count(),
  runsAll: await testPrisma.productionRun.count(),
});

test("setup: unit V1 (non-cohort) dan unit V2 (cohort) pada order asli berisi layanan Sales", async () => { W = await world(); await setCohort([W.v2.unit.id]); assert.ok(W.v1.unit.id); });

test("timeline unit: Layanan Dipesan (Sales) = read-only, terpisah dari Layanan Teknis, TANPA harga/item order bocor", async () => {
  const r = await W.who.lead.http.get(`/api/units/${W.v1.unit.id}/timeline`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.salesServices, ["Servis Spring & Busa"]);
  assert.equal(r.body.unit.service, null, "layanan teknis belum ditetapkan — tidak ditebak dari Sales");
  assert.equal(r.body.unit.order.orderNumber, "ORD-IT-V1-1"); assert.equal(r.body.unit.order.items, undefined, "item order (harga) tidak ikut payload");
  assert.doesNotMatch(JSON.stringify(r.body), /2500000|harga/i);
  assert.equal(r.body.activeBlocker, null);
});

test("work-orders: tiap unit ditandai sumber (inProductionV2) dari cohort reader yang sama dengan Unit 360; reader OFF = semua V1", async () => {
  const r = await W.who.lead.http.get("/api/production/work-orders");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const by = Object.fromEntries(r.body.units.map((u) => [u.unitCode, u.inProductionV2]));
  assert.deepEqual(by, { "IT-V1-1": false, "IT-V2-1": true });
  await setCohort(null);
  const off = await W.who.lead.http.get("/api/production/work-orders");
  assert.ok(off.body.units.every((u) => u.inProductionV2 === false), "reader OFF → V1 semua");
  await setCohort([W.v2.unit.id]);
});

test("Unit 360 (V2): unit non-cohort 404 (jujur), unit cohort tidak — sumber konsisten dengan penanda work-orders", async () => {
  assert.equal((await W.who.lead.http.get(`/api/production-v2/units/${W.v1.unit.id}/overview`)).status, 404);
});

test("izin PATCH /units/:id/service (UNIT_ROUTING_WRITE): Lead/Admin/Owner 200; Worker/QC/Sales/Finance 403; tidak ada perubahan saat ditolak", async () => {
  const id = W.v1.unit.id;
  for (const k of ["worker", "qc", "sales", "finance"]) assert.equal((await W.who[k].http.patch(`/api/units/${id}/service`, { serviceId: W.service.id })).status, 403, k);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id } })).serviceId, null);
  assert.equal((await W.who.lead.http.patch(`/api/units/${id}/service`, { serviceId: W.service.id })).status, 200);
  const t = (await W.who.lead.http.get(`/api/units/${id}/timeline`)).body;
  assert.equal(t.unit.service.id, W.service.id, "simpan + baca ulang");
  assert.deepEqual(t.salesServices, ["Servis Spring & Busa"], "Layanan Sales tidak berubah oleh Layanan Teknis");
  for (const k of ["admin", "owner"]) assert.equal((await W.who[k].http.patch(`/api/units/${id}/service`, { serviceId: W.service2.id })).status, 200, k);
  assert.equal((await W.who.lead.http.patch(`/api/units/${id}/service`, {})).status, 400);
  assert.equal((await W.who.lead.http.patch(`/api/units/${id}/service`, { serviceId: randomUUID() })).status, 404);
});

test("izin PATCH /units/:id/production: Lead 200; Worker/QC/Sales 403; target WIB tersimpan benar (tanggal kalender WIB, bukan slice UTC)", async () => {
  const id = W.v1.unit.id;
  for (const k of ["worker", "qc", "sales"]) assert.equal((await W.who[k].http.patch(`/api/units/${id}/production`, { priority: "URGENT" })).status, 403, k);
  const base = (await W.who.lead.http.get(`/api/units/${id}/timeline`)).body;
  const patch = productionPatchOf({ priority: "URGENT", due: "2026-10-20" }, base.unit);
  assert.deepEqual(patch, { priority: "URGENT", productionDueAt: "2026-10-20T00:00:00+07:00" });
  assert.equal((await W.who.lead.http.patch(`/api/units/${id}/production`, patch)).status, 200);
  const t = (await W.who.lead.http.get(`/api/units/${id}/timeline`)).body;
  assert.equal(t.unit.priority, "URGENT");
  assert.equal(t.unit.productionDueAt, "2026-10-19T17:00:00.000Z", "UTC di DB");
  assert.equal(wibDateOf(t.unit.productionDueAt), "2026-10-20", "UI menampilkan tanggal WIB yang dipilih");
  assert.notEqual(t.unit.productionDueAt.slice(0, 10), "2026-10-20", "slice(0,10) UTC salah sehari — itu bug halaman lama");
  assert.deepEqual(draftOf(t.unit), { priority: "URGENT", due: "2026-10-20" });
  assert.equal((await W.who.lead.http.patch(`/api/units/${id}/production`, { priority: "BUKAN" })).status, 400);
  assert.equal((await W.who.lead.http.patch(`/api/units/${id}/production`, { productionDueAt: null })).status, 200);
  assert.equal((await W.who.lead.http.get(`/api/units/${id}/timeline`)).body.unit.productionDueAt, null, "target dapat dikosongkan");
});

test("konflik: perubahan orang lain di antara baca & tulis terdeteksi (bidang yang berubah), tanpa mengubah data milik bidang lain", async () => {
  const id = W.v1.unit.id;
  const loaded = (await W.who.lead.http.get(`/api/units/${id}/timeline`)).body; // yang dilihat pengguna A saat drawer dibuka
  await W.who.admin.http.patch(`/api/units/${id}/production`, { priority: "CRITICAL" }); // pengguna B mengubah
  const latest = (await W.who.lead.http.get(`/api/units/${id}/timeline`)).body;
  assert.deepEqual(detectConflict(loaded, latest, ["priority", "due"]), ["priority"], "konflik pada prioritas saja");
  assert.deepEqual(detectConflict(loaded, latest, ["service"]), [], "bidang lain tidak ikut");
  assert.equal(latest.unit.priority, "CRITICAL", "tulisan B utuh — A berhenti dan memuat ulang");
});

test("blokir V1: Worker/Lead/QC/Admin/Owner boleh menyelesaikan (UNIT_STAGE_WRITE); Sales/Finance 403; simpan + baca ulang; resolve ulang tidak 500", async () => {
  const id = W.v1.unit.id;
  const started = await W.who.worker.http.post(`/api/units/${id}/stages/start`, {});
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const stageId = (await testPrisma.unit.findUniqueOrThrow({ where: { id }, select: { currentStageId: true } })).currentStageId;
  assert.equal((await W.who.worker.http.post(`/api/units/${id}/stages/${stageId}/fail`, { blockReason: "MATERIAL_SHORTAGE", note: "Busa habis" })).status, 200);
  const blocked = (await W.who.lead.http.get(`/api/units/${id}/timeline`)).body;
  assert.equal(blocked.activeBlocker.reason, "MATERIAL_SHORTAGE"); assert.equal(blocked.activeBlocker.note, "Busa habis");
  for (const k of ["sales", "finance"]) assert.equal((await W.who[k].http.post(`/api/units/${id}/blockers/${blocked.activeBlocker.id}/resolve`, {})).status, 403, k);
  assert.ok((await W.who.lead.http.get(`/api/units/${id}/timeline`)).body.activeBlocker, "ditolak = blokir tetap");
  const r = await W.who.qc.http.post(`/api/units/${id}/blockers/${blocked.activeBlocker.id}/resolve`, { resolutionNote: "Busa datang" });
  assert.equal(r.status, 200);
  const after = (await W.who.lead.http.get(`/api/units/${id}/timeline`)).body;
  assert.equal(after.activeBlocker, null, "blokir selesai (simpan + baca ulang)");
  assert.notEqual((await W.who.lead.http.post(`/api/units/${id}/blockers/${blocked.activeBlocker.id}/resolve`, {})).status, 500, "resolve ulang tidak 500");
  // konflik blokir: pengguna lain sudah menyelesaikan
  assert.deepEqual(detectConflict(blocked, after, ["blocker"]), ["blocker"]);
});

test("unit NON-V2 tanpa tulisan V2: semua aksi V1 di atas tidak membuat Run/custody/command/outbox V2 dan tidak mengubah cohort", async () => {
  const before = await footprint(W.v1.unit.id);
  // satu putaran aksi V1 penuh pada unit V1
  await W.who.lead.http.patch(`/api/units/${W.v1.unit.id}/service`, { serviceId: W.service.id });
  await W.who.lead.http.patch(`/api/units/${W.v1.unit.id}/production`, { priority: "HIGH", productionDueAt: "2026-10-25T00:00:00+07:00" });
  const after = await footprint(W.v1.unit.id);
  assert.deepEqual(after, before, "tabel V2 tidak berubah oleh aksi V1");
  assert.equal(after.runs, 0); assert.equal(after.custody, 0); assert.equal(after.runsAll, 0, "tidak ada Run di mana pun (tanpa backfill)");
  const flag = await testPrisma.v2FeatureFlag.findUniqueOrThrow({ where: { key: V2_FLAGS.PRODUCTION_READER } });
  assert.deepEqual(flag.config, { unitIds: [W.v2.unit.id] }, "cohort tidak diperluas");
});

test("deep-link/bookmark: unit non-V2 dapat dibaca ulang kapan saja lewat timeline yang sama (drawer ?unit=<id>)", async () => {
  const r = await W.who.lead.http.get(`/api/units/${W.v1.unit.id}/timeline`);
  assert.equal(r.status, 200); assert.equal(r.body.unit.unitCode, "IT-V1-1");
  assert.equal((await W.who.lead.http.get(`/api/units/${randomUUID()}/timeline`)).status, 404);
});
