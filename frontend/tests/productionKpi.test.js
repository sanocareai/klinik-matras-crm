// P11 — KPI Produksi & Gudang (frontend): model murni (format, query, preset WIB, tab menurut izin) + pagar kode halaman.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPORTABLE, FILTER_FIELDS, INSUFFICIENT, activeFilterCount, coverageChips, emptyFilters, formatCell, formatMinutes, groupMetrics, metricView, offMessage,
  reportQuery, targetFormError, sensitiveLeak, tabsFor, trendSeries, trendTick, wibStamp,
} from "../src/features/production/reporting.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");

test("format sel = backend: kosong '—', angka id-ID, waktu WIB, tanggal 10 karakter", () => {
  assert.equal(formatCell(null, "angka"), "—"); assert.equal(formatCell("", "teks"), "—"); assert.equal(formatCell(undefined, "waktu"), "—");
  assert.equal(formatCell(1234.5, "angka"), "1.234,5"); assert.equal(formatCell(0, "angka"), "0");
  assert.equal(wibStamp("2026-09-30T17:30:00.000Z"), "2026-10-01 00:30 WIB"); assert.equal(formatCell("2026-09-30T17:30:00.000Z", "waktu"), "2026-10-01 00:30 WIB");
  assert.equal(formatCell("2026-10-05T00:00:00.000Z", "tanggal"), "2026-10-05"); assert.equal(formatCell("x", "teks"), "x");
  assert.equal(formatMinutes(null), "—"); assert.equal(formatMinutes(45), "45 mnt"); assert.equal(formatMinutes(95), "1.6 jam"); assert.equal(formatMinutes(3000), "2.1 hari");
});

test("kartu KPI: nilai null = 'Data belum cukup' + alasan; hitungan tetap angka; target & persen dijelaskan", () => {
  const miss = metricView({ key: "qc_first_pass", unit: "%", kind: "rate", value: null, n: 2, reason: "Data belum cukup (n=2, minimal 5)" });
  assert.equal(miss.text, INSUFFICIENT); assert.equal(miss.insufficient, true); assert.match(miss.sub, /n=2, minimal 5/);
  assert.deepEqual(metricView({ key: "units_in", unit: "unit", kind: "count", value: 0, n: 0 }), { text: "0", sub: "", insufficient: false });
  assert.equal(metricView({ key: "on_time", unit: "%", kind: "rate", value: 83.3, n: 6 }).text, "83,3%");
  assert.equal(metricView({ key: "tat", unit: "menit", kind: "avg", value: 95, n: 7 }).text, "1.6 jam");
  const t = metricView({ key: "target_vs_done", unit: "unit", kind: "count", value: 20, target: 120, dailyTarget: 12, activeDays: 10, achievementPct: 16.7 });
  assert.equal(t.text, "20"); assert.match(t.sub, /Target 120 \(12\/hari × 10 hari aktif\) · 16,7%/);
  assert.equal(metricView(null).text, "—");
});

test("kelompok metrik mempertahankan urutan server", () => {
  const g = groupMetrics([{ group: "Target", key: "a" }, { group: "Arus", key: "b" }, { group: "Target", key: "c" }]);
  assert.deepEqual(g.map((x) => [x.group, x.items.map((i) => i.key)]), [["Target", ["a", "c"]], ["Arus", ["b"]]]);
});

test("tab menurut izin: penuh = 5 tab; Gudang = Gudang saja; PIC/QC/Dokumentasi = Ringkasan Saya; tanpa izin = kosong", () => {
  assert.deepEqual(tabsFor({ summary: true, stations: true, operators: true, units: true, warehouse: true, self: true }).map((t) => t.key), ["ringkasan", "meja", "pic", "gudang", "laporan"]);
  assert.deepEqual(tabsFor({ summary: false, stations: false, operators: false, units: false, warehouse: true, self: false }).map((t) => t.key), ["gudang"]);
  assert.deepEqual(tabsFor({ warehouse: false, self: true }).map((t) => t.key), ["saya"]);
  assert.deepEqual(tabsFor({}), []); assert.deepEqual(tabsFor(undefined), []);
});

