// HARGA BERLAKU OTOMATIS DARI PO (Okt 2026): persetujuan PO memperbarui Harga Berlaku operasional lewat layanan resmi, di transaksi yang sama.
// Yang dikunci: draf tidak mengubah harga · harga sama/naik/turun · satuan & konversi sah (tanpa faktor = konflik, bukan tebakan) · konflik tidak memilih baris terakhir · persetujuan gagal ⇒ PO tetap draf ·
// klik ganda/retry/persetujuan bersamaan tidak membuat harga ganda · revisi = riwayat baru · pembatalan tidak menghapus/mengembalikan harga · ubah harga manual & harga terjadwal tetap jalan ·
// stok/valuasi Finance/jurnal tidak berubah · izin (Admin tanpa peran harga tidak bisa menyetujui PO yang mengubah harga) · saklar mati · PO historis tidak diproses.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { pratinjauUbahHarga, simpanHarga } from "../../src/services/finance/hargaBerlaku.js";
import { rencanaHargaPO, terapkanHargaPO, hargaStokBaris } from "../../src/services/finance/hargaDariPO.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); delete process.env.HARGA_DARI_PO; delete process.env.HARGA_DARI_PO_STRICT; });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const BASE = "/api/finance/purchase-orders";
const HB = "/api/finance/biaya-bahan/harga-berlaku";
let n = 0;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const owner = await createTestUser({ roles: ["OWNER"] });
  const gudang = await createTestUser({ roles: ["WAREHOUSE"] });
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: `SUP-${++n}`, name: `PT UJI ${n}` } });
  const lem = await createTestMaterial({ code: `LEM-UJI-${n}`, name: "LEM UJI", unit: "KG" });
  const busa = await createTestMaterial({ code: `BUSA-UJI-${n}`, name: "BUSA UJI", unit: "SHEET" });
  const paku = await createTestMaterial({ code: `PAKU-UJI-${n}`, name: "PAKU UJI", unit: "PCS" });
  return { fin, admin, owner, gudang, f: c(fin), a: c(admin), o: c(owner), g: c(gudang), supplier, lem, busa, paku };
}
const buatPO = async (w, lines, cli = w.f) => {
  const r = await cli.post(BASE, { supplierId: w.supplier.id, orderDate: hariIni(), expectedDate: hariIni(), notes: "uji", lines });
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body;
};
const hargaAwal = async (w, mat, harga) => {
  const m = { materialId: mat.id, hargaBaru: String(harga), satuan: mat.unit, alasan: "Harga awal uji PO", berlakuMulai: null };
  const p = await pratinjauUbahHarga(testPrisma, m); return simpanHarga(testPrisma, { ...m, hashPratinjau: p.hash }, { aktor: w.fin.user, kunci: `uji-awal-${randomUUID()}` });
};
const baris = (materialId) => testPrisma.materialHargaBerlaku.findMany({ where: { materialId }, orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }] });
const semuaHarga = () => testPrisma.materialHargaBerlaku.count();
const snap = async () => ({
  stok: await testPrisma.stockMovement.count(), valFin: await testPrisma.finStockMovementValuation.count(), jurnal: await testPrisma.finJournalEntry.count(), baris: await testPrisma.finJournalLine.count(),
  biayaOp: await testPrisma.stockMovementBiayaOperasional.count(), catatan: await testPrisma.unitUsageNote.count(),
});
const riwayat = async (w, mat) => (await w.f.get(`${HB}/bahan/${mat.id}/riwayat`)).body.riwayat;

test("P1. draf tidak mengubah harga: buat, ubah draf, dan pratinjau tidak menulis apa pun", async () => {
  const w = await dunia(); const s0 = await snap();
  const po = await buatPO(w, [{ materialId: w.lem.id, qty: 5, unitPrice: 50_000 }]);
  assert.equal(await semuaHarga(), 0);
  const u = await w.f.patch(`${BASE}/${po.id}`, { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 6, unitPrice: 52_000 }] });
  assert.equal(u.status, 200, JSON.stringify(u.body)); assert.equal(await semuaHarga(), 0);
  const pr = await w.f.get(`${BASE}/${po.id}/pratinjau-harga`); assert.equal(pr.status, 200);
  assert.equal(pr.body.baris[0].status, "BARU"); assert.equal(pr.body.baris[0].hargaBaru, 52_000); assert.equal(pr.body.baris[0].hargaLama, null);
  assert.match(pr.body.sumberTeks, /^Dari PO PO-.* — belum diterima$/); assert.equal(await semuaHarga(), 0); assert.deepEqual(await snap(), s0);
});

