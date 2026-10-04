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
//
// DIROMBAK 4 Oktober 2026 (audit crash Android "Sano Driver telah berhenti"
// saat app di background — ROOT CAUSE BELUM DIKONFIRMASI lewat logcat
// sungguhan, lihat laporan audit terpisah). Keputusan lifecycle (gerbang
// AppState, cek-izin-dulu, serialisasi, abaikan niat basi, status jujur)
// SEKARANG hidup di lib/trackingLifecycle.js (pure, teruji node:test) — file
// ini TINGGAL wiring RN tipis: menyambungkan AppState/expo-location asli ke
// situ, dan menjalankan jalur cadangan timer foreground SELAMA status-nya
// "foreground-only". Lihat komentar panjang di trackingLifecycle.js untuk
// alasan lengkap tiap aturan.
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import { api } from "../api";
import {
  backgroundTrackingTersedia,
  sudahBerjalanBackgroundTracking,
  mulaiBackgroundTracking,
  hentikanBackgroundTracking,
} from "../lib/backgroundTracking";
import { createTrackingLifecycle, STATUS } from "../lib/trackingLifecycle";

export { STATUS as DRIVER_TRACKING_STATUS };

const PING_INTERVAL_MS = 2 * 60 * 1000; // jalur cadangan — sama dengan PRD FR-L-06

export function useDriverTracking(jobs, isOnline) {
  const [status, setStatus] = useState(STATUS.IDLE);
  const timerRef = useRef(null);

  // Instance SEKALI per mount (ref, bukan useMemo — identitas useMemo TIDAK
  // dijamin stabil lintas render oleh React, padahal serialisasi di dalam
  // lifecycle BUTUH satu instance yang sama sepanjang hidup komponen; pola
  // "lazy ref init" ini identitasnya dijamin stabil sampai unmount).
  const lifecycleRef = useRef(null);
  if (lifecycleRef.current === null) {
    lifecycleRef.current = createTrackingLifecycle({
      backgroundTrackingTersedia,
      sudahBerjalanBackgroundTracking,
      mulaiBackgroundTracking,
      hentikanBackgroundTracking,
      getForegroundPermission: () => Location.getForegroundPermissionsAsync(),
      requestForegroundPermission: () => Location.requestForegroundPermissionsAsync(),
      getBackgroundPermission: () => Location.getBackgroundPermissionsAsync(),
      requestBackgroundPermission: () => Location.requestBackgroundPermissionsAsync(),
      getAppState: () => AppState.currentState,
      onStatusChange: setStatus,
    });
  }
  const lifecycle = lifecycleRef.current;

  // Pemicu UTAMA: isOnline berubah, atau status job berubah (termasuk jadi/
  // tidak lagi EN_ROUTE). lifecycle.update() sendiri yang menyerialkan dan
  // membaca kondisi TERBARU di setiap titik await — effect ini cuma
  // melaporkan niat terbaru, bukan menjalankan logikanya langsung.
  useEffect(() => {
    const activeJobIds = (jobs || []).filter((j) => j.status === "EN_ROUTE").map((j) => j.id);
    lifecycle.update({ isOnline, activeJobIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, (jobs || []).map((j) => `${j.id}:${j.status}`).join(",")]);

  // Pemicu KEDUA: AppState kembali ke "active". Niat "mulai tracking" yang
  // tertunda karena app sedang background (status WAITING_FOR_ACTIVE) dicoba
  // lagi persis saat ini — TANPA perlu isOnline/job berubah dulu. AppState
  // berubah ke background TIDAK memicu apa pun di sini (sengaja): tracking
  // yang sudah jalan harus tetap jalan, lihat lifecycle.update()/
  // kondisiMasihBerlaku() yang hanya bereaksi pada isOnline/job.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") lifecycle.appStateMenjadiAktif();
    });
    return () => sub.remove();
  }, [lifecycle]);

  // Unmount (logout, navigasi keluar layar — BUKAN app ke background, lihat
  // di atas) — destroy() masuk ke ANTREAN SERIALISASI YANG SAMA, jadi kalau
  // ada start yang masih di tengah jalan (mis. menunggu dialog izin), ia
  // dipastikan berhenti SETELAH start itu selesai menilai dirinya basi,
  // bukan race terpisah seperti "jaring pengaman" versi lama.
  useEffect(() => {
    return () => { lifecycle.destroy(); };
  }, [lifecycle]);

  // Jalur cadangan foreground-timer — HANYA jalan selagi lifecycle melapor
  // status "foreground-only" (modul native tak tersedia, atau izin
  // background ditolak). Timer JS ini SENDIRI cuma bisa jalan selagi app di
  // foreground (Android membekukannya di background, itulah kenapa jalur
  // UTAMA pakai expo-task-manager) — jadi aman tanpa gerbang AppState
  // tambahan di sini.
  useEffect(() => {
    if (status !== STATUS.FOREGROUND_ONLY) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return undefined;
    }

    const activeJobIds = (jobs || []).filter((j) => j.status === "EN_ROUTE").map((j) => j.id);
    let cancelled = false;

    async function tick() {
      try {
        const { status: permStatus } = await Location.getForegroundPermissionsAsync();
        if (permStatus !== "granted" || cancelled) return;
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

    tick(); // ping pertama segera, jangan tunggu 2 menit
    timerRef.current = setInterval(tick, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, (jobs || []).map((j) => `${j.id}:${j.status}`).join(",")]);

  return status;
}
