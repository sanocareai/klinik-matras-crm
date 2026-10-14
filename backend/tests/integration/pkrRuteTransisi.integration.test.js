// MODE RUTE PRODUKSI TRANSISI + "Menunggu penentuan alur Produksi" + penerapan pemetaan kemudian + kesiapan FISIK Delivery, terhadap PostgreSQL sungguhan.
// Kasus acuan: PKR-11102026-005 (Indra) — order LAMA, kategori Kasur Baru, produk "Kasur Sorong 3in1 Custom", rute katalog belum dipetakan.
// Dikunci: item tetap tersimpan (harga/unit/tautan) tanpa menebak rute; tidak menandai Produksi selesai; Admin memetakan lalu menerapkan ke unit yang belum mulai (idempoten/paralel/audit);
// kesiapan fisik = pengecualian Delivery (alasan, pelaku, diaudit, tanpa mengubah status unit/jurnal/stok); unit belum siap tidak ikut job/muat/POD; pengiriman sebagian resmi;
// mode KETAT = perilaku lama; izin; order biasa tidak berubah.
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
const kunci = () => ({ "Idempotency-Key": `rt-${randomUUID()}` });
const ALAMAT = { alamat: "Jl. Mawar 5, Bekasi", kota: "Bekasi" };
const KASUR = { kategori: "KASUR_BARU", produkNama: "Kasur Sorong 3in1 Custom", jumlah: 3, panjang: 200, lebar: 100, tebal: 20, perluDikirim: true };
const DIVAN = { kategori: "DIVAN_BOX", produkNama: "Divan Laci", jumlah: 1, panjang: 200, lebar: 100, tinggi: 30, perluDikirim: true };

