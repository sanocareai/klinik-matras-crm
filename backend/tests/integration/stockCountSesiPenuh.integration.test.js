// STOCK OPNAME SESI PENUH (model 2) — cakupan sekali pilih (saldo dilacak fisik), pratinjau, 0 vs kosong, blind count di server, revisi/konflik dua petugas, TIGA WAKTU (pengamatan / disimpan / posting ledger), selisih/pemeriksa/Selesaikan tepat sekali,
// sesi lama tetap terbaca. DB terisolasi, 360 bahan aktif (termasuk tanpa kelompok, tanpa catatan stok, satuan berbeda, saldo negatif).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, seedBalance, createTestUnit } from "./setup/fixtures.js";
import { postStockMovement } from "../../src/services/inventoryLedger.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const SC = "/api/inventory/stock-counts";
const UNITS = ["PCS", "METER", "KG", "SHEET", "SPOOL", "PACK"];

async function dunia() {
  const [a, b, c, owner, lead] = await Promise.all([["WAREHOUSE"], ["WAREHOUSE"], ["WAREHOUSE"], ["OWNER"], ["PRODUCTION_LEAD"]].map((roles) => createTestUser({ roles })));
  const cl = (u) => makeClient(server.baseUrl, u.token);
  // 360 bahan aktif: Busa 100, Kain 80, Benang 40, Pegas 30, Aksesori 30, Lem 15, Lainnya 20 (BESI), Belum dikelompokkan 45 (SUPPORT KAIN 25 + tanpa itemGroup 20)
  const spek = [["REBONDED", 100], ["KAIN", 80], ["BENANG", 40], ["PER BONNEL", 30], ["PAKU", 30], ["LEM", 15], ["BESI", 20], ["SUPPORT KAIN", 25], [null, 20]];
  const data = []; let n = 0;
  for (const [grup, jumlah] of spek) for (let i = 0; i < jumlah; i++) { n++; data.push({ code: `M${String(n).padStart(4, "0")}`, name: `Bahan ${n}`, unit: UNITS[n % UNITS.length], category: n % 180 === 0 ? "CONSUMABLE" : "RAW_MATERIAL", itemGroup: grup, active: true, referenceStockValue: 1000 }); }
  for (let i = 0; i < 15; i++) data.push({ code: `X${String(i).padStart(3, "0")}`, name: `Nonaktif ${i}`, unit: "PCS", category: "RAW_MATERIAL", itemGroup: "KAIN", active: false });
  await testPrisma.material.createMany({ data });
  const bahan = await testPrisma.material.findMany({ orderBy: { code: "asc" } });
  // saldo: 300 bahan = 100, 10 negatif, sisanya tanpa catatan stok sama sekali (belum diketahui)
  const aktif = bahan.filter((m) => m.active);
  await testPrisma.stockMovement.createMany({ data: aktif.slice(0, 300).map((m) => ({ materialId: m.id, type: "RECEIPT", qty: 100, note: "seed", createdAt: new Date(Date.now() - 5 * 86_400_000) })) });
  await testPrisma.stockMovement.createMany({ data: aktif.slice(300, 310).map((m) => ({ materialId: m.id, type: "ADJUSTMENT", qty: -4, note: "seed minus", createdAt: new Date(Date.now() - 5 * 86_400_000) })) });
  return { a, b, c, owner, lead, A: cl(a), B: cl(b), C: cl(c), O: cl(owner), L: cl(lead), bahan, aktif };
}
const buatPenuh = async (w, extra = {}) => { const r = await w.A.post(SC, { mode: "FULL", blindCount: true, ...extra }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; };
const kerja = async (w, id, cl = w.A) => (await cl.get(`${SC}/${id}/kerja`)).body;
const simpan = (cl, id, items) => cl.put(`${SC}/${id}/hasil`, { items });
const mulai = async (cl, id) => { const r = await cl.post(`${SC}/${id}/start`, {}); assert.equal(r.status, 200, JSON.stringify(r.body)); };
const jumlahMov = () => testPrisma.stockMovement.count();

test("pratinjau cakupan: penuh = seluruh bahan aktif (tanpa kelompok tetap ikut), nonaktif dihitung terpisah, pengecualian per jenis/bahan, batas Cycle Count; baca-saja", async () => {
  const w = await dunia(); const awal = { sesi: await testPrisma.stockCount.count(), mov: await jumlahMov() };
  const p = (await w.A.post(`${SC}/scope-preview`, { mode: "FULL" })).body.ringkasan;
  assert.equal(p.masuk, 360); assert.equal(p.bahanAktif, 360); assert.equal(p.belumDikelompokkan.masuk, 45, "SUPPORT KAIN + tanpa itemGroup tetap ikut opname penuh"); assert.equal(p.nonaktif.jumlah, 15);
  assert.equal(p.perKelompok.find((k) => k.kode === "BUSA").masuk, 100); assert.equal(p.tanpaCatatanStok, 50, "360 − 300 − 10 punya catatan"); assert.equal(p.saldoMinus, 10);
  assert.ok(Object.keys(p.perSatuan).length >= 5, "satuan berbeda terwakili");
  const pj = (await w.A.post(`${SC}/scope-preview`, { mode: "FULL", excludeJenis: ["CONSUMABLE"] })).body.ringkasan; assert.equal(pj.masuk, 358); assert.equal(pj.pengecualian.jenis[0].jumlah, 2);
  const x = w.aktif[0].id;
  assert.equal((await w.A.post(`${SC}/scope-preview`, { mode: "FULL", excludeMaterialIds: [x] })).status, 400, "pengecualian bahan wajib beralasan");
  const pb = (await w.A.post(`${SC}/scope-preview`, { mode: "FULL", excludeMaterialIds: [x], excludeReason: "Barang konsinyasi" })).body.ringkasan; assert.equal(pb.masuk, 359); assert.equal(pb.pengecualian.bahan[0].alasan, "Barang konsinyasi");
  const pg = (await w.A.post(`${SC}/scope-preview`, { mode: "GROUP", groups: ["BUSA", "BENANG"] })).body.ringkasan; assert.equal(pg.masuk, 140);
  assert.equal((await w.A.post(`${SC}/scope-preview`, { mode: "GROUP", groups: [] })).status, 400);
  assert.equal((await w.A.post(`${SC}/scope-preview`, { mode: "ITEMS", materialIds: w.aktif.slice(0, 51).map((m) => m.id) })).status, 400, "Cycle Count dibatasi 50");
  assert.equal((await w.A.post(`${SC}/scope-preview`, { mode: "ITEMS", materialIds: [w.bahan.find((m) => !m.active).id] })).status, 400, "bahan nonaktif ditolak");
  assert.equal((await w.A.post(`${SC}/scope-preview`, { mode: "ASAL" })).status, 400);
  assert.equal((await w.L.post(`${SC}/scope-preview`, { mode: "FULL" })).status, 200, "akun baca-saja boleh melihat pratinjau");
  assert.equal(await testPrisma.stockCount.count(), awal.sesi); assert.equal(await jumlahMov(), awal.mov, "pratinjau tidak menulis apa pun");
  const daftar = (await w.A.get(`${SC}/bahan?q=Bahan 1&limit=10`)).body; assert.ok(daftar.total > 10 && daftar.items.length === 10 && daftar.items[0].kelompok.kode, "daftar bahan Cycle Count: cari + kelompok");
});

test("membuat sesi penuh SEKALI pilih: 360 baris tersimpan (Material ID), satu sesi penuh aktif, cakupan tidak berubah oleh master baru; per kelompok dan Cycle Count; baca-saja ditolak", async () => {
  const w = await dunia(); const mov0 = await jumlahMov();
  const t0 = Date.now(); const s = await buatPenuh(w, { notes: "Opname 1 Nov" }); const ms = Date.now() - t0;
  assert.equal(s.jumlahBahan, 360); assert.equal(s.countType, "FULL_STOCK_OPNAME"); assert.ok(ms < 8000, `pembuatan sesi penuh ${ms}ms`);
  const baris = await testPrisma.stockCountLine.findMany({ where: { stockCountId: s.id } }); assert.equal(baris.length, 360); assert.equal(new Set(baris.map((l) => l.materialId)).size, 360, "tiap bahan sekali"); assert.ok(baris.every((l) => l.countedQty === null && l.systemQty === null && l.savedAt === null && l.observedAt === null));
  const row = await testPrisma.stockCount.findUnique({ where: { id: s.id } }); assert.equal(row.modelVersion, 2); assert.equal(row.scopeMode, "FULL"); assert.equal(row.scopeInfo.ringkasan.masuk, 360);
  assert.equal((await w.A.post(SC, { mode: "FULL" })).status, 409, "tidak boleh dua sesi penuh bersamaan");
  // master baru muncul setelah sesi dibuat → TIDAK diam-diam masuk; tampil sebagai di luar cakupan
  const baru = await testPrisma.material.create({ data: { code: "BARU-1", name: "Bahan Baru", unit: "PCS", category: "RAW_MATERIAL", itemGroup: "KAIN", active: true, referenceStockValue: 500 } }); // punya nilai referensi stok = berjejak, jadi dilacak
  assert.equal(await testPrisma.stockCountLine.count({ where: { stockCountId: s.id } }), 360);
  const k = await kerja(w, s.id); assert.equal(k.progres.total, 360); assert.deepEqual(k.diLuarCakupan.map((x) => x.kode), ["BARU-1"]);
  // sesi per kelompok + cycle count
  await testPrisma.stockCount.update({ where: { id: s.id }, data: { status: "CANCELLED" } });
  const g = await w.A.post(SC, { mode: "GROUP", groups: ["BUSA", "PEGAS"].filter((x) => x === "BUSA") }); assert.equal(g.status, 201); assert.equal(g.body.jumlahBahan, 100); assert.equal(g.body.countType, "CYCLE_COUNT");
  const it = await w.A.post(SC, { mode: "ITEMS", materialIds: w.aktif.slice(0, 5).map((m) => m.id) }); assert.equal(it.status, 201); assert.equal(it.body.jumlahBahan, 5);
  assert.equal((await w.L.post(SC, { mode: "FULL" })).status, 403, "akun baca-saja tidak membuat sesi"); void baru;
  assert.equal(await jumlahMov(), mov0, "membuat sesi tidak menulis ledger");
});

// ── helper bersama untuk tes waktu ───────────────────────────────────────────────────────────────────────────────────────────────
const menitLalu = (n) => new Date(Date.now() - n * 60_000);
const iso = (d) => new Date(d).toISOString();
const mundurkanMulai = (id, jam = 6) => testPrisma.stockCount.update({ where: { id }, data: { startedAt: new Date(Date.now() - jam * 3600_000) } });
const sesiItems = async (w, materialIds, extra = {}) => {
  const s = (await w.A.post(SC, { mode: "ITEMS", materialIds, blindCount: true, ...extra })).body; await mulai(w.A, s.id); await mundurkanMulai(s.id);
  const k = await kerja(w, s.id); return { s, k, L: Object.fromEntries(k.baris.map((b) => [b.materialId, b])) };
};
const saldoBahan = async (m) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: m }, _sum: { qty: true } }))._sum.qty ?? 0);
const gerak = (materialId, qty, at, note = "uji") => testPrisma.stockMovement.create({ data: { materialId, type: qty > 0 ? "RECEIPT" : "ISSUE", qty, note, createdAt: at } });
const detail = async (cl, id) => (await cl.get(`${SC}/${id}`)).body;
const tinjauBahan = (d, materialId) => d.lines.find((l) => l.materialId === materialId).tinjau;
const tandai = (cl, id, mvId, tercermin) => cl.post(`${SC}/${id}/pergerakan/${mvId}/tanda`, { tercermin });
const periksaLalu = async (w, id) => { assert.equal((await w.C.post(`${SC}/${id}/periksa`, {})).status, 200); };
const grResmi = async (w, materialId, qty, { receivedDate } = {}) => {
  const c = await w.A.post("/api/inventory/goods-receipts", { sourceType: "SUPPLIER_DELIVERY", supplier: "Supplier Tes", lines: [{ materialId, orderedQty: qty }] }); assert.equal(c.status, 201, JSON.stringify(c.body));
  if (receivedDate) assert.equal((await w.A.patch(`/api/inventory/goods-receipts/${c.body.id}`, { receivedDate })).status, 200);
  for (const status of ["SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"]) assert.equal((await w.A.patch(`/api/inventory/goods-receipts/${c.body.id}`, { status })).status, 200);
  await w.A.patch(`/api/inventory/goods-receipts/${c.body.id}/lines/${c.body.lines[0].id}`, { acceptedQty: qty }); const p = await w.A.post(`/api/inventory/goods-receipts/${c.body.id}/putaway`, {}); assert.equal(p.status, 200, JSON.stringify(p.body)); return c.body.id;
};
const miResmi = async (w, materialId, qty) => {
  const { unit } = await createTestUnit();
  const c = await w.A.post("/api/inventory/material-issues", { sourceType: "PRODUCTION_WORK_ORDER", unitId: unit.id, lines: [{ materialId, requestedQty: qty }] }); assert.equal(c.status, 201, JSON.stringify(c.body));
  for (const status of ["WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"]) assert.equal((await w.A.patch(`/api/inventory/material-issues/${c.body.id}`, { status })).status, 200);
  const i = await w.A.post(`/api/inventory/material-issues/${c.body.id}/issue`, {}); assert.equal(i.status, 200, JSON.stringify(i.body)); return c.body.id;
};

