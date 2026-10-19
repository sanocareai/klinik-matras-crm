// PENJUALAN KARYAWAN — ORDER MULTI-ITEM (kasur + divan + sandaran, dst), terhadap PostgreSQL sungguhan.
// Yang dikunci: (1) satu PKR -> satu Order -> banyak item -> unit per item; tanpa Payment/invoice/OrderItem/jurnal tambahan; (2) pratinjau = hasil pembuatan dan tidak menulis;
// (3) validasi (duplikat, custom tanpa spesifikasi, kategori/produk tidak sah, batas unit, isian lama dicampur, kategori nonaktif); (4) campuran Service + produk baru;
// (5) Delivery: item dikirim bergabung ke SATU job, item diambil sendiri tidak; (6) order LAMA tetap terbaca (item virtual) dan jalur lama tetap bekerja;
// (7) idempotensi + paralel + replay berbeda; (8) lengkapi per item: struktur terkunci, Produksi sudah mulai terkunci; (9) katalog Admin: izin, audit, nonaktif, layanan produksi;
// (10) pembatalan PKR membatalkan semua unit item; (11) edit catatan dari CRM tidak merusak cerminan item;
// (12) order CAMPURAN: kategori/rute/kelengkapan/status per item; (13) bundel Set -> komponen; (14) produk tanpa pemetaan rute diblokir;
// (15) Koreksi Item (alasan, pratinjau, audit, revisi optimistis, Idempotency-Key, atomik, konkurensi, terkunci); (16) Delivery satu job gabungan + kirim sebagian eksplisit.
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
import { classifyUnitRow, RENCANA_UNIT_SELECT, cohortStatesOf } from "../../src/services/productionRencanaService.js";
import { loadV2Flags } from "../../src/services/v2FeatureFlags.js";
import { terapkanKoreksi } from "../../src/services/penjualanKaryawanKoreksi.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => {
  await truncateAll();
  // Tes "produk yang dipetakan Admin ke layanan produksi" menyisipkan layanan UPG_UJI (sortOrder 0, TANPA modul tahap). service_catalog tidak ikut di-TRUNCATE, jadi tanpa baris ini layanan itu bocor ke berkas berikutnya pada DB yang sama
  // dan tes yang memilih "layanan pertama menurut sortOrder" (QC/Workshop) mendapat layanan tanpa tahap MODULE. Terbukti 19 Okt 2026: pkrMultiItem lalu productionQcFinishedGoods/productionWorkshopExecution -> 4 kegagalan di baseline MAUPUN kandidat.
  await testPrisma.pkrItemCategory.updateMany({ where: { productionService: { code: "UPG_UJI" } }, data: { productionServiceId: null } }).catch(() => {});
  await testPrisma.serviceCatalog.deleteMany({ where: { code: "UPG_UJI" } }).catch(() => {});
  await server.close(); await testPrisma.$disconnect();
});

const BASE = "/api/finance/penjualan-karyawan";
const kunci = () => ({ "Idempotency-Key": `pkri-${randomUUID()}` });
const KATEGORI = {
  KASUR_BARU: ["Kasur Baru", "KASUR", "BARU", 10], SERVICE_UPGRADE: ["Service/Upgrade Kasur", "SERVICE", "LAYANAN", 20], DIVAN_BOX: ["Divan/Box", "DIVAN", "BARU", 30],
  SANDARAN: ["Sandaran/Headboard", "SANDARAN", "BARU", 40], SET_LENGKAP: ["Set Kasur Lengkap", "SET", "BARU", 50], CUSTOM_LAINNYA: ["Produk Custom Lainnya", "CUSTOM", "BARU", 60],
};
// Pemetaan rute Produksi per kategori yang dipakai tes. Migrasi hanya memetakan yang literal (divan/sandaran); jenis kasur & layanan service adalah keputusan Admin, jadi tes
// memetakannya EKSPLISIT di sini — dan tes "rute" di bawah membuktikan bahwa tanpa pemetaan order DIBLOKIR.
const RUTE = {
  KASUR_BARU: { productLine: "KASUR", productType: "KASUR_SEHAT" }, SERVICE_UPGRADE: { productLine: "KASUR", productType: null }, DIVAN_BOX: { productLine: "DIVAN", productType: "DIVAN_UTAMA" },
  SANDARAN: { productLine: "DIVAN", productType: "DIVAN_SANDARAN" }, SET_LENGKAP: { productLine: null, productType: null }, CUSTOM_LAINNYA: { productLine: "SOFA", productType: "SOFA_L" },
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
  const layanan = await testPrisma.serviceCatalog.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
  assert.ok(layanan, "katalog layanan produksi dari migrasi harus ada");
  for (const [code, [name, shape, workKind, sortOrder]] of Object.entries(KATEGORI)) {
    const peta = { ...RUTE[code], productionServiceId: code === "SERVICE_UPGRADE" ? layanan.id : null };
    await testPrisma.pkrItemCategory.upsert({ where: { code }, update: { name, shape, workKind, sortOrder, active: true, ...peta }, create: { code, name, shape, workKind, sortOrder, ...peta } });
  }
  // Komposisi bundel: tabel ikut ter-TRUNCATE (CASCADE dari produk) — dipasang ulang sama seperti seed migrasi (Set = Kasur + Divan + Sandaran).
  const kat = Object.fromEntries((await testPrisma.pkrItemCategory.findMany()).map((c) => [c.code, c]));
  await testPrisma.pkrBundleComponent.deleteMany({});
  for (const [i, kode] of ["KASUR_BARU", "DIVAN_BOX", "SANDARAN"].entries()) {
    await testPrisma.pkrBundleComponent.create({ data: { bundleCategoryId: kat.SET_LENGKAP.id, componentCategoryId: kat[kode].id, qty: 1, sortOrder: (i + 1) * 10 } });
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
  assert.equal(campur.body.order.kategori, "CAMPURAN"); assert.deepEqual(campur.body.pickup.itemNo, [1]); // keputusan Owner: campuran TIDAK menjadi LAYANAN
  assert.ok(campur.body.peringatan.some((x) => x.kode === "CAMPURAN_PER_ITEM"));

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
  await tolak({ items: [{ ...KASUR, jumlah: 201 }] }, "ITEM_PKR_TIDAK_VALID", /Jumlah harus bilangan bulat 1–200/);
  await tolak({ items: [{ ...KASUR, jumlah: 200 }, DIVAN] }, "UNIT_TERLALU_BANYAK", /melebihi batas 200/);
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
test("Service + produk baru dalam satu PKR: order CAMPURAN; unit dirutekan PER ITEM (kategori/jenis produk per unit); hanya unit Service menunggu pickup; unit produk baru tidak menunggu", async () => {
  const w = await siapkan();
  const p = await catat(w, { items: [SERVICE, KASUR, DIVAN], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  assert.equal(order.category, "CAMPURAN"); assert.equal(order.status, "PENDING", "order belum Diproses sampai barang service diambil — tetapi itu TIDAK menahan unit produk baru");
  assert.match(order.orderNumber, /^MIX-/);
  const unit = await unitDi(order.id);
  assert.deepEqual(unit.map((u) => u.status), ["AWAITING_PICKUP", "RECEIVED", "RECEIVED"]);
  assert.deepEqual(unit.map((u) => u.workCategory), ["LAYANAN", "BARU", "BARU"]);
  assert.deepEqual(unit.map((u) => [u.productLine, u.productType]), [["KASUR", null], ["KASUR", "KASUR_SEHAT"], ["DIVAN", "DIVAN_UTAMA"]]);
  assert.ok(unit[0].serviceId, "item Service lahir dengan layanan produksi hasil pemetaan");
  assert.equal(unit[1].serviceId, null);
  const pickup = await testPrisma.job.findMany({ where: { orderId: order.id, type: "PICKUP" }, include: { units: true } });
  assert.equal(pickup.length, 1); assert.deepEqual(pickup[0].units.map((x) => x.unitId), [unit[0].id]);
  assert.match(pickup[0].addressText, /Mawar 5/);
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id, type: "DELIVERY" } }), 0);
  const j = await jejak();
  assert.equal(j.payment + j.invoice + j.orderItem, 0);

  // Status dihitung PER UNIT: kasur & divan (workshop) layak masuk Rencana walau order masih Menunggu; unit Service menunggu pickup.
  const states = cohortStatesOf(await loadV2Flags(testPrisma));
  const kelas = {};
  for (const u of unit) kelas[u.seq] = classifyUnitRow(await testPrisma.unit.findUnique({ where: { id: u.id }, select: RENCANA_UNIT_SELECT }), states);
  assert.equal(kelas[1].action, "WAIT_PICKUP");
  assert.notEqual(kelas[2].code, "ORDER_NOT_PROCESSING", "unit produk baru tidak ditahan status order campuran");
  assert.notEqual(kelas[3].code, "ORDER_NOT_PROCESSING");
  assert.notEqual(kelas[2].code, "PKR_PERLU_DILENGKAPI");
});

