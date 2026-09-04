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
// billing yang di luar kendali sistem ini, fallback GRATIS ditambahkan:
//   - Geocoding  -> (1) link Google Maps yang nempel di addressText kalau
//                   ada (PALING akurat, lihat geocodeFromMapsLink), lalu
//                   (2) OpenStreetMap Nominatim kalau tidak ada link
//   - Jarak antar-stop -> garis lurus (haversine) + asumsi kecepatan kota
// Google TETAP dicoba LEBIH DULU kalau `GOOGLE_MAPS_API_KEY` ada DAN
// responsnya sukses — begitu billing aktif, sistem otomatis pakai data
// Google lagi TANPA perlu ubah kode, tidak perlu "matikan mode fallback"
// manual. Setiap hasil fallback ditandai `estimate: true` supaya UI bisa
// jujur bilang "≈ perkiraan", bukan menyajikan angka kasar seolah presisi.
//
// FASE 3 (4 September 2026) — kartu KREDIT pun ditolak Google Cloud
// (laporan owner: "google maps api gabisa ditopup udah pake credit card").
// LocationIQ ditambahkan sebagai tingkat KEDUA (di atas Nominatim, di
// bawah Google): geocoder berbasis OSM juga, TAPI hosted+di-cache lebih
// baik dari Nominatim publik (akurasi lebih tinggi utk alamat Indonesia
// yang tidak terlalu detail) DAN sekalian API rute jalan asli (bukan
// haversine) — dan yang PALING PENTING, pendaftarannya TIDAK MEMINTA
// kartu kredit sama sekali untuk tingkat gratisnya (5.000 request/hari).
// Diaktifkan cuma dengan mengisi `LOCATIONIQ_API_KEY` di .env — kalau
// kosong, sistem diam-diam lanjut ke Nominatim seperti sebelumnya, TIDAK
// ADA perubahan perilaku sampai key itu benar-benar diisi. Daftar gratis:
// https://locationiq.com/register (isi email, verifikasi email, selesai).

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const DISTANCE_MATRIX_URL = "https://maps.googleapis.com/maps/api/distancematrix/json";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const LOCATIONIQ_SEARCH_URL = "https://us1.locationiq.com/v1/search";
const LOCATIONIQ_DIRECTIONS_URL = "https://us1.locationiq.com/v1/directions/driving";

// Nominatim WAJIB User-Agent yang mengidentifikasi aplikasi (kebijakan
// pemakaian resminya) — tanpa ini permintaan bisa ditolak/diblokir diam-diam.
const NOMINATIM_USER_AGENT = "SANSS-KlinikMatras/1.0 (+https://app.sanomatrassehat.com; admin@klinikmatras.com)";

// Link Google Maps di dalam addressText (30 Agustus 2026, ditemukan saat
// backfill produksi) — sales SERING menempel link share lokasi customer
// ("https://maps.app.goo.gl/xxx?g_st=ac") di belakang alamat teks. Link itu
// GRATIS, TANPA API key, dan JAUH lebih akurat daripada geocoding tebakan
// (Nominatim/Google sekalipun) — itu titik PERSIS yang customer/sales
// tandai sendiri di peta, bukan hasil pencarian teks. Karena itu dicoba
// PALING PERTAMA, sebelum Google maupun Nominatim.
//
// Link pendek (maps.app.goo.gl) redirect ke URL panjang yang menyimpan
// koordinat di pola `!3d<lat>!4d<lng>` — diambil dari `res.url` setelah
// fetch mengikuti redirect (Node fetch bawaan sudah `redirect: "follow"`
// secara default, tidak perlu library tambahan).
const GOOGLE_MAPS_LINK_RE = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.com\/maps)\S*/i;
const LATLNG_IN_URL_RE = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/;

