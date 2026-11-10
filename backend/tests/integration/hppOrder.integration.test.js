// HPP PER ORDER — tes terarah: jalur SO, biaya tanpa stok (sumber, persetujuan, audit, ganda, koreksi atomik), dasar harga, konfirmasi lengkap, antrean, jembatan laba.
// Dunia: bahan MX bertaut SO (tanggal SO = H-4) ber-Harga Berlaku Rp15.000 sejak H-30; bahan MY tanpa tautan SO; bahan MZ bertaut SO tanpa harga.
// Unit U1 (order O1) dan U2 (order O2) terkirim pada H-1. Pencatat = operator (PRODUCTION_WORKER, bukan admin) → butuh verifikasi; verifikator = PRODUCTION_LEAD (V); ADMIN/PRODUCTION_LEAD yang mencatat → langsung berlaku.
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
import { nyatakanTanpaBahanBaru } from "../../src/services/unitMaterialDeclarationService.js";
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
const TGL = (t) => new Date(`${t}T00:00:00Z`);
let seq = 0;
const kunci = () => `hpp-uji-${++seq}-${randomUUID().slice(0, 8)}`;
const HASH = "46cd9bcd0d763d9e5a2661d431ed998042257bb9eedc69eb9c1614cb5111a356";

async function dunia() {
  resetKeadaanEfektif();
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  await setSetting(testPrisma, SETTING_KEYS.SALDO_AWAL_CUTOFF, "2026-01-01");
  const pic = await createTestUser({ roles: ["PRODUCTION_WORKER"] }); const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] }); const fin = await createTestUser({ roles: ["FINANCE"] }); const admin = await createTestUser({ roles: ["ADMIN"] });
  const A = (u, r) => ({ id: u.user.id, name: u.user.name, roles: [r] });
  const mx = await createTestMaterial({ name: "KAIN UJI SO", unit: "METER" }); const my = await createTestMaterial({ name: "BUSA TANPA SO", unit: "SHEET" }); const mz = await createTestMaterial({ name: "BENANG TANPA HARGA", unit: "PCS" });
  for (const m of [mx, my, mz]) await seedBalance(m.id, 20, { createdAt: WIB(H(40)) });
  const hx = await testPrisma.materialHargaBerlaku.create({ data: { materialId: mx.id, unitPrice: "15000", satuan: "METER", effectiveFrom: WIB(H(30), "00:00"), createdAt: WIB(H(30), "00:00"), reason: "harga uji", idempotencyKey: kunci() } });
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
  return { pic, fin, admin, lead, P: A(pic, "PRODUCTION_WORKER"), V: A(lead, "PRODUCTION_LEAD"), F: A(fin, "FINANCE"), AD: A(admin, "ADMIN"), mx, my, mz, hx, o1, o2 };
}
const dasar = (w, over = {}) => ({ unitId: w.o1.unit.id, materialId: w.mx.id, qty: 2.5, tanggalPemakaian: H(6), sumberJenis: "LAPORAN_PIC", sumberRef: `Laporan PIC meja 2 baris ${++seq}`, bukti: "Laporan PIC uji, buku kerja meja 2", alasan: "Pemakaian sebelum SO belum tercatat", ...over });
const hitungTulisan = async () => ({ mv: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count() });
const saldo = async (m) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: m.id }, _sum: { qty: true } }))._sum.qty ?? 0);
const tolakKode = async (p, kode) => { await assert.rejects(p, (e) => { assert.equal(e.code, kode, `${e.code}: ${e.message}`); return true; }); };
const isiLangsung = (w, over = {}) => ({ unitId: w.o1.unit.id, orderId: w.o1.order.id, materialId: w.mx.id, qty: "1", satuan: "METER", tanggalPemakaian: TGL(H(6)), soTanggal: TGL(H(4)), statusHarga: "TANPA_HARGA", basisHarga: "x", sidikHarga: "x", sidikGanda: "x",
  sumberJenis: "LAPORAN_PIC", sumberRef: "rujukan langsung", bukti: "xxxxx", alasan: "xxxxx", diajukanOleh: w.P.id, idempotencyKey: kunci(), ...over });
const nilaiUnit = async (w, unitId) => (await rincianUnit(testPrisma, unitId, { izinHarga: true })).status.nilaiDiketahui;

test("H1. jalur: sesudah SO / tanpa tautan → stok resmi; pada/sebelum SO → biaya tanpa stok; sumber & rujukan wajib", async () => {
  const w = await dunia();
  const sesudah = await pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { tanggalPemakaian: H(2) }));
  assert.equal(sesudah.jalur.key, "STOK"); assert.equal(sesudah.boleh, false); assert.equal(sesudah.penghalang[0].kode, "JALUR_STOK_RESMI");
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { tanggalPemakaian: H(2) }), { kunci: kunci() }), "JALUR_STOK_RESMI");
  assert.equal((await pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { materialId: w.my.id, qty: 1 }))).jalur.key, "STOK", "bahan tanpa tautan SO tidak pernah lewat biaya tanpa stok");
  assert.equal((await pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { tanggalPemakaian: H(4) }))).jalur.key, "BIAYA_TANPA_STOK", "tanggal SAMA dengan SO tercakup SO");
  const pra = await pratinjauBiayaTanpaStok(testPrisma, w.F, dasar(w));
  assert.equal(pra.boleh, true); assert.equal(pra.harga.status, "DINILAI"); assert.equal(pra.harga.basis, "AWAL_HARI_TANPA_PERUBAHAN"); assert.equal(pra.harga.harga, 15000); assert.equal(pra.harga.nilai, 37500);
  assert.equal((await pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w))).harga.harga, null, "PIC tanpa finance:read tidak melihat nominal");
  await tolakKode(pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { tanggalPemakaian: H(25) })), "UNIT_TANGGAL_PEMAKAIAN_SEBELUM_UNIT");
  await tolakKode(pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { bukti: "" })), "BUKTI_WAJIB");
  await tolakKode(pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { sumberJenis: "" })), "SUMBER_WAJIB");
  await tolakKode(pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { sumberRef: " " })), "RUJUKAN_SUMBER_WAJIB");
});

