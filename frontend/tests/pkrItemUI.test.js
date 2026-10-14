// Form item produksi Penjualan Karyawan (multi-item): logika murni + pemasangan di layar. Definisi kategori/bentuk datang dari SERVER (katalog) — tidak ada daftar di frontend.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  itemBaru, orderCrmItemKosong, bentukItem, produkKategori, ubahKategoriItem, galatItems, bodyOrderCrmItem, formLengkapiDariSinkron, bodyLengkapiItem, galatLengkapiItem,
  totalUnitItems, adaItemDikirim, ringkasItemsTeks, KIRIM_ITEM_OPSI,
} from "../src/features/finance/pkrItemLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

// Katalog seperti respons GET katalog-item (bentuk dikirim server).
const dim = (key, label, wajib) => ({ key, label, satuan: "cm", wajib });
const KATALOG = {
  bentuk: {
    KASUR: { label: "Kasur", produk: { label: "Produk / merk", wajib: true }, dimensi: [dim("panjang", "Panjang", true), dim("lebar", "Lebar", true), dim("tebal", "Tebal", true)], spesifikasi: { label: "Spesifikasi / catatan", keras: false } },
    DIVAN: { label: "Divan / box", produk: { label: "Tipe divan", wajib: true }, dimensi: [dim("panjang", "Panjang", true), dim("lebar", "Lebar", true), dim("tinggi", "Tinggi", false)], spesifikasi: { label: "Spesifikasi / catatan", keras: false } },
    SANDARAN: { label: "Sandaran", produk: { label: "Model", wajib: false }, dimensi: [dim("lebar", "Lebar", true), dim("tinggi", "Tinggi", true), dim("tebal", "Tebal", false)], spesifikasi: { label: "Spesifikasi / catatan", keras: false } },
    CUSTOM: { label: "Produk custom", produk: { label: "Nama produk", wajib: false }, dimensi: [dim("panjang", "Panjang", false), dim("lebar", "Lebar", false)], spesifikasi: { label: "Spesifikasi produk custom", keras: true } },
  },
  kategori: [
    { id: "k1", kode: "KASUR_BARU", nama: "Kasur Baru", bentuk: "KASUR", jenisKerja: "BARU", aktif: true, produk: [{ id: "p1", kode: "PRD_A", nama: "Matras Custom T20" }] },
    { id: "k2", kode: "DIVAN_BOX", nama: "Divan/Box", bentuk: "DIVAN", jenisKerja: "BARU", aktif: true, produk: [] },
    { id: "k3", kode: "SANDARAN", nama: "Sandaran/Headboard", bentuk: "SANDARAN", jenisKerja: "BARU", aktif: true, produk: [] },
    { id: "k4", kode: "CUSTOM_LAINNYA", nama: "Produk Custom Lainnya", bentuk: "CUSTOM", jenisKerja: "BARU", aktif: true, produk: [] },
  ],
};

test("field kontekstual mengikuti bentuk dari server; ganti kategori mengosongkan field yang tidak dipakai dan mereset produk", () => {
  const k = { ...itemBaru("KASUR_BARU"), produkId: "p1", panjang: "200", lebar: "160", tebal: "20" };
  assert.deepEqual(bentukItem(KATALOG, k).dimensi.map((d) => d.key), ["panjang", "lebar", "tebal"]);
  assert.deepEqual(produkKategori(KATALOG, k).map((p) => p.nama), ["Matras Custom T20"]);
  const jadiSandaran = ubahKategoriItem(KATALOG, k, "SANDARAN");
  assert.equal(jadiSandaran.kategori, "SANDARAN");
  assert.equal(jadiSandaran.produkId, ""); assert.equal(jadiSandaran.panjang, "", "panjang tidak dipakai sandaran"); assert.equal(jadiSandaran.lebar, "160", "lebar tetap relevan");
  assert.deepEqual(bentukItem(KATALOG, itemBaru("")), null);
});

