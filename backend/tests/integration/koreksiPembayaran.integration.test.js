// B3.7 — KOREKSI PEMBAYARAN MASUK TERVERIFIKASI. Yang dikunci:
//  - Edit Informasi (bukti/catatan/referensi/keterangan internal): tanpa jurnal, audit sebelum/sesudah, alasan wajib.
//  - Koreksi (nominal/tanggal/rekening/metode/order/alokasi): Payment lama dibatalkan+tertaut, jurnal lama REVERSED, pengganti seimbang,
//    saldo rekening bergerak sekali, status/paidAt semua order dihitung ulang, Uang Muka vs Piutang benar sebelum/sesudah pengakuan pendapatan.
//  - Blokir dengan alasan Indonesia (rekonsiliasi, refund, batal/diganti, belum verifikasi), izin server, PIN, pratinjau read-only, idempotency & paralel.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { bukukanPembayaran } from "../../src/services/finance/hooks.js";
import { postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { paidForOrder } from "../../src/services/finance/allocation.js";
import { buatSnapshot, pandanganCutoff } from "../../src/services/finance/rekonSnapshot.js";
import { recomputeOrderPaymentStatus } from "../../src/services/paymentLedger.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const key = () => ({ "Idempotency-Key": `koreksi-uji-${randomUUID()}` });
let n = 0;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  // Tes ini memakai tanggal pembayaran sebelum 18 Sep 2026 sebagai data uji jalur uang BERJALAN; guard cutoff (cutoff.js) diuji terpisah di financePembayaranHistoris.
  await setSetting(testPrisma, SETTING_KEYS.SALDO_AWAL_CUTOFF, "2026-01-01");
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const bank2 = await testPrisma.finCashAccount.create({ data: { name: "Mandiri", kind: "BANK", accountId: akunBank.id } });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const akuntan = await createTestUser({ roles: ["ACCOUNTANT"] });
  return {
    bank, bank2, finance, sales, akuntan,
    f: makeClient(server.baseUrl, finance.token),                              // membawa step-up otomatis
    fTanpa: makeClient(server.baseUrl, finance.token, { tanpaStepUp: true }), // menguji PIN sungguhan
    s: makeClient(server.baseUrl, sales.token),
    a: makeClient(server.baseUrl, akuntan.token),
  };
}

async function buatOrder({ value = 1_000_000, status = "PENDING", nama = "Ibu Erni" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: nama } });
  return testPrisma.order.create({ data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `SAN-K-${String(++n).padStart(4, "0")}`, status } });
}

/** Payment TERVERIFIKASI + berjurnal (seperti setelah Finance memverifikasi). */
async function bayar(w, order, { amount = 400_000, cashAccountId = null, method = "TRANSFER", createdAt = new Date("2026-09-20T05:00:00Z"), alokasi = null } = {}) {
  const p = await testPrisma.payment.create({ data: { orderId: order.id, amount, method, cashAccountId: cashAccountId ?? w.bank.id, recordedById: w.sales.user.id, createdAt } });
  if (alokasi) for (const a of alokasi) await testPrisma.finPaymentAllocation.create({ data: { paymentId: p.id, orderId: a.orderId, amount: a.amount } });
  await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: w.finance.user.id } });
  await testPrisma.$transaction(async (tx) => {
    await bukukanPembayaran(tx, { paymentId: p.id, userId: w.finance.user.id });
    for (const a of alokasi ?? [{ orderId: order.id }]) await recomputeOrderPaymentStatus(tx, a.orderId);
  });
  return p;
}
const koreksi = (w, id, body, headers = key(), klien = w.f) => klien.post(`/api/finance/pembayaran/${id}/koreksi`, { reason: "Salah input saat verifikasi", ...body }, headers);
const pratinjau = (w, id, body) => w.f.post(`/api/finance/pembayaran/${id}/koreksi`, { reason: "Cek dulu", preview: true, ...body });

const jurnalPayment = (id) => testPrisma.finJournalEntry.findMany({ where: { source: "PEMBAYARAN_ORDER", sourceId: id }, include: { lines: { include: { account: { select: { systemKey: true } } } } }, orderBy: { createdAt: "asc" } });
const sum = (e, f) => e.lines.reduce((a, l) => a + Number(l[f]), 0);
async function mutasi(cashAccountId) {
  const rek = await testPrisma.finCashAccount.findUnique({ where: { id: cashAccountId } });
  const baris = await testPrisma.finJournalLine.findMany({ where: { cashAccountId, accountId: rek.accountId, entry: { status: { in: ["POSTED", "REVERSED"] } } } });
  return baris.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
}
async function saldoAkun(systemKey, orderId = null) {
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey } });
  const baris = await testPrisma.finJournalLine.findMany({ where: { accountId: akun.id, ...(orderId ? { orderId } : {}), entry: { status: { in: ["POSTED", "REVERSED"] } } } });
  return baris.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
}
async function bukuSeimbang() {
  const lines = await testPrisma.finJournalLine.findMany({ select: { debit: true, credit: true } });
  assert.equal(lines.reduce((a, l) => a + Number(l.debit), 0), lines.reduce((a, l) => a + Number(l.credit), 0), "buku besar harus seimbang");
}
const statusBayar = async (id) => (await testPrisma.order.findUnique({ where: { id } }));

// ── Edit Informasi ────────────────────────────────────────────────────────────────────────────────

test("Edit Informasi: catatan/referensi/keterangan internal/bukti berubah TANPA jurnal baru; audit sebelum/sesudah; alasan wajib; Idempotency-Key wajib", async () => {
  const w = await dunia();
  const o = await buatOrder();
  const p = await bayar(w, o);
  const jurnalAwal = await testPrisma.finJournalEntry.count();

  assert.equal((await w.f.post(`/api/finance/pembayaran/${p.id}/info`, { reason: "x", notes: "a" })).status, 428, "Idempotency-Key wajib");
  const tanpaAlasan = await w.f.post(`/api/finance/pembayaran/${p.id}/info`, { notes: "a" }, key());
  assert.equal(tanpaAlasan.status, 400);

  const r = await w.f.post(`/api/finance/pembayaran/${p.id}/info`, {
    reason: "Lengkapi data", notes: "Transfer dari BCA a.n. Erni", referenceNumber: "TRX-778812", internalNote: "Cek mutasi tgl 21", proofPhotoUrl: "/media/payment-proofs/abc.jpg",
  }, key());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const db = await testPrisma.payment.findUnique({ where: { id: p.id } });
  assert.equal(db.referenceNumber, "TRX-778812"); assert.equal(db.internalNote, "Cek mutasi tgl 21"); assert.equal(db.notes, "Transfer dari BCA a.n. Erni");
  assert.equal(db.amount, 400_000, "angka tidak berubah");
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalAwal, "tidak ada jurnal baru");
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: p.id, eventType: "DOCUMENT_EDITED" } });
  assert.equal(ev.metadata.reason, "Lengkapi data");
  assert.equal(ev.metadata.before.referenceNumber, null); assert.equal(ev.metadata.after.referenceNumber, "TRX-778812");

  assert.equal((await w.f.post(`/api/finance/pembayaran/${p.id}/info`, { reason: "x", proofPhotoUrl: "http://evil.example/x.jpg" }, key())).status, 400, "bukti hanya dari unggahan sistem");
  assert.equal((await w.f.post(`/api/finance/pembayaran/${p.id}/info`, { reason: "x", notes: "Transfer dari BCA a.n. Erni" }, key())).status, 400, "tanpa perubahan ditolak");
});

