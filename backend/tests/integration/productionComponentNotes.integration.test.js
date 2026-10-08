// Simplifikasi Production slice 3 — Catatan Komponen kanonis per unit (HTTP nyata): seksi Sebelum/Sesudah, katalog/manual/tidak diketahui, koreksi + histori,
// replay, konflik paralel, multi-unit, izin, laporan Sebelum→Sesudah, dan jaminan: dokumentasi/catatan TIDAK mengubah stok maupun lifecycle.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUnit, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { EVIDENCE_URL_PREFIX } from "../../src/lib/domain/productionSteps.js";

let server;
let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const CN = "/api/production-v2/component-notes";
const key = (v) => ({ "Idempotency-Key": `s3-test-${v}-${++seq}-0001` });
const fixedKey = (v) => ({ "Idempotency-Key": `s3-fixed-${v}-0001` });

async function setCohort(...unitIds) {
  for (const flagKey of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
    const data = { enabled: true, scope: "GLOBAL", config: { unitIds }, reason: "s3 test" };
    await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
  }
}
async function world() {
  const mk = async (roles) => { const u = await createTestUser({ roles }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
  const [meja, corner, lead, doc, sales, gudang, driver, admin] = await Promise.all([
    mk(["PRODUCTION_WORKER"]), mk(["PRODUCTION_WORKER"]), mk(["PRODUCTION_LEAD"]), mk(["PRODUCTION_DOCUMENTER"]), mk(["SALES"]), mk(["WAREHOUSE"]), mk(["DRIVER"]), mk(["ADMIN"]),
  ]);
  const per = await createTestMaterial({ name: "Pocket Spring Premium" });
  const busa = await createTestMaterial({ name: "Busa HD D26" });
  const nonaktif = await createTestMaterial({ name: "Bahan Lama", active: false });
  await seedBalance(per.id, 10); await seedBalance(busa.id, 10);
  return { meja, corner, lead, doc, sales, gudang, driver, admin, per, busa, nonaktif };
}
// Unit + Production Run minimal (lifecycle ACTIVE/PROCESS) di cohort — cukup untuk membuktikan catatan tidak menyentuh lifecycle.
async function unitWithRun({ cohort = true } = {}) {
  const { unit, order } = await createTestUnit({ unitCode: `S3-UNIT-${++seq}`, status: "IN_PRODUCTION" });
  const run = await testPrisma.productionRun.create({
    data: {
      unitId: unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS", revision: 4, startedAt: new Date(),
      phases: { create: ["INTAKE", "DIAGNOSIS", "PROCESS", "QC", "HANDOFF"].map((phase, i) => ({ phase, sequence: i + 1, status: i < 2 ? "COMPLETED" : i === 2 ? "ACTIVE" : "NOT_STARTED" })) },
    },
  });
  return { unit, order, run, cohort };
}
async function setup(n = 1) {
  const w = await world();
  const units = [];
  for (let i = 0; i < n; i += 1) units.push(await unitWithRun());
  await setCohort(...units.map((u) => u.unit.id));
  return { w, units };
}

// ---- unggah foto nyata lewat endpoint (magic byte PNG; isi unik -> nama berkas unik) ----
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
async function uploadPhoto(who, unitId, { mime = "image/png", bytes = null } = {}) {
  const fd = new FormData();
  fd.append("files", new Blob([bytes ?? Buffer.concat([PNG_HEAD, crypto.randomBytes(24)])], { type: mime }), "foto.png");
  const res = await fetch(`${server.baseUrl}${CN}/units/${unitId}/upload`, { method: "POST", headers: { Authorization: `Bearer ${who.token}` }, body: fd });
  return { status: res.status, body: await res.json() };
}
const photo = async (who, unitId) => { const r = await uploadPhoto(who, unitId); assert.equal(r.status, 201, JSON.stringify(r.body)); return { url: r.body.items[0].url, caption: "foto uji" }; };

const catalog = (m) => ({ kind: "CATALOG", materialId: m.id });
const manual = (t) => ({ kind: "MANUAL", text: t });
const unknown = { kind: "UNKNOWN" };
const LAYERS = (w) => ({
  layersUnknown: false, note: "Lapisan tampak lama",
  layers: [
    { material: catalog(w.busa), thicknessCm: 5, condition: "KEMPES", note: "amblas di tengah" },
    { material: manual("Kapuk bekas"), thicknessCm: null, condition: "AUS" },
    { material: unknown, thicknessCm: null, condition: "TIDAK_DIKETAHUI" },
  ],
});
const FOUNDATION = (w) => ({ system: "BONNELL", material: catalog(w.per), condition: "RUSAK", note: "per karatan" });
const AFTER = (w) => ({
  foundation: { action: "REPLACE", system: "POCKET_SPRING", material: catalog(w.per), note: "diganti penuh" },
  layers: [{ action: "REPLACE", material: catalog(w.busa), thicknessCm: 5, note: "busa baru" }, { action: "KEEP", fromOrder: 2 }, { action: "REPAIR", fromOrder: 3, material: manual("Lem + jahit ulang") }],
  note: "selesai",
});
const put = (who, unitId, section, body, headers = key(section)) => who.api.post(`${CN}/units/${unitId}/sections/${section}`, body, headers);
const get = (who, unitId) => who.api.get(`${CN}/units/${unitId}`);
const ok = (res, status = 201) => { assert.equal(res.status, status, JSON.stringify(res.body)); return res.body; };

// Gambaran lifecycle + stok yang HARUS tetap utuh oleh catatan komponen/dokumentasi.
async function snapshot(unitIds, materialIds) {
  const runs = await testPrisma.productionRun.findMany({ where: { unitId: { in: unitIds } }, include: { phases: { orderBy: { sequence: "asc" } } }, orderBy: { id: "asc" } });
  const units = await testPrisma.unit.findMany({ where: { id: { in: unitIds } }, orderBy: { id: "asc" }, select: { id: true, status: true, serviceId: true } });
  return JSON.stringify({
    runs: runs.map((r) => ({ id: r.id, status: r.status, revision: r.revision, phase: r.currentPhase, phases: r.phases.map((p) => p.status) })), units,
    stock: await testPrisma.stockMovement.count(), balances: await Promise.all(materialIds.map(async (id) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: id }, _sum: { qty: true } }))._sum.qty || 0))),
    reservations: await testPrisma.materialReservation.count(), issues: await testPrisma.materialIssue.count(), returns: await testPrisma.productionMaterialReturn.count(),
    bom: await testPrisma.plannedBOMLine.count(), plans: await testPrisma.productionRunPlan.count(), evidence: await testPrisma.productionStepEvidence.count(), journals: await testPrisma.finJournalEntry.count(), shortages: await testPrisma.productionMaterialShortage.count(),
  });
}

