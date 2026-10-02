// PENGECUALIAN TANGGAL LUNAS (Owner, ber-riwayat). Kasus yang dijaga: order yang dihitung lunas di September (target Sales) TIDAK bergeser ke Oktober saat Finance memverifikasi
// pembayarannya; penjaga bekerja di SEMUA jalur penulis paidAt (verifikasi, koreksi pembayaran, ubah status manual); riwayat tidak pernah hilang; hanya Admin/Owner.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { verifikasiPembayaran } from "../../src/services/finance/pembayaran.js";
import { bukukanPembayaran } from "../../src/services/finance/hooks.js";
import { recomputeOrderPaymentStatus } from "../../src/services/paymentLedger.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let n = 0;
const wib = (d) => (d ? new Date(new Date(d).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10) : null);
async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = (await createTestUser({ roles: ["SALES"] })).user;
  return { bank, admin: makeClient(server.baseUrl, admin.token), adminUser: admin.user, finance: makeClient(server.baseUrl, finance.token), financeUser: finance.user, sales };
}
// Order yang DITANDAI Lunas Sales 30 Sep 23:17 WIB (paidAt), uangnya baru ditransfer 1 Okt — persis kasus Kiki.
async function orderKlaim(w, { nilai = 1_000_000, tglBayar = "2026-10-01T10:00:00Z", amount = nilai } = {}) {
  const c = await testPrisma.customer.create({ data: { name: "Pelanggan Uji" } });
  const paidAt = new Date("2026-09-30T16:17:00Z"); // 23:17 WIB
  const o = await testPrisma.order.create({ data: { customerId: c.id, value: nilai, category: "LAYANAN", orderNumber: `PX-${String(++n).padStart(3, "0")}`, status: "DELIVERED", paymentStatus: "LUNAS", paidAt } });
  const p = await testPrisma.payment.create({ data: { orderId: o.id, amount, method: "TRANSFER", cashAccountId: w.bank.id, recordedById: w.sales.id, createdAt: new Date(tglBayar) } });
  await testPrisma.$transaction((tx) => bukukanPembayaran(tx, { paymentId: p.id, userId: w.sales.id }));
  return { o, p, paidAt };
}
const verif = (w, id) => testPrisma.$transaction((tx) => verifikasiPembayaran(tx, { paymentId: id, userId: w.financeUser.id }));
const paidAtDb = async (id) => (await testPrisma.order.findUnique({ where: { id }, select: { paidAt: true } })).paidAt;
const kunci = (w, o, extra = {}) => w.admin.post("/api/finance/pengecualian-lunas", { orderNumber: o.orderNumber, alasan: "Keputusan Owner: target Sales September 120 jt", ...extra });

test("TANPA pengecualian (perilaku lama): verifikasi Finance 1 Okt menggeser paidAt ke Oktober — ini yang dicegah pengecualian", async () => {
  const w = await dunia();
  const { o, p } = await orderKlaim(w);
  await verif(w, p.id);
  assert.equal(wib(await paidAtDb(o.id)), "2026-10-01");
});

test("DENGAN pengecualian: verifikasi Finance 1 Okt TIDAK menggeser paidAt (tetap 30 Sep), status bayar tetap benar, Payment & jurnal tidak berubah", async () => {
  const w = await dunia();
  const { o, p, paidAt } = await orderKlaim(w);
  const r = await kunci(w, o);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const jurnalSebelum = await testPrisma.finJournalEntry.count();
  await verif(w, p.id);
  assert.equal((await paidAtDb(o.id)).toISOString(), paidAt.toISOString(), "paidAt dikunci");
  assert.equal((await testPrisma.order.findUnique({ where: { id: o.id } })).paymentStatus, "LUNAS");
  const pay = await testPrisma.payment.findUnique({ where: { id: p.id } });
  assert.equal(wib(pay.createdAt), "2026-10-01", "uang tetap tercatat masuk 1 Okt");
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalSebelum, "jurnal tidak dibuat/diubah oleh pengecualian");
});

test("Skenario Hotel Discovery: pengecualian pada order yang BELUM dibayar; DP sebagian diverifikasi lalu pelunasan Oktober — paidAt tetap 30 Sep sepanjang waktu", async () => {
  const w = await dunia();
  const c = await testPrisma.customer.create({ data: { name: "Hotel Uji" } });
  const paidAt = new Date("2026-09-30T16:00:00Z");
  const o = await testPrisma.order.create({ data: { customerId: c.id, value: 1_500_000, category: "LAYANAN", orderNumber: "HOTEL-1", status: "DELIVERED", paymentStatus: "LUNAS", paidAt } });
  assert.equal((await kunci(w, o)).status, 201);
  const bayar = async (amount, tgl) => {
    const p = await testPrisma.payment.create({ data: { orderId: o.id, amount, method: "TRANSFER", cashAccountId: w.bank.id, recordedById: w.sales.id, createdAt: new Date(tgl) } });
    await testPrisma.$transaction((tx) => bukukanPembayaran(tx, { paymentId: p.id, userId: w.sales.id }));
    await verif(w, p.id);
  };
  await bayar(500_000, "2026-10-10T05:00:00Z");
  assert.equal((await testPrisma.order.findUnique({ where: { id: o.id } })).paymentStatus, "DP", "status bayar jujur mengikuti uang");
  assert.equal((await paidAtDb(o.id)).toISOString(), paidAt.toISOString(), "paidAt tetap dikunci walau status turun ke DP");
  await bayar(1_000_000, "2026-10-20T05:00:00Z");
  assert.equal((await testPrisma.order.findUnique({ where: { id: o.id } })).paymentStatus, "LUNAS");
  assert.equal((await paidAtDb(o.id)).toISOString(), paidAt.toISOString());
});