// ── Nominal naik / turun, status & paidAt ─────────────────────────────────────────────────────────

test("Koreksi nominal turun lalu naik: reversal + pengganti seimbang, saldo rekening sekali, status DP↔LUNAS & paidAt dihitung ulang, Payment lama tertaut", async () => {
  const w = await dunia();
  const o = await buatOrder({ value: 1_000_000 });
  const p = await bayar(w, o, { amount: 1_000_000 }); // LUNAS
  assert.equal((await statusBayar(o.id)).paymentStatus, "LUNAS");
  assert.ok((await statusBayar(o.id)).paidAt);
  assert.equal(await mutasi(w.bank.id), 1_000_000);

  const r1 = await koreksi(w, p.id, { amount: 600_000 });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  const lama = await testPrisma.payment.findUnique({ where: { id: p.id } });
  assert.ok(lama.cancelledAt); assert.match(lama.cancelReason, /Dikoreksi/); assert.equal(lama.amount, 1_000_000, "isi Payment lama tidak diubah");
  const baru = await testPrisma.payment.findUnique({ where: { id: r1.body.baruId }, include: { verifications: true } });
  assert.equal(baru.replacesPaymentId, p.id); assert.equal(baru.amount, 600_000); assert.equal(baru.verifications.length, 1);
  assert.equal(baru.recordedById, w.sales.user.id, "pencatat asli dipertahankan");
  const js = await jurnalPayment(p.id);
  assert.deepEqual(js.map((e) => e.status), ["REVERSED"]);
  const jb = await jurnalPayment(baru.id);
  assert.equal(jb.length, 1); assert.equal(jb[0].status, "POSTED"); assert.equal(sum(jb[0], "debit"), sum(jb[0], "credit")); assert.equal(sum(jb[0], "debit"), 600_000);
  assert.equal(await mutasi(w.bank.id), 600_000, "saldo bergerak sekali ke nominal baru");
  const o1 = await statusBayar(o.id);
  assert.equal(o1.paymentStatus, "DP"); assert.equal(o1.paidAt, null, "paidAt dibersihkan saat keluar dari LUNAS");

  const r2 = await koreksi(w, r1.body.baruId, { amount: 1_000_000 });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  const o2 = await statusBayar(o.id);
  assert.equal(o2.paymentStatus, "LUNAS"); assert.ok(o2.paidAt);
  assert.equal(await mutasi(w.bank.id), 1_000_000);
  assert.equal(moneyNum(await paidForOrder(testPrisma, o.id, { enabled: false })), 1_000_000, "hanya satu versi aktif dihitung");
  await bukuSeimbang();
});
const moneyNum = (d) => Number(d);

// ── Rekening, tanggal, metode ─────────────────────────────────────────────────────────────────────

test("Koreksi rekening + tanggal + metode: saldo pindah rekening, jurnal pengganti bertanggal baru, reversal bertanggal asli, tanggal Payment baru", async () => {
  const w = await dunia();
  const o = await buatOrder();
  const p = await bayar(w, o, { amount: 400_000, createdAt: new Date("2026-09-20T05:00:00Z") });
  const r = await koreksi(w, p.id, { cashAccountId: w.bank2.id, tanggal: "2026-09-18", method: "QRIS" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await mutasi(w.bank.id), 0, "rekening lama nol lagi");
  assert.equal(await mutasi(w.bank2.id), 400_000);
  const baru = await testPrisma.payment.findUnique({ where: { id: r.body.baruId } });
  assert.equal(baru.method, "QRIS"); assert.equal(baru.cashAccountId, w.bank2.id);
  assert.equal(baru.createdAt.toISOString().slice(0, 10), "2026-09-18");
  const jb = (await jurnalPayment(baru.id))[0];
  assert.equal(jb.date.toISOString().slice(0, 10), "2026-09-18");
  const rev = (await testPrisma.finJournalEntry.findMany({ where: { source: "REVERSAL" } }))[0];
  assert.equal(rev.date.toISOString().slice(0, 10), "2026-09-20", "reversal bertanggal sama dengan jurnal asli");
  assert.equal((await koreksi(w, baru.id, { tanggal: "2999-01-01" })).status, 400, "tanggal masa depan ditolak");
  await bukuSeimbang();
});

// ── Sebelum / sesudah pengakuan pendapatan ─────────────────────────────────────────────────────────

test("Sebelum pengakuan pendapatan: pengganti mengkredit UANG MUKA; order tunggal lain tidak tersentuh", async () => {
  const w = await dunia();
  const o = await buatOrder(); const lain = await buatOrder({ nama: "Bpk Lain" });
  const pLain = await bayar(w, lain, { amount: 100_000 });
  const p = await bayar(w, o, { amount: 300_000 });
  const r = await koreksi(w, p.id, { amount: 350_000 });
  assert.equal(r.status, 201);
  const jb = (await jurnalPayment(r.body.baruId))[0];
  const kredit = jb.lines.filter((l) => Number(l.credit) > 0);
  assert.deepEqual(kredit.map((l) => l.account.systemKey), [SYSTEM_KEYS.UANG_MUKA_PELANGGAN]);
  assert.equal(await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN, o.id), -350_000);
  assert.equal((await testPrisma.payment.findUnique({ where: { id: pLain.id } })).cancelledAt, null, "payment lain tak tersentuh");
  assert.equal((await jurnalPayment(pLain.id))[0].status, "POSTED");
});

