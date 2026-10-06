// Rencana Produksi untuk ORDER NYATA — HTTP + DB sungguhan (DB uji terisolasi): foto pickup lewat resolver resmi (single-unit diatribusikan, multi-unit TIDAK), PIC/workshop dari server dengan alasan,
// onboarding + penjadwalan atomik (Run PENDING_ARRIVAL, tanpa Run ganda, idempoten, kapasitas meja, rollback total), kedatangan fisik tetap eksplisit, pengecualian, izin, dan skrip aktivasi cohort.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const JOB_PHOTOS_DIR = path.join(backendRoot, "data", "job-photos");
const V2 = "/api/production-v2";
const DATE = "2026-10-12";
let server; let seq = 0; let w;
const writtenPhotos = [];

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { for (const f of writtenPhotos) { try { fs.unlinkSync(f); } catch { /* sudah hilang */ } } await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.beforeEach(async () => { await truncateAll(); w = await world(); });

const idem = (tag) => ({ "Idempotency-Key": `rencana-${tag}-${++seq}-0000` });
async function setFlag(flagKey, unitIds) {
  const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "rencana test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
const setCohort = async (...ids) => { for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(k, ids.length ? ids : null); };
const addCohort = async (...ids) => {
  const row = await testPrisma.v2FeatureFlag.findUnique({ where: { key: V2_FLAGS.PRODUCTION_WRITER } });
  await setCohort(...new Set([...(row?.enabled ? row.config.unitIds ?? [] : []), ...ids]));
};

async function world() {
  const [lead, worker, driver, admin] = await Promise.all([
    createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["PRODUCTION_WORKER"] }), createTestUser({ roles: ["DRIVER"] }), createTestUser({ roles: ["ADMIN"] }),
  ]);
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  const wc = await testPrisma.workCenter.create({ data: { code: `WC-RN-${++seq}`, name: "Workshop Utama" } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-RN-${++seq}`, name: "Gudang RN" } });
  const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-RN-${++seq}` } });
  return { lead: c(lead), worker: c(worker), driver: c(driver), admin: c(admin), wc, rcv };
}
// PIC sah: akun PRODUCTION_WORKER + profil operator aktif.
async function mkOperator(role = "PRODUCTION_WORKER", { active = true } = {}) {
  const u = await createTestUser({ roles: [role] });
  await testPrisma.userRole.create({ data: { userId: u.user.id, role } });
  const op = await testPrisma.productionOperator.create({ data: { userId: u.user.id, primaryWorkCenterId: w.wc.id, active } });
  return { ...u, op };
}

