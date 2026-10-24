// ADOPSI ADMIN → PIC BAHAN → APLIKASI MESA (Order Produksi). Menguji kontrak tiga sumbu status, catatan kerja manual tanpa bukti palsu, rencana bahan tanpa efek stok,
// pemakaian aktual tepat-sekali (retry + bersamaan), jalur status order yang SAMA dengan Sales/Delivery, katalog per kelompok, akun hanya-lihat, dan ekspor Excel.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server; let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const P = "/api/production";
const ym = (n) => `ADP-${++seq}-${n}`;
async function akun(role) { const u = await createTestUser({ roles: [role] }); return { ...u, api: makeClient(server.baseUrl, u.token) }; }
async function world() { const [admin, worker, viewer, lead] = await Promise.all([akun("ADMIN"), akun("PRODUCTION_WORKER"), akun("SALES"), akun("PRODUCTION_LEAD")]); return { admin, worker, viewer, lead }; }

// Unit nyata minimal. `pickup: "selesai"` = job PICKUP selesai TANPA bukti terima workshop (kasus Owner: status order Diproses, posisi belum diterima).
async function unit({ status = "RECEIVED", orderStatus = "PROCESSING", pelanggan = `Pelanggan ${++seq}`, pickup = null, order = null, layanan = "Service Fondasi", seqNo = 1, category = "LAYANAN" } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: pelanggan } });
  const o = order ?? await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ADP-O-${++seq}`, value: 100, category, status: orderStatus, deliveryConfirmedDate: new Date("2026-10-25T00:00:00.000Z"), pickupConfirmedDate: new Date("2026-10-20T00:00:00.000Z"), items: { create: [{ layananName: layanan, harga: 100, sortOrder: 1 }] } } });
  const u = await testPrisma.unit.create({ data: { unitCode: `ADP-U-${++seq}`, orderId: o.id, seq: seqNo, status } });
  if (pickup === "selesai") {
    const job = await testPrisma.job.create({ data: { type: "PICKUP", orderId: o.id, status: "COMPLETED", scheduledDate: new Date("2026-10-18T00:00:00.000Z"), completedAt: new Date("2026-10-18T05:00:00.000Z") } });
    await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: u.id } });
  }
  return { unit: u, order: o };
}
const daftar = async (w, q = "") => { const r = await w.admin.api.get(`${P}/work-orders?pageSize=200${q}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const baris = (d, id) => d.units.find((x) => x.id === id);
const panel = async (w, id, who = "admin") => { const r = await w[who].api.get(`${P}/units/${id}/adopsi`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
async function hitungEfek() {
  const [mv, rsv, jur, run, ops, ev, qc, cust, stg, issue] = await Promise.all([
    testPrisma.stockMovement.count(), testPrisma.materialReservation.count(), testPrisma.finJournalEntry.count(), testPrisma.productionRun.count(), testPrisma.productionOperationRun.count(),
    testPrisma.productionStepEvidence.count(), testPrisma.qualityInspection.count(), testPrisma.unitCustodyHandoff.count(), testPrisma.unitStageLog.count(), testPrisma.materialIssue.count(),
  ]);
  return { mv, rsv, jur, run, ops, ev, qc, cust, stg, issue };
}
const stage = () => testPrisma.routingStage.findFirstOrThrow({ where: { code: "teardown" } });

test("A1. KONTRAK TIGA SUMBU di daftar: pickup selesai tanpa bukti terima = Status order Diproses, Posisi 'Sudah dijemput · belum diterima workshop', Status kerja Belum dijadwalkan; tindakan = konfirmasi terima (Gudang)", async () => {
  const w = await world();
  const a = await unit({ pickup: "selesai" });
  const b = await unit({ status: "AWAITING_PICKUP", orderStatus: "PICKUP" });
  const c = await unit({ status: "READY_FOR_DELIVERY", orderStatus: "READY" });
  const d = await daftar(w);
  const ra = baris(d, a.unit.id).adopsi;
  assert.equal(ra.statusOrder.label, "Diproses"); assert.equal(ra.posisi.key, "SUDAH_DIJEMPUT"); assert.match(ra.posisi.label, /belum diterima workshop/); assert.equal(ra.kerja.key, "BELUM_DIJADWALKAN");
  assert.equal(ra.tindakan.aksi, "CONFIRM_ARRIVAL"); assert.equal(ra.tindakan.aktor, "Gudang");
  const rb = baris(d, b.unit.id).adopsi; assert.equal(rb.statusOrder.label, "Pengambilan"); assert.equal(rb.posisi.key, "MENUNGGU_DIJEMPUT"); assert.equal(rb.tindakan.aktor, "Delivery");
  const rc = baris(d, c.unit.id).adopsi; assert.equal(rc.statusOrder.label, "Siap Kirim"); assert.equal(rc.kerja.key, "SELESAI"); assert.equal(rc.kerja.source, "STATUS_ORDER"); assert.equal(rc.tindakan.aktor, "Delivery");
  // kontrak lama tetap ada (aditif)
  assert.ok(baris(d, a.unit.id).globalStatus && baris(d, a.unit.id).unitStatusDisplay && baris(d, a.unit.id).productionStatus);
});

test("A2. CATATAN KERJA MANUAL: tanpa tahap/QC/foto/penerimaan/pemakaian palsu; pelaku dan waktu tercatat; ulang = tidak menulis; konflik riwayat ditolak; peran dijaga", async () => {
  const w = await world(); const { unit: u } = await unit({ pickup: "selesai" });
  const sebelum = await hitungEfek();
  const r1 = await w.admin.api.post(`${P}/units/${u.id}/work-progress`, { status: "DIKERJAKAN", note: "Mulai dikerjakan Meja 2", expectedLatestId: null });
  assert.equal(r1.status, 201, JSON.stringify(r1.body)); assert.equal(r1.body.dicatat, true);
  assert.deepEqual(await hitungEfek(), sebelum, "tidak ada tahap/QC/foto/penerimaan/pemakaian/jurnal/stok baru");
  const row = baris(await daftar(w), u.id).adopsi;
  assert.equal(row.kerja.key, "DIKERJAKAN"); assert.equal(row.kerja.source, "MANUAL"); assert.equal(row.kerja.manual.by, w.admin.user.name); assert.ok(row.kerja.manual.at); assert.match(row.kerja.detail, new RegExp(`Dicatat manual oleh ${w.admin.user.name}`));
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "unit", entityId: u.id, eventType: "PRODUCTION_STATUS_KERJA_MANUAL", actorId: w.admin.user.id } }), 1);
  // ulang persis sama = tidak menulis
  const r2 = await w.admin.api.post(`${P}/units/${u.id}/work-progress`, { status: "DIKERJAKAN", note: "Mulai dikerjakan Meja 2" });
  assert.equal(r2.status, 200); assert.equal(r2.body.dicatat, false); assert.equal(await testPrisma.productionUnitWorkProgress.count({ where: { unitId: u.id } }), 1);
  // konflik: klien melihat riwayat kosong, tetapi sudah ada catatan
  const k = await w.admin.api.post(`${P}/units/${u.id}/work-progress`, { status: "SELESAI", expectedLatestId: null });
  assert.equal(k.status, 409); assert.equal(k.body.code, "RIWAYAT_BERUBAH"); assert.equal(k.body.detail.terakhir.oleh, w.admin.user.name);
  // validasi
  assert.equal((await w.admin.api.post(`${P}/units/${u.id}/work-progress`, { status: "TERTUNDA" })).status, 400);
  assert.equal((await w.admin.api.post(`${P}/units/${u.id}/work-progress`, { status: "TERTUNDA", note: "Menunggu kain dari supplier" })).status, 201);
  assert.equal((await w.admin.api.post(`${P}/units/${u.id}/work-progress`, { status: "ASAL" })).status, 400);
  // peran: PIC Meja dan akun hanya-lihat tidak boleh
  assert.equal((await w.worker.api.post(`${P}/units/${u.id}/work-progress`, { status: "SELESAI" })).status, 403);
  assert.equal((await w.viewer.api.post(`${P}/units/${u.id}/work-progress`, { status: "SELESAI" })).status, 403);
  assert.equal(await testPrisma.productionUnitWorkProgress.count({ where: { unitId: u.id } }), 2, "penolakan tidak menulis");
  // append-only di DB
  await assert.rejects(testPrisma.productionUnitWorkProgress.updateMany({ where: { unitId: u.id }, data: { note: "ubah" } }), /append-only/);
});