test("P2. persetujuan: harga bahan BARU menjadi Harga Berlaku efektif saat persetujuan, bersumber PO; stok/valuasi/jurnal tidak berubah; riwayat menampilkan sumber", async () => {
  const w = await dunia(); const po = await buatPO(w, [{ materialId: w.lem.id, qty: 5, unitPrice: 50_000 }]); const s0 = await snap();
  const pr = (await w.f.get(`${BASE}/${po.id}/pratinjau-harga`)).body;
  const t0 = Date.now(); const ap = await w.f.post(`${BASE}/${po.id}/approve`, { hashPratinjau: pr.hash }); assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.equal(ap.body.status, "DISETUJUI"); assert.equal(ap.body.hargaDariPO.diterapkan.length, 1);
  const r = await baris(w.lem.id); assert.equal(r.length, 1);
  assert.equal(Number(r[0].unitPrice), 50_000); assert.equal(r[0].satuan, "KG"); assert.equal(r[0].jenis, "HARGA"); assert.equal(r[0].previousPrice, null);
  assert.equal(r[0].reason, `Dari PO ${po.poNumber} — belum diterima`); assert.equal(r[0].impact.sumber, "PO"); assert.equal(r[0].impact.poId, po.id);
  assert.ok(Math.abs(r[0].effectiveFrom.getTime() - r[0].createdAt.getTime()) < 5, "efektif = saat dicatat (tanpa mundur)"); assert.ok(r[0].createdAt.getTime() >= t0 - 1000);
  assert.equal(r[0].evidenceNote, null, "label tetap ‘Belum didukung bukti’ — PO bukan bukti kedatangan");
  const rw = await riwayat(w, w.lem); assert.equal(rw[0].sumber.teks, `Dari PO ${po.poNumber} — belum diterima`); assert.equal(rw[0].teksLabelBukti, "Belum didukung bukti");
  assert.deepEqual(await snap(), s0, "tidak ada stok, valuasi Finance, jurnal, biaya operasional, atau catatan yang berubah");
  const ring = (await w.f.get(`${HB}/bahan/${w.lem.id}`)).body; assert.equal(ring.hargaBerlaku.sumber.teks, `Dari PO ${po.poNumber} — belum diterima`);
});

test("P3. harga NAIK, TURUN, SAMA dibandingkan Harga Berlaku sekarang: naik/turun menambah baris (harga lama tercatat), sama tidak menambah baris", async () => {
  const w = await dunia(); await hargaAwal(w, w.lem, 50_000); await hargaAwal(w, w.busa, 100_000); await hargaAwal(w, w.paku, 300);
  const po = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 60_000 }, { materialId: w.busa.id, qty: 1, unitPrice: 80_000 }, { materialId: w.paku.id, qty: 100, unitPrice: 300 }]);
  const pr = (await w.f.get(`${BASE}/${po.id}/pratinjau-harga`)).body; const st = Object.fromEntries(pr.baris.map((b) => [b.kode, b.status]));
  assert.equal(st[w.lem.code], "NAIK"); assert.equal(st[w.busa.code], "TURUN"); assert.equal(st[w.paku.code], "SAMA"); assert.equal(pr.ringkas.akanMengubahHarga, 2);
  const ap = await w.f.post(`${BASE}/${po.id}/approve`, { hashPratinjau: pr.hash }); assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const l = await baris(w.lem.id); assert.equal(l.length, 2); assert.equal(Number(l[1].unitPrice), 60_000); assert.equal(Number(l[1].previousPrice), 50_000);
  const b = await baris(w.busa.id); assert.equal(b.length, 2); assert.equal(Number(b[1].unitPrice), 80_000); assert.equal(Number(b[1].previousPrice), 100_000);
  assert.equal((await baris(w.paku.id)).length, 1, "harga sama: tidak ada baris baru");
  assert.deepEqual(ap.body.hargaDariPO.tidakBerubah.map((x) => x.status), ["SAMA"]);
});

