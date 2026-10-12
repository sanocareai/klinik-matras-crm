// Item produksi Penjualan Karyawan (multi-item) — aturan murni: bentuk isian kontekstual, validasi, duplikat, label, cerminan notes, kelengkapan, item virtual order lama.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BENTUK, normalisasiItem, validasiHimpunan, ukuranLabel, deskripsiUnit, kategoriOrderDariItems, perluDikirimDariItems, peringatanHimpunan, cerminanItem, bacaItemsDariNotes,
  kelengkapanItems, kelengkapanItem, itemVirtualLama, angkaCm, pilihanKirim, ItemPkrError, MAKS_UNIT_ORDER, pecahBundel, pemetaanRute,
} from "../src/lib/domain/pkrItem.js";
import { classifyProduct } from "../src/lib/domain/productionBuildTrack.js";
import { kategoriUnit, produkUnit, statusOrderEfektif, unitKategoriIn } from "../src/lib/domain/unitKategori.js";
import { bacaSpesifikasiPkr } from "../src/lib/domain/pkrSpesifikasi.js";

const KAT = {
  KASUR: { id: "k1", code: "KASUR_BARU", name: "Kasur Baru", shape: "KASUR", workKind: "BARU" },
  SERVICE: { id: "k2", code: "SERVICE_UPGRADE", name: "Service/Upgrade Kasur", shape: "SERVICE", workKind: "LAYANAN" },
  DIVAN: { id: "k3", code: "DIVAN_BOX", name: "Divan/Box", shape: "DIVAN", workKind: "BARU" },
  SANDARAN: { id: "k4", code: "SANDARAN", name: "Sandaran/Headboard", shape: "SANDARAN", workKind: "BARU" },
  SET: { id: "k5", code: "SET_LENGKAP", name: "Set Kasur Lengkap", shape: "SET", workKind: "BARU" },
  CUSTOM: { id: "k6", code: "CUSTOM_LAINNYA", name: "Produk Custom Lainnya", shape: "CUSTOM", workKind: "BARU" },
};
const item = (k, raw, no = 1, produk = null) => normalisasiItem(raw, { kategori: KAT[k], produk, no });

test("bentuk kontekstual: kasur P×L×T; divan ukuran + tipe; sandaran lebar/tinggi; custom wajib spesifikasi", () => {
  assert.deepEqual(BENTUK.KASUR.dimensi.filter((d) => d.wajib).map((d) => d.key), ["panjang", "lebar", "tebal"]);
  assert.deepEqual(BENTUK.DIVAN.dimensi.filter((d) => d.wajib).map((d) => d.key), ["panjang", "lebar"]);
  assert.equal(BENTUK.DIVAN.produk.wajib, true); assert.equal(BENTUK.DIVAN.produk.label, "Tipe divan");
  assert.deepEqual(BENTUK.SANDARAN.dimensi.filter((d) => d.wajib).map((d) => d.key), ["lebar", "tinggi"]);
  assert.equal(BENTUK.CUSTOM.spesifikasi.keras, true);
});

test("kasur: label ukuran P × L × T; kurang menyebut field yang kosong; kirim belum dipilih = kurang", () => {
  const a = item("KASUR", { jumlah: 1, panjang: "200", lebar: "160", tebal: "20", produkNama: "Kasur Sano", perluDikirim: true });
  assert.equal(a.ukuranLabel, "200 × 160 × 20 cm"); assert.deepEqual(a.kurang, []);
  const b = item("KASUR", { jumlah: 2, panjang: 200 });
  assert.deepEqual(b.kurang, ["Produk / merk", "Lebar", "Tebal", "Dikirim atau diambil sendiri"]);
  assert.equal(b.ukuranLabel, "200 cm");
});

