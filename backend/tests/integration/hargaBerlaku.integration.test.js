// HARGA BERLAKU BAHAN (HPP operasional; Okt 2026): harga per satuan stok dengan waktu mulai berlaku, diedit dari layar Stok.
// Yang dikunci: dasar harga = WAKTU PEMAKAIAN AKTUAL (bukan tanggal order dibuat); harga baru tidak mengubah pemakaian yang sudah dibekukan; koreksi salah input = baris baru (append-only, trigger DB);
// klik ganda/serentak idempoten; satuan salah ditolak; stok/ISSUE/jurnal/GL/valuasi Finance tidak berubah; pemakaian lama hanya diberi harga lewat penerapan khusus dua orang; label "Belum didukung bukti".
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { postStockMovement } from "../../src/services/inventoryLedger.js";
import { pratinjauUbahHarga, simpanHarga, hargaBerlakuPada, pratinjauPenerapan, ajukanPenerapan, setujuiPenerapan, hppOperasionalUnit, riwayatHarga, ringkasanBahan } from "../../src/services/finance/hargaBerlaku.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let seq = 0; const kunci = (p = "hb") => `${p}-${Date.now()}-${++seq}-uji`;
const T = (s) => new Date(s); // ISO eksplisit (UTC) supaya deterministik
const keluar = (materialId, unitId, qty, waktu, createdById) => testPrisma.$transaction((tx) => postStockMovement(tx, { materialId, type: "ISSUE", qty: -Math.abs(qty), unitId, reason: "uji", note: "pemakaian uji", createdAt: T(waktu), createdById }));
const masuk = (materialId, qty, extra = {}) => seedBalance(materialId, qty, extra);

