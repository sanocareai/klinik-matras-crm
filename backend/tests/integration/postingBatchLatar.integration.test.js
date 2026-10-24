// Posting batch di LATAR: progres, idempotensi, kelanjutan setelah putus, pekerja serentak, rencana bergeser, hentikan/lanjut, pulihan saat boot, dan rute API (202 + polling; posting SATU order sinkron).
// Dunia uji sama dengan evaluasiCatatanAtomik/Basi: bahan MX (pasokan 10): uA 6 (3 Sep), uB 5 (4 Sep) diblokir, uC 4 (5 Sep); MY untuk transaksi sah uB. Rencana awal = 3 transaksi (uA-MX, uB-MY, uC-MX).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { rencanakanImpor, terapkanImpor, evaluasiUlang, resetKeadaanEfektif, tungguPenyegaran } from "../../src/services/catatanPemakaianHistoris.js";
import { rencanakanPosting, postingSatuUnit } from "../../src/services/postingPemakaianHistoris.js";
import { koreksiCatatan } from "../../src/services/koreksiPemakaian.js";
import { ajukanBatch, jalankanBatch, mulaiBatch, tungguBatch, statusBatch, hentikanBatch, lanjutkanBatch, pulihkanBatch, ENTITAS_BATCH } from "../../src/services/postingBatchLatar.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await tungguPenyegaran(); await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),Total Biaya Bahan (Rp),"Total Penjualan\n(Rp)",Insentif PIC,Insentif Corner,Keterangan / QC';
const baris = (no, order, tgl, kat, nama, qty, sat) => `${no},${order},${tgl},SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,${kat},${nama},,BAHAN,"${qty}",${sat},,,,,,QC OK`;
const WIB = (iso) => new Date(`${iso}T00:00:00+07:00`);
const PERSETUJUAN = (hash) => ({ hashDisetujui: hash, rujukan: "OWNER-2026-10-25", disetujuiOleh: "Owner Uji" });
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
const issues = (unit) => testPrisma.stockMovement.count({ where: { unitId: unit.id, type: "ISSUE" } });
const ajukan = async (w, extra = {}) => { const p = await rencanakanPosting(testPrisma); return { p, b: await ajukanBatch(testPrisma, { persetujuan: PERSETUJUAN(p.hash), aktor: w.B, ...extra }) }; };
const titikTetap = async (l) => { const r = await evaluasiUlang(testPrisma, {}); assert.equal(r.berubah, 0, `${l}: ${r.berubah} perubahan`); };

test("L1. batch selesai di latar: progres per unit, semua diposting sekali, titik tetap; ajukan tidak menjalankan apa pun", async () => {
  const w = await dunia(); const { p, b } = await ajukan(w);
  assert.equal(b.baru, true); assert.equal(b.status, "MENUNGGU"); assert.equal(b.totalUnit, 3); assert.equal(b.transaksiTotal, p.jumlah);
  assert.equal(await testPrisma.stockMovement.count({ where: { type: "ISSUE", note: { contains: "Impor pemakaian historis" } } }), 0, "mengajukan tidak memposting");
  const langkah = []; const r = await jalankanBatch(testPrisma, b.batchId, { setelahUnit: async () => { const s = await statusBatch(testPrisma, b.batchId); langkah.push([s.status, s.unitSelesai]); } });
  assert.equal(r.status, "SELESAI");
  assert.deepEqual(langkah.map((x) => x[1]), [1, 2, 3], "progres naik per unit"); assert.ok(langkah.every((x) => x[0] === "BERJALAN"));
  const s = await statusBatch(testPrisma, b.batchId); assert.equal(s.status, "SELESAI"); assert.equal(s.transaksiDiposting, 3); assert.equal(s.unitGagal, 0); assert.ok(s.selesaiPada);
  assert.equal(await issues(w.uA), 1); assert.equal(await issues(w.uC), 1); assert.equal(await issues(w.uB), 1);
  await titikTetap("L1");
});

test("L2. idempoten: hash sama = batch sama; dua pekerja serentak = satu eksekusi; jalankan ulang batch selesai = nol tulisan", async () => {
  const w = await dunia(); const { p, b } = await ajukan(w);
  const b2 = await ajukanBatch(testPrisma, { persetujuan: PERSETUJUAN(p.hash), aktor: w.B }); assert.equal(b2.baru, false); assert.equal(b2.batchId, b.batchId);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: ENTITAS_BATCH, eventType: "BATCH_DIAJUKAN" } }), 1);
  const hasil = await Promise.all([jalankanBatch(testPrisma, b.batchId, { pekerja: "pekerja-1" }), jalankanBatch(testPrisma, b.batchId, { pekerja: "pekerja-2" })]);
  assert.equal(hasil.filter((x) => x.dijalankan).length, 1, "hanya satu pekerja yang berjalan"); assert.ok(hasil.some((x) => x.status === "BERJALAN" || x.dijalankan === false));
  assert.equal(await issues(w.uA) + await issues(w.uB) + await issues(w.uC), 3);
  const mv = await testPrisma.stockMovement.count(); const lagi = await jalankanBatch(testPrisma, b.batchId); assert.equal(lagi.dijalankan, false); assert.equal(await testPrisma.stockMovement.count(), mv);
  await assert.rejects(() => ajukanBatch(testPrisma, { persetujuan: PERSETUJUAN("salah"), aktor: w.B }), /BERBEDA/);
});

