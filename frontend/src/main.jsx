import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient.js";
import { ThemeProvider } from "./lib/ThemeProvider.jsx";
import App from "./App.jsx";
// Font Geist (Vercel) — self-hosted via Fontsource (offline/PWA friendly, tanpa CDN).
// Geist Sans = font UI utama, Geist Mono = angka/data. Di-import SEBELUM index.css
// supaya token font-family di sana bisa mereferensikan family-nya.
// Manrope Variable — font SANSS, mengikuti file desain Gilang
// (SANSS-integrated-smart-system-v4.html memakai Manrope 300–800).
//
// SELF-HOSTED lewat @fontsource, BUKAN @import Google Fonts seperti di file
// desain: request ke fonts.googleapis.com berarti halaman ikut menunggu host
// pihak ketiga (dan mengirim IP user ke sana). Hasil visualnya identik.
//
// SENGAJA menang atas -apple-system: dulu font sistem dibiarkan menang di tiap
// OS supaya metrik seragam, tapi identitas SANSS lebih penting — Manrope
// dipakai di SEMUA perangkat, sama persis.
import "@fontsource-variable/manrope";
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
// SESUDAH tokens.css — lapisan tema gelap khusus Delivery Hub (D-045) yang
// MENIMPA sebagian token/permukaan default di sana. Dikunci ganda ke
// [data-theme="dark"] + [data-division="armada"], jadi light mode & modul
// lain tidak tersentuh sama sekali. Lihat catatan lengkap di file itu.
import "./styles/delivery-dark.css";
// Pasangan MODE TERANG (D-046, 4 September 2026) — pagar sama (division
// armada saja), tapi gerbang temanya `html:not([data-theme="dark"])` (mutually
// exclusive dengan file di atas, jadi tidak pernah baku-timpa). Lihat
// styles/delivery-light.css.
import "./styles/delivery-light.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </QueryClientProvider>
);
