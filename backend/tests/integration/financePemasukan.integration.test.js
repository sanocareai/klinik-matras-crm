// PEMASUKAN TERPADU (read-model agregator) lewat endpoint ASLI. Yang dijaga: pemisahan tegas pendapatan / pembayaran / piutang / pemasukan lain / dana bukan
// pendapatan / transfer, TIDAK ADA hitung ganda (invoice belum dibayar, DP-cicilan-pelunasan, pembayaran vs pendapatan), retur bertanda negatif, pembayaran ditolak/
// dibatalkan/dibalik, data meragukan → "Perlu ditinjau", izin, paginasi/filter, dan bahwa membaca TIDAK membuat jurnal.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw, DEVICE } from "./setup/authFixtures.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal, reverseJournal } from "../../src/services/finance/journal.js";
import { bukukanPembayaran } from "../../src/services/finance/hooks.js";
import { postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { toMoney } from "../../src/services/finance/money.js";
import { klasifikasiJurnal } from "../../src/services/finance/pemasukan.js";

let server; let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function masuk(roles) {
  const u = await createLoginUser({ roles });
  const r = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device: DEVICE() } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...u, token: r.body.accessToken };
}
const k = () => ({ "Idempotency-Key": randomUUID() });
const get = (u, path) => raw("GET", `/api/finance${path}`, { token: u.token });
const post = (u, path, body) => raw("POST", `/api/finance${path}`, { token: u.token, headers: k(), body: body ?? {} });
const PER = "from=2026-09-01&to=2026-09-30";

let no = 0;
async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akun = (systemKey) => testPrisma.finAccount.findUnique({ where: { systemKey } });
  const bankA = await akun(SYSTEM_KEYS.BANK); const kasA = await akun(SYSTEM_KEYS.KAS);
  const bank = await testPrisma.finCashAccount.create({ data: { name: "SANOBANK Kemal", kind: "BANK", accountId: bankA.id } });
  const bank2 = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: bankA.id } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: kasA.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, kas.id);
  const kode = (c) => testPrisma.finAccount.findFirst({ where: { code: c } });
  const admin = (await createTestUser({ roles: ["ADMIN"] })).user;
  return { bank, bank2, kas, bankA, modal: await kode("3-1100"), pihak3: await kode("2-1600"), retur: await kode("4-2100"), lain: await kode("4-9100"), piutang: await kode("1-1300"), koreksi: await kode("3-4100"), beban: await testPrisma.finAccount.findFirst({ where: { type: "BEBAN", isPostable: true } }), admin };
}
const jurnal = (ctx, { source, tanggal = "2026-09-10", baris, key = null, desc = "uji" }) => testPrisma.$transaction((tx) => postJournal(tx, { date: tanggal, description: desc, source, idempotencyKey: key ?? `PMS:${randomUUID()}`, userId: ctx.admin.id, lines: baris }));
async function buatOrder({ value = 1_000_000, nama = "Ibu Erni", createdAt = new Date("2026-09-05T03:00:00Z") } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: nama } });
  return testPrisma.order.create({ data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `SAN-PM-${String(++no).padStart(4, "0")}`, status: "DELIVERED", paymentStatus: "BELUM_BAYAR", createdAt } });
}
async function bayar(ctx, order, { amount, cashAccountId, verif = false, tanggal = new Date("2026-09-10T03:00:00Z"), jurnalKan = true }) {
  const p = await testPrisma.payment.create({ data: { orderId: order.id, amount, method: "TRANSFER", cashAccountId, recordedById: ctx.admin.id, createdAt: tanggal } });
  if (jurnalKan) await testPrisma.$transaction((tx) => bukukanPembayaran(tx, { paymentId: p.id, userId: ctx.admin.id }));
  if (verif) await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: ctx.admin.id } });
  return p;
}
const akunOrder = (ctx, key) => testPrisma.finAccount.findUnique({ where: { systemKey: key } });
const semua = async (u, q = "") => { const r = await get(u, `/pemasukan?${PER}&limit=100${q}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.items; };
const ring = async (u) => { const r = await get(u, `/pemasukan/ringkasan?${PER}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };

test("Invoice/order belum dibayar: pendapatan DAN piutang, BUKAN penerimaan kas", async () => {
  const c = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const o = await buatOrder({ value: 1_000_000 });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: c.admin.id, date: "2026-09-10" }));
  const r = await ring(fin);
  assert.equal(r.pendapatanSistem.nilai, "1000000.00");
  assert.equal(r.pembayaranMasuk.terverifikasi.nilai, "0.00");
  assert.equal(r.pembayaranMasuk.menunggu.nilai, "0.00");
  assert.equal(r.piutangTersisa.nilai, "1000000.00");
  assert.equal(r.pendapatanGabungan.nilai, "1000000.00", "gabungan = sistem + historis (0), tanpa pembayaran");
  const kas = await testPrisma.finJournalLine.aggregate({ where: { cashAccountId: { not: null } }, _sum: { debit: true } });
  assert.equal(Number(kas._sum.debit ?? 0), 0, "tidak ada uang masuk ke kas");
});

