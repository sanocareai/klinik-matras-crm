// Test integrasi ALUR KEUANGAN KRITIS terhadap PostgreSQL SUNGGUHAN.
//
// KENAPA FILE INI ADA, bukan cukup tests/financeJournal.test.js (stub).
// Pelajaran mahal yang sudah tercatat di repo ini: stub membuktikan LOGIKA
// benar, BUKAN bahwa SQL & constraint-nya benar. `$1` vs `$1::uuid` di
// inventoryLedger.js lolos SELURUH tes stub dan membuat setiap endpoint
// gudang gagal total pasca-deploy (13 Sept 2026). Hal-hal berikut MUSTAHIL
// diverifikasi tanpa Postgres sungguhan, dan semuanya diuji di sini:
//
//   1. CHECK constraint fin_journal_lines (debit/kredit tidak negatif, tepat
//      satu yang terisi) — ditulis langsung di migration, tidak ada di
//      schema.prisma, jadi tidak pernah tersentuh kode aplikasi.
//   2. UNIQUE idempotencyKey — jaminan "satu kejadian = satu jurnal" yang
//      sebenarnya ditegakkan DATABASE, bukan cek findUnique di kode.
//   3. Kolom Decimal(18,2) benar-benar menyimpan presisi yang dikirim.
//   4. Seluruh rantai: DP masuk → uang muka (BUKAN pendapatan) → order
//      diserahkan → pendapatan diakui + piutang lahir → pelunasan → piutang
//      nol, dengan buku besar tetap SEIMBANG di setiap langkah.
//
// PRASYARAT: Postgres lokal + `npm run test:integration` (script itu
// menjalankan bootstrapTestDb.js lebih dulu). Tanpa database, file ini
// TIDAK bisa jalan — dan memang tidak boleh dipalsukan supaya "hijau".

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";

import { postJournal, reverseJournal, STATUS_DIHITUNG } from "../../src/services/finance/journal.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postPaymentReceived, postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { SETTING_KEYS, setSetting } from "../../src/services/finance/settings.js";
import { recomputeOrderPaymentStatus } from "../../src/services/paymentLedger.js";
import { neracaSaldo, labaRugi, neraca, umurPiutang } from "../../src/services/finance/reports.js";
import { toMoney } from "../../src/services/finance/money.js";

// Pembersihan memakai truncateAll() BERSAMA dari setup/testDb.js — tabel
// fin_* sudah terdaftar eksplisit di sana. SENGAJA tidak punya daftar
// tabel sendiri di file ini: dua daftar yang harus dijaga sinkron adalah
// cara paling pasti salah satunya tertinggal saat ada tabel baru.

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

// ── Penyiapan lingkungan finance yang lengkap ───────────────────────────
async function siapkanFinance() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));

  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const rekeningKas = await testPrisma.finCashAccount.create({
    data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id },
  });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, rekeningKas.id);

  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const rekeningBank = await testPrisma.finCashAccount.create({
    data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id },
  });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_TRANSFER, rekeningBank.id);

  return { rekeningKas, rekeningBank };
}

async function buatOrder({ value = 5_000_000, ongkir = null, category = "LAYANAN" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Finance Tes" } });
  const order = await testPrisma.order.create({
    data: { customerId: customer.id, value, ongkir, category, orderNumber: `TES-${Date.now()}` },
  });
  return { customer, order };
}

async function saldoAkun(systemKey) {
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey } });
  const agg = await testPrisma.finJournalLine.aggregate({
    where: { accountId: akun.id, entry: { status: { in: STATUS_DIHITUNG } } },
    _sum: { debit: true, credit: true },
  });
  const debit = toMoney(agg._sum.debit || 0);
  const credit = toMoney(agg._sum.credit || 0);
  return akun.normalBalance === "DEBIT" ? debit.minus(credit) : credit.minus(debit);
}

// ═════════════════════════════════════════════════════════════════════════
// 1. PENEGAKAN DI LEVEL DATABASE
// ═════════════════════════════════════════════════════════════════════════

