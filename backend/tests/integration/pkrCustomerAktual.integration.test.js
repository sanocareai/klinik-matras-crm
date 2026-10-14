// CUSTOMER AKTUAL & IDENTITAS KANONIS PENJUALAN KARYAWAN, terhadap PostgreSQL sungguhan.
// Kasus nyata: PKR-11102026-005 — penjual Kemal, pembeli sebenarnya Bpk. Indra. Kolom Pelanggan di Order CRM menampilkan Kemal (profil karyawan) padahal harus Indra.
// Dikunci: (1) Order.customer = pembeli (dikenali nomor), penjual hanya sumber; (2) 1 PKR = 1 Order + U1/U2/U3, nilai Rp0, tanpa Payment/invoice/jurnal CRM;
// (3) customer lama dipakai ulang lewat nomor, nama tidak ditimpa; (4) paralel = satu Customer/Order/unit; (5) pembeli adalah karyawan = jalur eksplisit; (6) penerima berbeda;
// (7) koreksi HP/alamat/Maps tanpa jurnal/Order baru; (8) guard job (terjadwal → sinkron job yang sama, berjalan/selesai → ditolak); (9) legacy tetap terbaca & bisa dilengkapi tanpa
// mengubah PKR/Unit/Job/jurnal; (10) Produksi/Delivery tanpa harga/pembayaran; (11) pencarian lewat customer/HP/PKR/Order/Unit/penjual; (12) izin kolom + revisi + riwayat.
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

const kunci = () => ({ "Idempotency-Key": `cu-${randomUUID()}` });
const ORDER3 = { kategori: "BARU", jumlahUnit: 3, merk: "Kasur Sorong 3in1 custom", ukuran: "100 x 200", perluDikirim: true, alamat: "Jl. Mawar 5, Bekasi", kota: "Bekasi" };

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const seller = await testPrisma.user.create({ data: { name: "Kemal Uji", email: `kemal-${randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const peran = async (r) => { const u = await createTestUser({ roles: [r] }); return { id: u.user.id, c: makeClient(server.baseUrl, u.token) }; };
  return {
    seller, admin: await peran("ADMIN"), finance: await peran("FINANCE"), sales: await peran("SALES"),
    produksi: await peran("PRODUCTION_LEAD"), dispatcher: await peran("DISPATCHER"),
  };
}
const badan = (w, extra = {}) => ({
  date: "2026-10-11", sellerId: w.seller.id, buyerName: "Bpk. Indra",
  items: [{ name: "Kasur Sorong 3in1 custom", quantity: 3, unitPrice: 2_400_000 }], ...extra,
});
const buatPkr = async (w, { pembeli, orderCrm = ORDER3, extra = {}, headers = kunci() } = {}) => {
  const r = await w.finance.c.post("/api/finance/penjualan-karyawan", badan(w, { ...(pembeli !== undefined && { pembeli }), orderCrm, ...extra }), headers);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};
const daftar = async (c, q = "") => { const r = await c.get(`/api/orders?limit=100${q}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.items; };
const jejak = async () => ({
  jurnal: await testPrisma.finJournalEntry.count(), payment: await testPrisma.payment.count(), invoice: await testPrisma.invoice.count(), order: await testPrisma.order.count(),
  unit: await testPrisma.unit.count(), job: await testPrisma.job.count(), customer: await testPrisma.customer.count(), pkr: await testPrisma.finPenjualanKaryawan.count(),
});
const INDRA = { telepon: "0812-1111-2222" };

test("1. Kemal menjual kepada Indra → Order.customer = Indra; Kemal hanya karyawan penjual; 1 Order + U1/U2/U3; Rp0; tanpa profil karyawan baru", async () => {
  const w = await siapkan();
  const p = await buatPkr(w, { pembeli: INDRA });
  const order = await testPrisma.order.findFirst({ include: { customer: true, units: { orderBy: { seq: "asc" } } } });
  assert.equal(order.customer.name, "Bpk. Indra");
  assert.equal(order.customer.phone, "6281211112222", "nomor dinormalisasi");
  assert.equal(order.customer.leadSource, "PENJUALAN_KARYAWAN");
  assert.equal(order.customer.staffUserId, null, "bukan profil karyawan");
  assert.equal(order.customer.assignedSalesId, null);
  assert.equal(await testPrisma.customer.count({ where: { staffUserId: { not: null } } }), 0, "tidak ada profil karyawan yang dibuat");
  assert.equal(order.units.length, 3);
  assert.equal(order.value, 0);
  assert.equal(order.salesOwnerId, null);
  assert.equal((await jejak()).payment + (await jejak()).invoice, 0);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: { not: "PENJUALAN_KARYAWAN" } } }), 0, "tidak ada jurnal CRM");

  const it = (await daftar(w.admin.c)).find((o) => o.penjualanKaryawan?.nomor === p.nomor);
  assert.equal(it.customerName, "Bpk. Indra", "kolom Pelanggan = pembeli, bukan Kemal");
  assert.equal(it.customerPhone, "6281211112222");
  const id = it.penjualanKaryawan.identitas;
  assert.equal(id.customer.nama, "Bpk. Indra");
  assert.equal(id.karyawanPenjual.nama, "Kemal Uji");
  assert.equal(id.legacy, false);
  assert.equal(it.penjualanKaryawan.unitBaris.length, 3);
  assert.equal(it.penjualanKaryawan.pembayaran.total, 7_200_000, "nilai PKR dibaca satu kali dari ledger");
});

