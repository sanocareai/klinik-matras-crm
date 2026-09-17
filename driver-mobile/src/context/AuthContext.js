// Context autentikasi — pola SAMA dengan mobile/src/context/AuthContext.js
// (Sano Messenger), TANPA socket.js (driver app tidak butuh realtime chat).
import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, configureApi, DEFAULT_SERVER } from "../api";
import { registerForPush, unregisterPush } from "../push";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [server, setServer] = useState(DEFAULT_SERVER);
  // isOnline TERPISAH dari `user` (12 Sep 2026, status Online/Offline
  // referensi Gojek/Grab) — walau nilai awalnya datang dari user.isOnline
  // (login/session restore), field ini SERING berubah (toggle manual,
  // auto-online dari backend saat mulai job) tanpa perlu menulis ulang
  // seluruh objek `user` yang tersimpan di AsyncStorage tiap kali.
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [savedToken, savedUser, savedServer] = await Promise.all([
          AsyncStorage.getItem("token"),
          AsyncStorage.getItem("user"),
          AsyncStorage.getItem("server"),
        ]);
        const srv = savedServer || DEFAULT_SERVER;
        setServer(srv);
        configureApi({
          server: srv,
          jwt: savedToken,
          unauthorizedHandler: () => setUser(null),
        });
        if (savedToken && savedUser) {
          const parsedUser = JSON.parse(savedUser);
          setUser(parsedUser);
          setIsOnline(!!parsedUser.isOnline);
          registerForPush(parsedUser);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(email, password, serverUrl) {
    const srv = (serverUrl || DEFAULT_SERVER).replace(/\/+$/, "");
    configureApi({ server: srv });
    const res = await api.login(email.trim(), password);
    configureApi({ jwt: res.token });
    await Promise.all([
      AsyncStorage.setItem("token", res.token),
      AsyncStorage.setItem("user", JSON.stringify(res.user)),
      AsyncStorage.setItem("server", srv),
    ]);
    setServer(srv);
    setUser(res.user);
    setIsOnline(!!res.user.isOnline);
    registerForPush(res.user);
  }

  async function logout() {
    // Offline dulu SEBELUM logout (12 Sep 2026) — driver yang keluar dari
    // app wajar dianggap selesai kerja; tanpa ini, statusnya "menggantung"
    // Online selamanya di sisi admin sampai ada yang toggle manual dari
    // device lain (yang tidak akan pernah terjadi kalau akun ini yang
    // sedang logout). Best-effort — logout TETAP jalan walau ini gagal
    // (mis. sudah offline internet saat menekan Keluar).
    try { await api.setOnlineStatus(false); } catch {}
    await unregisterPush();
    await AsyncStorage.multiRemove(["token", "user"]);
    configureApi({ jwt: null });
    setUser(null);
    setIsOnline(false);
  }

  // Toggle MANUAL (12 Sep 2026) — dipanggil dari switch di JobListScreen.
  // Offline WAJIB lewat sini (keputusan owner: semi-otomatis, Offline
  // tidak pernah otomatis). Online juga bisa dipicu manual dari sini
  // (jaga-jaga driver mau online duluan sebelum job pertama ditugaskan).
  async function setOnline(online) {
    const res = await api.setOnlineStatus(online);
    setIsOnline(res.isOnline);
    setUser((u) => {
      if (!u) return u;
      const next = { ...u, isOnline: res.isOnline, onlineSince: res.onlineSince };
      AsyncStorage.setItem("user", JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  // Sinkron LOKAL saat backend meng-auto-online-kan (12 Sep 2026) — dipanggil
  // JobCard/RouteStartCard setelah aksi "Mulai" berhasil, supaya switch di
  // Beranda langsung ikut nyala tanpa driver perlu tap manual DUA kali
  // (sekali start job, sekali lagi toggle Online yang sebenarnya sudah
  // otomatis nyala di backend). BUKAN panggilan API — cuma refleksikan efek
  // samping yang SUDAH terjadi di server saat job dimulai.
  function markOnlineLocally() {
    if (isOnline) return;
    setIsOnline(true);
    setUser((u) => {
      if (!u) return u;
      const next = { ...u, isOnline: true, onlineSince: new Date().toISOString() };
      AsyncStorage.setItem("user", JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  // Sinkron LOKAL setelah patch profil di server (18 September 2026, layar
  // Akun) — dipanggil AccountScreen setelah api.uploadAvatar/PATCH /me
  // sukses, supaya avatarUrl/nama baru langsung kepakai di seluruh app
  // (hero card JobListScreen, dst) tanpa logout/login ulang. BUKAN panggilan
  // API sendiri — cuma menggabungkan hasil yang backend SUDAH kembalikan ke
  // state lokal + AsyncStorage, sama pola dengan setOnline/markOnlineLocally
  // di atas.
  function updateUser(patch) {
    setUser((u) => {
      if (!u) return u;
      const next = { ...u, ...patch };
      AsyncStorage.setItem("user", JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  return (
    <AuthContext.Provider value={{ user, loading, server, login, logout, isOnline, setOnline, markOnlineLocally, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
