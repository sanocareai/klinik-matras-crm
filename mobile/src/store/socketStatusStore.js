// Status koneksi Socket.IO — dipakai banner "Menyambung ulang..." saat
// koneksi putus (lihat SocketStatusBanner.js + useSocketEvents.js).
import { create } from "zustand";

export const useSocketStatusStore = create((set) => ({
  connected: true, // optimistic — banner cuma muncul setelah benar-benar disconnect

  setConnected: (connected) => set({ connected }),
}));
