// Cek update OTA otomatis sekali tiap app dibuka — port LANGSUNG dari
// mobile/src/lib/autoUpdate.js (Sano Messenger), logikanya generik (tidak
// ada apa pun spesifik chat). Silent by design: sukses/gagal tidak pernah
// mengganggu user, driver TETAP bisa kerja pakai versi yang sudah terpasang
// kalau update gagal (offline, dst).
export async function checkForUpdateOnLaunch() {
  if (__DEV__) return;

  let Updates;
  try {
    Updates = require("expo-updates");
  } catch {
    return;
  }
  if (!Updates?.isEnabled) return;

  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
  } catch {
    // Diam-diam gagal — driver tetap lanjut pakai versi yang sudah terpasang.
  }
}
