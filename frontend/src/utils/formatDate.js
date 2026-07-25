// ─── SATU SUMBER KEBENARAN FORMAT TANGGAL (WIB) ──────────────────────────────
//
// ARSITEKTUR: UTC di dalam, WIB di tepi.
//   - Backend menyimpan & mengirim SELALU instant UTC (ISO 8601, akhiran "Z").
//   - Konversi ke WIB terjadi HANYA di sini, tepat sebelum dirender ke user.
//
// KENAPA HARUS DI-PIN KE Asia/Jakarta, bukan andalkan jam device:
// `new Date(iso).toLocaleDateString("id-ID")` memakai timezone DEVICE. Selama
// semua sales duduk di Jakarta hasilnya kebetulan benar — tapi langsung salah
// begitu ada device dengan timezone keliru (HP Android sering reset ke UTC
// setelah factory reset), user buka CRM saat perjalanan luar negeri, atau
// laporan dibuka dari VPS/headless browser. Angka laporan tidak boleh berubah
// tergantung siapa yang membukanya, jadi zona di-pin keras di sini.
//
// PENTING — JANGAN pakai `new Date(...).toLocaleDateString()` langsung di
// komponen baru. Selalu impor dari file ini supaya WIB terjamin dan format
// konsisten di seluruh CRM.

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import "dayjs/locale/id.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale("id");

export const WIB = "Asia/Jakarta";

// Parse instant apa pun (ISO string / Date / epoch ms) → dayjs di zona WIB.
// Dipakai internal; komponen sebaiknya pakai helper format di bawah.
export function toWIB(value) {
  return dayjs(value).tz(WIB);
}

// Apakah nilai tanggalnya bisa dipakai? Backend banyak field nullable
// (complaintDate, lastMessageAt, readAt) — semua helper di bawah memakai ini
// dan mengembalikan EM-DASH, supaya UI tidak pernah menampilkan
// "Invalid Date" atau blank.
function invalid(value) {
  return value === null || value === undefined || value === "" || !dayjs(value).isValid();
}

const KOSONG = "—";

// "25 Jul 2026" — default untuk tabel & daftar (ruang terbatas).
export function formatTanggal(value) {
  if (invalid(value)) return KOSONG;
  return toWIB(value).format("D MMM YYYY");
}

// "25 Juli 2026" — bulan penuh, untuk header/detail.
export function formatTanggalPanjang(value) {
  if (invalid(value)) return KOSONG;
  return toWIB(value).format("D MMMM YYYY");
}

// "Sabtu, 25 Juli 2026" — konvensi CLAUDE.md §11 "tanggal absolut".
export function formatTanggalLengkap(value) {
  if (invalid(value)) return KOSONG;
  return toWIB(value).format("dddd, D MMMM YYYY");
}

// "25 Jul" — konvensi CLAUDE.md §11 "tanggal pendek" (chart, chip).
export function formatTanggalPendek(value) {
  if (invalid(value)) return KOSONG;
  return toWIB(value).format("D MMM");
}

// "14.30" — jam saja, WIB.
export function formatJam(value) {
  if (invalid(value)) return KOSONG;
  return toWIB(value).format("HH.mm");
}

// "25 Jul 2026, 14.30" — tanggal + jam untuk audit trail / riwayat.
export function formatTanggalJam(value) {
  if (invalid(value)) return KOSONG;
  return toWIB(value).format("D MMM YYYY, HH.mm");
}

// "1 Jun – 30 Jun 2026" — label periode laporan. Tahun ditulis sekali kalau
// from & to masih di tahun yang sama (lebih ringkas di header Laporan).
export function formatRentangTanggal(from, to) {
  if (invalid(from) || invalid(to)) return "";
  const a = toWIB(from);
  const b = toWIB(to);
  const awal = a.year() === b.year() ? a.format("D MMM") : a.format("D MMM YYYY");
  return `${awal} – ${b.format("D MMM YYYY")}`;
}

// "YYYY-MM" → "Jul". Bucket bulanan dari backend (/analytics/overview) sudah
// dikelompokkan menurut kalender WIB di SQL-nya (lihat backend/src/utils/wib.js),
// jadi di sini cuma pelabelan — JANGAN di-parse ulang sebagai instant, karena
// "2026-07" akan jadi 1 Juli 00:00 UTC = masih 30 Juni di WIB dan labelnya
// bergeser satu bulan.
const BULAN_SINGKAT = [
  "", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];
export function formatLabelBulan(ymStr) {
  const m = parseInt(String(ymStr || "").split("-")[1] || "0", 10);
  return BULAN_SINGKAT[m] || ymStr;
}

// Tanggal kalender hari ini MENURUT WIB, format "YYYY-MM-DD" — bentuk yang
// dikirim ke backend sebagai ?from=/?to= (lihat buildDateWhere di
// backend/src/routes/analytics.js, yang menafsirkannya sebagai tanggal WIB).
export function hariIniWIB() {
  return dayjs().tz(WIB).format("YYYY-MM-DD");
}

// Relatif singkat: "Baru saja", "5 mnt lalu", "2 jam lalu", "Kemarin",
// "3 hari lalu", lalu jatuh ke tanggal pendek. Konvensi CLAUDE.md §11.
export function formatRelatif(value) {
  if (invalid(value)) return KOSONG;
  const d = toWIB(value);
  const sekarang = dayjs().tz(WIB);
  const menit = sekarang.diff(d, "minute");

  if (menit < 1) return "Baru saja";
  if (menit < 60) return `${menit} mnt lalu`;

  // Selisih HARI KALENDER WIB (bukan selisih 24 jam) — supaya jam 23:00 lalu
  // jam 01:00 tetap terbaca "Kemarin", bukan "2 jam lalu".
  const hari = sekarang.startOf("day").diff(d.startOf("day"), "day");
  if (hari === 0) return formatJam(value);
  if (hari === 1) return "Kemarin";
  if (hari < 7) return `${hari} hari lalu`;
  return formatTanggalPendek(value);
}

// Selisih hari kalender WIB dari sekarang — dipakai untuk aturan "tidak aktif
// 30 hari" dsb. Infinity kalau tanggalnya tidak ada (customer belum pernah
// chat), supaya lolos filter "paling lama tidak aktif".
export function hariSejak(value) {
  if (invalid(value)) return Infinity;
  return dayjs().tz(WIB).startOf("day").diff(toWIB(value).startOf("day"), "day");
}
