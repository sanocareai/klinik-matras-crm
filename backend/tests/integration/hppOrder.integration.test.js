// HPP PER ORDER — tes terarah: jalur SO, biaya tanpa stok (sumber, persetujuan, audit, ganda, koreksi), konfirmasi lengkap, antrean, laporan berdampingan.
// Dunia: bahan MX bertaut SO (tanggal SO = H-4) ber-Harga Berlaku Rp15.000 sejak H-30; bahan MY tanpa tautan SO; bahan MZ bertaut SO tanpa harga.
// Unit U1 (order O1) dan U2 (order O2) terkirim pada H-1. Pengaju = PIC (PRODUCTION_LEAD, tanpa finance), penyetuju = FINANCE.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { tautkanSO } from "../../src/services/pengamanHistorisPascaSO.js";
import { resetKeadaanEfektif, tungguPenyegaran } from "../../src/services/catatanPemakaianHistoris.js";
import {
  pratinjauBiayaTanpaStok, ajukanBiayaTanpaStok, setujuiBiayaTanpaStok, akhiriBiayaTanpaStok, konfirmasiLengkap, antreanHpp, laporanHppOrder, rincianUnit, riwayatBiayaTanpaStok,
} from "../../src/services/finance/hppOrder.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { postJournal } from "../../src/services/finance/journal.js";
import { postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await tungguPenyegaran(); await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HARI = 86_400_000;
const H = (n) => new Date(Date.now() + 7 * 3600_000 - n * HARI).toISOString().slice(0, 10); // H(0) = hari ini WIB
const WIB = (t, jam = "10:00") => new Date(`${t}T${jam}:00+07:00`);
let seq = 0;
const kunci = () => `hpp-uji-${++seq}-${randomUUID().slice(0, 8)}`;
const HASH = "46cd9bcd0d763d9e5a2661d431ed998042257bb9eedc69eb9c1614cb5111a356";

async function dunia() {
  resetKeadaanEfektif();
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  await setSetting(testPrisma, SETTING_KEYS.SALDO_AWAL_CUTOFF, "2026-01-01");
  const pic = await createTestUser({ roles: ["PRODUCTION_LEAD"] }); const fin = await createTestUser({ roles: ["FINANCE"] }); const admin = await createTestUser({ roles: ["ADMIN"] });
  const A = (u, r) => ({ id: u.user.id, name: u.user.name, roles: [r] });
  const mx = await createTestMaterial({ name: "KAIN UJI SO", unit: "METER" }); const my = await createTestMaterial({ name: "BUSA TANPA SO", unit: "SHEET" }); const mz = await createTestMaterial({ name: "BENANG TANPA HARGA", unit: "PCS" });
  for (const m of [mx, my, mz]) await seedBalance(m.id, 20, { createdAt: WIB(H(40)) });
  await testPrisma.materialHargaBerlaku.create({ data: { materialId: mx.id, unitPrice: "15000", satuan: "METER", effectiveFrom: WIB(H(30), "00:00"), createdAt: WIB(H(30), "00:00"), reason: "harga uji", idempotencyKey: kunci() } });
  await testPrisma.materialHargaBerlaku.create({ data: { materialId: my.id, unitPrice: "50000", satuan: "SHEET", effectiveFrom: WIB(H(30), "00:00"), createdAt: WIB(H(30), "00:00"), reason: "harga uji", idempotencyKey: kunci() } });
  for (const m of [mx, mz]) await tautkanSO(testPrisma, { aktor: A(fin, "FINANCE"), materialId: m.id, soTanggal: H(4), sumber: "SO uji 4 hari lalu", alasan: "SO bahan ini ditautkan untuk uji biaya tanpa stok", rujukanHash: HASH, kunci: kunci() });
  const mk = async (no, nilai) => {
    const { order, unit } = await createTestUnit({ status: "DELIVERED" });
    await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: no, status: "DELIVERED", value: nilai, category: "LAYANAN" } });
    await testPrisma.unit.update({ where: { id: unit.id }, data: { createdAt: WIB(H(20)) } });
    const job = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, status: "COMPLETED", completedAt: WIB(H(1), "15:00") } });
    await testPrisma.jobUnit.create({ data: { jobId: job.id, unitId: unit.id } });
    return { order, unit };
  };
  const o1 = await mk("RES-UJI-001", 2_000_000); const o2 = await mk("RES-UJI-002", 3_000_000);
  return { pic, fin, admin, P: A(pic, "PRODUCTION_LEAD"), F: A(fin, "FINANCE"), AD: A(admin, "ADMIN"), mx, my, mz, o1, o2 };
}
const dasar = (w, over = {}) => ({ unitId: w.o1.unit.id, materialId: w.mx.id, qty: 2.5, tanggalPemakaian: H(6), sumberJenis: "LAPORAN_PIC", bukti: "Laporan PIC uji, buku kerja meja 2", alasan: "Pemakaian sebelum SO belum tercatat", ...over });
const hitungTulisan = async () => ({ mv: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), stokMx: null });
const saldo = async (m) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: m.id }, _sum: { qty: true } }))._sum.qty ?? 0);
const tolakKode = async (p, kode) => { await assert.rejects(p, (e) => { assert.equal(e.code, kode, `${e.code}: ${e.message}`); return true; }); };