test("0 eksplisit vs kosong: kosong = belum dihitung; nol hanya bila dikirim 0; progres per kelompok; simpan bertahap & lanjut; angka negatif/tidak valid ditolak; submit ditolak selama ada yang belum; waktu pengamatan TIDAK dikarang dari waktu simpan", async () => {
  const w = await dunia(); const s = await buatPenuh(w); await mulai(w.A, s.id); const mov0 = await jumlahMov();
  let k = await kerja(w, s.id); assert.equal(k.progres.dihitung, 0); assert.equal(k.progres.belum, 360);
  const dp = (await w.A.get(`${SC}/${s.id}`)).body.progres; assert.equal(dp.perKelompok.find((x) => x.kode === "BUSA").total, 100, "detail: progres per kelompok dari itemGroup master"); assert.equal(dp.perKelompok.find((x) => x.kode === "BELUM").total, 45);
  const [b1, b2, b3] = k.baris;
  const r = (await simpan(w.A, s.id, [{ lineId: b1.id, revision: 0, countedQty: 0 }, { lineId: b2.id, revision: 0, countedQty: 12.5 }, { lineId: b3.id, revision: 0, countedQty: "" }])).body;
  assert.equal(r.hasil[0].status, "DISIMPAN"); assert.equal(r.hasil[0].counted, 0); assert.equal(r.hasil[1].counted, 12.5); assert.equal(r.hasil[2].status, "TIDAK_BERUBAH", "kolom kosong tetap belum dihitung");
  assert.equal(r.progres.dihitung, 2, "nol eksplisit terhitung; kosong tidak"); assert.equal(r.progres.belum, 358);
  assert.equal(r.hasil[0].observedAt, null, "tanpa Mulai hitung / pernyataan waktu: waktu pengamatan TIDAK DIKETAHUI, tidak diisi waktu simpan"); assert.equal(r.hasil[0].tanpaWaktu, true); assert.equal(r.progres.tanpaWaktu, 2);
  k = await kerja(w, s.id); const kb1 = k.baris.find((b) => b.id === b1.id); assert.equal(kb1.counted, 0, "0 tersimpan sebagai 0, bukan null"); assert.equal(k.baris.find((b) => b.id === b3.id).counted, null);
  assert.ok(kb1.savedAt && kb1.countedBy.id === w.a.user.id, "waktu simpan & petugas per bahan"); assert.equal(kb1.observedAt, null); assert.equal(kb1.observedSource, null);
  for (const salah of [-1, "abc", "1e999"]) assert.equal((await simpan(w.A, s.id, [{ lineId: b3.id, revision: 0, countedQty: salah }])).body.hasil[0].status, "DITOLAK", String(salah));
  assert.equal((await simpan(w.A, s.id, [{ lineId: b3.id, countedQty: 1 }])).body.hasil[0].code, "REVISI_WAJIB");
  const gagal = await w.A.post(`${SC}/${s.id}/submit`, {}); assert.equal(gagal.status, 400); assert.equal(gagal.body.code, "MASIH_ADA_BELUM_DIHITUNG"); assert.match(gagal.body.error, /358 item belum/);
  assert.equal(await jumlahMov(), mov0, "menyimpan hitungan tidak mengubah saldo/ledger");
  // sesi tidak menerima hitungan sebelum Mulai / sesudah diserahkan
  const s2 = await w.A.post(SC, { mode: "ITEMS", materialIds: w.aktif.slice(0, 2).map((m) => m.id) }); const k2 = await kerja(w, s2.body.id);
  assert.equal((await simpan(w.A, s2.body.id, [{ lineId: k2.baris[0].id, revision: 0, countedQty: 1 }])).status, 409, "belum dimulai");
});

