// PEMAKAIAN SEMENTARA UNTUK BAHAN KATALOG YANG STOKNYA BELUM DIKETAHUI (Okt 2026): tertaut ke ID bahan katalog (bukan nama), hanya bila bahan itu BENAR-BENAR tanpa catatan stok (tidak ada satu pun pergerakan).
// Wajib: jumlah, satuan (= katalog), asal barang, alasan; unit, pelaku, waktu tercatat. "Perlu rekonsiliasi Gudang"; BUKAN Material Issue/pergerakan/saldo/biaya/jurnal. Saldo diketahui (termasuk kurang/minus) ditolak.
// Gudang menindaklanjuti lewat jalur stok resmi (stok awal/opname → Material Issue/pemakaian unit → tautkan) dengan anti-hitung-ganda, koreksi, dan batal yang sudah ada.
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
  const admin = await createTestUser({ roles: ["ADMIN"] }); const gudang = await createTestUser({ roles: ["WAREHOUSE"] }); const sales = await createTestUser({ roles: ["SALES"] }); const pekerja = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  const { unit, order } = await createTestUnit({ status: "RECEIVED" });
  const mat = await createTestMaterial({ code: "BUSA-SKY-120", name: "BUSA REBONDED SKY 120X200X10 D70", unit: "SHEET", itemGroup: "HR FOAM" }); // TANPA pergerakan = stok belum diketahui
  const c = (u) => makeClient(server.baseUrl, u.token);
  return { a: c(admin), g: c(gudang), s: c(sales), p: c(pekerja), admin: admin.user, gudang: gudang.user, pekerja: pekerja.user, adminToken: admin.token, unit, order, mat };
}
const hitung = async () => Object.fromEntries(await Promise.all([["sm", "stock_movements"], ["mi", "material_issues"], ["rsv", "material_reservations_v2"], ["jur", "fin_journal_entries"], ["jl", "fin_journal_lines"], ["gr", "goods_receipts"], ["mat", "materials"], ["usul", "material_proposals"]].map(async ([k, t]) => [k, Number((await testPrisma.$queryRawUnsafe(`select count(*)::int n from ${t}`))[0].n)])));
const saldo = async (materialId) => Number((await testPrisma.$queryRawUnsafe(`select coalesce(sum(qty),0)::float8 s from stock_movements where material_id = '${materialId}'`))[0].s);
const isi = (w, o = {}) => ({ materialId: w.mat.id, qty: 3, uom: "SHEET", originNote: "Sisa bahan di meja produksi", alasanPencatatan: "Stok bahan belum tercatat di Gudang; bahan sudah terlanjur dipakai", ...o });
const catat = (w, body = isi(w), key = kunci("k"), klien = w.a) => klien.post(`/api/production/units/${w.unit.id}/provisional-usages`, body, { "Idempotency-Key": key });
const adopsi = async (w, klien = w.a) => (await klien.get(`/api/production/units/${w.unit.id}/adopsi`)).body;

