// P11 Reporting & KPI Production–Warehouse: rumus metrik (harapan dihitung INDEPENDEN dari spec fixture), drill-down = angka, batas WIB,
// filter kombinasi, V1/V2 tidak tercampur, izin/IDOR, reader OFF/non-cohort, layar = Excel/PDF, data belum cukup, jumlah query konstan.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { NOW, D, PERIOD, buildFixture } from "./setup/p11Fixture.js";
import { buildReportContext, drillReport, loadFacts, metricsOf, operatorsDoc, stationsDoc, summaryReport, unitDetailDoc, unitsDoc, warehouseDoc } from "../../src/services/productionReportingService.js";
import { buildPdf, buildXlsx, pdfSafe, toWorkbookData } from "../../src/services/productionReportExport.js";
import { getDocumentationDetail } from "../../src/services/productionDocumentationService.js";
import { BOARD_DEFAULTS } from "../../src/lib/domain/productionBoard.js";
import { MIN_SAMPLE, SLA, wibKey } from "../../src/lib/domain/productionMetrics.js";

let server; let fx;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); fx = await buildFixture(); await setFlags(fx.unitIds); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function setFlags(unitIds) {
  for (const key of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
    const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "p11 test" };
    await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, ...data }, update: data });
  }
}
const ctxOf = (query = {}, unitIds = fx.unitIds) => buildReportContext(testPrisma, { unitIds, query: { ...PERIOD, ...query }, now: NOW });
const START = D("2026-10-01"), END = D("2026-10-21");
const inP = (d) => !!d && d >= START && d < END;
const keyIn = (k) => !!k && k >= PERIOD.from && k <= PERIOD.to;
const S = (tag) => fx.specs.filter((s) => s.tag === tag);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const r1 = (n) => Math.round(n * 10) / 10;
const mins = (a, b) => Math.round((b - a) / 60_000);
const active = (s) => keyIn(s.planned) || inP(s.arrived) || inP(s.started) || inP(s.finished) || inP(s.ready);

test("fixture: ≥ 30 unit, empat meja, semua skenario wajib hadir", () => {
  assert.ok(fx.specs.length >= 30, `${fx.specs.length} unit`);
  assert.deepEqual([...new Set(fx.specs.map((s) => s.station).filter(Boolean))].sort(), BOARD_DEFAULTS.stations);
  for (const tag of ["ontime", "late", "rework", "qcfail_open", "shortage_open", "shortage_resolved", "return_pending", "return_partial", "return_done", "waste", "extra", "working", "paused", "blocked", "waiting_qc", "fg_waiting", "in_transit", "late_open", "wib_in", "wib_out", "september"]) assert.ok(S(tag).length, tag);
  assert.ok(fx.specs.some((s) => s.docs === "full") && fx.specs.some((s) => s.docs === "partial"), "dokumentasi lengkap & kurang");
});

test("cakupan & V1/V2 tidak tercampur: hanya run V2 dalam cohort; unit tanpa run & unit V2 di luar cohort tidak masuk metrik; total V2 dilaporkan terpisah", async () => {
  const ctx = await ctxOf();
  assert.equal(ctx.coverage.cohortUnits, fx.unitIds.length); assert.equal(ctx.coverage.runsInCohort, fx.specs.length);
  assert.equal(ctx.coverage.totalV2Units, fx.specs.length + 1, "unit V2 di luar cohort dihitung di total, bukan di metrik");
  assert.equal(ctx.coverage.period.days, 20); assert.match(ctx.coverage.timezone, /WIB/); assert.match(ctx.coverage.scope, /V1 tidak termasuk/);
  const codes = new Set(ctx.facts.map((f) => f.unitCode)); assert.equal(codes.has("UNIT-P11-IDLE"), false); assert.equal(codes.has("UNIT-P11-OUT"), false);
  // kohort lebih kecil -> hanya unit itu
  const small = await ctxOf({}, S("ontime").slice(0, 3).map((s) => s.unitId));
  assert.equal(small.facts.length, 3); assert.equal(small.coverage.cohortUnits, 3);
  // cohort kosong -> tidak ada data (bukan error)
  const none = await ctxOf({}, []); assert.equal(none.facts.length, 0); assert.equal(summaryReport(none).metrics.find((m) => m.key === "units_in").value, 0);
});

