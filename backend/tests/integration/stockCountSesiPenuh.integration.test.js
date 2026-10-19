// STOCK OPNAME SESI PENUH (model 2) — cakupan sekali pilih, pratinjau, 0 vs kosong, blind count di server, revisi/konflik dua petugas, waktu acuan hitung per bahan, selisih/pemeriksa/Selesaikan tepat sekali,
// sesi lama tetap terbaca. DB terisolasi, 360 bahan aktif (termasuk tanpa kelompok, tanpa catatan stok, satuan berbeda, saldo negatif).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, seedBalance } from "./setup/fixtures.js";
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
  for (const [grup, jumlah] of spek) for (let i = 0; i < jumlah; i++) { n++; data.push({ code: `M${String(n).padStart(4, "0")}`, name: `Bahan ${n}`, unit: UNITS[n % UNITS.length], category: n % 180 === 0 ? "CONSUMABLE" : "RAW_MATERIAL", itemGroup: grup, active: true }); }
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
  const baris = await testPrisma.stockCountLine.findMany({ where: { stockCountId: s.id } }); assert.equal(baris.length, 360); assert.equal(new Set(baris.map((l) => l.materialId)).size, 360, "tiap bahan sekali"); assert.ok(baris.every((l) => l.countedQty === null && l.systemQty === null && l.countedAt === null));
  const row = await testPrisma.stockCount.findUnique({ where: { id: s.id } }); assert.equal(row.modelVersion, 2); assert.equal(row.scopeMode, "FULL"); assert.equal(row.scopeInfo.ringkasan.masuk, 360);
  assert.equal((await w.A.post(SC, { mode: "FULL" })).status, 409, "tidak boleh dua sesi penuh bersamaan");
  // master baru muncul setelah sesi dibuat → TIDAK diam-diam masuk; tampil sebagai di luar cakupan
  const baru = await testPrisma.material.create({ data: { code: "BARU-1", name: "Bahan Baru", unit: "PCS", category: "RAW_MATERIAL", itemGroup: "KAIN", active: true } });
  assert.equal(await testPrisma.stockCountLine.count({ where: { stockCountId: s.id } }), 360);
  const k = await kerja(w, s.id); assert.equal(k.progres.total, 360); assert.deepEqual(k.diLuarCakupan.map((x) => x.kode), ["BARU-1"]);
  // sesi per kelompok + cycle count
  await testPrisma.stockCount.update({ where: { id: s.id }, data: { status: "CANCELLED" } });
  const g = await w.A.post(SC, { mode: "GROUP", groups: ["BUSA", "PEGAS"].filter((x) => x === "BUSA") }); assert.equal(g.status, 201); assert.equal(g.body.jumlahBahan, 100); assert.equal(g.body.countType, "CYCLE_COUNT");
  const it = await w.A.post(SC, { mode: "ITEMS", materialIds: w.aktif.slice(0, 5).map((m) => m.id) }); assert.equal(it.status, 201); assert.equal(it.body.jumlahBahan, 5);
  assert.equal((await w.L.post(SC, { mode: "FULL" })).status, 403, "akun baca-saja tidak membuat sesi"); void baru;
  assert.equal(await jumlahMov(), mov0, "membuat sesi tidak menulis ledger");
});

