// PENGAJUAN PEMAKAIAN BAHAN PRODUKSI (keputusan Owner Nov 2026, pilihan (a)):
//   ADMIN mencatat → langsung. Non-ADMIN → pengajuan (stok & HPP belum berubah) → diverifikasi ADMIN BERBEDA; dasar dihitung ulang (berubah → DITAHAN), jalur tulis lama dijalankan
//   dengan kunci idempotensi per pengajuan. Tolak/batal tidak mengubah apa pun. Verifikasi massal: hasil per pengajuan. Koreksi pemakaian: penyetuju ADMIN (bukan Finance); ADMIN boleh
//   mengoreksi langsung (diaudit); harga ambigu tetap butuh ADMIN lain. Aplikasi Meja V2: lihat productionBuildTrack.integration.test.js (bagian PENGAJUAN).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let seq = 0; const kunci = (p = "ppp") => `${p}-${Date.now()}-${++seq}-uji-kunci`;
const HARI = 86400_000;
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const tgl = (hariLalu = 0) => wib(Date.now() - hariLalu * HARI);
const AJU = "/api/production/pengajuan-pemakaian";

async function dunia({ status = "IN_PRODUCTION", saldoA = 100, saldoB = 50 } = {}) {
  const [admin, admin2, fin, op, lead, gudang] = await Promise.all([
    createTestUser({ roles: ["ADMIN"] }), createTestUser({ roles: ["ADMIN"] }), createTestUser({ roles: ["FINANCE"] }),
    createTestUser({ roles: ["PRODUCTION_WORKER"] }), createTestUser({ roles: ["PRODUCTION_LEAD"] }), createTestUser({ roles: ["WAREHOUSE"] }),
  ]);
  const A = await createTestMaterial({ code: `PPA-${++seq}`, name: "BUSA A", unit: "KG" }); const B = await createTestMaterial({ code: `PPB-${++seq}`, name: "BUSA B", unit: "KG" });
  if (saldoA) await seedBalance(A.id, saldoA, { unitCost: 20000 }); if (saldoB) await seedBalance(B.id, saldoB, { unitCost: 10000 });
  const { unit } = await createTestUnit({ status, createdAt: new Date(Date.now() - 20 * HARI) });
  const c = (u) => makeClient(server.baseUrl, u.token);
  return { admin, admin2, fin, op, lead, gudang, a: c(admin), a2: c(admin2), f: c(fin), o: c(op), l: c(lead), g: c(gudang), A, B, unit };
}
const gerak = (w) => testPrisma.stockMovement.count({ where: { unitId: w.unit.id } });
const saldo = async (id) => Number((await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${id}::uuid`)[0].s);
const catat = (who, w, mat, qty, k = kunci("cat"), extra = {}) => who.post(`/api/units/${w.unit.id}/materials`, { materialId: mat.id, qty, ...extra }, { "Idempotency-Key": k });
const verif = (who, item, catatan = null) => who.post(`${AJU}/verifikasi`, { item, catatan });
const ajukan = async (who, w, mat, qty, k) => { const r = await catat(who, w, mat, qty, k); assert.equal(r.status, 202, JSON.stringify(r.body)); assert.equal(r.body.menungguVerifikasi, true); return r.body.pengajuan; };

test("P1. Non-ADMIN mencatat pemakaian → PENGAJUAN 202 tanpa pergerakan stok; tampil terpisah untuk operator & admin produksi; ADMIN mencatat langsung 201", async () => {
  const w = await dunia();
  const p = await ajukan(w.o, w, w.A, 5);
  assert.equal(p.status, "DIAJUKAN"); assert.equal(p.jalur, "UNIT_BAHAN"); assert.equal(p.ringkasan.baris[0].qty, 5);
  assert.equal(await gerak(w), 0, "stok belum berubah"); assert.equal(await saldo(w.A.id), 100);
  for (const who of [w.o, w.l, w.g]) {
    const d = await who.get(`${AJU}?unitId=${w.unit.id}`); assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.deepEqual(d.body.pengajuan.map((x) => x.id), [p.id]); assert.equal(d.body.bolehVerifikasi, false);
  }
  assert.equal((await w.a.get(`${AJU}`)).body.bolehVerifikasi, true);
  const ad = await w.a.get(`/api/production/units/${w.unit.id}/adopsi`);
  assert.equal(ad.body.pemakaianAktual.total.find((t) => t.materialId === w.A.id)?.dipakai ?? 0, 0, "Pemakaian aktual (HPP) belum menghitung pengajuan");
  // validasi jalur lama tetap jalan sebelum disimpan: stok kurang ditolak, tidak membuat pengajuan
  const kurang = await catat(w.o, w, w.A, 500); assert.ok(kurang.status >= 400 && kurang.status < 500, JSON.stringify(kurang.body));
  assert.equal(await testPrisma.pengajuanPemakaianProduksi.count(), 1);
  // ADMIN langsung
  const adm = await catat(w.a, w, w.B, 2); assert.equal(adm.status, 201, JSON.stringify(adm.body)); assert.equal(await gerak(w), 1); assert.equal(await saldo(w.B.id), 48);
});

test("P2. Verifikasi ADMIN lain → tepat satu pergerakan atas nama pengaju; ulang verifikasi & kirim ulang kunci yang sama tidak menggandakan; pengaju/Finance tidak bisa memverifikasi", async () => {
  const w = await dunia(); const k = kunci("sama");
  const p = await ajukan(w.o, w, w.A, 5, k);
  const ulang = await catat(w.o, w, w.A, 5, k); assert.equal(ulang.status, 200); assert.equal(ulang.body.ulang, true); assert.equal(ulang.body.pengajuan.id, p.id);
  assert.equal(await testPrisma.pengajuanPemakaianProduksi.count(), 1, "kirim ulang = pengajuan yang sama");
  assert.equal((await verif(w.f, [{ id: p.id }])).status, 403, "Finance bukan penyetuju operasional bahan");
  assert.equal((await verif(w.o, [{ id: p.id }])).status, 403, "operator tidak bisa memverifikasi");
  const v = await verif(w.a, [{ id: p.id }], "Cek fisik cocok"); assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.hasil[0].status, "DISETUJUI", JSON.stringify(v.body)); assert.equal(v.body.ringkas.disetujui, 1);
  const mov = await testPrisma.stockMovement.findMany({ where: { unitId: w.unit.id } });
  assert.equal(mov.length, 1); assert.equal(Number(mov[0].qty), -5); assert.equal(mov[0].createdById, w.op.user.id, "pelaku = pengaju");
  assert.ok(Math.abs(new Date(mov[0].createdAt) - new Date(p.diajukanPada)) < 5000, "waktu pemakaian = waktu pengajuan");
  assert.equal(await saldo(w.A.id), 95);
  const v2 = await verif(w.a2, [{ id: p.id }]); assert.equal(v2.body.hasil[0].status, "DISETUJUI"); assert.equal(v2.body.hasil[0].ulang, true);
  assert.equal(await gerak(w), 1, "verifikasi ganda tidak membuat pergerakan ganda");
  const ev = await testPrisma.pengajuanPemakaianProduksiEvent.findMany({ where: { pengajuanId: p.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(ev.map((e) => e.kind), ["DIAJUKAN", "DISETUJUI"]);
  const st = await testPrisma.pengajuanPemakaianProduksi.findUnique({ where: { id: p.id } }); assert.equal(st.diputuskanOleh, w.admin.user.id); assert.equal(st.alasanKeputusan, "Cek fisik cocok");
  await assert.rejects(() => testPrisma.pengajuanPemakaianProduksi.update({ where: { id: p.id }, data: { status: "DITOLAK" } }), /final|integrity|tidak boleh/i, "status final tidak bisa diubah");
});

test("P3. Tolak & batal tidak mengubah stok/HPP; pengajuan final tidak bisa diverifikasi; pengaju memakai Batalkan", async () => {
  const w = await dunia();
  const p1 = await ajukan(w.o, w, w.A, 3); const p2 = await ajukan(w.o, w, w.B, 2);
  assert.equal((await w.a.post(`${AJU}/tolak`, { ids: [p1.id], alasan: "x" })).status, 400, "alasan wajib");
  const t = await w.a.post(`${AJU}/tolak`, { ids: [p1.id], alasan: "Bahan tidak dipakai di unit ini" }); assert.equal(t.status, 200); assert.equal(t.body.hasil[0].status, "DITOLAK");
  assert.equal((await w.f.post(`${AJU}/tolak`, { ids: [p2.id], alasan: "Finance mencoba menolak" })).status, 403);
  const b = await w.o.post(`${AJU}/${p2.id}/batalkan`, { alasan: "Salah pilih bahan" }); assert.equal(b.status, 200, JSON.stringify(b.body)); assert.equal(b.body.status, "DIBATALKAN");
  assert.equal((await w.l.post(`${AJU}/${p1.id}/batalkan`, { alasan: "Bukan pengajunya" })).status, 403);
  const v = await verif(w.a, [{ id: p1.id }, { id: p2.id }]);
  assert.deepEqual(v.body.hasil.map((h) => [h.status, h.kode]), [["GAGAL", "STATUS_FINAL"], ["GAGAL", "STATUS_FINAL"]]);
  assert.equal(await gerak(w), 0); assert.equal(await saldo(w.A.id), 100); assert.equal(await saldo(w.B.id), 50);
});

test("P4. Dasar berubah (bahan yang sama sudah dicatat lagi pada unit) → DITAHAN, tidak disahkan diam-diam; disahkan hanya dengan konfirmasi beralasan", async () => {
  const w = await dunia();
  const p = await ajukan(w.o, w, w.A, 4);
  assert.equal((await catat(w.a, w, w.A, 4)).status, 201, "ADMIN mencatat bahan yang sama langsung (indikasi ganda)");
  const v = await verif(w.a2, [{ id: p.id }]); assert.equal(v.body.hasil[0].status, "DITAHAN"); assert.equal(v.body.hasil[0].beda[0].jenis, "GANDA");
  assert.equal(await gerak(w), 1, "ditahan = tidak ada pergerakan baru");
  const d = (await w.a2.get(`${AJU}?status=DITAHAN`)).body.pengajuan; assert.deepEqual(d.map((x) => x.id), [p.id]); assert.equal(d[0].alasanTahan.beda[0].jenis, "GANDA");
  const lagi = await verif(w.a2, [{ id: p.id, konfirmasi: "ok" }]); assert.equal(lagi.body.hasil[0].status, "DITAHAN", "konfirmasi < 5 karakter ditolak");
  const ok = await verif(w.a2, [{ id: p.id, konfirmasi: "Dicek: dua kali pemakaian nyata (lapis atas & bawah)" }]); assert.equal(ok.body.hasil[0].status, "DISETUJUI", JSON.stringify(ok.body));
  assert.equal(await gerak(w), 2); assert.equal(await saldo(w.A.id), 92);
  const st = await testPrisma.pengajuanPemakaianProduksi.findUnique({ where: { id: p.id } }); assert.match(st.alasanKeputusan, /Dasar berubah, diperiksa: Dicek/);
});

test("P5. Harga Berlaku berubah sejak diajukan → DITAHAN (HARGA); saldo habis saat eksekusi → DITAHAN dengan alasan pemeriksaan; massal: hasil per pengajuan", async () => {
  const w = await dunia({ saldoB: 3 });
  const harga = (mat, h, mulai) => testPrisma.materialHargaBerlaku.create({ data: { materialId: mat.id, jenis: "HARGA", unitPrice: String(h), satuan: "KG", effectiveFrom: mulai, createdAt: mulai, reason: "harga uji", idempotencyKey: kunci("hb") } });
  await harga(w.A, 20000, new Date(Date.now() - 10 * HARI));
  const pA = await ajukan(w.o, w, w.A, 2); const pB = await ajukan(w.o, w, w.B, 3); const pC = await ajukan(w.l, w, w.A, 1);
  await harga(w.A, 25000, new Date(Date.now() - 1 * HARI)); // harga baru dicatat MUNDUR (berlaku sebelum pengajuan) → dasar harga pengajuan berubah
  // pengeluaran Gudang lain menghabiskan stok B (di luar pencatatan Produksi; tidak disentuh pengajuan)
  await seedBalance(w.B.id, -3);
  const v = await verif(w.a, [{ id: pA.id }, { id: pB.id }, { id: pC.id }, { id: "00000000-0000-4000-8000-000000000000" }]);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const by = Object.fromEntries(v.body.hasil.map((h) => [h.id, h]));
  assert.equal(by[pB.id].status, "DITAHAN"); assert.equal(by[pB.id].beda[0].jenis, "VALIDASI"); assert.match(by[pB.id].beda[0].pesan, /Ditolak pemeriksaan saat eksekusi/);
  assert.equal(by["00000000-0000-4000-8000-000000000000"].status, "GAGAL");
  for (const id of [pA.id, pC.id]) { assert.equal(by[id].status, "DITAHAN", JSON.stringify(by[id])); assert.equal(by[id].beda[0].jenis, "HARGA"); }
  assert.deepEqual([v.body.ringkas.disetujui, v.body.ringkas.ditahan, v.body.ringkas.gagal], [0, 3, 1]);
  assert.equal(await gerak(w), 0);
  const ok = await verif(w.a, [{ id: pA.id, konfirmasi: "Harga baru memang berlaku sejak kemarin" }]); assert.equal(ok.body.hasil[0].status, "DISETUJUI", JSON.stringify(ok.body));
  assert.equal(await gerak(w), 1);
  assert.equal(v.body.ringkas.disetujui + v.body.ringkas.ditahan + v.body.ringkas.gagal, 4);
  assert.equal(await saldo(w.B.id), 0, "B tidak minus karena pengajuan");
  const ditahanB = await testPrisma.pengajuanPemakaianProduksi.findUnique({ where: { id: pB.id } }); assert.equal(ditahanB.status, "DITAHAN");
});

test("P6. Harga ambigu (pembetulan unit terkirim, harga berubah pada hari pemakaian): ADMIN pun mengajukan; ADMIN lain wajib alasan dasar harga", async () => {
  const w = await dunia({ status: "DELIVERED" });
  const hari = tgl(3); const awalHari = new Date(`${hari}T00:00:00+07:00`).getTime();
  const hb = (h, t, k) => testPrisma.materialHargaBerlaku.create({ data: { materialId: w.A.id, jenis: "HARGA", unitPrice: String(h), satuan: "KG", effectiveFrom: new Date(t), createdAt: new Date(t), reason: "harga uji", idempotencyKey: kunci(k) } });
  await hb(20000, awalHari - 5 * HARI, "hb1"); await hb(26000, awalHari + 12 * 3600_000, "hb2");
  const pra = await w.a.post(`/api/production/units/${w.unit.id}/pembetulan-bahan/pratinjau`, { materialId: w.A.id, jenis: "TAMBAH", qty: 2, tanggalPemakaian: hari });
  assert.equal(pra.status, 200, JSON.stringify(pra.body));
  const body = { qty: 2, alasanPembetulan: "Bahan terlewat dicatat saat produksi", tanggalPemakaian: hari, saldoDilihat: await saldo(w.A.id), hppSidik: pra.body.hppOperasional?.sidik };
  const r = await catat(w.a, w, w.A, 2, kunci("amb"), body); assert.equal(r.status, 202, JSON.stringify(r.body)); assert.equal(r.body.pengajuan.hargaAmbigu, true);
  assert.equal(await gerak(w), 0);
  assert.equal((await verif(w.a, [{ id: r.body.pengajuan.id, konfirmasiHarga: "harga pagi" }])).body.hasil[0].kode, "PENYETUJU_SAMA_DENGAN_PENGAJU");
  const tanpa = await verif(w.a2, [{ id: r.body.pengajuan.id }]); assert.equal(tanpa.body.hasil[0].status, "DITAHAN"); assert.equal(tanpa.body.hasil[0].beda[0].jenis, "HARGA_AMBIGU");
  const ok = await verif(w.a2, [{ id: r.body.pengajuan.id, konfirmasi: "Ditahan karena harga ambigu, sudah dicek", konfirmasiHarga: "Dipakai sore, harga baru berlaku" }]);
  assert.equal(ok.body.hasil[0].status, "DISETUJUI", JSON.stringify(ok.body)); assert.equal(await gerak(w), 1);
});

test("P7. Perubahan pemakaian GANTI BAHAN oleh non-ADMIN → pengajuan; disahkan ADMIN lain = dua pergerakan atomik; ADMIN langsung", async () => {
  const w = await dunia();
  assert.equal((await catat(w.a, w, w.A, 5)).status, 201);
  const PRA = `/api/production/units/${w.unit.id}/perubahan-pemakaian/pratinjau`; const PASANG = `/api/production/units/${w.unit.id}/perubahan-pemakaian`;
  const body = { materialId: w.A.id, qtyBaru: 0, keMaterialId: w.B.id, qtyKe: 5 };
  const p = await w.l.post(PRA, body); assert.equal(p.status, 200, JSON.stringify(p.body));
  const r = await w.l.post(PASANG, { ...body, alasan: "Salah pilih bahan saat catat", dilihat: p.body.sidik }, { "Idempotency-Key": kunci("gt") });
  assert.equal(r.status, 202, JSON.stringify(r.body)); assert.equal(r.body.pengajuan.jalur, "PERUBAHAN");
  assert.equal(await gerak(w), 1, "angka lama tetap berlaku");
  const v = await verif(w.a2, [{ id: r.body.pengajuan.id }]); assert.equal(v.body.hasil[0].status, "DISETUJUI", JSON.stringify(v.body));
  assert.equal(await gerak(w), 3); assert.equal(await saldo(w.A.id), 100); assert.equal(await saldo(w.B.id), 45);
  // ADMIN: langsung
  const p2 = await w.a.post(PRA, { materialId: w.B.id, qtyBaru: 4 }); assert.equal(p2.status, 200);
  const r2 = await w.a.post(PASANG, { materialId: w.B.id, qtyBaru: 4, alasan: "Sisa dikembalikan", dilihat: p2.body.sidik }, { "Idempotency-Key": kunci("ad") });
  assert.equal(r2.status, 201, JSON.stringify(r2.body)); assert.equal(await saldo(w.B.id), 46);
});

test("P8. Koreksi pemakaian: penyetuju ADMIN (Finance ditolak); angka lama berlaku sampai disahkan; ADMIN mengoreksi langsung dengan jejak audit", async () => {
  const w = await dunia({ status: "DELIVERED" });
  await testPrisma.unit.update({ where: { id: w.unit.id }, data: { status: "IN_PRODUCTION" } });
  assert.equal((await catat(w.a, w, w.A, 5)).status, 201);
  await testPrisma.unit.update({ where: { id: w.unit.id }, data: { status: "DELIVERED" } });
  const KOR = `/api/production/units/${w.unit.id}/koreksi-pemakaian`;
  const aj = await w.l.post(KOR, { materialId: w.A.id, qtyBaru: 3, alasan: "Pemakaian sebenarnya 3 kg" }, { "Idempotency-Key": kunci("kr") });
  assert.equal(aj.status, 201, JSON.stringify(aj.body)); assert.equal(aj.body.menungguVerifikasi, true, JSON.stringify(aj.body));
  assert.equal(await saldo(w.A.id), 95, "angka lama tetap berlaku");
  const fin = await w.f.post(`/api/production/koreksi-pemakaian/${aj.body.id}/setujui`, {}); assert.ok([403].includes(fin.status), JSON.stringify(fin.body));
  const ok = await w.a.post(`/api/production/koreksi-pemakaian/${aj.body.id}/setujui`, {}); assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await saldo(w.A.id), 97);
  assert.equal((await testPrisma.warehouseCorrection.findUnique({ where: { id: aj.body.id } })).decidedById, w.admin.user.id, "penyetuju tercatat = ADMIN");
  // koreksi berpersetujuan yang diajukan ADMIN: tetap ADMIN LAIN (pemisahan tugas, dijaga juga CHECK basis data)
  const adm = await w.a.post(KOR, { materialId: w.A.id, qtyBaru: 2, alasan: "Koreksi diajukan ADMIN" }, { "Idempotency-Key": kunci("ka") });
  assert.equal(adm.status, 201, JSON.stringify(adm.body)); assert.equal(adm.body.menungguVerifikasi, true); assert.equal(await saldo(w.A.id), 97);
  assert.equal((await w.a.post(`/api/production/koreksi-pemakaian/${adm.body.id}/setujui`, {})).status, 403, "pemohon tidak menyetujui sendiri");
  assert.equal((await w.a2.post(`/api/production/koreksi-pemakaian/${adm.body.id}/setujui`, {})).status, 200); assert.equal(await saldo(w.A.id), 98);
  // ADMIN mengoreksi LANGSUNG = "Ubah jumlah" (perubahan-pemakaian): berlaku seketika, jejak audit (alasan + aktivitas)
  const PRA = `/api/production/units/${w.unit.id}/perubahan-pemakaian/pratinjau`; const body = { materialId: w.A.id, qtyBaru: 1, tanggalPemakaian: tgl(1) };
  const p = await w.a.post(PRA, body); assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(p.body.jalur, "LANGSUNG"); assert.match(p.body.izin.penyetujuKoreksi, /ADMIN/);
  const r = await w.a.post(`/api/production/units/${w.unit.id}/perubahan-pemakaian`, { ...body, alasan: "Koreksi langsung ADMIN", dilihat: p.body.sidik }, { "Idempotency-Key": kunci("kl") });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(await saldo(w.A.id), 99, "ADMIN: langsung berlaku");
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: w.unit.id, eventType: "PRODUCTION_PERUBAHAN_PEMAKAIAN_BAHAN" }, orderBy: { createdAt: "desc" } });
  assert.equal(ev.actorId, w.admin.user.id); assert.equal(ev.metadata.alasan, "Koreksi langsung ADMIN");
  // non-ADMIN "Ubah jumlah" diarahkan ke koreksi berpersetujuan (angka lama berlaku)
  const pl = await w.l.post(PRA, { ...body, qtyBaru: 0 }); assert.equal(pl.status, 200); assert.equal(pl.body.jalur, "AJUKAN");
});

test("P9. Konkurensi: dua ADMIN memverifikasi pengajuan yang SAMA bersamaan → tepat satu pergerakan; pengajuan-pengajuan yang totalnya melebihi saldo → tidak pernah minus", async () => {
  const w = await dunia({ saldoA: 10 });
  const p = await ajukan(w.o, w, w.A, 4);
  const [v1, v2] = await Promise.all([verif(w.a, [{ id: p.id }]), verif(w.a2, [{ id: p.id }])]);
  assert.deepEqual([v1.status, v2.status], [200, 200]);
  assert.ok([v1.body.hasil[0].status, v2.body.hasil[0].status].every((s) => s === "DISETUJUI"), JSON.stringify([v1.body, v2.body]));
  assert.equal(await gerak(w), 1, "tepat satu pergerakan"); assert.equal(await saldo(w.A.id), 6);
  // dua pengajuan masing-masing sah (4 ≤ 6) tetapi bersama melebihi saldo (8 > 6)
  const q1 = await ajukan(w.o, w, w.A, 4); const q2 = await ajukan(w.l, w, w.A, 4);
  const [h1, h2] = await Promise.all([verif(w.a, [{ id: q1.id }]), verif(w.a2, [{ id: q2.id }])]);
  const st = [h1.body.hasil[0].status, h2.body.hasil[0].status].sort();
  assert.deepEqual(st, ["DISETUJUI", "DITAHAN"], JSON.stringify([h1.body, h2.body]));
  assert.equal(await saldo(w.A.id), 2, "saldo tidak pernah minus"); assert.equal(await gerak(w), 2);
});

test("P10. Tolak/Batal ditolak bila pengajuan sudah dijalankan verifikasi (jejak perintah ada); tolak & verifikasi paralel → status akhir konsisten dengan pergerakan", async () => {
  const w = await dunia();
  const p = await ajukan(w.o, w, w.A, 2);
  await testPrisma.v2Command.create({ data: { domain: "PRODUCTION_V1", actorId: w.op.user.id, idempotencyKey: `pengajuan-${p.id}`, commandType: "UNIT_MATERIAL_USAGE_V1", aggregateType: "unit", aggregateId: w.unit.id, requestHash: "uji", status: "PROCESSING" } });
  const t = await w.a.post(`${AJU}/tolak`, { ids: [p.id], alasan: "Mencoba menolak saat eksekusi" }); assert.equal(t.body.hasil[0].kode, "SUDAH_DIEKSEKUSI");
  const b = await w.o.post(`${AJU}/${p.id}/batalkan`, { alasan: "Mencoba membatalkan" }); assert.equal(b.status, 409); assert.equal(b.body.code, "SUDAH_DIEKSEKUSI");
  // balapan nyata pada pengajuan lain: hasil akhir selalu konsisten (DISETUJUI ⇔ 1 pergerakan; DITOLAK ⇔ 0)
  for (let i = 0; i < 3; i++) {
    const q = await ajukan(w.o, w, w.B, 1);
    const sebelum = await testPrisma.stockMovement.count({ where: { unitId: w.unit.id, materialId: w.B.id } });
    await Promise.all([verif(w.a, [{ id: q.id }]), w.a2.post(`${AJU}/tolak`, { ids: [q.id], alasan: "Balapan uji tolak" })]);
    const akhir = await testPrisma.pengajuanPemakaianProduksi.findUnique({ where: { id: q.id } });
    const sesudah = await testPrisma.stockMovement.count({ where: { unitId: w.unit.id, materialId: w.B.id } });
    assert.ok(["DISETUJUI", "DITOLAK"].includes(akhir.status), akhir.status);
    assert.equal(sesudah - sebelum, akhir.status === "DISETUJUI" ? 1 : 0, `status ${akhir.status} konsisten dengan pergerakan`);
  }
});

test("P11. Kunci idempotensi sama dengan isian berbeda → 409 IDEMPOTENCY_KEY_REUSED (tidak diam-diam memakai pengajuan lama)", async () => {
  const w = await dunia(); const k = kunci("ulang");
  await ajukan(w.o, w, w.A, 2, k);
  const beda = await catat(w.o, w, w.A, 3, k); assert.equal(beda.status, 409, JSON.stringify(beda.body)); assert.equal(beda.body.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(await testPrisma.pengajuanPemakaianProduksi.count(), 1);
});
