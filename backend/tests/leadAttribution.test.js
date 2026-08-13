// Tes pencocokan pesan pertama customer -> campaign (atribusi sumber lead).
//
// Logika ini menentukan angka yang dipakai untuk keputusan belanja iklan,
// jadi yang paling penting diuji BUKAN kasus normalnya — tapi kasus di mana
// fungsi ini HARUS MENYERAH. Salah atribusi tidak kelihatan salah di
// laporan; dia cuma diam-diam memindahkan kredit dari satu campaign ke
// campaign lain, dan keputusan budget ikut salah tanpa ada yang curiga.

import test from "node:test";
import assert from "node:assert/strict";

import {
  matchCampaignByMessage, extractRefTag, leadSourceFromRefTag,
  extractCtwaContext, leadSourceFromCtwa, ctwaDetail,
} from "../src/services/leadAttribution.js";

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

// --- tag referral dari website (PMax/Search -> website -> WA) -------------
//
// Format AKTIF sekarang: zero-width Unicode (tak terlihat sama sekali di
// WhatsApp). Helper encode di bawah ini SENGAJA meniru persis skema di
// utils/attribution.ts (SANO-WEB) -- kalau salah satu diubah, yang lain
// harus ikut diubah, dan tes ini yang pertama gagal kalau lupa.
const TEST_REF_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789-";
const TEST_BIT0 = String.fromCharCode(0x200b);
const TEST_BIT1 = String.fromCharCode(0x200c);
const TEST_START = String.fromCharCode(0x200d) + String.fromCharCode(0x200d);
const TEST_END = String.fromCharCode(0x2060) + String.fromCharCode(0x2060);

function encodeInvisibleTagForTest(tag) {
  let payload = "";
  for (const ch of tag) {
    const idx = TEST_REF_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    const bits = idx.toString(2).padStart(6, "0");
    for (const bit of bits) payload += bit === "1" ? TEST_BIT1 : TEST_BIT0;
  }
  return TEST_START + payload + TEST_END;
}

test("extractRefTag (tak terlihat): round-trip encode->decode kembalikan tag yang sama", () => {
  const pesan = `Halo Sano, saya tertarik konsultasi${encodeInvisibleTagForTest("google-cpc-brand")}`;
  const { cleaned, tag } = extractRefTag(pesan);
  assert.equal(tag, "google-cpc-brand");
  assert.equal(cleaned, "Halo Sano, saya tertarik konsultasi");
});

test("extractRefTag (tak terlihat): customer NAMBAH teks setelah tag -> tetap kena", () => {
  // Ini skenario yang tadinya BOCOR di versi kasat mata (regex diwajibkan
  // pas di ujung kalimat) -- kursor WA default di akhir teks, jadi
  // customer yang mengetik tambahan taruh teksnya SETELAH tag.
  const pesan = `Halo Sano, saya tertarik konsultasi${encodeInvisibleTagForTest("google-pmax")} kasur saya juga amblas`;
  const { cleaned, tag } = extractRefTag(pesan);
  assert.equal(tag, "google-pmax");
  assert.equal(cleaned, "Halo Sano, saya tertarik konsultasi kasur saya juga amblas");
});

test("extractRefTag (tak terlihat): marker ketemu tapi payload rusak -> tag null, marker tetap dibuang", () => {
  const rusak = `Halo Sano${TEST_START}xxx${TEST_END}`; // payload bukan kelipatan 6 / karakter bukan bit
  const { cleaned, tag } = extractRefTag(rusak);
  assert.equal(tag, null);
  assert.equal(cleaned, "Halo Sano"); // marker tetap dibersihkan, jangan sampai nyasar ke chat
});

