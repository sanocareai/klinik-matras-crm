import { useCallback, useRef, useState } from "react";

// TIER LEBAR **CONTAINER** (D-XXX, polish 22 Sep 2026) — ResizeObserver,
// BUKAN `window.matchMedia`/`innerWidth` (itu `useBreakpointTier.js` lama).
//
// ⚠️ KENAPA CONTAINER, BUKAN VIEWPORT. Lebar VIEWPORT tidak sama dengan
// lebar RUANG NYATA yang tabel ini punya — sidebar (dibuka/ditutup), sistem
// tab dalam-app (Inbox/Jurnal Umum/Pengeluaran/... sekaligus terbuka), dan
// gutter halaman semuanya memotong jatah tabel dari lebar jendela. Tabel
// yang mengira dirinya "lebar" cuma karena window lebar (padahal sidebar
// makan 240px+) berakhir sesak — persis yang dilaporkan di screenshot
// produksi. ResizeObserver pada elemen PEMBUNGKUS tabel itu sendiri
// mengukur ruang yang BENAR-BENAR tersedia, ikut berubah kalau sidebar
// di-toggle atau tab lain dibuka, tanpa perlu window resize.
export const CONTAINER_TIER_THRESHOLD = Object.freeze({ full: 1250, reduced: 900, minimal: 768 });

/** Px lebar kontainer → nama tier. Murni, dites langsung (lihat tests/containerTier.test.js). */
export function tierFromContainerWidth(width) {
  if (width >= CONTAINER_TIER_THRESHOLD.full) return "full";
  if (width >= CONTAINER_TIER_THRESHOLD.reduced) return "reduced";
  if (width >= CONTAINER_TIER_THRESHOLD.minimal) return "minimal";
  return "card";
}

/**
 * `const [ref, tier] = useContainerTier();` — pasang `ref` ke elemen
 * pembungkus tabel (biasanya div yang membungkus <TableWrap>+<CardList>).
 * Tier awal (sebelum ResizeObserver sempat mengukur, mis. saat SSR/render
 * pertama) SENGAJA "full" — server/first-paint tidak tahu lebar kontainer
 * asli, dan menebak "penuh" lebih aman daripada menyembunyikan kolom yang
 * sebenarnya muat (efeknya cuma sekejap sebelum observer pertama menembak,
 * bukan salah permanen).
 *
 * ⚠️ CALLBACK REF (bukan `useRef` + `useEffect(..., [])`) — ditemukan bug
 * nyata lewat QA: div pembungkus tabel di halaman Finance SELALU dirender
 * KONDISIONAL (baru muncul setelah data selesai dimuat; sebelum itu yang
 * tampil skeleton/empty state). `useEffect(..., [])` HANYA jalan SEKALI
 * saat komponen pertama mount — pada saat itu ref-nya MASIH `null` (div-nya
 * belum ada di tree), jadi observer tidak pernah terpasang, dan karena
 * dependency array kosong React TIDAK PERNAH menjalankannya ulang begitu
 * div akhirnya muncul. Hasilnya: tier permanen macet di tebakan awal
 * "full" — persis bug yang terlihat di produksi (9 kolom penuh dipaksakan
 * muat di container 916px). Callback ref TIDAK punya masalah ini: React
 * memanggilnya SETIAP KALI node DOM benar-benar terpasang/terlepas,
 * berapa kalipun & kapan pun itu terjadi.
 */
export function useContainerTier() {
  const [tier, setTier] = useState("full");
  const roRef = useRef(null);

  const ref = useCallback((el) => {
    if (roRef.current) {
      roRef.current.disconnect();
      roRef.current = null;
    }
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width;
      if (typeof width === "number") setTier(tierFromContainerWidth(width));
    });
    ro.observe(el);
    roRef.current = ro;
    // Ukuran AWAL langsung, jangan tunggu callback resize pertama.
    setTier(tierFromContainerWidth(el.getBoundingClientRect().width));
  }, []);

  return [ref, tier];
}
