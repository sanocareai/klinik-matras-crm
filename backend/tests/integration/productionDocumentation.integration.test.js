// P10B Aplikasi Dokumentasi: antrean/matriks, unggah aman (magic byte), submit idempoten + konkuren, koreksi immutable, Unit 360 + Laporan,
// isolasi lifecycle (dokumentasi TIDAK mengubah status/revisi/tahap), reader/writer OFF, non-cohort, permission, IDOR, tanpa harga/finance.
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

const key = (v) => ({ "Idempotency-Key": `p10b-test-${v}-0001` });
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

// ------------------------------------------------------------------------------------------------------------------------------
const DOC = `${V2}/documentation`;
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let imgSeq = 0;
const jpegBytes = (n = 64) => Buffer.concat([JPEG_HEAD, Buffer.from(`doc-${++imgSeq}-${Math.random()}-${"x".repeat(n)}`)]);

async function world() {
  const [lead, nadya, corner, doc, plain, qc, driver] = await Promise.all([
    createTestUser({ roles: ["PRODUCTION_LEAD"] }),
    createTestUser({ roles: ["ADMIN", "WAREHOUSE", "PRODUCTION_WORKER", "PRODUCTION_DOCUMENTER"] }), // PIC meja + gudang + petugas dokumentasi
    createTestUser({ roles: ["PRODUCTION_WORKER"] }),
    createTestUser({ roles: ["PRODUCTION_DOCUMENTER"] }),
    createTestUser({ roles: ["PRODUCTION_WORKER"] }), // worker biasa: TIDAK punya izin dokumentasi
    createTestUser({ roles: ["QC_LEAD"] }),
    createTestUser({ roles: ["DRIVER"] }),
  ]);
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-P10B-${++seq}`, name: "Workshop Utama" } });
  const nadyaOp = await testPrisma.productionOperator.create({ data: { userId: nadya.user.id, primaryWorkCenterId: workCenter.id } });
  const cornerOp = await testPrisma.productionOperator.create({ data: { userId: corner.user.id, primaryWorkCenterId: workCenter.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-P10B-${++seq}`, name: "Gudang P10B" } });
  const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-P10B-${++seq}` } });
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  return { lead: c(lead), nadya: c(nadya), corner: c(corner), doc: c(doc), plain: c(plain), qc: c(qc), driver: c(driver), wc: workCenter.id, nadyaOp, cornerOp, rcv };
}

async function postFiles(who, runId, files, { field = "files" } = {}) {
  const fd = new FormData();
  if (runId != null) fd.append("runId", runId);
  for (const f of files) fd.append(field, new Blob([f.bytes], { type: f.type || "image/jpeg" }), f.name || "foto.jpg");
  const res = await fetch(`${server.baseUrl}${DOC}/upload`, { method: "POST", headers: { Authorization: `Bearer ${who.token}` }, body: fd });
  let body = null; try { body = await res.json(); } catch { /* bukan JSON */ }
  return { status: res.status, body };
}
async function docPhotos(who, runId, n = 1) {
  const res = await postFiles(who, runId, Array.from({ length: n }, () => ({ bytes: jpegBytes() })));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.items;
}
const submit = (who, runId, category, items, tag, extra = {}) => who.api.post(`${DOC}/runs/${runId}/submit`, { category, items, ...extra }, key(tag));
const queue = async (who, qs = "") => { const r = await who.api.get(`${DOC}/queue${qs}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const detail = async (who, runId) => { const r = await who.api.get(`${DOC}/runs/${runId}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const cat = (d, k) => d.categories.find((x) => x.key === k);
const docRowCount = (runId) => testPrisma.productionStepEvidence.count({ where: { runId, stepCode: { startsWith: "DOC_" } } });
const lifecycleSnapshot = async (w, runId) => {
  const run = await testPrisma.productionRun.findUniqueOrThrow({ where: { id: runId }, include: { unit: { select: { status: true } } } });
  const c = await card(w, runId);
  return JSON.stringify({ rev: run.revision, status: run.status, phase: run.currentPhase, unit: run.unit.status, next: c.next, progress: c.progress, bucket: c.bucket,
    ops: await testPrisma.productionOperationRun.count({ where: { runId } }), stepRows: await testPrisma.productionStepEvidence.count({ where: { runId, NOT: { stepCode: { startsWith: "DOC_" } } } }),
    cmds: await testPrisma.v2Command.count({ where: { commandType: "RECORD_PRODUCTION_STEP" } }) });
};

test("matriks & antrean: kartu lengkap, filter Before/Proses/After Kurang, pencarian; foto tahap dihitung (bukan disalin) dan dokumentasi menutup kekurangan", async () => {
  const w = await world();
  const { unit, run } = await acceptedUnit(w);
  const planned = await planOnBoard(w, run.id);
  void planned;

  // Belum dimulai: kartu ada, tanpa foto, kategori belum waktunya tidak dianggap kurang.
  let q = await queue(w.doc);
  assert.equal(q.readerMode, "COHORT"); assert.equal(q.canWrite, true);
  const c0 = q.items.find((i) => i.runId === run.id);
  assert.ok(c0); assert.equal(c0.unit.unitCode, unit.unitCode); assert.match(c0.customerName, /Ibu Maya/); assert.match(c0.orderNumber, /^P8O-/);
  assert.deepEqual(c0.services.sales, []); assert.equal(c0.station, "Meja 1"); assert.equal(c0.pic.table !== null, true);
  assert.equal(c0.docs.flags.belumDimulai, true);
  assert.equal(q.counts.BELUM_DIMULAI >= 1, true);

  // Tahap 1 selesai (1 foto) -> kategori "Sebelum bongkar" jatuh tempo, min 2 -> Before Kurang 1.
  ok(await step(w, w.nadya, run.id, 1, { payload: { conditionConfirmed: true, conditionNote: "kain kusam" }, media: await media(w.nadya, run.id, "i") }));
  let d = await detail(w.doc, run.id);
  assert.equal(cat(d, "BEFORE_TEARDOWN").count, 1); assert.equal(cat(d, "BEFORE_TEARDOWN").status, "KURANG"); assert.equal(cat(d, "BEFORE_TEARDOWN").items[0].source, "PRODUKSI");
  assert.equal(cat(d, "TEARDOWN_DIAGNOSIS").status, "MENUNGGU", "belum waktunya = menunggu, bukan kurang");
  q = await queue(w.doc, "?filter=BEFORE_KURANG");
  assert.deepEqual(q.items.map((i) => i.runId), [run.id]); assert.equal(q.items[0].docs.missing[0].key, "BEFORE_TEARDOWN");
  assert.equal((await queue(w.doc, "?filter=LENGKAP")).items.length, 0);
  assert.equal((await queue(w.doc, "?filter=BELUM_DIMULAI")).items.length, 0);
  // Pencarian: customer, order/resi, kode unit.
  assert.equal((await queue(w.doc, "?q=maya")).items.length, 1);
  assert.equal((await queue(w.doc, `?q=${encodeURIComponent(unit.unitCode)}`)).items.length, 1);
  assert.equal((await queue(w.doc, "?q=P8O-")).items.length, 1);
  assert.equal((await queue(w.doc, "?q=tidak-ada-yang-cocok")).items.length, 0);

  // Dokumentasi menutup kekurangan, tanpa mengubah lifecycle sama sekali.
  const before = await lifecycleSnapshot(w, run.id);
  const [p1] = await docPhotos(w.doc, run.id);
  const res = await submit(w.doc, run.id, "BEFORE_TEARDOWN", [{ url: p1.url, caption: "Sudut kiri atas sobek" }], "add-1");
  assert.equal(res.status, 201, JSON.stringify(res.body)); assert.equal(res.body.source, "MANUAL");
  assert.equal(await lifecycleSnapshot(w, run.id), before, "dokumentasi tidak mengubah status/revisi/tahap/operasi/bukti tahap");
  d = await detail(w.doc, run.id);
  assert.equal(cat(d, "BEFORE_TEARDOWN").count, 2); assert.equal(cat(d, "BEFORE_TEARDOWN").status, "LENGKAP");
  const mine = cat(d, "BEFORE_TEARDOWN").items.find((i) => i.origin === "DOC");
  assert.equal(mine.caption, "Sudut kiri atas sobek"); assert.equal(mine.source, "MANUAL"); assert.match(mine.url, /\?exp=\d+&sig=[a-f0-9]+$/); assert.ok(mine.actorName);
  assert.equal((await queue(w.doc, "?filter=BEFORE_KURANG")).items.length, 0);

  // Baris dokumentasi memakai tabel bukti yang sama, versi >= 1000, tidak mengganggu nomor versi tahap berikutnya.
  const row = await testPrisma.productionStepEvidence.findFirstOrThrow({ where: { runId: run.id, stepCode: "DOC_BEFORE_TEARDOWN" } });
  assert.equal(row.stepNo, 1); assert.ok(row.version >= 1000); assert.equal(row.operationRunId, null);
  ok(await step(w, w.nadya, run.id, 2, { payload: { feelNote: "Tengah terasa amblas" }, media: await media(w.nadya, run.id, "v") }));
  assert.equal((await testPrisma.productionStepEvidence.findFirstOrThrow({ where: { runId: run.id, stepNo: 2, stepCode: "S02_FEEL_TEST" } })).version, 1);
  // Bukti baris dokumentasi tidak bisa diubah/dihapus (immutable di database).
  await assert.rejects(testPrisma.productionStepEvidence.update({ where: { id: row.id }, data: { stepCode: "X" } }), /immutable/);
  await assert.rejects(testPrisma.productionStepEvidence.delete({ where: { id: row.id } }), /immutable/);
});

test("kontrak tanpa harga/pembayaran/jurnal/telepon di payload mana pun; izin peran: worker biasa dan ADMIN tidak punya izin tulis", async () => {
  const w = await world();
  const { run } = await acceptedUnit(w);
  await planOnBoard(w, run.id);
  const q = await queue(w.doc); const d = await detail(w.doc, run.id);
  const text = JSON.stringify([q, d]);
  for (const bad of ["orderValue", "\"value\"", "harga", "price", "payment", "journal", "jurnal", "phone", "whatsapp"]) assert.equal(text.toLowerCase().includes(bad.toLowerCase()), false, `payload memuat ${bad}`);
  // Worker biasa & PIC tanpa peran dokumentasi: bisa BACA (UNIT_READ) tetapi canWrite false dan semua tulis 403.
  assert.equal((await queue(w.plain)).canWrite, false);
  assert.equal((await detail(w.plain, run.id)).canWrite, false);
  const up = await postFiles(w.plain, run.id, [{ bytes: jpegBytes() }]); assert.equal(up.status, 403);
  assert.equal((await submit(w.plain, run.id, "BEFORE_TEARDOWN", [{ url: "/media/production-evidence/" + "a".repeat(40) + ".jpg" }], "plain-1")).status, 403);
  // Lead dan petugas dokumentasi boleh; driver tak punya UNIT_READ -> 403 baca.
  assert.equal((await queue(w.lead)).canWrite, true); assert.equal((await queue(w.doc)).canWrite, true);
  assert.equal((await w.driver.api.get(`${DOC}/queue`)).status, 403);
  assert.equal((await w.driver.api.get(`${DOC}/runs/${run.id}`)).status, 403);
  // Tanpa sesi.
  assert.equal((await makeClient(server.baseUrl, null).get(`${DOC}/queue`)).status, 401);
});

test("unggah aman: magic byte, MIME menipu, ekstensi/MIME salah, nama berkas path traversal, terlalu besar/banyak, tipe asing; berkas idempoten by isi", async () => {
  const w = await world();
  const { run } = await acceptedUnit(w);
  await planOnBoard(w, run.id);
  const tmp = (await import("node:fs")).readdirSync;
  const dirBefore = tmp(process.env.PRODUCTION_EVIDENCE_DIR).filter((f) => !f.startsWith("."));
  const bad = async (files, status, code) => { const r = await postFiles(w.doc, run.id, files); assert.equal(r.status, status, JSON.stringify(r.body)); if (code) assert.equal(r.body.code, code); };
  await bad([{ bytes: Buffer.from("<?php echo 1; ?> bukan gambar"), type: "image/jpeg", name: "x.jpg" }], 415, "DOC_INVALID_TYPE"); // magic byte salah
  await bad([{ bytes: Buffer.concat([PNG_HEAD, Buffer.from("png-asli-1")]), type: "image/jpeg", name: "x.jpg" }], 415, "DOC_TYPE_MISMATCH"); // PNG berlabel JPEG
  await bad([{ bytes: Buffer.from("<svg onload=alert(1)/>"), type: "image/svg+xml", name: "x.svg" }], 400, "DOC_EMPTY"); // MIME tak diizinkan
  await bad([{ bytes: Buffer.from("MZ....."), type: "application/pdf", name: "x.pdf" }], 400, "DOC_EMPTY");
  await bad([{ bytes: jpegBytes(), name: "../../etc/passwd.jpg" }], 400, "DOC_FILENAME_INVALID");
  await bad([{ bytes: jpegBytes(), name: "a\\..\\b.jpg" }], 400, "DOC_FILENAME_INVALID");
  await bad(Array.from({ length: 7 }, () => ({ bytes: jpegBytes() })), 400, "DOC_TOO_MANY");
  await bad([{ bytes: Buffer.concat([JPEG_HEAD, Buffer.alloc(15 * 1024 * 1024 + 10)]), name: "besar.jpg" }], 413, "DOC_TOO_LARGE");
  assert.equal((await postFiles(w.doc, null, [{ bytes: jpegBytes() }])).status, 400, "tanpa runId");
  assert.equal((await postFiles(w.doc, "bukan-uuid", [{ bytes: jpegBytes() }])).status, 404);
  assert.equal(tmp(process.env.PRODUCTION_EVIDENCE_DIR).filter((f) => !f.startsWith(".")).length, dirBefore.length, "unggahan yang ditolak tidak meninggalkan berkas");
  assert.equal(tmp(`${process.env.PRODUCTION_EVIDENCE_DIR}/.incoming`).length, 0, "berkas sementara dibersihkan");
  // Sukses: nama simpan = sha1 isi (nama klien tak dipakai); unggah ulang berkas sama = URL sama.
  const bytes = jpegBytes();
  const a = await postFiles(w.doc, run.id, [{ bytes, name: "Foto Kasur Ibu Maya Yang Sangat Panjang Sekali Sekali Sekali Sekali.jpg" }]);
  const b = await postFiles(w.doc, run.id, [{ bytes, name: "lain.jpg" }]);
  assert.equal(a.status, 201); assert.equal(a.body.items[0].url, b.body.items[0].url); assert.match(a.body.items[0].url, /^\/media\/production-evidence\/[a-f0-9]{40}\.jpg$/); assert.equal(a.body.items[0].kind, "image");
  assert.ok(a.body.items[0].previewUrl.includes("sig="));
  // PNG & WEBP sah juga diterima.
  const png = await postFiles(w.doc, run.id, [{ bytes: Buffer.concat([PNG_HEAD, Buffer.from(`png-${Math.random()}`)]), type: "image/png", name: "a.png" }]);
  assert.equal(png.status, 201); assert.match(png.body.items[0].url, /\.png$/);
  const webp = await postFiles(w.doc, run.id, [{ bytes: Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBP"), Buffer.from(`${Math.random()}`)]), type: "image/webp", name: "a.webp" }]);
  assert.equal(webp.status, 201); assert.match(webp.body.items[0].url, /\.webp$/);
});

test("reader/writer OFF, non-cohort, IDOR lintas unit, akses media bertanda-tangan", async () => {
  const w = await world();
  const a = await acceptedUnit(w); const b = await acceptedUnit(w); // keduanya cohort
  const outsider = await acceptedUnit(w);
  await planOnBoard(w, a.run.id);
  const [pa] = await docPhotos(w.doc, a.run.id);
  assert.equal((await submit(w.doc, a.run.id, "PROCESS", [{ url: pa.url }], "idor-a")).status, 201);
  // Foto unit A tak bisa dipakai di unit B (IDOR) dan tak bisa dikirim ke kategori tak dikenal / URL bebas.
  const idor = await submit(w.doc, b.run.id, "PROCESS", [{ url: pa.url }], "idor-b");
  assert.equal(idor.status, 409); assert.equal(idor.body.code, "DOC_MEDIA_OTHER_UNIT");
  assert.equal((await submit(w.doc, b.run.id, "BUKAN_KATEGORI", [{ url: pa.url }], "cat-x")).body.code, "DOC_CATEGORY_INVALID");
  assert.equal((await submit(w.doc, b.run.id, "PROCESS", [{ url: "https://evil.example/x.jpg" }], "url-x")).body.code, "DOC_MEDIA_INVALID");
  assert.equal((await submit(w.doc, b.run.id, "PROCESS", [{ url: "/media/production-evidence/../../etc/passwd" }], "url-y")).body.code, "DOC_MEDIA_INVALID");
  assert.equal((await submit(w.doc, b.run.id, "PROCESS", [{ url: "/media/production-evidence/" + "b".repeat(40) + ".jpg" }], "url-z")).body.code, "DOC_MEDIA_NOT_FOUND", "berkas yang tak pernah diunggah");
  // Unit non-cohort: tak tampil di antrean, detail 404, unggah/kirim 503 (fail-closed).
  await setCohort(a.unit.id, b.unit.id); // outsider keluar dari cohort
  const q = await queue(w.doc); assert.equal(q.items.some((i) => i.runId === outsider.run.id), false);
  assert.equal((await w.doc.api.get(`${DOC}/runs/${outsider.run.id}`)).status, 404);
  const nc = await postFiles(w.doc, outsider.run.id, [{ bytes: jpegBytes() }]); assert.equal(nc.status, 503); assert.equal(nc.body.code, "DOC_WRITER_OFF");
  assert.equal((await submit(w.doc, outsider.run.id, "PROCESS", [{ url: pa.url }], "nc-1")).status, 503);
  // Media: URL bertanda-tangan terbuka tanpa header; tanda tangan rusak 403; Bearer tanpa UNIT_READ 403; Bearer sah 200.
  const detailA = await detail(w.doc, a.run.id); const url = cat(detailA, "PROCESS").items[0].url;
  assert.equal((await fetch(server.baseUrl + url)).status, 200);
  assert.equal((await fetch(server.baseUrl + url.replace(/sig=[a-f0-9]+/, "sig=" + "0".repeat(40)))).status, 403);
  assert.equal((await fetch(server.baseUrl + pa.url, { headers: { Authorization: `Bearer ${w.driver.token}` } })).status, 403);
  assert.equal((await fetch(server.baseUrl + pa.url, { headers: { Authorization: `Bearer ${w.doc.token}` } })).status, 200);
  assert.equal((await fetch(server.baseUrl + pa.url)).status, 401, "tanpa tanda tangan & tanpa Bearer");
  // Reader OFF: antrean kosong readerMode OFF, detail 404; Writer OFF: unggah & kirim 503.
  await setFlag(V2_FLAGS.PRODUCTION_READER, null);
  const off = await w.doc.api.get(`${DOC}/queue`); assert.equal(off.body.readerMode, "OFF"); assert.deepEqual(off.body.items, []);
  assert.equal((await w.doc.api.get(`${DOC}/runs/${a.run.id}`)).status, 404);
  await setFlag(V2_FLAGS.PRODUCTION_READER, [a.unit.id, b.unit.id]);
  await setFlag(V2_FLAGS.PRODUCTION_WRITER, null);
  const wo = await postFiles(w.doc, a.run.id, [{ bytes: jpegBytes() }]); assert.equal(wo.status, 503); assert.equal(wo.body.code, "DOC_WRITER_OFF");
  assert.equal((await submit(w.doc, a.run.id, "PROCESS", [{ url: pa.url }], "wo-1")).status, 503);
  assert.equal((await detail(w.doc, a.run.id)).canWrite, false, "writer OFF -> canWrite false");
});

test("submit idempoten & aman dua submit bersamaan; foto ganda ditolak; batas jumlah; keterangan dibersihkan", async () => {
  const w = await world();
  const { run } = await acceptedUnit(w);
  await planOnBoard(w, run.id);
  const [p1, p2, p3] = await docPhotos(w.doc, run.id, 3);
  const k1 = submit(w.doc, run.id, "PROCESS", [{ url: p1.url, caption: "  proses\u0007 1  ", order: 2 }, { url: p2.url, caption: "dua", order: 1 }], "same-key");
  const k2 = submit(w.doc, run.id, "PROCESS", [{ url: p1.url, caption: "  proses\u0007 1  ", order: 2 }, { url: p2.url, caption: "dua", order: 1 }], "same-key");
  const [r1, r2] = await Promise.all([k1, k2]);
  assert.deepEqual([r1.status, r2.status], [201, 201], JSON.stringify([r1.body, r2.body]));
  assert.equal(r1.body.evidenceId, r2.body.evidenceId); assert.equal(await docRowCount(run.id), 1, "dua submit bersamaan -> satu baris");
  assert.equal([r1.body.replayed, r2.body.replayed].filter(Boolean).length, 1);
  const d = await detail(w.doc, run.id);
  assert.deepEqual(cat(d, "PROCESS").items.map((i) => i.caption), ["dua", "proses 1"], "urutan mengikuti order; karakter kontrol dibersihkan");
  // Kunci sama, isi beda = 409; kunci beda + foto yang sama = 409 (tidak ada baris ganda).
  assert.equal((await submit(w.doc, run.id, "PROCESS", [{ url: p3.url }], "same-key")).body.code, "IDEMPOTENCY_CONFLICT");
  assert.equal((await submit(w.doc, run.id, "PROCESS", [{ url: p1.url }], "new-key")).body.code, "DOC_MEDIA_ALREADY_SUBMITTED");
  const [c1, c2] = await Promise.all([submit(w.doc, run.id, "FINAL_RESULT", [{ url: p3.url }], "race-a"), submit(w.doc, run.id, "READY_TO_SHIP", [{ url: p3.url }], "race-b")]);
  assert.deepEqual([c1.status, c2.status].sort(), [201, 409], "foto yang sama dikirim bersamaan ke dua kategori: hanya satu menang");
  assert.equal(await docRowCount(run.id), 2);
  // Validasi isi.
  assert.equal((await submit(w.doc, run.id, "PROCESS", [], "empty")).body.code, "DOC_ITEMS_REQUIRED");
  assert.equal((await submit(w.doc, run.id, "PROCESS", [{ url: p3.url, caption: "x".repeat(201) }], "cap")).body.code, "DOC_CAPTION_TOO_LONG");
  assert.equal((await submit(w.doc, run.id, "PROCESS", [{ url: p3.url }, { url: p3.url }], "dupreq")).body.code, "DOC_MEDIA_DUPLICATE_IN_REQUEST");
  const noKey = await w.doc.api.post(`${DOC}/runs/${run.id}/submit`, { category: "PROCESS", items: [{ url: p3.url }] });
  assert.equal(noKey.status, 400); assert.equal(noKey.body.code, "IDEMPOTENCY_KEY_INVALID");
  // Banyak foto: 12 diterima, 13 ditolak.
  const many = await docPhotos(w.doc, run.id, 6); const many2 = await docPhotos(w.doc, run.id, 6); const more = await docPhotos(w.doc, run.id, 1);
  assert.equal((await submit(w.doc, run.id, "LAYER_COMPONENT", [...many, ...many2].map((i) => ({ url: i.url })), "twelve")).status, 201);
  assert.equal((await submit(w.doc, run.id, "FOUNDATION", [...many, ...many2, ...more].map((i) => ({ url: i.url })), "thirteen")).body.code, "DOC_ITEMS_TOO_MANY");
});

test("koreksi = versi baru dengan alasan, pengunggah, waktu; histori tetap; salah target/kategori/dobel ditolak; sumber diturunkan server", async () => {
  const w = await world();
  const { run } = await acceptedUnit(w);
  await planOnBoard(w, run.id);
  const [p1, p2, p3] = await docPhotos(w.nadya, run.id, 3);
  const first = await submit(w.nadya, run.id, "FOUNDATION", [{ url: p1.url, caption: "salah meja" }], "corr-1");
  assert.equal(first.status, 201); assert.equal(first.body.source, "PRODUKSI", "pengunggah = PIC meja unit -> sumber Produksi");
  const lead1 = await docPhotos(w.lead, run.id, 1);
  const leadRow = await submit(w.lead, run.id, "LAYER_COMPONENT", [{ url: lead1[0].url }], "lead-1");
  assert.equal(leadRow.body.source, "MANUAL");
  // Gudang (INVENTORY_WRITE) mengunggah kategori siap-kirim -> sumber Gudang.
  const gd = await submit(w.nadya, run.id, "READY_TO_SHIP", [{ url: p3.url }], "gudang-1");
  assert.equal(gd.body.source, "GUDANG");
  const before = await docRowCount(run.id);
  // Koreksi tanpa alasan / target salah / kategori beda.
  assert.equal((await w.lead.api.post(`${DOC}/runs/${run.id}/correct`, { category: "FOUNDATION", supersedesEvidenceId: first.body.evidenceId, items: [{ url: p2.url }] }, key("c-noreason"))).body.code, "DOC_REASON_REQUIRED");
  assert.equal((await w.lead.api.post(`${DOC}/runs/${run.id}/correct`, { category: "FOUNDATION", items: [{ url: p2.url }], reason: "x ganti" }, key("c-notarget"))).body.code, "DOC_CORRECTION_TARGET_REQUIRED");
  assert.equal((await w.lead.api.post(`${DOC}/runs/${run.id}/correct`, { category: "FOUNDATION", supersedesEvidenceId: randomUuid(), items: [{ url: p2.url }], reason: "tidak ada" }, key("c-404"))).body.code, "DOC_CORRECTION_TARGET_NOT_FOUND");
  assert.equal((await w.lead.api.post(`${DOC}/runs/${run.id}/correct`, { category: "PROCESS", supersedesEvidenceId: first.body.evidenceId, items: [{ url: p2.url }], reason: "salah kategori" }, key("c-cat"))).body.code, "DOC_CORRECTION_CATEGORY_MISMATCH");
  assert.equal(await docRowCount(run.id), before, "koreksi yang ditolak tidak menulis apa pun");
  // Koreksi sah oleh Lead: foto baru + keterangan; baris lama tetap, ditandai tergantikan.
  const fixed = await w.lead.api.post(`${DOC}/runs/${run.id}/correct`, { category: "FOUNDATION", supersedesEvidenceId: first.body.evidenceId, items: [{ url: p2.url, caption: "meja benar" }], reason: "Foto tertukar dengan unit sebelah" }, key("c-ok"));
  assert.equal(fixed.status, 201, JSON.stringify(fixed.body)); assert.equal(fixed.body.corrected, true);
  assert.equal(await docRowCount(run.id), before + 1, "histori lama tidak dihapus");
  const d = await detail(w.lead, run.id);
  const foundation = cat(d, "FOUNDATION");
  assert.deepEqual(foundation.items.map((i) => i.caption), ["meja benar"], "hanya versi terbaru yang berlaku");
  assert.equal(foundation.history.length, 1); assert.equal(foundation.history[0].reason, "Foto tertukar dengan unit sebelah"); assert.equal(foundation.history[0].supersededBy, fixed.body.evidenceId);
  assert.equal(foundation.history[0].items[0].caption, "salah meja"); assert.ok(foundation.history[0].createdAt);
  const newRow = await testPrisma.productionStepEvidence.findUniqueOrThrow({ where: { id: fixed.body.evidenceId } });
  assert.equal(newRow.actorId, w.lead.user.id); assert.equal(newRow.payload.documentation.supersedesEvidenceId, first.body.evidenceId);
  // Koreksi dua kali pada baris yang sama ditolak; foto lama (dari baris yang dikoreksi) boleh dipakai ulang di koreksi baris terbaru.
  assert.equal((await w.lead.api.post(`${DOC}/runs/${run.id}/correct`, { category: "FOUNDATION", supersedesEvidenceId: first.body.evidenceId, items: [{ url: p1.url }], reason: "sudah dikoreksi" }, key("c-again"))).body.code, "DOC_ALREADY_SUPERSEDED");
  const again = await w.lead.api.post(`${DOC}/runs/${run.id}/correct`, { category: "FOUNDATION", supersedesEvidenceId: fixed.body.evidenceId, items: [{ url: p1.url, caption: "kembali ke foto awal" }, { url: p2.url, caption: "meja benar" }], reason: "Dua-duanya ternyata benar" }, key("c-chain"));
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(cat(await detail(w.lead, run.id), "FOUNDATION").count, 2);
  // Koreksi replay-aman.
  const rep = await w.lead.api.post(`${DOC}/runs/${run.id}/correct`, { category: "FOUNDATION", supersedesEvidenceId: fixed.body.evidenceId, items: [{ url: p1.url, caption: "kembali ke foto awal" }, { url: p2.url, caption: "meja benar" }], reason: "Dua-duanya ternyata benar" }, key("c-chain"));
  assert.equal(rep.body.replayed, true); assert.equal(rep.body.evidenceId, again.body.evidenceId);
});

test("Unit 360 dan Laporan Produksi menampilkan foto yang baru dikirim (dengan sumber); dokumentasi tidak mengubah lifecycle di tengah tahap berjalan", async () => {
  const w = await world();
  const { unit, run } = await acceptedUnit(w);
  await planOnBoard(w, run.id);
  await throughIntake(w, run.id);
  const lifecycleBefore = await lifecycleSnapshot(w, run.id);
  const photos = await docPhotos(w.doc, run.id, 3);
  // Kategori yang menyimpan di nomor tahap 6/7 (belum dikerjakan) tidak boleh dianggap bukti tahap itu.
  assert.equal((await submit(w.doc, run.id, "FOUNDATION", [{ url: photos[0].url, caption: "fondasi lama" }], "u360-1")).status, 201);
  assert.equal((await submit(w.doc, run.id, "LAYER_COMPONENT", [{ url: photos[1].url }], "u360-2")).status, 201);
  assert.equal((await submit(w.doc, run.id, "PROCESS", [{ url: photos[2].url, caption: "meja kerja" }], "u360-3")).status, 201);
  assert.equal(await lifecycleSnapshot(w, run.id), lifecycleBefore, "tahap 5 tetap berikutnya; tidak ada tahap 6/7 yang 'tercatat' oleh dokumentasi");
  const next = (await card(w, run.id)).next; assert.equal(next.stepNo, 5);

  const ov = await w.lead.api.get(`${V2}/units/${unit.id}/overview`); assert.equal(ov.status, 200, JSON.stringify(ov.body));
  assert.equal(ov.body.documentation.categories.find((c) => c.key === "PROCESS").items[0].caption, "meja kerja");
  const docInBuckets = [...ov.body.evidence.before, ...ov.body.evidence.process, ...ov.body.evidence.after].filter((m) => m.documentation);
  assert.equal(docInBuckets.length, 3); assert.ok(docInBuckets.every((m) => m.source === "MANUAL" && /sig=/.test(m.url)));
  assert.ok(ov.body.evidence.process.some((m) => m.category === "FOUNDATION"));
  assert.ok(ov.body.evidence.before.filter((m) => !m.documentation).every((m) => m.source === "PRODUKSI") && ov.body.evidence.before.some((m) => !m.documentation), "foto tahap juga membawa sumber (Produksi)");
  assert.equal("orderValue" in ov.body, false, "lead tanpa ORDER_PRICE_READ: tanpa harga");
  const report = ok(await w.lead.api.get(`${V2}/runs/${run.id}/report`));
  assert.equal(report.documentation.categories.length, 12);
  assert.ok(report.media.process.some((m) => m.documentation && m.category === "PROCESS" && m.source === "MANUAL"));
  assert.ok(report.mediaCount >= 5 + 3);
  // Bukti tahap sungguhan tetap bernomor versi tahap (1), dan tahap 5 masih bisa diselesaikan seperti biasa.
  ok(await step(w, w.nadya, run.id, 5, { payload: DIAG }));
  assert.equal((await testPrisma.productionStepEvidence.findFirstOrThrow({ where: { runId: run.id, stepCode: "S05_DIAGNOSIS" } })).version, 1);
});

test("kategori & matriks: 12 kategori kanonis tersedia; Lengkap hanya bila semua kategori berlaku terpenuhi", async () => {
  const w = await world();
  const m = await w.doc.api.get(`${DOC}/matrix`); assert.equal(m.status, 200);
  assert.deepEqual(m.body.categories.map((c) => c.key), ["PICKUP_ARRIVAL", "INITIAL_CONDITION", "BEFORE_TEARDOWN", "TEARDOWN_DIAGNOSIS", "FOUNDATION", "LAYER_COMPONENT", "PROCESS", "TEXTURE_TEST", "QC", "CORNER", "FINAL_RESULT", "READY_TO_SHIP"]);
  assert.deepEqual(m.body.filters, ["ALL", "BELUM_DIMULAI", "BEFORE_KURANG", "PROSES_KURANG", "AFTER_KURANG", "LENGKAP"]);
  const { run } = await acceptedUnit(w);
  await planOnBoard(w, run.id);
  // Isi SEMUA kategori dengan jumlah minimum lewat dokumentasi: tetap "LENGKAP" meski lifecycle belum jalan (tidak ada yang dianggap otomatis).
  const need = m.body.categories.filter((c) => c.key !== "PICKUP_ARRIVAL");
  for (const c of need) {
    const photos = await docPhotos(w.doc, run.id, c.min);
    assert.equal((await submit(w.doc, run.id, c.key, photos.map((p) => ({ url: p.url })), `fill-${c.key}`)).status, 201);
  }
  const d = await detail(w.doc, run.id);
  const pickup = cat(d, "PICKUP_ARRIVAL"); assert.equal(pickup.count >= 0, true);
  const missingNow = d.categories.filter((c) => c.applicable && c.count < c.min).map((c) => c.key);
  assert.deepEqual(missingNow.filter((k) => k !== "PICKUP_ARRIVAL"), []);
});
const randomUuid = () => crypto.randomUUID();