test("order campuran: kelengkapan dihitung PER ITEM — item yang belum lengkap tidak menahan item lain yang lengkap", async () => {
  const w = await siapkan();
  const kurang = { kategori: "DIVAN_BOX", produkNama: "Divan Laci", jumlah: 1, panjang: 200, perluDikirim: false }; // lebar belum diisi
  const p = await catat(w, { items: [KASUR, kurang], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  const unit = await unitDi(order.id);
  const states = cohortStatesOf(await loadV2Flags(testPrisma));
  const lengkap = classifyUnitRow(await testPrisma.unit.findUnique({ where: { id: unit[0].id }, select: RENCANA_UNIT_SELECT }), states);
  const belum = classifyUnitRow(await testPrisma.unit.findUnique({ where: { id: unit[1].id }, select: RENCANA_UNIT_SELECT }), states);
  assert.notEqual(lengkap.code, "PKR_PERLU_DILENGKAPI", "kasur lengkap tidak ikut tertahan");
  assert.equal(belum.code, "PKR_PERLU_DILENGKAPI");
  assert.match(belum.message, /Item 2/); assert.match(belum.message, /Lebar/);
  // Gerbang mulai tahap (jalur V1) juga per item
  await assert.rejects(() => testPrisma.$transaction((tx) => startStageInTx(tx, unit[1].id, { actorId: w.admin.id })), /perlu dilengkapi/i);
});

// ═══ 5. Delivery ═══
test("Delivery: menunggu SELURUH unit yang dikirim siap lalu SATU job gabungan; diambil sendiri/belum ditentukan tidak ikut; berulang/paralel tidak menggandakan; unit susulan tidak membuat job kedua otomatis", async () => {
  const w = await siapkan();
  const belum = { ...DIVAN, kategori: "DIVAN_BOX", produkNama: "Divan Polos", lebar: 140, perluDikirim: null };
  const p = await catat(w, { items: [KASUR, DIVAN, SANDARAN, belum], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  const unit = await unitDi(order.id);
  const jobKirim = () => testPrisma.job.findMany({ where: { orderId: order.id, type: "DELIVERY" }, include: { units: true } });

  // Kasur siap, divan belum -> TIDAK ada job (menunggu unit yang dikirim lainnya)
  await testPrisma.unit.update({ where: { id: unit[0].id }, data: { status: "READY_FOR_DELIVERY" } });
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, unit[0].id));
  assert.equal((await jobKirim()).length, 0, "belum semua unit yang dikirim siap");
  const tunggu = await w.finance.c.get(`${BASE}/${p.id}`);
  assert.equal(tunggu.body.sinkron.delivery.kode, "BELUM_ADA_JOB");

  // Divan siap -> satu job berisi kasur + divan (sandaran diambil sendiri, item belum ditentukan tidak ikut)
  await testPrisma.unit.update({ where: { id: unit[1].id }, data: { status: "READY_FOR_DELIVERY" } });
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, unit[1].id));
  await Promise.all(unit.map((u) => testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id)).catch(() => null)));
  await testPrisma.unit.updateMany({ where: { orderId: order.id }, data: { status: "READY_FOR_DELIVERY" } });
  for (const u of unit) await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
  const jobs = await jobKirim();
  assert.equal(jobs.length, 1, "tepat satu job pengiriman");
  assert.deepEqual(jobs[0].units.map((x) => x.unitId).sort(), [unit[0].id, unit[1].id].sort(), "hanya kasur + divan yang dikirim");
  const baca = await w.finance.c.get(`${BASE}/${p.id}`);
  assert.equal(baca.body.sinkron.delivery.kode, "UNSCHEDULED");

  // Item yang tadinya "diambil sendiri" diubah menjadi dikirim -> TIDAK otomatis masuk job yang ada, TIDAK ada job kedua otomatis (butuh aksi eksplisit di Delivery)
  const u = await w.finance.c.put(`${BASE}/${p.id}/order-crm`, { items: [{ no: 3, perluDikirim: true }] }, kunci());
  assert.equal(u.status, 200, JSON.stringify(u.body));
  const sesudah = await jobKirim();
  assert.equal(sesudah.length, 1); assert.equal(sesudah[0].units.length, 2, "unit susulan tidak disisipkan diam-diam");
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

  assert.equal((await w.produksi.c.get(`${BASE}/katalog-item/kelola`)).status, 403, "Kepala Produksi tanpa izin pkr_catalog:manage tidak mengelola katalog");
  const baru = await w.admin.c.post(`${BASE}/katalog-item/kategori`, { kode: "DIVAN_LACI", nama: "Divan Laci Khusus", bentuk: "DIVAN", jenisKerja: "BARU", urutan: 35, productLine: "DIVAN", productType: "DIVAN_UTAMA" });
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

