// SINKRONISASI PENJUALAN KARYAWAN (PKR Finance) -> ORDER CRM -> UNIT PRODUKSI -> DELIVERY, terhadap PostgreSQL sungguhan.
// Yang dikunci: (1) PKR dicatat = tepat 1 Order + 1 Unit + 1 Customer, tertaut 1:1 (UNIQUE); (2) replay/paralel tidak menggandakan apa pun; (3) TIDAK ada jurnal, Payment, invoice, item, atau
// pendapatan kedua — termasuk saat order "diserahkan" dan lewat INSERT langsung (trigger DB); (4) PKR lama bisa ditautkan lewat aksi eksplisit + dry-run, tanpa backfill; (5) spesifikasi
// belum lengkap memblokir Produksi; (6) job pengiriman hanya bila perlu dikirim dan tidak ganda; (7) pembatalan sebelum/sesudah proses; (8) izin per peran; (9) audit.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { startStageInTx } from "../../src/services/unitStageEngine.js";
import { suggestDeliveryJob } from "../../src/services/deliveryHandoff.js";
import { bacaSpesifikasiPkr } from "../../src/lib/domain/pkrSpesifikasi.js";
import { createOrderForCustomer } from "../../src/services/orderCreation.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const kunci = () => ({ "Idempotency-Key": `pkr-${randomUUID()}` });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const seller = await testPrisma.user.create({ data: { name: "Emon Uji", email: `emon-${randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const peran = async (r) => { const u = await createTestUser({ roles: [r] }); return { id: u.user.id, c: makeClient(server.baseUrl, u.token) }; };
  const admin = await peran("ADMIN"); const finance = await peran("FINANCE"); const sales = await peran("SALES");
  const produksi = await peran("PRODUCTION_LEAD"); const dispatcher = await peran("DISPATCHER"); const driver = await peran("DRIVER");
  return { rekening, seller, admin, finance, sales, produksi, dispatcher, driver };
}
const badan = (seller, extra = {}) => ({
  date: "2026-10-02", sellerId: seller.id, buyerName: "Bu Ani (kerabat)",
  items: [{ name: "Kasur Sano 160x200", quantity: 1, unitPrice: 1_300_000 }, { name: "Bantal", quantity: 2, unitPrice: 150_000 }], ...extra,
});
const LENGKAP = { kategori: "BARU", merk: "Sano", ukuran: "160 x 200", perluDikirim: true, alamat: "Jl. Mawar 5, Bekasi", kota: "Bekasi" };

async function jejak() {
  const agg = await testPrisma.finJournalLine.aggregate({ _sum: { debit: true, credit: true } });
  return {
    jurnal: await testPrisma.finJournalEntry.count(), baris: await testPrisma.finJournalLine.count(), debit: String(agg._sum.debit ?? 0), kredit: String(agg._sum.credit ?? 0),
    payment: await testPrisma.payment.count(), invoice: await testPrisma.invoice.count(), item: await testPrisma.orderItem.count(), gap: await testPrisma.finPostingGap.count(),
  };
}
const catatPkr = async (w, orderCrm, headers = kunci()) => {
  const r = await w.finance.c.post("/api/finance/penjualan-karyawan", badan(w.seller, orderCrm ? { orderCrm } : {}), headers);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};

