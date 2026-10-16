// Logika murni tab "Iklan (Campaign)": parameter, drilldown, label, baris tabel, cakupan. Tanpa React.
import test from "node:test";
import assert from "node:assert/strict";
import { kueriIklan, drilldown, labelBaris, barisTabel, ringkasCakupan, peringatanUrut, statusBiaya, jejak, formatPersen } from "../src/features/laporan/iklanCampaignLogic.js";

const grup = (o = {}) => ({
  kunci: "52694481763084", level: "campaign", status: "MAPPED", campaign: { id: "52694481763084", nama: "Jabo IG Oktober" }, adSet: null, ad: null, jumlahAd: 2,
  lead: { unik: 10, spam: 2, bukanSpam: 8, leadSah: 8 }, pernahDitandaiProspek: { berTanggal: 1, tanpaTanggal: 2, jumlah: 3 },
  customerDenganOrder: 4, orderEligible: 5, orderPernahDp: 2, customerLunasMenurutCrm: 3, closingUtama: { customerLunasTerbuktiLedger: 2 },
  bookedValue: 7_500_000, uangLedger: 6_750_000, cakupanLedger: { persenOrderBerLedger: 80 },
  reaktivasi: { touch: 2, customerUnik: 2 }, assisted: { touch: 1, customerUnik: 1 }, touchTanpaBukti: { touch: 0, customerUnik: 0 },
  kematangan: { hari7: { leadMatang: 6, customerDenganOrder: 2, orderEligible: 3, bookedValue: 3_000_000, customerLunasTerbuktiLedger: 1, uangLedger: 2_000_000 }, hari30: {}, hari60: {} },
  ...o,
});

test("kueriIklan: tanpa rentang → server memakai 7 hari; drilldown membawa campaignId/adSetId sesuai level; level campaign tidak membawa filter", () => {
  assert.deepEqual(kueriIklan({}), { level: "campaign" });
  assert.deepEqual(kueriIklan({ range: { from: "2026-10-01", to: "2026-10-07" } }), { level: "campaign", dari: "2026-10-01", sampai: "2026-10-07" });
  assert.deepEqual(kueriIklan({ level: "adset", campaignId: "52694481763084", adSetId: "999" }), { level: "adset", campaignId: "52694481763084" });
  assert.deepEqual(kueriIklan({ level: "ad", campaignId: "52694481763084", adSetId: "52694481763284" }), { level: "ad", campaignId: "52694481763084", adSetId: "52694481763284" });
  assert.deepEqual(kueriIklan({ level: "campaign", campaignId: "1" }), { level: "campaign" });
  assert.deepEqual(kueriIklan({ range: { from: "2026-10-01", to: null } }), { level: "campaign" }, "rentang setengah jadi tidak dikirim");
});

test("drilldown: hanya baris MAPPED yang berkredit; UNMAPPED/UNKNOWN tidak bisa dibuka; level ad tidak turun lagi", () => {
  assert.deepEqual(drilldown(grup(), "campaign"), { level: "adset", campaignId: "52694481763084", adSetId: null });
  const adset = grup({ level: "adset", adSet: { id: "52694481763284", nama: null } });
  assert.deepEqual(drilldown(adset, "adset"), { level: "ad", campaignId: "52694481763084", adSetId: "52694481763284" });
  assert.equal(drilldown(grup({ level: "ad", ad: { id: "1", nama: null } }), "ad"), null);
  assert.equal(drilldown(grup({ status: "UNMAPPED", kreditCampaign: false }), "campaign"), null);
  assert.equal(drilldown(grup({ status: "UNKNOWN", kreditCampaign: false }), "campaign"), null);
  assert.equal(drilldown(null, "campaign"), null);
});

test("label: nama hanya label (selalu dengan ID); UNMAPPED dan UNKNOWN dilabeli jujur tanpa nama campaign", () => {
  assert.deepEqual(labelBaris(grup()), { judul: "Jabo IG Oktober", sub: "ID 52694481763084" });
  assert.equal(labelBaris(grup({ campaign: { id: "55555", nama: null }, kunci: "55555" })).judul, "Campaign 55555");
  const unm = labelBaris(grup({ status: "UNMAPPED", kreditCampaign: false, campaign: null, level: "ad", ad: { id: "52699999999999", nama: null } }));
  assert.match(unm.judul, /52699999999999 belum terpetakan/);
  assert.match(unm.sub, /Tidak ditebak/);
  const unk = labelBaris(grup({ status: "UNKNOWN", kreditCampaign: false, campaign: null }));
  assert.match(unk.judul, /UNKNOWN/);
  assert.match(unk.sub, /Tidak dikreditkan/);
});

