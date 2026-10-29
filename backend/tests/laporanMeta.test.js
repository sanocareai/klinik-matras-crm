// Tes unit LAPORAN META ADS untuk konektor MCP (murni, tanpa DB): proyeksi daftar-putih, peringkat, pengaman KPI, rekap harian + akumulasi,
// rekonsiliasi campaign ↔ ad set ↔ ad, penjaga bersama, dan kontrak MCP (discovery/schema/galat parameter). Angka dihitung tangan dari fixture.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { susunLaporanIklan, ParameterError } from "../src/services/attribution/iklanReport.js";
import { terapkanBiaya, kesegaranSpend, normalisasiTarget } from "../src/services/attribution/biayaKpi.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../src/utils/wib.js";
import {
  susunPerforma, susunPeringkat, ringkasBaris, ringkasBiaya, rekonsiliasiLintasLevel, laporanPerforma, rekapHarian, kesehatanAtribusi,
  KRITERIA_URUT, DAFTAR_KRITERIA, DEFINISI, MAKS_HARI_REKAP,
} from "../src/services/attribution/laporanMeta.js";
import { denganPenjaga, denganAntrean, SedangDihitungError, sedangDihitung } from "../src/services/attribution/penjagaLaporan.js";

const M = (n) => n * 1_000_000;
const D = (s) => new Date(s);
const AD1 = "52694481763484", AD2 = "52689767293284", AD3 = "52696131903684", AD9 = "52699999999999";
const CAMP1 = "52694481763084", CAMP2 = "52696131903884";
const REF = new Map([
  [AD1, { adId: AD1, adSetId: "52694481763284", campaignId: CAMP1, adName: "Teardown Untuk Ibu", adSetName: "Set A", campaignName: "Jabo IG Oktober" }],
  [AD2, { adId: AD2, adSetId: "52689767293084", campaignId: CAMP1, adName: "Teardown 20jt", adSetName: "Set B", campaignName: "Jabo IG Oktober" }],
  [AD3, { adId: AD3, adSetId: "52696131903484", campaignId: CAMP2, adName: null, adSetName: null, campaignName: "FB broad test" }],
]);
const cust = (id, createdAt, o = {}) => ({ id, createdAt: D(createdAt), pipelineStage: "NEW", leadSource: "META_ADS", isInternalStaff: false, staffUserId: null, transitions: [], ...o });
const ord = (id, customerId, createdAt, value, o = {}) => ({ id, customerId, createdAt: D(createdAt), value, tagihan: value, status: "PROCESSING", penjualanKaryawanId: null, paymentStatus: "BELUM_BAYAR", paidAt: null, ...o });
const pay = (id, orderId, createdAt, amount) => ({ id, orderId, createdAt: D(createdAt), amount });
const touch = (id, customerId, adId, touchAt, o = {}) => ({ id, customerId, adId, touchAt: D(touchAt), evidenceSource: "CTWA_AD", entryPointApp: "instagram", customerStatusAtTouch: "NEW", customerBasisAtTouch: "WEBHOOK_MEMBUAT", ...o });

