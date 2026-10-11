// PENJUALAN KARYAWAN — ORDER MULTI-ITEM (kasur + divan + sandaran, dst), terhadap PostgreSQL sungguhan.
// Yang dikunci: (1) satu PKR -> satu Order -> banyak item -> unit per item; tanpa Payment/invoice/OrderItem/jurnal tambahan; (2) pratinjau = hasil pembuatan dan tidak menulis;
// (3) validasi (duplikat, custom tanpa spesifikasi, kategori/produk tidak sah, batas unit, isian lama dicampur, kategori nonaktif); (4) campuran Service + produk baru;
// (5) Delivery: item dikirim bergabung ke SATU job, item diambil sendiri tidak; (6) order LAMA tetap terbaca (item virtual) dan jalur lama tetap bekerja;
// (7) idempotensi + paralel + replay berbeda; (8) lengkapi per item: struktur terkunci, Produksi sudah mulai terkunci; (9) katalog Admin: izin, audit, nonaktif, layanan produksi;
// (10) pembatalan PKR membatalkan semua unit item; (11) edit catatan dari CRM tidak merusak cerminan item.
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

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const BASE = "/api/finance/penjualan-karyawan";
const kunci = () => ({ "Idempotency-Key": `pkri-${randomUUID()}` });
const KATEGORI = {
  KASUR_BARU: ["Kasur Baru", "KASUR", "BARU", 10], SERVICE_UPGRADE: ["Service/Upgrade Kasur", "SERVICE", "LAYANAN", 20], DIVAN_BOX: ["Divan/Box", "DIVAN", "BARU", 30],
  SANDARAN: ["Sandaran/Headboard", "SANDARAN", "BARU", 40], SET_LENGKAP: ["Set Kasur Lengkap", "SET", "BARU", 50], CUSTOM_LAINNYA: ["Produk Custom Lainnya", "CUSTOM", "BARU", 60],
};

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const seller = await testPrisma.user.create({ data: { name: "Emon Uji", email: `emon-${randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const peran = async (r) => { const u = await createTestUser({ roles: [r] }); return { id: u.user.id, c: makeClient(server.baseUrl, u.token) }; };
  // Katalog awal berasal dari migrasi; dijaga ada (idempoten) bila database uji lain pernah mengosongkannya.
  // Katalog awal berasal dari migrasi (kategori TIDAK ikut di-TRUNCATE); direset ke keadaan awal tiap tes supaya perubahan satu tes (nonaktif/kategori tambahan) tidak bocor.
  await testPrisma.pkrItemCategory.deleteMany({ where: { code: { notIn: Object.keys(KATEGORI) } } });
  for (const [code, [name, shape, workKind, sortOrder]] of Object.entries(KATEGORI)) {
    await testPrisma.pkrItemCategory.upsert({ where: { code }, update: { name, shape, workKind, sortOrder, active: true }, create: { code, name, shape, workKind, sortOrder } });
  }
  return { seller, admin: await peran("ADMIN"), finance: await peran("FINANCE"), sales: await peran("SALES"), produksi: await peran("PRODUCTION_LEAD") };
}
const badan = (seller, orderCrm, extra = {}) => ({
  date: "2026-10-02", sellerId: seller.id, buyerName: "Bu Ani (kerabat)",
  items: [{ name: "Kasur + divan + sandaran", quantity: 1, unitPrice: 3_000_000 }], ...(orderCrm ? { orderCrm } : {}), ...extra,
});
const KASUR = { kategori: "KASUR_BARU", produkNama: "Kasur Sano Custom", jumlah: 1, panjang: 200, lebar: 160, tebal: 20, perluDikirim: true, spesifikasi: "Pegas bonnel, kain knit" };
const DIVAN = { kategori: "DIVAN_BOX", produkNama: "Divan Laci", jumlah: 1, panjang: 200, lebar: 160, tinggi: 30, perluDikirim: true };
const SANDARAN = { kategori: "SANDARAN", produkNama: "Sandaran Busa", jumlah: 1, lebar: 160, tinggi: 120, perluDikirim: false };
const SERVICE = { kategori: "SERVICE_UPGRADE", produkNama: "Full Service", jumlah: 1, panjang: 190, lebar: 90, perluDikirim: true, spesifikasi: "Kempes bagian tengah" };
const ALAMAT = { alamat: "Jl. Mawar 5, Bekasi", kota: "Bekasi" };

async function jejak() {
  return {
    jurnal: await testPrisma.finJournalEntry.count(), baris: await testPrisma.finJournalLine.count(), payment: await testPrisma.payment.count(),
    invoice: await testPrisma.invoice.count(), orderItem: await testPrisma.orderItem.count(), gap: await testPrisma.finPostingGap.count(),
  };
}
const hitung = async () => ({
  pkr: await testPrisma.finPenjualanKaryawan.count(), order: await testPrisma.order.count(), unit: await testPrisma.unit.count(), item: await testPrisma.pkrOrderItem.count(),
  tautan: await testPrisma.pkrOrderItemUnit.count(), customer: await testPrisma.customer.count(), job: await testPrisma.job.count(),
});
const catat = async (w, orderCrm, extra = {}) => {
  const r = await w.finance.c.post(BASE, badan(w.seller, orderCrm, extra), kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};
const pkrLama = (w, nomor = "PKR-01102026-001") => testPrisma.finPenjualanKaryawan.create({
  data: { nomor, date: new Date("2026-10-01"), sellerId: w.seller.id, buyerName: "Pak Budi", total: 500_000, items: { create: [{ name: "Paket", quantity: 1, unitPrice: 500_000 }] } },
});
const unitDi = (orderId) => testPrisma.unit.findMany({ where: { orderId }, orderBy: { seq: "asc" } });

// ═══ 1. Kasur + divan + sandaran ═══
test("PKR multi-item: 1 Order, 3 item, 3 unit (merk/ukuran per item), tertaut ke satu PKR; tanpa Payment/invoice/OrderItem/jurnal tambahan", async () => {
  const w = await siapkan();
  const p = await catat(w, { items: [KASUR, DIVAN, SANDARAN], ...ALAMAT });
  assert.deepEqual(await hitung(), { pkr: 1, order: 1, unit: 3, item: 3, tautan: 3, customer: 1, job: 0 }, "BARU: unit langsung di workshop, belum ada job");
  const order = await testPrisma.order.findFirst({ include: { units: { orderBy: { seq: "asc" } }, pkrItems: { orderBy: { seq: "asc" } } } });
  assert.equal(order.penjualanKaryawanId, p.id);
  assert.equal(order.category, "BARU"); assert.equal(order.quantity, 3); assert.equal(order.value, 0);
  assert.equal(order.salesOwnerId, null); assert.equal(order.pkrPerluDikirim, true, "ada item yang dikirim");
  assert.equal(order.status, "PROCESSING", "unit BARU langsung di workshop (aturan D-051)");
  assert.deepEqual(order.units.map((u) => [u.merk, u.ukuran, u.status]), [
    ["Kasur Sano Custom", "200 × 160 × 20 cm", "RECEIVED"], ["Divan Laci", "200 × 160 cm · tinggi 30 cm", "RECEIVED"], ["Sandaran Busa", "lebar 160 × tinggi 120 cm", "RECEIVED"],
  ]);
  assert.deepEqual(order.pkrItems.map((i) => [i.seq, i.shape, i.workKind, i.qty, i.perluDikirim]), [[1, "KASUR", "BARU", 1, true], [2, "DIVAN", "BARU", 1, true], [3, "SANDARAN", "BARU", 1, false]]);
  assert.equal(Number(order.pkrItems[0].thicknessCm), 20);
  const tautan = await testPrisma.pkrOrderItemUnit.findMany({ include: { item: true, unit: true } });
  for (const t of tautan) assert.equal(t.unit.orderId, t.item.orderId);
  const info = JSON.parse(order.notes);
  assert.equal(info.pkrItems.length, 3); assert.equal(info.pkrNomor, p.nomor);
  assert.equal(info.merkKasur, undefined, "merk/ukuran tingkat order tidak dipakai");

  const j = await jejak();
  assert.equal(j.jurnal, 1, "hanya jurnal milik PKR");
  assert.equal(j.payment + j.invoice + j.orderItem + j.gap, 0);

  assert.equal(p.sinkron.order.modeItem, true);
  assert.equal(p.sinkron.order.spesifikasi.lengkap, true);
  assert.deepEqual(p.sinkron.items.map((i) => [i.no, i.kategoriNama, i.jumlah, i.ukuran, i.kirimLabel, i.unit.length]), [
    [1, "Kasur Baru", 1, "200 × 160 × 20 cm", "Dikirim", 1], [2, "Divan/Box", 1, "200 × 160 cm · tinggi 30 cm", "Dikirim", 1], [3, "Sandaran/Headboard", 1, "lebar 160 × tinggi 120 cm", "Diambil sendiri", 1],
  ]);
  assert.equal(p.sinkron.units.length, 3);
});

test("jumlah per item menghasilkan unit sebanyak jumlah; nomor unit berurutan dalam order; semua item satu order", async () => {
  const w = await siapkan();
  const p = await catat(w, { items: [{ ...KASUR, jumlah: 2 }, { ...DIVAN, jumlah: 2 }], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  const unit = await unitDi(order.id);
  assert.deepEqual(unit.map((u) => u.unitCode), [1, 2, 3, 4].map((n) => `${order.orderNumber}-U${n}`));
  assert.deepEqual(unit.map((u) => u.merk), ["Kasur Sano Custom", "Kasur Sano Custom", "Divan Laci", "Divan Laci"]);
  assert.equal(order.quantity, 4);
  const item = await testPrisma.pkrOrderItem.findMany({ include: { units: true }, orderBy: { seq: "asc" } });
  assert.deepEqual(item.map((i) => i.units.length), [2, 2]);
});

// ═══ 2. Pratinjau ═══
test("pratinjau = hasil pembuatan dan TIDAK menulis apa pun; menyebut unit, pickup, pengiriman, kelengkapan, dan yang tidak dibuat", async () => {
  const w = await siapkan();
  const awal = await hitung(); const j0 = await jejak();
  const pr = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { orderCrm: { items: [KASUR, DIVAN, SANDARAN], ...ALAMAT } });
  assert.equal(pr.status, 200, JSON.stringify(pr.body));
  const v = pr.body;
  assert.equal(v.valid, true);
  assert.deepEqual([v.order.kategori, v.order.jumlahItem, v.order.jumlahUnit, v.order.nilai], ["BARU", 3, 3, 0]);
  assert.deepEqual(v.delivery.itemDikirim, [1, 2]); assert.deepEqual(v.delivery.itemDiambilSendiri, [3]); assert.equal(v.delivery.adaJobPengiriman, true); assert.equal(v.delivery.jobGanda, false);
  assert.equal(v.pickup.adaJob, false);
  assert.equal(v.produksi.lengkap, true);
  assert.deepEqual(v.items.map((i) => i.unit.nomorUnit), [["U1"], ["U2"], ["U3"]]);
  assert.ok(v.tidakDibuat.some((t) => /Payment/.test(t)) && v.tidakDibuat.some((t) => /Invoice/.test(t)) && v.tidakDibuat.some((t) => /jurnal/i.test(t)));
  assert.deepEqual(await hitung(), awal); assert.deepEqual(await jejak(), j0);

  const p = await catat(w, { items: [KASUR, DIVAN, SANDARAN], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  const sesudah = await hitung();
  assert.equal(sesudah.unit, v.order.jumlahUnit); assert.equal(sesudah.item, v.order.jumlahItem);
  assert.equal(order.category, v.order.kategori);
});

test("pratinjau: masukan salah dikembalikan sebagai valid:false + pesan; kekurangan data = 'Perlu dilengkapi'; campuran Service + produk baru diberi peringatan; PKR yang sudah punya order tidak membuat order baru", async () => {
  const w = await siapkan();
  const salah = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { orderCrm: { items: [{ kategori: "CUSTOM_LAINNYA" }] } });
  assert.equal(salah.status, 200); assert.equal(salah.body.valid, false); assert.equal(salah.body.galat.kode, "SPESIFIKASI_CUSTOM_WAJIB"); assert.match(salah.body.galat.pesan, /Item 1/);

  const kurang = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { orderCrm: { items: [{ kategori: "KASUR_BARU", jumlah: 1 }] } });
  assert.equal(kurang.body.valid, true); assert.equal(kurang.body.produksi.lengkap, false);
  assert.deepEqual(kurang.body.produksi.kurang, ["Produk / merk", "Panjang", "Lebar", "Tebal", "Dikirim atau diambil sendiri"]);
  assert.match(kurang.body.produksi.status, /Perlu dilengkapi/);

  const campur = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { orderCrm: { items: [SERVICE, KASUR], ...ALAMAT } });
  assert.equal(campur.body.order.kategori, "LAYANAN"); assert.deepEqual(campur.body.pickup.itemNo, [1]);
  assert.ok(campur.body.peringatan.some((x) => x.kode === "CAMPUR_LAYANAN_BARU"));

  const lama = await pkrLama(w);
  const a = await w.finance.c.post(`${BASE}/${lama.id}/order-crm`, { spesifikasi: { items: [KASUR], ...ALAMAT } }, kunci());
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const sudah = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { penjualanId: lama.id, orderCrm: { items: [KASUR], ...ALAMAT } });
  assert.equal(sudah.body.sudahAdaOrder.nomor, a.body.orderNumber);
  const notFound = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { penjualanId: randomUUID(), orderCrm: { items: [KASUR] } });
  assert.equal(notFound.status, 404);
});

// ═══ 3. Validasi ═══
test("validasi: duplikat persis, custom tanpa spesifikasi, kategori/produk tidak sah, batas unit, isian lama dicampur, kategori nonaktif — PKR tidak tercatat sama sekali", async () => {
  const w = await siapkan();
  const awal = await hitung(); const j0 = await jejak();
  const tolak = async (orderCrm, kode, pola) => {
    const r = await w.finance.c.post(BASE, badan(w.seller, orderCrm), kunci());
    assert.equal(r.status, 400, `${kode}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, kode, JSON.stringify(r.body));
    if (pola) assert.match(r.body.error, pola);
  };
  await tolak({ items: [KASUR, { ...KASUR, jumlah: 2 }] }, "ITEM_DUPLIKAT", /Item 2 sama persis dengan Item 1/);
  await tolak({ items: [{ kategori: "CUSTOM_LAINNYA", jumlah: 1 }] }, "SPESIFIKASI_CUSTOM_WAJIB");
  await tolak({ items: [{ kategori: "TIDAK_ADA", jumlah: 1 }] }, "KATEGORI_WAJIB");
  await tolak({ items: [] }, "ITEM_KOSONG");
  await tolak({ items: [{ ...KASUR, jumlah: 21 }] }, "ITEM_PKR_TIDAK_VALID", /Jumlah harus bilangan bulat 1–20/);
  await tolak({ items: [{ ...KASUR, jumlah: 20 }, DIVAN] }, "UNIT_TERLALU_BANYAK", /melebihi batas 20/);
  await tolak({ items: [{ ...SANDARAN, panjang: 200 }] }, "ITEM_PKR_TIDAK_VALID", /Panjang tidak dipakai untuk sandaran/);
  await tolak({ items: [{ ...KASUR, lebar: "-3" }] }, "ITEM_PKR_TIDAK_VALID");
  await tolak({ items: [KASUR], merk: "Sano" }, "SPEK_CAMPUR", /tidak bisa dipakai bersama daftar item/);
  const lain = await testPrisma.pkrItemProduct.create({ data: { categoryId: (await testPrisma.pkrItemCategory.findUnique({ where: { code: "DIVAN_BOX" } })).id, code: `T-${randomUUID().slice(0, 8).toUpperCase()}`, name: "Divan X" } });
  await tolak({ items: [{ ...KASUR, produkNama: undefined, produkId: lain.id }] }, "PRODUK_TIDAK_SESUAI");
  await testPrisma.pkrItemCategory.update({ where: { code: "DIVAN_BOX" }, data: { active: false } });
  await tolak({ items: [DIVAN] }, "KATEGORI_NONAKTIF", /dinonaktifkan Admin/);
  assert.deepEqual(await hitung(), awal, "semua penolakan = tidak ada PKR/order/unit/item");
  assert.deepEqual(await jejak(), j0, "dan tidak ada jurnal");
});

