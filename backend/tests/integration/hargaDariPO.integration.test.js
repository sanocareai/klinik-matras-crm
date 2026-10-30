// HARGA BERLAKU OTOMATIS DARI PO (Okt 2026, revisi Owner 30 Okt): PENYIMPANAN PO (draf dibuat / draf diubah) memperbarui Harga Berlaku operasional lewat layanan resmi, di transaksi yang sama. Persetujuan PO tidak menulis harga.
// Yang dikunci: input belum disimpan tidak mengubah harga · harga sama/naik/turun · hanya baris yang harganya BERUBAH menulis (simpan ulang/jumlah saja tidak menimpa harga lebih baru) · satuan & konversi sah · konflik · gagal ⇒ PO tidak tersimpan ·
// klik ganda/retry/serentak tidak membuat harga ganda · revisi = riwayat baru · persetujuan & pembatalan tidak menulis/mengembalikan harga · ubah manual & harga terjadwal tetap jalan · stok/valuasi/jurnal tidak berubah · tanpa izin harga tambahan · saklar · PO historis.
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
import { rencanaHarga, hargaStokBaris } from "../../src/services/finance/hargaDariPO.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); delete process.env.HARGA_DARI_PO; });
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
const ubahPO = (cli, w, id, lines) => cli.patch(`${BASE}/${id}`, { supplierId: w.supplier.id, orderDate: hariIni(), lines });
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

test("P1. input yang belum disimpan tidak mengubah harga (pratinjau formulir = nol penulisan); menyimpan draf BARU langsung menulis Harga Berlaku, bukan menunggu persetujuan", async () => {
  const w = await dunia(); const s0 = await snap();
  const pr = await w.f.post(`${BASE}/pratinjau-harga`, { lines: [{ materialId: w.lem.id, unitPrice: 50_000 }] }); assert.equal(pr.status, 200, JSON.stringify(pr.body));
  assert.equal(pr.body.baris[0].status, "BARU"); assert.equal(pr.body.baris[0].hargaBaru, 50_000); assert.equal(pr.body.ringkas.akanMenulis, 1); assert.equal(await semuaHarga(), 0, "pratinjau tidak menulis");
  const po = await buatPO(w, [{ materialId: w.lem.id, qty: 5, unitPrice: 50_000 }]);
  assert.equal(po.status, "DRAFT"); assert.equal(await semuaHarga(), 1, "harga tertulis saat disimpan (masih draf)"); assert.equal(po.hargaDariPO.diterapkan.length, 1);
  assert.deepEqual(await snap(), s0, "stok/valuasi Finance/jurnal/biaya operasional/catatan tidak berubah");
});

test("P2. rincian sumber: nomor PO, baris, revisi, pelaku, waktu, alasan otomatis; efektif saat disimpan (tanpa mundur); label bukti tetap ‘Belum didukung bukti’", async () => {
  const w = await dunia(); const t0 = Date.now(); const po = await buatPO(w, [{ materialId: w.busa.id, qty: 1, unitPrice: 90_000 }, { materialId: w.lem.id, qty: 5, unitPrice: 50_000 }]);
  const r = (await baris(w.lem.id))[0];
  assert.equal(Number(r.unitPrice), 50_000); assert.equal(r.satuan, "KG"); assert.equal(r.jenis, "HARGA"); assert.equal(r.previousPrice, null); assert.equal(r.createdById, w.fin.user.id);
  assert.ok(r.reason.startsWith(`Otomatis dari PO ${po.poNumber} (baris 2, revisi 0)`), r.reason); assert.equal(r.impact.sumber, "PO"); assert.equal(r.impact.poId, po.id); assert.equal(r.impact.barisPO, 2); assert.equal(r.impact.revisi, 0); assert.equal(r.impact.pelakuId, w.fin.user.id);
  assert.ok(Math.abs(r.effectiveFrom.getTime() - r.createdAt.getTime()) < 5); assert.ok(r.createdAt.getTime() >= t0 - 1000); assert.equal(r.evidenceNote, null);
  const rw = await riwayat(w, w.lem); assert.equal(rw[0].sumber.teks, `Dari PO ${po.poNumber} — belum diterima`); assert.equal(rw[0].sumber.barisPO, 2); assert.equal(rw[0].dibuatOlehNama, w.fin.user.name); assert.equal(rw[0].teksLabelBukti, "Belum didukung bukti");
  const ring = (await w.f.get(`${HB}/bahan/${w.lem.id}`)).body; assert.equal(ring.hargaBerlaku.sumber.teks, `Dari PO ${po.poNumber} — belum diterima`);
});