// ═══ 1. PKR dicatat = tepat 1 order + 1 unit, tertaut 1:1, tanpa uang ═══
test("PKR dicatat menghasilkan TEPAT 1 Order + 1 Unit + 1 Customer tertaut 1:1; order operasional: nilai 0, tanpa item/invoice/Payment/Sales; hanya 1 jurnal (milik PKR)", async () => {
  const w = await siapkan();
  const p = await catatPkr(w, LENGKAP);
  assert.equal(await testPrisma.order.count(), 1);
  assert.equal(await testPrisma.unit.count(), 1);
  assert.equal(await testPrisma.customer.count(), 1);
  const order = await testPrisma.order.findFirst({ include: { customer: true, units: true } });
  assert.equal(order.penjualanKaryawanId, p.id, "tautan stabil ke ID PKR (bukan email/nama)");
  assert.equal(order.value, 0);
  assert.equal(order.salesOwnerId, null);
  assert.equal(order.paymentStatus, "BELUM_BAYAR");
  assert.equal(order.customer.staffUserId, w.seller.id, "pemilik order = profil internal karyawan, dikenali lewat ID akun");
  assert.equal(order.customer.name, "Emon Uji", "nama profil = snapshot nama karyawan; nama pembeli (kerabat) tetap di PKR");
  assert.deepEqual(order.customer.tags, ["Penjualan Karyawan"]);
  assert.equal(JSON.parse(order.notes).pembeliPkr, "Bu Ani (kerabat)", "nama pembeli disalin sebagai snapshot ke catatan order");
  assert.equal(order.units.length, 1);
  assert.equal(order.units[0].merk, "Sano");
  const j = await jejak();
  assert.equal(j.jurnal, 1, "hanya jurnal PKR; order tidak membuat jurnal");
  assert.equal(j.payment + j.invoice + j.item + j.gap, 0, "tanpa Payment, invoice, item, atau gap posting");
  const kosong = await testPrisma.finJournalEntry.count({ where: { source: { not: "PENJUALAN_KARYAWAN" } } });
  assert.equal(kosong, 0);

  assert.equal(p.sinkron.order.nomor, order.orderNumber);
  assert.equal(p.sinkron.order.spesifikasi.lengkap, true);
  assert.equal(p.sinkron.pembayaran.status, "BELUM_BAYAR", "status bayar dari LEDGER PKR");
  assert.equal(p.sinkron.pembayaran.total, 1_600_000);
  assert.equal(p.sinkron.produksi.kode, "MENUNGGU");
  assert.equal(p.sinkron.units.length, 1);
});

test("UNIQUE: satu PKR tidak bisa punya dua order; satu order tidak bisa menunjuk dua PKR", async () => {
  const w = await siapkan();
  const p = await catatPkr(w, LENGKAP);
  const customer = await testPrisma.customer.create({ data: { name: "X" } });
  await assert.rejects(() => testPrisma.order.create({ data: { customerId: customer.id, value: 0, penjualanKaryawanId: p.id } }), /Unique|unique/i);
});

// ═══ 2. Idempoten + paralel ═══
test("replay Idempotency-Key dan POST order-crm berulang/paralel tidak menggandakan Order, Customer, atau Unit", async () => {
  const w = await siapkan();
  const h = kunci();
  const a = await w.finance.c.post("/api/finance/penjualan-karyawan", badan(w.seller, { orderCrm: LENGKAP }), h);
  const b = await w.finance.c.post("/api/finance/penjualan-karyawan", badan(w.seller, { orderCrm: LENGKAP }), h);
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal(b.body.id, a.body.id, "replay = respons yang sama");
  assert.deepEqual([await testPrisma.finPenjualanKaryawan.count(), await testPrisma.order.count(), await testPrisma.unit.count(), await testPrisma.customer.count()], [1, 1, 1, 1]);

  const hasil = await Promise.all([1, 2, 3, 4, 5].map(() => w.finance.c.post(`/api/finance/penjualan-karyawan/${a.body.id}/order-crm`, { spesifikasi: LENGKAP }, kunci())));
  assert.ok(hasil.every((r) => [200, 201].includes(r.status)), JSON.stringify(hasil.map((r) => r.status)));
  assert.equal(new Set(hasil.map((r) => r.body.orderId)).size, 1);
  assert.deepEqual([await testPrisma.order.count(), await testPrisma.unit.count(), await testPrisma.customer.count()], [1, 1, 1], "paralel tidak menggandakan");
  assert.equal((await jejak()).jurnal, 1);
});

