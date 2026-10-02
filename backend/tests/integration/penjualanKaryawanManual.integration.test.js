// Test integrasi modul PENJUALAN KARYAWAN MANUAL (input di luar Order) terhadap PostgreSQL sungguhan.
// Yang dikunci: arah jurnal (piutang karyawan / pendapatan 4-1250), pembayaran tunai-transfer vs potong gaji, pembayaran sebelum cutoff TIDAK menambah kas
// (lawan Laba Ditahan), batas sisa, pembatalan lewat reversal, penjual wajib non-Sales, dan modul TIDAK membuat Order/Customer/produksi/delivery.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { toMoney } from "../../src/services/finance/money.js";
import { STATUS_DIHITUNG } from "../../src/services/finance/journal.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const seller = await testPrisma.user.create({ data: { name: "Emon Uji", email: `emon-${Date.now()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const sales = await testPrisma.user.create({ data: { name: "Sales Uji", email: `sales-${Date.now()}@example.test`, passwordHash: "x", role: "SALES" } });
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  return { rekening, seller, sales, c: makeClient(server.baseUrl, token) };
}

async function saldo(code) {
  const akun = await testPrisma.finAccount.findUnique({ where: { code } });
  const baris = await testPrisma.finJournalLine.findMany({ where: { accountId: akun.id, entry: { status: { in: STATUS_DIHITUNG } } }, select: { debit: true, credit: true } });
  return baris.reduce((a, b) => a.plus(toMoney(b.debit)).minus(toMoney(b.credit)), toMoney(0)).toFixed(2);
}

const badan = (seller, extra = {}) => ({
  date: "2026-10-02", sellerId: seller.id, buyerName: "  Bu   Ani (kerabat) ",
  items: [{ name: "Kasur Sano 160x200", quantity: 1, unitPrice: 1_300_000 }, { name: "Bantal", quantity: 2, unitPrice: 150_000 }],
  ...extra,
});

test("Catat penjualan: total dihitung server, Dr Piutang Karyawan / Cr Pendapatan Penjualan Karyawan (4-1250), TANPA Order/Customer/produksi/delivery", async () => {
  const { seller, c } = await siapkan();
  const sebelum = { order: await testPrisma.order.count(), customer: await testPrisma.customer.count(), unit: await testPrisma.unit.count() };

  const r = await c.post("/api/finance/penjualan-karyawan", badan(seller, { total: 1 }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.nomor, /^PKR-02102026-001$/);
  assert.equal(r.body.total, 1_600_000, "total dari item, bukan dari klien");
  assert.equal(r.body.buyerName, "Bu Ani (kerabat)");
  assert.equal(r.body.statusTampil, "BELUM_BAYAR");
  assert.equal(r.body.sisa, 1_600_000);

  assert.equal(await saldo("1-1350"), "1600000.00");
  assert.equal(await saldo("4-1250"), "-1600000.00");
  assert.equal(await saldo("4-1200"), "0.00", "tidak bercampur dengan pendapatan produk order");
  assert.equal(await saldo("5-1100"), "0.00", "HPP tidak dibukukan");

  assert.equal(await testPrisma.order.count(), sebelum.order);
  assert.equal(await testPrisma.customer.count(), sebelum.customer);
  assert.equal(await testPrisma.unit.count(), sebelum.unit);
  const j = await testPrisma.finJournalEntry.findFirst({ where: { source: "PENJUALAN_KARYAWAN" } });
  assert.ok(j, "jurnal bersumber PENJUALAN_KARYAWAN");
});

test("Penjual harus akun aktif NON-Sales; item & pembeli divalidasi; peran tanpa izin ditolak", async () => {
  const { seller, sales, c } = await siapkan();
  const salesTolak = await c.post("/api/finance/penjualan-karyawan", badan(sales));
  assert.equal(salesTolak.status, 422);
  assert.equal((await c.post("/api/finance/penjualan-karyawan", badan(seller, { items: [] }))).status, 400);
  assert.equal((await c.post("/api/finance/penjualan-karyawan", badan(seller, { items: [{ name: "X", quantity: 0, unitPrice: 1000 }] }))).status, 400);
  assert.equal((await c.post("/api/finance/penjualan-karyawan", badan(seller, { items: [{ name: "X", quantity: 1, unitPrice: 0 }] }))).status, 400);
  assert.equal((await c.post("/api/finance/penjualan-karyawan", badan(seller, { buyerName: " " }))).status, 400);
  assert.equal((await c.post("/api/finance/penjualan-karyawan", badan(seller, { date: "2999-01-01" }))).status, 400, "tidak boleh masa depan");

  const { token } = await createTestUser({ roles: ["SALES"] });
  const forbidden = await makeClient(server.baseUrl, token).post("/api/finance/penjualan-karyawan", badan(seller));
  assert.equal(forbidden.status, 403);
  assert.equal(await testPrisma.finPenjualanKaryawan.count(), 0, "tidak ada yang tersimpan dari percobaan gagal");
});

test("Pembayaran transfer sesudah cutoff: Dr Bank / Cr Piutang; melebihi sisa ditolak; lunas → status turunan LUNAS", async () => {
  const { seller, rekening, c } = await siapkan();
  const p = (await c.post("/api/finance/penjualan-karyawan", badan(seller))).body;

  const tanpaRekening = await c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran`, { method: "TRANSFER", amount: 600_000, date: "2026-10-02" });
  assert.equal(tanpaRekening.status, 400, "rekening wajib untuk uang sesudah cutoff");

  const r1 = await c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran`, { method: "TRANSFER", amount: 600_000, cashAccountId: rekening.id, date: "2026-10-02" });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.terbayar, 600_000);
  assert.equal(r1.body.statusTampil, "SEBAGIAN");
  assert.equal(await saldo("1-1100"), "0.00");
  assert.equal(await saldo("1-1200"), "600000.00");
  assert.equal(await saldo("1-1350"), "1000000.00");

  const lebih = await c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran`, { method: "TRANSFER", amount: 1_000_001, cashAccountId: rekening.id });
  assert.equal(lebih.status, 400);

  const r2 = await c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran`, { method: "TRANSFER", amount: 1_000_000, cashAccountId: rekening.id, date: "2026-10-02" });
  assert.equal(r2.body.statusTampil, "LUNAS");
  assert.equal(r2.body.sisa, 0);
  assert.equal(await saldo("1-1350"), "0.00");
});