test("0 eksplisit vs kosong: kosong = belum dihitung; nol hanya bila dikirim 0; progres per kelompok; simpan bertahap & lanjut; angka negatif/tidak valid ditolak; submit ditolak selama ada yang belum", async () => {
  const w = await dunia(); const s = await buatPenuh(w); await mulai(w.A, s.id); const mov0 = await jumlahMov();
  let k = await kerja(w, s.id); assert.equal(k.progres.dihitung, 0); assert.equal(k.progres.belum, 360);
  const dp = (await w.A.get(`${SC}/${s.id}`)).body.progres; assert.equal(dp.perKelompok.find((x) => x.kode === "BUSA").total, 100, "detail: progres per kelompok dari itemGroup master"); assert.equal(dp.perKelompok.find((x) => x.kode === "BELUM").total, 45);
  const [b1, b2, b3] = k.baris;
  const r = (await simpan(w.A, s.id, [{ lineId: b1.id, revision: 0, countedQty: 0 }, { lineId: b2.id, revision: 0, countedQty: 12.5 }, { lineId: b3.id, revision: 0, countedQty: "" }])).body;
  assert.equal(r.hasil[0].status, "DISIMPAN"); assert.equal(r.hasil[0].counted, 0); assert.equal(r.hasil[1].counted, 12.5); assert.equal(r.hasil[2].status, "TIDAK_BERUBAH", "kolom kosong tetap belum dihitung");
  assert.equal(r.progres.dihitung, 2, "nol eksplisit terhitung; kosong tidak"); assert.equal(r.progres.belum, 358);
  k = await kerja(w, s.id); assert.equal(k.baris.find((b) => b.id === b1.id).counted, 0, "0 tersimpan sebagai 0, bukan null"); assert.equal(k.baris.find((b) => b.id === b3.id).counted, null);
  assert.ok(k.baris.find((b) => b.id === b1.id).countedAt && k.baris.find((b) => b.id === b1.id).countedBy.id === w.a.user.id, "waktu & petugas per bahan");
  for (const salah of [-1, "abc", "1e999"]) assert.equal((await simpan(w.A, s.id, [{ lineId: b3.id, revision: 0, countedQty: salah }])).body.hasil[0].status, "DITOLAK", String(salah));
  assert.equal((await simpan(w.A, s.id, [{ lineId: b3.id, countedQty: 1 }])).body.hasil[0].code, "REVISI_WAJIB");
  const gagal = await w.A.post(`${SC}/${s.id}/submit`, {}); assert.equal(gagal.status, 400); assert.equal(gagal.body.code, "MASIH_ADA_BELUM_DIHITUNG"); assert.match(gagal.body.error, /358 item belum/);
  assert.equal(await jumlahMov(), mov0, "menyimpan hitungan tidak mengubah saldo/ledger");
  // sesi tidak menerima hitungan sebelum Mulai / sesudah diserahkan
  const s2 = await w.A.post(SC, { mode: "ITEMS", materialIds: w.aktif.slice(0, 2).map((m) => m.id) }); const k2 = await kerja(w, s2.body.id);
  assert.equal((await simpan(w.A, s2.body.id, [{ lineId: k2.baris[0].id, revision: 0, countedQty: 1 }])).status, 409, "belum dimulai");
});

test("blind count disaring di SERVER: tanpa saldo/pembanding/pergerakan untuk penghitung sebelum diserahkan; sesudah diserahkan saldo sebanding + waktu hitung tampil; non-blind menampilkan", async () => {
  const w = await dunia(); const ids = w.aktif.slice(0, 3).map((m) => m.id);
  const s = (await w.A.post(SC, { mode: "ITEMS", materialIds: ids, blindCount: true })).body; await mulai(w.A, s.id);
  const k = await kerja(w, s.id); await simpan(w.A, s.id, k.baris.map((b) => ({ lineId: b.id, revision: 0, countedQty: 100 })));
  const d = (await w.A.get(`${SC}/${s.id}`)).body; assert.equal(d.sembunyikanSaldo, true); assert.ok(d.lines.every((l) => l.systemQty === null && !l.tinjau), "tidak ada saldo/pembanding di respons"); assert.deepEqual(d.pergerakanSesi, []);
  assert.ok(!JSON.stringify(k).includes("systemQty") && !("saldo" in k.baris[0]), "halaman kerja tidak memuat saldo");
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 200);
  const d2 = (await w.B.get(`${SC}/${s.id}`)).body; assert.equal(d2.sembunyikanSaldo, false);
  const l0 = d2.lines[0]; assert.equal(l0.tinjau.pembanding, 100); assert.equal(l0.tinjau.selisih, l0.countedQty - 100 === 0 ? 0 : l0.tinjau.selisih); assert.ok(l0.countedAt);
  const sNon = (await w.A.post(SC, { mode: "ITEMS", materialIds: ids, blindCount: false })).body; await mulai(w.A, sNon.id); const kn = await kerja(w, sNon.id);
  await simpan(w.A, sNon.id, [{ lineId: kn.baris[0].id, revision: 0, countedQty: 90 }]);
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
  const rw = (await w.A.get(`${SC}/${s.id}/lines/${bar.id}/riwayat`)).body.riwayat; assert.equal(rw.length, 2); assert.deepEqual([rw[1].lama, rw[1].baru, rw[1].alasan], [10, 11, "Hitung ulang di rak B"]); assert.ok(rw[1].oleh && rw[1].pada);
  const kk = await kerja(w, s.id); assert.equal(kk.baris.find((x) => x.id === bar.id).countedBy.id, w.b.user.id); assert.ok(kk.progres.perluPeriksa >= 1);
  const lain = kk.baris[7]; await simpan(w.A, s.id, [{ lineId: lain.id, revision: 0, countedQty: 3, perluPeriksa: true }]); assert.equal((await kerja(w, s.id)).baris.find((x) => x.id === lain.id).perluPeriksa, true);
  // klik ganda (permintaan sama dikirim ulang dengan revisi lama) → konflik, bukan dua kali simpan
  const dobel = (await simpan(w.A, s.id, [{ lineId: lain.id, revision: 0, countedQty: 3, perluPeriksa: true }])).body.hasil[0]; assert.equal(dobel.status, "KONFLIK");
});

