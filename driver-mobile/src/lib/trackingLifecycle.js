// Koordinator keputusan background GPS — SENGAJA terpisah dari
// lib/backgroundTracking.js (modul native expo-location/expo-task-manager,
// TIDAK bisa diimpor di bawah `node --test` biasa) dan hooks/useDriverTracking.js
// (wiring RN: AppState, setInterval, useRef). Pola sama dengan
// lib/executionQueue.js (factory + dependency injection) — lihat komentar
// panjang di sana soal alasannya. Instance PRODUKSI (semua fungsi di bawah
// mengarah ke expo-location/expo-task-manager asli) dibuat SEKALI per mount
// hook di hooks/useDriverTracking.js; test membuat instance terpisah dengan
// fake yang bisa dikendalikan waktu resolve-nya.
//
// LATAR BELAKANG (audit crash Android "Sano Driver telah berhenti" saat app
// di background, laporan 3-4 Okt 2026 — ROOT CAUSE BELUM DIKONFIRMASI lewat
// logcat perangkat sungguhan, lihat laporan audit terpisah): versi
// useDriverTracking.js SEBELUM modul ini ada MEMILIKI 4 celah sekaligus —
//   1. Minta izin lokasi (dialog sistem) tanpa peduli app sedang di
//      foreground atau background. Android 12+ (lebih ketat lagi di 14,
//      target SDK Expo 57) bisa menolak/crash kalau dialog izin atau START
//      FOREGROUND SERVICE lokasi dipicu dari Activity yang tidak resumed
//      (ForegroundServiceStartNotAllowedException / BadTokenException).
//   2. Minta izin BERULANG di setiap kali effect jalan ulang (tiap job
//      berubah status), tidak pernah cek dulu apakah sudah granted.
//   3. Tidak ada serialisasi — start/stop yang saling susul (mis. job EN_ROUTE
//      lalu buru-buru di-reschedule) bisa overlap; hasil operasi LAMA yang
//      baru selesai belakangan bisa menimpa keputusan BARU yang seharusnya
//      menang (mis. tetap mulai tracking padahal driver sudah Offline).
//   4. Tidak ada status yang jujur ke UI — kalau start gagal, driver tidak
//      tahu (switch "Online" tetap kelihatan menyala seperti biasa).
// Modul ini memperbaiki keempatnya sebagai HARDENING berbasis bukti kode,
// BUKAN klaim bahwa ini pasti satu-satunya penyebab crash yang dilaporkan.

export const STATUS = Object.freeze({
  IDLE: "idle", // offline atau tidak ada job EN_ROUTE — tidak ada pelacakan apa pun
  WAITING_FOR_ACTIVE: "waiting-for-active", // perlu mulai tracking baru, tapi app sedang background — menunggu
  STARTING: "starting", // sedang cek/minta izin & memulai FGS (app sedang aktif)
  BACKGROUND: "background", // foreground service native (expo-task-manager) jalan
  FOREGROUND_ONLY: "foreground-only", // jalur cadangan timer — FGS tak tersedia/izin background ditolak
  ERROR: "error", // start benar-benar gagal (BUKAN sekadar menunggu app aktif)
});