test("K1. catat sementara untuk bahan katalog stok belum diketahui: tertaut ke ID katalog; nama/satuan dari katalog; jumlah+asal+alasan+unit+pelaku+waktu tercatat; PERLU_REKONSILIASI; TANPA Material Issue/pergerakan/saldo/biaya/jurnal/bahan/usulan", async () => {
  const w = await dunia(); const e0 = await hitung(); const t0 = Date.now();
  const r = await catat(w, isi(w, { name: "NAMA PALSU DARI KLIEN" })); assert.equal(r.status, 201, JSON.stringify(r.body));
  const it = r.body.item;
  assert.equal(it.status, "PERLU_REKONSILIASI"); assert.equal(it.statusLabel, "Perlu rekonsiliasi Gudang"); assert.equal(it.materialId, w.mat.id); assert.equal(it.proposalId, null);
  assert.equal(it.name, "BUSA REBONDED SKY 120X200X10 D70", "nama diambil dari katalog, bukan dari klien"); assert.equal(it.uom, "SHEET"); assert.equal(it.qty, 3);
  assert.equal(it.originNote, "Sisa bahan di meja produksi"); assert.match(it.note, /^Stok bahan belum diketahui \(bahan katalog BUSA-SKY-120\)\. Alasan: Stok bahan belum tercatat di Gudang; bahan sudah terlanjur dipakai\.$/);
  assert.equal(it.tertautKatalog, true); assert.deepEqual(it.bahanKatalog, { id: w.mat.id, kode: "BUSA-SKY-120", nama: "BUSA REBONDED SKY 120X200X10 D70", satuan: "SHEET" });
  assert.equal(it.oleh !== null, true, "pelaku tercatat"); assert.ok(Math.abs(new Date(it.recordedAt).getTime() - t0) < 60_000 && it.usedAt, "waktu tercatat");
  const baris = await testPrisma.unitProvisionalUsage.findUniqueOrThrow({ where: { id: it.id } }); assert.equal(baris.unitId, w.unit.id); assert.equal(baris.recordedById, w.admin.id); assert.equal(baris.stockMovementId, null); assert.equal(baris.resolution, null);
  assert.deepEqual(await hitung(), e0, "tidak ada Material Issue, pergerakan, reservasi, jurnal, penerimaan, bahan, atau usulan baru"); assert.equal(await saldo(w.mat.id), 0, "saldo tidak muncul dari catatan sementara");
  assert.equal(await testPrisma.stockMovement.count({ where: { materialId: w.mat.id } }), 0, "bahan tetap tanpa catatan stok");
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: w.unit.id, eventType: "PRODUCTION_PEMAKAIAN_SEMENTARA_DICATAT" }, orderBy: { createdAt: "desc" } }); assert.ok(ev, "audit tercatat"); assert.equal(ev.metadata.stokBelumDiketahui, true); assert.equal(ev.metadata.kodeBahan, "BUSA-SKY-120");
});

test("K2. validasi: asal WAJIB, alasan WAJIB, satuan harus = katalog, jumlah > 0, bahan harus ada/aktif, bukan campur dengan usulan; tidak ada yang tertulis saat ditolak", async () => {
  const w = await dunia(); const e0 = await hitung(); const n0 = await testPrisma.unitProvisionalUsage.count();
  const tolak = async (o, status, code) => { const r = await catat(w, isi(w, o)); assert.equal(r.status, status, JSON.stringify([o, r.body])); if (code) assert.equal(r.body.code, code); };
  await tolak({ originNote: "" }, 400, "SEMENTARA_ASAL_WAJIB"); await tolak({ originNote: undefined }, 400, "SEMENTARA_ASAL_WAJIB"); await tolak({ originNote: "x" }, 400, "SEMENTARA_ASAL_WAJIB");
  await tolak({ alasanPencatatan: "" }, 400, "SEMENTARA_ALASAN_WAJIB"); await tolak({ alasanPencatatan: "ya" }, 400, "SEMENTARA_ALASAN_WAJIB");
  await tolak({ uom: "METER" }, 400, "SEMENTARA_SATUAN_INVALID"); await tolak({ qty: 0 }, 400, "SEMENTARA_JUMLAH_INVALID"); await tolak({ qty: -1 }, 400, "SEMENTARA_JUMLAH_INVALID");
  await tolak({ materialId: "bukan-uuid" }, 400, "ID_INVALID"); await tolak({ materialId: "00000000-0000-4000-8000-000000000000" }, 404, "BAHAN_TIDAK_ADA");
  await tolak({ proposalId: "00000000-0000-4000-8000-000000000001" }, 400, "SEMENTARA_SUMBER_GANDA");
  const nonaktif = await createTestMaterial({ code: "BUSA-LAMA", name: "Busa lama nonaktif", unit: "SHEET", active: false }); await tolak({ materialId: nonaktif.id }, 409, "BAHAN_TIDAK_AKTIF");
  assert.equal(await testPrisma.unitProvisionalUsage.count(), n0); const e1 = await hitung(); assert.deepEqual({ ...e1, mat: 0 }, { ...e0, mat: 0 });
});

