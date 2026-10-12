// PENJUALAN KARYAWAN — ITEM PENJUALAN & PEMENUHAN TERPADU, terhadap PostgreSQL sungguhan.
// Satu daftar item (baris penjualan) = sumber kanonis: Finance (total/piutang/jurnal), Order CRM (item operasional), Produksi (unit), Delivery/Pickup (cara pemenuhan).
// Yang dikunci: (1) total dari baris yang sama, tanpa input ganda; (2) Set Kasur Lengkap = satu harga induk, tiga komponen operasional, tanpa nilai ganda; (3) cara pemenuhan wajib
// dipilih (tidak menebak) + item tanpa unit; (4) harga tak pernah keluar ke Produksi/Delivery/CRM; (5) Koreksi baris atomik (Finance + operasional, jurnal dibalik-posting ulang,
// revisi optimistis, replay/paralel); (6) setelah diproses hanya harga yang boleh berubah; (7) penjaga DB (jumlah/nama tak menyimpang); (8) data lama tetap terbaca;
// (9) satu job delivery.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { suggestDeliveryJob } from "../../src/services/deliveryHandoff.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const BASE = "/api/finance/penjualan-karyawan";
const kunci = () => ({ "Idempotency-Key": `pkrt-${randomUUID()}` });
const KATEGORI = {
  KASUR_BARU: ["Kasur Baru", "KASUR", "BARU", 10], SERVICE_UPGRADE: ["Service/Upgrade Kasur", "SERVICE", "LAYANAN", 20], DIVAN_BOX: ["Divan/Box", "DIVAN", "BARU", 30],
  SANDARAN: ["Sandaran/Headboard", "SANDARAN", "BARU", 40], SET_LENGKAP: ["Set Kasur Lengkap", "SET", "BARU", 50], CUSTOM_LAINNYA: ["Produk Custom Lainnya", "CUSTOM", "BARU", 60],
};
const RUTE = {
  KASUR_BARU: { productLine: "KASUR", productType: "KASUR_SEHAT" }, SERVICE_UPGRADE: { productLine: "KASUR", productType: null }, DIVAN_BOX: { productLine: "DIVAN", productType: "DIVAN_UTAMA" },
  SANDARAN: { productLine: "DIVAN", productType: "DIVAN_SANDARAN" }, SET_LENGKAP: { productLine: null, productType: null }, CUSTOM_LAINNYA: { productLine: "SOFA", productType: "SOFA_L" },
};

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const seller = await testPrisma.user.create({ data: { name: "Emon Uji", email: `emon-${randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const peran = async (r) => { const u = await createTestUser({ roles: [r] }); return { id: u.user.id, c: makeClient(server.baseUrl, u.token) }; };
  await testPrisma.pkrItemCategory.deleteMany({ where: { code: { notIn: Object.keys(KATEGORI) } } });
  const layanan = await testPrisma.serviceCatalog.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
  assert.ok(layanan, "katalog layanan produksi dari migrasi harus ada");
  for (const [code, [name, shape, workKind, sortOrder]] of Object.entries(KATEGORI)) {
    const peta = { ...RUTE[code], productionServiceId: code === "SERVICE_UPGRADE" ? layanan.id : null };
    await testPrisma.pkrItemCategory.upsert({ where: { code }, update: { name, shape, workKind, sortOrder, active: true, ...peta }, create: { code, name, shape, workKind, sortOrder, ...peta } });
  }
  const kat = Object.fromEntries((await testPrisma.pkrItemCategory.findMany()).map((c) => [c.code, c]));
  await testPrisma.pkrBundleComponent.deleteMany({});
  for (const [i, kode] of ["KASUR_BARU", "DIVAN_BOX", "SANDARAN"].entries()) {
    await testPrisma.pkrBundleComponent.create({ data: { bundleCategoryId: kat.SET_LENGKAP.id, componentCategoryId: kat[kode].id, qty: 1, sortOrder: (i + 1) * 10 } });
  }
  return { seller, bank, admin: await peran("ADMIN"), finance: await peran("FINANCE"), sales: await peran("SALES"), produksi: await peran("PRODUCTION_LEAD"), dispatcher: await peran("DISPATCHER") };
}

// Satu daftar item: tiap baris = penjualan + pemenuhan. Harga sengaja ANGKA UNIK supaya kebocoran harga mudah dideteksi.
const KASUR = { pemenuhan: "PRODUKSI_BARU", kategori: "KASUR_BARU", produkNama: "Kasur Sano Custom", jumlah: 1, harga: 7_654_321, panjang: 200, lebar: 160, tebal: 20, perluDikirim: true, spesifikasi: "Pegas bonnel, kain knit" };
const DIVAN = { pemenuhan: "PRODUKSI_BARU", kategori: "DIVAN_BOX", produkNama: "Divan Laci", jumlah: 1, harga: 1_234_567, panjang: 200, lebar: 160, tinggi: 30, perluDikirim: true };
const SANDARAN = { pemenuhan: "PRODUKSI_BARU", kategori: "SANDARAN", produkNama: "Sandaran Busa", jumlah: 1, harga: 876_543, lebar: 160, tinggi: 120, perluDikirim: false };
const SET = { pemenuhan: "PRODUKSI_BARU", kategori: "SET_LENGKAP", jumlah: 1, harga: 9_999_999, perluDikirim: true, komponen: [
  { panjang: 200, lebar: 160, tebal: 20, produkNama: "Kasur Set" }, { panjang: 200, lebar: 160, tinggi: 30, produkNama: "Divan Set" }, { lebar: 160, tinggi: 120, produkNama: "Sandaran Set" },
] };
const SERVICE = { pemenuhan: "SERVICE_PICKUP", kategori: "SERVICE_UPGRADE", produkNama: "Full Service", jumlah: 1, harga: 3_210_987, panjang: 190, lebar: 90, perluDikirim: true, spesifikasi: "Kempes bagian tengah" };
const STOK = { pemenuhan: "AMBIL_STOK", nama: "Bantal Sano", jumlah: 2, harga: 111_111 };
const JASA = { pemenuhan: "TANPA_OPERASIONAL", nama: "Biaya jasa pasang", jumlah: 1, harga: 55_555 };
const ALAMAT = { alamat: "Jl. Mawar 5, Bekasi", kota: "Bekasi" };
const HARGA_UNIK = [7654321, 1234567, 876543, 9999999, 3210987, 111111, 55555, "7654321", "1234567", "9999999"];

const badan = (seller, items, extra = {}) => ({ date: "2026-10-02", sellerId: seller.id, buyerName: "Bu Ani (kerabat)", items, orderCrm: { ...ALAMAT }, ...extra });
const catat = async (w, items, extra = {}) => {
  const r = await w.finance.c.post(BASE, badan(w.seller, items, extra), kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};
const orderDari = (pkrId) => testPrisma.order.findFirst({ where: { penjualanKaryawanId: pkrId } });
const unitDi = (orderId) => testPrisma.unit.findMany({ where: { orderId }, orderBy: { seq: "asc" } });
const jurnalAktif = async (pkrId) => {
  const e = await testPrisma.finJournalEntry.findMany({ where: { source: { in: ["PENJUALAN_KARYAWAN", "REVERSAL"] }, OR: [{ sourceId: pkrId }, { reversalOf: { sourceId: pkrId } }] }, include: { lines: true } });
  return e;
};
// Saldo bersih piutang karyawan dari jurnal PENJUALAN (asli + pengganti + pembalik) dokumen ini: harus sama dengan total dokumen.
async function netPiutang(pkrId) {
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PIUTANG_KARYAWAN } });
  const semua = await jurnalAktif(pkrId);
  let net = 0;
  for (const e of semua) for (const l of e.lines) if (l.accountId === akun.id) net += Number(l.debit) - Number(l.credit);
  return net;
}
const jejak = async () => ({
  payment: await testPrisma.payment.count(), invoice: await testPrisma.invoice.count(), orderItem: await testPrisma.orderItem.count(), gap: await testPrisma.finPostingGap.count(),
});

// ═══ 1. Satu daftar item -> Finance + Order + unit ═══
test("terpadu: satu daftar item -> total PKR, 1 jurnal, 1 order operasional (nilai 0), item operasional + unit dari baris yang sama; tanpa Payment/invoice/OrderItem", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, DIVAN, SANDARAN, SERVICE]);
  const total = 7_654_321 + 1_234_567 + 876_543 + 3_210_987;
  assert.equal(p.total, total);
  assert.deepEqual(p.items.map((i) => [i.pemenuhan, i.terpadu]), [["PRODUKSI_BARU", true], ["PRODUKSI_BARU", true], ["PRODUKSI_BARU", true], ["SERVICE_PICKUP", true]]);
  assert.equal(p.items[0].kategoriKode, "KASUR_BARU"); assert.equal(p.items[0].panjang, 200); assert.equal(p.items[0].perluDikirim, true); assert.equal(p.items[0].spesifikasi, "Pegas bonnel, kain knit");

  const order = await orderDari(p.id);
  assert.ok(order, "order operasional terbentuk");
  assert.equal(order.value, 0, "Order CRM tidak membawa uang");
  assert.equal(order.category, "CAMPURAN");
  const rows = await testPrisma.pkrOrderItem.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" } });
  const baris = await testPrisma.finPenjualanKaryawanItem.findMany({ where: { penjualanId: p.id }, orderBy: { sortOrder: "asc" } });
  assert.equal(rows.length, 4);
  // Tautan UNIK baris -> item operasional; jumlah & nama identik (satu sumber).
  assert.deepEqual(rows.map((r) => r.saleItemId), baris.map((b) => b.id));
  assert.deepEqual(rows.map((r) => [r.componentSeq, r.componentQty, r.qty, r.productName]), baris.map((b) => [1, 1, Number(b.quantity), b.name]));
  assert.equal((await unitDi(order.id)).length, 4);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENJUALAN_KARYAWAN" } }), 1);
  assert.equal(await netPiutang(p.id), total, "jurnal = total baris");
  assert.deepEqual(await jejak(), { payment: 0, invoice: 0, orderItem: 0, gap: 0 });
  assert.equal(await testPrisma.pkrItemRevision.count({ where: { orderId: order.id } }), 1);
});

test("input ganda ditolak: orderCrm.items bersama daftar terpadu; campuran baris lama & terpadu tidak diterima; jalur lama tetap jalan tanpa kolom kanonis", async () => {
  const w = await siapkan();
  const ganda = await w.finance.c.post(BASE, badan(w.seller, [KASUR], { orderCrm: { items: [{ kategori: "KASUR_BARU", jumlah: 1 }] } }), kunci());
  assert.equal(ganda.status, 400); assert.equal(ganda.body.code, "INPUT_GANDA");
  assert.equal(await testPrisma.finPenjualanKaryawan.count(), 0);
  const campur = await w.finance.c.post(BASE, badan(w.seller, [KASUR, { name: "Item lama", quantity: 1, unitPrice: 5000 }]), kunci());
  assert.equal(campur.status, 400, JSON.stringify(campur.body));
  assert.equal(await testPrisma.finPenjualanKaryawan.count(), 0);
  // Jalur lama (item uang saja) tidak berubah: tanpa kolom kanonis
  const lama = await w.finance.c.post(BASE, { date: "2026-10-02", sellerId: w.seller.id, buyerName: "Pak Budi", items: [{ name: "Kasur lama", quantity: 1, unitPrice: 500000 }], orderCrm: { kategori: "BARU", jumlahUnit: 1, merk: "Sano", ukuran: "160 x 200", perluDikirim: true, ...ALAMAT } }, kunci());
  assert.equal(lama.status, 201, JSON.stringify(lama.body));
  assert.equal(lama.body.items[0].terpadu, false); assert.equal(lama.body.items[0].pemenuhan, null);
  const row = await testPrisma.finPenjualanKaryawanItem.findFirst();
  assert.equal(row.fulfillment, null); assert.equal(row.categoryId, null);
  assert.equal(await testPrisma.pkrOrderItem.count(), 0, "jalur lama tidak membuat item operasional");
});

// ═══ 2. Set Kasur Lengkap ═══
test("Set Kasur Lengkap: SATU harga induk; diekspansi jadi unit Kasur + Divan + Sandaran per set tanpa menambah nilai (total = harga x jumlah set)", async () => {
  const w = await siapkan();
  const p = await catat(w, [{ ...SET, jumlah: 2 }]);
  assert.equal(p.total, 2 * 9_999_999, "nilai Set tidak digandakan per komponen");
  assert.equal(p.items.length, 1, "satu baris penjualan");
  assert.equal(p.items[0].kategoriKode, "SET_LENGKAP"); assert.equal(p.items[0].quantity, 2);
  const order = await orderDari(p.id);
  const rows = await testPrisma.pkrOrderItem.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" } });
  assert.deepEqual(rows.map((r) => [r.categoryCode, r.qty, r.componentSeq, r.componentQty, r.saleItemId === p.items[0].id]), [["KASUR_BARU", 2, 1, 1, true], ["DIVAN_BOX", 2, 2, 1, true], ["SANDARAN", 2, 3, 1, true]]);
  assert.equal((await unitDi(order.id)).length, 6, "2 set x 3 komponen");
  assert.equal(order.value, 0);
  assert.equal(await netPiutang(p.id), 2 * 9_999_999);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENJUALAN_KARYAWAN" } }), 1);
  assert.equal((await jejak()).orderItem, 0);
  // Tautan unik per komponen: baris yang sama tidak bisa punya dua komponen bernomor sama
  await assert.rejects(() => testPrisma.pkrOrderItem.create({ data: { penjualanId: p.id, orderId: order.id, seq: 99, categoryId: rows[0].categoryId, categoryCode: "KASUR_BARU", categoryName: "Kasur Baru", shape: "KASUR", workKind: "BARU", qty: 2, saleItemId: p.items[0].id, componentSeq: 1, componentQty: 1, fulfillment: "PRODUKSI_BARU", productName: "x" } }), /Unique|unique/);
});

// ═══ 3. Cara pemenuhan ═══
test("pemenuhan wajib & tidak menebak; kategori harus cocok; stok/tanpa operasional tidak melahirkan unit; hanya tanpa operasional = tanpa order", async () => {
  const w = await siapkan();
  const post = (items) => w.finance.c.post(BASE, badan(w.seller, items), kunci());
  const tanpa = await post([{ ...KASUR, pemenuhan: undefined }, DIVAN]);
  assert.equal(tanpa.status, 400); assert.equal(tanpa.body.code, "PEMENUHAN_WAJIB");
  const salah = await post([{ ...KASUR, pemenuhan: "SERVICE_PICKUP" }]);
  assert.equal(salah.status, 400); assert.equal(salah.body.code, "PEMENUHAN_TIDAK_SESUAI"); assert.match(salah.body.error, /Produksi Baru/);
  const salah2 = await post([{ ...SERVICE, pemenuhan: "PRODUKSI_BARU" }]);
  assert.equal(salah2.body.code, "PEMENUHAN_TIDAK_SESUAI");
  const nol = await post([{ ...KASUR, pemenuhan: "BEBAS" }]);
  assert.equal(nol.body.code, "PEMENUHAN_WAJIB");
  const kirimStok = await post([{ ...STOK, perluDikirim: true }]);
  assert.equal(kirimStok.status, 400); assert.equal(kirimStok.body.code, "KIRIM_TANPA_UNIT");
  const tanpaKategori = await post([{ ...KASUR, kategori: undefined }]);
  assert.equal(tanpaKategori.body.code, "KATEGORI_WAJIB");
  const pecahan = await post([{ ...KASUR, jumlah: "1.5" }]);
  assert.equal(pecahan.status, 400);
  assert.equal(await testPrisma.finPenjualanKaryawan.count(), 0, "semua penolakan tidak menulis apa pun");

  // Hanya item tanpa unit: PKR + jurnal, TANPA Order CRM
  const hanyaJasa = await catat(w, [STOK, JASA]);
  assert.equal(hanyaJasa.total, 2 * 111_111 + 55_555);
  assert.equal(await orderDari(hanyaJasa.id), null, "tidak ada pekerjaan Produksi/Pickup -> tidak ada order");
  assert.equal(await testPrisma.unit.count(), 0);
  assert.deepEqual(hanyaJasa.items.map((i) => [i.pemenuhan, i.kategoriKode]), [["AMBIL_STOK", null], ["TANPA_OPERASIONAL", null]]);

  // Campuran produksi + stok: order hanya untuk produksi; stok tampil di catatan order TANPA harga
  const campur = await catat(w, [KASUR, STOK], { buyerName: "Bu Dewi" });
  const order = await orderDari(campur.id);
  assert.equal((await unitDi(order.id)).length, 1);
  const info = JSON.parse(order.notes);
  assert.deepEqual(info.pkrNonProduksi, [{ no: 2, nama: "Bantal Sano", jumlah: 2, pemenuhan: "AMBIL_STOK", kategori: null }]);
  assert.ok(!JSON.stringify(info).includes("111111") && !JSON.stringify(info).includes("7654321"));
});

// ═══ 4. Izin harga ═══
test("harga hanya untuk Finance/Admin: peran lain 403 di endpoint Finance; Produksi/Delivery/CRM tidak pernah menerima harga atau total", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, DIVAN, SANDARAN, STOK]);
  const order = await orderDari(p.id);
  const unit = (await unitDi(order.id))[0];
  for (const peran of [w.sales, w.produksi, w.dispatcher]) {
    assert.equal((await peran.c.get(`${BASE}/${p.id}`)).status, 403);
    assert.equal((await peran.c.get(BASE)).status, 403);
    assert.equal((await peran.c.post(`${BASE}/order-crm/pratinjau`, { items: [KASUR] }, kunci())).status, 403);
    assert.equal((await peran.c.post(`${BASE}/${p.id}/koreksi-baris/pratinjau`, { operasi: [{ op: "ubah", no: 1, harga: 1 }] }, kunci())).status, 403);
  }
  assert.equal((await w.finance.c.get(`${BASE}/${p.id}`)).status, 200);
  // Endpoint operasional: respons tidak boleh memuat angka harga/total/subtotal sama sekali.
  const operasional = [
    [w.produksi, `/api/units/${unit.id}`], [w.produksi, `/api/production/board`], [w.produksi, `/api/production/work-orders`], [w.dispatcher, `/api/armada/pkr-pengiriman`],
    [w.dispatcher, `/api/armada/pkr-pengiriman/${order.id}`], [w.admin, `/api/orders/${order.id}`],
  ];
  const total = p.total;
  for (const [peran, url] of operasional) {
    const r = await peran.c.get(url);
    const teks = JSON.stringify(r.body);
    assert.ok(r.status === 200 || r.status === 404 || r.status === 403, `${url} -> ${r.status}`);
    for (const h of [...HARGA_UNIK, total, String(total)]) assert.ok(!teks.includes(String(h)), `${url} membocorkan angka ${h}`);
    assert.ok(!/unitPrice|subtotal|"harga"/.test(teks), `${url} memuat kolom harga`);
  }
  // Item operasional hanya membawa fakta operasional (tidak ada kolom harga sama sekali di tabelnya)
  const row = await testPrisma.pkrOrderItem.findFirst();
  assert.ok(!Object.keys(row).some((k) => /price|harga|subtotal|amount/i.test(k)));
  assert.ok(!JSON.stringify(order).includes("7654321"));
  // Ledger revisi: angka uang hanya di kolom finance_*, tidak di impact/before/after operasional
  await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 1, harga: 8_000_001 }], expectedRevision: 1, alasan: "Naik harga bahan" }, kunci());
  const rev = await testPrisma.pkrItemRevision.findFirst({ where: { orderId: order.id, revision: 2 } });
  assert.ok(rev.financeAfter && rev.financeBefore);
  for (const bagian of [rev.impact, rev.beforeItems, rev.afterItems]) for (const h of [...HARGA_UNIK, 8000001]) assert.ok(!JSON.stringify(bagian).includes(String(h)), "ledger operasional tidak memuat harga");
});

// ═══ 5. Koreksi baris atomik ═══
test("koreksi baris: ubah jumlah + harga -> total, jurnal (dibalik + diposting ulang), item operasional, unit berubah SATU transaksi; pratinjau tidak menulis; audit finance_before/after", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, DIVAN]);
  const order = await orderDari(p.id);
  const sebelum = { total: p.total, unit: (await unitDi(order.id)).length, jurnal: await testPrisma.finJournalEntry.count() };
  const operasi = [{ op: "ubah", no: 1, jumlah: 3, harga: 7_000_000 }, { op: "ubah", no: 2, perluDikirim: false }];

  const pra = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris/pratinjau`, { operasi, expectedRevision: 1 }, kunci());
  assert.equal(pra.status, 200); assert.equal(pra.body.valid, true, JSON.stringify(pra.body));
  assert.equal(pra.body.dampak.keuangan.totalSebelum, p.total);
  assert.equal(pra.body.dampak.keuangan.totalSesudah, 3 * 7_000_000 + 1_234_567);
  assert.equal(pra.body.dampak.keuangan.jurnalBerubah, true);
  assert.equal(pra.body.dampak.unit.dibuat, 2);
  assert.equal((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } })).total.toString(), String(sebelum.total), "pratinjau tidak menulis");
  assert.equal((await unitDi(order.id)).length, sebelum.unit);
  assert.equal(await testPrisma.finJournalEntry.count(), sebelum.jurnal);

  const r = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi, expectedRevision: 1, alasan: "Pembeli minta 3 kasur, harga disesuaikan" }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const totalBaru = 3 * 7_000_000 + 1_234_567;
  assert.equal(r.body.penjualan.total, totalBaru);
  assert.equal(r.body.revisi, 2);
  const kasur = await testPrisma.pkrOrderItem.findFirst({ where: { orderId: order.id, seq: 1 } });
  const baris = await testPrisma.finPenjualanKaryawanItem.findMany({ where: { penjualanId: p.id }, orderBy: { sortOrder: "asc" } });
  assert.equal(kasur.qty, 3); assert.equal(Number(baris[0].quantity), 3); assert.equal(Number(baris[0].unitPrice), 7_000_000);
  assert.equal((await unitDi(order.id)).filter((u) => u.status !== "CANCELLED").length, 4, "3 kasur + 1 divan");
  assert.equal((await testPrisma.pkrOrderItem.findFirst({ where: { orderId: order.id, seq: 2 } })).perluDikirim, false);
  assert.equal(baris[1].perluDikirim, false, "kirim/ambil ikut baris penjualan");
  // Jurnal: asli dibalik, pengganti diposting; net piutang = total baru; tepat satu jurnal penjualan POSTED
  assert.equal(await netPiutang(p.id), totalBaru);
  const asli = await testPrisma.finJournalEntry.findMany({ where: { source: "PENJUALAN_KARYAWAN", sourceId: p.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(asli.map((e) => e.status), ["REVERSED", "POSTED"]);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL", reversalOfId: asli[0].id } }), 1);
  assert.equal(order.value, 0); assert.deepEqual(await jejak(), { payment: 0, invoice: 0, orderItem: 0, gap: 0 });
  const rev = await testPrisma.pkrItemRevision.findFirst({ where: { orderId: order.id, revision: 2 } });
  assert.equal(rev.kind, "DIKOREKSI"); assert.equal(rev.financeBefore.total, p.total); assert.equal(rev.financeAfter.total, totalBaru);
  assert.equal(rev.financeAfter.baris[0].jumlah, 3);
});

test("koreksi baris: tambah baris (Finance + item + unit) dan hapus baris (item dihapus lunak, baris Finance dihapus, jurnal ikut)", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, DIVAN, STOK]);
  const order = await orderDari(p.id);
  const r1 = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "tambah", item: SANDARAN }, { op: "ubah", no: 3, jumlah: 4 }], expectedRevision: 1, alasan: "Tambah sandaran, stok jadi 4" }, kunci());
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  const total1 = 7_654_321 + 1_234_567 + 4 * 111_111 + 876_543;
  assert.equal(r1.body.penjualan.total, total1);
  const rows = await testPrisma.pkrOrderItem.findMany({ where: { orderId: order.id, removedAt: null }, orderBy: { seq: "asc" } });
  assert.deepEqual(rows.map((r) => r.categoryCode), ["KASUR_BARU", "DIVAN_BOX", "SANDARAN"]);
  const baris = await testPrisma.finPenjualanKaryawanItem.findMany({ where: { penjualanId: p.id }, orderBy: { sortOrder: "asc" } });
  assert.deepEqual(rows.map((r) => r.saleItemId), [baris[0].id, baris[1].id, baris[3].id]);
  assert.equal(await netPiutang(p.id), total1);

  const r2 = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "hapus", no: 2 }, { op: "hapus", no: 3 }], expectedRevision: 2, alasan: "Divan dan bantal dibatalkan" }, kunci());
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal(r2.body.penjualan.total, 7_654_321 + 876_543);
  assert.equal((await testPrisma.finPenjualanKaryawanItem.count({ where: { penjualanId: p.id } })), 2);
  const divan = await testPrisma.pkrOrderItem.findFirst({ where: { orderId: order.id, categoryCode: "DIVAN_BOX" } });
  assert.ok(divan.removedAt, "item operasional dihapus lunak (riwayat tetap)"); assert.equal(divan.saleItemId, null, "tautan dilepas karena baris penjualan dihapus");
  assert.equal((await unitDi(order.id)).filter((u) => u.status !== "CANCELLED").length, 2);
  assert.equal(await netPiutang(p.id), 7_654_321 + 876_543);
  assert.equal(await testPrisma.pkrItemRevision.count({ where: { orderId: order.id } }), 3);
});

