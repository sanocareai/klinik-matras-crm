// REKONSILIASI PENDAPATAN 2026 (baca-saja): klasifikasi order backfill, tanggal pengakuan dari bukti penyelesaian (bukan tanggal order), pemetaan akun menurut jenis order,
// usulan jurnal seimbang & idempoten, laporan bulanan + simulasi, dan jaminan TIDAK ADA jurnal/kas/saldo yang berubah.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw, DEVICE } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { klasifikasiOrder, barisUsulan } from "../../src/services/finance/rekonsiliasi2026.js";
import { STATUS_PENGAKUAN, postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { petaAkunPendapatanLegacy } from "../../src/services/finance/legacyPendapatan.js";
import { toMoney } from "../../src/services/finance/money.js";

let server; let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function masuk(roles) {
  const u = await createLoginUser({ roles });
  const r = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device: DEVICE() } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...u, token: r.body.accessToken };
}
const get = (u, path) => raw("GET", `/api/finance${path}`, { token: u.token });

async function buatOrder(cust, o) {
  return testPrisma.order.create({ data: { customerId: cust.id, category: "LAYANAN", status: "DELIVERED", paymentStatus: "BELUM_BAYAR", value: 1_000_000, ...o } });
}
const kirim = (orderId, selesai) => testPrisma.job.create({ data: { orderId, type: "DELIVERY", status: "COMPLETED", completedAt: new Date(selesai) } });
const snapshotBuku = async () => JSON.stringify([await testPrisma.finJournalEntry.count(), await testPrisma.finJournalLine.count(), (await testPrisma.finJournalLine.aggregate({ _sum: { debit: true, credit: true } }))._sum]);

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const c = await testPrisma.customer.create({ data: { name: "Ibu Sari" } });
  const o = {};
  o.a = await buatOrder(c, { orderNumber: "RES-12072026-001", value: 750_000, createdAt: new Date("2026-07-12T03:00:00Z") }); // layanan, selesai 3 Agu
  await kirim(o.a.id, "2026-08-03T05:00:00Z");
  o.b = await buatOrder(c, { orderNumber: "NEW-20072026-002", category: "BARU", value: 2_000_000, ongkir: 50_000, paymentStatus: "LUNAS", createdAt: new Date("2026-07-20T03:00:00Z") });
  await kirim(o.b.id, "2026-07-25T05:00:00Z"); // baru + ongkir, LUNAS tanpa Payment
  o.c = await buatOrder(c, { orderNumber: "SWS-22072026-003", category: "SEWA", status: "SEWA_DIKIRIM", value: 300_000, createdAt: new Date("2026-07-22T03:00:00Z") });
  await kirim(o.c.id, "2026-07-23T05:00:00Z");
  o.d = await buatOrder(c, { orderNumber: "RES-01082026-004", value: 500_000, createdAt: new Date("2026-08-01T03:00:00Z") }); // DELIVERED tanpa bukti tanggal
  o.e = await buatOrder(c, { orderNumber: "RES-02082026-005", status: "PROCESSING", value: 400_000, createdAt: new Date("2026-08-02T03:00:00Z") });
  o.f = await buatOrder(c, { orderNumber: "RES-03082026-006", status: "CANCELLED", value: 900_000, createdAt: new Date("2026-08-03T03:00:00Z") });
  o.g = await buatOrder(c, { orderNumber: "SWS-04082026-007", category: "SEWA", value: 0, createdAt: new Date("2026-08-04T03:00:00Z") });
  await kirim(o.g.id, "2026-08-05T05:00:00Z");
  // pengakuan pertama di buku (17 Sep) → batas jendela audit
  o.h = await buatOrder(c, { orderNumber: "RES-10082026-008", value: 600_000, createdAt: new Date("2026-08-10T03:00:00Z") });
  await kirim(o.h.id, "2026-09-05T05:00:00Z");
  const user = await createLoginUser({ roles: ["FINANCE"] });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.h.id, userId: user.id, date: new Date("2026-09-17T00:00:00Z") }));
  return o;
}

