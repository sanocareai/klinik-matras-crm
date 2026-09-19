import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

// Preferensi tampilan lokal (bukan data keuangan, bukan rahasia). Disimpan
// di SecureStore hanya karena sudah menjadi satu-satunya penyimpanan lokal aplikasi.

export type ThemePref = "system" | "light" | "dark";

type Prefs = {
  loaded: boolean;
  theme: ThemePref;
  efekRingan: boolean;
  sembunyikanAngka: boolean;
  setTheme: (t: ThemePref) => void;
  setEfekRingan: (v: boolean) => void;
  setSembunyikanAngka: (v: boolean) => void;
  load: () => Promise<void>;
};

const KEY = "prefs.v1";

async function simpan(state: Pick<Prefs, "theme" | "efekRingan" | "sembunyikanAngka">) {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(state));
  } catch {
    // preferensi tidak kritis
  }
}

export const usePrefs = create<Prefs>((set, get) => ({
  loaded: false,
  theme: "system",
  efekRingan: false,
  sembunyikanAngka: false,
  setTheme: (theme) => { set({ theme }); void simpan({ ...pick(get()), theme }); },
  setEfekRingan: (efekRingan) => { set({ efekRingan }); void simpan({ ...pick(get()), efekRingan }); },
  setSembunyikanAngka: (sembunyikanAngka) => { set({ sembunyikanAngka }); void simpan({ ...pick(get()), sembunyikanAngka }); },
  load: async () => {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Pick<Prefs, "theme" | "efekRingan" | "sembunyikanAngka">>;
        set({
          theme: p.theme === "light" || p.theme === "dark" ? p.theme : "system",
          efekRingan: !!p.efekRingan,
          sembunyikanAngka: !!p.sembunyikanAngka,
        });
      }
    } catch {
      // pakai bawaan
    }
    set({ loaded: true });
  },
}));

function pick(s: Prefs) {
  return { theme: s.theme, efekRingan: s.efekRingan, sembunyikanAngka: s.sembunyikanAngka };
}
