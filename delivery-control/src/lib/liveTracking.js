// Logika murni Live Tracking (tanpa React Native) supaya bisa diuji di Node.
// Sumber data: GET /armada/tracking (posisi GPS terakhir yang dikirim app Driver ke server) digabung dengan
// GET /armada/routes?date=hari-ini (kendaraan per rute). Control TIDAK membaca lokasi HP sendiri.

export const AMBANG_SEGAR_MENIT = 5;
export const AMBANG_LAMA_MENIT = 15;

export function umurMenit(recordedAt, now = Date.now()) {
  if (!recordedAt) return null;
  const t = new Date(recordedAt).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60000)) : null;
}

/** Kesegaran posisi: SEGAR (<=5 mnt), LAMBAT (<=15 mnt), LAMA (>15 mnt), TANPA (belum pernah kirim GPS). */
export function kesegaran(menit) {
  if (menit == null) return { kode: "TANPA", label: "Belum ada posisi GPS", tone: "neutral" };
  if (menit <= AMBANG_SEGAR_MENIT) return { kode: "SEGAR", label: "Posisi segar", tone: "green" };
  if (menit <= AMBANG_LAMA_MENIT) return { kode: "LAMBAT", label: "Posisi agak lama", tone: "orange" };
  return { kode: "LAMA", label: "Sinyal lama", tone: "red" };
}

export function umurLabel(menit) {
  if (menit == null) return "Belum ada posisi GPS";
  if (menit < 1) return "Baru saja";
  if (menit < 60) return `${menit} menit lalu`;
  const j = Math.floor(menit / 60);
  return `${j} jam lalu`;
}

const koordinatValid = (lat, lng) => lat != null && lng != null && lat !== "" && lng !== ""
  && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;

/**
 * Ubah respons /armada/tracking (+ rute hari ini) menjadi satu daftar armada seragam.
 * Setiap item punya `marker` (koordinat GPS asli) atau null bila belum pernah mengirim GPS — posisi depot
 * TIDAK dijadikan marker karena itu bukan lokasi driver.
 */
export function bentukArmada(tracking, rute = [], now = Date.now()) {
  const petaRute = new Map((rute || []).map((r) => [r.id, r]));
  const hasil = [];
  for (const x of Array.isArray(tracking) ? tracking : []) {
    const lp = x.lastPosition;
    const ada = lp && koordinatValid(lp.lat, lp.lng);
    const menit = ada ? umurMenit(lp.recordedAt, now) : null;
    const rt = x.kind === "route" ? petaRute.get(x.routeId) : null;
    const stops = x.stops || [];
    const selesai = stops.filter((s) => s.status === "COMPLETED").length;
    const aktif = x.kind === "route" ? stops.find((s) => s.jobId === x.activeJobId) : null;
    hasil.push({
      key: x.routeId || x.jobId,
      kind: x.kind,
      tipe: x.kind === "loose" ? x.type || null : null,
      routeId: x.routeId || null,
      jobId: x.kind === "route" ? x.activeJobId || null : x.jobId,
      driver: x.driverName || null,
      helper: x.helperName || null,
      online: !!x.driverOnline,
      kendaraan: rt?.vehicle?.plateNumber || null,
      kodeRute: x.routeCode || null,
      fase: x.kind === "route" ? x.phase : x.status,
      stopSelesai: x.kind === "route" ? selesai : null,
      stopTotal: x.kind === "route" ? stops.length : null,
      berikutnya: aktif ? (aktif.customerName || aktif.orderNumber || null) : (x.kind === "loose" ? (x.customerName || x.orderNumber || null) : null),
      order: x.kind === "loose" ? x.orderNumber || null : aktif?.orderNumber || null,
      menit,
      dataTerakhir: ada ? lp.recordedAt : null,
      segar: kesegaran(menit),
      marker: ada ? { lat: Number(lp.lat), lng: Number(lp.lng), akurasi: lp.accuracy ?? null } : null,
    });
  }
  // Marker tersegar dulu; yang tanpa GPS paling akhir.
  return hasil.sort((a, b) => (a.menit ?? 1e9) - (b.menit ?? 1e9));
}

/** Wilayah peta yang memuat semua marker (dengan sedikit ruang). Null bila tidak ada marker. */
export function batasPeta(armada) {
  const m = armada.map((a) => a.marker).filter(Boolean);
  if (m.length === 0) return null;
  const lats = m.map((x) => x.lat), lngs = m.map((x) => x.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const pad = (v) => Math.max(v * 1.6, 0.01);
  return { latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2, latitudeDelta: pad(maxLat - minLat), longitudeDelta: pad(maxLng - minLng) };
}

export const WARNA_MARKER = { SEGAR: "#16A34A", LAMBAT: "#EA8A14", LAMA: "#DC2626", TANPA: "#8793A8" };