test("H1. jalur: sesudah SO atau bahan tanpa tautan → ditolak (pengeluaran stok resmi); pada/sebelum SO → biaya tanpa stok dengan harga tanggal pemakaian", async () => {
  const w = await dunia();
  const sesudah = await pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { tanggalPemakaian: H(2) }));
  assert.equal(sesudah.jalur.key, "STOK"); assert.equal(sesudah.boleh, false); assert.equal(sesudah.penghalang[0].kode, "JALUR_STOK_RESMI");
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { tanggalPemakaian: H(2) }), { kunci: kunci() }), "JALUR_STOK_RESMI");
  const tanpaTautan = await pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { materialId: w.my.id, qty: 1 }));
  assert.equal(tanpaTautan.jalur.key, "STOK", "bahan tanpa tautan SO tidak pernah lewat biaya tanpa stok");
  const pada = await pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { tanggalPemakaian: H(4) }));
  assert.equal(pada.jalur.key, "BIAYA_TANPA_STOK", "tanggal SAMA dengan SO tercakup SO");
  const pra = await pratinjauBiayaTanpaStok(testPrisma, w.F, dasar(w));
  assert.equal(pra.boleh, true); assert.equal(pra.harga.status, "DINILAI"); assert.equal(pra.harga.harga, 15000); assert.equal(pra.harga.nilai, 37500); assert.equal(pra.soTanggal, H(4));
  const picLihat = await pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w));
  assert.equal(picLihat.harga.harga, null, "PIC tanpa finance:read tidak melihat nominal"); assert.equal(picLihat.harga.status, "DINILAI");
  await tolakKode(pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { tanggalPemakaian: H(25) })), "UNIT_TANGGAL_PEMAKAIAN_SEBELUM_UNIT");
  await tolakKode(pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { bukti: "" })), "BUKTI_WAJIB");
  await tolakKode(pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { sumberJenis: "" })), "SUMBER_WAJIB");
});