test("rumus metrik: setiap metrik = harapan independen dari spec; drill-down = angka (count = daftar unit pembentuk)", async () => {
  const ctx = await ctxOf(); const m = metricsOf(ctx); const by = (k) => m[k];
  const finishedP = fx.specs.filter((s) => inP(s.finished));
  const activeDays = new Set([...fx.specs.filter((s) => keyIn(s.planned)).map((s) => s.planned), ...finishedP.map((s) => wibKey(s.finished))]);
  assert.equal(by("target_vs_done").value, finishedP.length); assert.equal(by("target_vs_done").target, 12 * activeDays.size); assert.equal(by("target_vs_done").activeDays, activeDays.size);
  assert.equal(by("target_vs_done").achievementPct, r1((finishedP.length / (12 * activeDays.size)) * 100));
  assert.equal(by("units_in").value, fx.specs.filter((s) => inP(s.arrived) && s.kind !== "transit").length);
  assert.equal(by("units_scheduled").value, fx.specs.filter((s) => keyIn(s.planned)).length);
  assert.equal(by("in_progress").value, fx.specs.filter((s) => ["working", "late_open", "qcfail_open"].includes(s.tag)).length, "operasi AKTIF & tidak tertunda");
  assert.equal(by("delayed").value, S("shortage_open").length + S("paused").length + S("blocked").length);
  assert.equal(by("late_open").value, S("late_open").length, "hanya yang belum selesai & melewati target; sedang menunggu QC/dikerjakan hari ini (target 17:00) belum terlambat");
  assert.equal(by("waiting_qc").value, S("waiting_qc").length);
  assert.equal(by("waiting_return").value, S("return_pending").length); assert.equal(by("returns_pending").value, S("return_pending").length);
  const waitingMat = fx.specs.filter((s) => s.tag === "shortage_open" || s.openIssue);
  assert.equal(by("waiting_material").value, new Set(waitingMat.map((s) => s.unitId)).size);
  // TAT: unit siap kirim dalam periode (+ arrived)
  const tatUnits = fx.specs.filter((s) => inP(s.ready) && s.arrived);
  assert.equal(by("tat_arrival_ready").n, tatUnits.length); assert.equal(by("tat_arrival_ready").value, r1(mean(tatUnits.map((s) => mins(s.arrived, s.ready)))));
  // tepat waktu
  const ot = finishedP.filter((s) => s.target); const otOk = ot.filter((s) => s.finished <= s.target);
  assert.equal(by("on_time").n, ot.length); assert.equal(by("on_time").value, r1((otOk.length / ot.length) * 100));
  // QC
  const qcF = fx.specs.filter((s) => s.qc?.length && inP(s.qc[0].at));
  assert.equal(by("qc_first_pass").n, qcF.length); assert.equal(by("qc_first_pass").value, r1((qcF.filter((s) => s.qc[0].result === "PASS").length / qcF.length) * 100));
  assert.equal(by("rework_rate").value, r1((qcF.filter((s) => s.qc.some((q) => q.result === "FAIL_REWORK")).length / qcF.length) * 100));
  // bahan: baris dengan pemakaian tercatat pada unit aktif
  const lines = fx.specs.filter((s) => s.bom && active(s) && s.started && (s.finished || s.tag === "extra")).flatMap((s) => s.bom);
  assert.equal(by("material_adherence").n, lines.length); assert.equal(by("material_adherence").value, r1((lines.filter((b) => b.used <= b.planned).length / lines.length) * 100));
  assert.equal(by("extra_material").value, S("extra").length);
  assert.equal(by("waste_units").value, S("waste").length);
  // perhatian: terlambat, tertunda, exception, retur > SLA, barang jadi > SLA
  const att = new Set([...S("late_open"), ...S("shortage_open"), ...S("paused"), ...S("blocked"), ...S("return_pending"), ...S("fg_waiting"), ...fx.specs.filter((s) => s.exception)].map((s) => s.unitId));
  assert.equal(by("attention").value, att.size);
  // drill-down: jumlah unit terhitung per metrik = angka (count); rate/avg: seluruh sampel tercantum
  const doc = summaryReport(ctx);
  for (const k of ["target_vs_done", "units_in", "units_scheduled", "in_progress", "delayed", "late_open", "waiting_material", "waiting_qc", "waiting_return", "returns_pending", "extra_material", "waste_units", "attention"]) {
    const d = drillReport(ctx, k); assert.equal(d.metric.countedUnits, by(k).value, `drill ${k}`); assert.equal(d.tables[0].rows.filter((r) => r.termasuk === "Ya").length, by(k).value);
    assert.equal(doc.metrics.find((x) => x.key === k).value, by(k).value, "kartu = metrik");
  }
  for (const k of ["on_time", "qc_first_pass", "rework_rate", "tat_arrival_ready", "doc_completeness"]) { const d = drillReport(ctx, k); assert.equal(d.metric.listedUnits, new Set(by(k).members.map((x) => x.runId)).size); assert.equal(d.metric.value, by(k).value); }
  const dotimeRows = drillReport(ctx, "on_time").tables[0].rows; assert.equal(dotimeRows.filter((r) => r.termasuk === "Ya").length, otOk.length);
  // tiap angka dapat diklik: setiap baris drill mengandung unitId/runId yang cocok dengan Unit 360
  for (const r of drillReport(ctx, "attention").tables[0].rows) assert.ok(fx.specs.some((s) => s.unitCode === r.unitCode));
});

test("dokumentasi: kelengkapan dashboard = detail Aplikasi Dokumentasi untuk setiap unit (satu matriks kanonis)", async () => {
  const ctx = await ctxOf();
  let checked = 0;
  for (const f of ctx.facts.filter((x) => x.runOpen || x.runStatus === "COMPLETED").slice(0, 25)) {
    const d = await getDocumentationDetail(testPrisma, f.runId, { unitIds: fx.unitIds });
    assert.equal(f.docs.satisfied, d.totals.satisfied, `${f.unitCode} satisfied`); assert.equal(f.docs.required, d.totals.required, `${f.unitCode} required`); checked += 1;
  }
  assert.ok(checked >= 20);
  const fullOnes = ctx.facts.filter((f) => S("ontime").some((s) => s.unitId === f.unitId && s.docs === "full")).map((f) => f.docs.satisfied / f.docs.required);
  assert.ok(fullOnes.every((p) => p > 0));
});

