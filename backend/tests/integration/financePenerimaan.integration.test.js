// Test integrasi verifikasi penerimaan order (services/finance/penerimaanOrder.js).
// Kasus nyata: sales menandai order LUNAS tanpa catatan pembayaran → order
// masih tampil sebagai piutang & halaman verifikasi kosong.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { umurPiutang } from "../../src/services/finance/reports.js";
import { STATUS_DIHITUNG } from "../../src/services/finance/journal.js";
import { toMoney } from "../../src/services/finance/money.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "KEM - Sano Bank", kind: "BANK", accountId: akunBank.id } });
  return { bank };
}

/** Order yang sudah diserahkan (pendapatan diakui → piutang) lalu ditandai LUNAS oleh sales. */
async function orderLunasTanpaPayment({ value = 1_000_000, ongkir = null, paidAt = new Date(), sales = null } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Erni", assignedSalesId: sales?.id || null } });
  const order = await testPrisma.order.create({
    data: { customerId: customer.id, value, ...(ongkir != null && { ongkir }), category: "LAYANAN", orderNumber: `RES-${Math.random().toString(36).slice(2, 8)}`, status: "DELIVERED", paymentStatus: "LUNAS", paidAt },
  });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: admin.user.id }));
  return { order, customer };
}

async function saldo(systemKeyAtauKode) {
  const akun = await testPrisma.finAccount.findFirst({ where: { OR: [{ systemKey: systemKeyAtauKode }, { code: systemKeyAtauKode }] } });
  const baris = await testPrisma.finJournalLine.findMany({
    where: { accountId: akun.id, entry: { status: { in: STATUS_DIHITUNG } } }, select: { debit: true, credit: true },
  });
  return baris.reduce((a, b) => a.plus(toMoney(b.debit)).minus(toMoney(b.credit)), toMoney(0)).toFixed(2);
}

const ADMIN = async () => makeClient(server.baseUrl, (await createTestUser({ roles: ["FINANCE"] })).token);

test("Order LUNAS tanpa catatan pembayaran: masuk antrean verifikasi dan KELUAR dari daftar piutang (tetap dilaporkan sebagai menunggu verifikasi)", async () => {
  await siapkan();
  const { order } = await orderLunasTanpaPayment({ value: 2_150_000 });
  const c = await ADMIN();

  const antre = (await c.get("/api/finance/penerimaan/lunas-belum-dicatat")).body;
  assert.equal(antre.semua.jumlah, 1);
  assert.equal(antre.items[0].orderId, order.id);
  assert.equal(antre.items[0].sisa, 2_150_000);
  assert.equal(antre.items[0].kelompok, "BARU");

  const piutang = await umurPiutang(testPrisma, { to: new Date() });
  assert.equal(piutang.baris.length, 0, "order lunas tidak boleh tampil sebagai piutang");
  assert.equal(piutang.total, 0);
  assert.equal(piutang.menungguVerifikasi.jumlah, 1);
  assert.equal(piutang.menungguVerifikasi.total, 2_150_000);
  assert.equal(await saldo(SYSTEM_KEYS.PIUTANG_USAHA), "2150000.00", "neraca = daftar piutang + menunggu verifikasi");
});

test("Verifikasi ke rekening: Payment + verifikasi + jurnal Dr Bank / Cr Piutang; dicatat atas nama sales, diverifikasi finance", async () => {
  const { bank } = await siapkan();
  const sales = (await createTestUser({ roles: ["SALES"] })).user;
  const { order } = await orderLunasTanpaPayment({ value: 1_500_000, sales });
  const c = await ADMIN();

  const r = await c.post("/api/finance/penerimaan/verifikasi", {
    orderId: order.id, mode: "REKENING", method: "TRANSFER", cashAccountId: bank.id, date: "2026-09-19",
    proofPhotoUrl: "/media/finance-receipts/bukti.jpg",
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));

  const p = await testPrisma.payment.findUnique({ where: { id: r.body.paymentId }, include: { verifications: true } });
  assert.equal(p.amount, 1_500_000);
  assert.equal(p.cashAccountId, bank.id);
  assert.equal(p.recordedById, sales.id, "yang melapor lunas = sales");
  assert.notEqual(p.verifications[0].verifiedById, sales.id, "yang memverifikasi orang lain (finance)");
  assert.equal(p.proofPhotoUrl, "/media/finance-receipts/bukti.jpg");

  assert.equal(await saldo(SYSTEM_KEYS.BANK), "1500000.00");
  assert.equal(await saldo(SYSTEM_KEYS.PIUTANG_USAHA), "0.00", "piutang tertutup");
  assert.equal((await testPrisma.order.findUnique({ where: { id: order.id } })).paymentStatus, "LUNAS");
  assert.equal((await c.get("/api/finance/penerimaan/lunas-belum-dicatat")).body.semua.jumlah, 0, "antrean kosong lagi");

  const ulang = await c.post("/api/finance/penerimaan/verifikasi", { orderId: order.id, mode: "REKENING", cashAccountId: bank.id });
  assert.equal(ulang.status, 409, "tidak bisa diverifikasi dua kali");
});

