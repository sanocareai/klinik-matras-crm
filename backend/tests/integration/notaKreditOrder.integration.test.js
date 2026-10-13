// NOTA KREDIT / KERINGANAN ORDER — terhadap PostgreSQL sungguhan. Fixture (kasus nyata Sofyan RES-07102026-037 = D):
//   A. KELEBIHAN BAYAR  tagihan 4,0 jt · Payment 4,2 jt · refund 200 rb          → pembayaran bersih 4,0 jt, tetap LUNAS, piutang tidak terbuka
//   B. POTONGAN         tagihan 4,0 jt · Payment 3,8 jt · Owner kurangi 200 rb    → Nota Kredit mandiri: tagihan bersih 3,8 jt, LUNAS
//   C. REFUND BIASA     tagihan 4,0 jt · Payment 3,8 jt · 200 rb dikembalikan     → tetap belum lunas
//   D. POTONGAN SETELAH LUNAS (refund sudah terjurnal) tagihan 4,3 jt · Payment 4,3 jt · refund 200 rb → DP (gejala) → Nota Kredit tertaut refund (tanpa jurnal) → LUNAS
//   E. PKR (kasus Indra PKR-11102026-005): total 7,2 jt · bayar 2,5 jt → tetap "Dibayar sebagian", sisa 4,7 jt; Lunas tidak bisa diisi langsung; nota kredit ditolak
// Plus: pratinjau server (tidak menulis), revisi optimistis, satu nota aktif per refund, replay/paralel/pembatalan, jurnal seimbang, periode tertutup, izin, audit.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postPaymentReceived, postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { recomputeOrderPaymentStatus } from "../../src/services/paymentLedger.js";
import { ringkasOrderPkr } from "../../src/services/penjualanKaryawanOrder.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const LAMPIRAN = `/media/finance-receipts/${"a".repeat(40)}.jpg`;
const kunci = () => ({ "Idempotency-Key": `nk-${randomUUID()}` });
const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
let nomor = 0;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const [admin, fin, sales] = await Promise.all(["ADMIN", "FINANCE", "SALES"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token, { tanpaStepUp: true });
  return { bank, admin, fin, sales, a: c(admin), f: c(fin), s: c(sales) };
}

/** Order + Payment (+ pengakuan pendapatan bila diserahkan). `bayar` = daftar nominal Payment. */
async function order(w, { value, bayar = [], diserahkan = true } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: "Pak Sofyan" } });
  const o = await testPrisma.order.create({ data: { customerId: customer.id, value, category: "LAYANAN", status: diserahkan ? "DELIVERED" : "PROCESSING", orderNumber: `RES-NK-${String(++nomor).padStart(3, "0")}` } });
  const payments = [];
  for (const amount of bayar) {
    const p = await testPrisma.payment.create({ data: { orderId: o.id, amount, method: "TRANSFER", recordedById: w.admin.user.id, cashAccountId: w.bank.id } });
    await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: w.admin.user.id }));
    payments.push(p);
  }
  if (diserahkan) await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: w.admin.user.id }));
  await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, o.id));
  return { o: await testPrisma.order.findUnique({ where: { id: o.id } }), payments };
}
const muat = (id) => testPrisma.order.findUnique({ where: { id } });

