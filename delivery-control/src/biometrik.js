import * as LocalAuthentication from "expo-local-authentication";
import { statusKemampuan, tafsirHasilBiometrik } from "./lib/kunciApp";

// Pembungkus expo-local-authentication. Biometrik dipakai hanya sebagai PEMBUKA sesi lokal; tidak ada rahasia yang dibuat/disimpan di sini.
export async function kemampuanBiometrik() {
  try {
    const [adaPerangkat, terdaftar] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
    return statusKemampuan({ adaPerangkat, terdaftar });
  } catch {
    return "TANPA_PERANGKAT";
  }
}

/** Tampilkan prompt biometrik sistem. Hasil sudah ditafsirkan ({ ok, ulang, wajibMasukUlang, pesan }). */
export async function autentikasiBiometrik(pesanPrompt = "Buka Sano Delivery Control") {
  const status = await kemampuanBiometrik();
  if (status === "TANPA_PERANGKAT") return tafsirHasilBiometrik({ success: false, error: "not_available" });
  if (status === "BELUM_TERDAFTAR") return tafsirHasilBiometrik({ success: false, error: "not_enrolled" });
  try {
    const hasil = await LocalAuthentication.authenticateAsync({
      promptMessage: pesanPrompt, cancelLabel: "Batal", disableDeviceFallback: true, requireConfirmation: false,
    });
    return tafsirHasilBiometrik(hasil);
  } catch {
    return tafsirHasilBiometrik({ success: false, error: "unknown" });
  }
}
