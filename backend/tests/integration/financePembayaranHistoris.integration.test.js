// PENUNTASAN PEMBAYARAN HISTORIS SEBELUM SALDO AWAL (Owner 29 Sep 2026; cutoff 18 Sep 2026 WIB). Yang dikunci:
//  - Kasus Wilson (Bank PT Sano, order diserahkan tapi pendapatan tak pernah dijurnal) & KEM (pendapatan diakui, kredit Piutang): jurnal Bank dibalik,
//    Payment diganti versi terverifikasi tanpa rekening, jurnal pengganti sesuai LEDGER (C1 tanpa jurnal / C2 Piutang / C3 Uang Muka), saldo Bank kembali.
//  - Klasifikasi C1/C2/C3/C4 + idempotensi (delta nol) + request paralel + jurnal seimbang + audit.
//  - Guard cutoff permanen: Payment sebelum cutoff tidak membuat jurnal Bank; 18 Sep dan sesudahnya tetap; koreksi umum diblokir; rekonsiliasi memblokir.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal } from "../../src/services/finance/journal.js";
import { postPaymentReceived, postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { blokirKoreksiBatch } from "../../src/services/finance/koreksiPembayaran.js";
import { koreksiPembayaran } from "../../src/services/finance/koreksiPembayaran.js";
import {
  koreksiPembayaranHistoris, tuntaskanPembayaranHistoris, daftarKlasifikasiHistoris, klasifikasiPembayaranHistoris, KODE_HISTORIS,
} from "../../src/services/finance/pembayaranHistoris.js";
import { recomputeOrderPaymentStatus } from "../../src/services/paymentLedger.js";

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

let n = 0;
const ALASAN = "Historis — tercakup saldo awal, dikonfirmasi Owner/CFO";

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const pt = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const kem = await testPrisma.finCashAccount.create({ data: { name: "KEM - Sano Bank", kind: "BANK", accountId: akunBank.id } });
  const finance = (await createTestUser({ roles: ["FINANCE"] })).user;
  const sales = (await createTestUser({ roles: ["SALES"] })).user;
  return { pt, kem, finance, sales };
}

async function buatOrder({ value = 1_900_000, status = "DELIVERED", nama = "Wilson" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: nama } });
  return testPrisma.order.create({ data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `NEW-UJI-${String(++n).padStart(3, "0")}`, status, paymentStatus: "LUNAS" } });
}

/** Payment terverifikasi TANPA jurnal (kasus 58 pembayaran historis). */
async function payment(w, order, { amount, createdAt, cashAccountId = null }) {
  const p = await testPrisma.payment.create({ data: { orderId: order.id, amount, method: "TRANSFER", cashAccountId, recordedById: w.sales.id, createdAt } });
  await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: w.finance.id } });
  return p;
}

/** Payment terverifikasi + jurnal Bank yang SALAH (kas terhitung dua kali) — dibuat manual karena guard cutoff menolak posting umum. */
async function bankGanda(w, order, { amount, createdAt, rek, lawan = "UANG_MUKA" }) {
  const p = await payment(w, order, { amount, createdAt, cashAccountId: rek.id });
  const akunLawan = await testPrisma.finAccount.findUnique({ where: { systemKey: lawan === "PIUTANG" ? SYSTEM_KEYS.PIUTANG_USAHA : SYSTEM_KEYS.UANG_MUKA_PELANGGAN } });
  await testPrisma.$transaction(async (tx) => {
    await postJournal(tx, {
      date: new Date(Date.UTC(createdAt.getUTCFullYear(), createdAt.getUTCMonth(), createdAt.getUTCDate())), description: `Penerimaan pembayaran order ${order.orderNumber}`, source: "PEMBAYARAN_ORDER",
      sourceId: p.id, idempotencyKey: `PEMBAYARAN_ORDER:${p.id}`, userId: w.finance.id,
      lines: [
        { accountId: rek.accountId, cashAccountId: rek.id, debit: amount, orderId: order.id },
        { accountId: akunLawan.id, credit: amount, orderId: order.id, customerId: order.customerId },
      ],
    });
    await recomputeOrderPaymentStatus(tx, order.id);
  });
  return p;
}