test("body pembuatan: hanya field relevan; alamat hanya bila ada item yang dikirim; kategori & jumlah ikut", () => {
  const f = {
    ...orderCrmItemKosong(), alamat: " Jl. Mawar 5 ", kota: "Bekasi", tanggalKirim: "",
    items: [
      { ...itemBaru("KASUR_BARU"), produkNama: "Kasur Sano", jumlah: "2", panjang: "200", lebar: "160,5", tebal: "20", tinggi: "99", kirim: "ya", spesifikasi: " pegas " },
      { ...itemBaru("SANDARAN"), lebar: "160", tinggi: "120", kirim: "tidak" },
    ],
  };
  const b = bodyOrderCrmItem(f, KATALOG);
  assert.deepEqual(b.items[0], { kategori: "KASUR_BARU", jumlah: 2, produkNama: "Kasur Sano", panjang: "200", lebar: "160.5", tebal: "20", spesifikasi: "pegas", perluDikirim: true }, "tinggi dibuang (bukan field kasur)");
  assert.deepEqual(b.items[1], { kategori: "SANDARAN", jumlah: 1, lebar: "160", tinggi: "120", perluDikirim: false });
  assert.equal(b.alamat, "Jl. Mawar 5"); assert.equal(b.kota, "Bekasi");
  const semuaAmbil = bodyOrderCrmItem({ ...f, items: f.items.map((i) => ({ ...i, kirim: "tidak" })) }, KATALOG);
  assert.equal(semuaAmbil.alamat, undefined, "tanpa item dikirim = tanpa alamat");
  const belum = bodyOrderCrmItem({ ...f, items: [itemBaru("KASUR_BARU")] }, KATALOG);
  assert.deepEqual(belum.items[0], { kategori: "KASUR_BARU", jumlah: 1 }, "belum ditentukan = tanpa perluDikirim (server menilai 'Perlu dilengkapi')");
});

test("galat ringan: kategori, jumlah 1–200, angka cm, total unit, custom wajib spesifikasi; kekurangan data bukan galat", () => {
  assert.match(galatItems([], KATALOG), /minimal satu item/);
  assert.match(galatItems([itemBaru("")], KATALOG), /Item 1: pilih kategori/);
  assert.match(galatItems([{ ...itemBaru("KASUR_BARU"), jumlah: "0" }], KATALOG), /1–200/);
  assert.match(galatItems([{ ...itemBaru("KASUR_BARU"), jumlah: "1.5" }], KATALOG), /1–200/);
  assert.match(galatItems([{ ...itemBaru("KASUR_BARU"), panjang: "abc" }], KATALOG), /Panjang harus berupa angka dalam cm/);
  assert.match(galatItems([{ ...itemBaru("KASUR_BARU"), jumlah: "200" }, { ...itemBaru("SANDARAN"), jumlah: "1" }], KATALOG), /melebihi batas 200/);
  assert.match(galatItems([itemBaru("CUSTOM_LAINNYA")], KATALOG), /wajib diisi spesifikasi/);
  assert.equal(galatItems([{ ...itemBaru("CUSTOM_LAINNYA"), spesifikasi: "Sofa bed lipat 3 posisi" }], KATALOG), null);
  assert.equal(galatItems([itemBaru("KASUR_BARU"), itemBaru("DIVAN_BOX")], KATALOG), null, "kosong tapi sah: order 'Perlu dilengkapi'");
  assert.equal(totalUnitItems([{ jumlah: "2" }, { jumlah: "3" }]), 5);
  assert.equal(adaItemDikirim([{ kirim: "" }, { kirim: "ya" }]), true);
  assert.deepEqual(KIRIM_ITEM_OPSI.map((o) => o.label), ["— belum ditentukan —", "Dikirim", "Diambil sendiri"]);
});

