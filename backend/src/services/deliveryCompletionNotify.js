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
// salesReminderDigest.enabled yang sudah true di production), pola SAMA
// dgn semua job WA otomatis lain di project ini — aman di-deploy, tidak
// pernah kirim WA sampai owner eksplisit menyalakan.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { sendText, getDefaultOpsSession } from "./wahaClient.js";
import { readSalesPhoneDirectory, resolveSalesPhone } from "./salesPhoneDirectory.js";
import { startOfDayWIB, nowPartsWIB } from "../utils/wib.js";

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

// Dipakai leaderRecapJob.js (rekap poin 2 baru) — hitung berapa job
// (pengiriman+pengambilan) SELESAI HARI INI per sales pemilik order-nya.
// Murni-hitung, TIDAK terikat config.enabled di atas — rekap ke leader
// tetap informatif walau notifikasi real-time ke sales masih staged/mati.
export async function loadJobsCompletedTodayBySales(now = Date.now()) {
  const { year, month, day } = nowPartsWIB(new Date(now));
  const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const startToday = startOfDayWIB(todayStr);

  const jobs = await prisma.job.findMany({
    where: { status: "COMPLETED", completedAt: { gte: startToday } },
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
