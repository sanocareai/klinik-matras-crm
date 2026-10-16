// KONFIRMASI BARANG JADI + KANDIDAT ROUTE PLANNER "MENUNGGU KONFIRMASI SIAP KIRIM" (16 Okt 2026, kasus RES-03102026-018-U1) — HTTP + PostgreSQL nyata.
// Keadaan Rika direplikasi: run adaptasi AKTIF, tahap 1–5 + gerbang QC dilewati, tahap 9 tercatat, tahap Corner 10–12 TIDAK dicatat, unit IN_PRODUCTION.
// Dikunci: (1) unit valid muncul sebagai kandidat dan bisa ditempatkan sebagai job DRAF tanpa mengubah status unit/mengizinkan dispatch; (2) publish/penugasan driver ditolak selama menunggu;
// (3) Konfirmasi Barang Jadi: petugas berwenang, alasan/kode unit/lokasi/verifikasi wajib, jalur resmi (tahap DILEWATI eksplisit, tanpa custody/stok/QC/serah terima palsu); (4) setelah konfirmasi
// status Siap Kirim konsisten, job draf yang SAMA dipakai (tanpa job ganda), publish lolos; (5) unit batal/terkirim/job ganda ditolak; (6) per unit pada order multi-unit; (7) replay, konkurensi, rollback.
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

let server;
let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => {
  await truncateAll();
  // truncateAll tidak menghapus pusat kerja/gudang/lokasi: bersihkan milik file ini supaya tidak mencemari file lain pada DB uji yang sama.
  await testPrisma.storageLocation.deleteMany({ where: { code: { contains: "-P8-" } } }).catch(() => {});
  await testPrisma.warehouse.deleteMany({ where: { code: { startsWith: "WH-KBJ-" } } }).catch(() => {});
  await testPrisma.workCenter.deleteMany({ where: { code: { startsWith: "WC-KBJ-" } } }).catch(() => {});
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
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-KBJ-${++seq}`, name: "Workshop Utama" } });
  const nadyaOp = await testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: nadya.user.id, primaryWorkCenterId: workCenter.id } });
  const cornerOp = await testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: corner.user.id, primaryWorkCenterId: workCenter.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-KBJ-${++seq}`, name: "Gudang P8" } });
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
    data: { customerId: customer.id, orderNumber: `KBJO-${++seq}`, value: 1000, category: "LAYANAN", beratBadan: 85, complaintCategory: ["SAKIT_PINGGANG"], notes: "Minta tekstur firm" },
  });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-KBJ-${++seq}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP", merk: "King Koil", ukuran: "180x200" } });
  const route = await testPrisma.route.create({ data: { code: `KBJ-RTE-${++seq}`, date: new Date("2026-09-29T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
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
async function rikaLike(w) {
  await enableAdaptationDefault();
  const { unit, run } = await acceptedUnit(w);
  await planOnBoard(w, run.id);
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

test("1. KASUS RIKA: unit IN_PRODUCTION BUKAN siap kirim — tidak ada di kandidat biasa, tidak bisa dijadwalkan biasa; muncul sebagai kandidat DRAF; ditempatkan sebagai job draf tanpa mengubah status/driver", async () => {
  const w = await world(); const pl = await planner();
  const { unit, run } = await rikaLike(w);
  const biasa = ok(await pl.api.get(`${ARM}/board?type=DELIVERY&date=${TGL}`));
  assert.ok(!biasa.available.some((u) => u.id === unit.id), "kandidat biasa tidak memuat unit yang belum siap");
  assert.deepEqual(biasa.availableMenunggu, [], "tanpa opt-in, kandidat menunggu tidak dikirim");
  const tolakBiasa = await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [unit.id], scheduledDate: TGL });
  assert.equal(tolakBiasa.status, 400); assert.match(tolakBiasa.body.error, /IN_PRODUCTION.*tidak bisa dijadwalkan/);

  const kand = ok(await pl.api.get(`${ARM}/board?type=DELIVERY&date=${TGL}&termasukMenunggu=1`));
  assert.ok(kand.availableMenunggu.some((u) => u.id === unit.id), "unit produksi aktif yang valid = kandidat draf");
  assert.ok(!kand.available.some((u) => u.id === unit.id), "tetap BUKAN unit siap");

  const before = await hitung(unit.id, run.id);
  const denganDriver = await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [unit.id], scheduledDate: TGL, menungguKonfirmasi: true, driverId: w.driver.user.id });
  assert.equal(denganDriver.status, 400); assert.match(denganDriver.body.error, /tidak boleh diberi driver/);
  const draf = await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [unit.id], scheduledDate: TGL, menungguKonfirmasi: true });
  assert.equal(draf.status, 201, JSON.stringify(draf.body));
  assert.equal(draf.body.driverId, null); assert.ok(["UNSCHEDULED", "SCHEDULED"].includes(draf.body.status), draf.body.status);
  assert.equal(await unitStatus(unit.id), "IN_PRODUCTION", "status unit TIDAK berubah");
  const after = await hitung(unit.id, run.id);
  assert.deepEqual({ ...after, jobDel: 0 }, { ...before, jobDel: 0 }, "tidak ada bukti/QC/stok/custody baru");
  assert.equal(after.jobDel, 1);
  const ganda = await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [unit.id], scheduledDate: TGL, menungguKonfirmasi: true });
  assert.equal(ganda.status, 409); assert.equal(ganda.body.code, "JOB_GANDA");
  assert.equal((await jobDeliveryUnit(unit.id)).length, 1);
  const b2 = ok(await pl.api.get(`${ARM}/board?type=DELIVERY&date=${TGL}`));
  const j = b2.jobs.find((x) => x.id === draf.body.id);
  assert.ok(j, "job draf tampil di papan");
  assert.equal(j.labelMenunggu, "Menunggu konfirmasi siap kirim"); assert.deepEqual(j.menungguKonfirmasi.map((u) => u.unitCode), [unit.unitCode]);
});

