// Tes inti kohort FASE 1 (services/attribution/cohort.js) — murni, tanpa DB.
// Angka fixture A/B/C sama dengan contoh hitung di docs/ATRIBUSI-COHORT-FASE1.md; mengubah salah satu berarti mengubah dokumen.
// Tidak ada isi chat, nama, atau data kesehatan di fixture.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildCohort, jejakPembayaran, buktiPelunasanOrder, tanggalLunasMenurutCrm, hariWIB, bulanWIB, alasanBukanLead } from "../src/services/attribution/cohort.js";
import { ORDER_EXCLUDED_STATUS, STAGE_PROSPEK_ATAU_LANJUT, PAID_AT_BACKFILL_31_AGT, METRICS, STATUS } from "../src/services/attribution/cohortDefinitions.js";

const cust = (id, createdAt, o = {}) => ({ id, createdAt, pipelineStage: "NEW", leadSource: "META_ADS", isInternalStaff: false, staffUserId: null, transitions: [], ...o });
const ord = (id, customerId, createdAt, value, o = {}) => ({ id, customerId, createdAt, value, tagihan: value, status: "PROCESSING", penjualanKaryawanId: null, paymentStatus: "BELUM_BAYAR", paidAt: null, ...o });
const pay = (id, orderId, createdAt, amount) => ({ id, orderId, createdAt, amount });
const M = (n) => n * 1_000_000;

// ── Contoh A: lead lama (Agustus) yang order & lunas Oktober ──────────────────────────────────────────────────────────
const A = {
  customers: [cust("C1", "2026-08-20T03:00:00Z")],
  orders: [ord("O1", "C1", "2026-10-05T02:00:00Z", M(5), { paymentStatus: "LUNAS", paidAt: "2026-10-06T03:00:00Z" })],
  kontribusi: [pay("P1", "O1", "2026-10-06T03:00:00Z", M(5))],
};
// ── Contoh B: lead baru dengan DUA order; DP lalu pelunasan bulan berikutnya ──────────────────────────────────────────
const B = {
  customers: [cust("C2", "2026-09-28T03:00:00Z", { pipelineStage: "TRANSACTION", transitions: [{ toStage: "PROSPECT", createdAt: "2026-09-29T03:00:00Z" }, { toStage: "TRANSACTION", createdAt: "2026-09-30T03:00:00Z" }] })],
  orders: [
    ord("O2", "C2", "2026-09-30T03:00:00Z", M(3), { paymentStatus: "LUNAS", paidAt: "2026-10-02T04:00:00Z" }),
    ord("O3", "C2", "2026-10-10T03:00:00Z", M(2), { paymentStatus: "DP" }),
  ],
  kontribusi: [pay("Pa", "O2", "2026-09-30T04:00:00Z", M(1)), pay("Pb", "O2", "2026-10-02T04:00:00Z", M(2)), pay("Pc", "O3", "2026-10-10T05:00:00Z", 500_000)],
};
// ── Contoh C: pembatalan, refund, lead tanpa order, SPAM, dan tepi zona waktu ─────────────────────────────────────────
const C = {
  customers: [
    cust("C3", "2026-10-01T00:00:00Z"),
    cust("C4", "2026-10-15T03:00:00Z"),                                            // lead tanpa order
    cust("C5", "2026-10-03T03:00:00Z", { pipelineStage: "SPAM" }),                 // dikecualikan
    cust("C6", "2026-09-30T17:30:00Z"),                                            // 01 Okt 00:30 WIB → kohort Oktober
  ],
  orders: [
    ord("O4", "C3", "2026-10-02T03:00:00Z", M(4), { status: "CANCELLED" }),
    ord("O5", "C3", "2026-10-03T03:00:00Z", M(2)),
    ord("O6", "C5", "2026-10-04T03:00:00Z", M(1)),
  ],
  kontribusi: [pay("Pd", "O4", "2026-10-02T04:00:00Z", M(1)), pay("Pe", "O5", "2026-10-03T04:00:00Z", M(2)), pay("Pf", "O6", "2026-10-04T04:00:00Z", M(1))],
  refunds: [{ orderId: "O5", amount: 500_000, approvedAt: "2026-10-20T03:00:00Z", status: "DISETUJUI" }],
};
const gabung = (...xs) => ({
  customers: xs.flatMap((x) => x.customers), orders: xs.flatMap((x) => x.orders),
  kontribusi: xs.flatMap((x) => x.kontribusi), refunds: xs.flatMap((x) => x.refunds || []),
});
const gagal = (r) => JSON.stringify(r.rekonsiliasi.cek.filter((c) => !c.ok));

test("Contoh A — lead Agustus order & lunas Oktober: tiga laporan terpisah (lead Agu, order Okt, bayar Okt)", () => {
  const r = buildCohort(A);
  const k = r.perBulanLead["2026-08"];
  assert.equal(k.leads, 1);
  assert.equal(k.customerDenganOrder, 1);
  assert.equal(k.customerOrderPertamaBulanSama, 0);
  assert.equal(k.orders, 1); assert.equal(k.nilaiOrder, M(5));
  assert.equal(k.lunasTerbuktiLedger.jumlah, 1); assert.equal(k.orderPernahDp, 0); assert.equal(k.orderDpSaatIniLedger, 0);
  assert.equal(k.uangLedger, M(5));
  assert.deepEqual(k.menurutBulanOrder, { "2026-10": 1 });
  assert.deepEqual(k.menurutBulanPembayaran, { "2026-10": { uang: M(5), refund: 0 } });
  assert.deepEqual(k.menurutBulanLunasMenurutCrm, { "2026-10": 1 });
  assert.equal(k.lunasMenurutCrm.jumlah, 1); assert.equal(k.lunasMenurutCrm.tanggalPasti, 1); assert.equal(k.lunasMenurutCrm.didukungLedger, 1);
  assert.deepEqual(k.cakupanLedger, { orderEligible: 1, orderBerLedger: 1, berLedgerCukup: 1, berLedgerSebagian: 0, orderTanpaLedger: 0, nilaiOrderTanpaLedger: 0 });
  assert.deepEqual(k.buktiPelunasan, { lunasTerbuktiLedger: 1, lunasTanpaLedger: 0, konflikLunasTersimpanLedgerTidakCukup: 0, konflikBelumLunasTersimpanLedgerCukup: 0, kekuranganRupiahKonflik: 0 });
  assert.equal(r.perBulanLead["2026-10"], undefined, "tidak ada lead baru di Oktober");

  const o = r.perBulanOrder["2026-10"];
  assert.equal(o.orders, 1); assert.equal(o.nilaiOrder, M(5)); assert.equal(o.customerUnik, 1);
  assert.equal(o.orderDariLeadLama, 1); assert.equal(o.orderDariLeadBulanSama, 0);
  assert.equal(o.orderPertamaCustomer, 1); assert.equal(o.orderBerulang, 0);
  const p = r.perBulanPembayaran["2026-10"];
  assert.equal(p.uangLedger, M(5)); assert.equal(p.jumlahPembayaran, 1); assert.equal(p.orderDibayar, 1);
  assert.equal(p.uangDariLeadLama, M(5)); assert.equal(p.lunasMenurutCrm.jumlah, 1); assert.equal(p.lunasMenurutCrm.didukungLedger, 1);
  assert.equal(r.rekonsiliasi.ok, true, gagal(r));
});

