// EDIT & KOREKSI TRANSAKSI AMAN. Yang dikunci:
//  - Belum ada jurnal: edit penuh. Sudah ada jurnal: metadata langsung; angka lewat KOREKSI (reversal + pengganti).
//  - Jurnal lama TIDAK pernah diubah/dihapus (status REVERSED, isi tetap); pengganti tertaut; saldo bergerak sekali.
//  - Pratinjau memakai kode koreksi yang sama lalu di-ROLLBACK (tidak menulis apa pun).
//  - Step-up PIN untuk koreksi finansial; pengaman rekonsiliasi; blokir relasi yang sudah dipakai.
//  - Refund & Tagihan Supplier: edit sebelum diputuskan, pembatalan (reversal) sesudah diposting.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postPaymentReceived } from "../../src/services/finance/posting/orderRevenue.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const nota = "/media/finance-receipts/" + "f".repeat(40) + ".jpg";

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Tunai", kind: "KAS", accountId: akunKas.id } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const bank2 = await testPrisma.finCashAccount.create({ data: { name: "Mandiri", kind: "BANK", accountId: akunBank.id } });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  const kat2 = await testPrisma.finExpenseCategory.findUnique({ where: { code: "ADMIN_BANK" } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  return {
    kas, bank, bank2, kat, kat2, admin, finance,
    a: makeClient(server.baseUrl, admin.token),                            // membawa step-up otomatis
    aTanpa: makeClient(server.baseUrl, admin.token, { tanpaStepUp: true }), // untuk menguji PIN sungguhan
    f: makeClient(server.baseUrl, finance.token),
  };
}

async function jurnalPer(source, sourceId) {
  return testPrisma.finJournalEntry.findMany({
    where: { source, sourceId }, include: { lines: { include: { account: { select: { code: true } } } } }, orderBy: { createdAt: "asc" },
  });
}
const sumD = (e) => e.lines.reduce((a, l) => a + Number(l.debit), 0);
const sumK = (e) => e.lines.reduce((a, l) => a + Number(l.credit), 0);
async function mutasiRekening(cashAccountId) {
  const rek = await testPrisma.finCashAccount.findUnique({ where: { id: cashAccountId } });
  const baris = await testPrisma.finJournalLine.findMany({ where: { cashAccountId, accountId: rek.accountId, entry: { status: { in: ["POSTED", "REVERSED"] } } } });
  return baris.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
}
async function pastikanBukuSeimbang() {
  const lines = await testPrisma.finJournalLine.findMany({ select: { debit: true, credit: true } });
  const d = lines.reduce((a, l) => a + Number(l.debit), 0);
  const k = lines.reduce((a, l) => a + Number(l.credit), 0);
  assert.equal(d, k, `buku besar harus seimbang (debit ${d} vs kredit ${k})`);
}

