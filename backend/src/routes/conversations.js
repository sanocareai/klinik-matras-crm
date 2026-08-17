import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { rolesOf } from "../middleware/authorize.js";
import { sendText, sendMedia, sendLocation, sendContactVcard, editMessage, deleteMessage, markChatAsRead, fetchChatHistory, downloadMediaMessage, getGroupParticipants, getGroupTopic, getGroupPicture, KNOWN_SESSIONS, checkNumberExists, getContactInfo } from "../services/wahaClient.js";
import { bakukanNomorIndonesia } from "../services/nomorIndonesia.js";
import { buildMessagePreview } from "../utils/messagePreview.js";
import { parseHistoryMessage } from "../utils/parseHistoryMessage.js";
import { resolveMediaExt } from "../utils/mediaExt.js";
import { downloadAndSaveMedia } from "./webhooks.js";
import { emitNewMessage, emitConversationUpdate, emitMessageUpdate, emitMessageDeleted } from "../socket.js";

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

export const SESSION_UNKNOWN_ERROR = "Sesi WA percakapan ini belum diketahui — buka menu dan pilih sesi";

// Dilempar sendWithSessionFallback() kalau conversation.sessionId null DAN
// semua KNOWN_SESSIONS gagal — caller HARUS tangkap ini terpisah dari error
// WAHA biasa supaya balikin 409 (munculkan pilihan manual "Pilih sesi..."),
// bukan 502 (yang berarti sesi sudah benar tapi WAHA-nya yang bermasalah).
export class SessionResolutionError extends Error {}

