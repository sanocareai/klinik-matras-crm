// Google Maps Platform — geocoding + jarak antar-stop (PRD FR-L-03).
//
// SENGAJA MINIMAL: TIDAK ada optimasi rute otomatis (VRP) — PRD §1.5 eksplisit
// melarangnya untuk v1 ("Jabodetabek traffic makes algorithmic optimization
// far less valuable than a dispatcher who knows that Bekasi in the afternoon
// is a mistake"). Dispatcher yang urutkan manual; modul ini cuma menghitung
// jarak/durasi RANTAI (leg demi leg) untuk urutan yang sudah dipilih, dan
// mengisi lat/lng dari LINK Maps.
//
// KEBIJAKAN GEOCODING DIPERKETAT jadi LINK-ONLY (8 September 2026, keputusan
// eksplisit owner setelah investigasi "Buat Peta mental kemana-mana": "kita
// perketat hanya link google maps saja, untuk orderan yang gaada google
// maps nya kasih notifikasi... ketika klik buat peta orderan yang gaada
// link nya terisi kosong dan harus cari manual admin deliverynya"). Ini
// MEMBALIK 3 iterasi sebelumnya (riwayat singkat, supaya tidak bingung kalau
// baca commit lama):
//   FASE 2 (30 Agt 2026) — billing Google ditolak -> tambah fallback GRATIS
//     Nominatim (tebak dari teks alamat, akurasi rendah utk alamat detail
//     Indonesia — lihat data lama: dari 143 alamat, cuma 2 cocok apa adanya).
//   FASE 3 (4 Sep 2026) — tambah LocationIQ sbg tingkat kedua (di atas
//     Nominatim), sama-sama tebakan berbasis teks, sama-sama TIDAK akurat
//     untuk alamat detail.
//   7 Sep 2026 — billing Google akhirnya aktif -> Google Geocoding API
//     dipasang sbg tingkat KEDUA (di atas LocationIQ/Nominatim, di bawah
//     link) — lebih baik dari Nominatim/LocationIQ, TAPI tetap tebakan dari
//     teks, bukan titik yang benar-benar dikonfirmasi customer.
// Owner menyimpulkan: SEMUA tingkat tebakan-dari-teks (Google/LocationIQ/
// Nominatim sekalipun) tidak cukup dipercaya untuk pin pengiriman —
// SATU-SATUNYA sumber yang boleh dipakai sekarang adalah LINK Google Maps
// (Order.locationUrl, atau link yang kebetulan nempel di addressText) —
// titik yang benar-benar customer/sales tandai sendiri. Job TANPA link
// dibiarkan `lat/lng` null SELAMANYA (bukan ditebak) — itu yang memicu
// badge "Tanpa link Maps" (JobBadges.jsx) dan membuat "Buat Peta"
// mengecualikan stop itu dari URL (buildRouteMapsUrl di bawah), memaksa
// admin delivery mencari lokasinya manual, bukan mempercayai tebakan.
//
// geocodeGoogle/geocodeLocationIQ/geocodeNominatim (geocoding berbasis
// TEKS) SUDAH DIHAPUS dari file ini — bukan disimpan "siapa tahu perlu
// lagi". Distance Matrix Google & LocationIQ Directions DI BAWAH (jarak/
// durasi ANTAR DUA TITIK YANG SUDAH PUNYA KOORDINAT, bukan menebak
// koordinat dari teks) TIDAK terpengaruh kebijakan ini sama sekali — beda
// masalah, tetap dipakai apa adanya.

