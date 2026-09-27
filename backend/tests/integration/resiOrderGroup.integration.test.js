// RESI GABUNGAN Fase 2: OrderGroup (order_groups + orders.group_id) — dibuat atomik oleh Buat Resi; backfill bundle lama METADATA-ONLY, idempoten,
// dan terbukti tidak mengubah Order (selain group_id), Invoice, Payment, jurnal, Unit, Job.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { createOrderForCustomer } from "../../src/services/orderCreation.js";
import { attachOrderToInvoice } from "../../src/services/invoice.js";
import { SQL_ANGGOTA_BUNDLE, SQL_ANGGOTA_BUNDLE_PRA_MIGRASI, klasifikasiSemua, agregatKlasifikasi, terapkanBackfill } from "../../src/services/resiBackfill.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const nyalakan = (v = "true") => setSetting(testPrisma, SETTING_KEYS.RESI_INPUT_AKTIF, v);
const item = (extra = {}) => ({ merk: "Sano", ukuran: "160x200 cm (Queen)", keluhan: "Pegal", nominal: 1_000_000, unitCount: 1, catatan: "", ...extra });
const badan = (customerId, items, extra = {}) => ({ customerId, alamat: "Jl. Kemang 1/11", kota: "Jakarta Selatan", tautanLokasi: "https://maps.example/x", tanggalKirim: "2026-10-05", ongkirTambahan: 0, items, ...extra });

// Sidik jari isi tabel (tanpa group_id pada Order) — bukti bahwa backfill/resi tidak mengubah data lain.
const TABEL = [
  ['"Order"', "id", `- 'group_id'`], ["invoices", "id", ""], ["payments", "id", ""], ["fin_journal_entries", "id", ""], ["fin_journal_lines", "id", ""],
  ["fin_payment_allocations", "id", ""], ["units", "id", ""], ["jobs", "id", ""], ['"OrderItem"', "id", ""],
];
async function sidikJari(hanyaId = null) {
  const hasil = {};
  for (const [t, kunci, buang] of TABEL) {
    const filter = hanyaId && t === '"Order"' ? `where id = any($1::text[])` : "";
    const r = await testPrisma.$queryRawUnsafe(`select count(*)::int n, coalesce(md5(string_agg((to_jsonb(x) ${buang})::text, '|' order by ${kunci})), '') h from ${t} x ${filter}`, ...(filter ? [hanyaId] : []));
    hasil[t] = r[0];
  }
  return hasil;
}

async function pelanggan(nama = "Ibu Erni") { return testPrisma.customer.create({ data: { name: nama } }); }

// Bundle LAMA (tanpa grup): order dibuat lewat alur biasa lalu invoice digabung, persis seperti data produksi sebelum Fase 2.
async function bundleLama(customerId, userId, { n = 2, alamat = ["Jl. A 1", "Jl. A 1"], tanggal = ["2026-09-04", "2026-09-04"], ongkir = [] } = {}) {
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    const o = await createOrderForCustomer(customerId, { notes: "{}", unitCount: 1, deliveryAddress: alamat[i] ?? alamat[0], deliveryConfirmedDate: tanggal[i] ?? tanggal[0], ...(ongkir[i] && { ongkir: ongkir[i] }) }, userId);
    await testPrisma.order.update({ where: { id: o.id }, data: { value: 500_000 * (i + 1) } });
    ids.push(o.id);
  }
  await testPrisma.$transaction(async (tx) => { for (let i = 1; i < n; i += 1) await attachOrderToInvoice(tx, { sourceOrderId: ids[i], targetOrderId: ids[0], userId }); });
  return ids;
}
const muatKlasifikasi = async (sql = SQL_ANGGOTA_BUNDLE) => klasifikasiSemua((await testPrisma.$queryRawUnsafe(sql))[0].anggota);

// ── Buat Resi membuat OrderGroup ────────────────────────────────────────────────────────────────────────────────

