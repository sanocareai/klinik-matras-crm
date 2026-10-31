// Redesain Laporan Analitik Sales CRM, tahap 1: tab Ringkasan & Sales (31 Okt 2026).
// Tes statis atas sumber: pagar CSS, komponen bersama tidak berubah perilaku, metrik/rumus/tujuan klik dipertahankan.
// Tampilan & interaksi terukur terpisah di browser (preview).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const css = baca("src/styles/sanss-crm-laporan.css");
const cssTanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, "");
const halaman = baca("src/pages/Laporan.jsx");
const ringkasan = baca("src/features/laporan/components/RingkasanTab.jsx");
const sales = baca("src/features/laporan/components/SalesReportTab.jsx");
const kpiLap = baca("src/features/laporan/components/KpiLap.jsx");
const alert = baca("src/features/laporan/components/AlertRingkas.jsx");
const barRow = baca("src/features/laporan/components/BarRow.jsx");
const kpiCard = baca("src/features/laporan/components/KpiCard.jsx");
const chartCard = baca("src/features/laporan/components/ChartCard.jsx");
const skeleton = baca("src/features/laporan/components/LaporanSkeleton.jsx");

// Semua pemilih (di luar @media/@container pembungkus) harus berawalan salah satu bentuk .crm-lap
function pemilihTingkatAtas(teks) {
  const hasil = []; let kedalaman = 0; let buf = "";
  for (const ch of teks) {
    if (ch === "{") { if (kedalaman === 0 || /^\s*@(media|container)/.test(buf)) { if (!/^\s*@/.test(buf)) hasil.push(buf.trim()); } else if (kedalaman === 1) hasil.push(buf.trim()); kedalaman++; buf = ""; }
    else if (ch === "}") { kedalaman--; buf = ""; }
    else if (kedalaman === 0 || kedalaman === 1) buf += ch;
  }
  return hasil.filter(Boolean);
}