test("A. Satu catatan kanonis per unit: Meja menyimpan Lapisan+Fondasi sebelum (katalog / Bahan manual / Tidak diketahui + foto); Corner, Dokumentasi, Lead membaca data yang SAMA", async () => {
  const { w, units: [u] } = await setup();
  const p1 = await photo(w.meja, u.unit.id); const p2 = await photo(w.meja, u.unit.id);
  const l = ok(await put(w.meja, u.unit.id, "LAYERS_BEFORE", { expectedVersion: 0, data: LAYERS(w), media: [p1, p2] }));
  assert.deepEqual([l.version, l.corrected, l.unchanged, l.replayed], [1, false, false, false]);
  ok(await put(w.meja, u.unit.id, "FOUNDATION_BEFORE", { expectedVersion: 0, data: FOUNDATION(w), media: [] }));
  const reads = {};
  for (const [name, who] of Object.entries({ meja: w.meja, corner: w.corner, doc: w.doc, lead: w.lead, admin: w.admin })) reads[name] = ok(await get(who, u.unit.id), 200);
  const strip = (r) => JSON.stringify({ sections: Object.fromEntries(Object.entries(r.sections).map(([k, v]) => [k, v && { version: v.version, data: v.data, actor: v.actor, at: v.at, media: v.media.map((m) => [m.url, m.caption]) }])), comparison: r.comparison });
  for (const name of ["corner", "doc", "lead", "admin"]) assert.equal(strip(reads[name]), strip(reads.meja), `${name} membaca data yang sama`);
  const s = reads.meja.sections.LAYERS_BEFORE;
  assert.equal(s.actor.id, w.meja.user.id); assert.ok(s.actor.name); assert.ok(s.at); assert.equal(s.version, 1); assert.equal(s.media.length, 2); assert.ok(s.media.every((m) => /sig=/.test(m.previewUrl) || m.previewUrl), "foto bertanda tangan");
  const [a, b, c] = s.data.layers;
  assert.deepEqual([a.material.kind, a.material.name, a.material.code, a.thicknessCm], ["CATALOG", "Busa HD D26", w.busa.code, 5], "snapshot katalog diisi server");
  assert.deepEqual([b.material.kind, b.material.text, b.thicknessCm], ["MANUAL", "Kapuk bekas", null]);
  assert.deepEqual([c.material.kind, c.condition], ["UNKNOWN", "TIDAK_DIKETAHUI"]);
  assert.equal(reads.meja.sections.FOUNDATION_BEFORE.data.system, "BONNELL");
  assert.equal(reads.meja.sections.AFTER, null, "Sesudah belum dicatat — tidak dikarang");
  assert.deepEqual(reads.meja.comparison.status, { layersBefore: true, foundationBefore: true, after: false });
  assert.equal(reads.meja.comparison.gaps.length, 1); assert.match(reads.meja.comparison.gaps[0].text, /Sesudah pengerjaan belum dicatat/);
  assert.ok(reads.meja.comparison.layers.every((r) => r.outcome === "UNRECORDED" && r.final === null), "tanpa hasil akhir palsu");
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: u.unit.id } }), 2);
  const raw = JSON.stringify(reads.meja);
  assert.doesNotMatch(raw, /"(price|harga|value|unitCost|cost)"/i, "tanpa harga");
});

