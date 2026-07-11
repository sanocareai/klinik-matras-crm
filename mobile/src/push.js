// Registrasi push notification (Expo Notifications + FCM).
// Dipanggil setelah login sukses / restore sesi. Token dikirim ke backend
// supaya server bisa push saat ada pesan WhatsApp masuk.
// CATATAN: push TIDAK jalan di Expo Go — hanya di APK hasil build (EAS).
import * as Device from "expo-device";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";
import { useConversationStore } from "./store/conversationStore";
import { useNotificationBannerStore } from "./store/notificationBannerStore";

// Sejak SDK 53, Expo Go sama sekali tidak mendukung push notification (dihapus
// oleh tim Expo) — modul expo-notifications akan lempar error kalau dipakai
// di Expo Go. Deteksi ini di awal supaya SEMUA pemakaian expo-notifications
// (termasuk import & setNotificationHandler) di-skip saat masih di Expo Go.
// Push baru aktif betulan di APK hasil `eas build`.
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Simpan user terakhir yang berhasil registerForPush(user) — dipakai
// addPushTokenListener di bawah untuk registrasi ULANG kalau native push
// token berubah sendiri di tengah sesi (jarang tapi bisa terjadi, lihat
// docs addPushTokenListener), tanpa perlu user login ulang.
let lastRegisteredUser = null;

// Import dinamis — jangan import statis expo-notifications di file ini,
// supaya modulnya tidak ikut dievaluasi (dan error) saat masih di Expo Go.
let Notifications = null;
if (!isExpoGo) {
  Notifications = require("expo-notifications");

  // Saat app foreground: JANGAN pakai banner sistem sama sekali — dipakai
  // <InAppBanner/> custom sendiri (lihat addNotificationReceivedListener di
  // bawah) supaya konsisten gaya di semua device/launcher & bisa di-tap utk
  // langsung buka chat. Kalau user KEBETULAN sedang buka chat yang SAMA
  // dengan notifikasi ini, jangan tampilkan apa-apa sama sekali (pesan itu
  // sudah otomatis muncul live di chat lewat Socket.IO — lihat
  // useSocketEvents.js — banner/suara jadi berlebihan & mengganggu).
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const conversationId = notification.request.content.data?.conversationId;
      const activeId = useConversationStore.getState().activeConversationId;
      const sameChatOpen = !!conversationId && conversationId === activeId;
      return {
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: !sameChatOpen,
        shouldSetBadge: true,
      };
    },
  });

  // Notifikasi diterima selagi app foreground (JS masih hidup) → tampilkan
  // banner custom kecil, KECUALI utk chat yang sedang dibuka user saat ini
  // (alasan sama seperti handleNotification di atas).
  Notifications.addNotificationReceivedListener((notification) => {
    const data = notification.request.content.data || {};
    const activeId = useConversationStore.getState().activeConversationId;
    if (data.conversationId && data.conversationId === activeId) return;
    useNotificationBannerStore.getState().show({
      title: notification.request.content.title || "Pesan baru",
      body: notification.request.content.body || "",
      conversationId: data.conversationId || null,
      customerId: data.customerId || null,
      isGroup: !!data.isGroup,
    });
  });

  // Device push token (token FCM asli) BISA berubah sendiri oleh OS meski
  // jarang terjadi — saat itu terjadi, Expo Push Token turunannya (yang
  // kita simpan ke backend) juga ikut berubah. Listener ini menerima native
  // token yang BARU (bukan Expo Push Token-nya langsung, lihat docs), jadi
  // yang dilakukan adalah panggil ulang registerForPush() supaya ambil Expo
  // Push Token yang sudah fresh & simpan ulang ke backend — tanpa user perlu
  // login ulang.
  Notifications.addPushTokenListener(() => {
    if (lastRegisteredUser) registerForPush(lastRegisteredUser).catch(() => {});
  });
}

// 2 channel Android (lihat spec M-push):
// - "messages": pesan WA baru masuk — importance MAX, suara + getar
// - "assignments": takeover/transfer percakapan — importance HIGH
// Channel LAMA "pesan-masuk" TETAP dibuat (jangan dihapus) — backend
// (backend/src/services/expoPush.js) MASIH hardcode channelId "pesan-masuk"
// utk semua push, belum dimigrasi ke "messages"/"assignments" & belum ada
// push terpisah utk event takeover/assignment sama sekali (dicatat sebagai
// task backend, lihat ringkasan tugas). Kalau channel ini dihapus dari sini
// duluan, notifikasi existing kehilangan importance/suara custom-nya
// (fallback ke channel default Android yang polos).
async function ensureChannels() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("pesan-masuk", {
    name: "Pesan Masuk (lama)",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#25D366",
  });
  await Notifications.setNotificationChannelAsync("messages", {
    name: "Pesan Masuk",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#25D366",
  });
  await Notifications.setNotificationChannelAsync("assignments", {
    name: "Ambil Alih / Transfer Percakapan",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    lightColor: "#2563EB",
  });
}

// user: { id, ... } — dipakai isi field userId saat register token & disimpan
// utk re-register otomatis kalau native token berubah (lihat addPushTokenListener
// di atas). Dipanggil dari AuthContext saat login sukses & restore sesi.
export async function registerForPush(user) {
  if (isExpoGo) return null; // lihat catatan isExpoGo di atas
  try {
    if (!Device.isDevice) return null; // emulator tanpa Google Play tidak bisa
    if (user) lastRegisteredUser = user;

    await ensureChannels();

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

    // userId sebenarnya sudah otomatis ke-scope dari JWT di endpoint backend
    // (req.user.id) — tetap disertakan eksplisit di body sesuai spec, dan
    // platform utk pembedaan di masa depan (backend saat ini belum
    // menyimpan/pakai field ini — lihat ringkasan tugas).
    await api.savePushToken(token, { userId: lastRegisteredUser?.id, platform: Platform.OS });
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
  lastRegisteredUser = null;
}

// Badge angka di ikon app — dipanggil dari useBadgeSync.js (data unread
// berubah / app resume dari background). Android: tidak semua launcher
// dukung badge, setBadgeCountAsync balikin false diam-diam kalau tidak
// didukung — bukan error, aman diabaikan.
export async function updateBadgeCount(count) {
  if (isExpoGo) return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count || 0));
  } catch {}
}

// Cek apakah app di-COLD-START lewat tap notifikasi (app benar-benar
// killed sebelumnya, bukan cuma di-background). Dipanggil sekali saat
// App.js mount — addNotificationResponseReceivedListener SAJA kadang
// melewatkan response yang justru me-launch app dari kondisi killed,
// karena listener itu baru terpasang SETELAH app selesai boot (miss
// timing), sedangkan getLastNotificationResponseAsync() menyimpan
// response terakhir di native side terlepas dari kapan listener JS
// dipasang.
export async function getLaunchNotificationResponse() {
  if (isExpoGo) return null;
  try {
    return await Notifications.getLastNotificationResponseAsync();
  } catch {
    return null;
  }
}