// Self-healing session resolver — dipakai semua endpoint kirim (messages,
// media, send-product, forward). Kalau conversation.sessionId SUDAH ada,
// pakai itu saja (tidak coba sesi lain — kalau WAHA gagal di sini itu
// masalah lain, bukan salah sesi, jadi TIDAK boleh diam-diam coba sesi lain
// dan berisiko kirim dobel/ke nomor salah). Kalau sessionId NULL, coba tiap
// KNOWN_SESSIONS berurutan (CS-1 dulu, lalu CS-2) sampai salah satu
// berhasil — begitu berhasil, SIMPAN sessionId itu ke conversation supaya
// tidak perlu tanya/coba-coba lagi lain kali (self-healing permanen).
// sendFn menerima 1 argumen: nama session yang sedang dicoba.
export async function sendWithSessionFallback(conversation, sendFn) {
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
export function resolveSendTarget(conversation) {
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

// POST /api/conversations/mulai-chat — "ketik nomor lalu chat", seperti di
// aplikasi WhatsApp.
//
// KENAPA INI ADA. Sebelumnya percakapan HANYA bisa lahir dari customer yang
// chat duluan (lewat webhook). Kalau sales dapat nomor dari telepon, kartu
// nama, atau referral, tidak ada jalan memulai chat dari CRM sama sekali —
// mereka harus buka WhatsApp di HP, dan percakapan itu tidak pernah masuk
// CRM sampai customer membalas.
//
// ALUR & ALASAN URUTANNYA:
//   1. Bakukan nomor (08xx/+62/8xx -> 628xx) — tanpa ini satu orang bisa
//      jadi beberapa Customer terpisah cuma karena beda cara ketik.
//   2. Kalau SUDAH ada di CRM, kembalikan percakapan yang ada. TIDAK bikin
//      baru — menduplikasi customer memecah riwayat chat & order.
//   3. Baru cek ke WhatsApp apakah nomornya benar-benar terdaftar. Cek ini
//      TERAKHIR karena paling mahal (panggilan jaringan) dan tidak perlu
//      dilakukan untuk nomor yang sudah jelas ada di CRM.
//   4. Customer/Conversation baru dibuat HANYA kalau nomornya terbukti ada.
conversationRouter.post("/mulai-chat", async (req, res) => {
  try {
    const { phone, session, name } = req.body;

    const baku = bakukanNomorIndonesia(phone);
    if (!baku.ok) return res.status(400).json({ error: baku.alasan });
    const nomor = baku.nomor;

    // Sesi WAJIB dipilih eksplisit — nomor CS ada 2 (CS-1/CS-2) dan
    // pelanggan akan melihat pesan datang DARI nomor itu. Menebak sesi di
    // sini artinya menentukan identitas pengirim tanpa sepengetahuan sales.
    if (!KNOWN_SESSIONS.includes(session)) {
      return res.status(400).json({ error: `Pilih nomor pengirim: ${KNOWN_SESSIONS.join(" atau ")}` });
    }

    // ── Sudah ada di CRM? Pakai yang itu. ──
    const existing = await prisma.customer.findUnique({ where: { phone: nomor } });
    if (existing) {
      let conv = await prisma.conversation.findFirst({
        where: { customerId: existing.id, channel: "WHATSAPP", status: { not: "RESOLVED" } },
        orderBy: { lastMessageAt: "desc" },
      });
      // Pelanggan lama yang semua percakapannya sudah RESOLVED — buka
      // percakapan baru, jangan menghidupkan kembali yang sudah ditutup
      // (statusnya punya arti bagi sales).
      if (!conv) {
        conv = await prisma.conversation.create({
          data: { customerId: existing.id, channel: "WHATSAPP", sessionId: session },
        });
      }
      return res.json({
        conversationId: conv.id,
        customerId: existing.id,
        sudahAda: true,
        nomor,
        // `nama` SELALU dikirim (baik kontak lama maupun baru) supaya
        // pemanggil tidak perlu membedakan dua bentuk respons — mobile
        // memakainya langsung sebagai judul layar chat.
        nama: existing.name,
      });
    }

    // ── Nomor baru: pastikan dulu benar-benar ada di WhatsApp ──
    const cek = await checkNumberExists(nomor, session);
    if (cek === null) {
      // WAHA tidak bisa dihubungi — SENGAJA dibedakan dari "nomor tidak
      // terdaftar", supaya sales tidak menyimpulkan nomornya salah padahal
      // layanannya yang sedang mati.
      return res.status(503).json({ error: "Layanan WhatsApp sedang tidak bisa dihubungi — coba lagi sebentar lagi" });
    }
    if (!cek.ada) {
      return res.status(404).json({ error: `Nomor ${nomor} tidak terdaftar di WhatsApp` });
    }

    // Ambil nama dari WhatsApp kalau ada — lebih baik daripada kontak tanpa
    // nama, dan sales tetap bisa menimpanya nanti.
    const kontak = await getContactInfo(nomor, session).catch(() => null);

    const customer = await prisma.customer.create({
      data: {
        phone: nomor,
        name: name?.trim() || kontak?.name || kontak?.pushname || null,
        // Dimulai OLEH SALES, bukan customer yang datang sendiri — jadi ini
        // bukan lead masuk dari kanal manapun. Ditandai jujur begitu, bukan
        // dipaksa masuk salah satu sumber iklan.
        leadSource: "OTHER",
        leadSourceDetail: "Dimulai manual oleh sales dari CRM",
      },
    });

    const conversation = await prisma.conversation.create({
      data: { customerId: customer.id, channel: "WHATSAPP", sessionId: session },
    });

    console.log(`[mulai-chat] Percakapan baru ${conversation.id} ke ${nomor} lewat ${session}`);
    res.status(201).json({
      conversationId: conversation.id,
      customerId: customer.id,
      sudahAda: false,
      nomor,
      nama: customer.name,
    });
  } catch (err) {
    console.error("[mulai-chat] gagal:", err);
    res.status(500).json({ error: "Gagal memulai percakapan" });
  }
});

// GET /api/conversations/cek-nomor?phone=&session= — periksa nomor TANPA
// membuat apa pun. Dipakai UI untuk memberi umpan balik langsung saat sales
// mengetik, sebelum dia menekan tombol.
conversationRouter.get("/cek-nomor", async (req, res) => {
  try {
    const { phone, session } = req.query;
    const baku = bakukanNomorIndonesia(phone);
    if (!baku.ok) return res.json({ valid: false, alasan: baku.alasan });

    const sesi = KNOWN_SESSIONS.includes(session) ? session : KNOWN_SESSIONS[0];
    const nomor = baku.nomor;

    const existing = await prisma.customer.findUnique({
      where: { phone: nomor },
      select: { id: true, name: true },
    });

    const cek = await checkNumberExists(nomor, sesi);
    res.json({
      valid: true,
      nomor,
      adaDiWhatsApp: cek === null ? null : cek.ada, // null = WAHA tidak terjangkau
      sudahAdaDiCrm: !!existing,
      namaDiCrm: existing?.name || null,
    });
  } catch (err) {
    console.error("[cek-nomor] gagal:", err.message);
    res.status(500).json({ error: "Gagal memeriksa nomor" });
  }
});

// Daftar percakapan — cursor pagination (cursor = id percakapan terakhir dari
// halaman sebelumnya, limit default 100 kalau tidak dikirim supaya caller lama
// yang belum paginate — refresh penuh setelah SSE, dsb — tetap dapat batch besar
// seperti perilaku lama). Response SEKARANG {data, nextCursor}, bukan array
// mentah lagi — frontend (api.js/useConversations.js) sudah disesuaikan.
conversationRouter.get("/", async (req, res) => {
  const { status, search, assignedToId, cursor, unread, tag } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
  const where = {};
  if (status)       where.status       = status;
  if (assignedToId) where.assignedToId = assignedToId;
  // ?tag=... — saring percakapan berdasarkan tag pelanggannya. Dipakai
  // chip "Broadcast" di Inbox: setelah kampanye mengirim, penerimanya
  // otomatis diberi tag (BroadcastCampaign.tagOnSend), sehingga sales bisa
  // memisahkan "orang yang baru saja kita blast" dari chat masuk biasa dan
  // menggarapnya sebagai satu antrean tersendiri.
  if (tag) where.customer = { tags: { has: tag } };
  // ?unread=true — dipakai chip "Belum Dibaca" di Inbox mobile (lihat
  // mobile/src/screens/ChatListScreen.js). Sama persis definisi yang
  // dipakai badge unread-count di bawah (unread=true), bukan hitungan baru.
  if (unread === "true") where.unread = true;

  if (search) {
    // Cari di customer (individual), groupName (grup), DAN isi pesan —
    // sebelumnya search cuma cocok ke nama/nomor/nama grup, jadi customer
    // yang chat pakai kata kunci spesifik (mis. "kasur sewa", "komplain
    // busa") tidak ketemu sama sekali walau percakapannya jelas relevan.
    // { messages: { some: ... } } bikin percakapan ikut muncul kalau
    // SALAH SATU pesannya (arah manapun) mengandung kata kunci itu.
    where.OR = [
      { customer: { OR: [
        { name:  { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ]}},
      { groupName: { contains: search, mode: "insensitive" } },
      { messages: { some: { content: { contains: search, mode: "insensitive" } } } },
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
      // Sales yang PERTAMA kirim balasan — badge terpisah dari assignedTo
      // (yang SEDANG menangani), lihat catatan panjang di schema.prisma.
      firstResponder: { select: { id: true, name: true } },
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

// GET /:id — SATU percakapan, bentuk PERSIS sama dengan item di GET "/" list
// (customer, pesan terakhir, assignedTo, firstResponder, + field turunan
// isUnanswered/unansweredMinutes/canTakeOver).
//
// KENAPA INI PERLU: deep-link "?conv=<id>" dari Dashboard (Needs Action / Hot
// Leads) hanya bisa membuka percakapan yang KEBETULAN ada di 100 percakapan
// TERBARU (GET "/" defaultnya diurutkan by lastMessageAt desc, limit 100).
// Follow-up yang sudah menunggu berhari-hari (mis. "25 hari" di Needs Action)
// nyaris pasti SUDAH TERGESER keluar dari 100 teratas begitu ada aktivitas
// chat lain — deep-link-nya diam-diam gagal, terlihat seperti "klik tidak
// melakukan apa-apa". Endpoint ini jadi fallback: frontend cek dulu apakah
// percakapan ada di daftar yang sudah di-fetch, kalau tidak baru panggil ini.
conversationRouter.get("/:id", async (req, res) => {
  const conv = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: {
      customer: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      assignedTo: { select: { id: true, name: true, avatarUrl: true } },
      firstResponder: { select: { id: true, name: true } },
    },
  });
  if (!conv) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

  const { messages, ...rest } = conv;
  const lastMsg = messages[0] || null;
  const isUnanswered = lastMsg?.direction === "INBOUND";
  const unansweredMinutes = isUnanswered
    ? Math.floor((Date.now() - new Date(lastMsg.createdAt).getTime()) / 60000)
    : null;
  const canTakeOver = !rest.assignedToId || (isUnanswered && (unansweredMinutes ?? 0) >= 60);

  res.json({ ...rest, messages, isUnanswered, unansweredMinutes, canTakeOver });
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

// Preview N pesan terakhir TANPA efek samping apa pun — BEDA dari
// GET /:id/messages di atas, yang punya side-effect mark-as-read (isRead/
// unread/unreadCount + read receipt WAHA). Dipakai fitur "Peek Preview"
// (long-press percakapan di Inbox mobile, ala WhatsApp): sales bisa intip
// isi chat tanpa percakapan itu ke-mark-as-read/badge unread hilang duluan
// sebelum benar-benar dibuka. Taruh SEBELUM "/:id/messages" secara logis
// tidak masalah di Express (literal suffix beda, bukan pola tumpang tindih).
conversationRouter.get("/:id/peek", async (req, res) => {
  const convId = req.params.id;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 5, 1), 20);
  const messages = await prisma.message.findMany({
    where:   { conversationId: convId },
    orderBy: { createdAt: "desc" },
    take:    limit,
    include: {
      replyTo: {
        select: { id: true, content: true, direction: true, mediaType: true, isRevoked: true },
      },
    },
  });
  // Balik ke urutan kronologis (lama → baru) — sama konvensi dengan
  // GET /:id/messages, biar renderer pesan di mobile tidak perlu tahu beda.
  res.json(messages.reverse());
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
  // clientId: dibuat mobile/web SEKALI per percobaan kirim (ChatScreen.js
  // #handleSend). BUG PRODUKSI YANG DIPERBAIKI (28 Jul 2026): field ini
  // SEBELUMNYA cuma dipakai rekonsiliasi optimistic-UI, TIDAK PERNAH dicek
  // di server — akibatnya kalau HTTP request timeout di HP (30 detik,
  // koneksi lapangan naik-turun) PADAHAL sendText() ke WAHA sudah berhasil,
  // client menganggap gagal → masuk outbox (lib/outboxFlush.js) → retry
  // beberapa menit kemudian mengirim ULANG ke WhatsApp SUNGGUHAN, walau
  // pesan sebelumnya sudah sampai. Pelanggan menerima pesan sama berkali-
  // kali (dikonfirmasi screenshot produksi: pesan yang sama muncul 3x
  // dengan centang biru, jeda beberapa menit antar kirim). Sekarang: kalau
  // clientId ini SUDAH PERNAH diproses (ada row Message dengan clientId
  // sama), balikin langsung row yang sudah ada — TIDAK panggil sendText()
  // lagi sama sekali.
  const { content, quotedMessageId, replyToId, clientId, mentions } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Pesan kosong" });

  if (clientId) {
    const existing = await prisma.message.findUnique({ where: { clientId } });
    if (existing) return res.json({ ...existing, clientId });
  }

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
    // mentions dikirim sebagai daftar NOMOR (mis. ["628881996001"]) oleh
    // klien; WAHA menuntut bentuk JID. Tanpa daftar ini, teks "@628881996001"
    // terkirim sebagai tulisan biasa — orangnya TIDAK tertandai & TIDAK
    // dinotifikasi, jadi mention-nya cuma terlihat benar tapi tidak berfungsi.
    const mentionJids = Array.isArray(mentions)
      ? mentions.filter((n) => /^\d{8,}$/.test(String(n))).map((n) => `${n}@c.us`)
      : null;
    try {
      ({ result: wahaMsg } = await sendWithSessionFallback(conversation, (session) =>
        sendText(target, content, quotedMessageId || null, session, mentionJids)
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
        sentById: req.user.id,
        clientId: clientId || null,
      },
    });
  } catch (e) {
    if (e.code !== "P2002") throw e;
    // Race sangat sempit: 2 request ber-clientId SAMA lolos cek di atas
    // nyaris bersamaan (jarang — retry outbox berjeda menit, bukan
    // milidetik) — clientId lebih spesifik, cek itu duluan sebelum externalId.
    message = clientId
      ? await prisma.message.findUnique({ where: { clientId } })
      : await prisma.message.findUnique({ where: { externalId: wahaMsg?.id } });
  }
  // firstResponderId diisi SEKALI (pesan outbound pertama di percakapan ini)
  // dan tidak pernah berubah lagi walau assignedToId pindah tangan lewat
  // takeover/transfer — lihat catatan panjang di schema.prisma.
  const convUpdateData = { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(content, null) };
  if (!conversation.firstResponderId) convUpdateData.firstResponderId = req.user.id;
  const updatedConvSend = await prisma.conversation.update({
    where: { id: conversation.id },
    data:  convUpdateData,
  });
  // Tempel clientId ke payload (BUKAN ke row DB) sebelum di-broadcast/
  // dikembalikan — lihat catatan di atas.
  const messagePayload = clientId ? { ...message, clientId } : message;
  emitNewMessage(conversation.id, messagePayload);
  emitConversationUpdate(updatedConvSend);

  // Auto-assign lead ke sales yang pertama kali balas — TIDAK berlaku untuk
  // grup (Task 3d: grup tidak punya Customer/pipeline record, cuma chat-nya
  // saja yang dibuka; conversation.customer null utk GROUP, akses
  // .assignedSalesId di bawah akan crash kalau tidak di-guard).
  if (rolesOf(req.user).includes("SALES") && !conversation.assignedToId && conversation.type !== "GROUP") {
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

  res.status(201).json(messagePayload);
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

// "Hapus untuk Semua" — revoke pesan OUTBOUND lewat WAHA, tampil ke customer
// sebagai "Pesan ini telah dihapus" (pola WhatsApp asli). Batas waktu 2 hari
// 12 jam SAMA dengan kebijakan WhatsApp resmi (lewat batas ini WA sendiri
// sudah menolak revoke, jadi kita tolak lebih dulu di sini dengan pesan
// jelas daripada biarkan gagal generik di WAHA).
const DELETE_EVERYONE_WINDOW_MS = (2 * 24 + 12) * 60 * 60 * 1000; // 60 jam

conversationRouter.delete("/:id/messages/:messageId", async (req, res) => {
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
    return res.status(400).json({ error: "Hanya pesan yang Anda kirim yang bisa dihapus untuk semua" });
  }
  if (message.isRevoked) {
    return res.status(400).json({ error: "Pesan ini sudah dihapus" });
  }
  if (!message.externalId) {
    return res.status(400).json({ error: "Pesan ini belum tersinkron dengan WhatsApp, coba lagi sebentar" });
  }
  const ageMs = Date.now() - new Date(message.createdAt).getTime();
  if (ageMs > DELETE_EVERYONE_WINDOW_MS) {
    return res.status(400).json({ error: "Batas waktu hapus untuk semua (2 hari 12 jam sejak terkirim) sudah lewat — coba \"Hapus untuk Saya\"" });
  }

  const target = resolveSendTarget(conversation);
  if (!target) return res.status(400).json({ error: "Tujuan kirim tidak tersedia" });

  try {
    await sendWithSessionFallback(conversation, (session) =>
      deleteMessage(target, message.externalId, session)
    );
  } catch (err) {
    if (err instanceof SessionResolutionError) {
      return res.status(409).json({ error: SESSION_UNKNOWN_ERROR });
    }
    console.error("[delete] WAHA gagal:", err.message);
    return res.status(502).json({ error: `Gagal hapus pesan di WhatsApp: ${err.message}` });
  }

  const updated = await prisma.message.update({
    where: { id: message.id },
    data: { isRevoked: true },
  });
  emitMessageUpdate(conversation.id, updated);
  res.json(updated);
});

// "Hapus untuk Saya" — hard delete dari DB CRM SAJA, TIDAK memanggil WAHA
// sama sekali (pesan tetap ada di WhatsApp customer). Berlaku utk pesan
// arah manapun (INBOUND/OUTBOUND) & tanpa batas waktu, karena ini murni
// membersihkan tampilan CRM, bukan tindakan ke WhatsApp asli. CATATAN:
// CRM ini dipakai BERSAMA oleh beberapa sales/admin (bukan akun WA pribadi
// per-user) — "untuk saya" di sini berarti "dari tampilan CRM" (semua
// pengguna CRM), BUKAN per-akun sales individual (itu butuh tabel
// hidden-per-user terpisah, di luar scope sekarang). emitMessageDeleted
// beritahu client lain yang lagi buka percakapan sama supaya bubble-nya
// ikut hilang real-time.
conversationRouter.delete("/:id/messages/:messageId/local", async (req, res) => {
  const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

  const message = await prisma.message.findUnique({ where: { id: req.params.messageId } });
  if (!message || message.conversationId !== conversation.id) {
    return res.status(404).json({ error: "Pesan tidak ditemukan" });
  }

  await prisma.message.delete({ where: { id: message.id } });
  emitMessageDeleted(conversation.id, message.id);
  res.json({ id: message.id, deleted: true });
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
            content: caption, mediaType, mediaUrl, externalId: waResult?.id || null,
            sentById: req.user.id },
  });
  // Sama seperti POST /:id/messages — firstResponderId diisi sekali saja.
  const convUpdateDataMedia = { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(caption, mediaType) };
  if (!conversation.firstResponderId) convUpdateDataMedia.firstResponderId = req.user.id;
  const updatedConvMedia = await prisma.conversation.update({
    where: { id: conversation.id },
    data:  convUpdateDataMedia,
  });
  emitNewMessage(conversation.id, message);
  emitConversationUpdate(updatedConvMedia);
  console.log(`[media] Selesai, pesan tersimpan id=${message.id}`);
  res.status(201).json(message);
});

// GET /:id/group-info — layar "Info Grup" ala WhatsApp: foto, deskripsi,
// jumlah anggota. Dipisah dari /:id/participants (bukan digabung jadi satu
// payload besar) supaya UI bisa menampilkan header dulu sambil daftar
// anggota masih dimuat — sama seperti WhatsApp asli yang terasa instan
// duluan sebelum daftar member scroll ke bawah.
const groupInfoCache = new Map(); // conversationId -> { data, at }
const GROUP_INFO_TTL_MS = 5 * 60 * 1000;

conversationRouter.get("/:id/group-info", async (req, res) => {
  const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });
  if (conversation.type !== "GROUP" || !conversation.groupJid) {
    return res.status(400).json({ error: "Bukan percakapan grup" });
  }

  const cached = groupInfoCache.get(conversation.id);
  if (cached && Date.now() - cached.at < GROUP_INFO_TTL_MS) return res.json(cached.data);

  const session = conversation.sessionId || KNOWN_SESSIONS[0];
  const [topic, avatarUrl] = await Promise.all([
    getGroupTopic(conversation.groupJid, session),
    getGroupPicture(conversation.groupJid, session),
  ]);
  const data = { name: conversation.groupName || null, topic: topic || null, avatarUrl };
  groupInfoCache.set(conversation.id, { data, at: Date.now() });
  res.json(data);
});

// GET /:id/participants — anggota grup + NAMA yang sudah di-resolve.
//
// Melayani DUA kebutuhan sekaligus dari satu sumber data (jangan dipecah jadi
// dua endpoint yang bisa saling tidak konsisten):
//   1. Menerjemahkan mention "@165811675242551" jadi "@bang richel Digital".
//      WhatsApp menyimpan mention di TEKS pesan sebagai @<LID>, dan LID itu
//      angka internal yang tidak berarti apa pun bagi manusia — itu yang
//      selama ini terlihat mentah di CRM & SANO Messenger.
//   2. Daftar pilihan saat sales mengetik "@" di composer grup.
//
// ⚠️ Nama TIDAK diambil dari DisplayName WAHA — field itu SELALU kosong di
// produksi (lihat catatan di wahaClient.js#getGroupParticipants). Nama dicari
// dari tabel Customer lewat nomor telepon. Anggota yang tidak punya baris
// Customer akan `name: null` — klien menampilkan nomornya, JANGAN pernah
// menampilkan LID ke pengguna.
const participantsCache = new Map(); // conversationId -> { data, at }
const PARTICIPANTS_TTL_MS = 5 * 60 * 1000; // anggota grup jarang berubah

conversationRouter.get("/:id/participants", async (req, res) => {
  const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });
  // Bukan error untuk percakapan pribadi — cuma tidak ada anggota. Balikin
  // array kosong supaya klien tidak perlu bercabang per tipe percakapan.
  if (conversation.type !== "GROUP" || !conversation.groupJid) return res.json([]);

  const cached = participantsCache.get(conversation.id);
  if (cached && Date.now() - cached.at < PARTICIPANTS_TTL_MS) return res.json(cached.data);

  const session = conversation.sessionId || KNOWN_SESSIONS[0];
  const raw = await getGroupParticipants(conversation.groupJid, session);

  // Bentuk WAHA: JID/LID "<lid>@lid", PhoneNumber "<nomor>@s.whatsapp.net".
  const anggota = raw.map((p) => ({
    lid: String(p.LID || p.JID || "").split("@")[0] || null,
    phone: String(p.PhoneNumber || "").split("@")[0] || null,
    isAdmin: !!(p.IsAdmin || p.IsSuperAdmin),
  })).filter((a) => a.lid || a.phone);

  const nomorList = anggota.map((a) => a.phone).filter(Boolean);
  const pelanggan = nomorList.length
    ? await prisma.customer.findMany({
        where: { phone: { in: nomorList } },
        select: { phone: true, name: true },
      })
    : [];
  const namaPerNomor = new Map(pelanggan.filter((c) => c.name).map((c) => [c.phone, c.name]));

  const data = anggota.map((a) => ({
    ...a,
    name: (a.phone && namaPerNomor.get(a.phone)) || null,
  }));

  participantsCache.set(conversation.id, { data, at: Date.now() });
  res.json(data);
});

