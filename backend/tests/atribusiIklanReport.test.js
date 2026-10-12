// Tes unit Fase 2 atribusi: mesin laporan per campaign / ad set / ad (murni, tanpa DB). Angka dihitung tangan dari fixture di bawah.
import test from "node:test";
import assert from "node:assert/strict";
import { susunLaporanIklan, parseParameterIklan, ParameterError } from "../src/services/attribution/iklanReport.js";
import { buildCohort } from "../src/services/attribution/cohort.js";

const M = (n) => n * 1_000_000;
const D = (s) => new Date(s);
const AD1 = "52694481763484", AD2 = "52689767293284", AD3 = "52696131903684", AD9 = "52699999999999";
const REF = new Map([
  [AD1, { adId: AD1, adSetId: "52694481763284", campaignId: "52694481763084", adName: "Teardown Untuk Ibu", adSetName: null, campaignName: "Jabo IG Oktober" }],
  [AD2, { adId: AD2, adSetId: "52689767293084", campaignId: "52694481763084", adName: "Teardown 20jt", adSetName: null, campaignName: "Jabo IG Oktober" }],
  [AD3, { adId: AD3, adSetId: "52696131903484", campaignId: "52696131903884", adName: null, adSetName: null, campaignName: "FB broad test" }],
]);

const cust = (id, createdAt, o = {}) => ({ id, createdAt: D(createdAt), pipelineStage: "NEW", leadSource: "META_ADS", isInternalStaff: false, staffUserId: null, transitions: [], ...o });
const ord = (id, customerId, createdAt, value, o = {}) => ({ id, customerId, createdAt: D(createdAt), value, tagihan: value, status: "PROCESSING", penjualanKaryawanId: null, paymentStatus: "BELUM_BAYAR", paidAt: null, ...o });
const pay = (id, orderId, createdAt, amount) => ({ id, orderId, createdAt: D(createdAt), amount });
const touch = (id, customerId, adId, touchAt, o = {}) => ({ id, customerId, adId, touchAt: D(touchAt), evidenceSource: "CTWA_AD", entryPointApp: "instagram", customerNewAtTouch: true, ...o });

const customersRentang = [
  cust("A1", "2026-10-05T03:00:00Z", { pipelineStage: "PROSPECT", transitions: [{ toStage: "PROSPECT", createdAt: D("2026-10-06T03:00:00Z") }] }),
  cust("A2", "2026-10-07T03:00:00Z"),
  cust("A3", "2026-10-08T03:00:00Z"),
  cust("A4", "2026-10-09T03:00:00Z"),
  cust("A5", "2026-10-10T03:00:00Z", { pipelineStage: "SPAM" }),
  cust("A6", "2026-10-11T02:00:00Z"),
  cust("A8", "2026-10-12T03:00:00Z"),                       // organik/legacy META_ADS tanpa touch
  cust("A9", "2026-10-13T03:00:00Z"),
];
const orders = [
  ord("O1", "A1", "2026-10-06T03:00:00Z", M(4), { paymentStatus: "LUNAS", paidAt: D("2026-11-02T03:00:00Z") }),   // DP 1 jt (Okt) lalu pelunasan 3 jt (Nov)
  ord("O2", "A2", "2026-10-08T03:00:00Z", M(2), { paymentStatus: "LUNAS", paidAt: D("2026-10-08T05:00:00Z") }),
  ord("O3", "A2", "2026-10-09T03:00:00Z", M(1)),
  ord("O4", "A3", "2026-10-09T03:00:00Z", M(3), { paymentStatus: "LUNAS", paidAt: D("2026-10-09T08:00:00Z") }),   // LUNAS historis TANPA ledger
  ord("O5", "A5", "2026-10-11T03:00:00Z", M(9), { paymentStatus: "LUNAS", paidAt: D("2026-10-11T08:00:00Z") }),   // milik SPAM
];
const kontribusi = [
  pay("P1", "O1", "2026-10-06T04:00:00Z", M(1)), pay("P2", "O1", "2026-11-02T03:00:00Z", M(3)),
  pay("P3", "O2", "2026-10-08T05:00:00Z", M(2)),
  pay("P5", "O5", "2026-10-11T08:00:00Z", M(9)),
];
const touchAkuisisi = [
  touch("T1", "A1", AD1, "2026-10-05T03:05:00Z"),
  touch("T1b", "A1", AD2, "2026-10-05T03:06:00Z"),          // balapan: dua touch customer-baru → hanya yang pertama jadi akuisisi
  touch("T2", "A2", AD1, "2026-10-07T03:05:00Z"),
  touch("T3", "A3", AD2, "2026-10-08T03:05:00Z"),
  touch("T4", "A4", AD9, "2026-10-09T03:05:00Z"),
  touch("T5", "A5", AD1, "2026-10-10T03:05:00Z"),
  touch("T6", "A6", AD2, "2026-10-11T02:05:00Z", { evidenceSource: "CTWA_AD" }),
  touch("T9", "A9", AD3, "2026-10-13T03:05:00Z"),
];
const touchLain = [
  touch("T6b", "A6", AD1, "2026-10-12T02:00:00Z", { customerNewAtTouch: false }),   // touch berikutnya customer yang sama
  touch("T7", "A7", AD1, "2026-10-10T04:00:00Z", { customerNewAtTouch: false }),    // customer LAMA (dibuat September)
];
const customersAtribusi = ["A1", "A2", "A3", "A4", "A5", "A6", "A9"].map((id) => customersRentang.find((c) => c.id === id));

