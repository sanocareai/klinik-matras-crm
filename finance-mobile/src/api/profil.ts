import { api } from "@/auth/session";
import { ApiError } from "./errors";
import { ENV } from "@/lib/env";

// FOTO PROFIL: POST /api/mobile/me/avatar (multipart, field "file"). Server membulatkan & memperkecil foto; kolom User.avatarUrl sama dengan SANSS Hub.
// Bukan perintah uang — tidak butuh Idempotency-Key/step-up; hasilnya idempoten secara perilaku (foto terakhir menang, foto lama dihapus server).

export async function gantiFotoProfil(foto: { uri: string; nama?: string | null; mime?: string | null }): Promise<string> {
  if (ENV.useMocks) return foto.uri; // server contoh: tampilkan berkas lokal
  const form = new FormData();
  form.append("file", { uri: foto.uri, name: foto.nama || "foto.jpg", type: foto.mime || "image/jpeg" } as unknown as Blob);
  const r = await api.upload<{ avatarUrl?: unknown }>("/mobile/me/avatar", form);
  if (typeof r?.avatarUrl !== "string") throw new ApiError({ status: 502, code: "PARSE", message: "Respons server tidak bisa dibaca" });
  return r.avatarUrl;
}