test("produk yang dipetakan Admin ke layanan produksi: unit item lahir dengan layanan itu; produk tanpa pemetaan memakai pemetaan KATEGORI; tanpa keduanya diblokir (tidak menebak)", async () => {
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
  const bawaan = await testPrisma.serviceCatalog.findFirst({ where: { active: true, id: { not: layanan.id } }, orderBy: { code: "asc" } });
  assert.equal(unit[1].serviceId, bawaan.id, "produk tanpa pemetaan memakai pemetaan bawaan kategori");
  const bad = await w.admin.c.patch(`${BASE}/katalog-item/produk/${polos.body.id}`, { layananProduksiId: randomUUID() });
  assert.equal(bad.status, 404);

  // Kategori tanpa layanan bawaan + produk tanpa layanan -> DIBLOKIR di pratinjau dan pembuatan (mode rute KETAT; default TRANSISI menyimpannya — lihat pkrRuteTransisi.integration.test.js)
  await testPrisma.finSetting.upsert({ where: { key: "PRODUKSI_RUTE_MODE" }, create: { key: "PRODUKSI_RUTE_MODE", value: "KETAT" }, update: { value: "KETAT" } });
  await testPrisma.pkrItemCategory.update({ where: { code: "SERVICE_UPGRADE" }, data: { productionServiceId: null } });
  const blok = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { orderCrm: { items: [{ kategori: "SERVICE_UPGRADE", produkId: polos.body.id, jumlah: 1, panjang: 200, lebar: 160, perluDikirim: true }], ...ALAMAT } });
  assert.equal(blok.body.valid, false); assert.equal(blok.body.galat.kode, "RUTE_LAYANAN_BELUM_DIPETAKAN");
  assert.match(blok.body.galat.pesan, /Service Polos/); assert.match(blok.body.galat.pesan, /Katalog Item PKR/);
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

// ═══ 12. Pemetaan rute Produksi: produk aktif tanpa pemetaan DIBLOKIR ═══
test("rute: produk/kategori tanpa pemetaan diblokir di pratinjau DAN pembuatan (pesan Indonesia + arah tindakan); setelah Admin memetakan, lolos; tidak ada yang tertulis saat diblokir [mode KETAT]", async () => {
  const w = await siapkan();
  await testPrisma.finSetting.upsert({ where: { key: "PRODUKSI_RUTE_MODE" }, create: { key: "PRODUKSI_RUTE_MODE", value: "KETAT" }, update: { value: "KETAT" } });
  await testPrisma.pkrItemCategory.update({ where: { code: "KASUR_BARU" }, data: { productType: null } }); // lini KASUR saja belum cukup
  const kat = await testPrisma.pkrItemCategory.findUnique({ where: { code: "KASUR_BARU" } });
  const prod = await w.admin.c.post(`${BASE}/katalog-item/produk`, { kategoriId: kat.id, kode: "KSR_BELUM", nama: "Matras Custom TP" });
  assert.equal(prod.status, 201);
  const awal = await hitung(); const j0 = await jejak();
  const item = { kategori: "KASUR_BARU", produkId: prod.body.id, jumlah: 1, panjang: 200, lebar: 160, tebal: 20, perluDikirim: true };

  const pr = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { orderCrm: { items: [item, DIVAN], ...ALAMAT } });
  assert.equal(pr.status, 200); assert.equal(pr.body.valid, false);
  assert.equal(pr.body.galat.kode, "RUTE_PRODUK_BELUM_DIPETAKAN");
  assert.match(pr.body.galat.pesan, /Rute Produksi belum dipetakan untuk produk "Matras Custom TP"/);
  assert.match(pr.body.galat.pesan, /Pengaturan Produksi › Katalog Item PKR/);
  assert.deepEqual(pr.body.galat.rute.map((r) => r.no), [1], "hanya item yang belum dipetakan yang disebut");

  const buat = await w.finance.c.post(BASE, badan(w.seller, { items: [item, DIVAN], ...ALAMAT }), kunci());
  assert.equal(buat.status, 400); assert.equal(buat.body.code, "RUTE_PRODUK_BELUM_DIPETAKAN");
  assert.deepEqual(await hitung(), awal); assert.deepEqual(await jejak(), j0, "diblokir = tidak ada PKR/order/unit/jurnal");

  // Katalog Admin menampilkan produk yang belum dipetakan
  const kelola = await w.admin.c.get(`${BASE}/katalog-item/kelola`);
  assert.ok(kelola.body.ringkasan.belumDipetakan.some((b) => b.kode === "KSR_BELUM"));
  assert.ok(kelola.body.ringkasan.belumDipetakan.some((b) => b.kode === "KASUR_BARU" && b.tipe === "KATEGORI"));

  // Admin memetakan produk -> lolos; jenis produk tercatat di unit
  const peta = await w.admin.c.patch(`${BASE}/katalog-item/produk/${prod.body.id}`, { productLine: "KASUR", productType: "KASUR_SEHAT" });
  assert.equal(peta.status, 200, JSON.stringify(peta.body));
  const ok = await catat(w, { items: [item, DIVAN], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: ok.id } });
  assert.deepEqual((await unitDi(order.id)).map((u) => [u.productLine, u.productType]), [["KASUR", "KASUR_SEHAT"], ["DIVAN", "DIVAN_UTAMA"]]);

  // lini & jenis yang bertentangan ditolak saat memetakan
  const salah = await w.admin.c.patch(`${BASE}/katalog-item/produk/${prod.body.id}`, { productLine: "DIVAN", productType: "KASUR_SEHAT" });
  assert.equal(salah.status, 400); assert.equal(salah.body.code, "LINI_JENIS_TIDAK_SESUAI");
});

// ═══ 13. Bundel Set Kasur Lengkap ═══
test("bundel: Set dipecah menjadi komponen Kasur + Divan + Sandaran (bentuk & rute masing-masing); satu PKR/order; tanpa uang tambahan; komposisi dapat diatur Admin", async () => {
  const w = await siapkan();
  const katalog = await w.finance.c.get(`${BASE}/katalog-item`);
  const set = katalog.body.kategori.find((k) => k.kode === "SET_LENGKAP");
  assert.equal(set.bundel, true);
  assert.deepEqual(set.komposisi.map((k) => [k.kategoriKode, k.jumlah]), [["KASUR_BARU", 1], ["DIVAN_BOX", 1], ["SANDARAN", 1]]);

  const SET = {
    kategori: "SET_LENGKAP", jumlah: 2, perluDikirim: true, spesifikasi: "Warna abu",
    komponen: [{ panjang: 200, lebar: 160, tebal: 20, produkNama: "Sano" }, { panjang: 200, lebar: 160, tinggi: 30, produkNama: "Divan Laci" }, { lebar: 160, tinggi: 120, produkNama: "Sandaran Busa", perluDikirim: false }],
  };
  const pr = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { orderCrm: { items: [SET], ...ALAMAT } });
  assert.equal(pr.body.valid, true, JSON.stringify(pr.body));
  assert.deepEqual(pr.body.items.map((i) => [i.kategori, i.jumlah, i.bundel?.no]), [["KASUR_BARU", 2, 1], ["DIVAN_BOX", 2, 1], ["SANDARAN", 2, 1]]);
  assert.equal(pr.body.order.jumlahUnit, 6);

  const awal = await hitung();
  const p = await catat(w, { items: [SET], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id }, include: { pkrItems: { orderBy: { seq: "asc" } } } });
  assert.deepEqual(order.pkrItems.map((i) => [i.shape, i.qty, i.bundleNo, i.bundleCategoryCode, i.perluDikirim]), [["KASUR", 2, 1, "SET_LENGKAP", true], ["DIVAN", 2, 1, "SET_LENGKAP", true], ["SANDARAN", 2, 1, "SET_LENGKAP", false]]);
  const unit = await unitDi(order.id);
  assert.equal(unit.length, 6);
  assert.deepEqual(unit.map((u) => u.productType), ["KASUR_SEHAT", "KASUR_SEHAT", "DIVAN_UTAMA", "DIVAN_UTAMA", "DIVAN_SANDARAN", "DIVAN_SANDARAN"]);
  assert.equal((await hitung()).pkr - awal.pkr, 1); assert.equal((await hitung()).order - awal.order, 1);
  const j = await jejak();
  assert.equal(j.payment + j.invoice + j.orderItem, 0);
  assert.equal(p.sinkron.items.filter((i) => i.bundel?.no === 1).length, 3);
  assert.equal(p.sinkron.order.kategori, "BARU");

  // Admin mengubah komposisi: tanpa Sandaran -> Set berikutnya hanya 2 komponen; riwayat teraudit
  const kat = Object.fromEntries((await testPrisma.pkrItemCategory.findMany()).map((c) => [c.code, c]));
  const ubah = await w.admin.c.put(`${BASE}/katalog-item/komposisi`, { kategoriId: kat.SET_LENGKAP.id, komponen: [{ kategoriId: kat.KASUR_BARU.id, jumlah: 1 }, { kategoriId: kat.DIVAN_BOX.id, jumlah: 1 }] });
  assert.equal(ubah.status, 200, JSON.stringify(ubah.body));
  const pr2 = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { orderCrm: { items: [{ kategori: "SET_LENGKAP", jumlah: 1, perluDikirim: true }], ...ALAMAT } });
  assert.deepEqual(pr2.body.items.map((i) => i.kategori), ["KASUR_BARU", "DIVAN_BOX"]);
  assert.equal(pr2.body.produksi.lengkap, false, "komponen tanpa ukuran = perlu dilengkapi (boleh dibuat)");
  const aud = await testPrisma.activityEvent.findMany({ where: { eventType: "PKR_KATALOG_DIUBAH" } });
  assert.ok(aud.some((a) => a.metadata.aksi === "komposisi_diubah" && a.metadata.sesudah.length === 2 && a.metadata.sebelum.length === 3));

  // Komposisi tidak sesuai / kosong / bukan Admin
  const tdkSesuai = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { orderCrm: { items: [{ kategori: "SET_LENGKAP", jumlah: 1, komponen: [{}] }] } });
  assert.equal(tdkSesuai.body.valid, false); assert.equal(tdkSesuai.body.galat.kode, "KOMPONEN_BUNDEL_TIDAK_SESUAI");
  assert.equal((await w.finance.c.put(`${BASE}/katalog-item/komposisi`, { kategoriId: kat.SET_LENGKAP.id, komponen: [] })).status, 403);
  assert.equal((await w.admin.c.put(`${BASE}/katalog-item/komposisi`, { kategoriId: kat.SET_LENGKAP.id, komponen: [{ kategoriId: kat.SET_LENGKAP.id }] })).status, 409, "set tidak boleh bersarang");
  assert.equal((await w.admin.c.put(`${BASE}/katalog-item/komposisi`, { kategoriId: kat.KASUR_BARU.id, komponen: [] })).status, 409, "hanya kategori bentuk Set");
  await w.admin.c.put(`${BASE}/katalog-item/komposisi`, { kategoriId: kat.SET_LENGKAP.id, komponen: [] });
  const kosong = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { orderCrm: { items: [{ kategori: "SET_LENGKAP", jumlah: 1 }] } });
  assert.equal(kosong.body.valid, false); assert.equal(kosong.body.galat.kode, "BUNDEL_TANPA_KOMPOSISI");
});