test("B. Sesudah (dipertahankan/diperbaiki/diganti) + perbandingan Sebelum→Sesudah: komponen yang tetap digunakan, data belum dicatat disebut jelas; tahap dilewati tidak membuat hasil palsu", async () => {
  const { w, units: [u] } = await setup();
  // tahap yang DILEWATI (SKIPPED) tetap bisa punya dokumentasi, tetapi TIDAK menghasilkan catatan before/after
  await testPrisma.productionStepEvidence.create({ data: { runId: u.run.id, stepNo: 3, stepCode: "S03_TEARDOWN", version: 1, payload: { outcome: "SKIPPED", reason: "Adaptasi sistem" }, media: [] } });
  const empty = ok(await get(w.corner, u.unit.id), 200);
  assert.equal(empty.comparison.recordedAny, false); assert.equal(empty.comparison.gaps.length, 3); assert.deepEqual(empty.comparison.layers, []); assert.equal(empty.comparison.foundation, null);
  assert.deepEqual(empty.comparison.final, { foundation: null, layers: [] });
  ok(await put(w.meja, u.unit.id, "LAYERS_BEFORE", { expectedVersion: 0, data: LAYERS(w) }));
  // hanya Sebelum-lapisan: fondasi & sesudah belum dicatat
  let c = ok(await get(w.doc, u.unit.id), 200).comparison;
  assert.deepEqual(c.status, { layersBefore: true, foundationBefore: false, after: false }); assert.equal(c.gaps.length, 2);
  ok(await put(w.meja, u.unit.id, "FOUNDATION_BEFORE", { expectedVersion: 0, data: FOUNDATION(w) }));
  const pa = await photo(w.corner, u.unit.id);
  const after = ok(await put(w.corner, u.unit.id, "AFTER", { expectedVersion: 0, data: AFTER(w), media: [pa] }));
  assert.equal(after.version, 1);
  c = ok(await get(w.lead, u.unit.id), 200).comparison;
  assert.equal(c.complete, true); assert.deepEqual(c.gaps, []);
  assert.deepEqual(c.layers.map((r) => r.outcome), ["REPLACED", "KEPT", "REPAIRED"]);
  assert.equal(c.layers[0].final.label, `Busa HD D26 (${w.busa.code})`); assert.equal(c.layers[0].final.source, "NEW");
  assert.equal(c.layers[1].final.label, "Bahan manual: Kapuk bekas", "komponen dipertahankan = bahan lama tercatat"); assert.equal(c.layers[1].final.source, "KEPT");
  assert.match(c.layers[2].final.label, /Bahan manual: Lem \+ jahit ulang/);
  assert.deepEqual(c.kept, ["Lapisan 2: Bahan manual: Kapuk bekas"]);
  assert.equal(c.foundation.outcome, "REPLACED"); assert.match(c.foundation.final.label, /Pocket spring/);
  assert.equal(c.foundation.before.systemLabel, "Per bonnell");
  // KEEP tanpa data sebelumnya -> tidak dikarang
  const { units: [u2] } = await (async () => { const x = await unitWithRun(); await setCohort(u.unit.id, x.unit.id); return { units: [x] }; })();
  ok(await put(w.meja, u2.unit.id, "AFTER", { expectedVersion: 0, data: { foundation: { action: "KEEP" }, layers: [{ action: "KEEP" }] } }));
  const c2 = ok(await get(w.meja, u2.unit.id), 200).comparison;
  assert.equal(c2.layers[0].before, null); assert.equal(c2.layers[0].beforeRecorded, false); assert.match(c2.layers[0].final.label, /bahan lama belum dicatat/); assert.match(c2.foundation.final.label, /fondasi lama belum dicatat/);
  assert.equal(c2.gaps.length, 2);
  assert.equal(await testPrisma.productionStepEvidence.count({ where: { runId: u.run.id } }), 1, "tidak ada bukti tahap baru");
});

