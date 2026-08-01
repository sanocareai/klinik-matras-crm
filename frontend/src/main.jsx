import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient.js";
import { ThemeProvider } from "./lib/ThemeProvider.jsx";
import App from "./App.jsx";
// Font Geist (Vercel) — self-hosted via Fontsource (offline/PWA friendly, tanpa CDN).
// Geist Sans = font UI utama, Geist Mono = angka/data. Di-import SEBELUM index.css
// supaya token font-family di sana bisa mereferensikan family-nya.
// Outfit Variable — font utama SANSS (redesign 1 Agustus 2026, Gilang).
// Geometric sans pengganti "Acme" (Mojomox) yang komersial/berbayar: huruf
// 'a' single-story, lingkaran geometris, punya Thin s/d Black. Lisensi OFL,
// SELF-HOSTED lewat @fontsource (BUKAN Google Fonts CDN) — konsisten dengan
// aturan project: tidak ada request ke host eksternal.
//
// Ini SENGAJA menang atas -apple-system: sebelumnya SF Pro/Inter dibiarkan
// menang di tiap OS supaya metrik seragam, tapi sekarang identitas visual
// SANSS lebih penting daripada mengikuti font sistem — Outfit dipakai di
// SEMUA perangkat, sama persis.
import "@fontsource-variable/outfit";
// Inter dipertahankan sebagai fallback metrik (dan masih dipakai beberapa
// komponen lama yang belum dimigrasi).
import "@fontsource-variable/inter";
// Geist Mono dipertahankan untuk angka/data mentah (tabular-nums).
import "@fontsource-variable/geist-mono";
import "./index.css";
// Tailwind (utilities-only, preflight off — lihat komentar di file ini)
// dipakai HALAMAN BARU yang migrasi bertahap (mulai dari Laporan), tidak
// menyentuh styling halaman lama yang masih 100% index.css.
import "./styles/tailwind.css";
// ⚠️ PALING AKHIR, DAN ITU DISENGAJA — Sano DS v2 token layer.
// Beberapa nama token di sini sengaja bertabrakan dengan :root lama di
// index.css (--bg-base/--text-primary/--text-secondary/--shadow-card). Karena
// di-import terakhir, nilai DS v2 yang menang, sehingga ~3.000 baris CSS lama
// ikut palet baru + dark mode tanpa ditulis ulang. Jangan pindahkan ke atas.
import "./styles/tokens.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </QueryClientProvider>
);