test("DP, cicilan, pelunasan: pendapatan tetap SEKALI; pembayaran dihitung terpisah; tidak dijumlahkan menjadi satu total", async () => {
  const c = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const o = await buatOrder({ value: 1_000_000 });
  await bayar(c, o, { amount: 400_000, cashAccountId: c.bank.id, verif: true });                       // DP sebelum pengakuan
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: c.admin.id, date: "2026-09-12" }));
  await bayar(c, o, { amount: 300_000, cashAccountId: c.bank.id, verif: true, tanggal: new Date("2026-09-15T03:00:00Z") }); // cicilan
  await bayar(c, o, { amount: 300_000, cashAccountId: c.bank2.id, verif: false, tanggal: new Date("2026-09-20T03:00:00Z") }); // pelunasan belum diverifikasi
  const r = await ring(fin);
  assert.equal(r.pendapatanSistem.nilai, "1000000.00", "pendapatan TIDAK bertambah oleh DP/cicilan/pelunasan");
  assert.equal(r.pembayaranMasuk.terverifikasi.nilai, "700000.00");
  assert.equal(r.pembayaranMasuk.menunggu.nilai, "300000.00");
  assert.equal(r.pendapatanGabungan.nilai, "1000000.00", "gabungan TIDAK ditambah pembayaran");
  // jurnal PEMBAYARAN_ORDER tidak muncul lagi sebagai baris jurnal (hindari hitung ganda)
  const baris = await semua(fin);
  assert.equal(baris.filter((b) => b.jenis === "jurnal" && b.sumber === "PEMBAYARAN_ORDER").length, 0);
  assert.equal(baris.filter((b) => b.kategori === "PEMBAYARAN").length, 3);
  // pendapatan/pembayaran tidak menghasilkan baris DANA/LAIN/DITINJAU
  assert.equal(baris.filter((b) => ["DANA", "LAIN", "DITINJAU"].includes(b.kategori)).length, 0, JSON.stringify(baris.filter((b) => ["DANA", "LAIN", "DITINJAU"].includes(b.kategori))));
  assert.equal(r.piutangTersisa.nilai, "0.00", "semua pembayaran sudah dibukukan (verifikasi = audit, bukan gerbang) → piutang order lunas; dihitung server dari ledger");
});

test("Pembayaran: ditolak, dibatalkan, dan dibalik mengikuti data resmi — tidak dihitung; jurnal balik tidak muncul sebagai pemasukan", async () => {
  const c = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const approver = await masuk(["FINANCE"]);
  const o = await buatOrder({ value: 900_000 });
  const p1 = await bayar(c, o, { amount: 200_000, cashAccountId: c.bank.id });
  const p2 = await bayar(c, o, { amount: 100_000, cashAccountId: c.bank.id });
  await bayar(c, o, { amount: 50_000, cashAccountId: c.bank.id, verif: true });
  const tolak = await post(approver, `/pembayaran/${p1.id}/tolak`, { reason: "uang tidak masuk" });
  assert.equal(tolak.status, 200, JSON.stringify(tolak.body));
  await testPrisma.payment.update({ where: { id: p2.id }, data: { cancelledAt: new Date(), cancelledById: c.admin.id, cancelReason: "salah catat" } });
  const r = await ring(fin);
  assert.equal(r.pembayaranMasuk.terverifikasi.nilai, "50000.00");
  assert.equal(r.pembayaranMasuk.menunggu.nilai, "0.00");
  assert.equal(r.pembayaranMasuk.tidakDihitung.jumlah, 2);
  const baris = await semua(fin);
  assert.deepEqual(baris.filter((b) => b.jenis === "jurnal").map((b) => b.sumber), [], "jurnal pembayaran & pembaliknya tidak menjadi baris pemasukan");
  const st = Object.fromEntries(baris.filter((b) => b.kategori === "PEMBAYARAN").map((b) => [b.nilai, b.status]));
  assert.equal(st["200000.00"], "DITOLAK");
  assert.equal(st["100000.00"], "DIBATALKAN");
});

