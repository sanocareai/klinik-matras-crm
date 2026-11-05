// PENGAMAN POSTING HISTORIS PASCA-SO — tes terarah (model TAUTAN SO eksplisit). Dasar pengaman = tautan SO per bahan (tanggal SO = batas), BUKAN "semua Koreksi Saldo".
// Dunia: bahan MX (pasokan 10, 1 Sep) dengan catatan uA 6 (3 Sep) dan uC 4 (5 Sep); bahan MY (pasokan 10) dengan catatan uB 1 (4 Sep) sebagai kontrol TANPA tautan.
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
import { daftarPengaman, tautkanSO, batalkanTautan, nyatakanCatatan, batalkanPernyataan, wajibBukanPenyatakan, KEADAAN_PENGAMAN, ARAH } from "../../src/services/pengamanHistorisPascaSO.js";
import { hitungNilaiPersediaan } from "../../src/services/nilaiPersediaan.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await tungguPenyegaran(); await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),Total Biaya Bahan (Rp),"Total Penjualan\n(Rp)",Insentif PIC,Insentif Corner,Keterangan / QC';
const baris = (no, order, tgl, kat, nama, qty, sat) => `${no},${order},${tgl},SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,${kat},${nama},,BAHAN,"${qty}",${sat},,,,,,QC OK`;
const WIB = (iso) => new Date(`${iso}T00:00:00+07:00`);
let seq = 0;
const HARI_INI = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const HASH = "46cd9bcd0d763d9e5a2661d431ed998042257bb9eedc69eb9c1614cb5111a356";
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
  const idDari = async (m, frag) => (await catatan(m)).find((n) => n.orderNumber.includes(frag)).id;
  return { admin, owner, fin, A: aktor(admin, "ADMIN"), B: aktor(owner, "OWNER"), F: aktor(fin, "FINANCE"), mx, my, uA, uB, uC, ca: makeClient(server.baseUrl, admin.token), co: makeClient(server.baseUrl, owner.token), catatan, idDari };
}
// Koreksi Saldo lewat jalur RESMI. selesai: "diposting" (default) | "diajukan". Mengembalikan { id, nomor }.
async function koreksi(w, mat, fisik, selesai = "diposting") {
  const pr = (await w.ca.post("/api/inventory/adjustments/koreksi-saldo/pratinjau", { materialId: mat.id, jumlahFisik: fisik })).body;
  const aj = await w.ca.post("/api/inventory/adjustments/koreksi-saldo/ajukan", { materialId: mat.id, jumlahFisik: fisik, saldoDilihat: pr.saldoDilihat, alasan: "Koreksi uji" }, { "Idempotency-Key": `ks-uji-${mat.code}-${++seq}-xxxxx` }); assert.equal(aj.status, 201, JSON.stringify(aj.body));
  if (selesai === "diposting") { assert.equal((await w.co.patch(`/api/inventory/adjustments/${aj.body.id}`, { status: "APPROVED" })).status, 200); const po = await w.ca.post(`/api/inventory/adjustments/${aj.body.id}/post`, {}); assert.equal(po.status, 200, JSON.stringify(po.body)); }
  return { id: aj.body.id, nomor: aj.body.nomor };
}
const issues = (unit) => testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "ISSUE" } });
const saldo = async (m) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: m.id }, _sum: { qty: true } }))._sum.qty ?? 0);
const mv = () => testPrisma.stockMovement.count();
const tautkan = (w, over = {}) => tautkanSO(testPrisma, { aktor: w.F, materialId: w.mx.id, soTanggal: HARI_INI, sumber: "KIRIM GILANG.xlsx (SO 4 Nov)", alasan: "SO bahan ini ditautkan agar pemakaian lama tidak mengurangi dua kali", rujukanHash: HASH, kunci: `tautan-${++seq}-abcdefgh`, ...over });
const nyatakan = (w, arah, ids, over = {}) => nyatakanCatatan(testPrisma, { aktor: w.F, materialId: w.mx.id, arah, catatanIds: ids, alasan: "Telaah catatan terhadap hasil SO bahan ini", rujukanHash: HASH, kunci: `pern-${++seq}-abcdefgh`, ...over });

