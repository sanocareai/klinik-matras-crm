// AUDIT PENJUALAN KARYAWAN END-TO-END (Okt 2026) — PostgreSQL sungguhan + HTTP. Replika transaksi nyata PKR-11102026-005:
//   satu PKR, SATU Order CRM, TIGA unit (U1..U3), format LAMA (satu baris penjualan tanpa data pemenuhan, tanpa daftar item), ber-DP.
// Yang dikunci: (1) satu Order + tiga unit, bukan tiga resi; (2) Order Sales memuat nomor order, jumlah unit, kode unit, status per unit; (3) Rencana = tiga kartu terpisah yang masing-masing
// bisa dijadwalkan sendiri; (4) pembatalan: DP menahan (pembayaran TIDAK dibatalkan otomatis), produksi berjalan menahan, tanpa pembayaran lolos; (5) koreksi data order: alasan, pratinjau,
// revisi optimistis, Idempotency-Key, replay, dua penulis paralel, atomik dengan jurnal/unit/job tak berubah; (6) kunci setelah produksi/pengiriman berjalan; (7) format lama jujur
// (kemampuan koreksi) dan format terpadu: ubah jumlah 1→3→2 sinkron Finance + unit.
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
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const BASE = "/api/finance/penjualan-karyawan";
const V2 = "/api/production-v2";
const kunci = (p = "pkra") => ({ "Idempotency-Key": `${p}-${randomUUID()}` });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const seller = await testPrisma.user.create({ data: { name: "Emon Uji", email: `emon-${randomUUID()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  const peran = async (r) => { const u = await createTestUser({ roles: [r] }); return { id: u.user.id, name: u.user.name, c: makeClient(server.baseUrl, u.token) }; };
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-${randomUUID().slice(0, 6)}`, name: "Workshop Utama" } });
  const picUser = [];
  const operators = [];
  for (let i = 0; i < 3; i += 1) {
    const u = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
    picUser.push(u);
    operators.push(await testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: u.user.id, primaryWorkCenterId: workCenter.id, active: true } }));
  }
  return { rekening, seller, workCenter, operators, admin: await peran("ADMIN"), finance: await peran("FINANCE"), produksi: await peran("PRODUCTION_LEAD"), sales: await peran("SALES") };
}
// Replika PKR-11102026-005: SATU baris penjualan format lama (tanpa data pemenuhan), jumlahUnit 3, dikirim.
const LAMA = (over = {}) => ({
  date: "2026-10-11", buyerName: "Bu Ani (kerabat)",
  items: [{ name: "Kasur Sorong 3in1 custom", quantity: 3, unitPrice: 2_400_000 }],
  orderCrm: { kategori: "BARU", jumlahUnit: 3, merk: "Kasur Sorong 3in1 custom", ukuran: "120 x 200", perluDikirim: true, alamat: "Jl. Mawar 5, Bekasi", kota: "Bekasi", ...over },
});
async function catatLama(w, { dp = 0, extra = {} } = {}) {
  const r = await w.finance.c.post(BASE, { ...LAMA(), sellerId: w.seller.id, ...extra }, kunci());
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
  order: await testPrisma.order.count(), unit: await testPrisma.unit.count(), unitAktif: await testPrisma.unit.count({ where: { status: { not: "CANCELLED" } } }), job: await testPrisma.job.count(),
  jurnal: await testPrisma.finJournalEntry.count(), payment: await testPrisma.payment.count(), invoice: await testPrisma.invoice.count(), pkr: await testPrisma.finPenjualanKaryawan.count(),
  bayarPkr: await testPrisma.finPenjualanKaryawanPayment.count({ where: { cancelledAt: null } }),
});
const get = async (w, id, path = "") => w.finance.c.get(`${BASE}/${id}${path}`);
async function kemampuan(w, id) { const r = await get(w, id, "/kemampuan-koreksi"); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; }
const koreksi = (w, id, body, headers = kunci()) => w.finance.c.post(`${BASE}/${id}/koreksi-order`, body, headers);

