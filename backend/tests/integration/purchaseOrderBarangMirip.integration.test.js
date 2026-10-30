// BARANG MIRIP pada Purchase Order Baru (Finance): varian JELAS berbeda tidak dipaksa alasan duplikasi; yang benar-benar sama diblokir dan diarahkan ke katalog; yang ambigu butuh keputusan;
// duplikat antar-baris dalam satu PO ditunjuk per baris; klik ganda dan penyimpanan bersamaan tetap konsisten; membuat SKU/PO TIDAK menambah stok atau jurnal (Harga Berlaku operasional otomatis dari PO sejak 30 Okt 2026).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const admin = await createTestUser({ roles: ["ADMIN"] }); const admin2 = await createTestUser({ roles: ["ADMIN"] });
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-MSB", name: "CV MITRA SEJAHTERA BAHAGIA" } });
  return { a: makeClient(server.baseUrl, admin.token), b: makeClient(server.baseUrl, admin2.token), supplier };
}
const mb = (nama, o = {}) => ({ nama, kategori: "Busa", jenis: "BAHAN_PRODUKSI", spesifikasi: null, satuanBeli: "SHEET", satuanStok: "SHEET", ...o });
const baris = (nama, q = 10, harga = 150_000, o = {}) => ({ materialBaru: mb(nama, o), qty: q, unitPrice: harga });
const po = (w, lines) => ({ supplierId: w.supplier.id, orderDate: hariIni(), lines });
const MSB = (d, g = "R58") => `BUSA REBONDED MSB ${d} ${g}`;
const DELAPAN = ["2CM", "4CM"].flatMap((t) => ["120X200", "160X200", "180X200", "200X200"].map((u) => MSB(`${u}X${t}`)));
const SIMPAN = "/api/finance/purchase-orders"; const CEK_PO = `${SIMPAN}/sku/cek-duplikat-po`; const CEK = `${SIMPAN}/sku/cek-duplikat`;
const jejak = async () => ({
  stok: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), baris: await testPrisma.finJournalLine.count(), harga: await testPrisma.materialHargaBerlaku.count(),
  material: await testPrisma.material.count(), po: await testPrisma.finPurchaseOrder.count(), katalog: await testPrisma.finSupplierMaterial.count(), origin: await testPrisma.finMaterialSkuOrigin.count(),
});

test("B1. DELAPAN VARIAN MSB R58 dalam satu PO tersimpan TANPA konfirmasi/alasan: varian berbeda tidak dipaksa; SKU, katalog, PO atomik; stok/jurnal/Harga Berlaku tidak tersentuh", async () => {
  const w = await dunia(); await createTestMaterial({ code: "BUS-007", name: "BUSA REBONDED OLYMPIC 120X200X2 D50", unit: "SHEET" }); const j0 = await jejak();
  const pv = await w.a.post(CEK_PO, { supplierId: w.supplier.id, barisBaru: DELAPAN.map((n, i) => ({ baris: i + 1, materialBaru: mb(n) })) });
  assert.equal(pv.status, 200, JSON.stringify(pv.body)); assert.equal(pv.body.bolehSimpan, true); assert.ok(pv.body.baris.every((r) => !r.diblokir && !r.perluKonfirmasi));
  assert.ok(pv.body.baris[7].berbeda.length >= 1, "varian lain tampil sebagai saran serupa (informasi)"); assert.ok(pv.body.baris[7].berbeda[0].perbedaan.length >= 1);
  assert.deepEqual(await jejak(), j0, "pratinjau baca-saja");
  const r = await w.a.post(SIMPAN, po(w, DELAPAN.map((n, i) => baris(n, 10 + i, 150_000, { kodeSupplier: `MSB-${i + 1}` }))));
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.lines.length, 8);
  const j1 = await jejak(); assert.equal(j1.material, j0.material + 8); assert.equal(j1.po, 1); assert.equal(j1.katalog, 8); assert.equal(j1.origin, 8);
  assert.equal(j1.stok, 0); assert.equal(j1.jurnal, 0); assert.equal(j1.baris, 0); assert.equal(j1.harga, 8, "aturan Owner 30 Okt: menyimpan PO otomatis memberi Harga Berlaku pertama untuk tiap barang baru (satu per bahan)"); assert.equal(await testPrisma.materialHargaBerlaku.count({ where: { reason: { startsWith: "Otomatis dari PO" } } }), 8);
  const asal = await testPrisma.finMaterialSkuOrigin.findMany({ include: { material: true } });
  assert.ok(asal.every((o) => o.duplicateOverrideReason === null && o.duplicateCandidates === null), "tidak ada override duplikat yang dipaksakan");
  assert.ok(asal.some((o) => Array.isArray(o.initialData?.varianSerupa) && o.initialData.varianSerupa.length >= 1), "varian serupa dicatat sebagai informasi");
  assert.equal(new Set(r.body.lines.map((l) => l.kode)).size, 8, "kode SKU 8 baris berbeda");
});

