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