test("barisTabel (semua umur): customer lunas CRM, closing utama, DP, prospek manual, booked dan uang ledger tampil terpisah; persen closing dari lead sah", () => {
  const b = barisTabel(grup());
  assert.deepEqual([b.leadUnik, b.spam, b.bukanSpam, b.prospek], [10, 2, 8, 3]);
  assert.deepEqual([b.customerOrder, b.orderEligible, b.orderPernahDp, b.customerLunasCrm, b.closing], [4, 5, 2, 3, 2]);
  assert.equal(b.persenClosing, "25%", "2 dari 8 lead sah");
  assert.deepEqual([b.booked, b.uangLedger, b.cakupanLedger], [7_500_000, 6_750_000, 80]);
  assert.deepEqual(b.reaktivasi, { touch: 2, customerUnik: 2 });
  assert.deepEqual(b.assisted, { touch: 1, customerUnik: 1 });
  assert.equal(b.bisaDrilldown, true);
  assert.notEqual(b.closing, b.customerLunasCrm, "closing utama ≠ lunas menurut CRM");
});

test("barisTabel (umur kohort): memakai jendela kematangan; persen dari lead matang; kolom yang tak berlaku di jendela itu null", () => {
  const b = barisTabel(grup(), "hari7");
  assert.deepEqual([b.leadMatang, b.customerOrder, b.closing, b.booked, b.uangLedger], [6, 2, 1, 3_000_000, 2_000_000]);
  assert.equal(b.persenClosing, "16,7%");
  assert.equal(b.orderPernahDp, null);
  assert.equal(b.customerLunasCrm, null);
});

test("barisTabel: lead 0 → persen '—' (tidak membagi nol); baris UNKNOWN/UNMAPPED tidak berkredit dan tidak bisa drilldown", () => {
  assert.equal(barisTabel(grup({ lead: { unik: 0, spam: 0, bukanSpam: 0, leadSah: 0 }, closingUtama: { customerLunasTerbuktiLedger: 0 } })).persenClosing, "—");
  const u = barisTabel(grup({ status: "UNKNOWN", kreditCampaign: false, campaign: null }));
  assert.deepEqual([u.kredit, u.bisaDrilldown], [false, false]);
});

test("ringkasCakupan: partisi lengkap = total lead baru; selisih terhadap label META_ADS CRM terlihat; null saat drilldown", () => {
  const lap = {
    cakupan: { leadBaruDalamRentang: 20, denganTouchAkuisisi: 8, leadBaruTouchTanpaBukti: 2, leadBaruTouchPadaCustomerSudahAda: 1, tanpaTouch: 9, terpetakan: 7, tidakTerpetakan: 1, persenDenganTouch: 40 },
    rekonMetaAds: { metaAdsCrmLeadBaru: 15, akuisisiTerbukti: 6, touchTanpaBukti: 2, touchPadaCustomerSudahAda: 1, tanpaTouchIklan: 6, akuisisiTerbuktiTetapiLabelBukanMetaAds: 2 },
  };
  const r = ringkasCakupan(lap);
  assert.equal(r.bagian.reduce((s, p) => s + p.n, 0), r.total, "empat bagian menjumlah total lead baru");
  assert.deepEqual(r.bagian.map((p) => p.kredit), [true, false, false, false], "hanya akuisisi terbukti yang berkredit");
  assert.equal(r.metaAds.terbukti + r.metaAds.unknown + r.metaAds.sudahAda + r.metaAds.tanpaTouch, r.metaAds.label);
  assert.equal(ringkasCakupan({ cakupan: null }), null);
});

test("peringatan diurutkan: rekonsiliasi gagal dan coverage gap lebih dulu; biaya belum tersambung tidak pernah menjadi angka", () => {
  const lap = { peringatan: [{ kode: "BIAYA_BELUM_TERHUBUNG" }, { kode: "LAIN" }, { kode: "AD_ID_TIDAK_TERPETAKAN" }, { kode: "REKONSILIASI_GAGAL" }, { kode: "ATRIBUSI_BELUM_MULAI" }] };
  assert.deepEqual(peringatanUrut(lap).map((w) => w.kode), ["REKONSILIASI_GAGAL", "ATRIBUSI_BELUM_MULAI", "AD_ID_TIDAK_TERPETAKAN", "BIAYA_BELUM_TERHUBUNG", "LAIN"]);
  const b = statusBiaya({ biaya: { status: "BELUM_TERHUBUNG", cpa: null, roas: null, alasan: "x", opsiIntegrasi: ["A", "B"] } });
  assert.deepEqual([b.tersambung, b.teks, b.opsi.length], [false, "Belum tersambung", 2]);
  assert.equal(statusBiaya({ biaya: { status: "TERSAMBUNG", cpa: 1 } }).tersambung, true);
  assert.equal(statusBiaya({ biaya: { status: "TERSAMBUNG", cpa: null } }).tersambung, false, "tanpa angka dari server tetap 'belum tersambung'");
});

test("jejak drilldown dan format persen", () => {
  assert.deepEqual(jejak("campaign", {}).map((j) => j.label), ["Semua campaign"]);
  assert.deepEqual(jejak("ad", { campaign: "Jabo", adSet: "Set 1" }).map((j) => j.label), ["Semua campaign", "Jabo", "Set 1"]);
  assert.equal(formatPersen(null), "—");
  assert.equal(formatPersen(12.5), "12,5%");
});
