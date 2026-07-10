import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { normalizePhoneNumber, downloadMediaMessage, downloadMediaFromUrl, getProfilePicture, fetchChatHistory, markChatAsRead, getGroupInfo } from "../services/wahaClient.js";
import { syncReadFromWaha } from "../services/reconciliation.js";
import { sendPushToAllUsers } from "../services/expoPush.js";
import { broadcast } from "./sse.js";
import { buildMessagePreview } from "../utils/messagePreview.js";
import { emitNewMessage, emitMessageAck, emitConversationUpdate } from "../socket.js";

export const webhookRouter = express.Router();

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir  = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Deteksi engine dari request body WAHA — field "engine" adalah yang paling reliable.
// Fallback: periksa struktur payload (_data.Info → GOWS, _data.key → NOWEB).
function detectEngine(reqBody) {
  if (reqBody.engine) return reqBody.engine.toUpperCase(); // "GOWS" atau "NOWEB"
  if (reqBody.payload?._data?.Info)  return "GOWS";
  if (reqBody.payload?._data?.key)   return "NOWEB";
  return "NOWEB"; // default aman
}

// ── Parser NOWEB ─────────────────────────────────────────────────────────────
// NOWEB: payload.from bisa "@lid" — nomor asli dicari di remoteJidAlt dulu,
// baru fallback ke resolvePhoneFromLid via normalizePhoneNumber.
// fromMe: nomor customer ada di chatId (payload.from = nomor admin sendiri).
async function extractPhoneNoweb(payload, session) {
  if (payload.fromMe) {
    return await normalizePhoneNumber(payload.chatId || "", session);
  }
  const from = payload.from || "";
  if (from.includes("@lid")) {
    // NOWEB sering punya remoteJidAlt — lebih langsung dari WAHA API
    const realJid =
      payload._data?.key?.remoteJidAlt ||
      payload._data?.remoteJidAlt       ||
      payload.remoteJidAlt;
    if (realJid) {
      console.log("[webhook] NOWEB @lid → pakai remoteJidAlt:", realJid);
      const phone = await normalizePhoneNumber(realJid, session);
      if (phone) return phone;
    }
    // Fallback: resolve via WAHA API (normalizePhoneNumber handles @lid)
  }
  return await normalizePhoneNumber(from, session);
}

// ── Parser GOWS ──────────────────────────────────────────────────────────────
// GOWS: struktur bersarang di _data.Info.
// AltJid (SenderAlt/RecipientAlt) berisi nomor asli kalau tersedia — prioritaskan ini.
// Kalau @lid: normalizePhoneNumber otomatis panggil resolvePhoneFromLid.
async function extractPhoneGows(payload, session) {
  const info   = payload._data?.Info || {};
  const fromMe = !!payload.fromMe;

  let primaryJid, altJid;
  if (fromMe) {
    primaryJid = info.Chat         || "";
    altJid     = info.RecipientAlt || "";
  } else {
    primaryJid = info.Sender || info.Chat || payload.from || "";
    altJid     = info.SenderAlt || "";
  }

  // AltJid (nomor asli) tersedia → pakai dulu (lebih reliable dari primaryJid)
  if (altJid && !altJid.includes("@lid")) {
    const phone = await normalizePhoneNumber(altJid, session);
    if (phone) return phone;
  }

  // primaryJid → normalizePhoneNumber handle LID + strip + normalize
  return await normalizePhoneNumber(primaryJid, session);
}

// ── Normalisasi payload NOWEB/GOWS ke struktur internal yang sama ─────────────
// Async karena extractPhoneGows bisa panggil WAHA API untuk resolve LID.
async function extractMessageData(payload, engine, sessionName) {
  let phone;
  if (engine === "GOWS") {
    phone = await extractPhoneGows(payload, sessionName);
  } else {
    phone = await extractPhoneNoweb(payload, sessionName);
  }

  // pushName: NOWEB pakai _data.pushName; GOWS mungkin di Info.PushName
  const pushName =
    payload._data?.Info?.PushName ||
    payload._data?.pushName       ||
    payload.notifyName            ||
    payload.pushName              ||
    null;

  // Timestamp: epoch seconds — WAHA normalizes ini di kedua engine
  const timestamp =
    payload.timestamp              ||
    payload._data?.Info?.Timestamp ||
    null;

  return {
    phone,
    fromMe:    !!payload.fromMe,
    externalId: payload.id,
    pushName,
    body:       payload.body || "",
    hasMedia:   !!payload.hasMedia,
    mediaInfo:  payload.media || null,
    timestamp,
  };
}

