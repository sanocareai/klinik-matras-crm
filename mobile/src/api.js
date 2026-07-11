// Client API untuk backend CRM Klinik Matras.
// Sama persis dengan frontend/src/api.js versi web, tapi pakai AsyncStorage
// (React Native tidak punya localStorage) dan base URL absolut ke server produksi.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, UploadType } from "expo-file-system";

// Alamat server default — bisa diubah di layar Login (untuk testing server lokal)
export const DEFAULT_SERVER = "https://app.sanomatrassehat.com";

const TIMEOUT_MS = 30000; // 30 detik — cegah request hang selamanya

let serverUrl = DEFAULT_SERVER;
let token = null;
let onUnauthorized = null; // callback dari AuthContext saat sesi berakhir

export function configureApi({ server, jwt, unauthorizedHandler }) {
  if (server !== undefined) serverUrl = server || DEFAULT_SERVER;
  if (jwt !== undefined) token = jwt;
  if (unauthorizedHandler !== undefined) onUnauthorized = unauthorizedHandler;
}

export function getServerUrl() {
  return serverUrl;
}

// Dipakai src/lib/socket.js untuk auth handshake Socket.IO (butuh token JWT
// yang sama persis dengan yang dipakai request REST di atas).
export function getToken() {
  return token;
}