test("P1. tanpa tautan SO: rencana posting TIDAK berubah (hash identik rumus lama) — termasuk bila ada Koreksi Saldo biasa yang sudah diposting", async () => {
  const w = await dunia(); const p = await rencanakanPosting(testPrisma);
  assert.equal(p.jumlah, 3); assert.equal(p.tertahan.length, 0); assert.equal(p.tercermin.length, 0); assert.equal(p.dilepas.length, 0); assert.equal(p.hash, hashLama(p), "hash identik dengan rumus sebelum pengaman");
  await koreksi(w, w.mx, 20); // koreksi biasa (mis. koreksi data), BUKAN SO: tidak boleh menahan apa pun
  const p2 = await rencanakanPosting(testPrisma); assert.equal(p2.jumlah, 3); assert.equal(p2.tertahan.length, 0); assert.equal(p2.hash, hashLama(p2), "Koreksi Saldo biasa tidak dianggap SO");
  assert.equal((await daftarPengaman(testPrisma)).baris.length, 0);
});

test("P2. tautan SO menahan catatan bahan itu SEJAK dibuat (sebelum SO diposting): MX tertahan, kontrol MY normal, hash berubah", async () => {
  const w = await dunia(); const sebelum = await rencanakanPosting(testPrisma); const t = await tautkan(w);
  assert.equal(t.ulang, false); assert.equal(t.soTanggal, HARI_INI);
  const p = await rencanakanPosting(testPrisma);
  assert.equal(p.jumlah, 1, "hanya transaksi MY"); assert.equal(p.transaksi[0].kodeBahan, "P-MY"); assert.equal(p.tertahan.length, 2); assert.ok(p.tertahan.every((x) => x.kodeBahan === "P-MX" && x.tautanId === t.id && x.soTanggal === HARI_INI));
  assert.notEqual(p.hash, sebelum.hash); assert.notEqual(p.hash, hashLama(p));
  const d = await daftarPengaman(testPrisma); assert.equal(d.tertahan, 2); assert.equal(d.tautan.length, 1); assert.equal(d.tautan[0].soTanggal, HARI_INI); assert.ok(d.baris.every((b) => b.keadaan === KEADAAN_PENGAMAN.TERTAHAN_PASCA_SO));
});

test("P3. fail-closed DI DALAM posting: rencana disetujui SEBELUM tautan ⇒ posting unit ditolak TERTAHAN_PASCA_SO; tanpa ISSUE; saldo utuh; kontrol berjalan", async () => {
  const w = await dunia(); const lama = await rencanakanPosting(testPrisma); await tautkan(w); const s0 = await saldo(w.mx);
  const r = await postingSatuUnit(testPrisma, { unitId: w.uA.id, daftar: lama.transaksi.filter((t) => t.unitId === w.uA.id), persetujuan: PERSETUJUAN(lama), aktor: w.B });
  assert.equal(r.status, "GAGAL"); assert.equal(r.kode, KEADAAN_PENGAMAN.TERTAHAN_PASCA_SO); assert.equal(await issues(w.uA), 0); assert.equal(await saldo(w.mx), s0, "saldo tidak berkurang dua kali");
  const ok = await postingSatuUnit(testPrisma, { unitId: w.uB.id, daftar: lama.transaksi.filter((t) => t.unitId === w.uB.id), persetujuan: PERSETUJUAN(lama), aktor: w.B }); assert.equal(ok.status, "DIPOSTING"); assert.equal(await issues(w.uB), 1);
});