// ═══ 1. Satu Order CRM dengan tiga unit — bukan tiga resi ═══
test("replika PKR-005: SATU PKR → SATU Order CRM → TIGA unit U1..U3; tanpa job/resi; satu jurnal; DP tercatat di ledger PKR (bukan di Order)", async () => {
  const w = await siapkan();
  const p = await catatLama(w, { dp: 2_500_000 });
  assert.equal(p.total, 7_200_000);
  const order = await orderDari(p.id);
  assert.ok(order?.orderNumber, "satu order CRM");
  assert.equal(order.value, 0, "order tidak membawa uang");
  const units = await unitDi(order.id);
  assert.equal(units.length, 3);
  assert.deepEqual(units.map((u) => u.unitCode), [1, 2, 3].map((n) => `${order.orderNumber}-U${n}`), "tiga unit satu order, kode U1..U3");
  assert.ok(units.every((u) => u.status === "RECEIVED" && u.currentStageId === null));
  const j = await jejak();
  assert.equal(j.order, 1); assert.equal(j.pkr, 1); assert.equal(j.job, 0, "tidak ada job/resi pengiriman");
  assert.equal(j.payment, 0); assert.equal(j.invoice, 0);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENJUALAN_KARYAWAN" } }), 1, "satu jurnal penjualan");
  assert.equal(j.bayarPkr, 1);
  const rows = await testPrisma.finPenjualanKaryawanItem.findMany({ where: { penjualanId: p.id } });
  assert.equal(rows.length, 1); assert.equal(rows[0].fulfillment, null, "format lama: baris tanpa data pemenuhan");
  assert.equal(await testPrisma.pkrOrderItem.count({ where: { orderId: order.id } }), 0, "format lama: tanpa daftar item operasional");
});

// ═══ 2. Order Sales menampilkan nomor order, jumlah unit, kode unit, status per unit ═══
test("daftar Order (CRM): ringkasan PKR memuat nomor Order CRM, jumlah unit, kode unit, dan status tiap unit (berbeda bila berbeda)", async () => {
  const w = await siapkan();
  const p = await catatLama(w, { dp: 2_500_000 });
  const order = await orderDari(p.id);
  const u = await unitDi(order.id);
  await testPrisma.unit.update({ where: { id: u[1].id }, data: { status: "IN_PRODUCTION" } });
  const r = await w.admin.c.get("/api/orders?limit=50");
  assert.equal(r.status, 200);
  const it = r.body.items.find((x) => x.id === order.id);
  assert.ok(it, "order tampil");
  const s = it.penjualanKaryawan;
  assert.equal(s.order.nomor, order.orderNumber, "nomor Order CRM");
  assert.equal(s.units.length, 3, "jumlah unit");
  assert.deepEqual(s.units.map((x) => x.kode), u.map((x) => x.unitCode), "daftar kode unit berurutan");
  assert.deepEqual(s.units.map((x) => x.status), ["RECEIVED", "IN_PRODUCTION", "RECEIVED"], "status tiap unit");
  assert.ok(s.units.every((x) => typeof x.label === "string" && x.label.length > 0), "label status berbahasa Indonesia");
  // Sales tanpa izin Finance: nomor/unit tetap tampil, nominal tidak.
  const sl = await w.sales.c.get("/api/orders?limit=50");
  if (sl.status === 200 && sl.body.items?.length) {
    const si = sl.body.items.find((x) => x.id === order.id);
    if (si) { assert.equal(si.penjualanKaryawan.units.length, 3); assert.equal(si.penjualanKaryawan.pembayaran.total, undefined); }
  }
});

