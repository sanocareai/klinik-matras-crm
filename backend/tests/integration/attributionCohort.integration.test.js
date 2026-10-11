// Tes integrasi FASE 1: loader + endpoint kohort (BACA-SAJA) terhadap PostgreSQL nyata + aturan uang yang SUDAH ada di live.
// Membuktikan: (1) aturan hitung memakai kode asli (alokasi, pembatalan, gerbang verifikasi, refund, tagihan value+ongkir),
// (2) hasil kohort selaras dengan recomputeOrderPaymentStatus (selisihStatusBayar = 0), (3) loader/endpoint tidak menulis apa pun dan transaksi
// laporan benar-benar READ ONLY di Postgres, (4) pesan duplikat tidak menggandakan lead, (5) endpoint: ADMIN saja, parameter divalidasi,
// respons agregat tanpa pengenal. Tanpa isi chat bermakna dan tanpa data kesehatan.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import express from "express";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { SETTING_KEYS, setSetting } from "../../src/services/finance/settings.js";
import { recomputeOrderPaymentStatus } from "../../src/services/paymentLedger.js";
import { hitungKohort, muatMasukanKohort } from "../../src/services/attribution/cohortLoader.js";
import { hitungLaporanKohort, parseRentang } from "../../src/services/attribution/cohortReport.js";
import { PAID_AT_BACKFILL_31_AGT } from "../../src/services/attribution/cohortDefinitions.js";

process.env.JWT_SECRET ||= "rahasia-uji-kohort";   // worktree tanpa backend/.env; router membaca saat verifikasi
const { attributionCohortRouter } = await import("../../src/routes/attributionCohort.js");

const M = (n) => n * 1_000_000;
const T = (s) => new Date(s);
let user, rekening;
let seq = 0;
// Tanpa createTestUser: ia menandatangani JWT dengan env yang belum tentu ada; token dibuat sendiri di bawah.
const buatUser = (role = "ADMIN") => testPrisma.user.create({ data: { name: "Admin Uji Kohort", email: `kohort-${Date.now()}-${++seq}@example.test`, passwordHash: "x", role } });
const tokenUntuk = (u, roles) => jwt.sign({ id: u.id, name: u.name, role: roles[0], roles }, process.env.JWT_SECRET, { expiresIn: "1h" });

async function siapkanDunia() {
  await truncateAll();
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  user = await buatUser();
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  rekening = await testPrisma.finCashAccount.create({ data: { name: "Kas Uji Kohort", kind: "KAS", accountId: akun.id } });
}
test.before(siapkanDunia);
test.after(async () => { await testPrisma.$disconnect(); });

const cust = (createdAt, o = {}) => testPrisma.customer.create({ data: { name: "Pelanggan Uji", createdAt: T(createdAt), leadSource: "META_ADS", ...o } });
const order = (customerId, createdAt, value, o = {}) => testPrisma.order.create({ data: { customerId, createdAt: T(createdAt), value, status: "PROCESSING", ...o } });
const bayar = (orderId, createdAt, amount, o = {}) => testPrisma.payment.create({ data: { orderId, amount, method: "TRANSFER", recordedById: user.id, createdAt: T(createdAt), ...o } });
const snapshotTabel = async () => ({
  customer: await testPrisma.customer.count(), order: await testPrisma.order.count(), payment: await testPrisma.payment.count(),
  alokasi: await testPrisma.finPaymentAllocation.count(), refund: await testPrisma.finRefund.count(), transisi: await testPrisma.pipelineTransition.count(),
  jurnal: await testPrisma.finJournalEntry.count(), activity: await testPrisma.activityEvent.count(),
  setting: await testPrisma.finSetting.count(),
});