test("koreksi baris ATOMIK: salah satu bagian gagal -> tidak ada yang berubah (total, jurnal, item, unit, revisi)", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, DIVAN]);
  const order = await orderDari(p.id);
  const snap = async () => ({
    total: String((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } })).total), baris: JSON.stringify((await testPrisma.finPenjualanKaryawanItem.findMany({ where: { penjualanId: p.id }, orderBy: { sortOrder: "asc" } })).map((b) => [b.name, String(b.quantity), String(b.unitPrice)])),
    item: JSON.stringify((await testPrisma.pkrOrderItem.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" } })).map((r) => [r.qty, r.productName])),
    unit: (await unitDi(order.id)).length, jurnal: await testPrisma.finJournalEntry.count(), revisi: await testPrisma.pkrItemRevision.count({ where: { orderId: order.id } }),
  });
  const awal = await snap();
  // (a) harga baru valid + operasi item tidak ada -> 404, tidak ada efek
  const a = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 1, harga: 9_000_000 }, { op: "ubah", no: 9, jumlah: 2 }], expectedRevision: 1, alasan: "Uji atomik bagian A" }, kunci());
  assert.equal(a.status, 404);
  // (b) harga valid + jumlah menembus batas unit -> gagal di bagian operasional SESUDAH Finance berubah di memori transaksi
  const b = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 1, harga: 9_000_000, jumlah: 25 }], expectedRevision: 1, alasan: "Uji atomik bagian B" }, kunci());
  assert.ok(b.status >= 400, JSON.stringify(b.body));
  // (c) pembayaran aktif melebihi total baru
  const bayar = await w.finance.c.post(`${BASE}/${p.id}/pembayaran`, { method: "TRANSFER", amount: 5_000_000, date: "2026-10-03", cashAccountId: w.bank.id }, kunci());
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  const awal2 = await snap();
  const c = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 1, harga: 1_000_000 }, { op: "ubah", no: 2, harga: 1_000_000 }], expectedRevision: 1, alasan: "Turunkan harga di bawah pembayaran" }, kunci());
  assert.equal(c.status, 409); assert.equal(c.body.code, "TOTAL_DI_BAWAH_PEMBAYARAN");
  assert.deepEqual(await snap(), awal2);
  assert.equal(awal2.total, awal.total); assert.equal(awal2.unit, awal.unit);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 0, "tidak ada jurnal balik");
});