const DISTANCE_MATRIX_URL = "https://maps.googleapis.com/maps/api/distancematrix/json";
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
// Link pendek (maps.app.goo.gl) redirect ke URL panjang — diambil dari
// `res.url` setelah fetch mengikuti redirect (Node fetch bawaan sudah
// `redirect: "follow"` secara default, tidak perlu library tambahan).
//
// DIPERLUAS 8 September 2026 — investigasi laporan owner (customer Steven,
// RES-26082026-173: link Maps kosong di desktop tapi muncul di HP). Root
// cause link ITU SENDIRI bukan bug kita (Google short-link ke pin
// Plus-Code-only kadang gagal render browser desktop, lihat perbaikan
// mapsUrl() di frontend/jobStatus.js). TAPI investigasi itu menemukan bug
// TERPISAH yang NYATA: dites 27 link produksi, 7 gagal di-resolve sama
// sekali oleh geocodeFromMapsLink() versi lama — Google TERNYATA merender
// redirect share-link ke BEBERAPA bentuk URL berbeda tergantung jenis pin,
// bukan cuma satu pola `!3d!4d`:
//   1. `!3d<lat>!4d<lng>` — dropped pin polos, TETAP pola utama (presisi
//      tertinggi, tanpa panggilan API tambahan).
//   2. `q=<lat>,<lng>` di query string — presisi SAMA dengan #1, cuma
//      lewat jalur redirect `/maps?q=...` bukan `/maps/place/...!3d!4d`.
//   3. `/maps/place/<PlusCode+Nama Tempat>/` — link ke POI/place BERNAMA
//      (apartemen, kompleks) TIDAK membawa koordinat mentah di URL sama
//      sekali, Google gantikan dengan Place ID. TAPI path-nya selalu
//      diawali Plus Code ("XM6V+64X Tokyo Riverside...") — referensi grid
//      geografis presisi, BUKAN nama bebas — aman diverifikasi ulang lewat
//      Geocoding API (dites langsung: hasilnya ROOFTOP).
//   4. `q=<alamat lengkap>&ftid=...` — kadang Google SENDIRI yang
//      reverse-geocode pin jadi alamat lengkap (jalan+RT/RW+kelurahan+
//      kecamatan+kota) saat redirect. Beda dari "menebak dari alamat
//      ketikan sales" (itu yang sudah dibuang kebijakan link-only) — ini
//      alamat hasil Google reverse-geocode PIN ASLI, cuma perlu digeocode
//      ulang lewat Geocoding API untuk dapat lat/lng-nya.
// #3 dan #4 BUTUH panggilan Geocoding API tambahan (geocodeViaGoogleApi di
// bawah) — supaya TIDAK diam-diam kembali jadi "tebakan level kelurahan"
// (persis yang dibuang kebijakan link-only), hasilnya CUMA diterima kalau
// location_type Google ROOFTOP/RANGE_INTERPOLATED (presisi tinggi);
// GEOMETRIC_CENTER/APPROXIMATE (match area luas) DITOLAK, fungsi tetap
// balik null seperti sebelumnya — bukan diam-diam menerima tebakan kasar.
//
// `share.google` (domain BARU Google, ditemukan investigasi ini — sudah
// pernah dipakai juga di komentar DEPOT di bawah) ditambahkan ke daftar
// domain yang dikenali — kadang redirect ke halaman SEARCH (bukan Maps)
// dengan query cuma nama tempat tanpa alamat, tapi itu tetap lewat jalur
// #4 di atas dan jaring pengaman ROOFTOP/RANGE_INTERPOLATED yang sama.
// Protokol `https?:\/\/` DIBUAT OPSIONAL (8 September 2026, ditemukan
// investigasi bug "alamat Lim Fie Boen beda antara Sales CRM & Delivery"
// — Order.locationUrl order itu tersimpan sebagai `google.com/maps?q=...`
// TANPA "https://" sama sekali. Akar penyebab: address bar Chrome/Safari
// SECARA DEFAULT menyembunyikan skema URL dari tampilan (cuma nampilin
// "google.com/maps?q=..." walau alamat sebenarnya "https://google.com/
// maps?q=..."), jadi copy-paste APA ADANYA dari address bar kehilangan
// protokolnya. Regex versi lama MEWAJIBKAN protokol di depan — link tanpa
// itu GAGAL MATCH SAMA SEKALI, geocodeFromMapsLink() balik null diam-diam
// walau linknya sah dan lengkap. Match tetap dilakukan tanpa protokol,
// tapi `fetch()` di bawah butuh URL absolut — protokol ditambahkan balik
// SEBELUM fetch kalau ternyata belum ada (lihat geocodeFromMapsLink()).
const GOOGLE_MAPS_LINK_RE = /(?:https?:\/\/)?(?:maps\.app\.goo\.gl|goo\.gl\/maps|share\.google|(?:www\.)?google\.com\/maps)\S*/i;
const LATLNG_BANG_RE = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/;
const LATLNG_QUERY_RE = /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)(?:&|$)/;
const PLACE_PATH_RE = /\/maps\/place\/([^/]+)\//;
const QUERY_TEXT_RE = /[?&]q=([^&]+)/;
// Tier 5 — link DIRECTIONS dua-titik `/maps/dir/<lat1>,<lng1>/<lat2>,<lng2>/`
// (8 September 2026, ditemukan investigasi laporan owner: Aurelina Nani/
// RES-08092026-035 — link Maps ADA di order tapi tetap "Belum ada link"
// di badge, gaikut ke peta rute). Resolve manual (curl -L) ke link itu
// KONFIRMASI bentuknya: dua koordinat mentah, BUKAN salah satu dari 4
// pola di atas — muncul kalau seseorang share dari layar DIREKSI (rute
// A->B), bukan dari layar satu pin/tempat. TIDAK dikenali sama sekali
// oleh regex Tier 1-4, geocodeFromMapsLink() jatuh ke null diam-diam.
const DIR_TWO_POINTS_RE = /\/maps\/dir\/(-?\d+\.\d+),(-?\d+\.\d+)\/(-?\d+\.\d+),(-?\d+\.\d+)\//;

