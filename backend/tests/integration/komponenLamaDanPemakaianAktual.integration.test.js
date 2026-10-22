// BAHAN di Ruang Kerja Unit: (A) pemakaian aktual bahan baru TANPA rencana lewat jalur stok resmi (POST /units/:id/materials) — tepat sekali, saldo kurang/tidak diketahui ditolak, koreksi berjejak;
// (B) komponen LAMA dari unit pelanggan (pemakaian kembali, BUKAN stok): tidak mengubah saldo/pergerakan/Material Issue/reservasi/jurnal/biaya; versi append-only; koreksi/batal berjejak; tanpa lintas unit; label+total terpisah di Ringkasan, Riwayat, Excel.
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
  const { unit, order } = await createTestUnit({ status: "RECEIVED" });
  const unitLain = (await createTestUnit({ status: "RECEIVED" })).unit;
  const c = (u) => makeClient(server.baseUrl, u.token);
  return { a: c(admin), s: c(sales), admin: { id: admin.user.id, token: admin.token, name: admin.user.name }, unit, order, unitLain };
}
const hitung = async () => Object.fromEntries(await Promise.all([["sm", "stock_movements"], ["mi", "material_issues"], ["rsv", "material_reservations_v2"], ["jur", "fin_journal_entries"], ["job", "jobs"], ["outbox", "domain_outbox"], ["rencana", "production_unit_material_plans"]].map(async ([k, t]) => [k, Number((await testPrisma.$queryRawUnsafe(`select count(*)::int n from ${t}`))[0].n)])));
const saldo = async (materialId) => Number((await testPrisma.$queryRawUnsafe(`select coalesce(sum(qty),0)::float8 s from stock_movements where material_id = '${materialId}'`))[0].s);
const komp = (o = {}) => ({ name: "Pegas bongkaran sisi kiri", qty: 12, uom: "PCS", condition: "Bagus, tidak berkarat", workPart: "Rangka pegas bawah", outcome: "REUSED", ...o });
const catatKomp = (w, body = komp(), key = kunci("k")) => w.a.post(`/api/production/units/${w.unit.id}/komponen-lama`, body, { "Idempotency-Key": key });

// ───────── A. bahan baru: aktual tanpa rencana, jalur stok resmi ─────────
test("A1. TANPA rencana → catat aktual langsung: berhasil (201), satu pergerakan ISSUE, tidak ada rencana bahan terbentuk, tidak ada validasi tersembunyi", async () => {
  const w = await dunia(); const m = await createTestMaterial({ code: "KAIN-A1", unit: "METER", itemGroup: "KAIN" }); await seedBalance(m.id, 20);
  assert.equal(await testPrisma.productionUnitMaterialPlan.count({ where: { unitId: w.unit.id } }), 0);
  const e0 = await hitung();
  const r = await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 2.5, note: "tanpa rencana" }, { "Idempotency-Key": kunci("a1") });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const e1 = await hitung();
  assert.equal(e1.sm, e0.sm + 1); assert.equal(e1.rencana, 0, "tidak membuat rencana bahan"); assert.equal(e1.mi, e0.mi); assert.equal(e1.rsv, e0.rsv);
  assert.equal(await saldo(m.id), 17.5);
  const ad = await w.a.get(`/api/production/units/${w.unit.id}/adopsi`);
  assert.equal(ad.status, 200); assert.equal(ad.body.pemakaianAktual.baris.length, 1); assert.equal(ad.body.pemakaianAktual.baris[0].pelaku !== undefined, true);
  assert.equal(ad.body.pemakaianAktual.baris[0].dokumen.jenis, "Catat langsung (Produksi)"); assert.ok(ad.body.pemakaianAktual.baris[0].dokumen.nomor.startsWith("MV-"));
});

