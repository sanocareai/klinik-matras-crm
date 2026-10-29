import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// AOV Tim: dua kartu terpisah, semua angka dari server (tanpa hitung di klien), kartu "AOV Tim" lama tidak kembali.
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");
const baca = (...p) => readFileSync(path.join(SRC, ...p), "utf8").replace(/\r\n/g, "\n");

test("KartuAovTim: label jelas, periode WIB, rumus, drilldown berhalaman — angka dari server, tanpa pembagian/penjumlahan nilai di klien", () => {
  const k = baca("features", "laporan", "components", "KartuAovTim.jsx");
  assert.match(k, /api\.getSalesAov\(/); assert.match(k, /api\.getSalesAovOrders\(/);
  assert.match(k, /Periode WIB:/); assert.match(k, /Rumus:/); assert.match(k, /Muat lagi/); assert.match(k, /Menampilkan/);
  assert.doesNotMatch(k.replace(/\/\/.*$/gm, ""), /\.reduce\(|Math\.round\(.*\/|totalNilaiBersih\s*\/|jumlahOrder\s*\//, "tidak ada penjumlahan/pembagian nilai di klien");
});

test("SalesReportTab: dua metrik AOV tampil lewat KartuAovTim; kartu 'AOV Tim' lama (angka campur) dihapus; subteks tidak lagi memuat AOV ketiga", () => {
  const s = baca("features", "laporan", "components", "SalesReportTab.jsx");
  assert.match(s, /<KartuAovTim range=\{range\} \/>/);
  assert.doesNotMatch(s, /label="AOV Tim"/);
  assert.doesNotMatch(s, /order · AOV \$\{/);
  const api = baca("api.js");
  assert.match(api, /getSalesAov: .*\/analytics\/sales-aov"/); assert.match(api, /getSalesAovOrders: .*\/analytics\/sales-aov\/orders"/);
});