// A1: DP 1jt + pelunasan 3jt (lunas ledger). A2: DUA order (O2 lunas, O3 belum bayar) → satu customer. A3: lunas di CRM TANPA ledger. A5: SPAM berbayar.
// A6: customer baru + touch berikutnya EXISTING. A7: customer LAMA (reaktivasi). A4: Ad ID belum terpetakan. A9: campaign lain.
const customers = [
  cust("A1", "2026-10-07T03:00:00Z", { pipelineStage: "PROSPECT", transitions: [{ toStage: "PROSPECT", createdAt: D("2026-10-08T03:00:00Z") }] }),
  cust("A2", "2026-10-08T03:00:00Z"), cust("A3", "2026-10-09T03:00:00Z"), cust("A4", "2026-10-09T05:00:00Z"),
  cust("A5", "2026-10-10T03:00:00Z", { pipelineStage: "SPAM" }), cust("A6", "2026-10-11T02:00:00Z"), cust("A8", "2026-10-12T03:00:00Z"), cust("A9", "2026-10-13T03:00:00Z"),
  // batas hari WIB: 12 Okt 23:59:59 WIB vs 13 Okt 00:00:00 WIB
  cust("B1", "2026-10-12T16:59:59Z"), cust("B2", "2026-10-12T17:00:00Z"),
];
const orders = [
  ord("O1", "A1", "2026-10-08T03:00:00Z", M(4), { paymentStatus: "LUNAS", paidAt: D("2026-10-20T03:00:00Z") }),
  ord("O2", "A2", "2026-10-09T03:00:00Z", M(2), { paymentStatus: "LUNAS", paidAt: D("2026-10-09T05:00:00Z") }),
  ord("O3", "A2", "2026-10-10T03:00:00Z", M(1)),
  ord("O4", "A3", "2026-10-10T03:00:00Z", M(3), { paymentStatus: "LUNAS", paidAt: D("2026-10-10T08:00:00Z") }),
  ord("O5", "A5", "2026-10-11T03:00:00Z", M(9), { paymentStatus: "LUNAS", paidAt: D("2026-10-11T08:00:00Z") }),
  ord("O6", "B1", "2026-10-13T03:00:00Z", M(1), { status: "CANCELLED" }),            // dibatalkan → bukan order eligible
  ord("O7", "B2", "2026-10-13T03:00:00Z", M(2)),
];
const kontribusi = [
  pay("P1", "O1", "2026-10-08T04:00:00Z", M(1)), pay("P2", "O1", "2026-10-20T03:00:00Z", M(3)),
  pay("P3", "O2", "2026-10-09T05:00:00Z", M(2)), pay("P5", "O5", "2026-10-11T08:00:00Z", M(9)),
  pay("P7", "O7", "2026-10-14T03:00:00Z", 500_000),                                    // DP sebagian
];
const refunds = [];
const touchAkuisisi = [
  touch("T1", "A1", AD1, "2026-10-07T03:05:00Z"), touch("T1b", "A1", AD2, "2026-10-07T03:06:00Z"),   // retry/balapan: hanya yang pertama
  touch("T2", "A2", AD1, "2026-10-08T03:05:00Z"), touch("T3", "A3", AD2, "2026-10-09T03:05:00Z"), touch("T4", "A4", AD9, "2026-10-09T05:05:00Z"),
  touch("T5", "A5", AD1, "2026-10-10T03:05:00Z"), touch("T6", "A6", AD2, "2026-10-11T02:05:00Z"), touch("T9", "A9", AD3, "2026-10-13T03:05:00Z"),
  touch("TB1", "B1", AD1, "2026-10-12T16:59:59Z"), touch("TB2", "B2", AD1, "2026-10-12T17:00:00Z"),
];
const touchLain = [
  touch("T6b", "A6", AD1, "2026-10-12T02:00:00Z", { customerStatusAtTouch: "EXISTING", customerBasisAtTouch: "RIWAYAT_PESAN" }),
  touch("T7", "A7", AD1, "2026-10-10T04:00:00Z", { customerStatusAtTouch: "EXISTING", customerBasisAtTouch: "RIWAYAT_PESAN" }),
];
const ASOF = D("2026-11-20T03:00:00Z");

// Muat-sub: sebagian fixture menurut rentang tanggal lead WIB (cermin hitungLaporanIklan, tanpa DB).
function laporanUntuk({ dari, sampai, level = "campaign", filter = null, refund = refunds, spend = null, hariIni = "2026-11-20", hariHilang = [], mulaiHari = "2026-10-05", target = null }) {
  const lo = startOfDayWIB(dari), hi = endOfDayExclusiveWIB(sampai);
  const dalam = (c) => c.createdAt >= lo && c.createdAt < hi;
  const leadBaru = customers.filter(dalam);
  const ids = new Set(leadBaru.map((c) => c.id));
  const akuisisi = touchAkuisisi.filter((t) => ids.has(t.customerId));
  const lain = touchLain.filter((t) => t.touchAt >= lo && t.touchAt < hi);
  const sah = new Set(akuisisi.map((t) => t.customerId));
  const lap = susunLaporanIklan({
    parameter: { dari, sampai, level, sinyal: "CTWA_AD", rincian: false, filter },
    asOf: ASOF, leadBaru, touchAkuisisi: akuisisi, touchLain: lain, referensi: REF,
    masukan: { customers: leadBaru.filter((c) => sah.has(c.id)), orders: orders.filter((o) => sah.has(o.customerId)), kontribusi: kontribusi.filter((k) => orders.some((o) => o.id === k.orderId && sah.has(o.customerId))), refunds: refund },
    mulaiAtribusiAt: D("2026-10-05T03:05:00Z"),
  });
  const adaHari = []; for (let t = Date.parse(`${dari}T00:00:00Z`); t <= Date.parse(`${sampai}T00:00:00Z`); t += 86_400_000) { const h = new Date(t).toISOString().slice(0, 10); if (!hariHilang.includes(h)) adaHari.push(h); }
  const kes = kesegaranSpend({ terakhirTanggal: spend ? "2026-10-13" : null, hariIni, dari, sampai, adaDataDiRentang: !!spend, hariTersedia: adaHari });
  return terapkanBiaya(lap, { spendPerAd: spend ?? [], referensi: REF, kesegaran: kes, target: normalisasiTarget(target), hariIni, mulaiHari });
}
const SPEND_LENGKAP = [{ adId: AD1, spend: 1_000_000, hariAdaSpend: 4 }, { adId: AD2, spend: 500_000, hariAdaSpend: 4 }, { adId: AD3, spend: 200_000, hariAdaSpend: 1 }, { adId: AD9, spend: 50_000, hariAdaSpend: 1 }];
const P = { dari: "2026-10-06", sampai: "2026-10-13" };
const baris = (p, kunci) => p.baris.find((b) => b.kunci === kunci);