test("2. Customer lama ditemukan lewat nomor → dipakai ulang; nama customer lama TIDAK ditimpa; nama berbeda dilaporkan", async () => {
  const w = await siapkan();
  const lama = await testPrisma.customer.create({ data: { name: "Indra Wijaya", phone: "6281211112222", city: "Depok", leadSource: "WHATSAPP_DIRECT", assignedSalesId: w.sales.id } });
  const cari = await w.finance.c.get("/api/finance/penjualan-karyawan/pembeli/cari?telepon=0812%201111%202222");
  assert.equal(cari.status, 200);
  assert.equal(cari.body.ditemukan, true);
  assert.equal(cari.body.customer.id, lama.id);
  assert.equal(cari.body.bisaDipakai, true);
  const p = await buatPkr(w, { pembeli: INDRA });
  const order = await testPrisma.order.findFirst({ include: { customer: true } });
  assert.equal(order.customerId, lama.id);
  assert.equal(order.customer.name, "Indra Wijaya", "nama lama tidak ditimpa");
  assert.equal(order.customer.leadSource, "WHATSAPP_DIRECT", "sumber lama dipertahankan");
  assert.equal(order.customer.assignedSalesId, w.sales.id);
  assert.equal(await testPrisma.customer.count(), 1);
  assert.equal(p.sinkron.order.nomor, order.orderNumber);
});

test("3. Permintaan paralel untuk nomor yang sama → SATU Customer; replay Idempotency-Key tidak menggandakan; order-crm paralel → satu Order & unit tidak ganda", async () => {
  const w = await siapkan();
  // (a) lima PKR berbeda bersamaan dengan nomor sama → satu customer
  const hasil = await Promise.all([1, 2, 3, 4, 5].map(() => w.finance.c.post("/api/finance/penjualan-karyawan", badan(w, { pembeli: INDRA, orderCrm: { ...ORDER3, jumlahUnit: 1 } }), kunci())));
  assert.ok(hasil.every((r) => r.status === 201), JSON.stringify(hasil.map((r) => r.body?.error ?? r.status)));
  assert.equal(await testPrisma.customer.count(), 1, "satu Customer untuk satu nomor");
  assert.equal(await testPrisma.order.count(), 5);
  // (b) replay kunci sama
  const h = kunci();
  const a = await w.finance.c.post("/api/finance/penjualan-karyawan", badan(w, { pembeli: { telepon: "081299990000" }, orderCrm: ORDER3 }), h);
  const b = await w.finance.c.post("/api/finance/penjualan-karyawan", badan(w, { pembeli: { telepon: "081299990000" }, orderCrm: ORDER3 }), h);
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal(b.body.id, a.body.id);
  assert.equal(await testPrisma.customer.count(), 2);
  // (c) POST order-crm paralel pada PKR yang sudah punya order (idempoten: tidak ada order/unit/customer baru)
  const pk = await w.finance.c.post("/api/finance/penjualan-karyawan", badan(w), kunci());
  assert.equal(pk.status, 201);
  const sebelum = await jejak();
  const par = await Promise.all([1, 2, 3, 4, 5].map(() => w.finance.c.post(`/api/finance/penjualan-karyawan/${pk.body.id}/order-crm`, { spesifikasi: ORDER3, pembeli: { telepon: "081377778888" } }, kunci())));
  assert.ok(par.every((r) => [200, 201].includes(r.status)), JSON.stringify(par.map((r) => r.status)));
  assert.equal(new Set(par.map((r) => r.body.orderId)).size, 1);
  const sesudah = await jejak();
  assert.equal(sesudah.order - sebelum.order, 0);
  assert.equal(sesudah.unit - sebelum.unit, 0);
  assert.equal(sesudah.customer - sebelum.customer, 0);
});

