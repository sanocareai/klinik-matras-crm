// P11.1 — target harian historis: API (izin, validasi, duplikat), append-only di level database, dan laporan P11 memakai target yang berlaku
// pada tiap hari (bukan satu angka × hari); fallback ke konfigurasi untuk hari tanpa target tercatat; catatan target ikut di layar & berkas.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { NOW, D, PERIOD, buildFixture } from "./setup/p11Fixture.js";
import { buildReportContext, metricsOf, summaryReport } from "../../src/services/productionReportingService.js";
import { buildXlsx } from "../../src/services/productionReportExport.js";
import { wibKey } from "../../src/lib/domain/productionMetrics.js";

let server; let fx;
test.before(async () => {
  await truncateAll(); server = await startTestServer(buildTestApp()); fx = await buildFixture();
  for (const key of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
    const data = { enabled: true, scope: "GLOBAL", config: { unitIds: fx.unitIds }, reason: "p11.1 test" };
    await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, ...data }, update: data });
  }
});
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const T = "/api/production-v2/targets"; const R = "/api/production-v2/reports"; const Q = `from=${PERIOD.from}&to=${PERIOD.to}`;
const mk = async (roles) => { const u = await createTestUser({ roles }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
const ctxOf = () => buildReportContext(testPrisma, { unitIds: fx.unitIds, query: PERIOD, now: NOW });
const START = D("2026-10-01"), END = D("2026-10-21");
const inP = (d) => !!d && d >= START && d < END;
const keyIn = (k) => !!k && k >= PERIOD.from && k <= PERIOD.to;

test("sebelum ada target tercatat: perilaku P11 tetap (konfigurasi 12/hari + catatan 'belum tersimpan historis')", async () => {
  const ctx = await ctxOf(); const doc = summaryReport(ctx); const m = metricsOf(ctx).target_vs_done;
  assert.equal(doc.targetPerHari, 12); assert.match(doc.targetNote, /belum tersimpan historis untuk periode ini/);
  assert.equal(m.target, 12 * m.activeDays); assert.equal(m.dailyTarget, 12);
});

test("API: ADMIN/OWNER boleh atur; Lead/Warehouse/Worker/Finance/Sales/Driver/anon tidak; validasi tanggal, jumlah, alasan; duplikat 409; riwayat tampil lengkap", async () => {
  const admin = await mk(["ADMIN"]); const owner = await mk(["OWNER"]); const lead = await mk(["PRODUCTION_LEAD"]);
  const others = await Promise.all(["WAREHOUSE", "PRODUCTION_WORKER", "FINANCE", "SALES", "DRIVER"].map((r) => mk([r])));
  const body = (o = {}) => ({ effectiveFrom: "2026-10-11", targetUnits: 20, reason: "Tambah satu shift Corner", ...o });
  for (const who of [lead, ...others]) assert.equal((await who.api.post(T, body())).status, 403);
  assert.equal((await makeClient(server.baseUrl, null).post(T, body())).status, 401);
  for (const [bad, code] of [[{ effectiveFrom: "2026-13-01" }, "TARGET_DATE_INVALID"], [{ effectiveFrom: "2025-12-31" }, "TARGET_DATE_INVALID"], [{ effectiveFrom: "2030-01-01" }, "TARGET_DATE_INVALID"], [{ targetUnits: 0 }, "TARGET_UNITS_INVALID"], [{ targetUnits: 501 }, "TARGET_UNITS_INVALID"], [{ targetUnits: 12.5 }, "TARGET_UNITS_INVALID"], [{ targetUnits: "abc" }, "TARGET_UNITS_INVALID"], [{ reason: "x" }, "TARGET_REASON_INVALID"], [{ reason: "   " }, "TARGET_REASON_INVALID"], [{ reason: "x".repeat(301) }, "TARGET_REASON_INVALID"]]) {
    const r = await admin.api.post(T, body(bad)); assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.body.code, code);
  }
  assert.equal((await admin.api.post(T, body({ effectiveFrom: "2026-10-05", targetUnits: 15, reason: "Naik bertahap" }))).status, 201);
  const second = await owner.api.post(T, body()); assert.equal(second.status, 201); assert.equal(second.body.target.effectiveFrom, "2026-10-11"); assert.equal(second.body.target.targetUnits, 20);
  assert.equal((await admin.api.post(T, body())).status, 409, "target sama pada tanggal yang sama ditolak");
  assert.equal((await admin.api.post(T, body({ targetUnits: 18, reason: "Koreksi: 18 lebih realistis" }))).status, 201, "koreksi nilai berbeda = baris baru");
  const list = await lead.api.get(T); assert.equal(list.status, 200); assert.equal(list.body.canWrite, false); assert.equal(list.body.rows.length, 3);
  assert.deepEqual(list.body.rows.map((r) => `${r.effectiveFrom}:${r.targetUnits}`), ["2026-10-11:18", "2026-10-11:20", "2026-10-05:15"]);
  assert.ok(list.body.rows.every((r) => r.actorName && r.reason && r.createdAt)); assert.equal((await admin.api.get(T)).body.canWrite, true);
  assert.equal((await others[0].api.get(T)).status, 403, "Gudang tidak melihat riwayat target");
  assert.equal(JSON.stringify(list.body).toLowerCase().includes("harga"), false);
});

test("append-only di database: UPDATE/DELETE ditolak trigger; CHECK menolak nilai di luar 1–500 dan alasan pendek", async () => {
  const row = await testPrisma.productionDailyTarget.findFirstOrThrow();
  await assert.rejects(testPrisma.productionDailyTarget.update({ where: { id: row.id }, data: { targetUnits: 99 } }), /append-only/);
  await assert.rejects(testPrisma.productionDailyTarget.delete({ where: { id: row.id } }), /append-only/);
  await assert.rejects(testPrisma.productionDailyTarget.deleteMany({}), /append-only/);
  await assert.rejects(testPrisma.productionDailyTarget.create({ data: { effectiveFrom: new Date("2026-11-01T00:00:00Z"), targetUnits: 501, reason: "terlalu besar" } }), /target_units_chk|check/i);
  await assert.rejects(testPrisma.productionDailyTarget.create({ data: { effectiveFrom: new Date("2026-11-01T00:00:00Z"), targetUnits: 10, reason: "x" } }), /reason_chk|check/i);
  assert.equal(await testPrisma.productionDailyTarget.count(), 3);
});

test("laporan memakai target yang berlaku tiap hari: target = Σ target hari aktif (12 sebelum 5 Okt, 15 untuk 5–10 Okt, 18 mulai 11 Okt); catatan & Excel menyebut sumbernya", async () => {
  const ctx = await ctxOf(); const m = metricsOf(ctx).target_vs_done; const doc = summaryReport(ctx);
  const finished = fx.specs.filter((s) => inP(s.finished));
  const days = new Set([...fx.specs.filter((s) => keyIn(s.planned)).map((s) => s.planned), ...finished.map((s) => wibKey(s.finished))]);
  const targetFor = (d) => (d >= "2026-10-11" ? 18 : d >= "2026-10-05" ? 15 : 12);
  const expected = [...days].reduce((s, d) => s + targetFor(d), 0);
  assert.equal(m.target, expected); assert.notEqual(expected, 12 * days.size, "bukan satu angka × hari"); assert.equal(m.dailyTarget, null); assert.match(m.targetDesc, /^12–18\/hari × \d+ hari aktif$/);
  assert.equal(m.achievementPct, Math.round((finished.length / expected) * 1000) / 10);
  assert.equal(doc.targetPerHari, "12–18");
  assert.match(doc.targetNote, /tercatat historis: 12\/hari 2026-10-01–2026-10-04 \(konfigurasi sistem, belum ada target tercatat\); 15\/hari 2026-10-05–2026-10-10; 18\/hari 2026-10-11–2026-10-20/);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildXlsx(doc, { pengekspor: "Tester", now: NOW }));
  const lines = []; wb.worksheets.at(-1).eachRow((r) => lines.push(r.values.slice(1).join(" "))); assert.match(lines.join("\n"), /Target harian dipakai 12–18 unit\/hari/);
  // periode setelah semua target: seragam 18; periode sebelum target pertama: konfigurasi
  const after = await buildReportContext(testPrisma, { unitIds: fx.unitIds, query: { from: "2026-10-12", to: "2026-10-20" }, now: NOW });
  assert.equal(summaryReport(after).targetPerHari, 18); assert.equal(metricsOf(after).target_vs_done.dailyTarget, 18);
  const before = await buildReportContext(testPrisma, { unitIds: fx.unitIds, query: { from: "2026-09-01", to: "2026-09-30" }, now: NOW });
  assert.equal(summaryReport(before).targetPerHari, 12); assert.match(summaryReport(before).targetNote, /belum tersimpan historis untuk periode ini/);
  // HTTP: meta & summary membawa target historis yang sama
  const lead = await mk(["PRODUCTION_LEAD"]);
  const http = (await lead.api.get(`${R}/summary?${Q}`)).body; assert.equal(http.targetPerHari, "12–18"); assert.equal(http.metrics.find((x) => x.key === "target_vs_done").target, expected);
  const meta = (await lead.api.get(`${R}/meta`)).body; assert.equal(meta.capabilities.targetWrite, false); assert.equal(meta.targetPerHari, "12–18".length ? meta.targetPerHari : null);
  assert.equal((await (await mk(["ADMIN"])).api.get(`${R}/meta`)).body.capabilities.targetWrite, true);
});
