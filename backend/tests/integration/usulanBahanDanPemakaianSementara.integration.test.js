// UX BAHAN (Okt 2026): (A) usulan bahan katalog "Bahan belum ada?" — periksa kembar, hanya baris usulan, keputusan Gudang tanpa saldo/penerimaan/pergerakan/biaya/jurnal;
// (B) pemakaian SEMENTARA — fakta bahan yang sudah dipakai tetapi belum punya sumber stok resmi: bukan Material Issue, tidak mengurangi saldo, tidak digandakan, direkonsiliasi lewat jalur resmi yang SUDAH ada.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let seq = 0; const kunci = (t) => `uji-${t}-${Date.now().toString(36)}-${++seq}-aaaaaaaa`;
async function dunia() {
  const admin = await createTestUser({ roles: ["ADMIN"] }); const gudang = await createTestUser({ roles: ["WAREHOUSE"] }); const sales = await createTestUser({ roles: ["SALES"] });
  const { unit, order } = await createTestUnit({ status: "RECEIVED" });
  const c = (u) => makeClient(server.baseUrl, u.token);
  return { a: c(admin), g: c(gudang), s: c(sales), admin: admin.user, gudang: gudang.user, unit, order };
}
const hitung = async () => Object.fromEntries(await Promise.all([["sm", "stock_movements"], ["mi", "material_issues"], ["rsv", "material_reservations_v2"], ["jur", "fin_journal_entries"], ["jl", "fin_journal_lines"], ["gr", "goods_receipts"], ["mat", "materials"]].map(async ([k, t]) => [k, Number((await testPrisma.$queryRawUnsafe(`select count(*)::int c from ${t}`))[0].c)])));
const saldo = async (materialId) => Number((await testPrisma.$queryRawUnsafe(`select coalesce(sum(qty),0)::float8 s from stock_movements where material_id = '${materialId}'`))[0].s);
const usul = (o = {}) => ({ name: "Pegas Spiral Khusus Orthopedic", unit: "METER", kelompok: "PEGAS", description: "Dipakai untuk fondasi kasur berat badan tinggi", ...o });
const sem = (o = {}) => ({ name: "Lem Kontak Impor 5L", qty: 2, uom: "CAN", originNote: "Dibeli sendiri / dari luar", ...o });
const ajukan = (w, body = usul()) => w.a.post("/api/production/material-proposals", body);
const catat = (w, body = sem(), key = kunci("s")) => w.a.post(`/api/production/units/${w.unit.id}/provisional-usages`, body, { "Idempotency-Key": key });
const adopsi = async (w, klien = w.a) => (await klien.get(`/api/production/units/${w.unit.id}/adopsi`)).body;

// ───────── A. usulan bahan ─────────
test("A1. Admin mengusulkan bahan baru: HANYA satu baris usulan — tanpa Material, saldo, penerimaan, pergerakan, biaya, atau jurnal", async () => {
  const w = await dunia(); const e0 = await hitung();
  const r = await ajukan(w);
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.usulan.status, "MENUNGGU_GUDANG"); assert.equal(r.body.usulan.diajukanOleh !== undefined, true);
  assert.deepEqual(await hitung(), e0, "tidak ada tabel stok/keuangan/katalog yang berubah");
  assert.equal(await testPrisma.materialProposal.count(), 1);
  assert.match(r.body.catatan, /Tidak membuat saldo/);
});

test("A2. klik ganda / dua tab bersamaan = SATU usulan terbuka (indeks unik parsial); nama dengan spasi/huruf besar berbeda tetap dianggap sama", async () => {
  const w = await dunia();
  const hasil = await Promise.all([ajukan(w), ajukan(w), ajukan(w, usul({ name: "  pegas   SPIRAL khusus orthopedic " }))]);
  assert.ok(hasil.every((r) => [200, 201].includes(r.status)), hasil.map((r) => r.status).join());
  assert.equal(await testPrisma.materialProposal.count(), 1);
  assert.equal(hasil.filter((r) => r.body.replayed).length >= 2, true);
});

