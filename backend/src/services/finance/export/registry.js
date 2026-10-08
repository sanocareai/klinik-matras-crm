// REGISTRI MODUL EXPORT EXCEL FINANCE (B3.9). Satu berkas per modul di folder ini; tiap modul mengekspor:
//   { kunci, nama, izin: [PERMISSIONS...], ambil: async (db, ctx) => data }   (bentuk `data`: lihat export/excel.js)
// `izin` = izin MINIMAL sama dengan endpoint daftar di layar (pengguna yang tidak boleh melihat data di layar tidak boleh mengekspornya).
// ctx = { user, periode:{from,to}|{}, filter:{}, ids:string[]|null, filterLabel, bolehSensitif }
//   filter : parameter yang SAMA dengan yang dikirim layar ke endpoint daftarnya (modul yang difilter di server).
//   ids    : id baris yang tampil di layar setelah filter sisi-klien (modul yang difilter di klien); server memuat ulang baris itu
//            lewat fungsi baca yang sama dengan layar — jadi angka, izin, dan urutan tidak bisa berbeda dari tampilan.
//
// Menambah modul: buat berkas modul, daftarkan di sini, dan (tes tata-kelola) tests/financeExport.test.js memastikan semua modul
// punya izin + fungsi ambil dan tidak ada berkas modul yang lupa didaftarkan.

import kasbon from "./kasbon.js";
import pemasukan from "./pemasukan.js";
import pembayaran from "./pembayaran.js";
import pengeluaran from "./pengeluaran.js";
import pembelian from "./pembelian.js";
import uangMuka from "./uang-muka.js";
import piutangRefund from "./piutang-refund.js";
import supplierUtang from "./supplier-utang.js";
import rekonsiliasi from "./rekonsiliasi.js";
import jurnalUmum from "./jurnal-umum.js";
import bukuBesar from "./buku-besar.js";
import rekonSalesFinance from "./rekon-sales-finance.js";
import mutasiRekening from "./mutasi-rekening.js";
import mutasiBank from "./mutasi-bank.js";
import pencocokanBank from "./pencocokan-bank.js";
import rekonsiliasiRekening from "./rekonsiliasi-rekening.js";
import biayaBahan from "./biaya-bahan.js";

export const MODUL_EXPORT = Object.freeze(
  Object.fromEntries([kasbon, pemasukan, pembayaran, pengeluaran, pembelian, uangMuka, piutangRefund, supplierUtang, rekonsiliasi, jurnalUmum, bukuBesar, rekonSalesFinance, mutasiRekening, mutasiBank, pencocokanBank, rekonsiliasiRekening, biayaBahan].map((m) => [m.kunci, m])),
);
