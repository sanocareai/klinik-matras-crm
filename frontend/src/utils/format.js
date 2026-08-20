// ─── TANGGAL: SEMUA DIDELEGASIKAN KE utils/formatDate.js ─────────────────────
// Helper tanggal di file ini dulunya memakai `toLocaleDateString()` langsung,
// artinya hasilnya mengikuti timezone DEVICE. Sekarang semuanya tipis saja —
// meneruskan ke formatDate.js yang men-pin Asia/Jakarta. Nama lama
// DIPERTAHANKAN supaya ~20 pemanggil yang sudah ada tidak perlu diubah dan
// langsung ikut benar. Untuk komponen BARU, impor langsung dari formatDate.js.
import {
  formatTanggalLengkap, formatJam, formatRelatif, formatTanggalPendek,
  formatRentangTanggal, formatLabelBulan, hariSejak, toWIB,
} from "./formatDate.js";
import { makeRange } from "../lib/dateRange.js";

export function formatRupiah(n) {
  return "Rp" + (n || 0).toLocaleString("id-ID");
}

// Singkatan untuk ruang terbatas (dashboard KPI card, chart)
export function formatRupiahShort(n) {
  const v = n || 0;
  if (v >= 1_000_000) return "Rp" + (v / 1_000_000).toFixed(1) + "jt";
  if (v >= 1_000) return "Rp" + (v / 1_000).toFixed(0) + "rb";
  return "Rp" + v;
}

// Format nomor HP untuk tampilan: "6281234567890" → "+62 812-3456-7890"
export function formatPhoneDisplay(phone) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("62") && digits.length >= 10) {
    const local = digits.slice(2);
    const a = local.slice(0, 3);
    const b = local.slice(3, 7);
    const c = local.slice(7);
    return "+62 " + [a, b, c].filter(Boolean).join("-");
  }
  return "+" + digits;
}

export function formatTanggalIndo(date = new Date()) {
  return formatTanggalLengkap(date);
}

export function formatWaktu(dateString) {
  return dateString ? formatJam(dateString) : "";
}

export function formatTanggalWaktu(dateString) {
  return dateString ? formatRelatif(dateString) : "";
}

// Timestamp pintar untuk item daftar percakapan (gaya WhatsApp):
// hari ini → jam, minggu ini → nama hari, lebih lama → tanggal pendek.
// Semua perbandingan hari memakai kalender WIB, bukan kalender device.
const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
export function formatConvTimestamp(dateString) {
  if (!dateString) return "";
  const d = toWIB(dateString);
  const diffHari = hariSejak(dateString);

  if (diffHari <= 0) return formatJam(dateString);
  if (diffHari === 1) return "Kemarin";
  if (diffHari < 7) return HARI_ID[d.day()];
  return formatTanggalPendek(dateString);
}

// Map "YYYY-MM" → nama bulan Indonesia singkat
export const MONTH_LABELS_ID = [
  "", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];
export const labelBulan = formatLabelBulan;

export function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(" ").filter(Boolean);
  // name bisa berisi spasi/karakter kosong doang (mis. sinkron kontak WA
  // yang pushName-nya blank) — trim+filter di atas jadi array KOSONG,
  // bukan cuma "1 kata". Tanpa guard ini, parts[0][0] error karena
  // parts[0] undefined (bug nyata production 20 Agt 2026: 1 customer
  // bernama " " bikin seluruh tabel Pelanggan blank).
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  { bg: "#ede9fe", text: "#5b21b6" }, // purple
  { bg: "#dbeafe", text: "#1e40af" }, // blue
  { bg: "#dcfce7", text: "#166534" }, // green
  { bg: "#fce7f3", text: "#9d174d" }, // pink
  { bg: "#ffedd5", text: "#9a3412" }, // orange
];

export function avatarColor(seed) {
  if (!seed) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Warna chip per tag (deterministic berdasarkan text tag)
const TAG_CLASSES = ["tag-purple", "tag-blue", "tag-green", "tag-pink", "tag-orange"];
export function tagClass(tag) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return TAG_CLASSES[Math.abs(hash) % TAG_CLASSES.length];
}