test("Pemasukan Lain tidak bercampur pendapatan penjualan; pinjaman & setoran modal = dana bukan pendapatan; transfer dikecualikan; saldo awal/koreksi dikecualikan", async () => {
  const c = await siapkan();
  const fin = await masuk(["FINANCE"]);
  // Pemasukan Lain lewat workflow resmi
  const ok = await post(fin, "/other-income", { description: "Bunga bank", amount: "75000.50", accountId: c.lain.id, cashAccountId: c.bank.id, date: "2026-09-11" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const penjualan = await akunOrder(c, "PENDAPATAN_PRODUK");
  assert.equal((await post(fin, "/other-income", { description: "Coba jalan pintas", amount: "1000", accountId: penjualan.id, cashAccountId: c.bank.id })).status, 400, "akun penjualan ditolak di Pemasukan Lain");
  await jurnal(c, { source: "MANUAL", baris: [{ accountId: c.bankA.id, cashAccountId: c.bank.id, debit: toMoney(5_000_000) }, { accountId: c.modal.id, credit: toMoney(5_000_000) }] });
  await jurnal(c, { source: "MANUAL", baris: [{ accountId: c.bankA.id, cashAccountId: c.bank2.id, debit: toMoney(3_000_000) }, { accountId: c.pihak3.id, credit: toMoney(3_000_000) }] });
  await jurnal(c, { source: "TRANSFER_KAS", baris: [{ accountId: c.bankA.id, cashAccountId: c.bank2.id, debit: toMoney(2_000_000) }, { accountId: c.bankA.id, cashAccountId: c.bank.id, credit: toMoney(2_000_000) }] });
  await jurnal(c, { source: "SALDO_AWAL", baris: [{ accountId: c.bankA.id, cashAccountId: c.bank.id, debit: toMoney(9_000_000) }, { accountId: c.koreksi.id, credit: toMoney(9_000_000) }] });
  const r = await ring(fin);
  assert.equal(r.pemasukanLain.nilai, "75000.50");
  assert.equal(r.pendapatanSistem.nilai, "0.00", "Pemasukan Lain TIDAK masuk pendapatan penjualan");
  assert.equal(r.danaMasukBukanPendapatan.nilai, "8000000.00");
  assert.deepEqual(r.danaMasukBukanPendapatan.rincian.map((x) => x.sub).sort(), ["PENDANAAN_PIHAK_KETIGA", "SETORAN_MODAL"]);
  assert.equal(r.dikecualikan.transfer.nilai, "2000000.00");
  assert.equal(r.dikecualikan.saldoAwal.nilai, "9000000.00");
  const baris = await semua(fin);
  assert.ok(!baris.some((b) => b.kategori === "DANA" && b.sub === "TRANSFER"));
  assert.ok(!baris.some((b) => ["PENDAPATAN", "DANA", "LAIN"].includes(b.kategori) && b.sumber === "SALDO_AWAL"), "koreksi saldo tidak jadi pemasukan");
  assert.equal(r.pendapatanGabungan.nilai, "0.00");
});

test("Retur/potongan mengurangi pendapatan dengan tanda benar; nominal negatif tampil utuh (tidak dipotong nol)", async () => {
  const c = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const o = await buatOrder({ value: 500_000 });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: c.admin.id, date: "2026-09-10" }));
  await jurnal(c, { source: "REFUND", tanggal: "2026-09-14", baris: [{ accountId: c.retur.id, debit: toMoney(120_000.55) }, { accountId: c.bankA.id, cashAccountId: c.bank.id, credit: toMoney(120_000.55) }] });
  const r = await ring(fin);
  assert.equal(r.pendapatanSistem.nilai, "379999.45");
  assert.equal(r.pendapatanSistem.bruto, "500000.00");
  assert.equal(r.pendapatanSistem.retur, "-120000.55");
  const baris = await semua(fin, "&kategori=PENDAPATAN");
  const retur = baris.find((b) => b.sub === "RETUR");
  assert.equal(retur.nilai, "-120000.55");
  assert.equal(r.dikecualikan.pembalikanBiaya.jumlah, 0);
});

