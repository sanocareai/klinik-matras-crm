// Koreksi Saldo per bahan (Stok & Lokasi): logika murni — pembacaan jumlah fisik, tiga "nol" yang berbeda, harga daftar jujur (bukan Rp0), anti klik ganda per niat.
import test from "node:test";
import assert from "node:assert/strict";
import { bacaJumlah, periksaAlasan, tampilSaldoKeadaan, tampilHargaDaftar, niatKoreksi, fmt, tanda, teksSaldoSebelum } from "../src/features/warehouse/stok/koreksiSaldoLogic.js";
import { tampilSaldo } from "../src/features/warehouse/stok/stokLogic.js";

test("bacaJumlah: kosong BUKAN nol; 0 sah; koma desimal Indonesia; titik ribuan; tolak minus/huruf/>4 desimal/terlalu besar", () => {
  assert.equal(bacaJumlah("").nilai, null); assert.match(bacaJumlah("").galat, /isi 0 bila memang kosong/); assert.equal(bacaJumlah(undefined).nilai, null);
  assert.deepEqual(bacaJumlah("0"), { nilai: 0, galat: null });
  assert.equal(bacaJumlah("7,5").nilai, 7.5); assert.equal(bacaJumlah("7.5").nilai, 7.5); assert.equal(bacaJumlah("1.234,5").nilai, 1234.5); assert.equal(bacaJumlah(" 12 ").nilai, 12);
  assert.match(bacaJumlah("-3").galat, /minus/); assert.match(bacaJumlah("abc").galat, /angka/); assert.match(bacaJumlah("1,23456").galat, /4 angka/); assert.match(bacaJumlah("99999999").galat, /masuk akal/);
  assert.equal(bacaJumlah("0,0001").nilai, 0.0001);
});

test("periksaAlasan: wajib minimal 5 karakter, maksimum 500", () => {
  assert.match(periksaAlasan(""), /wajib/); assert.match(periksaAlasan("abc"), /wajib/); assert.equal(periksaAlasan("Hitung fisik 26 Okt"), null); assert.match(periksaAlasan("x".repeat(501)), /terlalu panjang/);
});

test("tiga nol yang berbeda: belum diketahui ≠ 0 menurut pergerakan ≠ 0 terverifikasi (lewat tampilSaldo Stok & Lokasi)", () => {
  const belum = tampilSaldo({ keadaanSaldo: "BELUM_ADA_CATATAN", saldo: null });
  const gerak = tampilSaldo({ keadaanSaldo: "NOL_MENURUT_PERGERAKAN", saldo: 0 });
  const verif = tampilSaldo({ keadaanSaldo: "NOL_TERVERIFIKASI", saldo: 0, nolTerverifikasi: { nomor: "ADJ-261026-01" } });
  assert.equal(belum.jenis, "BELUM_DIKETAHUI"); assert.equal(belum.teks, "belum diketahui"); assert.match(belum.keterangan, /BUKAN nol/);
  assert.equal(gerak.jenis, "NOL"); assert.equal(gerak.label, "menurut pergerakan");
  assert.equal(verif.jenis, "NOL_TERVERIFIKASI"); assert.equal(verif.label, "terverifikasi"); assert.match(verif.keterangan, /ADJ-261026-01/);
  assert.equal(new Set([belum.jenis, gerak.jenis, verif.jenis]).size, 3);
  assert.equal(tampilSaldo({ keadaanSaldo: "MINUS", saldo: -3 }).jenis, "MINUS"); assert.equal(tampilSaldo({ keadaanSaldo: "POSITIF", saldo: 4 }).teks, "4");
});

test("kompatibel dengan server lama (tanpa keadaanSaldo): perilaku lama tidak berubah", () => {
  assert.equal(tampilSaldo({ saldo: null }).jenis, "BELUM_DIKETAHUI"); assert.equal(tampilSaldo({ saldo: 0 }).jenis, "NOL"); assert.equal(tampilSaldo({ saldo: -2 }).jenis, "MINUS"); assert.equal(tampilSaldo({ saldo: 5 }).jenis, "ADA");
  assert.equal(tampilSaldoKeadaan({ saldo: 5 }), null);
});

test("tampilHargaDaftar: tanpa izin = null (kolom disembunyikan); tanpa harga = 'Belum ada harga berlaku' (BUKAN Rp0); ada harga = per satuan stok", () => {
  assert.equal(tampilHargaDaftar(null, "a"), null);
  const peta = { harga: { a: { harga: 36000, satuan: "KG", teksLabelBukti: "Belum didukung bukti", labelBukti: "BELUM_DIDUKUNG_BUKTI", terjadwal: null }, c: { harga: null, satuan: "PCS", terjadwal: { harga: 5000, berlakuMulai: "2026-11-01" } } } };
  const ada = tampilHargaDaftar(peta, "a"); assert.equal(ada.ada, true); assert.equal(ada.harga, 36000); assert.equal(ada.satuan, "kg");
  const tanpa = tampilHargaDaftar(peta, "b"); assert.equal(tanpa.ada, false); assert.equal(tanpa.teks, "Belum ada harga berlaku"); assert.doesNotMatch(tanpa.teks, /Rp0|Rp 0/);
  const jadwal = tampilHargaDaftar(peta, "c"); assert.equal(jadwal.ada, false); assert.equal(jadwal.teks, "Belum berlaku");
});

test("niatKoreksi: sama untuk klik berulang, berbeda bila bahan/jumlah/alasan berubah (dasar kunci anti klik ganda)", () => {
  const a = niatKoreksi({ materialId: "m1", jumlahFisik: 7, alasan: " hitung " });
  assert.equal(a, niatKoreksi({ materialId: "m1", jumlahFisik: 7, alasan: "hitung" }));
  assert.notEqual(a, niatKoreksi({ materialId: "m1", jumlahFisik: 8, alasan: "hitung" })); assert.notEqual(a, niatKoreksi({ materialId: "m2", jumlahFisik: 7, alasan: "hitung" })); assert.notEqual(a, niatKoreksi({ materialId: "m1", jumlahFisik: 7, alasan: "lain" }));
});

test("format: tanda +/-, saldo sebelum belum diketahui", () => {
  assert.equal(tanda(3), "+3"); assert.equal(tanda(-3), "-3"); assert.equal(fmt(null), "—"); assert.equal(teksSaldoSebelum({ saldoSebelum: null }), "belum diketahui"); assert.equal(teksSaldoSebelum({ saldoSebelum: 0 }), "0");
});