// ── proyeksi + definisi ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("proyeksi campaign: customer unik ber-order / pernah membayar / lunas ledger; PENDING-CANCELLED-spam dikecualikan; reaktivasi terpisah", () => {
  const p = susunPerforma(laporanUntuk({ ...P, spend: SPEND_LENGKAP }));
  const c1 = baris(p, CAMP1);
  // CAMP1: A1, A2, A3, A5(spam), A6, B1, B2 (touch AD1) — AD2: A3, A6 → A1 mengikuti touch PERTAMA (AD1), bukan balapan AD2
  assert.equal(c1.akuisisi.leadTerbukti, 7);
  assert.equal(c1.akuisisi.spam, 1);
  assert.equal(c1.order.customerBerOrder, 4, "A1, A2 (2 order = 1 customer), A3, B2; B1 dibatalkan & A5 spam keluar");
  assert.equal(c1.order.jumlahOrderEligible, 5, "O1, O2, O3, O4, O7");
  assert.equal(c1.order.nilaiOrder, M(4) + M(2) + M(1) + M(3) + M(2));
  assert.equal(c1.order.customerPernahMembayar, 3, "A1, A2 (ledger), B2 (DP 500rb); A3 lunas-CRM tanpa ledger BUKAN pernah membayar");
  assert.equal(c1.order.customerLunasTerbuktiLedger, 2, "A1 (DP→lunas) dan A2; B2 baru DP");
  assert.equal(c1.order.customerLunasMenurutCrm, 3, "A1, A2, A3 — metrik terpisah");
  assert.ok(c1.order.customerLunasTerbuktiLedger <= c1.order.customerPernahMembayar && c1.order.customerPernahMembayar <= c1.order.customerBerOrder);
  assert.equal(c1.uang.uangLedgerBersih, M(4) + M(2) + 500_000);
  assert.equal(c1.reaktivasi.touch, 2, "T6b dan T7 (customer lama) — bukan lead");
  assert.equal(p.total.order.customerPernahMembayar, 3);
  assert.equal(p.total.akuisisi.leadTerbukti, 7 + 1 + 1, "CAMP1 7 + CAMP2 1 (A9) + UNMAPPED 1 (A4)");
});

test("UNMAPPED selalu tampil, tidak diperingkat, tidak dialokasikan ke campaign; URL kreatif tidak dipakai", () => {
  const p = susunPerforma(laporanUntuk({ ...P, spend: SPEND_LENGKAP }));
  assert.equal(p.tidakTerpetakan.length, 1);
  assert.equal(p.tidakTerpetakan[0].status, "UNMAPPED");
  assert.equal(p.tidakTerpetakan[0].akuisisi.leadTerbukti, 1);
  assert.equal(p.tidakTerpetakan[0].campaign, null);
  assert.ok(p.baris.every((b) => b.status === "MAPPED"));
  assert.equal(p.tidakTerpetakan[0].biaya.spend, 50_000, "spend Ad tak terpetakan ikut baris UNMAPPED, bukan campaign");
  assert.equal(p.spend.spendTidakTerpetakan, 50_000);
  assert.ok(p.peringatan.some((w) => w.kode === "AD_ID_TIDAK_TERPETAKAN"));
  assert.match(DEFINISI.kreatifTidakDipakai, /URL kreatif/);
  assert.ok(!JSON.stringify(p).includes("ctwaSourceUrl"));
});

test("tanpa PII: tak ada ID customer/order, nama, telepon di keluaran (daftar-putih)", () => {
  const teks = JSON.stringify([susunPerforma(laporanUntuk({ ...P, spend: SPEND_LENGKAP })), susunPerforma(laporanUntuk({ ...P, level: "ad", spend: SPEND_LENGKAP }))]);
  for (const bocor of ['"A1"', '"A2"', '"O1"', '"P1"', "customerId", "orderId", "telepon", "phone", "email", "ctwaClid", "pelanggan"]) assert.ok(!teks.includes(bocor), `bocor: ${bocor}`);
});

