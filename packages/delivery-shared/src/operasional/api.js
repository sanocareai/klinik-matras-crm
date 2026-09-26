import { buildQuery } from "../api/client.js";

// Binding endpoint OPERASIONAL yang sudah ada (/api/armada/*) untuk Delivery Control. Tidak ada endpoint baru;
// izin ditegakkan server (job:read / job:write). Satu-satunya mutation di sini (reschedule) membawa
// Idempotency-Key; server juga hanya menerima job berstatus FAILED sehingga retry tidak menggandakan.
export function createOperasionalApi(client) {
  return {
    papan: (date, type) => client.request(`/armada/board${buildQuery({ date, type })}`),
    rute: (filters = {}) => client.request(`/armada/routes${buildQuery(filters)}`),
    detailRute: (id) => client.request(`/armada/routes/${id}`),
    driver: () => client.request("/armada/drivers"),
    helper: () => client.request("/armada/helpers"),
    tracking: () => client.request("/armada/tracking"),
    masalah: (status) => client.request(`/armada/issues${buildQuery({ status })}`),
    kendaraan: () => client.request("/armada/vehicles"),
    reschedule: (jobId, body, key) => {
      if (!key) throw new Error("Idempotency-Key wajib untuk reschedule");
      return client.request(`/armada/issues/${jobId}/reschedule`, { method: "POST", body, headers: { "Idempotency-Key": key } });
    },
    insentif: (from, to) => client.request(`/armada/incentive-summary${buildQuery({ from, to })}`),
  };
}
