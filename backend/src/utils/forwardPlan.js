// Menentukan CARA meneruskan (forward) satu pesan ke percakapan lain.
//
// BUG NYATA YANG MELAHIRKAN FILE INI (1 Oktober 2026). POST /:id/forward dulu
// memperlakukan SEMUA pesan non-teks sebagai "media berupa file":
//   - Kontak & lokasi TIDAK punya file (mediaUrl selalu null). Forward lalu
//     mencoba "mengunduh ulang" file yang tidak pernah ada → 502 "Media pesan
//     ini belum berhasil diunduh" (terjadi 4x berturut-turut di produksi pada
//     pesan kontak 30 Sep 2026). Kalau lolos pun, jatuh ke cabang teks dan
//     yang terkirim ke penerima adalah JSON mentah {"contacts":[...]}.
//   - MIME dipatok image/jpeg / video/mp4 / application/octet-stream apa pun
//     isi sebenarnya (PNG, WebP stiker, MOV, PDF).
// Di sini keputusan itu dipisah jadi fungsi murni supaya bisa dites tanpa WAHA.

import path from "path";
import { cleanMime } from "./mediaExt.js";

// Kebalikan dari MIME_EXT di mediaExt.js (hanya yang relevan untuk kirim).
const EXT_MIME = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif",
  ".bmp": "image/bmp", ".tiff": "image/tiff",
  ".mp4": "video/mp4", ".webm": "video/webm", ".3gp": "video/3gpp", ".3g2": "video/3gpp2",
  ".mkv": "video/x-matroska",
  ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac",
  ".amr": "audio/amr", ".wav": "audio/wav",
  ".pdf": "application/pdf", ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip", ".txt": "text/plain", ".csv": "text/csv",
  ".apk": "application/vnd.android.package-archive",
};

// Tebakan terakhir kalau ekstensi tidak dikenal — sama dengan perilaku lama,
// tapi sekarang cuma jadi cadangan, bukan satu-satunya sumber.
const MEDIA_TYPE_MIME = {
  image: "image/jpeg", sticker: "image/webp", video: "video/mp4",
  audio: "audio/ogg", document: "application/octet-stream",
};

export function mimeDariNamaFile(namaFile, mediaType) {
  const ext = path.extname(String(namaFile || "")).toLowerCase();
  return EXT_MIME[ext] || MEDIA_TYPE_MIME[mediaType] || "application/octet-stream";
}

// Teks pengganti yang diisi parser saat media gagal diunduh (lihat
// MEDIA_TYPE_PLACEHOLDER di parseHistoryMessage.js). Ini BUKAN keterangan dari
// pengirim, jadi tidak boleh ikut terkirim sebagai caption foto/video.
const PLACEHOLDER_MEDIA = new Set(["[Foto]", "[Video]", "[VN]", "[Dokumen]", "[Stiker]", "[Media]"]);

export function captionForward(content) {
  const teks = (content || "").trim();
  return PLACEHOLDER_MEDIA.has(teks) ? "" : teks;
}

// vCard menyimpan nomor sebagai teks bebas ("+62 812-3456-789"). Cuma angka
// yang dikirim ke WAHA. Nomor luar negeri SENGAJA tidak ditolak (ada
// pelanggan +20/+966/+44/+855) — hanya awalan lokal "0" yang dibakukan ke 62.
function angkaNomor(phone) {
  let n = String(phone || "").replace(/\D/g, "");
  if (n.startsWith("0")) n = "62" + n.slice(1);
  return n.length >= 8 ? n : null;
}

function parseJson(content) {
  try { return JSON.parse(content); } catch { return null; }
}

/**
 * @param {{content?: string, mediaType?: string|null, mediaUrl?: string|null, externalId?: string|null}} msg
 * @returns {{kind:"contact", contacts:Array}
 *   | {kind:"location", lat:number, lng:number, title:string|null}
 *   | {kind:"media", mimetype:string, filename:string, caption:string, sendAs:string}
 *   | {kind:"needsDownload"}
 *   | {kind:"text", text:string}
 *   | {kind:"error", error:string}}
 */
export function rencanaForward(msg) {
  const { mediaType, mediaUrl, content } = msg;

  // Tipe terstruktur dicek DULU — mereka tidak punya file, jadi jangan sampai
  // masuk jalur "unduh ulang media".
  if (mediaType === "contact") {
    const daftar = parseJson(content)?.contacts;
    const contacts = (Array.isArray(daftar) ? daftar : [])
      .map((c) => {
        const nomor = angkaNomor(c?.phone);
        return nomor ? { fullName: c.name || "Kontak", phoneNumber: `+${nomor}`, whatsappId: nomor } : null;
      })
      .filter(Boolean);
    if (!contacts.length) return { kind: "error", error: "Kontak ini tidak punya nomor yang bisa diteruskan" };
    return { kind: "contact", contacts };
  }

  if (mediaType === "location") {
    const loc = parseJson(content);
    const lat = Number(loc?.lat);
    const lng = Number(loc?.lng);
    if (loc?.lat == null || loc?.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { kind: "error", error: "Lokasi ini tidak punya koordinat yang bisa diteruskan" };
    }
    return { kind: "location", lat, lng, title: loc.name || null };
  }

  if (mediaType === "poll") {
    return { kind: "error", error: "Polling belum bisa diteruskan — salin pertanyaannya secara manual" };
  }

  if (mediaType) {
    if (!mediaUrl) return { kind: "needsDownload" };
    const filename = path.basename(String(mediaUrl).split("?")[0]) || "file";
    return {
      kind: "media",
      mimetype: cleanMime(mimeDariNamaFile(filename, mediaType)),
      filename,
      caption: captionForward(content),
      sendAs: mediaType === "document" ? "document" : "media",
    };
  }

  const text = (content || "").trim();
  if (!text || text === "[Pesan tidak didukung]") {
    return { kind: "error", error: "Jenis pesan ini belum bisa diteruskan" };
  }
  return { kind: "text", text: content };
}