test("B2. DUPLIKAT PERSIS dan variasi penulisan (ejaan, spasi, ×/x/*, mm, urutan kata, kata satuan) diblokir dan diarahkan ke katalog; tidak ada yang tertulis", async () => {
  const w = await dunia(); const ada = await createTestMaterial({ code: "BUS-012", name: MSB("120X200X4CM"), unit: "SHEET" }); const j0 = await jejak();
  for (const v of [MSB("120X200X4CM"), "Busa Rebonded MSB 120 x 200 x 4 cm R58", "busa  rebonded  msb 120×200×4CM r58", "BUSA REBONDED MSB 120*200*4 CM R58", "busa rebonded msb 1200x2000x40mm r58", "BUSA REBONDED MSB R58 120X200X4", "BUSA REBONDED MSB 120X200X4CM R58 LEMBAR"]) {
    const pv = await w.a.post(CEK, { supplierId: w.supplier.id, materialBaru: mb(v) }); assert.equal(pv.status, 200); assert.equal(pv.body.bolehLanjut, false, v); assert.equal(pv.body.pasti[0].materialId, ada.id, v);
    const r = await w.a.post(SIMPAN, po(w, [baris(v)])); assert.equal(r.status, 409, v); assert.equal(r.body.code, "SKU_DUPLIKAT_PASTI", v); assert.equal(r.body.kandidat[0].kode, "BUS-012"); assert.equal(r.body.baris, 1);
  }
  assert.deepEqual(await jejak(), j0);
});

test("B3. AMBIGU butuh keputusan: ditolak tanpa konfirmasi (membawa nomor baris dan kandidat); dengan konfirmasi + alasan tersimpan; varian berbeda di daftar yang sama tidak ikut memaksa alasan", async () => {
  const w = await dunia(); await createTestMaterial({ code: "BUS-012", name: MSB("120X200X4CM"), unit: "SHEET" }); await createTestMaterial({ code: "BUS-009", name: MSB("120X200X2CM"), unit: "SHEET" });
  const ambigu = "BUSA REBONDED MSB R58"; // ukuran tidak tertulis
  const pv = await w.a.post(CEK, { supplierId: w.supplier.id, materialBaru: mb(ambigu) }); assert.equal(pv.status, 200);
  assert.equal(pv.body.perluKonfirmasi, true); assert.deepEqual(pv.body.mirip.map((c) => c.kode).sort(), ["BUS-009", "BUS-012"]); assert.match(pv.body.mirip[0].belumJelas.join(" "), /Ukuran tertulis di salah satu nama saja/);
  const j0 = await jejak(); const tolak = await w.a.post(SIMPAN, po(w, [baris("BUSA REBONDED MSB 160X200X2CM R58"), baris(ambigu)]));
  assert.equal(tolak.status, 409, JSON.stringify(tolak.body)); assert.equal(tolak.body.code, "SKU_MIRIP_BUTUH_KONFIRMASI"); assert.equal(tolak.body.baris, 2, "server menunjuk baris yang butuh keputusan"); assert.ok(tolak.body.kandidat.length >= 2);
  assert.deepEqual(await jejak(), j0, "gagal = tidak ada SKU/PO/katalog setengah jadi (baris 1 ikut dibatalkan)");
  const ok = await w.a.post(SIMPAN, po(w, [baris("BUSA REBONDED MSB 160X200X2CM R58"), baris(ambigu, 10, 150_000, { konfirmasiMirip: true, alasanMirip: "Barang berbeda: ukuran lain, bukan 120X200" })]));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const o = await testPrisma.finMaterialSkuOrigin.findFirst({ where: { materialId: ok.body.lines[1].materialId } }); assert.equal(o.duplicateOverrideReason, "Barang berbeda: ukuran lain, bukan 120X200"); assert.ok(o.duplicateCandidates.length >= 2);
  const o1 = await testPrisma.finMaterialSkuOrigin.findFirst({ where: { materialId: ok.body.lines[0].materialId } }); assert.equal(o1.duplicateOverrideReason, null, "baris varian jelas berbeda tanpa alasan paksaan");
});

