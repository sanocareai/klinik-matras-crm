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

import { selBiaya, barisBiaya, statusBiayaLaporan, bodyTarget, STATUS_BIAYA_LABEL } from "../src/features/laporan/iklanCampaignLogic.js";

test("selBiaya: null tetap '—' dengan alasan (tidak pernah nol palsu); angka diformat Rupiah/ROAS", () => {
  assert.deepEqual(selBiaya(null, "BELUM_ADA_KONVERSI"), { teks: "—", alasan: "belum ada konversi", kosong: true });
  assert.equal(selBiaya(undefined, "BELUM_ADA_SPEND").teks, "—");
  assert.equal(selBiaya(0, null).teks, "Rp0", "nol sungguhan (mis. CPL Rp0) tetap ditampilkan apa adanya");
  assert.equal(selBiaya(125000, null).teks, "Rp125.000");
  assert.equal(selBiaya(6, null, { rupiah: false, desimal: true }).teks, "6,00×");
});

test("barisBiaya: status dan evaluasi; tanpa target tidak ada evaluasi/warna; spend null tetap null", () => {
  const g = { biaya: { status: "SIAP_DIEVALUASI", spend: 900000, platformConversations: 10, cpl: 300000, costPerQualifiedLead: null, costPerCustomerOrder: 450000, cpa: 450000, bookedRoas: 8.33, cashRoas: 7.5, alasanNull: { costPerQualifiedLead: "BELUM_ADA_KONVERSI" }, evaluasi: { status: null, pelanggaran: [] }, kematangan: { matang: true } } };
  const c = barisBiaya(g);
  assert.equal(c.statusTeks, "Siap dievaluasi");
  assert.equal(c.evaluasi, null);
  assert.equal(c.evaluasiNada, null);
  assert.equal(c.cplQualified.alasan, "belum ada konversi");
  assert.equal(c.spend.teks, "Rp900.000");
  const kosong = barisBiaya({ biaya: { status: "BELUM_TERHUBUNG", spend: null, cpl: null, cpa: null, bookedRoas: null, cashRoas: null, alasanNull: { cpl: "BELUM_ADA_SPEND" }, evaluasi: { status: null, pelanggaran: [] } } });
  assert.deepEqual([kosong.spend.teks, kosong.cpl.teks, kosong.cpa.teks, kosong.statusTeks], ["—", "—", "—", "Belum tersambung"]);
  const ev = barisBiaya({ biaya: { ...g.biaya, evaluasi: { status: "PERLU_REVIEW", pelanggaran: [{ metrik: "cpl" }] } } });
  assert.deepEqual([ev.evaluasiTeks, ev.evaluasiNada], ["Perlu review", "buruk"]);
  assert.equal(barisBiaya({}), null);
  for (const k of ["BELUM_TERHUBUNG", "DATA_BELUM_MATANG", "BELUM_ADA_KONVERSI", "MAPPING_BELUM_ADA", "DATA_TERLAMBAT", "SIAP_DIEVALUASI"]) assert.ok(STATUS_BIAYA_LABEL[k], k);
});

test("statusBiayaLaporan: tersambung hanya bila server menyatakan sumber terhubung", () => {
  assert.equal(statusBiayaLaporan({ biaya: { status: "BELUM_TERHUBUNG", cpa: null } }).tersambung, false);
  const s = statusBiayaLaporan({ biaya: { status: "SIAP_DIEVALUASI", sumber: { terhubung: true, terakhirTanggal: "2026-10-16", terlambat: false }, spendTotal: 1000, targetDiatur: false } });
  assert.deepEqual([s.tersambung, s.spendTotal, s.targetDiatur], [true, 1000, false]);
  assert.equal(statusBiayaLaporan(null).teks, "Belum tersambung");
});

test("bodyTarget: kosong→null; titik ribuan hanya untuk kolom rupiah; negatif/pecahan int/format salah ditolak", () => {
  assert.deepEqual(bodyTarget({ maxCpl: "1.500.000", maxSpamSharePercent: "12.5", minClosings: "3", minBookedRoas: "" }).body, { maxCpl: 1500000, maxSpamSharePercent: 12.5, minClosings: 3, minBookedRoas: null });
  assert.ok(bodyTarget({ maxCpl: "-1" }).galat);
  assert.ok(bodyTarget({ minClosings: "1,5" }).galat);
  assert.ok(bodyTarget({ maxCpl: "abc" }).galat);
  assert.ok(bodyTarget({}).galat);
});

test("barisBiaya: biaya per percakapan platform + impresi/klik tampil juga sebelum atribusi; CPL/CPA tetap kosong", () => {
  const c = barisBiaya({ biaya: { status: "SEBELUM_ATRIBUSI", spend: 468546, platformConversations: 42, impressions: 28342, linkClicks: 214, costPerPlatformConversation: 11155.86, cpl: null, cpa: null, bookedRoas: null, cashRoas: null, alasanNull: { cpl: "SEBELUM_ATRIBUSI", cpa: "SEBELUM_ATRIBUSI" }, evaluasi: { status: "TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI", pelanggaran: [] } } });
  assert.deepEqual([c.biayaPerKonversasi.teks, c.impresi, c.klikTautan, c.cpl.teks, c.cpl.alasan], ["Rp11.156", 28342, 214, "—", "sebelum atribusi"]);
  assert.equal(c.evaluasiTeks, "Tidak dapat dievaluasi (sebelum atribusi)");
  assert.equal(c.evaluasiNada, "netral");
});