function laporan(level = "campaign", o = {}) {
  return susunLaporanIklan({
    parameter: { dari: "2026-10-01", sampai: "2026-10-13", level, sinyal: "CTWA_AD", rincian: !!o.rincian },
    asOf: D("2026-11-20T00:00:00Z"),
    leadBaru: customersRentang, touchAkuisisi, touchLain, referensi: o.referensi || REF,
    masukan: { customers: customersAtribusi, orders, kontribusi, refunds: [] },
    mulaiAtribusiAt: D("2026-10-05T03:05:00Z"),
  });
}
const grupDari = (lap, kunci) => lap.grup.find((g) => g.kunci === kunci);

test("akuisisi = touch pertama customer baru; satu customer tepat satu grup; touch lain terpisah", () => {
  const lap = laporan("campaign");
  const c1 = grupDari(lap, "52694481763084");
  assert.equal(c1.lead.unik, 5, "A1, A2, A3, A5, A6");          // A1 tidak ikut AD2 walau ada touch baru kedua
  assert.equal(grupDari(lap, "UNMAPPED").lead.unik, 1);
  assert.equal(grupDari(lap, "52696131903884").lead.unik, 1);
  assert.equal(lap.jumlahTeratribusi.leadUnik, 7);
  // touch berikutnya: A6 (AD1) + A7 customer lama (AD1) → campaign C1; BUKAN lead
  assert.deepEqual(c1.sentuhanBerikutnya, { touch: 2, customerUnik: 2, padaCustomerBaru: 0, padaCustomerLama: 2 });
  assert.equal(lap.rekonsiliasi.ok, true, JSON.stringify(lap.rekonsiliasi.cek.filter((c) => !c.ok)));
});

test("lead: unik, spam, bukan spam; metrik closing memakai definisi Fase 1 (spam dikecualikan dari order)", () => {
  const c1 = grupDari(laporan("campaign"), "52694481763084");
  assert.deepEqual(c1.lead, { unik: 5, spam: 1, bukanSpam: 4, leadSah: 4, dikecualikan: { SPAM: 1, B2B_DIRECT: 0, INTERNAL_STAFF: 0, PROFIL_KARYAWAN: 0 } });
  assert.equal(c1.pernahDitandaiProspek.berTanggal, 1);
  assert.equal(c1.customerDenganOrder, 3, "A1, A2 (dua order = satu customer), A3");
  assert.equal(c1.orderEligible, 4, "O1..O4; O5 milik spam tidak dihitung");
  assert.equal(c1.bookedValue, M(10));
  assert.equal(c1.orderPernahDp, 1, "hanya O1 (pembayaran pertama 1 jt < 4 jt)");
});