test("Setelah pengakuan pendapatan: DP lama (Uang Muka) dikoreksi → Uang Muka bersih 0, Piutang = tagihan − nominal baru (reklas otomatis); pembayaran pasca-pengakuan mengkredit Piutang", async () => {
  const w = await dunia();
  const o = await buatOrder({ value: 1_000_000 });
  const p = await bayar(w, o, { amount: 300_000 }); // DP sebelum diserahkan → Cr Uang Muka
  await testPrisma.order.update({ where: { id: o.id }, data: { status: "DELIVERED" } });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: w.finance.user.id }));
  assert.equal(await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN, o.id), 0, "uang muka sudah dipindah saat pengakuan");
  assert.equal(await saldoAkun(SYSTEM_KEYS.PIUTANG_USAHA, o.id), 700_000);

  const pra = await pratinjau(w, p.id, { amount: 400_000 });
  assert.equal(pra.status, 200, JSON.stringify(pra.body));
  assert.equal(pra.body.pratinjau.reklasUangMuka.length, 1, "pratinjau memuat reklas uang muka");
  assert.equal(pra.body.pratinjau.seimbang, true);

  const r = await koreksi(w, p.id, { amount: 400_000 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const jb = (await jurnalPayment(r.body.baruId))[0];
  assert.deepEqual(jb.lines.filter((l) => Number(l.credit) > 0).map((l) => l.account.systemKey), [SYSTEM_KEYS.PIUTANG_USAHA], "sesudah pengakuan: kredit Piutang");
  assert.equal(await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN, o.id), 0, "Uang Muka bersih");
  assert.equal(await saldoAkun(SYSTEM_KEYS.PIUTANG_USAHA, o.id), 600_000, "Piutang = 1.000.000 − 400.000");
  assert.equal(await mutasi(w.bank.id), 400_000);
  await bukuSeimbang();
});

// ── Alokasi multi-order & pembulatan ───────────────────────────────────────────────────────────────

test("Alokasi multi-order: ubah pembagian, ubah nominal → pembagian proporsional exact (Σ = nominal), status semua order dihitung ulang, sisa tagihan tidak dilampaui", async () => {
  const w = await dunia();
  const a = await buatOrder({ value: 100_000, nama: "Ibu A" }); const b = await buatOrder({ value: 100_000, nama: "Ibu B" });
  const p = await bayar(w, a, { amount: 100_001, alokasi: [{ orderId: a.id, amount: 60_001 }, { orderId: b.id, amount: 40_000 }] });

  const r1 = await koreksi(w, p.id, { amount: 99_999 }); // proporsional 60001:40000
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  const rows = await testPrisma.finPaymentAllocation.findMany({ where: { paymentId: r1.body.baruId }, orderBy: { amount: "desc" } });
  assert.equal(rows.reduce((s, x) => s + Number(x.amount), 0), 99_999, "Σ alokasi = nominal (largest-remainder)");
  assert.equal((await jurnalPayment(r1.body.baruId))[0].lines.filter((l) => Number(l.credit) > 0).length, 2);

  const over = await koreksi(w, r1.body.baruId, { alokasi: [{ orderId: a.id, amount: 100_001 }] , amount: 100_001 });
  assert.equal(over.status, 409); assert.equal(over.body.code, "OVER_ALOKASI"); assert.match(over.body.error, /melebihi sisa tagihan/);
  const tdkSama = await koreksi(w, r1.body.baruId, { alokasi: [{ orderId: a.id, amount: 50_000 }, { orderId: b.id, amount: 10_000 }] });
  assert.equal(tdkSama.status, 400); assert.equal(tdkSama.body.code, "TOTAL_ALOKASI_TIDAK_SAMA");

  const r2 = await koreksi(w, r1.body.baruId, { alokasi: [{ orderId: a.id, amount: 99_999 }] });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal((await statusBayar(a.id)).paymentStatus, "DP");
  assert.equal((await statusBayar(b.id)).paymentStatus, "BELUM_BAYAR", "order yang uangnya ditarik keluar turun status");
  await bukuSeimbang();
});

test("Pindah order tunggal: uang pindah ke order lain, keduanya dihitung ulang; order Resi/dibatalkan sebagai tujuan ditolak", async () => {
  const w = await dunia();
  const a = await buatOrder({ value: 500_000 }); const b = await buatOrder({ value: 500_000, nama: "Bpk B" });
  const batal = await buatOrder({ status: "CANCELLED", nama: "Bpk C" });
  const p = await bayar(w, a, { amount: 500_000 });
  assert.equal((await statusBayar(a.id)).paymentStatus, "LUNAS");
  assert.equal((await koreksi(w, p.id, { orderId: batal.id })).status, 409);
  const r = await koreksi(w, p.id, { orderId: b.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await statusBayar(a.id)).paymentStatus, "BELUM_BAYAR"); assert.equal((await statusBayar(b.id)).paymentStatus, "LUNAS");
  const jb = (await jurnalPayment(r.body.baruId))[0];
  assert.ok(jb.lines.every((l) => !l.orderId || l.orderId === b.id));
});

// ── Resi ───────────────────────────────────────────────────────────────────────────────────────────

