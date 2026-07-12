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

// Lokasi, kontak (vCard), dan poll — WhatsApp punya bentuk pesan sendiri
// untuk ini, BUKAN "media" biasa (tidak ada mimetype/URL yang bisa
// didownload) — makanya tidak match rawMediaType/mime di atas dan dulu
// jatuh ke fallback generik "[Pesan tidak didukung]".
// content disimpan sebagai JSON string terstruktur (bukan cuma teks) —
// MessageBubble.js/.jsx yang parse ulang untuk render card-nya.
//
// STRUKTUR FIELD DI BAWAH SUDAH DIVERIFIKASI LANGSUNG dari log webhook
// produksi nyata (docker logs backend, bukan asumsi dokumentasi Baileys
// umum) — dua sumber tersedia, dicoba berurutan:
//
// 1) TOP-LEVEL NORMALIZED (msg.location / msg.vCards) — WAHA sendiri yang
//    normalisasi ini persis seperti msg.media, SIBLING dari field itu,
//    SELALU ada di payload (null kalau bukan tipe ini). Contoh nyata:
//      "location": { "live": false, "latitude": "-6.40181474",
//                     "longitude": "106.84576435", "name": "Virgo Betta Fish",
//                     "address": "Gg. Musholla, Depok, ...", "thumbnail": "<base64>" }
//      "vCards": ["BEGIN:VCARD\nVERSION:3.0\n...FN:Gilang\nTEL;type=CELL;waid=...:+62 856-...\nEND:VCARD"]
//    vCards array isinya STRING vcard MENTAH (bukan object {displayName,vcard})
//    — nama diambil dari baris "FN:" di dalam teks vcard itu sendiri.
//    latitude/longitude datang sebagai STRING, bukan number.
//    Sumber ini LEBIH DIANDALKAN — satu bentuk untuk kedua engine (GOWS
//    maupun NOWEB), tidak bergantung struktur decode raw protobuf internal
//    yang bisa beda per versi WAHA.
// 2) FALLBACK raw _data.Message.locationMessage/contactMessage (rawMsg,
//    lihat di bawah) — dipakai kalau field top-level di atas kosong (mis.
//    respons endpoint riwayat yang strukturnya beda dari live webhook).
//    Field ini JUGA sudah diverifikasi dari log nyata:
//      locationMessage: { degreesLatitude, degreesLongitude, name, address, JPEGThumbnail }
//      contactMessage:  { displayName, vcard }
//      pollCreationMessageV3: { name, options: [{ optionName }], selectableOptionsCount }
function tryParseLocationNormalized(msg) {
  const loc = msg.location;
  if (!loc) return null;
  return JSON.stringify({
    lat: loc.latitude != null ? Number(loc.latitude) : null,
    lng: loc.longitude != null ? Number(loc.longitude) : null,
    name: loc.name || null,
    address: loc.address || null,
  });
}

function tryParseLocation(rawMsg) {
  const loc = rawMsg.locationMessage;
  if (!loc) return null;
  return JSON.stringify({
    lat: loc.degreesLatitude ?? null,
    lng: loc.degreesLongitude ?? null,
    name: loc.name || null,
    address: loc.address || null,
  });
}

// TEL field di vCard 3.0, mis. "TEL;type=CELL;waid=628123456789:+62 812-3456-789"
function extractPhoneFromVcard(vcard) {
  if (!vcard) return null;
  const m = vcard.match(/TEL[^:]*:([+\d\s-]+)/i);
  return m ? m[1].trim() : null;
}

// FN (Full Name) field di vCard 3.0 — nama tampilan kontak.
function extractNameFromVcard(vcard) {
  if (!vcard) return null;
  const m = vcard.match(/FN:(.*)/i);
  return m ? m[1].trim() : null;
}