test("dua jenis lunas dan uang terpisah: LUNAS historis tanpa ledger bukan uang diterima; DP lalu lunas lintas bulan", () => {
  const c1 = grupDari(laporan("campaign"), "52694481763084");
  assert.equal(c1.lunasMenurutCrm.jumlah, 3, "O1, O2, O4 berstatus LUNAS");
  assert.equal(c1.lunasMenurutCrm.nilai, M(9));
  assert.equal(c1.lunasTerbuktiLedger.jumlah, 2, "O1 dan O2; O4 tanpa payment");
  assert.deepEqual(c1.buktiPelunasan, { lunasTerbuktiLedger: 2, lunasTanpaLedger: 1, konflikLunasTersimpanLedgerTidakCukup: 0, konflikBelumLunasTersimpanLedgerCukup: 0, kekuranganRupiahKonflik: 0 });
  assert.equal(c1.uangLedger, M(6), "4 jt (O1) + 2 jt (O2); nilai LUNAS O4 Rp3 jt TIDAK menjadi uang");
  assert.notEqual(c1.bookedValue, c1.uangLedger);
  assert.equal(c1.cakupanLedger.orderBerLedger, 2);
  assert.equal(c1.cakupanLedger.persenOrderBerLedger, 50);
});

test("CLOSING UTAMA = customer dengan order lunas terbukti ledger; terpisah dari customer dengan order, DP, dan lunas menurut CRM", () => {
  const lap = laporan("campaign");
  const c1 = grupDari(lap, "52694481763084");
  // A1 (O1: DP 1 jt lalu pelunasan 3 jt) dan A2 (O2 2 jt) closing; A3 hanya LUNAS historis tanpa ledger → BUKAN closing; A5 spam dikecualikan
  assert.equal(c1.closingUtama.customerLunasTerbuktiLedger, 2);
  assert.equal(c1.closingUtama.orderLunasTerbuktiLedger, 2);
  assert.equal(c1.closingUtama.persenDariLeadSah, 50, "2 dari 4 lead sah");
  assert.deepEqual(c1.closingUtama.perBulanLunasPertama, { "2026-10": 1, "2026-11": 1 }, "A2 lunas Okt; A1 lunas pada pelunasan 2 Nov");
  // metrik lain tetap terpisah dan nilainya berbeda dari closing utama
  assert.equal(c1.customerDenganOrder, 3);
  assert.equal(c1.lunasMenurutCrm.jumlah, 3);
  assert.equal(c1.orderPernahDp, 1);
  assert.notEqual(c1.closingUtama.customerLunasTerbuktiLedger, c1.customerDenganOrder);
  // total = Σ grup (customer tidak dihitung ganda) dan dibuktikan oleh rekonsiliasi
  const total = lap.jumlahTeratribusi.closingUtama;
  assert.equal(total.customerLunasTerbuktiLedger, lap.grup.reduce((s, g) => s + g.closingUtama.customerLunasTerbuktiLedger, 0));
  assert.equal(total.orderLunasTerbuktiLedger, lap.jumlahTeratribusi.lunasTerbuktiLedger);
  for (const id of ["closing_utama_grup_vs_total", "closing_utama_order_vs_kohort", "closing_utama_tidak_melebihi_customer_order"]) {
    assert.equal(lap.rekonsiliasi.cek.find((c) => c.id === id)?.ok, true, id);
  }
  assert.ok(lap.definisi.some((d) => d.id === "closing_utama"));
  // penyebut CPA kelak = closing utama; tetap null
  assert.equal(lap.biaya.penyebutCpa, "closingUtama.customerLunasTerbuktiLedger");
  assert.deepEqual([lap.biaya.cpa, lap.biaya.roas], [null, null]);
});