// ── peringkat ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("peringkat: setiap kriteria urut terbaik-dulu; KPI null tanpa peringkat + alasan; seri berperingkat sama", () => {
  const p = susunPerforma(laporanUntuk({ ...P, spend: SPEND_LENGKAP }), { urutkan: "customer_lunas_ledger" });
  assert.deepEqual(p.baris.map((b) => [b.kunci, b.peringkat]), [[CAMP1, 1], [CAMP2, 2]]);
  const cpa = susunPerforma(laporanUntuk({ ...P, spend: SPEND_LENGKAP }), { urutkan: "cpa_lunas" });
  assert.equal(cpa.urutan.arah, "terendah = terbaik");
  assert.equal(baris(cpa, CAMP1).biaya.cpaLunas, 750_000, "(1.0jt+0.5jt) / 2 customer lunas");
  assert.equal(baris(cpa, CAMP1).peringkat, 1);
  assert.equal(baris(cpa, CAMP2).peringkat, null, "CAMP2 belum punya customer lunas → CPA null");
  assert.equal(baris(cpa, CAMP2).biaya.alasanNull.cpaLunas, "BELUM_ADA_KONVERSI");
  assert.equal(baris(cpa, CAMP2).alasanTanpaPeringkat, "BELUM_ADA_KONVERSI");
  assert.equal(cpa.baris.at(-1).kunci, CAMP2, "yang tanpa peringkat di akhir");
  for (const k of DAFTAR_KRITERIA) {
    const r = susunPerforma(laporanUntuk({ ...P, spend: SPEND_LENGKAP }), { urutkan: k });
    assert.equal(r.urutan.id, k);
    const nilai = r.baris.filter((b) => b.peringkat !== null).map((b) => b.nilaiKriteria);
    const urut = [...nilai].sort((a, b) => (KRITERIA_URUT[k].arah === "asc" ? a - b : b - a));
    assert.deepEqual(nilai, urut, k);
  }
  assert.throws(() => susunPeringkat([], "ngasal"), ParameterError);
  const seri = susunPeringkat([ringkasBaris({ kunci: "b", status: "MAPPED", lead: { unik: 3 } }), ringkasBaris({ kunci: "a", status: "MAPPED", lead: { unik: 3 } }), ringkasBaris({ kunci: "c", status: "MAPPED", lead: { unik: 1 } })], "lead_akuisisi");
  assert.deepEqual(seri.baris.map((b) => [b.kunci, b.peringkat]), [["a", 1], ["b", 1], ["c", 3]], "seri = peringkat sama (1,1,3), pemecah deterministik hanya urutan tampil");
});

test("semua nilai nol → peringatan TIDAK_ADA_PEMENANG; batas memotong baris tetapi total tetap penuh", () => {
  const nol = susunPerforma(laporanUntuk({ ...P, spend: SPEND_LENGKAP }), { urutkan: "customer_lunas_ledger" });
  assert.ok(!nol.peringatan.some((w) => w.kode === "TIDAK_ADA_PEMENANG"));
  const lap = laporanUntuk({ dari: "2026-10-13", sampai: "2026-10-13", spend: null });   // hanya A9 (CAMP2) dan B2 → semua lunas 0
  const p = susunPerforma(lap, { urutkan: "customer_lunas_ledger" });
  assert.ok(p.peringatan.some((w) => w.kode === "TIDAK_ADA_PEMENANG"));
  const dipotong = susunPerforma(laporanUntuk({ ...P, level: "ad", spend: SPEND_LENGKAP }), { batas: 1 });
  assert.equal(dipotong.baris.length, 1);
  assert.equal(dipotong.terpotong, true);
  assert.ok(dipotong.peringatan.some((w) => w.kode === "BARIS_DIPOTONG"));
  assert.equal(dipotong.total.akuisisi.leadTerbukti, 9, "total mencakup semua baris, bukan hanya yang ditampilkan");
});

// ── pengaman KPI + 'nilai order setelah biaya iklan' ───────────────────────────────────────────────────────────────────────────────────────────
test("nilai order setelah biaya iklan = nilai order − spend; Booked/Cash ROAS dan definisi uang vs nilai order", () => {
  const c1 = baris(susunPerforma(laporanUntuk({ ...P, spend: SPEND_LENGKAP })), CAMP1);
  assert.equal(c1.biaya.spend, 1_500_000);
  assert.equal(c1.biaya.nilaiOrderSetelahBiayaIklan, c1.order.nilaiOrder - 1_500_000);
  assert.equal(c1.biaya.bookedRoas, Math.round((c1.order.nilaiOrder / 1_500_000) * 100) / 100);
  assert.equal(c1.biaya.cashRoas, Math.round((c1.uang.uangLedgerBersih / 1_500_000) * 100) / 100);
  assert.match(DEFINISI.nilaiOrderSetelahBiayaIklan, /BUKAN laba/);
  assert.match(DEFINISI.cashRoas, /ongkir/);
  assert.equal(c1.biaya.status, "SIAP_DIEVALUASI");
});