test("divan: ukuran + tipe (produk) + tinggi opsional; sandaran: lebar × tinggi (tebal opsional)", () => {
  const d = item("DIVAN", { panjang: 200, lebar: 160, tinggi: "30", produkNama: "Divan Laci", perluDikirim: false });
  assert.equal(d.ukuranLabel, "200 × 160 cm · tinggi 30 cm"); assert.deepEqual(d.kurang, []);
  assert.deepEqual(item("DIVAN", { panjang: 200, lebar: 160, perluDikirim: true }).kurang, ["Tipe divan"]);
  const s = item("SANDARAN", { lebar: 160, tinggi: 120, perluDikirim: true });
  assert.equal(s.ukuranLabel, "lebar 160 × tinggi 120 cm"); assert.deepEqual(s.kurang, []);
  assert.deepEqual(item("SANDARAN", { lebar: 160, perluDikirim: true }).kurang, ["Tinggi"]);
  assert.throws(() => item("SANDARAN", { lebar: 160, tinggi: 120, panjang: 200 }), /Panjang tidak dipakai untuk sandaran/);
});

test("custom: spesifikasi WAJIB (galat keras, bukan sekadar kurang); dimensi opsional", () => {
  assert.throws(() => item("CUSTOM", { jumlah: 1 }), (e) => e instanceof ItemPkrError && e.code === "SPESIFIKASI_CUSTOM_WAJIB" && /Item 1/.test(e.message));
  assert.throws(() => item("CUSTOM", { spesifikasi: "abc" }), /minimal 5 karakter/);
  const c = item("CUSTOM", { spesifikasi: "Sofa bed lipat 3 posisi, kain linen", perluDikirim: true });
  assert.deepEqual(c.kurang, []); assert.equal(c.ukuranLabel, "");
});

test("angka & pilihan: koma desimal, nol/negatif/terlalu besar ditolak; kirim ya/tidak/kosong", () => {
  assert.equal(angkaCm("160,5", "Lebar"), 160.5);
  assert.equal(angkaCm("", "Lebar"), null);
  assert.throws(() => angkaCm("0", "Lebar"), /lebih dari 0/);
  assert.throws(() => angkaCm("-5", "Lebar"), /angka dalam cm/);
  assert.throws(() => angkaCm("1001", "Lebar"), /maksimal 1000/);
  assert.throws(() => angkaCm("abc", "Lebar"), /angka dalam cm/);
  assert.deepEqual([pilihanKirim("ya"), pilihanKirim(false), pilihanKirim(""), pilihanKirim(undefined)], [true, false, null, null]);
  assert.throws(() => pilihanKirim("mungkin"));
  assert.throws(() => item("KASUR", { jumlah: 0 }), /Jumlah harus bilangan bulat/);
  assert.throws(() => item("KASUR", { jumlah: 2.5 }), /Jumlah harus bilangan bulat/);
});

test("himpunan: kosong, duplikat persis (gabungkan via jumlah), batas total unit; beda satu field bukan duplikat", () => {
  assert.throws(() => validasiHimpunan([]), /minimal satu item/);
  const a = item("KASUR", { panjang: 200, lebar: 160, tebal: 20, produkNama: "Sano", perluDikirim: true }, 1);
  const salin = item("KASUR", { panjang: 200, lebar: 160, tebal: 20, produkNama: "SANO", perluDikirim: true, jumlah: 2 }, 2);
  assert.throws(() => validasiHimpunan([a, salin]), (e) => e.code === "ITEM_DUPLIKAT" && /Item 2 sama persis dengan Item 1/.test(e.message));
  const beda = item("KASUR", { panjang: 200, lebar: 180, tebal: 20, produkNama: "Sano", perluDikirim: true }, 2);
  assert.deepEqual(validasiHimpunan([a, beda]), { totalUnit: 2 });
  const besar = item("KASUR", { jumlah: MAKS_UNIT_ORDER, produkNama: "X" }, 1);
  const lagi = item("DIVAN", { jumlah: 1, produkNama: "Y" }, 2);
  assert.throws(() => validasiHimpunan([besar, lagi]), /Total jumlah unit 21 melebihi batas 20/);
});

