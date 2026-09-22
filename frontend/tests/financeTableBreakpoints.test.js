// Regresi D-193 (lebar tabel Finance, 22 September 2026).
//
// Diverifikasi lewat harness Puppeteer sekali-jalan (frontend/.qa-tmp/, tidak
// di-commit — lihat laporan tugas) bahwa 5 halaman ini OVERFLOW horizontal di
// viewport 1366px selama kolom sekundernya memakai hideBelow="wide" (muncul
// dari 1366px ke atas, PERSIS di lebar yang paling sempit): total lebar kolom
// tetap (Nomor/Tanggal/Nominal/dst + kolom sekunder yang baru saja "muncul")
// melebihi ruang yang tersisa setelah sidebar+gutter di 1366px. Dipindah ke
// hideBelow="2xl" (muncul dari 1536px) supaya di 1366–1440px kolom sekunder
// tetap tersembunyi dan Keterangan/Nama punya ruang cukup.
//
// Test ini TIDAK bisa merender React (project ini sengaja tidak punya
// jsdom/RTL — lihat architecture.test.js) jadi memindai TEKS sumber JSX,
// sama seperti architecture.test.js. Tujuannya sempit: cegah seseorang
// mengganti "2xl" balik ke "wide" di kelima file ini tanpa sadar
// memunculkan lagi overflow yang sudah dibuktikan lewat pengukuran nyata.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINANCE_DIR = path.join(__dirname, "..", "src", "pages", "finance");

// Halaman yang TERBUKTI overflow di 1366px dengan hideBelow="wide" (diukur
// scrollWidth vs clientWidth lewat QA harness) — kolom sekundernya WAJIB
// pakai breakpoint 2xl (1536px), bukan wide (1366px).
//
// ⚠️ FinanceExpenses.jsx/FinancePurchases.jsx SENGAJA TIDAK ADA di daftar
// ini lagi (dipindah 22 Sep 2026, putaran kedua) — keduanya sekarang pakai
// `useBreakpointTier` (src/hooks/useBreakpointTier.js), BUKAN `hideBelow`
// CSS, untuk kolom Kategori/Divisi/Mode/SumberDana ↔ Klasifikasi/
// Pembayaran. Alasannya lebih dalam dari overflow biasa: `table-layout:
// fixed` MEMATOK lebar kolom dari `width` tiap <td> di baris pertama
// TERLEPAS dari `display:none`-nya (lihat komentar panjang di
// useBreakpointTier.js) — begitu ada 3 representasi kolom sekaligus di DOM
// (terpisah + gabungan + tombol expand), kolom "Keterangan" yang fleksibel
// kehabisan ruang sampai ~24px (bukan cuma overflow, tapi KOLAPS). Lihat
// test terpisah di bawah yang mengunci pola JS ini.
const HARUS_2XL = [
  "FinanceInvoices.jsx",
  "FinancePemasukan.jsx",
  "FinanceSuppliers.jsx",
];

// Halaman dengan kolom GABUNGAN (Klasifikasi/Pembayaran) — WAJIB pakai
// `useBreakpointTier`, TIDAK BOLEH kembali ke `hideBelow`/`mid` CSS untuk
// kolom-kolom itu (lihat penjelasan di atas — kolaps Keterangan, bukan
// cuma overflow, jadi lebih berbahaya dan lebih sering luput dari
// pengecekan scrollWidth/clientWidth polos).
const HARUS_PAKAI_TIER_HOOK = ["FinanceExpenses.jsx", "FinancePurchases.jsx"];