// Lokasi Klinik Matras by SANO CARE (D-076, 4 September 2026) — laporan
// owner: "buat semua jalur mulai dan berakhir di lokasi klinik matras".
// Koordinat diambil LANGSUNG dari link Google Maps yang owner kirim
// (share.google/dOuyp6vGICSFLPCrZ → "KLINIK MATRAS by SANO CARE", diverifikasi
// silang lewat reverse-geocode Nominatim: Beji, Depok, Jawa Barat 16422 —
// masuk akal untuk lokasi klinik). SATU sumber kebenaran untuk seluruh
// backend — jangan hardcode ulang angka ini di tempat lain, import dari sini.
export const DEPOT = { lat: -6.38784855, lng: 106.8177975, label: "Klinik Matras" };

async function geocodeFromMapsLink(text) {
  const match = text.match(GOOGLE_MAPS_LINK_RE);
  if (!match) return null;
  const res = await fetch(match[0]);
  const koordinat = res.url.match(LATLNG_IN_URL_RE);
  if (!koordinat) return null;
  return { lat: parseFloat(koordinat[1]), lng: parseFloat(koordinat[2]), estimate: false };
}

function apiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || "";
}

export function mapsConfigured() {
  return apiKey().length > 0;
}

function locationIqKey() {
  return process.env.LOCATIONIQ_API_KEY || "";
}

export function locationIqConfigured() {
  return locationIqKey().length > 0;
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

async function locationIqSearch(text) {
  const url = `${LOCATIONIQ_SEARCH_URL}?key=${locationIqKey()}&q=${encodeURIComponent(text)}&format=json&countrycodes=id&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": NOMINATIM_USER_AGENT } });
  if (res.status === 404) return null; // LocationIQ balas 404 polos kalau tidak ketemu, bukan array kosong
  if (!res.ok) throw new Error(`LocationIQ HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data[0]) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), estimate: true };
}

// Sama pola penyederhanaan bertahap dengan geocodeNominatim di bawah —
// LocationIQ juga berbasis data OSM, jadi alamat super-detail ala sales
// ("blok a25 no 19b") kemungkinan sama-sama tidak ketemu utuh. Rate limit
// gratis LocationIQ (2 req/detik) lebih longgar dari Nominatim publik (1
// req/detik), tapi jeda yang sama tetap dipakai di sini — aman, tidak ada
// ruginya berhati-hati.
async function geocodeLocationIQ(text) {
  const segmen = text.split(",").map((s) => s.trim()).filter(Boolean);
  for (let mulai = 0; mulai < segmen.length; mulai++) {
    const coba = segmen.slice(mulai).join(", ");
    if (!coba) continue;
    const hasil = await locationIqSearch(coba);
    if (hasil) return hasil;
    if (mulai < segmen.length - 1) await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}

async function nominatimSearch(text) {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(text)}&format=json&countrycodes=id&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": NOMINATIM_USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data[0]) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), estimate: true };
}

