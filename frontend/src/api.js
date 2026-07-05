const BASE = "/api";

function authHeaders() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...options.headers,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("token");
    window.location.reload();
  }
  if (!res.ok) {
    const text = await res.text();
    let msg = "Terjadi kesalahan";
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// Khusus untuk upload file (multipart/form-data — tanpa Content-Type header agar boundary otomatis)
async function requestFormData(path, formData) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });
  if (res.status === 401) { localStorage.removeItem("token"); window.location.reload(); }
  if (!res.ok) {
    const text = await res.text();
    let msg = "Terjadi kesalahan";
    try { msg = JSON.parse(text).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
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
  getConversations: (status) =>
    request("/conversations" + (status ? `?status=${status}` : "")),
  getUnreadCount: () => request("/conversations/unread-count"),
  getLatestUnread: (since) => request(`/conversations/latest-unread?since=${encodeURIComponent(since)}`),
  getMessages: (conversationId) =>
    request(`/conversations/${conversationId}/messages`),
  sendMessage: (conversationId, content) =>
    request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  updateConversation: (id, data) =>
    request(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
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

  // Analytics
  getAnalyticsOverview: (params) => request("/analytics/overview" + buildQuery(params)),
  getAnalyticsPerformance: (params) => request("/analytics/performance" + buildQuery(params)),
  getAnalyticsCsPerformance: (params) => request("/analytics/cs-performance" + buildQuery(params)),
  getAnalyticsPipelineFunnel: () => request("/analytics/pipeline-funnel"),
  getAnalyticsSourcePerformance: (params) => request("/analytics/source-performance" + buildQuery(params)),
  getSalesPerformance: (params) => request("/analytics/sales-performance" + buildQuery(params)),

  // Tracking Links
  getTrackingLinks: () => request("/tracking/links"),
  createTrackingLink: (data) =>
    request("/tracking/links", { method: "POST", body: JSON.stringify(data) }),
  updateTrackingLink: (id, data) =>
    request(`/tracking/links/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTrackingLink: (id) =>
    request(`/tracking/links/${id}`, { method: "DELETE" }),
  getTrackingLinkStats: (id) => request(`/tracking/links/${id}/stats`),

  // Dashboard
  getRecentConversations: () => request("/dashboard/recent-conversations"),

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
  getWhatsappStatus: () => request("/settings/whatsapp-status"),
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