test("H2. ajukan → setujui: tanpa stok & tanpa jurnal, persetujuan orang lain, ganda ditolak, audit + immutable, koreksi lewat pengganti", async () => {
  const w = await dunia(); const awal = await hitungTulisan(); const saldoAwal = await saldo(w.mx);
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w), { kunci: "" }), "KUNCI_WAJIB");
  const k = kunci(); const a = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w), { kunci: k });
  assert.equal(a.ulang, false); assert.equal(a.entri.status, "DIAJUKAN"); assert.equal(Number(a.entri.nilai), 37500); assert.equal(a.entri.statusHarga, "DINILAI");
  assert.equal((await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w), { kunci: k })).ulang, true, "idempoten");
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 1 }), { kunci: kunci() }), "BIAYA_GANDA");
  await tolakKode(setujuiBiayaTanpaStok(testPrisma, w.P, { id: a.entri.id }), "TIDAK_BERWENANG");
  // ADMIN boleh mencatat dan menyetujui, tetapi tidak menyetujui pengajuannya sendiri.
  const b = await ajukanBiayaTanpaStok(testPrisma, w.AD, dasar(w, { unitId: w.o2.unit.id, qty: 1 }), { kunci: kunci() });
  await tolakKode(setujuiBiayaTanpaStok(testPrisma, w.AD, { id: b.entri.id }), "PENYETUJU_SAMA_DENGAN_PENGAJU");
  await tolakKode(akhiriBiayaTanpaStok(testPrisma, w.AD, { id: b.entri.id, aksi: "TOLAK", alasan: "uji tolak sendiri" }), "PENYETUJU_SAMA_DENGAN_PENGAJU");
  assert.equal((await akhiriBiayaTanpaStok(testPrisma, w.AD, { id: b.entri.id, aksi: "BATALKAN", alasan: "salah unit, dibatalkan pengaju" })).entri.status, "DIBATALKAN");
  const s = await setujuiBiayaTanpaStok(testPrisma, w.F, { id: a.entri.id, catatan: "cocok laporan PIC" });
  assert.equal(s.entri.status, "DISETUJUI"); assert.equal(s.entri.diputuskanOleh, w.F.id);
  const akhir = await hitungTulisan();
  assert.equal(akhir.mv, awal.mv, "tidak ada pergerakan stok baru"); assert.equal(akhir.jurnal, awal.jurnal, "tidak ada jurnal baru"); assert.equal(await saldo(w.mx), saldoAwal, "saldo bahan tidak berubah");
  const ev = await riwayatBiayaTanpaStok(testPrisma, a.entri.id); assert.deepEqual(ev.map((e) => e.kind), ["DIAJUKAN", "DISETUJUI"]);
  await assert.rejects(testPrisma.orderBiayaTanpaStok.update({ where: { id: a.entri.id }, data: { qty: "9" } }), /immutable/);
  await assert.rejects(testPrisma.orderBiayaTanpaStok.delete({ where: { id: a.entri.id } }), /immutable/);
  await assert.rejects(testPrisma.orderBiayaTanpaStokEvent.deleteMany({ where: { entryId: a.entri.id } }), /immutable/);
  // DB menolak dua DISETUJUI untuk unit+bahan+tanggal yang sama walau melewati layanan.
  await assert.rejects(testPrisma.orderBiayaTanpaStok.create({ data: { unitId: w.o1.unit.id, orderId: w.o1.order.id, materialId: w.mx.id, qty: "1", satuan: "METER", tanggalPemakaian: new Date(`${H(6)}T00:00:00Z`), soTanggal: new Date(`${H(4)}T00:00:00Z`), statusHarga: "TANPA_HARGA", basisHarga: "x", sidikHarga: "x", sumberJenis: "LAPORAN_PIC", bukti: "xxxxx", alasan: "xxxxx", status: "DISETUJUI", diajukanOleh: w.P.id, diputuskanOleh: w.F.id, idempotencyKey: kunci() } }), /Unique|obts_satu_disetujui/);
  await assert.rejects(testPrisma.orderBiayaTanpaStok.create({ data: { unitId: w.o1.unit.id, orderId: w.o1.order.id, materialId: w.mx.id, qty: "1", satuan: "METER", tanggalPemakaian: new Date(`${H(2)}T00:00:00Z`), soTanggal: new Date(`${H(4)}T00:00:00Z`), statusHarga: "TANPA_HARGA", basisHarga: "x", sidikHarga: "x", sumberJenis: "LAPORAN_PIC", bukti: "xxxxx", alasan: "xxxxx", diajukanOleh: w.P.id, idempotencyKey: kunci() } }), /obts_pra_so/, "database menolak tanggal sesudah SO");
  // Koreksi resmi: entri pengganti; yang lama DIGANTI saat pengganti disetujui.
  const kor = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 3, menggantikanId: a.entri.id, alasan: "Jumlah dikoreksi sesuai buku kerja" }), { kunci: kunci() });
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 4, menggantikanId: a.entri.id }), { kunci: kunci() }), "KOREKSI_SUDAH_DIAJUKAN");
  const ks = await setujuiBiayaTanpaStok(testPrisma, w.F, { id: kor.entri.id });
  assert.equal(ks.entri.status, "DISETUJUI"); assert.equal(Number(ks.entri.nilai), 45000);
  assert.equal((await testPrisma.orderBiayaTanpaStok.findUnique({ where: { id: a.entri.id } })).status, "DIGANTI");
  assert.deepEqual((await riwayatBiayaTanpaStok(testPrisma, a.entri.id)).map((e) => e.kind), ["DIAJUKAN", "DISETUJUI", "DIGANTI"]);
  await assert.rejects(testPrisma.orderBiayaTanpaStok.update({ where: { id: a.entri.id }, data: { status: "DISETUJUI" } }), /immutable/, "status final tidak bisa dibuka lagi");
  const btl = await akhiriBiayaTanpaStok(testPrisma, w.F, { id: kor.entri.id, aksi: "BATALKAN", alasan: "Ternyata dipakai unit lain" });
  assert.equal(btl.entri.status, "DIBATALKAN");
});

