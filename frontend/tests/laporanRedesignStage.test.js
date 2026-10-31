// Redesain Laporan — Ringkasan bagian "Sales per Stage" ke bawah (1 Nov 2026). Penyajian saja: rumus/populasi/penyebut tidak berubah.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const stage = baca("src/features/laporan/components/StageBySalesCard.jsx");
const ringkasan = baca("src/features/laporan/components/RingkasanTab.jsx");
const kpiLap = baca("src/features/laporan/components/KpiLap.jsx");
const barRow = baca("src/features/laporan/components/BarRow.jsx");
const css = baca("src/styles/sanss-crm-laporan.css").replace(/\/\*[\s\S]*?\*\//g, "");

test("Sales per Stage: donut & kartu tahap terpisah dihapus; label 'Aman' dihapus (mandek nol = angka)", () => {
  assert.doesNotMatch(stage, /ProgressRing/);
  assert.doesNotMatch(stage, />Aman</);
  assert.doesNotMatch(stage, /xl:grid-cols-5/);
  assert.match(stage, /r\.stale\.toLocaleString\("id-ID"\)/);
});

test("Sales per Stage: panel, angka, tooltip, tautan dan batas awal dipertahankan", () => {
  for (const frag of [
    "Sebaran Tahap", "Perlu Perhatian", "Lead mandek ≥{data.staleDays} hari", "lead New + Prospek", "Nilai order pasti", "Menunggu", "Belum dihitung omset",
    "INFO.nilaiPasti", "INFO.menunggu", "INFO.mandek", "INFO.pctMandek", "INFO.stageValue", "INFO.stageMandek", "INFO.perSales", "STAGE_INFO[s]",
    "const SALES_AWAL = 6", "Tampilkan semua", 'onGoTab("Pipeline")', "Detail pipeline", "data.sales.slice(0, SALES_AWAL)", "Tampilkan lebih sedikit",
    "Total Lead", "STAGE_LABELS[s]", "Nilai", "Mandek",
  ]) assert.ok(stage.includes(frag), frag);
});

test("Sales per Stage: rumus (penyebut New+Prospek, persen, nilai pasti, menunggu) tidak berubah", () => {
  assert.match(stage, /const aktif = \(byStage\.NEW\?\.count \|\| 0\) \+ \(byStage\.PROSPECT\?\.count \|\| 0\)/);
  assert.match(stage, /pctMandek = aktif > 0 \? Math\.round\(\(mandek \/ aktif\) \* 100\) : 0/);
  assert.match(stage, /data\.stages\.reduce\(\(n, s\) => n \+ s\.stale, 0\)/);
  assert.match(stage, /data\.stages\.reduce\(\(n, s\) => n \+ s\.value, 0\)/);
  assert.match(stage, /data\.stages\.reduce\(\(n, s\) => n \+ s\.pendingValue, 0\)/);
  assert.match(stage, /api\.getAnalyticsStageBySales\(toApiParams\(range\)\)/);
});

test("Warna tahap memakai palet bersama; tabel HP digulir di dalam panel, teks tidak dikecilkan", () => {
  assert.match(stage, /stageDotVar\(s\)/);
  assert.doesNotMatch(css, /#(3965FA|F59E0B|8B5CF6)[^;]*;[^}]*crm-ss-titik/i);
  assert.match(css, /\.crm-lap \.crm-ss-gulir \{ overflow-x: auto/);
  assert.match(css, /\.crm-ss-tabel-sales \{ width: 100%; min-width: 900px/);
  assert.match(stage, /role="region" aria-label="Tabel per sales/);
  assert.doesNotMatch(css, /\.crm-ss[^{]*\{[^}]*font-size: (9|10)px/);
});

test("Angka panjang: tidak dikecilkan otomatis sampai sulit dibaca; dipecah di titik ribuan, nilai penuh utuh", () => {
  assert.match(kpiLap, /export function PecahAngka/);
  assert.match(kpiLap, /<wbr \/>/);
  assert.match(css, /data-len="l"\] \.crm-kpi-nilai \{ font-size: clamp\(18px/);
  assert.doesNotMatch(css, /data-len="xl"/);
  assert.match(css, /text-wrap: balance/);
});

test("Order per Status & Pendapatan per Kategori: dua panel sejajar; metrik, definisi, BarRow default lama", () => {
  assert.match(ringkasan, /crm-lap-baris--dua/);
  for (const frag of ["INFO_STATUS", "STATUS_TANPA_OMSET", "masuk omset", "CATEGORY_LABELS", "Layanan vs Kasur Baru vs Sewa", "nilai Menunggu dan Dibatalkan tidak masuk omset"]) assert.ok(ringkasan.includes(frag), frag);
  assert.match(barRow, /lebarSub = "sm:w-16"/);
});

test("Font tetap Manrope: tidak ada font-family di CSS Laporan maupun di komponen Sales per Stage", () => {
  assert.doesNotMatch(css, /font-family/);
  assert.doesNotMatch(stage, /fontFamily|font-family/);
});
