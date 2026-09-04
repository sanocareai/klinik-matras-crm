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
      // `.status` disertakan (bukan cuma pesan) supaya pemanggil bisa
      // membedakan "diblokir karena ada data terkait" (409) dari error lain
      // tanpa perlu cocokkan teks pesan (rapuh kalau pesannya diubah nanti).
      throw Object.assign(new Error(msg), { status: res.status });
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
async function requestFormData(path, formData, method = "POST") {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
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

  // Satu angka HIDUP per workspace untuk kartu di halaman Portal (SANSS).
  getPortalSummary: () => request("/auth/portal-summary"),
  // Identitas + role + portal yang boleh dibuka (SANSS).
  // Sengaja baca dari server, bukan dari token di localStorage: perubahan role
  // oleh admin langsung berlaku saat refresh, tidak menunggu token 7 hari habis.
  //
  // ⚠️ NAMA SENGAJA "getMyPortals", BUKAN "getMe" — ada `getMe` LAIN di bagian
  // Users bawah (request("/users/me")) yang dipakai Automation.jsx duluan.
  // Object literal JS membiarkan key kedua diam-diam MENIMPA yang pertama
  // tanpa error apa pun — dua fungsi bernama sama di sini pernah membuat
  // Portal.jsx nyata-nyata memanggil /users/me (tidak punya field `portals`)
  // alih-alih /auth/me, sehingga auto-skip role-tunggal rusak total TANPA
  // console error, TANPA network request yang terlihat salah — cuma
  // `me.portals` selalu `undefined`. Baru ketahuan lewat tes browser
  // sungguhan. JANGAN pernah pakai nama "getMe" lagi di file ini.
  getMyPortals: () => request("/auth/me"),

  // Bengkel — Papan Produksi Harian (Sano Hub Phase 1, D-014)
  getProductionBoard: (date) => request(`/production/board${date ? `?date=${date}` : ""}`),
  // Daftar SELURUH unit (Production Tahap 1) — lebih lebar dari /board yang
  // sengaja cuma menampilkan unit yang ada di bengkel hari ini.
  getWorkOrders: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/production/work-orders${qs ? `?${qs}` : ""}`);
  },
  // Antrean QC (Production Tahap 3) — unit yang currentStage-nya gerbang QC.
  getQcQueue: () => request("/production/qc-queue"),
  // Bahan Produksi (Tahap 5) — daftar lintas order seluruh pemakaian bahan.
  getMaterialUsage: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/production/material-usage${qs ? `?${qs}` : ""}`);
  },
  // Revisi Lingkup (Tahap 4) — usulan perubahan layanan/harga di tengah
  // pengerjaan. Propose & decide keduanya multipart (upload foto/bukti).
  getScopeRevisions: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/scope-revisions${qs ? `?${qs}` : ""}`);
  },
  getScopeRevisionSummary: (id) => request(`/scope-revisions/${id}/summary`),
  proposeScopeRevision: (unitId, formData) => requestFormData(`/scope-revisions/units/${unitId}`, formData),
  decideScopeRevision: (id, formData) => requestFormData(`/scope-revisions/${id}/decision`, formData, "PATCH"),
  // Laporan Produksi (Tahap 6) — throughput, durasi per tahap, kelulusan QC.
  getProductionReport: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/production/report${qs ? `?${qs}` : ""}`);
  },
  setProductionTargets: (unitIds, { date, note } = {}) =>
    request("/production/targets", { method: "POST", body: JSON.stringify({ unitIds, date, note }) }),
  removeProductionTarget: (targetId) => request(`/production/targets/${targetId}`, { method: "DELETE" }),
  recordStageDone: (unitId, { photoUrls, note } = {}) =>
    request(`/production/units/${unitId}/done`, { method: "POST", body: JSON.stringify({ photoUrls, note }) }),
  getOrderDocumentation: (orderId) => request(`/production/orders/${orderId}/documentation`),
  // Kirim tahap dokumentasi terpilih ke customer via WAHA (D-015). entries =
  // subset dari GET getOrderDocumentation di atas yang dicentang sales.
  sendDocumentation: (conversationId, orderId, entries) =>
    request(`/conversations/${conversationId}/send-documentation`, {
      method: "POST", body: JSON.stringify({ orderId, entries }),
    }),

  // Armada — jadwal pickup & pengiriman (Sano Hub Phase 1)
  getArmadaBoard: (type, date) => request(`/armada/board?type=${type}${date ? `&date=${date}` : ""}`),

  // Daftar job berfilter untuk halaman "Jadwal & Penugasan" (Delivery Tahap 2).
  // TERPISAH dari getArmadaBoard — board menjawab "job tipe X tanggal Y +
  // unit yang masih bisa dijadwalkan", endpoint ini menjawab "job yang cocok
  // filter ini" lintas tipe & tanggal.
  getArmadaJobs: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ).toString();
    return request(`/armada/jobs${qs ? `?${qs}` : ""}`);
  },

  // Kendaraan (Delivery Tahap 3)
  getVehicles: (status) => request(`/armada/vehicles${status ? `?status=${status}` : ""}`),
  createVehicle: (data) => request("/armada/vehicles", { method: "POST", body: JSON.stringify(data) }),
  updateVehicle: (id, data) => request(`/armada/vehicles/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // Biaya/servis/insiden kendaraan (D-035)
  getVehicleExpenses: (params = {}) => request(`/armada/expenses${buildQuery(params)}`),
  createVehicleExpense: (data) => request("/armada/expenses", { method: "POST", body: JSON.stringify(data) }),
  updateVehicleExpense: (id, data) => request(`/armada/expenses/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteVehicleExpense: (id) => request(`/armada/expenses/${id}`, { method: "DELETE" }),
  uploadVehicleExpenseReceipt: (id, formData) => requestFormData(`/armada/expenses/${id}/receipt`, formData),
  getVehicleServices: (params = {}) => request(`/armada/services${buildQuery(params)}`),
  createVehicleService: (data) => request("/armada/services", { method: "POST", body: JSON.stringify(data) }),
  updateVehicleService: (id, data) => request(`/armada/services/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  uploadVehicleServiceReceipt: (id, formData) => requestFormData(`/armada/services/${id}/receipt`, formData),
  getVehicleIncidents: (params = {}) => request(`/armada/incidents${buildQuery(params)}`),
  createVehicleIncident: (data) => request("/armada/incidents", { method: "POST", body: JSON.stringify(data) }),
  updateVehicleIncident: (id, data) => request(`/armada/incidents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  uploadVehicleIncidentPhotos: (id, formData) => requestFormData(`/armada/incidents/${id}/photos`, formData),
  // Upload struk BEBAS (belum tentu tertaut baris — dipakai form "Tambah"
  // supaya foto bisa dipilih SEBELUM entri disimpan; lihat api docs).
  uploadVehicleReceiptStandalone: (formData) => requestFormData("/armada/receipts/upload", formData),
  getFleetSummary: (params = {}) => request(`/armada/fleet-summary${buildQuery(params)}`),

  // Rute (Route Planner, Delivery Tahap 3)
  getRoutes: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/armada/routes${qs ? `?${qs}` : ""}`);
  },
  getRoute: (id) => request(`/armada/routes/${id}`),
  createRoute: (data) => request("/armada/routes", { method: "POST", body: JSON.stringify(data) }),
  updateRoute: (id, data) => request(`/armada/routes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  setRouteJobs: (id, jobIds) => request(`/armada/routes/${id}/jobs`, { method: "PATCH", body: JSON.stringify({ jobIds }) }),
  publishRoute: (id) => request(`/armada/routes/${id}/publish`, { method: "POST" }),
  cancelRoute: (id) => request(`/armada/routes/${id}/cancel`, { method: "PATCH" }),
  // Hapus permanen — HANYA untuk rute DRAFT (D-059). Beda dari cancelRoute
  // (soft, riwayatnya tetap ada) — ini benar-benar menghapus baris Route-nya,
  // dipakai untuk rute draft yang salah pilih/dibuat coba-coba.
  deleteRoute: (id) => request(`/armada/routes/${id}`, { method: "DELETE" }),

  // Proof of Delivery — sisi verifikasi (Delivery Tahap 4)
  getPodJobs: (status) => request(`/armada/pod${status ? `?status=${status}` : ""}`),
  verifyPod: (jobId) => request(`/armada/pod/${jobId}/verify`, { method: "PATCH" }),
  rejectPod: (jobId, note) => request(`/armada/pod/${jobId}/reject`, { method: "PATCH", body: JSON.stringify({ note }) }),

  // Kendala & Reschedule (Delivery Tahap 5)
  getIssues: (status) => request(`/armada/issues${status ? `?status=${status}` : ""}`),
  rescheduleIssue: (jobId, data) => request(`/armada/issues/${jobId}/reschedule`, { method: "POST", body: JSON.stringify(data) }),

  // Revisi, disebut "Retur" di menu (Delivery Tahap 6)
  getRevisions: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/armada/revisions${qs ? `?${qs}` : ""}`);
  },
  searchRevisionUnits: (q) => request(`/armada/revisions/units?q=${encodeURIComponent(q)}`),
  createRevision: (data) => request("/armada/revisions", { method: "POST", body: JSON.stringify(data) }),
  updateRevision: (id, data) => request(`/armada/revisions/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // Laporan Delivery (Delivery Tahap 7)
  getDeliveryReportSummary: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/armada/reports/summary${qs ? `?${qs}` : ""}`);
  },
  getDrivers: () => request("/armada/drivers"),
  // D-037 (31 Agustus 2026) — daftar TERPISAH dari driver, lihat armada.js.
  getHelpers: () => request("/armada/helpers"),
  getDriverGroup: () => request("/armada/driver-group"),
  setDriverGroup: (conversationId) =>
    request("/armada/driver-group", { method: "PUT", body: JSON.stringify({ conversationId }) }),
  // Daftar percakapan GRUP — dipakai admin memilih "Grup Driver" (D-018).
  // Endpoint terpisah di armada.js, BUKAN GET /conversations (endpoint itu
  // tidak punya filter `type`, dan menambahkannya berarti menyentuh endpoint
  // yang dipakai luas di Inbox — sama alasannya dengan /armada/drivers).
  getGroupConversations: () => request("/armada/groups"),
  createArmadaJob: (data) => request("/armada/jobs", { method: "POST", body: JSON.stringify(data) }),
  updateArmadaJob: (jobId, data) => request(`/armada/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteArmadaJob: (jobId) => request(`/armada/jobs/${jobId}`, { method: "DELETE" }),
  getMyJobs: (date) => request(`/armada/my-jobs${date ? `?date=${date}` : ""}`),
  // Rute (FR-L-03) — urutan stop manual per driver+tanggal+tipe + jarak/durasi
  reorderArmadaRoute: (data) => request("/armada/route/reorder", { method: "PATCH", body: JSON.stringify(data) }),
  getArmadaRouteSummary: (driverId, date, type) =>
    request(`/armada/route/summary?driverId=${driverId}&date=${date}&type=${type}`),
  getArmadaJob: (jobId) => request(`/armada/jobs/${jobId}`),
  uploadJobPhotos: (jobId, formData) => requestFormData(`/armada/jobs/${jobId}/photos`, formData),
  startArmadaJob: (jobId) => request(`/armada/jobs/${jobId}/start`, { method: "POST" }),
  // D-034 — ping GPS driver (Live Tracking nyata). pings: array {lat,lng,
  // accuracy,recordedAt} — lihat utils/positionQueue.js untuk pengelompokan
  // per job sebelum dikirim.
  sendJobPositions: (jobId, pings) =>
    request(`/armada/jobs/${jobId}/positions`, { method: "POST", body: JSON.stringify({ pings }) }),
  getArmadaTracking: () => request("/armada/tracking"),
  arriveArmadaJob: (jobId) => request(`/armada/jobs/${jobId}/arrive`, { method: "POST" }),
  completeArmadaJob: (jobId, data) => request(`/armada/jobs/${jobId}/complete`, { method: "POST", body: JSON.stringify(data) }),
  recordJobPayment: (jobId, data) => request(`/armada/jobs/${jobId}/payment`, { method: "POST", body: JSON.stringify(data) }),
  getPayments: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/armada/payments${qs ? `?${qs}` : ""}`);
  },
  verifyPayment: (id) => request(`/armada/payments/${id}/verify`, { method: "POST" }),

  // Kendali — dashboard lintas portal (Sano Hub Phase 1)
  getKendaliOverview: () => request("/kendali/overview"),
  // Checklist prasyarat sebelum Bengkel/Armada/Gudang bisa dipakai kerja —
  // lihat catatan di backend/src/routes/kendali.js #GET /kesiapan.
  getKendaliKesiapan: () => request("/kendali/kesiapan"),

  // Gudang — Inventory v1 (Sano Hub Phase 3)
  getMaterials: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/inventory/materials${qs ? `?${qs}` : ""}`);
  },
  createMaterial: (data) => request("/inventory/materials", { method: "POST", body: JSON.stringify(data) }),
  updateMaterial: (id, data) => request(`/inventory/materials/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  getStock: () => request("/inventory/stock"),
  getStockMovements: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/inventory/movements${qs ? `?${qs}` : ""}`);
  },
  receiveStock: (data) => request("/inventory/movements/receipt", { method: "POST", body: JSON.stringify(data) }),
  issueStock: (data) => request("/inventory/movements/issue", { method: "POST", body: JSON.stringify(data) }),
  returnStock: (data) => request("/inventory/movements/return", { method: "POST", body: JSON.stringify(data) }),
  wasteStock: (data) => request("/inventory/movements/waste", { method: "POST", body: JSON.stringify(data) }),
  adjustStock: (data) => request("/inventory/movements/adjustment", { method: "POST", body: JSON.stringify(data) }),

  // Goods Receipt (Warehouse Tahap 2B)
  getGoodsReceipts: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/inventory/goods-receipts${qs ? `?${qs}` : ""}`);
  },
  getGoodsReceipt: (id) => request(`/inventory/goods-receipts/${id}`),
  createGoodsReceipt: (data) => request("/inventory/goods-receipts", { method: "POST", body: JSON.stringify(data) }),
  updateGoodsReceipt: (id, data) => request(`/inventory/goods-receipts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  updateGoodsReceiptLine: (id, lineId, data) =>
    request(`/inventory/goods-receipts/${id}/lines/${lineId}`, { method: "PATCH", body: JSON.stringify(data) }),
  putawayGoodsReceipt: (id, data = {}) => request(`/inventory/goods-receipts/${id}/putaway`, { method: "POST", body: JSON.stringify(data) }),
  rejectGoodsReceipt: (id, reason) => request(`/inventory/goods-receipts/${id}/reject`, { method: "PATCH", body: JSON.stringify({ reason }) }),

  // Material Issue (Warehouse Tahap 3)
  getMaterialIssues: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/inventory/material-issues${qs ? `?${qs}` : ""}`);
  },
  getMaterialIssue: (id) => request(`/inventory/material-issues/${id}`),
  createMaterialIssue: (data) => request("/inventory/material-issues", { method: "POST", body: JSON.stringify(data) }),
  updateMaterialIssue: (id, data) => request(`/inventory/material-issues/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  updateMaterialIssueLine: (id, lineId, data) =>
    request(`/inventory/material-issues/${id}/lines/${lineId}`, { method: "PATCH", body: JSON.stringify(data) }),
  issueMaterialIssue: (id, data = {}) => request(`/inventory/material-issues/${id}/issue`, { method: "POST", body: JSON.stringify(data) }),
  cancelMaterialIssue: (id, reason) => request(`/inventory/material-issues/${id}/cancel`, { method: "PATCH", body: JSON.stringify({ reason }) }),

  // Stock Transfer (Warehouse Tahap 4)
  getStorageLocations: () => request("/inventory/transfers/locations"),
  getStockTransfers: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/inventory/transfers${qs ? `?${qs}` : ""}`);
  },
  getStockTransfer: (id) => request(`/inventory/transfers/${id}`),
  createStockTransfer: (data) => request("/inventory/transfers", { method: "POST", body: JSON.stringify(data) }),
  updateStockTransfer: (id, data) => request(`/inventory/transfers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  dispatchStockTransfer: (id) => request(`/inventory/transfers/${id}/dispatch`, { method: "POST" }),
  receiveStockTransfer: (id, data = {}) => request(`/inventory/transfers/${id}/receive`, { method: "POST", body: JSON.stringify(data) }),
  cancelStockTransfer: (id, reason) => request(`/inventory/transfers/${id}/cancel`, { method: "PATCH", body: JSON.stringify({ reason }) }),

  // Stock Count / Stock Opname (Warehouse Tahap 5)
  getStockCounts: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/inventory/stock-counts${qs ? `?${qs}` : ""}`);
  },
  getStockCount: (id) => request(`/inventory/stock-counts/${id}`),
  createStockCount: (data) => request("/inventory/stock-counts", { method: "POST", body: JSON.stringify(data) }),
  updateStockCount: (id, data) => request(`/inventory/stock-counts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  updateStockCountLine: (id, lineId, data) =>
    request(`/inventory/stock-counts/${id}/lines/${lineId}`, { method: "PATCH", body: JSON.stringify(data) }),
  startStockCount: (id) => request(`/inventory/stock-counts/${id}/start`, { method: "POST" }),
  submitStockCount: (id) => request(`/inventory/stock-counts/${id}/submit`, { method: "POST" }),
  recountStockCount: (id) => request(`/inventory/stock-counts/${id}/recount`, { method: "POST" }),
  completeStockCount: (id) => request(`/inventory/stock-counts/${id}/complete`, { method: "POST" }),
  cancelStockCount: (id, reason) => request(`/inventory/stock-counts/${id}/cancel`, { method: "PATCH", body: JSON.stringify({ reason }) }),

  // Damaged Stock (Warehouse Tahap 6)
  getDamagedStock: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/inventory/damaged-stock${qs ? `?${qs}` : ""}`);
  },
  getDamagedStockRecord: (id) => request(`/inventory/damaged-stock/${id}`),
  createDamagedStockRecord: (data) => request("/inventory/damaged-stock", { method: "POST", body: JSON.stringify(data) }),
  requestDamagedStockInspection: (id) => request(`/inventory/damaged-stock/${id}/inspect`, { method: "PATCH" }),
  resolveDamagedStock: (id, data) => request(`/inventory/damaged-stock/${id}/resolve`, { method: "POST", body: JSON.stringify(data) }),

  // Returns (Warehouse Tahap 6)
  getReturns: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/inventory/returns${qs ? `?${qs}` : ""}`);
  },
  getReturnRecord: (id) => request(`/inventory/returns/${id}`),
  createReturnRecord: (data) => request("/inventory/returns", { method: "POST", body: JSON.stringify(data) }),
  updateReturnRecord: (id, data) => request(`/inventory/returns/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  completeReturnRecord: (id, resolution) => request(`/inventory/returns/${id}/complete`, { method: "POST", body: JSON.stringify({ resolution }) }),
  cancelReturnRecord: (id, reason) => request(`/inventory/returns/${id}/cancel`, { method: "PATCH", body: JSON.stringify({ reason }) }),

  // Stock Adjustment review-gated (Warehouse Tahap 6)
  getAdjustmentRequests: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/inventory/adjustments${qs ? `?${qs}` : ""}`);
  },
  getAdjustmentRequest: (id) => request(`/inventory/adjustments/${id}`),
  createAdjustmentRequest: (data) => request("/inventory/adjustments", { method: "POST", body: JSON.stringify(data) }),
  updateAdjustmentRequest: (id, data) => request(`/inventory/adjustments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  postAdjustmentRequest: (id) => request(`/inventory/adjustments/${id}/post`, { method: "POST" }),
  cancelAdjustmentRequest: (id, reason) => request(`/inventory/adjustments/${id}/cancel`, { method: "PATCH", body: JSON.stringify({ reason }) }),

  // Replenishment (Warehouse Tahap 7)
  getReplenishmentSuggestions: () => request("/inventory/replenishment/suggestions"),
  getReplenishmentRequests: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/inventory/replenishment${qs ? `?${qs}` : ""}`);
  },
  getReplenishmentRequest: (id) => request(`/inventory/replenishment/${id}`),
  createReplenishmentRequest: (data) => request("/inventory/replenishment", { method: "POST", body: JSON.stringify(data) }),
  updateReplenishmentRequest: (id, data) => request(`/inventory/replenishment/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  linkReplenishmentReceipt: (id, goodsReceiptId) =>
    request(`/inventory/replenishment/${id}/link-receipt`, { method: "POST", body: JSON.stringify({ goodsReceiptId }) }),
  rejectReplenishmentRequest: (id, reason) => request(`/inventory/replenishment/${id}/reject`, { method: "PATCH", body: JSON.stringify({ reason }) }),

  // Warehouse Reports (Tahap 8)
  getWarehouseReportSummary: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/inventory/reports/summary${qs ? `?${qs}` : ""}`);
  },
  getUnitByCode: (code) => request(`/units/by-code/${encodeURIComponent(code)}`),
  failArmadaJob: (jobId, data) => request(`/armada/jobs/${jobId}/fail`, { method: "POST", body: JSON.stringify(data) }),

  // Unit — detail & aksi tahap (Production Tahap 2)
  getUnitStatus: (unitId) => request(`/units/${unitId}`),
  getUnitTimeline: (unitId) => request(`/units/${unitId}/timeline`),
  startUnitStage: (unitId) => request(`/units/${unitId}/stages/start`, { method: "POST" }),
  completeUnitStage: (unitId, stageId, { photoUrls, note } = {}) =>
    request(`/units/${unitId}/stages/${stageId}/complete`, { method: "POST", body: JSON.stringify({ photoUrls, note }) }),
  skipUnitStage: (unitId, note) => request(`/units/${unitId}/stages/skip`, { method: "POST", body: JSON.stringify({ note }) }),
  setUnitService: (unitId, serviceId) => request(`/units/${unitId}/service`, { method: "PATCH", body: JSON.stringify({ serviceId }) }),
  getServiceCatalog: () => request("/master-data/service-catalog"),
  failUnitStage: (unitId, stageId, { blockReason, note }) =>
    request(`/units/${unitId}/stages/${stageId}/fail`, {
      method: "POST", body: JSON.stringify({ blockReason, note }),
    }),
  recordQcFitTest: (unitId, stageId, data) =>
    request(`/units/${unitId}/stages/${stageId}/qc`, { method: "POST", body: JSON.stringify(data) }),
  uploadUnitPhotos: (unitId, formData) => requestFormData(`/units/${unitId}/photos`, formData),
  // Bahan baku per unit (Production Tahap 5) — ledger stock_movements yang
  // sama dengan Gudang, tidak lewat alur dokumen MaterialIssue.
  getUnitMaterials: (unitId) => request(`/units/${unitId}/materials`),
  addUnitMaterial: (unitId, { materialId, qty, note } = {}) =>
    request(`/units/${unitId}/materials`, { method: "POST", body: JSON.stringify({ materialId, qty, note }) }),

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
      // Filter tag pelanggan — dipakai chip "Broadcast" di Inbox.
      if (statusOrParams.tag)          params.set("tag", statusOrParams.tag);
      // Belum Dibaca / Belum Dibalas — sama pola dengan mobile (api.js).
      if (statusOrParams.unread)       params.set("unread", "true");
      if (statusOrParams.unanswered)   params.set("unanswered", "true");
      // Belum Diambil (assignedToId kosong) — tab baru 25 Agustus 2026.
      if (statusOrParams.unassigned)   params.set("unassigned", "true");
      // Menggantung (assigned, belum dibalas >60 menit) — tab baru 25 Agustus 2026.
      if (statusOrParams.stalled)      params.set("stalled", "true");
      if (statusOrParams.cursor)       params.set("cursor", statusOrParams.cursor);
      if (statusOrParams.limit)        params.set("limit", statusOrParams.limit);
      const s = params.toString();
      qs = s ? `?${s}` : "";
    }
    return request("/conversations" + qs);
  },
  // "Ketik nomor lalu chat" — seperti di aplikasi WhatsApp. cekNomor cuma
  // memeriksa (tidak membuat apa pun), mulaiChat yang benar-benar membuat
  // Customer + Conversation kalau nomornya terbukti terdaftar.
  cekNomorWa: (phone, session) =>
    request(`/conversations/cek-nomor${buildQuery({ phone, session })}`),
  mulaiChatBaru: ({ phone, session, name }) =>
    request("/conversations/mulai-chat", {
      method: "POST",
      body: JSON.stringify({ phone, session, name }),
    }),
  getConversation: (id) => request(`/conversations/${id}`),
  // Anggota grup + nama yang sudah di-resolve — dipakai untuk terjemahkan
  // mention "@<LID>" jadi "@Nama" di bubble (lihat utils/mention.js). Sama
  // endpoint dengan mobile (mobile/src/api.js).
  getParticipants: (conversationId) => request(`/conversations/${conversationId}/participants`),
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
  // Port dari mobile (mobile/src/api.js) — endpoint backend sudah lama ada,
  // web belum pernah punya UI untuk memicunya.
  sendLocation: (conversationId, { lat, lng, name }) =>
    request(`/conversations/${conversationId}/send-location`, {
      method: "POST", body: JSON.stringify({ lat, lng, name }),
    }),
  sendContact: (conversationId, { name, phone }) =>
    request(`/conversations/${conversationId}/send-contact`, {
      method: "POST", body: JSON.stringify({ name, phone }),
    }),
  takeoverConversation: (id) =>
    request(`/conversations/${id}/takeover`, { method: "POST" }),
  // Peek Preview (port dari mobile) — beberapa pesan terakhir TANPA
  // menandai percakapan sudah dibaca (endpoint terpisah dari getMessages
  // yang punya side-effect mark-as-read).
  peekConversation: (id, limit = 5) =>
    request(`/conversations/${id}/peek?limit=${limit}`),
  // Riwayat LENGKAP siapa saja yang pernah menangani percakapan ini
  // (takeover & transfer manual) — dipakai banner "Riwayat Penanganan" di
  // ChatWindow, beda dari handoverNote (cuma catatan TERAKHIR).
  getHandoverHistory: (id) =>
    request(`/conversations/${id}/handover-history`),

  // Customers
  getCustomers: (params) => request("/customers" + buildQuery(params)),
  // Ekspor pelanggan sebagai file .vcf untuk diimpor ke buku alamat HP —
  // BUKAN sinkron otomatis ke WhatsApp (WAHA tidak punya jalan menulis
  // kontak, lihat catatan panjang di backend/src/services/vcard.js).
  // Endpoint mengembalikan FILE, bukan JSON, jadi tidak lewat request()
  // biasa — auth tetap wajib (requireAuth di backend), makanya di-fetch
  // manual dengan header Bearer, bukan <a href> polos yang tidak bisa
  // membawa header otorisasi.
  exportCustomersVCard: async (params) => {
    const res = await fetch(BASE + "/customers/export/vcard" + buildQuery(params), {
      headers: authHeaders(),
    });
    if (res.status === 401) { handleUnauthorized(); throw new Error("Sesi berakhir, silakan login kembali"); }
    if (!res.ok) {
      let msg = "Gagal mengekspor kontak";
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const cd = res.headers.get("Content-Disposition") || "";
    const namaFile = cd.match(/filename="([^"]+)"/)?.[1] || "pelanggan.vcf";
    return { blob: await res.blob(), namaFile };
  },
  // Pindahkan SEMUA pelanggan yang cocok `filters` (bukan cuma satu halaman)
  // ke sales lain sekaligus — 1 request, bukan ratusan api.updateCustomer.
  // `filters` pakai nama query param yang SAMA dengan getCustomers.
  bulkReassignCustomers: (filters, toSalesId) =>
    request("/customers/bulk-reassign", { method: "POST", body: JSON.stringify({ filters, toSalesId }) }),
  getCustomerCities: () => request("/customers/meta/cities"),
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
  // D-032 — kirim ringkasan order (format sama dengan "Salin pesan WA") ke
  // grup WA yang ditandai isSalesGroup lewat getSalesGroup/setSalesGroup di
  // bawah.
  sendOrderWaSummary: (orderId) =>
    request(`/orders/${orderId}/send-wa-summary`, { method: "POST" }),
  getSalesGroup: () => request("/conversations/sales-group"),
  setSalesGroup: (conversationId) =>
    request("/conversations/sales-group", { method: "PUT", body: JSON.stringify({ conversationId }) }),
  // Daftar order (order-centric) untuk halaman Order — beda dari
  // getCustomers(): 1 baris = 1 ORDER, bukan 1 pelanggan.
  getOrders: (params) => request("/orders" + buildQuery(params)),

  // Promo (D-026) — tracking kampanye seperti "Merdeka dari Sakit Pinggang".
  // BACA boleh siapa saja (dropdown pilih promo di form order); KELOLA
  // (create/update) admin-only, ditegakkan di backend.
  getPromos: (params) => request("/promos" + buildQuery(params)),
  createPromo: (data) => request("/promos", { method: "POST", body: JSON.stringify(data) }),
  updatePromo: (id, data) => request(`/promos/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  getOrderTimeline: (orderId) => request(`/orders/${orderId}/timeline`),
  // Invoice (31 Agustus 2026) — nominal & status SELALU dari backend
  // (services/invoice.js), UI tidak pernah menghitung tagihan sendiri.
  getOrderInvoice: (orderId) => request(`/orders/${orderId}/invoice`),
  updateOrderInvoice: (orderId, data) =>
    request(`/orders/${orderId}/invoice`, { method: "PATCH", body: JSON.stringify(data) }),
  sendOrderInvoice: (orderId) => request(`/orders/${orderId}/invoice/send`, { method: "POST" }),
  // Gabung invoice lintas-order (2 Sep 2026) — lihat services/invoice.js.
  getMergeableOrders: (orderId) => request(`/orders/${orderId}/invoice/mergeable`),
  attachOrderToInvoice: (orderId, targetOrderId) =>
    request(`/orders/${orderId}/invoice/attach`, { method: "POST", body: JSON.stringify({ targetOrderId }) }),
  detachInvoiceFromBundle: (orderId) =>
    request(`/orders/${orderId}/invoice/detach`, { method: "POST" }),
  // PDF = FILE, bukan JSON — sama alasan dengan exportCustomersVCard di atas:
  // di-fetch manual dengan header Bearer, <a href> polos tidak bisa membawa
  // otorisasi (endpoint ini dijaga requireAuth di backend).
  getOrderInvoicePdf: async (orderId) => {
    const res = await fetch(BASE + `/orders/${orderId}/invoice/pdf`, { headers: authHeaders() });
    if (res.status === 401) { handleUnauthorized(); throw new Error("Sesi berakhir, silakan login kembali"); }
    if (!res.ok) {
      let msg = "Gagal membuat PDF invoice";
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const cd = res.headers.get("Content-Disposition") || "";
    const namaFile = cd.match(/filename="([^"]+)"/)?.[1] || "invoice.pdf";
    return { blob: await res.blob(), namaFile };
  },
  // Kartu Garansi E-Warranty (2 Sep 2026) — lihat services/warranty.js.
  getOrderWarrantyPdf: async (orderId, years) => {
    const res = await fetch(BASE + `/orders/${orderId}/warranty/pdf?years=${years}`, { headers: authHeaders() });
    if (res.status === 401) { handleUnauthorized(); throw new Error("Sesi berakhir, silakan login kembali"); }
    if (!res.ok) {
      let msg = "Gagal membuat PDF kartu garansi";
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const cd = res.headers.get("Content-Disposition") || "";
    const namaFile = cd.match(/filename="([^"]+)"/)?.[1] || "kartu-garansi.pdf";
    return { blob: await res.blob(), namaFile };
  },
  sendOrderWarranty: (orderId, years) =>
    request(`/orders/${orderId}/warranty/send`, { method: "POST", body: JSON.stringify({ years }) }),
  addOrderItem: (orderId, data) =>
    request(`/orders/${orderId}/items`, { method: "POST", body: JSON.stringify(data) }),
  updateOrderItem: (itemId, data) =>
    request(`/orders/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteOrderItem: (itemId) =>
    request(`/orders/items/${itemId}`, { method: "DELETE" }),
  // DP/pembayaran dicatat langsung di order (D-023) — beda dari
  // recordJobPayment yang terikat ke job pickup/delivery driver.
  uploadPaymentProof: (orderId, formData) => requestFormData(`/orders/${orderId}/payments/proof`, formData),
  recordOrderPayment: (orderId, data) =>
    request(`/orders/${orderId}/payments`, { method: "POST", body: JSON.stringify(data) }),
  getOrderPayments: (orderId) => api.getPayments({ orderId }),
  // Koreksi salah input (2 Sep 2026) — admin-only di backend, lihat
  // routes/orders.js. Entri TIDAK dihapus, cuma ditandai batal.
  cancelOrderPayment: (orderId, paymentId, data) =>
    request(`/orders/${orderId}/payments/${paymentId}/cancel`, { method: "POST", body: JSON.stringify(data || {}) }),
  deleteOrder: (orderId) =>
    request(`/orders/${orderId}`, { method: "DELETE" }),
  // Alternatif hapus permanen — untuk order yang sudah punya unit/job/
  // pembayaran (delete permanen ditolak backend, lihat routes/orders.js).
  // Order & unit yang BELUM disentuh bengkel (currentStage kosong) ditandai
  // CANCELLED (statusLocked, riwayat tetap ada); kalau ada unit yang SUDAH
  // mulai dikerjakan, backend menolak dan minta dibatalkan manual di Kendali.
  cancelOrder: (orderId, reason) =>
    request(`/orders/${orderId}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),
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
  getAnalyticsPipelineFunnel: (params) => request("/analytics/pipeline-funnel" + buildQuery(params)),
  // Sisi WAKTU pipeline (lama di stage + pergerakan) — pembaca tabel
  // pipeline_transitions. Data baru terkumpul sejak 25 Juli 2026, tidak
  // bisa di-backfill; respons menyertakan dataStartedAt untuk empty state.
  getAnalyticsPipelineVelocity: (params) => request("/analytics/pipeline-velocity" + buildQuery(params)),
  getResponseTimeSeries: (params) => request("/analytics/response-time-series" + buildQuery(params)),
  getTrafficReport: (params) => request("/analytics/traffic" + buildQuery(params)),
  // Deret pendapatan HARIAN (atau bulanan kalau rentang > 92 hari) untuk grafik
  // Sales Overview. Menggantikan pemakaian monthlyRevenue di kartu itu, yang
  // selalu 6 bulan & mengabaikan rentang terpilih (grafik jadi 1 titik/kosong).
  getRevenueSeries: (params) => request("/analytics/revenue-series" + buildQuery(params)),
  // Ringkasan eksekutif Laporan (uang/konversi/beban produksi/kota/komplain +
  // deret adaptif) & laporan sales mendalam — keduanya menghormati from/to.
  getBusinessSummary: (params) => request("/analytics/business-summary" + buildQuery(params)),
  getSalesReport: (params) => request("/analytics/sales-report" + buildQuery(params)),
  getSalesLunasDetail: (params) => request("/analytics/sales-report/lunas-detail" + buildQuery(params)),
  getAnalyticsSourcePerformance: (params) => request("/analytics/source-performance" + buildQuery(params)),
  // Rincian per iklan/kreatif spesifik (bukan cuma per platform) — lihat
  // catatan panjang di backend/src/routes/analytics.js.
  getLeadSourceDetail: (params) => request("/analytics/lead-source-detail" + buildQuery(params)),
  getSalesPerformance: (params) => request("/analytics/sales-performance" + buildQuery(params)),
  // AI Conversation Quality Scorer (26 Agustus 2026) — pelengkap
  // audit_balasan_sales, laporan TERPISAH utk validasi manual dulu.
  getQualityScorerWeekly: (params) => request("/quality-scorer/weekly" + buildQuery(params)),
  runQualityScorerNow: () => request("/quality-scorer/run", { method: "POST" }),
  // Dimensi E/F + ringkasan pola mingguan (26 Agustus 2026) — narasi dibaca
  // dari yang sudah tersimpan (job Senin 04:00 WIB), route ini tidak
  // memanggil LLM; /run dipakai utk trigger manual saat verifikasi.
  getQualityScorerWeeklyNarrative: () => request("/quality-scorer/weekly-narrative"),
  runQualityScorerWeeklyNarrativeNow: () => request("/quality-scorer/weekly-narrative/run", { method: "POST" }),
  // Sales Risk Engine (26 Agustus 2026) — TERPISAH dari skorUrgensi/Priority
  // Engine, deteksi risiko kebocoran revenue akibat eksekusi sales gagal.
  getSalesRisk: (params) => request("/sales-risk" + buildQuery(params)),
  // Feedback "salah kategori" (29 Agustus 2026) — alat audit manual, TIDAK
  // mengubah severity/tier apa pun, lihat routes/salesRisk.js.
  getRiskClassificationFeedback: () => request("/sales-risk/feedback"),
  flagRiskClassification: (customerId, body) =>
    request(`/sales-risk/${customerId}/feedback`, { method: "POST", body: JSON.stringify(body) }),
  // Sales Performance Intelligence (27 Agustus 2026) — agregasi Quality
  // Scorer + Sales Risk Engine + SLA/response-time, TANPA skoring AI baru.
  getSalesIntelligence: (params) => request("/sales-intelligence" + buildQuery(params)),
  getRecentOrders: (params) => request("/analytics/recent-orders" + buildQuery(params)),
  // Feed "Recent Activity" Dashboard (30 Agustus 2026) — gabungan order
  // baru + lead baru + perpindahan pipeline, lihat komentar panjang di
  // routes/analytics.js#/recent-activity.
  getRecentActivity: (params) => request("/analytics/recent-activity" + buildQuery(params)),
  // Wave 2B — Dashboard Band 2 (read-only, role-scoped di server)
  getRecommendations: () => request("/analytics/recommendations"),
  getHotLeads:        () => request("/analytics/hot-leads"),
  getFollowUps:       () => request("/analytics/follow-ups"),
  getSessionDistribution: (params) => request("/dashboard/session-distribution" + buildQuery(params)),
  getLeadsDetail: (params) => request("/dashboard/leads-detail" + buildQuery(params)),

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
  // Default: hanya user AKTIF (dipakai semua picker assign/transfer sales).
  // Pengguna.jsx (satu-satunya tempat yang perlu kelola akun nonaktif)
  // memanggil dengan { includeInactive: true }.
  getUsers: (params) => request("/users" + buildQuery(params)),
  getMe: () => request("/users/me"),
  updateMe: (data) =>
    request("/users/me", { method: "PATCH", body: JSON.stringify(data) }),
  // Ganti foto profil sendiri. Endpoint SUDAH ADA di backend sejak lama
  // (dipakai mobile "Sano Messenger") — web belum pernah punya UI-nya.
  // Field "file" WAJIB nama itu persis, sama dengan yang dipakai mobile.
  uploadAvatar: (formData) => requestFormData("/users/me/avatar", formData),
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
  addUserRole: (id, role) =>
    request(`/users/${id}/roles`, { method: "POST", body: JSON.stringify({ role }) }),
  removeUserRole: (id, role) =>
    request(`/users/${id}/roles/${role}`, { method: "DELETE" }),

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
  // Biaya iklan bulanan per sumber (30 Agustus 2026) — input manual, dipakai
  // menghitung CPA/ROAS di Laporan > Traffic. Pola sama dgn Sales Target.
  getAdSpend: (params) => request("/settings/ad-spend" + buildQuery(params)),
  updateAdSpend: (data) =>
    request("/settings/ad-spend", { method: "PUT", body: JSON.stringify(data) }),

  // Pipeline
  getPipelineBoard: (params) => request("/pipeline/board" + buildQuery(params)),

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
  // Menyiapkan target DIPISAH dari menjalankan campaign — supaya admin bisa
  // memeriksa daftar penerima final sebelum satu pesan pun terkirim.
  // Daftar kandidat + kapan terakhir berinteraksi, untuk layar "Pilih Kontak".
  getBroadcastPreviewTargets: (params) =>
    request("/broadcast/preview-targets" + buildQuery(params)),
  // body opsional: { customerIds: [...] } atau { batas: 30 }
  prepareBroadcastCampaign: (id, body) =>
    request(`/broadcast/campaigns/${id}/prepare`, {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),
  startBroadcastCampaign: (id) =>
    request(`/broadcast/campaigns/${id}/start`, { method: "POST" }),
  pauseBroadcastCampaign: (id) =>
    request(`/broadcast/campaigns/${id}/pause`, { method: "POST" }),
  // Kirim uji ke nomor yang DITENTUKAN admin. TIDAK terikat campaign
  // tersimpan — admin harus bisa mencoba tampilan pesannya sebelum
  // menyimpan draft apa pun.
  testBroadcast: ({ phone, message, images }) =>
    request("/broadcast/test", { method: "POST", body: JSON.stringify({ phone, message, images }) }),
  // Unggah gambar TANPA kampanye — supaya admin tidak dipaksa menyimpan
  // draft dulu hanya untuk menempelkan desain promo.
  uploadBroadcastImagesLepas: (files) => {
    const fd = new FormData();
    for (const f of files) fd.append("images", f);
    return requestFormData("/broadcast/images", fd);
  },
  uploadBroadcastImages: (id, files) => {
    const fd = new FormData();
    for (const f of files) fd.append("images", f);
    // WAJIB lewat requestFormData, bukan request(): request() memaksa
    // Content-Type application/json, yang membuat browser TIDAK menambahkan
    // boundary multipart dan multer menolak seluruh unggahan.
    return requestFormData(`/broadcast/campaigns/${id}/images`, fd);
  },
  deleteBroadcastImage: (id, image) =>
    request(`/broadcast/campaigns/${id}/images`, { method: "DELETE", body: JSON.stringify({ image }) }),
  getBroadcastTargets: (id, params) =>
    request(`/broadcast/campaigns/${id}/targets` + buildQuery(params)),
  // Cuplikan chat terakhir seorang kandidat — dipakai popup di "Pilih Kontak".
  getBroadcastContactChat: (customerId) =>
    request(`/broadcast/contacts/${customerId}/chat`),

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

  // Katalog harga jual per lini produk + varian (29 Agustus 2026) — dipakai
  // form order menampilkan daftar layanan beserta harga normal & standard.
  // BUKAN getServiceCatalog() di atas: itu katalog PRODUKSI (routing modul
  // kerja, tanpa harga). Lihat catatan di schema.prisma#PriceItem.
  // `category` (30 Agustus 2026) OPSIONAL — kalau dikirim, backend memfilter
  // kind sesuai OrderCategory (LAYANAN→SERVICE/ADDON/FEE, BARU→PRODUCT/FEE,
  // SEWA→RENTAL/FEE). Tanpa itu, LAYANAN dulu ikut menampilkan PRODUCT yang
  // nyasar (kelihatan di Divan), dan BARU/SEWA tidak pernah memuat katalog
  // sama sekali (form cuma minta 1 angka manual) — lihat catatan panjang di
  // masterData.js#KIND_BY_CATEGORY.
  getPriceList: (productLine, variantKey, category) =>
    request(`/master-data/price-list?productLine=${encodeURIComponent(productLine)}${variantKey ? `&variantKey=${encodeURIComponent(variantKey)}` : ""}${category ? `&category=${encodeURIComponent(category)}` : ""}`),

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