// Verifikasi teks lokasi (Plus Code+nama tempat, ATAU alamat hasil
// reverse-geocode Google sendiri) lewat Geocoding API — dipakai HANYA oleh
// geocodeFromMapsLink() untuk pola #3/#4 di atas, BUKAN jalur baru untuk
// menggeocode Job.addressText bebas (kebijakan link-only TIDAK berubah,
// input di sini SELALU teks yang Google sendiri taruh di URL redirect,
// bukan ketikan sales). Filter presisi (ROOFTOP/RANGE_INTERPOLATED saja)
// mencegah ini diam-diam jadi jalur tebakan kelurahan/kecamatan lagi.
async function geocodeViaGoogleApi(addressText) {
  const key = apiKey();
  if (!key || !addressText) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressText)}&key=${key}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK" || !data.results?.length) return null;
  const top = data.results[0];
  const presisiTinggi = ["ROOFTOP", "RANGE_INTERPOLATED"].includes(top.geometry?.location_type);
  if (!presisiTinggi) return null;
  return { lat: top.geometry.location.lat, lng: top.geometry.location.lng, estimate: false };
}

// Path/query URL Google pakai "+" sebagai spasi (bukan cuma di query
// string form-encoded — REDIRECT Maps ternyata pakai konvensi yang sama di
// path segment juga, dibuktikan lewat tes langsung 8 Sep 2026). Urutan
// WAJIB: ganti "+" jadi spasi DULU, baru decodeURIComponent — supaya "+"
// literal di dalam Plus Code (di-escape Google jadi "%2B") tidak ikut
// kena ganti jadi spasi.
function teksDariUrlSegment(segment) {
  return decodeURIComponent(segment.replace(/\+/g, " "));
}