test("batas hari/bulan WIB: selesai 1 Okt 00:30 WIB (= 30 Sep 17:30Z) di DALAM periode Okt; 21 Okt 00:30 WIB (= 20 Okt 17:30Z) di LUAR; periode September terpisah", async () => {
  const ctx = await ctxOf(); const done = new Set(drillReport(ctx, "target_vs_done").tables[0].rows.filter((r) => r.termasuk === "Ya").map((r) => r.unitCode));
  assert.ok(done.has(S("wib_in")[0].unitCode)); assert.equal(done.has(S("wib_out")[0].unitCode), false); assert.equal(done.has(S("september")[0].unitCode), false);
  const sep = await ctxOf({ from: "2026-09-01", to: "2026-09-30" }); const sepDone = drillReport(sep, "target_vs_done").tables[0].rows.map((r) => r.unitCode);
  assert.ok(sepDone.includes(S("september")[0].unitCode)); assert.equal(sepDone.includes(S("wib_in")[0].unitCode), false, "1 Okt 00:30 WIB bukan September");
  // tren: batas hari mengikuti WIB (selesai 00:30 WIB 1 Okt jatuh di ember 2026-10-01, bukan 2026-09-30)
  const trend = summaryReport(ctx).tables.find((t) => t.key === "trend").rows; assert.equal(trend[0].bucket, "2026-10-01"); assert.ok(trend[0].selesai >= 1);
  const month = summaryReport(await ctxOf({ granularity: "month" })).tables.find((t) => t.key === "trend").rows; assert.deepEqual(month.map((r) => r.bucket), ["2026-10"]);
  const week = summaryReport(await ctxOf({ granularity: "week" })).tables.find((t) => t.key === "trend").rows; assert.equal(week[0].bucket, "2026-09-28", "minggu mulai Senin (WIB)"); assert.ok(week.every((r) => new Date(`${r.bucket}T00:00:00Z`).getUTCDay() === 1));
  assert.equal(month[0].selesai, summaryReport(ctx).tables.find((t) => t.key === "trend").rows.reduce((s, r) => s + r.selesai, 0), "jumlah tren = jumlah periode");
  // tanggal direncanakan, masuk, selesai, siap kirim dibedakan (unit wib_in: direncanakan 1 Okt, masuk 30 Sep, selesai 1 Okt 00:30, siap kirim 1 Okt)
  const row = unitsDoc(ctx).tables[0].rows.find((r) => r.unitCode === S("wib_in")[0].unitCode);
  const detail = unitDetailDoc(ctx, S("wib_in")[0].runId).tables[0].rows.map((r) => String(r.value)); // ringkasan satu unit: waktu tampil WIB, bukan ISO UTC
  assert.ok(detail.includes("2026-10-01 00:30 WIB"), detail.join(" | ")); assert.equal(detail.some((v) => /T\d\d:\d\d:\d\d\.\d{3}Z/.test(v)), false, "tidak ada ISO UTC mentah");
  assert.equal(row.planned, "2026-10-01"); assert.match(row.arrived, /^2026-09-30T02:00:00/); assert.match(row.finished, /^2026-09-30T17:30:00/); assert.match(row.ready, /^2026-10-01T02:00:00/);
});

test("periode & filter divalidasi: format salah, terbalik, > 366 hari, filter tak dikenal -> 400 REPORT_*", async () => {
  const bad = async (q) => { try { await ctxOf(q); return null; } catch (e) { return e.code; } };
  assert.equal(await bad({ from: "2026-13-01" }), "REPORT_PERIOD_INVALID"); assert.equal(await bad({ from: "2026-10-20", to: "2026-10-01" }), "REPORT_PERIOD_INVALID");
  assert.equal(await bad({ from: "2025-01-01", to: "2026-10-20" }), "REPORT_PERIOD_INVALID");
  for (const q of [{ station: "TABLE_9x" }, { operator: "bukan-uuid" }, { step: 13 }, { status: "NGAWUR" }, { priority: 5 }, { service: "x y" }, { qc: "?" }, { docs: "?" }]) assert.equal(await bad(q), "REPORT_FILTER_INVALID", JSON.stringify(q));
});

test("filter kombinasi: meja × status × QC × dokumentasi × prioritas × PIC × layanan; angka & drill mengikuti filter yang sama", async () => {
  const all = await ctxOf();
  const t2 = await ctxOf({ station: "TABLE_2" }); assert.ok(t2.facts.length && t2.facts.every((f) => f.stationCode === "TABLE_2"));
  assert.equal(t2.facts.length, fx.specs.filter((s) => s.station === "TABLE_2").length);
  // "lengkap" = bendera matriks dokumentasi kanonis (BUKAN tag fixture): harapan diambil dari Aplikasi Dokumentasi, sumber yang sama dengan detail unit.
  const lengkap = new Map(); for (const sp of fx.specs.filter((x) => x.station)) lengkap.set(sp.unitCode, (await getDocumentationDetail(testPrisma, sp.runId, { unitIds: fx.unitIds })).docs.flags.lengkap);
  const combo = await ctxOf({ station: "TABLE_2", status: "SIAP_KIRIM", qc: "PASS", docs: "KURANG" });
  const exp = fx.specs.filter((s) => s.station === "TABLE_2" && s.ready && s.qc?.[0]?.result === "PASS" && !lengkap.get(s.unitCode));
  const komplit = await ctxOf({ docs: "LENGKAP" }); assert.deepEqual(komplit.facts.map((f) => f.unitCode).sort(), [...lengkap].filter(([, v]) => v).map(([k]) => k).sort());
  assert.ok(exp.length > 0); assert.deepEqual(combo.facts.map((f) => f.unitCode).sort(), exp.map((s) => s.unitCode).sort());
  const op = await ctxOf({ operator: fx.mejaUsers[0].op.id }); assert.ok(op.facts.length > 0 && op.facts.every((f) => f.operatorId === fx.mejaUsers[0].op.id || f.cornerOperatorId === fx.mejaUsers[0].op.id));
  // Slice 1: prioritas pengguna hanya Normal/Tinggi — "Tinggi" mencakup nilai tersimpan 1 dan nilai lama 2 (Mendesak); parameter lama priority=2 setara Tinggi
  const pr = await ctxOf({ priority: 2 }); assert.deepEqual(pr.facts.map((f) => f.unitCode).sort(), fx.specs.filter((s) => s.priority >= 1 && s.station).map((s) => s.unitCode).sort());
  const pr1 = await ctxOf({ priority: 1 }); assert.deepEqual(pr1.facts.map((f) => f.unitCode).sort(), pr.facts.map((f) => f.unitCode).sort(), "Tinggi = nilai 1 dan 2");
  const pr0 = await ctxOf({ priority: 0 }); assert.ok(pr0.facts.length > 0 && pr0.facts.every((f) => f.priority === 0), "Normal = nilai 0");
  const qf = await ctxOf({ qc: "FAIL" }); assert.deepEqual(qf.facts.map((f) => f.unitCode).sort(), fx.specs.filter((s) => s.qc?.some((q) => q.result === "FAIL_REWORK")).map((s) => s.unitCode).sort());
  const qb = await ctxOf({ qc: "BELUM" }); assert.ok(qb.facts.every((f) => f.qc.count === 0));
  const dk = await ctxOf({ docs: "KURANG" }); assert.ok(dk.facts.length && dk.facts.every((f) => !f.docs.lengkap));
  const svc = await ctxOf({ service: all.facts[0].serviceCode }); assert.equal(svc.facts.length, all.facts.length);
  const step = await ctxOf({ step: 12 }); assert.ok(step.facts.every((f) => f.currentStepNo === 12));
  // metrik pada subset = hitung ulang di subset
  const m = metricsOf(combo); assert.equal(m.target_vs_done.value, exp.filter((s) => inP(s.finished)).length);
  assert.equal(summaryReport(combo).filters.length, 4); assert.match(summaryReport(combo).filters.join(" "), /Meja 2/);
  assert.equal(combo.coverage.runsAfterFilters, exp.length);
  // drill pada subset hanya memuat unit subset
  assert.ok(drillReport(combo, "target_vs_done").tables[0].rows.every((r) => exp.some((s) => s.unitCode === r.unitCode)));
});

