// Wrapper untuk Instagram Messaging API (jalur "Instagram Business Login", tanpa perlu Facebook Page).
// Dokumentasi: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/
// PENTING: access token berumur 60 hari -- perlu di-refresh manual atau dijadwalkan cron, lihat README.

const IG_API_BASE = "https://graph.instagram.com/v25.0";
const IG_ID = process.env.IG_BUSINESS_ACCOUNT_ID;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;

export async function sendInstagramText(recipientId, text) {
  const res = await fetch(`${IG_API_BASE}/${IG_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${IG_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Instagram sendMessage gagal (${res.status}): ${errBody}`);
  }

  return res.json();
}

// Ambil nama/username dari IGSID supaya inbox tidak cuma nampilin ID mentah.
// Dipanggil sekali saat pelanggan baru pertama kali chat.
export async function getInstagramProfile(igsid) {
  try {
    const res = await fetch(
      `${IG_API_BASE}/${igsid}?fields=name,username&access_token=${IG_ACCESS_TOKEN}`
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
