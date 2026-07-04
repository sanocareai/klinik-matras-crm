import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { sendText, sendMedia } from "../services/wahaClient.js";

const execAsync = promisify(exec);

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

// Polling lengkap: unread count + pesan terbaru (untuk toast in-app)
// since = ISO timestamp — hanya kembalikan pesan setelah waktu ini
conversationRouter.get("/latest-unread", async (req, res) => {
  const count = await prisma.conversation.count({ where: { unread: true } });

  const sinceParam = req.query.since;
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 15000);

  const latestMsg = await prisma.message.findFirst({
    where: {
      direction:  "INBOUND",
      createdAt:  { gt: since },
    },
    orderBy: { createdAt: "desc" },
    include: {
      conversation: { include: { customer: true } },
    },
  });

  let latest = null;
  if (latestMsg) {
    const cust = latestMsg.conversation?.customer;
    latest = {
      conversationId: latestMsg.conversationId,
      customerName:   cust?.name || cust?.phone || "Pelanggan",
      preview:        latestMsg.content
        ? latestMsg.content.slice(0, 60)
        : latestMsg.mediaType ? `[${latestMsg.mediaType}]` : "",
      createdAt: latestMsg.createdAt,
    };
  }

  res.json({ count, latest });
});

// Daftar percakapan
conversationRouter.get("/", async (req, res) => {
  const { status, search } = req.query;
  const where = status ? { status } : {};

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
      assignedTo: { select: { id: true, name: true } },
    },
    take: 100,
  });

  const now = Date.now();
  const result = conversations.map(({ messages, ...conv }) => {
    const lastMsg          = messages[0] || null;
    const isUnanswered     = lastMsg?.direction === "INBOUND";
    const unansweredMinutes = isUnanswered
      ? Math.floor((now - new Date(lastMsg.createdAt).getTime()) / 60000)
      : null;
    const canTakeOver = !conv.assignedToId || (isUnanswered && (unansweredMinutes ?? 0) >= 60);
    return { ...conv, messages, isUnanswered, unansweredMinutes, canTakeOver };
  });

  res.json(result);
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

  // Auto-assign lead ke sales yang pertama kali balas
  if (req.user.role === "SALES" && !conversation.assignedToId) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data:  { assignedToId: req.user.id },
    });
    if (!conversation.customer.assignedSalesId) {
      await prisma.customer.update({
        where: { id: conversation.customerId },
        data:  { assignedSalesId: req.user.id },
      });
    }
  }

  res.status(201).json(message);
});

// Kirim media (foto / video / dokumen / suara)
conversationRouter.post("/:id/media", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "File tidak ada" });

  console.log(`[media] Request masuk: ${file.originalname} (${file.mimetype}, ${file.size} bytes)`);

  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

  const caption   = req.body.caption?.trim() || "";
  let   sendAs    = req.body.sendAs || "media"; // "media" (inline) | "document" (attachment)
  const mediaType = mimeToMediaType(file.mimetype);
  let   mediaUrl  = `/uploads/${file.filename}`;

  const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL || "http://backend:4000";
  let wahaFileMime = file.mimetype;
  let wahaFileUrl  = `${BACKEND_INTERNAL_URL}/uploads/${file.filename}`;
  let wahaFileName = file.originalname;

  // Audio selain webm/ogg (MP3, AAC, dll) tidak bisa jadi voice note di WA — kirim sebagai file
  if (file.mimetype.startsWith("audio/") &&
      !file.mimetype.startsWith("audio/webm") &&
      !file.mimetype.startsWith("audio/ogg")) {
    sendAs = "document";
    console.log("[media] Audio format non-OGG/webm, kirim sebagai dokumen:", file.mimetype);
  }

  // WhatsApp hanya bisa memutar voice note dalam format audio/ogg (codec Opus).
  // Browser merekam dalam audio/webm;codecs=opus → perlu konversi container ke OGG via FFmpeg.
  if (file.mimetype.startsWith("audio/webm")) {
    const baseName    = file.filename.replace(/\.[^.]+$/, "");
    const oggFilename = `${baseName}.ogg`;
    const oggPath     = path.join(uploadsDir, oggFilename);
    try {
      await execAsync(`ffmpeg -y -i "${file.path}" -vn -c:a libopus -f ogg "${oggPath}"`);
      wahaFileMime = "audio/ogg";
      wahaFileUrl  = `${BACKEND_INTERNAL_URL}/uploads/${oggFilename}`;
      wahaFileName = oggFilename; // pakai nama file OGG, bukan .webm asli
      mediaUrl     = `/uploads/${oggFilename}`;
      fs.unlink(file.path, () => {}); // hapus webm lama
      console.log("[media] Audio dikonversi webm→ogg:", oggFilename);
    } catch (convErr) {
      console.warn("[media] Konversi webm→ogg gagal:", convErr.message);
      // Fallback: kirim webm, WhatsApp mungkin tidak bisa memutar sebagai voice note
    }
  }

  if (conversation.channel === "WHATSAPP") {
    if (!conversation.customer.phone)
      return res.status(400).json({ error: "Nomor WA pelanggan tidak tersedia" });
    try {
      console.log(`[media] Kirim ke WAHA → ${wahaFileUrl} (mime=${wahaFileMime}, sendAs=${sendAs}, filename=${wahaFileName})`);
      const waResult = await sendMedia(
        conversation.customer.phone,
        { mimetype: wahaFileMime, filename: wahaFileName, url: wahaFileUrl },
        caption,
        sendAs
      );
      console.log("[media] WAHA berhasil:", JSON.stringify(waResult).slice(0, 200));
    } catch (waErr) {
      console.error("[media] WAHA gagal:", waErr.message);
      // Hapus file yang sudah tersimpan karena gagal kirim
      fs.unlink(file.path, () => {});
      return res.status(502).json({ error: `Gagal kirim ke WhatsApp: ${waErr.message}` });
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
  console.log(`[media] Selesai, pesan tersimpan id=${message.id}`);
  res.status(201).json(message);
});

