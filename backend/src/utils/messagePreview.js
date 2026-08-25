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

// Potongan teks DI SEKITAR kata yang dicari — dipakai hasil pencarian Inbox
// (GET /conversations?search=), BUKAN pesan terakhir (buildMessagePreview di
// atas selalu potong dari AWAL, jadi kalau kata yang dicari muncul di tengah/
// akhir pesan panjang, potongan 80-karakter-dari-awal itu bisa sama sekali
// tidak menunjukkan kata yang dicari — hasil pencarian jadi kelihatan "asal
// nempel", padahal cocoknya sah, cuma tidak kelihatan di mana). Radius kecil
// di kiri-kanan kata yang cocok, mirip potongan hasil pencarian Google.
const SNIPPET_RADIUS = 34;

export function buildSearchSnippet(content, mediaType, query) {
  if (LABEL_TERSTRUKTUR[mediaType]) return LABEL_TERSTRUKTUR[mediaType];
  const text = (content || "").trim();
  if (!text || !query) return buildMessagePreview(content, mediaType);
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return buildMessagePreview(content, mediaType); // cocok lewat nama/nomor/nama grup, bukan pesan ini
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end   = Math.min(text.length, idx + query.length + SNIPPET_RADIUS);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}
