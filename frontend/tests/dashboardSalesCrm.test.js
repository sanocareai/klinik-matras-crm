// Dashboard Sales CRM (redesain 31 Okt 2026): kartu KPI berwarna, ikon SVG, panel komplain ringkas, lingkup CSS, font tidak berubah.
// Tes statis atas sumber (tanpa browser): menjaga data/rumus Dashboard tidak bergeser dan aturan CSS tetap terbatas ke .crm-dash.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const dash = baca("src/pages/Dashboard.jsx");
const tile = baca("src/features/dashboard/components/KpiTile.jsx");
const css = baca("src/styles/sanss-crm-dashboard.css");
const tema = baca("src/styles/sanss-crm.css");
const komplain = baca("src/features/complaints/ActiveComplaintsWidget.jsx");
const main = baca("src/main.jsx");

test("Dashboard: empat KpiTile berwarna (revenue, leads, orders, conversion); StatCard tidak lagi dipakai di sini", () => {
  assert.ok(!/StatCard/.test(dash.replace(/\/\/.*$/gm, "")), "StatCard sudah tidak dipakai di Dashboard");
  for (const tone of ["revenue", "leads", "orders", "conversion"]) assert.ok(dash.includes(`tone="${tone}"`), tone);
  assert.equal((dash.match(/<KpiTile/g) || []).length, 4);
  // urutan mengikuti acuan: Revenue → Leads → Orders → Conversion
  const urut = ["revenue", "leads", "orders", "conversion"].map((t) => dash.indexOf(`tone="${t}"`));
  assert.deepEqual([...urut].sort((a, b) => a - b), urut);
  assert.ok(dash.includes('<PageContainer fluid className="crm-dash">'), "lingkup .crm-dash");
});

test("Dashboard: data, rumus, dan tooltip tetap (tidak ada perubahan perhitungan)", () => {
  for (const k of [
    "ov?.totalOrderValue", "ov?.newCustomers", "ov?.totalOrders", "ov?.growthOrderValue", "ov?.growthCustomers", "ov?.growthOrders", "ov?.growthConversion",
    "Math.round((ov.customersWithOrders / ov.totalCustomers) * 100)", "setLeadsModal({ date: todayStr(), session: \"all\" })", "formatRupiahShort",
    "Total nilai order MASUK di periode yang dipilih", "Jumlah order yang dibuat di periode yang dipilih", "Conversion = (lead di periode ini yang sudah order)",
    "konversiPrevText", "compareLabel(range)",
  ]) assert.ok(dash.includes(k), k);
  for (const l of ['label="Revenue"', 'label="New Leads"', 'label="Total Orders"', 'label="Conversion"']) assert.ok(dash.includes(l), l);
});

test("KpiTile: arah pertumbuhan dibedakan (naik/turun/datar); ikon SVG buatan sendiri tanpa emoji", () => {
  for (const k of ['data-trend={trend}', '"up"', '"down"', '"flat"', "Number.isFinite(delta)", "useCountUp(numericValue)"]) assert.ok(tile.includes(k), k);
  assert.equal((tile.match(/<svg viewBox="0 0 24 24"/g) || []).length >= 4, true, "empat ikon SVG");
  assert.ok(/IkonDompet|IkonOrang|IkonTas|IkonDiagram/.test(tile));
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(tile), "tanpa emoji");
  assert.ok(!/font-family|fontFamily/.test(tile), "tanpa font");
});