// POST /:id/send-location — bagikan titik lokasi (showroom, alamat pelanggan).
//
// content DISIMPAN dengan bentuk JSON yang SAMA PERSIS dengan pesan lokasi
// MASUK (lihat tryParseLocationNormalized di utils/parseHistoryMessage.js:
// {lat, lng, name, address}) — supaya LocationCard di frontend/mobile
// merender bubble keluar dan masuk lewat satu jalur yang sama, tidak perlu
// cabang khusus "lokasi yang kita kirim sendiri".
conversationRouter.post("/:id/send-location", async (req, res) => {
  const { lat, lng, name } = req.body;
  // Validasi rentang, bukan cuma "ada isinya" — nol itu koordinat SAH
  // (Teluk Guinea), jadi cek kebenaran nilai harus pakai Number.isFinite,
  // bukan falsy-check yang diam-diam menolak 0.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat & lng wajib berupa angka" });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "Koordinat di luar rentang yang mungkin" });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });
  if (conversation.channel !== "WHATSAPP") {
    return res.status(400).json({ error: "Channel ini belum didukung" });
  }
  const target = resolveSendTarget(conversation);
  if (!target) {
    return res.status(400).json({
      error: conversation.type === "GROUP" ? "groupJid tidak tersedia" : "Nomor WA pelanggan tidak tersedia",
    });
  }

  let waResult;
  try {
    ({ result: waResult } = await sendWithSessionFallback(conversation, (session) =>
      sendLocation(target, { lat, lng, title: name || null }, session)
    ));
  } catch (err) {
    if (err instanceof SessionResolutionError) {
      return res.status(409).json({ error: SESSION_UNKNOWN_ERROR });
    }
    return res.status(502).json({ error: `Gagal kirim lokasi ke WhatsApp: ${err.message}` });
  }

  const content = JSON.stringify({ lat, lng, name: name || null, address: null });
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id, direction: "OUTBOUND",
      content, mediaType: "location", mediaUrl: null,
      externalId: waResult?.id || null, rawType: "location", sentById: req.user.id,
    },
  });
  const convUpdate = { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(content, "location") };
  if (!conversation.firstResponderId) convUpdate.firstResponderId = req.user.id;
  const updatedConv = await prisma.conversation.update({ where: { id: conversation.id }, data: convUpdate });
  emitNewMessage(conversation.id, message);
  emitConversationUpdate(updatedConv);
  res.status(201).json(message);
});