test("CSS Laporan: setiap aturan terpagari .crm-lap, tanpa font-family, tanpa !important liar", () => {
  const pemilih = pemilihTingkatAtas(cssTanpaKomentar);
  assert.ok(pemilih.length > 30, "ada aturan yang terbaca: " + pemilih.length);
  for (const grup of pemilih) for (const s of grup.split(/,(?![^(]*\))/).map((x) => x.trim())) {
    assert.match(s, /(^|\s)\.crm-lap[\s.:>\[]|\.crm-lap$|\.crm-lap\.crm-dash/, "tidak terpagari: " + s);
  }
  assert.doesNotMatch(cssTanpaKomentar, /font-family/);
  assert.doesNotMatch(cssTanpaKomentar, /!important/);
});

test("Stylesheet diimpor dari Laporan.jsx (bukan main.jsx); wadah memakai .crm-dash + .crm-lap", () => {
  assert.match(halaman, /import "@\/styles\/sanss-crm-laporan\.css"/);
  assert.doesNotMatch(baca("src/main.jsx"), /sanss-crm-laporan/);
  assert.match(halaman, /<PageContainer fluid className="crm-dash crm-lap">/);
});

test("Komponen bersama (KpiCard, ChartCard, LaporanSkeleton) TIDAK diubah; BarRow default = perilaku lama", () => {
  assert.doesNotMatch(kpiCard, /KpiLap|tumpuk|crm-lap/);
  assert.doesNotMatch(chartCard, /crm-lap|tumpuk/);
  assert.doesNotMatch(skeleton, /crm-lap/);
  assert.match(barRow, /tumpuk = false/);
  // tanpa tumpuk, kelas sm: lama tetap dipasang
  for (const kelas of ["sm:flex-row sm:items-center sm:gap-3", "sm:contents", "sm:w-28 sm:flex-none", "sm:order-3 sm:w-24", "sm:order-2 sm:w-auto sm:flex-1"]) {
    assert.ok(barRow.includes(kelas), kelas);
  }
  assert.match(barRow, /!tumpuk &&/);
});

test("Ringkasan: empat KPI, rumus/sumber angka & periode tidak berubah", () => {
  for (const frag of [
    'label="Nilai Penjualan"', "numericValue={uang?.grossValue || 0}", "growth={overview?.growthOrderValue} compareLabel={cmp}",
    'label="Sudah Lunas"', "numericValue={uang?.collectedValue || 0}", "uang.collectedRate}% dari nilai penjualan",
    'label="Belum Lunas"', "numericValue={uang?.outstandingValue || 0}",
    'label="Rata-rata per Order"', "numericValue={uang?.aov || 0}",
    "formatRupiah(Math.round(v))", "computeTeamTarget(targetReport)", "<StageBySalesCard range={range} onGoTab={onGoTab} />", 'onGoTab("Pipeline")',
  ]) assert.ok(ringkasan.includes(frag), frag);
  // panel yang sama seperti versi lama masih ada
  for (const judul of ["Tren Pendapatan", "Konversi", "Aging Piutang", "Order per Status", "Pendapatan per Kategori", "Sumber Lead", "Posisi Pipeline", "Sebaran Kota", "Kampanye Promo", "Target Bulanan Tim"]) {
    assert.ok(ringkasan.includes(judul), judul);
  }
});

test("Peringatan diringkas tetapi teks lengkap tetap tersedia; syarat tampil tidak berubah", () => {
  assert.match(ringkasan, /uang\?\.collectedRate != null && uang\.collectedRate < 40 && uang\.grossValue > 0/);
  assert.match(ringkasan, /summary\?\.integritas\?\.orphanNoOrder > 0/);
  assert.match(ringkasan, /summary\?\.integritas\?\.orphanAllCancelled > 0/);
  assert.match(ringkasan, /Periksa dulu sebelum\s+memakainya sebagai angka penagihan/);
  assert.match(ringkasan, /tidak punya order sama sekali/);
  assert.match(ringkasan, /semua order-nya sudah dibatalkan/);
  // tombol rincian: aksesibel, tertutup di awal
  assert.match(alert, /aria-expanded=\{buka\}/);
  assert.match(alert, /bukaAwal = false/);
  assert.match(alert, /role="alert"/);
});

test("Sales: empat KPI + metrik pendukung, rumus, ekspor, rincian Lunas & tabel dipertahankan", () => {
  for (const frag of [
    'label="Nilai Penjualan Tim"', "numericValue={teamGrossAll}", "growth={report?.growthTeamGrossValue} compareLabel={cmp}",
    'label="Nilai Order yang Menjadi Lunas"', "numericValue={teamCollectedAll}",
    'label="Konversi Tim"', "numericValue={total?.conversionRate || 0}", 'label="Target Tim"', "numericValue={targetInfo.percentToTarget || 0}",
    'label: "AOV Tim"', "numericValue: teamAovAll", 'label: "Chat Spam"', "numericValue: total?.spamCount || 0",
    "onExport({ rekonSales: rekon.data })", "openLunasDetail(r.userId, r.name)", "api.getSalesLunasDetail({ userId, ...toApiParams(range) })",
    "<KartuRekon", "<PanelRekon", "<KartuPenjualanKaryawan range={range} />", 'title="Leaderboard Sales"', 'title="Nilai Penjualan per Sales"', 'title="Rincian Penjualan"',
  ]) assert.ok(sales.includes(frag), frag);
  // 11 kolom metrik tabel rincian (+ kolom Sales) tidak berkurang
  assert.equal((sales.match(/\{ k: "/g) || []).length, 11);
  assert.ok(sales.includes('navigate(`/customers?id=${o.customerId}`)'));
});

test("KpiLap: format pertumbuhan sama dengan KpiCard (tanpa pembulatan baru); data tidak tersedia ≠ nol", () => {
  assert.match(kpiLap, /`\$\{growth > 0 \? "\+" : ""\}\$\{growth\}%`/);
  assert.match(kpiCard, /`\$\{growth > 0 \? "\+" : ""\}\$\{growth\}%`/);
  assert.match(kpiLap, /const adaGrowth = growth !== undefined && growth !== null/);
  assert.match(kpiLap, /numericValue != null/);   // tanpa angka → `value` statis (mis. "—"), tidak dipaksa 0
  assert.match(kpiLap, /PecahAngka/);
});

test("Kolom KPI mengikuti lebar isi tab (container query), 4 kolom hanya ≥1180px", () => {
  assert.match(cssTanpaKomentar, /@container laptab \(min-width: 1180px\)[^}]*repeat\(4/);
  assert.match(cssTanpaKomentar, /@container laptab \(min-width: 600px\)[^}]*repeat\(2/);
});
