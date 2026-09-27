// Logika murni kunci aplikasi/biometrik (tanpa React Native) — dapat diuji di Node.
// Prinsip: biometrik HANYA membuka sesi lokal yang sudah dibuat lewat login normal. Tidak ada kata sandi/PIN yang disimpan,
// dan setiap pembukaan kunci setelah aplikasi ditutup tetap divalidasi ke server (GET /delivery-control/session).

/** Perlu dikunci ulang setelah aplikasi ditinggal (latar belakang) >= batas auto-lock? */
export function perluKunci({ biometrikAktif, adaSesi, ditinggalMs, now = Date.now(), menit }) {
  if (!biometrikAktif || !adaSesi || ditinggalMs == null) return false;
  return now - ditinggalMs >= Number(menit) * 60_000;
}

/** Kemampuan perangkat: SIAP | TANPA_PERANGKAT (tak ada sensor) | BELUM_TERDAFTAR (belum ada sidik jari/wajah). */
export function statusKemampuan({ adaPerangkat, terdaftar }) {
  if (!adaPerangkat) return "TANPA_PERANGKAT";
  if (!terdaftar) return "BELUM_TERDAFTAR";
  return "SIAP";
}

export const PESAN_KEMAMPUAN = {
  SIAP: "",
  TANPA_PERANGKAT: "Perangkat ini tidak memiliki sensor biometrik.",
  BELUM_TERDAFTAR: "Belum ada sidik jari/wajah yang terdaftar di HP. Daftarkan dulu di pengaturan HP.",
};

/**
 * Terjemahkan hasil expo-local-authentication ({ success, error }) menjadi keputusan UI:
 *  - ok: berhasil
 *  - ulang: pengguna boleh mencoba lagi (batal/gagal cocok)
 *  - wajibMasukUlang: biometrik tidak lagi bisa dipakai (dicabut/tidak terdaftar/terkunci permanen) -> matikan biometrik & minta login normal
 */
export function tafsirHasilBiometrik(hasil) {
  if (hasil?.success) return { ok: true, ulang: false, wajibMasukUlang: false, pesan: "" };
  const kode = hasil?.error || "unknown";
  const FATAL = {
    not_enrolled: "Biometrik di HP ini sudah tidak terdaftar atau berubah. Masuk dengan kata sandi lalu aktifkan ulang biometrik.",
    not_available: "Biometrik tidak tersedia di HP ini. Masuk dengan kata sandi.",
    passcode_not_set: "Kunci layar HP belum diatur. Masuk dengan kata sandi.",
    lockout_permanent: "Biometrik terkunci permanen. Masuk dengan kata sandi.",
  };
  if (FATAL[kode]) return { ok: false, ulang: false, wajibMasukUlang: true, pesan: FATAL[kode] };
  if (kode === "lockout") return { ok: false, ulang: true, wajibMasukUlang: false, pesan: "Terlalu banyak percobaan. Tunggu sebentar atau masuk dengan kata sandi." };
  if (["user_cancel", "system_cancel", "app_cancel", "user_fallback"].includes(kode)) return { ok: false, ulang: true, wajibMasukUlang: false, pesan: "" };
  if (kode === "authentication_failed") return { ok: false, ulang: true, wajibMasukUlang: false, pesan: "Biometrik tidak cocok. Coba lagi." };
  return { ok: false, ulang: true, wajibMasukUlang: false, pesan: "Biometrik tidak dapat dipakai saat ini. Coba lagi atau masuk dengan kata sandi." };
}
