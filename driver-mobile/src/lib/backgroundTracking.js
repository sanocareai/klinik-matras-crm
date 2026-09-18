// Ping GPS yang TETAP jalan saat app di background (19 September 2026).
//
// AKAR MASALAH yang diperbaiki di sini — laporan owner: "driver padahal live
// tapi tidak live sedang jalan gitu", dengan screenshot badge Live di
// sebelah tulisan "Posisi terakhir 26 menit lalu". Badge-nya memang bohong
// (sudah diperbaiki di jobHelpers.js#kesegaranGps), TAPI kenapa datanya
// basi itu masalah terpisah dan lebih dalam: useDriverTracking.js memakai
// setInterval JS biasa, dan Android MEMBEKUKAN timer JS begitu app tidak di
// layar. Driver menyetir dengan HP di saku = app di background = ping
// berhenti total. Jadi ping cuma pernah terkirim di menit-menit driver
// kebetulan sedang menatap layar — kondisi paling jarang di lapangan.
//
// Perbaikannya expo-location + expo-task-manager: OS yang membangunkan kode
// ini pada interval/jarak tertentu, lewat foreground service Android
// (notifikasi tetap terlihat — memang WAJIB, dan jujur ke driver bahwa dia
// sedang dilacak; Gojek/Grab pun begitu).
//
// ⚠️ BUTUH BUILD NATIVE BARU (bukan OTA) — expo-task-manager modul native
// yang sebelumnya TIDAK ADA di binary. Semua akses ke modul itu di file ini
// dibungkus supaya APK LAMA yang kebetulan menerima JS ini lewat OTA tidak
// crash, cuma jatuh ke jalur timer foreground lama (lihat
// backgroundTrackingTersedia()).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_SERVER } from "../api";

export const TUGAS_LOKASI = "sano-driver-lokasi";
const KUNCI_JOB_AKTIF = "trackingJobIds";

// require() dibungkus (bukan import statis) dengan alasan yang SAMA seperti
// expo-updates di lib/autoUpdate.js: kalau modul native belum ada di binary
// ini, file ini tetap boleh dievaluasi — yang hilang cuma fiturnya.
let Location = null;
let TaskManager = null;
try {
  Location = require("expo-location");
  TaskManager = require("expo-task-manager");
} catch (err) {
  console.warn("[backgroundTracking] modul native belum tersedia:", err.message);
}

export function backgroundTrackingTersedia() {
  return !!(Location && TaskManager && Location.startLocationUpdatesAsync && TaskManager.defineTask);
}

// Tugas didefinisikan di MODULE SCOPE — syarat expo-task-manager: saat OS
// membangunkan app di background, ia menjalankan ulang bundle JS dari nol
// dan langsung memanggil tugas ini. Kalau definisinya ada di dalam komponen,
// ia belum terdaftar saat itu dan ping-nya hilang.
if (backgroundTrackingTersedia()) {
  TaskManager.defineTask(TUGAS_LOKASI, async ({ data, error }) => {
    if (error) {
      console.warn("[backgroundTracking] tugas error:", error.message);
      return;
    }
    const lokasi = data?.locations?.[data.locations.length - 1]; // yang terbaru saja
    if (!lokasi) return;
    await kirimPing(lokasi);
  });
}

