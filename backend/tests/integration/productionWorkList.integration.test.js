// DAFTAR KERJA Status Produksi (GET /api/production/work-list) + header Ruang Kerja Unit (GET /units/:id/ruang-kerja) — HTTP + DB sungguhan (DB uji terisolasi).
// Dibuktikan: satu baris per order dengan unit di dalamnya; order selesai/terkirim keluar dari antrean aktif (masuk Riwayat); status ORDER Sales apa adanya; posisi/kerja/tahap Meja tidak dicampur;
// perhatian utama dari fakta tercatat; pencarian/filter/urutan/halaman di server; BACA-SAJA; ketersediaan Dokumentasi + alasan jujur.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { openPendingArrivalIntakeV2InTx } from "../../src/services/unitCustodyCommandService.js";

const P = "/api/production";
const V2 = "/api/production-v2";
let server; let seq = 0; let w;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.beforeEach(async () => { await truncateAll(); w = await world(); });

const idem = (tag) => ({ "Idempotency-Key": `wl-${tag}-${++seq}-0000` });
async function setCohort(...ids) {
  for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
    const data = { enabled: true, scope: "GLOBAL", config: { unitIds: ids }, reason: "work-list test" };
    await testPrisma.v2FeatureFlag.upsert({ where: { key: k }, create: { key: k, ...data }, update: data });
  }
}
async function world() {
  const mk = async (role) => { const u = await createTestUser({ roles: [role] }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
  const [admin, sales, gudang] = await Promise.all([mk("ADMIN"), mk("SALES"), mk("WAREHOUSE")]);
  const wc = await testPrisma.workCenter.create({ data: { code: `WC-WL-${++seq}`, name: "Workshop Utama" } });
  const opU = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  await testPrisma.userRole.create({ data: { userId: opU.user.id, role: "PRODUCTION_WORKER" } });
  const op = await testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: opU.user.id, primaryWorkCenterId: wc.id, active: true } });
  return { admin, sales, gudang, wc, op };
}
// order + unit-unit. units: [{ status, pickup }]
async function mkOrder(nama, { status = "PROCESSING", locked = false, units = [{ status: "RECEIVED", pickup: true }], layanan = "Service Fondasi", pipelineStage = "NEW", internal = false, hariLalu = 0 } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: nama, pipelineStage, isInternalStaff: internal } });
  const order = await testPrisma.order.create({
    data: {
      customerId: customer.id, orderNumber: `WL-${++seq}`, value: 1_000_000, category: "LAYANAN", status, pickupConfirmedDate: new Date(), createdAt: new Date(Date.now() - hariLalu * 86_400_000),
      ...(locked ? { statusLocked: true, statusOverrideAt: new Date(), statusOverrideNote: "manual" } : {}), items: { create: [{ layananName: layanan, harga: 1_000_000, sortOrder: 1 }] },
    },
  });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", scheduledDate: new Date(), completedAt: new Date() } });
  const us = [];
  for (let i = 0; i < units.length; i += 1) {
    const u = await testPrisma.unit.create({ data: { unitCode: `${order.orderNumber}-U${i + 1}`, orderId: order.id, seq: i + 1, status: units[i].status, merk: "King Koil", ukuran: "160x200" } });
    if (units[i].pickup) await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: u.id } });
    us.push(u);
  }
  return { customer, order, units: us, unit: us[0] };
}
const daftar = async (qs = "", who = w.admin) => (await who.api.get(`${P}/work-list${qs}`)).body;
const cari = (d, order) => d.orders.find((o) => o.orderId === order.id);
const jumlahTabel = async () => Object.fromEntries(await Promise.all(["activityEvent", "productionRun", "productionUnitWorkProgress", "stockMovement", "unitCustodyHandoff", "domainOutbox", "v2Command"].map(async (a) => [a, await testPrisma[a].count()])));

