// Context autentikasi — pola SAMA dengan mobile/src/context/AuthContext.js
// (Sano Messenger), TANPA socket.js (driver app tidak butuh realtime chat).
import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, configureApi, DEFAULT_SERVER } from "../api";
import { registerForPush, unregisterPush } from "../push";
import { queryClient } from "../lib/queryClient";

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
          // Cache rusak (22 September 2026, bug Difa "app tidak bisa
          // dibuka") — AKAR MASALAH: `JSON.parse(savedUser)` di sini
          // SEBELUMNYA tidak pernah dibungkus try/catch tersendiri. Kalau
          // isi AsyncStorage "user" korup (penyimpanan HP penuh/ditutup
          // paksa di tengah tulis, dst — nyata terjadi di RN, bukan cuma
          // teori), parse ini melempar SEBELUM `setLoading(false)` di
          // `finally` bawah sempat jalan lewat jalur normal — exception-nya
          // lolos sebagai unhandled rejection dari IIFE async ini, DAN
          // (sebelum perbaikan ini) sesi lama yang rusak tetap tersangkut
          // di AsyncStorage selamanya, jadi app mencoba parse ulang data
          // yang SAMA rusaknya tiap kali dibuka lagi. FIX: tangkap khusus
          // di sini, buang sesi yang rusak, jatuh ke layar Login bersih —
          // driver tinggal login ulang, bukan macet permanen.
          let parsedUser;
          try {
            parsedUser = JSON.parse(savedUser);
          } catch {
            await AsyncStorage.multiRemove(["token", "user"]);
            configureApi({ jwt: null });
            return;
          }
          setUser(parsedUser);
          setIsOnline(!!parsedUser.isOnline);
          registerForPush(parsedUser);
          // Tarik profil TERBARU dari server (19 September 2026, D-168,
          // laporan owner: "gue baru ganti foto para driver di web, tapi di
          // app belum keupdate") — sebelum ini `user` HANYA pernah ditulis
          // ulang dari AsyncStorage (sekali saat login) atau saat driver
          // MENGEDIT PROFILNYA SENDIRI (AccountScreen -> updateUser()). Kalau
          // ADMIN yang ganti nama/foto driver dari web (Pengguna & Peran),
          // tidak ada jalan bagi app ini untuk pernah tahu — sampai driver
          // logout lalu login lagi. Best-effort, tidak memblokir loading.
          refreshUser();
        }
      } catch {
        // Jaring pengaman terluar (22 September 2026, bug Difa) — AsyncStorage
        // sendiri bisa gagal baca (storage HP korup/penuh). SEBELUM ini tidak
        // ada catch sama sekali di blok terluar (cuma `finally`), jadi
        // kegagalan di sini jadi unhandled rejection dan splash screen bisa
        // tidak pernah ditutup (lihat App.js: SplashScreen.hideAsync() cuma
        // dipanggil setelah `loading` false, yang di-set di `finally` — itu
        // TETAP jalan, tapi tanpa catch ini exception-nya bisa membawa state
        // tidak konsisten). Diam-diam jatuh ke Login, bukan macet.
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Ambil profil terbaru dari GET /users/me, gabungkan ke `user` yang
  // sedang tersimpan (nama role dkk ikut, bukan cuma avatar) + AsyncStorage
  // — pola SAMA dengan updateUser()/setOnline() di bawah, bedanya sumber
  // datanya server (fetch), bukan hasil panggilan API lain yang sudah ada
  // di tangan. Sengaja menelan error (offline/timeout) — refresh diam-diam
  // ini TIDAK BOLEH mengganggu app kalau gagal, cukup coba lagi nanti.
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
      if (fresh.isOnline !== undefined) setIsOnline(!!fresh.isOnline);
    } catch {
      // diam-diam — lihat komentar di atas
    }
  }

  // refreshUser dipanggil lagi setiap app kembali ke foreground (bukan
  // cuma sekali saat cold start di atas) — driver yang membiarkan app
  // berjalan di background berhari-hari (paling umum di lapangan) tidak
  // akan pernah lewat jalur restore-session itu lagi. Pakai ref supaya
  // listener AppState cukup didaftar SEKALI (bukan tiap render ulang),
  // tapi tetap memanggil versi refreshUser TERBARU (closure `user` segar).
  const refreshUserRef = useRef(refreshUser);
  refreshUserRef.current = refreshUser;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") refreshUserRef.current();
    });
    return () => sub.remove();
  }, []);

  async function login(email, password, serverUrl) {
    const srv = (serverUrl || DEFAULT_SERVER).replace(/\/+$/, "");
    configureApi({ server: srv });
    const res = await api.login(email.trim(), password);
    configureApi({ jwt: res.token });
    // Buang cache react-query SEBELUM set user baru (22 September 2026,
    // pertahanan kedua utk "cache user A tidak boleh muncul di user B" —
    // pertahanan PERTAMA sudah di query key ["armada","my-jobs",userId]
    // per hook, ini cuma jaga-jaga tambahan + higienis memori kalau HP
    // dipakai bergantian tanpa uninstall di antaranya).
    queryClient.clear();
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
    queryClient.clear(); // lihat catatan di login() — sisi lain pasangan yang sama
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
    <AuthContext.Provider value={{ user, loading, server, login, logout, isOnline, setOnline, markOnlineLocally, updateUser, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
