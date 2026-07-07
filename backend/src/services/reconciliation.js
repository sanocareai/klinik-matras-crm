// Nightly reconciliation job — dijalankan jam 2 pagi WIB via node-cron.
// Tujuan: deteksi drift antara jumlah pesan di WAHA vs DB, simpan ke SyncDiscrepancy.
// Kalau drift >2 pesan → kemungkinan ada pesan yang tidak masuk via webhook.

import cron from "node-cron";
import { prisma } from "../db.js";
import { getChats, fetchChatHistory, normalizePhoneNumber } from "./wahaClient.js";

const WAHA_SESSION = process.env.WAHA_SESSION || "default";

// Jalankan satu siklus rekonsiliasi — bisa dipanggil manual untuk test
export async function runReconciliation() {
  console.log("[reconciliation] Mulai nightly reconciliation...");
  let checked = 0;
  let driftFound = 0;

  try {
    // Ambil 20 chat paling aktif dari WAHA
    const chats = await getChats(20);
    if (!chats.length) {
      console.log("[reconciliation] WAHA tidak return chat apapun — skip.");
      return;
    }

    for (const chat of chats) {
      const rawId = chat.id || "";
      const phone = await normalizePhoneNumber(rawId, WAHA_SESSION);
      if (!phone) continue;

      // Cari conversation di DB
      const customer = await prisma.customer.findUnique({
        where: { phone },
        select: { id: true },
      });
      if (!customer) continue;

      const conversation = await prisma.conversation.findFirst({
        where: { customerId: customer.id, channel: "WHATSAPP" },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true },
      });

      // Hitung pesan di DB
      const dbCount = conversation
        ? await prisma.message.count({ where: { conversationId: conversation.id } })
        : 0;

      // Hitung pesan dari WAHA (ambil 50 saja — cukup untuk deteksi drift kasar)
      const wahaMessages = await fetchChatHistory(phone, 50);
      const wahaCount = wahaMessages.length;

      checked++;

      // Catat kalau ada perbedaan lebih dari 2 pesan (toleransi kecil untuk timing race)
      const difference = Math.abs(wahaCount - dbCount);
      if (difference > 2) {
        driftFound++;
        await prisma.syncDiscrepancy.create({
          data: {
            phone,
            conversationId: conversation?.id || null,
            wahaCount,
            dbCount,
            difference,
          },
        });
        console.log(`[reconciliation] Drift terdeteksi — ${phone}: WAHA=${wahaCount} DB=${dbCount} diff=${difference}`);
      }
    }

    console.log(`[reconciliation] Selesai. Dicek: ${checked}, Drift ditemukan: ${driftFound}`);
  } catch (e) {
    console.error("[reconciliation] Error:", e.message);
  }
}

// Daftarkan cron job — jam 2 pagi WIB (UTC+7 = 19:00 UTC)
// Format: detik menit jam hari-bulan bulan hari-minggu
export function startReconciliationJob() {
  cron.schedule("0 19 * * *", async () => {
    console.log("[reconciliation] Cron fired — jam 2 pagi WIB");
    await runReconciliation();
  }, {
    timezone: "Asia/Jakarta",
  });
  console.log("[reconciliation] Cron job terdaftar — akan jalan tiap jam 02:00 WIB");
}
