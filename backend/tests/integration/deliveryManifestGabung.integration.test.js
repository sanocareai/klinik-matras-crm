// MANIFEST DELIVERY + GABUNGKAN ORDER DUPLIKAT, terhadap PostgreSQL sungguhan. Kasus acuan: Pak Indra — NEW-11102026-023 (PKR-11102026-005, U1/U2/U3) dan
// NEW-01092026-001 (dibuat manual sebagai workaround). Dikunci: manifest 3 unit (bukan 1 kasur) di API/pesan grup/sheet; tanpa harga; gerbang muat unit; penggabungan
// tanpa DELETE/pemindahan; satu order aktif; replay/paralel; dua job aktif diblokir; nama saja bukan bukti.
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
import { formatRouteWaMessage } from "../../src/routes/armada.js";
import { buildRouteSheetImage } from "../../src/services/routeSheetImage.js";
import { manifestJob } from "../../src/services/deliveryManifestAttach.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); delete process.env.DELIVERY_UNIT_CONFIRM_REQUIRED; });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const BASE = "/api/finance/penjualan-karyawan";
const kunci = () => ({ "Idempotency-Key": `dm-${randomUUID()}` });
const ORDER3 = { kategori: "BARU", jumlahUnit: 3, merk: "Kasur Sorong 3in1 custom", ukuran: "100 x 200", perluDikirim: true, alamat: "Jl. Mawar 5, Bekasi", kota: "Bekasi" };

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const seller = await testPrisma.user.create({ data: { name: "Kemal Uji", email: `kemal-${randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const peran = async (r) => { const u = await createTestUser({ roles: [r] }); return { id: u.user.id, c: makeClient(server.baseUrl, u.token) }; };
  return { seller, bank, admin: await peran("ADMIN"), finance: await peran("FINANCE"), dispatcher: await peran("DISPATCHER"), driver: await peran("DRIVER"), sales: await peran("SALES") };
}
/** PKR Indra (order lama U1/U2/U3) + job Delivery otomatis. */
async function buatIndra(w, { telepon = "0812-1111-2222" } = {}) {
  const r = await w.finance.c.post(BASE, {
    date: "2026-10-11", sellerId: w.seller.id, buyerName: "Pak Indra Antariksa (projek kos)", pembeli: { telepon },
    items: [{ name: "Kasur Sorong 3in1 custom", quantity: 3, unitPrice: 2_400_000 }], orderCrm: ORDER3,
    pembayaran: [{ method: "TRANSFER", amount: 1_000_000, date: "2026-10-11", cashAccountId: w.bank.id }],
  }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: r.body.id }, include: { units: { orderBy: { seq: "asc" } } } });
  for (const u of order.units) await testPrisma.unit.update({ where: { id: u.id }, data: { status: "READY_FOR_DELIVERY" } });
  for (const u of order.units) await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
  const job = await testPrisma.job.findFirst({ where: { orderId: order.id, type: "DELIVERY" } });
  return { pkr: r.body, order, job };
}
/** Order manual lama (workaround Admin): customer sama, 1 unit, job Delivery SELESAI dengan foto bukti. */
async function buatManual(order, { nomor = "NEW-01092026-001", customerId = order.customerId, jobStatus = "COMPLETED", value = 2_400_000 } = {}) {
  const o = await testPrisma.order.create({
    data: { customerId, orderNumber: nomor, status: jobStatus === "COMPLETED" ? "DELIVERED" : "PROCESSING", category: "BARU", quantity: 1, value, notes: JSON.stringify({ merkKasur: "Kasur Sorong 3in1 custom", ukuranKasur: "100 × 200 cm" }) },
  });
  const u = await testPrisma.unit.create({ data: { orderId: o.id, unitCode: `${nomor}-U1`, seq: 1, merk: "Kasur Sorong 3in1 custom", ukuran: "100 x 200", status: jobStatus === "COMPLETED" ? "DELIVERED" : "READY_FOR_DELIVERY" } });
  const j = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: o.id, status: jobStatus, ...(jobStatus === "COMPLETED" && { completedAt: new Date("2026-09-03T05:00:00Z"), proofPhotoUrls: ["/media/job-photos/bukti.jpg"] }) } });
  await testPrisma.jobUnit.create({ data: { jobId: j.id, unitId: u.id } });
  return { order: o, unit: u, job: j };
}
const jejak = async () => ({
  jurnal: await testPrisma.finJournalEntry.count(), payment: await testPrisma.payment.count(), invoice: await testPrisma.invoice.count(), order: await testPrisma.order.count(),
  unit: await testPrisma.unit.count(), job: await testPrisma.job.count(), jobUnit: await testPrisma.jobUnit.count(), customer: await testPrisma.customer.count(),
  pkr: await testPrisma.finPenjualanKaryawan.count(), refund: await testPrisma.finRefund.count(),
});
const jobsApi = async (c, q = "") => { const r = await c.get(`/api/armada/jobs${q}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.jobs ?? r.body; };

test("1. Indra tetap 1 PKR, 1 Order CRM, 1 job — manifest 3 unit U1/U2/U3 (bukan satu kasur); sumber PKR dijual oleh Kemal", async () => {
  const w = await siapkan();
  const { order, job } = await buatIndra(w);
  assert.equal(await testPrisma.finPenjualanKaryawan.count(), 1);
  assert.equal(await testPrisma.order.count(), 1);
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id, type: "DELIVERY" } }), 1);
  const jobs = await jobsApi(w.dispatcher.c);
  const j = jobs.find((x) => x.id === job.id);
  assert.ok(j.manifest, "job membawa manifest");
  assert.equal(j.manifest.stop, 1);
  assert.equal(j.manifest.unit, 3);
  assert.equal(j.manifest.jenisProduk, 1);
  assert.equal(j.manifest.ringkas, "1 stop • 3 unit • 1 jenis produk");
  assert.equal(j.manifest.baris[0].qty, 3);
  assert.deepEqual(j.manifest.baris[0].unitLabel, ["U1", "U2", "U3"]);
  assert.match(j.manifest.baris[0].nama, /Kasur Sorong 3in1 custom/i);
  assert.equal(j.manifest.baris[0].ukuran, "100 × 200 cm");
  assert.equal(j.manifest.sumber.penjual, "Kemal Uji");
  assert.equal(j.manifest.sumber.label, "Penjualan Karyawan — dijual oleh Kemal Uji");
  assert.equal(j.manifest.muat.label, "Barang dimuat 0/3 unit");
});

