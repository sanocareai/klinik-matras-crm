// Fase Pipeline (31 Okt 2026): palet tahap bersama (satu sumber), layout papan, fungsi dipertahankan.
// Tes statis atas sumber + fungsi murni; tampilan & interaksi (drag/drop, filter, tabel) terukur di browser terpisah.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAGE_VARIANT, STAGE_LABELS, PIPELINE_STAGES, stageVariant, stageClass, stageDotVar,
  ORDER_STATUS_VARIANT, PAYMENT_STATUS_VARIANT,
} from "../src/utils/format.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const palet = baca("src/styles/stage-palette.css");
const css = baca("src/styles/sanss-crm-pipeline.css");
const cssTanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, "");
const halaman = baca("src/pages/Pipeline.jsx");
const kartu = baca("src/features/pipeline/components/KanbanCard.jsx");
const badge = baca("src/components/ui/badge.jsx");

const TAHAP = ["NEW", "PROSPECT", "TRANSACTION", "REVIEWED", "SPAM"];

test("Label, enum, dan urutan tahap TIDAK berubah", () => {
  assert.deepEqual(Object.keys(STAGE_LABELS), TAHAP);
  assert.deepEqual(STAGE_LABELS, { NEW: "New", PROSPECT: "Prospek / Potensi", TRANSACTION: "Scheduled / Transaksi", REVIEWED: "Already Reviewed", SPAM: "Spam" });
  assert.deepEqual(PIPELINE_STAGES.map((s) => s.value), TAHAP);
  assert.ok(halaman.includes("const STAGES = PIPELINE_STAGES.map((p) => p.value);"));
});

test("Palet tahap: SATU pemetaan di format.js → variant Badge → token CSS; kelima tahap berbeda", () => {
  assert.deepEqual(STAGE_VARIANT, { NEW: "stage-new", PROSPECT: "stage-prospect", TRANSACTION: "stage-transaction", REVIEWED: "stage-reviewed", SPAM: "stage-spam" });
  assert.equal(new Set(Object.values(STAGE_VARIANT)).size, 5, "tiap tahap warna sendiri (Transaksi dan Reviewed tidak lagi sama)");
  for (const t of TAHAP) {
    assert.equal(stageVariant(t), STAGE_VARIANT[t]);
    assert.ok(badge.includes(`"${STAGE_VARIANT[t]}"`), `Badge punya variant ${STAGE_VARIANT[t]}`);
    assert.ok(palet.includes(`.${STAGE_VARIANT[t]}, [data-stage="${t}"]`), `token ${t}`);
  }
  assert.equal(stageClass("NEW"), "stage-new");
  assert.equal(stageClass("TIDAK-ADA"), "stage-spam", "tahap tak dikenal → netral");
  assert.equal(stageDotVar("PROSPECT"), "var(--stage-prospect-dot)");
});

test("Warna sesuai keputusan: New biru, Prospek amber, Scheduled/Transaksi ungu, Reviewed hijau, Spam abu netral", () => {
  const tonjol = (nama) => palet.match(new RegExp(`--stage-${nama}-dot:\\s*(#[0-9A-Fa-f]{6})`))[1];
  const hue = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return 0; const d = mx - mn; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60); return (h + 360) % 360; };
  const sat = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };
  assert.ok(hue(tonjol("new")) >= 215 && hue(tonjol("new")) <= 235, "biru");
  assert.ok(hue(tonjol("prospect")) >= 35 && hue(tonjol("prospect")) <= 50, "amber");
  assert.ok(hue(tonjol("transaction")) >= 250 && hue(tonjol("transaction")) <= 270, "ungu");
  assert.ok(hue(tonjol("reviewed")) >= 140 && hue(tonjol("reviewed")) <= 160, "hijau");
  assert.ok(sat(tonjol("spam")) < 0.25, "abu netral");
});