test("A3. BUKTI APLIKASI MENANG: status manual ditolak selagi unit dikerjakan lewat aplikasi; bila bukti muncul sesudah catatan manual, satu status efektif (aplikasi) dan catatan manual ditandai digantikan", async () => {
  const w = await world(); const { unit: u } = await unit(); const { unit: u2 } = await unit();
  // unit 1: bukti aplikasi sudah ada
  await testPrisma.unitStageLog.create({ data: { unitId: u.id, stageId: (await stage()).id, action: "START", actorId: w.worker.user.id } });
  const tolak = await w.admin.api.post(`${P}/units/${u.id}/work-progress`, { status: "SELESAI" });
  assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "KERJA_DIPEGANG_APLIKASI"); assert.equal(await testPrisma.productionUnitWorkProgress.count({ where: { unitId: u.id } }), 0);
  assert.equal(baris(await daftar(w), u.id).adopsi.kerja.source, "APLIKASI");
  // unit 2: manual dulu, lalu bukti aplikasi muncul
  assert.equal((await w.admin.api.post(`${P}/units/${u2.id}/work-progress`, { status: "SELESAI" })).status, 201);
  assert.equal(baris(await daftar(w), u2.id).adopsi.kerja.source, "MANUAL");
  await testPrisma.unitStageLog.create({ data: { unitId: u2.id, stageId: (await stage()).id, action: "START", actorId: w.worker.user.id } });
  const sesudah = baris(await daftar(w), u2.id).adopsi.kerja;
  assert.equal(sesudah.source, "APLIKASI", "tepat SATU status kerja: bukti aplikasi menggantikan"); assert.equal(sesudah.key, "DIKERJAKAN");
  const p = await panel(w, u2.id);
  assert.equal(p.kerjaManual.dikunciAplikasi, true); assert.ok(p.kerjaManual.riwayat.at(-1).digantikanBuktiAplikasi, "catatan manual terakhir ditandai digantikan");
  assert.equal((await w.admin.api.post(`${P}/units/${u2.id}/work-progress`, { status: "DIJADWALKAN" })).status, 409);
  // SKIP bukan bukti kerja
  const { unit: u3 } = await unit();
  await testPrisma.unitStageLog.create({ data: { unitId: u3.id, stageId: (await stage()).id, action: "SKIP", actorId: w.worker.user.id } });
  assert.equal((await w.admin.api.post(`${P}/units/${u3.id}/work-progress`, { status: "DIKERJAKAN" })).status, 201, "tahap yang hanya dilewati bukan bukti pekerjaan");
});

