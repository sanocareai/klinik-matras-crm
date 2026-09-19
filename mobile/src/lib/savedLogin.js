// Login sidik jari — email+password disimpan di SecureStore (Android Keystore)
// dengan requireAuthentication: membaca isinya MEMAKSA prompt biometrik OS,
// jadi tanpa sidik jari/wajah pemilik HP kredensial tidak bisa dibuka.
// Flag di AsyncStorage cuma penanda "ada yang tersimpan" supaya layar Login
// tahu kapan menampilkan tombol tanpa memicu prompt lebih dulu.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";

const KEY = "saved_login";
const FLAG = "saved_login_enabled";

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

export async function saveLogin({ email, password, server }) {
  await SecureStore.setItemAsync(KEY, JSON.stringify({ email, password, server }), {
    requireAuthentication: true,
    authenticationPrompt: "Aktifkan login sidik jari",
  });
  await AsyncStorage.setItem(FLAG, "1");
}

// Memunculkan prompt biometrik. Return null kalau dibatalkan/gagal.
export async function readSavedLogin() {
  try {
    const raw = await SecureStore.getItemAsync(KEY, {
      requireAuthentication: true,
      authenticationPrompt: "Masuk ke SANO Messenger",
    });
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearSavedLogin() {
  try { await SecureStore.deleteItemAsync(KEY); } catch {}
  try { await AsyncStorage.removeItem(FLAG); } catch {}
}
