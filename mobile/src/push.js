// Registrasi push notification (Expo Notifications + FCM).
// Dipanggil setelah login sukses. Token dikirim ke backend supaya server
// bisa push saat ada pesan WhatsApp masuk.
// CATATAN: push TIDAK jalan di Expo Go — hanya di APK hasil build (EAS).
import * as Device from "expo-device";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";

// Sejak SDK 53, Expo Go sama sekali tidak mendukung push notification (dihapus
// oleh tim Expo) — modul expo-notifications akan lempar error kalau dipakai
// di Expo Go. Deteksi ini di awal supaya SEMUA pemakaian expo-notifications
// (termasuk import & setNotificationHandler) di-skip saat masih di Expo Go.
// Push baru aktif betulan di APK hasil `eas build`.
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Import dinamis — jangan import statis expo-notifications di file ini,
// supaya modulnya tidak ikut dievaluasi (dan error) saat masih di Expo Go.
let Notifications = null;
if (!isExpoGo) {
  Notifications = require("expo-notifications");
  // Saat app sedang dibuka: tetap tampilkan banner + bunyi
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export async function registerForPush() {
  if (isExpoGo) return null; // lihat catatan isExpoGo di atas
  try {
    if (!Device.isDevice) return null; // emulator tanpa Google Play tidak bisa

    // Channel Android — harus sama dengan channelId yang dikirim backend
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("pesan-masuk", {
        name: "Pesan Masuk",
        importance: Notifications.AndroidImportance.MAX,
        sound: "default",
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#25D366",
      });
    }

    // Minta izin notifikasi (Android 13+ wajib runtime permission)
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return null;

    // projectId EAS diperlukan untuk ambil Expo Push Token
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    await api.savePushToken(token);
    await AsyncStorage.setItem("pushToken", token); // untuk dihapus saat logout
    return token;
  } catch (err) {
    // Push gagal (misal jalan di Expo Go) — jangan ganggu pemakaian app
    console.warn("Registrasi push gagal:", err.message);
    return null;
  }
}

export async function unregisterPush() {
  try {
    const token = await AsyncStorage.getItem("pushToken");
    if (token) {
      await api.deletePushToken(token);
      await AsyncStorage.removeItem("pushToken");
    }
  } catch {}
}