test("A4. STATUS ORDER dari Produksi memakai jalur Sales yang SAMA: Siap Kirim → unit + order + tepat satu job pengiriman; Sales melihat hasil identik; izin mengikuti ORDER_WRITE", async () => {
  const w = await world(); const { unit: u, order } = await unit({ pickup: "selesai" });
  const p0 = await panel(w, u.id); assert.equal(p0.izin.statusOrder, true); assert.equal(p0.izin.statusKerja, true);
  const res = await w.admin.api.patch(`/api/orders/${order.id}`, { status: "READY", statusOverrideNote: "Diubah dari Order Produksi" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: u.id } })).status, "READY_FOR_DELIVERY");
  assert.equal((await testPrisma.job.findMany({ where: { type: "DELIVERY", units: { some: { unitId: u.id } } } })).length, 1, "tepat satu job pengiriman (fungsi domain yang sama)");
  const daftarOrder = await w.admin.api.get(`/api/orders?search=${encodeURIComponent(order.orderNumber)}`); assert.equal(daftarOrder.status, 200, JSON.stringify(daftarOrder.body));
  const dt = daftarOrder.body; const arr = Array.isArray(dt) ? dt : (dt.items ?? dt.orders ?? dt.data ?? []); const barisOrder = arr.find((o) => o.id === order.id); assert.equal(barisOrder?.status, "READY", "daftar order (dibaca Sales/Delivery) melihat hasil yang sama");
  assert.equal((await testPrisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "READY");
  const sesudah = baris(await daftar(w), u.id).adopsi;
  assert.equal(sesudah.statusOrder.label, "Siap Kirim"); assert.equal(sesudah.kerja.key, "SELESAI"); assert.equal(sesudah.tindakan.aktor, "Delivery");
  assert.equal((await panel(w, u.id, "viewer")).izin.statusOrder, true, "SALES memang memegang ORDER_WRITE (jalur yang sama)");
  assert.equal((await panel(w, u.id, "worker")).izin.statusOrder, false);
  assert.equal((await panel(w, u.id, "worker")).izin.pemakaianAktual, true, "PIC memang boleh mencatat pemakaian");
});

test("A5. RENCANA BAHAN: dibuat & direvisi dengan riwayat; konflik revisi ditolak; TIDAK ada efek stok/reservasi/jurnal; validasi; peran dijaga", async () => {
  const w = await world(); const { unit: u } = await unit();
  const busa = await createTestMaterial({ name: "Busa HR 5cm", unit: "SHEET", itemGroup: "BUSA" }); const kain = await createTestMaterial({ name: "Kain Knit", unit: "METER", itemGroup: "KAIN" });
  await seedBalance(busa.id, 10);
  const sebelum = await hitungEfek();
  const put = (lines, rev, who = "admin", reason) => w[who].api.put(`${P}/units/${u.id}/material-plan`, { lines, expectedRevision: rev, reason });
  const r1 = await put([{ materialId: busa.id, qty: 4 }, { materialId: kain.id, qty: 2.5 }], 0, "admin", "Rencana awal");
  assert.equal(r1.status, 200, JSON.stringify(r1.body)); assert.equal(r1.body.revision, 1);
  assert.deepEqual(r1.body.rencana.plan.lines.map((l) => [l.kode, l.qty, l.satuan, l.kelompok.label]).sort(), [[busa.code, 4, "SHEET", "Busa"], [kain.code, 2.5, "METER", "Kain"]].sort());
  const kb = r1.body.rencana.plan.lines.find((l) => l.materialId === kain.id); assert.equal(kb.saldoDiketahui, false); assert.equal(kb.tersedia, null, "tanpa catatan stok = belum diketahui, BUKAN nol");
  assert.equal(r1.body.rencana.plan.lines.find((l) => l.materialId === busa.id).tersedia, 10);
  // revisi 2
  const r2 = await put([{ materialId: busa.id, qty: 6 }], 1, "lead", "Kain batal");
  assert.equal(r2.status, 200, JSON.stringify(r2.body)); assert.equal(r2.body.revision, 2);
  assert.deepEqual(r2.body.rencana.revisi.map((x) => x.revision), [1, 2]); assert.deepEqual(r2.body.rencana.revisi[1].perubahan.map((p) => p.aksi).sort(), ["HAPUS", "UBAH"]); assert.equal(r2.body.rencana.revisi[1].oleh, w.lead.user.name);
  // konflik: klien masih di revisi 1
  const k = await put([{ materialId: busa.id, qty: 9 }], 1, "admin");
  assert.equal(k.status, 409); assert.equal(k.body.code, "RIWAYAT_BERUBAH"); assert.equal(k.body.detail.revisiSekarang, 2); assert.equal(k.body.detail.oleh, w.lead.user.name);
  // tanpa perubahan = tidak menaikkan revisi
  const same = await put([{ materialId: busa.id, qty: 6 }], 2); assert.equal(same.body.disimpan, false); assert.equal(same.body.rencana.plan.revision, 2);
  // validasi
  assert.equal((await put([{ materialId: busa.id, qty: 1 }, { materialId: busa.id, qty: 2 }], 2)).status, 400);
  assert.equal((await put([{ materialId: busa.id, qty: 0 }], 2)).status, 400);
  await testPrisma.material.update({ where: { id: kain.id }, data: { active: false } });
  assert.equal((await put([{ materialId: kain.id, qty: 1 }], 2)).body.code, "RENCANA_BAHAN_NONAKTIF");
  // izin
  assert.equal((await put([{ materialId: busa.id, qty: 1 }], 2, "worker")).status, 403); assert.equal((await put([{ materialId: busa.id, qty: 1 }], 2, "viewer")).status, 403);
  // TIDAK ada efek lain
  const akhir = await hitungEfek(); assert.deepEqual(akhir, sebelum, "rencana bahan tidak menulis stok, reservasi, jurnal, tahap, QC, atau penerimaan");
  assert.equal(await testPrisma.productionUnitMaterialPlanRevision.count(), 2);
  await assert.rejects(testPrisma.productionUnitMaterialPlanRevision.deleteMany({}), /append-only/);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "unit", entityId: u.id, eventType: "PRODUCTION_RENCANA_BAHAN_DISIMPAN" } }), 2);
  const get = await w.viewer.api.get(`${P}/units/${u.id}/material-plan`); assert.equal(get.status, 200); assert.equal(get.body.plan.revision, 2);
});

