import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "fs";
import { fileURLToPath, URL } from "url";

// Versi + waktu build di-cetak kecil di halaman Login (Bug 1c) — supaya
// bisa verifikasi user benar-benar pegang bundle TERBARU (bukan basi dari
// service worker lama), tanpa perlu buka DevTools.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      // Alias @/ khusus dipakai komponen shadcn/ui (konvensi resmi mereka) —
      // halaman/komponen LAMA tetap pakai relative import seperti biasa,
      // ini TIDAK mengganti pola import di seluruh app, cuma tersedia untuk
      // kode baru yang mengadopsi Tailwind+shadcn (mulai dari Laporan).
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // virtual:driver-fonts (9 September 2026) — default-nya (build ini:
      // web/PWA & APK sales) resolve ke stub KOSONG. vite.config.driver.js
      // meng-override alias ini ke file font sungguhan. main.jsx meng-
      // import "virtual:driver-fonts" TANPA syarat apa pun — pengecualian
      // dari bundle terjadi di RESOLUSI MODUL (beda file per config), bukan
      // dari kondisi runtime yang tetap membuat Rollup menyertakan chunk-nya
      // di dist/ (sudah dicoba & dikonfirmasi TIDAK cukup, lihat komentar
      // panjang di driver-fonts-noop.js).
      "virtual:driver-fonts": fileURLToPath(new URL("./src/styles/driver-fonts-noop.js", import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // strategies: injectManifest (8 September 2026 — SEBELUMNYA generateSW,
      // default Workbox auto-generate). Diganti supaya service worker bisa
      // punya event listener CUSTOM (self.addEventListener("push", ...)) —
      // notifikasi driver job baru, permintaan owner (referensi Lalamove/
      // Gojek, TETAP PWA). generateSW TIDAK BISA disisipi listener custom
      // sama sekali, injectManifest satu-satunya opsi vite-plugin-pwa untuk
      // ini. `srcDir`/`filename` menunjuk src/sw.js — file itu WAJIB
      // reproduksi PERSIS 3 aturan cache di bawah (dipindah ke sana secara
      // manual pakai workbox-routing/workbox-strategies, BUKAN lagi lewat
      // opsi `workbox.runtimeCaching` di sini — opsi itu HANYA berlaku untuk
      // mode generateSW, diabaikan diam-diam di mode injectManifest).
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      injectManifest: {
        // Sama alasan dengan maximumFileSizeToCacheInBytes di generateSW
        // lama — bundle utama sudah lewat 2MB.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      registerType: "autoUpdate",
      manifest: {
        name: "Klinik Matras CRM",
        short_name: "Klinik Matras",
        description: "Omnichannel Inbox & CRM Klinik Matras",
        theme_color: "#2563EB",
        background_color: "#F8FAFC",
        display: "standalone",
        orientation: "portrait",
        start_url: "/dashboard",
        icons: [
          { src: "/favicon.png",     sizes: "32x32",   type: "image/png" },
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      // Blok `workbox: {...}` (skipWaiting/clientsClaim/cleanupOutdatedCaches/
      // runtimeCaching) DIPINDAH ke src/sw.js sejak strategies:injectManifest
      // di atas — opsi ini DIABAIKAN DIAM-DIAM di mode injectManifest (bukan
      // dihapus fungsinya, cuma pindah rumah). Lihat src/sw.js untuk
      // perilaku cache yang SAMA PERSIS dengan sebelumnya (Bug 1a/1c).
    }),
  ],
  server: {
    proxy: {
      "/api":     "http://localhost:4000",
      "/uploads": "http://localhost:4000", // file media chat (foto/video/dokumen)
      "/media":   "http://localhost:4000", // foto produk
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Fase G — pisahkan vendor besar ke chunk sendiri: browser cache
        // chunk ini terpisah dari kode app (jarang berubah antar deploy),
        // dan halaman yang tidak butuh vendor tertentu (mis. bukan Inbox)
        // tidak perlu menariknya sama sekali kalau sudah lazy di level rute.
        manualChunks: {
          "vendor-react":   ["react", "react-dom", "react-router-dom"],
          "vendor-virtuoso": ["react-virtuoso"],
          "vendor-query":   ["@tanstack/react-query"],
          "vendor-charts":  ["recharts"],
          "vendor-motion":  ["framer-motion"],
          "vendor-socket":  ["socket.io-client"],
        },
      },
    },
  },
});