// Bersihkan MIME type dari codec info (contoh: "audio/ogg; codecs=opus" → "audio/ogg")
function cleanMime(mime) {
  return (mime || "").split(";")[0].trim().toLowerCase();
}

// Tentukan mediaType dari MIME type
function mimeToMediaType(mime) {
  const m = cleanMime(mime);
  if (!m) return "document";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

// Download media dengan retry — WAHA terkadang belum selesai proses media saat webhook tiba
async function downloadWithRetry(mediaInfo, messageId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      await new Promise(r => setTimeout(r, 1500 * attempt));
      console.log(`[webhook] Retry download attempt ${attempt} untuk id: ${messageId}`);
    }
    if (mediaInfo?.url) {
      const result = await downloadMediaFromUrl(mediaInfo.url);
      if (result?.data) return result;
    }
    if (messageId) {
      const result = await downloadMediaMessage(messageId);
      if (result?.data) return result;
    }
  }
  return null;
}

// Ekstensi file dari MIME type
function extFromMime(mime) {
  const map = {
    "image/jpeg": ".jpg",  "image/png": ".png",   "image/gif": ".gif",
    "image/webp": ".webp", "video/mp4": ".mp4",   "video/webm": ".webm",
    "audio/ogg":  ".ogg",  "audio/opus": ".ogg",  "audio/webm": ".webm",
    "audio/mpeg": ".mp3",  "audio/mp4": ".m4a",   "audio/aac": ".aac",
    "application/pdf": ".pdf",
  };
  return map[cleanMime(mime)] || ".bin";
}

// ── Handler pesan grup WhatsApp ──────────────────────────────────────────────
// Grup (@g.us) disimpan sebagai Conversation terpisah tanpa Customer record.
// Tidak ada lead attribution, tidak ada customer upsert, tidak muncul di CRM Pelanggan.
async function handleGroupMessage(payload, groupJid, externalId, sessionName) {
  try {
    // Nama grup (bukan nama sender) — GOWS mungkin expose di chatName.
    // Info.PushName = nama PENGIRIM, bukan nama grup, jadi TIDAK PERNAH dipakai
    // untuk groupName (bug produksi lama: grup tampil nama member, bukan nama
    // grup — root cause: payload chatName/GroupName kosong lalu tidak ada
    // fallback lain sampai fix ini, jadi kadang salah kesasar data lama).
    let groupName =
      payload.chatName ||
      payload._data?.chatName ||
      payload._data?.Info?.GroupName ||
      null;

    // Nama pengirim pesan ini dalam grup
    const senderName =
      payload._data?.Info?.PushName ||
      payload._data?.pushName       ||
      payload.notifyName            ||
      payload.pushName              ||
      null;

    const fromMe  = !!payload.fromMe;
    const text    = payload.body || "";
    const direction = fromMe ? "OUTBOUND" : "INBOUND";

    // Cari conversation grup yang masih aktif untuk JID ini
    let conversation = await prisma.conversation.findFirst({
      where: { groupJid, status: { not: "RESOLVED" } },
      orderBy: { lastMessageAt: "desc" },
    });

    // Tier 2 — payload tidak menyertakan nama grup yang bisa diandalkan →
    // tanya WAHA langsung (authoritative source, bukan tebak-tebak dari
    // payload). Cuma dipanggil sekali per grup (di-cache ke groupName di DB),
    // BUKAN tiap pesan masuk — supaya tidak membebani WAHA API.
    const needsNameLookup = !groupName && (!conversation || !conversation.groupName);
    if (needsNameLookup) {
      groupName = await getGroupInfo(groupJid, sessionName);
    }

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          type:      "GROUP",
          groupJid,
          groupName: groupName || null, // null (bukan JID mentah) — ChatWindow/ConversationItem fallback ke "Grup WhatsApp"
          channel:   "WHATSAPP",
          customerId: null,
        },
      });
      console.log("[webhook] Grup baru dibuat:", groupJid, "→", conversation.id, "nama:", groupName || "(belum diketahui)");
    } else if (groupName && !conversation.groupName) {
      // Update nama grup kalau baru diketahui
      await prisma.conversation.update({
        where: { id: conversation.id },
        data:  { groupName },
      });
    }

    // Simpan pesan grup (sertakan senderName supaya nama pengirim muncul di bubble)
    let message;
    try {
      message = await prisma.message.create({
        data: { conversationId: conversation.id, direction, content: text, externalId,
                senderName: fromMe ? null : (senderName || null) },
      });
    } catch (e) {
      if (e.code !== "P2002") throw e;
      return; // duplikat — race condition, skip
    }

    const updatedConv = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        lastMessagePreview: buildMessagePreview(text, null),
        sessionId: sessionName || null,
        ...(direction === "INBOUND" ? { unread: true, unreadCount: { increment: 1 } } : {}),
      },
    });

    broadcast("new_message", { conversationId: conversation.id, customerId: null });
    emitNewMessage(conversation.id, message);
    emitConversationUpdate(updatedConv);
    console.log("[webhook] Pesan grup disimpan:", groupJid, direction);
  } catch (err) {
    console.error("[webhook] Gagal proses pesan grup:", err.message);
  }
}

