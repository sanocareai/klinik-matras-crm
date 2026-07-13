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
      // BUG (fix): fallback lama "Terjadi kesalahan" menelan body respons
      // asli kalau server tidak balikin JSON {error: "..."} yang rapi (mis.
      // HTML error page dari Nginx, atau JSON tanpa field "error") — jadi
      // user/dev sama-sama tidak tahu apa yang sebenarnya gagal. Fallback
      // sekarang tampilkan body mentah + status code, bukan pesan generik.
      let msg;
      try { msg = JSON.parse(text).error; } catch {}
      if (!msg) msg = text ? `${res.status}: ${text.slice(0, 300)}` : `Error ${res.status}`;
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
      // BUG (fix): File.upload() (expo-file-system) TIDAK SELALU throw untuk
      // error HTTP — status/body error dari server balik sebagai return
      // value biasa (result.status/result.body), harus dicek manual di sini
      // (kalau lolos tanpa cek ini, upload yang gagal di server dianggap
      // sukses oleh caller). Fallback pesan juga tampilkan body mentah +
      // status kalau server tidak balikin JSON {error} yang rapi, supaya
      // gagal upload (mis. Nginx 413 body too large, 502, dsb) kelihatan
      // jelas — bukan "Terjadi kesalahan" generik yang tidak bisa didebug.
      let msg;
      try { msg = JSON.parse(result.body).error; } catch {}
      if (!msg) msg = result.body ? `${result.status}: ${result.body.slice(0, 300)}` : `Upload gagal (status ${result.status})`;
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
  // file = { uri, name, type } dari expo-image-picker — backend kompres+
  // resize ke ~256px pakai sharp, balikin user dengan avatarUrl terbaru.
  uploadAvatar: (file) => uploadFile("/users/me/avatar", file, {}),

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
  // clientId: opsional — lihat ChatScreen.js#handleSend & messageStore.js
  // untuk kenapa ini perlu (rekonsiliasi pesan optimistic vs echo socket).
  sendMessage: (conversationId, content, quotedMessageId = null, replyToId = null, clientId = null) =>
    request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, quotedMessageId, replyToId, clientId }),
    }),
  updateConversation: (id, data) =>
    request(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  takeoverConversation: (id) =>
    request(`/conversations/${id}/takeover`, { method: "POST" }),
  // Riwayat LENGKAP siapa saja yang pernah menangani percakapan ini
  // (takeover & transfer manual) — dipakai banner "Riwayat Penanganan" di
  // ChatScreen, beda dari handoverNote (cuma catatan TERAKHIR). Sama dengan
  // frontend/src/api.js#getHandoverHistory.
  getHandoverHistory: (id) =>
    request(`/conversations/${id}/handover-history`),
  // Teruskan pesan ke percakapan lain (dipakai modal Forward di ChatScreen)
  forwardMessage: (sourceConvId, messageId, targetConversationId) =>
    request(`/conversations/${sourceConvId}/forward`, {
      method: "POST",
      body: JSON.stringify({ messageId, targetConversationId }),
    }),
  // Edit pesan OUTBOUND (teks saja, 15 menit sejak terkirim — sama seperti
  // batas edit WhatsApp asli, ditegakkan di backend).
  editMessage: (conversationId, messageId, content) =>
    request(`/conversations/${conversationId}/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),
  // "Hapus untuk Semua" — revoke via WAHA (2 hari 12 jam, ditegakkan backend).
  deleteMessageEveryone: (conversationId, messageId) =>
    request(`/conversations/${conversationId}/messages/${messageId}`, { method: "DELETE" }),
  // "Hapus untuk Saya" — hard delete dari DB CRM saja, tidak menyentuh WhatsApp.
  deleteMessageLocal: (conversationId, messageId) =>
    request(`/conversations/${conversationId}/messages/${messageId}/local`, { method: "DELETE" }),
  // file = { uri, name, type } dari image/document/kamera picker.
  // sendAs: "media" (inline foto/video/VN) | "document" (attachment) — default
  // "media", backend fallback otomatis ke "document" untuk audio non-ogg/webm.
  sendMedia: (conversationId, file, caption = "", sendAs = "media") => {
    const fields = { sendAs };
    if (caption) fields.caption = caption;
    return uploadFile(`/conversations/${conversationId}/media`, file, fields);
  },

  // AI Co-pilot "Tanya Sano" — endpoint SAMA yang dipakai CoPilot.jsx web
  // (backend/src/routes/ai.js#copilot-chat), JANGAN bikin endpoint AI baru.
  // conversationHistory: [{role, content}] — endpoint ini TIDAK punya field
  // conversationId/customer-context terpisah (sudah dicek di ai.js &
  // CoPilot.jsx web, keduanya plain chat saja) — konteks ChatRoom (kalau
  // ada) dititipkan sebagai entri PERTAMA di conversationHistory (bukan
  // field baru), sesuai mekanisme yang MEMANG sudah didukung endpoint ini.
  coPilotChat: (message, conversationHistory = [], modelId) =>
    request("/ai/copilot-chat", {
      method: "POST",
      body: JSON.stringify({ message, conversationHistory, ...(modelId && { modelId }) }),
    }),

  // Pelanggan
  // ⚠️ GET /customers TIDAK paginated di backend (balikin array penuh semua
  // pelanggan cocok filter) — beda dengan /conversations yang sudah cursor
  // pagination. "Infinite scroll" di PelangganScreen.js jadi WINDOWING
  // client-side atas array penuh ini (pola sama dengan windowing pesan di
  // ChatScreen.js), bukan cursor pagination asli dari server.
  getCustomers: (params) => request("/customers" + buildQuery(params)),
  getCustomer: (id) => request(`/customers/${id}`),
  getCustomerConversations: (id) => request(`/customers/${id}/conversations`),
  updateCustomer: (id, data) =>
    request(`/customers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  addNote: (customerId, content) =>
    request(`/customers/${customerId}/notes`, { method: "POST", body: JSON.stringify({ content }) }),

  // Target & performa sales bulanan — endpoint SAMA yang dipakai halaman
  // Laporan/Dashboard web (backend/src/routes/analytics.js#sales-performance).
  // Balikin array SEMUA sales (bukan cuma diri sendiri) — caller cari entry
  // milik user login sendiri by userId.
  getSalesPerformance: (year, month) =>
    request("/analytics/sales-performance" + buildQuery({ year, month })),

  // Performa CS per sales (chat ditangani + closingRate = RESOLVED/total —
  // definisi "conversion rate" yang SAMA dipakai Laporan.jsx web, lihat
  // backend/src/routes/analytics.js#cs-performance). from/to: "YYYY-MM-DD".
  // Balikin SEMUA sales (role != ADMIN) — caller filter/sort di client.
  getCsPerformance: (from, to) =>
    request("/analytics/cs-performance" + buildQuery({ from, to })),

  // Distribusi lead baru & percakapan aktif per sesi WA (CS-1/CS-2) —
  // endpoint SAMA yang dipakai widget Dashboard web (backend/src/routes/
  // dashboard.js#session-distribution), read-only. period: "today"|"week"|"month".
  getSessionDistribution: (period) =>
    request("/dashboard/session-distribution" + buildQuery({ period })),

  // Order — dua langkah sama seperti web (addOrder bikin shell order kosong,
  // addOrderItem nambah baris layanan+harga yang otomatis hitung ulang
  // Order.value). Lihat backend/src/routes/customers.js #POST /:id/orders
  // dan backend/src/routes/orders.js #POST /:orderId/items.
  addOrder: (customerId, data) =>
    request(`/customers/${customerId}/orders`, { method: "POST", body: JSON.stringify(data) }),
  addOrderItem: (orderId, data) =>
    request(`/orders/${orderId}/items`, { method: "POST", body: JSON.stringify(data) }),
  // Edit/hapus order (status, paymentStatus, notes) & item layanan individual
  // — endpoint SAMA yang dipakai OrderSection.jsx web, dipakai OrderCard.js
  // mobile utk edit mode + quick status change + hapus.
  updateOrder: (orderId, data) =>
    request(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteOrder: (orderId) =>
    request(`/orders/${orderId}`, { method: "DELETE" }),
  updateOrderItem: (itemId, data) =>
    request(`/orders/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteOrderItem: (itemId) =>
    request(`/orders/items/${itemId}`, { method: "DELETE" }),
  // Tandai komplain — cuma relevan utk order yang statusnya sudah DELIVERED
  // (lihat OrderCard.js), backend/src/routes/orders.js #PATCH /:id/complaint.
  markOrderComplaint: (orderId, data) =>
    request(`/orders/${orderId}/complaint`, { method: "PATCH", body: JSON.stringify(data) }),
  // Berat badan multi-orang per order (lihat backend/src/routes/orders.js
  // #POST /:id/weight-entries) — dipakai OrderFormModal, sama seperti
  // AddOrderForm di web (frontend/src/components/customer/OrderSection.jsx).
  addWeightEntry: (orderId, data) =>
    request(`/orders/${orderId}/weight-entries`, { method: "POST", body: JSON.stringify(data) }),
  updateWeightEntry: (entryId, data) =>
    request(`/orders/weight-entries/${entryId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteWeightEntry: (entryId) =>
    request(`/orders/weight-entries/${entryId}`, { method: "DELETE" }),

  // Master data opsi form order (Jenis Layanan, Merk Kasur, Ukuran Kasur) —
  // satu sumber dipakai OrderSection.jsx web & OrderFormModal.js mobile.
  getOrderOptions: () => request("/master-data/order-options"),

  // Galeri Produk — dipakai OrderFormModal sebagai pemilih cepat nama+harga
  // layanan (Product TIDAK terhubung langsung ke Order/OrderItem di schema,
  // cuma dipakai untuk prefill form, sama seperti send-product di chat).
  getProducts: () => request("/products"),

  // Daftar user (untuk modal Transfer percakapan ke sales lain)
  getUsers: () => request("/users"),

  // Template pesan (quick reply)
  getTemplates: () => request("/templates"),
};
