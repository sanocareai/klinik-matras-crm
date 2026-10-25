// HARGA BUKTI BAHAN (Stok → Bahan tanpa harga): daftar → pratinjau → ajukan → setujui (orang kedua) → koreksi valuasi append-only.
// Yang dikunci: (1) harga TIDAK otomatis (referensi/penerimaan terakhir hanya pembanding; pemakaian sebelum tanggal berlaku/di luar periode tidak tersentuh); (2) stok, ISSUE, catatan, valuasi beku asli, jurnal TIDAK berubah;
// (3) klik ulang/serentak = satu penerapan; (4) pratinjau basi ditolak; (5) satuan + faktor konversi; (6) TENTATIF ditandai dan dipisahkan dari nilai yang didukung bukti, GR belum terbukti ditandai otomatis; (7) penggantian/koreksi ulang; (8) izin.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { postStockMovement } from "../../src/services/inventoryLedger.js";
import { pratinjauHargaBukti, ajukanHargaBukti, setujuiHargaBukti, tolakHargaBukti, batalkanHargaBukti, daftarBahanTanpaHarga, daftarHargaBukti } from "../../src/services/finance/hargaBukti.js";
import { bacaJejakUnit } from "../../src/services/finance/biayaBahan.js";
import { koreksiValuasiPergerakan } from "../../src/services/finance/koreksiValuasi.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const WIB = (tgl, jam = "01:00:00") => new Date(`${tgl}T${jam}+08:00`);
let seq = 0; const kunci = (p = "hb") => `${p}-${Date.now()}-${++seq}-uji`;
const keluar = (materialId, unitId, qty, tgl, createdById) => testPrisma.$transaction((tx) => postStockMovement(tx, { materialId, type: "ISSUE", qty: -Math.abs(qty), unitId, reason: "uji", note: `pemakaian uji ${tgl}`, createdAt: WIB(tgl), createdById }));

async function dunia() {
  const finA = await createTestUser({ roles: ["FINANCE"] }); const finB = await createTestUser({ roles: ["FINANCE"] }); const admin = await createTestUser({ roles: ["ADMIN"] }); const gudang = await createTestUser({ roles: ["WAREHOUSE"] });
  const c = (u) => makeClient(server.baseUrl, u.token);
  const sp = await createTestMaterial({ code: "SPANBON-UJI", name: "SPANBON UJI", unit: "METER" }); const pe = await createTestMaterial({ code: "PE-ENC-UJI", name: "PE ENCASEMENT UJI", unit: "PCS" });
  await testPrisma.material.update({ where: { id: sp.id }, data: { referenceUnitCost: 6200, referenceUnitCostMonth: "2026-08" } }); await testPrisma.material.update({ where: { id: pe.id }, data: { referenceUnitCost: 24601, referenceUnitCostMonth: "2026-08" } });
  // saldo pembuka TANPA harga (opname 31 Agu) + penerimaan berharga 15 Okt hanya untuk SPANBON
  await testPrisma.stockMovement.create({ data: { materialId: sp.id, type: "ADJUSTMENT", qty: 100, note: "Stock Count UJI-BASELINE", createdAt: WIB("2026-09-01") } });
  await testPrisma.stockMovement.create({ data: { materialId: pe.id, type: "ADJUSTMENT", qty: 329, note: "Stock Count UJI-BASELINE", createdAt: WIB("2026-09-01") } });
  await testPrisma.stockMovement.create({ data: { materialId: sp.id, type: "RECEIPT", qty: 100, unitCost: 6700, note: "Simpan ke Stok GR-UJI", createdAt: WIB("2026-10-15") } });
  const mk = async () => (await createTestUnit()).unit; const u1 = await mk(); const u2 = await mk(); const u3 = await mk(); const u4 = await mk();
  const o = async (u, n) => { await testPrisma.order.update({ where: { id: u.orderId }, data: { orderNumber: n } }); };
  await o(u1, "UJI-ORD-001"); await o(u2, "UJI-ORD-002"); await o(u3, "UJI-ORD-003"); await o(u4, "UJI-ORD-004");
  const mvA = await keluar(sp.id, u1.id, 4, "2026-10-05", finA.user.id); // TANPA_HARGA (sebelum penerimaan berharga)
  const mvB = await keluar(sp.id, u2.id, 4, "2026-10-08", finA.user.id); // TANPA_HARGA
  const mvC = await keluar(sp.id, u3.id, 1, "2026-10-17", finA.user.id); // DINILAI (penerimaan 15 Okt, Rp6.700)
  const mvD = await keluar(sp.id, u4.id, 2, "2026-09-20", finA.user.id); // TANPA_HARGA tetapi di luar periode uji
  const mvP = await keluar(pe.id, u1.id, 4, "2026-10-06", finA.user.id); // PE: TANPA_HARGA
  return { finA, finB, admin, gudang, a: c(finA), b: c(finB), ad: c(admin), g: c(gudang), sp, pe, u1, u2, u3, u4, mvA, mvB, mvC, mvD, mvP };
}
const frek = async () => ({
  stok: await testPrisma.stockMovement.count(), saldo: JSON.stringify((await testPrisma.stockMovement.groupBy({ by: ["materialId"], _sum: { qty: true }, orderBy: { materialId: "asc" } })).map((r) => [r.materialId, String(r._sum.qty)])),
  jurnal: await testPrisma.finJournalEntry.count(), baris: await testPrisma.finJournalLine.count(), catatan: await testPrisma.unitUsageNote.count(), beku: JSON.stringify((await testPrisma.finStockMovementValuation.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, value: true, unitCostBasis: true } }))),
});
const masukanSP = (w, o = {}) => ({ materialId: w.sp.id, priceInput: 6500, inputUnit: "METER", validFrom: "2026-10-01", validTo: "2026-10-14", sourceKind: "NOTA_SUPPLIER", sourceRef: "NOTA-UJI-001", ...o });
const ajukan = async (w, m, aktor = w.finA.user) => { const p = await pratinjauHargaBukti(testPrisma, m); return { p, b: await ajukanHargaBukti(testPrisma, { ...m, hashPratinjau: p.hash }, { aktor, kunci: kunci() }) }; };