test("4. 'Pembeli adalah karyawan' = jalur eksplisit memakai profil karyawan dan SAH (bukan legacy)", async () => {
  const w = await siapkan();
  const p = await buatPkr(w, { pembeli: { adalahKaryawan: true }, orderCrm: { ...ORDER3, jumlahUnit: 1 } });
  const order = await testPrisma.order.findFirst({ include: { customer: true } });
  assert.equal(order.customer.staffUserId, w.seller.id);
  const it = (await daftar(w.admin.c)).find((o) => o.penjualanKaryawan?.nomor === p.nomor);
  assert.equal(it.penjualanKaryawan.identitas.pembeliAdalahKaryawan, true);
  assert.equal(it.penjualanKaryawan.identitas.legacy, false);
  assert.equal(it.penjualanKaryawan.identitas.perluDilengkapi, false);
});

test("5. Penerima berbeda dari pembeli: tersimpan di kolom penerima, identitas menandai berbeda; nomor penerima dinormalisasi", async () => {
  const w = await siapkan();
  const p = await buatPkr(w, {
    pembeli: INDRA, orderCrm: { ...ORDER3, jumlahUnit: 1, penerima: { nama: "Bu Rina (adik)", telepon: "+62 813 5555 6666" }, lokasiUrl: "https://maps.app.goo.gl/AbC123", patokan: "Depan minimarket, pagar hitam", catatanDelivery: "Telepon dulu 30 menit sebelum tiba" },
  });
  const order = await testPrisma.order.findFirst();
  assert.equal(order.recipientName, "Bu Rina (adik)");
  assert.equal(order.recipientPhone, "6281355556666");
  assert.equal(order.locationUrl, "https://maps.app.goo.gl/AbC123");
  assert.equal(order.deliveryLandmark, "Depan minimarket, pagar hitam");
  assert.equal(order.deliveryNote, "Telepon dulu 30 menit sebelum tiba");
  const id = (await daftar(w.admin.c)).find((o) => o.penjualanKaryawan?.nomor === p.nomor).penjualanKaryawan.identitas;
  assert.equal(id.penerima.berbeda, true);
  assert.equal(id.customer.nama, "Bpk. Indra");
});

test("5b. Masukan tidak valid ditolak TANPA meninggalkan apa pun: nomor kosong/rusak, link bukan Google Maps", async () => {
  const w = await siapkan();
  const sebelum = await jejak();
  const cases = [
    [{ pembeli: { telepon: "" } }, /Nomor WhatsApp/],
    [{ pembeli: { telepon: "abc" } }, /nomor|Nomor/],
    [{ pembeli: INDRA, orderCrm: { ...ORDER3, lokasiUrl: "https://evil.example.com/x" } }, /Google Maps/],
    [{ pembeli: INDRA, orderCrm: { ...ORDER3, lokasiUrl: "javascript:alert(1)" } }, /https|Google Maps/],
  ];
  for (const [ekstra, pola] of cases) {
    const r = await w.finance.c.post("/api/finance/penjualan-karyawan", badan(w, { orderCrm: ORDER3, ...ekstra }), kunci());
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.match(r.body.error, pola);
  }
  assert.deepEqual(await jejak(), sebelum, "gagal = tidak ada PKR/jurnal/Customer/Order/Unit setengah jadi");
});