test("P4. satuan & konversi: satuan beli CAN × faktor 13 ke KG ditulis per KG; hasil bagi >4 desimal dibulatkan DAN ditandai; tanpa faktor = konflik, tidak ditulis per CAN", async () => {
  const w = await dunia();
  const po = await buatPO(w, [{ materialId: w.lem.id, qty: 10, unitPrice: 649_350, satuanBeli: "CAN", faktorKonversi: "13" }, { materialId: w.paku.id, qty: 5, unitPrice: 100_000, satuanBeli: "BOX", faktorKonversi: "12" }]);
  const pr = (await w.f.get(`${BASE}/${po.id}/pratinjau-harga`)).body; const lem = pr.baris.find((b) => b.kode === w.lem.code); const paku = pr.baris.find((b) => b.kode === w.paku.code);
  assert.equal(lem.hargaBaru, 49_950); assert.equal(lem.satuanStok, "KG"); assert.equal(lem.faktor, 13); assert.equal(lem.dibulatkan, false);
  assert.equal(paku.hargaBaru, 8333.3333); assert.equal(paku.dibulatkan, true); assert.ok(paku.peringatan.some((p) => p.kode === "DIBULATKAN_4_DESIMAL"));
  const ap = await w.f.post(`${BASE}/${po.id}/approve`, { hashPratinjau: pr.hash }); assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.equal(Number((await baris(w.lem.id))[0].unitPrice), 49_950); assert.equal((await baris(w.lem.id))[0].satuan, "KG");
  assert.equal(Number((await baris(w.paku.id))[0].unitPrice), 8333.3333);
  // Tanpa faktor yang sah (data lama: satuan baris ≠ satuan stok, tanpa purchaseUnit/faktor): konflik, bukan harga per CAN sebagai per KG.
  const w2 = await dunia(); const po2 = await buatPO(w2, [{ materialId: w2.lem.id, qty: 10, unitPrice: 649_350 }]);
  await testPrisma.finPurchaseOrderLine.updateMany({ where: { purchaseOrderId: po2.id }, data: { unit: "CAN" } });
  const pr2 = (await w2.f.get(`${BASE}/${po2.id}/pratinjau-harga`)).body; assert.equal(pr2.baris[0].status, "KONVERSI_TIDAK_ADA"); assert.equal(pr2.baris[0].hargaBaru, null);
  const gagal = await w2.f.post(`${BASE}/${po2.id}/approve`, { hashPratinjau: pr2.hash }); assert.equal(gagal.status, 409); assert.equal(gagal.body.code, "HARGA_PO_KONFLIK");
  assert.equal((await testPrisma.finPurchaseOrder.findUnique({ where: { id: po2.id } })).status, "DRAFT", "PO tetap draf"); assert.equal(await baris(w2.lem.id).then((x) => x.length), 0);
  const lewati = await w2.f.post(`${BASE}/${po2.id}/approve`, { hashPratinjau: pr2.hash, lewatiBahan: [w2.lem.id] }); assert.equal(lewati.status, 200, JSON.stringify(lewati.body));
  assert.equal(lewati.body.hargaDariPO.dilewati[0].status, "KONVERSI_TIDAK_ADA"); assert.equal(await baris(w2.lem.id).then((x) => x.length), 0, "dilewati eksplisit ⇒ harga tidak ditulis");
  // Faktor tidak sah (unit test murni)
  assert.equal(hargaStokBaris({ unit: "CAN", unitPrice: 1000, purchaseUnit: "CAN", conversionFactor: "0" }, { unit: "KG" }).status, "KONVERSI_TIDAK_SAH");
  assert.equal(hargaStokBaris({ unit: "CAN", unitPrice: 1000, purchaseUnit: "BOX", conversionFactor: "13" }, { unit: "KG" }).status, "KONVERSI_TIDAK_SAH");
});

