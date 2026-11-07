// TRANSISI SATUAN BAHAN — tes terarah. Risiko: (1) saldo lama berlabel satuan baru; (2) saldo/riwayat tercampur satuan; (3) kegagalan sebagian; (4) penulisan serentak salah satuan;
// (5) catatan historis bersatuan lama terlepas dari pengaman begitu satuan master disamakan dengan satuan Excel; (6) posting historis/jurnal otomatis.
// Dunia: bahan LIST UJI (ROLL) berpergerakan campuran: baseline +1,5, tiga ISSUE −30 (impor meter), RECEIPT +10 (ROLL) ⇒ saldo −78,5 (tidak bermakna). Hasil SO: 180 METER.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { rencanakanImpor, terapkanImpor, evaluasiUlang, resetKeadaanEfektif, tungguPenyegaran } from "../../src/services/catatanPemakaianHistoris.js";
import { rencanakanPosting } from "../../src/services/postingPemakaianHistoris.js";
import { daftarPengaman } from "../../src/services/pengamanHistorisPascaSO.js";
import { pratinjauTransisi, terapkanTransisi, riwayatSatuan } from "../../src/services/transisiSatuanBahan.js";
import { postStockMovement } from "../../src/services/inventoryLedger.js";
import { hitungNilaiPersediaan } from "../../src/services/nilaiPersediaan.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await tungguPenyegaran(); await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),Total Biaya Bahan (Rp),"Total Penjualan\n(Rp)",Insentif PIC,Insentif Corner,Keterangan / QC';
const baris = (no, order, tgl, kat, nama, qty, sat) => `${no},${order},${tgl},SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,${kat},${nama},,BAHAN,"${qty}",${sat},,,,,,QC OK`;
const WIB = (iso) => new Date(`${iso}T00:00:00+07:00`);
const HARI_INI = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const HASH_REF = "f5d08fab2c0b38a0b84ebbf712a1655723133af599c69b64b758a626f5033a9d";
let seq = 0;

async function dunia({ gerakan = true, harga = true } = {}) {
  resetKeadaanEfektif();
  const admin = await createTestUser({ roles: ["ADMIN"] }); const owner = await createTestUser({ roles: ["OWNER"] });
  const m = await createTestMaterial({ code: `LIST-UJI-${++seq}`, name: `LIST UJI ${seq}`, unit: "ROLL" });
  if (gerakan) {
    await seedBalance(m.id, 1.5, { type: "ADJUSTMENT", createdAt: WIB("2026-08-31") });
    for (let i = 0; i < 3; i++) await seedBalance(m.id, -30, { type: "ISSUE", createdAt: WIB(`2026-09-0${i + 1}`) });
    await seedBalance(m.id, 10, { type: "RECEIPT", createdAt: WIB("2026-10-15"), unitCost: 85000 });
    await testPrisma.$executeRawUnsafe("UPDATE stock_movements SET unit_at_entry = NULL WHERE material_id = $1::uuid", m.id); // meniru pergerakan SEBELUM migrasi (tak bertanda)
  }
  if (harga) await testPrisma.materialHargaBerlaku.create({ data: { materialId: m.id, jenis: "HARGA", unitPrice: 85000, satuan: "ROLL", effectiveFrom: WIB("2026-11-01"), createdAt: WIB("2026-10-30"), reason: "harga uji awal", idempotencyKey: `hb-${m.id}` } });
  const aktor = (u, r) => ({ id: u.user.id, name: u.user.name, roles: [r] });
  return { admin, owner, A: aktor(admin, "ADMIN"), B: aktor(owner, "OWNER"), m, ca: makeClient(server.baseUrl, admin.token), co: makeClient(server.baseUrl, owner.token) };
}
const saldo = async (id) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: id }, _sum: { qty: true } }))._sum.qty ?? 0);
const jumlahGerak = (id) => testPrisma.stockMovement.count({ where: { materialId: id } });
const unitMaster = async (id) => (await testPrisma.material.findUnique({ where: { id } })).unit;
const dokumen = (id) => testPrisma.materialUnitTransition.count({ where: { materialId: id } });
const tautanN = () => testPrisma.activityEvent.count({ where: { entityType: "pernyataan_historis_so", eventType: "SO_DITAUTKAN" } });
const jejakFinance = async () => ({ jurnal: await testPrisma.finJournalEntry.count(), valuasi: await testPrisma.finStockMovementValuation.count(), issue: await testPrisma.stockMovement.count({ where: { type: "ISSUE" } }), harga: await testPrisma.materialHargaBerlaku.count(), po: await testPrisma.finPurchaseOrderLine.count(), gr: await testPrisma.goodsReceiptLine.count() });
const minta = (w, over = {}) => ({ materialId: w.m.id, satuanBaru: "METER", saldoBaru: 180, kewajibanTerbuka: [{ rujukan: "GR-051126-02", jumlah: 10, satuan: "ROLL", keterangan: "penerimaan satuan lama belum diterjemahkan" }], ...over });
async function siap(w, over = {}) { const p = await pratinjauTransisi(testPrisma, { aktor: w.B, transisi: [minta(w, over)] }); return { p, hash: p.transisi[0].hash }; }
const terapkan = (w, hash, over = {}, ekstra = {}) => terapkanTransisi(testPrisma, { aktor: w.B, transisi: [{ ...minta(w, over), hashPratinjau: hash }], sumber: "KIRIM GILANG.xlsx lembar GILANG!B429 (180 METER)", alasan: "Satuan operasional mengikuti Excel SO; saldo awal satuan baru = hasil SO", rujukanHash: HASH_REF, kunci: `transisi-${++seq}-abcdefgh`, ...ekstra });

