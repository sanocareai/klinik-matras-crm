// Wrapper sederhana untuk panggil REST API WAHA.
// Dokumentasi: swagger di WAHA_BASE_URL/docs saat WAHA jalan.
// Field response/webhook bisa beda antar engine (NOWEB/GOWS).

import { prisma } from "../db.js";

const WAHA_BASE_URL = process.env.WAHA_BASE_URL || "http://localhost:3000";
const WAHA_API_KEY  = process.env.WAHA_API_KEY  || "";
const WAHA_SESSION  = process.env.WAHA_SESSION  || "default";

// Dipakai HANYA untuk notifikasi ops internal (backup gagal, WAHA down) yang
// kirim ke nomor admin tetap — BUKAN bagian dari alur balasan customer, jadi
// tidak ada conversation.sessionId untuk diambil. JANGAN pakai ini untuk
// mengirim balasan ke customer manapun (lihat catatan di sendText/sendMedia).
export function getDefaultOpsSession() {
  return WAHA_SESSION;
}

// 2 session WA aktif (lihat CLAUDE.md §"Multi-session WAHA aktif") — dipakai
// fetchChatHistory sebagai fallback kalau session yang diminta tidak punya
// riwayat (chat mungkin sebenarnya ada di sesi lain).
export const KNOWN_SESSIONS = ["CS-1", "CS-2"];

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
// quotedMessageId: WAHA externalId pesan yang dikutip (untuk fitur reply/quote), opsional
// session: WAJIB DIISI oleh caller — nomor WA aktif ada 2 (CS-1/CS-2, lihat
// CLAUDE.md), tidak boleh diam-diam pakai WAHA_SESSION global (itu penyebab
// bug kritis "balasan keluar lewat sesi salah"). Caller HARUS ambil dari
// conversation.sessionId — lihat conversations.js.
export async function sendText(to, text, quotedMessageId = null, session) {
  if (!session) {
    throw new Error("sendText: parameter 'session' wajib diisi (tidak boleh fallback ke WAHA_SESSION global)");
  }
  const rawDigits = to.split("@")[0];
  if (rawDigits.length > 13 && !rawDigits.startsWith("62")) {
    console.warn("[sendText] Input terlihat seperti LID bukan nomor WA:", to);
  }
  const chatId = to.includes("@") ? to : `${to}@c.us`;
  const body = { session, chatId, text };
  if (quotedMessageId) body.quotedMessageId = quotedMessageId;
  const res = await fetch(`${WAHA_BASE_URL}/api/sendText`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`WAHA sendText gagal (${res.status}): ${await res.text()}`);
  return res.json();
}

// Kirim media (gambar / video / dokumen / suara)
// file   = { mimetype, filename, url }
// sendAs = "media"    → sendImage/sendVideo/sendVoice (tampil inline di WA)
//        = "document" → sendFile (tampil sebagai attachment)
// session: WAJIB DIISI caller (lihat catatan di sendText di atas).
export async function sendMedia(to, file, caption, sendAs = "media", session) {
  if (!session) {
    throw new Error("sendMedia: parameter 'session' wajib diisi (tidak boleh fallback ke WAHA_SESSION global)");
  }
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

  const body = { session, chatId, file: filePayload };
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

// Kirim read receipt ke WhatsApp — supaya pesan berubah jadi centang biru di HP customer.
// Dari log WAHA: PUT /chats/{id}/read → 404 (tidak ada di versi ini)
//               POST /api/sendSeen   → 201 (berhasil) ← yang kita pakai
// session: WAJIB DIISI caller (lihat catatan di sendText). Return: true kalau
// berhasil, false kalau gagal ATAU session tidak diisi (gagal = wajar, tidak
// crash proses lain — read receipt bukan operasi kritis).
export async function markChatAsRead(phone, session) {
  if (!phone || !session) return false;
  const chatId = `${phone}@c.us`;
  try {
    const res = await fetch(`${WAHA_BASE_URL}/api/sendSeen`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ session, chatId }),
    });
    if (res.ok) return true;
    console.warn("[markChatAsRead] sendSeen gagal:", res.status, "phone:", phone);
    return false;
  } catch (e) {
    console.warn("[markChatAsRead] Error:", e.message);
    return false;
  }
}

// Ambil info grup (nama/subject) dari WAHA by groupJid — dipakai webhooks.js
// saat payload webhook tidak menyertakan nama grup yang bisa diandalkan.
// WAHA REST: GET /api/{session}/groups/{id} → { id, subject, ... }.
// Return: nama grup (string) atau null kalau gagal/tidak tersedia (WAJAR,
// caller fallback ke groupJid mentah).
export async function getGroupInfo(groupJid, session = WAHA_SESSION) {
  try {
    const res = await fetch(
      `${WAHA_BASE_URL}/api/${encodeURIComponent(session)}/groups/${encodeURIComponent(groupJid)}`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.warn("[getGroupInfo] Gagal:", res.status, "groupJid:", groupJid);
      return null;
    }
    const data = await res.json();
    // WAHA GOWS balikin field PascalCase "Name" (bukan "name"/"subject" —
    // itu asumsi awal yang salah, dikonfirmasi via curl manual return 200
    // dengan body { "Name": "SANO TIM PRODUKSI", ... }). Fallback name/subject
    // dipertahankan untuk kompatibilitas versi WAHA/engine lain.
    return data.Name || data.name || data.subject || null;
  } catch (e) {
    console.warn("[getGroupInfo] Error:", e.message);
    return null;
  }
}

