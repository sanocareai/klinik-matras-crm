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
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
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
      workbox: {
        skipWaiting: true,    // SW baru langsung aktif tanpa tunggu tab ditutup
        clientsClaim: true,   // SW baru langsung klaim semua tab yang terbuka
        // Bug 1a fix: HAPUS cache lama begitu SW baru aktif — sebelumnya
        // cache dari deploy2x-3x lalu bisa numpuk tak terpakai, dan dalam
        // beberapa kasus browser (terutama non-Chrome) tetap resolve request
        // ke entry cache LAMA yang belum sempat dibersihkan.
        cleanupOutdatedCaches: true,
        // Bundle utama sudah lewat 2MB default sejak Fase B (react-virtuoso,
        // emoji-mart, dsb ditambahkan) — naikkan limit precache supaya build
        // tidak gagal. TODO: code-split (dynamic import) di fase berikutnya
        // supaya chunk utama tidak terus membengkak.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          // Bug 1a fix (AKAR bug "UI dark lama/basi"): dokumen HTML (index.html
          // / app shell) SEBELUMNYA ikut precache manifest workbox generateSW,
          // yang default-nya perilaku cache-first utk precached entries — user
          // yang tabnya tetap terbuka lama atau browser non-Chrome yang lebih
          // agresif soal cache bisa "terjebak" di index.html versi lama TANPA
          // pernah cek network dulu. NetworkFirst DI SINI eksplisit memaksa
          // browser SELALU coba network dulu utk navigasi (buka/refresh
          // halaman) — fallback ke cache HANYA kalau benar-benar offline.
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-shell",
              networkTimeoutSeconds: 3,
            },
          },
          // API calls: selalu ambil dari network, data harus selalu fresh
          {
            urlPattern: /\/api\//,
            handler: "NetworkOnly",
          },
          // Static assets: cache dulu untuk loading lebih cepat
          {
            urlPattern: /\.(?:js|css|png|jpg|jpeg|svg|woff2?)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "static-assets",
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 hari
              },
            },
          },
        ],
      },
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