test("closing utama TIDAK menghitung: customer spam, order PENDING/CANCELLED, DP sebagian, dan LUNAS-CRM tanpa ledger", () => {
  const cs = [cust("Z1", "2026-10-05T03:00:00Z"), cust("Z2", "2026-10-05T04:00:00Z"), cust("Z3", "2026-10-05T05:00:00Z"), cust("Z4", "2026-10-05T06:00:00Z", { pipelineStage: "SPAM" }), cust("Z5", "2026-10-05T07:00:00Z")];
  const os = [
    ord("OZ1", "Z1", "2026-10-06T03:00:00Z", M(2), { status: "PENDING" }),
    ord("OZ2", "Z2", "2026-10-06T03:00:00Z", M(2), { status: "CANCELLED" }),
    ord("OZ3", "Z3", "2026-10-06T03:00:00Z", M(2)),                                         // DP 1 jt saja
    ord("OZ4", "Z4", "2026-10-06T03:00:00Z", M(2)),                                         // spam, dibayar penuh
    ord("OZ5", "Z5", "2026-10-06T03:00:00Z", M(2), { paymentStatus: "LUNAS", paidAt: D("2026-10-06T05:00:00Z") }),   // LUNAS CRM tanpa ledger
  ];
  const ks = [pay("PZ1", "OZ1", "2026-10-06T04:00:00Z", M(2)), pay("PZ2", "OZ2", "2026-10-06T04:00:00Z", M(2)), pay("PZ3", "OZ3", "2026-10-06T04:00:00Z", M(1)), pay("PZ4", "OZ4", "2026-10-06T04:00:00Z", M(2))];
  const lap = susunLaporanIklan({
    parameter: { dari: "2026-10-01", sampai: "2026-10-13", level: "campaign", sinyal: "CTWA_AD", rincian: false },
    asOf: D("2026-11-20T00:00:00Z"), leadBaru: cs,
    touchAkuisisi: cs.map((c, i) => touch("TZ" + i, c.id, AD1, "2026-10-05T0" + (i + 3) + ":05:00Z")), touchLain: [], referensi: REF,
    masukan: { customers: cs, orders: os, kontribusi: ks, refunds: [] }, mulaiAtribusiAt: D("2026-10-05T03:05:00Z"),
  });
  const g = lap.grup[0];
  assert.equal(g.closingUtama.customerLunasTerbuktiLedger, 0);
  assert.equal(g.lunasMenurutCrm.jumlah, 1, "LUNAS CRM tetap tercatat terpisah");
  assert.equal(g.orderPernahDp, 1);
  assert.equal(lap.rekonsiliasi.ok, true, JSON.stringify(lap.rekonsiliasi.cek.filter((c) => !c.ok)));
});

test("AD_REPLY_UNMARKED hanya AUDIT: tidak ada di grup/lead/closing; blok audit dan batasan menyatakannya", () => {
  const lap = susunLaporanIklan({
    parameter: { dari: "2026-10-01", sampai: "2026-10-13", level: "campaign", sinyal: "CTWA_AD", rincian: false },
    asOf: D("2026-11-20T00:00:00Z"), leadBaru: customersRentang, touchAkuisisi, touchLain, referensi: REF,
    masukan: { customers: customersAtribusi, orders, kontribusi, refunds: [] }, mulaiAtribusiAt: D("2026-10-05T03:05:00Z"),
    audit: { touch: 3, customerUnik: 2, padaCustomerBaru: 1 },
  });
  assert.deepEqual(lap.atribusi.sinyalDipakai, ["CTWA_AD"]);
  assert.equal(lap.audit.adReplyTanpaPenanda.touch, 3);
  assert.equal(lap.audit.adReplyTanpaPenanda.masukAtribusi, false);
  assert.equal(lap.jumlahTeratribusi.leadUnik, 7, "audit tidak menambah lead");
  assert.ok(lap.batasan.some((b) => /AD_REPLY_UNMARKED hanya audit/.test(b)));
});