test("H1. daftar bahan tanpa harga: pemakaian diposting tanpa harga, siap posting, tertahan dipisah; referensi/penerimaan hanya pembanding (tidak jadi harga)", async () => {
  const w = await dunia(); const d = await daftarBahanTanpaHarga(testPrisma);
  const sp = d.find((x) => x.kode === "SPANBON-UJI"); const pe = d.find((x) => x.kode === "PE-ENC-UJI");
  assert.ok(sp && pe, JSON.stringify(d.map((x) => x.kode)));
  assert.equal(sp.diposting.dibekukanTanpaHarga, 3); assert.equal(sp.sebab, "PENERIMAAN_BERHARGA_SETELAH_TANGGAL_PEMAKAIAN"); assert.equal(sp.pembanding.referensi.harga, 6200); assert.match(sp.pembanding.referensi.catatan, /pembanding/);
  assert.equal(sp.diposting.tanggalAwal, "2026-09-20"); assert.equal(sp.diposting.tanggalAkhir, "2026-10-08"); assert.equal(pe.sebab, "HANYA_SALDO_PEMBUKA_TANPA_HARGA"); assert.equal(pe.diposting.dibekukanTanpaHarga, 1);
  assert.equal(sp.hargaBukti.length, 0, "tidak ada harga bukti sebelum diajukan");
});