test("A2. klik ganda / retry (Idempotency-Key sama) = SATU pergerakan; kunci sama dengan isian beda ditolak; retry paralel pun satu", async () => {
  const w = await dunia(); const m = await createTestMaterial({ code: "KAIN-A2", unit: "METER", itemGroup: "KAIN" }); await seedBalance(m.id, 20);
  const k = kunci("a2"); const body = { materialId: m.id, qty: 3 };
  const hasil = await Promise.all([1, 2, 3].map(() => w.a.post(`/api/units/${w.unit.id}/materials`, body, { "Idempotency-Key": k })));
  assert.ok(hasil.every((r) => [200, 201].includes(r.status)), hasil.map((r) => r.status).join());
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: w.unit.id, type: "ISSUE" } }), 1);
  assert.equal(await saldo(m.id), 17);
  const beda = await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 4 }, { "Idempotency-Key": k });
  assert.equal(beda.status, 409); assert.equal(await testPrisma.stockMovement.count({ where: { unitId: w.unit.id, type: "ISSUE" } }), 1);
});

test("A3. stok KURANG dan stok TIDAK DIKETAHUI: ditolak tanpa menulis apa pun; katalog menjelaskan keadaan (saldo kurang / belum diketahui)", async () => {
  const w = await dunia(); const kurang = await createTestMaterial({ code: "PEGAS-A3", unit: "METER", itemGroup: "PER BONNEL" }); await seedBalance(kurang.id, 1.5);
  const tak = await createTestMaterial({ code: "LEM-A3", unit: "CAN", itemGroup: "LEM" });
  const e0 = await hitung();
  const r1 = await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: kurang.id, qty: 5 }, { "Idempotency-Key": kunci("a3a") });
  const r2 = await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: tak.id, qty: 1 }, { "Idempotency-Key": kunci("a3b") });
  assert.ok(r1.status >= 400 && r1.status < 500, `kurang: ${r1.status}`); assert.ok(r2.status >= 400 && r2.status < 500, `tak diketahui: ${r2.status}`);
  assert.deepEqual(await hitung(), e0, "penolakan tidak menulis apa pun");
  const kat = await w.a.get("/api/production/material-catalog?limit=50");
  const bK = kat.body.rows.find((b) => b.materialId === kurang.id); const bT = kat.body.rows.find((b) => b.materialId === tak.id);
  assert.equal(bK.saldoDiketahui, true); assert.equal(bK.saldo, 1.5); assert.equal(bT.saldoDiketahui, false, "stok belum diketahui ≠ nol");
});

test("A4. rencana ADA tidak mengurangi stok dan tidak memblokir aktual; aktual tidak mengubah/menghapus rencana; 'isian awal' hanya di klien (server tidak otomatis memposting)", async () => {
  const w = await dunia(); const m = await createTestMaterial({ code: "KAIN-A4", unit: "METER", itemGroup: "KAIN" }); await seedBalance(m.id, 10);
  const e0 = await hitung();
  const put = await w.a.put(`/api/production/units/${w.unit.id}/material-plan`, { lines: [{ materialId: m.id, qty: 4 }], expectedRevision: 0 });
  assert.equal(put.status, 200, JSON.stringify(put.body)); const e1 = await hitung();
  assert.equal(e1.sm, e0.sm, "rencana tidak membuat pergerakan stok"); assert.equal(e1.rsv, e0.rsv); assert.equal(await saldo(m.id), 10);
  const r = await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 3 }, { "Idempotency-Key": kunci("a4") }); assert.equal(r.status, 201);
  const ad = await w.a.get(`/api/production/units/${w.unit.id}/adopsi`);
  assert.equal(ad.body.rencanaBahan.plan.lines.length, 1); assert.equal(ad.body.rencanaBahan.plan.revision, 1);
  const p = ad.body.perbandingan.find((x) => x.materialId === m.id); assert.equal(p.rencana, 4); assert.equal(p.aktual, 3);
  assert.equal(await saldo(m.id), 7);
});

