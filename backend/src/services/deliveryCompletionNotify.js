// ─── NOTIFIKASI JOB SELESAI — WA ke sales pemilik order (9 September 2026) ─
//
// Permintaan owner: "beri notifikasi ke tim sales masing-masing ketika ada
// orderan mereka yang sudah masuk status pengiriman/pengambilan berhasil
// dari tim delivery, lewat delivery workspace (admin delivery update +
// upload bukti)". Dipicu dari POST /armada/jobs/:id/complete begitu tim
// delivery menandai job SELESAI (bukti foto sudah wajib diunggah di titik
// itu, lihat routes/armada.js).
//
// BEDA dari notifySalesJobFailed (services/pushNotifications.js, D-110,
// 9 Sep 2026) yang pakai WEB PUSH untuk kegagalan job — ini WhatsApp,
// SATU pesan REAL-TIME per job selesai (bukan digest terjadwal seperti
// salesReminderDigestJob.js). Dicatat juga sebagai
// StaffBroadcast(kind=AUTO_REMINDER, topic="jobCompleted") supaya muncul
// di tab Riwayat Broadcast Sales bersama broadcast otomatis lain — tabel
// & pola yang sama, tidak ada state kedua.
//
// STAGED UNTUK REVIEW: enabled:false by default (config SENDIRI,
// data/settings.json#jobCompletedNotify — TERPISAH dari
// salesReminderDigest.enabled), pola SAMA dgn semua job WA otomatis lain
// di project ini — aman di-deploy, tidak pernah kirim WA sampai owner
// eksplisit menyalakan.
//
// FILE INI JUGA memicu poin 7 salesReminderDigestJob.js ("Terkirim Belum
// Lunas") — DIKOREKSI 9 Sep 2026, masih hari yang sama dibuat: AWALNYA
// topik itu cron terjadwal jam 10:00 WIB tersendiri, TAPI owner minta
// diubah jadi real-time juga: "gaperlu jadwal jam, jadi selalu kirim
// info/broadcast ketika dari tim delivery update". Jadi begitu job selesai
// menyebabkan Order.status jadi DELIVERED (weakest-link dari SEMUA unit
// order itu, lihat orderStatusSync.js — bisa saja job PICKUP/revisi yang
// baru memicu, bukan cuma DELIVERY biasa) DAN paymentStatus belum LUNAS,
// notifySalesUnpaidAfterDelivery() di bawah kirim WA TERPISAH (pesan &
// topic StaffBroadcast BEDA dari "job selesai" di atas — konsisten dgn
// prinsip "1 topik = 1 pesan pendek" yang jadi alasan salesReminderDigestJob
// dipecah per topik 7 Sep 2026, bukan digabung).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { sendText, getDefaultOpsSession } from "./wahaClient.js";
import { readSalesPhoneDirectory, resolveSalesPhone } from "./salesPhoneDirectory.js";
import { startOfDayWIB, nowPartsWIB } from "../utils/wib.js";
import { readConfig as readSalesReminderConfig, composeUnpaidDeliveredMessage } from "./salesReminderDigestJob.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(__dirname, "../../data/settings.json");

function readConfig() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")); } catch { raw = {}; }
  return { enabled: false, ...(raw.jobCompletedNotify || {}) };
}

// Dipanggil best-effort dari POST /armada/jobs/:id/complete (armada.js) —
// TIDAK PERNAH boleh menggagalkan response job yang sudah beres, pemanggil
// WAJIB membungkus ini dgn .catch(), sama pola dgn notifyDriverGroup dkk di
// route yang sama. `job` minimal butuh { orderId, type } — query
// customer/assignedSalesId TERPISAH di sini (bukan mengandalkan jobInclude
// milik pemanggil, yang tidak menyertakan assignedSalesId), pola sama
// dengan notifySalesJobFailed di pushNotifications.js.
export async function notifySalesJobCompleted(job) {
  const config = readConfig();
  if (!config.enabled) return; // staged, lihat catatan header
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

  const sales = await prisma.user.findUnique({ where: { id: salesId }, select: { id: true, name: true } });
  if (!sales) return;

  const directory = readSalesPhoneDirectory();
  const phone = resolveSalesPhone(sales.name, directory);
  if (!phone) return;

  const tipe = job.type === "PICKUP" ? "Pengambilan" : "Pengiriman";
  const nama = order.customer.name || "Customer";
  const pesan = [
    `✅ *${tipe} berhasil* — ${nama}${order.orderNumber ? ` (${order.orderNumber})` : ""}`,
    "",
    `Tim delivery sudah menyelesaikan ${tipe.toLowerCase()} dan mengunggah bukti foto ke sistem.`,
  ].join("\n");

  let ok = false;
  try {
    await sendText(phone, pesan, null, getDefaultOpsSession());
    ok = true;
  } catch (err) {
    console.warn(`[job-completed-notify] Gagal kirim WA ke ${sales.name}:`, err.message);
  }

  await prisma.staffBroadcast.create({
    data: {
      message: pesan,
      recipientIds: [sales.id],
      scheduledAt: new Date(),
      status: "SENT",
      sentAt: new Date(),
      kind: "AUTO_REMINDER",
      topic: "jobCompleted",
      results: { [sales.id]: { nama: sales.name, phone, status: ok ? "TERKIRIM" : "GAGAL" } },
    },
  }).catch((err) => console.error("[job-completed-notify] Gagal catat riwayat:", err.message));
}

