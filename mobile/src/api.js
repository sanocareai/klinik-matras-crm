// Client API untuk backend CRM Klinik Matras.
// Sama persis dengan frontend/src/api.js versi web, tapi pakai AsyncStorage
// (React Native tidak punya localStorage) dan base URL absolut ke server produksi.
import AsyncStorage from "@react-native-async-storage/async-storage";

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

// Upload multipart (kirim media) — tanpa Content-Type manual supaya boundary otomatis
async function requestFormData(path, formData) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // media bisa besar — 2 menit

  try {
    const res = await fetch(`${serverUrl}/api${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
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
  savePushToken: (token) =>
    request("/users/me/push-token", { method: "POST", body: JSON.stringify({ token }) }),
  deletePushToken: (token) =>
    request("/users/me/push-token", { method: "DELETE", body: JSON.stringify({ token }) }),

  // Percakapan (Inbox)
  // params: { status, assignedToId } — keduanya opsional
  getConversations: (params) => request("/conversations" + buildQuery(params)),
  getConversationCounts: () => request("/conversations/counts"),
  getUnreadCount: () => request("/conversations/unread-count"),
  getMessages: (conversationId) =>
    request(`/conversations/${conversationId}/messages`),
  sendMessage: (conversationId, content, quotedMessageId = null, replyToId = null) =>
    request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, quotedMessageId, replyToId }),
    }),
  updateConversation: (id, data) =>
    request(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  takeoverConversation: (id) =>
    request(`/conversations/${id}/takeover`, { method: "POST" }),
  // file = { uri, name, type } dari image/document picker
  sendMedia: (conversationId, file, caption = "") => {
    const formData = new FormData();
    formData.append("file", file);
    if (caption) formData.append("caption", caption);
    return requestFormData(`/conversations/${conversationId}/media`, formData);
  },

  // Pelanggan
  getCustomer: (id) => request(`/customers/${id}`),
  updateCustomer: (id, data) =>
    request(`/customers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  addNote: (customerId, content) =>
    request(`/customers/${customerId}/notes`, { method: "POST", body: JSON.stringify({ content }) }),

  // Template pesan (quick reply)
  getTemplates: () => request("/templates"),
};
