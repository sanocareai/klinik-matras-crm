// Routing jalan sungguhan via OSRM demo publik (D-075, 4 September 2026) —
// GRATIS, TANPA API key (Google Maps billing masih REQUEST_DENIED, lihat
// catatan di RouteMap.jsx/ArmadaTracking.jsx). Laporan owner: garis rute di
// peta masih LURUS antar titik, tidak seperti Google Maps yang ngikutin
// jalan asli — file ini yang menyediakan geometri jalan sungguhan itu.
//
// ⚠️ router.project-osrm.org adalah server DEMO komunitas, BUKAN production
// SLA — bisa lambat/down sewaktu-waktu, TIDAK BOLEH diandalkan sebagai satu-
// satunya sumber. SEMUA pemanggil WAJIB fallback ke garis lurus antar titik
// kalau ini gagal (timeout/error apa pun) — return null di sini artinya
// "gagal, silakan fallback", BUKAN exception yang harus ditangkap try/catch
// di pemanggil.
//
// Cache in-memory sederhana (Map, key dari titik yang dibulatkan 5 desimal
// ~1m presisi) supaya render ulang / polling (ArmadaTracking tiap 15 detik)
// tidak memanggil ulang endpoint publik untuk titik yang persis sama.
const cache = new Map();
const TIMEOUT_MS = 6000;

function keyOf(points) {
  return points.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(";");
}

/**
 * Ambil geometri rute yang ngikutin jalan asli, urut sesuai `points`.
 * @param {[number, number][]} points - array [lat, lng], minimal 2 titik.
 * @returns {Promise<{coords: [number, number][], legDurations: number[]} | null>}
 *   `coords` = titik-titik jalan asli (lebih rapat dari `points`, untuk
 *   digambar sebagai Polyline). `legDurations` = detik tempuh per segmen
 *   antar `points` berurutan (panjang = points.length - 1), berguna untuk
 *   badge estimasi waktu per stop. `null` kalau gagal — WAJIB fallback ke
 *   garis lurus antar `points` apa adanya.
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
    return null; // fallback ke garis lurus — lihat komentar di atas
  }
}
