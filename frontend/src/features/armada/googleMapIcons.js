// Marker kustom untuk Google Maps JavaScript API — SVG murni (BUKAN HTML di
// dalam foreignObject) supaya rasterisasi ikon konsisten di semua browser
// (foreignObject di dalam data-URI SVG yang dipakai sebagai Marker.icon
// TERBUKTI tidak konsisten dirender lintas browser). Menggantikan L.divIcon
// dari RouteMap.jsx/ArmadaTracking.jsx versi Leaflet (8 September 2026,
// migrasi CARTO -> Google Maps — lihat catatan panjang di lib/googleMaps.js).
//
// SEMUA fungsi di sini butuh `google` (objek window.google SETELAH Maps
// JS API selesai dimuat, dari useJsApiLoader) sebagai argumen pertama —
// google.maps.Size/Point belum ada sebelum script-nya termuat, jadi
// pemanggil WAJIB menahan render sampai `isLoaded` true.
function svgIcon(google, inner, size, anchor) {
  const [w, h] = size;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(w, h),
    anchor: new google.maps.Point(anchor[0], anchor[1]),
  };
}

// Cache per-input (14 September 2026, laporan owner: "buka live tracking di
// web jadi glitch") — SEMUA fungsi ikon di bawah dipanggil LANGSUNG di JSX
// (`icon={driverIcon(...)}` dst, lihat ArmadaTracking.jsx/RouteMap.jsx),
// jadi tanpa cache, tiap render (poll 15 detik, klik marker mana pun, hasil
// OSRM baru) membuat OBJEK ICON BARU untuk SEMUA marker di peta sekaligus —
// @react-google-maps/api lalu memanggil ulang `marker.setIcon()` untuk
// semuanya serentak, kelihatan sebagai kedipan/flicker di seluruh peta.
// Fungsi svgIcon() murni (output SAMA untuk input SAMA) jadi aman di-cache:
// icon yang identik BOLEH dipakai bersama oleh banyak Marker sekaligus,
// pola umum Google Maps API. `google` sengaja TIDAK ikut kunci cache — dia
// singleton (window.google) yang stabil sepanjang umur halaman.
const iconCache = new Map();
function cached(key, factory) {
  if (iconCache.has(key)) return iconCache.get(key);
  const icon = factory();
  iconCache.set(key, icon);
  return icon;
}

// CATATAN (19 September 2026): driverIcon() DIHAPUS dari sini. Marker posisi
// driver di ArmadaTracking.jsx sekarang menampilkan FOTO PROFIL asli driver
// + helper (permintaan owner), dan itu tidak bisa dilakukan lewat ikon Google
// Maps — ikon di file ini data-URI SVG yang dirender LEPAS dari DOM halaman,
// jadi tidak bisa memuat gambar dari /uploads. Penggantinya komponen
// DriverPhotoMarker (OverlayView + HTML sungguhan) di ArmadaTracking.jsx.

// Pin tujuan (alamat customer) — belah ketupat merah, bentuk SENGAJA beda
// total dari avatar driver (kotak vs lingkaran) supaya tidak pernah tertukar
// sekilas mata di peta yang sama, sama alasan dengan versi Leaflet lama.
// Warna SEKARANG persis --red dari tokens.css (13 Sep 2026, redesign Live
// Tracking sesuai referensi owner) — sebelumnya #dc2626 generik, bukan token
// Sano. Data-URI SVG dirender lepas dari DOM halaman (jadi tidak bisa baca
// var(--red) langsung) — theme dilewatkan manual oleh pemanggil (`resolved`
// dari useTheme()), BUKAN ditebak di sini.
export function destinationIcon(google, theme) {
  return cached(`dest:${theme}`, () => {
    const merah = theme === "dark" ? "#FF453A" : "#D70015";
    const inner = `
      <g transform="translate(11,10) rotate(45)">
        <rect x="-7" y="-7" width="14" height="14" rx="3" fill="${merah}" stroke="white" stroke-width="2"/>
      </g>
    `;
    return svgIcon(google, inner, [22, 22], [11, 20]);
  });
}

// Lingkaran bernomor per warna rute — stop Route Planner (RouteMap.jsx).
export function stopIcon(google, warna, nomor) {
  return cached(`stop:${warna}:${nomor}`, () => {
    const inner = `
      <circle cx="12" cy="12" r="10" fill="${warna}" stroke="white" stroke-width="2"/>
      <text x="12" y="13" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-weight="700" font-size="11" fill="white">${nomor}</text>
    `;
    return svgIcon(google, inner, [24, 24], [12, 12]);
  });
}

// Stop yang SUDAH SELESAI di Live Tracking (14 September 2026, D-165 —
// seluruh urutan rute sekarang ditampilkan, bukan cuma tujuan yang sedang
// dituju) — lingkaran hijau (--green tema terang, cukup dekat di kedua
// tema untuk ikon kecil beropacity solid) + checkmark, SENGAJA beda bentuk
// dari stopIcon bernomor (upcoming) supaya status "sudah lewat" langsung
// kebaca tanpa perlu baca angka nomor urutnya.
export function stopIconDone(google) {
  return cached("stopDone", () => {
    const inner = `
      <circle cx="11" cy="11" r="9" fill="#248A3D" stroke="white" stroke-width="2"/>
      <path d="M6.5 11l3 3 5-6" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    `;
    return svgIcon(google, inner, [22, 22], [11, 11]);
  });
}

// Stop yang GAGAL di Live Tracking (14 September 2026, D-165) — lingkaran
// merah + silang, dipisah dari stopIconDone (hijau+centang) supaya stop
// gagal TIDAK pernah terlihat seolah berhasil di peta cuma karena sudah
// "lewat" secara urutan.
export function stopIconFailed(google) {
  return cached("stopFailed", () => {
    const inner = `
      <circle cx="11" cy="11" r="9" fill="#D70015" stroke="white" stroke-width="2"/>
      <path d="M7.5 7.5l7 7M14.5 7.5l-7 7" stroke="white" stroke-width="2" stroke-linecap="round"/>
    `;
    return svgIcon(google, inner, [22, 22], [11, 11]);
  });
}

// Titik pangkalan (Klinik Matras) — kotak gelap + ikon rumah, MILIK BERSAMA
// semua rute (bukan salah satu warna PALET_RUTE), sama alasan dgn Leaflet lama.
export function depotIcon(google) {
  return cached("depot", () => {
    const inner = `
      <rect x="1" y="1" width="28" height="28" rx="8" fill="#1D1D1F" stroke="white" stroke-width="2"/>
      <g transform="translate(3,3)" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <path d="M9 22V12h6v10"/>
      </g>
    `;
    return svgIcon(google, inner, [30, 30], [15, 28]);
  });
}