test("P3. harga NAIK, TURUN, SAMA terhadap Harga Berlaku sekarang: naik/turun menambah baris (harga lama tercatat), sama tidak menambah baris", async () => {
  const w = await dunia(); await hargaAwal(w, w.lem, 50_000); await hargaAwal(w, w.busa, 100_000); await hargaAwal(w, w.paku, 300);
  const pr = (await w.f.post(`${BASE}/pratinjau-harga`, { lines: [{ materialId: w.lem.id, unitPrice: 60_000 }, { materialId: w.busa.id, unitPrice: 80_000 }, { materialId: w.paku.id, unitPrice: 300 }] })).body;
  assert.deepEqual(Object.fromEntries(pr.baris.map((b) => [b.kode, b.status])), { [w.lem.code]: "NAIK", [w.busa.code]: "TURUN", [w.paku.code]: "SAMA" });
  const po = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 60_000 }, { materialId: w.busa.id, qty: 1, unitPrice: 80_000 }, { materialId: w.paku.id, qty: 100, unitPrice: 300 }]);
  const l = await baris(w.lem.id); assert.equal(l.length, 2); assert.equal(Number(l[1].unitPrice), 60_000); assert.equal(Number(l[1].previousPrice), 50_000);
  const b = await baris(w.busa.id); assert.equal(b.length, 2); assert.equal(Number(b[1].unitPrice), 80_000); assert.equal(Number(b[1].previousPrice), 100_000);
  assert.equal((await baris(w.paku.id)).length, 1, "harga sama: tidak ada baris baru"); assert.deepEqual(po.hargaDariPO.tidakBerubah.map((x) => x.status), ["SAMA"]);
});