test("H2. ajukan → setujui tanpa stok/jurnal; pemakaian sah berulang di hari yang sama boleh; sumber sama ditolak (layanan + database); audit + immutable", async () => {
  const w = await dunia(); const awal = await hitungTulisan(); const saldoAwal = await saldo(w.mx);
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w), { kunci: "" }), "KUNCI_WAJIB");
  const k = kunci(); const m1 = dasar(w, { sumberRef: "Lap PIC 03/11 baris 1" });
  const a = await ajukanBiayaTanpaStok(testPrisma, w.P, m1, { kunci: k });
  assert.equal(a.entri.status, "DIAJUKAN"); assert.equal(Number(a.entri.nilai), 37500); assert.equal(a.entri.sumberRef, "lap pic 03/11 baris 1", "rujukan dinormalkan");
  assert.equal((await ajukanBiayaTanpaStok(testPrisma, w.P, m1, { kunci: k })).ulang, true, "kunci idempotensi yang sama → entri yang sama");
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, { ...m1, sumberRef: "LAP PIC  03/11 BARIS 1", qty: 1 }, { kunci: kunci() }), "SUMBER_SUDAH_DIPAKAI");
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { sumberRef: "Lap PIC 03/11 baris 2" }), { kunci: kunci() }), "KEMUNGKINAN_GANDA"); // sumber lain, tanggal+jumlah sama: indikator, wajib alasan (bukan penolakan mutlak)
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 1, sumberRef: "Lap PIC 03/11 baris 2" }), { kunci: kunci() }), "KEMUNGKINAN_GANDA");
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 1, sumberRef: "Lap PIC 03/11 baris 2", konfirmasiBukanGanda: true }), { kunci: kunci() }), "KEMUNGKINAN_GANDA", "konfirmasi tanpa alasan tidak cukup");
  const a2 = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 1, sumberRef: "Lap PIC 03/11 baris 2", konfirmasiBukanGanda: true, alasanBukanGanda: "Pemakaian kedua: tambal sudut setelah jahit ulang" }), { kunci: kunci() });
  assert.equal(a.entri.status, "DIAJUKAN", "pencatat bukan admin → menunggu verifikasi");
  await tolakKode(setujuiBiayaTanpaStok(testPrisma, w.P, { id: a.entri.id }), "TIDAK_BERWENANG");
  await tolakKode(setujuiBiayaTanpaStok(testPrisma, w.F, { id: a.entri.id }), "TIDAK_BERWENANG", "Finance bukan verifikator jalur ini (keputusan Owner)");
  // ADMIN mencatat → langsung berlaku tanpa verifikasi kedua; jejak audit mencatat pencatat + perannya.
  const b = await ajukanBiayaTanpaStok(testPrisma, w.AD, dasar(w, { unitId: w.o2.unit.id, qty: 1 }), { kunci: kunci() });
  assert.equal(b.otomatis, true); assert.equal(b.entri.status, "DISETUJUI"); assert.equal(b.entri.diputuskanOleh, null); assert.match(b.entri.catatanKeputusan, /akun admin/);
  assert.deepEqual((await riwayatBiayaTanpaStok(testPrisma, b.entri.id)).map((e) => e.kind), ["DIAJUKAN", "OTOMATIS_ADMIN"]);
  assert.equal(await nilaiUnit(w, w.o2.unit.id), 15000, "langsung dihitung");
  assert.equal((await akhiriBiayaTanpaStok(testPrisma, w.AD, { id: b.entri.id, aksi: "BATALKAN", alasan: "salah unit, dibatalkan pencatat" })).entri.status, "DIBATALKAN");
  const bl = await ajukanBiayaTanpaStok(testPrisma, w.V, dasar(w, { unitId: w.o2.unit.id, qty: 1, sumberRef: "catatan lead uji" }), { kunci: kunci() });
  assert.equal(bl.entri.status, "DISETUJUI", "PRODUCTION_LEAD juga langsung berlaku");
  // Dua pemakaian sah pada unit+bahan+tanggal yang sama: keduanya bisa disetujui (yang diajukan belakangan tidak membatalkan persetujuan yang lebih dulu).
  assert.equal((await setujuiBiayaTanpaStok(testPrisma, w.V, { id: a.entri.id, catatan: "cocok laporan PIC" })).entri.status, "DISETUJUI");
  assert.equal((await setujuiBiayaTanpaStok(testPrisma, w.V, { id: a2.entri.id })).entri.status, "DISETUJUI");
  assert.equal(await nilaiUnit(w, w.o1.unit.id), 52500, "37.500 + 15.000, masing-masing sekali");
  const akhir = await hitungTulisan();
  assert.equal(akhir.mv, awal.mv, "tidak ada pergerakan stok baru"); assert.equal(akhir.jurnal, awal.jurnal, "tidak ada jurnal baru"); assert.equal(await saldo(w.mx), saldoAwal, "saldo bahan tidak berubah");
  assert.deepEqual((await riwayatBiayaTanpaStok(testPrisma, a2.entri.id)).map((e) => e.kind), ["DIAJUKAN", "DISETUJUI"]);
  assert.equal((await riwayatBiayaTanpaStok(testPrisma, a2.entri.id))[0].after.alasanBukanGanda, "Pemakaian kedua: tambal sudut setelah jahit ulang");
  await assert.rejects(testPrisma.orderBiayaTanpaStok.update({ where: { id: a.entri.id }, data: { qty: "9" } }), /immutable/);
  await assert.rejects(testPrisma.orderBiayaTanpaStok.update({ where: { id: a.entri.id }, data: { nilai: "1" } }), /immutable|obts_status_harga/);
  await assert.rejects(testPrisma.orderBiayaTanpaStok.delete({ where: { id: a.entri.id } }), /immutable/);
  await assert.rejects(testPrisma.orderBiayaTanpaStokEvent.deleteMany({ where: { entryId: a.entri.id } }), /immutable/);
  // Database: satu sumber hanya satu DISETUJUI dan satu DIAJUKAN, walau melewati layanan.
  await assert.rejects(testPrisma.orderBiayaTanpaStok.create({ data: isiLangsung(w, { sumberRef: a.entri.sumberRef, status: "DISETUJUI", diputuskanOleh: w.F.id }) }), /Unique|obts_sumber_satu_disetujui/);
  await testPrisma.orderBiayaTanpaStok.create({ data: isiLangsung(w, { sumberRef: "rujukan ganda db" }) });
  await assert.rejects(testPrisma.orderBiayaTanpaStok.create({ data: isiLangsung(w, { sumberRef: "rujukan ganda db" }) }), /Unique|obts_sumber_satu_diajukan/);
  await assert.rejects(testPrisma.orderBiayaTanpaStok.create({ data: isiLangsung(w, { tanggalPemakaian: TGL(H(2)) }) }), /obts_pra_so/, "database menolak tanggal sesudah SO");
});

