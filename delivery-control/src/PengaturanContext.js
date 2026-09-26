import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalisasiTema } from "./lib/pengaturan";
import { ThemeModeProvider } from "./theme";

// Preferensi PERANGKAT ini (bukan data akun): disimpan lokal di AsyncStorage. Tidak berisi rahasia.
const KUNCI = { tema: "control:tema" };
const Ctx = createContext(null);

export function PengaturanProvider({ children }) {
  const [siap, setSiap] = useState(false);
  const [tema, setTemaState] = useState("system");

  useEffect(() => {
    AsyncStorage.getItem(KUNCI.tema)
      .then((v) => setTemaState(normalisasiTema(v)))
      .catch(() => {})
      .finally(() => setSiap(true));
  }, []);

  const setTema = useCallback(async (v) => {
    const baru = normalisasiTema(v);
    setTemaState(baru);
    try { await AsyncStorage.setItem(KUNCI.tema, baru); } catch { /* tema tetap berlaku selama app terbuka */ }
  }, []);

  const value = useMemo(() => ({ siap, tema, setTema }), [siap, tema, setTema]);
  return (
    <Ctx.Provider value={value}>
      <ThemeModeProvider mode={tema}>{children}</ThemeModeProvider>
    </Ctx.Provider>
  );
}

export function usePengaturan() {
  return useContext(Ctx);
}