test("C. Koreksi mempertahankan histori (versi baru + alasan + actor/waktu); revisi usang ditolak; isi identik tidak menggandakan; tanpa alasan ditolak", async () => {
  const { w, units: [u] } = await setup();
  const v1 = ok(await put(w.meja, u.unit.id, "FOUNDATION_BEFORE", { expectedVersion: 0, data: FOUNDATION(w) }));
  assert.equal(v1.version, 1);
  const noReason = await put(w.corner, u.unit.id, "FOUNDATION_BEFORE", { expectedVersion: 1, data: { ...FOUNDATION(w), condition: "KOTOR" } });
  assert.equal(noReason.status, 400); assert.equal(noReason.body.code, "COMPONENT_REASON_REQUIRED");
  const stale = await put(w.corner, u.unit.id, "FOUNDATION_BEFORE", { expectedVersion: 0, data: { ...FOUNDATION(w), condition: "KOTOR" } });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "COMPONENT_VERSION_CONFLICT"); assert.equal(stale.body.details.currentVersion, 1);
  const v2 = ok(await put(w.corner, u.unit.id, "FOUNDATION_BEFORE", { expectedVersion: 1, data: { ...FOUNDATION(w), condition: "KOTOR", note: "ternyata berjamur" }, reason: "salah baca kondisi saat bongkar" }));
  assert.deepEqual([v2.version, v2.corrected], [2, true]);
  const r = ok(await get(w.doc, u.unit.id), 200);
  assert.equal(r.sections.FOUNDATION_BEFORE.version, 2); assert.equal(r.sections.FOUNDATION_BEFORE.data.condition, "KOTOR");
  assert.equal(r.sections.FOUNDATION_BEFORE.actor.id, w.corner.user.id); assert.equal(r.sections.FOUNDATION_BEFORE.correctionReason, "salah baca kondisi saat bongkar");
  assert.equal(r.history.length, 2); assert.deepEqual(r.history.map((h) => [h.version, h.superseded]), [[1, true], [2, false]]);
  assert.equal(r.history[0].data.condition, "RUSAK", "versi lama utuh"); assert.equal(r.history[0].actor.id, w.meja.user.id);
  // isi identik dengan versi terkini -> tidak ada baris baru
  const same = ok(await put(w.corner, u.unit.id, "FOUNDATION_BEFORE", { expectedVersion: 2, data: { ...FOUNDATION(w), condition: "KOTOR", note: "ternyata berjamur" }, reason: "cek ulang" }), 200);
  assert.deepEqual([same.unchanged, same.version], [true, 2]);
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: u.unit.id } }), 2);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: u.unit.id, eventType: "PRODUCTION_COMPONENT_CORRECTED" } }), 1);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: u.unit.id, eventType: "PRODUCTION_COMPONENT_RECORDED" } }), 1);
  // baris lama tidak pernah diubah oleh koreksi
  const rows = await testPrisma.unitComponentEntry.findMany({ where: { unitId: u.unit.id }, orderBy: { version: "asc" } });
  assert.equal(rows[0].payload.condition, "RUSAK"); assert.equal(rows[0].reason, null); assert.equal(rows[1].reason, "salah baca kondisi saat bongkar");
});