// Revisi 26 Jul 2026: 5 stage (LEAD/QUALIFIED/QUOTED/WON/LOST) → 8 stage yang
// mengikuti exit-criteria operasional nyata. LOST dihapus dari pipeline utama
// (data lama dipetakan ke QUALIFIED lewat migrasi backend).
// Revisi 30 Jul 2026: PAID dihapus (8 → 7 stage) — redundan dengan
// Order.paymentStatus (BELUM_BAYAR/DP/LUNAS) yang sudah ada per-order, lebih
// presisi karena 1 pelanggan bisa punya beberapa order dengan status bayar
// beda-beda (data lama PAID dipetakan ke COMPLETED lewat migrasi backend).
// "Berhasil" sebenarnya sekarang COMPLETED (pekerjaan selesai dikerjakan),
// bukan BOOKED — lihat backend/prisma/schema.prisma untuk definisi
// exit-criteria tiap stage.
export const STAGE_LABELS = {
  NEW: "New",
  QUALIFIED: "Qualified",
  QUOTED: "Quoted",
  BOOKED: "Booked",
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
  REVIEWED: "Already Reviewed",
};

export const ORDER_STATUS_LABELS = {
  PENDING: "Menunggu",
  PICKUP: "Pengambilan",
  PROCESSING: "Diproses",
  READY: "Siap Kirim",
  DELIVERED: "Terkirim",
  CANCELLED: "Dibatalkan",
};

// ⚠️ "Meta Ads" TANPA embel-embel "(FB/IG)". Facebook & Instagram dipisah
// lewat kolom PLATFORM tersendiri (diturunkan dari leadSourceDetail, lihat
// backend/src/services/platformIklan.js) — bukan dijejalkan ke satu label.
// Menggabungnya jadi "Meta Ads (FB/IG)" membuat laporan terbaca seolah
// keduanya tidak bisa dibedakan sama sekali, padahal untuk lead baru
// (CTWA, sejak 13 Agt 2026) platformnya SUDAH diketahui pasti.
export const SOURCE_LABELS = {
  META_ADS:        "Meta Ads",
  GOOGLE_ADS:      "Google Ads",
  WEBSITE_ORGANIC: "Website Organik",
  INSTAGRAM:       "Instagram Organik",
  WHATSAPP_DIRECT: "WhatsApp Langsung",
  REFERRAL:        "Referral",
  OTHER:           "Lainnya",
  // Enum lama — tetap dipetakan agar data customer lama tampil benar
  ADS:     "Iklan",
  WEBSITE: "Website",
};

// Opsi dropdown untuk customer baru (hanya enum aktif, bukan yang deprecated)
export const LEAD_SOURCES = [
  { value: "META_ADS",        label: "Meta Ads" },
  { value: "GOOGLE_ADS",      label: "Google Ads" },
  { value: "WEBSITE_ORGANIC", label: "Website Organik" },
  { value: "INSTAGRAM",       label: "Instagram Organik" },
  { value: "WHATSAPP_DIRECT", label: "WhatsApp Langsung" },
  { value: "REFERRAL",        label: "Referral" },
  { value: "OTHER",           label: "Lainnya" },
];

export const PAYMENT_STATUS_LABELS = {
  BELUM_BAYAR: "Belum Bayar",
  DP:          "DP",
  LUNAS:       "Lunas",
};

export const PAYMENT_STATUS_BADGE = {
  BELUM_BAYAR: { background: "#fef2f2", color: "#dc2626" },
  DP:          { background: "#fff7ed", color: "#f97316" },
  LUNAS:       { background: "#f0fdf4", color: "#16a34a" },
};

export const PAYMENT_STATUSES = ["BELUM_BAYAR", "DP", "LUNAS"];

export const PIPELINE_STAGES = Object.entries(STAGE_LABELS).map(([v, l]) => ({ value: v, label: l }));

export const ORDER_STATUSES = ["PENDING", "PICKUP", "PROCESSING", "READY", "DELIVERED", "CANCELLED"];

// ── WARNA STATUS DOMAIN — SATU SUMBER KEBENARAN (Sano Design System v1) ──────
// Sebelumnya warna badge status di-hardcode tersebar di banyak halaman (rawan
// drift, mis. label "Penawaran" nyangkut di satu tempat). Sekarang setiap
// domain memetakan nilai enum → NAMA VARIANT komponen <Badge> (lihat
// components/ui/badge.jsx). Halaman yang sudah migrasi cukup:
//   <Badge variant={stageVariant(stage)}>{STAGE_LABELS[stage]}</Badge>
// Pemetaan warna mengikuti sano-color-system.md §4 & CLAUDE.md §10.
// PENTING: kunci ORDER_STATUS_VARIANT mengikuti enum NYATA di kode
// (PENDING/PICKUP/... dari ORDER_STATUS_LABELS), bukan daftar lama di CLAUDE.md.
// Hanya 4 hue (aturan Sano DS v2 §badge.jsx): orange = baru/butuh perhatian,
// accent (biru) = sedang berjalan (4 stage tengah, sengaja SATU warna supaya
// progres tidak terasa "loncat-loncat"), green = benar-benar berhasil.
export const STAGE_VARIANT = {
  NEW:       "warning", // oranye — baru masuk, belum diproses
  QUALIFIED: "info",    // biru — sedang berjalan
  QUOTED:    "info",
  BOOKED:    "info",
  SCHEDULED: "info",
  COMPLETED: "success", // hijau — berhasil sebenarnya (pekerjaan selesai; dulu PAID sebelum dihapus 30 Jul 2026)
  REVIEWED:  "success", // hijau — bonus: sudah kasih testimoni
};