// ── Pesan masuk dari customer (inbound) — dipakai event "message" DAN
// "message.any" (fromMe:false). Return "saved" kalau berhasil, "skip-dupe"
// kalau race condition P2002 kejar duluan disimpan request lain.
async function handleInboundMessage({ payload, phone, pushName, text, hasMedia, mediaInfo, externalId, sessionName }) {
  // Deteksi sumber lead (3 lapis) — hanya untuk customer BARU
  const existingCustomer = await prisma.customer.findUnique({ where: { phone } });
  let detectedSource = "WHATSAPP_DIRECT";
  let detectedDetail = null;
  let pendingClickId = null;

  if (!existingCustomer) {
    // Lapis 1: referral Meta Ads dari payload mentah (GOWS mungkin expose di Info.CtwaContext)
    const rawData = payload._data || {};
    const ctwa =
      rawData.ctwaContext              ||
      rawData.contextInfo?.referral    ||
      rawData.conversionSource         ||
      rawData.Info?.CtwaContext;
    if (ctwa) {
      detectedSource = "META_ADS";
      detectedDetail = ctwa.sourceUrl || ctwa.headline || JSON.stringify(ctwa).slice(0, 200);
      console.log("[attribution] Lapis 1 META_ADS:", detectedDetail);
    } else {
      console.log("[attribution] Lapis 1 tidak kena — NOWEB/GOWS mungkin tidak expose ctwaContext");
    }

    // Lapis 2: cari ClickEvent terbaru (15 menit) yang belum ter-match
    if (detectedSource === "WHATSAPP_DIRECT") {
      const since = new Date(Date.now() - 15 * 60 * 1000);
      const recentClick = await prisma.clickEvent.findFirst({
        where: { matchedCustomerId: null, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        include: { trackedLink: true },
      });
      if (recentClick) {
        const MAP = {
          META_ADS: "META_ADS", GOOGLE_ADS: "GOOGLE_ADS",
          WEBSITE_ORGANIC: "WEBSITE_ORGANIC", OTHER: "OTHER",
        };
        detectedSource = MAP[recentClick.trackedLink.category] || "OTHER";
        detectedDetail = recentClick.trackedLink.name;
        pendingClickId = recentClick.id;
        console.log("[attribution] Lapis 2 hit:", recentClick.trackedLink.name);
      }
    }
    // Lapis 3: default WHATSAPP_DIRECT sudah diset di atas
  }

  // Upsert customer — bungkus P2002 untuk handle race condition:
  // dua webhook identik bisa tiba bersamaan sebelum salah satu selesai INSERT
  let customer;
  try {
    customer = await prisma.customer.upsert({
      where:  { phone },
      update: {},
      create: {
        phone,
        name:                pushName || null,
        leadSource:          detectedSource,
        leadSourceDetail:    detectedDetail,
        leadSourceConfirmed: false,
      },
    });
  } catch (e) {
    if (e.code !== "P2002") throw e;
    customer = await prisma.customer.findUnique({ where: { phone } });
    if (!customer) throw e;
  }

  // Untuk customer BARU: fetch foto profil WA sekali (fire-and-forget, gagal = wajar)
  if (!existingCustomer) {
    getProfilePicture(phone).then((url) => {
      if (url) {
        prisma.customer.update({ where: { phone }, data: { profilePictureUrl: url } }).catch(() => {});
      }
    }).catch(() => {});
  }

  // Jika Lapis 2 berhasil, tandai klik sudah dicocokkan ke customer ini
  if (pendingClickId) {
    await prisma.clickEvent.update({
      where: { id: pendingClickId },
      data:  { matchedCustomerId: customer.id },
    }).catch(() => {});
  }

  // Cari/buat conversation aktif
  let conversation = await prisma.conversation.findFirst({
    where: { customerId: customer.id, channel: "WHATSAPP", status: { not: "RESOLVED" } },
    orderBy: { lastMessageAt: "desc" },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { customerId: customer.id, channel: "WHATSAPP" },
    });
  }

  // Download & simpan media kalau ada
  let mediaType = null;
  let mediaUrl  = null;

  if (hasMedia) {
    // GOWS mungkin simpan MIME di Info.Mimetype, NOWEB di _data.mimetype
    const mime =
      mediaInfo?.mimetype           ||
      payload._data?.mimetype       ||
      payload._data?.Info?.Mimetype ||
      "";
    mediaType = mimeToMediaType(mime);

    console.log("[webhook] Ada media, mime:", mime, "ext:", extFromMime(mime), "url:", mediaInfo?.url?.slice(0, 80));

    const downloaded = await downloadWithRetry(mediaInfo, externalId);

    if (downloaded?.data) {
      const finalMime = (downloaded.mimetype && downloaded.mimetype !== "application/octet-stream")
        ? downloaded.mimetype : mime;
      const ext      = extFromMime(finalMime);
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(downloaded.data, "base64"));
      mediaUrl = `/uploads/${filename}`;
      console.log("[webhook] Media disimpan:", mediaUrl);
    } else {
      console.warn("[webhook] Tidak bisa download media untuk id:", externalId);
    }
  }

  // Simpan pesan — P2002 berarti request concurrent sudah simpan duluan, skip saja
  let inboundMsg;
  try {
    inboundMsg = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction:      "INBOUND",
        content:        text,
        mediaType:      mediaType || null,
        mediaUrl:       mediaUrl  || null,
        externalId,
      },
    });
  } catch (e) {
    if (e.code !== "P2002") throw e;
    return "skip-dupe";
  }

  // Pesan masuk baru → unread=true (badge sidebar lama) + unreadCount+1 (badge baru)
  // + isRead=false (belum dibuka lagi)
  const updatedConvInbound = await prisma.conversation.update({
    where: { id: conversation.id },
    data:  {
      lastMessageAt: new Date(),
      status: "OPEN",
      unread: true,
      isRead: false,
      lastMessagePreview: buildMessagePreview(text, mediaType),
      sessionId: sessionName || null,
      unreadCount: { increment: 1 },
    },
  });

  broadcast("new_message", { conversationId: conversation.id, customerId: customer.id });
  emitNewMessage(conversation.id, inboundMsg);
  emitConversationUpdate(updatedConvInbound);

  // Push notification ke aplikasi mobile tim (fire-and-forget).
  // Hanya pesan individual — pesan grup internal tidak di-push supaya tidak berisik.
  const preview = text
    ? text.slice(0, 100)
    : mediaType === "image"    ? "📷 Foto"
    : mediaType === "video"    ? "🎥 Video"
    : mediaType === "audio"    ? "🎤 Pesan suara"
    : mediaType === "document" ? "📄 Dokumen"
    : "Pesan baru";
  sendPushToAllUsers({
    title: customer.name || customer.phone || "Pelanggan",
    body:  preview,
    data:  { conversationId: conversation.id, customerId: customer.id },
  }).catch((e) => console.warn("[push] Error:", e.message));

  return "saved";
}