// Kasus lintas bulan lengkap (dipakai loader dan endpoint).
async function buatKasusLengkap() {
  // A — lead Agustus, order & lunas Oktober
  const a = await cust("2026-08-20T03:00:00Z");
  const oA = await order(a.id, "2026-10-05T02:00:00Z", M(5));
  await bayar(oA.id, "2026-10-06T03:00:00Z", M(5));

  // B — lead 28 Sep: dua order; O2 DP 30 Sep + pelunasan 2 Okt; O3 DP 500 rb
  const b = await cust("2026-09-28T03:00:00Z", { pipelineStage: "TRANSACTION" });
  await testPrisma.pipelineTransition.create({ data: { customerId: b.id, fromStage: "NEW", toStage: "PROSPECT", createdAt: T("2026-09-29T03:00:00Z") } });
  await testPrisma.pipelineTransition.create({ data: { customerId: b.id, fromStage: "PROSPECT", toStage: "TRANSACTION", createdAt: T("2026-09-30T03:00:00Z") } });
  const o2 = await order(b.id, "2026-09-30T03:00:00Z", M(3));
  const o3 = await order(b.id, "2026-10-10T03:00:00Z", M(2), { ongkir: 100_000 });  // tagihan 2,1 jt
  await bayar(o2.id, "2026-09-30T04:00:00Z", M(1));
  await bayar(o2.id, "2026-10-02T04:00:00Z", M(2));
  await bayar(o3.id, "2026-10-10T05:00:00Z", 500_000);

  // C — batal + refund + pembayaran dibatalkan + lead tanpa order + SPAM + staf + tepi WIB
  const c = await cust("2026-10-01T00:00:00Z");
  const o4 = await order(c.id, "2026-10-02T03:00:00Z", M(4), { status: "CANCELLED" });
  const o5 = await order(c.id, "2026-10-03T03:00:00Z", M(2));
  await bayar(o4.id, "2026-10-02T04:00:00Z", M(1));
  await bayar(o5.id, "2026-10-03T04:00:00Z", M(2));
  await bayar(o5.id, "2026-10-04T04:00:00Z", 300_000, { cancelledAt: T("2026-10-04T06:00:00Z"), cancelledById: user.id, cancelReason: "salah input" });
  await testPrisma.finRefund.create({ data: { refundNumber: "RFD-UJI-1", orderId: o5.id, date: T("2026-10-20T00:00:00Z"), amount: 500_000, reason: "uji", cashAccountId: rekening.id, status: "DISETUJUI", approvedAt: T("2026-10-20T03:00:00Z") } });
  await testPrisma.finRefund.create({ data: { refundNumber: "RFD-UJI-2", orderId: o5.id, date: T("2026-10-21T00:00:00Z"), amount: M(1), reason: "uji menunggu", cashAccountId: rekening.id, status: "MENUNGGU_APPROVAL" } });
  const d = await cust("2026-10-15T03:00:00Z");                        // lead tanpa order
  await cust("2026-09-30T17:30:00Z");                                  // 01 Okt 00:30 WIB
  const spam = await cust("2026-10-03T03:00:00Z", { pipelineStage: "SPAM" });
  const oSpam = await order(spam.id, "2026-10-04T03:00:00Z", M(1));
  await bayar(oSpam.id, "2026-10-04T04:00:00Z", M(1));
  await cust("2026-10-02T03:00:00Z", { isInternalStaff: true });

  // pesan duplikat: banyak pesan masuk (isi sama) pada satu customer → tetap SATU lead
  const conv = await testPrisma.conversation.create({ data: { customerId: d.id, channel: "WHATSAPP" } });
  for (let i = 0; i < 4; i++) await testPrisma.message.create({ data: { conversationId: conv.id, direction: "INBOUND", content: "halo", externalId: `dup-${i}` } });

  // Samakan status bayar tersimpan dengan ledger (jalur resmi live), lalu bandingkan dengan hitungan kohort
  for (const o of [oA, o2, o3, o4, o5, oSpam]) await recomputeOrderPaymentStatus(testPrisma, o.id);
  return { a, b, c, oA, o2, o3, o4, o5 };
}

