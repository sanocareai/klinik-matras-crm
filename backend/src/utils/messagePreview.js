// Potongan teks pesan terakhir untuk ditampilkan di daftar percakapan
// (Conversation.lastMessagePreview) — dipakai dari webhooks.js, conversations.js,
// dan scripts/backfill-preview-unread.js supaya format konsisten di semua tempat.
const MAX_LEN = 80;

export function buildMessagePreview(content, mediaType) {
  const text = (content || "").trim();
  if (text) return text.length > MAX_LEN ? text.slice(0, MAX_LEN) + "…" : text;
  switch (mediaType) {
    case "image":    return "[Foto]";
    case "video":    return "[Video]";
    case "document": return "[Dokumen]";
    case "audio":    return "[VN]";
    default:         return "";
  }
}
