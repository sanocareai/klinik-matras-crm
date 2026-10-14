// Item Penjualan & Pemenuhan (Penjualan Karyawan): logika murni form terpadu + pemasangan di layar. SATU daftar item (harga + pemenuhan + ukuran + kirim); tidak ada daftar kedua.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  itemPenjualanBaru, penjualanKosong, ubahPemenuhanItem, kategoriUntukPemenuhan, namaItemPenjualan, totalPenjualan, subtotalPenjualan, galatItemPenjualan, bodyItemPenjualan,
  bodyPenjualanTerpadu, formKoreksiBaris, operasiKoreksiBaris, galatKoreksiBaris, punyaUnitPemenuhan, ubahKategoriItem,
} from "../src/features/finance/pkrItemLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");
const dim = (key, label, wajib) => ({ key, label, satuan: "cm", wajib });
const KATALOG = {
  pemenuhan: [
    { kode: "PRODUKSI_BARU", label: "Produksi Baru", unit: true, jenisKerja: "BARU" },
    { kode: "SERVICE_PICKUP", label: "Service / Pickup", unit: true, jenisKerja: "LAYANAN" },
    { kode: "AMBIL_STOK", label: "Ambil dari Stok", unit: false, jenisKerja: null },
    { kode: "TANPA_OPERASIONAL", label: "Tidak Memerlukan Operasional", unit: false, jenisKerja: null },
  ],
  bentuk: {
    KASUR: { label: "Kasur", produk: { label: "Produk / merk", wajib: true }, dimensi: [dim("panjang", "Panjang", true), dim("lebar", "Lebar", true), dim("tebal", "Tebal", true)], spesifikasi: { label: "Spesifikasi", keras: false } },
    SERVICE: { label: "Service", produk: { label: "Layanan", wajib: true }, dimensi: [dim("panjang", "Panjang", true), dim("lebar", "Lebar", true)], spesifikasi: { label: "Keluhan", keras: false } },
    SANDARAN: { label: "Sandaran", produk: { label: "Model", wajib: false }, dimensi: [dim("lebar", "Lebar", true), dim("tinggi", "Tinggi", true)], spesifikasi: { label: "Spesifikasi", keras: false } },
    SET: { label: "Set", produk: { label: "Paket", wajib: false }, dimensi: [], bundel: true, spesifikasi: { label: "Catatan set", keras: false } },
  },
  kategori: [
    { id: "k1", kode: "KASUR_BARU", nama: "Kasur Baru", bentuk: "KASUR", jenisKerja: "BARU", aktif: true, produk: [{ id: "p1", kode: "PRD_A", nama: "Matras Custom T20" }] },
    { id: "k2", kode: "SERVICE_UPGRADE", nama: "Service/Upgrade Kasur", bentuk: "SERVICE", jenisKerja: "LAYANAN", aktif: true, produk: [] },
    { id: "k3", kode: "SANDARAN", nama: "Sandaran/Headboard", bentuk: "SANDARAN", jenisKerja: "BARU", aktif: true, produk: [] },
    { id: "k4", kode: "SET_LENGKAP", nama: "Set Kasur Lengkap", bentuk: "SET", jenisKerja: "BARU", aktif: true, bundel: true, produk: [], komposisi: [
      { kategoriKode: "KASUR_BARU", kategoriNama: "Kasur Baru", bentuk: "KASUR", jumlah: 1 }, { kategoriKode: "SANDARAN", kategoriNama: "Sandaran/Headboard", bentuk: "SANDARAN", jumlah: 1 },
    ] },
  ],
};
const kasur = (o = {}) => ({ ...itemPenjualanBaru(), pemenuhan: "PRODUKSI_BARU", kategori: "KASUR_BARU", produkNama: "Kasur Sano", jumlah: "1", harga: "5000000", panjang: "200", lebar: "160", tebal: "20", kirim: "ya", ...o });
const stok = (o = {}) => ({ ...itemPenjualanBaru(), pemenuhan: "AMBIL_STOK", nama: "Bantal Sano", jumlah: "2", harga: "100000", ...o });

test("satu daftar: item baru membawa pemenuhan + harga + bidang kontekstual; pemenuhan kosong (tidak ditebak)", () => {
  const i = itemPenjualanBaru();
  assert.equal(i.pemenuhan, "", "tidak ada default pemenuhan");
  assert.ok("harga" in i && "jumlah" in i && "kirim" in i && "panjang" in i && "nama" in i);
  assert.equal(penjualanKosong().items.length, 1);
});

