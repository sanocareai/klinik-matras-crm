// PENGAMAN POSTING HISTORIS PASCA-SO — tes terarah. Bahan yang sudah punya hasil SO sah (Koreksi Saldo POSTED) tidak boleh dikurangi dua kali oleh posting historis.
// Dunia: bahan MX (pasokan 10, 1 Sep) dengan catatan uA 6 (3 Sep) dan uC 4 (5 Sep); bahan MY (pasokan 10) dengan catatan uB 1 (4 Sep) sebagai kontrol TANPA hasil SO.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { rencanakanImpor, terapkanImpor, evaluasiUlang, resetKeadaanEfektif, tungguPenyegaran } from "../../src/services/catatanPemakaianHistoris.js";
import { rencanakanPosting, postingSatuUnit } from "../../src/services/postingPemakaianHistoris.js";
import { ajukanBatch } from "../../src/services/postingBatchLatar.js";
import { daftarPengaman, nyatakanTercermin, batalkanPernyataan, wajibBukanPenyatakan, KEADAAN_PENGAMAN } from "../../src/services/pengamanHistorisPascaSO.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await tungguPenyegaran(); await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),Total Biaya Bahan (Rp),"Total Penjualan\n(Rp)",Insentif PIC,Insentif Corner,Keterangan / QC';
const baris = (no, order, tgl, kat, nama, qty, sat) => `${no},${order},${tgl},SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,${kat},${nama},,BAHAN,"${qty}",${sat},,,,,,QC OK`;
const WIB = (iso) => new Date(`${iso}T00:00:00+07:00`);
let seq = 0;
const PERSETUJUAN = (p) => ({ hashDisetujui: p.hash, rujukan: "OWNER-2026-11-05", disetujuiOleh: "Owner Uji", konfirmasi: {} });
const sha = (x) => crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
const hashLama = (p) => sha(p.transaksi.map((t) => [t.kunci, t.unitId, t.materialId, t.qty, t.createdAtUTC, [...t.catatanIds].sort()]));

