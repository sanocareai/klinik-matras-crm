// VITE_API_BASE kosong = relative URL (untuk web/PWA browser, pakai proxy Vite dev / same-origin prod)
// VITE_API_BASE diisi = absolute URL (untuk Capacitor APK, perlu tahu alamat server produksi)
const BASE = (import.meta.env.VITE_API_BASE || "") + "/api";
const TIMEOUT_MS = 30000; // 30 detik — cegah request hang selamanya

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Dipanggil saat server balas 401 — tampilkan modal "sesi berakhir" di App.jsx
// tanpa hard reload (tidak kehilangan state UI, sales tidak kaget)
function handleUnauthorized() {
  localStorage.removeItem("token");
  window.dispatchEvent(new CustomEvent("auth-error"));
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...options.headers,
      },
    });
    if (res.status === 401) {
      handleUnauthorized();
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

// Khusus untuk upload file (multipart/form-data — tanpa Content-Type header agar boundary otomatis)
async function requestFormData(path, formData) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: authHeaders(),
      body: formData,
    });
    if (res.status === 401) {
      handleUnauthorized();
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

  // Conversations
  // Terima string status (cara lama, tetap didukung) ATAU objek
  // { status, search, assignedToId, cursor, limit } (Fase B/F).
  // ⚠️ Response SEKARANG { data, nextCursor } (cursor pagination, Fase F),
  // BUKAN array mentah lagi — semua caller harus baca `.data`.
  getConversations: (statusOrParams) => {
    let qs = "";
    if (typeof statusOrParams === "string") {
      qs = statusOrParams ? `?status=${statusOrParams}` : "";
    } else if (statusOrParams && typeof statusOrParams === "object") {
      const params = new URLSearchParams();
      if (statusOrParams.status)       params.set("status", statusOrParams.status);
      if (statusOrParams.search)       params.set("search", statusOrParams.search);
      if (statusOrParams.assignedToId) params.set("assignedToId", statusOrParams.assignedToId);
      if (statusOrParams.cursor)       params.set("cursor", statusOrParams.cursor);
      if (statusOrParams.limit)        params.set("limit", statusOrParams.limit);
      const s = params.toString();
      qs = s ? `?${s}` : "";
    }
    return request("/conversations" + qs);
  },
  getUnreadCount: () => request("/conversations/unread-count"),
  getLatestUnread: (since) => request(`/conversations/latest-unread?since=${encodeURIComponent(since)}`),
  getMessages: (conversationId) =>
    request(`/conversations/${conversationId}/messages`),
  // Tandai percakapan sudah dibaca (unreadCount=0) tanpa fetch seluruh riwayat
  // pesan — endpoint baru Fase F, terpisah dari side-effect GET .../messages.
  markConversationRead: (conversationId) =>
    request(`/conversations/${conversationId}/read`, { method: "POST" }),
  // clientId: opsional — dibuat sekali di useSendMessage.js#onMutate, dikirim
  // ke backend & di-echo balik di response DAN payload socket message:new
  // (lihat backend/src/routes/conversations.js) supaya frontend bisa
  // rekonsiliasi entry optimistic dengan echo socket, lihat messageStore.js#upsertMessage.
  sendMessage: (conversationId, content, quotedMessageId = null, replyToId = null, clientId = null) =>
    request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, quotedMessageId, replyToId, clientId }),
    }),
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
  updateConversation: (id, data) =>
    request(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  // Set sessionId manual — dipakai saat backend tolak kirim (409, sesi WA
  // belum diketahui). Dropdown CS-1/CS-2 di header chat (lihat ChatWindow).
  setConversationSession: (id, sessionId) =>
    request(`/conversations/${id}/session`, { method: "PATCH", body: JSON.stringify({ sessionId }) }),
  // Sync riwayat 1 percakapan saja dari WAHA (admin only) — tombol kecil di
  // header chat, recovery kasus per-kasus tanpa perlu sync semua customer.
  syncConversationHistory: (id) =>
    request(`/conversations/${id}/sync-history`, { method: "POST" }),
  // Fetch-on-demand 1 media pesan (Fix 4) — dipakai tombol "Muat Media" di
  // MessageBubble saat mediaType diketahui tapi mediaUrl belum tersedia.
  loadMessageMedia: (conversationId, messageId) =>
    request(`/conversations/${conversationId}/messages/${messageId}/load-media`, { method: "POST" }),
  sendMedia: (conversationId, formData) =>
    requestFormData(`/conversations/${conversationId}/media`, formData),
  takeoverConversation: (id) =>
    request(`/conversations/${id}/takeover`, { method: "POST" }),

  // Customers
  getCustomers: (params) => request("/customers" + buildQuery(params)),
  getCustomer: (id) => request(`/customers/${id}`),
  createCustomer: (data) =>
    request("/customers", { method: "POST", body: JSON.stringify(data) }),
  updateCustomer: (id, data) =>
    request(`/customers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  getCustomerConversations: (id) =>
    request(`/customers/${id}/conversations`),
  addNote: (customerId, content) =>
    request(`/customers/${customerId}/notes`, { method: "POST", body: JSON.stringify({ content }) }),
  updateNote: (noteId, content) =>
    request(`/customers/notes/${noteId}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  deleteNote: (noteId) =>
    request(`/customers/notes/${noteId}`, { method: "DELETE" }),
  addOrder: (customerId, data) =>
    request(`/customers/${customerId}/orders`, { method: "POST", body: JSON.stringify(data) }),
  updateCustomerOrder: (customerId, orderId, data) =>
    request(`/customers/${customerId}/orders/${orderId}`, { method: "PATCH", body: JSON.stringify(data) }),

  // Orders + OrderItem
  updateOrder: (orderId, data) =>
    request(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify(data) }),
  addOrderItem: (orderId, data) =>
    request(`/orders/${orderId}/items`, { method: "POST", body: JSON.stringify(data) }),
  updateOrderItem: (itemId, data) =>
    request(`/orders/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteOrderItem: (itemId) =>
    request(`/orders/items/${itemId}`, { method: "DELETE" }),
  deleteOrder: (orderId) =>
    request(`/orders/${orderId}`, { method: "DELETE" }),
  markOrderComplaint: (orderId, data) =>
    request(`/orders/${orderId}/complaint`, { method: "PATCH", body: JSON.stringify(data) }),
  addWeightEntry: (orderId, data) =>
    request(`/orders/${orderId}/weight-entries`, { method: "POST", body: JSON.stringify(data) }),
  updateWeightEntry: (entryId, data) =>
    request(`/orders/weight-entries/${entryId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteWeightEntry: (entryId) =>
    request(`/orders/weight-entries/${entryId}`, { method: "DELETE" }),

  // Analytics
  getAnalyticsOverview: (params) => request("/analytics/overview" + buildQuery(params)),
  getAnalyticsPerformance: (params) => request("/analytics/performance" + buildQuery(params)),
  getAnalyticsCsPerformance: (params) => request("/analytics/cs-performance" + buildQuery(params)),
  getAnalyticsPipelineFunnel: () => request("/analytics/pipeline-funnel"),
  getAnalyticsSourcePerformance: (params) => request("/analytics/source-performance" + buildQuery(params)),
  getSalesPerformance: (params) => request("/analytics/sales-performance" + buildQuery(params)),
  getRecentOrders: (params) => request("/analytics/recent-orders" + buildQuery(params)),

  // Tracking Links
  getTrackingLinks: () => request("/tracking/links"),
  createTrackingLink: (data) =>
    request("/tracking/links", { method: "POST", body: JSON.stringify(data) }),
  updateTrackingLink: (id, data) =>
    request(`/tracking/links/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTrackingLink: (id) =>
    request(`/tracking/links/${id}`, { method: "DELETE" }),
  getTrackingLinkStats: (id) => request(`/tracking/links/${id}/stats`),

  // Users
  getUsers: () => request("/users"),
  getMe: () => request("/users/me"),
  updateMe: (data) =>
    request("/users/me", { method: "PATCH", body: JSON.stringify(data) }),
  changePassword: (data) =>
    request("/users/me/change-password", { method: "POST", body: JSON.stringify(data) }),
  createUser: (data) =>
    request("/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id, data) =>
    request(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  resetUserPassword: (id, newPassword) =>
    request(`/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword }) }),
  deleteUser: (id) =>
    request(`/users/${id}`, { method: "DELETE" }),

  // Settings
  getSettings: () => request("/settings"),
  updateSettings: (data) =>
    request("/settings", { method: "PATCH", body: JSON.stringify(data) }),
  getWhatsappStatus: (session = null) =>
    request("/settings/whatsapp-status" + (session ? `?session=${encodeURIComponent(session)}` : "")),
  // Return 202 { jobId, status } segera — job jalan di background (lihat
  // syncHistoryJob.js). 409 kalau job lain masih running.
  syncChatHistory: (phone = null) =>
    request("/settings/sync-history", { method: "POST", body: JSON.stringify(phone ? { phone } : {}) }),
  getSyncHistoryStatus: () => request("/settings/sync-history/status"),
  getSalesTargets: (params) => request("/settings/sales-targets" + buildQuery(params)),
  updateSalesTarget: (data) =>
    request("/settings/sales-targets", { method: "PUT", body: JSON.stringify(data) }),

  // Pipeline
  getPipelineBoard: () => request("/pipeline/board"),

  // Broadcast
  getBroadcastCampaigns: () => request("/broadcast/campaigns"),
  createBroadcastCampaign: (data) =>
    request("/broadcast/campaigns", { method: "POST", body: JSON.stringify(data) }),
  updateBroadcastCampaign: (id, data) =>
    request(`/broadcast/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteBroadcastCampaign: (id) =>
    request(`/broadcast/campaigns/${id}`, { method: "DELETE" }),
  getBroadcastEstimate: (params) => request("/broadcast/estimate" + buildQuery(params)),
  getBroadcastHealthCheck: () => request("/broadcast/health-check"),
  sendBroadcastCampaign: (id) =>
    request(`/broadcast/campaigns/${id}/send`, { method: "POST" }),
  testBroadcastCampaign: (id) =>
    request(`/broadcast/campaigns/${id}/test`, { method: "POST" }),

  // Automation — Workflows
  getWorkflows: () => request("/automation/workflows"),
  getWorkflow: (id) => request(`/automation/workflows/${id}`),
  createWorkflow: (data) =>
    request("/automation/workflows", { method: "POST", body: JSON.stringify(data) }),
  updateWorkflow: (id, data) =>
    request(`/automation/workflows/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteWorkflow: (id) =>
    request(`/automation/workflows/${id}`, { method: "DELETE" }),

  // AI Models
  getAiModels: () => request("/ai/models"),
  createAiModel: (data) =>
    request("/ai/models", { method: "POST", body: JSON.stringify(data) }),
  updateAiModel: (id, data) =>
    request(`/ai/models/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteAiModel: (id) =>
    request(`/ai/models/${id}`, { method: "DELETE" }),
  testAiConnection: (data) =>
    request("/ai/test-connection", { method: "POST", body: JSON.stringify(data) }),
  getAiSettings: () => request("/ai/settings"),
  updateAiSettings: (data) =>
    request("/ai/settings", { method: "PUT", body: JSON.stringify(data) }),
  aiChat: (modelId, messages, { systemPrompt, useKb, saveHistory, modelMeta } = {}) =>
    request("/ai/chat", { method: "POST", body: JSON.stringify({ modelId, messages, systemPrompt, useKb, ...(saveHistory && { saveHistory: true, modelMeta }) }) }),
  getPlaygroundHistory: (modelConfigId) => request(`/ai/playground/${modelConfigId}/messages`),
  clearPlaygroundHistory: (modelConfigId) =>
    request(`/ai/playground/${modelConfigId}/messages`, { method: "DELETE" }),
  coPilotChat: (message, conversationHistory = [], modelId) =>
    request("/ai/copilot-chat", { method: "POST", body: JSON.stringify({ message, conversationHistory, ...(modelId && { modelId }) }) }),
  // Fase C — simulasi deteksi handover (SANDBOX ONLY, belum tersambung ke WAHA)
  checkHandover: (messages) =>
    request("/ai/handover-check", { method: "POST", body: JSON.stringify({ messages }) }),
  // Context Banner — generate 1 kalimat pembuka untuk sales yang baru ambil alih
  generateDraftReply: (conversationHistory, handoverNote) =>
    request("/ai/draft-reply", { method: "POST", body: JSON.stringify({ conversationHistory, handoverNote }) }),

  // Master data opsi form order (Jenis Layanan, Merk Kasur, Ukuran Kasur) —
  // satu sumber dipakai OrderSection.jsx web & mobile OrderFormModal.js.
  getOrderOptions: () => request("/master-data/order-options"),

  // Produk (Galeri)
  getProducts: () => request("/products"),
  getAllProducts: () => request("/products/all"),
  createProduct: (data) =>
    request("/products", { method: "POST", body: JSON.stringify(data) }),
  updateProduct: (id, data) =>
    request(`/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProduct: (id) =>
    request(`/products/${id}`, { method: "DELETE" }),
  uploadProductImages: (productId, formData) =>
    requestFormData(`/products/${productId}/images`, formData),
  updateProductImage: (imageId, data) =>
    request(`/products/images/${imageId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProductImage: (imageId) =>
    request(`/products/images/${imageId}`, { method: "DELETE" }),
  sendProduct: (conversationId, data) =>
    request(`/conversations/${conversationId}/send-product`, { method: "POST", body: JSON.stringify(data) }),

  // Template Pesan
  getTemplates: () => request("/templates"),
  createTemplate: (data) =>
    request("/templates", { method: "POST", body: JSON.stringify(data) }),
  updateTemplate: (id, data) =>
    request(`/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTemplate: (id) =>
    request(`/templates/${id}`, { method: "DELETE" }),

  // Knowledge Base
  getKbCategories: () => request("/knowledge/categories"),
  getKbCategoryEntries: (cat) => request(`/knowledge/categories/${encodeURIComponent(cat)}/entries`),

  updateKbEntry: (cat, index, data) =>
    request(`/knowledge/categories/${encodeURIComponent(cat)}/entries/${index}`,
      { method: "PUT", body: JSON.stringify(data) }),
  deleteKbEntry: (cat, index) =>
    request(`/knowledge/categories/${encodeURIComponent(cat)}/entries/${index}`,
      { method: "DELETE" }),

  getKbDocuments: () => request("/knowledge/documents"),
  uploadKbDocument: (formData) => requestFormData("/knowledge/documents", formData),
  updateKbDocument: (id, data) =>
    request(`/knowledge/documents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteKbDocument: (id) =>
    request(`/knowledge/documents/${id}`, { method: "DELETE" }),
  getKbDocumentContent: (id) => request(`/knowledge/documents/${id}/content`),
  updateKbDocumentContent: (id, text) =>
    request(`/knowledge/documents/${id}/content`, { method: "PATCH", body: JSON.stringify({ text }) }),
  searchKnowledge: (q) => request("/knowledge/search?q=" + encodeURIComponent(q)),
  getFaq: () => request("/knowledge/faq"),
  createFaq: (data) =>
    request("/knowledge/faq", { method: "POST", body: JSON.stringify(data) }),
  updateFaq: (id, data) =>
    request(`/knowledge/faq/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteFaq: (id) =>
    request(`/knowledge/faq/${id}`, { method: "DELETE" }),
};
