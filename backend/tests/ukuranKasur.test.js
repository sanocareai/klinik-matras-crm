// Ukuran Kasur Custom: formatter bersama, validasi Lebar/Panjang, pembersihan notes, unit, invoice, dan paritas backend↔frontend.
import test from "node:test";
import assert from "node:assert/strict";
import * as be from "../src/lib/ukuranKasur.js";
import * as fe from "../../frontend/src/utils/ukuranKasur.js";
import { parseOrderNotesForInvoice } from "../src/services/invoice.js";

const { formatUkuranKasur, formatUkuranLabel, validasiUkuranCustom, siapkanNotesUkuran, ukuranUntukUnit, parseAngkaCm, isUkuranCustom, UKURAN_CUSTOM_BELUM_DIISI } = be;

test("Formatter: standar '160 × 200 cm'; custom '145 × 205 cm (Custom)'; legacy tanpa angka 'Ukuran Custom (ukuran belum diisi)'", () => {
  assert.equal(formatUkuranKasur({ ukuranKasur: "160x200 cm (Queen)" }), "160 × 200 cm");
  assert.equal(formatUkuranKasur({ ukuranKasur: "90x200 cm (Single)" }), "90 × 200 cm");
  assert.equal(formatUkuranKasur({ ukuranKasur: "100 x 200" }), "100 × 200 cm");
  assert.equal(formatUkuranKasur({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: 145, ukuranPanjangCm: 205 }), "145 × 205 cm (Custom)");
  assert.equal(formatUkuranKasur({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: 145.5, ukuranPanjangCm: "205" }), "145,5 × 205 cm (Custom)");
  assert.equal(formatUkuranKasur({ ukuranKasur: "Ukuran Custom" }), "Ukuran Custom (ukuran belum diisi)");
  assert.equal(formatUkuranKasur({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: 145 }), UKURAN_CUSTOM_BELUM_DIISI, "hanya satu angka = tidak ditebak");
  assert.equal(formatUkuranKasur({ ukuranKasur: "" }), "");
  assert.equal(formatUkuranKasur({}), "");
  assert.equal(formatUkuranKasur({ ukuranKasur: "3 seater, abu-abu" }), "3 seater, abu-abu", "teks bebas (Sofa) apa adanya");
  // angka custom yang tersisa pada ukuran standar TIDAK dipakai
  assert.equal(formatUkuranKasur({ ukuranKasur: "160x200 cm (Queen)", ukuranLebarCm: 145, ukuranPanjangCm: 205 }), "160 × 200 cm");
});

test("formatUkuranLabel (Unit.ukuran): custom lama → penanda belum diisi; teks terformat tidak diformat ulang", () => {
  assert.equal(formatUkuranLabel("Ukuran Custom"), "Ukuran Custom (ukuran belum diisi)");
  assert.equal(formatUkuranLabel("145 × 205 cm (Custom)"), "145 × 205 cm (Custom)");
  assert.equal(formatUkuranLabel("180x200 cm (King)"), "180 × 200 cm");
  assert.equal(formatUkuranLabel(null), "");
  assert.equal(formatUkuranLabel(undefined), "");
});

test("Validasi Lebar/Panjang: wajib, positif, batas wajar, maksimal satu desimal; pesan Bahasa Indonesia", () => {
  const ok = validasiUkuranCustom({ lebar: "145", panjang: "205,5" });
  assert.deepEqual([ok.ok, ok.lebarCm, ok.panjangCm], [true, 145, 205.5]);
  const kosong = validasiUkuranCustom({ lebar: "", panjang: undefined });
  assert.equal(kosong.ok, false);
  assert.equal(kosong.galat.lebar, "Lebar (cm) wajib diisi.");
  assert.equal(kosong.galat.panjang, "Panjang (cm) wajib diisi.");
  for (const buruk of ["abc", "0", "-5", "12,34", "1e3", "145 cm", "  "]) {
    const v = validasiUkuranCustom({ lebar: buruk, panjang: "200" });
    assert.equal(v.ok, false, `"${buruk}" harus ditolak`);
  }
  assert.match(validasiUkuranCustom({ lebar: "abc", panjang: "200" }).galat.lebar, /angka positif/);
  assert.match(validasiUkuranCustom({ lebar: "10", panjang: "200" }).galat.lebar, /antara 30 dan 400 cm/);
  assert.match(validasiUkuranCustom({ lebar: "145", panjang: "401" }).galat.panjang, /antara 30 dan 400 cm/);
  assert.equal(validasiUkuranCustom({ lebar: "30", panjang: "400" }).ok, true, "batas inklusif");
  assert.equal(parseAngkaCm(145.3), 145.3);
  assert.equal(parseAngkaCm("1.234"), null);
});