// POST /:id/send-contact — bagikan kartu kontak (vCard), mis. nomor teknisi.
//
// Bentuk content SAMA dengan pesan kontak MASUK ({contacts:[{name, phone}]},
// lihat tryParseContactNormalized) — alasan sama seperti send-location.
conversationRouter.post("/:id/send-contact", async (req, res) => {
  const { name, phone } = req.body;
  if (!name?.trim() || !phone?.trim()) {
    return res.status(400).json({ error: "name & phone wajib diisi" });
  }
  // Bakukan ke format 62xxx — sama seperti jalur lain yang menerima nomor
  // dari input manusia (lihat services/nomorIndonesia.js). Tanpa ini kartu
  // kontak bisa berisi "08xx" yang tidak bisa langsung di-chat dari WhatsApp.
  const hasil = bakukanNomorIndonesia(phone);
  if (!hasil.ok) return res.status(400).json({ error: hasil.alasan });

  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });
  if (conversation.channel !== "WHATSAPP") {
    return res.status(400).json({ error: "Channel ini belum didukung" });
  }
  const target = resolveSendTarget(conversation);
  if (!target) {
    return res.status(400).json({
      error: conversation.type === "GROUP" ? "groupJid tidak tersedia" : "Nomor WA pelanggan tidak tersedia",
    });
  }

  let waResult;
  try {
    ({ result: waResult } = await sendWithSessionFallback(conversation, (session) =>
      // whatsappId diisi supaya penerima bisa langsung ketuk-chat kontaknya
      // (tanpa waid, WhatsApp cuma menampilkan nomor sebagai teks mati).
      sendContactVcard(target, [{
        fullName: name.trim(),
        phoneNumber: `+${hasil.nomor}`,
        whatsappId: hasil.nomor,
      }], session)
    ));
  } catch (err) {
    if (err instanceof SessionResolutionError) {
      return res.status(409).json({ error: SESSION_UNKNOWN_ERROR });
    }
    return res.status(502).json({ error: `Gagal kirim kontak ke WhatsApp: ${err.message}` });
  }

  const content = JSON.stringify({ contacts: [{ name: name.trim(), phone: hasil.nomor }] });
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id, direction: "OUTBOUND",
      content, mediaType: "contact", mediaUrl: null,
      externalId: waResult?.id || null, rawType: "contact", sentById: req.user.id,
    },
  });
  const convUpdate = { lastMessageAt: new Date(), lastMessagePreview: buildMessagePreview(content, "contact") };
  if (!conversation.firstResponderId) convUpdate.firstResponderId = req.user.id;
  const updatedConv = await prisma.conversation.update({ where: { id: conversation.id }, data: convUpdate });
  emitNewMessage(conversation.id, message);
  emitConversationUpdate(updatedConv);
  res.status(201).json(message);
});

