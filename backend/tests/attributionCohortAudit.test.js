// REKONSILIASI terhadap angka audit Fase 1 (docs/ATRIBUSI-FASE1-AUDIT-REVIEW.md, 10 Okt 2026).
// Masukan = fixture sintetis berbentuk audit (tests/fixtures/attributionAuditShape.js), bukan data produksi: tes ini membuktikan KODE menghasilkan
// angka audit dari data berbentuk audit, termasuk selisih terhadap definisi Dashboard. Perbandingan terhadap produksi dilakukan terpisah (laporan).
import test from "node:test";
import assert from "node:assert/strict";
import { buildCohort } from "../src/services/attribution/cohort.js";
import { susunLaporan } from "../src/services/attribution/cohortReport.js";
import { bangunFixtureBentukAudit, hitungDefinisiDashboard } from "./fixtures/attributionAuditShape.js";

const masukan = bangunFixtureBentukAudit();
const r = buildCohort(masukan);
const jum = (obj, f) => Object.values(obj).reduce((s, x) => s + f(x), 0);

test("populasi: 9.362 customer = 8.825 lead sah + 537 dikecualikan (535 SPAM, 1 B2B, 1 staf bukan-SPAM)", () => {
  assert.equal(masukan.customers.length, 9362);
  assert.equal(r.total.leads, 8825);
  assert.deepEqual(
    Object.fromEntries(Object.entries(r.luarKohort.perAlasan).map(([k, v]) => [k, v.customers])),
    { SPAM: 535, B2B_DIRECT: 1, INTERNAL_STAFF: 1 },
  );
});

test("customer dengan order: kohort 406; Dashboard 415 — selisih persis 9 customer yang hanya punya order PENDING", () => {
  const dash = hitungDefinisiDashboard(masukan);
  assert.equal(dash.customerDenganOrder, 415);
  assert.equal(r.total.customerDenganOrder, 406);
  assert.equal(r.total.customerHanyaOrderPending, 9);
  assert.equal(dash.customerDenganOrder - r.total.customerDenganOrder, r.total.customerHanyaOrderPending);
});

test("sebaran order per customer: 0=8.419, 1=297, 2=64, 3+=45; repeat kohort 109 vs Dashboard 111", () => {
  assert.deepEqual(r.total.customerMenurutJumlahOrder, { "0": 8419, "1": 297, "2": 64, "3+": 45 });
  assert.equal(jum(r.perBulanLead, (k) => k.customerRepeat), 109);
  assert.equal(hitungDefinisiDashboard(masukan).repeat, 111);
});

test("jumlah order: 617 eligible, 42 batal, 21 pending", () => {
  assert.equal(r.total.orders, 617);
  assert.equal(r.total.orderBatal, 42);
  assert.equal(r.total.orderPending, 21);
});

test("per bulan ORDER: total, dari lead lama, dan order berulang (customer lama order lagi)", () => {
  const o = r.perBulanOrder;
  assert.deepEqual(["2026-07", "2026-08", "2026-09", "2026-10"].map((m) => o[m].orders), [123, 208, 221, 65]);
  assert.deepEqual(["2026-08", "2026-09", "2026-10"].map((m) => o[m].orderDariLeadLama), [39, 55, 35]);
  assert.equal(o["2026-07"].orderDariLeadLama, 0);
  assert.equal(o["2026-10"].orderDariLeadBulanSama, 30);
  assert.equal(o["2026-10"].orderBerulang, 25);
  assert.equal(o["2026-10"].orderPertamaCustomer, 40);
  assert.equal(o["2026-10"].orderSebelumLead, 0);
  // 35/65 = 54% order Oktober berasal dari lead bulan lama: pembacaan kohort tanggal-lead saja akan melewatkannya
  assert.equal(Math.round((35 / 65) * 100), 54);
});

test("cakupan ledger per bulan ORDER: Jul 8/123, Agu 61/208, Sep 202/221, Okt 19/65", () => {
  const c = (m) => `${r.perBulanOrder[m].cakupanLedger.orderBerLedger}/${r.perBulanOrder[m].cakupanLedger.orderEligible}`;
  assert.deepEqual(["2026-07", "2026-08", "2026-09", "2026-10"].map(c), ["8/123", "61/208", "202/221", "19/65"]);
  assert.equal(r.total.orderBerLedger, 290);
});

