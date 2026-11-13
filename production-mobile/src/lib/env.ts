import Constants from "expo-constants";

// Semua EXPO_PUBLIC_* dibaca SAAT BUILD (di-inline oleh Metro) — tidak ada rahasia di sini.
const appEnv = (process.env.EXPO_PUBLIC_APP_ENV ?? "development") as "development" | "preview" | "production";
const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:4000/api").replace(/\/+$/, "");

export const ENV = {
  appEnv,
  apiUrl,
  /** Origin server (tanpa /api) — media bertanda tangan dilayani di /media/... */
  origin: apiUrl.replace(/\/api$/, ""),
  variant: (Constants.expoConfig?.extra?.appVariant as string | undefined) ?? appEnv,
  version: Constants.expoConfig?.version ?? "0.0.0",
  pushEnabled: process.env.EXPO_PUBLIC_PUSH_ENABLED === "true",
} as const;

/** URL media dari server (relatif "/media/..." atau absolut) → URL absolut untuk <Image>. */
export function urlMedia(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${ENV.origin}${url.startsWith("/") ? "" : "/"}${url}`;
}
