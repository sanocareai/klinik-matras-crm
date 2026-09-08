// Web Push (8 September 2026) — permintaan owner: driver dapat notifikasi
// begitu ditugaskan job baru, referensi Lalamove/Gojek. TETAP PWA (bukan app
// native/Play Store) — push notification browser standar (Push API + Web
// Push Protocol via VAPID), bukan Firebase Cloud Messaging atau semacamnya
// (tidak ada dependency native/akun Google Cloud tambahan yang dibutuhkan).
//
// SATU sumber kebenaran untuk kirim push — dipanggil best-effort (try/catch
// oleh pemanggil, TIDAK PERNAH menggagalkan aksi utama) dari SETIAP titik
// yang men-set Job.driverId, sama pola dengan notifyDriverGroup/
// notifyDriverEnRoute (services/customerNotifications.js) untuk WA.
import webpush from "web-push";
import { prisma } from "../db.js";

function vapidConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

if (vapidConfigured()) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL || "admin@klinikmatras.com"}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Kirim push ke SEMUA device/browser milik satu user (bisa lebih dari satu —
// lihat catatan model PushSubscription). Gagal per-subscription TIDAK
// menghentikan yang lain (satu HP driver mati/uninstall tidak boleh
// menggagalkan notifikasi ke device lain). Subscription yang browsernya
// balas 404/410 (artinya benar-benar sudah unsubscribe/uninstall, BUKAN
// error jaringan sementara) dihapus dari database — jaring bersih otomatis,
// tidak perlu job pembersihan terpisah.
export async function sendPushToUser(userId, { title, body, url }) {
  if (!vapidConfigured()) return; // env belum diisi — no-op diam-diam, bukan error
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return;

  const payload = JSON.stringify({ title, body, url: url || "/" });
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error("[pushNotifications] Gagal kirim ke satu subscription:", err.message);
        }
      }
    })
  );
}

// Notifikasi "job baru ditugaskan" — dipanggil dari SEMUA titik yang men-set
// Job.driverId (publish rute, edit darurat, reassign single job). `job` di
// sini minimal butuh { driverId, type, order/units[].unit.order } supaya
// bisa menyusun nama customer — pola fallback SAMA dengan customerOf() di
// jobStatus.js (frontend), diduplikasi ringkas di sini karena butuh dari
// data mentah Prisma (bukan hasil jobInclude yang sudah di-shape frontend).
export async function notifyDriverJobAssigned(job) {
  if (!job?.driverId) return;
  const order = job.order || job.units?.[0]?.unit?.order;
  const nama = order?.customer?.name || "Customer";
  const tipe = job.type === "PICKUP" ? "Pengambilan" : "Pengiriman";
  await sendPushToUser(job.driverId, {
    title: "🚚 Job baru ditugaskan",
    body: `${tipe} — ${nama}`,
    url: "/armada/jobs",
  });
}