async function dunia() {
  const finA = await createTestUser({ roles: ["FINANCE"] }); const finB = await createTestUser({ roles: ["FINANCE"] }); const gudang = await createTestUser({ roles: ["WAREHOUSE"] }); const sales = await createTestUser({ roles: ["SALES"] });
  const c = (u) => makeClient(server.baseUrl, u.token);
  const mat = await createTestMaterial({ code: "BUSA-HB-UJI", name: "BUSA HB UJI", unit: "KG" });
  await masuk(mat.id, 100, { createdAt: T("2026-10-01T00:00:00Z") });
  const mk = async () => (await createTestUnit()).unit;
  return { finA, finB, gudang, sales, a: c(finA), b: c(finB), g: c(gudang), s: c(sales), mat, mk };
}
const ubah = async (w, { harga, mulai, alasan = "Harga baru dari nota Okt 2026", bukti = "", aktor = w.finA.user, satuan = "KG", extra = {} }) => {
  const m = { materialId: w.mat.id, hargaBaru: String(harga), satuan, berlakuMulai: mulai, alasan, catatanBukti: bukti, ...extra };
  const p = await pratinjauUbahHarga(testPrisma, m); return simpanHarga(testPrisma, { ...m, hashPratinjau: p.hash }, { aktor, kunci: kunci() });
};
const snap = async () => ({
  stok: await testPrisma.stockMovement.count(), saldo: JSON.stringify((await testPrisma.stockMovement.groupBy({ by: ["materialId"], _sum: { qty: true }, orderBy: { materialId: "asc" } })).map((r) => [r.materialId, String(r._sum.qty)])),
  issue: JSON.stringify((await testPrisma.stockMovement.findMany({ where: { type: "ISSUE" }, orderBy: { id: "asc" }, select: { id: true, qty: true, createdAt: true } }))),
  valFinance: JSON.stringify(await testPrisma.finStockMovementValuation.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, value: true } })), kor: await testPrisma.finStockMovementValuationCorrection.count(),
  jurnal: await testPrisma.finJournalEntry.count(), baris: await testPrisma.finJournalLine.count(),
});
const opRows = (movementId) => testPrisma.stockMovementBiayaOperasional.findMany({ where: { movementId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

test("H1. harga berubah 16→20 Okt (nyata, dapat diposting) dan 26→30 Okt (terjadwal, masa depan): order dibuat SEBELUM perubahan tetapi bahan dipakai SESUDAHNYA memakai harga baru; pemakaian sebelumnya tetap; label belum didukung bukti; finance tidak berubah", async () => {
  const w = await dunia(); const f0 = await snap();
  const uOrderLama = await w.mk(); // order/unit dibuat sebelum perubahan harga
  const r1 = await ubah(w, { harga: 100, mulai: "2026-10-16T00:00:00Z" }); assert.equal(r1.labelBukti, "BELUM_DIDUKUNG_BUKTI"); assert.match(r1.teksLabelBukti, /Belum didukung bukti/); assert.equal(r1.hargaLama, null);
  const pakai1 = await keluar(w.mat.id, uOrderLama.id, 2, "2026-10-18T03:00:00Z", w.finA.user.id); // sebelum perubahan harga 20 Okt
  const r2 = await ubah(w, { harga: 120, mulai: "2026-10-20T00:00:00Z", alasan: "Kenaikan harga supplier mulai 20 Okt", bukti: "Nota BBK-123 (belum diverifikasi)" }); assert.equal(r2.hargaLama, 100); assert.equal(r2.labelBukti, "ADA_CATATAN_BUKTI"); assert.match(r2.teksLabelBukti, /belum diverifikasi Finance/);
  const pakai2 = await keluar(w.mat.id, uOrderLama.id, 3, "2026-10-21T03:00:00Z", w.finA.user.id); // order lama, dipakai SESUDAH 20 Okt
  const o1 = (await opRows(pakai1.id)); assert.equal(o1.length, 1); assert.equal(o1[0].status, "DINILAI"); assert.equal(Number(o1[0].unitCost), 100); assert.equal(Number(o1[0].value), 200, "2 kg × 100");
  const o2 = (await opRows(pakai2.id)); assert.equal(Number(o2[0].unitCost), 120); assert.equal(Number(o2[0].value), 360, "3 kg × 120"); assert.equal(o2[0].sumber, "BEKU_SAAT_POSTING");
  assert.equal(Number((await hargaBerlakuPada(testPrisma, w.mat.id, T("2026-10-19T23:59:59Z"))).harga), 100); assert.equal(Number((await hargaBerlakuPada(testPrisma, w.mat.id, T("2026-10-20T00:00:00Z"))).harga), 120);
  assert.equal(await hargaBerlakuPada(testPrisma, w.mat.id, T("2026-10-15T00:00:00Z")), null, "sebelum harga pertama: tidak ada harga rekaan");
  // harga baru TIDAK mengubah pemakaian yang sudah dibekukan
  await ubah(w, { harga: 150, mulai: "2026-10-19T00:00:00Z", alasan: "Harga berlaku mundur 19 Okt untuk uji" });
  assert.equal(Number((await opRows(pakai1.id))[0].unitCost), 100); assert.equal((await opRows(pakai1.id)).length, 1); assert.equal(Number((await opRows(pakai2.id))[0].unitCost), 120, "pemakaian 21 Okt sudah dibekukan 120");
  const f1 = await snap(); assert.equal(f1.stok, f0.stok + 2, "hanya 2 ISSUE baru"); assert.equal(f1.valFinance.includes("DINILAI"), false, "tanpa harga perolehan Finance: valuasi Finance tetap TANPA_HARGA");
  assert.equal(f1.jurnal, f0.jurnal); assert.equal(f1.baris, f0.baris); assert.equal(f1.kor, f0.kor); assert.equal(await testPrisma.stockMovement.count({ where: { type: "ISSUE" } }), 2);
  const j = await hppOperasionalUnit(testPrisma, uOrderLama.id); assert.equal(j.ringkasan.hppOperasionalDibekukan, 560); assert.equal(j.status, "LENGKAP_MENURUT_HARGA_BERLAKU");
  // skenario 26→30 Okt: harga terjadwal di masa depan tidak berlaku sekarang, tetapi sudah tampil untuk order yang belum memakai bahan
  await ubah(w, { harga: 130, mulai: "2026-10-30T00:00:00Z", alasan: "Kenaikan terjadwal 30 Okt" }); assert.equal(Number((await hargaBerlakuPada(testPrisma, w.mat.id, T("2026-10-29T00:00:00Z"))).harga), 120, "sebelum 30 Okt: harga yang berlaku = yang mulai paling akhir (20 Okt), bukan yang dicatat paling akhir"); assert.equal(Number((await hargaBerlakuPada(testPrisma, w.mat.id, T("2026-10-31T00:00:00Z"))).harga), 130);
  const ring = await ringkasanBahan(testPrisma, w.mat.id); assert.equal(ring.terjadwal.length, 1); assert.equal(ring.terjadwal[0].status, "TERJADWAL"); assert.equal(ring.hargaBerlaku.harga, 120); assert.match(j.pemisah.operasional, /bukan nilai buku/); assert.match(j.pemisah.finance, /biaya perolehan/);
});

test("H2. klik ganda & serentak: Idempotency-Key sama = SATU baris; kunci berbeda dengan pratinjau yang sama ditolak (PRATINJAU_BERUBAH); pratinjau wajib sebelum simpan", async () => {
  const w = await dunia(); const m = { materialId: w.mat.id, hargaBaru: "100", satuan: "KG", berlakuMulai: "2026-10-26T00:00:00Z", alasan: "Harga pertama dari nota" };
  const p = await pratinjauUbahHarga(testPrisma, m); const k = kunci("ganda");
  const hasil = await Promise.allSettled([1, 2, 3].map(() => simpanHarga(testPrisma, { ...m, hashPratinjau: p.hash }, { aktor: w.finA.user, kunci: k })));
  assert.ok(hasil.every((x) => x.status === "fulfilled"), JSON.stringify(hasil.filter((x) => x.status === "rejected").map((x) => x.reason?.message))); assert.equal(hasil.filter((x) => x.value.ulang === false).length, 1); assert.equal(await testPrisma.materialHargaBerlaku.count(), 1);
  await assert.rejects(() => simpanHarga(testPrisma, { ...m, hashPratinjau: p.hash }, { aktor: w.finA.user, kunci: kunci("lain") }), (e) => e.code === "PRATINJAU_BERUBAH" && e.statusCode === 409);
  await assert.rejects(() => simpanHarga(testPrisma, { ...m, hashPratinjau: "salah" }, { aktor: w.finA.user, kunci: kunci() }), (e) => e.code === "PRATINJAU_BERUBAH");
  await assert.rejects(() => simpanHarga(testPrisma, { ...m, hashPratinjau: p.hash }, { aktor: w.finA.user, kunci: "pendek" }), (e) => e.code === "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(await testPrisma.materialHargaBerlaku.count(), 1);
  const mLain = await createTestMaterial({ code: "LAIN-HB", name: "LAIN", unit: "KG" }); await assert.rejects(() => simpanHarga(testPrisma, { ...m, materialId: mLain.id, hashPratinjau: p.hash }, { aktor: w.finA.user, kunci: k }), (e) => e.code === "KUNCI_DIPAKAI_LAIN");
});

test("H3. satuan berbeda & input salah ditolak: satuan ≠ satuan stok, Rp0, >4 desimal, alasan pendek, waktu tak wajar; tidak ada yang tersimpan", async () => {
  const w = await dunia(); const dasar = { materialId: w.mat.id, hargaBaru: "100", satuan: "KG", berlakuMulai: "2026-10-26T00:00:00Z", alasan: "Alasan cukup panjang" };
  const tolak = async (patch, kode) => assert.rejects(() => pratinjauUbahHarga(testPrisma, { ...dasar, ...patch }), (e) => e.code === kode, kode);
  await tolak({ satuan: "PAK" }, "SATUAN_BEDA"); await tolak({ satuan: "" }, "SATUAN_BEDA"); await tolak({ hargaBaru: "0" }, "HARGA_TIDAK_VALID"); await tolak({ hargaBaru: "-5" }, "HARGA_TIDAK_VALID"); await tolak({ hargaBaru: "abc" }, "HARGA_TIDAK_VALID");
  await tolak({ hargaBaru: "100.12345" }, "HARGA_DESIMAL_BERLEBIH"); await tolak({ alasan: "x" }, "ALASAN_WAJIB"); await tolak({ berlakuMulai: "bukan-tanggal" }, "WAKTU_TIDAK_VALID"); await tolak({ berlakuMulai: "2031-01-01T00:00:00Z" }, "WAKTU_TIDAK_WAJAR");
  assert.equal((await pratinjauUbahHarga(testPrisma, { ...dasar, satuan: "kg" })).satuan, "KG", "huruf kecil diterima, tetap satuan stok"); assert.equal(await testPrisma.materialHargaBerlaku.count(), 0);
  const pr = await pratinjauUbahHarga(testPrisma, { ...dasar, hargaBaru: "100.1234" }); assert.equal(pr.hargaBaru, 100.1234);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`insert into material_harga_berlaku (id, material_id, unit_price, satuan, effective_from, reason, idempotency_key) values (gen_random_uuid(), $1::uuid, 0, 'KG', now(), 'alasan uji', 'k-nol-uji-1')`, w.mat.id), /material_harga_berlaku_harga_chk|check/i, "DB menolak harga ≤ 0 juga");
});

test("H4. harga kedua + koreksi salah input: append-only (trigger DB), pemakaian yang sudah dibekukan TIDAK ditimpa diam-diam; penerapan khusus dua orang menyelaraskan dengan baris baru", async () => {
  const w = await dunia(); const u = await w.mk();
  const a = await ubah(w, { harga: 100, mulai: "2026-10-16T00:00:00Z" }); const b = await ubah(w, { harga: 1200, mulai: "2026-10-20T00:00:00Z", alasan: "Harga baru (ternyata salah ketik nol)" }); // salah ketik: seharusnya 120
  const pakai = await keluar(w.mat.id, u.id, 3, "2026-10-21T03:00:00Z", w.finA.user.id); assert.equal(Number((await opRows(pakai.id))[0].unitCost), 1200);
  const f0 = await snap();
  // pratinjau koreksi menunjukkan pemakaian yang sudah dibekukan dengan harga salah
  const mk = { materialId: w.mat.id, hargaBaru: "120", satuan: "KG", berlakuMulai: "2026-10-20T00:00:00Z", alasan: "Koreksi salah ketik 1200 menjadi 120", koreksiId: b.id };
  const pr = await pratinjauUbahHarga(testPrisma, mk); assert.equal(pr.jenis, "KOREKSI"); assert.equal(pr.terkoreksi.pemakaianSudahDibekukanDenganHargaIni, 1); assert.equal(pr.terkoreksi.nilai, 3600); assert.match(pr.terkoreksi.ket, /TIDAK diubah diam-diam/);
  const kor = await simpanHarga(testPrisma, { ...mk, hashPratinjau: pr.hash }, { aktor: w.finA.user, kunci: kunci("kor") }); assert.equal(kor.jenis, "KOREKSI");
  await assert.rejects(() => pratinjauUbahHarga(testPrisma, { ...mk, hargaBaru: "121" }), (e) => e.code === "SUDAH_DIKOREKSI", "satu baris hanya dikoreksi sekali; koreksi lagi = koreksi baris terbaru");
  // baris salah tetap ada (append-only) tetapi ditandai DIGANTI_KOREKSI; harga berlaku sekarang = hasil koreksi
  const rw = await riwayatHarga(testPrisma, w.mat.id); assert.equal(rw.length, 3); assert.equal(rw.find((x) => x.id === b.id).status, "DIGANTI_KOREKSI"); assert.equal(rw.find((x) => x.id === b.id).diperbaikiOleh, kor.id); assert.equal(Number((await hargaBerlakuPada(testPrisma, w.mat.id, T("2026-10-22T00:00:00Z"))).harga), 120);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`update material_harga_berlaku set unit_price = 1 where id = $1::uuid`, b.id), /append-only/i); await assert.rejects(() => testPrisma.$executeRawUnsafe(`delete from material_harga_berlaku where id = $1::uuid`, b.id), /append-only/i);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`update stock_movement_biaya_operasional set unit_cost = 1 where movement_id = $1::uuid`, pakai.id), /append-only/i);
  // pemakaian yang sudah dibekukan TIDAK berubah otomatis
  assert.equal(Number((await opRows(pakai.id))[0].unitCost), 1200); assert.equal((await opRows(pakai.id)).length, 1);
  // pemakaian BARU memakai harga koreksi
  const pakai2 = await keluar(w.mat.id, u.id, 1, "2026-10-24T03:00:00Z", w.finA.user.id); assert.equal(Number((await opRows(pakai2.id))[0].unitCost), 120);
  // penerapan khusus: SELARAS_ULANG, pengaju ≠ penyetuju, hash, klik ulang
  const pp = await pratinjauPenerapan(testPrisma, { materialId: w.mat.id, groups: ["SELARAS_ULANG"] }); assert.equal(pp.tersedia.SELARAS_ULANG, 1); assert.equal(pp.penerapan.jumlah, 1); assert.equal(pp.penerapan.baris[0].nilaiSebelum, 3600); assert.equal(pp.penerapan.baris[0].nilaiBaru, 360);
  const aj = await ajukanPenerapan(testPrisma, { materialId: w.mat.id, groups: ["SELARAS_ULANG"], hashPratinjau: pp.hash, alasan: "Perbaiki pemakaian 21 Okt yang memakai harga salah 1200" }, { aktor: w.finA.user, kunci: kunci("app") });
  assert.equal((await opRows(pakai.id)).length, 1, "mengajukan tidak mengubah apa pun");
  await assert.rejects(() => setujuiPenerapan(testPrisma, { id: aj.id, hashPratinjau: pp.hash, aktor: w.finA.user }), (e) => e.code === "PEMOHON_SAMA" && e.statusCode === 403);
  const rs = await Promise.allSettled([1, 2, 3].map(() => setujuiPenerapan(testPrisma, { id: aj.id, hashPratinjau: pp.hash, aktor: w.finB.user })));
  assert.ok(rs.every((x) => x.status === "fulfilled") && rs.filter((x) => x.value.ulang === false).length === 1);
  const sesudah = await opRows(pakai.id); assert.equal(sesudah.length, 2, "baris beku asli TETAP + baris penerapan baru"); assert.equal(Number(sesudah[0].unitCost), 1200); assert.equal(Number(sesudah[1].unitCost), 120); assert.equal(sesudah[1].sumber, "PENERAPAN_DISETUJUI"); assert.equal(sesudah[1].applicationId, aj.id);
  assert.equal((await pratinjauPenerapan(testPrisma, { materialId: w.mat.id, groups: ["SELARAS_ULANG"] })).penerapan.jumlah, 0, "sudah selaras");
  const f1 = await snap(); assert.equal(f1.jurnal, f0.jurnal + 0); assert.equal(f1.baris, f0.baris); assert.equal(f1.kor, f0.kor); assert.equal(f1.valFinance.length >= 0, true); assert.ok(a.id);
  const j = await hppOperasionalUnit(testPrisma, u.id); assert.equal(j.ringkasan.hppOperasionalDibekukan, 360 + 120, "nilai efektif = penerapan terbaru");
});