async function saldoAkun(systemKey, orderId = null) {
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey } });
  const baris = await testPrisma.finJournalLine.findMany({ where: { accountId: akun.id, ...(orderId ? { orderId } : {}), entry: { status: { in: ["POSTED", "REVERSED"] } } } });
  return baris.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
}
async function saldoRek(rek) {
  const baris = await testPrisma.finJournalLine.findMany({ where: { cashAccountId: rek.id, entry: { status: { in: ["POSTED", "REVERSED"] } } } });
  return baris.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
}
async function seimbang() {
  const a = await testPrisma.finJournalLine.aggregate({ where: { entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(a._sum.debit ?? 0) === Number(a._sum.credit ?? 0);
}
const jurnal = (id) => testPrisma.finJournalEntry.findMany({ where: { source: "PEMBAYARAN_ORDER", sourceId: id }, include: { lines: { include: { account: { select: { systemKey: true } } } } }, orderBy: { createdAt: "asc" } });
const koreksiH = (w, id) => testPrisma.$transaction((tx) => koreksiPembayaranHistoris(tx, { paymentId: id, userId: w.finance.id, alasan: ALASAN }));
const tuntaskan = (w, id) => testPrisma.$transaction((tx) => tuntaskanPembayaranHistoris(tx, { paymentId: id, userId: w.finance.id, alasan: ALASAN }));
const rt = (d) => new Date(`${d}T05:00:00Z`); // jam 12 WIB

test("WILSON: order DELIVERED tanpa pengakuan pendapatan + jurnal Bank salah → jurnal dibalik, Payment diganti tanpa rekening, saldo Bank & Uang Muka kembali 0, tanpa jurnal pengganti (C1)", async () => {
  const w = await dunia();
  const order = await buatOrder({ value: 1_900_000 });
  const lama = await bankGanda(w, order, { amount: 1_900_000, createdAt: rt("2026-09-03"), rek: w.pt });
  assert.equal(await saldoRek(w.pt), 1_900_000);
  assert.equal(await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN), -1_900_000);

  const r = await koreksiH(w, lama.id);
  assert.equal(r.ok, true);
  assert.equal(r.klasifikasi, KODE_HISTORIS);
  assert.equal(r.jurnalPengganti, null, "C1: tidak ada jurnal pengganti (tidak ada Piutang/Uang Muka untuk ditutup)");

  assert.equal(await saldoRek(w.pt), 0, "saldo PT Sano turun tepat Rp1.900.000");
  assert.equal(await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN), 0, "Uang Muka palsu hilang");
  assert.equal(await saldoAkun(SYSTEM_KEYS.LABA_DITAHAN), 0);
  const js = await jurnal(lama.id);
  assert.equal(js.length, 1);
  assert.equal(js[0].status, "REVERSED", "jurnal lama tetap ada, berstatus dibalik");
  const pembalik = await testPrisma.finJournalEntry.findMany({ where: { reversalOfId: js[0].id } });
  assert.equal(pembalik.length, 1);
  assert.equal(pembalik[0].status, "POSTED");
  assert.equal(pembalik[0].date.toISOString().slice(0, 10), "2026-09-03", "pembalik bertanggal sama dengan jurnal asli");
  assert.equal(await seimbang(), true);

  const pl = await testPrisma.payment.findUnique({ where: { id: lama.id }, include: { replacedBy: true } });
  assert.ok(pl.cancelledAt && pl.cancelReason.startsWith("Dikoreksi"), "Payment lama ditandai dikoreksi");
  const baru = await testPrisma.payment.findUnique({ where: { id: pl.replacedBy.id }, include: { verifications: true } });
  assert.equal(baru.cashAccountId, null, "versi pengganti tanpa rekening");
  assert.equal(baru.amount, 1_900_000);
  assert.equal(baru.createdAt.toISOString(), lama.createdAt.toISOString(), "tanggal terima sama");
  assert.equal(baru.verifications.length, 1, "tetap terverifikasi");
  assert.equal(baru.replacesPaymentId, lama.id);

  const o = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.equal(o.paymentStatus, "LUNAS");
  assert.equal(o.paidAt.toISOString().slice(0, 10), "2026-09-03", "paidAt = tanggal pembayaran pelunas, bukan waktu koreksi");
  const ev = await testPrisma.activityEvent.findMany({ where: { entityId: { in: [lama.id, baru.id] } } });
  assert.equal(ev.filter((e) => e.metadata.aksi === "koreksi_pembayaran_historis").length, 2, "audit di kedua versi");
  assert.equal(ev[0].metadata.reason, ALASAN);

  // Ulang = ditolak (sudah diganti); tidak ada perubahan buku.
  await assert.rejects(koreksiH(w, lama.id), (e) => e.statusCode === 409);
  assert.equal(await saldoRek(w.pt), 0);
  assert.equal((await jurnal(lama.id)).length, 1);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { reversalOfId: { not: null } } }), 1, "tetap satu pembalik");
});

