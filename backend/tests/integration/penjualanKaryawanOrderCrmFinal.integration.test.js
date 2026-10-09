// FINALISASI SINKRONISASI PENJUALAN KARYAWAN → ORDER CRM (9 Okt 2026), terhadap PostgreSQL sungguhan. Tiga blocker + audit trigger:
//  (1) SATU profil Customer internal per karyawan (Customer.staffUserId = ID akun, bukan nama/email), dua PKR = satu Customer + dua Order;
//  (2) order PKR yang belum lengkap diblokir sejak masuk Rencana Produksi (jadwal, PIC, target harian, mulai/rekam tahap) dengan pesan yang menyebut data yang kurang;
//  (3) rujukan PKR tampil di daftar Produksi tanpa bergantung flag V2, dan Unit 360 (V2 maupun non-V2) memakai bentuk yang sama;
//  (4) AUDIT TRIGGER: hanya posting customer (pembayaran/pengakuan pendapatan/refund) untuk order PKR yang ditolak; rollback transaksi + permintaan paralel; order biasa identik.
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
import { bacaSpesifikasiPkr } from "../../src/lib/domain/pkrSpesifikasi.js";
import { createOrderForCustomer } from "../../src/services/orderCreation.js";
import { buatAtauTautkanOrder } from "../../src/services/penjualanKaryawanOrder.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const kunci = () => ({ "Idempotency-Key": `pkr-${randomUUID()}` });
const V2 = "/api/production-v2";

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const seller = await testPrisma.user.create({ data: { name: "Emon Uji", email: `emon-${randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const peran = async (r) => { const u = await createTestUser({ roles: [r] }); return { id: u.user.id, c: makeClient(server.baseUrl, u.token) }; };
  const admin = await peran("ADMIN"); const finance = await peran("FINANCE"); const produksi = await peran("PRODUCTION_LEAD");
  return { rekening, seller, admin, finance, produksi };
}
const badan = (seller, extra = {}) => ({
  date: "2026-10-02", sellerId: seller.id, buyerName: "Bu Ani (kerabat)",
  items: [{ name: "Kasur Sano 160x200", quantity: 1, unitPrice: 1_300_000 }, { name: "Bantal", quantity: 2, unitPrice: 150_000 }], ...extra,
});
const LENGKAP = { kategori: "BARU", merk: "Sano", ukuran: "160 x 200", perluDikirim: true, alamat: "Jl. Mawar 5, Bekasi", kota: "Bekasi" };
const catatPkr = async (w, orderCrm, seller = w.seller, extra = {}) => {
  const r = await w.finance.c.post("/api/finance/penjualan-karyawan", badan(seller, { ...(orderCrm ? { orderCrm } : {}), ...extra }), kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};
async function jejak() {
  return { jurnal: await testPrisma.finJournalEntry.count(), payment: await testPrisma.payment.count(), invoice: await testPrisma.invoice.count(), item: await testPrisma.orderItem.count(), gap: await testPrisma.finPostingGap.count() };
}
const karyawanBaru = (nama) => testPrisma.user.create({ data: { name: nama, email: `${randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });

// ═══ 1. Satu profil Customer internal per karyawan ═══
test("dua PKR karyawan yang SAMA = SATU Customer + DUA Order berbeda (berurutan, paralel, dan setelah nama berubah); nama bukan identitas", async () => {
  const w = await siapkan();
  const biasa = await testPrisma.customer.create({ data: { name: "Emon Uji" } }); // pelanggan biasa bernama sama: tidak boleh dipakai ulang
  const p1 = await catatPkr(w, LENGKAP);
  const p2 = await catatPkr(w, LENGKAP, w.seller, { buyerName: "Pak Budi" });
  const staf = await testPrisma.customer.findMany({ where: { staffUserId: { not: null } } });
  assert.equal(staf.length, 1, "satu profil internal untuk satu karyawan");
  assert.equal(staf[0].staffUserId, w.seller.id);
  assert.notEqual(staf[0].id, biasa.id, "nama sama tidak membuat pelanggan biasa dipakai ulang");
  const orders = await testPrisma.order.findMany({ where: { penjualanKaryawanId: { not: null } }, orderBy: { createdAt: "asc" } });
  assert.equal(orders.length, 2);
  assert.notEqual(orders[0].id, orders[1].id);
  assert.notEqual(orders[0].orderNumber, orders[1].orderNumber);
  assert.ok(orders.every((o) => o.customerId === staf[0].id), "kedua order memakai profil yang sama");
  assert.deepEqual(new Set(orders.map((o) => o.penjualanKaryawanId)), new Set([p1.id, p2.id]), "tiap PKR tetap punya order sendiri");
  assert.equal(await testPrisma.unit.count(), 2);
  assert.deepEqual(new Set(orders.map((o) => JSON.parse(o.notes).pembeliPkr)), new Set(["Bu Ani (kerabat)", "Pak Budi"]), "nama pembeli = snapshot per order");

  // Nama karyawan berubah: profil lama tetap dipakai (snapshot tidak ikut berubah, tidak dipakai mencocokkan).
  await testPrisma.user.update({ where: { id: w.seller.id }, data: { name: "Emon Baru" } });
  await catatPkr(w, LENGKAP, w.seller, { buyerName: "Bu Dewi" });
  assert.equal(await testPrisma.customer.count({ where: { staffUserId: w.seller.id } }), 1);
  assert.equal((await testPrisma.customer.findUnique({ where: { id: staf[0].id } })).name, "Emon Uji");

  // Karyawan LAIN bernama sama = profil sendiri (identitas = ID akun).
  const kembar = await karyawanBaru("Emon Baru");
  await catatPkr(w, LENGKAP, kembar);
  assert.equal(await testPrisma.customer.count({ where: { staffUserId: { not: null } } }), 2);

  // Paralel: tiga PKR serentak untuk karyawan baru = tetap satu profil, tiga order berbeda.
  const rani = await karyawanBaru("Rani Paralel");
  const hasil = await Promise.all([1, 2, 3].map((i) => w.finance.c.post("/api/finance/penjualan-karyawan", badan(rani, { buyerName: `Pembeli ${i}`, orderCrm: LENGKAP }), kunci())));
  assert.ok(hasil.every((r) => r.status === 201), JSON.stringify(hasil.map((r) => [r.status, r.body?.error])));
  assert.equal(await testPrisma.customer.count({ where: { staffUserId: rani.id } }), 1, "paralel tetap satu profil");
  assert.equal(await testPrisma.order.count({ where: { customer: { staffUserId: rani.id } } }), 3);
  assert.equal(await testPrisma.unit.count({ where: { order: { customer: { staffUserId: rani.id } } } }), 3);
  const j = await jejak();
  assert.equal(j.payment + j.invoice + j.item + j.gap, 0);
});

test("profil internal karyawan: bukan lead di papan pipeline; PKR lama (aksi eksplisit) memakai profil yang sama tanpa Customer baru", async () => {
  const w = await siapkan();
  await catatPkr(w, LENGKAP);
  const lama = await testPrisma.finPenjualanKaryawan.create({
    data: { nomor: "PKR-01102026-020", date: new Date("2026-10-01"), sellerId: w.seller.id, buyerName: "Pak Hendra", total: 500_000, items: { create: [{ name: "Bantal", quantity: 1, unitPrice: 500_000 }] } },
  });
  const b = await w.finance.c.post(`/api/finance/penjualan-karyawan/${lama.id}/order-crm`, { spesifikasi: LENGKAP }, kunci());
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal(await testPrisma.customer.count(), 1);
  assert.equal(await testPrisma.order.count({ where: { penjualanKaryawanId: { not: null } } }), 2);
  const papan = await w.admin.c.get("/api/pipeline/board");
  assert.equal(papan.status, 200);
  assert.equal(JSON.stringify(papan.body).includes("Emon Uji"), false, "profil karyawan bukan lead di papan pipeline");
});

// ═══ 2. Rencana Produksi: order PKR belum lengkap diblokir sejak masuk Rencana ═══
async function siapkanRencana() {
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-PKR-${randomUUID().slice(0, 6)}`, name: "Workshop Utama" } });
  const u = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  await testPrisma.userRole.create({ data: { userId: u.user.id, role: "PRODUCTION_WORKER" } });
  const operator = await testPrisma.productionOperator.create({ data: { userId: u.user.id, primaryWorkCenterId: workCenter.id, active: true } });
  const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  return { workCenter, operator, lead: makeClient(server.baseUrl, lead.token) };
}
async function aktifkanCohort(...unitIds) {
  for (const key of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
    const data = { enabled: true, scope: "GLOBAL", config: { unitIds }, reason: "uji PKR rencana" };
    await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, ...data }, update: data });
  }
}
const jadwal = (r, unitId, over = {}) => ({ unitId, productionDate: "2026-10-20", stationCode: "TABLE_1", priority: 0, workCenterId: r.workCenter.id, operatorId: r.operator.id, ...over });
const itemRencana = async (r, unitId) => (await r.lead.get(`${V2}/backlog?pageSize=100`)).body.items.find((i) => i.unitId === unitId);
const idemRencana = () => ({ "Idempotency-Key": `pkr-rencana-${randomUUID()}` });

test("Rencana: order PKR belum lengkap TIDAK bisa dijadwalkan (pesan menyebut data yang kurang); setelah dilengkapi bisa dijadwalkan TANPA Order/Unit/Customer baru", async () => {
  const w = await siapkan();
  const r = await siapkanRencana();
  const p = await catatPkr(w, undefined);
  const unit = await testPrisma.unit.findFirst();
  await aktifkanCohort(unit.id);
  const hitung = async () => ({ order: await testPrisma.order.count(), unit: await testPrisma.unit.count(), customer: await testPrisma.customer.count(), run: await testPrisma.productionRun.count(), plan: await testPrisma.productionRunPlan.count(), cmd: await testPrisma.v2Command.count() });
  const awal = await hitung();

  let it = await itemRencana(r, unit.id);
  assert.equal(it.rencana.action, "EXCEPTION");
  assert.equal(it.rencana.code, "PKR_PERLU_DILENGKAPI");
  for (const k of ["Merk kasur", "Ukuran", "Dikirim atau diambil sendiri"]) assert.match(it.rencana.message, new RegExp(k));
  assert.equal(it.schedulable, false); assert.equal(it.rencana.onboardable, false);

  const gagal = await r.lead.post(`${V2}/plans`, jadwal(r, unit.id), idemRencana());
  assert.equal(gagal.status, 422, JSON.stringify(gagal.body));
  assert.match(gagal.body.error, /perlu dilengkapi dulu/);
  assert.match(gagal.body.error, /Merk kasur, Ukuran, Dikirim atau diambil sendiri/);
  assert.deepEqual(await hitung(), awal, "penolakan tidak menulis apa pun (tanpa Run, rencana, atau command)");

  // Pintu lain ke jadwal: target harian V1.
  const tgt = await w.produksi.c.post("/api/production/targets", { unitIds: [unit.id] });
  assert.equal(tgt.status, 422, JSON.stringify(tgt.body));
  assert.match(tgt.body.error, /perlu dilengkapi dulu/);
  assert.equal(await testPrisma.productionTarget.count(), 0);

  // Lengkapi lewat jalur Finance yang sama — tidak membuat dokumen baru.
  const l = await w.finance.c.put(`/api/finance/penjualan-karyawan/${p.id}/order-crm`, { merk: "Sano", ukuran: "160 x 200", perluDikirim: false }, kunci());
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.deepEqual({ order: await testPrisma.order.count(), unit: await testPrisma.unit.count(), customer: await testPrisma.customer.count() }, { order: awal.order, unit: awal.unit, customer: awal.customer });
  it = await itemRencana(r, unit.id);
  assert.equal(it.rencana.action, "ONBOARD_SCHEDULE", JSON.stringify(it.rencana));
  assert.equal(it.rencana.onboardable, true);

  const ok = await r.lead.post(`${V2}/plans`, jadwal(r, unit.id), idemRencana());
  assert.ok([200, 201].includes(ok.status), JSON.stringify(ok.body));
  const akhir = await hitung();
  assert.equal(akhir.run, 1); assert.equal(akhir.plan, 1);
  assert.deepEqual({ order: akhir.order, unit: akhir.unit, customer: akhir.customer }, { order: 1, unit: 1, customer: 1 }, "tidak ada Order/Unit/Customer baru");
  assert.equal((await jejak()).jurnal, 1, "jadwal Produksi tidak menyentuh uang");
});

test("Rencana: unit PKR yang sudah terjadwal lalu spesifikasinya dikosongkan lagi = penjadwalan ulang/PIC ditolak dengan pesan data yang kurang; jadwal lama tidak berubah", async () => {
  const w = await siapkan();
  const r = await siapkanRencana();
  const p = await catatPkr(w, { ...LENGKAP, perluDikirim: false });
  const unit = await testPrisma.unit.findFirst();
  await aktifkanCohort(unit.id);
  const ok = await r.lead.post(`${V2}/plans`, jadwal(r, unit.id), idemRencana());
  assert.ok([200, 201].includes(ok.status), JSON.stringify(ok.body));
  const plan = await testPrisma.productionRunPlan.findFirst();
  await w.finance.c.put(`/api/finance/penjualan-karyawan/${p.id}/order-crm`, { merk: "" }, kunci());
  assert.equal(bacaSpesifikasiPkr(await testPrisma.order.findFirst()).lengkap, false);
  const pindah = await r.lead.post(`${V2}/plans/${plan.id}/schedule`, { productionDate: "2026-10-21", stationCode: "TABLE_2", priority: 0, workCenterId: r.workCenter.id, operatorId: r.operator.id, expectedRevision: plan.revision }, idemRencana());
  assert.equal(pindah.status, 422, JSON.stringify(pindah.body));
  assert.match(pindah.body.error, /Merk kasur/);
  assert.equal((await testPrisma.productionRunPlan.findUnique({ where: { id: plan.id } })).stationCode, "TABLE_1", "jadwal lama tidak berubah");
});

// ═══ 3. Rujukan PKR di daftar Produksi TANPA bergantung flag V2 ═══
test("daftar Produksi menampilkan rujukan PKR walau flag V2 mati; Unit 360 (non-V2 dan V2) memakai bentuk yang sama; order biasa tanpa rujukan", async () => {
  const w = await siapkan();
  const r = await siapkanRencana();
  const p = await catatPkr(w, undefined);
  const biasa = await testPrisma.customer.create({ data: { name: "Pelanggan Biasa" } });
  const ob = await createOrderForCustomer(biasa.id, { category: "BARU", unitCount: 1 }, w.admin.id);
  const unit = await testPrisma.unit.findFirst({ where: { order: { penjualanKaryawanId: p.id } } });
  const unitBiasa = await testPrisma.unit.findFirst({ where: { orderId: ob.id } });
  assert.equal(await testPrisma.v2FeatureFlag.count(), 0, "tanpa flag V2");

  const cocok = (x) => {
    assert.ok(x, "rujukan ada");
    for (const [k, v] of Object.entries({ nomor: p.nomor, karyawan: "Emon Uji", pembeli: "Bu Ani (kerabat)", kirimLabel: "Belum ditentukan", lengkap: false })) assert.equal(x[k], v, k);
    assert.deepEqual(x.kurang, ["Merk kasur", "Ukuran", "Dikirim atau diambil sendiri"]);
    assert.equal(JSON.stringify(x).includes("1600000"), false, "tanpa nominal");
  };

  const bl = await itemRencana(r, unit.id);
  cocok(bl.card.penjualanKaryawan);
  assert.equal((await itemRencana(r, unitBiasa.id)).card.penjualanKaryawan, null);

  const wo = await w.produksi.c.get("/api/production/work-orders?displayStatus=DIPROSES&pageSize=100");
  assert.equal(wo.status, 200, JSON.stringify(wo.body));
  cocok(wo.body.units.find((u) => u.id === unit.id).penjualanKaryawan);
  assert.equal(wo.body.units.find((u) => u.id === unitBiasa.id).penjualanKaryawan, null);

  const board = await w.produksi.c.get("/api/production/board");
  assert.equal(board.status, 200);
  cocok(board.body.available.find((u) => u.id === unit.id).penjualanKaryawan);

  const tl = await w.produksi.c.get(`/api/units/${unit.id}/timeline`);
  assert.equal(tl.status, 200, JSON.stringify(tl.body));
  cocok(tl.body.penjualanKaryawan);
  assert.equal((await w.produksi.c.get(`/api/units/${unitBiasa.id}/timeline`)).body.penjualanKaryawan, null);

  await w.finance.c.put(`/api/finance/penjualan-karyawan/${p.id}/order-crm`, { merk: "Sano", ukuran: "160 x 200", perluDikirim: true, alamat: "Jl. Mawar 5" }, kunci());
  const bl2 = await itemRencana(r, unit.id);
  assert.equal(bl2.card.penjualanKaryawan.kirimLabel, "Dikirim"); assert.equal(bl2.card.penjualanKaryawan.lengkap, true); assert.deepEqual(bl2.card.penjualanKaryawan.kurang, []);

  await aktifkanCohort(unit.id);
  const ov = await r.lead.get(`${V2}/units/${unit.id}/overview`);
  assert.equal(ov.status, 200, JSON.stringify(ov.body));
  assert.deepEqual(ov.body.identity.penjualanKaryawan, bl2.card.penjualanKaryawan, "Unit 360 V2 menampilkan rujukan yang sama dengan daftar");
});

// ═══ 4. AUDIT TRIGGER DB ═══
const BATAL_UJI = "BATAL_UJI_ROLLBACK";
async function cobaDalamTransaksi(fn) { // selalu dibatalkan: membuktikan lolos/ditolak tanpa meninggalkan data
  try { await testPrisma.$transaction(async (tx) => { await fn(tx); throw new Error(BATAL_UJI); }); return { lolos: false, galat: "tak terduga" }; }
  catch (e) { return e.message === BATAL_UJI ? { lolos: true } : { lolos: false, galat: e.message }; }
}
const sisipEntri = (tx, { sumber, orderId, akunId }) => tx.finJournalEntry.create({
  data: { entryNumber: `JV-UJI-${randomUUID().slice(0, 8)}`, date: new Date("2026-10-09"), description: "uji", source: sumber, sourceId: randomUUID(), lines: { create: [{ lineNo: 1, accountId: akunId, debit: 1000, credit: 0, orderId }] } },
});

test("AUDIT TRIGGER: hanya posting customer (pembayaran/pengakuan pendapatan/refund) untuk order PKR yang ditolak; jurnal resmi PKR, biaya operasional, dan order biasa lolos", async () => {
  const w = await siapkan();
  const p = await catatPkr(w, LENGKAP);
  const orderPkr = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: p.id } });
  const cust = await testPrisma.customer.create({ data: { name: "Pelanggan Biasa" } });
  const orderBiasa = await testPrisma.order.create({ data: { customerId: cust.id, value: 100_000, status: "PENDING" } });
  const akun = await testPrisma.finAccount.findFirst();
  const TOLAK = /hanya dokumen operasional/;

  for (const sumber of ["PEMBAYARAN_ORDER", "PENGAKUAN_PENDAPATAN", "REFUND"]) {
    const h = await cobaDalamTransaksi((tx) => sisipEntri(tx, { sumber, orderId: orderPkr.id, akunId: akun.id }));
    assert.equal(h.lolos, false, `${sumber} untuk order PKR harus ditolak`); assert.match(h.galat, TOLAK);
  }
  // Sisi yang SENGAJA diizinkan: jurnal resmi PKR (dan balikannya) serta biaya operasional bertanda order PKR.
  for (const sumber of ["PENJUALAN_KARYAWAN", "PEMBAYARAN_PENJUALAN_KARYAWAN", "REVERSAL", "PENGELUARAN", "BIAYA_KENDARAAN", "INSENTIF_DRIVER", "PEMAKAIAN_BAHAN"]) {
    const h = await cobaDalamTransaksi((tx) => sisipEntri(tx, { sumber, orderId: orderPkr.id, akunId: akun.id }));
    assert.equal(h.lolos, true, `${sumber} untuk order PKR harus lolos: ${h.galat}`);
  }
  // Order BIASA: semua sumber lolos (identik dengan sebelum fitur).
  for (const sumber of ["PEMBAYARAN_ORDER", "PENGAKUAN_PENDAPATAN", "REFUND", "PENGELUARAN"]) {
    const h = await cobaDalamTransaksi((tx) => sisipEntri(tx, { sumber, orderId: orderBiasa.id, akunId: akun.id }));
    assert.equal(h.lolos, true, `${sumber} untuk order biasa harus lolos: ${h.galat}`);
  }
  assert.equal(await testPrisma.finJournalLine.count({ where: { orderId: { not: null } } }), 0, "semua percobaan dibatalkan");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENJUALAN_KARYAWAN" } }), 1, "jurnal resmi PKR utuh");

  // payments / alokasi: INSERT dan UPDATE order_id ke order PKR ditolak; UPDATE kolom lain pada pembayaran order biasa tidak terpengaruh.
  const user = await testPrisma.user.findFirst();
  const bayar = await testPrisma.payment.create({ data: { orderId: orderBiasa.id, amount: 1000, method: "CASH", recordedById: user.id } });
  await assert.rejects(() => testPrisma.payment.update({ where: { id: bayar.id }, data: { orderId: orderPkr.id } }), TOLAK);
  await assert.rejects(() => testPrisma.finPaymentAllocation.create({ data: { paymentId: bayar.id, orderId: orderPkr.id, amount: 500 } }), TOLAK);
  await testPrisma.payment.update({ where: { id: bayar.id }, data: { cancelledAt: new Date() } });
  await testPrisma.finPaymentAllocation.create({ data: { paymentId: bayar.id, orderId: orderBiasa.id, amount: 500 } });
  assert.equal((await testPrisma.payment.findUnique({ where: { id: bayar.id } })).orderId, orderBiasa.id);
});

test("AUDIT TRIGGER: PKR (jurnal, pembayaran, pembatalan + jurnal balik) berjalan utuh bersama order tertaut — tidak ada jurnal resmi yang tertahan", async () => {
  const w = await siapkan();
  const p = await catatPkr(w, LENGKAP);
  const bayar = await w.finance.c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran`, { date: "2026-10-03", amount: 600_000, method: "TRANSFER", cashAccountId: w.rekening.id }, kunci());
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  const pid = bayar.body.pembayaran?.[0]?.id ?? (await testPrisma.finPenjualanKaryawanPayment.findFirst()).id;
  const batalBayar = await w.admin.c.post(`/api/finance/penjualan-karyawan/${p.id}/pembayaran/${pid}/batal`, { reason: "uji jurnal balik pembayaran" }, kunci());
  assert.equal(batalBayar.status, 200, JSON.stringify(batalBayar.body));
  const batal = await w.admin.c.post(`/api/finance/penjualan-karyawan/${p.id}/batal`, { reason: "uji jurnal balik" }, kunci());
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  const per = await testPrisma.finJournalEntry.groupBy({ by: ["source"], _count: { _all: true } });
  const jml = Object.fromEntries(per.map((x) => [x.source, x._count._all]));
  assert.equal(jml.PENJUALAN_KARYAWAN, 1); assert.equal(jml.PEMBAYARAN_PENJUALAN_KARYAWAN, 1);
  assert.ok(jml.REVERSAL >= 2, "jurnal balik pembayaran dan penjualan terbentuk");
  assert.equal(await testPrisma.payment.count(), 0);
});