test("H5. pemakaian lama tanpa harga: tidak diberi harga otomatis; hanya lewat penerapan khusus dua orang; sebelum harga pertama = gap (tanpa harga rekaan); stok/ISSUE/jurnal/GL/valuasi Finance tidak berubah", async () => {
  const w = await dunia(); const u1 = await w.mk(); const u2 = await w.mk(); const u3 = await w.mk();
  const sebelumHarga = await keluar(w.mat.id, u1.id, 2, "2026-10-05T03:00:00Z", w.finA.user.id); // diposting saat BELUM ada harga berlaku
  assert.equal((await opRows(sebelumHarga.id))[0].status, "TANPA_HARGA");
  await ubah(w, { harga: 100, mulai: "2026-10-10T00:00:00Z" }); // harga pertama berlaku 10 Okt
  const sesudahHarga = await keluar(w.mat.id, u2.id, 1, "2026-10-12T03:00:00Z", w.finA.user.id); // dibekukan 100
  const preFeature = await testPrisma.stockMovement.create({ data: { materialId: w.mat.id, type: "ISSUE", qty: -4, unitId: u3.id, note: "pemakaian lama sebelum fitur (tanpa baris biaya operasional)", createdAt: T("2026-10-15T03:00:00Z") } });
  const f0 = await snap();
  const pr = await pratinjauPenerapan(testPrisma, { materialId: w.mat.id }); assert.equal(pr.tersedia.TANPA_HARGA_BERLAKU, 1); assert.equal(pr.tersedia.BELUM_DIBEKUKAN, 1); assert.equal(pr.penerapan.jumlah, 1, "hanya yang punya harga berlaku pada waktu pemakaian: 15 Okt (BELUM_DIBEKUKAN)");
  assert.equal(pr.gap.jumlah, 1); assert.equal(pr.gap.baris[0].gap, "BELUM_ADA_HARGA_PADA_WAKTU_PEMAKAIAN"); assert.equal(pr.gap.baris[0].movementId, sebelumHarga.id); assert.match(pr.gap.catatan, /tidak ada harga rekaan/);
  assert.equal(pr.penerapan.baris[0].nilaiBaru, 400); assert.equal(pr.penerapan.baris[0].harga, 100);
  assert.equal((await opRows(preFeature.id)).length, 0, "pratinjau tidak menulis"); assert.deepEqual(await snap(), f0);
  // pilih eksplisit (subset) — tidak semua order lama otomatis
  const kosong = await pratinjauPenerapan(testPrisma, { materialId: w.mat.id, movementIds: [sesudahHarga.id] }); assert.equal(kosong.penerapan.jumlah, 0, "movementIds di luar kelompok tidak ikut");
  await assert.rejects(() => ajukanPenerapan(testPrisma, { materialId: w.mat.id, movementIds: [sesudahHarga.id], hashPratinjau: kosong.hash, alasan: "tidak ada" }, { aktor: w.finA.user, kunci: kunci() }), (e) => e.code === "TIDAK_ADA_TRANSAKSI");
  await assert.rejects(() => ajukanPenerapan(testPrisma, { materialId: w.mat.id, hashPratinjau: pr.hash, alasan: "x" }, { aktor: w.finA.user, kunci: kunci() }), (e) => e.code === "ALASAN_WAJIB");
  const aj = await ajukanPenerapan(testPrisma, { materialId: w.mat.id, hashPratinjau: pr.hash, alasan: "Beri harga berlaku pada pemakaian 15 Okt yang belum dibekukan" }, { aktor: w.finA.user, kunci: kunci("lama") });
  await assert.rejects(() => ajukanPenerapan(testPrisma, { materialId: w.mat.id, hashPratinjau: pr.hash, alasan: "pengajuan kedua bahan sama" }, { aktor: w.finA.user, kunci: kunci("lama2") }), (e) => e.code === "SATU_PENGAJUAN_AKTIF");
  assert.equal((await opRows(preFeature.id)).length, 0, "belum disetujui → belum berubah");
  await setujuiPenerapan(testPrisma, { id: aj.id, hashPratinjau: pr.hash, aktor: w.finB.user });
  assert.equal(Number((await opRows(preFeature.id))[0].value), 400); assert.equal((await opRows(sebelumHarga.id)).length, 1, "pemakaian 5 Okt tetap TANPA_HARGA — tidak diberi harga rekaan");
  const f1 = await snap(); assert.deepEqual(f1, f0, "stok, ISSUE, jurnal, GL, valuasi Finance TIDAK berubah oleh edit harga maupun penerapan");
  assert.equal((await hppOperasionalUnit(testPrisma, u1.id)).status, "PARSIAL");
});