test("lengkapi: form dari ringkasan server (kategori & jumlah terkunci), body per nomor item tanpa kategori/jumlah, kolom dikosongkan dikirim kosong", () => {
  const sinkron = {
    order: { modeItem: true, spesifikasi: { alamat: "Jl. A", kota: "Bekasi" } },
    items: [
      { no: 1, kategori: "KASUR_BARU", kategoriNama: "Kasur Baru", jumlah: 2, produkId: "p1", produk: "Matras Custom T20", panjang: 200, lebar: 160, tebal: null, tinggi: null, spesifikasi: "pegas", perluDikirim: true, unit: [{ status: "RECEIVED" }] },
      { no: 2, kategori: "DIVAN_BOX", kategoriNama: "Divan/Box", jumlah: 1, produkId: null, produk: "Divan Laci", panjang: 200, lebar: 160, tebal: null, tinggi: null, spesifikasi: null, perluDikirim: null, unit: [{ status: "IN_PRODUCTION" }] },
    ],
  };
  const f = formLengkapiDariSinkron(sinkron);
  assert.deepEqual(f.items.map((i) => [i.no, i.kategori, i.jumlah, i.kirim, i.unitTerkunci]), [[1, "KASUR_BARU", "2", "ya", false], [2, "DIVAN_BOX", "1", "", true]]);
  assert.equal(f.alamat, "Jl. A");
  const ubah = { ...f, items: [{ ...f.items[0], tebal: "20", spesifikasi: "" }, f.items[1]] };
  const b = bodyLengkapiItem(ubah, KATALOG);
  assert.deepEqual(b.items[0], { no: 1, spesifikasi: "", produkId: "p1", panjang: "200", lebar: "160", tebal: "20", perluDikirim: true });
  assert.equal("kategori" in b.items[0], false); assert.equal("jumlah" in b.items[0], false);
  assert.deepEqual(b.items[1], { no: 2, spesifikasi: "", produkId: "", produkNama: "Divan Laci", panjang: "200", lebar: "160", tinggi: "", perluDikirim: null });
  assert.equal(galatLengkapiItem(ubah, KATALOG), null);
  assert.match(galatLengkapiItem({ items: [{ ...f.items[0], panjang: "x" }] }, KATALOG), /Item 1: Panjang/);
  assert.equal(ringkasItemsTeks([{ produk: "Kasur Sano", jumlah: 2 }, { kategoriNama: "Divan/Box", jumlah: 1 }]), "Kasur Sano ×2 · Divan/Box");
});