test("H2. pratinjau: hanya periode + yang belum berharga; GR-berharga dikecualikan; luar periode tidak disentuh; per order nilai sebelum→sesudah; hash stabil; baca-saja", async () => {
  const w = await dunia(); const f0 = await frek();
  const p = await pratinjauHargaBukti(testPrisma, masukanSP(w));
  assert.equal(p.diposting.jumlah, 2); assert.equal(p.diposting.nilai, 52000); assert.deepEqual(p.diposting.baris.map((x) => x.order).sort(), ["UJI-ORD-001", "UJI-ORD-002"]);
  assert.equal(p.diluarPeriode, 2, "20 Sep dan 17 Okt di luar periode (17 Okt = penerimaan berharga)"); assert.equal(p.harga.perSatuanStok, 6500);
  const o1 = p.perOrder.find((x) => x.order === "UJI-ORD-001"); assert.equal(o1.nilaiSebelum, 0); assert.equal(o1.nilaiTambah, 26000); assert.equal(o1.nilaiSesudah, 26000); assert.match(o1.statusHppSesudah, /BELUM_FINAL/, "order UJI-ORD-001 masih punya PE tanpa harga");
  assert.equal(p.perOrder.find((x) => x.order === "UJI-ORD-002").sisaTanpaHarga, 0);
  assert.equal(p.pembanding.penerimaanTerakhir.harga, 6700); assert.match(p.pembanding.penerimaanTerakhir.catatan, /tidak berlaku mundur/);
  const luas = await pratinjauHargaBukti(testPrisma, masukanSP(w, { validFrom: "2026-09-01", validTo: null }));
  assert.equal(luas.diposting.jumlah, 3, "periode terbuka: 3 TANPA_HARGA"); assert.equal(luas.dikecualikan.jumlah, 1); assert.equal(luas.dikecualikan.baris[0].alasan, "SUDAH_PUNYA_HARGA_PEROLEHAN"); assert.equal(luas.dikecualikan.baris[0].order, "UJI-ORD-003");
  assert.equal((await pratinjauHargaBukti(testPrisma, masukanSP(w))).hash, p.hash, "hash stabil"); assert.deepEqual(await frek(), f0, "pratinjau tidak menulis apa pun");
  assert.ok(p.belumDiposting && p.tertahan, "bagian belum diposting dan tertahan tersedia");
});

test("H3. satuan: harga per satuan bukti ÷ faktor; satuan sama = faktor 1; satuan beda tanpa faktor ditolak; harga tak wajar terhadap referensi wajib keterangan", async () => {
  const w = await dunia();
  const per10 = await pratinjauHargaBukti(testPrisma, { materialId: w.pe.id, priceInput: 245000, inputUnit: "PAK (10 PCS)", faktor: 10, validFrom: "2026-10-01", sourceKind: "NOTA_SUPPLIER", sourceRef: "NOTA-PE-1" });
  assert.equal(per10.harga.perSatuanStok, 24500); assert.equal(per10.diposting.nilai, 98000); assert.equal(per10.harga.satuanBukti, "PAK (10 PCS)");
  await assert.rejects(() => pratinjauHargaBukti(testPrisma, { materialId: w.pe.id, priceInput: 245000, inputUnit: "PAK", validFrom: "2026-10-01", sourceKind: "NOTA_SUPPLIER", sourceRef: "N" }), (e) => e.code === "FAKTOR_WAJIB");
  await assert.rejects(() => pratinjauHargaBukti(testPrisma, { materialId: w.pe.id, priceInput: 24500, inputUnit: "pcs", faktor: 10, validFrom: "2026-10-01", sourceKind: "NOTA_SUPPLIER", sourceRef: "N" }), (e) => e.code === "FAKTOR_TIDAK_VALID");
  await assert.rejects(() => pratinjauHargaBukti(testPrisma, { materialId: w.pe.id, priceInput: 500000, inputUnit: "PCS", validFrom: "2026-10-01", sourceKind: "NOTA_SUPPLIER", sourceRef: "N" }), (e) => e.code === "KETERANGAN_WAJIB", "20× referensi tanpa keterangan");
  const ok = await pratinjauHargaBukti(testPrisma, { materialId: w.pe.id, priceInput: 500000, inputUnit: "PCS", validFrom: "2026-10-01", sourceKind: "LAINNYA", sourceNote: "Kesepakatan harga custom dengan supplier, email 3 Okt" });
  assert.ok(ok.peringatan.some((x) => x.kode === "HARGA_TIDAK_WAJAR_REFERENSI"));
  for (const buruk of [{ priceInput: 0 }, { priceInput: -1 }, { inputUnit: "" }, { validFrom: "01-10-2026" }, { validTo: "2026-09-01" }, { sourceKind: "XYZ" }, { sourceRef: "", sourceNote: "" }, { sourceKind: "LAINNYA", sourceRef: "x", sourceNote: "" }, { certainty: "TENTATIF" }])
    await assert.rejects(() => pratinjauHargaBukti(testPrisma, { materialId: w.pe.id, priceInput: 24500, inputUnit: "PCS", validFrom: "2026-10-01", sourceKind: "NOTA_SUPPLIER", sourceRef: "N", ...buruk }), (e) => !!e.code, JSON.stringify(buruk));
});