test("H3. dasar harga berubah sesudah diajukan → persetujuan ditolak; bahan tanpa harga → TANPA_HARGA (null, bukan Rp0) dan unit tetap belum lengkap", async () => {
  const w = await dunia();
  const a = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w), { kunci: kunci() });
  await testPrisma.materialHargaBerlaku.create({ data: { materialId: w.mx.id, unitPrice: "16000", satuan: "METER", effectiveFrom: WIB(H(10), "00:00"), createdAt: WIB(H(10), "00:00"), reason: "harga baru uji", idempotencyKey: kunci() } });
  await tolakKode(setujuiBiayaTanpaStok(testPrisma, w.F, { id: a.entri.id }), "DASAR_HARGA_BERGESER");
  const t = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { materialId: w.mz.id, qty: 2 }), { kunci: kunci() });
  assert.equal(t.entri.statusHarga, "TANPA_HARGA"); assert.equal(t.entri.nilai, null); assert.equal(t.entri.hargaSatuan, null);
  await setujuiBiayaTanpaStok(testPrisma, w.F, { id: t.entri.id });
  const r = await rincianUnit(testPrisma, w.o1.unit.id, { izinHarga: true });
  assert.equal(r.status.key, "BELUM_LENGKAP"); assert.equal(r.status.barisTanpaNilai, 1);
});

test("H4. pengeluaran stok yang sudah tertaut ke unit → wajib konfirmasi bukan ganda; catatan historis sumber tidak dihitung dua kali", async () => {
  const w = await dunia();
  await testPrisma.stockMovement.create({ data: { materialId: w.mx.id, unitId: w.o1.unit.id, type: "ISSUE", qty: -1, note: "pemakaian lama", createdAt: WIB(H(5)) } });
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w), { kunci: kunci() }), "KEMUNGKINAN_GANDA");
  const pr = await pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w)); assert.equal(pr.ganda.perluKonfirmasi, true); assert.equal(pr.ganda.tertaut.length, 1);
  const ok = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { konfirmasiBukanGanda: true }), { kunci: kunci() }); assert.equal(ok.entri.status, "DIAJUKAN");
  // Catatan historis tertahan di unit U2 sebagai sumber.
  const batch = await testPrisma.usageImportBatch.create({ data: { sourceKind: "EXCEL_ADMIN_SALES_CSV", fileName: "uji.csv", fileSha256: createHash("sha256").update(randomUUID()).digest("hex"), rowCount: 1 } });
  const note = await testPrisma.unitUsageNote.create({ data: { batchId: batch.id, origin: "EXCEL", sourceKey: `uji:${randomUUID()}`, sourceRow: 1, rawRow: {}, rawName: "KAIN UJI SO", rawQty: "1,5", rawUom: "METER", orderNumber: "RES-UJI-002", orderId: w.o2.order.id, unitId: w.o2.unit.id, qty: "1.5", uom: "METER", usedAt: WIB(H(7)), materialId: w.mx.id, state: "PERLU_DICEK" } });
  let r = await rincianUnit(testPrisma, w.o2.unit.id); assert.equal(r.catatanTertahan.length, 1); assert.equal(r.catatanTertahan[0].jalurDisarankan, "BIAYA_TANPA_STOK"); assert.equal(r.status.key, "BELUM_LENGKAP");
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { unitId: w.o2.unit.id, qty: 2, tanggalPemakaian: H(7), sumberJenis: "CATATAN_HISTORIS", sumberRef: note.id }), { kunci: kunci() }), "SUMBER_CATATAN_TIDAK_COCOK");
  const n = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { unitId: w.o2.unit.id, qty: 1.5, tanggalPemakaian: H(7), sumberJenis: "CATATAN_HISTORIS", sumberRef: note.id }), { kunci: kunci() });
  r = await rincianUnit(testPrisma, w.o2.unit.id); assert.equal(r.catatanTertahan.length, 0, "catatan sumber tidak dihitung lagi sebagai tertahan"); assert.equal(r.status.key, "MENUNGGU_PERSETUJUAN");
  await assert.rejects(testPrisma.orderBiayaTanpaStok.create({ data: { unitId: w.o2.unit.id, orderId: w.o2.order.id, materialId: w.mx.id, qty: "1.5", satuan: "METER", tanggalPemakaian: new Date(`${H(8)}T00:00:00Z`), soTanggal: new Date(`${H(4)}T00:00:00Z`), statusHarga: "TANPA_HARGA", basisHarga: "x", sidikHarga: "x", sumberJenis: "CATATAN_HISTORIS", sumberRef: note.id, bukti: "xxxxx", alasan: "xxxxx", diajukanOleh: w.P.id, idempotencyKey: kunci() } }), /Unique|obts_satu_sumber_catatan/, "satu catatan = satu biaya aktif");
  await setujuiBiayaTanpaStok(testPrisma, w.F, { id: n.entri.id });
  assert.equal((await rincianUnit(testPrisma, w.o2.unit.id)).status.key, "SIAP_DIKONFIRMASI");
});

