// Histori Waktu Route & Stop (7 Okt 2026) — format TAMPILAN murni (label
// Indonesia + WIB + durasi), dipakai web admin & Driver Web. Padanan
// driver-mobile: src/lib/routeTimelineFormat.js (logika sama, re-implementasi
// kecil — pola "UTC di dalam, WIB di tepi", lintas paket TIDAK saling impor,
// konvensi yang sama dipakai formatDurasiSingkat di backend/lib/activityLog.js).
//
// Backend (services/routeTimeline.js) mengirim ISO UTC + flag mentah
// (isLateSync/isSuspiciousClock/hasDeviceTime) apa adanya — modul ini yang
// menerjemahkan jadi kalimat siap tampil. "Tidak tersedia" HANYA untuk
// milestone yang BENAR-BENAR tidak punya baris event sama sekali (lihat
// pemanggil); modul ini sendiri tidak pernah mengarang tanggal.
import { formatTanggalJam, formatJam } from "@/utils/formatDate.js";

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

// "1j 10m" / "42m" / "<1 mnt" — Indonesia (BEDA dari formatDurasiMenit di
// formatDate.js yang sengaja Inggris "h/m" untuk Command Center Produksi;
// timeline ini eksplisit diminta berbahasa Indonesia).
export function formatDurasiSingkatID(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const totalMenit = Math.round(ms / 60000);
  if (totalMenit < 1) return "<1 mnt";
  const j = Math.floor(totalMenit / 60);
  const m = totalMenit % 60;
  if (j === 0) return `${m} mnt`;
  return m === 0 ? `${j} j` : `${j} j ${m} mnt`;
}

/**
 * event: baris dari GET /routes/:id/timeline (atau null kalau milestone ini
 * tidak punya baris sama sekali — pemanggil yang memutuskan null di sini).
 * Return null kalau event null (pemanggil menampilkan "Tidak tersedia" SENDIRI
 * supaya tampilan daftar tetap konsisten tanpa objek kosong berulang).
 */
export function formatTimelineEvent(event) {
  if (!event) return null;
  const label = ACTION_LABEL[event.action] || event.action;
  const waktu = event.displayAt ? formatTanggalJam(event.displayAt) : TIDAK_TERSEDIA;
  const jamSaja = event.displayAt ? formatJam(event.displayAt) : TIDAK_TERSEDIA;
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
    action: event.action,
    label,
    waktu,
    jamSaja,
    actorName: event.actorName || null,
    sourceLabel: SOURCE_LABEL[event.source] || null,
    catatan,
    isLateSync: Boolean(event.isLateSync),
    isSuspiciousClock: Boolean(event.isSuspiciousClock),
  };
}

export function formatKoreksi(correction) {
  return {
    dari: correction.from ? formatTanggalJam(correction.from) : TIDAK_TERSEDIA,
    ke: correction.to ? formatTanggalJam(correction.to) : TIDAK_TERSEDIA,
    alasan: correction.reason || "Tanpa alasan tercatat",
    actorName: correction.actorName || "Admin",
    waktu: formatTanggalJam(correction.createdAt),
  };
}