async function refund(w, orderId, amount, { fee = false } = {}) {
  const r = await w.a.post("/api/finance/refunds", { orderId, date: hariIni(), amount, reason: "Item tidak jadi dipakai", cashAccountId: w.bank.id, attachmentUrl: LAMPIRAN, ...(fee ? { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" } : {}) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ap = await w.a.post(`/api/finance/refunds/${r.body.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  return r.body;
}
const revisiDari = async (w, orderId) => (await w.f.get(`/api/finance/orders/${orderId}/nota-kredit`)).body.ringkasan.revisi;
/** Buat nota: token revisi diambil dari server (seperti layar) kecuali ditentukan. `revisi: null` = tanpa token. */
async function nota(w, orderId, body, { klien = null, headers = kunci(), revisi } = {}) {
  const rev = revisi === undefined ? await revisiDari(w, orderId) : revisi;
  return (klien ?? w.a).post(`/api/finance/orders/${orderId}/nota-kredit`, { reason: "Potongan harga disepakati Owner", ...body, ...(rev ? { revisi: rev } : {}) }, headers);
}
const batal = async (w, id, orderId, body = {}, { klien = null, headers = kunci(), revisi } = {}) => {
  const rev = revisi === undefined ? await revisiDari(w, orderId) : revisi;
  return (klien ?? w.a).post(`/api/finance/nota-kredit/${id}/batal`, { reason: "Salah nominal", ...body, ...(rev ? { revisi: rev } : {}) }, headers);
};
const ringkas = async (w, orderId) => (await w.f.get(`/api/finance/orders/${orderId}/nota-kredit`)).body.ringkasan;

async function saldoOrder(orderId, systemKey) {
  const a = await testPrisma.finAccount.findUnique({ where: { systemKey } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: a.id, orderId, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
}
async function saldoBank(w) {
  const agg = await testPrisma.finJournalLine.aggregate({ where: { cashAccountId: w.bank.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
}
async function bukuSeimbang() {
  const lines = await testPrisma.finJournalLine.findMany({ select: { debit: true, credit: true } });
  assert.equal(lines.reduce((a, l) => a + Number(l.debit), 0), lines.reduce((a, l) => a + Number(l.credit), 0), "buku besar seimbang");
  for (const e of await testPrisma.finJournalEntry.findMany({ include: { lines: true } })) {
    assert.equal(e.lines.reduce((a, l) => a + Number(l.debit), 0), e.lines.reduce((a, l) => a + Number(l.credit), 0), `jurnal ${e.entryNumber} seimbang`);
  }
}
const potret = async (w, orderId) => ({
  piutang: await saldoOrder(orderId, SYSTEM_KEYS.PIUTANG_USAHA), uangMuka: await saldoOrder(orderId, SYSTEM_KEYS.UANG_MUKA_PELANGGAN), retur: await saldoOrder(orderId, SYSTEM_KEYS.RETUR_PENJUALAN),
  pendapatan: await saldoOrder(orderId, SYSTEM_KEYS.PENDAPATAN_LAYANAN), bank: await saldoBank(w), jurnal: await testPrisma.finJournalEntry.count(),
});
const tanpaTulisan = async () => ({
  nota: await testPrisma.finOrderCredit.count(), jurnal: await testPrisma.finJournalEntry.count(), aktivitas: await testPrisma.activityEvent.count(),
  updated: (await testPrisma.order.findMany({ select: { id: true, updatedAt: true }, orderBy: { id: "asc" } })).map((o) => o.updatedAt.toISOString()).join(),
});

// ═══ A. KELEBIHAN BAYAR ═══
test("A. kelebihan bayar: tagihan 4,0 jt · Payment 4,2 jt · refund 200 rb → pembayaran bersih 4,0 jt, TETAP LUNAS; piutang tidak terbuka kembali; paidAt tidak bergeser; nota kredit tidak dipakai", async () => {
  const w = await dunia();
  const { o } = await order(w, { value: 4_000_000, bayar: [4_200_000] });
  assert.equal((await muat(o.id)).paymentStatus, "LUNAS");
  const awal = await muat(o.id);
  assert.ok(awal.paidAt, "paidAt terisi saat lunas");
  await refund(w, o.id, 200_000);
  const r = await ringkas(w, o.id);
  assert.deepEqual([r.tagihanBersih, r.diterima, r.refundDisetujui, r.pembayaranBersih, r.sisa, r.statusServer, r.statusTersimpan, r.cocok], [4_000_000, 4_200_000, 200_000, 4_000_000, 0, "LUNAS", "LUNAS", true]);
  assert.equal((await muat(o.id)).paidAt?.toISOString(), awal.paidAt.toISOString(), "paidAt tidak bergeser oleh refund kelebihan bayar");
  assert.equal(await saldoOrder(o.id, SYSTEM_KEYS.PIUTANG_USAHA), 0, "piutang tidak terbuka kembali");
  const salah = await nota(w, o.id, { amount: 200_000 });
  assert.equal(salah.status, 409); assert.equal(salah.body.code, "MELEBIHI_SISA_PIUTANG");
  const kand = (await w.f.get(`/api/finance/orders/${o.id}/nota-kredit`)).body.refundKandidat;
  assert.equal(kand.length, 1); assert.equal(kand[0].nominal, 200_000);
  await bukuSeimbang();
});

// ═══ B. POTONGAN / KERINGANAN ═══
test("B. potongan: tagihan 4,0 jt · Payment 3,8 jt · Owner kurangi 200 rb → Nota Kredit mandiri (Dr Retur & Potongan / Cr Piutang): tagihan bersih 3,8 jt, LUNAS; paidAt = tanggal pembayaran; Kas/Bank tidak berubah", async () => {
  const w = await dunia();
  const { o, payments } = await order(w, { value: 4_000_000, bayar: [3_800_000] });
  assert.equal((await muat(o.id)).paymentStatus, "DP");
  assert.equal((await muat(o.id)).paidAt, null);
  const sebelum = await potret(w, o.id);
  assert.equal(sebelum.piutang, 200_000);

  // izin & pagar input
  assert.equal((await nota(w, o.id, { amount: 200_000 }, { klien: w.f })).status, 403, "Finance biasa");
  assert.equal((await nota(w, o.id, { amount: 200_000 }, { klien: w.s })).status, 403, "Sales");
  assert.equal((await w.a.post(`/api/finance/orders/${o.id}/nota-kredit`, { amount: 200_000, reason: "Potongan harga disepakati", revisi: await revisiDari(w, o.id) })).status, 428, "tanpa Idempotency-Key");
  assert.equal((await nota(w, o.id, { amount: 200_000, reason: "abc" })).body.code, "ALASAN_WAJIB");
  assert.equal((await nota(w, o.id, { amount: 0 })).status, 400);
  assert.equal((await nota(w, o.id, { amount: 200_000, kind: "DISKON_LIAR" })).body.code, "JENIS_TIDAK_VALID");
  assert.equal((await nota(w, o.id, { amount: 200_000 }, { revisi: null })).body.code, "REVISI_WAJIB");
  assert.equal((await nota(w, o.id, { amount: 200_000 }, { revisi: "usang00000000000000000" })).body.code, "REVISI_BERUBAH");
  assert.equal((await nota(w, o.id, { amount: 200_000, date: "2099-01-01" })).body.code, "TANGGAL_MASA_DEPAN");
  assert.equal((await nota(w, o.id, { amount: 200_000, date: "kemarin" })).body.code, "TANGGAL_TIDAK_VALID");
  assert.equal(await testPrisma.finOrderCredit.count(), 0, "percobaan gagal tidak meninggalkan dokumen");

  const r = await nota(w, o.id, { amount: 200_000 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.nomor, /^NK-\d{8}-\d{3}$/);
  assert.deepEqual([r.body.sebelum.tagihanBersih, r.body.sebelum.sisa, r.body.sebelum.status, r.body.sesudah.tagihanBersih, r.body.sesudah.sisa, r.body.sesudah.status], [4_000_000, 200_000, "DP", 3_800_000, 0, "LUNAS"]);
  assert.equal(r.body.sumber, "MANDIRI");
  const sesudah = await potret(w, o.id);
  assert.equal(sesudah.piutang, 0, "piutang order nol"); assert.equal(sesudah.retur - sebelum.retur, 200_000); assert.equal(sesudah.bank, sebelum.bank, "tidak menyentuh kas/bank");
  assert.equal(sesudah.pendapatan, sebelum.pendapatan, "pendapatan bruto tidak diubah surut"); assert.equal(sesudah.jurnal, sebelum.jurnal + 1, "tepat satu jurnal");
  const jn = await testPrisma.finJournalEntry.findFirst({ where: { source: "NOTA_KREDIT_ORDER" }, include: { lines: { include: { account: true } } } });
  assert.deepEqual(jn.lines.map((l) => [l.account.systemKey, Number(l.debit), Number(l.credit)]).sort(), [["PIUTANG_USAHA", 0, 200_000], ["RETUR_PENJUALAN", 200_000, 0]].sort());
  assert.ok(jn.lines.every((l) => !l.cashAccountId), "nota kredit tidak pernah menyentuh rekening kas/bank");
  const dok = await muat(o.id);
  assert.equal(dok.paymentStatus, "LUNAS");
  assert.equal(dok.paidAt.toISOString().slice(0, 10), payments[0].createdAt.toISOString().slice(0, 10), "paidAt = tanggal pembayaran yang menutup tagihan bersih (bukan waktu nota)");
  const log = await testPrisma.activityEvent.findFirst({ where: { entityType: "order", entityId: o.id, eventType: "DOCUMENT_POSTED" }, orderBy: { createdAt: "desc" } });
  assert.equal(log.metadata.aksi, "nota_kredit_dibuat"); assert.equal(log.actorId, w.admin.user.id); assert.equal(log.metadata.sebelum.status, "DP"); assert.equal(log.metadata.sesudah.status, "LUNAS"); assert.equal(log.metadata.jumlah, "200000.00");
  const dokNota = (await w.f.get(`/api/finance/orders/${o.id}/nota-kredit`)).body.notaKredit[0];
  assert.deepEqual([dokNota.sumber, dokNota.status, dokNota.tanggal.slice(0, 10), dokNota.keteranganJurnal], ["MANDIRI", "AKTIF", hariIni(), null]);
  await bukuSeimbang();
});

test("B. tanggal nota: boleh hari ini; tidak boleh sebelum pengakuan pendapatan", async () => {
  const w = await dunia();
  const { o } = await order(w, { value: 1_000_000, bayar: [800_000] });
  assert.equal((await nota(w, o.id, { amount: 50_000, date: "2020-01-01" })).body.code, "TANGGAL_SEBELUM_PENGAKUAN");
  const r = await nota(w, o.id, { amount: 50_000, date: hariIni() });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

test("B. nota melebihi tagihan bersih atau sisa piutang ditolak; beberapa nota berjumlah ≤ sisa; pembatalan membalik jurnal dan mengembalikan status DP", async () => {
  const w = await dunia();
  const { o } = await order(w, { value: 4_000_000, bayar: [3_500_000] });
  assert.equal((await nota(w, o.id, { amount: 600_000 })).body.code, "MELEBIHI_SISA_PIUTANG", "sisa piutang hanya 500 rb");
  assert.equal((await nota(w, o.id, { amount: 4_500_000 })).body.code, "MELEBIHI_TAGIHAN");
  const n1 = await nota(w, o.id, { amount: 300_000 });
  assert.equal(n1.status, 201);
  assert.equal((await muat(o.id)).paymentStatus, "DP");
  assert.equal((await ringkas(w, o.id)).sisa, 200_000);
  const n2 = await nota(w, o.id, { amount: 200_000, kind: "KERINGANAN" });
  assert.equal(n2.status, 201);
  assert.equal((await muat(o.id)).paymentStatus, "LUNAS");
  assert.equal((await nota(w, o.id, { amount: 1 })).status, 409, "piutang sudah nol");

  const jurnal = await testPrisma.finJournalEntry.count();
  assert.equal((await batal(w, n1.body.id, o.id)).status, 200);
  assert.equal(await testPrisma.finJournalEntry.count(), jurnal + 1, "satu jurnal pembalik (bukan hapus)");
  const row = await testPrisma.finOrderCredit.findUnique({ where: { id: n1.body.id } });
  assert.deepEqual([row.status, !!row.reversalJournalId, row.cancelReason], ["DIBATALKAN", true, "Salah nominal"]);
  assert.equal((await muat(o.id)).paymentStatus, "DP");
  assert.equal((await muat(o.id)).paidAt, null, "keluar dari LUNAS → paidAt null");
  assert.equal((await ringkas(w, o.id)).notaKredit, 200_000, "hanya nota aktif yang dihitung");
  assert.equal((await batal(w, n1.body.id, o.id)).status, 409, "pembatalan ganda ditolak");
  assert.equal((await batal(w, n2.body.id, o.id, {}, { klien: w.f })).status, 403);
  assert.equal((await batal(w, n2.body.id, o.id, { reason: "abc" })).body.code, "ALASAN_WAJIB");
  assert.equal((await batal(w, n2.body.id, o.id, {}, { revisi: null })).body.code, "REVISI_WAJIB");
  await bukuSeimbang();
});

// ═══ C. REFUND BIASA ═══
test("C. refund biasa: tagihan 4,0 jt · Payment 3,8 jt · 200 rb dikembalikan → pembayaran bersih 3,6 jt, TETAP belum lunas (DP); nota kredit tidak mengubah sifat refund", async () => {
  const w = await dunia();
  const { o } = await order(w, { value: 4_000_000, bayar: [3_800_000] });
  await refund(w, o.id, 200_000);
  const r = await ringkas(w, o.id);
  assert.deepEqual([r.tagihanBersih, r.pembayaranBersih, r.sisa, r.statusServer, r.statusTersimpan], [4_000_000, 3_600_000, 400_000, "DP", "DP"]);
  assert.equal((await muat(o.id)).paidAt, null);
  const n = await nota(w, o.id, { amount: 200_000 });
  assert.equal(n.status, 201, JSON.stringify(n.body));
  const sesudah = await ringkas(w, o.id);
  assert.deepEqual([sesudah.tagihanBersih, sesudah.pembayaranBersih, sesudah.sisa, sesudah.statusTersimpan], [3_800_000, 3_600_000, 200_000, "DP"], "uang yang sudah dikembalikan tetap kurang dari tagihan bersih → belum lunas");
  await bukuSeimbang();
});

// ═══ D. POTONGAN SETELAH LUNAS (kasus Sofyan) ═══
test("D. kasus Sofyan: tagihan 4,3 jt · Payment 4,3 jt · refund 200 rb → DP (gejala); nota mandiri DITOLAK (piutang 0); nota TERTAUT refund → LUNAS tanpa jurnal baru; jurnal/kas/piutang/pendapatan/refund tidak berubah; pembatalan mengembalikan keadaan", async () => {
  const w = await dunia();
  const { o, payments } = await order(w, { value: 4_300_000, bayar: [4_300_000] });
  assert.equal((await muat(o.id)).paymentStatus, "LUNAS");
  const rf = await refund(w, o.id, 200_000, { fee: true });
  assert.equal((await muat(o.id)).paymentStatus, "DP", "gejala: refund diverifikasi, order kembali DP");
  assert.equal((await muat(o.id)).paidAt, null);
  const gejala = await ringkas(w, o.id);
  assert.deepEqual([gejala.nilaiOrder, gejala.diterima, gejala.refundDisetujui, gejala.pembayaranBersih, gejala.tagihanBersih, gejala.sisa], [4_300_000, 4_300_000, 200_000, 4_100_000, 4_300_000, 200_000]);
  assert.equal(await saldoOrder(o.id, SYSTEM_KEYS.PIUTANG_USAHA), 0, "buku besar: tidak ada piutang — hanya status CRM yang beda");

  const mandiri = await nota(w, o.id, { amount: 200_000 });
  assert.equal(mandiri.status, 409); assert.equal(mandiri.body.code, "MELEBIHI_SISA_PIUTANG"); assert.match(mandiri.body.error, /tautkan nota kredit ke refund/);

  const sebelum = await potret(w, o.id);
  const t = await nota(w, o.id, { amount: 200_000, refundId: rf.id, reason: "Triplek tidak jadi dipakai — potongan atas tagihan" });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(t.body.sumber, "TERTAUT_REFUND"); assert.equal(t.body.jurnal, null);
  assert.deepEqual([t.body.sebelum.status, t.body.sesudah.status, t.body.sesudah.tagihanBersih, t.body.sesudah.pembayaranBersih, t.body.sesudah.sisa], ["DP", "LUNAS", 4_100_000, 4_100_000, 0]);
  assert.deepEqual(await potret(w, o.id), sebelum, "TIDAK ada jurnal baru; kas, piutang, pendapatan, retur tidak berubah");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "NOTA_KREDIT_ORDER" } }), 0);
  const kredit = await testPrisma.finOrderCredit.findFirst({ where: { orderId: o.id } });
  assert.deepEqual([kredit.refundId, kredit.journalId, kredit.status], [rf.id, null, "AKTIF"]);
  const dok = await muat(o.id);
  assert.equal(dok.paymentStatus, "LUNAS");
  assert.equal(dok.paidAt.toISOString().slice(0, 10), payments[0].createdAt.toISOString().slice(0, 10), "paidAt = tanggal pembayaran (ledger), bukan hari nota dibuat");
  assert.equal(Number((await testPrisma.finRefund.findUnique({ where: { id: rf.id } })).amount), 200_000, "refund tidak diubah");
  const daftar = (await w.f.get(`/api/finance/orders/${o.id}/nota-kredit`)).body;
  assert.equal(daftar.notaKredit[0].keteranganJurnal, "Tanpa jurnal — sudah dicatat oleh refund");
  assert.equal(daftar.refundKandidat[0].tertautNota, kredit.creditNumber); assert.equal(daftar.refundKandidat[0].layak, false);
  const listRefund = (await w.f.get("/api/finance/refunds")).body.refunds.find((x) => x.id === rf.id);
  assert.equal(listRefund.notaKredit, kredit.creditNumber, "daftar refund memuat nomor nota kredit aktif yang tertaut");

  // refund tidak bisa dibatalkan/dikoreksi sementara tertaut nota aktif
  const batalRefund = await w.a.post(`/api/finance/refunds/${rf.id}/cancel`, { reason: "salah" });
  assert.equal(batalRefund.status, 409); assert.match(batalRefund.body.error, /nota kredit aktif/);
  const rev = (await testPrisma.finRefund.findUnique({ where: { id: rf.id } })).updatedAt.toISOString();
  const kor = await w.a.post(`/api/finance/refunds/${rf.id}/koreksi`, { reason: "Nominal disepakati ulang", amount: 150_000, bukti: { mode: "LAMA" }, expectedUpdatedAt: rev }, kunci());
  assert.equal(kor.status, 409); assert.equal(kor.body.code, "NOTA_KREDIT_TERTAUT");
  // pembatalan nota → kembali DP, jurnal tidak berubah
  assert.equal((await batal(w, kredit.id, o.id)).status, 200);
  assert.equal((await muat(o.id)).paymentStatus, "DP"); assert.equal((await muat(o.id)).paidAt, null);
  assert.deepEqual(await potret(w, o.id), sebelum, "membatalkan nota tertaut tidak menyentuh buku besar");
  await bukuSeimbang();
});

test("D. satu nota aktif per refund: nominal ≤ potongan refund; nota kedua ditolak (dan DB menolak walau aplikasi dilewati); setelah dibatalkan boleh ditautkan lagi; refund lain order / bukan potongan ditolak; replay tidak menggandakan", async () => {
  const w = await dunia();
  const { o } = await order(w, { value: 4_300_000, bayar: [4_300_000] });
  const rf = await refund(w, o.id, 200_000);
  assert.equal((await nota(w, o.id, { amount: 250_000, refundId: rf.id })).body.code, "MELEBIHI_REFUND");
  const h = kunci();
  const rev0 = await revisiDari(w, o.id); // percobaan ulang jaringan mengirim ULANG badan yang sama (termasuk token revisi lama)
  const a = await nota(w, o.id, { amount: 150_000, refundId: rf.id }, { headers: h, revisi: rev0 });
  const b = await nota(w, o.id, { amount: 150_000, refundId: rf.id }, { headers: h, revisi: rev0 });
  assert.equal(a.status, 201); assert.equal(b.status, 201); assert.equal(b.headers.get("idempotent-replayed"), "true"); assert.equal(b.body.id, a.body.id);
  assert.equal(await testPrisma.finOrderCredit.count(), 1, "replay = satu dokumen");
  assert.equal((await nota(w, o.id, { amount: 50_000, refundId: rf.id })).body.code, "REFUND_SUDAH_TERTAUT");
  await assert.rejects(
    testPrisma.finOrderCredit.create({ data: { creditNumber: "NK-X-001", orderId: o.id, amount: 1000, reason: "uji db", refundId: rf.id, creditDate: new Date(), idempotencyKey: `db-${randomUUID()}` } }),
    /Unique constraint|unique/i, "indeks parsial DB menolak nota aktif kedua pada refund yang sama");
  assert.equal((await batal(w, a.body.id, o.id)).status, 200);
  assert.equal((await nota(w, o.id, { amount: 200_000, refundId: rf.id })).status, 201, "setelah dibatalkan boleh ditautkan lagi");
  const lain = await order(w, { value: 1_000_000, bayar: [1_000_000] });
  assert.equal((await nota(w, lain.o.id, { amount: 10_000, refundId: rf.id })).body.code, "REFUND_TIDAK_ADA");
  assert.equal((await nota(w, o.id, { amount: 1, refundId: "bukan-uuid" })).status, 400);
  // refund sebelum order diserahkan (Dr Uang Muka) bukan potongan atas tagihan; order belum diserahkan ditolak
  const dp = await order(w, { value: 2_000_000, bayar: [2_000_000], diserahkan: false });
  const rfDp = await refund(w, dp.o.id, 100_000);
  assert.equal((await nota(w, dp.o.id, { amount: 50_000, refundId: rfDp.id })).body.code, "PENDAPATAN_BELUM_DIAKUI");
  await bukuSeimbang();
});

test("pengaman: order belum diserahkan, order tidak ada; paralel dua nota atas sisa 200 rb → satu berhasil; periode tertutup memblokir nota mandiri tanpa dokumen setengah jadi", async () => {
  const w = await dunia();
  const belum = await order(w, { value: 1_000_000, bayar: [500_000], diserahkan: false });
  assert.equal((await nota(w, belum.o.id, { amount: 100_000 })).body.code, "PENDAPATAN_BELUM_DIAKUI");
  assert.equal((await nota(w, "cmtidakadaxxxxxxxxxxxxxx", { amount: 100_000 }, { revisi: "x" })).status, 404);

  const { o } = await order(w, { value: 4_000_000, bayar: [3_800_000] });
  const rev = await revisiDari(w, o.id);
  const [x, y] = await Promise.all([nota(w, o.id, { amount: 150_000 }, { revisi: rev }), nota(w, o.id, { amount: 150_000 }, { revisi: rev })]);
  assert.deepEqual([x.status, y.status].sort(), [201, 409], JSON.stringify([x.body, y.body]));
  assert.equal(await testPrisma.finOrderCredit.count({ where: { orderId: o.id } }), 1);
  assert.equal(await saldoOrder(o.id, SYSTEM_KEYS.PIUTANG_USAHA), 50_000);

  const d = new Date(Date.now() + 7 * 3600 * 1000);
  await testPrisma.finPeriod.upsert({ where: { year_month: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 } }, update: { status: "CLOSED" }, create: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, status: "CLOSED" } });
  const jumlah = await testPrisma.finOrderCredit.count();
  const tutup = await nota(w, o.id, { amount: 50_000 });
  assert.ok(tutup.status >= 400, `periode tertutup → ${tutup.status}`);
  assert.equal(await testPrisma.finOrderCredit.count(), jumlah, "tidak ada dokumen setengah jadi");
});

// ═══ Pratinjau server ═══
test("pratinjau: dampak dihitung server dengan jalur yang sama, TIDAK menulis apa pun (nota, jurnal, audit, order), dan sama persis dengan hasil simpan", async () => {
  const w = await dunia();
  const { o } = await order(w, { value: 4_000_000, bayar: [3_800_000] });
  const awal = await tanpaTulisan();
  const q = `amount=200000&kind=POTONGAN_HARGA&date=${hariIni()}`;
  const p = await w.a.get(`/api/finance/orders/${o.id}/nota-kredit/pratinjau?${q}`);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.deepEqual([p.body.sumber, p.body.sebelum.status, p.body.sesudah.status, p.body.sebelum.tagihanBersih, p.body.sesudah.tagihanBersih, p.body.sesudah.sisa], ["MANDIRI", "DP", "LUNAS", 4_000_000, 3_800_000, 0]);
  assert.deepEqual(p.body.jurnal.baris.map((b) => [b.akun, b.debit, b.kredit]), [["4-2100 Retur & Potongan Penjualan", "200000.00", "0.00"], ["1-1300 Piutang Usaha", "0.00", "200000.00"]]);
  assert.ok(p.body.sesudah.paidAt, "paidAt yang akan terbentuk ditampilkan");
  assert.deepEqual(await tanpaTulisan(), awal, "pratinjau tidak menulis apa pun");
  const salah = await w.a.get(`/api/finance/orders/${o.id}/nota-kredit/pratinjau?amount=900000`);
  assert.equal(salah.status, 409); assert.equal(salah.body.code, "MELEBIHI_SISA_PIUTANG");
  assert.equal((await w.f.get(`/api/finance/orders/${o.id}/nota-kredit/pratinjau?${q}`)).status, 403, "pratinjau hanya Admin Finance");
  const simpan = await nota(w, o.id, { amount: 200_000 }, { revisi: p.body.revisi });
  assert.equal(simpan.status, 201);
  assert.deepEqual(simpan.body.sesudah, p.body.sesudah);
  const awal2 = await tanpaTulisan();
  const pb = await w.a.get(`/api/finance/nota-kredit/${simpan.body.id}/pratinjau-batal`);
  assert.equal(pb.status, 200, JSON.stringify(pb.body));
  assert.deepEqual([pb.body.sebelum.status, pb.body.sesudah.status, pb.body.sesudah.sisa, pb.body.jurnalDibalik], ["LUNAS", "DP", 200_000, true]);
  assert.deepEqual(await tanpaTulisan(), awal2, "pratinjau pembatalan tidak menulis apa pun");
  assert.equal((await batal(w, simpan.body.id, o.id, {}, { revisi: p.body.revisi })).body.code, "REVISI_BERUBAH", "token dari pratinjau lama sudah basi");
});

test("revisi optimistis: pembayaran baru setelah layar dibuka → simpan ditolak 409 REVISI_BERUBAH, tanpa dokumen", async () => {
  const w = await dunia();
  const { o } = await order(w, { value: 4_000_000, bayar: [3_000_000] });
  const rev = await revisiDari(w, o.id);
  const p2 = await testPrisma.payment.create({ data: { orderId: o.id, amount: 500_000, method: "TRANSFER", recordedById: w.admin.user.id, cashAccountId: w.bank.id } });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p2.id, userId: w.admin.user.id }));
  await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, o.id));
  const r = await nota(w, o.id, { amount: 100_000 }, { revisi: rev });
  assert.equal(r.status, 409); assert.equal(r.body.code, "REVISI_BERUBAH");
  assert.equal(await testPrisma.finOrderCredit.count(), 0);
  assert.equal((await nota(w, o.id, { amount: 100_000 })).status, 201, "dengan token terbaru berhasil");
});

// ═══ E. PKR (kasus Indra PKR-11102026-005) ═══
test("E. Indra: PKR 7,2 jt · bayar 2,5 jt → 'Dibayar sebagian', sisa 4,7 jt; Lunas tidak bisa diisi langsung; nota kredit ditolak; tidak ada refund Rp200.000", async () => {
  const w = await dunia();
  const kemal = await createTestUser({ roles: ["ADMIN"] });
  const pkr = await testPrisma.finPenjualanKaryawan.create({ data: { nomor: "PKR-11102026-005", date: new Date("2026-10-11"), sellerId: kemal.user.id, buyerName: "Bpk. Indra", total: 7_200_000, status: "AKTIF", createdById: kemal.user.id } });
  const customer = await testPrisma.customer.create({ data: { name: "Kemal" } });
  const o = await testPrisma.order.create({ data: { customerId: customer.id, value: 0, category: "BARU", status: "PROCESSING", orderNumber: "NEW-11102026-023", penjualanKaryawanId: pkr.id } });
  await testPrisma.finPenjualanKaryawanPayment.create({ data: { penjualanId: pkr.id, date: new Date("2026-10-11"), amount: 2_500_000, method: "TRANSFER", notes: "DP", createdById: kemal.user.id } });

  const pem = (await ringkasOrderPkr(testPrisma, [pkr.id])).get(pkr.id).pembayaran;
  assert.deepEqual([pem.status, pem.label, pem.total, pem.terbayar, pem.sisa], ["SEBAGIAN", "Dibayar sebagian", 7_200_000, 2_500_000, 4_700_000]);
  assert.equal((await muat(o.id)).paymentStatus, "BELUM_BAYAR", "Order CRM tidak membaca ledger PKR (nilai order 0)");

  const lunas = await w.a.patch(`/api/orders/${o.id}`, { paymentStatus: "LUNAS" });
  assert.notEqual((await muat(o.id)).paymentStatus, "LUNAS", `Lunas manual tidak berlaku (status HTTP ${lunas.status})`);
  const n = await nota(w, o.id, { amount: 200_000 });
  assert.equal(n.status, 409); assert.equal(n.body.code, "ORDER_PKR");
  assert.equal(await testPrisma.finOrderCredit.count(), 0);
  assert.equal(await testPrisma.finRefund.count({ where: { orderId: o.id } }), 0, "tidak ada refund Rp200.000 pada order ini");
});

test("ringkasan server (GET): satu sumber untuk layar & audit — tagihan kotor/bersih, diterima, refund, pembayaran bersih, sisa, status server vs tersimpan, revisi; hanya finance:read", async () => {
  const w = await dunia();
  const { o } = await order(w, { value: 4_300_000, bayar: [4_300_000] });
  await refund(w, o.id, 200_000);
  const g = await w.f.get(`/api/finance/orders/${o.id}/nota-kredit`);
  assert.equal(g.status, 200);
  assert.deepEqual(Object.keys(g.body.ringkasan).sort(), ["cocok", "diterima", "nilaiOrder", "nomor", "notaKredit", "orderId", "paidAt", "pelanggan", "pembayaranBersih", "refundDisetujui", "revisi", "sisa", "statusServer", "statusTersimpan", "tagihanBersih", "tagihanKotor"].sort());
  assert.equal(g.body.ringkasan.cocok, true);
  assert.equal((await w.s.get(`/api/finance/orders/${o.id}/nota-kredit`)).status, 403);
  assert.equal((await w.f.get("/api/finance/orders/tidak-ada/nota-kredit")).status, 404);
});