test("2. Non-Finance (Dispatcher/Driver) tidak menerima harga/nilai/pembayaran lewat manifest", async () => {
  const w = await siapkan();
  const { job } = await buatIndra(w);
  const jobs = await jobsApi(w.dispatcher.c);
  const j = jobs.find((x) => x.id === job.id);
  const m = JSON.stringify(j.manifest);
  assert.doesNotMatch(m, /harga|price|nominal|amount|"value"|payment|piutang|subtotal/i);
  assert.doesNotMatch(m, /2400000|7200000|1000000/);
});

test("3. Pesan grup, sheet gambar, dan API memakai angka yang SAMA (3 unit, U1–U3, dijual oleh Kemal)", async () => {
  const w = await siapkan();
  const { job } = await buatIndra(w);
  const j = (await jobsApi(w.dispatcher.c)).find((x) => x.id === job.id);
  const route = { code: "RTE-UJI-01", date: "2026-10-14T00:00:00.000Z", vehicle: null, driver: null, helper: null, notes: "", manualMapsUrl: null, jobs: [j] };
  const pesan = formatRouteWaMessage(route, null);
  assert.match(pesan, /1 stop • 3 unit • 1 jenis produk/);
  assert.match(pesan, /3× Kasur Sorong 3in1 custom — 100 × 200 cm/);
  assert.match(pesan, /Unit: U1, U2, U3/);
  assert.match(pesan, /Sumber: Penjualan Karyawan — dijual oleh Kemal Uji/);
  assert.equal(manifestJob(j).unit, j.manifest.unit, "angka server = angka pesan");
  const gambar = await buildRouteSheetImage(route);
  assert.ok(Buffer.isBuffer(gambar) && gambar.length > 1000, "sheet gambar terbentuk");
});