test("Meja: kapasitas, utilisasi, masuk/selesai, durasi, aktif/jeda/blokir, keterlambatan, urutan manual, bottleneck / 'Data belum cukup'", async () => {
  const ctx = await ctxOf(); const doc = stationsDoc(ctx);
  const planDays = new Set(fx.specs.filter((s) => keyIn(s.planned)).map((s) => s.planned));
  for (const st of doc.stations) {
    const mine = fx.specs.filter((s) => s.station === st.code); const sched = mine.filter((s) => keyIn(s.planned)); const fin = mine.filter((s) => inP(s.finished));
    assert.equal(st.scheduled, sched.length, st.code); assert.equal(st.finished, fin.length); assert.equal(st.capacityPerDay, 3); assert.equal(st.activeDays, planDays.size);
    assert.equal(st.utilizationPct, r1((sched.length / (3 * planDays.size)) * 100));
    const durs = fin.filter((s) => s.started).map((s) => mins(s.started, s.finished));
    assert.equal(st.durationN, durs.length); assert.equal(st.avgDurationMin, durs.length >= MIN_SAMPLE ? r1(mean(durs)) : null);
    assert.equal(st.lateFinished, fin.filter((s) => s.target && s.finished > s.target).length);
    assert.equal(st.lateOpen, mine.filter((s) => s.tag === "late_open").length);
    assert.equal(st.manualOrderUnits, sched.filter((s) => s.tag === "ontime" && s.code.endsWith("1")).length);
    assert.ok(st.bottleneck === null || st.bottleneck.n >= MIN_SAMPLE, "bottleneck hanya dengan sampel cukup");
  }
  const t1 = doc.stations.find((s) => s.code === "TABLE_1");
  assert.equal(t1.pauseMin, fx.specs.filter((s) => s.station === "TABLE_1" && inP(s.finished) && s.pauseMin).reduce((a, s) => a + s.pauseMin, 0), "jeda dari PAUSE→RESUME stage log");
  assert.ok(doc.tables[0].rows.every((r) => typeof r.bottleneck === "string"));
  // blokir/jeda terbuka dihitung sampai sekarang (tidak masuk "selesai") dan muncul di tahap berjalan
  const unit = unitDetailDoc(ctx, S("paused")[0].runId); const st = unit.tables.find((t) => t.key === "stages").rows[0];
  assert.equal(st.pauseMin, mins(S("paused")[0].pauseSince, NOW)); assert.equal(st.activeMin, Math.max(0, st.elapsedMin - st.pauseMin - st.blockedMin));
  const blk = unitDetailDoc(ctx, S("blocked")[0].runId).tables.find((t) => t.key === "stages").rows[0]; assert.equal(blk.blockedMin, mins(S("blocked")[0].blockedSince, NOW));
});

test("PIC: penugasan/selesai/aktif/terlambat/durasi/jeda/QC/rework/dokumentasi; urut nama (tanpa ranking tunggal); persentase hanya bila n cukup", async () => {
  const doc = operatorsDoc(await ctxOf());
  const names = doc.operators.map((o) => o.name); assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "id")), "urut nama, bukan skor");
  assert.ok(!("rank" in doc.operators[0]) && !("score" in doc.operators[0]));
  for (const o of doc.operators.filter((x) => x.role === "MEJA")) {
    const idx = fx.mejaUsers.findIndex((u) => u.op.id === o.id); const mine = fx.specs.filter((s) => s.stationIdx === idx);
    assert.equal(o.finished, mine.filter((s) => inP(s.finished)).length, o.name);
    assert.equal(o.assigned, mine.filter((s) => keyIn(s.planned) || inP(s.arrived) || inP(s.finished)).length);
    const qc = mine.filter((s) => s.qc?.length && inP(s.qc[0].at)); assert.equal(o.qcN, qc.length);
    assert.equal(o.firstPassPct, qc.length >= MIN_SAMPLE ? r1((qc.filter((s) => s.qc[0].result === "PASS").length / qc.length) * 100) : null);
    assert.equal(o.lateOpen, mine.filter((s) => s.tag === "late_open").length);
  }
  assert.ok(doc.operators.some((o) => o.firstPassPct === null) || doc.operators.some((o) => o.qcN >= MIN_SAMPLE), "ada PIC dengan data belum cukup atau cukup");
  assert.ok(doc.operators.filter((o) => o.role === "CORNER").every((o) => o.firstPassPct === null && o.qcN === 0), "QC/rework hanya untuk PIC Meja");
});

