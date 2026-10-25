// KONFIRMASI MANIFEST posting historis (insiden 25 Okt 2026): hanya akun Owner memulai; eksekusi hanya untuk manifest yang PERSIS sama dengan yang dikonfirmasi (hash, ID unit, isi transaksi, saldo ditinjau, rujukan); selisih → ditolak sebelum batch/movement, dengan jejak pelaku.
// Dunia uji sama dengan postingBatchLatar: rencana penuh = 3 transaksi pada 3 order (uA-MX 6, uB-MY 1, uC-MX 4).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { rencanakanImpor, terapkanImpor, evaluasiUlang, resetKeadaanEfektif, tungguPenyegaran } from "../../src/services/catatanPemakaianHistoris.js";
import { rencanakanPosting, postingSatuUnit, jalankanPosting } from "../../src/services/postingPemakaianHistoris.js";
import { ringkasRencana, saldoBahanRencana, ENTITAS_KONFIRMASI } from "../../src/services/postingKonfirmasiManifest.js";
import { koreksiCatatan } from "../../src/services/koreksiPemakaian.js";
import { ajukanBatch, jalankanBatch, mulaiBatch, tungguBatch, statusBatch, hentikanBatch, lanjutkanBatch, pulihkanBatch, ENTITAS_BATCH } from "../../src/services/postingBatchLatar.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await tungguPenyegaran(); await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),Total Biaya Bahan (Rp),"Total Penjualan\n(Rp)",Insentif PIC,Insentif Corner,Keterangan / QC';
const baris = (no, order, tgl, kat, nama, qty, sat) => `${no},${order},${tgl},SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,${kat},${nama},,BAHAN,"${qty}",${sat},,,,,,QC OK`;
const WIB = (iso) => new Date(`${iso}T00:00:00+07:00`);
const konfirmasiDari = (p, rujukan = "OWNER-2026-10-25") => { const r = ringkasRencana(p); return { hash: r.hash, unitIds: r.unitIds, daftarOrder: r.daftarOrder, jumlahOrder: r.jumlahOrder, jumlahTrx: r.jumlahTrx, rujukan, isiTransaksi: r.isiTransaksi, saldoManifest: p.__saldo ?? [] }; };
const rencanakan = async (db, o) => { const p = await rencanakanPosting(db, o); p.__saldo = await saldoBahanRencana(db, p); return p; }; // seperti UI: konfirmasi memuat saldo bahan yang ditinjau saat rencana dibuat
const PERSETUJUAN = (p) => (typeof p === "string" ? { hashDisetujui: p, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner Uji", konfirmasi: {} } : { hashDisetujui: p.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner Uji", konfirmasi: konfirmasiDari(p) });
// persetujuan terikat untuk panggilan HTTP, dari badan GET /rencana (transaksi memuat unitId & orderNumber)
// konfirmasi untuk panggilan HTTP, dibentuk dari pratinjau persis seperti UI (isi transaksi, saldo bahan, unit, hash)
const praHttp = async (w, ids) => (await w.co.get(`/api/production/posting-historis/pratinjau${ids ? `?unitIds=${ids.join(",")}` : ""}`)).body;
const konfirmasiPra = (pr, rujukan = "OWNER-2026-10-25") => ({ hash: pr.hash, unitIds: pr.unitIds, daftarOrder: pr.order.map((o) => o.orderNumber), jumlahOrder: pr.jumlahOrder, jumlahTrx: pr.jumlahTrx, rujukan, isiTransaksi: pr.order.flatMap((o) => o.trx.map((t) => ({ unitId: o.unitId, orderNumber: o.orderNumber, kodeBahan: t.kodeBahan, qty: t.qty, satuan: t.satuan, tanggal: t.tanggal }))), saldoManifest: pr.bahan.map((b) => ({ kode: b.kode, saldo: b.saldoSekarang })) });
let seq = 0;