// ═══ 3. Rencana Produksi: tiga kartu terpisah ═══
async function cohort(...unitIds) {
  for (const key of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
    const data = { enabled: true, scope: "GLOBAL", config: { unitIds }, reason: "uji audit PKR" };
    await testPrisma.v2FeatureFlag.upsert({ where: { key }, create: { key, ...data }, update: data });
  }
}
test("Rencana: tiga unit satu order = TIGA kartu terpisah; masing-masing dijadwalkan ke Meja/PIC/target sendiri; tidak ada order/resi/jurnal baru", async () => {
  const w = await siapkan();
  const p = await catatLama(w);
  const order = await orderDari(p.id);
  const units = await unitDi(order.id);
  await cohort(...units.map((u) => u.id));
  const sebelum = await jejak();

  const bl = await w.produksi.c.get(`${V2}/backlog?pageSize=100`);
  assert.equal(bl.status, 200, JSON.stringify(bl.body));
  const kartu = bl.body.items.filter((i) => units.some((u) => u.id === i.unitId));
  assert.equal(kartu.length, 3, "tiga kartu");
  assert.equal(new Set(kartu.map((k) => k.unitId)).size, 3, "unitId berbeda");
  assert.deepEqual(new Set(kartu.map((k) => k.card.customer.orderNumber)), new Set([order.orderNumber]), "satu nomor order");
  assert.deepEqual(kartu.map((k) => k.card.unit.unitCode).sort(), units.map((u) => u.unitCode).sort());
  assert.ok(kartu.every((k) => k.rencana?.onboardable === true), "tiap kartu bisa dijadwalkan sendiri");

  const rencana = [
    { unit: units[0], stationCode: "TABLE_1", operator: w.operators[0], productionDate: "2026-10-20", targetDate: "2026-10-22" },
    { unit: units[1], stationCode: "TABLE_2", operator: w.operators[1], productionDate: "2026-10-20", targetDate: "2026-10-25" },
    { unit: units[2], stationCode: "TABLE_3", operator: w.operators[2], productionDate: "2026-10-21", targetDate: "2026-10-27" },
  ];
  for (const r of rencana) {
    const res = await w.produksi.c.post(`${V2}/plans`, {
      unitId: r.unit.id, productionDate: r.productionDate, targetDate: r.targetDate, stationCode: r.stationCode, priority: 0, workCenterId: w.workCenter.id, operatorId: r.operator.id,
    }, kunci("rc"));
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  const plans = await testPrisma.productionRunPlan.findMany({ where: { run: { unitId: { in: units.map((u) => u.id) } } }, include: { run: true } });
  assert.equal(plans.length, 3, "tiga rencana");
  assert.equal(new Set(plans.map((x) => x.run.id)).size, 3, "tiga Run berbeda");
  assert.deepEqual(new Set(plans.map((x) => x.stationCode)), new Set(["TABLE_1", "TABLE_2", "TABLE_3"]));
  assert.equal(new Set(plans.map((x) => x.operatorId)).size, 3, "PIC masing-masing");
  assert.equal(new Set(plans.map((x) => x.targetDate?.toISOString().slice(0, 10))).size, 3, "target masing-masing");
  const sesudah = await jejak();
  assert.equal(sesudah.order, sebelum.order, "tidak ada order baru");
  assert.equal(sesudah.job, sebelum.job, "tidak ada job/resi baru");
  assert.equal(sesudah.jurnal, sebelum.jurnal, "tidak ada jurnal baru");
  assert.equal(sesudah.unit, sebelum.unit, "tidak ada unit baru");
  assert.equal(sesudah.pkr, sebelum.pkr);

  // Setelah tiga kartu terjadwal tetap tiga kartu terpisah di papan; jadwalkan ulang SATU tidak menyentuh dua lainnya.
  const papan = await w.produksi.c.get(`${V2}/board?date=2026-10-20`);
  assert.equal(papan.status, 200);
  const re = await w.produksi.c.post(`${V2}/plans/${plans.find((x) => x.run.unitId === units[0].id).id}/schedule`, {
    productionDate: "2026-10-20", stationCode: "TABLE_4", priority: 0, workCenterId: w.workCenter.id, operatorId: w.operators[2].id, expectedRevision: plans.find((x) => x.run.unitId === units[0].id).revision,
  }, kunci("rc"));
  assert.equal(re.status, 200, JSON.stringify(re.body));
  const lagi = await testPrisma.productionRunPlan.findMany({ where: { run: { unitId: { in: units.map((u) => u.id) } } }, include: { run: true } });
  const dua = lagi.filter((x) => x.run.unitId !== units[0].id).map((x) => `${x.stationCode}/${x.operatorId}/${x.targetDate?.toISOString().slice(0, 10)}`).sort();
  const duaAwal = plans.filter((x) => x.run.unitId !== units[0].id).map((x) => `${x.stationCode}/${x.operatorId}/${x.targetDate?.toISOString().slice(0, 10)}`).sort();
  assert.deepEqual(dua, duaAwal, "dua kartu lain tidak berubah");
});

// ═══ 4. Pembatalan ═══
test("pembatalan: pratinjau menjelaskan DP; DP menahan (409 PEMBAYARAN_AKTIF) dan pembayaran TIDAK dibatalkan/dikembalikan otomatis; setelah DP ditangani Finance, pembatalan lolos", async () => {
  const w = await siapkan();
  const p = await catatLama(w, { dp: 2_500_000 });
  const sebelum = await jejak();

  const pv = await get(w, p.id, "/pembatalan");
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.equal(pv.body.boleh, false);
  assert.equal(pv.body.pembayaranAktif.jumlah, 1); assert.equal(pv.body.pembayaranAktif.total, 2_500_000);
  const h = pv.body.hambatan.find((x) => x.kode === "PEMBAYARAN_AKTIF");
  assert.ok(h, "hambatan DP berkode");
  assert.equal(h.tindakan, "RIWAYAT_PEMBAYARAN");
  assert.match(h.pesan, /tidak dibatalkan atau dikembalikan otomatis/i);
  assert.match(h.pesan, /Riwayat Pembayaran/);

  const r = await w.admin.c.post(`${BASE}/${p.id}/batal`, { reason: "salah catat pembeli" }, kunci());
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, "PEMBAYARAN_AKTIF");
  assert.equal(r.body.pembayaranAktif?.jumlah, 1);
  assert.ok(Array.isArray(r.body.hambatan) && r.body.hambatan.length >= 1);
  assert.match(r.body.error, /Riwayat Pembayaran/);
  assert.deepEqual(await jejak(), sebelum, "ditolak sebelum menyentuh data: tidak ada jurnal/order/unit/pembayaran yang berubah");
  assert.equal((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } })).status, "AKTIF");
  const order = await orderDari(p.id);
  assert.equal(order.status, "PROCESSING");
  assert.equal(await testPrisma.finPenjualanKaryawanPayment.count({ where: { penjualanId: p.id, cancelledAt: null } }), 1, "DP tidak dibatalkan otomatis");

  // Finance menangani DP (jalur resmi yang sudah ada), baru pembatalan boleh.
  const pay = await testPrisma.finPenjualanKaryawanPayment.findFirst({ where: { penjualanId: p.id } });
  const bp = await w.admin.c.post(`${BASE}/${p.id}/pembayaran/${pay.id}/batal`, { reason: "DP dikembalikan ke pembeli" }, kunci());
  assert.equal(bp.status, 200, JSON.stringify(bp.body));
  const pv2 = await get(w, p.id, "/pembatalan");
  assert.equal(pv2.body.boleh, true);
  assert.ok(pv2.body.akanTerjadi.length >= 2);
  const ok = await w.admin.c.post(`${BASE}/${p.id}/batal`, { reason: "salah catat pembeli" }, kunci());
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await orderDari(p.id)).status, "CANCELLED");
  assert.ok((await unitDi(order.id)).every((u) => u.status === "CANCELLED"));
});