test("K3. saldo DIKETAHUI ditolak (BAHAN_STOK_DIKETAHUI) — cukup, kurang, minus, atau nol-terhitung: itu jalur resmi / keputusan terpisah, bukan jalan pintas stok", async () => {
  const w = await dunia(); const e0 = await hitung();
  await seedBalance(w.mat.id, 2); // saldo kurang dari yang dipakai (3)
  const kurang = await catat(w); assert.equal(kurang.status, 409); assert.equal(kurang.body.code, "BAHAN_STOK_DIKETAHUI"); assert.match(kurang.body.error, /saldo diketahui/);
  const cukup = await createTestMaterial({ code: "KAIN-X", name: "KAIN X", unit: "METER" }); await seedBalance(cukup.id, 50);
  assert.equal((await catat(w, isi(w, { materialId: cukup.id, uom: "METER" }))).status, 409);
  const minus = await createTestMaterial({ code: "PEGAS-MINUS", name: "PEGAS MINUS", unit: "PCS" }); await seedBalance(minus.id, -4);
  assert.equal((await catat(w, isi(w, { materialId: minus.id, uom: "PCS" }))).status, 409, "saldo minus = diketahui (perlu opname), bukan jalur ini");
  const nolTerhitung = await createTestMaterial({ code: "LEM-NOL", name: "LEM NOL", unit: "CAN" }); await seedBalance(nolTerhitung.id, 5); await seedBalance(nolTerhitung.id, -5);
  assert.equal((await catat(w, isi(w, { materialId: nolTerhitung.id, uom: "CAN" }))).status, 409, "habis menurut catatan = diketahui");
  assert.equal(await testPrisma.unitProvisionalUsage.count(), 0); assert.equal((await hitung()).mi, e0.mi);
});

test("K4. klik ganda / retry / paralel (Idempotency-Key sama) = SATU catatan; kunci sama dengan isian beda ditolak (jumlah, alasan, asal, bahan); kunci berbeda = niat baru", async () => {
  const w = await dunia(); const k = kunci("dobel");
  const a = await catat(w, isi(w), k); const b = await catat(w, isi(w), k); assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(b.body.replayed, true); assert.equal(b.body.item.id, a.body.item.id);
  const par = await Promise.all([1, 2, 3].map(() => catat(w, isi(w), kunci("par-sama").replace(/par-sama.*/, "par-sama-0001-aaaaaaaa"))));
  assert.ok(par.every((r) => [200, 201].includes(r.status)), par.map((r) => r.status).join()); assert.equal(await testPrisma.unitProvisionalUsage.count(), 2, "satu dari kunci 'dobel' + satu dari kunci paralel");
  for (const beda of [{ qty: 4 }, { alasanPencatatan: "alasan yang berbeda sekali" }, { originNote: "Dibeli sendiri / dari luar" }]) { const r = await catat(w, isi(w, beda), k); assert.equal(r.status, 409, JSON.stringify(beda)); assert.equal(r.body.code, "IDEMPOTENCY_KEY_REUSED"); }
  const lain = await createTestMaterial({ code: "BUSA-LAIN", name: "BUSA LAIN", unit: "SHEET" }); const bahanBeda = await catat(w, isi(w, { materialId: lain.id }), k); assert.equal(bahanBeda.status, 409);
  assert.equal((await catat(w, isi(w), kunci("baru"))).status, 201, "kunci berbeda = catatan baru (pemakaian terpisah di waktu berbeda)");
  assert.equal(await testPrisma.unitProvisionalUsage.count(), 3); assert.equal(await testPrisma.stockMovement.count(), 0);
  assert.equal((await catat(w, isi(w), "pendek")).status, 400, "Idempotency-Key wajib");
});