test("H4. ajukan: butuh hash pratinjau yang benar; idempoten per kunci; tidak menulis apa pun selain pengajuan (stok, saldo, catatan, valuasi beku, jurnal sama); tanpa transaksi ditolak", async () => {
  const w = await dunia(); const f0 = await frek(); const m = masukanSP(w); const p = await pratinjauHargaBukti(testPrisma, m);
  await assert.rejects(() => ajukanHargaBukti(testPrisma, { ...m, hashPratinjau: "salah" }, { aktor: w.finA.user, kunci: kunci() }), (e) => e.code === "PRATINJAU_BERUBAH");
  const k = kunci(); const a = await ajukanHargaBukti(testPrisma, { ...m, hashPratinjau: p.hash }, { aktor: w.finA.user, kunci: k }); assert.equal(a.status, "DIAJUKAN"); assert.equal(a.ulang, false); assert.equal(a.pratinjau.transaksi, 2); assert.equal(a.pratinjau.nilai, 52000);
  const b = await ajukanHargaBukti(testPrisma, { ...m, hashPratinjau: p.hash }, { aktor: w.finA.user, kunci: k }); assert.equal(b.ulang, true); assert.equal(b.id, a.id); assert.equal(await testPrisma.finMaterialPriceEvidence.count(), 1);
  await assert.rejects(() => ajukanHargaBukti(testPrisma, { ...masukanSP(w, { materialId: w.pe.id }), hashPratinjau: "x" }, { aktor: w.finA.user, kunci: k }), (e) => e.code === "KUNCI_DIPAKAI_LAIN");
  await assert.rejects(() => ajukanHargaBukti(testPrisma, { ...m, hashPratinjau: p.hash }, { aktor: w.finA.user, kunci: "pendek" }), (e) => e.code === "IDEMPOTENCY_KEY_REQUIRED");
  assert.deepEqual(await frek(), f0, "mengajukan tidak mengubah stok/saldo/catatan/valuasi/jurnal"); assert.equal(await testPrisma.finStockMovementValuationCorrection.count(), 0, "belum ada nilai sampai disetujui");
  await assert.rejects(() => ajukan(w, masukanSP(w, { validFrom: "2026-10-16", validTo: "2026-10-16", priceInput: 6600 })), (e) => e.code === "TIDAK_ADA_TRANSAKSI");
});

test("H5. setujui: pengaju ≠ penyetuju; penerapan = satu baris koreksi per transaksi (append-only); stok/saldo/catatan/valuasi beku/jurnal TIDAK berubah; klik ulang & serentak = satu penerapan", async () => {
  const w = await dunia(); const { b } = await ajukan(w, masukanSP(w)); const f0 = await frek();
  await assert.rejects(() => setujuiHargaBukti(testPrisma, { id: b.id, hashPratinjau: b.pratinjau.hash, aktor: w.finA.user }), (e) => e.code === "PEMOHON_SAMA" && e.statusCode === 403);
  await assert.rejects(() => setujuiHargaBukti(testPrisma, { id: b.id, hashPratinjau: "salah", aktor: w.finB.user }), (e) => e.code === "PRATINJAU_BERBEDA");
  assert.equal(await testPrisma.finStockMovementValuationCorrection.count(), 0);
  const hasil = await Promise.allSettled([1, 2, 3].map(() => setujuiHargaBukti(testPrisma, { id: b.id, hashPratinjau: b.pratinjau.hash, aktor: w.finB.user, catatan: "uji" })));
  assert.ok(hasil.every((x) => x.status === "fulfilled"), JSON.stringify(hasil.filter((x) => x.status === "rejected").map((x) => x.reason?.message))); assert.equal(hasil.filter((x) => x.value.ulang === false).length, 1, "tepat satu yang menerapkan");
  const kor = await testPrisma.finStockMovementValuationCorrection.findMany({ orderBy: { createdAt: "asc" } }); assert.equal(kor.length, 2); assert.ok(kor.every((k) => k.evidenceId === b.id && k.tentative === false && Number(k.unitCostBasis) === 6500));
  assert.deepEqual(kor.map((k) => Number(k.value)).sort(), [26000, 26000]); assert.ok(kor.every((k) => k.createdById === w.finB.user.id)); assert.equal(kor[0].before.status, "TANPA_HARGA"); assert.equal(kor[0].after.sumber, "HARGA_BUKTI");
  const f1 = await frek(); assert.deepEqual(f1, f0, "stok, saldo, catatan, valuasi beku asli, jurnal tidak berubah"); assert.equal((await testPrisma.finMaterialPriceEvidence.findUnique({ where: { id: b.id } })).status, "DISETUJUI");
  const ulang = await setujuiHargaBukti(testPrisma, { id: b.id, hashPratinjau: b.pratinjau.hash, aktor: w.finB.user }); assert.equal(ulang.ulang, true); assert.equal(await testPrisma.finStockMovementValuationCorrection.count(), 2, "klik ulang tidak menggandakan");
  await assert.rejects(() => tolakHargaBukti(testPrisma, { id: b.id, aktor: w.finB.user, catatan: "terlambat" }), (e) => e.code === "STATUS_FINAL");
});

