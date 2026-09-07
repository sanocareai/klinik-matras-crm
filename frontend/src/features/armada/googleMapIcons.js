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
import { avatarColor, getInitials } from "@/utils/format.js";

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function svgIcon(google, inner, size, anchor) {
  const [w, h] = size;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(w, h),
    anchor: new google.maps.Point(anchor[0], anchor[1]),
  };
}

// Avatar bulat berwarna + inisial — posisi driver (ArmadaTracking.jsx).
export function driverIcon(google, name) {
  const { bg, text } = avatarColor(name || "?");
  const initials = escapeXml(getInitials(name));
  const inner = `
    <circle cx="19" cy="19" r="16" fill="${bg}" stroke="white" stroke-width="3"/>
    <text x="19" y="20" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-weight="700" font-size="13" fill="${text}">${initials}</text>
  `;
  return svgIcon(google, inner, [38, 38], [19, 19]);
}

// Pin tujuan (alamat customer) — belah ketupat merah, bentuk SENGAJA beda
// total dari avatar driver (kotak vs lingkaran) supaya tidak pernah tertukar
// sekilas mata di peta yang sama, sama alasan dengan versi Leaflet lama.
export function destinationIcon(google) {
  const inner = `
    <g transform="translate(11,10) rotate(45)">
      <rect x="-7" y="-7" width="14" height="14" rx="3" fill="#dc2626" stroke="white" stroke-width="2"/>
    </g>
  `;
  return svgIcon(google, inner, [22, 22], [11, 20]);
}

// Lingkaran bernomor per warna rute — stop Route Planner (RouteMap.jsx).
export function stopIcon(google, warna, nomor) {
  const inner = `
    <circle cx="12" cy="12" r="10" fill="${warna}" stroke="white" stroke-width="2"/>
    <text x="12" y="13" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-weight="700" font-size="11" fill="white">${nomor}</text>
  `;
  return svgIcon(google, inner, [24, 24], [12, 12]);
}

// Titik pangkalan (Klinik Matras) — kotak gelap + ikon rumah, MILIK BERSAMA
// semua rute (bukan salah satu warna PALET_RUTE), sama alasan dgn Leaflet lama.
export function depotIcon(google) {
  const inner = `
    <rect x="1" y="1" width="28" height="28" rx="8" fill="#1D1D1F" stroke="white" stroke-width="2"/>
    <g transform="translate(3,3)" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <path d="M9 22V12h6v10"/>
    </g>
  `;
  return svgIcon(google, inner, [30, 30], [15, 28]);
}
