import dayjs from "dayjs";
import { toWIB, formatTanggal, formatTanggalPendek } from "@/utils/formatDate.js";

// ═══════════════════════════════════════════════════════════════════════════
//  SKEMA RENTANG TANGGAL — SATU SUMBER KEBENARAN
//  Semua elemen terkait tanggal di CRM (Dashboard, Laporan, dan halaman baru
//  nanti) memakai bentuk & preset dari file ini. UI-nya mengikuti pola date
//  picker Google Ads (daftar preset di kiri + kalender multi-bulan di kanan).
// ═══════════════════════════════════════════════════════════════════════════
//
//  ── BENTUK KANONIK ────────────────────────────────────────────────────────
//  DateRange = {
//    preset:  string   id dari DATE_PRESETS (atau "custom" kalau dipilih manual)
//    from:    string   "YYYY-MM-DD" tanggal kalender WIB, INKLUSIF. null = tanpa batas
//    to:      string   "YYYY-MM-DD" tanggal kalender WIB, INKLUSIF. null = tanpa batas
//    n:       number   hanya untuk preset berparameter (N hari hingga ...)
//    compare: boolean  tampilkan perbandingan dengan periode sebelumnya
//  }
//
//  ── ATURAN YANG TIDAK BOLEH DILANGGAR ─────────────────────────────────────
//  1. from/to adalah TANGGAL KALENDER WIB, bukan instant. Ini kontrak dengan
//     backend: buildDateWhere() di routes/analytics.js menerjemahkannya jadi
//     batas instant UTC (lihat backend/src/utils/wib.js). JANGAN kirim ISO
//     lengkap atau epoch.
//  2. Semua perhitungan lewat toWIB() — JANGAN pakai `new Date(y,m,d)` atau
//     dayjs() polos, karena itu mengikuti timezone DEVICE. Angka laporan tidak
//     boleh berubah tergantung siapa yang membukanya.
//  3. `to` INKLUSIF. Backend yang mengubahnya jadi batas eksklusif (`lt` awal
//     hari berikutnya) — jangan dikompensasi dua kali di sini.
//
//  ── BEDA SENGAJA DARI GOOGLE ADS ──────────────────────────────────────────
//  Di Google Ads, "7 hari terakhir" TIDAK termasuk hari ini (data iklan
//  tertunda). Di CRM ini "N hari terakhir" SUDAH SELALU termasuk hari ini, dan
//  itu DIPERTAHANKAN — kalau diubah, semua angka laporan yang tim sudah hafal
//  akan bergeser diam-diam. Yang butuh perilaku Google Ads pakai preset
//  "N hari hingga kemarin" yang disediakan terpisah (sama seperti dua kotak
//  angka di bawah panel Google Ads).

const fmt = (d) => d.format("YYYY-MM-DD");

// Hari ini menurut kalender WIB, di awal hari.
export function todayWIB() {
  return toWIB(Date.now()).startOf("day");
}

// Awal minggu = MINGGU (kolom pertama kalender di UI adalah "M" = Minggu).
// Sengaja dihitung manual, TIDAK pakai dayjs().startOf("week") — hasilnya
// tergantung locale (locale "id" menganggap minggu mulai Senin), jadi bisa
// bergeser 1 hari tanpa terlihat.
export function startOfWeekSunday(d) {
  return d.subtract(d.day(), "day"); // d.day(): 0=Minggu … 6=Sabtu
}

