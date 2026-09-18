// Routing jalan sungguhan via OSRM demo publik — port LANGSUNG dari
// frontend/src/services/osrm.js (web ArmadaTracking.jsx), GRATIS tanpa API
// key. Laporan owner (18 September 2026): garis rute di peta Live Tracking
// app masih LURUS antar titik, beda dari web yang sudah pakai OSRM sejak
// D-075 — file ini port fungsi yang SAMA supaya app ikut jalan asli juga.
//
// ⚠️ router.project-osrm.org server DEMO komunitas, BUKAN production SLA —
// bisa lambat/down sewaktu-waktu. SEMUA pemanggil WAJIB fallback ke garis
// lurus antar titik kalau ini gagal — return null di sini artinya "gagal,
// silakan fallback", BUKAN exception yang harus ditangkap try/catch di
// pemanggil.
const cache = new Map();
const TIMEOUT_MS = 6000;

function keyOf(points) {
  return points.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(";");
}

/**
 * Ambil geometri rute yang ngikutin jalan asli, urut sesuai `points`.
 * @param {[number, number][]} points - array [lat, lng], minimal 2 titik.
 * @returns {Promise<{coords: [number, number][], legDurations: number[]} | null>}
 */
export async function getRoadRoute(points) {
  if (!points || points.length < 2) return null;
  const key = keyOf(points);
  if (cache.has(key)) return cache.get(key);

  const coordStr = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route?.geometry?.coordinates?.length) return null;
    const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const legDurations = (route.legs || []).map((l) => l.duration || 0);
    const result = { coords, legDurations };
    cache.set(key, result);
    return result;
  } catch {
    clearTimeout(timer);
    return null;
  }
}