test("kategori mengikuti pemenuhan; ganti pemenuhan melepas kategori yang tidak cocok dan membersihkan isian item tanpa unit", () => {
  assert.deepEqual(kategoriUntukPemenuhan(KATALOG, "PRODUKSI_BARU").map((k) => k.kode), ["KASUR_BARU", "SANDARAN", "SET_LENGKAP"]);
  assert.deepEqual(kategoriUntukPemenuhan(KATALOG, "SERVICE_PICKUP").map((k) => k.kode), ["SERVICE_UPGRADE"]);
  assert.deepEqual(kategoriUntukPemenuhan(KATALOG, "AMBIL_STOK").map((k) => k.kode), ["KASUR_BARU", "SERVICE_UPGRADE", "SANDARAN"], "stok: tanpa Set");
  assert.deepEqual(kategoriUntukPemenuhan(KATALOG, ""), []);
  const ke = ubahPemenuhanItem(KATALOG, kasur(), "SERVICE_PICKUP");
  assert.equal(ke.pemenuhan, "SERVICE_PICKUP"); assert.equal(ke.kategori, "", "kategori produk baru tidak cocok untuk service");
  const stokDariKasur = ubahPemenuhanItem(KATALOG, kasur(), "AMBIL_STOK");
  assert.equal(stokDariKasur.kategori, "KASUR_BARU", "kategori boleh tetap untuk stok");
  assert.equal(stokDariKasur.panjang, ""); assert.equal(stokDariKasur.kirim, ""); assert.equal(punyaUnitPemenuhan(KATALOG, "AMBIL_STOK"), false);
  const pecahan = ubahPemenuhanItem(KATALOG, stok({ jumlah: "1,6" }), "PRODUKSI_BARU");
  assert.equal(pecahan.jumlah, "1", "item produksi harus bilangan bulat");
});

test("nama item di tagihan = nama produk katalog / ketikan; bentuk yang tidak mewajibkan produk memakai nama kategori; Set memakai nama set", () => {
  assert.equal(namaItemPenjualan(KATALOG, kasur({ produkId: "p1", produkNama: "" })), "Matras Custom T20");
  assert.equal(namaItemPenjualan(KATALOG, kasur({ produkId: "", produkNama: "Kasur Sano" })), "Kasur Sano");
  assert.equal(namaItemPenjualan(KATALOG, kasur({ produkId: "", produkNama: "" })), "", "kasur wajib produk: nama kosong");
  assert.equal(namaItemPenjualan(KATALOG, kasur({ kategori: "SANDARAN", produkNama: "" })), "Sandaran/Headboard");
  assert.equal(namaItemPenjualan(KATALOG, { ...kasur(), kategori: "SET_LENGKAP", produkId: "" }), "Set Kasur Lengkap");
  assert.equal(namaItemPenjualan(KATALOG, stok()), "Bantal Sano");
});

test("total dari baris yang sama: jumlah x harga dibulatkan per baris (jumlah pecahan untuk item tanpa unit); Set = satu harga induk", () => {
  assert.equal(subtotalPenjualan(kasur({ jumlah: "2", harga: "5000000" })), 10_000_000);
  assert.equal(subtotalPenjualan(stok({ jumlah: "1,6", harga: "100000" })), 160_000);
  assert.equal(totalPenjualan([kasur({ jumlah: "2" }), stok({ jumlah: "1,6" })]), 10_160_000);
  const set = { ...itemPenjualanBaru(), pemenuhan: "PRODUKSI_BARU", kategori: "SET_LENGKAP", jumlah: "2", harga: "9000000" };
  assert.equal(totalPenjualan([set]), 18_000_000, "harga set tidak dikalikan jumlah komponen");
  assert.equal(totalPenjualan([]), 0);
  assert.equal(subtotalPenjualan({ jumlah: "x", harga: "100" }), 0);
});

test("galat ringan: pemenuhan, kategori, harga, nama wajib; kekurangan ukuran bukan galat; total unit dibatasi", () => {
  assert.match(galatItemPenjualan([itemPenjualanBaru()], KATALOG), /pilih cara pemenuhan/);
  assert.match(galatItemPenjualan([kasur({ harga: "" })], KATALOG), /harga satuan wajib/);
  assert.match(galatItemPenjualan([kasur({ kategori: "" })], KATALOG), /pilih kategori/);
  assert.match(galatItemPenjualan([kasur({ produkNama: "" })], KATALOG), /wajib diisi/);
  assert.match(galatItemPenjualan([stok({ nama: "" })], KATALOG), /nama item wajib/);
  assert.match(galatItemPenjualan([kasur({ jumlah: "abc" })], KATALOG), /jumlah tidak valid/);
  assert.match(galatItemPenjualan([kasur({ panjang: "dua ratus" })], KATALOG), /Item 1: Panjang harus berupa angka/);
  assert.match(galatItemPenjualan([stok(), kasur({ panjang: "dua ratus" })], KATALOG), /^Item 2: Panjang/, "nomor item = nomor baris sebenarnya");
  assert.equal(galatItemPenjualan([kasur({ panjang: "", lebar: "", tebal: "" })], KATALOG), null, "ukuran boleh dikosongkan dulu");
  assert.equal(galatItemPenjualan([kasur(), stok()], KATALOG), null);
  assert.match(galatItemPenjualan([kasur({ jumlah: "150" }), kasur({ jumlah: "60", produkNama: "Lain" })], KATALOG), /melebihi batas 200/);
});

