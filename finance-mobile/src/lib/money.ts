// UANG DI KLIEN = STRING DESIMAL. TIDAK ADA ARITMETIKA FLOAT.
//
// Server (Decimal(18,2)) adalah satu-satunya yang menghitung uang. Klien hanya:
//   • menerima nilai sebagai string desimal ("1234567.89"),
//   • memformat untuk tampilan, dan
//   • mengirim string desimal kembali saat membuat perintah.
// Fungsi di file ini hanya memanipulasi TEKS (dan BigInt untuk pembulatan/
// singkatan TAMPILAN). Tidak ada penjumlahan/pengurangan antar nilai uang —
// total resmi selalu datang dari server.

export type Money = string & { readonly __brand: "Money" };

const POLA = /^-?\d+(\.\d+)?$/;

export function isMoneyString(v: unknown): v is string {
  return typeof v === "string" && POLA.test(v);
}

/** Validasi & normalkan string desimal (minimal 2 desimal). Melempar bila bukan angka desimal. */
export function toMoney(v: string): Money {
  const s = v.trim();
  if (!POLA.test(s)) throw new Error(`Bukan nominal uang yang sah: "${v}"`);
  return normalisasi(s) as Money;
}

/** Kembalikan Money atau null (tanpa melempar) — untuk input pengguna. */
export function toMoneyOrNull(v: string | null | undefined): Money | null {
  if (v == null) return null;
  const s = v.trim();
  return POLA.test(s) ? (normalisasi(s) as Money) : null;
}

function normalisasi(s: string): string {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [whole = "0", frac = ""] = body.split(".");
  const w = whole.replace(/^0+(?=\d)/, "");
  const f = frac.length >= 2 ? frac : frac.padEnd(2, "0");
  const nolSemua = /^0+$/.test(w) && /^0+$/.test(f);
  return `${neg && !nolSemua ? "-" : ""}${w}.${f}`;
}

export function isNegative(m: Money | string): boolean {
  return m.startsWith("-") && !/^-0+(\.0+)?$/.test(m);
}

export function isZero(m: Money | string): boolean {
  return /^-?0+(\.0+)?$/.test(m);
}

/** Pisahkan bagian tampilan: { negatif, utuh:"8.200.000", pecahan:"28" } (pecahan "" bila 00). */
export function splitRupiah(m: Money | string): { negatif: boolean; utuh: string; pecahan: string } {
  const n = normalisasi(String(m));
  const negatif = n.startsWith("-");
  const [w = "0", f = "00"] = (negatif ? n.slice(1) : n).split(".");
  const pecahan = f.slice(0, 2);
  return { negatif, utuh: kelompokRibuan(w), pecahan: pecahan === "00" ? "" : pecahan };
}

function kelompokRibuan(digit: string): string {
  return digit.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** "Rp 8.200.000" atau "Rp 8.200.000,28" (desimal hanya bila ada). Negatif: "-Rp 1.500.000". */
export function formatRupiah(m: Money | string, opsi: { simbol?: boolean; selaluDesimal?: boolean } = {}): string {
  const { simbol = true, selaluDesimal = false } = opsi;
  const { negatif, utuh, pecahan } = splitRupiah(m);
  const desimal = selaluDesimal ? (pecahan || "00") : pecahan;
  const isi = `${utuh}${desimal ? `,${desimal}` : ""}`;
  return `${negatif ? "-" : ""}${simbol ? "Rp " : ""}${isi}`;
}

const SATUAN: [bigint, string][] = [
  [1_000_000_000_000n, "T"],
  [1_000_000_000n, "M"],
  [1_000_000n, "jt"],
  [1_000n, "rb"],
];

/** Singkatan HANYA UNTUK TAMPILAN ruang sempit: "Rp 824,5 jt", "Rp 1,3 M". Pembulatan setengah-naik. */
export function formatRupiahRingkas(m: Money | string): string {
  const n = normalisasi(String(m));
  const negatif = n.startsWith("-");
  const utuh = BigInt((negatif ? n.slice(1) : n).split(".")[0] ?? "0");
  const tanda = negatif ? "-" : "";
  for (const [batas, label] of SATUAN) {
    if (utuh >= batas) {
      const persepuluh = (utuh * 10n + batas / 2n) / batas; // satu desimal, half-up
      const bulat = persepuluh / 10n;
      const sisa = persepuluh % 10n;
      return `${tanda}Rp ${bulat.toString()}${sisa === 0n ? "" : `,${sisa.toString()}`} ${label}`;
    }
  }
  return `${tanda}Rp ${kelompokRibuan(utuh.toString())}`;
}

/**
 * Baca isian pengguna format Indonesia menjadi string desimal.
 *   "150.000" → "150000.00" · "150.000,50" → "150000.50" · "1500000" → "1500000.00"
 * Titik dianggap pemisah ribuan bila diikuti tepat 3 digit; koma = desimal. Kosong/tak sah → null.
 */
export function parseInputRupiah(teks: string): Money | null {
  let s = teks.replace(/[Rr][Pp]\.?/g, "").replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    const idx = s.lastIndexOf(",");
    const kiri = s.slice(0, idx).replace(/\./g, "");
    const kanan = s.slice(idx + 1);
    if (!/^\d{1,2}$/.test(kanan) || !/^\d+$/.test(kiri)) return null;
    return toMoneyOrNull(`${kiri}.${kanan}`);
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+$/.test(s)) return null;
  return toMoneyOrNull(s);
}

function utuhBig(m: Money | string): bigint {
  const n = normalisasi(String(m));
  return BigInt((n.startsWith("-") ? n.slice(1) : n).split(".")[0] ?? "0");
}

/**
 * Rasio 0..1 untuk GEOMETRI chart (tinggi batang, sudut donat): bagian ÷ maksimum.
 * Hanya tampilan — dihitung dengan BigInt pada bagian bulat rupiah (bukan float uang).
 * Nilai ≤ 0 dianggap 0.
 */
export function rasio(bagian: Money | string, maks: Money | string): number {
  const p = isNegative(bagian) ? 0n : utuhBig(bagian);
  const q = isNegative(maks) ? 0n : utuhBig(maks);
  if (q === 0n || p === 0n) return 0;
  const permil = (p * 1000n) / q;
  return Math.min(1, Number(permil) / 1000);
}

/** Nilai terbesar dari daftar (perbandingan, bukan aritmetika) — untuk skala chart. */
export function terbesar(daftar: (Money | string)[]): Money {
  let maks = "0.00";
  for (const v of daftar) {
    const a = normalisasi(String(v));
    if (isNegative(a)) continue;
    const [aw = "0", af = "00"] = a.split(".");
    const [mw = "0", mf = "00"] = maks.split(".");
    const lebih = BigInt(aw) > BigInt(mw) || (BigInt(aw) === BigInt(mw) && af.padEnd(2, "0") > mf.padEnd(2, "0"));
    if (lebih) maks = a;
  }
  return maks as Money;
}