test("6. Koreksi HP/alamat/Maps/keluhan/catatan: tanpa jurnal, tanpa Order/Unit/Job baru; pratinjau tidak menulis; riwayat mencatat sebelum/sesudah + pelaku", async () => {
  const w = await siapkan();
  const p = await buatPkr(w, { pembeli: INDRA });
  const order = await testPrisma.order.findFirst();
  const sebelum = await jejak();
  const masukan = { pemenuhan: { alamat: "Jl. Melati 9, Bekasi", lokasiUrl: "https://www.google.com/maps/place/Bekasi", patokan: "Gang buntu", keluhan: "Pegal pinggang", catatanProduksi: "Lapisan lebih tebal", catatanDelivery: "Titip satpam" } };
  const pra = await w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/koreksi-pembeli/pratinjau`, masukan, kunci());
  assert.equal(pra.status, 200, JSON.stringify(pra.body));
  assert.ok(pra.body.perubahan.length >= 5);
  assert.equal(pra.body.dampak.jurnal, 0);
  assert.deepEqual(await jejak(), sebelum, "pratinjau tidak menulis");
  assert.equal((await testPrisma.order.findFirst()).deliveryAddress, "Jl. Mawar 5, Bekasi");

  const tanpaAlasan = await w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/koreksi-pembeli`, { ...masukan, expectedRevision: pra.body.revisi }, kunci());
  assert.equal(tanpaAlasan.status, 400);
  const tanpaKunci = await w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/koreksi-pembeli`, { ...masukan, expectedRevision: pra.body.revisi, alasan: "alamat dari customer" }, {});
  assert.ok([400, 428].includes(tanpaKunci.status), String(tanpaKunci.status));

  const h = kunci();
  const r = await w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/koreksi-pembeli`, { ...masukan, expectedRevision: pra.body.revisi, alasan: "Alamat dan keluhan dari customer" }, h);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const o2 = await testPrisma.order.findFirst();
  assert.equal(o2.deliveryAddress, "Jl. Melati 9, Bekasi");
  assert.equal(o2.locationUrl, "https://www.google.com/maps/place/Bekasi");
  assert.equal(o2.deliveryLandmark, "Gang buntu");
  assert.equal(o2.productionNote, "Lapisan lebih tebal");
  assert.equal(o2.deliveryNote, "Titip satpam");
  assert.equal(JSON.parse(o2.notes).keluhanCustomer, "Pegal pinggang");
  assert.deepEqual(await jejak(), sebelum, "tidak ada jurnal/Payment/Order/Unit/Job/Customer baru");
  assert.equal(o2.id, order.id);

  // replay: tidak menggandakan; kunci sama isi beda = 409
  const ulang = await w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/koreksi-pembeli`, { ...masukan, expectedRevision: pra.body.revisi, alasan: "Alamat dan keluhan dari customer" }, h);
  assert.ok([200, 201].includes(ulang.status), String(ulang.status)); // middleware idempotensi memutar ulang respons pertama
  assert.equal(ulang.body.revisi, r.body.revisi, "respons yang sama, tanpa revisi baru");
  assert.deepEqual(await jejak(), sebelum);
  const beda = await w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/koreksi-pembeli`, { pemenuhan: { patokan: "lain" }, expectedRevision: pra.body.revisi, alasan: "isi berbeda total", }, h);
  assert.ok([409, 422].includes(beda.status), String(beda.status));
  // revisi lama ditolak
  const basi = await w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/koreksi-pembeli`, { pemenuhan: { patokan: "baru" }, expectedRevision: pra.body.revisi, alasan: "revisi kedaluwarsa" }, kunci());
  assert.equal(basi.status, 409);
  assert.equal(basi.body.code, "REVISI_BERUBAH");

  const rw = await w.finance.c.get(`/api/finance/penjualan-karyawan/${p.id}/riwayat`);
  assert.equal(rw.status, 200);
  const rev = rw.body.revisi.find((x) => x.jenis === "PEMBELI");
  assert.ok(rev, "riwayat memuat koreksi pembeli");
  assert.equal(rev.pelaku.id, w.finance.id);
  assert.equal(rev.alasan, "Alamat dan keluhan dari customer");
  const kolom = rev.perubahan.find((x) => x.kolom === "alamat");
  assert.equal(kolom.sebelum, "Jl. Mawar 5, Bekasi");
  assert.equal(kolom.sesudah, "Jl. Melati 9, Bekasi");
});

test("7. Alamat saat job Delivery: terjadwal → job yang SAMA diperbarui (tanpa job kedua); sedang berjalan → ditolak; selesai → data historis tidak ditimpa", async () => {
  const w = await siapkan();
  const p = await buatPkr(w, { pembeli: INDRA });
  const order = await testPrisma.order.findFirst({ include: { units: true } });
  for (const u of order.units) await testPrisma.unit.update({ where: { id: u.id }, data: { status: "READY_FOR_DELIVERY" } });
  for (const u of order.units) await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
  const job = await testPrisma.job.findFirst({ where: { orderId: order.id, type: "DELIVERY" } });
  assert.ok(job);
  assert.equal(await testPrisma.job.count(), 1);
  await testPrisma.job.update({ where: { id: job.id }, data: { status: "SCHEDULED", scheduledDate: new Date("2026-10-15T00:00:00Z") } });

  const koreksi = async (alamat, ekstra = {}) => {
    const pra = await w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/koreksi-pembeli/pratinjau`, { pemenuhan: { alamat, ...ekstra } }, kunci());
    if (pra.status !== 200) return pra;
    return w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/koreksi-pembeli`, { pemenuhan: { alamat, ...ekstra }, expectedRevision: pra.body.revisi, alasan: "alamat dikoreksi customer" }, kunci());
  };
  const pra0 = await w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/koreksi-pembeli/pratinjau`, { pemenuhan: { alamat: "Jl. Baru 1" } }, kunci());
  assert.equal(pra0.status, 200);
  assert.equal(pra0.body.dampak.jobAktif, 1);
  assert.ok(pra0.body.peringatan.some((x) => /job/i.test(x)));
  const ok = await koreksi("Jl. Baru 1, Bekasi");
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const j2 = await testPrisma.job.findUnique({ where: { id: job.id } });
  assert.match(j2.addressText, /Jl\. Baru 1/);
  assert.equal(await testPrisma.job.count(), 1, "tidak membuat job kedua");
  const unitJob = await testPrisma.jobUnit.count({ where: { jobId: job.id } });
  assert.equal(unitJob, 3);

  await testPrisma.job.update({ where: { id: job.id }, data: { status: "EN_ROUTE" } });
  const tolak = await koreksi("Jl. Lain 2");
  assert.equal(tolak.status, 409);
  assert.equal(tolak.body.code, "JOB_SEDANG_BERJALAN");

  await testPrisma.job.update({ where: { id: job.id }, data: { status: "COMPLETED" } });
  const selesai = await koreksi("Jl. Historis 3");
  assert.equal(selesai.status, 409);
  assert.equal(selesai.body.code, "DELIVERY_SELESAI");
  // catatan Delivery tetap boleh setelah selesai
  const cat = await koreksi(undefined, { catatanDelivery: "Barang sudah diterima, foto di grup" });
  assert.equal(cat.status, 201, JSON.stringify(cat.body));
});

