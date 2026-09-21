import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { api } from "./session";
import { getDeviceId } from "./storage";
import { ENV } from "@/lib/env";
import { log } from "@/lib/log";
import { petaTautan, tundaTautan } from "@/lib/tautan";

// PUSH (S11) — DIMATIKAN secara default (flag EXPO_PUBLIC_PUSH_ENABLED). Selama flag mati: tidak ada izin yang diminta, tidak ada token yang didaftarkan,
// tidak ada listener — aplikasi berjalan persis seperti tanpa fitur ini.
//
// Bila flag hidup:
//   • Izin notifikasi TIDAK diminta saat startup. Hanya diminta lewat `aktifkanNotifikasi()` (dari layar Notifikasi, oleh pengguna).
//   • Di setiap masuk/kembali ke aplikasi, bila izin SUDAH diberikan, token disegarkan diam-diam (menangani rotasi token & pemasangan ulang).
//   • Token didaftarkan ke server per pengguna+perangkat (POST /mobile/devices). Keluar akun mencabutnya di server (sesi dicabut ⇒ token dihapus).
//   • Isi notifikasi tanpa nominal/nama; kanal Android memakai lockscreenVisibility PRIVATE. Ketukan notifikasi → `path` divalidasi daftar putih (lib/tautan.ts).
// Kegagalan apa pun (google-services.json belum ada, izin ditolak, jaringan) TIDAK boleh mengganggu aplikasi.

export const pushTersedia = (): boolean => ENV.pushEnabled && Device.isDevice;

let handlerTerpasang = false;
function pasangHandler() {
  if (handlerTerpasang) return;
  handlerTerpasang = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export async function siapkanChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  const PRIVAT = Notifications.AndroidNotificationVisibility.PRIVATE;
  await Notifications.setNotificationChannelAsync("approval", { name: "Persetujuan", importance: Notifications.AndroidImportance.HIGH, lockscreenVisibility: PRIVAT });
  await Notifications.setNotificationChannelAsync("sensitif", { name: "Transaksi sensitif", importance: Notifications.AndroidImportance.HIGH, lockscreenVisibility: PRIVAT });
  await Notifications.setNotificationChannelAsync("pembayaran", { name: "Pembayaran", importance: Notifications.AndroidImportance.DEFAULT, lockscreenVisibility: PRIVAT });
  await Notifications.setNotificationChannelAsync("pengingat", { name: "Pengingat jatuh tempo", importance: Notifications.AndroidImportance.LOW, lockscreenVisibility: PRIVAT });
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
  if (ENV.useMocks) return "ok"; // server contoh: tidak ada jaringan
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

/** Panggilan diam-diam saat masuk/kembali ke aplikasi: hanya jika izin SUDAH ada. Tidak pernah memunculkan dialog izin. */
export async function segarkanTokenPush(): Promise<"ok" | "dilewati" | "gagal"> {
  if (!pushTersedia()) return "dilewati";
  pasangHandler();
  if ((await statusIzin()) !== "granted") return "dilewati";
  return daftarkanToken();
}

/** Dari layar Notifikasi (tindakan pengguna): minta izin secara kontekstual lalu daftarkan token. */
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

/** Ketukan pada notifikasi (aplikasi di background/tertutup) → simpan tautan tervalidasi; layout membukanya setelah login & kunci terbuka. */
export function pasangPendengarTautan(): () => void {
  if (!pushTersedia()) return () => undefined;
  pasangHandler();
  const proses = (r: Notifications.NotificationResponse | null) => {
    if (!r) return;
    const rute = petaTautan(r.notification.request.content.data);
    if (rute) tundaTautan(rute);
  };
  try { proses(Notifications.getLastNotificationResponse()); } catch { /* abaikan */ }
  const sub = Notifications.addNotificationResponseReceivedListener(proses);
  return () => sub.remove();
}
