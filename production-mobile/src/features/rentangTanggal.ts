// MODEL MURNI pemilih RENTANG TANGGAL (kalender WIB, diuji tanpa React). Tanggal selalu kunci "YYYY-MM-DD" — sama dengan
// parameter `dari`/`sampai` server (batas hari dihitung server dalam WIB) — jadi tidak ada konversi zona waktu di HP.
import { kunciTanggalWib, wib } from "@/lib/waktu";

export type Rentang = { dari: string; sampai: string };
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
export const HARI_PENDEK = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]; // minggu dimulai Senin

const p2 = (n: number) => String(n).padStart(2, "0");
export const kunci = (y: number, m: number, d: number) => `${y}-${p2(m + 1)}-${p2(d)}`; // m = 0..11
const pecah = (k: string) => { const [y, m, d] = k.split("-").map(Number); return { y: y!, m: m! - 1, d: d! }; };
/** Geser kunci tanggal sejumlah hari (aritmetika kalender UTC murni — tidak bergantung zona waktu HP). */
export function geserHari(k: string, n: number) {
  const { y, m, d } = pecah(k);
  const t = new Date(Date.UTC(y, m, d + n));
  return kunci(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}

/** Sel kalender satu bulan (minggu dimulai Senin). null = sel kosong sebelum tanggal 1 / setelah tanggal terakhir. */
export function selBulan(y: number, m: number): (string | null)[] {
  const hariPertama = new Date(Date.UTC(y, m, 1)).getUTCDay(); // 0 = Minggu
  const kosong = (hariPertama + 6) % 7;
  const jumlah = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const sel: (string | null)[] = [...Array(kosong).fill(null), ...Array.from({ length: jumlah }, (_, i) => kunci(y, m, i + 1))];
  while (sel.length % 7) sel.push(null);
  return sel;
}
export function geserBulan(y: number, m: number, n: number) {
  const t = new Date(Date.UTC(y, m + n, 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() };
}

/**
 * Ketukan pada kalender: ketukan pertama = tanggal awal; ketukan kedua = tanggal akhir (bila lebih awal dari awal, keduanya ditukar);
 * ketukan ketiga memulai rentang baru. `akhir` null = baru memilih tanggal awal.
 */
export function ketuk(pilih: { awal: string | null; akhir: string | null }, k: string) {
  if (!pilih.awal || pilih.akhir) return { awal: k, akhir: null };
  return k < pilih.awal ? { awal: k, akhir: pilih.awal } : { awal: pilih.awal, akhir: k };
}
export const dalamRentang = (k: string, awal: string | null, akhir: string | null) => !!awal && !!akhir && k >= awal && k <= akhir;

/** Pintasan rentang (berakhir hari ini, WIB). */
export function pintasan(sekarang = new Date()) {
  const hariIni = kunciTanggalWib(sekarang);
  const w = wib(sekarang);
  return [
    { key: "7", label: "7 hari", r: { dari: geserHari(hariIni, -6), sampai: hariIni } },
    { key: "30", label: "30 hari", r: { dari: geserHari(hariIni, -29), sampai: hariIni } },
    { key: "90", label: "90 hari", r: { dari: geserHari(hariIni, -89), sampai: hariIni } },
    { key: "tahun", label: "Tahun ini", r: { dari: `${w.y}-01-01`, sampai: hariIni } },
  ];
}

/** "3 Nov – 14 Nov 2026" · "28 Des 2025 – 4 Jan 2026" · "14 Nov 2026" (satu hari). */
export function labelRentang(r: Rentang) {
  const a = pecah(r.dari); const b = pecah(r.sampai);
  if (r.dari === r.sampai) return `${a.d} ${BULAN[a.m]} ${a.y}`;
  return a.y === b.y ? `${a.d} ${BULAN[a.m]} – ${b.d} ${BULAN[b.m]} ${b.y}` : `${a.d} ${BULAN[a.m]} ${a.y} – ${b.d} ${BULAN[b.m]} ${b.y}`;
}
export const jumlahHari = (r: Rentang) => Math.round((Date.UTC(pecah(r.sampai).y, pecah(r.sampai).m, pecah(r.sampai).d) - Date.UTC(pecah(r.dari).y, pecah(r.dari).m, pecah(r.dari).d)) / 86400_000) + 1;
