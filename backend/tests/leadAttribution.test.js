// Tes pencocokan pesan pertama customer -> campaign (atribusi sumber lead).
//
// Logika ini menentukan angka yang dipakai untuk keputusan belanja iklan,
// jadi yang paling penting diuji BUKAN kasus normalnya — tapi kasus di mana
// fungsi ini HARUS MENYERAH. Salah atribusi tidak kelihatan salah di
// laporan; dia cuma diam-diam memindahkan kredit dari satu campaign ke
// campaign lain, dan keputusan budget ikut salah tanpa ada yang curiga.

import test from "node:test";
import assert from "node:assert/strict";

import { matchCampaignByMessage, extractRefTag, leadSourceFromRefTag } from "../src/services/leadAttribution.js";

const LINKS = [
  { id: "g1", name: "Google - Brand", category: "GOOGLE_ADS", prefilledMessage: "Halo Sano, saya mau konsultasi" },
  { id: "m1", name: "Meta - Nyeri Punggung", category: "META_ADS", prefilledMessage: "Halo Sano, saya mau tanya soal nyeri punggung" },
];

test("pesan persis sama dengan teks campaign -> kena", () => {
  const hit = matchCampaignByMessage("Halo Sano, saya mau tanya soal nyeri punggung", LINKS);
  assert.equal(hit?.id, "m1");
});

test("customer menambahkan kalimatnya sendiri di belakang -> tetap kena", () => {
  // Pola paling sering di lapangan: teks bawaan dibiarkan, lalu diketik
  // tambahan. Kalau ini tidak kena, sebagian besar klik iklan hilang.
  const hit = matchCampaignByMessage(
    "Halo Sano, saya mau tanya soal nyeri punggung. Umur saya 40th, berat 80kg",
    LINKS
  );
  assert.equal(hit?.id, "m1");
});

test("beda huruf besar-kecil & spasi berlebih tetap kena", () => {
  const hit = matchCampaignByMessage("  halo sano,   SAYA mau konsultasi  ", LINKS);
  assert.equal(hit?.id, "g1");
});

test("campaign paling SPESIFIK menang, bukan yang jadi awalannya", () => {
  // "Halo Sano, saya mau konsultasi" adalah awalan dari teks campaign B.
  // Pesan yang cocok dua-duanya harus jatuh ke yang lebih panjang/spesifik.
  const links = [
    { id: "umum", category: "GOOGLE_ADS", prefilledMessage: "Halo Sano, saya mau konsultasi" },
    { id: "spesifik", category: "META_ADS", prefilledMessage: "Halo Sano, saya mau konsultasi soal kasur anak" },
  ];
  const hit = matchCampaignByMessage("Halo Sano, saya mau konsultasi soal kasur anak", links);
  assert.equal(hit?.id, "spesifik");
});

test("dua campaign pakai teks IDENTIK -> menyerah (null), jangan menebak", () => {
  // Ini yang melindungi angka laporan. Kalau admin lupa membedakan teks
  // prefilled antar campaign, sistem HARUS mengaku tidak tahu — bukan
  // memilih salah satu dan membuat laporan yang terlihat meyakinkan.
  const kembar = [
    { id: "a", category: "GOOGLE_ADS", prefilledMessage: "Halo Sano, saya mau konsultasi" },
    { id: "b", category: "META_ADS", prefilledMessage: "Halo Sano, saya mau konsultasi" },
  ];
  assert.equal(matchCampaignByMessage("Halo Sano, saya mau konsultasi", kembar), null);
});

test("pesan yang customer ketik sendiri -> null (jatuh ke Lapis 2)", () => {
  assert.equal(matchCampaignByMessage("pagi kak, kasur saya amblas bisa diperbaiki?", LINKS), null);
});

test("pesan kosong / tidak ada link aktif -> null, tidak melempar error", () => {
  assert.equal(matchCampaignByMessage("", LINKS), null);
  assert.equal(matchCampaignByMessage(null, LINKS), null);
  assert.equal(matchCampaignByMessage("Halo Sano, saya mau konsultasi", []), null);
  assert.equal(matchCampaignByMessage("Halo Sano", undefined), null);
});

test("link dengan prefilledMessage kosong tidak pernah cocok dengan apa pun", () => {
  // Tanpa penjagaan ini, teks kosong jadi awalan SEMUA pesan (''.startsWith
  // selalu true) dan link itu akan menyedot seluruh lead masuk.
  const rusak = [{ id: "kosong", category: "OTHER", prefilledMessage: "" }];
  assert.equal(matchCampaignByMessage("halo mau tanya kasur", rusak), null);
});

// --- tag "(ref: ...)" dari website (PMax/Search -> website -> WA) ---------

test("extractRefTag: pisahkan tag dari pesan, sisakan teks asli tanpa tag", () => {
  const { cleaned, tag } = extractRefTag("Halo Sano, saya tertarik konsultasi (ref: google-cpc-brand)");
  assert.equal(cleaned, "Halo Sano, saya tertarik konsultasi");
  assert.equal(tag, "google-cpc-brand");
});

test("extractRefTag: tag besar/kecil dinormalisasi ke huruf kecil", () => {
  const { tag } = extractRefTag("Halo (REF: Google-PMax)");
  assert.equal(tag, "google-pmax");
});

test("extractRefTag: pesan tanpa tag -> cleaned SAMA PERSIS, tag null", () => {
  // Kritis: mayoritas pesan masuk TIDAK datang dari website (organik,
  // TrackedLink, dst) -- fungsi ini tidak boleh mengubah teksnya sedikit
  // pun kalau memang tidak ada tag.
  const pesan = "pagi kak, kasur saya amblas bisa diperbaiki?";
  const hasil = extractRefTag(pesan);
  assert.equal(hasil.cleaned, pesan);
  assert.equal(hasil.tag, null);
});

test("extractRefTag: teks kosong/null tidak melempar error", () => {
  assert.equal(extractRefTag("").tag, null);
  assert.equal(extractRefTag(null).tag, null);
  assert.equal(extractRefTag(undefined).tag, null);
});

test("leadSourceFromRefTag: prefix google/meta -> LeadSource yang sesuai", () => {
  assert.equal(leadSourceFromRefTag("google-cpc-brand"), "GOOGLE_ADS");
  assert.equal(leadSourceFromRefTag("google-pmax"), "GOOGLE_ADS");
  assert.equal(leadSourceFromRefTag("meta-cpc"), "META_ADS");
});

test("leadSourceFromRefTag: prefix lain -> OTHER (bukan dikarang jadi salah satu platform)", () => {
  assert.equal(leadSourceFromRefTag("tiktok-ads"), "OTHER");
});

test("leadSourceFromRefTag: tidak ada tag -> null", () => {
  assert.equal(leadSourceFromRefTag(null), null);
  assert.equal(leadSourceFromRefTag(""), null);
});