test("query SATU-SATUNYA: kunci kosong dibuang, urutan deterministik, tambahan (granularity/report/format) ikut", () => {
  const f = { ...emptyFilters(), station: "TABLE_2", qc: "PASS" };
  assert.equal(reportQuery({ from: "2026-10-01", to: "2026-10-20" }, f), "from=2026-10-01&to=2026-10-20&station=TABLE_2&qc=PASS");
  assert.equal(reportQuery({ from: "2026-10-01", to: "2026-10-20" }, emptyFilters(), { granularity: "week", report: "summary", format: "xlsx", metric: "" }), "from=2026-10-01&to=2026-10-20&granularity=week&report=summary&format=xlsx");
  assert.equal(activeFilterCount(f), 2); assert.equal(activeFilterCount({}), 0); assert.deepEqual(Object.keys(emptyFilters()), FILTER_FIELDS);
  assert.equal(reportQuery({}, { station: 0 }), "station=0", "nilai 0 (prioritas) tetap dikirim");
});

test("tren & cakupan & reader OFF & kebocoran data sensitif", () => {
  assert.deepEqual(trendSeries({ rows: [{ bucket: "2026-10-01", masuk: 2, terjadwal: null, selesai: 1 }] }), [{ bucket: "2026-10-01", masuk: 2, terjadwal: 0, selesai: 1 }]);
  assert.deepEqual(trendSeries(null), []);
  assert.equal(trendTick("2026-10-05", "day"), "05/10"); assert.equal(trendTick("2026-10", "month"), "2026-10");
  const chips = coverageChips({ coverage: { cohortUnits: 40, runsInCohort: 39, runsAfterFilters: 10, totalV2Units: 41, period: { from: "2026-10-01", to: "2026-10-20", days: 20 }, timezone: "WIB (UTC+7)" } });
  assert.deepEqual(chips.map((c) => c.key), ["cohort", "runs", "filtered", "total", "period", "tz"]); assert.equal(chips[4].value, "2026-10-01 s/d 2026-10-20 (20 hari)");
  assert.deepEqual(coverageChips({}), []);
  assert.match(offMessage({ readerMode: "OFF" }), /belum aktif/); assert.equal(offMessage({ readerMode: "COHORT" }), null);
  assert.equal(sensitiveLeak({ a: "Kode Unit" }), false); assert.equal(sensitiveLeak({ omzet: 1 }), true); assert.equal(sensitiveLeak({ x: "pembayaran" }), true);
  assert.deepEqual(EXPORTABLE, { ringkasan: "summary", meja: "stations", pic: "operators", gudang: "warehouse", laporan: "units" });
});