export function createTrackingLifecycle({
  backgroundTrackingTersedia,
  sudahBerjalanBackgroundTracking,
  mulaiBackgroundTracking,
  hentikanBackgroundTracking,
  getForegroundPermission,
  requestForegroundPermission,
  getBackgroundPermission,
  requestBackgroundPermission,
  getAppState,
  onStatusChange = () => {},
}) {
  let chain = Promise.resolve();
  let latest = { isOnline: false, activeJobIds: [] };
  let status = STATUS.IDLE;
  let destroyed = false;

  function setStatus(next) {
    if (status === next) return;
    status = next;
    onStatusChange(next);
  }

  // Dicek di SETIAP titik await di bawah — selalu melawan `latest` TERBARU
  // (ditulis oleh update(), bisa berubah selagi langkah ini menunggu sesuatu),
  // bukan closure dari saat langkah ini mulai. Inilah mekanisme "abaikan start
  // yang sudah basi" — bukan generation counter terpisah, tapi re-baca
  // kebenaran terkini di setiap titik keputusan.
  function kondisiMasihBerlaku() {
    return !destroyed && latest.isOnline && latest.activeJobIds.length > 0;
  }

  async function jalankanEnsure() {
    if (!kondisiMasihBerlaku()) {
      setStatus(STATUS.IDLE);
      await hentikanBackgroundTracking();
      return;
    }

    if (!backgroundTrackingTersedia()) {
      setStatus(STATUS.FOREGROUND_ONLY);
      return;
    }

    const sudahJalan = await sudahBerjalanBackgroundTracking().catch(() => false);
    if (!kondisiMasihBerlaku()) { await hentikanBackgroundTracking(); setStatus(STATUS.IDLE); return; }

    if (sudahJalan) {
      // SUDAH jalan (termasuk jalan dari sebelum app resume ke foreground) —
      // cukup perbarui daftar job. TIDAK PERNAH minta izin di jalur ini, dan
      // AMAN dipanggil kapan saja termasuk saat app di background: ini tidak
      // memulai foreground service baru, cuma menulis ulang AsyncStorage
      // (lihat mulaiBackgroundTracking di backgroundTracking.js — ia sendiri
      // no-op start-nya kalau hasStartedLocationUpdatesAsync sudah true).
      const ok = await mulaiBackgroundTracking(latest.activeJobIds).catch(() => false);
      if (!kondisiMasihBerlaku()) { await hentikanBackgroundTracking(); setStatus(STATUS.IDLE); return; }
      setStatus(ok ? STATUS.BACKGROUND : STATUS.ERROR);
      return;
    }

    // BELUM jalan = ini START BARU. Syarat keras (temuan audit #1 di atas):
    // minta izin DAN memulai foreground service HANYA boleh terjadi saat app
    // benar-benar di foreground.
    if (getAppState() !== "active") {
      setStatus(STATUS.WAITING_FOR_ACTIVE);
      return; // hook RN akan memanggil appStateMenjadiAktif() begitu AppState
               // berubah ke "active" — lihat wiring di useDriverTracking.js.
    }

    setStatus(STATUS.STARTING);

    // Cek izin EXISTING dulu (read-only, TANPA dialog) — baru minta kalau
    // benar-benar belum granted (temuan audit #2: jangan minta ulang di
    // setiap effect). Izin foreground WAJIB diminta duluan, baru background —
    // di Android 11+ meminta "izinkan sepanjang waktu" tanpa foreground lebih
    // dulu otomatis ditolak tanpa dialog apa pun sama sekali.
    let fg = await getForegroundPermission();
    if (!kondisiMasihBerlaku()) { setStatus(STATUS.IDLE); return; }
    if (fg.status !== "granted") {
      if (getAppState() !== "active") { setStatus(STATUS.WAITING_FOR_ACTIVE); return; }
      fg = await requestForegroundPermission();
      if (!kondisiMasihBerlaku()) { setStatus(STATUS.IDLE); return; }
    }
    if (fg.status !== "granted") { setStatus(STATUS.ERROR); return; }

    let bg = await getBackgroundPermission();
    if (!kondisiMasihBerlaku()) { setStatus(STATUS.IDLE); return; }
    if (bg.status !== "granted") {
      if (getAppState() !== "active") { setStatus(STATUS.WAITING_FOR_ACTIVE); return; }
      bg = await requestBackgroundPermission();
      if (!kondisiMasihBerlaku()) { setStatus(STATUS.IDLE); return; }
    }
    if (bg.status !== "granted") {
      // Izin "sepanjang waktu" ditolak — bukan kegagalan, jalur cadangan
      // foreground-timer tetap melacak selama app dibuka (lebih baik
      // daripada mati total, sama alasan dengan versi lama).
      setStatus(STATUS.FOREGROUND_ONLY);
      return;
    }

    // Re-check SEKALI LAGI tepat sebelum start FGS sungguhan — dialog izin
    // bisa makan waktu lama (driver baca, mikir, buka Setelan manual utk izin
    // background), dan driver bisa saja sudah offline/logout/job berubah/app
    // kembali ke background selagi menjawabnya.
    if (!kondisiMasihBerlaku()) { setStatus(STATUS.IDLE); return; }
    if (getAppState() !== "active") { setStatus(STATUS.WAITING_FOR_ACTIVE); return; }

    const jalan = await mulaiBackgroundTracking(latest.activeJobIds).catch(() => false);
    if (!kondisiMasihBerlaku()) { await hentikanBackgroundTracking(); setStatus(STATUS.IDLE); return; }
    setStatus(jalan ? STATUS.BACKGROUND : STATUS.ERROR);
  }

  // SERIALISASI (temuan audit #3): setiap pemicu — update() dari effect utama,
  // appStateMenjadiAktif() dari listener AppState, destroy() dari unmount —
  // dirangkai jadi SATU antrean promise berurutan, pola sama dengan
  // withUserLock() di executionQueue.js. Tidak pernah ada 2 jalankanEnsure()
  // berjalan bersamaan untuk hook yang sama.
  function enqueue() {
    chain = chain.then(jalankanEnsure, jalankanEnsure);
    return chain;
  }

  function update({ isOnline, activeJobIds }) {
    if (destroyed) return chain;
    latest = { isOnline: !!isOnline, activeJobIds: activeJobIds || [] };
    return enqueue();
  }

  // Dipanggil hook saat AppState berubah ke "active" — re-evaluasi dengan
  // `latest` yang SUDAH ada (tidak perlu kondisi berubah dulu), supaya niat
  // "mulai tracking" yang tertunda karena app sedang background langsung
  // dicoba lagi begitu driver membuka app.
  function appStateMenjadiAktif() {
    if (destroyed) return chain;
    return enqueue();
  }

  // Unmount (logout, navigasi keluar layar) — BUKAN dipicu "app ke
  // background" (Home ditekan TIDAK boleh menghentikan tracking yang sudah
  // jalan, lihat kondisiMasihBerlaku: itu hanya bereaksi pada isOnline/job,
  // tidak pernah pada AppState). destroyed=true membuat langkah berikutnya di
  // chain (termasuk yang sedang di tengah jalan) berhenti di cabang pertama
  // jalankanEnsure dan memanggil hentikanBackgroundTracking().
  function destroy() {
    destroyed = true;
    return enqueue();
  }

  function getStatus() {
    return status;
  }

  return { update, appStateMenjadiAktif, destroy, getStatus };
}