test("W1. satu baris per order dengan unit di dalamnya; order selesai/terkirim tidak di antrean aktif; status order Sales apa adanya; perhatian dari fakta", async () => {
  const satu = await mkOrder("Bu Satu Unit");
  await w.admin.api.post(`${P}/units/${satu.unit.id}/work-progress`, { status: "DIKERJAKAN", expectedLatestId: null });
  const dua = await mkOrder("Pak Dua Unit", { status: "PICKUP", locked: true, units: [{ status: "RECEIVED", pickup: true }, { status: "AWAITING_PICKUP", pickup: false }] });
  const kirim = await mkOrder("Bu Terkirim", { status: "DELIVERED", units: [{ status: "DELIVERED", pickup: true }] });
  const campur = await mkOrder("Pak Campur", { units: [{ status: "DELIVERED", pickup: true }, { status: "RECEIVED", pickup: true }] });
  await mkOrder("Spam", { pipelineStage: "SPAM" }); await mkOrder("Staf", { internal: true }); await mkOrder("Batal", { status: "CANCELLED", units: [{ status: "CANCELLED", pickup: false }] });

  const d = await daftar();
  const ids = d.orders.map((o) => o.orderId);
  assert.ok([satu, dua, campur].every((x) => ids.includes(x.order.id)), "order aktif tampil");
  assert.ok(!ids.includes(kirim.order.id), "order terkirim tidak memenuhi antrean aktif");
  assert.equal(d.orders.length, 3, "spam/internal/batal tidak tampil"); assert.deepEqual(d.counts, { aktif: 3, riwayat: 1 });

  const os = cari(d, satu.order); assert.equal(os.units.length, 1); assert.equal(os.statusOrder.label, "Diproses"); assert.equal(os.units[0].kerja.key, "DIKERJAKAN"); assert.equal(os.units[0].kerja.source, "MANUAL");
  assert.equal(os.units[0].alurMeja, null, "pencatatan Admin saja: tidak ada tahap Meja yang dikarang"); assert.equal(os.pelanggan.nama, "Bu Satu Unit"); assert.deepEqual(os.layanan, ["Service Fondasi"]);

  const od = cari(d, dua.order);
  assert.equal(od.statusOrder.label, "Pengambilan"); assert.equal(od.statusOrder.terkunci, true); assert.equal(od.statusOrder.mentah, "PICKUP");
  assert.equal(od.units.length, 2); assert.equal(od.ringkas.jumlahAktif, 2);
  assert.equal(od.ringkas.perhatian.kode, "ORDER_MASIH_PENGAMBILAN", "tanpa alur Meja, \"belum diterima\" hanya catatan ringan — alasan yang lebih penting didahulukan"); assert.equal(od.ringkas.perhatian.unitCode, dua.units[0].unitCode); assert.equal(od.ringkas.tindakan.aksi, "OPEN_PLAN", "tanpa alur Meja, \"konfirmasi diterima\" bukan tindakan Admin di sini — diganti tindakan berdasarkan status kerja"); assert.equal(od.ringkas.unitUtamaId, dua.units[0].id);
  assert.equal(od.units[0].tindakan.aksi, "OPEN_PLAN"); assert.equal(od.units[0].posisi.key, "SUDAH_DIJEMPUT", "posisi fisik tetap apa adanya");
  assert.deepEqual(od.ringkas.posisi.map((p) => p.label).sort(), ["Menunggu dijemput", "Sudah dijemput · belum diterima workshop"]);
  const ou = od.units.find((u) => u.id === dua.units[1].id); assert.equal(ou.posisi.key, "MENUNGGU_DIJEMPUT"); assert.equal(ou.statusUnit, "Pengambilan");

  const oc = cari(d, campur.order); assert.equal(oc.units.length, 2, "semua unit order ikut tampil"); assert.equal(oc.ringkas.jumlahAktif, 1);
  assert.equal(oc.units.find((u) => u.status === "DELIVERED").perhatian, null);
  assert.equal(d.ringkas.unitAktif, 4);
});

