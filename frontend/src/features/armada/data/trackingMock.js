// ─── SIMULASI LIVE TRACKING (Tahap 4) ───────────────────────────────────────
//
// ⚠️ SELURUH ISI FILE INI DATA SIMULASI, DITEGASKAN OLEH KETENTUAN, bukan
// keterbatasan sementara seperti deliveryMock.js Tahap 1. Instruksi eksplisit:
// "Gunakan simulasi titik posisi. Jangan gunakan geolocation asli. Jangan
// meminta izin lokasi browser. Jangan menggunakan map API eksternal."
//
// Artinya halaman ini TIDAK AKAN pernah "naik jadi nyata" begitu saja seperti
// Vehicle/Route di Tahap 3 — posisi asli driver butuh mereka mengirim GPS dari
// HP-nya secara berkala (PRD FR-L-06: "position ping every 2 min while route
// is active"), dan TIDAK ADA tabel/endpoint untuk itu di backend. Membangunnya
// sekarang berarti mengarang data ping yang tidak pernah benar-benar
// dikirim siapa pun — jadi tetap simulasi sampai ada keputusan sadar untuk
// membangun pengiriman posisi sungguhan dari aplikasi driver.
//
// Koordinat X/Y di sini 0–100, RUANG ABSTRAK (posisi relatif di dalam kanvas
// peta), BUKAN lintang/bujur asli — supaya tidak ada yang secara tidak
// sengaja membacanya sebagai koordinat GPS sungguhan.

export const TRACKING_STATUS = {
  BELUM_BERANGKAT: { label: "Belum Berangkat", tone: "neutral" },
  BERANGKAT:       { label: "Berangkat",       tone: "accent" },
  DALAM_PERJALANAN:{ label: "Dalam Perjalanan",tone: "accent" },
  TIBA:            { label: "Tiba",            tone: "green" },
  PROSES_BONGKAR:  { label: "Proses Bongkar",  tone: "orange" },
  INSTALASI:       { label: "Instalasi",       tone: "orange" },
  SELESAI:         { label: "Selesai",         tone: "green" },
};

// Status yang posisinya masih "bergerak" — dipakai simulasi untuk tahu siapa
// yang perlu di-tick tiap interval, dan siapa yang diam (belum berangkat/sudah selesai).
const MOVING_STATUSES = ["BERANGKAT", "DALAM_PERJALANAN"];

// Nama driver & customer di bawah SENGAJA memakai orang/pola yang benar-benar
// ada — DIPERBAIKI 22 Agustus 2026 setelah ditegur: versi lama pakai nama
// karangan (Asep Saputra, Budi Hartono, dst) yang tidak ada hubungannya
// dengan tim sungguhan, padahal 3 driver ASLI sudah terdaftar (Agung, Alwan,
// Apriansyah — lihat CLAUDE.md §1). Posisi/progress/ETA di sini TETAP
// simulasi murni (lihat catatan di atas), tapi SIAPA yang disimulasikan
// sekarang bukan orang fiktif lagi.
//
// vehiclePlate memakai SATU plat nyata yang ada di database ("B 0000 UJI" —
// kendaraan uji coba, lihat halaman Driver & Armada) untuk ketiganya, BUKAN
// tiga plat berbeda: baru ada 1 kendaraan sungguhan tercatat saat ini.
// Mengarang 2 plat lagi akan mengulang kesalahan yang sama, cuma di kolom
// yang berbeda.
export function seedTrackingDrivers() {
  return [
    {
      id: "trk-1", driverName: "Agung", vehiclePlate: "B 0000 UJI",
      jobId: "JOB-2408-014", customerName: "Rizky Ananda", area: "Bekasi",
      status: "DALAM_PERJALANAN", etaMinutes: 12, nextStop: "Perum Harapan Indah Blok C2",
      path: [{ x: 18, y: 68 }, { x: 72, y: 30 }], progress: 0.42,
    },
    {
      id: "trk-2", driverName: "Alwan", vehiclePlate: "B 0000 UJI",
      jobId: "JOB-2408-016", customerName: "Maya Ratnasari", area: "Depok",
      status: "TIBA", etaMinutes: 0, nextStop: "Jl. Margonda Raya No. 88",
      path: [{ x: 40, y: 82 }, { x: 40, y: 82 }], progress: 1,
    },
    {
      id: "trk-3", driverName: "Apriansyah", vehiclePlate: "B 0000 UJI",
      jobId: null, customerName: null, area: "Jakarta Selatan",
      status: "BELUM_BERANGKAT", etaMinutes: null, nextStop: null,
      path: [{ x: 55, y: 20 }, { x: 55, y: 20 }], progress: 0,
    },
  ];
}

/** Posisi X/Y sekarang, interpolasi linear sepanjang `path` berdasar `progress`. */
export function positionOf(driver) {
  const [a, b] = driver.path;
  return { x: a.x + (b.x - a.x) * driver.progress, y: a.y + (b.y - a.y) * driver.progress };
}

/**
 * Satu langkah simulasi (dipanggil dari interval di komponen). Driver yang
 * BERANGKAT/DALAM_PERJALANAN majunya sedikit tiap tick; sampai progress=1
 * otomatis pindah status ke TIBA. Ini animasi ilustratif, BUKAN prediksi ETA
 * sungguhan.
 */
export function tickSimulation(drivers) {
  return drivers.map((d) => {
    if (!MOVING_STATUSES.includes(d.status)) return d;
    const nextProgress = Math.min(1, d.progress + 0.015 + Math.random() * 0.02);
    const nextEta = d.etaMinutes != null ? Math.max(0, d.etaMinutes - 1) : null;
    if (nextProgress >= 1) {
      return { ...d, progress: 1, status: "TIBA", etaMinutes: 0 };
    }
    return {
      ...d,
      progress: nextProgress,
      etaMinutes: nextEta,
      status: d.status === "BERANGKAT" && nextProgress > 0.15 ? "DALAM_PERJALANAN" : d.status,
    };
  });
}