test("A6. KATALOG per kelompok Gudang: pencarian menjangkau SELURUH katalog; bahan belum dikelompokkan tetap ketemu; saldo tak diketahui = null (bukan nol)", async () => {
  const w = await world();
  const busa = await createTestMaterial({ name: "Busa Latex 10", unit: "SHEET", itemGroup: "BUSA LATEX" });
  const kain = await createTestMaterial({ name: "Kain Rajut Abu", unit: "METER", itemGroup: "KAIN" });
  const pegas = await createTestMaterial({ name: "Per Bonnell 20", unit: "PCS", itemGroup: "PER BONNEL" });
  const tanpa = await createTestMaterial({ name: "Bahan Misterius", unit: "PCS" }); // tanpa itemGroup
  const nonaktif = await createTestMaterial({ name: "Busa Lama", unit: "SHEET", itemGroup: "BUSA", active: false });
  await seedBalance(busa.id, 7.5); await seedBalance(pegas.id, 0.0001); await testPrisma.stockMovement.create({ data: { materialId: pegas.id, type: "ADJUSTMENT", qty: -0.0001, note: "nol hitungan" } });
  const semua = await w.admin.api.get(`${P}/material-catalog`); assert.equal(semua.status, 200);
  const kode = (r) => r.rows.map((x) => x.nama).sort();
  assert.deepEqual(kode(semua.body), ["Bahan Misterius", "Busa Latex 10", "Kain Rajut Abu", "Per Bonnell 20"], "nonaktif tidak ikut");
  const g = Object.fromEntries(semua.body.kelompok.map((k) => [k.kode, k.jumlah])); assert.equal(g.BUSA, 1); assert.equal(g.KAIN, 1); assert.equal(g.PEGAS, 1); assert.equal(g.BELUM, 1);
  const bs = semua.body.rows.find((x) => x.nama === "Busa Latex 10"); assert.equal(bs.tersedia, 7.5); assert.equal(bs.saldoDiketahui, true);
  const kn = semua.body.rows.find((x) => x.nama === "Kain Rajut Abu"); assert.equal(kn.saldoDiketahui, false); assert.equal(kn.tersedia, null); assert.equal(kn.saldo, null);
  const nol = semua.body.rows.find((x) => x.nama === "Per Bonnell 20"); assert.equal(nol.saldoDiketahui, true); assert.equal(nol.keadaan, "NOL_TERHITUNG");
  // pencarian di seluruh katalog walau satu kelompok dipilih di UI (q tanpa kelompok); kelompok menyaring bila diminta
  assert.deepEqual(kode((await w.admin.api.get(`${P}/material-catalog?q=misterius`)).body), ["Bahan Misterius"]);
  assert.deepEqual(kode((await w.admin.api.get(`${P}/material-catalog?kelompok=KAIN`)).body), ["Kain Rajut Abu"]);
  assert.deepEqual(kode((await w.admin.api.get(`${P}/material-catalog?kelompok=BELUM`)).body), ["Bahan Misterius"]);
  assert.deepEqual(kode((await w.admin.api.get(`${P}/material-catalog?q=${busa.code}`)).body), ["Busa Latex 10"], "cari lewat Material ID/kode");
  assert.equal((await w.viewer.api.get(`${P}/material-catalog`)).status, 200);
});

