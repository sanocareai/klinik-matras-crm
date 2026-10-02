// PENJUALAN KARYAWAN — kontrak UI (1 Okt 2026): filter Penjual di halaman Order, label di baris/kartu, kartu di Laporan Sales yang hanya membaca angka server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").split("\r\n").join("\n");

test("Halaman Order: filter Penjual dikirim ke server (daftar & export), label Penjualan Karyawan di tabel dan kartu", () => {
  const s = baca("src/pages/Orders.jsx");
  assert.match(s, /penjualan: fPenjual \|\| undefined/);
  assert.equal((s.match(/penjualan: fPenjual \|\| undefined/g) || []).length, 2, "daftar dan export memakai filter yang sama");
  assert.match(s, /value: "KARYAWAN", label: "Penjualan Karyawan"/);
  assert.equal((s.match(/data-testid="label-penjualan-karyawan"/g) || []).length, 2, "tabel + kartu");
  assert.match(s, /fPenjual \|\| hanyaMandek/);
});

test("Kartu Laporan: angka dari server (tanpa hitungan klien), hanya Admin/Owner/Finance, terpasang di Laporan Sales, menyatakan perlakuan omzet", () => {
  const k = baca("src/features/laporan/components/KartuPenjualanKaryawan.jsx");
  assert.match(k, /api\.getPenjualanKaryawan\(toApiParams\(range\)\)/);
  assert.match(k, /\["ADMIN", "OWNER", "FINANCE"\]/);
  assert.match(k, /Penjualan Karyawan \(di luar tim Sales\)/);
  assert.match(k, /Sisa Tagihan ke Karyawan/);
  assert.doesNotMatch(k, /\.reduce\(/, "tidak menjumlah di klien");
  assert.match(k, /data\?\.gabungan/, "angka gabungan (order + manual) dari server");
  assert.match(k, /Dicatat manual di Finance \(di luar Order\)/);
  assert.doesNotMatch(k, /variant="blue"|group-open|\/(10|50|60)\b/, "hanya token/varian yang benar-benar ter-generate");
  assert.match(baca("src/features/laporan/components/SalesReportTab.jsx"), /<KartuPenjualanKaryawan range=\{range\} \/>/);
  assert.match(baca("src/api.js"), /getPenjualanKaryawan: \(params\) => request\("\/orders\/penjualan-karyawan\/ringkasan"/);
});