test("P4. satuan & konversi: CAN×13 → per KG; BOX×12 dibulatkan 4 desimal dan ditandai; tanpa faktor PO TIDAK tersimpan dan harga tidak berubah; harga tak masuk akal ditolak di barisnya (atomik)", async () => {
  const w = await dunia();
  const pr = (await w.f.post(`${BASE}/pratinjau-harga`, { lines: [{ materialId: w.lem.id, unitPrice: 649_350, satuanBeli: "CAN", faktorKonversi: "13" }, { materialId: w.paku.id, unitPrice: 100_000, satuanBeli: "BOX", faktorKonversi: "12" }] })).body;
  const lem = pr.baris.find((b) => b.kode === w.lem.code); const paku = pr.baris.find((b) => b.kode === w.paku.code);
  assert.equal(lem.hargaBaru, 49_950); assert.equal(lem.faktor, 13); assert.equal(paku.hargaBaru, 8333.3333); assert.equal(paku.dibulatkan, true); assert.ok(paku.peringatan.some((q) => q.kode === "DIBULATKAN_4_DESIMAL"));
  await buatPO(w, [{ materialId: w.lem.id, qty: 10, unitPrice: 649_350, satuanBeli: "CAN", faktorKonversi: "13" }, { materialId: w.paku.id, qty: 5, unitPrice: 100_000, satuanBeli: "BOX", faktorKonversi: "12" }]);
  const rl = (await baris(w.lem.id))[0]; assert.equal(Number(rl.unitPrice), 49_950); assert.equal(Number((await baris(w.paku.id))[0].unitPrice), 8333.3333); assert.match(rl.note, /÷ faktor 13/);
  const poAwal = await testPrisma.finPurchaseOrder.count(); const hargaAwalN = await semuaHarga(); const w2 = await dunia(); const s = await w2.f.post(BASE, { supplierId: w2.supplier.id, orderDate: hariIni(), lines: [{ materialId: w2.lem.id, qty: 1, unitPrice: 649_350, satuanBeli: "CAN" }] });
  assert.equal(s.status, 400, JSON.stringify(s.body)); assert.equal(await testPrisma.finPurchaseOrder.count(), poAwal); assert.equal(await semuaHarga(), hargaAwalN, "tanpa faktor: PO tidak tersimpan, harga tidak ditulis per CAN");
  const m = await w2.f.post(BASE, { supplierId: w2.supplier.id, orderDate: hariIni(), lines: [{ materialId: w2.lem.id, qty: 1, unitPrice: 50_000 }, { materialId: w2.paku.id, qty: 1, unitPrice: 1_500_000_000 }] });
  assert.equal(m.status, 400, JSON.stringify(m.body)); assert.equal(m.body.baris, 2, "masalah ditunjuk ke baris terkait"); assert.match(m.body.error, /^Baris 2 \(/);
  assert.equal(await testPrisma.finPurchaseOrder.count(), poAwal); assert.equal(await semuaHarga(), hargaAwalN, "baris 1 yang valid pun tidak tertulis");
  assert.equal(hargaStokBaris({ unit: "CAN", unitPrice: 1000, purchaseUnit: "CAN", conversionFactor: "0" }, { unit: "KG" }).status, "KONVERSI_TIDAK_SAH");
  assert.equal(hargaStokBaris({ unit: "CAN", unitPrice: 1000 }, { unit: "KG" }).status, "KONVERSI_TIDAK_ADA");
});

test("P5. satu bahan dengan harga stok berbeda dalam satu PO ⇒ KONFLIK_HARGA_BEDA (tanpa memilih baris terakhir); sama ⇒ digabung. API menolak baris ganda sejak awal.", async () => {
  const w = await dunia(); const m = { id: w.lem.id, code: w.lem.code, name: "LEM", unit: "KG" };
  const r = await rencanaHarga(testPrisma, { baris: [{ no: 1, materialId: w.lem.id, unit: "KG", unitPrice: 50_000, bahan: m }, { no: 2, materialId: w.lem.id, unit: "KG", unitPrice: 55_000, bahan: m }] });
  assert.equal(r.length, 1); assert.equal(r[0].status, "KONFLIK_HARGA_BEDA"); assert.equal(r[0].hargaBaru, null); assert.match(r[0].alasan, /50000 \/ 55000|55000 \/ 50000/);
  const ok = await rencanaHarga(testPrisma, { baris: [{ no: 1, materialId: w.lem.id, unit: "KG", unitPrice: 50_000, bahan: m }, { no: 2, materialId: w.lem.id, unit: "CAN", unitPrice: 650_000, purchaseUnit: "CAN", conversionFactor: "13", bahan: m }] });
  assert.equal(ok[0].status, "BARU"); assert.equal(ok[0].hargaBaru, 50_000);
  const dobel = await w.f.post(BASE, { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }, { materialId: w.lem.id, qty: 1, unitPrice: 55_000 }] });
  assert.equal(dobel.status, 400); assert.equal(await semuaHarga(), 0); assert.equal(await testPrisma.finPurchaseOrder.count(), 0);
});

