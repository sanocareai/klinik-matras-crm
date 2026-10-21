// PENERIMAAN WORKSHOP OLEH PETUGAS — HTTP + DB sungguhan (DB uji terisolasi, bukan production).
// Keadaan yang ditiru dari evaluasi pilot RES-19102026-094-U1: pickup SELESAI (unit RECEIVED), tanpa custody/Run, order Sales terkunci manual di Pengambilan.
// Dibuktikan: penerimaan = catatan resmi (pelaku, waktu, lokasi, riwayat) TANPA Run/tahap/QC/stok/job/cohort V2; klik ganda/serentak = satu catatan; tanpa izin atau tanpa pernyataan fisik/lokasi sah = ditolak;
// panel menampilkan status ORDER Sales sebenarnya + penghalangnya; "Ubah ke Diproses" lewat jalur Sales yang sama (tanpa job/Run ganda); aktivasi V2 sesudah penerimaan TIDAK mencatat tiba dua kali.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { custodyHooks } from "../../src/services/unitCustodyCommandService.js";
import { setWorkshopDefaultLocation } from "../../src/services/productionSettingsService.js";

const P = "/api/production";
const V2 = "/api/production-v2";
let server; let seq = 0; let w;
const notif = [];
const hookAsli = custodyHooks.unitReceivedAtWorkshop;

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); custodyHooks.unitReceivedAtWorkshop = (id) => { notif.push(id); }; });
test.after(async () => { custodyHooks.unitReceivedAtWorkshop = hookAsli; await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.beforeEach(async () => { await truncateAll(); notif.length = 0; w = await world(); });

const idem = (tag) => ({ "Idempotency-Key": `wr-${tag}-${++seq}-0000` });
async function setFlag(flagKey, unitIds) {
  const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "penerimaan test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
const setCohort = async (...ids) => { for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(k, ids.length ? ids : null); };
const cohortOf = async (key) => { const row = await testPrisma.v2FeatureFlag.findUnique({ where: { key } }); return row?.enabled ? [...(row.config?.unitIds ?? [])].sort() : null; };

async function world() {
  const mk = async (role) => { const u = await createTestUser({ roles: [role] }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
  const [admin, gudang, sales, lead] = await Promise.all([mk("ADMIN"), mk("WAREHOUSE"), mk("SALES"), mk("PRODUCTION_LEAD")]);
  const wc = await testPrisma.workCenter.create({ data: { code: `WC-WR-${++seq}`, name: "Workshop Utama" } });
  const warehouse = await testPrisma.warehouse.create({ data: { code: `WH-WR-${++seq}`, name: "Gudang WR" } });
  const rcv = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RCV", locationType: "RECEIVING_AREA", code: `RCV-WR-${++seq}` } });
  const rak = await testPrisma.storageLocation.create({ data: { warehouseId: warehouse.id, zone: "RAW", locationType: "RAW_MATERIAL_AREA", code: `RAK-WR-${++seq}` } });
  return { admin, gudang, sales, lead, wc, rcv, rak };
}
async function mkOperator() {
  const u = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  await testPrisma.userRole.create({ data: { userId: u.user.id, role: "PRODUCTION_WORKER" } });
  const op = await testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: u.user.id, primaryWorkCenterId: w.wc.id, active: true } });
  return { ...u, op };
}
// Order seperti RES-…-094: LAYANAN, status Pengambilan DIKUNCI manual, tanggal pick up pasti terisi; unit RECEIVED; pickup COMPLETED. `pickup:false` = tanpa job pickup.
async function mkPilot({ orderStatus = "PICKUP", locked = true, pickup = true, unitStatus = "RECEIVED", extraUnit = null } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan WR ${++seq}`, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await testPrisma.order.create({
    data: {
      customerId: customer.id, orderNumber: `RES-WR-${++seq}`, value: 1_100_000, category: "LAYANAN", status: orderStatus, pickupConfirmedDate: new Date(),
      ...(locked ? { statusLocked: true, statusOverrideAt: new Date(Date.now() - 3600_000), statusOverrideNote: "Dipindah manual saat jemput", statusOverrideById: w.admin.user.id } : {}),
      items: { create: [{ layananName: "Service Fondasi", harga: 1_100_000, sortOrder: 1 }] },
    },
  });
  const unit = await testPrisma.unit.create({ data: { unitCode: `WR-${seq}-U1`, orderId: order.id, seq: 1, status: unitStatus, merk: "King Koil", ukuran: "160x200" } });
  let job = null;
  if (pickup) { job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", scheduledDate: new Date(), completedAt: new Date() } }); await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } }); }
  const lain = extraUnit ? await testPrisma.unit.create({ data: { unitCode: `WR-${seq}-U2`, orderId: order.id, seq: 2, status: extraUnit, merk: "Serta", ukuran: "180x200" } }) : null;
  return { customer, order, unit, job, lain };
}
const efek = async () => Object.fromEntries(await Promise.all(["productionRun", "productionOperationRun", "unitStageLog", "qualityInspection", "unitCustodyHandoff", "stockMovement", "materialIssue", "materialReservation", "job", "productionStepEvidence", "productionRunPlan"].map(async (a) => [a, await testPrisma[a].count()])));
// Produksi V2 menyala untuk cohort lain (production: hanya unit canary) — unit yang diuji BELUM diaktifkan.
const nyalakanCohortLain = async () => { const l = await mkPilot({ orderStatus: "PROCESSING", locked: false }); await setCohort(l.unit.id); return l; };
const panel = async (who, unit) => (await who.api.get(`${P}/units/${unit.id}/adopsi`)).body;
const terima = (who, unit, body = {}, headers = {}) => who.api.post(`${P}/units/${unit.id}/penerimaan-workshop`, { fisikDiterima: true, locationId: w.rcv.id, ...body }, headers);
const saldo = async (m) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: m }, _sum: { qty: true } }))._sum.qty ?? 0);
const jmlReceipt = () => testPrisma.unitWorkshopReceipt.count();
const jmlAktivitas = (unitId) => testPrisma.activityEvent.count({ where: { entityId: unitId, eventType: "WORKSHOP_RECEIPT_RECORDED" } });
const jmlOutboxTiba = (unitId) => testPrisma.domainOutbox.count({ where: { aggregateId: unitId, eventType: "production.unit.received-workshop" } });

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("A1. pickup selesai → petugas Gudang mencatat penerimaan: catatan resmi (pelaku, waktu, lokasi), unit terlihat tiba — tanpa Run/tahap/QC/stok/job/cohort; klik ganda dan serentak = SATU catatan", async () => {
  const k = await mkPilot();
  const sebelum = await efek();
  const p0 = await panel(w.gudang, k.unit);
  assert.equal(p0.adopsi.posisi.key, "SUDAH_DIJEMPUT"); assert.equal(p0.adopsi.tindakan.aksi, "CONFIRM_ARRIVAL"); assert.equal(p0.izin.catatPenerimaan, true);
  const antre = (await w.gudang.api.get(`${P}/penerimaan-workshop/menunggu`)).body;
  assert.ok(antre.units.some((u) => u.unitId === k.unit.id), "unit tampil di antrean penerimaan Gudang");

  const serentak = await Promise.all([1, 2, 3].map(() => terima(w.gudang, k.unit, { note: "Dua kasur, kondisi baik" })));
  assert.equal(serentak.filter((r) => r.status === 201).length, 1, JSON.stringify(serentak.map((r) => r.status)));
  assert.equal(serentak.filter((r) => r.status === 200 && r.body.replayed).length, 2);
  const ulang = await terima(w.gudang, k.unit); assert.equal(ulang.status, 200); assert.equal(ulang.body.replayed, true); assert.equal(ulang.body.alreadyReceived, true);

  assert.equal(await jmlReceipt(), 1, "klik ganda = satu catatan"); assert.equal(await jmlAktivitas(k.unit.id), 1); assert.equal(await jmlOutboxTiba(k.unit.id), 1);
  const r = await testPrisma.unitWorkshopReceipt.findFirstOrThrow({ where: { unitId: k.unit.id } });
  assert.equal(r.receivedById, w.gudang.user.id); assert.equal(r.locationId, w.rcv.id); assert.equal(r.note, "Dua kasur, kondisi baik"); assert.ok(Math.abs(Date.now() - r.receivedAt.getTime()) < 60_000);
  assert.deepEqual(await efek(), sebelum, "tidak ada Run/operasi/tahap/QC/custody/stok/reservasi/job/bukti/rencana");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: k.unit.id } })).storageLocation, w.rcv.code);
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: k.unit.id } })).status, "RECEIVED", "status unit tidak berubah");
  assert.equal(await cohortOf(V2_FLAGS.PRODUCTION_WRITER), null, "tidak mengaktifkan Produksi V2"); assert.equal(await cohortOf(V2_FLAGS.PRODUCTION_READER), null);
  assert.deepEqual(notif, [k.unit.id], "notifikasi 'diterima di workshop' tepat sekali (hook; nonaktif selagi DELIVERY_NOTIF_AKTIF=false)");

  const p1 = await panel(w.admin, k.unit);
  assert.equal(p1.penerimaan.receivedBy.id, w.gudang.user.id); assert.equal(p1.penerimaan.location.code, w.rcv.code);
  assert.equal(p1.adopsi.posisi.key, "DI_WORKSHOP"); assert.equal(p1.receivedBasisLabel, "Penerimaan dicatat petugas"); assert.equal(p1.presence.key, "ARRIVED_CONFIRMED");
  const wo = (await w.admin.api.get(`${P}/work-orders?q=${k.unit.unitCode}`)).body.units.find((x) => x.id === k.unit.id);
  assert.equal(wo.globalStatus.key, "DITERIMA_WORKSHOP"); assert.equal(wo.receivedBasis, "WORKSHOP_RECEIPT"); assert.equal(wo.adopsi.kerja.key, "BELUM_DIJADWALKAN", "penerimaan bukan 'Dikerjakan'");
  assert.ok(p1.riwayat.length >= 0);
  const antre2 = (await w.gudang.api.get(`${P}/penerimaan-workshop/menunggu`)).body; assert.equal(antre2.units.some((u) => u.unitId === k.unit.id), false, "keluar dari antrean");
});

test("A2. DITOLAK: tanpa izin (Sales), tanpa pernyataan fisik, lokasi bukan area penerimaan, lokasi hilang tanpa bawaan, unit belum dijemput — tidak ada catatan sama sekali", async () => {
  const k = await mkPilot(); const belum = await mkPilot({ unitStatus: "AWAITING_PICKUP", pickup: false, locked: false, orderStatus: "PENDING" });
  const sebelum = await efek();
  assert.equal((await terima(w.sales, k.unit)).status, 403);
  const tanpaFisik = await terima(w.gudang, k.unit, { fisikDiterima: false }); assert.equal(tanpaFisik.status, 400); assert.equal(tanpaFisik.body.code, "PENERIMAAN_FISIK_WAJIB");
  assert.equal((await terima(w.gudang, k.unit, { fisikDiterima: "true" })).status, 400, "hanya boolean true");
  const salah = await terima(w.gudang, k.unit, { locationId: w.rak.id }); assert.equal(salah.status, 422); assert.equal(salah.body.code, "CUSTODY_LOCATION_TYPE_INVALID");
  const tanpaLokasi = await w.gudang.api.post(`${P}/units/${k.unit.id}/penerimaan-workshop`, { fisikDiterima: true }); assert.equal(tanpaLokasi.status, 409); assert.equal(tanpaLokasi.body.code, "WORKSHOP_DEFAULT_LOCATION_NOT_CONFIGURED");
  const belumJemput = await terima(w.gudang, belum.unit); assert.equal(belumJemput.status, 409); assert.equal(belumJemput.body.code, "PENERIMAAN_STATUS_UNIT");
  assert.equal((await terima(w.gudang, { id: "00000000-0000-4000-8000-000000000000" })).status, 404);
  assert.equal((await w.gudang.api.post(`${P}/units/bukan-uuid/penerimaan-workshop`, { fisikDiterima: true })).status, 400);
  assert.equal(await jmlReceipt(), 0); assert.deepEqual(await efek(), sebelum); assert.equal(notif.length, 0);
  // lokasi bawaan Admin dipakai bila tidak memilih lokasi
  await setWorkshopDefaultLocation(testPrisma, { locationId: w.rcv.id, actorId: w.admin.user.id });
  const bawaan = await w.gudang.api.post(`${P}/units/${k.unit.id}/penerimaan-workshop`, { fisikDiterima: true }); assert.equal(bawaan.status, 201, JSON.stringify(bawaan.body));
  assert.equal(bawaan.body.receipt.location.code, w.rcv.code);
  const pil = (await w.gudang.api.get(`${P}/penerimaan-workshop/pilihan`)).body; assert.equal(pil.perluKonfigurasi, false); assert.equal(pil.bawaan.code, w.rcv.code); assert.ok(pil.lokasi.some((l) => l.id === w.rcv.id)); assert.equal(pil.lokasi.some((l) => l.id === w.rak.id), false);
});

test("A3. order terkunci manual di Pengambilan: panel menampilkan status ORDER sebenarnya + penyebab; Admin 'Ubah ke Diproses' lewat jalur Sales (dengan catatan) tanpa job/Run ganda; order lain tidak tersentuh", async () => {
  const k = await mkPilot(); const lainOrder = await mkPilot(); // order lain yang juga terkunci — tidak boleh tersentuh
  const p0 = await panel(w.admin, k.unit);
  assert.equal(p0.adopsi.orderSales.label, "Pengambilan", "status order Sales sebenarnya (bukan 'Diproses' turunan status unit)");
  assert.equal(p0.adopsi.statusOrder.label, "Diproses", "status unit tetap terpisah"); assert.equal(p0.adopsi.orderSales.terkunci, true);
  assert.equal(p0.adopsi.orderSales.pengunci.nama, w.admin.user.name); assert.equal(p0.adopsi.penghalang.kode, "ORDER_TERKUNCI_PENGAMBILAN");
  assert.match(p0.adopsi.penghalang.teks, /dikunci manual/); assert.match(p0.adopsi.penghalang.teks, /Dipindah manual saat jemput/);
  assert.equal(p0.adopsi.tindakan.aksi, "CONFIRM_ARRIVAL", "penerimaan fisik lebih dulu"); assert.equal(p0.adopsi.tindakan.penghalang.kode, "ORDER_TERKUNCI_PENGAMBILAN");
  assert.equal((await terima(w.gudang, k.unit)).status, 201);
  const p1 = await panel(w.admin, k.unit);
  assert.equal(p1.adopsi.tindakan.aksi, "UBAH_ORDER_DIPROSES"); assert.equal(p1.adopsi.tindakan.aktor, "Admin"); assert.match(p1.adopsi.tindakan.detail, /dikunci manual/);
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: k.order.id } })).status, "PICKUP", "tidak otomatis berubah");

  const sebelum = await efek();
  const patch = await w.admin.api.patch(`/api/orders/${k.order.id}`, { status: "PROCESSING", statusOverrideNote: "Unit sudah diterima di workshop" });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  const o = await testPrisma.order.findUniqueOrThrow({ where: { id: k.order.id } });
  assert.equal(o.status, "PROCESSING"); assert.equal(o.statusOverrideNote, "Unit sudah diterima di workshop"); assert.equal(o.statusOverrideById, w.admin.user.id);
  assert.deepEqual(await efek(), sebelum, "tanpa job/Run ganda");
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: lainOrder.order.id } })).status, "PICKUP", "order lain tidak disentuh");
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: lainOrder.unit.id } })).status, "RECEIVED");
  const p2 = await panel(w.admin, k.unit);
  assert.equal(p2.adopsi.orderSales.label, "Diproses"); assert.equal(p2.adopsi.penghalang, null); assert.equal(p2.adopsi.tindakan.aksi, "OPEN_PLAN", "siap dijadwalkan di Rencana Produksi");
  // Sales tanpa izin Produksi tetap hanya melihat; tombol tidak ditawarkan oleh server (izin.statusOrder dari ORDER_WRITE yang sama dengan jalur Sales)
  const pSales = await panel(w.sales, k.unit); assert.equal(pSales.izin.catatPenerimaan, false);
});

test("A4. penghalang bukan kunci manual: unit lain order belum dijemput → dijelaskan, tanpa tombol ubah; order tak terkunci tertahan → boleh diubah", async () => {
  const dua = await mkPilot({ locked: false, extraUnit: "AWAITING_PICKUP" });
  const pd = await panel(w.admin, dua.unit);
  assert.equal(pd.adopsi.penghalang.kode, "UNIT_LAIN_BELUM_DIJEMPUT"); assert.equal(pd.adopsi.penghalang.bolehUbahKeDiproses, false);
  await terima(w.gudang, dua.unit);
  assert.notEqual((await panel(w.admin, dua.unit)).adopsi.tindakan.aksi, "UBAH_ORDER_DIPROSES", "tidak menawarkan ubah selagi unit lain belum dijemput");
  const bebas = await mkPilot({ locked: false });
  assert.equal((await panel(w.admin, bebas.unit)).adopsi.penghalang.kode, "ORDER_BELUM_DISINKRONKAN");
  await terima(w.gudang, bebas.unit); assert.equal((await panel(w.admin, bebas.unit)).adopsi.tindakan.aksi, "UBAH_ORDER_DIPROSES");
  const sehat = await mkPilot({ orderStatus: "PROCESSING", locked: false }); assert.equal((await panel(w.admin, sehat.unit)).adopsi.penghalang, null);
});

test("A5. status kerja Dijadwalkan, target, rencana bahan tetap bisa dicatat SEBELUM dan SESUDAH penerimaan; 'Dikerjakan' hanya bila memang dicatat; stok utuh; ekspor Excel benar", async () => {
  const k = await mkPilot({ orderStatus: "PROCESSING", locked: false });
  const kain = await createTestMaterial({ name: "Kain Uji WR", unit: "METER", itemGroup: "KAIN" });
  await testPrisma.stockMovement.create({ data: { materialId: kain.id, type: "RECEIPT", qty: 40, note: "saldo awal", createdAt: new Date(Date.now() - 5 * 86_400_000) } });
  const e0 = await efek();
  assert.equal((await w.admin.api.post(`${P}/units/${k.unit.id}/work-progress`, { status: "DIJADWALKAN", expectedLatestId: null })).status, 201);
  assert.equal((await w.admin.api.put(`${P}/units/${k.unit.id}/material-plan`, { expectedRevision: 0, lines: [{ materialId: kain.id, qty: 6 }] })).status, 200);
  assert.equal((await w.admin.api.patch(`/api/units/${k.unit.id}/production`, { productionDueAt: new Date(Date.now() + 5 * 864e5).toISOString(), expected: { productionDueAt: null } })).status, 200);
  assert.equal((await terima(w.gudang, k.unit)).status, 201);
  const p = await panel(w.admin, k.unit);
  assert.equal(p.adopsi.kerja.key, "DIJADWALKAN", "penerimaan tidak mengubah status kerja menjadi Dikerjakan"); assert.equal(p.adopsi.posisi.key, "DI_WORKSHOP"); assert.ok(p.adopsi.targetSelesai); assert.equal(p.rencanaBahan.plan.lines.length, 1);
  assert.equal(p.kerjaManual.dikunciAplikasi, false, "penerimaan bukan bukti aplikasi → catatan manual masih boleh");
  assert.equal((await w.admin.api.post(`${P}/units/${k.unit.id}/work-progress`, { status: "DIKERJAKAN", expectedLatestId: p.kerjaManual.terakhirId })).status, 201);
  assert.equal((await panel(w.admin, k.unit)).adopsi.kerja.key, "DIKERJAKAN");
  assert.equal(await saldo(kain.id), 40, "stok tidak berubah"); const e1 = await efek(); assert.equal(e1.stockMovement, e0.stockMovement); assert.equal(e1.productionRun, e0.productionRun);
  const ex = await fetch(server.baseUrl + `${P}/work-orders/export.xlsx`, { headers: { Authorization: "Bearer " + w.admin.token } }); assert.equal(ex.status, 200); assert.ok((await ex.arrayBuffer()).byteLength > 2000);
  // penerimaan tetap catatan jejak: unit tidak bisa dihapus lewat jalur hapus (409 ramah, bukan 500)
  const hapus = await w.admin.api.delete(`/api/orders/units/${k.unit.id}`); assert.equal(hapus.status, 409, JSON.stringify(hapus.body));
});

test("A6. aktivasi V2 SESUDAH penerimaan (ada pickup → custody): Run langsung ACTIVE dengan kedatangan dari catatan penerimaan, handoff ACCEPTED atas nama penerima asli, TANPA event tiba kedua / notifikasi kedua / 'Unit Tiba' kedua", async () => {
  const k = await mkPilot({ orderStatus: "PROCESSING", locked: false }); const op = await mkOperator();
  await nyalakanCohortLain();
  assert.equal((await terima(w.gudang, k.unit)).status, 201);
  const r = await testPrisma.unitWorkshopReceipt.findFirstOrThrow({ where: { unitId: k.unit.id } });
  const res = await w.admin.api.post(`${V2}/plans`, { unitId: k.unit.id, productionDate: "2026-10-22", stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("akt"));
  assert.equal(res.status, 201, JSON.stringify(res.body)); assert.equal(res.body.activated, true);
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: k.unit.id } });
  assert.equal(run.status, "ACTIVE", "kedatangan sudah tercatat → tidak menunggu 'Unit Tiba' lagi");
  const h = await testPrisma.unitCustodyHandoff.findMany({ where: { unitId: k.unit.id, direction: "INBOUND" } });
  assert.equal(h.length, 1); assert.equal(h[0].status, "ACCEPTED"); assert.equal(h[0].acceptedById, w.gudang.user.id); assert.equal(h[0].locationId, w.rcv.id); assert.equal(h[0].acceptedAt.getTime(), r.receivedAt.getTime());
  assert.equal(h[0].productionRunId, run.id);
  assert.equal(await jmlOutboxTiba(k.unit.id), 1, "hanya SATU event 'diterima di workshop' (dari penerimaan)"); assert.equal(notif.length, 1, "pelanggan tidak diberi kabar dua kali");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: k.unit.id, eventType: "CUSTODY_ACCEPTED" } }), 1);
  assert.equal(await jmlReceipt(), 1);
  const lagi = await w.lead.api.post(`${V2}/units/${k.unit.id}/confirm-arrival`, {}, idem("tiba")); assert.ok(lagi.status >= 400, "tidak ada catatan tiba kedua"); assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: k.unit.id } }), 1);
  const wo = (await w.admin.api.get(`${P}/work-orders?q=${k.unit.unitCode}`)).body.units.find((x) => x.id === k.unit.id);
  assert.equal(wo.receivedBasis, "CUSTODY"); assert.equal(wo.presence.key, "ARRIVED_CONFIRMED");
});

test("A7. aktivasi V2 sesudah penerimaan TANPA pickup/custody: Run ACTIVE, fase INTAKE ditandai konfirmasi petugas, tanpa handoff; penerimaan lain tidak terpengaruh", async () => {
  const k = await mkPilot({ orderStatus: "PROCESSING", locked: false, pickup: false }); const op = await mkOperator();
  await nyalakanCohortLain();
  assert.equal((await terima(w.gudang, k.unit)).status, 201);
  const res = await w.admin.api.post(`${V2}/plans`, { unitId: k.unit.id, productionDate: "2026-10-22", stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("akt2"));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: k.unit.id }, include: { phases: true } });
  assert.equal(run.status, "ACTIVE"); assert.ok(run.phases.some((p) => p.phase === "INTAKE" && p.reason === "Kedatangan dikonfirmasi petugas (tanpa custody)"));
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: k.unit.id } }), 0);
  assert.equal(await jmlOutboxTiba(k.unit.id), 1); assert.equal(notif.length, 1);
});

test("A8. Run V2 sudah PENDING_ARRIVAL lebih dulu (aktivasi duluan): penerimaan didelegasikan ke jalur resmi 'Unit Tiba' — tidak ada catatan paralel; ulang = idempoten", async () => {
  const k = await mkPilot({ orderStatus: "PROCESSING", locked: false }); const op = await mkOperator();
  await nyalakanCohortLain();
  const res = await w.admin.api.post(`${V2}/plans`, { unitId: k.unit.id, productionDate: "2026-10-22", stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("akt3"));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal((await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: k.unit.id } })).status, "PENDING_ARRIVAL");
  const key = { "Idempotency-Key": "wr-delegasi-0001-aaaa" };
  const a = await terima(w.gudang, k.unit, {}, key); assert.equal(a.status, 201, JSON.stringify(a.body)); assert.equal(a.body.via, "PRODUKSI_V2");
  assert.equal(await jmlReceipt(), 0, "tidak ada catatan paralel"); assert.equal((await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: k.unit.id } })).status, "ACTIVE");
  assert.equal((await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: k.unit.id } })).status, "ACCEPTED");
  const b = await terima(w.gudang, k.unit, {}, key); assert.equal(b.status, 200, JSON.stringify(b.body)); assert.equal(b.body.alreadyReceived, true);
  assert.equal(await testPrisma.unitCustodyHandoff.count({ where: { unitId: k.unit.id } }), 1); assert.equal(await jmlOutboxTiba(k.unit.id), 1);
});

test("A9. riwayat append-only: catatan penerimaan tidak bisa diubah/dihapus lewat SQL; riwayat unit memuat peristiwa dengan pelaku", async () => {
  const k = await mkPilot();
  assert.equal((await terima(w.gudang, k.unit)).status, 201);
  const rc = await testPrisma.unitWorkshopReceipt.findFirstOrThrow({ where: { unitId: k.unit.id } });
  await assert.rejects(() => testPrisma.unitWorkshopReceipt.update({ where: { id: rc.id }, data: { note: "ubah" } }), /append-only/);
  await assert.rejects(() => testPrisma.unitWorkshopReceipt.delete({ where: { id: rc.id } }), /append-only/);
  const p = await panel(w.admin, k.unit);
  assert.ok(p.riwayat.some((r) => /diterima di workshop oleh petugas/i.test(r.label)), JSON.stringify(p.riwayat.map((r) => r.label)));
});
