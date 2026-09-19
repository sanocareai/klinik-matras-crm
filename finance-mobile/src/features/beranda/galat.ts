import { ApiError } from "@/api/errors";

// Galat pemuatan Beranda → jenis + teks Bahasa Indonesia. Tidak pernah menampilkan pesan teknis server.
export type JenisGalat = "offline" | "sesi" | "izin" | "server" | "batas" | "lain";
export type InfoGalat = { jenis: JenisGalat; judul: string; isi: string };

export function klasifikasiGalat(e: unknown, online: boolean): InfoGalat {
  if (e instanceof ApiError) {
    if (e.isAuthLost || e.status === 401) {
      return { jenis: "sesi", judul: "Sesi Anda berakhir", isi: "Demi keamanan, silakan masuk lagi. Data keuangan Anda aman di server." };
    }
    if (e.isForbidden) {
      return { jenis: "izin", judul: "Akun ini belum berizin", isi: "Akun Anda tidak punya izin melihat ringkasan keuangan. Hubungi admin bila ini keliru." };
    }
    if (e.code === "RATE_LIMITED") {
      const d = e.retryAfterSeconds;
      const waktu = d == null ? "beberapa saat" : d >= 90 ? `${Math.ceil(d / 60)} menit` : `${d} detik`;
      return { jenis: "batas", judul: "Terlalu sering memuat", isi: `Coba lagi dalam ${waktu}.` };
    }
    if (e.isNetwork) {
      return online
        ? { jenis: "offline", judul: "Server tidak menjawab", isi: "Koneksi ada, tapi server belum bisa dijangkau. Coba lagi sebentar lagi." }
        : { jenis: "offline", judul: "Tidak ada koneksi", isi: "Periksa internet Anda, lalu coba lagi. Data terakhir yang berhasil dimuat tetap ditampilkan bila ada." };
    }
    if (e.isServer) {
      return { jenis: "server", judul: "Server sedang bermasalah", isi: "Ini bukan kesalahan Anda. Coba lagi sebentar lagi." };
    }
  }
  if (!online) {
    return { jenis: "offline", judul: "Tidak ada koneksi", isi: "Periksa internet Anda, lalu coba lagi." };
  }
  return { jenis: "lain", judul: "Beranda belum bisa dimuat", isi: "Terjadi kesalahan. Coba lagi." };
}