// Order nyata Diproses + unit(s) + job pickup (single/multi/none/nojob). `photo`: "single" | "multi" | "none" (job tanpa foto) | "nojob".
async function mkReal({ photo = "single", unitStatus = "RECEIVED", orderStatus = "PROCESSING", stage = "NEW", staff = false, extra = 0, category = "LAYANAN" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Bu Rencana ${++seq}`, pipelineStage: stage, isInternalStaff: staff } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ORD-RN-${++seq}`, value: 1_000_000, category, status: orderStatus } });
  const mk = (n) => testPrisma.unit.create({ data: { unitCode: `RN-${seq}-${n}`, orderId: order.id, seq: n + 1, status: unitStatus, merk: "Serta", ukuran: "160x200" } });
  const unit = await mk(0); const others = []; for (let i = 1; i <= extra; i += 1) others.push(await mk(i));
  let job = null; let photoFile = null;
  if (photo !== "nojob") {
    photoFile = `rencana-test-${seq}.jpg`;
    job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", completedAt: new Date(), driverId: w.driver.user.id, proofPhotoUrls: photo === "none" ? [] : [`/media/job-photos/${photoFile}`] } });
    for (const u of [unit, ...others]) await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: u.id } });
    if (photo !== "none") { const abs = path.join(JOB_PHOTOS_DIR, photoFile); fs.mkdirSync(JOB_PHOTOS_DIR, { recursive: true }); fs.writeFileSync(abs, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0])); writtenPhotos.push(abs); }
  }
  return { unit, others, order, customer, job, photoFile };
}
const backlog = async (qs = "") => (await w.lead.api.get(`${V2}/backlog${qs}`)).body;
const itemOf = (b, unit) => b.items.find((i) => i.unitId === unit.id);
const body = (op, over = {}) => ({ productionDate: DATE, stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, ...over });
const schedule = (unit, op, over = {}, headers = idem("sch")) => w.lead.api.post(`${V2}/plans`, { unitId: unit.id, ...body(op, over) }, headers);
const counts = async (unit) => ({
  runs: await testPrisma.productionRun.count({ where: { unitId: unit.id } }),
  plans: await testPrisma.productionRunPlan.count({ where: { run: { unitId: unit.id } } }),
  handoffs: await testPrisma.unitCustodyHandoff.count({ where: { unitId: unit.id } }),
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
test("AKAR #1 foto: pickup single-unit tampil di kartu order nyata (di luar cohort, tanpa custody); multi-unit TIDAK diatribusikan dan dijelaskan; tanpa foto/pickup dijelaskan", async () => {
  const single = await mkReal({ photo: "single" });
  const multi = await mkReal({ photo: "multi", extra: 2 });
  const noPhoto = await mkReal({ photo: "none" });
  const noJob = await mkReal({ photo: "nojob" });
  const b = await backlog("?pageSize=100");
  assert.equal(b.total, 6);
  const s = itemOf(b, single.unit);
  assert.ok(s.card.unit.photoUrl?.startsWith(`/media/unit-photo/${single.unit.id}?`), "foto pickup single-unit tampil lewat URL bertanda tangan resolver resmi");
  assert.equal(s.card.photoNote, null);
  const served = await fetch(`${server.baseUrl}${s.card.unit.photoUrl}`);
  assert.equal(served.status, 200); assert.equal(served.headers.get("content-type"), "image/jpeg", "berkas foto Delivery benar-benar tersaji (tanpa Bearer, via tanda tangan)");
  for (const u of [multi.unit, ...multi.others]) {
    const i = itemOf(b, u); assert.equal(i.card.unit.photoUrl, null, "job multi-unit TIDAK diatribusikan ke unit mana pun");
    assert.equal(i.card.photoNote.status, "AMBIGUOUS"); assert.match(i.card.photoNote.text, /3 unit/); assert.match(i.card.photoNote.text, /tidak bisa dipastikan/);
  }
  assert.equal(itemOf(b, noPhoto.unit).card.photoNote.status, "NO_PHOTO");
  assert.equal(itemOf(b, noJob.unit).card.photoNote.status, "NO_PICKUP");
  // photo yang SAMA dipakai endpoint sajian: unit multi-unit -> 404 walau URL ditandatangani paksa
  const forged = (await fetch(`${server.baseUrl}${s.card.unit.photoUrl.replace(single.unit.id, multi.unit.id)}`));
  assert.ok([403, 404].includes(forged.status), "URL unit lain tidak membuka foto (tanda tangan terikat unitId)");
});

test("AKAR #2 'Belum bisa dijadwalkan': unit Diproses bersih di luar cohort = MENUNGGU AKTIVASI (aksi berikutnya jelas), di cohort = bisa dijadwalkan; ringkasan hitungan dari server", async () => {
  const a = await mkReal(); const b2 = await mkReal();
  let b = await backlog();
  for (const u of [a.unit, b2.unit]) { const i = itemOf(b, u); assert.equal(i.rencana.action, "AWAIT_ACTIVATION"); assert.equal(i.rencana.onboardable, false); assert.equal(i.schedulable, false); assert.match(i.rencana.next, /Owner/); }
  assert.equal(b.rencanaCounts.AWAIT_ACTIVATION, 2);
  await setCohort(a.unit.id);
  b = await backlog();
  assert.equal(itemOf(b, a.unit).rencana.action, "ONBOARD_SCHEDULE"); assert.equal(itemOf(b, a.unit).rencana.onboardable, true);
  assert.equal(itemOf(b, b2.unit).rencana.action, "AWAIT_ACTIVATION", "unit lain TIDAK ikut teraktivasi (cohort tidak meluas diam-diam)");
  assert.deepEqual([b.rencanaCounts.ONBOARD_SCHEDULE, b.rencanaCounts.AWAIT_ACTIVATION], [1, 1]);
  // aktivasi sebagian = pengecualian jelas, bukan kartu yang diam-diam gagal
  await setFlag(V2_FLAGS.PRODUCTION_READER, null);
  const p = itemOf(await backlog(), a.unit); assert.equal(p.rencana.action, "EXCEPTION"); assert.equal(p.rencana.code, "PARTIAL_ACTIVATION");
});

test("AKAR #3 PIC: referensi dari server — kosong SELALU ada alasan + tautan; akun produksi yang belum jadi PIC ditawarkan; hanya yang berizin bisa mendaftarkan; operator nonaktif tidak muncul", async () => {
  await testPrisma.user.update({ where: { id: w.worker.user.id }, data: { active: false } }); // satu-satunya akun produksi pada fixture: nonaktifkan -> tidak ada akun sama sekali
  let r = (await w.lead.api.get(`${V2}/planning/refs`)); assert.equal(r.status, 200);
  assert.equal(r.body.operators.length, 0); assert.ok(r.body.workCenters.some((x) => x.id === w.wc.id), "workshop aktif ikut daftar (DB uji juga berisi workshop bawaan migrasi)");
  assert.ok(r.body.problems.some((p) => p.code === "NO_PIC_ACCOUNT"), "tidak ada akun produksi sama sekali -> alasan eksplisit");
  await testPrisma.user.update({ where: { id: w.worker.user.id }, data: { active: true } });
  const legacyOnly = (await w.lead.api.get(`${V2}/planning/refs`)).body.candidates.map((c) => c.userId);
  assert.deepEqual(legacyOnly, [w.worker.user.id], "akun berperan produksi lewat kolom peran lama juga ditawarkan");
  await testPrisma.user.update({ where: { id: w.worker.user.id }, data: { active: false } });
  const cand = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); await testPrisma.userRole.create({ data: { userId: cand.user.id, role: "PRODUCTION_WORKER" } });
  r = await w.lead.api.get(`${V2}/planning/refs`);
  const prob = r.body.problems.find((p) => p.code === "NO_PIC_PROFILE");
  assert.ok(prob, "ada akun produksi aktif tetapi belum didaftarkan"); assert.equal(prob.link, "/bengkel/pengaturan?tab=operator"); assert.ok(prob.linkLabel);
  assert.equal(r.body.candidates.length, 1); assert.equal(r.body.candidates[0].userId, cand.user.id); assert.equal(r.body.canRegisterOperator, true);
  // pendaftaran eksplisit lewat endpoint operator yang sudah ada -> muncul sebagai PIC, hilang dari kandidat
  const reg = await w.lead.api.post("/api/production/operators", { userId: cand.user.id, primaryWorkCenterId: w.wc.id }); assert.equal(reg.status, 201);
  r = await w.lead.api.get(`${V2}/planning/refs`);
  assert.deepEqual(r.body.operators.map((o) => o.userId), [cand.user.id]); assert.equal(r.body.operators[0].name, cand.user.name); assert.equal(r.body.candidates.length, 0);
  assert.ok(r.body.problems.every((p) => p.severity === "info"), "tidak ada masalah blok lagi; hanya catatan info");
  // operator nonaktif / akun nonaktif tidak muncul sebagai PIC
  await mkOperator("PRODUCTION_WORKER", { active: false });
  const gone = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); await testPrisma.productionOperator.create({ data: { userId: gone.user.id, active: true } }); await testPrisma.user.update({ where: { id: gone.user.id }, data: { active: false } });
  assert.equal((await w.lead.api.get(`${V2}/planning/refs`)).body.operators.length, 1);
  // tanpa workshop aktif
  await testPrisma.workCenter.updateMany({ data: { active: false } });
  assert.ok((await w.lead.api.get(`${V2}/planning/refs`)).body.problems.some((p) => p.code === "NO_WORK_CENTER" && p.link === "/bengkel/pengaturan?tab=area-kerja"));
  await testPrisma.user.update({ where: { id: w.worker.user.id }, data: { active: true } });
  // izin: PIC/Gudang tidak boleh melihat daftar penjadwalan
  assert.equal((await w.worker.api.get(`${V2}/planning/refs`)).status, 403);
  assert.equal((await w.driver.api.get(`${V2}/planning/refs`)).status, 403);
  // peran lain tanpa izin menulis operator melihat daftar tetapi tidak boleh mendaftarkan (ADMIN berizin)
  assert.equal((await w.admin.api.get(`${V2}/planning/refs`)).body.canRegisterOperator, true);
});

