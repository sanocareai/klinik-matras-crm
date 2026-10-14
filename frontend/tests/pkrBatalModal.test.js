// Pembatalan Penjualan Karyawan (PKR): modal pratinjau server + alasan, penggantian window.prompt. Pola proyek: fungsi murni dieksekusi dari modul; kontrak tampilan lewat text-scan sumber.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALASAN_MIN, ALASAN_MAKS, alasanValid, rapikanAlasan, kelompokHambatan, kunciBaru } from "../src/features/finance/pkrBatalLogic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");

test("alasanValid: minimal 5 karakter setelah spasi dirapatkan, maksimal 500; huruf tidak pernah diubah", () => {
  assert.equal(ALASAN_MIN, 5); assert.equal(ALASAN_MAKS, 500);
  assert.equal(alasanValid("abcd"), false);
  assert.equal(alasanValid("  ab   c "), false, "dirapatkan jadi \"ab c\" = 4 karakter");
  assert.equal(alasanValid("abcde"), true);
  assert.equal(alasanValid("x".repeat(500)), true);
  assert.equal(alasanValid("x".repeat(501)), false);
  assert.equal(rapikanAlasan("  Pesanan   salah\tinput  "), "Pesanan salah input", "regresi: huruf s tidak boleh hilang");
});

test("kunciBaru: unik per niat dan sesuai pola Idempotency-Key server (8–128 karakter A-Za-z0-9_-:.)", () => {
  const a = kunciBaru(); const b = kunciBaru();
  assert.notEqual(a, b);
  for (const k of [a, b, kunciBaru("pkr-batal")]) assert.match(k, /^[A-Za-z0-9_\-:.]{8,128}$/);
});

test("kelompokHambatan: DP -> Riwayat Pembayaran; produksi/pengiriman -> alur order; sudah dibatalkan -> final; kode asing -> lain", () => {
  const pv = { hambatan: [
    { kode: "PEMBAYARAN_AKTIF", pesan: "a" }, { kode: "PRODUKSI_DELIVERY_BERJALAN", pesan: "b" }, { kode: "PRODUKSI_DELIVERY_BERJALAN", pesan: "c" },
    { kode: "SUDAH_DIBATALKAN", pesan: "d" }, { kode: "BARU", pesan: "e" },
  ] };
  const g = kelompokHambatan(pv);
  assert.equal(g.bayar.length, 1); assert.equal(g.produksi.length, 2); assert.equal(g.sudah.length, 1); assert.equal(g.lain.length, 1);
  assert.deepEqual(kelompokHambatan(null), { bayar: [], produksi: [], sudah: [], lain: [] });
});

const HALAMAN = read("pages", "finance", "FinancePenjualanKaryawan.jsx");
const BATAL = read("features", "finance", "PkrBatalModal.jsx");
const API = read("api.js");

test("halaman PKR: tidak ada window.prompt; pembatalan PKR dan pembatalan pembayaran memakai modal; tautan Riwayat Pembayaran menutup modal batal", () => {
  assert.doesNotMatch(HALAMAN, /window\.prompt|[^.\w]prompt\(/);
  assert.match(HALAMAN, /<ModalBatalPkr/);
  assert.match(HALAMAN, /<ModalAlasan/);
  assert.match(HALAMAN, /onBukaRiwayat=\{\(id\) => \{ setBatalUntuk\(null\); setRiwayatId\(id\); \}\}/);
  assert.match(HALAMAN, /onClick: \(\) => setBatalUntuk\(p\)/);
  // Koreksi Order live tidak disentuh.
  assert.match(HALAMAN, /<ModalKoreksiOrderPkr/);
});

test("modal pembatalan: pratinjau server dulu; DP dijelaskan apa adanya dari server + tautan Riwayat Pembayaran; galat server di modal; kunci idempotensi; tidak membatalkan pembayaran sendiri", () => {
  assert.match(BATAL, /api\.pratinjauPembatalanPkr\(/);
  assert.match(BATAL, /Pembayaran harus ditangani Finance dahulu/);
  assert.match(BATAL, /data-testid="batal-pesan-bayar"[^>]*>\{h\.bayar\[0\]\.pesan\}/);
  assert.match(BATAL, /Buka Riwayat Pembayaran/);
  assert.match(BATAL, /data-testid="batal-galat"/);
  assert.match(BATAL, /role="alert"/);
  assert.match(BATAL, /kunciBaru\("pkr-batal"\)/);
  assert.match(BATAL, /Produksi atau pengiriman sudah berjalan/);
  assert.doesNotMatch(BATAL, /api\.batalPembayaranPenjualanKaryawan/, "modal pembatalan tidak pernah membatalkan pembayaran sendiri");
  assert.match(BATAL, /replace\(\/\\s\+\/g, " "\)/, "alasan dirapikan dengan \\s+ (bukan s+)");
});

test("api: batal memakai Idempotency-Key; pratinjau pembatalan baca-saja", () => {
  assert.match(API, /batalPenjualanKaryawan: \(id, reason, idempotencyKey\) => request\(`\/finance\/penjualan-karyawan\/\$\{id\}\/batal`[^\n]*"Idempotency-Key"/);
  assert.match(API, /pratinjauPembatalanPkr: \(id\) => request\(`\/finance\/penjualan-karyawan\/\$\{id\}\/pembatalan`\)/);
});