test("Contoh B — satu customer, dua order, DP lalu pelunasan bulan berikutnya: tiga satuan tidak tercampur", () => {
  const r = buildCohort(B);
  const k = r.perBulanLead["2026-09"];
  assert.equal(k.leads, 1);                       // satuan customer
  assert.equal(k.customerDenganOrder, 1);         // tetap 1 walau 2 order
  assert.equal(k.customerRepeat, 1);
  assert.equal(k.orders, 2);                      // satuan order
  assert.equal(k.nilaiOrder, M(5));               // booked
  assert.equal(k.lunasTerbuktiLedger.jumlah, 1);            // O2 lunas 2 Okt
  assert.equal(k.orderDpSaatIniLedger, 1);              // O3 masih DP
  assert.equal(k.orderPernahDp, 2);               // O2 pernah DP lalu lunas, O3 DP
  assert.equal(k.uangLedger, 3_500_000);          // satuan uang (3 pembayaran)
  assert.deepEqual(k.menurutBulanOrder, { "2026-09": 1, "2026-10": 1 });
  assert.deepEqual(k.menurutBulanPembayaran, { "2026-09": { uang: M(1), refund: 0 }, "2026-10": { uang: 2_500_000, refund: 0 } });
  assert.deepEqual(k.menurutBulanLunasMenurutCrm, { "2026-10": 1 });   // lunas dihitung di bulan pelunasan, bukan bulan order
  assert.deepEqual(k.statusBayarTersimpan, { BELUM_BAYAR: 0, DP: 1, LUNAS: 1, LAIN: 0 });
  assert.equal(k.pernahDitandaiProspek.berTanggal, 1); assert.equal(k.pernahDitandaiProspek.tanpaTanggal, 0);

  assert.equal(r.perBulanOrder["2026-09"].orderDariLeadBulanSama, 1);
  assert.equal(r.perBulanOrder["2026-09"].orderPertamaCustomer, 1);
  assert.equal(r.perBulanOrder["2026-10"].orderDariLeadLama, 1);
  assert.equal(r.perBulanOrder["2026-10"].orderBerulang, 1, "order kedua customer yang sama");
  assert.equal(r.perBulanPembayaran["2026-09"].uangLedger, M(1));
  assert.equal(r.perBulanPembayaran["2026-09"].lunasMenurutCrm.jumlah, 0);
  assert.equal(r.perBulanPembayaran["2026-10"].uangLedger, 2_500_000);
  assert.equal(r.perBulanPembayaran["2026-10"].jumlahPembayaran, 2);
  assert.equal(r.perBulanPembayaran["2026-10"].orderDibayar, 2);
  assert.equal(r.perBulanPembayaran["2026-10"].lunasMenurutCrm.jumlah, 1);
  assert.equal(r.rekonsiliasi.ok, true, gagal(r));
  const o2 = jejakPembayaran(B.kontribusi.filter((p) => p.orderId === "O2"), M(3));
  assert.equal(o2.hariBayarPertama, "2026-09-30"); assert.equal(o2.hariLunas, "2026-10-02"); assert.equal(o2.pernahDp, true); assert.equal(o2.status, "LUNAS");
});

test("Contoh C — batal, refund, lead tanpa order, SPAM, dan tepi WIB", () => {
  const r = buildCohort(C);
  const k = r.perBulanLead["2026-10"];
  assert.equal(k.leads, 3);                                   // C3, C4, C6 (C6 = 01 Okt 00:30 WIB); C5 SPAM dikecualikan
  assert.equal(r.perBulanLead["2026-09"], undefined, "C6 jatuh 30 Sep 17:30 UTC = 01 Okt WIB → bukan kohort September");
  assert.equal(k.customerDenganOrder, 1);                     // hanya C3
  assert.equal(k.orders, 1); assert.equal(k.nilaiOrder, M(2)); // O4 batal tidak dihitung
  assert.equal(k.orderBatal, 1); assert.equal(k.uangPadaOrderBatal, M(1));
  assert.equal(k.uangLedger, M(2));                           // uang pada order batal TIDAK masuk uangLedger
  assert.equal(k.refundDisetujui, 500_000); assert.equal(k.uangBersihLedger, 1_500_000);
  assert.equal(k.lunasTerbuktiLedger.jumlah, 0, "net 1,5 jt < tagihan 2 jt setelah refund → bukan lunas");
  assert.equal(k.orderDpSaatIniLedger, 1); assert.equal(k.orderPernahDp, 0, "pembayaran pertama menutup tagihan → tidak melewati fase DP");
  assert.equal(k.orderDenganRefund, 1);
  assert.deepEqual(r.luarKohort.perAlasan.SPAM, { customers: 1, orders: 1, nilaiOrder: M(1), uangLedger: M(1) });
  assert.equal(r.luarKohort.uangLedger, M(1));
  const p = r.perBulanPembayaran["2026-10"];
  assert.equal(p.refundDisetujui, 500_000, "refund dicatat di bulan persetujuan (WIB)");
  assert.equal(p.uangBersihLedger, 1_500_000);
  assert.equal(r.rekonsiliasi.ok, true, gagal(r));
});