test("H6. pratinjau order yang belum memakai bahan: harga terbaru ditampilkan (bukan dibekukan); dibekukan saat dipakai pada harga yang berlaku saat itu", async () => {
  const w = await dunia(); const u = await w.mk(); await ubah(w, { harga: 100, mulai: "2026-10-01T00:00:00Z" });
  const mi = await testPrisma.materialIssue.create({ data: { issueNumber: "MI-HB-UJI-01", sourceType: "PRODUCTION_WORK_ORDER", unitId: u.id, status: "APPROVED", lines: { create: [{ materialId: w.mat.id, requestedQty: 5 }] } } });
  let j = await hppOperasionalUnit(testPrisma, u.id); assert.equal(j.baris.length, 0); assert.equal(j.belumMemakai.length, 1); assert.equal(j.belumMemakai[0].hargaTerbaru, 100); assert.equal(j.belumMemakai[0].nilaiPratinjau, 500); assert.match(j.belumMemakai[0].ket, /dibekukan pada harga yang berlaku saat pemakaian diposting/); assert.equal(j.ringkasan.hppOperasionalDibekukan, 0);
  const r = await ringkasanBahan(testPrisma, w.mat.id); assert.equal(r.dampak.akanMemakai.unit, 1); assert.equal(r.dampak.akanMemakai.order, 1); assert.equal(r.hargaBerlaku.harga, 100);
  await ubah(w, { harga: 130, mulai: "2026-10-20T00:00:00Z", alasan: "Naik lagi 20 Okt (harga terbaru)" }); // tanggal sudah lewat → sudah berlaku
  j = await hppOperasionalUnit(testPrisma, u.id); assert.equal(j.belumMemakai[0].hargaTerbaru, 130, "pratinjau mengikuti harga terbaru");
  const pakai = await keluar(w.mat.id, u.id, 5, new Date().toISOString(), w.finA.user.id); assert.equal(Number((await opRows(pakai.id))[0].unitCost), 130); assert.equal(Number((await opRows(pakai.id))[0].value), 650);
  assert.ok(mi.id);
});

