import { ENV } from "./env";

// FOTO PROFIL — alamat dari server berbentuk path relatif ("/uploads/avatars/xxx.png") dan SAMA dengan yang dipakai SANSS Hub.
// Dijadikan alamat absolut dengan asal (origin) server API. Hanya HTTPS (kecuali development) atau berkas lokal hasil pilih foto; skema lain ditolak.

export function alamatAvatar(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl || typeof avatarUrl !== "string") return null;
  const dev = ENV.appEnv === "development";
  if (/^file:\/\//i.test(avatarUrl) || /^content:\/\//i.test(avatarUrl)) return dev ? avatarUrl : null; // hanya dari mode contoh
  if (/^https?:\/\//i.test(avatarUrl)) return /^https:\/\//i.test(avatarUrl) || dev ? avatarUrl : null;
  if (!avatarUrl.startsWith("/uploads/avatars/") || avatarUrl.includes("..")) return null;
  const origin = ENV.apiUrl.replace(/\/api\/?$/, "");
  return `${origin}${avatarUrl}`;
}

export const inisial = (nama: string | null | undefined): string => (nama ?? "?").trim().slice(0, 1).toUpperCase() || "?";
