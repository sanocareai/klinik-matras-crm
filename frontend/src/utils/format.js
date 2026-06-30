export function formatRupiah(n) {
  return "Rp" + (n || 0).toLocaleString("id-ID");
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
  QUOTED: "Penawaran",
  WON: "Berhasil",
  LOST: "Gagal",
};

export const ORDER_STATUS_LABELS = {
  PENDING: "Menunggu",
  PROCESSING: "Diproses",
  READY: "Siap Kirim",
  DELIVERED: "Terkirim",
  CANCELLED: "Dibatalkan",
};

export const SOURCE_LABELS = {
  ADS: "Iklan",
  INSTAGRAM: "Instagram",
  WEBSITE: "Website",
  WHATSAPP_DIRECT: "WhatsApp",
  REFERRAL: "Referral",
  OTHER: "Lainnya",
};

export const LEAD_SOURCES = Object.entries(SOURCE_LABELS).map(([v, l]) => ({ value: v, label: l }));

export const PIPELINE_STAGES = Object.entries(STAGE_LABELS).map(([v, l]) => ({ value: v, label: l }));

export const ORDER_STATUSES = ["PENDING", "PROCESSING", "READY", "DELIVERED", "CANCELLED"];

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
