// Koreksi data order PKR + pembatalan (modal) + ringkasan unit di daftar Order. Pola proyek ini: fungsi murni dieksekusi dari modul; kontrak tampilan lewat text-scan sumber.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALASAN_MIN, adaPerubahan, alasanValid, barisMatriks, formAwal, galatForm, kelompokHambatan, kunciBaru, pesanGalatKoreksi, perubahanDariForm, teksJalur,
} from "../src/features/finance/pkrKoreksiOrderLogic.js";
import { ringkasUnitPkr } from "../src/features/finance/pkrOrderCrmLogic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");

const kemLama = () => ({
  format: "LAMA_TANPA_ITEM", formatLama: true, revisi: 0,
  field: {
    alamat: { boleh: true, nilai: "Jl. Mawar 5, Bekasi" }, kota: { boleh: true, nilai: "Bekasi" }, tanggalKirim: { boleh: true, nilai: null }, catatan: { boleh: true, nilai: null },
    perluDikirim: { boleh: true, nilai: true }, merk: { boleh: true, nilai: "Sorong" }, ukuran: { boleh: true, nilai: "120 x 200" },
  },
  jumlah: { boleh: false, alasan: "Format lama", jalur: "batal-catat-ulang" }, harga: { boleh: false, alasan: "Format lama", jalur: "batal-catat-ulang" },
  tambahHapusItem: { boleh: false, alasan: "Tanpa item", jalur: "batal-catat-ulang" }, perItem: { boleh: false, alasan: "Tanpa item", jalur: "batal-catat-ulang" },
});

test("formAwal: nilai tersimpan apa adanya, kosong = string kosong; dikirim dipetakan ya/tidak/''", () => {
  const f = formAwal(kemLama());
  assert.deepEqual(f, { alamat: "Jl. Mawar 5, Bekasi", kota: "Bekasi", tanggalKirim: "", catatan: "", kirim: "ya", merk: "Sorong", ukuran: "120 x 200" });
  assert.equal(formAwal({ field: { perluDikirim: { nilai: false } } }).kirim, "tidak");
  assert.equal(formAwal({ field: { perluDikirim: { nilai: null } } }).kirim, "");
});

test("perubahanDariForm: hanya field yang berbeda DAN boleh; spasi dirapatkan; mengosongkan = ''; terkunci tidak pernah dikirim", () => {
  const kem = kemLama(); const f = formAwal(kem);
  assert.deepEqual(perubahanDariForm(f, kem), {}, "tanpa perubahan");
  assert.equal(adaPerubahan(f, kem), false);
  assert.deepEqual(perubahanDariForm({ ...f, alamat: "  Jl.   Melati  9 ", kota: "Bandung" }, kem), { alamat: "Jl. Melati 9", kota: "Bandung" });
  assert.deepEqual(perubahanDariForm({ ...f, alamat: "Jl.  Mawar 5, Bekasi" }, kem), {}, "beda spasi saja = tidak berubah");
  assert.deepEqual(perubahanDariForm({ ...f, kota: "" }, kem), { kota: "" }, "mengosongkan field");
  assert.deepEqual(perubahanDariForm({ ...f, kirim: "tidak" }, kem), { perluDikirim: false });
  const terkunci = kemLama(); terkunci.field.ukuran.boleh = false; terkunci.field.catatan.boleh = false;
  assert.deepEqual(perubahanDariForm({ ...f, ukuran: "180 x 200", catatan: "x", kota: "Cimahi" }, terkunci), { kota: "Cimahi" }, "field terkunci tidak dikirim");
  const belum = kemLama(); belum.field.perluDikirim.nilai = null;
  assert.deepEqual(perubahanDariForm({ ...formAwal(belum), kirim: "" }, belum), {}, "kembali ke belum-ditentukan tidak dikirim");
});

test("galatForm + alasanValid: tanpa perubahan, tanggal tak valid, alasan minimal 5 karakter (spasi dirapatkan)", () => {
  const kem = kemLama(); const f = formAwal(kem);
  assert.equal(galatForm(f, kem), "Belum ada yang diubah");
  assert.equal(galatForm({ ...f, tanggalKirim: "30-10-2026" }, kem), "Tanggal kirim harus berformat YYYY-MM-DD");
  assert.equal(galatForm({ ...f, kota: "Bandung" }, kem), null);
  assert.equal(galatForm({ ...f, kota: "x" }, null), "Memuat kemampuan koreksi…");
  assert.equal(alasanValid("abcd"), false); assert.equal(alasanValid("  ab   c "), false, "dirapatkan jadi \"ab c\" = 4 karakter"); assert.equal(alasanValid("abcde"), true);
  assert.equal(ALASAN_MIN, 5);
});

