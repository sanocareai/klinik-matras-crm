// Port dari frontend/src/features/armada/jobStatus.js — HANYA fungsi
// pembaca data job yang dipakai layar driver (bukan seluruh file, banyak
// yang khusus dispatcher/Route Planner/dst yang tidak relevan di sini).

export const JOB_STATUS_REAL = {
  UNSCHEDULED: { label: "Belum Dijadwalkan" },
  SCHEDULED: { label: "Terjadwal" },
  ASSIGNED: { label: "Ditugaskan" },
  EN_ROUTE: { label: "Menuju Lokasi" },
  ARRIVED: { label: "Tiba di Lokasi" },
  COMPLETED: { label: "Selesai" },
  FAILED: { label: "Gagal" },
  RESCHEDULED: { label: "Dijadwalkan Ulang" },
};

const JOB_TYPE_SINGKAT = { PICKUP: "Ambil", DELIVERY: "Kirim" };

// Complaint / After-Sales Case (D-116, 12 September 2026 — permintaan
// owner: driver perlu tahu KENAPA job ini ada, supaya bisa lebih hati-hati/
// sopan di lokasi kalau ini terkait komplain). Cermin ringkas dari
// backend/src/services/complaintCase.js CATEGORY_LABEL — sengaja salinan
// kecil, bukan impor lintas paket (pola sama dengan JOB_STATUS_REAL di
// atas dan features/bengkel/activityFeed.js di web).
export const COMPLAINT_CATEGORY_LABEL = {
  KUALITAS_PRODUK: "Kualitas Produk",
  KENYAMANAN: "Kenyamanan",
  KETERLAMBATAN: "Keterlambatan",
  KERUSAKAN_TRANSIT: "Kerusakan Saat Transit",
  SALAH_SPESIFIKASI: "Salah Spesifikasi",
  LAYANAN_STAF: "Layanan Staf",
  LAINNYA: "Lainnya",
};

function titleCaseNama(s) {
  if (!s) return s;
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}

export function customerOf(job) {
  return titleCaseNama(
    job?.order?.customer?.name || job?.units?.[0]?.unit?.order?.customer?.name || null
  );
}

export function customerPhoneOf(job) {
  return job?.order?.customer?.phone || job?.units?.[0]?.unit?.order?.customer?.phone || null;
}

export function orderNumberOf(job) {
  return job?.order?.orderNumber || job?.units?.[0]?.unit?.order?.orderNumber || null;
}

export function jobLabelOf(job) {
  const orderNumber = orderNumberOf(job);
  const jenis = JOB_TYPE_SINGKAT[job?.type] || job?.type || "?";
  if (!orderNumber) return job?.id ? job.id.slice(0, 8) : "—";
  const urut = orderNumber.split("-").pop();
  return `${urut}-${jenis}`;
}

function salesLocationUrl(job) {
  return job?.order?.locationUrl || job?.units?.[0]?.unit?.order?.locationUrl || null;
}

// Prioritas SAMA dengan mapsUrl() web (jobStatus.js): koordinat hasil
// geocode > link sales mentah > pencarian teks alamat. Satu sumber
// kebenaran dengan alasan yang SAMA (lihat catatan panjang di sana) —
// duplikasi fungsi murni, bukan reuse lintas runtime (RN vs web beda bundle).
export function mapsUrl(job) {
  if (job?.lat && job?.lng) return `https://www.google.com/maps/dir/?api=1&destination=${job.lat},${job.lng}`;
  const sales = salesLocationUrl(job);
  if (sales) return sales;
  if (job?.addressText) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.addressText)}`;
  return null;
}

// Sama dengan frontend/src/utils/format.js#formatRupiah — duplikasi murni
// (runtime beda, bukan reuse lintas bundle), satu fungsi kecil tidak
// sebanding dengan biaya bikin package bersama.
export function formatRupiah(n) {
  return "Rp" + (n || 0).toLocaleString("id-ID");
}

// Waktu relatif ringkas ("5 menit lalu") — dipakai AdminHomeScreen (status
// driver/GPS terakhir, kapan job gagal). Bukan dayjs (sudah ada sbg
// dependency tapi plugin relativeTime + locale id belum di-setup di
// project ini) — perhitungan manual lebih murah utk 1 kebutuhan kecil ini.
export function relatifWaktu(dateStr) {
  if (!dateStr) return "—";
  const menit = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (menit < 1) return "baru saja";
  if (menit < 60) return `${menit} menit lalu`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam lalu`;
  return `${Math.floor(jam / 24)} hari lalu`;
}

export function estJamUntukTampilan(timeWindow) {
  if (!timeWindow || !timeWindow.trim()) return null;
  return timeWindow.trim().replace(/^EST:?\s*/i, "").replace(/^di\s*atas\s+jam\s*/i, "Di atas ");
}
