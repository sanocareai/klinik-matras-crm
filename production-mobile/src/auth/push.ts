import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { api } from "./session";
import { getDeviceId } from "./storage";
import { ENV } from "@/lib/env";
import { log } from "@/lib/log";
import { ruteDariNotifikasi } from "@/lib/tautan";

// PUSH SANSS Produksi — MATI kecuali EXPO_PUBLIC_PUSH_ENABLED=true saat build (butuh projectId EAS + kredensial FCM di Expo).
// Saat mati: tidak ada izin diminta, tidak ada token, tidak ada listener.
// Bila hidup:
//   • Izin diminta HANYA lewat tombol di tab Akun (tindakan pengguna), tidak saat startup.
//   • Saat masuk/kembali ke aplikasi, bila izin SUDAH ada, token disegarkan diam-diam (POST /mobile/devices).
//     Server menandai token ini app="production" dari klaim token akses — notifikasi Finance tidak pernah sampai ke sini.
//   • Ketuk notifikasi → `data.path` divalidasi daftar putih (lib/tautan.ts) lalu dibuka.

export const pushTersedia = (): boolean => ENV.pushEnabled && Device.isDevice;

let handlerTerpasang = false;
function pasangHandler() {
  if (handlerTerpasang) return;
  handlerTerpasang = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

async function siapkanChannel() {
  if (Platform.OS !== "android") return;
  // Kanal sama dengan channelId yang dikirim server (services/productionNotifications.js).
  await Notifications.setNotificationChannelAsync("tugas", { name: "Tugas masuk", importance: Notifications.AndroidImportance.HIGH });
  await Notifications.setNotificationChannelAsync("penting", { name: "Rework & urgent", importance: Notifications.AndroidImportance.MAX });
}

export type StatusIzin = "granted" | "denied" | "undetermined" | "tidak_tersedia";

export async function statusIzin(): Promise<StatusIzin> {
  if (!pushTersedia()) return "tidak_tersedia";
  try {
    const s = (await Notifications.getPermissionsAsync()).status;
    return s === "granted" ? "granted" : s === "denied" ? "denied" : "undetermined";
  } catch { return "tidak_tersedia"; }
}

async function daftarkanToken(): Promise<"ok" | "dilewati" | "gagal"> {
  try {
    await siapkanChannel();
    const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return "dilewati";
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api.command("POST", "/mobile/devices", randomUUID(), {
      body: { deviceId: await getDeviceId(), token, provider: "expo", platform: "android", appVersion: ENV.version },
    });
    return "ok";
  } catch {
    log.warn("daftar token push gagal");
    return "gagal";
  }
}

/** Diam-diam saat masuk/kembali ke aplikasi — hanya bila izin SUDAH ada. Tidak pernah memunculkan dialog. */
export async function segarkanTokenPush(): Promise<"ok" | "dilewati" | "gagal"> {
  if (!pushTersedia()) return "dilewati";
  pasangHandler();
  if ((await statusIzin()) !== "granted") return "dilewati";
  return daftarkanToken();
}

/** Dari tab Akun (tindakan pengguna): minta izin lalu daftarkan token. */
export async function aktifkanNotifikasi(): Promise<"ok" | "ditolak" | "dilewati" | "gagal"> {
  if (!pushTersedia()) return "dilewati";
  pasangHandler();
  try {
    let s = (await Notifications.getPermissionsAsync()).status;
    if (s !== "granted") s = (await Notifications.requestPermissionsAsync()).status;
    if (s !== "granted") return "ditolak";
    return await daftarkanToken();
  } catch { return "gagal"; }
}

/** Ketukan notifikasi → panggil `buka(rute)` dengan rute yang sudah divalidasi. Mengembalikan fungsi pelepas listener. */
export function pasangPendengarTautan(buka: (rute: string) => void): () => void {
  if (!pushTersedia()) return () => undefined;
  pasangHandler();
  const proses = (r: Notifications.NotificationResponse | null) => {
    const rute = r ? ruteDariNotifikasi(r.notification.request.content.data) : null;
    if (rute) buka(rute);
  };
  try { proses(Notifications.getLastNotificationResponse()); } catch { /* abaikan */ }
  const sub = Notifications.addNotificationResponseReceivedListener(proses);
  return () => sub.remove();
}