test("status lunas tersimpan 556; 270 tanpa ledger; 133 backfill = tanggal tidak pasti; 4 DP kini", () => {
  assert.equal(r.total.lunasMenurutCrm.jumlah, 556);
  assert.equal(r.total.buktiPelunasan.lunasTanpaLedger, 270);
  assert.equal(r.total.lunasMenurutCrm.tanggalTidakPasti, 133);
  assert.equal(r.total.lunasMenurutCrm.tanggalPasti, 556 - 133);
  assert.equal(r.total.lunasMenurutCrm.tanpaTanggal, 0);
  assert.equal(r.total.orderDpSaatIniLedger, 4);
  assert.equal(r.total.lunasTerbuktiLedger.jumlah, 286, "ledger valid hanya melunaskan 286 dari 556 yang tersimpan LUNAS");
  assert.equal(r.total.selisihStatusBayar, 270, "270 order LUNAS tersimpan berbeda dari hitungan ulang ledger");
});

test("rupiah: nilai order LUNAS Rp1.248,7 jt TIDAK sama dengan uang ledger Rp633,7 jt", () => {
  const nilaiLunas = jum(r.perBulanLead, (k) => k.lunasMenurutCrm.nilai);
  assert.equal(nilaiLunas, 1_248_700_000);
  assert.equal(r.total.uangLedger, 633_700_000);
  assert.equal(r.total.refundDisetujui, 0);
  assert.equal(r.total.uangBersihLedger, 633_700_000);
  assert.ok(nilaiLunas - r.total.uangLedger > 600_000_000, "selisih besar: jangan menjumlah order lunas sebagai uang masuk");
});

test("tren tanggal lunas presisi tidak memuat 133 order backfill: tidak ada tambahan 31 Agt", () => {
  const sumPasti = jum(r.perBulanPembayaran, (b) => b.lunasMenurutCrm.jumlah);
  assert.equal(sumPasti, 423);
  // Agustus = 61 order ber-ledger (dibayar Agt) + 74 LUNAS tanpa-ledger non-backfill (paidAt Agt). Bila 133 backfill ikut masuk, Agustus menjadi 268.
  assert.equal(r.perBulanPembayaran["2026-08"].lunasMenurutCrm.jumlah, 61 + 74);
  assert.equal(r.perBulanPembayaran["2026-07"].lunasMenurutCrm.jumlah, 8 + 55);
});

test("prospek: 991 di stage prospek-atau-lanjut, 873 bertanggal, 118 tanpa transisi (diberi nama 'pernah ditandai prospek')", () => {
  assert.equal(jum(r.perBulanLead, (k) => k.pernahDitandaiProspek.stageSaatIni), 991);
  assert.equal(r.total.pernahDitandaiProspekBerTanggal, 873);
  assert.equal(r.total.pernahDitandaiProspekTanpaTanggal, 118);
});

test("rekonsiliasi internal lolos untuk seluruh fixture berbentuk audit", () => {
  assert.equal(r.rekonsiliasi.ok, true, JSON.stringify(r.rekonsiliasi.cek.filter((c) => !c.ok)));
});

test("laporan endpoint (susunLaporan, Jul–Okt): peringatan jujur dan tanpa campaign/ad/ROAS", () => {
  const lap = susunLaporan({ meta: { gate: { enabled: true, since: "2026-09-29T17:46:00.000Z" } }, ...r }, { dari: "2026-07", sampai: "2026-10", bulanBerjalan: "2026-10" }, { dihitungPada: new Date("2026-10-10T05:00:00Z") });
  const kode = lap.peringatan.map((w) => w.kode);
  for (const k of ["LEDGER_TIDAK_LENGKAP", "LUNAS_TANPA_LEDGER", "TANGGAL_LUNAS_TIDAK_PASTI", "PROSPEK_TANPA_TANGGAL", "SELISIH_DASHBOARD_PENDING", "BULAN_BERJALAN"]) assert.ok(kode.includes(k), `peringatan hilang: ${k}`);
  assert.ok(!kode.includes("REKONSILIASI_GAGAL"));
  assert.equal(lap.jumlahPeriode.perBulanOrder.orders, 617);
  assert.equal(lap.jumlahPeriode.perBulanOrder.cakupanLedger.persenOrderBerLedger, 47);   // 290/617 = 47,0%
  assert.equal(lap.jumlahPeriode.perBulanOrder.customerUnik, undefined, "distinct tidak boleh dijumlahkan lintas bulan");
  assert.equal(lap.perBulanOrder["2026-07"].cakupanLedger.persenOrderBerLedger, 6.5);       // 8/123
  assert.equal(lap.statusMetrik.atribusi_campaign, "BELUM_ADA_DATA");
  const teks = JSON.stringify(lap);
  for (const kunci of ["campaignId", "adSetId", "adId", "roas", "ROAS", "ctwaClid", "phone"]) assert.ok(!teks.includes(kunci), `terlarang: ${kunci}`);
  assert.ok(!/\bROAS\b/i.test(teks));
  assert.ok(!/"c\d{5}"|"o\d{5}"/.test(teks), "id fixture tidak boleh bocor");
});

