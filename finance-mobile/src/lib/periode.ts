import { wibParts } from "./dates";

// PERIODE LAPORAN — semua menurut kalender WIB (bukan zona perangkat). Server menerima ?from=YYYY-MM-DD&to=YYYY-MM-DD
// (tanggal polos, kedua ujung inklusif).

/** `judul` = nama pilihan cepat ("Bulan ini"); `label` = periode sebenarnya ("September 2026"). */
export type Periode = { id: string; label: string; from: string; to: string; judul?: string };

const BULAN_PENUH = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const p2 = (n: number) => String(n).padStart(2, "0");
const akhirBulan = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const PERIODE_DEFAULT = "bulan-ini";

export function periodeBulan(y: number, m: number): Periode {
  return { id: `bulan:${y}-${p2(m)}`, label: `${BULAN_PENUH[m - 1] ?? ""} ${y}`, from: `${y}-${p2(m)}-01`, to: `${y}-${p2(m)}-${p2(akhirBulan(y, m))}` };
}

function geser(y: number, m: number, selisih: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + selisih;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** Pilihan cepat: Bulan ini, Bulan lalu, Kuartal ini, Tahun ini. */
export function periodePreset(now: Date = new Date()): Periode[] {
  const { y, m } = wibParts(now);
  const lalu = geser(y, m, -1);
  const q = Math.floor((m - 1) / 3);
  const qAwal = q * 3 + 1;
  const qAkhir = qAwal + 2;
  return [
    { ...periodeBulan(y, m), id: "bulan-ini", judul: "Bulan ini" },
    { ...periodeBulan(lalu.y, lalu.m), id: "bulan-lalu", judul: "Bulan lalu" },
    { id: "kuartal-ini", label: `Kuartal ${q + 1} ${y}`, from: `${y}-${p2(qAwal)}-01`, to: `${y}-${p2(qAkhir)}-${p2(akhirBulan(y, qAkhir))}` },
    { id: "tahun-ini", label: `Tahun ${y}`, from: `${y}-01-01`, to: `${y}-12-31` },
  ];
}

/** Bulan tertentu ke belakang (terbaru dulu), untuk pemilih bulan. */
export function daftarBulan(now: Date = new Date(), jumlah = 12): Periode[] {
  const { y, m } = wibParts(now);
  return Array.from({ length: jumlah }, (_, i) => {
    const g = geser(y, m, -i);
    return periodeBulan(g.y, g.m);
  });
}

/** Id tersimpan → periode konkret. Id tak dikenal jatuh ke "Bulan ini". */
export function periodeDariId(id: string, now: Date = new Date()): Periode {
  const preset = periodePreset(now).find((p) => p.id === id);
  if (preset) return preset;
  const cocok = /^bulan:(\d{4})-(\d{2})$/.exec(id);
  if (cocok) {
    const y = Number(cocok[1]);
    const m = Number(cocok[2]);
    if (m >= 1 && m <= 12) return periodeBulan(y, m);
  }
  return periodePreset(now)[0] as Periode;
}
