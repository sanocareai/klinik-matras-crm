import { create } from "zustand";
import * as Device from "expo-device";
import { ApiClient, type Tokens } from "@/api/client";
import { ApiError } from "@/api/errors";
import type { Capabilities, LoginResponse, SessionUser } from "@/api/types";
import { ENV } from "@/lib/env";
import { randomUUID } from "expo-crypto";
import { clearSession, getDeviceId, loadSession, saveSession, saveTokens } from "./storage";

// SESI — satu-satunya tempat yang memegang token di memori. Token disimpan di SecureStore.
//   restore()  saat app dibuka; login()/logout() dari layar; sessionLost dari ApiClient.
// Mode contoh (ENV.useMocks): login tanpa jaringan, tanpa token — agar navigasi & visual bisa diuji.

type Status = "loading" | "signedOut" | "signedIn";

type SessionState = {
  status: Status;
  user: SessionUser | null;
  capabilities: Capabilities | null;
  /** Alasan sesi hilang (untuk layar "Sesi berakhir"). */
  sesiHilang: string | null;
  restore: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

let tokens: Tokens | null = null;
let deviceId = "";

const CONTOH_CAPS: Capabilities = {
  financeRead: true, financePost: true, financeApprove: true, financeAdmin: false,
  paymentRead: true, paymentWrite: true, expenseSubmit: true, financeApp: true, preset: "FINANCE",
};
const CONTOH_USER: SessionUser = { id: "contoh-1", name: "Natasha (contoh)", role: "FINANCE", roles: ["FINANCE"] };

export const api = new ApiClient({
  baseUrl: ENV.apiUrl,
  getTokens: () => tokens,
  saveTokens: async (t) => { tokens = t; await saveTokens(t); },
  onSessionLost: (alasan) => { void useSession.getState().logout().then(() => useSession.setState({ sesiHilang: alasan })); },
  newId: () => randomUUID(),
  device: () => ({ id: deviceId, appVersion: ENV.version }),
});

export const useSession = create<SessionState>((set) => ({
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
  },

  login: async (email, password) => {
    if (ENV.useMocks) {
      set({ status: "signedIn", user: CONTOH_USER, capabilities: CONTOH_CAPS, sesiHilang: null });
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
    tokens = {
      accessToken: r.accessToken, refreshToken: r.refreshToken,
      accessTokenExpiresAt: r.accessTokenExpiresAt, refreshTokenExpiresAt: r.refreshTokenExpiresAt,
    };
    await saveSession({ tokens, user: r.user, capabilities: r.capabilities });
    set({ status: "signedIn", user: r.user, capabilities: r.capabilities, sesiHilang: null });
  },

  logout: async () => {
    const rt = tokens?.refreshToken;
    tokens = null;
    await clearSession();
    set({ status: "signedOut", user: null, capabilities: null });
    if (rt && !ENV.useMocks) {
      // Cabut di server (idempoten). Gagal jaringan tidak menghalangi keluar lokal.
      try { await api.command("POST", "/mobile/auth/logout", randomUUID(), { auth: false, body: { refreshToken: rt } }); } catch (e) {
        if (!(e instanceof ApiError)) throw e;
      }
    }
  },
}));