test("klasifikasiOrder (murni): batal, refund, sudah diakui, nilai nol, selesai bertanggal/tanpa tanggal, berjalan; tanggal = pengiriman selesai PERTAMA", () => {
  const dasar = { value: 1000, ongkir: 0, jobs: [], refunds: [], status: "DELIVERED" };
  assert.equal(klasifikasiOrder({ ...dasar, status: "CANCELLED" }).kelas, "BATAL");
  assert.equal(klasifikasiOrder({ ...dasar, refunds: [{ status: "DISETUJUI" }] }).kelas, "REFUND");
  assert.equal(klasifikasiOrder({ ...dasar, refunds: [{ status: "DITOLAK" }] }).kelas, "PERLU_DITINJAU_TANPA_TANGGAL", "refund ditolak tidak menghalangi");
  assert.equal(klasifikasiOrder({ ...dasar, sudahDiakui: true }).kelas, "SUDAH_DIAKUI");
  assert.equal(klasifikasiOrder({ ...dasar, value: 0 }).kelas, "TIDAK_CUKUP_DATA");
  assert.equal(klasifikasiOrder({ ...dasar, status: "PROCESSING" }).kelas, "BERJALAN");
  assert.equal(klasifikasiOrder({ ...dasar, status: "SHIPPING" }).kelas, "BERJALAN");
  assert.equal(klasifikasiOrder({ ...dasar, status: "DELIVERED" }).kelas, "PERLU_DITINJAU_TANPA_TANGGAL");
  const dua = klasifikasiOrder({ ...dasar, jobs: [{ type: "DELIVERY", status: "COMPLETED", completedAt: "2026-08-10T05:00:00Z" }, { type: "DELIVERY", status: "COMPLETED", completedAt: "2026-08-03T05:00:00Z" }] });
  assert.equal(dua.kelas, "LAYAK");
  assert.equal(dua.tanggalPengakuan, "2026-08-03");
  assert.ok(dua.catatan.some((x) => /pengiriman selesai/.test(x)));
  assert.equal(klasifikasiOrder({ ...dasar, jobs: [{ type: "DELIVERY", status: "FAILED", completedAt: "2026-08-03T05:00:00Z" }] }).kelas, "PERLU_DITINJAU_TANPA_TANGGAL", "pengiriman gagal bukan bukti");
  assert.equal(klasifikasiOrder({ ...dasar, sudahDiakui: true, status: "PENDING" }).catatan.length, 1, "diakui tetapi masih berjalan = anomali dicatat");
  for (const s of ["DELIVERED", "SEWA_DIKIRIM", "SEWA_DIAMBIL"]) assert.ok(STATUS_PENGAKUAN.includes(s), "selaras dengan mesin posting");
  assert.equal(STATUS_PENGAKUAN.length, 3);
});

test("barisUsulan (murni): akun menurut jenis order, ongkir 4-1900, uang muka dipindahkan, LUNAS tanpa pembayaran → ekuitas non-kas, seimbang, tidak menyentuh kas", () => {
  const seimbang = (u) => {
    const d = u.lines.reduce((s, l) => s.plus(toMoney(l.debit)), toMoney(0));
    const k = u.lines.reduce((s, l) => s.plus(toMoney(l.kredit)), toMoney(0));
    assert.equal(d.toFixed(2), k.toFixed(2));
  };
  const layanan = barisUsulan({ orderNumber: "R", category: "LAYANAN", value: 1000, ongkir: 0, paymentStatus: "BELUM_BAYAR" });
  assert.deepEqual(layanan.lines.map((l) => l.akun), ["4-1100", "1-1300"]); seimbang(layanan);
  const baru = barisUsulan({ orderNumber: "N", category: "BARU", value: 2000, ongkir: 100, paymentStatus: "BELUM_BAYAR" });
  assert.deepEqual(baru.lines.map((l) => l.akun), ["4-1200", "4-1900", "1-1300"]); seimbang(baru);
  const sewa = barisUsulan({ orderNumber: "S", category: "SEWA", value: 300, ongkir: 0, paymentStatus: "BELUM_BAYAR" });
  assert.equal(sewa.lines[0].akun, "4-1300");
  const dp = barisUsulan({ orderNumber: "D", category: "LAYANAN", value: 1000, ongkir: 0, paymentStatus: "DP" }, { uangMukaLedger: toMoney(400) });
  assert.deepEqual(dp.lines.map((l) => [l.akun, l.debit, l.kredit]), [["4-1100", "0.00", "1000.00"], ["2-1200", "400.00", "0.00"], ["1-1300", "600.00", "0.00"]]); seimbang(dp);
  const lunas = barisUsulan({ orderNumber: "L", category: "LAYANAN", value: 1000, ongkir: 0, paymentStatus: "LUNAS" });
  assert.deepEqual(lunas.lines.map((l) => l.akun), ["4-1100", "3-4100"]); assert.equal(lunas.mode, "MIGRASI_LUNAS_TANPA_PEMBAYARAN"); seimbang(lunas);
  const lunasDp = barisUsulan({ orderNumber: "L2", category: "LAYANAN", value: 1000, ongkir: 0, paymentStatus: "LUNAS" }, { uangMukaLedger: toMoney(1000) });
  assert.deepEqual(lunasDp.lines.map((l) => l.akun), ["4-1100", "2-1200"]); assert.equal(lunasDp.mode, "STANDAR");
  for (const u of [layanan, baru, sewa, dp, lunas, lunasDp]) assert.ok(!u.lines.some((l) => ["1-1100", "1-1200"].includes(l.akun)), "kas/bank tidak disentuh");
});

