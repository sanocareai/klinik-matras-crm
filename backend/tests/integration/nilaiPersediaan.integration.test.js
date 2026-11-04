// NILAI PERSEDIAAN (kandidat laporan baca-saja): rute asli + DB uji. Yang dikunci: satu waktu acuan untuk saldo DAN Harga Berlaku · pengecualian tidak pernah Rp0 · saldo akun Finance terpisah, "belum direkonsiliasi",
// tidak dialokasikan ke bahan · nominal mengikuti izin finance:read · pengamatan fisik dari setelan (tanpa konversi) · tidak ada tulisan apa pun (stok/harga/jurnal/PSA/GR tidak berubah).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, resolveAccount, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal } from "../../src/services/finance/journal.js";
import { postStockMovement } from "../../src/services/inventoryLedger.js";
import { hargaBerlakuBanyak } from "../../src/services/finance/hargaBerlaku.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const URL_API = "/api/inventory/nilai-persediaan"; const HASIL = "/api/inventory/nilai-persediaan/hasil-so";
const HARI = 86_400_000; const sekarang = () => Date.now();
let n = 0;
const mv = (materialId, type, qty, createdAt, extra = {}) => testPrisma.$transaction((tx) => postStockMovement(tx, { materialId, type, qty, createdAt, ...extra }));
// CHECK DB material_harga_berlaku_tanpa_mundur_chk: waktu efektif tidak boleh mendahului waktu dibuat (tanpa tanggal mundur) → baris uji masa lalu dibuat dengan createdAt = effectiveFrom.
const harga = (materialId, unitPrice, satuan, effectiveFrom, extra = {}) => testPrisma.materialHargaBerlaku.create({ data: { materialId, unitPrice, satuan, effectiveFrom: new Date(effectiveFrom), createdAt: new Date(Math.min(effectiveFrom, Date.now())), reason: "Harga uji", idempotencyKey: `uji-${++n}-${materialId}`, ...extra } });
const cacah = async () => ({ stok: await testPrisma.stockMovement.count(), harga: await testPrisma.materialHargaBerlaku.count(), jurnal: await testPrisma.finJournalEntry.count(), baris: await testPrisma.finJournalLine.count(), gr: await testPrisma.goodsReceipt.count(), adj: await testPrisma.stockAdjustmentRequest.count(), opening: await testPrisma.finInventoryOpening.count(), setelan: await testPrisma.finSetting.count() });

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const fin = await createTestUser({ roles: ["FINANCE"] }); const gudang = await createTestUser({ roles: ["WAREHOUSE"] }); const sales = await createTestUser({ roles: ["SALES"] });
  const m = (kode, unit = "KG", o = {}) => createTestMaterial({ code: `${kode}-${++n}`, name: `Bahan ${kode}`, unit, ...o });
  const A = await m("A"), B = await m("B"), C = await m("C"), D = await m("D"), E = await m("E"), F = await m("F", "METER"), G = await m("G", "KG", { active: false }), H = await m("H", "KG", { active: false }), I = await m("I", "METER");
  const t0 = sekarang() - 10 * HARI;
  await mv(A.id, "RECEIPT", 10, new Date(t0), { unitCost: 4000 }); await mv(A.id, "RECEIPT", 5, new Date(sekarang() - 2 * HARI), { unitCost: 4200 });
  await harga(A.id, 5000, "KG", t0); await harga(A.id, 6000, "KG", sekarang() - 1 * HARI); await harga(A.id, 9000, "KG", sekarang() + 3 * HARI); // terjadwal: tidak boleh dipakai sekarang
  await mv(B.id, "RECEIPT", 5, new Date(t0)); // harga kosong
  await testPrisma.stockMovement.create({ data: { materialId: C.id, type: "ISSUE", qty: -4, createdAt: new Date(t0), note: "minus historis (uji)" } }); await harga(C.id, 100, "KG", t0);
  // D: tanpa catatan stok sama sekali, ber-harga
  await harga(D.id, 777, "KG", t0);
  await mv(E.id, "RECEIPT", 3, new Date(t0)); await mv(E.id, "ISSUE", -3, new Date(t0 + HARI)); await harga(E.id, 250, "KG", t0);
  await mv(F.id, "RECEIPT", 20, new Date(t0)); await harga(F.id, 1000, "ROLL", t0); // satuan harga ≠ satuan stok
  await mv(H.id, "RECEIPT", 7, new Date(t0)); await harga(H.id, 10, "KG", t0); // nonaktif tetapi bersaldo → ikut
  await mv(I.id, "RECEIPT", 122, new Date(t0)); await harga(I.id, 35500, "METER", t0); // dijadikan pengamatan fisik
  const c = (u) => makeClient(server.baseUrl, u.token);
  return { fin, gudang, sales, f: c(fin), g: c(gudang), s: c(sales), A, B, C, D, E, F, G, H, I, t0 };
}
const per = (r) => new Map(r.baris.map((b) => [b.materialId, b]));

