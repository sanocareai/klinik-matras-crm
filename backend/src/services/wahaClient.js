// Wrapper sederhana untuk panggil REST API WAHA.
// Dokumentasi: swagger di WAHA_BASE_URL/docs saat WAHA jalan.
// Field response/webhook bisa beda antar engine (NOWEB/GOWS).

import { prisma } from "../db.js";

const WAHA_BASE_URL = process.env.WAHA_BASE_URL || "http://localhost:3000";
const WAHA_API_KEY  = process.env.WAHA_API_KEY  || "";
const WAHA_SESSION  = process.env.WAHA_SESSION  || "default";

function headers() {
  const h = { "Content-Type": "application/json" };
  if (WAHA_API_KEY) h["X-Api-Key"] = WAHA_API_KEY;
  return h;
}

// WAHA NOWEB kadang mengirim media URL dengan hostname 'localhost' di dalam webhook payload.
// Dari backend container, 'localhost' berarti backend itu sendiri — bukan WAHA.
// Fungsi ini replace hostname/port dengan yang ada di WAHA_BASE_URL (contoh: http://waha:3000).
function normalizeWahaUrl(url) {
  if (!url) return url;
  try {
    const base   = new URL(WAHA_BASE_URL);
    const parsed = new URL(url);
    parsed.hostname = base.hostname;
    parsed.port     = base.port || "";
    parsed.protocol = base.protocol;
    return parsed.toString();
  } catch {
    return url;
  }
}

// Kirim pesan teks
export async function sendText(to, text) {
  const rawDigits = to.split("@")[0];
  if (rawDigits.length > 13 && !rawDigits.startsWith("62")) {
    console.warn("[sendText] Input terlihat seperti LID bukan nomor WA:", to);
  }
  const chatId = to.includes("@") ? to : `${to}@c.us`;
  const res = await fetch(`${WAHA_BASE_URL}/api/sendText`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ session: WAHA_SESSION, chatId, text }),
  });
  if (!res.ok) throw new Error(`WAHA sendText gagal (${res.status}): ${await res.text()}`);
  return res.json();
}