test("KEM: pendapatan sudah diakui, jurnal Bank salah mengkredit Piutang → Bank kembali 0; pengganti Dr Laba Ditahan / Cr Piutang tertaut ke Payment versi pengganti (C2)", async () => {
  const w = await dunia();
  const order = await buatOrder({ value: 1_750_000, nama: "KEM Cust" });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: w.finance.id }));
  const lama = await bankGanda(w, order, { amount: 1_750_000, createdAt: rt("2026-09-15"), rek: w.kem, lawan: "PIUTANG" });
  assert.equal(await saldoAkun(SYSTEM_KEYS.PIUTANG_USAHA, order.id), 0);

  const r = await koreksiH(w, lama.id);
  assert.equal(r.klasifikasi, "PIUTANG_TERBUKA");
  assert.ok(r.jurnalPengganti);
  assert.equal(await saldoRek(w.kem), 0, "saldo KEM turun tepat Rp1.750.000");
  assert.equal(await saldoAkun(SYSTEM_KEYS.PIUTANG_USAHA, order.id), 0, "piutang order tetap tertutup, tidak terhitung dua kali");
  assert.equal(await saldoAkun(SYSTEM_KEYS.LABA_DITAHAN), 1_750_000, "lawan = Laba Ditahan (didebit)");
  const pl = await testPrisma.payment.findUnique({ where: { id: lama.id }, include: { replacedBy: true } });
  const jb = await jurnal(pl.replacedBy.id);
  assert.equal(jb.length, 1, "jurnal pengganti tertaut ke Payment versi pengganti");
  assert.deepEqual(jb[0].lines.map((l) => l.account.systemKey).sort(), [SYSTEM_KEYS.LABA_DITAHAN, SYSTEM_KEYS.PIUTANG_USAHA].sort());
  assert.equal(await seimbang(), true);
});

test("Koreksi historis ditolak untuk Payment yang BUKAN kas ganda / sudah tuntas / order Resi (alasan spesifik), dan tanpa alasan", async () => {
  const w = await dunia();
  const o1 = await buatOrder({ value: 500_000 });
  const p1 = await payment(w, o1, { amount: 500_000, createdAt: rt("2026-09-10") });
  await assert.rejects(koreksiH(w, p1.id), (e) => e.statusCode === 409 && e.code === "JURNAL_TIDAK_ADA", "tanpa jurnal → tidak ada yang dibalik; jalurnya penuntasan, bukan koreksi bank");
  await assert.rejects(testPrisma.$transaction((tx) => koreksiPembayaranHistoris(tx, { paymentId: p1.id, userId: w.finance.id, alasan: "  " })), (e) => e.code === "ALASAN_WAJIB");
  // Resi (klasifikasi murni, tanpa DB)
  const k = await klasifikasiPembayaranHistoris(testPrisma, {
    id: "x", amount: 100, createdAt: rt("2026-09-10"), cancelledAt: null, verifications: [{ id: "v" }], finAllocations: [], replacedBy: null,
    order: { orderNumber: "R-1", status: "DELIVERED", value: 100, groupId: "g", group: { source: "BARU" } },
  });
  assert.equal(k.kode, "RESI");
});

