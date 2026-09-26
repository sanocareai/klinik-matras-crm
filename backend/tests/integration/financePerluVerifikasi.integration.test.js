// PERLU VERIFIKASI FINANCE: memisahkan (1) uang masuk / cash receipt, (2) pendapatan diakui (omzet), (3) klaim "Lunas" dari Sales.
// Akar masalah yang dijaga: "Ditandai Lunas oleh Sales" = flag status ORDER tanpa catatan Payment, sedangkan "Menunggu Verifikasi" hanya membaca tabel
// Payment — dua sumber terpisah, sehingga klaim Sales tidak pernah muncul di Menunggu Verifikasi. Sekarang keduanya terlihat sebagai satu antrean
// Perlu Verifikasi Finance; Pendapatan Diakui memuat status pembayaran dan TIDAK wajib punya rekening; ada aksi Minta Bukti (penanda + audit saja).

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
import { bukukanPembayaran } from "../../src/services/finance/hooks.js";
import { postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { tentukanStatusBayar } from "../../src/services/finance/pemasukan.js";

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
  const bankA = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const kasA = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "SANOBANK Kemal", kind: "BANK", accountId: bankA.id } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: kasA.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, kas.id);
  const admin = (await createTestUser({ roles: ["ADMIN"] })).user;
  return { bank, kas, admin };
}

async function buatOrder(ctx, { value = 1_000_000, lunasSales = false, diakui = true } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan ${++no}` } });
  const order = await testPrisma.order.create({
    data: {
      customerId: customer.id, value, category: "LAYANAN", orderNumber: `SAN-PV-${String(no).padStart(4, "0")}`, status: "DELIVERED",
      paymentStatus: lunasSales ? "LUNAS" : "BELUM_BAYAR", ...(lunasSales ? { paidAt: new Date("2026-09-12T03:00:00Z") } : {}),
      createdAt: new Date("2026-09-05T03:00:00Z"),
    },
  });
  if (diakui) await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: ctx.admin.id, date: "2026-09-10" }));
  return order;
}
async function bayar(ctx, order, { amount, cashAccountId, verif = false }) {
  const p = await testPrisma.payment.create({ data: { orderId: order.id, amount, method: "TRANSFER", cashAccountId, recordedById: ctx.admin.id, createdAt: new Date("2026-09-10T03:00:00Z") } });
  if (cashAccountId) await testPrisma.$transaction((tx) => bukukanPembayaran(tx, { paymentId: p.id, userId: ctx.admin.id }));
  if (verif) await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: ctx.admin.id } });
  return p;
}
const daftarPendapatan = async (u, q = "") => {
  const r = await get(u, `/pemasukan?${PER}&kategori=PENDAPATAN&limit=100${q}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items;
};
const dariOrder = (items, order) => items.find((i) => i.tautan?.order?.nomor === order.orderNumber);

// ── unit murni: turunan status pembayaran ───────────────────────────────────────────────────────────────────────

test("tentukanStatusBayar: Belum dibayar / Sebagian / Lunas / Perlu verifikasi + rekening belum diketahui (murni)", () => {
  const p = (amount, { verif = true, rek = "R1", batal = false } = {}) => ({ amount, cancelledAt: batal ? new Date() : null, cashAccountId: rek, verifications: verif ? [{ id: "v" }] : [] });
  assert.equal(tentukanStatusBayar({ value: 1000, paymentStatus: "BELUM_BAYAR", payments: [] }).kode, "BELUM_DIBAYAR");
  assert.equal(tentukanStatusBayar({ value: 1000, paymentStatus: "DP", payments: [p(400)] }).kode, "SEBAGIAN");
  assert.equal(tentukanStatusBayar({ value: 1000, paymentStatus: "LUNAS", payments: [p(1000)] }).kode, "LUNAS");
  assert.equal(tentukanStatusBayar({ value: 1000, paymentStatus: "LUNAS", payments: [] }).kode, "PERLU_VERIFIKASI", "klaim Sales tanpa pembayaran");
  assert.equal(tentukanStatusBayar({ value: 1000, paymentStatus: "LUNAS", payments: [p(400)] }).kode, "PERLU_VERIFIKASI", "klaim lunas, tercatat kurang");
  assert.equal(tentukanStatusBayar({ value: 1000, paymentStatus: "DP", payments: [p(500, { verif: false })] }).kode, "PERLU_VERIFIKASI", "pembayaran belum diverifikasi");
  assert.equal(tentukanStatusBayar({ value: 1000, paymentStatus: "BELUM_BAYAR", payments: [p(1000, { batal: true })] }).kode, "BELUM_DIBAYAR", "pembayaran dibatalkan tidak dihitung");
  const tanpaRek = tentukanStatusBayar({ value: 1000, paymentStatus: "LUNAS", payments: [p(1000, { rek: null })] });
  assert.equal(tanpaRek.kode, "LUNAS");
  assert.equal(tanpaRek.rekeningBelumDiketahui, true);
});

