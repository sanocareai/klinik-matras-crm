export function formatRupiah(n) {
  return "Rp" + (n || 0).toLocaleString("id-ID");
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
  return date.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function formatWaktu(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export function formatTanggalWaktu(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  const now = new Date();
  const diffMs = now - d;
  const diffMnt = Math.floor(diffMs / 60000);
  const diffJam = Math.floor(diffMnt / 60);
  const diffHari = Math.floor(diffJam / 24);

  if (diffMnt < 1) return "Baru saja";
  if (diffMnt < 60) return `${diffMnt} mnt lalu`;
  if (diffHari === 0) return formatWaktu(dateString);
  if (diffHari === 1) return "Kemarin";
  if (diffHari < 7) return `${diffHari} hari lalu`;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

// Timestamp pintar untuk item daftar percakapan (gaya WhatsApp):
// hari ini → jam, minggu ini → nama hari, lebih lama → tanggal pendek
const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
export function formatConvTimestamp(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffHari = Math.floor((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000);

  if (diffHari <= 0) return formatWaktu(dateString);
  if (diffHari === 1) return "Kemarin";
  if (diffHari < 7) return HARI_ID[d.getDay()];
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

// Map "YYYY-MM" → nama bulan Indonesia singkat
export const MONTH_LABELS_ID = [
  "", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];
export function labelBulan(ymStr) {
  const m = parseInt(ymStr?.split("-")[1] || "0", 10);
  return MONTH_LABELS_ID[m] || ymStr;
}

export function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(" ").filter(Boolean);
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

export const STAGE_LABELS = {
  LEAD: "Lead",
  QUALIFIED: "Prospek",
  QUOTED: "Offers/Negosiasi",
  WON: "Berhasil",
  LOST: "Gagal",
};

export const ORDER_STATUS_LABELS = {
  PENDING: "Menunggu",
  PICKUP: "Pengambilan",
  PROCESSING: "Diproses",
  READY: "Siap Kirim",
  DELIVERED: "Terkirim",
  CANCELLED: "Dibatalkan",
};

export const SOURCE_LABELS = {
  META_ADS:        "Meta Ads (FB/IG)",
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
  { value: "META_ADS",        label: "Meta Ads (FB/IG)" },
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

// Format range tanggal untuk label di UI (e.g. "1 Jun – 30 Jun 2026")
export function formatDateRange(from, to) {
  if (!from || !to) return "";
  const opts = { day: "numeric", month: "short", year: "numeric" };
  return `${new Date(from).toLocaleDateString("id-ID", opts)} – ${new Date(to).toLocaleDateString("id-ID", opts)}`;
}

// Helper cepat: apakah pelanggan VIP (total nilai order >= Rp5jt)
export function isVIP(customer) {
  return (customer.orderValue || 0) >= 5_000_000;
}

// Hitung hari sejak last message (butuh field lastMessageAt dari backend)
export function daysSinceLastChat(dateString) {
  if (!dateString) return Infinity;
  const diff = Date.now() - new Date(dateString).getTime();
  return Math.floor(diff / 86_400_000);
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

export const UKURAN_KASUR = [
  "90x200 cm (Single)",
  "120x200 cm (Single Besar)",
  "160x200 cm (Queen)",
  "180x200 cm (King)",
  "200x200 cm (King Besar)",
  "Ukuran Custom",
];

export const MERK_KASUR = [
  "Comforta", "Spring Air", "Dunlopillo", "Therapedic",
  "King Koil", "Sealy", "Serta", "Lady Americana",
  "Elite", "Florence", "Guhdo", "Sano", "Lainnya",
];

// Preset date ranges untuk DateRangePicker
export function getDatePreset(preset) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case "today": {
      const f = fmt(today);
      return { from: f, to: f };
    }
    case "7d": {
      const from = new Date(today); from.setDate(today.getDate() - 6);
      return { from: fmt(from), to: fmt(today) };
    }
    case "30d": {
      const from = new Date(today); from.setDate(today.getDate() - 29);
      return { from: fmt(from), to: fmt(today) };
    }
    case "3m": {
      const from = new Date(today); from.setMonth(today.getMonth() - 3);
      return { from: fmt(from), to: fmt(today) };
    }
    default:
      return { from: "", to: "" };
  }
}