test("C1: order DELIVERED tanpa pengakuan pendapatan → TANPA jurnal, hanya audit HISTORIS_TERCAKUP_SALDO_AWAL; ulang = delta nol", async () => {
  const w = await dunia();
  const order = await buatOrder({ value: 1_000_000 });
  const p = await payment(w, order, { amount: 1_000_000, createdAt: rt("2026-08-20") });
  const jurnalAwal = await testPrisma.finJournalEntry.count();

  const r1 = await tuntaskan(w, p.id);
  assert.equal(r1.kelas, "C1");
  assert.equal(r1.aksi, "AUDIT_SAJA");
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalAwal, "C1 tidak membuat jurnal");
  const ev = await testPrisma.activityEvent.findMany({ where: { entityId: p.id } });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].metadata.kode, KODE_HISTORIS);
  assert.equal(ev[0].metadata.label, ALASAN);
  assert.equal(ev[0].metadata.cutoff, "2026-09-18");

  const r2 = await tuntaskan(w, p.id);
  assert.equal(r2.auditBaru, false);
  assert.equal((await testPrisma.activityEvent.findMany({ where: { entityId: p.id } })).length, 1, "audit tidak dobel");
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalAwal);
});

test("C2: pendapatan sudah diakui, Payment historis tanpa jurnal → non-kas Dr Laba Ditahan / Cr Piutang; kas tidak berubah; ulang delta nol", async () => {
  const w = await dunia();
  const order = await buatOrder({ value: 800_000 });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: w.finance.id }));
  const p = await payment(w, order, { amount: 800_000, createdAt: rt("2026-09-05") });
  assert.equal(await saldoAkun(SYSTEM_KEYS.PIUTANG_USAHA, order.id), 800_000);

  const r = await tuntaskan(w, p.id);
  assert.equal(r.kelas, "C2");
  assert.equal(await saldoAkun(SYSTEM_KEYS.PIUTANG_USAHA, order.id), 0, "piutang tertutup");
  assert.equal(await saldoAkun(SYSTEM_KEYS.LABA_DITAHAN), 800_000);
  assert.equal(await saldoRek(w.pt) + await saldoRek(w.kem), 0, "tidak menyentuh Kas/Bank");
  const js = await jurnal(p.id);
  assert.equal(js.length, 1);
  assert.ok(js[0].lines.every((l) => !l.cashAccountId));
  assert.equal(await seimbang(), true);

  const total = await testPrisma.finJournalEntry.count();
  const r2 = await tuntaskan(w, p.id);
  assert.equal(r2.kelas, "SUDAH_TUNTAS", "ulang: sudah tuntas");
  assert.equal(await testPrisma.finJournalEntry.count(), total, "delta jurnal nol");
});

test("C3: order belum diserahkan, Payment historis tanpa jurnal → Uang Muka (lawan Laba Ditahan); saat diserahkan, mekanisme lama memindahkan Uang Muka ke Pendapatan", async () => {
  const w = await dunia();
  const order = await buatOrder({ value: 600_000, status: "SHIPPING" });
  const p = await payment(w, order, { amount: 600_000, createdAt: rt("2026-09-12") });
  const r = await tuntaskan(w, p.id);
  assert.equal(r.kelas, "C3");
  assert.equal(await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN), -600_000, "Uang Muka dikredit");
  assert.equal(await saldoAkun(SYSTEM_KEYS.LABA_DITAHAN), 600_000);
  assert.equal(await saldoRek(w.pt) + await saldoRek(w.kem), 0);

  await testPrisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: w.finance.id }));
  assert.equal(await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN, order.id), 0, "Uang Muka dipindahkan saat penyerahan");
  assert.equal(await saldoAkun(SYSTEM_KEYS.PIUTANG_USAHA, order.id), 0, "piutang order nol");
  assert.equal(await seimbang(), true);
});