test("P5. satu bahan, beberapa harga berbeda dalam satu PO ⇒ KONFLIK_HARGA_BEDA (tidak memilih baris terakhir); harga stok sama ⇒ bukan konflik. Persetujuan lama sudah menolak baris ganda.", async () => {
  const w = await dunia(); const po = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }, { materialId: w.busa.id, qty: 1, unitPrice: 90_000 }]);
  await testPrisma.finPurchaseOrderLine.create({ data: { purchaseOrderId: po.id, materialId: w.lem.id, unit: "KG", qty: "2", unitPrice: 55_000, sortOrder: 9 } });
  const r = await rencanaHargaPO(testPrisma, po.id); const lem = r.baris.find((b) => b.kode === w.lem.code);
  assert.equal(lem.status, "KONFLIK_HARGA_BEDA"); assert.equal(lem.rincian.length, 2); assert.equal(lem.hargaBaru, null); assert.match(lem.alasan, /50000 \/ 55000|55000 \/ 50000/);
  const ap = await w.f.post(`${BASE}/${po.id}/approve`, { hashPratinjau: r.hash }); assert.notEqual(ap.status, 200, "baris ganda tidak lolos"); assert.equal(await semuaHarga(), 0);
  // harga stok sama (CAN×13 = KG) pada dua baris bahan yang sama ⇒ digabung tanpa konflik
  await testPrisma.finPurchaseOrderLine.deleteMany({ where: { purchaseOrderId: po.id, sortOrder: 9 } });
  await testPrisma.finPurchaseOrderLine.create({ data: { purchaseOrderId: po.id, materialId: w.lem.id, unit: "CAN", qty: "1", unitPrice: 650_000, purchaseUnit: "CAN", conversionFactor: "13", sortOrder: 9 } });
  await testPrisma.finPurchaseOrderLine.updateMany({ where: { purchaseOrderId: po.id, materialId: w.lem.id, sortOrder: 0 }, data: { unitPrice: 50_000 } });
  const r2 = await rencanaHargaPO(testPrisma, po.id); assert.equal(r2.baris.find((b) => b.kode === w.lem.code).status, "BARU");
});

test("P6. pratinjau berubah ⇒ 409 dan PO tetap draf; kegagalan di tengah ⇒ seluruh persetujuan dibatalkan (harga bahan lain tidak tertulis)", async () => {
  const w = await dunia(); const po = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }]);
  const pr = (await w.f.get(`${BASE}/${po.id}/pratinjau-harga`)).body; await hargaAwal(w, w.lem, 51_000); // harga lain disimpan setelah pratinjau
  const ap = await w.f.post(`${BASE}/${po.id}/approve`, { hashPratinjau: pr.hash }); assert.equal(ap.status, 409); assert.equal(ap.body.code, "PRATINJAU_BERUBAH");
  assert.equal((await testPrisma.finPurchaseOrder.findUnique({ where: { id: po.id } })).status, "DRAFT"); assert.equal((await baris(w.lem.id)).length, 1);
  // gagal di bahan kedua: harga ≥ Rp1 miliar per satuan stok ditolak layanan Harga Berlaku, padahal PO mengizinkan sampai 2 miliar
  const po2 = await buatPO(w, [{ materialId: w.busa.id, qty: 1, unitPrice: 70_000 }, { materialId: w.paku.id, qty: 1, unitPrice: 1_500_000_000 }]);
  const ap2 = await w.f.post(`${BASE}/${po2.id}/approve`, {}); assert.ok(ap2.status >= 400, JSON.stringify(ap2.body));
  assert.equal((await testPrisma.finPurchaseOrder.findUnique({ where: { id: po2.id } })).status, "DRAFT"); assert.equal((await baris(w.busa.id)).length, 0, "bahan pertama tidak tertulis (satu transaksi)");
  assert.equal((await testPrisma.finPurchaseOrderEvent.count({ where: { purchaseOrderId: po2.id, type: "DISETUJUI" } })), 0);
});