async function dunia() {
  resetKeadaanEfektif();
  const admin = await createTestUser({ roles: ["ADMIN"] }); const owner = await createTestUser({ roles: ["OWNER"] }); const fin = await createTestUser({ roles: ["FINANCE"] });
  const mx = await createTestMaterial({ code: "P-MX", name: "KAIN PENGAMAN", unit: "METER" }); const my = await createTestMaterial({ code: "P-MY", name: "BUSA KONTROL", unit: "SHEET" });
  await seedBalance(mx.id, 10, { createdAt: WIB("2026-09-01"), unitCost: 20000 }); await seedBalance(my.id, 10, { createdAt: WIB("2026-09-01"), unitCost: 50000 });
  const mk = async (no) => { const { order, unit } = await createTestUnit({ status: "DELIVERED" }); await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: no, status: "DELIVERED" } }); return unit; };
  const uA = await mk("RES-03092026-911"); const uB = await mk("RES-04092026-912"); const uC = await mk("RES-05092026-913");
  const csv = ["J", "D", HDR,
    baris(1, "RES-03092026-911", "3 Sep 26", "Bahan Lapisan", "KAIN PENGAMAN", "6,0", "METER"),
    baris(2, "RES-04092026-912", "4 Sep 26", "Bahan Fondasi", "BUSA KONTROL", "1,0", "LEMBAR"),
    baris(3, "RES-05092026-913", "5 Sep 26", "Bahan Lapisan", "KAIN PENGAMAN", "4,0", "METER")].join("\n");
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: csv, namaBerkas: `pengaman${++seq}.csv` }), {});
  await evaluasiUlang(testPrisma, {});
  const aktor = (u, r) => ({ id: u.user.id, name: u.user.name, roles: [r] });
  const catatan = async (m) => testPrisma.unitUsageNote.findMany({ where: { materialId: m.id }, orderBy: { orderNumber: "asc" } });
  return { admin, owner, fin, A: aktor(admin, "ADMIN"), B: aktor(owner, "OWNER"), F: aktor(fin, "FINANCE"), mx, my, uA, uB, uC, ca: makeClient(server.baseUrl, admin.token), co: makeClient(server.baseUrl, owner.token), catatan };
}
// SO sah lewat jalur RESMI: pratinjau → ajukan (admin) → setujui (owner) → posting (admin). Mengembalikan nomor dokumen.
async function soSah(w, mat, fisik) {
  const pr = (await w.ca.post("/api/inventory/adjustments/koreksi-saldo/pratinjau", { materialId: mat.id, jumlahFisik: fisik })).body;
  const aj = await w.ca.post("/api/inventory/adjustments/koreksi-saldo/ajukan", { materialId: mat.id, jumlahFisik: fisik, saldoDilihat: pr.saldoDilihat, alasan: "SO uji 4 November" }, { "Idempotency-Key": `so-uji-${mat.code}-${++seq}-xxxxx` }); assert.equal(aj.status, 201, JSON.stringify(aj.body));
  assert.equal((await w.co.patch(`/api/inventory/adjustments/${aj.body.id}`, { status: "APPROVED" })).status, 200);
  const po = await w.ca.post(`/api/inventory/adjustments/${aj.body.id}/post`, {}); assert.equal(po.status, 200, JSON.stringify(po.body)); return aj.body.nomor;
}
const issues = (unit) => testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "ISSUE" } });
const saldo = async (m) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: m.id }, _sum: { qty: true } }))._sum.qty ?? 0);
const mv = () => testPrisma.stockMovement.count();
const nyatakan = (w, over = {}) => nyatakanTercermin(testPrisma, { aktor: w.F, materialId: w.mx.id, catatanIds: [], alasan: "Sudah tercermin di hitung fisik SO 4 Nov 2026", rujukanHash: "46cd9bcd0d763d9e5a2661d431ed998042257bb9eedc69eb9c1614cb5111a356", kunci: `pern-${++seq}-abcdefgh`, ...over });

test("P1. tanpa hasil SO: rencana posting TIDAK berubah — hash identik dengan rumus lama, tidak ada tertahan/tercermin", async () => {
  const w = await dunia(); const p = await rencanakanPosting(testPrisma);
  assert.equal(p.jumlah, 3); assert.equal(p.tertahan.length, 0); assert.equal(p.tercermin.length, 0); assert.equal(p.hash, hashLama(p), "hash identik dengan rumus sebelum pengaman");
  const d = await daftarPengaman(testPrisma); assert.equal(d.baris.length, 0); assert.equal(d.jumlahBahan, 0);
});

test("P2. bahan ber-hasil-SO sah: catatan lamanya TERTAHAN_PASCA_SO, tidak ikut rencana; kontrol MY tidak terpengaruh; hash berubah", async () => {
  const w = await dunia(); const sebelum = await rencanakanPosting(testPrisma); const nomor = await soSah(w, w.mx, 20);
  const p = await rencanakanPosting(testPrisma);
  assert.equal(p.jumlah, 1, "hanya transaksi MY (kontrol) yang tersisa"); assert.equal(p.transaksi[0].kodeBahan, "P-MY"); assert.equal(p.tertahan.length, 2); assert.equal(p.tercermin.length, 0);
  assert.deepEqual(p.tertahan.map((t) => t.kodeBahan).sort(), ["P-MX", "P-MX"]); assert.ok(p.tertahan.every((t) => t.hasilSO === nomor));
  assert.notEqual(p.hash, sebelum.hash); assert.notEqual(p.hash, hashLama(p), "hash mengikat himpunan tertahan");
  const d = await daftarPengaman(testPrisma); assert.equal(d.tertahan, 2); assert.equal(d.tercermin, 0); assert.ok(d.baris.every((b) => b.keadaan === KEADAAN_PENGAMAN.TERTAHAN_PASCA_SO && b.hasilSO.nomor === nomor));
});