test("kasus lengkap lintas bulan di DB nyata: A (lead lama), B (dua order, DP→lunas), C (batal/refund), pesan duplikat, SPAM, staf", async () => {
  await siapkanDunia();
  const { a } = await buatKasusLengkap();

  const sebelum = await snapshotTabel();
  const r = await hitungKohort(testPrisma);
  assert.deepEqual(await snapshotTabel(), sebelum, "loader TIDAK boleh menulis apa pun");

  assert.equal(r.rekonsiliasi.ok, true, JSON.stringify(r.rekonsiliasi.cek.filter((x) => !x.ok)));
  assert.equal(r.total.selisihStatusBayar, 0, "hitungan kohort harus sama dengan recomputeOrderPaymentStatus milik live");

  const ags = r.perBulanLead["2026-08"], sep = r.perBulanLead["2026-09"], okt = r.perBulanLead["2026-10"];
  assert.equal(ags.leads, 1); assert.equal(ags.orders, 1); assert.equal(ags.uangLedger, M(5)); assert.equal(ags.lunasTerbuktiLedger.jumlah, 1);
  assert.deepEqual(ags.menurutBulanLunasMenurutCrm, { "2026-10": 1 });
  assert.equal(ags.lunasMenurutCrm.didukungLedger, 1, "status tersimpan hasil recomputeOrderPaymentStatus live = ledger");

  assert.equal(sep.leads, 1); assert.equal(sep.customerDenganOrder, 1); assert.equal(sep.customerRepeat, 1);
  assert.equal(sep.orders, 2); assert.equal(sep.nilaiOrder, M(5));
  assert.equal(sep.lunasTerbuktiLedger.jumlah, 1); assert.equal(sep.orderDpSaatIniLedger, 1); assert.equal(sep.orderPernahDp, 2);
  assert.equal(sep.uangLedger, 3_500_000);
  assert.deepEqual(sep.menurutBulanPembayaran, { "2026-09": { uang: M(1), refund: 0 }, "2026-10": { uang: 2_500_000, refund: 0 } });
  assert.equal(sep.pernahDitandaiProspek.berTanggal, 1);
  assert.deepEqual(sep.cakupanLedger, { orderEligible: 2, orderBerLedger: 2, berLedgerCukup: 1, berLedgerSebagian: 1, orderTanpaLedger: 0, nilaiOrderTanpaLedger: 0 });
  assert.deepEqual(sep.buktiPelunasan, { lunasTerbuktiLedger: 1, lunasTanpaLedger: 0, konflikLunasTersimpanLedgerTidakCukup: 0, konflikBelumLunasTersimpanLedgerCukup: 0, kekuranganRupiahKonflik: 0 });

  assert.equal(okt.leads, 3);                      // c, d, e (spam & staf dikecualikan; e = tepi WIB)
  assert.equal(okt.orders, 1); assert.equal(okt.orderBatal, 1);
  assert.equal(okt.uangLedger, M(2));              // pembayaran dibatalkan (300 rb) TIDAK dihitung
  assert.equal(okt.uangPadaOrderBatal, M(1));
  assert.equal(okt.refundDisetujui, 500_000);      // refund MENUNGGU_APPROVAL tidak dihitung
  assert.equal(okt.uangBersihLedger, 1_500_000);
  assert.equal(okt.lunasTerbuktiLedger.jumlah, 0); assert.equal(okt.orderDpSaatIniLedger, 1);

  assert.equal(r.luarKohort.perAlasan.SPAM.orders, 1);
  assert.equal(r.luarKohort.perAlasan.INTERNAL_STAFF.customers, 1);
  assert.equal(r.total.leads, 5);
  assert.ok(!JSON.stringify(r).includes(a.id), "keluaran tidak boleh memuat id customer");
});

test("alokasi: satu pembayaran dipecah ke dua order dihitung per-alokasi, total uang tidak berlipat", async () => {
  await siapkanDunia();
  const c = await cust("2026-10-01T03:00:00Z");
  const o1 = await order(c.id, "2026-10-02T03:00:00Z", M(2));
  const o2 = await order(c.id, "2026-10-02T04:00:00Z", M(3));
  const p = await bayar(o1.id, "2026-10-03T03:00:00Z", M(4));          // tercatat di o1 tetapi dipecah: 2 jt → o1, 2 jt → o2
  await testPrisma.finPaymentAllocation.create({ data: { paymentId: p.id, orderId: o1.id, amount: M(2) } });
  await testPrisma.finPaymentAllocation.create({ data: { paymentId: p.id, orderId: o2.id, amount: M(2) } });
  for (const o of [o1, o2]) await recomputeOrderPaymentStatus(testPrisma, o.id);

  const r = await hitungKohort(testPrisma);
  const k = r.perBulanLead["2026-10"];
  assert.equal(k.uangLedger, M(4), "uang 4 jt dihitung SEKALI, bukan 4 jt + 2 jt");
  assert.equal(k.lunasTerbuktiLedger.jumlah, 1);            // o1 lunas (2 jt)
  assert.equal(k.orderDpSaatIniLedger, 1);              // o2 baru 2 dari 3 jt
  assert.equal(k.orderPernahDp, 1);               // o2
  assert.equal(r.total.selisihStatusBayar, 0);
  assert.equal(r.rekonsiliasi.ok, true);
});