test("H3. koreksi atomik dan dihitung sekali: selama pengganti diajukan hanya yang lama dihitung; sesudah disetujui hanya pengganti; database menolak dua yang berlaku", async () => {
  const w = await dunia();
  const a = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { sumberRef: "lap pic koreksi" }), { kunci: kunci() }); await setujuiBiayaTanpaStok(testPrisma, w.V, { id: a.entri.id });
  const kor = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 3, sumberRef: "lap pic koreksi", menggantikanId: a.entri.id, alasan: "Jumlah dikoreksi sesuai buku kerja" }), { kunci: kunci() });
  assert.equal(await nilaiUnit(w, w.o1.unit.id), 37500, "pengganti yang diajukan belum dihitung; yang lama masih berlaku");
  assert.equal((await rincianUnit(testPrisma, w.o1.unit.id)).status.key, "MENUNGGU_PERSETUJUAN");
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 4, sumberRef: "lap pic koreksi 2", menggantikanId: a.entri.id }), { kunci: kunci() }), "KOREKSI_SUDAH_DIAJUKAN");
  await assert.rejects(testPrisma.orderBiayaTanpaStok.update({ where: { id: kor.entri.id }, data: { status: "DISETUJUI", diputuskanOleh: w.F.id } }), /Unique|obts_sumber_satu_disetujui/, "tanpa mengganti yang lama lebih dulu, database menolak dua yang berlaku");
  const ks = await setujuiBiayaTanpaStok(testPrisma, w.V, { id: kor.entri.id });
  assert.equal(ks.entri.status, "DISETUJUI"); assert.equal(Number(ks.entri.nilai), 45000);
  assert.equal((await testPrisma.orderBiayaTanpaStok.findUnique({ where: { id: a.entri.id } })).status, "DIGANTI");
  assert.equal(await nilaiUnit(w, w.o1.unit.id), 45000, "hanya pengganti yang dihitung");
  assert.deepEqual((await riwayatBiayaTanpaStok(testPrisma, a.entri.id)).map((e) => e.kind), ["DIAJUKAN", "DISETUJUI", "DIGANTI"]);
  await assert.rejects(testPrisma.orderBiayaTanpaStok.update({ where: { id: a.entri.id }, data: { status: "DISETUJUI" } }), /immutable/, "status final tidak bisa dibuka lagi");
  await assert.rejects(testPrisma.orderBiayaTanpaStok.create({ data: isiLangsung(w, { sumberRef: "pengganti kedua", menggantikanId: a.entri.id }) }), /Unique|obts_satu_pengganti_aktif/, "satu entri hanya satu pengganti aktif");
});