test("bundel: dua set identik ditolak (gabungkan lewat Jumlah set)", async () => {
  const w = await siapkan();
  const SET = { kategori: "SET_LENGKAP", jumlah: 1, perluDikirim: true, komponen: [{ panjang: 200, lebar: 160, tebal: 20, produkNama: "Sano" }, { panjang: 200, lebar: 160, produkNama: "Divan" }, { lebar: 160, tinggi: 120 }] };
  const pr = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { orderCrm: { items: [SET, SET], ...ALAMAT } });
  assert.equal(pr.body.valid, false); assert.equal(pr.body.galat.kode, "ITEM_DUPLIKAT"); assert.match(pr.body.galat.pesan, /Jumlah pada Set/);
});

// ═══ 14. Koreksi Item ═══
const KOREKSI = (w, id, body, key = kunci()) => w.finance.c.post(`${BASE}/${id}/koreksi-item`, body, key);
const PRATINJAU_KOREKSI = (w, id, body) => w.finance.c.post(`${BASE}/${id}/koreksi-item/pratinjau`, body);

test("koreksi: pratinjau tidak menulis; terapkan = alasan + revisi + Idempotency-Key; tambah item, ubah ukuran, hapus item; unit, mirror notes, kategori order, buku revisi & audit konsisten; tanpa uang", async () => {
  const w = await siapkan();
  const p = await catat(w, { items: [KASUR, DIVAN], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  assert.equal(p.sinkron.order.revisi, 1);
  const j0 = await jejak();
  const ops = [
    { op: "ubah", no: 1, panjang: 210, spesifikasi: "Kain knit biru" },
    { op: "hapus", no: 2 },
    { op: "tambah", item: { ...SANDARAN, perluDikirim: true } },
    { op: "tambah", item: SERVICE },
  ];

  // Pratinjau: dampak lengkap, tidak ada tulisan
  const awal = await hitung();
  const pr = await PRATINJAU_KOREKSI(w, p.id, { operasi: ops, expectedRevision: 1 });
  assert.equal(pr.status, 200); assert.equal(pr.body.valid, true, JSON.stringify(pr.body));
  const d = pr.body.dampak;
  assert.deepEqual([d.revisiSekarang, d.revisiBaru], [1, 2]);
  assert.deepEqual(d.kategoriOrder, { sebelum: "BARU", sesudah: "CAMPURAN" });
  assert.deepEqual([d.item.ditambah.length, d.item.dihapus.length, d.item.diubah.length], [2, 1, 1]);
  assert.equal(d.unit.dibuat, 2); assert.equal(d.unit.dibatalkan.length, 1);
  assert.ok(d.tidakDibuat.some((t) => /Payment/.test(t)));
  assert.deepEqual(await hitung(), awal); assert.equal(await testPrisma.pkrItemRevision.count(), 1);

  // Wajib: Idempotency-Key, alasan, revisi
  const tanpaKunci = await w.finance.c.post(`${BASE}/${p.id}/koreksi-item`, { operasi: ops, expectedRevision: 1, alasan: "Pembeli menambah item" });
  assert.equal(tanpaKunci.status, 428); assert.equal(tanpaKunci.body.code, "IDEMPOTENCY_KEY_REQUIRED");
  const tanpaAlasan = await KOREKSI(w, p.id, { operasi: ops, expectedRevision: 1, alasan: "x" });
  assert.equal(tanpaAlasan.status, 400); assert.equal(tanpaAlasan.body.code, "ALASAN_WAJIB");
  const tanpaRevisi = await KOREKSI(w, p.id, { operasi: ops, alasan: "Pembeli menambah item" });
  assert.equal(tanpaRevisi.status, 400); assert.equal(tanpaRevisi.body.code, "REVISI_WAJIB");
  assert.deepEqual(await hitung(), awal, "penolakan = tidak ada yang berubah");

  const kunciA = kunci();
  const r = await KOREKSI(w, p.id, { operasi: ops, expectedRevision: 1, alasan: "Pembeli menambah sandaran dan service kasur lama" }, kunciA);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.revisi, 2);
  assert.equal(r.body.sinkron.order.kategori, "CAMPURAN"); assert.equal(r.body.sinkron.order.revisi, 2);
  const o = await testPrisma.order.findUnique({ where: { id: order.id }, include: { pkrItems: { orderBy: { seq: "asc" } }, units: { orderBy: { seq: "asc" } } } });
  assert.equal(o.category, "CAMPURAN"); assert.equal(o.quantity, 3);
  assert.deepEqual(o.pkrItems.map((i) => [i.seq, i.categoryCode, !!i.removedAt, i.qty]), [[1, "KASUR_BARU", false, 1], [2, "DIVAN_BOX", true, 1], [3, "SANDARAN", false, 1], [4, "SERVICE_UPGRADE", false, 1]]);
  assert.equal(Number(o.pkrItems[0].lengthCm), 210);
  assert.equal(o.pkrItems[1].removedReason, "Pembeli menambah sandaran dan service kasur lama");
  assert.deepEqual(o.units.map((u) => [u.seq, u.status, u.workCategory]), [[1, "RECEIVED", "BARU"], [2, "CANCELLED", "BARU"], [3, "RECEIVED", "BARU"], [4, "AWAITING_PICKUP", "LAYANAN"]]);
  assert.equal(o.units[0].ukuran, "210 × 160 × 20 cm", "ukuran unit ikut");
  const mirror = JSON.parse(o.notes).pkrItems;
  assert.deepEqual(mirror.map((i) => i.no), [1, 3, 4]);
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id, type: "PICKUP" } }), 1, "unit service baru -> satu job pickup");
  assert.equal(o.status, "PROCESSING", "status order tidak dimundurkan oleh koreksi");

  const rev = await testPrisma.pkrItemRevision.findMany({ where: { orderId: order.id }, orderBy: { revision: "asc" } });
  assert.deepEqual(rev.map((x) => [x.revision, x.kind]), [[1, "DIBUAT"], [2, "DIKOREKSI"]]);
  assert.equal(rev[1].reason, "Pembeli menambah sandaran dan service kasur lama");
  assert.equal(rev[1].beforeItems.length, 2); assert.equal(rev[1].afterItems.filter((i) => !i.dihapus).length, 3);
  assert.equal(rev[1].actorId, w.finance.id); assert.equal(rev[1].idempotencyKey, kunciA["Idempotency-Key"]);
  const aud = await testPrisma.activityEvent.findMany({ where: { eventType: "PKR_ORDER_SINKRON", entityType: "order" }, orderBy: { createdAt: "asc" } });
  assert.ok(aud.some((a) => a.metadata.aksi === "dikoreksi" && a.metadata.revisi === 2 && /Pembeli menambah/.test(a.metadata.alasan)));

  const j = await jejak();
  assert.deepEqual(j, j0, "koreksi tidak menyentuh uang: tidak ada Payment/invoice/OrderItem/jurnal baru");

  // Buku revisi append-only
  await assert.rejects(() => testPrisma.pkrItemRevision.update({ where: { id: rev[0].id }, data: { reason: "diubah" } }), /append-only/);
  await assert.rejects(() => testPrisma.pkrItemRevision.delete({ where: { id: rev[0].id } }), /append-only/);

  // Nomor item tidak dipakai ulang: item berikutnya bernomor 5
  const lagi = await KOREKSI(w, p.id, { operasi: [{ op: "tambah", item: { ...DIVAN, lebar: 140 } }], expectedRevision: 2, alasan: "Tambah divan kecil" });
  assert.equal(lagi.status, 201, JSON.stringify(lagi.body));
  assert.equal((await testPrisma.pkrOrderItem.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" } })).map((i) => i.seq).join(","), "1,2,3,4,5");
});