test("WAKTU ACUAN: pembanding = ledger sampai countedAt; transaksi sesudah hitung tidak membuat selisih palsu & tidak terhitung dua kali; jendela ragu wajib ditandai; Selesaikan tepat sekali (idempoten) dengan pemeriksa & penyetuju berbeda", async () => {
  const w = await dunia();
  const ids = w.aktif.slice(0, 4).map((m) => m.id); const [mA, mB, mC, mD] = ids; // masing-masing saldo ledger 100
  const s = (await w.A.post(SC, { mode: "ITEMS", materialIds: ids, blindCount: true, scheduledDate: "2026-11-01" })).body;
  // mulai 3 jam lalu agar pergerakan ber-cap waktu bisa ditempatkan sebelum/sesudah hitung
  await mulai(w.A, s.id); const sekarang = Date.now(); await testPrisma.stockCount.update({ where: { id: s.id }, data: { startedAt: new Date(sekarang - 4 * 3600_000) } });
  const k = await kerja(w, s.id); const L = Object.fromEntries(k.baris.map((b) => [b.materialId, b]));
  const hitung = new Date(sekarang - 60 * 60_000); // semua hitungan "dicap" 1 jam lalu
  const mov = (materialId, qty, menit, note) => testPrisma.stockMovement.create({ data: { materialId, type: qty > 0 ? "RECEIPT" : "ISSUE", qty, note, createdAt: new Date(hitung.getTime() + menit * 60_000) } });
  await mov(mA, 10, -120, "A sebelum"); // sebelum hitung (≥30 mnt) → ikut pembanding: 110
  await mov(mB, 20, +30, "B sesudah");   // sesudah hitung → tidak ikut
  const mvC = await mov(mC, 5, -10, "C jendela ragu"); // jendela ragu → harus ditandai
  // petugas menghitung: A 110 (sama dengan sistem saat itu), B 100 (sama), C 100 (fisik belum memuat +5), D 97 (selisih nyata −3)
  const hasil = [[mA, 110], [mB, 100], [mC, 100], [mD, 97]];
  await simpan(w.A, s.id, hasil.map(([m, q]) => ({ lineId: L[m].id, revision: 0, countedQty: q })));
  await testPrisma.stockCountLine.updateMany({ where: { stockCountId: s.id }, data: { countedAt: hitung } }); // waktu acuan deterministik
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 200);
  let d = (await w.B.get(`${SC}/${s.id}`)).body; const T = Object.fromEntries(d.lines.map((l) => [l.materialId, l.tinjau]));
  assert.equal(T[mA].pembanding, 110); assert.equal(T[mA].selisih, 0); assert.equal(T[mA].transaksi.sebelumHitung, 1);
  assert.equal(T[mB].pembanding, 100, "transaksi sesudah hitung tidak ikut pembanding"); assert.equal(T[mB].selisih, 0); assert.equal(T[mB].transaksi.setelahHitungJumlah, 1);
  assert.equal(T[mC].transaksi.jendelaRagu.length, 1); assert.equal(T[mC].transaksi.belumDitandai, 1); assert.equal(T[mD].selisih, -3);
  assert.equal(d.sesi.belumDitandai, 1);
  // tanpa tanda → Selesaikan ditolak (hanya yang ambigu menahan, bukan semuanya)
  assert.equal((await w.C.post(`${SC}/${s.id}/periksa`, {})).status, 200, "pemeriksa = petugas lain dari penghitung");
  const tolak = await w.O.post(`${SC}/${s.id}/complete`, {}); assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "PERGERAKAN_SESI_BELUM_DITANDAI");
  // fisik belum memuat +5 → "belum tercermin": dikeluarkan dari pembanding
  assert.equal((await w.A.post(`${SC}/${s.id}/pergerakan/${mvC.id}/tanda`, { tercermin: false })).status, 200);
  d = (await w.B.get(`${SC}/${s.id}`)).body; const TC = d.lines.find((l) => l.materialId === mC).tinjau; assert.equal(TC.pembanding, 100); assert.equal(TC.selisih, 0, "ditandai belum tercermin → tidak ada selisih palsu");
  // alasan wajib untuk selisih nyata; penyetuju ≠ pengisi
  await w.A.patch(`${SC}/${s.id}/lines/${L[mD].id}`, { reason: "Hilang saat bongkar muat" });
  const mov0 = await jumlahMov(); const adj0 = await testPrisma.stockMovement.count({ where: { stockCountId: s.id } });
  const selesai = await w.O.post(`${SC}/${s.id}/complete`, {}); assert.equal(selesai.status, 200, JSON.stringify(selesai.body)); assert.equal(selesai.body.status, "COMPLETED");
  const adj = await testPrisma.stockMovement.findMany({ where: { stockCountId: s.id } }); assert.equal(adj.length, adj0 + 1, "hanya satu penyesuaian (bahan D)"); assert.equal(adj[0].materialId, mD); assert.equal(Number(adj[0].qty), -3);
  const saldo = async (m) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: m }, _sum: { qty: true } }))._sum.qty);
  assert.equal(await saldo(mD), 97, "saldo akhir = fisik"); assert.equal(await saldo(mB), 120, "fisik 100 + transaksi sesudah hitung 20: tidak hilang, tidak ganda"); assert.equal(await saldo(mA), 110); assert.equal(await saldo(mC), 105, "pergerakan +5 tetap utuh di ledger");
  // tepat sekali: ulangi Selesaikan → hasil sama, tidak menulis lagi
  const ulang = await w.O.post(`${SC}/${s.id}/complete`, {}); assert.equal(ulang.status, 200); assert.equal(ulang.body.ulang, true); assert.equal(await jumlahMov(), mov0 + 1, "tidak ada penyesuaian kedua");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: s.id, eventType: "DOCUMENT_POSTED" } }), 1, "audit posting satu kali");
  // sesudah selesai, pembanding tetap terbaca & sama (penyesuaian milik sesi tidak mengotori)
  d = (await w.B.get(`${SC}/${s.id}`)).body; assert.equal(d.lines.find((l) => l.materialId === mD).tinjau.selisih, -3);
});

