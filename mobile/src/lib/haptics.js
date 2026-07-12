// Helper haptics ringan — dipakai kirim pesan, long-press bubble, swipe
// action, dsb. expo-haptics BELUM TENTU ter-link di build yang sedang jalan
// (native module baru, sama seperti kasus MMKV/expo-av/expo-updates
// sebelumnya) — dibungkus require()+try/catch sekali di sini (pola yang
// sudah dipakai PipelineBoard.js), supaya kalau belum ter-rebuild TIDAK
// crash, cuma diam-diam tanpa getar.
let Haptics = null;
try {
  Haptics = require("expo-haptics");
} catch {
  Haptics = null;
}

// BUG (fix): impactAsync/notificationAsync balikin PROMISE — kalau modulnya
// ADA secara JS (require di atas sukses, jadi try/catch sinkron TIDAK
// kepicu) tapi native side-nya BELUM ter-link di APK yang sedang jalan,
// promise itu REJECT secara ASYNC, bukan throw langsung. try/catch biasa
// di sekitar pemanggilan fungsi TIDAK menangkap rejection promise —
// hasilnya "Uncaught (in promise)" di Android walau pemanggilnya sendiri
// sudah dibungkus try/catch. Semua pemanggilan method Haptics WAJIB lewat
// safeHaptic() di bawah, yang menelan KEDUA jenis kegagalan (throw sinkron
// maupun promise reject) — swipe reply, kirim pesan, dsb tetap jalan
// normal walau getar tidak terasa sama sekali.
function safeHaptic(fn) {
  try {
    const result = fn();
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {}
}

export function lightHaptic() {
  safeHaptic(() => Haptics?.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

export function mediumHaptic() {
  safeHaptic(() => Haptics?.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

export function successHaptic() {
  safeHaptic(() => Haptics?.notificationAsync(Haptics.NotificationFeedbackType.Success));
}
