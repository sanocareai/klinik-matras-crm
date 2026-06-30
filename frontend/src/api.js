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
  getMessages: (conversationId) =>
    request(`/conversations/${conversationId}/messages`),
  sendMessage: (conversationId, content) =>
    request(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  updateConversation: (id, data) =>
    request(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

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
  addOrder: (customerId, data) =>
    request(`/customers/${customerId}/orders`, { method: "POST", body: JSON.stringify(data) }),
  updateCustomerOrder: (customerId, orderId, data) =>
    request(`/customers/${customerId}/orders/${orderId}`, { method: "PATCH", body: JSON.stringify(data) }),

  // Orders
  updateOrder: (orderId, data) =>
    request(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify(data) }),

  // Analytics
  getAnalyticsOverview: (params) => request("/analytics/overview" + buildQuery(params)),
  getAnalyticsPerformance: (params) => request("/analytics/performance" + buildQuery(params)),
  getAnalyticsCsPerformance: (params) => request("/analytics/cs-performance" + buildQuery(params)),
  getAnalyticsPipelineFunnel: () => request("/analytics/pipeline-funnel"),

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
  aiChat: (modelId, messages) =>
    request("/ai/chat", { method: "POST", body: JSON.stringify({ modelId, messages }) }),

  // Template Pesan
  getTemplates: () => request("/templates"),
  createTemplate: (data) =>
    request("/templates", { method: "POST", body: JSON.stringify(data) }),
  updateTemplate: (id, data) =>
    request(`/templates/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTemplate: (id) =>
    request(`/templates/${id}`, { method: "DELETE" }),

  // Knowledge Base
  getKbDocuments: () => request("/knowledge/documents"),
  uploadKbDocument: (formData) => requestFormData("/knowledge/documents", formData),
  updateKbDocument: (id, data) =>
    request(`/knowledge/documents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteKbDocument: (id) =>
    request(`/knowledge/documents/${id}`, { method: "DELETE" }),
  getKbDocumentContent: (id) => request(`/knowledge/documents/${id}/content`),
  searchKnowledge: (q) => request("/knowledge/search?q=" + encodeURIComponent(q)),
  getFaq: () => request("/knowledge/faq"),
  createFaq: (data) =>
    request("/knowledge/faq", { method: "POST", body: JSON.stringify(data) }),
  updateFaq: (id, data) =>
    request(`/knowledge/faq/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteFaq: (id) =>
    request(`/knowledge/faq/${id}`, { method: "DELETE" }),
};
