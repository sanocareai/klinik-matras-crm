import { create } from "zustand";
import * as Device from "expo-device";
import { randomUUID } from "expo-crypto";
import { APP_ID, ApiClient, type Tokens } from "@/api/client";
import { ApiError } from "@/api/errors";
import type { Capabilities, LoginResponse, SessionUser } from "@/api/types";
import { ENV } from "@/lib/env";
import { log } from "@/lib/log";
import { clearSession, getDeviceId, loadSession, saveSession, saveTokens } from "./storage";
import { useKeamanan } from "./keamanan";

// SESI — satu-satunya tempat yang memegang token di memori (SecureStore untuk persisten).
//   restore()   saat app dibuka; capabilities dimuat ulang dari GET /auth/me.
//   login()     POST /api/mobile/auth/login { app: "production" } → access 15 mnt + refresh rotasi.
//   logout()    cabut sesi di server (best effort) + hapus token lokal.

type Status = "loading" | "signedOut" | "signedIn";
type Me = SessionUser & { capabilities: Capabilities };

type SessionState = {
  status: Status;
  user: SessionUser | null;
  capabilities: Capabilities | null;
  /** Kode alasan sesi berakhir (banner di layar login); null bila keluar biasa. */
  sesiHilang: string | null;
  restore: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: (opsi?: { alasan?: string }) => Promise<void>;
  refreshMe: () => Promise<void>;
};

let tokens: Tokens | null = null;
let deviceId = "";

const PESAN_TIDAK_BERIZIN = "Aplikasi ini untuk tim Produksi. Akun Anda tidak punya akses Produksi.";

export const api = new ApiClient({
  baseUrl: ENV.apiUrl,
  wajibHttps: ENV.appEnv !== "development",
  getTokens: () => tokens,
  saveTokens: async (t) => { tokens = t; await saveTokens(t); },
  onSessionLost: (alasan) => { void useSession.getState().logout({ alasan }); },
  newId: () => randomUUID(),
  device: () => ({ id: deviceId, appVersion: ENV.version }),
});

/** Token akses saat ini — hanya untuk header gambar yang butuh Bearer (media bertanda tangan tidak perlu). */
export const tokenAkses = () => tokens?.accessToken ?? null;

export const useSession = create<SessionState>((set, get) => ({
  status: "loading",
  user: null,
  capabilities: null,
  sesiHilang: null,

  restore: async () => {
    deviceId = await getDeviceId();
    const s = await loadSession();
    if (!s) { set({ status: "signedOut" }); return; }
    tokens = s.tokens;
    set({ status: "signedIn", user: s.user, capabilities: s.capabilities });
    void get().refreshMe();
  },

  login: async (email, password) => {
    deviceId = await getDeviceId();
    const r = await api.command<LoginResponse>("POST", "/mobile/auth/login", randomUUID(), {
      auth: false,
      body: {
        email: email.trim(), password, app: APP_ID,
        device: { id: deviceId, label: Device.modelName ?? "Android", appVersion: ENV.version, platform: "android" },
      },
    });
    if (!r.capabilities?.productionApp) throw new ApiError({ status: 403, code: "NOT_PRODUCTION_TEAM", message: PESAN_TIDAK_BERIZIN });
    tokens = {
      accessToken: r.accessToken, refreshToken: r.refreshToken,
      accessTokenExpiresAt: r.accessTokenExpiresAt, refreshTokenExpiresAt: r.refreshTokenExpiresAt,
    };
    await saveSession({ tokens, user: r.user, capabilities: r.capabilities });
    // Baru saja membuktikan diri dengan kata sandi → tidak perlu dikunci; email diingat; kata sandi masuk cepat diperbarui bila berganti.
    const k = useKeamanan.getState();
    k.lepasKunci();
    await k.ingatEmail(email).catch(() => {});
    await k.perbaruiSandiTersimpan(email, password).catch(() => {});
    set({ status: "signedIn", user: r.user, capabilities: r.capabilities, sesiHilang: null });
  },

  refreshMe: async () => {
    if (get().status !== "signedIn") return;
    try {
      const me = await api.get<Me>("/auth/me");
      const caps = me.capabilities;
      if (!caps?.productionApp) { await get().logout({ alasan: "NOT_PRODUCTION_TEAM" }); return; }
      const user: SessionUser = { id: me.id, name: me.name, role: me.role, roles: me.roles, avatarUrl: me.avatarUrl ?? null };
      set({ user, capabilities: caps });
      if (tokens) await saveSession({ tokens, user, capabilities: caps });
    } catch (e) {
      // 401 berkode ditangani ApiClient → onSessionLost. Galat jaringan: pakai capabilities tersimpan.
      if (!(e instanceof ApiError)) log.warn("refreshMe gagal");
    }
  },

  logout: async (opsi) => {
    const rt = tokens?.refreshToken;
    tokens = null;
    await clearSession();
    set({ status: "signedOut", user: null, capabilities: null, sesiHilang: opsi?.alasan ?? null });
    if (rt) {
      try { await api.command("POST", "/mobile/auth/logout", randomUUID(), { auth: false, body: { refreshToken: rt } }); } catch (e) {
        if (!(e instanceof ApiError)) log.warn("logout server gagal");
      }
    }
  },
}));