test("D-193b: halaman kolom-gabungan (Klasifikasi/Pembayaran) pakai useBreakpointTier, bukan hideBelow/mid CSS untuk kolom itu", () => {
  for (const nama of HARUS_PAKAI_TIER_HOOK) {
    const src = bacaSumber(nama);
    assert.ok(
      src.includes('from "@/hooks/useBreakpointTier.js"') && src.includes("useBreakpointTier()"),
      `${nama} diharapkan mengimpor & memanggil useBreakpointTier() untuk kolom Kategori/Divisi/Mode/SumberDana ↔ Klasifikasi/Pembayaran.`
    );
    assert.ok(
      !src.includes('hideBelow="uw"') && !src.includes('hideBelow="2xl"') && !/<T[HD]\s[^>]*\bmid\b/.test(src),
      `${nama}: kolom Kategori/Divisi/Mode/SumberDana/Klasifikasi/Pembayaran TIDAK BOLEH pakai hideBelow="uw"/"2xl" atau prop "mid" lagi — itu pola LAMA (3 representasi kolom sekaligus di DOM) yang terbukti mengolapskan kolom Keterangan ke ~24px (lihat komentar panjang di atas test ini & di useBreakpointTier.js). Gunakan cabang tier === "uw"/"mid"/"compact" seperti sekarang.`
    );
  }
});

function bacaSumber(nama) {
  return fs.readFileSync(path.join(FINANCE_DIR, nama), "latin1");
}

test("D-193: halaman yang terbukti overflow di 1366px tidak lagi memakai hideBelow=\"wide\"", () => {
  for (const nama of HARUS_2XL) {
    const src = bacaSumber(nama);
    assert.ok(
      !src.includes('hideBelow="wide"'),
      `${nama} masih memakai hideBelow="wide" — ini yang menyebabkan overflow di 1366px (lihat komentar di atas file test ini). Pakai hideBelow="2xl".`
    );
    assert.ok(
      src.includes('hideBelow="2xl"'),
      `${nama} diharapkan punya kolom sekunder ber-hideBelow="2xl" (kalau strukturnya sudah berubah total, perbarui daftar HARUS_2XL di test ini setelah verifikasi ulang lewat QA harness, jangan hapus test-nya).`
    );
  }
});

// Halaman yang TERBUKTI kolom Aksi-nya bertumpuk (2+ tombol teks berjejer
// dalam kolom lebar tetap — mis. "Setujui"+"Tolak" jadi "SetujuiTolak" satu
// blok teks, dibuktikan lewat screenshot 22 Sep 2026 putaran kedua) — WAJIB
// pakai <RowActions/> (features/finance/RowActions.jsx: satu tombol utama +
// menu titik-tiga), bukan beberapa <Button>/<TombolAksi> berjejer langsung
// di dalam <TD> kolom Aksi.
const HARUS_PAKAI_ROW_ACTIONS = [
  "FinanceExpenses.jsx",
  "FinancePurchases.jsx",
  "FinanceKasbon.jsx",
  "FinancePayments.jsx",
  "FinanceReceivables.jsx",
  "FinanceSuppliers.jsx",
];

test("D-XXX: halaman dengan kolom Aksi ber-multi-tombol pakai <RowActions/>, bukan tombol berjejer langsung", () => {
  for (const nama of HARUS_PAKAI_ROW_ACTIONS) {
    const src = bacaSumber(nama);
    assert.ok(
      src.includes('from "@/features/finance/RowActions.jsx"') && src.includes("<RowActions"),
      `${nama} diharapkan memakai <RowActions/> untuk kolom Aksi (satu tombol utama + menu titik-tiga) — lihat FinanceExpenses.jsx sebagai contoh pola.`
    );
  }
});

test("D-193: 'hideBelow' hanya memakai preset yang didukung tableLayout.js (bukan angka arbitrer)", () => {
  const PRESET_VALID = /hideBelow=\{?"(sm|md|lg|tablet|xl|wide|2xl)"\}?/;
  const files = fs.readdirSync(FINANCE_DIR).filter((f) => f.endsWith(".jsx"));
  for (const nama of files) {
    const src = bacaSumber(nama);
    const matches = src.match(/hideBelow=\{?"[^"]*"\}?/g) || [];
    for (const m of matches) {
      assert.ok(
        PRESET_VALID.test(m),
        `${nama}: "${m}" bukan preset breakpoint yang didukung — lihat HIDE_BELOW_BREAKPOINTS di src/lib/tableLayout.js. Angka px arbitrer TIDAK bisa di-scan Tailwind (class dinamis tidak pernah ter-generate).`
      );
    }
  }
});