test("2. Dispatch DITOLAK selama menunggu: tidak bisa diberi driver, tidak bisa diterbitkan; boleh ditempatkan di rute DRAFT", async () => {
  const w = await world(); const pl = await planner();
  const { unit } = await rikaLike(w);
  const job = (await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [unit.id], scheduledDate: TGL, menungguKonfirmasi: true })).body;
  const beri = await pl.api.patch(`${ARM}/jobs/${job.id}`, { driverId: w.driver.user.id });
  assert.equal(beri.status, 409, JSON.stringify(beri.body)); assert.equal(beri.body.code, "MENUNGGU_KONFIRMASI_SIAP_KIRIM"); assert.match(beri.body.error, new RegExp(unit.unitCode));
  assert.equal((await testPrisma.job.findUniqueOrThrow({ where: { id: job.id } })).driverId, null);

  const rute = ok2(await pl.api.post(`${ARM}/routes`, { date: TGL, driverId: w.driver.user.id }));
  const taruh = await pl.api.patch(`${ARM}/routes/${rute.id}/jobs`, { jobIds: [job.id] });
  assert.equal(taruh.status, 200, JSON.stringify(taruh.body));
  const r = ok(await pl.api.get(`${ARM}/routes/${rute.id}`));
  assert.equal(r.jobs.find((x) => x.id === job.id).labelMenunggu, "Menunggu konfirmasi siap kirim");
  const terbit = await pl.api.post(`${ARM}/routes/${rute.id}/publish`, {});
  assert.equal(terbit.status, 409, JSON.stringify(terbit.body));
  assert.equal(terbit.body.code, "MENUNGGU_KONFIRMASI_SIAP_KIRIM"); assert.deepEqual(terbit.body.menungguKonfirmasi.map((u) => u.unitCode), [unit.unitCode]);
  const rute2 = await testPrisma.route.findUniqueOrThrow({ where: { id: rute.id } });
  assert.equal(rute2.status, "DRAFT"); assert.equal(rute2.publishedAt, null);
  // Menaruh job di rute DRAFT = perencanaan (driver app hanya melihat rute PUBLISHED); yang dijaga: tidak bisa diterbitkan dan tidak bisa DIJALANKAN selama menunggu.
  const mulai = await pl.api.post(`${ARM}/jobs/${job.id}/start`, {}, key("kbj-start"));
  assert.equal(mulai.status, 409, JSON.stringify(mulai.body)); assert.equal(mulai.body.code, "MENUNGGU_KONFIRMASI_SIAP_KIRIM");
  assert.equal((await testPrisma.job.findUniqueOrThrow({ where: { id: job.id } })).status !== "EN_ROUTE", true);
});

