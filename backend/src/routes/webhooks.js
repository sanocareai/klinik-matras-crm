import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { cleanPhoneNumber, downloadMediaMessage, downloadMediaFromUrl, getProfilePicture, fetchChatHistory, resolvePhoneFromLid } from "../services/wahaClient.js";
import { broadcast } from "./sse.js";

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
// NOWEB: payload.from bisa "@lid" — nomor asli ada di _data.key.remoteJidAlt.
// fromMe: nomor customer ada di chatId (payload.from = nomor admin sendiri).
function extractPhoneNoweb(payload) {
  if (payload.fromMe) {
    return cleanPhoneNumber(payload.chatId || "");
  }
  const from = payload.from || "";
  if (from.includes("@lid")) {
    const realJid =
      payload._data?.key?.remoteJidAlt ||
      payload._data?.remoteJidAlt       ||
      payload.remoteJidAlt;
    if (realJid) {
      console.log("[webhook] NOWEB @lid → pakai remoteJidAlt:", realJid);
      return cleanPhoneNumber(realJid);
    }
    console.warn("[webhook] NOWEB @lid tanpa remoteJidAlt, pesan dibuang. from:", from);
    return null;
  }
  return cleanPhoneNumber(from);
}

// ── Parser GOWS ──────────────────────────────────────────────────────────────
// GOWS: struktur bersarang di _data.Info dengan field:
//   Chat        = JID percakapan (customer untuk 1:1)
//   Sender      = JID pengirim (bisa @lid)
//   SenderAlt   = nomor asli pengirim (sering null — privacy WhatsApp)
//   RecipientAlt= nomor asli penerima (sering null)
// Kalau semua null/LID: resolve via WAHA API + cache (resolvePhoneFromLid).
async function extractPhoneGows(payload, sessionName) {
  const info   = payload._data?.Info || {};
  const fromMe = !!payload.fromMe;

  let primaryJid, altJid;
  if (fromMe) {
    // Admin yang kirim: customer adalah penerima — ada di Chat/RecipientAlt
    primaryJid = info.Chat           || "";
    altJid     = info.RecipientAlt   || "";
  } else {
    // Customer yang kirim: ada di Sender/SenderAlt; Chat sebagai fallback
    primaryJid = info.Sender || info.Chat || payload.from || "";
    altJid     = info.SenderAlt || "";
  }

  // AltJid berisi nomor asli kalau tersedia (bukan @lid)
  if (altJid && !altJid.includes("@lid") && altJid.includes("@")) {
    return cleanPhoneNumber(altJid);
  }

  // primaryJid bukan LID → bersihkan langsung
  if (primaryJid && !primaryJid.includes("@lid")) {
    const phone = cleanPhoneNumber(primaryJid);
    if (phone) return phone;
  }

  // primaryJid adalah LID → resolve via WAHA API (dengan cache)
  if (primaryJid) {
    const lidPart = primaryJid.split("@")[0];
    return await resolvePhoneFromLid(lidPart, sessionName);
  }

  return null;
}

// ── Normalisasi payload NOWEB/GOWS ke struktur internal yang sama ─────────────
// Async karena extractPhoneGows bisa panggil WAHA API untuk resolve LID.
async function extractMessageData(payload, engine, sessionName) {
  let phone;
  if (engine === "GOWS") {
    phone = await extractPhoneGows(payload, sessionName);
  } else {
    phone = extractPhoneNoweb(payload);
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

webhookRouter.post("/waha", async (req, res) => {
  res.sendStatus(200); // Balas cepat supaya WAHA tidak retry

  try {
    const { event, payload } = req.body;
    console.log("[WAHA webhook]", event, JSON.stringify(payload));

    // Handle event status sesi — WAHA kirim ini saat WA connect/disconnect
    if (event === "session.status") {
      if (payload?.status === "WORKING") {
        console.log("[webhook] WAHA session CONNECTED — mulai auto-sync riwayat di background");
        setImmediate(autoSyncHistory);
      }
      return;
    }

    if (event !== "message") return;
    if (!payload) return;

    // TAHAP C — Idempotency check PERTAMA, sebelum proses apapun.
    // Cegah duplikat dari: webhook retry WAHA, double delivery, atau
    // fromMe dari HP admin yang bersamaan dengan CRM kirim pesan (externalId sama).
    const externalId = payload.id;
    if (!externalId) return;
    const existing = await prisma.message.findUnique({ where: { externalId } });
    if (existing) {
      console.log("[webhook] Duplikat dibuang (externalId sudah ada):", externalId);
      return;
    }

    // Deteksi engine & session yang mengirim webhook ini
    const engine      = detectEngine(req.body);
    const sessionName = req.body.session || process.env.WAHA_SESSION || "default";
    console.log(`[webhook] Engine: ${engine}, Session: ${sessionName}`);

    // Normalisasi payload NOWEB/GOWS ke struktur yang sama (async — bisa resolve LID via API)
    const msgData = await extractMessageData(payload, engine, sessionName);
    const { phone, fromMe, pushName, body: text, hasMedia, mediaInfo } = msgData;

    if (!phone) {
      console.warn("[webhook] Tidak bisa extract nomor, pesan diabaikan:", JSON.stringify(payload).slice(0, 300));
      return;
    }

    // ── Pesan outbound dari HP admin sendiri (bukan lewat CRM) ───────────────
    // Simpan sebagai OUTBOUND, JANGAN buat customer baru dari pesan keluar admin.
    if (fromMe) {
      const customer = await prisma.customer.findUnique({ where: { phone } });
      if (!customer) {
        console.log("[webhook] fromMe: customer belum ada di DB, dilewati:", phone);
        return;
      }

      const conversation = await prisma.conversation.findFirst({
        where: { customerId: customer.id, channel: "WHATSAPP", status: { not: "RESOLVED" } },
        orderBy: { lastMessageAt: "desc" },
      });
      if (!conversation) return;

      try {
        await prisma.message.create({
          data: { conversationId: conversation.id, direction: "OUTBOUND",
                  content: text, externalId },
        });
      } catch (e) {
        if (e.code !== "P2002") throw e;
        return; // race condition — sudah disimpan concurrent request
      }
      await prisma.conversation.update({
        where: { id: conversation.id },
        data:  { lastMessageAt: new Date() },
      });
      broadcast("new_message", { conversationId: conversation.id, customerId: customer.id });
      return;
    }

    // ── Pesan masuk dari customer (inbound) ───────────────────────────────────

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
    try {
      await prisma.message.create({
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
      return;
    }

    // Tandai unread = true supaya badge di sidebar bertambah
    await prisma.conversation.update({
      where: { id: conversation.id },
      data:  { lastMessageAt: new Date(), status: "OPEN", unread: true },
    });

    broadcast("new_message", { conversationId: conversation.id, customerId: customer.id });

  } catch (err) {
    console.error("Gagal proses webhook WAHA:", err);
  }
});

// Sinkronisasi riwayat chat dari WAHA untuk semua customer — dipanggil saat session CONNECTED
async function autoSyncHistory() {
  try {
    const convs = await prisma.conversation.findMany({
      where:    { channel: "WHATSAPP" },
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