test("blind count disaring di SERVER: tanpa saldo/pembanding/pergerakan untuk penghitung sebelum diserahkan; sesudah diserahkan saldo sebanding + tiga waktu tampil; non-blind menampilkan", async () => {
  const w = await dunia(); const ids = w.aktif.slice(0, 3).map((m) => m.id);
  const { s, k } = await sesiItems(w, ids); const O = menitLalu(60);
  await simpan(w.A, s.id, k.baris.map((b) => ({ lineId: b.id, revision: 0, countedQty: 100, observedAt: iso(O) })));
  const d = (await w.A.get(`${SC}/${s.id}`)).body; assert.equal(d.sembunyikanSaldo, true); assert.ok(d.lines.every((l) => l.systemQty === null && !l.tinjau), "tidak ada saldo/pembanding di respons"); assert.deepEqual(d.pergerakanSesi, []);
  assert.ok(!JSON.stringify(k).includes("systemQty") && !("saldo" in k.baris[0]), "halaman kerja tidak memuat saldo");
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 200);
  const d2 = (await w.B.get(`${SC}/${s.id}`)).body; assert.equal(d2.sembunyikanSaldo, false);
  const l0 = d2.lines[0]; assert.equal(l0.tinjau.pembanding, 100); assert.equal(l0.tinjau.selisih, 0); assert.ok(l0.savedAt && l0.observedAt && l0.observedSource === "DINYATAKAN", "waktu simpan dan waktu pengamatan terpisah");
  assert.notEqual(iso(l0.savedAt), iso(l0.observedAt));
  const sNon = (await w.A.post(SC, { mode: "ITEMS", materialIds: ids, blindCount: false })).body; await mulai(w.A, sNon.id); await mundurkanMulai(sNon.id); const kn = await kerja(w, sNon.id);
  await simpan(w.A, sNon.id, [{ lineId: kn.baris[0].id, revision: 0, countedQty: 90, observedAt: iso(menitLalu(30)) }]);
  const dn = (await w.A.get(`${SC}/${sNon.id}`)).body; assert.equal(dn.sembunyikanSaldo, false); assert.equal(dn.lines.find((l) => l.id === kn.baris[0].id).tinjau.pembanding, 100);
});

test("dua petugas: revisi basi = konflik jelas (angka & pelaku terbaru), tidak menimpa diam-diam; koreksi wajib alasan; riwayat angka lama/baru/pelaku/waktu/alasan; ditandai ragu → Perlu diperiksa", async () => {
  const w = await dunia(); const s = await buatPenuh(w); await mulai(w.A, s.id); const k = await kerja(w, s.id); const bar = k.baris[5];
  const a1 = (await simpan(w.A, s.id, [{ lineId: bar.id, revision: 0, countedQty: 10 }])).body.hasil[0]; assert.equal(a1.status, "DISIMPAN"); assert.equal(a1.revision, 1);
  const b1 = (await simpan(w.B, s.id, [{ lineId: bar.id, revision: 0, countedQty: 99 }])).body.hasil[0];
  assert.equal(b1.status, "KONFLIK"); assert.equal(b1.code, "REVISI_BASI"); assert.equal(b1.saatIni.counted, 10); assert.equal(b1.saatIni.revision, 1); assert.equal(b1.saatIni.oleh.id, w.a.user.id);
  assert.equal((await kerja(w, s.id)).baris.find((x) => x.id === bar.id).counted, 10, "angka A tidak tertimpa");
  const b2 = (await simpan(w.B, s.id, [{ lineId: bar.id, revision: 1, countedQty: 11 }])).body.hasil[0]; assert.equal(b2.code, "ALASAN_KOREKSI_WAJIB", "mengubah angka tersimpan wajib alasan");
  const b3 = (await simpan(w.B, s.id, [{ lineId: bar.id, revision: 1, countedQty: 11, alasan: "Hitung ulang di rak B" }])).body.hasil[0]; assert.equal(b3.status, "DISIMPAN"); assert.equal(b3.revision, 2); assert.equal(b3.perluPeriksa, true);
  const rw = (await w.A.get(`${SC}/${s.id}/lines/${bar.id}/riwayat`)).body.riwayat; assert.equal(rw.length, 2); assert.deepEqual([rw[1].lama, rw[1].baru, rw[1].alasan], [10, 11, "Hitung ulang di rak B"]); assert.ok(rw[1].oleh && rw[1].pada); assert.equal(rw[1].jenis, "ANGKA");
  const kk = await kerja(w, s.id); assert.equal(kk.baris.find((x) => x.id === bar.id).countedBy.id, w.b.user.id); assert.ok(kk.progres.perluPeriksa >= 1);
  const lain = kk.baris[7]; await simpan(w.A, s.id, [{ lineId: lain.id, revision: 0, countedQty: 3, perluPeriksa: true }]); assert.equal((await kerja(w, s.id)).baris.find((x) => x.id === lain.id).perluPeriksa, true);
  // klik ganda (permintaan sama dikirim ulang dengan revisi lama) → konflik, bukan dua kali simpan
  const dobel = (await simpan(w.A, s.id, [{ lineId: lain.id, revision: 0, countedQty: 3, perluPeriksa: true }])).body.hasil[0]; assert.equal(dobel.status, "KONFLIK");
});

test("KASUS 1 — dihitung 10.00, angka disimpan 10.40 (jeda > 30 menit), GR diposting 10.05: GR tidak diam-diam masuk pembanding fisik; tiga waktu terpisah; keputusan pemeriksa menentukan saldo akhir; transaksi 20 menit sebelum pengamatan tidak perlu ditandai (tanpa jendela tetap)", async () => {
  const w = await dunia(); const [mBelum, mSudah, mSalah] = w.aktif.slice(0, 3).map((m) => m.id); // masing-masing saldo ledger 100
  const { s, L } = await sesiItems(w, [mBelum, mSudah, mSalah]);
  const O = menitLalu(50); const grAt = new Date(O.getTime() + 5 * 60_000); // "10.00" dan "10.05"
  await gerak(mBelum, 7, new Date(O.getTime() - 20 * 60_000), "masuk 20 menit SEBELUM dihitung"); // bukan jendela: sudah pasti ada di fisik
  for (const m of [mBelum, mSudah, mSalah]) await gerak(m, 20, grAt, "GR 10.05");
  // fisik: mBelum 107 (100 + 7; GR 10.05 belum ada di rak), mSudah 120 (GR sudah dirak), mSalah 120 (GR sudah dirak, tetapi nanti salah diputuskan "belum" — bukti keputusan menentukan hasil)
  const r = (await simpan(w.A, s.id, [[mBelum, 107], [mSudah, 120], [mSalah, 120]].map(([m, q]) => ({ lineId: L[m].id, revision: 0, countedQty: q, observedAt: iso(O) })))).body;
  assert.ok(r.hasil.every((x) => x.status === "DISIMPAN" && x.observedSource === "DINYATAKAN" && iso(x.observedAt) === iso(O)));
  const kb = (await kerja(w, s.id)).baris.find((b) => b.materialId === mBelum);
  assert.equal(iso(kb.observedAt), iso(O), "waktu pengamatan = waktu yang dinyatakan petugas"); assert.ok(new Date(kb.savedAt).getTime() - O.getTime() > 45 * 60_000, "waktu simpan jauh sesudah waktu pengamatan (jeda > 30 menit)"); assert.notEqual(iso(kb.savedAt), iso(kb.observedAt));
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 200);
  let d = await detail(w.B, s.id);
  const Tb = tinjauBahan(d, mBelum); assert.equal(Tb.saldoSebelum, 107, "ledger sebelum pengamatan (termasuk +7 yang 20 menit sebelumnya)"); assert.equal(Tb.pembanding, 107, "GR 10.05 TIDAK masuk pembanding fisik 10.00 secara diam-diam"); assert.equal(Tb.selisih, 0);
  assert.equal(Tb.transaksi.jumlah, 1, "hanya GR yang ditandai; +7 sebelum pengamatan tidak"); const g = Tb.transaksi.sejakPengamatan[0];
  assert.equal(g.kelas, "SAAT_HITUNG"); assert.equal(g.tanda, null); assert.equal(iso(g.at), iso(grAt), "waktu transaksi ledger diposting ditampilkan terpisah"); assert.equal(g.qty, 20);
  assert.equal(tinjauBahan(d, mSudah).pembanding, 100); assert.equal(tinjauBahan(d, mSudah).selisih, 20, "sebelum diputuskan: GR tidak ikut pembanding → tampak selisih; keputusan belum ada");
  assert.equal(d.sesi.belumDitandai, 3);
  await periksaLalu(w, s.id);
  const tolak = await w.O.post(`${SC}/${s.id}/complete`, {}); assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "PERGERAKAN_SESI_BELUM_DITANDAI"); assert.equal(await testPrisma.stockMovement.count({ where: { stockCountId: s.id } }), 0, "tidak ada penyesuaian ditulis");
  const mvId = async (m) => tinjauBahan(await detail(w.B, s.id), m).transaksi.sejakPengamatan[0].id;
  assert.equal((await tandai(w.A, s.id, await mvId(mBelum), false)).status, 200); assert.equal((await tandai(w.A, s.id, await mvId(mSudah), true)).status, 200); assert.equal((await tandai(w.A, s.id, await mvId(mSalah), false)).status, 200);
  d = await detail(w.B, s.id);
  assert.deepEqual([tinjauBahan(d, mBelum).pembanding, tinjauBahan(d, mBelum).selisih], [107, 0]); assert.deepEqual([tinjauBahan(d, mSudah).pembanding, tinjauBahan(d, mSudah).selisih], [120, 0], "GR sudah ikut terhitung di fisik 120");
  assert.deepEqual([tinjauBahan(d, mSalah).pembanding, tinjauBahan(d, mSalah).selisih], [100, 20]);
  await w.A.patch(`${SC}/${s.id}/lines/${L[mSalah].id}`, { reason: "Uji keputusan pemeriksa" });
  const sel = await w.O.post(`${SC}/${s.id}/complete`, {}); assert.equal(sel.status, 200, JSON.stringify(sel.body));
  const adj = await testPrisma.stockMovement.findMany({ where: { stockCountId: s.id } }); assert.equal(adj.length, 1, "hanya bahan dengan selisih nyata"); assert.equal(adj[0].materialId, mSalah); assert.equal(Number(adj[0].qty), 20);
  assert.equal(await saldoBahan(mBelum), 127, "fisik 107 + GR 20 yang belum ikut terhitung"); assert.equal(await saldoBahan(mSudah), 120, "fisik 120 (GR sudah ikut): tidak ganda"); assert.equal(await saldoBahan(mSalah), 140, "fisik 120 + GR 20 'belum' + penyesuaian +20 = konsekuensi keputusan salah, tercatat di bukti");
  const bukti = (await testPrisma.activityEvent.findFirst({ where: { entityId: s.id, eventType: "DOCUMENT_POSTED" } })).metadata; assert.equal(bukti.aturanWaktu, "PENGAMATAN_V1");
  const bs = bukti.buktiPembanding.find((x) => x.materialId === mSalah); assert.equal(iso(bs.observedAt), iso(O)); assert.ok(bs.savedAt); assert.equal(bs.pergerakan[0].kelas, "SAAT_HITUNG"); assert.equal(bs.pergerakan[0].tanda, "BELUM_TERHITUNG"); assert.equal(bs.saldoSebelum, 100);
});

