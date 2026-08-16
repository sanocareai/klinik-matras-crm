// SATU SUMBER KEBENARAN untuk menentukan ekstensi file media.
//
// ⚠️ BUG NYATA YANG MELAHIRKAN FILE INI (16 Agustus 2026). Sebelumnya ada DUA
// salinan `extFromMime()` yang identik tapi terpisah (routes/webhooks.js dan
// routes/conversations.js), dan keduanya jatuh ke ".bin" kalau MIME tidak
// dikenal. Akibatnya di produksi: 4.105 file (9,9 GB — 70% dari SELURUH
// storage media) tersimpan sebagai ".bin", padahal `file` mengonfirmasi
// isinya "ISO Media, MP4" alias VIDEO BIASA.
//
// Dampaknya BUKAN cuma boros tempat. `express.static` menentukan Content-Type
// dari EKSTENSI, jadi video-video itu disajikan sebagai:
//     Content-Type: application/octet-stream
// dan browser MENOLAK memutarnya di bubble chat (diverifikasi langsung ke
// produksi — file .mp4 dapat "video/mp4", file .bin yang isinya sama persis
// dapat "application/octet-stream"). Jadi ribuan video praktis tidak bisa
// ditonton di CRM selama berbulan-bulan tanpa ada yang tahu penyebabnya.
//
// Penyebab MIME kosong/tidak dikenal: WAHA kadang membalas
// "application/octet-stream" saat mengunduh media, dan payload webhook untuk
// video dari iPhone membawa "video/quicktime" yang memang tidak ada di peta
// lama.
//
// URUTAN PENENTUAN (sengaja, jangan dibalik):
//   1. MIME  — paling SEMANTIS. Hanya ini yang bisa membedakan .docx/.xlsx
//              dari .zip biasa (ketiganya sama-sama arsip ZIP di level byte).
//   2. Magic bytes — jaring pengaman saat MIME kosong/octet-stream. Inilah
//              yang menyelamatkan kasus .bin di atas.
//   3. mediaType — sudah diketahui pemanggil ("video"/"image"/"audio") dari
//              parseHistoryMessage. Lebih baik menebak .mp4 untuk sesuatu
//              yang JELAS video daripada ".bin" yang pasti tidak bisa diputar.
//   4. ".bin" — benar-benar tidak diketahui apa pun.

export function cleanMime(mime) {
  return (mime || "").split(";")[0].trim().toLowerCase();
}

const MIME_EXT = {
  "image/jpeg": ".jpg",   "image/jpg": ".jpg",     "image/png": ".png",
  "image/gif": ".gif",    "image/webp": ".webp",   "image/heic": ".heic",
  "image/heif": ".heif",  "image/bmp": ".bmp",     "image/tiff": ".tiff",
  // video/quicktime = video dari iPhone. Ini yang paling sering jadi ".bin".
  // Disimpan sebagai .mp4 (bukan .mov) DENGAN SENGAJA: isinya sama-sama
  // ISO-BMFF, dan .mp4 jauh lebih luas didukung <video> di browser + WhatsApp.
  "video/mp4": ".mp4",    "video/quicktime": ".mp4", "video/x-m4v": ".mp4",
  "video/webm": ".webm",  "video/3gpp": ".3gp",    "video/3gpp2": ".3g2",
  "video/x-matroska": ".mkv",
  "audio/ogg": ".ogg",    "audio/opus": ".ogg",    "audio/webm": ".webm",
  "audio/mpeg": ".mp3",   "audio/mp4": ".m4a",     "audio/aac": ".aac",
  "audio/amr": ".amr",    "audio/wav": ".wav",     "audio/x-wav": ".wav",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/zip": ".zip",
  "application/vnd.android.package-archive": ".apk",
  "text/plain": ".txt",   "text/csv": ".csv",
};

// Ekstensi dari MIME. Return null (BUKAN ".bin") kalau tidak dikenal, supaya
// pemanggil bisa lanjut ke lapisan berikutnya.
export function extFromMime(mime) {
  return MIME_EXT[cleanMime(mime)] || null;
}

const startsWith = (buf, bytes, offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);
const asciiAt = (buf, offset, text) =>
  buf.length >= offset + text.length &&
  buf.subarray(offset, offset + text.length).toString("latin1") === text;

// Tebak ekstensi dari MAGIC BYTES isi file. `buf` cukup ~32 byte pertama.
// Return null kalau tidak ada pola yang cocok.
export function sniffExt(buf) {
  if (!buf || buf.length < 4) return null;

  if (startsWith(buf, [0xff, 0xd8, 0xff])) return ".jpg";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ".png";
  if (asciiAt(buf, 0, "GIF8")) return ".gif";
  if (asciiAt(buf, 0, "RIFF") && asciiAt(buf, 8, "WEBP")) return ".webp";
  if (asciiAt(buf, 0, "RIFF") && asciiAt(buf, 8, "WAVE")) return ".wav";
  if (asciiAt(buf, 0, "%PDF")) return ".pdf";
  if (asciiAt(buf, 0, "OggS")) return ".ogg";
  if (asciiAt(buf, 0, "#!AMR")) return ".amr";
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return ".webm"; // Matroska/WebM
  if (asciiAt(buf, 0, "ID3") || startsWith(buf, [0xff, 0xfb]) || startsWith(buf, [0xff, 0xf3])) return ".mp3";

  // ISO-BMFF: "ftyp" di offset 4 — inilah keluarga mp4/mov/3gp/heic. Brand di
  // offset 8 yang membedakan. INI POLA YANG MENCAKUP ~99% file .bin di
  // produksi (semuanya terdeteksi `file` sebagai "ISO Media").
  if (asciiAt(buf, 4, "ftyp")) {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (brand.startsWith("qt")) return ".mp4";   // QuickTime — lihat catatan di MIME_EXT
    if (brand.startsWith("3g")) return ".3gp";
    if (brand === "heic" || brand === "heix" || brand === "mif1") return ".heic";
    return ".mp4";
  }

  // ZIP — juga bungkus APK/docx/xlsx. Sengaja ditaruh PALING BAWAH & hanya
  // dipakai kalau MIME tidak memberi tahu yang lebih spesifik.
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return ".zip";

  return null;
}

// Tebakan terakhir dari mediaType yang sudah diketahui pemanggil.
const MEDIA_TYPE_EXT = { image: ".jpg", video: ".mp4", audio: ".ogg" };

// Titik masuk yang dipakai kode aplikasi. Lihat urutan penentuan di header.
export function resolveMediaExt({ buffer, mime, mediaType } = {}) {
  return extFromMime(mime)
    || sniffExt(buffer)
    || MEDIA_TYPE_EXT[mediaType]
    || ".bin";
}