test("koreksi baris: revisi optimistis, Idempotency-Key wajib, alasan wajib; replay sama = hasil sama; kunci sama isi beda = 409; paralel kunci sama = tepat satu", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, DIVAN]);
  const order = await orderDari(p.id);
  const op = [{ op: "ubah", no: 2, harga: 1_500_000 }];
  assert.equal((await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: op, expectedRevision: 1, alasan: "Tanpa kunci idempotensi" })).status, 428);
  assert.equal((await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: op, expectedRevision: 1, alasan: "x" }, kunci())).body.code, "ALASAN_WAJIB");
  assert.equal((await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: op, alasan: "Tanpa revisi dikirim" }, kunci())).body.code, "REVISI_WAJIB");
  const k = kunci();
  const a = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: op, expectedRevision: 1, alasan: "Harga divan naik" }, k);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  // Middleware idempotensi global memutar ulang respons pertama (kunci sama + isi sama) tanpa mengeksekusi lagi; isi beda dengan kunci sama = 422.
  const ulang = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: op, expectedRevision: 1, alasan: "Harga divan naik" }, k);
  assert.ok([200, 201].includes(ulang.status)); assert.equal(ulang.body.revisi, a.body.revisi);
  const beda = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 2, harga: 1_600_000 }], expectedRevision: 1, alasan: "Harga divan naik" }, k);
  assert.equal(beda.status, 422);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 1, "replay tidak membalik jurnal lagi");
  // revisi basi
  const basi = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 2, harga: 1_700_000 }], expectedRevision: 1, alasan: "Revisi sudah berubah" }, kunci());
  assert.equal(basi.status, 409); assert.equal(basi.body.code, "REVISI_BERUBAH");
  // paralel dengan revisi yang sama = tepat satu menang
  const [x, y] = await Promise.all([1_710_000, 1_720_000].map((h) => w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 2, harga: h }], expectedRevision: 2, alasan: "Paralel dua penulis" }, kunci())));
  assert.deepEqual([x.status, y.status].sort(), [201, 409], JSON.stringify([x.body, y.body]));
  assert.equal(await testPrisma.pkrItemRevision.count({ where: { orderId: order.id } }), 3);
  const aktif = await testPrisma.finJournalEntry.count({ where: { source: "PENJUALAN_KARYAWAN", sourceId: p.id, status: "POSTED" } });
  assert.equal(aktif, 1, "tepat satu jurnal penjualan berlaku");
  const terbaru = await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } });
  assert.equal(await netPiutang(p.id), Number(terbaru.total));
});