test("CHECK constraint Postgres MENOLAK baris jurnal dengan debit DAN kredit terisi", async () => {
  // Validasi kode (normalizeLines) sudah menolaknya. Ini membuktikan lapis
  // KEDUA: baris cacat mustahil masuk walau lewat SQL langsung.
  await siapkanFinance();
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });

  const entry = await testPrisma.finJournalEntry.create({
    data: { entryNumber: `JV-TES-${Date.now()}`, date: new Date("2026-09-17"), description: "uji constraint", source: "MANUAL", status: "POSTED" },
  });

  await assert.rejects(
    () => testPrisma.finJournalLine.create({
      data: { entryId: entry.id, lineNo: 1, accountId: akun.id, debit: 100, credit: 100 },
    }),
    /fin_journal_lines_amount_sign_check|violates check constraint/i
  );

  await assert.rejects(
    () => testPrisma.finJournalLine.create({
      data: { entryId: entry.id, lineNo: 2, accountId: akun.id, debit: -50, credit: 0 },
    }),
    /violates check constraint/i
  );

  await assert.rejects(
    () => testPrisma.finJournalLine.create({
      data: { entryId: entry.id, lineNo: 3, accountId: akun.id, debit: 0, credit: 0 },
    }),
    /violates check constraint/i
  );
});

test("UNIQUE idempotencyKey ditegakkan Postgres — bukan cuma cek di kode", async () => {
  await siapkanFinance();
  const kas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const pendapatan = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PENDAPATAN_LAYANAN } });

  const lines = [
    { accountId: kas.id, debit: 1000 },
    { accountId: pendapatan.id, credit: 1000 },
  ];
  const opts = { date: "2026-09-17", description: "uji idempotensi", source: "MANUAL", idempotencyKey: "UJI:1", lines };

  const a = await testPrisma.$transaction((tx) => postJournal(tx, opts));
  assert.equal(a.created, true);

  const b = await testPrisma.$transaction((tx) => postJournal(tx, opts));
  assert.equal(b.created, false, "panggilan kedua TIDAK boleh membuat jurnal baru");
  assert.equal(b.entry.id, a.entry.id);

  const jumlah = await testPrisma.finJournalEntry.count({ where: { idempotencyKey: "UJI:1" } });
  assert.equal(jumlah, 1);
});

test("Decimal(18,2) menyimpan presisi sen apa adanya, bukan dibulatkan ke rupiah", async () => {
  await siapkanFinance();
  const kas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const pendapatan = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PENDAPATAN_LAYANAN } });

  await testPrisma.$transaction((tx) => postJournal(tx, {
    date: "2026-09-17", description: "uji presisi", source: "MANUAL",
    lines: [
      { accountId: kas.id, debit: "3333333.33" },
      { accountId: pendapatan.id, credit: "3333333.33" },
    ],
  }));

  const baris = await testPrisma.finJournalLine.findFirst({ where: { accountId: kas.id } });
  assert.equal(toMoney(baris.debit).toFixed(2), "3333333.33");
});

// ═════════════════════════════════════════════════════════════════════════
// 2. ALUR UANG PELANGGAN — DP BUKAN PENDAPATAN
// ═════════════════════════════════════════════════════════════════════════

test("DP masuk sebelum order diserahkan → UANG MUKA (kewajiban), pendapatan TETAP NOL", async () => {
  // Aturan paling penting di seluruh modul ini. Kalau tes ini pecah, laba
  // rugi akan melaporkan uang yang belum jadi hak perusahaan.
  await siapkanFinance();
  const { user } = await createTestUser({ roles: ["FINANCE"] });
  const { order } = await buatOrder({ value: 5_000_000 });

  const payment = await testPrisma.payment.create({
    data: { orderId: order.id, amount: 2_000_000, method: "CASH", recordedById: user.id },
  });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: payment.id, userId: user.id }));

  assert.equal((await saldoAkun(SYSTEM_KEYS.KAS)).toFixed(2), "2000000.00");
  assert.equal((await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN)).toFixed(2), "2000000.00", "DP wajib jadi KEWAJIBAN");
  assert.equal((await saldoAkun(SYSTEM_KEYS.PENDAPATAN_LAYANAN)).toFixed(2), "0.00", "DP TIDAK BOLEH jadi pendapatan");
  assert.equal((await saldoAkun(SYSTEM_KEYS.PIUTANG_USAHA)).toFixed(2), "0.00", "piutang belum lahir sebelum diserahkan");
});

test("Order diserahkan → pendapatan diakui, uang muka berpindah jadi pelunasan piutang", async () => {
  await siapkanFinance();
  const { user } = await createTestUser({ roles: ["FINANCE"] });
  const { order } = await buatOrder({ value: 5_000_000, ongkir: 200_000 });

  const dp = await testPrisma.payment.create({
    data: { orderId: order.id, amount: 2_000_000, method: "CASH", recordedById: user.id },
  });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: dp.id, userId: user.id }));
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: user.id }));

  // Total tagihan = nilai layanan + ongkir (persis hitungNominal di invoice.js)
  assert.equal((await saldoAkun(SYSTEM_KEYS.PENDAPATAN_LAYANAN)).toFixed(2), "5000000.00");
  assert.equal((await saldoAkun(SYSTEM_KEYS.PENDAPATAN_ONGKIR)).toFixed(2), "200000.00");
  // Uang muka habis dipindah, piutang = total tagihan − DP
  assert.equal((await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN)).toFixed(2), "0.00");
  assert.equal((await saldoAkun(SYSTEM_KEYS.PIUTANG_USAHA)).toFixed(2), "3200000.00");
});

