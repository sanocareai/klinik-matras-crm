// TABEL PEMAKAIAN AKTUAL terpadu (drawer Order Produksi + tab Bahan): satu tabel untuk tiga sumber, dampak singkat per baris, Edit per baris; Riwayat/rencana/detail tertutup bawaan; tanpa blok kosong.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DAMPAK, LABEL_JENIS_PEMAKAIAN, barisTabelPemakaian } from "../src/features/production/bahan/bahanModel.js";
import { PILIHAN_SUMBER } from "../src/features/production/bahan/perubahanModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");

const data = (o = {}) => ({
  perbandingan: [
    { materialId: "m1", nama: "Busa Rebonded", kode: "BUSA-1", aktual: 3, rencana: 2, satuan: "SHEET" },
    { materialId: "m2", nama: "Benang", kode: "BNG-1", aktual: 0, rencana: 1, satuan: "ROLL" }, // dikembalikan penuh / hanya rencana: bukan baris tabel
    { materialId: "m3", nama: "Lem", kode: "LEM-1", aktual: 1.5, rencana: null, satuan: "LITER" },
  ],
  pemakaianAktual: { baris: [{ materialId: "m3", hppOperasional: { status: "TANPA_HARGA" } }, { materialId: "m1", hppOperasional: { status: "DINILAI" } }] },
  pemakaianSementara: { items: [
    { id: "s1", name: "Kain Baru", qty: 2, uom: "METER", status: "PERLU_REKONSILIASI", statusLabel: "Perlu rekonsiliasi Gudang", originNote: "Sisa potongan", tertautKatalog: false },
    { id: "s2", name: "Pegas X", qty: 4, uom: "PCS", status: "DIREKONSILIASI", statusLabel: "Sudah direkonsiliasi", tertautKatalog: true, bahanKatalog: { kode: "PGS-X" } },
    { id: "s3", name: "Dibatalkan", qty: 1, uom: "PCS", status: "DIBATALKAN" },
  ] },
  komponenLama: { items: [{ itemId: "k1", name: "Per spiral lama", qty: 6, uom: "PCS", outcome: "REUSED", outcomeLabel: "Dipakai kembali pada unit ini" }], dibatalkan: [{ itemId: "k2" }] },
  ...o,
});

test("baris tabel: tiga sumber dalam satu tabel; baris nol/dibatalkan tidak tampil; urutan Gudang → belum tercatat → komponen lama; angka apa adanya", () => {
  const r = barisTabelPemakaian(data());
  assert.deepEqual(r.map((x) => [x.jenis, x.nama, x.qty, x.satuan]), [["gudang", "Busa Rebonded", 3, "SHEET"], ["gudang", "Lem", 1.5, "LITER"], ["sementara", "Kain Baru", 2, "METER"], ["sementara", "Pegas X", 4, "PCS"], ["lama", "Per spiral lama", 6, "PCS"]]);
  assert.equal(r.find((x) => x.nama === "Busa Rebonded").melebihi, true); assert.equal(r.find((x) => x.nama === "Lem").melebihi, false, "tanpa rencana: tidak ada peringatan melebihi");
  assert.equal(r.find((x) => x.nama === "Pegas X").kode, "PGS-X"); assert.equal(r.find((x) => x.nama === "Kain Baru").asal, "Sisa potongan");
});

test("dampak singkat per baris: Bahan Gudang = Mengurangi stok (+ Menunggu persetujuan, + Biaya belum diketahui); belum tercatat/komponen lama = Tanpa pengeluaran stok; status sementara jelas", () => {
  const r = barisTabelPemakaian(data(), { menunggu: [{ nomor: "KP-0007", perubahan: { bahan: { id: "m1" } } }] });
  const label = (nama) => r.find((x) => x.nama === nama).chips.map((c) => c.label + (c.detail ? ` ${c.detail}` : ""));
  assert.deepEqual(label("Busa Rebonded"), ["Mengurangi stok", "Menunggu persetujuan KP-0007"]); assert.deepEqual(label("Lem"), ["Mengurangi stok", "Biaya belum diketahui"]);
  assert.deepEqual(label("Kain Baru"), ["Tanpa pengeluaran stok", "Perlu rekonsiliasi Gudang"]); assert.deepEqual(label("Pegas X"), ["Tanpa pengeluaran stok", "Sudah direkonsiliasi"]);
  assert.deepEqual(label("Per spiral lama"), ["Tanpa pengeluaran stok", "Dipakai kembali pada unit ini"]);
  assert.deepEqual(Object.values(DAMPAK).map((d) => d.label), ["Mengurangi stok", "Tanpa pengeluaran stok", "Menunggu persetujuan", "Biaya belum diketahui"]);
  assert.deepEqual(Object.values(LABEL_JENIS_PEMAKAIAN), ["Bahan Gudang", "Bahan belum tercatat", "Komponen lama"]);
  assert.deepEqual(Object.values(PILIHAN_SUMBER).map((p) => p.label), ["Bahan Gudang", "Bahan belum tercatat", "Komponen lama"], "pilihan sumber saat menambah: tiga pilihan ringkas");
});