// ═══ 6. Setelah diproses ═══
test("setelah Produksi berjalan: HARGA tetap boleh dikoreksi (administratif); jumlah/produk/ukuran/spesifikasi/dikirim DIBLOKIR dengan arahan pembatalan resmi", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, DIVAN]);
  const order = await orderDari(p.id);
  const unit = await unitDi(order.id);
  await testPrisma.unit.update({ where: { id: unit[0].id }, data: { status: "IN_PRODUCTION" } }); // kasur sedang dikerjakan
  const blok = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 1, jumlah: 2 }], expectedRevision: 1, alasan: "Coba ubah jumlah saat produksi" }, kunci());
  assert.equal(blok.status, 409); assert.equal(blok.body.code, "ITEM_TERKUNCI"); assert.match(blok.body.petunjuk ?? blok.body.error, /pembatalan/i);
  const blokSpek = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 1, panjang: 210 }], expectedRevision: 1, alasan: "Coba ubah ukuran saat produksi" }, kunci());
  assert.equal(blokSpek.body.code, "ITEM_TERKUNCI");
  const blokHapus = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "hapus", no: 1 }], expectedRevision: 1, alasan: "Coba hapus saat produksi" }, kunci());
  assert.equal(blokHapus.body.code, "ITEM_TERKUNCI");
  assert.equal(Number((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } })).total), p.total);
  // Harga saja: boleh, menyentuh Finance saja (item operasional & unit tak berubah)
  const rowsSebelum = JSON.stringify(await testPrisma.pkrOrderItem.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" }, select: { qty: true, productName: true, lengthCm: true, perluDikirim: true } }));
  const harga = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 1, harga: 7_000_000 }], expectedRevision: 1, alasan: "Penyesuaian harga administratif" }, kunci());
  assert.equal(harga.status, 201, JSON.stringify(harga.body));
  assert.equal(harga.body.penjualan.total, 7_000_000 + 1_234_567);
  assert.equal(JSON.stringify(await testPrisma.pkrOrderItem.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" }, select: { qty: true, productName: true, lengthCm: true, perluDikirim: true } })), rowsSebelum);
  assert.equal((await testPrisma.unit.findUnique({ where: { id: unit[0].id } })).status, "IN_PRODUCTION");
  assert.equal(await netPiutang(p.id), 7_000_000 + 1_234_567);
  // Jalur lama koreksi item untuk order terpadu ditolak (tidak boleh menyimpangkan jumlah dari baris penjualan)
  const lama = await w.finance.c.post(`${BASE}/${p.id}/koreksi-item`, { operasi: [{ op: "ubah", no: 2, jumlah: 2 }], expectedRevision: 2, alasan: "Lewat jalur lama yang salah" }, kunci());
  assert.equal(lama.status, 409); assert.equal(lama.body.code, "KOREKSI_PAKAI_BARIS");
});