// ── akar masalah ────────────────────────────────────────────────────────────────────────────────────────────────

test("AKAR MASALAH: klaim Lunas dari Sales (flag order, tanpa Payment) muncul di 'Ditandai Lunas' tetapi TIDAK di daftar pembayaran Menunggu Verifikasi; kini keduanya terhitung di Perlu Verifikasi Finance", async () => {
  const c = await siapkan();
  const fin = await masuk(["FINANCE"]);
  await buatOrder(c, { value: 2_000_000, lunasSales: true }); // klaim: LUNAS di CRM, tanpa Payment
  const o2 = await buatOrder(c, { value: 500_000 });
  await bayar(c, o2, { amount: 500_000, cashAccountId: c.bank.id, verif: false }); // pembayaran tercatat, belum diverifikasi

  const klaim = await get(fin, "/penerimaan/lunas-belum-dicatat");
  assert.equal(klaim.status, 200);
  assert.equal(klaim.body.items.length, 1, "klaim Sales terdaftar sebagai 'Ditandai Lunas oleh Sales'");
  const menunggu = await get(fin, "/pembayaran?status=MENUNGGU");
  assert.equal(menunggu.status, 200);
  assert.equal(menunggu.body.items.length, 1, "Menunggu Verifikasi hanya membaca tabel Payment");
  assert.notEqual(menunggu.body.items[0].order.nomor, klaim.body.items[0].orderNumber, "klaim Sales bukan bagian dari Menunggu Verifikasi (sumber berbeda)");

  const r = await get(fin, `/pemasukan/ringkasan?${PER}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const pv = r.body.perluVerifikasiFinance;
  assert.equal(pv.klaimSales.jumlah, 1);
  assert.equal(pv.klaimSales.nilai, "2000000.00");
  assert.equal(pv.pembayaranMenunggu.jumlah, 1);
  assert.equal(pv.pembayaranMenunggu.nilai, "500000.00");
  assert.equal(pv.totalJumlah, 2, "satu antrean: klaim + pembayaran menunggu");
});

// ── Pendapatan Diakui ───────────────────────────────────────────────────────────────────────────────────────────

test("Pendapatan Diakui: TIDAK wajib punya rekening; status pembayaran (Belum dibayar/Sebagian/Lunas/Perlu verifikasi) + Rekening belum diketahui; angka pendapatan tidak berubah", async () => {
  const c = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const belum = await buatOrder(c, { value: 1_000_000 });
  const sebagian = await buatOrder(c, { value: 1_000_000 });
  await bayar(c, sebagian, { amount: 400_000, cashAccountId: c.bank.id, verif: true });
  const lunas = await buatOrder(c, { value: 1_000_000 });
  await bayar(c, lunas, { amount: 1_000_000, cashAccountId: c.bank.id, verif: true });
  const klaim = await buatOrder(c, { value: 1_000_000, lunasSales: true });
  const menunggu = await buatOrder(c, { value: 1_000_000 });
  await bayar(c, menunggu, { amount: 1_000_000, cashAccountId: c.bank.id, verif: false });
  const tanpaRek = await buatOrder(c, { value: 1_000_000, lunasSales: true });
  await bayar(c, tanpaRek, { amount: 1_000_000, cashAccountId: null, verif: true }); // lunas sebelum saldo awal: verifikasi tanpa rekening

  const items = await daftarPendapatan(fin);
  assert.equal(items.length, 6);
  assert.ok(items.every((i) => i.rekening === null), "pendapatan berasal dari jurnal pengakuan: tidak punya rekening, dan itu WAJAR");
  assert.ok(items.every((i) => i.kategoriLabel === "Pendapatan Diakui"));
  const st = (o) => dariOrder(items, o).statusBayar;
  assert.equal(st(belum).kode, "BELUM_DIBAYAR");
  assert.equal(st(sebagian).kode, "SEBAGIAN");
  assert.equal(st(lunas).kode, "LUNAS");
  assert.equal(st(klaim).kode, "PERLU_VERIFIKASI");
  assert.match(st(klaim).alasan, /Sales menandai order Lunas/);
  assert.equal(st(menunggu).kode, "PERLU_VERIFIKASI");
  assert.equal(st(tanpaRek).kode, "LUNAS");
  assert.equal(st(tanpaRek).rekeningBelumDiketahui, true);
  assert.equal(st(lunas).rekeningBelumDiketahui, false);

  const perlu = await daftarPendapatan(fin, "&statusBayar=PERLU_VERIFIKASI");
  assert.equal(perlu.length, 2);
  const rekTakDiketahui = await daftarPendapatan(fin, "&statusBayar=REKENING_BELUM_DIKETAHUI");
  assert.equal(rekTakDiketahui.length, 1);

  const r = await get(fin, `/pemasukan/ringkasan?${PER}`);
  assert.equal(r.body.pendapatanSistem.nilai, "6000000.00", "status pembayaran hanya penjelasan; total pendapatan diakui tidak berubah");
  const opsi = await get(fin, "/pemasukan/opsi");
  assert.ok(opsi.body.statusBayar.some((s) => s.id === "REKENING_BELUM_DIKETAHUI" && /Rekening belum diketahui/.test(s.label)));
  assert.ok(opsi.body.tab.includes("verifikasi"));
});

test("Label & penjelasan: Uang Masuk / Pendapatan Diakui, dengan kalimat pembeda yang diminta", async () => {
  await siapkan();
  const fin = await masuk(["FINANCE"]);
  const opsi = await get(fin, "/pemasukan/opsi");
  const kat = Object.fromEntries(opsi.body.kategori.map((x) => [x.id, x]));
  assert.equal(kat.PENDAPATAN.label, "Pendapatan Diakui");
  assert.equal(kat.PEMBAYARAN.label, "Uang Masuk");
  assert.match(kat.PENDAPATAN.penjelasan, /omzet yang diakui, bukan bukti uang masuk/);
  assert.match(kat.PEMBAYARAN.penjelasan, /Rekening muncul di sini, bukan selalu di pendapatan/);
});

// ── Minta Bukti ─────────────────────────────────────────────────────────────────────────────────────────────────

test("Minta Bukti: hanya penanda + audit (tidak mengubah status order, Payment, jurnal, atau saldo); tampil di daftar klaim; izin dan validasi", async () => {
  const c = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const salesU = await createTestUser({ roles: ["SALES"] }); const sales = { token: salesU.token };
  const klaim = await buatOrder(c, { value: 750_000, lunasSales: true });
  const jurnalSebelum = await testPrisma.finJournalEntry.count();
  const paySebelum = await testPrisma.payment.count();

  assert.equal((await post(sales, "/penerimaan/minta-bukti", { orderId: klaim.id })).status, 403, "Sales tidak boleh");
  assert.equal((await post(fin, "/penerimaan/minta-bukti", {})).status, 400);
  const r = await post(fin, "/penerimaan/minta-bukti", { orderId: klaim.id, catatan: "  Mohon kirim foto transfer  " });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.catatan, "Mohon kirim foto transfer");

  const daftar = await get(fin, "/penerimaan/lunas-belum-dicatat");
  const item = daftar.body.items.find((i) => i.orderId === klaim.id);
  assert.ok(item, "klaim tetap ada di antrean");
  assert.equal(item.buktiDiminta.catatan, "Mohon kirim foto transfer");
  assert.ok(item.buktiDiminta.pada);
  const order = await testPrisma.order.findUnique({ where: { id: klaim.id } });
  assert.equal(order.paymentStatus, "LUNAS", "status order TIDAK berubah");
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalSebelum, "tidak ada jurnal baru");
  assert.equal(await testPrisma.payment.count(), paySebelum, "tidak ada Payment baru");
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: klaim.id, eventType: "BUKTI_DIMINTA" } });
  assert.ok(ev, "jejak audit tercatat");
  assert.equal(ev.actorId, fin.id ?? ev.actorId);

  // order yang bukan klaim → 409
  const biasa = await buatOrder(c, { value: 100_000 });
  assert.equal((await post(fin, "/penerimaan/minta-bukti", { orderId: biasa.id })).status, 409);
  // order sudah lunas oleh pembayaran terverifikasi → 409
  const sudah = await buatOrder(c, { value: 300_000, lunasSales: true });
  await bayar(c, sudah, { amount: 300_000, cashAccountId: c.bank.id, verif: true });
  assert.equal((await post(fin, "/penerimaan/minta-bukti", { orderId: sudah.id })).status, 409);
  assert.equal((await post(fin, "/penerimaan/minta-bukti", { orderId: randomUUID() })).status, 404);
});

test("Tolak Klaim (endpoint yang sama dengan 'Belum Lunas') mengeluarkan order dari antrean dan mengembalikan status; membaca ringkasan tidak membuat jurnal", async () => {
  const c = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const klaim = await buatOrder(c, { value: 900_000, lunasSales: true });
  const jurnalSebelum = await testPrisma.finJournalEntry.count();
  await get(fin, `/pemasukan/ringkasan?${PER}`);
  await get(fin, `/pemasukan?${PER}&kategori=PENDAPATAN`);
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalSebelum, "membaca tidak membuat jurnal");
  const t = await post(fin, "/penerimaan/tolak", { orderId: klaim.id, reason: "Uang belum masuk" });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal((await get(fin, "/penerimaan/lunas-belum-dicatat")).body.items.length, 0);
  assert.equal((await get(fin, `/pemasukan/ringkasan?${PER}`)).body.perluVerifikasiFinance.totalJumlah, 0);
  assert.equal((await testPrisma.order.findUnique({ where: { id: klaim.id } })).paymentStatus, "BELUM_BAYAR");
});