// Kirim produk dari galeri ke customer (gambar berurutan dengan delay)
conversationRouter.post("/:id/send-product", async (req, res) => {
  const { productId, imageIds, includePrice } = req.body;
  if (!productId) return res.status(400).json({ error: "productId wajib diisi" });

  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });
  if (!conversation.customer.phone)
    return res.status(400).json({ error: "Nomor WA pelanggan tidak tersedia" });

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });
  if (!product) return res.status(404).json({ error: "Produk tidak ditemukan" });

  // Filter gambar yang dipilih (jika imageIds ada), jaga urutan
  const selectedImages = (imageIds?.length > 0)
    ? product.images.filter((img) => imageIds.includes(img.id))
    : product.images;
  if (!selectedImages.length) return res.status(400).json({ error: "Tidak ada gambar dipilih" });

  // Format caption untuk gambar terakhir
  function formatCaption() {
    let text = `*${product.name}*`;
    if (product.description) text += `\n${product.description}`;
    if (includePrice && product.price) {
      const harga = `Rp${product.price.toLocaleString("id-ID")}`;
      text += `\n\n💰 ${product.priceUnit ? `${product.priceUnit} ` : ""}${harga}`;
    }
    return text;
  }

  const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL || "http://backend:4000";
  const savedMessages = [];

  for (let i = 0; i < selectedImages.length; i++) {
    const img      = selectedImages[i];
    const isLast   = i === selectedImages.length - 1;
    const caption  = isLast ? formatCaption() : "";
    const fileUrl  = `${BACKEND_INTERNAL_URL}${img.url}`;

    try {
      await sendMedia(
        conversation.customer.phone,
        { mimetype: "image/jpeg", filename: img.url.split("/").pop(), url: fileUrl },
        caption,
        "media"
      );
      const msg = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: "OUTBOUND",
          content: caption,
          mediaType: "image",
          mediaUrl: img.url,
        },
      });
      savedMessages.push(msg);
    } catch (err) {
      console.error(`[send-product] Gagal kirim gambar ${img.id}:`, err.message);
    }

    // Delay antar gambar (kecuali setelah yang terakhir)
    if (i < selectedImages.length - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  await prisma.conversation.update({
    where: { id: conversation.id },
    data:  { lastMessageAt: new Date() },
  });

  res.json({ sent: savedMessages.length, messages: savedMessages });
});

// Ambil alih (handover) percakapan ke user yang request
conversationRouter.post("/:id/takeover", async (req, res) => {
  try {
    const conv = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!conv) return res.status(404).json({ error: "Percakapan tidak ditemukan" });
    if (conv.assignedToId === req.user.id)
      return res.status(400).json({ error: "Percakapan ini sudah jadi lead kamu" });

    const isAdmin          = req.user.role === "ADMIN";
    const lastMsg          = conv.messages[0] || null;
    const isUnanswered     = lastMsg?.direction === "INBOUND";
    const unansweredMinutes = isUnanswered
      ? Math.floor((Date.now() - new Date(lastMsg.createdAt).getTime()) / 60000)
      : null;
    const canTakeOver = !conv.assignedToId || (isUnanswered && (unansweredMinutes ?? 0) >= 60);

    if (!isAdmin && !canTakeOver) {
      return res.status(403).json({
        error: "Percakapan ini masih ditangani sales lain, belum lewat 1 jam",
      });
    }

    const oldAssignedId = conv.assignedToId;
    let prevName = null;
    if (oldAssignedId && oldAssignedId !== req.user.id) {
      const oldUser = await prisma.user.findUnique({
        where: { id: oldAssignedId }, select: { name: true },
      });
      prevName = oldUser?.name || null;
    }

    // Bangun handoverNote untuk Context Banner di inbox
    const handoverNote = prevName
      ? `Percakapan diambil alih dari ${prevName} oleh ${req.user.name}. Cek riwayat chat di atas untuk konteks sebelumnya.`
      : `Percakapan diambil oleh ${req.user.name}.`;

    // Reassign conversation + customer
    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data:  { assignedToId: req.user.id, handoverNote },
      include: {
        customer: true,
        assignedTo: { select: { id: true, name: true } },
      },
    });
    await prisma.customer.update({
      where: { id: conv.customerId },
      data:  { assignedSalesId: req.user.id },
    });

    // Catat di notes siapa yang ambil alih
    let noteContent;
    if (prevName) {
      noteContent = `🔄 Lead diambil alih dari ${prevName} oleh ${req.user.name}`;
    } else {
      noteContent = `✅ ${req.user.name} mengambil lead ini`;
    }
    await prisma.note.create({
      data: { customerId: conv.customerId, authorId: req.user.id, content: noteContent },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update status / unread percakapan
conversationRouter.patch("/:id", async (req, res) => {
  const { status, assignedToId, unread, handoverNote } = req.body;
  const data = {};
  if (status)                     data.status       = status;
  if (assignedToId !== undefined) data.assignedToId = assignedToId;
  if (unread !== undefined)       data.unread       = unread;
  if (handoverNote !== undefined) data.handoverNote = handoverNote;
  const conversation = await prisma.conversation.update({
    where: { id: req.params.id },
    data,
  });
  res.json(conversation);
});
