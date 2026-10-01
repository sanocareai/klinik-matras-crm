// Antrean retur sisa bahan (wajib sampai Gudang menerima) + urutan manual unit per meja (prioritas = urutan bawaan saja).
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

let server;
let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (v) => ({ "Idempotency-Key": `prq-test-${v}-0001` });
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
    createTestUser({ roles: ["ADMIN", "WAREHOUSE", "PRODUCTION_WORKER"] }), // rangkap Operator + Gudang, TANPA QC_WRITE
    createTestUser({ roles: ["PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["QC_LEAD"] }),
    createTestUser({ roles: ["DRIVER"] }),
  ]);
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-P8-${++seq}`, name: "Workshop Utama" } });
  const nadyaOp = await testPrisma.productionOperator.create({ data: { userId: nadya.user.id, primaryWorkCenterId: workCenter.id } });
  const cornerOp = await testPrisma.productionOperator.create({ data: { userId: corner.user.id, primaryWorkCenterId: workCenter.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-P8-${++seq}`, name: "Gudang P8" } });
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
async function acceptedUnit(w, { cohort = true } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Ibu Maya ${++seq}` } });
  const order = await testPrisma.order.create({
    data: { customerId: customer.id, orderNumber: `P8O-${++seq}`, value: 1000, category: "LAYANAN", beratBadan: 85, complaintCategory: ["SAKIT_PINGGANG"], notes: "Minta tekstur firm" },
  });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-P8-${++seq}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP", merk: "King Koil", ukuran: "180x200" } });
  const route = await testPrisma.route.create({ data: { code: `P8-RTE-${++seq}`, date: new Date("2026-09-29T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
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
  return { unit, run: await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } }) };
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

async function setBomAndIssue(w, planId) {
  const plan = (await w.lead.api.get(`${P}/plans/${planId}`)).body;
  const bom = ok(await w.lead.api.post(`${P}/plans/${planId}/bom`, { lines: [{ materialId: w.fondasi.id, qty: 1 }, { materialId: w.lapisan.id, qty: 2 }], expectedRevision: plan.revision }, key(`bom-${++seq}`)));
  const reserve = ok(await w.nadya.api.post(`${P}/plans/${planId}/reserve`, { expectedRevision: bom.revision }, key(`res-${++seq}`)));
  assert.equal(reserve.status, "MATERIAL_RESERVED");
  const req = await w.nadya.api.post(`${P}/plans/${planId}/material-request`, {}, key(`mr-${++seq}`));
  assert.equal(req.status, 201, JSON.stringify(req.body));
  return req.body.issueId;
}
const pick = async (w, issueId) => ok(await w.nadya.api.post(`${P}/material-requests/${issueId}/pick`, { expectedRevision: 1 }, key(`pk-${++seq}`)));

// Tahap 1–4 (intake) sampai operasi diagnosa berjalan.
async function throughIntake(w, runId) {
  ok(await step(w, w.nadya, runId, 1, { payload: { conditionConfirmed: true, conditionNote: "kain luar kusam" }, media: await media(w.nadya, runId, "i") }));
  ok(await step(w, w.nadya, runId, 2, { payload: { feelNote: "Tengah terasa amblas" }, media: await media(w.nadya, runId, "v") }));
  ok(await step(w, w.nadya, runId, 3, { payload: { oldMaterials: ["PER", { type: "BUSA", note: "kuning kempes" }] }, media: await media(w.nadya, runId, "i", "i") }));
  ok(await step(w, w.nadya, runId, 4, { payload: { heightBeforeCm: 24, heightCompressedCm: 17, testerWeightKg: 85, foundationIssues: ["Per tengah lemah"] }, media: await media(w.nadya, runId, "v") }));
}

const DIAG = { diagnosis: "Per tengah lemah dan busa penopang kempes sehingga pinggang melengkung saat tidur.", inputMethod: "TEXT" };

// Jalankan satu unit sampai tahap 12 selesai (barang jadi ditawarkan ke Gudang). Fondasi dipakai 1 dari 1 diserahkan; lapisan dipakai `usedLapisan` dari 2.
async function runToFinish(w, { usedLapisan = 1 } = {}) {
  const { unit, run } = await acceptedUnit(w);
  const planned = await planOnBoard(w, run.id);
  await throughIntake(w, run.id);
  ok(await step(w, w.nadya, run.id, 5, { payload: DIAG }));
  ok(await w.lead.api.patch(`/api/units/${unit.id}/service`, { serviceId: w.service.id }));
  const issueId = await setBomAndIssue(w, planned.planId);
  ok(await step(w, w.nadya, run.id, 5, {}));
  await pick(w, issueId);
  ok(await step(w, w.nadya, run.id, 6, {}));
  ok(await step(w, w.nadya, run.id, 6, { payload: { note: "Pocket spring baru + penguat pinggir", materials: [{ materialId: w.fondasi.id, qty: 1 }] }, media: await media(w.nadya, run.id, "v") }));
  ok(await step(w, w.nadya, run.id, 7, { payload: { materials: [{ materialId: w.lapisan.id, qty: usedLapisan }] }, media: await media(w.nadya, run.id, "i") }));
  ok(await step(w, w.nadya, run.id, 8, { payload: { verdict: "PAS", testerWeightKg: 85 }, media: await media(w.nadya, run.id, "v") }));
  const qcRun = (await w.qc.api.get(`${P}/qc/runs/${run.id}`)).body;
  ok(await w.qc.api.post(`${P}/qc/runs/${run.id}/inspect`, { expectedRevision: qcRun.revision, result: "PASS", photoUrls: ["/media/job-photos/qc.jpg"], referenceWeightKg: 85, fitVerdict: "PAS", note: "lulus" }, key(`qc-${++seq}`)));
  ok(await step(w, w.nadya, run.id, 9, { payload: { note: "siap dibungkus" }, media: await media(w.nadya, run.id, "i") }));
  ok(await step(w, w.corner, run.id, 10, { payload: { mattressStyle: "PILLOWTOP", fabricSpec: "Knitting putih quilting", borderColor: "Abu-abu tua" } }));
  ok(await step(w, w.corner, run.id, 11, { payload: { checklist: { jahitan: true, list: true, resleting: true, kebersihan: true } }, media: await media(w.nadya, run.id, "i", "v") }));
  const fin = ok(await step(w, w.corner, run.id, 12, { payload: { confirm: true }, media: await media(w.nadya, run.id, "i") }));
  return { unit, run, planned, issueId, handoffId: fin.handoffId };
}
const balanceOf = async (materialId) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId }, _sum: { qty: true } }))._sum.qty || 0);

test("antrean retur: sisa bahan jadi baris PENDING di tahap 12, barang jadi DITOLAK (RETURN_PENDING) sampai Gudang menerima, lalu stok RETURN tertaut unit dan barang jadi bisa diterima", async () => {
  const w = await world();
  const { unit, run, handoffId } = await runToFinish(w, { usedLapisan: 1 });

  // Sisa = diserahkan (lapisan 2) − terpakai (1) = 1; fondasi habis terpakai -> tidak ada baris.
  const rows = await testPrisma.productionMaterialReturn.findMany({ where: { runId: run.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].materialId, w.lapisan.id); assert.equal(Number(rows[0].qty), 1); assert.equal(rows[0].status, "PENDING"); assert.equal(rows[0].unitId, unit.id);
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "production.material_return.requested", aggregateId: run.id } }), 1);
  const stockBefore = await balanceOf(w.lapisan.id);

  // Gudang melihat antrean retur; barang jadi unit itu ditandai menunggu retur.
  const q = ok(await w.nadya.api.get(`${V2}/warehouse/queue`));
  assert.equal(q.kpi.returns, 1); assert.equal(q.returns[0].unit.unitCode, unit.unitCode); assert.equal(q.returns[0].qty, 1);
  assert.equal(q.finishedGoods.find((f) => f.handoffId === handoffId).returnPending, 1);
  const ov = ok(await w.lead.api.get(`${V2}/units/${unit.id}/overview`));
  assert.equal(ov.materials.lines.find((l) => l.materialId === w.lapisan.id).returnStatus, "PENDING");

  // Barang jadi TIDAK bisa diterima selama retur belum diterima; tidak ada efek samping.
  const fg = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: handoffId } });
  const early = await w.nadya.api.post(`/api/inventory/unit-custody/${fg.id}/accept`, { locationId: w.fg.id, expectedRevision: fg.revision }, key("fg-early"));
  assert.equal(early.status, 409); assert.equal(early.body.code, "RETURN_PENDING");
  assert.equal((await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: handoffId } })).status, "OFFERED");
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).status, "ACTIVE");

  // Validasi penerimaan: peran, jumlah, catatan selisih, revisi basi.
  const r = q.returns[0];
  assert.equal((await w.corner.api.post(`${V2}/material-returns/${r.id}/receive`, { expectedRevision: r.revision }, key("rcv-role"))).status, 403);
  assert.equal((await w.nadya.api.post(`${V2}/material-returns/${r.id}/receive`, { expectedRevision: r.revision, qty: 5 }, key("rcv-over"))).body.code, "RETURN_QTY_EXCEEDS");
  assert.equal((await w.nadya.api.post(`${V2}/material-returns/${r.id}/receive`, { expectedRevision: r.revision, qty: 0.4 }, key("rcv-note"))).body.code, "RETURN_NOTE_REQUIRED");
  assert.equal((await w.nadya.api.post(`${V2}/material-returns/${r.id}/receive`, { expectedRevision: 99 }, key("rcv-stale"))).body.code, "RETURN_REVISION_CONFLICT");
  assert.equal(await balanceOf(w.lapisan.id), stockBefore, "penolakan tidak mengubah stok");

  const received = ok(await w.nadya.api.post(`${V2}/material-returns/${r.id}/receive`, { expectedRevision: r.revision }, key("rcv-ok")));
  assert.equal(received.status, "RECEIVED"); assert.equal(received.qty, 1);
  const move = await testPrisma.stockMovement.findFirstOrThrow({ where: { materialId: w.lapisan.id, type: "RETURN" } });
  assert.equal(move.unitId, unit.id); assert.equal(Number(move.qty), 1);
  assert.equal(await balanceOf(w.lapisan.id), stockBefore + 1);
  // Replay kunci sama = respons sama, stok tidak bertambah lagi; kunci baru = sudah diterima.
  const replay = ok(await w.nadya.api.post(`${V2}/material-returns/${r.id}/receive`, { expectedRevision: r.revision }, key("rcv-ok")));
  assert.equal(replay.replayed, true);
  assert.equal((await w.nadya.api.post(`${V2}/material-returns/${r.id}/receive`, { expectedRevision: r.revision + 1 }, key("rcv-again"))).body.code, "RETURN_ALREADY_RECEIVED");
  assert.equal(await balanceOf(w.lapisan.id), stockBefore + 1);
  assert.equal(await testPrisma.stockMovement.count({ where: { materialId: w.lapisan.id, type: "RETURN" } }), 1);

  // Setelah retur diterima: antrean kosong, barang jadi bisa diterima, run selesai.
  assert.equal(ok(await w.nadya.api.get(`${V2}/warehouse/queue`)).kpi.returns, 0);
  ok(await w.nadya.api.post(`/api/inventory/unit-custody/${fg.id}/accept`, { locationId: w.fg.id, expectedRevision: fg.revision }, key("fg-ok")));
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).status, "COMPLETED");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: unit.id } })).status, "READY_FOR_DELIVERY");
});

test("antrean retur: diterima kurang dari sisa wajib catatan; tanpa sisa tidak ada baris dan barang jadi langsung bisa diterima", async () => {
  const w = await world();
  const partial = await runToFinish(w, { usedLapisan: 1 });
  const row = await testPrisma.productionMaterialReturn.findFirstOrThrow({ where: { runId: partial.run.id } });
  const res = ok(await w.nadya.api.post(`${V2}/material-returns/${row.id}/receive`, { expectedRevision: row.revision, qty: 0.5, note: "Setengah terpotong, jadi waste" }, key("rcv-short")));
  assert.equal(res.qty, 0.5); assert.equal(res.requestedQty, 1);
  const saved = await testPrisma.productionMaterialReturn.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(saved.status, "RECEIVED"); assert.equal(Number(saved.receivedQty), 0.5); assert.equal(saved.note, "Setengah terpotong, jadi waste");

  const full = await runToFinish(w, { usedLapisan: 2 });
  assert.equal(await testPrisma.productionMaterialReturn.count({ where: { runId: full.run.id } }), 0, "habis terpakai -> tidak ada retur");
  const fg = await testPrisma.unitCustodyHandoff.findUniqueOrThrow({ where: { id: full.handoffId } });
  ok(await w.nadya.api.post(`/api/inventory/unit-custody/${fg.id}/accept`, { locationId: w.fg.id, expectedRevision: fg.revision }, key("fg-nr")));
});

const plan = async (w, runId, priority, station = "TABLE_1", date = DATE) => {
  const res = await w.lead.api.post(`${V2}/plans`, { runId, productionDate: date, stationCode: station, priority, workCenterId: w.wc, operatorId: w.nadyaOp.id }, key(`pl-${++seq}`));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
};
const mejaOrder = async (w, station = "TABLE_1", date = DATE) => {
  const board = ok(await w.lead.api.get(`${V2}/board?date=${date}`));
  return board.stations.find((s) => s.code === station).items.map((i) => ({ runId: i.runId, planId: i.plan.id, seq: i.plan.stationSequence, priority: i.plan.priority, revision: i.plan.revision }));
};
const reorder = (w, ids, k, station = "TABLE_1") => w.lead.api.post(`${V2}/stations/reorder`, { productionDate: DATE, stationCode: station, orderedPlanIds: ids }, key(k));

test("urutan manual per meja: bawaan = prioritas; reorder menang atas prioritas; basi/replay/izin; unit baru ditambahkan paling bawah", async () => {
  const w = await world();
  const [a, b, c, d] = [await acceptedUnit(w), await acceptedUnit(w), await acceptedUnit(w), await acceptedUnit(w)];
  const pa = await plan(w, a.run.id, 0); const pb = await plan(w, b.run.id, 2); const pc = await plan(w, c.run.id, 1);

  // Bawaan: prioritas tinggi dulu, belum ada nomor manual.
  let order = await mejaOrder(w);
  assert.deepEqual(order.map((o) => o.planId), [pb.planId, pc.planId, pa.planId]);
  assert.ok(order.every((o) => o.seq === null));

  // Reorder manual: A, B, C — nomor 1..3, prioritas TIDAK berubah.
  const r1 = await reorder(w, [pa.planId, pb.planId, pc.planId], "ro-1");
  assert.equal(r1.status, 200, JSON.stringify(r1.body)); assert.equal(r1.body.changedCount, 3);
  order = await mejaOrder(w);
  assert.deepEqual(order.map((o) => o.planId), [pa.planId, pb.planId, pc.planId]);
  assert.deepEqual(order.map((o) => o.seq), [1, 2, 3]);
  assert.deepEqual(order.map((o) => o.priority), [0, 2, 1]);

  // Replay = respons sama tanpa data ganda; payload beda dengan kunci sama = 409.
  const replay = await reorder(w, [pa.planId, pb.planId, pc.planId], "ro-1");
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.equal(await testPrisma.domainOutbox.count({ where: { eventType: "production.station.reordered" } }), 1);
  assert.equal((await reorder(w, [pc.planId, pb.planId, pa.planId], "ro-1")).status, 409);

  // Menaikkan PRIORITAS A tidak melompatkannya: urutan manual tetap.
  const cur = order[0];
  const bump = await w.lead.api.post(`${V2}/plans/${pa.planId}/schedule`, { expectedRevision: cur.revision, productionDate: DATE, stationCode: "TABLE_1", priority: 2, workCenterId: w.wc, operatorId: w.nadyaOp.id }, key("bump"));
  assert.equal(bump.status, 200, JSON.stringify(bump.body));
  order = await mejaOrder(w);
  assert.deepEqual(order.map((o) => o.planId), [pa.planId, pb.planId, pc.planId], "prioritas hanya default ordering");
  assert.deepEqual(order.map((o) => o.seq), [1, 2, 3]);

  // Isi meja berubah sejak dimuat -> 409 STATION_ORDER_STALE, tanpa tulisan.
  const stale = await reorder(w, [pc.planId, pa.planId], "ro-stale");
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "STATION_ORDER_STALE");
  assert.deepEqual((await mejaOrder(w)).map((o) => o.seq), [1, 2, 3]);
  assert.equal((await reorder(w, [pa.planId, pb.planId, pb.planId], "ro-dup")).status, 400);

  // Izin: PIC Corner/worker tidak boleh mengatur urutan.
  assert.equal((await w.corner.api.post(`${V2}/stations/reorder`, { productionDate: DATE, stationCode: "TABLE_1", orderedPlanIds: [pa.planId, pb.planId, pc.planId] }, key("ro-role"))).status, 403);

  // Unit keluar (unschedule B) lalu unit baru masuk: ditambahkan PALING BAWAH (bukan melompat lewat prioritas), nomor lama tetap.
  const bRow = order.find((o) => o.planId === pb.planId);
  ok(await w.lead.api.post(`${V2}/plans/${pb.planId}/schedule`, { expectedRevision: bRow.revision, productionDate: null, stationCode: null, priority: 2, workCenterId: w.wc, operatorId: w.nadyaOp.id }, key("unsched")));
  const pd = await plan(w, d.run.id, 2);
  order = await mejaOrder(w);
  assert.deepEqual(order.map((o) => o.planId), [pa.planId, pc.planId, pd.planId], "unit prioritas tertinggi tetap di bawah urutan manual yang ada");
  assert.deepEqual(order.map((o) => o.seq), [1, 3, 4]);
  const r2 = await reorder(w, [pd.planId, pa.planId, pc.planId], "ro-2");
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.deepEqual((await mejaOrder(w)).map((o) => [o.planId, o.seq]), [[pd.planId, 1], [pa.planId, 2], [pc.planId, 3]]);

  // Antrean PIC (worker lane) memakai urutan yang sama.
  const lane = ok(await w.nadya.api.get(`${V2}/worker/table`));
  assert.deepEqual(lane.items.map((i) => i.runId), [d.run.id, a.run.id, c.run.id, b.run.id], "terjadwal menurut urutan meja; yang belum dijadwalkan (B) di akhir");
});

test("urutan manual: writer OFF -> ditolak fail-closed tanpa tulisan", async () => {
  const w = await world();
  const a = await acceptedUnit(w); const b = await acceptedUnit(w);
  const pa = await plan(w, a.run.id, 0); const pb = await plan(w, b.run.id, 1);
  await setFlag(V2_FLAGS.PRODUCTION_WRITER, null);
  const res = await reorder(w, [pa.planId, pb.planId], "ro-off");
  assert.equal(res.status, 503); assert.equal(res.body.code, "PLANNING_WRITER_OFF");
  assert.equal(await testPrisma.productionRunPlan.count({ where: { stationSequence: { not: null } } }), 0);
});
