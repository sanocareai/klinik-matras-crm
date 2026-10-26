// KOREKSI SALDO PER BAHAN dari Stok & Lokasi (Okt 2026) — Postgres SUNGGUHAN terisolasi, rute ASLI.
// Yang dikunci: input = JUMLAH FISIK (bukan selisih); alasan wajib; pratinjau baca-saja (sebelum/sesudah/selisih); jalur resmi Penyesuaian Stok (pengaju ≠ penyetuju, posting oleh pemegang inventory:write);
// klik ganda/serentak = satu pengajuan; saldo bergeser = ditolak (ajukan, setujui, posting) tanpa menyimpan apa pun; "belum ada catatan" ≠ nol menurut pergerakan ≠ nol TERVERIFIKASI;
// stok berubah hanya SATU pergerakan ADJUSTMENT saat diposting; valuasi/jurnal/GL/Harga Berlaku tidak tersentuh; konteks append-only.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { klasifikasiSaldo } from "../../src/services/keadaanSaldo.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function akun(roles) { const u = await createTestUser({ roles }); return { ...u, c: makeClient(server.baseUrl, u.token) }; }
const saldo = async (id) => { const [{ s }] = await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${id}::uuid`; return s; };
let seq = 0; const kunci = (p = "ks") => `${p}-${Date.now()}-${++seq}-uji`;
const BASE = "/api/inventory/adjustments/koreksi-saldo";
const pratinjau = (c, materialId, jumlahFisik) => c.post(`${BASE}/pratinjau`, { materialId, jumlahFisik });
const ajukan = (c, body, key = kunci()) => c.post(`${BASE}/ajukan`, body, { "Idempotency-Key": key });
/** Alur UI: pratinjau dulu, lalu ajukan dengan saldoDilihat dari pratinjau. */
async function ajukanDariPratinjau(c, materialId, jumlahFisik, alasan = "Hasil hitung fisik gudang", key = kunci()) {
  const p = await pratinjau(c, materialId, jumlahFisik); assert.equal(p.status, 200, JSON.stringify(p.body));
  return ajukan(c, { materialId, jumlahFisik, saldoDilihat: p.body.saldoDilihat, alasan }, key);
}
const dunia = async () => ({ gudang: await akun(["WAREHOUSE"]), owner: await akun(["OWNER"]), fin: await akun(["FINANCE"]), admin: await akun(["ADMIN"]), sales: await akun(["SALES"]) });
const snapEfek = async () => ({
  stok: await testPrisma.stockMovement.count(),
  jurnal: await testPrisma.finJournalEntry.count(), baris: await testPrisma.finJournalLine.count(), valuasi: await testPrisma.finStockMovementValuation.count(),
  harga: await testPrisma.materialHargaBerlaku.count(), opr: await testPrisma.stockMovementBiayaOperasional.count(), penerapan: await testPrisma.biayaOperasionalPenerapan.count(),
});

test("klasifikasiSaldo murni: belum ada catatan ≠ nol menurut pergerakan ≠ nol terverifikasi ≠ positif ≠ minus", () => {
  assert.equal(klasifikasiSaldo({ jumlahPergerakan: 0, saldo: 0, nolTerverifikasi: false }), "BELUM_ADA_CATATAN");
  assert.equal(klasifikasiSaldo({ jumlahPergerakan: 2, saldo: 0, nolTerverifikasi: false }), "NOL_MENURUT_PERGERAKAN");
  assert.equal(klasifikasiSaldo({ jumlahPergerakan: 2, saldo: 0, nolTerverifikasi: true }), "NOL_TERVERIFIKASI");
  assert.equal(klasifikasiSaldo({ jumlahPergerakan: 2, saldo: 3, nolTerverifikasi: true }), "POSITIF", "bukti nol basi tidak menang atas saldo positif");
  assert.equal(klasifikasiSaldo({ jumlahPergerakan: 2, saldo: -1, nolTerverifikasi: false }), "MINUS");
  assert.equal(klasifikasiSaldo({ jumlahPergerakan: 0, saldo: 0, nolTerverifikasi: true }), "NOL_TERVERIFIKASI", "bukti hitung fisik tetap bukti walau tanpa pergerakan lain");
});

test("K1 pratinjau: baca-saja, menampilkan saldo sebelum/sesudah/selisih + dampak stok & data; tidak menulis apa pun", async () => {
  const w = await dunia(); const m = await createTestMaterial({ unit: "KG" }); await seedBalance(m.id, 10);
  const s0 = await snapEfek(); const nReq = await testPrisma.stockAdjustmentRequest.count();
  const r = await pratinjau(w.gudang.c, m.id, 7);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.saldoSebelum, 10); assert.equal(r.body.jumlahFisik, 7); assert.equal(r.body.selisih, -3); assert.equal(r.body.arah, "TURUN");
  assert.equal(r.body.dampakStok.onHand.sebelum, 10); assert.equal(r.body.dampakStok.onHand.sesudah, 7);
  assert.equal(r.body.keadaanSaldo, "POSITIF"); assert.equal(r.body.dapatDiajukan, true);
  assert.ok(r.body.dampakData.tidakDisentuh.some((t) => /Harga Berlaku/.test(t)) && r.body.dampakData.tidakDisentuh.some((t) => /jurnal/i.test(t)));
  assert.equal(r.body.izin.bolehMengajukan, true);
  assert.deepEqual(await snapEfek(), s0); assert.equal(await testPrisma.stockAdjustmentRequest.count(), nReq); assert.equal(await testPrisma.koreksiSaldoBahan.count(), 0);
  // sama dengan saldo -> tidak ada selisih
  const sama = await pratinjau(w.gudang.c, m.id, 10); assert.equal(sama.body.arah, "TANPA_SELISIH"); assert.equal(sama.body.dapatDiajukan, false); assert.match(sama.body.alasanTidakDapat, /tidak ada selisih/i);
});

test("K2 validasi jumlah fisik: wajib (0 sah), tidak minus, angka, maks 4 desimal; alasan wajib; saldoDilihat wajib; Idempotency-Key wajib", async () => {
  const w = await dunia(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const kode = async (jumlahFisik) => (await pratinjau(w.gudang.c, m.id, jumlahFisik)).body?.code;
  assert.equal(await kode(undefined), "JUMLAH_WAJIB"); assert.equal(await kode(""), "JUMLAH_WAJIB"); assert.equal(await kode("abc"), "JUMLAH_TIDAK_VALID");
  assert.equal(await kode(-1), "JUMLAH_MINUS"); assert.equal(await kode(1.23456), "DESIMAL_BERLEBIH"); assert.equal(await kode(99_999_999), "JUMLAH_TERLALU_BESAR");
  assert.equal((await pratinjau(w.gudang.c, m.id, 0)).status, 200, "0 sah: bahan memang kosong");
  assert.equal((await pratinjau(w.gudang.c, "bukan-uuid", 1)).body.code, "BAHAN_TIDAK_VALID");
  const dasar = { materialId: m.id, jumlahFisik: 7, saldoDilihat: 10, alasan: "Hitung fisik" };
  assert.equal((await ajukan(w.gudang.c, { ...dasar, alasan: "" })).body.code, "ALASAN_WAJIB");
  assert.equal((await ajukan(w.gudang.c, { ...dasar, alasan: "abc" })).body.code, "ALASAN_WAJIB");
  assert.equal((await ajukan(w.gudang.c, { ...dasar, saldoDilihat: undefined })).body.code, "PRATINJAU_WAJIB");
  assert.equal((await w.gudang.c.post(`${BASE}/ajukan`, dasar)).body.code, "KUNCI_WAJIB");
  assert.equal((await ajukan(w.gudang.c, dasar, "pendek")).body.code, "KUNCI_WAJIB");
  assert.equal(await testPrisma.stockAdjustmentRequest.count(), 0, "semua penolakan tidak menyimpan apa pun");
});

test("K3 ajukan -> Menunggu persetujuan, stok & data lain TIDAK berubah; pengaju tak bisa menyetujui; orang lain menyetujui; Gudang memposting SATU pergerakan ADJUSTMENT sebesar selisih", async () => {
  const w = await dunia(); const m = await createTestMaterial({ unit: "KG" }); await seedBalance(m.id, 10);
  const s0 = await snapEfek();
  const a = await ajukanDariPratinjau(w.gudang.c, m.id, 7, "Hitung fisik 26 Okt: sisa 7 kg");
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.status, "WAITING_APPROVAL"); assert.equal(a.body.selisih, -3); assert.equal(a.body.saldoDilihat, 10); assert.equal(a.body.ulang, false); assert.match(a.body.nomor, /^ADJ-\d{6}-\d{2}$/);
  assert.equal(await saldo(m.id), 10, "stok belum berubah sampai disetujui & diposting");
  assert.deepEqual(await snapEfek(), s0);
  const req = await testPrisma.stockAdjustmentRequest.findUnique({ where: { id: a.body.id } });
  assert.equal(Number(req.beforeQty), 10); assert.equal(Number(req.adjustmentQty), -3); assert.equal(req.requestedById, w.gudang.user.id); assert.equal(req.reason, "Hitung fisik 26 Okt: sisa 7 kg");
  const ctx = await testPrisma.koreksiSaldoBahan.findUnique({ where: { adjustmentRequestId: a.body.id } });
  assert.equal(Number(ctx.jumlahFisik), 7); assert.equal(Number(ctx.saldoDilihat), 10); assert.equal(ctx.keadaanAwal, "POSITIF"); assert.equal(ctx.satuan, "KG"); assert.equal(ctx.createdById, w.gudang.user.id);

  const self = await w.gudang.c.patch(`/api/inventory/adjustments/${a.body.id}`, { status: "APPROVED" }); assert.equal(self.status, 403, "pengaju (Gudang) tidak menyetujui");
  const adm = await w.admin.c.patch(`/api/inventory/adjustments/${a.body.id}`, { status: "APPROVED" }); assert.equal(adm.status, 403, "ADMIN biasa bukan penyetuju");
  const ok = await w.owner.c.patch(`/api/inventory/adjustments/${a.body.id}`, { status: "APPROVED" }); assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await saldo(m.id), 10, "disetujui belum mengubah stok");
  const fin = await w.fin.c.post(`/api/inventory/adjustments/${a.body.id}/post`, {}); assert.equal(fin.status, 403, "Finance menyetujui tetapi tidak memposting");
  const post = await w.gudang.c.post(`/api/inventory/adjustments/${a.body.id}/post`, {}); assert.equal(post.status, 200, JSON.stringify(post.body));
  assert.equal(await saldo(m.id), 7);
  const mv = await testPrisma.stockMovement.findMany({ where: { stockAdjustmentRequestId: a.body.id } });
  assert.equal(mv.length, 1); assert.equal(mv[0].type, "ADJUSTMENT"); assert.equal(Number(mv[0].qty), -3);
  const s1 = await snapEfek(); assert.equal(s1.stok, s0.stok + 1, "tepat satu pergerakan baru"); assert.equal(s1.jurnal, s0.jurnal); assert.equal(s1.baris, s0.baris); assert.equal(s1.valuasi, s0.valuasi); assert.equal(s1.harga, s0.harga); assert.equal(s1.opr, s0.opr);
});

test("K4 klik ganda: Idempotency-Key sama = satu pengajuan (ulang:true); kunci sama untuk isi lain ditolak; 5 permintaan serentak sama = satu baris", async () => {
  const w = await dunia(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const key = kunci("dobel");
  const body = { materialId: m.id, jumlahFisik: 6, saldoDilihat: 10, alasan: "Hitung ulang gudang" };
  const [r1, r2] = [await ajukan(w.gudang.c, body, key), await ajukan(w.gudang.c, body, key)];
  assert.equal(r1.status, 201); assert.equal(r2.status, 200); assert.equal(r2.body.ulang, true); assert.equal(r2.body.id, r1.body.id);
  assert.equal(await testPrisma.stockAdjustmentRequest.count(), 1); assert.equal(await testPrisma.koreksiSaldoBahan.count(), 1);
  const lain = await ajukan(w.gudang.c, { ...body, jumlahFisik: 5 }, key); assert.equal(lain.status, 409); assert.equal(lain.body.code, "KUNCI_DIPAKAI_LAIN");

  const m2 = await createTestMaterial(); await seedBalance(m2.id, 10); const k2 = kunci("serentak");
  const hasil = await Promise.all(Array.from({ length: 5 }, () => ajukan(w.gudang.c, { materialId: m2.id, jumlahFisik: 4, saldoDilihat: 10, alasan: "Serentak klik ganda" }, k2)));
  assert.ok(hasil.every((x) => x.status === 201 || x.status === 200), JSON.stringify(hasil.map((x) => [x.status, x.body?.code])));
  assert.equal(new Set(hasil.map((x) => x.body.id)).size, 1);
  assert.equal(await testPrisma.koreksiSaldoBahan.count({ where: { materialId: m2.id } }), 1);
});

test("K5 satu pengajuan aktif per bahan: kunci BERBEDA serentak -> tepat satu berhasil; setelah dibatalkan boleh mengajukan lagi", async () => {
  const w = await dunia(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const hasil = await Promise.all(Array.from({ length: 4 }, (_, i) => ajukan(w.gudang.c, { materialId: m.id, jumlahFisik: 5 + i, saldoDilihat: 10, alasan: "Balapan dua petugas" })));
  const ok = hasil.filter((x) => x.status === 201); const tolak = hasil.filter((x) => x.status === 409);
  assert.equal(ok.length, 1, JSON.stringify(hasil.map((x) => [x.status, x.body?.code]))); assert.equal(tolak.length, 3); assert.ok(tolak.every((x) => x.body.code === "SUDAH_ADA_PENGAJUAN_AKTIF"));
  assert.equal(await testPrisma.koreksiSaldoBahan.count(), 1);
  const p = await pratinjau(w.gudang.c, m.id, 3); assert.equal(p.body.dapatDiajukan, false); assert.ok(p.body.pengajuanAktif?.nomor); assert.match(p.body.alasanTidakDapat, /belum selesai/);
  const batal = await w.gudang.c.patch(`/api/inventory/adjustments/${ok[0].body.id}/cancel`, { reason: "Salah hitung" }); assert.equal(batal.status, 200);
  const lagi = await ajukanDariPratinjau(w.gudang.c, m.id, 3); assert.equal(lagi.status, 201, JSON.stringify(lagi.body));
});

test("K6 saldo bergeser SEBELUM mengajukan: 409 SALDO_BERGESER dan tidak ada yang tersimpan", async () => {
  const w = await dunia(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const p = await pratinjau(w.gudang.c, m.id, 7); assert.equal(p.body.saldoDilihat, 10);
  await seedBalance(m.id, -2); // pemakaian terjadi setelah pratinjau
  const r = await ajukan(w.gudang.c, { materialId: m.id, jumlahFisik: 7, saldoDilihat: p.body.saldoDilihat, alasan: "Hitung fisik" });
  assert.equal(r.status, 409); assert.equal(r.body.code, "SALDO_BERGESER"); assert.equal(r.body.detail.saldoDilihat, 10); assert.equal(r.body.detail.saldoSekarang, 8);
  assert.equal(await testPrisma.stockAdjustmentRequest.count(), 0); assert.equal(await testPrisma.koreksiSaldoBahan.count(), 0);
});

test("K7 saldo bergeser SETELAH diajukan: persetujuan dan posting ditolak (409), riwayat menandai KEDALUWARSA; batalkan lalu ajukan ulang dari saldo terbaru berhasil", async () => {
  const w = await dunia(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const a = await ajukanDariPratinjau(w.gudang.c, m.id, 7); assert.equal(a.status, 201);
  await seedBalance(m.id, -4); // saldo kini 6
  const setuju = await w.owner.c.patch(`/api/inventory/adjustments/${a.body.id}`, { status: "APPROVED" });
  assert.equal(setuju.status, 409, JSON.stringify(setuju.body)); assert.equal(setuju.body.code, "SALDO_BERGESER");
  assert.equal((await testPrisma.stockAdjustmentRequest.findUnique({ where: { id: a.body.id } })).status, "WAITING_APPROVAL");
  const rw = await w.gudang.c.get(`${BASE}/bahan/${m.id}`); assert.equal(rw.status, 200);
  assert.equal(rw.body.riwayat[0].kedaluwarsa, true); assert.match(rw.body.riwayat[0].kedaluwarsaTeks, /bergeser/);

  // jalur posting: disetujui dulu saat saldo masih cocok, lalu saldo bergeser sebelum diposting
  const m2 = await createTestMaterial(); await seedBalance(m2.id, 10);
  const b = await ajukanDariPratinjau(w.gudang.c, m2.id, 7);
  assert.equal((await w.owner.c.patch(`/api/inventory/adjustments/${b.body.id}`, { status: "APPROVED" })).status, 200);
  await seedBalance(m2.id, 5); // saldo 15 setelah disetujui
  const post = await w.gudang.c.post(`/api/inventory/adjustments/${b.body.id}/post`, {});
  assert.equal(post.status, 409, JSON.stringify(post.body)); assert.equal(post.body.code, "SALDO_BERGESER");
  assert.equal(await saldo(m2.id), 15, "tidak ada pergerakan penyesuaian yang tertulis");
  assert.equal(await testPrisma.stockMovement.count({ where: { stockAdjustmentRequestId: b.body.id } }), 0);
  assert.equal((await testPrisma.stockAdjustmentRequest.findUnique({ where: { id: b.body.id } })).status, "APPROVED");
  const batal = await w.gudang.c.patch(`/api/inventory/adjustments/${b.body.id}/cancel`, { reason: "Saldo bergeser" }); assert.equal(batal.status, 200);
  const ulang = await ajukanDariPratinjau(w.gudang.c, m2.id, 7); assert.equal(ulang.status, 201); assert.equal(ulang.body.selisih, -8); assert.equal(ulang.body.saldoDilihat, 15);
});

test("K8 izin: Finance/Sales/tanpa izin tidak dapat mengajukan (403); pengaju boleh Gudang/Admin/Owner; pratinjau dapat dibaca yang berizin baca saja dengan dapatDiajukan=false", async () => {
  const w = await dunia(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  for (const [nama, a] of [["FINANCE", w.fin], ["SALES", w.sales]]) {
    const r = await ajukan(a.c, { materialId: m.id, jumlahFisik: 7, saldoDilihat: 10, alasan: "Percobaan tanpa izin" });
    assert.ok([401, 403].includes(r.status), `${nama} harus ditolak, dapat ${r.status}`);
  }
  assert.equal((await w.fin.c.post(`${BASE}/pratinjau`, { materialId: m.id, jumlahFisik: 7 })).body?.dapatDiajukan ?? false, false);
  assert.equal(await testPrisma.stockAdjustmentRequest.count(), 0);
  for (const a of [w.gudang, w.admin, w.owner]) { const m2 = await createTestMaterial(); await seedBalance(m2.id, 10); assert.equal((await ajukanDariPratinjau(a.c, m2.id, 9)).status, 201); }
  const noAuth = await makeClient(server.baseUrl, null).post(`${BASE}/ajukan`, {}, { "Idempotency-Key": kunci() }); assert.equal(noAuth.status, 401);
});

test("K9 keadaan saldo: belum ada catatan ≠ nol menurut pergerakan; koreksi dari 'belum ada catatan' jadi catatan pertama; fisik 0 tanpa catatan tidak menciptakan apa pun", async () => {
  const w = await dunia(); const m = await createTestMaterial({ unit: "PCS" });
  const k = await w.gudang.c.get(`${BASE}/bahan/${m.id}`);
  assert.equal(k.body.keadaanSaldo, "BELUM_ADA_CATATAN"); assert.equal(k.body.saldo, null, "belum diketahui, bukan 0"); assert.match(k.body.keadaanTeks, /BUKAN nol/);
  const p0 = await pratinjau(w.gudang.c, m.id, 0);
  assert.equal(p0.body.saldoSebelum, null); assert.equal(p0.body.arah, "TANPA_SELISIH"); assert.equal(p0.body.dapatDiajukan, false); assert.ok(p0.body.peringatan.some((x) => /tidak menciptakan catatan/.test(x)));
  const r0 = await ajukan(w.gudang.c, { materialId: m.id, jumlahFisik: 0, saldoDilihat: 0, alasan: "Fisik kosong" }); assert.equal(r0.status, 409); assert.equal(r0.body.code, "TIDAK_ADA_SELISIH");
  const p5 = await pratinjau(w.gudang.c, m.id, 5); assert.ok(p5.body.peringatan.some((x) => /catatan stok pertamanya/.test(x)));
  const a = await ajukanDariPratinjau(w.gudang.c, m.id, 5, "Penghitungan pertama bahan ini"); assert.equal(a.status, 201); assert.equal(a.body.keadaanAwal, "BELUM_ADA_CATATAN");
  const ctx = await testPrisma.koreksiSaldoBahan.findUnique({ where: { adjustmentRequestId: a.body.id } }); assert.equal(ctx.jumlahPergerakanAwal, 0);
  assert.equal((await w.owner.c.patch(`/api/inventory/adjustments/${a.body.id}`, { status: "APPROVED" })).status, 200);
  assert.equal((await w.gudang.c.post(`/api/inventory/adjustments/${a.body.id}/post`, {})).status, 200);
  assert.equal(await saldo(m.id), 5);
  assert.equal((await w.gudang.c.get(`${BASE}/bahan/${m.id}`)).body.keadaanSaldo, "POSITIF");

  // nol menurut pergerakan (ada catatan, hasilnya 0) — BELUM terverifikasi
  const n = await createTestMaterial(); await seedBalance(n.id, 5); await seedBalance(n.id, -5);
  const kn = await w.gudang.c.get(`${BASE}/bahan/${n.id}`); assert.equal(kn.body.keadaanSaldo, "NOL_MENURUT_PERGERAKAN"); assert.equal(kn.body.saldo, 0); assert.equal(kn.body.verifikasiNol, null);
});

test("K10 nol TERVERIFIKASI: koreksi resmi ke 0 yang diposting membuktikan nol; pergerakan sesudahnya mencabut bukti; Stock Count selesai (hitung 0) juga membuktikan", async () => {
  const w = await dunia(); const m = await createTestMaterial(); await seedBalance(m.id, 4);
  const a = await ajukanDariPratinjau(w.gudang.c, m.id, 0, "Hitung fisik: sudah habis"); assert.equal(a.status, 201); assert.equal(a.body.selisih, -4);
  assert.equal((await w.gudang.c.get(`${BASE}/bahan/${m.id}`)).body.keadaanSaldo, "POSITIF", "belum diposting: bukti belum ada");
  assert.equal((await w.owner.c.patch(`/api/inventory/adjustments/${a.body.id}`, { status: "APPROVED" })).status, 200);
  assert.equal((await w.gudang.c.post(`/api/inventory/adjustments/${a.body.id}/post`, {})).status, 200);
  const k = await w.gudang.c.get(`${BASE}/bahan/${m.id}`);
  assert.equal(k.body.keadaanSaldo, "NOL_TERVERIFIKASI"); assert.equal(k.body.saldo, 0); assert.equal(k.body.verifikasiNol.sumber, "KOREKSI_SALDO"); assert.equal(k.body.verifikasiNol.nomor, a.body.nomor);
  // Stok & Lokasi memuat pembeda yang sama
  const sl = (await w.gudang.c.get("/api/inventory/beranda/stok")).body.rows.find((r) => r.materialId === m.id);
  assert.equal(sl.keadaanSaldo, "NOL_TERVERIFIKASI"); assert.equal(sl.nolTerverifikasi.nomor, a.body.nomor);
  assert.equal(sl.keadaanLabel, "Nol (terverifikasi hitung fisik)", "label keadaan tidak boleh bertentangan: nol terverifikasi tidak berlabel 'habis menurut pergerakan'");
  // pergerakan sesudah verifikasi (>60 dtk) mencabut bukti
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 2, note: "terima lagi", createdAt: new Date(Date.now() + 5 * 60_000) } });
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ISSUE", qty: -2, note: "pakai lagi", createdAt: new Date(Date.now() + 6 * 60_000) } });
  assert.equal((await w.gudang.c.get(`${BASE}/bahan/${m.id}`)).body.keadaanSaldo, "NOL_MENURUT_PERGERAKAN", "nol lagi, tetapi buktinya basi");

  // Stock Count COMPLETED dengan hitung 0 -> terverifikasi
  const c = await createTestMaterial(); await seedBalance(c.id, 3); await seedBalance(c.id, -3);
  const sc = await testPrisma.stockCount.create({ data: { countNumber: `CC-UJI-${Date.now()}`, countType: "CYCLE_COUNT", countMethod: "BY_ITEM", status: "COMPLETED", completedAt: new Date(Date.now() + 10_000), createdById: w.owner.user.id } });
  await testPrisma.stockCountLine.create({ data: { stockCountId: sc.id, materialId: c.id, systemQty: 0, countedQty: 0 } });
  const kc = await w.gudang.c.get(`${BASE}/bahan/${c.id}`); assert.equal(kc.body.keadaanSaldo, "NOL_TERVERIFIKASI"); assert.equal(kc.body.verifikasiNol.sumber, "STOCK_COUNT");
  // baris yang dikeluarkan dari cakupan bukan bukti
  await testPrisma.stockCountLine.updateMany({ where: { stockCountId: sc.id }, data: { excludedAt: new Date(), excludedReason: "uji" } });
  assert.equal((await w.gudang.c.get(`${BASE}/bahan/${c.id}`)).body.keadaanSaldo, "NOL_MENURUT_PERGERAKAN");
});

test("K11 saldo MINUS: koreksi ke hitung fisik menaikkan catatan; pratinjau memberi peringatan minus", async () => {
  const w = await dunia(); const m = await createTestMaterial(); await seedBalance(m.id, 2); await seedBalance(m.id, -5); // -3
  const p = await pratinjau(w.gudang.c, m.id, 0);
  assert.equal(p.body.keadaanSaldo, "MINUS"); assert.equal(p.body.saldoSebelum, -3); assert.equal(p.body.selisih, 3); assert.equal(p.body.arah, "NAIK"); assert.ok(p.body.peringatan.some((x) => /MINUS/.test(x)));
  const a = await ajukan(w.gudang.c, { materialId: m.id, jumlahFisik: 0, saldoDilihat: p.body.saldoDilihat, alasan: "Hitung fisik: kosong, minus karena pemakaian tak tercatat" });
  assert.equal(a.status, 201, JSON.stringify(a.body)); assert.equal(a.body.keadaanAwal, "MINUS");
  assert.equal((await w.owner.c.patch(`/api/inventory/adjustments/${a.body.id}`, { status: "APPROVED" })).status, 200);
  assert.equal((await w.gudang.c.post(`/api/inventory/adjustments/${a.body.id}/post`, {})).status, 200);
  assert.equal(await saldo(m.id), 0);
});

test("K12 pratinjau memperhitungkan jumlah dipesan: Tersedia sesudah koreksi bisa minus -> peringatan; pesanan tidak ikut berubah", async () => {
  const w = await dunia(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  await testPrisma.materialIssue.create({ data: { issueNumber: "MI-KS-1", sourceType: "MANUAL", status: "APPROVED", lines: { create: [{ materialId: m.id, requestedQty: 8 }] } } });
  const p = await pratinjau(w.gudang.c, m.id, 5);
  assert.equal(p.body.dampakStok.dipesan ?? p.body.dipesan, 8); assert.equal(p.body.dampakStok.tersedia.sebelum, 2); assert.equal(p.body.dampakStok.tersedia.sesudah, -3);
  assert.ok(p.body.peringatan.some((x) => /Tersedia menjadi -3/.test(x) && /Pesanan itu tidak ikut berubah/.test(x)));
  assert.equal(await testPrisma.materialIssue.count(), 1);
});

test("K13 asal koreksi (originType/originId) harus berpasangan dan valid; tidak ada pengajuan jika tidak valid", async () => {
  const w = await dunia(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const dasar = { materialId: m.id, jumlahFisik: 7, saldoDilihat: 10, alasan: "Hitung fisik" };
  assert.equal((await ajukan(w.gudang.c, { ...dasar, originType: "UNIT_USAGE_NOTE" })).body.code, "ASAL_TIDAK_LENGKAP");
  assert.equal((await ajukan(w.gudang.c, { ...dasar, originType: "NGAWUR", originId: "x" })).body.code, "ASAL_TIDAK_DIKENAL");
  assert.equal(await testPrisma.stockAdjustmentRequest.count(), 0);
});

test("K14 riwayat lengkap per bahan: diajukan/disetujui/diposting oleh siapa + pergerakan; yang dibatalkan tetap tercatat; bahan lain tidak bocor", async () => {
  const w = await dunia(); const m = await createTestMaterial({ unit: "KG" }); const lain = await createTestMaterial(); await seedBalance(m.id, 10); await seedBalance(lain.id, 10);
  const a = await ajukanDariPratinjau(w.gudang.c, m.id, 8, "Hitung fisik pertama");
  assert.equal((await w.gudang.c.patch(`/api/inventory/adjustments/${a.body.id}/cancel`, { reason: "Salah timbang" })).status, 200);
  const b = await ajukanDariPratinjau(w.gudang.c, m.id, 9, "Hitung fisik kedua");
  assert.equal((await w.owner.c.patch(`/api/inventory/adjustments/${b.body.id}`, { status: "APPROVED" })).status, 200);
  assert.equal((await w.gudang.c.post(`/api/inventory/adjustments/${b.body.id}/post`, {})).status, 200);
  await ajukanDariPratinjau(w.gudang.c, lain.id, 1, "Bahan lain");
  const r = await w.gudang.c.get(`${BASE}/bahan/${m.id}`); assert.equal(r.status, 200);
  assert.equal(r.body.riwayat.length, 2); const [baru, lama] = r.body.riwayat;
  assert.equal(baru.nomor, b.body.nomor); assert.equal(baru.status, "POSTED"); assert.equal(baru.statusTeks, "Sudah diposting ke stok"); assert.equal(baru.selisih, -1); assert.equal(baru.jumlahFisik, 9);
  assert.ok(baru.diajukanOleh && baru.disetujuiOleh && baru.dipostingOleh);
  const rq = await testPrisma.stockAdjustmentRequest.findUnique({ where: { id: b.body.id } }); assert.equal(rq.requestedById, w.gudang.user.id); assert.equal(rq.approvedById, w.owner.user.id); assert.equal(rq.postedById, w.gudang.user.id); assert.notEqual(rq.requestedById, rq.approvedById); assert.equal(baru.pergerakan.qty, -1); assert.equal(baru.kedaluwarsa, false);
  assert.equal(lama.status, "CANCELLED"); assert.equal(lama.alasan, "Hitung fisik pertama"); assert.match(lama.catatan ?? "", /Salah timbang/);
  assert.equal((await w.gudang.c.get(`${BASE}/bahan/00000000-0000-0000-0000-000000000000`)).status, 404);
});

test("K15 konteks koreksi append-only (trigger DB): tidak bisa diubah atau dihapus", async () => {
  const w = await dunia(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const a = await ajukanDariPratinjau(w.gudang.c, m.id, 7);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`UPDATE koreksi_saldo_bahan SET jumlah_fisik = 1 WHERE adjustment_request_id = '${a.body.id}'`), /append-only/);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`DELETE FROM koreksi_saldo_bahan WHERE adjustment_request_id = '${a.body.id}'`), /append-only/);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`INSERT INTO koreksi_saldo_bahan (id, adjustment_request_id, material_id, satuan, jumlah_fisik, saldo_dilihat, selisih, keadaan_awal, jumlah_pergerakan_awal, idempotency_key) VALUES (gen_random_uuid(), '${a.body.id}', '${m.id}', 'PCS', 7, 10, -3, 'POSITIF', 1, 'dobel-baris-uji')`), /unique|duplicate|already exists/i);
  await assert.rejects(() => testPrisma.$executeRawUnsafe(`INSERT INTO koreksi_saldo_bahan (id, adjustment_request_id, material_id, satuan, jumlah_fisik, saldo_dilihat, selisih, keadaan_awal, jumlah_pergerakan_awal, idempotency_key) VALUES (gen_random_uuid(), gen_random_uuid(), '${m.id}', 'PCS', 7, 10, 99, 'POSITIF', 1, 'selisih-salah-uji')`), /check|foreign|violates/i);
});

test("K16 regresi: penyesuaian BIASA (tanpa konteks koreksi saldo) tidak terpengaruh penjaga saldo bergeser", async () => {
  const w = await dunia(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const r = await w.gudang.c.post("/api/inventory/adjustments", { materialId: m.id, adjustmentType: "COUNT_DIFFERENCE", adjustmentQty: -3, reason: "penyesuaian biasa" }); assert.equal(r.status, 201);
  assert.equal((await w.gudang.c.patch(`/api/inventory/adjustments/${r.body.id}`, { status: "WAITING_APPROVAL" })).status, 200);
  await seedBalance(m.id, 5); // saldo bergeser setelah diajukan — jalur lama tetap boleh (delta dipasang pada saldo berjalan)
  assert.equal((await w.owner.c.patch(`/api/inventory/adjustments/${r.body.id}`, { status: "APPROVED" })).status, 200);
  assert.equal((await w.gudang.c.post(`/api/inventory/adjustments/${r.body.id}/post`, {})).status, 200);
  assert.equal(await saldo(m.id), 12);
});

test("K17 nomor ADJ unik saat banyak bahan diajukan serentak", async () => {
  const w = await dunia(); const bahan = [];
  for (let i = 0; i < 6; i++) { const m = await createTestMaterial(); await seedBalance(m.id, 10); bahan.push(m); }
  const hasil = await Promise.all(bahan.map((m) => ajukan(w.gudang.c, { materialId: m.id, jumlahFisik: 4, saldoDilihat: 10, alasan: "Hitung serentak banyak bahan" })));
  assert.ok(hasil.every((x) => x.status === 201), JSON.stringify(hasil.map((x) => [x.status, x.body?.code, x.body?.error])));
  assert.equal(new Set(hasil.map((x) => x.body.nomor)).size, 6);
});

test("K18 Harga Berlaku per satuan di daftar Stok & Lokasi: ringkasan-daftar baca-saja; bahan tanpa harga TIDAK muncul (bukan Rp0); izin finance:read", async () => {
  const w = await dunia(); const a = await createTestMaterial({ unit: "KG", code: "BUSA-HB-A" }); const b = await createTestMaterial({ unit: "PCS", code: "TANPA-HARGA" });
  const t = new Date(Date.now() - 86_400_000);
  await testPrisma.materialHargaBerlaku.create({ data: { materialId: a.id, jenis: "HARGA", unitPrice: "36000", satuan: "KG", effectiveFrom: t, createdAt: t, reason: "Harga pilot uji", createdById: w.fin.user.id, idempotencyKey: kunci("hb") } });
  const s0 = await snapEfek();
  const r = await w.fin.c.get("/api/finance/biaya-bahan/harga-berlaku/ringkasan-daftar"); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.harga[a.id].harga, 36000); assert.equal(r.body.harga[a.id].satuan, "KG"); assert.equal(r.body.harga[a.id].labelBukti, "BELUM_DIDUKUNG_BUKTI");
  assert.equal(r.body.harga[b.id], undefined, "tanpa harga = tidak ada entri (UI: Belum ada harga berlaku)"); assert.equal(r.body.jumlah, 1);
  assert.deepEqual(await snapEfek(), s0);
  assert.equal((await w.sales.c.get("/api/finance/biaya-bahan/harga-berlaku/ringkasan-daftar")).status, 403);
  // Harga Berlaku tidak mengubah/diubah koreksi saldo: harga tetap setelah koreksi diposting
  await seedBalance(a.id, 10); const ak = await ajukanDariPratinjau(w.gudang.c, a.id, 6);
  await w.owner.c.patch(`/api/inventory/adjustments/${ak.body.id}`, { status: "APPROVED" }); await w.gudang.c.post(`/api/inventory/adjustments/${ak.body.id}/post`, {});
  const r2 = await w.fin.c.get("/api/finance/biaya-bahan/harga-berlaku/ringkasan-daftar"); assert.equal(r2.body.harga[a.id].harga, 36000);
  assert.equal(await testPrisma.materialHargaBerlaku.count(), 1);
});

test("K19 nilai persediaan Finance per bahan terpisah dari Harga Berlaku: tanpa Persediaan Awal terposting = tersedia:false (bukan Rp0)", async () => {
  const w = await dunia(); const m = await createTestMaterial({ unit: "KG" });
  const r = await w.fin.c.get(`/api/finance/biaya-bahan/harga-berlaku/bahan/${m.id}`); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.nilaiPersediaanFinance.tersedia, false); assert.match(r.body.nilaiPersediaanFinance.teks, /BUKAN Rp0/);
});

test("K20 guard rollback: SETIAP kueri SQL di scripts/rollback-guard-koreksi-saldo.sh valid terhadap skema nyata (literal enum, nama tabel/kolom) dan hitungannya benar pada keadaan kosong, berjalan, diposting, dibatalkan", async () => {
  const fs = await import("node:fs"); const path = await import("node:path"); const { fileURLToPath } = await import("node:url");
  const guard = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../scripts/rollback-guard-koreksi-saldo.sh"), "utf8").replace(/\r\n/g, "\n");
  const sqls = [...guard.matchAll(/\bQR? "(select [^"]+)"/g)].map((m) => m[1]);
  assert.ok(sqls.length >= 6, `kueri guard ditemukan: ${sqls.length}`);
  const jalankan = async () => { const o = []; for (const q of sqls) { const r = await testPrisma.$queryRawUnsafe(q.replace(/\$\{[^}]+\}/g, "x")); o.push(/^select count\(\*\)/.test(q) ? Number(Object.values(r[0])[0]) : r.length); } return o; }; // kueri contoh (bukan hitungan) cukup valid; nilainya jumlah baris
  const nama = (q) => (q.match(/^select count\(\*\) from (\S+)/)?.[1] ?? q.slice(0, 40));
  const kosong = await jalankan(); assert.ok(kosong.every((n) => Number.isFinite(n)), "semua hitungan angka");
  const w = await dunia(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const a = await ajukanDariPratinjau(w.gudang.c, m.id, 7); assert.equal(a.status, 201);
  const idxJalan = sqls.findIndex((q) => /status in \('DRAFT','WAITING_APPROVAL','APPROVED'\)/.test(q) && /^select count/.test(q));
  assert.ok(idxJalan >= 0, "ada kueri hitung koreksi yang masih berjalan");
  assert.equal((await jalankan())[idxJalan], 1, "satu koreksi berjalan terhitung -> guard akan DITOLAK");
  assert.equal((await w.owner.c.patch(`/api/inventory/adjustments/${a.body.id}`, { status: "APPROVED" })).status, 200);
  assert.equal((await jalankan())[idxJalan], 1, "Disetujui (belum diposting) masih berjalan");
  assert.equal((await w.gudang.c.post(`/api/inventory/adjustments/${a.body.id}/post`, {})).status, 200);
  const sesudahPost = await jalankan(); assert.equal(sesudahPost[idxJalan], 0, "sesudah diposting tidak lagi berjalan -> guard LULUS");
  const idxPost = sqls.findIndex((q) => /status = 'POSTED'/.test(q)); assert.equal(sesudahPost[idxPost], 1);
  const b = await createTestMaterial(); await seedBalance(b.id, 10); const ab = await ajukanDariPratinjau(w.gudang.c, b.id, 4);
  assert.equal((await w.gudang.c.patch(`/api/inventory/adjustments/${ab.body.id}/cancel`, { reason: "uji guard" })).status, 200);
  const sesudahBatal = await jalankan(); assert.equal(sesudahBatal[idxJalan], 0); const idxBatal = sqls.findIndex((q) => /status = 'CANCELLED'/.test(q)); assert.equal(sesudahBatal[idxBatal], 1);
  const idxAsing = sqls.findIndex((q) => /not in \('DRAFT'/.test(q)); assert.equal(sesudahBatal[idxAsing], 0, `tidak ada status tak dikenal (${nama(sqls[idxAsing])})`);
});
