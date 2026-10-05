// AUDIT AKSES DATA PEMBAYARAN UNTUK SALES (IDOR). SALES memegang PAYMENT_READ (agar melihat riwayat pembayaran order-nya di Rincian Pesanan), tetapi beberapa endpoint
// membaca data GLOBAL: antrean "lunas belum dicatat", detail/pratinjau Resi Finance, dan GET /armada/payments. Tes ini membuktikan Sales A tidak bisa membaca nominal,
// rekening, bukti, pencatat, atau klaim milik Sales B — dengan mengganti orderId/groupId langsung (bukan lewat UI).
import "./setup/env.js";
import "./setup/klaimTmpEnv.js";
import "./setup/paymentProofsTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const BUKTI_B = "/media/payment-proofs/RAHASIA-SALES-B.jpg";
const BUKTI_A = "/media/payment-proofs/milik-sales-a.jpg";

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "REKENING-RAHASIA-PT", kind: "BANK", accountId: akun.id } });
  await setSetting(testPrisma, SETTING_KEYS.RESI_INPUT_AKTIF, "true");
  await setSetting(testPrisma, SETTING_KEYS.RESI_PEMBAYARAN_AKTIF, "true");
  const sA = await createTestUser({ roles: ["SALES"] });
  const sB = await createTestUser({ roles: ["SALES"] });
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const adm = await createTestUser({ roles: ["ADMIN"] });
  const drv = await createTestUser({ roles: ["DRIVER"] });
  const cust = async (s, nama) => testPrisma.customer.create({ data: { name: nama, assignedSalesId: s.user.id } });
  const cA = await cust(sA, "Pelanggan Milik A"), cB = await cust(sB, "Pelanggan Milik B");
  const order = async (c, s, nomor, bukti, nominal) => {
    const o = await testPrisma.order.create({ data: { customerId: c.id, value: nominal, category: "LAYANAN", orderNumber: nomor, status: "DELIVERED", paymentStatus: "LUNAS", paidAt: new Date(), salesOwnerId: s.user.id } });
    const p = await testPrisma.payment.create({ data: { orderId: o.id, amount: nominal, method: "TRANSFER", proofPhotoUrl: bukti, cashAccountId: bank.id, recordedById: s.user.id } });
    return { o, p };
  };
  const a = await order(cA, sA, "RES-UJI-A", BUKTI_A, 1_111_000);
  const b = await order(cB, sB, "RES-UJI-B", BUKTI_B, 2_222_000);
  // Order B tanpa Payment (masuk antrean "lunas belum dicatat") + klaim milik B dengan catatan rahasia
  const bAntre = await testPrisma.order.create({ data: { customerId: cB.id, value: 3_333_000, category: "LAYANAN", orderNumber: "RES-UJI-B-ANTRE", status: "DELIVERED", paymentStatus: "LUNAS", paidAt: new Date(), salesOwnerId: sB.user.id } });
  const aAntre = await testPrisma.order.create({ data: { customerId: cA.id, value: 4_444_000, category: "LAYANAN", orderNumber: "RES-UJI-A-ANTRE", status: "DELIVERED", paymentStatus: "LUNAS", paidAt: new Date(), salesOwnerId: sA.user.id } });
  await testPrisma.orderPaymentClaim.create({ data: { orderId: bAntre.id, createdById: sB.user.id, status: "SUBMITTED", paymentDate: "2026-10-04", amount: 3_333_000, method: "TRANSFER", cashAccountId: bank.id, note: "CATATAN-KLAIM-RAHASIA-B", submittedAt: new Date() } });
  // Resi milik B (dibuat lewat API Sales B), child dijadikan LUNAS agar masuk antrean Resi
  const sBc = makeClient(server.baseUrl, sB.token);
  const r = await sBc.post("/api/resi", { customerId: cB.id, alamat: "Jl. Rahasia B 1", kota: "Jakarta Selatan", ongkirTambahan: 0, items: [{ merk: "Sano", ukuran: "160x200 cm (Queen)", keluhan: "x", nominal: 900_000, unitCount: 1 }, { merk: "Sano", ukuran: "160x200 cm (Queen)", keluhan: "y", nominal: 800_000, unitCount: 1 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await testPrisma.order.updateMany({ where: { groupId: r.body.groupId }, data: { paymentStatus: "LUNAS" } });
  return {
    bank, a, b, aAntre, bAntre, groupB: r.body.groupId, sA, sB,
    cSA: makeClient(server.baseUrl, sA.token), cSB: sBc, cFin: makeClient(server.baseUrl, fin.token), cAdm: makeClient(server.baseUrl, adm.token), cDrv: makeClient(server.baseUrl, drv.token),
  };
}
const teks = (r) => JSON.stringify(r.body);
const BOCOR = ["RES-UJI-B", "Pelanggan Milik B", "RAHASIA-SALES-B", "REKENING-RAHASIA-PT", "2222000", "3333000", "CATATAN-KLAIM-RAHASIA-B", "Rahasia B"];

test("Antrean lunas-belum-dicatat: Sales A hanya melihat order miliknya; tidak ada order, customer, nominal, klaim, atau Resi Sales B", async () => {
  const w = await dunia();
  const r = await w.cSA.get("/api/finance/penerimaan/lunas-belum-dicatat");
  assert.equal(r.status, 200, teks(r));
  const nomor = r.body.items.map((i) => i.orderNumber);
  assert.deepEqual(nomor.sort(), ["RES-UJI-A-ANTRE"], `hanya order milik A: ${nomor}`);
  for (const k of BOCOR) assert.ok(!teks(r).includes(k), `bocor "${k}" ke Sales A`);
  assert.equal((r.body.resi ?? []).length, 0, "Resi Sales B tidak tampil");
  assert.equal(r.body.semua.jumlah, 1, "ringkasan ikut dibatasi (jumlah)");
  assert.equal(r.body.semua.total, 4_444_000, "ringkasan ikut dibatasi (total)");
});

test("Antrean: Finance/Admin melihat SEMUA; Sales B melihat miliknya (termasuk Resi-nya); Driver 403; tanpa login 401", async () => {
  const w = await dunia();
  for (const c of [w.cFin, w.cAdm]) {
    const r = await c.get("/api/finance/penerimaan/lunas-belum-dicatat");
    assert.equal(r.status, 200);
    const nomor = r.body.items.map((i) => i.orderNumber);
    assert.ok(nomor.includes("RES-UJI-A-ANTRE") && nomor.includes("RES-UJI-B-ANTRE"), nomor.join(","));
    assert.ok((r.body.resi ?? []).some((x) => x.groupId === w.groupB), "Resi B tampil untuk Finance/Admin");
  }
  const b = await w.cSB.get("/api/finance/penerimaan/lunas-belum-dicatat");
  assert.deepEqual(b.body.items.map((i) => i.orderNumber), ["RES-UJI-B-ANTRE"]);
  assert.ok((b.body.resi ?? []).some((x) => x.groupId === w.groupB), "Sales B melihat Resi miliknya");
  assert.equal((await w.cDrv.get("/api/finance/penerimaan/lunas-belum-dicatat")).status, 403);
  assert.equal((await makeClient(server.baseUrl, null).get("/api/finance/penerimaan/lunas-belum-dicatat")).status, 401);
});

test("IDOR Resi: Sales A mengganti groupId ke Resi Sales B → 404 untuk detail dan pratinjau (tidak ada nominal/rekening/bukti/pencatat); pemilik & Finance 200", async () => {
  const w = await dunia();
  for (const sub of ["", "/pratinjau"]) {
    const u = `/api/finance/penerimaan/resi/${w.groupB}${sub}`;
    const r = await w.cSA.get(u);
    assert.equal(r.status, 404, `${u} → ${r.status} ${teks(r)}`);
    for (const k of BOCOR) assert.ok(!teks(r).includes(k));
    assert.equal((await w.cSB.get(u)).status, 200, `pemilik ${u}`);
    assert.equal((await w.cFin.get(u)).status, 200, `finance ${u}`);
    assert.equal((await w.cDrv.get(u)).status, 403);
  }
  assert.equal((await w.cSA.get("/api/finance/penerimaan/resi/00000000-0000-4000-8000-000000000000")).status, 404, "groupId tak ada = respons sama dengan milik orang lain");
});

test("IDOR /armada/payments: Sales A tanpa filter hanya melihat pembayaran order miliknya; orderId milik B → 404; driverId/date tidak melebarkan skop", async () => {
  const w = await dunia();
  const semua = await w.cSA.get("/api/armada/payments");
  assert.equal(semua.status, 200);
  assert.deepEqual(semua.body.map((p) => p.order.orderNumber).sort(), ["RES-UJI-A"], "hanya pembayaran order milik A");
  // A memakai rekening yang sama untuk pembayarannya sendiri, jadi nama rekening tidak dijadikan penanda bocor di sini.
  for (const k of BOCOR.filter((x) => x !== "REKENING-RAHASIA-PT")) assert.ok(!teks(semua).includes(k), `bocor "${k}"`);
  const idor = await w.cSA.get(`/api/armada/payments?orderId=${w.b.o.id}`);
  assert.equal(idor.status, 404, teks(idor));
  for (const k of BOCOR.filter((x) => x !== "REKENING-RAHASIA-PT")) assert.ok(!teks(idor).includes(k));
  const lebar = await w.cSA.get(`/api/armada/payments?driverId=${w.sB.user.id}`);
  assert.deepEqual(lebar.body, [], "filter driverId = Sales B tidak membuka pembayaran B");
  const milik = await w.cSA.get(`/api/armada/payments?orderId=${w.a.o.id}`);
  assert.equal(milik.status, 200);
  assert.equal(milik.body.length, 1);
  assert.equal(milik.body[0].proofPhotoUrl, BUKTI_A);
});

test("/armada/payments: Finance/Admin melihat semua; Driver 403; Sales B melihat pembayaran miliknya", async () => {
  const w = await dunia();
  for (const c of [w.cFin, w.cAdm]) {
    const r = await c.get("/api/armada/payments");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.map((p) => p.order.orderNumber).sort(), ["RES-UJI-A", "RES-UJI-B"]);
  }
  assert.deepEqual((await w.cSB.get("/api/armada/payments")).body.map((p) => p.order.orderNumber), ["RES-UJI-B"]);
  assert.equal((await w.cDrv.get("/api/armada/payments")).status, 403);
});

test("IDOR lain dengan paymentId/orderId langsung: daftar Pembayaran Finance, detail, verifikasi, klaim, dan tulis Payment semuanya menolak Sales A atas data B", async () => {
  const w = await dunia();
  const pid = w.b.p.id;
  assert.equal((await w.cSA.get("/api/finance/pembayaran")).status, 403);
  assert.equal((await w.cSA.get(`/api/finance/pembayaran/${pid}`)).status, 403);
  assert.equal((await w.cSA.post(`/api/finance/pembayaran/${pid}/verifikasi`, {})).status, 403);
  assert.equal((await w.cSA.post(`/api/finance/pembayaran/${pid}/tolak`, { reason: "x" })).status, 403);
  assert.equal((await w.cSA.post(`/api/armada/payments/${pid}/verify`, {})).status, 403);
  assert.equal((await w.cSA.post(`/api/orders/${w.b.o.id}/payments/${pid}/cancel`, { reason: "x" })).status, 403);
  const klaim = await w.cSA.get(`/api/klaim-lunas/order/${w.bAntre.id}`);
  // Nomor order terbuka lewat daftar order CRM (global by design); yang dijaga: isi klaim, nominal, rekening, bukti.
  // Info klaim hanya memuat klaim MILIK pengaju (sudah ada sebelumnya); tagihan/dibayar order tetap tampil bagi Sales yang mengajukan klaim (alur lapangan) — dicatat sebagai sisa risiko.
  for (const k of ["CATATAN-KLAIM-RAHASIA-B", "REKENING-RAHASIA-PT", "RAHASIA-SALES-B"]) assert.ok(!teks(klaim).includes(k), `klaim B bocor "${k}" ke Sales A`);
  const sebelum = await testPrisma.payment.count();
  assert.equal((await w.cSA.post(`/api/orders/${w.b.o.id}/payments`, { amount: 1000, method: "TRANSFER" })).status >= 400, true);
  assert.equal(await testPrisma.payment.count(), sebelum, "tidak ada Payment baru");
});
