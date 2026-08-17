// Potongan teks pesan terakhir untuk ditampilkan di daftar percakapan
// (Conversation.lastMessagePreview) — dipakai dari webhooks.js, conversations.js,
// dan scripts/backfill-preview-unread.js supaya format konsisten di semua tempat.
const MAX_LEN = 80;

// Lokasi/kontak/poll menyimpan JSON MENTAH di `content` (lihat
// tryParseLocationNormalized & tryParseContactNormalized di
// utils/parseHistoryMessage.js) — BUKAN teks yang layak dibaca manusia.
// Tipe-tipe ini harus diperiksa SEBELUM cabang teks di bawah; kalau tidak,
// `content` yang truthy itu langsung dipakai apa adanya dan daftar percakapan
// menampilkan `{"lat":-6.4,"lng":106.8,...}` sebagai "pesan terakhir".
const LABEL_TERSTRUKTUR = {
  location: "[Lokasi]",
  contact:  "[Kontak]",
  poll:     "[Polling]",
};

export function buildMessagePreview(content, mediaType) {
  if (LABEL_TERSTRUKTUR[mediaType]) return LABEL_TERSTRUKTUR[mediaType];
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