test("ROLLBACK: kegagalan di tengah pembuatan (HTTP) membatalkan PKR, jurnal, order, unit, dan profil; kegagalan di transaksi service ikut membatalkan; percobaan ulang berhasil", async () => {
  const w = await siapkan();
  const hitung = async () => ({ pkr: await testPrisma.finPenjualanKaryawan.count(), jurnal: await testPrisma.finJournalEntry.count(), order: await testPrisma.order.count(), unit: await testPrisma.unit.count(), customer: await testPrisma.customer.count(), audit: await testPrisma.activityEvent.count({ where: { eventType: "PKR_ORDER_SINKRON" } }) });
  const nol = { pkr: 0, jurnal: 0, order: 0, unit: 0, customer: 0, audit: 0 };
  assert.deepEqual(await hitung(), nol);

  // (1) Kegagalan paksa di INSERT Order — setelah PKR + jurnal sudah ditulis dalam transaksi yang sama.
  await testPrisma.$executeRawUnsafe("CREATE FUNCTION fn_uji_gagal_order() RETURNS trigger AS $f$ BEGIN RAISE EXCEPTION 'uji gagal order'; END; $f$ LANGUAGE plpgsql");
  await testPrisma.$executeRawUnsafe('CREATE TRIGGER trg_uji_gagal_order BEFORE INSERT ON "Order" FOR EACH ROW EXECUTE FUNCTION fn_uji_gagal_order()');
  try {
    const r = await w.finance.c.post("/api/finance/penjualan-karyawan", badan(w.seller, { orderCrm: LENGKAP }), kunci());
    assert.ok(r.status >= 400, `harus gagal, dapat ${r.status}`);
    assert.deepEqual(await hitung(), nol, "TIDAK ada PKR/jurnal/order/unit/profil/audit yang tertinggal");
  } finally {
    await testPrisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS trg_uji_gagal_order ON "Order"');
    await testPrisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS fn_uji_gagal_order()");
  }
  const ulang = await w.finance.c.post("/api/finance/penjualan-karyawan", badan(w.seller, { orderCrm: LENGKAP }), kunci());
  assert.equal(ulang.status, 201, JSON.stringify(ulang.body));
  assert.deepEqual(await hitung(), { pkr: 1, jurnal: 1, order: 1, unit: 1, customer: 1, audit: 2 }, "percobaan ulang menghasilkan tepat satu set dokumen (audit: PKR + order)");

  // (2) Service di dalam transaksi pemanggil: galat setelah order dibuat membatalkan order, unit, dan profil baru.
  const lain = await karyawanBaru("Lina Rollback");
  const pkrLama = await testPrisma.finPenjualanKaryawan.create({ data: { nomor: "PKR-01102026-030", date: new Date("2026-10-01"), sellerId: lain.id, buyerName: "Pak X", total: 1000, items: { create: [{ name: "x", quantity: 1, unitPrice: 1000 }] } } });
  const sebelum = await hitung();
  await assert.rejects(() => testPrisma.$transaction(async (tx) => {
    await buatAtauTautkanOrder(tx, { penjualanId: pkrLama.id, userId: w.admin.id, spesifikasi: LENGKAP });
    const o = await tx.order.findFirst({ where: { penjualanKaryawanId: pkrLama.id } });
    await tx.payment.create({ data: { orderId: o.id, amount: 1, method: "CASH", recordedById: w.admin.id } }); // ditolak trigger
  }), /hanya dokumen operasional/);
  assert.deepEqual(await hitung(), sebelum, "transaksi dibatalkan utuh");
  assert.equal(await testPrisma.customer.count({ where: { staffUserId: lain.id } }), 0, "profil baru ikut dibatalkan");
  const ok = await w.finance.c.post(`/api/finance/penjualan-karyawan/${pkrLama.id}/order-crm`, { spesifikasi: LENGKAP }, kunci());
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(await testPrisma.customer.count({ where: { staffUserId: lain.id } }), 1);
});

