// FORM PKR SETARA ORDER CRM + EDIT BERDASARKAN PROGRES, terhadap PostgreSQL sungguhan (jalur TERPADU: satu daftar item = penjualan + pemenuhan).
// Dikunci: (1) pembuatan lengkap → Customer Indra + 1 Order + U1/U2/U3 + 1 job, atomik (gagal = tidak ada Customer/Order/Unit/Job/jurnal setengah jadi); (2) unit yang sudah
// selesai tidak ditimpa — tambahan permintaan menjadi item/unit baru; (3) koreksi nilai memakai jurnal delta (asli dibalik + pengganti), Order tetap Rp0; (4) pembayaran tidak
// dapat diedit dari form order; (5) KASUS INDRA: data customer dilengkapi saat Delivery baru terjadwal → job yang SAMA tersinkron, unit/produksi/Finance tidak berubah;
// (6) riwayat mencatat sebelum/sesudah + pelaku; (7) order non-PKR tidak berubah.
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
const kunci = () => ({ "Idempotency-Key": `pkre-${randomUUID()}` });
const KATEGORI = {
  KASUR_BARU: ["Kasur Baru", "KASUR", "BARU", 10], DIVAN_BOX: ["Divan/Box", "DIVAN", "BARU", 30],
};
const RUTE = { KASUR_BARU: { productLine: "KASUR", productType: "KASUR_SEHAT" }, DIVAN_BOX: { productLine: "DIVAN", productType: "DIVAN_UTAMA" } };

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const seller = await testPrisma.user.create({ data: { name: "Kemal Uji", email: `kemal-${randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const peran = async (r) => { const u = await createTestUser({ roles: [r] }); return { id: u.user.id, c: makeClient(server.baseUrl, u.token) }; };
  await testPrisma.pkrItemCategory.deleteMany({ where: { code: { notIn: Object.keys(KATEGORI) } } });
  for (const [code, [name, shape, workKind, sortOrder]] of Object.entries(KATEGORI)) {
    const peta = { ...RUTE[code], productionServiceId: null };
    await testPrisma.pkrItemCategory.upsert({ where: { code }, update: { name, shape, workKind, sortOrder, active: true, ...peta }, create: { code, name, shape, workKind, sortOrder, ...peta } });
  }
  return { seller, bank, admin: await peran("ADMIN"), finance: await peran("FINANCE"), sales: await peran("SALES") };
}
const KASUR3 = { pemenuhan: "PRODUKSI_BARU", kategori: "KASUR_BARU", produkNama: "Kasur Sorong 3in1 custom", jumlah: 3, harga: 2_400_000, panjang: 200, lebar: 100, tebal: 20, perluDikirim: true };
const DIVAN1 = { pemenuhan: "PRODUKSI_BARU", kategori: "DIVAN_BOX", produkNama: "Divan Laci", jumlah: 1, harga: 1_100_000, panjang: 200, lebar: 100, tinggi: 30, perluDikirim: true };
const ALAMAT = { alamat: "Jl. Mawar 5, Bekasi", kota: "Bekasi" };
const INDRA = { telepon: "0812-1111-2222" };
const badan = (w, items, extra = {}) => ({ date: "2026-10-11", sellerId: w.seller.id, buyerName: "Bpk. Indra", items, orderCrm: { ...ALAMAT }, ...extra });
const catat = async (w, items, extra = {}) => {
  const r = await w.finance.c.post(BASE, badan(w, items, extra), kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};
const orderDari = (pkrId) => testPrisma.order.findFirst({ where: { penjualanKaryawanId: pkrId } });
const unitDi = (orderId) => testPrisma.unit.findMany({ where: { orderId }, orderBy: { seq: "asc" } });
const jejak = async () => ({
  jurnal: await testPrisma.finJournalEntry.count(), payment: await testPrisma.payment.count(), invoice: await testPrisma.invoice.count(), order: await testPrisma.order.count(),
  unit: await testPrisma.unit.count(), job: await testPrisma.job.count(), customer: await testPrisma.customer.count(), pkr: await testPrisma.finPenjualanKaryawan.count(),
});
async function netPiutang(pkrId) {
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PIUTANG_KARYAWAN } });
  const e = await testPrisma.finJournalEntry.findMany({ where: { source: { in: ["PENJUALAN_KARYAWAN", "REVERSAL"] }, OR: [{ sourceId: pkrId }, { reversalOf: { sourceId: pkrId } }] }, include: { lines: true } });
  let net = 0;
  for (const x of e) for (const l of x.lines) if (l.accountId === akun.id) net += Number(l.debit) - Number(l.credit);
  return net;
}
async function selesaikanProduksi(order) {
  const unit = await unitDi(order.id);
  for (const u of unit.filter((x) => x.status !== "CANCELLED")) await testPrisma.unit.update({ where: { id: u.id }, data: { status: "READY_FOR_DELIVERY" } });
  for (const u of unit.filter((x) => x.status !== "CANCELLED")) await testPrisma.$transaction((tx) => suggestDeliveryJob(tx, u.id));
}

test("1. Pembuatan lengkap (customer + alamat + Maps + item ×3 + pembayaran awal) = Customer Indra + 1 Order + U1/U2/U3, atomik", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR3], {
    pembeli: INDRA, pembayaran: [{ method: "TRANSFER", amount: 2_500_000, date: "2026-10-11", cashAccountId: w.bank.id }],
    orderCrm: { ...ALAMAT, lokasiUrl: "https://maps.app.goo.gl/Indra1", patokan: "Pagar biru", keluhan: "Sakit pinggang", catatanDelivery: "Telepon dulu" },
  });
  const order = await orderDari(p.id);
  const cust = await testPrisma.customer.findUnique({ where: { id: order.customerId } });
  assert.equal(cust.name, "Bpk. Indra");
  assert.equal(cust.phone, "6281211112222");
  assert.equal((await unitDi(order.id)).length, 3);
  assert.equal(order.locationUrl, "https://maps.app.goo.gl/Indra1");
  assert.equal(order.deliveryNote, "Telepon dulu");
  assert.equal(p.sinkron.pembayaran.status, "SEBAGIAN");
  assert.equal(p.sinkron.pembayaran.sisa, 4_700_000);
  assert.equal(order.value, 0);
  assert.equal((await jejak()).payment, 0, "tidak ada Payment CRM (pembayaran PKR ada di ledger PKR)");

  // Gagal di tengah (pembayaran melebihi total) → TIDAK ada Customer/Order/Unit/Job/jurnal setengah jadi.
  const sebelum = await jejak();
  const gagal = await w.finance.c.post(BASE, badan(w, [KASUR3], {
    pembeli: { telepon: "081388889999" }, pembayaran: [{ method: "TRANSFER", amount: 99_000_000, date: "2026-10-11", cashAccountId: w.bank.id }],
  }), kunci());
  assert.ok(gagal.status >= 400, JSON.stringify(gagal.body));
  assert.deepEqual(await jejak(), sebelum, "atomik: tidak ada sisa");
});

test("2. Produksi selesai: spesifikasi unit TIDAK ditimpa; tambahan permintaan = item/unit baru; unit lama utuh", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR3], { pembeli: INDRA });
  const order = await orderDari(p.id);
  await selesaikanProduksi(order);
  const lama = await unitDi(order.id);
  const ids = lama.map((u) => u.id);

  // ubah jumlah/ukuran item yang unitnya sudah selesai → ditolak (terkunci), tidak ada unit berubah
  const ubah = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 1, jumlah: 5 }], expectedRevision: 1, alasan: "Customer minta 5 kasur" }, kunci());
  assert.equal(ubah.status, 409, JSON.stringify(ubah.body));
  assert.deepEqual((await unitDi(order.id)).map((u) => u.id), ids);
  assert.ok((await unitDi(order.id)).every((u) => u.status === "READY_FOR_DELIVERY"));

  // tambahan permintaan customer → item baru + unit baru; unit lama TETAP
  const tambah = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "tambah", item: DIVAN1 }], expectedRevision: 1, alasan: "Customer menambah divan" }, kunci());
  assert.equal(tambah.status, 201, JSON.stringify(tambah.body));
  const baru = await unitDi(order.id);
  assert.equal(baru.length, 4);
  assert.deepEqual(baru.slice(0, 3).map((u) => u.id), ids);
  assert.equal(baru[3].status === "READY_FOR_DELIVERY", false, "unit baru belum selesai");
  assert.equal(await netPiutang(p.id), 3 * 2_400_000 + 1_100_000, "jurnal delta: net piutang = total baru");
  assert.equal((await orderDari(p.id)).value, 0, "Order CRM tetap Rp0");
});

test("3. Koreksi nilai = jurnal delta resmi (asli dibalik + pengganti); Payment/invoice tidak berubah; Order tetap Rp0; riwayat memuat pelaku", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR3], { pembeli: INDRA });
  const order = await orderDari(p.id);
  const sebelum = await jejak();
  const r = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 1, harga: 2_000_000 }], expectedRevision: 1, alasan: "Diskon karyawan disepakati" }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.penjualan.total, 6_000_000);
  assert.equal(await netPiutang(p.id), 6_000_000);
  const sesudah = await jejak();
  assert.equal(sesudah.payment, sebelum.payment);
  assert.equal(sesudah.invoice, sebelum.invoice);
  assert.equal(sesudah.order, sebelum.order);
  assert.equal(sesudah.unit, sebelum.unit);
  assert.equal(sesudah.customer, sebelum.customer);
  assert.equal((await orderDari(p.id)).value, 0);
  const rw = await w.finance.c.get(`${BASE}/${p.id}/riwayat`);
  assert.equal(rw.status, 200);
  const rev = rw.body.revisi.find((x) => x.jenis === "DIKOREKSI");
  assert.ok(rev && rev.pelaku?.id === w.finance.id && rev.alasan === "Diskon karyawan disepakati");
  assert.ok(order.id);
});

test("4. Pembayaran TIDAK dapat diedit dari form order: status bayar/pembayaran/invoice ditolak untuk order PKR", async () => {
  const w = await siapkan();
  const p = await catat(w, [KASUR3], { pembeli: INDRA });
  const order = await orderDari(p.id);
  const a = await w.admin.c.patch(`/api/orders/${order.id}`, { paymentStatus: "LUNAS" });
  assert.equal(a.status, 409);
  assert.equal(a.body.code, "ORDER_PENJUALAN_KARYAWAN");
  const b = await w.admin.c.post(`/api/orders/${order.id}/payments`, { amount: 1000, method: "TRANSFER" }, kunci());
  assert.equal(b.status, 409);
  assert.equal(await testPrisma.payment.count(), 0);
});

test("5. KASUS INDRA: Delivery baru terjadwal, data customer belum lengkap → Lengkapi Data Customer menyinkronkan job yang SAMA; U1/U2/U3, produksi, Finance tidak berubah", async () => {
  const w = await siapkan();
  // order lama gaya Indra: dicatat tanpa objek pembeli (klien lama) → memakai profil karyawan
  const p = await catat(w, [KASUR3], { pembayaran: [{ method: "TRANSFER", amount: 2_500_000, date: "2026-10-11", cashAccountId: w.bank.id }] });
  const order = await orderDari(p.id);
  await selesaikanProduksi(order);
  const job = await testPrisma.job.findFirst({ where: { orderId: order.id, type: "DELIVERY" } });
  await testPrisma.job.update({ where: { id: job.id }, data: { status: "SCHEDULED", scheduledDate: new Date("2026-10-14T00:00:00Z") } });
  const unitSebelum = (await unitDi(order.id)).map((u) => [u.id, u.status]);
  const finSebelum = await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } });
  const sebelum = await jejak();
  const net = await netPiutang(p.id);

  const ringkas = await w.admin.c.get(`${BASE}/${p.id}`);
  assert.equal(ringkas.body.sinkron.identitas.legacy, true);
  assert.equal(ringkas.body.sinkron.produksi.kode, "SELESAI");

  const masukan = {
    pembeli: { telepon: "0812-1111-2222", nama: "Bpk. Indra" },
    pemenuhan: { alamat: "Jl. Mawar 5, Bekasi", lokasiUrl: "https://maps.app.goo.gl/Indra1", patokan: "Pagar biru", keluhan: "Sakit pinggang", catatanDelivery: "Telepon dulu", penerima: { nama: "Bu Rina (istri)", telepon: "0813 5555 6666" } },
  };
  const pra = await w.admin.c.post(`${BASE}/${p.id}/koreksi-pembeli/pratinjau`, masukan, kunci());
  assert.equal(pra.status, 200, JSON.stringify(pra.body));
  assert.equal(pra.body.dampak.jobDisinkron, 1);
  assert.equal(pra.body.dampak.jobBaru, 0);
  const r = await w.admin.c.post(`${BASE}/${p.id}/koreksi-pembeli`, { ...masukan, expectedRevision: pra.body.revisi, alasan: "Lengkapi data customer Indra" }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));

  const o2 = await orderDari(p.id);
  const cust = await testPrisma.customer.findUnique({ where: { id: o2.customerId } });
  assert.equal(cust.name, "Bpk. Indra");
  assert.equal(cust.phone, "6281211112222");
  assert.equal(o2.recipientName, "Bu Rina (istri)");
  const jobSesudah = await testPrisma.job.findUnique({ where: { id: job.id } });
  assert.match(jobSesudah.addressText, /Jl\. Mawar 5/);
  assert.equal(jobSesudah.status, "SCHEDULED");
  assert.equal(await testPrisma.job.count(), 1, "job tidak ganda");
  assert.equal(await testPrisma.jobUnit.count({ where: { jobId: job.id } }), 3);
  assert.deepEqual((await unitDi(order.id)).map((u) => [u.id, u.status]), unitSebelum, "U1/U2/U3 dan status Produksi sama");
  const sesudah = await jejak();
  assert.deepEqual({ ...sesudah, customer: 0 }, { ...sebelum, customer: 0 });
  assert.equal(sesudah.customer - sebelum.customer, 1);
  const finSesudah = await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } });
  assert.equal(String(finSesudah.total), String(finSebelum.total));
  assert.equal(await netPiutang(p.id), net);
  const ringkasBaru = await w.admin.c.get(`${BASE}/${p.id}`);
  assert.equal(ringkasBaru.body.sinkron.identitas.legacy, false);
  assert.equal(ringkasBaru.body.sinkron.identitas.customer.nama, "Bpk. Indra");
});

test("6. Order non-PKR tidak berubah oleh perubahan ini (tanpa blok penjualanKaryawan, tanpa identitas, KPI tetap)", async () => {
  const w = await siapkan();
  const c = await testPrisma.customer.create({ data: { name: "Pelanggan Biasa", phone: "6281200007777" } });
  await testPrisma.order.create({ data: { customerId: c.id, value: 1_500_000, category: "BARU", status: "PROCESSING", orderNumber: "NEW-BIASA-001" } });
  const r = await w.admin.c.get("/api/orders?limit=50");
  assert.equal(r.status, 200);
  const it = r.body.items.find((o) => o.orderNumber === "NEW-BIASA-001");
  assert.equal(it.customerName, "Pelanggan Biasa");
  assert.equal(it.penjualanKaryawan, undefined);
  assert.equal(r.body.summary.totalOrderAktif, 1);
  assert.equal(r.body.summary.nilaiOrderAktif, 1_500_000);
});
