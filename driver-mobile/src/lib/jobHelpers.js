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

// Sama dengan frontend/src/utils/format.js#waLinkFromPhone (12 September
// 2026, laporan owner: "klik nomer customer langsung ke wa, bukan
// tambah kontak/ketik nomer") — duplikasi murni (runtime beda), tel:
// dulu dipakai tombol "Telepon" di JobCard.js, Linking.openURL(tel:)
// di Android SELALU buka dialer (bukan bug spesifik app ini), tapi
// intent-nya driver memang mau chat WA, bukan menelepon.
export function waLinkFromPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return null;
  const num = digits.startsWith("0") ? "62" + digits.slice(1) : digits;
  return `https://wa.me/${num}`;
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

// Label layanan/produk ringkas ("apa yang dikerjakan di order ini") — port
// dari jobStatus.js#serviceLabelOf (17 September 2026, laporan owner:
// "tambah nama sales, keterangan produk setiap card seperti di web route
// planner"). Dari OrderItem pertama (sortOrder asc), bukan rincian lengkap.
export function serviceLabelOf(job) {
  return job?.order?.items?.[0]?.layananName || job?.units?.[0]?.unit?.order?.items?.[0]?.layananName || null;
}

// Port dari frontend/src/utils/format.js — HANYA yang dipakai produkLabelOf
// di bawah, bukan seluruh peta enum produk (banyak yang khusus form order
// sales, tidak relevan di sini).
const PRODUCT_LINE_LABELS = { KASUR: "Kasur", SOFA: "Sofa", DIVAN: "Divan" };
const PRODUCT_TYPE_LABELS = {
  KASUR_SPRING: "Kasur Spring", KASUR_BUSA: "Kasur Busa", MULTIBED: "Multibed",
  KASUR_2IN1_ATAS: "Kasur 2in1 Atas", KASUR_2IN1_BAWAH: "Kasur 2in1 Bawah",
  SOFABED: "Sofabed", SOFA_L: "Sofa L", SOFA_1_SEATER: "Sofa 1 Seater",
  SOFA_2_SEATER: "Sofa 2 Seater", SOFA_3_SEATER: "Sofa 3 Seater",
  DIVAN_SANDARAN: "Sandaran", KASUR_SEHAT: "Kasur Sehat", KASUR_2IN1: "Kasur 2in1",
  KASUR_LAINNYA: "Lainnya", DIVAN_UTAMA: "Divan",
};

// Port dari frontend/src/utils/format.js#parseOrderNotes — Order.notes JSON
// (merk/ukuran kasur, D-029) belum punya kolom sendiri.
function parseOrderNotes(notes) {
  if (!notes) return { merkKasur: "", ukuranKasur: "" };
  try {
    const p = JSON.parse(notes);
    return { merkKasur: p.merkKasur || "", ukuranKasur: p.ukuranKasur || "" };
  } catch {
    return { merkKasur: "", ukuranKasur: "" };
  }
}

// Label PRODUK ringkas (kasur + ukuran) — port dari jobStatus.js#produkLabelOf
// web (17 September 2026, laporan owner: "yang muncul jenis layanan, bukan
// produk contoh kasur... ukuran..."). BEDA dari serviceLabelOf di atas (itu
// nama PAKET, mis. "Paket Upgrade..."; ini BENDANYA, mis. "Kasur Spring ·
// 160x200"). SATU SUMBER dengan produkLineLabel (backend services/invoice.js)
// / productSummary (frontend orderSummary.js) — logika SEWA-selalu-pakai-
// brand (D-170) sama, jangan duplikasi aturan lagi di tempat keempat.
export function produkLabelOf(job) {
  const order = job?.order || job?.units?.[0]?.unit?.order;
  if (!order) return null;
  const { ukuranKasur, merkKasur } = parseOrderNotes(order.notes);
  if (order.category === "SEWA") {
    return [merkKasur || "Sano", ukuranKasur].filter(Boolean).join(" · ") || null;
  }
  const line = PRODUCT_LINE_LABELS[order.productLine] || "Kasur";
  const type = order.productType ? (PRODUCT_TYPE_LABELS[order.productType] || order.productType) : "";
  const produk = type && !type.toLowerCase().startsWith(line.toLowerCase()) ? `${line} ${type}` : (type || line);
  return [produk, ukuranKasur].filter(Boolean).join(" · ") || null;
}

// Sales yang pegang order ini — port dari jobStatus.js#salesPersonOf, sama
// laporan owner dengan serviceLabelOf di atas.
export function salesPersonOf(job) {
  return (
    job?.order?.customer?.assignedSales?.name ||
    job?.units?.[0]?.unit?.order?.customer?.assignedSales?.name ||
    null
  );
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