// ═══ 4. Campuran Service + produk baru ═══
test("Service + produk baru dalam satu PKR: order LAYANAN; hanya unit Service menunggu pickup (satu job pickup); unit produk baru langsung di workshop", async () => {
  const w = await siapkan();
  const p = await catat(w, { items: [SERVICE, KASUR, DIVAN], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  assert.equal(order.category, "LAYANAN"); assert.equal(order.status, "PENDING", "belum Diproses sampai barang service diambil");
  const unit = await unitDi(order.id);
  assert.deepEqual(unit.map((u) => u.status), ["AWAITING_PICKUP", "RECEIVED", "RECEIVED"]);
  const pickup = await testPrisma.job.findMany({ where: { orderId: order.id, type: "PICKUP" }, include: { units: true } });
  assert.equal(pickup.length, 1); assert.deepEqual(pickup[0].units.map((x) => x.unitId), [unit[0].id]);
  assert.match(pickup[0].addressText, /Mawar 5/);
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id, type: "DELIVERY" } }), 0);
  const j = await jejak();
  assert.equal(j.payment + j.invoice + j.orderItem, 0);
});

// ═══ 5. Delivery ═══
test("Delivery: item yang dikirim bergabung ke SATU job pengiriman; diambil sendiri/belum ditentukan tidak ikut; pemanggilan berulang/paralel tidak menggandakan job", async () => {
  const w = await siapkan();
  const belum = { ...DIVAN, kategori: "DIVAN_BOX", produkNama: "Divan Polos", lebar: 140, perluDikirim: null };
  const p = await catat(w, { items: [KASUR, DIVAN, SANDARAN, belum], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  const unit = await unitDi(order.id);
  await testPrisma.unit.updateMany({ where: { orderId: order.id }, data: { status: "READY_FOR_DELIVERY" } });
  for (const u of unit) await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
  await Promise.all(unit.map((u) => testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id)).catch(() => null)));
  const jobs = await testPrisma.job.findMany({ where: { orderId: order.id, type: "DELIVERY" }, include: { units: true } });
  assert.equal(jobs.length, 1, "tepat satu job pengiriman");
  assert.deepEqual(jobs[0].units.map((x) => x.unitId).sort(), [unit[0].id, unit[1].id].sort(), "hanya kasur + divan yang dikirim");
  const baca = await w.finance.c.get(`${BASE}/${p.id}`);
  assert.equal(baca.body.sinkron.delivery.kode, "UNSCHEDULED");

  // Item yang tadinya "diambil sendiri" diubah menjadi dikirim -> bergabung ke job yang SAMA (belum dijadwalkan)
  const u = await w.finance.c.put(`${BASE}/${p.id}/order-crm`, { items: [{ no: 3, perluDikirim: true }] }, kunci());
  assert.equal(u.status, 200, JSON.stringify(u.body));
  const sesudah = await testPrisma.job.findMany({ where: { orderId: order.id, type: "DELIVERY" }, include: { units: true } });
  assert.equal(sesudah.length, 1); assert.equal(sesudah[0].units.length, 3);
  // ...dan tidak bisa dikembalikan ke "ambil sendiri" selama unitnya sudah di job pengiriman
  const balik = await w.finance.c.put(`${BASE}/${p.id}/order-crm`, { items: [{ no: 1, perluDikirim: false }] }, kunci());
  assert.equal(balik.status, 409); assert.equal(balik.body.code, "ITEM_SUDAH_DI_JOB_KIRIM");
});