test("A3. cek duplikasi: nama SAMA dengan katalog ditolak (BAHAN_SUDAH_ADA); nama MIRIP perlu konfirmasi; kode yang sama terdeteksi; endpoint cek-kembar baca-saja", async () => {
  const w = await dunia(); await createTestMaterial({ code: "BUSA-HR-5", name: "Busa HR 5 cm", unit: "M3", itemGroup: "HR FOAM" });
  const e0 = await hitung();
  const sama = await ajukan(w, usul({ name: "busa  hr 5cm", unit: "M3", kelompok: "BUSA" }));
  assert.equal(sama.status, 409); assert.equal(sama.body.code, "BAHAN_SUDAH_ADA"); assert.equal(sama.body.detail.kandidat[0].kode, "BUSA-HR-5");
  const mirip = await ajukan(w, usul({ name: "Busa HR 5 cm Super", unit: "M3", kelompok: "BUSA" }));
  assert.equal(mirip.status, 409); assert.equal(mirip.body.code, "BAHAN_MIRIP_ADA");
  const cek = await w.a.get("/api/production/material-duplicates?name=Busa%20HR%205%20cm&code=busa-hr-5");
  assert.equal(cek.status, 200); assert.equal(cek.body.adaSama, true);
  assert.deepEqual(await hitung(), e0, "penolakan & pemeriksaan tidak menulis apa pun");
  const lolos = await ajukan(w, { ...usul({ name: "Busa HR 5 cm Super", unit: "M3", kelompok: "BUSA" }), konfirmasiBeda: true });
  assert.equal(lolos.status, 201, JSON.stringify(lolos.body));
});

test("A4. validasi isian + izin: satuan/kategori tidak dikenal 400; sub-jenis tak cocok 400; hanya-lihat (Sales) 403", async () => {
  const w = await dunia();
  assert.equal((await ajukan(w, usul({ unit: "KOTAK" }))).status, 400);
  assert.equal((await ajukan(w, usul({ kelompok: "BELUM" }))).status, 400);
  assert.equal((await ajukan(w, usul({ itemGroup: "KAIN" }))).status, 400);
  assert.equal((await ajukan(w, usul({ name: "ab" }))).status, 400);
  assert.equal((await w.s.post("/api/production/material-proposals", usul())).status, 403);
  assert.equal(await testPrisma.materialProposal.count(), 0);
});