test("turunan tingkat order: kategori (semua BARU -> BARU; semua LAYANAN -> LAYANAN; campuran -> CAMPURAN), dikirim (ada true -> true; semua false -> false; selain itu null), peringatan campuran", () => {
  const k = item("KASUR", { perluDikirim: true }, 1); const d = item("DIVAN", { perluDikirim: false, produkNama: "x" }, 2); const sv = item("SERVICE", { perluDikirim: null }, 3);
  assert.equal(kategoriOrderDariItems([k, d]), "BARU");
  assert.equal(kategoriOrderDariItems([k, sv]), "CAMPURAN"); // keputusan Owner: campuran TIDAK diubah menjadi LAYANAN
  assert.equal(kategoriOrderDariItems([sv, item("SERVICE", { perluDikirim: true }, 4)]), "LAYANAN");
  assert.equal(perluDikirimDariItems([k, d]), true);
  assert.equal(perluDikirimDariItems([d, item("SANDARAN", { perluDikirim: false }, 4)]), false);
  assert.equal(perluDikirimDariItems([d, sv]), null);
  assert.deepEqual(peringatanHimpunan([k, sv]).map((w) => w.kode), ["CAMPURAN_PER_ITEM"]);
  assert.deepEqual(peringatanHimpunan([k, d]), []);
});

test("deskripsi unit: merk = produk (atau nama kategori), ukuran = label ukuran", () => {
  assert.deepEqual(deskripsiUnit(item("DIVAN", { panjang: 200, lebar: 160, produkNama: "Divan Laci" })), { merk: "Divan Laci", ukuran: "200 × 160 cm" });
  assert.deepEqual(deskripsiUnit(item("KASUR", {})), { merk: "Kasur Baru", ukuran: null });
});

test("cerminan notes: bolak-balik tanpa kehilangan; bacaItemsDariNotes tidak pernah melempar; kelengkapan order dihitung dari item", () => {
  const items = [
    item("KASUR", { panjang: 200, lebar: 160, tebal: 20, produkNama: "Sano", perluDikirim: true }, 1),
    item("DIVAN", { panjang: 200, lebar: 160, produkNama: "Divan Laci", perluDikirim: false }, 2),
    item("SANDARAN", { lebar: 160, perluDikirim: true }, 3),
  ];
  const notes = JSON.stringify({ pkrItems: items.map(cerminanItem), pkrNomor: "PKR-1" });
  const baca = bacaItemsDariNotes(notes);
  assert.equal(baca.length, 3);
  assert.deepEqual(baca.map((i) => i.ukuranLabel), items.map((i) => i.ukuranLabel));
  assert.deepEqual(baca[2].kurang, ["Tinggi"]);
  for (const jelek of [null, "", "teks biasa", "{rusak", "[]", JSON.stringify({ pkrItems: [] }), JSON.stringify({ pkrItems: "x" })]) assert.equal(bacaItemsDariNotes(jelek), null);

  // Kelengkapan: item 3 kurang Tinggi; ada yang dikirim tanpa alamat
  const k = kelengkapanItems(baca, { alamat: null });
  assert.equal(k.lengkap, false);
  assert.deepEqual(k.kurang, ["Item 3 (Sandaran/Headboard): Tinggi", "Alamat pengiriman"]);
  assert.equal(k.perluDikirim, true);

  // bacaSpesifikasiPkr memakai item (bukan merk/ukuran lama)
  const spek = bacaSpesifikasiPkr({ notes, pkrPerluDikirim: true, deliveryAddress: "Jl. Mawar 5", deliveryCity: "Bekasi" });
  assert.equal(spek.lengkap, false); assert.deepEqual(spek.kurang, ["Item 3 (Sandaran/Headboard): Tinggi"]);
  const lengkap = JSON.stringify({ pkrItems: [...items.slice(0, 2), item("SANDARAN", { lebar: 160, tinggi: 120, perluDikirim: true }, 3)].map(cerminanItem) });
  const ok = bacaSpesifikasiPkr({ notes: lengkap, deliveryAddress: "Jl. Mawar 5" });
  assert.equal(ok.lengkap, true); assert.equal(ok.items.length, 3);
});

test("order LAMA tanpa pkrItems: aturan lama tidak berubah (merk + ukuran + dikirim + alamat)", () => {
  const lama = bacaSpesifikasiPkr({ notes: JSON.stringify({ merkKasur: "Sano", ukuranKasur: "160 x 200" }), pkrPerluDikirim: false });
  assert.equal(lama.lengkap, true); assert.equal(lama.items, undefined);
  const kosong = bacaSpesifikasiPkr({ notes: JSON.stringify({ pkrNomor: "PKR-9" }), pkrPerluDikirim: null });
  assert.deepEqual(kosong.kurang, ["Merk kasur", "Ukuran", "Dikirim atau diambil sendiri"]);
});