test("gerbang verifikasi aktif: pembayaran setelah tanggal gerbang yang belum diverifikasi TIDAK dihitung (sama dengan paymentLedger)", async () => {
  await siapkanDunia();
  await setSetting(testPrisma, SETTING_KEYS.PAYMENT_VERIFICATION_GATE, "true");
  await setSetting(testPrisma, SETTING_KEYS.PAYMENT_VERIFICATION_GATE_SINCE, "2026-10-05T00:00:00Z");
  const c = await cust("2026-10-01T03:00:00Z");
  const o = await order(c.id, "2026-10-02T03:00:00Z", M(4));
  await bayar(o.id, "2026-10-03T03:00:00Z", M(1));                       // sebelum gerbang → dihitung
  await bayar(o.id, "2026-10-10T03:00:00Z", M(1));                       // setelah gerbang, belum diverifikasi → TIDAK dihitung
  const terverifikasi = await bayar(o.id, "2026-10-11T03:00:00Z", M(1)); // setelah gerbang, terverifikasi → dihitung
  await testPrisma.paymentVerification.create({ data: { paymentId: terverifikasi.id, verifiedById: user.id } });
  await recomputeOrderPaymentStatus(testPrisma, o.id);

  const r = await hitungKohort(testPrisma);
  assert.equal(r.meta.gate.enabled, true);
  assert.equal(r.perBulanLead["2026-10"].uangLedger, M(2));
  assert.equal(r.total.selisihStatusBayar, 0);
  await setSetting(testPrisma, SETTING_KEYS.PAYMENT_VERIFICATION_GATE, "false");
});

test("rentang lead: hanya customer yang masuk sampai batas WIB; order/pembayaran dimuat utuh (lintas bulan)", async () => {
  await siapkanDunia();
  const lama = await cust("2026-08-31T16:59:59Z");       // 31 Agu 23:59:59 WIB
  const baru = await cust("2026-08-31T17:00:00Z");       // 01 Sep 00:00:00 WIB
  const o = await order(baru.id, "2026-10-05T03:00:00Z", M(1));
  await bayar(o.id, "2026-10-06T03:00:00Z", M(1));
  void lama;
  const masukan = await muatMasukanKohort(testPrisma, { leadFrom: "2026-09-01", leadTo: "2026-09-30" });
  assert.equal(masukan.customers.length, 1);
  assert.equal(masukan.orders.length, 1);
  assert.equal(masukan.kontribusi.length, 1);
  const r = await hitungKohort(testPrisma, { leadFrom: "2026-09-01", leadTo: "2026-09-30" });
  assert.deepEqual(Object.keys(r.perBulanLead), ["2026-09"]);
  assert.equal(r.perBulanLead["2026-09"].menurutBulanPembayaran["2026-10"].uang, M(1));
});

test("paidAt backfill 31 Agt 2026 di DB nyata: presisi milidetik terjaga → tanggal tidak pasti, tidak masuk tren presisi", async () => {
  await siapkanDunia();
  const c = await cust("2026-07-10T03:00:00Z");
  await order(c.id, "2026-07-11T03:00:00Z", M(2), { paymentStatus: "LUNAS", paidAt: PAID_AT_BACKFILL_31_AGT });                                   // backfill, tanpa ledger
  await order(c.id, "2026-07-12T03:00:00Z", M(3), { paymentStatus: "LUNAS", paidAt: T("2026-07-20T03:00:00Z") });                                // tercatat, tanpa ledger
  await order(c.id, "2026-07-13T03:00:00Z", M(1), { paymentStatus: "LUNAS", paidAt: new Date(PAID_AT_BACKFILL_31_AGT.getTime() + 1) });         // 1 ms beda → bukan backfill
  const r = await hitungKohort(testPrisma);
  const k = r.perBulanLead["2026-07"];
  assert.equal(k.lunasMenurutCrm.jumlah, 3); assert.equal(k.lunasMenurutCrm.tanggalTidakPasti, 1); assert.equal(k.lunasMenurutCrm.tanggalPasti, 2);
  assert.equal(k.buktiPelunasan.lunasTanpaLedger, 3);
  assert.equal(k.uangLedger, 0, "LUNAS tanpa ledger: tidak ada uang");
  assert.deepEqual(k.menurutBulanLunasMenurutCrm, { "2026-07": 1, "2026-08": 1 });
  assert.equal(r.rekonsiliasi.ok, true);
});

