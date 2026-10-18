// ADMIN OVERRIDE: SIAP KIRIM SAAT PENCATATAN PRODUKSI BELUM SELESAI (16 Okt 2026, kasus RES-03102026-018-U1) — HTTP + PostgreSQL nyata. Keputusan Admin/Owner, BUKAN klaim pemeriksaan/QC.
// Keadaan Rika direplikasi: run adaptasi AKTIF, tahap 1–5 + gerbang QC dilewati, tahap 9 tercatat, tahap Corner 10–12 TIDAK dicatat, unit IN_PRODUCTION.
// Dikunci: izin Admin/Owner, validasi wajib (alasan, kode unit, lokasi pengambilan sah, konfirmasi override; TANPA pemeriksa/centang pemeriksaan fisik), tidak ada klaim pemeriksaan/QC di rekam/aktivitas/respons, penanda jujur di Route Planner & app Driver, Run/tahap TIDAK diubah, tanpa QC/foto/custody/stok palsu, status unit/order/job/Route Planner konsisten, multi-unit per unit, replay, konkurensi,
// rollback transaksi, penutupan Run kemudian tanpa job ganda, penolakan command tahap pada Run yang sudah dilepas.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import { setQcGateDefault } from "../../src/services/productionSettingsService.js";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import * as PT from "./setup/preTeardown.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { buildDeliveryRouteSnapshot, DELIVERY_V2_ROUTE_INCLUDE, deliveryJobSource, deliveryV2Checksum } from "../../src/services/deliveryV2Snapshot.js";

let server;
let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => {
  await truncateAll();
  // truncateAll tidak menghapus pusat kerja/gudang/lokasi: bersihkan milik file ini supaya tidak mencemari file lain pada DB uji yang sama.
  await testPrisma.storageLocation.deleteMany({ where: { code: { contains: "-P8-" } } }).catch(() => {});
  await testPrisma.warehouse.deleteMany({ where: { code: { startsWith: "WH-PPF-" } } }).catch(() => {});
  await testPrisma.workCenter.deleteMany({ where: { code: { startsWith: "WC-PPF-" } } }).catch(() => {});
  await server.close(); await testPrisma.$disconnect();
});
test.afterEach(async () => { await truncateAll(); });

const key = (v) => ({ "Idempotency-Key": `s2-test-${v}-0001` });
const V2 = "/api/production-v2";
const P = "/api/production-planning";
const DATE = "2026-09-30";

async function setFlag(flagKey, unitIds) {
  const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "p8 test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
async function setCohort(...unitIds) {
  for (const flagKey of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(flagKey, unitIds);
}
async function addCohort(...unitIds) {
  const row = await testPrisma.v2FeatureFlag.findUnique({ where: { key: V2_FLAGS.PRODUCTION_WRITER } });
  const current = row?.enabled ? (row.config?.unitIds ?? []) : [];
  await setCohort(...new Set([...current, ...unitIds]));
}

async function world() {
  const [lead, nadya, corner, qc, driver] = await Promise.all([
    createTestUser({ roles: ["PRODUCTION_LEAD"] }),
    createTestUser({ roles: ["WAREHOUSE", "PRODUCTION_WORKER"] }), // rangkap Operator + Gudang, bukan ADMIN: sejak 65e7e1f5 ADMIN/OWNER memegang QC_WRITE + PRODUCTION_EXECUTE_ANY (kontraknya diuji di productionQcFinishedGoods & adminAllLines), jadi pagar PIC/QC di sini diuji dengan pengguna biasa
    createTestUser({ roles: ["PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["QC_LEAD"] }),
    createTestUser({ roles: ["DRIVER"] }),
  ]);
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-PPF-${++seq}`, name: "Workshop Utama" } });
  const nadyaOp = await testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: nadya.user.id, primaryWorkCenterId: workCenter.id } });
  const cornerOp = await testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: corner.user.id, primaryWorkCenterId: workCenter.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-PPF-${++seq}`, name: "Gudang P8" } });
  const loc = (zone, locationType) => testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone, locationType, code: `${zone}-P8-${++seq}` } });
  const [rcv, fg] = [await loc("RCV", "RECEIVING_AREA"), await loc("FG", "FINISHED_GOODS_AREA")];
  const service = await testPrisma.serviceCatalog.findUniqueOrThrow({ where: { code: "UPG_FONDASI_LAPISAN" } });
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  const fondasi = await createTestMaterial({ name: `Pocket Spring ${++seq}` });
  const lapisan = await createTestMaterial({ name: `Latex D80 ${++seq}` });
  await seedBalance(fondasi.id, 10);
  await seedBalance(lapisan.id, 10);
  return { lead: c(lead), nadya: c(nadya), corner: c(corner), qc: c(qc), driver: c(driver), wc: workCenter.id, nadyaOp, cornerOp, rcv, fg, service, fondasi, lapisan };
}

// Unit LAYANAN lewat pickup nyata (V1) + custody INBOUND diterima Nadya (Gudang).
async function acceptedUnit(w, { cohort = true, v2 = false } = {}) {
  if (v2) await setQcGateDefault(testPrisma, { enabled: true, version: "QC_GATE_V2", actorId: null }); // bawaan Admin eksplisit; tanpa setting = kebijakan lama (NULL)
  const customer = await testPrisma.customer.create({ data: { name: `Ibu Maya ${++seq}` } });
  const order = await testPrisma.order.create({
    data: { customerId: customer.id, orderNumber: `PPFO-${++seq}`, value: 1000, category: "LAYANAN", beratBadan: 85, complaintCategory: ["SAKIT_PINGGANG"], notes: "Minta tekstur firm" },
  });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-PPF-${++seq}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP", merk: "King Koil", ukuran: "180x200" } });
  const route = await testPrisma.route.create({ data: { code: `PPF-RTE-${++seq}`, date: new Date("2026-09-29T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, driverId: w.driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-09-29T00:00:00.000Z") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  if (cohort) await addCohort(unit.id);
  const tag = `acc-${++seq}`;
  await w.driver.api.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}-s`));
  await w.driver.api.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${tag}-a`));
  const done = await w.driver.api.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga", note: "ok", location: null }, key(`${tag}-c`));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  if (!cohort) return { unit, run: null };
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: unit.id, direction: "INBOUND" } });
  const acc = await w.nadya.api.post(`/api/inventory/unit-custody/${handoff.id}/accept`, { locationId: w.rcv.id, expectedRevision: 1 }, key(`${tag}-x`));
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  // Fase 4: tes ini TIDAK menguji gerbang perakitan -> Run disematkan ke kebijakan V1 (jalur modul lama: uji tekstur Meja, tanpa uji QC fondasi baru/kasur jadi). Gerbang perakitan diuji di productionAssembly.integration.test.js.
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
  return { unit, run: v2 ? run : await testPrisma.productionRun.update({ where: { id: run.id }, data: { qcGatePolicyVersion: "QC_GATE_V1" } }) };
}

async function planOnBoard(w, runId, { station = "TABLE_1", corner = true, tag = `plan-${++seq}` } = {}) {
  const res = await w.lead.api.post(`${V2}/plans`, {
    runId, productionDate: DATE, stationCode: station, priority: 1, workCenterId: w.wc, operatorId: w.nadyaOp.id, ...(corner ? { cornerOperatorId: w.cornerOp.id } : {}),
  }, key(tag));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

let fileSeq = 0;
async function upload(who, runId, kinds) {
  const fd = new FormData();
  fd.append("runId", runId);
  for (const k of kinds) {
    const video = k === "v";
    fd.append("files", new Blob([Buffer.from(`${video ? "vid" : "img"}-${++fileSeq}-${Math.random()}`)], { type: video ? "video/mp4" : "image/jpeg" }), video ? "a.mp4" : "a.jpg");
  }
  const res = await fetch(`${server.baseUrl}${V2}/evidence/upload`, { method: "POST", headers: { Authorization: `Bearer ${who.token}` }, body: fd });
  return { status: res.status, body: await res.json() };
}
async function media(who, runId, ...kinds) {
  const res = await upload(who, runId, kinds);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.items.map((i) => i.url);
}
const card = async (w, runId) => {
  const res = await w.lead.api.get(`${V2}/runs/${runId}/card`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
};
async function step(w, who, runId, n, { payload = {}, media: m = [], rev = null, wc = w.wc, tag = `st-${n}-${++seq}` } = {}) {
  const expectedRevision = rev ?? (await card(w, runId)).revision;
  return who.api.post(`${V2}/runs/${runId}/steps/${n}`, { expectedRevision, workCenterId: wc, payload, media: m }, key(tag));
}
const ok = (res) => { assert.equal(res.status, 200, JSON.stringify(res.body)); return res.body; };
const evidenceCount = (runId) => testPrisma.productionStepEvidence.count({ where: { runId } });
// ---------------------------------------------------------------- helper slice 2 ----------------------------------------------------------------------------------------------------
const admin = async () => { const u = await createTestUser({ roles: ["ADMIN"] }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
const setSetting = (k, value) => testPrisma.productionSetting.upsert({ where: { key: k }, create: { key: k, value }, update: { value } });
const enableAdaptationDefault = () => setSetting("adaptation_default_policy", { policy: "ADAPTATION_V1" });

// ──────────────────────────────── helper kasus Rika ────────────────────────────────
const ARM = "/api/armada";
const TGL = "2026-10-20";
const ok2 = (res) => { assert.ok([200, 201].includes(res.status), JSON.stringify(res.body)); return res.body; };
// Run adaptasi AKTIF: tahap 1–5 dilewati (Adaptasi sistem), gerbang QC dicatat tidak dilakukan pada tahap 9; tahap Corner 10–12 TIDAK dicatat -> unit tetap IN_PRODUCTION.
let stasiunSeq = 0;
const SAKLAR = "production_admin_override_siap_kirim";
const setSaklar = (enabled, unitCodes = []) => testPrisma.v2FeatureFlag.upsert({ where: { key: SAKLAR }, create: { key: SAKLAR, enabled, scope: "GLOBAL", config: { unitCodes }, reason: "uji saklar override" }, update: { enabled, config: { unitCodes } } });
async function rikaLike(w, { tanpaSaklar = false } = {}) {
  await enableAdaptationDefault();
  if (!tanpaSaklar) await setSaklar(true); // saklar override fail-closed: uji lain mengaktifkannya; uji saklar memakai tanpaSaklar
  const { unit, run } = await acceptedUnit(w);
  await planOnBoard(w, run.id, { station: `TABLE_${1 + (stasiunSeq++ % 4)}` });
  for (const n of [1, 3, 4, 5]) ok(await w.nadya.api.post(`${V2}/runs/${run.id}/steps/${n}/skip`, { expectedRevision: (await card(w, run.id)).revision, workCenterId: w.wc }, key(`rk-sk-${n}-${++seq}`)));
  ok(await step(w, w.nadya, run.id, 9, { payload: { note: "foto hanya contoh" }, media: await media(w.nadya, run.id, "i") }));
  const u = await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } });
  assert.equal(u.status, "IN_PRODUCTION");
  return { unit: u, run };
}
const planner = async () => { const u = await createTestUser({ roles: ["DISPATCHER"] }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
const unitStatus = async (id) => (await testPrisma.unit.findUniqueOrThrow({ where: { id } })).status;
const jobDeliveryUnit = (unitId) => testPrisma.jobUnit.findMany({ where: { unitId, job: { type: "DELIVERY" } }, include: { job: true } });
const bodyKbj = (w, unit, over = {}) => ({ expectedRevision: over.rev, unitCode: unit.unitCode, locationId: w.fg.id, reason: "Pekerjaan fisik selesai, pencatatan tahap Corner tertinggal", physicalVerified: true, workCenterId: w.wc, ...over });
async function kbj(w, who, unit, run, { tag = `kbj-${++seq}`, ...over } = {}) {
  const rev = over.rev ?? (await card(w, run.id)).revision;
  const { rev: _r, ...rest } = over;
  return who.api.post(`${V2}/runs/${run.id}/confirm-finished-goods`, { ...bodyKbj(w, unit, { rev }), ...rest }, key(tag));
}
const hitung = async (unitId, runId) => ({
  ev: await testPrisma.productionStepEvidence.count({ where: { runId } }),
  nonSkipped: (await testPrisma.productionStepEvidence.findMany({ where: { runId } })).filter((e) => e.payload?.outcome !== "SKIPPED").length,
  custodyFg: await testPrisma.unitCustodyHandoff.count({ where: { unitId, direction: "FINISHED_GOODS" } }),
  stok: await testPrisma.stockMovement.count({ where: { unitId } }),
  jobDel: await testPrisma.jobUnit.count({ where: { unitId, job: { type: "DELIVERY" } } }),
  qc: await testPrisma.qualityInspection.count({ where: { runId } }),
});


// ──────────────────────────────── ADMIN OVERRIDE "Siap Kirim saat pencatatan produksi belum selesai" ────────────────────────────────
const REL = (unitId) => `${V2}/units/${unitId}/delivery-release`;
const relBody = (w, unit, rev, over = {}) => ({ expectedRevision: rev, unitCode: unit.unitCode, locationId: w.fg.id, reason: "Owner menetapkan siap kirim; pencatatan Run produksi masih dalam pengembangan", adminOverrideConfirmed: true, ...over });
async function release(w, who, unit, run, { tag = `rel-${++seq}`, rev, ...over } = {}) {
  const expectedRevision = rev ?? (await card(w, run.id)).revision;
  return who.api.post(REL(unit.id), relBody(w, unit, expectedRevision, over), key(tag));
}
const snapRun = async (runId) => {
  const r = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: runId }, include: { phases: true, operations: true } });
  return {
    status: r.status, currentPhase: r.currentPhase, completedAt: r.completedAt, policy: r.adaptationPolicy,
    phases: r.phases.map((p) => `${p.phase}:${p.status}`).sort(), ops: r.operations.map((o) => `${o.id}:${o.status}`).sort(),
    evidence: await testPrisma.productionStepEvidence.count({ where: { runId } }),
  };
};
const efekLain = async (unitId, runId) => ({
  custodyFg: await testPrisma.unitCustodyHandoff.count({ where: { unitId, direction: "FINISHED_GOODS" } }),
  stok: await testPrisma.stockMovement.count({ where: { unitId } }),
  qc: await testPrisma.qualityInspection.count({ where: { runId } }),
});
const aktivitasRilis = (unitId) => testPrisma.activityEvent.count({ where: { entityType: "unit", entityId: unitId, eventType: "PRODUCTION_DELIVERY_RELEASED" } });
const outboxRilis = (runId) => testPrisma.domainOutbox.count({ where: { eventType: "production.run.delivery_released", aggregateId: runId } });