test("PARALEL: buat + batal serentak untuk PKR yang sama tidak menghasilkan order ganda atau keadaan setengah jadi", async () => {
  const w = await siapkan();
  const lama = await testPrisma.finPenjualanKaryawan.create({ data: { nomor: "PKR-01102026-031", date: new Date("2026-10-01"), sellerId: w.seller.id, buyerName: "Pak Y", total: 5000, items: { create: [{ name: "x", quantity: 1, unitPrice: 5000 }] } } });
  const aksi = [
    ...[1, 2, 3].map(() => () => w.finance.c.post(`/api/finance/penjualan-karyawan/${lama.id}/order-crm`, { spesifikasi: LENGKAP }, kunci())),
    () => w.admin.c.post(`/api/finance/penjualan-karyawan/${lama.id}/batal`, { reason: "serentak" }, kunci()),
  ];
  const hasil = await Promise.all(aksi.map((f) => f()));
  assert.ok(hasil.every((r) => r.status < 500), JSON.stringify(hasil.map((r) => [r.status, r.body?.error])));
  assert.ok((await testPrisma.order.count({ where: { penjualanKaryawanId: lama.id } })) <= 1, "paling banyak satu order");
  const pkr = await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: lama.id } });
  const order = await testPrisma.order.findFirst({ where: { penjualanKaryawanId: lama.id } });
  if (pkr.status === "DIBATALKAN") assert.ok(!order || order.status === "CANCELLED", "PKR batal ⇒ tidak ada order aktif");
  assert.ok((await testPrisma.customer.count({ where: { staffUserId: w.seller.id } })) <= 1);
  const j = await jejak();
  assert.equal(j.payment + j.invoice + j.item, 0);
});