test("Gudang: respons permintaan, issue menunggu/selesai, tambahan, retur pending/parsial/selesai, waste, shortage, barang jadi, SLA & penyebab", async () => {
  const doc = warehouseDoc(await ctxOf()); const w = doc.warehouse;
  const issued = fx.specs.flatMap((s) => [s.issue, s.issueExtra]).filter((x) => x && inP(x.createdAt)); const resp = issued.map((x) => x.responseMin);
  assert.equal(w.request.issued, issued.length); assert.equal(w.request.response.n, resp.length);
  assert.equal(w.request.response.avgMin, resp.length >= MIN_SAMPLE ? r1(mean(resp)) : null);
  const over = issued.filter((x) => x.responseMin > SLA.materialResponseMin); assert.equal(w.request.withinSlaPct, r1(((issued.length - over.length) / issued.length) * 100));
  assert.equal(w.request.openNow, fx.specs.filter((s) => s.openIssue).length); assert.equal(w.request.oldestOpenMin, 600);
  assert.equal(w.request.supplemental, S("extra").length);
  assert.deepEqual(w.returns, { ...w.returns, pending: 1, partial: 1, done: 1 }); assert.equal(w.returns.oldestPendingMin, mins(D("2026-10-19", 8), NOW));
  assert.equal(w.shortages.reported, 3); assert.equal(w.shortages.openNow, 2); assert.equal(w.shortages.resolve.avgMin, null, "n=1 < minimal -> data belum cukup");
  assert.equal(w.finishedGoods.waiting, 2); assert.equal(w.finishedGoods.oldestWaitingMin, mins(D("2026-10-19", 8), NOW));
  assert.deepEqual(w.waste, [{ code: fx.mats[0].code, name: fx.mats[0].name, uom: "SHEET", qty: 1.5, units: 2, movements: 2 }]);
  const causes = Object.fromEntries(w.delayCauses.map((c) => [c.cause, c.count])); assert.ok(causes["Belum diproses Gudang"] >= 1);
  assert.equal(doc.sla.materialResponseMin, 240); assert.match(doc.sla.note, /bawaan/);
  assert.ok(doc.tables.find((t) => t.key === "warehouse_kpi").rows.some((r) => /Data belum cukup/.test(r.note || "")), "keterangan data belum cukup tampil");
});

test("data belum cukup: persentase/rata-rata dengan n < 5 bernilai null + alasan; hitungan tetap angka", async () => {
  const tiny = await ctxOf({}, S("rework").map((s) => s.unitId)); const m = metricsOf(tiny);
  assert.equal(m.qc_first_pass.n, 2); assert.equal(m.qc_first_pass.sufficient, false); assert.equal(m.qc_first_pass.value, null); assert.match(m.qc_first_pass.reason, /Data belum cukup \(n=2, minimal 5\)/);
  assert.equal(m.units_in.value, 2, "hitungan tetap tampil");
  const kpi = summaryReport(tiny).tables[0].rows.find((r) => r.metric === "qc_first_pass"); assert.equal(kpi.value, null); assert.match(kpi.note, /Data belum cukup/);
  const empty = await ctxOf({}, []); const em = metricsOf(empty); assert.equal(em.on_time.value, null); assert.equal(em.tat_arrival_ready.sufficient, false); assert.equal(em.units_scheduled.value, 0);
});

test("tanpa omzet/harga/pembayaran/HPP di dokumen mana pun; semua waktu WIB; target tercatat; definisi lengkap; baris ter-telusur ke unit/order", async () => {
  const ctx = await ctxOf(); const docs = [summaryReport(ctx), stationsDoc(ctx), operatorsDoc(ctx), warehouseDoc(ctx), unitsDoc(ctx), unitDetailDoc(ctx, fx.specs[0].runId), drillReport(ctx, "attention")];
  for (const d of docs) { const text = JSON.stringify(d).toLowerCase(); for (const bad of ["omzet", "orderprice", "\"harga", "payment", "pembayaran", "hpp", "journal", "jurnal", "phone", "customername"]) assert.equal(text.includes(bad), false, `${d.kind} memuat ${bad}`); assert.equal(d.targetPerHari, 12); assert.match(d.targetNote, /belum tersimpan historis/); assert.match(d.timezone, /WIB/); assert.ok(d.generatedAt); }
  const defs = summaryReport(ctx).definitions; assert.equal(defs.length, 19); assert.ok(defs.every((x) => x.formula && x.basis));
  const units = unitsDoc(ctx).tables[0].rows; assert.ok(units.every((r) => r.unitCode && r.runId && r.unitId)); assert.ok(units.some((r) => r.orderNumber));
  assert.equal(unitDetailDoc(ctx, "00000000-0000-4000-8000-000000000000"), null);
});

test("query konstan (tanpa N+1): jumlah query loader sama untuk 10 dan 40 unit dan jauh di bawah jumlah unit", async () => {
  const counted = new PrismaClient({ log: [{ emit: "event", level: "query" }] }); let n = 0; counted.$on("query", () => { n += 1; });
  const run = async (ids) => { n = 0; await loadFacts(counted, { unitIds: ids, now: NOW }); return n; };
  const small = await run(fx.specs.slice(0, 10).map((s) => s.unitId)); const big = await run(fx.unitIds);
  await counted.$disconnect();
  assert.ok(Math.abs(big - small) <= 3, `query: ${small} vs ${big}`); assert.ok(big < 40, `query besar ${big}`);
  const t0 = Date.now(); await ctxOf(); const ms = Date.now() - t0; assert.ok(ms < 4000, "laporan 43 unit < 4 detik");
  console.log(`[p11-perf] query loader: ${small} (10 unit) vs ${big} (${fx.unitIds.length} unit); waktu buildReportContext ${fx.unitIds.length} unit = ${ms} ms`);
});