test("Jalur lain juga dijaga: koreksi (paidAtEfektif) dan ubah status manual lewat PATCH order tidak menyentuh paidAt", async () => {
  const w = await dunia();
  const { o, paidAt } = await orderKlaim(w);
  await kunci(w, o);
  await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, o.id, { paidAtEfektif: true }));
  assert.equal((await paidAtDb(o.id)).toISOString(), paidAt.toISOString(), "recompute efektif tidak menyentuh");
  const patch = await w.admin.patch(`/api/orders/${o.id}`, { paymentStatus: "BELUM_BAYAR" });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  assert.equal((await paidAtDb(o.id)).toISOString(), paidAt.toISOString(), "menurunkan status manual tidak menullkan paidAt");
});

test("Membuat pengecualian dengan tanggal yang berbeda mengatur paidAt ke tanggal itu dan mencatat paidAt asli; tanggal wajib ada", async () => {
  const w = await dunia();
  const { o } = await orderKlaim(w);
  const r = await kunci(w, o, { paidAtDikunci: "2026-09-29T09:00:00.000Z" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await paidAtDb(o.id)).toISOString(), "2026-09-29T09:00:00.000Z");
  const baris = await testPrisma.orderPaidAtPengecualian.findFirst({ where: { orderId: o.id } });
  assert.equal(baris.paidAtAsli.toISOString(), "2026-09-30T16:17:00.000Z");
  const c2 = await testPrisma.customer.create({ data: { name: "Tanpa lunas" } });
  const kosong = await testPrisma.order.create({ data: { customerId: c2.id, value: 1000, category: "LAYANAN", orderNumber: "KOSONG-1", paymentStatus: "BELUM_BAYAR" } });
  assert.equal((await kunci(w, kosong)).status, 422, "order tanpa tanggal lunas wajib mengisi tanggal");
});

test("Satu order = satu pengecualian aktif; alasan wajib minimal 10 karakter; order batal ditolak; nomor tidak ada = 404", async () => {
  const w = await dunia();
  const { o } = await orderKlaim(w);
  assert.equal((await w.admin.post("/api/finance/pengecualian-lunas", { orderNumber: o.orderNumber, alasan: "pendek" })).status, 400);
  assert.equal((await kunci(w, o)).status, 201);
  assert.equal((await kunci(w, o)).status, 409, "ganda ditolak");
  assert.equal((await w.admin.post("/api/finance/pengecualian-lunas", { orderNumber: "TIDAK-ADA", alasan: "alasan yang cukup panjang" })).status, 404);
  const c = await testPrisma.customer.create({ data: { name: "Batal" } });
  const batal = await testPrisma.order.create({ data: { customerId: c.id, value: 1000, category: "LAYANAN", orderNumber: "BATAL-1", status: "CANCELLED", paymentStatus: "LUNAS", paidAt: new Date() } });
  assert.equal((await kunci(w, batal)).status, 409);
});

test("Mencabut: alasan wajib, sinkronisasi normal berlaku lagi untuk pembayaran berikutnya, RIWAYAT tetap ada (aktif=false, pencabut dan alasan tercatat), bisa dibuat lagi", async () => {
  const w = await dunia();
  const { o, p } = await orderKlaim(w);
  const id = (await kunci(w, o)).body.id;
  assert.equal((await w.admin.post(`/api/finance/pengecualian-lunas/${id}/cabut`, { alasan: "x" })).status, 400);
  const cabut = await w.admin.post(`/api/finance/pengecualian-lunas/${id}/cabut`, { alasan: "Owner membatalkan pengecualian" });
  assert.equal(cabut.status, 200, JSON.stringify(cabut.body));
  assert.equal((await w.admin.post(`/api/finance/pengecualian-lunas/${id}/cabut`, { alasan: "Owner membatalkan lagi" })).status, 409);
  await verif(w, p.id);
  assert.equal(wib(await paidAtDb(o.id)), "2026-10-01", "setelah dicabut, sinkronisasi normal kembali");
  const riwayat = (await w.admin.get("/api/finance/pengecualian-lunas")).body;
  assert.equal(riwayat.pengecualian.length, 1, "baris tidak dihapus");
  assert.equal(riwayat.pengecualian[0].aktif, false);
  assert.equal(riwayat.pengecualian[0].alasanDicabut, "Owner membatalkan pengecualian");
  assert.ok(riwayat.pengecualian[0].dicabutOleh);
  assert.equal((await kunci(w, o)).status, 201, "boleh dibuat lagi setelah dicabut");
  const semua = (await w.admin.get("/api/finance/pengecualian-lunas")).body;
  assert.equal(semua.pengecualian.length, 2);
  assert.equal(semua.jumlahAktif, 1);
});