test("A5. izin hanya-lihat (Sales): membaca ruang kerja/adopsi, tetapi tidak bisa mencatat aktual maupun komponen lama (403) dan tidak ada tulisan", async () => {
  const w = await dunia(); const m = await createTestMaterial({ code: "KAIN-A5", unit: "METER" }); await seedBalance(m.id, 5); const e0 = await hitung();
  assert.equal((await w.s.get(`/api/production/units/${w.unit.id}/adopsi`)).status, 200);
  assert.equal((await w.s.get(`/api/production/units/${w.unit.id}/adopsi`)).body.izin.pemakaianAktual, false);
  assert.equal((await w.s.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 1 }, { "Idempotency-Key": kunci("a5") })).status, 403);
  assert.equal((await w.s.post(`/api/production/units/${w.unit.id}/komponen-lama`, komp(), { "Idempotency-Key": kunci("a5k") })).status, 403);
  assert.equal((await w.s.get(`/api/production/units/${w.unit.id}/komponen-lama`)).status, 200, "Sales boleh membaca");
  assert.deepEqual(await hitung(), e0);
});

test("A6. koreksi berjejak bahan baru: qty negatif = RETURN baris BARU (asli tidak diubah/dihapus); koreksi melebihi pemakaian bersih ditolak 409; riwayat menampilkan keduanya", async () => {
  const w = await dunia(); const m = await createTestMaterial({ code: "KAIN-A6", unit: "METER", itemGroup: "KAIN" }); await seedBalance(m.id, 10);
  const pakai = await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 4 }, { "Idempotency-Key": kunci("a6a") }); assert.equal(pakai.status, 201);
  const lebih = await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: -5, note: "Koreksi salah ketik" }, { "Idempotency-Key": kunci("a6b") });
  assert.equal(lebih.status, 409); assert.equal(lebih.body.code, "UNIT_KOREKSI_MELEBIHI_PEMAKAIAN"); assert.equal(await saldo(m.id), 6);
  const ok = await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: -1.5, note: "Koreksi atas MV: salah ketik 4 harusnya 2,5" }, { "Idempotency-Key": kunci("a6c") });
  assert.equal(ok.status, 201); assert.equal(await saldo(m.id), 7.5);
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: w.unit.id } }), 2, "baris asli tetap + satu baris koreksi");
  const asli = await testPrisma.stockMovement.findUnique({ where: { id: pakai.body.id } }); assert.equal(Number(asli.qty), -4, "baris asli tidak diubah");
  const ad = await w.a.get(`/api/production/units/${w.unit.id}/adopsi`);
  assert.equal(ad.body.pemakaianAktual.baris.length, 2); assert.equal(ad.body.pemakaianAktual.total[0].dipakai, 2.5);
});

test("A7. ruang kerja memuat detail order untuk Ringkasan: kondisi sakit/tidak + keluhan, catatan produksi, komplain, janji pelanggan", async () => {
  const w = await dunia();
  await testPrisma.order.update({ where: { id: w.order.id }, data: { healthStatus: "SAKIT", complaintCategory: ["SAKIT_PINGGANG", "SARAF_KEJEPIT"], productionNote: "Kain jangan motif gelap", hasComplaint: true, complaintDate: new Date(), complaintDetail: "Kasur melengkung", customerPromiseDate: new Date("2030-01-15T00:00:00Z") } });
  const r = await w.a.get(`/api/production/units/${w.unit.id}/ruang-kerja`); assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body.order.detail;
  assert.equal(d.kondisiPelanggan.sakit, true); assert.deepEqual(d.kondisiPelanggan.keluhan, ["Sakit pinggang", "Saraf kejepit"]);
  assert.equal(d.catatanProduksi, "Kain jangan motif gelap"); assert.equal(d.komplain.rincian, "Kasur melengkung"); assert.equal(d.komplain.selesai, false); assert.equal(d.janjiPelanggan, "2030-01-15");
  const { unit: u2 } = await createTestUnit({ status: "RECEIVED" });
  const r2 = await w.a.get(`/api/production/units/${u2.id}/ruang-kerja`); assert.equal(r2.body.order.detail.kondisiPelanggan.sakit, null); assert.equal(r2.body.order.detail.komplain, null);
});