test("B4. DUPLIKAT ANTAR-BARIS di satu PO ditunjuk per baris (SKU_DUPLIKAT_DALAM_PO) dan dapat dilihat SEBELUM simpan lewat cek-duplikat-po; ambigu antar-baris butuh konfirmasi pada baris kedua", async () => {
  const w = await dunia(); const j0 = await jejak();
  const kembar = [baris(MSB("120X200X4CM")), baris("Busa Rebonded MSB 120 x 200 x 4 cm R58")];
  const pv = await w.a.post(CEK_PO, { supplierId: w.supplier.id, barisBaru: kembar.map((l, i) => ({ baris: i + 1, materialBaru: l.materialBaru })) });
  assert.equal(pv.body.bolehSimpan, false); assert.equal(pv.body.baris[1].diblokir, true); assert.equal(pv.body.baris[1].dalamPO, true); assert.equal(pv.body.baris[1].pasti[0].dariBarisPO, 1); assert.equal(pv.body.baris[0].diblokir, false);
  const r = await w.a.post(SIMPAN, po(w, kembar)); assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, "SKU_DUPLIKAT_DALAM_PO"); assert.equal(r.body.baris, 2); assert.equal(r.body.barisSama, 1); assert.match(r.body.error, /Baris 2: sama dengan baris 1/);
  assert.deepEqual(await jejak(), j0, "tidak ada SKU baris 1 yang tertinggal");
  const amb = [baris("BUSA REBONDED MSB R58"), baris(MSB("120X200X4CM"))]; // baris 2 ambigu terhadap baris 1 (ukuran tidak tertulis di baris 1)
  const pv2 = await w.a.post(CEK_PO, { supplierId: w.supplier.id, barisBaru: amb.map((l, i) => ({ baris: i + 1, materialBaru: l.materialBaru })) }); assert.equal(pv2.body.baris[0].perluKonfirmasi, false); assert.equal(pv2.body.baris[1].perluKonfirmasi, true);
  const tolak = await w.a.post(SIMPAN, po(w, amb)); assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "SKU_MIRIP_BUTUH_KONFIRMASI"); assert.equal(tolak.body.baris, 2); assert.equal(tolak.body.kandidat[0].dariBarisPO, 1, "kandidat ditandai baris PO, bukan kode yang belum ada");
  const ok = await w.a.post(SIMPAN, po(w, [amb[0], baris(MSB("120X200X4CM"), 10, 150_000, { konfirmasiMirip: true, alasanMirip: "Baris 1 tanpa ukuran, ini yang 120X200X4" })])); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const pv3 = await w.a.post(CEK_PO, { supplierId: w.supplier.id, barisBaru: [{ baris: 1, materialBaru: amb[0].materialBaru }, { baris: 2, materialBaru: { ...amb[1].materialBaru, konfirmasiMirip: true, alasanMirip: "sudah diperiksa" } }] }); assert.equal(pv3.body.baris.length, 2);
});

test("B5. pratinjau satu barang memperhitungkan baris lain di form (barisLain) dan menolak masukan tidak valid", async () => {
  const w = await dunia();
  const pv = await w.a.post(CEK, { supplierId: w.supplier.id, materialBaru: mb(MSB("120X200X4CM")), barisLain: [{ baris: 3, nama: "busa rebonded msb 120 x 200 x 4cm r58", satuanStok: "SHEET" }, { baris: 4, nama: MSB("160X200X4CM"), satuanStok: "SHEET" }] });
  assert.equal(pv.status, 200, JSON.stringify(pv.body)); assert.equal(pv.body.bolehLanjut, false); assert.equal(pv.body.pasti[0].dariBarisPO, 3); assert.equal(pv.body.pasti[0].materialId, null); assert.equal(pv.body.berbeda[0].dariBarisPO, 4);
  assert.equal((await w.a.post(CEK, { supplierId: w.supplier.id, materialBaru: mb("X Y Z"), barisLain: [{ baris: 0, nama: "", satuanStok: "ZZ" }] })).status, 400);
});