// ── kontras teks badge ≥ 4,5:1 (terang: solid; gelap: rgba di atas panel #17182F dan kanvas #0D0E20) ──
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => { const t = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2]; };
const rasio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function token(blok, nama) { return blok.match(new RegExp(`--stage-${nama}:\\s*([^;]+);`))[1].trim(); }
test("Kontras teks badge tahap ≥ 4,5:1 di terang dan gelap", () => {
  const terang = palet.slice(palet.indexOf(":root {"), palet.indexOf(':root[data-theme="dark"]'));
  const gelap = palet.slice(palet.indexOf(':root[data-theme="dark"]'), palet.indexOf("/* Pemetaan"));
  for (const t of ["new", "prospect", "transaction", "reviewed", "spam"]) {
    const r1 = rasio(hex(token(terang, `${t}-fg`)), hex(token(terang, `${t}-bg`)));
    assert.ok(r1 >= 4.5, `terang ${t}: ${r1.toFixed(2)}`);
    for (const latar of ["#17182F", "#0D0E20"]) {
      const [r, g, b, a] = token(gelap, `${t}-bg`).match(/[\d.]+/g).map(Number); const dasar = hex(latar);
      const efektif = [r, g, b].map((v, i) => v * a + dasar[i] * (1 - a));
      const r2 = rasio(hex(token(gelap, `${t}-fg`)), efektif);
      assert.ok(r2 >= 4.5, `gelap ${t} di ${latar}: ${r2.toFixed(2)}`);
    }
  }
});