// ------------------------------------------------------------------------------------------------------------------------------------
// Layar = Excel = PDF
// ------------------------------------------------------------------------------------------------------------------------------------
const cellVal = (c) => { const v = c.value; if (v === null || v === undefined) return null; if (typeof v === "object" && v.result !== undefined) return v.result; return v; };
async function loadSheets(buf) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb; }
const squash = (t) => String(t).replace(/\s+/g, ""); // sel yang membungkus terpecah per baris -> bandingkan tanpa spasi
const pdfText = (buf) => { const raw = buf.toString("latin1"); let out = ""; for (const m of raw.matchAll(/\[([^\]]*)\]\s*TJ/g)) for (const h of m[1].matchAll(/<([0-9a-fA-F]*)>/g)) out += new TextDecoder("windows-1252").decode(Buffer.from(h[1], "hex")); return squash(out); };

test("export Excel = layar: setiap sheet, header, dan sel sama dengan dokumen yang dirender layar; ada sheet Cakupan dan Definisi + timestamp WIB", async () => {
  const ctx = await ctxOf();
  for (const doc of [summaryReport(ctx), stationsDoc(ctx), operatorsDoc(ctx), warehouseDoc(ctx), unitsDoc(ctx), drillReport(ctx, "late_open"), unitDetailDoc(ctx, fx.specs[0].runId)]) {
    const buf = await buildXlsx(doc, { pengekspor: "Tester", now: NOW }); const wb = await loadSheets(buf);
    const data = toWorkbookData(doc); assert.equal(wb.worksheets.length, doc.tables.length + 1);
    for (const [i, t] of doc.tables.entries()) {
      const ws = wb.worksheets[i]; const headers = t.columns.map((c, k) => cellVal(ws.getRow(6).getCell(k + 1)));
      assert.deepEqual(headers, t.columns.map((c) => c.header), `${doc.kind}/${t.key} header`);
      assert.equal(ws.getRow(1).getCell(1).value.includes(doc.title), true);
      t.rows.forEach((row, r) => t.columns.forEach((c, k) => {
        const got = cellVal(ws.getRow(7 + r).getCell(k + 1)); let want = row[c.key];
        if (want === null || want === undefined || want === "") want = null;
        if (c.tipe === "angka" && want !== null && typeof want === "number") assert.equal(got, want, `${doc.kind}/${t.key}[${r}].${c.key}`);
        else if (c.tipe === "waktu" && want) assert.equal(new Date(got).getTime() - 7 * 3600_000, new Date(want).getTime(), `${doc.kind}/${t.key}[${r}].${c.key} waktu (sel Excel = jam dinding WIB)`);
        else if (c.tipe === "tanggal" && want) assert.equal(new Date(got).toISOString().slice(0, 10), String(want).slice(0, 10));
        else if (c.tipe === "teks") assert.equal(got === null ? null : String(got), want === null ? null : String(want), `${doc.kind}/${t.key}[${r}].${c.key}`);
      }));
      if (!t.rows.length) assert.ok(String(ws.getRow(7).getCell(1).value).length > 0, "pesan kosong");
    }
    const info = wb.worksheets.at(-1); const infoText = []; info.eachRow((r) => infoText.push(r.values.slice(1).join(" "))); const joined = infoText.join("\n");
    assert.match(joined, /Data dibuat 2026-10-20 15:00 WIB/); assert.match(joined, /Target harian dipakai 12/); assert.match(joined, /Definisi:/); assert.match(joined, /Periode 2026-10-01 s\/d 2026-10-20/); assert.match(joined, /Cakupan Produksi V2/);
    void data;
  }
});

test("export PDF = layar: judul, cakupan, nilai KPI & baris unit muncul persis (kompresi dimatikan hanya untuk uji); halaman A3 untuk tabel lebar", async () => {
  const ctx = await ctxOf(); const doc = summaryReport(ctx);
  const text = pdfText(await buildPdf(doc, { compress: false, pengekspor: "Tester" }));
  assert.ok(text.includes(squash(doc.title))); assert.ok(text.includes(squash("Periode: 2026-10-01 s/d 2026-10-20"))); assert.ok(text.includes(squash("Target harian dipakai: 12 unit/hari"))); assert.ok(text.includes(squash("Data dibuat: 2026-10-20 15:00 WIB")));
  for (const r of doc.tables[0].rows) { assert.ok(text.includes(squash(pdfSafe(r.label))), `label ${r.label}`); }
  const tv = doc.tables[0].rows.find((r) => r.metric === "target_vs_done"); assert.ok(text.includes(String(tv.value)));
  for (const d of doc.definitions.slice(0, 5)) assert.ok(text.includes(squash(pdfSafe(d.label))));
  const udoc = unitsDoc(ctx); const utext = pdfText(await buildPdf(udoc, { compress: false })); const buf = await buildPdf(udoc, { compress: false });
  for (const r of udoc.tables[0].rows.slice(0, 12)) assert.ok(utext.includes(squash(r.unitCode)), r.unitCode);
  assert.match(buf.toString("latin1"), /\/MediaBox \[0 0 1190\.\d+ 841\.\d+\]/, "A3 landscape untuk 27 kolom");
});

