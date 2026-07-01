import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { cleanPhoneNumber, downloadMediaMessage, downloadMediaFromUrl } from "../services/wahaClient.js";

export const webhookRouter = express.Router();

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir  = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// WEBJS/NOWEB kadang mengirim from = "xxx@lid" (Local ID, bukan nomor telepon asli).
// Indikator: suffix "@lid" pada field from. Nomor asli ada di remoteJidAlt.
function extractPhone(payload) {
  const from = payload.from || "";
  if (from.includes("@lid")) {
    // Coba beberapa path — WAHA versi berbeda bisa beda struktur payload
    const realJid =
      payload._data?.key?.remoteJidAlt ||
      payload._data?.remoteJidAlt       ||
      payload.remoteJidAlt;
    if (realJid) {
      console.log("[webhook] @lid terdeteksi → pakai remoteJidAlt:", realJid);
      return cleanPhoneNumber(realJid);
    }
    console.warn("[webhook] @lid tanpa remoteJidAlt, pesan dibuang. from:", from);
    return null;
  }
  return cleanPhoneNumber(from);
}

// Tentukan mediaType dari MIME type
function mimeToMediaType(mime) {
  if (!mime) return "document";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
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
    "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
    "image/webp": ".webp", "video/mp4": ".mp4", "video/webm": ".webm",
    "audio/ogg": ".ogg", "audio/webm": ".webm", "audio/mpeg": ".mp3",
    "application/pdf": ".pdf",
  };
  return map[mime] || ".bin";
}

webhookRouter.post("/waha", async (req, res) => {
  res.sendStatus(200); // Balas cepat supaya WAHA tidak retry

  try {
    const { event, payload } = req.body;
    console.log("[WAHA webhook]", event, JSON.stringify(payload));

    if (event !== "message") return;
    if (!payload || payload.fromMe) return;

    const externalId = payload.id;
    if (!externalId || !payload.from) return;

    // Dedupe
    const existing = await prisma.message.findUnique({ where: { externalId } });
    if (existing) return;

    // Ekstrak nomor asli — handle @lid dari NOWEB
    const phone = extractPhone(payload);
    if (!phone) {
      console.warn("[webhook] Tidak bisa extract nomor, pesan diabaikan:", JSON.stringify(payload).slice(0, 300));
      return;
    }

    const pushName = payload._data?.pushName || null;
    const text     = payload.body || "";
    const hasMedia = !!payload.hasMedia;
    const mediaInfo = payload.media || null; // { url, mimetype, filename }

    // ── Deteksi sumber lead (3 lapis) — hanya untuk customer BARU ────────────
    // Cek apakah customer sudah ada
    const existingCustomer = await prisma.customer.findUnique({ where: { phone } });
    let detectedSource = "WHATSAPP_DIRECT";
    let detectedDetail = null;
    let pendingClickId = null;

    if (!existingCustomer) {
      // Lapis 1: cek referral data Meta Ads di payload mentah
      // NOWEB kemungkinan tidak expose referral data — catat di log untuk diagnostik
      const rawData = payload._data || {};
      const ctwa = rawData.ctwaContext || rawData.contextInfo?.referral || rawData.conversionSource;
      if (ctwa) {
        detectedSource = "META_ADS";
        detectedDetail = ctwa.sourceUrl || ctwa.headline || JSON.stringify(ctwa).slice(0, 200);
        console.log("[attribution] Lapis 1 META_ADS:", detectedDetail);
      } else {
        console.log("[attribution] Lapis 1 tidak kena — NOWEB mungkin tidak expose ctwaContext/referral");
      }

      // Lapis 2: cari ClickEvent terbaru (15 menit) yang belum ter-match
      if (!detectedSource || detectedSource === "WHATSAPP_DIRECT") {
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

      // Lapis 3: default sudah diset di atas (WHATSAPP_DIRECT)
    }

    // Upsert customer
    const customer = await prisma.customer.upsert({
      where:  { phone },
      update: {},
      create: {
        phone,
        name:               pushName || null,
        leadSource:         detectedSource,
        leadSourceDetail:   detectedDetail,
        leadSourceConfirmed: false,
      },
    });

    // Jika Lapis 2 berhasil, tandai klik sudah dicocokkan
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
      const mime = mediaInfo?.mimetype || payload._data?.mimetype || "";
      mediaType = mimeToMediaType(mime);

      console.log("[webhook] Ada media, mime:", mime, "mediaInfo:", JSON.stringify(mediaInfo));

      const downloaded = await downloadWithRetry(mediaInfo, externalId);

      if (downloaded?.data) {
        const finalMime = downloaded.mimetype || mime;
        const ext      = extFromMime(finalMime);
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(downloaded.data, "base64"));
        mediaUrl = `/uploads/${filename}`;
        console.log("[webhook] Media disimpan:", mediaUrl);
      } else {
        console.warn("[webhook] Tidak bisa download media untuk id:", externalId);
      }
    }

    // Simpan pesan
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

    // Tandai unread = true supaya badge di sidebar bertambah
    await prisma.conversation.update({
      where: { id: conversation.id },
      data:  { lastMessageAt: new Date(), status: "OPEN", unread: true },
    });

  } catch (err) {
    console.error("Gagal proses webhook WAHA:", err);
  }
});