test("CSS Dashboard: SEMUA aturan berada di dalam .crm-dash; tanpa font-family; warna kartu sesuai permintaan", () => {
  const tanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // buang pembungkus @media (isi aturannya tetap diperiksa), lalu periksa tiap selektor
  const isi = tanpaKomentar.replace(/@(media|container)[^{]*\{/g, "");
  let n = 0;
  for (const m of isi.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const sel of m[1].split(",").map((x) => x.trim()).filter(Boolean)) { n++; assert.ok(/\.crm-dash(\s|$)/.test(sel), `selektor di luar .crm-dash: ${sel}`); }
  }
  assert.ok(n > 40, "aturan CSS terbaca");
  assert.ok(!/font-family/.test(tanpaKomentar), "tidak mengganti font-family");
  assert.ok(!/@import|@font-face/.test(tanpaKomentar), "tidak mengimpor font");
  assert.ok(!/(^|[;{\s])font\s*:(?!\s*inherit)/m.test(tanpaKomentar), "font: hanya boleh inherit");
  for (const w of ["#3965FA", "#99B7FC", "#E9EBFF", "#E0FFB7", "#1B1B39"]) assert.ok(css.includes(w), w);
  assert.ok(css.includes('.crm-dash .crm-kpi-tile[data-kpi="revenue"]') && css.includes("--kpi-bg: #3965FA; --kpi-ink: #FFFFFF"), "revenue biru, teks putih");
  assert.ok(css.includes("--kpi-bg: #99B7FC") && css.includes("--kpi-bg: #E0FFB7"), "leads & conversion");
  assert.ok(!/\[data-theme="dark"\][^{]*\.crm-kpi-tile/.test(css), "warna kartu KPI tidak diubah oleh mode gelap");
  assert.ok(/data-trend="down"\]\s*\{\s*color:\s*#B3261E/.test(css) && /data-trend="up"\]\s*\{\s*color:\s*#146C2E/.test(css), "turun merah, naik hijau");
  assert.ok(css.includes(".crm-dash .dh-bar-left::after") && css.includes("content: none"), "garis biru menyala di tepi dihilangkan");
  assert.ok(css.includes("min-width: 1360px") && css.includes("repeat(4,") && css.includes("repeat(2,"), "4 / 2 / 1 kolom");
});

test("Panel komplain: mode ringkas opsional; tampilan lama (dashboard divisi lain) tetap; rincian + akses tetap", () => {
  assert.ok(komplain.includes("ringkas = false"), "default false");
  for (const k of ["komplain perlu ditindaklanjuti", "Lihat kasus", "Rincian", "aria-expanded={rinci}", 'navigate("/komplain")', "STATUS_LABEL[c.status]", "c.caseNumber", "CATEGORY_LABEL"]) assert.ok(komplain.includes(k), k);
  assert.ok(komplain.includes("Lihat semua") && komplain.includes("bg-redbg"), "tampilan lama tetap untuk Armada/Produksi/Gudang/Kendali");
  assert.ok(komplain.includes("api.getComplaintCases(currentOwner ? { currentOwner } : {})"), "sumber data & filter sama");
  assert.ok(dash.includes("ringkas />") || /ringkas\s*\/>/.test(dash), "hanya Dashboard Sales yang meminta ringkas");
  for (const lain of ["src/pages/armada/ArmadaDashboard.jsx", "src/pages/bengkel/ProductionRingkasan.jsx", "src/pages/Kendali.jsx", "src/pages/warehouse/WarehouseDashboard.jsx"]) assert.ok(!/<ActiveComplaintsWidget[^>]*\bringkas\b/.test(baca(lain)), `${lain} tetap tampilan lama`);
});

test("Perbaikan regresi rilis pertama: kartu berwarna sendiri tidak diputihkan; ikon menu aktif terlihat", () => {
  assert.ok(tema.includes('[class*="rounded-card"]:not(.kpi-glass-guard):is(:not([class*="bg-"]), .bg-surface)'), "rounded-card berwarna sendiri dikecualikan");
  assert.ok(/sidebar-link\.active \.nav-icon,\n:root \.app-shell\.crm-skin \.sidebar-link\.active \.nav-icon-ai \{ color: #FFFFFF !important/.test(tema), "ikon aktif putih !important (menang atas tokens.css)");
});

test("Sales Overview: data & rentang tetap; garis/area memakai warna tema; kolom samping AOV + Repeat Order", () => {
  const rev = baca("src/features/dashboard/components/RevenueOverview.jsx");
  for (const k of ["api.getRevenueSeries(params)", "points.length < 4", "formatRupiahShort(aov)", "repeatRate", "ChartTip", "formatBucketTick", "crm-so-sisi", "var(--crm-chart, var(--blue-600))"]) assert.ok(rev.includes(k), k);
  assert.ok(!/dh-bar-left/.test(rev), "penanda garis ada di SectionCard, dinonaktifkan lewat CSS Dashboard");
});

test("Impor CSS: berkas Dashboard dimuat setelah tema utama; font tidak diimpor/diubah", () => {
  const i = main.indexOf('import "./styles/sanss-crm.css"'); const j = main.indexOf('import "./styles/sanss-crm-dashboard.css"');
  assert.ok(i > 0 && j > i, "urutan impor");
  assert.ok(!/fontsource/.test(baca("src/styles/sanss-crm-dashboard.css")));
  assert.equal((main.match(/@fontsource/g) || []).length, (baca("src/main.jsx").match(/@fontsource/g) || []).length);
});