test("onboarding + penjadwalan ATOMIK: Run PENDING_ARRIVAL (belum tiba), rencana PLANNED di Meja, handoff custody dari pickup NYATA, tanpa Run ganda; idempoten; konflik payload; pindah Meja memakai Run yang sama", async () => {
  const real = await mkReal({ photo: "single" }); const op = await mkOperator();
  await setCohort(real.unit.id);
  const res = await schedule(real.unit, op, { priority: 1 }, { "Idempotency-Key": "rencana-onb-satu-0001" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.onboarded, true); assert.equal(res.body.viaCustody, true); assert.equal(res.body.created, true); assert.equal(res.body.stationCode, "TABLE_1"); assert.equal(res.body.priority, 1);
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: real.unit.id }, include: { phases: true, plan: true } });
  assert.equal(run.status, "PENDING_ARRIVAL", "status Diproses TIDAK dianggap bukti kedatangan fisik"); assert.equal(run.origin, "CUSTODY_PICKUP"); assert.equal(run.migrationSource, null, "bukan run legacy (gerbang lifecycle berlaku)");
  assert.ok(run.phases.every((p) => ["NOT_STARTED", "NOT_APPLICABLE"].includes(p.status)), "tidak ada tahap yang dimulai");
  assert.equal(run.plan.status, "PLANNED"); assert.equal(run.plan.stationCode, "TABLE_1"); assert.equal(run.plan.operatorId, op.op.id);
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: real.unit.id } });
  assert.equal(handoff.direction, "INBOUND"); assert.equal(handoff.status, "OFFERED"); assert.equal(handoff.deliveryJobId, real.job.id, "garis keturunan ke pickup NYATA");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: real.unit.id, eventType: "PRODUCTION_RUN_ONBOARDED_RENCANA" } }), 1);
  // keluar dari backlog; muncul di papan Meja 1 dengan posisi 'belum tiba'
  assert.equal(itemOf(await backlog(), real.unit), undefined);
  const board = (await w.lead.api.get(`${V2}/board?date=${DATE}`)).body;
  const onT1 = board.stations.find((s) => s.code === "TABLE_1").items.find((v) => v.unit.id === real.unit.id);
  assert.ok(onT1, "kartu ada di Meja 1"); assert.equal(onT1.presence.key, "NOT_ARRIVED"); assert.equal(onT1.plan.operator.name, op.user.name);
  // idempoten: kunci SAMA -> replay, tidak ada baris tambahan
  const replay = await w.lead.api.post(`${V2}/plans`, { unitId: real.unit.id, ...body(op, { priority: 1 }) }, { "Idempotency-Key": "rencana-onb-satu-0001" });
  assert.equal(replay.status, 201); assert.equal(replay.body.replayed, true); assert.deepEqual(await counts(real.unit), { runs: 1, plans: 1, handoffs: 1 });
  // kunci sama + isi berbeda = konflik
  assert.equal((await w.lead.api.post(`${V2}/plans`, { unitId: real.unit.id, ...body(op, { stationCode: "TABLE_2" }) }, { "Idempotency-Key": "rencana-onb-satu-0001" })).status, 409);
  // pindah Meja (kunci baru): memakai Run & rencana yang SAMA, revisi naik, tetap satu Run
  const moved = await schedule(real.unit, op, { stationCode: "TABLE_3" });
  assert.equal(moved.status, 201, JSON.stringify(moved.body)); assert.equal(moved.body.onboarded, false); assert.equal(moved.body.created, false); assert.equal(moved.body.stationCode, "TABLE_3");
  assert.deepEqual(await counts(real.unit), { runs: 1, plans: 1, handoffs: 1 });
});