test("P7. klik ganda, retry, dan dua PO serentak: tidak ada harga ganda; urutan deterministik; tanpa deadlock", async () => {
  const w = await dunia(); const po = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }]);
  const [a, b] = await Promise.all([w.f.post(`${BASE}/${po.id}/approve`, {}), w.o.post(`${BASE}/${po.id}/approve`, {})]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body])); assert.equal((await baris(w.lem.id)).length, 1);
  const lagi = await w.f.post(`${BASE}/${po.id}/approve`, {}); assert.equal(lagi.status, 409); assert.equal((await baris(w.lem.id)).length, 1);
  // retry langsung di layanan dengan revisi yang sama ⇒ SUDAH_DITERAPKAN, tidak menulis lagi
  const ulang = await testPrisma.$transaction((tx) => terapkanHargaPO(tx, { poId: po.id, aktor: w.fin.user, bolehEditHarga: true, wajibHash: false })); assert.equal(ulang.diterapkan.length, 0); assert.equal(ulang.tidakBerubah[0].status, "SUDAH_DITERAPKAN"); assert.equal((await baris(w.lem.id)).length, 1);
  // dua PO berbeda, bahan sama, serentak: dua baris, tidak ada yang hilang, tidak ada kunci-mati
  const p1 = await buatPO(w, [{ materialId: w.busa.id, qty: 1, unitPrice: 100_000 }, { materialId: w.paku.id, qty: 1, unitPrice: 400 }]);
  const p2 = await buatPO(w, [{ materialId: w.paku.id, qty: 1, unitPrice: 500 }, { materialId: w.busa.id, qty: 1, unitPrice: 110_000 }]);
  const [x, y] = await Promise.all([w.f.post(`${BASE}/${p1.id}/approve`, {}), w.o.post(`${BASE}/${p2.id}/approve`, {})]);
  assert.equal(x.status, 200, JSON.stringify(x.body)); assert.equal(y.status, 200, JSON.stringify(y.body));
  for (const m of [w.busa, w.paku]) { const r = await baris(m.id); assert.equal(r.length, 2); assert.equal(new Set(r.map((q) => q.idempotencyKey)).size, 2); assert.equal(Number(r[1].previousPrice), Number(r[0].unitPrice)); }
});

test("P8. revisi harga PO yang disetujui ⇒ baris harga BARU (riwayat bertambah, baris lama utuh, kunci per revisi, retry idempoten); revisi JUMLAH tidak menyentuh harga", async () => {
  const w = await dunia(); const po = await buatPO(w, [{ materialId: w.lem.id, qty: 10, unitPrice: 50_000 }]);
  assert.equal((await w.f.post(`${BASE}/${po.id}/approve`, {})).status, 200); assert.equal((await baris(w.lem.id)).length, 1);
  const rv = await w.f.post(`${BASE}/${po.id}/revisi-jumlah`, { lineId: po.lines[0].id, qty: 8, reason: "Sisa tidak dikirim" }); assert.equal(rv.status, 200, JSON.stringify(rv.body)); assert.equal((await baris(w.lem.id)).length, 1, "revisi jumlah tidak mengubah harga");
  await testPrisma.finPurchaseOrderLine.updateMany({ where: { purchaseOrderId: po.id }, data: { unitPrice: 54_000 } }); // simulasi revisi harga (belum ada perintah revisi harga PO di sistem; hook memakai nomor revisi)
  const r1 = await testPrisma.$transaction((tx) => terapkanHargaPO(tx, { poId: po.id, aktor: w.fin.user, bolehEditHarga: true, wajibHash: false, revisi: 1 })); assert.equal(r1.diterapkan.length, 1); assert.equal(r1.diterapkan[0].status, "NAIK");
  const r = await baris(w.lem.id); assert.equal(r.length, 2); assert.equal(Number(r[0].unitPrice), 50_000, "baris lama utuh"); assert.equal(Number(r[1].unitPrice), 54_000); assert.equal(Number(r[1].previousPrice), 50_000); assert.match(r[1].idempotencyKey, /:r1$/);
  const r1b = await testPrisma.$transaction((tx) => terapkanHargaPO(tx, { poId: po.id, aktor: w.fin.user, bolehEditHarga: true, wajibHash: false, revisi: 1 })); assert.equal(r1b.diterapkan.length, 0); assert.equal((await baris(w.lem.id)).length, 2);
  const rw = await riwayat(w, w.lem); assert.equal(rw.length, 2); assert.equal(rw[0].sumber.revisi, 1);
});