test("tiga tanggal dipisah di `rincian`: lead Okt; order Okt; pembayaran Okt (1 jt) dan Nov (3 jt)", () => {
  const c1 = grupDari(laporan("campaign", { rincian: true }), "52694481763084");
  assert.deepEqual(Object.keys(c1.rincian.perBulanLead), ["2026-10"]);
  assert.deepEqual(Object.keys(c1.rincian.perBulanOrder), ["2026-10"]);
  assert.equal(c1.rincian.perBulanPembayaran["2026-10"].uangLedger, M(3), "DP O1 1 jt + O2 2 jt");
  assert.equal(c1.rincian.perBulanPembayaran["2026-11"].uangLedger, M(3), "pelunasan O1 pada November");
  assert.equal(c1.rincian.perBulanPembayaran["2026-11"].lunasTerbuktiLedger.jumlah, 1);
  assert.equal(c1.rincian.perBulanPembayaran["2026-10"].lunasTerbuktiLedger.jumlah, 1, "O2 Okt");
});

test("kematangan 7/30/60: hanya lead berumur ≥ N hari; hasil DALAM N hari; ledger dinilai pada akhir jendela", () => {
  const c1 = grupDari(laporan("campaign"), "52694481763084");
  const k = c1.kematangan;
  // asOf 20 Nov: A1 (5 Okt) umur 46 hari, A2 44, A3 43, A6 40 → semua ≥30 dan <60
  assert.equal(k.hari7.leadMatang, 4);
  assert.equal(k.hari30.leadMatang, 4);
  assert.equal(k.hari60.leadMatang, 0);
  assert.equal(k.hari60.customerDenganOrder, 0);
  // jendela 7 hari: O1 dibuat 1 hari setelah lead, DP 1 jt masuk; pelunasan 3 jt (Nov) di luar jendela → belum lunas ledger
  assert.equal(k.hari7.orderEligible, 4, "O1 (+1 hari), O2 (+1), O3 (+2), O4 (+1): semua dibuat dalam 7 hari sejak lead masing-masing");
  assert.equal(k.hari30.uangLedger, M(6), "O1 penuh (pelunasan 2 Nov ≤ 5 Okt + 30 hari = 4 Nov) + O2");
  assert.equal(k.hari30.lunasTerbuktiLedger, 2);
  assert.equal(k.hari7.lunasTerbuktiLedger, 1, "hanya O2; O1 baru lunas 28 hari kemudian");
  assert.equal(k.hari7.lunasMenurutCrm, 2, "O2 dan O4 (paidAt tercatat dalam 7 hari); O1 paidAt 2 Nov di luar jendela");
  assert.equal(k.hari7.customerLunasTerbuktiLedger, 1, "closing utama dalam 7 hari: hanya A2");
  assert.equal(k.hari30.customerLunasTerbuktiLedger, 2, "A1 dan A2 dalam 30 hari");
});

test("UNMAPPED: Ad ID tanpa referensi → campaign/ad set null, status UNMAPPED, daftar Ad ID terlihat; tidak ditebak", () => {
  const lap = laporan("campaign");
  const g = grupDari(lap, "UNMAPPED");
  assert.deepEqual([g.status, g.campaign, g.adSet, g.ad], ["UNMAPPED", null, null, null]);
  assert.deepEqual(lap.tidakTerpetakan.adIds.map((x) => x.adId), [AD9]);
  assert.equal(lap.cakupan.tidakTerpetakan, 1);
  assert.ok(lap.peringatan.some((w) => w.kode === "AD_ID_TIDAK_TERPETAKAN"));
  // Ad baru dipetakan TANPA perubahan kode: cukup tambah referensi
  const ref2 = new Map(REF); ref2.set(AD9, { adId: AD9, adSetId: "52699999990001", campaignId: "52699999990002", campaignName: "Kampanye baru" });
  const lap2 = laporan("campaign", { referensi: ref2 });
  assert.equal(grupDari(lap2, "UNMAPPED"), undefined);
  assert.equal(grupDari(lap2, "52699999990002").lead.unik, 1);
  assert.equal(lap2.cakupan.tidakTerpetakan, 0);
});

