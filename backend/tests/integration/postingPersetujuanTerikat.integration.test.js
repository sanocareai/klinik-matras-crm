// PERSETUJUAN TERIKAT posting historis (insiden 25 Okt 2026): eksekusi hanya untuk persetujuan yang cocok PERSIS dengan rencana server; selisih → ditolak sebelum batch/movement dibuat.
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
import { ringkasRencana, ENTITAS_PERSETUJUAN } from "../../src/services/postingPersetujuanTerikat.js";
import { koreksiCatatan } from "../../src/services/koreksiPemakaian.js";
import { ajukanBatch, jalankanBatch, mulaiBatch, tungguBatch, statusBatch, hentikanBatch, lanjutkanBatch, pulihkanBatch, ENTITAS_BATCH } from "../../src/services/postingBatchLatar.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await tungguPenyegaran(); await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),Total Biaya Bahan (Rp),"Total Penjualan\n(Rp)",Insentif PIC,Insentif Corner,Keterangan / QC';
const baris = (no, order, tgl, kat, nama, qty, sat) => `${no},${order},${tgl},SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,${kat},${nama},,BAHAN,"${qty}",${sat},,,,,,QC OK`;
const WIB = (iso) => new Date(`${iso}T00:00:00+07:00`);
const terikatDari = (p, rujukan = "OWNER-2026-10-25") => { const r = ringkasRencana(p); return { hash: r.hash, unitIds: r.unitIds, daftarOrder: r.daftarOrder, jumlahOrder: r.jumlahOrder, jumlahTrx: r.jumlahTrx, rujukan }; };
const PERSETUJUAN = (p) => (typeof p === "string" ? { hashDisetujui: p, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner Uji", terikat: {} } : { hashDisetujui: p.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner Uji", terikat: terikatDari(p) });
// persetujuan terikat untuk panggilan HTTP, dari badan GET /rencana (transaksi memuat unitId & orderNumber)
const terikatHttp = (rb, rujukan = "OWNER-2026-10-25") => ({ hash: rb.hash, unitIds: [...new Set(rb.transaksi.map((t) => t.unitId))], daftarOrder: [...new Set(rb.transaksi.map((t) => t.orderNumber))], jumlahOrder: new Set(rb.transaksi.map((t) => t.orderNumber)).size, jumlahTrx: rb.transaksi.length, rujukan });
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
  return { admin, owner, A: { id: admin.user.id, name: admin.user.name }, B: { id: owner.user.id, name: owner.user.name }, mx, my, uA, uB, uC, ca: makeClient(server.baseUrl, admin.token), co: makeClient(server.baseUrl, owner.token) };
}

const hitung = async () => ({ mv: await testPrisma.stockMovement.count(), issue: await testPrisma.stockMovement.count({ where: { type: "ISSUE", note: { contains: "Impor pemakaian historis" } } }), batch: await testPrisma.activityEvent.count({ where: { entityType: ENTITAS_BATCH } }), tolak: await testPrisma.activityEvent.count({ where: { entityType: ENTITAS_PERSETUJUAN, eventType: "PERSETUJUAN_DITOLAK" } }) });
const tolak = async (fn, kode) => { try { await fn(); } catch (e) { assert.equal(e.code, kode, `kode galat: ${e.code} ${e.message}`); return e; } assert.fail(`seharusnya ditolak dengan ${kode}`); };
const dari = async (unitIds) => rencanakanPosting(testPrisma, { unitIds });
const issues = (unit) => testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "ISSUE" } });

