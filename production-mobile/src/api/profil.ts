import { api } from "@/auth/session";
import { mimeBerkas } from "./aksi";

// FOTO PROFIL — terintegrasi dengan SANSS: kolom User.avatarUrl yang SAMA dengan SANSS Hub (web) dan aplikasi Finance.
//   Baca  : GET  /api/auth/me                 (avatarUrl, dimuat ulang saat tab Akun dibuka / ditarik)
//   Ganti : POST /api/mobile/me/avatar        (multipart field "file", ≤ 8 MB; server memotong & memperkecil, foto lama dihapus)
// Mengganti di aplikasi langsung berlaku di web, dan sebaliknya. Hanya foto DIRI SENDIRI.
export async function gantiFotoProfil(foto: { uri: string; mimeType?: string | null; fileName?: string | null }): Promise<string> {
  const type = mimeBerkas({ uri: foto.uri, mimeType: foto.mimeType, fileName: foto.fileName, type: "image" });
  const form = new FormData();
  form.append("file", { uri: foto.uri, name: foto.fileName || `foto.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`, type } as unknown as Blob);
  const r = await api.upload<{ avatarUrl?: unknown }>("/mobile/me/avatar", form);
  if (typeof r?.avatarUrl !== "string") throw new Error("Server tidak mengembalikan foto");
  return r.avatarUrl;
}
