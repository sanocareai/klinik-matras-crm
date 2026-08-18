// Pencocokan teks template iklan Meta CTWA.
//
// Fokus utama tes ini: JANGAN sampai lead organik ditandai sebagai iklan.
// Salah ke arah itu tidak kelihatan salah di laporan, tapi langsung
// menyesatkan keputusan belanja iklan.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalisasi, cocokkanTemplateIklan, PANJANG_MIN, MIN_KEMUNCULAN,
} from "../src/services/templateIklan.js";

// Template asli dari produksi (sudah ternormalisasi).
const TEMPLATE = [
  "minta estimasi harga dan proses pengerjaan",
  "kasur amblas, terlalu empuk, atau terlalu keras",
  "ingin upgrade kasur lama agar lebih nyaman",
  "ingin upgrade kasur lama agar lebih nyaman dan sehat",
  "bangun tidur terasa pegal atau kurang nyaman",
  "bangun tidur badan pegal, sakit pinggang, sakit bahu, syaraf kejepit/skoliosis",
  "kasur sudah amblas, atau kotor, terlalu keras/empuk",
  "kasur rusak, per nonjok, amblas tengah, atau lainnya",
  "mau ubah kasur jadi orthopedic (kesehatan)",
];

describe("normalisasi", () => {
  test("huruf kecil, spasi dirapatkan, dipangkas", () => {
    assert.equal(normalisasi("  Minta   ESTIMASI\n harga  "), "minta estimasi harga");
  });
  test("nilai kosong aman", () => {
    assert.equal(normalisasi(null), "");
    assert.equal(normalisasi(undefined), "");
  });
});

describe("cocokkanTemplateIklan — kasus nyata produksi", () => {
  test("teks template persis dikenali", () => {
    assert.equal(
      cocokkanTemplateIklan("Minta estimasi harga dan proses pengerjaan", TEMPLATE),
      "minta estimasi harga dan proses pengerjaan",
    );
  });

  test("customer menambah kalimat sendiri di belakang tetap kena", () => {
    assert.equal(
      cocokkanTemplateIklan("Minta estimasi harga dan proses pengerjaan utk ukuran 180*200", TEMPLATE),
      "minta estimasi harga dan proses pengerjaan",
    );
  });

  test("beda huruf besar/kecil & spasi berlebih tetap kena", () => {
    assert.equal(
      cocokkanTemplateIklan("KASUR AMBLAS,  terlalu empuk, atau terlalu keras", TEMPLATE),
      "kasur amblas, terlalu empuk, atau terlalu keras",
    );
  });

  test("template lebih PANJANG menang atas yang jadi awalannya", () => {
    // "ingin upgrade kasur lama agar lebih nyaman" adalah awalan dari
    // "...dan sehat" — yang spesifik harus menang, kalau tidak angkanya
    // masuk ke kelompok iklan yang salah.
    assert.equal(
      cocokkanTemplateIklan("Ingin upgrade kasur lama agar lebih nyaman dan sehat", TEMPLATE),
      "ingin upgrade kasur lama agar lebih nyaman dan sehat",
    );
  });
});

describe("cocokkanTemplateIklan — JANGAN salah tandai lead organik", () => {
  test("pertanyaan generik pendek tidak cocok ke template mana pun", () => {
    for (const teks of ["Lokasi dimana?", "halo kak", "p", "Berapa harganya?", "Assalamualaikum"]) {
      assert.equal(cocokkanTemplateIklan(teks, TEMPLATE), null, `"${teks}" seharusnya TIDAK cocok`);
    }
  });

  test("teks tombol WA website BUKAN template iklan Meta", () => {
    // Ini teks tombol di sanomatrassehat.com — sumbernya Website/Google,
    // bukan Meta. Kalau ikut terjaring, lead Google akan dikreditkan ke Meta.
    assert.equal(cocokkanTemplateIklan("Halo Sano, saya tertarik konsultasi", TEMPLATE), null);
  });

  test("kata template yang muncul di TENGAH kalimat tidak dianggap cocok", () => {
    // Cocok hanya sebagai AWALAN — kalimat yang kebetulan menyebut frasa
    // serupa di tengah adalah tulisan customer sendiri, bukan prefilled.
    assert.equal(
      cocokkanTemplateIklan("Saya mau minta estimasi harga dan proses pengerjaan", TEMPLATE),
      null,
    );
  });

  test("daftar template kosong tidak pernah mencocokkan apa pun", () => {
    assert.equal(cocokkanTemplateIklan("Minta estimasi harga dan proses pengerjaan", []), null);
    assert.equal(cocokkanTemplateIklan("Minta estimasi harga dan proses pengerjaan", null), null);
  });

  test("pesan kosong/null aman", () => {
    assert.equal(cocokkanTemplateIklan("", TEMPLATE), null);
    assert.equal(cocokkanTemplateIklan(null, TEMPLATE), null);
  });
});

describe("ambang penjaga", () => {
  test("PANJANG_MIN memisahkan template asli dari pertanyaan generik", () => {
    // Diverifikasi di produksi: template terpendek 42 karakter,
    // teks generik terpanjang yang sempat terjaring 14 ("lokasi dimana?").
    assert.ok(PANJANG_MIN > 14, "harus di atas teks generik terpanjang");
    assert.ok(PANJANG_MIN < 42, "harus di bawah template asli terpendek");
    for (const t of TEMPLATE) {
      assert.ok(t.length >= PANJANG_MIN, `template "${t}" harus lolos ambang panjang`);
    }
  });

  test("MIN_KEMUNCULAN menutup kebetulan sekali-dua kali", () => {
    assert.ok(MIN_KEMUNCULAN >= 5);
  });
});

describe("teks tombol WA website vs template iklan Meta — jangan tertukar", () => {
  // Teks tombol website yang terverifikasi dari lead bertag kanal asli.
  const TOMBOL_WEB = [
    "halo sano, saya tertarik konsultasi",
    "halo sano, saya tertarik konsultasi gratis",
    "halo sano, saya tertarik paket premium",
  ];

  test("teks tombol website dikenali sebagai website", () => {
    assert.equal(
      cocokkanTemplateIklan("Halo Sano, saya tertarik konsultasi", TOMBOL_WEB),
      "halo sano, saya tertarik konsultasi",
    );
  });

  test("varian lebih panjang menang — 'gratis' tidak tertelan varian pendek", () => {
    assert.equal(
      cocokkanTemplateIklan("Halo Sano, saya tertarik konsultasi gratis", TOMBOL_WEB),
      "halo sano, saya tertarik konsultasi gratis",
    );
  });

  test("template iklan Meta TIDAK cocok ke daftar tombol website", () => {
    // Kalau tertukar, lead Meta akan dikreditkan ke Website — persis
    // kesalahan arah sebaliknya yang ingin dicegah.
    assert.equal(cocokkanTemplateIklan("Minta estimasi harga dan proses pengerjaan", TOMBOL_WEB), null);
  });

  test("sapaan biasa 'halo sano' saja TIDAK dianggap dari website", () => {
    // 9 karakter — di bawah PANJANG_MIN, dan memang wajar diketik siapa pun.
    assert.equal(cocokkanTemplateIklan("halo sano", TOMBOL_WEB), null);
    assert.equal(cocokkanTemplateIklan("Halo Sano, mau tanya harga", TOMBOL_WEB), null);
  });
});