async function resi(w) {
  await setSetting(testPrisma, SETTING_KEYS.RESI_INPUT_AKTIF, "true");
  await setSetting(testPrisma, SETTING_KEYS.RESI_PEMBAYARAN_AKTIF, "true");
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Resi", assignedSalesId: w.sales.user.id } });
  const r = await w.s.post("/api/resi", {
    customerId: customer.id, alamat: "Jl. Kemang 1", kota: "Jakarta Selatan", ongkirTambahan: 50_000,
    items: [1_000_000, 500_000, 250_001].map((nominal) => ({ merk: "Sano", ukuran: "160x200 cm (Queen)", keluhan: "Pegal", nominal, unitCount: 1 })),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  // Bukti pembayaran wajib untuk Sales sejak 1 Okt 2026 (resi.js); tes ini lebih tua dari aturan itu.
  const bayarResi = await w.s.post(`/api/resi/${r.body.groupId}/pembayaran`, { method: "TRANSFER", cashAccountId: w.bank.id, tipe: "DP", proofPhotoUrl: "/media/payment-proofs/resi-test.jpg" }, key());
  assert.equal(bayarResi.status, 201, JSON.stringify(bayarResi.body));
  const payment = await testPrisma.payment.findUnique({ where: { id: bayarResi.body.paymentId ?? bayarResi.body.pembayaran?.id } });
  await testPrisma.paymentVerification.upsert({ where: { paymentId: payment.id }, create: { paymentId: payment.id, verifiedById: w.finance.user.id }, update: {} });
  return { groupId: r.body.groupId, anak: r.body.orders.map((x) => x.id), payment };
}

test("Resi: koreksi nominal memakai helper kanonis (alokasi proporsional, tidak melebihi sisa tagihan), status semua child dihitung ulang; pindah order/child langsung ditolak", async () => {
  const w = await dunia();
  const { anak, payment } = await resi(w);
  assert.equal(payment.amount, 540_000);
  const lainOrder = await buatOrder({ nama: "Bpk Lain" });

  const pindah = await koreksi(w, payment.id, { orderId: lainOrder.id });
  assert.equal(pindah.status, 409); assert.equal(pindah.body.code, "RESI_PINDAH_ORDER"); assert.match(pindah.body.error, /Ubah pembagian/);
  const keluar = await koreksi(w, payment.id, { alokasi: [{ orderId: lainOrder.id, amount: 540_000 }] });
  assert.equal(keluar.status, 409, "alokasi ke order di luar Resi ditolak");

  const pra = await pratinjau(w, payment.id, { amount: 600_000 });
  assert.equal(pra.status, 200, JSON.stringify(pra.body));
  assert.equal(pra.body.pratinjau.dampakStatus.length, 3, "pratinjau memuat semua child Resi");

  const r = await koreksi(w, payment.id, { amount: 600_000 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const rows = await testPrisma.finPaymentAllocation.findMany({ where: { paymentId: r.body.baruId } });
  assert.equal(rows.reduce((s, x) => s + Number(x.amount), 0), 600_000);
  assert.equal(rows.length, 3);
  const jb = (await jurnalPayment(r.body.baruId))[0];
  assert.equal(sum(jb, "debit"), 600_000); assert.equal(sum(jb, "debit"), sum(jb, "credit"));
  const baru = await testPrisma.payment.findUnique({ where: { id: r.body.baruId } });
  assert.equal(baru.orderId, payment.orderId, "Payment Resi tetap di anchor");

  const terlalu = await koreksi(w, r.body.baruId, { amount: 5_000_000 });
  assert.equal(terlalu.status, 409); assert.ok(["OVER_ALOKASI", "TOTAL_TIDAK_SAMA"].includes(terlalu.body.code), terlalu.body.code);
  await bukuSeimbang();
});

// ── Blokir ─────────────────────────────────────────────────────────────────────────────────────────

test("Blokir: sudah diganti/dibatalkan, belum diverifikasi, refund aktif, cocok mutasi bank, periode rekon SELESAI — alasan Indonesia + arah tindakan; daftar menampilkan menu nonaktif beserta alasan", async () => {
  const w = await dunia();
  const o = await buatOrder();

  // belum diverifikasi
  const belum = await testPrisma.payment.create({ data: { orderId: o.id, amount: 100_000, method: "TRANSFER", cashAccountId: w.bank.id, recordedById: w.sales.user.id } });
  const rb = await koreksi(w, belum.id, { amount: 90_000 });
  assert.equal(rb.status, 409); assert.equal(rb.body.code, "BELUM_DIVERIFIKASI"); assert.match(rb.body.error, /belum diverifikasi.*Verifikasi atau tolak/);

  // sudah diganti
  const p = await bayar(w, o, { amount: 200_000 });
  const ok = await koreksi(w, p.id, { amount: 210_000 });
  assert.equal(ok.status, 201);
  const ulang = await koreksi(w, p.id, { amount: 220_000 });
  assert.equal(ulang.status, 409); assert.equal(ulang.body.code, "SUDAH_DIGANTI"); assert.match(ulang.body.error, /Riwayat Perubahan/);

  // refund aktif
  const p2 = await bayar(w, o, { amount: 50_000 });
  await testPrisma.finRefund.create({ data: { refundNumber: "RFD-K-1", orderId: o.id, date: new Date("2026-09-21"), amount: 10_000, reason: "x", cashAccountId: w.bank.id, status: "MENUNGGU_APPROVAL", createdById: w.finance.user.id } });
  const rr = await koreksi(w, p2.id, { amount: 60_000 });
  assert.equal(rr.status, 409); assert.equal(rr.body.code, "ADA_REFUND"); assert.match(rr.body.error, /Refund Pelanggan/);
  await testPrisma.finRefund.deleteMany({});

  // cocok mutasi bank
  const stmt = await testPrisma.finBankStatement.create({ data: { cashAccountId: w.bank.id, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30"), openingBalance: 0, closingBalance: 0, status: "DRAFT" } });
  const jr = (await jurnalPayment(p2.id))[0];
  const barisKas = jr.lines.find((l) => l.cashAccountId === w.bank.id);
  await testPrisma.finBankStatementLine.create({ data: { statementId: stmt.id, date: new Date("2026-09-20"), description: "TRF", amount: 50_000, matchedLineId: barisKas.id } });
  const rc = await koreksi(w, p2.id, { amount: 60_000 });
  assert.equal(rc.status, 409); assert.equal(rc.body.code, "SUDAH_DIREKONSILIASI");
  await testPrisma.finBankStatementLine.deleteMany({});

  // periode rekonsiliasi SELESAI (rekening asal)
  await testPrisma.finBankStatement.update({ where: { id: stmt.id }, data: { status: "SELESAI" } });
  const rs = await koreksi(w, p2.id, { amount: 60_000 });
  assert.equal(rs.status, 409); assert.equal(rs.body.code, "PERIODE_REKON_SELESAI"); assert.match(rs.body.error, /SELESAI/);
  // ...dan untuk rekening TUJUAN
  const p3 = await bayar(w, await buatOrder({ nama: "Bpk Z" }), { amount: 70_000, cashAccountId: w.bank2.id });
  const rt = await koreksi(w, p3.id, { cashAccountId: w.bank.id });
  assert.equal(rt.status, 409); assert.equal(rt.body.code, "PERIODE_REKON_SELESAI");

  // tidak ada satu pun blokir yang mengubah data
  assert.equal((await testPrisma.payment.findUnique({ where: { id: p2.id } })).cancelledAt, null);

  // Daftar: menu nonaktif tetap terlihat, alasan dari server
  const daftar = await w.f.get("/api/finance/customer-payments?from=2026-09-01&to=2026-09-30&status=");
  assert.equal(daftar.status, 200);
  const item = daftar.body.payments.find((x) => x.id === p2.id);
  assert.equal(item.menuKoreksi.koreksi.aktif, false); assert.equal(item.menuKoreksi.koreksi.kode, "PERIODE_REKON_SELESAI");
  assert.ok(item.menuKoreksi.koreksi.alasan && item.menuKoreksi.koreksi.arah);
  assert.equal(item.menuKoreksi.editInfo.aktif, true); assert.equal(item.menuKoreksi.riwayat.aktif, true); assert.equal(item.menuKoreksi.lihatDetail.aktif, true);
  const lama = daftar.body.payments.find((x) => x.id === p.id);
  assert.equal(lama.menuKoreksi.koreksi.aktif, false); assert.equal(lama.menuKoreksi.editInfo.aktif, false);
});

test("Pembayaran pra-saldo-awal (lawan Laba Ditahan) atau tanpa jurnal aktif: diblokir dengan arahan", async () => {
  const w = await dunia();
  const o = await buatOrder();
  const p = await testPrisma.payment.create({ data: { orderId: o.id, amount: 100_000, method: "TRANSFER", cashAccountId: w.bank.id, recordedById: w.sales.user.id } });
  await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: w.finance.user.id } });
  const tanpaJurnal = await koreksi(w, p.id, { amount: 90_000 });
  assert.equal(tanpaJurnal.status, 409); assert.equal(tanpaJurnal.body.code, "JURNAL_TIDAK_ADA");

  const laba = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.LABA_DITAHAN } });
  const um = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.UANG_MUKA_PELANGGAN } });
  await testPrisma.finJournalEntry.create({
    data: {
      entryNumber: "JV-K-1", date: new Date("2026-09-10"), description: "pra saldo awal", source: "PEMBAYARAN_ORDER", sourceId: p.id, idempotencyKey: `PEMBAYARAN_ORDER:${p.id}`, status: "POSTED",
      lines: { create: [{ lineNo: 1, accountId: laba.id, debit: 100_000, credit: 0 }, { lineNo: 2, accountId: um.id, debit: 0, credit: 100_000, orderId: o.id }] },
    },
  });
  const pra = await koreksi(w, p.id, { amount: 90_000 });
  assert.equal(pra.status, 409); assert.equal(pra.body.code, "PRA_SALDO_AWAL");
});