test("K5. izin: Sales 403 (hanya-lihat); pekerja produksi dan Gudang boleh; unit batal/terkirim ditolak; jalur nama-saja TETAP menolak nama katalog yang sama persis (tanpa materialId)", async () => {
  const w = await dunia(); const e0 = await hitung();
  assert.equal((await catat(w, isi(w), kunci("s"), w.s)).status, 403);
  assert.equal((await catat(w, isi(w), kunci("p"), w.p)).status, 201, "pekerja produksi memiliki izin tulis bahan"); assert.equal((await catat(w, isi(w), kunci("g"), w.g)).status, 201);
  const { unit: batal } = await createTestUnit({ status: "CANCELLED" }); const rb = await w.a.post(`/api/production/units/${batal.id}/provisional-usages`, isi(w), { "Idempotency-Key": kunci("b") }); assert.equal(rb.status, 409); assert.equal(rb.body.code, "UNIT_TIDAK_AKTIF");
  const namaSaja = await catat(w, { name: "BUSA REBONDED SKY 120X200X10 D70", qty: 1, uom: "SHEET" }, kunci("n")); assert.equal(namaSaja.status, 409); assert.equal(namaSaja.body.code, "BAHAN_ADA_DI_KATALOG", "nama katalog yang sama persis TANPA materialId tetap tidak boleh");
  const lihat = await adopsi(w, w.s); assert.equal(lihat.izin.catatPemakaianSementara, false); assert.equal(lihat.pemakaianSementara.items.length, 2, "hanya-lihat tetap membaca");
  assert.equal(await testPrisma.stockMovement.count(), (e0.sm));
});

test("K6. dampak ke status kerja, Ringkasan, daftar+filter, Riwayat, panel, antrean Gudang, dan Excel: berlabel 'Perlu rekonsiliasi Gudang', bahan katalog + kode, TERPISAH dari pemakaian resmi", async () => {
  const w = await dunia(); assert.notEqual((await adopsi(w)).adopsi.kerja.key, "DIKERJAKAN");
  assert.equal((await catat(w)).status, 201);
  const ad = await adopsi(w);
  assert.equal(ad.adopsi.kerja.key, "DIKERJAKAN"); assert.equal(ad.adopsi.kerja.source, "PEMAKAIAN_SEMENTARA"); assert.equal(ad.adopsi.kerja.sourceLabel, "Pemakaian sementara — perlu rekonsiliasi Gudang");
  assert.equal(ad.adopsi.pemakaianBahan.sementaraPerluRekonsiliasi, 1); assert.equal(ad.adopsi.pemakaianBahan.baruCatatan, 0, "bukan pemakaian resmi"); assert.equal(ad.pemakaianAktual.baris.length, 0);
  assert.equal(ad.pemakaianSementara.items[0].tertautKatalog, true); assert.equal(ad.pemakaianSementara.items[0].bahanKatalog.kode, "BUSA-SKY-120");
  assert.ok(ad.riwayat.some((e) => e.kind === "PEMAKAIAN_SEMENTARA" && /perlu rekonsiliasi Gudang/.test(e.label) && /bahan katalog BUSA-SKY-120 \(stok belum diketahui\)/.test(e.label) && /asal: Sisa bahan di meja produksi/.test(e.label)));
  const f = await w.a.get("/api/production/work-orders?statusKerja=DIKERJAKAN&pageSize=50"); assert.deepEqual(f.body.units.map((u) => u.id), [w.unit.id]);
  const antre = await w.g.get("/api/production/provisional-usages"); const row = antre.body.rows[0]; assert.equal(row.tertautKatalog, true); assert.equal(row.bahanKatalog.nama, "BUSA REBONDED SKY 120X200X10 D70"); assert.equal(row.originNote, "Sisa bahan di meja produksi"); assert.match(row.note, /Alasan: Stok bahan belum tercatat/); assert.equal(antre.body.izin.rekonsiliasi, true);
  const res = await fetch(`${server.baseUrl}/api/production/work-orders/export.xlsx?scope=semua`, { headers: { Authorization: `Bearer ${w.adminToken}` } }); assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer())); const sh = wb.getWorksheet("Pemakaian Sementara"); const head = sh.getRow(1).values.slice(1);
  for (const h of ["Jenis", "Kode Bahan Katalog", "Asal Barang", "Status", "Dicatat Oleh", "Waktu Dipakai (WIB)", "Catatan"]) assert.ok(head.includes(h), h);
  const baris = Object.fromEntries(head.map((h, i) => [h, sh.getRow(2).values[i + 1]]));
  assert.equal(baris["Jenis"], "Bahan katalog — stok belum diketahui"); assert.equal(baris["Kode Bahan Katalog"], "BUSA-SKY-120"); assert.equal(baris["Status"], "Perlu rekonsiliasi Gudang"); assert.equal(baris["Asal Barang"], "Sisa bahan di meja produksi"); assert.match(String(baris["Catatan"]), /Alasan: Stok bahan belum tercatat/);
  assert.equal(wb.getWorksheet("Pemakaian Aktual").rowCount, 1, "tidak bercampur dengan Pemakaian Aktual");
});

