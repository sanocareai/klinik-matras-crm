import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient.js";
import { ThemeProvider } from "./lib/ThemeProvider.jsx";
import App from "./App.jsx";
// Font Geist (Vercel) — self-hosted via Fontsource (offline/PWA friendly, tanpa CDN).
// Geist Sans = font UI utama, Geist Mono = angka/data. Di-import SEBELUM index.css
// supaya token font-family di sana bisa mereferensikan family-nya.
// Inter Variable — substitusi metrik-kompatibel untuk SF Pro. Di perangkat
// Apple, -apple-system tetap menang (SF asli); di Windows/Android yang dipakai
// Inter, BUKAN Segoe UI/Roboto. Itu yang membuat tipografi SERAGAM lintas
// perangkat — sebelumnya font ikut berubah tergantung OS.
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