test("pagar kode halaman: baca-saja (tanpa metode tulis), semua angka dari server, rute+menu+judul terpasang, OPERASIONAL tetap 5 menu", () => {
  const page = read("src/pages/bengkel/ProductionKpi.jsx"); const parts = read("src/features/production/ReportParts.jsx"); const model = read("src/features/production/reporting.js");
  for (const src of [page, parts, model]) {
    assert.doesNotMatch(src, /method:\s*"(POST|PUT|PATCH|DELETE)"/, "laporan tidak menulis");
    assert.doesNotMatch(src, /\.(omzet|harga|payment|hpp|orderPrice|totalHarga)\b|api\.\w*(Payment|Finance|Harga)/i, "tidak membaca field/endpoint keuangan");
  }
  const api = read("src/api.js"); const block = api.slice(api.indexOf("getProductionReportMeta"), api.indexOf("// P11.1 — target harian historis"));
  assert.doesNotMatch(block, /method:/, "klien API laporan hanya GET");
  assert.match(block, /exportProductionReport/);
  assert.match(page, /UnitOverviewDrawer/, "drill-down ke Unit 360");
  assert.match(page, /getProductionReportDrill/); assert.match(page, /warehouse\/units\//); assert.match(page, /stations\/\$\{/); assert.match(page, /operators\/\$\{/);
  assert.match(parts, /data-testid="coverage-bar"/); assert.match(parts, /data-testid="export-buttons"/); assert.match(parts, /Data belum cukup/);
  const registry = read("src/routes/pageRegistry.jsx");
  assert.match(registry, /path: "\/bengkel\/kpi"/); assert.match(registry, /path: "\/warehouse\/kpi", render: \(\) => <DemoPage><ProductionKpi defaultTab="gudang" \/><\/DemoPage>/); assert.match(registry, /path: "\/produksi\/ringkasan-saya"/);
  assert.match(page, /makeRange/, "periode memakai skema tanggal standar app");
  assert.match(parts, /DateRangePicker/); assert.doesNotMatch(parts, /type="date"/, "tanpa input tanggal native");
  assert.match(read("src/components/Topbar.jsx"), /"\/bengkel\/kpi":\s*\["Produksi", "KPI Produksi"\]/);
  assert.match(read("src/components/Layout.jsx"), /\/warehouse\/kpi/);
});

test("P11.1 target harian: kartu memakai deskripsi target historis dari server; validasi formulir; panel baca-saja kecuali izin tulis; satu-satunya POST di klien", () => {
  const varTarget = metricView({ key: "target_vs_done", unit: "unit", kind: "count", value: 20, target: 320, dailyTarget: null, targetDesc: "12–18/hari × 20 hari aktif", activeDays: 20, achievementPct: 6.3 });
  assert.match(varTarget.sub, /Target 320 \(12–18\/hari × 20 hari aktif\) · 6,3%/);
  const meta = { minEffectiveDate: "2026-01-01", maxTargetUnits: 500 };
  const ok = { effectiveFrom: "2026-10-11", targetUnits: "20", reason: "Tambah satu shift" };
  assert.equal(targetFormError(ok, meta), "");
  for (const bad of [{ effectiveFrom: "" }, { effectiveFrom: "2025-12-31" }, { targetUnits: "0" }, { targetUnits: "501" }, { targetUnits: "12.5" }, { targetUnits: "" }, { reason: "x" }, { reason: "   " }, { reason: "x".repeat(301) }]) assert.notEqual(targetFormError({ ...ok, ...bad }, meta), "", JSON.stringify(bad));
  const panel = read("src/features/production/TargetPanel.jsx"); const api = read("src/api.js"); const page = read("src/pages/bengkel/ProductionKpi.jsx");
  assert.match(panel, /canWrite && \(/, "formulir hanya untuk pemegang izin tulis"); assert.match(panel, /tidak dapat diubah atau dihapus/);
  assert.match(page, /TargetPanel canWrite=\{!!meta\?\.capabilities\?\.targetWrite\}/);
  const posts = api.match(/production-v2\/[a-z/]*",\s*\{\s*method: "POST"/g) || [];
  assert.match(api, /setProductionTarget: \(data\) => request\("\/production-v2\/targets", \{ method: "POST"/); assert.ok(posts.length >= 1);
  assert.doesNotMatch(panel, /method: "(PUT|PATCH|DELETE)"/, "riwayat tidak bisa diubah/dihapus dari UI");
});

test("P12A: tab KPI memakai state lokal (klik tab bekerja di sistem tab dalam-app) dan panel hanya dirender bila jenis dokumen = jenis tab (tanpa crash saat data tab sebelumnya masih ada)", () => {
  const page = read("src/pages/bengkel/ProductionKpi.jsx");
  assert.match(page, /const \[tabKey, setTabKey\] = useState\(urlTab\)/); assert.match(page, /const setTab = \(key\) => \{ setTabKey\(key\);/);
  assert.match(page, /doc\.kind === tab\?\.kind/);
  assert.match(page, /doc\.pekerjaan && <MyPanel/);
});
