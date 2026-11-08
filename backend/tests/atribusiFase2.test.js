// Fase 2: kode klik per orang, Linktree, chat dimulai sales, aturan relabel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  encodeRefTag, extractRefTag, tagKlik, klikIdDariTag, leadSourceFromRefTag, matchCampaignByMessage,
} from "../src/services/leadAttribution.js";
import { TEKS_TOMBOL_WEBSITE_TETAP, saringTemplateIklan, cocokkanTemplateIklan } from "../src/services/templateIklan.js";
import { nilaiLead } from "../scripts/relabel-sumber-lead.js";

const baca = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const TEKS_TIKTOK = "halo sano, saya lihat di tiktok dan mau tanya-tanya soal kasur";
const konteks = {
  teksTikTok: [TEKS_TIKTOK],
  teksWebsite: TEKS_TOMBOL_WEBSITE_TETAP,
  teksMeta: ["minta estimasi harga dan proses pengerjaan"],
};
const lead = (x) => ({ sumber: "WHATSAPP_DIRECT", detail: null, clid: false, dikonfirmasi: false, adaKlik: false, adaPesan: true, arahPertama: "INBOUND", teks: "halo kak", keluarSebelumCustomer: false, selangMasukMs: 0, ...x });

test("kode klik selamat bolak-balik dan tidak mengganggu teks", () => {
  const id = "cmh3k2j9x0001abcd1234efgh";
  const pesan = `Halo Sano, saya lihat di TikTok${encodeRefTag(tagKlik(id))} dan satu lagi`;
  const { tag, cleaned } = extractRefTag(pesan);
  assert.equal(klikIdDariTag(tag), id);
  assert.equal(cleaned, "Halo Sano, saya lihat di TikTok dan satu lagi");
});

test("tag kanal biasa bukan kode klik", () => {
  assert.equal(klikIdDariTag("google-cpc-brand"), null);
  assert.equal(klikIdDariTag(null), null);
  assert.equal(klikIdDariTag("klik-"), null);
});

test("teks link tetap cocok walau membawa kode klik di ujung", () => {
  const link = { id: "1", name: "TikTok", category: "TIKTOK_ADS", prefilledMessage: TEKS_TIKTOK };
  assert.equal(matchCampaignByMessage(`${TEKS_TIKTOK}${encodeRefTag(tagKlik("abc"))}`, [link]), link);
});

test("redirect hanya memasang kode pada klik manusia", () => {
  const src = baca("../src/routes/tracking.js");
  assert.match(src, /let kodeKlik = "";/);
  assert.match(src, /kodeKlik = encodeRefTag\(tagKlik\(klik\.id\)\)/);
  assert.match(src, /\$\{link\.prefilledMessage\}\$\{kodeKlik\}/);
});

test("webhook: clid mengalahkan tag, chat dimulai sales bukan WA Langsung", () => {
  const src = baca("../src/routes/webhooks.js");
  assert.match(src, /sumberCtwa && \(ctwa\.clid \|\| detectedSource === "WHATSAPP_DIRECT"\)/);
  assert.match(src, /leadSource: "OTHER", leadSourceDetail: DETAIL_DIMULAI_SALES/);
  assert.ok(src.indexOf("klikIdDariTag(refTag)") < src.indexOf("extractCtwaContext(payload)"));
});

test("Linktree masuk OTHER, bukan REFERRAL; tag lain tetap", () => {
  assert.equal(leadSourceFromRefTag("linktree-referral"), "OTHER");
  assert.equal(leadSourceFromRefTag("referral-x"), "REFERRAL");
  assert.equal(leadSourceFromRefTag("ig-social"), "INSTAGRAM");
  assert.equal(leadSourceFromRefTag("google-organic"), "WEBSITE_ORGANIC");
  assert.equal(leadSourceFromRefTag("google-cpc-brand"), "GOOGLE_ADS");
  assert.equal(leadSourceFromRefTag("tiktok-social"), "OTHER");
});

test("semua teks website dikenali, teks iklan & sapaan tidak", () => {
  for (const t of ["Halo Sano Care, saya ingin konsultasi mengenai kasur saya.", "Halo Sano, saya tertarik Paket Premium", "Halo Sano, saya ingin analisa kasur karena ada keluhan sakit."]) {
    assert.ok(cocokkanTemplateIklan(t, TEKS_TOMBOL_WEBSITE_TETAP), t);
  }
  for (const t of ["Halo Sano", "Halo Sano, saya lihat iklannya", "Halo Sano, saya mau tanya harga"]) {
    assert.equal(cocokkanTemplateIklan(t, TEKS_TOMBOL_WEBSITE_TETAP), null, t);
  }
  assert.deepEqual(saringTemplateIklan(["halo sano, saya tertarik paket premium banget"]), []);
});

test("relabel: tebakan TikTok diturunkan sesuai buktinya", () => {
  assert.equal(nilaiLead(lead({ sumber: "TIKTOK_ADS", adaKlik: true }), konteks).aturan, "hanya-klik");
  assert.equal(nilaiLead(lead({ sumber: "TIKTOK_ADS", adaKlik: true, teks: "Halo Sano, saya tertarik konsultasi" }), konteks).sumber, "WEBSITE_ORGANIC");
  assert.equal(nilaiLead(lead({ sumber: "TIKTOK_ADS", adaKlik: true, teks: "Minta estimasi harga dan proses pengerjaan" }), konteks).sumber, "META_ADS");
  assert.equal(nilaiLead(lead({ sumber: "TIKTOK_ADS", adaKlik: true, teks: TEKS_TIKTOK }), konteks), null);
});

test("relabel: yang tidak boleh disentuh tetap", () => {
  assert.equal(nilaiLead(lead({ sumber: "TIKTOK_ADS", dikonfirmasi: true }), konteks), null);
  assert.equal(nilaiLead(lead({ sumber: "INSTAGRAM", teks: "Halo Sano, saya tertarik konsultasi" }), konteks), null);
  assert.equal(nilaiLead(lead({ sumber: "META_ADS", clid: true, teks: "Halo Sano, saya tertarik konsultasi" }), konteks), null);
  assert.equal(nilaiLead(lead({ sumber: "WEBSITE_ORGANIC", detail: "Website - ig-social" }), konteks), null);
  assert.equal(nilaiLead(lead({ sumber: "META_ADS", detail: "Meta CTWA - whatsapp - wa.me/wamo/status" }), konteks), null);
  assert.equal(nilaiLead(lead({ sumber: "META_ADS", teks: "halo" }), konteks), null);
  assert.equal(nilaiLead(lead({ sumber: "WEBSITE_ORGANIC", teks: "halo" }), konteks), null);
  assert.equal(nilaiLead(lead({ adaPesan: false, arahPertama: null, teks: null }), konteks), null);
});

test("relabel: dimulai sales butuh selang nyata, bukan urutan pesan yang tertukar", () => {
  assert.equal(nilaiLead(lead({ arahPertama: "OUTBOUND", selangMasukMs: 3600000 }), konteks).aturan, "dimulai-sales");
  assert.equal(nilaiLead(lead({ arahPertama: "OUTBOUND", selangMasukMs: null, teks: null }), konteks).aturan, "dimulai-sales");
  assert.equal(nilaiLead(lead({ arahPertama: "OUTBOUND", selangMasukMs: 30000 }), konteks), null);
  assert.equal(nilaiLead(lead({ arahPertama: "OUTBOUND", selangMasukMs: 3600000, keluarSebelumCustomer: true }), konteks), null);
});