export const CONV_STATUS_LABELS = {
  OPEN:     "Terbuka",
  PENDING:  "Pending",
  RESOLVED: "Selesai",
};
export const CONV_STATUS_VARIANT = {
  OPEN:     "info",
  PENDING:  "warning",
  RESOLVED: "neutral",
};

export const HEALTH_LABELS = {
  SAKIT:       "Sakit",
  TIDAK_SAKIT: "Tidak Sakit",
};
export const HEALTH_VARIANT = {
  SAKIT:       "danger",
  TIDAK_SAKIT: "success",
};

export const ORDER_STATUS_VARIANT = {
  PENDING:   "warning",
  PICKUP:    "violet",
  PROCESSING:"info",
  READY:     "info",
  DELIVERED: "success",
  CANCELLED: "neutral",
};

export const PAYMENT_STATUS_VARIANT = {
  BELUM_BAYAR: "danger",
  DP:          "warning",
  LUNAS:       "success",
};

// Helper aman — kembalikan variant "neutral" kalau enum tak dikenal, jadi UI
// tidak pernah blank/crash untuk data lama/tak terduga.
const pick = (map, key) => map[key] || "neutral";
export const stageVariant      = (s) => pick(STAGE_VARIANT, s);
export const convStatusVariant = (s) => pick(CONV_STATUS_VARIANT, s);
export const healthVariant     = (s) => pick(HEALTH_VARIANT, s);
export const orderStatusVariant = (s) => pick(ORDER_STATUS_VARIANT, s);
export const paymentStatusVariant = (s) => pick(PAYMENT_STATUS_VARIANT, s);

// Format range tanggal untuk label di UI (e.g. "1 Jun – 30 Jun 2026")
export const formatDateRange = formatRentangTanggal;

// Helper cepat: apakah pelanggan VIP (total nilai order >= Rp5jt)
export function isVIP(customer) {
  return (customer.orderValue || 0) >= 5_000_000;
}

// Hitung hari sejak last message (butuh field lastMessageAt dari backend).
// Sekarang selisih HARI KALENDER WIB, bukan selisih 24 jam — "tidak aktif 30
// hari" jadi cocok dengan yang dilihat user di kolom tanggal.
export const daysSinceLastChat = hariSejak;

// Durasi RELATIF & ringkas — satu satuan saja, dibulatkan.
// "45 mnt" · "3 jam" · "25 hari" · "2 bln"
//
// Dipakai untuk WAKTU TUNGGU (antrean follow-up). formatDuration() di bawah
// menghasilkan "615 jam 9 mnt" untuk kasus lama — presisi menit tidak ada
// gunanya pada angka sebesar itu, dan justru menyembunyikan fakta
// sesungguhnya ("sudah 25 hari"). Untuk durasi kerja yang pendek (mis. avg
// response time) formatDuration() tetap yang benar.
export function formatDurasiRelatif(minutes) {
  const m = Math.round(Number(minutes) || 0);
  if (m < 1) return "baru saja";
  if (m < 60) return `${m} mnt`;
  const jam = Math.floor(m / 60);
  if (jam < 24) return `${jam} jam`;
  const hari = Math.floor(jam / 24);
  if (hari < 60) return `${hari} hari`;
  return `${Math.floor(hari / 30)} bln`;
}