test("A7. PEMAKAIAN AKTUAL tepat sekali: kunci sama = satu pergerakan (retry), dua permintaan bersamaan = satu, isian beda dengan kunci sama ditolak; tanpa kunci = perilaku lama; dokumen sumber + pelaku tampil", async () => {
  const w = await world(); const { unit: u } = await unit();
  const busa = await createTestMaterial({ name: "Busa A", unit: "SHEET", itemGroup: "BUSA" }); await seedBalance(busa.id, 20);
  const saldo = async () => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: busa.id }, _sum: { qty: true } }))._sum.qty);
  const pakai = (qty, key, who = "worker", extra = {}) => w[who].api.post(`/api/units/${u.id}/materials`, { materialId: busa.id, qty, note: "pakai", ...extra }, key ? { "Idempotency-Key": key } : {});
  const k1 = ym("kunci-satu-0001");
  const a = await pakai(3, k1); assert.equal(a.status, 201, JSON.stringify(a.body));
  const b = await pakai(3, k1); assert.equal(b.status, 200, JSON.stringify(b.body)); assert.equal(b.body.id, a.body.id, "retry = pergerakan yang sama");
  assert.equal(await saldo(), 17, "stok berkurang SEKALI"); assert.equal(await testPrisma.stockMovement.count({ where: { unitId: u.id, type: "ISSUE" } }), 1);
  // bersamaan
  const k2 = ym("kunci-dua-0002");
  const [c, d] = await Promise.all([pakai(2, k2), pakai(2, k2)]);
  assert.deepEqual([c.status, d.status].sort(), [200, 201], JSON.stringify([c.body, d.body])); assert.equal(c.body.id, d.body.id);
  assert.equal(await saldo(), 15); assert.equal(await testPrisma.stockMovement.count({ where: { unitId: u.id, type: "ISSUE" } }), 2);
  // isian beda + kunci sama
  const e = await pakai(5, k1); assert.equal(e.status, 409); assert.equal(e.body.code, "IDEMPOTENCY_KEY_REUSED"); assert.equal(await saldo(), 15);
  // kunci tidak valid
  assert.equal((await pakai(1, "pendek")).status, 400);
  // tanpa kunci: perilaku lama (dua panggilan = dua pergerakan)
  await pakai(1); await pakai(1); assert.equal(await saldo(), 13);
  // saldo tidak cukup ditolak dan tidak meninggalkan baris perintah
  const gagal = await pakai(500, ym("kunci-besar-0003")); assert.ok(gagal.status >= 400 && gagal.status < 500); assert.equal(await saldo(), 13);
  // tampilan: dokumen sumber, pelaku, perbandingan rencana vs aktual
  await w.admin.api.put(`${P}/units/${u.id}/material-plan`, { lines: [{ materialId: busa.id, qty: 4 }], expectedRevision: 0 });
  const p = await panel(w, u.id);
  const first = p.pemakaianAktual.baris.find((x) => x.id === a.body.id);
  assert.equal(first.dokumen.jenis, "Catat langsung (Produksi)"); assert.match(first.dokumen.nomor, /^MV-[0-9A-F]{8}$/); assert.equal(first.pelaku, w.worker.user.name); assert.equal(first.qty, 3);
  const cmp = p.perbandingan.find((x) => x.materialId === busa.id); assert.equal(cmp.rencana, 4); assert.equal(cmp.aktual, 7, "3+2+1+1");
  assert.equal(p.adopsi.aktualBahanAda, true);
});

test("A8. ORDER MULTI-UNIT dengan bahan berbeda satuan/kelompok: panel menunjukkan unit lain; rencana per unit terpisah; status order mengubah SEMUA unit lewat satu jalur", async () => {
  const w = await world();
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Multi" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `ADP-M-${++seq}`, value: 100, category: "LAYANAN", status: "PROCESSING", deliveryConfirmedDate: new Date("2026-10-25T00:00:00.000Z"), items: { create: [{ layananName: "Upgrade Fondasi + Lapisan", harga: 100, sortOrder: 1 }] } } });
  const u1 = (await unit({ order, seqNo: 1 })).unit; const u2 = (await unit({ order, seqNo: 2, status: "IN_PRODUCTION" })).unit; const u3 = (await unit({ order, seqNo: 3 })).unit;
  const busa = await createTestMaterial({ name: "Busa M", unit: "SHEET", itemGroup: "BUSA" }); const lem = await createTestMaterial({ name: "Lem Kasur", unit: "KG", itemGroup: "LEM" }); const kain = await createTestMaterial({ name: "Kain Knit", unit: "METER", itemGroup: "KAIN" });
  await w.admin.api.put(`${P}/units/${u1.id}/material-plan`, { lines: [{ materialId: busa.id, qty: 2 }, { materialId: lem.id, qty: 0.75 }], expectedRevision: 0 });
  await w.admin.api.put(`${P}/units/${u2.id}/material-plan`, { lines: [{ materialId: kain.id, qty: 3.5 }], expectedRevision: 0 });
  const p1 = await panel(w, u1.id); assert.equal(p1.unit.order.jumlahUnit, 3); assert.deepEqual(p1.unit.order.unitLain.map((x) => x.unitCode).sort(), [u2.unitCode, u3.unitCode].sort());
  assert.equal(p1.rencanaBahan.plan.lines.length, 2); assert.equal((await panel(w, u3.id)).rencanaBahan.plan, null);
  assert.deepEqual((await panel(w, u2.id)).rencanaBahan.plan.lines.map((l) => [l.satuan, l.kelompok.label]), [["METER", "Kain"]]);
  const res = await w.admin.api.patch(`/api/orders/${order.id}`, { status: "READY", statusOverrideNote: "Semua unit siap" }); assert.equal(res.status, 200, JSON.stringify(res.body));
  for (const u of [u1, u2, u3]) assert.equal((await testPrisma.unit.findUniqueOrThrow({ where: { id: u.id } })).status, "READY_FOR_DELIVERY");
  assert.equal((await testPrisma.job.findMany({ where: { type: "DELIVERY", orderId: order.id } })).length >= 1, true);
});