test("K7. Gudang menindaklanjuti lewat jalur stok RESMI: petunjuk jelas; kandidat hanya bahan itu; stok awal → Material Issue/pemakaian unit → TAUTKAN; tidak ada pergerakan baru dari rekonsiliasi; satu pergerakan untuk satu catatan; bahan lain ditolak", async () => {
  const w = await dunia(); const a = (await catat(w)).body.item; const b = (await catat(w, isi(w, { qty: 1 }), kunci("k2"))).body.item;
  const k0 = await w.g.get(`/api/production/provisional-usages/${a.id}/candidates`); assert.equal(k0.status, 200); assert.equal(k0.body.kandidat.length, 0); assert.equal(k0.body.bahanTujuanId, w.mat.id); assert.equal(k0.body.bahanKatalog.kode, "BUSA-SKY-120");
  assert.match(k0.body.petunjuk, /stok awal\/opname/); assert.match(k0.body.petunjuk, /SATU catatan/);
  const tanpa = await w.g.post(`/api/production/provisional-usages/${a.id}/reconcile`, { resolusi: "TAUTKAN_ISSUE" }); assert.equal(tanpa.status, 400);
  await seedBalance(w.mat.id, 10); // Gudang mencatat stok awal (jalur resmi di produksi: opname/penerimaan); di tes memakai fixture ledger
  const resmi = await w.g.post(`/api/units/${w.unit.id}/materials`, { materialId: w.mat.id, qty: 3 }, { "Idempotency-Key": kunci("resmi") }); assert.equal(resmi.status, 201, JSON.stringify(resmi.body));
  const lain = await createTestMaterial({ code: "KAIN-Z", name: "KAIN Z", unit: "SHEET" }); await seedBalance(lain.id, 9); const mvLain = await w.g.post(`/api/units/${w.unit.id}/materials`, { materialId: lain.id, qty: 3 }, { "Idempotency-Key": kunci("lain") });
  const k1 = await w.g.get(`/api/production/provisional-usages/${a.id}/candidates`); assert.deepEqual(k1.body.kandidat.map((x) => x.stockMovementId).sort(), [resmi.body.id].sort(), "kandidat hanya pergerakan bahan yang SAMA");
  const salah = await w.g.post(`/api/production/provisional-usages/${a.id}/reconcile`, { resolusi: "TAUTKAN_ISSUE", stockMovementId: mvLain.body.id, catatan: "mencoba bahan yang berbeda dari catatan" }); assert.equal(salah.status, 409); assert.equal(salah.body.code, "PERGERAKAN_BAHAN_BEDA");
  const e0 = await hitung(); const ok = await w.g.post(`/api/production/provisional-usages/${a.id}/reconcile`, { resolusi: "TAUTKAN_ISSUE", stockMovementId: resmi.body.id });
  assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.item.status, "DIREKONSILIASI"); assert.equal(ok.body.item.stockMovementId, resmi.body.id); assert.equal(ok.body.item.materialId, w.mat.id);
  assert.deepEqual(await hitung(), e0, "rekonsiliasi tidak menulis pergerakan/jurnal/Material Issue baru"); assert.equal(await saldo(w.mat.id), 7, "saldo hanya berubah oleh pengeluaran RESMI sebelumnya");
  const ganda = await w.g.post(`/api/production/provisional-usages/${b.id}/reconcile`, { resolusi: "TAUTKAN_ISSUE", stockMovementId: resmi.body.id, catatan: "mencoba menautkan ulang pergerakan yang sama" }); assert.equal(ganda.status, 409); assert.equal(ganda.body.code, "PERGERAKAN_SUDAH_DITAUTKAN");
  assert.equal((await w.g.get(`/api/production/provisional-usages/${b.id}/candidates`)).body.kandidat.length, 0, "pergerakan yang sudah ditautkan tidak jadi kandidat lagi");
  const ad = await adopsi(w); assert.equal(ad.pemakaianSementara.total.direkonsiliasi, 1); assert.equal(ad.pemakaianSementara.total.perluRekonsiliasi, 1); assert.equal(ad.pemakaianAktual.baris.length, 2, "pemakaian resmi dihitung sekali per pergerakan (bahan ini + bahan lain)");
  assert.equal((await w.a.post(`/api/production/provisional-usages/${b.id}/reconcile`, { resolusi: "TAUTKAN_ISSUE", stockMovementId: resmi.body.id }, {})).status, 409);
});