test("D. Replay: kunci sama + isi sama = respons sama tanpa data ganda; kunci sama + isi beda = 409; kunci wajib", async () => {
  const { w, units: [u] } = await setup();
  const body = { expectedVersion: 0, data: LAYERS(w) };
  const first = ok(await put(w.meja, u.unit.id, "LAYERS_BEFORE", body, fixedKey("replay")));
  const cmds = await testPrisma.v2Command.count(); const acts = await testPrisma.activityEvent.count();
  const again = ok(await put(w.meja, u.unit.id, "LAYERS_BEFORE", body, fixedKey("replay")), 200);
  assert.equal(again.replayed, true); assert.equal(again.version, first.version);
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: u.unit.id } }), 1);
  assert.equal(await testPrisma.v2Command.count(), cmds); assert.equal(await testPrisma.activityEvent.count(), acts);
  const diff = await put(w.meja, u.unit.id, "LAYERS_BEFORE", { expectedVersion: 0, data: { ...LAYERS(w), note: "beda" } }, fixedKey("replay"));
  assert.equal(diff.status, 409); assert.equal(diff.body.code, "IDEMPOTENCY_CONFLICT");
  const nokey = await w.meja.api.post(`${CN}/units/${u.unit.id}/sections/LAYERS_BEFORE`, body, {});
  assert.equal(nokey.status, 400); assert.equal(nokey.body.code, "IDEMPOTENCY_KEY_INVALID");
  // replay setelah versi maju (koreksi) tetap menjawab hasil pertama, tidak menulis ulang
  ok(await put(w.lead, u.unit.id, "LAYERS_BEFORE", { expectedVersion: 1, data: { ...LAYERS(w), note: "koreksi lead" }, reason: "tambah catatan" }));
  const late = ok(await put(w.meja, u.unit.id, "LAYERS_BEFORE", body, fixedKey("replay")), 200);
  assert.deepEqual([late.replayed, late.version], [true, 1]);
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: u.unit.id } }), 2);
});

test("E. Konflik paralel: dua penulis dengan expectedVersion sama -> tepat satu versi; yang lain 409; kunci sama paralel -> satu penulisan", async () => {
  const { w, units: [u] } = await setup();
  const mk = (note) => ({ expectedVersion: 0, data: { ...FOUNDATION(w), note } });
  const [a, b] = await Promise.all([put(w.meja, u.unit.id, "FOUNDATION_BEFORE", mk("A")), put(w.corner, u.unit.id, "FOUNDATION_BEFORE", mk("B"))]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409], JSON.stringify([a.body, b.body]));
  assert.equal([a, b].find((r) => r.status === 409).body.code, "COMPONENT_VERSION_CONFLICT");
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: u.unit.id, section: "FOUNDATION_BEFORE" } }), 1);
  // kunci sama bersamaan (retry ganda dari HP)
  const same = fixedKey("par");
  const body = { expectedVersion: 0, data: LAYERS(w) };
  const [x, y] = await Promise.all([put(w.meja, u.unit.id, "LAYERS_BEFORE", body, same), put(w.meja, u.unit.id, "LAYERS_BEFORE", body, same)]);
  assert.ok([x.status, y.status].every((s) => s === 200 || s === 201), JSON.stringify([x.body, y.body]));
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: u.unit.id, section: "LAYERS_BEFORE" } }), 1);
  // tiga koreksi serentak dari versi yang sama: satu menang
  const rs = await Promise.all([1, 2, 3].map((n) => put(w.lead, u.unit.id, "FOUNDATION_BEFORE", { expectedVersion: 1, data: { ...FOUNDATION(w), note: `k${n}` }, reason: "koreksi paralel" })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 409, 409]);
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: u.unit.id, section: "FOUNDATION_BEFORE" } }), 2);
});