function tryParseContactNormalized(msg) {
  const vcards = msg.vCards;
  if (!Array.isArray(vcards) || vcards.length === 0) return null;
  const contacts = vcards.map((vcard) => ({
    name: extractNameFromVcard(vcard) || "Kontak",
    phone: extractPhoneFromVcard(vcard),
  }));
  return JSON.stringify({ contacts });
}

function tryParseContact(rawMsg) {
  const single = rawMsg.contactMessage;
  const multi  = rawMsg.contactsArrayMessage;
  if (single) {
    return JSON.stringify({
      contacts: [{ name: single.displayName || "Kontak", phone: extractPhoneFromVcard(single.vcard) }],
    });
  }
  if (multi) {
    const contacts = (multi.contacts || []).map((c) => ({
      name: c.displayName || "Kontak", phone: extractPhoneFromVcard(c.vcard),
    }));
    return JSON.stringify({ contacts });
  }
  return null;
}

function tryParsePoll(rawMsg) {
  // Baileys sudah beberapa kali ganti versi key seiring update format poll
  // WhatsApp (V2/V3) — cek semua varian yang pernah ada.
  const poll = rawMsg.pollCreationMessage || rawMsg.pollCreationMessageV2 || rawMsg.pollCreationMessageV3;
  if (!poll) return null;
  const options = (poll.options || []).map((o) => o.optionName || o.name || "").filter(Boolean);
  return JSON.stringify({ question: poll.name || "Polling", options });
}

// WhatsApp Status/Story — JID broadcast-nya "status@broadcast" (BUKAN
// "status@g.us", itu beda gate — lihat webhooks.js). Status ter-attribusi
// ke SENDER (kontak asli), jadi kalau lolos ke sini akan nyasar masuk ke
// riwayat chat individual kontak itu. Cek generik endsWith("@broadcast")
// jaga-jaga kalau WAHA punya JID broadcast lain di masa depan.
function isStatusBroadcastJid(jid) {
  return !!jid && (jid === "status@broadcast" || jid.endsWith("@broadcast"));
}