// ───────── B. komponen lama dari unit pelanggan ─────────
test("B1. catat komponen lama: 201, BUKAN stok — saldo, pergerakan, Material Issue, reservasi, jurnal, job, outbox, rencana tidak berubah; asal 'Dari kasur pelanggan — kode unit'", async () => {
  const w = await dunia(); const m = await createTestMaterial({ code: "PEGAS-B1", unit: "PCS" }); await seedBalance(m.id, 30);
  const e0 = await hitung(); const s0 = await saldo(m.id);
  const r = await catatKomp(w, komp({ materialId: m.id })); assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.item.version, 1); assert.equal(r.body.item.pemakaian, true);
  assert.deepEqual(await hitung(), e0, "tidak ada tulisan ke stok/jurnal/dokumen"); assert.equal(await saldo(m.id), s0);
  assert.equal(await testPrisma.finStockMovementValuation.count(), 0); assert.equal(await testPrisma.finPostingGap.count(), 0);
  const g = await w.a.get(`/api/production/units/${w.unit.id}/komponen-lama`);
  assert.equal(g.status, 200); assert.equal(g.body.items.length, 1); assert.equal(g.body.items[0].asal, `Dari kasur pelanggan — ${w.unit.unitCode}`); assert.equal(g.body.items[0].oleh, (await testPrisma.user.findUnique({ where: { id: w.admin.id } })).name);
  assert.equal(g.body.total.pemakaianKembali.jumlahItem, 1); assert.deepEqual(g.body.total.pemakaianKembali.perSatuan, [{ uom: "PCS", qty: 12 }]); assert.match(g.body.dampakStok, /Tidak ada/);
});

test("B2. klik ganda/retry = satu baris; kunci sama isian beda ditolak; wajib Idempotency-Key", async () => {
  const w = await dunia(); const k = kunci("b2");
  const hasil = await Promise.all([1, 2, 3].map(() => catatKomp(w, komp(), k)));
  assert.ok(hasil.every((r) => [200, 201].includes(r.status)), hasil.map((r) => r.status).join());
  assert.equal(await testPrisma.unitComponentReuseEntry.count({ where: { unitId: w.unit.id } }), 1);
  assert.equal((await catatKomp(w, komp({ qty: 99 }), k)).status, 409);
  assert.equal((await w.a.post(`/api/production/units/${w.unit.id}/komponen-lama`, komp())).status, 400);
});

test("B3. isian: nama wajib tetapi katalog TIDAK wajib; kondisi wajib; bagian pekerjaan wajib hanya bila dipakai kembali; satuan dari daftar; jumlah > 0; foto maks 3", async () => {
  const w = await dunia();
  assert.equal((await catatKomp(w, komp({ materialId: undefined }))).status, 201, "tanpa katalog: sah");
  assert.equal((await catatKomp(w, komp({ name: "" }))).status, 400); assert.equal((await catatKomp(w, komp({ condition: "" }))).status, 400);
  assert.equal((await catatKomp(w, komp({ workPart: "" }))).body.code, "KOMPONEN_BAGIAN_WAJIB");
  assert.equal((await catatKomp(w, komp({ workPart: "", outcome: "DISCARDED" }))).status, 201, "dilepas tanpa dipakai: bagian pekerjaan tidak wajib");
  assert.equal((await catatKomp(w, komp({ uom: "ZZZ" }))).body.code, "KOMPONEN_SATUAN_INVALID"); assert.equal((await catatKomp(w, komp({ qty: 0 }))).status, 400); assert.equal((await catatKomp(w, komp({ qty: -2 }))).status, 400);
  assert.equal((await catatKomp(w, komp({ photoUrls: ["/media/production-evidence/a.jpg", "/media/production-evidence/b.jpg", "/media/production-evidence/c.jpg", "/media/production-evidence/d.jpg"] }))).body.code, "KOMPONEN_FOTO_TERLALU_BANYAK");
  assert.equal((await catatKomp(w, komp({ photoUrls: ["https://evil.example/x.jpg"] }))).body.code, "KOMPONEN_FOTO_INVALID");
  assert.equal((await catatKomp(w, komp({ materialId: "00000000-0000-4000-8000-000000000000" }))).body.code, "KOMPONEN_BAHAN_TIDAK_ADA");
});