test("H5. antrean + konfirmasi: ada pemakaian belum otomatis lengkap; sidik basi menolak; baris berubah → BASI; konfirmasi ulang", async () => {
  const w = await dunia();
  let q = await antreanHpp(testPrisma, { fromStr: H(9), toStr: H(0) });
  assert.equal(q.ringkasan.unit, 2); assert.equal(q.ringkasan.perStatus.BELUM_ADA_PEMAKAIAN, 2); assert.equal(q.ringkasan.hppLengkap, 0); assert.ok(q.tautanSO.tanggalSO.includes(H(4)));
  const a = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w), { kunci: kunci() }); await setujuiBiayaTanpaStok(testPrisma, w.F, { id: a.entri.id });
  q = await antreanHpp(testPrisma, { fromStr: H(9), toStr: H(0) });
  const u1 = q.baris.find((b) => b.unitId === w.o1.unit.id);
  assert.equal(u1.status, "SIAP_DIKONFIRMASI"); assert.equal(u1.adaPemakaian, true); assert.equal(u1.lengkap, false, "ada pemakaian ≠ HPP lengkap"); assert.equal(u1.nilaiDiketahui, null, "tanpa izin harga: nominal disembunyikan");
  await tolakKode(konfirmasiLengkap(testPrisma, w.P, { unitId: w.o1.unit.id, sidik: "basi", alasan: "Diperiksa PIC dengan buku kerja" }, { kunci: kunci() }), "SIDIK_BERGESER");
  await tolakKode(konfirmasiLengkap(testPrisma, w.P, { unitId: w.o2.unit.id, sidik: "x", alasan: "Diperiksa PIC dengan buku kerja" }, { kunci: kunci() }), "BELUM_SIAP_DIKONFIRMASI");
  await konfirmasiLengkap(testPrisma, w.P, { unitId: w.o1.unit.id, sidik: u1.sidik, alasan: "Diperiksa PIC dengan buku kerja" }, { kunci: kunci() });
  q = await antreanHpp(testPrisma, { fromStr: H(9), toStr: H(0), izinHarga: true });
  assert.equal(q.baris.find((b) => b.unitId === w.o1.unit.id).status, "LENGKAP"); assert.equal(q.ringkasan.hppLengkap, 1); assert.equal(q.ringkasan.nilaiDiketahui, 37500);
  const b = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { tanggalPemakaian: H(5), qty: 1 }), { kunci: kunci() }); await setujuiBiayaTanpaStok(testPrisma, w.F, { id: b.entri.id });
  const r = await rincianUnit(testPrisma, w.o1.unit.id); assert.equal(r.status.key, "KONFIRMASI_BASI");
  await konfirmasiLengkap(testPrisma, w.P, { unitId: w.o1.unit.id, sidik: r.status.sidik, alasan: "Diperiksa ulang sesudah tambahan" }, { kunci: kunci() });
  assert.equal((await rincianUnit(testPrisma, w.o1.unit.id)).status.key, "LENGKAP");
  assert.equal(await testPrisma.unitHppKonfirmasi.count({ where: { unitId: w.o1.unit.id } }), 2); assert.equal(await testPrisma.unitHppKonfirmasi.count({ where: { unitId: w.o1.unit.id, status: "ACTIVE" } }), 1);
  assert.equal((await antreanHpp(testPrisma, { fromStr: H(9), toStr: H(0), status: "BELUM_ADA_PEMAKAIAN" })).baris.length, 1, "filter status");
});

