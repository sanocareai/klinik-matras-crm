// Google Maps Platform — geocoding + jarak antar-stop (PRD FR-L-03).
//
// SENGAJA MINIMAL: TIDAK ada optimasi rute otomatis (VRP) — PRD §1.5 eksplisit
// melarangnya untuk v1 ("Jabodetabek traffic makes algorithmic optimization
// far less valuable than a dispatcher who knows that Bekasi in the afternoon
// is a mistake"). Dispatcher yang urutkan manual; modul ini cuma menghitung
// jarak/durasi RANTAI (leg demi leg) untuk urutan yang sudah dipilih, dan
// mengisi lat/lng dari alamat teks.
//
// Kalau GOOGLE_MAPS_API_KEY belum diisi (development tanpa key, atau key
// belum di-restrict), semua fungsi di sini NO-OP (return null) — bukan throw
// — supaya fitur lain (buat job, dsb.) tidak pernah ikut rusak gara-gara Maps.

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const DISTANCE_MATRIX_URL = "https://maps.googleapis.com/maps/api/distancematrix/json";

function apiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || "";
}

export function mapsConfigured() {
  return apiKey().length > 0;
}

// geocodeAddress(text) -> { lat, lng } | null. Best-effort — SELALU dibungkus
// try/catch oleh pemanggil, gagal geocode BUKAN alasan menolak simpan job
// (alamat teks tetap tersimpan, deep link Maps di DriverJobs.jsx sudah punya
// fallback ke pencarian teks kalau lat/lng kosong).
export async function geocodeAddress(text) {
  if (!mapsConfigured() || !text || !text.trim()) return null;
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(text)}&region=id&key=${apiKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding API HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK" || !data.results?.[0]) return null;
  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng };
}

// routeLegs(stops) — stops: array of { lat, lng } TERURUT (urutan dispatcher).
// Kembalikan array leg [{ distanceMeters, durationSeconds }] antara stop[i]
// dan stop[i+1], panjang stops.length-1. Elemen null kalau Distance Matrix
// tidak punya rute untuk pasangan itu (dibiarkan, bukan error total).
//
// SATU panggilan API untuk seluruh rute (origins = stop 0..n-2, destinations
// = stop 1..n-1, ambil diagonal elements[i][i]) — bukan panggilan per-leg,
// supaya kuota gratis 10.000/bulan tidak boros untuk rute dengan banyak stop.
export async function routeLegs(stops) {
  if (!mapsConfigured() || stops.length < 2) return [];
  const origins = stops.slice(0, -1).map((s) => `${s.lat},${s.lng}`).join("|");
  const destinations = stops.slice(1).map((s) => `${s.lat},${s.lng}`).join("|");
  const url = `${DISTANCE_MATRIX_URL}?origins=${origins}&destinations=${destinations}&key=${apiKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Distance Matrix API HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK") throw new Error(`Distance Matrix API status ${data.status}`);
  return data.rows.map((row, i) => {
    const el = row.elements[i];
    if (!el || el.status !== "OK") return null;
    return { distanceMeters: el.distance.value, durationSeconds: el.duration.value };
  });
}