test("pembatalan tanpa pembayaran lolos; alasan wajib; produksi berjalan memblokir (409 PRODUKSI_DELIVERY_BERJALAN) tanpa mengubah apa pun", async () => {
  const w = await siapkan();
  const a = await catatLama(w);
  assert.equal((await w.admin.c.post(`${BASE}/${a.id}/batal`, {}, kunci())).status, 400);
  const sebelum = await jejak();
  const ok = await w.admin.c.post(`${BASE}/${a.id}/batal`, { reason: "dobel catat" }, kunci());
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const oa = await orderDari(a.id);
  assert.equal(oa.status, "CANCELLED");
  assert.ok((await unitDi(oa.id)).every((u) => u.status === "CANCELLED"));
  const sesudah = await jejak();
  assert.equal(sesudah.order, sebelum.order, "tidak ada order baru"); assert.equal(sesudah.unit, sebelum.unit);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 1, "satu jurnal pembalik");

  const b = await catatLama(w);
  const ob = await orderDari(b.id);
  const ub = await unitDi(ob.id);
  await testPrisma.unit.update({ where: { id: ub[0].id }, data: { status: "IN_PRODUCTION" } });
  const snap = await jejak();
  const pv = await get(w, b.id, "/pembatalan");
  assert.equal(pv.body.boleh, false);
  assert.ok(pv.body.hambatan.some((x) => x.kode === "PRODUKSI_DELIVERY_BERJALAN" && /sudah berjalan/.test(x.pesan)));
  const r = await w.admin.c.post(`${BASE}/${b.id}/batal`, { reason: "salah catat pembeli" }, kunci());
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, "PRODUKSI_DELIVERY_BERJALAN");
  assert.deepEqual(await jejak(), snap);
  assert.equal((await orderDari(b.id)).status, "PROCESSING");
  // Hanya FINANCE_ADMIN yang boleh membatalkan.
  assert.equal((await w.finance.c.post(`${BASE}/${b.id}/batal`, { reason: "coba batal" }, kunci())).status, 403);
});