test("P4. penjagaan tautan: hanya penyetuju; tanggal/sumber/alasan/rujukan/kunci wajib; dokumen harus Koreksi Saldo bahan yang sama; satu tautan aktif; idempoten", async () => {
  const w = await dunia();
  await assert.rejects(() => tautkan(w, { aktor: w.A }), (e) => e.code === "BUKAN_PENYETUJU" && e.statusCode === 403);
  await assert.rejects(() => tautkan(w, { soTanggal: "2099-01-01" }), (e) => e.code === "TANGGAL_SO_MASA_DEPAN");
  await assert.rejects(() => tautkan(w, { soTanggal: "04/11/2026" }), (e) => e.code === "TANGGAL_SO_WAJIB");
  await assert.rejects(() => tautkan(w, { sumber: "x" }), (e) => e.code === "SUMBER_WAJIB");
  await assert.rejects(() => tautkan(w, { alasan: "singkat" }), (e) => e.code === "ALASAN_WAJIB");
  await assert.rejects(() => tautkan(w, { rujukanHash: "pendek" }), (e) => e.code === "RUJUKAN_WAJIB");
  await assert.rejects(() => tautkan(w, { kunci: "x" }), (e) => e.code === "KUNCI_WAJIB" && e.statusCode === 428);
  await assert.rejects(() => tautkan(w, { materialId: "bukan-uuid" }), (e) => e.code === "BAHAN_TIDAK_VALID");
  const ksY = await koreksi(w, w.my, 12, "diajukan"); await assert.rejects(() => tautkan(w, { dokumenId: ksY.id }), (e) => e.code === "DOKUMEN_BAHAN_LAIN", "dokumen bahan lain");
  await assert.rejects(() => tautkan(w, { dokumenId: "00000000-0000-4000-8000-000000000000" }), (e) => e.code === "DOKUMEN_TIDAK_ADA");
  const ksX = await koreksi(w, w.mx, 12, "diposting"); await testPrisma.stockAdjustmentRequest.updateMany({ where: { id: ksX.id }, data: { postedAt: WIB("2026-09-04") } });
  await assert.rejects(() => tautkan(w, { soTanggal: "2026-09-05", dokumenId: ksX.id }), (e) => e.code === "SO_SESUDAH_DOKUMEN", "tanggal SO tidak boleh sesudah posting dokumen");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "pernyataan_historis_so" } }), 0, "penolakan tidak menulis apa pun");
  const t = await tautkan(w, { soTanggal: "2026-09-01", kunci: "tautan-idem-0001", dokumenId: ksX.id }); assert.equal(t.dokumen.nomor, ksX.nomor);
  const lagi = await tautkan(w, { soTanggal: "2026-09-01", kunci: "tautan-idem-0001", dokumenId: ksX.id }); assert.equal(lagi.ulang, true); assert.equal(lagi.id, t.id);
  await assert.rejects(() => tautkan(w, { soTanggal: "2026-09-02", kunci: "tautan-idem-0001", dokumenId: ksX.id }), (e) => e.code === "KUNCI_DIPAKAI_LAIN" && e.statusCode === 409);
  await assert.rejects(() => tautkan(w), (e) => e.code === "SUDAH_ADA_TAUTAN" && e.statusCode === 409);
  await assert.rejects(() => tautkan(w, { menggantikanId: "00000000-0000-4000-8000-000000000000" }), (e) => e.code === "SUDAH_ADA_TAUTAN");
  const ganti = await tautkan(w, { soTanggal: "2026-09-03", menggantikanId: t.id, dokumenId: ksX.id }); assert.notEqual(ganti.id, t.id);
  assert.equal((await daftarPengaman(testPrisma)).tautan.length, 1, "hanya satu tautan aktif setelah penggantian"); assert.equal((await daftarPengaman(testPrisma)).tautan[0].soTanggal, "2026-09-03");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "pernyataan_historis_so", eventType: "SO_DITAUTKAN" } }), 2, "riwayat tautan utuh");
});