test("H6. jejak biaya: nilai tampil dengan penanda harga bukti; HPP unit; transaksi lain tidak disentuh; sisa tanpa harga tetap terlihat; jurnal tetap BELUM_DIJURNAL", async () => {
  const w = await dunia(); const { b } = await ajukan(w, masukanSP(w)); await setujuiHargaBukti(testPrisma, { id: b.id, hashPratinjau: b.pratinjau.hash, aktor: w.finB.user });
  const j2 = await bacaJejakUnit(testPrisma, w.u2.id, { izinHarga: true }); const sp2 = j2.bahan.find((x) => x.kode === "SPANBON-UJI").pergerakan[0];
  assert.equal(sp2.status, "DINILAI"); assert.equal(sp2.nilai, 26000); assert.equal(sp2.hargaDasar, 6500); assert.equal(sp2.hargaBukti, b.id); assert.equal(sp2.hargaManual, true); assert.equal(sp2.tentatif, null); assert.equal(sp2.jurnal, "BELUM_DIJURNAL");
  assert.equal(j2.ringkasan.biayaPersediaan.nilai, 26000); assert.equal(j2.ringkasan.biayaPersediaan.nilaiTentatif, 0); assert.equal(j2.ringkasan.biayaPersediaan.nilaiDidukungBukti, 26000);
  const j1 = await bacaJejakUnit(testPrisma, w.u1.id, { izinHarga: true }); assert.equal(j1.ringkasan.jumlahTanpaHarga, 1, "PE di UJI-ORD-001 masih tanpa harga"); assert.ok(j1.belumFinal.some((x) => x.jenis === "TANPA_HARGA" && x.kode === "PE-ENC-UJI"));
  const j3 = await bacaJejakUnit(testPrisma, w.u3.id, { izinHarga: true }); assert.equal(j3.ringkasan.biayaPersediaan.nilai, 6700, "GR-berharga tidak berubah");
  const j4 = await bacaJejakUnit(testPrisma, w.u4.id, { izinHarga: true }); assert.equal(j4.ringkasan.jumlahTanpaHarga, 1, "di luar periode tetap tanpa harga");
  const tanpaIzin = await bacaJejakUnit(testPrisma, w.u2.id, { izinHarga: false }); assert.equal(tanpaIzin.bahan[0].pergerakan[0].nilai, null); assert.equal(tanpaIzin.ringkasan.biayaPersediaan.nilaiTentatif, null);
});

test("H7. pratinjau basi: transaksi baru pada periode atau harga bergeser sesudah diajukan → setujui ditolak (409), nol penerapan", async () => {
  const w = await dunia(); const { b } = await ajukan(w, masukanSP(w));
  await keluar(w.sp.id, w.u4.id, 1, "2026-10-09", w.finA.user.id); // transaksi TANPA_HARGA baru di dalam periode
  await assert.rejects(() => setujuiHargaBukti(testPrisma, { id: b.id, hashPratinjau: b.pratinjau.hash, aktor: w.finB.user }), (e) => e.code === "PRATINJAU_BERUBAH" && /sudah bergeser/.test(e.message));
  assert.equal(await testPrisma.finStockMovementValuationCorrection.count(), 0); assert.equal((await testPrisma.finMaterialPriceEvidence.findUnique({ where: { id: b.id } })).status, "DIAJUKAN");
  const t = await tolakHargaBukti(testPrisma, { id: b.id, aktor: w.finB.user, catatan: "pratinjau basi, ajukan ulang" }); assert.equal(t.status, "DITOLAK");
  const { b: b2 } = await ajukan(w, masukanSP(w)); assert.equal(b2.pratinjau.transaksi, 3);
});