test("H4. dasar harga: berubah sesudah diajukan → ditolak; berubah DI HARI pemakaian → PERLU_KEPUTUSAN (penyetuju memilih, beralasan); jam diketahui → harga jam itu; tanpa harga → belum diketahui", async () => {
  const w = await dunia();
  const a = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w), { kunci: kunci() });
  // perubahan harga di tengah hari H-6 (13:00 WIB)
  const hb = await testPrisma.materialHargaBerlaku.create({ data: { materialId: w.mx.id, unitPrice: "16000", satuan: "METER", effectiveFrom: WIB(H(6), "13:00"), createdAt: WIB(H(6), "13:00"), reason: "harga naik siang", idempotencyKey: kunci() } });
  await tolakKode(setujuiBiayaTanpaStok(testPrisma, w.V, { id: a.entri.id }), "DASAR_HARGA_BERGESER");
  const pra = await pratinjauBiayaTanpaStok(testPrisma, w.F, dasar(w));
  assert.equal(pra.harga.status, "PERLU_KEPUTUSAN"); assert.equal(pra.harga.nilai, null, "sistem tidak memilih diam-diam");
  assert.deepEqual(pra.harga.kandidat.map((k) => [k.priceId, k.harga]), [[w.hx.id, 15000], [hb.id, 16000]]);
  const p = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 2, konfirmasiBukanGanda: true, alasanBukanGanda: "Pemakaian kedua hari itu" }), { kunci: kunci() });
  assert.equal(p.entri.statusHarga, "PERLU_KEPUTUSAN"); assert.equal(p.entri.nilai, null);
  assert.equal((await rincianUnit(testPrisma, w.o1.unit.id)).status.key, "MENUNGGU_PERSETUJUAN");
  await tolakKode(setujuiBiayaTanpaStok(testPrisma, w.V, { id: p.entri.id }), "KEPUTUSAN_HARGA_WAJIB");
  await tolakKode(setujuiBiayaTanpaStok(testPrisma, w.V, { id: p.entri.id, keputusanHarga: { priceId: randomUUID(), alasan: "harga lain" } }), "KEPUTUSAN_HARGA_WAJIB");
  await tolakKode(setujuiBiayaTanpaStok(testPrisma, w.V, { id: p.entri.id, keputusanHarga: { priceId: hb.id, alasan: "" } }), "ALASAN_HARGA_WAJIB");
  const s = await setujuiBiayaTanpaStok(testPrisma, w.V, { id: p.entri.id, keputusanHarga: { priceId: hb.id, alasan: "PIC: dipakai sore, sesudah harga naik" } });
  assert.equal(s.entri.statusHarga, "DINILAI"); assert.equal(s.entri.basisHarga, "KEPUTUSAN_PENYETUJU"); assert.equal(Number(s.entri.nilai), 32000); assert.equal(s.entri.keputusanHargaOleh, w.V.id);
  await assert.rejects(testPrisma.orderBiayaTanpaStok.update({ where: { id: p.entri.id }, data: { hargaSatuan: "15000", nilai: "30000" } }), /terkunci|immutable/, "harga yang sudah diputuskan terkunci");
  // Admin mencatat pada hari harga berubah: TIDAK langsung berlaku (harga belum diputuskan) dan tidak bisa diputuskan sendiri; admin lain yang memutuskan.
  const pl = await ajukanBiayaTanpaStok(testPrisma, w.V, dasar(w, { qty: 0.5, sumberRef: "lap lead hari harga naik", konfirmasiBukanGanda: true, alasanBukanGanda: "Pemakaian terpisah oleh meja lain" }), { kunci: kunci() });
  assert.equal(pl.otomatis, false); assert.equal(pl.entri.status, "DIAJUKAN"); assert.equal(pl.entri.statusHarga, "PERLU_KEPUTUSAN");
  await tolakKode(setujuiBiayaTanpaStok(testPrisma, w.V, { id: pl.entri.id, keputusanHarga: { priceId: hb.id, alasan: "pilih sendiri" } }), "PENYETUJU_SAMA_DENGAN_PENGAJU");
  assert.equal((await setujuiBiayaTanpaStok(testPrisma, w.AD, { id: pl.entri.id, keputusanHarga: { priceId: w.hx.id, alasan: "Dipakai pagi menurut lembar kerja" } })).entri.status, "DISETUJUI");
  // jam diketahui dari sumber
  await tolakKode(pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { waktuPemakaian: `${H(5)}T09:00+07:00` })), "WAKTU_TIDAK_COCOK");
  await tolakKode(pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { waktuPemakaian: `${H(6)} 09:00` })), "WAKTU_TIDAK_VALID");
  const pagi = await pratinjauBiayaTanpaStok(testPrisma, w.F, dasar(w, { waktuPemakaian: `${H(6)}T09:00+07:00` }));
  assert.equal(pagi.harga.basis, "WAKTU_DIKETAHUI"); assert.equal(pagi.harga.harga, 15000);
  const sore = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 1, waktuPemakaian: `${H(6)}T15:30+07:00`, konfirmasiBukanGanda: true, alasanBukanGanda: "Pemakaian terpisah sore hari" }), { kunci: kunci() });
  assert.equal(sore.entri.basisHarga, "WAKTU_DIKETAHUI"); assert.equal(Number(sore.entri.hargaSatuan), 16000);
  // tanpa Harga Berlaku → TANPA_HARGA (null, bukan Rp0); disetujui pun unit tetap belum lengkap
  const t = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { unitId: w.o2.unit.id, materialId: w.mz.id, qty: 2 }), { kunci: kunci() });
  assert.equal(t.entri.statusHarga, "TANPA_HARGA"); assert.equal(t.entri.nilai, null);
  await setujuiBiayaTanpaStok(testPrisma, w.V, { id: t.entri.id });
  const r = await rincianUnit(testPrisma, w.o2.unit.id, { izinHarga: true }); assert.equal(r.status.key, "BELUM_LENGKAP"); assert.equal(r.status.barisTanpaNilai, 1); assert.equal(r.status.nilaiDiketahui, null);
});