// ═══ 6. Kompatibilitas order lama ═══
test("order LAMA: jalur lama (kategori/jumlahUnit/merk/ukuran) tetap bekerja tanpa baris item; ringkasan membentuk item virtual; lengkapi lama bekerja", async () => {
  const w = await siapkan();
  const p = await catat(w, { kategori: "BARU", jumlahUnit: 2, merk: "Sano", ukuran: "160 x 200", perluDikirim: true, ...ALAMAT });
  assert.equal(await testPrisma.pkrOrderItem.count(), 0, "jalur lama tidak menulis item");
  assert.equal(await testPrisma.unit.count(), 2);
  assert.equal(p.sinkron.order.modeItem, false);
  assert.equal(p.sinkron.order.spesifikasi.lengkap, true);
  assert.equal(p.sinkron.items.length, 1);
  const [v] = p.sinkron.items;
  assert.deepEqual([v.virtual, v.kategoriNama, v.jenisKerja, v.produk, v.jumlah, v.ukuran, v.kirimLabel, v.unit.length], [true, "Kasur Baru", "BARU", "Sano", 2, "160 x 200", "Dikirim", 2]);

  const l = await w.finance.c.put(`${BASE}/${p.id}/order-crm`, { merk: "Sano Premium" }, kunci());
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.equal(l.body.spesifikasi.merk, "Sano Premium");
  assert.equal((await testPrisma.unit.findMany({ orderBy: { seq: "asc" } })).every((u) => u.merk === "Sano Premium"), true);
  // order lama menolak daftar item (tidak ada konversi diam-diam)
  const tolak = await w.finance.c.put(`${BASE}/${p.id}/order-crm`, { items: [{ no: 1, panjang: 200 }] }, kunci());
  assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "ORDER_TANPA_ITEM");

  // Service lama (LAYANAN) dibaca sebagai item virtual Service/Upgrade
  const s = await catat(w, { kategori: "LAYANAN", jumlahUnit: 1, merk: "Sano", ukuran: "160 x 200", perluDikirim: false }, { buyerName: "Bu Dewi" });
  assert.deepEqual([s.sinkron.items[0].kategoriNama, s.sinkron.items[0].jenisKerja, s.sinkron.items[0].virtual], ["Service/Upgrade Kasur", "LAYANAN", true]);
});

