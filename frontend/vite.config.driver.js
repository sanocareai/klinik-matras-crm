import { mergeConfig } from "vite";
import { fileURLToPath } from "url";
import base from "./vite.config.js";

// Build khusus APK Driver (Capacitor project TERPISAH di ../driver-app,
// lihat catatan panjang di frontend/.env.capacitor-driver) — outDir beda
// dari build web/APK sales biasa ("dist") supaya `npm run build` (web) dan
// `npm run build:capacitor` (APK sales) TIDAK PERNAH tertimpa hasil build
// ini, dan sebaliknya. Base config (react/tailwind/PWA/manualChunks) dipakai
// APA ADANYA lewat mergeConfig — TIDAK ada logic ganda yang bisa diam-diam
// berbeda dari build web biasa.
export default mergeConfig(base, {
  build: {
    outDir: "dist-driver",
  },
  resolve: {
    alias: {
      // Override alias base (default: stub kosong) ke font sungguhan — HANYA
      // build ini yang menariknya. Lihat catatan panjang di vite.config.js &
      // styles/driver-fonts.js/driver-fonts-noop.js.
      "virtual:driver-fonts": fileURLToPath(new URL("./src/styles/driver-fonts.js", import.meta.url)),
    },
  },
});
