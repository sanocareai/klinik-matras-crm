// PEMBETULAN BAHAN PER ORDER pada unit TERKIRIM (Okt 2026): akses lewat layanan resmi yang sudah ada, alasan wajib, TANGGAL PEMAKAIAN DILAPORKAN terpisah dari waktu pencatatan, riwayat berjejak,
// dampak (stok / jurnal Finance / HPP operasional) terlihat sebelum konfirmasi, dan penjagaan pencatatan GANDA (kandidat ditampilkan, tidak pernah ditautkan otomatis; saldo bergeser ditolak).
// Unit DIBATALKAN tidak diperluas. Komponen lama dan pemakaian sementara = catatan saja (tanpa stok).
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
const HARI = 86400_000;
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const tgl = (hariLalu = 0) => wib(Date.now() - hariLalu * HARI);
async function dunia({ status = "DELIVERED", saldo = 100 } = {}) {
  const admin = await createTestUser({ roles: ["ADMIN"] }); const fin = await createTestUser({ roles: ["FINANCE"] }); const sales = await createTestUser({ roles: ["SALES"] });
  const mat = await createTestMaterial({ code: `BHN-${++seq}`, name: "BUSA UJI", unit: "KG" });
  if (saldo) await seedBalance(mat.id, saldo, { unitCost: 20000 });
  const { unit, order } = await createTestUnit({ status, createdAt: new Date(Date.now() - 20 * HARI) });
  const c = (u) => makeClient(server.baseUrl, u.token);
  return { admin, fin, sales, a: c(admin), f: c(fin), s: c(sales), mat, unit, order };
}
const snap = async () => ({
  mov: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), val: await testPrisma.finStockMovementValuation.count(),
  op: await testPrisma.stockMovementBiayaOperasional.count(), harga: await testPrisma.materialHargaBerlaku.count(), sem: await testPrisma.unitProvisionalUsage.count(), komp: await testPrisma.unitComponentReuseEntry.count(),
});
const saldo = async (id) => Number((await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${id}::uuid`)[0].s);
const PRA = (w) => `/api/production/units/${w.unit.id}/pembetulan-bahan/pratinjau`;
// Pembetulan unit terkirim wajib membawa dasar harga dari pratinjau (hppSidik). Pembantu ini mengambilnya dari pratinjau sungguhan; kirim hppSidik eksplisit (termasuk null) untuk menguji penolakan.
const pasang = async (w, body, k = kunci()) => {
  let b = body;
  if (b.hppSidik === undefined && b.saldoDilihat !== undefined && b.tanggalPemakaian && b.materialId && b.qty) {
    const p = await w.a.post(PRA(w), { materialId: b.materialId, jenis: b.qty > 0 ? "TAMBAH" : "KURANGI", qty: Math.abs(b.qty), tanggalPemakaian: b.tanggalPemakaian });
    if (p.status === 200) b = { ...b, hppSidik: p.body.hppOperasional?.sidik };
  }
  return w.a.post(`/api/units/${w.unit.id}/materials`, b, { "Idempotency-Key": k });
};
// isian lengkap untuk pembetulan langsung (alasan, tanggal dilaporkan, saldo yang dilihat di pratinjau)
const lengkap = async (w, extra = {}) => ({ materialId: w.mat.id, alasanPembetulan: "Bahan terlewat dicatat saat produksi", tanggalPemakaian: tgl(3), saldoDilihat: await saldo(w.mat.id), ...extra });

test("P1. unit TERKIRIM: alasan, tanggal pemakaian dilaporkan, dan saldo yang dilihat WAJIB (tanpa itu tidak ada yang tersimpan); lengkap = tercatat dengan tanggal dilaporkan TERPISAH dari waktu pencatatan + log aktivitas", async () => {
  const w = await dunia(); const s0 = await snap(); const L = await lengkap(w);
  const tanpaAlasan = await pasang(w, { ...L, qty: 3, alasanPembetulan: undefined }); assert.equal(tanpaAlasan.status, 400); assert.equal(tanpaAlasan.body.code, "UNIT_ALASAN_PEMBETULAN_WAJIB");
  const tanpaTgl = await pasang(w, { ...L, qty: 3, tanggalPemakaian: undefined }); assert.equal(tanpaTgl.status, 400); assert.equal(tanpaTgl.body.code, "UNIT_TANGGAL_PEMAKAIAN_WAJIB");
  const tanpaPra = await pasang(w, { ...L, qty: 3, saldoDilihat: undefined }); assert.equal(tanpaPra.status, 400); assert.equal(tanpaPra.body.code, "UNIT_PRATINJAU_WAJIB");
  assert.deepEqual(await snap(), s0, "ditolak = tidak ada tulisan");
  const ok = await pasang(w, { ...L, qty: 3 }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const mv = await testPrisma.stockMovement.findUnique({ where: { id: ok.body.id } });
  assert.equal(mv.type, "ISSUE"); assert.equal(Number(mv.qty), -3); assert.equal(mv.unitId, w.unit.id);
  assert.ok(mv.note.startsWith(`Pembetulan unit terkirim (${w.unit.unitCode}) [dilaporkan ${tgl(3)}]: Bahan terlewat dicatat saat produksi`), mv.note);
  assert.equal(wib(mv.createdAt), tgl(0), "waktu pencatatan = hari ini, BUKAN tanggal dilaporkan"); assert.notEqual(wib(mv.createdAt), tgl(3));
  assert.equal(await saldo(w.mat.id), 97);
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: w.unit.id, eventType: "PRODUCTION_PEMBETULAN_BAHAN_UNIT_SELESAI" } }); assert.ok(ev); assert.equal(ev.metadata.tanggalPemakaianDilaporkan, tgl(3)); assert.equal(ev.metadata.terlambatHari, 3); assert.ok(ev.metadata.dicatatPada); assert.equal(ev.actorId, w.admin.user.id);
  assert.equal(await testPrisma.stockMovementBiayaOperasional.count({ where: { movementId: mv.id } }), 1);
  const op1 = await testPrisma.stockMovementBiayaOperasional.findFirst({ where: { movementId: mv.id } }); assert.equal(op1.status, "TANPA_HARGA", "belum ada Harga Berlaku sama sekali = tanpa harga, bukan Rp0"); assert.equal(op1.basisDetail.dasarTanggal, tgl(3));
  // tampil di data order: tanggal dilaporkan terpisah dari tanggal pencatatan
  const ad = await w.a.get(`/api/production/units/${w.unit.id}/adopsi`); assert.equal(ad.status, 200, JSON.stringify(ad.body).slice(0, 200));
  const baris = ad.body.pemakaianAktual.baris[0]; assert.equal(baris.dilaporkan, tgl(3)); assert.equal(wib(baris.tanggal), tgl(0));
});

test("P2. validasi tanggal dilaporkan: format salah, masa depan, sebelum unit dibuat ditolak; unit AKTIF tidak berubah perilakunya; klik ganda (kunci sama) = SATU pergerakan", async () => {
  const w = await dunia(); const L = await lengkap(w);
  for (const [tglBurok, kode] of [["20-10-2026", "UNIT_TANGGAL_PEMAKAIAN_TIDAK_VALID"], ["2026-02-30", "UNIT_TANGGAL_PEMAKAIAN_TIDAK_VALID"], [wib(Date.now() + 3 * HARI), "UNIT_TANGGAL_PEMAKAIAN_MASA_DEPAN"], [tgl(40), "UNIT_TANGGAL_PEMAKAIAN_SEBELUM_UNIT"]]) {
    const r = await pasang(w, { ...L, qty: 1, tanggalPemakaian: tglBurok }); assert.equal(r.status, 400, tglBurok); assert.equal(r.body.code, kode, tglBurok);
  }
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: w.unit.id } }), 0);
  const k = kunci(); const body = { ...L, qty: 2 };
  const [r1, r2] = await Promise.all([pasang(w, body, k), pasang(w, body, k)]);
  assert.ok([r1.status, r2.status].every((x) => [200, 201, 409].includes(x)), `${r1.status}/${r2.status}`);
  assert.equal(await testPrisma.stockMovement.count({ where: { unitId: w.unit.id } }), 1, "satu pergerakan"); assert.equal(await saldo(w.mat.id), 98);
  const aktif = await dunia({ status: "IN_PRODUCTION" });
  const ok = await pasang(aktif, { materialId: aktif.mat.id, qty: 1, note: "pemakaian biasa" }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await testPrisma.stockMovement.findUnique({ where: { id: ok.body.id } })).note, "pemakaian biasa", "unit aktif: perilaku lama, tanpa awalan/alasan/tanggal");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: aktif.unit.id, eventType: "PRODUCTION_PEMBETULAN_BAHAN_UNIT_SELESAI" } }), 0);
});

test("P3. pratinjau: tindakan jelas (PENGELUARAN STOK BARU vs catatan saja), waktu terpisah, baca-saja; stok/Finance/HPP operasional (tanpa harga = tidak dibekukan, bukan Rp0)", async () => {
  const w = await dunia(); const s0 = await snap();
  const p = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 3, tanggalPemakaian: tgl(3) }); assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.tindakan.jenis, "PENGELUARAN_STOK_BARU"); assert.equal(p.body.tindakan.menulisStok, true); assert.match(p.body.tindakan.judul, /PENGELUARAN STOK BARU/); assert.match(p.body.tindakan.teks, /Bukan sekadar catatan/);
  assert.equal(p.body.waktu.pemakaianDilaporkan, tgl(3)); assert.equal(p.body.waktu.terlambatHari, 3); assert.equal(p.body.waktu.dasarHargaOperasional, "TANGGAL_PEMAKAIAN_DILAPORKAN"); assert.equal(p.body.waktu.dasarJurnalFinance, "WAKTU_PENCATATAN"); assert.match(p.body.waktu.teks, /BUKAN waktu pekerjaan/);
  assert.equal(p.body.stok.saldoSebelum, 100); assert.equal(p.body.stok.saldoDilihat, 100); assert.equal(p.body.stok.saldoSesudah, 97); assert.equal(p.body.pemakaianBersih.sesudah, 3);
  assert.equal(p.body.finance.hasil, "GAP_PERSEDIAAN_AWAL", "default: cutover 2026-10-01 dan persediaan awal belum diposting (sama dengan production)"); assert.match(p.body.finance.teks, /TIDAK ada jurnal/);
  assert.equal(p.body.hppOperasional.dibekukan, false); assert.equal(p.body.hppOperasional.status, "TANPA_HARGA"); assert.match(p.body.hppOperasional.teks, /TANPA_HARGA \/ belum diketahui/); assert.equal(p.body.hppOperasional.tanggalDasar, tgl(3)); assert.equal(p.body.boleh, true);
  assert.deepEqual(await snap(), s0, "pratinjau tidak menulis apa pun");
  const t = new Date(Date.now() - 10 * HARI); await testPrisma.materialHargaBerlaku.create({ data: { materialId: w.mat.id, jenis: "HARGA", unitPrice: "25000", satuan: "KG", effectiveFrom: t, createdAt: t, reason: "harga uji", idempotencyKey: kunci("hb") } });
  const p2 = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 3, tanggalPemakaian: tgl(3) }); assert.equal(p2.body.hppOperasional.nilai, 75000); assert.match(p2.body.hppOperasional.teks, /tanggal pemakaian yang dilaporkan/); assert.equal(p2.body.hppOperasional.harga, 25000); assert.equal(p2.body.hppOperasional.tanggalDasar, tgl(3));
  const k = await w.a.post(PRA(w), { jenis: "KOMPONEN_LAMA", tanggalPemakaian: tgl(1) }); assert.equal(k.status, 200); assert.equal(k.body.tindakan.jenis, "CATATAN_SAJA"); assert.equal(k.body.tindakan.menulisStok, false); assert.equal(k.body.stok, null); assert.match(k.body.dampak[1], /Stok Gudang tidak berubah/);
  const sm = await w.a.post(PRA(w), { jenis: "CATATAN_SEMENTARA", tanggalPemakaian: tgl(1) }); assert.equal(sm.body.tindakan.jenis, "CATATAN_SAJA"); assert.match(sm.body.tindakan.teks, /Perlu rekonsiliasi Gudang/);
  assert.equal((await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 3 })).body.code, "UNIT_TANGGAL_PEMAKAIAN_WAJIB", "pratinjau juga wajib tanggal dilaporkan");
});

test("P4. HANYA unit terkirim: unit DIBATALKAN dan unit aktif ditolak pratinjau; pratinjau jujur (stok belum diketahui, saldo kurang, melebihi pemakaian, jumlah tidak valid, tanpa izin)", async () => {
  const bt = await dunia({ status: "CANCELLED" }); const r1 = await bt.a.post(PRA(bt), { materialId: bt.mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: tgl(1) }); assert.equal(r1.status, 409); assert.equal(r1.body.code, "UNIT_DIBATALKAN");
  const ak = await dunia({ status: "IN_PRODUCTION" }); const r2 = await ak.a.post(PRA(ak), { materialId: ak.mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: tgl(1) }); assert.equal(r2.status, 409); assert.equal(r2.body.code, "UNIT_BELUM_TERKIRIM");
  const w = await dunia({ saldo: 5 }); const kosong = await createTestMaterial({ code: `KSG-${++seq}`, name: "TANPA CATATAN", unit: "KG" });
  const T = tgl(2);
  const a = await w.a.post(PRA(w), { materialId: kosong.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: T }); assert.equal(a.body.boleh, false); assert.equal(a.body.penghalang[0].kode, "STOK_BELUM_DIKETAHUI"); assert.equal(a.body.stok.saldoSebelum, null, "belum diketahui ≠ 0");
  const b = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 9, tanggalPemakaian: T }); assert.equal(b.body.penghalang[0].kode, "SALDO_KURANG");
  const c = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "KURANGI", qty: 1, tanggalPemakaian: T }); assert.equal(c.body.tindakan.jenis, "PENGEMBALIAN_STOK_BARU"); assert.equal(c.body.penghalang[0].kode, "UNIT_KOREKSI_MELEBIHI_PEMAKAIAN");
  assert.equal((await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 0, tanggalPemakaian: T })).status, 400); assert.equal((await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "LAIN", qty: 1, tanggalPemakaian: T })).status, 400); assert.equal((await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 1.00001, tanggalPemakaian: T })).status, 400);
  assert.equal((await w.s.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: T })).status, 403, "SALES tanpa izin");
  assert.equal((await pasang({ ...w, a: w.s }, { ...(await lengkap(w)), qty: 1 })).status, 403);
});

test("P5. pengurangan = pengembalian BARU bertaut unit (baris asli utuh); melebihi pemakaian bersih ditolak; saldo, alasan, tanggal wajib juga untuk pengembalian", async () => {
  const w = await dunia(); const i = await pasang(w, { ...(await lengkap(w)), qty: 5 }); assert.equal(i.status, 201, JSON.stringify(i.body));
  assert.equal((await pasang(w, { ...(await lengkap(w)), qty: -2, alasanPembetulan: undefined })).status, 400, "pengembalian tanpa alasan ditolak");
  const r = await pasang(w, { ...(await lengkap(w, { alasanPembetulan: "Kelebihan catat 2 kg" })), qty: -2 }); assert.equal(r.status, 201, JSON.stringify(r.body));
  const rows = await testPrisma.stockMovement.findMany({ where: { unitId: w.unit.id }, orderBy: { createdAt: "asc" } });
  assert.equal(rows.length, 2); assert.equal(rows[0].type, "ISSUE"); assert.equal(Number(rows[0].qty), -5, "baris asli TIDAK berubah"); assert.equal(rows[1].type, "RETURN"); assert.equal(Number(rows[1].qty), 2); assert.match(rows[1].note, /Kelebihan catat 2 kg/);
  assert.equal(await saldo(w.mat.id), 97);
  const lebih = await pasang(w, { ...(await lengkap(w)), qty: -4 }); assert.equal(lebih.status, 409); assert.equal(lebih.body.code, "UNIT_KOREKSI_MELEBIHI_PEMAKAIAN"); assert.equal(await saldo(w.mat.id), 97);
});

test("P6. CATATAN SEMENTARA (tanpa stok) pada unit terkirim: alasan + tanggal dilaporkan wajib; usedAt = tanggal dilaporkan, waktu pencatatan terpisah; unit DIBATALKAN tetap ditolak", async () => {
  const w = await dunia(); const baru = await createTestMaterial({ code: `SEM-${++seq}`, name: "BAHAN TANPA STOK", unit: "KG" });
  const body = { materialId: baru.id, qty: 2, uom: "KG", originNote: "sisa meja produksi", alasanPencatatan: "Stok bahan belum tercatat di Gudang" };
  const url = `/api/production/units/${w.unit.id}/provisional-usages`; const s0 = await snap();
  const tanpa = await w.a.post(url, body, { "Idempotency-Key": kunci("sem") }); assert.equal(tanpa.status, 409); assert.equal(tanpa.body.code, "UNIT_TIDAK_AKTIF"); assert.match(tanpa.body.error, /pembetulan dengan alasan/);
  const tanpaTgl = await w.a.post(url, { ...body, alasanPembetulan: "Terlewat dicatat saat unit dikerjakan" }, { "Idempotency-Key": kunci("sem") }); assert.equal(tanpaTgl.status, 400); assert.equal(tanpaTgl.body.code, "UNIT_TANGGAL_PEMAKAIAN_WAJIB");
  const ok = await w.a.post(url, { ...body, alasanPembetulan: "Terlewat dicatat saat unit dikerjakan", tanggalPemakaian: tgl(4) }, { "Idempotency-Key": kunci("sem") }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.ok(ok.body.item.note.startsWith(`Pembetulan unit terkirim (${w.unit.unitCode}) [dilaporkan ${tgl(4)}]: Terlewat dicatat saat unit dikerjakan`), ok.body.item.note);
  const row = await testPrisma.unitProvisionalUsage.findUnique({ where: { id: ok.body.item.id } }); assert.equal(wib(row.usedAt), tgl(4), "usedAt = tanggal dilaporkan"); assert.equal(wib(row.createdAt ?? row.recordedAt ?? new Date()), tgl(0), "waktu pencatatan terpisah");
  const s1 = await snap(); assert.equal(s1.sem, s0.sem + 1); assert.equal(s1.mov, s0.mov, "tanpa pergerakan stok"); assert.equal(s1.jurnal, s0.jurnal); assert.equal(s1.op, s0.op);
  const batal = await dunia({ status: "CANCELLED" }); const m2 = await createTestMaterial({ code: `SEM-${++seq}`, name: "X", unit: "KG" });
  const b2 = await batal.a.post(`/api/production/units/${batal.unit.id}/provisional-usages`, { ...body, materialId: m2.id, alasanPembetulan: "unit sudah dibatalkan", tanggalPemakaian: tgl(1) }, { "Idempotency-Key": kunci("sem") });
  assert.equal(b2.status, 409, "unit DIBATALKAN tetap tidak menerima pemakaian sementara");
});

test("P7. KOMPONEN LAMA pada unit terkirim: alasan + tanggal wajib, TANPA efek stok/jurnal/HPP, riwayat berjejak (catatan baku + log aktivitas), idempoten, unit dibatalkan/aktif lama tetap seperti semula", async () => {
  const w = await dunia(); const url = `/api/production/units/${w.unit.id}/komponen-lama`; const s0 = await snap(); const stok0 = await saldo(w.mat.id);
  const isi = { name: "Pegas bongkaran sisi kiri", qty: 2, uom: "PCS", condition: "aus ringan", outcome: "REUSED", workPart: "rangka bawah" };
  const tanpa = await w.a.post(url, isi, { "Idempotency-Key": kunci("komp-uji") }); assert.equal(tanpa.status, 409); assert.equal(tanpa.body.code, "UNIT_TIDAK_AKTIF");
  const tanpaTgl = await w.a.post(url, { ...isi, alasanPembetulan: "Lupa dicatat saat pengerjaan" }, { "Idempotency-Key": kunci("komp-uji") }); assert.equal(tanpaTgl.status, 400); assert.equal(tanpaTgl.body.code, "UNIT_TANGGAL_PEMAKAIAN_WAJIB");
  assert.deepEqual(await snap(), s0, "ditolak = tidak ada tulisan");
  const k = kunci("komp-uji"); const body = { ...isi, alasanPembetulan: "Lupa dicatat saat pengerjaan", tanggalPemakaian: tgl(5) };
  const ok = await w.a.post(url, body, { "Idempotency-Key": k }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.ok(ok.body.item.note.startsWith(`Pembetulan unit terkirim (${w.unit.unitCode}) [dilaporkan ${tgl(5)}]: Lupa dicatat saat pengerjaan`), ok.body.item.note);
  const ulang = await w.a.post(url, body, { "Idempotency-Key": k }); assert.equal(ulang.status, 200); assert.equal(ulang.body.replayed, true);
  const s1 = await snap(); assert.equal(s1.komp, s0.komp + 1, "klik ganda = satu catatan"); assert.equal(s1.mov, s0.mov); assert.equal(s1.jurnal, s0.jurnal); assert.equal(s1.val, s0.val); assert.equal(s1.op, s0.op); assert.equal(await saldo(w.mat.id), stok0);
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: w.unit.id, eventType: "PRODUCTION_KOMPONEN_LAMA_DICATAT" } }); assert.equal(ev.metadata.tanggalPemakaianDilaporkan, tgl(5)); assert.match(ev.metadata.pembetulanUnitTerkirim, /Lupa dicatat/);
  const batal = await dunia({ status: "CANCELLED" }); const b = await batal.a.post(`/api/production/units/${batal.unit.id}/komponen-lama`, { ...body }, { "Idempotency-Key": kunci("komp-uji") }); assert.equal(b.status, 409, "unit DIBATALKAN tetap ditolak");
  assert.equal((await w.s.post(url, body, { "Idempotency-Key": kunci("komp-uji") })).status, 403, "tanpa izin");
});

test("P8. PENCATATAN GANDA: pratinjau menampilkan pengeluaran tertaut + kandidat (bahan sama tanpa unit, unit lain jumlah sama, catatan historis, sementara) TANPA menautkan; pengeluaran baru wajib konfirmasi eksplisit", async () => {
  const w = await dunia(); const T = tgl(2);
  const lepas = await testPrisma.stockMovement.create({ data: { materialId: w.mat.id, type: "ISSUE", qty: -3, note: "pengeluaran lama tanpa unit", createdAt: new Date(Date.now() - 2 * HARI) } });
  const p0 = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 3, tanggalPemakaian: T }); assert.equal(p0.status, 200);
  const st = p0.body.sudahTercatat; assert.equal(st.perluKonfirmasi, true); assert.equal(st.kemungkinan.length, 1); assert.equal(st.kemungkinan[0].id, lepas.id); assert.equal(st.kemungkinan[0].kind, "PENGELUARAN_TANPA_UNIT");
  assert.ok(st.kemungkinan[0].alasan.includes("Jumlah sama persis") && st.kemungkinan[0].alasan.includes("Tidak tertaut ke unit mana pun")); assert.match(st.catatan, /TIDAK menyamakan atau menautkan otomatis/); assert.match(p0.body.dampak.at(-1), /PERHATIAN/);
  const L = await lengkap(w, { tanggalPemakaian: T });
  const s0 = await snap(); const tolak = await pasang(w, { ...L, qty: 3 }); assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "UNIT_KEMUNGKINAN_GANDA"); assert.equal(tolak.body.detail.kemungkinan, 1); assert.deepEqual(await snap(), s0, "ditolak = tidak ada tulisan");
  const ok = await pasang(w, { ...L, qty: 3, konfirmasiBukanGanda: true }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await testPrisma.stockMovement.findUnique({ where: { id: lepas.id } })).unitId, null, "kandidat TIDAK ditautkan otomatis");
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: w.unit.id, eventType: "PRODUCTION_PEMBETULAN_BAHAN_UNIT_SELESAI" } }); assert.equal(ev.metadata.konfirmasiBukanGanda, true);
  const p1 = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: T }); assert.equal(p1.body.sudahTercatat.tertaut.length, 1, "pengeluaran yang baru tercatat kini tertaut ke unit"); assert.equal(p1.body.sudahTercatat.tertaut[0].dilaporkan, T); assert.equal(p1.body.sudahTercatat.perluKonfirmasi, true);
  const bersih = await dunia(); const pb = await bersih.a.post(PRA(bersih), { materialId: bersih.mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: tgl(1) }); assert.equal(pb.body.sudahTercatat.ada, false); assert.equal(pb.body.sudahTercatat.perluKonfirmasi, false);
  assert.equal((await pasang(bersih, { ...(await lengkap(bersih)), qty: 1 })).status, 201, "tanpa kandidat: tidak perlu konfirmasi ganda");
});

test("P9. kandidat dari catatan historis dan pemakaian sementara unit yang sama; unit lain dengan jumlah sama muncul sebagai kemungkinan salah unit (bukan ditautkan)", async () => {
  const w = await dunia(); const T = tgl(2); const lain = await createTestUnit({ status: "RECEIVED" });
  await testPrisma.stockMovement.create({ data: { materialId: w.mat.id, type: "ISSUE", qty: -4, unitId: lain.unit.id, createdAt: new Date(Date.now() - 2 * HARI) } });
  const batch = await testPrisma.usageImportBatch.create({ data: { sourceKind: "EXCEL_ADMIN_SALES_CSV", fileName: "uji.csv", fileSha256: "ab".repeat(32), rowCount: 1, summary: {} } });
  await testPrisma.unitUsageNote.create({ data: { batchId: batch.id, sourceKey: kunci("note"), sourceRow: 1, rawRow: {}, origin: "EXCEL", orderNumber: "ORD-UJI", orderId: w.order.id, unitId: w.unit.id, rawName: "busa uji", qty: "4", uom: "KG", usedAt: new Date(Date.now() - 2 * HARI), materialId: w.mat.id, state: "SIAP_POSTING" } });
  await testPrisma.unitProvisionalUsage.create({ data: { unitId: w.unit.id, materialId: w.mat.id, name: "busa uji", nameKey: "busa uji", qty: "4", uom: "KG", usedAt: new Date(Date.now() - 2 * HARI), status: "PERLU_REKONSILIASI", recordedById: w.admin.user.id, idempotencyKey: kunci("psem") } });
  const p = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 4, tanggalPemakaian: T }); assert.equal(p.status, 200, JSON.stringify(p.body));
  const kinds = p.body.sudahTercatat.kemungkinan.map((x) => x.kind).sort(); assert.deepEqual(kinds, ["CATATAN_HISTORIS", "PEMAKAIAN_SEMENTARA", "PENGELUARAN_UNIT_LAIN"]);
  assert.ok(p.body.sudahTercatat.kemungkinan.find((x) => x.kind === "PENGELUARAN_UNIT_LAIN").alasan.some((a) => /unit lain/.test(a)));
  assert.equal(p.body.sudahTercatat.perluKonfirmasi, true);
});

test("P10. saldo berubah SETELAH pratinjau: penyimpanan ditolak (UNIT_SALDO_BERGESER) dan tidak ada yang tersimpan; setelah pratinjau ulang berhasil", async () => {
  const w = await dunia(); const p = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 3, tanggalPemakaian: tgl(1) }); const dilihat = p.body.stok.saldoDilihat; assert.equal(dilihat, 100);
  await testPrisma.stockMovement.create({ data: { materialId: w.mat.id, type: "ISSUE", qty: -10, note: "pengeluaran orang lain setelah pratinjau" } });
  const s0 = await snap(); const r = await pasang(w, { materialId: w.mat.id, qty: 3, alasanPembetulan: "Terlewat dicatat", tanggalPemakaian: tgl(1), saldoDilihat: dilihat });
  assert.equal(r.status, 409); assert.equal(r.body.code, "UNIT_SALDO_BERGESER"); assert.equal(r.body.detail.saldoSekarang, 90); assert.deepEqual(await snap(), s0);
  const p2 = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 3, tanggalPemakaian: tgl(1) }); assert.equal(p2.body.stok.saldoDilihat, 90); assert.equal(p2.body.stok.saldoSesudah, 87);
  const ok = await pasang(w, { materialId: w.mat.id, qty: 3, alasanPembetulan: "Terlewat dicatat", tanggalPemakaian: tgl(1), saldoDilihat: 90, konfirmasiBukanGanda: true }); assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(await saldo(w.mat.id), 87);
});

test("P11. prediksi Finance di pratinjau = kenyataan saat dikonfirmasi: (a) persediaan awal belum diposting -> catatan celah tanpa jurnal; (b) tanpa cutover -> jurnal HPP sebesar yang dinyatakan; tanggal jurnal = hari pencatatan", async () => {
  const w = await dunia(); const T = tgl(3);
  const pa = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 2, tanggalPemakaian: T }); assert.equal(pa.body.finance.hasil, "GAP_PERSEDIAAN_AWAL");
  const j0 = await testPrisma.finJournalEntry.count();
  const a = await pasang(w, { ...(await lengkap(w, { tanggalPemakaian: T })), qty: 2 }); assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(await testPrisma.finJournalEntry.count(), j0, "(a) tidak ada jurnal"); const gap = await testPrisma.finPostingGap.findFirst({ where: { sourceId: a.body.id } }); assert.equal(gap?.reason, "PERSEDIAAN_AWAL_BELUM_DIPOSTING");
  assert.equal(await saldo(w.mat.id), pa.body.stok.saldoSesudah, "stok nyata = stok pratinjau");
  await testPrisma.finSetting.upsert({ where: { key: "inventory_perpetual_cutover_date" }, create: { key: "inventory_perpetual_cutover_date", value: "2099-01-01" }, update: { value: "2099-01-01" } });
  const pb = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 2, tanggalPemakaian: T, }); assert.equal(pb.body.finance.hasil, "JURNAL"); assert.equal(pb.body.finance.nilai, 40000); assert.ok(pb.body.finance.teks.includes(`bukan tanggal pemakaian ${T}`));
  const b = await pasang(w, { ...(await lengkap(w, { tanggalPemakaian: T, konfirmasiBukanGanda: true })), qty: 2 }); assert.equal(b.status, 201, JSON.stringify(b.body));
  const jb = await testPrisma.finJournalEntry.findFirst({ where: { sourceId: b.body.id } });
  if (jb) { const baris = await testPrisma.finJournalLine.findMany({ where: { entryId: jb.id } }); assert.equal(baris.reduce((x, l) => x + Number(l.debit ?? 0), 0), 40000, "jurnal HPP sebesar nilai pratinjau"); assert.equal(wib(jb.date), tgl(0), "tanggal jurnal = hari pencatatan, BUKAN tanggal pemakaian"); }
  else { const gap2 = await testPrisma.finPostingGap.findFirst({ where: { sourceId: b.body.id } }); assert.ok(gap2, "bila akun belum siap: celah tercatat, bukan hilang diam-diam"); }
});

test("P12. koreksi jumlah berpersetujuan (layanan resmi) bekerja pada unit terkirim: pemohon tidak bisa menyetujui sendiri; penyetuju lain menghasilkan pengembalian bertaut pemakaian asal; riwayat tersimpan", async () => {
  const w = await dunia(); const i = await pasang(w, { ...(await lengkap(w)), qty: 5 }); assert.equal(i.status, 201, JSON.stringify(i.body));
  const pra = await w.a.post(`/api/production/units/${w.unit.id}/koreksi-pemakaian/pratinjau`, { materialId: w.mat.id, qtyBaru: 3 }); assert.equal(pra.status, 200); assert.equal(pra.body.bersihSebelum, 5); assert.equal(pra.body.bersihSesudah, 3); assert.equal(pra.body.saldoSebelum, 95); assert.equal(pra.body.saldoSesudah, 97); assert.equal(pra.body.boleh, true);
  const aj = await w.a.post(`/api/production/units/${w.unit.id}/koreksi-pemakaian`, { materialId: w.mat.id, qtyBaru: 3, alasan: "Pemakaian sebenarnya 3 kg" }, { "Idempotency-Key": kunci("kor") }); assert.equal(aj.status, 201, JSON.stringify(aj.body));
  assert.equal(await saldo(w.mat.id), 95, "diajukan = stok belum berubah");
  const sendiri = await w.a.post(`/api/production/koreksi-pemakaian/${aj.body.id}/setujui`, {}); assert.equal(sendiri.status, 403);
  const setuju = await w.f.post(`/api/production/koreksi-pemakaian/${aj.body.id}/setujui`, {}); assert.equal(setuju.status, 200, JSON.stringify(setuju.body));
  assert.equal(await saldo(w.mat.id), 97);
  const rows = await testPrisma.stockMovement.findMany({ where: { unitId: w.unit.id }, orderBy: { createdAt: "asc" } }); assert.equal(rows.length, 2); assert.equal(rows[1].type, "RETURN"); assert.equal(rows[1].correctsMovementId, rows[0].id); assert.equal(Number(rows[0].qty), -5, "baris asal utuh");
  const kor = await testPrisma.warehouseCorrection.findFirst({ where: { docId: w.unit.id } }); assert.equal(kor.status, "POSTED"); assert.equal(kor.reason, "Pemakaian sebenarnya 3 kg"); assert.equal(kor.requestedById, w.admin.user.id); assert.equal(kor.decidedById, w.fin.user.id);
});

test("P13. unit DIBATALKAN tidak diperluas: POST materials berperilaku seperti semula (tanpa persyaratan pembetulan), tidak ada awalan/log pembetulan", async () => {
  const w = await dunia({ status: "CANCELLED" }); const ok = await pasang(w, { materialId: w.mat.id, qty: 1, note: "perilaku lama" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal((await testPrisma.stockMovement.findUnique({ where: { id: ok.body.id } })).note, "perilaku lama");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: w.unit.id, eventType: "PRODUCTION_PEMBETULAN_BAHAN_UNIT_SELESAI" } }), 0);
});

// ───────────────────────── HPP operasional: dasar = TANGGAL PEMAKAIAN YANG DILAPORKAN (keputusan Owner) ─────────────────────────
const hargaDiTgl = (matId, harga, mulai, k) => testPrisma.materialHargaBerlaku.create({ data: { materialId: matId, jenis: "HARGA", unitPrice: String(harga), satuan: "KG", effectiveFrom: mulai, createdAt: mulai, reason: "harga uji", idempotencyKey: kunci(k ?? "hb") } });
const op = (movementId) => testPrisma.stockMovementBiayaOperasional.findFirst({ where: { movementId }, orderBy: { createdAt: "desc" } });
const dataExcel = async (unitCode) => { const modul = (await import("../../src/services/finance/export/biaya-bahan.js")).default; const d = await modul.ambil(testPrisma, { filter: { q: unitCode } }); return d.sheets.find((x) => x.nama === "HPP Operasional").baris; };

test("P14. pemakaian SEBELUM kenaikan harga yang dicatat SESUDAH kenaikan memakai harga lama; pratinjau = hasil tersimpan = jejak unit = Riwayat = Excel (tanggal dasar dan harga sama); harga hari pencatatan tidak dipakai", async () => {
  const w = await dunia(); await hargaDiTgl(w.mat.id, 20000, new Date(Date.now() - 10 * HARI)); await hargaDiTgl(w.mat.id, 30000, new Date(Date.now() - 2 * HARI), "hb2");
  const T = tgl(5); const p = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 3, tanggalPemakaian: T });
  assert.equal(p.body.hppOperasional.harga, 20000, "pratinjau: harga pada tanggal dilaporkan"); assert.equal(p.body.hppOperasional.nilai, 60000); assert.equal(p.body.hppOperasional.tanggalDasar, T); assert.match(p.body.hppOperasional.teks, /Harga hari pencatatan TIDAK dipakai/);
  const ok = await pasang(w, { ...(await lengkap(w, { tanggalPemakaian: T })), qty: 3 }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const o = await op(ok.body.id); assert.equal(o.status, "DINILAI"); assert.equal(Number(o.unitCost), 20000, "tersimpan = pratinjau, BUKAN 30000 (harga hari pencatatan)"); assert.equal(Number(o.value), 60000); assert.equal(o.basisHarga, "WAKTU_PEMAKAIAN"); assert.equal(o.basisDetail.dasarTanggal, T); assert.ok(o.basisDetail.dicatatPada);
  assert.equal(wib((await testPrisma.stockMovement.findUnique({ where: { id: ok.body.id } })).createdAt), tgl(0), "waktu pencatatan tetap terpisah");
  const { hppOperasionalUnit } = await import("../../src/services/finance/hargaBerlaku.js"); const jejak = (await hppOperasionalUnit(testPrisma, w.unit.id)).baris[0];
  assert.equal(jejak.harga, 20000); assert.equal(jejak.tanggalDasarHarga, T); assert.ok(jejak.basisTeks.includes(`tanggal pemakaian yang dilaporkan (${T})`)); assert.equal(wib(jejak.waktuPencatatan), tgl(0));
  const ad = await w.a.get(`/api/production/units/${w.unit.id}/adopsi`); const riw = ad.body.pemakaianAktual.baris[0]; assert.equal(riw.hppOperasional.harga, 20000); assert.equal(riw.hppOperasional.tanggalDasar, T); assert.equal(riw.hppOperasional.dasarTeks, jejak.basisTeks);
  const x = (await dataExcel(w.unit.unitCode))[0]; assert.equal(x.harga, 20000); assert.equal(x.dilaporkan, T); assert.equal(x.dasar, jejak.basisTeks); assert.equal(x.nilai, 60000);
  // pemakaian sesudah kenaikan (tanggal dilaporkan = kemarin) memakai harga baru: aturan yang sama, tanggal berbeda
  const p2 = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: tgl(1) }); assert.equal(p2.body.hppOperasional.harga, 30000);
});

test("P15. tanggal pemakaian TANPA harga berlaku = TANPA_HARGA/belum diketahui (bukan harga hari pencatatan, bukan Rp0); penerapan khusus juga tidak menyodorkan harga hari pencatatan", async () => {
  const w = await dunia(); await hargaDiTgl(w.mat.id, 30000, new Date(Date.now() - 2 * HARI)); const T = tgl(5);
  const p = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 2, tanggalPemakaian: T }); assert.equal(p.body.hppOperasional.status, "TANPA_HARGA"); assert.equal(p.body.hppOperasional.harga, null); assert.equal(p.body.hppOperasional.nilai, null); assert.match(p.body.hppOperasional.teks, /TANPA_HARGA \/ belum diketahui.*bukan harga hari pencatatan/);
  const ok = await pasang(w, { ...(await lengkap(w, { tanggalPemakaian: T })), qty: 2 }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const o = await op(ok.body.id); assert.equal(o.status, "TANPA_HARGA"); assert.equal(o.unitCost, null); assert.equal(o.value, null); assert.equal(o.basisDetail.dasarTanggal, T);
  const { hppOperasionalUnit, pratinjauPenerapan } = await import("../../src/services/finance/hargaBerlaku.js"); const jejak = (await hppOperasionalUnit(testPrisma, w.unit.id)).baris[0];
  assert.equal(jejak.status, "DIBEKUKAN_TANPA_HARGA_BERLAKU"); assert.equal(jejak.pratinjau, null, "tidak ada pratinjau harga dari hari pencatatan"); assert.equal(jejak.harga, null);
  const pen = await pratinjauPenerapan(testPrisma, { materialId: w.mat.id, groups: ["TANPA_HARGA_BERLAKU", "SELARAS_ULANG", "BELUM_DIBEKUKAN"] }, { lengkap: false });
  assert.equal(pen.penerapan.jumlah, 0, "penerapan khusus tidak memberi harga hari pencatatan"); assert.equal(pen.gap.baris.length, 1); assert.equal(pen.gap.baris[0].tanggalDasarHarga, T);
  const riw = (await w.a.get(`/api/production/units/${w.unit.id}/adopsi`)).body.pemakaianAktual.baris[0]; assert.equal(riw.hppOperasional.status, "TANPA_HARGA"); assert.equal(riw.hppOperasional.harga, null);
  const x = (await dataExcel(w.unit.unitCode))[0]; assert.equal(x.nilai, null); assert.equal(x.pratinjau, null); assert.equal(x.dilaporkan, T);
});

test("P16. tanggal diubah SETELAH pratinjau (atau dasar harga tidak dikirim): ditolak, tidak ada yang tersimpan; pratinjau ulang berhasil", async () => {
  const w = await dunia(); await hargaDiTgl(w.mat.id, 20000, new Date(Date.now() - 10 * HARI)); await hargaDiTgl(w.mat.id, 30000, new Date(Date.now() - 2 * HARI), "hb2");
  const p = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: tgl(5) }); const sidik = p.body.hppOperasional.sidik; const dilihat = p.body.stok.saldoDilihat;
  const s0 = await snap(); const dasar = { materialId: w.mat.id, qty: 1, alasanPembetulan: "Terlewat dicatat", saldoDilihat: dilihat };
  const ganti = await pasang(w, { ...dasar, tanggalPemakaian: tgl(1), hppSidik: sidik }); assert.equal(ganti.status, 409); assert.equal(ganti.body.code, "UNIT_DASAR_HARGA_BERGESER"); assert.deepEqual(await snap(), s0, "ditolak = tidak ada tulisan");
  const tanpa = await pasang(w, { ...dasar, tanggalPemakaian: tgl(5), hppSidik: null }); assert.equal(tanpa.status, 400); assert.equal(tanpa.body.code, "UNIT_PRATINJAU_WAJIB");
  const palsu = await pasang(w, { ...dasar, tanggalPemakaian: tgl(5), hppSidik: "x|y" }); assert.equal(palsu.status, 409); assert.deepEqual(await snap(), s0);
  const p2 = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: tgl(1) }); assert.equal(p2.body.hppOperasional.harga, 30000);
  const ok = await pasang(w, { ...dasar, tanggalPemakaian: tgl(1), hppSidik: p2.body.hppOperasional.sidik, konfirmasiBukanGanda: true }); assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(Number((await op(ok.body.id)).unitCost), 30000);
  const w2 = await dunia(); await hargaDiTgl(w2.mat.id, 20000, new Date(Date.now() - 10 * HARI)); const q = await w2.a.post(PRA(w2), { materialId: w2.mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: tgl(5) });
  await hargaDiTgl(w2.mat.id, 22000, new Date(Date.now() - 6 * HARI), "hb3"); // harga bergeser sebelum konfirmasi: dasar harga berbeda dari pratinjau
  const g = await pasang(w2, { materialId: w2.mat.id, qty: 1, alasanPembetulan: "Terlewat dicatat", tanggalPemakaian: tgl(5), saldoDilihat: q.body.stok.saldoDilihat, hppSidik: q.body.hppOperasional.sidik }); assert.equal(g.status, 409); assert.equal(g.body.code, "UNIT_DASAR_HARGA_BERGESER");
});

test("P17. RETUR bertaut mengikuti harga ISSUE asal (bukan harga tanggal retur maupun hari pencatatan); ISSUE asal tanpa harga = retur tanpa harga", async () => {
  const w = await dunia(); await hargaDiTgl(w.mat.id, 20000, new Date(Date.now() - 10 * HARI)); await hargaDiTgl(w.mat.id, 30000, new Date(Date.now() - 2 * HARI), "hb2");
  const i = await pasang(w, { ...(await lengkap(w, { tanggalPemakaian: tgl(5) })), qty: 4 }); assert.equal(i.status, 201, JSON.stringify(i.body)); assert.equal(Number((await op(i.body.id)).unitCost), 20000);
  const p = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "KURANGI", qty: 1, tanggalPemakaian: tgl(1) }); assert.equal(p.body.hppOperasional.harga, 20000, "retur tanggal 1 hari lalu: harga tanggal itu 30000, tetapi retur mengikuti ISSUE asal"); assert.equal(p.body.hppOperasional.basis, "HARGA_ISSUE_ASAL"); assert.match(p.body.hppOperasional.teks, /Retur mengikuti harga pengeluaran asal/);
  const r = await pasang(w, { ...(await lengkap(w, { tanggalPemakaian: tgl(1), alasanPembetulan: "Kelebihan catat 1 kg" })), qty: -1 }); assert.equal(r.status, 201, JSON.stringify(r.body));
  const o = await op(r.body.id); assert.equal(o.basisHarga, "HARGA_ISSUE_ASAL"); assert.equal(Number(o.unitCost), 20000); assert.equal(Number(o.value), -20000, "retur mengurangi HPP pada harga ISSUE asal");
  const x = (await dataExcel(w.unit.unitCode)).find((b) => b.nilai === -20000); assert.ok(x, "Excel membawa retur dengan harga ISSUE asal"); assert.match(x.dasar, /ISSUE asal/);
  // ISSUE asal tanpa harga (tanggal sebelum harga pertama) -> retur juga tanpa harga walau harga hari retur ada
  const w2 = await dunia(); await hargaDiTgl(w2.mat.id, 30000, new Date(Date.now() - 2 * HARI));
  const i2 = await pasang(w2, { ...(await lengkap(w2, { tanggalPemakaian: tgl(5) })), qty: 4 }); assert.equal((await op(i2.body.id)).status, "TANPA_HARGA");
  const p2 = await w2.a.post(PRA(w2), { materialId: w2.mat.id, jenis: "KURANGI", qty: 1, tanggalPemakaian: tgl(1) }); assert.equal(p2.body.hppOperasional.status, "TANPA_HARGA"); assert.match(p2.body.hppOperasional.teks, /belum punya harga operasional/);
  const r2 = await pasang(w2, { ...(await lengkap(w2, { tanggalPemakaian: tgl(1), alasanPembetulan: "Kelebihan catat" })), qty: -1 }); assert.equal(r2.status, 201); assert.equal((await op(r2.body.id)).status, "TANPA_HARGA");
});

test("P18. batas hari: harga yang mulai berlaku di TENGAH tanggal dilaporkan tidak dipakai (diperingatkan); unit AKTIF tetap memakai waktu pergerakan dan catatan berformat baku dari klien ditolak", async () => {
  const w = await dunia(); const T = tgl(3); await hargaDiTgl(w.mat.id, 20000, new Date(Date.now() - 10 * HARI)); await hargaDiTgl(w.mat.id, 30000, new Date(`${T}T05:00:00Z`), "hb2"); // 12:00 WIB pada tanggal dilaporkan
  const p = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: T }); assert.equal(p.body.hppOperasional.harga, 20000); assert.match(p.body.hppOperasional.peringatan, /berubah pada/); assert.match(p.body.hppOperasional.peringatan, /12:00 WIB/);
  await hargaDiTgl(w.mat.id, 25000, new Date(`${T}T00:00:00+07:00`), "hb3"); // tepat awal hari = berlaku (inklusif)
  const p2 = await w.a.post(PRA(w), { materialId: w.mat.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: T }); assert.equal(p2.body.hppOperasional.harga, 25000, "harga yang mulai tepat di awal tanggal berlaku");
  const ak = await dunia({ status: "IN_PRODUCTION" }); await hargaDiTgl(ak.mat.id, 20000, new Date(Date.now() - 10 * HARI)); await hargaDiTgl(ak.mat.id, 30000, new Date(Date.now() - 2 * HARI), "hb2");
  const ok = await pasang(ak, { materialId: ak.mat.id, qty: 1, note: "pemakaian biasa" }); assert.equal(ok.status, 201, JSON.stringify(ok.body)); const o = await op(ok.body.id); assert.equal(Number(o.unitCost), 30000, "unit aktif: harga saat pemakaian dicatat"); assert.equal(o.basisDetail, null);
  const palsu = await pasang(ak, { materialId: ak.mat.id, qty: 1, note: `Pembetulan unit terkirim (${ak.unit.unitCode}) [dilaporkan ${tgl(5)}]: palsu` }); assert.equal(palsu.status, 400); assert.equal(palsu.body.code, "CATATAN_FORMAT_RESERVED");
});
