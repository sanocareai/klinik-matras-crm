// Aturan Owner: pemakaian aktual yang BERHASIL tercatat → status kerja administratif "Sudah dikerjakan" (bahan baru lewat jalur stok resmi; komponen lama hanya bila hasil 'dipakai kembali').
// Tanpa wajib Rencana Bahan/jadwal/Run/Meja/Corner/dokumentasi/QC; tanpa status antara; rencana & komponen dikembalikan/disimpan/dibuang TIDAK mengubah status; kegagalan/klik ganda/koreksi/izin tidak merusak konsistensi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let seq = 0; const kunci = (t) => `uji-${t}-${Date.now().toString(36)}-${++seq}-aaaaaaaa`;
async function dunia() {
  const admin = await createTestUser({ roles: ["ADMIN"] }); const sales = await createTestUser({ roles: ["SALES"] });
  const { unit } = await createTestUnit({ status: "RECEIVED" });
  const c = (u) => makeClient(server.baseUrl, u.token);
  return { a: c(admin), s: c(sales), admin: { id: admin.user.id, token: admin.token }, unit };
}
const adopsi = async (w, unit = w.unit) => (await w.a.get(`/api/production/units/${unit.id}/adopsi`)).body;
const kerja = async (w, unit = w.unit) => (await adopsi(w, unit)).adopsi.kerja;
const pakaiBaru = (w, m, qty, key = kunci("pb")) => w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty }, { "Idempotency-Key": key });
const komp = (o = {}) => ({ name: "Pegas bongkaran", qty: 12, uom: "PCS", condition: "Bagus", workPart: "Rangka", outcome: "REUSED", ...o });
const catatKomp = (w, body = komp(), key = kunci("k")) => w.a.post(`/api/production/units/${w.unit.id}/komponen-lama`, body, { "Idempotency-Key": key });
const jumlah = async () => ({
  jadwal: await testPrisma.productionUnitSchedule.count(), jadwalEv: await testPrisma.productionUnitScheduleEvent.count(), run: await testPrisma.productionRun.count(), plan: await testPrisma.productionRunPlan.count(),
  progres: await testPrisma.productionUnitWorkProgress.count(), rencana: await testPrisma.productionUnitMaterialPlan.count(), mi: await testPrisma.materialIssue.count(), rsv: await testPrisma.materialReservation.count(),
  stage: await testPrisma.unitStageLog.count(), qc: await testPrisma.qualityInspection.count(),
});
const mat = async (code = "KAIN-S") => { const m = await createTestMaterial({ code, unit: "METER", itemGroup: "KAIN" }); await seedBalance(m.id, 20); return m; };
const eventsOtomatis = (ad) => ad.riwayat.filter((e) => e.kind === "STATUS_KERJA_OTOMATIS");

test("S1. TANPA jadwal dan TANPA rencana: bahan baru berhasil diposting → 'Sudah dikerjakan' (satu-satunya status 'dikerjakan'), fakta 'Dikerjakan tanpa jadwal', tidak ada jadwal/Run/rencana/Meja/QC fiktif", async () => {
  const w = await dunia(); const m = await mat();
  const k0 = await kerja(w); assert.equal(k0.key, "BELUM_DIJADWALKAN"); const j0 = await jumlah();
  const r = await pakaiBaru(w, m, 2); assert.equal(r.status, 201, JSON.stringify(r.body));
  const k1 = await kerja(w);
  assert.equal(k1.key, "DIKERJAKAN"); assert.equal(k1.label, "Sudah dikerjakan"); assert.equal(k1.source, "PEMAKAIAN_BAHAN"); assert.equal(k1.sourceLabel, "Otomatis dari pemakaian bahan");
  assert.equal(k1.tanpaJadwal, true); assert.equal(k1.faktaJadwal, "Dikerjakan tanpa jadwal"); assert.match(k1.detail, /belum berarti selesai QC, siap serah Gudang, atau siap kirim/);
  const j1 = await jumlah(); assert.deepEqual({ ...j1 }, { ...j0 }, "tidak ada jadwal, riwayat jadwal, Run, rencana Meja, status manual, rencana bahan, Material Issue, reservasi, log tahap, atau QC yang dibuat");
  const ad = await adopsi(w); assert.equal(ad.adopsi.jadwal, null, "tidak ada jadwal fiktif"); assert.equal(ad.adopsi.pemakaianBahan.baruCatatan, 1); assert.equal(ad.adopsi.pemakaianBahan.komponenLamaDipakaiKembali, 0);
  assert.equal(await testPrisma.unit.findUnique({ where: { id: w.unit.id } }).then((u) => u.status), "RECEIVED", "status order/unit tidak berubah");
  assert.equal(Number((await testPrisma.stockMovement.aggregate({ where: { materialId: m.id }, _sum: { qty: true } }))._sum.qty), 18);
  assert.equal(eventsOtomatis(ad).length, 1);
});