// Nominatim: gratis, tanpa key, TAPI kebijakan pemakaian membatasi
// ~1 permintaan/detik dan melarang pemakaian massal — untuk skala Sano
// (dispatcher mengisi alamat satu-satu, bukan proses batch) ini aman.
//
// PENYEDERHANAAN BERTAHAP (ditemukan lewat tes langsung 30 Agustus 2026,
// bukan asumsi): alamat penuh ala sales ("Taman palem lestari blok a25 no
// 19b, cengkareng") HAMPIR SELALU gagal cocok di Nominatim — beda dengan
// Google, database OSM tidak punya data nomor rumah/blok sedetail itu
// untuk kebanyakan perumahan Indonesia. Tes backfill produksi: dari 143
// alamat asli, cuma 2 yang cocok apa adanya. Begitu bagian
// blok/nomor/RT-RW paling depan DIBUANG dan sisanya (kelurahan/kecamatan
// dst) dicoba sendiri, tingkat berhasil naik jauh — pin jadi level
// kelurahan/kecamatan, BUKAN presisi alamat rumah, tapi jauh lebih
// berguna daripada tidak ada pin sama sekali. `estimate: true` menandai
// ini SELALU, supaya UI tidak pernah menyajikannya seolah presisi rumah.
async function geocodeNominatim(text) {
  const segmen = text.split(",").map((s) => s.trim()).filter(Boolean);
  for (let mulai = 0; mulai < segmen.length; mulai++) {
    const coba = segmen.slice(mulai).join(", ");
    if (!coba) continue;
    const hasil = await nominatimSearch(coba);
    if (hasil) return hasil;
    if (mulai < segmen.length - 1) await new Promise((r) => setTimeout(r, 1100)); // hormati rate limit 1 req/detik
  }
  return null;
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

  try {
    const dariLink = await geocodeFromMapsLink(text);
    if (dariLink) return dariLink;
  } catch (err) {
    console.error("[maps] Gagal resolve link Google Maps di alamat, lanjut geocode teks:", err.message);
  }

  if (mapsConfigured()) {
    try {
      const hasil = await geocodeGoogle(text);
      if (hasil) return hasil;
    } catch (err) {
      console.error("[maps] Google geocode gagal, lanjut ke tingkat berikutnya:", err.message);
    }
  }

  // LocationIQ (D-044, 4 September 2026) — dicoba SEBELUM Nominatim publik:
  // sama-sama gratis & berbasis OSM, tapi hosted+cache-nya biasanya lebih
  // akurat utk alamat Indonesia. Diam-diam dilewati kalau key belum diisi
  // (locationIqConfigured() false) — bukan error, cuma belum diaktifkan.
  if (locationIqConfigured()) {
    try {
      const hasil = await geocodeLocationIQ(text);
      if (hasil) return hasil;
    } catch (err) {
      console.error("[maps] LocationIQ geocode gagal, coba Nominatim:", err.message);
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

// Rute jalan ASLI dari LocationIQ (bukan garis lurus) — D-044, 4 September
// 2026. SATU permintaan untuk SELURUH rute (semua stop jadi satu string
// koordinat "lon,lat;lon,lat;..."), sama semangatnya dengan Distance Matrix
// Google di atas: hemat kuota gratis (2 req/detik, jangan dipanggil per-leg).
// `overview=false` — tidak butuh geometri garis rute, cuma jarak/durasi per
// leg, jadi respons lebih ringan.
async function routeLegsLocationIQ(stops) {
  const koordinat = stops.map((s) => `${s.lng},${s.lat}`).join(";");
  const url = `${LOCATIONIQ_DIRECTIONS_URL}/${koordinat}?key=${locationIqKey()}&overview=false&steps=false`;
  const res = await fetch(url, { headers: { "User-Agent": NOMINATIM_USER_AGENT } });
  if (!res.ok) throw new Error(`LocationIQ Directions HTTP ${res.status}`);
  const data = await res.json();
  const legs = data.routes?.[0]?.legs;
  if (!Array.isArray(legs) || legs.length !== stops.length - 1) return null;
  return legs.map((leg) => ({
    distanceMeters: Math.round(leg.distance),
    durationSeconds: Math.round(leg.duration),
    estimate: false, // rute jalan asli, bukan garis lurus — sama tingkat kepercayaan dengan Google
  }));
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
      console.error("[maps] Distance Matrix gagal, coba LocationIQ:", err.message);
    }
  }

  // LocationIQ Directions (D-044) — rute jalan ASLI, bukan garis lurus,
  // dicoba SEBELUM jatuh ke haversine. Diam-diam dilewati kalau key belum
  // diisi.
  if (locationIqConfigured()) {
    try {
      const legs = await routeLegsLocationIQ(stops);
      if (legs) return legs;
    } catch (err) {
      console.error("[maps] LocationIQ Directions gagal, pakai estimasi garis lurus:", err.message);
    }
  }

  return haversineLegs(stops);
}