// ═══ 5/6. Koreksi data order + kemampuan format lama ═══
test("format lama: kemampuan koreksi JUJUR — jumlah/harga/item terkunci dengan alasan + jalur resmi; alamat/kota/tanggal/catatan/merk/ukuran/dikirim bisa; migrasi belum tersedia", async () => {
  const w = await siapkan();
  const p = await catatLama(w, { dp: 2_500_000 });
  const k = await kemampuan(w, p.id);
  assert.equal(k.format, "LAMA_TANPA_ITEM");
  assert.equal(k.formatLama, true);
  assert.match(k.penjelasan, /Dicatat sebelum format item/);
  assert.equal(k.jumlah.boleh, false); assert.ok(k.jumlah.alasan.length > 20);
  assert.equal(k.harga.boleh, false);
  assert.equal(k.tambahHapusItem.boleh, false);
  for (const f of ["alamat", "kota", "tanggalKirim", "catatan", "perluDikirim", "merk", "ukuran"]) assert.equal(k.field[f].boleh, true, `field ${f} bisa dikoreksi`);
  assert.equal(k.field.alamat.nilai, "Jl. Mawar 5, Bekasi");
  assert.equal(k.migrasiFormat.tersedia, false);
  assert.match(k.migrasiFormat.alasan, /tidak ditebak/);
  assert.match(k.jalurResmi, /Riwayat Pembayaran/);
  assert.equal(k.revisi, 0);
  assert.equal(k.unit.length, 3);
});

test("koreksi data order: alasan wajib, Idempotency-Key wajib, pratinjau = penerapan, atomik (jurnal/unit/job/pembayaran tak berubah), notes order + catatan PKR sinkron, audit di dua entitas", async () => {
  const w = await siapkan();
  const p = await catatLama(w, { dp: 2_500_000 });
  const order = await orderDari(p.id);
  const sebelum = await jejak();
  const perubahan = { alamat: "Jl. Melati 9, Bandung", kota: "Bandung", tanggalKirim: "2026-10-30", catatan: "Customer minta kain abu polos", ukuran: "160 x 200" };

  const pv = await w.finance.c.post(`${BASE}/${p.id}/koreksi-order/pratinjau`, { perubahan, expectedRevision: 0 }, kunci());
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.equal(pv.body.boleh, true);
  assert.deepEqual(pv.body.perubahan.map((x) => x.field).sort(), ["alamat", "catatan", "kota", "tanggalKirim", "ukuran"]);
  assert.equal(pv.body.perubahan.find((x) => x.field === "alamat").sebelum, "Jl. Mawar 5, Bekasi");
  assert.equal(pv.body.dampak.unitDisinkronMerkUkuran, 3);
  assert.ok(pv.body.dampak.tidakBerubah.some((t) => /jurnal/i.test(t)));
  assert.deepEqual(await jejak(), sebelum, "pratinjau tidak menulis");

  // Validasi sebelum menyentuh data.
  assert.equal((await koreksi(w, p.id, { perubahan, expectedRevision: 0, alasan: "ok" })).status, 400, "alasan < 5 karakter");
  const tanpaKunci = await w.finance.c.post(`${BASE}/${p.id}/koreksi-order`, { perubahan, expectedRevision: 0, alasan: "Alamat pembeli pindah" });
  // Middleware idempotensi menerima tanpa header untuk token web; penerapan sendiri tetap menolak.
  assert.equal(tanpaKunci.status, 428, JSON.stringify(tanpaKunci.body));
  assert.equal((await koreksi(w, p.id, { perubahan, alasan: "Alamat pembeli pindah" })).status, 400, "expectedRevision wajib");
  assert.equal((await koreksi(w, p.id, { perubahan: { harga: 1 }, expectedRevision: 0, alasan: "Alamat pembeli pindah" })).status, 400, "field tak dikenal ditolak");
  assert.equal((await koreksi(w, p.id, { perubahan: {}, expectedRevision: 0, alasan: "Alamat pembeli pindah" })).status, 400, "perubahan kosong");
  assert.equal((await w.sales.c.post(`${BASE}/${p.id}/koreksi-order`, { perubahan, expectedRevision: 0, alasan: "Alamat pembeli pindah" }, kunci())).status, 403, "tanpa izin Finance");
  assert.deepEqual(await jejak(), sebelum);

  const key = `pkra-${randomUUID()}`;
  const ok = await koreksi(w, p.id, { perubahan, expectedRevision: 0, alasan: "Alamat pembeli pindah" }, { "Idempotency-Key": key });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.revisi, 1); assert.equal(ok.body.replayed, false);
  assert.equal(ok.body.sinkron.order.revisi, 1, "ringkasan menunjukkan revisi untuk format lama juga");

  const o2 = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.equal(o2.deliveryAddress, "Jl. Melati 9, Bandung"); assert.equal(o2.deliveryCity, "Bandung");
  assert.equal(o2.deliveryConfirmedDate.toISOString().slice(0, 10), "2026-10-30");
  assert.equal(JSON.parse(o2.notes).ukuranKasur, "160 x 200");
  assert.match(JSON.parse(o2.notes).catatan, /kain abu polos/);
  assert.equal((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } })).notes, "Customer minta kain abu polos");
  assert.ok((await unitDi(order.id)).every((u) => u.ukuran === "160 x 200" || /160/.test(u.ukuran ?? "")), "ukuran unit ikut sinkron");
  const sesudah = await jejak();
  assert.deepEqual(sesudah, sebelum, "jurnal, order, unit, job, pembayaran TIDAK berubah");
  assert.equal((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } })).total.toString(), "7200000");
  const rev = await testPrisma.pkrItemRevision.findMany({ where: { orderId: order.id } });
  assert.equal(rev.length, 1); assert.equal(rev[0].kind, "DIKOREKSI"); assert.equal(rev[0].impact.jenis, "KOREKSI_ORDER"); assert.equal(rev[0].reason, "Alamat pembeli pindah");
  assert.equal(rev[0].actorId, w.finance.id);
  assert.equal(rev[0].beforeItems.alamat, "Jl. Mawar 5, Bekasi"); assert.equal(rev[0].afterItems.alamat, "Jl. Melati 9, Bandung");
  const aud = await testPrisma.activityEvent.findMany({ where: { eventType: "PKR_ORDER_SINKRON", metadata: { path: ["aksi"], equals: "order_dikoreksi" } } });
  assert.equal(aud.length, 2, "audit di PKR dan di Order");
  assert.equal(await testPrisma.activityEvent.count({ where: { eventType: "PKR_ORDER_SINKRON", metadata: { path: ["aksi"], equals: "dilengkapi" } } }), 0, "tidak ada jejak 'dilengkapi' ganda");

  // Replay: kunci sama + isi sama = hasil sama tanpa revisi baru; isi beda = 409.
  const ulang = await koreksi(w, p.id, { perubahan, expectedRevision: 0, alasan: "Alamat pembeli pindah" }, { "Idempotency-Key": key });
  assert.ok([200, 201].includes(ulang.status), JSON.stringify(ulang.body));
  assert.equal(ulang.body.revisi, 1);
  assert.equal(await testPrisma.pkrItemRevision.count({ where: { orderId: order.id } }), 1);
  const beda = await koreksi(w, p.id, { perubahan: { ...perubahan, kota: "Cimahi" }, expectedRevision: 0, alasan: "Alamat pembeli pindah" }, { "Idempotency-Key": key });
  assert.ok([409, 422].includes(beda.status), `kunci sama isi beda ditolak: ${beda.status}`);
  assert.equal(await testPrisma.pkrItemRevision.count({ where: { orderId: order.id } }), 1);
});