test("3. KONFIRMASI BARANG JADI: wajib alasan/kode unit/lokasi sah/verifikasi fisik; hanya petugas berwenang; jalur resmi tanpa bukti/QC/stok/custody palsu; job draf yang SAMA dipakai; publish lolos", async () => {
  const w = await world(); const pl = await planner();
  const { unit, run } = await rikaLike(w);
  const draf = (await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [unit.id], scheduledDate: TGL, menungguKonfirmasi: true })).body;
  const rute = ok2(await pl.api.post(`${ARM}/routes`, { date: TGL, driverId: w.driver.user.id }));
  ok2(await pl.api.patch(`${ARM}/routes/${rute.id}/jobs`, { jobIds: [draf.id] }));
  const sebelum = await hitung(unit.id, run.id);
  const aktJumlah = await testPrisma.activityEvent.count({ where: { entityId: unit.id } });

  assert.equal((await kbj(w, w.lead, unit, run, { physicalVerified: false })).status, 400);
  assert.equal((await kbj(w, w.lead, unit, run, { reason: "udah" })).status, 400);
  const salahKode = await kbj(w, w.lead, unit, run, { unitCode: "UNIT-SALAH-1" });
  assert.equal(salahKode.status, 409); assert.equal(salahKode.body.code, "CONFIRM_FG_UNIT_CODE_MISMATCH");
  const salahLok = await kbj(w, w.lead, unit, run, { locationId: w.rcv.id });
  assert.equal(salahLok.status, 422, JSON.stringify(salahLok.body)); assert.match(salahLok.body.code, /^CUSTODY_LOCATION/);
  assert.equal((await kbj(w, w.driver, unit, run)).status, 403, "bukan petugas berwenang/PIC");
  assert.equal((await kbj(w, w.qc, unit, run)).status, 403);
  assert.deepEqual(await hitung(unit.id, run.id), sebelum); assert.equal(await unitStatus(unit.id), "IN_PRODUCTION");

  const lokasi = ok(await w.lead.api.get(`${V2}/runs/${run.id}/confirm-finished-goods/locations`));
  assert.ok(lokasi.locations.some((l) => l.id === w.fg.id)); assert.ok(!lokasi.locations.some((l) => l.id === w.rcv.id));

  const done = await kbj(w, w.lead, unit, run, { tag: "kbj-ok" });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual([done.body.completed, done.body.unitStatus, done.body.qc, done.body.handoffGudang], [true, "READY_FOR_DELIVERY", "TIDAK_DILAKUKAN", "TIDAK_DIWAJIBKAN"]);
  assert.equal(done.body.lokasi.id, w.fg.id); assert.equal(done.body.konfirmasi.bySupervisor, true);

  const u = await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } });
  assert.equal(u.status, "READY_FOR_DELIVERY"); assert.equal(u.storageLocation, w.fg.code, "lokasi diproyeksikan dari StorageLocation kanonis");
  const r = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id }, include: { phases: true } });
  assert.equal(r.status, "COMPLETED");
  const ph = Object.fromEntries(r.phases.map((p) => [p.phase, p.status]));
  assert.equal(ph.QC, "NOT_APPLICABLE"); assert.equal(ph.HANDOFF, "NOT_APPLICABLE");
  const sesudah = await hitung(unit.id, run.id);
  assert.equal(sesudah.custodyFg, 0, "tanpa serah terima/custody ACCEPTED palsu");
  assert.equal(sesudah.stok, sebelum.stok, "tanpa gerakan stok"); assert.equal(sesudah.qc, 0, "tanpa inspeksi/hasil uji karangan");
  assert.equal(sesudah.nonSkipped, sebelum.nonSkipped, "bukti baru hanya berstatus SKIPPED (bukan pekerjaan)");
  assert.ok(sesudah.ev > sebelum.ev);
  assert.equal(sesudah.jobDel, 1, "job draf yang SAMA dipakai — tanpa job ganda");
  const [ju] = await jobDeliveryUnit(unit.id); assert.equal(ju.jobId, draf.id);
  const aktivitas = await testPrisma.activityEvent.findMany({ where: { entityId: unit.id, eventType: "PRODUCTION_FINISHED_ADAPTATION" } });
  const k = aktivitas.at(-1).metadata.konfirmasiBarangJadi;
  assert.ok(k && k.reason.startsWith("Pekerjaan fisik selesai") && k.locationCode === w.fg.code && k.actorId === w.lead.user.id && k.confirmedAt, "identitas, waktu, lokasi, alasan tercatat");
  assert.ok((await testPrisma.activityEvent.count({ where: { entityId: unit.id } })) > aktJumlah);

  const kand = ok(await pl.api.get(`${ARM}/board?type=DELIVERY&date=${TGL}&termasukMenunggu=1`));
  assert.ok(!kand.availableMenunggu.some((x) => x.id === unit.id));
  const r2 = ok(await pl.api.get(`${ARM}/routes/${rute.id}`));
  assert.deepEqual(r2.jobs.find((x) => x.id === draf.id).menungguKonfirmasi, []);
  const terbit = await pl.api.post(`${ARM}/routes/${rute.id}/publish`, {});
  assert.equal(terbit.status, 200, JSON.stringify(terbit.body));

  const ulang = await kbj(w, w.lead, unit, run, { tag: "kbj-ok", rev: 6 });
  assert.equal(ulang.status, 200, JSON.stringify(ulang.body)); assert.deepEqual(await hitung(unit.id, run.id), sesudah);
  assert.equal((await jobDeliveryUnit(unit.id)).length, 1);
  const lagi = await kbj(w, w.lead, unit, run, { tag: "kbj-lagi" });
  assert.equal(lagi.status, 409, JSON.stringify(lagi.body));
});

