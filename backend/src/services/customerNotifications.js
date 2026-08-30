// Notifikasi WhatsApp otomatis ke CUSTOMER — Phase 4 (PRD §7.8, FR-N).
//
// PERSIS EMPAT momen, TIDAK LEBIH — PRD sendiri memperingatkan:
// "More than four and customers mute you." Jangan tergoda menambah trigger
// baru di sini tanpa mengurangi salah satu yang sudah ada.
//   1. Driver menuju lokasi → notifyDriverEnRoute   (armada.js, job PICKUP/DELIVERY mulai jalan)
//   2. Unit sampai bengkel  → notifyUnitReceived    (armada.js, job PICKUP selesai)
//   3. Siap dikirim         → notifyReadyForDelivery (production.js, unit tuntas seluruh tahap)
//   4. Terkirim             → notifyDelivered       (armada.js, job DELIVERY selesai)
//
// REVISI 31 Agustus 2026 (keputusan owner): trigger 1 SEBELUMNYA "Pickup
// dijadwalkan" (dikirim begitu job dibuat dengan tanggal, bisa berhari-hari
// sebelum pengambilan sungguhan — kurang actionable). Diganti "Driver
// menuju lokasi" (dikirim saat job BENAR-BENAR mulai jalan, POST
// /jobs/:id/start) — customer tahu PERSIS kapan harus siap-siap, pola yang
// sama dipakai Gojek/GoFood ("driver sedang menuju lokasi Anda"). Tetap
// PERSIS 4, bukan ditambah jadi 5.
//
// SEMUA best-effort: kegagalan kirim WA TIDAK PERNAH menggagalkan aksi
// utamanya (job selesai, tahap tuntas) — sama prinsipnya dengan
// notifyDriverGroup di armada.js (D-018). Pemanggil WAJIB membungkus dengan
// .catch(), fungsi di sini sendiri juga menelan errornya supaya aman
// dipanggil tanpa await kalau perlu.
//
// Beda dari send-documentation (D-016) yang perlu klik manual sales: ini
// OTOMATIS, tapi templatnya FIX dan pendek — bukan pengganti dokumentasi
// foto per tahap yang memang tetap manual (keputusan sadar, bukan lupa).

import { prisma } from "../db.js";
import { sendText } from "./wahaClient.js";
import { sendWithSessionFallback } from "../routes/conversations.js";
import { emitNewMessage, emitConversationUpdate } from "../socket.js";
import { buildMessagePreview } from "../utils/messagePreview.js";

// Cari/buat conversation aktif customer ini — pola SAMA PERSIS dengan
// webhooks.js (pesan masuk), termasuk penanganan race condition lewat
// partial unique index (Conversation_customerId_channel_active_unique).
async function findOrCreateConversation(customerId) {
  let conversation = await prisma.conversation.findFirst({
    where: { customerId, channel: "WHATSAPP", status: { not: "RESOLVED" } },
    orderBy: { lastMessageAt: "desc" },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });
  if (conversation) return conversation;
  try {
    conversation = await prisma.conversation.create({
      data: { customerId, channel: "WHATSAPP" },
      include: { customer: { select: { id: true, name: true, phone: true } } },
    });
  } catch (e) {
    if (e.code !== "P2002") throw e;
    conversation = await prisma.conversation.findFirst({
      where: { customerId, channel: "WHATSAPP", status: { not: "RESOLVED" } },
      orderBy: { lastMessageAt: "desc" },
      include: { customer: { select: { id: true, name: true, phone: true } } },
    });
  }
  return conversation;
}

async function sendCustomerText(customerId, text) {
  const conversation = await findOrCreateConversation(customerId);
  if (!conversation?.customer?.phone) return; // tidak ada nomor — diam, bukan error keras
  const target = conversation.customer.phone;

  // externalId dari WAHA WAJIB disimpan (pola sama dengan conversations.js
  // ~L682) — tanpa ini webhook echo "fromMe" untuk pesan yang sama tidak
  // bisa dedup by externalId, dan disimpan LAGI sebagai baris Message baru
  // (bug nyata, ditemukan 23 Agustus 2026: notifyPickupScheduled tampil
  // dobel di riwayat chat CRM, walau WhatsApp customer cuma terima 1x).
  const { result: wahaMsg, session } = await sendWithSessionFallback(conversation, (s) => sendText(target, text, null, s));

  const msg = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "OUTBOUND", content: text, externalId: wahaMsg?.id || null },
  });
  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(text, null), sessionId: session },
  });
  emitNewMessage(conversation.id, msg);
  emitConversationUpdate(updated);
}

function wrap(fn, label) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(`[customerNotifications:${label}] gagal kirim:`, err.message);
    }
  };
}

// 1. Driver menuju lokasi — dikirim saat job (PICKUP atau DELIVERY) BENAR-
// BENAR mulai jalan (POST /jobs/:id/start, status -> EN_ROUTE). Lihat
// catatan revisi 31 Agustus 2026 di kepala file untuk alasan gantinya.
export const notifyDriverEnRoute = wrap(async (job, customerId, customerName) => {
  const driverLine = job.driver?.name ? ` (${job.driver.name})` : "";
  const aksi = job.type === "PICKUP" ? "mengambil" : "mengantar";
  const text = `Halo ${customerName || ""}, driver kami${driverLine} sedang menuju lokasi Anda untuk ${aksi} kasur Anda.\n\nMohon bersiap ya — Sano Care.`;
  await sendCustomerText(customerId, text);
}, "driverEnRoute");

// 2. Unit sampai bengkel — dikirim saat job PICKUP selesai.
export const notifyUnitReceived = wrap(async (orderNumber, customerId, customerName) => {
  const text = `Halo ${customerName || ""}, kasur Anda (*${orderNumber}*) sudah sampai dengan selamat di bengkel Sano Care. Tim kami akan segera mulai pengerjaan.\n\nTerima kasih atas kepercayaannya.`;
  await sendCustomerText(customerId, text);
}, "unitReceived");

// 3. Siap dikirim — dikirim saat sebuah unit menuntaskan SELURUH tahap
// (status → READY_FOR_DELIVERY). Untuk order banyak unit (hotel, D-006)
// ini bisa terkirim beberapa kali seiring unit selesai bertahap — itu
// perilaku yang benar, bukan bug (tiap batch yang siap memang kabar baru).
export const notifyReadyForDelivery = wrap(async (unitCode, orderNumber, customerId, customerName) => {
  const text = `Halo ${customerName || ""}, kabar baik! Kasur Anda (*${unitCode}*, order *${orderNumber}*) sudah selesai dikerjakan dan siap dikirim.\n\nTim kami akan menghubungi untuk konfirmasi jadwal pengiriman.`;
  await sendCustomerText(customerId, text);
}, "readyForDelivery");

// 4. Terkirim — dikirim saat job DELIVERY selesai.
export const notifyDelivered = wrap(async (orderNumber, customerId, customerName) => {
  const text = `Terima kasih ${customerName || ""}! Kasur Anda (*${orderNumber}*) sudah terkirim.\n\nGaransi & instruksi perawatan akan dikirim menyusul oleh tim sales kami. Kalau ada pertanyaan, jangan ragu menghubungi kami — Ahlinya Kasur Sehat.`;
  await sendCustomerText(customerId, text);
}, "delivered");