test("T1. pratinjau baca-saja: tidak menulis apa pun; memuat hash, harga lama tidak dibawa, cakupan PARSIAL bila ada kewajiban terbuka", async () => {
  const w = await dunia(); const g0 = await jumlahGerak(w.m.id); const f0 = await jejakFinance();
  const { p } = await siap(w); const t = p.transisi[0];
  assert.equal(p.bolehDiterapkan, true); assert.equal(t.satuanLama, "ROLL"); assert.equal(t.satuanBaru, "METER"); assert.equal(t.saldoLama, -78.5); assert.equal(t.pergerakan.jumlah, 5); assert.match(t.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(t.hargaTidakDibawa.map((h) => h.satuan), ["ROLL"]); assert.equal(t.cakupan, "PARSIAL"); assert.equal(t.kewajibanTerbuka[0].satuan, "ROLL");
  assert.equal(await jumlahGerak(w.m.id), g0); assert.equal(await dokumen(w.m.id), 0); assert.equal(await unitMaster(w.m.id), "ROLL"); assert.deepEqual(await jejakFinance(), f0);
});

test("T2. transisi atomik: satuan baru + saldo awal sekaligus; riwayat lama utuh dan terbaca per satuan; harga/PO/GR/valuasi/jurnal tidak berubah; tidak ada posting historis", async () => {
  const w = await dunia(); const lama = await testPrisma.stockMovement.findMany({ where: { materialId: w.m.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }); const f0 = await jejakFinance();
  const { hash } = await siap(w); const h = await terapkan(w, hash);
  assert.equal(h.ulang, false); assert.equal(h.transisi.length, 1); const t = h.transisi[0]; assert.equal(t.cakupan, "PARSIAL");
  assert.equal(await unitMaster(w.m.id), "METER"); assert.equal(await saldo(w.m.id), 180, "SUM langsung saldo satuan baru");
  const semua = await testPrisma.stockMovement.findMany({ where: { materialId: w.m.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }); assert.equal(semua.length, lama.length + 2);
  for (const l of lama) { const s = semua.find((x) => x.id === l.id); assert.equal(Number(s.qty), Number(l.qty)); assert.equal(s.type, l.type); assert.equal(s.unitAtEntry, null, "pergerakan lama tidak ditulis ulang"); }
  const tutup = semua.find((x) => x.id === t.penutupId); const buka = semua.find((x) => x.id === t.pembukaId);
  assert.equal(Number(tutup.qty), 78.5); assert.equal(tutup.unitAtEntry, "ROLL"); assert.equal(Number(buka.qty), 180); assert.equal(buka.unitAtEntry, "METER"); assert.equal(tutup.unitTransitionId, t.transisiId); assert.equal(buka.type, "ADJUSTMENT");
  const rs = await riwayatSatuan(testPrisma, w.m.id); const roll = rs.periode.find((p) => p.satuan === "ROLL"); const meter = rs.periode.find((p) => p.satuan === "METER");
  assert.equal(roll.jumlahPergerakan, 6); assert.equal(roll.saldo, 0, "periode ROLL ditutup bersaldo nol"); assert.equal(meter.jumlahPergerakan, 1); assert.equal(meter.saldo, 180); assert.equal(rs.konsisten, true); assert.equal(rs.satuanSekarang, "METER");
  assert.equal(rs.transisi.length, 1); assert.equal(rs.transisi[0].dari, "ROLL"); assert.equal(rs.transisi[0].cakupan, "PARSIAL");
  const doc = await testPrisma.materialUnitTransition.findUnique({ where: { id: t.transisiId } }); assert.equal(Number(doc.balanceOld), -78.5); assert.equal(Number(doc.balanceNew), 180); assert.equal(doc.movementCount, 5); assert.equal(doc.previewHash, hash);
  await assert.rejects(() => testPrisma.materialUnitTransition.update({ where: { id: t.transisiId }, data: { reason: "ubah" } }), /append-only/); await assert.rejects(() => testPrisma.materialUnitTransition.delete({ where: { id: t.transisiId } }), /append-only/);
  const mat = await testPrisma.material.findUnique({ where: { id: w.m.id } }); assert.match(mat.dataNote ?? "", /ROLL → METER/);
  const f1 = await jejakFinance(); assert.deepEqual(f1, f0, "tanpa jurnal/valuasi/ISSUE/harga/PO/GR baru");
  const hb = await testPrisma.materialHargaBerlaku.findFirst({ where: { materialId: w.m.id } }); assert.equal(hb.satuan, "ROLL"); assert.equal(Number(hb.unitPrice), 85000);
  const rp = await rencanakanPosting(testPrisma); assert.equal(rp.transaksi.length, 0, "tidak ada posting historis");
});

test("T3. harga lama TIDAK menjadi harga satuan baru: laporan 'Satuan tidak cocok', tidak dinilai; transisi tampil sebagai cakupan PARSIAL", async () => {
  const w = await dunia(); const { hash } = await siap(w); await terapkan(w, hash);
  const lap = await hitungNilaiPersediaan(testPrisma, { bolehNominal: true }); const b = lap.baris.find((x) => x.materialId === w.m.id);
  assert.equal(b.satuan, "METER"); assert.equal(b.status, "SATUAN_TIDAK_COCOK"); assert.ok(b.nilai === null || b.nilai === undefined || b.nilai === 0 ? b.status !== "DINILAI" : false);
  assert.equal(b.saldo, 180); assert.equal(b.transisiSatuan.parsial, true); assert.equal(b.transisiSatuan.dari, "ROLL"); assert.match(b.keterangan, /Cakupan parsial/); assert.equal(lap.cakupan.transisiSatuan.parsial, 1);
});

test("T4. TIDAK PERNAH terlihat saldo lama berlabel satuan baru (atau saldo baru berlabel satuan lama): pengamat snapshot sepanjang transisi", async () => {
  const w = await dunia(); const { hash } = await siap(w); const pelanggaran = []; let selesai = false; const lihat = [];
  const pengamat = (async () => { while (!selesai) {
    const s = await testPrisma.$transaction(async (tx) => { const mat = await tx.material.findUnique({ where: { id: w.m.id }, select: { unit: true } }); const [{ j }] = await tx.$queryRawUnsafe("SELECT COALESCE(SUM(qty),0)::float j FROM stock_movements WHERE material_id = $1::uuid", w.m.id); return { unit: mat.unit, saldo: Number(j) }; }, { isolationLevel: "RepeatableRead" });
    lihat.push(`${s.unit}:${s.saldo}`); const sah = (s.unit === "ROLL" && s.saldo === -78.5) || (s.unit === "METER" && s.saldo === 180); if (!sah) pelanggaran.push(s); } })();
  await new Promise((r) => setTimeout(r, 150)); await terapkan(w, hash); await new Promise((r) => setTimeout(r, 150)); selesai = true; await pengamat;
  assert.deepEqual(pelanggaran, []); assert.ok(lihat.some((x) => x === "ROLL:-78.5") && lihat.some((x) => x === "METER:180"), "pengamat melihat keadaan sebelum dan sesudah, tak pernah di antaranya");
});

test("T5. kegagalan tidak menyisakan perubahan sebagian: galat di langkah TERAKHIR (sesudah penutupan, ganti satuan, pembukaan) membatalkan semuanya, juga bahan lain dalam batch", async () => {
  const w = await dunia(); const m2 = await createTestMaterial({ code: `LIST-UJI-B-${++seq}`, name: `LIST UJI B ${seq}`, unit: "KG" }); await seedBalance(m2.id, 50, { createdAt: WIB("2026-08-31") });
  const p = await pratinjauTransisi(testPrisma, { aktor: w.B, transisi: [minta(w), { materialId: m2.id, satuanBaru: "SHEET", saldoBaru: 22 }] }); assert.equal(p.bolehDiterapkan, true);
  await testPrisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION uji_gagal_transisi() RETURNS trigger AS $$ BEGIN IF NEW.material_id = '${m2.id}'::uuid THEN RAISE EXCEPTION 'gagal uji di dokumen terakhir'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await testPrisma.$executeRawUnsafe("CREATE TRIGGER uji_gagal_trg BEFORE INSERT ON material_unit_transitions FOR EACH ROW EXECUTE FUNCTION uji_gagal_transisi()");
  const g1 = await jumlahGerak(w.m.id); const g2 = await jumlahGerak(m2.id); const f0 = await jejakFinance();
  try {
    await assert.rejects(() => terapkanTransisi(testPrisma, { aktor: w.B, transisi: [{ ...minta(w), hashPratinjau: p.transisi[0].hash }, { materialId: m2.id, satuanBaru: "SHEET", saldoBaru: 22, hashPratinjau: p.transisi[1].hash }], sumber: "uji sumber", alasan: "Uji kegagalan di tengah batch", rujukanHash: HASH_REF, kunci: `gagal-${++seq}-abcdefgh` }), /gagal uji/);
  } finally { await testPrisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS uji_gagal_trg ON material_unit_transitions"); await testPrisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS uji_gagal_transisi()"); }
  assert.equal(await unitMaster(w.m.id), "ROLL"); assert.equal(await unitMaster(m2.id), "KG"); assert.equal(await jumlahGerak(w.m.id), g1); assert.equal(await jumlahGerak(m2.id), g2); assert.equal(await saldo(w.m.id), -78.5); assert.equal(await saldo(m2.id), 50);
  assert.equal(await dokumen(w.m.id), 0); assert.equal(await dokumen(m2.id), 0); assert.deepEqual(await jejakFinance(), f0);
  const mat = await testPrisma.material.findUnique({ where: { id: w.m.id } }); assert.equal(mat.dataNote ?? null, null, "catatan master tidak berubah");
});

test("T6. ditolak bila keadaan berubah dari pratinjau (pergerakan baru, kewajiban berbeda, saldo baru berbeda); tidak ada yang ditulis", async () => {
  const w = await dunia(); const { hash } = await siap(w); const g0 = await jumlahGerak(w.m.id);
  await seedBalance(w.m.id, 5, { type: "RECEIPT" }); // pergerakan baru sesudah pratinjau
  await assert.rejects(() => terapkan(w, hash), (e) => e.code === "PRATINJAU_BERUBAH" && e.statusCode === 409);
  assert.equal(await unitMaster(w.m.id), "ROLL"); assert.equal(await jumlahGerak(w.m.id), g0 + 1); assert.equal(await dokumen(w.m.id), 0);
  const w2 = await dunia(); const { hash: h2 } = await siap(w2);
  await assert.rejects(() => terapkan(w2, h2, { saldoBaru: 181 }), (e) => e.code === "PRATINJAU_BERUBAH"); await assert.rejects(() => terapkan(w2, h2, { kewajibanTerbuka: [] }), (e) => e.code === "PRATINJAU_BERUBAH");
  assert.equal(await unitMaster(w2.m.id), "ROLL");
});

test("T7. penulisan SERENTAK (penerimaan/pengeluaran) tidak pernah salah satuan: tiap iterasi hasilnya sukses atau PRATINJAU_BERUBAH; saldo per satuan konsisten", async () => {
  for (let i = 0; i < 4; i++) {
    const w = await dunia(); const { hash } = await siap(w); let res;
    const penulis = (async () => { for (let k = 0; k < 6; k++) await testPrisma.$transaction(async (tx) => { await postStockMovement(tx, { materialId: w.m.id, type: "RECEIPT", qty: 1, note: `serentak ${k}`, createdById: w.owner.user.id }); }); })();
    const trans = (async () => { try { res = await terapkan(w, hash); } catch (e) { res = e; } })();
    await Promise.all([penulis, trans]);
    const rs = await riwayatSatuan(testPrisma, w.m.id);
    if (res?.ulang === false) { assert.equal(rs.satuanSekarang, "METER"); assert.equal(rs.konsisten, true, "tak ada pergerakan bertanda ROLL yang tertulis sesudah penutupan"); assert.equal(rs.periode.find((p) => p.satuan === "ROLL").saldo, 0); assert.equal(await saldo(w.m.id), 180 + rs.periode.find((p) => p.satuan === "METER").saldo - 180); }
    else { assert.equal(res.code, "PRATINJAU_BERUBAH"); assert.equal(rs.satuanSekarang, "ROLL"); assert.equal(await dokumen(w.m.id), 0); }
    await truncateAll(); resetKeadaanEfektif();
  }
});

test("T8. pergerakan baru sesudah transisi bertanda satuan baru (trigger); pengeluaran/penerimaan lama tidak mengubah arti riwayat", async () => {
  const w = await dunia(); const { hash } = await siap(w); await terapkan(w, hash);
  const mv = await testPrisma.$transaction(async (tx) => postStockMovement(tx, { materialId: w.m.id, type: "RECEIPT", qty: 7, note: "sesudah transisi", createdById: w.owner.user.id }));
  const baru = await testPrisma.stockMovement.findUnique({ where: { id: mv.id } }); assert.equal(baru.unitAtEntry, "METER"); assert.equal(await saldo(w.m.id), 187);
  const r = await w.co.get(`/api/inventory/materials/${w.m.id}/riwayat-satuan`); assert.equal(r.status, 200); assert.equal(r.body.satuanSekarang, "METER"); assert.equal(r.body.saldoSekarang, 187); assert.equal(r.body.konsisten, true);
  const mvs = await w.co.get(`/api/inventory/movements?materialId=${w.m.id}&limit=50`); assert.equal(mvs.status, 200);
  const lama = mvs.body.filter((x) => x.satuanCatat === "ROLL"); const sekarang = mvs.body.filter((x) => x.satuanCatat === "METER"); assert.equal(lama.length, 6); assert.equal(sekarang.length, 2); assert.ok(mvs.body.every((x) => x.satuanCatat));
});

test("T9. pagar DB: satuan bahan berpergerakan TIDAK bisa diubah di luar transisi; bahan tanpa pergerakan tetap bebas", async () => {
  const w = await dunia(); await assert.rejects(() => testPrisma.material.update({ where: { id: w.m.id }, data: { unit: "METER" } }), /tidak boleh diubah langsung/); assert.equal(await unitMaster(w.m.id), "ROLL");
  const kosong = await createTestMaterial({ code: `KOSONG-${++seq}`, name: `KOSONG ${seq}`, unit: "ROD" }); await testPrisma.material.update({ where: { id: kosong.id }, data: { unit: "PCS" } }); assert.equal(await unitMaster(kosong.id), "PCS");
});

test("T10. bahan TANPA riwayat: transisi hanya membuka saldo awal (satu pergerakan); dokumen tetap tercatat", async () => {
  const w = await dunia({ gerakan: false, harga: false }); const p = await pratinjauTransisi(testPrisma, { aktor: w.B, transisi: [{ materialId: w.m.id, satuanBaru: "PCS", saldoBaru: 1 }] }); assert.equal(p.transisi[0].saldoLama, 0); assert.equal(p.transisi[0].cakupan, "TUNTAS_SATUAN_BARU");
  const h = await terapkanTransisi(testPrisma, { aktor: w.B, transisi: [{ materialId: w.m.id, satuanBaru: "PCS", saldoBaru: 1, hashPratinjau: p.transisi[0].hash }], sumber: "GILANG!B209", alasan: "PCS sesuai Excel; hasil SO 1", rujukanHash: HASH_REF, kunci: `kosong-${++seq}-abcdefgh` });
  assert.equal(h.transisi[0].penutupId, null); assert.ok(h.transisi[0].pembukaId); assert.equal(await jumlahGerak(w.m.id), 1); assert.equal(await unitMaster(w.m.id), "PCS"); assert.equal(await saldo(w.m.id), 1);
});

test("T11. penghalang: permintaan penyesuaian terbuka menolak transisi (berbasis satuan lama); satuan sama ditolak; tidak ada yang ditulis", async () => {
  const w = await dunia(); const pr = (await w.ca.post("/api/inventory/adjustments/koreksi-saldo/pratinjau", { materialId: w.m.id, jumlahFisik: 3 })).body;
  const aj = await w.ca.post("/api/inventory/adjustments/koreksi-saldo/ajukan", { materialId: w.m.id, jumlahFisik: 3, saldoDilihat: pr.saldoDilihat, alasan: "Koreksi uji sebelum transisi" }, { "Idempotency-Key": `ks-${++seq}-abcdefgh` }); assert.equal(aj.status, 201);
  const p = await pratinjauTransisi(testPrisma, { aktor: w.B, transisi: [minta(w)] }); assert.equal(p.bolehDiterapkan, false); assert.ok(p.transisi[0].penghalang.some((x) => x.kode === "PENYESUAIAN_TERBUKA"));
  await assert.rejects(() => terapkan(w, p.transisi[0].hash), (e) => e.code === "TRANSISI_DITOLAK" && e.statusCode === 409); assert.equal(await unitMaster(w.m.id), "ROLL"); assert.equal(await dokumen(w.m.id), 0);
  const p2 = await pratinjauTransisi(testPrisma, { aktor: w.B, transisi: [minta(w, { satuanBaru: "ROLL" })] }); assert.ok(p2.transisi[0].penghalang.some((x) => x.kode === "SATUAN_SAMA"));
});

test("T12. izin dan idempotensi: ADMIN ditolak; kunci sama + isi sama = ulang tanpa menulis; kunci sama + isi beda = 409; hash tidak valid ditolak; rute HTTP bekerja", async () => {
  const w = await dunia(); const { hash } = await siap(w);
  await assert.rejects(() => terapkanTransisi(testPrisma, { aktor: w.A, transisi: [{ ...minta(w), hashPratinjau: hash }], sumber: "uji sumber", alasan: "Uji izin penyetuju transisi", rujukanHash: HASH_REF, kunci: `izin-${++seq}-abcdefgh` }), (e) => e.code === "BUKAN_PENYETUJU" && e.statusCode === 403);
  await assert.rejects(() => terapkan(w, "bukan-hash"), (e) => e.code === "HASH_PRATINJAU_WAJIB"); await assert.rejects(() => terapkanTransisi(testPrisma, { aktor: w.B, transisi: [{ ...minta(w), hashPratinjau: hash }], sumber: "uji", alasan: "Uji kunci wajib pada transisi", rujukanHash: HASH_REF, kunci: "x" }), (e) => e.code === "KUNCI_WAJIB" && e.statusCode === 428);
  const kunci = `idem-${++seq}-abcdefgh`; const a = await terapkan(w, hash, {}, { kunci }); const d1 = await dokumen(w.m.id); const g1 = await jumlahGerak(w.m.id);
  const b = await terapkan(w, hash, {}, { kunci }); assert.equal(b.ulang, true); assert.equal(await dokumen(w.m.id), d1); assert.equal(await jumlahGerak(w.m.id), g1); assert.equal(b.transisi[0].transisiId, a.transisi[0].transisiId);
  await assert.rejects(() => terapkan(w, hash, {}, { kunci, alasan: "Alasan lain yang cukup panjang untuk lolos" }), (e) => e.code === "KUNCI_DIPAKAI_LAIN" && e.statusCode === 409);
  const w2 = await dunia(); const p = await w2.co.post("/api/inventory/materials/transisi-satuan/pratinjau", { transisi: [minta(w2)] }); assert.equal(p.status, 200); assert.equal(p.body.bolehDiterapkan, true);
  const noAuth = await w2.ca.post("/api/inventory/materials/transisi-satuan/pratinjau", { transisi: [minta(w2)] }); assert.equal(noAuth.status, 403);
  const t = await w2.co.post("/api/inventory/materials/transisi-satuan/terapkan", { transisi: [{ ...minta(w2), hashPratinjau: p.body.transisi[0].hash }], sumber: "uji HTTP sumber", alasan: "Uji rute HTTP transisi satuan", rujukanHash: HASH_REF }, { "Idempotency-Key": `http-${++seq}-abcdefgh` }); assert.equal(t.status, 201, JSON.stringify(t.body)); assert.equal(await unitMaster(w2.m.id), "METER");
});

test("T13. PENGAMAN HISTORIS: catatan EXCEL belum diposting wajib bertaut SO; tautan dipasang di transaksi yang sama SEBELUM satuan baru terlihat; sesudahnya seluruh catatan tertahan dan tidak ada ISSUE/jurnal/posting", async () => {
  const w = await dunia(); const mk = async (no) => { const { order, unit } = await createTestUnit({ status: "DELIVERED" }); await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: no, status: "DELIVERED" } }); return unit; };
  await mk("RES-03092026-931"); await mk("RES-04092026-932");
  const csv = ["J", "D", HDR, baris(1, "RES-03092026-931", "3 Sep 26", "Bahan Lapisan", w.m.name, "30,0", "METER"), baris(2, "RES-04092026-932", "4 Sep 26", "Bahan Lapisan", w.m.name, "30,0", "METER")].join("\n");
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: csv, namaBerkas: `transisi${++seq}.csv` }), {}); await evaluasiUlang(testPrisma, {});
  const catatan = await testPrisma.unitUsageNote.findMany({ where: { materialId: w.m.id } }); assert.equal(catatan.length, 2, "kedua catatan terpetakan ke bahan (nama persis)");
  const { p, hash } = await siap(w); assert.equal(p.transisi[0].catatanHistoris.excelBelumDiposting, 2); assert.equal(p.transisi[0].catatanHistoris.tautanSOAktif, false);
  const t0 = await tautanN();
  await assert.rejects(() => terapkan(w, hash), (e) => e.code === "TANPA_TAUTAN_SO" && e.statusCode === 409); assert.equal(await unitMaster(w.m.id), "ROLL"); assert.equal(await tautanN(), t0, "tolak sebelum menulis apa pun");
  const f0 = await jejakFinance();
  const h = await terapkan(w, hash, {}, { tautan: { soTanggal: HARI_INI, sumber: "KIRIM GILANG.xlsx (SO 4 Nov)", alasan: "Tautan SO dipasang bersama transisi satuan", rujukanHash: HASH_REF } });
  assert.equal(h.tautanBaru.length, 1); assert.equal(await tautanN(), t0 + 1); assert.equal(await unitMaster(w.m.id), "METER");
  await evaluasiUlang(testPrisma, {}); // flag 'satuan beda master' kini hilang — pengaman harus menjaga
  const d = await daftarPengaman(testPrisma); assert.equal(d.tertahan, 2); assert.ok(d.baris.every((b) => b.keadaan === "TERTAHAN_PASCA_SO"));
  const rp = await rencanakanPosting(testPrisma); assert.equal(rp.transaksi.length, 0); assert.equal(rp.tertahan.length + (await testPrisma.unitUsageNote.count({ where: { materialId: w.m.id, state: "PERLU_DICEK" } })) >= 2, true);
  const f1 = await jejakFinance(); assert.deepEqual(f1, f0); assert.equal(await testPrisma.activityEvent.count({ where: { eventType: "SO_HISTORIS_DINYATAKAN" } }), 0, "tanpa deklarasi");
  const w2 = await dunia(); const { p: p2, hash: h2 } = await siap(w2); assert.equal(p2.transisi[0].catatanHistoris.excelBelumDiposting, 0); await terapkan(w2, h2); assert.equal(await unitMaster(w2.m.id), "METER");
});