test("V1. satu waktu acuan: saldo sekarang & harga sekarang; harga terjadwal tidak dipakai; 15 × 6.000 = 90.000", async () => {
  const w = await dunia(); const r = await w.f.get(URL_API); assert.equal(r.status, 200, JSON.stringify(r.body)); const b = per(r.body).get(w.A.id);
  assert.equal(b.status, "DINILAI"); assert.equal(b.saldo, 15); assert.equal(b.harga.nilai, 6000, "harga berlaku sekarang, bukan 9.000 yang terjadwal"); assert.equal(b.nilai, 90000);
  assert.ok(Math.abs(new Date(r.body.waktuAcuan).getTime() - new Date(r.body.waktuHitung).getTime()) < 5000);
});
test("V2. waktu acuan lampau menggeser saldo DAN harga bersamaan (5 hari lalu: 10 × 5.000)", async () => {
  const w = await dunia(); const iso = new Date(sekarang() - 5 * HARI).toISOString(); const r = await w.f.get(`${URL_API}?waktu=${encodeURIComponent(iso)}`); assert.equal(r.status, 200); const b = per(r.body).get(w.A.id);
  assert.equal(b.saldo, 10); assert.equal(b.harga.nilai, 5000); assert.equal(b.nilai, 50000); assert.equal(r.body.waktuAcuan, iso);
  const sblm = new Date(w.t0 - HARI).toISOString(); const r2 = await w.f.get(`${URL_API}?waktu=${encodeURIComponent(sblm)}`); assert.equal(per(r2.body).get(w.A.id).status, "STOK_BELUM_DIKETAHUI", "sebelum catatan pertama = belum diketahui, bukan 0");
});
test("V3. pengecualian (I = METER tanpa hasil SO tercatat → dinilai biasa): tidak pernah Rp0, tercatat di cakupan; saldo nol sah dipisah; nonaktif bersaldo ikut, nonaktif kosong tidak", async () => {
  const w = await dunia(); const r = await w.f.get(URL_API); const p = per(r.body);
  assert.equal(p.get(w.B.id).status, "HARGA_KOSONG"); assert.equal(p.get(w.B.id).nilai, null);
  assert.equal(p.get(w.C.id).status, "SALDO_MINUS"); assert.equal(p.get(w.C.id).nilai, null);
  assert.equal(p.get(w.D.id).status, "STOK_BELUM_DIKETAHUI"); assert.equal(p.get(w.D.id).saldo, null); assert.equal(p.get(w.D.id).nilai, null);
  assert.equal(p.get(w.E.id).status, "SALDO_NOL"); assert.equal(p.get(w.E.id).nilai, 0);
  assert.equal(p.get(w.F.id).status, "SATUAN_TIDAK_COCOK"); assert.equal(p.get(w.F.id).nilai, null);
  assert.equal(p.get(w.H.id).status, "DINILAI", "nonaktif tetapi bersaldo ikut"); assert.equal(p.has(w.G.id), false, "nonaktif tanpa saldo di luar universe");
  const c = r.body.cakupan; assert.equal(c.saldoNol, 1); assert.equal(c.dinilai, 3); assert.equal(c.pengecualian, 4); assert.equal(c.relevan, 7); assert.equal(c.universe, 8);
  assert.equal(Object.values(c.perStatus).reduce((a, v) => a + v, 0), c.universe);
  assert.equal(r.body.kartu.belumDinilai.jumlah, 4); assert.equal(r.body.kartu.estimasi.bahanRelevan, 7);
  assert.equal(r.body.kartu.estimasi.nilaiLedger, 15 * 6000 + 7 * 10 + 122 * 35500, "total hanya dari yang DINILAI — pengecualian tidak masuk sebagai Rp0 maupun ditebak");
});
test("V4. terukur dalam satuan lain lewat jalur pencatatan: saldo sistem tampil, nilai null, estimasi ledger terpisah dari estimasi tanpa hasil SO bermasalah", async () => {
  const w = await dunia(); const t0 = await w.g.get(URL_API); assert.equal(per(t0.body).get(w.I.id).status, "DINILAI", "tanpa hasil SO tercatat bahan dinilai dari ledger");
  const cat = await w.g.post(HASIL, { baris: [{ materialId: w.I.id, jenis: "PENGAMATAN_SATUAN", jumlah: 1, satuan: "ROLL", soTanggal: "2026-11-04", sumber: "KIRIM GILANG.xlsx O5", alasan: "Hasil SO terukur dalam roll" }] }, { "Idempotency-Key": "uji-v4-0001" }); assert.equal(cat.status, 201, JSON.stringify(cat.body));
  const r = await w.f.get(URL_API); const b = per(r.body).get(w.I.id);
  assert.equal(b.status, "PENGAMATAN_FISIK"); assert.equal(b.saldo, 122); assert.equal(b.nilai, null); assert.equal(b.pengamatan, "1 ROLL"); assert.equal(b.hasilSOBermasalah, true); assert.equal(b.hasilSO.pelaku, w.gudang.user.name); assert.equal(b.hasilSO.sumber, "KIRIM GILANG.xlsx O5");
  assert.ok(b.keterangan.includes("Terukur dalam ROLL: 1 ROLL")); assert.ok(b.keterangan.includes("belum terukur dalam satuan stok (METER)")); assert.equal(b.nilaiLedger, 122 * 35500);
  const e = r.body.kartu.estimasi; assert.equal(e.nilaiLedger, 15 * 6000 + 7 * 10 + 122 * 35500); assert.equal(e.nilaiTanpaHasilSOBermasalah, 15 * 6000 + 7 * 10, "tanpa hasil SO bermasalah: pengamatan ROLL dikecualikan"); assert.equal(e.bahanHasilSOBermasalah, 1); assert.equal(e.nilaiHasilSOBermasalah, 122 * 35500);
  assert.equal(e.status, "BELUM_DIREKONSILIASI_DENGAN_HASIL_SO"); assert.match(e.catatan, /bukan hasil stok fisik final/);
});
test("V5. nominal mengikuti izin: gudang (tanpa finance:read) melihat status & jumlah, TANPA harga/nilai/saldo akun; finance melihat semuanya; peran tanpa inventory:read ditolak", async () => {
  const w = await dunia(); const rg = await w.g.get(URL_API); assert.equal(rg.status, 200); assert.equal(rg.body.izin.nominal, false);
  assert.equal(rg.body.kartu.estimasi.nilaiLedger, null); assert.equal(rg.body.kartu.estimasi.nilaiTanpaHasilSOBermasalah, null); assert.equal(rg.body.finance.nilaiParsial.nilai, null); assert.ok(rg.body.finance.nilaiParsial.bahanDenganBiaya >= 1); assert.equal(rg.body.kartu.finance.saldo, null); assert.equal(rg.body.finance.saldo, null);
  const bg = per(rg.body).get(w.A.id); assert.equal(bg.status, "DINILAI"); assert.equal(bg.harga, null); assert.equal(bg.nilai, null); assert.equal(bg.saldo, 15, "kuantitas tetap terlihat");
  assert.ok(rg.body.finance.bukti.rincian.every((x) => x.biayaRata2 === null && x.hargaBerlaku === null)); assert.equal(rg.body.cakupan.dinilai, 3, "cakupan tetap tampil"); assert.ok(rg.body.izin.peranPelihatNominal.includes("FINANCE") && !rg.body.izin.peranPelihatNominal.includes("WAREHOUSE"));
  assert.equal(per(rg.body).get(w.E.id).nilai, 0, "saldo nol sah tetap 0");
  const rf = await w.f.get(URL_API); assert.equal(rf.body.izin.nominal, true); assert.equal(per(rf.body).get(w.A.id).nilai, 90000);
  assert.equal((await w.s.get(URL_API)).status, 403);
});
test("V6. saldo akun Finance: terpisah dari estimasi, 'belum direkonsiliasi', tidak dialokasikan ke bahan, dengan sebab yang jelas", async () => {
  const w = await dunia(); const per1 = await testPrisma.$transaction(async (tx) => { const p = await resolveAccount(tx, SYSTEM_KEYS.PERSEDIAAN_BAHAN); const u = await resolveAccount(tx, SYSTEM_KEYS.UTANG_BELUM_DITAGIH);
    return postJournal(tx, { date: new Date(), description: "Penerimaan uji", source: "PENERIMAAN_BAHAN", sourceId: "gr-uji-1", idempotencyKey: "uji-gr-1", lines: [{ accountId: p.id, debit: 120000 }, { accountId: u.id, credit: 120000 }] }); });
  assert.equal(per1.created, true);
  const r = await w.f.get(URL_API); assert.equal(r.status, 200); const f = r.body.finance;
  assert.equal(f.tersedia, true); assert.equal(f.saldo, 120000); assert.equal(f.status, "BELUM_DIREKONSILIASI"); assert.equal(r.body.kartu.finance.saldo, 120000); assert.notEqual(r.body.kartu.finance.saldo, r.body.kartu.estimasi.nilaiLedger);
  assert.equal(f.perSumber.length, 1); assert.equal(f.perSumber[0].sumber, "PENERIMAAN_BAHAN"); assert.equal(f.jurnal, 1);
  assert.ok(f.alasan.some((a) => /Persediaan Awal belum diposting/.test(a))); assert.ok(f.alasan.some((a) => /tidak dialokasikan ke bahan/i.test(a))); assert.ok(f.alasan.some((a) => /tanpa bukti harga/.test(a)));
  assert.ok(f.alasan.some((a) => /berbeda Rp/.test(a)), "selisih terhadap biaya penerimaan ledger (Rp 40.000+ dari A) ditunjukkan");
  assert.equal(f.bukti.rincian.some((x) => "nilaiAlokasi" in x || "bagianSaldoAkun" in x), false, "tidak ada alokasi saldo akun per bahan");
  assert.ok(Math.abs(f.pembandingLedger.totalBiayaPenerimaanBerharga - (10 * 4000 + 5 * 4200)) < 1); assert.ok(Math.abs(f.pembandingLedger.selisihDenganSaldoAkun - (120000 - 61000)) < 1);
  const a = f.bukti.rincian.find((x) => x.materialId === w.A.id); assert.equal(a.qtyBerbukti, 15); assert.equal(a.qtyTanpaBukti, 0); assert.ok(Math.abs(a.biayaRata2 - 4066.6667) < 0.001); assert.equal(a.hargaBerlaku, 6000);
  const b = f.bukti.rincian.find((x) => x.materialId === w.B.id); assert.equal(b.qtyTanpaBukti, 5, "bahan tanpa penerimaan berharga = gap penuh, bukan nilai");
});
test("V7. tanpa akun/jurnal: laporan tetap jalan, status jujur", async () => {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx)); const fin = await createTestUser({ roles: ["FINANCE"] }); const m = await createTestMaterial({ code: `Z-${++n}`, name: "Z", unit: "KG" });
  const r = await makeClient(server.baseUrl, fin.token).get(URL_API); assert.equal(r.status, 200); assert.equal(r.body.finance.saldo, 0); assert.equal(r.body.finance.jurnal, 0); assert.equal(per(r.body).get(m.id).status, "STOK_BELUM_DIKETAHUI");
});
test("V8. masukan waktu: tanpa zona / tidak valid / masa depan ditolak (400)", async () => {
  const w = await dunia(); for (const q of ["2026-11-04", "2026-11-04T10:00:00", "besok", encodeURIComponent(new Date(sekarang() + 2 * HARI).toISOString())]) { const r = await w.f.get(`${URL_API}?waktu=${q}`); assert.equal(r.status, 400, q); assert.ok(r.body.code); }
});
test("V9. BACA-SAJA: stok, harga, jurnal, GR, penyesuaian, PSA, setelan tidak berubah setelah banyak permintaan", async () => {
  const w = await dunia(); await w.g.post(HASIL, { baris: [{ materialId: w.D.id, jenis: "NOL_DIKONFIRMASI", jumlah: 0, soTanggal: "2026-11-04", sumber: "uji", alasan: "Nol dikonfirmasi pada SO" }] }, { "Idempotency-Key": "uji-v9-0001" }); const s0 = await cacah(); for (let i = 0; i < 3; i++) { await w.f.get(URL_API); await w.g.get(URL_API); await w.f.get(`${URL_API}?waktu=${encodeURIComponent(new Date(sekarang() - 3 * HARI).toISOString())}`); }
  assert.deepEqual(await cacah(), s0);
});
test("V10. konsisten dengan layanan Harga Berlaku yang sudah ada (hargaBerlakuBanyak): harga & mulai berlaku sama", async () => {
  const w = await dunia(); const at = new Date(); const peta = await hargaBerlakuBanyak(testPrisma, [w.A.id, w.E.id, w.H.id, w.I.id], at); const r = await w.f.get(`${URL_API}?waktu=${encodeURIComponent(at.toISOString())}`);
  for (const id of [w.A.id, w.E.id, w.H.id, w.I.id]) { const b = per(r.body).get(id); assert.equal(b.harga.nilai, peta.get(id).harga); assert.equal(new Date(b.harga.berlakuSejak).getTime(), new Date(peta.get(id).berlakuMulai).getTime()); }
});
test("V11. harga otomatis dari PO ditandai sumber PO dan hanya menggerakkan estimasi (tidak mengubah jurnal/valuasi)", async () => {
  const w = await dunia(); await harga(w.B.id, 1234, "KG", sekarang() - HARI, { idempotencyKey: `po-harga:abc:${w.B.id}:r1`, reason: "Dari PO PO-UJI — belum diterima" });
  const j0 = await testPrisma.finJournalEntry.count(); const r = await w.f.get(URL_API); const b = per(r.body).get(w.B.id);
  assert.equal(b.status, "DINILAI"); assert.equal(b.harga.sumber, "PO"); assert.equal(b.nilai, 5 * 1234); assert.equal(r.body.cakupan.dariPO, 1); assert.equal(await testPrisma.finJournalEntry.count(), j0);
  assert.equal(r.body.finance.bukti.rincian.find((x) => x.materialId === w.B.id).qtyTanpaBukti, 5, "harga PO bukan bukti Finance: tetap gap di rincian Finance");
});

