// KASUR SEWA BUKAN PEKERJAAN PRODUKSI (keputusan Owner 12 Nov 2026) — HTTP + DB sungguhan.
// Order/unit SEWA tidak muncul di Order Produksi (daftar, hitungan chip, hitungan status global, hitungan kelengkapan, ekspor), Papan Produksi, Command Center,
// Status Produksi (aktif/riwayat), Laporan Produksi, dan antrean HPP Order; di laporan laba dianggap selesai (HPP bahan Rp0). Unit LAYANAN biasa tidak berubah.
// Pengaman: unit dengan work_category kosong (semua unit lama) TETAP tampil — klausa ditulis positif, bukan NOT(...) yang membuang NULL.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { antreanHpp } from "../../src/services/finance/hppOrder.js";
import { bangunKonteks } from "../../src/services/laporanProduksi.js";
import { statusUnitHpp } from "../../src/lib/domain/hppOrder.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const wibHariIni = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

async function buatUnit({ nomor, kategori, status, orderStatus, workCategory = null }) {
  const { order, unit } = await createTestUnit({ status, ...(workCategory ? { workCategory } : {}) });
  await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: nomor, category: kategori, status: orderStatus } });
  return { order, unit };
}

async function dunia() {
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const a = makeClient(server.baseUrl, admin.token);
  // Unit LAYANAN biasa (work_category KOSONG seperti semua unit production) — harus tetap tampil di mana-mana.
  const layanan = await buatUnit({ nomor: "RES-UJI-LAY", kategori: "LAYANAN", status: "RECEIVED", orderStatus: "PROCESSING" });
  const layananSelesai = await buatUnit({ nomor: "RES-UJI-LAYOK", kategori: "LAYANAN", status: "DELIVERED", orderStatus: "DELIVERED" });
  // Unit SEWA dengan keadaan seperti di production: diambil kembali (RECEIVED), menunggu dikirim, sudah terkirim.
  const sewaDiambil = await buatUnit({ nomor: "SWS-UJI-001", kategori: "SEWA", status: "RECEIVED", orderStatus: "SEWA_DIAMBIL" });
  const sewaKirim = await buatUnit({ nomor: "SWS-UJI-002", kategori: "SEWA", status: "AWAITING_PICKUP", orderStatus: "SEWA_DIKIRIM" });
  const sewaTerkirim = await buatUnit({ nomor: "SWS-UJI-003", kategori: "SEWA", status: "DELIVERED", orderStatus: "DELIVERED" });
  // (Kolom unit work_category tidak bisa bernilai SEWA — CHECK units_work_category_chk hanya BARU/LAYANAN — jadi unit sewa selalu dikenali dari kategori order.)
  // Unit dengan kategori kolom unit LAYANAN pada order SEWA — kolom unit menang → tetap Produksi.
  const layananDiOrderSewa = await buatUnit({ nomor: "SWS-UJI-005", kategori: "SEWA", status: "RECEIVED", orderStatus: "SEWA_DIAMBIL", workCategory: "LAYANAN" });
  return { admin, a, layanan, layananSelesai, sewaDiambil, sewaKirim, sewaTerkirim, layananDiOrderSewa };
}
const SEWA = (w) => [w.sewaDiambil, w.sewaKirim, w.sewaTerkirim].map((x) => x.unit.unitCode);
const PRODUKSI = (w) => [w.layanan, w.layananSelesai, w.layananDiOrderSewa].map((x) => x.unit.unitCode);