test("Data tidak jelas → 'Perlu ditinjau' (tidak ditebak, tidak dihitung ke kelas mana pun); pembalikan pengeluaran dikecualikan; pembayaran terverifikasi tanpa jurnal ditandai", async () => {
  const c = await siapkan();
  const fin = await masuk(["FINANCE"]);
  await jurnal(c, { source: "MANUAL", baris: [{ accountId: c.bankA.id, cashAccountId: c.bank.id, debit: toMoney(300_000) }, { accountId: c.piutang.id, credit: toMoney(300_000) }] });   // pelunasan manual di luar alur
  await jurnal(c, { source: "MANUAL", baris: [{ accountId: c.bankA.id, cashAccountId: c.bank.id, debit: toMoney(40_000) }, { accountId: c.beban.id, credit: toMoney(40_000) }] });      // ke akun beban: tak jelas
  const eks = await jurnal(c, { source: "PENGELUARAN", baris: [{ accountId: c.beban.id, debit: toMoney(80_000) }, { accountId: c.bankA.id, cashAccountId: c.bank.id, credit: toMoney(80_000) }] });
  await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: eks.entry.id, date: "2026-09-11", reason: "salah input", userId: c.admin.id }));
  const o = await buatOrder({ value: 1_980_000 });
  await bayar(c, o, { amount: 1_980_000, cashAccountId: null, verif: true }); // rekening belum dipetakan → gap, tanpa jurnal
  const r = await ring(fin);
  assert.equal(r.perluDitinjau.nilai, "340000.00".replace("340000.00", (300_000 + 40_000 + 1_980_000).toFixed(2)));
  assert.equal(r.dikecualikan.pembalikanBiaya.nilai, "80000.00");
  assert.equal(r.danaMasukBukanPendapatan.nilai, "0.00");
  assert.equal(r.pemasukanLain.nilai, "0.00");
  assert.equal(r.pembayaranMasuk.belumDibukukan.nilai, "1980000.00");
  const baris = await semua(fin, "&kategori=DITINJAU");
  assert.ok(baris.every((b) => b.perluTinjau && b.catatan));
});

test("Klasifikasi murni dari AKUN & SUMBER, bukan deskripsi: deskripsi menyesatkan tidak mengubah kelas", () => {
  const akun = (code, type, systemKey = null) => ({ code, type, systemKey });
  const baris = (debit, credit, a, cash = null) => ({ debit, credit, cashAccountId: cash, orderId: null, cashAccount: cash ? { name: "Bank" } : null, customer: null, account: a });
  const menyesatkan = { source: "MANUAL", description: "PENDAPATAN PENJUALAN KASUR LUNAS", reversalOf: null, lines: [baris(100, 0, akun("1-1200", "ASET"), "c1"), baris(0, 100, akun("2-1600", "KEWAJIBAN", "UTANG_PIHAK_KETIGA"))] };
  const hasil = klasifikasiJurnal(menyesatkan);
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].kategori, "DANA");
  const pen = { source: "PENGAKUAN_PENDAPATAN", description: "pinjaman modal", reversalOf: null, lines: [baris(500, 0, akun("1-1300", "ASET")), baris(0, 500, akun("4-1200", "PENDAPATAN", "PENDAPATAN_PRODUK"))] };
  assert.equal(klasifikasiJurnal(pen)[0].kategori, "PENDAPATAN");
});

