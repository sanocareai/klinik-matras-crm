// Dashboard Sales CRM — bagian bawah (Deal Pipeline, Top Performing Reps, Needs Action, Hot Leads, Recent Activity), redesain 31 Okt 2026.
// Tes statis atas sumber: data/aksi tidak bergeser, mode ringkas hanya opt-in (halaman lain tidak berubah), CSS terbatas di .crm-dash, font tidak berubah.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const K = "src/features/dashboard/components/";
const dash = baca("src/pages/Dashboard.jsx");
const pipe = baca(K + "PipelineFunnelCard.jsx");
const reps = baca(K + "TopRepsCard.jsx");
const needs = baca(K + "TaskQueueCard.jsx");
const hot = baca(K + "HotLeadsCard.jsx");
const act = baca(K + "RecentActivityCard.jsx");
const ikon = baca(K + "MiniIkon.jsx");
const css = baca("src/styles/sanss-crm-dashboard.css");

test("Dashboard: bagian bawah memakai grid tanpa peregangan tinggi dan menyalakan mode ringkas", () => {
  assert.equal((dash.match(/className="crm-bawah grid grid-cols-1 gap-4 lg:grid-cols-2"/g) || []).length, 2, "dua baris kartu berpasangan");
  assert.ok(dash.includes("<PipelineFunnelCard range={range} ringkas />"));
  assert.ok(/<RecentActivityCard\s+ringkas\b/.test(dash));
  assert.ok(css.includes(".crm-dash .crm-bawah { align-items: start; }"), "kartu sedikit isi tidak dipaksa setinggi tetangga");
});

test("Mode ringkas hanya opt-in: halaman lain yang memakai kartu ini tidak berubah", () => {
  assert.ok(pipe.includes("ringkas = false") && act.includes("ringkas = false"));
  for (const f of ["src/features/dashboard/components/PipelineWidget.jsx", "src/pages/Portal.jsx", "src/features/orders/ReadinessPanel.jsx"]) {
    const s = baca(f);
    assert.ok(!/<(PipelineFunnelCard|RecentActivityCard)[^>]*\bringkas\b/.test(s), `${f} tidak meminta ringkas`);
  }
  assert.ok(pipe.includes("<Funnel stages={stages} />"), "tampilan corong lama tetap untuk pemakai lain");
  assert.ok(act.includes('className="-mx-2 flex items-center gap-3 rounded-btn px-2 py-2.5'), "daftar lama Recent Activity tetap");
});

test("Deal Pipeline: urutan tahap, sumber data, label, nilai tetap; bar mengikuti jumlah lead; nol tanpa isian", () => {
  for (const k of ['const TAHAP = ["NEW", "PROSPECT", "TRANSACTION", "REVIEWED"]', "api.getAnalyticsPipelineFunnel(params)", "STAGE_LABELS[s]", "formatRupiah(byStage[s]?.value ?? 0)"]) assert.ok(pipe.includes(k), k);
  assert.ok(pipe.includes("{s.count > 0 && <span className=\"crm-pipe-isi\""), "jumlah 0 tidak punya isian");
  assert.ok(pipe.includes("(s.count / maks) * 100") && pipe.includes("Math.max(1, ...stages.map((s) => s.count))"), "panjang bar = jumlah ÷ terbesar");
  for (const c of ["crm-pipe-nama", "crm-pipe-jumlah", "crm-pipe-nilai"]) assert.ok(pipe.includes(c), c);
});

test("Top Performing Reps: urutan, jumlah (5), sumber, nilai, closing, dan tombol Lihat semua sales tetap", () => {
  for (const k of ["api.getSalesReport(params)", "(b.grossValue || 0) - (a.grossValue || 0)", ".slice(0, 5)", "formatRupiah(r.grossValue || 0)", "r.conversionRate == null ? \"—\"", 'navigate("/laporan")', "Lihat semua sales", "<RankBadge rank={i + 1} />", "<Avatar"]) assert.ok(reps.includes(k), k);
  assert.ok(css.includes("text-align: right") && css.includes("font-variant-numeric: tabular-nums"), "angka rata kanan + tabular");
});