test("W2. unit V2 punya tahap Meja; unit terkirim dengan pekerjaan Meja belum ditutup ditandai anomali dan tidak tampil sebagai tahap aktif", async () => {
  const lain = await mkOrder("Cohort Lain"); await setCohort(lain.unit.id);
  const v2 = await mkOrder("Bu V2");
  const akt = await w.admin.api.post(`${V2}/plans`, { unitId: v2.unit.id, productionDate: "2026-10-22", stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: w.op.id, activateUnit: true }, idem("akt"));
  assert.equal(akt.status, 201, JSON.stringify(akt.body));
  const stuck = await mkOrder("Bu Terkirim Tertinggal", { status: "DELIVERED", units: [{ status: "RECEIVED", pickup: true }] });
  await testPrisma.$transaction(async (tx) => { await openPendingArrivalIntakeV2InTx(tx, { unitId: stuck.unit.id }); await tx.unit.update({ where: { id: stuck.unit.id }, data: { status: "DELIVERED" } }); });

  const d = await daftar(); const ov = cari(d, v2.order); const uv = ov.units[0];
  assert.ok(uv.alurMeja); assert.equal(uv.alurMeja.status, "PENDING_ARRIVAL"); assert.equal(uv.alurMeja.statusLabel, "Menunggu unit diterima"); assert.equal(uv.alurMeja.tahap, null, "tahap tidak dikarang sebelum Run berjalan"); assert.equal(uv.alurMeja.meja, "TABLE_1");
  assert.equal(uv.posisi.key, "SUDAH_DIJEMPUT", "posisi fisik terpisah dari Run");
  assert.ok(!d.orders.some((o) => o.orderId === stuck.order.id), "unit terkirim tidak ada di antrean aktif");
  const r = await daftar("?scope=riwayat"); const os = cari(r, stuck.order); assert.ok(os, "tersedia di Riwayat");
  assert.equal(os.units[0].alurMeja, null); assert.equal(os.units[0].anomali.kode, "PEKERJAAN_MEJA_BELUM_DITUTUP"); assert.match(os.units[0].anomali.teks, /belum ditutup/);
});

test("W3. pencarian, filter, urutan, halaman (per order) di server; filter tak dikenal jatuh ke default", async () => {
  const a = await mkOrder("Ani Sentosa", { layanan: "Ganti Kain", hariLalu: 3 });
  const b = await mkOrder("Budi Santoso", { units: [{ status: "RECEIVED", pickup: true }, { status: "DELIVERED", pickup: true }], hariLalu: 2 });
  const c = await mkOrder("Citra Dewi", { status: "PICKUP", hariLalu: 1 });
  await w.admin.api.post(`${P}/units/${a.unit.id}/work-progress`, { status: "DIKERJAKAN", expectedLatestId: null });
  await testPrisma.unit.update({ where: { id: a.unit.id }, data: { productionDueAt: new Date(Date.now() - 2 * 86_400_000) } });

  assert.deepEqual((await daftar("?q=Santoso")).orders.map((o) => o.orderId), [b.order.id]);
  assert.deepEqual((await daftar("?q=ganti%20kain")).orders.map((o) => o.orderId), [a.order.id], "cari layanan Sales");
  assert.deepEqual((await daftar(`?q=${b.units[1].unitCode}`)).orders.map((o) => o.orderId), [b.order.id], "cari kode unit yang sudah terkirim tetap menemukan ordernya yang aktif");
  assert.equal((await daftar(`?q=${c.order.orderNumber}`)).orders.length, 1);
  assert.equal((await daftar("?q=tidak-ada-sama-sekali")).orders.length, 0);

  const all = await daftar();
  assert.equal(all.filterCounts.SEMUA, 3); assert.equal(all.filterCounts.LEWAT_TARGET, 1); assert.equal(all.filterCounts.DIKERJAKAN, 1);
  assert.deepEqual((await daftar("?filter=LEWAT_TARGET")).orders.map((o) => o.orderId), [a.order.id]);
  assert.deepEqual((await daftar("?filter=DIKERJAKAN")).orders.map((o) => o.orderId), [a.order.id]);
  assert.equal((await daftar("?filter=ASAL")).filter, "SEMUA"); assert.equal((await daftar("?sort=ASAL")).sort, "PERHATIAN");
  assert.equal((await daftar("?filter=PERLU_TINDAKAN")).total, all.filterCounts.PERLU_TINDAKAN);

  assert.equal(all.orders[0].orderId, a.order.id, "perhatian tinggi (lewat target) di paling atas");
  assert.deepEqual((await daftar("?sort=PELANGGAN")).orders.map((o) => o.pelanggan.nama), ["Ani Sentosa", "Budi Santoso", "Citra Dewi"]);
  assert.deepEqual((await daftar("?sort=TERBARU")).orders.map((o) => o.orderId), [c.order.id, b.order.id, a.order.id]);
  const h1 = await daftar("?sort=PELANGGAN&pageSize=2&page=1"); const h2 = await daftar("?sort=PELANGGAN&pageSize=2&page=2");
  assert.deepEqual([h1.orders.length, h1.hasMore, h1.total, h2.orders.length, h2.hasMore], [2, true, 3, 1, false]);
  assert.equal(h1.orders.flatMap((o) => o.units).length, 3, "halaman memuat semua unit dari order yang tampil (Ani 1 + Budi 2)");
});