test("Pelunasan setelah pendapatan diakui mengurangi PIUTANG, bukan menambah uang muka lagi", async () => {
  await siapkanFinance();
  const { user } = await createTestUser({ roles: ["FINANCE"] });
  const { order } = await buatOrder({ value: 5_000_000 });

  const dp = await testPrisma.payment.create({
    data: { orderId: order.id, amount: 2_000_000, method: "CASH", recordedById: user.id },
  });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: dp.id, userId: user.id }));
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: user.id }));

  const pelunasan = await testPrisma.payment.create({
    data: { orderId: order.id, amount: 3_000_000, method: "TRANSFER", recordedById: user.id },
  });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: pelunasan.id, userId: user.id }));

  assert.equal((await saldoAkun(SYSTEM_KEYS.PIUTANG_USAHA)).toFixed(2), "0.00", "piutang lunas");
  assert.equal((await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN)).toFixed(2), "0.00", "tidak ada uang muka baru");
  assert.equal((await saldoAkun(SYSTEM_KEYS.KAS)).toFixed(2), "2000000.00");
  assert.equal((await saldoAkun(SYSTEM_KEYS.BANK)).toFixed(2), "3000000.00");
});

test("Buku besar SEIMBANG di setiap langkah alur uang pelanggan", async () => {
  await siapkanFinance();
  const { user } = await createTestUser({ roles: ["FINANCE"] });
  const { order } = await buatOrder({ value: 7_777_777 });

  const langkah = [];
  const dp = await testPrisma.payment.create({
    data: { orderId: order.id, amount: 1_111_111, method: "CASH", recordedById: user.id },
  });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: dp.id, userId: user.id }));
  langkah.push(await neracaSaldo(testPrisma, { from: new Date("2026-01-01"), to: new Date("2026-12-31") }));

  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: user.id }));
  langkah.push(await neracaSaldo(testPrisma, { from: new Date("2026-01-01"), to: new Date("2026-12-31") }));

  const lunas = await testPrisma.payment.create({
    data: { orderId: order.id, amount: 6_666_666, method: "TRANSFER", recordedById: user.id },
  });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: lunas.id, userId: user.id }));
  langkah.push(await neracaSaldo(testPrisma, { from: new Date("2026-01-01"), to: new Date("2026-12-31") }));

  for (const [i, nb] of langkah.entries()) {
    assert.equal(nb.total.seimbang, true, `neraca saldo timpang di langkah ke-${i + 1} (selisih ${nb.total.selisih})`);
  }

  const nrc = await neraca(testPrisma, { to: new Date("2026-12-31") });
  assert.equal(nrc.ringkasan.seimbang, true, `neraca tidak seimbang: selisih ${nrc.ringkasan.selisih}`);
});

test("Pembatalan jurnal lewat REVERSAL mengembalikan saldo ke nol — baris aslinya TETAP ada", async () => {
  await siapkanFinance();
  const { user } = await createTestUser({ roles: ["FINANCE"] });
  const { order } = await buatOrder({ value: 1_000_000 });

  const payment = await testPrisma.payment.create({
    data: { orderId: order.id, amount: 1_000_000, method: "CASH", recordedById: user.id },
  });
  const { entry } = await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: payment.id, userId: user.id }));
  assert.equal((await saldoAkun(SYSTEM_KEYS.KAS)).toFixed(2), "1000000.00");

  await testPrisma.$transaction((tx) => reverseJournal(tx, {
    entryId: entry.id, reason: "salah input", userId: user.id,
  }));

  assert.equal((await saldoAkun(SYSTEM_KEYS.KAS)).toFixed(2), "0.00", "saldo kembali nol setelah dibalik");
  assert.equal((await saldoAkun(SYSTEM_KEYS.UANG_MUKA_PELANGGAN)).toFixed(2), "0.00");

  const asli = await testPrisma.finJournalEntry.findUnique({ where: { id: entry.id }, include: { lines: true } });
  assert.equal(asli.status, "REVERSED");
  assert.equal(asli.lines.length, 2, "baris jurnal asli TIDAK PERNAH dihapus");

  const reversal = await testPrisma.finJournalEntry.findFirst({ where: { reversalOfId: entry.id } });
  assert.ok(reversal, "jurnal balik wajib ada");
  assert.equal(reversal.source, "REVERSAL");
});