test("A5. Gudang melihat antrean dengan status jelas; Gudang SETUJUI: Material dibuat di katalog TANPA saldo/penerimaan/pergerakan/jurnal; bahan tampil 'belum diketahui' (bukan nol)", async () => {
  const w = await dunia(); const p = (await ajukan(w)).body.usulan;
  const antre = await w.g.get("/api/production/material-proposals");
  assert.equal(antre.status, 200); assert.equal(antre.body.rows[0].statusLabel, "Menunggu Gudang"); assert.equal(antre.body.jumlah.MENUNGGU_GUDANG, 1); assert.ok(antre.body.rows[0].saranKode); assert.ok(antre.body.rows[0].subJenis.includes("PER BONNEL"));
  const e0 = await hitung();
  const tanpaSub = await w.g.post(`/api/production/material-proposals/${p.id}/decision`, { keputusan: "SETUJUI", kode: "PER-SPIRAL-OR" });
  assert.equal(tanpaSub.status, 400); assert.equal(tanpaSub.body.code, "KEPUTUSAN_SUBJENIS_WAJIB");
  const ok = await w.g.post(`/api/production/material-proposals/${p.id}/decision`, { keputusan: "SETUJUI", kode: "per-spiral-or", itemGroup: "PER BONNEL", category: "RAW_MATERIAL" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.usulan.status, "DISETUJUI");
  const e1 = await hitung();
  assert.equal(e1.mat, e0.mat + 1); assert.equal(e1.sm, e0.sm, "tidak ada pergerakan stok"); assert.equal(e1.gr, e0.gr, "tidak ada penerimaan"); assert.equal(e1.jur, e0.jur); assert.equal(e1.jl, e0.jl); assert.equal(e1.mi, e0.mi);
  const m = await testPrisma.material.findFirst({ where: { code: "PER-SPIRAL-OR" } }); assert.ok(m); assert.equal(await saldo(m.id), 0);
  const kat = await w.a.get("/api/production/material-catalog?q=spiral&limit=20");
  const baris = kat.body.rows.find((b) => b.materialId === m.id); assert.ok(baris, "bahan tampil di katalog"); assert.equal(baris.saldoDiketahui, false, "belum ada catatan stok ≠ nol"); assert.equal(baris.kelompok.kode, "PEGAS");
});

test("A6. keputusan idempoten: klik ganda SETUJUI paralel = satu Material; kode dobel 409; Sales tidak boleh memutuskan; TOLAK wajib alasan; GABUNG hanya satuan sama", async () => {
  const w = await dunia(); const p = (await ajukan(w)).body.usulan;
  assert.equal((await w.s.post(`/api/production/material-proposals/${p.id}/decision`, { keputusan: "TOLAK", catatan: "x" })).status, 403);
  const body = { keputusan: "SETUJUI", kode: "PER-SPIRAL-2", itemGroup: "PER BONNEL" };
  const hasil = await Promise.all([1, 2, 3].map(() => w.g.post(`/api/production/material-proposals/${p.id}/decision`, body)));
  assert.ok(hasil.every((r) => [200, 201].includes(r.status)), hasil.map((r) => `${r.status}:${r.body?.code ?? ""}`).join());
  assert.equal(await testPrisma.material.count({ where: { code: "PER-SPIRAL-2" } }), 1);
  const lain = (await ajukan(w, usul({ name: "Pegas Lain Sekali", kelompok: "PEGAS" }))).body.usulan;
  const dobel = await w.g.post(`/api/production/material-proposals/${lain.id}/decision`, { keputusan: "SETUJUI", kode: "PER-SPIRAL-2", itemGroup: "PER BONNEL" });
  assert.equal(dobel.status, 409, JSON.stringify(dobel.body));
  assert.equal((await w.g.post(`/api/production/material-proposals/${lain.id}/decision`, { keputusan: "TOLAK" })).status, 400);
  const tol = await w.g.post(`/api/production/material-proposals/${lain.id}/decision`, { keputusan: "TOLAK", catatan: "Sudah ada pegas setara di katalog" });
  assert.equal(tol.status, 201); assert.equal(tol.body.usulan.status, "DITOLAK");
  const m3 = await createTestMaterial({ code: "KAIN-X", name: "Kain Jacquard", unit: "METER", itemGroup: "KAIN" });
  const u3 = (await ajukan(w, usul({ name: "Kain Rajut Khusus", unit: "KG", kelompok: "KAIN" }))).body.usulan;
  const beda = await w.g.post(`/api/production/material-proposals/${u3.id}/decision`, { keputusan: "GABUNG", materialId: m3.id });
  assert.equal(beda.status, 409); assert.equal(beda.body.code, "SATUAN_BEDA");
  const u4 = (await ajukan(w, { ...usul({ name: "Kain Jacquard Premium Impor", unit: "METER", kelompok: "KAIN" }), konfirmasiBeda: true })).body.usulan;
  const gab = await w.g.post(`/api/production/material-proposals/${u4.id}/decision`, { keputusan: "GABUNG", materialId: m3.id });
  assert.equal(gab.status, 201); assert.equal(gab.body.usulan.status, "DIGABUNG"); assert.equal(gab.body.usulan.material.kode, "KAIN-X");
});

test("A7. usulan yang sudah diputuskan baris final di DB: tidak dapat diubah atau dihapus langsung; kolom asal terkunci", async () => {
  const w = await dunia(); const p = (await ajukan(w)).body.usulan;
  await assert.rejects(() => testPrisma.materialProposal.update({ where: { id: p.id }, data: { name: "Nama Diubah Diam-diam" } }), /tidak boleh diubah/);
  await w.g.post(`/api/production/material-proposals/${p.id}/decision`, { keputusan: "TOLAK", catatan: "Tidak diperlukan" });
  await assert.rejects(() => testPrisma.materialProposal.update({ where: { id: p.id }, data: { status: "MENUNGGU_GUDANG", decidedById: null, decidedAt: null } }), /baris final/);
  await assert.rejects(() => testPrisma.materialProposal.delete({ where: { id: p.id } }), /tidak boleh dihapus/);
});

// ───────── B. pemakaian sementara ─────────
test("B1. catat pemakaian sementara: BUKAN Material Issue — tidak ada pergerakan/saldo/biaya/jurnal; baris PERLU_REKONSILIASI lengkap (unit, jumlah, satuan, pelaku, waktu, asal)", async () => {
  const w = await dunia(); const e0 = await hitung();
  const r = await catat(w);
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.item.status, "PERLU_REKONSILIASI"); assert.equal(r.body.item.statusLabel, "Perlu rekonsiliasi Gudang");
  assert.deepEqual(await hitung(), e0, "tidak ada stok/jurnal/Material Issue");
  const row = await testPrisma.unitProvisionalUsage.findFirst(); assert.equal(row.unitId, w.unit.id); assert.equal(Number(row.qty), 2); assert.equal(row.uom, "CAN"); assert.equal(row.recordedById, w.admin.id); assert.equal(row.originNote, "Dibeli sendiri / dari luar"); assert.ok(row.usedAt && row.recordedAt);
});