test("item virtual untuk order lama: Kasur Baru / Service dari kategori + merk + ukuran + jumlah unit (hanya tampilan)", () => {
  const [baru] = itemVirtualLama({ kategori: "BARU", merk: "Sano", ukuran: "160 x 200", jumlahUnit: 3, perluDikirim: true });
  assert.deepEqual([baru.kategoriCode, baru.bentuk, baru.produkNama, baru.jumlah, baru.ukuranLabel, baru.virtual], ["KASUR_BARU", "KASUR", "Sano", 3, "160 x 200", true]);
  const [svc] = itemVirtualLama({ kategori: "LAYANAN", merk: null, ukuran: null, jumlahUnit: 0, perluDikirim: null });
  assert.deepEqual([svc.kategoriCode, svc.jenisKerja, svc.jumlah], ["SERVICE_UPGRADE", "LAYANAN", 1]);
});

// ── Bundel katalog (Set Kasur Lengkap) ─────────────────────────────────────────────────────────────────
const KOMPOSISI = [
  { kategoriId: "k1", kategoriCode: "KASUR_BARU", produkId: null, qty: 1 },
  { kategoriId: "k3", kategoriCode: "DIVAN_BOX", produkId: null, qty: 1 },
  { kategoriId: "k4", kategoriCode: "SANDARAN", produkId: null, qty: 1 },
];

test("bundel: Set dipecah menjadi komponen Kasur, Divan, Sandaran sesuai komposisi; jumlah set mengalikan qty komponen", () => {
  const out = pecahBundel({ jumlah: 2, perluDikirim: true, spesifikasi: "warna abu", komponen: [
    { panjang: 200, lebar: 160, tebal: 20 }, { panjang: 200, lebar: 160, tinggi: 30, perluDikirim: false }, { lebar: 160, tinggi: 120 },
  ] }, KOMPOSISI, { nama: "Set Queen", kode: "SET_LENGKAP" });
  assert.deepEqual(out.map((o) => o.kategori), ["KASUR_BARU", "DIVAN_BOX", "SANDARAN"]);
  assert.deepEqual(out.map((o) => o.jumlah), [2, 2, 2]);
  assert.equal(out[0].perluDikirim, true); // diwarisi dari set
  assert.equal(out[1].perluDikirim, false); // komponen boleh menimpa
  assert.equal(out[2].spesifikasi, "warna abu");
  assert.ok(out.every((o) => o.__bundel.kode === "SET_LENGKAP" && o.__bundel.jumlah === 2));
});

test("bundel: komponen dihilangkan -> semua komponen kosong (order boleh dibuat, perlu dilengkapi); komposisi kosong / tak sesuai ditolak", () => {
  const out = pecahBundel({ jumlah: 1 }, KOMPOSISI, { nama: "Set", kode: "SET_LENGKAP" });
  assert.equal(out.length, 3);
  assert.ok(out.every((o) => o.panjang === undefined && o.lebar === undefined));
  assert.throws(() => pecahBundel({ jumlah: 1 }, [], { nama: "Set X" }), (e) => e.code === "BUNDEL_TANPA_KOMPOSISI" && /Katalog Item PKR/.test(e.message));
  assert.throws(() => pecahBundel({ jumlah: 1, komponen: [{}] }, KOMPOSISI), (e) => e.code === "KOMPONEN_BUNDEL_TIDAK_SESUAI");
  assert.throws(() => pecahBundel({ jumlah: 1, komponen: [{ kategori: "DIVAN_BOX" }, {}, {}] }, KOMPOSISI), (e) => e.code === "KOMPONEN_BUNDEL_TIDAK_SESUAI");
  assert.throws(() => pecahBundel({ jumlah: 0 }, KOMPOSISI), /Jumlah set/);
  assert.throws(() => pecahBundel({ jumlah: 21 }, KOMPOSISI), /Jumlah set/);
});