test("Potong gaji: Dr Beban Gaji / Cr Piutang Karyawan, kas TIDAK tersentuh, tidak boleh memakai rekening", async () => {
  const { seller, rekening, c } = await siapkan();
  const p = (await c.post("/api/finance/penjualan-karyawan", badan(seller))).body;
  const pakaiRekening = await c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran`, { method: "POTONG_GAJI", amount: 500_000, cashAccountId: rekening.id });
  assert.equal(pakaiRekening.status, 400);

  const r = await c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran`, { method: "POTONG_GAJI", amount: 500_000, date: "2026-10-02" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await saldo("6-1100"), "500000.00");
  assert.equal(await saldo("1-1350"), "1100000.00");
  assert.equal(await saldo("1-1200"), "0.00");
});

test("Pembayaran tunai/transfer SEBELUM cutoff 18 Sep: tidak menambah kas (lawan Laba Ditahan), rekening opsional — kasus 8 Sep: Rp2,35 jt dibayar + Rp1,5 jt potong gaji", async () => {
  const { seller, c } = await siapkan();
  const r = await c.post("/api/finance/penjualan-karyawan", {
    date: "2026-09-08", sellerId: seller.id, buyerName: "Kerabat Emon",
    items: [{ name: "Kasur Sano", quantity: 1, unitPrice: 2_350_000 }, { name: "Kasur Sano (tagihan dipotong gaji)", quantity: 1, unitPrice: 1_500_000 }],
    pembayaran: [
      { method: "TRANSFER", amount: 2_350_000, date: "2026-09-08" },
      { method: "POTONG_GAJI", amount: 1_500_000, date: "2026-10-01" },
    ],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.total, 3_850_000);
  assert.equal(r.body.statusTampil, "LUNAS");
  assert.equal(await saldo("1-1100"), "0.00", "kas tidak bertambah");
  assert.equal(await saldo("1-1200"), "0.00");
  assert.equal(await saldo("3-3100"), "2350000.00", "Laba Ditahan didebit (saldo normal kredit → dikurangi)");
  assert.equal(await saldo("1-1350"), "0.00");
  assert.equal(await saldo("6-1100"), "1500000.00");
  assert.equal(await saldo("4-1250"), "-3850000.00");
});

test("Pembatalan: dokumen dengan pembayaran aktif ditolak; batalkan pembayaran lalu dokumen membalik jurnal (saldo kembali nol); alasan wajib", async () => {
  const { seller, rekening, c } = await siapkan();
  const p = (await c.post("/api/finance/penjualan-karyawan", badan(seller))).body;
  const bayar = (await c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran`, { method: "TRANSFER", amount: 600_000, cashAccountId: rekening.id, date: "2026-10-02" })).body;
  const pid = bayar.payments[0].id;

  assert.equal((await c.post(`/api/finance/penjualan-karyawan/${p.id}/batal`, { reason: "salah input" })).status, 409);
  assert.equal((await c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran/${pid}/batal`, {})).status, 400, "alasan wajib");

  const bp = await c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran/${pid}/batal`, { reason: "salah rekening" });
  assert.equal(bp.status, 200, JSON.stringify(bp.body));
  assert.equal(bp.body.terbayar, 0);
  assert.equal(await saldo("1-1200"), "0.00");
  assert.equal((await c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran/${pid}/batal`, { reason: "lagi" })).status, 409);

  const bd = await c.post(`/api/finance/penjualan-karyawan/${p.id}/batal`, { reason: "salah input" });
  assert.equal(bd.status, 200, JSON.stringify(bd.body));
  assert.equal(bd.body.statusTampil, "DIBATALKAN");
  assert.equal(await saldo("1-1350"), "0.00");
  assert.equal(await saldo("4-1250"), "0.00");
  assert.equal((await c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran`, { method: "POTONG_GAJI", amount: 1000 })).status, 409, "dokumen batal tidak bisa dibayar");
});

test("Daftar & ringkasan per karyawan: sisa dari dokumen aktif saja, dibatalkan tidak dihitung", async () => {
  const { seller, rekening, c } = await siapkan();
  const a = (await c.post("/api/finance/penjualan-karyawan", badan(seller))).body;
  const b = (await c.post("/api/finance/penjualan-karyawan", badan(seller, { buyerName: "Pak Budi", items: [{ name: "Kasur", quantity: 1, unitPrice: 1_000_000 }] }))).body;
  await c.post(`/api/finance/penjualan-karyawan/${a.id}/pembayaran`, { method: "TRANSFER", amount: 600_000, cashAccountId: rekening.id, date: "2026-10-02" });
  await c.post(`/api/finance/penjualan-karyawan/${b.id}/batal`, { reason: "batal" });

  const r = await c.get("/api/finance/penjualan-karyawan");
  assert.equal(r.status, 200);
  assert.equal(r.body.penjualan.length, 2);
  assert.equal(r.body.ringkasan.jumlah, 1);
  assert.equal(r.body.ringkasan.nilai, 1_600_000);
  assert.equal(r.body.ringkasan.terbayar, 600_000);
  assert.equal(r.body.ringkasan.sisa, 1_000_000);
  assert.equal(r.body.ringkasan.karyawan[0].nama, "Emon Uji");

  const q = await c.get("/api/finance/penjualan-karyawan?status=SEBAGIAN");
  assert.equal(q.body.penjualan.length, 1);
  const k = await c.get("/api/finance/penjualan-karyawan/karyawan");
  assert.ok(k.body.karyawan.some((x) => x.id === seller.id));
});

test("Kartu Laporan Sales: endpoint ringkasan memuat bagian 'manual' (penjualan di luar Order), terpisah dari ringkasan order", async () => {
  const { seller, rekening, c } = await siapkan();
  const p = (await c.post("/api/finance/penjualan-karyawan", badan(seller))).body;
  await c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran`, { method: "TRANSFER", amount: 600_000, cashAccountId: rekening.id, date: "2026-10-02" });

  const r = await c.get("/api/orders/penjualan-karyawan/ringkasan?from=2026-10-01&to=2026-10-31");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.total.jumlahOrder, 0, "tidak ada order bertanda");
  assert.equal(r.body.manual.jumlah, 1);
  assert.equal(r.body.manual.nilai, 1_600_000);
  assert.equal(r.body.manual.sisa, 1_000_000);

  const diLuar = await c.get("/api/orders/penjualan-karyawan/ringkasan?from=2026-09-01&to=2026-09-30");
  assert.equal(diLuar.body.manual.jumlah, 0, "periode lain tidak ikut");
});