test("Buat Resi membuat SATU OrderGroup (BARU) + N child dalam satu transaksi, dengan snapshot alamat/tanggal/ongkir/DP/anchor/pembuat", async () => {
  const sales = await createTestUser({ roles: ["SALES"] });
  const customer = await pelanggan();
  const c = makeClient(server.baseUrl, sales.token);
  await nyalakan();
  const r = await c.post("/api/resi", badan(customer.id, [item({ nominal: 1_000_000 }), item({ nominal: 500_000 }), item({ nominal: 250_001 })], { ongkirTambahan: 50_000 }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.groupId);

  const grup = await testPrisma.orderGroup.findMany({ include: { orders: { orderBy: { createdAt: "asc" } } } });
  assert.equal(grup.length, 1);
  const g = grup[0];
  assert.equal(g.id, r.body.groupId);
  assert.equal(g.source, "BARU");
  assert.equal(g.customerId, customer.id);
  assert.equal(g.createdById, sales.user.id);
  assert.equal(g.alamatKirim, "Jl. Kemang 1/11");
  assert.equal(g.kotaKirim, "Jakarta Selatan");
  assert.equal(g.tautanLokasi, "https://maps.example/x");
  assert.equal(g.tanggalKirim.toISOString().slice(0, 10), "2026-10-05");
  assert.equal(g.ongkirTambahan, 50_000);
  assert.equal(g.dpPersen, 30);
  assert.equal(g.dpTarget, 540_000, "30% × (1.750.001 + 50.000)");
  assert.equal(g.orders.length, 3);
  assert.equal(g.anchorOrderId, g.orders[0].id, "anchor = order pertama");
  assert.equal(g.orders.reduce((s, o) => s + (o.dpTarget ?? 0), 0), g.dpTarget, "Σ dpTarget child = dpTarget grup");
  assert.ok(g.orders.every((o) => o.customerId === customer.id));
});

test("Gagal di item terakhir → tidak ada OrderGroup tersisa (atomik bersama order)", async () => {
  const sales = await createTestUser({ roles: ["SALES"] });
  const customer = await pelanggan();
  await nyalakan();
  const r = await makeClient(server.baseUrl, sales.token).post("/api/resi", badan(customer.id, [item(), item(), item({ nominal: 3_000_000_000 })]));
  assert.equal(r.status, 500);
  assert.equal(await testPrisma.orderGroup.count(), 0);
  assert.equal(await testPrisma.order.count(), 0);
});

test("Flag mati: POST 403 dan tidak ada OrderGroup; order biasa (alur lama) tidak pernah punya groupId", async () => {
  const sales = await createTestUser({ roles: ["SALES"] });
  const customer = await pelanggan();
  const r = await makeClient(server.baseUrl, sales.token).post("/api/resi", badan(customer.id, [item()]));
  assert.equal(r.status, 403);
  assert.equal(await testPrisma.orderGroup.count(), 0);
  const biasa = await createOrderForCustomer(customer.id, { notes: "{}", unitCount: 1 }, sales.user.id);
  assert.equal((await testPrisma.order.findUnique({ where: { id: biasa.id } })).groupId, null);
});

test("Order lama & resi lain tidak berubah oleh pembuatan resi baru (sidik jari baris identik)", async () => {
  const sales = await createTestUser({ roles: ["SALES"] });
  const customer = await pelanggan();
  const lama = await bundleLama(customer.id, sales.user.id);
  const solo = await createOrderForCustomer(customer.id, { notes: "{}", unitCount: 1 }, sales.user.id);
  const semuaLama = [...lama, solo.id];
  const sebelum = await sidikJari(semuaLama);
  await nyalakan();
  const r = await makeClient(server.baseUrl, sales.token).post("/api/resi", badan(customer.id, [item(), item()]));
  assert.equal(r.status, 201);
  const sesudah = await sidikJari(semuaLama);
  assert.deepEqual(sesudah['"Order"'], sebelum['"Order"'], "baris order lama identik (termasuk updatedAt)");
  assert.equal((await testPrisma.orderGroup.count()), 1);
  assert.equal(await testPrisma.order.count({ where: { id: { in: semuaLama }, groupId: { not: null } } }), 0);
});

// ── klasifikasi bundle lama ─────────────────────────────────────────────────────────────────────────────────────

test("Klasifikasi: BISA, PERINGATAN (alamat/tanggal/batal/ongkir), TIDAK_BISA (customer campur, rantai) — beserta alasannya", async () => {
  const sales = await createTestUser({ roles: ["SALES"] });
  const a = await pelanggan("A"), b = await pelanggan("B"), cc = await pelanggan("C"), d = await pelanggan("D"), e = await pelanggan("E");
  const bisa = await bundleLama(a.id, sales.user.id);
  const alamatBeda = await bundleLama(b.id, sales.user.id, { alamat: ["Jl. A 1", "Jl. B 2"] });
  const tglBeda = await bundleLama(cc.id, sales.user.id, { tanggal: ["2026-09-04", "2026-09-06"] });
  const batal = await bundleLama(d.id, sales.user.id, { n: 3 });
  await testPrisma.order.update({ where: { id: batal[2] }, data: { status: "CANCELLED" } });
  const ongkirBanyak = await bundleLama(e.id, sales.user.id, { ongkir: [40_000, 60_000] });

  // customer campur & rantai dibuat lewat SQL mentah (attachOrderToInvoice menolaknya — justru itu yang dilindungi backfill)
  const x = await pelanggan("X"), y = await pelanggan("Y");
  const ox = await createOrderForCustomer(x.id, { notes: "{}", unitCount: 1 }, sales.user.id);
  const oy = await createOrderForCustomer(y.id, { notes: "{}", unitCount: 1 }, sales.user.id);
  await testPrisma.$executeRawUnsafe(`update invoices set combined_into_id = (select id from invoices where order_id = '${ox.id}') where order_id = '${oy.id}'`);
  const r1 = await createOrderForCustomer(x.id, { notes: "{}", unitCount: 1 }, sales.user.id);
  const r2 = await createOrderForCustomer(x.id, { notes: "{}", unitCount: 1 }, sales.user.id);
  const r3 = await createOrderForCustomer(x.id, { notes: "{}", unitCount: 1 }, sales.user.id);
  await testPrisma.$executeRawUnsafe(`update invoices set combined_into_id = (select id from invoices where order_id = '${r1.id}') where order_id = '${r2.id}'`);
  await testPrisma.$executeRawUnsafe(`update invoices set combined_into_id = (select id from invoices where order_id = '${r2.id}') where order_id = '${r3.id}'`);

  const hasil = await muatKlasifikasi();
  const cari = (orderId) => hasil.find((h) => h._anggota.some((m) => m.order_id === orderId));
  assert.equal(cari(bisa[0]).klas, "BISA");
  assert.deepEqual(cari(bisa[0]).alasan, []);
  assert.equal(cari(alamatBeda[0]).klas, "PERINGATAN");
  assert.deepEqual(cari(alamatBeda[0]).alasan, ["ALAMAT_BERBEDA"]);
  assert.deepEqual(cari(tglBeda[0]).alasan, ["TANGGAL_BERBEDA"]);
  assert.deepEqual(cari(batal[0]).alasan, ["ANGGOTA_DIBATALKAN"]);
  assert.deepEqual(cari(ongkirBanyak[0]).alasan, ["ONGKIR_TERSEBAR"]);
  assert.equal(cari(ox.id).klas, "TIDAK_BISA");
  assert.ok(cari(ox.id).alasan.includes("CUSTOMER_CAMPUR"));
  assert.equal(cari(r1.id).klas, "TIDAK_BISA");
  assert.ok(cari(r1.id).alasan.includes("RANTAI_BUNDLE"));

  const ag = agregatKlasifikasi(hasil);
  assert.equal(cari(r3.id).klas, "TIDAK_BISA", "ujung rantai terpecah menjadi bundle tanpa anchor");
  assert.ok(cari(r3.id).alasan.includes("ANCHOR_TIDAK_ADA"));
  assert.deepEqual(ag.perKlas, { BISA: 1, PERINGATAN: 4, TIDAK_BISA: 3, SUDAH_ADA: 0 });
  assert.equal(ag.bundle, 8);
  // varian SQL pra-migrasi (dipakai dry-run produksi sebelum kolom group_id ada) menghasilkan klasifikasi yang sama
  const pra = await muatKlasifikasi(SQL_ANGGOTA_BUNDLE_PRA_MIGRASI);
  assert.deepEqual(pra.map((h) => [h.klas, h.alasan]), hasil.map((h) => [h.klas, h.alasan]));
});

test("Dry-run murni baca-saja: mengklasifikasikan tanpa mengubah satu baris pun", async () => {
  const sales = await createTestUser({ roles: ["SALES"] });
  const a = await pelanggan();
  await bundleLama(a.id, sales.user.id);
  const sebelum = await sidikJari();
  const groupSebelum = await testPrisma.orderGroup.count();
  await muatKlasifikasi();
  assert.deepEqual(await sidikJari(), sebelum);
  assert.equal(await testPrisma.orderGroup.count(), groupSebelum);
});

// ── backfill metadata-only ──────────────────────────────────────────────────────────────────────────────────────

test("Backfill: hanya BISA (PERINGATAN bila diminta); metadata-only — hash Order (kecuali group_id), invoice, payment, jurnal, unit, job identik; idempoten", async () => {
  const sales = await createTestUser({ roles: ["SALES"] });
  const a = await pelanggan("A"), b = await pelanggan("B");
  const bisa = await bundleLama(a.id, sales.user.id, { n: 3 });
  const alamatBeda = await bundleLama(b.id, sales.user.id, { alamat: ["Jl. A 1", "Jl. B 2"] });
  const x = await pelanggan("X"), y = await pelanggan("Y");
  const ox = await createOrderForCustomer(x.id, { notes: "{}", unitCount: 1 }, sales.user.id);
  const oy = await createOrderForCustomer(y.id, { notes: "{}", unitCount: 1 }, sales.user.id);
  await testPrisma.$executeRawUnsafe(`update invoices set combined_into_id = (select id from invoices where order_id = '${ox.id}') where order_id = '${oy.id}'`);
  // ada payment pada salah satu anggota: backfill tidak boleh menyentuhnya
  await testPrisma.payment.create({ data: { orderId: bisa[1], amount: 100_000, method: "CASH", recordedById: sales.user.id } });

  const sebelum = await sidikJari();
  const hasil = await muatKlasifikasi();
  const r1 = await terapkanBackfill(testPrisma, hasil, { jalankanId: "uji-1" });
  assert.deepEqual(r1, { dibuat: 1, dilewati: 0, orderTersambung: 3 });
  const sesudah = await sidikJari();
  assert.deepEqual(sesudah, sebelum, "TIDAK ADA perubahan pada Order (selain group_id), invoice, payment, jurnal, alokasi, unit, job, item");

  const grup = await testPrisma.orderGroup.findMany({ include: { orders: true } });
  assert.equal(grup.length, 1);
  const g = grup[0];
  assert.equal(g.source, "BACKFILL_BUNDLE");
  assert.equal(g.customerId, a.id);
  assert.equal(g.anchorOrderId, bisa[0]);
  assert.equal(g.alamatKirim, "Jl. A 1");
  assert.equal(g.ongkirTambahan, null, "tidak ada kesepakatan resi pada bundle lama → NULL, bukan ditebak");
  assert.equal(g.dpPersen, null);
  assert.equal(g.createdById, null);
  assert.equal(g.metadata.backfill.klasifikasi, "BISA");
  assert.deepEqual(g.orders.map((o) => o.id).sort(), [...bisa].sort());
  assert.equal(await testPrisma.order.count({ where: { groupId: { not: null } } }), 3);
  assert.equal(await testPrisma.order.count({ where: { id: { in: alamatBeda }, groupId: { not: null } } }), 0, "PERINGATAN tidak ditulis tanpa opsi");
  assert.equal(await testPrisma.order.count({ where: { id: { in: [ox.id, oy.id] }, groupId: { not: null } } }), 0, "TIDAK_BISA tidak pernah ditulis");

  // idempoten: run ulang tidak membuat grup baru
  const hasil2 = await muatKlasifikasi();
  assert.equal(hasil2.filter((h) => h.klas === "SUDAH_ADA").length, 1);
  const r2 = await terapkanBackfill(testPrisma, hasil2, { jalankanId: "uji-2" });
  assert.deepEqual(r2, { dibuat: 0, dilewati: 0, orderTersambung: 0 });
  // penerapan dengan hasil basi (klasifikasi lama) juga aman: dicek ulang di dalam transaksi
  const r3 = await terapkanBackfill(testPrisma, hasil, { jalankanId: "uji-3" });
  assert.deepEqual(r3, { dibuat: 0, dilewati: 1, orderTersambung: 0 });
  assert.equal(await testPrisma.orderGroup.count(), 1);
  assert.deepEqual(await sidikJari(), sebelum);

  // dengan opsi peringatan: bundle beda alamat ikut, snapshot = alamat anchor, peringatan tercatat di metadata
  const r4 = await terapkanBackfill(testPrisma, await muatKlasifikasi(), { sertakanPeringatan: true, jalankanId: "uji-4" });
  assert.deepEqual(r4, { dibuat: 1, dilewati: 0, orderTersambung: 2 });
  const g2 = await testPrisma.orderGroup.findFirst({ where: { anchorOrderId: alamatBeda[0] } });
  assert.equal(g2.alamatKirim, "Jl. A 1");
  assert.deepEqual(g2.metadata.backfill.peringatan, ["ALAMAT_BERBEDA"]);
  assert.deepEqual(await sidikJari(), sebelum);
});