test("konflik revisi + dua penulis paralel: tepat SATU menang, yang lain 409 REVISI_BERUBAH; revisi basi ditolak tanpa menulis", async () => {
  const w = await siapkan();
  const p = await catatLama(w);
  const order = await orderDari(p.id);
  const A = { alamat: "Alamat A, Bekasi" }; const B = { alamat: "Alamat B, Depok" };
  const [r1, r2] = await Promise.all([
    koreksi(w, p.id, { perubahan: A, expectedRevision: 0, alasan: "Koreksi dari layar pertama" }),
    koreksi(w, p.id, { perubahan: B, expectedRevision: 0, alasan: "Koreksi dari layar kedua" }),
  ]);
  const st = [r1.status, r2.status].sort();
  assert.deepEqual(st, [201, 409], `tepat satu menang: ${r1.status}/${r2.status} ${JSON.stringify([r1.body.error, r2.body.error])}`);
  const kalah = r1.status === 409 ? r1 : r2;
  assert.equal(kalah.body.code, "REVISI_BERUBAH");
  assert.equal(kalah.body.revisiSaatIni, 1);
  const o = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.ok(["Alamat A, Bekasi", "Alamat B, Depok"].includes(o.deliveryAddress));
  assert.equal(await testPrisma.pkrItemRevision.count({ where: { orderId: order.id } }), 1);

  const basi = await koreksi(w, p.id, { perubahan: { kota: "Cimahi" }, expectedRevision: 0, alasan: "Dari layar yang basi" });
  assert.equal(basi.status, 409); assert.equal(basi.body.code, "REVISI_BERUBAH");
  assert.equal((await testPrisma.order.findUnique({ where: { id: order.id } })).deliveryCity, "Bekasi", "tidak ada tulisan");
  const baru = await koreksi(w, p.id, { perubahan: { kota: "Cimahi" }, expectedRevision: 1, alasan: "Dari layar yang segar" });
  assert.equal(baru.status, 201, JSON.stringify(baru.body)); assert.equal(baru.body.revisi, 2);
});

