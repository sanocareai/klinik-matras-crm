// KOREKSI penerimaan workshop + KEBIJAKAN notifikasi pelanggan + KONSISTENSI satu sumber — HTTP + DB sungguhan (DB uji terisolasi; pesan WhatsApp TIDAK pernah terkirim: transport ditangkap).
// Dibuktikan: catatan asli utuh (tidak dihapus/ditimpa); koreksi menyimpan pelaku, waktu, alasan, nilai lama+baru; "lokasi salah" ≠ "belum diterima fisik"; unit yang sudah dipakai proses lain
// ditolak dengan daftar dampak (Run/custody tidak dibalik diam-diam); revisi basi 409; klik ganda satu baris; izin; notifikasi OFF/ON; Gudang/Produksi/Delivery/KPI membaca penerimaan yang sama.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { ujiNotifikasi } from "../../src/services/customerNotifications.js";
import { loadOrderMilestones } from "../../src/services/orderMilestoneService.js";
import { loadWorkshopTimelines } from "../../src/services/workshopTimelineService.js";

const P = "/api/production";
const V2 = "/api/production-v2";
let server; let seq = 0; let w;
const pesan = [];

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); ujiNotifikasi.transport = async (m) => { pesan.push(m); }; });
test.after(async () => { ujiNotifikasi.transport = null; ujiNotifikasi.paksaAktif = null; await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.beforeEach(async () => { await truncateAll(); pesan.length = 0; ujiNotifikasi.paksaAktif = null; w = await world(); });

const tick = () => new Promise((r) => setTimeout(r, 120));
const idem = (tag) => ({ "Idempotency-Key": `kor-${tag}-${++seq}-0000` });
async function setFlag(flagKey, unitIds) {
  const data = { enabled: unitIds !== null, scope: "GLOBAL", config: unitIds ? { unitIds } : {}, reason: "koreksi test" };
  await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
}
const setCohort = async (...ids) => { for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await setFlag(k, ids.length ? ids : null); };

async function world() {
  const mk = async (role) => { const u = await createTestUser({ roles: [role] }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
  const [admin, gudang, gudang2, sales, lead] = await Promise.all([mk("ADMIN"), mk("WAREHOUSE"), mk("WAREHOUSE"), mk("SALES"), mk("PRODUCTION_LEAD")]);
  const wc = await testPrisma.workCenter.create({ data: { code: `WC-KR-${++seq}`, name: "Workshop Utama" } });
  const wh = await testPrisma.warehouse.create({ data: { code: `WH-KR-${++seq}`, name: "Gudang KR" } });
  const loc = (zone, locationType) => testPrisma.storageLocation.create({ data: { warehouseId: wh.id, zone, locationType, code: `${zone}-KR-${++seq}` } });
  const [rcvA, rcvB, wip, rak] = [await loc("RCV", "RECEIVING_AREA"), await loc("RCV", "RECEIVING_AREA"), await loc("WIP", "WIP_AREA"), await loc("RAW", "RAW_MATERIAL_AREA")];
  return { admin, gudang, gudang2, sales, lead, wc, rcvA, rcvB, wip, rak };
}
async function mkOperator() {
  const u = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  await testPrisma.userRole.create({ data: { userId: u.user.id, role: "PRODUCTION_WORKER" } });
  const op = await testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: u.user.id, primaryWorkCenterId: w.wc.id, active: true } });
  return { ...u, op };
}
async function mkPilot({ orderStatus = "PROCESSING", pickup = true, units = 1, storage = null } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: `Pelanggan KR ${++seq}`, pipelineStage: "NEW", isInternalStaff: false } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `RES-KR-${++seq}`, value: 1_100_000, category: "LAYANAN", status: orderStatus, pickupConfirmedDate: new Date(), items: { create: [{ layananName: "Service Fondasi", harga: 1_100_000, sortOrder: 1 }] } } });
  const us = [];
  for (let i = 1; i <= units; i += 1) us.push(await testPrisma.unit.create({ data: { unitCode: `KR-${seq}-U${i}`, orderId: order.id, seq: i, status: "RECEIVED", merk: "King Koil", ukuran: "160x200", storageLocation: storage } }));
  if (pickup) { const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: order.id, status: "COMPLETED", scheduledDate: new Date(), completedAt: new Date() } }); for (const u of us) await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: u.id } }); }
  return { customer, order, unit: us[0], units: us };
}
const terima = (who, unit, body = {}, headers = {}) => who.api.post(`${P}/units/${unit.id}/penerimaan-workshop`, { fisikDiterima: true, locationId: w.rcvA.id, ...body }, headers);
const koreksi = (who, unit, body, headers = idem("k")) => who.api.post(`${P}/units/${unit.id}/penerimaan-workshop/koreksi`, body, headers);
const panel = async (who, unit) => (await who.api.get(`${P}/units/${unit.id}/adopsi`)).body;
const efek = async () => Object.fromEntries(await Promise.all(["productionRun", "unitStageLog", "unitCustodyHandoff", "stockMovement", "job", "productionRunPlan"].map(async (a) => [a, await testPrisma[a].count()])));
const kpiDiterima = async (u) => { const tl = (await loadWorkshopTimelines(testPrisma, [u.id])).get(u.id); const at = tl.timestamps.find((t) => t.key === "receivedAt")?.at ?? null; return at ? new Date(at).getTime() : null; };
const unitRow = (u) => testPrisma.unit.findUniqueOrThrow({ where: { id: u.id } });

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("K1. LOKASI SALAH: catatan asli utuh; koreksi menyimpan pelaku/waktu/alasan/lama/baru; revisi basi 409; klik ganda satu baris; izin; validasi", async () => {
  const k = await mkPilot();
  assert.equal((await terima(w.gudang, k.unit)).status, 201);
  const p0 = await panel(w.admin, k.unit); assert.equal(p0.penerimaan.revisi, 0); assert.equal(p0.penerimaan.location.code, w.rcvA.code);
  const awal = await testPrisma.unitWorkshopReceipt.findFirstOrThrow({ where: { unitId: k.unit.id } });

  const pre = (await w.admin.api.get(`${P}/units/${k.unit.id}/penerimaan-workshop/koreksi`)).body;
  assert.equal(pre.boleh.LOCATION, true); assert.equal(pre.boleh.NOT_RECEIVED, true); assert.equal(pre.revisi, 0); assert.deepEqual(pre.izin, { LOCATION: true, NOT_RECEIVED: true });

  assert.equal((await koreksi(w.sales, k.unit, { jenis: "LOCATION", locationId: w.wip.id, alasan: "x salah", expectedRevisi: 0 })).status, 403, "Sales tidak punya izin apa pun");
  assert.equal((await koreksi(w.gudang, k.unit, { jenis: "LOCATION", locationId: w.wip.id, alasan: "  ", expectedRevisi: 0 })).body.code, "KOREKSI_ALASAN_WAJIB");
  assert.equal((await koreksi(w.gudang, k.unit, { jenis: "LOCATION", locationId: w.wip.id, alasan: "salah rak", expectedRevisi: "0" })).body.code, "KOREKSI_REVISI_WAJIB");
  assert.equal((await koreksi(w.gudang, k.unit, { jenis: "LOCATION", alasan: "salah rak", expectedRevisi: 0 })).body.code, "KOREKSI_LOKASI_WAJIB");
  assert.equal((await koreksi(w.gudang, k.unit, { jenis: "LOCATION", locationId: w.rak.id, alasan: "salah rak", expectedRevisi: 0 })).status, 422, "bukan area penerimaan");
  assert.equal((await koreksi(w.gudang, k.unit, { jenis: "LOCATION", locationId: w.rcvA.id, alasan: "salah rak", expectedRevisi: 0 })).body.code, "KOREKSI_LOKASI_SAMA");
  assert.equal((await koreksi(w.gudang, k.unit, { jenis: "ASAL", alasan: "salah rak", expectedRevisi: 0 })).body.code, "KOREKSI_JENIS_TIDAK_VALID");
  assert.equal(await testPrisma.unitWorkshopReceiptCorrection.count(), 0, "semua penolakan tidak menulis apa pun");

  const kunci = { "Idempotency-Key": "kor-lokasi-klikganda-0001" };
  const dua = await Promise.all([1, 2, 3].map(() => koreksi(w.gudang2, k.unit, { jenis: "LOCATION", locationId: w.wip.id, alasan: "Salah letak: ternyata di WIP", expectedRevisi: 0 }, kunci)));
  assert.equal(dua.filter((r) => r.status === 201).length, 1, JSON.stringify(dua.map((r) => [r.status, r.body.code])));
  assert.ok(dua.every((r) => [200, 201].includes(r.status)), "klik ganda tidak menghasilkan galat"); assert.equal(await testPrisma.unitWorkshopReceiptCorrection.count(), 1);
  const c = await testPrisma.unitWorkshopReceiptCorrection.findFirstOrThrow({});
  assert.equal(c.kind, "LOCATION"); assert.equal(c.actorId, w.gudang2.user.id); assert.equal(c.reason, "Salah letak: ternyata di WIP");
  assert.equal(c.oldValue.code, w.rcvA.code); assert.equal(c.newValue.code, w.wip.code); assert.ok(Math.abs(Date.now() - c.createdAt.getTime()) < 60_000);
  const sesudah = await testPrisma.unitWorkshopReceipt.findFirstOrThrow({ where: { unitId: k.unit.id } });
  assert.deepEqual([sesudah.locationId, sesudah.receivedById, sesudah.receivedAt.getTime(), sesudah.note], [awal.locationId, awal.receivedById, awal.receivedAt.getTime(), awal.note], "catatan asli TIDAK ditimpa");
  assert.equal((await unitRow(k.unit)).storageLocation, w.wip.code);
  // revisi basi: orang lain membuka dengan revisi 0 lalu mengirim sesudah koreksi di atas
  const basi = await koreksi(w.admin, k.unit, { jenis: "LOCATION", locationId: w.rcvB.id, alasan: "koreksi lain", expectedRevisi: 0 });
  assert.equal(basi.status, 409); assert.equal(basi.body.code, "KOREKSI_REVISI_BASI"); assert.equal(basi.body.detail.revisi, 1);
  assert.equal((await koreksi(w.admin, k.unit, { jenis: "LOCATION", locationId: w.rcvB.id, alasan: "koreksi kedua", expectedRevisi: 1 })).status, 201);
  const p = await panel(w.admin, k.unit);
  assert.equal(p.penerimaan.location.code, w.rcvB.code, "lokasi efektif = koreksi terakhir"); assert.equal(p.penerimaan.lokasiAwal.code, w.rcvA.code); assert.equal(p.penerimaan.revisi, 2);
  assert.deepEqual(p.penerimaan.koreksi.map((x) => [x.jenis, x.lama.code, x.baru.code]), [["LOCATION", w.rcvA.code, w.wip.code], ["LOCATION", w.wip.code, w.rcvB.code]]);
  assert.equal(p.penerimaan.koreksi[0].oleh.name, w.gudang2.user.name);
  assert.ok(p.riwayat.some((r) => /dikoreksi: lokasi salah, dari .* menjadi/.test(r.label)), JSON.stringify(p.riwayat.map((r) => r.label)));
  // koreksi bukan "belum diterima": unit tetap tercatat diterima
  const wo = (await w.admin.api.get(`${P}/work-orders?q=${k.unit.unitCode}`)).body.units.find((x) => x.id === k.unit.id); assert.equal(wo.globalStatus.key, "DITERIMA_WORKSHOP");
  // append-only di database
  await assert.rejects(() => testPrisma.unitWorkshopReceiptCorrection.update({ where: { id: c.id }, data: { reason: "ubah" } }), /append-only/);
  await assert.rejects(() => testPrisma.unitWorkshopReceiptCorrection.delete({ where: { id: c.id } }), /append-only/);
});