test("4. Gerbang muat unit: konfirmasi idempoten; unit asing ditolak; driver tidak bisa menyelesaikan bila belum lengkap kecuali pengecualian beralasan", async () => {
  const w = await siapkan();
  const { job, order } = await buatIndra(w);
  const unit = await testPrisma.unit.findMany({ where: { orderId: order.id }, orderBy: { seq: "asc" } });
  // job sudah dijadwalkan (gerbang muat hanya berlaku untuk job yang sedang berjalan), driver ditugaskan
  await testPrisma.job.update({ where: { id: job.id }, data: { driverId: w.driver.id, status: "ASSIGNED", scheduledDate: new Date("2026-10-15T00:00:00Z") } });
  // konfirmasi 2 dari 3, lalu ulang (replay) — tidak menggandakan
  const a = await w.admin.c.post(`/api/armada/jobs/${job.id}/unit-load`, { unitIds: [unit[0].id, unit[1].id] });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.muat.label, "Barang dimuat 2/3 unit");
  const b = await w.admin.c.post(`/api/armada/jobs/${job.id}/unit-load`, { unitIds: [unit[0].id, unit[1].id] });
  assert.equal(b.status, 200);
  assert.equal(await testPrisma.jobUnitLoad.count({ where: { jobId: job.id } }), 2, "klik ulang tidak menggandakan");
  const asing = await w.admin.c.post(`/api/armada/jobs/${job.id}/unit-load`, { unitIds: [randomUUID()] });
  assert.equal(asing.status, 400);
  const jobs = await jobsApi(w.dispatcher.c);
  assert.equal(jobs.find((x) => x.id === job.id).manifest.muat.dimuat, 2);
  // gerbang aktif: driver pemilik job tidak bisa menyelesaikan
  process.env.DELIVERY_UNIT_CONFIRM_REQUIRED = "1";
  await testPrisma.job.update({ where: { id: job.id }, data: { status: "ARRIVED", arrivedAt: new Date() } });
  const pod = { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Pak Indra", note: "diterima" };
  const tolak = await w.driver.c.post(`/api/armada/jobs/${job.id}/complete`, pod, kunci());
  assert.equal(tolak.status, 409, JSON.stringify(tolak.body));
  assert.equal(tolak.body.code, "UNIT_BELUM_DIKONFIRMASI");
  assert.equal((await testPrisma.job.findUnique({ where: { id: job.id } })).status, "ARRIVED", "job tidak selesai");
  assert.equal(await testPrisma.unit.count({ where: { orderId: order.id, status: "DELIVERED" } }), 0);
  // pengecualian tanpa alasan tetap ditolak
  const tanpaAlasan = await w.driver.c.post(`/api/armada/jobs/${job.id}/complete`, { ...pod, pengecualianUnit: { alasan: "x" } }, kunci());
  assert.equal(tanpaAlasan.status, 409);
  // semua dikonfirmasi → lolos
  const c = await w.admin.c.post(`/api/armada/jobs/${job.id}/unit-load`, { semua: true });
  assert.equal(c.body.muat.label, "Barang dimuat 3/3 unit");
  assert.equal(c.body.muat.lengkap, true);
  const selesai = await w.driver.c.post(`/api/armada/jobs/${job.id}/complete`, pod, kunci());
  assert.ok([200, 201].includes(selesai.status), JSON.stringify(selesai.body));
  assert.equal((await testPrisma.job.findUnique({ where: { id: job.id } })).status, "COMPLETED");
});