test("B4. hasil nyata: dikembalikan/disimpan/dibuang BUKAN pemakaian dan tidak masuk stok; total TERPISAH dari bahan baru", async () => {
  const w = await dunia(); const m = await createTestMaterial({ code: "KAIN-B4", unit: "METER", itemGroup: "KAIN" }); await seedBalance(m.id, 10);
  await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 2 }, { "Idempotency-Key": kunci("b4m") });
  const e0 = await hitung();
  await catatKomp(w, komp({ name: "Kain sarung lama", uom: "METER", qty: 1.5, outcome: "REUSED" }));
  await catatKomp(w, komp({ name: "Busa lama", qty: 1, uom: "SHEET", outcome: "RETURNED_TO_CUSTOMER", workPart: "" }));
  await catatKomp(w, komp({ name: "Per pocket lama", qty: 20, uom: "PCS", outcome: "KEPT_WITH_UNIT", workPart: "" }));
  await catatKomp(w, komp({ name: "Webbing rusak", qty: 3, uom: "METER", outcome: "DISCARDED", workPart: "" }));
  assert.deepEqual(await hitung(), e0, "komponen lama tidak menyentuh stok");
  const g = (await w.a.get(`/api/production/units/${w.unit.id}/komponen-lama`)).body;
  assert.equal(g.total.pemakaianKembali.jumlahItem, 1); assert.deepEqual(g.total.pemakaianKembali.perSatuan, [{ uom: "METER", qty: 1.5 }]);
  assert.deepEqual(g.total.dilepasTidakDipakai, { jumlahItem: 3, dikembalikan: 1, disimpan: 1, dibuang: 1 });
  assert.equal(g.items.filter((i) => i.pemakaian).length, 1);
  const ad = (await w.a.get(`/api/production/units/${w.unit.id}/adopsi`)).body;
  assert.equal(ad.pemakaianAktual.baris.length, 1, "pemakaian aktual bahan baru TIDAK memuat komponen lama"); assert.equal(ad.pemakaianAktual.total[0].dipakai, 2);
  assert.equal(ad.komponenLama.total.pemakaianKembali.jumlahItem, 1);
  assert.equal(await saldo(m.id), 8);
});

