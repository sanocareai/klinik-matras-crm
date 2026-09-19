import * as Haptics from "expo-haptics";

// Haptic (PRD §10.4). Semua aman-gagal: perangkat tanpa motor getar tidak boleh membuat aplikasi galat.
const aman = (p: Promise<unknown>) => { p.catch(() => {}); };

export const haptic = {
  /** Ganti tab, toggle. */
  tick: () => aman(Haptics.selectionAsync()),
  /** Approve/verifikasi berhasil. */
  sukses: () => aman(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Galat / penolakan. */
  galat: () => aman(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  /** Tekan tombol utama. */
  ringan: () => aman(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
};