test("kedatangan fisik tetap EKSPLISIT: unit dengan pickup memakai custody biasa; unit TANPA pickup tercatat dikonfirmasi petugas (lokasi wajib), penanda 'tiba' hanya sesudahnya", async () => {
  const withPickup = await mkReal({ photo: "single" }); const noPickup = await mkReal({ photo: "nojob" }); const op = await mkOperator();
  await setCohort(withPickup.unit.id, noPickup.unit.id);
  assert.equal((await schedule(withPickup.unit, op)).status, 201);
  assert.equal((await schedule(noPickup.unit, op, { stationCode: "TABLE_2" })).status, 201);
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: noPickup.unit.id } }), 0, "tanpa pickup -> tidak ada handoff yang dikarang");
  const presenceOf = async (u) => (await w.lead.api.get(`${V2}/board?date=${DATE}`)).body.stations.flatMap((s) => s.items).find((v) => v.unit.id === u.id).presence;
  assert.equal((await presenceOf(withPickup.unit)).key, "NOT_ARRIVED"); assert.equal((await presenceOf(noPickup.unit)).key, "NOT_ARRIVED");
  // tanpa lokasi + tanpa lokasi bawaan Admin = ditolak berkode (tidak menebak lokasi)
  const noLoc = await w.admin.api.post(`${V2}/units/${noPickup.unit.id}/confirm-arrival`, {}, idem("arr-noloc")); assert.ok(noLoc.status >= 400, "lokasi wajib");
  assert.equal((await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: noPickup.unit.id } })).status, "PENDING_ARRIVAL");
  const arr = await w.admin.api.post(`${V2}/units/${noPickup.unit.id}/confirm-arrival`, { locationId: w.rcv.id }, { "Idempotency-Key": "rencana-arr-nopick-0001" });
  assert.equal(arr.status, 200, JSON.stringify(arr.body)); assert.equal(arr.body.custody, false);
  const runNP = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: noPickup.unit.id }, include: { phases: true } });
  assert.equal(runNP.status, "ACTIVE"); assert.equal(runNP.phases.find((p) => p.phase === "INTAKE").status, "ACTIVE");
  assert.equal((await presenceOf(noPickup.unit)).key, "ARRIVED_CONFIRMED"); assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: noPickup.unit.id } })).storageLocation, w.rcv.code);
  const replay = await w.admin.api.post(`${V2}/units/${noPickup.unit.id}/confirm-arrival`, { locationId: w.rcv.id }, { "Idempotency-Key": "rencana-arr-nopick-0001" });
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: noPickup.unit.id, eventType: "PRODUCTION_ARRIVAL_CONFIRMED_NO_CUSTODY" } }), 1);
  // unit dengan pickup: jalur custody biasa tetap bekerja (ACCEPTED) dan presence ikut tiba
  const std = await w.admin.api.post(`${V2}/units/${withPickup.unit.id}/confirm-arrival`, { locationId: w.rcv.id }, { "Idempotency-Key": "rencana-arr-std-000001" });
  assert.equal(std.status, 200, JSON.stringify(std.body)); assert.equal((await presenceOf(withPickup.unit)).key, "ARRIVED_CONFIRMED");
  assert.equal((await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: withPickup.unit.id } })).status, "ACCEPTED");
  // unit yang belum Diproses tidak bisa 'tiba' tanpa pickup
  const early = await mkReal({ photo: "nojob", unitStatus: "AWAITING_PICKUP", orderStatus: "PICKUP" });
  await addCohort(early.unit.id); await testPrisma.productionRun.create({ data: { unitId: early.unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "PENDING_ARRIVAL", revision: 0, phases: { create: ["INTAKE", "DIAGNOSIS", "PROCESS", "QC", "HANDOFF"].map((phase, i) => ({ phase, sequence: i + 1, status: "NOT_STARTED" })) } } });
  const bad = await w.admin.api.post(`${V2}/units/${early.unit.id}/confirm-arrival`, { locationId: w.rcv.id }, idem("arr-early")); assert.equal(bad.status, 409); assert.equal(bad.body.code, "CUSTODY_ARRIVAL_UNIT_STATUS");
});