test("Router modul ini tidak memasang middleware auth tanpa jalur (akan menghitung ganda di pembatas laju mobile untuk semua /api/finance/*)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../src/routes/financePenjualanKaryawan.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /financePenjualanKaryawanRouter\.use\((requireAuth|idempotency)\)/);
  assert.match(src, /financePenjualanKaryawanRouter\.use\(BASE, requireAuth, idempotency\)/);
});

test("Skrip pasang-akun-penjualan-karyawan: dry-run tidak menulis, --apply memasang SATU akun 4-1250 ber-systemKey, ulang = tidak ada perubahan", async () => {
  const { execFileSync } = await import("node:child_process");
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  await testPrisma.finAccount.delete({ where: { code: "4-1250" } }); // meniru produksi: akun belum ada
  const jumlahAwal = await testPrisma.finAccount.count();
  const jalankan = (...arg) => execFileSync(process.execPath, ["scripts/pasang-akun-penjualan-karyawan.js", ...arg], { cwd: new URL("../..", import.meta.url), env: process.env, encoding: "utf8" });

  assert.match(jalankan(), /DRY-RUN/);
  assert.equal(await testPrisma.finAccount.count(), jumlahAwal, "dry-run tidak menulis");

  assert.match(jalankan("--apply"), /SELESAI/);
  const akun = await testPrisma.finAccount.findUnique({ where: { code: "4-1250" }, include: { parent: true } });
  assert.equal(akun.systemKey, SYSTEM_KEYS.PENDAPATAN_PENJUALAN_KARYAWAN);
  assert.equal(akun.type, "PENDAPATAN");
  assert.equal(akun.parent.code, "4-0000");
  assert.equal(await testPrisma.finAccount.count(), jumlahAwal + 1, "tepat satu akun baru");

  assert.match(jalankan("--apply"), /Tidak ada yang perlu dilakukan/);
  assert.equal(await testPrisma.finAccount.count(), jumlahAwal + 1);
});