test("P3. fail-closed DI DALAM posting: rencana disetujui SEBELUM SO, SO diposting sesudahnya ⇒ posting unit ditolak TERTAHAN_PASCA_SO, tanpa ISSUE, saldo = hasil SO", async () => {
  const w = await dunia(); const lama = await rencanakanPosting(testPrisma); await soSah(w, w.mx, 20); const saldoSO = await saldo(w.mx); assert.equal(saldoSO, 20);
  const daftar = lama.transaksi.filter((t) => t.unitId === w.uA.id);
  const r = await postingSatuUnit(testPrisma, { unitId: w.uA.id, daftar, persetujuan: PERSETUJUAN(lama), aktor: w.B });
  assert.equal(r.status, "GAGAL"); assert.equal(r.kode, KEADAAN_PENGAMAN.TERTAHAN_PASCA_SO); assert.equal(await issues(w.uA), 0, "tidak ada ISSUE"); assert.equal(await saldo(w.mx), 20, "saldo tidak berkurang dua kali");
  const ok = await postingSatuUnit(testPrisma, { unitId: w.uB.id, daftar: lama.transaksi.filter((t) => t.unitId === w.uB.id), persetujuan: PERSETUJUAN(lama), aktor: w.B }); assert.equal(ok.status, "DIPOSTING", "kontrol tanpa SO tetap berjalan"); assert.equal(await issues(w.uB), 1);
});

test("P4. penjagaan pernyataan: hanya penyetuju; alasan/rujukan/kunci wajib; per bahan; hanya catatan Excel belum diposting; bahan tanpa hasil SO ditolak", async () => {
  const w = await dunia(); await soSah(w, w.mx, 20); const cx = await w.catatan(w.mx); const cy = await w.catatan(w.my); const idA = cx.find((n) => n.orderNumber.includes("911")).id;
  await assert.rejects(() => nyatakan(w, { aktor: w.A, catatanIds: [idA] }), (e) => e.code === "BUKAN_PENYETUJU" && e.statusCode === 403);
  await assert.rejects(() => nyatakan(w, { catatanIds: [idA], alasan: "singkat" }), (e) => e.code === "ALASAN_WAJIB");
  await assert.rejects(() => nyatakan(w, { catatanIds: [idA], rujukanHash: "pendek" }), (e) => e.code === "RUJUKAN_WAJIB");
  await assert.rejects(() => nyatakan(w, { catatanIds: [idA], kunci: "x" }), (e) => e.code === "KUNCI_WAJIB" && e.statusCode === 428);
  await assert.rejects(() => nyatakan(w, { catatanIds: [] }), (e) => e.code === "CATATAN_TIDAK_VALID");
  await assert.rejects(() => nyatakan(w, { catatanIds: [idA, idA] }), (e) => e.code === "CATATAN_TIDAK_VALID", "id ganda = bukan pernyataan massal yang valid");
  await assert.rejects(() => nyatakan(w, { catatanIds: [cy[0].id] }), (e) => e.code === "CATATAN_BAHAN_LAIN", "pernyataan wajib per bahan");
  await assert.rejects(() => nyatakan(w, { materialId: w.my.id, catatanIds: [cy[0].id] }), (e) => e.code === "TANPA_HASIL_SO_SAH", "bahan tanpa hasil SO sah");
  await assert.rejects(() => nyatakan(w, { catatanIds: ["00000000-0000-4000-8000-000000000000"] }), (e) => e.code === "CATATAN_TIDAK_ADA");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "pernyataan_historis_so" } }), 0, "penolakan tidak menulis apa pun");
});