test("Pemetaan akun arsip menurut jenis transaksi: tegas → akun; ambigu/tanpa jenis → belum dipetakan (tidak ditebak, bukan default 4-1200)", () => {
  assert.equal(petaAkunPendapatanLegacy("Sewa kasur 1 bulan"), "4-1300");
  assert.equal(petaAkunPendapatanLegacy("Servis kasur king"), "4-1100");
  assert.equal(petaAkunPendapatanLegacy("Ganti kain + upgrade"), "4-1100");
  assert.equal(petaAkunPendapatanLegacy("Kasur baru queen"), "4-1200");
  assert.equal(petaAkunPendapatanLegacy("Pembayaran kost 27 kasur New+Servis"), null, "campuran → tidak ditebak");
  assert.equal(petaAkunPendapatanLegacy("pembayaran otoy"), null);
  assert.equal(petaAkunPendapatanLegacy(""), null);
});

test("Audit backfill lewat API: 7 kelas, tanggal dari bukti selesai, order yang sudah diakui tidak digandakan, TIDAK ada jurnal/kas berubah", async () => {
  const o = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const buku0 = await snapshotBuku();

  const det = (await get(fin, "/pemasukan/rekonsiliasi/backfill?detail=1")).body;
  assert.equal(det.jendela.dari, "2026-07-12");
  assert.equal(det.jendela.sampai, "2026-09-17");
  const per = Object.fromEntries(det.orders.map((r) => [r.nomor, r]));
  assert.equal(per["RES-12072026-001"].kelas, "LAYAK");
  assert.equal(per["RES-12072026-001"].tanggalPengakuan, "2026-08-03", "tanggal pengakuan = penyelesaian, BUKAN tanggal order (12 Jul)");
  assert.equal(per["NEW-20072026-002"].tanggalPengakuan, "2026-07-25");
  assert.equal(per["SWS-22072026-003"].kelas, "LAYAK");
  assert.equal(per["RES-01082026-004"].kelas, "PERLU_DITINJAU_TANPA_TANGGAL");
  assert.equal(per["RES-02082026-005"].kelas, "BERJALAN");
  assert.equal(per["RES-03082026-006"].kelas, "BATAL");
  assert.equal(per["SWS-04082026-007"].kelas, "TIDAK_CUKUP_DATA");
  assert.equal(per["RES-10082026-008"].kelas, "SUDAH_DIAKUI");
  assert.ok(per["RES-10082026-008"].jurnalPengakuan);
  assert.equal(per["RES-10082026-008"].usulan, undefined, "yang sudah diakui tidak diusulkan lagi");
  assert.deepEqual(per["NEW-20072026-002"].usulan.lines.map((l) => l.akun), ["4-1200", "4-1900", "3-4100"]);
  assert.deepEqual(per["SWS-22072026-003"].usulan.lines.map((l) => l.akun), ["4-1300", "1-1300"]);

  const lap = (await get(fin, "/pemasukan/rekonsiliasi/backfill")).body;
  const k = Object.fromEntries(lap.kelas.map((x) => [x.kelas, x]));
  assert.equal(k.LAYAK.jumlah, 3);
  assert.equal(k.LAYAK.nilai, "3100000.00");
  assert.equal(k.BATAL.jumlah, 1); assert.equal(k.BERJALAN.jumlah, 1); assert.equal(k.SUDAH_DIAKUI.jumlah, 1);
  const bulan = Object.fromEntries(lap.perBulan.map((b) => [b.bulan, b]));
  assert.equal(bulan["2026-07"].layakDiakui.jumlah, 2, "NEW (25 Jul) + SWS (23 Jul)");
  assert.equal(bulan["2026-08"].layakDiakui.jumlah, 1, "RES-001 dibuat Juli tetapi selesai Agustus");
  assert.equal(bulan["2026-08"].layakDiakui.pendapatanPerAkun["4-1100"], "750000.00");
  assert.equal(lap.simulasi.kas.berubah, "0.00");
  assert.equal(lap.simulasi.labaRugi.pendapatanBertambah, "3100000.00");
  assert.equal(lap.simulasi.piutang.bertambah, "1050000.00", "RES-001 (750rb) + SWS (300rb) belum dibayar; NEW = LUNAS tanpa pembayaran → ekuitas");
  assert.equal(lap.simulasi.ekuitas.koreksiSaldoAwalBerkurang, "2050000.00");
  assert.equal(lap.simulasi.ekuitas.totalBerubah, "1050000.00");

  assert.equal(await snapshotBuku(), buku0, "buku besar (jumlah jurnal/baris/total) tidak berubah");
  assert.ok(o.a);
});