test("P5. TERCERMIN per catatan: hanya yang disebut; tanpa ISSUE/ledger/jurnal; hash mengikat; idempoten; yang tak disebut tetap TERTAHAN", async () => {
  const w = await dunia(); await tautkan(w); const idA = await w.idDari(w.mx, "911"); const idC = await w.idDari(w.mx, "913");
  const pra = await rencanakanPosting(testPrisma); const m0 = await mv(); const s0 = await saldo(w.mx); const jr0 = await testPrisma.finJournalEntry.count();
  const h = await nyatakan(w, ARAH.TERCERMIN, [idA], { kunci: "pern-idem-0001" }); assert.equal(h.ulang, false); assert.deepEqual(h.catatanIds, [idA]);
  const lagi = await nyatakan(w, ARAH.TERCERMIN, [idA], { kunci: "pern-idem-0001" }); assert.equal(lagi.ulang, true); assert.equal(lagi.id, h.id);
  await assert.rejects(() => nyatakan(w, ARAH.TERCERMIN, [idC], { kunci: "pern-idem-0001" }), (e) => e.code === "KUNCI_DIPAKAI_LAIN" && e.statusCode === 409);
  await assert.rejects(() => nyatakan(w, ARAH.TERCERMIN, [idA]), (e) => e.code === "SUDAH_DINYATAKAN");
  const p = await rencanakanPosting(testPrisma);
  assert.equal(p.tercermin.length, 1); assert.equal(p.tercermin[0].catatanId, idA); assert.equal(p.tercermin[0].pelakuId, w.F.id); assert.equal(p.tertahan.length, 1); assert.equal(p.tertahan[0].catatanId, idC, "tidak otomatis menyelesaikan semua catatan bahan");
  assert.equal(p.jumlah, 1); assert.notEqual(p.hash, pra.hash);
  const d = await daftarPengaman(testPrisma); assert.equal(d.tercermin, 1); assert.equal(d.tertahan, 1); assert.equal(d.baris.find((b) => b.catatanId === idA).pernyataan.arah, ARAH.TERCERMIN);
  assert.equal(await mv(), m0, "pernyataan tidak menulis stok"); assert.equal(await saldo(w.mx), s0); assert.equal(await testPrisma.finJournalEntry.count(), jr0); assert.equal(await issues(w.uA), 0);
  const r = await postingSatuUnit(testPrisma, { unitId: w.uA.id, daftar: [{ kunci: "PH2610:RES-03092026-911:P-MX", unitId: w.uA.id, materialId: w.mx.id, qty: 6, tanggal: "2026-09-03", usedAt: new Date("2026-09-02T17:00:00Z"), catatanIds: [idA], kodeBahan: "P-MX", satuan: "METER", orderNumber: "RES-03092026-911" }], persetujuan: PERSETUJUAN(pra), aktor: w.B });
  assert.equal(r.status, "GAGAL"); assert.equal(r.kode, KEADAAN_PENGAMAN.TERCERMIN_DI_SO, "catatan tercermin tidak boleh dijadikan ISSUE walau dipaksa"); assert.equal(await issues(w.uA), 0);
});