test("P6. ubah draf: hanya baris yang harganya BERUBAH menulis (revisi bertambah, baris lama utuh); jumlah saja / simpan ulang sama tidak menulis; draf basi TIDAK menimpa harga yang sudah lebih baru", async () => {
  const w = await dunia(); const po = await buatPO(w, [{ materialId: w.lem.id, qty: 10, unitPrice: 50_000 }, { materialId: w.busa.id, qty: 2, unitPrice: 90_000 }]);
  const lines = (a, b, q = 10) => [{ materialId: w.lem.id, qty: q, unitPrice: a }, { materialId: w.busa.id, qty: 2, unitPrice: b }];
  const same = await ubahPO(w.f, w, po.id, lines(50_000, 90_000, 12)); assert.equal(same.status, 200, JSON.stringify(same.body)); assert.equal(same.body.hargaDariPO.diterapkan.length, 0, "jumlah saja"); assert.equal(await semuaHarga(), 2);
  const again = await ubahPO(w.f, w, po.id, lines(50_000, 90_000, 12)); assert.equal(again.body.hargaDariPO.diterapkan.length, 0); assert.equal(await semuaHarga(), 2, "simpan ulang/klik ganda sama: tidak ada baris baru");
  const naik = await ubahPO(w.f, w, po.id, lines(54_000, 90_000)); assert.equal(naik.body.hargaDariPO.diterapkan.length, 1);
  const r = await baris(w.lem.id); assert.equal(r.length, 2); assert.equal(Number(r[0].unitPrice), 50_000, "baris lama utuh"); assert.equal(Number(r[1].unitPrice), 54_000); assert.equal(Number(r[1].previousPrice), 50_000); assert.equal(r[1].impact.revisi, 1); assert.match(r[1].idempotencyKey, /:r1$/); assert.equal(r[1].impact.aksi, "DIUBAH");
  assert.equal((await riwayat(w, w.lem)).length, 2);
  await hargaAwal(w, w.lem, 70_000); // harga dari sumber lain (PO lain / manual), lalu draf LAMA disimpan ulang tanpa mengubah harga barisnya
  const basi = await ubahPO(w.f, w, po.id, lines(54_000, 90_000, 20)); assert.equal(basi.status, 200); assert.equal(basi.body.hargaDariPO.diterapkan.length, 0);
  const rr = await baris(w.lem.id); assert.equal(rr.length, 3); assert.equal(Number(rr[2].unitPrice), 70_000, "harga lebih baru tidak dikembalikan");
});

test("P7. persetujuan PO TIDAK menulis ulang dan TIDAK mengembalikan harga yang sudah lebih baru; Admin penyetuju tetap bisa menyetujui", async () => {
  const w = await dunia(); const po = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }]); await hargaAwal(w, w.lem, 65_000);
  const n0 = await semuaHarga(); const s0 = await snap();
  const ap = await w.a.post(`${BASE}/${po.id}/approve`, {}); assert.equal(ap.status, 200, JSON.stringify(ap.body)); assert.equal(ap.body.status, "DISETUJUI");
  assert.equal(await semuaHarga(), n0, "tidak ada baris harga baru"); const r = await baris(w.lem.id); assert.equal(Number(r[r.length - 1].unitPrice), 65_000, "harga yang lebih baru tetap");
  assert.deepEqual(await snap(), s0); assert.equal((await riwayat(w, w.lem)).find((x) => x.sumber)?.sumber.teks, `Dari PO ${po.poNumber} — belum diterima`);
  const lagi = await w.a.post(`${BASE}/${po.id}/approve`, {}); assert.equal(lagi.status, 409); assert.equal(await semuaHarga(), n0);
});

test("P8. klik ganda/retry/serentak: PATCH sama serentak ⇒ satu baris; POST ber-Idempotency-Key diulang ⇒ satu PO satu harga; dua PO serentak untuk bahan sama ⇒ baris sah berantai tanpa kunci-mati", async () => {
  const w = await dunia(); const po = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }]);
  const [a, b] = await Promise.all([ubahPO(w.f, w, po.id, [{ materialId: w.lem.id, qty: 1, unitPrice: 53_000 }]), ubahPO(w.o, w, po.id, [{ materialId: w.lem.id, qty: 1, unitPrice: 53_000 }])]);
  assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify([a.body, b.body])); const r = await baris(w.lem.id); assert.equal(r.length, 2, "satu penulisan walau dua klik"); assert.equal(new Set(r.map((q) => q.idempotencyKey)).size, 2);
  const kunci = { "Idempotency-Key": `po-${randomUUID()}` }; const body = { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.busa.id, qty: 1, unitPrice: 100_000 }] };
  const p1 = await w.f.post(BASE, body, kunci); const p2 = await w.f.post(BASE, body, kunci); assert.equal(p1.status, 201); assert.equal(p2.body.id, p1.body.id); assert.equal((await baris(w.busa.id)).length, 1); assert.equal(await testPrisma.finPurchaseOrder.count(), 2);
  const [x, y] = await Promise.all([buatPO(w, [{ materialId: w.paku.id, qty: 1, unitPrice: 400 }, { materialId: w.busa.id, qty: 1, unitPrice: 110_000 }]), buatPO(w, [{ materialId: w.busa.id, qty: 1, unitPrice: 120_000 }, { materialId: w.paku.id, qty: 1, unitPrice: 500 }], w.o)]);
  assert.ok(x.id && y.id);
  for (const m of [w.busa, w.paku]) { const rr = await baris(m.id); assert.ok(rr.length >= 2); assert.equal(new Set(rr.map((q) => q.idempotencyKey)).size, rr.length); for (let i = 1; i < rr.length; i++) assert.equal(Number(rr[i].previousPrice), Number(rr[i - 1].unitPrice)); }
});