test("A9. AKUN HANYA-LIHAT (SALES): membaca daftar, panel, katalog, rencana, dan ekspor; tidak boleh menulis kerja/rencana; tanpa kebocoran harga", async () => {
  const w = await world(); const { unit: u } = await unit();
  assert.equal((await w.viewer.api.get(`${P}/work-orders`)).status, 200);
  const p = await panel(w, u.id, "viewer"); assert.equal(p.izin.statusKerja, false); assert.equal(p.izin.rencanaBahan, false); assert.equal(p.izin.pemakaianAktual, false);
  assert.equal(JSON.stringify(p).includes("unitCost"), false, "panel tidak memuat harga/HPP");
  assert.equal((await w.viewer.api.put(`${P}/units/${u.id}/material-plan`, { lines: [], expectedRevision: 0 })).status, 403);
  assert.equal((await w.viewer.api.get(`${P}/work-orders/export.xlsx`)).status, 200);
  const tanpaLogin = await fetch(`${server.baseUrl}${P}/units/${u.id}/adopsi`); assert.equal(tanpaLogin.status, 401);
  assert.equal((await w.admin.api.get(`${P}/units/00000000-0000-4000-8000-000000000000/adopsi`)).status, 404);
});

// ───────────────────────────── EKSPOR EXCEL ─────────────────────────────
async function unduhXlsx(who, query = "") {
  const res = await fetch(`${server.baseUrl}${P}/work-orders/export.xlsx${query}`, { headers: { Authorization: `Bearer ${who.token}` } });
  assert.equal(res.status, 200, await res.clone().text().catch(() => ""));
  assert.match(res.headers.get("content-type"), /spreadsheetml\.sheet/); assert.match(res.headers.get("content-disposition"), /^attachment; filename="Order-Produksi-\d{8}-\d{4}\.xlsx"$/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString("latin1"), "PK", "berkas ZIP/OOXML sungguhan, bukan CSV");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return { wb, buf };
}
const nilaiSel = (c) => (c.value && typeof c.value === "object" && !(c.value instanceof Date) ? (c.value.richText ? c.value.richText.map((r) => r.text).join("") : c.value.result ?? c.value) : c.value);
const kolomIndex = (ws, header) => { const i = ws.getRow(1).values.findIndex((v) => v === header); assert.ok(i > 0, `kolom ${header}`); return i; };

