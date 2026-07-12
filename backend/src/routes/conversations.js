import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { sendText, sendMedia, editMessage, markChatAsRead, fetchChatHistory, downloadMediaMessage, KNOWN_SESSIONS } from "../services/wahaClient.js";
import { buildMessagePreview } from "../utils/messagePreview.js";
import { parseHistoryMessage } from "../utils/parseHistoryMessage.js";
import { emitNewMessage, emitConversationUpdate, emitMessageUpdate } from "../socket.js";

// Debounce read receipt ke WAHA — jangan panggil API tiap kali frontend re-render.
// Key: conversationId, Value: timestamp terakhir kirim read receipt ke WAHA.
const readReceiptSentAt = new Map();
const READ_RECEIPT_COOLDOWN_MS = 30_000; // 30 detik

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

// Ekstensi file dari MIME type — dipakai POST /:id/messages/:messageId/load-media
function extFromMime(mime) {
  const map = {
    "image/jpeg": ".jpg",  "image/png": ".png",   "image/gif": ".gif",
    "image/webp": ".webp", "video/mp4": ".mp4",   "video/webm": ".webm",
    "audio/ogg":  ".ogg",  "audio/opus": ".ogg",  "audio/webm": ".webm",
    "audio/mpeg": ".mp3",  "audio/mp4": ".m4a",   "audio/aac": ".aac",
    "application/pdf": ".pdf",
  };
  return map[(mime || "").split(";")[0].trim().toLowerCase()] || ".bin";
}

// BUG KRITIS (produksi) — sebelumnya sendText/sendMedia/markChatAsRead diam-diam
// pakai WAHA_SESSION (env global), sehingga balasan CRM bisa keluar dari nomor
// CS yang SALAH (customer chat masuk ke CS-1, balasan malah lewat CS-2).
// Sekarang WAJIB pakai conversation.sessionId — field ini di-set otomatis dari
// nama session webhook di setiap pesan masuk/keluar-dari-HP-admin (lihat
// webhooks.js baris ~229, ~397, ~559 — sudah diverifikasi selalu terisi untuk
// conversation yang sudah pernah menerima event webhook).
//
// sessionId BISA null untuk 2 kasus lama yang belum ter-backfill:
//  1. Conversation dibuat lewat sync-history (settings.js) — proses itu tidak
//     lewat webhook sama sekali, jadi sessionId tidak pernah ke-set.
//  2. Conversation sangat lama dari sebelum field sessionId ada (Fase F).
// Message model TIDAK punya field session sendiri (cek schema.prisma) — jadi
// tidak ada sumber lain untuk "menebak" sesi selain conversation.sessionId itu
// sendiri. Kalau null, JANGAN diam-diam pakai default — tolak dengan pesan
// jelas, sales/admin perbaiki manual lewat PATCH /:id/session (dropdown di
// header chat, lihat ChatWindow/index.jsx).
function resolveSendSession(conversation) {
  return conversation.sessionId || null;
}

const SESSION_UNKNOWN_ERROR = "Sesi WA percakapan ini belum diketahui — buka menu dan pilih sesi";

// Dilempar sendWithSessionFallback() kalau conversation.sessionId null DAN
// semua KNOWN_SESSIONS gagal — caller HARUS tangkap ini terpisah dari error
// WAHA biasa supaya balikin 409 (munculkan pilihan manual "Pilih sesi..."),
// bukan 502 (yang berarti sesi sudah benar tapi WAHA-nya yang bermasalah).
class SessionResolutionError extends Error {}

