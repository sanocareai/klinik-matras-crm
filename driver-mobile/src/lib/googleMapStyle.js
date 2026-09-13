// Gaya peta gelap untuk react-native-maps (13 Sep 2026) — SALINAN MURNI dari
// frontend/src/features/armada/googleMapStyle.js (array style Google Maps
// adalah format JSON platform-agnostik, sama persis dipakai `customMapStyle`
// di sini dan `options.styles` di web) — duplikasi kecil sengaja, bukan
// paket bersama, sama pola dengan jobHelpers.js (runtime RN vs web beda
// bundle). Mode terang TIDAK diberi style kustom, sama alasan dengan web:
// default Google Maps sudah bersih/terang.
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