test("Satu jurnal mustahil dibalik DUA KALI — dijaga UNIQUE reversal_of_id", async () => {
  await siapkanFinance();
  const kas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const pendapatan = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PENDAPATAN_LAIN } });

  const { entry } = await testPrisma.$transaction((tx) => postJournal(tx, {
    date: "2026-09-17", description: "uji reversal ganda", source: "MANUAL",
    lines: [{ accountId: kas.id, debit: 500 }, { accountId: pendapatan.id, credit: 500 }],
  }));

  await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: entry.id, reason: "pertama" }));
  await assert.rejects(
    () => testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: entry.id, reason: "kedua" })),
    /sudah pernah dibatalkan/i
  );
});

// ═════════════════════════════════════════════════════════════════════════
// 3. STATUS BAYAR CRM & GERBANG VERIFIKASI
// ═════════════════════════════════════════════════════════════════════════

test("Status bayar order tetap mengikuti ledger seperti sebelum D-180 (gerbang MATI)", async () => {
  // Jaminan tidak-ada-regresi: perilaku default TIDAK BERUBAH sedikit pun.
  await siapkanFinance();
  const { user } = await createTestUser({ roles: ["SALES"] });
  const { order } = await buatOrder({ value: 1_000_000 });

  await testPrisma.payment.create({
    data: { orderId: order.id, amount: 400_000, method: "CASH", recordedById: user.id },
  });
  let status = await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, order.id));
  assert.equal(status.paymentStatus, "DP");
  assert.equal(status.paid, 400_000);

  await testPrisma.payment.create({
    data: { orderId: order.id, amount: 600_000, method: "TRANSFER", recordedById: user.id },
  });
  status = await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, order.id));
  assert.equal(status.paymentStatus, "LUNAS");
  assert.equal(status.outstanding, 0);
});

test("Gerbang verifikasi MENYALA: hanya pembayaran terverifikasi yang menggerakkan status bayar", async () => {
  await siapkanFinance();
  const { user } = await createTestUser({ roles: ["FINANCE"] });
  const { order } = await buatOrder({ value: 1_000_000 });

  await setSetting(testPrisma, SETTING_KEYS.PAYMENT_VERIFICATION_GATE, "true");
  await setSetting(testPrisma, SETTING_KEYS.PAYMENT_VERIFICATION_GATE_SINCE, new Date(Date.now() - 60_000).toISOString());

  const payment = await testPrisma.payment.create({
    data: { orderId: order.id, amount: 1_000_000, method: "CASH", recordedById: user.id },
  });
  let status = await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, order.id));
  assert.equal(status.paymentStatus, "BELUM_BAYAR", "belum diverifikasi finance");

  await testPrisma.paymentVerification.create({ data: { paymentId: payment.id, verifiedById: user.id } });
  status = await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, order.id));
  assert.equal(status.paymentStatus, "LUNAS", "setelah diverifikasi baru dihitung");
});

test("Gerbang verifikasi TIDAK PERNAH berlaku surut ke pembayaran lama", async () => {
  // Inilah yang membuat penyalaan gerbang aman dilakukan di jam kerja:
  // ratusan order yang sudah dianggap DP tidak mendadak balik jadi Belum Bayar.
  await siapkanFinance();
  const { user } = await createTestUser({ roles: ["FINANCE"] });
  const { order } = await buatOrder({ value: 1_000_000 });

  const lama = await testPrisma.payment.create({
    data: { orderId: order.id, amount: 1_000_000, method: "CASH", recordedById: user.id },
  });
  await testPrisma.$executeRawUnsafe(
    `UPDATE "payments" SET created_at = $1 WHERE id = $2::uuid`,
    new Date("2026-01-01T00:00:00Z"), lama.id
  );

  await setSetting(testPrisma, SETTING_KEYS.PAYMENT_VERIFICATION_GATE, "true");
  await setSetting(testPrisma, SETTING_KEYS.PAYMENT_VERIFICATION_GATE_SINCE, new Date().toISOString());

  const status = await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, order.id));
  assert.equal(status.paymentStatus, "LUNAS", "pembayaran sebelum gerbang aktif TETAP dihitung apa adanya");
});