// ── Pesan OUTBOUND dari HP admin sendiri (bukan lewat CRM) ──────────────────
// Dipakai event "message" (allowCreateCustomer=false, perilaku lama
// dipertahankan persis) DAN event "message.any" (allowCreateCustomer=true —
// fix BUG FATAL: balasan sales dari HP tidak tersimpan kalau customer/
// conversation belum ada, mis. sales mulai chat duluan dari HP bukan CRM).
// phone di sini SUDAH resolve dari Chat JID (lawan bicara), BUKAN Sender —
// lihat extractPhoneGows: primaryJid = info.Chat saat fromMe true.
// Return "saved" | "skip-dupe" | "dropped-no-customer".
async function handleOutboundFromPhone(payload, phone, text, externalId, sessionName, initialAck, { allowCreateCustomer }) {
  let customer = await prisma.customer.findUnique({ where: { phone } });

  if (!customer) {
    if (!allowCreateCustomer) {
      console.log("[webhook] fromMe: customer belum ada di DB, dilewati:", phone);
      return "dropped-no-customer";
    }
    // Sales mulai chat duluan dari HP — buat customer+conversation seperti
    // pesan masuk biasa, TAPI pakai Chat (lawan bicara) sebagai identitas.
    // Tidak ikut lead-attribution 3-lapis (itu murni utk pesan MASUK dari
    // customer baru) — leadSource default WHATSAPP_DIRECT sudah representatif
    // untuk kontak yang diinisiasi internal.
    try {
      customer = await prisma.customer.upsert({
        where:  { phone },
        update: {},
        create: { phone, leadSource: "WHATSAPP_DIRECT", leadSourceConfirmed: false },
      });
    } catch (e) {
      if (e.code !== "P2002") throw e;
      customer = await prisma.customer.findUnique({ where: { phone } });
      if (!customer) throw e;
    }
  }

  let conversation = await prisma.conversation.findFirst({
    where: { customerId: customer.id, channel: "WHATSAPP", status: { not: "RESOLVED" } },
    orderBy: { lastMessageAt: "desc" },
  });
  if (!conversation) {
    if (!allowCreateCustomer) return "dropped-no-customer"; // perilaku lama: skip kalau conversation belum ada juga
    conversation = await prisma.conversation.create({
      data: { customerId: customer.id, channel: "WHATSAPP" },
    });
  }

  let outboundMsg;
  try {
    outboundMsg = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        content: text,
        externalId,
        ack: initialAck || 0,
      },
    });
  } catch (e) {
    if (e.code !== "P2002") throw e;
    return "skip-dupe"; // race condition — sudah disimpan concurrent request
  }

  // JANGAN sentuh unread/unreadCount/isRead — ini pesan KITA sendiri, bukan
  // sinyal baca/belum-baca pesan customer.
  const updatedConv = await prisma.conversation.update({
    where: { id: conversation.id },
    data:  {
      lastMessageAt: new Date(),
      lastMessagePreview: buildMessagePreview(text, null),
      sessionId: sessionName || null,
    },
  });
  broadcast("new_message", { conversationId: conversation.id, customerId: customer.id });
  emitNewMessage(conversation.id, outboundMsg);
  emitConversationUpdate(updatedConv);
  return "saved";
}