const so = (c, baris, kunci = `uji-${++n}-${Date.now()}`, def) => c.post(HASIL, { baris, ...(def ? { default: def } : {}) }, { "Idempotency-Key": kunci });
const baris1 = (m, o = {}) => ({ materialId: m.id, jenis: "PENGAMATAN_SATUAN", jumlah: 13.5, satuan: "ROLL", soTanggal: "2026-11-04", sumber: "KIRIM GILANG.xlsx O4", alasan: "Hasil SO terukur dalam roll", ...o });

test("H1. izin: hanya pemegang inventory:write yang mencatat (WAREHOUSE ya; FINANCE tanpa inventory:write 403; SALES 403); baca butuh inventory:read", async () => {
  const w = await dunia(); assert.equal((await so(w.g, [baris1(w.I)])).status, 201); assert.equal((await so(w.f, [baris1(w.F, { satuan: "ROLL" })])).status, 403, "FINANCE tidak punya inventory:write"); assert.equal((await so(w.s, [baris1(w.F)])).status, 403);
  assert.equal((await w.f.get(`${HASIL}/${w.I.id}`)).status, 200); assert.equal((await w.s.get(`${HASIL}/${w.I.id}`)).status, 403);
});
test("H2. jejak audit lengkap: sumber, tanggal SO, pelaku, satuan, jumlah, alasan, saldo ledger saat dicatat; ledger/harga/jurnal/ADJUSTMENT/fin_settings TIDAK tersentuh", async () => {
  const w = await dunia(); const s0 = await cacah(); const r = await so(w.g, [baris1(w.I, { soWaktu: "2026-11-04T18:00:00+07:00" })]); assert.equal(r.status, 201, JSON.stringify(r.body));
  const rw = (await w.f.get(`${HASIL}/${w.I.id}`)).body.riwayat; assert.equal(rw.length, 1); const h = rw[0];
  assert.equal(h.jenis, "PENGAMATAN_SATUAN"); assert.equal(h.jumlah, 13.5); assert.equal(h.satuan, "ROLL"); assert.equal(h.soTanggal, "2026-11-04"); assert.equal(h.soWaktu, "2026-11-04T11:00:00.000Z"); assert.equal(h.sumber, "KIRIM GILANG.xlsx O4"); assert.equal(h.alasan, "Hasil SO terukur dalam roll"); assert.equal(h.pelaku.id, w.gudang.user.id); assert.equal(h.saldoLedgerSaatDicatat, 122); assert.equal(h.satuanStok, "METER");
  assert.deepEqual(await cacah(), s0, "tidak ada stok/harga/jurnal/GR/ADJUSTMENT/PSA/setelan baru"); assert.equal(await testPrisma.stockAdjustmentRequest.count(), 0);
  const ev = await testPrisma.activityEvent.findMany({ where: { entityType: "hasil_so_bahan" } }); assert.equal(ev.length, 1); assert.equal(ev[0].eventType, "SO_HASIL_DICATAT"); assert.equal(await testPrisma.finSetting.count(), 0, "tidak menulis fin_settings");
});
test("H3. validasi: satuan sama dengan stok ditolak (pakai Koreksi Saldo); jenis nol harus 0; sumber/alasan wajib; tanggal masa depan; jam tanpa zona; jumlah tak valid; bahan ganda", async () => {
  const w = await dunia(); const k = async (b, kode) => { const r = await so(w.g, [b]); assert.ok(r.status >= 400 && r.status < 500, `${kode}: ${r.status} ${JSON.stringify(r.body)}`); assert.equal(r.body.code, kode); };
  await k(baris1(w.F, { satuan: "METER" }), "SATUAN_SAMA_DENGAN_STOK"); await k({ ...baris1(w.F), jenis: "NOL_DIKONFIRMASI", jumlah: 3 }, "JUMLAH_HARUS_NOL"); await k(baris1(w.F, { sumber: "x" }), "SUMBER_WAJIB"); await k(baris1(w.F, { alasan: "pendek" }), "ALASAN_WAJIB");
  await k(baris1(w.F, { soTanggal: "2999-01-01" }), "TANGGAL_SO_MASA_DEPAN"); await k(baris1(w.F, { soTanggal: "04-11-2026" }), "TANGGAL_SO_WAJIB"); await k(baris1(w.F, { soWaktu: "2026-11-04T18:00:00" }), "JAM_SO_TIDAK_VALID"); await k(baris1(w.F, { jumlah: -1 }), "JUMLAH_TIDAK_VALID"); await k(baris1(w.F, { jumlah: 0 }), "JUMLAH_PENGAMATAN_NOL"); await k(baris1(w.F, { jenis: "LAIN" }), "JENIS_TIDAK_VALID");
  const dobel = await so(w.g, [baris1(w.F), baris1(w.F)]); assert.equal(dobel.status, 400); assert.equal(dobel.body.code, "BAHAN_GANDA"); assert.equal((await so(w.g, [baris1(w.F)], "pendek")).status, 428);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "hasil_so_bahan" } }), 0, "permintaan ditolak tidak meninggalkan catatan");
});
test("H4. idempoten & koreksi append-only: kunci sama = satu catatan; isi beda dengan kunci sama 409; catatan kedua tanpa menggantikanId 409; koreksi menunjuk catatan terkini; riwayat menyimpan semuanya", async () => {
  const w = await dunia(); const a = await so(w.g, [baris1(w.I)], "uji-h4-aaaa"); assert.equal(a.status, 201); const ulang = await so(w.g, [baris1(w.I)], "uji-h4-aaaa"); assert.equal(ulang.status, 200); assert.equal(ulang.body.ulang, 1); assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "hasil_so_bahan" } }), 1);
  assert.equal((await so(w.g, [baris1(w.I, { jumlah: 14 })], "uji-h4-aaaa")).body.code, "KUNCI_DIPAKAI_LAIN");
  const dua = await so(w.g, [baris1(w.I, { jumlah: 14 })], "uji-h4-bbbb"); assert.equal(dua.status, 409); assert.equal(dua.body.code, "SUDAH_ADA_HASIL_SO");
  const id1 = a.body.hasil[0].id; const salah = await so(w.g, [baris1(w.I, { jumlah: 14, menggantikanId: "00000000-0000-4000-8000-000000000000" })], "uji-h4-cccc"); assert.equal(salah.status, 409);
  const kor = await so(w.g, [baris1(w.I, { jumlah: 14, alasan: "Dihitung ulang: 14 roll", menggantikanId: id1 })], "uji-h4-dddd"); assert.equal(kor.status, 201, JSON.stringify(kor.body));
  const rw = (await w.f.get(`${HASIL}/${w.I.id}`)).body.riwayat; assert.equal(rw.length, 2); assert.equal(rw[0].jumlah, 13.5); assert.equal(rw[1].jumlah, 14); assert.equal(rw[1].menggantikanId, id1); assert.equal(rw[1].koreksi, true); assert.equal(rw[1].terkini, true); assert.equal(rw[0].terkini, false);
  const r = await w.f.get(URL_API); assert.equal(per(r.body).get(w.I.id).pengamatan, "14 ROLL", "laporan memakai catatan terkini"); assert.equal(per(r.body).get(w.I.id).hasilSO.revisi, 2);
});
test("H5. nol dikonfirmasi: bahan TANPA ledger berlabel 'fisik nol dikonfirmasi, belum tercatat sebagai hasil SO'; bahan dengan ledger berisi ditandai bermasalah dan dikecualikan dari estimasi 'tanpa hasil SO bermasalah'; tidak ada ledger/ADJUSTMENT baru", async () => {
  const w = await dunia(); const stok0 = await testPrisma.stockMovement.count();
  const r0 = await so(w.g, [{ materialId: w.D.id, jenis: "NOL_DIKONFIRMASI", jumlah: 0, satuan: "APA SAJA", soTanggal: "2026-11-04", sumber: "KIRIM GILANG.xlsx baris 6", alasan: "Sel kosong = sudah dicek, fisik nol" }, { materialId: w.A.id, jenis: "NOL_DIKONFIRMASI", jumlah: 0, soTanggal: "2026-11-04", sumber: "KIRIM GILANG.xlsx baris 7", alasan: "Sel kosong = sudah dicek, fisik nol" }]); assert.equal(r0.status, 201, JSON.stringify(r0.body)); assert.equal(r0.body.hasil.find((x) => x.materialId === w.D.id).satuan, "KG", "satuan nol dipaksa = satuan stok");
  const r = await w.f.get(URL_API); const d = per(r.body).get(w.D.id), a = per(r.body).get(w.A.id);
  assert.equal(d.status, "STOK_BELUM_DIKETAHUI"); assert.equal(d.nilai, null); assert.match(d.keterangan, /Fisik nol dikonfirmasi/); assert.match(d.keterangan, /belum tercatat sebagai hasil SO di ledger/); assert.match(d.keterangan, /bukan "sudah sesuai"/); assert.equal(d.hasilSOBermasalah, false);
  assert.equal(a.status, "DINILAI"); assert.equal(a.hasilSOBermasalah, true); assert.equal(a.nilai, 90000, "tetap berbasis ledger"); assert.match(a.keterangan, /selisih belum direkonsiliasi/);
  const e = r.body.kartu.estimasi; assert.equal(e.nilaiLedger - e.nilaiTanpaHasilSOBermasalah, 90000); assert.equal(e.bahanHasilSOBermasalah, 1); assert.equal(r.body.kartu.belumDinilai.nolDikonfirmasiBelumDiLedger, 1);
  assert.equal(await testPrisma.stockMovement.count(), stok0, "tidak ada ledger/ADJUSTMENT nol atau palsu"); assert.equal(await testPrisma.stockAdjustmentRequest.count(), 0);
});
test("H6. bulk satu transaksi: baris dengan galat membatalkan semuanya; nilai default dipakai bersama; batas 300 baris", async () => {
  const w = await dunia(); const bagus = baris1(w.F), buruk = baris1(w.I, { satuan: "METER" });
  const gagal = await so(w.g, [bagus, buruk]); assert.equal(gagal.status, 422); assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "hasil_so_bahan" } }), 0, "semua-atau-tidak-sama-sekali");
  const ok = await so(w.g, [{ materialId: w.F.id, jenis: "PENGAMATAN_SATUAN", jumlah: 2, satuan: "ROLL" }, { materialId: w.I.id, jenis: "PENGAMATAN_SATUAN", jumlah: 1, satuan: "ROLL" }], undefined, { soTanggal: "2026-11-04", sumber: "KIRIM GILANG.xlsx", alasan: "Hasil SO terukur dalam roll" }); assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.baru, 2);
  const banyak = await so(w.g, Array.from({ length: 301 }, () => baris1(w.F))); assert.equal(banyak.status, 400); assert.equal(banyak.body.code, "BARIS_TIDAK_VALID");
});
test("H7. serentak untuk bahan yang sama: satu catatan saja", async () => {
  const w = await dunia(); const hasil = await Promise.all([so(w.g, [baris1(w.I)], "uji-h7-aaaa"), so(w.g, [baris1(w.I)], "uji-h7-bbbb"), so(w.g, [baris1(w.I)], "uji-h7-cccc")]);
  assert.equal(hasil.filter((r) => r.status === 201).length, 1, JSON.stringify(hasil.map((r) => r.status))); assert.equal(hasil.filter((r) => r.status === 409).length, 2); assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "hasil_so_bahan" } }), 1);
});
test("H8. nilai parsial (KPI lama) hanya di rincian Finance dengan definisi; tidak ada di kartu utama", async () => {
  const w = await dunia(); const r = await w.f.get(URL_API); const p = r.body.finance.nilaiParsial; assert.ok(p.definisi.includes("biaya penerimaan terakhir")); assert.ok(p.bahanDenganBiaya >= 1); assert.equal(typeof p.nilai, "number"); assert.ok(!JSON.stringify(r.body.kartu).includes("nilaiParsial"));
  assert.equal(p.nilai, 15 * 4200, "A: 15 × biaya penerimaan terakhir (4.200); bahan lain tanpa biaya penerimaan");
});
