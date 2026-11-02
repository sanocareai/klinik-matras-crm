import { useEffect } from "react";

// Penanda platform untuk urutan stack font (lihat styles/produksi-tipografi.css): dijalankan saat modul dimuat, sebelum render pertama.
if (typeof document !== "undefined") {
  const ua = (typeof navigator !== "undefined" && (navigator.userAgent || "")) || ""; const plat = (typeof navigator !== "undefined" && navigator.platform) || "";
  document.documentElement.dataset.plat = /Mac|iPhone|iPad|iPod/.test(plat) || /iPhone|iPad|iPod|Macintosh/.test(ua) ? "apple" : "lain";
}

/**
 * Menandai workspace aktif pada <html data-workspace="..."> selama `aktif` true. Dipakai Produksi (tipografi stack Apple/Inter): token font di styles/produksi-tipografi.css
 * mengikuti atribut ini sehingga portal yang dirender di <body> (dropdown, kalender, tooltip) ikut, dan atribut DILEPAS saat pengguna pindah workspace (tidak bocor ke Sales/Finance/Gudang).
 */
export function useWorkspaceFont(aktif, nama = "produksi") {
  useEffect(() => {
    if (!aktif || typeof document === "undefined") return undefined;
    const el = document.documentElement;
    el.dataset.workspace = nama;
    return () => { if (el.dataset.workspace === nama) delete el.dataset.workspace; };
  }, [aktif, nama]);
}