test("H8. TENTATIF: ditandai di jejak, dipisahkan dari nilai didukung bukti, tetap BELUM_FINAL; versi TERBUKTI menggantikan (baris lama tetap terbaca); koreksi ulang harga = nilai terakhir berlaku", async () => {
  const w = await dunia(); const m = { materialId: w.pe.id, priceInput: 24601, inputUnit: "PCS", validFrom: "2026-09-01", sourceKind: "KESEPAKATAN", sourceRef: "EMAIL-SUPPLIER-3OKT", certainty: "TENTATIF", tentativeReason: "Nota asli belum diterima; harga dari email supplier" };
  const { b } = await ajukan(w, m); await setujuiHargaBukti(testPrisma, { id: b.id, hashPratinjau: b.pratinjau.hash, aktor: w.finB.user });
  let j = await bacaJejakUnit(testPrisma, w.u1.id, { izinHarga: true }); const pe = j.bahan.find((x) => x.kode === "PE-ENC-UJI").pergerakan[0];
  assert.equal(pe.nilai, 98404); assert.equal(pe.tentatif.sebab, "HARGA_BUKTI_TENTATIF"); assert.match(pe.tentatif.alasan, /email supplier/);
  assert.equal(j.ringkasan.biayaPersediaan.nilaiTentatif, 98404); assert.equal(j.ringkasan.biayaPersediaan.nilaiDidukungBukti, 0); assert.ok(j.belumFinal.some((x) => x.jenis === "HARGA_TENTATIF" && x.kode === "PE-ENC-UJI")); assert.notEqual(j.statusBiaya, "FINAL_MENURUT_HARGA_PO"); assert.equal(j.ringkasan.parsial, true);
  assert.equal((await testPrisma.finStockMovementValuationCorrection.findMany()).every((k) => k.tentative === true && /email supplier/.test(k.tentativeReason)), true);
  // versi TERBUKTI menggantikan
  const m2 = { ...m, priceInput: 24000, sourceKind: "NOTA_SUPPLIER", sourceRef: "NOTA-ASLI-77", certainty: "TERBUKTI", tentativeReason: null, replacesId: b.id };
  const { b: b2, p: p2 } = await ajukan(w, m2); assert.equal(p2.diposting.penggantian, 1); assert.equal(p2.diposting.baris[0].keadaan, "DIGANTI_DARI_BUKTI_LAMA"); assert.equal(p2.diposting.baris[0].sebelumTentatif, true);
  await setujuiHargaBukti(testPrisma, { id: b2.id, hashPratinjau: b2.pratinjau.hash, aktor: w.finB.user });
  j = await bacaJejakUnit(testPrisma, w.u1.id, { izinHarga: true }); const pe2 = j.bahan.find((x) => x.kode === "PE-ENC-UJI").pergerakan[0];
  assert.equal(pe2.nilai, 96000); assert.equal(pe2.tentatif, null); assert.equal(j.ringkasan.biayaPersediaan.nilaiTentatif, 0); assert.equal(j.ringkasan.biayaPersediaan.nilaiDidukungBukti, 96000);
  assert.equal(await testPrisma.finStockMovementValuationCorrection.count({ where: { movementId: w.mvP.id } }), 2, "baris lama tetap ada (append-only)"); assert.equal((await testPrisma.finMaterialPriceEvidence.findUnique({ where: { id: b.id } })).status, "DIGANTI");
  assert.deepEqual((await daftarHargaBukti(testPrisma, { materialId: w.pe.id })).map((x) => x.status).sort(), ["DIGANTI", "DISETUJUI"]);
  // koreksi harga ulang (dikoreksi lagi) — yang terakhir berlaku
  const { b: b3 } = await ajukan(w, { ...m2, priceInput: 23000, sourceRef: "NOTA-REVISI-78", replacesId: b2.id }); await setujuiHargaBukti(testPrisma, { id: b3.id, hashPratinjau: b3.pratinjau.hash, aktor: w.finB.user });
  j = await bacaJejakUnit(testPrisma, w.u1.id, { izinHarga: true }); assert.equal(j.bahan.find((x) => x.kode === "PE-ENC-UJI").pergerakan[0].nilai, 92000); assert.equal(await testPrisma.finStockMovementValuationCorrection.count({ where: { movementId: w.mvP.id } }), 3);
});