test("PKR lama tanpa order + daftar item lewat aksi eksplisit; tautkan order yang sudah ada tidak menerima daftar item", async () => {
  const w = await siapkan();
  const lama = await pkrLama(w);
  const b = await w.finance.c.post(`${BASE}/${lama.id}/order-crm`, { spesifikasi: { items: [KASUR, DIVAN], ...ALAMAT } }, kunci());
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal(b.body.sinkron.items.length, 2);
  assert.equal((await jejak()).jurnal, 0, "tidak ada jurnal baru untuk PKR lama");

  const lain = await pkrLama(w, "PKR-01102026-002");
  const kosong = await testPrisma.order.create({ data: { customerId: (await testPrisma.customer.findFirst()).id, value: 0, status: "PENDING" } });
  const tautkan = await w.finance.c.post(`${BASE}/${lain.id}/order-crm`, { spesifikasi: { items: [KASUR] }, orderId: kosong.id }, kunci());
  assert.equal(tautkan.status, 400); assert.equal(tautkan.body.code, "ITEM_TIDAK_UNTUK_TAUTAN");
});

// ═══ 7. Idempotensi + paralel ═══
test("replay & paralel POST order-crm dengan daftar item sama = SATU order, item, dan unit; isi berbeda = 409 (bukan order kedua)", async () => {
  const w = await siapkan();
  const lama = await pkrLama(w);
  const payload = { spesifikasi: { items: [KASUR, DIVAN, SANDARAN], ...ALAMAT } };
  const hasil = await Promise.all([1, 2, 3, 4].map(() => w.finance.c.post(`${BASE}/${lama.id}/order-crm`, payload, kunci())));
  assert.ok(hasil.every((r) => [200, 201].includes(r.status)), hasil.map((r) => r.status).join());
  assert.equal(new Set(hasil.map((r) => r.body.orderId)).size, 1);
  assert.deepEqual(await hitung(), { pkr: 1, order: 1, unit: 3, item: 3, tautan: 3, customer: 1, job: 0 });
  const ulang = await w.finance.c.post(`${BASE}/${lama.id}/order-crm`, payload, kunci());
  assert.equal(ulang.status, 200); assert.equal(ulang.body.dibuat, false);
  const beda = await w.finance.c.post(`${BASE}/${lama.id}/order-crm`, { spesifikasi: { items: [KASUR] } }, kunci());
  assert.equal(beda.status, 409); assert.equal(beda.body.code, "ORDER_SUDAH_ADA_BEDA");
  assert.deepEqual(await hitung(), { pkr: 1, order: 1, unit: 3, item: 3, tautan: 3, customer: 1, job: 0 });
});