test("K2. BELUM DITERIMA FISIK (tanpa yang bergantung): hanya Admin/Kepala Produksi; unit kembali ke antrean; lokasi lama dipulihkan; catatan asli tetap; terima ulang = penerimaan baru; klik ganda", async () => {
  const k = await mkPilot({ storage: "RAK-LAMA" });
  assert.equal((await terima(w.gudang, k.unit)).status, 201);
  assert.equal((await unitRow(k.unit)).storageLocation, w.rcvA.code);
  const body = { jenis: "NOT_RECEIVED", alasan: "Salah unit: kasur belum sampai, hanya foto", expectedRevisi: 0 };
  const g = await koreksi(w.gudang, k.unit, body); assert.equal(g.status, 403); assert.equal(g.body.code, "KOREKSI_IZIN_DITOLAK");
  assert.equal((await koreksi(w.lead, k.unit, body)).status, 201, "Kepala Produksi boleh");
  const kunci = idem("void");
  const lagi = await koreksi(w.admin, k.unit, body, kunci); assert.equal(lagi.status, 409, "sudah dikoreksi → revisi/penerimaan tidak lagi berlaku");
  const k2 = await mkPilot();
  await terima(w.gudang, k2.unit);
  const ganda = await Promise.all([1, 2, 3].map(() => koreksi(w.admin, k2.unit, body, { "Idempotency-Key": "kor-void-ganda-0001" })));
  assert.equal(ganda.filter((r) => r.status === 201).length, 1); assert.ok(ganda.every((r) => [200, 201].includes(r.status)), JSON.stringify(ganda.map((r) => [r.status, r.body.code])));
  assert.equal(await testPrisma.unitWorkshopReceiptCorrection.count({ where: { unitId: k2.unit.id } }), 1);

  // k: kembali ke antrean, tanpa bukti terima
  assert.equal(await testPrisma.unitWorkshopReceipt.count({ where: { unitId: k.unit.id } }), 1, "catatan asli TIDAK dihapus");
  const c = await testPrisma.unitWorkshopReceiptCorrection.findFirstOrThrow({ where: { unitId: k.unit.id } });
  assert.equal(c.kind, "NOT_RECEIVED"); assert.equal(c.actorId, w.lead.user.id); assert.equal(c.newValue, null); assert.equal(c.oldValue.code, w.rcvA.code); assert.equal(c.oldValue.receivedById, w.gudang.user.id); assert.match(c.reason, /belum sampai/);
  assert.equal((await unitRow(k.unit)).storageLocation, "RAK-LAMA", "proyeksi lokasi dipulihkan");
  const antre = (await w.gudang.api.get(`${P}/penerimaan-workshop/menunggu`)).body; assert.ok(antre.units.some((u) => u.unitId === k.unit.id));
  const p = await panel(w.admin, k.unit); assert.equal(p.penerimaan, null); assert.equal(p.adopsi.posisi.key, "SUDAH_DIJEMPUT"); assert.equal(p.adopsi.tindakan.aksi, "CONFIRM_ARRIVAL");
  assert.equal(p.riwayatPenerimaan.length, 1); assert.equal(p.riwayatPenerimaan[0].aktif, false); assert.equal(p.riwayatPenerimaan[0].koreksi[0].jenisLabel, "Ternyata belum diterima fisik");
  assert.ok(p.riwayat.some((r) => /ternyata belum diterima fisik/.test(r.label)));
  const wo = (await w.admin.api.get(`${P}/work-orders?q=${k.unit.unitCode}`)).body.units.find((x) => x.id === k.unit.id); assert.equal(wo.globalStatus.key, "PENGAMBILAN");
  assert.equal((await loadOrderMilestones(testPrisma, [{ id: k.order.id, status: k.order.status }])).get(k.order.id).key, "PENGAMBILAN", "Delivery/Sales membaca sumber yang sama");
  assert.equal(await kpiDiterima(k.unit), null, "KPI: tidak ada waktu diterima");
  // pratinjau tanpa penerimaan berlaku = 404 berkode
  assert.equal((await w.admin.api.get(`${P}/units/${k.unit.id}/penerimaan-workshop/koreksi`)).body.code, "PENERIMAAN_TIDAK_ADA");

  // terima ulang → penerimaan BARU (seq 2); riwayat lama tetap terbaca
  const ulang = await terima(w.gudang2, k.unit, { locationId: w.wip.id }); assert.equal(ulang.status, 201, JSON.stringify(ulang.body));
  const rs = await testPrisma.unitWorkshopReceipt.findMany({ where: { unitId: k.unit.id }, orderBy: { seq: "asc" } }); assert.deepEqual(rs.map((r) => r.seq), [1, 2]);
  const p2 = await panel(w.admin, k.unit); assert.equal(p2.penerimaan.seq, 2); assert.equal(p2.penerimaan.receivedBy.id, w.gudang2.user.id); assert.equal(p2.penerimaan.revisi, 0); assert.equal(p2.riwayatPenerimaan.length, 2);
  assert.equal((await unitRow(k.unit)).storageLocation, w.wip.code);
  assert.equal(await kpiDiterima(k.unit), rs[1].receivedAt.getTime(), "KPI memakai penerimaan yang berlaku");
});