test("P9. pembatalan PO (draf maupun disetujui): riwayat tidak dihapus, harga TIDAK dikembalikan; dicatat masih berlaku atau sudah ada yang lebih baru; label sumber ‘PO dibatalkan’", async () => {
  const w = await dunia(); await hargaAwal(w, w.lem, 40_000); const po = await buatPO(w, [{ materialId: w.lem.id, qty: 5, unitPrice: 50_000 }]);
  const cb = await w.f.post(`${BASE}/${po.id}/cancel`, { reason: "Salah pesan" }); assert.equal(cb.status, 200, JSON.stringify(cb.body)); assert.equal(cb.body.status, "DIBATALKAN");
  assert.equal(cb.body.hargaBerlakuDariPO[0].masihBerlaku, true); assert.match(cb.body.peringatanHarga, /TIDAK dikembalikan/);
  const r = await baris(w.lem.id); assert.equal(r.length, 2); assert.equal(Number(r[1].unitPrice), 50_000, "tidak kembali ke 40.000");
  assert.equal((await riwayat(w, w.lem))[0].sumber.teks, `Dari PO ${po.poNumber} — PO dibatalkan — harga tetap berlaku sampai diubah`);
  const po2 = await buatPO(w, [{ materialId: w.lem.id, qty: 5, unitPrice: 60_000 }]); assert.equal((await w.f.post(`${BASE}/${po2.id}/approve`, {})).status, 200); await hargaAwal(w, w.lem, 65_000);
  const cb2 = await w.a.post(`${BASE}/${po2.id}/cancel`, { reason: "Pemasok batal" }); assert.equal(cb2.status, 200, JSON.stringify(cb2.body)); assert.equal(cb2.body.hargaBerlakuDariPO[0].masihBerlaku, false); assert.equal(cb2.body.hargaBerlakuDariPO[0].adaHargaLebihBaru, true);
  const akhir = await baris(w.lem.id); assert.equal(Number(akhir[akhir.length - 1].unitPrice), 65_000);
});