test("4. Penolakan: unit batal/terkirim/berangkat/sudah siap, order batal, job ganda tidak bisa ditempatkan sebagai draf; PICKUP tidak memakai jalur draf; run alur lengkap tidak bisa dikonfirmasi", async () => {
  const w = await world(); const pl = await planner();
  const mk = async (status, orderStatus = "PROCESSING") => {
    const customer = await testPrisma.customer.create({ data: { name: `Cust ${++seq}` } });
    const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `KBJ-O-${++seq}`, value: 100, category: "LAYANAN", status: orderStatus } });
    return testPrisma.unit.create({ data: { unitCode: `KBJ-U-${++seq}`, orderId: order.id, seq: 1, status } });
  };
  const draf = (u) => pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [u.id], scheduledDate: TGL, menungguKonfirmasi: true });
  for (const [st, kode] of [["CANCELLED", "UNIT_BATAL"], ["DELIVERED", "UNIT_SUDAH_BERANGKAT"], ["IN_TRANSIT_OUT", "UNIT_SUDAH_BERANGKAT"], ["READY_FOR_DELIVERY", "UNIT_SUDAH_SIAP"], ["AWAITING_PICKUP", "UNIT_BUKAN_PRODUKSI"]]) {
    const u = await mk(st); const r = await draf(u);
    assert.equal(r.status, 409, `${st}: ${JSON.stringify(r.body)}`); assert.equal(r.body.code, kode, st);
    assert.equal(await testPrisma.jobUnit.count({ where: { unitId: u.id } }), 0);
  }
  const ob = await mk("IN_PRODUCTION", "CANCELLED");
  const r = await draf(ob); assert.equal(r.status, 409); assert.equal(r.body.code, "ORDER_TIDAK_SAH");
  const up = await mk("IN_PRODUCTION");
  const p = await pl.api.post(`${ARM}/jobs`, { type: "PICKUP", unitIds: [up.id], menungguKonfirmasi: true });
  assert.equal(p.status, 400);
  const { unit, run } = await acceptedUnit(w);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).adaptationPolicy, null);
  await planOnBoard(w, run.id);
  const res = await kbj(w, w.lead, unit, run);
  assert.equal(res.status, 409, JSON.stringify(res.body)); assert.equal(res.body.code, "CONFIRM_FG_NOT_ADAPTATION");
});

test("5. PER UNIT pada order multi-unit: unit A dikonfirmasi, unit B belum — job tetap menunggu karena B; label menyebut B saja; publish ditolak sampai B siap", async () => {
  const w = await world(); const pl = await planner();
  const { unit: a, run } = await rikaLike(w);
  const b = await testPrisma.unit.create({ data: { unitCode: `${a.unitCode}-B`, orderId: a.orderId, seq: 2, status: "IN_PRODUCTION" } });
  const draf = ok2(await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [a.id, b.id], scheduledDate: TGL, menungguKonfirmasi: true }));
  assert.equal((await jobDeliveryUnit(a.id))[0].jobId, (await jobDeliveryUnit(b.id))[0].jobId, "satu job menaungi kedua unit");
  const rute = ok2(await pl.api.post(`${ARM}/routes`, { date: TGL, driverId: w.driver.user.id }));
  ok2(await pl.api.patch(`${ARM}/routes/${rute.id}/jobs`, { jobIds: [draf.id] }));

  const done = await kbj(w, w.lead, a, run, { tag: "kbj-multi" });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(await unitStatus(a.id), "READY_FOR_DELIVERY"); assert.equal(await unitStatus(b.id), "IN_PRODUCTION", "unit B tidak ikut berubah");
  assert.equal((await jobDeliveryUnit(a.id)).length, 1, "tidak ada job ganda untuk unit A"); assert.equal(await testPrisma.job.count({ where: { type: "DELIVERY" } }), 1);
  const r = ok(await pl.api.get(`${ARM}/routes/${rute.id}`));
  assert.deepEqual(r.jobs.find((x) => x.id === draf.id).menungguKonfirmasi.map((u) => u.unitCode), [b.unitCode], "hanya B yang menunggu");
  const terbit = await pl.api.post(`${ARM}/routes/${rute.id}/publish`, {});
  assert.equal(terbit.status, 409); assert.deepEqual(terbit.body.menungguKonfirmasi.map((u) => u.unitCode), [b.unitCode]);
});

