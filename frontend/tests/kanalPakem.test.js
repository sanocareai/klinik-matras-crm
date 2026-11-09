import { test } from "node:test";
import assert from "node:assert/strict";
import { PAKEM_KANAL, kelompokkanSumber, kelompokkanKreatif, pemilihChatMeta, cakupanTelusur, statusChat, keteranganTampil } from "../src/features/laporan/kanalPakem.js";

test("semua channel punya pakem lengkap", () => {
  for (const id of ["META", "TIKTOK", "GOOGLE", "WEBSITE", "INSTAGRAM", "WHATSAPP", "DIMULAI_SALES", "LAINNYA"]) {
    const p = PAKEM_KANAL[id];
    assert.ok(p?.apa && p.bukti && p.bukan, id);
  }
});

test("kelompok mengikuti urutan tetap, urutan di dalamnya dipertahankan, kelompok kosong hilang", () => {
  const g = kelompokkanSumber([
    { id: "WHATSAPP", kelompok: "Tanpa jejak" }, { id: "TIKTOK", kelompok: "Iklan berbayar" }, { id: "META", kelompok: "Iklan berbayar" }, { id: "X" },
  ]);
  assert.deepEqual(g.map((x) => x.nama), ["Iklan berbayar", "Tanpa jejak", "Lainnya"]);
  assert.deepEqual(g[0].baris.map((s) => s.id), ["TIKTOK", "META"]);
});

test("kreatif bernama sama digabung; baris belum terpetakan tidak ikut; biaya kosong bukan nol", () => {
  const baris = (nama, id, lead, order, nilai, spend, status = "MAPPED") => ({ status, ad: { id, nama }, lead: { unik: lead, spam: 1 }, customerDenganOrder: order, customerPernahMembayar: order, closingUtama: { customerLunasTerbuktiLedger: 0 }, bookedValue: nilai, uangBersihLedger: 0, biaya: { spend } });
  const k = kelompokkanKreatif([baris("VO", "1", 218, 4, 100, 50), baris("VO", "2", 105, 1, 10, 5), baris("Teks", "3", 400, 0, 0, null), baris(null, "4", 9, 0, 0, 1, "UNMAPPED")]);
  assert.deepEqual(k.map((x) => x.nama), ["Teks", "VO"]);
  assert.deepEqual([k[1].iklan, k[1].lead, k[1].berOrder, k[1].nilai, k[1].biaya, k[1].biayaAda], [2, 323, 5, 110, 55, true]);
  assert.equal(k[0].biayaAda, false);
});

test("pemilih chat tidak memberi kredit pada baris tanpa bukti", () => {
  assert.deepEqual(pemilihChatMeta({ level: "campaign", status: "MAPPED", campaign: { id: "1" } }), { campaignId: "1" });
  assert.deepEqual(pemilihChatMeta({ level: "adset", status: "MAPPED", adSet: { id: "2" } }), { adSetId: "2" });
  assert.deepEqual(pemilihChatMeta({ level: "ad", status: "MAPPED", ad: { id: "3" } }), { adId: "3" });
  assert.deepEqual(pemilihChatMeta({ level: "ad", status: "UNMAPPED", ad: { id: "4" } }), { adId: "4" });
  assert.equal(pemilihChatMeta({ level: "campaign", status: "UNMAPPED" }), null);
  assert.equal(pemilihChatMeta({ level: "campaign", status: "UNKNOWN" }), null);
});

test("cakupan telusur dan status chat", () => {
  assert.deepEqual(cakupanTelusur({ rekonMetaAds: { akuisisiTerbukti: 847, metaAdsCrmLeadBaru: 866 } }), { terbukti: 847, total: 866, tidakTerbaca: 19 });
  assert.equal(cakupanTelusur({ rekonMetaAds: null }), null);
  const rp = (n) => `Rp${n}`;
  assert.equal(statusChat({ spam: true, berOrder: false }, rp), "Spam");
  assert.equal(statusChat({ berOrder: true, nilaiOrder: 5, statusBayar: "Lunas" }, rp), "Ber-order Rp5, lunas");
  assert.equal(statusChat({ stage: "NEW" }, rp), "Lead baru");
  assert.equal(keteranganTampil("Kemungkinan TikTok, belum terbukti (hanya cocok klik)"), "Tanpa bukti sumber");
  assert.equal(keteranganTampil("Website - x"), "Website - x");
});
