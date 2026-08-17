// Tes murni-logika untuk utils/mention.js — dijalankan dengan `node --test`
// dari folder mobile/. Sengaja .mjs & tanpa import React Native supaya bisa
// dites tanpa menyalakan emulator (mobile/ belum punya runner tes sendiri).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buatPetaMention, gantiMention, ambilMention, siapkanMentionUntukKirim,
} from "./mention.js";

// Data nyata dari grup "SANO SALES" di produksi.
const PESERTA = [
  { lid: "165811675242551", phone: "6287781861218", name: "bang richel Digital" },
  { lid: "11832752382105", phone: "6285692828241", name: "Jr" },
  { lid: "17961721041065", phone: "6287888747922", name: "Natasha S" },
  { lid: "219331296272411", phone: "628881996001", name: null }, // tidak ada di Customer
];

describe("buatPetaMention", () => {
  test("meng-index dengan LID maupun nomor telepon", () => {
    const peta = buatPetaMention(PESERTA);
    assert.equal(peta.get("165811675242551"), "bang richel Digital");
    assert.equal(peta.get("6287781861218"), "bang richel Digital");
  });

  test("anggota tanpa nama jatuh ke nomor yang enak dibaca, bukan LID", () => {
    const peta = buatPetaMention(PESERTA);
    assert.equal(peta.get("219331296272411"), "0888-1996-001");
  });

  test("daftar kosong/null tidak melempar error", () => {
    assert.equal(buatPetaMention(null).size, 0);
    assert.equal(buatPetaMention([]).size, 0);
  });
});

describe("gantiMention", () => {
  const peta = buatPetaMention(PESERTA);

  test("kasus nyata dari produksi", () => {
    assert.equal(
      gantiMention("jatinangor itu bukannya udh lewat bandung ya, pak? @11832752382105 🙏", peta),
      "jatinangor itu bukannya udh lewat bandung ya, pak? @Jr 🙏",
    );
  });

  test("beberapa mention menempel tanpa spasi", () => {
    assert.equal(
      gantiMention("Ini Rina tolong di respon dong @165811675242551@17961721041065", peta),
      "Ini Rina tolong di respon dong @bang richel Digital@Natasha S",
    );
  });

  test("LID tak dikenal DIBIARKAN apa adanya — jangan menebak nama", () => {
    assert.equal(gantiMention("cek @999888777666555", peta), "cek @999888777666555");
  });

  test("angka pendek bukan mention (tahun, nominal, nomor order)", () => {
    assert.equal(gantiMention("promo @2026 diskon", peta), "promo @2026 diskon");
  });

  test("peta kosong mengembalikan teks utuh", () => {
    assert.equal(gantiMention("halo @11832752382105", new Map()), "halo @11832752382105");
  });

  test("teks kosong/null aman", () => {
    assert.equal(gantiMention("", peta), "");
    assert.equal(gantiMention(null, peta), null);
  });
});

describe("ambilMention", () => {
  test("mengumpulkan semua id yang di-mention", () => {
    assert.deepEqual(
      ambilMention("@270862733279339 @165811675242551 oke"),
      ["270862733279339", "165811675242551"],
    );
  });

  test("tidak ada mention -> array kosong", () => {
    assert.deepEqual(ambilMention("halo semua"), []);
  });
});

describe("siapkanMentionUntukKirim", () => {
  const picks = [
    { name: "Jr", phone: "6285692828241" },
    { name: "Natasha S", phone: "6287888747922" },
  ];

  test("nama di composer jadi nomor untuk WhatsApp", () => {
    const { text, mentions } = siapkanMentionUntukKirim("tolong cek @Jr", picks);
    assert.equal(text, "tolong cek @6285692828241");
    assert.deepEqual(mentions, ["6285692828241"]);
  });

  test("nama yang lebih panjang diganti lebih dulu — 'Novi' tidak merusak 'Novia'", () => {
    const dua = [
      { name: "Novi", phone: "6285975004433" },
      { name: "Novia", phone: "6289999999999" },
    ];
    const { text, mentions } = siapkanMentionUntukKirim("halo @Novia", dua);
    assert.equal(text, "halo @6289999999999");
    assert.deepEqual(mentions, ["6289999999999"]);
  });

  test("mention yang sudah diedit/dihapus sales turun jadi teks biasa", () => {
    const { text, mentions } = siapkanMentionUntukKirim("tolong cek @Jrr", picks);
    assert.equal(text, "tolong cek @Jrr");
    assert.deepEqual(mentions, []);
  });

  test("orang yang sama di-mention dua kali cuma sekali di daftar mentions", () => {
    const { mentions } = siapkanMentionUntukKirim("@Jr dan @Jr", picks);
    assert.deepEqual(mentions, ["6285692828241"]);
  });

  test("nama ber-karakter khusus regex tidak bikin error / salah cocok", () => {
    const aneh = [{ name: "Budi (CS)", phone: "6281111111111" }];
    const { text, mentions } = siapkanMentionUntukKirim("cek @Budi (CS) ya", aneh);
    assert.equal(text, "cek @6281111111111 ya");
    assert.deepEqual(mentions, ["6281111111111"]);
  });

  test("nama sebagai awalan nama lain tidak ikut terganti (batas kata)", () => {
    const p = [{ name: "Jr", phone: "6285692828241" }];
    assert.equal(siapkanMentionUntukKirim("@Jrr", p).text, "@Jrr");
    assert.equal(siapkanMentionUntukKirim("@Jr9", p).text, "@Jr9");
    // Tapi tanda baca/spasi setelah nama TETAP dianggap batas yang sah.
    assert.equal(siapkanMentionUntukKirim("@Jr, tolong", p).text, "@6285692828241, tolong");
    assert.equal(siapkanMentionUntukKirim("@Jr", p).text, "@6285692828241");
  });

  test("tanpa pick sama sekali, teks tidak berubah", () => {
    const { text, mentions } = siapkanMentionUntukKirim("halo semua", []);
    assert.equal(text, "halo semua");
    assert.deepEqual(mentions, []);
  });
});