test("pengaman: spend tidak lengkap, hari berjalan, sebelum atribusi → KPI & nilai-setelah-biaya null dengan alasan (bukan 0)", () => {
  const hilang = baris(susunPerforma(laporanUntuk({ ...P, spend: SPEND_LENGKAP, hariHilang: ["2026-10-09"] })), CAMP1).biaya;
  assert.equal(hilang.cpaLunas, null); assert.equal(hilang.bookedRoas, null); assert.equal(hilang.nilaiOrderSetelahBiayaIklan, null);
  assert.equal(hilang.alasanNull.cpaLunas, "SPEND_TIDAK_LENGKAP");
  assert.equal(hilang.alasanNull.nilaiOrderSetelahBiayaIklan, "SPEND_TIDAK_LENGKAP");
  assert.equal(hilang.spend, 1_500_000, "spend tetap tampil untuk audit");
  const berjalan = baris(susunPerforma(laporanUntuk({ ...P, spend: SPEND_LENGKAP, hariIni: "2026-10-13" })), CAMP1).biaya;
  assert.equal(berjalan.alasanNull.cpaLunas, "HARI_BERJALAN_PARSIAL"); assert.equal(berjalan.nilaiOrderSetelahBiayaIklan, null);
  const sebelum = baris(susunPerforma(laporanUntuk({ ...P, spend: SPEND_LENGKAP, mulaiHari: "2026-10-12" })), CAMP1).biaya;
  assert.equal(sebelum.alasanNull.cpaLunas, "SEBELUM_ATRIBUSI"); assert.equal(sebelum.nilaiOrderSetelahBiayaIklan, null);
  const parsial = baris(susunPerforma(laporanUntuk({ ...P, spend: SPEND_LENGKAP, mulaiHari: "2026-10-06" })), CAMP1).biaya;
  assert.equal(parsial.alasanNull.cpaLunas, "HARI_ATRIBUSI_PARSIAL");
});

test("nol yang sah ≠ tidak ada data: spend Rp0 → nilai-setelah-biaya = nilai order, ROAS null SPEND_NOL; tanpa spend → BELUM_ADA_SPEND", () => {
  const nol = baris(susunPerforma(laporanUntuk({ ...P, spend: [{ adId: AD1, spend: 0, hariAdaSpend: 4 }, { adId: AD2, spend: 0, hariAdaSpend: 4 }] })), CAMP1).biaya;
  assert.equal(nol.spend, 0);
  assert.equal(nol.nilaiOrderSetelahBiayaIklan, M(12));
  assert.equal(nol.bookedRoas, null); assert.equal(nol.alasanNull.bookedRoas, "SPEND_NOL");
  const tanpa = baris(susunPerforma(laporanUntuk({ ...P, spend: null })), CAMP1).biaya;
  assert.equal(tanpa.spend, null);
  assert.equal(tanpa.alasanNull.nilaiOrderSetelahBiayaIklan, "BELUM_ADA_SPEND");
  assert.equal(tanpa.nilaiOrderSetelahBiayaIklan, null);
  assert.equal(ringkasBiaya(undefined, 5).nilaiOrderSetelahBiayaIklan, null);
});

test("pembayaran: refund disetujui mengurangi uang bersih & bisa membatalkan 'lunas ledger'; coverage ledger parsial dilabeli sementara", () => {
  const rf = [{ orderId: "O2", amount: M(2), status: "DISETUJUI", approvedAt: D("2026-10-15T03:00:00Z"), date: D("2026-10-15T03:00:00Z") }];
  const c1 = baris(susunPerforma(laporanUntuk({ ...P, spend: SPEND_LENGKAP, refund: rf })), CAMP1);
  assert.equal(c1.uang.refundDisetujui, M(2));
  assert.equal(c1.uang.uangLedgerBersih, M(4) + 500_000, "O2 dikembalikan penuh");
  assert.equal(c1.order.customerLunasTerbuktiLedger, 1, "A2 tidak lagi lunas terbukti setelah refund penuh");
  assert.equal(c1.order.customerPernahMembayar, 3, "pernah membayar tetap (ada pembayaran sah), refund tidak menghapus fakta pembayaran");
  assert.equal(c1.sementara, true);
  assert.ok(c1.alasanSementara.some((a) => a.startsWith("CAKUPAN_LEDGER_")));
});

