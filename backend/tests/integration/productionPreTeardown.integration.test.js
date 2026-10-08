// Fase 2 Produksi LAYANAN — QC sebelum bongkar, catatan lapisan awal, dokumentasi bongkar, uji fondasi awal. HTTP + DB sungguhan.
// Satu sumber data = Catatan Komponen (versi, koreksi beralasan, idempotensi, konflik); gerbang tahap di engine 12-tahap yang sama (tanpa stage engine paralel); adaptasi/NEW/SEWA tidak berubah.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import * as PT from "./setup/preTeardown.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { setAdaptationDefault, setQcGateDefault } from "../../src/services/productionSettingsService.js";

let server; let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (v) => ({ "Idempotency-Key": `pt2-${v}-${++seq}-kunci-0001` });
const V2 = "/api/production-v2";
const CN = `${V2}/component-notes`;
const DATE = "2026-10-20";

async function setFlag(flagKey, unitIds) {
  const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "pre-teardown test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
async function addCohort(...unitIds) {
  const row = await testPrisma.v2FeatureFlag.findUnique({ where: { key: V2_FLAGS.PRODUCTION_WRITER } });
  const merged = [...new Set([...(row?.enabled ? row.config?.unitIds ?? [] : []), ...unitIds])];
  for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(k, merged);
}
async function world() {
  const mk = (roles) => createTestUser({ roles });
  const [lead, nadya, qc, doc, reader, admin, driver] = await Promise.all([mk(["PRODUCTION_LEAD"]), mk(["WAREHOUSE", "PRODUCTION_WORKER"]), mk(["QC_LEAD"]), mk(["PRODUCTION_DOCUMENTER"]), mk(["SALES"]), mk(["ADMIN"]), mk(["DRIVER"])]);
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-PT-${++seq}`, name: "Workshop Utama" } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-PT-${++seq}`, name: "Gudang PT" } });
  const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-PT-${++seq}` } });
  const nadyaOp = await testPrisma.productionOperator.create({ data: { userId: nadya.user.id, primaryWorkCenterId: workCenter.id } });
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  return { lead: c(lead), nadya: c(nadya), qc: c(qc), doc: c(doc), reader: c(reader), admin: c(admin), driver: c(driver), rcv, wc: workCenter.id, nadyaOp };
}
async function mkOrder({ category = "LAYANAN", productLine = "KASUR" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Bu Layanan ${++seq}` } });
  const order = await testPrisma.order.create({
    data: { customerId: customer.id, orderNumber: `PT2-${++seq}`, value: 2_000_000, category, status: "PROCESSING", productLine, beratBadan: 82, complaintCategory: ["SAKIT_PINGGANG"], notes: "Minta tekstur firm" },
  });
  const unit = await testPrisma.unit.create({ data: { unitCode: `PT2-${seq}-U1`, orderId: order.id, seq: 1, status: "RECEIVED", merk: "King Koil", ukuran: "180x200" } });
  return { order, unit };
}
// Unit LAYANAN lewat pickup nyata (driver) + custody INBOUND diterima Gudang; Run lahir PENDING-free (RECEIVED) lalu dijadwalkan lewat runId.
async function layananUnit(w, station = "TABLE_1", { gate = "QC_GATE_V2" } = {}) {
  if (gate) await setQcGateDefault(testPrisma, { enabled: true, version: gate, actorId: null }); // bawaan Admin eksplisit; tanpa setting = kebijakan lama (NULL)
  const customer = await testPrisma.customer.create({ data: { name: `Bu Layanan ${++seq}` } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `PT2-${++seq}`, value: 2_000_000, category: "LAYANAN", status: "PROCESSING", productLine: "KASUR", beratBadan: 82, complaintCategory: ["SAKIT_PINGGANG"], notes: "Minta tekstur firm" } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `PT2-${seq}-U1`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP", merk: "King Koil", ukuran: "180x200" } });
  const route = await testPrisma.route.create({ data: { code: `PT2-RTE-${++seq}`, date: new Date("2026-10-19T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, routeId: route.id, driverId: w.driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-10-19T00:00:00.000Z") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
  await addCohort(unit.id);
  const tag = `acc${++seq}`;
  await w.driver.api.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}s`));
  await w.driver.api.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${tag}a`));
  const done = await w.driver.api.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga", note: "ok", location: null }, key(`${tag}c`));
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const handoff = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: unit.id, direction: "INBOUND" } });
  const acc = await w.nadya.api.post(`/api/inventory/unit-custody/${handoff.id}/accept`, { locationId: w.rcv.id, expectedRevision: 1 }, key(`${tag}x`));
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
  const plan = await w.lead.api.post(`${V2}/plans`, { runId: run.id, productionDate: DATE, stationCode: station, priority: 0, workCenterId: w.wc, operatorId: w.nadyaOp.id }, key("plan"));
  assert.equal(plan.status, 201, JSON.stringify(plan.body));
  return { order, unit, run };
}
async function scheduleUnit(w, unit, station = "TABLE_1") {
  await addCohort(unit.id);
  const res = await w.lead.api.post(`${V2}/plans`, { unitId: unit.id, productionDate: DATE, stationCode: station, priority: 0, workCenterId: w.wc, operatorId: w.nadyaOp.id }, key("sch"));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } });
}
let fileSeq = 0;
async function media(who, runId, ...kinds) {
  const fd = new FormData(); fd.append("runId", runId);
  for (const k of kinds) { const v = k === "v"; fd.append("files", new Blob([Buffer.from(`${v ? "vid" : "img"}-${++fileSeq}-${Math.random()}`)], { type: v ? "video/mp4" : "image/jpeg" }), v ? "a.mp4" : "a.jpg"); }
  const res = await fetch(`${server.baseUrl}${V2}/evidence/upload`, { method: "POST", headers: { Authorization: `Bearer ${who.token}` }, body: fd });
  const body = await res.json(); assert.equal(res.status, 201, JSON.stringify(body)); return body.items.map((i) => i.url);
}
const card = async (w, runId) => { const r = await w.lead.api.get(`${V2}/runs/${runId}/card`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
async function step(w, who, runId, n, { payload = {}, media: m = [] } = {}) {
  const expectedRevision = (await card(w, runId)).revision;
  return who.api.post(`${V2}/runs/${runId}/steps/${n}`, { expectedRevision, workCenterId: w.wc, payload, media: m }, key(`st-${n}`));
}
const ok = (res) => { assert.equal(res.status, 200, JSON.stringify(res.body)); return res.body; };
const notes = async (who, unitId) => { const r = await who.api.get(`${CN}/units/${unitId}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const sideEffectCounts = async (unitId) => ({
  stock: await testPrisma.stockMovement.count({ where: { unitId } }), issues: await testPrisma.materialIssue.count({}), reservations: await testPrisma.materialReservation.count({}),
  returns: await testPrisma.productionMaterialReturn.count({}), bom: await testPrisma.plannedBOMLine.count({}),
});

test("gerbang QC sebelum bongkar: tahap 2 menunggu PIC QC; Meja tidak bisa menulis uji; PIC QC melihat konteks Sales dan antrean; berat penguji tidak pernah otomatis", async () => {
  const w = await world();
  const { unit, run } = await layananUnit(w);
  ok(await step(w, w.nadya, run.id, 1, { payload: { conditionConfirmed: true }, media: await media(w.nadya, run.id, "i") }));
  const c = await card(w, run.id);
  assert.deepEqual([c.next.action, c.next.wait, c.next.actor, c.next.stepNo], ["WAIT", "QC_BEFORE_PENDING", "QC", 2]);
  const blocked = await step(w, w.nadya, run.id, 2, { payload: { feelNote: "Tengah terasa amblas" }, media: await media(w.nadya, run.id, "v") });
  assert.equal(blocked.status, 409); assert.equal(blocked.body.code, "STEP_WAITING_QC_BEFORE_PENDING");

  // otorisasi: penugasan Meja TIDAK cukup untuk menulis pengujian; dokumentasi/pembaca juga tidak
  const body = { expectedVersion: 0, data: PT.WHOLE, media: await PT.uploadVideo(server, w.nadya, unit.id) };
  const asMeja = await w.nadya.api.post(`${CN}/units/${unit.id}/sections/WHOLE_TEST_BEFORE`, body, key("meja"));
  assert.equal(asMeja.status, 403); assert.equal(asMeja.body.code, "COMPONENT_QC_ONLY");
  assert.equal((await w.doc.api.post(`${CN}/units/${unit.id}/sections/WHOLE_TEST_BEFORE`, body, key("doc"))).status, 403);
  assert.equal((await w.reader.api.post(`${CN}/units/${unit.id}/sections/WHOLE_TEST_BEFORE`, body, key("rd"))).status, 403);
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: unit.id } }), 0, "tidak ada baris tertulis oleh yang tak berizin");

  // PIC QC: antrean + konteks Sales (keluhan, request, berat customer) — rujukan saja
  const queue = ok(await w.qc.api.get(`${CN}/qc-queue`));
  assert.deepEqual(queue.items.map((i) => [i.unitCode, i.section]), [[unit.unitCode, "WHOLE_TEST_BEFORE"]]);
  assert.equal((await w.nadya.api.get(`${CN}/qc-queue`)).status, 403, "antrean hanya untuk PIC QC");
  const n0 = await notes(w.qc, unit.id);
  assert.equal(n0.canWriteQc, true); assert.equal((await notes(w.nadya, unit.id)).canWriteQc, false);
  assert.deepEqual([n0.salesContext.complaintLabels, n0.salesContext.request, n0.salesContext.customerWeightKg], [["Sakit pinggang"], "Minta tekstur firm", 82]);
  assert.equal(n0.sections.WHOLE_TEST_BEFORE, null, "belum dicatat = null (bukan 0)"); assert.equal(n0.measurements.recorded.whole, false);

  // validasi server: berat penguji tidak terisi otomatis dari berat customer (82) bila dikosongkan
  const post = (data, media = body.media, expectedVersion = 0, extra = {}) => w.qc.api.post(`${CN}/units/${unit.id}/sections/WHOLE_TEST_BEFORE`, { expectedVersion, data, media, ...extra }, key("qc"));
  const noWeight = await post({ ...PT.WHOLE, testerWeightKg: undefined }); assert.equal(noWeight.status, 422); assert.equal(noWeight.body.code, "COMPONENT_TESTER_WEIGHT_REQUIRED");
  const noMedia = await post(PT.WHOLE, []); assert.equal(noMedia.status, 422); assert.equal(noMedia.body.code, "COMPONENT_MEDIA_REQUIRED");
  assert.equal((await post({ ...PT.WHOLE, qcInFrame: false })).body.code, "COMPONENT_QC_IN_FRAME_REQUIRED");
  assert.equal((await post({ ...PT.WHOLE, complaintMatch: "ENTAH" })).body.code, "COMPONENT_COMPLAINT_MATCH_REQUIRED");
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: unit.id } }), 0);

  const before = await sideEffectCounts(unit.id);
  const saved = await post(PT.WHOLE); assert.equal(saved.status, 201, JSON.stringify(saved.body)); assert.equal(saved.body.version, 1);
  assert.deepEqual(await sideEffectCounts(unit.id), before, "tidak menyentuh stok/BOM/reservasi/issue/retur");
  const n1 = await notes(w.qc, unit.id);
  assert.deepEqual([n1.measurements.whole.testerWeightKg, n1.measurements.whole.wholeDropCm, n1.measurements.whole.complaintMatchLabel], [75, 4, "Sebagian sesuai"]);
  assert.equal(n1.sections.WHOLE_TEST_BEFORE.media[0].kind, "video"); assert.equal(n1.sections.WHOLE_TEST_BEFORE.actor.id, w.qc.user.id);
  // video dapat dibuka lewat tautan bertanda tangan setelah reload
  const play = await fetch(`${server.baseUrl}${n1.sections.WHOLE_TEST_BEFORE.media[0].previewUrl}`); assert.equal(play.status, 200); assert.equal(play.headers.get("content-type"), "video/mp4");
  assert.equal((await w.qc.api.get(`${CN}/qc-queue`)).body.items.length, 0, "keluar dari antrean setelah tercatat");

  // PIC Meja kini cukup 'Lanjutkan' (bukti hanya menaut versi catatan QC; tidak menyalin angka)
  const c2 = await card(w, run.id);
  assert.deepEqual([c2.next.action, c2.next.continueOnly, c2.next.qcRecorded], ["COMPLETE", true, true]);
  ok(await step(w, w.nadya, run.id, 2, {}));
  const ev = await testPrisma.productionStepEvidence.findFirstOrThrow({ where: { runId: run.id, stepNo: 2, stepCode: "S02_FEEL_TEST" } });
  assert.deepEqual(ev.payload, { qcRef: { section: "WHOLE_TEST_BEFORE", version: 1 } });
});

test("versi, koreksi beralasan, idempotensi, konflik, tanpa perubahan = tidak ada versi baru; riwayat tidak menimpa", async () => {
  const w = await world();
  const { unit, run } = await layananUnit(w);
  ok(await step(w, w.nadya, run.id, 1, { payload: { conditionConfirmed: true }, media: await media(w.nadya, run.id, "i") }));
  const media1 = await PT.uploadVideo(server, w.qc, unit.id);
  const url = (kk) => `${CN}/units/${unit.id}/sections/WHOLE_TEST_BEFORE`;
  const k1 = key("v1");
  const v1 = await w.qc.api.post(url(), { expectedVersion: 0, data: PT.WHOLE, media: media1 }, k1); assert.equal(v1.status, 201);
  const replay = await w.qc.api.post(url(), { expectedVersion: 0, data: PT.WHOLE, media: media1 }, k1);
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true); assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: unit.id } }), 1, "replay tidak menggandakan");
  assert.equal((await w.qc.api.post(url(), { expectedVersion: 0, data: { ...PT.WHOLE, wholeDropCm: 9 }, media: media1 }, k1)).status, 409, "kunci sama + isi beda ditolak");
  // konflik: klien basi (expectedVersion 0 padahal sudah v1) -> 409, data tidak tertimpa
  const stale = await w.qc.api.post(url(), { expectedVersion: 0, data: { ...PT.WHOLE, wholeDropCm: 9 }, media: media1 }, key("stale"));
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "COMPONENT_VERSION_CONFLICT");
  // koreksi wajib alasan
  const noReason = await w.qc.api.post(url(), { expectedVersion: 1, data: { ...PT.WHOLE, wholeDropCm: 5 }, media: media1 }, key("nr"));
  assert.equal(noReason.status, 400); assert.equal(noReason.body.code, "COMPONENT_REASON_REQUIRED");
  // tanpa perubahan bermakna -> tidak membuat versi baru
  const same = await w.qc.api.post(url(), { expectedVersion: 1, data: PT.WHOLE, media: media1, reason: "cek ulang angka" }, key("same"));
  assert.equal(same.status, 200); assert.equal(same.body.unchanged, true); assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: unit.id } }), 1);
  const fix = await w.qc.api.post(url(), { expectedVersion: 1, data: { ...PT.WHOLE, wholeDropCm: 5, testerWeightKg: 78 }, media: media1, reason: "Angka penurunan salah catat" }, key("fix"));
  assert.equal(fix.status, 201); assert.equal(fix.body.version, 2); assert.equal(fix.body.corrected, true);
  const n = await notes(w.qc, unit.id);
  assert.deepEqual([n.measurements.whole.version, n.measurements.whole.wholeDropCm, n.measurements.whole.testerWeightKg], [2, 5, 78]);
  const hist = n.history.filter((h) => h.section === "WHOLE_TEST_BEFORE");
  assert.deepEqual(hist.map((h) => [h.version, h.superseded, h.reason]), [[1, true, null], [2, false, "Angka penurunan salah catat"]]);
  assert.equal(hist[0].data.wholeDropCm, 4, "versi lama TIDAK ditimpa"); assert.ok(hist[1].actor?.name && hist[1].at, "actor + waktu tercatat");
  // koreksi setelah tahap dilanjutkan tidak memutar balik evidence lama (menaut versi saat itu)
  ok(await step(w, w.nadya, run.id, 2, {}));
  assert.equal((await testPrisma.productionStepEvidence.findFirstOrThrow({ where: { runId: run.id, stepNo: 2, stepCode: "S02_FEEL_TEST" } })).payload.qcRef.version, 2);
});

test("lapisan awal & dokumentasi bongkar: atas ke bawah, per layer foto/video, total dari yang diketahui (belum lengkap bila ada kosong), tahap 3 menuntut lapisan + media", async () => {
  const w = await world();
  const { unit, run } = await layananUnit(w);
  ok(await step(w, w.nadya, run.id, 1, { payload: { conditionConfirmed: true }, media: await media(w.nadya, run.id, "i") }));
  await PT.qcWhole(server, w.qc, run.id);
  ok(await step(w, w.nadya, run.id, 2, {}));
  const c = await card(w, run.id);
  assert.deepEqual([c.next.action, c.next.stepNo, c.next.gated, c.next.layersRequired], ["COMPLETE", 3, true, true]);
  const unmet = await step(w, w.nadya, run.id, 3, { payload: {}, media: await media(w.nadya, run.id, "i") });
  assert.equal(unmet.status, 409); assert.equal(unmet.body.code, "STEP_LAYERS_REQUIRED");

  const layers = { layers: [
    { material: { kind: "MANUAL", text: "Memory foam" }, thicknessCm: 6, condition: "AUS", note: "kuning" },
    { material: { kind: "MANUAL", text: "Soft foam" }, thicknessCm: 4, condition: "KEMPES", note: null },
  ], note: "Ditemukan dua busa" };
  const vids = await PT.uploadVideo(server, w.nadya, unit.id); const vid2 = await PT.uploadVideo(server, w.nadya, unit.id);
  const body = { expectedVersion: 0, data: layers, media: [{ ...vids[0], layerOrder: 1 }, { ...vid2[0], layerOrder: 2 }, { url: (await media(w.nadya, run.id, "i"))[0] }] };
  assert.equal((await w.nadya.api.post(`${CN}/units/${unit.id}/sections/LAYERS_BEFORE`, { ...body, media: [{ ...vids[0], layerOrder: 3 }] }, key("l-bad"))).status, 422, "tautan ke lapisan yang tidak ada ditolak");
  const saved = await w.nadya.api.post(`${CN}/units/${unit.id}/sections/LAYERS_BEFORE`, body, key("l")); assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const n = await notes(w.nadya, unit.id);
  assert.deepEqual(n.sections.LAYERS_BEFORE.data.layers.map((l) => l.material.text), ["Memory foam", "Soft foam"], "urutan atas ke bawah terjaga");
  assert.deepEqual([n.sections.LAYERS_BEFORE.summary.totalThicknessCm, n.sections.LAYERS_BEFORE.summary.totalComplete], [10, true]); assert.match(n.measurements.layers.label, /Total tinggi lapisan 10 cm \(2 lapisan\)/);
  assert.deepEqual(n.sections.LAYERS_BEFORE.media.map((m) => [m.kind, m.layerOrder]), [["video", 1], ["video", 2], ["image", null]]);
  assert.equal((await fetch(`${server.baseUrl}${n.sections.LAYERS_BEFORE.media[1].previewUrl}`)).status, 200, "video lapisan dapat dibuka setelah reload");

  // koreksi: satu lapisan tanpa ketebalan -> total "belum lengkap" (bukan 0)
  const partial = { layers: [layers.layers[0], { ...layers.layers[1], thicknessCm: null }] };
  const fix = await w.nadya.api.post(`${CN}/units/${unit.id}/sections/LAYERS_BEFORE`, { expectedVersion: 1, data: partial, media: body.media, reason: "Ketebalan soft foam belum terukur" }, key("l2")); assert.equal(fix.status, 201);
  const n2 = await notes(w.nadya, unit.id);
  assert.deepEqual([n2.measurements.layers.totalThicknessCm, n2.measurements.layers.totalComplete, n2.measurements.layers.unknownThicknessCount], [6, false, 1]); assert.match(n2.measurements.layers.label, /belum lengkap/);

  // tahap 3: dokumentasi bongkar (media wajib) + tanpa centang material lama
  const noMedia = await step(w, w.nadya, run.id, 3, { payload: {}, media: [] }); assert.equal(noMedia.status, 400);
  ok(await step(w, w.nadya, run.id, 3, { payload: { note: "Isi kasur terlihat" }, media: await media(w.nadya, run.id, "i", "v") }));
  const ev = await testPrisma.productionStepEvidence.findFirstOrThrow({ where: { runId: run.id, stepNo: 3 } });
  assert.deepEqual(ev.payload.layersRef, { section: "LAYERS_BEFORE", version: 2, layersUnknown: false }); assert.equal(ev.media.length, 2);
  // "lapisan tidak diketahui" juga dihitung (eksplisit), total tetap Belum dicatat
  const w2 = await world(); const { unit: u2, run: r2 } = await layananUnit(w2, "TABLE_2");
  ok(await step(w2, w2.nadya, r2.id, 1, { payload: { conditionConfirmed: true }, media: await media(w2.nadya, r2.id, "i") })); await PT.qcWhole(server, w2.qc, r2.id); ok(await step(w2, w2.nadya, r2.id, 2, {}));
  assert.equal((await w2.nadya.api.post(`${CN}/units/${u2.id}/sections/LAYERS_BEFORE`, { expectedVersion: 0, data: { layersUnknown: true, layers: [] }, media: [] }, key("lu"))).status, 201);
  const nu = await notes(w2.nadya, u2.id); assert.equal(nu.measurements.layers.totalThicknessCm, null); assert.match(nu.measurements.layers.label, /belum dicatat/);
});

test("uji fondasi awal: penurunan dihitung server (25→15 = 10 cm), dibebani > tanpa beban ditolak, terpisah dari uji kasur utuh (tidak dijumlahkan, tanpa kategori), tahap 4 hanya melanjutkan", async () => {
  const w = await world();
  const { unit, run } = await layananUnit(w);
  ok(await step(w, w.nadya, run.id, 1, { payload: { conditionConfirmed: true }, media: await media(w.nadya, run.id, "i") }));
  await PT.qcWhole(server, w.qc, run.id); ok(await step(w, w.nadya, run.id, 2, {}));
  await PT.layersBefore(server, w.nadya, run.id); ok(await step(w, w.nadya, run.id, 3, { payload: {}, media: await media(w.nadya, run.id, "i") }));
  const c = await card(w, run.id);
  assert.deepEqual([c.next.action, c.next.wait, c.next.actor, c.next.stepNo], ["WAIT", "FOUNDATION_TEST_PENDING", "QC", 4]);
  assert.equal((await step(w, w.nadya, run.id, 4, { payload: { heightBeforeCm: 25, heightCompressedCm: 15, testerWeightKg: 75 }, media: await media(w.nadya, run.id, "v") })).status, 409, "angka dari Meja tidak menggantikan uji PIC QC");
  assert.equal((await w.qc.api.get(`${CN}/qc-queue`)).body.items[0].section, "FOUNDATION_TEST_BEFORE");

  const url = `${CN}/units/${unit.id}/sections/FOUNDATION_TEST_BEFORE`;
  const vid = await PT.uploadVideo(server, w.qc, unit.id);
  const taller = await w.qc.api.post(url, { expectedVersion: 0, data: { ...PT.FOUNDATION, loadedHeightCm: 26 }, media: vid }, key("ft-bad")); assert.equal(taller.body.code, "COMPONENT_LOADED_TALLER");
  assert.equal((await w.qc.api.post(url, { expectedVersion: 0, data: { ...PT.FOUNDATION, testerWeightKg: undefined }, media: vid }, key("ft-w"))).body.code, "COMPONENT_TESTER_WEIGHT_REQUIRED");
  assert.equal((await w.qc.api.post(url, { expectedVersion: 0, data: PT.FOUNDATION, media: [] }, key("ft-m"))).body.code, "COMPONENT_MEDIA_REQUIRED");
  assert.equal((await w.nadya.api.post(url, { expectedVersion: 0, data: PT.FOUNDATION, media: vid }, key("ft-meja"))).status, 403);
  const saved = await w.qc.api.post(url, { expectedVersion: 0, data: { ...PT.FOUNDATION, dropCm: 99, category: "AMBLAS" }, media: vid }, key("ft")); assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const stored = (await testPrisma.unitComponentEntry.findFirstOrThrow({ where: { unitId: unit.id, section: "FOUNDATION_TEST_BEFORE" } })).payload;
  assert.equal(stored.dropCm, 10, "dihitung server, bukan dari klien"); assert.equal("category" in stored, false);
  const n = await notes(w.qc, unit.id); const m = n.measurements;
  assert.deepEqual([m.whole.wholeDropCm, m.foundation.dropCm, m.foundation.unloadedHeightCm, m.foundation.loadedHeightCm, m.foundation.testerWeightKg], [4, 10, 25, 15, 75]);
  assert.equal(m.combinedEstimate, null); assert.match(m.separationNote, /TIDAK dijumlahkan/); assert.doesNotMatch(JSON.stringify(m), /"(total(Drop|Penurunan)|sum|category|kategori|amblas)"s*:/i, "tidak ada kunci total/kategori otomatis");
  // tahap 4: Lanjutkan (menaut versi uji fondasi) — PIC Meja tidak menimpa angka
  ok(await step(w, w.nadya, run.id, 4, {}));
  const ev = await testPrisma.productionStepEvidence.findFirstOrThrow({ where: { runId: run.id, stepNo: 4 } });
  assert.deepEqual(ev.payload.qcRef, { section: "FOUNDATION_TEST_BEFORE", version: 1 }); assert.equal("dropCm" in ev.payload, false, "angka tidak disalin ke bukti (satu sumber)");
  assert.deepEqual([(await card(w, run.id)).next.stepNo], [5], "lanjut ke Diagnosa — engine 12 tahap sama");
});

test("laporan: pengujian awal tampil terpisah di laporan & pesan Sales (tanpa 'amblas' otomatis, tanpa penjumlahan); belum dicatat disebut jelas", async () => {
  const w = await world();
  const { run } = await layananUnit(w);
  ok(await step(w, w.nadya, run.id, 1, { payload: { conditionConfirmed: true }, media: await media(w.nadya, run.id, "i") }));
  await PT.qcWhole(server, w.qc, run.id);
  const rep = await w.lead.api.get(`${V2}/runs/${run.id}/report`);
  if (rep.status === 200) {
    assert.equal(rep.body.components.measurements.whole.wholeDropCm, 4); assert.equal(rep.body.components.measurements.foundation, null);
    assert.match(rep.body.message, /PENGUJIAN AWAL/); assert.match(rep.body.message, /Uji Fondasi\s+: Belum dicatat/); assert.doesNotMatch(rep.body.message, /amblas \d/i);
  } else assert.fail(`laporan tidak terbaca: ${rep.status} ${JSON.stringify(rep.body)}`);
});

test("adaptasi, SEWA, dan jalur NEW/custom TIDAK terkena gerbang; tahap boleh dilewati dengan alasan (tanpa hasil uji/bukti palsu)", async () => {
  const w = await world();
  // SEWA: perilaku lama (tahap 2 langsung bisa dikirim dengan bukti PIC)
  const sewa = await mkOrder({ category: "SEWA" }); const sr = await scheduleUnit(w, sewa.unit, "TABLE_2");
  ok(await step(w, w.nadya, sr.id, 1, { payload: { conditionConfirmed: true }, media: await media(w.nadya, sr.id, "i") }));
  assert.deepEqual([(await card(w, sr.id)).next.action, (await card(w, sr.id)).next.stepNo], ["COMPLETE", 2]);
  ok(await step(w, w.nadya, sr.id, 2, { payload: { feelNote: "Tengah terasa amblas" }, media: await media(w.nadya, sr.id, "v") }));
  // NEW/custom (BARU): tidak ada tahap bongkar; kartu langsung tahap 6 tanpa gerbang QC
  const baru = await mkOrder({ category: "BARU" }); const br = await scheduleUnit(w, baru.unit, "TABLE_3");
  const bc = await card(w, br.id); assert.equal(bc.track, "BUILD"); assert.notEqual(bc.next.wait, "QC_BEFORE_PENDING"); assert.equal(bc.next.stepNo, 6);
  // Adaptasi AKTIF: LAYANAN boleh dilewati dengan alasan; tidak ada uji/bukti palsu
  await setAdaptationDefault(testPrisma, { enabled: true, actorId: null });
  const { unit: layUnit, run: lr } = await layananUnit(w, "TABLE_4"); const lay = { unit: layUnit };
  const lc = await card(w, lr.id); assert.ok(lc.adaptation, "mode adaptasi aktif"); assert.equal(lc.next.stepNo, 1);
  const skip = await w.nadya.api.post(`${V2}/runs/${lr.id}/steps/1/skip`, { expectedRevision: lc.revision, workCenterId: w.wc, note: "Unit sudah dibongkar sebelumnya" }, key("skip"));
  assert.equal(skip.status, 200, JSON.stringify(skip.body));
  const skipped = await testPrisma.productionStepEvidence.findMany({ where: { runId: lr.id, stepNo: { in: [1, 2] } } });
  assert.ok(skipped.length >= 1 && skipped.every((e) => e.payload.outcome === "SKIPPED" && e.media.length === 0), "dilewati = SKIPPED tanpa media/hasil");
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: lay.unit.id } }), 0, "tidak ada catatan uji palsu");
  assert.notEqual((await card(w, lr.id)).next.wait, "QC_BEFORE_PENDING");
});

test("kebijakan gerbang QC dipin per Run: Run baru terpin QC_GATE_V2; Run lama (NULL) TIDAK otomatis terkena; penerapan eksplisit, beralasan, bergerbang izin/revisi, idempoten, tercatat", async () => {
  const w = await world();
  // Run baru -> terpin
  const { unit, run } = await layananUnit(w);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).qcGatePolicyVersion, "QC_GATE_V2", "Run baru dipin saat dibuat");
  assert.equal((await card(w, run.id)).qcGatePolicy, "QC_GATE_V2");

  // Simulasi Run yang sudah berjalan sebelum rilis (kolom NULL): perilaku LAMA, tidak ada gerbang
  await testPrisma.productionRun.update({ where: { id: run.id }, data: { qcGatePolicyVersion: null } });
  ok(await step(w, w.nadya, run.id, 1, { payload: { conditionConfirmed: true }, media: await media(w.nadya, run.id, "i") }));
  const old = await card(w, run.id);
  assert.equal(old.qcGatePolicy, null);
  assert.deepEqual([old.next.action, old.next.stepNo, old.next.wait ?? null], ["COMPLETE", 2, null], "Run lama: tahap 2 tetap tahap kerja Meja, bukan menunggu QC");
  assert.equal((await w.qc.api.get(`${CN}/qc-queue`)).body.items.length, 0, "Run lama tidak masuk antrean PIC QC");
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).revision, old.revision, "tidak ada perubahan otomatis");

  // Penerapan eksplisit: izin, alasan, revisi
  const url = `${V2}/runs/${run.id}/qc-gate`;
  assert.equal((await w.nadya.api.post(url, { expectedRevision: old.revision, reason: "uji" }, key("g1"))).status, 403, "penugasan Meja tidak boleh menerapkan kebijakan");
  assert.equal((await w.qc.api.post(url, { expectedRevision: old.revision, reason: "uji" }, key("g1b"))).status, 403, "PIC QC tidak boleh menerapkan kebijakan run");
  const noReason = await w.lead.api.post(url, { expectedRevision: old.revision }, key("g2")); assert.equal(noReason.status, 400); assert.equal(noReason.body.code, "QC_GATE_REASON_REQUIRED");
  const stale = await w.lead.api.post(url, { expectedRevision: old.revision - 1, reason: "uji" }, key("g3")); assert.equal(stale.status, 409);
  assert.equal((await testPrisma.productionRun.findUniqueOrThrow({ where: { id: run.id } })).qcGatePolicyVersion, null, "ditolak = tidak berubah");

  const gk = key("g4");
  const applied = ok(await w.lead.api.post(url, { expectedRevision: old.revision, reason: "Run baru mulai hari ini, ikut gerbang QC" }, gk));
  assert.deepEqual([applied.policy, applied.changed, applied.revision], ["QC_GATE_V2", true, old.revision + 1]);
  const replay = ok(await w.lead.api.post(url, { expectedRevision: old.revision, reason: "Run baru mulai hari ini, ikut gerbang QC" }, gk));
  assert.equal(replay.revision, applied.revision, "replay idempoten (kunci sama)");
  const logs = await testPrisma.activityEvent.findMany({ where: { entityId: unit.id, eventType: "PRODUCTION_QC_GATE_APPLIED" } });
  assert.equal(logs.length, 1, "tercatat tepat sekali");
  assert.equal(logs[0].actorId, w.lead.user.id); assert.equal(logs[0].metadata.reason, "Run baru mulai hari ini, ikut gerbang QC"); assert.equal(logs[0].metadata.previousPolicy, null);
  const again = ok(await w.lead.api.post(url, { expectedRevision: applied.revision, reason: "ulang" }, key("g5")));
  assert.equal(again.changed, false, "sudah terpin = tanpa perubahan"); assert.equal(await testPrisma.activityEvent.count({ where: { entityId: unit.id, eventType: "PRODUCTION_QC_GATE_APPLIED" } }), 1);

  // Setelah diterapkan, gerbang berlaku: tahap 2 menunggu PIC QC
  const gated = await card(w, run.id);
  assert.deepEqual([gated.qcGatePolicy, gated.next.action, gated.next.wait], ["QC_GATE_V2", "WAIT", "QC_BEFORE_PENDING"]);
  assert.equal((await w.qc.api.get(`${CN}/qc-queue`)).body.items.length, 1);

  // Tidak berlaku untuk adaptasi/BARU/SEWA
  const sewa = await mkOrder({ category: "SEWA" }); const sr = await scheduleUnit(w, sewa.unit, "TABLE_2");
  const sres = await w.lead.api.post(`${V2}/runs/${sr.id}/qc-gate`, { expectedRevision: (await card(w, sr.id)).revision, reason: "uji" }, key("g6"));
  assert.equal(sres.status, 409); assert.equal(sres.body.code, "QC_GATE_NOT_APPLICABLE");
});

test("bawaan gerbang QC: TANPA setting = kebijakan lama (NULL); Admin mengaktifkan V1/V2 (tercatat); dipin saat Run lahir; tidak retroaktif; Run lama tidak berubah; penerapan eksplisit bertrail", async () => {
  const w = await world();
  const adminU = await createTestUser({ roles: ["ADMIN"] }); const admin = { ...adminU, api: makeClient(server.baseUrl, adminU.token) };
  const getDefault = async () => (await admin.api.get(`${V2}/settings`)).body.qcGateDefault;
  const evCount = () => testPrisma.activityEvent.count({ where: { eventType: "PRODUCTION_SETTING_CHANGED", entityId: "qc_gate_default_policy" } });
  const pinned = async (runId) => (await testPrisma.productionRun.findUniqueOrThrow({ where: { id: runId } })).qcGatePolicyVersion;
  // 1) tanpa setting = kebijakan lama: Run baru NULL, tanpa gerbang
  assert.deepEqual(await getDefault(), { enabled: false, policy: null, versions: ["QC_GATE_V1", "QC_GATE_V2"] });
  const a = await layananUnit(w, "TABLE_1", { gate: null });
  assert.equal(await pinned(a.run.id), null, "tanpa setting eksplisit: Run baru = kebijakan lama (tanpa gerbang)"); assert.equal((await card(w, a.run.id)).qcGatePolicy, null);
  // 2) izin & validasi
  for (const [who, name] of [[w.lead, "lead"], [w.qc, "qc"], [w.nadya, "meja"]]) assert.equal((await who.api.put(`${V2}/settings/qc-gate-default`, { enabled: true })).status, 403, name);
  assert.equal((await admin.api.put(`${V2}/settings/qc-gate-default`, { enabled: "ya" })).status, 400);
  assert.equal((await admin.api.put(`${V2}/settings/qc-gate-default`, { enabled: true, version: "QC_GATE_V9" })).body.code, "QC_GATE_VERSION_INVALID");
  assert.equal(await evCount(), 0, "ditolak = tidak tercatat/berubah");
  // 3) Admin mengaktifkan V1: tercatat; Run lama (a) tidak berubah; Run baru dipin V1
  assert.deepEqual(ok(await admin.api.put(`${V2}/settings/qc-gate-default`, { enabled: true, version: "QC_GATE_V1" })), { enabled: true, policy: "QC_GATE_V1" });
  assert.deepEqual([(await getDefault()).enabled, (await getDefault()).policy], [true, "QC_GATE_V1"]);
  assert.equal(await pinned(a.run.id), null, "tidak retroaktif");
  const b = await layananUnit(w, "TABLE_2", { gate: null }); assert.equal(await pinned(b.run.id), "QC_GATE_V1");
  // 4) Admin menaikkan bawaan ke V2 (tanpa version = V2): Run berikutnya V2; b tetap V1
  ok(await admin.api.put(`${V2}/settings/qc-gate-default`, { enabled: true }));
  const c = await layananUnit(w, "TABLE_3", { gate: null }); assert.equal(await pinned(c.run.id), "QC_GATE_V2"); assert.equal(await pinned(b.run.id), "QC_GATE_V1");
  // 5) nonaktif eksplisit: Run baru kembali NULL; yang lama tidak berubah
  ok(await admin.api.put(`${V2}/settings/qc-gate-default`, { enabled: false })); assert.equal((await getDefault()).enabled, false);
  const d = await layananUnit(w, "TABLE_4", { gate: null }); assert.equal(await pinned(d.run.id), null); assert.equal(await pinned(c.run.id), "QC_GATE_V2");
  assert.equal(await evCount(), 3, "tiga perubahan bawaan tercatat (V1, V2, nonaktif)");
  // 6) penerapan ke Run lama (a) tetap eksplisit: beralasan, memeriksa revisi, idempoten, tercatat
  const url = `${V2}/runs/${a.run.id}/qc-gate`; const rev = (await card(w, a.run.id)).revision;
  assert.equal((await w.lead.api.post(url, { expectedRevision: rev }, key("g-noreason"))).body.code, "QC_GATE_REASON_REQUIRED");
  assert.equal((await w.lead.api.post(url, { expectedRevision: rev + 5, reason: "uji" }, key("g-stale"))).status, 409);
  const gk = key("g-ok"); const applied = ok(await w.lead.api.post(url, { expectedRevision: rev, reason: "Run ini harus melewati gerbang QC", version: "QC_GATE_V1" }, gk));
  assert.deepEqual([applied.policy, applied.changed], ["QC_GATE_V1", true]);
  assert.equal(ok(await w.lead.api.post(url, { expectedRevision: rev, reason: "Run ini harus melewati gerbang QC", version: "QC_GATE_V1" }, gk)).revision, applied.revision, "replay idempoten");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: a.unit.id, eventType: "PRODUCTION_QC_GATE_APPLIED" } }), 1);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Fase 3 LAYANAN — analisis & racikan: PLAN_RACIKAN (rencana) vs AFTER (aktual), total tinggi, atribut katalog, versi/koreksi/konflik/replay, izin, tanpa efek stok/BOM.
// ---------------------------------------------------------------------------------------------------------------------------------------------------
test("Fase 3: racikan rencana (fondasi + lapisan atas->bawah, ketebalan, total) dicatat PIC Meja/QC dengan aktor; rencana vs aktual dibedakan; katalog/manual/tidak diketahui; versi, koreksi, konflik, replay; tanpa stok/BOM", async () => {
  const w = await world();
  const { unit } = await layananUnit(w);
  const busa = await testPrisma.material.create({ data: { code: `FOAM-F3-${++seq}`, name: "Busa HR D44 5cm", unit: "PCS", category: "RAW_MATERIAL", vendor: "CV Busa Jaya", itemGroup: "HR FOAM", active: true } });
  const polos = await testPrisma.material.create({ data: { code: `PLN-F3-${++seq}`, name: "Bahan tanpa data", unit: "PCS", category: "RAW_MATERIAL", active: true } });
  const URL_ = `${CN}/units/${unit.id}/sections`;
  const post = (who, section, body, k) => who.api.post(`${URL_}/${section}`, body, key(k));
  const counts0 = await sideEffectCounts(unit.id);

  // Konteks analisis dibaca PIC Meja & PIC QC dari SATU endpoint: keluhan/request/berat customer (rujukan), komponen lama, QC awal, uji fondasi.
  await PT.qcWhole(server, w.qc, (await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: unit.id } })).id);
  const layers = await post(w.nadya, "LAYERS_BEFORE", { expectedVersion: 0, data: { layers: [
    { material: { kind: "MANUAL", text: "Busa lama kuning" }, thicknessCm: 6, condition: "AUS" }, { material: { kind: "UNKNOWN" }, thicknessCm: 4, condition: "KEMPES" }] } }, "lyr");
  assert.equal(layers.status, 201, JSON.stringify(layers.body));
  for (const who of [w.nadya, w.qc]) {
    const n = await notes(who, unit.id);
    assert.deepEqual([n.salesContext.complaintLabels, n.salesContext.request, n.salesContext.customerWeightKg], [["Sakit pinggang"], "Minta tekstur firm", 82], "keluhan/request/berat customer terbaca");
    assert.equal(n.sections.WHOLE_TEST_BEFORE.version, 1); assert.equal(n.sections.LAYERS_BEFORE.version, 1); assert.equal(n.sections.PLAN_RACIKAN, null, "belum dicatat = null");
  }

  // Rencana ditulis PIC Meja; katalog + manual + tidak diketahui; urutan atas -> bawah; KEEP mewarisi ketebalan catatan awal (dibaca, tidak disalin).
  const plan1 = { foundation: { action: "REPAIR", system: "BONNELL", material: { kind: "MANUAL", text: "Per cadangan" }, note: "Per tengah diganti sebagian" },
    layers: [
      { action: "REPLACE", material: { kind: "CATALOG", materialId: busa.id }, thicknessCm: 7, note: "Lapisan atas baru" },
      { action: "KEEP", fromOrder: 2 },
      { action: "REPLACE", material: { kind: "UNKNOWN" } },
    ], note: "Pegas tengah lemah" };
  const bad = await post(w.nadya, "PLAN_RACIKAN", { expectedVersion: 0, data: { layers: [], foundation: null } }, "empty"); assert.equal(bad.status, 422); assert.equal(bad.body.code, "COMPONENT_PLAN_EMPTY");
  const noMat = await post(w.nadya, "PLAN_RACIKAN", { expectedVersion: 0, data: { layers: [{ action: "REPLACE", thicknessCm: 3 }] } }, "nomat"); assert.equal(noMat.status, 422); assert.equal(noMat.body.code, "COMPONENT_MATERIAL_REQUIRED");
  assert.equal((await post(w.reader, "PLAN_RACIKAN", { expectedVersion: 0, data: plan1 }, "sales")).status, 403, "Sales tidak menulis racikan");
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: unit.id, section: "PLAN_RACIKAN" } }), 0);
  const saved = await post(w.nadya, "PLAN_RACIKAN", { expectedVersion: 0, data: plan1 }, "plan1"); assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const n1 = await notes(w.qc, unit.id);
  const e1 = n1.sections.PLAN_RACIKAN;
  assert.equal(e1.version, 1); assert.equal(e1.actor.id, w.nadya.user.id, "penentu racikan tercatat aktornya");
  assert.deepEqual(e1.data.layers.map((l) => l.action), ["REPLACE", "KEEP", "REPLACE"], "urutan atas -> bawah");
  assert.equal(e1.data.layers[0].material.supplier, "CV Busa Jaya"); assert.equal(e1.data.layers[0].material.itemGroup, "HR FOAM"); assert.equal(e1.data.layers[0].material.code, busa.code);
  assert.equal(e1.summary.totalThicknessCm, 11, "7 (baru) + 4 (KEEP dari catatan awal)"); assert.equal(e1.summary.totalComplete, false, "lapisan ke-3 tanpa ketebalan = belum lengkap");
  assert.match(e1.summary.label, /belum lengkap/);
  assert.deepEqual(n1.comparison.plan.layers.map((l) => [l.thicknessCm, l.thicknessSource]), [[7, "DICATAT"], [4, "DARI_CATATAN_AWAL"], [null, null]]);
  assert.equal(n1.comparison.planVsActual.available, false); assert.match(n1.comparison.planVsActual.reason, /aktual belum dicatat/i);

  // Bahan katalog tanpa data supplier/kelompok = tidak dikarang.
  const lone = await post(w.qc, "PLAN_RACIKAN", { expectedVersion: 1, reason: "Tambah bahan polos", data: { ...plan1, layers: [...plan1.layers.slice(0, 2), { action: "REPLACE", material: { kind: "CATALOG", materialId: polos.id }, thicknessCm: 2 }] } }, "plan2");
  assert.equal(lone.status, 201, JSON.stringify(lone.body));
  const n2 = await notes(w.qc, unit.id); const l3 = n2.sections.PLAN_RACIKAN.data.layers[2].material;
  assert.equal(n2.sections.PLAN_RACIKAN.version, 2); assert.equal(n2.sections.PLAN_RACIKAN.actor.id, w.qc.user.id); assert.equal(n2.sections.PLAN_RACIKAN.correctionReason, "Tambah bahan polos");
  assert.equal("supplier" in l3, false); assert.equal("itemGroup" in l3, false); assert.equal(n2.sections.PLAN_RACIKAN.summary.totalThicknessCm, 13); assert.equal(n2.sections.PLAN_RACIKAN.summary.totalComplete, true);

  // Koreksi wajib alasan; konflik versi; replay idempoten; tanpa perubahan = tanpa versi baru.
  const noReason = await post(w.nadya, "PLAN_RACIKAN", { expectedVersion: 2, data: plan1 }, "nr"); assert.equal(noReason.status, 400); assert.equal(noReason.body.code, "COMPONENT_REASON_REQUIRED");
  const stale = await post(w.nadya, "PLAN_RACIKAN", { expectedVersion: 1, reason: "basi", data: plan1 }, "stale"); assert.equal(stale.status, 409); assert.equal(stale.body.code, "COMPONENT_VERSION_CONFLICT");
  const same = await post(w.nadya, "PLAN_RACIKAN", { expectedVersion: 2, reason: "sama saja", data: n2.sections.PLAN_RACIKAN.data }, "same");
  assert.equal(same.status, 200); assert.equal(same.body.unchanged, true); assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: unit.id, section: "PLAN_RACIKAN" } }), 2);
  const rk = key("replay"); const body = { expectedVersion: 2, reason: "Ganti lapisan bawah", data: { ...plan1, layers: [plan1.layers[0], plan1.layers[1], { action: "REPLACE", material: { kind: "MANUAL", text: "Busa bekas" }, thicknessCm: 3 }] } };
  const r1 = await w.nadya.api.post(`${URL_}/PLAN_RACIKAN`, body, rk); const r2 = await w.nadya.api.post(`${URL_}/PLAN_RACIKAN`, body, rk);
  assert.deepEqual([r1.status, r2.status, r2.body.version, r2.body.replayed], [201, 200, 3, true], JSON.stringify(r2.body)); assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: unit.id, section: "PLAN_RACIKAN" } }), 3, "replay tidak menggandakan");

  // Entri lama (tanpa atribut snapshot baru) disimpan ulang tanpa perubahan = TIDAK memicu versi baru hanya karena snapshot diperkaya.
  const lyrCat = await post(w.nadya, "FOUNDATION_BEFORE", { expectedVersion: 0, data: { system: "BONNELL", material: { kind: "CATALOG", materialId: busa.id }, condition: "AUS" } }, "fb");
  assert.equal(lyrCat.status, 201, JSON.stringify(lyrCat.body));
  const row = await testPrisma.unitComponentEntry.findFirstOrThrow({ where: { unitId: unit.id, section: "FOUNDATION_BEFORE" } });
  const legacy = { ...row.payload, material: { kind: "CATALOG", materialId: row.payload.material.materialId, code: row.payload.material.code, name: row.payload.material.name, unit: row.payload.material.unit } };
  await testPrisma.$executeRaw`UPDATE unit_component_entries_v2 SET payload = ${JSON.stringify(legacy)}::jsonb WHERE id = ${row.id}::uuid`;
  const resave = await post(w.nadya, "FOUNDATION_BEFORE", { expectedVersion: 1, reason: "cek ulang", data: { system: "BONNELL", material: { kind: "CATALOG", materialId: busa.id }, condition: "AUS" } }, "fb2");
  assert.equal(resave.body.unchanged, true, "entri lama tanpa supplier tidak membuat versi baru");

  // Hasil AKTUAL (AFTER) terpisah dari rencana; perbandingan rencana vs aktual + total tinggi; selisih ditampilkan, tidak dikarang.
  const after = await post(w.nadya, "AFTER", { expectedVersion: 0, data: { deviationNote: "Tebal lapisan 1 menjadi 6 cm; fondasi diganti penuh", foundation: { action: "REPLACE", system: "BONNELL", note: "ganti penuh" }, layers: [
    { action: "REPLACE", material: { kind: "CATALOG", materialId: busa.id }, thicknessCm: 6 }, { action: "KEEP", fromOrder: 2 }, { action: "REPLACE", material: { kind: "MANUAL", text: "Busa bekas" }, thicknessCm: 3 }] } }, "after");
  assert.equal(after.status, 201, JSON.stringify(after.body));
  const n3 = await notes(w.qc, unit.id); const pva = n3.comparison.planVsActual;
  assert.equal(pva.available, true);
  assert.deepEqual(pva.layers.map((l) => [l.status, l.diffs.join("+")]), [["BERBEDA", "KETEBALAN"], ["SAMA", ""], ["SAMA", ""]]);
  assert.equal(pva.foundation.status, "BERBEDA"); assert.deepEqual(pva.foundation.diffs, ["TINDAKAN", "BAHAN"]);
  assert.deepEqual([pva.total.planCm, pva.total.actualCm, pva.total.differenceCm], [14, 13, -1]);
  assert.equal(n3.sections.PLAN_RACIKAN.version, 3, "rencana tetap; hasil aktual bukan menimpa rencana"); assert.equal(n3.sections.AFTER.version, 1);
  // laporan membaca keduanya dari sumber yang sama
  assert.ok(n3.comparison.plan && n3.comparison.actual);

  // Katalog untuk formulir: atribut yang tersedia saja.
  const cat = ok(await w.nadya.api.get(`${CN}/materials?q=${encodeURIComponent(busa.code)}`)); const hit = cat.items.find((m) => m.materialId === busa.id);
  assert.deepEqual([hit.code, hit.name, hit.unit, hit.supplier, hit.itemGroup], [busa.code, busa.name, "PCS", "CV Busa Jaya", "HR FOAM"]);
  const hit2 = ok(await w.nadya.api.get(`${CN}/materials?q=${encodeURIComponent(polos.code)}`)).items.find((m) => m.materialId === polos.id); assert.deepEqual([hit2.supplier, hit2.itemGroup], [null, null]);
  assert.deepEqual([hit.density, hit.thicknessCm, hit2.density, hit2.thicknessCm], [null, null, null, null], "densitas/ketebalan katalog kosong = null apa adanya, tidak dikarang");

  // Rencana & aktual TIDAK menyentuh stok, BOM, reservasi, issue, retur.
  assert.deepEqual(await sideEffectCounts(unit.id), counts0, "tanpa efek stok/BOM/reservasi/issue/retur");
});

test("Fase 3: NEW/custom dan adaptasi tidak berubah — Run baru pin gerbang QC; jalur BARU tidak menunggu PIC Bahan/QC; racikan rencana hanyalah informasi", async () => {
  const w = await world();
  const baru = await mkOrder({ category: "BARU" }); const br = await scheduleUnit(w, baru.unit, "TABLE_3");
  const bc = await card(w, br.id); assert.equal(bc.track, "BUILD"); assert.equal(bc.materialPic, null); assert.notEqual(bc.next.wait, "USAGE_NOT_RECORDED");
  const res = await w.nadya.api.post(`${CN}/units/${baru.unit.id}/sections/PLAN_RACIKAN`, { expectedVersion: 0, data: { layers: [{ action: "REPLACE", material: { kind: "MANUAL", text: "Latex 5cm" }, thicknessCm: 5 }] } }, key("baru"));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await card(w, br.id)).revision, bc.revision, "catatan informasi tidak mengubah revisi Run");
});