// Parse 1 pesan history WAHA jadi bentuk siap simpan ke Message.
// Return: {
//   externalId, direction, content, mediaType, mediaUrl, createdAt,
//   unsupported: boolean, rawType: string|null, isStatus: boolean
//   // unsupported=true kalau tipe pesan sama sekali tidak dikenali (bukan
//   // cuma "media tanpa URL"); isStatus=true → caller WAJIB skip (jangan
//   // simpan ke Message sama sekali, ini bukan pesan individual).
// }
export function parseHistoryMessage(msg) {
  const externalId = msg.id || msg.key?.id || null;

  // Deteksi status/broadcast SEBELUM parsing apapun lain — chatId pesan ini
  // (bukan chatId yang diminta caller) yang menentukan, karena WAHA kadang
  // mencampur entry status ke riwayat kontak yang memposting-nya.
  const msgChatJid = msg.chatId || msg._data?.Info?.Chat || msg._data?.chatId || msg.from || "";
  if (isStatusBroadcastJid(msgChatJid)) {
    return {
      externalId, direction: msg.fromMe ? "OUTBOUND" : "INBOUND",
      content: null, mediaType: null, mediaUrl: null, createdAt: new Date(),
      unsupported: false, rawType: "status", isStatus: true,
    };
  }

  const direction   = msg.fromMe ? "OUTBOUND" : "INBOUND"; // sama seperti logic message.any (webhooks.js)

  const tsRaw = msg.timestamp ?? msg._data?.t ?? msg._data?.Info?.Timestamp;
  const createdAt = tsRaw
    ? (typeof tsRaw === "number" ? new Date(tsRaw * 1000) : new Date(tsRaw))
    : new Date();

  // BUG (fix): rawMsg cuma cek "_data.Message" (PascalCase) — itu struktur
  // GOWS (whatsmeow, Go). NOWEB (Baileys, JS) bungkus raw message-nya di
  // "_data.message" (lowercase) — konsisten dengan "_data.key" lowercase
  // yang sudah dipakai extractPhoneNoweb() di webhooks.js. Selama ini rawMsg
  // SELALU kosong ({}) untuk payload NOWEB, jadi SEMUA fallback yang
  // bergantung padanya (imageMessage/videoMessage/.../locationMessage/
  // contactMessage/pollCreationMessage) diam-diam tidak pernah kena untuk
  // sesi ber-engine NOWEB — persis kenapa lokasi/kontak/poll baru "kelihatan
  // kepasang" di grup (kalau kebetulan sesi grup itu GOWS) tapi tidak di
  // chat individual (kalau sesi individual itu NOWEB, atau sebaliknya).
  // BUKAN 2 fungsi parsing terduplikasi — ini SATU fungsi shared yang sudah
  // benar dipanggil oleh handleGroupMessage & handleInboundMessage/
  // handleOutboundFromPhone, cuma buta terhadap salah satu casing engine.
  const rawMsg = msg._data?.Message || msg._data?.message || {};

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
    // Prioritas: rawMediaType "sticker" DULU — stiker WhatsApp cuma file
    // image/webp biasa secara mimetype, jadi mimeToMediaType tidak bisa
    // bedakan stiker dari foto asli (keduanya "image/..."), tapi
    // _data.Info.MediaType WAHA secara eksplisit bilang "sticker" (bukan
    // "image") untuk pesan stiker — bug produksi: stiker selalu lolos
    // sebagai mediaType "image" karena mime dicek lebih dulu tanpa
    // pengecualian ini. Selain sticker, mimetype (paling presisi) tetap
    // didahulukan > _data.Info.MediaType (string tipe langsung, sering
    // satu-satunya sumber saat media.url belum ter-download) > "document"
    // (fallback aman terakhir).
    mediaType = rawMediaType === "sticker" ? "sticker" : (mime ? mimeToMediaType(mime) : (rawMediaType || "document"));
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

  // 3) Lokasi / kontak (vCard) / poll — bukan media biasa, tidak ada file
  // yang perlu didownload (mediaUrl selalu null utk 3 tipe ini). Coba
  // field top-level normalized WAHA dulu (lebih diandalkan, lihat komentar
  // di tryParseLocationNormalized/tryParseContactNormalized), fallback ke
  // raw _data.Message kalau kosong.
  const locationContent = tryParseLocationNormalized(msg) || tryParseLocation(rawMsg);
  if (locationContent) {
    return { externalId, direction, content: locationContent, mediaType: "location", mediaUrl: null, createdAt, unsupported: false, rawType: "location" };
  }
  const contactContent = tryParseContactNormalized(msg) || tryParseContact(rawMsg);
  if (contactContent) {
    return { externalId, direction, content: contactContent, mediaType: "contact", mediaUrl: null, createdAt, unsupported: false, rawType: "contact" };
  }
  const pollContent = tryParsePoll(rawMsg);
  if (pollContent) {
    return { externalId, direction, content: pollContent, mediaType: "poll", mediaUrl: null, createdAt, unsupported: false, rawType: "poll" };
  }

  // Tipe pesan sama sekali tidak dikenali (bukan teks, bukan media yang
  // dikenali) — mis. reactionMessage, dll. Log tipe aslinya (key pertama
  // di rawMsg) supaya bisa ditambah dukungannya nanti — kalau field
  // location/contact/poll di atas ternyata beda nama di produksi, rawType
  // di sini akan menampilkan nama key sebenarnya (mis. "pollCreationMessageV3"),
  // pakai itu untuk perbaiki tryParsePoll dkk di atas.
  const unknownType = Object.keys(rawMsg)[0] || msg.type || "unknown";
  return {
    externalId, direction,
    content: "[Pesan tidak didukung]",
    mediaType: null, mediaUrl: null, createdAt,
    unsupported: true, rawType: unknownType,
  };
}