test("K3. SUDAH ADA YANG BERGANTUNG (aktivasi V2): 'belum diterima' DITOLAK dengan daftar dampak — Run/serah-terima tidak dibalik; 'lokasi salah' tetap boleh dan ikut mengoreksi lokasi serah-terima lewat penulis custody", async () => {
  const lain = await mkPilot(); await setCohort(lain.unit.id);
  const k = await mkPilot(); const op = await mkOperator();
  await terima(w.gudang, k.unit);
  const akt = await w.admin.api.post(`${V2}/plans`, { unitId: k.unit.id, productionDate: "2026-10-22", stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("akt"));
  assert.equal(akt.status, 201, JSON.stringify(akt.body));
  const sebelum = await efek();
  const pre = (await w.admin.api.get(`${P}/units/${k.unit.id}/penerimaan-workshop/koreksi`)).body;
  assert.equal(pre.boleh.NOT_RECEIVED, false); assert.equal(pre.boleh.LOCATION, true);
  const kodeButir = pre.dampak.butir.map((b) => b.kode); assert.ok(kodeButir.includes("PEKERJAAN_DIBUKA") && kodeButir.includes("SERAH_TERIMA_MEMAKAI_PENERIMAAN"), kodeButir.join());
  assert.ok(pre.dampak.butir.every((b) => !/\b(Run|cohort|custody|handoff)\b/i.test(b.teks)), "bahasa petugas: tanpa istilah Run/cohort/custody");
  const tolak = await koreksi(w.admin, k.unit, { jenis: "NOT_RECEIVED", alasan: "Ternyata belum datang", expectedRevisi: 0 });
  assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "KOREKSI_PERLU_JALUR_RESMI"); assert.ok(tolak.body.detail.dampak.length >= 2); assert.match(tolak.body.error, /Kepala Produksi atau tim sistem/);
  assert.deepEqual(await efek(), sebelum); assert.equal(await testPrisma.unitWorkshopReceiptCorrection.count(), 0);
  const run = await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: k.unit.id } }); assert.equal(run.status, "ACTIVE");

  const h0 = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: k.unit.id } });
  const lok = await koreksi(w.gudang, k.unit, { jenis: "LOCATION", locationId: w.rcvB.id, alasan: "Salah letak, seharusnya Receiving B", expectedRevisi: 0 }); assert.equal(lok.status, 201, JSON.stringify(lok.body));
  const h1 = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: k.unit.id } });
  assert.equal(h1.status, "ACCEPTED"); assert.equal(h1.locationId, w.rcvB.id); assert.equal(h1.revision, h0.revision + 1); assert.equal(h1.acceptedById, h0.acceptedById, "penerima asli tetap");
  assert.equal((await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: k.unit.id } })).status, "ACTIVE", "Run tidak berubah");
  assert.equal(await testPrisma.domainOutbox.count({ where: { aggregateId: h1.id, eventType: "warehouse.custody.location-corrected" } }), 1);
  assert.equal((await unitRow(k.unit)).storageLocation, w.rcvB.code);
  const wo = (await w.admin.api.get(`${P}/work-orders?q=${k.unit.unitCode}`)).body.units.find((x) => x.id === k.unit.id); assert.equal(wo.globalStatus.key, "DITERIMA_WORKSHOP"); assert.equal(wo.receivedBasis, "CUSTODY");
});