test("barisMatriks: format lama TIDAK menyembunyikan batasan — jumlah/harga/item terkunci dengan alasan, field order bisa", () => {
  const b = barisMatriks(kemLama());
  const by = Object.fromEntries(b.map((x) => [x.kunci, x]));
  assert.equal(b.length, 4 + 7);
  assert.equal(by["Jumlah unit / jumlah baris"].boleh, false); assert.ok(by["Jumlah unit / jumlah baris"].alasan);
  assert.equal(by["Harga / nilai penjualan"].boleh, false);
  assert.equal(by.alamat.boleh, true); assert.equal(by.ukuran.boleh, true);
  assert.equal(teksJalur("batal-catat-ulang"), "hanya lewat batalkan lalu catat ulang");
  assert.equal(teksJalur("tidak-dikenal"), null);
  assert.deepEqual(barisMatriks(null), []);
});

test("pesanGalatKoreksi: REVISI_BERUBAH diberi arahan; selain itu pesan server apa adanya", () => {
  assert.match(pesanGalatKoreksi({ code: "REVISI_BERUBAH", message: "x" }), /sudah diubah orang lain/);
  assert.equal(pesanGalatKoreksi({ message: "Koreksi ditolak: Ukuran — Produksi sudah berjalan" }), "Koreksi ditolak: Ukuran — Produksi sudah berjalan");
  assert.equal(pesanGalatKoreksi(null), "");
});

test("kunciBaru: kunci Idempotency unik per niat dan sesuai pola server (8–128 karakter A-Za-z0-9_-:.)", () => {
  const a = kunciBaru(); const b = kunciBaru();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_\-:.]{8,128}$/);
});

test("kelompokHambatan: DP -> tautan Riwayat Pembayaran; produksi/pengiriman -> alur order; sudah dibatalkan -> final", () => {
  const pv = { hambatan: [{ kode: "PEMBAYARAN_AKTIF" }, { kode: "PRODUKSI_DELIVERY_BERJALAN" }, { kode: "PRODUKSI_DELIVERY_BERJALAN" }, { kode: "SUDAH_DIBATALKAN" }, { kode: "LAIN" }] };
  const g = kelompokHambatan(pv);
  assert.equal(g.bayar.length, 1); assert.equal(g.produksi.length, 2); assert.equal(g.sudah.length, 1); assert.equal(g.lain.length, 1);
  assert.deepEqual(kelompokHambatan(null), { bayar: [], produksi: [], sudah: [], lain: [] });
});

test("ringkasUnitPkr: nomor order, jumlah unit aktif, kode ringkas; status dirinci HANYA bila berbeda; unit dibatalkan dihitung terpisah", () => {
  const unit = (n, status, label) => ({ kode: `NEW-11102026-023-U${n}`, status, label });
  const sama = ringkasUnitPkr({ order: { nomor: "NEW-11102026-023" }, units: [unit(1, "RECEIVED", "Menunggu produksi"), unit(2, "RECEIVED", "Menunggu produksi"), unit(3, "RECEIVED", "Menunggu produksi")] });
  assert.equal(sama.nomorOrder, "NEW-11102026-023"); assert.equal(sama.jumlah, 3);
  assert.deepEqual(sama.kode.map((k) => k.pendek), ["U1", "U2", "U3"]);
  assert.equal(sama.statusSama, true); assert.equal(sama.labelSama, "Menunggu produksi");
  const beda = ringkasUnitPkr({ order: { nomor: "N" }, units: [unit(1, "RECEIVED", "Menunggu produksi"), unit(2, "IN_PRODUCTION", "Sedang diproduksi"), unit(3, "CANCELLED", "Dibatalkan")] });
  assert.equal(beda.jumlah, 2); assert.equal(beda.dibatalkan, 1); assert.equal(beda.statusSama, false); assert.equal(beda.labelSama, null);
  assert.deepEqual(beda.kode.map((k) => k.pendek), ["U1", "U2"]);
  assert.deepEqual(beda.kelompok, [{ status: "RECEIVED", label: "Menunggu produksi", kode: ["U1"] }, { status: "IN_PRODUCTION", label: "Sedang diproduksi", kode: ["U2"] }]);
  const campur = ringkasUnitPkr({ order: { nomor: "N" }, units: [unit(1, "RECEIVED", "Menunggu produksi"), unit(2, "IN_PRODUCTION", "Sedang diproduksi"), unit(3, "RECEIVED", "Menunggu produksi")] });
  assert.deepEqual(campur.kelompok.map((g) => [g.label, g.kode]), [["Menunggu produksi", ["U1", "U3"]], ["Sedang diproduksi", ["U2"]]], "status dikelompokkan, bukan diulang per unit");
  assert.equal(ringkasUnitPkr(null), null); assert.equal(ringkasUnitPkr({ order: { nomor: "N" }, units: [] }), null); assert.equal(ringkasUnitPkr({ units: [unit(1, "RECEIVED", "x")] }), null);
});