test("gabungan A+B+C: total & rekonsiliasi (setiap satuan terpisah, partisi lengkap)", () => {
  const r = buildCohort(gabung(A, B, C));
  assert.deepEqual(
    { leads: r.total.leads, customerDenganOrder: r.total.customerDenganOrder, orders: r.total.orders, nilaiOrder: r.total.nilaiOrder, uangLedger: r.total.uangLedger, refund: r.total.refundDisetujui, bersih: r.total.uangBersihLedger, batal: r.total.orderBatal },
    { leads: 5, customerDenganOrder: 3, orders: 4, nilaiOrder: M(12), uangLedger: 10_500_000, refund: 500_000, bersih: 10_000_000, batal: 1 },
  );
  assert.equal(r.bagianOrder.eligible + r.bagianOrder.pending + r.bagianOrder.batal + r.bagianOrder.luar, 6);
  assert.equal(r.rekonsiliasi.ok, true, gagal(r));
  assert.deepEqual(Object.keys(r.perBulanLead), ["2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(r.total.customerMenurutJumlahOrder, { "0": 2, "1": 2, "2": 1, "3+": 0 });
});

test("backfill paidAt 31 Agt 2026 = tanggal TIDAK PASTI: tidak masuk tren tanggal lunas presisi mana pun", () => {
  const backfill = PAID_AT_BACKFILL_31_AGT.toISOString();
  const r = buildCohort({
    customers: [cust("L", "2026-07-10T03:00:00Z")],
    orders: [
      ord("b1", "L", "2026-07-11T03:00:00Z", M(2), { paymentStatus: "LUNAS", paidAt: backfill }),
      ord("b2", "L", "2026-07-12T03:00:00Z", M(3), { paymentStatus: "LUNAS", paidAt: backfill }),
      ord("t1", "L", "2026-07-13T03:00:00Z", M(1), { paymentStatus: "LUNAS", paidAt: "2026-07-20T03:00:00Z" }),
      ord("n1", "L", "2026-07-14T03:00:00Z", M(1), { paymentStatus: "LUNAS", paidAt: null }),
      // 1 ms dari timestamp backfill ≠ backfill: pencocokan harus EXACT
      ord("t2", "L", "2026-07-15T03:00:00Z", M(1), { paymentStatus: "LUNAS", paidAt: new Date(PAID_AT_BACKFILL_31_AGT.getTime() + 1) }),
    ],
    kontribusi: [],
  });
  const k = r.perBulanLead["2026-07"];
  assert.deepEqual(k.lunasMenurutCrm, { jumlah: 5, nilai: M(8), tanggalPasti: 2, tanggalTidakPasti: 2, tanpaTanggal: 1, tanggalDikunciOwner: 0, didukungLedger: 0 });
  assert.deepEqual(k.menurutBulanLunasMenurutCrm, { "2026-07": 1, "2026-08": 1 }, "hanya t1 (Jul) dan t2 (31 Agt, ms +1)");
  assert.equal(r.total.lunasMenurutCrm.tanggalTidakPasti, 2);
  assert.equal(r.perBulanPembayaran["2026-08"].lunasMenurutCrm.jumlah, 1, "hanya t2 — dua order backfill TIDAK menambah tren Agustus");
  assert.equal(r.perBulanPembayaran["2026-07"].lunasMenurutCrm.jumlah, 1);
  assert.equal(r.total.lunasMenurutCrm.tanggalPasti, 2); assert.equal(r.total.lunasMenurutCrm.tanggalTidakPasti, 2); assert.equal(r.total.lunasMenurutCrm.tanpaTanggal, 1);
  assert.equal(r.rekonsiliasi.ok, true, gagal(r));
});

test("tanggalLunasMenurutCrm: hari WIB paidAt; didukungLedger hanya bila ledger lunas pada hari yang sama", () => {
  const ledgerLunas = jejakPembayaran([pay("p", "o", "2026-10-01T10:00:00Z", 1000)], 1000);   // 17:00 WIB 1 Okt
  const sama = tanggalLunasMenurutCrm({ paymentStatus: "LUNAS", paidAt: "2026-10-01T12:00:00Z" }, ledgerLunas);
  assert.deepEqual(sama, { sumber: "TERCATAT", hari: "2026-10-01", didukungLedger: true, dikunciOwner: false });
  const beda = tanggalLunasMenurutCrm({ paymentStatus: "LUNAS", paidAt: "2026-10-05T12:00:00Z" }, ledgerLunas);
  assert.equal(beda.didukungLedger, false);
  // 30 Sep 17:30 UTC = 1 Okt 00:30 WIB → bulan Oktober
  assert.equal(tanggalLunasMenurutCrm({ paymentStatus: "LUNAS", paidAt: "2026-09-30T17:30:00Z" }, ledgerLunas).hari, "2026-10-01");
  assert.equal(tanggalLunasMenurutCrm({ paymentStatus: "DP", paidAt: "2026-10-01T12:00:00Z" }, ledgerLunas), null);
});

test("cakupan ledger: LUNAS tersimpan tanpa pembayaran ledger tidak menambah uang; dilaporkan terpisah", () => {
  const r = buildCohort({
    customers: [cust("L", "2026-09-10T03:00:00Z")],
    orders: [
      ord("a", "L", "2026-09-11T03:00:00Z", M(2), { paymentStatus: "LUNAS", paidAt: "2026-09-12T03:00:00Z" }),   // ber-ledger
      ord("b", "L", "2026-09-12T03:00:00Z", M(3), { paymentStatus: "LUNAS", paidAt: "2026-09-13T03:00:00Z" }),   // LUNAS tanpa ledger
      ord("c", "L", "2026-09-13T03:00:00Z", M(1), { paymentStatus: "BELUM_BAYAR" }),                              // tanpa ledger
      ord("d", "L", "2026-09-14T03:00:00Z", M(4), { paymentStatus: "DP" }),                                       // DP dengan ledger
    ],
    kontribusi: [pay("p1", "a", "2026-09-12T03:00:00Z", M(2)), pay("p2", "d", "2026-09-14T04:00:00Z", M(1))],
  });
  const k = r.perBulanLead["2026-09"];
  assert.deepEqual(k.cakupanLedger, { orderEligible: 4, orderBerLedger: 2, berLedgerCukup: 1, berLedgerSebagian: 1, orderTanpaLedger: 2, nilaiOrderTanpaLedger: M(4) });
  assert.deepEqual(k.buktiPelunasan, { lunasTerbuktiLedger: 1, lunasTanpaLedger: 1, konflikLunasTersimpanLedgerTidakCukup: 0, konflikBelumLunasTersimpanLedgerCukup: 0, kekuranganRupiahKonflik: 0 });
  assert.equal(k.uangLedger, M(3), "uang = hanya ledger; nilai order LUNAS tanpa ledger (Rp3 jt) TIDAK dijumlahkan sebagai uang");
  assert.equal(k.lunasMenurutCrm.jumlah, 2); assert.equal(k.lunasMenurutCrm.nilai, M(5));
  assert.equal(k.lunasMenurutCrm.didukungLedger, 1);
  assert.deepEqual(k.cakupanLedger, r.perBulanOrder["2026-09"].cakupanLedger, "cakupan per bulan order = per bulan lead bila semua bulan sama");
  assert.equal(r.total.buktiPelunasan.lunasTanpaLedger, 1);
  assert.equal(r.rekonsiliasi.ok, true, gagal(r));
});

test("customer yang hanya punya order PENDING: bukan 'customer dengan order', terhitung sebagai selisih Dashboard", () => {
  const r = buildCohort({
    customers: [cust("X", "2026-10-01T03:00:00Z"), cust("Y", "2026-10-01T03:00:00Z")],
    orders: [
      ord("OX", "X", "2026-10-02T03:00:00Z", M(2), { status: "PENDING" }),
      ord("OY1", "Y", "2026-10-02T03:00:00Z", M(2)),
      ord("OY2", "Y", "2026-10-03T03:00:00Z", M(2), { status: "PENDING" }),
    ],
    kontribusi: [pay("PX", "OX", "2026-10-02T04:00:00Z", 300_000)],
  });
  const k = r.perBulanLead["2026-10"];
  assert.equal(k.orders, 1); assert.equal(k.orderPending, 2);
  assert.equal(k.customerDenganOrder, 1);
  assert.equal(k.customerHanyaOrderPending, 1, "X saja; Y punya order eligible");
  assert.equal(k.customerRepeat, 0, "order PENDING tidak membuat Y 'repeat' (Dashboard menghitungnya)");
  assert.equal(k.uangLedger, 300_000); assert.equal(k.uangPadaOrderPending, 300_000, "uang pada order PENDING tetap fakta kas");
  assert.equal(r.perBulanPembayaran["2026-10"].uangPadaOrderPending, 300_000);
  assert.equal(r.rekonsiliasi.ok, true, gagal(r));
});

test("order bertanggal sebelum customer dibuat: bukan 'lead lama', dihitung terpisah", () => {
  const r = buildCohort({ customers: [cust("L", "2026-10-10T03:00:00Z")], orders: [ord("o", "L", "2026-09-01T03:00:00Z", M(1))], kontribusi: [] });
  const o = r.perBulanOrder["2026-09"];
  assert.equal(o.orderSebelumLead, 1); assert.equal(o.orderDariLeadLama, 0); assert.equal(o.orderDariLeadBulanSama, 0);
  assert.equal(r.rekonsiliasi.ok, true, gagal(r));
});

test("order berulang: urutan menurut createdAt lalu id, lintas bulan", () => {
  const r = buildCohort({
    customers: [cust("L", "2026-08-01T03:00:00Z")],
    orders: [ord("z", "L", "2026-10-05T03:00:00Z", M(1)), ord("a", "L", "2026-08-05T03:00:00Z", M(1)), ord("m", "L", "2026-09-05T03:00:00Z", M(1))],
    kontribusi: [],
  });
  assert.equal(r.perBulanOrder["2026-08"].orderPertamaCustomer, 1);
  assert.equal(r.perBulanOrder["2026-09"].orderBerulang, 1);
  assert.equal(r.perBulanOrder["2026-10"].orderBerulang, 1);
  assert.deepEqual(r.total.customerMenurutJumlahOrder, { "0": 0, "1": 0, "2": 0, "3+": 1 });
});

test("stage prospek diberi nama 'pernah ditandai prospek' (bukan qualified) dan tidak ada angka karangan", () => {
  const r = buildCohort({
    customers: [
      cust("S", "2026-10-01T03:00:00Z", { pipelineStage: "PROSPECT" }),   // tanpa transisi
      cust("T", "2026-10-01T03:00:00Z", { pipelineStage: "NEW", transitions: [{ toStage: "PROSPECT", createdAt: "2026-10-02T03:00:00Z" }] }),   // pernah, lalu kembali NEW
    ],
    orders: [], kontribusi: [],
  });
  const k = r.perBulanLead["2026-10"];
  assert.equal(k.leads, 2); assert.equal(k.orders, 0); assert.equal(k.uangLedger, 0);
  assert.deepEqual(k.pernahDitandaiProspek, { berTanggal: 1, tanpaTanggal: 1, stageSaatIni: 1 });
  assert.equal(k.qualified, undefined);
  assert.deepEqual(Object.keys(k).filter((x) => /qualif/i.test(x)), []);
});

test("pengecualian lead: SPAM, B2B_DIRECT, staf internal, profil karyawan; order karyawan keluar kohort", () => {
  assert.equal(alasanBukanLead(cust("a", "2026-10-01T00:00:00Z", { pipelineStage: "SPAM" })), "SPAM");
  assert.equal(alasanBukanLead(cust("a", "2026-10-01T00:00:00Z", { leadSource: "B2B_DIRECT" })), "B2B_DIRECT");
  assert.equal(alasanBukanLead(cust("a", "2026-10-01T00:00:00Z", { isInternalStaff: true })), "INTERNAL_STAFF");
  assert.equal(alasanBukanLead(cust("a", "2026-10-01T00:00:00Z", { staffUserId: "u1" })), "PROFIL_KARYAWAN");
  assert.equal(alasanBukanLead(cust("a", "2026-10-01T00:00:00Z")), null);
  const r = buildCohort({
    customers: [cust("L", "2026-10-01T03:00:00Z"), cust("ST", "2026-10-01T03:00:00Z", { isInternalStaff: true })],
    orders: [ord("OK", "L", "2026-10-02T03:00:00Z", M(1), { penjualanKaryawanId: "pk1" }), ord("OS", "ST", "2026-10-02T03:00:00Z", M(2))],
    kontribusi: [pay("PK", "OK", "2026-10-02T04:00:00Z", M(1))],
  });
  assert.equal(r.total.orders, 0);
  assert.equal(r.luarKohort.perAlasan.ORDER_PENJUALAN_KARYAWAN.orders, 1);
  assert.equal(r.luarKohort.perAlasan.INTERNAL_STAFF.orders, 1, "order milik staf internal tidak masuk kohort");
  assert.equal(r.rekonsiliasi.ok, true, gagal(r));
});

test("DP: pembayaran pertama menutup tagihan ≠ DP; tagihan memakai value+ongkir (bukan value saja)", () => {
  // value 1 jt + ongkir 100 rb = tagihan 1,1 jt; bayar 1 jt → masih DP walau value tertutup
  const j = jejakPembayaran([pay("p", "o", "2026-10-02T04:00:00Z", M(1))], 1_100_000);
  assert.equal(j.status, "DP"); assert.equal(j.pernahDp, true); assert.equal(j.hariLunas, null);
  const j2 = jejakPembayaran([pay("p", "o", "2026-10-02T04:00:00Z", 1_100_000)], 1_100_000);
  assert.equal(j2.status, "LUNAS"); assert.equal(j2.pernahDp, false);
  // tagihan 0 (belum dihargai): tidak pernah lunas
  assert.equal(jejakPembayaran([pay("p", "o", "2026-10-02T04:00:00Z", 100)], 0).status, "DP");
  // refund melebihi penerimaan tidak pernah negatif
  assert.equal(jejakPembayaran([pay("p", "o", "2026-10-02T04:00:00Z", 100)], 500, [{ amount: 900 }]).bersih, 0);
});

test("tanggal lunas ditentukan hari WIB pembayaran pelunas, bukan urutan masuk; tepi tengah malam WIB", () => {
  // 23:30 UTC = 06:30 WIB hari BERIKUTNYA
  const j = jejakPembayaran([pay("b", "o", "2026-10-31T23:30:00Z", 600), pay("a", "o", "2026-10-31T10:00:00Z", 400)], 1000);
  assert.equal(j.hariBayarPertama, "2026-10-31"); assert.equal(j.hariLunas, "2026-11-01");
  assert.equal(hariWIB("2026-10-31T17:00:00Z"), "2026-11-01"); assert.equal(bulanWIB("2026-10-31T16:59:59Z"), "2026-10");
});

test("selisihStatusBayar menghitung order yang status tersimpannya berbeda dari hitungan ulang ledger", () => {
  const r = buildCohort({
    customers: [cust("S", "2026-10-01T03:00:00Z")],
    orders: [ord("O1", "S", "2026-10-02T03:00:00Z", M(1), { paymentStatus: "LUNAS", paidAt: "2026-10-02T04:00:00Z" }), ord("O2", "S", "2026-10-02T03:00:00Z", M(1), { paymentStatus: "DP" })],
    kontribusi: [pay("p1", "O1", "2026-10-02T04:00:00Z", 400_000), pay("p2", "O2", "2026-10-02T04:00:00Z", 400_000)],
  });
  assert.equal(r.total.selisihStatusBayar, 1);   // O1 tersimpan LUNAS tetapi ledger 400 rb
  assert.equal(r.total.lunasTerbuktiLedger.jumlah, 0); assert.equal(r.total.lunasMenurutCrm.jumlah, 1);
});

// ── KASUS KONFLIK: status tersimpan LUNAS, ledger valid hanya 50% ─────────────────────────────────────────────────────
const konflik50 = () => ({
  customers: [cust("K", "2026-09-10T03:00:00Z")],
  orders: [ord("OK", "K", "2026-09-19T03:00:00Z", 4_500_000, { status: "SHIPPING", paymentStatus: "LUNAS", paidAt: "2026-09-30T02:19:00Z" })],
  kontribusi: [pay("PK", "OK", "2026-09-23T17:38:00Z", 2_250_000)],   // 24 Sep 00:38 WIB, satu-satunya payment valid
});

test("KONFLIK: LUNAS tersimpan + ledger 50% → bukan lunas terbukti, bukan DP selaras; tiga lapis dipisah dan berlabel", () => {
  const r = buildCohort(konflik50());
  const k = r.perBulanLead["2026-09"];
  // 1. status tersimpan (apa yang dilihat CRM)
  assert.deepEqual(k.statusBayarTersimpan, { BELUM_BAYAR: 0, DP: 0, LUNAS: 1, LAIN: 0 });
  assert.equal(k.lunasMenurutCrm.jumlah, 1); assert.equal(k.lunasMenurutCrm.tanggalPasti, 1);
  assert.equal(k.lunasMenurutCrm.didukungLedger, 0, "ledger tidak mendukung tanggal lunas itu");
  // 2. cakupan ledger (payment valid yang tercatat)
  assert.deepEqual(k.cakupanLedger, { orderEligible: 1, orderBerLedger: 1, berLedgerCukup: 0, berLedgerSebagian: 1, orderTanpaLedger: 0, nilaiOrderTanpaLedger: 0 });
  assert.equal(k.uangLedger, 2_250_000);
  // 3. bukti pelunasan
  assert.deepEqual(k.buktiPelunasan, { lunasTerbuktiLedger: 0, lunasTanpaLedger: 0, konflikLunasTersimpanLedgerTidakCukup: 1, konflikBelumLunasTersimpanLedgerCukup: 0, kekuranganRupiahKonflik: 2_250_000 });
  // tidak "DP kini" tanpa label dan tidak "lunas terverifikasi"
  assert.equal(k.lunasTerbuktiLedger.jumlah, 0);
  assert.equal(k.orderDpSaatIniLedger, 1); assert.equal(k.orderDpSaatIniKonflikLunasCrm, 1, "DP kini menurut ledger ini ditandai konflik dengan LUNAS tersimpan");
  assert.equal(r.total.buktiPelunasan.lunasTerbuktiLedger, 0);
  assert.equal(r.total.buktiPelunasan.konflikLunasTersimpanLedgerTidakCukup, 1);
  assert.equal(r.total.selisihStatusBayar, 1);
  // tren tanggal lunas: hanya diberi penanda, sehingga pembaca dapat mengurangkannya
  assert.equal(r.perBulanPembayaran["2026-09"].lunasMenurutCrm.jumlah, 1);
  assert.equal(r.perBulanPembayaran["2026-09"].lunasMenurutCrm.konflikLedger, 1);
  assert.equal(r.perBulanPembayaran["2026-09"].lunasMenurutCrm.didukungLedger, 0);
  // bulan order memuat label yang sama
  assert.equal(r.perBulanOrder["2026-09"].buktiPelunasan.konflikLunasTersimpanLedgerTidakCukup, 1);
  assert.equal(r.rekonsiliasi.ok, true, gagal(r));
});

test("KONFLIK: penyebab yang dapat dibedakan oleh kode — ongkir, payment dibatalkan, refund, status DP tetapi ledger cukup", () => {
  const base = (id, o, ps, paidAt = null) => ord(id, "K", "2026-09-19T03:00:00Z", o.value, { paymentStatus: ps, paidAt, tagihan: o.tagihan ?? o.value });
  const r = buildCohort({
    customers: [cust("K", "2026-09-10T03:00:00Z")],
    orders: [
      base("ongkir", { value: 4_000_000, tagihan: 4_500_000 }, "LUNAS", "2026-09-25T03:00:00Z"),   // tagihan = value + ongkir; lunas lama memakai value saja
      base("batal", { value: 3_000_000 }, "LUNAS", "2026-09-26T03:00:00Z"),                         // satu-satunya payment dibatalkan → tidak ada di kontribusi
      base("refund", { value: 2_000_000 }, "LUNAS", "2026-09-27T03:00:00Z"),                        // lunas penuh lalu refund disetujui 50%
      base("dpcukup", { value: 1_000_000 }, "DP"),                                                  // status DP tetapi ledger menutup
      base("terbukti", { value: 1_500_000 }, "LUNAS", "2026-09-28T03:00:00Z"),
    ],
    kontribusi: [
      pay("p1", "ongkir", "2026-09-24T03:00:00Z", 4_000_000),
      pay("p3", "refund", "2026-09-26T03:00:00Z", 2_000_000),
      pay("p4", "dpcukup", "2026-09-26T03:00:00Z", 1_000_000),
      pay("p5", "terbukti", "2026-09-28T03:00:00Z", 1_500_000),
    ],
    refunds: [{ orderId: "refund", amount: 1_000_000, approvedAt: "2026-10-01T03:00:00Z", status: "DISETUJUI" }],
  });
  const b = r.perBulanLead["2026-09"].buktiPelunasan;
  assert.deepEqual(b, {
    lunasTerbuktiLedger: 1,                              // terbukti
    lunasTanpaLedger: 1,                                 // batal: payment dibatalkan = tidak ada payment valid
    konflikLunasTersimpanLedgerTidakCukup: 2,            // ongkir (500 rb) dan refund (1 jt)
    konflikBelumLunasTersimpanLedgerCukup: 1,            // dpcukup
    kekuranganRupiahKonflik: 500_000 + 1_000_000,
  });
  assert.equal(r.rekonsiliasi.ok, true, gagal(r));
});

test("buktiPelunasanOrder: tabel keputusan", () => {
  const j = (kontribusi, tagihan, refunds) => jejakPembayaran(kontribusi, tagihan, refunds);
  const p = (amt) => [pay("x", "o", "2026-10-01T03:00:00Z", amt)];
  assert.equal(buktiPelunasanOrder({ paymentStatus: "LUNAS" }, j(p(1000), 1000), 1000).kelas, "LUNAS_TERBUKTI_LEDGER");
  assert.equal(buktiPelunasanOrder({ paymentStatus: "LUNAS" }, j([], 1000), 1000).kelas, "LUNAS_TANPA_LEDGER");
  const k = buktiPelunasanOrder({ paymentStatus: "LUNAS" }, j(p(500), 1000), 1000);
  assert.deepEqual(k, { kelas: "KONFLIK_LUNAS_LEDGER_TIDAK_CUKUP", kekurangan: 500 });
  assert.equal(buktiPelunasanOrder({ paymentStatus: "DP" }, j(p(1000), 1000), 1000).kelas, "KONFLIK_BELUM_LUNAS_LEDGER_CUKUP");
  assert.equal(buktiPelunasanOrder({ paymentStatus: "DP" }, j(p(500), 1000), 1000), null, "DP selaras: bukan klaim lunas, bukan konflik lunas");
  assert.equal(buktiPelunasanOrder({ paymentStatus: "BELUM_BAYAR" }, j([], 1000), 1000), null);
  // refund yang menghabiskan ledger: ada payment valid, bersih 0 → konflik, bukan 'tanpa ledger'
  assert.equal(buktiPelunasanOrder({ paymentStatus: "LUNAS" }, j(p(1000), 1000, [{ amount: 1000 }]), 1000).kelas, "KONFLIK_LUNAS_LEDGER_TIDAK_CUKUP");
});

test("laporan: peringatan KONFLIK_STATUS_LUNAS_LEDGER memuat jumlah dan kekurangan, tanpa menyimpulkan penyebab", async () => {
  const { susunLaporan } = await import("../src/services/attribution/cohortReport.js");
  const r = buildCohort(konflik50());
  const lap = susunLaporan({ meta: {}, ...r }, { dari: "2026-09", sampai: "2026-09", bulanBerjalan: "2026-10" });
  const w = lap.peringatan.find((x) => x.kode === "KONFLIK_STATUS_LUNAS_LEDGER");
  assert.ok(w, "peringatan konflik harus ada");
  assert.equal(w.data.konflikLunasTersimpanLedgerTidakCukup, 1);
  assert.equal(w.data.kekuranganRupiahKonflik, 2_250_000);
  assert.match(w.pesan, /tetap masuk lunasMenurutCrm, TIDAK masuk lunasTerbuktiLedger, dan BUKAN DP selaras/);
  assert.match(w.pesan, /tidak dapat disimpulkan/);
  assert.equal(lap.jumlahPeriode.perBulanOrder.buktiPelunasan.konflikLunasTersimpanLedgerTidakCukup, 1);
  assert.equal(lap.jumlahPeriode.perBulanLead.buktiPelunasan.lunasTerbuktiLedger, 0);
  assert.ok(lap.definisi.some((d) => d.id === "bukti_pelunasan"));
});

test("DUA TREN LUNAS: lunasMenurutCrm (status tersimpan) dan lunasTerbuktiLedger (ledger menutup tagihan) berbulan berbeda dan tidak saling menggantikan", () => {
  const r = buildCohort({
    customers: [cust("D", "2026-08-05T03:00:00Z")],
    orders: [
      ord("terbukti", "D", "2026-08-10T03:00:00Z", M(2), { paymentStatus: "LUNAS", paidAt: "2026-09-02T03:00:00Z" }),   // CRM mencatat 2 Sep, ledger menutup 28 Agt
      ord("konflik", "D", "2026-08-11T03:00:00Z", M(4), { paymentStatus: "LUNAS", paidAt: "2026-09-10T03:00:00Z" }),    // ledger 50%
      ord("tanpa", "D", "2026-08-12T03:00:00Z", M(1), { paymentStatus: "LUNAS", paidAt: "2026-08-20T03:00:00Z" }),      // tanpa payment
      ord("ledgerSaja", "D", "2026-08-13T03:00:00Z", M(1), { paymentStatus: "BELUM_BAYAR" }),                         // ledger menutup, CRM belum LUNAS
    ],
    kontribusi: [
      pay("p1", "terbukti", "2026-08-28T03:00:00Z", M(2)),
      pay("p2", "konflik", "2026-09-01T03:00:00Z", M(2)),
      pay("p3", "ledgerSaja", "2026-10-02T03:00:00Z", M(1)),
    ],
  });
  const tren = r.perBulanPembayaran;
  // lunasMenurutCrm: menurut paidAt; konflik IKUT, ledgerSaja tidak (belum LUNAS di CRM)
  assert.deepEqual(Object.fromEntries(Object.entries(tren).map(([m, b]) => [m, b.lunasMenurutCrm.jumlah])), { "2026-08": 1, "2026-09": 2, "2026-10": 0 });
  // lunasTerbuktiLedger: menurut hari payment pelunas; konflik TIDAK ikut, ledgerSaja ikut
  assert.deepEqual(Object.fromEntries(Object.entries(tren).map(([m, b]) => [m, b.lunasTerbuktiLedger.jumlah])), { "2026-08": 1, "2026-09": 0, "2026-10": 1 });
  assert.equal(tren["2026-09"].lunasMenurutCrm.konflikLedger, 1, "konflik tetap di tren CRM, berpenanda");
  const t = r.total;
  assert.equal(t.lunasMenurutCrm.jumlah, 3); assert.equal(t.lunasTerbuktiLedger.jumlah, 2);
  assert.deepEqual(t.buktiPelunasan, { lunasTerbuktiLedger: 1, lunasTanpaLedger: 1, konflikLunasTersimpanLedgerTidakCukup: 1, konflikBelumLunasTersimpanLedgerCukup: 1, kekuranganRupiahKonflik: M(2) });
  assert.equal(t.lunasTerbuktiLedger.jumlah, t.buktiPelunasan.lunasTerbuktiLedger + t.buktiPelunasan.konflikBelumLunasTersimpanLedgerCukup, "formula");
  assert.equal(r.perBulanLead["2026-08"].lunasTerbuktiLedger.nilai, M(3), "nilai order (booked) yang terbukti ledger: terbukti 2 jt + ledgerSaja 1 jt");
  assert.equal(r.perBulanLead["2026-08"].lunasMenurutCrm.nilai, M(7), "nilai order LUNAS CRM: 2 + 4 + 1 jt — booked, BUKAN uang");
  assert.equal(r.perBulanLead["2026-08"].uangLedger, M(5), "uang ledger: 2 + 2 + 1 jt, terpisah dari kedua nilai di atas");
  assert.equal(r.rekonsiliasi.ok, true, gagal(r));
});

test("tanggal dikunci pengecualian Owner: dilaporkan sebagai tanggal dikunci, tidak menjadikan order lunas terbukti", () => {
  const r = buildCohort({
    customers: [cust("O", "2026-09-01T03:00:00Z")],
    orders: [ord("dikunci", "O", "2026-09-02T03:00:00Z", M(4), { paymentStatus: "LUNAS", paidAt: "2026-09-30T02:19:00Z", paidAtDikunciOwner: true })],
    kontribusi: [pay("p", "dikunci", "2026-09-03T03:00:00Z", M(2))],
  });
  const k = r.perBulanLead["2026-09"];
  assert.equal(k.lunasMenurutCrm.tanggalPasti, 1); assert.equal(k.lunasMenurutCrm.tanggalDikunciOwner, 1);
  assert.equal(k.lunasMenurutCrm.didukungLedger, 0);
  assert.equal(k.lunasTerbuktiLedger.jumlah, 0);
  assert.equal(r.perBulanPembayaran["2026-09"].lunasMenurutCrm.tanggalDikunciOwner, 1);
  assert.equal(k.uangLedger, M(2));
  assert.equal(r.rekonsiliasi.ok, true, gagal(r));
});

test("properti: data acak 600 customer — rekonsiliasi selalu lolos dan uang tidak pernah dihitung dua kali", () => {
  let seed = 20261010; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const customers = [], orders = [], kontribusi = [], refunds = [];
  const base = Date.UTC(2026, 6, 1);
  const backfill = PAID_AT_BACKFILL_31_AGT;
  for (let i = 0; i < 600; i++) {
    const created = new Date(base + Math.floor(rnd() * 120) * 864e5 + Math.floor(rnd() * 864e5));
    customers.push(cust(`c${i}`, created, {
      pipelineStage: pick(["NEW", "NEW", "PROSPECT", "TRANSACTION", "REVIEWED", "SPAM"]),
      leadSource: pick(["META_ADS", "WHATSAPP_DIRECT", "B2B_DIRECT", "GOOGLE_ADS"]), isInternalStaff: rnd() < 0.02, staffUserId: rnd() < 0.01 ? "u" : null,
    }));
    const n = Math.floor(rnd() * 4);
    for (let j = 0; j < n; j++) {
      const oc = new Date(created.getTime() + Math.floor(rnd() * 90) * 864e5);
      const value = (1 + Math.floor(rnd() * 8)) * 500_000;
      const st = pick(["BELUM_BAYAR", "DP", "LUNAS", "LUNAS"]);
      const o = ord(`o${i}_${j}`, `c${i}`, oc, value, {
        tagihan: value + (rnd() < 0.3 ? 100_000 : 0), status: pick(["PROCESSING", "DELIVERED", "PENDING", "CANCELLED", "READY"]),
        penjualanKaryawanId: rnd() < 0.03 ? "pk" : null, paymentStatus: st,
        paidAt: st === "LUNAS" ? (rnd() < 0.3 ? backfill : rnd() < 0.1 ? null : new Date(oc.getTime() + Math.floor(rnd() * 40) * 864e5)) : null,
      });
      orders.push(o);
      let sisa = value;
      const np = Math.floor(rnd() * 3);
      for (let p = 0; p < np; p++) {
        const amt = Math.min(sisa, Math.max(100_000, Math.floor(sisa * (0.3 + rnd() * 0.7))));
        sisa -= amt;
        kontribusi.push(pay(`p${i}_${j}_${p}`, o.id, new Date(oc.getTime() + Math.floor(rnd() * 60) * 864e5), amt));
      }
      if (rnd() < 0.08 && np > 0) refunds.push({ orderId: o.id, amount: 100_000, approvedAt: new Date(oc.getTime() + 70 * 864e5), status: "DISETUJUI" });
    }
  }
  kontribusi.push(pay("yatim", "tidak-ada", new Date(base), 777));
  const r = buildCohort({ customers, orders, kontribusi, refunds });
  assert.equal(r.rekonsiliasi.ok, true, gagal(r));
  const semua = kontribusi.reduce((s, k) => s + k.amount, 0);
  const terbagi = r.total.uangLedger + Object.values(r.perBulanLead).reduce((s, k) => s + k.uangPadaOrderBatal, 0) + r.luarKohort.uangLedger + r.luarKohort.uangPadaOrderBatal + 777;
  assert.equal(terbagi, semua);
  assert.equal(r.bagianOrder.eligible + r.bagianOrder.pending + r.bagianOrder.batal + r.bagianOrder.luar, orders.length);
  // tren presisi tidak pernah memuat order backfill
  const lunasPastiBulan = Object.values(r.perBulanPembayaran).reduce((s, b) => s + b.lunasMenurutCrm.jumlah, 0);
  assert.equal(lunasPastiBulan, r.total.lunasMenurutCrm.tanggalPasti);
  assert.equal(r.total.lunasMenurutCrm.jumlah, r.total.lunasMenurutCrm.tanggalPasti + r.total.lunasMenurutCrm.tanggalTidakPasti + r.total.lunasMenurutCrm.tanpaTanggal);
});

test("deterministik: urutan masukan tidak mempengaruhi hasil", () => {
  const x = gabung(A, B, C);
  const y = { customers: [...x.customers].reverse(), orders: [...x.orders].reverse(), kontribusi: [...x.kontribusi].reverse(), refunds: [...x.refunds].reverse() };
  assert.deepEqual(buildCohort(x), buildCohort(y));
});

test("definisi selaras kode lain: status dikecualikan = OMSET_EXCLUDED_STATUS; timestamp backfill = analytics.js; stage ada di enum", () => {
  const analytics = fs.readFileSync(new URL("../src/routes/analytics.js", import.meta.url), "utf8");
  const m = /OMSET_EXCLUDED_STATUS\s*=\s*\[([^\]]+)\]/.exec(analytics);
  assert.ok(m, "OMSET_EXCLUDED_STATUS tidak ditemukan di analytics.js");
  const dipakaiAnalytics = [...m[1].matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]).sort();
  assert.deepEqual([...ORDER_EXCLUDED_STATUS].sort(), dipakaiAnalytics);
  const bf = /PAID_AT_BACKFILL_31_AGT\s*=\s*new Date\("([^"]+)"\)/.exec(analytics);
  assert.ok(bf, "PAID_AT_BACKFILL_31_AGT tidak ditemukan di analytics.js");
  assert.equal(PAID_AT_BACKFILL_31_AGT.toISOString(), new Date(bf[1]).toISOString(), "timestamp backfill harus sama dengan yang dipakai analytics.js (paidAtPerkiraan)");
  const schema = fs.readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
  const enumStage = /enum PipelineStage \{([\s\S]*?)\n\}/.exec(schema)[1];
  for (const s of STAGE_PROSPEK_ATAU_LANJUT) assert.match(enumStage, new RegExp(`\\b${s}\\b`));
});