test("B2. klik ganda / retry (Idempotency-Key sama) = SATU catatan; paralel pun satu; kunci sama dengan isian beda ditolak; tanpa kunci ditolak", async () => {
  const w = await dunia(); const k = kunci("b2");
  const hasil = await Promise.all([1, 2, 3].map(() => catat(w, sem(), k)));
  assert.ok(hasil.every((r) => [200, 201].includes(r.status)), hasil.map((r) => `${r.status}:${r.body?.code ?? ""}`).join());
  assert.equal(await testPrisma.unitProvisionalUsage.count(), 1);
  const beda = await catat(w, sem({ qty: 9 }), k); assert.equal(beda.status, 409); assert.equal(beda.body.code, "IDEMPOTENCY_KEY_REUSED");
  const tanpa = await w.a.post(`/api/production/units/${w.unit.id}/provisional-usages`, sem()); assert.equal(tanpa.status, 400); assert.equal(tanpa.body.code, "IDEMPOTENCY_KEY_INVALID");
  assert.equal(await testPrisma.unitProvisionalUsage.count(), 1);
});

test("B3. bahan yang SUDAH ada di katalog ditolak (pakai pemakaian resmi — tidak ada jalan pintas stok); usulan DITOLAK/DISETUJUI diarahkan benar; Sales 403; unit terkirim ditolak", async () => {
  const w = await dunia(); await createTestMaterial({ code: "LEM-K", name: "Lem Kontak Impor 5L", unit: "CAN", itemGroup: "LEM" });
  const r = await catat(w); assert.equal(r.status, 409); assert.equal(r.body.code, "BAHAN_ADA_DI_KATALOG");
  assert.equal(await testPrisma.unitProvisionalUsage.count(), 0);
  assert.equal((await w.s.post(`/api/production/units/${w.unit.id}/provisional-usages`, sem({ name: "Benang Khusus Merah" }), { "Idempotency-Key": kunci("b3") })).status, 403);
  const p = (await ajukan(w, usul({ name: "Benang Khusus Merah", unit: "ROLL", kelompok: "BENANG" }))).body.usulan;
  const dengan = await catat(w, sem({ name: "Benang Khusus Merah", uom: "ROLL", proposalId: p.id })); assert.equal(dengan.status, 201, JSON.stringify(dengan.body));
  await w.g.post(`/api/production/material-proposals/${p.id}/decision`, { keputusan: "TOLAK", catatan: "Pakai benang standar" });
  const tolak = await catat(w, sem({ name: "Benang Khusus Merah", uom: "ROLL", proposalId: p.id })); assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "USULAN_DITOLAK");
  await testPrisma.unit.update({ where: { id: w.unit.id }, data: { status: "DELIVERED" } });
  assert.equal((await catat(w, sem({ name: "Kain Pita Hitam" }))).status, 409);
});