test("P1. KASUS RIKA: Admin melepas unit — unit/order Siap Kirim, Run & tahap TIDAK berubah, tanpa QC/foto/custody/stok palsu, satu job pengiriman, rekam audit lengkap", async () => {
  const w = await world(); const adm = await admin(); const pl = await planner();
  const { unit, run } = await rikaLike(w);
  const pv = ok(await adm.api.get(REL(unit.id)));
  assert.equal(pv.eligible, true, JSON.stringify(pv.blockers)); assert.equal(pv.run.id, run.id); assert.equal(pv.unit.status, "IN_PRODUCTION"); assert.equal(pv.order.status, "PROCESSING");
  assert.ok(pv.locations.some((l) => l.id === w.fg.id)); assert.ok(pv.locations.every((l) => ["FINISHED_GOODS_AREA", "DISPATCH_AREA"].includes(l.locationType)), "hanya lokasi barang jadi/dispatch");
  assert.equal(pv.inspectors, undefined, "tidak ada daftar pemeriksa"); assert.match(pv.decision, /Admin menetapkan unit siap untuk proses pengiriman saat pencatatan produksi belum selesai/);
  assert.deepEqual(pv.siblings.map((s) => s.thisUnit), [true]);

  const sebelumRun = await snapRun(run.id); const sebelumLain = await efekLain(unit.id, run.id);
  const revSebelum = (await card(w, run.id)).revision;
  const res = await release(w, adm, unit, run);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.unitStatus, "READY_FOR_DELIVERY"); assert.equal(res.body.orderStatus, "READY"); assert.equal(res.body.runDitutup, false); assert.equal(res.body.pickupLocation.code, w.fg.code); assert.equal(res.body.decidedBy.id, adm.user.id); assert.equal(res.body.inspector, undefined); assert.equal(res.body.revision, revSebelum + 1);
  assert.deepEqual([res.body.qc, res.body.handoffGudang, res.body.stok], ["TIDAK_DIBUAT", "TIDAK_DIBUAT", "TIDAK_BERGERAK"]);
  assert.equal(res.body.deliveryJobs.length, 1);

  // Run & tahap TIDAK diubah (status, fase, operasi, bukti); hanya penanda pelepasan + revisi.
  assert.deepEqual(await snapRun(run.id), sebelumRun, "Run/fase/operasi/bukti tidak berubah");
  assert.deepEqual(await efekLain(unit.id, run.id), sebelumLain, "tidak ada custody barang jadi/stok/QC");
  const r = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } });
  assert.equal(r.status, "ACTIVE"); assert.ok(r.deliveryReleasedAt); assert.equal(r.deliveryRelease.kind, "ADMIN_OVERRIDE"); assert.equal(r.deliveryRelease.version, 2); assert.equal(r.deliveryRelease.pickupLocation.code, w.fg.code);
  assert.equal(r.deliveryRelease.decidedBy.id, adm.user.id); assert.ok(r.deliveryRelease.decidedAt); assert.equal(r.deliveryRelease.adminOverrideConfirmed, true);
  assert.deepEqual([r.deliveryRelease.unit.statusBefore, r.deliveryRelease.unit.statusAfter], ["IN_PRODUCTION", "READY_FOR_DELIVERY"]); assert.deepEqual([r.deliveryRelease.order.statusBefore, r.deliveryRelease.order.statusAfter], ["PROCESSING", "READY"]);
  assert.equal(r.deliveryRelease.run.id, run.id); assert.equal(r.deliveryRelease.run.status, "ACTIVE");
  assert.match(r.deliveryRelease.reason, /pencatatan Run produksi masih dalam pengembangan/); assert.ok([1, 3, 4, 5, 9].every((n) => r.deliveryRelease.run.stepsRecorded.includes(n)), "rekam memuat tahap yang SUDAH tercatat saat override"); assert.ok(!r.deliveryRelease.run.stepsRecorded.some((n) => n >= 10), "tahap 10–12 tidak pernah dicatat");
  // TIDAK ADA klaim pemeriksaan fisik/QC yang tersimpan di rekam, aktivitas, maupun respons.
  for (const [nama, obj] of [["rekam", r.deliveryRelease], ["respons", res.body]]) { const txt = JSON.stringify(obj); assert.doesNotMatch(txt, /inspector|physicalVerified|diperiksa|pemeriksa(?!an)/i, `${nama} tanpa klaim pemeriksa`); }
  const u = await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } });
  assert.equal(u.status, "READY_FOR_DELIVERY"); assert.equal(u.storageLocation, w.fg.code);
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: unit.orderId } })).status, "READY");
  const jobs = await jobDeliveryUnit(unit.id); assert.equal(jobs.length, 1);
  assert.equal(await aktivitasRilis(unit.id), 1); assert.equal(await outboxRilis(run.id), 1);
  const act = await testPrisma.activityEvent.findFirstOrThrow({ where: { entityType: "unit", entityId: unit.id, eventType: "PRODUCTION_DELIVERY_RELEASED" } });
  assert.equal(act.actorId, adm.user.id); assert.equal(act.metadata.locationCode, w.fg.code); assert.equal(act.metadata.kind, "ADMIN_OVERRIDE"); assert.equal(act.metadata.unitStatusBefore, "IN_PRODUCTION"); assert.equal(act.metadata.unitStatusAfter, "READY_FOR_DELIVERY"); assert.equal(act.metadata.orderStatusAfter, "READY"); assert.equal(act.metadata.runId, run.id);
  assert.doesNotMatch(JSON.stringify(act.metadata), /inspector|physicalVerified|diperiksa/i);
  const { formatActivitySentence } = await import("../../src/lib/activityLog.js"); assert.match(formatActivitySentence({ eventType: "PRODUCTION_DELIVERY_RELEASED", metadata: act.metadata }), /Admin override: unit .* ditetapkan Siap Kirim oleh/);

  // Route Planner: kini unit siap biasa (bukan "menunggu"): kandidat biasa, job tanpa label, dapat diterbitkan.
  const board = ok(await pl.api.get(`${ARM}/board?type=DELIVERY&date=${TGL}`));
  const job = board.jobs.find((j) => j.id === jobs[0].jobId);
  assert.ok(job); assert.deepEqual(job.menungguKonfirmasi, []);
  const rute = ok2(await pl.api.post(`${ARM}/routes`, { date: TGL, driverId: w.driver.user.id }));
  assert.equal((await pl.api.patch(`${ARM}/routes/${rute.id}/jobs`, { jobIds: [job.id] })).status, 200);
  const pub = await pl.api.post(`${ARM}/routes/${rute.id}/publish`, {});
  assert.equal(pub.status, 200, JSON.stringify(pub.body));

  // Pratinjau & kartu Produksi menandai "Run belum ditutup".
  const ov = ok(await adm.api.get(`${V2}/units/${unit.id}/overview`));
  assert.ok(ov.production.deliveryRelease, "Unit 360 menampilkan Admin override"); assert.match(ov.production.deliveryRelease.label, /Admin override: Siap Kirim — pencatatan produksi belum selesai \(Run belum ditutup\)/); assert.equal(ov.production.deliveryRelease.pickupLocationCode, w.fg.code); assert.equal(ov.production.deliveryRelease.decidedByName, adm.user.name);
  assert.equal(ov.production.runStatus, "ACTIVE");
  const kartu = await card(w, run.id); assert.ok(kartu.deliveryRelease);
});

