// Jalur perjalanan driver + estimasi biaya tol (8 September 2026, permintaan
// owner: "tracking driver lewat jalan mana aja... tim management bisa
// pantau mereka lewat tol mana aja, dan akumulasi biaya nya, walaupun
// tidak akurat 100% tapi kita bisa tracking minimal").
//
// KEJUJURAN SKALA FITUR (owner sendiri sudah terima ini tidak akan 100%
// akurat) — TIDAK ADA API gratis yang memberi tahu "kendaraan ini lewat
// gerbang tol X jam Y" secara resmi. Yang dibangun di sini JUJUR dari data
// yang benar-benar ada:
//   1. Map-matching: JobPositionPing (GPS kasar, ping tiap ~2 menit selama
//      job EN_ROUTE — sudah berjalan live sejak D-034) ditempelkan ke
//      jaringan jalan ASLI lewat OSRM /match/, bukan garis lurus antar titik.
//   2. Deteksi tol: GEOMETRIS (jarak titik-ke-jalur terhadap ruas tol
//      terdaftar di TollRoad), BUKAN gerbang masuk/keluar presisi.
//   3. Estimasi biaya: tarif Golongan I RESMI per ruas (lihat
//      scripts/seed-toll-roads.js utk sumber), BUKAN tarif per gerbang
//      sungguhan yang dilalui.
// SEMUA hasil WAJIB ditandai "Estimasi" di pemanggil (routes/UI) — jangan
// pernah disajikan seolah tagihan pasti.
//
// Dihitung ULANG tiap diminta (TIDAK disimpan sebagai ledger) — sumber
// kebenaran tetap JobPositionPing mentah + TollRoad terbaru; kalau nanti
// ruas tol baru ditambahkan, trip LAMA otomatis ikut benar tanpa backfill.

import { prisma } from "../db.js";

// Server OSRM demo publik yang SAMA dipercaya di frontend/src/services/
// osrm.js (gratis, tanpa API key) — /match/ adalah endpoint SAUDARA dari
// /route/ yang sudah dipakai, dirancang persis untuk menempelkan trail GPS
// berisik ke jalan asli. BUKAN production SLA (server komunitas, bisa
// lambat/down) — pemanggil WAJIB terima null sebagai "gagal, tampilkan
// apa adanya" (mis. titik ping mentah tanpa map-match), bukan exception.
const OSRM_MATCH_URL = "https://router.project-osrm.org/match/v1/driving";
const TIMEOUT_MS = 15000;

// OSRM /match/ server demo publik praktis membatasi jumlah koordinat per
// request — didesimasi ke maksimal ini (ambil tiap ping ke-N) kalau lebih.
// Tidak mengorbankan tujuan deteksi tol (proximity check, bukan replay
// detik-demi-detik), cukup untuk rute seharian sekalipun.
const MAX_MATCH_POINTS = 100;

function decimateToMax(arr, max) {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  return arr.filter((_, i) => i % step === 0);
}

// Ambil SEMUA JobPositionPing dari SEMUA job di satu Route, urut waktu —
// jalur perjalanan sungguhan driver menyambung LINTAS job (tol yang
// dilewati ANTARA stop 2 dan 3 tidak boleh hilang cuma karena pingnya
// "milik" job yang berbeda).
async function collectRoutePings(routeId) {
  const jobs = await prisma.job.findMany({ where: { routeId }, select: { id: true } });
  if (jobs.length === 0) return [];
  const pings = await prisma.jobPositionPing.findMany({
    where: { jobId: { in: jobs.map((j) => j.id) } },
    orderBy: { recordedAt: "asc" },
    select: { lat: true, lng: true, accuracy: true, recordedAt: true },
  });
  return pings;
}

