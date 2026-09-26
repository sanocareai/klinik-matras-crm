import { client } from "./client";

// Profil akun = akun server yang SAMA dengan web. Semua lewat endpoint yang sudah ada:
//   GET /auth/me (nama, peran, divisi efektif, foto), GET /users/me (email), PATCH /users/me (name/email),
//   POST /users/me/avatar (foto profil, multipart). Tidak ada penyimpanan profil lokal.
export const profileApi = {
  ambil: async () => {
    const [auth, users] = await Promise.all([client.request("/auth/me"), client.request("/users/me")]);
    return { auth, users };
  },
  ubah: (body) => client.request("/users/me", { method: "PATCH", body }),
  unggahFoto: (file) => client.upload("/users/me/avatar", file, { fieldName: "file" }),
};