test("L3. putus di tengah jalan → TERPUTUS → dilanjutkan dari unit yang belum selesai (tanpa mengulang yang sudah)", async () => {
  const w = await dunia(); const { b } = await ajukan(w);
  await assert.rejects(() => jalankanBatch(testPrisma, b.batchId, { pekerja: "pekerja-lama", setelahUnit: async () => { throw new Error("proses mati"); } }), /proses mati/);
  let s = await statusBatch(testPrisma, b.batchId); assert.equal(s.unitSelesai, 1); assert.equal(s.status, "BERJALAN", "sewa pekerja lama masih berlaku → belum bisa diambil alih");
  const r0 = await jalankanBatch(testPrisma, b.batchId, { pekerja: "pekerja-baru" }); assert.equal(r0.dijalankan, false, "sewa aktif menahan pekerja baru");
  await testPrisma.activityEvent.create({ data: { entityType: ENTITAS_BATCH, entityId: b.batchId, eventType: "BATCH_LEASE", actorType: "SYSTEM", metadata: { pekerja: "pekerja-lama", sampai: new Date(Date.now() - 1000).toISOString() } } }); // sewa kedaluwarsa = proses benar-benar mati
  s = await statusBatch(testPrisma, b.batchId); assert.equal(s.status, "TERPUTUS");
  const r = await jalankanBatch(testPrisma, b.batchId, { pekerja: "pekerja-baru" }); assert.equal(r.status, "SELESAI");
  s = await statusBatch(testPrisma, b.batchId); assert.equal(s.unitSelesai, 3); assert.equal(s.transaksiDiposting, 3);
  for (const u of [w.uA, w.uB, w.uC]) assert.ok((await issues(u)) >= 1);
  assert.equal(await issues(w.uA) + await issues(w.uB) + await issues(w.uC), 3, "tidak ada pengeluaran ganda akibat kelanjutan");
  await titikTetap("L3");
});

test("L4. putus SETELAH commit unit tetapi SEBELUM peristiwa progres: kelanjutan hanya menautkan (DILEWATI), tidak menggandakan", async () => {
  const w = await dunia(); const { p, b } = await ajukan(w);
  const spec = (await testPrisma.activityEvent.findFirst({ where: { entityType: ENTITAS_BATCH, eventType: "BATCH_DIAJUKAN" } })).metadata;
  const daftarA = spec.rencana.filter((t) => t.unitId === w.uA.id);
  const h = await postingSatuUnit(testPrisma, { unitId: w.uA.id, daftar: daftarA, persetujuan: PERSETUJUAN(p.hash), aktor: w.B }); assert.equal(h.status, "DIPOSTING"); // commit terjadi, peristiwa BATCH_UNIT belum
  const r = await jalankanBatch(testPrisma, b.batchId); assert.equal(r.status, "SELESAI");
  const hu = (await testPrisma.activityEvent.findMany({ where: { entityType: ENTITAS_BATCH, eventType: "BATCH_UNIT" } })).find((e) => e.metadata.unitId === w.uA.id);
  assert.equal(hu.metadata.hasil, "DILEWATI"); assert.equal(await issues(w.uA), 1); await titikTetap("L4");
});

test("L5. rencana bergeser setelah disetujui (koreksi qty di catatan uC): unit itu gugur fail-closed, unit lain tetap diposting → SELESAI_SEBAGIAN", async () => {
  const w = await dunia(); const { b } = await ajukan(w);
  const nC = await testPrisma.unitUsageNote.findFirst({ where: { unitId: w.uC.id, origin: "EXCEL" } });
  await koreksiCatatan(testPrisma, { noteId: nC.id, perubahan: { qty: 3 }, alasan: "Admin Sales konfirmasi 3 meter", kunci: `uji-l5-${Date.now()}-aaaaaaaa`, aktor: w.A });
  const r = await jalankanBatch(testPrisma, b.batchId); assert.equal(r.status, "SELESAI_SEBAGIAN");
  const s = await statusBatch(testPrisma, b.batchId); assert.equal(s.unitGagal, 1); assert.equal(s.gagal[0].kode, "RENCANA_BERUBAH"); assert.equal(s.gagal[0].order, "RES-05092026-903");
  assert.equal(await issues(w.uC), 0); assert.equal(await issues(w.uA), 1); assert.equal(await issues(w.uB), 1); await tungguPenyegaran(); await titikTetap("L5");
});

