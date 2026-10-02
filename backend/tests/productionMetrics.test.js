// P11 — kontrak metrik (fungsi murni): periode & batas hari/bulan WIB, ember tren, filter, statistik, bucket status, definisi metrik.
import test from "node:test";
import assert from "node:assert/strict";
import {
  METRICS, METRIC_BY_KEY, MIN_SAMPLE, STATUS_BUCKETS, activeFilterLabels, addDays, bucketKey, bucketsOf, buildTargetResolver, computeMetrics, describeTargets, formatMinutes, minutesBetween, normalizeFilters,
  parsePeriod, pct, percentile, round1, startOfWibDay, statusBucketOf, wibKey,
} from "../src/lib/domain/productionMetrics.js";

const code = (fn) => { try { fn(); return null; } catch (e) { return e.code ?? e.name; } };

test("WIB: instan UTC dipetakan ke tanggal kalender WIB; 17:00Z = tengah malam WIB berikutnya", () => {
  assert.equal(wibKey(new Date("2026-09-30T16:59:59.999Z")), "2026-09-30");
  assert.equal(wibKey(new Date("2026-09-30T17:00:00.000Z")), "2026-10-01");
  assert.equal(wibKey(new Date("2026-12-31T17:30:00.000Z")), "2027-01-01");
  assert.equal(wibKey(null), null);
  assert.equal(startOfWibDay("2026-10-01").toISOString(), "2026-09-30T17:00:00.000Z");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01"); assert.equal(addDays("2028-02-28", 1), "2028-02-29"); assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("parsePeriod: batas inklusif WIB, hari dihitung, default 30 hari, dan validasi (kalender nyata, urutan, maksimum 366 hari)", () => {
  const p = parsePeriod({ from: "2026-10-01", to: "2026-10-20" });
  assert.equal(p.days, 20); assert.equal(p.start.toISOString(), "2026-09-30T17:00:00.000Z"); assert.equal(p.endExclusive.toISOString(), "2026-10-20T17:00:00.000Z");
  const d = parsePeriod({ now: new Date("2026-10-20T20:00:00.000Z") }); // 21 Okt 03:00 WIB
  assert.equal(d.to, "2026-10-21"); assert.equal(d.days, 30);
  assert.equal(parsePeriod({ from: "2026-10-05", to: "2026-10-05" }).days, 1);
  assert.equal(parsePeriod({ from: "2028-02-29", to: "2028-03-01" }).days, 2);
  for (const bad of [{ from: "2026-13-01", to: "2026-10-20" }, { from: "2026-02-30", to: "2026-10-20" }, { from: "20261001", to: "2026-10-20" }, { from: "2026-10-20", to: "2026-10-01" }, { from: "2025-01-01", to: "2026-10-20" }, { from: "bukan", to: "tanggal" }]) {
    assert.equal(code(() => parsePeriod(bad)), "REPORT_PERIOD_INVALID", JSON.stringify(bad));
  }
  assert.equal(parsePeriod({ from: "2026-01-01", to: "2026-12-31" }).days, 365);
});

test("ember tren: hari/minggu (Senin)/bulan; satu periode lintas bulan tidak menggandakan ember", () => {
  assert.equal(bucketKey("2026-10-01", "day"), "2026-10-01");
  assert.equal(bucketKey("2026-10-01", "month"), "2026-10");
  assert.equal(bucketKey("2026-10-01", "week"), "2026-09-28"); // Kamis -> Senin
  assert.equal(bucketKey("2026-10-04", "week"), "2026-09-28"); // Minggu -> Senin sebelumnya
  assert.equal(bucketKey("2026-10-05", "week"), "2026-10-05");
  const p = parsePeriod({ from: "2026-09-28", to: "2026-10-12" });
  assert.deepEqual(bucketsOf(p, "week"), ["2026-09-28", "2026-10-05", "2026-10-12"]);
  assert.deepEqual(bucketsOf(p, "month"), ["2026-09", "2026-10"]);
  assert.equal(bucketsOf(p, "day").length, 15);
});