test("5. Pengecualian resmi: alasan ≥5 menyelesaikan job dan mencatat audit UNIT_LOAD_EXCEPTION tepat sekali", async () => {
  const w = await siapkan();
  const { job } = await buatIndra(w);
  process.env.DELIVERY_UNIT_CONFIRM_REQUIRED = "1";
  await testPrisma.job.update({ where: { id: job.id }, data: { driverId: w.driver.id, status: "ARRIVED", arrivedAt: new Date(), scheduledDate: new Date("2026-10-15T00:00:00Z") } });
  const pod = { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Pak Indra", pengecualianUnit: { alasan: "Aplikasi driver offline, barang dihitung manual 3 unit" } };
  const h = kunci();
  const r = await w.driver.c.post(`/api/armada/jobs/${job.id}/complete`, pod, h);
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  assert.equal(await testPrisma.deliveryExecutionEvent.count({ where: { jobId: job.id, action: "UNIT_LOAD_EXCEPTION" } }), 1);
  const ev = await testPrisma.deliveryExecutionEvent.findFirst({ where: { jobId: job.id, action: "UNIT_LOAD_EXCEPTION" } });
  assert.match(ev.payload.alasan, /dihitung manual/);
  assert.equal(ev.payload.total, 3);
  const ulang = await w.driver.c.post(`/api/armada/jobs/${job.id}/complete`, pod, h);
  assert.ok([200, 201, 409].includes(ulang.status));
  assert.equal(await testPrisma.deliveryExecutionEvent.count({ where: { jobId: job.id, action: "UNIT_LOAD_EXCEPTION" } }), 1, "replay tidak menggandakan audit");
  assert.equal(await testPrisma.job.count({ where: { orderId: job.orderId } }), 1);
});

test("6. Tidak ada duplikat otomatis dari nama saja: customer lain bernama sama BUKAN kandidat sah (bukti kurang)", async () => {
  const w = await siapkan();
  const { order } = await buatIndra(w);
  const lain = await testPrisma.customer.create({ data: { name: "Pak Indra Antariksa (projek kos)", phone: "6289999000011", pipelineStage: "NEW" } });
  const m = await buatManual(order, { nomor: "NEW-01092026-777", customerId: lain.id, jobStatus: "SCHEDULED" });
  const pra = await w.admin.c.get(`/api/orders/gabung/pratinjau?utama=${order.id}&duplikat=${m.order.id}`);
  assert.equal(pra.status, 200, JSON.stringify(pra.body));
  assert.equal(pra.body.bukti.namaSama, true);
  assert.equal(pra.body.bukti.customerAtauTeleponSama, false);
  assert.equal(pra.body.bolehDigabung, false);
  assert.ok(pra.body.hambatan.some((h) => h.kode === "BUKTI_KURANG"));
  const kandidat = await w.admin.c.get(`/api/orders/${order.id}/kandidat-duplikat`);
  assert.equal(kandidat.status, 200);
  assert.equal(kandidat.body.kandidat.length, 0, "customer/HP berbeda → tidak diusulkan");
  const paksa = await w.admin.c.post("/api/orders/gabung", { utama: order.id, duplikat: m.order.id, alasan: "Dipaksa karena nama sama", sidikJari: pra.body.sidikJari }, kunci());
  assert.equal(paksa.status, 409);
});

test("7. Penggabungan Indra: relasi saja — tidak ada DELETE/unit/job/payment baru; satu order aktif; histori lama tetap terbaca", async () => {
  const w = await siapkan();
  const { order, job } = await buatIndra(w);
  const m = await buatManual(order);
  const sebelum = await jejak();
  const unitSebelum = (await testPrisma.unit.findMany({ orderBy: { unitCode: "asc" } })).map((u) => [u.id, u.unitCode, u.status]);
  const pra = await w.admin.c.get(`/api/orders/gabung/pratinjau?utama=${order.id}&duplikat=${m.order.id}`);
  assert.equal(pra.status, 200);
  assert.equal(pra.body.bolehDigabung, true, JSON.stringify(pra.body.hambatan));
  assert.equal(pra.body.bukti.customerAtauTeleponSama, true);
  assert.equal(pra.body.bukti.barangSerupa, true);
  assert.equal(pra.body.bukti.konteksPkr, true);
  assert.equal(pra.body.dampak.unitBaru, 0);
  assert.equal(pra.body.dampak.jobBaru, 0);
  assert.deepEqual(await jejak(), sebelum, "pratinjau tidak mengubah apa pun");
  const h = kunci();
  const r = await w.admin.c.post("/api/orders/gabung", { utama: order.id, duplikat: m.order.id, alasan: "Duplikat workaround Admin saat integrasi PKR belum benar", sidikJari: pra.body.sidikJari }, h);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(await jejak(), sebelum, "tidak ada order/unit/job/payment/invoice/jurnal/refund/customer baru atau terhapus");
  assert.deepEqual((await testPrisma.unit.findMany({ orderBy: { unitCode: "asc" } })).map((u) => [u.id, u.unitCode, u.status]), unitSebelum, "U1/U2/U3 dan unit lama utuh");
  const dup = await testPrisma.order.findUnique({ where: { id: m.order.id } });
  assert.equal(dup.mergedIntoOrderId, order.id);
  assert.equal(dup.value, 2_400_000, "nilai order lama tidak diubah (histori)");
  assert.equal((await testPrisma.job.findUnique({ where: { id: m.job.id } })).status, "COMPLETED", "job/POD lama utuh");
  // tepat satu order aktif di daftar; nomor lama menemukan order utama
  const daftar = (await w.admin.c.get("/api/orders?limit=100")).body.items;
  assert.equal(daftar.filter((o) => o.customerName?.includes("Indra")).length, 1);
  assert.equal(daftar.find((o) => o.id === order.id).riwayatOrderLama[0].nomor, "NEW-01092026-001");
  assert.equal(daftar.find((o) => o.id === order.id).riwayatOrderLama[0].job[0].status, "COMPLETED");
  const cari = (await w.admin.c.get("/api/orders?search=NEW-01092026-001&limit=100")).body.items;
  assert.deepEqual(cari.map((o) => o.id), [order.id], "pencarian nomor lama membuka order utama");
  const semua = (await w.admin.c.get("/api/orders?termasukDigabung=1&limit=100")).body.items;
  assert.equal(semua.find((o) => o.id === m.order.id).digabungKe.nomor, order.orderNumber);
  // replay: kunci sama → 200 tanpa relasi ganda; kunci beda untuk order yang sama → 409
  const ulang = await w.admin.c.post("/api/orders/gabung", { utama: order.id, duplikat: m.order.id, alasan: "Duplikat workaround Admin saat integrasi PKR belum benar", sidikJari: pra.body.sidikJari }, h);
  assert.equal(ulang.status, 200);
  assert.equal(await testPrisma.orderMerge.count(), 1);
  const beda = await w.admin.c.post("/api/orders/gabung", { utama: order.id, duplikat: m.order.id, alasan: "Percobaan kedua", sidikJari: pra.body.sidikJari }, kunci());
  assert.equal(beda.status, 409);
  assert.equal(await testPrisma.orderMerge.count(), 1);
  // job lama selesai disembunyikan dari daftar aktif Delivery, tetap ada dengan ?riwayat=1
  const aktif = await jobsApi(w.dispatcher.c);
  assert.ok(!aktif.some((x) => x.id === m.job.id));
  const riwayat = await jobsApi(w.dispatcher.c, "?riwayat=1");
  assert.ok(riwayat.some((x) => x.id === m.job.id));
  assert.ok(aktif.some((x) => x.id === job.id), "job nyata order utama tetap aktif");
});

test("8. Paralel: dua penggabungan bersamaan untuk duplikat yang sama menghasilkan SATU relasi; SALES tidak boleh; alasan wajib", async () => {
  const w = await siapkan();
  const { order } = await buatIndra(w);
  const m = await buatManual(order);
  const pra = (await w.admin.c.get(`/api/orders/gabung/pratinjau?utama=${order.id}&duplikat=${m.order.id}`)).body;
  const isi = { utama: order.id, duplikat: m.order.id, alasan: "Duplikat workaround Admin", sidikJari: pra.sidikJari };
  const hasil = await Promise.all([1, 2, 3].map(() => w.admin.c.post("/api/orders/gabung", isi, kunci())));
  const sts = hasil.map((r) => r.status).sort();
  assert.equal(sts.filter((s) => s === 201).length, 1, JSON.stringify(hasil.map((r) => r.body?.error ?? r.status)));
  assert.ok(sts.every((s) => [201, 409].includes(s)));
  assert.equal(await testPrisma.orderMerge.count(), 1);
  const sales = await w.sales.c.post("/api/orders/gabung", isi, kunci());
  assert.equal(sales.status, 403);
  const tanpaAlasan = await w.admin.c.post("/api/orders/gabung", { ...isi, alasan: "x" }, kunci());
  assert.ok([400, 409].includes(tanpaAlasan.status));
});

test("9. Dua job aktif diblokir: tidak digabung otomatis; job lain harus dibatalkan lewat alur resmi dulu", async () => {
  const w = await siapkan();
  const { order, job } = await buatIndra(w);
  const m = await buatManual(order, { jobStatus: "SCHEDULED" });
  assert.equal(job.status, "UNSCHEDULED");
  const pra = await w.admin.c.get(`/api/orders/gabung/pratinjau?utama=${order.id}&duplikat=${m.order.id}`);
  assert.equal(pra.body.bolehDigabung, false);
  const blok = pra.body.hambatan.find((h) => h.kode === "DUA_JOB_AKTIF");
  assert.ok(blok, JSON.stringify(pra.body.hambatan));
  assert.equal(blok.job.utama.length, 1);
  assert.equal(blok.job.duplikat.length, 1);
  const r = await w.admin.c.post("/api/orders/gabung", { utama: order.id, duplikat: m.order.id, alasan: "Coba gabung dua job aktif", sidikJari: pra.body.sidikJari }, kunci());
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "DUA_JOB_AKTIF");
  assert.equal(await testPrisma.order.count({ where: { mergedIntoOrderId: { not: null } } }), 0);
});

