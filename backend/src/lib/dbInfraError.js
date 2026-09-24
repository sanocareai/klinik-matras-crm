// Kegagalan INFRASTRUKTUR database (bukan konflik bisnis): Prisma tidak sempat memulai / menyelesaikan transaksi karena
// server atau kolam koneksi sibuk. Transaksi TIDAK diproses sama sekali (dibatalkan), jadi aman diulang.
//   P2028  Transaction API error (tidak dapat mulai transaksi tepat waktu / transaksi kedaluwarsa)
//   P2024  Timed out fetching a new connection from the connection pool
//
// Dulu sebagian rute memetakan P2028 ke 409 "sedang diproses di perangkat lain" — menyesatkan: pengguna mengira ada
// pekerja lain padahal server yang sibuk. Sekarang 503 + kode stabil. Konflik kunci baris sungguhan (55P03, lock_not_available)
// TETAP konflik bisnis (409) dan tidak lewat sini.

export const KODE_DB_SIBUK = "DB_TRANSAKSI_TIMEOUT";
export const PESAN_DB_SIBUK = "Sistem sedang sibuk sehingga transaksi belum diproses. Tidak ada data yang berubah — coba lagi beberapa saat lagi.";

export function adalahGalatInfraDb(err) {
  return err?.code === "P2028" || err?.code === "P2024";
}

/** Balas 503 stabil. Pemanggil cukup: if (adalahGalatInfraDb(err)) return kirimGalatInfraDb(res, err, "[label]"); */
export function kirimGalatInfraDb(res, err, label = "[db]") {
  console.error(`${label} galat infrastruktur DB (${err.code}): ${String(err.message).split("\n").pop().trim()}`);
  res.setHeader("Retry-After", "3");
  return res.status(503).json({ error: PESAN_DB_SIBUK, code: KODE_DB_SIBUK });
}