test("F. Multi-unit: catatan terpisah per unit; foto unit lain ditolak; unit di luar cohort 404 baca / 503 tulis", async () => {
  const { w, units: [a, b] } = await setup(2);
  const pa = await photo(w.meja, a.unit.id);
  ok(await put(w.meja, a.unit.id, "LAYERS_BEFORE", { expectedVersion: 0, data: LAYERS(w), media: [pa] }));
  ok(await put(w.meja, b.unit.id, "LAYERS_BEFORE", { expectedVersion: 0, data: { layersUnknown: true, layers: [], note: "kasur tidak sempat dibongkar" } }));
  const ra = ok(await get(w.corner, a.unit.id), 200); const rb = ok(await get(w.corner, b.unit.id), 200);
  assert.equal(ra.sections.LAYERS_BEFORE.data.layers.length, 3); assert.equal(rb.sections.LAYERS_BEFORE.data.layersUnknown, true); assert.equal(rb.sections.LAYERS_BEFORE.data.layers.length, 0);
  assert.equal(rb.sections.LAYERS_BEFORE.media.length, 0);
  assert.equal(rb.comparison.layers.length, 0, "unit B: lapisan tidak diketahui — tidak ada baris karangan");
  const steal = await put(w.meja, b.unit.id, "FOUNDATION_BEFORE", { expectedVersion: 0, data: FOUNDATION(w), media: [pa] });
  assert.equal(steal.status, 409); assert.equal(steal.body.code, "COMPONENT_MEDIA_OTHER_UNIT");
  const out = await unitWithRun(); // di luar cohort (flag hanya a & b)
  assert.equal((await get(w.lead, out.unit.id)).status, 404);
  const wr = await put(w.meja, out.unit.id, "LAYERS_BEFORE", { expectedVersion: 0, data: { layersUnknown: true, layers: [] } });
  assert.equal(wr.status, 503); assert.equal(wr.body.code, "COMPONENT_WRITER_OFF");
  const up = await uploadPhoto(w.meja, out.unit.id); assert.equal(up.status, 503);
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: out.unit.id } }), 0);
});

test("G. Izin: Meja/Corner/Lead/Dokumentasi/Admin boleh menulis; Sales/Gudang/Driver hanya membaca (tulis & unggah 403); tidak ada harga", async () => {
  const { w, units: [u] } = await setup();
  for (const [name, who] of Object.entries({ meja: w.meja, doc: w.doc, lead: w.lead, admin: w.admin })) {
    const r = await put(who, u.unit.id, name === "meja" ? "FOUNDATION_BEFORE" : "AFTER", name === "meja" ? { expectedVersion: 0, data: FOUNDATION(w) } : { expectedVersion: name === "doc" ? 0 : 1, data: { foundation: { action: "KEEP", note: name } }, reason: "uji izin" });
    assert.ok([201, 409].includes(r.status), `${name}: ${r.status} ${JSON.stringify(r.body)}`);
    assert.notEqual(r.status, 403, `${name} boleh menulis`);
  }
  for (const [name, who] of Object.entries({ sales: w.sales, gudang: w.gudang, driver: w.driver })) {
    assert.equal((await put(who, u.unit.id, "FOUNDATION_BEFORE", { expectedVersion: 5, data: FOUNDATION(w) })).status, 403, `${name} tulis`);
    assert.equal((await uploadPhoto(who, u.unit.id)).status, 403, `${name} unggah`);
    assert.equal((await who.api.get(`${CN}/materials?q=busa`)).status, 403, `${name} katalog`);
  }
  const salesRead = await get(w.sales, u.unit.id);
  if (salesRead.status === 200) { assert.equal(salesRead.body.canWrite, false); assert.equal(salesRead.body.suggestions, undefined, "saran bahan hanya untuk penulis"); }
  const cat = ok(await w.meja.api.get(`${CN}/materials?q=busa`), 200);
  assert.ok(cat.items.length >= 1); assert.deepEqual(Object.keys(cat.items[0]).sort(), ["code", "kind", "label", "materialId", "name", "unit"], "tanpa stok/harga");
  assert.equal((await get(w.meja, u.unit.id)).body.canWrite, true);
  assert.equal((await w.meja.api.get(`${CN}/units/not-a-uuid`)).status, 400);
});