test("P1. insiden: pilihan berbeda dari yang disetujui (hash, order, jumlah) ditolak SEBELUM batch/movement — sama jumlah order pun", async () => {
  const w = await dunia(); const disetujui = await dari([w.uA.id, w.uB.id]); const dipilih = await dari([w.uA.id, w.uC.id]);
  assert.equal(disetujui.orderUnik, dipilih.orderUnik, "jumlah order sama (kebingungan yang terjadi di produksi)"); assert.notEqual(disetujui.hash, dipilih.hash);
  const t0 = await hitung();
  // klien mengirim hash pilihan yang tampil di layarnya, tetapi persetujuan Owner (diketik) adalah manifest lain
  const e = await tolak(() => ajukanBatch(testPrisma, { persetujuan: { hashDisetujui: dipilih.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner", terikat: terikatDari(disetujui) }, aktor: w.B, unitIds: [w.uA.id, w.uC.id] }), "PERSETUJUAN_TIDAK_COCOK");
  assert.ok(e.penghalang.some((x) => /hash manifest/.test(x)), JSON.stringify(e.penghalang)); assert.ok(e.penghalang.some((x) => /order disetujui yang tidak ada di rencana: RES-04092026-902/.test(x))); assert.ok(e.penghalang.some((x) => /order di rencana yang tidak disetujui: RES-05092026-903/.test(x)));
  const e2 = await tolak(() => jalankanPosting(testPrisma, { persetujuan: { hashDisetujui: dipilih.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner", terikat: terikatDari(disetujui) }, aktor: w.B, unitIds: [w.uA.id, w.uC.id] }), "PERSETUJUAN_TIDAK_COCOK");
  assert.ok(e2.penghalang.length >= 2);
  const t1 = await hitung(); assert.equal(t1.mv, t0.mv, "nol movement"); assert.equal(t1.issue, 0); assert.equal(t1.batch, 0, "nol batch"); assert.equal(t1.tolak, 2, "dua penolakan tercatat sebagai peristiwa audit");
  const aud = await testPrisma.activityEvent.findFirst({ where: { entityType: ENTITAS_PERSETUJUAN }, orderBy: { createdAt: "desc" } }); assert.equal(aud.actorId, w.B.id); assert.equal(aud.metadata.hashPersetujuan, disetujui.hash); assert.equal(aud.metadata.hashRencana, dipilih.hash); assert.equal(aud.metadata.jumlahTrxRencana, 2);
  // setelah itu: persetujuan yang benar untuk pilihan yang sama berjalan normal
  const ok = await ajukanBatch(testPrisma, { persetujuan: PERSETUJUAN(dipilih), aktor: w.B, unitIds: [w.uA.id, w.uC.id] }); assert.equal(ok.baru, true); assert.equal(ok.totalUnit, 2);
});

test("P2. setiap bagian persetujuan diperiksa: hash, jumlah transaksi, jumlah order, daftar unit, rujukan, digest isi, bentuk", async () => {
  const w = await dunia(); const p = await dari([w.uA.id, w.uC.id]); const t0 = await hitung();
  const kirim = (ubah) => ajukanBatch(testPrisma, { persetujuan: { hashDisetujui: p.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner", terikat: { ...terikatDari(p), ...ubah } }, aktor: w.B, unitIds: [w.uA.id, w.uC.id] });
  const kasus = [
    [{ hash: "a".repeat(64) }, /hash manifest/], [{ hash: "pendek" }, /64 karakter hex/], [{ jumlahTrx: 3 }, /jumlah transaksi: disetujui 3 ≠ rencana 2/], [{ jumlahOrder: 3 }, /jumlah order: disetujui 3 ≠ rencana 2/],
    [{ unitIds: [w.uA.id] }, /1 unit rencana tidak disetujui/], [{ unitIds: [w.uA.id, w.uC.id, w.uB.id] }, /1 unit di luar rencana/], [{ daftarOrder: ["RES-03092026-901"] }, /order di rencana yang tidak disetujui: RES-05092026-903/],
    [{ daftarOrder: ["RES-03092026-901", "RES-05092026-903", "RES-99999999-999"] }, /order disetujui yang tidak ada di rencana: RES-99999999-999/], [{ digestIsi: "b".repeat(64) }, /isi transaksi/], [{ rujukan: "OWNER-LAIN-2026" }, /rujukan berbeda/],
    [{ rujukan: "pendek" }, /minimal 8 karakter/], [{ unitIds: [] }, /daftar unit persetujuan kosong/], [{ jumlahTrx: "2" }, /jumlah transaksi persetujuan tidak valid/],
  ];
  for (const [ubah, pola] of kasus) { const e = await tolak(() => kirim(ubah), "PERSETUJUAN_TIDAK_COCOK"); assert.match(e.penghalang.join(" | "), pola, JSON.stringify(ubah)); }
  assert.equal((await tolak(() => ajukanBatch(testPrisma, { persetujuan: { hashDisetujui: p.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner" }, aktor: w.B, unitIds: [w.uA.id, w.uC.id] }), "PERSETUJUAN_TERIKAT_WAJIB")).statusCode, 403);
  const t1 = await hitung(); assert.equal(t1.mv, t0.mv); assert.equal(t1.batch, 0); assert.equal(t1.issue, 0);
  // hash ditempel dengan huruf besar/spasi tetap diterima (normalisasi), digest isi yang benar diterima
  const ok = await kirim({ hash: ` ${p.hash.toUpperCase()} `, digestIsi: ringkasRencana(p).digestIsi }); assert.equal(ok.baru, true);
});

test("P3. saldo berubah sesudah persetujuan: syarat saldo dipatuhi server; benar diterima dan tersimpan di rekaman batch", async () => {
  const w = await dunia(); const mz = await createTestMaterial({ code: "L-MZ", name: "BAHAN SYARAT", unit: "PCS" }); await seedBalance(mz.id, 5, { createdAt: WIB("2026-09-01"), unitCost: 1000 });
  const p = await dari([w.uA.id]);
  const kirim = (s) => ajukanBatch(testPrisma, { persetujuan: { hashDisetujui: p.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner", terikat: { ...terikatDari(p), saldoSyarat: s } }, aktor: w.B, unitIds: [w.uA.id] });
  await testPrisma.stockMovement.create({ data: { materialId: mz.id, type: "ADJUSTMENT", qty: 1, reason: "uji", note: "GR/penyesuaian lain masuk sesudah persetujuan", createdAt: WIB("2026-09-02") } }); // saldo MZ 5 → 6; tidak mengubah rencana
  assert.equal((await dari([w.uA.id])).hash, p.hash, "rencana tidak berubah — hash sama; hanya saldo yang bergeser");
  const t0 = await hitung(); const e = await tolak(() => kirim([{ kode: "L-MZ", saldo: 5 }, { kode: "L-MX", saldo: 10 }]), "PERSETUJUAN_TIDAK_COCOK"); assert.match(e.penghalang.join("|"), /saldo L-MZ: syarat 5 ≠ sekarang 6/);
  await tolak(() => kirim([{ kode: "TIDAK-ADA", saldo: 1 }]), "PERSETUJUAN_TIDAK_COCOK"); await tolak(() => kirim([{ kode: "L-MX", saldo: "x" }]), "PERSETUJUAN_TIDAK_COCOK");
  const t1 = await hitung(); assert.equal(t1.mv, t0.mv); assert.equal(t1.batch, 0);
  const ok = await kirim([{ kode: "L-MZ", saldo: 6 }, { kode: "L-MX", saldo: 10 }]); assert.equal(ok.baru, true);
  const dia = await testPrisma.activityEvent.findFirst({ where: { entityType: ENTITAS_BATCH, entityId: ok.batchId, eventType: "BATCH_DIAJUKAN" } });
  assert.deepEqual(dia.metadata.persetujuanTerikat.saldoSyarat, [{ kode: "L-MZ", saldo: 6 }, { kode: "L-MX", saldo: 10 }]);
});

test("P4. persetujuan benar: batch menyimpan rekaman persetujuan lengkap dan hanya memposting yang disetujui", async () => {
  const w = await dunia(); const p = await dari([w.uA.id, w.uC.id]); const b = await ajukanBatch(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B, unitIds: [w.uA.id, w.uC.id] });
  const dia = await testPrisma.activityEvent.findFirst({ where: { entityType: ENTITAS_BATCH, entityId: b.batchId, eventType: "BATCH_DIAJUKAN" } }); const rek = dia.metadata.persetujuanTerikat; const r = ringkasRencana(p);
  assert.equal(rek.hash, p.hash); assert.deepEqual(rek.unitIds, r.unitIds); assert.deepEqual(rek.daftarOrder, ["RES-03092026-901", "RES-05092026-903"]); assert.equal(rek.jumlahOrder, 2); assert.equal(rek.jumlahTrx, 2); assert.equal(rek.digestIsi, r.digestIsi); assert.equal(rek.rujukan, "OWNER-2026-10-25"); assert.equal(dia.metadata.rujukan, "OWNER-2026-10-25");
  assert.equal((await jalankanBatch(testPrisma, b.batchId)).status, "SELESAI");
  assert.equal(await issues(w.uA), 1); assert.equal(await issues(w.uC), 1); assert.equal(await issues(w.uB), 0, "order yang tidak disetujui tidak tersentuh");
});

test("P5. klik ganda/serentak dengan persetujuan benar = satu batch; klik ulang dengan persetujuan salah pada batch yang ada tidak menyentuh apa pun", async () => {
  const w = await dunia(); const p = await dari([w.uA.id, w.uC.id]); const salah = await dari([w.uB.id]);
  const hasil = await Promise.allSettled([1, 2, 3].map(() => ajukanBatch(testPrisma, { persetujuan: PERSETUJUAN(p), aktor: w.B, unitIds: [w.uA.id, w.uC.id] })));
  assert.ok(hasil.every((x) => x.status === "fulfilled"), JSON.stringify(hasil.filter((x) => x.status === "rejected").map((x) => x.reason?.message))); assert.equal(hasil.filter((x) => x.value.baru).length, 1, "tepat satu yang membuat batch");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: ENTITAS_BATCH, eventType: "BATCH_DIAJUKAN" } }), 1);
  const t0 = await hitung();
  await tolak(() => ajukanBatch(testPrisma, { persetujuan: { hashDisetujui: p.hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner", terikat: terikatDari(salah) }, aktor: w.B, unitIds: [w.uA.id, w.uC.id] }), "PERSETUJUAN_TIDAK_COCOK");
  const t1 = await hitung(); assert.equal(t1.batch, t0.batch); assert.equal(t1.mv, t0.mv);
  assert.equal((await jalankanBatch(testPrisma, hasil[0].value.batchId)).status, "SELESAI");
});

test("P6. persetujuan/tab lama: tanpa persetujuan terikat atau rencana sudah bergeser → ditolak; nol tulisan", async () => {
  const w = await dunia(); const lama = await dari([w.uA.id, w.uB.id, w.uC.id]);
  const t0 = await hitung();
  const a = await w.co.post("/api/production/posting-historis/batch", { hashDisetujui: lama.hash, rujukan: "OWNER-2026-10-25" }); assert.equal(a.status, 403); assert.equal(a.body.code, "PERSETUJUAN_TERIKAT_WAJIB");
  const b = await w.co.post("/api/production/posting-historis/jalankan", { hashDisetujui: lama.hash, rujukan: "OWNER-2026-10-25", unitIds: [w.uA.id] }); assert.equal(b.status, 403); assert.equal(b.body.code, "PERSETUJUAN_TERIKAT_WAJIB");
  const c = await w.co.post("/api/production/posting-historis/batch", { hashDisetujui: lama.hash, rujukan: "OWNER-2026-10-25", persetujuanTerikat: "bukan-objek" }); assert.equal(c.status, 400); assert.equal(c.body.code, "PERSETUJUAN_TERIKAT_TIDAK_VALID");
  // rencana bergeser sesudah persetujuan (pengeluaran lain menghabiskan pasokan MX) → RENCANA_BERUBAH, bukan eksekusi basi
  await testPrisma.stockMovement.create({ data: { materialId: w.mx.id, type: "ADJUSTMENT", qty: -8, reason: "uji", note: "pengeluaran lain sesudah persetujuan", createdAt: WIB("2026-09-02") } });
  const d = await w.co.post("/api/production/posting-historis/batch", { hashDisetujui: lama.hash, rujukan: "OWNER-2026-10-25", persetujuanTerikat: terikatDari(lama) }); assert.equal(d.status, 409); assert.equal(d.body.code, "RENCANA_BERUBAH");
  const t1 = await hitung(); assert.equal(t1.batch, 0); assert.equal(t1.issue, 0); assert.equal(t1.mv, t0.mv + 1, "hanya penyesuaian uji");
});

test("P7. HTTP: persetujuan benar → 202; salah → 409 PERSETUJUAN_TIDAK_COCOK dengan daftar selisih; ADMIN tetap 403; sinkron ditolak sebelum movement", async () => {
  const w = await dunia(); const rb = (await w.co.get("/api/production/posting-historis/rencana?unitIds=" + w.uA.id)).body; const rb2 = (await w.co.get("/api/production/posting-historis/rencana?unitIds=" + w.uC.id)).body;
  const t0 = await hitung();
  const salah = await w.co.post("/api/production/posting-historis/batch", { hashDisetujui: rb2.hash, rujukan: "OWNER-2026-10-25", unitIds: [w.uC.id], persetujuanTerikat: terikatHttp(rb) }); assert.equal(salah.status, 409); assert.equal(salah.body.code, "PERSETUJUAN_TIDAK_COCOK"); assert.ok(salah.body.penghalang.length >= 2);
  assert.equal((await w.ca.post("/api/production/posting-historis/batch", { hashDisetujui: rb.hash, rujukan: "OWNER-2026-10-25", unitIds: [w.uA.id], persetujuanTerikat: terikatHttp(rb) })).status, 403);
  const t1 = await hitung(); assert.equal(t1.batch, 0); assert.equal(t1.mv, t0.mv);
  const ok = await w.co.post("/api/production/posting-historis/batch", { hashDisetujui: rb.hash, rujukan: "OWNER-2026-10-25", unitIds: [w.uA.id], persetujuanTerikat: terikatHttp(rb) }); assert.equal(ok.status, 202, JSON.stringify(ok.body)); await tungguBatch(ok.body.batchId);
  const pr = (await w.co.get("/api/production/posting-historis/pratinjau?unitIds=" + w.uC.id)).body; assert.match(pr.digestIsi, /^[0-9a-f]{64}$/); assert.equal(pr.order.length, 1); assert.equal(pr.order[0].trx.length, 1);
  const sinkron = await w.co.post("/api/production/posting-historis/jalankan", { hashDisetujui: pr.hash, rujukan: "OWNER-2026-10-25", unitIds: [w.uC.id], persetujuanTerikat: { ...terikatHttp(rb2), jumlahTrx: 2 } }); assert.equal(sinkron.status, 409); assert.equal(sinkron.body.code, "PERSETUJUAN_TIDAK_COCOK");
  assert.equal(await issues(w.uC), 0, "sinkron ditolak sebelum movement");
});