test("P5. pernyataan sah ⇒ TERCERMIN_DI_SO: tanpa ISSUE, ledger tidak berubah, hash mengikat pernyataan; idempoten; catatan yang tidak tercakup tetap TERTAHAN", async () => {
  const w = await dunia(); await soSah(w, w.mx, 20); const cx = await w.catatan(w.mx); const idA = cx.find((n) => n.orderNumber.includes("911")).id; const idC = cx.find((n) => n.orderNumber.includes("913")).id;
  const pra = await rencanakanPosting(testPrisma); const m0 = await mv(); const s0 = await saldo(w.mx); const jr0 = await testPrisma.finJournalEntry.count();
  const h = await nyatakan(w, { catatanIds: [idA], kunci: "pern-idem-0001" }); assert.equal(h.ulang, false); assert.deepEqual(h.catatanIds, [idA]);
  const lagi = await nyatakan(w, { catatanIds: [idA], kunci: "pern-idem-0001" }); assert.equal(lagi.ulang, true); assert.equal(lagi.id, h.id);
  await assert.rejects(() => nyatakan(w, { catatanIds: [idC], kunci: "pern-idem-0001" }), (e) => e.code === "KUNCI_DIPAKAI_LAIN" && e.statusCode === 409);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "pernyataan_historis_so" } }), 1, "satu peristiwa saja");
  await assert.rejects(() => nyatakan(w, { catatanIds: [idA] }), (e) => e.code === "SUDAH_DINYATAKAN");
  const p = await rencanakanPosting(testPrisma);
  assert.equal(p.tercermin.length, 1); assert.equal(p.tercermin[0].catatanId, idA); assert.equal(p.tercermin[0].pelakuId, w.F.id); assert.equal(p.tertahan.length, 1); assert.equal(p.tertahan[0].catatanId, idC, "catatan tak tercakup tetap ditahan");
  assert.equal(p.jumlah, 1); assert.notEqual(p.hash, pra.hash, "persetujuan lama tidak berlaku untuk rencana yang berbeda");
  const d = await daftarPengaman(testPrisma); assert.equal(d.tercermin, 1); assert.equal(d.tertahan, 1); assert.equal(d.baris.find((b) => b.catatanId === idA).pernyataan.alasan.includes("tercermin"), true);
  assert.equal(await mv(), m0, "pernyataan tidak menulis pergerakan stok"); assert.equal(await saldo(w.mx), s0); assert.equal(await testPrisma.finJournalEntry.count(), jr0, "tidak ada jurnal"); assert.equal(await issues(w.uA), 0);
});

test("P6. catatan bertanggal SESUDAH posting hasil SO tetap ikut alur biasa; yang ≤ posting ditahan", async () => {
  const w = await dunia(); const nomor = await soSah(w, w.mx, 20);
  await testPrisma.stockAdjustmentRequest.updateMany({ where: { adjustmentNumber: nomor }, data: { postedAt: WIB("2026-09-04") } }); // SO "diposting" 4 Sep → 3 Sep ≤ batas, 5 Sep sesudah
  const p = await rencanakanPosting(testPrisma);
  assert.deepEqual(p.tertahan.map((t) => t.order), ["RES-03092026-911"]); assert.ok(p.transaksi.some((t) => t.orderNumber === "RES-05092026-913" && t.kodeBahan === "P-MX"), "catatan 5 Sep tetap di rencana");
});

test("P7. pemisahan tugas: pemosting historis tidak boleh penyatakan; batch ditolak; orang lain boleh", async () => {
  const w = await dunia(); await soSah(w, w.mx, 20); const cx = await w.catatan(w.mx); const idA = cx.find((n) => n.orderNumber.includes("911")).id;
  await nyatakan(w, { aktor: w.B, catatanIds: [idA] }); const p = await rencanakanPosting(testPrisma);
  assert.throws(() => wajibBukanPenyatakan(p, w.B), (e) => e.code === "PENYATAAN_OLEH_PEMOSTING" && e.statusCode === 403); wajibBukanPenyatakan(p, w.F); // penyetuju lain: lolos
  await assert.rejects(() => ajukanBatch(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B }), /tidak boleh orang yang menyatakan/);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "posting_historis_batch" } }), 0, "batch tidak dibuat");
});