async function siapkan({ petakanKasur = false } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const seller = await testPrisma.user.create({ data: { name: "Kemal Uji", email: `kemal-${randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const peran = async (r) => { const u = await createTestUser({ roles: [r] }); return { id: u.user.id, c: makeClient(server.baseUrl, u.token) }; };
  const KAT = {
    KASUR_BARU: ["Kasur Baru", "KASUR", "BARU", 10, { productLine: "KASUR", productType: petakanKasur ? "KASUR_SEHAT" : null }],
    DIVAN_BOX: ["Divan/Box", "DIVAN", "BARU", 30, { productLine: "DIVAN", productType: "DIVAN_UTAMA" }],
    CUSTOM_LAINNYA: ["Produk Custom Lainnya", "CUSTOM", "BARU", 60, {}],
  };
  await testPrisma.pkrItemCategory.deleteMany({ where: { code: { notIn: Object.keys(KAT) } } });
  for (const [code, [name, shape, workKind, sortOrder, rute]] of Object.entries(KAT)) {
    const peta = { ...rute, productionServiceId: null };
    await testPrisma.pkrItemCategory.upsert({ where: { code }, update: { name, shape, workKind, sortOrder, active: true, ...peta }, create: { code, name, shape, workKind, sortOrder, ...peta } });
  }
  return { seller, admin: await peran("ADMIN"), finance: await peran("FINANCE"), sales: await peran("SALES"), dispatcher: await peran("DISPATCHER"), driver: await peran("DRIVER") };
}
const badan = (w, orderCrm, extra = {}) => ({ date: "2026-10-11", sellerId: w.seller.id, buyerName: "Pak Indra Antariksa (projek kos)", items: [{ name: "Kasur Sorong 3in1 Custom", quantity: 3, unitPrice: 2_400_000 }], orderCrm, ...extra });
const catat = async (w, orderCrm, key = kunci()) => { const r = await w.finance.c.post(BASE, badan(w, orderCrm), key); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; };
const orderDari = (pkrId) => testPrisma.order.findFirst({ where: { penjualanKaryawanId: pkrId } });
const unitDi = (orderId) => testPrisma.unit.findMany({ where: { orderId }, orderBy: { seq: "asc" } });
const setMode = (m) => testPrisma.finSetting.upsert({ where: { key: "PRODUKSI_RUTE_MODE" }, create: { key: "PRODUKSI_RUTE_MODE", value: m }, update: { value: m } });
const jejak = async () => ({
  jurnal: await testPrisma.finJournalEntry.count(), payment: await testPrisma.payment.count(), invoice: await testPrisma.invoice.count(), stok: await testPrisma.stockMovement.count(),
  bahan: await testPrisma.materialIssue.count(), pkr: await testPrisma.finPenjualanKaryawan.count(), order: await testPrisma.order.count(), unit: await testPrisma.unit.count(), job: await testPrisma.job.count(),
});

test("1. TRANSISI (default): item tanpa rute TETAP tersimpan — harga, 3 unit Indra, tautan; status 'Menunggu penentuan alur Produksi'; Produksi TIDAK ditandai selesai; replay idempoten", async () => {
  const w = await siapkan();
  const pr = await w.finance.c.post(`${BASE}/order-crm/pratinjau`, { orderCrm: { items: [KASUR], ...ALAMAT } });
  assert.equal(pr.status, 200, JSON.stringify(pr.body));
  assert.equal(pr.body.valid, true, "mode transisi: bukan galat");
  assert.ok(pr.body.peringatan.some((x) => x.kode === "MENUNGGU_ALUR_PRODUKSI" && /Menunggu penentuan alur Produksi/.test(x.pesan) && /Katalog Item PKR/.test(x.pesan)));
  assert.equal(pr.body.items[0].menungguAlur, true);
  const h = kunci();
  const a = await catat(w, { items: [KASUR], ...ALAMAT }, h);
  const ulang = await w.finance.c.post(BASE, badan(w, { items: [KASUR], ...ALAMAT }), h);
  assert.ok([200, 201].includes(ulang.status));
  const order = await orderDari(a.id);
  const unit = await unitDi(order.id);
  assert.equal(unit.length, 3);
  assert.equal(await testPrisma.finPenjualanKaryawan.count(), 1, "replay tidak menggandakan PKR");
  assert.equal(await testPrisma.pkrOrderItemUnit.count(), 3, "3 tautan unit-item, tidak berlipat");
  assert.ok(unit.every((u) => u.status === "RECEIVED"), "tidak ditandai selesai/siap");
  assert.ok(unit.every((u) => u.productType === null), "rute tidak ditebak");
  const sinkron = a.sinkron;
  assert.equal(sinkron.ringkasUnit.menungguAlur, 3);
  assert.ok(sinkron.unitBaris.every((b) => b.alur.status === "MENUNGGU_ALUR" && b.alur.label === "Menunggu penentuan alur Produksi" && /Katalog Item PKR/.test(b.alur.tindakan)));
  assert.equal(sinkron.unitBaris.filter((b) => b.produksi.kode === "READY_FOR_DELIVERY").length, 0);
  assert.equal(await testPrisma.job.count(), 0, "belum ada job: unit belum siap");
});

test("2. Mode KETAT = perilaku lama (ditolak, tidak ada yang tertulis); mengubah mode tidak mengubah dokumen/unit lama", async () => {
  const w = await siapkan();
  const a = await catat(w, { items: [KASUR], ...ALAMAT });
  const awal = await jejak();
  const unitSebelum = JSON.stringify((await unitDi((await orderDari(a.id)).id)).map((u) => [u.id, u.status, u.productType]));
  const k = await w.admin.c.put(`${BASE}/rute-produksi/mode`, { mode: "KETAT", alasan: "Workspace Produksi sudah siap" });
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.equal(k.body.mode, "KETAT");
  const blok = await w.finance.c.post(BASE, badan(w, { items: [KASUR], ...ALAMAT }), kunci());
  assert.equal(blok.status, 400);
  assert.equal(blok.body.code, "RUTE_PRODUK_BELUM_DIPETAKAN");
  assert.deepEqual(await jejak(), awal, "ditolak = tidak ada yang tertulis");
  assert.equal(JSON.stringify((await unitDi((await orderDari(a.id)).id)).map((u) => [u.id, u.status, u.productType])), unitSebelum, "dokumen & unit lama tidak berubah oleh perubahan mode");
  const kembali = await w.admin.c.put(`${BASE}/rute-produksi/mode`, { mode: "TRANSISI", alasan: "Dibuka lagi sementara" });
  assert.equal(kembali.body.mode, "TRANSISI");
  const sama = await w.admin.c.put(`${BASE}/rute-produksi/mode`, { mode: "TRANSISI", alasan: "Sama saja dengan sebelumnya" });
  assert.equal(sama.body.berubah, false, "mode sama = tidak menulis");
});

test("3. Izin: hanya pengelola katalog (Admin/Owner) mengubah mode & menerapkan alur; Finance/Sales/Dispatcher/Driver ditolak; alasan wajib; mode tak dikenal ditolak", async () => {
  const w = await siapkan();
  for (const c of [w.finance.c, w.sales.c, w.dispatcher.c, w.driver.c]) {
    assert.equal((await c.put(`${BASE}/rute-produksi/mode`, { mode: "KETAT", alasan: "Percobaan tidak berizin" })).status, 403);
    assert.equal((await c.post(`${BASE}/rute-produksi/terapkan`, { orderId: "x" })).status, 403);
  }
  assert.equal((await w.admin.c.put(`${BASE}/rute-produksi/mode`, { mode: "KETAT", alasan: "abc" })).status, 400);
  assert.equal((await w.admin.c.put(`${BASE}/rute-produksi/mode`, { mode: "LIAR", alasan: "Mode tidak dikenal" })).status, 400);
  assert.equal((await w.finance.c.get(`${BASE}/rute-produksi/mode`)).body.mode, "TRANSISI", "Finance boleh MEMBACA mode");
  const aktif = await testPrisma.activityEvent.count({ where: { entityId: "PRODUKSI_RUTE_MODE" } });
  assert.equal(aktif, 0, "percobaan gagal tidak tercatat sebagai perubahan");
});

test("4. Pemetaan KEMUDIAN: Admin memetakan rute → pratinjau (3 unit Indra) → terapkan hanya ke unit yang BELUM mulai; idempoten, paralel, audit; status/jurnal/stok tidak berubah", async () => {
  const w = await siapkan();
  const a = await catat(w, { items: [KASUR, DIVAN], ...ALAMAT });
  const order = await orderDari(a.id);
  const pra0 = await w.admin.c.post(`${BASE}/rute-produksi/pratinjau`, { orderId: order.id });
  assert.equal(pra0.status, 200, JSON.stringify(pra0.body));
  assert.equal(pra0.body.status, "MENUNGGU_ALUR");
  assert.equal(pra0.body.bisaDiterapkan, false, "rute katalog masih kosong → belum ada yang bisa diterapkan");
  assert.match(pra0.body.item[0].tindakan, /Katalog Item PKR/);
  const sebelum = await jejak();
  // Admin memetakan di katalog
  const kat = await testPrisma.pkrItemCategory.findUnique({ where: { code: "KASUR_BARU" } });
  const peta = await w.admin.c.patch(`${BASE}/katalog-item/kategori/${kat.id}`, { productType: "KASUR_SEHAT" });
  assert.equal(peta.status, 200, JSON.stringify(peta.body));
  // satu unit sudah mulai → dilewati
  const unit = await unitDi(order.id);
  const kasurUnit = unit.filter((u) => u.merk === "Kasur Sorong 3in1 Custom");
  await testPrisma.unit.update({ where: { id: kasurUnit[2].id }, data: { status: "IN_PRODUCTION" } });
  const pra = await w.admin.c.post(`${BASE}/rute-produksi/pratinjau`, { orderId: order.id });
  assert.equal(pra.body.bisaDiterapkan, true);
  assert.deepEqual(pra.body.item[0].akanDiterapkan, [kasurUnit[0].unitCode, kasurUnit[1].unitCode]);
  assert.deepEqual(pra.body.item[0].dilewati.map((d) => d.unit), [kasurUnit[2].unitCode]);
  assert.ok((await unitDi(order.id)).every((u) => u.productType === null || u.merk === "Divan Laci"), "pratinjau tidak menulis");
  // terapkan paralel dua kali → hasil sama, tertulis sekali
  const [r1, r2] = await Promise.all([1, 2].map(() => w.admin.c.post(`${BASE}/rute-produksi/terapkan`, { orderId: order.id, alasan: "Rute Kasur Sorong sudah dipetakan" })));
  assert.equal(r1.status, 200, JSON.stringify(r1.body)); assert.equal(r2.status, 200);
  assert.equal([r1, r2].filter((r) => r.body.berubah).length, 1, "tepat satu yang menulis");
  const sesudah = await unitDi(order.id);
  const k2 = sesudah.filter((u) => u.merk === "Kasur Sorong 3in1 Custom");
  assert.deepEqual(k2.map((u) => u.productType), ["KASUR_SEHAT", "KASUR_SEHAT", null], "unit yang sudah mulai TIDAK disentuh");
  assert.deepEqual(sesudah.map((u) => u.status), [...unit.map((u) => u.status).map((st, i) => (i === unit.findIndex((x) => x.id === kasurUnit[2].id) ? "IN_PRODUCTION" : st))], "status tidak diubah oleh penerapan (selain yang diubah tes)");
  const j = await jejak();
  assert.deepEqual({ ...j, job: sebelum.job }, { ...sebelum, job: sebelum.job }, "jurnal/payment/stok tidak berubah");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: order.id, eventType: "PKR_ORDER_SINKRON" } }) >= 1, true);
  const log = await testPrisma.activityEvent.findFirst({ where: { entityId: order.id }, orderBy: { createdAt: "desc" } });
  assert.equal(log.metadata.aksi, "alur_diterapkan");
  assert.equal(log.actorId, w.admin.id);
  // replay: tidak ada yang berubah lagi
  const ulang = await w.admin.c.post(`${BASE}/rute-produksi/terapkan`, { orderId: order.id });
  assert.equal(ulang.body.berubah, false);
  const rm = await w.admin.c.get(`${BASE}/rute-produksi/menunggu`);
  assert.equal(rm.status, 200);
  assert.ok(rm.body.order.every((o) => o.orderId !== order.id) || rm.body.order.find((o) => o.orderId === order.id).jumlahUnitAkanDiterapkan === 0);
});

test("5. KOREKSI ORDER 'Tambahan permintaan customer' pada order LAMA (kasus Indra): item tanpa rute tersimpan dengan peringatan; unit baru dibuat tanpa menebak rute", async () => {
  const w = await siapkan();
  const lama = await w.finance.c.post(BASE, badan(w, { kategori: "BARU", jumlahUnit: 3, merk: "Kasur Sorong 3in1 custom", ukuran: "100 x 200", perluDikirim: true, ...ALAMAT }), kunci());
  assert.equal(lama.status, 201, JSON.stringify(lama.body));
  const order = await orderDari(lama.body.id);
  const unitAwal = await unitDi(order.id);
  const tambah = { jenis: "TAMBAHAN", tambahan: [{ pemenuhan: "PRODUKSI_BARU", kategori: "KASUR_BARU", produkNama: "Kasur Sorong 3in1 Custom", jumlah: 1, harga: 2_400_000, panjang: 200, lebar: 100, tebal: 20, perluDikirim: true }] };
  const kem = await w.finance.c.get(`${BASE}/${lama.body.id}/koreksi-order`);
  assert.equal(kem.status, 200, JSON.stringify(kem.body));
  const pra = await w.finance.c.post(`${BASE}/${lama.body.id}/koreksi-order/pratinjau`, { ...tambah, expectedRevision: kem.body.revisi, alasan: "Customer menambah satu kasur" });
  assert.equal(pra.status, 200, JSON.stringify(pra.body));
  assert.notEqual(pra.body.valid, false, JSON.stringify(pra.body.galat));
  const ap = await w.finance.c.post(`${BASE}/${lama.body.id}/koreksi-order`, { ...tambah, expectedRevision: kem.body.revisi, alasan: "Customer menambah satu kasur" }, kunci());
  assert.ok([200, 201].includes(ap.status), JSON.stringify(ap.body));
  const unit = await unitDi(order.id);
  assert.equal(unit.length, unitAwal.length + 1, "unit tambahan dibuat; unit lama tidak disentuh");
  const baru = unit.find((u) => !unitAwal.some((x) => x.id === u.id));
  assert.equal(baru.status, "RECEIVED"); assert.equal(baru.productType, null, "rute tidak ditebak");
  assert.deepEqual(unitAwal.map((u) => [u.id, u.status]), unit.filter((u) => unitAwal.some((x) => x.id === u.id)).map((u) => [u.id, u.status]));
});

test("6. Kesiapan FISIK: unit belum siap tidak ikut job/muat/POD; konfirmasi (alasan, pelaku, diaudit) membuat job gabungan; status unit & jurnal tidak berubah; replay idempoten", async () => {
  const w = await siapkan();
  const a = await catat(w, { items: [KASUR], ...ALAMAT });
  const order = await orderDari(a.id);
  const unit = await unitDi(order.id);
  assert.equal(await testPrisma.job.count(), 0);
  const j0 = await jejak();
  // tanpa alasan / tanpa kunci / peran tak berizin → ditolak
  assert.equal((await w.dispatcher.c.post(`/api/armada/orders/${order.id}/kesiapan-fisik`, { unitIds: unit.map((u) => u.id), alasan: "ab" }, kunci())).status, 400);
  assert.equal((await w.dispatcher.c.post(`/api/armada/orders/${order.id}/kesiapan-fisik`, { unitIds: unit.map((u) => u.id), alasan: "Barang jadi di workshop" })).status, 428);
  assert.equal((await w.sales.c.post(`/api/armada/orders/${order.id}/kesiapan-fisik`, { unitIds: unit.map((u) => u.id), alasan: "Barang jadi di workshop" }, kunci())).status, 403);
  assert.equal((await w.driver.c.post(`/api/armada/orders/${order.id}/kesiapan-fisik`, { unitIds: unit.map((u) => u.id), alasan: "Barang jadi di workshop" }, kunci())).status, 403);
  assert.equal(await testPrisma.deliveryExecutionEvent.count({ where: { action: "UNIT_READY_PHYSICAL" } }), 0);
  // dua dari tiga unit nyata siap: job gabungan MENUNGGU unit ketiga (keputusan Owner), belum ada job
  const h = kunci();
  const dua = [unit[0].id, unit[1].id];
  const ok = await w.dispatcher.c.post(`/api/armada/orders/${order.id}/kesiapan-fisik`, { unitIds: dua, alasan: "U1 & U2 sudah jadi dan ditimbang di workshop", bukti: "foto grup Produksi 14 Okt" }, h);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const ulang = await w.dispatcher.c.post(`/api/armada/orders/${order.id}/kesiapan-fisik`, { unitIds: dua, alasan: "U1 & U2 sudah jadi dan ditimbang di workshop", bukti: "foto grup Produksi 14 Okt" }, h);
  assert.equal(ulang.status, 200); assert.equal(ulang.body.replayed, true);
  assert.equal(await testPrisma.deliveryExecutionEvent.count({ where: { action: "UNIT_READY_PHYSICAL" } }), 1, "replay tidak menggandakan jejak");
  const ev = await testPrisma.deliveryExecutionEvent.findFirst({ where: { action: "UNIT_READY_PHYSICAL" } });
  assert.equal(ev.actorId, w.dispatcher.id); assert.ok(ev.createdAt); assert.match(ev.payload.alasan, /ditimbang/); assert.equal(ev.payload.bukti, "foto grup Produksi 14 Okt");
  assert.equal(await testPrisma.job.count(), 0, "unit ketiga belum siap → tidak ada job otomatis");
  assert.ok((await unitDi(order.id)).every((u) => u.status === "RECEIVED"), "status unit/tahap Produksi tidak diubah");
  const j1 = await jejak();
  assert.deepEqual({ ...j1 }, { ...j0 }, "tanpa jurnal/stok/payment baru");
  // pengiriman sebagian RESMI: dua unit yang siap fisik; unit ketiga tetap terlihat sebagai sisa
  const sebagian = await w.dispatcher.c.post(`/api/armada/pkr-pengiriman/${order.id}/kirim-sebagian`, { unitIds: dua, alasan: "Customer minta dua kasur dulu" }, kunci());
  assert.ok([200, 201].includes(sebagian.status), JSON.stringify(sebagian.body));
  const job = await testPrisma.job.findFirst({ where: { orderId: order.id, type: "DELIVERY" }, include: { units: true } });
  assert.deepEqual(job.units.map((x) => x.unitId).sort(), dua.sort());
  const peng = await w.dispatcher.c.get(`/api/armada/pkr-pengiriman/${order.id}`);
  assert.equal(peng.status, 200, JSON.stringify(peng.body));
  assert.deepEqual(peng.body.sisa.map((s) => s.unitCode), [unit[2].unitCode], "unit lain tetap terlihat");
  // unit ketiga (tidak siap) tidak boleh ikut job manual
  const manual = await w.dispatcher.c.post("/api/armada/jobs", { type: "DELIVERY", unitIds: [unit[2].id] });
  assert.equal(manual.status, 400, JSON.stringify(manual.body));
});

test("7. Muat & POD memeriksa unit FISIK: unit tanpa dasar siap ditolak (UNIT_BELUM_SIAP_FISIK); setelah konfirmasi fisik lolos; mode KETAT mengabaikan konfirmasi fisik", async () => {
  const w = await siapkan();
  const a = await catat(w, { items: [KASUR], ...ALAMAT });
  const order = await orderDari(a.id);
  const unit = await unitDi(order.id);
  // job dibuat lewat jalur lama (status siap Produksi) lalu salah satu unit dikembalikan ke belum-siap untuk menguji pemeriksaan muat/POD
  for (const u of unit) await testPrisma.unit.update({ where: { id: u.id }, data: { status: "READY_FOR_DELIVERY" } });
  for (const u of unit) await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
  const job = await testPrisma.job.findFirst({ where: { orderId: order.id, type: "DELIVERY" } });
  assert.ok(job);
  await testPrisma.unit.update({ where: { id: unit[2].id }, data: { status: "RECEIVED" } });
  await testPrisma.job.update({ where: { id: job.id }, data: { driverId: w.driver.id, status: "ARRIVED", arrivedAt: new Date(), scheduledDate: new Date("2026-10-15T00:00:00Z") } });
  const muat = await w.driver.c.post(`/api/armada/jobs/${job.id}/unit-load`, { semua: true });
  assert.equal(muat.status, 409, JSON.stringify(muat.body));
  assert.equal(muat.body.code, "UNIT_BELUM_SIAP_FISIK");
  assert.match(muat.body.error, new RegExp(unit[2].unitCode));
  const pod = { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Pak Indra" };
  const selesai = await w.driver.c.post(`/api/armada/jobs/${job.id}/complete`, pod, kunci());
  assert.equal(selesai.status, 409); assert.equal(selesai.body.code, "UNIT_BELUM_SIAP_FISIK");
  // konfirmasi fisik unit ketiga → muat & POD lolos
  const fisik = await w.dispatcher.c.post(`/api/armada/orders/${order.id}/kesiapan-fisik`, { unitIds: [unit[2].id], alasan: "U3 nyata sudah jadi, progres digital belum ada" }, kunci());
  assert.equal(fisik.status, 201, JSON.stringify(fisik.body));
  const muat2 = await w.driver.c.post(`/api/armada/jobs/${job.id}/unit-load`, { semua: true });
  assert.equal(muat2.status, 200, JSON.stringify(muat2.body));
  // mode KETAT: konfirmasi fisik lama diabaikan, yang baru ditolak
  await setMode("KETAT");
  const muat3 = await w.driver.c.post(`/api/armada/jobs/${job.id}/unit-load`, { semua: true });
  assert.equal(muat3.status, 409, "KETAT: hanya status Produksi yang berlaku");
  const baru = await w.dispatcher.c.post(`/api/armada/orders/${order.id}/kesiapan-fisik`, { unitIds: [unit[2].id], alasan: "Coba lagi di mode ketat" }, kunci());
  assert.equal(baru.status, 409); assert.equal(baru.body.code, "MODE_KETAT");
  await setMode("TRANSISI");
  const lolos = await w.driver.c.post(`/api/armada/jobs/${job.id}/complete`, pod, kunci());
  assert.ok([200, 201].includes(lolos.status), JSON.stringify(lolos.body));
  assert.equal((await testPrisma.job.findUnique({ where: { id: job.id } })).status, "COMPLETED");
});

test("8. Order BIASA (non-PKR) tidak berubah: tetap diproses lewat jalur lama; konfirmasi fisik ditolak; muat/POD tidak terkena pemeriksaan unit fisik", async () => {
  const w = await siapkan();
  const cust = await testPrisma.customer.create({ data: { name: "Pelanggan Biasa", phone: "6281200000555" } });
  const order = await testPrisma.order.create({ data: { customerId: cust.id, orderNumber: "NEW-BIASA-555", value: 1_500_000, category: "BARU", quantity: 1, status: "READY" } });
  const u = await testPrisma.unit.create({ data: { orderId: order.id, unitCode: "NEW-BIASA-555-U1", seq: 1, merk: "Sano", ukuran: "100 x 200", status: "RECEIVED" } });
  const fisik = await w.dispatcher.c.post(`/api/armada/orders/${order.id}/kesiapan-fisik`, { unitIds: [u.id], alasan: "Coba order biasa" }, kunci());
  assert.equal(fisik.status, 409); assert.equal(fisik.body.code, "BUKAN_ORDER_PKR");
  const job = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, status: "ARRIVED", arrivedAt: new Date(), driverId: w.driver.id, scheduledDate: new Date("2026-10-15T00:00:00Z"), sequence: 1 } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: u.id } });
  const selesai = await w.driver.c.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Bu Ani" }, kunci());
  assert.ok([200, 201].includes(selesai.status), "order biasa: tidak terkena pemeriksaan unit fisik PKR: " + JSON.stringify(selesai.body));
});