test("bundel: dua set identik ditolak (gabungkan lewat Jumlah set); komponen set tidak dianggap duplikat dengan item mandiri yang sama", () => {
  const set = (no, bundleNo) => ({ ...item("KASUR", { panjang: 200, lebar: 160, tebal: 20, produkNama: "Sano", perluDikirim: true }, no), bundleNo });
  assert.throws(() => validasiHimpunan([set(1, 1), set(2, 2)]), (e) => e.code === "ITEM_DUPLIKAT" && /komponen Set 2/.test(e.message) && /Jumlah pada Set/.test(e.message));
  const mandiri = item("KASUR", { panjang: 200, lebar: 160, tebal: 20, produkNama: "Sano", perluDikirim: true }, 2);
  assert.deepEqual(validasiHimpunan([set(1, 1), mandiri]), { totalUnit: 2 });
});

test("bundel: bentuk SET tidak punya ukuran sendiri (dimensi ada di komponen)", () => {
  assert.equal(BENTUK.SET.bundel, true);
  assert.deepEqual(BENTUK.SET.dimensi, []);
});

// ── Kelengkapan per item (kontekstual per kategori) ───────────────────────────────────────────────────
test("kelengkapan PER ITEM: item belum lengkap tidak menahan item lain yang lengkap; alamat hanya dituntut bila item itu dikirim", () => {
  const lengkap = item("KASUR", { panjang: 200, lebar: 160, tebal: 20, produkNama: "Sano", perluDikirim: false }, 1);
  const kurang = item("DIVAN", { panjang: 200, produkNama: "Divan Laci", perluDikirim: true }, 2);
  const diambil = item("SANDARAN", { lebar: 160, tinggi: 120, perluDikirim: false }, 3);
  const semua = [lengkap, kurang, diambil];
  assert.equal(kelengkapanItems(semua, { alamat: null }).lengkap, false); // seluruh order belum lengkap
  assert.equal(kelengkapanItem(semua, 1, { alamat: null }).lengkap, true); // kasur lengkap -> boleh dijadwalkan
  assert.equal(kelengkapanItem(semua, 3, { alamat: null }).lengkap, true);
  const d = kelengkapanItem(semua, 2, { alamat: null });
  assert.equal(d.lengkap, false);
  assert.ok(d.kurang.some((k) => /Lebar/.test(k)) && d.kurang.some((k) => /Alamat pengiriman/.test(k)));
  assert.equal(kelengkapanItem(semua, 2, { alamat: "Jl. Mawar 5" }).kurang.some((k) => /Alamat/.test(k)), false);
  assert.equal(kelengkapanItem(semua, 99, {}), null);
});

// ── Pemetaan rute Produksi ─────────────────────────────────────────────────────────────────────────────
const katR = (o = {}) => ({ code: "KASUR_BARU", name: "Kasur Baru", productLine: null, productType: null, productionServiceId: null, ...o });

test("rute: produk BARU tanpa jenis produk diblokir dengan pesan Indonesia + arah tindakan; produk menimpa kategori", () => {
  const r = pemetaanRute({ kategori: katR({ productLine: "KASUR" }), produk: { id: "p", name: "Matras Custom TP", productLine: null, productType: null, productionServiceId: null }, jenisKerja: "BARU" }, classifyProduct);
  assert.equal(r.ok, false);
  assert.equal(r.kode, "RUTE_PRODUK_BELUM_DIPETAKAN");
  assert.match(r.pesan, /produk "Matras Custom TP"/);
  assert.match(r.pesan, /Katalog Item PKR/);
  const ok = pemetaanRute({ kategori: katR({ productLine: "KASUR" }), produk: { id: "p", name: "Matras Custom TP", productLine: "KASUR", productType: "KASUR_SEHAT", productionServiceId: null }, jenisKerja: "BARU" }, classifyProduct);
  assert.equal(ok.ok, true);
  assert.equal(ok.alur, "KASUR");
  // divan: lini cukup (alur non-kasur), tanpa uji tekstur kasur
  const divan = pemetaanRute({ kategori: katR({ code: "DIVAN_BOX", name: "Divan/Box", productLine: "DIVAN", productType: "DIVAN_UTAMA" }), jenisKerja: "BARU" }, classifyProduct);
  assert.deepEqual([divan.ok, divan.alur], [true, "NON_KASUR"]);
  // jenis produk bertentangan dengan lini -> tidak dianggap jelas
  const konflik = pemetaanRute({ kategori: katR({ productLine: "DIVAN", productType: "KASUR_SEHAT" }), jenisKerja: "BARU" }, classifyProduct);
  assert.equal(konflik.ok, false);
});