test("H9. GR yang kedatangannya belum tercatat ditandai TENTATIF otomatis (tanpa data tambahan) dan hilang sendiri setelah kedatangan dicatat", async () => {
  const w = await dunia(); const bahan = await createTestMaterial({ code: "HR-UJI", name: "HR FOAM UJI", unit: "KG" }); const { unit } = await createTestUnit();
  const gr = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-UJI-03", sourceType: "PURCHASE_ORDER", status: "COMPLETED", supplier: "ASEP", createdById: w.finA.user.id } });
  await testPrisma.stockMovement.create({ data: { materialId: bahan.id, type: "RECEIPT", qty: 100, unitCost: 34000, goodsReceiptId: gr.id, note: "Simpan ke Stok GR-UJI-03", createdAt: WIB("2026-10-09") } });
  await keluar(bahan.id, unit.id, 2.2, "2026-10-14", w.finA.user.id);
  let j = await bacaJejakUnit(testPrisma, unit.id, { izinHarga: true }); let r = j.bahan[0].pergerakan[0];
  assert.equal(r.status, "DINILAI"); assert.equal(r.nilai, 74800); assert.equal(r.tentatif.sebab, "GR_KEDATANGAN_BELUM_TERBUKTI"); assert.deepEqual(r.tentatif.gr, ["GR-UJI-03"]);
  assert.equal(j.ringkasan.biayaPersediaan.nilaiTentatif, 74800); assert.equal(j.ringkasan.biayaPersediaan.nilaiDidukungBukti, 0); assert.ok(j.belumFinal.some((x) => x.jenis === "HARGA_TENTATIF")); assert.notEqual(j.statusBiaya, "FINAL_MENURUT_HARGA_PO");
  await testPrisma.goodsReceipt.update({ where: { id: gr.id }, data: { arrivedDate: new Date("2026-10-09"), arrivalReceiver: "IMAM", arrivalNote: "Barang diterima baik (uji)", arrivalWorkspace: "GUDANG", arrivalRevision: 1, arrivalRecordedAt: new Date("2026-10-26T01:00:00Z") } });
  j = await bacaJejakUnit(testPrisma, unit.id, { izinHarga: true }); r = j.bahan[0].pergerakan[0]; assert.equal(r.tentatif, null); assert.equal(j.ringkasan.biayaPersediaan.nilaiTentatif, 0); assert.equal(j.ringkasan.biayaPersediaan.nilaiDidukungBukti, 74800);
});

test("H10. periode tumpang tindih ditolak; batalkan hanya pengaju; tolak butuh alasan dan orang lain; koreksi manual per pergerakan tidak ditimpa", async () => {
  const w = await dunia(); const { b } = await ajukan(w, masukanSP(w));
  await assert.rejects(() => pratinjauHargaBukti(testPrisma, masukanSP(w, { priceInput: 6400 })).then((p) => ajukanHargaBukti(testPrisma, { ...masukanSP(w, { priceInput: 6400 }), hashPratinjau: p.hash }, { aktor: w.finA.user, kunci: kunci() })), (e) => e.code === "PERIODE_TUMPANG_TINDIH");
  await assert.rejects(() => batalkanHargaBukti(testPrisma, { id: b.id, aktor: w.finB.user }), (e) => e.code === "BUKAN_PEMOHON");
  await assert.rejects(() => tolakHargaBukti(testPrisma, { id: b.id, aktor: w.finA.user, catatan: "sendiri" }), (e) => e.code === "PEMOHON_SAMA");
  await assert.rejects(() => tolakHargaBukti(testPrisma, { id: b.id, aktor: w.finB.user, catatan: "x" }), (e) => e.code === "ALASAN_WAJIB");
  const bt = await batalkanHargaBukti(testPrisma, { id: b.id, aktor: w.finA.user }); assert.equal(bt.status, "DIBATALKAN"); assert.equal((await batalkanHargaBukti(testPrisma, { id: b.id, aktor: w.finA.user })).ulang, true);
  await koreksiValuasiPergerakan(testPrisma, { movementId: w.mvA.id, hargaBaru: 6000, alasan: "Koreksi manual uji", kunci: kunci("man"), aktor: w.finA.user });
  const p = await pratinjauHargaBukti(testPrisma, masukanSP(w)); assert.equal(p.diposting.jumlah, 1); const x = p.dikecualikan.baris.find((r) => r.order === "UJI-ORD-001"); assert.equal(x.alasan, "SUDAH_DIKOREKSI_MANUAL");
});