// Self-healing session resolver — dipakai semua endpoint kirim (messages,
// media, send-product, forward). Kalau conversation.sessionId SUDAH ada,
// pakai itu saja (tidak coba sesi lain — kalau WAHA gagal di sini itu
// masalah lain, bukan salah sesi, jadi TIDAK boleh diam-diam coba sesi lain
// dan berisiko kirim dobel/ke nomor salah). Kalau sessionId NULL, coba tiap
// KNOWN_SESSIONS berurutan (CS-1 dulu, lalu CS-2) sampai salah satu
// berhasil — begitu berhasil, SIMPAN sessionId itu ke conversation supaya
// tidak perlu tanya/coba-coba lagi lain kali (self-healing permanen).
// sendFn menerima 1 argumen: nama session yang sedang dicoba.
async function sendWithSessionFallback(conversation, sendFn) {
  if (conversation.sessionId) {
    const result = await sendFn(conversation.sessionId);
    return { result, session: conversation.sessionId };
  }

  let lastErr = null;
  for (const session of KNOWN_SESSIONS) {
    try {
      const result = await sendFn(session);
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { sessionId: session },
      }).catch((e) => {
        console.warn(`[sendWithSessionFallback] Gagal simpan sessionId ke DB untuk conversation ${conversation.id}:`, e.message);
      });
      console.log(`[sendWithSessionFallback] conversation ${conversation.id} self-healed → sessionId=${session}`);
      return { result, session };
    } catch (e) {
      lastErr = e;
      console.warn(`[sendWithSessionFallback] Gagal kirim via ${session} untuk conversation ${conversation.id}:`, e.message);
    }
  }
  throw new SessionResolutionError(lastErr?.message || SESSION_UNKNOWN_ERROR);
}