// Kirim media (gambar / video / dokumen / suara)
// file   = { mimetype, filename, url }
// sendAs = "media"    → sendImage/sendVideo/sendVoice (tampil inline di WA)
//        = "document" → sendFile (tampil sebagai attachment)
export async function sendMedia(to, file, caption, sendAs = "media") {
  const chatId = to.includes("@") ? to : `${to}@c.us`;
  const mime   = file.mimetype || "";

  let endpoint = "/api/sendFile"; // default: dokumen

  if (sendAs === "media") {
    if (mime.startsWith("image/"))       endpoint = "/api/sendImage";
    else if (mime.startsWith("video/"))  endpoint = "/api/sendVideo";
    else if (mime.startsWith("audio/"))  endpoint = "/api/sendVoice";
    // mime lain di mode media → sendFile
  }
  // sendAs === "document" → tetap /api/sendFile

  const filePayload = file.url
    ? { url: file.url, mimetype: mime, filename: file.filename || "file" }
    : { data: file.data, mimetype: mime, filename: file.filename || "file" };

  const body = { session: WAHA_SESSION, chatId, file: filePayload };
  if (caption) body.caption = caption;
  // ptt = push-to-talk: wajib true agar WhatsApp kenali sebagai voice note (bukan file attachment biasa)
  if (endpoint === "/api/sendVoice") body.ptt = true;

  console.log(`[wahaClient] ${endpoint} → chatId=${chatId} mime=${mime} filePayload.url=${filePayload.url || "(base64)"}`);

  const res = await fetch(`${WAHA_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WAHA ${endpoint} gagal (${res.status}): ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// Download media dari URL langsung (dipakai saat webhook punya payload.media.url)
export async function downloadMediaFromUrl(url) {
  try {
    const h = {};
    if (WAHA_API_KEY) h["X-Api-Key"] = WAHA_API_KEY;
    const normalizedUrl = normalizeWahaUrl(url);
    console.log("[downloadMediaFromUrl] url:", url?.slice(0, 80), "→ normalized:", normalizedUrl?.slice(0, 80));
    const res = await fetch(normalizedUrl, { headers: h });
    if (!res.ok) {
      console.warn("[downloadMediaFromUrl] Gagal:", res.status, url);
      return null;
    }
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await res.json();
      return json?.data ? json : null;
    }
    const buffer = await res.arrayBuffer();
    return {
      data: Buffer.from(buffer).toString("base64"),
      mimetype: contentType.split(";")[0].trim() || "application/octet-stream",
      filename: "media",
    };
  } catch (e) {
    console.warn("[downloadMediaFromUrl] Error:", e.message);
    return null;
  }
}

// Download media via message ID endpoint
// Return: { data: base64, mimetype, filename } atau null kalau gagal
export async function downloadMediaMessage(messageId) {
  try {
    const res = await fetch(
      `${WAHA_BASE_URL}/api/${WAHA_SESSION}/messages/${encodeURIComponent(messageId)}/download`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.warn("[downloadMediaMessage] Gagal:", res.status, "untuk id:", messageId);
      return null;
    }
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await res.json();
      return json?.data ? json : null;
    }
    const buffer = await res.arrayBuffer();
    return {
      data: Buffer.from(buffer).toString("base64"),
      mimetype: contentType.split(";")[0].trim() || "application/octet-stream",
      filename: "media",
    };
  } catch (e) {
    console.warn("[downloadMediaMessage] Error:", e.message);
    return null;
  }
}

// Ambil URL foto profil kontak — return null kalau privasi dibatasi atau gagal (itu WAJAR)
export async function getProfilePicture(phone) {
  try {
    const chatId = `${phone}@c.us`;
    const res = await fetch(
      `${WAHA_BASE_URL}/api/${WAHA_SESSION}/contacts/profile-picture?contactId=${encodeURIComponent(chatId)}`,
      { headers: headers() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.profilePictureURL || null;
  } catch {
    return null;
  }
}

// Cek status sesi WhatsApp
export async function getSessionStatus() {
  const res = await fetch(`${WAHA_BASE_URL}/api/sessions/${WAHA_SESSION}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Gagal cek status sesi WAHA (${res.status})`);
  return res.json();
}

// Bersihkan nomor WhatsApp dari suffix @c.us / @s.whatsapp.net / @lid
// + strip device index WhatsApp multi-device (contoh: "628xxx:43@s.whatsapp.net" → "628xxx")
// + normalisasi format Indonesia: 0xxx → 62xxx
export function cleanPhoneNumber(rawId) {
  if (!rawId) return null;
  let num = rawId.split("@")[0].split(":")[0]; // strip domain, lalu strip :device-index
  if (num.startsWith("0")) num = "62" + num.slice(1);
  return num;
}

// Resolve LID (Local ID WhatsApp) ke nomor telepon asli, dengan caching ke DB.
// GOWS kadang mengirim JID format "xxx@lid" alih-alih nomor asli.
// Endpoint WAHA: GET /api/{session}/lids/{lid} → { lid, pn: "628xxx@c.us" } (pn bisa null)
export async function resolvePhoneFromLid(lid, session) {
  if (!lid) return null;
  // Strip suffix @lid kalau masih ada
  const lidRaw = lid.split("@")[0];
  if (!lidRaw) return null;

  // 1. Cek cache di tabel LidMapping
  try {
    const cached = await prisma.lidMapping.findUnique({ where: { lid: lidRaw } });
    if (cached) {
      console.log("[resolvePhoneFromLid] Cache hit:", lidRaw, "→", cached.phoneNumber);
      return cached.phoneNumber;
    }
  } catch (e) {
    console.warn("[resolvePhoneFromLid] Cache lookup error:", e.message);
  }

  // 2. Panggil WAHA API
  const sessionToUse = session || WAHA_SESSION;
  try {
    const res = await fetch(
      `${WAHA_BASE_URL}/api/${encodeURIComponent(sessionToUse)}/lids/${encodeURIComponent(lidRaw)}`,
      { headers: headers() }
    );
    if (res.ok) {
      const data = await res.json();
      const pn = data.pn; // format "628xxx@c.us" atau null
      if (pn) {
        const phone = cleanPhoneNumber(pn);
        if (phone) {
          // 3. Simpan ke cache
          await prisma.lidMapping.upsert({
            where:  { lid: lidRaw },
            create: { lid: lidRaw, phoneNumber: phone, session: sessionToUse },
            update: { phoneNumber: phone, session: sessionToUse },
          }).catch(() => {}); // cache write tidak boleh crash proses utama
          console.log("[resolvePhoneFromLid] Berhasil resolve:", lidRaw, "→", phone);
          return phone;
        }
      }
      console.log("[resolvePhoneFromLid] WAHA API kembalikan pn=null untuk LID:", lidRaw);
    } else {
      console.warn("[resolvePhoneFromLid] WAHA API error:", res.status, "LID:", lidRaw);
    }
  } catch (e) {
    console.warn("[resolvePhoneFromLid] Fetch error:", e.message);
  }

  // 4. Fallback: cari di tabel Customer — mungkin LID ini sudah tersimpan sebagai phone (data lama)
  try {
    const customer = await prisma.customer.findFirst({
      where:  { phone: lidRaw },
      select: { phone: true },
    });
    if (customer?.phone) {
      console.log("[resolvePhoneFromLid] Fallback Customer record ditemukan untuk LID:", lidRaw);
      return customer.phone; // ini masih LID, tapi setidaknya match ke customer yang ada
    }
  } catch (e) {
    console.warn("[resolvePhoneFromLid] Customer lookup error:", e.message);
  }

  // 5. Semua cara gagal
  console.warn(`[resolvePhoneFromLid] LID ${lidRaw} tidak bisa diresolve — pesan mungkin tersimpan dengan LID, perlu fix manual nanti`);
  return null;
}

// Ambil riwayat pesan dari WAHA untuk 1 nomor (limit pesan terbaru)
// Return: array message object, atau [] kalau gagal/tidak tersedia
export async function fetchChatHistory(phone, limit = 50) {
  const chatId = `${phone}@c.us`;
  try {
    const res = await fetch(
      `${WAHA_BASE_URL}/api/${WAHA_SESSION}/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&downloadMedia=false`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.warn("[fetchChatHistory] Gagal untuk", phone, "status:", res.status);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : (data.messages || []);
  } catch (e) {
    console.warn("[fetchChatHistory] Error untuk", phone, e.message);
    return [];
  }
}
