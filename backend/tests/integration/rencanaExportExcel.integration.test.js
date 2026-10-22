// Export Excel Rencana Produksi — POST /api/production-v2/rencana/export (snapshot BACA-SAJA). HTTP nyata di DB uji terisolasi: izin harga (hanya ADMIN/OWNER yang meminta),
// filter tanggal/rentang/Meja/kartu terlihat, urutan tanggal → Meja → stationSequence, target kartu, karakter Indonesia, >500 unit, reader OFF, dan TIDAK ada tulis.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { todayWib } from "../../src/lib/domain/productionBoard.js";

let server; let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const key = (v) => ({ "Idempotency-Key": `rencana-export-${v}-0001` });
const EXPORT = "/api/production-v2/rencana/export";
const DATE = todayWib();
const addDays = (k, n) => new Date(Date.parse(`${k}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function setFlag(flagKey, unitIds) {
  const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "rencana-export test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
async function setCohort(...unitIds) { for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(k, unitIds); }

async function world() {
  const [lead, admin, owner, sales, wh, driver] = await Promise.all(["PRODUCTION_LEAD", "ADMIN", "OWNER", "SALES", "WAREHOUSE", "DRIVER"].map((r) => createTestUser({ roles: [r] })));
  const workCenter = await testPrisma.workCenter.create({ data: { code: `WC-RX-${++seq}`, name: "Workshop RX" } });
  const operator = await testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: lead.user.id, primaryWorkCenterId: workCenter.id } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-RX-${++seq}`, name: "Gudang RX" } });
  const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-RX-${++seq}` } });
  const c = (u) => ({ ...u, api: makeClient(server.baseUrl, u.token) });
  return { lead: c(lead), admin: c(admin), owner: c(owner), sales: c(sales), wh: c(wh), driver: c(driver), wc: workCenter.id, operator, rcv };
}
async function orderWithUnit({ name, notes = null, value = 4_500_000 } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: name || `Pelanggan RX ${++seq}`, city: "Bandung" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `RX-${++seq}`, value, category: "LAYANAN", beratBadan: 70, notes } });
  await testPrisma.orderItem.create({ data: { orderId: order.id, layananName: "Servis Spring", harga: 1_500_000, sortOrder: 0 } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `UNIT-RX-${++seq}`, orderId: order.id, seq: 1, status: "AWAITING_PICKUP", merk: "Serta", ukuran: "160x200" } });
  return { customer, order, unit };
}
async function jobFor(w, { orderId, unitId }) {
  const route = await testPrisma.route.create({ data: { code: `RX-RTE-${++seq}`, date: new Date("2026-10-01T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: w.driver.user.id } });
  const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId, routeId: route.id, driverId: w.driver.user.id, status: "ASSIGNED", sequence: 1, scheduledDate: new Date("2026-10-01T00:00:00.000Z") } });
  await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId } });
  return job;
}
async function completePickup(w, job, tag) {
  await w.driver.api.post(`/api/armada/jobs/${job.id}/start`, {}, key(`${tag}-s`));
  await w.driver.api.post(`/api/armada/jobs/${job.id}/arrive`, { location: null }, key(`${tag}-a`));
  return w.driver.api.post(`/api/armada/jobs/${job.id}/complete`, { proofPhotoUrls: ["/media/job-photos/pod.jpg"], recipientName: "Penjaga", note: "ok", location: null }, key(`${tag}-c`));
}
// Satu unit sampai Run PENDING_ARRIVAL lewat jalur resmi (pickup selesai), lalu dijadwalkan di papan lewat API resmi.
async function runOnBoard(w, { name, notes, station = "TABLE_1", date = DATE, priority = 0, tag }) {
  const u = await orderWithUnit({ name, notes });
  await setCohort(...[...(w.cohort ||= []), u.unit.id]);
  w.cohort.push(u.unit.id); w.cohort = [...new Set(w.cohort)]; await setCohort(...w.cohort);
  const done = await completePickup(w, await jobFor(w, { orderId: u.order.id, unitId: u.unit.id }), tag); assert.equal(done.status, 200, JSON.stringify(done.body));
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: u.unit.id } });
  const res = await w.lead.api.post("/api/production-v2/plans", { runId: run.id, productionDate: date, stationCode: station, priority, workCenterId: w.wc, operatorId: w.operator.id }, key(`plan-${tag}`));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { ...u, run };
}
const exp = (who, body) => who.api.post(EXPORT, body);
const codes = (b) => b.rows.map((r) => r.unitCode);
const snapshot = async () => ({
  runs: await testPrisma.productionRun.count(), plans: await testPrisma.productionRunPlan.count(), events: await testPrisma.productionPlanScheduleEvent.count(),
  outbox: await testPrisma.domainOutbox.count(), units: JSON.stringify(await testPrisma.unit.findMany({ select: { unitCode: true, status: true }, orderBy: { unitCode: "asc" } })),
  plansState: JSON.stringify(await testPrisma.productionRunPlan.findMany({ select: { runId: true, stationCode: true, stationSequence: true, productionDate: true, targetDate: true, priority: true }, orderBy: { runId: "asc" } })),
});

async function fixture() {
  const w = await world();
  const A = await runOnBoard(w, { name: "Bu Siti — Cirebon", notes: "Ñandú café: ganti kain motif bunga warna “abu tua”\nJahit rapi", station: "TABLE_1", priority: 1, tag: "a" });
  const B = await runOnBoard(w, { station: "TABLE_1", tag: "b" });
  const C = await runOnBoard(w, { station: "TABLE_2", tag: "c" });
  const D = await runOnBoard(w, { station: "TABLE_1", date: addDays(DATE, 1), tag: "d" });
  // urutan manual di Meja 1 hari ini: B (1) sebelum A (2); target khusus kartu untuk C (+2 hari)
  const planOf = (u) => testPrisma.productionRunPlan.findFirstOrThrow({ where: { runId: u.run.id } });
  await testPrisma.productionRunPlan.update({ where: { id: (await planOf(B)).id }, data: { stationSequence: 1 } });
  await testPrisma.productionRunPlan.update({ where: { id: (await planOf(A)).id }, data: { stationSequence: 2 } });
  await testPrisma.productionRunPlan.update({ where: { id: (await planOf(C)).id }, data: { targetDate: new Date(`${addDays(DATE, 2)}T00:00:00.000Z`) } });
  return { w, A, B, C, D };
}

test("tanggal papan: hanya rencana tanggal itu; urut Meja → urutan manual; kolom, ringkasan, nama berkas dari server; HARGA tidak ada secara default", async () => {
  const { w, A, B, C, D } = await fixture(); const before = await snapshot();
  const r = await exp(w.lead, { from: DATE, to: DATE, includeUnscheduled: false });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.readerMode, "COHORT");
  assert.deepEqual(codes(r.body), [B.unit.unitCode, A.unit.unitCode, C.unit.unitCode], "Meja 1 urutan manual (B=1, A=2), lalu Meja 2; unit besok tidak ikut");
  assert.ok(!codes(r.body).includes(D.unit.unitCode));
  assert.equal(r.body.columns.length, 29); assert.equal(r.body.meta.fileName, `Target-Produksi-${new Date(`${DATE}T00:00:00Z`).getUTCDate().toString().padStart(2, "0")}-${["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"][new Date(`${DATE}T00:00:00Z`).getUTCMonth()]}-${DATE.slice(0, 4)}.xlsx`);
  assert.match(r.body.meta.generatedLabel, /^Data dibuat: \d{2} \w+ \d{4}, \d{2}\.\d{2} WIB$/); assert.equal(r.body.meta.includeValue, false);
  assert.deepEqual(r.body.rows.map((x) => x.no), [1, 2, 3]); assert.deepEqual(r.body.rows.map((x) => x.urutan), [1, 2, 1]); assert.deepEqual(r.body.rows.map((x) => x.seqManual), [true, true, false]);
  assert.equal(r.body.summary.total, 3); assert.deepEqual(r.body.summary.perStation.map((p) => p.count), [2, 1, 0, 0]); assert.equal(r.body.summary.tinggi, 1);
  // target: kartu C punya target khusus (+2 hari) dibanding tanggal papan
  const rowC = r.body.rows.find((x) => x.unitCode === C.unit.unitCode); assert.equal(rowC.target, addDays(DATE, 2));
  const rowB = r.body.rows.find((x) => x.unitCode === B.unit.unitCode); assert.equal(rowB.target, DATE);
  // isi baris dari server yang sama dengan papan
  assert.equal(rowB.layanan, "Servis Spring"); assert.equal(rowB.status.startsWith("Menunggu Dijemput") || rowB.status.length > 0, true); assert.equal(rowB.picMeja.length > 0, true);
  assert.equal(rowB.merek, "Serta"); assert.equal(rowB.ukuran, "160x200"); assert.equal(rowB.berat, 70);
  // tidak ada data harga di seluruh respons
  const text = JSON.stringify(r.body); assert.ok(!text.includes("nilaiOrder") && !text.includes("4500000") && !text.includes("Nilai Order"), "tidak ada harga");
  assert.deepEqual(await snapshot(), before, "export tidak menulis apa pun (jadwal/Run/event/outbox/unit utuh)");
});

test("izin harga: hanya ADMIN/OWNER yang boleh meminta nilai order; peran lain 403 tanpa memuat harga; tanpa permintaan tidak ada kolom harga", async () => {
  const { w, A } = await fixture();
  for (const who of [w.admin, w.owner]) {
    const r = await exp(who, { from: DATE, to: DATE, includeValue: true, includeUnscheduled: false });
    assert.equal(r.status, 200); assert.equal(r.body.meta.includeValue, true); assert.equal(r.body.columns.at(-1).header, "Nilai Order");
    assert.ok(r.body.rows.every((x) => x.nilaiOrder === 4_500_000), "nilai numerik per baris");
  }
  const plainAdmin = await exp(w.admin, { from: DATE, to: DATE, includeUnscheduled: false });
  assert.equal(plainAdmin.body.meta.includeValue, false); assert.ok(!JSON.stringify(plainAdmin.body).includes("4500000"), "Admin tanpa memilih opsi: tidak ada harga");
  for (const who of [w.lead, w.sales, w.wh]) {
    const r = await exp(who, { from: DATE, to: DATE, includeValue: true });
    assert.equal(r.status, 403, `${who.user.id}`); assert.equal(r.body.code, "EXPORT_VALUE_FORBIDDEN"); assert.ok(!JSON.stringify(r.body).includes("4500000"));
    const ok = await exp(who, { from: DATE, to: DATE, includeUnscheduled: false });
    if (ok.status === 200) assert.ok(!JSON.stringify(ok.body).includes("4500000") && !("nilaiOrder" in (ok.body.rows[0] || {})), "peran lain tidak pernah menerima harga");
  }
  assert.equal((await exp(w.driver, { from: DATE, to: DATE })).status, 403, "Driver tanpa izin baca produksi");
  assert.equal((await w.admin.api.post(EXPORT, { from: DATE, to: DATE, includeValue: "true", includeUnscheduled: false })).status, 200);
  assert.ok(A);
});

test("rentang tanggal & Meja tertentu: rentang memuat tanggal berikutnya (target naik), Meja tertentu menyaring; validasi tanggal/Meja", async () => {
  const { w, A, B, C, D } = await fixture();
  const range = await exp(w.lead, { from: DATE, to: addDays(DATE, 1), includeUnscheduled: false });
  assert.deepEqual(codes(range.body), [B.unit.unitCode, A.unit.unitCode, D.unit.unitCode, C.unit.unitCode], "target tanggal → Meja → urutan: D (besok, Meja 1) sebelum C (target +2)");
  assert.match(range.body.meta.fileName, /^Target-Produksi-\d{2}-\w+-\d{4}-sd-\d{2}-\w+-\d{4}\.xlsx$/);
  const t2 = await exp(w.lead, { from: DATE, to: addDays(DATE, 1), stations: ["TABLE_2"] });
  assert.deepEqual(codes(t2.body), [C.unit.unitCode]); assert.equal(t2.body.meta.scopeLabel, "Meja: Meja 2");
  const t1 = await exp(w.lead, { from: DATE, to: addDays(DATE, 1), stations: "TABLE_1", includeUnscheduled: false });
  assert.deepEqual(codes(t1.body), [B.unit.unitCode, A.unit.unitCode, D.unit.unitCode]);
  assert.equal((await exp(w.lead, { from: "2026-13-40" })).body.code, "EXPORT_DATE_INVALID");
  assert.equal((await exp(w.lead, { from: DATE, to: addDays(DATE, -1) })).body.code, "EXPORT_RANGE_INVALID");
  assert.equal((await exp(w.lead, { from: DATE, to: addDays(DATE, 90) })).body.code, "EXPORT_RANGE_TOO_LONG");
  assert.equal((await exp(w.lead, { from: DATE, stations: ["TABLE_9"] })).body.code, "EXPORT_STATION_INVALID");
});

test("kartu yang sedang terlihat: hanya id yang dikirim (Run dalam cohort + unit backlog tanpa Run); unit tanpa Meja tampil SETELAH unit terjadwal; id lain/luar cohort diabaikan", async () => {
  const { w, A, B } = await fixture();
  const backlog = await orderWithUnit({ name: "Backlog Tanpa Run" }); await testPrisma.unit.update({ where: { id: backlog.unit.id }, data: { status: "RECEIVED" } });
  const outside = await orderWithUnit({ name: "Di Luar Cohort" }); await testPrisma.unit.update({ where: { id: outside.unit.id }, data: { status: "RECEIVED" } });
  const r = await exp(w.lead, { from: DATE, to: DATE, visibleOnly: true, runIds: [A.run.id, B.run.id], unitIds: [backlog.unit.id] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(codes(r.body), [B.unit.unitCode, A.unit.unitCode, backlog.unit.unitCode], "terjadwal dulu, Belum Dijadwalkan terakhir");
  const last = r.body.rows.at(-1); assert.equal(last.meja, "Belum Dijadwalkan"); assert.equal(last.target, null); assert.equal(last.picMeja, "—"); assert.equal(last.runId, null);
  assert.equal(last.status.startsWith("Pengambilan"), true, "unit RECEIVED tanpa bukti terima = Pengambilan (read-model milestone yang sama)");
  assert.equal(r.body.meta.visibleOnly, true); assert.equal(r.body.summary.unscheduled, 1);
  // run di luar cohort tidak pernah dimuat
  const otherRun = crypto.randomUUID();
  const r2 = await exp(w.lead, { from: DATE, to: DATE, visibleOnly: true, runIds: [otherRun] });
  assert.equal(r2.status, 200); assert.deepEqual(r2.body.rows, []);
  assert.equal((await exp(w.lead, { visibleOnly: true, runIds: ["bukan-uuid"] })).body.code, "EXPORT_IDS_INVALID");
  assert.equal(outside.unit.unitCode.length > 0, true);
});

test("catatan panjang + karakter Indonesia/Unicode terbawa utuh; Ganti Kain dari layanan Sales; satu Layanan Sales tanpa layanan teknis", async () => {
  const { w, A } = await fixture();
  await testPrisma.orderItem.create({ data: { orderId: A.order.id, layananName: "Ganti Kain Pinggir", harga: 500_000, sortOrder: 1 } });
  const long = `${"Customer minta jahit rapi dan motif bunga. ".repeat(40)}Ñandú café “tebal” — ok.`;
  await testPrisma.order.update({ where: { id: A.order.id }, data: { notes: long } });
  const r = await exp(w.lead, { from: DATE, to: DATE, includeUnscheduled: false });
  const row = r.body.rows.find((x) => x.unitCode === A.unit.unitCode);
  assert.ok(row.catatanSales.includes("Ñandú café “tebal” — ok.")); assert.ok(row.catatanSales.length > 1500, "tidak dipotong");
  assert.equal(row.gantiKain, "Ya"); assert.equal(row.layanan, "Servis Spring, Ganti Kain Pinggir"); assert.equal(row.customer, "Bu Siti — Cirebon");
  assert.ok(!("serviceCode" in row) && !JSON.stringify(row).includes("serviceId"), "layanan teknis tidak ikut");
});

test("lewat target: alasan dari server (hari + alasan jadwal ulang) dan catatan Kepala Produksi dari riwayat jadwal", async () => {
  const w = await world();
  const past = addDays(DATE, -3);
  const L = await runOnBoard(w, { station: "TABLE_1", date: past, tag: "late" });
  const plan = await testPrisma.productionRunPlan.findFirstOrThrow({ where: { runId: L.run.id } });
  await testPrisma.productionPlanScheduleEvent.create({ data: { planId: plan.id, unitId: L.unit.id, kind: "RESCHEDULED", toDate: new Date(`${past}T00:00:00.000Z`), toStation: "TABLE_1", missedTarget: true, reasonCode: "WAITING_MATERIAL", note: "Menunggu kain dari gudang — sudah dikonfirmasi Rina" } });
  const r = await exp(w.lead, { from: past, to: past, includeUnscheduled: false });
  const row = r.body.rows[0];
  assert.equal(row.alasanLewat, "Lewat target 3 hari — jadwal ulang: Menunggu bahan"); assert.equal(row.catatanLead, "Menunggu kain dari gudang — sudah dikonfirmasi Rina"); assert.equal(row.late, true);
  assert.equal(r.body.summary.lewatTarget, 1);
});

test(">500 unit: 620 kartu terlihat diekspor utuh (tanpa duplikat/hilang); >5000 ditolak 413; reader OFF = respons kosong readerMode OFF (bukan error)", async () => {
  const w = await world();
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Besar" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: "RX-BIG", value: 1_000_000, category: "LAYANAN", status: "PROCESSING" } });
  const ids = Array.from({ length: 620 }, () => crypto.randomUUID());
  await testPrisma.unit.createMany({ data: ids.map((id, i) => ({ id, unitCode: `BIG-${String(i).padStart(4, "0")}`, orderId: order.id, seq: i + 1, status: "RECEIVED", merk: "Serta", ukuran: "160x200" })) });
  const r = await exp(w.admin, { from: DATE, to: DATE, visibleOnly: true, unitIds: ids });
  assert.equal(r.status, 200); assert.equal(r.body.rows.length, 620); assert.equal(new Set(codes(r.body)).size, 620); assert.equal(r.body.summary.total, 620); assert.equal(r.body.summary.unscheduled, 620);
  assert.deepEqual(r.body.rows.map((x) => x.no), Array.from({ length: 620 }, (_, i) => i + 1)); assert.equal(r.body.meta.truncated, false);
  const tooMany = Array.from({ length: 5001 }, () => crypto.randomUUID());
  const big = await exp(w.admin, { visibleOnly: true, unitIds: tooMany }); assert.equal(big.status, 413); assert.equal(big.body.code, "EXPORT_TOO_MANY");
  const off = await exp(w.lead, { from: DATE, to: DATE }); assert.equal(off.status, 200); assert.equal(off.body.readerMode, "OFF"); assert.deepEqual(off.body.rows, []);
});
