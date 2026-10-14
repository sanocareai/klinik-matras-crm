// PEMBATALAN PENJUALAN KARYAWAN (PKR) — pratinjau server + gerbang di bawah kunci, terhadap PostgreSQL sungguhan (baseline live c01a02ba/bc941feb).
// Replika PKR-11102026-005: satu PKR format lama, SATU Order CRM, TIGA unit, ber-DP. Yang dikunci:
//  (1) DP menahan pembatalan (409 PEMBAYARAN_AKTIF): pembayaran TIDAK dibatalkan/dikembalikan otomatis; pratinjau menjelaskan; tidak ada tulisan sama sekali;
//  (2) setelah Finance membatalkan pembayaran, pembatalan lolos: jurnal dibalik, order+unit CANCELLED, tidak ada yang dihapus;
//  (3) produksi berjalan, KESIAPAN FISIK terkonfirmasi (mode rute transisi) dan konfirmasi MUAT (manifest Delivery) menahan walau status unit masih awal;
//  (4) alasan: dirapikan tanpa merusak huruf (regresi: regex /s+/ pernah mengganti huruf 's'), wajib, maksimal 500; replay Idempotency-Key & dua pembatal paralel = satu pembalikan.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const BASE = "/api/finance/penjualan-karyawan";
const kunci = (p = "pbt") => ({ "Idempotency-Key": `${p}-${randomUUID()}` });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const seller = await testPrisma.user.create({ data: { name: "Kemal Uji", email: `kemal-${randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const peran = async (r) => { const u = await createTestUser({ roles: [r] }); return { id: u.user.id, c: makeClient(server.baseUrl, u.token) }; };
  return { rekening, seller, admin: await peran("ADMIN"), finance: await peran("FINANCE"), sales: await peran("SALES"), dispatcher: await peran("DISPATCHER") };
}
// Replika PKR-11102026-005: SATU baris penjualan format lama, jumlahUnit 3, dikirim.
const LAMA = (w) => ({
  date: "2026-10-11", sellerId: w.seller.id, buyerName: "Pak Indra Antariksa (projek kos)",
  items: [{ name: "Kasur Sorong 3in1 custom", quantity: 3, unitPrice: 2_400_000 }],
  orderCrm: { kategori: "BARU", jumlahUnit: 3, merk: "Kasur Sorong 3in1 custom", ukuran: "120 x 200", perluDikirim: true, alamat: "Jl. Mawar 5, Bogor", kota: "Bogor" },
});
async function catat(w, { dp = 0 } = {}) {
  const r = await w.finance.c.post(BASE, LAMA(w), kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (dp) {
    const b = await w.finance.c.post(`${BASE}/${r.body.id}/pembayaran`, { date: "2026-10-11", amount: dp, method: "TRANSFER", cashAccountId: w.rekening.id }, kunci());
    assert.equal(b.status, 201, JSON.stringify(b.body));
  }
  return r.body;
}
const orderDari = (pkrId) => testPrisma.order.findFirst({ where: { penjualanKaryawanId: pkrId } });
const unitDi = (orderId) => testPrisma.unit.findMany({ where: { orderId }, orderBy: { seq: "asc" } });
const jejak = async () => ({
  jurnal: await testPrisma.finJournalEntry.count(), jurnalDibalik: await testPrisma.finJournalEntry.count({ where: { status: "REVERSED" } }),
  order: await testPrisma.order.count(), unitAktif: await testPrisma.unit.count({ where: { status: { not: "CANCELLED" } } }), job: await testPrisma.job.count(),
  bayarAktif: await testPrisma.finPenjualanKaryawanPayment.count({ where: { cancelledAt: null } }), pkrAktif: await testPrisma.finPenjualanKaryawan.count({ where: { status: "AKTIF" } }),
});
const batal = (w, id, reason, headers = kunci()) => w.admin.c.post(`${BASE}/${id}/batal`, { reason }, headers);

test("DP menahan: pratinjau menjelaskan, 409 PEMBAYARAN_AKTIF tanpa tulisan apa pun; pembayaran tidak dibatalkan otomatis; setelah Finance membatalkan DP, pembatalan lolos", async () => {
  const w = await siapkan();
  const p = await catat(w, { dp: 2_500_000 });
  const order = await orderDari(p.id);
  const j0 = await jejak();

  const pv = await w.finance.c.get(`${BASE}/${p.id}/pembatalan`);
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.equal(pv.body.boleh, false);
  assert.equal(pv.body.pembayaranAktif.jumlah, 1); assert.equal(pv.body.pembayaranAktif.total, 2_500_000);
  assert.equal(pv.body.order.nomor, order.orderNumber);
  const h = pv.body.hambatan.find((x) => x.kode === "PEMBAYARAN_AKTIF");
  assert.ok(h, "hambatan PEMBAYARAN_AKTIF");
  assert.equal(h.tindakan, "RIWAYAT_PEMBAYARAN");
  assert.match(h.pesan, /TIDAK dibatalkan atau dikembalikan otomatis/);
  assert.deepEqual(pv.body.akanTerjadi, [], "tidak ada yang akan terjadi selagi diblokir");

  const tolak = await batal(w, p.id, "Pesanan salah input dobel");
  assert.equal(tolak.status, 409, JSON.stringify(tolak.body));
  assert.equal(tolak.body.code, "PEMBAYARAN_AKTIF");
  assert.equal(tolak.body.pembayaranAktif.jumlah, 1);
  assert.match(tolak.body.error, /belum bisa dibatalkan/);
  assert.deepEqual(await jejak(), j0, "ditolak = tidak ada jurnal/order/unit/job/pembayaran yang berubah");
  assert.equal((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } })).status, "AKTIF");

  // Finance menangani DP lebih dulu (lewat Riwayat Pembayaran), baru penjualan bisa dibatalkan.
  const pay = await testPrisma.finPenjualanKaryawanPayment.findFirst({ where: { penjualanId: p.id, cancelledAt: null } });
  const bp = await w.admin.c.post(`${BASE}/${p.id}/pembayaran/${pay.id}/batal`, { reason: "DP salah rekening" });
  assert.equal(bp.status, 200, JSON.stringify(bp.body));
  const pv2 = await w.finance.c.get(`${BASE}/${p.id}/pembatalan`);
  assert.equal(pv2.body.boleh, true);
  assert.ok(pv2.body.akanTerjadi.length >= 2, "pratinjau menyebut dampak");

  const ok = await batal(w, p.id, "Pesanan salah input dobel");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const sesudah = await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } });
  assert.equal(sesudah.status, "DIBATALKAN");
  assert.equal(sesudah.cancelReason, "Pesanan salah input dobel", "alasan tersimpan persis (huruf s tidak rusak)");
  assert.equal((await testPrisma.order.findUnique({ where: { id: order.id } })).status, "CANCELLED");
  assert.ok((await unitDi(order.id)).every((u) => u.status === "CANCELLED"), "tiga unit dibatalkan, tidak dihapus");
  assert.equal((await unitDi(order.id)).length, 3);
  const j = await jejak();
  assert.equal(j.unitAktif, 0); assert.equal(j.pkrAktif, 0); assert.equal(j.order, 1, "order tidak dihapus");
});

test("alasan: spasi dirapikan TANPA merusak huruf (regresi regex), wajib, maksimal 500; sudah dibatalkan = 409 SUDAH_DIBATALKAN", async () => {
  const w = await siapkan();
  const p = await catat(w);
  assert.equal((await batal(w, p.id, "   ")).status, 400);
  assert.equal((await w.admin.c.post(`${BASE}/${p.id}/batal`, {}, kunci())).status, 400);
  assert.equal((await batal(w, p.id, "x".repeat(501))).status, 400);
  assert.equal((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } })).status, "AKTIF", "alasan ditolak = tidak ada tulisan");
  const ok = await batal(w, p.id, "  Pesanan   dibatalkan   sesuai   permintaan  customer\tsesudah  survei  ");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } })).cancelReason, "Pesanan dibatalkan sesuai permintaan customer sesudah survei");
  const lagi = await batal(w, p.id, "Dibatalkan lagi oleh orang lain");
  assert.equal(lagi.status, 409);
  assert.equal(lagi.body.code, "SUDAH_DIBATALKAN");
  const pv = await w.finance.c.get(`${BASE}/${p.id}/pembatalan`);
  assert.equal(pv.body.boleh, false); assert.equal(pv.body.hambatan[0].kode, "SUDAH_DIBATALKAN");
});

test("produksi berjalan menahan (409 PRODUKSI_DELIVERY_BERJALAN) dengan arahan alur order resmi; tidak ada yang berubah", async () => {
  const w = await siapkan();
  const p = await catat(w);
  const order = await orderDari(p.id);
  const [u1] = await unitDi(order.id);
  await testPrisma.unit.update({ where: { id: u1.id }, data: { status: "IN_PRODUCTION" } });
  const j0 = await jejak();
  const pv = await w.finance.c.get(`${BASE}/${p.id}/pembatalan`);
  assert.equal(pv.body.boleh, false);
  const h = pv.body.hambatan.find((x) => x.kode === "PRODUKSI_DELIVERY_BERJALAN");
  assert.ok(h); assert.equal(h.tindakan, "ALUR_ORDER");
  assert.match(h.pesan, new RegExp(u1.unitCode));
  assert.match(h.pesan, /alur pembatalan resmi order/);
  const r = await batal(w, p.id, "Mau dibatalkan saja");
  assert.equal(r.status, 409); assert.equal(r.body.code, "PRODUKSI_DELIVERY_BERJALAN");
  assert.deepEqual(await jejak(), j0);
});

test("MODE TRANSISI + MANIFEST: kesiapan fisik terkonfirmasi atau unit sudah dimuat menahan pembatalan walau status unit masih RECEIVED", async () => {
  const w = await siapkan();
  const p = await catat(w);
  const order = await orderDari(p.id);
  const units = await unitDi(order.id);
  assert.ok(units.every((u) => u.status === "RECEIVED"));
  assert.equal((await w.finance.c.get(`${BASE}/${p.id}/pembatalan`)).body.boleh, true, "dasar: tanpa fisik/muat, boleh");

  // (a) kesiapan fisik dikonfirmasi Delivery (event, status unit TIDAK berubah)
  const fisik = await w.dispatcher.c.post(`/api/armada/orders/${order.id}/kesiapan-fisik`, { unitIds: [units[0].id], alasan: "U1 nyata sudah jadi di workshop" }, kunci());
  assert.equal(fisik.status, 201, JSON.stringify(fisik.body));
  assert.equal((await testPrisma.unit.findUnique({ where: { id: units[0].id } })).status, "RECEIVED");
  const pa = await w.finance.c.get(`${BASE}/${p.id}/pembatalan`);
  assert.equal(pa.body.boleh, false);
  assert.match(pa.body.hambatan.map((x) => x.pesan).join(" "), /Kesiapan fisik sudah dikonfirmasi pada unit .*U1/);
  const j0 = await jejak();
  const ra = await batal(w, p.id, "Dibatalkan padahal barang sudah jadi");
  assert.equal(ra.status, 409); assert.equal(ra.body.code, "PRODUKSI_DELIVERY_BERJALAN");
  assert.deepEqual(await jejak(), j0, "diblokir = unit/job/jurnal tidak berubah");

  // (b) konfirmasi MUAT pada unit lain (status masih RECEIVED) — fakta muat tidak boleh hilang diam-diam
  const job = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, status: "SCHEDULED", scheduledDate: new Date("2026-10-16") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: units[2].id } });
  await testPrisma.jobUnitLoad.create({ data: { jobId: job.id, unitId: units[2].id } });
  const pb = await w.finance.c.get(`${BASE}/${p.id}/pembatalan`);
  assert.match(pb.body.hambatan.map((x) => x.pesan).join(" "), /U3 sudah dikonfirmasi dimuat/);
});

test("id tak dikenal: pratinjau 404 dan batal 404 tanpa menulis apa pun (dipakai smoke rilis)", async () => {
  const w = await siapkan();
  const nol = "00000000-0000-4000-8000-000000000000";
  const j0 = await jejak();
  assert.equal((await w.finance.c.get(`${BASE}/${nol}/pembatalan`)).status, 404);
  assert.equal((await w.admin.c.post(`${BASE}/${nol}/batal`, { reason: "uji id tak dikenal" }, kunci())).status, 404);
  assert.equal((await w.admin.c.post(`${BASE}/${nol}/batal`, { reason: "   " }, kunci())).status, 400);
  assert.equal((await w.admin.c.post(`${BASE}/${nol}/batal`, { reason: "uji tanpa kunci" })).status, 404, "tanpa Idempotency-Key tetap tidak menyentuh data");
  assert.deepEqual(await jejak(), j0);
});

test("replay Idempotency-Key = satu pembalikan; dua pembatal paralel = tepat satu berhasil; peran Sales tak boleh membaca/membatalkan", async () => {
  const w = await siapkan();
  const p = await catat(w);
  const k = kunci("ulang");
  const a = await batal(w, p.id, "Dibatalkan oleh admin", k);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const jBalik = (await jejak()).jurnalDibalik;
  const b = await batal(w, p.id, "Dibatalkan oleh admin", k);
  assert.ok([200, 201].includes(b.status), `replay harus mengulang jawaban, dapat ${b.status}`);
  assert.equal((await jejak()).jurnalDibalik, jBalik, "replay tidak membalik jurnal lagi");

  const q = await catat(w);
  const [x, y] = await Promise.all([batal(w, q.id, "Paralel satu"), batal(w, q.id, "Paralel dua")]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  assert.equal((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: q.id } })).status, "DIBATALKAN");

  const r = await catat(w);
  assert.equal((await w.sales.c.get(`${BASE}/${r.id}/pembatalan`)).status, 403);
  assert.equal((await w.sales.c.post(`${BASE}/${r.id}/batal`, { reason: "Coba dari sales" }, kunci())).status, 403);
  assert.equal((await w.finance.c.post(`${BASE}/${r.id}/batal`, { reason: "Coba dari finance" }, kunci())).status, 403, "pembatalan tetap izin Admin Finance");
});
