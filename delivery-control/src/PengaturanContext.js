import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AUTO_LOCK_BAWAAN, normalisasiAutoLock, normalisasiTema } from "./lib/pengaturan";
import { ThemeModeProvider } from "./theme";

// Preferensi PERANGKAT ini (bukan data akun): disimpan lokal di AsyncStorage. Tidak berisi rahasia (token ada di SecureStore).
const KUNCI = { tema: "control:tema", biometrik: "control:biometrik", autoLock: "control:autolock" };
const Ctx = createContext(null);

export function PengaturanProvider({ children }) {
  const [siap, setSiap] = useState(false);
  const [tema, setTemaState] = useState("system");
  const [biometrik, setBiometrikState] = useState(false);
  const [autoLockMenit, setAutoLockState] = useState(AUTO_LOCK_BAWAAN);

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(KUNCI.tema), AsyncStorage.getItem(KUNCI.biometrik), AsyncStorage.getItem(KUNCI.autoLock)])
      .then(([t, b, a]) => { setTemaState(normalisasiTema(t)); setBiometrikState(b === "1"); setAutoLockState(normalisasiAutoLock(a)); })
      .catch(() => {})
      .finally(() => setSiap(true));
  }, []);

  const setTema = useCallback(async (v) => {
    const baru = normalisasiTema(v);
    setTemaState(baru);
    try { await AsyncStorage.setItem(KUNCI.tema, baru); } catch { /* tema tetap berlaku selama app terbuka */ }
  }, []);
  const setBiometrik = useCallback(async (aktif) => {
    setBiometrikState(!!aktif);
    try { await AsyncStorage.setItem(KUNCI.biometrik, aktif ? "1" : "0"); } catch { /* berlaku selama app terbuka */ }
  }, []);
  const setAutoLock = useCallback(async (menit) => {
    const baru = normalisasiAutoLock(menit);
    setAutoLockState(baru);
    try { await AsyncStorage.setItem(KUNCI.autoLock, String(baru)); } catch { /* berlaku selama app terbuka */ }
  }, []);

  const value = useMemo(
    () => ({ siap, tema, setTema, biometrik, setBiometrik, autoLockMenit, setAutoLock }),
    [siap, tema, setTema, biometrik, setBiometrik, autoLockMenit, setAutoLock],
  );
  return (
    <Ctx.Provider value={value}>
      <ThemeModeProvider mode={tema}>{children}</ThemeModeProvider>
    </Ctx.Provider>
  );
}

export function usePengaturan() {
  return useContext(Ctx);
}
