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

const URL_API = "/api/inventory/nilai-persediaan";
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
  await testPrisma.finSetting.create({ data: { key: "nilai_persediaan_pengamatan_fisik", value: JSON.stringify([{ kode: I.code, teks: "1 ROLL" }]) } });
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
test("V3. pengecualian: tidak pernah Rp0, tercatat di cakupan; saldo nol sah dipisah; nonaktif bersaldo ikut, nonaktif kosong tidak", async () => {
  const w = await dunia(); const r = await w.f.get(URL_API); const p = per(r.body);
  assert.equal(p.get(w.B.id).status, "HARGA_KOSONG"); assert.equal(p.get(w.B.id).nilai, null);
  assert.equal(p.get(w.C.id).status, "SALDO_MINUS"); assert.equal(p.get(w.C.id).nilai, null);
  assert.equal(p.get(w.D.id).status, "STOK_BELUM_DIKETAHUI"); assert.equal(p.get(w.D.id).saldo, null); assert.equal(p.get(w.D.id).nilai, null);
  assert.equal(p.get(w.E.id).status, "SALDO_NOL"); assert.equal(p.get(w.E.id).nilai, 0);
  assert.equal(p.get(w.F.id).status, "SATUAN_TIDAK_COCOK"); assert.equal(p.get(w.F.id).nilai, null);
  assert.equal(p.get(w.H.id).status, "DINILAI", "nonaktif tetapi bersaldo ikut"); assert.equal(p.has(w.G.id), false, "nonaktif tanpa saldo di luar universe");
  const c = r.body.cakupan; assert.equal(c.saldoNol, 1); assert.equal(c.dinilai, 2); assert.equal(c.pengecualian, 5); assert.equal(c.relevan, 7); assert.equal(c.universe, 8);
  assert.equal(Object.values(c.perStatus).reduce((a, v) => a + v, 0), c.universe);
  assert.equal(r.body.kartu.belumDinilai.jumlah, 5); assert.equal(r.body.kartu.estimasi.bahanRelevan, 7);
  assert.equal(r.body.kartu.estimasi.nilai, 15 * 6000 + 7 * 10, "total hanya dari yang DINILAI — pengecualian tidak masuk sebagai Rp0 maupun ditebak");
});
test("V4. pengamatan fisik (setelan): saldo sistem tampil, nilai null, tidak dikonversi; setelan rusak diabaikan dengan penanda", async () => {
  const w = await dunia(); let r = await w.f.get(URL_API); const b = per(r.body).get(w.I.id);
  assert.equal(b.status, "PENGAMATAN_FISIK"); assert.equal(b.saldo, 122); assert.equal(b.nilai, null); assert.equal(b.pengamatan, "1 ROLL"); assert.equal(r.body.pengamatanTerisi, 1);
  await testPrisma.finSetting.update({ where: { key: "nilai_persediaan_pengamatan_fisik" }, data: { value: "{bukan json" } });
  r = await w.f.get(URL_API); assert.equal(r.status, 200); assert.equal(r.body.pengamatanSetelanValid, false); assert.equal(per(r.body).get(w.I.id).status, "DINILAI", "tanpa pengamatan valid, bahan dinilai normal — tidak ada tebakan");
});
test("V5. nominal mengikuti izin: gudang (tanpa finance:read) melihat status & jumlah, TANPA harga/nilai/saldo akun; finance melihat semuanya; peran tanpa inventory:read ditolak", async () => {
  const w = await dunia(); const rg = await w.g.get(URL_API); assert.equal(rg.status, 200); assert.equal(rg.body.izin.nominal, false);
  assert.equal(rg.body.kartu.estimasi.nilai, null); assert.equal(rg.body.kartu.finance.saldo, null); assert.equal(rg.body.finance.saldo, null);
  const bg = per(rg.body).get(w.A.id); assert.equal(bg.status, "DINILAI"); assert.equal(bg.harga, null); assert.equal(bg.nilai, null); assert.equal(bg.saldo, 15, "kuantitas tetap terlihat");
  assert.ok(rg.body.finance.bukti.rincian.every((x) => x.biayaRata2 === null && x.hargaBerlaku === null)); assert.equal(rg.body.cakupan.dinilai, 2, "cakupan tetap tampil");
  assert.equal(per(rg.body).get(w.E.id).nilai, 0, "saldo nol sah tetap 0");
  const rf = await w.f.get(URL_API); assert.equal(rf.body.izin.nominal, true); assert.equal(per(rf.body).get(w.A.id).nilai, 90000);
  assert.equal((await w.s.get(URL_API)).status, 403);
});
test("V6. saldo akun Finance: terpisah dari estimasi, 'belum direkonsiliasi', tidak dialokasikan ke bahan, dengan sebab yang jelas", async () => {
  const w = await dunia(); const per1 = await testPrisma.$transaction(async (tx) => { const p = await resolveAccount(tx, SYSTEM_KEYS.PERSEDIAAN_BAHAN); const u = await resolveAccount(tx, SYSTEM_KEYS.UTANG_BELUM_DITAGIH);
    return postJournal(tx, { date: new Date(), description: "Penerimaan uji", source: "PENERIMAAN_BAHAN", sourceId: "gr-uji-1", idempotencyKey: "uji-gr-1", lines: [{ accountId: p.id, debit: 120000 }, { accountId: u.id, credit: 120000 }] }); });
  assert.equal(per1.created, true);
  const r = await w.f.get(URL_API); assert.equal(r.status, 200); const f = r.body.finance;
  assert.equal(f.tersedia, true); assert.equal(f.saldo, 120000); assert.equal(f.status, "BELUM_DIREKONSILIASI"); assert.equal(r.body.kartu.finance.saldo, 120000); assert.notEqual(r.body.kartu.finance.saldo, r.body.kartu.estimasi.nilai);
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
  const w = await dunia(); const s0 = await cacah(); for (let i = 0; i < 3; i++) { await w.f.get(URL_API); await w.g.get(URL_API); await w.f.get(`${URL_API}?waktu=${encodeURIComponent(new Date(sekarang() - 3 * HARI).toISOString())}`); }
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