// ── Izin, PIN, pratinjau ───────────────────────────────────────────────────────────────────────────

test("Izin & PIN: SALES/ACCOUNTANT 403 (info, koreksi, pratinjau); FINANCE tanpa PIN 403 STEPUP_*; pratinjau tanpa PIN & tanpa Idempotency-Key; PIN sungguhan lewat API → koreksi berjalan", async () => {
  const w = await dunia();
  const o = await buatOrder(); const p = await bayar(w, o, { amount: 100_000 });
  for (const klien of [w.s, w.a]) {
    assert.equal((await klien.post(`/api/finance/pembayaran/${p.id}/koreksi`, { reason: "x", amount: 90_000, preview: true })).status, 403);
    assert.equal((await klien.post(`/api/finance/pembayaran/${p.id}/koreksi`, { reason: "x", amount: 90_000 }, key())).status, 403);
    assert.equal((await klien.post(`/api/finance/pembayaran/${p.id}/info`, { reason: "x", notes: "a" }, key())).status, 403);
  }
  // pratinjau: tanpa PIN & tanpa Idempotency-Key, dan tidak menulis apa pun
  const sebelum = { pay: await testPrisma.payment.count(), jr: await testPrisma.finJournalEntry.count(), ev: await testPrisma.activityEvent.count() };
  const pra = await w.fTanpa.post(`/api/finance/pembayaran/${p.id}/koreksi`, { reason: "cek", amount: 90_000, preview: true });
  assert.equal(pra.status, 200, JSON.stringify(pra.body));
  assert.equal(pra.body.pratinjau.jurnalDibalik.length, 1); assert.equal(pra.body.pratinjau.jurnalPengganti.length, 1); assert.equal(pra.body.pratinjau.seimbang, true);
  assert.equal(pra.body.pratinjau.dampakSaldo[0].selisih, -10_000);
  assert.deepEqual({ pay: await testPrisma.payment.count(), jr: await testPrisma.finJournalEntry.count(), ev: await testPrisma.activityEvent.count() }, sebelum, "pratinjau tidak menulis apa pun");

  // simpan tanpa Idempotency-Key & tanpa PIN
  assert.equal((await w.fTanpa.post(`/api/finance/pembayaran/${p.id}/koreksi`, { reason: "x", amount: 90_000 })).status, 428);
  const tanpaPin = await w.fTanpa.post(`/api/finance/pembayaran/${p.id}/koreksi`, { reason: "x", amount: 90_000 }, key());
  assert.equal(tanpaPin.status, 403); assert.equal(tanpaPin.body.code, "STEPUP_PIN_BELUM_DIATUR");
  assert.equal((await testPrisma.payment.findUnique({ where: { id: p.id } })).cancelledAt, null, "tanpa PIN tidak ada yang berubah");

  // atur PIN lewat API sungguhan (Finance kini diizinkan), verifikasi, lalu koreksi
  await testPrisma.user.update({ where: { id: w.finance.user.id }, data: { passwordHash: await bcrypt.hash("rahasia123", 4) } });
  assert.equal((await w.fTanpa.post("/api/finance/pin", { password: "rahasia123", pin: "123456" })).status, 200);
  const salah = await w.fTanpa.post(`/api/finance/pembayaran/${p.id}/koreksi`, { reason: "x", amount: 90_000 }, key());
  assert.equal(salah.body.code, "STEPUP_DIPERLUKAN");
  const tv = await w.fTanpa.post("/api/finance/pin/verifikasi", { pin: "123456" });
  assert.equal(tv.status, 200, JSON.stringify(tv.body));
  const ok = await w.fTanpa.post(`/api/finance/pembayaran/${p.id}/koreksi`, { reason: "Nominal salah", amount: 90_000 }, { ...key(), "X-Finance-Stepup": tv.body.token });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: p.id, eventType: "DOCUMENT_CORRECTED" } });
  assert.equal(ev.metadata.reason, "Nominal salah"); assert.equal(ev.metadata.after.amount, 90_000); assert.equal(ev.metadata.before.amount, 100_000);
  assert.ok(ev.metadata.jurnalDibalik.length === 1 && ev.metadata.jurnalPengganti.length === 1);
});

// ── Idempotency & konkurensi ───────────────────────────────────────────────────────────────────────

test("Replay Idempotency-Key SAMA → satu koreksi; dua request PARALEL (kunci berbeda) → tepat satu menang, yang lain 409 bersih; tidak ada uang/jurnal ganda", async () => {
  const w = await dunia();
  const o = await buatOrder(); const p = await bayar(w, o, { amount: 300_000 });
  const H = key();
  const a = await koreksi(w, p.id, { amount: 320_000 }, H);
  const b = await koreksi(w, p.id, { amount: 320_000 }, H);
  assert.equal(a.status, 201); assert.equal(b.status, 201); assert.equal(b.headers.get("idempotent-replayed"), "true");
  assert.equal(b.body.baruId, a.body.baruId);
  assert.equal(await testPrisma.payment.count({ where: { replacesPaymentId: p.id } }), 1);
  assert.equal(await mutasi(w.bank.id), 320_000);

  const p2 = await bayar(w, await buatOrder({ nama: "Bpk Par" }), { amount: 200_000 });
  const hasil = await Promise.all([
    koreksi(w, p2.id, { amount: 210_000 }), koreksi(w, p2.id, { amount: 230_000 }), koreksi(w, p2.id, { amount: 250_000 }),
  ]);
  const menang = hasil.filter((r) => r.status === 201); const kalah = hasil.filter((r) => r.status !== 201);
  assert.equal(menang.length, 1, JSON.stringify(hasil.map((r) => r.status)));
  assert.ok(kalah.every((r) => r.status === 409), "yang kalah 409 bersih (bukan 500)");
  assert.equal(await testPrisma.payment.count({ where: { replacesPaymentId: p2.id } }), 1);
  assert.equal((await testPrisma.finJournalEntry.findMany({ where: { source: "PEMBAYARAN_ORDER", sourceId: p2.id } })).length, 1);
  assert.equal(await mutasi(w.bank.id), 320_000 + Number((await testPrisma.payment.findUnique({ where: { id: menang[0].body.baruId } })).amount));
  await bukuSeimbang();
});

