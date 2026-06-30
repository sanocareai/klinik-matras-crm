// Wrapper sederhana untuk panggil REST API WAHA.
// Dokumentasi resmi: https://waha.devlike.pro -> Swagger UI di WAHA_BASE_URL saat WAHA jalan.
// PENTING: field response/webhook WAHA bisa sedikit berbeda antar engine (WEBJS/NOWEB/GOWS).
// Saat testing pertama kali, cek payload asli via log di webhooks.js sebelum asumsikan formatnya.

const WAHA_BASE_URL = process.env.WAHA_BASE_URL || "http://localhost:3000";
const WAHA_API_KEY = process.env.WAHA_API_KEY || "";
const WAHA_SESSION = process.env.WAHA_SESSION || "default";

function headers() {
  const h = { "Content-Type": "application/json" };
  if (WAHA_API_KEY) h["X-Api-Key"] = WAHA_API_KEY;
  return h;
}

// Kirim pesan teks. `to` harus format internasional tanpa "+" dan tanpa simbol, contoh: 6281234567890
export async function sendText(to, text) {
  const chatId = to.includes("@") ? to : `${to}@c.us`;
  const res = await fetch(`${WAHA_BASE_URL}/api/sendText`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      session: WAHA_SESSION,
      chatId,
      text,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`WAHA sendText gagal (${res.status}): ${errBody}`);
  }

  return res.json();
}

// Cek status sesi WhatsApp (WORKING, SCAN_QR_CODE, STOPPED, dll)
export async function getSessionStatus() {
  const res = await fetch(`${WAHA_BASE_URL}/api/sessions/${WAHA_SESSION}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Gagal cek status sesi WAHA (${res.status})`);
  return res.json();
}

// Helper: bersihkan nomor WhatsApp dari suffix @c.us / @s.whatsapp.net jadi nomor polos
export function cleanPhoneNumber(rawId) {
  if (!rawId) return null;
  return rawId.split("@")[0];
}

// Sync nama pelanggan ke kontak WhatsApp (WAHA Core 2026.6+).
// Endpoint: PUT /api/{session}/contacts/profile-photo tidak ada, tapi PUT contacts ada.
// Payload disesuaikan dengan spec WAHA terbaru.
// Return: true kalau berhasil, false kalau gagal (jangan throw — ini best-effort).
export async function updateContactName(phone, name) {
  const contactId = phone.includes("@") ? phone : `${phone}@c.us`;
  try {
    // Coba endpoint WAHA Core yang baru (per-session path)
    const res = await fetch(`${WAHA_BASE_URL}/api/${WAHA_SESSION}/contacts`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ contactId, firstName: name }),
    });
    if (res.ok) return true;

    // Fallback ke endpoint lama (WAHA sebelum 2026)
    const res2 = await fetch(`${WAHA_BASE_URL}/api/contacts`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ session: WAHA_SESSION, contactId, firstName: name }),
    });
    if (res2.ok) return true;

    const errText = await res2.text();
    console.warn("Sync nama kontak WA tidak didukung engine ini:", errText.slice(0, 100));
    return false;
  } catch (err) {
    console.warn("Sync nama kontak WA error:", err.message);
    return false;
  }
}