test("Tidak ada salinan warna tahap per halaman: KanbanCard, Laporan, Dashboard, Pipeline memakai palet bersama", () => {
  assert.ok(!/STAGE_DOT|STAGE_GLOW/.test(kartu.replace(/\/\/.*$/gm, "")), "KanbanCard tanpa peta warna sendiri");
  assert.ok(kartu.includes("stageClass(s)") && kartu.includes("stage-dot"), "titik menu pindah memakai palet bersama");
  const pt = baca("src/features/laporan/components/PipelineTab.jsx");
  assert.ok(!/const STAGE_(BG|BAR|DOT)\s*=/.test(pt) && pt.includes("stageClass(item.stage)"));
  const sb = baca("src/features/laporan/components/StageBySalesCard.jsx");
  assert.ok(sb.includes("stageDotVar(s)") && !/var\(--orange\)|var\(--green\)/.test(sb.slice(0, sb.indexOf("const INFO"))));
  const dash = baca("src/styles/sanss-crm-dashboard.css");
  assert.ok(dash.includes(".crm-dash .crm-pipe-baris[data-stage] { --bar: var(--stage-dot); }") && !/--bar:\s*#/.test(dash.replace(/\/\*[\s\S]*?\*\//g, "").replace("--bar: #99B7FC;", "")));
  assert.ok(!/--stage-(new|prospect|transaction|reviewed|spam)-/.test(cssTanpaKomentar), "CSS Pipeline tidak mendefinisikan/memakai warna tahap mentah");
  assert.ok(baca("src/main.jsx").includes('import "./styles/stage-palette.css";') && baca("src/main.jsx").includes('import "./styles/sanss-crm-pipeline.css";'));
});

test("Warna workflow Order dan status pembayaran TETAP terpisah (tidak memakai varian tahap)", () => {
  for (const v of [...Object.values(ORDER_STATUS_VARIANT), ...Object.values(PAYMENT_STATUS_VARIANT)]) assert.ok(!String(v).startsWith("stage-"), v);
  const oc = baca("src/features/pipeline/components/OrderPipelineBoard.jsx");
  assert.ok(!/stage-|stageClass|stageVariant/.test(oc), "papan berbasis Order tidak tersentuh palet tahap");
});

test("Layout: judul/tindakan utama terpisah dari toolbar; semua kontrol dipertahankan", () => {
  const iToolbar = halaman.indexOf('className="crm-pipe-toolbar'), iHeader = halaman.indexOf("<PageHeader");
  assert.ok(iHeader > 0 && iToolbar > iHeader, "toolbar setelah header");
  const header = halaman.slice(iHeader, iToolbar), toolbar = halaman.slice(iToolbar, halaman.indexOf("<PageErrorBoundary"));
  for (const k of ["Berdasarkan Pelanggan", "Berdasarkan Order", "Papan", "Tabel", "<DateRangePicker", "crm-pipe-export"]) assert.ok(header.includes(k), `header: ${k}`);
  for (const k of ["Cari pelanggan di pipeline", "Filter sales person", "Mandek", "Refresh"]) assert.ok(toolbar.includes(k), `toolbar: ${k}`);
  assert.ok(halaman.includes('<PageContainer fluid className="crm-pipe">'));
  assert.ok(halaman.includes("min-w-[280px]") && halaman.includes("overflow-x-auto"), "kolom berlebar minimum; papan menggulir horizontal");
  assert.ok(!/text-\[(8|9|10)px\]/.test(halaman.slice(halaman.indexOf("return (", halaman.indexOf("export default function Pipeline")))), "tidak mengecilkan teks untuk memuat kolom");
});

test("Fungsi dipertahankan: drag & drop, aturan pindah tahap, menu kartu, tujuan klik, ekspor", () => {
  for (const k of ["onDragOver={(e) => onDragOver(e, stage)}", "onDrop={(e) => onDrop(e, stage)}", "onDragLeave", "api.updateCustomer(card.id, { pipelineStage: toStage })", "function bukaChat(card)", "navigate(`/inbox?conv=${card.conversationId}`)", "navigate(`/customers?id=${card.id}`)", "async function handleExport()", "isStale(c, stage)"]) assert.ok(halaman.includes(k), k);
  for (const k of ["draggable", "onDragStart={onDragStart}", "onDragEnd={onDragEnd}", 'aria-label={`Pindah ${nama} ke stage lain`}', "onMoveToStage(s)", "isStale"]) assert.ok(kartu.includes(k), k);
  assert.ok(kartu.includes("if (!e.currentTarget.contains(e.target)) return;"), "klik item menu (portal) tidak ikut membuka chat");
  assert.ok(halaman.includes("crm-pipe-kosong") && halaman.includes("Seret kartu ke sini"), "tahap kosong = area drop jelas");
});

test("CSS Pipeline: semua aturan di bawah .crm-skin .crm-pipe; tanpa font/@import/url()", () => {
  const sel = cssTanpaKomentar.split("}").map((b) => b.split("{")[0].trim()).filter(Boolean).join(",").split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("@"));
  for (const s of sel) assert.ok(s.includes(".crm-skin .crm-pipe"), `selektor di luar halaman: ${s}`);
  assert.ok(!/font-family|@font-face|@import|url\(/.test(cssTanpaKomentar));
});

test("PWA tidak tersentuh oleh perubahan ini (konfigurasi, manifest, service worker)", () => {
  const vite = baca("vite.config.js");
  assert.ok(vite.includes('display: "standalone"') && vite.includes("injectManifest") && !/stage-palette|sanss-crm-pipeline/.test(vite));
});

test("HP: toolbar ringkas — pencarian selalu terlihat, Sales/Mandek/Refresh sejajar, Refresh tombol ikon berlabel aksesibel, sentuh 44px, teks tidak diperkecil", () => {
  const hp = css.slice(css.indexOf("@media (max-width: 767px) {", css.indexOf("6. HP")));
  assert.ok(hp.includes(".crm-pipe-cari-wadah { flex: 1 1 100%;") && hp.includes(".crm-pipe-cari { height: 44px; }"));
  assert.ok(hp.includes(".crm-pipe-refresh { width: 44px; height: 44px !important;") && hp.includes(".crm-pipe-refresh-teks { display: none; }"));
  assert.ok(hp.includes(".crm-pipe-mandek { height: 44px !important;") && hp.includes("[aria-label=\"Filter sales person\"] { flex: 1 1 0;"));
  assert.ok(halaman.includes('aria-label="Refresh papan pipeline"') && halaman.includes('<span className="crm-pipe-refresh-teks">Refresh</span>'));
  assert.ok(!/font-size/.test(hp.slice(hp.indexOf("Toolbar HP"))), "blok toolbar HP tidak mengubah ukuran teks");
});