test("W4. BACA-SAJA: membuka daftar, riwayat, dan ruang kerja tidak menulis apa pun; Sales boleh membaca; tanpa login ditolak", async () => {
  const k = await mkOrder("Bu Baca"); await mkOrder("Bu Kirim", { status: "DELIVERED", units: [{ status: "DELIVERED", pickup: true }] });
  const sebelum = await jumlahTabel();
  assert.equal((await w.sales.api.get(`${P}/work-list`)).status, 200);
  await daftar("?scope=riwayat"); await daftar("?q=Baca&filter=PERLU_TINDAKAN"); await w.admin.api.get(`${P}/units/${k.unit.id}/ruang-kerja`);
  assert.deepEqual(await jumlahTabel(), sebelum);
  const tanpa = await fetch(server.baseUrl + `${P}/work-list`); assert.equal(tanpa.status, 401);
  assert.equal((await w.admin.api.get(`${P}/units/bukan-uuid/ruang-kerja`)).status, 400);
  assert.equal((await w.admin.api.get(`${P}/units/00000000-0000-4000-8000-000000000000/ruang-kerja`)).status, 404);
});

test("W5. header ruang kerja unit: order Sales, unit lain, alur Meja, dan ketersediaan Dokumentasi dengan alasan jujur (tanpa tombol yang pasti gagal)", async () => {
  const lain = await mkOrder("Cohort Lain"); await setCohort(lain.unit.id);
  const polos = await mkOrder("Bu Polos", { status: "PICKUP", locked: true, units: [{ status: "RECEIVED", pickup: true }, { status: "AWAITING_PICKUP", pickup: false }] });
  const hp = (await w.admin.api.get(`${P}/units/${polos.unit.id}/ruang-kerja`)).body;
  assert.equal(hp.unit.unitCode, polos.unit.unitCode); assert.equal(hp.order.statusOrder.label, "Pengambilan"); assert.equal(hp.order.statusOrder.terkunci, true); assert.equal(hp.order.jumlahUnit, 2); assert.equal(hp.order.unitLain.length, 1);
  assert.equal(hp.alurMeja, null); assert.equal(hp.tindakan.aksi, "OPEN_PLAN"); assert.equal(hp.perhatian.kode, "ORDER_MASIH_PENGAMBILAN"); assert.deepEqual([hp.dokumentasi.tersedia, hp.dokumentasi.bolehUnggah, hp.dokumentasi.runId], [false, false, null]); assert.match(hp.dokumentasi.alasan, /setelah unit masuk alur Meja/);

  const v2 = await mkOrder("Bu V2");
  await w.admin.api.post(`${V2}/plans`, { unitId: v2.unit.id, productionDate: "2026-10-22", stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: w.op.id, activateUnit: true }, idem("akt2"));
  const hv = (await w.admin.api.get(`${P}/units/${v2.unit.id}/ruang-kerja`)).body;
  assert.equal(hv.alurMeja.status, "PENDING_ARRIVAL"); assert.equal(hv.tindakan.aksi, "CONFIRM_ARRIVAL", "ada pekerjaan Meja yang menunggu kedatangan → Terima Unit memang tindakan"); assert.equal(hv.perhatian.level, 3); assert.deepEqual([hv.dokumentasi.tersedia, hv.dokumentasi.bolehUnggah], [true, true]); assert.ok(hv.dokumentasi.runId); assert.equal(hv.izin.unggahDokumentasi, true);
  const hs = (await w.sales.api.get(`${P}/units/${v2.unit.id}/ruang-kerja`)).body;
  assert.deepEqual([hs.dokumentasi.tersedia, hs.dokumentasi.bolehUnggah], [true, false]); assert.match(hs.dokumentasi.alasan, /hanya bisa melihat/);
  await testPrisma.v2FeatureFlag.update({ where: { key: V2_FLAGS.PRODUCTION_READER }, data: { config: { unitIds: [lain.unit.id] } } });
  const hm = (await w.admin.api.get(`${P}/units/${v2.unit.id}/ruang-kerja`)).body; assert.equal(hm.dokumentasi.tersedia, false); assert.match(hm.dokumentasi.alasan, /belum menyala/);
});