test("pemasangan: halaman PKR memakai daftar item + langkah pratinjau; katalog dibaca dari server; tab Admin; rujukan Produksi memuat item", () => {
  const fin = baca("../src/pages/finance/FinancePenjualanKaryawan.jsx");
  // Daftar terpadu: tidak ada lagi bagian "Order untuk Produksi dan Delivery" terpisah — satu daftar Item Penjualan & Pemenuhan.
  assert.match(fin, /Item Penjualan &amp; Pemenuhan/);
  assert.match(fin, /<FormItemPenjualan katalog=\{katalog\}/);
  assert.ok(fin.includes("bodyPenjualanTerpadu(f.daftar, katalog)"));
  assert.match(fin, /api\.pratinjauOrderCrmPkr\(/);
  assert.match(fin, /data-testid="tinjau-order"/);
  assert.match(fin, /<PratinjauOrderPkr data=\{pra\} \/>/);
  assert.ok(fin.includes("disabled={!semuaValid || !pra?.valid}"), "Catat Penjualan hanya setelah pratinjau valid");
  const form = baca("../src/features/finance/PkrItemForm.jsx");
  assert.match(form, /Tambah Item Produksi/);
  assert.match(form, /katalog\.bentuk|bentukItem\(katalog/);
  assert.doesNotMatch(form, /KASUR_BARU|DIVAN_BOX|SANDARAN|SET_LENGKAP/, "tidak ada daftar kategori hardcoded di komponen");
  const logic = baca("../src/features/finance/pkrItemLogic.js");
  assert.doesNotMatch(logic.replace(/\/\/.*$/gm, ""), /"KASUR_BARU"|"DIVAN_BOX"/, "logika tidak memuat kode kategori");
  const api = baca("../src/api.js");
  for (const fn of ["getPkrKatalogItem", "getPkrKatalogKelola", "pratinjauOrderCrmPkr", "buatKategoriPkr", "ubahKategoriPkr", "buatProdukPkr", "ubahProdukPkr"]) assert.match(api, new RegExp(`${fn}:`));
  assert.match(api, /penjualan-karyawan\/order-crm\/pratinjau/);
  const set = baca("../src/pages/bengkel/ProductionSettings.jsx");
  assert.match(set, /"katalog-item": \(\) => <PkrKatalogItem \/>/);
  assert.match(baca("../src/features/production/PkrRujukan.jsx"), /data-testid="pkr-item"/);
  assert.match(baca("../src/features/finance/PkrOrderCrm.jsx"), /Kembali ubah/);
});

// ── Bundel (Set Kasur Lengkap), Koreksi Item, Delivery sebagian ────────────────────────────────────────
import {
  itemBundel, komposisiItem, sinkronKomponen, formKoreksiDariSinkron, operasiKoreksi, galatKoreksi, totalUnitKoreksi, alasanValid,
} from "../src/features/finance/pkrItemLogic.js";

const KOMPOSISI = [
  { id: "c1", urutan: 10, jumlah: 1, kategoriId: "k1", kategoriKode: "KASUR_BARU", kategoriNama: "Kasur Baru", bentuk: "KASUR", produkId: null, produkNama: null },
  { id: "c2", urutan: 20, jumlah: 1, kategoriId: "k2", kategoriKode: "DIVAN_BOX", kategoriNama: "Divan/Box", bentuk: "DIVAN", produkId: null, produkNama: null },
  { id: "c3", urutan: 30, jumlah: 1, kategoriId: "k3", kategoriKode: "SANDARAN", kategoriNama: "Sandaran/Headboard", bentuk: "SANDARAN", produkId: null, produkNama: null },
];
const KATALOG_SET = {
  ...KATALOG,
  bentuk: { ...KATALOG.bentuk, SET: { label: "Set kasur lengkap (bundel)", produk: { label: "Paket / set", wajib: false }, bundel: true, dimensi: [], spesifikasi: { label: "Catatan set", keras: false } } },
  kategori: [
    ...KATALOG.kategori.map((k) => ({ ...k, komposisi: [] })),
    { id: "k9", kode: "SET_LENGKAP", nama: "Set Kasur Lengkap", bentuk: "SET", jenisKerja: "BARU", aktif: true, bundel: true, komposisi: KOMPOSISI, produk: [{ id: "ps", kode: "SET_HEMAT", nama: "Set Hemat", komposisi: KOMPOSISI.slice(0, 2) }] },
  ],
};

test("bundel: komponen mengikuti komposisi katalog (produk set menimpa kategori); body mengirim satu isian per komponen; unit = jumlah set × komponen", () => {
  let it = ubahKategoriItem(KATALOG_SET, itemBaru(), "SET_LENGKAP");
  assert.equal(itemBundel(KATALOG_SET, it), true);
  assert.deepEqual(it.komponen.map((k) => k.kategoriKode), ["KASUR_BARU", "DIVAN_BOX", "SANDARAN"]);
  assert.equal(komposisiItem(KATALOG_SET, it).length, 3);
  // pilih varian "Set Hemat" -> komposisi 2 komponen; isian yang ada dipertahankan menurut kategori komponen
  it = { ...it, komponen: it.komponen.map((k, n) => (n === 0 ? { ...k, panjang: "200", lebar: "160", tebal: "20" } : k)), jumlah: "2", kirim: "ya" };
  const hemat = sinkronKomponen(KATALOG_SET, { ...it, produkId: "ps" });
  assert.deepEqual(hemat.komponen.map((k) => k.kategoriKode), ["KASUR_BARU", "DIVAN_BOX"]);
  assert.equal(hemat.komponen[0].panjang, "200");
  assert.equal(totalUnitItems([it], KATALOG_SET), 6); // 2 set × 3 komponen
  assert.equal(totalUnitItems([it]), 2, "tanpa katalog dihitung apa adanya (kompatibel)");
  const b = bodyOrderCrmItem({ items: [it], alamat: "Jl. A", kota: "", tanggalKirim: "" }, KATALOG_SET);
  assert.equal(b.items[0].kategori, "SET_LENGKAP");
  assert.equal(b.items[0].jumlah, 2); assert.equal(b.items[0].perluDikirim, true);
  assert.deepEqual(b.items[0].komponen.map((k) => k.kategori), ["KASUR_BARU", "DIVAN_BOX", "SANDARAN"]);
  assert.deepEqual(b.items[0].komponen[0], { kategori: "KASUR_BARU", panjang: "200", lebar: "160", tebal: "20" });
  assert.equal(b.alamat, "Jl. A", "ada komponen yang dikirim (ikut Set)");
  assert.equal(adaItemDikirim([it], KATALOG_SET), true);
  assert.equal(adaItemDikirim([{ ...it, kirim: "tidak" }], KATALOG_SET), false);
  assert.equal(adaItemDikirim([{ ...it, kirim: "tidak", komponen: it.komponen.map((k, n) => (n === 1 ? { ...k, kirim: "ya" } : k)) }], KATALOG_SET), true, "komponen boleh menimpa pilihan set");
});

test("bundel: galat ringan per komponen (angka cm), komposisi kosong menahan; total unit memperhitungkan komponen", () => {
  const it = ubahKategoriItem(KATALOG_SET, itemBaru(), "SET_LENGKAP");
  assert.equal(galatItems([it], KATALOG_SET), null, "kekurangan data bukan galat");
  const salah = { ...it, komponen: it.komponen.map((k, n) => (n === 1 ? { ...k, panjang: "abc" } : k)) };
  assert.match(galatItems([salah], KATALOG_SET), /Item 1 · Divan\/Box: Panjang/);
  const tanpaKomposisi = { ...KATALOG_SET, kategori: KATALOG_SET.kategori.map((k) => (k.kode === "SET_LENGKAP" ? { ...k, komposisi: [], produk: [] } : k)) };
  assert.match(galatItems([ubahKategoriItem(tanpaKomposisi, itemBaru(), "SET_LENGKAP")], tanpaKomposisi), /belum punya komposisi/);
  assert.match(galatItems([{ ...it, jumlah: "67" }], KATALOG_SET), /Total jumlah unit 201 melebihi batas 200/);
});

const SINKRON_KOREKSI = {
  order: { modeItem: true, revisi: 3, spesifikasi: { alamat: "Jl. A", kota: "Bekasi" } },
  items: [
    { no: 1, kategori: "KASUR_BARU", kategoriNama: "Kasur Baru", jumlah: 1, produkId: null, produk: "Sano", panjang: 200, lebar: 160, tebal: 20, tinggi: null, spesifikasi: "pegas", perluDikirim: true, unit: [{ status: "RECEIVED" }] },
    { no: 2, kategori: "DIVAN_BOX", kategoriNama: "Divan/Box", jumlah: 1, produkId: null, produk: "Divan Laci", panjang: 200, lebar: 160, tebal: null, tinggi: 30, spesifikasi: null, perluDikirim: false, unit: [{ status: "RECEIVED" }], bundel: { no: 1 } },
  ],
};

test("koreksi: form dari ringkasan server; operasi hanya berisi yang berubah (ubah/hapus/tambah); revisi dari server; galat ringan", () => {
  const f = formKoreksiDariSinkron(SINKRON_KOREKSI);
  assert.equal(f.revisi, 3);
  assert.deepEqual(f.items.map((i) => [i.no, i.jumlah, i.hapus]), [[1, "1", false], [2, "1", false]]);
  assert.equal(f.items[1].bundel.no, 1);
  assert.equal(galatKoreksi(f, KATALOG), "Belum ada perubahan");
  assert.deepEqual(operasiKoreksi(f, KATALOG), []);

  const g = {
    ...f,
    items: [{ ...f.items[0], jumlah: "2", panjang: "210" }, { ...f.items[1], hapus: true }],
    baru: [{ ...itemBaru("SANDARAN"), lebar: "160", tinggi: "120", kirim: "ya" }],
  };
  assert.deepEqual(operasiKoreksi(g, KATALOG), [
    { op: "ubah", no: 1, panjang: "210", jumlah: 2 },
    { op: "hapus", no: 2 },
    { op: "tambah", item: { kategori: "SANDARAN", jumlah: 1, lebar: "160", tinggi: "120", perluDikirim: true } },
  ]);
  assert.equal(galatKoreksi(g, KATALOG), null);
  assert.equal(totalUnitKoreksi(g, KATALOG), 3, "kasur ×2 + sandaran ×1 (divan dihapus)");
  assert.match(galatKoreksi({ ...g, items: [{ ...g.items[0], jumlah: "0" }, g.items[1]] }, KATALOG), /Item 1: jumlah/);
  assert.match(galatKoreksi({ ...g, items: [{ ...g.items[0], jumlah: "199" }, g.items[1]], baru: [{ ...g.baru[0], jumlah: "5" }] }, KATALOG), /melebihi batas 200/);
  // kirim -> diambil sendiri, spesifikasi dikosongkan
  const h = { ...f, items: [{ ...f.items[0], kirim: "tidak", spesifikasi: "" }, f.items[1]] };
  assert.deepEqual(operasiKoreksi(h, KATALOG), [{ op: "ubah", no: 1, spesifikasi: "", perluDikirim: false }]);
  assert.equal(alasanValid("  x "), false); assert.equal(alasanValid("Pembeli menambah sandaran"), true);
});

test("pemasangan: Koreksi item (modal, pratinjau dampak, alasan, Idempotency-Key), kirim sebagian di Delivery, komposisi + pemetaan rute di katalog Admin; tanpa daftar kategori hardcoded", () => {
  const modal = baca("../src/features/finance/PkrKoreksiItem.jsx");
  assert.match(modal, /api\.pratinjauKoreksiItemPkr\(/);
  assert.match(modal, /api\.koreksiItemPkr\(penjualan\.id, \{ operasi: ops, expectedRevision: revisi, alasan:/);
  assert.match(modal, /data-testid="koreksi-alasan"/);
  assert.match(modal, /disabled=\{!pra\?\.valid \|\| !alasanValid\(f\.alasan\)\}/, "Terapkan hanya setelah pratinjau valid + alasan");
  assert.match(modal, /kunci\.current = kunciBaru\(\)/, "satu Idempotency-Key per niat koreksi");
  assert.match(baca("../src/features/finance/PkrPratinjau.jsx"), /export function PratinjauKoreksi/);
  assert.match(baca("../src/pages/finance/FinancePenjualanKaryawan.jsx"), /Koreksi item order/);
  const api = baca("../src/api.js");
  for (const fn of ["pratinjauKoreksiItemPkr", "koreksiItemPkr", "simpanKomposisiPkr", "kirimSebagianPkr", "getPkrPengirimanMenunggu", "getPkrPengirimanOrder"]) assert.match(api, new RegExp(`${fn}:`));
  assert.match(api, /koreksi-item\/pratinjau/);
  assert.match(api, /pkr-pengiriman\/\$\{orderId\}\/kirim-sebagian/);
  const panel = baca("../src/features/armada/components/PkrPengirimanPanel.jsx");
  assert.match(panel, /api\.kirimSebagianPkr\(orderId, \{ unitIds: pilih, alasan: alasan\.trim\(\) \}, kunci\.current\)/);
  assert.match(panel, /Tidak ada job lain yang dibuat otomatis/);
  assert.match(baca("../src/pages/armada/ArmadaJobs.jsx"), /<PkrPengirimanPanel \/>/);
  const katalog = baca("../src/pages/bengkel/PkrKatalogItem.jsx");
  assert.match(katalog, /api\.simpanKomposisiPkr\(/);
  assert.match(katalog, /Rute belum dipetakan/);
  assert.match(katalog, /data-testid="belum-dipetakan"/);
  const form = baca("../src/features/finance/PkrItemForm.jsx");
  assert.doesNotMatch(form, /KASUR_BARU|DIVAN_BOX|SANDARAN|SET_LENGKAP/);
  assert.match(form, /data-testid="komponen-set"/);
  assert.match(form, /koreksi = mode === "koreksi"/);
});

test("Delivery setelah pengiriman sebagian: baris menampilkan unit SISA + aksi eksplisit berikutnya; aksi nonaktif bila sisa belum siap", async () => {
  const { ringkasBarisPengiriman } = await import("../src/features/armada/pkrPengirimanLogic.js");
  // Setelah kirim sebagian pertama: 2 unit di job, 1 sisa belum siap
  const menunggu = ringkasBarisPengiriman({
    ringkas: { dikirim: 3, siap: 2, menunggu: 1, sudahDalamJob: 2, sisa: 1 },
    sisa: [{ id: "u3", unitCode: "MIX-01-U3", siap: false }], bisaKirimSebagian: false,
  });
  assert.equal(menunggu.sudahDalamJob, 2);
  assert.equal(menunggu.teksSisa, "Sisa unit: MIX-01-U3 (belum siap)");
  assert.equal(menunggu.labelAksi, "Kirim sisa…");
  assert.equal(menunggu.aksiAktif, false);
  // Sisa sudah siap: aksi eksplisit aktif
  const siap = ringkasBarisPengiriman({
    ringkas: { dikirim: 3, siap: 3, menunggu: 0, sudahDalamJob: 2, sisa: 1 },
    sisa: [{ id: "u3", unitCode: "MIX-01-U3", siap: true }], bisaKirimSebagian: true,
  });
  assert.equal(siap.teksSisa, "Sisa unit: MIX-01-U3 (siap kirim)");
  assert.equal(siap.aksiAktif, true);
  // Belum ada job sama sekali (sebagian siap): label awal "Kirim sebagian…"
  const awal = ringkasBarisPengiriman({ ringkas: { dikirim: 3, siap: 2, menunggu: 1, sudahDalamJob: 0, sisa: 3 }, sisa: [{ unitCode: "A", siap: true }, { unitCode: "B", siap: true }, { unitCode: "C", siap: false }], bisaKirimSebagian: true });
  assert.equal(awal.labelAksi, "Kirim sebagian…");
  assert.equal(awal.aksiAktif, true);
  // Respons kosong/tak lengkap tidak melempar
  assert.deepEqual(ringkasBarisPengiriman({}).sisa, []);
  assert.equal(ringkasBarisPengiriman({}).aksiAktif, false);

  // Pemasangan: panel memakai logika ini; aksi hanya dari tombol (tidak ada pemanggilan kirim di efek)
  const panel = baca("../src/features/armada/components/PkrPengirimanPanel.jsx");
  assert.match(panel, /ringkasBarisPengiriman\(o\)/);
  assert.match(panel, /data-testid="pkr-menunggu-sisa"/);
  assert.match(panel, /disabled=\{!r\.aksiAktif\}/);
  assert.doesNotMatch(panel, /useEffect\(\(\) => \{[^}]*kirimSebagianPkr/);
});
