// Font retheme APK Driver (9 September 2026) — SATU-SATUNYA build yang
// benar-benar menarik file ini, lewat alias "virtual:driver-fonts" yang
// di-override khusus di vite.config.driver.js (base vite.config.js
// meng-alias-kan ke driver-fonts-noop.js/kosong untuk build lainnya).
// Family-nya sendiri (nama, dipakai di CSS) ada di styles/driver-app-
// theme.css — file ini CUMA menarik data font-nya (berat, woff/woff2),
// terpisah supaya web/PWA/APK sales genuinely TIDAK menyertakannya sama
// sekali di dist/ mereka (bukan cuma "tidak dijalankan saat runtime").
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