test("koreksi: revisi optimistis (409 bila sudah berubah), replay kunci sama = hasil sama tanpa efek ganda, kunci sama isi beda = 409; paralel dengan revisi sama = tepat SATU yang menang", async () => {
  const w = await siapkan();
  const p = await catat(w, { items: [KASUR], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  const body = { operasi: [{ op: "ubah", no: 1, jumlah: 2 }], expectedRevision: 1, alasan: "Pembeli minta dua kasur" };
  const k = kunci();
  const a = await KOREKSI(w, p.id, body, k);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const ulang = await KOREKSI(w, p.id, body, k); // lapis HTTP (middleware Idempotency-Key) memutar ulang respons pertama
  assert.ok([200, 201].includes(ulang.status)); assert.equal(ulang.body.revisi, 2);
  assert.equal((await unitDi(order.id)).filter((u) => u.status !== "CANCELLED").length, 2, "replay tidak menambah unit lagi");
  const beda = await KOREKSI(w, p.id, { ...body, operasi: [{ op: "ubah", no: 1, jumlah: 3 }] }, k);
  assert.ok([409, 422].includes(beda.status), `kunci sama isi beda harus ditolak: ${beda.status}`); // middleware HTTP (422) atau lapis layanan (409)

  // Revisi usang
  const usang = await KOREKSI(w, p.id, { operasi: [{ op: "ubah", no: 1, jumlah: 1 }], expectedRevision: 1, alasan: "Dari layar lama" });
  assert.equal(usang.status, 409); assert.equal(usang.body.code, "REVISI_BERUBAH"); assert.equal(usang.body.revisiSaatIni, 2);

  // Paralel: dua koreksi berbeda dari revisi 2 -> satu menang, satu 409; unit sesuai pemenang
  const [x, y] = await Promise.all([
    KOREKSI(w, p.id, { operasi: [{ op: "ubah", no: 1, jumlah: 3 }], expectedRevision: 2, alasan: "Paralel pertama" }),
    KOREKSI(w, p.id, { operasi: [{ op: "ubah", no: 1, jumlah: 4 }], expectedRevision: 2, alasan: "Paralel kedua" }),
  ]);
  assert.deepEqual([x.status, y.status].sort(), [201, 409]);
  const kalah = x.status === 409 ? x : y;
  assert.equal(kalah.body.code, "REVISI_BERUBAH");
  const aktif = (await unitDi(order.id)).filter((u) => u.status !== "CANCELLED");
  assert.equal(aktif.length, x.status === 201 ? 3 : 4);
  assert.equal(await testPrisma.pkrItemRevision.count({ where: { orderId: order.id } }), 3);
});

test("koreksi: jumlah turun membatalkan unit bernomor tertinggi (job pickup yang kosong dibatalkan); item/unit yang sudah dijadwalkan/diproses TERKUNCI dengan arahan pembatalan resmi, item lain tetap bisa dikoreksi; atomik", async () => {
  const w = await siapkan();
  const p = await catat(w, { items: [{ ...SERVICE, jumlah: 2 }, KASUR, DIVAN], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  let unit = await unitDi(order.id);
  assert.equal((await testPrisma.job.findMany({ where: { orderId: order.id, type: "PICKUP" }, include: { units: true } }))[0].units.length, 2);

  // Jumlah service 2 -> 1: unit #2 dibatalkan dan keluar dari job pickup
  const turun = await KOREKSI(w, p.id, { operasi: [{ op: "ubah", no: 1, jumlah: 1 }], expectedRevision: 1, alasan: "Hanya satu kasur yang diservis" });
  assert.equal(turun.status, 201, JSON.stringify(turun.body));
  unit = await unitDi(order.id);
  assert.deepEqual(unit.map((u) => [u.seq, u.status]), [[1, "AWAITING_PICKUP"], [2, "CANCELLED"], [3, "RECEIVED"], [4, "RECEIVED"]]);
  assert.equal((await testPrisma.job.findMany({ where: { orderId: order.id, type: "PICKUP" }, include: { units: true } }))[0].units.length, 1);

  // Hapus item service terakhir -> job pickup kosong dibatalkan lewat jalur baku (tombstone)
  const hapus = await KOREKSI(w, p.id, { operasi: [{ op: "hapus", no: 1 }], expectedRevision: 2, alasan: "Service dibatalkan pembeli" });
  assert.equal(hapus.status, 201, JSON.stringify(hapus.body));
  const job = await testPrisma.job.findFirst({ where: { orderId: order.id, type: "PICKUP" } });
  assert.equal(job.status, "FAILED"); assert.equal(await testPrisma.deliveryJobCancellation.count({ where: { jobId: job.id } }), 1);
  assert.equal((await testPrisma.order.findUnique({ where: { id: order.id } })).category, "BARU", "kategori kembali BARU");

  // Terkunci: kasur (item 2) mulai diproduksi -> koreksi item 2 diblokir, divan (item 3) tetap bisa; satu permintaan campuran GAGAL ATOMIK
  await testPrisma.unit.update({ where: { id: unit[2].id }, data: { status: "IN_PRODUCTION" } });
  const blok = await KOREKSI(w, p.id, { operasi: [{ op: "ubah", no: 3, panjang: 190 }, { op: "ubah", no: 2, panjang: 205 }], expectedRevision: 3, alasan: "Ubah ukuran dua item" });
  assert.equal(blok.status, 409); assert.equal(blok.body.code, "ITEM_TERKUNCI");
  assert.match(blok.body.error, /Item 2/); assert.match(blok.body.petunjuk, /pembatalan resmi/i);
  const tetap = await testPrisma.pkrOrderItem.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" } });
  assert.equal(Number(tetap.find((i) => i.seq === 3).lengthCm), 200, "item 3 TIDAK ikut berubah (atomik)");
  const pr = await PRATINJAU_KOREKSI(w, p.id, { operasi: [{ op: "ubah", no: 2, panjang: 205 }], expectedRevision: 3 });
  assert.equal(pr.body.valid, false); assert.equal(pr.body.galat.kode, "ITEM_TERKUNCI");
  const ok = await KOREKSI(w, p.id, { operasi: [{ op: "ubah", no: 3, panjang: 190 }], expectedRevision: 3, alasan: "Divan lebih pendek" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  // Unit dengan Run/jadwal Produksi juga terkunci
  const run = await testPrisma.productionRun.create({ data: { unitId: unit[3].id, kind: "NEW_PRODUCT", status: "ACTIVE", currentPhase: "PROCESS", revision: 1 } });
  assert.ok(run.id);
  const blokRun = await KOREKSI(w, p.id, { operasi: [{ op: "hapus", no: 3 }], expectedRevision: 4, alasan: "Hapus divan" });
  assert.equal(blokRun.status, 409); assert.equal(blokRun.body.code, "ITEM_TERKUNCI"); assert.match(blokRun.body.error, /dijadwalkan\/dibuka di Produksi/);
});

test("koreksi: order lama (tanpa daftar item) ditolak dengan arahan; hasil akhir semua item dihapus ditolak; duplikat & batas unit tetap berlaku; kategori tidak bisa diubah", async () => {
  const w = await siapkan();
  const lama = await catat(w, { kategori: "BARU", jumlahUnit: 1, merk: "Sano", ukuran: "160 x 200", perluDikirim: true, ...ALAMAT });
  const r = await KOREKSI(w, lama.id, { operasi: [{ op: "ubah", no: 1, jumlah: 2 }], expectedRevision: 1, alasan: "Tambah satu" });
  assert.equal(r.status, 409); assert.equal(r.body.code, "KOREKSI_ORDER_LAMA");

  const p = await catat(w, { items: [KASUR], ...ALAMAT });
  const semua = await KOREKSI(w, p.id, { operasi: [{ op: "hapus", no: 1 }], expectedRevision: 1, alasan: "Hapus semua item" });
  assert.equal(semua.status, 409); assert.equal(semua.body.code, "SEMUA_ITEM_DIHAPUS");
  const dup = await KOREKSI(w, p.id, { operasi: [{ op: "tambah", item: KASUR }], expectedRevision: 1, alasan: "Tambah kasur sama" });
  assert.equal(dup.status, 400); assert.equal(dup.body.code, "ITEM_DUPLIKAT");
  const banyak = await KOREKSI(w, p.id, { operasi: [{ op: "ubah", no: 1, jumlah: 201 }], expectedRevision: 1, alasan: "Terlalu banyak" });
  assert.equal(banyak.status, 400);
  const kat = await KOREKSI(w, p.id, { operasi: [{ op: "ubah", no: 1, kategori: "DIVAN_BOX" }], expectedRevision: 1, alasan: "Ganti kategori" });
  assert.equal(kat.status, 409); assert.equal(kat.body.code, "KATEGORI_TIDAK_BISA_DIUBAH");
  const salahNo = await KOREKSI(w, p.id, { operasi: [{ op: "ubah", no: 9, jumlah: 1 }], expectedRevision: 1, alasan: "Nomor salah" });
  assert.equal(salahNo.status, 404);
  const tanpaUbah = await KOREKSI(w, p.id, { operasi: [{ op: "ubah", no: 1, panjang: 200 }], expectedRevision: 1, alasan: "Tidak berubah" });
  assert.equal(tanpaUbah.status, 400); assert.equal(tanpaUbah.body.code, "TANPA_PERUBAHAN");
  assert.equal(await testPrisma.pkrItemRevision.count({ where: { penjualanId: p.id } }), 1, "semua penolakan = tidak ada revisi baru");
  // izin: Sales tidak mengoreksi
  assert.equal((await w.sales.c.post(`${BASE}/${p.id}/koreksi-item`, { operasi: [{ op: "ubah", no: 1, jumlah: 2 }], expectedRevision: 1, alasan: "Sales mencoba" }, kunci())).status, 403);
});

// ═══ 15. Delivery: kirim sebagian eksplisit ═══
const ARMADA = "/api/armada/pkr-pengiriman";
test("kirim sebagian: aksi eksplisit (unit dipilih + alasan + Idempotency-Key); tidak ada job kedua otomatis; duplikasi/paralel dijaga; teraudit", async () => {
  const w = await siapkan();
  const dispatcher = await (async () => { const u = await createTestUser({ roles: ["DISPATCHER"] }); return { id: u.user.id, c: makeClient(server.baseUrl, u.token) }; })();
  const p = await catat(w, { items: [KASUR, DIVAN, { ...DIVAN, produkNama: "Divan Kecil", lebar: 120 }], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  const unit = await unitDi(order.id);
  await testPrisma.unit.update({ where: { id: unit[0].id }, data: { status: "READY_FOR_DELIVERY" } });
  await testPrisma.unit.update({ where: { id: unit[1].id }, data: { status: "READY_FOR_DELIVERY" } });
  for (const u of unit.slice(0, 2)) await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id, type: "DELIVERY" } }), 0, "unit ketiga belum siap: otomatis menunggu");

  const info = await dispatcher.c.get(`${ARMADA}/${order.id}`);
  assert.equal(info.status, 200);
  assert.deepEqual([info.body.ringkas.dikirim, info.body.ringkas.siap, info.body.ringkas.menunggu], [3, 2, 1]);
  assert.equal(info.body.sebagian, true); assert.match(info.body.petunjuk, /Kirim sebagian/);
  const daftar = await dispatcher.c.get(ARMADA);
  assert.ok(daftar.body.menunggu.some((m) => m.orderId === order.id));

  // Validasi
  const aksi = (body, key = kunci()) => dispatcher.c.post(`${ARMADA}/${order.id}/kirim-sebagian`, body, key);
  assert.equal((await dispatcher.c.post(`${ARMADA}/${order.id}/kirim-sebagian`, { unitIds: [unit[0].id], alasan: "Kasur dan divan berangkat dulu" })).status, 428);
  assert.equal((await aksi({ unitIds: [unit[0].id], alasan: "x" })).body.code, "ALASAN_WAJIB");
  assert.equal((await aksi({ unitIds: [], alasan: "Berangkat dulu ya" })).body.code, "UNIT_WAJIB");
  const belumSiap = await aksi({ unitIds: [unit[2].id], alasan: "Coba unit belum siap" });
  assert.equal(belumSiap.status, 409); assert.equal(belumSiap.body.code, "UNIT_BELUM_SIAP");
  assert.equal((await w.sales.c.post(`${ARMADA}/${order.id}/kirim-sebagian`, { unitIds: [unit[0].id], alasan: "Sales mencoba" }, kunci())).status, 403);
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id, type: "DELIVERY" } }), 0);

  // Berhasil: satu job berisi unit terpilih; teraudit; replay sama = job yang sama
  const k = kunci();
  const ok = await aksi({ unitIds: [unit[0].id, unit[1].id], alasan: "Pembeli butuh kasur dan divan lebih dulu" }, k);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.ditunda, [unit[2].unitCode]);
  const ulang = await aksi({ unitIds: [unit[0].id, unit[1].id], alasan: "Pembeli butuh kasur dan divan lebih dulu" }, k);
  assert.equal(ulang.status, 200); assert.equal(ulang.body.replayed, true); assert.equal(ulang.body.jobId, ok.body.jobId);
  const beda = await aksi({ unitIds: [unit[0].id], alasan: "Isi berbeda kunci sama" }, k);
  assert.equal(beda.status, 409); assert.equal(beda.body.code, "IDEMPOTENCY_KEY_DIPAKAI");
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id, type: "DELIVERY" } }), 1);
  const dup = await aksi({ unitIds: [unit[0].id], alasan: "Unit sudah di job lain" });
  assert.equal(dup.status, 409); assert.equal(dup.body.code, "UNIT_SUDAH_DI_JOB");
  const rec = await testPrisma.pkrPengirimanSebagian.findMany({ where: { orderId: order.id } });
  assert.equal(rec.length, 1); assert.equal(rec[0].actorId, dispatcher.id); assert.deepEqual(rec[0].unitCodes.sort(), [unit[0].unitCode, unit[1].unitCode].sort());
  const aud = await testPrisma.activityEvent.findMany({ where: { eventType: "PKR_ORDER_SINKRON", entityType: "order" } });
  assert.ok(aud.some((a) => a.metadata.aksi === "pengiriman_sebagian" && /kasur dan divan lebih dulu/.test(a.metadata.alasan)));

  // Unit ketiga siap kemudian: TIDAK ada job kedua otomatis (butuh aksi eksplisit lagi)
  await testPrisma.unit.update({ where: { id: unit[2].id }, data: { status: "READY_FOR_DELIVERY" } });
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, unit[2].id));
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id, type: "DELIVERY" } }), 1);
  const sisa = await aksi({ unitIds: [unit[2].id], alasan: "Divan kecil menyusul" });
  assert.equal(sisa.status, 201, JSON.stringify(sisa.body));
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id, type: "DELIVERY" } }), 2);
  assert.equal((await testPrisma.jobUnit.groupBy({ by: ["unitId"], _count: { _all: true }, where: { job: { orderId: order.id, type: "DELIVERY" } } })).every((g) => g._count._all === 1), true, "tak ada unit di dua job");
});

