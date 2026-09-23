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

// ⚠️ DIPERBARUI 22 Sep 2026, putaran ketiga (polish tabel produksi) —
// `useBreakpointTier` (window.matchMedia/viewport) DIGANTI `useContainerTier`
// (ResizeObserver/lebar container asli — lihat src/hooks/useContainerTier.js
// untuk bug nyata yang memotivasi ini: viewport lebar ≠ ruang nyata yang
// tabel punya, karena sidebar & tab dalam-app ikut memakan lebar window).
// Susunan kolom Klasifikasi/Pembayaran sekarang PERMANEN digabung di semua
// tier (bukan lagi terpisah di tier "uw") — lihat spesifikasi polish 22 Sep
// 2026 putaran ketiga. Inti perlindungan test ini TIDAK BERUBAH: kolom
// gabungan itu WAJIB didorong oleh hook JS yang mengukur container asli,
// BUKAN kembali ke `hideBelow`/`mid` CSS (viewport-based) — itu pola LAMA
// yang terbukti mengolapskan kolom Keterangan.
const HARUS_PAKAI_TIER_HOOK = ["FinanceExpenses.jsx", "FinancePurchases.jsx"];

test("D-193b: halaman kolom-gabungan (Klasifikasi/Pembayaran) pakai useContainerTier, bukan hideBelow/mid CSS untuk kolom itu", () => {
  for (const nama of HARUS_PAKAI_TIER_HOOK) {
    const src = bacaSumber(nama);
    assert.ok(
      src.includes('from "@/hooks/useContainerTier.js"') && src.includes("useContainerTier()"),
      `${nama} diharapkan mengimpor & memanggil useContainerTier() (bukan useBreakpointTier — lihat komentar di atas test ini) untuk kolom Klasifikasi/Pembayaran.`
    );
    assert.ok(
      !src.includes('hideBelow="uw"') && !src.includes('hideBelow="2xl"') && !/<T[HD]\s[^>]*\bmid\b/.test(src),
      `${nama}: kolom Klasifikasi/Pembayaran TIDAK BOLEH pakai hideBelow="uw"/"2xl" atau prop "mid" lagi — itu pola LAMA (viewport-based, 3 representasi kolom sekaligus di DOM) yang terbukti mengolapskan kolom Keterangan ke ~24px. Gunakan cabang tier === "full"/"reduced"/"minimal"/"card" seperti sekarang.`
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

// ─── BUG PRODUKSI NYATA (24 September 2026) — "Daftar Pengeluaran kosong" ──
//
// Akar masalah: <CardList> (features/finance/cards.jsx) DULU membawa
// `CARD_VIEW_CLASS` ("md:hidden", viewport-based) SEBAGAI DEFAULT BAKU.
// Itu benar untuk pola CSS (TableWrap+CardList SELALU dua-duanya di DOM,
// breakpoint viewport yang memilih) tapi SALAH untuk pola JS
// (`tier === "card" ? <CardList> : <TableWrap>` — ternary, cuma SALAH SATU
// yang pernah mounting). Begitu kontainer sempit (sidebar+tab dalam-app)
// TAPI viewport tetap lebar desktop, `tier` jadi "card" (JS memilih render
// CardList) — tapi class bawaan itu menyembunyikannya LAGI karena viewport
// masih lebar, dan TableWrap SAMA SEKALI TIDAK PERNAH mounting. Hasilnya:
// tabel kosong TOTAL walau API mengembalikan 300 baris penuh.
//
// Perbaikan: `CardList` sekarang NETRAL (tidak membawa class tampil/
// sembunyi apa pun). Pemanggil pola CSS WAJIB menambahkannya sendiri lewat
// className (persis seperti `<TableWrap className={cn("dh-table",
// TABLE_VIEW_CLASS)}>` di pasangannya) — pemanggil pola JS TIDAK BOLEH
// menambahkannya sama sekali (JS ternary sudah cukup, class viewport cuma
// akan membatalkannya lagi seperti bug di atas).

// Halaman pola CSS (TableWrap+CardList SELALU dua-duanya di DOM,
// breakpoint viewport yang memilih) — `<CardList>`-nya WAJIB eksplisit
// `className={CARD_VIEW_CLASS}`, kalau tidak dua-duanya akan tampil
// bersamaan di SEMUA lebar layar (bug berbeda, sama-sama nyata).
const HARUS_CSS_TOGGLE_CARDLIST = ["FinanceKasbon.jsx", "FinancePayments.jsx", "FinanceReceivables.jsx", "FinanceSuppliers.jsx"];

test("D-XXX (regresi 'Daftar Pengeluaran kosong'): <CardList> netral di cards.jsx — TIDAK membawa CARD_VIEW_CLASS/md:hidden bawaan", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "features", "finance", "cards.jsx"), "latin1");
  const fnMatch = src.match(/export function CardList\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "Tidak menemukan definisi export function CardList(...) di cards.jsx — struktur file berubah, perbarui test ini setelah verifikasi ulang.");
  assert.ok(
    !fnMatch[0].includes("CARD_VIEW_CLASS") && !fnMatch[0].includes("md:hidden"),
    "CardList TIDAK BOLEH membawa CARD_VIEW_CLASS/\"md:hidden\" bawaan lagi — itu akar bug produksi 24 Sep 2026 (lihat komentar panjang di cards.jsx). Pemanggil pola CSS (lihat HARUS_CSS_TOGGLE_CARDLIST di test ini) yang menambahkannya sendiri lewat className."
  );
});

test("D-XXX (regresi): halaman pola JS (tier hook) TIDAK menambahkan class tampil/sembunyi viewport ke <CardList>-nya", () => {
  for (const nama of HARUS_PAKAI_TIER_HOOK) {
    const src = bacaSumber(nama);
    // Cari SEMUA pemanggilan <CardList ...> (dengan/tanpa prop) dan pastikan tidak satu pun membawa CARD_VIEW_CLASS/md:hidden.
    const panggilan = src.match(/<CardList[^>]*>/g) || [];
    assert.ok(panggilan.length > 0, `${nama}: tidak menemukan <CardList> sama sekali — struktur berubah, perbarui test ini.`);
    for (const p of panggilan) {
      assert.ok(
        !p.includes("CARD_VIEW_CLASS") && !p.includes("md:hidden"),
        `${nama}: "${p}" — halaman pola JS (useContainerTier) TIDAK BOLEH memberi CardList class viewport apa pun, JS ternary sudah menggerbanginya sepenuhnya. Menambahkannya lagi PERSIS mengulang bug produksi 24 Sep 2026 (tabel kosong walau data penuh).`
      );
    }
  }
});

test("D-XXX (regresi): halaman pola CSS (dual-render) memberi <CardList> CARD_VIEW_CLASS eksplisit — supaya tidak tampil dobel dengan TableWrap", () => {
  for (const nama of HARUS_CSS_TOGGLE_CARDLIST) {
    const src = bacaSumber(nama);
    assert.ok(
      src.includes('from "@/components/ui/table.jsx"') && /\bCARD_VIEW_CLASS\b/.test(src.match(/import \{[^}]*\} from "@\/components\/ui\/table\.jsx"/)?.[0] || ""),
      `${nama} diharapkan mengimpor CARD_VIEW_CLASS dari table.jsx (dipakai eksplisit di className CardList-nya).`
    );
    assert.ok(
      /<CardList[^>]*className=\{?CARD_VIEW_CLASS\}?[^>]*>/.test(src),
      `${nama}: <CardList> di sini WAJIB className={CARD_VIEW_CLASS} — halaman ini merender TableWrap DAN CardList SEKALIGUS (dua-duanya selalu di DOM), tanpa class viewport eksplisit ini keduanya akan tampil bersamaan alih-alih saling eksklusif.`
    );
  }
});
