import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient.js";
import App from "./App.jsx";
// Font Geist (Vercel) — self-hosted via Fontsource (offline/PWA friendly, tanpa CDN).
// Geist Sans = font UI utama, Geist Mono = angka/data. Di-import SEBELUM index.css
// supaya token font-family di sana bisa mereferensikan family-nya.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
// Tailwind (utilities-only, preflight off — lihat komentar di file ini)
// dipakai HALAMAN BARU yang migrasi bertahap (mulai dari Laporan), tidak
// menyentuh styling halaman lama yang masih 100% index.css.
import "./styles/tailwind.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
);
