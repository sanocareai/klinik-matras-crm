// Pesan galat untuk aksi Finance pada Klaim Lunas (verifikasi / minta bukti / tolak). Server menjawab 403 bila akun TIDAK punya izin payment:write — izin itu SENGAJA khusus
// peran FINANCE (ADMIN/OWNER tidak memilikinya: pemisahan tugas). Pesan bawaan server ("Forbidden"/singkat) tidak menjelaskan itu, jadi diterjemahkan di sini.
export const PESAN_TANPA_IZIN_KLAIM = "Akun Anda tidak punya izin memproses klaim ini. Verifikasi, minta bukti, dan tolak klaim hanya bisa dilakukan akun dengan peran Finance — minta Finance (mis. Natasha) menjalankannya.";

export function pesanGalatKlaim(e) {
  if (e?.status === 403) return PESAN_TANPA_IZIN_KLAIM;
  return e?.message || "Gagal memproses klaim. Coba lagi.";
}