test("B5. koreksi berjejak: versi BARU, versi lama tetap; alasan wajib; expectedVersion basi 409; batal (salah input) tidak menghapus riwayat; sesudah batal tidak bisa dikoreksi", async () => {
  const w = await dunia(); const r = await catatKomp(w, komp({ qty: 5 })); const itemId = r.body.item.itemId;
  const url = `/api/production/units/${w.unit.id}/komponen-lama/${itemId}`;
  assert.equal((await w.a.post(`${url}/koreksi`, { expectedVersion: 1, data: komp({ qty: 4 }), reason: "" }, { "Idempotency-Key": kunci("b5a") })).body.code, "KOMPONEN_ALASAN_WAJIB");
  const k = await w.a.post(`${url}/koreksi`, { expectedVersion: 1, data: komp({ qty: 4 }), reason: "Salah hitung, seharusnya 4" }, { "Idempotency-Key": kunci("b5b") });
  assert.equal(k.status, 201, JSON.stringify(k.body)); assert.equal(k.body.item.version, 2); assert.equal(k.body.item.kind, "CORRECTED");
  assert.equal((await w.a.post(`${url}/koreksi`, { expectedVersion: 1, data: komp({ qty: 3 }), reason: "basi" }, { "Idempotency-Key": kunci("b5c") })).status, 409, "versi basi");
  assert.equal((await w.a.post(`${url}/koreksi`, { expectedVersion: 2, data: komp({ qty: 4 }), reason: "sama saja" }, { "Idempotency-Key": kunci("b5d") })).status, 422, "tanpa perubahan");
  const rows = await testPrisma.unitComponentReuseEntry.findMany({ where: { itemId }, orderBy: { version: "asc" } });
  assert.deepEqual(rows.map((x) => [x.version, x.kind, Number(x.qty)]), [[1, "CREATED", 5], [2, "CORRECTED", 4]]);
  const v = await w.a.post(`${url}/batal`, { expectedVersion: 2, reason: "Komponen ternyata tidak jadi dipakai" }, { "Idempotency-Key": kunci("b5e") });
  assert.equal(v.status, 201); assert.equal(v.body.item.kind, "VOIDED");
  assert.equal((await w.a.post(`${url}/koreksi`, { expectedVersion: 3, data: komp(), reason: "lagi" }, { "Idempotency-Key": kunci("b5f") })).body.code, "KOMPONEN_SUDAH_DIBATALKAN");
  const g = (await w.a.get(`/api/production/units/${w.unit.id}/komponen-lama`)).body;
  assert.equal(g.items.length, 0); assert.equal(g.dibatalkan.length, 1); assert.equal(g.total.pemakaianKembali.jumlahItem, 0); assert.equal(g.riwayat.length, 3, "riwayat lengkap: dicatat, dikoreksi, dibatalkan");
  assert.equal(await testPrisma.stockMovement.count(), 0);
});

test("B6. append-only di database: UPDATE/DELETE baris riwayat ditolak trigger; source selain unit ini ditolak CHECK; FK RESTRICT mencegah hapus unit berjejak", async () => {
  const w = await dunia(); const r = await catatKomp(w); const id = r.body.item.id;
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`update unit_component_reuse_entries set qty = 99 where id = '${id}'`), /append|tidak boleh|diubah|dihapus/i);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`delete from unit_component_reuse_entries where id = '${id}'`), /append|tidak boleh|diubah|dihapus/i);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`insert into unit_component_reuse_entries (id, item_id, unit_id, version, kind, source, name, qty, uom, outcome, actor_id) values (gen_random_uuid(), gen_random_uuid(), '${w.unit.id}', 1, 'CREATED', 'OTHER_UNIT', 'x lintas unit', 1, 'PCS', 'REUSED', 'u')`), /source_chk|check/i);
  await assert.rejects(() => testPrisma.unit.delete({ where: { id: w.unit.id } }), /Foreign key|constraint|violat|P2003/i);
});

test("B7. TANPA lintas unit: tidak ada parameter unit asal yang diterima; komponen hanya dicatat pada unit di URL; unit lain tidak berubah", async () => {
  const w = await dunia();
  const r = await catatKomp(w, { ...komp(), unitAsalId: w.unitLain.id, asalUnit: w.unitLain.unitCode, source: "OTHER_UNIT" }); assert.equal(r.status, 201);
  const row = await testPrisma.unitComponentReuseEntry.findFirst({ where: { itemId: r.body.item.itemId } }); assert.equal(row.unitId, w.unit.id); assert.equal(row.source, "OWN_UNIT");
  assert.equal(await testPrisma.unitComponentReuseEntry.count({ where: { unitId: w.unitLain.id } }), 0);
  const koreksiLintas = await w.a.post(`/api/production/units/${w.unitLain.id}/komponen-lama/${r.body.item.itemId}/batal`, { expectedVersion: 1, reason: "lintas unit" }, { "Idempotency-Key": kunci("b7") });
  assert.equal(koreksiLintas.status, 404, "komponen unit A tidak dapat diubah lewat unit B");
});

