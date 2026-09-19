import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { api } from "./session";
import { getDeviceId } from "./storage";
import { ENV } from "@/lib/env";

// PUSH — token Expo Push didaftarkan ke backend (POST /api/mobile/devices, provider "expo").
// Server mengirim hanya bila FINANCE_PUSH_ENABLED=true; isi push tanpa nominal (PRD §9.1).
// Gagal mendaftar (mis. google-services.json belum ada, izin ditolak) TIDAK boleh mengganggu aplikasi.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

export async function siapkanChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("approval", {
    name: "Persetujuan", importance: Notifications.AndroidImportance.HIGH, lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  await Notifications.setNotificationChannelAsync("pembayaran", { name: "Pembayaran", importance: Notifications.AndroidImportance.DEFAULT });
  await Notifications.setNotificationChannelAsync("pengingat", { name: "Pengingat", importance: Notifications.AndroidImportance.LOW });
}

export async function daftarkanPush(): Promise<"ok" | "dilewati" | "gagal"> {
  if (ENV.useMocks || !Device.isDevice) return "dilewati";
  try {
    await siapkanChannel();
    const izin = await Notifications.getPermissionsAsync();
    let status = izin.status;
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return "dilewati";

    const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return "dilewati"; // belum `eas init` (lihat README)

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api.command("POST", "/mobile/devices", randomUUID(), {
      body: { deviceId: await getDeviceId(), token, provider: "expo", platform: "android", appVersion: ENV.version },
    });
    return "ok";
  } catch {
    return "gagal";
  }
}