test("K8. rekonsiliasi 'Bukan stok Gudang' (alasan jelas) dan batal salah input memakai jejak yang ada; yang sudah ditautkan tidak bisa dibatalkan di sini; baris dibatalkan tidak lagi bukti kerja", async () => {
  const w = await dunia(); const a = (await catat(w)).body.item; const b = (await catat(w, isi(w), kunci("kk"))).body.item;
  const tolak = await w.g.post(`/api/production/provisional-usages/${a.id}/reconcile`, { resolusi: "TANPA_STOK", catatan: "pendek" }); assert.equal(tolak.status, 400);
  const e0 = await hitung(); const ok = await w.g.post(`/api/production/provisional-usages/${a.id}/reconcile`, { resolusi: "TANPA_STOK", catatan: "Bahan milik pelanggan, bukan stok Gudang perusahaan" }); assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.deepEqual(await hitung(), e0);
  assert.equal((await w.a.post(`/api/production/provisional-usages/${b.id}/cancel`, { alasan: "" })).status, 400);
  const batal = await w.a.post(`/api/production/provisional-usages/${b.id}/cancel`, { alasan: "Salah memilih bahan" }); assert.equal(batal.status, 201, JSON.stringify(batal.body)); assert.equal(batal.body.item.status, "DIBATALKAN");
  const ad = await adopsi(w); assert.equal(ad.pemakaianSementara.total.dibatalkan, 1); assert.equal(ad.adopsi.pemakaianBahan.sementaraPerluRekonsiliasi, 0);
  assert.equal((await testPrisma.unitProvisionalUsage.count()), 2, "baris tidak dihapus (riwayat asal catatan)");
});

test("K9. koreksi beralasan pada catatan tertaut katalog: bahan + satuan TERKUNCI (tidak bisa pindah bahan), asal tetap wajib, catatan baku dipertahankan, ID katalog terbawa ke catatan pengganti; lama DIBATALKAN 'Dikoreksi:'; klik ganda satu pengganti", async () => {
  const w = await dunia(); const a = (await catat(w)).body.item; const lain = await createTestMaterial({ code: "BUSA-LAIN", name: "BUSA LAIN", unit: "SHEET" });
  const koreksi = (body, key = kunci("kor")) => w.a.post(`/api/production/provisional-usages/${a.id}/correct`, { alasan: "Jumlah salah hitung", ...body }, { "Idempotency-Key": key });
  assert.equal((await koreksi({ qty: 3 })).status, 422, "tanpa perubahan");
  assert.equal((await koreksi({ qty: 4, uom: "METER" })).status, 400, "satuan terkunci"); assert.equal((await koreksi({ qty: 4, originNote: "" })).status, 400, "asal tetap wajib");
  const k = kunci("kor-ok"); const r = await koreksi({ qty: 4, originNote: "Sisa bahan di meja produksi (hitung ulang)", note: "dihitung ulang bersama PIC", materialId: lain.id, name: "BAHAN LAIN" }, k); assert.equal(r.status, 201, JSON.stringify(r.body));
  const baru = r.body.item; assert.equal(baru.materialId, w.mat.id, "materialId dari klien diabaikan: tetap bahan katalog yang sama"); assert.equal(baru.name, "BUSA REBONDED SKY 120X200X10 D70"); assert.equal(baru.qty, 4); assert.equal(baru.tertautKatalog, true); assert.equal(baru.correctedFromId, a.id);
  assert.match(baru.note, /^Stok bahan belum diketahui \(bahan katalog BUSA-SKY-120\)\. Alasan: .*Catatan: dihitung ulang bersama PIC$/, "catatan baku (alasan) dipertahankan");
  const ulang = await koreksi({ qty: 4, originNote: "Sisa bahan di meja produksi (hitung ulang)", note: "dihitung ulang bersama PIC" }, k); assert.equal(ulang.status, 200); assert.equal(ulang.body.replayed, true); assert.equal(await testPrisma.unitProvisionalUsage.count(), 2);
  const lama = await testPrisma.unitProvisionalUsage.findUniqueOrThrow({ where: { id: a.id } }); assert.equal(lama.status, "DIBATALKAN"); assert.match(lama.cancelReason, /^Dikoreksi: Jumlah salah hitung/);
  const ad = await adopsi(w); assert.equal(ad.pemakaianSementara.total.perluRekonsiliasi, 1); assert.equal(ad.adopsi.kerja.source, "PEMAKAIAN_SEMENTARA"); assert.equal(await testPrisma.stockMovement.count(), 0);
});