// Kirim produk dari galeri ke customer ATAU grup (gambar berurutan dengan delay)
//
// BUG YANG DIPERBAIKI (10 Agustus 2026): sebelumnya SELALU pakai
// `conversation.customer.phone` langsung — untuk conversation type GROUP,
// `customer` itu `null` (lihat schema.prisma, GROUP tidak punya Customer),
// jadi `conversation.customer.phone` CRASH (TypeError: Cannot read properties
// of null) begitu sales coba kirim galeri produk ke grup. Sekarang pakai
// resolveSendTarget() yang sama dengan POST /:id/messages & /:id/media —
// groupJid untuk GROUP, nomor customer untuk INDIVIDUAL.
conversationRouter.post("/:id/send-product", async (req, res) => {
  const { productId, imageIds, includePrice } = req.body;
  if (!productId) return res.status(400).json({ error: "productId wajib diisi" });

  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });
  const sendTarget = resolveSendTarget(conversation);
  if (!sendTarget) {
    return res.status(400).json({
      error: conversation.type === "GROUP" ? "groupJid tidak tersedia" : "Nomor WA pelanggan tidak tersedia",
    });
  }

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
          sendTarget,
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

// POST /:id/send-documentation — kirim berkas dokumentasi produksi (D-015)
// ke customer. Struktur SAMA PERSIS dengan /send-product di atas (loop +
// delay 1500ms antar foto, sendWithSessionFallback, SESSION_UNKNOWN_ERROR),
// bedanya sumber gambar dari unit_stage_logs.photo_urls (Sano Hub), bukan
// katalog Product — dan tiap TAHAP dapat caption sendiri, bukan cuma satu
// caption di foto terakhir, supaya customer paham "ini foto tahap apa".
//
// Sengaja TIDAK auto-kirim dari server — sales yang memicu lewat tombol di
// CRM setelah melihat sendiri fotonya (D-015: manusia tetap mereview sebelum
// sesuatu sampai ke customer, cuma jalurnya sekarang lewat WAHA bukan
// WhatsApp pribadi sales).
conversationRouter.post("/:id/send-documentation", async (req, res) => {
  const { orderId, entries } = req.body;
  if (!orderId) return res.status(400).json({ error: "orderId wajib diisi" });
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: "Tidak ada tahap dipilih untuk dikirim" });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });
  if (!conversation.customer.phone) {
    return res.status(400).json({ error: "Nomor WA pelanggan tidak tersedia" });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, customerId: true },
  });
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
  // Order harus benar-benar milik customer percakapan ini — mencegah salah
  // kirim dokumentasi kasur customer A ke chat customer B.
  if (order.customerId !== conversation.customerId) {
    return res.status(400).json({ error: "Order ini bukan milik pelanggan percakapan ini" });
  }

  // entries datang dari klien (hasil GET /production/orders/:id/documentation
  // yang sudah ditampilkan & dipilih sales) — TIDAK dipercaya mentah-mentah.
  // photoUrls WAJIB berupa path lokal /media/unit-photos/... yang memang kita
  // simpan sendiri (lihat routes/units.js upload). Tanpa validasi ini, body
  // request bisa memasukkan URL APA SAJA dan membuat server men-fetch +
  // mengirim file dari mana pun (SSRF lewat parameter file WAHA).
  const isValidPhotoUrl = (u) => typeof u === "string" && u.startsWith("/media/unit-photos/");
  const cleanEntries = entries
    .map((e) => ({
      stageLabel: String(e.stageLabel || "").slice(0, 200),
      note: e.note ? String(e.note).slice(0, 1000) : "",
      photoUrls: Array.isArray(e.photoUrls) ? e.photoUrls.filter(isValidPhotoUrl) : [],
    }))
    .filter((e) => e.photoUrls.length > 0);
  if (cleanEntries.length === 0) {
    return res.status(400).json({ error: "Tidak ada foto valid untuk dikirim" });
  }

  function formatCaption(entry) {
    let text = `*${entry.stageLabel}* — ${order.orderNumber}`;
    if (entry.note) text += `\n${entry.note}`;
    return text;
  }

  const BACKEND_INTERNAL_URL = process.env.BACKEND_INTERNAL_URL || "http://backend:4000";
  const savedMessages = [];

  // Diratakan jadi satu daftar foto (bukan nested loop) supaya delay antar
  // KIRIM konsisten 1500ms di seluruh urutan — sama seperti send-product,
  // bukan "1500ms antar tahap" yang bisa membuat foto dalam 1 tahap terkirim
  // beruntun tanpa jeda (rawan dianggap spam oleh WhatsApp).
  const flatPhotos = [];
  for (const entry of cleanEntries) {
    entry.photoUrls.forEach((url, idxInEntry) => {
      const isLastInEntry = idxInEntry === entry.photoUrls.length - 1;
      flatPhotos.push({ url, caption: isLastInEntry ? formatCaption(entry) : "" });
    });
  }

  for (let i = 0; i < flatPhotos.length; i++) {
    const { url, caption } = flatPhotos[i];
    const fileUrl = `${BACKEND_INTERNAL_URL}${url}`;

    try {
      const { session } = await sendWithSessionFallback(conversation, (s) =>
        sendMedia(
          conversation.customer.phone,
          { mimetype: "image/jpeg", filename: url.split("/").pop(), url: fileUrl },
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
          mediaUrl: url,
          sentById: req.user.id,
        },
      });
      savedMessages.push(msg);
    } catch (err) {
      console.error(`[send-documentation] Gagal kirim foto ${url}:`, err.message);
    }

    if (i < flatPhotos.length - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  if (savedMessages.length === 0 && !conversation.sessionId) {
    return res.status(409).json({ error: SESSION_UNKNOWN_ERROR });
  }

  const lastSaved = savedMessages[savedMessages.length - 1];
  const updatedConvDoc = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      ...(lastSaved ? { lastMessagePreview: buildMessagePreview(lastSaved.content, lastSaved.mediaType) } : {}),
    },
  });
  savedMessages.forEach((m) => emitNewMessage(conversation.id, m));
  emitConversationUpdate(updatedConvDoc);

  res.json({ sent: savedMessages.length, total: flatPhotos.length, messages: savedMessages });
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

    const isAdmin          = rolesOf(req.user).includes("ADMIN");
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

    // Riwayat penanganan LENGKAP (beda dari handoverNote di atas yang cuma
    // simpan 1 catatan terakhir, ketimpa tiap kali pindah tangan lagi) —
    // dipakai tampilkan timeline "Riwayat Penanganan" penuh di chat window.
    await prisma.handoverEvent.create({
      data: { conversationId: conv.id, fromUserId: oldAssignedId || null, toUserId: req.user.id, reason: "takeover" },
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

// Riwayat LENGKAP siapa saja yang pernah menangani percakapan ini (takeover
// & transfer manual) — dipanggil on-demand saat chat window dibuka (bukan
// ikut di GET / list, supaya list tetap ringan untuk ratusan percakapan).
conversationRouter.get("/:id/handover-history", async (req, res) => {
  try {
    const events = await prisma.handoverEvent.findMany({
      where: { conversationId: req.params.id },
      orderBy: { createdAt: "asc" },
      include: {
        fromUser: { select: { id: true, name: true } },
        toUser:   { select: { id: true, name: true } },
      },
    });
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teruskan (forward) pesan ke percakapan lain
conversationRouter.post("/:id/forward", async (req, res) => {
  const { messageId, targetConversationId } = req.body;
  if (!messageId || !targetConversationId)
    return res.status(400).json({ error: "messageId dan targetConversationId wajib diisi" });

  let sourceMsg = await prisma.message.findUnique({ where: { id: messageId } });
  if (!sourceMsg) return res.status(404).json({ error: "Pesan tidak ditemukan" });

  // BUG YANG DIPERBAIKI (10 Agustus 2026): pesan media yang mediaUrl-nya
  // masih null (download awal gagal — WAHA belum selesai proses saat webhook
  // tiba, sering terjadi kalau customer kirim BANYAK video sekaligus lewat
  // fitur "album" WhatsApp, mis. 5-7 video bersamaan) SEBELUMNYA jatuh ke
  // cabang `else if (sourceMsg.content)` di bawah — content untuk pesan media
  // gagal-unduh sudah diisi PLACEHOLDER teks (mis. "[Video]", lihat
  // parseHistoryMessage.js), jadi forward "berhasil" tapi yang benar-benar
  // terkirim ke tujuan cuma teks placeholder itu, BUKAN videonya. Sales
  // menyangka fitur forward video-nya rusak, padahal videonya memang belum
  // pernah berhasil diunduh dari awal. Sekarang forward MENCOBA UNDUH ULANG
  // di titik ini — pada saat sales forward (biasanya beberapa menit setelah
  // pesan masuk), WAHA hampir pasti sudah selesai proses medianya.
  if (sourceMsg.mediaType && !sourceMsg.mediaUrl && sourceMsg.externalId) {
    const redownloaded = await downloadAndSaveMedia(null, sourceMsg.externalId, "", sourceMsg.mediaType);
    if (redownloaded) {
      sourceMsg = await prisma.message.update({
        where: { id: sourceMsg.id },
        data:  { mediaUrl: redownloaded },
      });
    } else {
      return res.status(502).json({
        error: "Media pesan ini belum berhasil diunduh dari WhatsApp — coba lagi sebentar lagi.",
      });
    }
  }

  const targetConv = await prisma.conversation.findUnique({
    where: { id: targetConversationId },
    include: { customer: true },
  });
  if (!targetConv) return res.status(404).json({ error: "Percakapan tujuan tidak ditemukan" });

  let wahaMsg = null;
  if (targetConv.channel === "WHATSAPP") {
    // BUG YANG DIPERBAIKI (10 Agustus 2026): sebelumnya syarat kirim di sini
    // adalah `targetConv.customer?.phone` — untuk conversation type GROUP,
    // `customer` selalu null (GROUP tidak punya Customer, lihat
    // schema.prisma), jadi kondisi ini SELALU false dan blok WAHA di bawah
    // DILEWATI SAMA SEKALI tanpa error. Akibatnya: pesan yang "diteruskan" ke
    // grup cuma tersimpan sebagai baris Message lokal (kode di bawah, di luar
    // if ini) — TIDAK PERNAH benar-benar terkirim ke WhatsApp. Bubble-nya
    // ikut tersangkut di status "terkirim"/loading karena externalId (ack
    // WAHA) memang tidak pernah ada. Sekarang pakai resolveSendTarget() yang
    // sama dengan POST /:id/messages & /:id/media — groupJid untuk GROUP,
    // nomor customer untuk INDIVIDUAL — supaya forward ke grup benar-benar
    // terkirim (atau gagal dengan error yang jelas, bukan diam-diam no-op).
    const target = resolveSendTarget(targetConv);
    if (!target) {
      return res.status(400).json({
        error: targetConv.type === "GROUP" ? "groupJid tidak tersedia" : "Nomor WA pelanggan tidak tersedia",
      });
    }
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
            target,
            { mimetype: mimeMap[sourceMsg.mediaType] || "application/octet-stream", filename: sourceMsg.mediaUrl.split("/").pop(), url: fileUrl },
            sourceMsg.content || "",
            "media",
            session
          )
        ));
      } else if (sourceMsg.content) {
        ({ result: wahaMsg } = await sendWithSessionFallback(targetConv, (session) =>
          sendText(target, sourceMsg.content, null, session)
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

  // BUG YANG DIPERBAIKI: transfer lead (ubah assignedToId lewat endpoint ini)
  // sebelumnya TIDAK ADA penegakan role di server — UI menyembunyikan
  // tombolnya untuk non-ADMIN (isCurrentUserAdmin() di frontend), tapi
  // endpoint sendiri menerima assignedToId dari SIAPA PUN yang login. Fitur
  // transfer sengaja admin-only (lihat POST /:id/takeover yang punya aturan
  // beda — SALES boleh ambil alih sendiri) — sekarang ditegakkan di sini juga.
  if (assignedToId !== undefined && !rolesOf(req.user).includes("ADMIN")) {
    return res.status(403).json({ error: "Hanya admin yang bisa transfer lead ke sales lain" });
  }

  const data = {};
  if (status)                     data.status       = status;
  if (assignedToId !== undefined) data.assignedToId = assignedToId;
  if (unread !== undefined)       data.unread       = unread;
  if (isRead !== undefined)       { data.isRead = isRead; if (isRead) data.readAt = new Date(); }
  if (handoverNote !== undefined) data.handoverNote = handoverNote;
  if (pinned !== undefined)       { data.pinned = pinned; data.pinnedAt = pinned ? new Date() : null; }

  // Transfer manual (assignedToId berubah lewat sini, BEDA dari ambil-alih
  // sendiri via POST /:id/takeover) — dicatat juga ke HandoverEvent supaya
  // timeline "Riwayat Penanganan" lengkap, tidak cuma dari takeover.
  let prevAssignedToId = null;
  let customerId = null;
  if (assignedToId !== undefined) {
    const before = await prisma.conversation.findUnique({
      where: { id: req.params.id }, select: { assignedToId: true, customerId: true },
    });
    prevAssignedToId = before?.assignedToId ?? null;
    customerId = before?.customerId ?? null;
  }

  const conversation = await prisma.conversation.update({
    where: { id: req.params.id },
    data,
  });

  if (assignedToId !== undefined && assignedToId && assignedToId !== prevAssignedToId) {
    await prisma.handoverEvent.create({
      data: { conversationId: conversation.id, fromUserId: prevAssignedToId, toUserId: assignedToId, reason: "transfer" },
    }).catch(() => {}); // jangan gagalkan response utama kalau ini gagal

    // BUG YANG DIPERBAIKI: label "Sales Person" di tabel Pelanggan/Pipeline/
    // Customer 360 dibaca dari Customer.assignedSalesId, BUKAN dari
    // Conversation.assignedToId — endpoint ini dulu cuma mengubah field
    // Conversation-nya, jadi label sales tidak pernah berubah sama sekali
    // setelah transfer (beda dari takeover & auto-assign balasan pertama,
    // yang keduanya SUDAH menyinkronkan Customer.assignedSalesId).
    if (customerId) {
      await prisma.customer.update({
        where: { id: customerId },
        data:  { assignedSalesId: assignedToId },
      }).catch(() => {});
    }
  }

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
    const buffer = Buffer.from(downloaded.data, "base64");
    const ext = resolveMediaExt({ buffer, mime: downloaded.mimetype, mediaType: message.mediaType });
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
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