// Lokasi Klinik Matras by SANO CARE (D-076, 4 September 2026 — DIKOREKSI 6
// September 2026). Laporan owner: "buat semua jalur mulai dan berakhir di
// lokasi klinik matras". Koordinat SEBELUMNYA (-6.38784855, 106.8177975,
// dari link share.google/dOuyp6vGICSFLPCrZ) TERNYATA salah pin — laporan
// owner LANGSUNG: begitu dipakai bikin rute di Google Maps, titik awal/
// akhirnya bukan alamat Klinik Matras sungguhan.
//
// Koordinat BARU diambil dari link yang owner kirim ulang
// (maps.app.goo.gl/AbZ3TKZHgCcNdnF99 → resolve ke tempat "KLINIK MATRAS by
// SANO CARE" yang SAMA di Google Maps, cuma pin-nya beda/lebih akurat dari
// link lama), diverifikasi silang lewat reverse-geocode Nominatim: Pancoran
// Mas, Depok, Jawa Barat 16435 — cocok PERSIS dengan alamat yang owner
// sebutkan ("Jl. Raya Keadilan Jl. Asrama Polri No.81, RT.5/RW.12,
// Pancoran Mas, Kota Depok, Jawa Barat 16434"). SATU sumber kebenaran
// untuk seluruh backend — jangan hardcode ulang angka ini di tempat lain,
// import dari sini.
export const DEPOT = { lat: -6.4036521, lng: 106.7839743, label: "Klinik Matras" };

export async function geocodeFromMapsLink(text) {
  const match = text.match(GOOGLE_MAPS_LINK_RE);
  if (!match) return null;
  // Protokol ditambahkan balik kalau match-nya tidak bawa (lihat catatan
  // panjang di GOOGLE_MAPS_LINK_RE) — fetch() butuh URL absolut.
  const urlUntukFetch = /^https?:\/\//i.test(match[0]) ? match[0] : `https://${match[0]}`;
  const res = await fetch(urlUntukFetch);
  const finalUrl = res.url;

  // Tier 1-2: koordinat MENTAH langsung di URL redirect — tanpa panggilan
  // API tambahan, presisi tertinggi. Lihat catatan panjang di atas
  // GOOGLE_MAPS_LINK_RE untuk kapan masing-masing pola muncul.
  const bang = finalUrl.match(LATLNG_BANG_RE);
  if (bang) return { lat: parseFloat(bang[1]), lng: parseFloat(bang[2]), estimate: false };
  const queryLatLng = finalUrl.match(LATLNG_QUERY_RE);
  if (queryLatLng) return { lat: parseFloat(queryLatLng[1]), lng: parseFloat(queryLatLng[2]), estimate: false };

  // Tier 3: link POI/place bernama, path diawali Plus Code — presisi
  // grid geografis, aman diverifikasi lewat Geocoding API.
  const placePath = finalUrl.match(PLACE_PATH_RE);
  if (placePath) {
    const hasil = await geocodeViaGoogleApi(teksDariUrlSegment(placePath[1]));
    if (hasil) return hasil;
  }

  // Tier 4: alamat/nama tempat di query `q=` (Google reverse-geocode pin
  // sendiri, ATAU fallback share.google) — sama jaring pengaman presisi.
  const queryText = finalUrl.match(QUERY_TEXT_RE);
  if (queryText) {
    const hasil = await geocodeViaGoogleApi(teksDariUrlSegment(queryText[1]));
    if (hasil) return hasil;
  }

  // Tier 5: link DIREKSI dua-titik (lihat catatan panjang di
  // DIR_TWO_POINTS_RE di atas). Koordinat MENTAH langsung dari URL (tidak
  // butuh Geocoding API tambahan, presisi sama dengan Tier 1-2) — TAPI
  // pilihan TITIK KEDUA (tujuan) sebagai lokasi customer adalah HEURISTIK,
  // bukan kepastian: asumsinya orang yang share link ini sedang MELIHAT
  // arah KE customer (titik pertama = posisi dia saat itu, tidak relevan;
  // titik kedua = tujuan, kemungkinan besar lokasi customer). Kalau
  // ternyata sering salah di lapangan, ini titik yang perlu ditinjau
  // ulang duluan — dicatat eksplisit di sini supaya gampang dilacak,
  // bukan diam-diam dianggap presisi tinggi seperti Tier 1-2.
  const dirTwoPoints = finalUrl.match(DIR_TWO_POINTS_RE);
  if (dirTwoPoints) {
    return { lat: parseFloat(dirTwoPoints[3]), lng: parseFloat(dirTwoPoints[4]), estimate: false };
  }

  return null;
}

function apiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || "";
}

// Dipakai HANYA oleh routeLegs() (Distance Matrix, jarak/durasi antar dua
// koordinat yang SUDAH ADA) — TIDAK dipakai geocoding lagi sejak kebijakan
// link-only, lihat catatan panjang di kepala file.
export function mapsConfigured() {
  return apiKey().length > 0;
}

function locationIqKey() {
  return process.env.LOCATIONIQ_API_KEY || "";
}

// Dipakai HANYA oleh routeLegs() (LocationIQ Directions, jarak/durasi jalan
// asli) — sama catatan dengan mapsConfigured() di atas.
export function locationIqConfigured() {
  return locationIqKey().length > 0;
}

// geocodeAddress(text, locationUrlHint?) -> { lat, lng, estimate: false } | null.
// KEBIJAKAN LINK-ONLY (8 September 2026, lihat catatan panjang di kepala
// file) — HANYA mengembalikan koordinat kalau ada LINK Google Maps yang
// bisa di-resolve, dari salah satu dari dua sumber:
//   1. `locationUrlHint` — Order.locationUrl, dicoba PALING PERTAMA
//      (field yang MEMANG didedikasikan untuk ini, diisi sales/admin saat
//      konfirmasi lokasi customer).
//   2. Link yang KEBETULAN ditempel di `text` (Job.addressText) — sales
//      kadang menempel link share lokasi di belakang alamat teks.
// TIDAK ADA LAGI fallback ke geocoding berbasis teks (Google/LocationIQ/
// Nominatim) — kalau dua sumber di atas sama-sama tidak ada/gagal,
// fungsi ini mengembalikan `null` apa adanya, BUKAN menebak dari teks
// alamat. `estimate` SELALU `false` sekarang (tidak ada lagi hasil
// "perkiraan" — kalau bukan dari link, ya tidak ada hasil sama sekali).
// Best-effort — SELALU dibungkus try/catch oleh pemanggil, gagal geocode
// BUKAN alasan menolak simpan job (alamat teks tetap tersimpan apa adanya).
export async function geocodeAddress(text, locationUrlHint) {
  if (locationUrlHint) {
    try {
      const dariOrder = await geocodeFromMapsLink(locationUrlHint);
      if (dariOrder) return dariOrder;
    } catch (err) {
      console.error("[maps] Gagal resolve link Maps order:", err.message);
    }
  }

  if (!text || !text.trim()) return null;

  try {
    return await geocodeFromMapsLink(text);
  } catch (err) {
    console.error("[maps] Gagal resolve link Google Maps di alamat:", err.message);
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
// Gagal/tidak terkonfigurasi -> fallback haversineLegs, BUKAN throw (jarak/
// durasi tetap best-effort, beda kebijakan dari geocoding link-only di atas
// — lihat catatan kepala file).
// ─── LINK GOOGLE MAPS MULTI-STOP (redesain Route Planner, Sep 2026) ─────────
// Dispatcher SEBELUM ini menyusun rute di Google Maps MANUAL: buka Maps,
// tempel alamat satu-satu sesuai urutan, baru copy link untuk di-share ke
// grup WA driver. Fungsi ini membuat link itu OTOMATIS dari urutan stop yang
// sudah disusun di Route Planner (Job.sequence).
//
// SENGAJA pakai URL publik `google.com/maps/dir` (skema `api=1` + parameter
// origin/destination/waypoints) — BUKAN Directions API berbayar, murni demi
// kesederhanaan (satu URL publik, tanpa key/billing terpisah untuk fitur
// ini) — BUKAN lagi karena billing ditolak (billing SUDAH aktif sejak 7
// September 2026, lihat catatan kepala file — baris ini DIKOREKSI 8
// September 2026, sebelumnya menyebut billing "TERBUKTI DITOLAK", itu
// sudah tidak akurat).
//
// Format per stop LINK-ONLY (8 September 2026, keputusan owner — lihat
// catatan panjang di kepala file): stop TANPA lat/lng (artinya order-nya
// TIDAK punya link Maps sama sekali — di bawah kebijakan link-only,
// lat/lng cuma pernah terisi dari link) DIKECUALIKAN dari URL, BUKAN
// diisi teks alamat sebagai fallback lagi seperti sebelumnya. Dispatcher
// sengaja TIDAK dapat pin tebakan untuk stop itu — `excludedCount` di
// buildRouteMapsUrl() memberi tahu berapa stop yang dikecualikan, supaya
// UI bisa memperingatkan admin delivery: cari lokasinya manual.
//
// BULAT-BALIK dari/ke Klinik (origin=destination=DEPOT) — konsisten dengan
// asumsi routeLegs()/publish (D-076): rute SELALU dianggap berangkat dan
// kembali ke klinik.
//
// ⚠️ BATAS WAYPOINT: Google Maps (versi konsumer, bukan API berbayar) TIDAK
// mendokumentasikan batas pasti, tapi SECARA PRAKTIK UI web/app pernah
// terbukti mengabaikan/memotong diam-diam kalau waypoint terlalu banyak
// (umum dilaporkan sekitar 9-10 stop). Field `stopCount` dikembalikan supaya
// UI bisa memperingatkan dispatcher untuk rute yang sangat panjang — TIDAK
// dipotong otomatis di sini (memotong diam-diam lebih buruk: dispatcher
// mengira semua stop masuk padahal tidak).
function stopParam(stop) {
  if (stop.lat != null && stop.lng != null) return `${stop.lat},${stop.lng}`;
  return null;
}

export function buildRouteMapsUrl(jobs) {
  const terurut = [...jobs].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  const excluded = terurut.filter((j) => j.lat == null || j.lng == null);
  const params = terurut.map(stopParam).filter(Boolean);

  if (params.length === 0) return { url: null, stopCount: 0, excludedCount: excluded.length };

  const depotParam = `${DEPOT.lat},${DEPOT.lng}`;
  const url =
    `https://www.google.com/maps/dir/?api=1&travelmode=driving` +
    `&origin=${depotParam}&destination=${depotParam}` +
    `&waypoints=${params.join("|")}`;

  return { url, stopCount: params.length, excludedCount: excluded.length };
}

// Persingkat URL Maps SUPAYA rapi di broadcast WA (6 September 2026,
// laporan owner: link waypoint mentah panjangnya berbaris-baris, "hasil
// broadcast nya lumayan berantakan" — contoh format pendek yang diinginkan:
// https://maps.app.goo.gl/xxx). maps.app.goo.gl SENDIRI cuma bisa dibuat
// dari dalam app/situs Google Maps (tombol "Share") — TIDAK ADA API publik
// untuk generate link berformat itu langsung dari URL directions apa pun.
// TinyURL dipakai sebagai gantinya (API publik GRATIS, tanpa API key,
// endpoint GET sederhana) — hasilnya bukan domain maps.app.goo.gl persis,
// tapi SAMA-SAMA pendek+1-baris+langsung buka Google Maps kalau diklik,
// itu inti keluhannya. BEST-EFFORT murni (pola sama dengan geocoding
// fallback di atas): timeout 5 detik + try/catch, gagal apa pun alasannya
// -> balik ke URL panjang aslinya, publish/broadcast TETAP jalan, bukan
// tertahan atau gagal total cuma karena layanan pemendek link sedang down.
export async function shortenUrl(url) {
  if (!url) return url;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return url;
    const short = (await res.text()).trim();
    return short.startsWith("http") ? short : url;
  } catch (err) {
    console.error("[maps] shortenUrl gagal, pakai URL panjang:", err.message);
    return url;
  }
}

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
