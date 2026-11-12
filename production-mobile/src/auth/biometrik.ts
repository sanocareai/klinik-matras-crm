import * as LocalAuthentication from "expo-local-authentication";

// AUTENTIKASI PERANGKAT — sidik jari, wajah, atau kunci layar HP (PIN / pola / sandi) lewat dialog sistem Android.
// Dipakai untuk (1) MASUK CEPAT (membuka ID + kata sandi tersimpan) dan (2) KUNCI APLIKASI (opsional).
// Pola sama dengan finance-mobile/src/auth/biometric.ts, bedanya: cadangan = PIN/pola HP (bukan PIN aplikasi),
// karena HP tanpa sidik jari pun tetap bisa memakai PIN layar kunci.
// Kegagalan TIDAK pernah mengunci pengguna di luar: selalu ada jalan masuk lewat email + kata sandi.

/** tersedia = ada biometrik terdaftar; hanya_pin = cuma PIN/pola HP; tidak_ada = HP tanpa kunci layar. */
export type StatusPerangkat = "tersedia" | "hanya_pin" | "tidak_ada";
export type AlasanGagal = "dibatalkan" | "gagal" | "terkunci" | "tidak_tersedia";
export type HasilAutentikasi = { ok: true } | { ok: false; alasan: AlasanGagal; pesan: string };

export const PESAN_GAGAL: Record<AlasanGagal, string> = {
  dibatalkan: "Dibatalkan.",
  gagal: "Tidak dikenali. Coba lagi, atau masuk dengan email & kata sandi.",
  terkunci: "Terlalu banyak percobaan. Buka dengan PIN/pola HP, atau tunggu sebentar.",
  tidak_tersedia: "HP ini belum memakai kunci layar (sidik jari, wajah, atau PIN). Aktifkan dulu di Pengaturan HP → Keamanan.",
};

export type InfoPerangkat = { status: StatusPerangkat; jenis: ("sidik_jari" | "wajah" | "iris")[] };

export async function infoPerangkat(): Promise<InfoPerangkat> {
  try {
    const [level, tipe] = await Promise.all([LocalAuthentication.getEnrolledLevelAsync(), LocalAuthentication.supportedAuthenticationTypesAsync()]);
    const status: StatusPerangkat = level >= LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK ? "tersedia" : level === LocalAuthentication.SecurityLevel.SECRET ? "hanya_pin" : "tidak_ada";
    const jenis = status === "tersedia"
      ? tipe.map((t) => (t === LocalAuthentication.AuthenticationType.FINGERPRINT ? "sidik_jari" : t === LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION ? "wajah" : "iris") as InfoPerangkat["jenis"][number])
      : [];
    return { status, jenis };
  } catch {
    return { status: "tidak_ada", jenis: [] };
  }
}

/** Label tombol/teks sesuai kemampuan HP: "sidik jari", "wajah", "sidik jari / wajah", atau "PIN HP". */
export function labelMetode(info: InfoPerangkat): string {
  if (info.status === "hanya_pin") return "PIN HP";
  if (info.status === "tidak_ada") return "kunci layar HP";
  const j = info.jenis.filter((x) => x !== "iris");
  if (j.includes("sidik_jari") && j.includes("wajah")) return "sidik jari / wajah";
  if (j.includes("wajah")) return "wajah";
  return "sidik jari";
}

export function petakanGalat(error: string | undefined): AlasanGagal {
  switch (error) {
    case "user_cancel":
    case "app_cancel":
    case "system_cancel":
    case "user_fallback":
      return "dibatalkan";
    case "lockout":
      return "terkunci";
    case "not_enrolled":
    case "not_available":
    case "passcode_not_set":
    case "no_space":
      return "tidak_tersedia";
    default:
      return "gagal"; // authentication_failed, timeout, unable_to_process, unknown
  }
}

/** Dialog sistem: biometrik bila ada, dengan cadangan PIN/pola HP. */
export async function autentikasi(judul: string): Promise<HasilAutentikasi> {
  try {
    const info = await infoPerangkat();
    if (info.status === "tidak_ada") return { ok: false, alasan: "tidak_tersedia", pesan: PESAN_GAGAL.tidak_tersedia };
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: judul,
      promptSubtitle: "SANSS Produksi",
      cancelLabel: "Batal",
      disableDeviceFallback: false, // PIN/pola HP selalu boleh — HP tanpa sidik jari tetap bisa
      biometricsSecurityLevel: "weak", // wajah di banyak HP Android tergolong "weak"; tetap dilindungi kunci layar HP
    });
    if (r.success) return { ok: true };
    const alasan = petakanGalat(r.error);
    return { ok: false, alasan, pesan: PESAN_GAGAL[alasan] };
  } catch {
    return { ok: false, alasan: "tidak_tersedia", pesan: PESAN_GAGAL.tidak_tersedia };
  }
}