test("KASUS 2 — barang dihitung lalu ada Material Issue resmi sesudahnya: seluruh pergerakan ditandai, diputuskan massal 'belum tercermin' (hanya kelas SESUDAH_DISIMPAN); saldo akhir = fisik + MI, termasuk bahan dengan selisih", async () => {
  const w = await dunia(); const [m1, m2] = w.aktif.slice(0, 2).map((m) => m.id);
  const { s, L } = await sesiItems(w, [m1, m2]);
  await simpan(w.A, s.id, [{ lineId: L[m1].id, revision: 0, countedQty: 100, observedAt: iso(menitLalu(30)) }, { lineId: L[m2].id, revision: 0, countedQty: 97, observedAt: iso(menitLalu(30)) }]);
  await miResmi(w, m1, 6); await miResmi(w, m2, 10); // diposting SESUDAH angka disimpan
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 200); const d = await detail(w.B, s.id);
  for (const m of [m1, m2]) { const t = tinjauBahan(d, m); assert.equal(t.transaksi.jumlah, 1); assert.equal(t.transaksi.sejakPengamatan[0].kelas, "SESUDAH_DISIMPAN"); assert.ok(t.transaksi.sejakPengamatan[0].dokumen, "nomor dokumen Material Issue tampil"); assert.equal(t.transaksi.sejakPengamatan[0].tanda, null, "tetap harus diputuskan pemeriksa"); }
  assert.equal(tinjauBahan(d, m1).selisih, 0); assert.equal(tinjauBahan(d, m2).selisih, -3);
  await periksaLalu(w, s.id);
  assert.equal((await w.O.post(`${SC}/${s.id}/complete`, {})).body.code, "PERGERAKAN_SESI_BELUM_DITANDAI");
  const k1 = await w.A.post(`${SC}/${s.id}/pergerakan/tanda-massal`, { tercermin: true }); assert.equal(k1.status, 400); assert.equal(k1.body.code, "TANDA_MASSAL_HANYA_BELUM");
  const k2 = await w.A.post(`${SC}/${s.id}/pergerakan/tanda-massal`, { tercermin: false, kelas: "BERTANGGAL_MUNDUR" }); assert.equal(k2.status, 400); assert.equal(k2.body.code, "KELAS_TIDAK_BOLEH_MASSAL");
  const ok = await w.A.post(`${SC}/${s.id}/pergerakan/tanda-massal`, { tercermin: false }); assert.equal(ok.status, 200); assert.equal(ok.body.ditandai, 2); assert.equal(ok.body.tersisa, 0);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: s.id, eventType: "DOCUMENT_EDITED", metadata: { path: ["aksi"], equals: "PERGERAKAN_SESI_DITANDAI" } } }), 2, "tiap pergerakan punya catatan tanda sendiri (pelaku + waktu)");
  assert.equal((await w.A.post(`${SC}/${s.id}/pergerakan/tanda-massal`, { tercermin: false })).body.ditandai, 0, "klik ganda: tidak menandai ulang");
  await w.A.patch(`${SC}/${s.id}/lines/${L[m2].id}`, { reason: "Selisih nyata uji" });
  assert.equal((await w.A.post(`${SC}/${s.id}/complete`, {})).status, 403, "penghitung/penanda tidak boleh menyetujui penyesuaian");
  const sel = await w.O.post(`${SC}/${s.id}/complete`, {}); assert.equal(sel.status, 200, JSON.stringify(sel.body));
  const adj = await testPrisma.stockMovement.findMany({ where: { stockCountId: s.id } }); assert.equal(adj.length, 1); assert.equal(adj[0].materialId, m2); assert.equal(Number(adj[0].qty), -3);
  assert.equal(await saldoBahan(m1), 94, "fisik 100 − MI 6"); assert.equal(await saldoBahan(m2), 87, "fisik 97 − MI 10: penyesuaian −3 + MI −10 dari 100");
});

test("KASUS 3 — dokumen diposting belakangan dengan tanggal kejadian sebelum waktu hitung: BERTANGGAL_MUNDUR, tidak bisa diputuskan massal, pemeriksa melihat tanggal kejadian & dampaknya; 'sudah tercermin' mencegah hitung ganda", async () => {
  const w = await dunia(); const [m] = w.aktif.slice(0, 1).map((x) => x.id);
  const { s, L } = await sesiItems(w, [m]); const kemarin = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  // barang tiba kemarin dan sudah ada di rak saat dihitung (fisik 120); Penerimaannya baru diposting SESUDAH angka disimpan
  await simpan(w.A, s.id, [{ lineId: L[m].id, revision: 0, countedQty: 120, observedAt: iso(menitLalu(30)) }]);
  const grId = await grResmi(w, m, 20, { receivedDate: kemarin });
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 200);
  const d = await detail(w.B, s.id); const t = tinjauBahan(d, m); const g = t.transaksi.sejakPengamatan[0];
  assert.equal(g.kelas, "BERTANGGAL_MUNDUR"); assert.equal(g.tanggalKejadian, kemarin, "tanggal kejadian dokumen tampil"); assert.ok(g.dokumen); assert.equal(t.pembanding, 100); assert.equal(t.selisih, 20, "sebelum diputuskan tampak selisih +20: pemeriksa harus melihat dampaknya");
  await periksaLalu(w, s.id);
  assert.equal((await w.A.post(`${SC}/${s.id}/pergerakan/tanda-massal`, { tercermin: false })).body.ditandai, 0, "kelas mundur TIDAK ikut massal");
  assert.equal((await w.O.post(`${SC}/${s.id}/complete`, {})).body.code, "PERGERAKAN_SESI_BELUM_DITANDAI");
  assert.equal((await tandai(w.A, s.id, g.id, true)).status, 200);
  const d2 = await detail(w.B, s.id); assert.equal(tinjauBahan(d2, m).pembanding, 120); assert.equal(tinjauBahan(d2, m).selisih, 0);
  const sel = await w.O.post(`${SC}/${s.id}/complete`, {}); assert.equal(sel.status, 200, JSON.stringify(sel.body));
  assert.equal(await testPrisma.stockMovement.count({ where: { stockCountId: s.id } }), 0, "tidak ada penyesuaian"); assert.equal(await saldoBahan(m), 120, "fisik 120 = ledger 100 + GR 20; tidak terhitung dua kali (tanpa keputusan SUDAH akan menjadi 140)"); assert.ok(grId);
});