// ── Riwayat ────────────────────────────────────────────────────────────────────────────────────────

test("Riwayat Perubahan: rantai versi lama→baru, peristiwa (edit info & koreksi dengan alasan/sebelum-sesudah), rantai jurnal asli→dibalik→pengganti", async () => {
  const w = await dunia();
  const o = await buatOrder(); const p = await bayar(w, o, { amount: 300_000 });
  await w.f.post(`/api/finance/pembayaran/${p.id}/info`, { reason: "Tambah referensi", referenceNumber: "REF-1" }, key());
  const r1 = await koreksi(w, p.id, { amount: 310_000 });
  const r2 = await koreksi(w, r1.body.baruId, { amount: 320_000, cashAccountId: w.bank2.id });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));

  const h = await w.f.get(`/api/finance/pembayaran/${p.id}/riwayat`); // dari versi mana pun rantainya sama
  assert.equal(h.status, 200);
  assert.deepEqual(h.body.versi.map((v) => [v.nomorVersi, v.status, v.nominal]), [[1, "DIGANTI", 300_000], [2, "DIGANTI", 310_000], [3, "AKTIF", 320_000]]);
  assert.equal(h.body.versi[2].terbaru, true); assert.equal(h.body.versi[2].rekening, "Mandiri");
  assert.ok(h.body.peristiwa.some((e) => e.aksi === "Informasi diubah" && e.alasan === "Tambah referensi"));
  assert.equal(h.body.peristiwa.filter((e) => e.aksi.startsWith("Dikoreksi")).length, 4, "dua koreksi × (versi lama + versi baru)");
  const status = h.body.jurnal.map((j) => j.status);
  assert.equal(status.filter((s) => s === "REVERSED").length, 2 + 0, "dua jurnal asli dibalik");
  assert.ok(h.body.jurnal.some((j) => j.membalikJurnal));
  const dariBaru = await w.f.get(`/api/finance/pembayaran/${r2.body.baruId}/riwayat`);
  assert.equal(dariBaru.body.versi.length, 3);
  assert.equal((await w.a.get(`/api/finance/pembayaran/${p.id}/riwayat`)).status, 200, "ACCOUNTANT boleh membaca riwayat");
  assert.equal((await w.f.get(`/api/finance/pembayaran/tidak-ada/riwayat`)).status, 404);
  await bukuSeimbang();
});

test("Kompatibilitas: order tunggal tanpa alokasi tetap tanpa baris alokasi setelah koreksi; payment lama yang melebihi tagihan bisa dikoreksi TURUN; SALES tetap tak bisa memakai jalur ini", async () => {
  const w = await dunia();
  const o = await buatOrder({ value: 100_000 });
  const p = await bayar(w, o, { amount: 150_000 }); // data lama: kelebihan bayar
  const r = await koreksi(w, p.id, { amount: 120_000 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await testPrisma.finPaymentAllocation.count({ where: { paymentId: r.body.baruId } }), 0);
  const naik = await koreksi(w, r.body.baruId, { amount: 130_000 });
  assert.equal(naik.status, 409, "kenaikan di atas toleransi lama tetap dijaga sisa tagihan"); assert.equal(naik.body.code, "OVER_ALOKASI");
  const bawah = await koreksi(w, r.body.baruId, { amount: 100_000 });
  assert.equal(bawah.status, 201);
  assert.equal((await statusBayar(o.id)).paymentStatus, "LUNAS");
});

// ── Temuan audit invarian (Opus) ───────────────────────────────────────────────────────────────────

const pengakuan = async (w, order, tanggal = "2026-09-25") => {
  await testPrisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: w.finance.user.id, date: new Date(`${tanggal}T00:00:00Z`) }));
};

test("Kelebihan bayar SEBELUM pengakuan lalu koreksi: true-up ke keadaan kanonis (Uang Muka = kelebihan, Piutang 0); jurnal penyesuaian bertanggal pengakuan", async () => {
  const w = await dunia();
  const o = await buatOrder({ value: 300_000 });
  const p1 = await bayar(w, o, { amount: 400_000 }); // kelebihan 100.000 (UM)
  await pengakuan(w, o, "2026-09-25");
  assert.equal(await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN, o.id), -100_000, "UM sisa kelebihan (kredit)");
  const r = await koreksi(w, p1.id, { amount: 350_000 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN, o.id), -50_000, "kelebihan 50.000 tetap Uang Muka");
  assert.equal(await saldoAkun(SYSTEM_KEYS.PIUTANG_USAHA, o.id), 0, "Piutang tidak bersaldo kredit");
  const penyesuaian = await testPrisma.finJournalEntry.findMany({ where: { idempotencyKey: { contains: ":RECLAS:" } } });
  assert.equal(penyesuaian.length, 1);
  assert.equal(penyesuaian[0].date.toISOString().slice(0, 10), "2026-09-25", "bertanggal jurnal pengakuan (periode lama konsisten)");
  assert.equal(penyesuaian[0].sourceId, r.body.baruId, "menempel ke payment AKTIF (bukan yang dibatalkan)");
  await bukuSeimbang();
});

test("Dua payment UM, satu dikoreksi turun setelah pengakuan: tidak muncul utang + uang muka sekaligus (UM 50.000, Piutang 0)", async () => {
  const w = await dunia();
  const o = await buatOrder({ value: 300_000 });
  const p1 = await bayar(w, o, { amount: 200_000 }); await bayar(w, o, { amount: 200_000 });
  await pengakuan(w, o);
  const r = await koreksi(w, p1.id, { amount: 150_000 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN, o.id), -50_000);
  assert.equal(await saldoAkun(SYSTEM_KEYS.PIUTANG_USAHA, o.id), 0);
  await bukuSeimbang();
});

