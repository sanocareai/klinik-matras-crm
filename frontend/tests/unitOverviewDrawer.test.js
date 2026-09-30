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

test("Unit 360: 6 bagian wajib (Ringkasan, Proses, Bahan, Dokumentasi, QC & Handoff, Aktivitas)", () => {
  for (const label of ["Ringkasan", "Proses", "Bahan", "Dokumentasi", "QC & Handoff", "Aktivitas"]) {
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

test("Status Produksi & Rencana Produksi: keduanya membuka UnitOverviewDrawer yang SAMA (bukan komponen detail terpisah)", () => {
  assert.match(STATUS_PRODUKSI, /import\s*\{\s*UnitOverviewDrawer\s*\}\s*from\s*"@\/features\/production\/UnitOverviewDrawer\.jsx"/);
  assert.match(RENCANA_PRODUKSI, /import\s*\{\s*UnitOverviewDrawer\s*\}\s*from\s*"@\/features\/production\/UnitOverviewDrawer\.jsx"/);
});

test("Status Produksi & Rencana Produksi: deep-link via ?unit= disinkronkan lewat useSearchParams (bisa dibagikan & kembali ke tab asal)", () => {
  for (const src of [STATUS_PRODUKSI, RENCANA_PRODUKSI]) {
    assert.match(src, /useSearchParams/);
    assert.match(src, /searchParams\.get\("unit"\)/);
    assert.match(src, /next\.set\("unit", unitId\)/);
    assert.match(src, /next\.delete\("unit"\)/);
  }
});

test("Status Produksi & Rencana Produksi: aksi tulis lama (Jadwalkan/Layanan, Kelola Rencana) TETAP ada, dijangkau dari dalam Unit 360 (bukan dihapus)", () => {
  assert.match(STATUS_PRODUKSI, /manageLabel="Kelola Jadwal \/ Layanan"/);
  assert.match(STATUS_PRODUKSI, /onManage=\{\(\) => \{ const item = allItems\.find/);
  assert.match(RENCANA_PRODUKSI, /manageLabel="Kelola Rencana"/);
  assert.match(RENCANA_PRODUKSI, /onManage=\{\(\) => openManageFor\(overviewUnitId\)\}/);
});

// Regresi P9C §6: <section> yang jadi grid item langsung (anak dari `grid md:grid-cols-*`) punya
// min-width:auto bawaan CSS Grid, jadi tidak pernah menyusut di bawah lebar konten terlebarnya
// (badge/nama panjang whitespace-nowrap) walau grid-nya sendiri sudah 1 kolom di mobile —
// "grid blowout". Diukur nyata via Puppeteer 390px: .page-body scrollWidth 939 vs clientWidth 390,
// 26-28 tombol keluar viewport. Kalau min-w-0 ini dihapus lagi dari <section>, bug ini kembali.
test("Status Produksi & Rencana Produksi: <section> grid item punya min-w-0 (cegah CSS Grid blowout di mobile)", () => {
  assert.match(
    STATUS_PRODUKSI,
    /<section key=\{col\.key\} aria-label=\{col\.label\} className="flex min-w-0 flex-col/,
    "<section> board Status Produksi kehilangan min-w-0 — akan overflow horizontal di mobile"
  );
  assert.match(
    RENCANA_PRODUKSI,
    /className=\{`flex min-w-0 flex-col gap-2 rounded-card bg-inset p-3/,
    "<section> board Rencana Produksi kehilangan min-w-0 — akan overflow horizontal di mobile"
  );
});
