// Kemiripan barang (SKU baru dari PO): murni, tanpa DB. SAMA / BERBEDA / AMBIGU — termasuk 8 varian BUSA REBONDED MSB R58 (2 cm / 4 cm × 120/160/180/200 × 200).
import test from "node:test";
import assert from "node:assert/strict";
import { bacaAtribut, bandingkanAtribut, klasifikasi, kunciKanonik } from "../src/lib/domain/kemiripanBarang.js";

const MSB = (d, g = "R58") => `BUSA REBONDED MSB ${d} ${g}`;
const UKURAN = ["120X200", "160X200", "180X200", "200X200"]; const TEBAL = ["2CM", "4CM"];
const DELAPAN = TEBAL.flatMap((t) => UKURAN.map((u) => MSB(`${u}X${t}`)));

test("atribut: ukuran/ketebalan, grade/density, angka, dan inti dibaca; mm/m dikonversi ke cm", () => {
  const a = bacaAtribut("BUSA REBONDED MSB 120X200X4CM R58"); assert.deepEqual(a.dimensi, [120, 200, 4]); assert.deepEqual([...a.grade], ["R58"]); assert.deepEqual([...a.inti].sort(), ["busa", "msb", "rebonded"]);
  assert.deepEqual(bacaAtribut("busa 1200 x 2000 x 40 mm").dimensi, [120, 200, 4]); assert.deepEqual(bacaAtribut("busa 1,2×2×0,04 m").dimensi, [120, 200, 4]);
  assert.deepEqual([...bacaAtribut("Busa density 70").grade], ["D70"]); assert.deepEqual([...bacaAtribut("Busa D 50").grade], ["D50"]); assert.deepEqual([...bacaAtribut("busa R-58").grade], ["R58"]);
  assert.deepEqual([...bacaAtribut("Lem Semprot 500 ML").angka], ["500"]); assert.deepEqual(bacaAtribut("kain", "ukuran 100x200").dimensi, [100, 200], "ukuran dari spesifikasi bila nama tidak memuat");
});

test("8 varian MSB R58 saling BERBEDA (ketebalan/ukuran) — tidak satu pun SAMA atau AMBIGU terhadap yang lain", () => {
  assert.equal(new Set(DELAPAN.map(kunciKanonik)).size, 8);
  for (const a of DELAPAN) for (const b of DELAPAN) {
    if (a === b) { assert.equal(klasifikasi(a, b).jenis, "SAMA"); continue; }
    const k = klasifikasi(a, b); assert.equal(k.jenis, "BERBEDA", `${a} vs ${b}`); assert.ok(k.perbedaan.length >= 1);
  }
  const k = klasifikasi(MSB("120X200X2CM"), MSB("120X200X4CM")); assert.deepEqual(k.perbedaan, [{ kunci: "ketebalan", label: "Ketebalan", baru: "2 cm", ada: "4 cm" }]);
  const u = klasifikasi(MSB("160X200X4CM"), MSB("120X200X4CM")); assert.deepEqual(u.perbedaan.map((p) => [p.kunci, p.baru, p.ada]), [["ukuran", "160×200 cm", "120×200 cm"]]);
});

test("SAMA setelah normalisasi ejaan, spasi, huruf besar/kecil, tanda ×/x/*, satuan ukuran, urutan kata, dan kata satuan", () => {
  const dasar = MSB("120X200X4CM");
  for (const v of ["Busa Rebonded MSB 120 x 200 x 4 cm R58", "busa  rebonded  msb 120×200×4CM r58", "BUSA REBONDED MSB 120*200*4 CM R58", "busa rebonded msb 1200x2000x40mm r58", "BUSA REBONDED MSB R58 120X200X4", "BUSA REBONDED MSB 120X200X4CM R58 LEMBAR", "MSB BUSA REBONDED 120X200X4CM R-58", "BUSA REBONDED MSB 120X200X4CM R 58 SHEET"]) {
    assert.equal(klasifikasi(v, dasar).jenis, "SAMA", v); assert.equal(kunciKanonik(v), kunciKanonik(dasar), v);
  }
  assert.equal(klasifikasi("Lem Semprot 500 ML", "LEM SEMPROT 500ML").jenis, "SAMA"); assert.equal(klasifikasi(dasar, dasar, { satuanSama: false }).jenis, "AMBIGU", "satuan stok beda = perlu keputusan");
});

test("BERBEDA jelas: grade/density, merek/jenis, angka spesifikasi — bukan hanya kata dasar yang sama", () => {
  const d = MSB("120X200X4CM");
  assert.equal(klasifikasi(MSB("120X200X4CM", "R60"), d).perbedaan[0].kunci, "grade"); assert.equal(klasifikasi("BUSA REBONDED MSB 120X200X4CM D50", d).perbedaan[0].kunci, "grade", "D50 vs R58 = grade/density berbeda");
  const m = klasifikasi("BUSA REBONDED SKY 120X200X4CM R58", d); assert.deepEqual([m.jenis, m.perbedaan[0].kunci], ["BERBEDA", "merek"]);
  assert.equal(klasifikasi("Lem Semprot 250 ML", "Lem Semprot 500 ML").perbedaan[0].kunci, "angka"); assert.equal(klasifikasi("Lem Semprot Aica 500 ML", "Lem Semprot Fox 500 ML").perbedaan[0].kunci, "merek");
  assert.equal(klasifikasi("Busa Soft Foam 120X200X2", "Busa Rebonded 120X200X2").jenis, "BERBEDA", "jenis busa berbeda");
});

test("AMBIGU yang memang butuh keputusan: atribut tertulis di satu sisi, ejaan hampir sama, urutan ukuran terbalik, kata tambahan", () => {
  const d = MSB("120X200X4CM");
  const kasus = [["BUSA REBONDED MSB R58", /Ukuran tertulis di salah satu nama saja/], ["BUSA REBONDED MSB 120X200X4CM", /Grade\/density tertulis di salah satu nama saja/], ["BUSA REBONDED MSB 120X200 R58", /Ketebalan tertulis di salah satu nama saja/],
    ["BUSA REBONDED MSB 200X120X4CM R58", /Urutan panjang × lebar terbalik/], ["BUSA REBOUNDED MSB 120X200X4CM R58", /Ejaan hampir sama/], ["BUSA REBONDED MSB 120X200X4CM R58 PREMIUM", /Kata tambahan/]];
  for (const [v, pola] of kasus) { const k = klasifikasi(v, d); assert.equal(k.jenis, "AMBIGU", v); assert.match(k.belumJelas.join("|"), pola, v); assert.deepEqual(k.perbedaan, []); }
  assert.equal(klasifikasi("BUSA REBONDED MSB R58", MSB("120X200X4CM", "R60")).jenis, "BERBEDA", "satu perbedaan pasti (grade) cukup walau ukuran tidak tertulis");
  assert.equal(klasifikasi("PEGAS YL 12", "PEGAS KN 12").jenis, "BERBEDA", "kode merek pendek (YL/KN) bukan salah ketik");
});

test("bandingkanAtribut tidak menebak: tanpa atribut sama sekali dan nama sama persis = SAMA; ketebalan 2 vs 4 cm tidak pernah dianggap salah ketik", () => {
  assert.deepEqual(bandingkanAtribut(bacaAtribut("Pita Tepi"), bacaAtribut("Pita Tepi")), { beda: [], belumJelas: [] });
  assert.equal(klasifikasi("BUSA 120X200X2CM", "BUSA 120X200X4CM").jenis, "BERBEDA");
});