test("P9. pembatalan PO: riwayat tidak dihapus, harga TIDAK dikembalikan; dicatat apakah masih berlaku atau sudah ada harga lebih baru; label sumber berubah jadi ‘PO dibatalkan’", async () => {
  const w = await dunia(); await hargaAwal(w, w.lem, 40_000);
  const po = await buatPO(w, [{ materialId: w.lem.id, qty: 5, unitPrice: 50_000 }]); assert.equal((await w.f.post(`${BASE}/${po.id}/approve`, {})).status, 200);
  const cb = await w.a.post(`${BASE}/${po.id}/cancel`, { reason: "Pemasok membatalkan" }); assert.equal(cb.status, 200, JSON.stringify(cb.body));
  assert.equal(cb.body.status, "DIBATALKAN"); assert.equal(cb.body.hargaBerlakuDariPO[0].masihBerlaku, true); assert.match(cb.body.peringatanHarga, /TIDAK dikembalikan/);
  const r = await baris(w.lem.id); assert.equal(r.length, 2); assert.equal(Number(r[1].unitPrice), 50_000, "harga tidak dikembalikan ke 40.000");
  assert.equal((await riwayat(w, w.lem))[0].sumber.teks, `Dari PO ${po.poNumber} — PO dibatalkan — harga tetap berlaku sampai diubah`);
  // sudah ada harga lebih baru ⇒ dicatat ‘tidak berlaku lagi’
  const po2 = await buatPO(w, [{ materialId: w.lem.id, qty: 5, unitPrice: 60_000 }]); assert.equal((await w.f.post(`${BASE}/${po2.id}/approve`, {})).status, 200); await hargaAwal(w, w.lem, 65_000);
  const cb2 = await w.a.post(`${BASE}/${po2.id}/cancel`, { reason: "Salah pesan" }); assert.equal(cb2.status, 200); assert.equal(cb2.body.hargaBerlakuDariPO[0].masihBerlaku, false); assert.equal(cb2.body.hargaBerlakuDariPO[0].adaHargaLebihBaru, true);
  assert.equal((await baris(w.lem.id)).length, 4); assert.equal(Number((await baris(w.lem.id))[3].unitPrice), 65_000);
});

test("P10. Ubah harga manual tetap jalan (alasan & riwayat), kunci khusus PO dicadangkan, harga TERJADWAL dipertahankan dan diperingatkan", async () => {
  const w = await dunia();
  const man = { materialId: w.lem.id, hargaBaru: "45000", satuan: "KG", alasan: "Harga nota supplier", berlakuMulai: null };
  const p = await w.f.post(`${HB}/pratinjau`, man); assert.equal(p.status, 200);
  const salah = await w.f.post(HB, { ...man, hashPratinjau: p.body.hash }, { "Idempotency-Key": `po-harga:${randomUUID()}:x:r0` }); assert.equal(salah.status, 422); assert.equal(salah.body.code, "KUNCI_DICADANGKAN");
  const ok = await w.f.post(HB, { ...man, hashPratinjau: p.body.hash }, { "Idempotency-Key": `manual-${randomUUID()}` }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const depan = new Date(Date.now() + 5 * 86_400_000).toISOString(); const jm = { materialId: w.lem.id, hargaBaru: "70000", satuan: "KG", alasan: "Kenaikan terjadwal", berlakuMulai: depan };
  const pj = await w.f.post(`${HB}/pratinjau`, jm); const sj = await w.f.post(HB, { ...jm, hashPratinjau: pj.body.hash }, { "Idempotency-Key": `jadwal-${randomUUID()}` }); assert.equal(sj.status, 201, JSON.stringify(sj.body));
  const po = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }]); const pr = (await w.f.get(`${BASE}/${po.id}/pratinjau-harga`)).body;
  assert.ok(pr.baris[0].peringatan.some((q) => q.kode === "ADA_HARGA_TERJADWAL")); assert.equal(pr.baris[0].hargaLama, 45_000);
  assert.equal((await w.f.post(`${BASE}/${po.id}/approve`, { hashPratinjau: pr.hash })).status, 200);
  const ring = (await w.f.get(`${HB}/bahan/${w.lem.id}`)).body; assert.equal(ring.hargaBerlaku.harga, 50_000); assert.equal(ring.terjadwal.length, 1); assert.equal(ring.terjadwal[0].harga, 70_000, "harga terjadwal tetap ada");
  assert.equal((await baris(w.lem.id)).length, 3);
});

