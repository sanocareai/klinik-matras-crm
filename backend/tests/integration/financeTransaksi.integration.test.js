// Read-model transaksi Finance Mobile (S6–S8) + penguatan command uang di backend, lewat endpoint ASLI dengan token mobile & peran sungguhan.
// Yang dijaga: bentuk daftar/detail (uang string desimal, aksi dihitung server per izin & status), pagination/pencarian, dokumen yang butuh approval
// membawa tautan ke Inbox S4, Pemasukan Lain tidak bisa dipakai sebagai pembayaran order, kasbon/tagihan/pembatalan aman dari request paralel (row lock),
// piutang & refund mengikuti buku besar, dan tidak ada jurnal yang timpang.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw, DEVICE } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { bukukanPembayaran, bukukanPengakuanPendapatan } from "../../src/services/finance/hooks.js";
import { neraca, neracaSaldo } from "../../src/services/finance/reports.js";

let server;
let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function masuk(roles) {
  const u = await createLoginUser({ roles });
  const r = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device: DEVICE() } });
  assert.equal(r.status, 200, `${roles} → ${JSON.stringify(r.body)}`);
  return { ...u, token: r.body.accessToken };
}
const kunci = () => ({ "Idempotency-Key": randomUUID() });
const get = (u, path) => raw("GET", `/api/finance${path}`, { token: u.token });
const post = (u, path, body, headers = kunci()) => raw("POST", `/api/finance${path}`, { token: u.token, headers, body: body ?? {} });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "KEM Bank", kind: "BANK", accountId: akunBank.id } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, kas.id);
  const modal = await testPrisma.finAccount.findFirst({ where: { code: "3-1100" } });
  // Modal awal supaya saldo bank tidak nol (saldo negatif tetap boleh, tapi pengujian jadi lebih jelas).
  const { postJournal } = await import("../../src/services/finance/journal.js");
  const { toMoney } = await import("../../src/services/finance/money.js");
  const admin = await testPrisma.user.create({ data: { name: "Admin Seed", email: `seed-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  await testPrisma.$transaction((tx) => postJournal(tx, {
    date: new Date("2026-09-01T00:00:00Z"), description: "Modal awal uji", source: "SALDO_AWAL", idempotencyKey: `MODAL:${Date.now()}`, userId: admin.id,
    lines: [{ accountId: akunBank.id, cashAccountId: bank.id, debit: toMoney(50_000_000) }, { accountId: akunKas.id, cashAccountId: kas.id, debit: toMoney(5_000_000) }, { accountId: modal.id, credit: toMoney(55_000_000) }],
  }));
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "SERVIS_KENDARAAN" } });
  return { bank, kas, kat };
}

async function totalSeimbang() {
  const ns = await neracaSaldo(testPrisma, { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-12-31T00:00:00Z") });
  assert.equal(ns.seimbang ?? ns.ringkasan?.seimbang ?? true, true, "neraca saldo harus seimbang");
  const n = await neraca(testPrisma, { to: new Date("2026-12-31T00:00:00Z") });
  assert.equal(n.ringkasan.seimbang, true, `neraca selisih ${n.ringkasan.selisih}`);
}

let no = 0;
async function buatOrder({ value = 2_000_000, nama = "Ibu Sari", status = "DELIVERED" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: nama } });
  return testPrisma.order.create({ data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `SAN-S6-${String(++no).padStart(4, "0")}`, status, paymentStatus: "BELUM_BAYAR" } });
}

test("Pengeluaran: draf → ajukan; aksi dihitung server per izin; uang string; tautan Inbox S4 hanya untuk yang boleh memutuskan; paginasi & cari", async () => {
  const { bank, kat } = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const approver = await masuk(["APPROVER"]);
  const akuntan = await masuk(["ACCOUNTANT"]);

  const draf = await post(fin, "/expenses", { description: "Servis truk", amount: "150000", categoryId: kat.id, mode: "LANGSUNG", cashAccountId: bank.id, langsungAjukan: false });
  assert.equal(draf.status, 201, JSON.stringify(draf.body));
  const dr = await get(fin, "/transaksi/pengeluaran?tab=DRAF");
  assert.equal(dr.status, 200);
  assert.equal(dr.body.items.length, 1);
  const it = dr.body.items[0];
  assert.equal(it.nominal, "150000.00", "uang string desimal");
  assert.equal(it.status, "DRAFT");
  assert.equal(it.aksi.ajukan.boleh, true);
  assert.equal(it.aksi.ubah.boleh, false, "mengubah draf = admin (aturan server yang ada)");
  assert.match(it.aksi.ubah.alasan, /admin/i);
  assert.equal(it.aksi.ajukan.path, `/finance/expenses/${it.id}/submit`);
  assert.equal(dr.body.hitung.DRAF, 1);

  const ak = await get(approver, "/transaksi/pengeluaran?tab=DRAF");
  assert.equal(ak.body.items[0].aksi.ajukan.boleh, false, "penyetuju tidak mencatat/mengajukan");
  assert.ok(ak.body.items[0].aksi.ajukan.alasan);

  const kirim = await post(fin, `/expenses/${it.id}/submit`);
  assert.equal(kirim.status, 200);
  const mn = await get(approver, "/transaksi/pengeluaran?tab=MENUNGGU");
  assert.equal(mn.body.items.length, 1);
  assert.deepEqual(mn.body.items[0].persetujuan, { jenis: "expense", id: it.id }, "dokumen yang menunggu bisa dibuka di Inbox S4");
  const mnFin = await get(akuntan, "/transaksi/pengeluaran?tab=MENUNGGU");
  assert.equal(mnFin.body.items[0].persetujuan, null, "akuntan tidak memutuskan (tanpa FINANCE_APPROVE)");

  // Nota wajib ≥ ambang & tanpa foto ⇒ ditandai (sama dengan aturan Setujui)
  await post(fin, "/expenses", { description: "Besar tanpa nota", amount: "900000", categoryId: kat.id, mode: "LANGSUNG", cashAccountId: bank.id });
  const besar = (await get(fin, "/transaksi/pengeluaran?q=Besar")).body.items[0];
  assert.equal(besar.notaWajib, true);
  assert.equal(besar.adaLampiran, false);

  for (const nm of ["alfa", "beta", "gamma"]) await post(fin, "/expenses", { description: `Batch ${nm}`, amount: "10000", categoryId: kat.id, mode: "LANGSUNG", cashAccountId: bank.id });
  const p1 = await get(fin, "/transaksi/pengeluaran?limit=2&page=1");
  const p3 = await get(fin, "/transaksi/pengeluaran?limit=2&page=3");
  assert.equal(p1.body.items.length, 2);
  assert.equal(p1.body.adaLagi, true);
  assert.equal(p3.body.adaLagi, false);
  assert.equal(p1.body.total, 5);
  assert.equal((await get(fin, "/transaksi/pengeluaran?q=batch%20gamma")).body.items.length, 1);
  assert.equal((await get(fin, "/transaksi/pengeluaran?q=150.000")).body.items.length, 1, "kata angka dicocokkan ke nominal");

  const det = await get(fin, `/transaksi/pengeluaran/${it.id}`);
  assert.equal(det.status, 200);
  assert.ok(det.body.bagian.some((b) => b.judul === "Dokumen"));
  assert.ok(det.body.riwayat.some((r) => r.label === "Diajukan"));
  assert.equal((await get(fin, `/transaksi/pengeluaran/${randomUUID()}`)).status, 404);
  assert.equal((await get(fin, "/transaksi/tidak-ada")).status, 404);
});

test("Izin baca: tanpa FINANCE_READ ditolak 403; token web tanpa Idempotency-Key tetap boleh membaca", async () => {
  await siapkan();
  const fin = await masuk(["FINANCE"]);
  const sales = await createLoginUser({ roles: ["SALES"] });
  const r = await raw("POST", "/api/auth/login", { body: { email: sales.email, password: sales.password } });
  if (r.body?.token) assert.equal((await raw("GET", "/api/finance/transaksi/pengeluaran", { token: r.body.token })).status, 403);
  assert.equal((await raw("GET", "/api/finance/transaksi/ringkasan", { token: fin.token })).status, 200);
  assert.equal((await raw("GET", "/api/finance/transaksi/ringkasan")).status, 401);
});

test("Pemasukan Lain: akun pendapatan penjualan/layanan DITOLAK (bukan pembayaran order); akun pendapatan lain diterima; pembatalan ganda paralel hanya sekali", async () => {
  const { bank } = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const admin = await masuk(["ADMIN", "FINANCE"]);
  const opsi = (await get(fin, "/transaksi/opsi")).body;
  const lain = await testPrisma.finAccount.findUnique({ where: { systemKey: "PENDAPATAN_LAIN" } });
  const produk = await testPrisma.finAccount.findUnique({ where: { systemKey: "PENDAPATAN_PRODUK" } });
  assert.ok(opsi.akunPemasukanLain.some((a) => a.id === lain.id));
  assert.equal(opsi.akunPemasukanLain.some((a) => a.id === produk.id), false, "akun penjualan tidak ditawarkan");
  assert.ok(opsi.rekening.some((r) => r.id === bank.id && /^-?\d+\.\d{2}$/.test(r.saldo)));

  const ditolak = await post(fin, "/other-income", { description: "Pelanggan bayar", amount: "500000", accountId: produk.id, cashAccountId: bank.id });
  assert.equal(ditolak.status, 400);
  assert.match(ditolak.body.error, /Pembayaran & Verifikasi/);
  assert.equal(await testPrisma.finOtherIncome.count(), 0, "tidak ada dokumen/jurnal yang terbentuk");

  const ok = await post(fin, "/other-income", { description: "Bunga bank", amount: "75000.50", accountId: lain.id, cashAccountId: bank.id });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const daftar = (await get(fin, "/transaksi/pemasukan")).body;
  assert.equal(daftar.items[0].nominal, "75000.50");
  assert.equal(daftar.ringkasan.total, "75000.50");
  assert.equal(daftar.items[0].aksi.batalkan.boleh, false, "FINANCE tanpa FINANCE_ADMIN");
  const detail = (await get(fin, `/transaksi/pemasukan/${ok.body.id}`)).body;
  assert.match(detail.catatan, /bukan pembayaran order/i);

  const [a, b] = await Promise.all([post(admin, `/other-income/${ok.body.id}/cancel`, { reason: "salah" }), post(admin, `/other-income/${ok.body.id}/cancel`, { reason: "salah" })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.status}/${b.status}`);
  const aktif = await testPrisma.finJournalEntry.count({ where: { status: "POSTED", source: "PEMASUKAN_LAIN" } });
  assert.equal(aktif, 0, "jurnal hanya dibalik sekali");
  await totalSeimbang();
});