test("H5. ganda vs ISSUE/catatan: tanggal+jumlah sama = indikator (alasan + persetujuan); kandidat baru sesudah diajukan menahan persetujuan; tautan transaksi sama = mutlak", async () => {
  const w = await dunia();
  await testPrisma.stockMovement.create({ data: { materialId: w.mx.id, unitId: w.o1.unit.id, type: "ISSUE", qty: -2.5, note: "pemakaian lama", createdAt: WIB(H(6)) } });
  const pr = await pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w));
  assert.equal(pr.boleh, true, "bukan penghalang mutlak"); assert.equal(pr.ganda.identik[0].kind, "ISSUE_UNIT"); assert.equal(pr.ganda.perluKonfirmasi, true); assert.match(pr.ganda.teks, /indikator kuat/);
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w), { kunci: kunci() }), "KEMUNGKINAN_GANDA");
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { konfirmasiBukanGanda: true }), { kunci: kunci() }), "KEMUNGKINAN_GANDA", "tanpa alasan tidak cukup");
  const sah = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { konfirmasiBukanGanda: true, alasanBukanGanda: "ISSUE lama = panel atas (Gudang), ini panel bawah dari laporan PIC" }), { kunci: kunci() });
  assert.equal(sah.entri.kandidatGanda.identik.length, 1, "indikator identik tersimpan untuk penyetuju");
  assert.equal((await setujuiBiayaTanpaStok(testPrisma, w.V, { id: sah.entri.id })).entri.status, "DISETUJUI", "indikator yang sudah diakui pengaju tidak menolak persetujuan");
  const ok = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 1, konfirmasiBukanGanda: true, alasanBukanGanda: "Pemakaian ketiga, lembar kerja berbeda" }), { kunci: kunci() });
  // ISSUE lain (bahkan identik) muncul sesudah diajukan → persetujuan ditahan sampai pengaju memeriksa ulang
  await testPrisma.stockMovement.create({ data: { materialId: w.mx.id, unitId: w.o1.unit.id, type: "ISSUE", qty: -1, note: "pemakaian identik baru", createdAt: WIB(H(6), "16:00") } });
  await tolakKode(setujuiBiayaTanpaStok(testPrisma, w.V, { id: ok.entri.id }), "KANDIDAT_GANDA_BERUBAH");
  // catatan historis tertahan di U2 sebagai sumber
  const batch = await testPrisma.usageImportBatch.create({ data: { sourceKind: "EXCEL_ADMIN_SALES_CSV", fileName: "uji.csv", fileSha256: createHash("sha256").update(randomUUID()).digest("hex"), rowCount: 1 } });
  const nb = (over) => testPrisma.unitUsageNote.create({ data: { batchId: batch.id, origin: "EXCEL", sourceKey: `uji:${randomUUID()}`, sourceRow: ++seq, rawRow: {}, rawName: "KAIN UJI SO", rawQty: "1,5", rawUom: "METER", orderNumber: "RES-UJI-002", orderId: w.o2.order.id, unitId: w.o2.unit.id, qty: "1.5", uom: "METER", usedAt: WIB(H(7)), materialId: w.mx.id, state: "PERLU_DICEK", ...over } });
  const note = await nb();
  let r = await rincianUnit(testPrisma, w.o2.unit.id); assert.equal(r.catatanTertahan.length, 1); assert.equal(r.catatanTertahan[0].jalurDisarankan, "BIAYA_TANPA_STOK");
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { unitId: w.o2.unit.id, qty: 2, tanggalPemakaian: H(7), sumberJenis: "CATATAN_HISTORIS", sumberRef: note.id }), { kunci: kunci() }), "SUMBER_CATATAN_TIDAK_COCOK");
  const n = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { unitId: w.o2.unit.id, qty: 1.5, tanggalPemakaian: H(7), sumberJenis: "CATATAN_HISTORIS", sumberRef: note.id }), { kunci: kunci() });
  r = await rincianUnit(testPrisma, w.o2.unit.id); assert.equal(r.catatanTertahan.length, 0, "catatan sumber tidak dihitung lagi sebagai tertahan"); assert.equal(r.status.key, "MENUNGGU_PERSETUJUAN");
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { unitId: w.o2.unit.id, qty: 1.5, tanggalPemakaian: H(7), sumberJenis: "CATATAN_HISTORIS", sumberRef: note.id }), { kunci: kunci() }), "SUMBER_SUDAH_DIPAKAI");
  // catatan LAIN yang identik muncul sesudah diajukan (impor ganda) → persetujuan ditahan (kandidat baru), bukan diloloskan
  const kembar = await nb();
  await tolakKode(setujuiBiayaTanpaStok(testPrisma, w.V, { id: n.entri.id }), "KANDIDAT_GANDA_BERUBAH");
  await testPrisma.unitUsageNote.update({ where: { id: kembar.id }, data: { state: "TIDAK_DIHITUNG" } }); resetKeadaanEfektif();
  await setujuiBiayaTanpaStok(testPrisma, w.V, { id: n.entri.id });
  assert.equal((await rincianUnit(testPrisma, w.o2.unit.id)).status.key, "SIAP_DIKONFIRMASI", "catatan sumber + biaya dihitung sekali");
  // TAUTAN TRANSAKSI SAMA = MUTLAK: catatan yang sudah tertaut ke pengeluaran stok tidak bisa jadi biaya tanpa stok, walau beralasan
  const mvLama = await testPrisma.stockMovement.create({ data: { materialId: w.mx.id, unitId: w.o2.unit.id, type: "ISSUE", qty: -0.7, note: "issue lama tertaut catatan", createdAt: WIB(H(8)) } });
  const tertaut = await nb({ qty: "0.7", usedAt: WIB(H(8)), stockMovementId: mvLama.id, linkKind: "ISSUE_LAMA_SAMA" });
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { unitId: w.o2.unit.id, qty: 0.7, tanggalPemakaian: H(8), sumberJenis: "CATATAN_HISTORIS", sumberRef: tertaut.id, konfirmasiBukanGanda: true, alasanBukanGanda: "dicoba walau tertaut" }), { kunci: kunci() }), "SUMBER_CATATAN_SUDAH_DIPROSES");
  // catatan yang diposting ke stok SESUDAH diajukan → persetujuan ditolak mutlak
  const lepas = await nb({ qty: "0.3", usedAt: WIB(H(9)) });
  const e3 = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { unitId: w.o2.unit.id, qty: 0.3, tanggalPemakaian: H(9), sumberJenis: "CATATAN_HISTORIS", sumberRef: lepas.id, konfirmasiBukanGanda: true, alasanBukanGanda: "catatan terpisah, belum tercatat" }), { kunci: kunci() });
  const mvPost = await testPrisma.stockMovement.create({ data: { materialId: w.mx.id, unitId: w.o2.unit.id, type: "ISSUE", qty: -0.3, note: "posting historis", createdAt: WIB(H(1)) } });
  await testPrisma.unitUsageNote.update({ where: { id: lepas.id }, data: { state: "DIPOSTING", stockMovementId: mvPost.id, linkKind: "POSTING_HISTORIS" } }); resetKeadaanEfektif();
  await tolakKode(setujuiBiayaTanpaStok(testPrisma, w.V, { id: e3.entri.id }), "SUMBER_CATATAN_SUDAH_DIPROSES");
});

test("H8. dua pemakaian SAH: sumber berbeda, tanggal sama, jumlah sama → keduanya tercatat dengan alasan + verifikasi ADMIN/PRODUCTION_LEAD (bukan pencatat), dihitung dua kali", async () => {
  const w = await dunia();
  const utama = await createTestUser({ roles: ["PRODUCTION_LEAD"] }); const cadangan = await createTestUser({ roles: ["ADMIN"] });
  const U = { id: utama.user.id, name: utama.user.name, roles: ["PRODUCTION_LEAD"] }; const C = { id: cadangan.user.id, name: cadangan.user.name, roles: ["ADMIN"] };
  const a = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 2, sumberJenis: "LAPORAN_PIC", sumberRef: "laporan PIC 03/11 meja 2 baris 4" }), { kunci: kunci() });
  const pr = await pratinjauBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 2, sumberJenis: "DOKUMEN", sumberRef: "foto lembar kerja meja 5 IMG_0412" }));
  assert.equal(pr.boleh, true); assert.equal(pr.ganda.identik.length, 1, "entri pertama terdeteksi sebagai indikator kuat"); assert.equal(pr.ganda.identik[0].kind, "BIAYA_TANPA_STOK");
  await tolakKode(ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 2, sumberJenis: "DOKUMEN", sumberRef: "foto lembar kerja meja 5 IMG_0412" }), { kunci: kunci() }), "KEMUNGKINAN_GANDA");
  const b = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 2, sumberJenis: "DOKUMEN", sumberRef: "foto lembar kerja meja 5 IMG_0412", konfirmasiBukanGanda: true,
    alasanBukanGanda: "Dua kasur berbeda di meja 2 dan meja 5 pada hari yang sama; tiap lembar kerja ditandatangani PIC masing-masing" }), { kunci: kunci() });
  assert.equal(b.entri.status, "DIAJUKAN"); assert.equal(b.entri.kandidatGanda.identik.length, 1);
  await tolakKode(setujuiBiayaTanpaStok(testPrisma, w.P, { id: b.entri.id }), "TIDAK_BERWENANG", "pencatat bukan admin tidak bisa memverifikasi");
  assert.equal((await setujuiBiayaTanpaStok(testPrisma, U, { id: a.entri.id })).entri.status, "DISETUJUI", "verifikator PRODUCTION_LEAD");
  assert.equal((await setujuiBiayaTanpaStok(testPrisma, C, { id: b.entri.id })).entri.status, "DISETUJUI", "verifikator ADMIN");
  assert.equal(await nilaiUnit(w, w.o1.unit.id), 60000, "2 × (2 × 15.000): keduanya dihitung, masing-masing sekali");
  const ev = await riwayatBiayaTanpaStok(testPrisma, b.entri.id);
  assert.equal(ev[0].after.kandidatGandaIdentik, 1); assert.match(ev[0].after.alasanBukanGanda, /meja 2 dan meja 5/); assert.equal(ev[1].actorId, C.id);
});