// mediaUrl dari backend berbentuk relatif ("/uploads/xxx") — jadikan absolut
export function mediaUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith("http")) return pathOrUrl;
  return serverUrl + pathOrUrl;
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${serverUrl}/api${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    if (res.status === 401) {
      token = null;
      await AsyncStorage.removeItem("token");
      if (onUnauthorized) onUnauthorized();
      throw new Error("Sesi berakhir, silakan login kembali");
    }
    if (!res.ok) {
      const text = await res.text();
      let msg = "Terjadi kesalahan";
      try { msg = JSON.parse(text).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Koneksi timeout — coba lagi");
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Upload multipart (kirim media) — lewat expo-file-system File.upload(), BUKAN
// fetch + FormData.append({ uri, name, type }) gaya lama. Di New Architecture,
// FormData tidak lagi menerima object { uri, name, type } sebagai "part" —
// bikin error "unsupported FormData part implementation" saat file dilampirkan
// (lihat AGENTS.md — API expo berubah banyak di SDK 57, FormData RN juga ikut
// berubah perilakunya di New Architecture). File.upload() baca file dari path
// asli via native filesystem module (bukan lewat FormData bridge JS↔native),
// jadi tidak kena masalah ini.
//
// file: { uri, name, type } — name TIDAK dipakai lagi sebagai nama part (API
// baru tidak punya opsi override nama file di multipart, cuma fieldName/
// mimeType) — tapi backend tidak pernah bergantung pada nama file utk logika
// (mediaType & keputusan convert-ke-ogg pakai `file.mimetype`, bukan
// ekstensi nama file — lihat backend/src/routes/conversations.js), jadi aman.
// fields: object string key-value tambahan (caption, sendAs, dst) — dikirim
// sebagai form field biasa lewat `parameters`.
async function uploadFile(path, file, fields) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // media bisa besar — 2 menit

  try {
    const fileRef = new File(file.uri);
    const result = await fileRef.upload(`${serverUrl}/api${path}`, {
      httpMethod: "POST",
      uploadType: UploadType.MULTIPART,
      fieldName: "file",
      mimeType: file.type,
      parameters: fields,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    });
    if (result.status === 401) {
      token = null;
      await AsyncStorage.removeItem("token");
      if (onUnauthorized) onUnauthorized();
      throw new Error("Sesi berakhir, silakan login kembali");
    }
    if (result.status < 200 || result.status >= 300) {
      let msg = "Terjadi kesalahan";
      try { msg = JSON.parse(result.body).error || msg; } catch {}
      throw new Error(msg);
    }
    return JSON.parse(result.body);
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Koneksi timeout — coba lagi");
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildQuery(params) {
  const q = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return q ? "?" + q : "";
}

export const api = {
  // Auth
  login: (email, password) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  getMe: () => request("/users/me"),

  // Push notification
  // extra: { userId, platform } — userId sebenarnya sudah otomatis ke-scope
  // dari JWT di endpoint (req.user.id), disertakan eksplisit sesuai spec;
  // backend saat ini belum simpan/pakai field platform (lihat PushToken
  // model di schema.prisma) — aman dikirim, cuma diabaikan sampai backend
  // ditambah kolomnya.
  savePushToken: (token, extra = {}) =>
    request("/users/me/push-token", { method: "POST", body: JSON.stringify({ token, ...extra }) }),
  deletePushToken: (token) =>
    request("/users/me/push-token", { method: "DELETE", body: JSON.stringify({ token }) }),

  // Percakapan (Inbox)
  // params: { status, search, assignedToId, cursor, limit } — semua opsional.
  // ⚠️ Response { data, nextCursor } (cursor pagination) — lihat
  // backend/src/routes/conversations.js, dikonsumsi lewat useConversations.js.
  getConversations: (params) => request("/conversations" + buildQuery(params)),
  getConversationCounts: () => request("/conversations/counts"),
  getUnreadCount: () => request("/conversations/unread-count"),
  getMessages: (conversationId) =>
    request(`/conversations/${conversationId}/messages`),
  // Tandai sudah dibaca (unreadCount=0) tanpa fetch seluruh riwayat pesan —
  // dipakai saat tap percakapan unread / swipe "tandai dibaca" di Inbox.
  markConversationRead: (conversationId) =>
    request(`/conversations/${conversationId}/read`, { method: "POST" }),
  sendMessage: (conversationId, content, quotedMessageId = null, replyToId = null) =>
    request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, quotedMessageId, replyToId }),
    }),
  updateConversation: (id, data) =>
    request(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  takeoverConversation: (id) =>
    request(`/conversations/${id}/takeover`, { method: "POST" }),
  // Teruskan pesan ke percakapan lain (dipakai modal Forward di ChatScreen)
  forwardMessage: (sourceConvId, messageId, targetConversationId) =>
    request(`/conversations/${sourceConvId}/forward`, {
      method: "POST",
      body: JSON.stringify({ messageId, targetConversationId }),
    }),
  // file = { uri, name, type } dari image/document/kamera picker.
  // sendAs: "media" (inline foto/video/VN) | "document" (attachment) — default
  // "media", backend fallback otomatis ke "document" untuk audio non-ogg/webm.
  sendMedia: (conversationId, file, caption = "", sendAs = "media") => {
    const fields = { sendAs };
    if (caption) fields.caption = caption;
    return uploadFile(`/conversations/${conversationId}/media`, file, fields);
  },

  // Pelanggan
  getCustomer: (id) => request(`/customers/${id}`),
  updateCustomer: (id, data) =>
    request(`/customers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  addNote: (customerId, content) =>
    request(`/customers/${customerId}/notes`, { method: "POST", body: JSON.stringify({ content }) }),

  // Order — dua langkah sama seperti web (addOrder bikin shell order kosong,
  // addOrderItem nambah baris layanan+harga yang otomatis hitung ulang
  // Order.value). Lihat backend/src/routes/customers.js #POST /:id/orders
  // dan backend/src/routes/orders.js #POST /:orderId/items.
  addOrder: (customerId, data) =>
    request(`/customers/${customerId}/orders`, { method: "POST", body: JSON.stringify(data) }),
  addOrderItem: (orderId, data) =>
    request(`/orders/${orderId}/items`, { method: "POST", body: JSON.stringify(data) }),

  // Galeri Produk — dipakai OrderFormModal sebagai pemilih cepat nama+harga
  // layanan (Product TIDAK terhubung langsung ke Order/OrderItem di schema,
  // cuma dipakai untuk prefill form, sama seperti send-product di chat).
  getProducts: () => request("/products"),

  // Daftar user (untuk modal Transfer percakapan ke sales lain)
  getUsers: () => request("/users"),

  // Template pesan (quick reply)
  getTemplates: () => request("/templates"),
};