test("siapkanNotesUkuran: custom klien baru divalidasi & disimpan sebagai angka; standar membuang angka custom; klien lama/legacy diteruskan apa adanya", () => {
  // custom valid → angka ternormalisasi
  const a = JSON.parse(siapkanNotesUkuran(JSON.stringify({ merkKasur: "Sano", ukuranKasur: "Ukuran Custom", ukuranLebarCm: "145,5", ukuranPanjangCm: "205", keluhanCustomer: "x" })));
  assert.equal(a.ukuranLebarCm, 145.5); assert.equal(a.ukuranPanjangCm, 205); assert.equal(a.keluhanCustomer, "x");
  // custom dengan kunci angka tapi kosong/tidak valid → 400 Indonesia
  assert.throws(() => siapkanNotesUkuran(JSON.stringify({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: "", ukuranPanjangCm: "" })), (e) => e.statusCode === 400 && /Lebar \(cm\) wajib diisi/.test(e.message) && /Panjang \(cm\) wajib diisi/.test(e.message));
  assert.throws(() => siapkanNotesUkuran(JSON.stringify({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: 145, ukuranPanjangCm: 9999 })), /antara 30 dan 400 cm/);
  // pindah ke standar → angka custom dibuang
  const b = JSON.parse(siapkanNotesUkuran(JSON.stringify({ ukuranKasur: "160x200 cm (Queen)", ukuranLebarCm: 145, ukuranPanjangCm: 205, merkKasur: "Sano" })));
  assert.equal("ukuranLebarCm" in b, false); assert.equal("ukuranPanjangCm" in b, false); assert.equal(b.merkKasur, "Sano");
  // tidak berubah persis (string sama) bila tidak perlu
  const polos = JSON.stringify({ ukuranKasur: "160x200 cm (Queen)", merkKasur: "Sano" });
  assert.equal(siapkanNotesUkuran(polos), polos);
  // legacy: custom tanpa kunci angka (klien lama / edit keluhan) TIDAK ditolak dan TIDAK ditebak
  const legacy = JSON.stringify({ ukuranKasur: "Ukuran Custom", keluhanCustomer: "pegal" });
  assert.equal(siapkanNotesUkuran(legacy), legacy);
  // bukan JSON / teks polos → apa adanya
  assert.equal(siapkanNotesUkuran("catatan bebas"), "catatan bebas");
  assert.equal(siapkanNotesUkuran(undefined), undefined);
});

test("ukuranUntukUnit: unit baru memuat ukuran aktual untuk custom; standar tetap label; custom lama tetap 'Ukuran Custom' (tidak ditebak)", () => {
  assert.equal(ukuranUntukUnit({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: 145, ukuranPanjangCm: 205 }), "145 × 205 cm (Custom)");
  assert.equal(ukuranUntukUnit({ ukuranKasur: "Ukuran Custom" }), "Ukuran Custom");
  assert.equal(ukuranUntukUnit({ ukuranKasur: "160x200 cm (Queen)" }), "160x200 cm (Queen)");
  assert.equal(ukuranUntukUnit({ ukuranKasur: "" }), null);
});

test("Invoice/WA: parseOrderNotesForInvoice memberi teks tampil bersama", () => {
  const n = (o) => JSON.stringify(o);
  assert.equal(parseOrderNotesForInvoice(n({ merkKasur: "Sano", ukuranKasur: "Ukuran Custom", ukuranLebarCm: 145, ukuranPanjangCm: 205 })).ukuranKasur, "145 × 205 cm (Custom)");
  assert.equal(parseOrderNotesForInvoice(n({ ukuranKasur: "Ukuran Custom" })).ukuranKasur, "Ukuran Custom (ukuran belum diisi)");
  assert.equal(parseOrderNotesForInvoice(n({ ukuranKasur: "180x200 cm (King)" })).ukuranKasur, "180 × 200 cm");
  assert.equal(parseOrderNotesForInvoice(null).ukuranKasur, "");
});

test("PARITAS: salinan frontend menghasilkan keluaran identik dengan backend (formatter & validasi)", () => {
  const labels = ["", "Ukuran Custom", "160x200 cm (Queen)", "100 x 200", "145 × 205 cm (Custom)", "3 seater", "84x195x12", "90x200 cm (Single)", "200x200 cm (King Besar)"];
  const angka = [undefined, null, "", "145", "145,5", 145, 145.5, 29, 401, "abc", "12,34", 0, -1];
  for (const l of labels) {
    assert.equal(fe.formatUkuranLabel(l), be.formatUkuranLabel(l), `label "${l}"`);
    for (const w of angka) for (const p of [undefined, 205, "205,5"]) {
      const info = { ukuranKasur: l, ukuranLebarCm: w, ukuranPanjangCm: p };
      assert.equal(fe.formatUkuranKasur(info), be.formatUkuranKasur(info), JSON.stringify(info));
    }
  }
  for (const w of angka) for (const p of angka) assert.deepEqual(fe.validasiUkuranCustom({ lebar: w, panjang: p }), be.validasiUkuranCustom({ lebar: w, panjang: p }), `${w}/${p}`);
  for (const k of ["UKURAN_CUSTOM_LABEL", "UKURAN_CUSTOM_MIN_CM", "UKURAN_CUSTOM_MAX_CM", "UKURAN_CUSTOM_BELUM_DIISI"]) assert.equal(fe[k], be[k], k);
  assert.equal(fe.isUkuranCustom("ukuran custom"), isUkuranCustom("ukuran custom"));
  for (const n of ["", null, "{", JSON.stringify({ ukuranKasur: "Ukuran Custom", ukuranLebarCm: 145, ukuranPanjangCm: 205 })]) assert.equal(fe.teksUkuranDariNotes(n), be.teksUkuranDariNotes(n));
});