test("kunci idempotensi sama pada POST PKR + daftar item: tidak menggandakan PKR/order/item/unit; isi beda dengan kunci sama ditolak", async () => {
  const w = await siapkan();
  const h = kunci();
  const a = await w.finance.c.post(BASE, badan(w.seller, { items: [KASUR, DIVAN] }), h);
  const b = await w.finance.c.post(BASE, badan(w.seller, { items: [KASUR, DIVAN] }), h);
  assert.equal(a.status, 201); assert.equal(b.status, 201); assert.equal(b.body.id, a.body.id);
  assert.deepEqual(await hitung(), { pkr: 1, order: 1, unit: 2, item: 2, tautan: 2, customer: 1, job: 0 });
  const c = await w.finance.c.post(BASE, badan(w.seller, { items: [KASUR] }), h);
  assert.equal(c.status, 422, "kunci sama + isi beda");
});

// ═══ 8. Lengkapi per item ═══
test("lengkapi per item: struktur terkunci; Produksi diblokir sampai lengkap; unit ikut tersinkron; setelah Produksi mulai spesifikasi terkunci tetapi pilihan kirim tidak", async () => {
  const w = await siapkan();
  const p = await catat(w, { items: [{ kategori: "KASUR_BARU", jumlah: 1 }, { kategori: "DIVAN_BOX", jumlah: 1 }] });
  assert.equal(p.sinkron.order.spesifikasi.lengkap, false);
  assert.ok(p.sinkron.order.spesifikasi.kurang.includes("Item 1 (Kasur Baru): Produk / merk"));
  assert.ok(p.sinkron.order.spesifikasi.kurang.includes("Item 2 (Divan/Box): Tipe divan"));
  assert.equal(p.sinkron.produksi.kode, "PERLU_DILENGKAPI");
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  const unit = await unitDi(order.id);
  await assert.rejects(() => testPrisma.$transaction((tx) => startStageInTx(tx, unit[0].id, { actorId: w.produksi.id })), /perlu dilengkapi dulu.*Produksi belum boleh dimulai/);

  // struktur terkunci
  for (const [body, kode] of [[{ items: [{ no: 1, jumlah: 3 }] }, "ITEM_STRUKTUR_TERKUNCI"], [{ items: [{ no: 1, kategori: "DIVAN_BOX" }] }, "ITEM_STRUKTUR_TERKUNCI"], [{ merk: "Sano" }, "SPEK_PER_ITEM"], [{ perluDikirim: true }, "SPEK_PER_ITEM"]]) {
    const r = await w.finance.c.put(`${BASE}/${p.id}/order-crm`, body, kunci());
    assert.equal(r.status, kode === "SPEK_PER_ITEM" ? 400 : 409, JSON.stringify(r.body)); assert.equal(r.body.code, kode);
  }
  const x = await w.finance.c.put(`${BASE}/${p.id}/order-crm`, { items: [{ no: 99, panjang: 100 }] }, kunci());
  assert.equal(x.status, 404);

  const l = await w.finance.c.put(`${BASE}/${p.id}/order-crm`, {
    items: [{ no: 1, produkNama: "Kasur Sano", panjang: 200, lebar: 160, tebal: 20, perluDikirim: true }, { no: 2, produkNama: "Divan Laci", panjang: 200, lebar: 160, perluDikirim: true }], ...ALAMAT,
  }, kunci());
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.equal(l.body.spesifikasi.lengkap, true);
  assert.equal(l.body.sinkron.produksi.kode, "MENUNGGU");
  assert.deepEqual((await unitDi(order.id)).map((u) => [u.merk, u.ukuran]), [["Kasur Sano", "200 × 160 × 20 cm"], ["Divan Laci", "200 × 160 cm"]]);
  const info = JSON.parse((await testPrisma.order.findUnique({ where: { id: order.id } })).notes);
  assert.equal(info.pkrItems[0].produk, "Kasur Sano"); assert.equal(info.pkrItems[0].lebar, 160);
  assert.equal(info.pkrNomor, p.nomor, "kunci lain di notes dipertahankan");
  const aud = await testPrisma.activityEvent.findFirst({ where: { entityId: order.id, eventType: "PKR_ORDER_SINKRON" }, orderBy: { createdAt: "desc" } });
  assert.equal(aud.metadata.aksi, "dilengkapi"); assert.ok(aud.metadata.perubahan.item.length === 2);

  // tanpa perubahan = 400
  const sama = await w.finance.c.put(`${BASE}/${p.id}/order-crm`, { items: [{ no: 1, panjang: 200 }] }, kunci());
  assert.equal(sama.status, 400); assert.equal(sama.body.code, "TANPA_PERUBAHAN");

  // Produksi mulai pada unit item 1 -> spesifikasi item 1 terkunci; pilihan kirim masih boleh
  await testPrisma.unit.update({ where: { id: unit[0].id }, data: { status: "IN_PRODUCTION", currentStageId: (await testPrisma.routingStage.findFirst({ select: { id: true } }))?.id ?? null } });
  const mulai = await testPrisma.unit.findUnique({ where: { id: unit[0].id } });
  assert.ok(mulai.currentStageId, "database uji harus punya tahap routing (seed migrasi) agar kasus Produksi-sudah-mulai benar-benar diuji");
  {
    const kunciSpek = await w.finance.c.put(`${BASE}/${p.id}/order-crm`, { items: [{ no: 1, panjang: 210 }] }, kunci());
    assert.equal(kunciSpek.status, 409); assert.equal(kunciSpek.body.code, "ITEM_SUDAH_DIPRODUKSI");
    const kirim = await w.finance.c.put(`${BASE}/${p.id}/order-crm`, { items: [{ no: 1, perluDikirim: false }] }, kunci());
    assert.equal(kirim.status, 200, JSON.stringify(kirim.body));
  }
});

