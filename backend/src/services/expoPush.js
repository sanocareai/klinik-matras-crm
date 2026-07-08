// Kirim push notification ke aplikasi mobile (Android) via Expo Push API.
// Tidak butuh kredensial di server — cukup Expo Push Token milik tiap device
// (FCM dikonfigurasi di sisi build aplikasi lewat google-services.json).
import { prisma } from "../db.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Kirim notifikasi ke SEMUA device yang terdaftar (semua user).
// Fire-and-forget: kegagalan push tidak boleh mengganggu alur webhook.
export async function sendPushToAllUsers({ title, body, data = {} }) {
  let tokens;
  try {
    tokens = await prisma.pushToken.findMany();
  } catch (err) {
    // Tabel belum ada (migration belum jalan) — jangan bikin webhook error
    console.warn("[push] Lewati, tabel PushToken belum siap:", err.message);
    return;
  }
  if (!tokens.length) return;

  // Expo membatasi 100 pesan per request
  for (let i = 0; i < tokens.length; i += 100) {
    const chunk = tokens.slice(i, i + 100);
    const messages = chunk.map((t) => ({
      to: t.token,
      title,
      body,
      data,
      sound: "default",
      channelId: "pesan-masuk", // channel Android, dibuat oleh aplikasi mobile
    }));

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(messages),
      });
      const json = await res.json();

      // Bersihkan token yang sudah tidak valid (app di-uninstall, dll)
      const tickets = json.data || [];
      for (let j = 0; j < tickets.length; j++) {
        if (tickets[j]?.status === "error" &&
            tickets[j]?.details?.error === "DeviceNotRegistered") {
          await prisma.pushToken
            .delete({ where: { token: chunk[j].token } })
            .catch(() => {});
        }
      }
    } catch (err) {
      console.warn("[push] Gagal kirim batch:", err.message);
    }
  }
}
