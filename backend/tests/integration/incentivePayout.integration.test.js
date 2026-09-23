// Pembayaran Insentif Driver — ledger append-only, test real-Postgres (24
// September 2026). Lihat catatan panjang di schema.prisma model
// IncentivePayout, services/incentivePayoutEngine.js, dan
// routes/incentivePayout.js. APPROVED (IncentiveSnapshot) = "angka
// disahkan", BUKAN "sudah dibayar" — modul ini yang membuktikannya.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
let seq = 0;
const K = () => ({ "Idempotency-Key": randomUUID() });

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function buatOrder(customerId) {
  return testPrisma.order.create({ data: { customerId, orderNumber: `PAY-ORDER-${++seq}`, value: 1000, category: "LAYANAN" } });
}
async function buatJob({ orderId, driverId = null, completedAt }) {
  return testPrisma.job.create({ data: { type: "DELIVERY", orderId, driverId, status: "COMPLETED", sequence: 1, completedAt: new Date(completedAt), addressText: "Alamat tes payout" } });
}

async function fixtureDasar() {
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const approver = await createTestUser({ roles: ["APPROVER"] });
  const sales = await createTestUser({ roles: ["SALES"] }); // tanpa permission payout apa pun
  const driver = await createTestUser({ roles: ["DRIVER"] });
  await testPrisma.user.update({ where: { id: driver.user.id }, data: { hasSim: true } });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Payout", city: "Jakarta" } });
  return {
    admin: { ...admin, api: makeClient(server.baseUrl, admin.token) },
    finance: { ...finance, api: makeClient(server.baseUrl, finance.token) },
    approver: { ...approver, api: makeClient(server.baseUrl, approver.token) },
    sales: { ...sales, api: makeClient(server.baseUrl, sales.token) },
    driver: { ...driver, api: makeClient(server.baseUrl, driver.token) },
    customer,
  };
}

