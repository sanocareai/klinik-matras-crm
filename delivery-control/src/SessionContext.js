import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { controlModules, deliveryExpenseAbilities } from "@sano/delivery-shared";
import { sessionManager, setUnauthorizedHandler } from "./client";
import { usePengaturan } from "./PengaturanContext";
import { autentikasiBiometrik } from "./biometrik";
import { perluKunci } from "./lib/kunciApp";

const Ctx = createContext(null);
// Penanda "perangkat ini punya sesi tersimpan". Bukan rahasia: hanya menandai bahwa saat dibuka perlu biometrik dulu,
// sehingga token TIDAK dibaca dari SecureStore sebelum biometrik lolos.
const KUNCI_PUNYA_SESI = "control:punya-sesi";
const PESAN_BERAKHIR = "Sesi Anda berakhir atau dicabut. Masuk lagi dengan kata sandi.";

export function SessionProvider({ children }) {
  const { siap, biometrik, setBiometrik, autoLockMenit } = usePengaturan();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [terkunci, setTerkunci] = useState(false);
  const [pesanMasuk, setPesanMasuk] = useState("");

  const sessionRef = useRef(null);
  const promptRef = useRef(false); // prompt biometrik sedang tampil: perubahan AppState darinya bukan "ke latar belakang"
  const ditinggalRef = useRef(null);
  const prefRef = useRef({ biometrik, autoLockMenit });
  sessionRef.current = session;
  prefRef.current = { biometrik, autoLockMenit };

  const tandaiSesi = useCallback((ada) => (ada ? AsyncStorage.setItem(KUNCI_PUNYA_SESI, "1") : AsyncStorage.removeItem(KUNCI_PUNYA_SESI)).catch(() => {}), []);

  // Sesi habis/dicabut/biometrik tak berlaku: bersihkan token + penanda, matikan biometrik, kembali ke login dengan pesan.
  const keLogin = useCallback(async (pesan = "") => {
    try { await sessionManager.signOut(); } catch { /* token lokal tetap dihapus di bawah */ }
    await tandaiSesi(false);
    await setBiometrik(false);
    setSession(null); setTerkunci(false); setPesanMasuk(pesan);
  }, [setBiometrik, tandaiSesi]);

  useEffect(() => {
    if (!siap) return;
    setUnauthorizedHandler(() => { tandaiSesi(false); setBiometrik(false); setSession(null); setTerkunci(false); setPesanMasuk(PESAN_BERAKHIR); });
    (async () => {
      let punya = false;
      try { punya = (await AsyncStorage.getItem(KUNCI_PUNYA_SESI)) === "1"; } catch { /* dianggap tidak ada */ }
      if (prefRef.current.biometrik && punya) { setTerkunci(true); setLoading(false); return; } // token belum disentuh
      try { setSession(await sessionManager.restore()); } catch { setSession(null); }
      setLoading(false);
    })();
  }, [siap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-lock: catat saat app ke latar belakang; saat kembali, kunci bila melewati batas menit.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (promptRef.current) return;
      if (state === "background") { ditinggalRef.current = Date.now(); return; }
      if (state === "active") {
        const p = prefRef.current;
        if (perluKunci({ biometrikAktif: p.biometrik, adaSesi: !!sessionRef.current, ditinggalMs: ditinggalRef.current, menit: p.autoLockMenit })) setTerkunci(true);
        ditinggalRef.current = null;
      }
    });
    return () => sub.remove();
  }, []);

  // Prompt biometrik sistem. Hanya PEMBUKA: sesudahnya sesi tetap divalidasi ke server (lihat bukaKunci).
  const konfirmasiBiometrik = useCallback(async (pesan) => {
    promptRef.current = true;
    try { return await autentikasiBiometrik(pesan); }
    finally { setTimeout(() => { promptRef.current = false; }, 400); }
  }, []);

  const bukaKunci = useCallback(async () => {
    const h = await konfirmasiBiometrik();
    if (!h.ok) {
      if (h.wajibMasukUlang) await keLogin(h.pesan);
      return h;
    }
    let baru = null;
    try { baru = await sessionManager.restore(); } catch { baru = null; } // validasi ke server; token expired/dicabut → null
    if (!baru) { await keLogin(PESAN_BERAKHIR); return { ok: false, wajibMasukUlang: true, pesan: PESAN_BERAKHIR }; }
    setSession(baru); setTerkunci(false); setPesanMasuk("");
    return h;
  }, [konfirmasiBiometrik, keLogin]);

  const signIn = useCallback(async (email, password) => {
    const s = await sessionManager.signIn(email.trim(), password);
    await tandaiSesi(true);
    setPesanMasuk("");
    setSession(s);
  }, [tandaiSesi]);
  const signOut = useCallback(() => keLogin(""), [keLogin]);

  // Muat ulang sesi dari SERVER (nama/foto/peran/capabilities terbaru, mis. setelah profil diubah di sini atau di web).
  const muatUlangSesi = useCallback(async () => {
    const baru = await sessionManager.restore();
    if (baru) setSession(baru);
    return baru;
  }, []);

  const value = useMemo(() => ({
    loading, session, signIn, signOut, muatUlangSesi,
    terkunci, pesanMasuk, bukaKunci, konfirmasiBiometrik,
    user: session?.user || null,
    capabilities: session?.capabilities || null,
    abilities: deliveryExpenseAbilities(session?.capabilities),
    modules: controlModules(session?.capabilities),
    offline: !!session?.offline,
  }), [loading, session, signIn, signOut, muatUlangSesi, terkunci, pesanMasuk, bukaKunci, konfirmasiBiometrik]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  return useContext(Ctx);
}
