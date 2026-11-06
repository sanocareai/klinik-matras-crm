// Nilai Persediaan (redesain sederhana, Nov 2026) — logika tampilan murni + kontrak struktur. Mengunci makna: estimasi stok ≠ saldo Finance (tidak dijumlahkan), nilai tidak diketahui bukan Rp0,
// nol Owner / nol koreksi resmi / nol ledger / tanpa catatan stok / pengamatan satuan lain tetap berbeda, label "belum direkonsiliasi/diverifikasi" tidak berubah, dan jumlah unik konsisten.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { halamanDaftar } from "../src/features/warehouse/stok/stokTampilanLogic.js";
import { saringBaris, FILTER_PENGECUALIAN, FILTER_SEMUA, opsiFilter, teksDokumenHarga } from "../src/features/warehouse/nilaiPersediaan/nilaiPersediaanLogic.js";
import {
  KALIMAT_PERLU_DILENGKAPI, TEKS_BELUM_DIREKONSILIASI_SO, UKURAN_HALAMAN, bahanUnikPerluDilengkapi, chipFilterAktif, kelompokOpsiFilter, kodeFilterSah, ringkasCakupanData, ringkasKartu, statusUtama, teksHasil,
} from "../src/features/warehouse/nilaiPersediaan/nilaiTampilanLogic.js";