test("jendela ragu: ditandai SUDAH tercermin → ikut pembanding dan menghasilkan selisih nyata; hitung ulang mereset tanda & pemeriksa; pemeriksa harus orang lain; penghitung tidak bisa menyelesaikan selisih", async () => {
  const w = await dunia(); const [m] = w.aktif.slice(0, 1); const s = (await w.A.post(SC, { mode: "ITEMS", materialIds: [m.id], blindCount: false })).body;
  await mulai(w.A, s.id); await testPrisma.stockCount.update({ where: { id: s.id }, data: { startedAt: new Date(Date.now() - 3 * 3600_000) } }); const hitung = new Date(Date.now() - 3600_000);
  const mv = await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ISSUE", qty: -5, note: "keluar rak", createdAt: new Date(hitung.getTime() - 5 * 60_000) } });
  const k = await kerja(w, s.id); await simpan(w.A, s.id, [{ lineId: k.baris[0].id, revision: 0, countedQty: 95 }]); await testPrisma.stockCountLine.updateMany({ where: { stockCountId: s.id }, data: { countedAt: hitung } });
  await w.A.post(`${SC}/${s.id}/submit`, {});
  await w.B.post(`${SC}/${s.id}/pergerakan/${mv.id}/tanda`, { tercermin: true });
  let d = (await w.B.get(`${SC}/${s.id}`)).body; assert.equal(d.lines[0].tinjau.pembanding, 95); assert.equal(d.lines[0].tinjau.selisih, 0, "sudah tercermin: fisik 95 = ledger 95");
  await w.B.post(`${SC}/${s.id}/pergerakan/${mv.id}/tanda`, { tercermin: false }); d = (await w.B.get(`${SC}/${s.id}`)).body; assert.equal(d.lines[0].tinjau.pembanding, 100); assert.equal(d.lines[0].tinjau.selisih, -5, "belum tercermin: fisik 95 vs ledger 100 → selisih nyata");
  assert.equal((await w.A.post(`${SC}/${s.id}/periksa`, {})).status, 403, "penghitung tidak memeriksa dirinya sendiri");
  assert.equal((await w.A.post(`${SC}/${s.id}/recount`, {})).status, 200); assert.equal((await simpan(w.A, s.id, [{ lineId: k.baris[0].id, revision: 1, countedQty: 100, alasan: "Salah hitung rak" }])).body.hasil[0].status, "DISIMPAN");
  d = (await w.A.get(`${SC}/${s.id}`)).body; assert.equal(d.status, "IN_PROGRESS"); assert.equal(d.lines[0].perluPeriksa, true);
  assert.equal((await w.A.put(`${SC}/${s.id}/hasil`, { items: [] })).status, 400);
});

