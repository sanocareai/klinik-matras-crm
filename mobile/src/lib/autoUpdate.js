// Cek update otomatis SEKALI setiap app dibuka (bukan tap manual "Cek
// Update" di ProfileScreen.js, yang tetap ada sebagai jalur cadangan kalau
// auto-check ini gagal/di-skip). Dipanggil dari App.js Root() sekali saat
// mount.
//
// KENAPA cuma saat LAUNCH (bukan juga saat app di-foreground dari
// background): reload mengganti seluruh JS bundle tanpa peringatan — kalau
// dipicu saat user SEDANG di tengah mengetik pesan (app di-background lalu
// dibuka lagi), draft yang belum terkirim bisa hilang. Momen app baru
// dibuka (cold start) adalah satu-satunya titik yang dijamin aman: user
// belum sempat mulai apa-apa.
//
// Silent by design — TIDAK ada alert sama sekali, sukses maupun gagal.
// Kalau update ditemukan: fetch lalu reloadAsync() (app restart sendiri,
// user lihat splash sebentar lalu masuk versi baru). Kalau gagal (offline,
// server EAS Update down, dll) — dibiarkan saja, user tetap lanjut pakai
// versi yang sudah terpasang, TIDAK ada gangguan. Tap manual "Cek Update"
// di Profil tetap ada untuk kasus ini (kasih tahu user, bukan gagal diam).
export async function checkForUpdateOnLaunch() {
  if (__DEV__) return; // checkForUpdateAsync() reject di Expo Go/dev client

  let Updates;
  try {
    Updates = require("expo-updates");
  } catch {
    return; // native module belum ter-link (mis. APK lama sebelum EAS Update dikonfigurasi)
  }
  if (!Updates?.isEnabled) return;

  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
  } catch {
    // Diam-diam gagal (offline, dll) — JANGAN ganggu user, cukup lanjut
    // pakai versi yang sudah terpasang. Tap manual di Profil tetap tersedia.
  }
}