test("B4. dampak status & tampilan: unit menjadi 'Sudah dikerjakan' bersumber 'Pemakaian sementara — perlu rekonsiliasi Gudang'; muncul di panel (juga hanya-lihat), Riwayat berlabel; total TERPISAH dari pemakaian resmi", async () => {
  const w = await dunia();
  const sebelum = await adopsi(w); assert.notEqual(sebelum.adopsi.kerja.key, "DIKERJAKAN");
  assert.equal((await catat(w)).status, 201);
  const ad = await adopsi(w);
  assert.equal(ad.adopsi.kerja.key, "DIKERJAKAN"); assert.equal(ad.adopsi.kerja.source, "PEMAKAIAN_SEMENTARA"); assert.equal(ad.adopsi.kerja.sourceLabel, "Pemakaian sementara — perlu rekonsiliasi Gudang");
  assert.equal(ad.pemakaianSementara.total.perluRekonsiliasi, 1); assert.equal(ad.pemakaianAktual.baris.length, 0, "tidak masuk pemakaian aktual resmi");
  assert.ok(ad.riwayat.some((e) => e.kind === "PEMAKAIAN_SEMENTARA" && /perlu rekonsiliasi Gudang/.test(e.label) && /saldo tidak berubah/.test(e.label)));
  assert.equal(ad.adopsi.pemakaianBahan.sementaraPerluRekonsiliasi, 1);
  const lihat = await adopsi(w, w.s); assert.equal(lihat.pemakaianSementara.items.length, 1); assert.equal(lihat.izin.catatPemakaianSementara, false); assert.equal(lihat.izin.putuskanUsulan, false);
  assert.equal(ad.izin.catatPemakaianSementara, true);
  const daftar = await w.a.get("/api/production/work-orders?scope=semua&limit=50");
  assert.equal(daftar.status, 200);
  const baris = (daftar.body.units ?? daftar.body.rows ?? []).find((u) => u.id === w.unit.id);
  if (baris) { assert.equal(baris.adopsi.kerja.source, "PEMAKAIAN_SEMENTARA"); }
});

test("B5. batal salah input: alasan wajib; baris TETAP ada (DIBATALKAN); tidak dihitung lagi sebagai bukti pekerjaan; replay aman; baris final tidak bisa dihidupkan kembali", async () => {
  const w = await dunia(); const id = (await catat(w)).body.item.id;
  assert.equal((await w.a.post(`/api/production/provisional-usages/${id}/cancel`, { alasan: "" })).status, 400);
  const b = await w.a.post(`/api/production/provisional-usages/${id}/cancel`, { alasan: "Salah unit" }); assert.equal(b.status, 201, JSON.stringify(b.body)); assert.equal(b.body.item.status, "DIBATALKAN");
  assert.equal((await w.a.post(`/api/production/provisional-usages/${id}/cancel`, { alasan: "Salah unit" })).status, 200);
  assert.equal(await testPrisma.unitProvisionalUsage.count(), 1);
  const ad = await adopsi(w); assert.notEqual(ad.adopsi.kerja.source, "PEMAKAIAN_SEMENTARA"); assert.equal(ad.pemakaianSementara.total.dibatalkan, 1);
  // catatan yang sudah final di DB tidak dapat dihidupkan kembali (trigger)
  await assert.rejects(() => testPrisma.unitProvisionalUsage.update({ where: { id }, data: { status: "PERLU_REKONSILIASI", cancelledById: null, cancelledAt: null, cancelReason: null } }), /baris final/);
});

