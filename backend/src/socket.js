import { Server } from "socket.io";
import jwt from "jsonwebtoken";

// Singleton Socket.IO server — di-init sekali dari index.js (attach ke http.Server
// yang sama dengan Express), lalu dipakai dari webhooks.js/conversations.js lewat
// getter/helper di bawah supaya tidak ada circular import ke index.js.
let io = null;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    // Mirror app.use(cors()) tanpa opsi di index.js (allow semua origin) —
    // konsisten dengan REST API yang juga wide-open.
    cors: { origin: "*" },
  });

  // Auth handshake — pakai JWT_SECRET & jsonwebtoken yang sama persis dengan
  // requireAuth di middleware/auth.js, supaya token dari login REST juga
  // valid dipakai connect socket (satu sumber kebenaran auth).
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("unauthorized"));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } catch {
      return next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    // Room per percakapan — frontend join saat conversation dibuka (setActive),
    // leave saat pindah/tutup. Event message:new & message:ack di-scope ke room
    // ini supaya client tidak kebanjiran event percakapan yang tidak dibuka.
    socket.on("join", (conversationId) => {
      if (typeof conversationId === "string" && conversationId) {
        socket.join(`conv:${conversationId}`);
      }
    });
    socket.on("leave", (conversationId) => {
      if (typeof conversationId === "string" && conversationId) {
        socket.leave(`conv:${conversationId}`);
      }
    });
  });

  console.log("[socket] Socket.IO server siap");
  return io;
}

export function getIO() {
  return io;
}

// message:new — payload penuh (dibutuhkan MessageList render langsung tanpa refetch)
export function emitNewMessage(conversationId, message) {
  io?.to(`conv:${conversationId}`).emit("message:new", message);
}

// message:ack — status centang kirim per-pesan
export function emitMessageAck(conversationId, externalId, ack) {
  io?.to(`conv:${conversationId}`).emit("message:ack", { externalId, ack });
}

// message:update — konten pesan berubah SETELAH awalnya tersimpan (diedit
// via WAHA message.edited, atau dihapus/direvoke via message.revoked) —
// payload PENUH (bukan slim) supaya client bisa langsung replace-in-place
// tanpa refetch, sama seperti message:new. Beda dari message:new: ini
// UPDATE pesan yang SUDAH ada di store client (by id), bukan pesan baru.
export function emitMessageUpdate(conversationId, message) {
  io?.to(`conv:${conversationId}`).emit("message:update", message);
}

// message:deleted — "Hapus untuk Saya" (local, CRM-only, TIDAK menyentuh
// WhatsApp) menghapus row Message dari DB SUNGGUHAN (bukan soft-delete),
// jadi client lain yang lagi buka percakapan yang sama (CRM ini dipakai
// bareng oleh beberapa sales/admin) perlu diberitahu untuk buang bubble itu
// dari store lokal mereka juga — beda dari message:update (isRevoked, row
// tetap ada) yang dipakai utk "Hapus untuk Semua" (WAHA revoke asli).
export function emitMessageDeleted(conversationId, messageId) {
  io?.to(`conv:${conversationId}`).emit("message:deleted", { messageId });
}

// conversation:update — SLIM payload untuk daftar percakapan (kolom kiri),
// broadcast ke SEMUA client (bukan cuma room percakapan itu) karena daftar
// percakapan siapa saja bisa perlu tahu urutan/preview/badge terbaru.
export function emitConversationUpdate(conv) {
  if (!io || !conv) return;
  io.emit("conversation:update", {
    id: conv.id,
    lastMessagePreview: conv.lastMessagePreview,
    unreadCount: conv.unreadCount,
    // BUG (Task 2d): `unread` (boolean) sebelumnya TIDAK ikut di slim
    // payload ini — ConversationItem.jsx pakai field ini (bukan isRead)
    // untuk class CSS ".unread" yang mengontrol bold/dim. Tanpa ini, fix
    // backend (message.ack case B, syncReadFromWaha) menyimpan unread=false
    // dengan benar ke DB, tapi frontend tidak pernah tahu lewat socket —
    // item tetap tampak "belum dibuka" sampai reload manual.
    unread: conv.unread,
    lastMessageAt: conv.lastMessageAt,
    status: conv.status,
    isRead: conv.isRead,
    pinned: conv.pinned,
    pinnedAt: conv.pinnedAt,
    sessionId: conv.sessionId,
  });
}

// sync:progress / sync:done — status job "Sinkronisasi Riwayat Chat"
// (settings.js). Broadcast ke SEMUA client (bukan per-room) — cuma admin
// yang buka halaman Pengaturan yang peduli, tapi payload kecil jadi aman
// broadcast luas (fallback polling tetap ada di frontend kalau socket putus).
export function emitSyncProgress(job) {
  io?.emit("sync:progress", job);
}
export function emitSyncDone(job) {
  io?.emit("sync:done", job);
}
