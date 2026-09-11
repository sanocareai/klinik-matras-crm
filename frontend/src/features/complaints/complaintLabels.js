// Label & aturan tampilan Complaint / After-Sales Case (D-116, 11 September
// 2026) — cermin FRONTEND dari backend/src/services/complaintCase.js. Pola
// sama dengan features/bengkel/activityFeed.js: file ini HANYA berisi nilai
// yang benar-benar dikirim backend, tidak menebak-nebak.

export const CATEGORY_LABEL = {
  KUALITAS_PRODUK: "Kualitas Produk",
  KENYAMANAN: "Kenyamanan",
  KETERLAMBATAN: "Keterlambatan",
  KERUSAKAN_TRANSIT: "Kerusakan Saat Transit",
  SALAH_SPESIFIKASI: "Salah Spesifikasi",
  LAYANAN_STAF: "Layanan Staf",
  LAINNYA: "Lainnya",
};

export const SEVERITY_LABEL = { RENDAH: "Rendah", SEDANG: "Sedang", TINGGI: "Tinggi", KRITIS: "Kritis" };
// Tone HANYA 5 nilai yang didukung Badge DS v2: neutral/accent/red/orange/green.
export const SEVERITY_TONE = { RENDAH: "neutral", SEDANG: "accent", TINGGI: "orange", KRITIS: "red" };

export const WARRANTY_LABEL = {
  BELUM_DITENTUKAN: "Belum Ditentukan",
  DALAM_GARANSI: "Dalam Garansi",
  DILUAR_GARANSI: "Di Luar Garansi",
};

export const OWNER_LABEL = { SALES: "Sales", DELIVERY: "Delivery", PRODUCTION: "Produksi", WAREHOUSE: "Warehouse", QC: "QC" };

export const STATUS_LABEL = {
  BARU: "Baru",
  VERIFIKASI: "Verifikasi",
  INVESTIGASI: "Investigasi",
  ACTION_REQUIRED: "Perlu Tindakan",
  DIJADWALKAN: "Dijadwalkan",
  DALAM_PENANGANAN: "Dalam Penanganan",
  QC: "QC",
  SIAP_DIKIRIM: "Siap Dikirim",
  DIKIRIM_ULANG: "Dikirim Ulang",
  KONFIRMASI_CUSTOMER: "Konfirmasi Customer",
  SELESAI: "Selesai",
  MENUNGGU_CUSTOMER: "Menunggu Customer",
  MENUNGGU_MATERIAL: "Menunggu Material",
  MENUNGGU_JADWAL: "Menunggu Jadwal",
  DIBATALKAN: "Dibatalkan",
};

// Tone HANYA 5 nilai yang didukung Badge DS v2: neutral/accent/red/orange/green.
export const STATUS_TONE = {
  BARU: "neutral",
  VERIFIKASI: "accent",
  INVESTIGASI: "accent",
  ACTION_REQUIRED: "orange",
  DIJADWALKAN: "accent",
  DALAM_PENANGANAN: "orange",
  QC: "accent",
  SIAP_DIKIRIM: "accent",
  DIKIRIM_ULANG: "accent",
  KONFIRMASI_CUSTOMER: "orange",
  SELESAI: "green",
  MENUNGGU_CUSTOMER: "orange",
  MENUNGGU_MATERIAL: "orange",
  MENUNGGU_JADWAL: "orange",
  DIBATALKAN: "red",
};

// Graf transisi — CERMIN PERSIS ALLOWED_TRANSITIONS di
// backend/src/services/complaintCase.js. Dipakai HANYA untuk mengisi opsi di
// dropdown (UX) — validasi SEBENARNYA tetap di backend, dropdown yang salah
// isi sekalipun akan ditolak 400 di server.
export const ALLOWED_TRANSITIONS = {
  BARU: ["VERIFIKASI", "DIBATALKAN"],
  VERIFIKASI: ["INVESTIGASI", "ACTION_REQUIRED", "MENUNGGU_CUSTOMER", "DIBATALKAN"],
  INVESTIGASI: ["ACTION_REQUIRED", "MENUNGGU_CUSTOMER", "DIBATALKAN"],
  ACTION_REQUIRED: ["DIJADWALKAN", "SIAP_DIKIRIM", "MENUNGGU_JADWAL", "MENUNGGU_MATERIAL", "DIBATALKAN"],
  DIJADWALKAN: ["DALAM_PENANGANAN", "MENUNGGU_JADWAL", "MENUNGGU_MATERIAL", "DIBATALKAN"],
  DALAM_PENANGANAN: ["QC", "MENUNGGU_MATERIAL", "DIBATALKAN"],
  QC: ["SIAP_DIKIRIM", "DALAM_PENANGANAN", "DIBATALKAN"],
  SIAP_DIKIRIM: ["DIKIRIM_ULANG", "MENUNGGU_JADWAL", "DIBATALKAN"],
  DIKIRIM_ULANG: ["KONFIRMASI_CUSTOMER", "DIBATALKAN"],
  KONFIRMASI_CUSTOMER: ["MENUNGGU_CUSTOMER", "DALAM_PENANGANAN", "DIBATALKAN"],
  MENUNGGU_CUSTOMER: ["VERIFIKASI", "INVESTIGASI", "ACTION_REQUIRED", "KONFIRMASI_CUSTOMER", "DIBATALKAN"],
  MENUNGGU_MATERIAL: ["ACTION_REQUIRED", "DIJADWALKAN", "DALAM_PENANGANAN", "DIBATALKAN"],
  MENUNGGU_JADWAL: ["ACTION_REQUIRED", "DIJADWALKAN", "SIAP_DIKIRIM", "DIBATALKAN"],
  SELESAI: [],
  DIBATALKAN: [],
};

export function formatComplaintActivitySentence(event) {
  const { eventType, metadata = {} } = event || {};
  switch (eventType) {
    case "COMPLAINT_CREATED":
      return `Kasus komplain dibuka — ${metadata.categoryLabel || CATEGORY_LABEL[metadata.category] || "—"}`;
    case "COMPLAINT_STATUS_CHANGED":
      return metadata.note
        ? `Status: ${STATUS_LABEL[metadata.from] || metadata.from || "—"} → ${STATUS_LABEL[metadata.to] || metadata.to || "—"} — ${metadata.note}`
        : `Status: ${STATUS_LABEL[metadata.from] || metadata.from || "—"} → ${STATUS_LABEL[metadata.to] || metadata.to || "—"}`;
    case "COMPLAINT_DELIVERY_TASK_CREATED":
      return `Delivery Task dibuat — ${metadata.jobType === "DELIVERY" ? "Pengiriman ulang" : "Pengambilan/inspeksi"}`;
    case "COMPLAINT_MATERIAL_REQUESTED":
      return `Material Requirement diajukan ke Warehouse${metadata.issueNumber ? ` — ${metadata.issueNumber}` : ""}`;
    case "COMPLAINT_QC_LINKED":
      return `Hasil QC ditautkan — verdict ${metadata.verdict || "—"}`;
    case "COMPLAINT_FOLLOW_UP_LOGGED":
      return metadata.note ? `Follow-up ke customer — ${metadata.note}` : "Follow-up ke customer dicatat";
    case "COMPLAINT_CUSTOMER_CONFIRMED":
      return "Customer mengonfirmasi komplain SELESAI";
    case "COMPLAINT_CANCELLED":
      return metadata.reason ? `Kasus dibatalkan — ${metadata.reason}` : "Kasus dibatalkan";
    default:
      return eventType || "Aktivitas";
  }
}
