// Redesain Laporan — tab Performa Tim & Pipeline (1 Nov 2026). Penyajian saja: rumus, endpoint, ekspor, definisi, ambang tidak berubah.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const pt = baca("src/features/laporan/components/PerformaTimTab.jsx");
const pl = baca("src/features/laporan/components/PipelineTab.jsx");
const css = baca("src/styles/sanss-crm-laporan.css").replace(/\/\*[\s\S]*?\*\//g, "");
const halaman = baca("src/pages/Laporan.jsx");

test("Performa Tim: 4 KPI (rumus/sumber sama), pendukung dari total yang sudah ada, tooltip & definisi dipertahankan", () => {
  for (const f of [
    'label="Total Percakapan" numericValue={perf?.totalConversations || 0}', "growth={perf?.growthTotalConversations}", 'label="Percakapan Ditangani"', "numericValue={total?.handled || 0}", "growth={salesReport?.growthHandled}",
    'label="Rata-rata Respons"', "numericValue={perf?.avgResponseMinutes || 0}", "format={() => formatDuration(perf?.avgResponseMinutes)}", 'label="Menggantung Sekarang"', "numericValue={salesReport?.stalledNow || 0}",
    "jam operasional (09-21 WIB)", "SENGAJA lintas semua periode", "tidak ikut rentang tanggal yang dipilih",
  ]) assert.ok(pt.includes(f), f);
  assert.match(pt, /numericValue: total\.handledOwn/); assert.match(pt, /numericValue: total\.handledTakeover/); assert.match(pt, /numericValue: total\.slaBreach/);
});

test("Performa Tim: peringatan diringkas tetapi dua definisi tetap terpisah (periode terpilih vs menggantung sekarang) dan kalimat lengkap ada di rincian", () => {
  assert.match(pt, /salesReport\?\.stalledNow > 0/); assert.match(pt, /total\?\.slaBreach > 0/); assert.match(pt, /salesReport\?\.unassignedInPeriod > 0/);
  assert.match(pt, /lintas semua periode/); assert.match(pt, /periode terpilih/);
  for (const k of ["sedang menggantung", "dihitung lintas semua periode, karena beban ini tetap", "ditutup tanpa\n                  dibalas sama sekali", "BELUM DIAMBIL siapa pun", "Ini kebocoran lead yang paling murah untuk diperbaiki."]) assert.ok(pt.includes(k), k);
  assert.equal((pt.match(/<AlertRingkas/g) || []).length, 3);
});

test("Performa Tim: penjualan & respons = dua ukuran terpisah (warna, satuan, sumbu); tanpa kalimat sebab-akibat; satu titik = nilai bertanggal", () => {
  assert.doesNotMatch(pt, /respons lambat berbarengan dengan penjualan turun/);
  assert.match(pt, /tidak menyatakan satu mempengaruhi yang lain/);
  assert.match(pt, /WARNA_PENJUALAN = "var\(--accent\)"/); assert.match(pt, /WARNA_RESPONS = "var\(--crm-resp\)"/);
  assert.match(pt, /Rp · sumbu kiri/); assert.match(pt, /menit · sumbu kanan/);
  assert.match(css, /--crm-resp: #0B8F7E/); assert.match(css, /--crm-resp: #4FD6C3/);
  assert.match(pt, /trenData\.length === 1/); assert.match(pt, /slaTrendData\.length === 1/); assert.match(pt, /pt-satu-titik/);
  for (const k of ["Garis respons terputus = periode tanpa data (bukan 0 menit).", "Garis terputus = periode tanpa data respons (bukan 0 menit).", "Sampel dihitung hanya dari percakapan yang benar-benar sudah dibalas", "Warisan takeover", "TIDAK termasuk\n            closing pribadi Team Lead"]) assert.ok(pt.includes(k), k);
  assert.match(pt, /yAxisId="rupiah"/); assert.match(pt, /yAxisId="menit"/); assert.match(pt, /connectNulls=\{false\}/);
});

test("Performa Tim: tabel Rincian Performa — 5 kolom, Team Lead terpisah, Total tim tanpa rata-rata respons (—), ambang warna respons sama", () => {
  assert.equal((pt.match(/\{ k: "/g) || []).length, 5);
  assert.match(pt, /menit <= 30\) return "baik"/); assert.match(pt, /menit <= 120\) return "biasa"/);
  assert.match(pt, /<td className="crm-pt-redup">—<\/td>/);
  assert.match(pt, /teamLeadRows\.map/); assert.match(pt, /role="region" aria-label="Tabel rincian performa/);
  assert.match(css, /\.crm-ss-gulir \{ overflow-x: auto/);
});

test("Pipeline: posisi saat ini dipisah dari perpindahan selama periode; rumus konversi/persentase/mandek/bottleneck sama; palet tahap bersama", () => {
  assert.match(pl, /Math\.round\(\(item\.count \/ prev\.count\) \* 100\)/);
  assert.match(pl, /\(\(item\.count \/ total\) \* 100\)\.toFixed\(1\)/);
  assert.match(pl, /r\.stage !== "TRANSACTION" && r\.stage !== "REVIEWED" && r\.stage !== "SPAM" && r\.avgDays != null && r\.sample > 0/);
  assert.match(pl, /Posisi saat ini/); assert.ok((pl.match(/data-jenis="periode">Selama periode</g) || []).length === 2, "Kecepatan dan Pergerakan bertanda Selama periode");
  assert.match(pl, /stageDotVar\(/); assert.doesNotMatch(pl, /#3965FA|#F59E0B|#8B5CF6/i);
  for (const f of ["INFO.funnel", "INFO.konversi", "INFO.jumlah", "INFO.nilai", "INFO.persen", "INFO.kecepatan", "INFO.sample", "INFO.pergerakan", "STAGE_INFO[", "Data belum terkumpul", "perpindahan stage yang tercatat sejak", "Tren bulanan masuk", "Total {totalPindah} perpindahan", "beda dari tabel posisi di atas"]) assert.ok(pl.includes(f), f);
  assert.ok(pl.includes('if (hari == null) return "—"'), "null = em-dash, bukan 0 hari");
  assert.doesNotMatch(pl, /KpiCard|ChartCard/, "tidak memakai kartu per stage yang berulang");
});

test("Kedua tab: Laporan.jsx memanggil komponen dengan prop yang sama; endpoint & ekspor tidak disentuh; font tetap Manrope", () => {
  assert.match(halaman, /<PerformaTimTab\s+perf=\{perf\} summary=\{summary\}\s+respTimeSeries=\{respTimeSeries\}\s+channelBreakdown=\{overview\?\.channelBreakdown \|\| \[\]\}\s+salesReport=\{salesReport\} range=\{range\}/);
  assert.match(halaman, /<PipelineTab funnel=\{funnel\} velocity=\{velocity\} \/>/);
  assert.match(halaman, /api\.getAnalyticsPipelineVelocity\(params\)/); assert.match(halaman, /api\.getResponseTimeSeries\(params\)/);
  assert.doesNotMatch(css, /font-family/); assert.doesNotMatch(css, /!important/);
});

test("Pipeline: kolom 'Rasio antar tahap' — pembilang/penyebut dari kode, Spam tidak dibandingkan, tooltip menolak tafsir perpindahan/antarperiode", () => {
  assert.ok(pl.includes("Rasio antar tahap <InfoTooltip"), "judul kolom");
  assert.doesNotMatch(pl, /vs sebelumnya/);
  assert.match(pl, /item\.stage !== "SPAM" && prev && prev\.count > 0 \? Math\.round\(\(item\.count \/ prev\.count\) \* 100\) : null/);
  for (const k of ["pembilang", "penyebut", "BUKAN tingkat perpindahan pelanggan antar tahap", "BUKAN perubahan antarperiode", "Spam bukan kelanjutan tahap Reviewed", "280 di Prospek ÷ 310 di New = 90%"]) assert.ok(pl.includes(k), k);
  assert.match(pl, /\$\{item\.count\.toLocaleString\("id-ID"\)\} ÷ \$\{prev\.count\.toLocaleString\("id-ID"\)\}/, "title sel memuat angka pembilang ÷ penyebut");
  assert.match(css, /100px 156px/);
});

test("Performa Tim: kolom memakai judul lengkap 'Menggantung' (tooltip definisi tetap); nol tanpa chip 'Aman'", () => {
  assert.match(pt, /label: "Menggantung",\s+title: "Menggantung: dia pegang/);
  assert.doesNotMatch(pt, /label: "Mengg\./);
  assert.doesNotMatch(pt, />Aman</);
});