test("level campaign / adset / ad: total teratribusi IDENTIK; hanya cara pengelompokan yang berubah", () => {
  const per = ["campaign", "adset", "ad"].map((l) => laporan(l));
  for (const lap of per) assert.equal(lap.rekonsiliasi.ok, true, JSON.stringify(lap.rekonsiliasi.cek.filter((c) => !c.ok)));
  assert.deepEqual(per[0].jumlahTeratribusi, per[1].jumlahTeratribusi);
  assert.deepEqual(per[0].jumlahTeratribusi, per[2].jumlahTeratribusi);
  assert.equal(per[0].jumlahGrup, 3);          // C1, C2, UNMAPPED
  assert.equal(per[1].jumlahGrup, 4);          // S1, S2, S3, UNMAPPED
  assert.equal(per[2].jumlahGrup, 4);          // AD1, AD2, AD3, AD9
  const adGrup = (k) => grupDari(per[2], k);
  assert.equal(adGrup(AD1).lead.unik, 3, "A1, A2, A5");
  assert.equal(adGrup(AD2).lead.unik, 2, "A3, A6");
  assert.deepEqual([adGrup(AD1).status, adGrup(AD1).campaign.id, adGrup(AD1).adSet.id, adGrup(AD1).ad.id], ["MAPPED", "52694481763084", "52694481763284", AD1]);
  assert.equal(adGrup(AD9).status, "UNMAPPED");
});

test("tidak ada customer atau order ganda: Σ grup = gabungan; gabungan = buildCohort Fase 1 langsung", () => {
  const lap = laporan("ad");
  const jumlah = (f) => lap.grup.reduce((s, g) => s + f(g), 0);
  const langsung = buildCohort({ customers: customersAtribusi, orders, kontribusi, refunds: [] }).total;
  assert.equal(jumlah((g) => g.customerDenganOrder), langsung.customerDenganOrder);
  assert.equal(jumlah((g) => g.orderEligible), langsung.orders);
  assert.equal(jumlah((g) => g.bookedValue), langsung.nilaiOrder);
  assert.equal(jumlah((g) => g.uangLedger), langsung.uangLedger);
  assert.equal(jumlah((g) => g.lunasMenurutCrm.jumlah), langsung.lunasMenurutCrm.jumlah);
});

test("cakupan atribusi jujur: lead tanpa touch tidak disembunyikan; attribution_start dan peringatan rentang sebelum atribusi", () => {
  const lap = laporan("campaign");
  assert.equal(lap.cakupan.leadBaruDalamRentang, 8);
  assert.equal(lap.cakupan.denganTouchAkuisisi, 7);
  assert.equal(lap.cakupan.tanpaTouch, 1);
  assert.equal(lap.cakupan.leadLegacyMetaAdsTanpaTouch, 1);
  assert.equal(lap.cakupan.persenDenganTouch, 87.5);
  assert.equal(lap.atribusi.attributionStartWib, "2026-10-05 10:05");
  assert.ok(lap.peringatan.some((w) => w.kode === "RENTANG_SEBELUM_ATRIBUSI"), "dari 1 Okt < mulai 5 Okt");
  assert.ok(lap.peringatan.some((w) => w.kode === "LEAD_TANPA_TOUCH"));
  assert.match(lap.atribusi.historis, /TIDAK ADA/);
});

test("biaya: CPA/ROAS null dengan status BELUM_TERHUBUNG; tidak ada angka karangan", () => {
  const lap = laporan("campaign");
  assert.deepEqual([lap.biaya.status, lap.biaya.cpa, lap.biaya.roas], ["BELUM_TERHUBUNG", null, null]);
  for (const g of lap.grup) assert.deepEqual(g.biaya, { status: "BELUM_TERHUBUNG", cpa: null, roas: null });
  assert.ok(lap.peringatan.some((w) => w.kode === "BIAYA_BELUM_TERHUBUNG"));
});

