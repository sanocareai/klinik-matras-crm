// PENOLAKAN/PEMBATALAN PAYMENT HARUS MENYESUAIKAN PEMINDAHAN UANG MUKA → PIUTANG (kasus RES-28092026-179, 6–7 Okt 2026: Rp1 tunai ditolak SETELAH pendapatan diakui,
// meninggalkan Uang Muka Rp1 debit & Piutang kurang Rp1). Dikunci: tolak sebelum/sesudah pengakuan; DP parsial; beberapa Payment (urutan apa pun); Payment sah lain TIDAK tersentuh;
// kelebihan bayar; Payment sesudah pengakuan (Piutang) tidak disentuh; alokasi Resi per child; replay idempoten; dua penolakan paralel; jalur CRM "Batalkan pembayaran";
// jurnal selalu seimbang & kas/bank hanya bergerak sebesar pembalikan Payment.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postRevenueRecognition, postPaymentReceived } from "../../src/services/finance/posting/orderRevenue.js";
import { sesuaikanReklasUangMuka, kunciReklas } from "../../src/services/finance/reklasUangMuka.js";
import { tolakPembayaran } from "../../src/services/finance/pembayaran.js";

let server; let n = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Reklas" } });
  const order = async (value = 1_200_000, extra = {}) => testPrisma.order.create({ data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `RKL-${String(++n).padStart(3, "0")}`, status: "PROCESSING", paymentStatus: "BELUM_BAYAR", ...extra } });
  const bayar = async (o, amount, { alokasi = null } = {}) => {
    const p = await testPrisma.payment.create({ data: { orderId: o.id, amount, method: "TRANSFER", cashAccountId: bank.id, recordedById: admin.user.id } });
    if (alokasi) for (const [orderId, nominal] of alokasi) await testPrisma.finPaymentAllocation.create({ data: { paymentId: p.id, orderId, amount: nominal } });
    await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: admin.user.id }));
    return p;
  };
  const akui = async (o) => { await testPrisma.order.update({ where: { id: o.id }, data: { status: "DELIVERED" } }); await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: admin.user.id })); };
  return { bank, admin, finance, order, bayar, akui, f: makeClient(server.baseUrl, finance.token), a: makeClient(server.baseUrl, admin.token) };
}
async function saldo(kode, orderId = null) {
  const akun = await testPrisma.finAccount.findFirst({ where: { code: kode } });
  const a = await testPrisma.finJournalLine.aggregate({ where: { accountId: akun.id, ...(orderId && { orderId }), entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(a._sum.debit ?? 0) - Number(a._sum.credit ?? 0);
}
const piutang = (id) => saldo("1-1300", id);
const uangMuka = async (id) => 0 - (await saldo("2-1200", id)); // saldo kredit (arah normal); "0 -" menormalkan -0 menjadi 0
const kas = async () => { const a = await testPrisma.finJournalLine.aggregate({ where: { cashAccountId: { not: null }, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } }); return Number(a._sum.debit ?? 0) - Number(a._sum.credit ?? 0); };
async function seimbang() {
  const a = await testPrisma.finJournalLine.aggregate({ where: { entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(a._sum.debit) === Number(a._sum.credit);
}
const jumlahReklas = () => testPrisma.finJournalEntry.count({ where: { idempotencyKey: { contains: ":RECLAS:" } } });
const tolak = (ctx, p) => ctx.f.post(`/api/finance/pembayaran/${p.id}/tolak`, { reason: "salah input (uji)" });

test("SEBELUM pengakuan: tolak Payment → Uang Muka kembali 0, tidak ada jurnal penyesuaian; pengakuan sesudahnya menagih penuh", async () => {
  const c = await dunia();
  const o = await c.order();
  const p = await c.bayar(o, 100_000);
  assert.equal(await uangMuka(o.id), 100_000);
  const r = await tolak(c, p);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await uangMuka(o.id), 0);
  assert.equal(await jumlahReklas(), 0, "belum diakui → tidak ada pemindahan yang perlu disesuaikan");
  assert.equal(await kas(), 0);
  await c.akui(o);
  assert.equal(await piutang(o.id), 1_200_000);
  assert.equal(await uangMuka(o.id), 0);
  assert.ok(await seimbang());
});

test("SESUDAH pengakuan (kasus Rp1 nyata): tolak → Piutang pulih penuh, Uang Muka 0, satu jurnal Dr Piutang/Cr Uang Muka tertaut ke order & Payment; kas kembali 0", async () => {
  const c = await dunia();
  const o = await c.order();
  const p = await c.bayar(o, 1);
  await c.akui(o);
  assert.equal(await piutang(o.id), 1_199_999);
  assert.equal(await kas(), 1);
  const r = await tolak(c, p);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await piutang(o.id), 1_200_000, "piutang order kembali penuh");
  assert.equal(await uangMuka(o.id), 0, "Uang Muka tidak boleh bersaldo debit");
  assert.equal(await kas(), 0);
  const j = await testPrisma.finJournalEntry.findUnique({ where: { idempotencyKey: kunciReklas(p.id, o.id) }, include: { lines: { include: { account: { select: { systemKey: true } } } } } });
  assert.equal(j.source, "PEMBAYARAN_ORDER");
  assert.equal(j.sourceId, p.id);
  assert.equal(j.status, "POSTED");
  assert.deepEqual(j.lines.map((l) => [l.account.systemKey, Number(l.debit), Number(l.credit), l.orderId]).sort(), [[SYSTEM_KEYS.PIUTANG_USAHA, 1, 0, o.id], [SYSTEM_KEYS.UANG_MUKA_PELANGGAN, 0, 1, o.id]].sort());
  assert.ok(j.lines.every((l) => !l.cashAccountId), "tidak menyentuh kas/bank");
  assert.ok(await seimbang());
  const aud = await testPrisma.activityEvent.findFirst({ where: { entityType: "payment", entityId: p.id } });
  assert.equal(aud.metadata.reklasUangMuka[0].jumlah, 1);
});

test("DP parsial + beberapa Payment (urutan tolak apa pun): hanya kontribusi Payment yang ditolak yang disesuaikan; Payment sah lain tetap diperhitungkan", async () => {
  for (const urutan of [["p1", "p2"], ["p2", "p1"]]) {
    const c = await dunia();
    const o = await c.order(120_000);
    const p = { p1: await c.bayar(o, 100_000), p2: await c.bayar(o, 50_000) }; // 150 > tagihan 120 → ada kelebihan bayar
    await c.akui(o);
    assert.equal(await piutang(o.id), 0);
    assert.equal(await uangMuka(o.id), 30_000, "kelebihan bayar tetap kewajiban");

    assert.equal((await tolak(c, p[urutan[0]])).status, 200);
    // Setelah menolak satu Payment, yang tersisa: p1 ditolak → p2 (50.000) sah; p2 ditolak → p1 (100.000) sah.
    assert.equal(await piutang(o.id), urutan[0] === "p1" ? 70_000 : 20_000);
    assert.equal(await uangMuka(o.id), 0);
    // Payment sah yang tersisa menutup sebagian tagihan — tidak pernah lebih
    const sah = urutan[0] === "p1" ? 50_000 : 100_000;
    assert.equal(await piutang(o.id), 120_000 - sah);

    assert.equal((await tolak(c, p[urutan[1]])).status, 200);
    assert.equal(await piutang(o.id), 120_000, `urutan ${urutan}: kedua ditolak → tagihan penuh`);
    assert.equal(await uangMuka(o.id), 0);
    assert.equal(await kas(), 0);
    assert.ok(await seimbang());
    await truncateAll();
  }
});

test("Payment SAH lain sesudah pengakuan tidak tersentuh: tolak DP awal Rp1 → piutang = tagihan − pelunasan sah; Uang Muka 0", async () => {
  const c = await dunia();
  const o = await c.order();
  const dp = await c.bayar(o, 1);
  await c.akui(o);
  await c.bayar(o, 600_000); // sesudah pengakuan → Cr Piutang
  assert.equal(await piutang(o.id), 1_200_000 - 1 - 600_000);
  assert.equal((await tolak(c, dp)).status, 200);
  assert.equal(await piutang(o.id), 600_000);
  assert.equal(await uangMuka(o.id), 0);
  assert.equal(await jumlahReklas(), 1);
  assert.equal(await kas(), 600_000);
});

test("Payment yang dijurnal SESUDAH pengakuan (Cr Piutang): ditolak → tidak ada jurnal penyesuaian; piutang pulih oleh pembalik biasa", async () => {
  const c = await dunia();
  const o = await c.order();
  await c.akui(o);
  const p = await c.bayar(o, 400_000);
  assert.equal(await piutang(o.id), 800_000);
  assert.equal((await tolak(c, p)).status, 200);
  assert.equal(await piutang(o.id), 1_200_000);
  assert.equal(await jumlahReklas(), 0);
  assert.equal(await uangMuka(o.id), 0);
});

test("Replay: tolak lagi → 409 tanpa jurnal baru; menjalankan helper dua kali → tidak menggandakan", async () => {
  const c = await dunia();
  const o = await c.order();
  const p = await c.bayar(o, 5_000);
  await c.akui(o);
  assert.equal((await tolak(c, p)).status, 200);
  const sebelum = await testPrisma.finJournalEntry.count();
  const ulang = await tolak(c, p);
  assert.equal(ulang.status, 409);
  assert.equal(await testPrisma.finJournalEntry.count(), sebelum);
  const asli = await testPrisma.finJournalEntry.findUnique({ where: { idempotencyKey: `PEMBAYARAN_ORDER:${p.id}` }, include: { lines: true } });
  const lagi = await testPrisma.$transaction((tx) => sesuaikanReklasUangMuka(tx, { paymentId: p.id, entryAsli: asli }));
  assert.deepEqual(lagi, [], "sudah disesuaikan → tidak ada lagi");
  assert.equal(await testPrisma.finJournalEntry.count(), sebelum);
  assert.equal(await piutang(o.id), 1_200_000);
});

test("Alokasi Resi: Payment di anchor teralokasi ke 2 order (satu sudah diakui, satu belum lalu diakui) → tiap order disesuaikan menurut kontribusinya sendiri", async () => {
  const c = await dunia();
  const A = await c.order(500_000);
  const B = await c.order(700_000);
  await c.akui(A); // A sudah diakui → alokasi ke A masuk Piutang
  const p = await c.bayar(A, 300_000, { alokasi: [[A.id, 100_000], [B.id, 200_000]] }); // B belum diakui → alokasi ke B masuk Uang Muka
  assert.equal(await piutang(A.id), 400_000);
  assert.equal(await uangMuka(B.id), 200_000);
  await c.akui(B); // pemindahan 200.000 dari Uang Muka B ke Piutang B
  assert.equal(await piutang(B.id), 500_000);
  assert.equal(await uangMuka(B.id), 0);

  const r = await tolakDariService(p, c);
  assert.ok(r);
  assert.equal(await piutang(A.id), 500_000, "A: dipulihkan oleh pembalik biasa (kontribusinya ke Piutang)");
  assert.equal(await piutang(B.id), 700_000, "B: pemindahan Uang Muka dibatalkan sesuai kontribusi");
  assert.equal(await uangMuka(B.id), 0);
  assert.equal(await uangMuka(A.id), 0);
  assert.equal(await jumlahReklas(), 1, "hanya B yang perlu penyesuaian");
  assert.equal(await kas(), 0);
  assert.ok(await seimbang());
});
async function tolakDariService(p, c) {
  return testPrisma.$transaction((tx) => tolakPembayaran(tx, { paymentId: p.id, reason: "uji Resi", userId: c.finance.user.id }), { timeout: 30_000 });
}

test("Kelebihan bayar: Payment melebihi tagihan ditolak → piutang kembali PENUH, Uang Muka 0 (bukan kredit)", async () => {
  const c = await dunia();
  const o = await c.order(120_000);
  const p = await c.bayar(o, 150_000);
  await c.akui(o);
  assert.equal(await piutang(o.id), 0);
  assert.equal(await uangMuka(o.id), 30_000);
  assert.equal((await tolak(c, p)).status, 200);
  assert.equal(await piutang(o.id), 120_000);
  assert.equal(await uangMuka(o.id), 0);
  assert.ok(await seimbang());
});

test("Konkurensi: dua penolakan PARALEL pada order yang sama → keduanya berhasil, hasil sama dengan berurutan, tanpa deadlock/500", async () => {
  const c = await dunia();
  const o = await c.order(120_000);
  const p1 = await c.bayar(o, 100_000);
  const p2 = await c.bayar(o, 50_000);
  await c.akui(o);
  const [r1, r2] = await Promise.all([tolak(c, p1), tolak(c, p2)]);
  assert.deepEqual([r1.status, r2.status], [200, 200], JSON.stringify([r1.body, r2.body]));
  assert.equal(await piutang(o.id), 120_000);
  assert.equal(await uangMuka(o.id), 0);
  assert.equal(await kas(), 0);
  assert.ok(await seimbang());
  assert.equal(await testPrisma.finJournalEntry.count({ where: { idempotencyKey: { contains: ":RECLAS:" } } }), 2);
});

test("Jalur CRM 'Batalkan pembayaran' (admin) ikut menyesuaikan", async () => {
  const c = await dunia();
  const o = await c.order();
  const p = await c.bayar(o, 1);
  await c.akui(o);
  const r = await c.a.post(`/api/orders/${o.id}/payments/${p.id}/cancel`, { reason: "salah input" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await piutang(o.id), 1_200_000);
  assert.equal(await uangMuka(o.id), 0);
  assert.equal(await jumlahReklas(), 1);
  assert.ok(await seimbang());
});

test("Pemindai anomali: jurnal penyesuaian (kunci :RECLAS:) TIDAK dianggap 'pembayaran dibatalkan, jurnal masih aktif'", async () => {
  const c = await dunia();
  const o = await c.order();
  const p = await c.bayar(o, 1);
  await c.akui(o);
  await tolak(c, p);
  const salah = await testPrisma.$queryRawUnsafe(
    `SELECT d.id FROM payments d WHERE d.cancelled_at IS NOT NULL AND EXISTS (SELECT 1 FROM fin_journal_entries e WHERE e.source = 'PEMBAYARAN_ORDER' AND e.source_id = d.id::text AND e.status = 'POSTED' AND COALESCE(e.idempotency_key, '') NOT LIKE '%:RECLAS:%')`,
  );
  assert.equal(salah.length, 0);
});
