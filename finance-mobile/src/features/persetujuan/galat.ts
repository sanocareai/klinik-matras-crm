import { ApiError } from "@/api/errors";
import { AksesDitolak } from "@/auth/capabilities";
import { StepUpDibatalkan } from "@/api/command";
import { ModeBacaSaja, PESAN_BACA_SAJA } from "@/lib/bacaSaja";

// Galat KEPUTUSAN (setujui/tolak) → jenis + kalimat Bahasa Indonesia. Pesan teknis server tidak ditampilkan, kecuali pesan aturan
// bisnis (422/400) yang memang ditujukan ke pengguna.
export type JenisGalatKeputusan = "batal" | "konflik" | "izin" | "tidakPasti" | "jaringan" | "server" | "validasi" | "lain";
export type InfoGalatKeputusan = { jenis: JenisGalatKeputusan; pesan: string; muatUlang: boolean; segarkanIzin: boolean; simpanKunci: boolean };

export function klasifikasiKeputusan(e: unknown): InfoGalatKeputusan {
  if (e instanceof StepUpDibatalkan) return { jenis: "batal", pesan: "", muatUlang: false, segarkanIzin: false, simpanKunci: false };
  if (e instanceof ModeBacaSaja) return { jenis: "validasi", pesan: PESAN_BACA_SAJA, muatUlang: false, segarkanIzin: false, simpanKunci: false };
  if (e instanceof AksesDitolak) return { jenis: "izin", pesan: e.message, muatUlang: false, segarkanIzin: true, simpanKunci: false };
  if (e instanceof ApiError) {
    if (e.tidakPasti) {
      return {
        jenis: "tidakPasti", muatUlang: true, segarkanIzin: false, simpanKunci: true,
        pesan: "Koneksi terputus setelah perintah terkirim, jadi hasilnya belum pasti. Daftar dimuat ulang — cek statusnya dulu sebelum mencoba lagi.",
      };
    }
    if (e.isNetwork) return { jenis: "jaringan", pesan: "Tidak ada koneksi. Perintah belum terkirim — coba lagi setelah tersambung.", muatUlang: false, segarkanIzin: false, simpanKunci: false };
    if (e.status === 409) {
      return { jenis: "konflik", pesan: "Dokumen ini sudah diproses pengguna lain. Status terbaru dimuat ulang.", muatUlang: true, segarkanIzin: false, simpanKunci: false };
    }
    if (e.status === 403) {
      return { jenis: "izin", pesan: "Izin Anda berubah dan tidak lagi mencukupi untuk tindakan ini. Hak akses dimuat ulang.", muatUlang: true, segarkanIzin: true, simpanKunci: false };
    }
    if (e.status === 400 || e.status === 422) return { jenis: "validasi", pesan: e.message, muatUlang: e.status === 422, segarkanIzin: false, simpanKunci: false };
    if (e.status === 404) return { jenis: "konflik", pesan: "Dokumen tidak ditemukan lagi. Daftar dimuat ulang.", muatUlang: true, segarkanIzin: false, simpanKunci: false };
    if (e.status === 429) return { jenis: "server", pesan: "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.", muatUlang: false, segarkanIzin: false, simpanKunci: false };
    if (e.isServer) return { jenis: "server", pesan: "Server sedang bermasalah. Perintah mungkin belum tercatat — cek statusnya sebelum mencoba lagi.", muatUlang: true, segarkanIzin: false, simpanKunci: true };
  }
  return { jenis: "lain", pesan: "Terjadi kesalahan. Coba lagi.", muatUlang: false, segarkanIzin: false, simpanKunci: false };
}