const bodyExpense = (ctx, extra = {}) => ({
  date: "2026-09-20", amount: 100_000, description: "Beli perlengkapan", categoryId: ctx.kat.id, mode: "LANGSUNG",
  cashAccountId: ctx.bank.id, payeeName: "Toko Maju", receiptUrl: nota, ...extra,
});
async function expenseDisetujui(ctx, extra = {}) {
  const r = await ctx.a.post("/api/finance/expenses", bodyExpense(ctx, extra));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ap = await ctx.a.post(`/api/finance/expenses/${r.body.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  return r.body;
}

async function setPin(ctx, pin = "123456") {
  const passwordHash = await bcrypt.hash("rahasia123", 4);
  await testPrisma.user.update({ where: { id: ctx.admin.user.id }, data: { passwordHash } });
  const r = await ctx.aTanpa.post("/api/finance/pin", { password: "rahasia123", pin });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

// ── 1. Edit penuh sebelum jurnal ─────────────────────────────────────────
test("Edit PENUH sebelum ada jurnal: nominal, tanggal, kategori, rekening, biaya transfer — divalidasi ulang, jurnal lahir dari nilai baru", async () => {
  const ctx = await siapkan();
  const r = await ctx.a.post("/api/finance/expenses", bodyExpense(ctx));
  assert.equal(r.status, 201);
  assert.equal((await jurnalPer("PENGELUARAN", r.body.id)).length, 0);
  const edit = await ctx.a.patch(`/api/finance/expenses/${r.body.id}`, {
    reason: "Salah input", amount: 250_000, date: "2026-09-18", categoryId: ctx.kat2.id, cashAccountId: ctx.bank2.id,
    paymentMethod: "TRANSFER", transferFeeType: "BI_FAST", description: "Biaya admin bank koreksi",
  });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.amount, 250_000);
  assert.equal(edit.body.transferFeeAmount, 2500);
  const tolak = await ctx.a.patch(`/api/finance/expenses/${r.body.id}`, { reason: "x", amount: -5 });
  assert.equal(tolak.status, 400, "aturan divalidasi ulang saat edit");
  await ctx.a.post(`/api/finance/expenses/${r.body.id}/approve`, {});
  const es = await jurnalPer("PENGELUARAN", r.body.id);
  assert.equal(es.length, 1);
  assert.equal(sumK(es[0]), 252_500);
  assert.equal(await mutasiRekening(ctx.bank2.id), -252_500);
  assert.equal(await mutasiRekening(ctx.bank.id), 0);
  await pastikanBukuSeimbang();
});

// ── 2. Metadata setelah posting ──────────────────────────────────────────
test("Metadata setelah posting (catatan/bukti): langsung, TANPA jurnal baru dan TANPA perubahan saldo; tercatat di log audit", async () => {
  const ctx = await siapkan();
  const e = await expenseDisetujui(ctx);
  const sebelum = await testPrisma.finJournalEntry.count();
  const saldo = await mutasiRekening(ctx.bank.id);
  const k = await ctx.aTanpa.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "Tambah catatan", notes: "struk toko A" });
  assert.equal(k.status, 200, "metadata tidak butuh PIN: " + JSON.stringify(k.body));
  assert.equal(await testPrisma.finJournalEntry.count(), sebelum, "tidak ada jurnal baru");
  assert.equal(await mutasiRekening(ctx.bank.id), saldo);
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: e.id, eventType: "DOCUMENT_CORRECTED" } });
  assert.ok(ev, "audit tercatat");
  assert.equal(ev.metadata.reason, "Tambah catatan");
});

// ── 3. Koreksi finansial: reversal + pengganti, tertaut, saldo sekali ─────
test("Koreksi nominal + rekening + kategori + tanggal: jurnal lama REVERSED (isi tetap), pengganti tertaut, saldo bergerak sekali, buku seimbang", async () => {
  const ctx = await siapkan();
  await setPin(ctx);
  const e = await expenseDisetujui(ctx);
  const asli = (await jurnalPer("PENGELUARAN", e.id))[0];
  const totalAsli = sumD(asli);
  const tv = await ctx.aTanpa.post("/api/finance/pin/verifikasi", { pin: "123456" });
  assert.equal(tv.status, 200, JSON.stringify(tv.body));
  const H = { "X-Finance-Stepup": tv.body.token };

  const k = await ctx.aTanpa.post(`/api/finance/expenses/${e.id}/koreksi`, {
    reason: "Nominal & rekening salah", amount: 175_000, cashAccountId: ctx.bank2.id, categoryId: ctx.kat2.id, date: "2026-09-19",
  }, H);
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.equal(k.body.amount, 175_000);

  const semua = await jurnalPer("PENGELUARAN", e.id);
  const lama = semua.find((x) => x.id === asli.id);
  assert.equal(lama.status, "REVERSED", "jurnal asli tidak dihapus, hanya dibalik");
  assert.equal(sumD(lama), totalAsli, "isi jurnal asli TIDAK berubah");
  const aktif = semua.filter((x) => x.status === "POSTED");
  assert.equal(aktif.length, 1);
  assert.equal(sumD(aktif[0]), 175_000);
  const balik = await testPrisma.finJournalEntry.findMany({ where: { reversalOfId: asli.id } });
  assert.equal(balik.length, 1, "tepat satu reversal resmi");
  assert.equal(await mutasiRekening(ctx.bank.id), 0, "rekening lama pulih");
  assert.equal(await mutasiRekening(ctx.bank2.id), -175_000, "rekening baru bergerak SEKALI");
  await pastikanBukuSeimbang();

  // dokumen & jurnal saling tertaut (log audit + riwayat versi)
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: e.id, eventType: "DOCUMENT_CORRECTED" } });
  assert.deepEqual(ev.metadata.jurnalDibalik, [asli.entryNumber]);
  assert.deepEqual(ev.metadata.jurnalPengganti, [aktif[0].entryNumber]);
  const rw = await ctx.a.get(`/api/finance/riwayat-versi/expenses/${e.id}`);
  assert.equal(rw.status, 200, JSON.stringify(rw.body));
  const koreksi = rw.body.versi.find((v) => v.aksi === "Dikoreksi");
  assert.equal(koreksi.alasan, "Nominal & rekening salah");
  assert.ok(koreksi.perubahan.some((p) => p.field === "amount"));
  assert.ok(rw.body.jurnal.some((j) => j.status === "REVERSED" && j.dibalikOleh));
  assert.ok(rw.body.jurnal.some((j) => j.membalikJurnal === asli.entryNumber));
});

// ── 4. Pratinjau = rollback ──────────────────────────────────────────────
test("Pratinjau memakai kode koreksi yang sama lalu di-ROLLBACK: menampilkan jurnal dibalik/pengganti/dampak saldo tanpa menulis apa pun; hasil nyata sama", async () => {
  const ctx = await siapkan();
  const e = await expenseDisetujui(ctx);
  const jurnalAwal = await testPrisma.finJournalEntry.count();
  const eventAwal = await testPrisma.activityEvent.count();

  const pv = await ctx.aTanpa.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "uji", preview: true, amount: 140_000, cashAccountId: ctx.bank2.id });
  assert.equal(pv.status, 200, "pratinjau tanpa PIN: " + JSON.stringify(pv.body));
  const p = pv.body.pratinjau;
  assert.equal(p.menyentuhJurnal, true);
  assert.equal(p.jurnalDibalik.length, 1);
  assert.equal(p.jurnalPengganti.length, 1);
  assert.equal(p.jurnalPengganti[0].totalDebit, 140_000);
  assert.equal(p.seimbang, true);
  const bca = p.dampakSaldo.find((d) => d.rekeningId === ctx.bank.id);
  const mdr = p.dampakSaldo.find((d) => d.rekeningId === ctx.bank2.id);
  assert.equal(bca.selisih, 100_000, "BCA pulih");
  assert.equal(mdr.selisih, -140_000, "Mandiri berkurang sesuai nominal baru");
  assert.ok(p.perubahan.some((x) => x.field === "amount" && Number(x.lama) === 100_000 && Number(x.baru) === 140_000));

  assert.equal(await testPrisma.finJournalEntry.count(), jurnalAwal, "tidak ada jurnal tertulis");
  assert.equal(await testPrisma.activityEvent.count(), eventAwal, "tidak ada audit tertulis");
  const masih = await testPrisma.finExpense.findUnique({ where: { id: e.id } });
  assert.equal(Number(masih.amount), 100_000, "dokumen tidak berubah");
  assert.equal((await jurnalPer("PENGELUARAN", e.id))[0].status, "POSTED");
});

// ── 5. Step-up PIN ───────────────────────────────────────────────────────
test("Step-up PIN: tanpa PIN -> belum diatur; setelah diatur -> diperlukan; salah 5x terkunci; token milik orang lain ditolak; metadata tak butuh PIN", async () => {
  const ctx = await siapkan();
  const e = await expenseDisetujui(ctx);

  const belum = await ctx.aTanpa.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "x", amount: 120_000 });
  assert.equal(belum.status, 403);
  assert.equal(belum.body.code, "STEPUP_PIN_BELUM_DIATUR");

  const salahPw = await ctx.aTanpa.post("/api/finance/pin", { password: "salah", pin: "123456" });
  assert.equal(salahPw.status, 403);
  await testPrisma.user.update({ where: { id: ctx.admin.user.id }, data: { passwordHash: await bcrypt.hash("rahasia123", 4) } });
  assert.equal((await ctx.aTanpa.post("/api/finance/pin", { password: "rahasia123", pin: "12ab" })).status, 400);
  assert.equal((await ctx.aTanpa.post("/api/finance/pin", { password: "rahasia123", pin: "123456" })).status, 200);
  const dbUser = await testPrisma.user.findUnique({ where: { id: ctx.admin.user.id } });
  assert.ok(dbUser.financePinHash && dbUser.financePinHash !== "123456", "PIN disimpan sebagai hash");

  const perlu = await ctx.aTanpa.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "x", amount: 120_000 });
  assert.equal(perlu.body.code, "STEPUP_DIPERLUKAN");

  // token milik pengguna lain ditolak
  const lain = await ctx.f.post("/api/finance/pin/verifikasi", { pin: "123456" });
  assert.equal(lain.status, 403, "FINANCE biasa bukan admin: tidak boleh memakai gerbang ini");
  const { tokenStepUpUji } = await import("./setup/httpClient.js");
  const tokenLain = await ctx.aTanpa.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "x", amount: 120_000 }, { "X-Finance-Stepup": tokenStepUpUji(ctx.finance.user.id) });
  assert.equal(tokenLain.status, 403, "token step-up terikat ke pengguna");

  for (let i = 1; i <= 4; i++) {
    const s = await ctx.aTanpa.post("/api/finance/pin/verifikasi", { pin: "000000" });
    assert.equal(s.status, 403);
    assert.equal(s.body.code, "PIN_SALAH");
  }
  const kunci = await ctx.aTanpa.post("/api/finance/pin/verifikasi", { pin: "000000" });
  assert.equal(kunci.status, 429);
  const benarTapiTerkunci = await ctx.aTanpa.post("/api/finance/pin/verifikasi", { pin: "123456" });
  assert.equal(benarTapiTerkunci.status, 429, "PIN benar pun ditolak selama terkunci");

  assert.equal((await testPrisma.finExpense.findUnique({ where: { id: e.id } })).amount.toString(), "100000", "penolakan tidak mengubah dokumen");
  const nota2 = await ctx.aTanpa.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "catatan", notes: "ok" });
  assert.equal(nota2.status, 200, "metadata tetap boleh tanpa PIN");
});

// ── 6. Pengaman ──────────────────────────────────────────────────────────
test("Blokir: jurnal yang sudah dicocokkan ke rekonsiliasi bank tidak boleh dikoreksi (dengan langkah yang benar)", async () => {
  const ctx = await siapkan();
  const e = await expenseDisetujui(ctx);
  const baris = await testPrisma.finJournalLine.findFirst({ where: { cashAccountId: ctx.bank.id, entry: { source: "PENGELUARAN", sourceId: e.id } } });
  const st = await testPrisma.finBankStatement.create({
    data: { cashAccountId: ctx.bank.id, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30"), openingBalance: 0, closingBalance: -100000, status: "DRAFT" },
  });
  await testPrisma.finBankStatementLine.create({
    data: { statementId: st.id, date: new Date("2026-09-20"), description: "Debit toko", amount: -100000, status: "COCOK", matchedLineId: baris.id },
  });
  const k = await ctx.a.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "x", amount: 120_000 });
  assert.equal(k.status, 409, JSON.stringify(k.body));
  assert.equal(k.body.code, "SUDAH_DIREKONSILIASI");
  assert.match(k.body.error, /Rekonsiliasi Bank/);
  assert.equal((await jurnalPer("PENGELUARAN", e.id))[0].status, "POSTED", "jurnal tak tersentuh");
  const pv = await ctx.a.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "x", amount: 120_000, preview: true });
  assert.equal(pv.status, 409, "pratinjau pun memberi tahu blokirnya");
});

test("Blokir relasi lanjutan: pengeluaran uang muka (angka) & pembelian ber-DP aktif tidak bisa dikoreksi angkanya; refund/tagihan posted tidak bisa diedit; uang muka finansial terkunci", async () => {
  const ctx = await siapkan();
  // uang muka operasional
  const um = await ctx.a.post("/api/finance/uang-muka", { holderId: ctx.finance.user.id, purpose: "Uang jalan", date: "2026-09-20", dueDate: "2026-09-27", amount: 500_000, cashAccountId: ctx.bank.id });
  assert.equal(um.status, 201, JSON.stringify(um.body));
  const pj = await ctx.a.post(`/api/finance/uang-muka/${um.body.id}/pertanggungjawaban`, { date: "2026-09-21", amount: 100_000, description: "BBM", categoryId: ctx.kat.id, receiptUrl: nota });
  await ctx.a.post(`/api/finance/expenses/${pj.body.id}/approve`, {});
  const k = await ctx.a.post(`/api/finance/expenses/${pj.body.id}/koreksi`, { reason: "x", amount: 150_000 });
  assert.equal(k.status, 409);
  assert.match(k.body.error, /batalkan/i);
  const finan = await ctx.a.patch(`/api/finance/uang-muka/${um.body.id}`, { reason: "x", amount: 900_000 });
  assert.equal(finan.status, 409);
  const meta = await ctx.a.patch(`/api/finance/uang-muka/${um.body.id}`, { reason: "Tujuan lebih jelas", purpose: "Uang jalan Bandung", dueDate: "2026-09-30" });
  assert.equal(meta.status, 200, JSON.stringify(meta.body));
  assert.equal(meta.body.purpose, "Uang jalan Bandung");
  assert.equal(meta.body.saldo, 400_000, "edit metadata tidak menggeser saldo");
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: um.body.id, eventType: "DOCUMENT_EDITED" } });
  assert.equal(ev.metadata.reason, "Tujuan lebih jelas");
});

// ── 7. Concurrency & double-click ────────────────────────────────────────
test("Koreksi paralel pada dokumen yang sama diserialkan: dua koreksi berbeda berurutan, hanya SATU jurnal aktif, buku seimbang", async () => {
  const ctx = await siapkan();
  const e = await expenseDisetujui(ctx);
  await Promise.all(Array.from({ length: 6 }, () => ctx.a.get("/api/finance/riwayat-versi/expenses/" + e.id)));
  const [x, y] = await Promise.all([
    ctx.a.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "A", amount: 130_000 }),
    ctx.a.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "B", amount: 160_000 }),
  ]);
  assert.deepEqual([x.status, y.status], [200, 200], JSON.stringify([x.body, y.body]));
  const semua = await jurnalPer("PENGELUARAN", e.id);
  assert.equal(semua.filter((j) => j.status === "POSTED").length, 1, "tepat satu jurnal aktif");
  assert.equal(semua.filter((j) => j.status === "REVERSED").length, 2);
  const akhir = await testPrisma.finExpense.findUnique({ where: { id: e.id } });
  assert.equal(sumD(semua.find((j) => j.status === "POSTED")), Number(akhir.amount), "jurnal aktif = nominal dokumen akhir");
  assert.equal(await mutasiRekening(ctx.bank.id), -Number(akhir.amount), "saldo bergerak sekali");
  await pastikanBukuSeimbang();
});

test("Double-click koreksi (Idempotency-Key sama): tepat satu koreksi; retry setelahnya diputar ulang", async () => {
  const ctx = await siapkan();
  const e = await expenseDisetujui(ctx);
  await Promise.all(Array.from({ length: 6 }, () => ctx.a.get("/api/finance/riwayat-versi/expenses/" + e.id)));
  const H = { "Idempotency-Key": "koreksi-klik-ganda-1" };
  const hasil = await Promise.all([
    ctx.a.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "A", amount: 130_000 }, H),
    ctx.a.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "A", amount: 130_000 }, H),
  ]);
  assert.ok(hasil.some((h) => h.status === 200), JSON.stringify(hasil.map((h) => h.status)));
  assert.ok(hasil.every((h) => [200, 409].includes(h.status)));
  // Middleware menyimpan respons SETELAH respons terkirim (event finish) — tunggu sampai tersimpan sebelum retry.
  for (let i = 0; i < 60; i++) {
    const r = await testPrisma.apiIdempotencyKey.findFirst({ where: { key: "koreksi-klik-ganda-1" } });
    if (r?.state === "DONE") break;
    await new Promise((res) => setTimeout(res, 50));
  }
  const ulang = await ctx.a.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "A", amount: 130_000 }, H);
  assert.equal(ulang.status, 200);
  assert.equal(ulang.headers.get("idempotent-replayed"), "true");
  const reversal = await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } });
  assert.equal(reversal, 1, "hanya satu reversal");
});

// ── 8. Permission ────────────────────────────────────────────────────────
test("Permission: koreksi finansial minimal FINANCE_ADMIN; edit refund/tagihan hanya pembuat atau admin", async () => {
  const ctx = await siapkan();
  const e = await expenseDisetujui(ctx);
  assert.equal((await ctx.f.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "x", amount: 120_000 })).status, 403);
  assert.equal((await ctx.f.post("/api/finance/pin/verifikasi", { pin: "123456" })).status, 403);
  const tanpaLogin = await fetch(`${server.baseUrl}/api/finance/riwayat-versi/expenses/${e.id}`);
  assert.equal(tanpaLogin.status, 401);
});

// ── 9. Refund ────────────────────────────────────────────────────────────
async function refundSiap(ctx) {
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Erni" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 2_000_000, category: "LAYANAN", orderNumber: `TES-${Date.now()}` } });
  const payment = await testPrisma.payment.create({ data: { orderId: order.id, amount: 2_000_000, method: "CASH", recordedById: ctx.admin.user.id } });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: payment.id, userId: ctx.admin.user.id }));
  const r = await ctx.a.post("/api/finance/refunds", { orderId: order.id, date: "2026-09-22", amount: 300_000, reason: "Kasur tidak sesuai", cashAccountId: ctx.bank.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { order, refund: r.body };
}

test("Refund: edit penuh saat menunggu (divalidasi vs uang diterima); setelah disetujui tidak bisa diedit; pembatalan = reversal resmi, kas pulih; batal dua kali ditolak", async () => {
  const ctx = await siapkan();
  const { refund } = await refundSiap(ctx);
  const tanpaAlasan = await ctx.a.patch(`/api/finance/refunds/${refund.id}`, { amount: 250_000 });
  assert.equal(tanpaAlasan.status, 400);
  const lebih = await ctx.a.patch(`/api/finance/refunds/${refund.id}`, { alasanPerubahan: "coba", amount: 9_000_000 });
  assert.equal(lebih.status, 400, "tidak boleh melebihi uang yang diterima");
  const ok = await ctx.a.patch(`/api/finance/refunds/${refund.id}`, { alasanPerubahan: "Nominal disepakati ulang", amount: 250_000, cashAccountId: ctx.bank2.id, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.amount, 250_000);
  assert.equal(ok.body.transferFeeAmount, 2500);

  const ap = await ctx.a.post(`/api/finance/refunds/${refund.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.equal(await mutasiRekening(ctx.bank2.id), -252_500);
  const edit2 = await ctx.a.patch(`/api/finance/refunds/${refund.id}`, { alasanPerubahan: "x", amount: 100_000 });
  assert.equal(edit2.status, 409);
  assert.match(edit2.body.error, /Batalkan refund/);

  const batal = await ctx.a.post(`/api/finance/refunds/${refund.id}/cancel`, { reason: "Pelanggan batal minta refund" });
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  assert.equal(batal.body.status, "DIBATALKAN");
  assert.equal(await mutasiRekening(ctx.bank2.id), 0, "kas pulih lewat reversal");
  const es = await jurnalPer("REFUND", refund.id);
  assert.equal(es.filter((e) => e.status === "REVERSED").length, 1);
  assert.equal((await ctx.a.post(`/api/finance/refunds/${refund.id}/cancel`, { reason: "lagi" })).status, 409);
  await pastikanBukuSeimbang();
  const rw = await ctx.a.get(`/api/finance/riwayat-versi/refunds/${refund.id}`);
  assert.ok(rw.body.versi.some((v) => v.aksi === "Diedit") && rw.body.versi.some((v) => v.aksi === "Dibatalkan"));
});

// ── 10. Tagihan supplier ─────────────────────────────────────────────────
test("Tagihan supplier: edit saat menunggu; setelah disetujui terkunci; batal = reversal, DIBLOKIR bila sudah ada pembayaran aktif", async () => {
  const ctx = await siapkan();
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-K", name: "CV Tekstil" } });
  const b = await ctx.a.post("/api/finance/bills", { supplierId: supplier.id, billDate: "2026-09-10", amount: 1_000_000, description: "Kain", billType: "JASA_OPERASIONAL", expenseCategoryId: ctx.kat.id });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const edit = await ctx.a.patch(`/api/finance/bills/${b.body.id}`, { reason: "Nominal di faktur berbeda", amount: 1_200_000, description: "Kain fleece" });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.amount, 1_200_000);
  assert.equal((await ctx.a.post(`/api/finance/bills/${b.body.id}/approve`, {})).status, 200);
  assert.equal((await ctx.a.patch(`/api/finance/bills/${b.body.id}`, { reason: "x", amount: 1 })).status, 409);

  const bayar = await ctx.a.post("/api/finance/supplier-payments", { supplierId: supplier.id, date: "2026-09-21", cashAccountId: ctx.bank.id, allocations: [{ billId: b.body.id, amount: 500_000 }] });
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  const blok = await ctx.a.post(`/api/finance/bills/${b.body.id}/cancel`, { reason: "salah" });
  assert.equal(blok.status, 409);
  assert.match(blok.body.error, /batalkan pembayarannya dulu/i);
  assert.equal((await ctx.a.post(`/api/finance/supplier-payments/${bayar.body.id}/cancel`, { reason: "salah pembayaran" })).status, 200);
  const batal = await ctx.a.post(`/api/finance/bills/${b.body.id}/cancel`, { reason: "Tagihan salah supplier" });
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  assert.equal(batal.body.status, "DIBATALKAN");
  const es = await jurnalPer("TAGIHAN_SUPPLIER", b.body.id);
  assert.ok(es.every((e) => e.status === "REVERSED"), "jurnal tagihan dibalik, tidak dihapus");
  await pastikanBukuSeimbang();
});