test("rute: item LAYANAN butuh layanan produksi; kategori sebagai cadangan produk; tanpa keduanya diblokir", () => {
  const tanpa = pemetaanRute({ kategori: katR({ code: "SERVICE_UPGRADE", name: "Service/Upgrade Kasur" }), produk: { id: "p", name: "Full Service", productLine: null, productType: null, productionServiceId: null }, jenisKerja: "LAYANAN" }, classifyProduct);
  assert.equal(tanpa.ok, false);
  assert.equal(tanpa.kode, "RUTE_LAYANAN_BELUM_DIPETAKAN");
  const dariProduk = pemetaanRute({ kategori: katR(), produk: { id: "p", name: "Full Service", productLine: null, productType: null, productionServiceId: "svc-1" }, jenisKerja: "LAYANAN" }, classifyProduct);
  assert.deepEqual([dariProduk.ok, dariProduk.serviceId], [true, "svc-1"]);
  const dariKategori = pemetaanRute({ kategori: katR({ productionServiceId: "svc-2" }), jenisKerja: "LAYANAN" }, classifyProduct);
  assert.deepEqual([dariKategori.ok, dariKategori.serviceId], [true, "svc-2"]);
});

// ── Kategori & jenis produk efektif PER UNIT ──────────────────────────────────────────────────────────
test("unit: kolom unit menang; kosong = nilai order persis seperti perilaku lama (unit lama tidak berubah)", () => {
  const order = { category: "CAMPURAN", productLine: "KASUR", productType: null, status: "PENDING" };
  assert.equal(kategoriUnit({ workCategory: "BARU" }, order), "BARU");
  assert.equal(kategoriUnit({ workCategory: "LAYANAN" }, order), "LAYANAN");
  assert.equal(kategoriUnit({ workCategory: null }, { category: "SEWA" }), "SEWA"); // unit lama
  assert.deepEqual(produkUnit({ productLine: "DIVAN", productType: "DIVAN_UTAMA" }, order), { productLine: "DIVAN", productType: "DIVAN_UTAMA" });
  assert.deepEqual(produkUnit({ productLine: null, productType: null }, { productLine: "KASUR", productType: "KASUR_SEHAT" }), { productLine: "KASUR", productType: "KASUR_SEHAT" });
  // pasangan unit dipakai UTUH: lini divan milik unit tidak dicampur dengan jenis kasur milik order
  assert.deepEqual(produkUnit({ productLine: "DIVAN", productType: null }, { productLine: "KASUR", productType: "KASUR_SEHAT" }), { productLine: "DIVAN", productType: null });
  assert.deepEqual(unitKategoriIn(["BARU"]), { OR: [{ workCategory: { in: ["BARU"] } }, { workCategory: null, order: { category: { in: ["BARU"] } } }] });
});

test("unit: order CAMPURAN tidak menahan unit workshop (BARU) karena item service belum diambil; order lain memakai status order apa adanya", () => {
  assert.equal(statusOrderEfektif({ category: "CAMPURAN", status: "PENDING" }, { status: "RECEIVED" }), "PROCESSING");
  assert.equal(statusOrderEfektif({ category: "CAMPURAN", status: "PICKUP" }, { status: "IN_PRODUCTION" }), "PROCESSING");
  assert.equal(statusOrderEfektif({ category: "CAMPURAN", status: "PENDING" }, { status: "AWAITING_PICKUP" }), "PENDING"); // unit service tetap menunggu pickup
  assert.equal(statusOrderEfektif({ category: "CAMPURAN", status: "CANCELLED" }, { status: "RECEIVED" }), "CANCELLED");
  assert.equal(statusOrderEfektif({ category: "BARU", status: "PENDING" }, { status: "RECEIVED" }), "PENDING"); // tidak berubah untuk order biasa
  assert.equal(statusOrderEfektif({ category: "LAYANAN", status: "PROCESSING" }, { status: "RECEIVED" }), "PROCESSING");
});