// Poin 7 salesReminderDigestJob.js, versi REAL-TIME — lihat catatan header
// panjang di atas kenapa ini pindah dari cron ke sini. Dipanggil TERPISAH
// dari notifySalesJobCompleted() di atas (pemanggil di armada.js membungkus
// keduanya dgn .catch() masing-masing) — supaya kegagalan salah satu tidak
// menggagalkan yang lain, dan supaya query order/customer/sales tetap
// sendiri-sendiri per notifier (pola sama dgn notifySalesJobFailed di
// pushNotifications.js — best-effort, self-contained, bukan berbagi hasil
// query pemanggil).
export async function notifySalesUnpaidAfterDelivery(job) {
  const salesConfig = readSalesReminderConfig();
  if (!salesConfig.enabled || !salesConfig.unpaidDeliveredEnabled) return; // staged, lihat catatan header
  if (!job?.orderId) return;

  const order = await prisma.order.findUnique({
    where: { id: job.orderId },
    select: {
      orderNumber: true, status: true, paymentStatus: true,
      customer: { select: { id: true, name: true, phone: true, assignedSalesId: true } },
    },
  });
  // Cuma relevan kalau job INI yang barusan bikin order (weakest-link semua
  // unit) jadi DELIVERED — job PICKUP/revisi yang tidak mengubah status
  // akhir order TIDAK memicu apa-apa di sini, diam-diam.
  if (order?.status !== "DELIVERED" || order?.paymentStatus === "LUNAS") return;

  const salesId = order.customer?.assignedSalesId;
  if (!salesId) return;

  const sales = await prisma.user.findUnique({ where: { id: salesId }, select: { id: true, name: true } });
  if (!sales) return;

  const directory = readSalesPhoneDirectory();
  const phone = resolveSalesPhone(sales.name, directory);
  if (!phone) return;

  // Reuse composer yang sama dgn dulu dipakai cron — 1 order (baru saja
  // terkirim), bukan daftar akumulasi seperti sebelumnya.
  const pesan = composeUnpaidDeliveredMessage(sales.name, [{
    orderNumber: order.orderNumber || job.orderId,
    nama: order.customer?.name || order.customer?.phone || "(tanpa nama)",
    paymentStatus: order.paymentStatus,
  }]);
  if (!pesan) return;

  let ok = false;
  try {
    await sendText(phone, pesan, null, getDefaultOpsSession());
    ok = true;
  } catch (err) {
    console.warn(`[unpaid-delivered-notify] Gagal kirim WA ke ${sales.name}:`, err.message);
  }

  await prisma.staffBroadcast.create({
    data: {
      message: pesan,
      recipientIds: [sales.id],
      scheduledAt: new Date(),
      status: "SENT",
      sentAt: new Date(),
      kind: "AUTO_REMINDER",
      topic: "unpaidDelivered",
      results: { [sales.id]: { nama: sales.name, phone, status: ok ? "TERKIRIM" : "GAGAL" } },
    },
  }).catch((err) => console.error("[unpaid-delivered-notify] Gagal catat riwayat:", err.message));
}

// Dipakai leaderRecapJob.js — hitung job (pengiriman+pengambilan) SELESAI
// dalam RENTANG WAKTU tertentu per sales pemilik order-nya. Generik (bukan
// cuma "hari ini") supaya bisa dipakai ULANG oleh rekap catch-up pagi (job
// yang selesai SETELAH rekap sore kemarin terkirim, lihat
// runMorningCatchupCycle di leaderRecapJob.js) TANPA menduplikasi query
// yang sama. Murni-hitung, TIDAK terikat config.enabled manapun — rekap ke
// leader tetap informatif walau notifikasi real-time ke sales masih
// staged/mati.
export async function loadJobsCompletedBetweenBySales(since, until) {
  const jobs = await prisma.job.findMany({
    where: { status: "COMPLETED", completedAt: { gte: since, lt: until } },
    select: {
      type: true,
      order: { select: { orderNumber: true, customer: { select: { name: true, assignedSalesId: true } } } },
    },
  });

  const bySales = new Map(); // salesId -> [{ orderNumber, nama, tipe }]
  for (const j of jobs) {
    const salesId = j.order?.customer?.assignedSalesId;
    if (!salesId) continue;
    if (!bySales.has(salesId)) bySales.set(salesId, []);
    bySales.get(salesId).push({
      orderNumber: j.order?.orderNumber || "",
      nama: j.order?.customer?.name || "(tanpa nama)",
      tipe: j.type === "PICKUP" ? "Pengambilan" : "Pengiriman",
    });
  }
  return bySales;
}

// Wrapper tipis — dipakai runLeaderRecapCycle() (rekap sore, "hari ini").
export async function loadJobsCompletedTodayBySales(now = Date.now()) {
  const { year, month, day } = nowPartsWIB(new Date(now));
  const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return loadJobsCompletedBetweenBySales(startOfDayWIB(todayStr), new Date(now));
}