async function dunia() {
  resetKeadaanEfektif();
  const admin = await createTestUser({ roles: ["ADMIN"] }); const owner = await createTestUser({ roles: ["OWNER"] });
  const mx = await createTestMaterial({ code: "L-MX", name: "KAIN REBUTAN LATAR", unit: "METER" }); const my = await createTestMaterial({ code: "L-MY", name: "BUSA SAH LATAR", unit: "SHEET" });
  await seedBalance(mx.id, 10, { createdAt: WIB("2026-09-01"), unitCost: 20000 }); await seedBalance(my.id, 10, { createdAt: WIB("2026-09-01"), unitCost: 50000 });
  const mk = async (no) => { const { order, unit } = await createTestUnit({ status: "DELIVERED" }); await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: no, status: "DELIVERED" } }); return unit; };
  const uA = await mk("RES-03092026-901"); const uB = await mk("RES-04092026-902"); const uC = await mk("RES-05092026-903");
  const csv = ["J", "D", HDR,
    baris(1, "RES-03092026-901", "3 Sep 26", "Bahan Lapisan", "KAIN REBUTAN LATAR", "6,0", "METER"),
    baris(2, "RES-04092026-902", "4 Sep 26", "Bahan Fondasi", "BUSA SAH LATAR", "1,0", "LEMBAR"),
    baris(3, "RES-04092026-902", "4 Sep 26", "Bahan Lapisan", "KAIN REBUTAN LATAR", "5,0", "METER"),
    baris(4, "RES-05092026-903", "5 Sep 26", "Bahan Lapisan", "KAIN REBUTAN LATAR", "4,0", "METER")].join("\n");
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: csv, namaBerkas: `latar${++seq}.csv` }), {});
  await evaluasiUlang(testPrisma, {});
  return { admin, owner, A: { id: admin.user.id, name: admin.user.name, roles: ["ADMIN"] }, B: { id: owner.user.id, name: owner.user.name, roles: ["OWNER"] }, mx, my, uA, uB, uC, ca: makeClient(server.baseUrl, admin.token), co: makeClient(server.baseUrl, owner.token) };
}

