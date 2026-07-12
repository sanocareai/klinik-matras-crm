// Context autentikasi — simpan token JWT + info user di AsyncStorage
// supaya sales tidak perlu login ulang tiap buka aplikasi.
import React, { createContext, useContext, useEffect, useState } from "react";
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
        }
      } finally {
        setLoading(false);
      }
    })();
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
    <AuthContext.Provider value={{ user, loading, server, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