test("unit BARU/SEWA tanpa pickup LAHIR di workshop (jalur resmi): Run WORKSHOP_BORN ACTIVE, tanpa handoff, sudah di workshop; LAYANAN tanpa pickup tetap menunggu kedatangan; BARU dengan pickup nyata mengikuti custody", async () => {
  const born = await mkReal({ photo: "nojob", category: "BARU" }); const layanan = await mkReal({ photo: "nojob" }); const baruPick = await mkReal({ photo: "single", category: "BARU" }); const op = await mkOperator();
  await setCohort(born.unit.id, layanan.unit.id, baruPick.unit.id);
  const r = await schedule(born.unit, op); assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.origin, "WORKSHOP_BORN"); assert.equal(r.body.onboarded, true); assert.equal(r.body.viaCustody, false);
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: born.unit.id }, include: { plan: true } });
  assert.equal(run.origin, "WORKSHOP_BORN"); assert.equal(run.status, "ACTIVE"); assert.equal(run.currentPhase, "PROCESS"); assert.equal(run.plan.status, "PLANNED");
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: born.unit.id } }), 0, "tidak ada custody yang dikarang");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: born.unit.id, eventType: "PRODUCTION_RUN_ONBOARDED_RENCANA" } }), 1);
  const lay = await schedule(layanan.unit, op, { stationCode: "TABLE_2" }); assert.equal(lay.status, 201); assert.equal(lay.body.origin, "CUSTODY_PICKUP");
  assert.equal((await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: layanan.unit.id } })).status, "PENDING_ARRIVAL");
  const bp = await schedule(baruPick.unit, op, { stationCode: "TABLE_3" }); assert.equal(bp.status, 201); assert.equal(bp.body.origin, "CUSTODY_PICKUP"); assert.equal(bp.body.viaCustody, true);
  const items = (await w.lead.api.get(`${V2}/board?date=${DATE}`)).body.stations.flatMap((st) => st.items);
  assert.equal(items.find((v) => v.unit.id === born.unit.id).presence.key, "ARRIVED_CONFIRMED", "dibuat di workshop = sudah di workshop");
  assert.equal(items.find((v) => v.unit.id === layanan.unit.id).presence.key, "NOT_ARRIVED");
  // lahir di workshop hanya sekali: penjadwalan ulang memakai Run yang sama
  const again = await schedule(born.unit, op, { stationCode: "TABLE_4" }); assert.equal(again.status, 201); assert.equal(again.body.onboarded, false); assert.equal(await testPrisma.productionRun.count({ where: { unitId: born.unit.id } }), 1);
});