test("Izin: Finance biasa boleh MELIHAT riwayat tetapi tidak membuat/mencabut; Sales tidak melihat; setiap aksi tercatat di audit dengan pelaku", async () => {
  const w = await dunia();
  const { o } = await orderKlaim(w);
  assert.equal((await w.finance.post("/api/finance/pengecualian-lunas", { orderNumber: o.orderNumber, alasan: "mencoba tanpa hak" })).status, 403);
  const id = (await kunci(w, o)).body.id;
  assert.equal((await w.finance.get("/api/finance/pengecualian-lunas")).status, 200);
  assert.equal((await w.finance.post(`/api/finance/pengecualian-lunas/${id}/cabut`, { alasan: "mencoba tanpa hak" })).status, 403);
  const sales = makeClient(server.baseUrl, (await createTestUser({ roles: ["SALES"] })).token);
  assert.equal((await sales.get("/api/finance/pengecualian-lunas")).status, 403);
  await w.admin.post(`/api/finance/pengecualian-lunas/${id}/cabut`, { alasan: "Owner membatalkan pengecualian" });
  const log = await testPrisma.activityEvent.findMany({ where: { entityType: "order", entityId: o.id, eventType: "PAIDAT_PENGECUALIAN" }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(log.map((l) => l.metadata.aksi), ["dibuat", "dicabut"]);
  assert.ok(log.every((l) => l.actorId === w.adminUser.id));
});

test("Pagar skema: indeks unik parsial mencegah dua pengecualian aktif walau lewat SQL langsung", async () => {
  const w = await dunia();
  const { o } = await orderKlaim(w);
  await kunci(w, o);
  await assert.rejects(() => testPrisma.orderPaidAtPengecualian.create({ data: { orderId: o.id, paidAtDikunci: new Date(), alasan: "dobel lewat jalur belakang", createdById: w.adminUser.id } }));
});

test("Skrip kunci-tanggal-lunas-september: dry-run tidak menulis; --apply mengunci grup A dan B dengan riwayat; ulang = tidak ada perubahan; order bukan lunas-September menghentikan SEMUA", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const w = await dunia();
  const mk = async (no, { ps = "LUNAS", paidAt = new Date("2026-09-30T16:17:00Z") } = {}) => {
    const c = await testPrisma.customer.create({ data: { name: "Uji " + no } });
    return testPrisma.order.create({ data: { customerId: c.id, value: 1_000_000, category: "LAYANAN", orderNumber: no, status: "DELIVERED", paymentStatus: ps, ...(paidAt && { paidAt }) } });
  };
  await testPrisma.user.update({ where: { id: w.adminUser.id }, data: { email: "owner-uji@example.test" } });
  await mk("SEP-A1"); await mk("SEP-B1"); await mk("SEP-B2");
  const jalankan = (...arg) => execFileSync(process.execPath, ["scripts/kunci-tanggal-lunas-september.js", "--actor", "owner-uji@example.test", "--grup-a", "SEP-A1", "--grup-b", "SEP-B1,SEP-B2", ...arg], { cwd: new URL("../..", import.meta.url), env: process.env, encoding: "utf8" });
  assert.match(jalankan(), /DRY-RUN: 3 order akan dikunci/);
  assert.equal(await testPrisma.orderPaidAtPengecualian.count(), 0, "dry-run tidak menulis");
  assert.match(jalankan("--apply"), /SELESAI/);
  const baris = await testPrisma.orderPaidAtPengecualian.findMany({ include: { order: true } });
  assert.equal(baris.length, 3);
  assert.ok(baris.every((b) => b.dicabutAt === null && b.createdById === w.adminUser.id && b.alasan.includes("Keputusan Owner")));
  assert.match(jalankan("--apply"), /0 order akan dikunci \(3 sudah punya/);
  assert.equal(await testPrisma.orderPaidAtPengecualian.count(), 3, "idempoten");

  await mk("OKT-1", { paidAt: new Date("2026-10-01T05:00:00Z") });
  const gagal = spawnSync(process.execPath, ["scripts/kunci-tanggal-lunas-september.js", "--actor", "owner-uji@example.test", "--grup-a", "OKT-1", "--grup-b", "SEP-B1", "--apply"], { cwd: new URL("../..", import.meta.url), env: process.env, encoding: "utf8" });
  assert.equal(gagal.status, 1);
  assert.match(gagal.stderr, /Bukan LUNAS di September/);
  assert.equal(await testPrisma.orderPaidAtPengecualian.count(), 3, "gagal = tidak ada yang tertulis");
});