test("C4: exception TIDAK diposting — nominal ganda, order Rp0, melebihi tagihan, refund aktif, dibatalkan; alasan spesifik", async () => {
  const w = await dunia();
  // ganda
  const oG = await buatOrder({ value: 400_000 });
  const g1 = await payment(w, oG, { amount: 200_000, createdAt: rt("2026-09-01") });
  await payment(w, oG, { amount: 200_000, createdAt: rt("2026-09-01") });
  // order Rp0
  const oN = await buatOrder({ value: 0 });
  const n1 = await payment(w, oN, { amount: 100_000, createdAt: rt("2026-09-01") });
  // melebihi tagihan
  const oM = await buatOrder({ value: 100_000 });
  const m1 = await payment(w, oM, { amount: 150_000, createdAt: rt("2026-09-02") });
  const semua = await daftarKlasifikasiHistoris(testPrisma);
  const kode = (id) => semua.items.find((i) => i.paymentId === id).kode;
  assert.equal(kode(g1.id), "KEMUNGKINAN_GANDA");
  assert.equal(kode(n1.id), "ORDER_NOL");
  assert.equal(kode(m1.id), "MELEBIHI_TAGIHAN");
  const jurnalAwal = await testPrisma.finJournalEntry.count();
  await assert.rejects(tuntaskan(w, g1.id), (e) => e.statusCode === 409 && e.code === "KEMUNGKINAN_GANDA");
  await assert.rejects(tuntaskan(w, n1.id), (e) => e.code === "ORDER_NOL");
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalAwal, "C4 tidak memposting apa pun");
  assert.ok(semua.ringkas.C4.jumlah >= 4);
});

test("Request PARALEL: dua koreksi historis untuk Payment yang sama → tepat satu sukses, satu jurnal pembalik, satu pengganti", async () => {
  const w = await dunia();
  const order = await buatOrder({ value: 900_000 });
  const lama = await bankGanda(w, order, { amount: 900_000, createdAt: rt("2026-09-04"), rek: w.pt });
  const hasil = await Promise.allSettled([koreksiH(w, lama.id), koreksiH(w, lama.id)]);
  assert.equal(hasil.filter((h) => h.status === "fulfilled").length, 1);
  assert.equal(hasil.filter((h) => h.status === "rejected").length, 1);
  assert.equal(await saldoRek(w.pt), 0);
  assert.equal((await jurnal(lama.id)).length, 1, "satu jurnal asli");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { reversalOfId: { not: null } } }), 1, "tepat satu pembalik");
  assert.equal(await testPrisma.payment.count({ where: { orderId: order.id, cancelledAt: null } }), 1, "tidak ada Payment ganda");
  assert.equal(await seimbang(), true);
});

test("GUARD CUTOFF: Payment sebelum 18 Sep tidak membuat jurnal Bank (gap SEBELUM_SALDO_AWAL); 18 Sep dan sesudahnya tetap menambah Bank", async () => {
  const w = await dunia();
  const o1 = await buatOrder({ value: 500_000, status: "PENDING" });
  const lama = await payment(w, o1, { amount: 500_000, createdAt: rt("2026-09-10"), cashAccountId: w.pt.id });
  const r = await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: lama.id, userId: w.finance.id }));
  assert.equal(r.posted, false);
  assert.equal(r.reason, "sebelum_saldo_awal");
  assert.equal(await saldoRek(w.pt), 0, "tidak menambah Bank");
  const gap = await testPrisma.finPostingGap.findFirst({ where: { source: "PEMBAYARAN_ORDER", sourceId: lama.id } });
  assert.equal(gap.reason, "SEBELUM_SALDO_AWAL");

  const o2 = await buatOrder({ value: 500_000, status: "PENDING" });
  const baru = await payment(w, o2, { amount: 500_000, createdAt: rt("2026-09-18"), cashAccountId: w.pt.id });
  const r2 = await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: baru.id, userId: w.finance.id }));
  assert.equal(r2.posted, true);
  assert.equal(await saldoRek(w.pt), 500_000, "tanggal cutoff sendiri = uang berjalan");
  const o3 = await buatOrder({ value: 500_000, status: "PENDING" });
  const tepiWIB = await payment(w, o3, { amount: 500_000, createdAt: new Date("2026-09-17T16:59:59Z"), cashAccountId: w.pt.id }); // 17 Sep 23:59:59 WIB
  assert.equal((await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: tepiWIB.id, userId: w.finance.id }))).posted, false, "17 Sep 23:59 WIB masih sebelum cutoff");
});