test("K10. setelah Gudang mencatat stok (saldo diketahui) catatan LAMA tetap utuh dan bisa direkonsiliasi, tetapi catatan BARU untuk bahan itu ditolak (BAHAN_STOK_DIKETAHUI) — jalur resmi mengambil alih", async () => {
  const w = await dunia(); const a = (await catat(w)).body.item; await seedBalance(w.mat.id, 20);
  const baru = await catat(w, isi(w), kunci("setelah")); assert.equal(baru.status, 409); assert.equal(baru.body.code, "BAHAN_STOK_DIKETAHUI");
  const k = await w.g.get(`/api/production/provisional-usages/${a.id}/candidates`); assert.equal(k.status, 200); assert.equal((await adopsi(w)).pemakaianSementara.items[0].status, "PERLU_REKONSILIASI");
  const resmi = await w.p.post(`/api/units/${w.unit.id}/materials`, { materialId: w.mat.id, qty: 3 }, { "Idempotency-Key": kunci("res") }); assert.equal(resmi.status, 201, "pekerja kini bisa mencatat lewat jalur resmi (saldo diketahui)");
  const tautkan = await w.g.post(`/api/production/provisional-usages/${a.id}/reconcile`, { resolusi: "TAUTKAN_ISSUE", stockMovementId: resmi.body.id }); assert.equal(tautkan.status, 201, JSON.stringify(tautkan.body));
  assert.equal(await saldo(w.mat.id), 17, "dihitung sekali: hanya pengeluaran resmi 3 (catatan sementara tidak menambah pengurangan)");
});

test("K11. jalur bahan BELUM ADA di katalog (nama bebas + usulan) tidak berubah: tetap tanpa materialId, tanpa kewajiban asal/alasan baku, tertautKatalog=false", async () => {
  const w = await dunia();
  const r = await w.a.post(`/api/production/units/${w.unit.id}/provisional-usages`, { name: "Lem Kontak Impor 5L", qty: 2, uom: "CAN" }, { "Idempotency-Key": kunci("lama") }); assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.item.materialId, null); assert.equal(r.body.item.tertautKatalog, false); assert.equal(r.body.item.bahanKatalog, null); assert.equal(r.body.item.originNote, null);
  const u = await w.a.post("/api/production/material-proposals", { name: "Pegas Spiral Khusus", unit: "METER", kelompok: "PEGAS" }); assert.equal(u.status, 201);
  const sem = await w.a.post(`/api/production/units/${w.unit.id}/provisional-usages`, { name: "Pegas Spiral Khusus", qty: 1, uom: "METER", proposalId: u.body.usulan.id }, { "Idempotency-Key": kunci("usul") }); assert.equal(sem.status, 201); assert.equal(sem.body.item.tertautKatalog, false);
  assert.equal((await w.a.post(`/api/production/units/${w.unit.id}/provisional-usages`, { name: "X", qty: 1, uom: "PCS" }, { "Idempotency-Key": kunci("pendek") })).status, 400);
});