test("pembatalan PKR setelah koreksi nilai membalik jurnal pengganti (net piutang 0); item operasional ikut dibatalkan", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, DIVAN]);
  const order = await orderDari(p.id);
  await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 1, harga: 6_000_000 }], expectedRevision: 1, alasan: "Diskon untuk kerabat" }, kunci());
  const batal = await w.admin.c.post(`${BASE}/${p.id}/batal`, { reason: "Pembeli membatalkan pesanan" }, kunci());
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  assert.equal(await netPiutang(p.id), 0, "jurnal pengganti dibalik, tidak ada sisa piutang");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENJUALAN_KARYAWAN", sourceId: p.id, status: "POSTED" } }), 0);
  assert.equal((await unitDi(order.id)).every((u) => u.status === "CANCELLED"), true);
});

// ═══ 7. Penjaga basis data ═══
test("penjaga DB: jumlah/nama tidak boleh menyimpang antara baris penjualan dan item operasional; baris yang masih dipakai tidak bisa dihapus", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, DIVAN]);
  const order = await orderDari(p.id);
  const baris = await testPrisma.finPenjualanKaryawanItem.findMany({ where: { penjualanId: p.id }, orderBy: { sortOrder: "asc" } });
  // jumlah baris berubah tanpa item operasional -> COMMIT gagal
  await assert.rejects(() => testPrisma.finPenjualanKaryawanItem.update({ where: { id: baris[0].id }, data: { quantity: 5 } }), /PKR_TAUTAN_JUMLAH/);
  // nama baris berubah tanpa item operasional -> gagal
  await assert.rejects(() => testPrisma.finPenjualanKaryawanItem.update({ where: { id: baris[0].id }, data: { name: "Nama lain" } }), /PKR_TAUTAN_NAMA/);
  // item operasional diubah sendiri -> gagal
  await assert.rejects(() => testPrisma.pkrOrderItem.updateMany({ where: { orderId: order.id, seq: 1 }, data: { qty: 2 } }), /PKR_TAUTAN_JUMLAH/);
  await assert.rejects(() => testPrisma.pkrOrderItem.updateMany({ where: { orderId: order.id, seq: 1 }, data: { productName: "Lain" } }), /PKR_TAUTAN_NAMA/);
  // hapus baris yang masih punya item operasional aktif -> ditolak
  await assert.rejects(() => testPrisma.finPenjualanKaryawanItem.delete({ where: { id: baris[0].id } }), /PKR_ITEM_MASIH_DIPAKAI/);
  // perubahan konsisten dalam satu transaksi -> lolos
  await testPrisma.$transaction(async (tx) => {
    await tx.finPenjualanKaryawanItem.update({ where: { id: baris[1].id }, data: { quantity: 2 } });
    await tx.pkrOrderItem.updateMany({ where: { orderId: order.id, seq: 2 }, data: { qty: 2 } });
  });
  assert.equal((await testPrisma.pkrOrderItem.findFirst({ where: { orderId: order.id, seq: 2 } })).qty, 2);
  // baris lama (tanpa pemenuhan) tidak boleh membawa kolom operasional
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`UPDATE fin_penjualan_karyawan_items SET fulfillment = NULL WHERE id = '${baris[0].id}'`), /fin_pkr_items_lama_polos_chk/);
});

