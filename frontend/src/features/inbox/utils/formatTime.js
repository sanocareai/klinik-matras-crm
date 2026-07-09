import dayjs from "dayjs";
import "dayjs/locale/id.js";

dayjs.locale("id");

const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

// Timestamp pintar gaya WhatsApp: "14:30" hari ini, "Kemarin", nama hari
// kalau <7 hari, "12/07/26" kalau lebih lama. Versi dayjs dari
// utils/format.js#formatConvTimestamp (yang lama pakai Date native) —
// disiapkan untuk komponen baru Fase B yang sudah pakai dayjs di seluruh lib/.
export function smartTimestamp(date) {
  if (!date) return "";
  const d = dayjs(date);
  if (!d.isValid()) return "";

  const now = dayjs();
  const startOfToday = now.startOf("day");
  const diffHari = startOfToday.diff(d.startOf("day"), "day");

  if (diffHari <= 0) return d.format("HH:mm");
  if (diffHari === 1) return "Kemarin";
  if (diffHari < 7) return HARI_ID[d.day()];
  return d.format("DD/MM/YY");
}
