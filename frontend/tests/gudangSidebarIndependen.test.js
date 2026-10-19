// Sidebar Gudang: state tiap kelompok INDEPENDEN — beberapa kelompok terbuka bersamaan; hanya navigasi (tanpa API/data/izin).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kelompokTerbukaAwal, bukaKelompokAktif, balikKelompok } from "../src/lib/gudangNav.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(dir, "../src", rel), "utf8").replace(/\r\n/g, "\n");
const sections = [
  { section: "Beranda", langsung: true, items: [{ to: "/warehouse/dashboard" }] },
  { section: "Penerimaan", items: [{ to: "/warehouse/barang-akan-datang" }, { to: "/warehouse/goods-receipt" }] },
  { section: "Stok", items: [{ to: "/warehouse/inventory" }, { to: "/warehouse/transfers" }] },
  { section: "Produksi", items: [{ to: "/warehouse/antrean-produksi" }] },
  { section: "Kontrol", items: [{ to: "/warehouse/stock-count" }, { to: "/warehouse/perlu-perhatian" }] },
];

test("awal: halaman aktif selalu terbuka; pilihan tersimpan ditambahkan; nama usang dan Beranda (langsung) diabaikan; urutan mengikuti sidebar", () => {
  assert.deepEqual(kelompokTerbukaAwal({ sections, pathname: "/warehouse/inventory" }), ["Stok"]);
  assert.deepEqual(kelompokTerbukaAwal({ sections, pathname: "/warehouse/inventory", tersimpan: ["Kontrol", "Penerimaan"] }), ["Penerimaan", "Stok", "Kontrol"], "tersimpan ∪ aktif, urut sidebar");
  assert.deepEqual(kelompokTerbukaAwal({ sections, pathname: "/warehouse/dashboard", tersimpan: ["Beranda", "Hantu", "Stok"] }), ["Stok"], "Beranda & nama tak dikenal dibuang");
  assert.deepEqual(kelompokTerbukaAwal({ sections, pathname: "/komplain", tersimpan: null }), [], "halaman di luar menu: tidak ada yang dipaksa");
  assert.deepEqual(kelompokTerbukaAwal({ sections, pathname: "/warehouse/goods-receipt/abc", tersimpan: ["Penerimaan"] }), ["Penerimaan"]);
});

test("balikKelompok: hanya membalik kelompok yang diklik — buka Penerimaan lalu Stok, keduanya terbuka; tutup Stok, Penerimaan tetap", () => {
  let t = []; t = balikKelompok(t, "Penerimaan"); t = balikKelompok(t, "Stok"); assert.deepEqual(t, ["Penerimaan", "Stok"]);
  t = balikKelompok(t, "Produksi"); t = balikKelompok(t, "Kontrol"); assert.deepEqual(t, ["Penerimaan", "Stok", "Produksi", "Kontrol"], "membuka yang lain tidak menutup Penerimaan");
  t = balikKelompok(t, "Stok"); assert.deepEqual(t, ["Penerimaan", "Produksi", "Kontrol"]);
});

test("berpindah halaman menambah kelompok aktif tanpa menutup yang lain; tanpa perubahan → array yang sama (tanpa render ulang)", () => {
  const awal = ["Penerimaan", "Stok"];
  assert.deepEqual(bukaKelompokAktif({ sections, pathname: "/warehouse/stock-count", terbuka: awal }), ["Penerimaan", "Stok", "Kontrol"]);
  assert.equal(bukaKelompokAktif({ sections, pathname: "/warehouse/transfers", terbuka: awal }), awal);
  assert.equal(bukaKelompokAktif({ sections, pathname: "/warehouse/dashboard", terbuka: awal }), awal, "Beranda tidak membuka apa pun");
});

test("komponen: state per kelompok (array), tidak ada 'satu kelompok' lagi; disimpan ke localStorage; keyboard ←/→ per kelompok; aria-expanded; tidak memanggil API tulis", () => {
  const g = baca("components/GudangNavGrup.jsx");
  assert.match(g, /terbuka\.includes\(s\.section\)/); assert.match(g, /balikKelompok\(t, nama\)/); assert.match(g, /simpanKelompokTerbuka\(terbuka\)/); assert.match(g, /bukaKelompokAktif/);
  assert.doesNotMatch(g, /setDipilih|dipilih/, "tidak ada lagi pilihan tunggal"); assert.match(g, /aria-expanded=\{buka\}/); assert.match(g, /ArrowRight/); assert.match(g, /ArrowLeft/); assert.match(g, /data-grup-kepala/);
  assert.doesNotMatch(g, /api\.(post|put|patch|delete)/i);
  const n = baca("lib/gudangNav.js"); assert.match(n, /sidebar-gudang-grup-terbuka/); assert.match(n, /bacaKelompokTerakhir\(\)/, "migrasi dari kunci lama");
});