// ── REGISTRY PRESET ────────────────────────────────────────────────────────
// `resolve(n)` → { from, to } dalam "YYYY-MM-DD" (atau null untuk tanpa batas).
// `step` → satuan geser tombol ‹ › : "range" (sepanjang rentang) | "month" | null.
// `parametrized` → butuh input angka N.
export const DATE_PRESETS = [
  {
    id: "today", label: "Hari ini", step: "range",
    resolve: () => { const t = todayWIB(); return { from: fmt(t), to: fmt(t) }; },
  },
  {
    id: "yesterday", label: "Kemarin", step: "range",
    resolve: () => { const y = todayWIB().subtract(1, "day"); return { from: fmt(y), to: fmt(y) }; },
  },
  {
    id: "this_week", label: "Minggu ini (Min – Hari ini)", step: "range",
    resolve: () => { const t = todayWIB(); return { from: fmt(startOfWeekSunday(t)), to: fmt(t) }; },
  },
  {
    id: "last_7_days", label: "7 hari terakhir", step: "range",
    resolve: () => { const t = todayWIB(); return { from: fmt(t.subtract(6, "day")), to: fmt(t) }; },
  },
  {
    id: "last_week", label: "Minggu lalu (Min – Sab)", step: "range",
    resolve: () => {
      const awal = startOfWeekSunday(todayWIB()).subtract(7, "day");
      return { from: fmt(awal), to: fmt(awal.add(6, "day")) };
    },
  },
  {
    id: "last_14_days", label: "14 hari terakhir", step: "range",
    resolve: () => { const t = todayWIB(); return { from: fmt(t.subtract(13, "day")), to: fmt(t) }; },
  },
  {
    id: "this_month", label: "Bulan ini", step: "month",
    resolve: () => { const t = todayWIB(); return { from: fmt(t.startOf("month")), to: fmt(t) }; },
  },
  {
    id: "last_30_days", label: "30 hari terakhir", step: "range",
    resolve: () => { const t = todayWIB(); return { from: fmt(t.subtract(29, "day")), to: fmt(t) }; },
  },
  {
    id: "last_month", label: "Bulan lalu", step: "month",
    resolve: () => {
      const b = todayWIB().subtract(1, "month");
      return { from: fmt(b.startOf("month")), to: fmt(b.endOf("month")) };
    },
  },
  {
    // Dipertahankan dari picker lama (dulu key "3m") supaya preset yang biasa
    // dipakai tim tidak hilang — tidak ada padanannya di Google Ads.
    id: "last_3_months", label: "3 bulan terakhir", step: "range",
    resolve: () => { const t = todayWIB(); return { from: fmt(t.subtract(3, "month")), to: fmt(t) }; },
  },
  {
    // from/to null = TANPA filter tanggal. buildDateWhere() di backend
    // mengembalikan {} kalau salah satu kosong, jadi ini otomatis "semua data".
    id: "all_time", label: "Semua", step: null,
    resolve: () => ({ from: null, to: null }),
  },
  {
    id: "n_days_to_today", label: "hari hingga hari ini", step: "range", parametrized: true,
    resolve: (n) => { const t = todayWIB(); return { from: fmt(t.subtract(Math.max(1, n) - 1, "day")), to: fmt(t) }; },
  },
  {
    id: "n_days_to_yesterday", label: "hari hingga kemarin", step: "range", parametrized: true,
    resolve: (n) => {
      const y = todayWIB().subtract(1, "day");
      return { from: fmt(y.subtract(Math.max(1, n) - 1, "day")), to: fmt(y) };
    },
  },
];

export const PRESET_BY_ID = Object.fromEntries(DATE_PRESETS.map((p) => [p.id, p]));

// Preset yang tampil sebagai daftar biasa di panel (yang berparameter punya
// baris input angka sendiri di bawah).
export const SIMPLE_PRESETS = DATE_PRESETS.filter((p) => !p.parametrized);
export const PARAM_PRESETS  = DATE_PRESETS.filter((p) => p.parametrized);

export const DEFAULT_PRESET = "last_30_days";

// Bangun DateRange lengkap dari id preset.
export function makeRange(presetId, { n = 30, compare = false } = {}) {
  const p = PRESET_BY_ID[presetId];
  if (!p) return makeRange(DEFAULT_PRESET, { n, compare });
  const { from, to } = p.resolve(n);
  return { preset: presetId, from, to, n, compare };
}

// Rentang manual dari kalender / input tanggal.
export function makeCustomRange(from, to, { compare = false } = {}) {
  // Tukar kalau user memilih mundur (klik tanggal akhir lebih dulu) — lebih
  // ramah daripada menolak input.
  if (from && to && from > to) [from, to] = [to, from];
  return { preset: "custom", from, to, n: 30, compare };
}

// Label pembanding pertumbuhan ("vs kemarin", "vs 7 hari sebelumnya", dst) —
// SATU sumber kebenaran dipakai StatCard di Dashboard & semua tab Laporan.
//
// BUG YANG DIPERBAIKI (26 Agustus 2026): StatCard sebelumnya punya default
// hardcode `deltaSuffix = "vs last week"` (Inggris, DIAM SAJA salah kalau
// rentang yang dipilih bukan 7 hari — Dashboard defaultnya malah "Hari ini",
// jadi label itu SELALU salah sejak awal, bukan cuma di beberapa kasus).
// Backend (`buildPrevRange` di routes/analytics.js) SUDAH BENAR menghitung
// periode pembanding sepanjang rentang yang sama persis — cuma labelnya di
// frontend yang tidak pernah ikut menyesuaikan. Panjang dihitung LANGSUNG
// dari from/to (bukan dari nama preset), supaya benar juga untuk rentang
// custom & preset berbasis bulan (panjang harinya berubah-ubah).
export function compareLabel(range) {
  if (!range?.from || !range?.to) return null; // preset "Semua" — tidak ada pembanding
  const hari = toWIB(range.to).diff(toWIB(range.from), "day") + 1;
  if (hari <= 1) return range.preset === "today" ? "vs kemarin" : "vs hari sebelumnya";
  return `vs ${hari} hari sebelumnya`;
}

