// Login sidik jari — email+password disimpan di SecureStore (Android Keystore, terenkripsi,
// hanya bisa dibaca app ini). Pintu masuknya prompt biometrik OS lewat expo-local-authentication.
//
// v2 (19 Sep 2026): versi pertama memakai SecureStore { requireAuthentication: true }, yang mengikat
// kunci Keystore ke satu autentikasi per-baca. Di lapangan itu membuat pemindaian sidik jari harus
// diulang 2–3 kali sebelum masuk. Sekarang prompt biometrik dipanggil eksplisit SEKALI (dengan
// cadangan PIN/pola HP), baru kredensial dibaca. Konsekuensinya: perlindungan mengandalkan prompt
// aplikasi + enkripsi Keystore saat disimpan (bukan lagi kunci per-baca) — kompromi yang umum dipakai.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";

const KEY = "saved_login_v2";
const FLAG = "saved_login_v2_enabled";
const OLD_KEY = "saved_login"; // v1 — tidak terbaca tanpa prompt per-baca, dibersihkan saja
const OLD_FLAG = "saved_login_enabled";

// Satu prompt pada satu waktu: pemanggilan ganda (mis. auto-buka + ketuk tombol) berbagi hasil
// yang sama, bukan menumpuk dua prompt yang saling membatalkan.
let inflight = null;

export async function biometricAvailable() {
  try {
    const [hw, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hw && enrolled;
  } catch {
    return false;
  }
}

export async function hasSavedLogin() {
  try {
    return (await AsyncStorage.getItem(FLAG)) === "1";
  } catch {
    return false;
  }
}

async function konfirmasi(pesan) {
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: pesan,
    cancelLabel: "Batal",
    // Sidik jari kadang tidak terbaca (jari basah/kotor): izinkan PIN/pola HP sebagai cadangan.
    disableDeviceFallback: false,
  });
  return r.success;
}

export async function saveLogin({ email, password, server }) {
  if (!(await konfirmasi("Aktifkan login sidik jari"))) throw new Error("Dibatalkan");
  await SecureStore.setItemAsync(KEY, JSON.stringify({ email, password, server }));
  await AsyncStorage.setItem(FLAG, "1");
  try { await SecureStore.deleteItemAsync(OLD_KEY); } catch {}
  try { await AsyncStorage.removeItem(OLD_FLAG); } catch {}
}

// Memunculkan prompt biometrik. Return null kalau dibatalkan/gagal.
export function readSavedLogin() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      if (!(await konfirmasi("Masuk ke SANO Messenger"))) return null;
      const raw = await SecureStore.getItemAsync(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function clearSavedLogin() {
  for (const k of [KEY, OLD_KEY]) { try { await SecureStore.deleteItemAsync(k); } catch {} }
  for (const f of [FLAG, OLD_FLAG]) { try { await AsyncStorage.removeItem(f); } catch {} }
}