test("P8. pembatalan: peristiwa baru (riwayat utuh); catatan kembali TERTAHAN; hash kembali ke himpunan semula; bukan penyetuju/ganda ditolak", async () => {
  const w = await dunia(); await soSah(w, w.mx, 20); const cx = await w.catatan(w.mx); const idA = cx.find((n) => n.orderNumber.includes("911")).id;
  const dasar = await rencanakanPosting(testPrisma); const h = await nyatakan(w, { catatanIds: [idA] }); assert.notEqual((await rencanakanPosting(testPrisma)).hash, dasar.hash);
  await assert.rejects(() => batalkanPernyataan(testPrisma, { aktor: w.A, pernyataanId: h.id, alasan: "Salah menyatakan catatan ini" }), (e) => e.code === "BUKAN_PENYETUJU");
  await assert.rejects(() => batalkanPernyataan(testPrisma, { aktor: w.F, pernyataanId: h.id, alasan: "pendek" }), (e) => e.code === "ALASAN_WAJIB");
  const b = await batalkanPernyataan(testPrisma, { aktor: w.F, pernyataanId: h.id, alasan: "Ternyata belum tercermin di SO" }); assert.equal(b.membatalkanId, h.id);
  await assert.rejects(() => batalkanPernyataan(testPrisma, { aktor: w.F, pernyataanId: h.id, alasan: "Ternyata belum tercermin di SO" }), (e) => e.code === "SUDAH_DIBATALKAN");
  const p = await rencanakanPosting(testPrisma); assert.equal(p.tercermin.length, 0); assert.equal(p.tertahan.length, 2); assert.equal(p.hash, dasar.hash, "himpunan sama ⇒ hash sama");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "pernyataan_historis_so" } }), 2, "riwayat utuh: pernyataan + pembatalan");
  await nyatakan(w, { catatanIds: [idA] }); assert.equal((await rencanakanPosting(testPrisma)).tercermin.length, 1, "boleh dinyatakan ulang setelah dibatalkan");
});

test("P9. rute HTTP: daftar (baca), nyatakan (penyetuju 201 / bukan 403), batalkan; rencana memuat jumlah tertahan/tercermin; GET rencana tidak menulis", async () => {
  const w = await dunia(); await soSah(w, w.mx, 20); const cx = await w.catatan(w.mx); const idA = cx.find((n) => n.orderNumber.includes("911")).id;
  const g = await w.co.get("/api/production/posting-historis/pengaman"); assert.equal(g.status, 200); assert.equal(g.body.tertahan, 2);
  const badan = { materialId: w.mx.id, catatanIds: [idA], alasan: "Sudah tercermin di hitung fisik SO 4 Nov 2026", rujukanHash: "46cd9bcd0d763d9e5a2661d431ed998042257bb9eedc69eb9c1614cb5111a356" };
  assert.equal((await w.ca.post("/api/production/posting-historis/pengaman/nyatakan", badan, { "Idempotency-Key": "http-pern-0001" })).status, 403, "ADMIN bukan penyetuju");
  assert.equal((await w.co.post("/api/production/posting-historis/pengaman/nyatakan", badan)).status, 428, "tanpa Idempotency-Key");
  const ok = await w.co.post("/api/production/posting-historis/pengaman/nyatakan", badan, { "Idempotency-Key": "http-pern-0001" }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const r = await w.co.get("/api/production/posting-historis/rencana"); assert.equal(r.status, 200); assert.equal(r.body.tertahanPascaSO, 1); assert.equal(r.body.tercerminDiSO, 1);
  const bt = await w.co.post(`/api/production/posting-historis/pengaman/${ok.body.id}/batalkan`, { alasan: "Ternyata belum tercermin di SO" }); assert.equal(bt.status, 201, JSON.stringify(bt.body));
  assert.equal((await w.co.get("/api/production/posting-historis/pengaman")).body.tertahan, 2);
});