webhookRouter.post("/waha", async (req, res) => {
  res.sendStatus(200); // Balas cepat supaya WAHA tidak retry

  try {
    const { event, payload } = req.body;
    console.log("[WAHA webhook]", event, JSON.stringify(payload));

    // Handle event status sesi — WAHA kirim ini saat WA connect/disconnect
    if (event === "session.status") {
      if (payload?.status === "WORKING") {
        console.log("[webhook] WAHA session CONNECTED — mulai auto-sync riwayat & read status");
        setImmediate(autoSyncHistory);
        setImmediate(syncReadFromWaha); // sinkronisasi read status segera setelah konek
      }
      return;
    }

    // ── message.ack / message.receipt: status centang ──
    // 2 skenario berbeda ditangani di sini (Task 2 — bug produksi "status
    // dibuka di HP tidak sinkron ke CRM"):
    //   A) ack pesan OUTBOUND (yang KITA kirim) → customer baca pesan kita
    //      → Conversation.isRead=true (perilaku existing, TIDAK menyentuh
    //      unreadCount — itu hitungan pesan MASUK yang belum kita buka).
    //   B) ack pesan INBOUND (dari customer) dengan ack=READ → berarti SALES
    //      baca pesan itu di HP WhatsApp langsung (WhatsApp multi-device sync
    //      "read" ke semua device terhubung, termasuk sesi WAHA) — BUKAN lewat
    //      CRM. Sebelumnya TIDAK ADA case ini sama sekali, jadi CRM tidak
    //      pernah tahu chat sudah dibuka di HP → unreadCount tidak pernah
    //      ke-reset dari jalur ini (cuma reset lewat GET/POST di CRM sendiri
    //      atau fallback polling syncReadFromWaha tiap 2 menit).
    // NOWEB taruh ack di payload.ack, GOWS kadang di payload._data.ack —
    // sudah dual-engine aware. WHATSAPP_HOOK_EVENTS wajib subscribe
    // "message.ack" (lihat docker-compose.yml) — kalau GOWS pakai nama event
    // lain (mis. "message.receipt") untuk kasus ini, event listener di bawah
    // "message" dispatcher WAJIB ditambahkan juga (lihat webhookRouter.post).
    if (event === "message.ack" || event === "message.receipt") {
      const ack     = payload?.ack     || payload?._data?.ack || 0;
      const ackName = payload?.ackName || payload?._data?.ackName || "";
      const externalId = payload?.id;
      const isReadAck = ackName === "READ" || ack >= 3;

      // 1) Update status centang per-pesan (Message.ack) via externalId —
      // dual-engine aware (NOWEB: payload.ack, GOWS: kadang di _data.ack).
      // Diamkan kalau externalId tidak ditemukan (race dgn pesan yg belum
      // sempat tersimpan, atau ack utk pesan lama sebelum fitur ini ada).
      // Sekaligus ambil `direction` — dipakai untuk bedakan skenario A vs B.
      let ackedMessage = null;
      if (externalId) {
        try {
          ackedMessage = await prisma.message.findUnique({
            where: { externalId },
            select: { id: true, conversationId: true, ack: true, direction: true },
          });
          if (ackedMessage && ack > ackedMessage.ack) { // jangan mundur
            await prisma.message.update({ where: { id: ackedMessage.id }, data: { ack } });
            emitMessageAck(ackedMessage.conversationId, externalId, ack);
          }
        } catch (e) {
          console.warn("[webhook] message.ack: gagal update Message.ack:", e.message);
        }
      }

      // 2A) Skenario existing: ack utk pesan OUTBOUND kita + read → customer
      // baca pesan kita → Conversation.isRead=true (TIDAK sentuh unreadCount).
      if (isReadAck && payload) {
        const sessionName = req.body.session || process.env.WAHA_SESSION || "default";
        // Ambil nomor dari chatId/from — pesan dari kita KE customer, jadi kita "fromMe"
        const rawJid = payload.chatId || payload.from || "";
        const phone  = await normalizePhoneNumber(rawJid, sessionName);
        if (phone) {
          const customer = await prisma.customer.findUnique({ where: { phone }, select: { id: true } });
          if (customer) {
            const conv = await prisma.conversation.findFirst({
              where: { customerId: customer.id, channel: "WHATSAPP" },
              orderBy: { lastMessageAt: "desc" },
              select: { id: true },
            });
            if (conv) {
              const updatedConv = await prisma.conversation.update({
                where: { id: conv.id },
                data: { isRead: true, readAt: new Date() },
              });
              emitConversationUpdate(updatedConv);
              console.log("[webhook] message.ack READ → isRead=true untuk conv:", conv.id, "phone:", phone);
            }
          }
        }
      }

      // 2B) BARU (fix Task 2) — ack READ untuk pesan INBOUND → sales baca di
      // HP, reset unreadCount supaya item ConversationList langsung dim tanpa
      // perlu buka CRM. emit conversation:update supaya frontend update live
      // tanpa refresh (Task 2d).
      if (isReadAck && ackedMessage?.direction === "INBOUND") {
        const updatedConv = await prisma.conversation.update({
          where: { id: ackedMessage.conversationId },
          data: { isRead: true, readAt: new Date(), unread: false, unreadCount: 0 },
        });
        emitConversationUpdate(updatedConv);
        console.log("[webhook] message.ack READ (INBOUND, dibaca di HP) → unreadCount=0 untuk conv:", ackedMessage.conversationId);
      }
      return;
    }

    // "message" = pesan MASUK saja di setup ini (GOWS + hook events yang
    // dipakai sekarang). "message.any" = SEMUA pesan (masuk & keluar) — ini
    // satu-satunya jalur yang membawa balasan sales dari HP langsung
    // (fromMe:true) sejak BUG FATAL (balasan HP tidak tersimpan di CRM)
    // ditemukan. Event ini bisa OVERLAP dengan "message" untuk pesan masuk —
    // idempotency check di bawah (by externalId) yang mencegah duplikat.
    if (event !== "message" && event !== "message.any") return;
    if (!payload) return;
    const isAnyEvent = event === "message.any";

    // TAHAP C — Idempotency check PERTAMA, sebelum proses apapun.
    // Cegah duplikat dari: webhook retry WAHA, double delivery, overlap
    // "message"/"message.any" untuk pesan yang sama, atau fromMe dari HP
    // admin yang bersamaan dengan CRM kirim pesan (externalId sama).
    const externalId = payload.id;
    if (!externalId) return;
    const existing = await prisma.message.findUnique({ where: { externalId } });
    if (existing) {
      console.log("[webhook] Duplikat dibuang (externalId sudah ada):", externalId);
      if (isAnyEvent) console.log(`[webhook][any] fromMe=${!!payload.fromMe} chat=${payload.chatId || payload._data?.Info?.Chat || "?"} resolved=- action=skip-dupe`);
      return;
    }

    // Deteksi engine & session yang mengirim webhook ini
    const engine      = detectEngine(req.body);
    const sessionName = req.body.session || process.env.WAHA_SESSION || "default";
    console.log(`[webhook] Engine: ${engine}, Session: ${sessionName}`);

    // ── Deteksi grup WhatsApp (@g.us) — SEBELUM extract phone individual ─────
    // chatId untuk pesan grup selalu berakhiran "@g.us" di semua engine WAHA.
    // Berlaku SAMA untuk message.any (grup gate + status@g.us drop tetap jalan).
    const chatJid = payload.chatId || payload._data?.Info?.Chat || "";

    // "status@g.us" = WhatsApp Status/broadcast, BUKAN grup sungguhan —
    // secara teknis JID-nya berakhiran "@g.us" juga jadi HARUS di-gate
    // eksplisit SEBELUM cek endsWith umum, supaya tidak nyasar kebuat jadi
    // Conversation type=GROUP palsu (lihat scripts/backfill-group-names.js
    // Fase 0 untuk cleanup data lama yang sudah terlanjur nyasar).
    if (chatJid === "status@g.us") {
      console.log("[webhook] Pesan status@g.us (WhatsApp Status broadcast) — bukan grup, dilewati.");
      if (isAnyEvent) console.log(`[webhook][any] fromMe=${!!payload.fromMe} chat=${chatJid} resolved=- action=dropped-group`);
      return;
    }

    if (chatJid.endsWith("@g.us")) {
      await handleGroupMessage(payload, chatJid, externalId, sessionName);
      if (isAnyEvent) console.log(`[webhook][any] fromMe=${!!payload.fromMe} chat=${chatJid} resolved=group action=saved`);
      return;
    }

    // Normalisasi payload NOWEB/GOWS ke struktur yang sama (async — bisa resolve LID via API).
    // extractPhoneGows SUDAH benar pakai info.Chat (lawan bicara) saat
    // fromMe:true, BUKAN Sender (Sender = nomor kita sendiri utk fromMe) —
    // jadi `phone` di bawah ini otomatis identitas customer yang benar utk
    // kedua arah, tidak perlu logic tambahan.
    const msgData = await extractMessageData(payload, engine, sessionName);
    const { phone, fromMe, pushName, body: text, hasMedia, mediaInfo } = msgData;

    if (!phone) {
      const rawJid = payload.from || payload._data?.Info?.Sender || payload._data?.Info?.Chat || "";
      console.warn("[webhook] Tidak bisa extract nomor — disimpan ke UnresolvedMessage:", rawJid);
      await prisma.unresolvedMessage.create({
        data: {
          rawJid:      rawJid || "UNKNOWN",
          session:     sessionName,
          reason:      rawJid.includes("@lid") ? "LID_UNRESOLVABLE" : "INVALID_JID",
          payloadJson: JSON.stringify(payload).slice(0, 8000),
        },
      }).catch(e => console.warn("[webhook] Gagal simpan UnresolvedMessage:", e.message));
      if (isAnyEvent) console.log(`[webhook][any] fromMe=${fromMe} chat=${chatJid} resolved=- action=dropped-unresolved`);
      return;
    }

    if (fromMe) {
      // ack awal dari payload kalau ada (dual-engine: NOWEB payload.ack, GOWS _data.ack)
      const initialAck = payload.ack ?? payload._data?.ack ?? 0;
      // allowCreateCustomer HANYA true utk message.any — event "message" di
      // setup ini historically tidak pernah bawa fromMe, tapi kalau suatu
      // saat ada engine/config lain yang tetap kirim fromMe lewat "message",
      // perilaku lama (skip kalau customer belum ada) dipertahankan persis.
      const action = await handleOutboundFromPhone(payload, phone, text, externalId, sessionName, initialAck, { allowCreateCustomer: isAnyEvent });
      if (isAnyEvent) console.log(`[webhook][any] fromMe=true chat=${chatJid} resolved=${phone} action=${action}`);
      return;
    }

    // ── Pesan masuk dari customer (inbound) — event "message" ATAU
    // "message.any" dengan fromMe:false (idempotency di atas cegah dobel
    // proses kalau "message" sudah duluan simpan pesan yang sama) ─────────
    const action = await handleInboundMessage({ payload, phone, pushName, text, hasMedia, mediaInfo, externalId, sessionName });
    if (isAnyEvent) console.log(`[webhook][any] fromMe=false chat=${chatJid} resolved=${phone} action=${action}`);

  } catch (err) {
    console.error("Gagal proses webhook WAHA:", err);
  }
});