test("produksi/pengiriman berjalan: field berisiko TERKUNCI dengan alasan jelas (409), alamat tetap bisa selama pengiriman belum jalan; pengiriman berjalan mengunci alamat", async () => {
  const w = await siapkan();
  const p = await catatLama(w);
  const order = await orderDari(p.id);
  const u = await unitDi(order.id);
  await testPrisma.unit.update({ where: { id: u[0].id }, data: { status: "IN_PRODUCTION", currentStageId: null } });
  const k = await kemampuan(w, p.id);
  assert.equal(k.produksiBerjalan, true);
  for (const f of ["ukuran", "merk", "catatan", "perluDikirim"]) { assert.equal(k.field[f].boleh, false, `${f} terkunci`); assert.match(k.field[f].alasan, /Produksi sudah berjalan/); }
  assert.equal(k.field.alamat.boleh, true);
  assert.equal(k.field.tanggalKirim.boleh, true);
  assert.ok(k.unit.find((x) => x.kode === u[0].unitCode).terkunci);
  assert.equal(k.unit.find((x) => x.kode === u[1].unitCode).terkunci, null);
  assert.match(k.jalurResmi, /Riwayat Pembayaran/);

  const sebelum = await jejak();
  const blok = await koreksi(w, p.id, { perubahan: { ukuran: "180 x 200" }, expectedRevision: 0, alasan: "Salah ukuran saat catat" });
  assert.equal(blok.status, 409, JSON.stringify(blok.body));
  assert.equal(blok.body.code, "FIELD_TERKUNCI");
  assert.match(blok.body.error, /Produksi sudah berjalan/);
  assert.deepEqual(await jejak(), sebelum);
  assert.equal(JSON.parse((await testPrisma.order.findUnique({ where: { id: order.id } })).notes).ukuranKasur, "120 x 200");
  const alamat = await koreksi(w, p.id, { perubahan: { alamat: "Jl. Baru 1, Bekasi" }, expectedRevision: 0, alasan: "Alamat pengiriman diubah" });
  assert.equal(alamat.status, 201, JSON.stringify(alamat.body));

  // Pengiriman berjalan (job EN_ROUTE) mengunci alamat/kota/tanggal.
  await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, status: "EN_ROUTE", addressText: "Jl. Baru 1, Bekasi" } });
  const k2 = await kemampuan(w, p.id);
  assert.equal(k2.pengirimanBerjalan, true);
  assert.equal(k2.field.alamat.boleh, false); assert.match(k2.field.alamat.alasan, /Pengiriman sudah berjalan/);
  const blok2 = await koreksi(w, p.id, { perubahan: { alamat: "Jl. Lain 2" }, expectedRevision: 1, alasan: "Alamat salah ketik" });
  assert.equal(blok2.status, 409); assert.equal(blok2.body.code, "FIELD_TERKUNCI");
});

test("catatan permintaan customer boleh dikoreksi sebelum produksi; mengosongkan field memakai string kosong; perluDikirim=false ditolak bila job pengiriman sudah ada", async () => {
  const w = await siapkan();
  const p = await catatLama(w);
  const order = await orderDari(p.id);
  const a = await koreksi(w, p.id, { perubahan: { catatan: "Kain abu" }, expectedRevision: 0, alasan: "Permintaan customer" });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await koreksi(w, p.id, { perubahan: { catatan: "" }, expectedRevision: 1, alasan: "Permintaan dibatalkan" });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } })).notes, null);
  await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, status: "UNSCHEDULED", addressText: "Jl. Mawar 5, Bekasi, Bekasi" } });
  const c = await koreksi(w, p.id, { perubahan: { perluDikirim: false }, expectedRevision: 2, alasan: "Diambil sendiri oleh pembeli" });
  assert.equal(c.status, 409, JSON.stringify(c.body));
  assert.equal(c.body.code, "JOB_PENGIRIMAN_ADA");
  assert.equal((await orderDari(p.id)).pkrPerluDikirim, true);
});

