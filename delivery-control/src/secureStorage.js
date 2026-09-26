import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

// Penyimpanan untuk klien API: TOKEN sesi disimpan terenkripsi (Android Keystore lewat expo-secure-store), bukan di AsyncStorage
// polos. Kunci lain (cache profil sesi, draf) tetap di AsyncStorage. Kata sandi/PIN TIDAK pernah disimpan.
const KUNCI_TOKEN = "control:token";
const KUNCI_AMAN = "control.token"; // SecureStore hanya menerima [A-Za-z0-9._-]
const OPSI = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const storageAman = {
  async getItem(kunci) {
    if (kunci !== KUNCI_TOKEN) return AsyncStorage.getItem(kunci);
    try {
      const v = await SecureStore.getItemAsync(KUNCI_AMAN, OPSI);
      if (v) return v;
    } catch { /* jatuh ke migrasi di bawah */ }
    // Migrasi token lama (APK sebelumnya menyimpannya di AsyncStorage): pindahkan lalu hapus salinan polos.
    const lama = await AsyncStorage.getItem(kunci);
    if (lama) {
      try { await SecureStore.setItemAsync(KUNCI_AMAN, lama, OPSI); await AsyncStorage.removeItem(kunci); } catch { /* biarkan */ }
    }
    return lama;
  },
  async setItem(kunci, nilai) {
    if (kunci !== KUNCI_TOKEN) return AsyncStorage.setItem(kunci, nilai);
    await SecureStore.setItemAsync(KUNCI_AMAN, nilai, OPSI);
    await AsyncStorage.removeItem(kunci);
  },
  async removeItem(kunci) {
    if (kunci !== KUNCI_TOKEN) return AsyncStorage.removeItem(kunci);
    try { await SecureStore.deleteItemAsync(KUNCI_AMAN, OPSI); } catch { /* sudah tidak ada */ }
    await AsyncStorage.removeItem(kunci);
  },
};
