// Aritmetika uang untuk seluruh blok Finance — SATU tempat, tidak ada
// perhitungan uang di route/komponen lain yang memakai `number` mentah.
//
// KENAPA FILE INI ADA. Sisa sistem memakai Int Rupiah (Order.value,
// Payment.amount) dan itu TIDAK DIUBAH — untuk nominal yang DIKETIK manusia,
// Int rupiah memang tepat (tidak ada sen di Rupiah). Yang butuh desimal
// adalah nominal HASIL HITUNGAN: alokasi pembayaran proporsional, HPP
// rata-rata tertimbang, pembagian biaya per unit. Contoh nyata yang bikin
// jurnal tidak seimbang kalau dikerjakan dengan Number:
//
//   Pembayaran Rp 10.000.000 dialokasikan ke 3 order senilai
//   Rp 3.333.333,33 masing-masing → 3 × 3.333.333,33 = 9.999.999,99,
//   selisih 1 sen yang membuat total debit ≠ total kredit. Dengan Number
//   (floating point biner) selisihnya bahkan tidak deterministik.
//
// Prisma.Decimal (decimal.js) sudah ikut @prisma/client — tidak ada
// dependency baru. Presisi DB Decimal(18,2), jadi SEMUA nilai yang masuk
// jurnal WAJIB lewat toMoney() di bawah supaya dibulatkan SEKALI di tepi,
// bukan dibulatkan diam-diam oleh Postgres saat insert (pembulatan diam-diam
// itulah yang menghasilkan jurnal timpang yang mustahil dilacak nanti).

import pkg from "@prisma/client";

const { Prisma } = pkg;
export const Decimal = Prisma.Decimal;

export const ZERO = new Decimal(0);

// 2 angka di belakang koma, pembulatan HALF_UP (kebiasaan akuntansi
// Indonesia: 0,5 naik). ROUND_HALF_EVEN ("banker's rounding") sengaja TIDAK
// dipakai — hasilnya benar secara statistik tapi tidak cocok dengan cara
// akuntan di sini merekonsiliasi angka dengan kalkulator.
export const MONEY_DP = 2;
const ROUND_HALF_UP = 4; // Decimal.ROUND_HALF_UP

/**
 * Ubah apa pun (Int Rupiah dari tabel lama, string dari body request,
 * Decimal dari Prisma) jadi Decimal 2 desimal.
 *
 * MENOLAK nilai yang tidak masuk akal sebagai uang (NaN/Infinity/null) —
 * bukan diam-diam jadi 0. Nol yang muncul dari input rusak adalah cara
 * tercepat menghasilkan jurnal yang "seimbang" tapi salah total.
 */
export function toMoney(value, { field = "nominal" } = {}) {
  if (value === null || value === undefined || value === "") {
    throw new MoneyError(`${field} wajib diisi`);
  }
  let d;
  try {
    d = new Decimal(value);
  } catch {
    throw new MoneyError(`${field} bukan angka yang sah: ${String(value)}`);
  }
  if (!d.isFinite()) throw new MoneyError(`${field} bukan angka yang sah`);
  return d.toDecimalPlaces(MONEY_DP, ROUND_HALF_UP);
}

export class MoneyError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "MoneyError";
    this.statusCode = statusCode;
  }
}

export function sumMoney(values) {
  return values.reduce((acc, v) => acc.plus(toMoney(v)), ZERO).toDecimalPlaces(MONEY_DP, ROUND_HALF_UP);
}

export function isZero(value) {
  return toMoney(value).isZero();
}

/** Perbandingan nominal — SELALU lewat sini, jangan pernah `a === b` pada Decimal. */
export function eqMoney(a, b) {
  return toMoney(a).equals(toMoney(b));
}

export function maxMoney(a, b) {
  const da = toMoney(a);
  const db = toMoney(b);
  return da.greaterThan(db) ? da : db;
}

export function minMoney(a, b) {
  const da = toMoney(a);
  const db = toMoney(b);
  return da.lessThan(db) ? da : db;
}

/**
 * Bagi `total` ke `weights` secara proporsional TANPA kehilangan satu sen pun.
 *
 * Sisa pembulatan (total − Σ bagian) ditempelkan ke bagian TERBESAR, bukan
 * ke yang pertama/terakhir: menempelkan ke yang terbesar membuat kesalahan
 * relatifnya paling kecil, dan untuk alokasi pembayaran ke beberapa order
 * itu berarti selisih 1 sen jatuh ke order yang memang paling besar
 * tagihannya — bukan membuat order kecil terlihat kelebihan/kurang bayar.
 *
 * Return array Decimal dengan panjang sama dengan `weights`, dijamin
 * Σ hasil === total PERSIS.
 */
export function allocateProportional(total, weights) {
  const t = toMoney(total);
  const w = weights.map((x) => toMoney(x));
  const totalWeight = w.reduce((a, b) => a.plus(b), ZERO);

  if (totalWeight.isZero()) {
    throw new MoneyError("Tidak bisa mengalokasikan: seluruh bobot bernilai nol");
  }

  const parts = w.map((x) => t.times(x).dividedBy(totalWeight).toDecimalPlaces(MONEY_DP, ROUND_HALF_UP));
  const assigned = parts.reduce((a, b) => a.plus(b), ZERO);
  const remainder = t.minus(assigned);

  if (!remainder.isZero()) {
    let biggest = 0;
    for (let i = 1; i < parts.length; i++) {
      if (parts[i].greaterThan(parts[biggest])) biggest = i;
    }
    parts[biggest] = parts[biggest].plus(remainder);
  }
  return parts;
}

/**
 * Format Rupiah untuk pesan error/log backend (UI punya formatternya sendiri).
 * Bagian desimal DIPISAH DULU sebelum pemisah ribuan disisipkan — tanpa itu,
 * regex ribuan ikut memotong angka di belakang koma ("1234.56" menjadi
 * "1.234.56", dua pemisah dengan arti berbeda dalam satu angka).
 */
export function formatRupiah(value) {
  const [utuh, pecahan] = toMoney(value).toFixed(MONEY_DP).split(".");
  const negatif = utuh.startsWith("-");
  const digit = negatif ? utuh.slice(1) : utuh;
  const ribuan = digit.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negatif ? "-" : ""}Rp ${ribuan},${pecahan}`;
}

/** Decimal → number untuk respons JSON. Aman: Decimal(18,2) < 2^53 sen. */
export function moneyToNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(toMoney(value).toFixed(MONEY_DP));
}