test("8. Legacy: order lama (tanpa pembeli) tetap terbaca dengan snapshot pembeli + 'belum lengkap'; Lengkapi/Tautkan Customer memindahkan order tanpa menyentuh PKR/Unit/Job/jurnal", async () => {
  const w = await siapkan();
  const p = await buatPkr(w, { pembeli: undefined }); // klien lama: tanpa objek pembeli
  const order = await testPrisma.order.findFirst({ include: { customer: true, units: { orderBy: { seq: "asc" } } } });
  assert.equal(order.customer.staffUserId, w.seller.id);
  const it = (await daftar(w.admin.c)).find((o) => o.penjualanKaryawan?.nomor === p.nomor);
  assert.equal(it.customerName, "Bpk. Indra", "legacy: snapshot pembeli, bukan nama karyawan");
  assert.equal(it.customerPhone, null);
  assert.equal(it.penjualanKaryawan.identitas.legacy, true);
  assert.equal(it.penjualanKaryawan.identitas.perluDilengkapi, true);

  const dry = await w.finance.c.get("/api/finance/penjualan-karyawan/pembeli/dry-run");
  assert.equal(dry.status, 200);
  assert.equal(dry.body.ringkasan.legacy, 1);
  assert.equal(dry.body.baris[0].nomorPkr, p.nomor);
  assert.ok(dry.body.baris[0].masihKosong.includes("telepon"));

  const sebelum = await jejak();
  const pkrSebelum = await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } });
  const unitSebelum = order.units.map((u) => u.id);
  const body = { pembeli: { telepon: "081211112222", nama: "Bpk. Indra" }, pemenuhan: { alamat: "Jl. Mawar 5, Bekasi", lokasiUrl: "https://maps.app.goo.gl/XyZ", patokan: "Pagar biru", keluhan: "Sakit punggung", catatanDelivery: "Hubungi sebelum tiba" } };
  const pra = await w.admin.c.post(`/api/finance/penjualan-karyawan/${p.id}/koreksi-pembeli/pratinjau`, body, kunci());
  assert.equal(pra.status, 200, JSON.stringify(pra.body));
  assert.equal(pra.body.dampak.customerBaru, true);
  assert.equal(pra.body.dampak.customerDiganti, true);
  assert.equal(await testPrisma.customer.count({ where: { phone: "6281211112222" } }), 0, "pratinjau tidak membuat customer");
  const r = await w.admin.c.post(`/api/finance/penjualan-karyawan/${p.id}/koreksi-pembeli`, { ...body, expectedRevision: pra.body.revisi, alasan: "Lengkapi data customer Indra" }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const o2 = await testPrisma.order.findFirst({ include: { customer: true, units: { orderBy: { seq: "asc" } } } });
  assert.equal(o2.id, order.id);
  assert.equal(o2.customer.name, "Bpk. Indra");
  assert.equal(o2.customer.phone, "6281211112222");
  assert.equal(o2.customer.leadSource, "PENJUALAN_KARYAWAN");
  assert.deepEqual(o2.units.map((u) => u.id), unitSebelum, "U1/U2/U3 tetap sama");
  const sesudah = await jejak();
  assert.equal(sesudah.customer - sebelum.customer, 1);
  assert.deepEqual({ ...sesudah, customer: 0 }, { ...sebelum, customer: 0 }, "PKR/Order/Unit/Job/Payment/jurnal tidak berubah");
  const pkrSesudah = await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } });
  assert.equal(String(pkrSesudah.total), String(pkrSebelum.total));
  assert.equal(pkrSesudah.buyerName, pkrSebelum.buyerName);
  const id = (await daftar(w.admin.c)).find((x) => x.penjualanKaryawan?.nomor === p.nomor).penjualanKaryawan.identitas;
  assert.equal(id.legacy, false);
  assert.equal(id.customer.telepon, "6281211112222");
});