test("T14. kewajiban +10 ROLL LIST WIBING: pratinjau menyertakan setara METER dari faktor satuan pakai yang BERLAKU (90) dan perkiraan saldo setelah kewajiban; bahan tanpa aturan TIDAK ditebak; saldo tidak berubah", async () => {
  const w = await dunia(); const lw = await createTestMaterial({ code: `LIST-WIBING-UJI-${++seq}`, name: `LIST WIBING UJI ${seq}`, unit: "ROLL" }); await seedBalance(lw.id, -78.5, { type: "ADJUSTMENT", createdAt: WIB("2026-09-01") });
  const kew = [{ rujukan: "GR-051126-02", jumlah: 10, satuan: "ROLL", keterangan: "penerimaan satuan lama belum diterjemahkan" }];
  const p = await pratinjauTransisi(testPrisma, { aktor: w.B, transisi: [{ materialId: lw.id, satuanBaru: "METER", saldoBaru: 180, kewajibanTerbuka: kew }, minta(w)] });
  const a = p.transisi[0]; assert.deepEqual(a.kewajibanTerbuka[0].setara, { jumlah: 900, satuan: "METER", faktor: 90, dasar: "KEPUTUSAN_OWNER_2026_11_04" }); assert.equal(a.perkiraanSetelahKewajiban.saldo, 1080); assert.equal(a.saldoBaru, 180, "saldo hasil SO tidak ditambah otomatis"); assert.equal(a.cakupan, "PARSIAL");
  const b = p.transisi[1]; assert.equal(b.kewajibanTerbuka[0].setara, null, "tanpa aturan satuan pakai: tidak ditebak"); assert.equal(b.perkiraanSetelahKewajiban, null);
  assert.equal(await saldo(lw.id), -78.5); assert.equal(await dokumen(lw.id), 0);
  const h1 = a.hash; const p2 = await pratinjauTransisi(testPrisma, { aktor: w.B, transisi: [{ materialId: lw.id, satuanBaru: "METER", saldoBaru: 180, kewajibanTerbuka: kew }] }); assert.equal(p2.transisi[0].hash, h1, "hash stabil untuk masukan yang sama");
  await testPrisma.productionSetting.create({ data: { key: "satuan_pakai_bahan", value: { aturan: [{ awalan: "LIST-WIBING", satuanStok: "ROLL", satuanPakai: "METER", faktor: 100 }] } } });
  const p3 = await pratinjauTransisi(testPrisma, { aktor: w.B, transisi: [{ materialId: lw.id, satuanBaru: "METER", saldoBaru: 180, kewajibanTerbuka: kew }] }); assert.equal(p3.transisi[0].kewajibanTerbuka[0].setara.jumlah, 1000); assert.notEqual(p3.transisi[0].hash, h1, "faktor berubah ⇒ hash berubah ⇒ persetujuan lama ditolak");
  await assert.rejects(() => terapkanTransisi(testPrisma, { aktor: w.B, transisi: [{ materialId: lw.id, satuanBaru: "METER", saldoBaru: 180, kewajibanTerbuka: kew, hashPratinjau: h1 }], sumber: "SO uji", alasan: "Satuan operasional mengikuti Excel SO", rujukanHash: HASH_REF, kunci: `tr-faktor-${seq}-0001`, tautan: { soTanggal: HARI_INI, sumber: "SO uji", alasan: "Tautan SO dalam transisi uji", rujukanHash: HASH_REF } }), (e) => e.statusCode === 409);
  assert.equal(await unitMaster(lw.id), "ROLL");
});