test("H11. HTTP: daftar/pratinjau (baca), ajukan (finance:post), setujui (orang lain; finance:approve); gudang/sales ditolak; kesalahan kembali dengan kode", async () => {
  const w = await dunia(); const f0 = await frek();
  const d = await w.a.get("/api/finance/biaya-bahan/harga-bukti/bahan-tanpa-harga"); assert.equal(d.status, 200); assert.ok(d.body.bahan.some((x) => x.kode === "SPANBON-UJI"));
  assert.equal((await w.g.get("/api/finance/biaya-bahan/harga-bukti/bahan-tanpa-harga")).status, 403); assert.equal((await w.g.post("/api/finance/biaya-bahan/harga-bukti/pratinjau", masukanSP(w))).status, 403);
  const p = await w.a.post("/api/finance/biaya-bahan/harga-bukti/pratinjau", masukanSP(w)); assert.equal(p.status, 200); assert.equal(p.body.diposting.jumlah, 2); assert.ok(!("_baris" in p.body) && !("_unitCost" in p.body) && !("_m" in p.body), "bidang internal tidak bocor");
  assert.equal((await w.a.post("/api/finance/biaya-bahan/harga-bukti", { ...masukanSP(w), hashPratinjau: p.body.hash })).status, 428, "tanpa Idempotency-Key");
  const k = kunci("http"); const aj = await w.a.post("/api/finance/biaya-bahan/harga-bukti", { ...masukanSP(w), hashPratinjau: p.body.hash }, { "Idempotency-Key": k }); assert.equal(aj.status, 201, JSON.stringify(aj.body));
  const aj2 = await w.a.post("/api/finance/biaya-bahan/harga-bukti", { ...masukanSP(w), hashPratinjau: p.body.hash }, { "Idempotency-Key": k }); assert.ok([200, 201].includes(aj2.status), "klik ulang: balasan tersimpan (middleware idempotensi) atau 200"); assert.equal(aj2.body.id, aj.body.id); assert.equal(await testPrisma.finMaterialPriceEvidence.count(), 1);
  const sendiri = await w.a.post(`/api/finance/biaya-bahan/harga-bukti/${aj.body.id}/setujui`, { hashPratinjau: aj.body.pratinjau.hash }); assert.equal(sendiri.status, 403); assert.equal(sendiri.body.code, "PEMOHON_SAMA");
  assert.equal((await w.g.post(`/api/finance/biaya-bahan/harga-bukti/${aj.body.id}/setujui`, { hashPratinjau: aj.body.pratinjau.hash })).status, 403);
  const ok = await w.b.post(`/api/finance/biaya-bahan/harga-bukti/${aj.body.id}/setujui`, { hashPratinjau: aj.body.pratinjau.hash, catatan: "uji" }); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.diterapkan, 2);
  const det = await w.a.get(`/api/finance/biaya-bahan/harga-bukti/${aj.body.id}`); assert.equal(det.status, 200); assert.equal(det.body.koreksi.length, 2); assert.equal(det.body.status, "DISETUJUI");
  const dl = await w.a.get("/api/finance/biaya-bahan/harga-bukti"); assert.equal(dl.body.hargaBukti.length, 1);
  const f1 = await frek(); assert.deepEqual(f1, f0, "stok, saldo, catatan, valuasi beku, jurnal tidak berubah lewat HTTP");
  assert.equal((await w.a.get("/api/finance/biaya-bahan/harga-bukti/bukan-uuid")).status, 404);
  const exp = await w.a.get("/api/finance/biaya-bahan/unit/" + w.u2.id); assert.equal(exp.status, 200); assert.equal(exp.body.bahan[0].pergerakan[0].hargaBukti, aj.body.id);
});