test("statistik: sampel minimum 5, pembulatan 1 desimal, persen & persentil tanpa pembagi nol, menit WIB-agnostik", () => {
  assert.equal(MIN_SAMPLE, 5);
  assert.equal(round1(2.25), 2.3); assert.equal(round1(10), 10);
  assert.equal(pct(1, 3), 33.3); assert.equal(pct(0, 4), 0); assert.equal(pct(3, 0), null);
  assert.equal(percentile([], 0.5), null); assert.equal(percentile([10, 20, 30, 40], 0.5), 20); assert.equal(percentile([10], 0.9), 10);
  assert.equal(minutesBetween("2026-10-01T00:00:00Z", "2026-10-01T01:30:00Z"), 90);
  assert.equal(minutesBetween("2026-10-01T02:00:00Z", "2026-10-01T01:00:00Z"), 0, "tak pernah negatif");
  assert.equal(minutesBetween(null, "2026-10-01T01:00:00Z"), null);
  assert.equal(formatMinutes(null), "—"); assert.equal(formatMinutes(45), "45 mnt"); assert.equal(formatMinutes(95), "1.6 jam"); assert.equal(formatMinutes(3000), "2.1 hari");
});

test("filter: normalisasi, nilai tak dikenal ditolak 400, label filter aktif deterministik", () => {
  assert.ok(Object.values(normalizeFilters({})).every((v) => v === null), "tanpa filter -> semua null");
  const f = normalizeFilters({ station: "TABLE_2", priority: "2", step: "12", status: "SIAP_KIRIM", qc: "PASS", docs: "KURANG" });
  assert.equal(f.station, "TABLE_2"); assert.equal(f.priority, 2); assert.equal(f.step, 12); assert.equal(f.status, "SIAP_KIRIM");
  for (const bad of [{ station: "MEJA_9" }, { step: 13 }, { step: 0 }, { status: "NGAWUR" }, { priority: 9 }, { qc: "?" }, { docs: "?" }, { operator: "bukan-uuid" }, { service: "x y;" }]) {
    assert.equal(code(() => normalizeFilters(bad)), "REPORT_FILTER_INVALID", JSON.stringify(bad));
  }
  const labels = activeFilterLabels(f, { stationLabel: (c) => `Meja ${c.slice(-1)}` });
  assert.ok(labels.length === 6 && labels.some((l) => /Meja 2/.test(l)));
});

test("bucket status: satu status per unit dengan urutan prioritas (siap kirim > menunggu Gudang > perjalanan > tertunda > QC > dikerjakan > terjadwal)", () => {
  const base = { readyAt: null, finishedAt: null, runStatus: "ACTIVE", opStatus: null, openShortage: false, phase: "PROCESS", plannedDate: null, startedAt: null };
  assert.equal(statusBucketOf({ ...base, readyAt: new Date(), finishedAt: new Date() }), "SIAP_KIRIM");
  assert.equal(statusBucketOf({ ...base, finishedAt: new Date() }), "MENUNGGU_GUDANG");
  assert.equal(statusBucketOf({ ...base, runStatus: "PENDING_ARRIVAL" }), "DALAM_PERJALANAN");
  assert.equal(statusBucketOf({ ...base, opStatus: "PAUSED" }), "TERTUNDA");
  assert.equal(statusBucketOf({ ...base, opStatus: "BLOCKED" }), "TERTUNDA");
  assert.equal(statusBucketOf({ ...base, openShortage: true, opStatus: "ACTIVE" }), "TERTUNDA", "kekurangan bahan terbuka mengalahkan operasi aktif");
  assert.equal(statusBucketOf({ ...base, phase: "QC" }), "MENUNGGU_QC");
  assert.equal(statusBucketOf({ ...base, opStatus: "ACTIVE" }), "DIKERJAKAN");
  assert.equal(statusBucketOf({ ...base, plannedDate: "2026-10-20" }), "TERJADWAL");
  assert.equal(statusBucketOf({ ...base, plannedDate: "2026-10-20", startedAt: new Date() }), "DIKERJAKAN");
  for (const k of ["SIAP_KIRIM", "MENUNGGU_GUDANG", "DALAM_PERJALANAN", "TERTUNDA", "MENUNGGU_QC", "DIKERJAKAN", "TERJADWAL"]) assert.ok(STATUS_BUCKETS[k], k);
});

