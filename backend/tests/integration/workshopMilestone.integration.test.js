// Milestone global "Diterima di Workshop" — HTTP nyata di DB uji terisolasi. Bukti terima HANYA tiga command resmi (custody INBOUND ACCEPTED, konfirmasi petugas, lahir di
// workshop); pickup selesai (UnitStatus.RECEIVED) TIDAK pernah dihitung. Filter/hitungan dihitung di SERVER dari bukti; tidak ada tulis ke data (histori utuh).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ARRIVAL_NO_CUSTODY_REASON } from "../../src/lib/domain/productionDisplay.js";

let server; let lead; let driver; let seq = 0; // driver dibuat ulang tiap world() (truncateAll menghapus pengguna)
test.before(async () => {
  await truncateAll(); server = await startTestServer(buildTestApp());
  lead = makeClient(server.baseUrl, (await createTestUser({ roles: ["PRODUCTION_LEAD"] })).token);
});
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const backlog = async (qs = "") => (await lead.get(`/api/production-v2/backlog${qs}`)).body;
const wo = async (qs = "") => (await lead.get(`/api/production/work-orders${qs}`)).body;
const codesOf = (b) => (b.items || []).map((i) => i.card.unit.unitCode).sort();
const woCodes = (b) => (b.units || []).map((u) => u.unitCode).sort();