test("S2. komponen lama 'dipakai kembali' → 'Sudah dikerjakan' (tanpa jadwal/rencana); stok, jurnal, biaya tidak berubah", async () => {
  const w = await dunia(); const m = await mat("KAIN-S2"); const sm0 = await testPrisma.stockMovement.count(); const jur0 = await testPrisma.finJournalEntry.count();
  assert.equal((await kerja(w)).key, "BELUM_DIJADWALKAN"); const j0 = await jumlah();
  const r = await catatKomp(w); assert.equal(r.status, 201);
  const k = await kerja(w); assert.equal(k.key, "DIKERJAKAN"); assert.equal(k.source, "PEMAKAIAN_BAHAN"); assert.equal(k.faktaJadwal, "Dikerjakan tanpa jadwal");
  assert.deepEqual(await jumlah(), j0); assert.equal(await testPrisma.stockMovement.count(), sm0); assert.equal(await testPrisma.finJournalEntry.count(), jur0); assert.equal(Number((await testPrisma.stockMovement.aggregate({ where: { materialId: m.id }, _sum: { qty: true } }))._sum.qty), 20);
  const ad = await adopsi(w); assert.equal(ad.adopsi.pemakaianBahan.komponenLamaDipakaiKembali, 1); assert.equal(ad.adopsi.pemakaianBahan.baruCatatan, 0, "dua sumber tidak dijumlahkan"); assert.equal(eventsOtomatis(ad).length, 1);
});

test("S3. yang TIDAK mengubah status kerja: rencana bahan; komponen dikembalikan/disimpan/dibuang; pemakaian yang gagal", async () => {
  const w = await dunia(); const m = await mat("KAIN-S3");
  const put = await w.a.put(`/api/production/units/${w.unit.id}/material-plan`, { lines: [{ materialId: m.id, qty: 4 }], expectedRevision: 0 }); assert.equal(put.status, 200);
  assert.equal((await kerja(w)).key, "BELUM_DIJADWALKAN", "rencana bahan saja");
  for (const o of ["RETURNED_TO_CUSTOMER", "KEPT_WITH_UNIT", "DISCARDED"]) { assert.equal((await catatKomp(w, komp({ outcome: o, workPart: "" }))).status, 201); assert.equal((await kerja(w)).key, "BELUM_DIJADWALKAN", `hasil ${o}`); }
  assert.equal((await adopsi(w)).adopsi.pemakaianBahan.komponenLamaDipakaiKembali, 0); assert.equal(eventsOtomatis(await adopsi(w)).length, 0);
});