// ------------------------------------------------------------------------------------------------------------------------------------
// HTTP: izin, cohort, IDOR, export
// ------------------------------------------------------------------------------------------------------------------------------------
async function actors() {
  const mk = async (roles) => { const u = await createTestUser({ roles }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
  return { admin: await mk(["ADMIN"]), owner: await mk(["OWNER"]), lead: await mk(["PRODUCTION_LEAD"]), wh: await mk(["WAREHOUSE"]), worker: await mk(["PRODUCTION_WORKER"]), doc: await mk(["PRODUCTION_DOCUMENTER"]), qc: await mk(["QC_LEAD"]), fin: await mk(["FINANCE"]), sales: await mk(["SALES"]), driver: await mk(["DRIVER"]), anon: { api: makeClient(server.baseUrl, null) } };
}
const R = "/api/production-v2/reports"; const Q = `from=${PERIOD.from}&to=${PERIOD.to}`;

test("izin: ADMIN/OWNER/PRODUCTION_LEAD penuh; WAREHOUSE hanya Gudang; Worker/Documenter/QC hanya ringkasan sendiri; Finance/Sales/Driver/anon ditolak", async () => {
  const a = await actors();
  const status = async (who, p) => (await who.api.get(`${R}${p}`)).status;
  for (const who of [a.admin, a.owner, a.lead]) for (const p of ["/meta", `/summary?${Q}`, `/stations?${Q}`, `/operators?${Q}`, `/warehouse?${Q}`, `/units?${Q}`, `/drill/late_open?${Q}`, `/my-summary?${Q}`]) assert.equal(await status(who, p), 200, `${p}`);
  for (const p of [`/warehouse?${Q}`, "/meta"]) assert.equal(await status(a.wh, p), 200);
  for (const p of [`/summary?${Q}`, `/stations?${Q}`, `/operators?${Q}`, `/units?${Q}`, `/drill/late_open?${Q}`, `/my-summary?${Q}`]) assert.equal(await status(a.wh, p), 403, `WAREHOUSE ${p}`);
  for (const who of [a.worker, a.doc, a.qc]) { assert.equal(await status(who, "/meta"), 200); assert.equal(await status(who, `/my-summary?${Q}`), 200); for (const p of [`/summary?${Q}`, `/stations?${Q}`, `/operators?${Q}`, `/warehouse?${Q}`, `/units?${Q}`, `/export?report=summary&format=xlsx&${Q}`]) assert.equal(await status(who, p), 403, p); }
  for (const who of [a.fin, a.sales, a.driver]) for (const p of ["/meta", `/summary?${Q}`, `/warehouse?${Q}`, `/my-summary?${Q}`, `/export?report=warehouse&format=pdf&${Q}`]) assert.equal(await status(who, p), 403, p);
  for (const p of ["/meta", `/summary?${Q}`]) assert.equal(await status(a.anon, p), 401);
  const meta = (await a.wh.api.get(`${R}/meta`)).body; assert.equal(meta.capabilities.warehouse, true); assert.equal(meta.capabilities.summary, false); assert.equal(meta.operators, undefined, "daftar PIC tidak diberikan ke Gudang");
});

test("Gudang tidak melihat PIC/unit sensitif; daftar unit Gudang minimal; ringkasan sendiri hanya milik pengguna; tanpa data Finance di respons", async () => {
  const a = await actors();
  const wh = (await a.wh.api.get(`${R}/warehouse?${Q}`)).body; const text = JSON.stringify(wh).toLowerCase();
  for (const bad of ["omzet", "harga", "payment", "hpp", "jurnal", "\"pic\"", "operatorname"]) assert.equal(text.includes(bad), false, bad);
  const list = await a.wh.api.get(`${R}/warehouse/units/openIssues?${Q}`); assert.equal(list.status, 200); assert.ok(list.body.rows.length > 0); assert.deepEqual(Object.keys(list.body.rows[0]).sort(), ["orderNumber", "runId", "station", "unitCode", "unitId"]);
  assert.equal((await a.wh.api.get(`${R}/warehouse/units/tidak-ada?${Q}`)).status, 404);
  assert.equal((await a.worker.api.get(`${R}/warehouse/units/openIssues?${Q}`)).status, 403);
  // my-summary: worker tanpa profil operator -> nol pekerjaan; operator Andi -> hanya miliknya
  const andi = fx.mejaUsers[0]; const mine = await makeClient(server.baseUrl, andi.token).get(`${R}/my-summary?${Q}`); assert.equal(mine.status, 200);
  assert.equal(mine.body.pekerjaan.ditugaskan, fx.specs.filter((s) => s.stationIdx === 0 && s.kind !== "transit").length);
  assert.ok(mine.body.unit.every((u) => fx.specs.find((s) => s.unitCode === u.unitCode)?.stationIdx === 0), "hanya unit Meja 1");
  const none = await a.worker.api.get(`${R}/my-summary?${Q}`); assert.equal(none.body.pekerjaan.ditugaskan, 0);
});

test("reader OFF / non-cohort / IDOR: OFF -> readerMode OFF tanpa data; unit di luar cohort & id acak = 404; filter operator asing tidak membocorkan", async () => {
  const a = await actors();
  const outsiderRun = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: fx.outsiderUnitId } });
  assert.equal((await a.lead.api.get(`${R}/units/${outsiderRun.id}?${Q}`)).status, 404, "unit V2 di luar cohort");
  assert.equal((await a.lead.api.get(`${R}/units/${fx.specs[0].runId}?${Q}`)).status, 200);
  for (const id of ["bukan-uuid", "00000000-0000-4000-8000-000000000000", "../../etc/passwd"]) assert.equal((await a.lead.api.get(`${R}/units/${encodeURIComponent(id)}?${Q}`)).status, 404);
  assert.equal((await a.lead.api.get(`${R}/drill/metrik_ngawur?${Q}`)).status, 404);
  assert.equal((await a.lead.api.get(`${R}/summary?from=2026-10-20&to=2026-10-01`)).status, 400);
  assert.equal((await a.lead.api.get(`${R}/summary?${Q}&station=TABLE_1;DROP`)).status, 400);
  const summary = (await a.lead.api.get(`${R}/summary?${Q}`)).body; assert.equal(summary.coverage.cohortUnits, fx.unitIds.length); assert.equal(JSON.stringify(summary).includes("UNIT-P11-OUT"), false);
  // cohort menyempit -> laporan menyempit; OFF -> kosong
  await setFlags(fx.specs.slice(0, 3).map((s) => s.unitId)); const narrow = (await a.lead.api.get(`${R}/units?${Q}`)).body; assert.equal(narrow.tables[0].rows.length, 3);
  await setFlags(null);
  for (const p of ["/summary", "/stations", "/operators", "/warehouse", "/units", "/my-summary", "/drill/late_open"]) { const r = await a.lead.api.get(`${R}${p}?${Q}`); assert.equal(r.status, 200); assert.equal(r.body.readerMode, "OFF"); assert.equal(r.body.tables, undefined); }
  assert.equal((await a.lead.api.get(`${R}/export?report=summary&format=xlsx&${Q}`)).status, 409);
  assert.equal((await a.lead.api.get(`${R}/meta`)).body.readerMode, "OFF");
  await setFlags(fx.unitIds);
});