test("peringatan kohort Fase 1 diteruskan (LEDGER_TIDAK_LENGKAP, LUNAS_TANPA_LEDGER) dan definisi memuat dua jenis lunas", () => {
  const lap = laporan("campaign");
  const kode = lap.peringatan.map((w) => w.kode);
  assert.ok(kode.includes("LEDGER_TIDAK_LENGKAP") && kode.includes("LUNAS_TANPA_LEDGER"));
  const ids = lap.definisi.map((d) => d.id);
  for (const id of ["lunas_menurut_crm", "lunas_terbukti_ledger", "akuisisi_iklan", "kematangan", "biaya"]) assert.ok(ids.includes(id), id);
});

test("tanpa touch sama sekali: laporan kosong jujur, ATRIBUSI_BELUM_MULAI, tanpa galat", () => {
  const lap = susunLaporanIklan({
    parameter: { dari: "2026-10-01", sampai: "2026-10-13", level: "campaign", sinyal: "CTWA_AD", rincian: false },
    asOf: D("2026-10-14T00:00:00Z"), leadBaru: customersRentang, touchAkuisisi: [], touchLain: [], referensi: new Map(),
    masukan: { customers: [], orders: [], kontribusi: [], refunds: [] }, mulaiAtribusiAt: null,
  });
  assert.equal(lap.grup.length, 0);
  assert.equal(lap.cakupan.denganTouchAkuisisi, 0);
  assert.equal(lap.cakupan.tanpaTouch, 8);
  assert.equal(lap.rekonsiliasi.ok, true);
  assert.ok(lap.peringatan.some((w) => w.kode === "ATRIBUSI_BELUM_MULAI"));
});

test("respons tidak memuat pengenal: tanpa customerId, order id, nomor, atau kunci campaignId milik customer", () => {
  const teks = JSON.stringify(laporan("ad", { rincian: true }));
  for (const id of ["A1", "A2", "A3", "O1", "O2", "P1", "T1"]) assert.ok(!new RegExp(`"${id}"`).test(teks), `id bocor: ${id}`);
  assert.ok(!/"(phone|name|customerId|orderId|ctwaClid)"\s*:/.test(teks));
});

test("parameter: dari & sampai WAJIB; validasi tanggal, level, sinyal (hanya CTWA_AD); maksimum 93 hari; tidak boleh masa depan", () => {
  const now = D("2026-10-13T05:00:00Z");
  assert.deepEqual(parseParameterIklan({ dari: "2026-10-01", sampai: "2026-10-13" }, now), { dari: "2026-10-01", sampai: "2026-10-13", level: "campaign", sinyal: "CTWA_AD", rincian: false, hariIni: "2026-10-13" });
  assert.equal(parseParameterIklan({ dari: "2026-10-01", sampai: "2026-10-13", level: "ad", rincian: "1" }, now).rincian, true);
  // 93 hari inklusif lolos; 94 ditolak
  assert.equal(parseParameterIklan({ dari: "2026-07-13", sampai: "2026-10-13" }, now).dari, "2026-07-13");
  // 17:30 UTC = 00:30 WIB hari berikutnya
  assert.equal(parseParameterIklan({ dari: "2026-10-14", sampai: "2026-10-14" }, D("2026-10-13T17:30:00Z")).sampai, "2026-10-14");
  for (const q of [
    {}, { dari: "2026-10-01" }, { sampai: "2026-10-13" },
    { dari: "2026-13-01", sampai: "2026-10-13" }, { dari: "2026-10-14", sampai: "2026-10-13" }, { dari: "2026-10-01", sampai: "2026-10-14" },
    { dari: "2026-10-01", sampai: "2026-10-13", level: "pixel" },
    { dari: "2026-10-01", sampai: "2026-10-13", sinyal: "SEMUA" }, { dari: "2026-10-01", sampai: "2026-10-13", sinyal: "AD_REPLY_UNMARKED" },
    { dari: "2026-07-12", sampai: "2026-10-13" }, { dari: "2025-01-01", sampai: "2026-10-13" }, { dari: "2026-02-30", sampai: "2026-03-01" },
  ]) {
    assert.throws(() => parseParameterIklan(q, now), (e) => e instanceof ParameterError && e.statusCode === 400, JSON.stringify(q));
  }
});
