import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Klinik Matras CRM",
        short_name: "Klinik Matras",
        description: "Omnichannel Inbox & CRM Klinik Matras",
        theme_color: "#1e2139",
        background_color: "#1e2139",
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
        runtimeCaching: [
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
      "/api": "http://localhost:4000",
    },
  },
});