test("S4. KEGAGALAN pencatatan tidak mengubah status: stok kurang, stok tidak diketahui, komponen tidak valid, unit dibatalkan, tanpa izin", async () => {
  const w = await dunia(); const kurang = await createTestMaterial({ code: "PEGAS-S4", unit: "METER" }); await seedBalance(kurang.id, 1); const tak = await createTestMaterial({ code: "LEM-S4", unit: "CAN" });
  const j0 = await jumlah(); const sm0 = await testPrisma.stockMovement.count();
  assert.ok((await pakaiBaru(w, kurang, 5)).status >= 400); assert.ok((await pakaiBaru(w, tak, 1)).status >= 400);
  assert.equal((await catatKomp(w, komp({ qty: 0 }))).status, 400); assert.equal((await catatKomp(w, komp({ condition: "" }))).status, 400); assert.equal((await catatKomp(w, komp({ workPart: "" }))).status, 400);
  assert.equal((await w.s.post(`/api/units/${w.unit.id}/materials`, { materialId: kurang.id, qty: 1 }, { "Idempotency-Key": kunci("s4s") })).status, 403);
  assert.equal((await w.s.post(`/api/production/units/${w.unit.id}/komponen-lama`, komp(), { "Idempotency-Key": kunci("s4k") })).status, 403);
  assert.equal((await kerja(w)).key, "BELUM_DIJADWALKAN"); assert.deepEqual(await jumlah(), j0); assert.equal(await testPrisma.stockMovement.count(), sm0); assert.equal(await testPrisma.unitComponentReuseEntry.count(), 0);
  assert.equal(eventsOtomatis(await adopsi(w)).length, 0);
  await testPrisma.unit.update({ where: { id: w.unit.id }, data: { status: "CANCELLED" } }); assert.equal((await catatKomp(w)).body.code, "UNIT_TIDAK_AKTIF"); assert.equal((await kerja(w)).key, "DIBATALKAN", "unit batal tetap Dibatalkan");
});

test("S5. klik ganda/retry/paralel: satu pergerakan, satu peristiwa status otomatis, pemakaian berikutnya tidak menggandakan peristiwa", async () => {
  const w = await dunia(); const m = await mat("KAIN-S5"); const k1 = kunci("s5");
  const hasil = await Promise.all([1, 2, 3].map(() => pakaiBaru(w, m, 1, k1))); assert.ok(hasil.every((r) => [200, 201].includes(r.status)));
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: w.unit.id, type: "ISSUE" } }), 1);
  assert.equal(eventsOtomatis(await adopsi(w)).length, 1);
  assert.equal((await pakaiBaru(w, m, 1)).status, 201); assert.equal((await catatKomp(w)).status, 201);
  const ad = await adopsi(w); assert.equal(eventsOtomatis(ad).length, 1, "status otomatis tidak berulang"); assert.equal(ad.adopsi.kerja.key, "DIKERJAKAN"); assert.equal(await testPrisma.productionUnitWorkProgress.count(), 0, "tidak ada baris status ganda/tersembunyi");
  const kl = hasil.length && (await catatKomp(w, komp(), kunci("s5k"))); const klg = await Promise.all([1, 2].map(() => catatKomp(w, komp({ name: "Busa lama" }), "uji-komp-ganda-aaaaaaaa"))); assert.ok(klg.every((r) => [200, 201].includes(r.status))); void kl;
  assert.equal(await testPrisma.unitComponentReuseEntry.count({ where: { name: "Busa lama" } }), 1);
});