test("Needs Action: 4 baris, jenis balas/ambil/follow-up, tujuan klik, tombol Buka Inbox, kondisi kosong pendek", () => {
  for (const k of [".slice(0, 4)", "t.unassigned", ">= 1440", "navigate(`/inbox?conv=${t.id}`)", "Buka Inbox", "formatDurasiRelatif(t.waitingMinutes)", "t.nextAction || j.label", "Semua chat sudah dibalas"]) assert.ok(needs.includes(k), k);
  assert.ok(!/min-h|minHeight|h-\[\d{3}/.test(needs), "tanpa tinggi minimum");
});

test("Hot Leads: nama + skor/nilai baris 1, tahap + keterangan baris 2; akses lead dan Pipeline tetap", () => {
  for (const k of [".slice(0, 4)", "navigate(`/inbox?conv=${l.conversationId}`)", 'navigate("/pipeline")', "Buka Pipeline", "l.valueEstimate ? formatRupiahShort(l.valueEstimate) : `${l.score}`", "STAGE_LABELS[l.stage]", "l.reason", "crm-baris-atas", "crm-baris-bawah"]) assert.ok(hot.includes(k), k);
  assert.ok(hot.indexOf("crm-baris-atas") < hot.indexOf("crm-baris-bawah") && hot.indexOf("{l.name}") < hot.indexOf("STAGE_LABELS[l.stage]"), "urutan baris");
});

test("Recent Activity: lima dulu, Lihat semua membuka sisanya tanpa membuang data; aksi baris tetap", () => {
  assert.ok(act.includes("const AWAL = 5;") && act.includes("list.slice(0, AWAL)"));
  assert.ok(act.includes("aria-expanded={semua}") && act.includes("Lihat semua (${list.length})") && act.includes("Tampilkan lebih sedikit"));
  assert.ok(act.includes("const list = ringkas ? data : data.slice(0, 8);"), "mode ringkas tidak memotong data yang dimuat");
  assert.ok(act.includes("navigate(`/customers?id=${item.customerId}`)") && act.includes("disabled={!item.customerId}"));
  assert.ok(!/min-h-\[|minHeight/.test(act.split("if (ringkas)")[1].split("return (\n    <SectionCard title=\"Recent Activity\">")[0]), "mode ringkas tanpa tinggi minimum");
});

test("Ikon: SVG buatan sendiri (berisi dua warna), bukan emoji; ubin 32px rounded", () => {
  assert.ok((ikon.match(/<svg viewBox="0 0 24 24"/g) || []).length >= 5, "lima ikon SVG");
  assert.ok(ikon.includes("var(--ik-a)") && ikon.includes("var(--ik-b)"));
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(ikon + needs + hot + act + pipe + reps), "tanpa emoji (termasuk teks kondisi kosong)");
  assert.ok(css.includes("width: 32px; height: 32px; border-radius: 10px"));
});

test("CSS bagian bawah: semua selektor di dalam .crm-dash; tanpa font-family; HP satu kolom", () => {
  const tanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const isi = tanpaKomentar.replace(/@media[^{]*\{/g, "");
  for (const m of isi.matchAll(/([^{}]+)\{[^{}]*\}/g)) for (const sel of m[1].split(",").map((x) => x.trim()).filter(Boolean)) assert.ok(/\.crm-dash(\s|$)/.test(sel), `selektor di luar .crm-dash: ${sel}`);
  assert.ok(!/font-family|@import|@font-face/.test(tanpaKomentar), "font tetap Manrope");
  assert.ok(!/min-height\s*:\s*\d{3}/.test(tanpaKomentar), "tanpa tinggi minimum besar");
  assert.ok(css.includes("@media (max-width: 520px)") && css.includes("grid-column: 2 / -1"), "tata letak HP");
});