// Panjang rentang dalam hari (inklusif). null kalau tanpa batas.
export function rangeLengthDays(range) {
  if (!range?.from || !range?.to) return null;
  return dayjs(range.to).diff(dayjs(range.from), "day") + 1;
}

// Periode sebelumnya dengan PANJANG SAMA, tepat bersambung sebelum `from`.
// CERMIN dari buildPrevRange() di backend/src/routes/analytics.js — kalau
// definisi di sana berubah, ubah di sini juga supaya label UI tidak bohong.
export function previousPeriod(range) {
  const len = rangeLengthDays(range);
  if (!len) return null;
  const to = dayjs(range.from).subtract(1, "day");
  return { from: fmt(to.subtract(len - 1, "day")), to: fmt(to) };
}

// Geser rentang maju/mundur untuk tombol ‹ ›. dir: -1 mundur, +1 maju.
// Preset bulanan digeser PER BULAN (bukan per 30/31 hari) supaya "Bulan lalu"
// tetap jatuh di batas bulan yang benar.
export function stepRange(range, dir) {
  const p = PRESET_BY_ID[range?.preset];
  const mode = range?.preset === "custom" ? "range" : p?.step;
  if (!mode || !range?.from || !range?.to) return range; // "Semua" tidak bisa digeser

  if (mode === "month") {
    const b = dayjs(range.from).add(dir, "month");
    return makeCustomRange(fmt(b.startOf("month")), fmt(b.endOf("month")), { compare: range.compare });
  }
  const len = rangeLengthDays(range);
  const from = dayjs(range.from).add(dir * len, "day");
  return makeCustomRange(fmt(from), fmt(from.add(len - 1, "day")), { compare: range.compare });
}

// Bisa digeser? (dipakai untuk men-disable tombol ‹ ›)
export function canStep(range) {
  const p = PRESET_BY_ID[range?.preset];
  const mode = range?.preset === "custom" ? "range" : p?.step;
  return !!(mode && range?.from && range?.to);
}

// Label tanggal untuk tombol pemicu: "25 Jul 2026" kalau 1 hari,
// "1 – 30 Jun 2026" kalau masih 1 bulan, "28 Jun – 25 Jul 2026" kalau lintas bulan.
export function formatRangeText(range) {
  if (!range?.from || !range?.to) return "Semua waktu";
  if (range.from === range.to) return formatTanggal(range.from);
  const a = dayjs(range.from), b = dayjs(range.to);
  if (a.year() === b.year() && a.month() === b.month()) {
    return `${a.date()} – ${formatTanggal(range.to)}`;
  }
  return `${formatTanggalPendek(range.from)} – ${formatTanggal(range.to)}`;
}

// Nama preset untuk tombol pemicu. Preset berparameter menyisipkan N-nya.
export function presetLabel(range) {
  if (!range?.preset || range.preset === "custom") return "Kustom";
  const p = PRESET_BY_ID[range.preset];
  if (!p) return "Kustom";
  return p.parametrized ? `${range.n} ${p.label}` : p.label;
}

// ── KONTRAK KE API ────────────────────────────────────────────────────────
// HANYA from & to yang dikirim. `preset`/`n`/`compare` adalah state UI —
// jangan ikut jadi query param (backend akan mengabaikannya, tapi bikin URL
// dan cache key React Query kotor tanpa guna).
//
// CATATAN COMPARE: backend SUDAH otomatis menghitung periode sebelumnya untuk
// persentase pertumbuhan (buildPrevRange di /analytics/overview) — jadi toggle
// "Bandingkan" mengontrol TAMPILAN pembanding itu, bukan mengirim rentang
// kedua. Untuk membandingkan dua rentang SEMBARANG perlu perubahan backend
// (endpoint menerima compareFrom/compareTo); belum ada.
export function toApiParams(range) {
  if (!range?.from || !range?.to) return {};
  return { from: range.from, to: range.to };
}
