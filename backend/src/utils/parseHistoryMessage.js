// Parser terpusat untuk 1 pesan dari riwayat chat WAHA (GET .../messages),
// dipakai autoSyncHistory (webhooks.js), POST /settings/sync-history, dan
// POST /conversations/:id/sync-history — supaya parsing SAMA di mana-mana
// (sebelumnya tiap tempat re-implement `msg.body || msg.caption || ""` yang
// dangkal, menghasilkan bubble kosong untuk pesan media tanpa caption).
//
// WAHA menormalkan sebagian field lintas-engine (msg.body, msg.hasMedia,
// msg.media.{url,mimetype,filename}) tapi untuk riwayat GOWS field itu bisa
// kosong sementara data sesungguhnya ada di struktur mentah Baileys
// (msg._data.Message.conversation / extendedTextMessage.text / imageMessage
// dll) — parser ini cek KEDUANYA, normalized dulu baru fallback raw GOWS.
//
// PRINSIP PENTING: kalau tipe pesan dikenali tapi mediaUrl WAHA tidak
// tersedia (raw GOWS imageMessage.url dkk itu URL CDN WhatsApp terenkripsi,
// TIDAK bisa dipakai langsung tanpa proses download+decrypt yang WAHA REST
// history endpoint tidak expose) — JANGAN simpan bubble kosong. Isi content
// dengan placeholder sesuai tipe, mediaUrl tetap null (frontend akan
// tampilkan bubble teks placeholder, bukan bubble media kosong/rusak).

// Diexport supaya scripts/fix-empty-messages.js bisa pakai placeholder yang
// SAMA persis (satu sumber kebenaran, bukan didefinisikan ulang).
export const MEDIA_TYPE_PLACEHOLDER = {
  image:    "[Foto]",
  video:    "[Video]",
  audio:    "[VN]",
  document: "[Dokumen]",
  sticker:  "[Stiker]",
};

const RAW_MEDIA_KEY_TO_TYPE = {
  imageMessage:    "image",
  videoMessage:    "video",
  audioMessage:    "audio",
  documentMessage: "document",
  stickerMessage:  "sticker",
};

// _data.Info.MediaType (GOWS) — string tipe LANGSUNG ("image"/"video"/
// "audio"/"document"/"sticker"/"ptt"), BUKAN mimetype. Dikonfirmasi via
// testing payload langsung WAHA GOWS — field ini SELALU ada untuk pesan
// media walau msg.media (URL) null (URL cuma terisi kalau WAHA di-fetch
// dengan downloadMedia=true). "ptt" = push-to-talk = voice note → audio.
const KNOWN_MEDIA_TYPES = new Set(["image", "video", "audio", "document", "sticker"]);
function normalizeRawMediaType(raw) {
  const t = (raw || "").toLowerCase();
  if (t === "ptt") return "audio";
  return KNOWN_MEDIA_TYPES.has(t) ? t : null;
}

function mimeToMediaType(mime) {
  const m = (mime || "").split(";")[0].trim().toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

// Parse 1 pesan history WAHA jadi bentuk siap simpan ke Message.
// Return: {
//   externalId, direction, content, mediaType, mediaUrl, createdAt,
//   unsupported: boolean, rawType: string|null  // unsupported=true kalau
//   tipe pesan sama sekali tidak dikenali (bukan cuma "media tanpa URL")
// }
export function parseHistoryMessage(msg) {
  const externalId = msg.id || msg.key?.id || null;
  const direction   = msg.fromMe ? "OUTBOUND" : "INBOUND"; // sama seperti logic message.any (webhooks.js)

  const tsRaw = msg.timestamp ?? msg._data?.t ?? msg._data?.Info?.Timestamp;
  const createdAt = tsRaw
    ? (typeof tsRaw === "number" ? new Date(tsRaw * 1000) : new Date(tsRaw))
    : new Date();

  const rawMsg = msg._data?.Message || {};

  // 1) Teks — normalized (msg.body) dulu, fallback raw GOWS
  let text =
    msg.body ||
    rawMsg.conversation ||
    rawMsg.extendedTextMessage?.text ||
    "";

  // 2) Deteksi media — normalized (msg.hasMedia/msg.media) dulu
  let mediaType = null;
  let mediaUrl  = null;
  let caption   = null;

  const rawMediaType = normalizeRawMediaType(msg._data?.Info?.MediaType);

  if (msg.hasMedia || msg.media || rawMediaType) {
    const mime = msg.media?.mimetype || msg._data?.mimetype || msg._data?.Info?.Mimetype || "";
    // Prioritas: mimetype (paling presisi) > _data.Info.MediaType (string
    // tipe langsung, sering satu-satunya sumber saat media.url belum
    // ter-download) > "document" (fallback aman terakhir).
    mediaType = mime ? mimeToMediaType(mime) : (rawMediaType || "document");
    mediaUrl  = msg.media?.url || null; // URL dari WAHA sendiri — aman dipakai langsung kalau ada
    caption   = msg.caption || text || null;
  } else {
    // Fallback: cek key raw GOWS (imageMessage/videoMessage/audioMessage/documentMessage/stickerMessage)
    for (const [key, type] of Object.entries(RAW_MEDIA_KEY_TO_TYPE)) {
      if (rawMsg[key]) {
        mediaType = type;
        caption   = rawMsg[key].caption || null;
        // rawMsg[key].url = CDN WhatsApp terenkripsi, TIDAK langsung bisa
        // dipakai sebagai <img src> — sengaja TIDAK diisi ke mediaUrl.
        break;
      }
    }
  }

  if (mediaType) {
    const content = caption || MEDIA_TYPE_PLACEHOLDER[mediaType] || "[Media]";
    return { externalId, direction, content, mediaType, mediaUrl, createdAt, unsupported: false, rawType: mediaType };
  }

  if (text) {
    return { externalId, direction, content: text, mediaType: null, mediaUrl: null, createdAt, unsupported: false, rawType: "text" };
  }

  // Tipe pesan sama sekali tidak dikenali (bukan teks, bukan media yang
  // dikenali) — mis. pollCreationMessage, reactionMessage, dll. Log tipe
  // aslinya (key pertama di rawMsg) supaya bisa ditambah dukungannya nanti.
  const unknownType = Object.keys(rawMsg)[0] || msg.type || "unknown";
  return {
    externalId, direction,
    content: "[Pesan tidak didukung]",
    mediaType: null, mediaUrl: null, createdAt,
    unsupported: true, rawType: unknownType,
  };
}
