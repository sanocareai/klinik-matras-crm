import * as LocalAuthentication from "expo-local-authentication";

// BIOMETRIK — opsional. PIN selalu tersedia sebagai cadangan; kegagalan biometrik TIDAK pernah
// mengunci pengguna di luar aplikasi. Semua pesan Bahasa Indonesia.

export type BiometricStatus = "tersedia" | "tidak_ada_perangkat" | "belum_terdaftar";

export type BiometricReason = "dibatalkan" | "gagal" | "terkunci" | "tidak_tersedia" | "belum_terdaftar";
export type BiometricResult = { ok: true } | { ok: false; reason: BiometricReason; pesan: string };

export const PESAN_BIOMETRIK: Record<BiometricReason, string> = {
  dibatalkan: "Dibatalkan. Anda bisa memakai PIN.",
  gagal: "Sidik jari atau wajah tidak dikenali. Coba lagi atau pakai PIN.",
  terkunci: "Biometrik terkunci sementara karena terlalu banyak percobaan. Pakai PIN dulu.",
  tidak_tersedia: "Biometrik tidak bisa dipakai di perangkat ini. Pakai PIN.",
  belum_terdaftar: "Belum ada sidik jari atau wajah yang terdaftar di HP ini. Daftarkan dulu di Pengaturan HP.",
};

export async function statusBiometrik(): Promise<BiometricStatus> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync())) return "tidak_ada_perangkat";
    if (!(await LocalAuthentication.isEnrolledAsync())) return "belum_terdaftar";
    return "tersedia";
  } catch {
    return "tidak_ada_perangkat";
  }
}

function petakan(error: string | undefined): BiometricReason {
  switch (error) {
    case "user_cancel":
    case "app_cancel":
    case "system_cancel":
    case "user_fallback":
      return "dibatalkan";
    case "lockout":
      return "terkunci";
    case "not_enrolled":
      return "belum_terdaftar";
    case "not_available":
    case "passcode_not_set":
    case "no_space":
      return "tidak_tersedia";
    default:
      return "gagal"; // authentication_failed, timeout, unknown
  }
}

export async function autentikasiBiometrik(alasan: string): Promise<BiometricResult> {
  try {
    const status = await statusBiometrik();
    if (status === "tidak_ada_perangkat") return { ok: false, reason: "tidak_tersedia", pesan: PESAN_BIOMETRIK.tidak_tersedia };
    if (status === "belum_terdaftar") return { ok: false, reason: "belum_terdaftar", pesan: PESAN_BIOMETRIK.belum_terdaftar };
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: alasan,
      cancelLabel: "Pakai PIN",
      // Tanpa cadangan PIN/pola HP: cadangan kita adalah PIN aplikasi sendiri.
      disableDeviceFallback: true,
      biometricsSecurityLevel: "strong",
    });
    if (r.success) return { ok: true };
    const reason = petakan((r as { error?: string }).error);
    return { ok: false, reason, pesan: PESAN_BIOMETRIK[reason] };
  } catch {
    return { ok: false, reason: "tidak_tersedia", pesan: PESAN_BIOMETRIK.tidak_tersedia };
  }
}