test("T15. rencana bahan unit produksi yang memuat bahan (jumlah dalam satuan lama) menjadi penghalang transisi", async () => {
  const w = await dunia(); const { unit } = await createTestUnit({ status: "IN_PRODUCTION" });
  await testPrisma.productionUnitMaterialPlan.create({ data: { unitId: unit.id, lines: [{ materialId: w.m.id, qty: 0.5 }] } });
  const p = await pratinjauTransisi(testPrisma, { aktor: w.B, transisi: [minta(w)] }); assert.equal(p.bolehDiterapkan, false); assert.ok(p.transisi[0].penghalang.some((x) => x.kode === "RENCANA_PRODUKSI_ADA"), JSON.stringify(p.transisi[0].penghalang));
});

test("T16. PEMBACA RIWAYAT membaca baris lama dengan SATUAN ASAL: /inventory/movements, /units/:id/materials, /production/material-usage — baris sebelum transisi = ROLL, sesudah = METER; satuan master tetap tersedia; total memakai satuan master", async () => {
  const w = await dunia(); const { unit } = await createTestUnit({ status: "DELIVERED" });
  await seedBalance(w.m.id, -3, { type: "ISSUE", unitId: unit.id, createdAt: WIB("2026-09-10"), note: "pemakaian lama (uji)" }); await testPrisma.$executeRawUnsafe("UPDATE stock_movements SET unit_at_entry = NULL WHERE material_id = $1::uuid", w.m.id);
  const { hash } = await siap(w); await terapkan(w, hash);
  await testPrisma.$transaction(async (tx) => postStockMovement(tx, { materialId: w.m.id, type: "ISSUE", qty: -4, unitId: unit.id, note: "pemakaian sesudah transisi", createdById: w.owner.user.id }));
  const periksa = (rows, nama) => {
    const lama = rows.filter((r) => /pemakaian lama \(uji\)/.test(r.note ?? "")); const baru = rows.filter((r) => /sesudah transisi/.test(r.note ?? ""));
    assert.equal(lama.length, 1, nama); assert.equal(baru.length, 1, nama);
    assert.equal(lama[0].material.unit, "ROLL", `${nama}: baris lama berlabel satuan ASAL`); assert.equal(lama[0].satuanCatat, "ROLL"); assert.equal(lama[0].material.satuanMaster, "METER");
    assert.equal(baru[0].material.unit, "METER", `${nama}: baris baru berlabel METER`); assert.equal(baru[0].satuanCatat, "METER");
  };
  const a = await w.co.get(`/api/inventory/movements?materialId=${w.m.id}&limit=100`); assert.equal(a.status, 200); periksa(a.body, "/inventory/movements");
  const b = await w.co.get(`/api/units/${unit.id}/materials`); assert.equal(b.status, 200); periksa(b.body.movements, "/units/:id/materials"); assert.equal(b.body.totals[0].material.unit, "METER", "total memakai satuan master sekarang");
  const c = await w.co.get(`/api/production/material-usage?materialId=${w.m.id}`); assert.equal(c.status, 200); periksa(c.body.movements, "/production/material-usage");
});