test("KASUS 4 — penyelesaian serentak dengan transaksi: Selesaikan menunggu kunci bahan, tidak memakai saldo basi; transaksi yang baru commit wajib diputuskan dulu; stres dua transaksi + Selesaikan; tepat satu penyesuaian per bahan", async () => {
  const w = await dunia(); const ids = w.aktif.slice(0, 5).map((m) => m.id);
  const { s, L } = await sesiItems(w, ids);
  await simpan(w.A, s.id, ids.map((m) => ({ lineId: L[m].id, revision: 0, countedQty: 98, observedAt: iso(menitLalu(40)) }))); // selisih nyata −2 pada tiap bahan
  for (const m of ids) await w.A.patch(`${SC}/${s.id}/lines/${L[m].id}`, { reason: "Selisih uji serentak" });
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 200); await periksaLalu(w, s.id);
  // (a) transaksi posting masih terbuka (memegang kunci bahan) saat Selesaikan dipanggil → Selesaikan menunggu, lalu melihat pergerakan itu dan menolak sampai diputuskan
  let lepas; const gerbang = new Promise((r) => { lepas = r; });
  const tahan = testPrisma.$transaction(async (tx) => { await postStockMovement(tx, { materialId: ids[2], type: "RECEIPT", qty: 7, note: "posting serentak" }); await gerbang; }, { timeout: 30000, maxWait: 30000 });
  await new Promise((r) => setTimeout(r, 300));
  const pc = w.O.post(`${SC}/${s.id}/complete`, {}); const ketat = await Promise.race([pc.then(() => "selesai"), new Promise((r) => setTimeout(() => r("menunggu"), 1200))]);
  assert.equal(ketat, "menunggu", "Selesaikan menunggu kunci bahan, tidak jalan dengan saldo lama");
  lepas(); await tahan; const hasil1 = await pc;
  assert.equal(hasil1.status, 409, JSON.stringify(hasil1.body)); assert.equal(hasil1.body.code, "PERGERAKAN_SESI_BELUM_DITANDAI");
  assert.equal(await testPrisma.stockMovement.count({ where: { stockCountId: s.id } }), 0, "Selesaikan yang ditolak tidak menulis apa pun");
  // (b) putuskan, lalu stres: dua transaksi baru bersamaan dengan Selesaikan
  assert.equal((await w.A.post(`${SC}/${s.id}/pergerakan/tanda-massal`, { tercermin: false, kelas: "SESUDAH_DISIMPAN" })).body.ditandai, 1);
  const post = (m, q) => testPrisma.$transaction((tx) => postStockMovement(tx, { materialId: m, type: "RECEIPT", qty: q, note: "stres" }), { timeout: 30000 });
  const [rc, ...rp] = await Promise.all([w.O.post(`${SC}/${s.id}/complete`, {}), post(ids[0], 3), post(ids[1], 4), post(ids[3], 5), post(ids[4], 6)]);
  if (rc.status === 409) { // posting yang commit sebelum Selesaikan membaca: wajib diputuskan dulu
    assert.equal(rc.body.code, "PERGERAKAN_SESI_BELUM_DITANDAI");
    assert.equal((await w.A.post(`${SC}/${s.id}/pergerakan/tanda-massal`, { tercermin: false, kelas: "SESUDAH_DISIMPAN" })).status, 200);
    const lagi = await w.O.post(`${SC}/${s.id}/complete`, {}); assert.equal(lagi.status, 200, JSON.stringify(lagi.body));
  } else assert.equal(rc.status, 200, JSON.stringify(rc.body));
  assert.equal(rp.length, 4);
  // invarian: tiap bahan = fisik 98 + Σ pergerakan yang diputuskan 'belum' (semua posting 'belum'); tepat satu penyesuaian −2 per bahan
  const tambahan = new Map([[ids[0], 3], [ids[1], 4], [ids[2], 7], [ids[3], 5], [ids[4], 6]]);
  for (const m of ids) assert.equal(await saldoBahan(m), 98 + tambahan.get(m), `saldo akhir ${m}`);
  const adj = await testPrisma.stockMovement.findMany({ where: { stockCountId: s.id } }); assert.equal(adj.length, 5, "tepat sekali per bahan"); assert.ok(adj.every((a) => Number(a.qty) === -2));
  assert.equal((await w.O.post(`${SC}/${s.id}/complete`, {})).body.ulang, true); assert.equal(await testPrisma.stockMovement.count({ where: { stockCountId: s.id } }), 5, "Selesaikan ulang tidak menulis lagi");
});

test("MULAI HITUNG: waktu dicap SERVER di bawah kunci bahan — transaksi yang sedang diposting commit dulu (jadi 'sebelum pengamatan'), yang menyusul ditandai; klik ganda tidak menggeser waktu; angka sudah ada = ditolak", async () => {
  const w = await dunia(); const [m, m2] = w.aktif.slice(0, 2).map((x) => x.id);
  const s = (await w.A.post(SC, { mode: "ITEMS", materialIds: [m, m2], blindCount: true })).body; await mulai(w.A, s.id); await mundurkanMulai(s.id);
  const k = await kerja(w, s.id); const L = Object.fromEntries(k.baris.map((b) => [b.materialId, b]));
  let lepas; const gerbang = new Promise((r) => { lepas = r; });
  const tahan = testPrisma.$transaction(async (tx) => { await postStockMovement(tx, { materialId: m, type: "RECEIPT", qty: 9, note: "sedang diposting saat Mulai hitung" }); await gerbang; }, { timeout: 30000, maxWait: 30000 });
  await new Promise((r) => setTimeout(r, 300));
  const pm = w.A.post(`${SC}/${s.id}/lines/mulai`, { lineIds: [L[m].id] }); const status = await Promise.race([pm.then(() => "selesai"), new Promise((r) => setTimeout(() => r("menunggu"), 1000))]);
  assert.equal(status, "menunggu", "Mulai hitung menunggu transaksi posting yang memegang kunci bahan");
  lepas(); await tahan; const r1 = await pm; assert.equal(r1.status, 200, JSON.stringify(r1.body)); const h = r1.body.hasil[0]; assert.equal(h.status, "DIMULAI"); assert.equal(h.observedSource, "MULAI");
  const post = await testPrisma.stockMovement.findFirst({ where: { materialId: m, note: "sedang diposting saat Mulai hitung" } }); assert.ok(new Date(h.observedAt).getTime() > post.createdAt.getTime(), "waktu pengamatan SESUDAH waktu posting transaksi yang sudah commit");
  const r2 = (await w.B.post(`${SC}/${s.id}/lines/mulai`, { lineIds: [L[m].id] })).body.hasil[0]; assert.equal(r2.status, "SUDAH_DIMULAI"); assert.equal(iso(r2.observedAt), iso(h.observedAt), "klik ganda / petugas lain tidak menggeser waktu"); assert.equal(r2.oleh.id, w.a.user.id);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: s.id, metadata: { path: ["aksi"], equals: "WAKTU_HITUNG_DICATAT" } } }), 1, "satu catatan waktu, bukan dua");
  const kk = await kerja(w, s.id); const bm = kk.baris.find((b) => b.id === L[m].id); assert.equal(bm.sedangDihitung, true); assert.equal(bm.counted, null); assert.equal(bm.observedBy.id, w.a.user.id);
  // transaksi SETELAH Mulai, sebelum angka disimpan → ditandai SAAT_HITUNG; yang sebelum Mulai (+9) tidak
  await gerak(m, 2, new Date(), "sesudah Mulai"); await new Promise((r) => setTimeout(r, 15));
  await simpan(w.A, s.id, [{ lineId: L[m].id, revision: 0, countedQty: 109 }]);
  const sv = (await kerja(w, s.id)).baris.find((b) => b.id === L[m].id); assert.equal(iso(sv.observedAt), iso(h.observedAt), "angka pertama memakai waktu Mulai yang sudah dicap"); assert.equal(sv.observedSource, "MULAI"); assert.ok(new Date(sv.savedAt) > new Date(sv.observedAt));
  assert.equal((await w.A.post(`${SC}/${s.id}/lines/mulai`, { lineIds: [L[m].id] })).body.hasil[0].code, "SUDAH_ADA_ANGKA");
  await simpan(w.A, s.id, [{ lineId: L[m2].id, revision: 0, countedQty: 100, observedAt: iso(menitLalu(20)) }]);
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 200); const t = tinjauBahan(await detail(w.B, s.id), m);
  assert.equal(t.saldoSebelum, 109, "100 + 9 yang sudah commit sebelum Mulai"); assert.equal(t.transaksi.jumlah, 1); assert.equal(t.transaksi.sejakPengamatan[0].kelas, "SAAT_HITUNG"); assert.equal(t.transaksi.sejakPengamatan[0].qty, 2);
  assert.equal((await w.A.post(`${SC}/${s.id}/lines/mulai`, { lineIds: [L[m].id] })).status, 409, "sesudah diserahkan tidak bisa Mulai");
});

