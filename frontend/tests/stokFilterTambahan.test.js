import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saringStok, daftarTampil, hitungOpsiSaring, cocokHarga, cocokLain, FILTER_HARGA, FILTER_LAIN, FILTER_KEADAAN } from "../src/features/warehouse/stok/stokLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const R = (kode, over = {}) => ({ materialId: `id-${kode}`, kode, nama: kode, aktif: true, kategori: "RAW_MATERIAL", keadaan: "ADA", vendor: "V", saldo: 5, satuan: "METER", batasMinimum: 2, kelompok: { kode: "KAIN", label: "Kain" }, ...over });
const baris = [
  R("A1"), // berharga, batas ada, vendor ada
  R("A2", { batasMinimum: null }), // tanpa batas minimum
  R("A3", { vendor: null, satuan: "PCS" }), // tanpa vendor
  R("A4", { keadaan: "MINUS", saldo: -1, satuan: "PCS" }),
  R("A5", { keadaan: "NOL_TERHITUNG", saldo: 0 }),
  R("A6", { keadaan: "BELUM_ADA_CATATAN", saldo: null, vendor: "  " }),
  R("A7", { aktif: false, batasMinimum: null }),
];
const peta = { harga: { "id-A1": { harga: 100, satuan: "METER" }, "id-A3": { harga: null, terjadwal: { harga: 50 } }, "id-A4": { harga: 7, satuan: "PCS", terjadwal: { harga: 9 } } } };
const kode = (rs) => rs.map((r) => r.kode);

test("filter harga: belum ada = tanpa harga yang SEDANG berlaku (termasuk yang baru terjadwal); sudah ada; terjadwal; tanpa data harga = tidak menyaring", () => {
  assert.deepEqual(kode(saringStok(baris, { harga: "BELUM", petaHarga: peta })), ["A2", "A3", "A5", "A6"]);
  assert.deepEqual(kode(saringStok(baris, { harga: "ADA", petaHarga: peta })), ["A1", "A4"]);
  assert.deepEqual(kode(saringStok(baris, { harga: "TERJADWAL", petaHarga: peta })), ["A3", "A4"]);
  assert.equal(saringStok(baris, { harga: "BELUM", petaHarga: null }).length, 6, "tanpa izin Finance (peta null) saringan harga diabaikan, bukan mengosongkan daftar");
  assert.equal(cocokHarga(peta, "id-A9", ""), true);
});

test("filter harga digabung dengan keadaan stok: ada stok tetapi belum ada harga", () => {
  assert.deepEqual(kode(saringStok(baris, { keadaan: "ADA", harga: "BELUM", petaHarga: peta })), ["A2", "A3"]);
});

test("filter saldo nol atau minus, kelengkapan (batas minimum null = belum diatur, bukan 0; vendor kosong/spasi), dan satuan", () => {
  assert.deepEqual(kode(saringStok(baris, { keadaan: "HABIS_ATAU_MINUS" })), ["A4", "A5"]);
  assert.deepEqual(kode(saringStok(baris, { lain: "BATAS_BELUM" })), ["A2"], "nonaktif tersembunyi");
  assert.deepEqual(kode(saringStok(baris, { lain: "BATAS_BELUM", nonaktif: true })), ["A2", "A7"]);
  assert.equal(cocokLain({ batasMinimum: 0 }, "BATAS_ADA"), true, "batas 0 = sudah diatur");
  assert.deepEqual(kode(saringStok(baris, { lain: "VENDOR_KOSONG" })), ["A3", "A6"]);
  assert.deepEqual(kode(saringStok(baris, { satuan: "PCS" })), ["A3", "A4"]);
  assert.deepEqual(kode(saringStok(baris, { satuan: "PCS", lain: "VENDOR_KOSONG", keadaan: "ADA" })), ["A3"]);
});

test("saringan tambahan tetap berlaku saat mencari (seperti keadaan), dan membuka daftar", () => {
  assert.deepEqual(kode(saringStok(baris, { cari: "a", satuan: "PCS" })), ["A3", "A4"]);
  for (const o of [{ harga: "BELUM" }, { lain: "VENDOR_KOSONG" }, { satuan: "PCS" }]) assert.equal(daftarTampil(o), true, JSON.stringify(o));
  assert.equal(daftarTampil({}), false);
});

test("hitungOpsiSaring: hitungan per opsi atas bahan aktif; satuan unik berurutan", () => {
  const h = hitungOpsiSaring(baris, { petaHarga: peta });
  assert.deepEqual(h.harga, { BELUM: 4, ADA: 2, TERJADWAL: 2 });
  assert.equal(h.lain.BATAS_BELUM, 1); assert.equal(h.lain.VENDOR_KOSONG, 2);
  assert.equal(h.keadaan.HABIS_ATAU_MINUS, 2); assert.equal(h.keadaan.MINUS, 1);
  assert.deepEqual(h.satuan, [{ kode: "METER", n: 4 }, { kode: "PCS", n: 2 }]);
  assert.equal(hitungOpsiSaring(baris, { petaHarga: peta, nonaktif: true }).lain.BATAS_BELUM, 2);
});

test("opsi saringan: kunci unik dan berawal dari 'semua'", () => {
  for (const L of [FILTER_HARGA, FILTER_LAIN, FILTER_KEADAAN]) { assert.equal(L[0].key, ""); assert.equal(new Set(L.map((x) => x.key)).size, L.length); }
});

test("halaman Stok & Lokasi memasang saringan baru dan menyimpannya di URL", () => {
  const src = fs.readFileSync(path.join(dir, "../src/pages/warehouse/WarehouseInventory.jsx"), "utf8").replace(/\r\n/g, "\n");
  assert.match(src, /const KUNCI = \[[^\]]*"harga", "lain", "satuan"\]/);
  for (const id of ["saring-harga", "saring-lain", "saring-satuan", "perhatian-ada-stok-tanpa-harga"]) assert.ok(src.includes(`data-testid="${id}"`), id);
  assert.ok(fs.readFileSync(path.join(dir, "../src/features/warehouse/stok/PanelSaringan.jsx"), "utf8").includes('data-testid="atur-ulang-saringan"'), "atur ulang ada di panel Filter");
  assert.match(src, /\{harga && \(\s*<PilihanSaringan label="Harga berlaku">\s*<select value=\{hargaF\}/, "saringan harga hanya tampil bila data harga tersedia (izin Finance)");
});