test("Membaca TIDAK membuat jurnal/transaksi; izin: tanpa sesi 401, tanpa FINANCE_READ 403, ACCOUNTANT/APPROVER boleh baca tetapi tulis Data Sebelum Sistem hanya untuk yang boleh mencatat", async () => {
  const c = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const o = await buatOrder({ value: 200_000 });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: c.admin.id, date: "2026-09-10" }));
  const sebelum = { j: await testPrisma.finJournalEntry.count(), l: await testPrisma.finJournalLine.count(), o: await testPrisma.finOtherIncome.count() };
  for (const path of ["/pemasukan/ringkasan", "/pemasukan", "/pemasukan/opsi", "/pemasukan/legacy/cutoff", "/pemasukan/legacy/rekonsiliasi", "/pemasukan/legacy/proposal"]) assert.equal((await get(fin, path)).status, 200, path);
  const setelah = { j: await testPrisma.finJournalEntry.count(), l: await testPrisma.finJournalLine.count(), o: await testPrisma.finOtherIncome.count() };
  assert.deepEqual(setelah, sebelum, "tidak ada jurnal baru");
  assert.equal((await raw("GET", "/api/finance/pemasukan/ringkasan")).status, 401);
  const sales = await createLoginUser({ roles: ["SALES"] });
  const lg = await raw("POST", "/api/auth/login", { body: { email: sales.email, password: sales.password } });
  if (lg.body?.token) assert.equal((await raw("GET", "/api/finance/pemasukan/ringkasan", { token: lg.body.token })).status, 403);
  const approver = await masuk(["APPROVER"]);
  assert.equal((await get(approver, "/pemasukan/ringkasan")).status, 200);
  assert.equal((await post(approver, "/pemasukan/legacy/batch/00000000-0000-0000-0000-000000000000/impor")).status, 403, "APPROVER tidak punya FINANCE_POST");
  const opsi = (await get(approver, "/pemasukan/opsi")).body;
  assert.equal(opsi.aksiCatat.boleh, false);
  assert.equal((await get(fin, "/pemasukan/opsi")).body.aksiCatat.tujuan.modul, "pemasukan", "pencatatan hanya mengarah ke Pemasukan Lain");
});

test("Daftar: paginasi, filter kategori/rekening/status/pencarian, detail jurnal & pembayaran; uang string desimal", async () => {
  const c = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const o = await buatOrder({ value: 800_000, nama: "Bapak Budi Santoso" });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: c.admin.id, date: "2026-09-10" }));
  const p = await bayar(c, o, { amount: 250_000, cashAccountId: c.bank.id, verif: true });
  await bayar(c, o, { amount: 150_000, cashAccountId: c.bank2.id });
  await post(fin, "/other-income", { description: "Komisi marketplace", amount: "5000", accountId: c.lain.id, cashAccountId: c.bank.id, date: "2026-09-12" });
  const h1 = (await get(fin, `/pemasukan?${PER}&limit=2&page=1`)).body;
  assert.equal(h1.items.length, 2);
  assert.ok(h1.adaLagi);
  assert.ok(h1.total >= 4);
  assert.match(h1.totalNilai, /^-?\d+\.\d{2}$/);
  assert.equal((await semua(fin, "&kategori=PEMBAYARAN&rekening=PT%20Sano")).length, 1);
  assert.equal((await semua(fin, "&status=TERVERIFIKASI")).length, 1);
  assert.equal((await semua(fin, "&q=budi")).length >= 2, true);
  assert.equal((await get(fin, `/pemasukan?${PER}&kategori=NGAWUR`)).status, 400);
  const dp = (await get(fin, `/pemasukan/pembayaran/${p.id}`)).body;
  assert.equal(dp.klasifikasi[0].kategori, "PEMBAYARAN");
  const j = (await semua(fin, "&kategori=PENDAPATAN"))[0];
  const dj = (await get(fin, `/pemasukan/jurnal/${j.id}`)).body;
  assert.equal(dj.klasifikasi[0].kategori, "PENDAPATAN");
  assert.equal((await get(fin, "/pemasukan/jurnal/00000000-0000-0000-0000-000000000000")).status, 404);
  assert.equal((await get(fin, "/pemasukan/ngawur/x")).status, 404);
});