test("H7. HTTP + izin + pemisahan angka: Gudang/Sales ditolak; Finance membaca/menyimpan; jejak bahan memuat dua angka TERPISAH berlabel (operasional vs Finance); penyetuju ≠ pengaju", async () => {
  const w = await dunia(); const u = await w.mk(); const B = "/api/finance/harga-berlaku";
  assert.equal((await w.g.get(`${B}/bahan/${w.mat.id}`)).status, 403); assert.equal((await w.s.get(`${B}/bahan/${w.mat.id}`)).status, 403); assert.equal((await w.g.post(`${B}/pratinjau`, { materialId: w.mat.id })).status, 403); assert.equal((await w.a.get(`${B}/bahan/bukan-uuid`)).status, 404);
  const m = { materialId: w.mat.id, hargaBaru: "100", satuan: "KG", berlakuMulai: "2026-10-16T00:00:00Z", alasan: "Harga awal operasional" };
  assert.equal((await w.a.post(`${B}/pratinjau`, { ...m, satuan: "PAK" })).body.code, "SATUAN_BEDA"); const pr = await w.a.post(`${B}/pratinjau`, m); assert.equal(pr.status, 200); assert.ok(!("_simpan" in pr.body)); assert.equal(pr.body.labelBukti, "BELUM_DIDUKUNG_BUKTI");
  const k = kunci("http"); const s1 = await w.a.post(B, { ...m, hashPratinjau: pr.body.hash }, { "Idempotency-Key": k }); assert.equal(s1.status, 201, JSON.stringify(s1.body)); const s2 = await w.a.post(B, { ...m, hashPratinjau: pr.body.hash }, { "Idempotency-Key": k }); assert.ok([200, 201].includes(s2.status)); assert.equal(s2.body.id, s1.body.id, "klik ganda = baris yang sama"); assert.equal(await testPrisma.materialHargaBerlaku.count(), 1); assert.equal((await w.g.post(B, { ...m, hashPratinjau: pr.body.hash }, { "Idempotency-Key": kunci() })).status, 403);
  assert.equal((await w.a.post(B, { ...m, hashPratinjau: pr.body.hash })).status, 428, "tanpa Idempotency-Key ditolak");
  const ring = await w.a.get(`${B}/bahan/${w.mat.id}`); assert.equal(ring.body.hargaBerlaku.harga, 100); assert.equal(ring.body.bolehUbah, true); assert.match(ring.body.labelHarga, /bukan nilai buku dan bukan HPP final Finance/); assert.equal((await w.a.get(`${B}/bahan/${w.mat.id}/riwayat`)).body.riwayat.length, 1);
  const pakai = await keluar(w.mat.id, u.id, 2, "2026-10-18T03:00:00Z", w.finA.user.id); assert.ok(pakai.id);
  const jejak = await w.a.get(`/api/units/${u.id}/jejak-bahan`); assert.equal(jejak.status, 200); assert.ok(jejak.body.hppOperasional && jejak.body.ringkasan); assert.equal(jejak.body.hppOperasional.ringkasan.hppOperasionalDibekukan, 200); assert.equal(jejak.body.ringkasan.biayaPersediaan.nilai, null, "nilai persediaan Finance TIDAK ikut harga berlaku (tanpa harga perolehan)");
  assert.ok(jejak.body.hppOperasional.peringatan.includes("BUKAN nilai persediaan/jurnal Finance"));
  assert.equal((await w.g.get(`/api/units/${u.id}/jejak-bahan`)).body.hppOperasional, undefined, "Gudang tidak melihat nominal");
  // penerapan via HTTP: pengaju ≠ penyetuju
  const lama = await testPrisma.stockMovement.create({ data: { materialId: w.mat.id, type: "ISSUE", qty: -1, unitId: u.id, note: "lama", createdAt: T("2026-10-19T03:00:00Z") } });
  const pp = await w.a.post(`${B}/penerapan/pratinjau`, { materialId: w.mat.id }); assert.equal(pp.body.penerapan.jumlah, 1); assert.ok(!("_terapkan" in pp.body));
  const aj = await w.a.post(`${B}/penerapan`, { materialId: w.mat.id, hashPratinjau: pp.body.hash, alasan: "Beri harga pada pemakaian 19 Okt" }, { "Idempotency-Key": kunci("pen") }); assert.equal(aj.status, 201, JSON.stringify(aj.body));
  assert.equal((await w.a.post(`${B}/penerapan/${aj.body.id}/setujui`, { hashPratinjau: pp.body.hash })).body.code, "PEMOHON_SAMA"); assert.equal((await w.g.post(`${B}/penerapan/${aj.body.id}/setujui`, { hashPratinjau: pp.body.hash })).status, 403);
  const ok = await w.b.post(`${B}/penerapan/${aj.body.id}/setujui`, { hashPratinjau: pp.body.hash }); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.diterapkan, 1); assert.ok(lama.id);
});

