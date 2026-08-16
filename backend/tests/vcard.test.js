// Tes penyusun vCard.
//
// Kenapa diuji ketat: file .vcf ini diimpor MENTAH ke buku alamat HP orang
// — kalau formatnya salah, kegagalannya baru kelihatan setelah sales
// mencoba impor dan sebagian/semua kontak tidak masuk atau namanya rusak.
// Tidak ada "hampir benar" untuk format file; RFC-nya ketat.

import test from "node:test";
import assert from "node:assert/strict";
import { buatSatuVCard, buatFileVCard } from "../src/services/vcard.js";

test("kartu dasar berbentuk sesuai RFC 6350 (BEGIN/VERSION/FN/N/TEL/END)", () => {
  const v = buatSatuVCard({ name: "Budi Santoso", phone: "6285187283900" });
  assert.match(v, /^BEGIN:VCARD\r\n/);
  assert.match(v, /VERSION:3\.0\r\n/);
  assert.match(v, /FN:Budi Santoso\r\n/);
  assert.match(v, /N:;Budi Santoso;;;\r\n/);
  assert.match(v, /TEL;TYPE=CELL:\+6285187283900\r\n/);
  assert.match(v, /END:VCARD$/);
});

test("nomor 628xxx (bentuk baku CRM) jadi +628xxx (bentuk internasional)", () => {
  const v = buatSatuVCard({ name: "Siti", phone: "6281234774076" });
  assert.match(v, /TEL;TYPE=CELL:\+6281234774076/);
});

test("pelanggan tanpa nama DILEWATI — kontak bernama nomor tidak berguna", () => {
  assert.equal(buatSatuVCard({ name: "", phone: "6285187283900" }), null);
  assert.equal(buatSatuVCard({ name: null, phone: "6285187283900" }), null);
  assert.equal(buatSatuVCard({ name: "   ", phone: "6285187283900" }), null);
});

test("pelanggan tanpa nomor DILEWATI — vCard tanpa TEL tidak berguna", () => {
  assert.equal(buatSatuVCard({ name: "Budi", phone: null }), null);
  assert.equal(buatSatuVCard({ name: "Budi", phone: "" }), null);
});

test("karakter yang wajib di-escape (RFC 6350 §3.4): koma, titik koma, backslash", () => {
  const v = buatSatuVCard({ name: 'Toko "Sejahtera, Jaya; Abadi\\Makmur"', phone: "6281234567890" });
  // Koma & titik-koma dalam NAMA (bukan pemisah field) harus lolos utuh
  // setelah di-escape, bukan disalahartikan sebagai batas field N.
  assert.match(v, /FN:Toko "Sejahtera\\, Jaya\\; Abadi\\\\Makmur"/);
});

test("backslash di-escape LEBIH DULU dari koma/titik-koma — urutan yang salah menggandakan escape", () => {
  // Kalau koma di-escape duluan ("," -> "\,") lalu backslash-nya baru
  // diproses, hasil "\," akan ikut kena escape backslash jadi "\\,"
  // — dua backslash, bukan satu. Urutan yang benar: backslash paling awal.
  const v = buatSatuVCard({ name: "A,B", phone: "6281234567890" });
  assert.match(v, /FN:A\\,B\r\n/);
  assert.doesNotMatch(v, /FN:A\\\\,B/);
});

test("baris panjang dilipat maksimal 75 karakter (RFC 6350 §3.2)", () => {
  const namaPanjang = "Bu " + "Sangat ".repeat(15) + "Panjang Sekali Namanya Ini";
  const v = buatSatuVCard({ name: namaPanjang, phone: "6281234567890" });
  const barisFN = v.split("\r\n").find((b) => b.startsWith("FN:") || (b.startsWith(" ") && v.includes("FN:")));
  // Setiap baris fisik (dipisah \r\n) harus <=75 karakter, kecuali baris
  // lanjutan yang dimulai spasi (bagian dari mekanisme lipat itu sendiri).
  for (const baris of v.split("\r\n")) {
    assert.ok(baris.length <= 75, `baris melebihi 75 karakter: "${baris}" (${baris.length})`);
  }
});

test("ORG disertakan sebagai penanda supaya bisa dihapus massal nanti", () => {
  const v = buatSatuVCard({ name: "Budi", phone: "6281234567890" });
  assert.match(v, /ORG:Klinik Matras/);
});

test("buatFileVCard menghitung jumlah & yang dilewati dengan benar", () => {
  const hasil = buatFileVCard([
    { name: "Budi", phone: "6281111111111" },
    { name: "", phone: "6282222222222" },       // dilewati: tanpa nama
    { name: "Siti", phone: null },                // dilewati: tanpa nomor
    { name: "Ani", phone: "6283333333333" },
  ]);
  assert.equal(hasil.jumlah, 2);
  assert.equal(hasil.dilewati, 2);
  assert.equal((hasil.isi.match(/BEGIN:VCARD/g) || []).length, 2);
});

test("daftar kosong tidak melempar error", () => {
  const hasil = buatFileVCard([]);
  assert.equal(hasil.jumlah, 0);
  assert.equal(hasil.isi, "");
});