// ═══ 9. Katalog Admin ═══
test("katalog: semua peran berizin Finance membaca yang aktif + definisi bentuk; hanya Admin menulis; kode unik; nonaktif tidak bisa dipakai item baru tetapi order lama tetap terbaca; audit tercatat", async () => {
  const w = await siapkan();
  const kat = await w.finance.c.get(`${BASE}/katalog-item`);
  assert.equal(kat.status, 200);
  assert.deepEqual(kat.body.kategori.map((k) => k.kode), ["KASUR_BARU", "SERVICE_UPGRADE", "DIVAN_BOX", "SANDARAN", "SET_LENGKAP", "CUSTOM_LAINNYA"]);
  assert.deepEqual(Object.keys(kat.body.bentuk).sort(), ["CUSTOM", "DIVAN", "KASUR", "SANDARAN", "SERVICE", "SET"]);
  assert.equal(kat.body.bentuk.DIVAN.produk.label, "Tipe divan");
  assert.equal((await w.sales.c.get(`${BASE}/katalog-item`)).status, 403);

  const tulis = await w.finance.c.post(`${BASE}/katalog-item/kategori`, { kode: "DIVAN_LACI", nama: "Divan Laci", bentuk: "DIVAN", jenisKerja: "BARU" });
  assert.equal(tulis.status, 403, "Finance tidak mengelola katalog produksi");
  assert.equal((await w.finance.c.get(`${BASE}/katalog-item/kelola`)).status, 403);

  const baru = await w.admin.c.post(`${BASE}/katalog-item/kategori`, { kode: "DIVAN_LACI", nama: "Divan Laci Khusus", bentuk: "DIVAN", jenisKerja: "BARU", urutan: 35 });
  assert.equal(baru.status, 201, JSON.stringify(baru.body));
  assert.equal((await w.admin.c.post(`${BASE}/katalog-item/kategori`, { kode: "DIVAN_LACI", nama: "Lagi", bentuk: "DIVAN", jenisKerja: "BARU" })).status, 409);
  assert.equal((await w.admin.c.post(`${BASE}/katalog-item/kategori`, { kode: "bentuk_salah!", nama: "X", bentuk: "DIVAN", jenisKerja: "BARU" })).status, 400);
  assert.equal((await w.admin.c.post(`${BASE}/katalog-item/kategori`, { kode: "ABC", nama: "X", bentuk: "SOFA", jenisKerja: "BARU" })).status, 400);
  const prod = await w.admin.c.post(`${BASE}/katalog-item/produk`, { kategoriId: baru.body.id, kode: "DIVAN_LACI_180", nama: "Divan Laci 180" });
  assert.equal(prod.status, 201, JSON.stringify(prod.body));

  // dipakai item baru lewat produkId
  const dipakai = await catat(w, { items: [{ kategori: "DIVAN_LACI", produkId: prod.body.id, jumlah: 1, panjang: 200, lebar: 180, perluDikirim: true }], ...ALAMAT });
  assert.equal(dipakai.sinkron.items[0].produk, "Divan Laci 180");
  assert.equal(dipakai.sinkron.items[0].kategoriNama, "Divan Laci Khusus");

  // nonaktifkan: item baru ditolak, dokumen lama tetap terbaca (snapshot), tidak berubah
  const non = await w.admin.c.patch(`${BASE}/katalog-item/kategori/${baru.body.id}`, { aktif: false });
  assert.equal(non.status, 200);
  const tolak = await w.finance.c.post(BASE, badan(w.seller, { items: [{ kategori: "DIVAN_LACI", produkNama: "x", jumlah: 1 }] }), kunci());
  assert.equal(tolak.status, 400); assert.equal(tolak.body.code, "KATEGORI_NONAKTIF");
  const lama = await w.finance.c.get(`${BASE}/${dipakai.id}`);
  assert.equal(lama.body.sinkron.items[0].produk, "Divan Laci 180");
  assert.equal(JSON.stringify((await w.finance.c.get(`${BASE}/katalog-item`)).body.kategori.map((k) => k.kode)).includes("DIVAN_LACI"), false, "nonaktif tidak muncul di form");
  assert.equal((await w.admin.c.get(`${BASE}/katalog-item/kelola`)).body.kategori.some((k) => k.kode === "DIVAN_LACI" && k.aktif === false), true);
  // replay dokumen yang sama tetap idempoten walau kategorinya kini nonaktif
  const replay = await w.finance.c.post(`${BASE}/${dipakai.id}/order-crm`, { spesifikasi: { items: [{ kategori: "DIVAN_LACI", produkId: prod.body.id, jumlah: 1, panjang: 200, lebar: 180, perluDikirim: true }], ...ALAMAT } }, kunci());
  assert.equal(replay.status, 200); assert.equal(replay.body.dibuat, false);

  const aud = await testPrisma.activityEvent.findMany({ where: { eventType: "PKR_KATALOG_DIUBAH" }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(aud.map((a) => a.metadata.aksi), ["kategori_dibuat", "produk_dibuat", "kategori_diubah"]);
});

test("produk yang dipetakan Admin ke layanan produksi: unit item lahir dengan layanan itu; tanpa pemetaan unit tidak diberi layanan (tidak ada pilihan kedua, tidak menebak)", async () => {
  const w = await siapkan();
  const layanan = await testPrisma.serviceCatalog.create({ data: { code: "UPG_UJI", labelId: "Upgrade Uji", serviceLine: "UPGRADE" } });
  const kat = await testPrisma.pkrItemCategory.findUnique({ where: { code: "SERVICE_UPGRADE" } });
  const dipetakan = await w.admin.c.post(`${BASE}/katalog-item/produk`, { kategoriId: kat.id, kode: "SVC_UJI_PETA", nama: "Upgrade Uji", layananProduksiId: layanan.id });
  assert.equal(dipetakan.status, 201, JSON.stringify(dipetakan.body));
  const polos = await w.admin.c.post(`${BASE}/katalog-item/produk`, { kategoriId: kat.id, kode: "SVC_UJI_POLOS", nama: "Service Polos" });
  const p = await catat(w, {
    items: [
      { kategori: "SERVICE_UPGRADE", produkId: dipetakan.body.id, jumlah: 1, panjang: 190, lebar: 90, perluDikirim: true },
      { kategori: "SERVICE_UPGRADE", produkId: polos.body.id, jumlah: 1, panjang: 200, lebar: 160, perluDikirim: true },
    ], ...ALAMAT,
  });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  const unit = await unitDi(order.id);
  assert.equal(unit[0].serviceId, layanan.id); assert.equal(unit[0].serviceLine, "UPGRADE");
  assert.equal(unit[1].serviceId, null);
  const bad = await w.admin.c.patch(`${BASE}/katalog-item/produk/${polos.body.id}`, { layananProduksiId: randomUUID() });
  assert.equal(bad.status, 404);
});

// ═══ 10. Pembatalan ═══
test("batal PKR sebelum diproses membatalkan SEMUA unit item (item tetap tercatat sebagai riwayat); sesudah Produksi mulai diblokir", async () => {
  const w = await siapkan();
  const p = await catat(w, { items: [KASUR, DIVAN, SANDARAN], ...ALAMAT });
  const r = await w.admin.c.post(`${BASE}/${p.id}/batal`, { reason: "Salah catat pembeli" }, kunci());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  assert.equal(order.status, "CANCELLED");
  assert.deepEqual((await unitDi(order.id)).map((u) => u.status), ["CANCELLED", "CANCELLED", "CANCELLED"]);
  assert.equal(await testPrisma.pkrOrderItem.count(), 3, "baris item tidak dihapus");

  const p2 = await w.finance.c.post(BASE, badan(w.seller, { items: [KASUR, DIVAN] }, { buyerName: "Bu Dewi" }), kunci());
  const o2 = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p2.body.id } });
  const u2 = await unitDi(o2.id);
  await testPrisma.unit.update({ where: { id: u2[1].id }, data: { status: "IN_PRODUCTION" } });
  const blok = await w.admin.c.post(`${BASE}/${p2.body.id}/batal`, { reason: "Terlambat" }, kunci());
  assert.equal(blok.status, 409); assert.equal(blok.body.code, "PRODUKSI_DELIVERY_BERJALAN");
});