// Bikin Snapshot lewat alur API SUNGGUHAN (bukan fixture DB langsung) —
// membuktikan payout benar-benar bekerja di atas hasil endpoint Snapshot
// nyata. `statusAkhir` opsional: "DRAFT" | "REVIEWED" | "APPROVED" (default).
async function buatSnapshotBerstatus(f, { from, to }, statusAkhir = "APPROVED") {
  const buat = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from, to }, K());
  assert.equal(buat.status, 201, JSON.stringify(buat.body));
  if (statusAkhir === "DRAFT") return buat.body;
  const reviewed = await f.finance.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/review`, {}, K());
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  if (statusAkhir === "REVIEWED") return reviewed.body;
  if (statusAkhir === "REJECTED") {
    const rej = await f.finance.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/reject`, { reason: "tes" }, K());
    assert.equal(rej.status, 200, JSON.stringify(rej.body));
    return rej.body;
  }
  const approved = await f.approver.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/approve`, {}, K());
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  return approved.body;
}

function badanPayout(lineId, amount, extra = {}) {
  return { snapshotLineId: lineId, amount, method: "TRANSFER", paidAt: "2026-09-20T10:00:00.000Z", referenceNumber: "TRX-001", ...extra };
}

// ── Aturan status snapshot ──────────────────────────────────────────────
for (const status of ["DRAFT", "REVIEWED", "REJECTED"]) {
  test(`Snapshot berstatus ${status} TIDAK bisa dibayar`, async () => {
    const f = await fixtureDasar();
    const order = await buatOrder(f.customer.id);
    await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
    const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" }, status);
    const line = snap.lines?.[0] || (await testPrisma.incentiveSnapshotLine.findFirst({ where: { snapshotId: snap.id } }));

    const res = await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 1000), K());
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(await testPrisma.incentivePayout.count(), 0);
  });
}

test("Snapshot APPROVED bisa dibayar", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  const line = snap.lines[0];
  assert.equal(line.totalRupiah, 7000);

  const res = await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 7000), K());
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.amount, 7000);
});

// ── Partial / full payment ────────────────────────────────────────────────
test("Partial payment: sisa berkurang, status PARTIALLY_PAID, snapshot line TETAP tidak berubah", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  const line = snap.lines[0];

  const res = await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 3000), K());
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const detail = await f.finance.api.get(`/api/armada/incentive-snapshots/${snap.id}`);
  const lineTerbaru = detail.body.lines.find((l) => l.id === line.id);
  assert.equal(lineTerbaru.dibayar, 3000);
  assert.equal(lineTerbaru.sisa, 4000);
  assert.equal(lineTerbaru.statusPembayaran, "PARTIALLY_PAID");
  assert.equal(lineTerbaru.totalRupiah, 7000, "angka snapshot line TIDAK PERNAH berubah, cuma dibayar/sisa yang diturunkan");
});

test("Full payment (bisa via beberapa kali cicil): status PAID, sisa 0", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  const line = snap.lines[0];

  await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 4000), K());
  const kedua = await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 3000), K());
  assert.equal(kedua.status, 201, JSON.stringify(kedua.body));

  const detail = await f.finance.api.get(`/api/armada/incentive-snapshots/${snap.id}`);
  const lineTerbaru = detail.body.lines.find((l) => l.id === line.id);
  assert.equal(lineTerbaru.dibayar, 7000);
  assert.equal(lineTerbaru.sisa, 0);
  assert.equal(lineTerbaru.statusPembayaran, "PAID");
});

test("Overpayment DITOLAK — nominal melebihi sisa", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  const line = snap.lines[0];

  const res = await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 7001), K());
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(await testPrisma.incentivePayout.count(), 0);

  await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 5000), K());
  const lanjut = await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 2001), K());
  assert.equal(lanjut.status, 409, JSON.stringify(lanjut.body), "5000 + 2001 = 7001 > 7000, harus tetap ditolak walau dicicil");
});

// ── Balapan / idempoten ────────────────────────────────────────────────────
test("BALAPAN: dua pembayaran paralel pada line yang sama TIDAK menyebabkan overpayment", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  const line = snap.lines[0]; // totalRupiah 7000

  const hasil = await Promise.all([
    f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 5000), K()),
    f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 5000), K()),
  ]);
  const statuses = hasil.map((h) => h.status).sort();
  assert.deepEqual(statuses, [201, 409], JSON.stringify(hasil.map((h) => h.body)));

  const totalTerbayar = await testPrisma.incentivePayout.aggregate({ where: { snapshotLineId: line.id, voidedAt: null }, _sum: { amount: true } });
  assert.equal(totalTerbayar._sum.amount, 5000, "hanya SATU pembayaran 5000 yang berhasil, bukan 10000 (overpayment)");
});

test("Retry dengan Idempotency-Key SAMA: respons diputar ulang, TIDAK ada pembayaran kedua", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  const line = snap.lines[0];
  const kunci = K();

  const a = await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 3000), kunci);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  await new Promise((r) => setTimeout(r, 200));

  const b = await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 3000), kunci);
  assert.equal(b.headers.get("idempotent-replayed"), "true");
  assert.equal(b.body.id, a.body.id);
  assert.equal(await testPrisma.incentivePayout.count(), 1);
});

test("Tanpa Idempotency-Key: DITOLAK 428 — WAJIB untuk semua klien (bukan opsional seperti default)", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  const line = snap.lines[0];

  const res = await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 3000));
  assert.equal(res.status, 428, JSON.stringify(res.body));
});

// ── Isolasi antar line ──────────────────────────────────────────────────
test("Payout satu line TIDAK memengaruhi saldo/status line lain di snapshot yang sama", async () => {
  const f = await fixtureDasar();
  const helper = await createTestUser({ roles: ["DRIVER"] });
  await testPrisma.user.update({ where: { id: helper.user.id }, data: { hasSim: false } });
  const order = await buatOrder(f.customer.id);
  await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, driverId: f.driver.user.id, helperId: helper.user.id, status: "COMPLETED", sequence: 1, completedAt: new Date("2026-09-05T02:00:00.000Z"), addressText: "Alamat tes" } });
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  const lineDriver = snap.lines.find((l) => l.userId === f.driver.user.id);
  const lineHelper = snap.lines.find((l) => l.userId === helper.user.id);

  await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(lineDriver.id, lineDriver.totalRupiah), K());

  const detail = await f.finance.api.get(`/api/armada/incentive-snapshots/${snap.id}`);
  const helperTerbaru = detail.body.lines.find((l) => l.id === lineHelper.id);
  assert.equal(helperTerbaru.dibayar, 0);
  assert.equal(helperTerbaru.statusPembayaran, "UNPAID");
});

// ── Void ────────────────────────────────────────────────────────────────
test("Void: saldo pulih, baris pembayaran TETAP ada (append-only), alasan wajib", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  const line = snap.lines[0];
  const bayar = await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 7000), K());

  const tanpaAlasan = await f.admin.api.post(`/api/armada/incentive-payouts/${bayar.body.id}/void`, {}, K());
  assert.equal(tanpaAlasan.status, 400);

  const void1 = await f.admin.api.post(`/api/armada/incentive-payouts/${bayar.body.id}/void`, { reason: "Salah nominal, dicatat ulang" }, K());
  assert.equal(void1.status, 200, JSON.stringify(void1.body));
  assert.ok(void1.body.voidedAt);

  assert.equal(await testPrisma.incentivePayout.count({ where: { id: bayar.body.id } }), 1, "baris TETAP ada, tidak dihapus");

  const detail = await f.finance.api.get(`/api/armada/incentive-snapshots/${snap.id}`);
  const lineTerbaru = detail.body.lines.find((l) => l.id === line.id);
  assert.equal(lineTerbaru.dibayar, 0, "saldo pulih ke 0 setelah void");
  assert.equal(lineTerbaru.sisa, 7000);
  assert.equal(lineTerbaru.statusPembayaran, "UNPAID");

  // Setelah void, alamat itu bisa dibayar ULANG (bukti saldo benar-benar pulih).
  const bayarUlang = await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 7000), K());
  assert.equal(bayarUlang.status, 201, JSON.stringify(bayarUlang.body));
});

test("Void GANDA pada payout yang sama DITOLAK", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  const line = snap.lines[0];
  const bayar = await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 7000), K());
  await f.admin.api.post(`/api/armada/incentive-payouts/${bayar.body.id}/void`, { reason: "pertama" }, K());

  const void2 = await f.admin.api.post(`/api/armada/incentive-payouts/${bayar.body.id}/void`, { reason: "kedua" }, K());
  assert.equal(void2.status, 409, JSON.stringify(void2.body));
});

// ── Permission ──────────────────────────────────────────────────────────
test("Unauthorized: SALES (tanpa permission payout apa pun) ditolak read/create/void", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  const line = snap.lines[0];

  const read = await f.sales.api.get("/api/armada/incentive-payouts/queue");
  assert.equal(read.status, 403);
  const create = await f.sales.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 1000), K());
  assert.equal(create.status, 403);
});

test("FINANCE bisa create TAPI TIDAK bisa void — pemisahan tugas", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  const line = snap.lines[0];
  const bayar = await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 7000), K());
  assert.equal(bayar.status, 201);

  const voidRes = await f.finance.api.post(`/api/armada/incentive-payouts/${bayar.body.id}/void`, { reason: "coba" }, K());
  assert.equal(voidRes.status, 403, JSON.stringify(voidRes.body));
});

// ── Rp0 tidak masuk antrean ─────────────────────────────────────────────
test("Snapshot Rp0 TIDAK muncul di antrean pembayaran Finance", async () => {
  const f = await fixtureDasar();
  // TIDAK ada job sama sekali di periode ini -> totalRupiah snapshot = 0.
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-02" });
  assert.equal(snap.totalRupiah, 0);

  const antrean = await f.finance.api.get("/api/armada/incentive-payouts/queue");
  assert.equal(antrean.status, 200, JSON.stringify(antrean.body));
  assert.ok(!antrean.body.snapshots.some((s) => s.id === snap.id), "snapshot Rp0 tidak boleh muncul di antrean");
});

test("Antrean pembayaran menampilkan progress dibayar/sisa per snapshot dan per orang", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  const line = snap.lines[0];
  await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(line.id, 3000), K());

  const antrean = await f.finance.api.get("/api/armada/incentive-payouts/queue");
  const s = antrean.body.snapshots.find((x) => x.id === snap.id);
  assert.ok(s);
  assert.equal(s.totalDibayar, 3000);
  assert.equal(s.totalSisa, 4000);
  assert.equal(s.status, "PARTIALLY_PAID");
});

test("Snapshot ditandai isTestData=true TIDAK muncul di antrean pembayaran walau APPROVED dan totalRupiah>0", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const snap = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  assert.ok(snap.totalRupiah > 0);
  // Field ini SENGAJA tidak punya endpoint publik (lihat catatan schema) —
  // disetel langsung lewat Prisma di sini, meniru skrip administratif.
  await testPrisma.incentiveSnapshot.update({ where: { id: snap.id }, data: { isTestData: true } });

  const antrean = await f.finance.api.get("/api/armada/incentive-payouts/queue");
  assert.ok(!antrean.body.snapshots.some((s) => s.id === snap.id), "snapshot isTestData=true tidak boleh muncul di antrean walau totalRupiah>0");
});

// ── Adjustment tetap terpisah ────────────────────────────────────────────
test("Adjustment snapshot punya line/payout SENDIRI, terpisah dari snapshot asal", async () => {
  const f = await fixtureDasar();
  const order = await buatOrder(f.customer.id);
  await buatJob({ orderId: order.id, driverId: f.driver.user.id, completedAt: "2026-09-05T02:00:00.000Z" });
  const asal = await buatSnapshotBerstatus(f, { from: "2026-09-01", to: "2026-09-10" });
  const lineAsal = asal.lines[0];
  await f.finance.api.post("/api/armada/incentive-payouts", badanPayout(lineAsal.id, 7000), K());

  const adjustRes = await f.finance.api.post(`/api/armada/incentive-snapshots/${asal.id}/adjust`, { mode: "custom", from: "2026-09-01", to: "2026-09-10", reason: "koreksi" }, K());
  assert.equal(adjustRes.status, 201, JSON.stringify(adjustRes.body));
  const adjustDetail = await f.finance.api.get(`/api/armada/incentive-snapshots/${adjustRes.body.id}`);
  const lineAdjust = adjustDetail.body.lines.find((l) => l.userId === f.driver.user.id);
  assert.equal(lineAdjust.dibayar, 0, "snapshot adjustment BELUM punya pembayaran sendiri — payout di snapshot asal tidak ikut ke adjustment");

  const asalDetail = await f.finance.api.get(`/api/armada/incentive-snapshots/${asal.id}`);
  const lineAsalTerbaru = asalDetail.body.lines.find((l) => l.id === lineAsal.id);
  assert.equal(lineAsalTerbaru.dibayar, 7000, "payout snapshot asal TIDAK terpengaruh oleh pembuatan adjustment");
});