test("H. Validasi: bahan katalog tidak ada/nonaktif, Bahan manual terlalu pendek, lapisan kosong tanpa 'tidak diketahui', terlalu banyak lapisan, seksi/versi salah, foto bukan dari unggahan", async () => {
  const { w, units: [u] } = await setup();
  const call = (section, body) => put(w.meja, u.unit.id, section, body);
  const code = async (p) => { const r = await p; assert.ok(r.status >= 400 && r.status < 500, `${r.status} ${JSON.stringify(r.body)}`); return r.body.code; };
  assert.equal(await code(call("LAYERS_BEFORE", { expectedVersion: 0, data: { layers: [{ material: { kind: "CATALOG", materialId: "00000000-0000-4000-8000-000000000000" }, condition: "BAIK" }] } })), "COMPONENT_MATERIAL_NOT_FOUND");
  assert.equal(await code(call("LAYERS_BEFORE", { expectedVersion: 0, data: { layers: [{ material: catalog(w.nonaktif), condition: "BAIK" }] } })), "COMPONENT_MATERIAL_NOT_FOUND");
  assert.equal(await code(call("LAYERS_BEFORE", { expectedVersion: 0, data: { layers: [{ material: manual("x"), condition: "BAIK" }] } })), "COMPONENT_MANUAL_TEXT_REQUIRED");
  assert.equal(await code(call("LAYERS_BEFORE", { expectedVersion: 0, data: { layers: [] } })), "COMPONENT_LAYERS_REQUIRED");
  assert.equal(await code(call("LAYERS_BEFORE", { expectedVersion: 0, data: { layersUnknown: true, layers: [{ material: unknown, condition: "BAIK" }] } })), "COMPONENT_INVALID");
  assert.equal(await code(call("LAYERS_BEFORE", { expectedVersion: 0, data: { layers: Array.from({ length: 13 }, () => ({ material: unknown, condition: "BAIK" })) } })), "COMPONENT_TOO_MANY_LAYERS");
  assert.equal(await code(call("LAYERS_BEFORE", { expectedVersion: 0, data: { layers: [{ material: unknown, condition: "AJAIB" }] } })), "COMPONENT_CONDITION_REQUIRED");
  assert.equal(await code(call("LAYERS_BEFORE", { expectedVersion: 0, data: { layers: [{ material: unknown, condition: "BAIK", thicknessCm: -3 }] } })), "COMPONENT_THICKNESS_INVALID");
  assert.equal(await code(call("FOUNDATION_BEFORE", { expectedVersion: 0, data: { condition: "BAIK" } })), "COMPONENT_SYSTEM_REQUIRED");
  assert.equal(await code(call("AFTER", { expectedVersion: 0, data: { layers: [] } })), "COMPONENT_AFTER_EMPTY");
  assert.equal(await code(call("AFTER", { expectedVersion: 0, data: { layers: [{ action: "REPLACE" }] } })), "COMPONENT_MATERIAL_REQUIRED");
  assert.equal(await code(call("BUKAN_SEKSI", { expectedVersion: 0, data: {} })), "COMPONENT_SECTION_INVALID");
  assert.equal(await code(call("AFTER", { data: { foundation: { action: "KEEP" } } })), "COMPONENT_VERSION_REQUIRED");
  assert.equal(await code(call("FOUNDATION_BEFORE", { expectedVersion: 0, data: FOUNDATION(w), media: [{ url: "/media/job-photos/pod.jpg" }] })), "COMPONENT_MEDIA_INVALID");
  assert.equal(await code(call("FOUNDATION_BEFORE", { expectedVersion: 0, data: FOUNDATION(w), media: [{ url: `${EVIDENCE_URL_PREFIX}${"a".repeat(40)}.png` }] })), "COMPONENT_MEDIA_NOT_FOUND");
  const bad = await uploadPhoto(w.meja, u.unit.id, { bytes: Buffer.from("bukan gambar sungguhan") });
  assert.equal(bad.status, 415);
  assert.equal(await testPrisma.unitComponentEntry.count(), 0, "validasi gagal = tidak ada tulisan");
});