// Task 3 — grup WA sekarang bisa dibalas dari CRM (sebelumnya diblok,
// commit 1a210d2/1ba6a23). Tujuan kirim beda tergantung type: INDIVIDUAL
// pakai nomor customer, GROUP pakai groupJid (sudah format "xxx@g.us",
// wahaClient.js#sendText/sendMedia sudah handle string yang sudah punya "@"
// tanpa nambah "@c.us" lagi — tidak perlu ubah wahaClient.js).
function resolveSendTarget(conversation) {
  if (conversation.type === "GROUP") return conversation.groupJid || null;
  return conversation.customer?.phone || null;
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

// Jumlah percakapan per tab filter Inbox (Semua/Terbuka/Pending/Selesai/Milik Saya)
// Harus di atas /:id agar Express tidak salah routing
conversationRouter.get("/counts", async (req, res) => {
  const [semua, terbuka, pending, selesai, milikSaya, belumDibaca] = await Promise.all([
    prisma.conversation.count(),
    prisma.conversation.count({ where: { status: "OPEN" } }),
    prisma.conversation.count({ where: { status: "PENDING" } }),
    prisma.conversation.count({ where: { status: "RESOLVED" } }),
    prisma.conversation.count({ where: { assignedToId: req.user.id } }),
    prisma.conversation.count({ where: { unread: true } }),
  ]);
  res.json({ semua, terbuka, pending, selesai, milikSaya, belumDibaca });
});

// Daftar percakapan — cursor pagination (cursor = id percakapan terakhir dari
// halaman sebelumnya, limit default 100 kalau tidak dikirim supaya caller lama
// yang belum paginate — refresh penuh setelah SSE, dsb — tetap dapat batch besar
// seperti perilaku lama). Response SEKARANG {data, nextCursor}, bukan array
// mentah lagi — frontend (api.js/useConversations.js) sudah disesuaikan.
conversationRouter.get("/", async (req, res) => {
  const { status, search, assignedToId, cursor, unread } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
  const where = {};
  if (status)       where.status       = status;
  if (assignedToId) where.assignedToId = assignedToId;
  // ?unread=true — dipakai chip "Belum Dibaca" di Inbox mobile (lihat
  // mobile/src/screens/ChatListScreen.js). Sama persis definisi yang
  // dipakai badge unread-count di bawah (unread=true), bukan hitungan baru.
  if (unread === "true") where.unread = true;

  if (search) {
    // Cari di customer (individual) DAN di groupName (grup)
    where.OR = [
      { customer: { OR: [
        { name:  { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ]}},
      { groupName: { contains: search, mode: "insensitive" } },
    ];
  }

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: [
      { pinned: "desc" },                               // percakapan yang disematkan muncul di atas
      { pinnedAt: { sort: "desc", nulls: "last" } },   // di antara yang disematkan, terbaru dulu
      { lastMessageAt: "desc" },
    ],
    include: {
      customer: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      assignedTo: { select: { id: true, name: true, avatarUrl: true } },
    },
    take: limit + 1, // ambil 1 ekstra buat tahu masih ada halaman berikutnya atau tidak
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = conversations.length > limit;
  const page    = hasMore ? conversations.slice(0, limit) : conversations;

  const now = Date.now();
  const result = page.map(({ messages, ...conv }) => {
    const lastMsg          = messages[0] || null;
    const isUnanswered     = lastMsg?.direction === "INBOUND";
    const unansweredMinutes = isUnanswered
      ? Math.floor((now - new Date(lastMsg.createdAt).getTime()) / 60000)
      : null;
    const canTakeOver = !conv.assignedToId || (isUnanswered && (unansweredMinutes ?? 0) >= 60);
    return { ...conv, messages, isUnanswered, unansweredMinutes, canTakeOver };
  });

  res.json({ data: result, nextCursor: hasMore ? page[page.length - 1].id : null });
});

// Riwayat pesan dalam satu percakapan
// Side effect: tandai percakapan sebagai "sudah dibuka" (isRead=true, unread=false)
// + kirim read receipt ke WhatsApp dengan debounce 30 detik
conversationRouter.get("/:id/messages", async (req, res) => {
  const convId = req.params.id;
  const messages = await prisma.message.findMany({
    where:   { conversationId: convId },
    orderBy: { createdAt: "asc" },
    include: {
      replyTo: {
        select: { id: true, content: true, direction: true, mediaType: true, isRevoked: true },
      },
    },
  });
  res.json(messages);

  // Mark as read — jalankan setelah response dikirim (tidak blokir respons)
  setImmediate(async () => {
    try {
      const conv = await prisma.conversation.findUnique({
        where:   { id: convId },
        include: { customer: { select: { phone: true } } },
      });
      if (!conv) return;

      // Update DB: isRead=true, unread=false, unreadCount=0
      if (!conv.isRead || conv.unread || conv.unreadCount > 0) {
        const updated = await prisma.conversation.update({
          where: { id: convId },
          data:  { isRead: true, readAt: new Date(), unread: false, unreadCount: 0 },
        });
        emitConversationUpdate(updated);
      }

      // Kirim read receipt ke WAHA (dengan debounce 30 detik per conversation)
      if (conv.channel === "WHATSAPP" && conv.customer?.phone) {
        const now      = Date.now();
        const lastSent = readReceiptSentAt.get(convId) || 0;
        if (now - lastSent > READ_RECEIPT_COOLDOWN_MS) {
          readReceiptSentAt.set(convId, now);
          // sessionId bisa null (lihat resolveSendSession) — markChatAsRead
          // sudah aman menangani ini (return false, tidak throw), read receipt
          // bukan operasi kritis jadi tidak perlu blok user kalau sesi belum diketahui.
          markChatAsRead(conv.customer.phone, resolveSendSession(conv)).catch(() => {}); // fire-and-forget
        }
      }
    } catch (e) {
      console.warn("[mark-read] Error:", e.message);
    }
  });
});

// Tandai percakapan sudah dibaca secara eksplisit (dipanggil frontend saat
// buka chat) — beda dari side-effect di atas: endpoint ini TIDAK ikut fetch
// seluruh riwayat pesan, cuma update status baca. Reuse logic/debounce yang
// sama dengan GET /:id/messages (readReceiptSentAt Map di atas).
conversationRouter.post("/:id/read", async (req, res) => {
  const convId = req.params.id;
  const conv = await prisma.conversation.findUnique({
    where:   { id: convId },
    include: { customer: { select: { phone: true } } },
  });
  if (!conv) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

  const updated = await prisma.conversation.update({
    where: { id: convId },
    data:  { isRead: true, readAt: new Date(), unread: false, unreadCount: 0 },
  });
  emitConversationUpdate(updated);
  res.json(updated);

  if (conv.channel === "WHATSAPP" && conv.customer?.phone) {
    const now      = Date.now();
    const lastSent = readReceiptSentAt.get(convId) || 0;
    if (now - lastSent > READ_RECEIPT_COOLDOWN_MS) {
      readReceiptSentAt.set(convId, now);
      markChatAsRead(conv.customer.phone, resolveSendSession(conv)).catch(() => {});
    }
  }
});

// Kirim pesan teks
// quotedMessageId: WAHA externalId pesan yang dikutip (opsional, untuk reply/quote)
// replyToId: DB id pesan yang dikutip (opsional, untuk simpan relasi di DB)
conversationRouter.post("/:id/messages", async (req, res) => {
  const { content, quotedMessageId, replyToId } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Pesan kosong" });

  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

  let wahaMsg = null;
  if (conversation.channel === "WHATSAPP") {
    // Task 3 — grup WA sekarang BISA dibalas dari CRM (sebelumnya diblok di
    // sini). Target kirim: groupJid untuk GROUP, nomor customer untuk
    // INDIVIDUAL (lihat resolveSendTarget). Pipeline/order/customer record
    // TETAP tidak ada untuk grup — cuma kemampuan chat yang dibuka.
    const target = resolveSendTarget(conversation);
    if (!target) {
      return res.status(400).json({
        error: conversation.type === "GROUP" ? "groupJid tidak tersedia" : "Nomor WA pelanggan tidak tersedia",
      });
    }
    try {
      ({ result: wahaMsg } = await sendWithSessionFallback(conversation, (session) =>
        sendText(target, content, quotedMessageId || null, session)
      ));
    } catch (waErr) {
      if (waErr instanceof SessionResolutionError) {
        return res.status(409).json({ error: SESSION_UNKNOWN_ERROR });
      }
      console.error("[sendText gagal]", waErr.message);
      return res.status(502).json({ error: `Gagal kirim ke WhatsApp: ${waErr.message}` });
    }
  } else {
    return res.status(400).json({ error: "Channel ini belum didukung (Phase 2)" });
  }

  // Simpan pesan ke DB — externalId dari WAHA dipakai untuk dedup dengan webhook fromMe
  // P2002 = webhook sudah duluan simpan (race condition) → ambil record yang sudah ada
  let message;
  try {
    message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "OUTBOUND",
        content,
        replyToId: replyToId || null,
        externalId: wahaMsg?.id || null,
      },
    });
  } catch (e) {
    if (e.code !== "P2002") throw e;
    message = await prisma.message.findUnique({ where: { externalId: wahaMsg?.id } });
  }
  const updatedConvSend = await prisma.conversation.update({
    where: { id: conversation.id },
    data:  { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(content, null) },
  });
  emitNewMessage(conversation.id, message);
  emitConversationUpdate(updatedConvSend);

  // Auto-assign lead ke sales yang pertama kali balas — TIDAK berlaku untuk
  // grup (Task 3d: grup tidak punya Customer/pipeline record, cuma chat-nya
  // saja yang dibuka; conversation.customer null utk GROUP, akses
  // .assignedSalesId di bawah akan crash kalau tidak di-guard).
  if (req.user.role === "SALES" && !conversation.assignedToId && conversation.type !== "GROUP") {
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

// Edit pesan OUTBOUND yang sudah terkirim — pola WhatsApp asli: cuma pesan
// teks (bukan media), cuma milik sendiri, cuma dalam batas waktu tertentu
// (15 menit, sama seperti batas edit WhatsApp resmi). Sesudah WAHA
// mengonfirmasi, update DB SEKARANG JUGA (bukan nunggu webhook
// message.edited yang sudah ada — itu tetap akan menyusul & idempotent,
// cuma dobel-pastikan) supaya response ke client langsung bawa content
// baru, bukan nunggu round-trip webhook lain.
const EDIT_MESSAGE_WINDOW_MS = 15 * 60 * 1000;

conversationRouter.patch("/:id/messages/:messageId", async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Isi pesan wajib diisi" });

  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

  const message = await prisma.message.findUnique({ where: { id: req.params.messageId } });
  if (!message || message.conversationId !== conversation.id) {
    return res.status(404).json({ error: "Pesan tidak ditemukan" });
  }
  if (message.direction !== "OUTBOUND") {
    return res.status(400).json({ error: "Hanya pesan yang Anda kirim yang bisa diedit" });
  }
  if (message.isRevoked) {
    return res.status(400).json({ error: "Pesan yang sudah dihapus tidak bisa diedit" });
  }
  if (message.mediaType) {
    return res.status(400).json({ error: "Hanya pesan teks yang bisa diedit, media tidak bisa" });
  }
  if (!message.externalId) {
    return res.status(400).json({ error: "Pesan ini belum tersinkron dengan WhatsApp, coba lagi sebentar" });
  }
  const ageMs = Date.now() - new Date(message.createdAt).getTime();
  if (ageMs > EDIT_MESSAGE_WINDOW_MS) {
    return res.status(400).json({ error: "Batas waktu edit (15 menit sejak terkirim) sudah lewat" });
  }

  const target = resolveSendTarget(conversation);
  if (!target) return res.status(400).json({ error: "Tujuan kirim tidak tersedia" });

  const trimmed = content.trim();
  try {
    await sendWithSessionFallback(conversation, (session) =>
      editMessage(target, message.externalId, trimmed, session)
    );
  } catch (err) {
    if (err instanceof SessionResolutionError) {
      return res.status(409).json({ error: SESSION_UNKNOWN_ERROR });
    }
    console.error("[edit] WAHA gagal:", err.message);
    return res.status(502).json({ error: `Gagal edit pesan di WhatsApp: ${err.message}` });
  }

  const updated = await prisma.message.update({
    where: { id: message.id },
    data: { content: trimmed, editedAt: new Date() },
  });
  emitMessageUpdate(conversation.id, updated);
  res.json(updated);
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

  // Audio selain webm/ogg/mp4 (MP3, AAC lepas, dll) tidak bisa jadi voice
  // note di WA — kirim sebagai file. audio/mp4 DIIKUTKAN di sini (bukan
  // dianggap "non-OGG/webm") karena itu format asli MediaRecorder Safari
  // (browser TIDAK PERNAH hasilkan webm sama sekali) — dikonversi ke ogg
  // di bawah, sama seperti webm dari Chrome/Edge/Brave/Opera.
  if (file.mimetype.startsWith("audio/") &&
      !file.mimetype.startsWith("audio/webm") &&
      !file.mimetype.startsWith("audio/ogg") &&
      !file.mimetype.startsWith("audio/mp4")) {
    sendAs = "document";
    console.log("[media] Audio format non-OGG/webm/mp4, kirim sebagai dokumen:", file.mimetype);
  }

  // WhatsApp hanya bisa memutar voice note dalam format audio/ogg (codec Opus).
  // Browser merekam dalam audio/webm;codecs=opus (Chrome/Edge/Brave/Opera)
  // ATAU audio/mp4 (Safari desktop & iOS, lihat VoiceRecorder.jsx frontend)
  // → perlu konversi container ke OGG via FFmpeg untuk kedua kasus.
  if (file.mimetype.startsWith("audio/webm") || file.mimetype.startsWith("audio/mp4")) {
    const baseName    = file.filename.replace(/\.[^.]+$/, "");
    const oggFilename = `${baseName}.ogg`;
    const oggPath     = path.join(uploadsDir, oggFilename);
    try {
      await execAsync(`ffmpeg -y -i "${file.path}" -vn -c:a libopus -f ogg "${oggPath}"`);
      wahaFileMime = "audio/ogg";
      wahaFileUrl  = `${BACKEND_INTERNAL_URL}/uploads/${oggFilename}`;
      wahaFileName = oggFilename; // pakai nama file OGG, bukan file asli
      mediaUrl     = `/uploads/${oggFilename}`;
      fs.unlink(file.path, () => {}); // hapus file sumber (webm/mp4)
      console.log(`[media] Audio dikonversi ${file.mimetype}→ogg:`, oggFilename);
    } catch (convErr) {
      console.warn(`[media] Konversi ${file.mimetype}→ogg gagal:`, convErr.message);
      // Fallback: kirim file asli, WhatsApp mungkin tidak bisa memutar sebagai voice note
    }
  }

  let waResult;
  if (conversation.channel === "WHATSAPP") {
    // Task 3 — media/VN sekarang juga bisa dikirim ke grup (composer grup
    // sudah aktif penuh). Target: groupJid untuk GROUP, nomor customer
    // untuk INDIVIDUAL.
    const target = resolveSendTarget(conversation);
    if (!target) {
      fs.unlink(file.path, () => {});
      return res.status(400).json({
        error: conversation.type === "GROUP" ? "groupJid tidak tersedia" : "Nomor WA pelanggan tidak tersedia",
      });
    }
    try {
      console.log(`[media] Kirim ke WAHA → ${wahaFileUrl} (mime=${wahaFileMime}, sendAs=${sendAs}, filename=${wahaFileName})`);
      ({ result: waResult } = await sendWithSessionFallback(conversation, (session) =>
        sendMedia(
          target,
          { mimetype: wahaFileMime, filename: wahaFileName, url: wahaFileUrl },
          caption,
          sendAs,
          session
        )
      ));
      console.log("[media] WAHA berhasil:", JSON.stringify(waResult).slice(0, 200));
    } catch (waErr) {
      // Hapus file yang sudah tersimpan karena gagal kirim
      fs.unlink(file.path, () => {});
      if (waErr instanceof SessionResolutionError) {
        return res.status(409).json({ error: SESSION_UNKNOWN_ERROR });
      }
      console.error("[media] WAHA gagal:", waErr.message);
      return res.status(502).json({ error: `Gagal kirim ke WhatsApp: ${waErr.message}` });
    }
  } else {
    return res.status(400).json({ error: "Channel ini belum didukung (Phase 2)" });
  }

  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "OUTBOUND",
            content: caption, mediaType, mediaUrl, externalId: waResult?.id || null },
  });
  const updatedConvMedia = await prisma.conversation.update({
    where: { id: conversation.id },
    data:  { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(caption, mediaType) },
  });
  emitNewMessage(conversation.id, message);
  emitConversationUpdate(updatedConvMedia);
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
      // sendWithSessionFallback pakai conversation.sessionId kalau sudah ada;
      // begitu berhasil self-heal di gambar pertama, session yang berhasil
      // di-cache ke conversation.sessionId (in-memory) supaya gambar
      // berikutnya di loop yang sama langsung pakai sesi itu, tidak
      // mengulang percobaan CS-1/CS-2 dari awal tiap gambar.
      const { session } = await sendWithSessionFallback(conversation, (s) =>
        sendMedia(
          conversation.customer.phone,
          { mimetype: "image/jpeg", filename: img.url.split("/").pop(), url: fileUrl },
          caption,
          "media",
          s
        )
      );
      conversation.sessionId = session;
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

  // Tidak ada satupun gambar terkirim DAN sesi masih belum diketahui — berarti
  // CS-1 & CS-2 dua-duanya gagal, munculkan pilihan manual (bukan diam-diam
  // balikin sent:0 seperti kegagalan WAHA biasa).
  if (savedMessages.length === 0 && !conversation.sessionId) {
    return res.status(409).json({ error: SESSION_UNKNOWN_ERROR });
  }

  const lastSaved = savedMessages[savedMessages.length - 1];
  const updatedConvProduct = await prisma.conversation.update({
    where: { id: conversation.id },
    data:  {
      lastMessageAt: new Date(),
      ...(lastSaved ? { lastMessagePreview: buildMessagePreview(lastSaved.content, lastSaved.mediaType) } : {}),
    },
  });
  savedMessages.forEach((m) => emitNewMessage(conversation.id, m));
  emitConversationUpdate(updatedConvProduct);

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
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
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

    emitConversationUpdate(updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teruskan (forward) pesan ke percakapan lain
conversationRouter.post("/:id/forward", async (req, res) => {
  const { messageId, targetConversationId } = req.body;
  if (!messageId || !targetConversationId)
    return res.status(400).json({ error: "messageId dan targetConversationId wajib diisi" });

  const sourceMsg = await prisma.message.findUnique({ where: { id: messageId } });
  if (!sourceMsg) return res.status(404).json({ error: "Pesan tidak ditemukan" });

  const targetConv = await prisma.conversation.findUnique({
    where: { id: targetConversationId },
    include: { customer: true },
  });
  if (!targetConv) return res.status(404).json({ error: "Percakapan tujuan tidak ditemukan" });

  let wahaMsg = null;
  if (targetConv.channel === "WHATSAPP" && targetConv.customer?.phone) {
    // Session diambil dari conversation TUJUAN (targetConv), bukan sumber —
    // pesan diteruskan KELUAR lewat nomor CS yang menangani percakapan tujuan.
    try {
      if (sourceMsg.mediaUrl && sourceMsg.mediaType) {
        const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL || "http://backend:4000";
        const fileUrl = sourceMsg.mediaUrl.startsWith("http")
          ? sourceMsg.mediaUrl
          : `${BACKEND_INTERNAL_URL}${sourceMsg.mediaUrl}`;
        const mimeMap = { image: "image/jpeg", video: "video/mp4", audio: "audio/ogg", document: "application/octet-stream" };
        ({ result: wahaMsg } = await sendWithSessionFallback(targetConv, (session) =>
          sendMedia(
            targetConv.customer.phone,
            { mimetype: mimeMap[sourceMsg.mediaType] || "application/octet-stream", filename: sourceMsg.mediaUrl.split("/").pop(), url: fileUrl },
            sourceMsg.content || "",
            "media",
            session
          )
        ));
      } else if (sourceMsg.content) {
        ({ result: wahaMsg } = await sendWithSessionFallback(targetConv, (session) =>
          sendText(targetConv.customer.phone, sourceMsg.content, null, session)
        ));
      }
    } catch (err) {
      if (err instanceof SessionResolutionError) {
        return res.status(409).json({ error: SESSION_UNKNOWN_ERROR });
      }
      console.error("[forward] WAHA gagal:", err.message);
      return res.status(502).json({ error: `Gagal teruskan ke WhatsApp: ${err.message}` });
    }
  }

  const newMsg = await prisma.message.create({
    data: {
      conversationId: targetConversationId,
      direction: "OUTBOUND",
      content: sourceMsg.content || "",
      mediaType: sourceMsg.mediaType || null,
      mediaUrl: sourceMsg.mediaUrl || null,
      forwarded: true,
      externalId: wahaMsg?.id || null,
    },
  });

  const updatedConvForward = await prisma.conversation.update({
    where: { id: targetConversationId },
    data:  { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(newMsg.content, newMsg.mediaType) },
  });
  emitNewMessage(targetConversationId, newMsg);
  emitConversationUpdate(updatedConvForward);

  res.status(201).json(newMsg);
});

// Update status / unread / isRead / pinned percakapan
conversationRouter.patch("/:id", async (req, res) => {
  const { status, assignedToId, unread, isRead, handoverNote, pinned } = req.body;
  const data = {};
  if (status)                     data.status       = status;
  if (assignedToId !== undefined) data.assignedToId = assignedToId;
  if (unread !== undefined)       data.unread       = unread;
  if (isRead !== undefined)       { data.isRead = isRead; if (isRead) data.readAt = new Date(); }
  if (handoverNote !== undefined) data.handoverNote = handoverNote;
  if (pinned !== undefined)       { data.pinned = pinned; data.pinnedAt = pinned ? new Date() : null; }
  const conversation = await prisma.conversation.update({
    where: { id: req.params.id },
    data,
  });
  emitConversationUpdate(conversation);
  res.json(conversation);
});

// Set sessionId manual — dipakai saat conversation.sessionId belum diketahui
// (lihat resolveSendSession di atas) dan sales/admin perlu betulkan lewat
// dropdown CS-1/CS-2 di header chat sebelum bisa kirim pesan.
conversationRouter.patch("/:id/session", async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
    return res.status(400).json({ error: "sessionId wajib diisi" });
  }
  const conversation = await prisma.conversation.update({
    where: { id: req.params.id },
    data:  { sessionId: sessionId.trim() },
  });
  emitConversationUpdate(conversation);
  res.json(conversation);
});