test("H6. konfirmasi lengkap ditolak bila biaya kosong / sumber tertunda / menunggu persetujuan; sidik basi; pernyataan tanpa bahan diaudit", async () => {
  const w = await dunia();
  let q = await antreanHpp(testPrisma, { fromStr: H(9), toStr: H(0) });
  assert.equal(q.ringkasan.unit, 2); assert.equal(q.ringkasan.perStatus.BELUM_ADA_PEMAKAIAN, 2); assert.equal(q.ringkasan.hppLengkap, 0);
  const tolakKonf = async (unitId, sidik = "x") => tolakKode(konfirmasiLengkap(testPrisma, w.P, { unitId, sidik, alasan: "Diperiksa PIC dengan buku kerja" }, { kunci: kunci() }), "BELUM_SIAP_DIKONFIRMASI");
  await tolakKonf(w.o1.unit.id); // belum ada pemakaian
  const a = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w), { kunci: kunci() });
  await tolakKonf(w.o1.unit.id); // menunggu persetujuan
  await setujuiBiayaTanpaStok(testPrisma, w.V, { id: a.entri.id });
  const t = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { materialId: w.mz.id, qty: 1 }), { kunci: kunci() }); await setujuiBiayaTanpaStok(testPrisma, w.V, { id: t.entri.id });
  await assert.rejects(konfirmasiLengkap(testPrisma, w.P, { unitId: w.o1.unit.id, sidik: "x", alasan: "Diperiksa PIC dengan buku kerja" }, { kunci: kunci() }), (e) => { assert.equal(e.code, "BELUM_SIAP_DIKONFIRMASI"); assert.equal(e.detail.biayaKosong, 1); return true; }, "biaya kosong (tanpa harga) menolak konfirmasi");
  await akhiriBiayaTanpaStok(testPrisma, w.V, { id: t.entri.id, aksi: "BATALKAN", alasan: "Bahan salah pilih, dibatalkan" });
  // catatan historis tertunda menolak konfirmasi
  const batch = await testPrisma.usageImportBatch.create({ data: { sourceKind: "EXCEL_ADMIN_SALES_CSV", fileName: "uji2.csv", fileSha256: createHash("sha256").update(randomUUID()).digest("hex"), rowCount: 1 } });
  const note = await testPrisma.unitUsageNote.create({ data: { batchId: batch.id, origin: "EXCEL", sourceKey: `uji:${randomUUID()}`, sourceRow: 1, rawRow: {}, rawName: "KAIN", rawQty: "1", rawUom: "METER", orderNumber: "RES-UJI-001", orderId: w.o1.order.id, unitId: w.o1.unit.id, qty: "1", uom: "METER", usedAt: WIB(H(8)), materialId: w.mx.id, state: "PERLU_DICEK" } });
  resetKeadaanEfektif();
  await tolakKonf(w.o1.unit.id);
  await testPrisma.unitUsageNote.update({ where: { id: note.id }, data: { state: "TIDAK_DIHITUNG" } }); resetKeadaanEfektif();
  q = await antreanHpp(testPrisma, { fromStr: H(9), toStr: H(0) });
  const u1 = q.baris.find((b) => b.unitId === w.o1.unit.id);
  assert.equal(u1.status, "SIAP_DIKONFIRMASI"); assert.equal(u1.lengkap, false, "ada pemakaian ≠ HPP lengkap"); assert.equal(u1.nilaiDiketahui, null, "tanpa izin harga: nominal disembunyikan");
  await tolakKode(konfirmasiLengkap(testPrisma, w.P, { unitId: w.o1.unit.id, sidik: "basi", alasan: "Diperiksa PIC dengan buku kerja" }, { kunci: kunci() }), "SIDIK_BERGESER");
  await konfirmasiLengkap(testPrisma, w.P, { unitId: w.o1.unit.id, sidik: u1.sidik, alasan: "Diperiksa PIC dengan buku kerja" }, { kunci: kunci() });
  assert.equal((await rincianUnit(testPrisma, w.o1.unit.id)).status.key, "LENGKAP");
  const b = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { tanggalPemakaian: H(5), qty: 1, konfirmasiBukanGanda: true, alasanBukanGanda: "Pemakaian hari berbeda" }), { kunci: kunci() }); await setujuiBiayaTanpaStok(testPrisma, w.V, { id: b.entri.id });
  const r = await rincianUnit(testPrisma, w.o1.unit.id); assert.equal(r.status.key, "KONFIRMASI_BASI");
  await konfirmasiLengkap(testPrisma, w.P, { unitId: w.o1.unit.id, sidik: r.status.sidik, alasan: "Diperiksa ulang sesudah tambahan" }, { kunci: kunci() });
  assert.equal(await testPrisma.unitHppKonfirmasi.count({ where: { unitId: w.o1.unit.id } }), 2); assert.equal(await testPrisma.unitHppKonfirmasi.count({ where: { unitId: w.o1.unit.id, status: "ACTIVE" } }), 1);
  // pernyataan "tanpa bahan baru" (U2): tercatat pelaku/alasan/waktu + jejak aktivitas; tampil di antrean
  await nyatakanTanpaBahanBaru(testPrisma, { unitId: w.o2.unit.id, alasan: "Servis jahit ulang, tanpa bahan baru", actorId: w.P.id, idempotencyKey: kunci() });
  q = await antreanHpp(testPrisma, { fromStr: H(9), toStr: H(0) });
  const u2 = q.baris.find((x) => x.unitId === w.o2.unit.id);
  assert.equal(u2.status, "TANPA_BAHAN_BARU"); assert.equal(u2.pernyataan.alasan, "Servis jahit ulang, tanpa bahan baru"); assert.ok(u2.pernyataan.pada); assert.equal(u2.pernyataan.oleh, w.P.name);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: w.o2.unit.id, eventType: "PRODUCTION_PERNYATAAN_TANPA_BAHAN" } }), 1);
  assert.equal((await antreanHpp(testPrisma, { fromStr: H(9), toStr: H(0), status: "LENGKAP" })).baris.length, 1, "filter status");
});