test("filter rentang: bulan di luar jendela tidak muncul tetapi rekonsiliasi memakai seluruh riwayat", () => {
  const lap = susunLaporan({ meta: {}, ...r }, { dari: "2026-09", sampai: "2026-09", bulanBerjalan: "2026-10" });
  assert.deepEqual(Object.keys(lap.perBulanOrder), ["2026-09"]);
  assert.deepEqual(Object.keys(lap.perBulanPembayaran), ["2026-09"]);
  assert.equal(lap.riwayatPenuh.total.orders, 617);
  assert.ok(!lap.peringatan.some((w) => w.kode === "BULAN_BERJALAN"));
});

test("bukti pelunasan pada fixture dasar: 286 terbukti ledger + 270 tanpa ledger = 556 LUNAS tersimpan; tanpa konflik", () => {
  assert.equal(r.total.buktiPelunasan.lunasTerbuktiLedger, 286);
  assert.equal(r.total.buktiPelunasan.lunasTanpaLedger, 270);
  assert.equal(r.total.buktiPelunasan.konflikLunasTersimpanLedgerTidakCukup, 0);
  assert.equal(r.total.buktiPelunasan.konflikBelumLunasTersimpanLedgerCukup, 0);
  assert.equal(r.total.orderDpSaatIniKonflikLunasCrm, 0);
  assert.equal(r.total.buktiPelunasan.lunasTerbuktiLedger + r.total.buktiPelunasan.lunasTanpaLedger, r.total.lunasMenurutCrm.jumlah);
  assert.equal(jum(r.perBulanLead, (k) => k.cakupanLedger.berLedgerCukup), 286 + 0, "286 LUNAS ber-ledger; 4 DP sebagian");
  assert.equal(jum(r.perBulanLead, (k) => k.cakupanLedger.berLedgerSebagian), 4);
});

test("varian dengan SATU order konflik (LUNAS tersimpan, ledger 50%) mereproduksi angka produksi: 285 terbukti / 270 tanpa ledger / 1 konflik; DP kini 5 (4 selaras + 1 konflik)", () => {
  const v = bangunFixtureBentukAudit();
  const sep = v.orders.find((o) => o.createdAt.startsWith("2026-09") && o.paymentStatus === "LUNAS" && v.kontribusi.some((p) => p.orderId === o.id));
  const pembayaran = v.kontribusi.find((p) => p.orderId === sep.id);
  const penuh = pembayaran.amount;
  pembayaran.amount = Math.floor(penuh / 2);        // ledger hanya 50%; status tersimpan tetap LUNAS
  const rv = buildCohort(v);
  const t = rv.total;
  const bp = t.buktiPelunasan;
  assert.equal(t.lunasMenurutCrm.jumlah, 556, "konflik TETAP di lunas menurut CRM");
  assert.equal(t.lunasTerbuktiLedger.jumlah, 285, "konflik TIDAK di lunas terbukti ledger");
  assert.equal(bp.lunasTerbuktiLedger, 285);
  assert.equal(bp.lunasTanpaLedger, 270);
  assert.equal(bp.konflikLunasTersimpanLedgerTidakCukup, 1);
  assert.equal(bp.kekuranganRupiahKonflik, penuh - Math.floor(penuh / 2));
  assert.equal(t.orderDpSaatIniLedger, 5, "ledger: 4 DP selaras + 1 konflik");
  assert.equal(t.orderDpSaatIniKonflikLunasCrm, 1, "satu-satunya DP kini yang berstatus LUNAS tersimpan, berlabel konflik");
  assert.equal(t.lunasTerbuktiLedger.jumlah, 285);
  assert.equal(t.selisihStatusBayar, 271, "270 tanpa ledger + 1 konflik");
  assert.equal(bp.lunasTerbuktiLedger + bp.lunasTanpaLedger + bp.konflikLunasTersimpanLedgerTidakCukup, t.lunasMenurutCrm.jumlah, "partisi tepat satu");
  assert.equal(rv.rekonsiliasi.ok, true, JSON.stringify(rv.rekonsiliasi.cek.filter((c) => !c.ok)));
  // laporan: konflik muncul sebagai peringatan, bukan disamarkan
  const lap = susunLaporan({ meta: {}, ...rv }, { dari: "2026-07", sampai: "2026-10", bulanBerjalan: "2026-10" });
  const w = lap.peringatan.find((x) => x.kode === "KONFLIK_STATUS_LUNAS_LEDGER");
  assert.ok(w);
  assert.equal(w.data.konflikLunasTersimpanLedgerTidakCukup, 1);
  assert.equal(lap.perBulanOrder["2026-09"].buktiPelunasan.konflikLunasTersimpanLedgerTidakCukup, 1);
  assert.equal(lap.perBulanOrder["2026-09"].cakupanLedger.berLedgerSebagian, 1);
});