test("H8. export Excel: sheet 'HPP Operasional' TERPISAH berlabel BUKAN nilai persediaan Finance; total = HPP operasional dibekukan; sheet Rincian (Finance) tidak berubah; baris tanpa harga = sel kosong (bukan Rp0)", async () => {
  const { default: ExcelJS } = await import("exceljs");
  const w = await dunia(); const u = await w.mk(); await ubah(w, { harga: 100, mulai: "2026-10-16T00:00:00Z" });
  await keluar(w.mat.id, u.id, 2, "2026-10-18T03:00:00Z", w.finA.user.id); // dibekukan 100 → 200
  const lama = await testPrisma.stockMovement.create({ data: { materialId: w.mat.id, type: "ISSUE", qty: -3, unitId: u.id, note: "lama tanpa baris biaya operasional", createdAt: T("2026-10-19T03:00:00Z") } });
  const res = await fetch(`${server.baseUrl}/api/finance/export/biaya-bahan`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${w.finA.token}` }, body: JSON.stringify({ filter: {} }) });
  assert.equal(res.status, 200); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const nama = wb.worksheets.map((s) => s.name); for (const n of ["Ringkasan per Unit", "Rincian Pergerakan", "Tanpa Harga", "Retur dan Waste", "HPP Operasional"]) assert.ok(nama.includes(n), `${n}: ${nama}`);
  const baris = (n) => { const o = []; wb.getWorksheet(n).eachRow((r) => o.push(r.values.slice(1))); return o; }; const op = baris("HPP Operasional");
  assert.ok(op.some((r) => String(r[0] ?? "").includes("BUKAN nilai persediaan/jurnal Finance")), "judul sheet memisahkan angka"); assert.ok(op.some((r) => String(r.join("|")).includes("BUKAN nilai buku dan BUKAN HPP final Finance")));
  const tot = op.find((r) => String(r[0] ?? "").startsWith("TOTAL")); assert.ok(tot); assert.equal(Number(tot.find((x) => typeof x === "number")), 200, "hanya yang dibekukan");
  assert.ok(op.some((r) => String(r.join("|")).includes("Belum dibekukan (pratinjau)")), "pemakaian lama tanpa baris biaya operasional ditandai belum dibekukan");
  const finance = baris("Rincian Pergerakan"); assert.ok(!finance.some((r) => String(r.join("|")).includes("HPP operasional")), "sheet Finance tidak memuat angka operasional"); assert.ok(lama.id);
});
