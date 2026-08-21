// D-034 — kirim ping GPS driver selama job EN_ROUTE (PRD FR-L-06: tiap 2
// menit selama rute aktif). Dipakai HANYA oleh DriverJobs.jsx.
//
// KENAPA interval, bukan watchPosition() terus-menerus: watchPosition
// menyalakan GPS chip terus-menerus (boros baterai HP driver seharian di
// jalan) untuk presisi yang tidak dibutuhkan — dispatcher cukup tahu "driver
// ini sekarang di mana" tiap beberapa menit, bukan tiap detik. getCurrentPosition
// per-interval jauh lebih hemat baterai untuk kebutuhan yang sama.
//
// TIDAK PERNAH minta izin lokasi kalau tidak ada job EN_ROUTE — driver yang
// job-nya semua masih ASSIGNED/selesai tidak akan pernah dimintai izin GPS
// sama sekali (beda dari trackingMock.js lama yang eksplisit dilarang minta
// izin browser — sekarang justru itu intinya, tapi HANYA saat benar relevan).
import { useEffect, useRef } from "react";
import { api } from "../api.js";
import { enqueuePosition, flushPositions } from "../utils/positionQueue.js";

const PING_INTERVAL_MS = 2 * 60 * 1000; // 2 menit — sama dengan PRD FR-L-06

export function useDriverTracking(jobs) {
  const timerRef = useRef(null);

  useEffect(() => {
    const activeJobIds = (jobs || []).filter((j) => j.status === "EN_ROUTE").map((j) => j.id);

    async function tick() {
      // Kirim dulu antrean lama (kalau ada dari sesi sebelumnya/offline),
      // BARU ambil posisi baru — supaya urutan waktu di server tetap benar.
      await flushPositions((jobId, pings) => api.sendJobPositions(jobId, pings)).catch(() => {});

      if (activeJobIds.length === 0 || !navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const recordedAt = new Date().toISOString();
          for (const jobId of activeJobIds) {
            enqueuePosition(jobId, {
              lat: pos.coords.latitude, lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy, recordedAt,
            });
          }
          // Kirim segera (bukan tunggu interval berikutnya) — kalau berhasil,
          // dispatcher lihat posisi ter-update secepat mungkin; kalau gagal
          // (offline), tetap aman di antrean untuk tick berikutnya.
          flushPositions((jobId, pings) => api.sendJobPositions(jobId, pings)).catch(() => {});
        },
        () => { /* izin ditolak/GPS gagal — diam, jangan ganggu driver dengan alert berulang tiap 2 menit */ },
        { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 },
      );
    }

    if (activeJobIds.length === 0) return; // tidak ada job aktif — jangan pasang timer sama sekali

    tick(); // kirim ping pertama segera, jangan tunggu 2 menit
    timerRef.current = setInterval(tick, PING_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify((jobs || []).map((j) => `${j.id}:${j.status}`))]);
}