test("body API terpadu: satu daftar membawa harga + pemenuhan + ukuran; item tanpa unit hanya nama/jumlah/harga; alamat hanya bila ada yang dikirim", () => {
  const k = bodyItemPenjualan(kasur({ jumlah: "2", spesifikasi: "Kain knit" }), KATALOG);
  assert.deepEqual([k.pemenuhan, k.kategori, k.jumlah, k.harga, k.produkNama, k.panjang, k.perluDikirim, k.spesifikasi], ["PRODUKSI_BARU", "KASUR_BARU", 2, 5_000_000, "Kasur Sano", "200", true, "Kain knit"]);
  const s = bodyItemPenjualan(stok({ jumlah: "1,6" }), KATALOG);
  assert.deepEqual(s, { pemenuhan: "AMBIL_STOK", harga: 100_000, jumlah: "1.6", nama: "Bantal Sano" });
  assert.ok(!("perluDikirim" in s) && !("panjang" in s));
  const b = bodyPenjualanTerpadu({ items: [kasur(), stok()], alamat: "Jl. Mawar 5", kota: "Bekasi", tanggalKirim: "" }, KATALOG);
  assert.equal(b.items.length, 2); assert.deepEqual(b.orderCrm, { alamat: "Jl. Mawar 5", kota: "Bekasi" });
  const tanpaKirim = bodyPenjualanTerpadu({ items: [kasur({ kirim: "tidak" }), stok()], alamat: "Jl. X", kota: "", tanggalKirim: "" }, KATALOG);
  assert.deepEqual(tanpaKirim.orderCrm, {}, "alamat tidak dikirim bila tak ada yang dikirim");
  assert.ok(!("orderCrm" in { items: b.items }) || true);
  assert.ok(!JSON.stringify(b).includes("orderCrm\":{\"items"), "tidak ada daftar item kedua di orderCrm");
});

test("kategori bundel (Set): satu baris, komponen sesuai komposisi, harga induk", () => {
  const set = ubahKategoriItem(KATALOG, { ...itemPenjualanBaru(), pemenuhan: "PRODUKSI_BARU", jumlah: "1", harga: "9000000" }, "SET_LENGKAP");
  assert.equal(set.komponen.length, 2);
  const body = bodyItemPenjualan({ ...set, kirim: "ya" }, KATALOG);
  assert.equal(body.kategori, "SET_LENGKAP"); assert.equal(body.harga, 9_000_000); assert.equal(body.komponen.length, 2);
  assert.ok(body.komponen.every((c) => !("harga" in c)), "komponen tidak punya harga sendiri");
});

const PKR = {
  id: "p", nomor: "PKR-1",
  items: [
    { id: "a", sortOrder: 0, name: "Kasur Sano", quantity: 1, unitPrice: 5_000_000, terpadu: true, pemenuhan: "PRODUKSI_BARU", pemenuhanLabel: "Produksi Baru", perluDikirim: true },
    { id: "b", sortOrder: 1, name: "Bantal", quantity: 2, unitPrice: 100_000, terpadu: true, pemenuhan: "AMBIL_STOK", pemenuhanLabel: "Ambil dari Stok", perluDikirim: null },
    { id: "c", sortOrder: 2, name: "Catatan lama", quantity: 1, unitPrice: 1000, terpadu: false },
  ],
  sinkron: { order: { revisi: 3 }, items: [{ no: 1, saleItemId: "a", bundel: null, unit: [{ status: "RECEIVED" }] }] },
};

