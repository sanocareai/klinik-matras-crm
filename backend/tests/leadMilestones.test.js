import { test } from "node:test";
import assert from "node:assert/strict";
import { mengandungHarga, areaDariKota } from "../src/services/leadMilestones.js";

test("mengandungHarga: format harga yang dipakai sales", () => {
  for (const t of [
    "Harganya Rp3.690.000 ya kak", "rp 1.900.000", "Rp1,9", "total 3.290.000",
    "3,690,000 sudah termasuk ongkir", "cuma 2jt kak", "tambah 500rb", "1,5 juta saja", "(4.190.000)",
  ]) assert.equal(mengandungHarga(t), true, t);
});

test("mengandungHarga: sapaan & teks biasa tidak dianggap penawaran", () => {
  for (const t of [
    "Halo, selamat datang di Klinik Matras SANO, Ahlinya kasur sehat",
    "Mohon info keluhan fisik kasurnya apa saja? Amblas, keras?",
    "Ukuran kasurnya 160x200 kak?", "Bisa kirim shareloc?", "Jam 10.30 ya kak",
    "0812-3456-7890", "", null,
  ]) assert.equal(mengandungHarga(t), false, String(t));
});

test("areaDariKota: KOTA_LIST & teks bebas", () => {
  assert.equal(areaDariKota("Jakarta Selatan"), "JABODETABEK");
  assert.equal(areaDariKota("Tangerang Selatan"), "JABODETABEK");
  assert.equal(areaDariKota("Depok"), "JABODETABEK");
  assert.equal(areaDariKota("Kab. Bandung Barat"), "BANDUNG");
  assert.equal(areaDariKota("Karawang"), "AREA_LAIN");
  assert.equal(areaDariKota("Surabaya"), null); // tidak ditebak LUAR_AREA — dibiarkan kosong
  assert.equal(areaDariKota(""), null);
  assert.equal(areaDariKota(null), null);
});