test("H6. laporan berdampingan: jurnal | HPP operasional per order | hasil manajemen tanpa hitung ganda; order belum diakui terpisah; nominal hanya finance", async () => {
  const w = await dunia();
  const akun = async (c) => (await testPrisma.finAccount.findFirst({ where: { code: c } })).id;
  const kas = await akun("1-1100");
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: w.o1.order.id, userId: w.F.id, date: H(1) }));
  const jur = (kode, nilai) => testPrisma.$transaction(async (tx) => postJournal(tx, { date: H(1), description: `uji ${kode}`, source: "MANUAL", idempotencyKey: `uji:${randomUUID()}`, userId: w.F.id, lines: [{ accountId: await akun(kode), debit: nilai, description: "uji" }, { accountId: kas, credit: nilai, description: "uji" }] }));
  await jur("5-1200", 300000); await jur("5-1960", 999999); await jur("6-1100", 100000).catch(async () => jur((await testPrisma.finAccount.findFirst({ where: { type: "BEBAN", isPostable: true } })).code, 100000));
  const a = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w), { kunci: kunci() }); await setujuiBiayaTanpaStok(testPrisma, w.F, { id: a.entri.id }); // O1: 37.500
  const b = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { unitId: w.o2.unit.id, qty: 1, tanggalPemakaian: H(5) }), { kunci: kunci() }); await setujuiBiayaTanpaStok(testPrisma, w.F, { id: b.entri.id }); // O2 (belum diakui): 15.000
  const L = await laporanHppOrder(testPrisma, { fromStr: H(9), toStr: H(0), izinHarga: true });
  assert.equal(L.jurnal.ringkasan.pendapatanBersih, 2000000);
  assert.equal(L.operasional.cakupan.orderDiakui, 1); assert.equal(L.operasional.order[0].orderNomor, "RES-UJI-001"); assert.equal(L.operasional.order[0].status, "PARSIAL", "belum dikonfirmasi → belum lengkap");
  assert.equal(L.operasional.bahanDiakui, 37500, "hanya order berpendapatan diakui");
  assert.equal(L.operasional.belumDiakui.order.length, 1); assert.equal(L.operasional.belumDiakui.order[0].orderNomor, "RES-UJI-002"); assert.equal(L.operasional.belumDiakui.nilaiDiketahui, 15000);
  const v = Object.fromEntries(L.manajemen.baris.map((x) => [x.kunci, x.nilai]));
  assert.equal(v.bahan, 37500); assert.equal(v.upah, 300000); assert.equal(v.hpp, 337500, "5-1960 (selisih SO lama) tidak masuk HPP manajemen");
  assert.ok(L.manajemen.dikeluarkan.akun.some((x) => x.kode === "5-1960" && x.nilai === 999999));
  assert.equal(L.manajemen.status, "SEMENTARA"); assert.equal(L.manajemen.final, false);
  assert.equal(v.laba, 2000000 - 337500 - L.jurnal.ringkasan.bebanOperasional);
  // HTTP: PIC melihat cakupan, tanpa nominal; tanpa izin sama sekali → 403.
  const cpic = makeClient(server.baseUrl, w.pic.token);
  const h = await cpic.get(`/api/finance/hpp-order/laporan?from=${H(9)}&to=${H(0)}`); assert.equal(h.status, 200, JSON.stringify(h.body));
  assert.equal(h.body.jurnal, null); assert.equal(h.body.operasional.bahanDiakui, null); assert.equal(h.body.manajemen.baris, undefined); assert.equal(h.body.operasional.cakupan.orderDiakui, 1);
  const q = await cpic.get(`/api/finance/hpp-order/antrean?from=${H(9)}&to=${H(0)}`); assert.equal(q.status, 200); assert.equal(q.body.ringkasan.unit, 2);
  const gud = makeClient(server.baseUrl, (await createTestUser({ roles: ["SALES"] })).token); // tanpa finance:read / unit:material:write / laporan produksi
  assert.equal((await gud.get(`/api/finance/hpp-order/antrean?from=${H(9)}&to=${H(0)}`)).status, 403);
  const tanpaKunci = await cpic.post("/api/finance/hpp-order/biaya-tanpa-stok", dasar(w, { tanggalPemakaian: H(8) }));
  assert.equal(tanpaKunci.status, 400); assert.equal(tanpaKunci.body.code, "KUNCI_WAJIB");
  const viaHttp = await cpic.post("/api/finance/hpp-order/biaya-tanpa-stok", dasar(w, { tanggalPemakaian: H(8) }), { "Idempotency-Key": kunci() });
  assert.equal(viaHttp.status, 201, JSON.stringify(viaHttp.body)); assert.equal(viaHttp.body.entri.status, "DIAJUKAN");
});
