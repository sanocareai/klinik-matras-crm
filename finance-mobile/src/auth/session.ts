import { create } from "zustand";
import * as Device from "expo-device";
import { randomUUID } from "expo-crypto";
import { ApiClient, type Tokens } from "@/api/client";
import { ApiError } from "@/api/errors";
import type { Capabilities, LoginResponse, SessionUser } from "@/api/types";
import { ENV } from "@/lib/env";
import { log } from "@/lib/log";
import { peranContoh } from "@/mocks/roles";
import { setSkenario, skenarioDariEmail } from "@/mocks/skenario";
import { clearSession, getDeviceId, loadSession, saveSession, saveTokens } from "./storage";
import { useLock } from "./lock";

// SESI — satu-satunya tempat yang memegang token di memori. Token disimpan di SecureStore.
//   restore()   saat app dibuka; capabilities dimuat ulang dari GET /auth/me (refreshMe).
//   login()     POST /api/mobile/auth/login (access 15 mnt + refresh rotasi).
//   logout()    mencabut sesi di server (best effort) + menghapus token, PIN, dan pengaturan kunci lokal.
//   sessionLost dari ApiClient: refresh gagal / sesi dicabut / akun nonaktif → kembali ke login dengan alasan.
// Mode contoh (ENV.useMocks): login tanpa jaringan/token; peran ditentukan isi email (mocks/roles.ts).

type Status = "loading" | "signedOut" | "signedIn";

type Me = SessionUser & { capabilities: Capabilities };

type SessionState = {
  status: Status;
  user: SessionUser | null;
  capabilities: Capabilities | null;
  /** Kode alasan sesi berakhir (untuk banner di layar login); null bila keluar biasa. */
  sesiHilang: string | null;
  restore: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: (opsi?: { alasan?: string }) => Promise<void>;
  /** Muat ulang role & capabilities dari server (GET /auth/me). */
  refreshMe: () => Promise<void>;
};

let tokens: Tokens | null = null;
let deviceId = "";

const PESAN_TIDAK_BERIZIN = "Aplikasi ini untuk tim Finance. Akun Anda tidak punya akses Finance.";

export const api = new ApiClient({
  baseUrl: ENV.apiUrl,
  getTokens: () => tokens,
  saveTokens: async (t) => { tokens = t; await saveTokens(t); },
  onSessionLost: (alasan) => { void useSession.getState().logout({ alasan }); },
  newId: () => randomUUID(),
  device: () => ({ id: deviceId, appVersion: ENV.version }),
});

export const useSession = create<SessionState>((set, get) => ({
  status: "loading",
  user: null,
  capabilities: null,
  sesiHilang: null,

  restore: async () => {
    if (ENV.useMocks) { set({ status: "signedOut" }); return; }
    deviceId = await getDeviceId();
    const s = await loadSession();
    if (!s) { set({ status: "signedOut" }); return; }
    tokens = s.tokens;
    set({ status: "signedIn", user: s.user, capabilities: s.capabilities });
    void get().refreshMe(); // tidak menghalangi buka aplikasi; offline pun tetap masuk (data tidak dimuat)
  },

  login: async (email, password) => {
    if (ENV.useMocks) {
      const p = peranContoh(email);
      setSkenario(skenarioDariEmail(email));
      if ("tanpaAkses" in p) {
        throw new ApiError({ status: 403, code: "NOT_FINANCE_TEAM", message: PESAN_TIDAK_BERIZIN });
      }
      set({ status: "signedIn", user: p.user, capabilities: p.capabilities, sesiHilang: null });
      return;
    }
    deviceId = await getDeviceId();
    const r = await api.command<LoginResponse>("POST", "/mobile/auth/login", randomUUID(), {
      auth: false,
      body: {
        email: email.trim(), password,
        device: { id: deviceId, label: Device.modelName ?? "Android", appVersion: ENV.version, platform: "android" },
      },
    });
    if (!r.capabilities?.financeApp) {
      throw new ApiError({ status: 403, code: "NOT_FINANCE_TEAM", message: PESAN_TIDAK_BERIZIN });
    }
    tokens = {
      accessToken: r.accessToken, refreshToken: r.refreshToken,
      accessTokenExpiresAt: r.accessTokenExpiresAt, refreshTokenExpiresAt: r.refreshTokenExpiresAt,
    };
    await saveSession({ tokens, user: r.user, capabilities: r.capabilities });
    set({ status: "signedIn", user: r.user, capabilities: r.capabilities, sesiHilang: null });
  },

  refreshMe: async () => {
    if (ENV.useMocks || get().status !== "signedIn") return;
    try {
      const me = await api.get<Me>("/auth/me");
      const caps = me.capabilities;
      if (!caps?.financeApp) { await get().logout({ alasan: "NOT_FINANCE_TEAM" }); return; }
      const user: SessionUser = { id: me.id, name: me.name, role: me.role, roles: me.roles, avatarUrl: me.avatarUrl ?? null };
      set({ user, capabilities: caps });
      if (tokens) await saveSession({ tokens, user, capabilities: caps });
    } catch (e) {
      // 401 berkode (dicabut/nonaktif) ditangani ApiClient → onSessionLost. Galat jaringan/server diabaikan:
      // capabilities tersimpan tetap dipakai sampai koneksi pulih.
      if (!(e instanceof ApiError)) log.warn("refreshMe gagal");
    }
  },

  logout: async (opsi) => {
    const rt = tokens?.refreshToken;
    tokens = null;
    await clearSession();
    await useLock.getState().reset(); // PIN & pengaturan kunci milik sesi ini ikut dihapus
    set({ status: "signedOut", user: null, capabilities: null, sesiHilang: opsi?.alasan ?? null });
    if (rt && !ENV.useMocks) {
      // Cabut di server (idempoten). Gagal jaringan tidak menghalangi keluar lokal.
      try { await api.command("POST", "/mobile/auth/logout", randomUUID(), { auth: false, body: { refreshToken: rt } }); } catch (e) {
        if (!(e instanceof ApiError)) log.warn("logout server gagal");
      }
    }
  },
}));