test("Proposal backfill: JSON idempoten (kunci = kunci mesin posting), seimbang per jurnal, BELUM DIPOSTING, bisa disaring per bulan; laporan bulanan gabungan", async () => {
  const o = await siapkan();
  const fin = await masuk(["FINANCE"]);
  const buku0 = await snapshotBuku();
  const pr = (await get(fin, "/pemasukan/rekonsiliasi/proposal")).body;
  assert.match(pr.status, /BELUM DIPOSTING/);
  assert.match(pr.persetujuan, /Owner/);
  assert.equal(pr.jumlahJurnal, 3);
  for (const j of pr.jurnal) {
    assert.match(j.idempotencyKey, /^PENGAKUAN_PENDAPATAN:/);
    const d = j.lines.reduce((s, l) => s + Number(l.debit), 0); const k = j.lines.reduce((s, l) => s + Number(l.kredit), 0);
    assert.equal(d, k, `${j.nomorOrder} seimbang`);
    assert.ok(!j.lines.some((l) => ["1-1100", "1-1200"].includes(l.akun)));
  }
  assert.ok(pr.jurnal.some((j) => j.idempotencyKey === `PENGAKUAN_PENDAPATAN:${o.a.id}` && j.tanggalBuku === "2026-08-03"));
  assert.ok(!pr.jurnal.some((j) => j.orderId === o.h.id), "order yang sudah diakui tidak masuk proposal");
  const agu = (await get(fin, "/pemasukan/rekonsiliasi/proposal?bulan=2026-08")).body;
  assert.equal(agu.jumlahJurnal, 1);
  const bln = (await get(fin, "/pemasukan/rekonsiliasi/laporan")).body;
  assert.match(bln.status, /TIDAK ADA POSTING/);
  assert.ok(bln.perBulan.some((b) => b.bulan === "2026-08" && b.orderSistem?.layakDiakui.jumlah === 1));
  assert.equal(await snapshotBuku(), buku0, "tidak ada jurnal yang diposting");
});

test("Izin: rekonsiliasi hanya untuk pembaca finance; tanpa sesi 401; tidak ada endpoint tulis", async () => {
  await siapkan();
  const r = await fetch(`${server.baseUrl}/api/finance/pemasukan/rekonsiliasi/laporan`);
  assert.equal(r.status, 401);
  const fin = await masuk(["FINANCE"]);
  const post = await raw("POST", "/api/finance/pemasukan/rekonsiliasi/proposal", { token: fin.token, headers: { "Idempotency-Key": crypto.randomUUID() }, body: {} });
  assert.ok([404, 405].includes(post.status), `POST tidak ada (${post.status})`);
});