test("export via HTTP = JSON layar: Excel & PDF dari endpoint yang sama, header/nama berkas aman; format salah ditolak; PIC pengekspor tercatat", async () => {
  const a = await actors();
  const json = (await a.lead.api.get(`${R}/summary?${Q}`)).body;
  const res = await fetch(`${server.baseUrl}${R}/export?report=summary&format=xlsx&${Q}`, { headers: { Authorization: `Bearer ${a.lead.token}` } });
  assert.equal(res.status, 200); assert.match(res.headers.get("content-type"), /spreadsheetml/); assert.match(res.headers.get("content-disposition"), /attachment; filename="Production_summary_2026-10-01_sd_2026-10-20\.xlsx"/); assert.equal(res.headers.get("cache-control"), "no-store");
  const wb = await loadSheets(Buffer.from(await res.arrayBuffer())); const ws = wb.worksheets[0];
  json.tables[0].rows.forEach((row, r) => { assert.equal(cellVal(ws.getRow(7 + r).getCell(2)), row.label); const v = cellVal(ws.getRow(7 + r).getCell(3)); assert.equal(v === null ? null : v, row.value === undefined ? null : row.value, `KPI ${row.label}`); });
  assert.match(String(ws.getRow(4).getCell(1).value), /oleh /);
  const pdf = await fetch(`${server.baseUrl}${R}/export?report=warehouse&format=pdf&${Q}`, { headers: { Authorization: `Bearer ${a.wh.token}` } });
  assert.equal(pdf.status, 200); assert.match(pdf.headers.get("content-type"), /application\/pdf/); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
  assert.equal((await a.lead.api.get(`${R}/export?report=summary&format=docx&${Q}`)).status, 400);
  assert.equal((await a.wh.api.get(`${R}/export?report=units&format=xlsx&${Q}`)).status, 403, "Gudang tidak boleh mengekspor laporan unit/PIC");
  assert.equal((await a.lead.api.get(`${R}/export?report=unit&runId=00000000-0000-4000-8000-000000000000&format=pdf&${Q}`)).status, 404);
  const one = await fetch(`${server.baseUrl}${R}/export?report=unit&runId=${fx.specs[0].runId}&format=xlsx&${Q}`, { headers: { Authorization: `Bearer ${a.lead.token}` } }); assert.equal(one.status, 200);
});

test("klik angka Meja/PIC: daftar unit = angka kartu (jumlah baris sama), izin penuh saja, kode/kunci asing 404", async () => {
  const a = await actors();
  const stations = (await a.lead.api.get(`${R}/stations?${Q}`)).body.stations;
  for (const st of stations) {
    const sched = (await a.lead.api.get(`${R}/stations/${st.code}/units/scheduled?${Q}`)).body; const fin = (await a.lead.api.get(`${R}/stations/${st.code}/units/finished?${Q}`)).body;
    assert.equal(sched.tables[0].rows.length, st.scheduled, `${st.code} terjadwal`); assert.equal(fin.tables[0].rows.length, st.finished, `${st.code} selesai`);
    assert.ok(sched.tables[0].rows.every((r) => r.unitId && r.runId), "baris ter-telusur ke Unit 360");
  }
  const ops = (await a.lead.api.get(`${R}/operators?${Q}`)).body.operators;
  for (const o of ops) {
    const asg = (await a.lead.api.get(`${R}/operators/${o.role}:${o.id}/units/assigned?${Q}`)).body; const fin = (await a.lead.api.get(`${R}/operators/${o.role}:${o.id}/units/finished?${Q}`)).body;
    assert.equal(asg.tables[0].rows.length, o.assigned, `${o.name} ditugaskan`); assert.equal(fin.tables[0].rows.length, o.finished, `${o.name} selesai`);
  }
  assert.equal((await a.lead.api.get(`${R}/stations/TABLE_9/units/finished?${Q}`)).status, 404); assert.equal((await a.lead.api.get(`${R}/stations/TABLE_1/units/ngawur?${Q}`)).status, 404);
  assert.equal((await a.lead.api.get(`${R}/operators/MEJA:00000000-0000-4000-8000-000000000000/units/assigned?${Q}`)).status, 404);
  for (const who of [a.wh, a.worker, a.fin]) { assert.equal((await who.api.get(`${R}/stations/TABLE_1/units/finished?${Q}`)).status, 403); assert.equal((await who.api.get(`${R}/operators/MEJA:x/units/assigned?${Q}`)).status, 403); }
});