test("Kunci: setiap jurnal masuk paling banyak satu kelas uang-masuk (tidak ada hitung ganda antar kelas)", async () => {
  const c = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const o = await buatOrder({ value: 400_000 });
  await bayar(c, o, { amount: 100_000, cashAccountId: c.bank.id, verif: true });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: c.admin.id, date: "2026-09-12" }));
  await post(fin, "/other-income", { description: "Bunga", amount: "1000", accountId: c.lain.id, cashAccountId: c.bank.id, date: "2026-09-13" });
  await jurnal(c, { source: "MANUAL", baris: [{ accountId: c.bankA.id, cashAccountId: c.bank.id, debit: toMoney(7000) }, { accountId: c.modal.id, credit: toMoney(7000) }] });
  const baris = await semua(fin);
  const perJurnal = new Map();
  for (const b of baris.filter((x) => x.jenis === "jurnal")) perJurnal.set(b.id, [...(perJurnal.get(b.id) ?? []), b.kategori]);
  for (const [, kat] of perJurnal) assert.equal(new Set(kat).size, kat.length, `kelas ganda pada satu jurnal: ${kat}`);
  assert.equal(new Set(baris.map((b) => b.key)).size, baris.length, "kunci baris unik");
});

test("Kontrak klien: respons ringkasan & daftar lengkap (semua kelas) — DUMP_PEMASUKAN=1 menyimpan fixture untuk uji kontrak mobile", async () => {
  const c = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const o = await buatOrder({ value: 1_000_000, nama: "Ibu Erni" });
  await bayar(c, o, { amount: 400_000, cashAccountId: c.bank.id, verif: true });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: c.admin.id, date: "2026-09-12" }));
  await bayar(c, o, { amount: 600_000, cashAccountId: c.bank2.id, verif: false, tanggal: new Date("2026-09-20T03:00:00Z") });
  await bayar(c, o, { amount: 1_980_000, cashAccountId: null, verif: true, tanggal: new Date("2026-09-21T03:00:00Z"), jurnalKan: false });
  await post(fin, "/other-income", { description: "Bunga bank", amount: "75000.50", accountId: c.lain.id, cashAccountId: c.bank.id, date: "2026-09-11" });
  await jurnal(c, { source: "MANUAL", baris: [{ accountId: c.bankA.id, cashAccountId: c.bank.id, debit: toMoney(5_000_000) }, { accountId: c.modal.id, credit: toMoney(5_000_000) }] });
  await jurnal(c, { source: "REFUND", tanggal: "2026-09-14", baris: [{ accountId: c.retur.id, debit: toMoney(120_000.55) }, { accountId: c.bankA.id, cashAccountId: c.bank.id, credit: toMoney(120_000.55) }] });
  await jurnal(c, { source: "TRANSFER_KAS", baris: [{ accountId: c.bankA.id, cashAccountId: c.bank2.id, debit: toMoney(2_000_000) }, { accountId: c.bankA.id, cashAccountId: c.bank.id, credit: toMoney(2_000_000) }] });
  await jurnal(c, { source: "MANUAL", baris: [{ accountId: c.bankA.id, cashAccountId: c.bank.id, debit: toMoney(300_000) }, { accountId: c.piutang.id, credit: toMoney(300_000) }] }); // pelunasan manual di luar alur → Perlu ditinjau
  const hasil = { generatedBy: "financePemasukan.integration.test.js (DUMP_PEMASUKAN=1)", ringkasan: (await get(fin, `/pemasukan/ringkasan?${PER}`)).body, daftar: (await get(fin, `/pemasukan?${PER}&limit=100`)).body };
  assert.ok(hasil.daftar.items.length >= 8);
  for (const b of hasil.daftar.items) assert.match(b.nilai, /^-?\d+\.\d{2}$/, "uang selalu string desimal 2 digit");
  if (process.env.DUMP_PEMASUKAN) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    mkdirSync(fileURLToPath(new URL("../../../finance-mobile/src/__tests__/fixtures/", import.meta.url)), { recursive: true });
    const stabil = JSON.stringify(hasil, (k, v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? "2026-09-21T00:00:00.000Z" : v), 1);
    writeFileSync(fileURLToPath(new URL("../../../finance-mobile/src/__tests__/fixtures/pemasukan-real.json", import.meta.url)), stabil);
  }
});