test("pengecualian tanggal lunas Owner dibaca loader: yang aktif ditandai tanggalDikunciOwner, yang dicabut tidak; bukan bukti uang", async () => {
  await siapkanDunia();
  const c = await cust("2026-09-01T03:00:00Z");
  const dikunci = await order(c.id, "2026-09-02T03:00:00Z", M(4), { paymentStatus: "LUNAS", paidAt: T("2026-09-30T02:19:00Z") });
  const dicabut = await order(c.id, "2026-09-03T03:00:00Z", M(1), { paymentStatus: "LUNAS", paidAt: T("2026-09-30T03:00:00Z") });
  await bayar(dikunci.id, "2026-09-03T03:00:00Z", M(2));                                   // ledger 50% + tanggal dikunci Owner
  await testPrisma.orderPaidAtPengecualian.create({ data: { orderId: dikunci.id, paidAtDikunci: dikunci.paidAt, paidAtAsli: dikunci.paidAt, alasan: "uji pengecualian tanggal lunas", createdById: user.id } });
  await testPrisma.orderPaidAtPengecualian.create({ data: { orderId: dicabut.id, paidAtDikunci: dicabut.paidAt, alasan: "uji pengecualian dicabut", createdById: user.id, dicabutAt: T("2026-10-01T03:00:00Z"), dicabutById: user.id, alasanDicabut: "uji dicabut" } });

  const sebelum = await snapshotTabel();
  const r = await hitungKohort(testPrisma);
  assert.deepEqual(await snapshotTabel(), sebelum);
  const k = r.perBulanLead["2026-09"];
  assert.equal(k.lunasMenurutCrm.jumlah, 2);
  assert.equal(k.lunasMenurutCrm.tanggalDikunciOwner, 1, "hanya pengecualian yang masih aktif");
  assert.equal(k.lunasMenurutCrm.didukungLedger, 0);
  assert.equal(k.lunasTerbuktiLedger.jumlah, 0, "tanggal dikunci tidak membuktikan uang");
  assert.deepEqual(k.buktiPelunasan, { lunasTerbuktiLedger: 0, lunasTanpaLedger: 1, konflikLunasTersimpanLedgerTidakCukup: 1, konflikBelumLunasTersimpanLedgerCukup: 0, kekuranganRupiahKonflik: M(2) });
  assert.equal(r.rekonsiliasi.ok, true, JSON.stringify(r.rekonsiliasi.cek.filter((x) => !x.ok)));
});

// ── KONFLIK status LUNAS tersimpan vs ledger valid (kasus produksi: LUNAS, ledger 50%) ─────────────────────────────────
async function buatKasusKonflik() {
  await siapkanDunia();
  await setSetting(testPrisma, SETTING_KEYS.PAYMENT_VERIFICATION_GATE, "true");
  await setSetting(testPrisma, SETTING_KEYS.PAYMENT_VERIFICATION_GATE_SINCE, "2026-09-30T00:00:00Z");
  const c = await cust("2026-09-10T03:00:00Z");
  const dibayar = { paymentStatus: "LUNAS", paidAt: T("2026-09-30T02:19:00Z") };   // status manual/historis; TIDAK lewat recomputeOrderPaymentStatus

  // K1 — satu payment terverifikasi 50%, sebelum gerbang (bentuk persis kasus produksi)
  const k1 = await order(c.id, "2026-09-19T03:00:00Z", 4_500_000, dibayar);
  const p1 = await bayar(k1.id, "2026-09-23T17:38:00Z", 2_250_000);
  await testPrisma.paymentVerification.create({ data: { paymentId: p1.id, verifiedById: user.id } });

  // K2 — penyebab gerbang: payment kedua setelah gerbang belum diverifikasi → tidak dihitung
  const k2 = await order(c.id, "2026-09-20T03:00:00Z", 4_000_000, dibayar);
  await bayar(k2.id, "2026-09-22T03:00:00Z", 2_000_000);
  await bayar(k2.id, "2026-10-02T03:00:00Z", 2_000_000);   // setelah gerbang, tanpa verifikasi

  // K3 — payment dibatalkan lalu diganti dengan nominal lebih kecil (koreksi)
  const k3 = await order(c.id, "2026-09-21T03:00:00Z", 3_000_000, dibayar);
  const lama = await bayar(k3.id, "2026-09-22T03:00:00Z", 3_000_000, { cancelledAt: T("2026-09-23T03:00:00Z"), cancelledById: user.id, cancelReason: "koreksi nominal" });
  await bayar(k3.id, "2026-09-23T03:00:00Z", 1_500_000, { replacesPaymentId: lama.id });

  // K4 — ongkir: tagihan 3,5 jt + 500 rb = 4 jt, dibayar 3,5 jt (status lunas lama memakai value saja)
  const k4 = await order(c.id, "2026-09-22T03:00:00Z", 3_500_000, { ...dibayar, ongkir: 500_000 });
  await bayar(k4.id, "2026-09-24T03:00:00Z", 3_500_000);

  // T1 — pembanding: LUNAS terbukti penuh;  T2 — LUNAS tanpa payment sama sekali (historis)
  const t1 = await order(c.id, "2026-09-23T03:00:00Z", 1_000_000, dibayar);
  await bayar(t1.id, "2026-09-25T03:00:00Z", 1_000_000);
  await order(c.id, "2026-09-24T03:00:00Z", 1_000_000, dibayar);
  return { c, k1, k2, k3, k4, t1 };
}