test("H7. jembatan laba jurnal → hasil manajemen: per baris (bukan per akun), kontrol cocok, tidak ada biaya hilang/ganda; nominal hanya finance", async () => {
  const w = await dunia();
  const akun = async (c) => (await testPrisma.finAccount.findFirst({ where: { code: c } })).id;
  const kas = await akun("1-1100"); const pers = await akun("1-1400");
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: w.o1.order.id, userId: w.F.id, date: H(1) }));
  const jur = (kode, nilai, { tanggal = H(1), source = "MANUAL", sourceId = null, unitId = null, lawan = kas } = {}) => testPrisma.$transaction(async (tx) => postJournal(tx, { date: tanggal, description: `uji ${kode}`, source, sourceId, idempotencyKey: `uji:${randomUUID()}`, userId: w.F.id,
    lines: [{ accountId: await akun(kode), debit: nilai, description: "uji", unitId }, { accountId: lawan, credit: nilai, description: "uji" }] }));
  const gerak = async (unit, type, qty, nilai, tanggal) => {
    const m = await testPrisma.stockMovement.create({ data: { materialId: w.mx.id, unitId: unit.id, type, qty, note: `uji ${type}`, createdAt: WIB(tanggal) } });
    if (nilai != null) await testPrisma.stockMovementBiayaOperasional.create({ data: { movementId: m.id, materialId: w.mx.id, unitId: unit.id, status: "DINILAI", qty: String(Math.abs(qty)), unitCost: "15000", value: String(nilai), priceId: w.hx.id, sumber: "BEKU_SAAT_POSTING" } });
    return m;
  };
  // O1 (diakui): ISSUE bernilai 30.000 operasional, jurnal 28.000 → TERWAKILI (dibalik 28.000, diganti 30.000)
  const m1 = await gerak(w.o1.unit, "ISSUE", -2, 30000, H(3)); await jur("5-1100", 28000, { source: "PEMAKAIAN_BAHAN", sourceId: m1.id, unitId: w.o1.unit.id, lawan: pers, tanggal: H(3) });
  // O1: ISSUE belum bernilai operasional, jurnal 12.000 → nilai jurnal dipakai (tetap dihitung)
  const m2 = await gerak(w.o1.unit, "ISSUE", -1, null, H(3)); await jur("5-1100", 12000, { source: "PEMAKAIAN_BAHAN", sourceId: m2.id, unitId: w.o1.unit.id, lawan: pers, tanggal: H(3) });
  // O2 (belum diakui): ISSUE dijurnal 8.000 → ORDER_BELUM_DIAKUI
  const m3 = await gerak(w.o2.unit, "ISSUE", -1, 15000, H(3)); await jur("5-1100", 8000, { source: "PEMAKAIAN_BAHAN", sourceId: m3.id, unitId: w.o2.unit.id, lawan: pers, tanggal: H(3) });
  // O1: susut bernilai 4.000 BELUM dijurnal → ditambahkan; susut lain dijurnal 2.500 → dihitung dari jurnal
  await gerak(w.o1.unit, "WASTE", -0.2, 4000, H(2));
  const m5 = await gerak(w.o1.unit, "WASTE", -0.1, 1500, H(2)); await jur("5-1900", 2500, { source: "PEMAKAIAN_BAHAN", sourceId: m5.id, unitId: w.o1.unit.id, lawan: pers, tanggal: H(2) });
  await jur("5-1200", 300000); await jur("5-1150", 70000); await jur("5-1950", 5000);
  // Koreksi saldo: ditentukan DOKUMEN ASAL + periode yang dikoreksinya, bukan tanggal jurnal
  const psaLama = await testPrisma.finInventoryOpening.create({ data: { number: "PA-UJI-LAMA", cutoverDate: TGL(H(12)), countedAt: WIB(H(13), "18:00"), status: "DIPOSTING" } });
  await jur("5-1100", 500000, { tanggal: H(2), source: "PERSEDIAAN_AWAL", sourceId: psaLama.id, lawan: pers }); // jurnal DALAM periode, mengoreksi saldo s.d. H-13 → saldo lama
  const psaIni = await testPrisma.finInventoryOpening.create({ data: { number: "PA-UJI-INI", cutoverDate: TGL(H(4)), countedAt: WIB(H(5), "18:00"), status: "DIPOSTING" } });
  await jur("5-1100", 7000, { tanggal: H(4), source: "PERSEDIAAN_AWAL", sourceId: psaIni.id, lawan: pers }); // mengoreksi s.d. H-5 (dalam periode) → TIDAK dibalik
  const bt = await testPrisma.usageImportBatch.create({ data: { sourceKind: "EXCEL_ADMIN_SALES_CSV", fileName: "uji-koreksi.csv", fileSha256: createHash("sha256").update(randomUUID()).digest("hex"), rowCount: 1 } });
  const noteLama = await testPrisma.unitUsageNote.create({ data: { batchId: bt.id, origin: "EXCEL", sourceKey: `uji:${randomUUID()}`, sourceRow: 1, rawRow: {}, rawName: "KAIN UJI SO", rawQty: "3", rawUom: "METER", orderNumber: "RES-UJI-LAMA", qty: "3", uom: "METER", usedAt: WIB(H(15)), materialId: w.mx.id, state: "TIDAK_DIHITUNG" } });
  const adj = await testPrisma.stockAdjustmentRequest.create({ data: { adjustmentNumber: "ADJ-UJI-01", adjustmentType: "DATA_CORRECTION", materialId: w.mx.id, beforeQty: 20, adjustmentQty: -3, reason: "koreksi pemakaian lama", status: "POSTED", originType: "USAGE_NOTE", originId: noteLama.id } });
  await jur("5-1960", 999999, { tanggal: H(1), source: "PEMAKAIAN_BAHAN", sourceId: adj.id, lawan: pers }); // jurnal H-1, mengoreksi pemakaian H-15 → saldo lama
  await jur("5-1960", 40000, { tanggal: H(5) }); // tanpa dokumen koreksi: tanggal sebelum/sesudah SO TIDAK menentukan → tetap dihitung, perlu klasifikasi
  await jur("5-1960", 3000, { tanggal: H(1) });
  const a = await ajukanBiayaTanpaStok(testPrisma, w.P, dasar(w, { qty: 1, konfirmasiBukanGanda: true, alasanBukanGanda: "Pemakaian pra-SO terpisah dari ISSUE uji" }), { kunci: kunci() }); await setujuiBiayaTanpaStok(testPrisma, w.V, { id: a.entri.id }); // O1 biaya tanpa stok 15.000
  const L = await laporanHppOrder(testPrisma, { fromStr: H(9), toStr: H(0), izinHarga: true });
  const M = L.manajemen; const kel = Object.fromEntries(M.kelompok.map((k) => [k.key, k.nilai]));
  assert.equal(M.kontrol.cocok, true, JSON.stringify(M.kontrol));
  assert.equal(kel.TERWAKILI_HPP_OPERASIONAL, 28000); assert.equal(kel.ORDER_BELUM_DIAKUI, 8000);
  assert.equal(kel.KOREKSI_SALDO_LAMA, 500000 + 999999, "hanya PSA lama + penyesuaian berasal pemakaian lama");
  assert.equal(kel.PERLU_KLASIFIKASI, 40000 + 3000, "5-1960 tanpa dokumen koreksi tidak dibalik, apa pun tanggal jurnalnya");
  assert.equal(kel.BEBAN_TETAP_DIHITUNG, 12000 + 2500 + 300000 + 70000 + 5000 + 7000, "PSA yang mengoreksi periode ini, 5-1150/5-1900/5-1950, dan pemakaian bernilai jurnal tetap dihitung");
  const alasan = (kode, nilai) => M.barisJurnal.find((x) => x.akunKode === kode && x.nilai === nilai)?.alasan ?? "";
  assert.match(alasan("5-1100", 500000), /PA-UJI-LAMA.*mengoreksi saldo s\.d\./); assert.match(alasan("5-1960", 999999), /ADJ-UJI-01/); assert.match(alasan("5-1100", 7000), /periode laporan ini/);
  assert.equal(L.operasional.bahanDiakui, 30000 + 15000, "pergerakan yang nilai jurnalnya dipakai tidak ikut nilai operasional");
  assert.equal(L.operasional.susutBelumDijurnal, 4000, "susut yang sudah dijurnal tidak ditambahkan lagi");
  const v = Object.fromEntries(M.baris.map((x) => [x.kunci, x.nilai]));
  assert.equal(v.hpp, 45000 + 4000 + 300000 + (12000 + 2500 + 70000 + 5000 + 7000) + (40000 + 3000));
  assert.equal(v.laba, L.jurnal.ringkasan.pendapatanBersih - v.hpp - L.jurnal.ringkasan.bebanOperasional);
  const j = Object.fromEntries(M.jembatan.map((x) => [x.kunci, x.nilai]));
  assert.equal(j.laba_jurnal, L.jurnal.ringkasan.labaBersih); assert.equal(j.hasil, v.laba);
  assert.ok(M.barisJurnal.every((r) => r.kelompok && r.alasan), "setiap baris jurnal punya kelompok + alasan");
  assert.equal(L.operasional.belumDiakui.order[0].orderNomor, "RES-UJI-002");
  assert.equal(M.status, "SEMENTARA"); assert.equal(M.final, false);
  // HTTP: PIC melihat cakupan tanpa nominal; tanpa izin → 403; tulis tanpa kunci → 400.
  const cpic = makeClient(server.baseUrl, w.pic.token);
  const h = await cpic.get(`/api/finance/hpp-order/laporan?from=${H(9)}&to=${H(0)}`); assert.equal(h.status, 200, JSON.stringify(h.body));
  assert.equal(h.body.jurnal, null); assert.equal(h.body.operasional.bahanDiakui, null); assert.equal(h.body.manajemen.baris, undefined); assert.equal(h.body.manajemen.kontrolCocok, true);
  const gud = makeClient(server.baseUrl, (await createTestUser({ roles: ["SALES"] })).token);
  assert.equal((await gud.get(`/api/finance/hpp-order/antrean?from=${H(9)}&to=${H(0)}`)).status, 403);
  const tanpaKunci = await cpic.post("/api/finance/hpp-order/biaya-tanpa-stok", dasar(w, { tanggalPemakaian: H(8) }));
  assert.equal(tanpaKunci.status, 400); assert.equal(tanpaKunci.body.code, "KUNCI_WAJIB");
  const viaHttp = await cpic.post("/api/finance/hpp-order/biaya-tanpa-stok", dasar(w, { tanggalPemakaian: H(8), qty: 0.5 }), { "Idempotency-Key": kunci() });
  assert.equal(viaHttp.status, 409, "kandidat ganda (ISSUE unit) menuntut konfirmasi beralasan"); assert.equal(viaHttp.body.code, "KEMUNGKINAN_GANDA");
});
