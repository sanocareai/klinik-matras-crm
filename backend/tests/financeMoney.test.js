// Aritmetika uang Finance — fungsi MURNI, tanpa database.
//
// Ini tes yang menjaga aturan 2 di kepala blok finance (schema.prisma):
// "nominal presisi desimal". Kalau file ini pecah, artinya ada jalan untuk
// menghasilkan jurnal yang selisih beberapa sen — kelas bug yang tidak
// pernah ketahuan sampai neraca tidak balance berbulan-bulan kemudian.

import test from "node:test";
import assert from "node:assert/strict";

import {
  toMoney, sumMoney, allocateProportional, formatRupiah, moneyToNumber,
  maxMoney, minMoney, eqMoney, MoneyError, Decimal,
} from "../src/services/finance/money.js";

test("toMoney: Int Rupiah dari tabel lama dikonversi eksak, tanpa kehilangan presisi", () => {
  // Order.value & Payment.amount bertipe Int — ini jalur konversi yang
  // dilewati SETIAP posting pembayaran & pengakuan pendapatan.
  assert.equal(toMoney(3500000).toFixed(2), "3500000.00");
  assert.equal(toMoney(0).toFixed(2), "0.00");
  assert.equal(toMoney("1234.5").toFixed(2), "1234.50");
  assert.equal(toMoney(new Decimal("99.999")).toFixed(2), "100.00"); // HALF_UP
});

test("toMoney: input rusak DITOLAK, tidak diam-diam jadi nol", () => {
  // Nol yang lahir dari input rusak menghasilkan jurnal yang "seimbang"
  // tapi salah total — persis yang tidak boleh terjadi.
  assert.throws(() => toMoney(undefined), MoneyError);
  assert.throws(() => toMoney(null), MoneyError);
  assert.throws(() => toMoney(""), MoneyError);
  assert.throws(() => toMoney("abc"), MoneyError);
  assert.throws(() => toMoney(NaN), MoneyError);
  assert.throws(() => toMoney(Infinity), MoneyError);
});

test("sumMoney: 0,1 + 0,2 TIDAK menghasilkan 0,30000000000000004", () => {
  // Alasan seluruh file money.js ada. Dengan Number, ekspresi ini gagal.
  assert.equal(sumMoney(["0.10", "0.20"]).toFixed(2), "0.30");
  assert.ok(eqMoney(sumMoney([0.1, 0.2]), "0.30"));
});

test("allocateProportional: pembagian 3 bagian TIDAK kehilangan satu sen pun", () => {
  // Kasus konkret dari komentar money.js: Rp 10.000.000 ke 3 order sama
  // besar. 3 x 3.333.333,33 = 9.999.999,99 — sisa 1 sen HARUS ditempel,
  // bukan hilang.
  const parts = allocateProportional("10000000", [1, 1, 1]);
  const total = parts.reduce((a, b) => a.plus(b), new Decimal(0));
  assert.equal(total.toFixed(2), "10000000.00", "total alokasi wajib PERSIS sama dengan nominal asli");
  assert.equal(parts.length, 3);
});

test("allocateProportional: sisa pembulatan jatuh ke bagian TERBESAR", () => {
  // Bukan ke yang pertama/terakhir — supaya kesalahan relatifnya paling
  // kecil, dan order kecil tidak terlihat kelebihan bayar gara-gara sen.
  const parts = allocateProportional("100", [1, 1, 98]);
  const total = parts.reduce((a, b) => a.plus(b), new Decimal(0));
  assert.equal(total.toFixed(2), "100.00");
  const nilai = parts.map((p) => p.toFixed(2));
  const terbesar = Math.max(...parts.map((p) => Number(p)));
  assert.equal(Number(nilai[2]), terbesar, "bagian terbesar yang menampung sisa");
});

test("allocateProportional: bobot tidak proporsional tetap berjumlah persis", () => {
  const parts = allocateProportional("7777777.77", [3, 5, 11, 2]);
  const total = parts.reduce((a, b) => a.plus(b), new Decimal(0));
  assert.equal(total.toFixed(2), "7777777.77");
});

test("allocateProportional: seluruh bobot nol DITOLAK, bukan dibagi rata diam-diam", () => {
  // Membagi rata di sini akan mengarang alokasi ke order yang nilainya nol
  // (order yang belum punya item — kasus NYATA, order lahir value: 0).
  assert.throws(() => allocateProportional("100", [0, 0]), MoneyError);
});

test("maxMoney/minMoney bekerja pada Decimal, bukan perbandingan string", () => {
  assert.equal(maxMoney("9", "10").toFixed(2), "10.00"); // "9" > "10" kalau string
  assert.equal(minMoney("9", "10").toFixed(2), "9.00");
});

test("formatRupiah: pemisah ribuan tidak pernah mencemari angka desimal", () => {
  // Bug nyata yang dijaga di sini: regex ribuan naif mengubah "1234.56"
  // jadi "1.234.56" — dua pemisah dengan arti berbeda dalam satu angka.
  assert.equal(formatRupiah(1234.56), "Rp 1.234,56");
  assert.equal(formatRupiah(1000000), "Rp 1.000.000,00");
  assert.equal(formatRupiah(-2500), "-Rp 2.500,00");
  assert.equal(formatRupiah(0), "Rp 0,00");
});

test("moneyToNumber: aman untuk respons JSON", () => {
  assert.equal(moneyToNumber(new Decimal("1234.56")), 1234.56);
  assert.equal(moneyToNumber(null), 0);
});