test("B1. EKSPOR .xlsx: sheet, header beku + AutoFilter, tanpa sel digabung, angka numerik, tanggal WIB, warna status + teks, rumus dinetralkan, jumlah baris = daftar yang difilter", async () => {
  const w = await world();
  const a = await unit({ pickup: "selesai", pelanggan: "=HYPERLINK(\"http://x\",\"klik\")", layanan: "+Service Fondasi" });
  const b = await unit({ status: "READY_FOR_DELIVERY", orderStatus: "READY", pelanggan: "Bu Siti" });
  const c = await unit({ status: "AWAITING_PICKUP", orderStatus: "PICKUP", pelanggan: "Pak Budi" });
  await w.admin.api.post(`${P}/units/${a.unit.id}/work-progress`, { status: "DIKERJAKAN", note: "=1+1" });
  const busa = await createTestMaterial({ name: "@Busa Bahaya", unit: "SHEET", itemGroup: "BUSA" }); const kain = await createTestMaterial({ name: "Kain Rajut", unit: "METER", itemGroup: "KAIN" });
  await seedBalance(busa.id, 10);
  await w.admin.api.put(`${P}/units/${a.unit.id}/material-plan`, { lines: [{ materialId: busa.id, qty: 4 }, { materialId: kain.id, qty: 2.5 }], expectedRevision: 0 });
  await w.worker.api.post(`/api/units/${a.unit.id}/materials`, { materialId: busa.id, qty: 1.25, note: "pakai" }, { "Idempotency-Key": ym("ekspor-pakai-0001") });
  const { wb } = await unduhXlsx(w.admin);
  assert.deepEqual(wb.worksheets.map((s) => s.name), ["Ringkasan Unit", "Rencana Bahan", "Pemakaian Aktual", "Komponen Lama", "Pemakaian Sementara", "Catatan Historis", "Info Ekspor"]); // "Catatan Historis" (Excel Admin Sales) ditambahkan Okt 2026 — aditif, sheet lama tak berubah
  const ring = wb.getWorksheet("Ringkasan Unit"); const daftarData = await daftar(w);
  assert.equal(ring.rowCount - 1, daftarData.units.length, "baris = daftar"); assert.equal(ring.rowCount - 1, 3);
  for (const ws of [ring, wb.getWorksheet("Rencana Bahan"), wb.getWorksheet("Pemakaian Aktual"), wb.getWorksheet("Komponen Lama"), wb.getWorksheet("Pemakaian Sementara"), wb.getWorksheet("Catatan Historis")]) {
    assert.equal(ws.views[0].state, "frozen"); assert.equal(ws.views[0].ySplit, 1, `${ws.name}: baris header dibekukan`);
    assert.ok(ws.autoFilter, `${ws.name}: AutoFilter`); const af = typeof ws.autoFilter === "string" ? ws.autoFilter : `${ws.autoFilter.from?.row}:${ws.autoFilter.to?.row}`; assert.ok(typeof ws.autoFilter === "string" ? /^A1:/.test(af) : af.startsWith("1:"), `${ws.name}: AutoFilter di baris header (${af})`);
    assert.equal(Object.keys(ws._merges ?? {}).length, 0, `${ws.name}: tidak ada sel digabung di area data`);
    const h = ws.getRow(1).getCell(1); assert.equal(h.font.bold, true); assert.equal(h.fill.fgColor.argb, "FF1E2139");
  }
  // header ringkasan
  const headers = ring.getRow(1).values.slice(1);
  for (const h of ["Kode Order", "Kode Unit", "Pelanggan", "Layanan (Sales)", "Target Selesai", "PIC", "Status Order", "Posisi Unit", "Status Kerja (Administratif)", "Tindakan Berikutnya", "Diperbarui (WIB)"]) assert.ok(headers.includes(h), h);
  const cKode = kolomIndex(ring, "Kode Unit"); const rowA = Array.from({ length: ring.rowCount - 1 }, (_, i) => ring.getRow(i + 2)).find((r) => nilaiSel(r.getCell(cKode)) === a.unit.unitCode);
  // rumus dinetralkan (apostrof) — bukan rumus dan tidak dieksekusi
  const pel = rowA.getCell(kolomIndex(ring, "Pelanggan")); assert.equal(typeof nilaiSel(pel), "string"); assert.equal(nilaiSel(pel).startsWith("'="), true); assert.equal(pel.formula, undefined);
  assert.equal(nilaiSel(rowA.getCell(kolomIndex(ring, "Layanan (Sales)"))).startsWith("'+"), true);
  // tipe + warna + teks
  const so = rowA.getCell(kolomIndex(ring, "Status Order")); assert.equal(nilaiSel(so), "Diproses"); assert.equal(so.fill.fgColor.argb, "FFDBEAFE");
  const kerja = rowA.getCell(kolomIndex(ring, "Status Kerja (Administratif)")); assert.equal(nilaiSel(kerja), "Sudah dikerjakan"); assert.ok(kerja.fill?.fgColor?.argb, "warna status kerja ada, teks tetap ada");
  assert.match(nilaiSel(rowA.getCell(kolomIndex(ring, "Posisi Unit"))), /belum diterima workshop/);
  const br = rowA.getCell(kolomIndex(ring, "Jumlah Bahan Direncanakan")); assert.equal(typeof nilaiSel(br), "number"); assert.equal(nilaiSel(br), 2);
  const upd = rowA.getCell(kolomIndex(ring, "Diperbarui (WIB)")); assert.ok(nilaiSel(upd) instanceof Date); assert.equal(upd.numFmt, "dd/mm/yyyy hh:mm");
  const rowB = Array.from({ length: ring.rowCount - 1 }, (_, i) => ring.getRow(i + 2)).find((r) => nilaiSel(r.getCell(cKode)) === b.unit.unitCode);
  assert.equal(rowB.getCell(kolomIndex(ring, "Status Order")).fill.fgColor.argb, "FFDCFCE7", "Siap Kirim = hijau");
  // rencana bahan
  const rb = wb.getWorksheet("Rencana Bahan"); assert.equal(rb.rowCount - 1, 2);
  const rbRows = Array.from({ length: 2 }, (_, i) => rb.getRow(i + 2));
  const qty = rbRows.map((r) => nilaiSel(r.getCell(kolomIndex(rb, "Jumlah Rencana")))).sort(); assert.deepEqual(qty, [2.5, 4]); assert.ok(qty.every((q) => typeof q === "number"));
  const ket = rbRows.map((r) => nilaiSel(r.getCell(kolomIndex(rb, "Status Ketersediaan")))); assert.ok(ket.includes("Tersedia")); assert.ok(ket.some((k) => /Belum diketahui/.test(k)), "saldo tak diketahui tidak ditulis sebagai nol");
  const grp = rbRows.map((r) => nilaiSel(r.getCell(kolomIndex(rb, "Kelompok")))).sort(); assert.deepEqual(grp, ["Busa", "Kain"]);
  assert.equal(nilaiSel(rbRows.find((r) => /Bahaya/.test(String(nilaiSel(r.getCell(kolomIndex(rb, "Nama Bahan")))))).getCell(kolomIndex(rb, "Nama Bahan"))).startsWith("'@"), true);
  // pemakaian aktual
  const pa = wb.getWorksheet("Pemakaian Aktual"); assert.equal(pa.rowCount - 1, 1);
  const r = pa.getRow(2); assert.equal(nilaiSel(r.getCell(kolomIndex(pa, "Jumlah Aktual"))), 1.25); assert.equal(nilaiSel(r.getCell(kolomIndex(pa, "PIC"))), w.worker.user.name);
  assert.equal(nilaiSel(r.getCell(kolomIndex(pa, "Jenis Dokumen"))), "Catat langsung (Produksi)"); assert.match(nilaiSel(r.getCell(kolomIndex(pa, "Nomor Dokumen"))), /^MV-[0-9A-F]{8}$/); assert.ok(nilaiSel(r.getCell(kolomIndex(pa, "Tanggal (WIB)"))) instanceof Date);
  // info ekspor
  const info = wb.getWorksheet("Info Ekspor"); const kv = new Map(Array.from({ length: info.rowCount - 1 }, (_, i) => [nilaiSel(info.getRow(i + 2).getCell(1)), nilaiSel(info.getRow(i + 2).getCell(2))]));
  assert.match(kv.get("Diekspor (WIB)"), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB$/); assert.equal(kv.get("Diekspor oleh"), w.admin.user.name); assert.equal(kv.get("Jumlah unit (Ringkasan Unit)"), 3); assert.equal(kv.get("Filter: pencarian"), "Tanpa pencarian");
});