test("tanpa data: tidak ada baris; tidak ada pemakaian lain yang dikarang", () => {
  assert.deepEqual(barisTabelPemakaian({}), []); assert.deepEqual(barisTabelPemakaian({ perbandingan: [{ materialId: "x", nama: "A", aktual: 0, satuan: "PCS" }] }), []);
});

test("pengawatan: tabel terpadu di atas; Edit per baris memakai formulir yang ada; Riwayat/rencana/detail teknis TERTUTUP; sumber kosong tidak dirender; peran tabel + kartu di HP", () => {
  const b = src("features", "production", "bahan", "PemakaianAktualBagian.jsx"); const t = src("features", "production", "bahan", "TabelPemakaian.jsx"); const o = src("features", "production", "OrderProduksiPanel.jsx");
  assert.ok(b.indexOf("<TabelPemakaian") > b.indexOf('data-testid="tambah-pemakaian"') && b.indexOf("<TabelPemakaian") < b.indexOf('data-testid="riwayat-pemakaian"'), "urutan: Tambah pemakaian → tabel → riwayat tertutup");
  assert.match(b, /<details className="rounded-card border border-line" data-testid="riwayat-pemakaian">/); assert.doesNotMatch(b.split('data-testid="riwayat-pemakaian"')[0].split("<details").pop(), /\sopen[\s=>]/, "Riwayat pemakaian tertutup bawaan");
  assert.match(b, /\{adaRiwayat && \(/); for (const k of ["adaBaru &&", "adaSementara &&", "adaLama &&"]) assert.ok(b.includes(`{${k}`), `bagian sumber hanya tampil bila ada isinya: ${k}`);
  for (const dilarang of ["Belum ada pemakaian bahan dari Gudang", "Belum ada pemakaian bahan yang belum ada di katalog", "Belum ada komponen lama yang dipakai kembali", "DAMPAK_SEMENTARA}</p>"]) assert.ok(!b.includes(dilarang), `tanpa teks kosong/berulang: ${dilarang}`);
  assert.match(b, /data-testid="aktual-kosong"/); assert.match(b, /data-testid="detail-teknis"/); assert.doesNotMatch(b.split('data-testid="detail-teknis"')[0].split("<details").pop(), /\sopen[\s=>]/, "detail teknis tertutup");
  assert.match(t, /role="table"/); assert.match(t, /role="row"/); assert.match(t, /role="cell"/); assert.match(t, /role="columnheader"/); assert.match(t, /max-sm:hidden/, "kepala kolom disembunyikan di HP; baris menjadi kartu"); assert.match(t, /min-h-\[44px\]/);
  for (const id of ["edit-bahan", "edit-sementara", "edit-komponen"]) assert.ok(t.includes(`"${id}"`), id);
  for (const k of ["<EditPemakaianForm", "<BarisSementara", "<KomponenLamaDaftar"]) assert.ok(t.includes(k), `Edit memakai formulir yang ada: ${k}`);
  assert.match(o, /id="sec-riwayat" data-testid="sec-riwayat-lipat"/); assert.doesNotMatch(o.split('id="sec-riwayat"')[0].split("<details").pop(), /\sopen[\s=>]/, "Riwayat drawer tertutup bawaan"); assert.match(o, /id="sec-rencana-wrap"/);
  assert.doesNotMatch(o.split('id="sec-rencana-wrap"')[0].split("<details").pop(), /\sopen[\s=>]/, "Rencana bahan tertutup bawaan");
});
