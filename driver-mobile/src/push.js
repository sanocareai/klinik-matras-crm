// Registrasi push notification (Expo Notifications + FCM) — pola SAMA
// dengan mobile/src/push.js (Sano Messenger), disederhanakan (tidak ada
// conversationStore/notificationBannerStore, driver app tidak punya chat).
// Backend REUSE PENUH: services/expoPush.js + prisma.pushToken, endpoint
// /users/me/push-token — SAMA yang sudah dipakai Sano Messenger, jadi
// notifyDriverJobAssigned() (services/pushNotifications.js) cukup DIPERLUAS
// utk juga kirim lewat jalur ini, BUKAN membangun ulang dari nol.
//
// CATATAN (sama dgn mobile/): push TIDAK jalan di Expo Go sejak SDK 53 —
// hanya di APK hasil build (EAS). Deteksi ini SEBELUM import statis
// expo-notifications supaya modulnya tidak ikut dievaluasi (dan error) saat
// masih di Expo Go.
import * as Device from "expo-device";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";

export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let lastRegisteredUser = null;

let Notifications = null;
if (!isExpoGo) {
  Notifications = require("expo-notifications");

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  // Native push token BISA berubah sendiri oleh OS (jarang) — kalau
  // terjadi, Expo Push Token turunannya (yang disimpan ke backend) juga
  // ikut berubah. Daftar ulang otomatis tanpa perlu user login ulang.
  Notifications.addPushTokenListener(() => {
    if (lastRegisteredUser) registerForPush(lastRegisteredUser).catch(() => {});
  });
}

// SATU channel Android — "job-updates": job baru ditugaskan / status
// berubah. Importance HIGH (bukan MAX seperti chat Messenger) — penting
// tapi bukan hal yang butuh interupsi maksimal seperti pesan WA masuk.
async function ensureChannels() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("job-updates", {
    name: "Update Job",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#2D64B6",
  });
}

export async function registerForPush(user) {
  if (isExpoGo) return null;
  try {
    if (!Device.isDevice) return null;
    if (user) lastRegisteredUser = user;

    await ensureChannels();

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return null;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    await api.savePushToken(token, { userId: lastRegisteredUser?.id, platform: Platform.OS });
    await AsyncStorage.setItem("pushToken", token);
    return token;
  } catch (err) {
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
  lastRegisteredUser = null;
}
