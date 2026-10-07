// Spesifikasi Excel Order berwarna disusun dari baris export yang sudah ada — dijalankan sungguhan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buatSpecExcelOrder, benderaOrder, paletteDari, PALETTE_LINI } from "../src/features/orders/exportExcelSpec.js";

const order = (x = {}) => ({ "ID Order": "RES-1", Pelanggan: "Ibu A", Kategori: "Layanan", "Lini Produk": "Kasur", Status: "Diproses", "Jenis Pekerjaan": "Order Baru", "No Komplain": "", "Keluhan Komplain": "", "Hari di Status": 2, Mandek: "", Pembayaran: "DP", "Sudah Lunas?": "Tidak", Nilai: 1000000, "Tanggal Lunas": "", "Link Lokasi": "", Dibuat: "2026-10-02", KolomBaru: "x", ...x });
const layanan = (x = {}) => ({ "ID Order": "RES-1", Pelanggan: "Ibu A", "Kategori Produk": "Kasur", "Kategori Layanan": "Layanan", Layanan: "Upgrade", "Harga Final": 100, "Status Nego": "Dalam batas", ...x });
const palettes = { kategori: { Layanan: { bg: "#ede9fe", color: "#5b21b6" } }, status: {}, pembayaran: {} };

test("paletteDari: memetakan enum → label dan menerima kunci bg maupun background", () => {
  const p = paletteDari({ LUNAS: "Lunas", DP: "DP", TAKADA: "X" }, { LUNAS: { background: "#f0fdf4", color: "#16a34a" }, DP: { bg: "#fff7ed", color: "#f97316" } });
  assert.deepEqual(p, { Lunas: { bg: "#f0fdf4", color: "#16a34a" }, DP: { bg: "#fff7ed", color: "#f97316" } });
});

test("kolom mengikuti urutan & judul baris export; baris jadi array sejajar kolom", () => {
  const spec = buatSpecExcelOrder({ sheetOrder: [order(), order({ "ID Order": "RES-2" })], bendera: [[], []], palettes });
  const s = spec.sheets[0];
  assert.deepEqual(s.kolom.map((k) => k.header), Object.keys(order()));
  assert.equal(s.baris.length, 2);
  assert.equal(s.baris[1][s.kolom.findIndex((k) => k.key === "ID Order")], "RES-2");
  assert.equal(s.baris[0].length, s.kolom.length);
});

test("aturan tampilan: uang/total, tanggal, link, penanda; kolom tak dikenal jadi teks biasa", () => {
  const k = Object.fromEntries(buatSpecExcelOrder({ sheetOrder: [order()], bendera: [[]], palettes }).sheets[0].kolom.map((x) => [x.key, x]));
  assert.equal(k.Nilai.tipe, "uang"); assert.equal(k.Nilai.total, true);
  assert.equal(k["Tanggal Lunas"].tipe, "tanggal");
  assert.equal(k.Dibuat.tipe, "tanggal");
  assert.equal(k["Link Lokasi"].tipe, "link");
  assert.equal(k["Hari di Status"].tandaMandek, true);
  assert.equal(k["No Komplain"].tandaKomplain, true);
  assert.equal(k["Keluhan Komplain"].tandaKomplain, true);
  assert.equal(k.KolomBaru.tipe, "teks");
  assert.equal(k.KolomBaru.palette, undefined);
});

test("palette: Kategori dari layar; Jenis Pekerjaan KOMPLAIN merah pekat; Lini Produk bawaan", () => {
  const k = Object.fromEntries(buatSpecExcelOrder({ sheetOrder: [order()], bendera: [[]], palettes }).sheets[0].kolom.map((x) => [x.key, x]));
  assert.deepEqual(k.Kategori.palette.Layanan, { bg: "#ede9fe", color: "#5b21b6" });
  assert.equal(k["Jenis Pekerjaan"].palette["KOMPLAIN / REVISI"].bg, "#dc2626");
  assert.equal(k["Lini Produk"].palette, PALETTE_LINI);
  assert.equal(k["Sudah Lunas?"].palette.Ya.bg, "#dcfce7");
});

test("sheet Rincian hanya dibuat bila ada item; bendera ikut ke tiap baris", () => {
  const tanpa = buatSpecExcelOrder({ sheetOrder: [order()], bendera: [[]], palettes });
  assert.equal(tanpa.sheets.length, 1);
  const dengan = buatSpecExcelOrder({ sheetOrder: [order()], sheetLayanan: [layanan(), layanan({ Layanan: "Kain" })], bendera: [["komplain"]], benderaLayanan: [["komplain"], ["komplain"]], palettes });
  assert.equal(dengan.sheets.length, 2);
  assert.equal(dengan.sheets[1].baris.length, 2);
  assert.deepEqual(dengan.sheets[1].bendera, [["komplain"], ["komplain"]]);
  const k = Object.fromEntries(dengan.sheets[1].kolom.map((x) => [x.key, x]));
  assert.equal(k["Harga Final"].total, true);
  assert.equal(k["Status Nego"].palette["Di bawah standard"].bg, "#fee2e2");
});

test("ringkasan: kunci yang dirujuk benar-benar ada sebagai kolom sheet Order", () => {
  const spec = buatSpecExcelOrder({ sheetOrder: [order({ "Sales Person": "Kiki" })], bendera: [[]], palettes, filterLabel: "Semua order", pengekspor: "Gilang" });
  const judul = new Set(spec.sheets[0].kolom.map((k) => k.key));
  assert.ok(judul.has(spec.ringkasan.kunciNilai));
  assert.ok(judul.has(spec.ringkasan.kunciLunas));
  assert.equal(spec.filterLabel, "Semua order");
  assert.equal(spec.pengekspor, "Gilang");
});

test("benderaOrder memakai penentu yang disuplai pemanggil (sama dengan layar)", () => {
  const f = { punyaKomplainAktif: (o) => o.k, isMandek: (o) => o.m };
  assert.deepEqual(benderaOrder({ k: true, m: true }, f), ["komplain", "mandek"]);
  assert.deepEqual(benderaOrder({ k: false, m: true }, f), ["mandek"]);
  assert.deepEqual(benderaOrder({}, f), []);
});

test("PEMASANGAN: Orders.jsx memakai export berwarna dengan cadangan polos; api.js & palette dari format.js", () => {
  const baca = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const o = baca("../src/pages/Orders.jsx");
  assert.match(o, /api\.exportOrdersXlsx\(spec\)/);
  assert.match(o, /export polos lama tetap jalan|memakai export polos/);
  assert.match(o, /benderaOrder\(o, \{ punyaKomplainAktif, isMandek \}\)/);
  assert.match(o, /paletteDari\(KATEGORI_LABELS, CATEGORY_BADGE\)/);
  assert.match(baca("../src/api.js"), /exportOrdersXlsx: async \(spec\)/);
  const f = baca("../src/utils/format.js");
  assert.match(f, /export const CATEGORY_BADGE/);
  assert.match(f, /export const ORDER_STATUS_BADGE/);
  assert.doesNotMatch(baca("../src/components/customer/OrderSection.jsx"), /\nconst (CATEGORY_BADGE|ORDER_STATUS_BADGE)/, "tidak boleh ada salinan lokal");
});