// Sync riwayat 1 percakapan saja dari WAHA — dipakai tombol "Sinkronisasi
// Riwayat" di header chat (admin only), utk recovery kasus per-kasus tanpa
// perlu sync SEMUA customer (POST /settings/sync-history, bisa lama & berat
// kalau chat yang bermasalah cuma 1-2). Paginasi penuh + parsing semua tipe
// pesan sama seperti sync massal — lihat utils/parseHistoryMessage.js.
conversationRouter.post("/:id/sync-history", requireAdmin, async (req, res) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { customer: { select: { phone: true } } },
  });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });
  if (conversation.type === "GROUP") {
    return res.status(400).json({ error: "Sinkronisasi riwayat belum didukung untuk grup" });
  }
  if (!conversation.customer?.phone) {
    return res.status(400).json({ error: "Nomor WA pelanggan tidak tersedia" });
  }

  let newMessages = 0, unsupportedMessages = 0;
  try {
    const messages = await fetchChatHistory(conversation.customer.phone, conversation.sessionId || undefined, { maxMessages: 1000 });

    for (const msg of messages) {
      const parsed = parseHistoryMessage(msg);
      if (!parsed.externalId) continue;
      if (parsed.isStatus) { console.log("[sync-history:1] drop status/broadcast dari", conversation.customer.phone); continue; }

      const exists = await prisma.message.findUnique({ where: { externalId: parsed.externalId } });
      if (exists) continue;

      if (parsed.unsupported) {
        unsupportedMessages++;
        console.warn("[sync-history:1] Tipe pesan tidak dikenali:", parsed.rawType, "externalId:", parsed.externalId);
      }

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction:      parsed.direction,
          content:        parsed.content,
          mediaType:      parsed.mediaType,
          mediaUrl:       parsed.mediaUrl,
          externalId:     parsed.externalId,
          createdAt:      parsed.createdAt,
        },
      });
      newMessages++;
    }

    res.json({
      ok: true,
      messagesFound: messages.length,
      newMessages,
      unsupportedMessages,
    });
  } catch (err) {
    res.status(500).json({ error: `Gagal sync riwayat: ${err.message}` });
  }
});