test("ATOMIK + kapasitas: Meja penuh / PIC tidak valid menggagalkan SELURUH perintah — tidak ada Run yatim, tidak ada handoff, unit tetap bisa dijadwalkan", async () => {
  const op = await mkOperator(); const fillers = [];
  for (let i = 0; i < 3; i += 1) fillers.push(await mkReal({ photo: "single" }));
  const target = await mkReal({ photo: "single" });
  await setCohort(...fillers.map((f) => f.unit.id), target.unit.id);
  for (const f of fillers) assert.equal((await schedule(f.unit, op)).status, 201);
  const full = await schedule(target.unit, op);
  assert.equal(full.status, 409); assert.equal(full.body.code, "PLAN_STATION_FULL");
  assert.deepEqual(await counts(target.unit), { runs: 0, plans: 0, handoffs: 0 }, "rollback total: tidak ada Run/handoff/rencana");
  assert.equal(itemOf(await backlog(), target.unit).rencana.action, "ONBOARD_SCHEDULE", "masih bisa dijadwalkan ke Meja lain");
  const inactive = await mkOperator("PRODUCTION_WORKER", { active: false });
  const badPic = await schedule(target.unit, inactive, { stationCode: "TABLE_2" });
  assert.equal(badPic.status, 422); assert.equal(badPic.body.code, "PLAN_OPERATOR_INVALID"); assert.deepEqual(await counts(target.unit), { runs: 0, plans: 0, handoffs: 0 });
  const noOp = await w.lead.api.post(`${V2}/plans`, { unitId: target.unit.id, productionDate: DATE, stationCode: "TABLE_2", workCenterId: w.wc.id }, idem("noop")); assert.equal(noOp.status, 400);
  assert.equal((await schedule(target.unit, op, { stationCode: "TABLE_2" })).status, 201, "Meja lain berhasil");
  assert.deepEqual(await counts(target.unit), { runs: 1, plans: 1, handoffs: 1 });
});

test("PENGECUALIAN: progres V1, Siap Kirim/Terkirim, belum diambil, di luar cohort, SPAM/staf — ditolak berkode, TANPA Run, dengan penjelasan", async () => {
  const op = await mkOperator();
  const v1 = await mkReal(); await testPrisma.unitStageLog.create({ data: { unitId: v1.unit.id, stageId: (await testPrisma.routingStage.findFirstOrThrow()).id, action: "START", actorId: w.lead.user.id, startedAt: new Date() } });
  const ready = await mkReal({ unitStatus: "READY_FOR_DELIVERY", orderStatus: "READY" }); const delivered = await mkReal({ unitStatus: "DELIVERED", orderStatus: "DELIVERED" });
  const pickup = await mkReal({ unitStatus: "AWAITING_PICKUP", orderStatus: "PICKUP", photo: "nojob" });
  const out = await mkReal(); const spam = await mkReal({ stage: "SPAM" }); const staff = await mkReal({ staff: true });
  await setCohort(v1.unit.id, ready.unit.id, delivered.unit.id, pickup.unit.id, spam.unit.id, staff.unit.id);
  const b = await backlog("?pageSize=100");
  const codes = b.items.map((i) => i.card.unit.unitCode);
  for (const x of [ready, delivered, spam, staff]) assert.ok(!codes.includes(x.unit.unitCode), "Siap Kirim/Terkirim/SPAM/staf tidak masuk Rencana");
  assert.equal(itemOf(b, out.unit).rencana.action, "AWAIT_ACTIVATION");
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: v1.unit.id } }), 1, "fixture progres V1 benar-benar ada");
  assert.equal(itemOf(b, v1.unit).rencana.code, "HAS_V1_PROGRESS"); assert.match(itemOf(b, v1.unit).rencana.next, /backfill/i);
  const r = await schedule(v1.unit, op); assert.equal(r.status, 422); assert.equal(r.body.code, "RENCANA_HAS_V1_PROGRESS");
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: v1.unit.id } }), 0, "progres V1 tidak disentuh, tidak ada Run");
  assert.equal(await testPrisma.unitStageLog.count({ where: { unitId: v1.unit.id } }), 1, "riwayat V1 utuh");
  const pk = await w.lead.api.get(`${V2}/backlog?status=PENGAMBILAN`); assert.equal(itemOf(pk.body, pickup.unit).rencana.action, "WAIT_PICKUP");
  const rp = await schedule(pickup.unit, op); assert.equal(rp.status, 409); assert.equal(rp.body.code, "RENCANA_WAIT_PICKUP");
  for (const [x, code, status] of [[ready, "RENCANA_UNIT_FINISHED", 422], [delivered, "RENCANA_UNIT_FINISHED", 422], [spam, "RENCANA_INTERNAL_OR_SPAM", 422], [staff, "RENCANA_INTERNAL_OR_SPAM", 422], [out, "RENCANA_UNIT_NOT_ACTIVATED", 503]]) {
    const r = await schedule(x.unit, op); assert.equal(r.status, status, `${x.unit.unitCode}: ${JSON.stringify(r.body)}`); assert.equal(r.body.code, code);
    assert.equal(await testPrisma.productionRun.count({ where: { unitId: x.unit.id } }), 0, "tidak ada Run lahir dari penolakan");
  }
});