test("P11. izin: Admin tanpa peran harga TIDAK dapat menyetujui PO yang mengubah harga (403, tetap draf) tetapi dapat menyetujui PO tanpa perubahan harga; Finance & Owner dapat; Gudang tidak dapat melihat pratinjau", async () => {
  const w = await dunia(); const po = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }]);
  const a = await w.a.post(`${BASE}/${po.id}/approve`, {}); assert.equal(a.status, 403, JSON.stringify(a.body)); assert.equal(a.body.code, "HARGA_PO_BUTUH_IZIN_HARGA");
  assert.equal((await testPrisma.finPurchaseOrder.findUnique({ where: { id: po.id } })).status, "DRAFT"); assert.equal(await semuaHarga(), 0);
  assert.equal((await w.g.get(`${BASE}/${po.id}/pratinjau-harga`)).status, 403);
  assert.equal((await w.o.post(`${BASE}/${po.id}/approve`, {})).status, 200, "Owner boleh"); assert.equal(await semuaHarga(), 1);
  const po2 = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }]); // sama dengan Harga Berlaku sekarang ⇒ tidak ada perubahan ⇒ Admin boleh
  assert.equal((await w.a.post(`${BASE}/${po2.id}/approve`, {})).status, 200); assert.equal(await semuaHarga(), 1);
});

test("P11b. HARGA_DARI_PO_IZIN=approve (keputusan Owner) melonggarkan: Admin penyetuju boleh menyetujui PO yang mengubah harga, tetap tercatat dan tetap lewat pratinjau", async () => {
  const w = await dunia(); const po = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }]); process.env.HARGA_DARI_PO_IZIN = "approve";
  try {
    const pr = (await w.a.get(`${BASE}/${po.id}/pratinjau-harga`)).body; assert.equal(pr.bolehSetujuiHarga, true);
    const a = await w.a.post(`${BASE}/${po.id}/approve`, { hashPratinjau: pr.hash }); assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal((await baris(w.lem.id)).length, 1);
    assert.equal((await baris(w.lem.id))[0].createdById, w.admin.user.id, "pelaku tercatat = penyetuju");
  } finally { delete process.env.HARGA_DARI_PO_IZIN; }
});

test("P12. saklar HARGA_DARI_PO=0 mematikan semuanya; mode ketat meminta hash; PO historis yang sudah disetujui tidak diproses", async () => {
  const w = await dunia();
  // PO historis: disetujui sebelum fitur (dibuat langsung berstatus DISETUJUI) — tidak ada proses otomatis
  const hist = await buatPO(w, [{ materialId: w.busa.id, qty: 1, unitPrice: 90_000 }]); await testPrisma.finPurchaseOrder.update({ where: { id: hist.id }, data: { status: "DISETUJUI" } });
  assert.equal(await semuaHarga(), 0); const ph = (await w.f.get(`${BASE}/${hist.id}/pratinjau-harga`)).body; assert.equal(ph.draf, false); assert.equal(ph.tercatat, null);
  process.env.HARGA_DARI_PO = "0"; const po = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }]);
  assert.equal((await w.a.post(`${BASE}/${po.id}/approve`, {})).status, 200, "saklar mati: perilaku lama (Admin boleh)"); assert.equal(await semuaHarga(), 0);
  process.env.HARGA_DARI_PO = "1"; process.env.HARGA_DARI_PO_STRICT = "1"; const po2 = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }]);
  const k = await w.f.post(`${BASE}/${po2.id}/approve`, {}); assert.equal(k.status, 409); assert.equal(k.body.code, "PRATINJAU_HARGA_PO_WAJIB"); assert.equal(await semuaHarga(), 0);
  const pr = (await w.f.get(`${BASE}/${po2.id}/pratinjau-harga`)).body; assert.equal((await w.f.post(`${BASE}/${po2.id}/approve`, { hashPratinjau: pr.hash })).status, 200); assert.equal(await semuaHarga(), 1);
});