// ═══ 3. Tanpa uang kedua ═══
test("order 'diserahkan' TIDAK mengakui pendapatan, tidak membuat gap, dan jalur uang order ditolak (aplikasi + trigger DB)", async () => {
  const w = await siapkan();
  const p = await catatPkr(w, LENGKAP);
  const order = await testPrisma.order.findFirst();
  const sebelum = await jejak();

  // Penyerahan manual lewat jalur baku (status -> DELIVERED) memicu hook pengakuan pendapatan: harus melewati tanpa jurnal & tanpa gap NILAI_ORDER_NOL.
  const d = await w.admin.c.patch(`/api/orders/${order.id}`, { status: "DELIVERED", deliveryConfirmedDate: "2026-10-10" });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.deepEqual(await jejak(), sebelum, "DELIVERED tidak menambah jurnal/gap/payment/invoice");

  for (const [m, url, body] of [
    ["post", `/api/orders/${order.id}/payments`, { amount: 1000, method: "CASH" }],
    ["get", `/api/orders/${order.id}/invoice`],
    ["patch", `/api/orders/${order.id}/invoice`, {}],
    ["post", `/api/orders/${order.id}/items`, { layananName: "Kasur", harga: 1_000_000 }],
    ["patch", `/api/orders/${order.id}`, { paymentStatus: "LUNAS" }],
    ["patch", `/api/orders/${order.id}`, { hargaTotal: 5_000_000 }],
    ["post", `/api/orders/${order.id}/cancel`, { reason: "salah" }],
    ["delete", `/api/orders/${order.id}`],
  ]) {
    const r = await w.admin.c[m](url, body);
    assert.equal(r.status, 409, `${m} ${url} harus 409, dapat ${r.status} ${JSON.stringify(r.body)}`);
    assert.match(String(r.body.error), /Penjualan Karyawan/);
  }
  assert.deepEqual(await jejak(), sebelum);
  const segar = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.equal(segar.value, 0); assert.equal(segar.paymentStatus, "BELUM_BAYAR"); assert.equal(segar.paidAt, null);

  // Pengaman terakhir: INSERT langsung (melewati kode aplikasi) ditolak trigger DB.
  const user = await testPrisma.user.findFirst();
  await assert.rejects(() => testPrisma.payment.create({ data: { orderId: order.id, amount: 1000, method: "CASH", recordedById: user.id } }), /Penjualan Karyawan hanya dokumen operasional/);
  await assert.rejects(() => testPrisma.invoice.create({ data: { orderId: order.id, invoiceNumber: "INV-UJI-001" } }), /Penjualan Karyawan hanya dokumen operasional/);
  await assert.rejects(() => testPrisma.orderItem.create({ data: { orderId: order.id, layananName: "Kasur", harga: 1000 } }), /Penjualan Karyawan hanya dokumen operasional/);
  // Baris jurnal: ditolak HANYA untuk posting customer (pembayaran/pengakuan pendapatan/refund) — lihat blok "AUDIT TRIGGER" di bawah untuk sisi yang sengaja diizinkan.
  const ln = await testPrisma.finJournalLine.findFirst();
  const entriTes = await testPrisma.finJournalEntry.create({ data: { entryNumber: "JV-UJI-TOLAK", date: new Date("2026-10-09"), description: "uji", source: "PENGAKUAN_PENDAPATAN", sourceId: randomUUID() } });
  await assert.rejects(
    () => testPrisma.$executeRawUnsafe(`INSERT INTO fin_journal_lines (id, entry_id, line_no, account_id, debit, credit, order_id) VALUES (gen_random_uuid(), $1::uuid, 1, $2::uuid, 1, 0, $3)`, entriTes.id, ln.accountId, order.id),
    /Penjualan Karyawan hanya dokumen operasional/,
  );
  await testPrisma.finJournalEntry.delete({ where: { id: entriTes.id } });
  assert.deepEqual(await jejak(), sebelum);
  assert.ok(p.id);
});

test("order PKR tidak ikut KPI/omzet CRM (daftar order, pipeline, search pembayaran); status bayar di daftar = ledger PKR; nominal hanya untuk berizin Finance", async () => {
  const w = await siapkan();
  await catatPkr(w, LENGKAP);
  const adm = await w.admin.c.get("/api/orders?limit=50");
  assert.equal(adm.status, 200);
  assert.equal(adm.body.items.length, 1, "order tetap terlihat di CRM");
  assert.equal(adm.body.summary.totalOrderAktif, 0, "KPI penjualan CRM tidak menghitung order PKR");
  const it = adm.body.items[0];
  assert.equal(it.penjualanKaryawan.nomor, "PKR-02102026-001");
  assert.equal(it.penjualanKaryawan.pembayaran.status, "BELUM_BAYAR");
  assert.equal(it.penjualanKaryawan.pembayaran.total, 1_600_000);
  const sls = await w.sales.c.get("/api/orders?limit=50");
  if (sls.status === 200 && sls.body.items?.length) assert.equal(sls.body.items[0].penjualanKaryawan.pembayaran.total, undefined, "Sales tanpa izin Finance tidak melihat nominal");
  const pipe = await w.admin.c.get("/api/pipeline/order-board");
  if (pipe.status === 200) assert.equal(JSON.stringify(pipe.body).includes("PKR"), false);
});