test("GUARD CUTOFF: koreksi pembayaran UMUM diblokir untuk Payment bertanggal sebelum cutoff (kode SEBELUM_SALDO_AWAL) dan untuk memundurkan tanggal ke sebelum cutoff", async () => {
  const w = await dunia();
  const order = await buatOrder({ value: 700_000 });
  const lama = await bankGanda(w, order, { amount: 700_000, createdAt: rt("2026-09-08"), rek: w.pt });
  const blokir = (await blokirKoreksiBatch(testPrisma, [lama.id])).get(lama.id);
  assert.equal(blokir.kode, "SEBELUM_SALDO_AWAL");
  assert.match(blokir.alasan, /sebelum saldo awal/);
  assert.equal((await blokirKoreksiBatch(testPrisma, [lama.id], { izinkanPraSaldoAwal: true })).get(lama.id), null, "jalur historis khusus boleh");
  await assert.rejects(
    testPrisma.$transaction((tx) => koreksiPembayaran(tx, { paymentId: lama.id, body: { amount: 600_000 }, alasan: "uji", userId: w.finance.id })),
    (e) => e.statusCode === 409 && e.code === "SEBELUM_SALDO_AWAL",
  );

  // Payment 20 Sep dimundurkan ke 10 Sep lewat koreksi umum → ditolak
  const o2 = await buatOrder({ value: 300_000, status: "PENDING" });
  const baru = await payment(w, o2, { amount: 300_000, createdAt: rt("2026-09-20"), cashAccountId: w.pt.id });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: baru.id, userId: w.finance.id }));
  await assert.rejects(
    testPrisma.$transaction((tx) => koreksiPembayaran(tx, { paymentId: baru.id, body: { tanggal: "2026-09-10" }, alasan: "uji mundur", userId: w.finance.id })),
    (e) => e.statusCode === 409 && e.code === "TANGGAL_SEBELUM_SALDO_AWAL",
  );
  assert.equal(await saldoRek(w.pt), 700_000 + 300_000, "tidak ada perubahan buku");
});

test("REKONSILIASI: periode SELESAI atau jurnal yang sudah dicocokkan mutasi bank tetap memblokir koreksi historis (tanpa bypass)", async () => {
  const w = await dunia();
  const o1 = await buatOrder({ value: 400_000 });
  const p1 = await bankGanda(w, o1, { amount: 400_000, createdAt: rt("2026-09-06"), rek: w.pt });
  await testPrisma.finBankStatement.create({ data: { cashAccountId: w.pt.id, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-16"), openingBalance: 0, closingBalance: 0, status: "SELESAI" } });
  // periode SELESAI menutup jurnal lama (tanggal 6 Sep) untuk rekening itu → dibalik? koreksi tidak boleh menembusnya
  const e1 = await koreksiH(w, p1.id).then(() => null, (e) => e);
  assert.ok(e1, "ditolak");
  assert.equal(await saldoRek(w.pt), 400_000, "tidak ada perubahan buku");

  const o2 = await buatOrder({ value: 250_000, nama: "Cocok" });
  const p2 = await bankGanda(w, o2, { amount: 250_000, createdAt: rt("2026-09-25"), rek: w.kem });
  // (tanggal ≥ cutoff, hanya untuk menguji blok 'sudah dicocokkan'): baris jurnal dicocokkan ke mutasi bank
  const stmt = await testPrisma.finBankStatement.create({ data: { cashAccountId: w.kem.id, periodStart: new Date("2026-09-19"), periodEnd: new Date("2026-09-30"), openingBalance: 0, closingBalance: 0, status: "DRAFT" } });
  const baris = await testPrisma.finJournalLine.findFirst({ where: { cashAccountId: w.kem.id, debit: { gt: 0 } } });
  await testPrisma.finBankStatementLine.create({ data: { statementId: stmt.id, date: new Date("2026-09-25"), description: "TRF", amount: 250_000, matchedLineId: baris.id } });
  const blokir = (await blokirKoreksiBatch(testPrisma, [p2.id], { izinkanPraSaldoAwal: true })).get(p2.id);
  assert.equal(blokir.kode, "SUDAH_DIREKONSILIASI");
});

test("Daftar klasifikasi: ringkasan C1/C2/C3/C4 + BANK_GANDA + SUDAH_TUNTAS; Payment 18 Sep ke atas tidak ikut; batch berulang = delta nol", async () => {
  const w = await dunia();
  const a = await buatOrder({ value: 100_000 });                               // C1
  const pa = await payment(w, a, { amount: 100_000, createdAt: rt("2026-09-01") });
  const b = await buatOrder({ value: 200_000 });                               // C2
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: b.id, userId: w.finance.id }));
  const pb = await payment(w, b, { amount: 200_000, createdAt: rt("2026-09-02") });
  const c = await buatOrder({ value: 300_000, status: "SHIPPING" });           // C3
  const pc = await payment(w, c, { amount: 300_000, createdAt: rt("2026-09-03") });
  const d = await buatOrder({ value: 0 });                                     // C4
  await payment(w, d, { amount: 50_000, createdAt: rt("2026-09-04") });
  const e = await buatOrder({ value: 400_000 });                               // BANK_GANDA
  await bankGanda(w, e, { amount: 400_000, createdAt: rt("2026-09-05"), rek: w.pt });
  const f = await buatOrder({ value: 500_000, status: "PENDING" });            // ≥ cutoff: tidak masuk daftar
  await payment(w, f, { amount: 500_000, createdAt: rt("2026-09-18") });

  const daftar = await daftarKlasifikasiHistoris(testPrisma);
  assert.equal(daftar.items.length, 5);
  assert.deepEqual(Object.fromEntries(Object.entries(daftar.ringkas).map(([k, v]) => [k, v.jumlah])), { C1: 1, C2: 1, C3: 1, C4: 1, BANK_GANDA: 1 });

  const jurnalAwal = await testPrisma.finJournalEntry.count();
  for (const p of [pa, pb, pc]) await tuntaskan(w, p.id);
  const sesudah1 = await testPrisma.finJournalEntry.count();
  assert.equal(sesudah1, jurnalAwal + 2, "hanya C2 dan C3 membuat jurnal");
  for (const p of [pa, pb, pc]) await tuntaskan(w, p.id).catch(() => {});
  assert.equal(await testPrisma.finJournalEntry.count(), sesudah1, "jalankan ulang: delta nol");
  assert.equal(await saldoRek(w.pt), 400_000, "batch C1/C2/C3 tidak menyentuh Kas/Bank");
  assert.equal(await seimbang(), true);
});