test("kirim sebagian: dua permintaan paralel untuk unit yang sama -> tepat satu job (tidak ada duplikasi)", async () => {
  const w = await siapkan();
  const dispatcher = await (async () => { const u = await createTestUser({ roles: ["DISPATCHER"] }); return { id: u.user.id, c: makeClient(server.baseUrl, u.token) }; })();
  const p = await catat(w, { items: [KASUR, DIVAN], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  const unit = await unitDi(order.id);
  await testPrisma.unit.update({ where: { id: unit[0].id }, data: { status: "READY_FOR_DELIVERY" } });
  const kirim = () => dispatcher.c.post(`${ARMADA}/${order.id}/kirim-sebagian`, { unitIds: [unit[0].id], alasan: "Berangkat dulu kasurnya" }, kunci());
  const [a, b] = await Promise.all([kirim(), kirim()]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id, type: "DELIVERY" } }), 1);
});

test("koreksi (lapis layanan, tanpa middleware HTTP): kunci sama + isi sama = replayed tanpa efek ganda; isi beda = 409 IDEMPOTENCY_KEY_DIPAKAI", async () => {
  const w = await siapkan();
  const p = await catat(w, { items: [KASUR], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  const arg = { penjualanId: p.id, operasi: [{ op: "ubah", no: 1, jumlah: 2 }], expectedRevision: 1, alasan: "Pembeli minta dua kasur", idempotencyKey: `svc-${randomUUID()}`, userId: w.finance.id };
  const a = await testPrisma.$transaction((tx) => terapkanKoreksi(tx, arg));
  assert.equal(a.replayed, false);
  const b = await testPrisma.$transaction((tx) => terapkanKoreksi(tx, arg));
  assert.equal(b.replayed, true); assert.equal(b.revisi, a.revisi);
  await assert.rejects(() => testPrisma.$transaction((tx) => terapkanKoreksi(tx, { ...arg, operasi: [{ op: "ubah", no: 1, jumlah: 3 }] })), (e) => e.code === "IDEMPOTENCY_KEY_DIPAKAI");
  assert.equal((await unitDi(order.id)).filter((u) => u.status !== "CANCELLED").length, 2);
  assert.equal(await testPrisma.pkrItemRevision.count({ where: { orderId: order.id } }), 2);
});

// ═══ 16. Bukti sebelum rilis: order non-PKR tak berubah, PKR lama kompatibel, sisa terlihat setelah kirim sebagian ═══
test("order CRM NON-PKR: job Delivery tetap dibuat seperti sebelumnya (per unit siap, tanpa gerbang semua-unit-siap); unit berikut ditambahkan ke job UNSCHEDULED yang sama", async () => {
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Biasa" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 1_500_000, deliveryAddress: "Jl. Kenanga 3", deliveryCity: "Depok" } });
  assert.equal(order.penjualanKaryawanId, null);
  const u1 = await testPrisma.unit.create({ data: { unitCode: `NONPKR-${randomUUID().slice(0, 8)}-U1`, orderId: order.id, seq: 1, status: "READY_FOR_DELIVERY" } });
  const u2 = await testPrisma.unit.create({ data: { unitCode: `NONPKR-${randomUUID().slice(0, 8)}-U2`, orderId: order.id, seq: 2, status: "IN_PRODUCTION" } });
  const jobKirim = () => testPrisma.job.findMany({ where: { orderId: order.id, type: "DELIVERY" }, include: { units: true } });

  // Unit 1 siap, unit 2 belum -> job langsung dibuat (perilaku lama; TIDAK menunggu unit lain)
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u1.id));
  const a = await jobKirim();
  assert.equal(a.length, 1, "order non-PKR tidak kena gerbang semua-unit-siap");
  assert.equal(a[0].status, "UNSCHEDULED"); assert.equal(a[0].addressText, "Jl. Kenanga 3, Depok");
  assert.deepEqual(a[0].units.map((x) => x.unitId), [u1.id]);

  // Panggilan ulang untuk unit yang sama tidak menggandakan
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u1.id));
  assert.equal((await jobKirim()).length, 1);

  // Unit 2 siap belakangan -> bergabung ke job UNSCHEDULED yang sama (bukan job kedua)
  await testPrisma.unit.update({ where: { id: u2.id }, data: { status: "READY_FOR_DELIVERY" } });
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u2.id));
  const b = await jobKirim();
  assert.equal(b.length, 1);
  assert.deepEqual(b[0].units.map((x) => x.unitId).sort(), [u1.id, u2.id].sort());
  // Order non-PKR tak punya jejak pengiriman sebagian
  assert.equal(await testPrisma.pkrPengirimanSebagian.count({ where: { orderId: order.id } }), 0);
});

