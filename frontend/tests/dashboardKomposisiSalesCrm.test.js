// Dashboard Sales CRM — komposisi halaman (revisi 31 Okt 2026, mengikuti referensi): konten penuh, dua baris utama ±65/35, ikon KPI dominan.
// Tes statis atas sumber; tampilan terukur di browser terpisah (lihat laporan).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const dash = baca("src/pages/Dashboard.jsx");
const css = baca("src/styles/sanss-crm-dashboard.css");
const cssTanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, "");
const pipe = baca("src/features/dashboard/components/PipelineFunnelCard.jsx");

test("Konten mengisi ruang setelah sidebar: PageContainer fluid (tanpa max-width) + padding luar 24px", () => {
  assert.ok(dash.includes('<PageContainer fluid className="crm-dash">'));
  assert.ok(css.includes(".crm-dash { padding: 24px; }") && css.includes("@media (max-width: 768px) { .crm-dash { padding: 16px; } }"));
});

test("Urutan: sapaan+tanggal, komplain, KPI, [Sales Overview | Pipeline], [Top Reps | Recent Activity], [Needs Action | Hot Leads]", () => {
  const urut = ["<PageHeader", "<ActiveComplaintsWidget", 'className="crm-kpi-grid"', "<RevenueOverview", "<PipelineFunnelCard", "<TopRepsCard", "<RecentActivityCard", "<TaskQueueCard", "<HotLeadsCard"].map((k) => dash.indexOf(k));
  assert.ok(urut.every((i) => i > 0), "semua ada");
  assert.deepEqual([...urut].sort((a, b) => a - b), urut, "urutan sesuai referensi");
  assert.ok(dash.includes("actions={<DateRangePicker"), "kontrol tanggal di kanan header");
});

test("Grid utama: satu kolom di bawah 1280px; ±65% | ±35% mulai 1280px; tinggi panel diselaraskan; tanpa zoom UI", () => {
  assert.ok(css.includes(".crm-dash .crm-utama { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: stretch; }"));
  assert.ok(css.includes("@media (min-width: 1280px) { .crm-dash .crm-utama { grid-template-columns: minmax(0, 65fr) minmax(0, 35fr); } }"));
  assert.ok(css.includes(".crm-dash .crm-utama > .dh-bar-left { height: 100%; }"));
  assert.ok(!/\bzoom\s*:|transform\s*:\s*scale/.test(cssTanpaKomentar), "tidak mengecilkan UI");
});

test("Sales Overview: kolom AOV/Repeat mengikuti lebar PANEL (container query), bukan lebar layar", () => {
  assert.ok(css.includes("container-type: inline-size") && css.includes("@container (min-width: 520px)"));
  assert.ok(baca("src/features/dashboard/components/RevenueOverview.jsx").includes('<div className="crm-so-c"><div className="crm-so">'));
});

test("KPI: ikon lebih dominan (ubin 60px, SVG 34px, SVG yang sudah ada); judul lebih besar; font tetap", () => {
  assert.ok(css.includes("width: 60px; height: 60px; border-radius: 18px") && css.includes("width: 34px; height: 34px"));
  assert.ok(css.includes("t-card-title { font-size: 20px") && css.includes(".crm-dash h1 { font-size: 32px"));
  assert.ok(!/font-family|@font-face|@import/.test(cssTanpaKomentar));
});

test("Pipeline: nama tahap, jumlah, nilai, urutan, perhitungan bar tetap; label tidak diganti; ikon per tahap", () => {
  for (const k of ['const TAHAP = ["NEW", "PROSPECT", "TRANSACTION", "REVIEWED"]', "STAGE_LABELS[s]", "(s.count / maks) * 100", "{s.count > 0 && "]) assert.ok(pipe.includes(k), k);
  assert.ok(!pipe.includes("Selesai"), "label ilustrasi referensi (Selesai) tidak dipakai");
  for (const c of ["crm-pipe-nama", "crm-pipe-jumlah", "crm-pipe-nilai", "crm-pipe-ikon"]) assert.ok(pipe.includes(c), c);
  assert.ok(css.includes('grid-template-areas: "ikon nama jumlah" "ikon nilai jumlah" ". jalur jalur"'));
});

test("Recent Activity di kolom sempit: teks membungkus terkontrol (maks. 2 baris), waktu tidak menyusut", () => {
  assert.ok(css.includes("-webkit-line-clamp: 2") && css.includes("flex-shrink: 0"));
  assert.ok(baca("src/features/dashboard/components/RecentActivityCard.jsx").includes("const AWAL = 5;"));
});
