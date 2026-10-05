// Jumlah item Penjualan Karyawan PECAHAN (form Finance): normalisasi koma Indonesia → titik server, pratinjau total dengan pembulatan SAMA seperti server (HALF_UP per baris).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalisasiJumlah, subtotalSen, totalItems } from "../src/features/finance/penjualanKaryawanLogic.js";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").split("\r\n").join("\n");

test("normalisasiJumlah: koma/titik diterima → string bertitik; selebihnya null", () => {
  assert.equal(normalisasiJumlah("1,6"), "1.6");
  assert.equal(normalisasiJumlah("1.6"), "1.6");
  assert.equal(normalisasiJumlah(" 12 "), "12");
  assert.equal(normalisasiJumlah(2), "2");
  assert.equal(normalisasiJumlah("0,001"), "0.001");
  assert.equal(normalisasiJumlah("1000"), "1000");
  for (const x of ["", " ", "abc", "NaN", "-1", "0", "0,0", "1.600,5", "1.6.0", "1,2345", "1e3", "1001", ".5", "5.", null, undefined, "١٢"]) assert.equal(normalisasiJumlah(x), null, JSON.stringify(x));
});

test("subtotalSen: HALF_UP per baris dengan bilangan bulat (tanpa float) — sama dengan server", () => {
  assert.equal(subtotalSen("1,6", 35000), 5_600_000);
  assert.equal(subtotalSen("0.5", 12345.67), 617_284, "6.172,835 → 6.172,84");
  assert.equal(subtotalSen("0.333", 100), 3330);
  assert.equal(subtotalSen("0.005", 1), 1);
  assert.equal(subtotalSen("abc", 100), 0);
  assert.equal(subtotalSen(1, 0), 0);
});

test("totalItems: kasus layar Owner (6 item, HARDPAD 1,6) = Rp1.965.500; total = Σ subtotal dibulatkan", () => {
  const items = [
    { quantity: "2", unitPrice: "49950" }, { quantity: "2", unitPrice: "110800" }, { quantity: "6", unitPrice: "86000" },
    { quantity: "12", unitPrice: "86000" }, { quantity: "1,6", unitPrice: "35000" }, { quantity: "2", unitPrice: "20000" },
  ];
  assert.equal(totalItems(items), 1_965_500);
  assert.equal(totalItems([{ quantity: "0,5", unitPrice: 12345.67 }, { quantity: "0,5", unitPrice: 12345.67 }]), 12345.68);
  assert.equal(totalItems([{ quantity: "x", unitPrice: 10 }, { quantity: 0, unitPrice: 5 }]), 0);
});

test("Form: kolom jumlah menerima pecahan (teks + inputMode desimal), mengirim string bertitik, dan tombol simpan bergantung normalisasi", () => {
  const src = baca("src/pages/finance/FinancePenjualanKaryawan.jsx");
  assert.match(src, /normalisasiJumlah\(i\.quantity\) !== null/);
  assert.match(src, /quantity: normalisasiJumlah\(i\.quantity\)/);
  assert.match(src, /type="text" inputMode="decimal" value=\{it\.quantity\}/);
  assert.doesNotMatch(src, /type="number" min=\{1\} value=\{it\.quantity\}/, "input jumlah bukan lagi number min=1 (menolak pecahan)");
});