test("SKRIP produksi: dry-run tidak menulis; apply memproses Wilson + KEM + batch C1/C2/C3 dalam satu transaksi; tanpa HISTORIS_BACKUP_OK ditolak; ulang = delta nol", async () => {
  const { spawnSync } = await import("node:child_process");
  const os = await import("node:os");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const skrip = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/penuntasanHistorisSebelumSaldoAwal.js");
  const jalankan = (args, env = {}) => spawnSync("node", [skrip, ...args], { cwd: os.tmpdir(), env: { ...process.env, ...env }, encoding: "utf8" });

  const w = await dunia();
  await testPrisma.user.create({ data: { name: "Gilang", email: "gilang@klinikmatras.com", passwordHash: "x", role: "ADMIN" } });
  const wilsonOrder = await buatOrder({ value: 1_900_000 });
  await testPrisma.order.update({ where: { id: wilsonOrder.id }, data: { orderNumber: "NEW-21082026-014" } });
  const wilson = await bankGanda(w, wilsonOrder, { amount: 1_900_000, createdAt: rt("2026-09-03"), rek: w.pt });
  await testPrisma.finJournalEntry.updateMany({ where: { source: "PEMBAYARAN_ORDER", sourceId: wilson.id }, data: { entryNumber: "JV-03092026-747" } });
  const kemOrder = await buatOrder({ value: 1_750_000, nama: "KEM" });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: kemOrder.id, userId: w.finance.id }));
  const kem = await bankGanda(w, kemOrder, { amount: 1_750_000, createdAt: rt("2026-09-15"), rek: w.kem, lawan: "PIUTANG" });
  await testPrisma.paymentVerification.updateMany({ where: { paymentId: kem.id }, data: { createdAt: new Date("2026-09-21T03:00:00Z") } });
  const c1 = await buatOrder({ value: 100_000 });
  await payment(w, c1, { amount: 100_000, createdAt: rt("2026-08-20") });
  const c2 = await buatOrder({ value: 200_000 });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: c2.id, userId: w.finance.id }));
  await payment(w, c2, { amount: 200_000, createdAt: rt("2026-09-05") });
  const c3 = await buatOrder({ value: 300_000, status: "SHIPPING" });
  await payment(w, c3, { amount: 300_000, createdAt: rt("2026-09-12") });

  const awal = { jurnal: await testPrisma.finJournalEntry.count(), payment: await testPrisma.payment.count(), pt: await saldoRek(w.pt), kem: await saldoRek(w.kem) };
  const dry = jalankan([]);
  assert.equal(dry.status, 0, dry.stderr + dry.stdout);
  assert.match(dry.stdout, /DRY-RUN/);
  assert.equal(await testPrisma.finJournalEntry.count(), awal.jurnal, "dry-run tidak menulis jurnal");
  assert.equal(await testPrisma.payment.count(), awal.payment, "dry-run tidak menulis payment");

  const tanpa = jalankan(["--apply"]);
  assert.notEqual(tanpa.status, 0, "apply tanpa konfirmasi backup ditolak");
  assert.equal(await testPrisma.finJournalEntry.count(), awal.jurnal);

  const apply = jalankan(["--apply"], { HISTORIS_BACKUP_OK: "1" });
  assert.equal(apply.status, 0, apply.stderr + apply.stdout);
  assert.equal(await saldoRek(w.pt), awal.pt - 1_900_000, "PT Sano turun tepat Rp1.900.000");
  assert.equal(await saldoRek(w.kem), awal.kem - 1_750_000, "KEM turun tepat Rp1.750.000");
  assert.equal(await seimbang(), true);
  assert.equal(await testPrisma.payment.count(), awal.payment + 2, "hanya 2 Payment pengganti");
  const batch = await testPrisma.activityEvent.count({ where: { metadata: { path: ["aksi"], equals: "historis_tercakup_saldo_awal" } } });
  assert.ok(batch >= 3, "audit historis tercatat untuk C1 + versi pengganti Wilson (+ C2/C3 jurnal non-kas)");

  const jurnalSetelah = await testPrisma.finJournalEntry.count();
  const ulang = jalankan(["--apply"], { HISTORIS_BACKUP_OK: "1" });
  assert.equal(ulang.status, 0, ulang.stderr + ulang.stdout);
  assert.match(ulang.stdout, /sudah dikoreksi sebelumnya/);
  assert.match(ulang.stdout, /jalankan ulang: jurnal baru 0/);
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalSetelah, "jalankan ulang: delta nol");
  assert.equal(await saldoRek(w.pt), awal.pt - 1_900_000);
});