test("PKR LAMA tanpa pkr_order_items (order dari jalur lama): terbaca lewat item virtual, kirim memakai gerbang satu-job, tabel baru tetap kosong, koreksi item ditolak dengan arahan", async () => {
  const w = await siapkan();
  const p = await catat(w, { kategori: "BARU", jumlahUnit: 2, merk: "Sano", ukuran: "160 x 200", perluDikirim: true, ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  assert.equal(await testPrisma.pkrOrderItem.count(), 0, "tidak ada baris item (data lama)");
  assert.equal(await testPrisma.pkrOrderItemUnit.count(), 0);
  assert.equal(await testPrisma.pkrItemRevision.count(), 0, "tidak ada backfill revisi");

  // Terbaca: GET detail memuat item virtual + sinkron order; tidak error
  const baca = await w.finance.c.get(`${BASE}/${p.id}`);
  assert.equal(baca.status, 200, JSON.stringify(baca.body));
  assert.equal(baca.body.sinkron.order.modeItem, false);
  assert.equal(baca.body.sinkron.items.length, 1); assert.equal(baca.body.sinkron.items[0].virtual, true);
  assert.equal(baca.body.sinkron.items[0].unit.length, 2);

  // Delivery: semua unit yang dikirim harus siap lebih dulu, lalu SATU job
  const unit = await unitDi(order.id);
  await testPrisma.unit.update({ where: { id: unit[0].id }, data: { status: "READY_FOR_DELIVERY" } });
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, unit[0].id));
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id, type: "DELIVERY" } }), 0, "menunggu unit lain yang dikirim");
  await testPrisma.unit.update({ where: { id: unit[1].id }, data: { status: "READY_FOR_DELIVERY" } });
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, unit[1].id));
  const jobs = await testPrisma.job.findMany({ where: { orderId: order.id, type: "DELIVERY" }, include: { units: true } });
  assert.equal(jobs.length, 1); assert.equal(jobs[0].units.length, 2);

  // Koreksi Item menolak order lama dengan arahan (4xx, bukan 500) dan tidak menulis apa pun
  const k = await w.finance.c.post(`${BASE}/${p.id}/koreksi-item`, { operasi: [{ op: "ubah", no: 1, jumlah: 3 }], expectedRevision: 1, alasan: "Coba koreksi order lama" }, kunci());
  assert.ok(k.status >= 400 && k.status < 500, JSON.stringify(k.body));
  assert.equal(await testPrisma.pkrItemRevision.count(), 0);
  // PKR lama murni (tanpa order) tetap terbaca
  const lama = await pkrLama(w, "PKR-01102026-009");
  const bacaLama = await w.finance.c.get(`${BASE}/${lama.id}`);
  assert.equal(bacaLama.status, 200, JSON.stringify(bacaLama.body));
});

