import * as Haptics from "expo-haptics";

// Getaran halus untuk ketukan penting (tab, tombol +, aksi berhasil). Gagal diam-diam di perangkat tanpa motor getar.
export const haptic = {
  tick: () => void Haptics.selectionAsync().catch(() => {}),
  ringan: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  sukses: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
};
