// P9C — Unit 360. Project ini sengaja tanpa jsdom/RTL (lihat architecture.test.js) — komponen JSX tidak bisa
// diimpor/dirender di node --test biasa (Node tidak mem-parse JSX). Test ini memindai TEKS sumber, pola SAMA
// dengan tableClampRegression.test.js/financeTableBreakpoints.test.js: mengunci kontrak yang terbukti penting
// (6 bagian wajib, target sentuh 44px mobile, deep-link ?unit=, fallback "Belum dicatat", field ORDER-scoped
// ditandai eksplisit) supaya perubahan berikutnya tidak diam-diam menghapusnya.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRAWER = fs.readFileSync(path.join(__dirname, "..", "src", "features", "production", "UnitOverviewDrawer.jsx"), "utf8");
const STATUS_PRODUKSI = fs.readFileSync(path.join(__dirname, "..", "src", "pages", "bengkel", "ProductionPlannerV2.jsx"), "utf8");
const RENCANA_PRODUKSI = fs.readFileSync(path.join(__dirname, "..", "src", "pages", "bengkel", "ProductionRencanaWorkspace.jsx"), "utf8");
const PROFIL = fs.readFileSync(path.join(__dirname, "..", "src", "features", "production", "workspace", "UnitWorkspace.jsx"), "utf8");

test("Unit 360: 6 bagian wajib (Ringkasan, Pekerjaan, Bahan, Dokumentasi, QC & Serah ke Gudang, Aktivitas) — tab 'Kerja V1' dihapus (Slice 1)", () => {
  assert.ok(!DRAWER.includes("Kerja V1"), "tab Kerja V1 hilang");
  for (const label of ["Ringkasan", "Pekerjaan", "Bahan", "Dokumentasi", "QC & Serah ke Gudang", "Aktivitas"]) {
    assert.ok(DRAWER.includes(`"${label}"`), `bagian "${label}" tidak ditemukan di Unit 360`);
  }
});

test("Unit 360: fallback 'Belum dicatat' untuk field kosong, bukan disembunyikan/ditebak", () => {
  assert.match(DRAWER, /"Belum dicatat"/);
  assert.match(DRAWER, /const bd = \(v, fallback = "Belum dicatat"\)/);
});

test("Unit 360: field ORDER-scoped ditandai eksplisit (bukan disamakan diam-diam dengan data unit)", () => {
  assert.match(DRAWER, /scope === "ORDER"/);
  assert.match(DRAWER, /Data di level Order/);
});

test("Unit 360: target sentuh mobile minimal 44px pada tab dan daftar tahap", () => {
  const hits = DRAWER.match(/min-h-\[44px\]/g) || [];
  assert.ok(hits.length >= 2, `harus ada >=2 elemen dengan min-h-[44px] (tab + item tahap), ditemukan ${hits.length}`);
});

test("Unit 360: sheet penuh layar di mobile (max-sm override posisi/lebar/tinggi modal)", () => {
  for (const cls of ["max-sm:!h-full", "max-sm:!w-full", "max-sm:!rounded-none"]) {
    assert.ok(DRAWER.includes(cls), `class ${cls} tidak ditemukan — sheet mobile tidak full-screen`);
  }
});

test("Unit 360: header sticky/tetap terlihat (tab & foto TIDAK ikut scroll body)", () => {
  assert.match(DRAWER, /overflow-y-auto/, "area konten harus scroll SENDIRI, bukan seluruh drawer");
});

test("Unit 360: harga/order value HANYA dirender bila canSeeValue true", () => {
  assert.match(DRAWER, /data\.permissions\.canSeeValue && data\.orderValue/);
});

test("Unit 360: multi-unit — pesan eksplisit saat job pickup punya >1 unit (tidak diam-diam kosong tanpa penjelasan)", () => {
  assert.match(DRAWER, /isSingleUnitJob === false/);
  assert.match(DRAWER, /tidak diatribusikan otomatis ke unit manapun/);
});