test("KONFLIK di DB nyata: LUNAS tersimpan tetapi ledger valid kurang — penyebab gerbang / pembatalan-penggantian / ongkir / 50% terpisah dari lunas terbukti", async () => {
  await buatKasusKonflik();
  const sebelum = await snapshotTabel();
  const r = await hitungKohort(testPrisma);
  assert.deepEqual(await snapshotTabel(), sebelum);
  const k = r.perBulanLead["2026-09"];
  assert.equal(r.rekonsiliasi.ok, true, JSON.stringify(r.rekonsiliasi.cek.filter((x) => !x.ok)));
  assert.equal(k.lunasMenurutCrm.jumlah, 6);
  assert.deepEqual(k.buktiPelunasan, {
    lunasTerbuktiLedger: 1,                                  // T1
    lunasTanpaLedger: 1,                                     // T2
    konflikLunasTersimpanLedgerTidakCukup: 4,                // K1 (50%), K2 (gerbang), K3 (diganti), K4 (ongkir)
    konflikBelumLunasTersimpanLedgerCukup: 0,
    kekuranganRupiahKonflik: 2_250_000 + 2_000_000 + 1_500_000 + 500_000,
  });
  assert.equal(k.cakupanLedger.berLedgerCukup, 1); assert.equal(k.cakupanLedger.berLedgerSebagian, 4); assert.equal(k.cakupanLedger.orderTanpaLedger, 1);
  assert.equal(k.orderDpSaatIniLedger, 4); assert.equal(k.orderDpSaatIniKonflikLunasCrm, 4);
  assert.equal(k.lunasTerbuktiLedger.jumlah, 1);
  assert.equal(r.total.selisihStatusBayar, 5, "4 konflik + 1 LUNAS tanpa ledger");
  assert.equal(k.uangLedger, 2_250_000 + 2_000_000 + 1_500_000 + 3_500_000 + 1_000_000, "payment dibatalkan dan yang belum diverifikasi setelah gerbang tidak dihitung");
});

test("KONFLIK lewat endpoint: tidak muncul sebagai lunas terbukti; berlabel konflik dan peringatan", async () => {
  await buatKasusKonflik();
  const admin = await buatUser("ADMIN");
  const srv = await mulaiServer();
  try {
    const res = await srv.get("/api/atribusi/kohort?dari=2026-09&sampai=2026-09", tokenUntuk(admin, ["ADMIN"]));
    assert.equal(res.status, 200);
    const b = res.body.perBulanOrder["2026-09"].buktiPelunasan;
    assert.equal(b.lunasTerbuktiLedger, 1);
    assert.equal(b.konflikLunasTersimpanLedgerTidakCukup, 4);
    const w = res.body.peringatan.find((x) => x.kode === "KONFLIK_STATUS_LUNAS_LEDGER");
    assert.ok(w); assert.equal(w.data.konflikLunasTersimpanLedgerTidakCukup, 4); assert.equal(w.data.kekuranganRupiahKonflik, 6_250_000);
    assert.equal(res.body.perBulanPembayaran["2026-09"].lunasMenurutCrm.konflikLedger, 4);
    // dua metrik bernama eksplisit: konflik tetap di lunasMenurutCrm, tidak di lunasTerbuktiLedger
    const o = res.body.perBulanOrder["2026-09"];
    assert.equal(o.lunasMenurutCrm.jumlah, 6);
    assert.equal(o.lunasTerbuktiLedger.jumlah, 1);
    assert.equal(o.buktiPelunasan.lunasTerbuktiLedger + o.buktiPelunasan.lunasTanpaLedger + o.buktiPelunasan.konflikLunasTersimpanLedgerTidakCukup, o.lunasMenurutCrm.jumlah, "partisi tepat satu");
    assert.equal(res.body.perBulanPembayaran["2026-09"].lunasMenurutCrm.jumlah, 6);
    assert.equal(res.body.perBulanPembayaran["2026-09"].lunasTerbuktiLedger.jumlah, 1);
    assert.equal(res.body.rekonsiliasi.ok, true);
  } finally { await srv.close(); }
});

