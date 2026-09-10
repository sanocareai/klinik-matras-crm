// Port dari frontend/src/hooks/useDriverTracking.js (D-034, PRD FR-L-06:
// ping GPS tiap 2 menit selama job EN_ROUTE). Logika SAMA PERSIS —
// getCurrentPosition per-interval (BUKAN watchPosition terus-menerus, hemat
// baterai — sama alasan dengan web), tidak pernah minta izin kalau tidak
// ada job EN_ROUTE.
//
// BEDA dari web (10 Sep 2026): antrean offline (positionQueue.js) BELUM
// diport ke sini — sama keputusan dengan submitJobAction.js RN, gagal
// jaringan = ping itu hilang, tidak diam-diam diantre. Ditambahkan kalau
// offline queue penuh (foto+aksi) sudah diport ke AsyncStorage.
import { useEffect, useRef } from "react";
import * as Location from "expo-location";
import { api } from "../api";

const PING_INTERVAL_MS = 2 * 60 * 1000; // 2 menit — sama dengan PRD FR-L-06

export function useDriverTracking(jobs) {
  const timerRef = useRef(null);

  useEffect(() => {
    const activeJobIds = (jobs || []).filter((j) => j.status === "EN_ROUTE").map((j) => j.id);
    if (activeJobIds.length === 0) return undefined; // tidak ada job aktif — jangan pasang timer/minta izin sama sekali

    let cancelled = false;

    async function tick() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const recordedAt = new Date().toISOString();
        const ping = {
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy, recordedAt,
        };
        await Promise.allSettled(activeJobIds.map((jobId) => api.sendJobPositions(jobId, [ping])));
      } catch {
        // izin ditolak/GPS gagal — diam, jangan ganggu driver dgn alert berulang tiap 2 menit
      }
    }

    tick(); // kirim ping pertama segera, jangan tunggu 2 menit
    timerRef.current = setInterval(tick, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify((jobs || []).map((j) => `${j.id}:${j.status}`))]);
}