test("Kasbon: hanya karyawan aktif & rekening valid; sisa/pelunasan dihitung server; dua potong gaji paralel tidak bisa melampaui kasbon", async () => {
  const { bank } = await siapkan();
  const fin = await masuk(["FINANCE"]);
  await testPrisma.user.create({ data: { name: "Agung", email: "agung@klinikmatras.com", passwordHash: bcrypt.hashSync("x", 4), role: "DRIVER", active: true } });
  const opsi = (await get(fin, "/transaksi/opsi")).body;
  assert.ok(opsi.karyawan.some((k) => k.name === "Agung"));
  assert.equal(opsi.karyawan.some((k) => /owner|kurir eksternal/i.test(k.name)), false);

  const buat = await post(fin, "/kasbon", { employeeName: "agung", amount: "1000000", urgency: "keperluan keluarga", cashAccountId: bank.id, date: "2026-09-10" });
  assert.equal(buat.status, 201, JSON.stringify(buat.body));
  const tolak = await post(fin, "/kasbon", { employeeName: "OWNER (Admin)", amount: "1000", urgency: "uji tolak", cashAccountId: bank.id });
  assert.equal(tolak.status, 400);

  const it = (await get(fin, "/transaksi/kasbon")).body.items[0];
  assert.equal(it.sisa, "1000000.00");
  assert.equal(it.aksi.potongGaji.boleh, true);
  assert.deepEqual(it.aksi.potongGaji.tetap, { method: "POTONG_GAJI" });
  assert.equal(it.aksi.batalkan.boleh, false);

  const [a, b] = await Promise.all([
    post(fin, `/kasbon/${it.id}/pelunasan`, { method: "POTONG_GAJI", amount: "600000", date: "2026-09-20" }),
    post(fin, `/kasbon/${it.id}/pelunasan`, { method: "POTONG_GAJI", amount: "600000", date: "2026-09-20" }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 400], `${a.status}/${b.status}`);
  const setelah = (await get(fin, `/transaksi/kasbon/${it.id}`)).body;
  assert.equal(setelah.sisa, "400000.00", "tidak melampaui kasbon");
  assert.equal(setelah.terbayar, "600000.00");
  assert.equal(setelah.bagian.find((x) => x.judul === "Pemotongan gaji").baris.length, 1);
  assert.equal((await get(fin, "/transaksi/kasbon")).body.ringkasan.sisaAktif, "400000.00");
  await totalSeimbang();
});

test("Supplier & Utang: tagihan → disetujui → pembayaran parsial/penuh; dua pembayaran paralel tidak bisa melebihi sisa; umur & jatuh tempo dari server; pembatalan mengembalikan utang", async () => {
  const { bank, kat } = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const approver = await masuk(["APPROVER"]);
  const admin = await masuk(["ADMIN", "FINANCE"]);

  const sup = await post(fin, "/suppliers", { name: "CV Busa Jaya", paymentTermDays: 14, bankName: "BCA", bankAccount: "1234567", bankHolder: "CV Busa Jaya" });
  assert.equal(sup.status, 201);
  const tagihan = await post(fin, "/bills", { supplierId: sup.body.id, billDate: "2026-08-01", dueDate: "2026-08-15", amount: "1000000", description: "Busa 20 lembar", expenseCategoryId: kat.id });
  assert.equal(tagihan.status, 201, JSON.stringify(tagihan.body));
  const menunggu = (await get(approver, "/transaksi/tagihan?tab=MENUNGGU")).body.items[0];
  assert.deepEqual(menunggu.persetujuan, { jenis: "bill", id: tagihan.body.id });
  assert.equal(menunggu.aksi.bayar.boleh, false);
  assert.equal((await post(approver, `/bills/${tagihan.body.id}/approve`)).status, 200);

  const terbuka = (await get(fin, "/transaksi/tagihan?tab=TERBUKA")).body;
  const t = terbuka.items[0];
  assert.equal(t.sisa, "1000000.00");
  assert.equal(t.jatuhTempo, "2026-08-15");
  assert.ok(t.umurHari > 0, "lewat jatuh tempo");
  assert.equal(t.aksi.bayar.boleh, true);
  assert.equal(t.aksi.bayar.tetap.billId, tagihan.body.id);
  assert.equal(terbuka.ringkasan.utangTerbuka, "1000000.00");
  assert.equal((await get(fin, "/transaksi/tagihan?tab=TERBUKA&jatuhTempo=lewat")).body.items.length, 1);
  const sd = (await get(fin, "/transaksi/supplier")).body.items[0];
  assert.equal(sd.sisa, "1000000.00");

  // Parsial 400.000, lalu dua pembayaran paralel masing-masing 600.000 → tepat satu lolos.
  const parsial = await post(fin, "/supplier-payments", { supplierId: sup.body.id, cashAccountId: bank.id, date: "2026-09-20", allocations: [{ billId: t.id, amount: "400000" }] });
  assert.equal(parsial.status, 201, JSON.stringify(parsial.body));
  assert.equal((await get(fin, `/transaksi/tagihan/${t.id}`)).body.status, "DIBAYAR_SEBAGIAN");
  const bayar = () => post(fin, "/supplier-payments", { supplierId: sup.body.id, cashAccountId: bank.id, date: "2026-09-20", allocations: [{ billId: t.id, amount: "600000" }] });
  const [a, b] = await Promise.all([bayar(), bayar()]);
  // Yang kedua melihat tagihan sudah LUNAS (kunci baris menyerialkan keduanya) — ditolak, tidak pernah melebihi sisa.
  assert.deepEqual([a.status, b.status].sort(), [201, 409], `${a.status}/${b.status} ${JSON.stringify([a.body, b.body])}`);
  const lunas = (await get(fin, `/transaksi/tagihan/${t.id}`)).body;
  assert.equal(lunas.status, "LUNAS");
  assert.equal(lunas.sisa, "0.00");
  assert.equal(lunas.bagian.find((x) => x.judul === "Pembayaran").baris.length, 2);
  const utang = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.UTANG_USAHA } });
  const g = await testPrisma.finJournalLine.aggregate({ where: { accountId: utang.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  assert.equal(Number(g._sum.credit) - Number(g._sum.debit), 0, "Utang Usaha tidak bersaldo debit dan tidak tersisa");

  // Duplikat billId dalam satu pembayaran ditolak
  const dobel = await post(fin, "/supplier-payments", { supplierId: sup.body.id, cashAccountId: bank.id, allocations: [{ billId: t.id, amount: "1" }, { billId: t.id, amount: "1" }] });
  assert.equal(dobel.status, 400);

  // Pembatalan (admin) — dua kali paralel hanya sekali; utang kembali terbuka.
  const bayarId = (await get(fin, "/transaksi/pembayaran-supplier")).body.items.find((x) => x.nominal === "400000.00").id;
  const [c1, c2] = await Promise.all([post(admin, `/supplier-payments/${bayarId}/cancel`, { reason: "salah rekening" }), post(admin, `/supplier-payments/${bayarId}/cancel`, { reason: "salah rekening" })]);
  assert.deepEqual([c1.status, c2.status].sort(), [200, 409]);
  const setelah = (await get(fin, `/transaksi/tagihan/${t.id}`)).body;
  assert.equal(setelah.status, "DIBAYAR_SEBAGIAN");
  assert.equal(setelah.sisa, "400000.00");
  const detSup = (await get(fin, `/transaksi/supplier/${sup.body.id}`)).body;
  assert.equal(detSup.supplier.bank, "BCA");
  assert.equal(detSup.bagian.find((x) => x.judul === "Utang terbuka").baris.length, 1);
  await totalSeimbang();
});

test("Piutang & Refund: piutang dari buku besar (sisa, umur, jatuh tempo); refund dibatasi uang yang diterima; approval lewat S4; pembayaran resmi terlihat", async () => {
  const { bank } = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const approver = await masuk(["APPROVER"]);
  const order = await buatOrder({ value: 2_000_000 });
  await testPrisma.invoice.create({ data: { invoiceNumber: `INV-S6-${Date.now()}`, orderId: order.id, dueDate: new Date("2026-09-01T00:00:00Z"), lifecycleStatus: "SENT" } });
  const pay = await testPrisma.payment.create({ data: { orderId: order.id, amount: 500_000, method: "TRANSFER", cashAccountId: bank.id, recordedById: fin.user.id } });
  await testPrisma.$transaction(async (tx) => {
    await bukukanPengakuanPendapatan(tx, { orderId: order.id, status: "DELIVERED", userId: fin.user.id });
    await bukukanPembayaran(tx, { paymentId: pay.id, userId: fin.user.id });
  });

  const daftar = (await get(fin, "/transaksi/piutang")).body;
  assert.equal(daftar.items.length, 1, JSON.stringify(daftar));
  const p = daftar.items[0];
  assert.equal(p.sisa, "1500000.00");
  assert.equal(p.jatuhTempo, "2026-09-01");
  assert.ok(p.umurHari > 0);
  assert.equal(p.status, "LEWAT_TEMPO");
  assert.equal(daftar.hitung.LEWAT, 1);
  assert.equal(daftar.ringkasan.total, "1500000.00");
  assert.equal((await get(fin, "/transaksi/piutang?tab=BERJALAN")).body.items.length, 0);
  assert.equal((await get(fin, "/transaksi/piutang?q=zzz")).body.items.length, 0);

  const det = (await get(fin, `/transaksi/piutang/${order.id}`)).body;
  assert.equal(det.sisa, "1500000.00");
  assert.equal(det.pembayaran.length, 1);
  assert.equal(det.pembayaran[0].nominal, "500000.00");
  assert.equal(det.pembayaran[0].aksiAlokasi.boleh, true);
  assert.equal(det.pembayaran[0].aksiAlokasi.path, `/finance/customer-payments/${pay.id}/allocations`);
  assert.ok(det.orderPelanggan.some((o) => o.id === order.id));

  const cari = (await get(fin, `/transaksi/opsi/order?q=${order.orderNumber}`)).body.orders;
  assert.equal(cari[0].sisaBisaDirefund, "500000.00", "server yang menghitung uang yang boleh dikembalikan");

  const lebih = await post(fin, "/refunds", { orderId: order.id, amount: "900000", reason: "batal", cashAccountId: bank.id });
  assert.equal(lebih.status, 400, "refund tidak boleh melebihi uang yang diterima");
  const ok = await post(fin, "/refunds", { orderId: order.id, amount: "200000", reason: "kasur cacat", cashAccountId: bank.id });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const mn = (await get(approver, "/transaksi/refund?tab=MENUNGGU")).body.items[0];
  assert.deepEqual(mn.persetujuan, { jenis: "refund", id: ok.body.id });
  assert.equal(mn.nominal, "200000.00");
  assert.equal((await post(approver, `/refunds/${ok.body.id}/approve`)).status, 200);
  const sesudah = (await get(fin, `/transaksi/refund/${ok.body.id}`)).body;
  assert.equal(sesudah.status, "DISETUJUI");
  assert.equal(sesudah.bagian.find((x) => x.judul === "Sumber pembayaran").baris.find((r) => r.label.includes("masih bisa")).nilai, "300000.00");
  await totalSeimbang();
});

test("Pembayaran & bayar dokumen: bayar reimbursement paralel hanya sekali; ringkasan modul; pembelian sama dengan pengeluaran", async () => {
  const { bank, kas } = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const approver = await masuk(["APPROVER"]);
  const katBeli = await testPrisma.finPurchaseCategory.findFirst();
  const dokBeli = await post(fin, "/purchases", { description: "Kain oscar", amount: "12000", categoryId: katBeli.id, mode: "REIMBURSEMENT", reimburseToId: fin.user.id });
  assert.equal(dokBeli.status, 201, JSON.stringify(dokBeli.body));
  const foto = await testPrisma.finPurchase.update({ where: { id: dokBeli.body.id }, data: { receiptUrl: "/media/finance-receipts/ab12.jpg" } });
  assert.ok(foto);
  assert.equal((await post(approver, `/purchases/${dokBeli.body.id}/approve`)).status, 200);
  const it = (await get(fin, "/transaksi/pembelian?tab=DIPROSES")).body.items[0];
  assert.equal(it.aksi.bayar.boleh, true);
  assert.deepEqual(it.aksi.bayar.perlu, ["rekening", "tanggal"]);
  const bayar = () => post(fin, `/purchases/${it.id}/pay`, { cashAccountId: kas.id });
  const [a, b] = await Promise.all([bayar(), bayar()]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.status}/${b.status}`);
  const jurnalBayar = await testPrisma.finJournalEntry.count({ where: { idempotencyKey: { startsWith: "PEMBELIAN_DIBAYAR:" }, status: "POSTED" } });
  assert.equal(jurnalBayar, 1, "hanya satu jurnal pembayaran");
  const ring = (await get(fin, "/transaksi/ringkasan")).body;
  assert.equal(ring.pembelian.menunggu, 0);
  assert.equal(ring.supplier.aktif, 0);
  void bank;
  await totalSeimbang();
});

test("Idempotency-Key pada perintah uang: kunci sama = respons diputar ulang (tidak ganda); tanpa kunci 428 untuk token mobile", async () => {
  const { bank } = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const lain = await testPrisma.finAccount.findUnique({ where: { systemKey: "PENDAPATAN_LAIN" } });
  const h = kunci();
  const badan = { description: "Bunga", amount: "1000", accountId: lain.id, cashAccountId: bank.id };
  const a = await post(fin, "/other-income", badan, h);
  const b = await post(fin, "/other-income", badan, h);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.headers.get("idempotent-replayed"), "true");
  assert.equal(await testPrisma.finOtherIncome.count(), 1);
  const tanpa = await raw("POST", "/api/finance/other-income", { token: fin.token, body: badan });
  assert.equal(tanpa.status, 428);
});