test("definisi metrik: kunci unik, tiap metrik punya rumus + dasar tanggal + jenis; tanpa metrik keuangan", () => {
  const keys = METRICS.map((m) => m.key); assert.equal(new Set(keys).size, keys.length); assert.equal(Object.keys(METRIC_BY_KEY).length, keys.length);
  for (const m of METRICS) { assert.ok(m.label && m.formula && m.basis && ["count", "rate", "avg"].includes(m.kind), m.key); assert.equal(/omzet|harga|bayar|hpp|laba|margin/i.test(`${m.label} ${m.formula}`), false, `${m.key} bocor ke keuangan`); }
  for (const m of METRICS.filter((x) => x.kind === "count")) assert.ok(m.unit, m.key);
  for (const required of ["target_vs_done", "units_in", "units_scheduled", "in_progress", "delayed", "late_open", "waiting_material", "waiting_qc", "waiting_return", "tat_arrival_ready", "on_time", "qc_first_pass", "rework_rate", "doc_completeness", "material_adherence", "extra_material", "returns_pending", "waste_units", "attention"]) assert.ok(METRIC_BY_KEY[required], required);
});

test("target harian historis: berlaku mulai effective_from, kembar tanggal = createdAt terbaru, sebelum target pertama = konfigurasi; catatan menyebut sumbernya", () => {
  const rows = [
    { effectiveFrom: "2026-10-11", targetUnits: 20, createdAt: "2026-10-01T00:00:00Z" },
    { effectiveFrom: "2026-10-05", targetUnits: 15, createdAt: "2026-10-01T00:00:00Z" },
    { effectiveFrom: "2026-10-11", targetUnits: 18, createdAt: "2026-10-02T00:00:00Z" }, // koreksi di tanggal yang sama menang
  ];
  const r = buildTargetResolver(rows, 12);
  assert.equal(r.targetFor("2026-10-04"), 12); assert.equal(r.recorded("2026-10-04"), false);
  assert.equal(r.targetFor("2026-10-05"), 15); assert.equal(r.targetFor("2026-10-10"), 15);
  assert.equal(r.targetFor("2026-10-11"), 18); assert.equal(r.targetFor("2027-01-01"), 18); assert.equal(r.recorded("2026-10-11"), true);
  const d = describeTargets(r, parsePeriod({ from: "2026-10-03", to: "2026-10-12" }));
  assert.equal(d.perDay, "12–18"); assert.deepEqual(d.segments.map((s) => [s.from, s.to, s.units, s.source]), [["2026-10-03", "2026-10-04", 12, "konfigurasi"], ["2026-10-05", "2026-10-10", 15, "tercatat"], ["2026-10-11", "2026-10-12", 18, "tercatat"]]);
  assert.match(d.note, /tercatat historis: 12\/hari 2026-10-03–2026-10-04 \(konfigurasi sistem/); assert.match(d.note, /18\/hari 2026-10-11–2026-10-12/);
  const none = describeTargets(buildTargetResolver([], 12), parsePeriod({ from: "2026-10-03", to: "2026-10-12" }));
  assert.equal(none.perDay, 12); assert.match(none.note, /belum tersimpan historis untuk periode ini/);
  const uniform = describeTargets(buildTargetResolver([{ effectiveFrom: "2026-01-01", targetUnits: 14, createdAt: "2026-01-01T00:00:00Z" }], 12), parsePeriod({ from: "2026-10-03", to: "2026-10-12" }));
  assert.equal(uniform.perDay, 14);
});

test("computeMetrics: target = jumlah target tiap hari aktif menurut target yang berlaku pada hari itu (bukan satu angka × hari)", () => {
  const p = parsePeriod({ from: "2026-10-01", to: "2026-10-10" });
  const mkFact = (planned) => ({ runId: planned, plannedDate: planned, finishedAt: null, arrivedAt: null, startedAt: null, readyAt: null, qc: { firstAt: null, count: 0, fails: 0 }, docs: { required: 0 }, materials: [], returns: { pending: 0 }, waste: [], statusBucket: "TERJADWAL", activeInPeriod: () => true, lateOpen: () => false, attentionReasons: () => [] });
  const facts = ["2026-10-02", "2026-10-06"].map(mkFact);
  const resolver = buildTargetResolver([{ effectiveFrom: "2026-10-05", targetUnits: 20, createdAt: "2026-10-01T00:00:00Z" }], 12);
  const m = computeMetrics(facts, p, { dailyTarget: 12, now: new Date("2026-10-10T00:00:00Z"), targetFor: resolver.targetFor }).target_vs_done;
  assert.equal(m.target, 12 + 20); assert.equal(m.activeDays, 2); assert.equal(m.dailyTarget, null); assert.equal(m.targetDesc, "12–20/hari × 2 hari aktif");
  const flat = computeMetrics(facts, p, { dailyTarget: 12, now: new Date("2026-10-10T00:00:00Z") }).target_vs_done;
  assert.equal(flat.target, 24); assert.equal(flat.dailyTarget, 12);
});