test("9. KPI Sales, omzet, komisi, Payment, invoice, pendapatan CRM tidak bertambah; customer PKR tidak masuk pipeline/funnel", async () => {
  const w = await siapkan();
  await buatPkr(w, { pembeli: INDRA });
  const list = await w.admin.c.get("/api/orders?limit=100");
  assert.equal(list.body.summary.totalOrderAktif, 0, "KPI penjualan CRM tidak menghitung order PKR");
  assert.equal(list.body.summary.nilaiOrderAktif, 0);
  const pipe = await w.admin.c.get("/api/pipeline");
  if (pipe.status === 200) {
    const semua = JSON.stringify(pipe.body);
    assert.ok(!semua.includes("Bpk. Indra"), "pembeli PKR bukan lead pipeline");
  }
  assert.equal((await jejak()).payment, 0);
  assert.equal((await jejak()).invoice, 0);
});

test("10. Produksi/Delivery tidak melihat harga atau pembayaran; proyeksi identitas sesuai audiens", async () => {
  const w = await siapkan();
  const p = await buatPkr(w, { pembeli: INDRA, orderCrm: { ...ORDER3, lokasiUrl: "https://maps.app.goo.gl/AbC", patokan: "Pagar biru", keluhan: "Pegal", catatanProduksi: "Tebalkan", catatanDelivery: "Titip satpam" } });
  const prod = (await daftar(w.produksi.c)).find((o) => o.penjualanKaryawan?.nomor === p.nomor);
  assert.ok(prod, "Produksi melihat order");
  assert.equal(prod.penjualanKaryawan.pembayaran, null, "tanpa status pembayaran");
  assert.equal(prod.penjualanKaryawan.identitas.customer.nama, "Bpk. Indra");
  assert.equal(prod.penjualanKaryawan.identitas.customer.telepon, undefined, "Produksi: tanpa telepon");
  assert.equal(prod.penjualanKaryawan.identitas.alamat, undefined, "Produksi: tanpa alamat/Maps");
  assert.equal(prod.penjualanKaryawan.identitas.catatan.produksi, "Tebalkan");
  assert.equal(prod.penjualanKaryawan.identitas.catatan.delivery, undefined);
  assert.ok(!JSON.stringify(prod.penjualanKaryawan).includes("7200000"), "tanpa nominal PKR");
  const del = (await daftar(w.dispatcher.c)).find((o) => o.penjualanKaryawan?.nomor === p.nomor);
  assert.equal(del.penjualanKaryawan.pembayaran, null);
  assert.equal(del.penjualanKaryawan.identitas.alamat.lokasiUrl, "https://maps.app.goo.gl/AbC");
  assert.equal(del.penjualanKaryawan.identitas.catatan.delivery, "Titip satpam");
  assert.equal(del.penjualanKaryawan.identitas.catatan.keluhan, undefined, "Delivery: tanpa keluhan");
  const fin = (await daftar(w.admin.c)).find((o) => o.penjualanKaryawan?.nomor === p.nomor);
  assert.equal(fin.penjualanKaryawan.pembayaran.total, 7_200_000);
});