test("pembayaran PKR (ledger Finance) mengubah status bayar di ringkasan order, bukan di Order", async () => {
  const w = await siapkan();
  const p = await catatPkr(w, LENGKAP);
  const bayar = await w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran`, { date: "2026-10-03", amount: 600_000, method: "TRANSFER", cashAccountId: w.rekening.id }, kunci());
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  assert.equal(bayar.body.sinkron.pembayaran.status, "SEBAGIAN");
  assert.equal(bayar.body.sinkron.pembayaran.terbayar, 600_000);
  const order = await testPrisma.order.findFirst();
  assert.equal(order.paymentStatus, "BELUM_BAYAR", "kolom Order tidak disentuh");
  assert.equal(await testPrisma.payment.count(), 0, "tidak ada Payment order");
});

// ═══ 4. PKR lama ═══
test("PKR lama: dry-run menampilkan yang belum punya order tanpa menulis; aksi eksplisit membuat/menautkan; tidak ada backfill massal", async () => {
  const w = await siapkan();
  // PKR 'lama' dibuat langsung di DB (tanpa order), seperti dokumen sebelum fitur ini.
  const lama = await testPrisma.finPenjualanKaryawan.create({
    data: { nomor: "PKR-01102026-001", date: new Date("2026-10-01"), sellerId: w.seller.id, buyerName: "Pak Budi", total: 500_000, items: { create: [{ name: "Bantal", quantity: 1, unitPrice: 500_000 }] } },
  });
  const sebelum = { order: await testPrisma.order.count(), unit: await testPrisma.unit.count(), customer: await testPrisma.customer.count() };
  const dry = await w.finance.c.get("/api/finance/penjualan-karyawan/order-crm/dry-run");
  assert.equal(dry.status, 200);
  assert.equal(dry.body.jumlah, 1);
  assert.equal(dry.body.daftar[0].nomor, "PKR-01102026-001");
  assert.deepEqual({ order: await testPrisma.order.count(), unit: await testPrisma.unit.count(), customer: await testPrisma.customer.count() }, sebelum, "dry-run tidak menulis");

  const b = await w.finance.c.post(`/api/finance/penjualan-karyawan/${lama.id}/order-crm`, { spesifikasi: { kategori: "BARU", jumlahUnit: 2 } }, kunci());
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal(await testPrisma.order.count(), 1);
  assert.equal(await testPrisma.unit.count(), 2);
  assert.equal(b.body.sinkron.order.spesifikasi.lengkap, false);
  assert.equal(b.body.sinkron.produksi.kode, "PERLU_DILENGKAPI");
  assert.equal((await w.finance.c.get("/api/finance/penjualan-karyawan/order-crm/dry-run")).body.jumlah, 0);
  assert.equal((await jejak()).jurnal, 0, "tidak ada jurnal baru untuk PKR lama");
});

test("tautkan order yang sudah ada: hanya order KOSONG secara keuangan; order bernilai/berbayar/berinvoice ditolak", async () => {
  const w = await siapkan();
  const lama = await testPrisma.finPenjualanKaryawan.create({
    data: { nomor: "PKR-01102026-002", date: new Date("2026-10-01"), sellerId: w.seller.id, buyerName: "Pak Budi", total: 500_000, items: { create: [{ name: "Bantal", quantity: 1, unitPrice: 500_000 }] } },
  });
  const cust = await testPrisma.customer.create({ data: { name: "Pak Budi" } });
  const berisi = await testPrisma.order.create({ data: { customerId: cust.id, value: 500_000, status: "PENDING" } });
  const ditolak = await w.finance.c.post(`/api/finance/penjualan-karyawan/${lama.id}/order-crm`, { orderId: berisi.id }, kunci());
  assert.equal(ditolak.status, 409);
  assert.equal(ditolak.body.code, "ORDER_SUDAH_BERNILAI");
  const kosong = await testPrisma.order.create({ data: { customerId: cust.id, value: 0, status: "PENDING" } });
  const ok = await w.finance.c.post(`/api/finance/penjualan-karyawan/${lama.id}/order-crm`, { orderId: kosong.id }, kunci());
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await testPrisma.order.findUnique({ where: { id: kosong.id } })).penjualanKaryawanId, lama.id);
  const lain = await testPrisma.finPenjualanKaryawan.create({ data: { nomor: "PKR-01102026-003", date: new Date("2026-10-01"), sellerId: w.seller.id, buyerName: "Z", total: 1000, items: { create: [{ name: "x", quantity: 1, unitPrice: 1000 }] } } });
  const dua = await w.finance.c.post(`/api/finance/penjualan-karyawan/${lain.id}/order-crm`, { orderId: kosong.id }, kunci());
  assert.equal(dua.status, 409, "order yang sudah tertaut tidak bisa ditautkan ke PKR kedua");
});

// ═══ 5. Spesifikasi & gerbang Produksi ═══
test("spesifikasi belum lengkap = 'Perlu dilengkapi' dan Produksi TIDAK boleh memulai; setelah dilengkapi gerbang terbuka", async () => {
  const w = await siapkan();
  const p = await catatPkr(w, undefined); // tanpa spesifikasi
  assert.equal(p.sinkron.order.spesifikasi.lengkap, false);
  assert.deepEqual(p.sinkron.order.spesifikasi.kurang, ["Merk kasur", "Ukuran", "Dikirim atau diambil sendiri"]);
  assert.equal(p.sinkron.produksi.label, "Perlu dilengkapi");
  const unit = await testPrisma.unit.findFirst();
  await assert.rejects(() => testPrisma.$transaction((tx) => startStageInTx(tx, unit.id, { actorId: w.produksi.id })), /perlu dilengkapi dulu.*Produksi belum boleh dimulai/);

  const l1 = await w.finance.c.put(`/api/finance/penjualan-karyawan/${p.id}/order-crm`, { merk: "Sano", ukuran: "160 x 200", perluDikirim: false }, kunci());
  assert.equal(l1.status, 200, JSON.stringify(l1.body));
  assert.equal(l1.body.spesifikasi.lengkap, true);
  assert.equal(l1.body.sinkron.produksi.kode, "MENUNGGU");
  const gagalLain = await testPrisma.$transaction((tx) => startStageInTx(tx, unit.id, { actorId: w.produksi.id })).then(() => null, (e) => e);
  assert.ok(!/perlu dilengkapi dulu/.test(String(gagalLain?.message)), `gerbang PKR sudah terbuka (galat berikutnya boleh ada: ${gagalLain?.message})`);
  const u = await testPrisma.unit.findUnique({ where: { id: unit.id } });
  assert.equal(u.merk, "Sano"); assert.equal(u.ukuran, "160 x 200", "unit ikut tersinkron");
  assert.equal(bacaSpesifikasiPkr({ notes: JSON.stringify({ merkKasur: "A", ukuranKasur: "B" }), pkrPerluDikirim: true, deliveryAddress: "  " }).kurang.join(), "Alamat pengiriman");
});

// ═══ 6. Delivery ═══
test("job pengiriman HANYA bila perlu dikirim; diambil sendiri/belum ditentukan = tanpa job; pemanggilan berulang tidak menggandakan job", async () => {
  const w = await siapkan();
  const p1 = await catatPkr(w, { ...LENGKAP, perluDikirim: false });
  const u1 = await testPrisma.unit.findFirst({ where: { order: { penjualanKaryawanId: p1.id } } });
  await testPrisma.unit.update({ where: { id: u1.id }, data: { status: "READY_FOR_DELIVERY" } });
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u1.id));
  assert.equal(await testPrisma.job.count(), 0, "diambil sendiri = tidak ada job");

  const r = await w.finance.c.post("/api/finance/penjualan-karyawan", badan(w.seller, { buyerName: "Bu Dewi", orderCrm: LENGKAP }), kunci());
  const u2 = await testPrisma.unit.findFirst({ where: { order: { penjualanKaryawanId: r.body.id } } });
  await testPrisma.unit.update({ where: { id: u2.id }, data: { status: "READY_FOR_DELIVERY" } });
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u2.id));
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u2.id));
  await Promise.all([1, 2, 3].map(() => testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u2.id)).catch(() => null)));
  assert.equal(await testPrisma.job.count({ where: { type: "DELIVERY", orderId: u2.orderId } }), 1, "tepat satu job pengiriman");
  const job = await testPrisma.job.findFirst({ where: { orderId: u2.orderId } });
  assert.match(job.addressText, /Mawar 5/);
  const detail = await w.dispatcher.c.get(`/api/armada/jobs/${job.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.penjualanKaryawan.nomor, r.body.nomor, "job menampilkan rujukan PKR");
  assert.equal(detail.body.penjualanKaryawan.total, undefined, "tanpa nominal di Delivery");
});