test("B2. EKSPOR mengikuti FILTER daftar: pencarian, status order, status kerja; sheet Pemakaian Aktual kosong bila belum ada transaksi; tanpa data = hanya header", async () => {
  const w = await world();
  const a = await unit({ pelanggan: "Ibu Ani Tertentu" }); const b = await unit({ status: "READY_FOR_DELIVERY", orderStatus: "READY", pelanggan: "Bu Siti" }); await unit({ status: "AWAITING_PICKUP", orderStatus: "PICKUP", pelanggan: "Pak Budi" });
  await w.admin.api.post(`${P}/units/${a.unit.id}/work-progress`, { status: "DIKERJAKAN" });
  const hitung = async (q) => (await unduhXlsx(w.admin, q)).wb.getWorksheet("Ringkasan Unit").rowCount - 1;
  assert.equal(await hitung("?q=Ibu%20Ani"), 1); assert.equal((await daftar(w, "&q=Ibu%20Ani")).units.length, 1);
  assert.equal(await hitung("?displayStatus=SIAP_KIRIM"), 1); assert.equal((await daftar(w, "&displayStatus=SIAP_KIRIM")).units[0].id, b.unit.id);
  assert.equal(await hitung("?statusKerja=DIKERJAKAN"), 1); assert.equal((await daftar(w, "&statusKerja=DIKERJAKAN")).total, 1);
  assert.equal(await hitung("?statusKerja=SELESAI"), 1, "Siap Kirim = Selesai (mengikuti status order)");
  assert.equal(await hitung("?statusKerja=DIKERJAKAN,SELESAI"), 2);
  assert.equal(await hitung("?q=tidak-ada-sama-sekali"), 0);
  const { wb } = await unduhXlsx(w.admin, "?displayStatus=SIAP_KIRIM");
  assert.equal(wb.getWorksheet("Pemakaian Aktual").rowCount, 1, "kosong: hanya header"); assert.equal(wb.getWorksheet("Rencana Bahan").rowCount, 1);
  const kv = new Map(Array.from({ length: wb.getWorksheet("Info Ekspor").rowCount - 1 }, (_, i) => [nilaiSel(wb.getWorksheet("Info Ekspor").getRow(i + 2).getCell(1)), nilaiSel(wb.getWorksheet("Info Ekspor").getRow(i + 2).getCell(2))]));
  assert.equal(kv.get("Filter: status order"), "SIAP_KIRIM");
  // paginasi daftar tidak mengubah total saat filter statusKerja
  const p1raw = await w.admin.api.get(`${P}/work-orders?statusKerja=BELUM_DIJADWALKAN,DIKERJAKAN,SELESAI&pageSize=1&page=2`); assert.equal(p1raw.status, 200); const p1 = p1raw.body; assert.equal(p1.total, 3); assert.equal(p1.units.length, 1); assert.equal(p1.hasMore, true);
});

test("A10. HAPUS order/unit: catatan status kerja atau rencana bahan = jejak operasional → ditolak 409 yang ramah (bukan 500 karena FK); unit bersih tetap bisa dihapus", async () => {
  const w = await world();
  const { unit: u, order } = await unit({ pickup: "selesai" });
  const bersih = await unit({});
  assert.equal((await w.admin.api.post(`${P}/units/${u.id}/work-progress`, { status: "DIKERJAKAN", expectedLatestId: null })).status, 201);
  const hapusOrder = await w.admin.api.delete(`/api/orders/${order.id}`);
  assert.equal(hapusOrder.status, 409, JSON.stringify(hapusOrder.body)); assert.match(hapusOrder.body.error, /jejak operasional/);
  const hapusUnit = await w.admin.api.delete(`/api/orders/units/${u.id}`);
  assert.equal(hapusUnit.status, 409, JSON.stringify(hapusUnit.body));
  assert.ok(await testPrisma.unit.findUnique({ where: { id: u.id } }) && await testPrisma.order.findUnique({ where: { id: order.id } }), "data utuh");
  // rencana bahan saja (tanpa status kerja) juga jejak
  const m = await createTestMaterial({ name: "Busa Hapus", unit: "SHEET" }); await seedBalance(m.id, 5);
  const dua = await unit({});
  assert.equal((await w.admin.api.put(`${P}/units/${dua.unit.id}/material-plan`, { expectedRevision: 0, lines: [{ materialId: m.id, qty: 1 }] })).status, 200);
  assert.equal((await w.admin.api.delete(`/api/orders/units/${dua.unit.id}`)).status, 409);
  // unit tanpa jejak apa pun: perilaku lama utuh
  const ok = await w.admin.api.delete(`/api/orders/units/${bersih.unit.id}`); assert.equal(ok.status, 200, JSON.stringify(ok.body));
});