// ── rekap harian + akumulasi ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Spend harian per Ad (seperti loader asli: hanya hari di rentang) — jumlah hari rentang × tarif harian.
const TARIF_HARIAN = { [AD1]: 100_000, [AD2]: 50_000, [AD3]: 20_000, [AD9]: 5_000 };
const spendRentang = (dari, sampai) => { const n = Math.round((Date.parse(`${sampai}T00:00:00Z`) - Date.parse(`${dari}T00:00:00Z`)) / 86_400_000) + 1; return Object.entries(TARIF_HARIAN).map(([adId, t]) => ({ adId, spend: t * n, hariAdaSpend: n })); };
const stubHitung = () => async (_db, parameter) => laporanUntuk({ dari: parameter.dari, sampai: parameter.sampai, level: parameter.level, filter: parameter.filter, spend: spendRentang(parameter.dari, parameter.sampai), hariIni: parameter.hariIni });

test("rekap harian: Σ hitungan harian = akumulasi dihitung ulang; batas hari WIB 23:59:59 vs 00:00:00; KPI tidak dijumlahkan", async () => {
  const now = D("2026-11-20T03:00:00Z");
  const r = await rekapHarian(null, { dari: "2026-10-11", sampai: "2026-10-13" }, { now, hitung: stubHitung() });
  assert.deepEqual(r.harian.map((h) => h.tanggal), ["2026-10-11", "2026-10-12", "2026-10-13"]);
  const lead = Object.fromEntries(r.harian.map((h) => [h.tanggal, h.akuisisi.leadTerbukti]));
  // 11 Okt: A6. 12 Okt: B1 (23:59:59 WIB); A8 tanpa touch bukan akuisisi. 13 Okt: B2 (00:00:00 WIB) dan A9.
  assert.deepEqual(lead, { "2026-10-11": 1, "2026-10-12": 1, "2026-10-13": 2 }, "B2 (00:00:00 WIB) + A9 masuk 13 Okt; B1 (23:59:59 WIB) masuk 12 Okt");
  assert.equal(r.akumulasi.akuisisi.leadTerbukti, 4);
  assert.ok(r.pemeriksaanAditif.cek.every((c) => c.ok !== false), JSON.stringify(r.pemeriksaanAditif.cek.filter((c) => c.ok === false)));
  assert.ok(!r.peringatan.some((w) => w.kode === "REKAP_TIDAK_COCOK"));
  assert.equal(r.tampilan, "KOHORT_AKUISISI");
  assert.match(r.penjelasanTampilan, /bukan aktivitas kalender/i);
  assert.match(r.akumulasi.catatan, /bukan penjumlahan/);
  assert.ok(r.harian.every((h) => typeof h.umurKohortHari === "number"));
  assert.equal(r.harian[0].umurKohortHari, 40);
});

test("rekap harian: statusHari (PENUH/HARI_BERJALAN/HARI_ATRIBUSI_PARSIAL/SEBELUM_ATRIBUSI) dan mismatch terdeteksi", async () => {
  const now = D("2026-10-13T05:00:00Z");
  const hitung = async (_db, p) => laporanUntuk({ dari: p.dari, sampai: p.sampai, level: p.level, filter: p.filter, spend: spendRentang(p.dari, p.sampai), hariIni: "2026-10-13", mulaiHari: "2026-10-05" });
  const r = await rekapHarian(null, { dari: "2026-10-04", sampai: "2026-10-13" }, { now, hitung });
  const st = Object.fromEntries(r.harian.map((h) => [h.tanggal, h.statusHari]));
  assert.equal(st["2026-10-04"], "SEBELUM_ATRIBUSI");
  assert.equal(st["2026-10-05"], "HARI_ATRIBUSI_PARSIAL");
  assert.equal(st["2026-10-08"], "PENUH");
  assert.equal(st["2026-10-13"], "HARI_BERJALAN");
  assert.equal(r.harian.find((h) => h.tanggal === "2026-10-13").biaya.alasanNull.cpaLunas, "HARI_BERJALAN_PARSIAL");
  // akumulasi yang sengaja tidak cocok → peringatan
  let n = 0;
  const rusak = async (_db, p) => { const l = laporanUntuk({ dari: p.dari, sampai: p.sampai, level: p.level, spend: spendRentang(p.dari, p.sampai), hariIni: "2026-10-13" }); if (++n >= 3) l.jumlahTeratribusi.leadUnik += 1; return l; };
  const r2 = await rekapHarian(null, { dari: "2026-10-11", sampai: "2026-10-12" }, { now, hitung: rusak });
  assert.ok(r2.peringatan.some((w) => w.kode === "REKAP_TIDAK_COCOK"));
});