test("K3b. aktivasi V2 SESUDAH koreksi lokasi memakai lokasi yang sudah benar; aktivasi sesudah 'belum diterima' tidak memakai penerimaan yang dibatalkan (kedatangan tetap lewat Terima Unit)", async () => {
  const lain = await mkPilot(); await setCohort(lain.unit.id); const op = await mkOperator();
  const a = await mkPilot(); const b = await mkPilot();
  await terima(w.gudang, a.unit); assert.equal((await koreksi(w.gudang, a.unit, { jenis: "LOCATION", locationId: w.wip.id, alasan: "salah rak", expectedRevisi: 0 })).status, 201);
  await terima(w.gudang, b.unit); assert.equal((await koreksi(w.admin, b.unit, { jenis: "NOT_RECEIVED", alasan: "belum datang", expectedRevisi: 0 })).status, 201);
  const plan = (u, st) => w.admin.api.post(`${V2}/plans`, { unitId: u.id, productionDate: "2026-10-22", stationCode: st, priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("akt"));
  assert.equal((await plan(a.unit, "TABLE_1")).status, 201); assert.equal((await plan(b.unit, "TABLE_2")).status, 201);
  const ha = await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: a.unit.id } }); assert.equal(ha.status, "ACCEPTED"); assert.equal(ha.locationId, w.wip.id, "lokasi koreksi, bukan lokasi awal yang salah");
  assert.equal((await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: a.unit.id } })).status, "ACTIVE");
  assert.equal((await testPrisma.productionRun.findFirstOrThrow({ where: { unitId: b.unit.id } })).status, "PENDING_ARRIVAL", "penerimaan yang dibatalkan tidak dipakai sebagai kedatangan");
  assert.equal((await testPrisma.unitCustodyHandoff.findFirstOrThrow({ where: { unitId: b.unit.id } })).status, "OFFERED");
  const wo = (await w.admin.api.get(`${P}/work-orders?q=${b.unit.unitCode}`)).body.units.find((x) => x.id === b.unit.id); assert.equal(wo.globalStatus.key, "PENGAMBILAN");
});

