// KOREKSI ORDER PENJUALAN KARYAWAN (satu pintu resmi), terhadap PostgreSQL sungguhan. Kasus acuan: PKR-11102026-005 (Indra) — order LAMA (tanpa daftar item), Produksi 3/3 selesai,
// Delivery terjadwal. Dikunci: PERBAIKAN salah input vs TAMBAHAN permintaan customer; matriks progres ditegakkan server; nilai lewat jurnal delta; kelebihan bayar = peringatan
// (kas tidak keluar otomatis); replay/paralel; Order CRM tetap Rp0; order non-PKR tidak berubah.
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
const kunci = () => ({ "Idempotency-Key": `ko-${randomUUID()}` });
const KATEGORI = {
  KASUR_BARU: ["Kasur Baru", "KASUR", "BARU", 10, { productLine: "KASUR", productType: "KASUR_SEHAT" }],
  DIVAN_BOX: ["Divan/Box", "DIVAN", "BARU", 30, { productLine: "DIVAN", productType: "DIVAN_UTAMA" }],
  CUSTOM_LAINNYA: ["Produk Custom Lainnya", "CUSTOM", "BARU", 60, {}],
};
const ORDER3 = { kategori: "BARU", jumlahUnit: 3, merk: "Kasur Sorong 3in1 custom", ukuran: "100 x 200", perluDikirim: true, alamat: "Jl. Mawar 5, Bekasi", kota: "Bekasi" };
const INDRA = { telepon: "0812-1111-2222" };

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const seller = await testPrisma.user.create({ data: { name: "Kemal Uji", email: `kemal-${randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const peran = async (r) => { const u = await createTestUser({ roles: [r] }); return { id: u.user.id, c: makeClient(server.baseUrl, u.token) }; };
  for (const [code, [name, shape, workKind, sortOrder, rute]] of Object.entries(KATEGORI)) {
    const peta = { ...rute, productionServiceId: null };
    await testPrisma.pkrItemCategory.upsert({ where: { code }, update: { name, shape, workKind, sortOrder, active: true, ...peta }, create: { code, name, shape, workKind, sortOrder, ...peta } });
  }
  return { seller, bank, admin: await peran("ADMIN"), finance: await peran("FINANCE"), sales: await peran("SALES") };
}
const badan = (w, extra = {}) => ({
  date: "2026-10-11", sellerId: w.seller.id, buyerName: "Bpk. Indra", items: [{ name: "Kasur Sorong 3in1 custom", quantity: 3, unitPrice: 2_400_000 }], ...extra,
});
/** Order LAMA gaya PKR-005: satu baris catatan (qty 3 × 2,4jt), order tanpa daftar item. */
const buatLama = async (w, extra = {}) => {
  const r = await w.finance.c.post(BASE, badan(w, { orderCrm: ORDER3, ...extra }), kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};
const orderDari = (pkrId) => testPrisma.order.findFirst({ where: { penjualanKaryawanId: pkrId } });
const unitDi = (orderId) => testPrisma.unit.findMany({ where: { orderId }, orderBy: { seq: "asc" } });
const revisiDi = (orderId) => testPrisma.pkrItemRevision.findMany({ where: { orderId }, orderBy: { revision: "asc" } });
const jejak = async () => ({
  jurnal: await testPrisma.finJournalEntry.count(), payment: await testPrisma.payment.count(), invoice: await testPrisma.invoice.count(), order: await testPrisma.order.count(),
  unit: await testPrisma.unit.count(), job: await testPrisma.job.count(), customer: await testPrisma.customer.count(), pkr: await testPrisma.finPenjualanKaryawan.count(),
  stok: await testPrisma.stockMovement.count(), bahan: await testPrisma.materialIssue.count(),
});
async function netPiutang(pkrId) {
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PIUTANG_KARYAWAN } });
  const e = await testPrisma.finJournalEntry.findMany({ where: { source: { in: ["PENJUALAN_KARYAWAN", "REVERSAL"] }, OR: [{ sourceId: pkrId }, { reversalOf: { sourceId: pkrId } }] }, include: { lines: true } });
  let net = 0;
  for (const x of e) for (const l of x.lines) if (l.accountId === akun.id) net += Number(l.debit) - Number(l.credit);
  return net;
}
/** Produksi 3/3 selesai + job Delivery TERJADWAL (keadaan Indra). */
async function selesaikanProduksi(order, { jadwal = true } = {}) {
  const units = (await unitDi(order.id)).filter((x) => x.status !== "CANCELLED");
  for (const u of units) await testPrisma.unit.update({ where: { id: u.id }, data: { status: "READY_FOR_DELIVERY" } });
  for (const u of units) await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
  const job = await testPrisma.job.findFirst({ where: { orderId: order.id, type: "DELIVERY" } });
  if (jadwal && job) await testPrisma.job.update({ where: { id: job.id }, data: { status: "SCHEDULED", scheduledDate: new Date("2026-10-15T00:00:00.000Z") } });
  return job;
}
const koreksi = (w, pkrId, badanKoreksi, rev, { alasan = "Data salah input dari penjual", headers = kunci(), c = w.finance.c } = {}) =>
  c.post(`${BASE}/${pkrId}/koreksi-order`, { ...badanKoreksi, expectedRevision: rev, alasan }, headers);
const kemampuan = async (w, pkrId) => { const r = await w.finance.c.get(`${BASE}/${pkrId}/koreksi-order`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const grup = (k, kode) => k.matriks.find((g) => g.kode === kode);

test("1. Koreksi order SEBELUM Produksi: merk/ukuran diperbarui langsung pada unit yang SAMA; tanpa Order/Unit/Job/jurnal baru; revisi ORDER_ADMIN sebelum→sesudah", async () => {
  const w = await siapkan();
  const p = await buatLama(w);
  const order = await orderDari(p.id);
  const k0 = await kemampuan(w, p.id);
  assert.equal(k0.progres.tahapProduksi, "BELUM_MULAI");
  assert.equal(grup(k0, "spesifikasi").mode, "LANGSUNG");
  const unitSebelum = (await unitDi(order.id)).map((u) => u.id);
  const sebelum = await jejak();
  const r = await koreksi(w, p.id, { jenis: "PERBAIKAN", spesifikasi: { merk: "Kasur Sorong Premium", ukuran: "120 x 200" } }, k0.revisi);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const sesudah = await jejak();
  assert.deepEqual(sesudah, sebelum, "tidak ada Order/Unit/Job/Payment/jurnal/stok baru");
  const unit = await unitDi(order.id);
  assert.deepEqual(unit.map((u) => u.id), unitSebelum, "unit yang SAMA");
  assert.ok(unit.every((u) => u.merk === "Kasur Sorong Premium"), JSON.stringify(unit.map((u) => u.merk)));
  const rev = (await revisiDi(order.id)).find((x) => x.kind === "ORDER_ADMIN");
  assert.ok(rev, "revisi ORDER_ADMIN tercatat");
  assert.equal(rev.reason, "Data salah input dari penjual");
  assert.ok(rev.actorId);
  assert.equal(rev.impact.mode, "LANGSUNG");
  assert.ok(rev.impact.perubahan.merk || rev.impact.perubahan.ukuran);
  assert.equal(rev.beforeItems[0].merk, "Kasur Sorong 3in1 custom");
  assert.equal(rev.afterItems[0].merk, "Kasur Sorong Premium");
});

test("2. Setelah Produksi selesai: customer, nomor, alamat, Maps, penerima, keluhan dikoreksi; job Delivery terjadwal = job yang SAMA; U1/U2/U3 tidak berubah", async () => {
  const w = await siapkan();
  const p = await buatLama(w);
  const order = await orderDari(p.id);
  const jobAwal = await selesaikanProduksi(order);
  const unitAwal = await unitDi(order.id);
  const sebelum = await jejak();
  const k = await kemampuan(w, p.id);
  assert.equal(k.progres.tahapProduksi, "SELESAI");
  assert.equal(k.progres.tahapDelivery, "TERJADWAL");
  assert.equal(grup(k, "alamat").mode, "LANGSUNG");
  const r = await koreksi(w, p.id, {
    jenis: "PERBAIKAN",
    pembeli: { telepon: "0813-2222-3333", nama: "Bpk. Indra" },
    pemenuhan: { alamat: "FP2J+98C, Jl. Serelek, Cikarawang, Bogor", kota: "Bogor", lokasiUrl: "https://maps.app.goo.gl/IndraBenar", patokan: "Pagar biru", keluhan: "Sakit pinggang", penerima: { nama: "Bu Rina", telepon: "0813-5555-6666" } },
  }, k.revisi);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const sesudah = await jejak();
  assert.equal(sesudah.job, sebelum.job, "tidak ada job kedua");
  assert.equal(sesudah.unit, sebelum.unit);
  assert.equal(sesudah.order, sebelum.order);
  assert.equal(sesudah.jurnal, sebelum.jurnal);
  assert.equal(sesudah.payment, sebelum.payment);
  const jobSesudah = await testPrisma.job.findUnique({ where: { id: jobAwal.id } });
  assert.match(jobSesudah.addressText, /Cikarawang/, "alamat job yang sama ikut berubah");
  const unitSesudah = await unitDi(order.id);
  assert.deepEqual(unitSesudah.map((u) => [u.unitCode, u.status]), unitAwal.map((u) => [u.unitCode, u.status]));
  const o2 = await testPrisma.order.findUnique({ where: { id: order.id }, include: { customer: true } });
  assert.equal(o2.customer.phone, "6281322223333");
  assert.equal(o2.value, 0, "Order CRM tetap Rp0");
});

test("3. Alamat terjadwal memperbarui job yang sama dan pratinjau memuat dampak ke Delivery; job tidak dibuat ulang", async () => {
  const w = await siapkan();
  const p = await buatLama(w);
  const order = await orderDari(p.id);
  const job = await selesaikanProduksi(order);
  const alamatJobAwal = (await testPrisma.job.findUnique({ where: { id: job.id } })).addressText;
  assert.match(alamatJobAwal, /Mawar/);
  const k = await kemampuan(w, p.id);
  const pra = await w.finance.c.post(`${BASE}/${p.id}/koreksi-order/pratinjau`, { jenis: "PERBAIKAN", pemenuhan: { alamat: "Jl. Kenanga 7, Depok", kota: "Depok" }, expectedRevision: k.revisi, alasan: "Alamat tertukar" });
  assert.equal(pra.status, 200, JSON.stringify(pra.body));
  assert.equal(pra.body.valid, true, JSON.stringify(pra.body));
  const dampak = pra.body.bagian.find((b) => b.jenis === "PEMBELI").dampak;
  assert.equal(dampak.jobDisinkron, 1);
  assert.equal(dampak.jobBaru, 0);
  assert.equal((await testPrisma.job.findUnique({ where: { id: job.id } })).addressText, alamatJobAwal, "pratinjau tidak menyimpan apa pun");
  assert.equal((await revisiDi(order.id)).length, k.revisi, "pratinjau tidak menulis revisi");
  const r = await koreksi(w, p.id, { jenis: "PERBAIKAN", pemenuhan: { alamat: "Jl. Kenanga 7, Depok", kota: "Depok" } }, k.revisi);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await testPrisma.job.count({ where: { orderId: order.id, type: "DELIVERY" } }), 1);
  assert.match((await testPrisma.job.findUnique({ where: { id: job.id } })).addressText, /Kenanga/);
});

test("4. Koreksi ADMINISTRATIF unit selesai: wajib konfirmasi; snapshot sebelum/sesudah tersimpan; stok/bahan/BOM/jurnal/status unit TIDAK berubah", async () => {
  const w = await siapkan();
  const p = await buatLama(w);
  const order = await orderDari(p.id);
  await selesaikanProduksi(order);
  const k = await kemampuan(w, p.id);
  assert.equal(grup(k, "spesifikasi").mode, "ADMINISTRATIF");
  const tanpa = await koreksi(w, p.id, { jenis: "PERBAIKAN", spesifikasi: { merk: "Kasur Sorong Koreksi", ukuran: "160 x 200" } }, k.revisi);
  assert.equal(tanpa.status, 409, "tanpa konfirmasi ditolak");
  assert.equal(tanpa.body.code, "KONFIRMASI_ADMINISTRATIF_WAJIB");
  const unitAwal = await unitDi(order.id);
  const sebelum = await jejak();
  const r = await koreksi(w, p.id, { jenis: "PERBAIKAN", konfirmasiAdministratif: true, spesifikasi: { merk: "Kasur Sorong Koreksi", ukuran: "160 x 200" } }, k.revisi);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const sesudah = await jejak();
  assert.deepEqual(sesudah, sebelum, "stok, bahan, jurnal, payment, job, unit tidak berubah");
  const unit = await unitDi(order.id);
  assert.deepEqual(unit.map((u) => [u.status, u.currentStageId, u.serviceId]), unitAwal.map((u) => [u.status, u.currentStageId, u.serviceId]));
  assert.ok(unit.every((u) => u.merk === "Kasur Sorong Koreksi"));
  const rev = (await revisiDi(order.id)).filter((x) => x.kind === "ORDER_ADMIN").pop();
  assert.equal(rev.impact.mode, "ADMINISTRATIF_SETELAH_PRODUKSI");
  assert.deepEqual(rev.impact.tidakDiubah.sort(), ["BOM / resep", "Jurnal & saldo", "Milestone & tahap produksi", "PIC / penugasan", "Pemakaian bahan", "Stok"].sort());
  assert.equal(rev.beforeItems[0].merk, "Kasur Sorong 3in1 custom");
  assert.equal(rev.afterItems[0].merk, "Kasur Sorong Koreksi");
  assert.ok(rev.impact.snapshotSebelum.unit.length === 3, "snapshot lama tersimpan");
});

test("5. Tambahan pesanan membuat item+unit baru TEPAT sekali (order lama dicatat sebagai pesanan awal); unit lama tidak disentuh; replay tidak menggandakan", async () => {
  const w = await siapkan();
  const p = await buatLama(w);
  const order = await orderDari(p.id);
  await selesaikanProduksi(order);
  const unitLama = (await unitDi(order.id)).map((u) => [u.id, u.unitCode, u.status, u.merk, u.ukuran]);
  const k = await kemampuan(w, p.id);
  const tambah = { jenis: "TAMBAHAN", tambahan: [{ pemenuhan: "PRODUKSI_BARU", kategori: "DIVAN_BOX", produkNama: "Divan Laci", jumlah: 2, harga: 1_100_000, panjang: 200, lebar: 100, tinggi: 30, perluDikirim: true }] };
  const h = kunci();
  const r = await koreksi(w, p.id, tambah, k.revisi, { headers: h, alasan: "Customer menambah 2 divan" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const unit = await unitDi(order.id);
  assert.equal(unit.length, 5, "3 lama + 2 baru");
  assert.deepEqual(unit.slice(0, 3).map((u) => [u.id, u.unitCode, u.status, u.merk, u.ukuran]), unitLama, "unit lama tidak berubah");
  assert.equal(await testPrisma.pkrOrderItem.count({ where: { orderId: order.id } }), 2, "pesanan awal + 1 item tambahan");
  const jenis = (await revisiDi(order.id)).map((x) => x.kind);
  assert.ok(jenis.includes("ADOPSI") && jenis.includes("TAMBAHAN"), jenis.join(","));
  const pkr = await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } });
  assert.equal(Number(pkr.total), 3 * 2_400_000 + 2 * 1_100_000, "nilai tambahan masuk sebagai delta");
  const sebelumReplay = await jejak();
  const ulang = await koreksi(w, p.id, tambah, k.revisi, { headers: h, alasan: "Customer menambah 2 divan" });
  assert.ok([200, 201].includes(ulang.status), JSON.stringify(ulang.body));
  assert.deepEqual(await jejak(), sebelumReplay, "replay tidak menggandakan unit/item/jurnal");
  const kk = await kemampuan(w, p.id);
  assert.ok(kk.item.some((i) => i.tambahan), "ditandai sebagai Tambahan pesanan");
  assert.ok(kk.item.some((i) => i.pesananAwalLama));
});

test("6. Koreksi harga = jurnal delta tepat: jurnal lama dibalik, pengganti diposting; Payment lama tidak berubah; Order CRM tetap Rp0", async () => {
  const w = await siapkan();
  const p = await buatLama(w);
  const bayar = await w.finance.c.post(`${BASE}/${p.id}/pembayaran`, { method: "TRANSFER", amount: 1_000_000, date: "2026-10-11", cashAccountId: w.bank.id }, kunci());
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  const order = await orderDari(p.id);
  const piutangAwal = await netPiutang(p.id);
  const payAwal = await testPrisma.payment.count();
  const jurnalAwal = await testPrisma.finJournalEntry.count();
  const k = await kemampuan(w, p.id);
  const r = await koreksi(w, p.id, { jenis: "PERBAIKAN", nilai: [{ no: 1, harga: 2_000_000 }] }, k.revisi, { alasan: "Harga disepakati Rp2.000.000 per unit" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const pkr = await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } });
  assert.equal(Number(pkr.total), 6_000_000);
  assert.equal(piutangAwal - (await netPiutang(p.id)), 1_200_000, "piutang turun tepat selisih Rp1.200.000");
  assert.equal(await testPrisma.payment.count(), payAwal, "Payment lama tidak berubah");
  assert.equal(await testPrisma.finJournalEntry.count() - jurnalAwal, 2, "satu jurnal pembalik + satu pengganti");
  const o = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.equal(o.value, 0);
  assert.equal(await testPrisma.invoice.count(), 0);
  const rev = (await revisiDi(order.id)).find((x) => x.kind === "NILAI");
  assert.ok(rev, "revisi NILAI tercatat");
  assert.equal(rev.financeBefore.total, 7_200_000);
  assert.equal(rev.financeAfter.total, 6_000_000);
  assert.equal(await testPrisma.unit.count({ where: { orderId: order.id } }), 3, "unit tidak berubah");
});

test("7. Nilai turun di bawah pembayaran: peringatan kelebihan bayar + arahan refund resmi; ditolak; kas TIDAK keluar otomatis", async () => {
  const w = await siapkan();
  const p = await buatLama(w);
  const bayar = await w.finance.c.post(`${BASE}/${p.id}/pembayaran`, { method: "TRANSFER", amount: 5_000_000, date: "2026-10-11", cashAccountId: w.bank.id }, kunci());
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  const k = await kemampuan(w, p.id);
  const sebelum = await jejak();
  const pra = await w.finance.c.post(`${BASE}/${p.id}/koreksi-order/pratinjau`, { jenis: "PERBAIKAN", nilai: [{ no: 1, harga: 1_000_000 }], expectedRevision: k.revisi, alasan: "Harga turun" });
  assert.equal(pra.status, 200);
  assert.equal(pra.body.valid, false);
  assert.equal(pra.body.galat.kode, "TOTAL_DI_BAWAH_PEMBAYARAN");
  assert.equal(pra.body.galat.kelebihanBayar, 2_000_000);
  assert.match(pra.body.galat.petunjuk, /Refund|Koreksi Pembayaran/);
  const r = await koreksi(w, p.id, { jenis: "PERBAIKAN", nilai: [{ no: 1, harga: 1_000_000 }] }, k.revisi);
  assert.equal(r.status, 409);
  assert.deepEqual(await jejak(), sebelum, "tidak ada jurnal/refund/kas yang dibuat");
});

test("8. Unit sedang diproduksi TIDAK ditimpa diam-diam: spesifikasi dan jumlah ditolak dengan arahan Tambahan; label unit tetap", async () => {
  const w = await siapkan();
  const p = await buatLama(w);
  const order = await orderDari(p.id);
  const unit0 = await unitDi(order.id);
  await testPrisma.unit.update({ where: { id: unit0[0].id }, data: { status: "IN_PRODUCTION" } });
  const k = await kemampuan(w, p.id);
  assert.equal(k.progres.tahapProduksi, "BERJALAN");
  assert.equal(grup(k, "spesifikasi").mode, "TERKUNCI");
  assert.equal(grup(k, "spesifikasi").tindakan.kode, "TAMBAHAN");
  const merkSebelum = (await unitDi(order.id)).map((u) => u.merk);
  const a = await koreksi(w, p.id, { jenis: "PERBAIKAN", spesifikasi: { merk: "Dipaksa Ganti" } }, k.revisi);
  assert.equal(a.status, 409, JSON.stringify(a.body));
  assert.equal(a.body.code, "SPEK_TERKUNCI_PRODUKSI");
  const b = await koreksi(w, p.id, { jenis: "PERBAIKAN", jumlah: 2 }, k.revisi);
  assert.equal(b.status, 409, JSON.stringify(b.body));
  assert.equal(b.body.code, "JUMLAH_TERKUNCI");
  assert.deepEqual((await unitDi(order.id)).map((u) => u.merk), merkSebelum);
  // customer & catatan tetap boleh saat produksi berjalan
  const c = await koreksi(w, p.id, { jenis: "PERBAIKAN", pemenuhan: { catatanProduksi: "Lapisan lebih tebal" } }, k.revisi);
  assert.equal(c.status, 201, JSON.stringify(c.body));
});

test("9. Delivery berjalan menolak perubahan alamat; matriks menandai TERKUNCI dengan arahan Reschedule/Koreksi Delivery; job tidak berubah", async () => {
  const w = await siapkan();
  const p = await buatLama(w);
  const order = await orderDari(p.id);
  const job = await selesaikanProduksi(order);
  await testPrisma.job.update({ where: { id: job.id }, data: { status: "EN_ROUTE" } });
  const k = await kemampuan(w, p.id);
  assert.equal(k.progres.tahapDelivery, "BERJALAN");
  assert.equal(grup(k, "alamat").mode, "TERKUNCI");
  assert.equal(grup(k, "alamat").tindakan.kode, "KOREKSI_DELIVERY");
  const alamatAwal = (await testPrisma.job.findUnique({ where: { id: job.id } })).addressText;
  const r = await koreksi(w, p.id, { jenis: "PERBAIKAN", pemenuhan: { alamat: "Alamat baru yang tidak boleh masuk", kota: "Depok" } }, k.revisi);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal((await testPrisma.job.findUnique({ where: { id: job.id } })).addressText, alamatAwal);
  assert.equal((await orderDari(p.id)).deliveryAddress, "Jl. Mawar 5, Bekasi");
});

test("10. Replay aman (kunci sama = tidak ada revisi/jurnal ganda); dua koreksi paralel: satu berhasil, satu 409; kunci sama isi beda = 409", async () => {
  const w = await siapkan();
  const p = await buatLama(w);
  const order = await orderDari(p.id);
  const k = await kemampuan(w, p.id);
  const h = kunci();
  const isi = { jenis: "PERBAIKAN", spesifikasi: { merk: "Merk Koreksi A" } };
  const a = await koreksi(w, p.id, isi, k.revisi, { headers: h });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const n1 = (await revisiDi(order.id)).length;
  const b = await koreksi(w, p.id, isi, k.revisi, { headers: h });
  assert.ok([200, 201].includes(b.status), JSON.stringify(b.body));
  assert.equal((await revisiDi(order.id)).length, n1, "replay tidak menulis revisi baru");
  const beda = await koreksi(w, p.id, { jenis: "PERBAIKAN", spesifikasi: { merk: "Merk Lain" } }, k.revisi, { headers: { "Idempotency-Key": h["Idempotency-Key"] } });
  assert.ok([409, 422].includes(beda.status), `kunci sama isi beda: ${beda.status} ${JSON.stringify(beda.body)}`);
  // paralel: dua permintaan beda kunci, revisi dilihat sama
  const k2 = await kemampuan(w, p.id);
  const [x, y] = await Promise.all([
    koreksi(w, p.id, { jenis: "PERBAIKAN", spesifikasi: { merk: "Paralel X" } }, k2.revisi),
    koreksi(w, p.id, { jenis: "PERBAIKAN", spesifikasi: { merk: "Paralel Y" } }, k2.revisi),
  ]);
  const sts = [x.status, y.status].sort();
  assert.deepEqual(sts, [201, 409], `paralel: ${JSON.stringify([x.body?.error, y.body?.error])}`);
  assert.equal(((await unitDi(order.id))[0].merk.startsWith("Paralel")), true);
});

test("11. PKR Indra tetap 1 PKR, 1 Order, U1/U2/U3 setelah koreksi customer/spesifikasi/nilai; kolom Pelanggan = pembeli (bukan Kemal)", async () => {
  const w = await siapkan();
  const p = await buatLama(w);
  const order = await orderDari(p.id);
  await selesaikanProduksi(order);
  const kode = (await unitDi(order.id)).map((u) => u.unitCode);
  let k = await kemampuan(w, p.id);
  let r = await koreksi(w, p.id, { jenis: "PERBAIKAN", pembeli: { telepon: "0812-1111-2222", nama: "Bpk. Indra" } }, k.revisi);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  k = await kemampuan(w, p.id);
  r = await koreksi(w, p.id, { jenis: "PERBAIKAN", konfirmasiAdministratif: true, spesifikasi: { ukuran: "100 x 200" } }, k.revisi);
  assert.ok([201, 400].includes(r.status), JSON.stringify(r.body)); // ukuran sama = tanpa perubahan (400) atau sah
  k = await kemampuan(w, p.id);
  r = await koreksi(w, p.id, { jenis: "PERBAIKAN", nilai: [{ no: 1, harga: 2_500_000 }] }, k.revisi);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await testPrisma.order.count({ where: { penjualanKaryawanId: p.id } }), 1);
  assert.deepEqual((await unitDi(order.id)).map((u) => u.unitCode), kode);
  const o = await testPrisma.order.findUnique({ where: { id: order.id }, include: { customer: true } });
  assert.equal(o.customer.name, "Bpk. Indra");
  assert.equal(o.customer.staffUserId, null, "bukan profil karyawan Kemal");
  assert.equal(o.value, 0);
});

test("12. Order non-PKR tidak berubah; peran tanpa izin Finance (SALES) 403; PKR yang dibatalkan 409", async () => {
  const w = await siapkan();
  const biasa = await testPrisma.customer.create({ data: { name: "Pelanggan Biasa", phone: "6281200000222", pipelineStage: "NEW" } });
  const ob = await testPrisma.order.create({ data: { customerId: biasa.id, orderNumber: "NEW-BIASA-001", status: "PENDING", category: "BARU", quantity: 1, value: 1_500_000 } });
  const sebelumBiasa = JSON.stringify(await testPrisma.order.findUnique({ where: { id: ob.id } }));
  const p = await buatLama(w);
  const k = await kemampuan(w, p.id);
  const r = await koreksi(w, p.id, { jenis: "PERBAIKAN", spesifikasi: { merk: "Merk Koreksi" } }, k.revisi);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(JSON.stringify(await testPrisma.order.findUnique({ where: { id: ob.id } })), sebelumBiasa, "order non-PKR tidak berubah");
  const tolak = await koreksi(w, p.id, { jenis: "PERBAIKAN", spesifikasi: { merk: "Merk Sales" } }, k.revisi + 1, { c: w.sales.c });
  assert.equal(tolak.status, 403);
  const tanpaAlasan = await w.finance.c.post(`${BASE}/${p.id}/koreksi-order`, { jenis: "PERBAIKAN", spesifikasi: { merk: "X" }, expectedRevision: k.revisi + 1, alasan: "ok" }, kunci());
  assert.equal(tanpaAlasan.status, 400);
  assert.equal(tanpaAlasan.body.code, "ALASAN_WAJIB");
  const tanpaKunci = await w.finance.c.post(`${BASE}/${p.id}/koreksi-order`, { jenis: "PERBAIKAN", spesifikasi: { merk: "X" }, expectedRevision: k.revisi + 1, alasan: "Alasan cukup" });
  assert.equal(tanpaKunci.status, 428);
  const batal = await w.admin.c.post(`${BASE}/${p.id}/batal`, { reason: "Batal uji koreksi order" }, kunci());
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  const setelah = await koreksi(w, p.id, { jenis: "PERBAIKAN", spesifikasi: { merk: "Pasca batal" } }, k.revisi + 1);
  assert.equal(setelah.status, 409);
});

test("13. Jumlah diturunkan SEBELUM dikerjakan: order lama dicatat sebagai pesanan awal, unit tertinggi dibatalkan, unit lain tetap; menaikkan = ditolak (jadikan tambahan)", async () => {
  const w = await siapkan();
  const p = await buatLama(w);
  const order = await orderDari(p.id);
  const k = await kemampuan(w, p.id);
  const naik = await koreksi(w, p.id, { jenis: "PERBAIKAN", jumlah: 5 }, k.revisi);
  assert.equal(naik.status, 409);
  assert.equal(naik.body.code, "JUMLAH_NAIK_TAMBAHAN");
  const awal = await unitDi(order.id);
  const r = await koreksi(w, p.id, { jenis: "PERBAIKAN", jumlah: 2 }, k.revisi, { alasan: "Customer hanya jadi ambil 2 unit" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const sesudah = await unitDi(order.id);
  assert.equal(sesudah.length, 3, "tidak ada unit dihapus fisik");
  assert.deepEqual(sesudah.filter((u) => u.status !== "CANCELLED").map((u) => u.unitCode), awal.slice(0, 2).map((u) => u.unitCode));
  assert.equal(sesudah[2].status, "CANCELLED");
  assert.equal((await orderDari(p.id)).quantity, 2);
  const jenis = (await revisiDi(order.id)).map((x) => x.kind);
  assert.ok(jenis.includes("ADOPSI"));
});