// ── SQL pembanding skrip rilis = loader (pada DB nyata) ────────────────────────────────────────────────────────────────
// scripts/release-atribusi-kohort.sh membandingkan endpoint dengan SQL INDEPENDEN. Tes ini membuktikan SQL itu benar: sama dengan loader+inti pada DB nyata.
import fs from "node:fs";
const sqlSkrip = () => {
  const src = fs.readFileSync(new URL("../../../scripts/release-atribusi-kohort.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const m = /read -r -d '' SNAP_SQL <<'SQL' \|\| true\n([\s\S]*?)\nSQL\n/.exec(src);
  assert.ok(m, "SNAP_SQL tidak ditemukan di skrip rilis");
  return m[1];
};
const snapKode = (t) => [t.leads, t.orders, t.nilaiOrder, t.lunasMenurutCrm.jumlah, t.orderBerLedger, t.lunasTerbuktiLedger.jumlah,
  t.buktiPelunasan.lunasTanpaLedger, t.buktiPelunasan.konflikLunasTersimpanLedgerTidakCukup, t.buktiPelunasan.kekuranganRupiahKonflik, t.uangLedger].join("|");
const snapSql = async () => (await testPrisma.$queryRawUnsafe(sqlSkrip()))[0].concat_ws;

test("SQL pembanding skrip rilis = loader+inti pada DB nyata: kasus konflik (gerbang, batal-ganti, ongkir, 50%) — 10 angka identik", async () => {
  await buatKasusKonflik();
  const r = await hitungKohort(testPrisma);
  assert.equal(r.rekonsiliasi.ok, true);
  assert.equal(await snapSql(), snapKode(r.total));
  assert.equal(r.total.buktiPelunasan.konflikLunasTersimpanLedgerTidakCukup, 4);
});

test("SQL pembanding skrip rilis: kasus lengkap (batal, PENDING-tidak, SPAM, staf, refund) — 4 angka dasar identik; refund memang di luar SQL", async () => {
  await siapkanDunia();
  await buatKasusLengkap();
  const r = await hitungKohort(testPrisma);
  const sql = (await snapSql()).split("|"), kode = snapKode(r.total).split("|");
  assert.deepEqual(sql.slice(0, 4), kode.slice(0, 4));
  assert.equal(r.total.refundDisetujui, 500_000, "kasus ini memuat refund → skrip hanya membandingkan 4 angka dasar (exact_sql_ok = false)");
});

// ── ENDPOINT ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function mulaiServer() {
  const app = express();
  app.use("/api/atribusi/kohort", attributionCohortRouter);
  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (path, token) => {
    const resp = await fetch(base + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const teks = await resp.text();
    let body = null; try { body = JSON.parse(teks); } catch { /* bukan JSON */ }
    return { status: resp.status, body, teks, headers: resp.headers };
  };
  return { get, close: () => new Promise((res) => server.close(res)) };
}

test("endpoint GET /api/atribusi/kohort: hanya ADMIN; token SALES/FINANCE ditolak; tanpa token 401; parameter salah 400", async () => {
  await siapkanDunia();
  const admin = await buatUser("ADMIN"), sales = await buatUser("SALES"), fin = await buatUser("FINANCE");
  const srv = await mulaiServer();
  try {
    assert.equal((await srv.get("/api/atribusi/kohort")).status, 401);
    assert.equal((await srv.get("/api/atribusi/kohort", tokenUntuk(sales, ["SALES"]))).status, 403);
    assert.equal((await srv.get("/api/atribusi/kohort", tokenUntuk(fin, ["FINANCE"]))).status, 403);
    const tA = tokenUntuk(admin, ["ADMIN"]);
    assert.equal((await srv.get("/api/atribusi/kohort?dari=2026-13", tA)).status, 400);
    assert.equal((await srv.get("/api/atribusi/kohort?dari=2026-10&sampai=2026-09", tA)).status, 400);
    assert.equal((await srv.get("/api/atribusi/kohort?sampai=2999-01", tA)).status, 400);
    assert.equal((await srv.get("/api/atribusi/kohort?dari=2020-01&sampai=2026-10", tA)).status, 400);
    const ok = await srv.get("/api/atribusi/kohort?dari=2026-08&sampai=2026-10", tA);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("cache-control"), "no-store");
  } finally { await srv.close(); }
});

test("endpoint: kasus lintas bulan lengkap — tiga laporan terpisah, rekonsiliasi OK, tidak menulis, tanpa pengenal/campaign/ROAS", async () => {
  await siapkanDunia();
  const { a, b } = await buatKasusLengkap();
  const admin = await buatUser("ADMIN");
  const lead = await cust("2026-10-06T03:00:00Z", { phone: "628111222333", name: "Nama Sangat Rahasia" });
  const srv = await mulaiServer();
  try {
    const sebelum = await snapshotTabel();
    const res = await srv.get("/api/atribusi/kohort?dari=2026-08&sampai=2026-10", tokenUntuk(admin, ["ADMIN"]));
    assert.deepEqual(await snapshotTabel(), sebelum, "endpoint tidak boleh menulis apa pun");
    assert.equal(res.status, 200);
    const j = res.body;
    assert.equal(j.rekonsiliasi.ok, true, JSON.stringify(j.rekonsiliasi.cek.filter((x) => !x.ok)));
    assert.deepEqual(j.periode, { dari: "2026-08", sampai: "2026-10", bulanBerjalan: j.periode.bulanBerjalan });

    // bulan LEAD
    assert.equal(j.perBulanLead["2026-08"].leads, 1);
    assert.equal(j.perBulanLead["2026-09"].orders, 2);
    assert.equal(j.perBulanLead["2026-10"].leads, 4);       // c, d, e, + lead baru uji
    // bulan ORDER: Okt memuat order dari lead Agustus dan September
    assert.equal(j.perBulanOrder["2026-10"].orders, 3);     // oA (lead Agu), o3 (lead Sep), o5 (lead Okt)
    assert.equal(j.perBulanOrder["2026-10"].orderDariLeadLama, 2);
    assert.equal(j.perBulanOrder["2026-10"].orderDariLeadBulanSama, 1);
    assert.equal(j.perBulanOrder["2026-10"].orderBerulang, 1);     // o3 = order kedua customer b
    // bulan PEMBAYARAN
    assert.equal(j.perBulanPembayaran["2026-09"].uangLedger, M(1));
    assert.equal(j.perBulanPembayaran["2026-10"].uangLedger, M(5) + 2_500_000 + M(2));
    assert.equal(j.perBulanPembayaran["2026-10"].refundDisetujui, 500_000);
    assert.equal(j.perBulanPembayaran["2026-10"].lunasMenurutCrm.jumlah, 2, "oA (6 Okt) dan o2 (2 Okt)");
    // jumlah periode & peringatan
    assert.equal(j.jumlahPeriode.perBulanLead.orders, 4);
    assert.ok(j.peringatan.some((w) => w.kode === "BULAN_BERJALAN") || j.periode.bulanBerjalan > "2026-10");
    assert.equal(j.statusMetrik.atribusi_campaign, "BELUM_ADA_DATA");

    // tidak ada pengenal pribadi / ID / campaign / ROAS
    for (const bocor of ["628111222333", "Nama Sangat Rahasia", "Pelanggan Uji", lead.id, a.id, b.id]) assert.ok(!res.teks.includes(bocor), `bocor: ${bocor}`);
    assert.ok(!/roas/i.test(res.teks), "tidak boleh menyebut ROAS");
    // kunci DATA terlarang: teks definisi boleh menjelaskan bahwa campaign/ad belum tersedia, tetapi tidak boleh ada FIELD-nya
    for (const kunci of ["campaignId", "adSetId", "adId", "campaign", "adSet", "ad", "ctwaClid", "leadSourceDetail", "phone", "name"]) {
      assert.ok(!new RegExp(`"${kunci}"\\s*:`).test(res.teks), `kunci terlarang: ${kunci}`);
    }
  } finally { await srv.close(); }
});

test("transaksi laporan dipaksa READ ONLY oleh Postgres: penulisan di dalam transaksi yang sama ditolak", async () => {
  await siapkanDunia();
  await cust("2026-10-01T03:00:00Z");
  const hasil = { ditolak: false, pesan: null };
  // Bungkus $transaction: setelah hitungLaporanKohort selesai memakai tx, coba MENULIS pada tx yang sama.
  const dbPembungkus = {
    $transaction: (fn, opts) => testPrisma.$transaction(async (tx) => {
      const keluar = await fn(tx);
      try { await tx.customer.create({ data: { name: "Tidak Boleh Tertulis" } }); } catch (e) { hasil.ditolak = true; hasil.pesan = String(e.message); }
      throw Object.assign(new Error("selesai"), { keluar });   // rollback apa pun yang terjadi
    }, opts),
  };
  await assert.rejects(hitungLaporanKohort(dbPembungkus, parseRentang({ dari: "2026-10", sampai: "2026-10" }, T("2026-10-10T05:00:00Z"))), /selesai/);
  assert.equal(hasil.ditolak, true);
  assert.match(hasil.pesan, /read-only/i);
  assert.equal(await testPrisma.customer.count({ where: { name: "Tidak Boleh Tertulis" } }), 0);
});