test("B6. KLIK GANDA: Idempotency-Key sama + isi sama (paralel dan susulan) = SATU PO dan delapan SKU; isi berbeda dengan kunci sama ditolak", async () => {
  const w = await dunia(); const h = { "Idempotency-Key": `po-${randomUUID()}` }; const body = po(w, DELAPAN.map((n, i) => baris(n, 10, 150_000, { kodeSupplier: `K-${i}` })));
  const hasil = await Promise.all([w.a.post(SIMPAN, body, h), w.a.post(SIMPAN, body, h)]);
  assert.ok(hasil.every((x) => [200, 201, 409].includes(x.status)), hasil.map((x) => x.status).join()); assert.ok(hasil.some((x) => x.status === 201), "satu pemenang");
  const susulan = await w.a.post(SIMPAN, body, h); assert.ok([200, 201].includes(susulan.status), String(susulan.status)); assert.equal(susulan.body.id, hasil.find((x) => x.status === 201).body.id);
  assert.deepEqual([await testPrisma.finPurchaseOrder.count(), await testPrisma.material.count(), await testPrisma.finSupplierMaterial.count()], [1, 8, 8]);
  const beda = await w.a.post(SIMPAN, po(w, [baris("Pita Tepi 5 CM")]), h); assert.ok(beda.status >= 400, "kunci sama dengan isi lain ditolak"); assert.equal(await testPrisma.finPurchaseOrder.count(), 1);
});

test("B7. DUA PENGGUNA menyimpan barang yang sama BERSAMAAN (urutan baris berlawanan): tepat satu menang, tanpa deadlock/500, tanpa SKU ganda; yang kalah diarahkan ke katalog", async () => {
  const w = await dunia(); const X = MSB("120X200X4CM"); const Y = MSB("160X200X4CM");
  const [ra, rb] = await Promise.all([w.a.post(SIMPAN, po(w, [baris(X), baris(Y)])), w.b.post(SIMPAN, po(w, [baris("Busa Rebonded MSB 160 x 200 x 4 cm R58"), baris("busa rebonded msb 120×200×4CM r58")]))]);
  const st = [ra.status, rb.status].sort(); assert.deepEqual(st, [201, 409], JSON.stringify([ra.body, rb.body]));
  const kalah = ra.status === 409 ? ra : rb; assert.equal(kalah.body.code, "SKU_DUPLIKAT_PASTI"); assert.ok(kalah.body.kandidat[0].kode);
  assert.equal(await testPrisma.material.count(), 2); assert.equal(await testPrisma.finPurchaseOrder.count(), 1);
  // nama sama dengan ejaan berbeda diklik paralel oleh banyak pengguna
  await truncateAll(); const w2 = await dunia(); const varianTulis = ["Pita Tepi 5 CM", "pita  tepi 5 cm", "PITA TEPI 5CM", "Pita Tepi 5 cm LEMBAR"]; const lomba = await Promise.all(varianTulis.map((n, i) => (i % 2 ? w2.a : w2.b).post(SIMPAN, po(w2, [baris(n, 1, 10_000, { kategori: "Aksesori" })]))));
  assert.equal(lomba.filter((x) => x.status === 201).length, 1, JSON.stringify(lomba.map((x) => x.status))); assert.ok(lomba.every((x) => [201, 409].includes(x.status))); assert.equal(await testPrisma.material.count({ where: { name: { contains: "ita", mode: "insensitive" } } }), 1);
});

test("B8. aturan tetap: Finance non-Admin tidak bisa membuat SKU/cek-duplikat-po; membuat katalog/PO tidak menambah stok atau mengubah Harga Berlaku; PO draf tidak membuat jurnal; Harga Berlaku otomatis dari PO (aturan Owner)", async () => {
  const w = await dunia(); const fin = await createTestUser({ roles: ["FINANCE"] }); const f = makeClient(server.baseUrl, fin.token);
  assert.equal((await f.post(CEK_PO, { supplierId: w.supplier.id, barisBaru: [] })).status, 403); assert.equal((await f.post(SIMPAN, po(w, [baris(MSB("120X200X4CM"))]))).status, 403);
  const j0 = await jejak(); const r = await w.a.post(SIMPAN, po(w, DELAPAN.slice(0, 3).map((n) => baris(n)))); assert.equal(r.status, 201);
  const j1 = await jejak(); assert.equal(j1.stok, j0.stok); assert.equal(j1.jurnal, j0.jurnal); assert.equal(j1.harga, j0.harga + 3, "tiga barang baru ⇒ tiga Harga Berlaku pertama dari PO (aturan Owner 30 Okt)");
  assert.equal(await testPrisma.materialHargaBerlaku.count(), 3);
});