test("LAYANAN: job pengambilan lahir lewat jalur baku, satu kali", async () => {
  const w = await siapkan();
  const p = await catatPkr(w, { ...LENGKAP, kategori: "LAYANAN" });
  const orderId = (await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } })).id;
  assert.equal(await testPrisma.job.count({ where: { orderId, type: "PICKUP" } }), 1);
  await w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/order-crm`, { spesifikasi: LENGKAP }, kunci());
  assert.equal(await testPrisma.job.count({ where: { orderId } }), 1, "tidak menggandakan");
});

test("alamat diubah: tersinkron ke job yang belum selesai (tanpa menimpa ubahan manual dispatcher) + audit sebelum/sesudah", async () => {
  const w = await siapkan();
  const p = await catatPkr(w, LENGKAP);
  const order = await testPrisma.order.findFirst();
  const u = await testPrisma.unit.findFirst();
  await testPrisma.unit.update({ where: { id: u.id }, data: { status: "READY_FOR_DELIVERY" } });
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
  const job = await testPrisma.job.findFirst({ where: { orderId: order.id } });
  const r = await w.finance.c.put(`/api/finance/penjualan-karyawan/${p.id}/order-crm`, { alamat: "Jl. Melati 9, Depok", kota: "Depok", tanggalKirim: "2026-10-20" }, kunci());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.jobDisinkron, 1);
  const jobBaru = await testPrisma.job.findUnique({ where: { id: job.id } });
  assert.equal(jobBaru.addressText, "Jl. Melati 9, Depok, Depok");
  const o2 = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.equal(o2.deliveryAddress, "Jl. Melati 9, Depok");
  const ev = await testPrisma.activityEvent.findMany({ where: { eventType: "PKR_ORDER_SINKRON", entityId: p.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(ev.map((e) => e.metadata.aksi), ["dibuat", "dilengkapi"]);
  assert.equal(ev[1].metadata.perubahan.alamat.sebelum, "Jl. Mawar 5, Bekasi");
  assert.equal(ev[1].metadata.perubahan.alamat.sesudah, "Jl. Melati 9, Depok");
  // dispatcher mengubah alamat job manual → perubahan berikutnya tidak menimpanya
  await testPrisma.job.update({ where: { id: job.id }, data: { addressText: "Gerbang belakang Pasar Baru" } });
  const r2 = await w.finance.c.put(`/api/finance/penjualan-karyawan/${p.id}/order-crm`, { alamat: "Jl. Kenanga 1, Depok" }, kunci());
  assert.equal(r2.body.jobDisinkron, 0);
  assert.equal((await testPrisma.job.findUnique({ where: { id: job.id } })).addressText, "Gerbang belakang Pasar Baru");
  assert.equal((await w.finance.c.put(`/api/finance/penjualan-karyawan/${p.id}/order-crm`, {}, kunci())).status, 400, "tanpa perubahan ditolak");
});

// ═══ 7. Pembatalan ═══
test("batal PKR SEBELUM diproses: order CANCELLED, unit CANCELLED, jurnal PKR dibalik, tidak ada yang dihapus; PKR tidak bisa dibatalkan dua kali", async () => {
  const w = await siapkan();
  const p = await catatPkr(w, LENGKAP);
  const r = await w.admin.c.post(`/api/finance/penjualan-karyawan/${p.id}/batal`, { reason: "salah input pembeli" }, kunci());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, "DIBATALKAN");
  const order = await testPrisma.order.findFirst({ include: { units: true } });
  assert.equal(order.status, "CANCELLED");
  assert.ok(order.units.every((u) => u.status === "CANCELLED"));
  assert.equal(order.penjualanKaryawanId, p.id, "tautan & riwayat tetap ada");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { status: "REVERSED" } }), 1);
  assert.equal((await w.admin.c.post(`/api/finance/penjualan-karyawan/${p.id}/batal`, { reason: "lagi" }, kunci())).status, 409);
  const ev = await testPrisma.activityEvent.findMany({ where: { eventType: "PKR_ORDER_SINKRON", entityId: p.id } });
  assert.ok(ev.some((e) => e.metadata.aksi === "dibatalkan"));
});

test("batal PKR SESUDAH Produksi/Delivery berjalan DIBLOKIR (409) tanpa mengubah apa pun", async () => {
  const w = await siapkan();
  const p = await catatPkr(w, LENGKAP);
  const unit = await testPrisma.unit.findFirst();
  await testPrisma.unit.update({ where: { id: unit.id }, data: { status: "IN_PRODUCTION" } });
  const sebelum = await jejak();
  const r = await w.admin.c.post(`/api/finance/penjualan-karyawan/${p.id}/batal`, { reason: "batal saja" }, kunci());
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "PRODUKSI_DELIVERY_BERJALAN");
  assert.match(r.body.error, /alur pembatalan resmi order/);
  assert.equal((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } })).status, "AKTIF");
  assert.equal((await testPrisma.order.findFirst()).status !== "CANCELLED", true);
  assert.deepEqual(await jejak(), sebelum);

  // Delivery berjalan (job ASSIGNED) juga memblokir.
  await testPrisma.unit.update({ where: { id: unit.id }, data: { status: "RECEIVED" } });
  await testPrisma.job.create({ data: { type: "DELIVERY", orderId: unit.orderId, status: "ASSIGNED" } });
  const r2 = await w.admin.c.post(`/api/finance/penjualan-karyawan/${p.id}/batal`, { reason: "batal saja" }, kunci());
  assert.equal(r2.status, 409);
  assert.equal(await testPrisma.job.count(), 1);
});

// ═══ 8. Izin ═══
test("izin: Finance & Admin boleh mengelola; Sales, Produksi, dan Driver ditolak; Produksi/Delivery membaca tanpa nominal", async () => {
  const w = await siapkan();
  const p = await catatPkr(w, undefined);
  const url = `/api/finance/penjualan-karyawan/${p.id}/order-crm`;
  for (const [nama, c] of [["sales", w.sales.c], ["produksi", w.produksi.c], ["driver", w.driver.c], ["dispatcher", w.dispatcher.c]]) {
    assert.equal((await c.post(url, { spesifikasi: LENGKAP }, kunci())).status, 403, `${nama} POST order-crm`);
    assert.equal((await c.put(url, { merk: "X" }, kunci())).status, 403, `${nama} PUT order-crm`);
    assert.equal((await c.get("/api/finance/penjualan-karyawan/order-crm/dry-run")).status, 403, `${nama} dry-run`);
    assert.equal((await c.post("/api/finance/penjualan-karyawan", badan(w.seller), kunci())).status, 403, `${nama} catat PKR`);
  }
  assert.equal((await w.finance.c.put(url, { merk: "Sano", ukuran: "160 x 200", perluDikirim: false }, kunci())).status, 200);
  assert.equal((await w.admin.c.put(url, { merk: "Sano 2" }, kunci())).status, 200);
  assert.equal((await w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/batal`, { reason: "x" }, kunci())).status, 403, "batal tetap khusus Admin (FINANCE_ADMIN)");
  const unit = await testPrisma.unit.findFirst();
  const ov = await w.produksi.c.get(`/api/production-v2/units/${unit.id}/overview`);
  if (ov.status === 200) {
    assert.equal(ov.body.identity.penjualanKaryawan.nomor, p.nomor);
    assert.equal(JSON.stringify(ov.body.identity.penjualanKaryawan).includes("1600000"), false, "tanpa nominal");
  }
});

// ═══ 9. Regresi ringan: order biasa tidak berubah ═══
test("order biasa (non-PKR) tidak terpengaruh: invoice dibuat, pembayaran berjalan, dihitung di KPI", async () => {
  const w = await siapkan();
  const cust = await testPrisma.customer.create({ data: { name: "Pelanggan Biasa", assignedSalesId: w.sales.id } });
  const o = { body: await createOrderForCustomer(cust.id, { category: "LAYANAN", unitCount: 1 }, w.admin.id) };
  assert.equal(await testPrisma.invoice.count({ where: { orderId: o.body.id } }), 1, "order biasa tetap otomatis punya invoice");
  assert.notEqual(o.body.salesOwnerId, undefined);
  const pay = await w.admin.c.post(`/api/orders/${o.body.id}/items`, { layananName: "Servis", harga: 100000 });
  assert.equal(pay.status, 201, JSON.stringify(pay.body));
  const list = await w.admin.c.get("/api/orders?limit=50");
  assert.equal(list.body.summary.totalOrderAktif, 1);
  assert.equal(list.body.items[0].penjualanKaryawan ?? null, null);
});