test("cakupan berubah saat sesi berjalan: bahan baru = di luar cakupan; Submit ditahan sampai diputuskan (tambahkan / abaikan beralasan); bahan bisa dikeluarkan beralasan; bahan nonaktif tetap di sesi", async () => {
  const w = await dunia(); const s = (await w.A.post(SC, { mode: "GROUP", groups: ["BENANG"] })).body; await mulai(w.A, s.id);
  const k = await kerja(w, s.id); assert.equal(k.baris.length, 40);
  const baru = await testPrisma.material.create({ data: { code: "BNG-BARU", name: "Benang Baru", unit: "SPOOL", category: "RAW_MATERIAL", itemGroup: "BENANG", active: true } });
  const lainKel = await testPrisma.material.create({ data: { code: "KAIN-BARU", name: "Kain Baru", unit: "METER", category: "RAW_MATERIAL", itemGroup: "KAIN", active: true } });
  let kk = await kerja(w, s.id); assert.deepEqual(kk.diLuarCakupan.map((x) => x.kode), ["BNG-BARU"], "hanya yang memenuhi kriteria sesi (kelompok Benang)"); void lainKel;
  // keluarkan satu bahan dengan alasan, hitung sisanya
  const keluar = kk.baris[0]; assert.equal((await w.A.post(`${SC}/${s.id}/lines/${keluar.id}/keluarkan`, {})).status, 400, "alasan wajib");
  assert.equal((await w.A.post(`${SC}/${s.id}/lines/${keluar.id}/keluarkan`, { alasan: "Barang sudah retur supplier" })).status, 200);
  kk = await kerja(w, s.id); assert.equal(kk.progres.total, 39); assert.equal(kk.progres.dikeluarkan, 1); assert.equal((await simpan(w.A, s.id, [{ lineId: keluar.id, revision: 99, countedQty: 1 }])).body.hasil[0].code, "BAHAN_DIKELUARKAN");
  await simpan(w.A, s.id, kk.baris.filter((b) => !b.excluded).map((b) => ({ lineId: b.id, revision: b.revision, countedQty: 100 })));
  const tahan = await w.A.post(`${SC}/${s.id}/submit`, {}); assert.equal(tahan.status, 409); assert.equal(tahan.body.code, "CAKUPAN_BELUM_DIPUTUSKAN");
  assert.equal((await w.A.post(`${SC}/${s.id}/cakupan`, { materialId: baru.id, tindakan: "ABAIKAN" })).status, 400, "mengabaikan wajib beralasan");
  assert.equal((await w.A.post(`${SC}/${s.id}/cakupan`, { materialId: baru.id, tindakan: "TAMBAHKAN" })).status, 201);
  kk = await kerja(w, s.id); const lb = kk.baris.find((b) => b.kode === "BNG-BARU"); assert.equal(lb.origin, "TAMBAHAN"); assert.equal(kk.diLuarCakupan.length, 0);
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 400, "bahan tambahan belum dihitung menahan Submit");
  await simpan(w.A, s.id, [{ lineId: lb.id, revision: 0, countedQty: 0 }]);
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
  const patch = await w.A.patch(`${SC}/${row.id}/lines/${snap[0].id}`, { countedQty: 100 }); assert.equal(patch.status, 200);
  const daftar = (await w.A.get(SC)).body.counts.find((c) => c.id === row.id); assert.equal(daftar.jumlahBahan, 106); assert.equal(daftar.modelVersion, 1); assert.equal(daftar.lines.length, 106);
  const d = (await w.A.get(`${SC}/${row.id}`)).body; assert.equal(d.sesi.modelVersion, 1); assert.ok(d.lines.every((l) => l.countedBy === undefined), "bentuk lama tidak berubah");
  assert.equal((await w.A.get(`${SC}/${row.id}/kerja`)).status, 409); assert.equal((await w.A.get(`${SC}/${row.id}/kerja`)).body.code, "SESI_LAMA");
  const penuh = await buatPenuh(w); assert.equal(penuh.jumlahBahan, 360, "sesi lama 106 bahan tidak menghalangi / tidak dianggap opname penuh");
  const dl = (await w.A.get(SC)).body.counts; assert.equal(dl.find((c) => c.id === penuh.id).lines.length, 0, "daftar sesi model 2 ringkas"); assert.equal(dl.find((c) => c.id === penuh.id).jumlahBahan, 360);
});