test("6. KONKURENSI: dua konfirmasi bersamaan untuk unit yang sama -> tepat satu berhasil; satu job, satu outbox completed, tanpa event ganda", async () => {
  const w = await world(); const pl = await planner();
  const { unit, run } = await rikaLike(w);
  ok2(await pl.api.post(`${ARM}/jobs`, { type: "DELIVERY", unitIds: [unit.id], scheduledDate: TGL, menungguKonfirmasi: true }));
  const rev = (await card(w, run.id)).revision;
  const kirim = (n) => w.lead.api.post(`${V2}/runs/${run.id}/confirm-finished-goods`, bodyKbj(w, unit, { rev }), key(`kbj-par-${n}`));
  const [x, y] = await Promise.all([kirim(1), kirim(2)]);
  assert.equal([x.status, y.status].filter((s) => s === 200).length, 1, `${x.status}/${y.status}`);
  assert.ok([x.status, y.status].every((s) => [200, 404, 409].includes(s)));
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "production.run.completed", aggregateId: run.id } }), 1);
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "production.finished.adaptation", aggregateId: run.id } }), 1);
  assert.equal((await jobDeliveryUnit(unit.id)).length, 1);
  assert.equal(await unitStatus(unit.id), "READY_FOR_DELIVERY");
});

test("7. ROLLBACK: kegagalan di akhir konfirmasi (trigger DB) membatalkan SEMUA tulisan — unit tetap IN_PRODUCTION, lokasi tidak berubah, tidak ada bukti/job; konfirmasi ulang berhasil", async () => {
  const w = await world();
  const { unit, run } = await rikaLike(w);
  const snap = async () => ({
    ...(await hitung(unit.id, run.id)), unit: await unitStatus(unit.id), loc: (await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).storageLocation,
    run: (await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).revision, outbox: await testPrisma.domainOutbox.count({ where: { aggregateId: run.id } }),
    act: await testPrisma.activityEvent.count({ where: { entityId: unit.id } }), logs: await testPrisma.unitStageLog.count({ where: { unitId: unit.id } }),
  });
  const before = await snap();
  await testPrisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION kbj_fail_complete() RETURNS trigger AS $$ BEGIN IF NEW.status = 'COMPLETED' THEN RAISE EXCEPTION 'kbj rollback uji'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await testPrisma.$executeRawUnsafe(`CREATE TRIGGER kbj_fail_complete_trg BEFORE UPDATE ON production_runs_v2 FOR EACH ROW EXECUTE FUNCTION kbj_fail_complete()`);
  try {
    const res = await kbj(w, w.lead, unit, run, { tag: "kbj-rb" });
    assert.equal(res.status, 500);
    assert.deepEqual(await snap(), before, "rollback penuh");
    assert.equal(await testPrisma.v2Command.count({ where: { idempotencyKey: "s2-test-kbj-rb-0001" } }), 0);
  } finally {
    await testPrisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS kbj_fail_complete_trg ON production_runs_v2");
    await testPrisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS kbj_fail_complete()");
  }
  const ok3 = await kbj(w, w.lead, unit, run, { tag: "kbj-rb2" });
  assert.equal(ok3.status, 200, JSON.stringify(ok3.body));
  assert.equal(await unitStatus(unit.id), "READY_FOR_DELIVERY");
});

test("8. PIC yang ditugaskan juga boleh mengonfirmasi (alasan/kode unit/lokasi tetap wajib); tanpa JOB_READ tidak bisa membaca papan", async () => {
  const w = await world();
  const { unit, run } = await rikaLike(w);
  const res = await kbj(w, w.nadya, unit, run, { tag: "kbj-pic" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.konfirmasi.bySupervisor, false);
  assert.equal((await w.driver.api.get(`${ARM}/board?type=DELIVERY&termasukMenunggu=1`)).status, 403);
});