test("B6. rekonsiliasi 'Bukan stok Gudang': alasan jelas wajib; tidak menulis stok/jurnal; baris final; replay oleh pelaku sama aman; Sales 403", async () => {
  const w = await dunia(); const id = (await catat(w)).body.item.id; const e0 = await hitung();
  assert.equal((await w.s.post(`/api/production/provisional-usages/${id}/reconcile`, { resolusi: "TANPA_STOK", catatan: "Dibeli operator di toko luar" })).status, 403);
  assert.equal((await w.g.post(`/api/production/provisional-usages/${id}/reconcile`, { resolusi: "TANPA_STOK", catatan: "singkat" })).status, 400);
  const ok = await w.g.post(`/api/production/provisional-usages/${id}/reconcile`, { resolusi: "TANPA_STOK", catatan: "Dibeli operator di toko luar, bukan stok Gudang" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.item.status, "DIREKONSILIASI"); assert.equal(ok.body.item.resolusi, "TANPA_STOK"); assert.equal(ok.body.item.diselesaikanOleh, w.gudang.name);
  assert.deepEqual(await hitung(), e0, "rekonsiliasi tanpa stok tidak menulis stok/jurnal");
  assert.equal((await w.g.post(`/api/production/provisional-usages/${id}/reconcile`, { resolusi: "TANPA_STOK", catatan: "Dibeli operator di toko luar, bukan stok Gudang" })).status, 200);
  const lain = await w.g.post(`/api/production/provisional-usages/${id}/reconcile`, { resolusi: "TANPA_STOK", catatan: "Alasan lain sama sekali berbeda" });
  assert.equal(lain.status, 409);
  const ad = await adopsi(w); assert.equal(ad.pemakaianSementara.total.perluRekonsiliasi, 0); assert.equal(ad.pemakaianSementara.total.direkonsiliasi, 1);
  assert.equal(ad.adopsi.kerja.source, "PEMAKAIAN_BAHAN", "sudah diselesaikan → bukti biasa");
  await assert.rejects(() => testPrisma.unitProvisionalUsage.delete({ where: { id } }), /tidak boleh dihapus/);
  await assert.rejects(() => testPrisma.unitProvisionalUsage.update({ where: { id }, data: { qty: 99 } }), /baris final/);
});

test("B7. rekonsiliasi via jalur RESMI: bahan disetujui → stok diterima → Gudang catat Material Issue resmi ke unit → TAUTKAN. Tidak ada pergerakan baru dari rekonsiliasi; satu pergerakan untuk satu catatan (anti-ganda)", async () => {
  const w = await dunia();
  const p = (await ajukan(w, usul({ name: "Lem Kontak Impor 5L", unit: "CAN", kelompok: "LEM_KIMIA" }))).body.usulan;
  const id = (await catat(w, sem({ proposalId: p.id }))).body.item.id; const id2 = (await catat(w, sem({ proposalId: p.id, qty: 1 }))).body.item.id;
  const ok = await w.g.post(`/api/production/material-proposals/${p.id}/decision`, { keputusan: "SETUJUI", kode: "LEM-KONTAK-IMPOR" }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const mat = await testPrisma.material.findFirst({ where: { code: "LEM-KONTAK-IMPOR" } }); await seedBalance(mat.id, 10);
  // sebelum ada pergerakan resmi: tidak ada kandidat
  const k0 = await w.g.get(`/api/production/provisional-usages/${id}/candidates`); assert.equal(k0.status, 200); assert.equal(k0.body.kandidat.length, 0);
  const tanpaMv = await w.g.post(`/api/production/provisional-usages/${id}/reconcile`, { resolusi: "TAUTKAN_ISSUE" }); assert.equal(tanpaMv.status, 400);
  // jalur resmi YANG SUDAH ADA (bukan jalur baru)
  const resmi = await w.g.post(`/api/units/${w.unit.id}/materials`, { materialId: mat.id, qty: 2 }, { "Idempotency-Key": kunci("resmi") }); assert.equal(resmi.status, 201, JSON.stringify(resmi.body));
  assert.equal(await saldo(mat.id), 8);
  const e0 = await hitung();
  const k1 = await w.g.get(`/api/production/provisional-usages/${id}/candidates`); assert.equal(k1.body.kandidat.length, 1); assert.equal(k1.body.kandidat[0].stockMovementId, resmi.body.id); assert.equal(k1.body.kandidat[0].qtySama, true);
  const tautkan = await w.g.post(`/api/production/provisional-usages/${id}/reconcile`, { resolusi: "TAUTKAN_ISSUE", stockMovementId: resmi.body.id });
  assert.equal(tautkan.status, 201, JSON.stringify(tautkan.body)); assert.equal(tautkan.body.item.status, "DIREKONSILIASI"); assert.equal(tautkan.body.item.stockMovementId, resmi.body.id);
  assert.deepEqual(await hitung(), e0, "rekonsiliasi tidak menulis pergerakan/jurnal/Material Issue baru");
  assert.equal(await saldo(mat.id), 8, "saldo tidak berubah karena rekonsiliasi");
  // anti-ganda: pergerakan yang sama tidak bisa ditautkan ke catatan lain; tidak muncul lagi sebagai kandidat
  const ganda = await w.g.post(`/api/production/provisional-usages/${id2}/reconcile`, { resolusi: "TAUTKAN_ISSUE", stockMovementId: resmi.body.id, catatan: "mencoba menautkan ulang pergerakan yang sama" });
  assert.equal(ganda.status, 409); assert.equal(ganda.body.code, "PERGERAKAN_SUDAH_DITAUTKAN");
  assert.equal((await w.g.get(`/api/production/provisional-usages/${id2}/candidates`)).body.kandidat.length, 0);
  // pergerakan unit lain / bahan lain ditolak
  const { unit: unitLain } = await createTestUnit({ status: "RECEIVED" }); const lain = await w.g.post(`/api/units/${unitLain.id}/materials`, { materialId: mat.id, qty: 1 }, { "Idempotency-Key": kunci("lain") });
  const unitBeda = await w.g.post(`/api/production/provisional-usages/${id2}/reconcile`, { resolusi: "TAUTKAN_ISSUE", stockMovementId: lain.body.id }); assert.equal(unitBeda.status, 409); assert.equal(unitBeda.body.code, "PERGERAKAN_UNIT_BEDA");
  // jumlah beda: wajib catatan penjelasan
  const resmi2 = await w.g.post(`/api/units/${w.unit.id}/materials`, { materialId: mat.id, qty: 3 }, { "Idempotency-Key": kunci("resmi2") });
  const selisih = await w.g.post(`/api/production/provisional-usages/${id2}/reconcile`, { resolusi: "TAUTKAN_ISSUE", stockMovementId: resmi2.body.id }); assert.equal(selisih.status, 400); assert.equal(selisih.body.code, "REKONSILIASI_SELISIH_WAJIB_CATATAN");
  const oke2 = await w.g.post(`/api/production/provisional-usages/${id2}/reconcile`, { resolusi: "TAUTKAN_ISSUE", stockMovementId: resmi2.body.id, catatan: "Catatan awal 1 CAN, pengeluaran resmi 3 CAN karena sisa dikembalikan terpisah" }); assert.equal(oke2.status, 201, JSON.stringify(oke2.body));
  const ad = await adopsi(w); assert.equal(ad.pemakaianSementara.total.perluRekonsiliasi, 0); assert.equal(ad.pemakaianSementara.total.direkonsiliasi, 2); assert.equal(ad.pemakaianAktual.baris.length, 2, "pemakaian resmi tetap dihitung sekali per pergerakan");
  assert.ok(ad.riwayat.some((e) => e.kind === "PEMAKAIAN_SEMENTARA" && /ditautkan ke pengeluaran stok resmi/.test(e.label)));
});

test("B8. Excel Order Produksi: sheet 'Pemakaian Sementara' + kolom jumlah di Ringkasan Unit; berlabel bukan Material Issue; terpisah dari Pemakaian Aktual", async () => {
  const w = await dunia(); await catat(w);
  const admin2 = await createTestUser({ roles: ["ADMIN"] });
  const res = await fetch(`${server.baseUrl}/api/production/work-orders/export.xlsx?scope=semua`, { headers: { Authorization: `Bearer ${admin2.token}` } });
  assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const sheet = wb.getWorksheet("Pemakaian Sementara"); assert.ok(sheet, "sheet Pemakaian Sementara ada");
  const teks = []; sheet.eachRow((row) => teks.push(row.values.join("|")));
  assert.ok(teks.some((t) => /Lem Kontak Impor 5L/.test(t) && /Perlu rekonsiliasi Gudang/.test(t) && /bukan Material Issue/.test(t)));
  const ringkas = wb.getWorksheet("Ringkasan Unit"); const header = []; ringkas.getRow(1).eachCell((c) => header.push(String(c.value)));
  assert.ok(header.some((h) => /Pemakaian Sementara/.test(h)));
  const aktual = wb.getWorksheet("Pemakaian Aktual"); assert.equal(aktual.rowCount, 1, "Pemakaian Aktual tidak memuat catatan sementara");
});

test("B9. antrean Gudang: catatan lintas unit dengan unit/order; hanya pemegang hak Gudang melihat izin rekonsiliasi; daftar tidak mengubah apa pun", async () => {
  const w = await dunia(); await catat(w);
  const e0 = await hitung();
  const q = await w.g.get("/api/production/provisional-usages"); assert.equal(q.status, 200); assert.equal(q.body.rows.length, 1); assert.equal(q.body.rows[0].unitCode.length > 0, true); assert.equal(q.body.izin.rekonsiliasi, true); assert.equal(q.body.jumlah.PERLU_REKONSILIASI, 1);
  assert.equal((await w.s.get("/api/production/provisional-usages")).status, 403);
  assert.equal((await w.a.get(`/api/production/provisional-usages/${q.body.rows[0].id}/candidates`)).status, 200);
  assert.deepEqual(await hitung(), e0);
});