test("WAKTU TIDAK DIKETAHUI & KOREKSI: tidak dikarang dari waktu simpan; serah/selesai ditolak; dinyatakan atau dikoreksi dengan alasan + jejak; masa depan / sebelum sesi ditolak; angka diganti tanpa pengamatan baru → waktu kembali tidak diketahui; tanda direset", async () => {
  const w = await dunia(); const [m, m2] = w.aktif.slice(0, 2).map((x) => x.id);
  const s = (await w.A.post(SC, { mode: "ITEMS", materialIds: [m, m2], blindCount: false })).body; await mulai(w.A, s.id); await mundurkanMulai(s.id);
  const k = await kerja(w, s.id); const L = Object.fromEntries(k.baris.map((b) => [b.materialId, b]));
  await simpan(w.A, s.id, [{ lineId: L[m].id, revision: 0, countedQty: 100 }, { lineId: L[m2].id, revision: 0, countedQty: 100 }]);
  let d = await detail(w.A, s.id); const lm = d.lines.find((l) => l.materialId === m); assert.equal(lm.waktuTidakDiketahui, true); assert.equal(lm.observedAt, null); assert.ok(lm.savedAt);
  assert.equal(lm.tinjau.waktuTidakDiketahui, true); assert.equal(lm.tinjau.pembanding, null, "tanpa waktu pengamatan tidak ada pembanding yang dikarang"); assert.equal(lm.tinjau.selisih, null); assert.equal(d.sesi.tanpaWaktu, 2);
  const tahan = await w.A.post(`${SC}/${s.id}/submit`, {}); assert.equal(tahan.status, 409); assert.equal(tahan.body.code, "WAKTU_HITUNG_BELUM_DIKETAHUI"); assert.match(tahan.body.error, /2 bahan belum punya waktu hitung/);
  const w1 = (body) => w.A.post(`${SC}/${s.id}/lines/${L[m].id}/waktu`, body);
  assert.equal((await w1({ observedAt: iso(menitLalu(30)) })).body.code, "ALASAN_WAKTU_WAJIB");
  assert.equal((await w1({ observedAt: iso(new Date(Date.now() + 3600_000)), alasan: "uji masa depan" })).body.code, "WAKTU_DI_MASA_DEPAN");
  assert.equal((await w1({ observedAt: iso(new Date(Date.now() - 10 * 3600_000)), alasan: "sebelum sesi" })).body.code, "WAKTU_SEBELUM_SESI");
  assert.equal((await w1({ observedAt: "bukan-tanggal", alasan: "uji format" })).body.code, "WAKTU_TIDAK_VALID");
  const O1 = menitLalu(45); const a = (await w1({ observedAt: iso(O1), alasan: "Dicatat dari lembar tulis Nadya" })).body; assert.equal(a.observedSource, "DINYATAKAN"); assert.equal(iso(a.observedAt), iso(O1));
  const lagiSama = (await w1({ observedAt: iso(O1), alasan: "klik ganda" })).body; assert.equal(lagiSama.ulang, true, "klik ganda tidak mencatat ulang");
  const O2 = menitLalu(55); const b = (await w1({ observedAt: iso(O2), alasan: "Jam di lembar ternyata 09.05" })).body; assert.equal(b.observedSource, "DIKOREKSI");
  const rw = (await w.A.get(`${SC}/${s.id}/lines/${L[m].id}/riwayat`)).body.riwayat.filter((x) => x.jenis === "WAKTU");
  assert.equal(rw.length, 2); assert.deepEqual([rw[0].lama, iso(rw[0].baru), rw[0].sumber], [null, iso(O1), "DINYATAKAN"]); assert.deepEqual([iso(rw[1].lama), iso(rw[1].baru), rw[1].sumber, rw[1].alasan], [iso(O1), iso(O2), "DIKOREKSI", "Jam di lembar ternyata 09.05"]); assert.ok(rw[1].oleh && rw[1].pada);
  assert.equal((await w.A.post(`${SC}/${s.id}/lines/${L[m].id}/waktu`, { observedAt: iso(O2), alasan: "revisi basi", revision: 0 })).body.code, "REVISI_BASI", "revisi baris dijaga seperti angka");
  // angka diganti tanpa pengamatan baru → waktu menjadi tidak diketahui; dengan waktuTetap tetap
  const rev = (await kerja(w, s.id)).baris.find((x) => x.id === L[m].id).revision;
  const ganti = (await simpan(w.A, s.id, [{ lineId: L[m].id, revision: rev, countedQty: 101, alasan: "Salah ketik 100" }])).body.hasil[0]; assert.equal(ganti.status, "DISIMPAN"); assert.equal(ganti.observedAt, null); assert.equal(ganti.tanpaWaktu, true);
  await w1({ observedAt: iso(O2), alasan: "Dinyatakan ulang setelah salah ketik" });
  const rev2 = (await kerja(w, s.id)).baris.find((x) => x.id === L[m].id).revision;
  const tetap = (await simpan(w.A, s.id, [{ lineId: L[m].id, revision: rev2, countedQty: 100, alasan: "Salah ketik 101", waktuTetap: true }])).body.hasil[0]; assert.equal(tetap.status, "DISIMPAN"); assert.equal(iso(tetap.observedAt), iso(O2), "salah ketik: waktu hitung tidak berubah");
  // mengganti waktu yang SUDAH tercatat lewat simpan juga wajib beralasan (tanpa alasan ditolak), dan hasilnya DIKOREKSI
  const tanpaAlasan = (await simpan(w.A, s.id, [{ lineId: L[m].id, revision: tetap.revision, countedQty: 100, observedAt: iso(menitLalu(5)) }])).body.hasil[0]; assert.equal(tanpaAlasan.status, "DITOLAK"); assert.equal(tanpaAlasan.code, "ALASAN_WAKTU_WAJIB");
  const hitungUlang = (await simpan(w.A, s.id, [{ lineId: L[m].id, revision: tetap.revision, countedQty: 99, alasan: "Hitung ulang rak", observedAt: iso(menitLalu(5)) }])).body.hasil[0]; assert.equal(hitungUlang.status, "DISIMPAN"); assert.equal(hitungUlang.observedSource, "DIKOREKSI"); assert.equal(hitungUlang.counted, 99);
});

test("TANDA direset bila waktu hitung berubah: keputusan lama dibuat atas pengamatan yang berbeda; pemeriksaan batal; pemeriksa boleh melengkapi waktu saat Waiting Review tetapi menjadi pengisi (bukan penyetuju)", async () => {
  const w = await dunia(); const [m] = w.aktif.slice(0, 1).map((x) => x.id);
  const { s, L } = await sesiItems(w, [m]); const O = menitLalu(40);
  await simpan(w.A, s.id, [{ lineId: L[m].id, revision: 0, countedQty: 100, observedAt: iso(O) }]);
  await gerak(m, 5, new Date(O.getTime() + 60_000), "dalam jendela hitung");
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 200); await periksaLalu(w, s.id);
  const mv = tinjauBahan(await detail(w.B, s.id), m).transaksi.sejakPengamatan[0]; assert.equal((await tandai(w.A, s.id, mv.id, false)).status, 200);
  assert.equal(tinjauBahan(await detail(w.B, s.id), m).transaksi.belumDiputuskan, 0);
  // pemeriksa (C) mengoreksi waktu hitung 10 menit lebih awal → tanda direset dan pemeriksaan batal
  const k = (await kerja(w, s.id)).baris[0];
  const koreksi = await w.C.post(`${SC}/${s.id}/lines/${k.id}/waktu`, { observedAt: iso(new Date(O.getTime() - 10 * 60_000)), alasan: "Rak ini dihitung lebih awal" }); assert.equal(koreksi.status, 200, JSON.stringify(koreksi.body)); assert.equal(koreksi.body.observedSource, "DIKOREKSI");
  const d = await detail(w.B, s.id); assert.equal(tinjauBahan(d, m).transaksi.belumDiputuskan, 1, "tanda lama dihapus"); assert.equal(d.identitas.pemeriksa.length, 0, "pemeriksaan sebelumnya tidak berlaku lagi");
  assert.equal((await w.O.post(`${SC}/${s.id}/complete`, {})).status, 409);
  assert.equal((await tandai(w.A, s.id, mv.id, false)).status, 200); await periksaLalu(w, s.id);
  const selC = await w.C.post(`${SC}/${s.id}/complete`, {}); assert.equal(selC.status, 200, JSON.stringify(selC.body)); // tanpa selisih: pemegang akses gudang boleh menyelesaikan
  assert.equal(await saldoBahan(m), 105, "fisik 100 + 5 yang diputuskan belum tercermin");
});

test("PERGERAKAN SERENTAK (tepat di milidetik pengamatan) ditandai SERENTAK dan wajib diputuskan; transaksi sebelum pengamatan tidak", async () => {
  const w = await dunia(); const [m] = w.aktif.slice(0, 1).map((x) => x.id);
  const { s, L } = await sesiItems(w, [m]); const O = menitLalu(20);
  await gerak(m, 4, O, "tepat saat dihitung"); await gerak(m, 3, new Date(O.getTime() - 1), "1 ms sebelum");
  await simpan(w.A, s.id, [{ lineId: L[m].id, revision: 0, countedQty: 103, observedAt: iso(O) }]); assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 200);
  const t = tinjauBahan(await detail(w.B, s.id), m); assert.equal(t.saldoSebelum, 103, "100 + 3 (1 ms sebelum) — yang tepat di milidetik pengamatan TIDAK diputuskan diam-diam"); assert.equal(t.transaksi.jumlah, 1); assert.equal(t.transaksi.sejakPengamatan[0].kelas, "SERENTAK");
});

