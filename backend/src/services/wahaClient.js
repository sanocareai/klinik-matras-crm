// Wrapper sederhana untuk panggil REST API WAHA.
// Dokumentasi: swagger di WAHA_BASE_URL/docs saat WAHA jalan.
// Field response/webhook bisa beda antar engine (WEBJS/NOWEB).

const WAHA_BASE_URL = process.env.WAHA_BASE_URL || "http://localhost:3000";
const WAHA_API_KEY  = process.env.WAHA_API_KEY  || "";
const WAHA_SESSION  = process.env.WAHA_SESSION  || "default";

function headers() {
  const h = { "Content-Type": "application/json" };
  if (WAHA_API_KEY) h["X-Api-Key"] = WAHA_API_KEY;
  return h;
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
    const res = await fetch(url, { headers: h });
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

// Cek status sesi WhatsApp
export async function getSessionStatus() {
  const res = await fetch(`${WAHA_BASE_URL}/api/sessions/${WAHA_SESSION}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Gagal cek status sesi WAHA (${res.status})`);
  return res.json();
}

// Bersihkan nomor WhatsApp dari suffix @c.us / @s.whatsapp.net / @lid
export function cleanPhoneNumber(rawId) {
  if (!rawId) return null;
  return rawId.split("@")[0];
}
