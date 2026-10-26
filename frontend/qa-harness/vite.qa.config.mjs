// Konfigurasi Vite KHUSUS QA: sama dengan vite.config.js tetapi proxy /api menuju server QA terisolasi (QA_API), bukan localhost:4000. Tidak dipakai build/rilis.
import { mergeConfig } from "vite";
import base from "../vite.config.js";

const api = process.env.QA_API || "http://127.0.0.1:4010";
// cacheDir di luar node_modules: node_modules proyek ini hanya junction BACA-SAJA ke salinan dependensi lain (disk penuh saat QA), jangan menulis ke sana.
export default mergeConfig(base, {
  cacheDir: process.env.QA_CACHE || "C:/tmp/km-koreksi-qa/vite-cache",
  server: { port: Number(process.env.QA_PORT || 5190), strictPort: true, proxy: { "/api": { target: api, changeOrigin: true, configure: (proxy) => { proxy.on("error", () => {}); proxy.on("proxyReq", (req) => req.on("error", () => {})); } }, "/uploads": api, "/media": api } },
});