test("TIDAK ADA RUN GANDA: dua penjadwalan bersamaan untuk unit yang sama (kunci berbeda) -> tepat SATU Run aktif; Run lama/progres tidak diganti", async () => {
  const real = await mkReal(); const op = await mkOperator(); await setCohort(real.unit.id);
  const [a, b] = await Promise.all([schedule(real.unit, op, { stationCode: "TABLE_1" }), schedule(real.unit, op, { stationCode: "TABLE_2" })]);
  assert.ok([a.status, b.status].filter((s) => s === 201).length >= 1, `minimal satu berhasil: ${a.status}/${b.status}`);
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: real.unit.id, status: { notIn: ["COMPLETED", "CANCELLED"] } } }), 1);
  assert.equal(await testPrisma.productionRunPlan.count({ where: { run: { unitId: real.unit.id } } }), 1);
  // Run yang sudah ada & sudah dikerjakan tidak diganti: memakai Run itu (SCHEDULE), progres tetap
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: real.unit.id } });
  const again = await schedule(real.unit, op, { stationCode: "TABLE_4" }); assert.equal(again.status, 201); assert.equal(again.body.runId, run.id); assert.equal(again.body.onboarded, false);
  // unit yang sudah punya Run lama (mis. dari custody) di cohort: kartu penuh, bukan onboarding
  const old = await mkReal({ photo: "single" }); await addCohort(old.unit.id);
  const oldRunRow = await testPrisma.productionRun.create({ data: { unitId: old.unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "INTAKE", revision: 1, phases: { create: ["INTAKE", "DIAGNOSIS", "PROCESS", "QC", "HANDOFF"].map((phase, i) => ({ phase, sequence: i + 1, status: phase === "INTAKE" ? "ACTIVE" : "NOT_STARTED" })) } } });
  await testPrisma.unitCustodyHandoff.create({ data: { unitId: old.unit.id, deliveryJobId: old.job.id, direction: "INBOUND", status: "ACCEPTED", productionRunId: oldRunRow.id, acceptedAt: new Date(), revision: 2 } }); // Run lama yang SAH: custody sudah diterima Gudang
  const item = itemOf(await backlog(), old.unit); assert.equal(item.schedulable, true); assert.equal(item.rencana.action, "SCHEDULE"); assert.ok(item.view.runId);
  const oldRun = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: old.unit.id } });
  const r = await schedule(old.unit, op, { stationCode: "TABLE_2" }); assert.equal(r.status, 201); assert.equal(r.body.runId, oldRun.id, "memakai Run yang ada"); assert.equal(r.body.onboarded, false);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: oldRun.id } })).status, "ACTIVE", "status Run lama tidak diubah");
});

test("izin & kontrak: PIC/Driver ditolak 403 untuk perintah jadwal order nyata dan daftar eligibility; Lead/Admin diizinkan; eligibility menjelaskan setiap unit", async () => {
  const real = await mkReal(); const op = await mkOperator(); await setCohort(real.unit.id);
  for (const who of [w.worker, w.driver]) {
    assert.equal((await who.api.post(`${V2}/plans`, { unitId: real.unit.id, ...body(op) }, idem("deny"))).status, 403);
    assert.equal((await who.api.get(`${V2}/planning/eligibility`)).status, 403);
  }
  assert.equal(await testPrisma.productionRun.count({ where: { unitId: real.unit.id } }), 0);
  const e = await w.admin.api.get(`${V2}/planning/eligibility`); assert.equal(e.status, 200);
  assert.equal(e.body.cohort.writer.size, 1); assert.equal(e.body.cohort.reader.size, 1); assert.equal(e.body.summary.total, 1); assert.equal(e.body.units[0].action, "ONBOARD_SCHEDULE");
  assert.match(e.body.activation.script, /activate-rencana-units\.js/);
  assert.equal((await w.lead.api.post(`${V2}/plans`, { unitId: "bukan-uuid", ...body(op) }, idem("baduuid"))).status, 400);
  assert.equal((await w.lead.api.post(`${V2}/plans`, { unitId: real.unit.id, ...body(op) })).status, 400, "Idempotency-Key wajib");
  assert.equal((await w.lead.api.post(`${V2}/plans`, { unitId: real.unit.id, ...body(op), stationCode: "TABLE_9" }, idem("badstn"))).status, 400);
});