test("L6. hentikan lalu lanjutkan; pulihan saat boot meneruskan batch TERPUTUS", async () => {
  const w = await dunia(); const { b } = await ajukan(w);
  const r1 = await jalankanBatch(testPrisma, b.batchId, { setelahUnit: async (u, h) => { if (u) await hentikanBatch(testPrisma, b.batchId, w.B); } });
  assert.equal(r1.status, "DIHENTIKAN"); let s = await statusBatch(testPrisma, b.batchId); assert.equal(s.status, "DIHENTIKAN"); assert.equal(s.unitSelesai, 1);
  await lanjutkanBatch(testPrisma, b.batchId, w.B); await tungguBatch(b.batchId);
  s = await statusBatch(testPrisma, b.batchId); assert.equal(s.status, "SELESAI"); assert.equal(s.unitSelesai, 3);
  // pulihan boot: batch kedua pada dunia baru, sewa kedaluwarsa
  await truncateAll(); const w2 = await dunia(); const { b: b2 } = await ajukan(w2);
  await assert.rejects(() => jalankanBatch(testPrisma, b2.batchId, { pekerja: "mati", setelahUnit: async () => { throw new Error("mati"); } }));
  await testPrisma.activityEvent.create({ data: { entityType: ENTITAS_BATCH, entityId: b2.batchId, eventType: "BATCH_LEASE", actorType: "SYSTEM", metadata: { pekerja: "mati", sampai: new Date(Date.now() - 1000).toISOString() } } });
  const diteruskan = await pulihkanBatch(testPrisma); assert.deepEqual(diteruskan, [b2.batchId]); await tungguBatch(b2.batchId);
  assert.equal((await statusBatch(testPrisma, b2.batchId)).status, "SELESAI");
});

test("L7. API: batch 202 + polling progres sampai selesai; posting SATU order sinkron lewat unitIds; izin; hash salah ditolak", async () => {
  const w = await dunia();
  const rencana = await w.co.get(`/api/production/posting-historis/rencana`); assert.equal(rencana.status, 200);
  const salah = await w.co.post(`/api/production/posting-historis/batch`, { hashDisetujui: "salah", rujukan: "OWNER-2026-10-25" }); assert.equal(salah.status, 409); assert.equal(salah.body.code, "RENCANA_BERUBAH");
  const tanpaIzin = await w.ca.post(`/api/production/posting-historis/batch`, { hashDisetujui: rencana.body.hash, rujukan: "OWNER-2026-10-25" }); assert.equal(tanpaIzin.status, 403, "ADMIN tanpa izin persetujuan");
  // SATU order sinkron
  const satu = await w.co.get(`/api/production/posting-historis/rencana?unitIds=${w.uA.id}`); assert.equal(satu.body.jumlah, 1);
  const t0 = Date.now(); const j = await w.co.post(`/api/production/posting-historis/jalankan`, { hashDisetujui: satu.body.hash, rujukan: "OWNER-2026-10-25", unitIds: [w.uA.id] }); const ms = Date.now() - t0;
  assert.equal(j.status, 200, JSON.stringify(j.body)); assert.equal(j.body.diposting.length, 1); assert.equal(await issues(w.uA), 1);
  const buruk = await w.co.post(`/api/production/posting-historis/jalankan`, { hashDisetujui: satu.body.hash, rujukan: "OWNER-2026-10-25", unitIds: ["bukan-uuid"] }); assert.equal(buruk.status, 400);
  // batch sisa rencana
  const sisa = await w.co.get(`/api/production/posting-historis/rencana`);
  const a = await w.co.post(`/api/production/posting-historis/batch`, { hashDisetujui: sisa.body.hash, rujukan: "OWNER-2026-10-25" }); assert.equal(a.status, 202, JSON.stringify(a.body)); assert.equal(a.body.batchId, sisa.body.hash);
  let st; for (let i = 0; i < 200; i++) { st = (await w.co.get(`/api/production/posting-historis/batch/${a.body.batchId}`)).body; if (["SELESAI", "SELESAI_SEBAGIAN"].includes(st.status)) break; await new Promise((r) => setTimeout(r, 100)); }
  assert.equal(st.status, "SELESAI", JSON.stringify(st)); assert.equal(st.unitSelesai, 2);
  const ulang = await w.co.post(`/api/production/posting-historis/batch`, { hashDisetujui: sisa.body.hash, rujukan: "OWNER-2026-10-25" }); assert.equal(ulang.status, 202); assert.equal(ulang.body.baru, false, "ajukan ulang hash yang sama = batch yang sama");
  await tungguBatch(a.body.batchId); await tungguPenyegaran(); await titikTetap("L7");
  console.log(`   [L7] posting SATU order via API: ${ms} ms`);
});