const baca = (f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const D = () => ({
  kartu: {
    estimasi: { nilaiLedger: 223_400_000, nilaiTanpaHasilSOBermasalah: 219_100_000, nilaiHasilSOBermasalah: 4_300_000, bahanHasilSOBermasalah: 2, bahanDinilai: 118, bahanRelevan: 379, dariPO: 1 },
    finance: { saldo: 93_090_000, status: "BELUM_DIREKONSILIASI" },
    belumDinilai: { jumlah: 4, perStatus: { STOK_BELUM_DIKETAHUI: 3, HARGA_KOSONG: 1 }, perSubStatus: { TANPA_CATATAN_STOK: 2, NOL_DIKONFIRMASI_OWNER: 1 }, catatan: "x" },
  },
  finance: { akun: { kode: "1-1400", nama: "Persediaan Bahan Baku" }, jurnal: 27, tanggalBuku: "2026-11-05" },
  cakupan: { universe: 8, saldoNol: 1, relevan: 7, dinilai: 3, pengecualian: 4, perStatus: { DINILAI: 3, SALDO_NOL: 1, STOK_BELUM_DIKETAHUI: 3, HARGA_KOSONG: 1 }, perSubStatus: { TANPA_CATATAN_STOK: 2, NOL_DIKONFIRMASI_OWNER: 1, NOL_MENURUT_PERGERAKAN: 1 }, pengecualianSatuanTerbuka: 2, hasilSOKedaluwarsa: 1 },
});
const BARIS = [
  { materialId: "a", kode: "A", nama: "A", status: "DINILAI" }, { materialId: "b", kode: "B", nama: "B", status: "STOK_BELUM_DIKETAHUI", subStatus: "TANPA_CATATAN_STOK" },
  { materialId: "c", kode: "C", nama: "C", status: "STOK_BELUM_DIKETAHUI", subStatus: "TANPA_CATATAN_STOK" }, { materialId: "d", kode: "D", nama: "D", status: "STOK_BELUM_DIKETAHUI", subStatus: "NOL_DIKONFIRMASI_OWNER", hasilSO: { kedaluwarsa: true } },
  { materialId: "e", kode: "E", nama: "E", status: "HARGA_KOSONG" }, { materialId: "f", kode: "F", nama: "F", status: "SALDO_NOL", subStatus: "NOL_MENURUT_PERGERAKAN" },
];

test("kartu: estimasi stok dan saldo Finance adalah dua angka terpisah (tidak dijumlahkan, tidak disamakan); label belum direkonsiliasi tidak berubah", () => {
  const r = ringkasKartu(D(), true);
  assert.equal(r.estimasi.nilai, "Rp223.400.000"); assert.equal(r.finance.nilai, "Rp93.090.000"); assert.notEqual(r.estimasi.nilai, r.finance.nilai);
  assert.ok(!Object.values(r.estimasi).concat(Object.values(r.finance)).some((v) => v === "Rp316.490.000"), "tidak ada angka gabungan estimasi + Finance");
  assert.equal(r.estimasi.statusRekon, "Belum direkonsiliasi dengan hasil SO"); assert.equal(TEKS_BELUM_DIREKONSILIASI_SO, "Belum direkonsiliasi dengan hasil SO");
  assert.equal(r.finance.status, "Belum direkonsiliasi"); assert.match(r.finance.kalimat, /tidak dibagi ke bahan/);
  assert.doesNotMatch(JSON.stringify(r), /terbukti|terverifikasi/i, "tidak ada klaim 'terbukti/terverifikasi'");
});

test("kartu estimasi: ledger versus setelah pengecualian, status parsial dari angka server, satu kalimat pendukung", () => {
  const e = ringkasKartu(D(), true).estimasi;
  assert.equal(e.setelahPengecualian, "Rp219.100.000"); assert.equal(e.bahanDikecualikan, 2); assert.equal(e.nilaiDikecualikan, "Rp4.300.000"); assert.equal(e.parsial, true);
  assert.equal(e.kalimat, "118 dari 379 bahan relevan dinilai · 1 memakai harga dari PO (belum tentu diterima).");
  assert.equal(ringkasKartu({ ...D(), kartu: { ...D().kartu, estimasi: { ...D().kartu.estimasi, bahanDinilai: 379, dariPO: 0, bahanHasilSOBermasalah: 0 } } }, true).estimasi.parsial, false);
  assert.equal(ringkasKartu({ ...D(), kartu: { ...D().kartu, estimasi: { ...D().kartu.estimasi, bahanDinilai: 379, dariPO: 0, bahanHasilSOBermasalah: 0 } } }, true).estimasi.nilaiDikecualikan, null);
});

test("izin nominal: tanpa finance:read semua nominal '—' (BUKAN Rp0); jumlah bahan dan status tetap tampil", () => {
  const r = ringkasKartu(D(), false);
  for (const v of [r.estimasi.nilai, r.estimasi.setelahPengecualian, r.finance.nilai]) assert.equal(v, "—");
  assert.equal(r.estimasi.nilaiDikecualikan, null); assert.equal(r.perlu.jumlah, 4); assert.match(r.estimasi.kalimat, /118 dari 379/);
  assert.doesNotMatch(JSON.stringify(r), /Rp[1-9]/, "tidak ada nominal (kalimat 'bukan Rp0' hanya penjelasan)");
});

test("perlu dilengkapi: jumlah bahan UNIK konsisten dengan baris pengecualian; kalimat tidak menyebut Rp0 sebagai nilai", () => {
  const unik = bahanUnikPerluDilengkapi([...BARIS, { ...BARIS[1] }]); // baris ganda untuk bahan yang sama dihitung sekali
  assert.equal(unik, 4); assert.equal(unik, ringkasKartu(D(), true).perlu.jumlah); assert.equal(saringBaris(BARIS, { filter: FILTER_PENGECUALIAN }).length, unik);
  assert.match(KALIMAT_PERLU_DILENGKAPI, /tidak dihitung sebagai Rp0/); assert.equal(bahanUnikPerluDilengkapi(undefined), 0);
});

test("filter: default = perlu dilengkapi; kategori lengkap dikelompokkan untuk popover; hanya filter aktif jadi chip; hitungan dari server", () => {
  const g = kelompokOpsiFilter(D().cakupan);
  assert.deepEqual(g.map((x) => x.judul), ["Tampilan", "Status", "Rincian stok belum diketahui dan nol"]);
  assert.deepEqual(g[0].opsi.map((o) => o.kode), [FILTER_PENGECUALIAN, FILTER_SEMUA]); assert.equal(g[0].opsi[0].jumlah, 4); assert.equal(g[0].opsi[1].jumlah, 8);
  const semuaKode = g.flatMap((x) => x.opsi.map((o) => o.kode)); assert.deepEqual(semuaKode.sort(), opsiFilter(D().cakupan).map((o) => o.kode).sort(), "tidak ada kategori yang hilang");
  assert.ok(["NOL_DIKONFIRMASI_OWNER", "TANPA_CATATAN_STOK", "NOL_MENURUT_PERGERAKAN", "STOK_BELUM_DIKETAHUI", "HARGA_KOSONG"].every((k) => semuaKode.includes(k)), "nol Owner, tanpa catatan, nol ledger tetap kategori berbeda");
  assert.equal(chipFilterAktif(FILTER_SEMUA, D().cakupan), null); assert.equal(chipFilterAktif(undefined, D().cakupan), null);
  assert.deepEqual(chipFilterAktif("NOL_DIKONFIRMASI_OWNER", D().cakupan), { kode: "NOL_DIKONFIRMASI_OWNER", teks: "Fisik nol dikonfirmasi Owner (dalam stok belum diketahui)", jumlah: 1 });
  assert.equal(chipFilterAktif(FILTER_PENGECUALIAN, D().cakupan).teks, "Semua pengecualian");
  assert.ok(kodeFilterSah("HARGA_KOSONG") && kodeFilterSah("NOL_DIKONFIRMASI_OWNER") && !kodeFilterSah("ASAL"));
});

test("status: SATU status utama per baris; nol Owner dibedakan dari tanpa catatan dan nol ledger; SO kedaluwarsa = tanda kecil, bukan status kedua", () => {
  assert.deepEqual(BARIS.map((b) => statusUtama(b).teks), ["Dinilai", "Tanpa catatan stok", "Tanpa catatan stok", "Fisik nol dikonfirmasi Owner", "Harga kosong", "Nol menurut pergerakan"]);
  assert.equal(statusUtama(BARIS[3]).peringatanSO, true); assert.equal(statusUtama(BARIS[0]).peringatanSO, false);
  assert.deepEqual(Object.keys(statusUtama(BARIS[0])).sort(), ["kunci", "nada", "peringatanSO", "teks"]);
  assert.notEqual(statusUtama(BARIS[3]).teks, statusUtama(BARIS[1]).teks);
});

test("cakupan data tertutup: angka penting tetap terbaca di judul (penyebut: bahan relevan; satuan terbuka; SO kedaluwarsa)", () => {
  assert.equal(ringkasCakupanData(D().cakupan), "3 dari 7 bahan dinilai · 2 pengecualian satuan terbuka · 1 catatan SO kedaluwarsa");
  assert.equal(ringkasCakupanData({ dinilai: 7, relevan: 7, pengecualianSatuanTerbuka: 0, hasilSOKedaluwarsa: 0 }), "7 dari 7 bahan dinilai"); assert.equal(ringkasCakupanData(null), "");
});

test("halaman tabel: 25 baris/halaman dari SELURUH hasil saringan; ringkasan hasil konsisten; pencarian + filter bekerja pada himpunan yang sama", () => {
  const banyak = Array.from({ length: 60 }, (_, i) => ({ materialId: `m${i}`, kode: `K${i}`, nama: `Bahan ${i}`, status: i % 3 === 0 ? "DINILAI" : "HARGA_KOSONG" }));
  const hasil = saringBaris(banyak, { filter: FILTER_PENGECUALIAN }); assert.equal(hasil.length, 40);
  const h1 = halamanDaftar(hasil, 1, UKURAN_HALAMAN); assert.equal(h1.baris.length, 25); assert.equal(h1.jumlahHalaman, 2); assert.equal(h1.total, 40);
  assert.equal(teksHasil({ total: h1.total, dari: h1.dari, sampai: h1.sampai, cari: "", chip: null }), "Menampilkan 1–25 dari 40 bahan");
  const h2 = halamanDaftar(hasil, 2, UKURAN_HALAMAN); assert.equal(h2.baris.length, 15); assert.equal(teksHasil({ total: 40, dari: h2.dari, sampai: h2.sampai }), "Menampilkan 26–40 dari 40 bahan");
  assert.equal(teksHasil({ total: 3, dari: 1, sampai: 3, cari: "roda" }), "3 bahan · cari “roda”"); assert.equal(teksHasil({ total: 0, dari: 0, sampai: 0 }), "Tidak ada bahan yang cocok");
  assert.deepEqual(halamanDaftar(hasil, 99, UKURAN_HALAMAN).halaman, 2, "nomor halaman di luar batas dijepit");
});

test("sumber harga: dokumen selalu 'belum diverifikasi' dan dijelaskan sebagai jejak penelusuran (bukan bukti perolehan)", () => {
  assert.equal(teksDokumenHarga({ dokumen: { teks: "PO-1" } }), "Dokumen: PO-1 · belum diverifikasi");
  const drawer = baca("features/warehouse/nilaiPersediaan/DrawerBahan.jsx"); assert.match(drawer, /jejak penelusuran, bukan bukti biaya perolehan/); assert.match(drawer, /teksDokumenHarga/);
});

test("struktur: halaman baru memakai komponen bersama (FilterPopover, FokusOverlay tempel, info-toggle), ikon info = tombol (klik/keyboard/sentuh), tanpa tindakan tulis di halaman", () => {
  const page = baca("pages/warehouse/WarehouseNilaiPersediaan.jsx"); const kartu = baca("features/warehouse/nilaiPersediaan/KartuNilai.jsx"); const tabel = baca("features/warehouse/nilaiPersediaan/TabelBahan.jsx"); const drawer = baca("features/warehouse/nilaiPersediaan/DrawerBahan.jsx");
  assert.match(tabel, /FilterPopover/); assert.match(drawer, /FokusOverlay/); assert.match(drawer, /\btempel\b/); assert.match(kartu, /InfoToggleButton/); assert.match(page, /InfoToggleButton/);
  const info = baca("components/ui/info-toggle.jsx"); assert.match(info, /<button type="button" onClick=\{info\.toggle\} aria-expanded/); assert.doesNotMatch(info, /onMouseEnter|onMouseOver|hover:block/, "tidak bergantung pada hover");
  assert.ok(!/method:\s*"(POST|PUT|PATCH|DELETE)"/.test(page + kartu + tabel) && !/api\.catatHasilSO/.test(page + kartu + tabel + drawer), "penulisan hanya lewat formulir CatatHasilSOModal");
  assert.match(drawer, /CatatHasilSOModal/); assert.match(drawer, /bisaCatat/);
  assert.match(page, /api\.getNilaiPersediaan\(\)/); assert.match(drawer, /api\.getRiwayatHasilSO/);
  for (const k of ["np-k1", "np-k2", "np-k3", "np-cakupan", "np-tabel", "np-baris", "np-cari", "np-catat", "np-riwayat"]) assert.ok((page + kartu + tabel + drawer + baca("features/warehouse/nilaiPersediaan/CakupanData.jsx")).includes(k), k);
  assert.match(tabel, /max-sm|data-label/); assert.match(baca("styles/sanss-gudang-nilai.css"), /@container nip \(max-width: 700px\)/, "tabel jadi kartu menurut lebar kolom");
});

test("cakupan: tiga cakupan dengan penyebut masing-masing tetap terpisah dan definisi panjang ada di bagian terlipat", () => {
  const cak = baca("features/warehouse/nilaiPersediaan/CakupanData.jsx"); const bawah = baca("features/warehouse/nilaiPersediaan/BagianBawah.jsx");
  assert.match(cak, /<details/); assert.match(cak, /kalimatCakupan/); assert.match(cak, /kalimatKuantitas/); assert.match(cak, /kalimatHarga/); assert.match(cak, /kalimatNolOwner/);
  assert.match(cak, /TEKS_DOKUMEN_BUKAN_BUKTI/); assert.match(bawah, /<details/); assert.match(bawah, /Definisi dan sumber angka/); assert.match(bawah, /np-izin-nominal/);
});

test("CSS: terkunci ke .nip/.nipd/.nipf; tidak menyentuh sidebar/tema global; kelas .nip- tidak dipakai berkas CSS lain", () => {
  const css = baca("styles/sanss-gudang-nilai.css");
  for (const baris of css.split("\n")) { const t = baris.trim(); if (/^\.[a-z]/.test(t) && !/^\.(nip|nipd|nipf)/.test(t)) assert.fail(`selektor di luar lingkup halaman: ${t.slice(0, 60)}`); }
  assert.doesNotMatch(css, /\.sidebar|\.topbar|\.app-shell\s*\{|:root\s*\{/);
  for (const f of fs.readdirSync(new URL("../src/styles/", import.meta.url)).filter((x) => x.endsWith(".css") && x !== "sanss-gudang-nilai.css")) assert.ok(!/\.nip-/.test(baca(`styles/${f}`)), `${f} memakai prefiks nip-`);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("izin nominal: kalimat server yang memuat Rupiah bukan-nol disembunyikan tanpa finance:read (Rp0 tetap); dengan izin tidak diubah", async () => {
  const { topengNominal, TEKS_NOMINAL_DISEMBUNYIKAN } = await import("../src/features/warehouse/nilaiPersediaan/nilaiTampilanLogic.js");
  const k = "Saldo akun berbeda Rp9.272.777,04 dari jumlah biaya penerimaan berharga di ledger stok.";
  assert.equal(topengNominal(k, true), k);
  const t = topengNominal(k, false); assert.ok(!/Rp9/.test(t)); assert.ok(t.includes(TEKS_NOMINAL_DISEMBUNYIKAN)); assert.match(t, /dari jumlah biaya penerimaan berharga/);
  assert.equal(topengNominal("tidak dinilai (bukan Rp0).", false), "tidak dinilai (bukan Rp0).", "Rp0 = pernyataan nol, bukan nominal");
  assert.equal(topengNominal("Rp1.000 dan Rp20", false), `${TEKS_NOMINAL_DISEMBUNYIKAN} dan ${TEKS_NOMINAL_DISEMBUNYIKAN}`); assert.equal(topengNominal(null, false), "");
  const bawah = fs.readFileSync(new URL("../src/features/warehouse/nilaiPersediaan/BagianBawah.jsx", import.meta.url), "utf8"); assert.match(bawah, /topengNominal\(a, nominal\)/);
});
