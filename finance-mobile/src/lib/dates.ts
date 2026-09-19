// TANGGAL — UTC di dalam, WIB di tepi (CLAUDE.md §11). Zona perangkat TIDAK dipakai.
// Offset WIB dipatok +07:00 (Indonesia tidak memakai DST).

const WIB_MS = 7 * 3600 * 1000;
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const BULAN_PENUH = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

const p2 = (n: number) => String(n).padStart(2, "0");

/** Bagian tanggal WIB dari instant (ISO UTC atau Date). */
export function wibParts(instant: string | Date): { y: number; m: number; d: number; hh: number; mm: number; dow: number } {
  const t = (instant instanceof Date ? instant.getTime() : new Date(instant).getTime()) + WIB_MS;
  const dt = new Date(t);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), hh: dt.getUTCHours(), mm: dt.getUTCMinutes(), dow: dt.getUTCDay() };
}

/** "YYYY-MM-DD" hari ini menurut WIB. */
export function hariIniWIB(now: Date = new Date()): string {
  const { y, m, d } = wibParts(now);
  return `${y}-${p2(m)}-${p2(d)}`;
}

/** Tanggal dokumen "YYYY-MM-DD" (atau ISO) → "19 Sep 2026". Tanggal polos tidak digeser zona. */
export function tanggalPendek(v: string | null | undefined): string {
  if (!v) return "—";
  const polos = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (polos) return `${Number(polos[3])} ${BULAN[Number(polos[2]) - 1] ?? ""} ${polos[1]}`;
  const { y, m, d } = wibParts(v);
  return `${d} ${BULAN[m - 1] ?? ""} ${y}`;
}

/** "Sabtu, 19 September 2026". */
export function tanggalPanjang(v: string | Date): string {
  const s = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00+07:00` : v;
  const { y, m, d, dow } = wibParts(s);
  return `${HARI[dow] ?? ""}, ${d} ${BULAN_PENUH[m - 1] ?? ""} ${y}`;
}

/** "19 Sep 2026 · 14.05 WIB" dari instant ISO. */
export function waktuLengkap(iso: string): string {
  const { y, m, d, hh, mm } = wibParts(iso);
  return `${d} ${BULAN[m - 1] ?? ""} ${y} · ${p2(hh)}.${p2(mm)} WIB`;
}

/** "14.05" dari instant ISO (WIB). */
export function jam(iso: string): string {
  const { hh, mm } = wibParts(iso);
  return `${p2(hh)}.${p2(mm)}`;
}

/** Rentang bulan berjalan menurut WIB: { from:"2026-09-01", to:"2026-09-30" }. */
export function periodeBulanIni(now: Date = new Date()): { from: string; to: string } {
  const { y, m } = wibParts(now);
  const akhir = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${p2(m)}-01`, to: `${y}-${p2(m)}-${p2(akhir)}` };
}

export function labelBulan(from: string): string {
  const [y, m] = from.split("-");
  return `${BULAN_PENUH[Number(m) - 1] ?? ""} ${y}`;
}

/** Sapaan menurut jam WIB. */
export function sapaan(now: Date = new Date()): string {
  const { hh } = wibParts(now);
  if (hh < 11) return "Selamat pagi";
  if (hh < 15) return "Selamat siang";
  if (hh < 18) return "Selamat sore";
  return "Selamat malam";
}

/** "5 menit lalu", "2 jam lalu", "3 hari lalu" — untuk tampilan relatif. */
export function waktuRelatif(iso: string, now: Date = new Date()): string {
  const selisih = Math.max(0, now.getTime() - new Date(iso).getTime());
  const menit = Math.floor(selisih / 60000);
  if (menit < 1) return "baru saja";
  if (menit < 60) return `${menit} menit lalu`;
  const jamN = Math.floor(menit / 60);
  if (jamN < 24) return `${jamN} jam lalu`;
  return `${Math.floor(jamN / 24)} hari lalu`;
}

/** "2026-04" atau "2026-04-15" → "Apr". */
export function bulanSingkat(yyyyMm: string): string {
  const m = Number(yyyyMm.split("-")[1]);
  return BULAN[m - 1] ?? "";
}