test("P10. Ubah harga manual tetap jalan (alasan & riwayat); kunci khusus PO dicadangkan; harga TERJADWAL dipertahankan dan diperingatkan", async () => {
  const w = await dunia();
  const man = { materialId: w.lem.id, hargaBaru: "45000", satuan: "KG", alasan: "Harga nota supplier", berlakuMulai: null };
  const p = await w.f.post(`${HB}/pratinjau`, man); assert.equal(p.status, 200);
  const salah = await w.f.post(HB, { ...man, hashPratinjau: p.body.hash }, { "Idempotency-Key": `po-harga:${randomUUID()}:x:r0` }); assert.equal(salah.status, 422); assert.equal(salah.body.code, "KUNCI_DICADANGKAN");
  assert.equal((await w.f.post(HB, { ...man, hashPratinjau: p.body.hash }, { "Idempotency-Key": `manual-${randomUUID()}` })).status, 201);
  const depan = new Date(Date.now() + 5 * 86_400_000).toISOString(); const jm = { materialId: w.lem.id, hargaBaru: "70000", satuan: "KG", alasan: "Kenaikan terjadwal", berlakuMulai: depan };
  const pj = await w.f.post(`${HB}/pratinjau`, jm); assert.equal((await w.f.post(HB, { ...jm, hashPratinjau: pj.body.hash }, { "Idempotency-Key": `jadwal-${randomUUID()}` })).status, 201);
  const pr = (await w.f.post(`${BASE}/pratinjau-harga`, { lines: [{ materialId: w.lem.id, unitPrice: 50_000 }] })).body; assert.ok(pr.baris[0].peringatan.some((q) => q.kode === "ADA_HARGA_TERJADWAL")); assert.equal(pr.baris[0].hargaLama, 45_000);
  await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }]);
  const ring = (await w.f.get(`${HB}/bahan/${w.lem.id}`)).body; assert.equal(ring.hargaBerlaku.harga, 50_000); assert.equal(ring.terjadwal.length, 1); assert.equal(ring.terjadwal[0].harga, 70_000, "harga terjadwal tetap ada"); assert.equal((await baris(w.lem.id)).length, 3);
});

test("P11. izin: siapa pun yang berwenang menyimpan PO (finance:post) cukup — Admin tanpa peran Finance menyimpan PO dan harga ikut; pratinjau butuh finance:read (Gudang 403)", async () => {
  const w = await dunia(); const po = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }], w.a);
  assert.equal(po.hargaDariPO.diterapkan.length, 1); assert.equal((await baris(w.lem.id))[0].createdById, w.admin.user.id, "pelaku tercatat = penyimpan PO");
  assert.equal((await w.g.post(`${BASE}/pratinjau-harga`, { lines: [] })).status, 403); assert.equal((await w.g.post(BASE, { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialId: w.lem.id, qty: 1, unitPrice: 1 }] })).status, 403); assert.equal(await semuaHarga(), 1);
});

test("P12. atomik: ubah draf yang gagal tidak mengubah baris PO maupun harga; PO historis disetujui tidak diproses; saklar HARGA_DARI_PO=0 mematikan", async () => {
  const w = await dunia(); const po = await buatPO(w, [{ materialId: w.lem.id, qty: 1, unitPrice: 50_000 }]);
  const gagalU = await ubahPO(w.f, w, po.id, [{ materialId: w.lem.id, qty: 1, unitPrice: 51_000 }, { materialId: w.paku.id, qty: 1, unitPrice: 1_500_000_000 }]); assert.equal(gagalU.status, 400, JSON.stringify(gagalU.body)); assert.equal(gagalU.body.baris, 2);
  assert.equal((await baris(w.lem.id)).length, 1, "harga baris 1 tidak berubah"); const tersimpan = await testPrisma.finPurchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } }); assert.equal(tersimpan.length, 1); assert.equal(Number(tersimpan[0].unitPrice), 50_000, "isi PO tetap");
  // PO historis: dibuat langsung berstatus DISETUJUI di DB (tanpa jalur simpan) ⇒ tidak ada harga; fitur tidak punya proses backfill
  const sup = w.supplier.id; const hist = await testPrisma.finPurchaseOrder.create({ data: { poNumber: "PO-HIST-1", supplierId: sup, orderDate: new Date(), status: "DISETUJUI", createdById: w.fin.user.id, lines: { create: [{ materialId: w.busa.id, unit: "SHEET", qty: "1", unitPrice: 90_000, sortOrder: 0 }] } } });
  assert.ok(hist.id); assert.equal((await baris(w.busa.id)).length, 0); assert.equal((await w.f.get(`${HB}/bahan/${w.busa.id}`)).body.hargaBerlaku, null, "PO historis tidak menghasilkan harga");
  process.env.HARGA_DARI_PO = "0"; const mati = await buatPO(w, [{ materialId: w.paku.id, qty: 1, unitPrice: 400 }]); assert.equal(mati.hargaDariPO.aktif, false); assert.equal((await baris(w.paku.id)).length, 0, "saklar mati: harga tidak ditulis");
});