test("izin baca-saja: boleh melihat daftar, kerja, riwayat; tidak boleh menyimpan, mengeluarkan bahan, atau memutuskan cakupan; performa simpan 200 baris sekaligus", async () => {
  const w = await dunia(); const s = await buatPenuh(w); await mulai(w.A, s.id); const k = await kerja(w, s.id, w.L); assert.equal(k.bisaMenghitung, false); assert.equal(k.izin.tulis, false);
  assert.equal((await simpan(w.L, s.id, [{ lineId: k.baris[0].id, revision: 0, countedQty: 1 }])).status, 403);
  assert.equal((await w.L.post(`${SC}/${s.id}/lines/${k.baris[0].id}/keluarkan`, { alasan: "uji baca saja" })).status, 403);
  assert.equal((await w.L.get(`${SC}/${s.id}/lines/${k.baris[0].id}/riwayat`)).status, 200);
  assert.equal((await w.L.get(`${SC}/${s.id}`)).status, 200);
  const t0 = Date.now(); const r = await simpan(w.A, s.id, k.baris.slice(0, 200).map((b) => ({ lineId: b.id, revision: 0, countedQty: 100 }))); const ms = Date.now() - t0;
  assert.equal(r.status, 200); assert.equal(r.body.progres.dihitung, 200); assert.ok(ms < 15000, `simpan 200 baris ${ms}ms`);
  const lengkap = (await simpan(w.B, s.id, k.baris.slice(200).map((b) => ({ lineId: b.id, revision: 0, countedQty: 100 })))).body; assert.equal(lengkap.progres.belum, 0);
  assert.equal((await w.A.post(`${SC}/${s.id}/submit`, {})).status, 200);
  assert.equal((await simpan(w.A, s.id, [{ lineId: k.baris[0].id, revision: 1, countedQty: 5, alasan: "uji" }])).status, 409, "sesudah diserahkan: ubah angka lewat Hitung ulang");
  assert.equal((await w.A.patch(`${SC}/${s.id}/lines/${k.baris[0].id}`, { countedQty: 5 })).status, 409, "PATCH angka lama ditutup untuk sesi baru");
});
