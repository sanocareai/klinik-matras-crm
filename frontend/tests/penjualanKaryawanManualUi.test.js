// PENJUALAN KARYAWAN MANUAL (Finance) — kontrak UI: logika murni form, pemasangan di menu/rute, dan layar yang hanya menampilkan angka server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { totalItems, metodeButuhRekening, LABEL_METODE_PJK } from "../src/features/finance/penjualanKaryawanLogic.js";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").split("\r\n").join("\n");

test("Pratinjau total = Σ(jumlah × harga) baris valid; baris tak valid diabaikan", () => {
  assert.equal(totalItems([{ quantity: 1, unitPrice: 1_300_000 }, { quantity: "2", unitPrice: "150000" }]), 1_600_000);
  assert.equal(totalItems([{ quantity: 0, unitPrice: 5000 }, { quantity: 1, unitPrice: "" }, { quantity: "x", unitPrice: 10 }]), 0);
  assert.equal(totalItems(undefined), 0);
});

test("Potong gaji tidak memakai rekening; tunai/transfer memakai rekening", () => {
  assert.equal(metodeButuhRekening("POTONG_GAJI"), false);
  assert.equal(metodeButuhRekening("TRANSFER"), true);
  assert.equal(metodeButuhRekening("TUNAI"), true);
  assert.deepEqual(Object.keys(LABEL_METODE_PJK).sort(), ["POTONG_GAJI", "TRANSFER", "TUNAI"]);
});

test("Terpasang: rute, menu Finance, API, dan penyusun panel detail", () => {
  assert.match(baca("src/routes/pageRegistry.jsx"), /path: "\/finance\/penjualan-karyawan", render: \(\) => <FinancePenjualanKaryawan \/>/);
  assert.match(baca("src/components/Layout.jsx"), /to: "\/finance\/penjualan-karyawan", label: "Penjualan Karyawan"/);
  const api = baca("src/api.js");
  for (const m of ["getPenjualanKaryawanFinance", "createPenjualanKaryawan", "catatPembayaranPenjualanKaryawan", "batalPembayaranPenjualanKaryawan", "batalPenjualanKaryawan"]) assert.match(api, new RegExp(m), m);
  assert.match(baca("src/features/finance/detailSpecs.js"), /export function specPenjualanKaryawan/);
});

test("Layar: angka dari server (tidak menjumlah baris di klien), tanggal cutoff dari server, form tidak mengirim total", () => {
  const s = baca("src/pages/finance/FinancePenjualanKaryawan.jsx");
  assert.doesNotMatch(s, /daftar\.reduce|\.filter\(.*\)\.reduce/, "ringkasan tidak dihitung dari baris di klien");
  assert.match(s, /data\?\.cutoff/, "cutoff saldo awal dari server");
  assert.doesNotMatch(s, /2026-09-18"/, "tanggal cutoff tidak ditanam di klien");
  assert.match(s, /api\.createPenjualanKaryawan\(\{\s*date: f\.date, sellerId: f\.sellerId/);
  assert.doesNotMatch(s, /createPenjualanKaryawan\(\{[^}]*total:/s, "total tidak dikirim ke server");
  assert.match(s, /Tidak melewati produksi maupun delivery|tidak lewat Order/i, "menjelaskan bahwa ini di luar Order/produksi/delivery");
});
