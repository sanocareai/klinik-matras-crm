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

// Sync nama pelanggan ke kontak WhatsApp — fire & forget friendly (return bool, jangan throw)
export async function updateContactName(phone, name) {
  const chatId = phone.includes("@") ? phone : `${phone}@c.us`;
  try {
    const res = await fetch(`${WAHA_BASE_URL}/api/contacts`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({
        session: WAHA_SESSION,
        contactId: chatId,
        firstName: name,
      }),
    });
    if (!res.ok) {
      console.error("Gagal update nama kontak WhatsApp:", await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Error sync nama kontak WA:", err.message);
    return false;
  }
}