// Ambil URL foto profil kontak — return null kalau privasi dibatasi atau gagal (itu WAJAR)
//
// BUG LAMA (fix): endpoint ini SEBELUMNYA dipanggil dengan pola path-style
// `/api/{session}/contacts/profile-picture?contactId=...` (menyamakan pola
// dengan getGroupInfo di atas) — TERNYATA salah untuk resource /contacts:
// dikonfirmasi via curl manual, pola itu kena-parse WAHA sebagai
// `GET /api/{session}/contacts/{id}` dengan id harfiah "profile-picture",
// balikin `{"id":"profile-picture@c.us","name":"","pushname":""}` (bukan 404,
// makanya lolos !res.ok tanpa ketahuan) — `data.profilePictureURL` SELALU
// undefined, foto profil customer TIDAK PERNAH tersimpan sejak fitur ini ada.
// Pola yang BENAR (query-style, session sebagai query param bukan path
// segment): `/api/contacts/profile-picture?session=X&contactId=...` — beda
// dari /groups yang justru path-style. Session WAJIB diisi caller (bukan
// fallback WAHA_SESSION global) — sama seperti sendText/sendMedia, supaya
// selalu query session yang benar-benar menangani percakapan itu (CS-1/CS-2).
export async function getProfilePicture(phone, session) {
  try {
    const chatId = `${phone}@c.us`;
    const res = await fetch(
      `${WAHA_BASE_URL}/api/contacts/profile-picture?session=${encodeURIComponent(session)}&contactId=${encodeURIComponent(chatId)}`,
      { headers: headers() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.profilePictureURL || null;
  } catch {
    return null;
  }
}

// Ambil info kontak tersimpan dari WAHA — dipakai resolveCustomerName di
// webhooks.js untuk prioritaskan nama TERSIMPAN di HP CS (paling otoritatif)
// di atas pushName (nama yang customer set sendiri di profil WA-nya).
// WAHA (GOWS, dikonfirmasi via curl manual) balikin:
//   { id, name, pushname } — "name" STRING KOSONG kalau kontak belum
//   tersimpan di HP (BUKAN null/absent), "pushname" selalu ada kalau
//   customer sudah pernah set nama profil WA.
// Return null kalau gagal/tidak ada respons sama sekali (WAJAR, caller
// fallback ke pushName dari payload pesan).
export async function getContactInfo(phone, session) {
  try {
    const chatId = `${phone}@c.us`;
    const res = await fetch(
      `${WAHA_BASE_URL}/api/contacts?session=${encodeURIComponent(session)}&contactId=${encodeURIComponent(chatId)}`,
      { headers: headers() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { name: data.name || null, pushname: data.pushname || null };
  } catch (e) {
    console.warn("[getContactInfo] Error:", e.message);
    return null;
  }
}

// Cek status sesi WhatsApp
// session opsional — default tetap WAHA_SESSION (perilaku lama tidak berubah).
// Dipakai Pengaturan > Status WhatsApp untuk cek CS-1/CS-2 secara terpisah
// (multi-session WAHA, lihat CLAUDE.md).
export async function getSessionStatus(session = WAHA_SESSION) {
  const res = await fetch(`${WAHA_BASE_URL}/api/sessions/${session}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`Gagal cek status sesi WAHA (${res.status})`);
  return res.json();
}

// Bersihkan nomor WhatsApp dari suffix @c.us / @s.whatsapp.net / @lid
// + strip device index WhatsApp multi-device (contoh: "628xxx:43@s.whatsapp.net" → "628xxx")
// + normalisasi format Indonesia: 0xxx → 62xxx
// Fungsi ini SYNC dan low-level — dipakai internal oleh normalizePhoneNumber & resolvePhoneFromLid.
export function cleanPhoneNumber(rawId) {
  if (!rawId) return null;
  let num = rawId.split("@")[0].split(":")[0]; // strip domain, lalu strip :device-index
  if (num.startsWith("0")) num = "62" + num.slice(1);
  if (num.startsWith("+62")) num = "62" + num.slice(3);
  return num || null;
}

// ─── SATU FUNGSI NORMALISASI UTAMA ────────────────────────────────────────────
// Semua kode yang terima JID dari WAHA WAJIB pakai fungsi ini.
// Menangani: strip @domain, strip :device-index, normalize 0xxx→62xxx,
// dan kalau format @lid → resolve via WAHA API dengan fallback berlapis.
// Return: nomor bersih "628xxx" atau null kalau gagal total (jangan buat Customer dari null).
export async function normalizePhoneNumber(rawJid, session) {
  if (!rawJid) return null;

  // Format @lid → resolve via WAHA API (ada cache di tabel LidMapping)
  if (rawJid.includes("@lid")) {
    const lidRaw = rawJid.split("@")[0].split(":")[0];
    return await resolvePhoneFromLid(lidRaw, session);
  }

  // Normalisasi biasa: strip domain, device index, +62 prefix
  const phone = cleanPhoneNumber(rawJid);
  return phone || null;
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

// Ambil daftar chat aktif dari WAHA (untuk reconciliation job)
// sortBy: WAHA hanya terima "conversationTimestamp" | "id" | "name" (bukan lastMessageAt)
// Return: array chat object { id, name, unreadCount, timestamp, ... } atau [] kalau gagal
// session opsional — default tetap WAHA_SESSION (perilaku lama tidak
// berubah). Dipakai scripts/backfill-session-id.js untuk cek chat ada di
// CS-1 atau CS-2 (multi-session WAHA, lihat CLAUDE.md).
export async function getChats(limit = 20, session = WAHA_SESSION) {
  try {
    const res = await fetch(
      `${WAHA_BASE_URL}/api/${session}/chats?limit=${limit}&sortBy=conversationTimestamp`,
      { headers: headers() }
    );
    if (!res.ok) {
      console.warn("[getChats] Gagal:", res.status, await res.text().catch(() => ""));
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : (data.chats || []);
  } catch (e) {
    console.warn("[getChats] Error:", e.message);
    return [];
  }
}

// Ambil SATU halaman riwayat pesan dari WAHA (internal, dipakai fetchChatHistory).
// downloadMedia=true (Fix 2, bug bubble kosong) — supaya msg.media.url
// terisi kalau WAHA berhasil download+decrypt. Kalau WAHA gagal/lambat
// untuk media tertentu, msg.media tetap null utk pesan itu SAJA (tidak
// gagalkan seluruh halaman) — parseHistoryMessage sudah gracefully
// fallback ke placeholder teks sesuai tipe kalau mediaUrl tidak tersedia,
// jadi tidak perlu mekanisme fetch-on-demand terpisah di jalur sync ini.
async function fetchChatHistoryPage(chatId, session, pageSize, offset) {
  const res = await fetch(
    `${WAHA_BASE_URL}/api/${session}/chats/${encodeURIComponent(chatId)}/messages?limit=${pageSize}&offset=${offset}&downloadMedia=true`,
    { headers: headers() }
  );
  if (!res.ok) {
    throw new Error(`status ${res.status}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : (data.messages || []);
}

// Ambil riwayat pesan dari WAHA untuk 1 nomor — PAGINASI PENUH (bukan 1 kali
// fetch limit tetap): fetch berulang pakai limit+offset sampai habis (halaman
// balik lebih sedikit dari pageSize) atau maxMessages tercapai (safety cap,
// cegah runaway loop untuk chat dengan riwayat sangat panjang). Log jumlah
// per halaman.
//
// session: preferredSession opsional — kalau diisi dicoba duluan, kalau
// hasil kosong (0 pesan di halaman pertama) fallback coba KNOWN_SESSIONS
// lain (chat mungkin sebenarnya ada di sesi WA lain). Kalau tidak diisi,
// coba semua KNOWN_SESSIONS berurutan.
//
// Return: array message object (urutan gabungan semua halaman), atau []
// kalau gagal/tidak tersedia di session manapun.
export async function fetchChatHistory(phone, preferredSession, opts = {}) {
  const { maxMessages = 1000, pageSize = 100 } = opts;
  // phone bisa berupa nomor polos ("628xxx") ATAU JID lengkap yang sudah
  // ada @-nya (dipakai scripts/fix-empty-messages.js utk grup — groupJid
  // sudah dalam format "xxx@g.us", JANGAN ditambah "@c.us" lagi).
  const chatId = phone.includes("@") ? phone : `${phone}@c.us`;
  const sessionsToTry = preferredSession
    ? [preferredSession, ...KNOWN_SESSIONS.filter((s) => s !== preferredSession)]
    : KNOWN_SESSIONS;

  for (const session of sessionsToTry) {
    const allMessages = [];
    let offset = 0;
    let pageNum = 1;
    const maxPages = Math.ceil(maxMessages / pageSize);

    try {
      while (pageNum <= maxPages) {
        const page = await fetchChatHistoryPage(chatId, session, pageSize, offset);
        console.log(`[fetchChatHistory] ${phone} session=${session} halaman ${pageNum}: ${page.length} pesan (offset=${offset})`);
        if (page.length === 0) break;
        allMessages.push(...page);
        if (page.length < pageSize) break; // halaman terakhir — WAHA balikin lebih sedikit dari yang diminta
        offset += pageSize;
        pageNum++;
      }
    } catch (e) {
      console.warn(`[fetchChatHistory] Gagal untuk ${phone} session=${session}:`, e.message);
      continue; // coba session berikutnya
    }

    if (allMessages.length > 0) return allMessages;
    // 0 pesan di session ini — coba session lain sebelum menyerah
  }

  console.warn(`[fetchChatHistory] ${phone} — tidak ada riwayat di session manapun (${sessionsToTry.join(", ")})`);
  return [];
}