test("rekap harian: validasi parameter dan batas panjang; filter campaign memakai level adset", async () => {
  const now = D("2026-11-20T03:00:00Z");
  await assert.rejects(() => rekapHarian(null, { dari: "2026-10-01" }, { now, hitung: stubHitung() }), ParameterError);
  await assert.rejects(() => rekapHarian(null, { dari: "2026-10-01", sampai: "2026-11-15" }, { now, hitung: stubHitung() }), /paling lama 31 hari/);
  await assert.rejects(() => rekapHarian(null, { dari: "2026-11-19", sampai: "2026-11-21" }, { now, hitung: stubHitung() }), /masa depan/);
  assert.equal(MAKS_HARI_REKAP, 31);
  let levelDipakai;
  const hitung = async (_db, p) => { levelDipakai = [p.level, p.filter?.campaignId]; return laporanUntuk({ dari: p.dari, sampai: p.sampai, level: p.level, filter: p.filter, spend: spendRentang(p.dari, p.sampai) }); };
  const r = await rekapHarian(null, { dari: "2026-10-11", sampai: "2026-10-11", campaignId: CAMP1 }, { now, hitung });
  assert.deepEqual(levelDipakai, ["adset", CAMP1]);
  assert.equal(r.periodeLead.filter.campaignId, CAMP1);
});

// ── rekonsiliasi lintas level ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("rekonsiliasi campaign = Σ ad set = Σ ad (metrik aditif, spend) pada snapshot yang sama; selisih terdeteksi", () => {
  const per = Object.fromEntries(["campaign", "adset", "ad"].map((l) => [l, laporanUntuk({ ...P, level: l, spend: SPEND_LENGKAP })]));
  const ok = rekonsiliasiLintasLevel(per);
  assert.equal(ok.ok, true, JSON.stringify(ok.gagal));
  assert.ok(ok.jumlahCek >= 30);
  per.ad.jumlahTeratribusi.customerDenganOrder += 1;
  assert.equal(rekonsiliasiLintasLevel(per).ok, false);
});

// ── penjaga bersama ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("penjaga: satu perhitungan sekaligus; endpoint (denganPenjaga) ditolak 429-kode saat sibuk, MCP (denganAntrean) menunggu giliran", async () => {
  let lepas; const tahan = new Promise((r) => { lepas = r; });
  const a = denganPenjaga(() => tahan);
  assert.equal(sedangDihitung(), true);
  await assert.rejects(() => denganPenjaga(async () => 1), (e) => e instanceof SedangDihitungError && e.statusCode === 429 && e.code === "SEDANG_DIHITUNG");
  const antre = denganAntrean(async () => "jalan", { tungguMs: 2000, langkahMs: 10 });
  setTimeout(lepas, 40);
  await a;
  assert.equal(await antre, "jalan");
  assert.equal(sedangDihitung(), false);
  let lepas2; const tahan2 = new Promise((r) => { lepas2 = r; });
  const b = denganPenjaga(() => tahan2);
  await assert.rejects(() => denganAntrean(async () => 1, { tungguMs: 30, langkahMs: 10 }), SedangDihitungError);
  lepas2(); await b;
  await assert.rejects(() => denganPenjaga(async () => { throw new Error("x"); }), /x/);
  assert.equal(sedangDihitung(), false, "penjaga dilepas walau fungsi gagal");
});

// ── kontrak MCP: discovery, schema, galat parameter (tanpa DB) ───────────────────────────────────────────────────────────────────────────────
const TOKEN = "token-uji-laporan-meta";
async function mcp() {
  process.env.MCP_API_TOKEN = TOKEN; process.env.MCP_OAUTH_JWT_SECRET = "";
  const { mcpRouter } = await import("../src/mcp/index.js");
  const app = express(); app.use(express.json()); app.use("/mcp", mcpRouter);
  const server = app.listen(0); await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  let id = 0;
  const rpc = async (method, params = {}, token = TOKEN) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    const teks = await res.text();
    const baris = teks.split("\n").find((l) => l.startsWith("data:")) ?? teks;
    let json = null; try { json = JSON.parse(baris.replace(/^data:\s*/, "")); } catch { /* bukan JSON */ }
    return { status: res.status, json };
  };
  return { rpc, tutup: () => new Promise((r) => server.close(r)) };
}