test("Verifikasi tanpa rekening ditolak; nominal melebihi yang belum tercatat ditolak", async () => {
  const { bank } = await siapkan();
  const { order } = await orderLunasTanpaPayment({ value: 1_000_000 });
  const c = await ADMIN();
  assert.equal((await c.post("/api/finance/penerimaan/verifikasi", { orderId: order.id, mode: "REKENING" })).status, 400);
  assert.equal((await c.post("/api/finance/penerimaan/verifikasi", { orderId: order.id, mode: "REKENING", cashAccountId: bank.id, amount: 2_000_000 })).status, 400);
  assert.equal((await c.post("/api/finance/penerimaan/verifikasi", { orderId: order.id, mode: "REKENING", cashAccountId: bank.id, proofPhotoUrl: "https://evil.example/x.jpg" })).status, 400);
});

test("Pembayaran SEBELUM tanggal saldo awal: kelompok LAMA; diselesaikan ke Laba Ditahan tanpa menyentuh kas (tidak menggandakan saldo bank asli)", async () => {
  await siapkan();
  const { order } = await orderLunasTanpaPayment({ value: 900_000, paidAt: new Date("2026-08-20T03:00:00Z") });
  const c = await ADMIN();

  const antre = (await c.get("/api/finance/penerimaan/lunas-belum-dicatat")).body;
  assert.equal(antre.items[0].kelompok, "LAMA");
  assert.equal(antre.lama.jumlah, 1);

  const r = await c.post("/api/finance/penerimaan/verifikasi", { orderId: order.id, mode: "SEBELUM_SALDO_AWAL" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await saldo(SYSTEM_KEYS.PIUTANG_USAHA), "0.00");
  assert.equal(await saldo(SYSTEM_KEYS.BANK), "0.00", "kas tidak berubah");
  assert.equal(await saldo(SYSTEM_KEYS.LABA_DITAHAN), "900000.00", "lawannya Laba Ditahan (didebit)");
});

test("Tolak lunas: status order dikembalikan dan paidAt dikosongkan (komisi ikut batal); alasan wajib", async () => {
  await siapkan();
  const { order } = await orderLunasTanpaPayment({ value: 1_000_000 });
  const c = await ADMIN();

  assert.equal((await c.post("/api/finance/penerimaan/tolak", { orderId: order.id })).status, 400);
  const r = await c.post("/api/finance/penerimaan/tolak", { orderId: order.id, reason: "uang belum masuk rekening" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.equal(o.paymentStatus, "BELUM_BAYAR");
  assert.equal(o.paidAt, null);
  assert.equal((await c.get("/api/finance/penerimaan/lunas-belum-dicatat")).body.semua.jumlah, 0);
  // Setelah ditolak, order kembali jadi piutang sungguhan.
  assert.equal((await umurPiutang(testPrisma, { to: new Date() })).baris.length, 1);
});

test("Verifikasi massal: rekening sama untuk banyak order; satu yang gagal tidak membatalkan yang lain", async () => {
  const { bank } = await siapkan();
  const a = (await orderLunasTanpaPayment({ value: 500_000 })).order;
  const b = (await orderLunasTanpaPayment({ value: 700_000 })).order;
  const c = await ADMIN();

  const r = await c.post("/api/finance/penerimaan/verifikasi-massal", {
    orderIds: [a.id, "tidak-ada", b.id], mode: "REKENING", method: "TRANSFER", cashAccountId: bank.id,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.berhasil, 2);
  assert.equal(r.body.gagal, 1);
  assert.equal(await saldo(SYSTEM_KEYS.BANK), "1200000.00");
});

test("Order lama yang sudah diserahkan tapi pendapatannya TIDAK PERNAH diakui di buku: pembayaran terverifikasi tanpa jurnal (tidak ada kewajiban palsu)", async () => {
  await siapkan();
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Riwayat" } });
  const order = await testPrisma.order.create({
    data: { customerId: customer.id, value: 3_000_000, category: "LAYANAN", orderNumber: "RES-LAMA-1", status: "DELIVERED", paymentStatus: "LUNAS", paidAt: new Date("2026-06-10T03:00:00Z") },
  });
  const c = await ADMIN();
  const jurnalAwal = await testPrisma.finJournalEntry.count();

  const r = await c.post("/api/finance/penerimaan/verifikasi", { orderId: order.id, mode: "SEBELUM_SALDO_AWAL" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.tanpaJurnal, true);
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalAwal, "tidak ada jurnal baru");
  assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PELANGGAN), "0.00", "tidak ada uang muka palsu");
  assert.equal(await saldo(SYSTEM_KEYS.LABA_DITAHAN), "0.00");
  const p = await testPrisma.payment.findUnique({ where: { id: r.body.paymentId }, include: { verifications: true } });
  assert.equal(p.amount, 3_000_000);
  assert.equal(p.verifications.length, 1);
  assert.equal((await c.get("/api/finance/penerimaan/lunas-belum-dicatat")).body.semua.jumlah, 0);
});

test("Order belum diserahkan yang lunas sebelum saldo awal: uang muka pelanggan diakui (lawannya Laba Ditahan)", async () => {
  await siapkan();
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Dalam Proses" } });
  const order = await testPrisma.order.create({
    data: { customerId: customer.id, value: 1_200_000, category: "LAYANAN", orderNumber: "RES-PROSES-1", status: "PROCESSING", paymentStatus: "LUNAS", paidAt: new Date("2026-09-10T03:00:00Z") },
  });
  const c = await ADMIN();
  const r = await c.post("/api/finance/penerimaan/verifikasi", { orderId: order.id, mode: "SEBELUM_SALDO_AWAL" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.tanpaJurnal, false);
  assert.equal(await saldo(SYSTEM_KEYS.UANG_MUKA_PELANGGAN), "-1200000.00", "kewajiban (kredit) uang muka");
  assert.equal(await saldo(SYSTEM_KEYS.LABA_DITAHAN), "1200000.00");
});

// REGRESI (jendela 00:00–07:00 WIB): jurnal bertanggal buku WIB "hari ini" tidak boleh hilang dari posisi piutang/kas hanya karena
// `to` berupa instant UTC yang masih "kemarin". Di sini `to` sengaja dibuat 1 jam SEBELUM tengah malam UTC tanggal buku — hari UTC-nya
// kemarin, hari WIB-nya hari ini — sehingga tes ini gagal pada jam berapa pun bila bug kembali (bukan hanya saat dijalankan dini hari).
test("Posisi piutang memakai tanggal buku WIB: instant UTC 'kemarin' yang sudah 'hari ini' di WIB tetap memuat jurnal hari ini", async () => {
  const { todayBookDateWIB } = await import("../../src/services/finance/journal.js");
  await siapkan();
  await orderLunasTanpaPayment({ value: 1_250_000 });
  const tglBuku = todayBookDateWIB();
  const instantKemarinUtc = new Date(tglBuku.getTime() - 60 * 60 * 1000);

  const p = await umurPiutang(testPrisma, { to: instantKemarinUtc });
  assert.equal(p.menungguVerifikasi.jumlah, 1, "jurnal bertanggal buku hari ini harus ikut terhitung");
  assert.equal(p.menungguVerifikasi.total, 1_250_000);
});

test("Uang diterima SEBELUM saldo awal tetap tidak menambah saldo walau klien mengirim mode REKENING (kasus Wilson): dialihkan server, kas tidak berubah, verifikasi massal juga", async () => {
  const { bank } = await siapkan();
  const { order } = await orderLunasTanpaPayment({ value: 1_900_000, paidAt: new Date("2026-09-03T05:00:00Z") });
  const c = await ADMIN();

  const r = await c.post("/api/finance/penerimaan/verifikasi", { orderId: order.id, mode: "REKENING", method: "TRANSFER", cashAccountId: bank.id, date: "2026-09-03" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.dialihkan, true);
  assert.equal(r.body.sebelumSaldoAwal, true);
  assert.equal(await saldo(SYSTEM_KEYS.BANK), "0.00", "verifikasi uang lama TIDAK boleh mengubah saldo bank");
  assert.equal(await saldo(SYSTEM_KEYS.PIUTANG_USAHA), "0.00");
  assert.equal(await saldo(SYSTEM_KEYS.LABA_DITAHAN), "1900000.00");
  const p = await testPrisma.payment.findUnique({ where: { id: r.body.paymentId }, include: { verifications: true } });
  assert.equal(p.cashAccountId, null, "tanpa rekening — kas tidak disentuh");
  assert.equal(p.verifications.length, 1, "tetap tercatat terverifikasi");

  // Verifikasi massal (tanggal mengikuti paidAt): mode REKENING pada order lama juga tidak menambah saldo.
  const { order: lama } = await orderLunasTanpaPayment({ value: 700_000, paidAt: new Date("2026-09-10T05:00:00Z") });
  const m = await c.post("/api/finance/penerimaan/verifikasi-massal", { orderIds: [lama.id], mode: "REKENING", method: "TRANSFER", cashAccountId: bank.id });
  assert.equal(m.body.berhasil, 1, JSON.stringify(m.body));
  assert.equal(await saldo(SYSTEM_KEYS.BANK), "0.00");
});

test("Uang diterima pada/setelah saldo awal tetap menambah saldo rekening (jalur normal tidak berubah)", async () => {
  const { bank } = await siapkan();
  const { order } = await orderLunasTanpaPayment({ value: 500_000, paidAt: new Date("2026-09-18T05:00:00Z") });
  const c = await ADMIN();
  const r = await c.post("/api/finance/penerimaan/verifikasi", { orderId: order.id, mode: "REKENING", method: "TRANSFER", cashAccountId: bank.id, date: "2026-09-18" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.dialihkan, false);
  assert.equal(await saldo(SYSTEM_KEYS.BANK), "500000.00");
});

test("Ongkir ikut nilai tagihan Finance untuk order biasa (keputusan Owner 29 Sep): antrean menagih value+ongkir, verifikasi penuh menutup piutang total, bayar sebagian = DP", async () => {
  const { bank } = await siapkan();
  const { order } = await orderLunasTanpaPayment({ value: 500_000, ongkir: 200_000, paidAt: new Date("2026-09-25T05:00:00Z") });
  const c = await ADMIN();

  const antre = (await c.get("/api/finance/penerimaan/lunas-belum-dicatat")).body;
  assert.equal(antre.items[0].nilaiOrder, 700_000, "nilai tagihan = layanan + ongkir");
  assert.equal(antre.items[0].sisa, 700_000);
  assert.equal(await saldo(SYSTEM_KEYS.PIUTANG_USAHA), "700000.00", "jurnal pengakuan menagih layanan + ongkir");

  // Bayar hanya sebesar layanan (kasus lama): TIDAK boleh lagi tampil Lunas — sisa ongkir masih ditagih.
  const sebagian = await c.post("/api/finance/penerimaan/verifikasi", { orderId: order.id, mode: "REKENING", method: "TRANSFER", cashAccountId: bank.id, date: "2026-09-25", amount: 500_000 });
  assert.equal(sebagian.status, 201, JSON.stringify(sebagian.body));
  assert.equal((await testPrisma.order.findUnique({ where: { id: order.id } })).paymentStatus, "DP");
  assert.equal(await saldo(SYSTEM_KEYS.PIUTANG_USAHA), "200000.00", "sisa piutang = ongkir");

  const sisa = (await c.get("/api/finance/penerimaan/lunas-belum-dicatat")).body;
  assert.equal(sisa.items.length, 0, "order kini DP, bukan klaim Lunas");
});

test("Ongkir: bayar penuh value+ongkir = Lunas dan piutang nol (tidak ada piutang ongkir menggantung)", async () => {
  const { bank } = await siapkan();
  const { order } = await orderLunasTanpaPayment({ value: 2_200_000, ongkir: 200_000, paidAt: new Date("2026-09-25T05:00:00Z") });
  const c = await ADMIN();
  const r = await c.post("/api/finance/penerimaan/verifikasi", { orderId: order.id, mode: "REKENING", method: "TRANSFER", cashAccountId: bank.id, date: "2026-09-25" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.amount, 2_400_000);
  assert.equal((await testPrisma.order.findUnique({ where: { id: order.id } })).paymentStatus, "LUNAS");
  assert.equal(await saldo(SYSTEM_KEYS.PIUTANG_USAHA), "0.00");
  assert.equal(await saldo(SYSTEM_KEYS.BANK), "2400000.00");
});

test("Order tanpa ongkir tidak berubah perilakunya (value saja)", async () => {
  const { bank } = await siapkan();
  const { order } = await orderLunasTanpaPayment({ value: 800_000, paidAt: new Date("2026-09-25T05:00:00Z") });
  const c = await ADMIN();
  const r = await c.post("/api/finance/penerimaan/verifikasi", { orderId: order.id, mode: "REKENING", method: "TRANSFER", cashAccountId: bank.id, date: "2026-09-25" });
  assert.equal(r.body.amount, 800_000);
  assert.equal((await testPrisma.order.findUnique({ where: { id: order.id } })).paymentStatus, "LUNAS");
});