test("S6. koreksi TIDAK menghapus fakta 'pernah dikerjakan': pengembalian penuh bahan baru; komponen dikoreksi/dibatalkan — status dan peristiwa tetap; koreksi tidak menambah peristiwa", async () => {
  const w = await dunia(); const m = await mat("KAIN-S6");
  assert.equal((await pakaiBaru(w, m, 3)).status, 201);
  const kor = await pakaiBaru(w, m, -3, kunci("s6k")); assert.equal(kor.status, 201); assert.equal(Number((await testPrisma.stockMovement.aggregate({ where: { materialId: m.id }, _sum: { qty: true } }))._sum.qty), 20, "stok kembali");
  let ad = await adopsi(w); assert.equal(ad.adopsi.kerja.key, "DIKERJAKAN", "pengembalian penuh tidak menghapus fakta pekerjaan pernah dilakukan"); assert.equal(ad.pemakaianAktual.baris.length, 2, "baris asli + pengembalian"); assert.equal(eventsOtomatis(ad).length, 1);
  assert.equal(ad.adopsi.pemakaianBahan.baruCatatan, 1, "hanya ISSUE yang dihitung; pengembalian bukan pemakaian baru");
  const w2 = await dunia(); const r = await catatKomp(w2); const item = r.body.item; const url = `/api/production/units/${w2.unit.id}/komponen-lama/${item.itemId}`;
  assert.equal((await w2.a.post(`${url}/koreksi`, { expectedVersion: 1, data: komp({ qty: 8 }), reason: "Salah hitung" }, { "Idempotency-Key": kunci("s6a") })).status, 201);
  assert.equal((await w2.a.post(`${url}/batal`, { expectedVersion: 2, reason: "Salah input" }, { "Idempotency-Key": kunci("s6b") })).status, 201);
  ad = await adopsi(w2); assert.equal(ad.adopsi.kerja.key, "DIKERJAKAN", "pembatalan tidak menghapus fakta historis"); assert.equal(eventsOtomatis(ad).length, 1); assert.equal(await testPrisma.unitComponentReuseEntry.count({ where: { itemId: item.itemId } }), 3);
  // komponen dikoreksi dari 'dibuang' menjadi 'dipakai kembali' = fakta pemakaian baru → Sudah dikerjakan
  const w3 = await dunia(); const d = await catatKomp(w3, komp({ outcome: "DISCARDED", workPart: "" })); assert.equal((await kerja(w3)).key, "BELUM_DIJADWALKAN");
  assert.equal((await w3.a.post(`/api/production/units/${w3.unit.id}/komponen-lama/${d.body.item.itemId}/koreksi`, { expectedVersion: 1, data: komp({ outcome: "REUSED" }), reason: "Ternyata dipakai kembali" }, { "Idempotency-Key": kunci("s6c") })).status, 201);
  assert.equal((await kerja(w3)).key, "DIKERJAKAN");
});

test("S7. jadwal Admin sudah ada: tetap Sudah dikerjakan tanpa fakta 'tanpa jadwal'; jadwal tidak diubah/ditambah", async () => {
  const w = await dunia(); const m = await mat("KAIN-S7");
  const s = await testPrisma.productionUnitSchedule.create({ data: { unitId: w.unit.id, productionDate: new Date("2030-01-07T00:00:00Z"), stationCode: "TABLE_1", revision: 1, status: "ACTIVE", createdById: w.admin.id } });
  assert.equal((await pakaiBaru(w, m, 1)).status, 201);
  const k = await kerja(w); assert.equal(k.key, "DIKERJAKAN"); assert.equal(k.faktaJadwal, null); assert.equal(k.tanpaJadwal, false);
  const sesudah = await testPrisma.productionUnitSchedule.findUnique({ where: { id: s.id } }); assert.equal(sesudah.revision, 1); assert.equal(sesudah.status, "ACTIVE"); assert.equal(await testPrisma.productionUnitSchedule.count(), 1);
  assert.equal((await adopsi(w)).adopsi.jadwal.sumber, "ADMIN");
});

test("S8. catatan manual: yang lebih baru menang (Tertunda), pemakaian baru sesudahnya = Sudah dikerjakan lagi, Selesai manual tidak diturunkan", async () => {
  const w = await dunia(); const m = await mat("KAIN-S8");
  assert.equal((await pakaiBaru(w, m, 1)).status, 201); assert.equal((await kerja(w)).key, "DIKERJAKAN");
  const tunda = await w.a.post(`/api/production/units/${w.unit.id}/work-progress`, { status: "TERTUNDA", note: "Menunggu kain" }); assert.equal(tunda.status, 201);
  assert.equal((await kerja(w)).key, "TERTUNDA");
  await new Promise((r) => setTimeout(r, 30)); assert.equal((await pakaiBaru(w, m, 1)).status, 201); assert.equal((await kerja(w)).key, "DIKERJAKAN");
  assert.equal(eventsOtomatis(await adopsi(w)).length, 1);
  const selesai = await w.a.post(`/api/production/units/${w.unit.id}/work-progress`, { status: "SELESAI" }); assert.equal(selesai.status, 201);
  await new Promise((r) => setTimeout(r, 30)); assert.equal((await pakaiBaru(w, m, 1)).status, 201); assert.equal((await kerja(w)).key, "SELESAI");
});

