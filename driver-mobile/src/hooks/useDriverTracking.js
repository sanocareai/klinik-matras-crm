// Ping GPS selama job EN_ROUTE (D-034, PRD FR-L-06).
//
// DIUBAH 19 September 2026 (laporan owner: "driver padahal live tapi tidak
// live sedang jalan gitu"). Versi lama memakai setInterval JS 2 menit —
// Android MEMBEKUKAN timer JS begitu app tidak di layar, jadi ping berhenti
// total tiap kali driver mengantongi HP-nya, yaitu hampir sepanjang
// perjalanan. Sekarang jalur UTAMA-nya background location (OS yang
// membangunkan, lihat lib/backgroundTracking.js); timer lama DIPERTAHANKAN
// sebagai jalur cadangan untuk dua keadaan nyata:
//   1. APK lama yang belum punya modul native expo-task-manager (misal OTA
//      sampai duluan sebelum driver sempat pasang APK baru).
//   2. Driver menolak izin "Izinkan sepanjang waktu" — pelacakan tetap
//      jalan selama app dibuka, lebih baik daripada mati total.
//
// Gerbang isOnline (12 Sep 2026, referensi Gojek/Grab — permintaan owner:
// "ketika driver sudah offline otomatis gps ga mendeteksi driver kemana-
// mana lagi") TETAP jadi gerbang PALING LUAR: Offline = tidak ada pelacakan
// apa pun, background sekalipun, dan notifikasi foreground service ikut
// hilang.
import { useEffect, useRef } from "react";
import * as Location from "expo-location";
import { api } from "../api";
import {
  backgroundTrackingTersedia,
  mulaiBackgroundTracking,
  hentikanBackgroundTracking,
  mintaIzinBackground,
} from "../lib/backgroundTracking";

const PING_INTERVAL_MS = 2 * 60 * 1000; // jalur cadangan — sama dengan PRD FR-L-06

export function useDriverTracking(jobs, isOnline) {
  const timerRef = useRef(null);

  // Jaring pengaman unmount (audit performa "HP panas", 23 September 2026)
  // — BUG DITEMUKAN: cleanup function effect utama di bawah (yang deps-nya
  // [isOnline, status job] dan cuma jalan lagi kalau salah satu dari itu
  // BERUBAH) hanya membersihkan timer cadangan JS, TIDAK PERNAH memanggil
  // hentikanBackgroundTracking(). Kalau JobListScreen UNMOUNT SAAT
  // background tracking native (foreground service GPS) sedang aktif —
  // kasus nyata: driver logout tanpa Offline-kan diri dulu, atau navigasi
  // keluar layar ini saat masih EN_ROUTE — effect utama tidak pernah
  // sempat menjalankan cabang "offline, hentikan" di atas, dan service GPS
  // native TERUS JALAN tanpa batas walau React tree-nya sudah lenyap.
  // Effect TERPISAH dengan deps kosong ini HANYA jalan sekali saat true
  // unmount, sebagai jaring pengaman terakhir — TIDAK mengganggu logika
  // start/stop normal effect utama (hentikanBackgroundTracking() aman
  // dipanggil berulang, sudah idempoten lewat cek hasStartedLocationUpdatesAsync).
  useEffect(() => {
    return () => { hentikanBackgroundTracking(); };
  }, []);

  useEffect(() => {
    const activeJobIds = (jobs || []).filter((j) => j.status === "EN_ROUTE").map((j) => j.id);

    // Offline ATAU tidak ada job berjalan — pastikan SEMUA pelacakan mati,
    // termasuk background yang mungkin masih hidup dari sesi sebelumnya
    // (background service tidak ikut mati sendiri saat state React berubah).
    if (!isOnline || activeJobIds.length === 0) {
      hentikanBackgroundTracking();
      return undefined;
    }

    let cancelled = false;

    async function tick() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted" || cancelled) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const ping = {
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy, recordedAt: new Date().toISOString(),
        };
        await Promise.allSettled(activeJobIds.map((jobId) => api.sendJobPositions(jobId, [ping])));
      } catch {
        // izin ditolak/GPS gagal — diam, jangan ganggu driver dgn alert berulang
      }
    }

    function mulaiTimerCadangan() {
      if (cancelled || timerRef.current) return;
      tick(); // ping pertama segera, jangan tunggu 2 menit
      timerRef.current = setInterval(tick, PING_INTERVAL_MS);
    }

    (async () => {
      if (!backgroundTrackingTersedia()) {
        mulaiTimerCadangan();
        return;
      }
      const izin = await mintaIzinBackground();
      if (cancelled) return;
      if (!izin.foreground) return; // izin lokasi ditolak total — tidak ada yang bisa dilakukan
      if (izin.background) {
        const jalan = await mulaiBackgroundTracking(activeJobIds);
        if (!cancelled && jalan) return; // background aktif — timer cadangan tidak perlu
      }
      // Izin "sepanjang waktu" ditolak, atau gagal memulai — jalur cadangan.
      mulaiTimerCadangan();
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, (jobs || []).map((j) => `${j.id}:${j.status}`).join(",")]); // .join lebih murah dari JSON.stringify (13 Sep 2026, audit performa)
}