test("Planner & Papan Meja: keduanya membuka PROFIL UNIT yang SAMA (PanelUnit), isi Unit 360 tetap ada di tab Meja & QC", () => {
  for (const s of [STATUS_PRODUKSI, RENCANA_PRODUKSI]) assert.match(s, /import PanelUnit from "@\/features\/production\/rencana\/PanelUnit\.jsx"/);
  assert.match(PROFIL, /<Unit360Isi unitId=\{unitId\} tertanam/);
  assert.match(DRAWER, /export function Unit360Isi\(/); assert.match(DRAWER, /export function UnitOverviewDrawer\(/, "drawer tetap ada untuk halaman di luar Produksi (Order Sales)");
});

test("Status Produksi & Rencana Produksi: deep-link via ?unit= disinkronkan lewat useSearchParams (bisa dibagikan & kembali ke tab asal)", () => {
  for (const src of [STATUS_PRODUKSI, RENCANA_PRODUKSI]) {
    assert.match(src, /useSearchParams/);
    assert.match(src, /searchParams\.get\("unit"\)/);
    assert.match(src, /next\.set\("unit", unitId\)/);
    assert.match(src, /next\.delete\("unit"\)/);
  }
});

test("Planner & Papan Meja: aksi tulis lama (Kelola Jadwal, Kelola Rencana) TETAP ada, sebagai tombol di kepala profil unit (bukan dihapus)", () => {
  assert.ok(STATUS_PRODUKSI.includes('aksiHalaman={{ label: "Kelola Jadwal", onClick: () => { const item = allItems.find'));
  assert.ok(RENCANA_PRODUKSI.includes('aksiHalaman={{ label: "Kelola Rencana", onClick: () => openManageFor(overviewUnitId) }}'));
  assert.ok(PROFIL.includes('data-testid="aksi-halaman">{aksiHalaman.label}'));
});

// Regresi P9C §6: <section> yang jadi grid item langsung (anak dari `grid md:grid-cols-*`) punya
// min-width:auto bawaan CSS Grid, jadi tidak pernah menyusut di bawah lebar konten terlebarnya
// (badge/nama panjang whitespace-nowrap) walau grid-nya sendiri sudah 1 kolom di mobile —
// "grid blowout". Diukur nyata via Puppeteer 390px: .page-body scrollWidth 939 vs clientWidth 390,
// 26-28 tombol keluar viewport. Kalau min-w-0 ini dihapus lagi dari <section>, bug ini kembali.
test("Status Produksi & Rencana Produksi: tidak ada grid-item tanpa min-w-0 di mobile (P9 UX: pipeline hanya md+, chip+satu kolom di layar sempit)", () => {
  // Status: kolom pipeline berdampingan HANYA md+ (kontainer scroll sendiri); di mobile dirender daftar satu kolom tanpa grid.
  assert.match(STATUS_PRODUKSI, /className="hidden gap-3 overflow-x-auto pb-3 md:flex"/, "pipeline desktop harus di kontainer scroll md+ saja");
  assert.match(STATUS_PRODUKSI, /<div className="md:hidden">/, "layar sempit harus punya tampilan satu kolom");
  // Rencana: grid item langsung (backlog, meja-grid, kolom meja) wajib min-w-0 agar tidak blowout.
  assert.ok(RENCANA_PRODUKSI.includes('<div className="grid min-w-0 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">'));
  assert.ok(RENCANA_PRODUKSI.includes("className={`flex min-w-0 flex-col gap-2 rounded-card bg-inset p-2.5"));
  assert.match(RENCANA_PRODUKSI, /<div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2" data-testid="meja-grid">/);
});

// Riwayat lengkap (19 Okt 2026): tab Aktivitas menampilkan SUMBER, NAMA PIC, waktu, dan rincian sebelum → sesudah; filter per sumber; pelaku yang tidak tercatat dinyatakan jujur.
test("tab Aktivitas: sumber (Produksi/Gudang/Sales/Pengiriman), 'oleh <PIC>', rincian sebelum→sesudah, filter per sumber, pelaku tak tercatat dinyatakan jujur", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "features", "production", "UnitOverviewDrawer.jsx"), "utf8");
  assert.match(src, /const SUMBER_LABEL = \{ PRODUKSI: "Produksi", GUDANG: "Gudang", SALES: "Sales", PENGIRIMAN: "Pengiriman" \}/);
  assert.match(src, /data-testid="riwayat-unit"/);
  assert.match(src, /data-testid=\{`riwayat-filter-\$\{k\}`\}/);
  assert.match(src, /data-testid="riwayat-baris"/);
  assert.match(src, /oleh \$\{a\.actor\}/);
  assert.match(src, /pelaku tidak tercatat/);
  assert.match(src, /data-testid="riwayat-detail"/);
  assert.match(src, /Sebelum: \{String\(a\.detail\.sebelum/);
  assert.match(src, /\.slice\(\)\.reverse\(\)/, "terbaru di atas");
});
