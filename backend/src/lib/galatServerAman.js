// JARING PENGAMAN pesan 500: galat internal Prisma TIDAK boleh sampai ke klien.
//
// Sebelumnya beberapa handler menjawab `"Server error: " + err.message`. Untuk galat Prisma, `message` memuat nama pemanggilan
// (`Invalid \`prisma.workCenter.findUnique()\` invocation ...`), nama kolom/tipe, bahkan potongan query. Fungsi ini hanya menyamarkan
// galat bergaya Prisma; galat aplikasi lain tetap meneruskan pesannya seperti biasa (jangan disamarkan — dibutuhkan untuk diagnosis).
// Detail lengkap tetap tercatat di log server lewat console.error pemanggil.

export const PESAN_SERVER_AMAN = "Terjadi kesalahan di server";

/** Galat dari Prisma Client (semua kelas PrismaClient*Error membawa `clientVersion`) atau pesan yang menyebut pemanggilan prisma.*. */
export function adalahGalatPrisma(err) {
  if (!err || typeof err !== "object") return false;
  if (typeof err.name === "string" && err.name.startsWith("PrismaClient")) return true;
  if (typeof err.clientVersion === "string") return true;
  const msg = typeof err.message === "string" ? err.message : "";
  return /`prisma\.[A-Za-z_]+\.[A-Za-z_]+\(/.test(msg) || /\bprisma\.[A-Za-z_]+\.[A-Za-z]+\(\)/.test(msg);
}

/** Teks galat untuk respons 500. `awalan` menjaga format lama ("Server error: ") untuk galat non-Prisma. */
export function pesanServerAman(err, awalan = "Server error: ") {
  if (adalahGalatPrisma(err)) return PESAN_SERVER_AMAN;
  return awalan + (err?.message ?? "");
}