test("K12. DB: material_id catatan pemakaian sementara TIDAK bisa diubah lewat SQL langsung (trigger penjaga) — baris tertaut katalog maupun baris biasa; satu-satunya perubahan sah = rekonsiliasi TAUTKAN_ISSUE (NULL → bahan pergerakan resmi); koreksi memakai baris versi baru", async () => {
  const w = await dunia(); const lain = await createTestMaterial({ code: "BUSA-LAIN", name: "BUSA LAIN", unit: "CAN" });
  const a = (await catat(w)).body.item; // tertaut katalog (PERLU_REKONSILIASI)
  const biasa = (await w.a.post(`/api/production/units/${w.unit.id}/provisional-usages`, { name: "Lem Kontak Impor 5L", qty: 1, uom: "CAN" }, { "Idempotency-Key": kunci("biasa") })).body.item;
  const ditolak = async (sql, pola) => { let err = null; try { await testPrisma.$executeRawUnsafe(sql); } catch (e) { err = e; } assert.ok(err, `harus ditolak: ${sql}`); assert.match(String(err.message), pola, sql); };
  await ditolak(`UPDATE unit_provisional_usages SET material_id = '${lain.id}' WHERE id = '${a.id}'`, /material_id\) catatan pemakaian sementara tidak boleh diubah/);
  await ditolak(`UPDATE unit_provisional_usages SET material_id = NULL WHERE id = '${a.id}'`, /material_id\) catatan pemakaian sementara tidak boleh diubah/);
  await ditolak(`UPDATE unit_provisional_usages SET material_id = '${w.mat.id}' WHERE id = '${biasa.id}'`, /material_id\) catatan pemakaian sementara tidak boleh diubah/);
  await ditolak(`UPDATE unit_provisional_usages SET material_id = '${lain.id}', status = 'DIREKONSILIASI', resolution = 'TANPA_STOK', resolved_by = '${w.admin.id}', resolved_at = now(), resolution_note = 'catatan penyelesaian cukup panjang' WHERE id = '${biasa.id}'`, /material_id\) catatan pemakaian sementara tidak boleh diubah/);
  await ditolak(`UPDATE unit_provisional_usages SET name = 'BAHAN LAIN' WHERE id = '${a.id}'`, /kolom asal catatan pemakaian sementara tidak boleh diubah/);
  await ditolak(`DELETE FROM unit_provisional_usages WHERE id = '${a.id}'`, /tidak boleh dihapus/);
  const tetap = await testPrisma.unitProvisionalUsage.findUniqueOrThrow({ where: { id: a.id } }); assert.equal(tetap.materialId, w.mat.id, "tautan tidak berubah setelah semua percobaan"); assert.equal((await testPrisma.unitProvisionalUsage.findUniqueOrThrow({ where: { id: biasa.id } })).materialId, null);
  // yang SAH tetap jalan: batal oleh API (status berubah, material_id sama), koreksi (baris baru), dan rekonsiliasi TAUTKAN pada baris biasa (NULL → bahan pergerakan)
  const kor = await w.a.post(`/api/production/provisional-usages/${a.id}/correct`, { alasan: "Jumlah salah", qty: 2, originNote: "Sisa bahan di meja produksi" }, { "Idempotency-Key": kunci("kor") }); assert.equal(kor.status, 201, JSON.stringify(kor.body)); assert.equal(kor.body.item.materialId, w.mat.id);
  assert.equal((await testPrisma.unitProvisionalUsage.findUniqueOrThrow({ where: { id: a.id } })).materialId, w.mat.id, "baris lama tetap bertaut ke bahan yang sama (dibatalkan, tidak diubah)");
  await seedBalance(lain.id, 5); const mv = await w.g.post(`/api/units/${w.unit.id}/materials`, { materialId: lain.id, qty: 1 }, { "Idempotency-Key": kunci("mv") }); assert.equal(mv.status, 201);
  const tautkan = await w.g.post(`/api/production/provisional-usages/${biasa.id}/reconcile`, { resolusi: "TAUTKAN_ISSUE", stockMovementId: mv.body.id, catatan: "satuan berbeda ditangani Gudang" }); assert.equal(tautkan.status, 201, JSON.stringify(tautkan.body)); assert.equal(tautkan.body.item.materialId, lain.id, "rekonsiliasi sah mengisi material_id dari pergerakan resmi");
  await ditolak(`UPDATE unit_provisional_usages SET material_id = '${w.mat.id}' WHERE id = '${biasa.id}'`, /baris final|riwayat penyelesaian tidak boleh berubah|material_id/);
});
