import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { periksaBerkas, ukuranTarget, perluDiperkecil, pesanGalatFoto, labelAksiUnggah, BATAS_KIRIM_BYTE, SISI_KIRIM_MAKS } from "../src/features/warehouse/stok/fotoBahanLogic.js";

const baca = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("periksaBerkas: foto sah lolos; bukan foto / GIF / SVG / kosong / terlalu besar ditolak dengan pesan jelas", () => {
  assert.equal(periksaBerkas({ type: "image/jpeg", name: "a.jpg", size: 2_000_000 }), null);
  assert.equal(periksaBerkas({ type: "image/png", name: "a.png", size: 100 }), null);
  assert.equal(periksaBerkas({ type: "", name: "IMG_1.HEIC", size: 4_000_000 }), null, "HP kadang mengosongkan type untuk HEIC");
  assert.match(periksaBerkas(null), /Pilih foto/);
  assert.match(periksaBerkas({ type: "application/pdf", name: "a.pdf", size: 10 }), /bukan foto/);
  assert.match(periksaBerkas({ type: "", name: "catatan.txt", size: 10 }), /bukan foto/);
  assert.match(periksaBerkas({ type: "image/gif", name: "a.gif", size: 10 }), /tidak didukung/);
  assert.match(periksaBerkas({ type: "image/svg+xml", name: "a.svg", size: 10 }), /tidak didukung/);
  assert.match(periksaBerkas({ type: "image/jpeg", name: "a.jpg", size: 0 }), /kosong/);
  assert.match(periksaBerkas({ type: "image/jpeg", name: "a.jpg", size: 31 * 1024 * 1024 }), /terlalu besar/);
});

test("ukuranTarget: sisi terpanjang dibatasi, rasio tetap, tidak pernah diperbesar", () => {
  assert.deepEqual(ukuranTarget(4000, 3000), { lebar: 2000, tinggi: 1500, perkecil: true });
  assert.deepEqual(ukuranTarget(3000, 4000), { lebar: 1500, tinggi: 2000, perkecil: true });
  assert.deepEqual(ukuranTarget(800, 600), { lebar: 800, tinggi: 600, perkecil: false });
  assert.deepEqual(ukuranTarget(SISI_KIRIM_MAKS, 10), { lebar: SISI_KIRIM_MAKS, tinggi: 10, perkecil: false });
  assert.deepEqual(ukuranTarget(0, 100), { lebar: 0, tinggi: 0, perkecil: false });
});

test("perluDiperkecil: sisi melebihi batas ATAU berkas lebih besar dari batas kirim", () => {
  assert.equal(perluDiperkecil(4000, 3000, 1_000_000), true);
  assert.equal(perluDiperkecil(1500, 1000, BATAS_KIRIM_BYTE + 1), true);
  assert.equal(perluDiperkecil(1500, 1000, 800_000), false);
});

test("pesanGalatFoto: izin ditolak, terlalu besar, jaringan, dan pesan server dipakai apa adanya", () => {
  assert.match(pesanGalatFoto({ status: 403, message: "Forbidden" }), /tidak punya izin/);
  assert.match(pesanGalatFoto({ status: 413 }), /terlalu besar/);
  assert.match(pesanGalatFoto({ status: 0, code: "NETWORK", message: "Koneksi terputus saat mengunggah — coba lagi" }), /Koneksi terputus/);
  assert.equal(pesanGalatFoto({ status: 400, message: "Format gambar tidak didukung. Pilih foto JPG, PNG, atau WebP." }), "Format gambar tidak didukung. Pilih foto JPG, PNG, atau WebP.");
  assert.match(pesanGalatFoto(null), /belum berhasil/);
});

test("labelAksiUnggah: Unggah foto bila belum ada, Ganti foto bila sudah", () => {
  assert.equal(labelAksiUnggah(false), "Unggah foto"); assert.equal(labelAksiUnggah(true), "Ganti foto");
});

test("pemasangan: API klien memakai rute foto, drawer memuat FotoBahan, daftar & header memakai thumbnail, ikon jatuh kembali ke ikon kelompok", () => {
  const api = baca("src/api.js");
  assert.match(api, /unggahFotoBahan:[^\n]*requestFormData\(`\/inventory\/materials\/\$\{id\}\/photo`, fd, "PUT"\)/);
  assert.match(api, /putarFotoBahan:[^\n]*\/photo\/rotate/); assert.match(api, /hapusFotoBahan:[^\n]*method: "DELETE"/);
  const drawer = baca("src/features/warehouse/components/ItemDetailDrawer.jsx");
  assert.match(drawer, /<FotoBahan materialId=\{materialId\}/); assert.match(drawer, /fotoUrl=\{foto\.thumb\}/);
  assert.match(baca("src/features/warehouse/stok/DaftarBahan.jsx"), /fotoUrl=\{r\.fotoThumbUrl\}/);
  const ikon = baca("src/features/warehouse/stok/IkonBahan.jsx");
  assert.match(ikon, /onError=\{\(\) => setRusak\(true\)\}/); assert.match(ikon, /IKON_KELOMPOK\[kode\]/);
  const komp = baca("src/features/warehouse/stok/FotoBahan.jsx");
  for (const id of ["kartu-foto", "foto-unggah", "foto-putar", "foto-hapus", "foto-hapus-ya", "foto-kosong", "input-foto", "foto-galat"]) assert.ok(komp.includes(`data-testid="${id}"`), `testid ${id}`);
  assert.match(komp, /accept="image\/\*"/); assert.match(komp, /Konfirmasi hapus foto/);
  assert.match(komp, /Tidak mengubah stok, harga, atau nilai persediaan/);
});

test("foto tidak menyentuh stok/harga: komponen & API foto tidak memanggil layanan stok, harga, atau koreksi", () => {
  const komp = baca("src/features/warehouse/stok/FotoBahan.jsx");
  for (const terlarang of ["getStock", "Koreksi", "HargaBerlaku", "adjust", "postStock", "updateMaterial"]) assert.ok(!komp.includes(terlarang), `FotoBahan tidak boleh memuat ${terlarang}`);
});