test("P6. BELUM_TERCERMIN: jalur penyelesaian aman — dilepas per catatan ke posting biasa (ISSUE bertanggal historis), tercatat, hash mengikat; yang lain tetap ditahan", async () => {
  const w = await dunia(); await tautkan(w); const idA = await w.idDari(w.mx, "911"); const idC = await w.idDari(w.mx, "913");
  const tertahan = await rencanakanPosting(testPrisma); assert.equal(tertahan.tertahan.length, 2);
  await nyatakan(w, ARAH.BELUM_TERCERMIN, [idA], { alasan: "Pemakaian terjadi setelah hitung fisik; belum ada di fisik SO" });
  const p = await rencanakanPosting(testPrisma);
  assert.equal(p.dilepas.length, 1); assert.equal(p.dilepas[0].catatanId, idA); assert.equal(p.tertahan.length, 1); assert.equal(p.tertahan[0].catatanId, idC); assert.ok(p.transaksi.some((t) => t.orderNumber === "RES-03092026-911" && t.kodeBahan === "P-MX"), "catatan dilepas ikut rencana");
  assert.notEqual(p.hash, tertahan.hash, "hash mengikat pernyataan");
  const s0 = await saldo(w.mx); const r = await postingSatuUnit(testPrisma, { unitId: w.uA.id, daftar: p.transaksi.filter((t) => t.unitId === w.uA.id), persetujuan: PERSETUJUAN(p), aktor: w.B });
  assert.equal(r.status, "DIPOSTING"); assert.equal(await issues(w.uA), 1); assert.equal(await saldo(w.mx), s0 - 6, "ISSUE ditulis atas pernyataan penyetuju");
  const rc = await postingSatuUnit(testPrisma, { unitId: w.uC.id, daftar: [{ kunci: "PH2610:RES-05092026-913:P-MX", unitId: w.uC.id, materialId: w.mx.id, qty: 4, tanggal: "2026-09-05", usedAt: new Date("2026-09-04T17:00:00Z"), catatanIds: [idC], kodeBahan: "P-MX", satuan: "METER", orderNumber: "RES-05092026-913" }], persetujuan: PERSETUJUAN(p), aktor: w.B });
  assert.equal(rc.status, "GAGAL"); assert.equal(rc.kode, KEADAAN_PENGAMAN.TERTAHAN_PASCA_SO); assert.equal(await issues(w.uC), 0);
});

test("P7. batas = akhir hari tanggal SO (WIB): ≤ batas ditahan, sesudahnya alur biasa; jam tidak direka", async () => {
  const w = await dunia(); const t = await tautkan(w, { soTanggal: "2026-09-03" });
  let p = await rencanakanPosting(testPrisma); assert.deepEqual(p.tertahan.map((x) => x.order), ["RES-03092026-911"], "catatan 3 Sep ditahan (tepat pada tanggal SO)"); assert.ok(p.transaksi.some((x) => x.orderNumber === "RES-05092026-913" && x.kodeBahan === "P-MX"));
  assert.equal((await daftarPengaman(testPrisma)).tautan[0].batas, "2026-09-03T16:59:59.999Z", "akhir hari 3 Sep WIB, tanpa jam rekaan");
  await tautkan(w, { soTanggal: "2026-09-05", menggantikanId: t.id }); p = await rencanakanPosting(testPrisma); assert.equal(p.tertahan.length, 2, "tanggal SO digeser ⇒ himpunan tertahan mengikuti");
  const idC = await w.idDari(w.mx, "913"); const t2 = (await daftarPengaman(testPrisma)).tautan[0];
  await tautkan(w, { soTanggal: "2026-09-04", menggantikanId: t2.tautanId }); await assert.rejects(() => nyatakan(w, ARAH.TERCERMIN, [idC]), (e) => e.code === "CATATAN_SESUDAH_SO", "catatan sesudah batas SO tidak terkena pengaman");
});

test("P8. pemisahan tugas: pemosting historis tidak boleh penyatakan (TERCERMIN maupun BELUM_TERCERMIN); batch ditolak; penyetuju lain lolos", async () => {
  const w = await dunia(); await tautkan(w); const idA = await w.idDari(w.mx, "911"); const idC = await w.idDari(w.mx, "913");
  await nyatakan(w, ARAH.TERCERMIN, [idA], { aktor: w.B }); let p = await rencanakanPosting(testPrisma);
  assert.throws(() => wajibBukanPenyatakan(p, w.B), (e) => e.code === "PENYATAAN_OLEH_PEMOSTING" && e.statusCode === 403); wajibBukanPenyatakan(p, w.F);
  await assert.rejects(() => ajukanBatch(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B }), /tidak boleh orang yang menyatakan/);
  await nyatakan(w, ARAH.BELUM_TERCERMIN, [idC], { aktor: w.B, alasan: "Pemakaian terjadi setelah hitung fisik" }); p = await rencanakanPosting(testPrisma);
  assert.equal(p.dilepas.length, 1); assert.throws(() => wajibBukanPenyatakan(p, w.B), (e) => e.code === "PENYATAAN_OLEH_PEMOSTING");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "posting_historis_batch" } }), 0, "batch tidak dibuat");
});