// Sinkronisasi riwayat chat dari WAHA untuk semua customer — dipanggil saat session CONNECTED
async function autoSyncHistory() {
  try {
    const convs = await prisma.conversation.findMany({
      where:    { channel: "WHATSAPP", type: "INDIVIDUAL" }, // skip grup
      include:  { customer: { select: { phone: true } } },
      orderBy:  { lastMessageAt: "desc" },
      distinct: ["customerId"],
    });
    console.log("[auto-sync] Mulai sync", convs.length, "percakapan...");
    for (const conv of convs) {
      const phone = conv.customer?.phone;
      if (!phone) continue;
      const messages = await fetchChatHistory(phone, 200);
      for (const msg of messages) {
        if (!msg.id) continue;
        try {
          await prisma.message.create({
            data: {
              conversationId: conv.id,
              direction:      msg.fromMe ? "OUTBOUND" : "INBOUND",
              content:        msg.body || "",
              externalId:     msg.id,
            },
          });
        } catch (e) {
          if (e.code !== "P2002") console.warn("[auto-sync] Gagal simpan pesan:", e.message);
          // P2002 = duplikat (sudah pernah disimpan), abaikan
        }
      }
    }
    console.log("[auto-sync] Selesai.");
  } catch (e) {
    console.error("[auto-sync] Error:", e.message);
  }
}
