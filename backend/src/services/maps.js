// Google Maps Platform — geocoding + jarak antar-stop (PRD FR-L-03).
//
// SENGAJA MINIMAL: TIDAK ada optimasi rute otomatis (VRP) — PRD §1.5 eksplisit
// melarangnya untuk v1 ("Jabodetabek traffic makes algorithmic optimization
// far less valuable than a dispatcher who knows that Bekasi in the afternoon
// is a mistake"). Dispatcher yang urutkan manual; modul ini cuma menghitung
// jarak/durasi RANTAI (leg demi leg) untuk urutan yang sudah dipilih, dan
// mengisi lat/lng dari alamat teks.
//
// FASE 2 (30 Agustus 2026) — billing Google Cloud project MASIH
// REQUEST_DENIED (dites langsung, kartu debit user ditolak di Google
// Console), jadi Geocoding & Distance Matrix API tidak bisa dipakai sampai
// itu beres. Supaya fitur peta/rute TIDAK ikut mati total menunggu urusan
// billing yang di luar kendali sistem ini, DUA fallback GRATIS (tanpa API
// key, tanpa kartu) ditambahkan di sini:
//   - Geocoding  -> OpenStreetMap Nominatim
//   - Jarak antar-stop -> garis lurus (haversine) + asumsi kecepatan kota
// Google TETAP dicoba LEBIH DULU kalau `GOOGLE_MAPS_API_KEY` ada DAN
// responsnya sukses — begitu billing aktif, sistem otomatis pakai data
// Google lagi TANPA perlu ubah kode, tidak perlu "matikan mode fallback"
// manual. Setiap hasil fallback ditandai `estimate: true` supaya UI bisa
// jujur bilang "≈ perkiraan", bukan menyajikan angka kasar seolah presisi.

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const DISTANCE_MATRIX_URL = "https://maps.googleapis.com/maps/api/distancematrix/json";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Nominatim WAJIB User-Agent yang mengidentifikasi aplikasi (kebijakan
// pemakaian resminya) — tanpa ini permintaan bisa ditolak/diblokir diam-diam.
const NOMINATIM_USER_AGENT = "SANSS-KlinikMatras/1.0 (+https://app.sanomatrassehat.com; admin@klinikmatras.com)";

function apiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || "";
}

export function mapsConfigured() {
  return apiKey().length > 0;
}

async function geocodeGoogle(text) {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(text)}&region=id&key=${apiKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding API HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK" || !data.results?.[0]) return null;
  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng, estimate: false };
}

// Nominatim: gratis, tanpa key, TAPI kebijakan pemakaian membatasi
// ~1 permintaan/detik dan melarang pemakaian massal — untuk skala Sano
// (dispatcher mengisi alamat satu-satu, bukan proses batch) ini aman.
async function geocodeNominatim(text) {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(text)}&format=json&countrycodes=id&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": NOMINATIM_USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data[0]) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), estimate: true };
}

// geocodeAddress(text) -> { lat, lng, estimate } | null. Best-effort — SELALU
// dibungkus try/catch oleh pemanggil, gagal geocode BUKAN alasan menolak
// simpan job (alamat teks tetap tersimpan, deep link Maps di DriverJobs.jsx
// sudah punya fallback ke pencarian teks kalau lat/lng kosong).
// `estimate: true` = hasil Nominatim (akurasi lebih rendah dari Google utk
// alamat Indonesia yang tidak terlalu detail, tapi jauh lebih baik daripada
// tidak ada koordinat sama sekali).
export async function geocodeAddress(text) {
  if (!text || !text.trim()) return null;

  if (mapsConfigured()) {
    try {
      const hasil = await geocodeGoogle(text);
      if (hasil) return hasil;
    } catch (err) {
      console.error("[maps] Google geocode gagal, coba Nominatim:", err.message);
    }
  }

  try {
    return await geocodeNominatim(text);
  } catch (err) {
    console.error("[maps] Nominatim geocode gagal:", err.message);
    return null;
  }
}

// Jarak garis lurus (haversine, meter) — BUKAN jarak jalan sungguhan (tidak
// memperhitungkan belokan/rute satu arah/macet). Dipakai HANYA sebagai
// fallback saat Distance Matrix Google tidak tersedia.
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Asumsi kecepatan rata-rata jalan kota Jabodetabek (BUKAN kecepatan tempuh
// garis lurus) — dipilih konservatif (macet siang hari, banyak lampu merah)
// supaya estimasi durasi tidak terlalu optimis. Angka bulat, gampang
// disesuaikan kalau ternyata jauh meleset dari kenyataan lapangan.
const ASUMSI_KECEPATAN_KMH = 25;

function haversineLegs(stops) {
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const distanceMeters = Math.round(haversineMeters(stops[i], stops[i + 1]));
    const durationSeconds = Math.round(((distanceMeters / 1000) / ASUMSI_KECEPATAN_KMH) * 3600);
    legs.push({ distanceMeters, durationSeconds, estimate: true });
  }
  return legs;
}

// routeLegs(stops) — stops: array of { lat, lng } TERURUT (urutan dispatcher).
// Kembalikan array leg [{ distanceMeters, durationSeconds, estimate }] antara
// stop[i] dan stop[i+1], panjang stops.length-1. Elemen null (HANYA jalur
// Google) kalau Distance Matrix tidak punya rute untuk pasangan itu.
//
// SATU panggilan API untuk seluruh rute (origins = stop 0..n-2, destinations
// = stop 1..n-1, ambil diagonal elements[i][i]) — bukan panggilan per-leg,
// supaya kuota gratis 10.000/bulan tidak boros untuk rute dengan banyak stop.
// Gagal/tidak terkonfigurasi -> fallback haversineLegs, BUKAN throw — lihat
// catatan Fase 2 di kepala file.
export async function routeLegs(stops) {
  if (stops.length < 2) return [];

  if (mapsConfigured()) {
    try {
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
        return { distanceMeters: el.distance.value, durationSeconds: el.duration.value, estimate: false };
      });
    } catch (err) {
      console.error("[maps] Distance Matrix gagal, pakai estimasi garis lurus:", err.message);
    }
  }

  return haversineLegs(stops);
}