test("cakupan DILACAK FISIK: bahan tanpa jejak stok tidak ikut dan tampil dengan alasan di pratinjau; kategori tidak menentukan (Habis Pakai berjejak ikut, Habis Pakai tanpa jejak tidak); bisa diikutkan beralasan; jejak baru → muncul sebagai di luar cakupan; baca-saja", async () => {
  const w = await dunia(); const mk = (code, category, extra = {}) => testPrisma.material.create({ data: { code, name: `Uji ${code}`, unit: "PCS", category, itemGroup: "LEM", active: true, ...extra } });
  const u1 = await mk("TAK-RAW", "RAW_MATERIAL"); const u2 = await mk("TAK-HP", "CONSUMABLE"); const c1 = await mk("ADA-HP", "CONSUMABLE");
  await testPrisma.stockMovement.create({ data: { materialId: c1.id, type: "RECEIPT", qty: 12, note: "stok Habis Pakai", createdAt: new Date(Date.now() - 86_400_000) } });
  const awal = { sesi: await testPrisma.stockCount.count(), mov: await jumlahMov() };
  const p = (await w.A.post(`${SC}/scope-preview`, { mode: "FULL" })).body.ringkasan;
  assert.equal(p.masuk, 361, "360 + Habis Pakai yang punya catatan stok"); assert.equal(p.tidakDilacak.jumlah, 2); assert.deepEqual(p.tidakDilacak.daftar.map((x) => x.kode).sort(), ["TAK-HP", "TAK-RAW"]);
  assert.ok(p.tidakDilacak.daftar.every((x) => /Tidak ada jejak stok/.test(x.alasan) && x.diikutkan === false)); assert.match(p.dasarCakupan, /dilacak secara fisik/); assert.equal(p.perJenis.CONSUMABLE, 3, "2 Habis Pakai dari master dunia (berjejak) + ADA-HP; TAK-HP tidak dihitung");
  const bantah = await w.A.post(`${SC}/scope-preview`, { mode: "FULL", ikutkanTakDilacak: [u1.id] }); assert.equal(bantah.status, 400); assert.equal(bantah.body.code, "ALASAN_IKUTKAN_WAJIB");
  const ikut = (await w.A.post(`${SC}/scope-preview`, { mode: "FULL", ikutkanTakDilacak: [u1.id], ikutkanAlasan: "Ada barangnya di rak C" })).body.ringkasan; assert.equal(ikut.masuk, 362); assert.equal(ikut.tidakDilacak.diikutkan, 1);
  assert.equal(await testPrisma.stockCount.count(), awal.sesi); assert.equal(await jumlahMov(), awal.mov, "pratinjau tidak menulis apa pun");
  const s = (await w.A.post(SC, { mode: "FULL", ikutkanTakDilacak: [u1.id], ikutkanAlasan: "Ada barangnya di rak C" })).body; assert.equal(s.jumlahBahan, 362);
  const info = (await testPrisma.stockCount.findUnique({ where: { id: s.id } })).scopeInfo; assert.deepEqual(info.ikutkanTakDilacak, [u1.id]); assert.equal(info.ikutkanAlasan, "Ada barangnya di rak C"); assert.equal(info.ringkasan.tidakDilacak.jumlah, 2);
  assert.equal(await testPrisma.stockCountLine.count({ where: { stockCountId: s.id, materialId: { in: [u2.id] } } }), 0, "yang tak dilacak dan tak diikutkan tidak masuk sesi");
  await mulai(w.A, s.id); assert.deepEqual((await kerja(w, s.id)).diLuarCakupan, [], "bahan tak dilacak tidak dianggap 'di luar cakupan' selama tetap tanpa jejak");
  await testPrisma.stockMovement.create({ data: { materialId: u2.id, type: "RECEIPT", qty: 1, note: "ternyata ada stoknya" } }); // jejak baru → kini dilacak
  assert.deepEqual((await kerja(w, s.id)).diLuarCakupan.map((x) => x.kode), ["TAK-HP"], "muncul sebagai di luar cakupan: harus diputuskan (tambahkan / abaikan)");
  const g = (await w.A.post(`${SC}/scope-preview`, { mode: "GROUP", groups: ["LEM_KIMIA"] })).body.ringkasan; assert.ok(g.tidakDilacak.daftar.every((x) => x.kelompok === "LEM_KIMIA"));
  const it = (await w.A.post(`${SC}/scope-preview`, { mode: "ITEMS", materialIds: [u1.id] })).body.ringkasan; assert.equal(it.peringatanItems.length, 1, "Cycle Count boleh memilih bahan tak dilacak, dengan peringatan");
});

test("cakupan berubah saat sesi berjalan: bahan baru = di luar cakupan; Submit ditahan sampai diputuskan (tambahkan / abaikan beralasan); bahan bisa dikeluarkan beralasan; bahan nonaktif tetap di sesi", async () => {
  const w = await dunia(); const s = (await w.A.post(SC, { mode: "GROUP", groups: ["BENANG"] })).body; await mulai(w.A, s.id); await mundurkanMulai(s.id);
  const k = await kerja(w, s.id); assert.equal(k.baris.length, 40);
  const baru = await testPrisma.material.create({ data: { code: "BNG-BARU", name: "Benang Baru", unit: "SPOOL", category: "RAW_MATERIAL", itemGroup: "BENANG", active: true, referenceStockValue: 500 } });
  const lainKel = await testPrisma.material.create({ data: { code: "KAIN-BARU", name: "Kain Baru", unit: "METER", category: "RAW_MATERIAL", itemGroup: "KAIN", active: true, referenceStockValue: 500 } });
  let kk = await kerja(w, s.id); assert.deepEqual(kk.diLuarCakupan.map((x) => x.kode), ["BNG-BARU"], "hanya yang memenuhi kriteria sesi (kelompok Benang)"); void lainKel;
  // keluarkan satu bahan dengan alasan, hitung sisanya
  const keluar = kk.baris[0]; assert.equal((await w.A.post(`${SC}/${s.id}/lines/${keluar.id}/keluarkan`, {})).status, 400, "alasan wajib");
  assert.equal((await w.A.post(`${SC}/${s.id}/lines/${keluar.id}/keluarkan`, { alasan: "Barang sudah retur supplier" })).status, 200);
  kk = await kerja(w, s.id); assert.equal(kk.progres.total, 39); assert.equal(kk.progres.dikeluarkan, 1); assert.equal((await simpan(w.A, s.id, [{ lineId: keluar.id, revision: 99, countedQty: 1 }])).body.hasil[0].code, "BAHAN_DIKELUARKAN");
  const O = iso(menitLalu(30));
  await simpan(w.A, s.id, kk.baris.filter((b) => !b.excluded).map((b) => ({ lineId: b.id, revision: b.revision, countedQty: 100, observedAt: O })));
  const tahan = await w.A.post(`${SC}/${s.id}/submit`, {}); assert.equal(tahan.status, 409); assert.equal(tahan.body.code, "CAKUPAN_BELUM_DIPUTUSKAN");
  assert.equal((await w.A.post(`${SC}/${s.id}/cakupan`, { materialId: baru.id, tindakan: "ABAIKAN" })).status, 400, "mengabaikan wajib beralasan");
  assert.equal((await w.A.post(`${SC}/${s.id}/cakupan`, { materialId: baru.id, tindakan: "TAMBAHKAN" })).status, 201);
  kk = await kerja(w, s.id); const lb = kk.baris.find((b) => b.kode === "BNG-BARU"); assert.equal(lb.origin, "TAMBAHAN"); assert.equal(kk.diLuarCakupan.length, 0);
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 400, "bahan tambahan belum dihitung menahan Submit");
  await simpan(w.A, s.id, [{ lineId: lb.id, revision: 0, countedQty: 0, observedAt: O }]);
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 200);
  // bahan dinonaktifkan di tengah sesi tetap berada di sesi (cakupan tidak berubah diam-diam)
  const d = (await w.A.get(`${SC}/${s.id}`)).body; assert.equal(d.progres.dihitung, 40);
  await testPrisma.material.update({ where: { id: kk.baris[3].materialId }, data: { active: false } }); const k3 = await kerja(w, s.id); assert.equal(k3.baris.length, 41); assert.equal(k3.baris.find((b) => b.materialId === kk.baris[3].materialId).nonaktif, true);
});

