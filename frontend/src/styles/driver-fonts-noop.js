// Stub kosong (9 September 2026) — dipakai SEMUA build KECUALI APK Driver
// (web/PWA, APK sales) lewat alias "virtual:driver-fonts" di vite.config.js.
// Lihat driver-fonts.js untuk isi sungguhan & alasan lengkap kenapa alias
// ini dipakai (bukan import() bersyarat biasa — Rollup tetap menyertakan
// modul yang di-import() secara dinamis sebagai chunk terpisah di dist/
// TERLEPAS dari kondisi runtime yang membungkusnya, jadi cara ITU tidak
// benar-benar mengecualikan file font dari hasil build; alias resolve
// BEDA per file config Vite yang benar-benar mengecualikannya).
