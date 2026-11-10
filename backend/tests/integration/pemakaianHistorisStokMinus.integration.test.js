// PEMAKAIAN HISTORIS: pengecualian TERKENDALI "Tetap catat meskipun stok tidak cukup" + skema SATUAN PAKAI (LIST WIBING: stok ROLL, pakai METER, 1 ROLL = 90 METER). Backend asli + DB uji terisolasi.
// KEPUTUSAN OWNER (4 Nov 2026): riwayat dilengkapi dulu, saldo dibereskan lewat stock opname. Validasi stok global TIDAK dilonggarkan; pengecualian hanya untuk pengeluaran pada unit TERKIRIM lewat POST /units/:id/materials.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { denganVerifikasiOtomatis } from "./setup/verifikasiOtomatis.js"; // non-ADMIN: pengajuan → diverifikasi ADMIN uji lain (jalur tulis yang sama)

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let seq = 0; const kunci = (p = "ph") => `${p}-${Date.now()}-${++seq}-uji-kunci`;
const HARI = 86400_000;
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const tgl = (hariLalu = 0) => wib(Date.now() - hariLalu * HARI);
const ALASAN = "Pemakaian lama belum tercatat; saldo dibereskan lewat opname";

/** Dunia uji: unit TERKIRIM, tiga peran (pengelola = Kepala Produksi, operator lantai, Admin), bahan METER (tanpa aturan) dan bahan LIST WIBING (ROLL, aturan 90 m/roll). */
async function dunia({ status = "DELIVERED" } = {}) {
  const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] }); const pekerja = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); const admin = await createTestUser({ roles: ["ADMIN"] });
  const kain = await createTestMaterial({ code: `KAIN-${++seq}`, name: "KAIN UJI", unit: "METER" });
  const list = await createTestMaterial({ code: `LIST-WIBING-UJI-${++seq}`, name: "LIST WIBING UJI", unit: "ROLL" });
  const { unit, order } = await createTestUnit({ status, createdAt: new Date(Date.now() - 20 * HARI) });
  const c = (u) => denganVerifikasiOtomatis(makeClient(server.baseUrl, u.token), server.baseUrl);
  return { lead, pekerja, admin, l: c(lead), p: c(pekerja), a: c(admin), kain, list, unit, order };
}
const saldo = async (id) => Number((await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${id}::uuid`)[0].s);
/** Saldo 0 tetapi BERCATATAN (n>0): terima lalu keluarkan semuanya tanpa unit. */
async function saldoNol(mat, awal = 5) { await seedBalance(mat.id, awal, { unitCost: 20000, createdAt: new Date(Date.now() - 41 * HARI) }); await testPrisma.stockMovement.create({ data: { materialId: mat.id, type: "ISSUE", qty: -awal, note: "uji: habiskan stok", createdAt: new Date(Date.now() - 40 * HARI) } }); }
const snap = async () => ({ mov: await testPrisma.stockMovement.count(), op: await testPrisma.stockMovementBiayaOperasional.count(), jurnal: await testPrisma.finJournalEntry.count(), ev: await testPrisma.activityEvent.count({ where: { eventType: "PRODUCTION_PEMBETULAN_BAHAN_UNIT_SELESAI" } }) });
const PRA = (w) => `/api/production/units/${w.unit.id}/pembetulan-bahan/pratinjau`;
const tipeMov = async () => (await testPrisma.stockMovement.groupBy({ by: ["type"], _count: { _all: true } })).reduce((a, x) => ({ ...a, [x.type]: x._count._all }), {});
/** Pratinjau sungguhan lalu POST dengan dasar yang dilihat (saldoDilihat + hppSidik). `body` = { materialId, qty, satuan?, ...pengecualian }. */
async function catat(w, who, body, { k = kunci(), tanggal = tgl(3), pra = null } = {}) {
  const p = pra ?? await who.post(PRA(w), { materialId: body.materialId, jenis: "TAMBAH", qty: Math.abs(body.qty), tanggalPemakaian: tanggal, satuan: body.satuan, pengecualianStokTidakCukup: body.pengecualianStokTidakCukup === true });
  const kirim = { alasanPembetulan: "Bahan terlewat dicatat saat produksi", tanggalPemakaian: tanggal, saldoDilihat: p.body?.stok?.saldoDilihat, hppSidik: p.body?.hppOperasional?.sidik, ...body };
  return { pra: p, res: await who.post(`/api/units/${w.unit.id}/materials`, kirim, { "Idempotency-Key": k }) };
}
const EXC = { pengecualianStokTidakCukup: true, alasanPengecualianStok: ALASAN, konfirmasiSaldoMinus: true };

test("H1. saldo 0 dan pemakaian 3,4 meter: TANPA pengecualian ditolak (stok tidak berubah); DENGAN pengecualian → saldo −3,4, satu ISSUE bertaut unit, tanggal dilaporkan terpisah, alasan + audit tercatat", async () => {
  const w = await dunia(); await saldoNol(w.kain); const s0 = await snap();
  const tanpa = await catat(w, w.l, { materialId: w.kain.id, qty: 3.4 });
  assert.equal(tanpa.pra.status, 200); assert.ok(tanpa.pra.body.penghalang.some((h) => h.kode === "SALDO_KURANG" && h.bisaDikecualikan === true), "pratinjau: diblokir tetapi BISA dikecualikan oleh pengelola");
  assert.equal(tanpa.res.status, 400, JSON.stringify(tanpa.res.body)); assert.match(tanpa.res.body.error, /tidak cukup/); assert.equal(await saldo(w.kain.id), 0); assert.deepEqual(await snap(), s0, "ditolak = tidak ada tulisan");
  const pra = await w.l.post(PRA(w), { materialId: w.kain.id, jenis: "TAMBAH", qty: 3.4, tanggalPemakaian: tgl(3), pengecualianStokTidakCukup: true });
  assert.equal(pra.status, 200); assert.equal(pra.body.penghalang.length, 0, JSON.stringify(pra.body.penghalang)); assert.equal(pra.body.peringatan[0].kode, "SALDO_MINUS"); assert.equal(pra.body.stok.saldoSebelum, 0); assert.equal(pra.body.stok.saldoSesudah, -3.4);
  const s1 = await snap(); const hasil = await catat(w, w.l, { materialId: w.kain.id, qty: 3.4, ...EXC }, { pra });
  assert.equal(hasil.res.status, 201, JSON.stringify(hasil.res.body));
  const mv = await testPrisma.stockMovement.findUnique({ where: { id: hasil.res.body.id } });
  assert.equal(mv.type, "ISSUE"); assert.equal(Number(mv.qty), -3.4); assert.equal(mv.unitId, w.unit.id); assert.equal(await saldo(w.kain.id), -3.4);
  assert.equal(wib(mv.createdAt), tgl(0), "waktu pencatatan = hari ini"); assert.ok(mv.note.includes(`[dilaporkan ${tgl(3)}]`), mv.note);
  assert.ok(mv.reason.startsWith("Pengecualian stok tidak cukup (pemakaian historis): ") && mv.reason.includes(ALASAN), mv.reason);
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: w.unit.id, eventType: "PRODUCTION_PEMBETULAN_BAHAN_UNIT_SELESAI" } }); const px = ev.metadata.pengecualianStokTidakCukup;
  assert.equal(px.dipakai, true); assert.equal(px.alasan, ALASAN); assert.equal(px.saldoSebelum, 0); assert.equal(px.saldoSesudah, -3.4); assert.equal(px.tanggalPemakaian, tgl(3)); assert.equal(ev.actorId, w.lead.user.id);
  const s2 = await snap(); assert.equal(s2.mov - s1.mov, 1, "tepat satu pergerakan"); assert.equal(s2.ev - s1.ev, 1); assert.equal(s2.op - s1.op, 1, "satu pembekuan HPP operasional");
});

test("H2. saldo sudah MINUS: pengecualian mengurangi sebesar jumlah tambahan; tanpa penerimaan/penyesuaian otomatis; jurnal tidak mengarang nilai ketika harga tidak ada", async () => {
  const w = await dunia(); await seedBalance(w.kain.id, -10); // ledger −10 (tanpa harga perolehan)
  const t0 = await tipeMov(); const pra = await w.l.post(PRA(w), { materialId: w.kain.id, jenis: "TAMBAH", qty: 2.5, tanggalPemakaian: tgl(2), pengecualianStokTidakCukup: true });
  assert.equal(pra.body.stok.saldoSebelum, -10); assert.equal(pra.body.stok.saldoSesudah, -12.5); assert.equal(pra.body.finance.hasil, "GAP_PERSEDIAAN_AWAL", "Finance mengikuti kontrak lama (persediaan awal belum diposting): celah, bukan nilai karangan");
  const r = await catat(w, w.l, { materialId: w.kain.id, qty: 2.5, ...EXC }, { pra, tanggal: tgl(2) }); assert.equal(r.res.status, 201, JSON.stringify(r.res.body));
  assert.equal(await saldo(w.kain.id), -12.5); const t1 = await tipeMov();
  assert.equal(t1.ISSUE - (t0.ISSUE ?? 0), 1); assert.equal(t1.RECEIPT ?? 0, t0.RECEIPT ?? 0); assert.equal(t1.ADJUSTMENT ?? 0, t0.ADJUSTMENT ?? 0, "tidak ada penerimaan/penyesuaian otomatis");
  assert.equal(await testPrisma.finJournalEntry.count(), 0, "persediaan awal belum diposting: tidak ada jurnal karangan");
  assert.equal((await testPrisma.finPostingGap.findFirst({ where: { sourceId: r.res.body.id } }))?.reason, "PERSEDIAAN_AWAL_BELUM_DIPOSTING", "celah tercatat, bukan hilang");
});

test("H3. stok CUKUP + pengecualian diminta: perilaku normal (pengecualian TIDAK dipakai, tanpa penanda minus); tanpa pengecualian perilaku lama utuh", async () => {
  const w = await dunia(); await seedBalance(w.kain.id, 10, { unitCost: 20000 });
  const a = await catat(w, w.l, { materialId: w.kain.id, qty: 4, ...EXC }, { pra: await w.l.post(PRA(w), { materialId: w.kain.id, jenis: "TAMBAH", qty: 4, tanggalPemakaian: tgl(3), pengecualianStokTidakCukup: true }) });
  assert.equal(a.res.status, 201, JSON.stringify(a.res.body)); const mv = await testPrisma.stockMovement.findUnique({ where: { id: a.res.body.id } });
  assert.equal(mv.reason, null, "pengecualian tidak dipakai → tidak ada penanda"); assert.equal(await saldo(w.kain.id), 6);
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: w.unit.id } }); assert.equal(ev.metadata.pengecualianStokTidakCukup.dipakai, false);
  const b0 = await catat(w, w.l, { materialId: w.kain.id, qty: 2 }); assert.equal(b0.res.status, 409, "pengeluaran kedua bahan sama pada unit ini: pemeriksaan ganda lama tetap jalan"); assert.equal(b0.res.body.code, "UNIT_KEMUNGKINAN_GANDA");
  const b = await catat(w, w.l, { materialId: w.kain.id, qty: 2, konfirmasiBukanGanda: true }); assert.equal(b.res.status, 201); assert.equal(await saldo(w.kain.id), 4);
});

test("H4. DITOLAK: tanpa izin pengelola (operator lantai 403), tanpa alasan, alasan pendek, tanpa konfirmasi, flag tanpa data pendukung, bukan unit terkirim, pengembalian — dan tidak ada yang tersimpan", async () => {
  const w = await dunia(); await saldoNol(w.kain); const s0 = await snap();
  const pra = await w.l.post(PRA(w), { materialId: w.kain.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: tgl(3), pengecualianStokTidakCukup: true });
  const coba = (who, extra, opts = {}) => catat(w, who, { materialId: w.kain.id, qty: 1, ...extra }, { pra, ...opts }).then((x) => x.res);
  const pekerja = await coba(w.p, EXC); assert.equal(pekerja.status, 403); assert.equal(pekerja.body.code, "PENGECUALIAN_STOK_TANPA_IZIN");
  const praPekerja = await w.p.post(PRA(w), { materialId: w.kain.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: tgl(3), pengecualianStokTidakCukup: true });
  assert.equal(praPekerja.status, 200); assert.ok(praPekerja.body.penghalang.some((h) => h.kode === "PENGECUALIAN_DITOLAK"), "pratinjau operator: tidak bisa dikecualikan"); assert.equal(praPekerja.body.izin.pengecualianStokTidakCukup, false);
  const tanpaAlasan = await coba(w.l, { ...EXC, alasanPengecualianStok: undefined }); assert.equal(tanpaAlasan.status, 400); assert.equal(tanpaAlasan.body.code, "PENGECUALIAN_STOK_ALASAN_WAJIB");
  const pendek = await coba(w.l, { ...EXC, alasanPengecualianStok: "habis" }); assert.equal(pendek.status, 400); assert.equal(pendek.body.code, "PENGECUALIAN_STOK_ALASAN_WAJIB");
  const tanpaKonf = await coba(w.l, { ...EXC, konfirmasiSaldoMinus: undefined }); assert.equal(tanpaKonf.status, 400); assert.equal(tanpaKonf.body.code, "PENGECUALIAN_STOK_KONFIRMASI_WAJIB");
  const tanpaFlag = await coba(w.l, { alasanPengecualianStok: ALASAN, konfirmasiSaldoMinus: true }); assert.equal(tanpaFlag.status, 400, "alasan + konfirmasi TANPA pilihan pengecualian tidak cukup: aturan stok tetap berlaku"); assert.match(tanpaFlag.body.error, /tidak cukup/);
  const tglSaja = await coba(w.l, {}, { tanggal: tgl(3) }); assert.equal(tglSaja.status, 400, "tanggal historis saja tidak melewati validasi stok");
  const retur = await catat(w, w.l, { materialId: w.kain.id, qty: -1, ...EXC }, { pra }); assert.equal(retur.res.status, 400); assert.equal(retur.res.body.code, "PENGECUALIAN_HANYA_PEMAKAIAN_HISTORIS");
  assert.equal(await saldo(w.kain.id), 0); assert.deepEqual(await snap(), s0, "semua ditolak = tidak ada tulisan");
  // unit yang masih BERJALAN: pengecualian tidak berlaku (pemakaian biasa tetap menolak stok tidak cukup)
  const b = await dunia({ status: "IN_PRODUCTION" }); await saldoNol(b.kain);
  const aktif = await b.l.post(`/api/units/${b.unit.id}/materials`, { materialId: b.kain.id, qty: 1, ...EXC }, { "Idempotency-Key": kunci() }); assert.equal(aktif.status, 400); assert.equal(aktif.body.code, "PENGECUALIAN_HANYA_PEMAKAIAN_HISTORIS");
  const biasa = await b.l.post(`/api/units/${b.unit.id}/materials`, { materialId: b.kain.id, qty: 1 }, { "Idempotency-Key": kunci() }); assert.equal(biasa.status, 400); assert.match(biasa.body.error, /tidak cukup/); assert.equal(await saldo(b.kain.id), 0);
});

test("H5. klik ganda / retry (kunci sama) = SATU ISSUE dan SATU audit; kunci sama dengan isian/alasan berbeda ditolak", async () => {
  const w = await dunia(); await saldoNol(w.kain); const pra = await w.l.post(PRA(w), { materialId: w.kain.id, jenis: "TAMBAH", qty: 2, tanggalPemakaian: tgl(3), pengecualianStokTidakCukup: true }); const k = kunci(); const s0 = await snap();
  const [a, b] = await Promise.all([catat(w, w.l, { materialId: w.kain.id, qty: 2, ...EXC }, { pra, k }), catat(w, w.l, { materialId: w.kain.id, qty: 2, ...EXC }, { pra, k })]);
  assert.ok([a.res.status, b.res.status].every((s) => [200, 201, 409].includes(s)), `${a.res.status}/${b.res.status}`); assert.ok([a.res.status, b.res.status].includes(201));
  const ulang = await catat(w, w.l, { materialId: w.kain.id, qty: 2, ...EXC }, { pra, k }); assert.ok([200].includes(ulang.res.status), JSON.stringify(ulang.res.body)); assert.equal(ulang.res.headers?.get?.("idempotent-replay") ?? "true", "true");
  const s1 = await snap(); assert.equal(s1.mov - s0.mov, 1, "satu pergerakan"); assert.equal(s1.ev - s0.ev, 1, "satu audit"); assert.equal(await saldo(w.kain.id), -2);
  const beda = await catat(w, w.l, { materialId: w.kain.id, qty: 2, ...EXC, alasanPengecualianStok: "Alasan yang berbeda dari sebelumnya ya" }, { pra, k }); assert.equal(beda.res.status, 409); assert.equal(beda.res.body.code, "IDEMPOTENCY_KEY_REUSED"); assert.equal(await saldo(w.kain.id), -2);
});

test("H6. DUA PETUGAS bersamaan: saldo akhir dan audit konsisten (yang kalah lomba mendapat UNIT_SALDO_BERGESER, lihat dampak lagi, lalu berhasil)", async () => {
  const w = await dunia(); const lead2 = await createTestUser({ roles: ["PRODUCTION_LEAD"] }); const l2 = denganVerifikasiOtomatis(makeClient(server.baseUrl, lead2.token), server.baseUrl); await saldoNol(w.kain);
  const pra1 = await w.l.post(PRA(w), { materialId: w.kain.id, jenis: "TAMBAH", qty: 1.5, tanggalPemakaian: tgl(3), pengecualianStokTidakCukup: true });
  const pra2 = await l2.post(PRA(w), { materialId: w.kain.id, jenis: "TAMBAH", qty: 2, tanggalPemakaian: tgl(3), pengecualianStokTidakCukup: true });
  const [a, b] = await Promise.all([catat(w, w.l, { materialId: w.kain.id, qty: 1.5, ...EXC }, { pra: pra1 }), catat(w, l2, { materialId: w.kain.id, qty: 2, ...EXC }, { pra: pra2 })]);
  const status = [a.res.status, b.res.status].sort(); assert.deepEqual(status, [201, 409], `${a.res.status}/${b.res.status} ${JSON.stringify([a.res.body, b.res.body])}`);
  const kalah = a.res.status === 409 ? a : b; assert.equal(kalah.res.body.code, "UNIT_SALDO_BERGESER");
  const menang = a.res.status === 201 ? 1.5 : 2; assert.equal(await saldo(w.kain.id), -menang);
  const qKalah = a.res.status === 409 ? 1.5 : 2; const whoKalah = a.res.status === 409 ? w.l : l2;
  const ulang = await catat(w, whoKalah, { materialId: w.kain.id, qty: qKalah, ...EXC, konfirmasiBukanGanda: true }); assert.equal(ulang.res.status, 201, JSON.stringify(ulang.res.body));
  assert.equal(Math.round((await saldo(w.kain.id)) * 10000) / 10000, -3.5); assert.equal((await testPrisma.activityEvent.count({ where: { eventType: "PRODUCTION_PEMBETULAN_BAHAN_UNIT_SELESAI" } })), 2);
  const pergerakan = await testPrisma.stockMovement.findMany({ where: { unitId: w.unit.id }, select: { createdById: true } }); assert.equal(new Set(pergerakan.map((x) => x.createdById)).size, 2, "dua pelaku berbeda tercatat");
});

test("H7. tanggal & HARGA historis tetap: HPP operasional memakai Harga Berlaku pada tanggal pemakaian (bukan hari pencatatan); waktu pencatatan terpisah", async () => {
  const w = await dunia(); await saldoNol(w.kain);
  const hb = (harga, hariLalu, k) => { const t = new Date(Date.now() - hariLalu * HARI); return testPrisma.materialHargaBerlaku.create({ data: { materialId: w.kain.id, jenis: "HARGA", unitPrice: String(harga), satuan: "METER", effectiveFrom: t, createdAt: t, reason: "harga uji", idempotencyKey: kunci(k) } }); };
  await hb(1000, 30, "hb1"); await hb(3000, 1, "hb2");
  const r = await catat(w, w.l, { materialId: w.kain.id, qty: 4, ...EXC }, { pra: await w.l.post(PRA(w), { materialId: w.kain.id, jenis: "TAMBAH", qty: 4, tanggalPemakaian: tgl(10), pengecualianStokTidakCukup: true }), tanggal: tgl(10) });
  assert.equal(r.res.status, 201, JSON.stringify(r.res.body)); const op = await testPrisma.stockMovementBiayaOperasional.findFirst({ where: { movementId: r.res.body.id } });
  assert.equal(op.status, "DINILAI"); assert.equal(Number(op.unitCost), 1000, "harga pada tanggal pemakaian (10 hari lalu), bukan harga terbaru 3000"); assert.equal(Number(op.value), 4000);
  const mv = await testPrisma.stockMovement.findUnique({ where: { id: r.res.body.id } }); assert.equal(wib(mv.createdAt), tgl(0)); assert.ok(mv.note.includes(`[dilaporkan ${tgl(10)}]`));
});

test("H8. dokumen/pengeluaran yang SUDAH tertaut tetap memicu pemeriksaan ganda (409 UNIT_KEMUNGKINAN_GANDA) — pengecualian tidak melewatinya; setelah dinyatakan bukan ganda berhasil", async () => {
  const w = await dunia(); await saldoNol(w.kain);
  await testPrisma.stockMovement.create({ data: { materialId: w.kain.id, type: "ISSUE", qty: -1, unitId: w.unit.id, note: "pemakaian sebelumnya pada unit ini" } }); await seedBalance(w.kain.id, 1); // saldo 0 lagi, ada pengeluaran tertaut
  const pra = await w.l.post(PRA(w), { materialId: w.kain.id, jenis: "TAMBAH", qty: 2, tanggalPemakaian: tgl(3), pengecualianStokTidakCukup: true });
  assert.equal(pra.body.sudahTercatat.perluKonfirmasi, true); assert.ok(pra.body.sudahTercatat.tertaut.length >= 1);
  const tolak = await catat(w, w.l, { materialId: w.kain.id, qty: 2, ...EXC }, { pra }); assert.equal(tolak.res.status, 409); assert.equal(tolak.res.body.code, "UNIT_KEMUNGKINAN_GANDA"); assert.equal(await saldo(w.kain.id), 0);
  const ok = await catat(w, w.l, { materialId: w.kain.id, qty: 2, ...EXC, konfirmasiBukanGanda: true }, { pra }); assert.equal(ok.res.status, 201, JSON.stringify(ok.res.body)); assert.equal(await saldo(w.kain.id), -2);
});

test("H9. CUTOFF OPNAME: pemakaian bertanggal SAMA/SEBELUM opname yang sudah selesai diblokir (bisa mengurangi saldo dua kali); sesudahnya boleh; sesi berjalan hanya peringatan; tanpa acuan = tidak ada blokir", async () => {
  const w = await dunia(); await saldoNol(w.kain);
  const sc = await testPrisma.stockCount.create({ data: { countNumber: "CC-UJI-1", countType: "CYCLE_COUNT", countMethod: "BY_ITEM", status: "COMPLETED", startedAt: new Date(Date.now() - 6 * HARI), submittedAt: new Date(Date.now() - 5 * HARI), completedAt: new Date(Date.now() - 4 * HARI) } });
  await testPrisma.stockCountLine.create({ data: { stockCountId: sc.id, materialId: w.kain.id, systemQty: 0, countedQty: 0, observedAt: new Date(Date.now() - 5 * HARI), observedSource: "MULAI" } });
  const sebelum = await w.l.post(PRA(w), { materialId: w.kain.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: tgl(8), pengecualianStokTidakCukup: true });
  assert.equal(sebelum.status, 200); assert.ok(sebelum.body.penghalang.some((h) => h.kode === "SALDO_KURANG" && h.bisaDikecualikan === false), "melintasi opname: TIDAK bisa dikecualikan"); assert.equal(sebelum.body.pengecualianStok.opname.melintasi, true); assert.match(sebelum.body.pengecualianStok.opname.teks, /DUA KALI/);
  const tolak = await catat(w, w.l, { materialId: w.kain.id, qty: 1, ...EXC }, { tanggal: tgl(8), pra: sebelum }); assert.equal(tolak.res.status, 409); assert.equal(tolak.res.body.code, "PENGECUALIAN_MELINTASI_OPNAME"); assert.equal(await saldo(w.kain.id), 0);
  const sama = await w.l.post(PRA(w), { materialId: w.kain.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: tgl(5), pengecualianStokTidakCukup: true }); assert.equal(sama.body.pengecualianStok.bisa, false, "tanggal SAMA dengan acuan opname dianggap melintasi");
  const sesudah = await w.l.post(PRA(w), { materialId: w.kain.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: tgl(2), pengecualianStokTidakCukup: true }); assert.equal(sesudah.body.pengecualianStok.bisa, true); assert.equal(sesudah.body.penghalang.length, 0);
  const ok = await catat(w, w.l, { materialId: w.kain.id, qty: 1, ...EXC }, { tanggal: tgl(2), pra: sesudah }); assert.equal(ok.res.status, 201, JSON.stringify(ok.res.body)); assert.equal(await saldo(w.kain.id), -1);
  const baru = await createTestMaterial({ code: `KAIN-${++seq}`, name: "KAIN B", unit: "METER" }); await saldoNol(baru);
  await testPrisma.stockCountLine.create({ data: { stockCountId: (await testPrisma.stockCount.create({ data: { countNumber: "CC-UJI-2", countType: "CYCLE_COUNT", countMethod: "BY_ITEM", status: "IN_PROGRESS", startedAt: new Date() } })).id, materialId: baru.id } });
  const jalan = await w.l.post(PRA(w), { materialId: baru.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: tgl(2), pengecualianStokTidakCukup: true }); assert.equal(jalan.body.pengecualianStok.bisa, true); assert.equal(jalan.body.pengecualianStok.opname.berjalan.length, 1, "sesi berjalan diperingatkan"); assert.match(jalan.body.pengecualianStok.opname.teks, /CC-UJI-2/);
});

test("H10. saldo BELUM DIKETAHUI (bahan tanpa catatan stok) bukan nol/minus: pengecualian ditolak (409); jalur 'catat sementara' tetap jalan", async () => {
  const w = await dunia(); const pra = await w.l.post(PRA(w), { materialId: w.kain.id, jenis: "TAMBAH", qty: 1, tanggalPemakaian: tgl(3), pengecualianStokTidakCukup: true });
  assert.ok(pra.body.penghalang.some((h) => h.kode === "STOK_BELUM_DIKETAHUI")); assert.equal(pra.body.stok.saldoSebelum, null, "ditampilkan 'belum diketahui', bukan 0");
  const r = await catat(w, w.l, { materialId: w.kain.id, qty: 1, ...EXC }, { pra }); assert.ok([400, 409].includes(r.res.status), JSON.stringify(r.res.body)); assert.equal(await testPrisma.stockMovement.count({ where: { materialId: w.kain.id } }), 0);
});

test("H11. SATUAN PAKAI LIST WIBING: dibeli ROLL, dipakai METER (1 ROLL = 90 m): 20 m = 0,2222 ROLL; satuan wajib; 3,4 m = 0,0378 ROLL; pembulatan 4 desimal; ROLL langsung tetap bisa; bahan METER biasa tidak dikonversi", async () => {
  const w = await dunia(); await seedBalance(w.list.id, 10, { unitCost: 94350 });
  const tanpaSatuan = await w.l.post(`/api/units/${w.unit.id}/materials`, { materialId: w.list.id, qty: 20 }, { "Idempotency-Key": kunci() }); assert.equal(tanpaSatuan.status, 400); assert.equal(tanpaSatuan.body.code, "SATUAN_PAKAI_WAJIB"); assert.equal(await saldo(w.list.id), 10, "klien lama yang mengirim angka tanpa satuan ditolak, bukan terbaca ROLL");
  const pra = await w.l.post(PRA(w), { materialId: w.list.id, jenis: "TAMBAH", qty: 20, satuan: "METER", tanggalPemakaian: tgl(3) });
  assert.equal(pra.status, 200, JSON.stringify(pra.body)); assert.equal(pra.body.qty, 0.2222); assert.equal(pra.body.qtyInput, 20); assert.equal(pra.body.satuanInput, "METER"); assert.match(pra.body.konversi.teks, /20 METER ÷ 90 = 0,2222 ROLL/); assert.equal(pra.body.stok.saldoSesudah, 9.7778); assert.equal(pra.body.bahan.satuanPakai.faktor, 90);
  const r = await catat(w, w.l, { materialId: w.list.id, qty: 20, satuan: "METER" }, { pra }); assert.equal(r.res.status, 201, JSON.stringify(r.res.body));
  const mv = await testPrisma.stockMovement.findUnique({ where: { id: r.res.body.id } }); assert.equal(Number(mv.qty), -0.2222); assert.equal(await saldo(w.list.id), 9.7778);
  assert.ok(mv.note.includes("[pakai 20 METER = 0,2222 ROLL @ 90/ROLL]"), mv.note);
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: w.unit.id } }); assert.deepEqual({ ...ev.metadata.satuanPakai }, { qtyInput: 20, satuanInput: "METER", qtyStok: 0.2222, faktor: 90, dikonversi: true });
  const op = await testPrisma.stockMovementBiayaOperasional.findFirst({ where: { movementId: mv.id } }); assert.equal(op.status === "DINILAI" || op.status === "TANPA_HARGA", true);
  const kecil = await w.l.post(PRA(w), { materialId: w.list.id, jenis: "TAMBAH", qty: 0.001, satuan: "METER", tanggalPemakaian: tgl(3) }); assert.equal(kecil.status, 400); assert.equal(kecil.body.code, "QTY_TERLALU_KECIL");
  const salah = await w.l.post(PRA(w), { materialId: w.list.id, jenis: "TAMBAH", qty: 1, satuan: "KG", tanggalPemakaian: tgl(3) }); assert.equal(salah.status, 400); assert.equal(salah.body.code, "SATUAN_TIDAK_DIKENAL");
  const roll = await catat(w, w.l, { materialId: w.list.id, qty: 1, satuan: "ROLL", konfirmasiBukanGanda: true }); assert.equal(roll.res.status, 201); assert.equal(Math.round((await saldo(w.list.id)) * 10000) / 10000, 8.7778, "satuan ROLL eksplisit = tanpa konversi");
  const m = await catat(w, w.l, { materialId: w.kain.id, qty: 3 }, { pra: null }); assert.ok([400].includes(m.res.status)); // kain METER tanpa saldo: ditolak karena stok, bukan karena satuan
  await seedBalance(w.kain.id, 50, { unitCost: 1 }); const k = await catat(w, w.l, { materialId: w.kain.id, qty: 3 }); assert.equal(k.res.status, 201); assert.equal(await saldo(w.kain.id), 47, "bahan METER tanpa aturan: tidak dikonversi");
});

test("H12. LIST WIBING + pengecualian: saldo −106,5 ROLL (warisan meter) dan pemakaian 20 meter → −106,7222 ROLL; 3,4 meter pada saldo 0 → −0,0378; ditolak tanpa pengecualian", async () => {
  const w = await dunia(); await seedBalance(w.list.id, -106.5);
  const tanpa = await catat(w, w.l, { materialId: w.list.id, qty: 20, satuan: "METER" }); assert.equal(tanpa.res.status, 400); assert.match(tanpa.res.body.error, /tidak cukup/); assert.equal(await saldo(w.list.id), -106.5);
  const pra = await w.l.post(PRA(w), { materialId: w.list.id, jenis: "TAMBAH", qty: 20, satuan: "METER", tanggalPemakaian: tgl(3), pengecualianStokTidakCukup: true });
  assert.equal(pra.body.stok.saldoSebelum, -106.5); assert.equal(pra.body.stok.saldoSesudah, -106.7222); assert.equal(pra.body.penghalang.length, 0); assert.equal(pra.body.peringatan[0].kode, "SALDO_MINUS");
  const r = await catat(w, w.l, { materialId: w.list.id, qty: 20, satuan: "METER", ...EXC }, { pra }); assert.equal(r.res.status, 201, JSON.stringify(r.res.body)); assert.equal(Math.round((await saldo(w.list.id)) * 10000) / 10000, -106.7222);
  const nol = await createTestMaterial({ code: `LIST-WIBING-NOL-${++seq}`, name: "LIST WIBING NOL", unit: "ROLL" }); await saldoNol(nol, 2);
  const r2 = await catat(w, w.l, { materialId: nol.id, qty: 3.4, satuan: "METER", ...EXC }, { pra: await w.l.post(PRA(w), { materialId: nol.id, jenis: "TAMBAH", qty: 3.4, satuan: "METER", tanggalPemakaian: tgl(3), pengecualianStokTidakCukup: true }) });
  assert.equal(r2.res.status, 201, JSON.stringify(r2.res.body)); assert.equal(await saldo(nol.id), -0.0378);
});

test("H13. katalog bahan membawa aturan satuan pakai; GET/PUT /satuan-pakai: hanya pengelola mengubah (alasan wajib, tercatat); penimpaan faktor memengaruhi pencatatan BARU saja", async () => {
  const w = await dunia(); const kat = await w.l.get(`/api/production/material-catalog?q=${encodeURIComponent(w.list.code)}`); const baris = kat.body.rows.find((r) => r.materialId === w.list.id);
  assert.deepEqual({ ...baris.satuanPakai }, { satuanStok: "ROLL", satuanPakai: "METER", faktor: 90, teks: "1 ROLL = 90 METER", sumber: "KEPUTUSAN_OWNER_2026_11_04" });
  const kain = (await w.l.get(`/api/production/material-catalog?q=${encodeURIComponent(w.kain.code)}`)).body.rows.find((r) => r.materialId === w.kain.id); assert.equal(kain.satuanPakai, null);
  assert.equal((await w.p.put("/api/production/satuan-pakai", { aturan: [], alasan: "uji tanpa izin untuk operator" })).status, 403);
  assert.equal((await w.l.put("/api/production/satuan-pakai", { aturan: [{ awalan: "LIST-WIBING", satuanStok: "ROLL", satuanPakai: "METER", faktor: 100 }], alasan: "pendek" })).status, 400);
  assert.equal((await w.l.put("/api/production/satuan-pakai", { aturan: [{ awalan: "LIST-WIBING", satuanStok: "ROLL", satuanPakai: "METER", faktor: 0 }], alasan: "faktor nol harus ditolak" })).status, 400);
  await seedBalance(w.list.id, 10, { unitCost: 1 });
  const ok = await w.l.put("/api/production/satuan-pakai", { aturan: [{ awalan: "LIST-WIBING", satuanStok: "ROLL", satuanPakai: "METER", faktor: 100 }], alasan: "Uji: ukur ulang panjang roll di Gudang" }); assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.berlaku.find((a) => a.awalan === "LIST-WIBING").faktor, 100); assert.equal(await testPrisma.activityEvent.count({ where: { eventType: "PRODUCTION_SETTING_CHANGED" } }), 1);
  const r = await catat(w, w.l, { materialId: w.list.id, qty: 10, satuan: "METER" }); assert.equal(r.res.status, 201, JSON.stringify(r.res.body)); assert.equal(Number((await testPrisma.stockMovement.findUnique({ where: { id: r.res.body.id } })).qty), -0.1, "faktor baru dipakai untuk pencatatan baru");
  assert.equal((await w.l.get("/api/production/satuan-pakai")).status, 200);
});

test("H14. pemakaian aktual unit memuat penanda pengecualian dan jumlah yang diketik (METER) pada riwayat; peran tanpa izin tidak melihat izin pengecualian", async () => {
  const w = await dunia(); await seedBalance(w.list.id, 0.1, { unitCost: 94350 });
  const pra = await w.l.post(PRA(w), { materialId: w.list.id, jenis: "TAMBAH", qty: 30, satuan: "METER", tanggalPemakaian: tgl(3), pengecualianStokTidakCukup: true });
  const r = await catat(w, w.l, { materialId: w.list.id, qty: 30, satuan: "METER", ...EXC }, { pra }); assert.equal(r.res.status, 201, JSON.stringify(r.res.body));
  const ad = (await w.l.get(`/api/production/units/${w.unit.id}/adopsi`)).body; const baris = ad.pemakaianAktual.baris.find((x) => x.id === r.res.body.id);
  assert.equal(baris.pengecualianStok.alasan, ALASAN); assert.deepEqual({ qty: baris.pakai.qty, satuan: baris.pakai.satuan, qtyStok: baris.pakai.qtyStok }, { qty: 30, satuan: "METER", qtyStok: 0.3333 }); assert.equal(ad.izin.pengecualianStokTidakCukup, true);
  assert.equal((await w.p.get(`/api/production/units/${w.unit.id}/adopsi`)).body.izin.pengecualianStokTidakCukup, false);
});