test("S1. Order Produksi: daftar, total, hitungan chip & status global tanpa unit sewa; unit lama (work_category kosong) tetap tampil", async () => {
  const w = await dunia();
  const r = await w.a.get("/api/production/work-orders?pageSize=200");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const kode = r.body.units.map((u) => u.unitCode).sort();
  assert.deepEqual(kode, PRODUKSI(w).sort());
  assert.equal(r.body.total, 3);
  const jumlahChip = r.body.statusCounts.reduce((n, s) => n + s.count, 0);
  assert.equal(jumlahChip, 3, `hitungan status tidak boleh memuat unit sewa: ${JSON.stringify(r.body.statusCounts)}`);
  assert.equal(r.body.statusCounts.find((s) => s.status === "AWAITING_PICKUP"), undefined, "satu-satunya AWAITING_PICKUP adalah unit sewa");
  // pencarian langsung nomor sewa → kosong; filter status → tetap tanpa sewa
  const cari = await w.a.get("/api/production/work-orders?q=SWS-UJI-001");
  assert.equal(cari.body.total, 0);
  const diterima = await w.a.get("/api/production/work-orders?statusIn=RECEIVED&pageSize=200");
  assert.deepEqual(diterima.body.units.map((u) => u.unitCode).sort(), [w.layanan.unit.unitCode, w.layananDiOrderSewa.unit.unitCode].sort());
  // mode penuh (filter kelengkapan dihitung di server) juga tanpa sewa
  const penuh = await w.a.get("/api/production/work-orders?kelengkapan=BAHAN_BELUM_DICATAT&pageSize=200");
  assert.equal(penuh.status, 200);
  for (const u of penuh.body.units) assert.ok(!SEWA(w).includes(u.unitCode), `unit sewa ${u.unitCode} muncul sebagai kekurangan bahan`);
  const hitungGlobal = Object.values(r.body.globalStatusCounts).reduce((a, b) => a + b, 0);
  assert.ok(hitungGlobal <= 3, `status global memuat unit sewa: ${JSON.stringify(r.body.globalStatusCounts)}`);
});

test("S2. Hitungan kelengkapan dan ekspor Excel tanpa unit sewa", async () => {
  const w = await dunia();
  const k = await w.a.get("/api/production/work-orders/kelengkapan-hitung");
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.equal(k.body.totalUnit, 3);
  const x = await w.a.get("/api/production/work-orders/export.xlsx");
  assert.equal(x.status, 200);
});

test("S3. Papan Produksi & Command Center: unit sewa di workshop tidak dihitung", async () => {
  const w = await dunia();
  const b = await w.a.get("/api/production/board");
  assert.equal(b.status, 200, JSON.stringify(b.body));
  const tersedia = b.body.available.map((u) => u.unitCode).sort();
  assert.deepEqual(tersedia, [w.layanan.unit.unitCode, w.layananDiOrderSewa.unit.unitCode].sort());
  const cc = await w.a.get("/api/production/command-center");
  assert.equal(cc.status, 200, JSON.stringify(cc.body));
  assert.equal(cc.body.summary.unitsInWorkshop, 2, "hanya dua unit Produksi yang di workshop; unit sewa RECEIVED tidak dihitung");
});

test("S4. Status Produksi (per order): order sewa tidak ada di antrean aktif maupun riwayat", async () => {
  const w = await dunia();
  const aktif = await w.a.get("/api/production/work-list?pageSize=100");
  assert.equal(aktif.status, 200, JSON.stringify(aktif.body));
  const unitAktif = aktif.body.orders.flatMap((o) => (o.units ?? []).map((u) => u.unitCode));
  for (const s of SEWA(w)) assert.ok(!unitAktif.includes(s), `unit sewa ${s} ada di Status Produksi aktif`);
  assert.ok(unitAktif.includes(w.layanan.unit.unitCode));
  assert.ok(unitAktif.includes(w.layananDiOrderSewa.unit.unitCode), "unit LAYANAN pada order sewa (kolom unit) tetap pekerjaan Produksi");
  const riwayat = await w.a.get("/api/production/work-list?scope=riwayat&pageSize=100");
  assert.equal(riwayat.status, 200);
  const unitRiwayat = riwayat.body.orders.flatMap((o) => (o.units ?? []).map((u) => u.unitCode));
  assert.ok(!unitRiwayat.includes(w.sewaTerkirim.unit.unitCode));
  assert.ok(unitRiwayat.includes(w.layananSelesai.unit.unitCode));
  assert.equal(aktif.body.counts.aktif + aktif.body.counts.riwayat, 3, `hitungan order: ${JSON.stringify(aktif.body.counts)}`);
});

test("S5. Laporan Produksi: unit sewa tanpa pergerakan tidak ikut; unit sewa YANG PUNYA pergerakan stok tetap terlihat (biaya tidak hilang)", async () => {
  const w = await dunia();
  let k = await bangunKonteks(testPrisma, {});
  const kode = k.units.map((u) => u.unitCode);
  for (const s of SEWA(w)) assert.ok(!kode.includes(s), `unit sewa ${s} ada di laporan`);
  for (const p of PRODUKSI(w)) assert.ok(kode.includes(p));
  const m = await createTestMaterial({ code: "SW-BHN", name: "BAHAN UJI SEWA", unit: "PCS" }); await seedBalance(m.id, 10);
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ISSUE", qty: -1, unitId: w.sewaDiambil.unit.id, note: "uji" } });
  k = await bangunKonteks(testPrisma, {});
  assert.ok(k.units.map((u) => u.unitCode).includes(w.sewaDiambil.unit.unitCode), "biaya yang sudah tercatat pada unit sewa tidak boleh disembunyikan");
});

