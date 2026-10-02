// Klasifikasi Pemasukan Terpadu untuk jurnal Penjualan Karyawan (modul manual): pendapatan = Pemasukan Lain · Penjualan karyawan (terpisah dari omzet order);
// pelunasan tunai/transfer = penyelesaian piutang (DIKECUALIKAN, bukan pendapatan baru dan BUKAN "Perlu Ditinjau"); potong gaji tanpa kas tidak muncul.
import test from "node:test";
import assert from "node:assert/strict";
import { klasifikasiJurnal } from "../src/services/finance/pemasukan.js";

const akun = (code, type, systemKey = null) => ({ code, type, systemKey });
const baris = (debit, credit, a, cash = null) => ({ debit, credit, cashAccountId: cash, orderId: null, cashAccount: cash ? { name: "BCA" } : null, customer: null, account: a });
const PIUTANG_KARYAWAN = akun("1-1350", "ASET", "PIUTANG_KARYAWAN");
const PENDAPATAN_PK = akun("4-1250", "PENDAPATAN", "PENDAPATAN_PENJUALAN_KARYAWAN");

test("Penjualan dicatat: kelas LAIN sub PENJUALAN_KARYAWAN, nilai = pendapatan; BUKAN kelas PENDAPATAN order", () => {
  const e = { source: "PENJUALAN_KARYAWAN", reversalOf: null, lines: [baris(1_600_000, 0, PIUTANG_KARYAWAN), baris(0, 1_600_000, PENDAPATAN_PK)] };
  const hasil = klasifikasiJurnal(e);
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].kategori, "LAIN");
  assert.equal(hasil[0].sub, "PENJUALAN_KARYAWAN");
  assert.equal(Number(hasil[0].nilai), 1_600_000);
});

test("Pembatalan penjualan (jurnal balik) mengurangi kelas yang sama, tidak jadi DITINJAU", () => {
  const e = { source: "REVERSAL", reversalOf: { source: "PENJUALAN_KARYAWAN" }, lines: [baris(0, 1_600_000, PIUTANG_KARYAWAN), baris(1_600_000, 0, PENDAPATAN_PK)] };
  const hasil = klasifikasiJurnal(e);
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].kategori, "LAIN");
  assert.equal(hasil[0].sub, "PENJUALAN_KARYAWAN");
  assert.equal(Number(hasil[0].nilai), -1_600_000);
});

test("Pelunasan tunai/transfer: DIKECUALIKAN (penyelesaian piutang), tidak dihitung sebagai pemasukan dan tidak 'Perlu Ditinjau'", () => {
  const e = { source: "PEMBAYARAN_PENJUALAN_KARYAWAN", reversalOf: null, lines: [baris(600_000, 0, akun("1-1200", "ASET", "BANK"), "c1"), baris(0, 600_000, PIUTANG_KARYAWAN)] };
  const hasil = klasifikasiJurnal(e);
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].kategori, "DIKECUALIKAN");
  assert.equal(hasil[0].sub, "PELUNASAN_PIUTANG_KARYAWAN");
  assert.ok(!hasil.some((h) => h.kategori === "DITINJAU"));
});

test("Pelunasan potong gaji (tanpa kas) dan pelunasan sebelum cutoff (Laba Ditahan, tanpa kas) tidak menghasilkan baris pemasukan", () => {
  const potong = { source: "PEMBAYARAN_PENJUALAN_KARYAWAN", reversalOf: null, lines: [baris(500_000, 0, akun("6-1100", "BEBAN")), baris(0, 500_000, PIUTANG_KARYAWAN)] };
  const pra = { source: "PEMBAYARAN_PENJUALAN_KARYAWAN", reversalOf: null, lines: [baris(2_350_000, 0, akun("3-3100", "EKUITAS", "LABA_DITAHAN")), baris(0, 2_350_000, PIUTANG_KARYAWAN)] };
  assert.deepEqual(klasifikasiJurnal(potong), []);
  assert.deepEqual(klasifikasiJurnal(pra), []);
});

test("Pendapatan non-order dari sumber lain tetap DITINJAU (pagar lama tidak melonggar)", () => {
  const e = { source: "MANUAL", reversalOf: null, lines: [baris(100, 0, akun("1-1200", "ASET"), "c1"), baris(0, 100, PENDAPATAN_PK)] };
  assert.ok(klasifikasiJurnal(e).some((h) => h.kategori === "DITINJAU"));
});
