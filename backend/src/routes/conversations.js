import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { sendText, sendMedia } from "../services/wahaClient.js";

export const conversationRouter = express.Router();
conversationRouter.use(requireAuth);

// Setup upload — simpan ke backend/uploads/
const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, "../../uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".bin";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 64 * 1024 * 1024 } }); // 64 MB

// Tentukan mediaType dari MIME
function mimeToMediaType(mime) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

// Jumlah percakapan belum dibaca (untuk badge sidebar)
// Harus di atas /:id agar Express tidak salah routing
conversationRouter.get("/unread-count", async (req, res) => {
  const count = await prisma.conversation.count({ where: { unread: true } });
  res.json({ count });
});

// Daftar percakapan
conversationRouter.get("/", async (req, res) => {
  const { status, search } = req.query;
  const where = status ? { status } : {};

  // Tambah filter search (nama/nomor pelanggan)
  if (search) {
    where.customer = {
      OR: [
        { name:  { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ],
    };
  }

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    include: {
      customer: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 100,
  });
  res.json(conversations);
});

// Riwayat pesan dalam satu percakapan
conversationRouter.get("/:id/messages", async (req, res) => {
  const messages = await prisma.message.findMany({
    where:   { conversationId: req.params.id },
    orderBy: { createdAt: "asc" },
  });
  res.json(messages);
});

// Kirim pesan teks
conversationRouter.post("/:id/messages", async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Pesan kosong" });

  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

  if (conversation.channel === "WHATSAPP") {
    if (!conversation.customer.phone)
      return res.status(400).json({ error: "Nomor WA pelanggan tidak tersedia" });
    try {
      await sendText(conversation.customer.phone, content);
    } catch (waErr) {
      console.error("[sendText gagal]", waErr.message);
      return res.status(502).json({ error: `Gagal kirim ke WhatsApp: ${waErr.message}` });
    }
  } else {
    return res.status(400).json({ error: "Channel ini belum didukung (Phase 2)" });
  }

  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "OUTBOUND", content },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data:  { lastMessageAt: new Date() },
  });
  res.status(201).json(message);
});

// Kirim media (foto / video / dokumen / suara)
conversationRouter.post("/:id/media", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "File tidak ada" });

  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

  const caption   = req.body.caption?.trim() || "";
  const mediaType = mimeToMediaType(file.mimetype);
  const mediaUrl  = `/uploads/${file.filename}`;

  if (conversation.channel === "WHATSAPP") {
    if (!conversation.customer.phone)
      return res.status(400).json({ error: "Nomor WA pelanggan tidak tersedia" });
    try {
      // Kirim URL ke WAHA (WAHA fetch file sendiri — jauh lebih andal untuk video/dokumen besar)
      const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL || "http://backend:4000";
      const fileUrl = `${BACKEND_INTERNAL_URL}/uploads/${file.filename}`;
      await sendMedia(
        conversation.customer.phone,
        { mimetype: file.mimetype, filename: file.originalname, url: fileUrl },
        caption
      );
    } catch (waErr) {
      console.error("[sendMedia gagal]", waErr.message);
      return res.status(502).json({ error: `Gagal kirim media: ${waErr.message}` });
    }
  } else {
    return res.status(400).json({ error: "Channel ini belum didukung (Phase 2)" });
  }

  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "OUTBOUND", content: caption, mediaType, mediaUrl },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data:  { lastMessageAt: new Date() },
  });
  res.status(201).json(message);
});

// Update status / unread percakapan
conversationRouter.patch("/:id", async (req, res) => {
  const { status, assignedToId, unread } = req.body;
  const data = {};
  if (status)                  data.status       = status;
  if (assignedToId !== undefined) data.assignedToId = assignedToId;
  if (unread !== undefined)    data.unread       = unread;
  const conversation = await prisma.conversation.update({
    where: { id: req.params.id },
    data,
  });
  res.json(conversation);
});