// ═══ 5. SQL uji-trigger milik skrip rilis dijalankan terhadap data contoh (sebelum pernah menyentuh produksi) ═══
test("SQL uji perilaku trigger pada skrip rilis: berjalan, membuktikan penolakan posting customer + kelolosan biaya/jurnal PKR/order biasa, dan tidak meninggalkan data", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = path.dirname(fileURLToPath(import.meta.url));
  const skrip = fs.readFileSync(path.resolve(here, "../../../scripts/release-penjualan-karyawan-order-crm.sh"), "utf8").replace(/\r/g, "");
  const m = /<<'TRIGSQL'\n([\s\S]*?)\nTRIGSQL\n/.exec(skrip);
  assert.ok(m, "blok TRIGSQL ada di skrip rilis");
  const w = await siapkan();
  const user = await testPrisma.user.findFirst();
  const akun = await testPrisma.finAccount.findFirst();
  const cust = await testPrisma.customer.create({ data: { name: "Pelanggan Contoh" } });
  for (let i = 0; i < 2; i++) {
    const o = await testPrisma.order.create({ data: { customerId: cust.id, value: 100_000, status: "PENDING" } });
    const bayar = await testPrisma.payment.create({ data: { orderId: o.id, amount: 1000, method: "CASH", recordedById: user.id } });
    await testPrisma.invoice.create({ data: { orderId: o.id, invoiceNumber: `INV-CTH-${i}` } });
    await testPrisma.orderItem.create({ data: { orderId: o.id, layananName: "Servis", harga: 1000 } });
    await testPrisma.finPaymentAllocation.create({ data: { paymentId: bayar.id, orderId: o.id, amount: 500 } });
    for (const sumber of ["PEMBAYARAN_ORDER", "PENGELUARAN"]) {
      await testPrisma.finJournalEntry.create({ data: { entryNumber: `JV-CTH-${sumber}-${i}`, date: new Date("2026-10-09"), description: "contoh", source: sumber, sourceId: randomUUID(), lines: { create: [{ lineNo: 1, accountId: akun.id, debit: 1000, credit: 0 }] } } });
    }
  }
  await catatPkr(w, LENGKAP); // memberi jurnal PENJUALAN_KARYAWAN resmi
  const sebelum = { order: await testPrisma.order.count(), pkr: await testPrisma.finPenjualanKaryawan.count(), payment: await testPrisma.payment.count(), garis: await testPrisma.finJournalLine.count() };
  // Hanya agar hasil terbaca lewat klien Prisma: NOTICE -> EXCEPTION. Perilaku (urutan uji, penolakan, rollback) tidak berubah.
  const sql = m[1].replace("RAISE NOTICE 'HASIL", "RAISE EXCEPTION 'HASIL").replace(/\n\s*RAISE EXCEPTION 'ROLLBACK_UJI';\n/, "\n");
  const galat = await testPrisma.$executeRawUnsafe(sql).then(() => null, (e) => e.message);
  assert.match(String(galat), /HASIL tolak=(\d+) lolos=(\d+) lewat=(\d+)/, `keluaran: ${galat}`);
  const [, tolak, lolos, lewat] = /HASIL tolak=(\d+) lolos=(\d+) lewat=(\d+)/.exec(galat).map(Number);
  assert.ok(tolak >= 5, `minimal 5 penolakan terbukti (payments, invoices, OrderItem, alokasi, jurnal pembayaran): ${tolak}`);
  assert.ok(lolos >= 3, `biaya operasional + jurnal resmi PKR + order biasa lolos: ${lolos}`);
  assert.equal(lewat, 0, "tidak ada pengujian yang terlewat karena kurang data contoh");
  assert.deepEqual({ order: await testPrisma.order.count(), pkr: await testPrisma.finPenjualanKaryawan.count(), payment: await testPrisma.payment.count(), garis: await testPrisma.finJournalLine.count() }, sebelum, "uji tidak meninggalkan apa pun");
  assert.equal(await testPrisma.finPenjualanKaryawan.count({ where: { nomor: "PKR-UJI-REHEARSAL" } }), 0);
});