test("MCP discovery: tiga tool baru terlihat, read-only, schema benar; tool legacy tetap ada dan menyatakan batasannya", async (t) => {
  const { rpc, tutup } = await mcp(); t.after(tutup);
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "tes", version: "1" } });
  const { json } = await rpc("tools/list");
  const tools = Object.fromEntries(json.result.tools.map((x) => [x.name, x]));
  for (const nama of ["performa_campaign_meta", "rekap_harian_meta", "kesehatan_atribusi_meta"]) {
    assert.ok(tools[nama], `${nama} tidak terdaftar`);
    assert.equal(tools[nama].annotations.readOnlyHint, true); assert.equal(tools[nama].annotations.destructiveHint, false);
  }
  const prop = tools.performa_campaign_meta.inputSchema.properties;
  assert.deepEqual(prop.level.enum, ["campaign", "adset", "ad"]);
  assert.deepEqual(prop.urutkan.enum, DAFTAR_KRITERIA);
  assert.ok(prop.campaignId && prop.adSetId && prop.batas && prop.dari && prop.sampai);
  assert.ok((tools.performa_campaign_meta.inputSchema.required ?? []).length === 0, "semua parameter opsional (bawaan 7 hari penuh)");
  assert.ok(tools.kesehatan_atribusi_meta.inputSchema.properties.periksaLintasLevel);
  // legacy kompatibel
  assert.ok(tools.performa_iklan, "tool legacy performa_iklan harus tetap ada");
  assert.deepEqual(Object.keys(tools.performa_iklan.inputSchema.properties).sort(), ["dari", "hanyaDikonfirmasi", "sampai"], "parameter legacy tidak berubah");
  assert.match(tools.performa_iklan.description, /BATASAN \(LEGACY\)/);
  assert.match(tools.performa_iklan.description, /performa_campaign_meta/);
  // tidak ada tool yang menulis
  for (const x of Object.values(tools)) assert.equal(x.annotations.readOnlyHint, true, x.name);
});

test("MCP: tanpa token ditolak 401; parameter salah → isError dengan kode, tanpa menyentuh DB", async (t) => {
  const { rpc, tutup } = await mcp(); t.after(tutup);
  assert.equal((await rpc("tools/list", {}, null)).status, 401);
  assert.equal((await rpc("tools/list", {}, "salah")).status, 401);
  const panggil = async (name, args) => { const r = await rpc("tools/call", { name, arguments: args }); return r.json.result; };
  const sepihak = await panggil("performa_campaign_meta", { dari: "2026-10-01" });
  assert.equal(sepihak.isError, true);
  assert.equal(JSON.parse(sepihak.content[0].text).kode, "PARAMETER_TIDAK_VALID");
  const masaDepan = await panggil("rekap_harian_meta", { dari: "2999-01-01", sampai: "2999-01-02" });
  assert.equal(masaDepan.isError, true);
  const adsetTanpaFilter = await panggil("performa_campaign_meta", { level: "campaign", campaignId: "52694481763084" });
  assert.equal(adsetTanpaFilter.isError, true, "filter campaignId hanya untuk level adset/ad");
  const urutSalah = await panggil("performa_campaign_meta", { urutkan: "ngasal" });
  assert.equal(urutSalah.isError, true, "enum urutkan ditolak oleh schema");
  const idSalah = await panggil("performa_campaign_meta", { level: "adset", campaignId: "abc" });
  assert.equal(idSalah.isError, true, "ID Meta harus digit");
  const terlaluPanjang = await panggil("kesehatan_atribusi_meta", { dari: "2026-01-01", sampai: "2026-09-01" });
  assert.equal(terlaluPanjang.isError, true);
});

test("laporanPerforma / kesehatanAtribusi: parameter divalidasi dengan aturan endpoint sebelum menyentuh DB", async () => {
  const now = D("2026-10-29T03:00:00Z");
  await assert.rejects(() => laporanPerforma(null, { dari: "2026-10-01" }, { now }), ParameterError);
  await assert.rejects(() => laporanPerforma(null, { urutkan: "ngasal" }, { now }), ParameterError);
  await assert.rejects(() => laporanPerforma(null, { level: "ad", adSetId: "12" }, { now }), ParameterError);
  await assert.rejects(() => kesehatanAtribusi(null, { dari: "2026-05-01", sampai: "2026-10-01" }, { now }), /93 hari/);
  // bawaan = 7 hari penuh berakhir kemarin
  let dipakai;
  await laporanPerforma(null, {}, { now, hitung: async (_d, p) => { dipakai = p; return laporanUntuk({ dari: "2026-10-22", sampai: "2026-10-28" }); } });
  assert.deepEqual([dipakai.dari, dipakai.sampai, dipakai.level, dipakai.bawaan], ["2026-10-22", "2026-10-28", "campaign", true]);
});