test("11. Pencarian CRM: nama customer, nomor HP, nomor PKR, nomor Order, nomor Unit, dan nama karyawan penjual", async () => {
  const w = await siapkan();
  const p = await buatPkr(w, { pembeli: INDRA });
  const order = await testPrisma.order.findFirst({ include: { units: { orderBy: { seq: "asc" } } } });
  const cari = async (s) => (await daftar(w.admin.c, `&search=${encodeURIComponent(s)}`)).filter((o) => o.penjualanKaryawan?.nomor === p.nomor).length;
  assert.equal(await cari("Indra"), 1, "nama customer");
  assert.equal(await cari("6281211112222"), 1, "nomor HP");
  assert.equal(await cari(p.nomor), 1, "nomor PKR");
  assert.equal(await cari(order.orderNumber), 1, "nomor Order");
  assert.equal(await cari(order.units[1].unitCode), 1, "nomor Unit");
  assert.equal(await cari("Kemal"), 1, "karyawan penjual");
  assert.equal(await cari("Tidak-Ada-Xyz"), 0);
});

test("12. Izin kolom: Produksi hanya catatan Produksi; Delivery hanya data pengiriman; Sales ditolak; non-PKR 404", async () => {
  const w = await siapkan();
  const p = await buatPkr(w, { pembeli: INDRA });
  const order = await testPrisma.order.findFirst();
  const pra = await w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/koreksi-pembeli/pratinjau`, { pemenuhan: { patokan: "x1" } }, kunci());
  const rev = pra.body.revisi;
  const prod = async (masukan, r = rev) => w.produksi.c.post(`/api/orders/${order.id}/pkr/koreksi-pembeli`, { ...masukan, expectedRevision: r, alasan: "catatan dari lantai produksi" }, kunci());
  const okProd = await prod({ pemenuhan: { catatanProduksi: "Gunakan busa density tinggi" } });
  assert.equal(okProd.status, 201, JSON.stringify(okProd.body));
  assert.equal((await testPrisma.order.findFirst()).productionNote, "Gunakan busa density tinggi");
  const tolakProd = await prod({ pemenuhan: { alamat: "Jl. X" } }, okProd.body.revisi);
  assert.equal(tolakProd.status, 403);
  assert.equal(tolakProd.body.code, "KOLOM_TIDAK_DIIZINKAN");
  const tolakGanti = await prod({ pembeli: { telepon: "081200001111" } }, okProd.body.revisi);
  assert.equal(tolakGanti.status, 403);
  const del = await w.dispatcher.c.post(`/api/orders/${order.id}/pkr/koreksi-pembeli`, { pemenuhan: { catatanDelivery: "Kabari sebelum tiba", patokan: "Gang 3" }, expectedRevision: okProd.body.revisi, alasan: "permintaan customer" }, kunci());
  assert.equal(del.status, 201, JSON.stringify(del.body));
  const salesTolak = await w.sales.c.post(`/api/orders/${order.id}/pkr/koreksi-pembeli`, { pemenuhan: { patokan: "z" }, expectedRevision: del.body.revisi, alasan: "tidak berizin" }, kunci());
  assert.equal(salesTolak.status, 403);
  const biasa = await testPrisma.order.create({ data: { customerId: (await testPrisma.customer.create({ data: { name: "Biasa", phone: "6281200009999" } })).id, value: 100000 } });
  const bukanPkr = await w.finance.c.post(`/api/orders/${biasa.id}/pkr/koreksi-pembeli`, { pemenuhan: { patokan: "z" }, expectedRevision: 0, alasan: "bukan order PKR" }, kunci());
  assert.equal(bukanPkr.status, 404);
});

test("13. Nomor pembeli milik profil karyawan / SPAM ditolak dengan arahan; nomor tidak dikenal diberi tahu tidak ditemukan", async () => {
  const w = await siapkan();
  await testPrisma.customer.create({ data: { name: "Spam", phone: "6281234000000", pipelineStage: "SPAM" } });
  const r = await w.finance.c.post("/api/finance/penjualan-karyawan", badan(w, { pembeli: { telepon: "081234000000" }, orderCrm: ORDER3 }), kunci());
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "PEMBELI_SPAM");
  const cari = await w.finance.c.get("/api/finance/penjualan-karyawan/pembeli/cari?telepon=08155550000");
  assert.equal(cari.body.ditemukan, false);
  assert.equal(await testPrisma.finPenjualanKaryawan.count(), 0);
});

test("14. Jumlah puluhan untuk 1 jenis barang (mis. 48 kasur): SATU order, 48 unit berurutan, satu job pengiriman menaungi semuanya; batas 200 ditegakkan", async () => {
  const w = await siapkan();
  const r = await w.finance.c.post("/api/finance/penjualan-karyawan", {
    date: "2026-10-12", sellerId: w.seller.id, buyerName: "CV Mitra Hotel", pembeli: { telepon: "081300001111" },
    items: [{ name: "Kasur Sano 100x200", quantity: 48, unitPrice: 1_000_000 }],
    orderCrm: { ...ORDER3, jumlahUnit: 48 },
  }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const order = await testPrisma.order.findFirst({ include: { units: { orderBy: { seq: "asc" } } } });
  assert.equal(order.units.length, 48);
  assert.equal(new Set(order.units.map((u) => u.unitCode)).size, 48, "kode unit unik");
  assert.equal(order.quantity, 48);
  assert.equal(r.body.sinkron.pembayaran.total, 48_000_000);
  assert.equal(await testPrisma.order.count(), 1);
  for (const u of order.units) await testPrisma.unit.update({ where: { id: u.id }, data: { status: "READY_FOR_DELIVERY" } });
  for (const u of order.units.slice(0, 5)) await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
  assert.equal(await testPrisma.job.count({ where: { type: "DELIVERY" } }), 1, "satu job untuk seluruh unit");
  const it = (await daftar(w.admin.c)).find((o) => o.penjualanKaryawan?.nomor === r.body.nomor);
  assert.equal(it.penjualanKaryawan.ringkasUnit.total, 48);
  assert.equal(it.penjualanKaryawan.unitBaris.length, 48);

  const lewat = await w.finance.c.post("/api/finance/penjualan-karyawan", {
    date: "2026-10-12", sellerId: w.seller.id, buyerName: "CV Lain", pembeli: { telepon: "081300002222" },
    items: [{ name: "Kasur", quantity: 201, unitPrice: 1000 }], orderCrm: { ...ORDER3, jumlahUnit: 201 },
  }, kunci());
  assert.equal(lewat.status, 400);
  assert.match(lewat.body.error, /1–200/);
});