test("extractRefTag: pola LAMA kasat mata \"(ref: ...)\" tetap jadi jaring cadangan", () => {
  // Bukan lagi jalur utama, tapi murah dipertahankan untuk tab browser
  // lama yang mungkin masih memuat versi website sebelum tag disembunyikan.
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

// --- Iklan Meta Click-to-WhatsApp (CTWA) ---------------------------------
//
// Struktur payload di bawah DISALIN DARI LOG PRODUCTION ASLI (13 Agt 2026),
// bukan karangan — versi kode SEBELUMNYA gagal total justru karena path-nya
// ditebak dari dokumentasi dan ternyata tidak pernah ada di payload nyata.
// Kalau WAHA/WhatsApp mengubah bentuk payload, tes inilah yang harus gagal
// duluan, bukan diam-diam berhenti mengatribusi ribuan lead.
const PAYLOAD_CTWA_ASLI = {
  id: "false_628xxx@c.us_ABC123",
  from: "628xxx@c.us",
  _data: {
    Info: { Chat: "628xxx@c.us", Type: "text", PushName: "Budi" },
    Message: {
      extendedTextMessage: {
        text: "Halo, saya mau tanya kasur",
        contextInfo: {
          conversionSource: "FB_Ads",
          entryPointConversionSource: "ctwa_ad",
          entryPointConversionApp: "facebook",
          entryPointConversionDelaySeconds: 24,
          ctwaSignals: "all,all",
          externalAdReply: {
            sourceURL: "https://www.instagram.com/p/DXWbO-EAOeT/",
            ctwaClid: "AfhKBK8ZBWyKw3p49jW-KFh_rNlyzXmCKW0eSdHULJZt8",
            containsCtwaFlowsAutoReply: false,
          },
        },
      },
    },
  },
};

test("CTWA: baca konteks iklan dari struktur payload production yang nyata", () => {
  const ctwa = extractCtwaContext(PAYLOAD_CTWA_ASLI);
  assert.ok(ctwa, "harus terdeteksi");
  assert.equal(ctwa.clid, "AfhKBK8ZBWyKw3p49jW-KFh_rNlyzXmCKW0eSdHULJZt8");
  assert.equal(ctwa.sourceUrl, "https://www.instagram.com/p/DXWbO-EAOeT/");
  assert.equal(ctwa.conversionSource, "FB_Ads");
  assert.equal(ctwa.app, "facebook");
});

test("CTWA: konteks iklan -> META_ADS", () => {
  assert.equal(leadSourceFromCtwa(extractCtwaContext(PAYLOAD_CTWA_ASLI)), "META_ADS");
});

test("CTWA: keterangan berisi platform + kreatif yang dipakai", () => {
  const detail = ctwaDetail(extractCtwaContext(PAYLOAD_CTWA_ASLI));
  assert.equal(detail, "Meta CTWA - facebook - instagram.com/p/DXWbO-EAOeT");
});

test("CTWA: tipe pesan SELAIN extendedTextMessage tetap kebaca", () => {
  // Iklan dengan gambar/video masuk sebagai imageMessage/videoMessage —
  // kalau tipe pesannya di-hardcode, lead dari kreatif visual hilang diam-diam.
  const payloadGambar = {
    _data: { Message: { imageMessage: { contextInfo: {
      conversionSource: "FB_Ads",
      externalAdReply: { ctwaClid: "Afh_gambar_123", sourceURL: "https://fb.com/ad/9" },
    } } } },
  };
  const ctwa = extractCtwaContext(payloadGambar);
  assert.equal(ctwa?.clid, "Afh_gambar_123");
  assert.equal(leadSourceFromCtwa(ctwa), "META_ADS");
});

test("CTWA: pesan REPLY biasa TIDAK dianggap iklan", () => {
  // contextInfo juga muncul saat orang me-reply chat. Tanpa penjagaan ini,
  // setiap balasan customer akan salah dilabeli iklan Meta berbayar —
  // dan angka belanja iklan jadi omong kosong.
  const payloadReply = {
    _data: { Message: { extendedTextMessage: { contextInfo: {
      stanzaId: "ABC", participant: "628xxx@c.us",
      quotedMessage: { conversation: "pesan sebelumnya" },
    } } } },
  };
  assert.equal(extractCtwaContext(payloadReply), null);
  assert.equal(leadSourceFromCtwa(null), null);
});

test("CTWA: ada contextInfo tapi BUKAN penanda iklan -> menyerah, jangan klaim META_ADS", () => {
  // Entry point non-iklan (QR code, link profil) tidak boleh dihitung
  // sebagai iklan berbayar — lebih baik jatuh ke lapis berikutnya.
  const bukanIklan = { conversionSource: "qr_code", entryPoint: "profile_link", clid: null };
  assert.equal(leadSourceFromCtwa(bukanIklan), null);
});

test("CTWA: payload polos / kosong tidak melempar error", () => {
  assert.equal(extractCtwaContext({}), null);
  assert.equal(extractCtwaContext(null), null);
  assert.equal(extractCtwaContext({ _data: { Message: null } }), null);
  assert.equal(ctwaDetail(null), null);
});
