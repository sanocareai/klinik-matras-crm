// Utility format tanggal & uang — konvensi sama dengan versi web (seksi 11 CLAUDE.md)
import dayjs from "dayjs";
import "dayjs/locale/id.js";
import { avatarColors } from "../theme";

dayjs.locale("id");

const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

// Timestamp pintar gaya WhatsApp — SAMA dengan
// frontend/src/features/inbox/utils/formatTime.js#smartTimestamp: "14:30"
// hari ini, "Kemarin", nama hari kalau <7 hari, "12/07/26" kalau lebih lama.
// Dipakai InboxScreen (ChatListScreen.js), beda dari timeAgo() di bawah yang
// masih dipakai layar lama (relatif "5 mnt", "2 jam").
export function smartTimestamp(date) {
  if (!date) return "";
  const d = dayjs(date);
  if (!d.isValid()) return "";

  const now = dayjs();
  const diffHari = now.startOf("day").diff(d.startOf("day"), "day");

  if (diffHari <= 0) return d.format("HH:mm");
  if (diffHari === 1) return "Kemarin";
  if (diffHari < 7) return HARI_ID[d.day()];
  return d.format("DD/MM/YY");
}

export function formatRupiah(n) {
  return "Rp" + (n || 0).toLocaleString("id-ID");
}

// Order/Payment status — SAMA PERSIS dengan frontend/src/utils/format.js
// (dan backend/prisma/schema.prisma enum OrderStatus/PaymentStatus, sumber
// kebenaran). BUG (fix): versi lama CustomerProfileContent.js punya mapping
// SALAH (WAITING_LIST/PENGAMBILAN/PENGERJAAN/FINISH — enum yang sudah tidak
// dipakai), jadi status order tampil mentah ("PENDING" dst, bukan
// "Menunggu") — dipindah ke sini supaya satu sumber dipakai OrderCard.js
// juga, tidak dobel-definisi lagi.
export const ORDER_STATUS_LABELS = {
  PENDING: "Menunggu",
  PICKUP: "Pengambilan",
  PROCESSING: "Diproses",
  READY: "Siap Kirim",
  DELIVERED: "Terkirim",
  CANCELLED: "Dibatalkan",
};
export const ORDER_STATUS_BADGE = {
  PENDING:    { backgroundColor: "#fef3c7", color: "#92400e" },
  PICKUP:     { backgroundColor: "#dbeafe", color: "#1e40af" },
  PROCESSING: { backgroundColor: "#ede9fe", color: "#5b21b6" },
  READY:      { backgroundColor: "#ccfbf1", color: "#065f46" },
  DELIVERED:  { backgroundColor: "#dcfce7", color: "#166534" },
  CANCELLED:  { backgroundColor: "#fee2e2", color: "#991b1b" },
};
export const ORDER_STATUSES = ["PENDING", "PICKUP", "PROCESSING", "READY", "DELIVERED", "CANCELLED"];

export const PAYMENT_STATUS_LABELS = { BELUM_BAYAR: "Belum Bayar", DP: "DP", LUNAS: "Lunas" };
export const PAYMENT_STATUS_BADGE = {
  BELUM_BAYAR: { backgroundColor: "#fef2f2", color: "#dc2626" },
  DP:          { backgroundColor: "#fff7ed", color: "#f97316" },
  LUNAS:       { backgroundColor: "#f0fdf4", color: "#16a34a" },
};
export const PAYMENT_STATUSES = ["BELUM_BAYAR", "DP", "LUNAS"];

export const CATEGORY_LABELS = { LAYANAN: "Service/Upgrade", BARU: "Kasur Baru", SEWA: "Kasur Sewa" };
export const CATEGORY_BADGE = {
  LAYANAN: { backgroundColor: "#ede9fe", color: "#5b21b6" },
  BARU:    { backgroundColor: "#dcfce7", color: "#166534" },
  SEWA:    { backgroundColor: "#dbeafe", color: "#1e40af" },
};

// "5 mnt", "2 jam", "3 hari", atau tanggal pendek kalau sudah lama
export function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mnt = Math.floor(diff / 60000);
  if (mnt < 1) return "baru saja";
  if (mnt < 60) return `${mnt} mnt`;
  const jam = Math.floor(mnt / 60);
  if (jam < 24) return `${jam} jam`;
  const hari = Math.floor(jam / 24);
  if (hari < 7) return `${hari} hari`;
  return shortDate(dateStr);
}

// "1 Jul"
export function shortDate(dateStr) {
  const d = new Date(dateStr);
  const bulan = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${d.getDate()} ${bulan[d.getMonth()]}`;
}

// "14:05" untuk timestamp di bubble chat
export function clockTime(dateStr) {
  const d = new Date(dateStr);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Label divider tanggal di dalam percakapan (gaya WhatsApp) — SAMA dengan
// frontend/src/features/inbox/utils/formatTime.js#dateDividerLabel: "Hari
// Ini", "Kemarin", atau tanggal lengkap ("12 Juli 2026") untuk yang lebih lama.
export function dateDividerLabel(dateStr) {
  const d = dayjs(dateStr);
  if (!d.isValid()) return "";
  const diffHari = dayjs().startOf("day").diff(d.startOf("day"), "day");
  if (diffHari === 0) return "Hari Ini";
  if (diffHari === 1) return "Kemarin";
  return d.format("D MMMM YYYY");
}

// Inisial nama untuk avatar: "Budi Santoso" → "BS"
export function initials(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// Warna avatar konsisten per nama (hash sederhana)
export function avatarColor(name) {
  let hash = 0;
  for (const ch of name || "?") hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return avatarColors[hash % avatarColors.length];
}