test("S9. 'Sudah dikerjakan' ≠ QC/siap serah/siap kirim: status order dan posisi tidak berubah; tidak ada QC; status order Siap Kirim tetap SELESAI", async () => {
  const w = await dunia(); const m = await mat("KAIN-S9"); assert.equal((await pakaiBaru(w, m, 1)).status, 201);
  const ad = await adopsi(w); assert.equal(ad.unit.status, "RECEIVED"); assert.notEqual(ad.adopsi.statusOrder.key, "SIAP_KIRIM"); assert.equal(await testPrisma.qualityInspection.count(), 0);
  await testPrisma.unit.update({ where: { id: w.unit.id }, data: { status: "READY_FOR_DELIVERY" } }); assert.equal((await kerja(w)).key, "SELESAI");
});

test("S10. daftar + filter + Excel: filter 'Sudah dikerjakan' memuat unit; Excel membedakan status kerja administratif, jadwal, pemakaian bahan (dua sumber), QC", async () => {
  const w = await dunia(); const m = await mat("KAIN-S10"); assert.equal((await pakaiBaru(w, m, 2)).status, 201); assert.equal((await catatKomp(w)).status, 201);
  const { unit: u2 } = await createTestUnit({ status: "RECEIVED" });
  const lst = await w.a.get("/api/production/work-orders?statusKerja=DIKERJAKAN&pageSize=50"); assert.equal(lst.status, 200); assert.deepEqual(lst.body.units.map((u) => u.id), [w.unit.id]); assert.notEqual(lst.body.units[0].id, u2.id);
  const res = await fetch(`${server.baseUrl}/api/production/work-orders/export.xlsx`, { headers: { Authorization: `Bearer ${w.admin.token}` } }); assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer())); const ws = wb.getWorksheet("Ringkasan Unit"); const head = ws.getRow(1).values.slice(1);
  for (const h of ["Status Kerja (Administratif)", "Sumber Status Kerja", "Jadwal Produksi", "Fakta Jadwal", "Pemakaian Bahan Baru (jumlah catatan)", "Komponen Lama Dipakai Kembali (jumlah)", "Status QC (aplikasi)"]) assert.ok(head.includes(h), h);
  const baris = Object.fromEntries(head.map((h, i) => [h, ws.getRows(2, ws.rowCount - 1).find((r) => r.values[head.indexOf("Kode Unit") + 1] === w.unit.unitCode).values[i + 1]]));
  assert.equal(baris["Status Kerja (Administratif)"], "Sudah dikerjakan"); assert.equal(baris["Sumber Status Kerja"], "Otomatis dari pemakaian bahan"); assert.equal(baris["Jadwal Produksi"], "Belum dijadwalkan"); assert.equal(baris["Fakta Jadwal"], "Dikerjakan tanpa jadwal");
  assert.equal(baris["Pemakaian Bahan Baru (jumlah catatan)"], 1); assert.equal(baris["Komponen Lama Dipakai Kembali (jumlah)"], 1); assert.equal(baris["Status QC (aplikasi)"], "Belum ada catatan QC");
  const info = wb.getWorksheet("Info Ekspor"); const ket = info.getRows(2, info.rowCount - 1).map((r) => r.values[1]); assert.ok(ket.includes("Status kerja administratif"));
});