const hitung = async () => ({ mv: await testPrisma.stockMovement.count(), issue: await testPrisma.stockMovement.count({ where: { type: "ISSUE", note: { contains: "Impor pemakaian historis" } } }), batch: await testPrisma.activityEvent.count({ where: { entityType: ENTITAS_BATCH, eventType: "BATCH_DIAJUKAN" } }), tolak: await testPrisma.activityEvent.count({ where: { entityType: ENTITAS_KONFIRMASI, eventType: "KONFIRMASI_DITOLAK" } }) });
const tolak = async (fn, kode) => { try { await fn(); } catch (e) { assert.equal(e.code, kode, `kode galat: ${e.code} ${e.message}`); return e; } assert.fail(`seharusnya ditolak dengan ${kode}`); };
const dari = (ids) => rencanakan(testPrisma, { unitIds: ids });
const issues = (unit) => testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "ISSUE" } });
const tolakTerakhir = () => testPrisma.activityEvent.findFirst({ where: { entityType: ENTITAS_KONFIRMASI }, orderBy: { createdAt: "desc" } });
const kirim = (w, p, ubah = {}, ekstra = {}) => ajukanBatch(testPrisma, { persetujuan: { hashDisetujui: p.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner", konfirmasi: { ...konfirmasiDari(p), ...ubah } }, aktor: w.B, unitIds: [...new Set(p.transaksi.map((t) => t.unitId))], ...ekstra });
async function dunia2() { const w = await dunia(); const fin = await createTestUser({ roles: ["FINANCE"] }); return { ...w, fin, F: { id: fin.user.id, name: fin.user.name, roles: ["FINANCE"] }, cf: makeClient(server.baseUrl, fin.token) }; }

test("K1. insiden: pilihan berbeda dari yang dikonfirmasi (jumlah order sama) ditolak SEBELUM batch/movement; jejak pelaku & peran", async () => {
  const w = await dunia2(); const dimaksud = await dari([w.uA.id, w.uB.id]); const dipilih = await dari([w.uA.id, w.uC.id]);
  assert.equal(dimaksud.orderUnik, dipilih.orderUnik); assert.notEqual(dimaksud.hash, dipilih.hash); const t0 = await hitung();
  const e = await tolak(() => ajukanBatch(testPrisma, { persetujuan: { hashDisetujui: dipilih.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner", konfirmasi: konfirmasiDari(dimaksud) }, aktor: w.B, unitIds: [w.uA.id, w.uC.id] }), "KONFIRMASI_MANIFEST_TIDAK_COCOK");
  const semua = e.penghalang.join(" | "); assert.match(semua, /hash manifest/); assert.match(semua, /order dikonfirmasi yang tidak ada di rencana: RES-04092026-902/); assert.match(semua, /order di rencana yang tidak dikonfirmasi: RES-05092026-903/); assert.match(semua, /isi transaksi dikonfirmasi yang tidak ada di rencana/);
  await tolak(() => jalankanPosting(testPrisma, { persetujuan: { hashDisetujui: dipilih.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner", konfirmasi: konfirmasiDari(dimaksud) }, aktor: w.B, unitIds: [w.uA.id, w.uC.id] }), "KONFIRMASI_MANIFEST_TIDAK_COCOK");
  const t1 = await hitung(); assert.equal(t1.mv, t0.mv); assert.equal(t1.issue, 0); assert.equal(t1.batch, 0); assert.equal(t1.tolak, 2);
  const aud = await tolakTerakhir(); assert.equal(aud.actorId, w.B.id); assert.equal(aud.metadata.jenis, "TIDAK_COCOK"); assert.deepEqual(aud.metadata.aktorRoles, ["OWNER"]); assert.equal(aud.metadata.mode, "OWNER_MENINJAU_SENDIRI"); assert.equal(aud.metadata.hashKonfirmasi, dimaksud.hash); assert.equal(aud.metadata.hashRencana, dipilih.hash);
  assert.equal((await kirim(w, dipilih)).baru, true, "konfirmasi yang benar untuk pilihan yang sama berjalan");
});

test("K2. setiap bagian diperiksa: hash, ID unit, order, jumlah, ISI transaksi (bahan, qty, satuan, tanggal, unit), saldo, digest, rujukan, bentuk", async () => {
  const w = await dunia2(); const p = await dari([w.uA.id, w.uC.id]); const t0 = await hitung(); const k0 = konfirmasiDari(p); const baris = (i, o) => k0.isiTransaksi.map((l, j) => (j === i ? { ...l, ...o } : l));
  const kasus = [
    [{ hash: "a".repeat(64) }, /hash manifest/], [{ hash: "pendek" }, /64 karakter hex/], [{ jumlahTrx: 3 }, /jumlah transaksi: dikonfirmasi 3 ≠ rencana 2/], [{ jumlahOrder: 3 }, /jumlah order: dikonfirmasi 3 ≠ rencana 2/],
    [{ unitIds: [w.uA.id] }, /1 unit rencana tidak dikonfirmasi/], [{ unitIds: [w.uA.id, w.uC.id, w.uB.id] }, /1 di luar rencana/], [{ daftarOrder: ["RES-03092026-901"] }, /order di rencana yang tidak dikonfirmasi: RES-05092026-903/],
    [{ daftarOrder: ["RES-03092026-901", "RES-05092026-903", "RES-99999999-999"] }, /order dikonfirmasi yang tidak ada di rencana: RES-99999999-999/],
    [{ isiTransaksi: baris(0, { qty: k0.isiTransaksi[0].qty + 1 }) }, /isi transaksi dikonfirmasi yang tidak ada di rencana \(1\)/], [{ isiTransaksi: baris(0, { tanggal: "2026-09-30" }) }, /isi transaksi/], [{ isiTransaksi: baris(0, { satuan: "KG" }) }, /isi transaksi/],
    [{ isiTransaksi: baris(0, { kodeBahan: "L-MY" }) }, /isi transaksi/], [{ isiTransaksi: baris(0, { unitId: w.uB.id }) }, /isi transaksi/], [{ isiTransaksi: k0.isiTransaksi.slice(1) }, /isi transaksi rencana yang tidak dikonfirmasi \(1\)/], [{ isiTransaksi: [...k0.isiTransaksi, { ...k0.isiTransaksi[0], qty: 99 }] }, /isi transaksi dikonfirmasi yang tidak ada di rencana \(1\)/],
    [{ digestIsi: "b".repeat(64) }, /digest isi/], [{ saldoManifest: k0.saldoManifest.map((s) => ({ ...s, saldo: s.saldo + 1 })) }, /saldo L-MX berubah sejak ditinjau/], [{ saldoManifest: [] }, /saldo bahan yang ditinjau tidak ada/], [{ saldoManifest: [{ kode: "L-LAIN", saldo: 1 }] }, /saldo L-MX tidak ikut ditinjau/],
    [{ rujukan: "OWNER-LAIN-2026" }, /rujukan berbeda/], [{ rujukan: "pendek" }, /minimal 8 karakter/], [{ unitIds: [] }, /daftar unit konfirmasi kosong/], [{ jumlahTrx: "2" }, /jumlah transaksi konfirmasi tidak valid/], [{ isiTransaksi: [{ unitId: "x" }] }, /isi transaksi konfirmasi tidak lengkap/],
  ];
  for (const [ubah, pola] of kasus) { const e = await tolak(() => kirim(w, p, ubah), "KONFIRMASI_MANIFEST_TIDAK_COCOK"); assert.match(e.penghalang.join(" | "), pola, JSON.stringify(ubah).slice(0, 120)); }
  assert.equal((await tolak(() => ajukanBatch(testPrisma, { persetujuan: { hashDisetujui: p.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner" }, aktor: w.B, unitIds: [w.uA.id, w.uC.id] }), "KONFIRMASI_MANIFEST_WAJIB")).statusCode, 403);
  const t1 = await hitung(); assert.equal(t1.mv, t0.mv); assert.equal(t1.batch, 0); assert.equal(t1.issue, 0); assert.equal(t1.tolak, kasus.length + 1);
  const ok = await kirim(w, p, { hash: ` ${p.hash.toUpperCase()} `, digestIsi: ringkasRencana(p).digestIsi }); assert.equal(ok.baru, true);
});

test("K3. saldo berubah sesudah ditinjau (rencana & hash sama) ditolak; syarat saldo Owner dipatuhi; keduanya tanpa tulisan", async () => {
  const w = await dunia2(); const mz = await createTestMaterial({ code: "L-MZ", name: "BAHAN SYARAT", unit: "PCS" }); await seedBalance(mz.id, 5, { createdAt: WIB("2026-09-01"), unitCost: 1000 });
  const p = await dari([w.uA.id]); const t0 = await hitung();
  await testPrisma.stockMovement.create({ data: { materialId: w.mx.id, type: "RECEIPT", qty: 100, reason: "uji", note: "GR masuk setelah manifest ditinjau", createdAt: WIB("2026-09-02"), unitCost: 20000 } }); // saldo MX 10 → 110; rencana uA tidak berubah
  assert.equal((await dari([w.uA.id])).hash, p.hash, "hash rencana sama — hanya saldo yang bergeser");
  const e = await tolak(() => kirim(w, p), "KONFIRMASI_MANIFEST_TIDAK_COCOK"); assert.match(e.penghalang.join("|"), /saldo L-MX berubah sejak ditinjau: 10 → 110/);
  const p2 = await dari([w.uA.id]); await testPrisma.stockMovement.create({ data: { materialId: mz.id, type: "ADJUSTMENT", qty: 1, reason: "uji", note: "penyesuaian lain", createdAt: WIB("2026-09-02") } });
  const e2 = await tolak(() => kirim(w, p2, { saldoSyarat: [{ kode: "L-MZ", saldo: 5 }] }), "KONFIRMASI_MANIFEST_TIDAK_COCOK"); assert.match(e2.penghalang.join("|"), /syarat saldo L-MZ: 5 ≠ sekarang 6/);
  await tolak(() => kirim(w, p2, { saldoSyarat: [{ kode: "TIDAK-ADA", saldo: 1 }] }), "KONFIRMASI_MANIFEST_TIDAK_COCOK");
  const t1 = await hitung(); assert.equal(t1.batch, 0); assert.equal(t1.issue, 0); assert.equal(t1.mv, t0.mv + 2, "hanya dua pergerakan uji");
  const p3 = await dari([w.uA.id]); const ok = await kirim(w, p3, { saldoSyarat: [{ kode: "L-MZ", saldo: 6 }, { kode: "L-MX", saldo: 110 }] }); assert.equal(ok.baru, true);
  const dia = await testPrisma.activityEvent.findFirst({ where: { entityType: ENTITAS_BATCH, entityId: ok.batchId, eventType: "BATCH_DIAJUKAN" } }); assert.deepEqual(dia.metadata.konfirmasiManifest.saldoSyarat, [{ kode: "L-MZ", saldo: 6 }, { kode: "L-MX", saldo: 110 }]);
});

test("K4. izin: HANYA Owner memulai (service + HTTP); Finance/Admin ditolak sebelum menghitung apa pun dengan jejak peran; Finance boleh memantau, menghentikan, melanjutkan", async () => {
  const w = await dunia2(); const p = await dari([w.uA.id, w.uC.id]); const t0 = await hitung();
  const eF = await tolak(() => ajukanBatch(testPrisma, { persetujuan: { hashDisetujui: p.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Finance", konfirmasi: konfirmasiDari(p) }, aktor: w.F, unitIds: [w.uA.id, w.uC.id] }), "HANYA_OWNER_MEMULAI"); assert.equal(eF.statusCode, 403);
  await tolak(() => jalankanPosting(testPrisma, { persetujuan: { hashDisetujui: p.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Finance", konfirmasi: konfirmasiDari(p) }, aktor: w.F, unitIds: [w.uA.id, w.uC.id] }), "HANYA_OWNER_MEMULAI");
  await tolak(() => ajukanBatch(testPrisma, { persetujuan: { hashDisetujui: p.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Admin", konfirmasi: konfirmasiDari(p) }, aktor: w.A, unitIds: [w.uA.id, w.uC.id] }), "HANYA_OWNER_MEMULAI");
  const aud = await tolakTerakhir(); assert.equal(aud.metadata.jenis, "BUKAN_OWNER"); assert.deepEqual(aud.metadata.aktorRoles, ["ADMIN"]); const dariFinance = await testPrisma.activityEvent.findFirst({ where: { entityType: ENTITAS_KONFIRMASI, actorId: w.F.id } }); assert.deepEqual(dariFinance.metadata.aktorRoles, ["FINANCE"]);
  // HTTP: Finance memantau (200) tetapi memulai ditolak; Admin ditolak izin
  const pr = (await w.co.get(`/api/production/posting-historis/pratinjau?unitIds=${w.uA.id},${w.uC.id}`)).body; const kon = konfirmasiPra(pr); const badan = { hashDisetujui: pr.hash, rujukan: "OWNER-2026-10-25", unitIds: pr.unitIds, konfirmasiManifest: kon };
  assert.equal((await w.cf.get("/api/production/posting-historis/pratinjau")).status, 200, "Finance boleh melihat manifest");
  const hf = await w.cf.post("/api/production/posting-historis/batch", badan); assert.equal(hf.status, 403); assert.equal(hf.body.code, "HANYA_OWNER_MEMULAI");
  const jf = await w.cf.post("/api/production/posting-historis/jalankan", badan); assert.equal(jf.status, 403); assert.equal(jf.body.code, "HANYA_OWNER_MEMULAI");
  assert.equal((await w.ca.post("/api/production/posting-historis/batch", badan)).status, 403, "Admin: izin persetujuan tidak ada");
  const t1 = await hitung(); assert.equal(t1.batch, 0); assert.equal(t1.mv, t0.mv); assert.equal(t1.issue, 0);
  // Owner memulai; Finance dapat menghentikan lalu melanjutkan; Admin tidak
  const ok = await w.co.post("/api/production/posting-historis/batch", badan); assert.equal(ok.status, 202, JSON.stringify(ok.body)); await tungguBatch(ok.body.batchId);
  assert.equal((await w.cf.get(`/api/production/posting-historis/batch/${ok.body.batchId}`)).status, 200, "Finance memantau batch");
  assert.equal((await w.cf.post(`/api/production/posting-historis/batch/${ok.body.batchId}/hentikan`, {})).status, 200, "Finance boleh menghentikan");
  assert.equal((await w.ca.post(`/api/production/posting-historis/batch/${ok.body.batchId}/hentikan`, {})).status, 403);
});

test("K5. alur Owner benar: rekaman konfirmasi lengkap tersimpan (isi transaksi, saldo ditinjau, peran, mode); hanya yang dikonfirmasi terposting", async () => {
  const w = await dunia2(); const p = await dari([w.uA.id, w.uC.id]); const b = await kirim(w, p);
  const dia = await testPrisma.activityEvent.findFirst({ where: { entityType: ENTITAS_BATCH, entityId: b.batchId, eventType: "BATCH_DIAJUKAN" } }); const rek = dia.metadata.konfirmasiManifest; const r = ringkasRencana(p);
  assert.equal(rek.mode, "OWNER_MENINJAU_SENDIRI"); assert.equal(rek.hash, p.hash); assert.deepEqual(rek.unitIds, r.unitIds); assert.deepEqual(rek.daftarOrder, ["RES-03092026-901", "RES-05092026-903"]); assert.equal(rek.jumlahOrder, 2); assert.equal(rek.jumlahTrx, 2); assert.equal(rek.digestIsi, r.digestIsi);
  assert.deepEqual(rek.isiTransaksi, r.isiTransaksi); assert.deepEqual(rek.saldoManifest, p.__saldo); assert.deepEqual(rek.aktorRoles, ["OWNER"]); assert.equal(rek.rujukan, "OWNER-2026-10-25"); assert.equal(dia.metadata.rujukan, "OWNER-2026-10-25"); assert.ok(rek.dikonfirmasiPada);
  assert.equal((await jalankanBatch(testPrisma, b.batchId)).status, "SELESAI");
  assert.equal(await issues(w.uA), 1); assert.equal(await issues(w.uC), 1); assert.equal(await issues(w.uB), 0, "order yang tidak dikonfirmasi tidak tersentuh");
});

test("K6. klik ganda & refresh: serentak = satu batch; ulang dengan konfirmasi SAMA = nol tulisan; ulang dengan DAMPAK BERBEDA ditolak dan dicatat", async () => {
  const w = await dunia2(); const p = await dari([w.uA.id, w.uC.id]);
  const hasil = await Promise.allSettled([1, 2, 3].map(() => kirim(w, p))); assert.ok(hasil.every((x) => x.status === "fulfilled"), JSON.stringify(hasil.filter((x) => x.status === "rejected").map((x) => x.reason?.message))); assert.equal(hasil.filter((x) => x.value.baru).length, 1);
  assert.equal((await hitung()).batch, 1); const t0 = await hitung();
  const ulang = await kirim(w, p); assert.equal(ulang.baru, false); assert.equal((await hitung()).mv, t0.mv);
  const k0 = konfirmasiDari(p);
  for (const [ubah, pola] of [[{ isiTransaksi: k0.isiTransaksi.map((l, j) => (j === 0 ? { ...l, qty: l.qty + 1 } : l)) }, /isi transaksi berbeda/], [{ saldoManifest: k0.saldoManifest.map((s) => ({ ...s, saldo: s.saldo + 5 })) }, /saldo L-MX yang ditinjau berbeda/], [{ rujukan: "RUJUKAN-LAIN-99" }, /rujukan berbeda/], [{ unitIds: [w.uA.id] }, /ID unit berbeda/], [{ hash: "e".repeat(64) }, /hash konfirmasi berbeda/]]) {
    const e = await tolak(() => kirim(w, p, ubah), "KONFIRMASI_MANIFEST_TIDAK_COCOK"); assert.match(e.penghalang.join("|"), pola, JSON.stringify(ubah).slice(0, 80));
  }
  const t1 = await hitung(); assert.equal(t1.batch, 1); assert.equal(t1.mv, t0.mv); assert.equal(t1.tolak, t0.tolak + 5); assert.equal((await tolakTerakhir()).metadata.jenis, "ULANG_DAMPAK_BERBEDA");
  // batch lama tanpa rekaman konfirmasi: percobaan ulang mengembalikan batch itu (tidak ada pembanding), nol tulisan
  await testPrisma.$executeRawUnsafe(`update activity_events set metadata = metadata - 'konfirmasiManifest' where entity_type = 'posting_historis_batch' and event_type = 'BATCH_DIAJUKAN'`);
  const lama = await kirim(w, p, { rujukan: "OWNER-2026-10-25" }); assert.equal(lama.baru, false); assert.equal((await hitung()).mv, t0.mv);
  assert.equal((await jalankanBatch(testPrisma, ulang.batchId)).status, "SELESAI");
});

test("K7. tab lama: tanpa konfirmasi → 403 WAJIB (dicatat); manifest basi (rencana bergeser sesudah ditinjau) → RENCANA_BERUBAH; nol tulisan", async () => {
  const w = await dunia2(); const lama = await dari([w.uA.id, w.uB.id, w.uC.id]); const t0 = await hitung();
  const a = await w.co.post("/api/production/posting-historis/batch", { hashDisetujui: lama.hash, rujukan: "OWNER-2026-10-25" }); assert.equal(a.status, 403); assert.equal(a.body.code, "KONFIRMASI_MANIFEST_WAJIB"); assert.equal((await tolakTerakhir()).metadata.jenis, "TANPA_KONFIRMASI");
  const b = await w.co.post("/api/production/posting-historis/jalankan", { hashDisetujui: lama.hash, rujukan: "OWNER-2026-10-25", unitIds: [w.uA.id] }); assert.equal(b.status, 403); assert.equal(b.body.code, "KONFIRMASI_MANIFEST_WAJIB");
  const c = await w.co.post("/api/production/posting-historis/batch", { hashDisetujui: lama.hash, rujukan: "OWNER-2026-10-25", konfirmasiManifest: "bukan-objek" }); assert.equal(c.status, 400); assert.equal(c.body.code, "KONFIRMASI_MANIFEST_TIDAK_VALID");
  await testPrisma.stockMovement.create({ data: { materialId: w.mx.id, type: "ADJUSTMENT", qty: -8, reason: "uji", note: "pengeluaran lain sesudah manifest ditinjau", createdAt: WIB("2026-09-02") } });
  const d = await w.co.post("/api/production/posting-historis/batch", { hashDisetujui: lama.hash, rujukan: "OWNER-2026-10-25", konfirmasiManifest: konfirmasiDari(lama) }); assert.equal(d.status, 409); assert.equal(d.body.code, "RENCANA_BERUBAH");
  const t1 = await hitung(); assert.equal(t1.batch, 0); assert.equal(t1.issue, 0); assert.equal(t1.mv, t0.mv + 1, "hanya penyesuaian uji");
});

test("K8. HTTP Owner: konfirmasi dari pratinjau (seperti UI) → 202; pilihan salah → 409 dengan selisih; sinkron ditolak sebelum movement; pratinjau memuat isi transaksi untuk dikonfirmasi", async () => {
  const w = await dunia2(); const prA = (await w.co.get("/api/production/posting-historis/pratinjau?unitIds=" + w.uA.id)).body; const prC = (await w.co.get("/api/production/posting-historis/pratinjau?unitIds=" + w.uC.id)).body; const t0 = await hitung();
  assert.match(prA.digestIsi, /^[0-9a-f]{64}$/); assert.equal(prA.order[0].trx[0].qty, 6); assert.equal(prA.order[0].unitId, w.uA.id); assert.ok(prA.bahan.every((x) => x.kode && typeof x.saldoSekarang === "number"));
  const salah = await w.co.post("/api/production/posting-historis/batch", { hashDisetujui: prC.hash, rujukan: "OWNER-2026-10-25", unitIds: [w.uC.id], konfirmasiManifest: konfirmasiPra(prA) }); assert.equal(salah.status, 409); assert.equal(salah.body.code, "KONFIRMASI_MANIFEST_TIDAK_COCOK"); assert.ok(salah.body.penghalang.length >= 3);
  const sinkron = await w.co.post("/api/production/posting-historis/jalankan", { hashDisetujui: prC.hash, rujukan: "OWNER-2026-10-25", unitIds: [w.uC.id], konfirmasiManifest: { ...konfirmasiPra(prC), jumlahTrx: 2 } }); assert.equal(sinkron.status, 409); assert.equal(await issues(w.uC), 0);
  const t1 = await hitung(); assert.equal(t1.batch, 0); assert.equal(t1.mv, t0.mv);
  const ok = await w.co.post("/api/production/posting-historis/batch", { hashDisetujui: prA.hash, rujukan: "OWNER-2026-10-25", unitIds: [w.uA.id], konfirmasiManifest: konfirmasiPra(prA) }); assert.equal(ok.status, 202, JSON.stringify(ok.body)); await tungguBatch(ok.body.batchId);
  const sin = await w.co.post("/api/production/posting-historis/jalankan", { hashDisetujui: prC.hash, rujukan: "OWNER-2026-10-25", unitIds: [w.uC.id], konfirmasiManifest: konfirmasiPra(prC) }); assert.equal(sin.status, 200, JSON.stringify(sin.body)); assert.equal(await issues(w.uC), 1);
});
