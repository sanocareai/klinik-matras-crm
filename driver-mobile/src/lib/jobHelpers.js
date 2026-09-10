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

export function estJamUntukTampilan(timeWindow) {
  if (!timeWindow || !timeWindow.trim()) return null;
  return timeWindow.trim().replace(/^EST:?\s*/i, "").replace(/^di\s*atas\s+jam\s*/i, "Di atas ");
}
