// Pemasukan: kontrak "dihitung ke total" (audit selisih laporan Okt 2026, bagian G). Logika murni — klien TIDAK menghitung total, hanya menata angka server.
// Data di sini sintetis (bentuk respons server), bukan data produksi; angka snapshot hanya sebagai pembanding, tidak ditanam di kode aplikasi.
import test from "node:test";
import assert from "node:assert/strict";
import { adaKontrakHitung, cakupanTotal, keadaanHasil, susunAlasan, teksRp, teksTidakDihitung, tidakDihitung } from "../src/features/finance/pemasukan/pemasukanLogic.js";

const respons = (total, tidak, nilaiTidak = "0.00") => ({ total, totalNilai: "431443000.00", totalTidakDihitung: { jumlah: tidak, nilai: nilaiTidak } });

test("keadaanHasil: kosong, penuh, sebagian, semua, dan server lama tanpa kontrak", () => {
  assert.equal(keadaanHasil(null), null);
  assert.equal(keadaanHasil(respons(0, 0)), "kosong");
  assert.equal(keadaanHasil(respons(185, 0)), "penuh");
  assert.equal(keadaanHasil(respons(187, 2, "3505501.00")), "sebagian");
  assert.equal(keadaanHasil(respons(3, 3, "9.00")), "semua");
  assert.equal(keadaanHasil({ total: 10, totalNilai: "1.00" }), "lama", "tanpa totalTidakDihitung → jangan mengklaim 'dihitung'");
  assert.equal(adaKontrakHitung({ total: 1 }), false);
  assert.equal(adaKontrakHitung(respons(1, 0)), true);
});

test("teksTidakDihitung: ringkas jumlah + nilai tepat (tanpa float), null bila tak ada pengecualian", () => {
  assert.equal(teksTidakDihitung({ jumlah: 2, nilai: "3505501.00" }), "2 baris tidak dihitung · Rp3.505.501");
  assert.equal(teksTidakDihitung({ jumlah: 1, nilai: "1.00" }), "1 baris tidak dihitung · Rp1");
  assert.equal(teksTidakDihitung({ jumlah: 0, nilai: "0.00" }), null);
  assert.equal(teksTidakDihitung(undefined), null);
  assert.equal(teksTidakDihitung({ jumlah: 1200, nilai: "12345678901234567890.55" }), "1.200 baris tidak dihitung · Rp12.345.678.901.234.567.890,55");
});

test("tidakDihitung: hanya dihitung=false yang tegas (data lama tanpa field dianggap dihitung)", () => {
  assert.equal(tidakDihitung({ dihitung: false }), true);
  assert.equal(tidakDihitung({ dihitung: true }), false);
  assert.equal(tidakDihitung({}), false);
  assert.equal(tidakDihitung(null), false);
});

test("cakupanTotal: label total mengikuti jenis data dan status — bukan 'terverifikasi' untuk semua", () => {
  assert.match(cakupanTotal("PEMBAYARAN", ""), /termasuk pembayaran yang menunggu verifikasi/);
  assert.match(cakupanTotal("PEMBAYARAN", "TERVERIFIKASI"), /hanya pembayaran terverifikasi/);
  assert.match(cakupanTotal("PEMBAYARAN", "MENUNGGU"), /menunggu verifikasi/);
  assert.match(cakupanTotal("PEMBAYARAN", "DITOLAK"), /tidak dihitung/);
  assert.match(cakupanTotal("PENDAPATAN", ""), /pendapatan diakui/);
  assert.match(cakupanTotal("HISTORIS", ""), /arsip/);
  assert.equal(cakupanTotal("TIDAK_DIKENAL", ""), null);
});

test("susunAlasan: null bila dihitung; nominal asli tidak diganti nol; alasan batal tidak digandakan; pengganti terstruktur", () => {
  assert.equal(susunAlasan({ dihitung: true, nilai: "100.00" }), null);
  const b = {
    dihitung: false, nilai: "3505500.00", nilaiDihitung: "0.00", alasanBatal: "Dikoreksi — salah tanggal",
    alasanTidakDihitung: "Pembayaran dibatalkan — uang tidak dianggap diterima (Dikoreksi — salah tanggal). Sudah digantikan pembayaran pay-000 …",
    pengganti: { id: "pay-000-lengkap", tanggal: "2026-10-31", nominal: "3505500.00", terverifikasi: true, kecocokan: "NOMINAL_SAMA", semua: [{ id: "pay-000-lengkap", tanggal: "2026-10-31", nominal: "3505500.00", terverifikasi: true }] },
  };
  const a = susunAlasan(b);
  assert.equal(a.nilaiAsli, "3505500.00");
  assert.equal(a.nilaiDihitung, "0.00");
  assert.equal(a.alasanBatal, null, "alasan batal sudah ada di teks server → tidak ditulis dua kali");
  assert.equal(a.pengganti.kecocokan, "Nominal sama");
  assert.equal(a.pengganti.daftar[0].id, "pay-000-");
  assert.equal(a.pengganti.daftar[0].status, "Terverifikasi");
  // alasan batal yang BELUM tercakup di teks server tampil terpisah
  assert.equal(susunAlasan({ ...b, alasanTidakDihitung: "Pembayaran ditolak Finance", alasanBatal: "Nominal salah input" }).alasanBatal, "Nominal salah input");
  // server tidak mengirim alasan → jangan mengarang
  assert.match(susunAlasan({ dihitung: false, nilai: "1.00" }).teks, /belum dikirim server/i);
  // pengganti ORDER_SAMA + belum terverifikasi
  const o = susunAlasan({ dihitung: false, nilai: "1.00", alasanTidakDihitung: "x", pengganti: { id: "abcdefghij", kecocokan: "ORDER_SAMA", semua: [{ id: "abcdefghij", tanggal: "2026-10-30", nominal: "1250000.00", terverifikasi: false }] } });
  assert.equal(o.pengganti.kecocokan, "Order sama, nominal berbeda");
  assert.equal(o.pengganti.daftar[0].status, "Menunggu verifikasi");
});

test("teksRp tetap tepat untuk nilai kasus pembanding (string desimal, tanpa float)", () => {
  assert.equal(teksRp("431443000.00"), "Rp431.443.000");
  assert.equal(teksRp("434948501.00"), "Rp434.948.501");
  assert.equal(teksRp("3505501.00"), "Rp3.505.501");
  assert.equal(teksRp("0.00"), "Rp0");
  assert.equal(teksRp(null), "—");
});