test("Blokir tambahan (audit): rekening efektif dari pemetaan cara bayar + periode rekon SELESAI; klaim Lunas order tunggal; anchor Resi dibatalkan", async () => {
  const w = await dunia();
  // 1) rekening tidak dipilih (pemetaan Tunai) + periode SELESAI pada rekening pemetaan → tanggal tujuan ditolak
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, kas.id);
  await testPrisma.finBankStatement.create({ data: { cashAccountId: kas.id, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-16"), openingBalance: 0, closingBalance: 0, status: "SELESAI" } });
  const o = await buatOrder();
  const p = await testPrisma.payment.create({ data: { orderId: o.id, amount: 100_000, method: "CASH", cashAccountId: null, recordedById: w.sales.user.id, createdAt: new Date("2026-09-20T05:00:00Z") } });
  await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: w.finance.user.id } });
  await testPrisma.$transaction((tx) => bukukanPembayaran(tx, { paymentId: p.id, userId: w.finance.user.id }));
  const r1 = await koreksi(w, p.id, { tanggal: "2026-09-15" });
  assert.equal(r1.status, 409); assert.equal(r1.body.code, "PERIODE_REKON_SELESAI");

  // 2) klaim Lunas order tunggal (LUNAS tetapi uang tercatat belum menutup tagihan)
  const o2 = await buatOrder({ value: 1_000_000, nama: "Bpk Klaim" });
  const p2 = await bayar(w, o2, { amount: 300_000 });
  await testPrisma.order.update({ where: { id: o2.id }, data: { paymentStatus: "LUNAS", paidAt: new Date() } });
  const r2 = await koreksi(w, p2.id, { cashAccountId: w.bank2.id });
  assert.equal(r2.status, 409); assert.equal(r2.body.code, "KLAIM_LUNAS_ORDER"); assert.match(r2.body.error, /Perlu Verifikasi Finance/);
  assert.equal((await testPrisma.order.findUnique({ where: { id: o2.id } })).paymentStatus, "LUNAS", "klaim tidak terhapus diam-diam");

  // 3) Resi: anchor sudah dibatalkan → sama dengan alur Resi normal
  const { groupId, payment } = await resi(w);
  const grup = await testPrisma.orderGroup.findUnique({ where: { id: groupId } });
  await testPrisma.order.update({ where: { id: grup.anchorOrderId }, data: { status: "CANCELLED" } });
  const r3 = await koreksi(w, payment.id, { amount: 500_000 });
  assert.equal(r3.status, 409); assert.equal(r3.body.code, "ANCHOR_DIBATALKAN");
});