test("K4. SATU penerimaan = satu sumber: Gudang, Produksi, Delivery/Sales, KPI konsisten — sebelum, sesudah koreksi lokasi, dan sesudah aktivasi V2", async () => {
  const lain = await mkPilot(); await setCohort(lain.unit.id); const op = await mkOperator();
  const k = await mkPilot();
  const baca = async () => {
    const wo = (await w.admin.api.get(`${P}/work-orders?q=${k.unit.unitCode}`)).body.units.find((x) => x.id === k.unit.id);
    const antre = (await w.gudang.api.get(`${P}/penerimaan-workshop/menunggu`)).body.units.some((u) => u.unitId === k.unit.id);
    const mil = (await loadOrderMilestones(testPrisma, [{ id: k.order.id, status: "PROCESSING" }])).get(k.order.id);
    const pn = await panel(w.admin, k.unit);
    return { produksi: wo.globalStatus.key, antreGudang: antre, order: mil.key, receivedAt: await kpiDiterima(k.unit), presence: wo.presence.key, posisi: pn.adopsi.posisi.key };
  };
  const a0 = await baca(); assert.deepEqual([a0.produksi, a0.antreGudang, a0.order, a0.receivedAt], ["PENGAMBILAN", true, "PENGAMBILAN", null]);
  await terima(w.gudang, k.unit);
  const rcp = await testPrisma.unitWorkshopReceipt.findFirstOrThrow({ where: { unitId: k.unit.id } });
  const a1 = await baca(); assert.deepEqual([a1.produksi, a1.antreGudang, a1.order, a1.receivedAt, a1.presence, a1.posisi], ["DITERIMA_WORKSHOP", false, "DITERIMA_WORKSHOP", rcp.receivedAt.getTime(), "ARRIVED_CONFIRMED", "DI_WORKSHOP"]);
  await koreksi(w.gudang, k.unit, { jenis: "LOCATION", locationId: w.wip.id, alasan: "salah rak", expectedRevisi: 0 });
  assert.deepEqual(await baca(), a1, "koreksi lokasi tidak mengubah status, waktu terima, atau antrean");
  assert.equal((await w.admin.api.post(`${V2}/plans`, { unitId: k.unit.id, productionDate: "2026-10-22", stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("akt"))).status, 201);
  const a2 = await baca(); assert.equal(a2.produksi, "DITERIMA_WORKSHOP"); assert.equal(a2.receivedAt, rcp.receivedAt.getTime(), "waktu terima tetap waktu penerimaan asli"); assert.equal(a2.antreGudang, false);
  assert.equal(await testPrisma.domainOutbox.count({ where: { aggregateId: k.unit.id, eventType: "production.unit.received-workshop" } }), 1, "satu peristiwa diterima");
});

test("N1. NOTIFIKASI OFF: tidak ada pesan apa pun untuk penerimaan, koreksi, aktivasi, maupun Terima Unit", async () => {
  ujiNotifikasi.paksaAktif = false;
  const lain = await mkPilot(); await setCohort(lain.unit.id); const op = await mkOperator();
  const k = await mkPilot();
  await terima(w.gudang, k.unit); await koreksi(w.gudang, k.unit, { jenis: "LOCATION", locationId: w.wip.id, alasan: "salah", expectedRevisi: 0 });
  await w.admin.api.post(`${V2}/plans`, { unitId: k.unit.id, productionDate: "2026-10-22", stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("akt"));
  const m = await mkPilot(); await terima(w.gudang, m.unit); await koreksi(w.admin, m.unit, { jenis: "NOT_RECEIVED", alasan: "belum datang", expectedRevisi: 0 }); await terima(w.gudang, m.unit);
  await tick(); assert.equal(pesan.length, 0);
});

test("N2. NOTIFIKASI ON: satu pesan faktual 'sudah kami terima di workshop' per unit; koreksi, terima ulang, aktivasi V2, dan Terima Unit sesudah penerimaan TIDAK mengirim lagi; order banyak unit menyebut kode unit", async () => {
  ujiNotifikasi.paksaAktif = true;
  const lain = await mkPilot(); await setCohort(lain.unit.id); const op = await mkOperator();
  const k = await mkPilot();
  assert.equal((await terima(w.gudang, k.unit)).status, 201); await tick();
  assert.equal(pesan.length, 1); assert.equal(pesan[0].customerId, k.customer.id);
  assert.match(pesan[0].text, /sudah kami terima di workshop Sano Care/); assert.match(pesan[0].text, new RegExp(k.order.orderNumber));
  assert.doesNotMatch(pesan[0].text, /dengan selamat|segera mulai|mulai pengerjaan|sampai/i, "tidak menjanjikan/menyatakan hal yang tidak diperiksa");
  assert.doesNotMatch(pesan[0].text, new RegExp(k.unit.unitCode), "order satu unit: tanpa kode unit");
  assert.equal((await terima(w.gudang, k.unit)).status, 200); await tick(); assert.equal(pesan.length, 1, "klik ganda tidak mengirim lagi");
  await koreksi(w.gudang, k.unit, { jenis: "LOCATION", locationId: w.wip.id, alasan: "salah rak", expectedRevisi: 0 }); await tick(); assert.equal(pesan.length, 1, "koreksi lokasi tidak mengirim pesan");
  await w.admin.api.post(`${V2}/plans`, { unitId: k.unit.id, productionDate: "2026-10-22", stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("akt"));
  await tick(); assert.equal(pesan.length, 1, "aktivasi V2 memakai penerimaan — tidak ada pesan 'Unit Tiba' kedua");

  const m = await mkPilot(); await terima(w.gudang, m.unit); await tick(); assert.equal(pesan.length, 2);
  await koreksi(w.admin, m.unit, { jenis: "NOT_RECEIVED", alasan: "belum datang", expectedRevisi: 0 }); await tick(); assert.equal(pesan.length, 2, "koreksi 'belum diterima' tidak mengirim pesan");
  await terima(w.gudang, m.unit, { locationId: w.rcvB.id }); await tick(); assert.equal(pesan.length, 2, "terima ulang sesudah koreksi tidak mengirim pesan kedua");

  const banyak = await mkPilot({ units: 2 }); await terima(w.gudang, banyak.units[1]); await tick();
  assert.equal(pesan.length, 3); assert.match(pesan[2].text, new RegExp(`unit \\*${banyak.units[1].unitCode}\\*`));
});

test("N3. 'Terima Unit' (jalur custody/Produksi) memakai isi pesan yang SAMA; bila unit sudah pernah punya penerimaan petugas (termasuk yang dikoreksi) tidak mengirim lagi; override uji diabaikan di production", async () => {
  ujiNotifikasi.paksaAktif = true;
  const lain = await mkPilot(); await setCohort(lain.unit.id); const op = await mkOperator();
  // unit baru diterima lewat "Terima Unit" (Run PENDING_ARRIVAL ada lebih dulu): pesan faktual yang sama, sekali
  const a = await mkPilot();
  assert.equal((await w.admin.api.post(`${V2}/plans`, { unitId: a.unit.id, productionDate: "2026-10-22", stationCode: "TABLE_1", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("a"))).status, 201);
  assert.equal((await terima(w.gudang, a.unit, {}, { "Idempotency-Key": "kor-tiba-0001-aaaaa" })).body.via, "PRODUKSI_V2"); await tick();
  assert.equal(pesan.length, 1); assert.match(pesan[0].text, /sudah kami terima di workshop Sano Care/); assert.doesNotMatch(pesan[0].text, /sampai dengan selamat/);
  // unit yang penerimaan petugasnya sudah dikoreksi "belum diterima", lalu Terima Unit lewat Produksi: pelanggan sudah diberi tahu sekali → tidak ada pesan kedua
  const b = await mkPilot(); await terima(w.gudang, b.unit); await tick(); assert.equal(pesan.length, 2);
  await koreksi(w.admin, b.unit, { jenis: "NOT_RECEIVED", alasan: "belum datang", expectedRevisi: 0 });
  assert.equal((await w.admin.api.post(`${V2}/plans`, { unitId: b.unit.id, productionDate: "2026-10-22", stationCode: "TABLE_2", priority: 0, workCenterId: w.wc.id, operatorId: op.op.id, activateUnit: true }, idem("b"))).status, 201);
  assert.equal((await w.lead.api.post(`${V2}/units/${b.unit.id}/confirm-arrival`, { locationId: w.rcvA.id }, idem("tiba"))).status, 200); await tick();
  assert.equal(pesan.length, 2, "tidak ada pesan kedua untuk unit yang sama");
  // production: pengait uji tidak berlaku
  const lama = process.env.NODE_ENV; process.env.NODE_ENV = "production";
  try { const c = await mkPilot(); await terima(w.gudang, c.unit); await tick(); assert.equal(pesan.length, 2, "NODE_ENV=production: override uji diabaikan → flag asli (OFF) berlaku"); } finally { process.env.NODE_ENV = lama; }
});