test("REVIEW OPUS #1: jurnal lama Dr Bank / Cr Uang Muka yang lalu dipindahkan ke Piutang oleh pengakuan pendapatan → pengganti mencerminkan Uang Muka; Piutang & Uang Muka order benar, Bank kembali", async () => {
  const w = await dunia();
  const order = await buatOrder({ value: 1_000_000, status: "PENDING" });
  const lama = await bankGanda(w, order, { amount: 400_000, createdAt: rt("2026-09-05"), rek: w.pt, lawan: "UANG_MUKA" }); // dibayar sebagian sebelum penyerahan
  await testPrisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: w.finance.id })); // memindahkan Uang Muka 400.000 ke pelunasan piutang
  assert.equal(await saldoAkun(SYSTEM_KEYS.PIUTANG_USAHA, order.id), 600_000);
  assert.equal(await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN, order.id), 0);

  const r = await koreksiH(w, lama.id);
  assert.equal(r.ok, true);
  assert.equal(await saldoRek(w.pt), 0, "Bank kembali");
  assert.equal(await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN, order.id), 0, "Uang Muka order net 0 (tidak bersaldo debit)");
  assert.equal(await saldoAkun(SYSTEM_KEYS.PIUTANG_USAHA, order.id), 600_000, "sisa tagihan pelanggan tetap Rp600.000 (tidak hilang)");
  assert.equal(await saldoAkun(SYSTEM_KEYS.LABA_DITAHAN), 400_000);
  assert.equal(await seimbang(), true);
});