test("Pencocokan mutasi bank menolak baris jurnal yang sudah dibalik (tutup celah balapan koreksi vs match)", async () => {
  const w = await dunia();
  const o = await buatOrder(); const p = await bayar(w, o, { amount: 100_000 });
  const asli = (await jurnalPayment(p.id))[0];
  const barisKas = asli.lines.find((l) => l.cashAccountId === w.bank.id);
  const r = await koreksi(w, p.id, { amount: 120_000 });
  assert.equal(r.status, 201);
  const stmt = await testPrisma.finBankStatement.create({ data: { cashAccountId: w.bank.id, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30"), openingBalance: 0, closingBalance: 0, status: "DRAFT" } });
  const line = await testPrisma.finBankStatementLine.create({ data: { statementId: stmt.id, date: new Date("2026-09-20"), description: "TRF", amount: 100_000 } });
  const m = await w.f.post(`/api/finance/bank-lines/${line.id}/match`, { journalLineId: barisKas.id });
  assert.equal(m.status, 409); assert.match(m.body.error, /sudah dibalik/);
});

// ── B3.7 final: paidAt = tanggal pembayaran efektif yang melewati titik lunas ─────────────────────────────

const H = (tgl) => new Date(`${tgl}T05:00:00Z`); // 12.00 WIB
const paidAtIso = async (id) => (await testPrisma.order.findUnique({ where: { id } })).paidAt?.toISOString() ?? null;

test("paidAt: koreksi tanggal dalam bulan sama & pindah bulan — paidAt = tanggal pembayaran pelunas, BUKAN waktu koreksi", async () => {
  const w = await dunia();
  const o = await buatOrder({ value: 1_000_000 });
  await bayar(w, o, { amount: 400_000, createdAt: H("2026-08-10") });
  const p2 = await bayar(w, o, { amount: 600_000, createdAt: H("2026-09-20") });
  assert.equal(await paidAtIso(o.id), H("2026-09-20").toISOString(), "transisi ke LUNAS memakai tanggal pembayaran pelunas");

  const r1 = await koreksi(w, p2.id, { tanggal: "2026-09-25" }); // bulan sama
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(await paidAtIso(o.id), H("2026-09-25").toISOString());
  const r2 = await koreksi(w, r1.body.baruId, { tanggal: "2026-08-25" }); // pindah bulan (mundur)
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal(await paidAtIso(o.id), H("2026-08-25").toISOString());
  const r3 = await koreksi(w, r2.body.baruId, { tanggal: "2026-08-05" }); // sebelum DP pertama: kini pembayaran 10 Agu yang melewati titik lunas
  assert.equal(r3.status, 201);
  assert.equal(await paidAtIso(o.id), H("2026-08-10").toISOString(), "urut menurut tanggal efektif: pembayaran 10 Agu yang melewati titik lunas");
});

test("paidAt: LUNAS→DP (null) dan DP→LUNAS (tanggal pembayaran itu, bukan sekarang)", async () => {
  const w = await dunia();
  const o = await buatOrder({ value: 1_000_000 });
  const p = await bayar(w, o, { amount: 1_000_000, createdAt: H("2026-09-12") });
  assert.equal(await paidAtIso(o.id), H("2026-09-12").toISOString());
  const turun = await koreksi(w, p.id, { amount: 600_000 });
  assert.equal(turun.status, 201);
  const o1 = await statusBayar(o.id);
  assert.equal(o1.paymentStatus, "DP"); assert.equal(o1.paidAt, null);
  const naik = await koreksi(w, turun.body.baruId, { amount: 1_000_000 });
  assert.equal(naik.status, 201);
  assert.equal(await paidAtIso(o.id), H("2026-09-12").toISOString(), "kembali LUNAS: tanggal pembayaran, bukan waktu koreksi");
});

test("paidAt: koreksi alokasi antar-order — hanya order terdampak berubah; order tidak terdampak identik (termasuk paidAt lama)", async () => {
  const w = await dunia();
  const a = await buatOrder({ value: 60_000, nama: "Ibu A" }); const b = await buatOrder({ value: 60_000, nama: "Ibu B" });
  const lain = await buatOrder({ value: 50_000, nama: "Bpk Lain" });
  await bayar(w, lain, { amount: 50_000, createdAt: H("2026-07-01") });
  await testPrisma.order.update({ where: { id: lain.id }, data: { paidAt: new Date("2026-07-03T00:00:00Z") } }); // paidAt lama (legacy) — tidak boleh bergeser
  const p = await bayar(w, a, { amount: 100_000, createdAt: H("2026-09-15"), alokasi: [{ orderId: a.id, amount: 60_000 }, { orderId: b.id, amount: 40_000 }] });
  assert.equal((await statusBayar(a.id)).paymentStatus, "LUNAS"); assert.equal(await paidAtIso(a.id), H("2026-09-15").toISOString());
  assert.equal((await statusBayar(b.id)).paymentStatus, "DP");

  const r = await koreksi(w, p.id, { alokasi: [{ orderId: a.id, amount: 40_000 }, { orderId: b.id, amount: 60_000 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await statusBayar(a.id)).paymentStatus, "DP"); assert.equal((await statusBayar(a.id)).paidAt, null);
  assert.equal((await statusBayar(b.id)).paymentStatus, "LUNAS"); assert.equal(await paidAtIso(b.id), H("2026-09-15").toISOString());
  assert.equal(await paidAtIso(lain.id), "2026-07-03T00:00:00.000Z", "order tidak terdampak identik");
});

test("paidAt: Resi beberapa child — semua child LUNAS dengan tanggal pembayaran pelunas; kembali ke DP → null semua", async () => {
  const w = await dunia();
  const { anak, payment } = await resi(w);
  const r1 = await koreksi(w, payment.id, { amount: 1_800_001, tanggal: "2026-09-15" });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  for (const id of anak) { const o = await statusBayar(id); assert.equal(o.paymentStatus, "LUNAS"); assert.equal(o.paidAt.toISOString(), H("2026-09-15").toISOString()); }
  const r2 = await koreksi(w, r1.body.baruId, { amount: 540_000 });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  for (const id of anak) { const o = await statusBayar(id); assert.equal(o.paymentStatus, "DP"); assert.equal(o.paidAt, null); }
});

test("paidAt: pembayaran pada TANGGAL SAMA diurutkan menurut ID (deterministik); edit administratif tidak mengubah paidAt", async () => {
  const w = await dunia();
  const o = await buatOrder({ value: 1_000_000 });
  const pa = await bayar(w, o, { amount: 500_000, createdAt: new Date("2026-09-14T03:00:00Z") });
  const pb = await bayar(w, o, { amount: 500_000, createdAt: new Date("2026-09-14T09:00:00Z") });
  const urut = [pa, pb].sort((x, y) => (x.id < y.id ? -1 : 1));
  const melewati = urut[1]; // pembayaran kedua menurut ID melewati titik lunas
  const sebelum = await paidAtIso(o.id);
  assert.equal(sebelum, melewati.createdAt.toISOString());
  const e = await w.f.post(`/api/finance/pembayaran/${pa.id}/info`, { reason: "referensi", referenceNumber: "REF-9" }, key());
  assert.equal(e.status, 201);
  assert.equal(await paidAtIso(o.id), sebelum, "edit administratif: paidAt identik");
  const k = await koreksi(w, pa.id, { method: "QRIS" });
  assert.equal(k.status, 201);
  const o2 = await statusBayar(o.id);
  assert.equal(o2.paymentStatus, "LUNAS");
  assert.equal(o2.paidAt.toISOString().slice(0, 10), "2026-09-14");
});

// ── Rekonsiliasi DRAF ──────────────────────────────────────────────────────────────────────────────

test("Rekon DRAF_MENUNGGU_MUTASI belum matched: koreksi BOLEH; ringkasan dihitung ulang + audit periode; snapshot immutable tidak berubah; SELESAI & matched tetap blokir", async () => {
  const w = await dunia();
  const o = await buatOrder(); const p = await bayar(w, o, { amount: 300_000, createdAt: H("2026-09-20") });
  const stmt = await testPrisma.finBankStatement.create({ data: { cashAccountId: w.bank.id, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30"), openingBalance: 0, closingBalance: 300_000, status: "DRAF_MENUNGGU_MUTASI", note: "sementara" } });
  const { snapshot } = await testPrisma.$transaction((tx) => buatSnapshot(tx, { statementId: stmt.id, confirmedSource: "uji owner" }));
  const snapAwal = await testPrisma.finReconSnapshot.findUnique({ where: { id: snapshot.id } });

  const pra = await pratinjau(w, p.id, { amount: 350_000 });
  assert.equal(pra.status, 200, JSON.stringify(pra.body));
  assert.equal(pra.body.pratinjau.periodeRekon.length, 1);
  assert.equal(pra.body.pratinjau.periodeRekon[0].saldoBukuSebelum, 300_000); assert.equal(pra.body.pratinjau.periodeRekon[0].saldoBukuSesudah, 350_000);

  const r = await koreksi(w, p.id, { amount: 350_000 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.periodeRekon[0].saldoBukuSesudah, 350_000); assert.equal(r.body.periodeRekon[0].snapshotValid, true);
  const audit = await testPrisma.activityEvent.findFirst({ where: { entityId: stmt.id, entityType: "fin_bank_statement" }, orderBy: { createdAt: "desc" } });
  assert.equal(audit.metadata.label, "Pembayaran dikoreksi setelah periode dibuat");
  assert.equal(audit.metadata.paymentLamaId, p.id); assert.equal(audit.metadata.paymentBaruId, r.body.baruId); assert.equal(audit.metadata.saldoBukuSebelum, 300_000);
  const snapKini = await testPrisma.finReconSnapshot.findUnique({ where: { id: snapshot.id } });
  assert.equal(snapKini.entryHash, snapAwal.entryHash); assert.equal(Number(snapKini.bookBalance), 300_000);
  const st = await testPrisma.finBankStatement.findUnique({ where: { id: stmt.id } });
  const pandangan = await pandanganCutoff(testPrisma, snapKini, { closingBank: st.closingBalance });
  assert.equal(pandangan.valid, true); assert.equal(pandangan.saldoBukuSekarang, 350_000);
  assert.equal(st.status, "DRAF_MENUNGGU_MUTASI", "status periode tidak diubah");

  const jr = (await jurnalPayment(r.body.baruId))[0];
  const baris = jr.lines.find((l) => l.cashAccountId === w.bank.id);
  await testPrisma.finBankStatementLine.create({ data: { statementId: stmt.id, date: new Date("2026-09-20"), description: "TRF", amount: 350_000, matchedLineId: baris.id } });
  const blokirMatch = await koreksi(w, r.body.baruId, { amount: 360_000 });
  assert.equal(blokirMatch.status, 409); assert.equal(blokirMatch.body.code, "SUDAH_DIREKONSILIASI");
  await testPrisma.finBankStatementLine.deleteMany({});
  await testPrisma.finBankStatement.update({ where: { id: stmt.id }, data: { status: "SELESAI" } });
  const blokirSelesai = await koreksi(w, r.body.baruId, { amount: 360_000 });
  assert.equal(blokirSelesai.status, 409); assert.equal(blokirSelesai.body.code, "PERIODE_REKON_SELESAI");
});