test("Pembayaran yang DIBATALKAN keluar dari hitungan status bayar, barisnya tetap ada", async () => {
  await siapkanFinance();
  const { user } = await createTestUser({ roles: ["FINANCE"] });
  const { order } = await buatOrder({ value: 1_000_000 });

  const p = await testPrisma.payment.create({
    data: { orderId: order.id, amount: 1_000_000, method: "CASH", recordedById: user.id },
  });
  await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, order.id));

  await testPrisma.payment.update({
    where: { id: p.id },
    data: { cancelledAt: new Date(), cancelledById: user.id, cancelReason: "salah input" },
  });
  const status = await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, order.id));
  assert.equal(status.paymentStatus, "BELUM_BAYAR");
  assert.equal(await testPrisma.payment.count({ where: { orderId: order.id } }), 1, "baris ledger TIDAK dihapus");
});

// ═════════════════════════════════════════════════════════════════════════
// 4. KEJUJURAN LAPORAN
// ═════════════════════════════════════════════════════════════════════════

test("Laba rugi TIDAK memuat DP, dan piutang cuma muncul untuk order yang sudah diserahkan", async () => {
  await siapkanFinance();
  const { user } = await createTestUser({ roles: ["FINANCE"] });

  const a = await buatOrder({ value: 3_000_000 }); // dibayar, BELUM diserahkan
  const b = await buatOrder({ value: 4_000_000 }); // diserahkan, baru sebagian bayar

  const pa = await testPrisma.payment.create({
    data: { orderId: a.order.id, amount: 3_000_000, method: "CASH", recordedById: user.id },
  });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: pa.id, userId: user.id }));

  const pb = await testPrisma.payment.create({
    data: { orderId: b.order.id, amount: 1_000_000, method: "CASH", recordedById: user.id },
  });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: pb.id, userId: user.id }));
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: b.order.id, userId: user.id }));

  const lr = await labaRugi(testPrisma, { from: new Date("2026-01-01"), to: new Date("2026-12-31") });
  assert.equal(lr.ringkasan.pendapatanBruto, 4_000_000, "hanya order yang diserahkan yang jadi pendapatan");

  const piutang = await umurPiutang(testPrisma, { to: new Date("2026-12-31") });
  assert.equal(piutang.baris.length, 1, "order yang belum diserahkan TIDAK punya piutang");
  assert.equal(piutang.total, 3_000_000);
  assert.equal(piutang.baris[0].orderId, b.order.id);
});

test("Laporan JUJUR menyebut saldo awal belum diinput & jumlah data belum lengkap", async () => {
  await siapkanFinance();
  const lr = await labaRugi(testPrisma, { from: new Date("2026-01-01"), to: new Date("2026-12-31") });
  assert.equal(lr.catatan.saldoAwalTerisi, false);
  assert.ok(lr.catatan.pesan.some((p) => /Saldo awal belum pernah diinput/i.test(p)));
});

test("Pembayaran tanpa pemetaan rekening TIDAK menjatuhkan apa pun — tercatat sebagai gap", async () => {
  // Modul finance tidak boleh menghentikan operasional. Lihat aturan di
  // kepala services/finance/hooks.js.
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx)); // TANPA rekening kas
  const { user } = await createTestUser({ roles: ["SALES"] });
  const { order } = await buatOrder({ value: 1_000_000 });

  const p = await testPrisma.payment.create({
    data: { orderId: order.id, amount: 500_000, method: "QRIS", recordedById: user.id },
  });
  const hasil = await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: user.id }));

  assert.equal(hasil.posted, false);
  assert.equal(hasil.gap, true);
  const gap = await testPrisma.finPostingGap.findFirst({ where: { sourceId: p.id } });
  assert.ok(gap, "gap wajib tercatat, bukan hilang diam-diam");
  assert.match(gap.detail, /rekening kas\/bank untuk metode QRIS belum dipilih/i);

  // Status bayar CRM TETAP jalan seperti biasa — itu inti jaminannya.
  const status = await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, order.id));
  assert.equal(status.paymentStatus, "DP");
});

test("Periode TERTUTUP menolak jurnal baru terhadap Postgres sungguhan", async () => {
  await siapkanFinance();
  const kas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const pendapatan = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PENDAPATAN_LAIN } });
  await testPrisma.finPeriod.create({ data: { year: 2026, month: 8, status: "CLOSED" } });

  await assert.rejects(
    () => testPrisma.$transaction((tx) => postJournal(tx, {
      date: "2026-08-15", description: "uji periode tertutup", source: "MANUAL",
      lines: [{ accountId: kas.id, debit: 100 }, { accountId: pendapatan.id, credit: 100 }],
    })),
    /sudah ditutup/i
  );

  const jumlah = await testPrisma.finJournalEntry.count({ where: { description: "uji periode tertutup" } });
  assert.equal(jumlah, 0, "tidak boleh ada jejak jurnal yang ditolak");
});