test("registri metrik: tidak ada 'qualified_lead'; prospek SEBAGIAN; atribusi campaign BELUM_ADA_DATA; setiap metrik punya sumber dan definisi", () => {
  const by = Object.fromEntries(METRICS.map((m) => [m.id, m]));
  assert.equal(by.qualified_lead, undefined);
  assert.equal(by.pernah_ditandai_prospek.status, STATUS.SEBAGIAN);
  assert.match(by.pernah_ditandai_prospek.label, /ditandai prospek/i);
  assert.equal(by.atribusi_campaign.status, STATUS.BELUM_ADA_DATA);
  assert.equal(by.uang_ledger.status, STATUS.SEBAGIAN);
  for (const mt of METRICS) { assert.ok(mt.definisi.length > 20, mt.id); assert.ok(mt.sumber.length > 0, mt.id); }
});

test("keluaran tidak memuat pengenal: tanpa id customer/order/pembayaran, tanpa field campaign/ad", () => {
  const teks = JSON.stringify(buildCohort(gabung(A, B, C)));
  for (const id of ["C1", "C2", "C3", "O1", "O2", "Pa", "Pb"]) assert.ok(!new RegExp(`"${id}"`).test(teks), `id bocor: ${id}`);
  for (const kunci of ["campaign", "adSet", "adId", "roas", "ROAS", "ctwaClid", "phone", "name"]) assert.ok(!teks.includes(`"${kunci}"`), `kunci terlarang: ${kunci}`);
});
