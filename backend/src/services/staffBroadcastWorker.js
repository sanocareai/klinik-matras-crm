// Worker StaffBroadcast — tiap menit, cari broadcast SCHEDULED yang
// scheduledAt-nya sudah lewat, kirim ke SEMUA penerima sekaligus (tidak ada
// pacing/kuota harian, lihat catatan di schema.prisma model StaffBroadcast
// kenapa itu tidak perlu di skala ini), lalu tandai SENT dengan hasil
// per-penerima di kolom `results`.
//
// Tahan restart (SAMA prinsip dengan broadcast_targets di routes/
// broadcast.js) — antreannya baris di tabel, bukan Map in-memory. Kalau
// backend restart tepat di antara jadwal & pengiriman, broadcast itu tetap
// terkirim di siklus cron berikutnya, tidak pernah hilang diam-diam.

import cron from "node-cron";
import { prisma } from "../db.js";
import { sendText, getDefaultOpsSession } from "./wahaClient.js";
import { readSalesPhoneDirectory, resolveSalesPhone } from "./salesPhoneDirectory.js";

let cycleRunning = false; // cegah tumpang tindih siklus kalau kirim lambat

async function processDue() {
  const due = await prisma.staffBroadcast.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
  });
  if (due.length === 0) return;

  const directory = readSalesPhoneDirectory();

  for (const broadcast of due) {
    const users = await prisma.user.findMany({
      where: { id: { in: broadcast.recipientIds } },
      select: { id: true, name: true },
    });

    const results = {};
    for (const u of users) {
      const phone = resolveSalesPhone(u.name, directory);
      if (!phone) {
        results[u.id] = { nama: u.name, phone: null, status: "GAGAL", error: "Nomor WA belum terdaftar di directory" };
        continue;
      }
      try {
        await sendText(phone, broadcast.message, null, getDefaultOpsSession());
        results[u.id] = { nama: u.name, phone, status: "TERKIRIM" };
      } catch (err) {
        results[u.id] = { nama: u.name, phone, status: "GAGAL", error: err.message };
      }
    }

    await prisma.staffBroadcast.update({
      where: { id: broadcast.id },
      data: { status: "SENT", sentAt: new Date(), results },
    });
    console.log(`[staff-broadcast] Terkirim ke ${Object.values(results).filter((r) => r.status === "TERKIRIM").length}/${users.length} penerima (id: ${broadcast.id})`);
  }
}

async function runCycle() {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    await processDue();
  } catch (err) {
    console.error("[staff-broadcast] Error siklus worker:", err.message);
  } finally {
    cycleRunning = false;
  }
}

export function startStaffBroadcastWorker() {
  cron.schedule("* * * * *", runCycle, { timezone: "Asia/Jakarta" });
  console.log("[staff-broadcast] Worker terdaftar — cek broadcast terjadwal tiap menit");
}

export { runCycle as runStaffBroadcastCycle };