// ═══ 8. Data lama ═══
test("data lama tetap terbaca: PKR dengan baris lama + order lama (tanpa item) terbaca, kirim jalur lama, koreksi baris ditolak dengan arahan; tabel baru kosong", async () => {
  const w = await siapkan();
  const lama = await w.finance.c.post(BASE, { date: "2026-10-02", sellerId: w.seller.id, buyerName: "Pak Budi", items: [{ name: "Kasur lama", quantity: 1, unitPrice: 500000 }, { name: "Ongkir", quantity: 1, unitPrice: 50000 }], orderCrm: { kategori: "BARU", jumlahUnit: 2, merk: "Sano", ukuran: "160 x 200", perluDikirim: true, ...ALAMAT } }, kunci());
  assert.equal(lama.status, 201, JSON.stringify(lama.body));
  const order = await orderDari(lama.body.id);
  assert.equal(await testPrisma.pkrOrderItem.count(), 0);
  const baca = await w.finance.c.get(`${BASE}/${lama.body.id}`);
  assert.equal(baca.status, 200); assert.equal(baca.body.total, 550000);
  assert.deepEqual(baca.body.items.map((i) => [i.terpadu, i.pemenuhan, i.kategoriKode]), [[false, null, null], [false, null, null]]);
  assert.equal(baca.body.sinkron.items[0].virtual, true);
  const daftar = await w.finance.c.get(BASE);
  assert.equal(daftar.status, 200);
  // delivery lama: dua unit siap -> satu job (jalur PKR lama tidak berubah)
  const unit = await unitDi(order.id);
  await testPrisma.unit.updateMany({ where: { orderId: order.id }, data: { status: "READY_FOR_DELIVERY" } });
  for (const u of unit) await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id, type: "DELIVERY" } }), 1);
  const k = await w.finance.c.post(`${BASE}/${lama.body.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 1, harga: 600000 }], expectedRevision: 1, alasan: "Coba koreksi PKR lama" }, kunci());
  assert.ok(k.status >= 400 && k.status < 500, JSON.stringify(k.body)); // PKR lama: tidak ada daftar item terpadu
  assert.equal(Number((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: lama.body.id } })).total), 550000);
  assert.equal(await testPrisma.pkrItemRevision.count(), 0);
  // PKR lama murni tanpa order juga terbaca
  const polos = await testPrisma.finPenjualanKaryawan.create({ data: { nomor: "PKR-01102026-009", date: new Date("2026-10-01"), sellerId: w.seller.id, buyerName: "Pak Anto", total: 100000, items: { create: [{ name: "Paket", quantity: 1, unitPrice: 100000 }] } } });
  assert.equal((await w.finance.c.get(`${BASE}/${polos.id}`)).status, 200);
});

// ═══ 9. Replay / paralel pembuatan ═══
test("pembuatan: Idempotency-Key sama = SATU PKR/order/baris/unit/jurnal; paralel kunci sama = satu; isi beda dengan kunci sama ditolak", async () => {
  const w = await siapkan();
  const k = kunci();
  const body = badan(w.seller, [KASUR, DIVAN]);
  const [a, b] = await Promise.all([w.finance.c.post(BASE, body, k), w.finance.c.post(BASE, body, k)]);
  assert.ok([a.status, b.status].every((s) => [200, 201, 409].includes(s)), JSON.stringify([a.body, b.body]));
  assert.ok([a.status, b.status].includes(201));
  const c = await w.finance.c.post(BASE, body, k);
  assert.ok([200, 201].includes(c.status), JSON.stringify(c.body));
  assert.equal(await testPrisma.finPenjualanKaryawan.count(), 1);
  assert.equal(await testPrisma.finPenjualanKaryawanItem.count(), 2);
  assert.equal(await testPrisma.pkrOrderItem.count(), 2);
  assert.equal(await testPrisma.unit.count(), 2);
  assert.equal(await testPrisma.order.count({ where: { penjualanKaryawanId: { not: null } } }), 1);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENJUALAN_KARYAWAN" } }), 1);
  const beda = await w.finance.c.post(BASE, badan(w.seller, [KASUR]), k);
  assert.equal(beda.status, 422);
  assert.equal(await testPrisma.finPenjualanKaryawan.count(), 1);
});

// ═══ 10. Lengkapi spesifikasi menjaga satu sumber ═══
test("Lengkapi spesifikasi order mencerminkan ukuran/spesifikasi/nama/kirim ke baris penjualan (non-Set); komponen Set menyimpan spesifikasi per komponen", async () => {
  const w = await siapkan();
  const p = await catat(w, [{ ...DIVAN, tinggi: undefined, perluDikirim: undefined }, SET]);
  const order = await orderDari(p.id);
  const l = await w.finance.c.put(`${BASE}/${p.id}/order-crm`, { items: [{ no: 1, tinggi: 35, perluDikirim: true, spesifikasi: "Warna abu", produkNama: "Divan Laci Premium" }] }, kunci());
  assert.equal(l.status, 200, JSON.stringify(l.body));
  const baris = await testPrisma.finPenjualanKaryawanItem.findMany({ where: { penjualanId: p.id }, orderBy: { sortOrder: "asc" } });
  assert.equal(baris[0].name, "Divan Laci Premium"); assert.equal(Number(baris[0].heightCm), 35); assert.equal(baris[0].perluDikirim, true); assert.equal(baris[0].specNotes, "Warna abu");
  const row = await testPrisma.pkrOrderItem.findFirst({ where: { orderId: order.id, seq: 1 } });
  assert.equal(row.productName, "Divan Laci Premium");
  // Total tidak berubah oleh lengkapi (uang bukan urusan jalur ini)
  assert.equal(Number((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } })).total), p.total);
  // Set: ubah spesifikasi komponen kasur (seq 2) -> baris Set tidak berubah
  const sebelumSet = JSON.stringify(baris[1]);
  const s = await w.finance.c.put(`${BASE}/${p.id}/order-crm`, { items: [{ no: 2, spesifikasi: "Kain premium" }] }, kunci());
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(JSON.stringify((await testPrisma.finPenjualanKaryawanItem.findMany({ where: { penjualanId: p.id }, orderBy: { sortOrder: "asc" } }))[1]), sebelumSet);
});

// ═══ 11. Delivery: satu job ═══
test("delivery mengikuti pemenuhan: unit yang dikirim -> SATU job gabungan setelah semua siap; diambil sendiri, stok, dan tanpa operasional tidak ikut; tidak ada job ganda", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR, DIVAN, SANDARAN, STOK, JASA]);
  const order = await orderDari(p.id);
  const unit = await unitDi(order.id);
  assert.equal(unit.length, 3, "stok & jasa tidak punya unit");
  const jobKirim = () => testPrisma.job.findMany({ where: { orderId: order.id, type: "DELIVERY" }, include: { units: true } });
  await testPrisma.unit.update({ where: { id: unit[0].id }, data: { status: "READY_FOR_DELIVERY" } });
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, unit[0].id));
  assert.equal((await jobKirim()).length, 0, "menunggu unit yang dikirim lainnya");
  await testPrisma.unit.updateMany({ where: { orderId: order.id }, data: { status: "READY_FOR_DELIVERY" } });
  await Promise.all(unit.map((u) => testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id)).catch(() => null)));
  for (const u of unit) await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
  const jobs = await jobKirim();
  assert.equal(jobs.length, 1, "tepat satu job");
  assert.deepEqual(jobs[0].units.map((x) => x.unitId).sort(), [unit[0].id, unit[1].id].sort(), "kasur + divan (dikirim); sandaran diambil sendiri");
  assert.equal(jobs[0].addressText, "Jl. Mawar 5, Bekasi, Bekasi");
  // Service/Pickup: pickup job dibuat untuk unit service, bukan job pengiriman
  const s = await catat(w, [SERVICE], { buyerName: "Bu Rina" });
  const os = await orderDari(s.id);
  assert.equal(await testPrisma.job.count({ where: { orderId: os.id, type: "PICKUP" } }), 1, "Service/Pickup membuat job pickup");
  assert.equal(await testPrisma.job.count({ where: { orderId: os.id, type: "DELIVERY" } }), 0);
});

// ═══ 12. Pratinjau ═══
test("pratinjau terpadu: total + dampak operasional tanpa menulis; masukan salah = valid:false (bukan 500); tanpa pekerjaan Produksi = tanpa order", async () => {
  const w = await siapkan();
  const hitungSemua = async () => ({ pkr: await testPrisma.finPenjualanKaryawan.count(), order: await testPrisma.order.count(), unit: await testPrisma.unit.count(), item: await testPrisma.pkrOrderItem.count(), baris: await testPrisma.finPenjualanKaryawanItem.count() });
  const awal = await hitungSemua();
  const r = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { items: [KASUR, SET, STOK], orderCrm: { ...ALAMAT } }, kunci());
  assert.equal(r.status, 200); assert.equal(r.body.valid, true, JSON.stringify(r.body));
  assert.equal(r.body.keuangan.total, 7_654_321 + 9_999_999 + 2 * 111_111);
  assert.equal(r.body.keuangan.nilaiOrderCrm, 0);
  assert.equal(r.body.order.jumlahUnit, 4, "kasur 1 + set (3 komponen)");
  assert.equal(r.body.nonProduksi.length, 1);
  assert.deepEqual(await hitungSemua(), awal, "pratinjau tidak menulis");
  const buruk = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { items: [{ ...KASUR, pemenuhan: undefined, kategori: "KASUR_BARU" }] }, kunci());
  assert.equal(buruk.status, 200); assert.equal(buruk.body.valid, false); assert.equal(buruk.body.galat.kode, "PEMENUHAN_WAJIB");
  const jasa = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { items: [JASA] }, kunci());
  assert.equal(jasa.body.valid, true); assert.equal(jasa.body.adaOrder, false); assert.match(jasa.body.tanpaOrder, /tidak dibuat/i);
});

// ═══ 13. Replay di lapis layanan (tanpa middleware HTTP) ═══
test("koreksi baris (lapis layanan): kunci sama + isi sama = replayed tanpa efek ganda; HARGA beda dengan kunci sama = 409 (bukan replay palsu)", async () => {
  const { terapkanKoreksiBaris } = await import("../../src/services/penjualanKaryawanKoreksiBaris.js");
  const w = await siapkan();
  const p = await catat(w, [KASUR, DIVAN]);
  const arg = { penjualanId: p.id, operasi: [{ op: "ubah", no: 2, harga: 1_500_000 }], expectedRevision: 1, alasan: "Harga divan naik", idempotencyKey: `svc-${randomUUID()}`, userId: w.finance.id };
  const a = await testPrisma.$transaction((tx) => terapkanKoreksiBaris(tx, arg));
  assert.equal(a.replayed, false);
  const b = await testPrisma.$transaction((tx) => terapkanKoreksiBaris(tx, arg));
  assert.equal(b.replayed, true); assert.equal(b.revisi, a.revisi);
  await assert.rejects(() => testPrisma.$transaction((tx) => terapkanKoreksiBaris(tx, { ...arg, operasi: [{ op: "ubah", no: 2, harga: 1_600_000 }] })), (e) => e.code === "IDEMPOTENCY_KEY_DIPAKAI");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 1, "jurnal tidak dibalik dua kali");
  assert.equal(Number((await testPrisma.finPenjualanKaryawanItem.findFirst({ where: { penjualanId: p.id, sortOrder: 1 } })).unitPrice), 1_500_000);
  assert.equal(await testPrisma.pkrItemRevision.count(), 2);
});