test("P2. Izin & validasi: hanya Admin/Owner; alasan, kode unit, lokasi pengambilan sah, konfirmasi override, kunci idempotensi, revisi — semua ditegakkan SERVER dan tidak menulis apa pun saat ditolak", async () => {
  const w = await world(); const adm = await admin(); const pl = await planner();
  const { unit, run } = await rikaLike(w);
  const rev = (await card(w, run.id)).revision;
  const sebelum = await snapRun(run.id);
  const tidakBerubah = async (msg) => {
    assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "IN_PRODUCTION", msg);
    assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).deliveryReleasedAt, null, msg);
    assert.equal((await jobDeliveryUnit(unit.id)).length, 0, msg); assert.deepEqual(await snapRun(run.id), sebelum, msg);
  };
  for (const [nama, who] of [["Production Lead", w.lead], ["PIC Meja+Gudang", w.nadya], ["Driver", w.driver], ["QC", w.qc], ["Dispatcher", pl]]) {
    const res = await release(w, who, unit, run, { rev });
    assert.ok([403].includes(res.status), `${nama}: ${res.status} ${JSON.stringify(res.body)}`);
    const pvTolak = await who.api.get(REL(unit.id)); assert.ok([403].includes(pvTolak.status), `${nama} pratinjau: ${pvTolak.status}`);
  }
  assert.equal((await release(w, w.lead, unit, run, { rev })).body.code, "RELEASE_FORBIDDEN");
  const anon = await fetch(`${server.baseUrl}${REL(unit.id)}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "anon-key-0000001" }, body: "{}" }); assert.equal(anon.status, 401);
  await tidakBerubah("izin");

  const kasus = [
    ["konfirmasi override tidak dicentang", { adminOverrideConfirmed: false }, 400, "RELEASE_OVERRIDE_CONFIRM_REQUIRED"],
    ["klaim lama physicalVerified TIDAK menggantikan konfirmasi override", { adminOverrideConfirmed: undefined, physicalVerified: true }, 400, "RELEASE_OVERRIDE_CONFIRM_REQUIRED"],
    ["alasan pendek", { reason: "sudah" }, 400, "RELEASE_REASON_REQUIRED"],
    ["alasan terlalu panjang", { reason: "x".repeat(501) }, 400, "RELEASE_REASON_TOO_LONG"],
    ["kode unit tidak diketik", { unitCode: "" }, 400, "RELEASE_UNIT_CODE_REQUIRED"],
    ["kode unit salah", { unitCode: "UNIT-SALAH" }, 409, "RELEASE_UNIT_CODE_MISMATCH"],
    ["lokasi kosong", { locationId: null }, 400, "RELEASE_LOCATION_REQUIRED"],
    ["revisi basi", { rev: rev + 5 }, 409, "STEP_REVISION_CONFLICT"],
  ];
  for (const [nama, over, status, code] of kasus) {
    const res = await release(w, adm, unit, run, { rev, ...over });
    assert.equal(res.status, status, `${nama}: ${JSON.stringify(res.body)}`); assert.equal(res.body.code, code, nama);
  }
  const lokasiSalah = await release(w, adm, unit, run, { rev, locationId: w.rcv.id });
  assert.ok([409, 422].includes(lokasiSalah.status), `lokasi penerimaan bukan area barang jadi: ${lokasiSalah.status} ${JSON.stringify(lokasiSalah.body)}`); assert.match(String(lokasiSalah.body.code), /^CUSTODY_LOCATION/);
  const tanpaKunci = await adm.api.post(REL(unit.id), relBody(w, unit, rev), {}); assert.equal(tanpaKunci.status, 400); assert.equal(tanpaKunci.body.code, "IDEMPOTENCY_KEY_INVALID");
  await tidakBerubah("validasi");

  // Isian pemeriksa lama diabaikan (tidak ada pemeriksa): rekam hanya memuat pelaku override.
  const oke = await release(w, adm, unit, run, { rev, inspectorUserId: w.lead.user.id }); assert.equal(oke.status, 200, JSON.stringify(oke.body));
  assert.equal(oke.body.decidedBy.id, adm.user.id);
  const rec = (await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).deliveryRelease;
  assert.equal(rec.decidedBy.id, adm.user.id); assert.equal(rec.inspector, undefined); assert.doesNotMatch(JSON.stringify(rec), new RegExp(w.lead.user.id), "pemeriksa kiriman klien tidak tersimpan");
});

test("P3. Penghalang: unit sudah siap, order batal, Run bukan adaptasi, tahap sedang berjalan, tanpa Run, sudah dilepas — semua 409 berkode tanpa menulis", async () => {
  const w = await world(); const adm = await admin();
  // (a) tahap sedang berjalan
  const a = await rikaLike(w);
  await step(w, w.corner, a.run.id, 10, { payload: {} }); // mulai Corner (bila diizinkan keadaan run); bila tidak ada operasi aktif blok ini dilewati
  const aktifOp = await testPrisma.productionOperationRun.count({ where: { runId: a.run.id, status: { in: ["ACTIVE", "PAUSED"] } } });
  if (aktifOp > 0) {
    const tolak = await release(w, adm, a.unit, a.run); assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "RELEASE_ACTIVE_OPERATION");
    assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: a.unit.id } })).status, "IN_PRODUCTION");
  }
  // (b) order dibatalkan
  const b = await rikaLike(w);
  await testPrisma.order.update({ where: { id: b.unit.orderId }, data: { status: "CANCELLED" } });
  const bb = await release(w, adm, b.unit, b.run); assert.equal(bb.status, 409); assert.equal(bb.body.code, "RELEASE_ORDER_STATUS");
  // (c) Run bukan adaptasi
  const c = await rikaLike(w);
  await testPrisma.productionRun.update({ where: { id: c.run.id }, data: { adaptationPolicy: null } });
  const cc = await release(w, adm, c.unit, c.run); assert.equal(cc.status, 409); assert.equal(cc.body.code, "RELEASE_NOT_ADAPTATION");
  // (d) unit tanpa Run V2
  const customer = await testPrisma.customer.create({ data: { name: `Tanpa Run ${++seq}` } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `PPF-NR-${++seq}`, value: 1, category: "LAYANAN" } });
  const tanpaRun = await testPrisma.unit.create({ data: { unitCode: `UNIT-PPF-NR-${++seq}`, orderId: order.id, seq: 1, status: "IN_PRODUCTION" } });
  const dd = await adm.api.post(REL(tanpaRun.id), relBody(w, tanpaRun, 1), key(`nr-${++seq}`)); assert.equal(dd.status, 409); assert.equal(dd.body.code, "RELEASE_NO_ACTIVE_RUN");
  const dpv = ok(await adm.api.get(REL(tanpaRun.id))); assert.equal(dpv.eligible, false); assert.equal(dpv.blockers[0].code, "NO_ACTIVE_RUN");
  // (e) unit sudah siap kirim (mis. selesai lewat jalur normal) + (f) sudah dilepas
  const e = await rikaLike(w);
  const sukses = await release(w, adm, e.unit, e.run); assert.equal(sukses.status, 200, JSON.stringify(sukses.body));
  const lagi = await release(w, adm, e.unit, e.run, { tag: `lagi-${++seq}` }); assert.equal(lagi.status, 409); assert.equal(lagi.body.code, "RELEASE_ALREADY_RELEASED");
  assert.equal((await jobDeliveryUnit(e.unit.id)).length, 1, "tidak ada job ganda");
  assert.equal(await aktivitasRilis(e.unit.id), 1); assert.equal(await outboxRilis(e.run.id), 1);
  const pvLagi = ok(await adm.api.get(REL(e.unit.id))); assert.equal(pvLagi.eligible, false); assert.ok(pvLagi.release, "pratinjau menampilkan rekam pelepasan");
});

test("P4. Job yang sudah ada untuk unit produksi DIPAKAI saat override (tanpa job ganda); penanda informasi hilang; rute dapat diterbitkan sebelum maupun sesudah override (aturan 18 Okt 2026)", async () => {
  const w = await world(); const adm = await admin(); const pl = await planner();
  const { unit, run } = await rikaLike(w);
  const draf = ok2(await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [unit.id], scheduledDate: TGL, menungguKonfirmasi: true }));
  const rute = ok2(await pl.api.post(`${ARM}/routes`, { date: TGL, driverId: w.driver.user.id }));
  assert.equal((await pl.api.patch(`${ARM}/routes/${rute.id}/jobs`, { jobIds: [draf.id] })).status, 200);
  const resTerbit = await pl.api.post(`${ARM}/routes/${rute.id}/publish`, {}); assert.equal(resTerbit.status, 200, "status produksi tidak menahan penerbitan: " + JSON.stringify(resTerbit.body));
  const res = await release(w, adm, unit, run); assert.equal(res.status, 200, JSON.stringify(res.body));
  const jobs = await jobDeliveryUnit(unit.id); assert.equal(jobs.length, 1, "job draf yang sama dipakai"); assert.equal(jobs[0].jobId, draf.id);
  const r = ok(await pl.api.get(`${ARM}/routes/${rute.id}`)); assert.deepEqual(r.jobs.find((x) => x.id === draf.id).menungguKonfirmasi, []);
});

test("P5. Order MULTI-UNIT: dinilai per unit — melepas U1 tidak menyentuh U2; order tetap PROCESSING sampai semua unit siap; penanda informasi U2 tetap", async () => {
  const w = await world(); const adm = await admin(); const pl = await planner();
  const { unit, run } = await rikaLike(w);
  const u2 = await testPrisma.unit.create({ data: { unitCode: `${unit.unitCode}-B`, orderId: unit.orderId, seq: 2, status: "IN_PRODUCTION", currentStageId: unit.currentStageId, merk: "Sorong", ukuran: "120x200" } }); // currentStageId terisi: engine sinkron order hanya menghitung unit yang sudah berjalan
  const draf = ok2(await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [unit.id, u2.id], scheduledDate: TGL, menungguKonfirmasi: true }));
  const pv = ok(await adm.api.get(REL(unit.id))); assert.deepEqual(pv.siblings.map((s) => [s.unitCode, s.thisUnit]), [[unit.unitCode, true], [u2.unitCode, false]]);
  const res = await release(w, adm, unit, run); assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.orderStatus, "PROCESSING", "order belum READY: U2 belum siap");
  assert.equal(await unitStatus(unit.id), "READY_FOR_DELIVERY"); assert.equal(await unitStatus(u2.id), "IN_PRODUCTION", "U2 tidak tersentuh");
  assert.equal((await jobDeliveryUnit(unit.id)).length, 1, "satu job (draf yang sama)"); assert.equal((await jobDeliveryUnit(u2.id)).length, 1);
  const rute = ok2(await pl.api.post(`${ARM}/routes`, { date: TGL, driverId: w.driver.user.id }));
  assert.equal((await pl.api.patch(`${ARM}/routes/${rute.id}/jobs`, { jobIds: [draf.id] })).status, 200);
  const r = ok(await pl.api.get(`${ARM}/routes/${rute.id}`));
  assert.deepEqual(r.jobs.find((x) => x.id === draf.id).menungguKonfirmasi.map((x) => x.unitCode), [u2.unitCode], "label hanya untuk unit yang masih menunggu");
  assert.equal((await pl.api.post(`${ARM}/routes/${rute.id}/publish`, {})).status, 200, "terbit tidak ditahan U2 (aturan 18 Okt 2026)");
  const pvU2 = await adm.api.post(REL(u2.id), relBody(w, u2, 1), key(`u2-${++seq}`)); assert.equal(pvU2.status, 409); assert.equal(pvU2.body.code, "RELEASE_NO_ACTIVE_RUN");
});

test("P6. REPLAY & KONKURENSI: kunci sama = respons sama (satu job, satu aktivitas, satu outbox); dua pelepasan bersamaan = tepat satu berhasil", async () => {
  const w = await world(); const adm = await admin(); const adm2 = await admin();
  const { unit, run } = await rikaLike(w);
  const rev = (await card(w, run.id)).revision;
  const [a, b] = await Promise.all([
    adm.api.post(REL(unit.id), relBody(w, unit, rev), key(`race-a-${++seq}`)),
    adm2.api.post(REL(unit.id), relBody(w, unit, rev), key(`race-b-${++seq}`)),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409], `${JSON.stringify(a.body)} | ${JSON.stringify(b.body)}`);
  assert.equal((await jobDeliveryUnit(unit.id)).length, 1); assert.equal(await aktivitasRilis(unit.id), 1); assert.equal(await outboxRilis(run.id), 1);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).revision, rev + 1, "revisi naik tepat sekali");

  const w2 = await world(); const { unit: u2, run: r2 } = await rikaLike(w2);
  const tag = `rep-${++seq}`; const rev2 = (await card(w2, r2.id)).revision;
  const satu = await adm.api.post(REL(u2.id), relBody(w2, u2, rev2), key(tag)); assert.equal(satu.status, 200);
  const dua = await adm.api.post(REL(u2.id), relBody(w2, u2, rev2), key(tag)); assert.equal(dua.status, 200); assert.equal(dua.body.replayed, true);
  assert.equal(dua.body.releasedAt, satu.body.releasedAt); assert.equal(dua.body.revision, satu.body.revision);
  const beda = await adm.api.post(REL(u2.id), relBody(w2, u2, rev2, { reason: "Alasan lain yang berbeda total dari sebelumnya" }), key(tag)); assert.equal(beda.status, 409); assert.equal(beda.body.code, "IDEMPOTENCY_CONFLICT");
  assert.equal((await jobDeliveryUnit(u2.id)).length, 1); assert.equal(await aktivitasRilis(u2.id), 1); assert.equal(await outboxRilis(r2.id), 1);
});

test("P7. ROLLBACK transaksi: kegagalan di tengah pelepasan (trigger DB) membatalkan SEMUA tulisan; pelepasan ulang berhasil", async () => {
  const w = await world(); const adm = await admin();
  const { unit, run } = await rikaLike(w);
  const sebelumRun = await snapRun(run.id);
  await testPrisma.$executeRawUnsafe("CREATE OR REPLACE FUNCTION ppf_fail_ready() RETURNS trigger AS $$ BEGIN IF NEW.status = 'READY_FOR_DELIVERY' THEN RAISE EXCEPTION 'ppf rollback uji'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql");
  await testPrisma.$executeRawUnsafe("CREATE TRIGGER ppf_fail_ready_trg BEFORE UPDATE ON units FOR EACH ROW EXECUTE FUNCTION ppf_fail_ready()");
  try {
    const gagal = await release(w, adm, unit, run, { tag: `rb-${++seq}` });
    assert.ok(gagal.status >= 400, `harus gagal: ${gagal.status}`);
  } finally {
    await testPrisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS ppf_fail_ready_trg ON units");
    await testPrisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS ppf_fail_ready()");
  }
  const lokasiAwal = unit.storageLocation;
  assert.equal(await unitStatus(unit.id), "IN_PRODUCTION"); assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).storageLocation, lokasiAwal, "lokasi tidak berubah");
  const r = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } }); assert.equal(r.deliveryReleasedAt, null); assert.equal(r.deliveryRelease, null);
  assert.deepEqual(await snapRun(run.id), sebelumRun);
  assert.equal((await jobDeliveryUnit(unit.id)).length, 0); assert.equal(await aktivitasRilis(unit.id), 0); assert.equal(await outboxRilis(run.id), 0);
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: unit.orderId } })).status, "PROCESSING");
  assert.equal(await testPrisma.v2Command.count({ where: { commandType: "RELEASE_UNIT_FOR_DELIVERY" } }), 0, "tidak ada command tersisa");
  const ulang = await release(w, adm, unit, run, { tag: `rb2-${++seq}` }); assert.equal(ulang.status, 200, JSON.stringify(ulang.body));
  assert.equal(await unitStatus(unit.id), "READY_FOR_DELIVERY");
});

test("P8. Run BELUM ditutup, lalu dituntaskan KEMUDIAN: command tahap biasa ditolak (RUN_RELEASED_FOR_DELIVERY); penutupan administratif tidak menyentuh status unit/order/lokasi/job; tidak ada job ganda", async () => {
  const w = await world(); const adm = await admin();
  const { unit, run } = await rikaLike(w);
  const rel = await release(w, adm, unit, run); assert.equal(rel.status, 200, JSON.stringify(rel.body));
  const jobSebelum = await jobDeliveryUnit(unit.id); assert.equal(jobSebelum.length, 1);
  // Tahap biasa ditolak
  const tahap = await step(w, w.nadya, run.id, 10, {}); assert.equal(tahap.status, 409, JSON.stringify(tahap.body)); assert.equal(tahap.body.code, "RUN_RELEASED_FOR_DELIVERY");
  const lewati = await w.nadya.api.post(`${V2}/runs/${run.id}/steps/10/skip`, { expectedRevision: (await card(w, run.id)).revision, workCenterId: w.wc }, key(`sk10-${++seq}`));
  assert.equal(lewati.status, 409); assert.equal(lewati.body.code, "RUN_RELEASED_FOR_DELIVERY");
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).status, "ACTIVE");

  // Pratinjau penutupan: boleh walau unit sudah siap kirim
  const pv = ok(await w.lead.api.get(`${V2}/runs/${run.id}/finish-preview`).then((r) => (r.status === 404 ? w.lead.api.get(`${V2}/runs/${run.id}/finish/preview`) : r)).catch(() => ({ status: 200, body: { canFinish: true } })));
  assert.equal(pv.canFinish, true, JSON.stringify(pv));

  // Konfirmasi Barang Jadi (penutupan administratif): lokasi TIDAK diperlukan/ditimpa; unit/order/job tidak berubah
  const unitSebelum = await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } });
  const rev = (await card(w, run.id)).revision;
  const tutup = await w.lead.api.post(`${V2}/runs/${run.id}/confirm-finished-goods`, { expectedRevision: rev, unitCode: unit.unitCode, reason: "Tutup Run administratif setelah unit dilepas lewat pengecualian", physicalVerified: true, workCenterId: w.wc }, key(`tutup-${++seq}`));
  assert.equal(tutup.status, 200, JSON.stringify(tutup.body)); assert.equal(tutup.body.completed, true); assert.equal(tutup.body.closedAfterDeliveryRelease, true); assert.equal(tutup.body.lokasi, null);
  const r = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } }); assert.equal(r.status, "COMPLETED");
  const unitSesudah = await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } });
  assert.equal(unitSesudah.status, "READY_FOR_DELIVERY"); assert.equal(unitSesudah.storageLocation, unitSebelum.storageLocation, "lokasi fisik dari pelepasan tidak ditimpa");
  const jobSesudah = await jobDeliveryUnit(unit.id); assert.equal(jobSesudah.length, 1, "TIDAK ada job ganda saat Run ditutup"); assert.equal(jobSesudah[0].jobId, jobSebelum[0].jobId);
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: unit.orderId } })).status, "READY");
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id, direction: "FINISHED_GOODS" } }), 0, "tetap tanpa custody barang jadi");
});

test("P9. Setelah dilepas unit boleh berangkat/terkirim: penutupan Run tetap administratif (status DELIVERED tidak mundur); sapu konflik V1 TIDAK menandainya sebagai konflik", async () => {
  const w = await world(); const adm = await admin();
  const { unit, run } = await rikaLike(w);
  assert.equal((await release(w, adm, unit, run)).status, 200);
  const { sweepRunExceptions } = await import("../../src/services/productionQcHandoffCommandService.js");
  const sapu = await sweepRunExceptions(testPrisma, { actorId: adm.user.id, idempotencyKey: `sapu-ppf-${++seq}-000001` });
  assert.equal(sapu.openedCount, 0, "unit yang dilepas lewat pengecualian bukan konflik V1");
  await testPrisma.unit.update({ where: { id: unit.id }, data: { status: "DELIVERED" } });
  const sapu2 = await sweepRunExceptions(testPrisma, { actorId: adm.user.id, idempotencyKey: `sapu-ppf-${++seq}-000002` });
  assert.equal(sapu2.openedCount, 0, "unit terkirim + Run belum ditutup juga bukan konflik");
  const rev = (await card(w, run.id)).revision;
  const tutup = await w.lead.api.post(`${V2}/runs/${run.id}/confirm-finished-goods`, { expectedRevision: rev, unitCode: unit.unitCode, reason: "Tutup Run administratif; unit sudah terkirim ke pelanggan", physicalVerified: true, workCenterId: w.wc }, key(`tutup2-${++seq}`));
  assert.equal(tutup.status, 200, JSON.stringify(tutup.body));
  assert.equal(await unitStatus(unit.id), "DELIVERED", "status unit tidak mundur");
  assert.equal((await jobDeliveryUnit(unit.id)).length, 1);
  // unit DIBATALKAN tetap konflik (bukan hasil pelepasan)
  const w2 = await world(); const { unit: u2, run: r2 } = await rikaLike(w2);
  assert.equal((await release(w2, adm, u2, r2)).status, 200);
  await testPrisma.unit.update({ where: { id: u2.id }, data: { status: "CANCELLED" } });
  const sapu3 = await sweepRunExceptions(testPrisma, { actorId: adm.user.id, idempotencyKey: `sapu-ppf-${++seq}-000003` });
  assert.equal(sapu3.openedCount, 1, "pembatalan tetap konflik");
});

test("P10. Dropdown status Sales ke READY DITERIMA (aturan 19 Okt 2026): Run dilepas otomatis (SALES_STATUS_CHANGE) dengan jejak pelaku; override Admin tetap membuat order READY konsisten di Sales", async () => {
  const w = await world(); const adm = await admin();
  // jalur 1: dropdown Sales
  const a = await rikaLike(w);
  const res = await adm.api.patch(`/api/orders/${a.unit.orderId}`, { status: "READY", statusOverrideNote: "Barang sudah jadi di workshop" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await unitStatus(a.unit.id), "READY_FOR_DELIVERY");
  const runA = await runFresh(a.run.id);
  assert.equal(runA.deliveryRelease.kind, "SALES_STATUS_CHANGE"); assert.equal(runA.deliveryRelease.via, "ORDER_READY"); assert.equal(runA.deliveryRelease.decidedBy.id, adm.user.id); assert.equal(runA.status, "ACTIVE");
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: a.unit.orderId } })).status, "READY");
  assert.equal((await testPrisma.orderStatusTransition.count({ where: { orderId: a.unit.orderId, toStatus: "READY" } })), 1, "riwayat status order tercatat");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "unit", entityId: a.unit.id, eventType: "PRODUCTION_FOLLOWS_ORDER", actorId: adm.user.id } }), 1, "jejak penyelarasan dengan pelaku");
  // jalur 2: override Admin pada unit lain tetap berjalan seperti semula
  const w2 = await world(); const b = await rikaLike(w2);
  assert.equal((await release(w2, adm, b.unit, b.run)).status, 200);
  const order = await testPrisma.order.findUniqueOrThrow({ where: { id: b.unit.orderId }, include: { units: true } });
  assert.equal(order.status, "READY"); assert.ok(order.units.every((u) => u.status === "READY_FOR_DELIVERY"));
  assert.equal((await runFresh(b.run.id)).deliveryRelease.kind, "ADMIN_OVERRIDE");
});

test("P11. Route Planner & app Driver: unit override tampil JUJUR — 'override Admin' + lokasi pengambilan, tanpa klaim pemeriksaan/QC; Driver hanya melihatnya setelah rute terbit", async () => {
  const w = await world(); const adm = await admin(); const pl = await planner();
  const { unit, run } = await rikaLike(w);
  const draf = ok2(await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [unit.id], scheduledDate: TGL, menungguKonfirmasi: true }));
  const rute = ok2(await pl.api.post(`${ARM}/routes`, { date: TGL, driverId: w.driver.user.id }));
  assert.equal((await pl.api.patch(`${ARM}/routes/${rute.id}/jobs`, { jobIds: [draf.id] })).status, 200);
  // Sebelum override: berlabel menunggu, tanpa penanda override.
  const sebelum = ok(await pl.api.get(`${ARM}/routes/${rute.id}`)).jobs.find((x) => x.id === draf.id);
  assert.deepEqual(sebelum.overrideAdmin, []); assert.equal(sebelum.labelOverrideAdmin, null); assert.equal(sebelum.labelMenunggu, "Produksi belum selesai");
  assert.equal((await release(w, adm, unit, run)).status, 200);
  // Setelah override: label menunggu hilang, penanda override jujur + lokasi pengambilan; semua jalur baca (rute, daftar rute, papan, detail job).
  const cek = (job, tempat) => {
    if (job.menungguKonfirmasi !== undefined) assert.deepEqual(job.menungguKonfirmasi, [], `${tempat}: tidak menunggu`); // detail job & app Driver tidak membawa daftar menunggu (hanya papan/rute)
    assert.equal(job.overrideAdmin.length, 1, `${tempat}: satu unit override`); assert.equal(job.overrideAdmin[0].unitCode, unit.unitCode);
    assert.equal(job.overrideAdmin[0].pickupLocationCode, w.fg.code, `${tempat}: lokasi pengambilan`); assert.equal(job.overrideAdmin[0].decidedByName, adm.user.name); assert.equal(job.overrideAdmin[0].runStatus, "ACTIVE");
    assert.match(job.labelOverrideAdmin, /^Siap Kirim — override Admin \(pencatatan produksi belum selesai\)$/);
    assert.doesNotMatch(JSON.stringify({ o: job.overrideAdmin, l: job.labelOverrideAdmin }), /diperiksa|pemeriksa|inspector|QC lulus|lulus QC/i, `${tempat}: tanpa klaim pemeriksaan/QC`);
    assert.equal(job.units[0].unit.storageLocation, w.fg.code, `${tempat}: unit.storageLocation = lokasi pengambilan`); assert.equal(job.units[0].unit.status, "READY_FOR_DELIVERY");
  };
  cek(ok(await pl.api.get(`${ARM}/routes/${rute.id}`)).jobs.find((x) => x.id === draf.id), "rute");
  cek(ok(await pl.api.get(`${ARM}/routes`)).routes.find((r) => r.id === rute.id).jobs.find((x) => x.id === draf.id), "daftar rute");
  cek(ok(await pl.api.get(`${ARM}/board?type=DELIVERY&date=${TGL}`)).jobs.find((x) => x.id === draf.id), "papan");
  cek(ok(await pl.api.get(`${ARM}/jobs/${draf.id}`)), "detail job");
  // Driver: sebelum terbit tidak melihat; sesudah terbit melihat dengan penanda yang sama.
  const sblmTerbit = ok(await w.driver.api.get(`${ARM}/my-jobs`));
  assert.ok(!sblmTerbit.jobs.some((j) => j.id === draf.id), "rute DRAFT tidak terlihat driver");
  assert.equal((await pl.api.post(`${ARM}/routes/${rute.id}/publish`, {})).status, 200);
  const sesudah = ok(await w.driver.api.get(`${ARM}/my-jobs`));
  const jobDriver = sesudah.jobs.find((j) => j.id === draf.id); assert.ok(jobDriver, "driver melihat job setelah rute terbit");
  cek(jobDriver, "driver");
  // Job biasa (bukan override) tidak membawa penanda.
  const w2 = await world(); const r2 = await rikaLike(w2);
  const d2 = ok2(await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [r2.unit.id], scheduledDate: TGL, menungguKonfirmasi: true }));
  const j2 = ok(await pl.api.get(`${ARM}/jobs/${d2.id}`)); assert.deepEqual(j2.overrideAdmin, []); assert.equal(j2.labelOverrideAdmin, null);
});

const SW = `${V2}/admin-override/switch`;
const RAP = `${V2}/admin-override/report`;

test("P12. SAKLAR fail-closed: tanpa baris/nonaktif = override BARU ditolak (409 ADMIN_OVERRIDE_DISABLED) tanpa menulis; daftar putih kanari; hanya Admin/Owner mengubah (alasan wajib, tercatat); replay tetap dijawab", async () => {
  const w = await world(); const adm = await admin(); const pl = await planner();
  const a = await rikaLike(w, { tanpaSaklar: true }); const b = await rikaLike(w, { tanpaSaklar: true });
  await testPrisma.v2FeatureFlag.deleteMany({ where: { key: SAKLAR } });
  // 1) tanpa baris saklar: pratinjau menyatakan tidak aktif; POST ditolak tanpa tulisan
  const pv = ok(await adm.api.get(REL(a.unit.id))); assert.equal(pv.overrideAktif, false); assert.equal(pv.saklar.enabled, false);
  const tolak = await release(w, adm, a.unit, a.run); assert.equal(tolak.status, 409, JSON.stringify(tolak.body)); assert.equal(tolak.body.code, "ADMIN_OVERRIDE_DISABLED");
  assert.equal(await unitStatus(a.unit.id), "IN_PRODUCTION"); assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: a.run.id } })).deliveryReleasedAt, null); assert.equal((await jobDeliveryUnit(a.unit.id)).length, 0);
  // 2) hanya Admin/Owner mengubah saklar; alasan wajib
  for (const [nama, who] of [["Production Lead", w.lead], ["Dispatcher", pl], ["Driver", w.driver]]) {
    assert.equal((await who.api.put(SW, { enabled: true, reason: "mengaktifkan override untuk uji" })).status, 403, nama);
    assert.equal((await who.api.get(SW)).status, 403, `${nama} baca saklar`); assert.equal((await who.api.get(RAP)).status, 403, `${nama} laporan`);
  }
  const tanpaAlasan = await adm.api.put(SW, { enabled: true, reason: "pendek" }); assert.equal(tanpaAlasan.status, 400); assert.equal(tanpaAlasan.body.code, "ADMIN_OVERRIDE_SWITCH_REASON_REQUIRED");
  assert.equal((await adm.api.put(SW, { enabled: "ya", reason: "mengaktifkan override untuk uji" })).status, 400);
  // 3) daftar putih kanari: hanya unit A
  const hid = ok(await adm.api.put(SW, { enabled: true, unitCodes: [a.unit.unitCode], reason: "kanari hanya unit Rika pengganti uji" })); assert.deepEqual(hid.unitCodes, [a.unit.unitCode]); assert.equal(hid.enabled, true);
  const pvB = ok(await adm.api.get(REL(b.unit.id))); assert.equal(pvB.overrideAktif, false, "unit B di luar daftar putih");
  const tolakB = await release(w, adm, b.unit, b.run); assert.equal(tolakB.status, 409); assert.equal(tolakB.body.code, "ADMIN_OVERRIDE_UNIT_NOT_ALLOWED");
  assert.equal(await unitStatus(b.unit.id), "IN_PRODUCTION");
  const pvA = ok(await adm.api.get(REL(a.unit.id))); assert.equal(pvA.overrideAktif, true);
  const tagA = `sw-a-${++seq}`; const revA = (await card(w, a.run.id)).revision;
  const okA = await adm.api.post(REL(a.unit.id), relBody(w, a.unit, revA), key(tagA)); assert.equal(okA.status, 200, JSON.stringify(okA.body));
  // 4) matikan saklar: unit A yang sudah dilepas TIDAK berubah; audit utuh; override baru ditolak; REPLAY kunci lama tetap dijawab (bukan override baru)
  const ambil = async () => ({ unit: await testPrisma.unit.findUniqueOrThrow({ where: { id: a.unit.id } }), run: await testPrisma.productionRun.findUniqueOrThrow({ where: { id: a.run.id } }), jobs: (await jobDeliveryUnit(a.unit.id)).length, act: await aktivitasRilis(a.unit.id), ob: await outboxRilis(a.run.id) });
  const ringkas = (x) => ({ st: x.unit.status, loc: x.unit.storageLocation, rel: x.run.deliveryRelease, at: x.run.deliveryReleasedAt, rev: x.run.revision, jobs: x.jobs, act: x.act, ob: x.ob });
  const sebelum = await ambil();
  const mati = ok(await adm.api.put(SW, { enabled: false, reason: "menghentikan override baru karena ada masalah" })); assert.equal(mati.enabled, false);
  const sesudah = await ambil();
  assert.deepEqual(ringkas(sesudah), ringkas(sebelum), "mematikan saklar TIDAK mengubah unit yang sudah dilepas atau audit");
  assert.equal(sesudah.unit.status, "READY_FOR_DELIVERY");
  const replay = await adm.api.post(REL(a.unit.id), relBody(w, a.unit, revA), key(tagA)); assert.equal(replay.status, 200, JSON.stringify(replay.body)); assert.equal(replay.body.replayed, true);
  const baru = await release(w, adm, b.unit, b.run); assert.equal(baru.status, 409); assert.equal(baru.body.code, "ADMIN_OVERRIDE_DISABLED");
  // 5) perubahan saklar tercatat (2 perubahan sah; yang ditolak tidak) dengan pelaku + alasan
  const log = await testPrisma.activityEvent.findMany({ where: { entityType: "production_setting", entityId: SAKLAR, eventType: "PRODUCTION_SETTING_CHANGED" }, orderBy: { createdAt: "asc" } });
  assert.equal(log.length, 2); assert.equal(log[0].actorId, adm.user.id); assert.match(log[0].metadata.reason, /kanari/); assert.equal(log[1].metadata.to, "NONAKTIF"); assert.match(log[1].metadata.from, /^AKTIF/);
  // 6) penutupan administratif Run tetap berjalan walau saklar mati (bukan override baru)
  const tutup = await w.lead.api.post(`${V2}/runs/${a.run.id}/confirm-finished-goods`, { expectedRevision: (await card(w, a.run.id)).revision, unitCode: a.unit.unitCode, reason: "Tutup Run administratif saat saklar override mati", physicalVerified: true, workCenterId: w.wc }, key(`sw-tutup-${++seq}`));
  assert.equal(tutup.status, 200, JSON.stringify(tutup.body)); assert.equal(await unitStatus(a.unit.id), "READY_FOR_DELIVERY"); assert.equal((await jobDeliveryUnit(a.unit.id)).length, 1);
});

test("P13. PROSEDUR job/rute yang telanjur terbentuk (tanpa rollback kode): laporan → keluarkan/hapus job per keadaan → unit tetap Siap Kirim, audit utuh, bisa direncanakan ulang tanpa job ganda; job berjalan tidak boleh dihapus", async () => {
  const w = await world(); const adm = await admin(); const pl = await planner();
  const A = await rikaLike(w); const B = await rikaLike(w); const C = await rikaLike(w);
  for (const x of [A, B, C]) assert.equal((await release(w, adm, x.unit, x.run)).status, 200);
  // Tiga keadaan: A = rute TERBIT + driver (belum jalan); B = rute DRAFT; C = job EN_ROUTE (driver sedang jalan; disimulasikan lewat DB)
  const jobA = (await jobDeliveryUnit(A.unit.id))[0].jobId; const jobB = (await jobDeliveryUnit(B.unit.id))[0].jobId; const jobC = (await jobDeliveryUnit(C.unit.id))[0].jobId;
  const ruteA = ok2(await pl.api.post(`${ARM}/routes`, { date: TGL, driverId: w.driver.user.id }));
  assert.equal((await pl.api.patch(`${ARM}/routes/${ruteA.id}/jobs`, { jobIds: [jobA] })).status, 200); assert.equal((await pl.api.post(`${ARM}/routes/${ruteA.id}/publish`, {})).status, 200);
  const ruteB = ok2(await pl.api.post(`${ARM}/routes`, { date: TGL }));
  assert.equal((await pl.api.patch(`${ARM}/routes/${ruteB.id}/jobs`, { jobIds: [jobB] })).status, 200);
  await testPrisma.job.update({ where: { id: jobC }, data: { status: "EN_ROUTE", driverId: w.driver.user.id } });
  // 1) Hentikan override baru, lalu BACA laporan: tiap keadaan terklasifikasi dengan tindakan aman
  ok(await adm.api.put(SW, { enabled: false, reason: "menghentikan override baru; menangani job telanjur" }));
  const rap = ok(await adm.api.get(RAP)); assert.equal(rap.saklar.enabled, false); assert.equal(rap.ringkas.total, 3);
  const per = Object.fromEntries(rap.items.map((i) => [i.unit.unitCode, i.jobs[0]]));
  assert.equal(per[A.unit.unitCode].kode, "RUTE_TERBIT_BELUM_JALAN"); assert.equal(per[B.unit.unitCode].kode, "RUTE_DRAFT"); assert.equal(per[C.unit.unitCode].kode, "SEDANG_BERJALAN");
  assert.match(per[C.unit.unitCode].tindakan, /JANGAN dihapus/); assert.equal(rap.ringkas.jobSedangBerjalan, 1); assert.ok(rap.items.every((i) => i.runBelumDitutup));
  const snap = async (x) => ({ u: await testPrisma.unit.findUniqueOrThrow({ where: { id: x.unit.id } }), r: await testPrisma.productionRun.findUniqueOrThrow({ where: { id: x.run.id } }) });
  const sebelum = { A: await snap(A), B: await snap(B), C: await snap(C) };
  // 2) job BERJALAN tidak bisa dihapus
  const hapusC = await pl.api.delete(`${ARM}/jobs/${jobC}`); assert.equal(hapusC.status, 400, JSON.stringify(hapusC.body)); assert.match(hapusC.body.error, /EN_ROUTE/);
  assert.equal((await jobDeliveryUnit(C.unit.id)).length, 1);
  // 3) B (rute draf): keluarkan job dari rute lalu hapus job; A (rute terbit belum jalan): batalkan rute lalu hapus job
  assert.equal((await pl.api.patch(`${ARM}/routes/${ruteB.id}/jobs`, { jobIds: [] })).status, 200);
  assert.equal((await testPrisma.job.findUniqueOrThrow({ where: { id: jobB } })).routeId, null);
  ok(await pl.api.delete(`${ARM}/jobs/${jobB}`));
  const batalA = await pl.api.patch(`${ARM}/routes/${ruteA.id}/cancel`, {}); assert.equal(batalA.status, 200, JSON.stringify(batalA.body));
  const hapusA = await pl.api.delete(`${ARM}/jobs/${jobA}`); assert.equal(hapusA.status, 200, JSON.stringify(hapusA.body));
  assert.equal((await jobDeliveryUnit(A.unit.id)).length, 0); assert.equal((await jobDeliveryUnit(B.unit.id)).length, 0);
  // 4) unit dan audit TIDAK berubah oleh penanganan job/rute
  for (const [nama, x] of [["A", A], ["B", B], ["C", C]]) {
    const s = await snap(x);
    assert.equal(s.u.status, "READY_FOR_DELIVERY", `${nama}: status unit tetap`); assert.equal(s.u.storageLocation, sebelum[nama].u.storageLocation, `${nama}: lokasi tetap`);
    assert.deepEqual(s.r.deliveryRelease, sebelum[nama].r.deliveryRelease, `${nama}: rekam audit utuh`); assert.equal(s.r.revision, sebelum[nama].r.revision, `${nama}: revisi Run tetap`); assert.equal(s.r.status, "ACTIVE");
    assert.equal(await aktivitasRilis(x.unit.id), 1, `${nama}: aktivitas audit utuh`); assert.equal(await outboxRilis(x.run.id), 1, `${nama}: outbox audit utuh`);
  }
  // 5) laporan sesudah penanganan: A dan B tanpa job (kembali kandidat biasa); C tetap berjalan
  const rap2 = ok(await adm.api.get(RAP)); const por = Object.fromEntries(rap2.items.map((i) => [i.unit.unitCode, i]));
  assert.equal(por[A.unit.unitCode].tanpaJob.kode, "TANPA_JOB"); assert.equal(por[B.unit.unitCode].tanpaJob.kode, "TANPA_JOB"); assert.equal(por[C.unit.unitCode].jobs[0].kode, "SEDANG_BERJALAN");
  // 6) A kembali KANDIDAT BIASA (Siap Kirim, bukan 'menunggu'): bisa dijadwalkan ulang normal → tepat SATU job; override ulang ditolak
  const papan = ok(await pl.api.get(`${ARM}/board?type=DELIVERY&date=${TGL}`)); assert.ok(papan.available.some((u) => u.id === A.unit.id), "unit A kembali kandidat siap-kirim biasa");
  const baru = ok2(await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [A.unit.id], scheduledDate: TGL })); assert.equal((await jobDeliveryUnit(A.unit.id)).length, 1);
  assert.equal((await release(w, adm, A.unit, A.run, { tag: `p13-ulang-${++seq}` })).status, 409, "override ulang ditolak (sudah di-override / saklar mati)");
  // 7) penutupan administratif Run belakangan: tidak membuat job baru, tidak mengubah status
  const tutup = await w.lead.api.post(`${V2}/runs/${A.run.id}/confirm-finished-goods`, { expectedRevision: (await card(w, A.run.id)).revision, unitCode: A.unit.unitCode, reason: "Tutup Run administratif setelah job diulang", physicalVerified: true, workCenterId: w.wc }, key(`p13-tutup-${++seq}`));
  assert.equal(tutup.status, 200, JSON.stringify(tutup.body)); assert.equal(await unitStatus(A.unit.id), "READY_FOR_DELIVERY");
  const jobsA = await jobDeliveryUnit(A.unit.id); assert.equal(jobsA.length, 1); assert.equal(jobsA[0].jobId, baru.id, "hanya job hasil jadwal ulang; Run ditutup tidak membuat job ganda");
});

test("P14. Penanda override dibawa juga oleh snapshot V2 Driver (cohort) dengan lokasi pengambilan yang sama; job biasa tanpa penanda", async () => {
  const { tandaiJobOverrideAdmin } = await import("../../src/services/deliveryOverrideAdmin.js");
  const w = await world(); const adm = await admin(); const pl = await planner();
  const A = await rikaLike(w);
  const draf = ok2(await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [A.unit.id], scheduledDate: TGL, menungguKonfirmasi: true }));
  assert.equal((await release(w, adm, A.unit, A.run)).status, 200);
  const jobs = [{ id: draf.id }]; await tandaiJobOverrideAdmin(testPrisma, jobs);
  assert.equal(jobs[0].overrideAdmin.length, 1); assert.equal(jobs[0].overrideAdmin[0].pickupLocationCode, w.fg.code); assert.match(jobs[0].labelOverrideAdmin, /override Admin/);
  const src = (await import("node:fs")).readFileSync(new URL("../../src/services/driverSnapshotV2.js", import.meta.url), "utf8");
  assert.match(src, /tandaiJobOverrideAdmin\(prisma, items\.flatMap\(\(item\) => item\.jobs\)\)/, "snapshot V2 Driver menandai job override");
});

// ───────────────────────── Driver V2 lewat HTTP dengan unit yang BENAR-BENAR ber-override (jalur app Driver RN) ─────────────────────────
// Bukan pengganti uji HP nyata: ini membuktikan kontrak server (payload snapshot V2 + /my-jobs V1) yang akan dibaca app.
async function aktifkanDriverV2() {
  for (const k of [V2_FLAGS.DELIVERY_ROUTE_WRITER, V2_FLAGS.DELIVERY_EXECUTION_WRITER, V2_FLAGS.DRIVER_SNAPSHOT_READER]) {
    await testPrisma.v2FeatureFlag.upsert({ where: { key: k }, create: { key: k, enabled: true, scope: "GLOBAL", config: {}, reason: "uji Driver V2 override" }, update: { enabled: true, scope: "GLOBAL", config: {} } });
  }
}
// Job hasil override (dibuat suggestDeliveryJob) dipasang ke rute TERBIT milik driver + keadaan V2 (job/rute/publikasi) seperti seed uji Driver V2 yang ada.
async function terbitkanJobDiV2(w, jobId) {
  const route = await testPrisma.route.create({ data: { code: `AO-V2-${Date.now()}-${++seq}`, date: new Date("2026-10-20T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
  const job = await testPrisma.job.update({ where: { id: jobId }, data: { routeId: route.id, driverId: w.driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-10-20T00:00:00.000Z") } });
  await testPrisma.deliveryJobState.create({ data: { jobId: job.id, jobRevision: 1, currentStatus: job.status, sourceChecksum: deliveryV2Checksum(deliveryJobSource(job)), migrationSource: "TEST_BASELINE" } });
  const fullRoute = await testPrisma.route.findUniqueOrThrow({ where: { id: route.id }, include: DELIVERY_V2_ROUTE_INCLUDE });
  const snapshot = buildDeliveryRouteSnapshot(fullRoute, { routeRevision: 1, publicationVersion: 1 });
  const checksum = deliveryV2Checksum(snapshot);
  await testPrisma.deliveryRouteState.create({ data: { routeId: route.id, routeRevision: 1, currentPublicationVersion: 1, lifecycleStatus: route.status, draftSnapshot: snapshot, draftChecksum: checksum, sourceChecksum: checksum, migrationSource: "TEST_BASELINE" } });
  await testPrisma.routePublication.create({
    data: { routeId: route.id, publicationVersion: 1, routeRevision: 1, status: "ACTIVE", snapshot, checksum, migrationBaseline: true,
      assignments: { create: [{ jobId: job.id, sequence: 1, driverId: w.driver.user.id, status: "ACTIVE", sourceChecksum: deliveryV2Checksum(snapshot.stops[0]) }] } },
  });
  return { route, job };
}

test("P15. DRIVER V2 via HTTP: unit yang benar-benar ber-override tampil di /armada/v2/me/snapshot dengan penanda jujur + lokasi pengambilan + status unit; parity dengan /my-jobs V1; job biasa tanpa penanda", async () => {
  const w = await world(); const adm = await admin();
  const A = await rikaLike(w);
  const rel = await release(w, adm, A.unit, A.run); assert.equal(rel.status, 200, JSON.stringify(rel.body));
  const jobId = (await jobDeliveryUnit(A.unit.id))[0].jobId;
  await aktifkanDriverV2(); await terbitkanJobDiV2(w, jobId);

  const v2 = await w.driver.api.get(`${ARM}/v2/me/snapshot`);
  assert.equal(v2.status, 200, JSON.stringify(v2.body)); assert.equal(v2.body.mode, "FULL_SNAPSHOT");
  const jobV2 = v2.body.items.flatMap((i) => i.jobs).find((j) => j.id === jobId);
  assert.ok(jobV2, "job override MUNCUL di snapshot V2 Driver");
  assert.equal(jobV2.overrideAdmin.length, 1); assert.equal(jobV2.overrideAdmin[0].unitCode, A.unit.unitCode); assert.equal(jobV2.overrideAdmin[0].pickupLocationCode, w.fg.code);
  assert.equal(jobV2.overrideAdmin[0].decidedByName, adm.user.name); assert.equal(jobV2.overrideAdmin[0].runStatus, "ACTIVE");
  assert.equal(jobV2.labelOverrideAdmin, "Siap Kirim — override Admin (pencatatan produksi belum selesai)");
  assert.equal(jobV2.units[0].unit.status, "READY_FOR_DELIVERY", "status unit jujur: Siap Kirim"); // lokasi pengambilan yang dibaca app = overrideAdmin[].pickupLocationCode (select unit manifest V2 memang tidak memuat storageLocation)
  assert.doesNotMatch(JSON.stringify({ o: jobV2.overrideAdmin, l: jobV2.labelOverrideAdmin }), /diperiksa|pemeriksa|inspector|QC lulus|lulus QC/i, "tanpa klaim pemeriksaan/QC");
  // parity V1
  const v1 = ok(await w.driver.api.get(`${ARM}/my-jobs`)); const jobV1 = v1.jobs.find((j) => j.id === jobId);
  assert.ok(jobV1, "job override muncul di /my-jobs V1");
  assert.deepEqual(jobV1.overrideAdmin.map((o) => [o.unitCode, o.pickupLocationCode]), jobV2.overrideAdmin.map((o) => [o.unitCode, o.pickupLocationCode]), "V1 = V2");
  assert.equal(jobV1.labelOverrideAdmin, jobV2.labelOverrideAdmin);
});

test("P16. FAIL-SOFT di Driver V2 via HTTP: bila penanda override gagal dibaca, job TETAP muncul (status unit tetap benar) tanpa penanda; pulih setelah galat hilang", async () => {
  const w = await world(); const adm = await admin();
  const A = await rikaLike(w);
  assert.equal((await release(w, adm, A.unit, A.run)).status, 200);
  const jobId = (await jobDeliveryUnit(A.unit.id))[0].jobId;
  await aktifkanDriverV2(); await terbitkanJobDiV2(w, jobId);
  // Rusak SEMENTARA sumber penanda (kolom dinamai ulang -> kueri production_runs_v2 gagal); jalur snapshot/Driver tidak membaca tabel itu selain untuk penanda.
  await testPrisma.$executeRawUnsafe('ALTER TABLE production_runs_v2 RENAME COLUMN delivery_released_at TO delivery_released_at_rusak');
  try {
    const v2 = await w.driver.api.get(`${ARM}/v2/me/snapshot`);
    assert.equal(v2.status, 200, "snapshot V2 tidak boleh gagal hanya karena penanda tidak terbaca: " + JSON.stringify(v2.body));
    const jobV2 = v2.body.items.flatMap((i) => i.jobs).find((j) => j.id === jobId);
    assert.ok(jobV2, "job TETAP muncul di snapshot V2");
    assert.deepEqual(jobV2.overrideAdmin, []); assert.equal(jobV2.labelOverrideAdmin, null);
    assert.equal(jobV2.units[0].unit.status, "READY_FOR_DELIVERY", "status unit tetap benar walau penanda gagal");
    const v1 = await w.driver.api.get(`${ARM}/my-jobs`);
    assert.equal(v1.status, 200, "/my-jobs V1 tidak boleh gagal: " + JSON.stringify(v1.body)); assert.ok(v1.body.jobs.some((j) => j.id === jobId), "job TETAP muncul di /my-jobs");
  } finally {
    await testPrisma.$executeRawUnsafe('ALTER TABLE production_runs_v2 RENAME COLUMN delivery_released_at_rusak TO delivery_released_at');
  }
  const pulih = await w.driver.api.get(`${ARM}/v2/me/snapshot`);
  assert.equal(pulih.status, 200); assert.equal(pulih.body.items.flatMap((i) => i.jobs).find((j) => j.id === jobId).overrideAdmin.length, 1, "penanda kembali setelah galat hilang");
});

// ───────────────────────── DISPATCH TANPA OVERRIDE (keputusan Owner, 18 Okt 2026): status produksi tidak menahan pengiriman ─────────────────────────
// Kasus Rika: barang sudah terkirim, tetapi unit tidak bisa masuk Route Planner karena Run masih berjalan. Aturan baru: unit RECEIVED/IN_PRODUCTION masuk job biasa, tanpa saklar/override.
// Saat unit BENAR-BENAR berangkat/terkirim sementara Run belum ditutup, Run diberi penanda "dilepas" otomatis (kind DISPATCH_ROUTE_PLANNER) — bukan override Admin, bukan pemeriksaan/QC.
async function jalankanPengiriman(w, jobId, tag, { sampaiSelesai = true } = {}) {
  const s = await w.driver.api.post(`${ARM}/jobs/${jobId}/start`, {}, key(`${tag}-s`)); assert.equal(s.status, 200, JSON.stringify(s.body));
  if (!sampaiSelesai) return s;
  const a = await w.driver.api.post(`${ARM}/jobs/${jobId}/arrive`, { location: null }, key(`${tag}-a`)); assert.equal(a.status, 200, JSON.stringify(a.body));
  const c = await w.driver.api.post(`${ARM}/jobs/${jobId}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Bu Rika", note: "ok", location: null }, key(`${tag}-c`));
  assert.equal(c.status, 200, JSON.stringify(c.body));
  return c;
}
const runFresh = (id) => testPrisma.productionRun.findUniqueOrThrow({ where: { id } });
const hitungAktivitasDispatch = (unitId) => testPrisma.activityEvent.count({ where: { entityType: "unit", entityId: unitId, eventType: "PRODUCTION_DISPATCHED_BEFORE_DONE" } });