test("B9. DELAPAN MATERIAL YANG SUDAH ADA (BUS-008..015) tetap utuh: PO yang mengulang namanya (juga ejaan lain) ditolak per baris dan diarahkan ke kodenya; tidak dibuat ulang, diganti kode, digabung, atau dihapus; varian baru di sebelahnya tetap bisa disimpan", async () => {
  const w = await dunia(); const ada = [];
  for (const [i, n] of DELAPAN.entries()) ada.push(await createTestMaterial({ code: `BUS-0${String(8 + i).padStart(2, "0")}`, name: n, unit: "SHEET" }));
  const potret = async () => JSON.stringify(await testPrisma.material.findMany({ where: { code: { in: ada.map((m) => m.code) } }, orderBy: { code: "asc" } }));
  const p0 = await potret(); const j0 = await jejak();
  const ulang = DELAPAN.map((n, i) => (i % 2 ? n.replace(/ X/g, "x").toLowerCase() : n.replace(/(\d+)X(\d+)X(\d+)CM/, "$1 x $2 x $3 cm")));
  const pv = await w.a.post(CEK_PO, { supplierId: w.supplier.id, barisBaru: ulang.map((n, i) => ({ baris: i + 1, materialBaru: mb(n) })) });
  assert.equal(pv.status, 200); assert.equal(pv.body.bolehSimpan, false);
  assert.deepEqual(pv.body.baris.map((r) => r.pasti[0]?.kode), ada.map((m) => m.code), "setiap baris menunjuk kode material yang SAMA di katalog (bukan material lain)");
  const r = await w.a.post(SIMPAN, po(w, ulang.map((n) => baris(n)))); assert.equal(r.status, 409); assert.equal(r.body.code, "SKU_DUPLIKAT_PASTI"); assert.equal(r.body.baris, 1);
  assert.equal(await potret(), p0, "kode, nama, satuan, status, dan semua kolom 8 material tidak berubah"); assert.deepEqual(await jejak(), j0, "tidak ada material/PO/katalog/stok/jurnal baru");
  const baru = await w.a.post(SIMPAN, po(w, [baris(MSB("150X200X3CM"))])); assert.equal(baru.status, 201, JSON.stringify(baru.body));
  assert.equal(await potret(), p0, "menambah varian baru tidak menyentuh 8 material lama"); assert.equal(await testPrisma.material.count(), 9);
});

test("B10. GAGAL SIMPAN TIDAK MENINGGALKAN SETENGAH JADI: baris 1 varian baru yang sah + baris 2 duplikat (atau baris tak sah) ⇒ tidak ada material, katalog, asal-SKU, PO, stok, atau jurnal yang tersisa; setelah baris dibetulkan, simpan ulang berhasil utuh", async () => {
  const w = await dunia(); const ada = await createTestMaterial({ code: "BUS-012", name: MSB("120X200X4CM"), unit: "SHEET" }); const j0 = await jejak();
  const gagal = [
    [baris(MSB("150X200X3CM")), baris("Busa Rebonded MSB 120 x 200 x 4 cm R58")],
    [baris(MSB("150X200X3CM")), baris(MSB("150X200X5CM"), 0)],
    [baris(MSB("150X200X3CM")), baris(MSB("150X200X5CM"), 5, 150_000, { satuanBeli: "TIDAK_ADA" })],
  ];
  for (const [i, lines] of gagal.entries()) {
    const r = await w.a.post(SIMPAN, po(w, lines), { "Idempotency-Key": `po-gagal-${randomUUID()}` }); assert.ok(r.status >= 400 && r.status < 500, `kasus ${i}: ${r.status} ${JSON.stringify(r.body)}`);
    assert.deepEqual(await jejak(), j0, `kasus ${i}: tidak ada jejak setengah jadi`); assert.equal(await testPrisma.material.count({ where: { name: { contains: "150X200X3CM" } } }), 0, `kasus ${i}: baris 1 TIDAK tertinggal sebagai material`);
  }
  const kunci = `po-ulang-${randomUUID()}`; const lines = [baris(MSB("150X200X3CM")), baris(MSB("150X200X5CM"), 5)];
  const salah = await w.a.post(SIMPAN, po(w, [lines[0], baris("Busa Rebonded MSB 120 x 200 x 4 cm R58")]), { "Idempotency-Key": kunci }); assert.equal(salah.status, 409);
  const betul = await w.a.post(SIMPAN, po(w, lines), { "Idempotency-Key": kunci }); assert.equal(betul.status === 201 || betul.status === 422, true, `kunci yang gagal tidak mengunci selamanya: ${betul.status} ${JSON.stringify(betul.body)}`);
  if (betul.status === 201) { assert.equal(await testPrisma.finPurchaseOrder.count(), 1); assert.equal(await testPrisma.material.count(), 3); assert.equal(ada.code, "BUS-012"); }
});