// Fetch-on-demand 1 media pesan (Fix 4) — dipakai tombol "Muat Media" di
// MessageBubble saat mediaType diketahui tapi mediaUrl belum tersedia
// (WAHA gagal download otomatis saat webhook masuk). Coba download ulang
// via externalId, simpan ke disk, update Message.mediaUrl.
conversationRouter.post("/:id/messages/:messageId/load-media", async (req, res) => {
  const message = await prisma.message.findUnique({ where: { id: req.params.messageId } });
  if (!message || message.conversationId !== req.params.id) {
    return res.status(404).json({ error: "Pesan tidak ditemukan" });
  }
  if (message.mediaUrl) {
    return res.json(message); // sudah ada, idempotent
  }
  if (!message.mediaType) {
    return res.status(400).json({ error: "Pesan ini bukan media" });
  }
  if (!message.externalId) {
    return res.status(400).json({ error: "Pesan ini tidak punya externalId, tidak bisa diunduh ulang" });
  }

  try {
    const downloaded = await downloadMediaMessage(message.externalId);
    if (!downloaded?.data) {
      return res.status(502).json({ error: "WAHA tidak bisa kasih media ini lagi (mungkin sudah kedaluwarsa di server WhatsApp)" });
    }
    const ext = extFromMime(downloaded.mimetype);
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(downloaded.data, "base64"));
    const mediaUrl = `/uploads/${filename}`;

    const updated = await prisma.message.update({
      where: { id: message.id },
      data: { mediaUrl },
    });
    res.json(updated);
  } catch (err) {
    res.status(502).json({ error: `Gagal muat media: ${err.message}` });
  }
});
