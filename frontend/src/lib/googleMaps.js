// Konfigurasi BERSAMA untuk Google Maps JavaScript API — dipakai RouteMap.jsx
// (Route Planner) dan ArmadaTracking.jsx (Live Tracking). SATU sumber
// kebenaran supaya kedua peta memuat library yang SAMA persis (useJsApiLoader
// dari @react-google-maps/api MEWAJIBKAN array `libraries` stabil — kalau
// dua komponen membuat array literal baru sendiri-sendiri tiap render,
// warning "LoadScript has been reloaded unintentionally" muncul di console).
//
// GANTI TILE CARTO -> Google Maps ASLI (8 September 2026) — CARTO tiba-tiba
// mewajibkan API key sejak akhir Agustus 2026 (basemap gratis yang dipakai
// sejak D-075 berhenti berfungsi, tampil watermark "API KEY REQUIRED" di
// production). Momentum ini dipakai sekaligus memenuhi permintaan owner yang
// sudah lama ada ("peta masih jauh dari harapan seperti Google Maps") —
// billing Google Cloud SUDAH aktif (akun baru, 7 September 2026), jadi
// sekalian pindah ke Google Maps sungguhan, bukan cari basemap gratis
// pengganti CARTO lagi.
//
// KUNCI TERPISAH dari GOOGLE_MAPS_API_KEY backend (Geocoding/Distance
// Matrix) — SENGAJA. Key browser ini TAMPIL di source/network request
// setiap pengunjung (itu memang model keamanan resmi Maps JavaScript API),
// jadi dibatasi lewat HTTP referrer (domain app.sanomatrassehat.com) di
// Google Cloud Console, BUKAN lewat IP seperti key backend. Menyatukan
// kedua key akan membuat pembatasan IP key backend jadi percuma — siapa pun
// yang buka DevTools bisa menyalin key itu dan memakainya dari IP manapun.
export const GOOGLE_MAPS_JS_KEY = import.meta.env.VITE_GOOGLE_MAPS_JS_KEY || "";

// Array libraries HARUS konstanta modul (referensi stabil), bukan dibuat
// ulang tiap render — persyaratan eksplisit @react-google-maps/api.
export const GOOGLE_MAPS_LIBRARIES = [];

// id SAMA untuk kedua peta — @react-google-maps/api mendeteksi script yang
// sudah termuat lewat id ini, jadi kalau (di masa depan) ada 2 peta di
// halaman yang sama, script Google TIDAK diminta dobel.
export const GOOGLE_MAPS_SCRIPT_ID = "sanss-google-maps-script";