// Map-matching: trail GPS kasar -> geometri jalan asli. Return null kalau
// gagal (server demo down/timeout/data terlalu sedikit) — pemanggil WAJIB
// fallback ke titik ping mentah, sama disiplin dengan getRoadRoute() di
// frontend/src/services/osrm.js.
export async function matchRoutePath(routeId) {
  const pingsRaw = await collectRoutePings(routeId);
  if (pingsRaw.length < 2) return null;
  const pings = decimateToMax(pingsRaw, MAX_MATCH_POINTS);

  const coordStr = pings.map((p) => `${p.lng},${p.lat}`).join(";");
  const timestamps = pings.map((p) => Math.floor(new Date(p.recordedAt).getTime() / 1000)).join(";");
  // Radius toleransi per titik dari accuracy GPS HP driver kalau ada
  // (Location.Accuracy), fallback 30m — sama nilai yang dipakai badge UI
  // "posisi kurang akurat" di tempat lain.
  const radiuses = pings.map((p) => Math.round(p.accuracy || 30)).join(";");

  const url = `${OSRM_MATCH_URL}/${coordStr}?geometries=geojson&overview=full&timestamps=${timestamps}&radiuses=${radiuses}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    // OSRM /match/ bisa memecah trail jadi beberapa "matching" kalau ada
    // gap besar (mis. driver berhenti lama, sinyal hilang) — gabungkan
    // semua potongan jadi satu jalur berurutan, cukup untuk proximity
    // check (bukan butuh satu polyline tunggal yang mulus).
    const matchings = data?.matchings || [];
    if (matchings.length === 0) return null;
    const coords = matchings.flatMap((m) => (m.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]));
    if (coords.length === 0) return null;
    const confidence = matchings.reduce((s, m) => s + (m.confidence || 0), 0) / matchings.length;
    return { path: coords, confidence };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Ambang toleransi deteksi (meter) — mengakomodasi ketidaktepatan GPS HP +
// map-matching, BUKAN presisi lane-level. Dipilih longgar sengaja: lebih
// baik sesekali salah tandai ruas yang sejajar berdekatan (jarang di
// Jabodetabek) daripada melewatkan tol yang sungguhan dipakai.
const DETEKSI_JARAK_METER = 120;
// Porsi MINIMAL titik geometri ruas tol yang harus "didekati" jalur hasil
// map-match supaya dianggap "terdeteksi dipakai" — satu-dua titik kebetulan
// dekat (mis. jalan biasa yang sempat menyeberang dekat gerbang) TIDAK
// cukup, harus ada pola overlap yang berarti sepanjang ruas.
const DETEKSI_OVERLAP_MINIMUM = 0.15; // 15%

// Cek apakah `matchedPath` melintasi `tollRoad` — proximity GEOMETRIS
// (bukan gerbang presisi, lihat catatan kepala file). Return { overlap }
// (0..1, porsi titik ruas tol yang punya titik jalur di dekatnya).
function overlapRatio(matchedPath, tollGeometry) {
  if (matchedPath.length === 0 || tollGeometry.length === 0) return 0;
  let dekat = 0;
  for (const tollPoint of tollGeometry) {
    const adaDekat = matchedPath.some((p) => haversineMeters(p, tollPoint) <= DETEKSI_JARAK_METER);
    if (adaDekat) dekat++;
  }
  return dekat / tollGeometry.length;
}

// Deteksi ruas tol yang kemungkinan dilalui + akumulasi ESTIMASI biaya.
// `matchedPath` = hasil matchRoutePath().path (ATAU array ping mentah kalau
// map-matching gagal — proximity check tetap jalan, cuma kurang presisi
// karena belum ternap ke jalan).
export async function detectTollUsage(matchedPath) {
  if (!matchedPath || matchedPath.length === 0) {
    return { tolls: [], totalEstimasi: 0 };
  }
  const tollRoads = await prisma.tollRoad.findMany({ where: { active: true } });
  const tolls = [];
  for (const tr of tollRoads) {
    const geometry = Array.isArray(tr.geometry) ? tr.geometry : [];
    const overlap = overlapRatio(matchedPath, geometry);
    if (overlap >= DETEKSI_OVERLAP_MINIMUM) {
      tolls.push({
        name: tr.name,
        estimatedFare: tr.estimatedFareGol1,
        overlapPercent: Math.round(overlap * 100),
        source: tr.source,
        verifiedAt: tr.verifiedAt,
      });
    }
  }
  const totalEstimasi = tolls.reduce((s, t) => s + t.estimatedFare, 0);
  return { tolls, totalEstimasi };
}

// Titik masuk gabungan dipakai routes/armada.js — jalur + tol + estimasi
// dalam satu panggilan.
export async function traceRoute(routeId) {
  const matched = await matchRoutePath(routeId);
  const rawPings = matched ? null : await collectRoutePings(routeId);
  const path = matched?.path || (rawPings ? rawPings.map((p) => [p.lat, p.lng]) : []);
  const { tolls, totalEstimasi } = await detectTollUsage(path);
  return {
    path,
    pathIsMapMatched: Boolean(matched),
    matchConfidence: matched?.confidence ?? null,
    tolls,
    totalEstimasi,
  };
}