test("sesi LAMA (model 1) tetap terbaca & berperilaku lama: snapshot saldo saat Mulai, PATCH baris, daftar membawa jumlahBahan, tidak ditafsirkan sebagai opname penuh baru; endpoint model 2 menolak dengan SESI_LAMA", async () => {
  const w = await dunia(); const m = w.aktif.slice(0, 106);
  const lama = await w.A.post(SC, { countType: "FULL_STOCK_OPNAME", countMethod: "FULL_WAREHOUSE", blindCount: true, lines: m.map((x) => ({ materialId: x.id })) }); assert.equal(lama.status, 201);
  const row = await testPrisma.stockCount.findUnique({ where: { id: lama.body.id } }); assert.equal(row.modelVersion, 1); assert.equal(row.scopeMode, null); assert.equal(await testPrisma.stockCountLine.count({ where: { stockCountId: row.id } }), 106);
  await mulai(w.A, row.id); const snap = await testPrisma.stockCountLine.findMany({ where: { stockCountId: row.id } }); assert.ok(snap.some((l) => l.systemQty === 100) && snap.every((l) => l.systemQty !== null), "model 1: snapshot saat Mulai tetap");
  assert.ok(snap.every((l) => l.observedAt === null && l.savedAt === null), "kolom waktu baru kosong pada sesi lama");
  const patch = await w.A.patch(`${SC}/${row.id}/lines/${snap[0].id}`, { countedQty: 100 }); assert.equal(patch.status, 200);
  const daftar = (await w.A.get(SC)).body.counts.find((c) => c.id === row.id); assert.equal(daftar.jumlahBahan, 106); assert.equal(daftar.modelVersion, 1); assert.equal(daftar.lines.length, 106);
  const d = (await w.A.get(`${SC}/${row.id}`)).body; assert.equal(d.sesi.modelVersion, 1); assert.ok(d.lines.every((l) => l.countedBy === undefined), "bentuk lama tidak berubah");
  assert.equal((await w.A.get(`${SC}/${row.id}/kerja`)).status, 409); assert.equal((await w.A.get(`${SC}/${row.id}/kerja`)).body.code, "SESI_LAMA");
  assert.equal((await w.A.post(`${SC}/${row.id}/lines/mulai`, { lineIds: [snap[1].id] })).body.code, "SESI_LAMA"); assert.equal((await w.A.post(`${SC}/${row.id}/pergerakan/tanda-massal`, { tercermin: false })).status, 409);
  const penuh = await buatPenuh(w); assert.equal(penuh.jumlahBahan, 360, "sesi lama 106 bahan tidak menghalangi / tidak dianggap opname penuh");
  const dl = (await w.A.get(SC)).body.counts; assert.equal(dl.find((c) => c.id === penuh.id).lines.length, 0, "daftar sesi model 2 ringkas"); assert.equal(dl.find((c) => c.id === penuh.id).jumlahBahan, 360);
});

test("izin baca-saja: boleh melihat daftar, kerja, riwayat; tidak boleh menyimpan, mengeluarkan bahan, mulai hitung, koreksi waktu, atau memutuskan cakupan; performa simpan 200 baris sekaligus", async () => {
  const w = await dunia(); const s = await buatPenuh(w); await mulai(w.A, s.id); const k = await kerja(w, s.id, w.L); assert.equal(k.bisaMenghitung, false); assert.equal(k.izin.tulis, false);
  assert.equal((await simpan(w.L, s.id, [{ lineId: k.baris[0].id, revision: 0, countedQty: 1 }])).status, 403);
  assert.equal((await w.L.post(`${SC}/${s.id}/lines/${k.baris[0].id}/keluarkan`, { alasan: "uji baca saja" })).status, 403);
  assert.equal((await w.L.post(`${SC}/${s.id}/lines/mulai`, { lineIds: [k.baris[0].id] })).status, 403); assert.equal((await w.L.post(`${SC}/${s.id}/lines/${k.baris[0].id}/waktu`, { observedAt: iso(new Date()), alasan: "uji" })).status, 403);
  assert.equal((await w.L.post(`${SC}/${s.id}/pergerakan/tanda-massal`, { tercermin: false })).status, 403);
  assert.equal((await w.L.get(`${SC}/${s.id}/lines/${k.baris[0].id}/riwayat`)).status, 200);
  assert.equal((await w.L.get(`${SC}/${s.id}`)).status, 200);
  const O = iso(new Date()); const t0 = Date.now(); const r = await simpan(w.A, s.id, k.baris.slice(0, 200).map((b) => ({ lineId: b.id, revision: 0, countedQty: 100, observedAt: O }))); const ms = Date.now() - t0;
  assert.equal(r.status, 200); assert.equal(r.body.progres.dihitung, 200); assert.ok(ms < 15000, `simpan 200 baris ${ms}ms`);
  const lengkap = (await simpan(w.B, s.id, k.baris.slice(200).map((b) => ({ lineId: b.id, revision: 0, countedQty: 100, observedAt: O })))).body; assert.equal(lengkap.progres.belum, 0); assert.equal(lengkap.progres.tanpaWaktu, 0);
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 200);
  assert.equal((await simpan(w.A, s.id, [{ lineId: k.baris[0].id, revision: 1, countedQty: 5, alasan: "uji" }])).status, 409, "sesudah diserahkan: ubah angka lewat Hitung ulang");
  assert.equal((await w.A.patch(`${SC}/${s.id}/lines/${k.baris[0].id}`, { countedQty: 5 })).status, 409, "PATCH angka lama ditutup untuk sesi baru");
});

test("DOKUMEN RESMI saat sesi berjalan: Penerimaan (putaway) dan Material Issue yang diposting SESUDAH bahan dihitung ditandai (bukan diam-diam hilang) dan, setelah diputuskan, tidak membuat selisih palsu / hitung ganda; sebelum dihitung ikut pembanding", async () => {
  const w = await dunia(); const [mGR, mMI, mSebelum] = w.aktif.slice(0, 3); // masing-masing saldo ledger 100
  const { s, L } = await sesiItems(w, [mGR.id, mMI.id, mSebelum.id]);
  // sebelum bahan dihitung (2 jam lalu): GR +10 pada mSebelum → fisik 110
  const grSebelum = await grResmi(w, mSebelum.id, 10); await testPrisma.stockMovement.updateMany({ where: { goodsReceiptId: grSebelum }, data: { createdAt: menitLalu(120) } });
  const O = iso(menitLalu(60));
  await simpan(w.A, s.id, [mGR, mMI, mSebelum].map((m) => ({ lineId: L[m.id].id, revision: 0, countedQty: m.id === mSebelum.id ? 110 : 100, observedAt: O })));
  // SESUDAH dihitung: GR resmi +20 pada mGR dan Material Issue resmi −6 pada mMI
  const gr = await grResmi(w, mGR.id, 20); const mi = await miResmi(w, mMI.id, 6);
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 200);
  const d = (await w.B.get(`${SC}/${s.id}`)).body; const T = Object.fromEntries(d.lines.map((l) => [l.materialId, l.tinjau]));
  const tg = T[mGR.id].transaksi.sejakPengamatan[0]; assert.equal(T[mGR.id].pembanding, 100); assert.equal(T[mGR.id].selisih, 0, "GR resmi sesudah hitung: tidak ada selisih palsu"); assert.ok(tg.dokumen, "transaksi relevan menyebut nomor dokumen"); assert.equal(tg.kelas, "BERTANGGAL_MUNDUR", "putaway mengisi tanggal terima hari ini ≤ hari pengamatan → pemeriksa wajib melihat satu per satu");
  const tm = T[mMI.id].transaksi.sejakPengamatan[0]; assert.equal(T[mMI.id].pembanding, 100); assert.equal(T[mMI.id].selisih, 0, "Material Issue resmi sesudah hitung: tidak ada selisih palsu"); assert.equal(tm.kelas, "SESUDAH_DISIMPAN");
  assert.equal(T[mSebelum.id].pembanding, 110, "GR sebelum waktu hitung ikut pembanding"); assert.equal(T[mSebelum.id].selisih, 0); assert.equal(T[mSebelum.id].transaksi.jumlah, 0);
  await periksaLalu(w, s.id);
  assert.equal((await w.O.post(`${SC}/${s.id}/complete`, {})).body.code, "PERGERAKAN_SESI_BELUM_DITANDAI");
  assert.equal((await tandai(w.A, s.id, tg.id, false)).status, 200); assert.equal((await w.A.post(`${SC}/${s.id}/pergerakan/tanda-massal`, { tercermin: false })).body.ditandai, 1);
  const adj0 = await testPrisma.stockMovement.count({ where: { stockCountId: s.id } });
  const sel = await w.O.post(`${SC}/${s.id}/complete`, {}); assert.equal(sel.status, 200, JSON.stringify(sel.body));
  assert.equal(await testPrisma.stockMovement.count({ where: { stockCountId: s.id } }), adj0, "tanpa selisih → tidak ada penyesuaian");
  assert.equal(await saldoBahan(mGR.id), 120, "100 + GR 20 — tidak hilang, tidak ganda"); assert.equal(await saldoBahan(mMI.id), 94, "100 − MI 6"); assert.equal(await saldoBahan(mSebelum.id), 110);
  assert.ok(gr && mi);
});