// Dipanggil dari konteks background: state modul api.js (token/server) TIDAK
// bisa diandalkan — bundle bisa saja baru dijalankan ulang dari nol oleh OS,
// jauh setelah AuthContext terakhir mengisinya. Jadi baca ulang dari
// AsyncStorage tiap kali, dan pakai fetch polos (bukan api.js).
async function kirimPing(lokasi) {
  try {
    const [token, server, jobIdsRaw] = await Promise.all([
      AsyncStorage.getItem("token"),
      AsyncStorage.getItem("server"),
      AsyncStorage.getItem(KUNCI_JOB_AKTIF),
    ]);
    if (!token || !jobIdsRaw) return;
    const jobIds = JSON.parse(jobIdsRaw);
    if (!Array.isArray(jobIds) || jobIds.length === 0) return;

    const base = (server || DEFAULT_SERVER).replace(/\/+$/, "");
    const ping = {
      lat: lokasi.coords.latitude,
      lng: lokasi.coords.longitude,
      accuracy: lokasi.coords.accuracy,
      // Waktu dari OS saat titik itu DIREKAM, bukan saat terkirim — kalau
      // pengiriman tertunda (sinyal jelek), jejaknya tetap pada waktu yang
      // benar, tidak menumpuk di satu detik saat sinyal kembali.
      recordedAt: new Date(lokasi.timestamp || Date.now()).toISOString(),
    };
    await Promise.allSettled(
      jobIds.map((jobId) =>
        fetch(`${base}/api/armada/jobs/${jobId}/positions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ pings: [ping] }),
        })
      )
    );
  } catch (err) {
    // Gagal kirim = ping itu hilang, TIDAK diantre. Keputusan yang sama
    // dengan useDriverTracking.js & submitJobAction.js versi RN — antrean
    // offline belum diport ke AsyncStorage. Diam-diam, karena ini jalan di
    // background: tidak ada layar untuk menampilkan error apa pun.
    console.warn("[backgroundTracking] gagal kirim ping:", err.message);
  }
}

// Interval SENGAJA jauh lebih rapat dari versi timer lama (2 menit). Titik
// tiap 2 menit di jalan Jabodetabek bisa berjarak ~1km — jejaknya patah dan
// "posisi sekarang" terasa tidak hidup. 30 detik / 75 meter memberi rasa
// seperti Gojek/Grab tanpa membanjiri server (1 job aktif ≈ 120 ping/jam,
// dan ini cuma jalan selama ADA job EN_ROUTE + driver Online).
const INTERVAL_MS = 30 * 1000;
const JARAK_METER = 75;

export async function mulaiBackgroundTracking(jobIds) {
  if (!backgroundTrackingTersedia()) return false;
  try {
    // Job aktif disimpan DULU — tugas background membacanya dari sini
    // (lihat kirimPing), bukan dari argumen, karena ia bisa dibangunkan OS
    // di proses yang sama sekali baru.
    await AsyncStorage.setItem(KUNCI_JOB_AKTIF, JSON.stringify(jobIds));

    const sudahJalan = await Location.hasStartedLocationUpdatesAsync(TUGAS_LOKASI);
    if (sudahJalan) return true; // daftar job sudah diperbarui di atas, itu cukup

    await Location.startLocationUpdatesAsync(TUGAS_LOKASI, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: INTERVAL_MS,
      distanceInterval: JARAK_METER,
      // pausesUpdatesAutomatically iOS: OS boleh menjeda saat terdeteksi
      // diam. Untuk pelacakan pengiriman itu justru merugikan (driver
      // berhenti lama di lokasi customer = titik hilang), jadi dimatikan.
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Sano Driver melacak perjalanan",
        notificationBody: "Posisi dikirim ke admin selama job berjalan. Matikan status Online untuk berhenti.",
        notificationColor: "#2D64B6",
      },
    });
    return true;
  } catch (err) {
    console.warn("[backgroundTracking] gagal memulai:", err.message);
    return false;
  }
}

export async function hentikanBackgroundTracking() {
  if (!backgroundTrackingTersedia()) return;
  try {
    await AsyncStorage.removeItem(KUNCI_JOB_AKTIF);
    const sudahJalan = await Location.hasStartedLocationUpdatesAsync(TUGAS_LOKASI);
    if (sudahJalan) await Location.stopLocationUpdatesAsync(TUGAS_LOKASI);
  } catch (err) {
    console.warn("[backgroundTracking] gagal menghentikan:", err.message);
  }
}

// Izin background ("Allow all the time") — di Android 11+ TIDAK bisa
// diberikan lewat dialog biasa: sistem hanya membuka halaman Setelan, dan
// user harus memilih sendiri. Karena itu izin foreground diminta DULU
// (dialog normal), baru background — urutan yang diwajibkan Android; minta
// background duluan otomatis ditolak tanpa dialog apa pun.
export async function mintaIzinBackground() {
  if (!backgroundTrackingTersedia()) return { foreground: false, background: false };
  const depan = await Location.requestForegroundPermissionsAsync();
  if (depan.status !== "granted") return { foreground: false, background: false };
  const belakang = await Location.requestBackgroundPermissionsAsync();
  return { foreground: true, background: belakang.status === "granted" };
}