// ═══ 11. Penjaga cerminan notes ═══
test("PATCH order dari CRM: cerminan item di notes dipertahankan; merk/ukuran tingkat order dibuang; catatan teks polos ditolak; order biasa tidak terpengaruh", async () => {
  const w = await siapkan();
  const p = await catat(w, { items: [KASUR, DIVAN], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  const teks = await w.admin.c.patch(`/api/orders/${order.id}`, { notes: "catatan polos" });
  assert.equal(teks.status, 409); assert.equal(teks.body.code, "NOTES_PKR_TERSTRUKTUR");

  const r = await w.admin.c.patch(`/api/orders/${order.id}`, { notes: JSON.stringify({ merkKasur: "Lain", ukuranKasur: "100 x 200", catatan: "Antar sore hari", pkrItems: [] }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const info = JSON.parse((await testPrisma.order.findUnique({ where: { id: order.id } })).notes);
  assert.equal(info.pkrItems.length, 2, "cerminan item dipertahankan");
  assert.equal(info.merkKasur, undefined); assert.equal(info.ukuranKasur, undefined);
  assert.equal(info.catatan, "Antar sore hari");
  assert.deepEqual((await unitDi(order.id)).map((u) => u.merk), ["Kasur Sano Custom", "Divan Laci"], "unit tidak tertimpa");
});