// ── Kontrak tampilan (text-scan) ──────────────────────────────────────────────────────
const HALAMAN = read("pages", "finance", "FinancePenjualanKaryawan.jsx");
const BATAL = read("features", "finance", "PkrBatalModal.jsx");
const KOREKSI = read("features", "finance", "PkrKoreksiOrder.jsx");
const ORDERS = read("pages", "Orders.jsx");
const API = read("api.js");

test("halaman PKR: tidak ada window.prompt (pembatalan PKR dan pembatalan pembayaran memakai modal); aksi koreksi data order selalu tampil", () => {
  assert.doesNotMatch(HALAMAN, /window\.prompt|[^.\w]prompt\(/);
  assert.match(HALAMAN, /<ModalBatalPkr/); assert.match(HALAMAN, /<ModalAlasan/); assert.match(HALAMAN, /<ModalKoreksiOrderPkr/);
  assert.match(HALAMAN, /label: "Koreksi data order & batasan"/);
  assert.match(HALAMAN, /onBukaRiwayat=\{\(id\) => \{ setBatalUntuk\(null\); setRiwayatId\(id\); \}\}/, "tautan ke Riwayat Pembayaran menutup modal batal dan membuka riwayat");
});

test("modal pembatalan: pratinjau server dulu; DP dijelaskan (tidak dibatalkan/dikembalikan otomatis) + tautan Riwayat Pembayaran; galat server tampil di modal; kunci idempotensi", () => {
  assert.match(BATAL, /api\.pratinjauPembatalanPkr\(/);
  assert.match(BATAL, /Pembayaran harus ditangani Finance dahulu/);
  assert.match(BATAL, /data-testid="batal-pesan-bayar"[^>]*>\{h\.bayar\[0\]\.pesan\}/, "penjelasan DP tampil apa adanya dari server (satu sumber; server menyatakan pembayaran tidak dibatalkan/dikembalikan otomatis)");
  assert.match(BATAL, /Buka Riwayat Pembayaran/);
  assert.match(BATAL, /data-testid="batal-galat"/);
  assert.match(BATAL, /role="alert"/);
  assert.match(BATAL, /kunciBaru\("pkr-batal"\)/);
  assert.match(BATAL, /Produksi atau pengiriman sudah berjalan/);
  assert.doesNotMatch(BATAL, /api\.batalPembayaranPenjualanKaryawan/, "modal pembatalan tidak pernah membatalkan pembayaran sendiri");
});

test("modal koreksi data order: batasan format lama tampil; pratinjau dulu; alasan wajib; revisi + Idempotency-Key; tidak mengubah jumlah/harga", () => {
  assert.match(KOREKSI, /Batasan format lama/);
  assert.match(KOREKSI, /Apa yang bisa dan tidak bisa dikoreksi/);
  assert.match(KOREKSI, /api\.getKemampuanKoreksiPkr\(/); assert.match(KOREKSI, /api\.pratinjauKoreksiOrderPkr\(/); assert.match(KOREKSI, /api\.koreksiOrderPkr\(/);
  assert.match(KOREKSI, /expectedRevision: kem\.revisi/);
  assert.match(KOREKSI, /data-testid="koreksi-order-alasan"/);
  assert.match(KOREKSI, /Migrasi ke format terpadu: belum tersedia/);
  assert.doesNotMatch(KOREKSI, /InputUang|jumlahUnit|unitPrice/, "layar ini tidak mengubah uang/jumlah unit");
});

test("daftar Order: ringkasan unit PKR dipasang di kartu dan baris tabel; API memuat endpoint baru", () => {
  assert.equal((ORDERS.match(/<RingkasUnitOrderPkr /g) || []).length, 2);
  for (const fn of ["pratinjauPembatalanPkr", "getKemampuanKoreksiPkr", "pratinjauKoreksiOrderPkr", "koreksiOrderPkr"]) assert.match(API, new RegExp(`${fn}:`));
  assert.match(API, /batalPenjualanKaryawan: \(id, reason, idempotencyKey\)/);
});
