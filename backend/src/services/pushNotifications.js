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
// Expo push (10 Sep 2026, driver-mobile RN) — REUSE PENUH prisma.pushToken
// + services/expoPush.js yang sudah ada (dipakai Sano Messenger/SLA
// alert), nol infrastruktur baru. Alias supaya tidak bentrok nama dengan
// sendPushToUser Web Push di file ini sendiri — dua channel BERBEDA
// (browser PWA vs app native), driver bisa punya salah satu atau
// dua-duanya terdaftar selama masa transisi Capacitor -> RN, kirim ke
// yang ada, BUKAN mengganti satu dengan yang lain.
import { sendPushToUser as sendExpoPushToUser } from "./expoPush.js";

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
  const title = "🚚 Job baru ditugaskan";
  const body = `${tipe} — ${nama}`;

  // Dua channel BERBEDA, kirim independen (Promise.allSettled — satu
  // gagal tidak boleh menggagalkan yang lain): Web Push utk driver yang
  // masih pakai PWA/APK Capacitor (driver-app/), Expo push utk driver
  // yang sudah pindah ke app RN (driver-mobile/). Keduanya no-op diam-diam
  // kalau user itu tidak punya subscription/token di channel tersebut.
  await Promise.allSettled([
    sendPushToUser(job.driverId, { title, body, url: "/armada/jobs" }),
    sendExpoPushToUser(job.driverId, { title, body, data: { type: "job_assigned" }, channelId: "job-updates" }),
  ]);
}

// Notifikasi "unit revisi sampai, siap dikerjakan ulang" (9 September 2026,
// D-109) — celah keterlibatan Produksi yang ditemukan di kasus Dewi
// (RES-18082026-071): sebelumnya Produksi cuma tahu ada klaim garansi/trial
// kenyamanan kalau kebetulan buka "Semua Order" dan lihat kolom Revisi,
// tidak ada dorongan aktif sama sekali. SENGAJA pakai Web Push (browser),
// BUKAN broadcast grup WhatsApp — owner baru saja minta PAUSE broadcast grup
// WA (lihat POD_BROADCAST_AKTIF di routes/armada.js, 6 September 2026,
// "matangkan dulu sistem saat ini") untuk kanal DELIVERY; ini kanal
// terpisah total (push browser per-user Produksi) jadi tidak melanggar
// permintaan pause itu, dan tidak butuh "Grup Produksi" yang memang belum
// ada infrastrukturnya sama sekali.
//
// Dipicu SAAT unit BENAR-BENAR tiba di bengkel (revisi mencapai IN_REWORK,
// auto-advance di POST /jobs/:id/complete) — BUKAN saat revisi baru
// diajukan (REQUESTED). Di titik REQUESTED unit masih di rumah customer,
// menunggu dijemput Delivery — Produksi belum bisa berbuat apa-apa, push
// saat itu cuma "noise" yang tidak actionable.
export async function notifyProductionRevisionReady(revision) {
  const unit = revision?.unit;
  if (!unit) return;
  const rows = await prisma.userRole.findMany({
    where: { role: { in: ["PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD"] } },
    select: { userId: true },
    distinct: ["userId"],
  });
  if (rows.length === 0) return; // belum ada akun ber-role Produksi — diam-diam, bukan error
  const jenis = revision.trigger === "GARANSI" ? "Klaim garansi" : "Trial kenyamanan";
  const orderNumber = unit.order?.orderNumber || "";
  await Promise.all(
    rows.map((r) =>
      sendPushToUser(r.userId, {
        title: "🔧 Unit revisi siap dikerjakan",
        body: `${jenis} — ${unit.unitCode}${orderNumber ? ` (${orderNumber})` : ""}`,
        url: "/bengkel/orders",
      })
    )
  );
}

// Notifikasi "pengambilan/pengiriman customer Anda GAGAL" ke SALES pemilik
// order (9 September 2026, D-110) — celah berbentuk sama dengan yang baru
// diperbaiki untuk Produksi di atas: sebelum ini, sales cuma bisa tahu job
// customer-nya GAGAL kalau kebetulan buka "Semua Order" dan lihat badge
// merah "Gagal" — tidak ada dorongan aktif sama sekali, padahal ini
// biasanya butuh sales/CS menelepon customer secepatnya untuk menjelaskan
// & menyepakati jadwal baru.
//
// Query customer TERPISAH di sini (bukan mengandalkan `job.order` dari
// jobInclude yang dipakai pemanggil) — jobInclude dipakai luas di seluruh
// armada.js, tidak perlu diperlebar cuma untuk satu notifikasi best-effort
// ini. `job` minimal butuh { id, orderId, type, failureReason }.
export async function notifySalesJobFailed(job) {
  if (!job?.orderId) return;
  const order = await prisma.order.findUnique({
    where: { id: job.orderId },
    select: {
      orderNumber: true,
      customer: { select: { id: true, name: true, assignedSalesId: true } },
    },
  });
  const salesId = order?.customer?.assignedSalesId;
  if (!salesId) return; // order belum punya sales pemilik — diam-diam, bukan error
  const tipe = job.type === "PICKUP" ? "Pengambilan" : "Pengiriman";
  await sendPushToUser(salesId, {
    title: `❌ ${tipe} gagal`,
    body: `${order.customer.name || "Customer"}${order.orderNumber ? ` (${order.orderNumber})` : ""} — ${job.failureReason || "tanpa alasan tercatat"}`,
    url: `/customers?id=${order.customer.id}`,
  });
}
