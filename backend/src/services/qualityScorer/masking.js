// ═══ MASKING TEKS BEBAS — AI Conversation Quality Scorer ═════════════════
// BEDA dari maskPhone()/maskEmail() di mcp/security.js: fungsi-fungsi itu
// menyamarkan FIELD YANG SUDAH DIKETAHUI (nomor HP tersimpan di Customer.
// phone), dipakai untuk MENAMPILKAN data ke user CRM. Di sini soalnya beda:
// TRANSKRIP PESAN adalah teks bebas — customer/sales bisa saja mengetik
// nomor HP, email, atau alamat di TENGAH kalimat ("hub saya di 0812xxx" atau
// "alamat saya di Jl. ..."), dan itu HARUS disaring SEBELUM dikirim ke pihak
// ketiga (LLM), bukan opsional. Ini scrubber pola-teks, bukan mask-field.
//
// Nama customer juga diganti ke pseudonim stabil ("Pelanggan") — nama
// adalah data pribadi langsung, dan sales sering menyebut nama customer
// berulang kali di transkrip, jadi diganti di SEMUA kemunculan.

// Nomor HP Indonesia: 08xx / +62xx / 62xx, 9-14 digit setelah prefiks —
// dan pola umum lain (urutan 8+ digit berturutan) sebagai jaring kedua
// supaya nomor yang diketik tanpa prefiks standar (mis. disisipkan spasi/
// strip) tetap tertangkap.
const PHONE_PATTERNS = [
  /(?:\+?62|0)8\d{8,12}/g, // 08xxxxxxxxxx / +628xxxxxxxxxx
  /\b\d{9,14}\b/g,          // jaring kedua: urutan 9-14 digit polos
];

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Saring nomor HP & email dari teks bebas. Dipanggil ke SETIAP pesan
 * (inbound & outbound) sebelum masuk transcript yang dikirim ke LLM.
 */
export function scrubPersonalDataFromText(text) {
  if (!text) return text;
  let out = text;
  for (const pattern of PHONE_PATTERNS) out = out.replace(pattern, "[nomor disamarkan]");
  out = out.replace(EMAIL_PATTERN, "[email disamarkan]");
  return out;
}

/**
 * Ganti SEMUA kemunculan nama asli customer (case-insensitive, termasuk
 * kemungkinan cuma nama depan) dengan pseudonim stabil, di teks pesan
 * MAUPUN di label transcript ("Customer: ..."). null-safe kalau nama
 * customer kosong/tidak ada.
 */
export function pseudonymizeName(text, realName, pseudonym = "Pelanggan") {
  if (!text || !realName) return text;
  const parts = realName.trim().split(/\s+/).filter((p) => p.length >= 3); // skip partikel pendek ("de", "el")
  let out = text;
  for (const part of parts) {
    const escaped = part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "gi"), pseudonym);
  }
  return out;
}

/**
 * Terapkan SEMUA lapisan masking ke satu pesan transcript.
 */
export function maskMessageContent(text, customerName) {
  const noContact = scrubPersonalDataFromText(text);
  return pseudonymizeName(noContact, customerName);
}