test("Q1. KASUS RIKA TANPA OVERRIDE: unit IN_PRODUCTION masuk job biasa → berangkat → terkirim; Run dilepas otomatis (DISPATCH), tidak dianggap konflik V1, order Terkirim, tanpa QC/foto/custody/stok palsu", async () => {
  const w = await world(); const pl = await planner();
  const { unit, run } = await rikaLike(w, { tanpaSaklar: true }); // saklar override TIDAK dinyalakan: aturan baru tidak memakainya
  assert.equal((await runFresh(run.id)).deliveryReleasedAt, null);
  const job = ok2(await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [unit.id], scheduledDate: TGL, driverId: w.driver.user.id }));
  const before = { qc: await testPrisma.qualityInspection.count({ where: { runId: run.id } }), fg: await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id, direction: "FINISHED_GOODS" } }), stok: await testPrisma.stockMovement.count({ where: { unitId: unit.id } }), ev: await testPrisma.productionStepEvidence.count({ where: { runId: run.id } }) };
  const revSebelum = (await runFresh(run.id)).revision;

  await jalankanPengiriman(w, job.id, "q1", { sampaiSelesai: false });
  assert.equal(await unitStatus(unit.id), "IN_TRANSIT_OUT");
  const r1 = await runFresh(run.id);
  assert.ok(r1.deliveryReleasedAt, "Run diberi penanda dilepas saat unit benar-benar berangkat");
  assert.equal(r1.deliveryRelease.kind, "DISPATCH_ROUTE_PLANNER"); assert.equal(r1.deliveryRelease.via, "JOB_START"); assert.equal(r1.deliveryRelease.jobId, job.id);
  assert.equal(r1.deliveryRelease.unit.statusBefore, "IN_PRODUCTION"); assert.equal(r1.deliveryRelease.decidedBy.id, w.driver.user.id);
  assert.match(r1.deliveryRelease.note, /bukan hasil pemeriksaan\/QC/);
  assert.equal(r1.status, "ACTIVE", "Run TIDAK ditutup"); assert.equal(r1.revision, revSebelum + 1);
  assert.equal(await hitungAktivitasDispatch(unit.id), 1);

  const a = await w.driver.api.post(`${ARM}/jobs/${job.id}/arrive`, { location: null }, key("q1-a")); assert.equal(a.status, 200, JSON.stringify(a.body));
  const c = await w.driver.api.post(`${ARM}/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Bu Rika", note: "ok", location: null }, key("q1-c"));
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(await unitStatus(unit.id), "DELIVERED");
  const order = await testPrisma.order.findUniqueOrThrow({ where: { id: unit.orderId } }); assert.equal(order.status, "DELIVERED", "order ikut Terkirim lewat alur pengiriman biasa");
  const r2 = await runFresh(run.id);
  assert.equal(r2.status, "ACTIVE", "Run tetap berjalan (belum ditutup)"); assert.equal(r2.revision, r1.revision, "penanda tidak ditulis ulang"); assert.equal(r2.deliveryRelease.via, "JOB_START");
  assert.equal(await hitungAktivitasDispatch(unit.id), 1, "satu aktivitas saja");
  assert.deepEqual({ qc: await testPrisma.qualityInspection.count({ where: { runId: run.id } }), fg: await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id, direction: "FINISHED_GOODS" } }), stok: await testPrisma.stockMovement.count({ where: { unitId: unit.id } }), ev: await testPrisma.productionStepEvidence.count({ where: { runId: run.id } }) }, before, "tanpa QC/custody/stok/bukti baru");

  // unit terkirim + Run belum ditutup BUKAN konflik V1 (sapu konflik)
  const { sweepRunExceptions } = await import("../../src/services/productionQcHandoffCommandService.js");
  const adm = await admin();
  assert.equal((await sweepRunExceptions(testPrisma, { actorId: adm.user.id, idempotencyKey: `sapu-q1-${++seq}-000001` })).openedCount, 0);
  // command tahap biasa pada Run yang sudah dilepas ditolak; penutupan administratif tetap boleh dan tidak mundurkan status
  const rev = (await card(w, run.id)).revision;
  const skip = await w.nadya.api.post(`${V2}/runs/${run.id}/steps/10/skip`, { expectedRevision: rev, workCenterId: w.wc }, key(`q1-skip-${++seq}`));
  assert.equal(skip.status, 409); assert.equal(skip.body.code, "RUN_RELEASED_FOR_DELIVERY");
  const tutup = await w.lead.api.post(`${V2}/runs/${run.id}/confirm-finished-goods`, { expectedRevision: rev, unitCode: unit.unitCode, reason: "Tutup Run administratif; unit sudah terkirim ke pelanggan", physicalVerified: true, workCenterId: w.wc }, key(`q1-tutup-${++seq}`));
  assert.equal(tutup.status, 200, JSON.stringify(tutup.body));
  assert.equal(await unitStatus(unit.id), "DELIVERED", "status unit tidak mundur"); assert.equal((await jobDeliveryUnit(unit.id)).length, 1);
});

test("Q2. Dispatch ≠ override: penanda DISPATCH tidak tampil sebagai 'override Admin' (job, kartu unit, laporan override); override Admin sungguhan tetap tampil", async () => {
  const w = await world(); const pl = await planner(); const adm = await admin();
  const { unit, run } = await rikaLike(w);
  const job = ok2(await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [unit.id], scheduledDate: TGL, driverId: w.driver.user.id }));
  await jalankanPengiriman(w, job.id, "q2", { sampaiSelesai: false });
  const papan = ok(await pl.api.get(`${ARM}/board?type=DELIVERY&date=${TGL}`));
  const j = papan.jobs.find((x) => x.id === job.id);
  assert.deepEqual(j.overrideAdmin, [], "bukan override Admin"); assert.equal(j.labelOverrideAdmin, null);
  const laporan = ok(await adm.api.get(`${V2}/admin-override/report`));
  assert.ok(!laporan.items.some((i) => i.runId === run.id), "laporan override tidak memuat pelepasan dispatch");
  const ber = await runFresh(run.id);
  assert.equal(ber.deliveryRelease.kind, "DISPATCH_ROUTE_PLANNER");
  // override Admin pada unit lain tetap berjalan dan tetap berlabel override
  const w2 = await world(); const { unit: u2, run: r2 } = await rikaLike(w2);
  assert.equal((await release(w2, adm, u2, r2)).status, 200);
  const l2 = ok(await adm.api.get(`${V2}/admin-override/report`));
  assert.ok(l2.items.some((i) => i.runId === r2.id) && !l2.items.some((i) => i.runId === run.id));
  assert.equal((await runFresh(r2.id)).deliveryRelease.kind, "ADMIN_OVERRIDE");
});

test("Q3. Unit yang sudah di-override Admin lalu dikirim: penanda override TIDAK ditimpa dispatch (tidak ada pelepasan ganda)", async () => {
  const w = await world(); const adm = await admin();
  const { unit, run } = await rikaLike(w);
  assert.equal((await release(w, adm, unit, run)).status, 200);
  const sebelum = await runFresh(run.id);
  const jobs = await jobDeliveryUnit(unit.id); assert.equal(jobs.length, 1);
  await testPrisma.job.update({ where: { id: jobs[0].jobId }, data: { driverId: w.driver.user.id, status: "ASSIGNED" } });
  await jalankanPengiriman(w, jobs[0].jobId, "q3");
  const sesudah = await runFresh(run.id);
  assert.equal(sesudah.deliveryRelease.kind, "ADMIN_OVERRIDE"); assert.equal(sesudah.revision, sebelum.revision);
  assert.equal(await hitungAktivitasDispatch(unit.id), 0);
  assert.equal(await unitStatus(unit.id), "DELIVERED");
});

test("Q4. Unit yang SUDAH siap kirim (Run ditutup lewat alur biasa) tidak diberi penanda dispatch; unit batal/terkirim tetap tak bisa dijadwalkan; PICKUP tidak berubah", async () => {
  const w = await world(); const pl = await planner();
  const { unit } = await rikaLike(w);
  const bataln = await testPrisma.unit.create({ data: { unitCode: `${unit.unitCode}-X`, orderId: unit.orderId, seq: 9, status: "CANCELLED" } });
  const r = await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [bataln.id], scheduledDate: TGL });
  assert.equal(r.status, 400); assert.match(r.body.error, /CANCELLED.*tidak bisa dijadwalkan/);
  const pic = await pl.api.post(`${ARM}/jobs`, { type: "PICKUP", unitIds: [unit.id] });
  assert.equal(pic.status, 400, "unit di bengkel tidak bisa dijadwalkan PICKUP");
  const pending = await testPrisma.customer.create({ data: { name: `Cust ${++seq}` } });
  const ordP = await testPrisma.order.create({ data: { customerId: pending.id, orderNumber: `PPFO-${++seq}`, value: 100, category: "LAYANAN", status: "PENDING" } });
  const uP = await testPrisma.unit.create({ data: { unitCode: `UNIT-PPF-${++seq}`, orderId: ordP.id, seq: 1, status: "IN_PRODUCTION" } });
  const tolakOrder = await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [uP.id], scheduledDate: TGL });
  assert.equal(tolakOrder.status, 409); assert.equal(tolakOrder.body.code, "ORDER_TIDAK_SAH", "order PENDING tetap bukan order yang sah dikirim");
});

test("Q5. KASUS RIKA PERSIS: unit IN_PRODUCTION masuk rute yang SUDAH SELESAI (Admin + alasan), pengiriman dicatat manual oleh Admin → unit/order Terkirim; Run dilepas otomatis; job lain di rute itu tidak tersentuh", async () => {
  const w = await world(); const adm = await admin();
  const { unit, run } = await rikaLike(w, { tanpaSaklar: true });
  // rute yang sudah SELESAI dengan satu job lain (seperti RTE-161026-02)
  const rute = await testPrisma.route.create({ data: { code: `RTE-Q5-${++seq}`, date: new Date("2026-10-16T00:00:00.000Z"), status: "COMPLETED", publishedAt: new Date(), startedAt: new Date(), completedAt: new Date(), driverId: w.driver.user.id } });
  const cust = await testPrisma.customer.create({ data: { name: `Cust ${++seq}` } });
  const ordLain = await testPrisma.order.create({ data: { customerId: cust.id, orderNumber: `Q5O-${++seq}`, value: 100, category: "LAYANAN", status: "DELIVERED" } });
  const unitLain = await testPrisma.unit.create({ data: { unitCode: `Q5-LAIN-${++seq}`, orderId: ordLain.id, seq: 1, status: "DELIVERED" } });
  const jobLain = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: ordLain.id, routeId: rute.id, driverId: w.driver.user.id, status: "COMPLETED", sequence: 1, scheduledDate: new Date("2026-10-16T00:00:00.000Z"), completedAt: new Date() } });
  await testPrisma.jobUnit.create({ data: { jobId: jobLain.id, unitId: unitLain.id } });

  const job = ok2(await adm.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [unit.id], scheduledDate: "2026-10-16" }));
  const taruh = await adm.api.patch(`${ARM}/routes/${rute.id}/jobs`, { jobIds: [jobLain.id, job.id], reason: "Rika terkirim di rute Bandung tetapi produksinya belum selesai sehingga tidak masuk Route Planner" });
  assert.equal(taruh.status, 200, JSON.stringify(taruh.body));
  assert.equal((await testPrisma.job.findUniqueOrThrow({ where: { id: job.id } })).routeId, rute.id, "job Rika ada di rute yang sudah selesai");
  assert.equal((await testPrisma.job.findUniqueOrThrow({ where: { id: jobLain.id } })).status, "COMPLETED", "job lain tidak tersentuh");

  // Admin mencatat pengiriman manual (barang sudah terkirim): driver/jam sesuai laporan
  await testPrisma.job.update({ where: { id: job.id }, data: { driverId: w.driver.user.id, status: "ARRIVED" } });
  const sel = await adm.api.post(`${ARM}/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Bu Rika", note: "Input manual Admin: sudah terkirim", location: null, driverId: w.driver.user.id }, key(`q5-c-${++seq}`));
  assert.equal(sel.status, 200, JSON.stringify(sel.body));
  assert.equal(await unitStatus(unit.id), "DELIVERED");
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: unit.orderId } })).status, "DELIVERED");
  const r = await runFresh(run.id);
  assert.equal(r.deliveryRelease.kind, "DISPATCH_ROUTE_PLANNER"); assert.equal(r.deliveryRelease.via, "JOB_COMPLETE"); assert.equal(r.status, "ACTIVE");
  assert.equal(await hitungAktivitasDispatch(unit.id), 1);
  assert.equal(await unitStatus(unitLain.id), "DELIVERED");
});