test("B8. unit dibatalkan/terkirim: komponen lama tidak dicatat lagi (409) — tetapi tetap terbaca; Ringkasan + Riwayat menampilkan label dan total TERPISAH dari bahan baru", async () => {
  const w = await dunia(); const m = await createTestMaterial({ code: "KAIN-B8", unit: "METER", itemGroup: "KAIN" }); await seedBalance(m.id, 10);
  await catatKomp(w, komp({ name: "Per lama" })); await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 1 }, { "Idempotency-Key": kunci("b8") });
  const ad = (await w.a.get(`/api/production/units/${w.unit.id}/adopsi`)).body;
  assert.ok(ad.riwayat.some((x) => x.kind === "KOMPONEN_LAMA" && /bukan stok/.test(x.label) && /Per lama/.test(x.label)), "Riwayat memuat komponen lama berlabel sendiri");
  assert.equal(ad.pemakaianAktual.baris.length, 1); assert.equal(ad.komponenLama.items.length, 1);
  await testPrisma.unit.update({ where: { id: w.unit.id }, data: { status: "CANCELLED" } });
  assert.equal((await catatKomp(w)).body.code, "UNIT_TIDAK_AKTIF"); assert.equal((await w.a.get(`/api/production/units/${w.unit.id}/komponen-lama`)).body.items.length, 1);
});

test("B9. ekspor Excel membedakan sumber dan dampak stok: Pemakaian Aktual (Bahan baru dari Gudang · Mengurangi stok) dan sheet Komponen Lama (Dampak: tidak ada)", async () => {
  const w = await dunia(); const m = await createTestMaterial({ code: "KAIN-B9", unit: "METER", itemGroup: "KAIN" }); await seedBalance(m.id, 10);
  await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 2 }, { "Idempotency-Key": kunci("b9") });
  await catatKomp(w, komp({ name: "Kain sarung lama", uom: "METER", qty: 1.5 })); await catatKomp(w, komp({ name: "Busa lama", uom: "SHEET", qty: 1, outcome: "DISCARDED", workPart: "" }));
  const e0 = await hitung();
  const res = await fetch(`${server.baseUrl}/api/production/work-orders/export.xlsx`, { headers: { Authorization: `Bearer ${w.admin.token}` } });
  assert.equal(res.status, 200); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const head = (ws) => ws.getRow(1).values.slice(1); const baris = (ws) => ws.getRows(2, ws.rowCount - 1).map((r) => Object.fromEntries(head(ws).map((h, i) => [h, r.values[i + 1]])));
  const akt = wb.getWorksheet("Pemakaian Aktual"); assert.ok(head(akt).includes("Sumber") && head(akt).includes("Dampak Stok"));
  const a = baris(akt).filter((r) => r["Kode Unit"] === w.unit.unitCode); assert.equal(a.length, 1); assert.equal(a[0].Sumber, "Bahan baru dari Gudang"); assert.equal(a[0]["Dampak Stok"], "Mengurangi stok");
  const kl = wb.getWorksheet("Komponen Lama"); assert.ok(kl, "sheet Komponen Lama ada");
  const k = baris(kl).filter((r) => r["Kode Unit"] === w.unit.unitCode); assert.equal(k.length, 2);
  const pakai = k.find((r) => r["Nama Komponen"] === "Kain sarung lama"); const buang = k.find((r) => r["Nama Komponen"] === "Busa lama");
  assert.equal(pakai.Sumber, "Komponen lama dari unit ini"); assert.match(pakai["Dampak Stok"], /Tidak ada/); assert.equal(pakai["Pemakaian?"], "Pemakaian kembali"); assert.equal(pakai.Asal, `Dari kasur pelanggan — ${w.unit.unitCode}`);
  assert.equal(buang["Pemakaian?"], "Bukan pemakaian"); assert.equal(buang.Hasil, "Dibuang");
  const info = baris(wb.getWorksheet("Info Ekspor")); assert.ok(info.some((r) => r.Keterangan === "Dua sumber pemakaian"));
  assert.deepEqual(await hitung(), e0, "ekspor baca-saja");
});
