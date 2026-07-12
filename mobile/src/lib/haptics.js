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

export function lightHaptic() {
  try { Haptics?.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
}

export function mediumHaptic() {
  try { Haptics?.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
}

export function successHaptic() {
  try { Haptics?.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
}