test("SKRIP aktivasi: dry-run tidak menulis; --apply wajib backup; hanya unit eligible; reader+writer berubah bersama; flag MATI tidak dinyalakan; batas --max; deactivate hanya unit tanpa Run", async () => {
  const canary = await mkReal(); const a = await mkReal(); const b = await mkReal(); const blocked = await mkReal({ orderStatus: "PENDING" }); const finished = await mkReal({ unitStatus: "READY_FOR_DELIVERY", orderStatus: "PROCESSING" }); const pk = await mkReal({ unitStatus: "AWAITING_PICKUP", orderStatus: "PICKUP", photo: "nojob" });
  await setCohort(canary.unit.id);
  const run = (args, env = {}) => {
    try { return { code: 0, out: execFileSync(process.execPath, ["scripts/production-delivery-v2/activate-rencana-units.js", ...args], { cwd: backendRoot, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
    catch (e) { return { code: e.status, out: String(e.stdout || "") + String(e.stderr || "") }; }
  };
  const flagIds = async (k) => (await testPrisma.v2FeatureFlag.findUniqueOrThrow({ where: { key: k } })).config.unitIds.slice().sort();
  const list = run([]); assert.equal(list.code, 0, list.out); assert.match(list.out, /DAFTAR \(baca-saja\)/); assert.match(list.out, new RegExp(a.unit.unitCode));
  // dry-run: menampilkan perubahan, TIDAK menulis
  const dry = run([`--unit-codes=${a.unit.unitCode},${b.unit.unitCode}`]); assert.equal(dry.code, 0, dry.out); assert.match(dry.out, /DRY-RUN/);
  assert.deepEqual(await flagIds(V2_FLAGS.PRODUCTION_WRITER), [canary.unit.id]);
  // apply tanpa konfirmasi backup = ditolak, tidak menulis
  const nobk = run([`--unit-codes=${a.unit.unitCode}`, "--apply"]); assert.equal(nobk.code, 1); assert.match(nobk.out, /Backup database belum dikonfirmasi/); assert.deepEqual(await flagIds(V2_FLAGS.PRODUCTION_WRITER), [canary.unit.id]);
  // unit pengecualian ditolak dengan alasan; satu pengecualian menggagalkan seluruh batch (tidak sebagian)
  const rej = run([`--unit-codes=${a.unit.unitCode},${blocked.unit.unitCode}`, "--apply"], { RENCANA_BACKUP_OK: "1" }); assert.equal(rej.code, 1); assert.match(rej.out, /ORDER_NOT_PROCESSING/); assert.match(rej.out, /tidak boleh diproses/i);
  const fin = run([`--unit-codes=${finished.unit.unitCode}`, "--apply"], { RENCANA_BACKUP_OK: "1" }); assert.equal(fin.code, 1); assert.match(fin.out, /tidak ditemukan di daftar kandidat/, "unit Siap Kirim/Terkirim tidak pernah menjadi kandidat"); assert.deepEqual(await flagIds(V2_FLAGS.PRODUCTION_WRITER), [canary.unit.id]);
  assert.equal(run([`--unit-codes=${pk.unit.unitCode}`, "--apply"], { RENCANA_BACKUP_OK: "1" }).code, 1, "unit Pengambilan belum eligible");
  assert.equal(run([`--unit-codes=${a.unit.unitCode},${b.unit.unitCode}`, "--max=1", "--apply"], { RENCANA_BACKUP_OK: "1" }).code, 1, "melebihi --max");
  // apply sah: reader & writer bertambah BERSAMA, unit lama (canary) dipertahankan, unit lain tidak tersentuh
  const ok = run([`--unit-codes=${a.unit.unitCode}`, "--apply"], { RENCANA_BACKUP_OK: "1" }); assert.equal(ok.code, 0, ok.out); assert.match(ok.out, /APPLIED/);
  const want = [canary.unit.id, a.unit.id].sort();
  assert.deepEqual(await flagIds(V2_FLAGS.PRODUCTION_WRITER), want); assert.deepEqual(await flagIds(V2_FLAGS.PRODUCTION_READER), want);
  assert.equal(itemOf(await backlog(), a.unit).rencana.action, "ONBOARD_SCHEDULE"); assert.equal(itemOf(await backlog(), b.unit).rencana.action, "AWAIT_ACTIVATION");
  assert.match((await testPrisma.v2FeatureFlag.findUniqueOrThrow({ where: { key: V2_FLAGS.PRODUCTION_WRITER } })).reason, /Aktivasi Rencana Produksi: \+1 unit/);
  // unit teraktivasi yang SUDAH punya Run tidak boleh dikeluarkan; unit tanpa Run boleh
  const op = await mkOperator(); assert.equal((await schedule(a.unit, op)).status, 201);
  const de1 = run([`--unit-codes=${a.unit.unitCode}`, "--deactivate", "--apply"], { RENCANA_BACKUP_OK: "1" }); assert.equal(de1.code, 1); assert.match(de1.out, /Run aktif/);
  await addCohort(b.unit.id); const de2 = run([`--unit-codes=${b.unit.unitCode}`, "--deactivate", "--apply"], { RENCANA_BACKUP_OK: "1" }); assert.equal(de2.code, 0, de2.out);
  assert.ok(!(await flagIds(V2_FLAGS.PRODUCTION_WRITER)).includes(b.unit.id));
  // flag MATI tidak pernah dinyalakan oleh skrip
  await setFlag(V2_FLAGS.PRODUCTION_WRITER, null);
  const off = run([`--unit-codes=${b.unit.unitCode}`, "--apply"], { RENCANA_BACKUP_OK: "1" }); assert.equal(off.code, 1); assert.match(off.out, /keputusan terpisah/);
  assert.equal((await testPrisma.v2FeatureFlag.findUniqueOrThrow({ where: { key: V2_FLAGS.PRODUCTION_WRITER } })).enabled, false);
});
