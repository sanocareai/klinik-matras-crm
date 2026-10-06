// DP di tab Invoice diisi dalam PERSEN atau NOMINAL. Menjalankan logika sungguhan (bukan memeriksa pola kode).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseAngka, hitungDpDariInput as hitung, isianAwalDp, gantiModeDp, MODE_DP } from "../src/features/orders/invoiceDpLogic.js";

const TOTAL = 3_505_000;

test("REGRESI: '1.5' di mode persen = 1,5% (Rp52.575), bukan 15%", () => {
  assert.equal(hitung({ mode: MODE_DP.PERSEN, nilai: "1.5", total: TOTAL }).nominal, 52_575);
  assert.equal(hitung({ mode: MODE_DP.PERSEN, nilai: "1,5", total: TOTAL }).nominal, 52_575);
});

test("30% dari total → nominal bulat Rp1.051.500 (default saran)", () => {
  assert.deepEqual(hitung({ mode: MODE_DP.PERSEN, nilai: "30", total: TOTAL }), { ok: true, nominal: 1_051_500, persen: 30 });
});

test("persen dibulatkan ke Rupiah terdekat; koma desimal didukung", () => {
  assert.equal(hitung({ mode: MODE_DP.PERSEN, nilai: "33", total: TOTAL }).nominal, 1_156_650);
  assert.equal(hitung({ mode: MODE_DP.PERSEN, nilai: "12,5", total: TOTAL }).nominal, 438_125);
  assert.equal(hitung({ mode: MODE_DP.PERSEN, nilai: "30", total: 1_234_567 }).nominal, 370_370, "370.370,1 → 370.370");
});

test("nominal langsung: titik ribuan diterima, persen setara dihitung balik untuk pratinjau", () => {
  const r = hitung({ mode: MODE_DP.NOMINAL, nilai: "1.500.000", total: TOTAL });
  assert.deepEqual([r.ok, r.nominal, r.persen], [true, 1_500_000, 42.8]);
});

test("penolakan: 0%, 100%+, minus, huruf, notasi ilmiah; nominal 0, desimal, sama/lebih dari total", () => {
  const galat = (p) => { const r = hitung({ total: TOTAL, ...p }); assert.equal(r.ok, false, JSON.stringify(p)); return r.galat; };
  assert.match(galat({ mode: "PERSEN", nilai: "0" }), /lebih dari 0/);
  assert.match(galat({ mode: "PERSEN", nilai: "100" }), /kurang dari 100%/);
  assert.match(galat({ mode: "PERSEN", nilai: "150" }), /kurang dari 100%/);
  galat({ mode: "PERSEN", nilai: "-5" }); galat({ mode: "PERSEN", nilai: "abc" }); galat({ mode: "PERSEN", nilai: "1e2" }); galat({ mode: "PERSEN", nilai: "" });
  assert.match(galat({ mode: "NOMINAL", nilai: "0" }), /lebih dari 0/);
  assert.match(galat({ mode: "NOMINAL", nilai: "3505000" }), /lebih kecil dari total/);
  assert.match(galat({ mode: "NOMINAL", nilai: "9999999" }), /lebih kecil dari total/);
  galat({ mode: "NOMINAL", nilai: "abc" });
});

test("persen sangat kecil yang membulat ke Rp0 ditolak dengan pesan jelas; total 0 ditolak", () => {
  assert.match(hitung({ mode: "PERSEN", nilai: "0,00001", total: 1000 }).galat, /kurang dari Rp1/);
  assert.match(hitung({ mode: "PERSEN", nilai: "30", total: 0 }).galat, /Total tagihan belum ada/);
});

test("isian awal: tanpa DP → 30% ; DP sudah ada → nominal tersimpan", () => {
  assert.deepEqual(isianAwalDp({ total: TOTAL }), { mode: "PERSEN", nilai: "30" });
  assert.deepEqual(isianAwalDp({ total: TOTAL, dpTarget: 1_500_000 }), { mode: "NOMINAL", nilai: "1500000" });
});

test("ganti mode mempertahankan nilai: 30% ↔ 1051500; isian tak valid kembali ke default mode tujuan", () => {
  assert.equal(gantiModeDp({ dari: "PERSEN", ke: "NOMINAL", nilai: "30", total: TOTAL }), "1051500");
  assert.equal(gantiModeDp({ dari: "NOMINAL", ke: "PERSEN", nilai: "1500000", total: TOTAL }), "42,8");
  assert.equal(gantiModeDp({ dari: "PERSEN", ke: "NOMINAL", nilai: "abc", total: TOTAL }), "");
  assert.equal(gantiModeDp({ dari: "NOMINAL", ke: "PERSEN", nilai: "", total: TOTAL }), "30");
  assert.equal(gantiModeDp({ dari: "PERSEN", ke: "PERSEN", nilai: "45", total: TOTAL }), "45");
});

test("parseAngka: bentuk Indonesia", () => {
  assert.equal(parseAngka("1.500.000"), 1_500_000);
  assert.equal(parseAngka("12,5", { desimal: true }), 12.5);
  assert.equal(parseAngka(" "), null);
  assert.equal(parseAngka("12.5.1", { desimal: true }), null);
  assert.equal(parseAngka("12.5", { desimal: true }), 12.5, "titik juga desimal pada persen");
  assert.equal(parseAngka("1.5", { desimal: true }), 1.5, "REGRESI: jangan terbaca 15");
});

test("PARITAS: salinan mobile identik dengan web (kecuali komentar)", () => {
  const baca = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.equal(baca("../../mobile/src/lib/invoiceDp.js"), baca("../src/features/orders/invoiceDpLogic.js"));
});
