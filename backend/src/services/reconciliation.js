// Dua job terjadwal:
// 1. syncReadFromWaha()    — setiap 5 menit, FALLBACK sinkronisasi status read
//    (jalur utama sekarang event message.ack di webhooks.js, lihat Task 2 —
//    diperjarang dari 2 menit karena event ack sudah reliable, ini cuma
//    jaring pengaman kalau event terlewat/webhook down sesaat)
//    Kalau sales buka chat di HP WhatsApp → unreadCount=0 di WAHA → CRM update isRead=true
// 2. runReconciliation()   — setiap jam 2 pagi, deteksi drift jumlah pesan

import cron from "node-cron";
import { prisma } from "../db.js";
import { getChats, fetchChatHistory, normalizePhoneNumber } from "./wahaClient.js";
import { emitConversationUpdate } from "../socket.js";

const WAHA_SESSION = process.env.WAHA_SESSION || "default";

// ── Sinkronisasi status read dari WAHA → CRM (dijalankan setiap 2 menit) ──────
// Cara kerja:
//   - Ambil 100 chat terbaru dari WAHA — tiap chat punya field unreadCount
//   - Kalau unreadCount=0 tapi CRM masih unread/belum isRead → berarti sudah dibaca
//     di HP WhatsApp (bukan lewat CRM) → update CRM supaya sinkron
//   - Kalau unreadCount>0 tapi CRM sudah isRead → berarti ada pesan baru yang belum
//     masuk via webhook → reset isRead=false, unread=true di CRM
// Lock sederhana — cegah dua siklus berjalan bersamaan kalau job lambat
let syncReadRunning = false;

export async function syncReadFromWaha() {
  if (syncReadRunning) return; // jangan tumpuk job
  syncReadRunning = true;
  try {
    const chats = await getChats(100);
    if (!chats.length) return;

    let updated = 0;
    for (const chat of chats) {
      const rawId = chat.id || "";
      // Skip grup dan non-@c.us (broadcast, status, dll)
      if (!rawId.includes("@c.us")) continue;

      // WAHA chat object field unreadCount (kadang snake_case unread_count)
      const wahaUnread = chat.unreadCount ?? chat.unread_count ?? null;
      if (wahaUnread === null) continue; // field tidak ada di response ini, skip

      const phone = await normalizePhoneNumber(rawId, WAHA_SESSION);
      if (!phone) continue;

      const customer = await prisma.customer.findUnique({
        where:  { phone },
        select: { id: true },
      });
      if (!customer) continue;

      const conv = await prisma.conversation.findFirst({
        where:   { customerId: customer.id, channel: "WHATSAPP" },
        orderBy: { lastMessageAt: "desc" },
        select:  { id: true, isRead: true, unread: true, unreadCount: true },
      });
      if (!conv) continue;

      // Fallback polling (Task 2c) — jaring pengaman kalau event message.ack
      // (fix utama, lihat webhooks.js) terlewat/gagal. BUG lama: hanya reset
      // `unread` (boolean lama) tapi TIDAK `unreadCount` (badge angka yang
      // sekarang dipakai ConversationItem) dan TIDAK emit ke socket — jadi
      // walau job ini jalan tiap 2 menit, badge angka tetap nyangkut dan
      // frontend baru lihat perubahan setelah refresh manual. Sekarang
      // keduanya diperbaiki.
      if (wahaUnread === 0 && (!conv.isRead || conv.unread || conv.unreadCount > 0)) {
        // WAHA bilang sudah terbaca (di HP atau CRM) — update CRM supaya sinkron
        const updatedConv = await prisma.conversation.update({
          where: { id: conv.id },
          data:  { isRead: true, readAt: new Date(), unread: false, unreadCount: 0 },
        });
        emitConversationUpdate(updatedConv);
        updated++;
        console.log(`[syncRead] isRead=true, unreadCount=0 untuk ${phone} (unreadCount=0 di WAHA)`);
      } else if (wahaUnread > 0 && conv.isRead) {
        // Ada pesan baru yang belum terbaca — pastikan CRM juga tahu
        const updatedConv = await prisma.conversation.update({
          where: { id: conv.id },
          data:  { isRead: false, unread: true, unreadCount: wahaUnread },
        });
        emitConversationUpdate(updatedConv);
        updated++;
        console.log(`[syncRead] isRead=false, unreadCount=${wahaUnread} untuk ${phone} (unreadCount=${wahaUnread} di WAHA)`);
      }
    }

    if (updated > 0) {
      console.log(`[syncRead] Sinkronisasi selesai — ${updated} percakapan diperbarui`);
    }
  } catch (e) {
    console.error("[syncRead] Error:", e.message);
  } finally {
    syncReadRunning = false;
  }
}

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
        select: { id: true, sessionId: true },
      });

      // Hitung pesan di DB
      const dbCount = conversation
        ? await prisma.message.count({ where: { conversationId: conversation.id } })
        : 0;

      // Hitung pesan dari WAHA (ambil 50 saja — cukup untuk deteksi drift kasar).
      // sessionId conversation dipakai kalau ada (fetchChatHistory sudah
      // fallback ke session lain sendiri kalau kosong/salah).
      const wahaMessages = await fetchChatHistory(phone, conversation?.sessionId || undefined, { maxMessages: 50, pageSize: 50 });
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

// Daftarkan semua cron job:
// 1. Setiap 5 menit — sinkronisasi status read WAHA ↔ CRM (fallback)
// 2. Jam 2 pagi WIB — deteksi drift jumlah pesan
export function startReconciliationJob() {
  // Job 1: sync read status setiap 5 menit (fallback — jalur utama event message.ack)
  cron.schedule("*/5 * * * *", async () => {
    await syncReadFromWaha();
  }, { timezone: "Asia/Jakarta" });
  console.log("[reconciliation] Job syncRead terdaftar — jalan setiap 5 menit (fallback)");

  // Job 2: nightly reconciliation jam 2 pagi WIB
  cron.schedule("0 2 * * *", async () => {
    console.log("[reconciliation] Cron fired — jam 2 pagi WIB");
    await runReconciliation();
  }, { timezone: "Asia/Jakarta" });
  console.log("[reconciliation] Job nightly terdaftar — jalan setiap jam 02:00 WIB");
}
