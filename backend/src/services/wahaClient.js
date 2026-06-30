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
// file = { mimetype: string, filename: string, data: string (base64) }
export async function sendMedia(to, file, caption) {
  const chatId = to.includes("@") ? to : `${to}@c.us`;

  let endpoint = "/api/sendFile";
  if (file.mimetype.startsWith("image/"))                endpoint = "/api/sendImage";
  else if (file.mimetype.startsWith("video/"))           endpoint = "/api/sendVideo";
  else if (file.mimetype.startsWith("audio/"))           endpoint = "/api/sendVoice";

  const body = { session: WAHA_SESSION, chatId, file };
  if (caption) body.caption = caption;

  const res = await fetch(`${WAHA_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`WAHA sendMedia gagal (${res.status}): ${await res.text()}`);
  return res.json();
}

// Download media dari pesan masuk (NOWEB: GET /api/{session}/messages/{id}/download)
// Return: { data: base64, mimetype, filename } atau null kalau gagal
export async function downloadMediaMessage(messageId) {
  try {
    const res = await fetch(
      `${WAHA_BASE_URL}/api/${WAHA_SESSION}/messages/${encodeURIComponent(messageId)}/download`,
      { headers: headers() }
    );
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return await res.json(); // { data, mimetype, filename }
    }
    // Kalau binary, convert manual
    const buffer = await res.arrayBuffer();
    return {
      data: Buffer.from(buffer).toString("base64"),
      mimetype: contentType.split(";")[0].trim(),
      filename: "media",
    };
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
export function cleanPhoneNumber(rawId) {
  if (!rawId) return null;
  return rawId.split("@")[0];
}