// ═══ 7. Format terpadu: jumlah 1→3→2 sinkron Finance + unit; tidak ada jurnal/unit/job ganda ═══
async function siapkanKatalog() {
  const layanan = await testPrisma.serviceCatalog.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
  await testPrisma.pkrItemCategory.deleteMany({ where: { code: { notIn: ["KASUR_BARU"] } } });
  await testPrisma.pkrItemCategory.upsert({
    where: { code: "KASUR_BARU" }, update: { name: "Kasur Baru", shape: "KASUR", workKind: "BARU", sortOrder: 10, active: true, productLine: "KASUR", productType: "KASUR_SEHAT", productionServiceId: null },
    create: { code: "KASUR_BARU", name: "Kasur Baru", shape: "KASUR", workKind: "BARU", sortOrder: 10, productLine: "KASUR", productType: "KASUR_SEHAT" },
  });
  assert.ok(layanan);
}
test("terpadu: jumlah 1→3 (unit baru), 3→2 sebelum dijadwalkan (unit tertinggi dibatalkan) — total, jurnal pengganti, unit sinkron; replay tidak menggandakan; tanpa job/order/unit liar", async () => {
  const w = await siapkan();
  await siapkanKatalog();
  const KASUR = { pemenuhan: "PRODUKSI_BARU", kategori: "KASUR_BARU", produkNama: "Kasur Sano Custom", jumlah: 1, harga: 2_000_000, panjang: 200, lebar: 160, tebal: 20, perluDikirim: true };
  const r = await w.finance.c.post(BASE, { date: "2026-10-11", sellerId: w.seller.id, buyerName: "Bu Ani", items: [KASUR], orderCrm: { alamat: "Jl. Mawar 5", kota: "Bekasi" } }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const p = r.body;
  const order = await orderDari(p.id);
  assert.equal((await unitDi(order.id)).length, 1);
  const k0 = await kemampuan(w, p.id);
  assert.equal(k0.format, "TERPADU");
  assert.equal(k0.jumlah.boleh, true); assert.equal(k0.harga.boleh, true);
  const sebelum = await jejak();

  const baris = (await testPrisma.finPenjualanKaryawanItem.findMany({ where: { penjualanId: p.id } }))[0];
  const rev0 = (await get(w, p.id)).body.sinkron.order.revisi;
  const naik = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 1, jumlah: 3 }], expectedRevision: rev0, alasan: "Pembeli menambah dua kasur" }, kunci());
  assert.equal(naik.status, 201, JSON.stringify(naik.body));
  assert.equal((await unitDi(order.id)).filter((u) => u.status !== "CANCELLED").length, 3, "tiga unit aktif");
  assert.equal(Number((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } })).total), 6_000_000);
  const sesudahNaik = await jejak();
  assert.equal(sesudahNaik.order, sebelum.order); assert.equal(sesudahNaik.job, 0);
  assert.equal(sesudahNaik.unit, 3);

  const rev1 = (await get(w, p.id)).body.sinkron.order.revisi;
  const turun = await w.finance.c.post(`${BASE}/${p.id}/koreksi-baris`, { operasi: [{ op: "ubah", no: 1, jumlah: 2 }], expectedRevision: rev1, alasan: "Satu kasur dibatalkan pembeli" }, kunci());
  assert.equal(turun.status, 201, JSON.stringify(turun.body));
  const u = await unitDi(order.id);
  assert.equal(u.filter((x) => x.status !== "CANCELLED").length, 2);
  assert.equal(u.find((x) => x.seq === 3).status, "CANCELLED", "unit tertinggi dibatalkan");
  assert.equal(Number((await testPrisma.finPenjualanKaryawan.findUnique({ where: { id: p.id } })).total), 4_000_000);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENJUALAN_KARYAWAN", sourceId: p.id, status: "POSTED" } }) >= 1, true);
  // Saldo piutang bersih = total dokumen (jurnal asli dibalik + pengganti).
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PIUTANG_KARYAWAN } });
  const baru = await testPrisma.finJournalEntry.findMany({ where: { OR: [{ sourceId: p.id }, { reversalOf: { sourceId: p.id } }] }, include: { lines: true } });
  const net = baru.reduce((a, e) => a + e.lines.filter((l) => l.accountId === akun.id).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0), 0);
  assert.equal(net, 4_000_000, "piutang bersih = total terbaru");
  assert.equal(await testPrisma.job.count(), 0);
  assert.equal(await testPrisma.order.count(), 1);
  assert.ok(baris.id);
});