test("10. Order non-PKR dan Koreksi Order/Tambah Pesanan tidak menggandakan job/unit; manifest mengikuti unit nyata", async () => {
  const w = await siapkan();
  const { order, job } = await buatIndra(w);
  const biasa = await testPrisma.customer.create({ data: { name: "Pelanggan Biasa", phone: "6281200000222", pipelineStage: "NEW" } });
  const ob = await testPrisma.order.create({ data: { customerId: biasa.id, orderNumber: "NEW-BIASA-001", status: "PENDING", category: "BARU", quantity: 1, value: 1_500_000 } });
  const biasaSebelum = JSON.stringify(await testPrisma.order.findUnique({ where: { id: ob.id } }));
  const pkrId = (await testPrisma.finPenjualanKaryawan.findFirst()).id;
  const kem = (await w.finance.c.get(`${BASE}/${pkrId}/koreksi-order`)).body;
  const k = await w.finance.c.post(`${BASE}/${pkrId}/koreksi-order`, { jenis: "PERBAIKAN", pemenuhan: { patokan: "Pagar biru" }, expectedRevision: kem.revisi, alasan: "Patokan dilengkapi Admin" }, kunci());
  assert.equal(k.status, 201, JSON.stringify(k.body));
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id } }), 1);
  assert.equal(await testPrisma.unit.count({ where: { orderId: order.id } }), 3);
  const j = (await jobsApi(w.dispatcher.c)).find((x) => x.id === job.id);
  assert.equal(j.manifest.unit, 3);
  assert.equal(JSON.stringify(await testPrisma.order.findUnique({ where: { id: ob.id } })), biasaSebelum, "order non-PKR tidak berubah");
});