test("P9. pembatalan pernyataan dan tautan: peristiwa baru (riwayat utuh); catatan kembali ditahan / dilepas; hash kembali; bukan penyetuju/ganda ditolak", async () => {
  const w = await dunia(); const idA = await w.idDari(w.mx, "911"); const dasar = await rencanakanPosting(testPrisma); const t = await tautkan(w); const tertahan = await rencanakanPosting(testPrisma);
  const h = await nyatakan(w, ARAH.TERCERMIN, [idA]); assert.notEqual((await rencanakanPosting(testPrisma)).hash, tertahan.hash);
  await assert.rejects(() => batalkanPernyataan(testPrisma, { aktor: w.A, pernyataanId: h.id, alasan: "Salah menyatakan catatan ini" }), (e) => e.code === "BUKAN_PENYETUJU");
  await assert.rejects(() => batalkanPernyataan(testPrisma, { aktor: w.F, pernyataanId: h.id, alasan: "pendek" }), (e) => e.code === "ALASAN_WAJIB");
  await batalkanPernyataan(testPrisma, { aktor: w.F, pernyataanId: h.id, alasan: "Ternyata belum tercermin di SO" });
  await assert.rejects(() => batalkanPernyataan(testPrisma, { aktor: w.F, pernyataanId: h.id, alasan: "Ternyata belum tercermin di SO" }), (e) => e.code === "SUDAH_DIBATALKAN");
  const p = await rencanakanPosting(testPrisma); assert.equal(p.tercermin.length, 0); assert.equal(p.tertahan.length, 2); assert.equal(p.hash, tertahan.hash, "himpunan sama ⇒ hash sama");
  await assert.rejects(() => batalkanTautan(testPrisma, { aktor: w.A, tautanId: t.id, alasan: "Tautan salah bahan" }), (e) => e.code === "BUKAN_PENYETUJU");
  await assert.rejects(() => batalkanTautan(testPrisma, { aktor: w.F, tautanId: t.id, alasan: "pendek" }), (e) => e.code === "ALASAN_WAJIB");
  await batalkanTautan(testPrisma, { aktor: w.F, tautanId: t.id, alasan: "Tautan salah bahan, dibatalkan" });
  await assert.rejects(() => batalkanTautan(testPrisma, { aktor: w.F, tautanId: t.id, alasan: "Tautan salah bahan, dibatalkan" }), (e) => e.code === "TAUTAN_TIDAK_AKTIF");
  const q = await rencanakanPosting(testPrisma); assert.equal(q.tertahan.length, 0); assert.equal(q.hash, dasar.hash, "tanpa tautan ⇒ rencana & hash kembali identik dengan semula");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "pernyataan_historis_so" } }), 4, "riwayat utuh: tautan, pernyataan, batal pernyataan, batal tautan");
});

