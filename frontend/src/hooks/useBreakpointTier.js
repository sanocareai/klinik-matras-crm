import { useEffect, useState } from "react";

// TIER LEBAR LAYAR untuk tabel dengan KOLOM GABUNGAN (D-XXX, 22 Sep 2026).
//
// ⚠️ KENAPA INI JS (matchMedia), BUKAN CSS hideBelow BIASA — pelajaran mahal
// dari QA visual: `table-layout: fixed` di Chrome MEMATOK lebar kolom dari
// `width` yang dideklarasikan tiap <td> DI BARIS PERTAMA, TERLEPAS dari
// apakah sel itu `display:none` lewat class Tailwind (hideBelow/mid) atau
// tidak — sel yang disembunyikan TETAP mengambil jatah lebarnya dari
// anggaran kolom. Untuk SATU kolom yang cuma disembunyikan (pola hideBelow
// biasa, dipakai 11 halaman Finance lain) ini aman — anggaran lebih itu
// masih masuk toleransi container. Tapi untuk kolom yang punya BEBERAPA
// representasi alternatif sekaligus (Kategori+Divisi+Mode+SumberDana
// TERPISAH, ATAU digabung jadi Klasifikasi+Pembayaran, ATAU disembunyikan
// total dengan tombol expand) — kalau KETIGA versi itu sama-sama ada di DOM
// (cuma disembunyikan CSS berdasarkan lebar), total anggaran lebar yang
// "dipatok" jauh melebihi kebutuhan nyata, dan kolom "Keterangan" yang
// fleksibel (tanpa width, mengandalkan sisa ruang) KEHABISAN ruang sampai
// mendekati 0px — persis bug tumpang tindih yang dilaporkan.
//
// Perbaikannya: hanya render SATU set kolom detail yang relevan untuk lebar
// layar SEKARANG (lewat hook ini), bukan render semuanya lalu sembunyikan
// sebagian lewat CSS.
// ⚠️ Batas "mid" SENGAJA 1400px, BUKAN 1280px seperti draf spesifikasi awal
// ("1280–1599 → gabung jadi Klasifikasi/Pembayaran"). Diukur nyata lewat QA
// visual (screenshot + geometry dump, bukan cuma scrollWidth/clientWidth):
// di viewport 1280px, sidebar + gutter halaman menyisakan ±916px untuk
// tabel. Kolom yang WAJIB selalu tampil (Nomor "EXP-DDMMYYYY-NNN" 140,
// Tanggal 64, Nominal 104, Status 92, Bukti 80, Aksi 148 = 628px) + dua
// kolom gabungan (Klasifikasi+Pembayaran, minimal 130+118=248px supaya
// tidak sekadar inisial 2 huruf) sudah 876px — cuma menyisakan ±40px untuk
// "Keterangan", yang me-render satu-dua HURUF per baris (persis kebalikan
// dari tujuan D-XXX). Di 1280–1399px kolom gabungan itu TIDAK dipaksa
// muncul; tier "compact" (sembunyikan + tombol expand) dipakai sampai ada
// cukup ruang nyata (>=1400px, diverifikasi Keterangan dapat >150px).
export const TIER_QUERY = Object.freeze({
  uw: "(min-width: 1600px)",
  mid: "(min-width: 1400px) and (max-width: 1599.98px)",
  compact: "(min-width: 768px) and (max-width: 1399.98px)",
  mobile: "(max-width: 767.98px)",
});

/**
 * Versi MURNI (px → nama tier), tidak menyentuh `window`/`matchMedia` —
 * dites langsung lewat `node --test` (lihat tests/breakpointTier.test.js).
 * Batasnya HARUS sama persis dengan `TIER_QUERY` di atas; test mengunci
 * keduanya supaya tidak diam-diam melenceng kalau salah satu diubah.
 */
export function tierFromWidth(width) {
  if (width >= 1600) return "uw";
  if (width >= 1400) return "mid";
  if (width >= 768) return "compact";
  return "mobile";
}

function hitungTier() {
  if (typeof window === "undefined") return "uw";
  return tierFromWidth(window.innerWidth);
}

/** "uw" (>=1600) | "mid" (1280–1599) | "compact" (768–1279) | "mobile" (<768). */
export function useBreakpointTier() {
  const [tier, setTier] = useState(hitungTier);
  useEffect(() => {
    const handler = () => setTier(hitungTier());
    const mqls = Object.values(TIER_QUERY).map((q) => window.matchMedia(q));
    mqls.forEach((mql) => mql.addEventListener("change", handler));
    handler();
    return () => mqls.forEach((mql) => mql.removeEventListener("change", handler));
  }, []);
  return tier;
}
