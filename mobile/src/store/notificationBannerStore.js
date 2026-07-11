// Banner notifikasi in-app kecil — dipicu push.js saat notifikasi pesan
// masuk diterima SELAGI APP FOREGROUND (lihat catatan "Foreground" di
// push.js#setupForegroundBanner). Dipisah dari conversationStore supaya
// tidak numpuk concern yang tidak berhubungan di 1 store.
import { create } from "zustand";

export const useNotificationBannerStore = create((set) => ({
  banner: null, // { title, body, conversationId, customerId, isGroup } | null

  show: (banner) => set({ banner }),
  hide: () => set({ banner: null }),
}));