test("koreksi baris: form dari PKR (baris lama tidak ikut), kunci produksi, operasi hanya yang berubah, harga boleh saat terkunci", () => {
  const f = formKoreksiBaris(PKR);
  assert.deepEqual(f.baris.map((b) => [b.no, b.unit, b.terkunci]), [[1, true, false], [2, false, false]]);
  assert.equal(f.revisi, 3);
  assert.deepEqual(operasiKoreksiBaris(f, KATALOG), [], "tanpa perubahan = tanpa operasi");
  assert.equal(galatKoreksiBaris(f, KATALOG), "Belum ada perubahan");
  f.baris[0].harga = "5500000"; f.baris[0].jumlah = "2"; f.baris[0].kirim = "tidak";
  f.baris[1].nama = "Bantal Premium";
  assert.deepEqual(operasiKoreksiBaris(f, KATALOG), [
    { op: "ubah", no: 1, harga: 5_500_000, jumlah: 2, perluDikirim: false },
    { op: "ubah", no: 2, nama: "Bantal Premium" },
  ]);
  f.baris[1].hapus = true;
  assert.ok(operasiKoreksiBaris(f, KATALOG).some((o) => o.op === "hapus" && o.no === 2));
  f.baru = [kasur({ produkNama: "Kasur Tambahan" })];
  const tambah = operasiKoreksiBaris(f, KATALOG).find((o) => o.op === "tambah");
  assert.equal(tambah.item.harga, 5_000_000); assert.equal(tambah.item.pemenuhan, "PRODUKSI_BARU");
  assert.equal(galatKoreksiBaris(f, KATALOG), null);
  // terkunci setelah produksi mulai
  const kunci = formKoreksiBaris({ ...PKR, sinkron: { ...PKR.sinkron, items: [{ no: 1, saleItemId: "a", unit: [{ status: "IN_PRODUCTION" }] }] } });
  assert.equal(kunci.baris[0].terkunci, true);
  // semua dihapus tanpa pengganti ditolak
  const semua = formKoreksiBaris(PKR); semua.baris.forEach((b) => { b.hapus = true; });
  assert.match(galatKoreksiBaris(semua, KATALOG), /menghapus semua item/);
  const jumlahSalah = formKoreksiBaris(PKR); jumlahSalah.baris[0].jumlah = "1,5";
  assert.match(galatKoreksiBaris(jumlahSalah, KATALOG), /bilangan bulat/);
});

test("pemasangan: pembuatan penjualan memakai SATU daftar (FormItemPenjualan); bagian lama 'Item yang dijual' + 'Order untuk Produksi dan Delivery' hilang; koreksi terpadu + api", () => {
  const halaman = baca("../src/pages/finance/FinancePenjualanKaryawan.jsx");
  const baru = halaman.slice(halaman.indexOf("function ModalPenjualanBaruIsi"), halaman.indexOf("function ModalBayar"));
  assert.match(baru, /<FormItemPenjualan /);
  assert.match(baru, /Item Penjualan &amp; Pemenuhan/);
  assert.doesNotMatch(baru, /FormItemProduksi/);
  assert.doesNotMatch(baru, /Order untuk Produksi dan Delivery/);
  assert.doesNotMatch(baru, /Item yang dijual/);
  assert.doesNotMatch(baru, /orderCrm: bodyOrderCrmItem/);
  assert.ok(baru.includes("bodyPenjualanTerpadu(f.daftar, katalog)"));
  assert.ok(baru.includes("api.pratinjauOrderCrmPkr({ items: tb.items, orderCrm:"));
  assert.match(halaman, /<ModalKoreksiBaris/);
  assert.match(halaman, /hidden: !ac\.koreksi \|\| !terpadu\(p\)/);
  const api = baca("../src/api.js");
  assert.match(api, /pratinjauKoreksiBarisPkr:/); assert.match(api, /koreksi-baris\/pratinjau/); assert.match(api, /koreksiBarisPkr:/);
  const modal = baca("../src/features/finance/PkrKoreksiBaris.jsx");
  assert.match(modal, /api\.koreksiBarisPkr\(penjualan\.id, \{ operasi: ops, expectedRevision: revisi, alasan:/);
  assert.match(modal, /kunci\.current = kunciBaru\(\)/);
  assert.match(modal, /disabled=\{!pra\?\.valid \|\| !alasanValid\(f\.alasan\)\}/);
  assert.match(modal, /disabled=\{kunci\}/, "jumlah/kirim/hapus terkunci setelah produksi mulai; harga tidak");
  const form = baca("../src/features/finance/PkrItemPenjualanForm.jsx");
  assert.doesNotMatch(form, /PRODUKSI_BARU|SERVICE_PICKUP|AMBIL_STOK|TANPA_OPERASIONAL|KASUR_BARU|DIVAN_BOX/, "pemenuhan & kategori dari server, bukan daftar di layar");
  assert.match(form, /data-testid="item-pemenuhan"/);
  assert.match(form, /Harga satu set/);
});
