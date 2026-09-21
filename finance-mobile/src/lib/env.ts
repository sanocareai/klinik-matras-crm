import Constants from "expo-constants";

// Semua EXPO_PUBLIC_* dibaca SAAT BUILD (di-inline oleh Metro) — tidak ada rahasia di sini.
// Nilainya datang dari profil di eas.json (lihat README).
const appEnv = (process.env.EXPO_PUBLIC_APP_ENV ?? "development") as "development" | "preview" | "production";
const flagMocks = (process.env.EXPO_PUBLIC_USE_MOCKS ?? (appEnv === "development" ? "true" : "false")) === "true";

export const ENV = {
  appEnv,
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:4000/api").replace(/\/+$/, ""),
  // Data contoh TIDAK PERNAH aktif di build production, apa pun flag-nya.
  useMocks: appEnv !== "production" && flagMocks,
  variant: (Constants.expoConfig?.extra?.appVariant as string | undefined) ?? appEnv,
  version: Constants.expoConfig?.version ?? "0.0.0",
  // Build preview ke API produksi: perintah uang dinonaktifkan (lihat lib/bacaSaja.ts). Tidak berlaku bila data contoh aktif.
  readOnly: process.env.EXPO_PUBLIC_READ_ONLY === "true",
  // Notifikasi push (S11): MATI kecuali dinyalakan eksplisit saat build (butuh google-services.json / FCM). Saat mati: tanpa izin, tanpa token, tanpa listener.
  pushEnabled: process.env.EXPO_PUBLIC_PUSH_ENABLED === "true",
} as const;