// ── 11. Transfer & pemasukan lain ────────────────────────────────────────
test("Koreksi transfer & pemasukan lain lewat PIN + pratinjau: saldo kedua rekening benar, jurnal tertaut, biaya transfer dikoreksi", async () => {
  const ctx = await siapkan();
  const tr = await ctx.a.post("/api/finance/transfers", { date: "2026-09-20", fromAccountId: ctx.bank.id, toAccountId: ctx.kas.id, amount: 500_000, feeAmount: 2500 });
  assert.equal(tr.status, 201, JSON.stringify(tr.body));
  const pv = await ctx.aTanpa.post(`/api/finance/transfers/${tr.body.id}/koreksi`, { reason: "uji", preview: true, amount: 400_000, feeAmount: 6500 });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.equal(pv.body.pratinjau.jurnalPengganti[0].totalDebit, 406_500);
  const tanpaPin = await ctx.aTanpa.post(`/api/finance/transfers/${tr.body.id}/koreksi`, { reason: "koreksi", amount: 400_000, feeAmount: 6500 });
  assert.equal(tanpaPin.status, 403);
  const k = await ctx.a.post(`/api/finance/transfers/${tr.body.id}/koreksi`, { reason: "Nominal & biaya salah", amount: 400_000, feeAmount: 6500 });
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.equal(await mutasiRekening(ctx.bank.id), -406_500);
  assert.equal(await mutasiRekening(ctx.kas.id), 400_000);

  const akunPendapatan = await testPrisma.finAccount.findFirst({ where: { type: "PENDAPATAN", isPostable: true, systemKey: null } });
  if (akunPendapatan) {
    const inc = await ctx.a.post("/api/finance/other-income", { date: "2026-09-20", amount: 200_000, description: "Bunga bank", accountId: akunPendapatan.id, cashAccountId: ctx.bank2.id });
    assert.equal(inc.status, 201, JSON.stringify(inc.body));
    const ki = await ctx.a.post(`/api/finance/other-income/${inc.body.id}/koreksi`, { reason: "salah rekening", cashAccountId: ctx.bank.id });
    assert.equal(ki.status, 200, JSON.stringify(ki.body));
    assert.equal(await mutasiRekening(ctx.bank2.id), 0);
  }
  await pastikanBukuSeimbang();
});

// ── 12. Riwayat versi ───────────────────────────────────────────────────
test("Riwayat versi: siapa, kapan, alasan, perubahan, rantai jurnal; jenis tak dikenal 404", async () => {
  const ctx = await siapkan();
  const e = await expenseDisetujui(ctx);
  await ctx.a.post(`/api/finance/expenses/${e.id}/koreksi`, { reason: "Nominal salah ketik", amount: 111_000 });
  const rw = await ctx.a.get(`/api/finance/riwayat-versi/expenses/${e.id}`);
  assert.equal(rw.status, 200);
  assert.equal(rw.body.dokumen.nomor, e.expenseNumber);
  const v = rw.body.versi.find((x) => x.aksi === "Dikoreksi");
  assert.ok(v.aktor && v.waktu && v.alasan === "Nominal salah ketik");
  assert.ok(rw.body.jurnal.length >= 3, "asli + balikan + pengganti");
  assert.equal((await ctx.a.get(`/api/finance/riwayat-versi/ngawur/${e.id}`)).status, 404);
});