async function mkOrder(status = "PROCESSING") {
  seq += 1;
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan MS-${seq}`, pipelineStage: "NEW" } });
  return testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ORD-MS-${seq}`, value: 1_000_000, category: "LAYANAN", status } });
}
async function mkUnit(unitStatus, { orderStatus = "PROCESSING" } = {}) {
  const order = await mkOrder(orderStatus); seq += 1;
  return testPrisma.unit.create({ data: { unitCode: `MS-U${seq}`, orderId: order.id, seq, status: unitStatus, merk: "Serta", ukuran: "160x200" } });
}
async function mkJob(unit, type, status) {
  seq += 1;
  const route = await testPrisma.route.create({ data: { code: `MS-RTE-${seq}`, date: new Date("2026-10-12T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: driver.user.id } });
  const job = await testPrisma.job.create({ data: { type, orderId: unit.orderId, routeId: route.id, driverId: driver.user.id, status, sequence: 1 } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  return job;
}
const mkHandoff = (unit, job, status, runId = null) => testPrisma.unitCustodyHandoff.create({ data: { unitId: unit.id, deliveryJobId: job.id, direction: "INBOUND", status, productionRunId: runId, revision: 1 } });
const mkRun = (unit, { origin = "CUSTODY_PICKUP", status = "ACTIVE" } = {}) => testPrisma.productionRun.create({ data: { unitId: unit.id, kind: "RESTORATION", origin, status, currentPhase: "INTAKE", revision: 1 } });

async function world() {
  await truncateAll();
  driver = await createTestUser({ roles: ["DRIVER"] });
  const W = {};
  // A: pickup SELESAI, belum ada bukti terima (RECEIVED tersimpan) — tidak boleh dianggap tiba
  W.A = await mkUnit("RECEIVED"); await mkJob(W.A, "PICKUP", "COMPLETED");
  // B: custody INBOUND ACCEPTED (petugas menekan "Terima Unit di Workshop")
  W.B = await mkUnit("RECEIVED"); { const j = await mkJob(W.B, "PICKUP", "COMPLETED"); await mkHandoff(W.B, j, "ACCEPTED"); }
  // C: konfirmasi petugas TANPA custody (unit tanpa pickup tercatat)
  W.C = await mkUnit("RECEIVED"); { const r = await mkRun(W.C); await testPrisma.productionPhaseRun.create({ data: { runId: r.id, phase: "INTAKE", status: "COMPLETED", sequence: 1, reason: ARRIVAL_NO_CUSTODY_REASON } }); }
  // D: lahir di workshop (unit BARU/SEWA didaftarkan)
  W.D = await mkUnit("RECEIVED"); await mkRun(W.D, { origin: "WORKSHOP_BORN" });
  // E: diterima + operasi produksi pertama sudah dimulai -> Diproses
  W.E = await mkUnit("RECEIVED"); { const j = await mkJob(W.E, "PICKUP", "COMPLETED"); const r = await mkRun(W.E); await mkHandoff(W.E, j, "ACCEPTED", r.id);
    await testPrisma.productionOperationRun.create({ data: { runId: r.id, stageCode: "disassembly", stageLabel: "Bongkar", sequence: 1, status: "ACTIVE", startedAt: new Date() } }); }
  // F: histori V1 lama — IN_PRODUCTION tanpa bukti terima apa pun
  W.F = await mkUnit("IN_PRODUCTION");
  // G: handoff baru DITAWARKAN (belum diterima) + Run PENDING_ARRIVAL — bukan bukti terima
  W.G = await mkUnit("RECEIVED"); { const j = await mkJob(W.G, "PICKUP", "COMPLETED"); const r = await mkRun(W.G, { status: "PENDING_ARRIVAL" }); await mkHandoff(W.G, j, "OFFERED", r.id); }
  // H: pickup berjalan (order PICKUP)
  W.H = await mkUnit("IN_TRANSIT_IN", { orderStatus: "PICKUP" });
  // I: operasi hanya SKIPPED (adaptasi) pada unit yang sudah diterima -> belum "dimulai"
  W.I = await mkUnit("RECEIVED"); { const j = await mkJob(W.I, "PICKUP", "COMPLETED"); const r = await mkRun(W.I); await mkHandoff(W.I, j, "ACCEPTED", r.id);
    await testPrisma.productionOperationRun.create({ data: { runId: r.id, stageCode: "inspect", stageLabel: "Inspeksi", sequence: 1, status: "SKIPPED", completedAt: new Date() } }); }
  // J: sudah Siap Kirim (tidak masuk backlog)
  W.J = await mkUnit("READY_FOR_DELIVERY", { orderStatus: "READY" });
  // K: menunggu dijemput (AWAITING_PICKUP, job pickup baru dijadwalkan — driver belum berangkat)
  W.K = await mkUnit("AWAITING_PICKUP", { orderStatus: "PICKUP" }); await mkJob(W.K, "PICKUP", "SCHEDULED");
  // L: AWAITING_PICKUP tetapi job pickup SEDANG berlangsung (EN_ROUTE) -> Pengambilan
  W.L = await mkUnit("AWAITING_PICKUP", { orderStatus: "PICKUP" }); await mkJob(W.L, "PICKUP", "EN_ROUTE");
  return W;
}
const snapshotCounts = async () => ({
  handoffs: await testPrisma.unitCustodyHandoff.count(), runs: await testPrisma.productionRun.count(), phases: await testPrisma.productionPhaseRun.count(),
  ops: await testPrisma.productionOperationRun.count(), units: await testPrisma.unit.count(),
  statuses: JSON.stringify((await testPrisma.unit.findMany({ select: { unitCode: true, status: true }, orderBy: { unitCode: "asc" } }))),
});

test("backlog: tab Pengambilan / Diterima di Workshop / Diproses dihitung dari BUKTI, bukan dari status pickup; SEMUA = himpunan lama", async () => {
  const W = await world(); const before = await snapshotCounts();
  const code = (...us) => us.map((u) => u.unitCode).sort();
  const p = await backlog("?status=PENGAMBILAN&pageSize=100");
  assert.deepEqual(codesOf(p), code(W.A, W.G, W.H, W.L), "pickup selesai tanpa bukti + handoff baru ditawarkan + IN_TRANSIT_IN + job pickup EN_ROUTE");
  const mj = await backlog("?status=MENUNGGU_DIJEMPUT&pageSize=100");
  assert.deepEqual(codesOf(mj), code(W.K), "AWAITING_PICKUP tanpa job pickup berjalan");
  const d = await backlog("?status=DITERIMA_WORKSHOP&pageSize=100");
  assert.deepEqual(codesOf(d), code(W.B, W.C, W.D, W.I), "custody / konfirmasi petugas / lahir di workshop / operasi hanya SKIPPED");
  const x = await backlog("?status=DIPROSES&pageSize=100");
  assert.deepEqual(codesOf(x), code(W.E, W.F), "dimulai (operasi non-lewati) + histori V1 IN_PRODUCTION");
  const all = await backlog("?pageSize=100"); // default SEMUA = himpunan lama "Diproses" (unit order Diproses di workshop/sudah dijemput)
  assert.equal(all.status, "SEMUA");
  assert.deepEqual(codesOf(all), code(W.A, W.B, W.C, W.D, W.E, W.F, W.G, W.I));
  assert.deepEqual(all.counts, { SEMUA: 8, MENUNGGU_DIJEMPUT: 1, PENGAMBILAN: 4, DITERIMA_WORKSHOP: 4, DIPROSES: 2 });
  assert.ok(!codesOf(all).includes(W.J.unitCode) && !codesOf(all).includes(W.H.unitCode) && !codesOf(all).includes(W.K.unitCode));
  // read-only: tidak ada bukti/handoff/status yang dibuat atau diubah oleh membaca
  assert.deepEqual(await snapshotCounts(), before, "membaca backlog tidak menulis apa pun");
});

test("kartu backlog: status global + dasar bukti + status jadwal terpisah; histori tanpa bukti tampil 'Konfirmasi workshop belum tercatat'", async () => {
  const W = await world();
  const all = await backlog("?pageSize=100");
  const card = (u) => all.items.find((i) => i.card.unit.unitCode === u.unitCode).card;
  assert.equal(card(W.A).globalStatus.key, "PENGAMBILAN"); assert.equal(card(W.A).globalStatus.detail, "Pickup selesai — menunggu Terima Unit di Workshop");
  assert.equal(card(W.A).receivedBasis, null); assert.equal(card(W.A).presence.confirmed, false, "tidak ada kedatangan palsu");
  assert.equal(card(W.B).globalStatus.key, "DITERIMA_WORKSHOP"); assert.equal(card(W.B).receivedBasis, "CUSTODY"); assert.equal(card(W.B).presence.confirmed, true);
  assert.equal(card(W.C).receivedBasis, "STAFF_CONFIRMED"); assert.equal(card(W.C).presence.confirmed, true);
  assert.equal(card(W.D).receivedBasis, "BORN_IN_WORKSHOP");
  assert.equal(card(W.E).globalStatus.key, "DIPROSES"); assert.equal(card(W.E).receivedBasis, "CUSTODY");
  assert.equal(card(W.F).globalStatus.key, "DIPROSES"); assert.equal(card(W.F).globalStatus.detail, "Konfirmasi workshop belum tercatat"); assert.equal(card(W.F).presence.confirmed, false);
  assert.equal(card(W.G).globalStatus.key, "PENGAMBILAN", "handoff hanya DITAWARKAN");
  assert.equal(card(W.I).globalStatus.key, "DITERIMA_WORKSHOP", "operasi SKIPPED bukan pekerjaan yang dimulai");
  for (const u of [W.A, W.B, W.C, W.D, W.E, W.F, W.G, W.I]) assert.equal(card(u).scheduleStatus.key, "BELUM_DIJADWALKAN", "backlog = belum menempel ke meja; sumbu jadwal terpisah dari status global");
  // kosakata lama (displayStatus) tetap utuh: RECEIVED/IN_PRODUCTION tetap berlabel 'Diproses' di bidang lama — tidak diubah diam-diam
  assert.equal(card(W.A).unitStatus.label, "Diproses");
});

test("/work-orders: filter globalStatus berbasis bukti + globalStatusCounts + bidang per baris; displayStatus lama tidak berubah artinya", async () => {
  const W = await world(); const before = await snapshotCounts();
  const code = (...us) => us.map((u) => u.unitCode).sort();
  assert.deepEqual(woCodes(await wo("?globalStatus=PENGAMBILAN&pageSize=200")), code(W.A, W.G, W.H, W.L));
  assert.deepEqual(woCodes(await wo("?globalStatus=MENUNGGU_DIJEMPUT&pageSize=200")), code(W.K));
  assert.deepEqual(woCodes(await wo("?globalStatus=DITERIMA_WORKSHOP&pageSize=200")), code(W.B, W.C, W.D, W.I));
  assert.deepEqual(woCodes(await wo("?globalStatus=DIPROSES&pageSize=200")), code(W.E, W.F));
  assert.deepEqual(woCodes(await wo("?globalStatus=DITERIMA_WORKSHOP,DIPROSES&pageSize=200")), code(W.B, W.C, W.D, W.E, W.F, W.I));
  assert.deepEqual(woCodes(await wo("?globalStatus=SIAP_KIRIM&pageSize=200")), code(W.J));
  const r = await wo("?pageSize=200");
  assert.deepEqual(r.globalStatusCounts, { MENUNGGU_DIJEMPUT: 1, PENGAMBILAN: 4, DITERIMA_WORKSHOP: 4, DIPROSES: 2, SIAP_KIRIM: 1, DALAM_PENGIRIMAN: 0, TERKIRIM: 0 });
  assert.deepEqual(r.globalStatusFlow, ["MENUNGGU_DIJEMPUT", "PENGAMBILAN", "DITERIMA_WORKSHOP", "DIPROSES", "SIAP_KIRIM", "DALAM_PENGIRIMAN", "TERKIRIM"]);
  const row = (u) => r.units.find((x) => x.unitCode === u.unitCode);
  assert.equal(row(W.B).globalStatus.key, "DITERIMA_WORKSHOP"); assert.equal(row(W.B).receivedBasisLabel, "Diterima petugas lewat custody");
  assert.equal(row(W.A).globalStatus.key, "PENGAMBILAN"); assert.equal(row(W.A).presence.confirmed, false);
  // parameter lama: displayStatus=DIPROSES masih = unit tersimpan RECEIVED/IN_PRODUCTION (tidak diam-diam berubah)
  assert.deepEqual(woCodes(await wo("?displayStatus=DIPROSES&pageSize=200")), code(W.A, W.B, W.C, W.D, W.E, W.F, W.G, W.I));
  // statusIn mentah (untuk pemanggil teknis) divalidasi: nilai tak dikenal diabaikan
  assert.deepEqual(woCodes(await wo("?statusIn=IN_PRODUCTION,ASAL&pageSize=200")), code(W.F));
  assert.deepEqual(await snapshotCounts(), before, "membaca work-orders tidak menulis apa pun");
});

test("Dalam Pengiriman dipisah dari Siap Kirim: IN_TRANSIT_OUT = Dalam Pengiriman; DELIVERED = Terkirim", async () => {
  await truncateAll();
  const out = await mkUnit("IN_TRANSIT_OUT", { orderStatus: "SHIPPING" }); const done = await mkUnit("DELIVERED", { orderStatus: "DELIVERED" });
  const r = await wo("?pageSize=200");
  assert.equal(r.units.find((u) => u.unitCode === out.unitCode).globalStatus.key, "DALAM_PENGIRIMAN");
  assert.equal(r.units.find((u) => u.unitCode === done.unitCode).globalStatus.key, "TERKIRIM");
  assert.deepEqual(woCodes(await wo("?globalStatus=DALAM_PENGIRIMAN")), [out.unitCode]);
  assert.deepEqual(woCodes(await wo("?globalStatus=TERKIRIM")), [done.unitCode]);
  assert.equal(r.globalStatusCounts.DALAM_PENGIRIMAN, 1); assert.equal(r.globalStatusCounts.TERKIRIM, 1);
});