test("P10. rute HTTP: tautan (penyetuju 201 / bukan 403 / tanpa kunci 428), nyatakan, batalkan; rencana memuat jumlah; daftar baca", async () => {
  const w = await dunia(); const idA = await w.idDari(w.mx, "911");
  const bt = { materialId: w.mx.id, soTanggal: HARI_INI, sumber: "KIRIM GILANG.xlsx (SO 4 Nov)", alasan: "SO bahan ini ditautkan agar pemakaian lama tidak mengurangi dua kali", rujukanHash: HASH };
  assert.equal((await w.ca.post("/api/production/posting-historis/pengaman/tautan", bt, { "Idempotency-Key": "http-taut-0001" })).status, 403, "ADMIN bukan penyetuju");
  assert.equal((await w.co.post("/api/production/posting-historis/pengaman/tautan", bt)).status, 428);
  const t = await w.co.post("/api/production/posting-historis/pengaman/tautan", bt, { "Idempotency-Key": "http-taut-0001" }); assert.equal(t.status, 201, JSON.stringify(t.body));
  const g = await w.co.get("/api/production/posting-historis/pengaman"); assert.equal(g.status, 200); assert.equal(g.body.tertahan, 2); assert.equal(g.body.tautan.length, 1);
  const n = await w.co.post("/api/production/posting-historis/pengaman/nyatakan", { materialId: w.mx.id, arah: "TERCERMIN", catatanIds: [idA], alasan: "Telaah catatan terhadap hasil SO bahan ini", rujukanHash: HASH }, { "Idempotency-Key": "http-pern-0001" }); assert.equal(n.status, 201, JSON.stringify(n.body));
  const r = await w.co.get("/api/production/posting-historis/rencana"); assert.equal(r.status, 200); assert.equal(r.body.tertahanPascaSO, 1); assert.equal(r.body.tercerminDiSO, 1); assert.equal(r.body.dilepasBelumTercermin, 0);
  assert.equal((await w.co.post(`/api/production/posting-historis/pengaman/${n.body.id}/batalkan`, { alasan: "Ternyata belum tercermin di SO" })).status, 201);
  assert.equal((await w.co.post(`/api/production/posting-historis/pengaman/tautan/${t.body.id}/batalkan`, { alasan: "Tautan dibatalkan setelah uji" })).status, 201);
  assert.equal((await w.co.get("/api/production/posting-historis/pengaman")).body.tautan.length, 0);
});

test("P11. pratinjau Koreksi Saldo memperingatkan catatan historis; label nol di laporan: Koreksi Saldo + dokumen + tanggal SO HANYA dari tautan eksplisit", async () => {
  const w = await dunia();
  const pra1 = (await w.ca.post("/api/inventory/adjustments/koreksi-saldo/pratinjau", { materialId: w.mx.id, jumlahFisik: 0 })).body; assert.ok(pra1.peringatan.some((x) => /TAUTKAN SO/.test(x)), JSON.stringify(pra1.peringatan));
  const ks = await koreksi(w, w.mx, 0); // fisik 0 diposting resmi ⇒ nol terverifikasi (aturan resmi dipertahankan)
  let lap = await hitungNilaiPersediaan(testPrisma, { bolehNominal: true }); let b = lap.baris.find((x) => x.kode === "P-MX");
  assert.equal(b.keadaanSaldo, "NOL_TERVERIFIKASI"); assert.match(b.keterangan, new RegExp(`^Nol terverifikasi — Koreksi Saldo ${ks.nomor} `)); assert.match(b.keterangan, /tanggal SO belum ditautkan/); assert.equal(b.verifikasiNol.sumber, "KOREKSI_SALDO"); assert.equal(b.verifikasiNol.nomor, ks.nomor); assert.equal(b.verifikasiNol.soTanggal, null); assert.doesNotMatch(b.keterangan, /Stock Count/);
  const t = await tautkan(w, { dokumenId: ks.id }); lap = await hitungNilaiPersediaan(testPrisma, { bolehNominal: true }); b = lap.baris.find((x) => x.kode === "P-MX");
  assert.equal(b.verifikasiNol.soTanggal, HARI_INI); assert.equal(b.verifikasiNol.soDitautkan, true); assert.match(b.keterangan, /SO \d+ \w{3} \d{4}/); assert.ok(t.dokumen.nomor === ks.nomor);
  const pra2 = (await w.ca.post("/api/inventory/adjustments/koreksi-saldo/pratinjau", { materialId: w.mx.id, jumlahFisik: 5 })).body; assert.ok(pra2.peringatan.some((x) => /SO sudah ditautkan/.test(x)));
});
