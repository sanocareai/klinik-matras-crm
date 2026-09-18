// Context autentikasi — simpan token JWT + info user di AsyncStorage
// supaya sales tidak perlu login ulang tiap buka aplikasi.
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, configureApi, DEFAULT_SERVER } from "../api";
import { registerForPush, unregisterPush } from "../push";
import { refreshSocketAuth, disconnectSocket } from "../lib/socket";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // masih baca AsyncStorage saat app dibuka
  const [server, setServer] = useState(DEFAULT_SERVER);

  // Saat app dibuka: pulihkan sesi dari storage
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
          registerForPush(parsedUser); // refresh token push tiap app dibuka (fire-and-forget)
          refreshSocketAuth(); // sambungkan socket pakai token yang baru dipulihkan
          // Tarik profil TERBARU dari server (19 September 2026, D-168 — bug
          // yang sama ditemukan & diperbaiki dulu di driver-mobile: admin
          // ganti nama/foto SALES dari web (Pengguna & Peran), app ini tidak
          // pernah tahu sampai logout/login ulang karena `user` cuma pernah
          // ditulis dari AsyncStorage atau updateUser() lokal. Best-effort,
          // tidak memblokir loading.
          refreshUser();
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Sama persis pola driver-mobile/src/context/AuthContext.js#refreshUser —
  // JANGAN biarkan dua implementasi ini diam-diam menyimpang, keduanya
  // menyelesaikan masalah yang identik (profil user diubah admin dari web).
  async function refreshUser() {
    try {
      const fresh = await api.getMe();
      if (!fresh) return;
      setUser((u) => {
        if (!u) return u;
        const next = { ...u, ...fresh };
        AsyncStorage.setItem("user", JSON.stringify(next)).catch(() => {});
        return next;
      });
    } catch {
      // diam-diam — offline/timeout tidak boleh mengganggu apa pun
    }
  }

  // Refresh lagi setiap app kembali ke foreground — pola AppState SAMA
  // dengan useBadgeSync.js (sudah ada di app ini). Ref supaya listener
  // cukup didaftar sekali tapi tetap memanggil closure refreshUser terbaru.
  const refreshUserRef = useRef(refreshUser);
  refreshUserRef.current = refreshUser;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshUserRef.current();
    });
    return () => sub.remove();
  }, []);

  async function login(email, password, serverUrl) {
    const srv = (serverUrl || DEFAULT_SERVER).replace(/\/+$/, ""); // buang trailing slash
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
    registerForPush(res.user); // daftarkan device untuk notifikasi pesan masuk
    refreshSocketAuth(); // sambungkan socket pakai token yang baru login
  }

  async function logout() {
    await unregisterPush(); // hapus token dulu selagi masih terautentikasi
    await AsyncStorage.multiRemove(["token", "user"]);
    configureApi({ jwt: null });
    disconnectSocket();
    setUser(null);
  }

  // Merge patch ke user yang sedang login (mis. avatarUrl baru setelah
  // upload foto profil) — supaya langsung ke-refresh di semua tempat yang
  // pakai useAuth() (header Home, ProfileScreen, dst) tanpa perlu logout.
  async function updateUser(patch) {
    setUser((prev) => {
      const next = prev ? { ...prev, ...patch } : prev;
      AsyncStorage.setItem("user", JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  return (
    <AuthContext.Provider value={{ user, loading, server, login, logout, updateUser, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
