// PEMBETULAN BAHAN PER ORDER pada unit selesai/terkirim (Okt 2026): akses lewat layanan resmi yang sudah ada, alasan wajib, riwayat berjejak, dampak (stok / jurnal Finance / HPP operasional) terlihat sebelum konfirmasi.
// Yang dikunci: unit selesai TANPA alasan ditolak; dengan alasan tercatat (catatan pergerakan + log aktivitas); unit aktif tidak berubah perilakunya; pratinjau baca-saja dan jujur (stok belum diketahui, melebihi pemakaian);
// pengurangan = pengembalian BARU (baris lama utuh); pemakaian sementara pada unit terkirim hanya dengan alasan (dibatalkan tetap ditolak); koreksi jumlah berpersetujuan tetap penyetuju != pemohon; klik ganda satu baris.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let seq = 0; const kunci = (p = "pb") => `${p}-${Date.now()}-${++seq}-uji-kunci`;
async function dunia({ status = "DELIVERED", saldo = 100 } = {}) {
  const admin = await createTestUser({ roles: ["ADMIN"] }); const fin = await createTestUser({ roles: ["FINANCE"] }); const sales = await createTestUser({ roles: ["SALES"] });
  const mat = await createTestMaterial({ code: `BHN-${++seq}`, name: "BUSA UJI", unit: "KG" });
  if (saldo) await seedBalance(mat.id, saldo, { unitCost: 20000 });
  const { unit, order } = await createTestUnit({ status });
  const c = (u) => makeClient(server.baseUrl, u.token);
  return { admin, fin, sales, a: c(admin), f: c(fin), s: c(sales), mat, unit, order };
}
const snap = async () => ({
  mov: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), val: await testPrisma.finStockMovementValuation.count(),
  op: await testPrisma.stockMovementBiayaOperasional.count(), harga: await testPrisma.materialHargaBerlaku.count(), sem: await testPrisma.unitProvisionalUsage.count(),
});
const saldo = async (id) => Number((await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${id}::uuid`)[0].s);
const pasang = (w, body, k = kunci()) => w.a.post(`/api/units/${w.unit.id}/materials`, body, { "Idempotency-Key": k });

test("P1. unit TERKIRIM: tanpa alasan ditolak (tidak ada yang tersimpan); dengan alasan tercatat di catatan pergerakan + log aktivitas; stok dan HPP order berubah lewat jalur resmi", async () => {
  const w = await dunia(); const s0 = await snap();
  const tanpa = await pasang(w, { materialId: w.mat.id, qty: 3 }); assert.equal(tanpa.status, 400); assert.equal(tanpa.body.code, "UNIT_ALASAN_PEMBETULAN_WAJIB"); assert.deepEqual(await snap(), s0, "ditolak = tidak ada tulisan");
  const pendek = await pasang(w, { materialId: w.mat.id, qty: 3, alasanPembetulan: "x" }); assert.equal(pendek.status, 400);
  const ok = await pasang(w, { materialId: w.mat.id, qty: 3, alasanPembetulan: "Bahan terlewat dicatat saat produksi" }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const mv = await testPrisma.stockMovement.findUnique({ where: { id: ok.body.id } });
  assert.equal(mv.type, "ISSUE"); assert.equal(Number(mv.qty), -3); assert.equal(mv.unitId, w.unit.id); assert.match(mv.note, /^Pembetulan unit terkirim \(.+\): Bahan terlewat dicatat saat produksi/);
  assert.equal(await saldo(w.mat.id), 97);
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: w.unit.id, eventType: "PRODUCTION_PEMBETULAN_BAHAN_UNIT_SELESAI" } }); assert.ok(ev, "log aktivitas unit"); assert.equal(ev.metadata.alasan, "Bahan terlewat dicatat saat produksi"); assert.equal(ev.actorId, w.admin.user.id);
  assert.equal(await testPrisma.stockMovementBiayaOperasional.count({ where: { movementId: mv.id } }), 1, "HPP operasional ikut dibekukan (tanpa harga berlaku → TANPA_HARGA, bukan Rp0)");
});

test("P2. klik ganda: Idempotency-Key sama = SATU pergerakan; unit AKTIF tidak berubah perilakunya (tanpa alasan tetap boleh, catatan apa adanya)", async () => {
  const w = await dunia(); const k = kunci();
  const body = { materialId: w.mat.id, qty: 2, alasanPembetulan: "Salah catat jumlah awal" };
  const [r1, r2] = await Promise.all([pasang(w, body, k), pasang(w, body, k)]);
  assert.ok([r1.status, r2.status].every((x) => [200, 201, 409].includes(x)), `${r1.status}/${r2.status}`);
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: w.unit.id } }), 1, "satu pergerakan"); assert.equal(await saldo(w.mat.id), 98);
  const aktif = await dunia({ status: "IN_PRODUCTION" }).catch(() => dunia({ status: "PENDING" }));
  const ok = await pasang(aktif, { materialId: aktif.mat.id, qty: 1, note: "pemakaian biasa" }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await testPrisma.stockMovement.findUnique({ where: { id: ok.body.id } })).note, "pemakaian biasa", "unit aktif: catatan TIDAK diberi awalan pembetulan");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: aktif.unit.id, eventType: "PRODUCTION_PEMBETULAN_BAHAN_UNIT_SELESAI" } }), 0);
});

test("P3. pratinjau dampak: baca-saja; stok sebelum/sesudah, nilai & jurnal Finance, HPP operasional (tanpa harga = tidak dibekukan, bukan Rp0; ada harga = dihitung)", async () => {
  const w = await dunia(); const s0 = await snap();
  const url = `/api/production/units/${w.unit.id}/pembetulan-bahan/pratinjau`;
  const p = await w.a.post(url, { materialId: w.mat.id, jenis: "TAMBAH", qty: 3 }); assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.unit.selesai, true); assert.equal(p.body.alasanWajib, true); assert.equal(p.body.stok.saldoSebelum, 100); assert.equal(p.body.stok.saldoSesudah, 97); assert.equal(p.body.pemakaianBersih.sebelum, 0); assert.equal(p.body.pemakaianBersih.sesudah, 3);
  assert.equal(p.body.finance.hasil, "GAP_PERSEDIAAN_AWAL", "default: cutover 2026-10-01 dan persediaan awal belum diposting (sama dengan production)"); assert.match(p.body.finance.teks, /TIDAK ada jurnal/);
  assert.equal(p.body.hppOperasional.dibekukan, false); assert.match(p.body.hppOperasional.teks, /Belum ada Harga Berlaku/); assert.equal(p.body.boleh, true);
  assert.deepEqual(await snap(), s0, "pratinjau tidak menulis apa pun");
  const t = new Date(Date.now() - 3600_000); await testPrisma.materialHargaBerlaku.create({ data: { materialId: w.mat.id, jenis: "HARGA", unitPrice: "25000", satuan: "KG", effectiveFrom: t, createdAt: t, reason: "harga uji", idempotencyKey: kunci("hb") } });
  const p2 = await w.a.post(url, { materialId: w.mat.id, jenis: "TAMBAH", qty: 3 }); assert.equal(p2.body.hppOperasional.dibekukan, true); assert.equal(p2.body.hppOperasional.harga, 25000); assert.equal(p2.body.hppOperasional.nilai, 75000); assert.match(p2.body.hppOperasional.teks, /harga berlaku SAAT INI/);
  assert.ok(p2.body.dampak.some((x) => /TIDAK diubah atau dihapus/.test(x)));
});

test("P4. pratinjau jujur: stok belum diketahui, saldo kurang, melebihi pemakaian bersih, jumlah tidak valid, tanpa izin", async () => {
  const w = await dunia({ saldo: 5 }); const url = `/api/production/units/${w.unit.id}/pembetulan-bahan/pratinjau`;
  const kosong = await createTestMaterial({ code: `KSG-${++seq}`, name: "TANPA CATATAN", unit: "KG" });
  const a = await w.a.post(url, { materialId: kosong.id, jenis: "TAMBAH", qty: 1 }); assert.equal(a.body.boleh, false); assert.equal(a.body.penghalang[0].kode, "STOK_BELUM_DIKETAHUI"); assert.equal(a.body.stok.belumAdaCatatan, true); assert.equal(a.body.stok.saldoSebelum, null, "belum diketahui ≠ 0");
  const b = await w.a.post(url, { materialId: w.mat.id, jenis: "TAMBAH", qty: 9 }); assert.equal(b.body.boleh, false); assert.equal(b.body.penghalang[0].kode, "SALDO_KURANG");
  const c = await w.a.post(url, { materialId: w.mat.id, jenis: "KURANGI", qty: 1 }); assert.equal(c.body.boleh, false); assert.equal(c.body.penghalang[0].kode, "UNIT_KOREKSI_MELEBIHI_PEMAKAIAN");
  assert.equal((await w.a.post(url, { materialId: w.mat.id, jenis: "TAMBAH", qty: 0 })).status, 400); assert.equal((await w.a.post(url, { materialId: w.mat.id, jenis: "LAIN", qty: 1 })).status, 400); assert.equal((await w.a.post(url, { materialId: w.mat.id, jenis: "TAMBAH", qty: 1.00001 })).status, 400);
  assert.equal((await w.s.post(url, { materialId: w.mat.id, jenis: "TAMBAH", qty: 1 })).status, 403, "SALES tanpa izin");
  assert.equal((await pasang({ ...w, a: w.s }, { materialId: w.mat.id, qty: 1, alasanPembetulan: "coba tanpa izin" })).status, 403);
});

test("P5. pengurangan = pengembalian BARU bertaut unit (baris asli utuh); melebihi pemakaian bersih ditolak; alasan wajib juga untuk pengembalian", async () => {
  const w = await dunia();
  const i = await pasang(w, { materialId: w.mat.id, qty: 5, alasanPembetulan: "Pemakaian terlewat dicatat" }); assert.equal(i.status, 201);
  assert.equal((await pasang(w, { materialId: w.mat.id, qty: -2 })).status, 400, "pengembalian pada unit selesai tanpa alasan ditolak");
  const r = await pasang(w, { materialId: w.mat.id, qty: -2, alasanPembetulan: "Kelebihan catat 2 kg" }); assert.equal(r.status, 201, JSON.stringify(r.body));
  const rows = await testPrisma.stockMovement.findMany({ where: { unitId: w.unit.id }, orderBy: { createdAt: "asc" } });
  assert.equal(rows.length, 2); assert.equal(rows[0].type, "ISSUE"); assert.equal(Number(rows[0].qty), -5, "baris asli TIDAK berubah"); assert.equal(rows[1].type, "RETURN"); assert.equal(Number(rows[1].qty), 2); assert.match(rows[1].note, /Kelebihan catat 2 kg/);
  assert.equal(await saldo(w.mat.id), 97);
  const lebih = await pasang(w, { materialId: w.mat.id, qty: -4, alasanPembetulan: "terlalu banyak" }); assert.equal(lebih.status, 409); assert.equal(lebih.body.code, "UNIT_KOREKSI_MELEBIHI_PEMAKAIAN"); assert.equal(await saldo(w.mat.id), 97);
});

test("P6. pemakaian SEMENTARA (stok belum diketahui) pada unit TERKIRIM hanya dengan alasan; unit DIBATALKAN tetap ditolak; tanpa efek stok/jurnal/HPP", async () => {
  const w = await dunia(); const baru = await createTestMaterial({ code: `SEM-${++seq}`, name: "BAHAN TANPA STOK", unit: "KG" });
  const body = { materialId: baru.id, qty: 2, uom: "KG", originNote: "sisa meja produksi", alasanPencatatan: "Stok bahan belum tercatat di Gudang" };
  const url = `/api/production/units/${w.unit.id}/provisional-usages`; const s0 = await snap();
  const tanpa = await w.a.post(url, body, { "Idempotency-Key": kunci("sem") }); assert.equal(tanpa.status, 409); assert.equal(tanpa.body.code, "UNIT_TIDAK_AKTIF"); assert.match(tanpa.body.error, /pembetulan dengan alasan/);
  const ok = await w.a.post(url, { ...body, alasanPembetulan: "Terlewat dicatat saat unit dikerjakan" }, { "Idempotency-Key": kunci("sem") }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.match(ok.body.item.note, /^Pembetulan unit terkirim \(.+\): Terlewat dicatat saat unit dikerjakan/);
  const s1 = await snap(); assert.equal(s1.sem, s0.sem + 1); assert.equal(s1.mov, s0.mov, "tanpa pergerakan stok"); assert.equal(s1.jurnal, s0.jurnal); assert.equal(s1.op, s0.op);
  const batal = await dunia({ status: "CANCELLED" }); const b2 = await batal.a.post(`/api/production/units/${batal.unit.id}/provisional-usages`, { ...body, materialId: (await createTestMaterial({ code: `SEM-${++seq}`, name: "X", unit: "KG" })).id, alasanPembetulan: "unit sudah dibatalkan" }, { "Idempotency-Key": kunci("sem") });
  assert.equal(b2.status, 409, "unit DIBATALKAN tetap tidak menerima pemakaian sementara");
});

test("P7. koreksi jumlah berpersetujuan (layanan resmi) bekerja pada unit terkirim: pemohon tidak bisa menyetujui sendiri; penyetuju lain menghasilkan pengembalian bertaut pemakaian asal; riwayat tersimpan", async () => {
  const w = await dunia(); const i = await pasang(w, { materialId: w.mat.id, qty: 5, alasanPembetulan: "Pemakaian awal dicatat" }); assert.equal(i.status, 201);
  const pra = await w.a.post(`/api/production/units/${w.unit.id}/koreksi-pemakaian/pratinjau`, { materialId: w.mat.id, qtyBaru: 3 }); assert.equal(pra.status, 200); assert.equal(pra.body.bersihSebelum, 5); assert.equal(pra.body.bersihSesudah, 3); assert.equal(pra.body.saldoSebelum, 95); assert.equal(pra.body.saldoSesudah, 97); assert.equal(pra.body.boleh, true);
  const aj = await w.a.post(`/api/production/units/${w.unit.id}/koreksi-pemakaian`, { materialId: w.mat.id, qtyBaru: 3, alasan: "Pemakaian sebenarnya 3 kg" }, { "Idempotency-Key": kunci("kor") }); assert.equal(aj.status, 201, JSON.stringify(aj.body));
  assert.equal(await saldo(w.mat.id), 95, "diajukan = stok belum berubah");
  const sendiri = await w.a.post(`/api/production/koreksi-pemakaian/${aj.body.id}/setujui`, {}); assert.equal(sendiri.status, 403);
  const setuju = await w.f.post(`/api/production/koreksi-pemakaian/${aj.body.id}/setujui`, {}); assert.equal(setuju.status, 200, JSON.stringify(setuju.body));
  assert.equal(await saldo(w.mat.id), 97);
  const rows = await testPrisma.stockMovement.findMany({ where: { unitId: w.unit.id }, orderBy: { createdAt: "asc" } }); assert.equal(rows.length, 2); assert.equal(rows[1].type, "RETURN"); assert.equal(rows[1].correctsMovementId, rows[0].id); assert.equal(Number(rows[0].qty), -5, "baris asal utuh");
  const kor = await testPrisma.warehouseCorrection.findFirst({ where: { docId: w.unit.id } }); assert.equal(kor.status, "POSTED"); assert.equal(kor.reason, "Pemakaian sebenarnya 3 kg"); assert.equal(kor.requestedById, w.admin.user.id); assert.equal(kor.decidedById, w.fin.user.id);
});

test("P8. prediksi Finance di pratinjau = kenyataan saat dikonfirmasi: (a) persediaan awal belum diposting -> catatan celah tanpa jurnal; (b) tanpa cutover -> jurnal HPP sebesar yang dinyatakan; stok identik dengan pratinjau", async () => {
  const w = await dunia(); const url = `/api/production/units/${w.unit.id}/pembetulan-bahan/pratinjau`;
  const pa = await w.a.post(url, { materialId: w.mat.id, jenis: "TAMBAH", qty: 2 }); assert.equal(pa.body.finance.hasil, "GAP_PERSEDIAAN_AWAL");
  const j0 = await testPrisma.finJournalEntry.count();
  const a = await pasang(w, { materialId: w.mat.id, qty: 2, alasanPembetulan: "Terlewat dicatat (uji a)" }); assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(await testPrisma.finJournalEntry.count(), j0, "(a) tidak ada jurnal"); const gap = await testPrisma.finPostingGap.findFirst({ where: { sourceId: a.body.id } }); assert.equal(gap?.reason, "PERSEDIAAN_AWAL_BELUM_DIPOSTING");
  assert.equal(await saldo(w.mat.id), pa.body.stok.saldoSesudah, "stok nyata = stok pratinjau");
  await testPrisma.finSetting.upsert({ where: { key: "inventory_perpetual_cutover_date" }, create: { key: "inventory_perpetual_cutover_date", value: "2099-01-01" }, update: { value: "2099-01-01" } });
  const pb = await w.a.post(url, { materialId: w.mat.id, jenis: "TAMBAH", qty: 2 }); assert.equal(pb.body.finance.hasil, "JURNAL"); assert.equal(pb.body.finance.nilai, 40000); assert.match(pb.body.finance.teks, /Jurnal HPP bertanggal HARI INI/);
  const b = await pasang(w, { materialId: w.mat.id, qty: 2, alasanPembetulan: "Terlewat dicatat (uji b)" }); assert.equal(b.status, 201, JSON.stringify(b.body));
  const jb = await testPrisma.finJournalEntry.findFirst({ where: { sourceId: b.body.id } });
  if (jb) { const baris = await testPrisma.finJournalLine.findMany({ where: { entryId: jb.id } }); assert.equal(baris.reduce((x, l) => x + Number(l.debit ?? 0), 0), 40000, "jurnal HPP sebesar nilai pratinjau"); }
  else { const gap2 = await testPrisma.finPostingGap.findFirst({ where: { sourceId: b.body.id } }); assert.ok(gap2, "bila akun belum siap: celah tercatat (perintah Gudang tetap jalan), bukan hilang diam-diam"); }
});