test("I. Catatan komponen & dokumentasi TIDAK mengubah stok maupun lifecycle: tanpa stock movement/reservasi/issue/retur/BOM, run/fase/unit identik; tahap dilewati tetap bisa didokumentasikan", async () => {
  const { w, units: [u] } = await setup();
  await testPrisma.productionStepEvidence.create({ data: { runId: u.run.id, stepNo: 3, stepCode: "S03_TEARDOWN", version: 1, payload: { outcome: "SKIPPED", reason: "Adaptasi sistem" }, media: [] } });
  const before = await snapshot([u.unit.id], [w.per.id, w.busa.id]);
  const p = await photo(w.meja, u.unit.id);
  ok(await put(w.meja, u.unit.id, "LAYERS_BEFORE", { expectedVersion: 0, data: LAYERS(w), media: [p] }));
  ok(await put(w.meja, u.unit.id, "FOUNDATION_BEFORE", { expectedVersion: 0, data: FOUNDATION(w) }));
  ok(await put(w.corner, u.unit.id, "AFTER", { expectedVersion: 0, data: AFTER(w) }));
  ok(await put(w.doc, u.unit.id, "AFTER", { expectedVersion: 1, data: { ...AFTER(w), note: "dok" }, reason: "tambah catatan dokumentasi" }));
  await get(w.lead, u.unit.id);
  assert.equal(await snapshot([u.unit.id], [w.per.id, w.busa.id]), before, "stok + lifecycle identik (bahan katalog tertaut TIDAK dianggap BOM/pemakaian/retur)");
  assert.equal(await testPrisma.unitComponentEntry.count({ where: { unitId: u.unit.id } }), 4);
});

test("J. Laporan before–after: kartu laporan run memuat perbandingan + foto; pesan Sales menyebut Sebelum→Sesudah dan data belum dicatat; tanpa catatan = tanpa baris karangan", async () => {
  const { w, units: [u] } = await setup();
  const none = ok(await w.lead.api.get(`/api/production-v2/runs/${u.run.id}/report`), 200);
  assert.equal(none.components.comparison.recordedAny, false); assert.doesNotMatch(none.message, /KOMPONEN SEBELUM/);
  const pb = await photo(w.meja, u.unit.id); const pa = await photo(w.corner, u.unit.id);
  ok(await put(w.meja, u.unit.id, "LAYERS_BEFORE", { expectedVersion: 0, data: LAYERS(w), media: [pb] }));
  ok(await put(w.corner, u.unit.id, "AFTER", { expectedVersion: 0, data: AFTER(w), media: [pa] }));
  const rep = ok(await w.lead.api.get(`/api/production-v2/runs/${u.run.id}/report`), 200);
  assert.equal(rep.components.status.layersBefore, true); assert.equal(rep.components.status.foundationBefore, false); assert.equal(rep.components.status.after, true);
  assert.equal(rep.components.media.before.length, 1); assert.equal(rep.components.media.after.length, 1); assert.equal(rep.components.mediaCount, 2);
  assert.match(rep.message, /KOMPONEN SEBELUM → SESUDAH/); assert.match(rep.message, /Lapisan 1: Busa HD D26/); assert.match(rep.message, /Tetap digunakan: Lapisan 2/);
  assert.match(rep.message, /Fondasi sebelum dibongkar belum dicatat/); assert.doesNotMatch(rep.message, /undefined/);
  assert.equal(rep.mediaCount, 0, "foto komponen tidak dihitung sebagai media tahap (dua kanal terpisah)");
});
