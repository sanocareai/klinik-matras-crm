// Gaya peta gelap untuk Google Maps JavaScript API (8 September 2026,
// gantikan tile CARTO Dark Matter yang berhenti gratis — lihat catatan
// panjang di lib/googleMaps.js). Dibuat MINIMALIS/muted (abu-abu gelap,
// label POI disembunyikan) — sama semangatnya dengan permintaan owner soal
// CARTO dulu ("gaya lebih simple/minimalist"), bukan Google Maps default
// yang ramai warna/label.
//
// Mode terang SENGAJA TIDAK diberi array styles kustom (biarkan default
// Google Maps) — style bawaan Google sudah bersih/terang, custom styling
// cuma perlu untuk mode gelap yang Google TIDAK punya preset resminya.
export const MAP_STYLE_DARK = [
  { elementType: "geometry", stylers: [{ color: "#17202e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#17202e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#7f8ea3" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#3a4658" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#a3adc2" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#1c2a1f" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2a3346" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212938" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#333e57" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#2c3548" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f1723" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4a5b76" }] },
];