test("setelah pengiriman sebagian: unit SISA tetap terdaftar di layar Delivery dengan aksi eksplisit berikutnya; tidak ada job otomatis/ganda; hilang hanya setelah semua unit di job", async () => {
  const w = await siapkan();
  const dispatcher = await (async () => { const u = await createTestUser({ roles: ["DISPATCHER"] }); return { id: u.user.id, c: makeClient(server.baseUrl, u.token) }; })();
  const p = await catat(w, { items: [KASUR, DIVAN, { ...DIVAN, produkNama: "Divan Kecil", lebar: 120 }], ...ALAMAT });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  const unit = await unitDi(order.id);
  const jumlahJob = () => testPrisma.job.count({ where: { orderId: order.id, type: "DELIVERY" } });
  const barisku = async () => (await dispatcher.c.get(ARMADA)).body.menunggu.find((m) => m.orderId === order.id);

  // Sebelum pengiriman sebagian: dua siap, satu menunggu -> terdaftar (tanpa job)
  for (const u of unit.slice(0, 2)) await testPrisma.unit.update({ where: { id: u.id }, data: { status: "READY_FOR_DELIVERY" } });
  for (const u of unit.slice(0, 2)) await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
  assert.equal(await jumlahJob(), 0);
  assert.ok(await barisku());

  // Kirim sebagian pertama (kasur + divan)
  const k1 = await dispatcher.c.post(`${ARMADA}/${order.id}/kirim-sebagian`, { unitIds: [unit[0].id, unit[1].id], alasan: "Berangkat dulu dua unit" }, kunci());
  assert.equal(k1.status, 201, JSON.stringify(k1.body));
  assert.equal(await jumlahJob(), 1);

  // SETELAH itu: order tetap terdaftar, menampilkan unit sisa (belum siap) dan menyebut aksi eksplisit; tidak ada job baru otomatis
  const sesudah = await barisku();
  assert.ok(sesudah, "order dengan unit sisa tidak boleh hilang dari layar Delivery setelah pengiriman sebagian");
  assert.deepEqual(sesudah.sisa.map((u) => [u.unitCode, u.siap]), [[unit[2].unitCode, false]]);
  assert.equal(sesudah.ringkas.sudahDalamJob, 2); assert.equal(sesudah.ringkas.sisa, 1);
  assert.equal(sesudah.bisaKirimSebagian, false, "unit sisa belum siap -> aksi belum aktif");
  assert.match(sesudah.petunjuk, /Tidak ada job kedua otomatis/);
  const detail = await dispatcher.c.get(`${ARMADA}/${order.id}`);
  assert.equal(detail.body.perluTindakan, true);
  assert.equal(await jumlahJob(), 1, "melihat daftar/detail tidak membuat job");

  // Unit sisa siap: tetap TIDAK ada job otomatis; barisnya kini menawarkan aksi eksplisit (bisaKirimSebagian)
  await testPrisma.unit.update({ where: { id: unit[2].id }, data: { status: "READY_FOR_DELIVERY" } });
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, unit[2].id));
  await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, unit[2].id));
  assert.equal(await jumlahJob(), 1, "tidak ada job otomatis kedua / ganda");
  const siap = await barisku();
  assert.ok(siap); assert.deepEqual(siap.sisa.map((u) => [u.unitCode, u.siap]), [[unit[2].unitCode, true]]);
  assert.equal(siap.bisaKirimSebagian, true);
  assert.match(siap.petunjuk, /Kirim sebagian/);

  // Aksi eksplisit kedua -> job kedua berisi hanya unit sisa; setelah itu order tidak lagi terdaftar
  const k2 = await dispatcher.c.post(`${ARMADA}/${order.id}/kirim-sebagian`, { unitIds: [unit[2].id], alasan: "Divan kecil menyusul" }, kunci());
  assert.equal(k2.status, 201, JSON.stringify(k2.body));
  assert.equal(await jumlahJob(), 2);
  assert.equal(await barisku(), undefined, "semua unit sudah di job -> tidak ada yang tersisa");
  assert.equal((await testPrisma.jobUnit.groupBy({ by: ["unitId"], _count: { _all: true }, where: { job: { orderId: order.id, type: "DELIVERY" } } })).every((g) => g._count._all === 1), true);
});