// Format durasi menit ke "X jam Y mnt" atau "X mnt"
export function formatDuration(minutes) {
  if (!minutes && minutes !== 0) return "—";
  const m = Math.round(minutes);
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h} jam ${rem} mnt` : `${h} jam`;
}

// Helper untuk baca/tulis nilai dari tag dengan prefix (misal: "ukuran:160x200", "merk:Comforta")
export function getTagPrefix(tags, prefix) {
  const tag = (tags || []).find((t) => t.toLowerCase().startsWith(prefix.toLowerCase() + ":"));
  return tag ? tag.slice(prefix.length + 1) : "";
}
export function setTagPrefix(tags, prefix, value) {
  const filtered = (tags || []).filter((t) => !t.toLowerCase().startsWith(prefix.toLowerCase() + ":"));
  if (value?.trim()) filtered.push(`${prefix}:${value.trim()}`);
  return filtered;
}
// Filter tag biasa (buang yang pakai prefix khusus)
export function publicTags(tags) {
  const PREFIXES = ["ukuran", "merk"];
  return (tags || []).filter((t) => !PREFIXES.some((p) => t.toLowerCase().startsWith(p + ":")));
}

export const KOTA_LIST = [
  "Jakarta Selatan", "Jakarta Barat", "Jakarta Utara", "Jakarta Pusat", "Jakarta Timur",
  "Bekasi", "Tangerang", "Bogor", "Depok", "Bandung", "Sukabumi", "Karawang",
];

// D-028 (20 Agustus 2026, revisi multi-pilih) — dipakai di Order.complaintCategory
// DAN Customer.complaintCategory (dua field independen, sama enum). Dipindah ke
// sini (sebelumnya duplikat di OrderSection.jsx & InfoSection.jsx) supaya cuma
// ada SATU daftar label, juga dipakai export Excel di Orders.jsx.
export const HEALTH_COMPLAINT_LABELS = {
  KEPALA_PUSING:  "Kepala Pusing",
  SAKIT_PINGGANG: "Sakit Pinggang",
  SAKIT_PUNGGUNG: "Sakit Punggung",
  SAKIT_LEHER:    "Sakit Leher",
  BAHU:           "Bahu",
  PEGAL_PEGAL:    "Pegal-pegal",
  SARAF_KEJEPIT:  "Saraf Kejepit",
  SKOLIOSIS:      "Skoliosis",
  LAINNYA:        "Lainnya",
};
export const HEALTH_COMPLAINT_OPTIONS = Object.keys(HEALTH_COMPLAINT_LABELS);

// D-029 (20 Agustus 2026) — merk/ukuran/keluhan kasur dulu disimpan JSON di
// Order.notes (bukan kolom sendiri, migrasi database dianggap tidak sepadan
// saat itu). Dipindah ke sini dari OrderSection.jsx (sebelumnya lokal, tidak
// bisa dipakai export Excel di Orders.jsx).
export function parseOrderNotes(notes) {
  if (!notes) return { merkKasur: "", ukuranKasur: "", keluhanCustomer: "" };
  try {
    const p = JSON.parse(notes);
    return {
      merkKasur:       p.merkKasur || "",
      ukuranKasur:     p.ukuranKasur || "",
      keluhanCustomer: p.keluhanCustomer || "",
    };
  } catch {
    return { merkKasur: "", ukuranKasur: "", keluhanCustomer: notes };
  }
}
export function buildOrderNotes(info) {
  return JSON.stringify({
    merkKasur:       info.merkKasur || "",
    ukuranKasur:     info.ukuranKasur || "",
    keluhanCustomer: info.keluhanCustomer || "",
  });
}

// D-026 fix (20 Agustus 2026): satu campaign (mis. "MDSP-Aug") sering punya
// BEBERAPA kode voucher berbeda (MERDEKA10, MERDEKA8, dst) sebagai promo
// TERPISAH dengan `name` yang sama persis — kode SELALU ditaruh duluan
// (paling menonjol) karena itu satu-satunya pembeda antar promo serupa.
export function promoLabel(p) {
  return `${p.code} — ${p.name}`;
}

// Preset date range — KOMPATIBILITAS. Definisi kanonik seluruh preset sekarang
// ada di lib/dateRange.js (skema tanggal, dipakai DateRangePicker gaya Google
// Ads). Fungsi ini cuma memetakan key lama ("7d"/"30d"/"3m") ke id preset baru
// supaya pemanggil lama tidak perlu diubah dan tidak ada DUA definisi "30 hari
// terakhir" yang bisa saling drift.
//
// Kode BARU sebaiknya langsung pakai makeRange() dari lib/dateRange.js.
const KEY_LAMA_KE_PRESET = {
  today: "today",
  "7d":  "last_7_days",
  "30d": "last_30_days",
  "3m":  "last_3_months",
};
export function getDatePreset(preset) {
  const id = KEY_LAMA_KE_PRESET[preset];
  if (!id) return { from: "", to: "" };
  const { from, to } = makeRange(id);
  return { from, to };
}
