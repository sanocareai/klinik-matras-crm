// Histori Waktu Route & Stop (7 Okt 2026) — format TAMPILAN murni (label
// Indonesia + WIB + durasi). Padanan web: frontend/src/features/armada/
// routeTimelineFormat.js — logika sama, re-implementasi kecil (paket
// terpisah, tidak saling impor lintas paket, pola yang sama dipakai
// formatDurasiSingkat di backend/lib/activityLog.js).
export const ACTION_LABEL = {
  ROUTE_STARTED: "Berangkat dari Sano",
  ROUTE_COMPLETED: "Rute selesai",
  JOB_STARTED: "Menuju lokasi",
  JOB_ARRIVED: "Tiba di lokasi",
  JOB_COMPLETED: "Selesai",
  JOB_FAILED: "Gagal",
  JOB_RESCHEDULED: "Dijadwalkan ulang",
};

export const SOURCE_LABEL = { WEB: "Web", DRIVER_APP: "Aplikasi Driver" };
export const TIDAK_TERSEDIA = "Tidak tersedia";

// Offset TETAP +07:00 (BUKAN Intl.DateTimeFormat timeZone — dukungan ICU
// Hermes di React Native sering tidak lengkap untuk locale non-default,
// masalah RN yang sudah dikenal). Pola SAMA PERSIS dengan backend/src/
// utils/wib.js: Indonesia Barat tidak pernah pakai DST, offset tetap aman.
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const pad2 = (n) => String(n).padStart(2, "0");

// "25 Jul 2026, 14.30" WIB.
export function formatTanggalJamWIB(iso) {
  if (!iso) return TIDAK_TERSEDIA;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return TIDAK_TERSEDIA;
  const wib = new Date(d.getTime() + WIB_OFFSET_MS);
  return `${wib.getUTCDate()} ${BULAN[wib.getUTCMonth()]} ${wib.getUTCFullYear()}, ${pad2(wib.getUTCHours())}.${pad2(wib.getUTCMinutes())}`;
}

export function formatDurasiSingkatID(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const totalMenit = Math.round(ms / 60000);
  if (totalMenit < 1) return "<1 mnt";
  const j = Math.floor(totalMenit / 60);
  const m = totalMenit % 60;
  if (j === 0) return `${m} mnt`;
  return m === 0 ? `${j} j` : `${j} j ${m} mnt`;
}

export function formatTimelineEvent(event) {
  if (!event) return null;
  const label = ACTION_LABEL[event.action] || event.action;
  const waktu = event.displayAt ? formatTanggalJamWIB(event.displayAt) : TIDAK_TERSEDIA;
  const catatan = [];
  if (!event.hasDeviceTime) {
    catatan.push("Waktu dari jam server (tidak ada waktu perangkat tercatat)");
  } else if (event.isSuspiciousClock) {
    catatan.push(event.lateSyncMs < 0 ? "Jam perangkat janggal (tercatat dari masa depan)" : "Jam perangkat janggal (selisih sangat jauh dari waktu server)");
  } else if (event.isLateSync) {
    const telat = formatDurasiSingkatID(event.lateSyncMs);
    catatan.push(telat ? `Disinkronkan terlambat ${telat} (sempat offline)` : "Disinkronkan terlambat (sempat offline)");
  }
  return {
    action: event.action, label, waktu,
    actorName: event.actorName || null,
    sourceLabel: SOURCE_LABEL[event.source] || null,
    catatan,
    isLateSync: Boolean(event.isLateSync),
    isSuspiciousClock: Boolean(event.isSuspiciousClock),
  };
}
