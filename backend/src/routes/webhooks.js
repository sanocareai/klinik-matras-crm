import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { cleanPhoneNumber, downloadMediaMessage } from "../services/wahaClient.js";

export const webhookRouter = express.Router();

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir  = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// NOWEB kadang mengirim from = "@lid" (Local ID) bukan nomor telepon asli.
// Jika mode "lid" aktif, nomor asli ada di _data.key.remoteJidAlt (@s.whatsapp.net).
function extractPhone(payload) {
  if (
    payload._data?.key?.addressingMode === "lid" &&
    payload._data?.key?.remoteJidAlt
  ) {
    return cleanPhoneNumber(payload._data.key.remoteJidAlt);
  }
  return cleanPhoneNumber(payload.from);
}

// Tentukan mediaType dari MIME type
function mimeToMediaType(mime) {
  if (!mime) return "document";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
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

    // Upsert customer
    const customer = await prisma.customer.upsert({
      where:  { phone },
      update: {},
      create: { phone, leadSource: "WHATSAPP_DIRECT", name: pushName || null },
    });

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
      const mime = mediaInfo?.mimetype || "";
      mediaType = mimeToMediaType(mime);

      // Coba download dari WAHA
      const downloaded = await downloadMediaMessage(externalId);
      if (downloaded?.data) {
        const ext      = extFromMime(downloaded.mimetype || mime);
        const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(downloaded.data, "base64"));
        mediaUrl = `/uploads/${filename}`;
      } else if (mediaInfo?.url) {
        // Fallback: simpan URL WAHA langsung (mungkin tidak bisa diakses browser)
        mediaUrl = mediaInfo.url;
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

    await prisma.conversation.update({
      where: { id: conversation.id },
      data:  { lastMessageAt: new Date(), status: "OPEN" },
    });

  } catch (err) {
    console.error("Gagal proses webhook WAHA:", err);
  }
});