test("S6. Antrean HPP Order: unit sewa terkirim tidak masuk antrean; jumlah yang dilewati dilaporkan", async () => {
  const w = await dunia();
  const hari = wibHariIni();
  for (const x of [w.layananSelesai, w.sewaTerkirim]) {
    const job = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: x.order.id, status: "COMPLETED", completedAt: new Date() } });
    await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: x.unit.id } });
  }
  const r = await antreanHpp(testPrisma, { fromStr: hari, toStr: hari });
  assert.deepEqual(r.baris.map((b) => b.unitKode), [w.layananSelesai.unit.unitCode]);
  assert.equal(r.ringkasan.unit, 1);
  assert.equal(r.ringkasan.unitSewaDilewati, 1);
  const http = await w.a.get(`/api/finance/hpp-order/antrean?from=${hari}&to=${hari}`);
  assert.equal(http.status, 200, JSON.stringify(http.body));
  assert.equal(http.body.ringkasan.unit, 1);
});

test("S7. Status HPP unit sewa: tanpa baris = selesai (Rp0); dengan baris biaya = dinilai seperti biasa", () => {
  const kosong = statusUnitHpp({ bukanProduksi: true });
  assert.equal(kosong.key, "BUKAN_PRODUKSI"); assert.equal(kosong.lengkap, true); assert.equal(kosong.nilaiLengkap, 0);
  const biasa = statusUnitHpp({});
  assert.equal(biasa.key, "BELUM_ADA_PEMAKAIAN", "unit bukan sewa tidak berubah");
  const berbiaya = statusUnitHpp({ bukanProduksi: true, baris: [{ id: "x", status: "TANPA_HARGA", subtotal: null }] });
  assert.equal(berbiaya.key, "BELUM_LENGKAP", "biaya tercatat pada unit sewa tetap harus dilengkapi");
});

test("S8. Tanpa tulis: membaca semua layar tidak mengubah unit/order", async () => {
  const w = await dunia();
  const sebelum = JSON.stringify(await testPrisma.unit.findMany({ orderBy: { unitCode: "asc" }, select: { unitCode: true, status: true, workCategory: true, updatedAt: true } }));
  const sebelumO = JSON.stringify(await testPrisma.order.findMany({ orderBy: { orderNumber: "asc" }, select: { orderNumber: true, status: true, category: true } }));
  for (const u of ["/api/production/work-orders", "/api/production/work-orders/kelengkapan-hitung", "/api/production/board", "/api/production/command-center", "/api/production/work-list"]) assert.equal((await w.a.get(u)).status, 200, u);
  assert.equal(JSON.stringify(await testPrisma.unit.findMany({ orderBy: { unitCode: "asc" }, select: { unitCode: true, status: true, workCategory: true, updatedAt: true } })), sebelum);
  assert.equal(JSON.stringify(await testPrisma.order.findMany({ orderBy: { orderNumber: "asc" }, select: { orderNumber: true, status: true, category: true } })), sebelumO);
});

test("S9. Skrip cek rilis (scripts/cekSewaBukanProduksi.mjs) LULUS hanya dengan DATABASE_URL, sesi baca-saja, tanpa mengubah data", async () => {
  await dunia();
  const { execFile } = await import("node:child_process");
  const path = await import("node:path"); const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const sebelum = await testPrisma.$queryRawUnsafe("select count(*)::int n, max(updated_at)::text t from units");
  const hasil = await new Promise((resolve) => execFile(process.execPath, ["scripts/cekSewaBukanProduksi.mjs"], { cwd: root, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DATABASE_URL: process.env.DATABASE_URL } }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr })));
  assert.equal(hasil.code, 0, hasil.out);
  assert.match(hasil.out, /CEK ok    sesi DB baca-saja/);
  assert.match(hasil.out, /HASIL LULUS/);
  assert.deepEqual(await testPrisma.$queryRawUnsafe("select count(*)::int n, max(updated_at)::text t from units"), sebelum);
});
