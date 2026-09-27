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
  && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180
  && !(Number(lat) === 0 && Number(lng) === 0); // (0,0) = "null island": nilai bawaan GPS yang belum fix, bukan lokasi driver

export const TOLERANSI_JAM_MAJU_MENIT = 5; // selisih jam HP driver vs server yang masih wajar
export const ALASAN_POSISI = {
  BELUM_ADA: "Belum ada posisi GPS",
  KOORDINAT_TIDAK_VALID: "Koordinat GPS tidak valid",
  WAKTU_TIDAK_VALID: "Waktu posisi GPS tidak valid",
  WAKTU_MASA_DEPAN: "Waktu posisi GPS tidak wajar (di masa depan)",
};

/** Periksa posisi terakhir dari server: koordinat dan timestamp harus valid sebelum boleh jadi marker. */
export function periksaPosisi(lp, now = Date.now()) {
  if (!lp) return { valid: false, alasan: "BELUM_ADA", menit: null };
  if (!koordinatValid(lp.lat, lp.lng)) return { valid: false, alasan: "KOORDINAT_TIDAK_VALID", menit: null };
  const t = lp.recordedAt ? new Date(lp.recordedAt).getTime() : NaN;
  if (!Number.isFinite(t)) return { valid: false, alasan: "WAKTU_TIDAK_VALID", menit: null };
  if (t - now > TOLERANSI_JAM_MAJU_MENIT * 60000) return { valid: false, alasan: "WAKTU_MASA_DEPAN", menit: null };
  return { valid: true, alasan: null, menit: umurMenit(lp.recordedAt, now) };
}

/**
 * Ubah respons /armada/tracking (+ rute hari ini) menjadi satu daftar armada seragam.
 * "Terdaftar" = setiap item di daftar (rute terbit/berjalan atau job menuju lokasi). "Punya posisi" = item yang `marker`-nya
 * bukan null: koordinat DAN waktu GPS valid. Posisi depot TIDAK dijadikan marker karena itu bukan lokasi driver.
 */
export function bentukArmada(tracking, rute = [], now = Date.now()) {
  const petaRute = new Map((rute || []).map((r) => [r.id, r]));
  const hasil = [];
  for (const x of Array.isArray(tracking) ? tracking : []) {
    const lp = x.lastPosition;
    const cek = periksaPosisi(lp, now);
    const menit = cek.menit;
    const rt = x.kind === "route" ? petaRute.get(x.routeId) : null;
    const stops = x.stops || [];
    const selesai = stops.filter((s) => s.status === "COMPLETED").length;
    const aktif = x.kind === "route" ? stops.find((s) => s.jobId === x.activeJobId) : null;
    const segar = kesegaran(menit);
    hasil.push({
      key: x.routeId || x.jobId,
      kind: x.kind,
      tipe: x.kind === "loose" ? x.type || null : null,
      routeId: x.routeId || null,
      jobId: x.kind === "route" ? x.activeJobId || null : x.jobId,
      driver: x.driverName || null,
      helper: x.helperName || null,
      fotoDriver: x.driverAvatarUrl || null,
      fotoHelper: x.helperAvatarUrl || null,
      online: !!x.driverOnline,
      kendaraan: rt?.vehicle?.plateNumber || null,
      kodeRute: x.routeCode || null,
      fase: x.kind === "route" ? x.phase : x.status,
      stopSelesai: x.kind === "route" ? selesai : null,
      stopTotal: x.kind === "route" ? stops.length : null,
      berikutnya: aktif ? (aktif.customerName || aktif.orderNumber || null) : (x.kind === "loose" ? (x.customerName || x.orderNumber || null) : null),
      order: x.kind === "loose" ? x.orderNumber || null : aktif?.orderNumber || null,
      menit,
      dataTerakhir: cek.valid ? lp.recordedAt : null,
      adaPosisi: cek.valid,
      alasanTanpaPosisi: cek.valid ? null : cek.alasan,
      segar: cek.valid ? segar : { ...segar, label: ALASAN_POSISI[cek.alasan] },
      marker: cek.valid ? { lat: Number(lp.lat), lng: Number(lp.lng), akurasi: lp.accuracy ?? null } : null,
    });
  }
  // Marker tersegar dulu; yang tanpa GPS paling akhir.
  return hasil.sort((a, b) => (a.menit ?? 1e9) - (b.menit ?? 1e9));
}

/** Hitungan untuk header: terdaftar (ada di daftar) vs punya posisi (marker valid), dan berapa yang posisinya lama. */
export function ringkasArmada(armada) {
  const list = armada || [];
  const denganPosisi = list.filter((a) => a.adaPosisi);
  return {
    terdaftar: list.length,
    denganPosisi: denganPosisi.length,
    tanpaPosisi: list.length - denganPosisi.length,
    posisiLama: denganPosisi.filter((a) => a.segar.kode === "LAMA").length,
  };
}

/** Kunci himpunan marker (perubahan himpunan → fit ulang peta; pergeseran GPS biasa tidak). */
export const kunciMarker = (armada) => (armada || []).filter((a) => a.adaPosisi).map((a) => a.key).sort().join("|");

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
