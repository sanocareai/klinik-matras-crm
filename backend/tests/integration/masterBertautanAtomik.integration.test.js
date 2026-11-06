// MASTER BARU + TAUTAN SO ATOMIK — tes terarah risiko: master dibuat lalu catatan historis lama bernama persis sama terpetakan otomatis (evaluasi ulang) SEBELUM tautan SO ada.
// Dunia: tiga catatan Excel bernama 'KAYU UJI 2X6X200' (2) dan 'KAYU UJI 2X5X200' (1) yang BELUM punya master (material_id kosong) + bahan kontrol P-CTL (satu catatan, tanpa tautan).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { rencanakanImpor, terapkanImpor, evaluasiUlang, resetKeadaanEfektif, tungguPenyegaran } from "../../src/services/catatanPemakaianHistoris.js";
import { rencanakanPosting, postingSatuUnit } from "../../src/services/postingPemakaianHistoris.js";
import { daftarPengaman, tautanSOAktif, buatMasterBertautan, wajibTidakTerkenaPengaman, KEADAAN_PENGAMAN } from "../../src/services/pengamanHistorisPascaSO.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await tungguPenyegaran(); await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),Total Biaya Bahan (Rp),"Total Penjualan\n(Rp)",Insentif PIC,Insentif Corner,Keterangan / QC';
const baris = (no, order, tgl, kat, nama, qty, sat) => `${no},${order},${tgl},SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,${kat},${nama},,BAHAN,"${qty}",${sat},,,,,,QC OK`;
const WIB = (iso) => new Date(`${iso}T00:00:00+07:00`);
const HARI_INI = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const HASH = "1ce107ef9edc8a42321ca0f420a0f5d7fc52e5e30925b66da37a298c7b9d4af2";
let seq = 0;
const NAMA6 = "KAYU UJI 2X6X200"; const NAMA5 = "KAYU UJI 2X5X200";
const dua = () => [
  { code: "KAYU-UJI-2X6X200", name: NAMA6, unit: "PCS", category: "RAW_MATERIAL" },
  { code: "KAYU-UJI-2X5X200", name: NAMA5, unit: "PCS", category: "RAW_MATERIAL" },
];

async function dunia() {
  resetKeadaanEfektif();
  const admin = await createTestUser({ roles: ["ADMIN"] }); const owner = await createTestUser({ roles: ["OWNER"] });
  const ctl = await createTestMaterial({ code: "P-CTL", name: "BUSA KONTROL ATOMIK", unit: "SHEET" }); await seedBalance(ctl.id, 10, { createdAt: WIB("2026-09-01"), unitCost: 50000 });
  const mk = async (no) => { const { order, unit } = await createTestUnit({ status: "DELIVERED" }); await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: no, status: "DELIVERED" } }); return unit; };
  const u1 = await mk("RES-03092026-921"); const u2 = await mk("RES-04092026-922"); const u3 = await mk("RES-05092026-923"); const uc = await mk("RES-06092026-924");
  const csv = ["J", "D", HDR,
    baris(1, "RES-03092026-921", "3 Sep 26", "Bahan Lapisan", NAMA6, "6,0", "PCS"),
    baris(2, "RES-04092026-922", "4 Sep 26", "Bahan Lapisan", NAMA6, "4,0", "PCS"),
    baris(3, "RES-05092026-923", "5 Sep 26", "Bahan Lapisan", NAMA5, "3,0", "PCS"),
    baris(4, "RES-06092026-924", "6 Sep 26", "Bahan Fondasi", "BUSA KONTROL ATOMIK", "1,0", "LEMBAR")].join("\n");
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: csv, namaBerkas: `atomik${++seq}.csv` }), {});
  await evaluasiUlang(testPrisma, {});
  const aktor = (u, r) => ({ id: u.user.id, name: u.user.name, roles: [r] });
  return { admin, owner, A: aktor(admin, "ADMIN"), B: aktor(owner, "OWNER"), ctl, u1, u2, u3, uc, ca: makeClient(server.baseUrl, admin.token), co: makeClient(server.baseUrl, owner.token) };
}
const buat = (w, over = {}) => buatMasterBertautan(testPrisma, { aktor: w.B, bahan: dua(), soTanggal: HARI_INI, sumber: "KIRIM GILANG.xlsx (SO 4 Nov); paket master f296840a", alasan: "Master baru dibuat bersama tautan SO agar catatan lama tidak terpetakan tanpa pengaman", rujukanHash: HASH, kunci: `master-${++seq}-abcdefgh`, ...over });
const catatanNama = (nama) => testPrisma.unitUsageNote.findMany({ where: { rawName: nama }, orderBy: { orderNumber: "asc" } });
const hitMaster = () => testPrisma.material.count({ where: { code: { in: ["KAYU-UJI-2X6X200", "KAYU-UJI-2X5X200"] } } });
const hitTautan = () => testPrisma.activityEvent.count({ where: { entityType: "pernyataan_historis_so", eventType: "SO_DITAUTKAN" } });
const issuesSemua = () => testPrisma.stockMovement.count({ where: { type: "ISSUE" } });
const mv = () => testPrisma.stockMovement.count();

test("A1. keadaan awal: catatan bernama KAYU UJI belum bermaster (material_id kosong) dan TIDAK terlindungi; evaluasi tidak memetakan apa pun tanpa master", async () => {
  const w = await dunia();
  const n = [...(await catatanNama(NAMA6)), ...(await catatanNama(NAMA5))]; assert.equal(n.length, 3); assert.ok(n.every((x) => x.materialId === null));
  assert.equal((await daftarPengaman(testPrisma)).baris.length, 0); assert.equal(await hitMaster(), 0); assert.ok(w.ctl);
});

test("A2. buatMasterBertautan: master + tautan lahir bersama; tidak ada pemetaan, stok, atau deklarasi; catatan tetap kosong sampai evaluasi", async () => {
  const w = await dunia(); const m0 = await mv(); const h = await buat(w);
  assert.equal(h.ulang, false); assert.equal(h.bahan.length, 2); assert.equal(await hitMaster(), 2); assert.equal(await hitTautan(), 2);
  const aktif = await tautanSOAktif(testPrisma, h.bahan.map((b) => b.materialId)); assert.equal(aktif.size, 2);
  for (const b of h.bahan) { const t = aktif.get(b.materialId); assert.equal(t.soTanggal, HARI_INI); assert.equal(t.rujukanHash, HASH); assert.equal(t.id, b.tautanId); }
  assert.equal(await mv(), m0, "tanpa pergerakan stok");
  assert.equal(await testPrisma.activityEvent.count({ where: { eventType: "SO_HISTORIS_DINYATAKAN" } }), 0, "tanpa deklarasi");
  assert.ok([...(await catatanNama(NAMA6)), ...(await catatanNama(NAMA5))].every((x) => x.materialId === null), "pembuatan tidak memetakan catatan");
  const mat = await testPrisma.material.findUnique({ where: { code: "KAYU-UJI-2X6X200" } }); assert.equal(mat.unit, "PCS"); assert.equal(mat.category, "RAW_MATERIAL");
});

test("A3. evaluasi otomatis sesudah commit: catatan terpetakan (nama persis) tetapi LANGSUNG TERTAHAN_PASCA_SO; keluar dari rencana; guard posting menolak; tidak ada ISSUE", async () => {
  const w = await dunia(); const h = await buat(w); for (const b of h.bahan) await seedBalance(b.materialId, 20, { createdAt: WIB("2026-09-01"), unitCost: 30000 }); await evaluasiUlang(testPrisma, {});
  const n6 = await catatanNama(NAMA6); const n5 = await catatanNama(NAMA5); assert.ok([...n6, ...n5].every((x) => x.materialId !== null), "evaluasi memetakan nama persis (perilaku lama)");
  const d = await daftarPengaman(testPrisma); assert.equal(d.tertahan, 3); assert.ok(d.baris.every((b) => b.keadaan === KEADAAN_PENGAMAN.TERTAHAN_PASCA_SO));
  assert.ok([...n6, ...n5].every((x) => x.state === "SIAP_POSTING"), "kasus berbahaya: catatan SIAP_POSTING seandainya tanpa tautan");
  const p = await rencanakanPosting(testPrisma); assert.equal(p.tertahan.length, 3); assert.ok(p.transaksi.every((t) => t.kodeBahan === "P-CTL"), "hanya kontrol yang boleh diposting");
  await assert.rejects(() => testPrisma.$transaction(async (tx) => wajibTidakTerkenaPengaman(tx, n6.map((x) => ({ id: x.id, materialId: x.materialId, usedAt: x.usedAt, orderNumber: x.orderNumber })))), (e) => e.code === KEADAAN_PENGAMAN.TERTAHAN_PASCA_SO && e.statusCode === 409);
  assert.equal(await issuesSemua(), 0);
});

test("A4. atomik: satu master sah + satu bernama kembar ⇒ SELURUH permintaan ditolak; tidak ada master atau tautan tersisa", async () => {
  const w = await dunia(); await createTestMaterial({ code: "ADA-2X5X200", name: NAMA5, unit: "PCS" });
  await assert.rejects(() => buat(w), (e) => e.code === "NAMA_SUDAH_ADA" && e.statusCode === 409);
  assert.equal(await hitMaster(), 0); assert.equal(await hitTautan(), 0);
});

test("A5. atomik: galat di tengah transaksi (setelah master pertama dibuat) membatalkan semuanya (rollback)", async () => {
  const w = await dunia(); const bahan = [dua()[0], { code: "KAYU-UJI-NUL", name: "KAYU\u0000RUSAK", unit: "PCS", category: "RAW_MATERIAL" }];
  await assert.rejects(() => buat(w, { bahan }));
  assert.equal(await hitMaster(), 0); assert.equal(await testPrisma.material.count({ where: { code: "KAYU-UJI-NUL" } }), 0); assert.equal(await hitTautan(), 0);
  assert.ok((await catatanNama(NAMA6)).every((x) => x.materialId === null));
});

test("A6. validasi dan izin: bukan penyetuju (ADMIN) ditolak 403; satuan/kategori/kode/tanggal/kunci tidak valid ditolak; tidak ada tulisan", async () => {
  const w = await dunia();
  await assert.rejects(() => buat(w, { aktor: w.A }), (e) => e.code === "BUKAN_PENYETUJU" && e.statusCode === 403);
  await assert.rejects(() => buat(w, { bahan: [{ ...dua()[0], unit: "LITERAN" }] }), (e) => e.code === "SATUAN_TIDAK_VALID");
  await assert.rejects(() => buat(w, { bahan: [{ ...dua()[0], category: undefined }] }), (e) => e.code === "KATEGORI_TIDAK_VALID");
  await assert.rejects(() => buat(w, { bahan: [{ ...dua()[0], code: "x y" }] }), (e) => e.code === "KODE_TIDAK_VALID");
  await assert.rejects(() => buat(w, { bahan: [dua()[0], dua()[0]] }), (e) => e.code === "MASTER_GANDA");
  await assert.rejects(() => buat(w, { bahan: [] }), (e) => e.code === "BAHAN_TIDAK_VALID");
  await assert.rejects(() => buat(w, { soTanggal: "2099-01-01" }), (e) => e.code === "TANGGAL_SO_MASA_DEPAN");
  await assert.rejects(() => buat(w, { kunci: "x" }), (e) => e.code === "KUNCI_WAJIB" && e.statusCode === 428);
  assert.equal(await hitMaster(), 0); assert.equal(await hitTautan(), 0);
});

test("A7. idempoten: ulangi kunci+isi sama ⇒ ulang=true tanpa menulis; kunci sama isi beda ⇒ 409; kunci lain kode sama ⇒ 409 MASTER_SUDAH_ADA; tidak menautkan ke bahan lama", async () => {
  const w = await dunia(); const kunci = "master-idem-0001"; const a = await buat(w, { kunci }); const t0 = await hitTautan();
  const b = await buat(w, { kunci }); assert.equal(b.ulang, true); assert.deepEqual(b.bahan.map((x) => x.tautanId).sort(), a.bahan.map((x) => x.tautanId).sort()); assert.equal(await hitTautan(), t0);
  await assert.rejects(() => buat(w, { kunci, alasan: "Alasan lain yang cukup panjang untuk lolos validasi" }), (e) => e.code === "MASTER_SUDAH_ADA" && e.statusCode === 409);
  await assert.rejects(() => buat(w, { kunci: "master-lain-0002" }), (e) => e.code === "MASTER_SUDAH_ADA" && e.statusCode === 409);
  await assert.rejects(() => buat(w, { kunci: "master-lain-0003", bahan: [{ ...dua()[0], code: "KAYU-UJI-LAIN" }] }), (e) => e.code === "NAMA_SUDAH_ADA", "nama sama tidak dibuat dua kali");
  assert.equal(await hitMaster(), 2); assert.equal(await hitTautan(), 2);
});

test("A8. serentak: pengamat snapshot REPEATABLE READ tidak pernah melihat master tanpa tautan, sementara evaluasi ulang dan pembuatan berjalan bersamaan; akhirnya semua catatan TERTAHAN, tanpa ISSUE", async () => {
  const w = await dunia(); const pelanggaran = []; let selesai = false;
  const pengamat = (async () => {
    while (!selesai) {
      const s = await testPrisma.$transaction(async (tx) => { const ms = await tx.material.findMany({ where: { code: { in: ["KAYU-UJI-2X6X200", "KAYU-UJI-2X5X200"] } }, select: { id: true, code: true } }); const t = ms.length ? await tx.activityEvent.count({ where: { entityType: "pernyataan_historis_so", eventType: "SO_DITAUTKAN", entityId: { in: ms.map((m) => m.id) } } }) : 0; const dipetakan = await tx.unitUsageNote.count({ where: { materialId: { in: ms.map((m) => m.id) } } }); return { m: ms.length, t, dipetakan }; }, { isolationLevel: "RepeatableRead" });
      if (s.m > 0 && s.t < s.m) pelanggaran.push(s); if (s.dipetakan > 0 && s.t < s.m) pelanggaran.push(s);
    }
  })();
  const evaluasi = (async () => { for (let i = 0; i < 12; i++) { await evaluasiUlang(testPrisma, {}); } })();
  const posting = (async () => { for (let i = 0; i < 6; i++) { const p = await rencanakanPosting(testPrisma); for (const t of p.transaksi.filter((x) => x.kodeBahan !== "P-CTL")) { pelanggaran.push({ posting: t.kodeBahan }); } } })();
  await Promise.all([buat(w), evaluasi, posting]); selesai = true; await pengamat;
  assert.deepEqual(pelanggaran, [], "tidak pernah ada master tanpa tautan atau catatan terpetakan tanpa tautan");
  const ms = await testPrisma.material.findMany({ where: { code: { in: ["KAYU-UJI-2X6X200", "KAYU-UJI-2X5X200"] } } }); for (const m of ms) await seedBalance(m.id, 20, { createdAt: WIB("2026-09-01"), unitCost: 30000 });
  await evaluasiUlang(testPrisma, {}); const d = await daftarPengaman(testPrisma); assert.equal(d.tertahan, 3); const p = await rencanakanPosting(testPrisma); assert.equal(p.tertahan.length, 3); assert.ok(p.transaksi.every((x) => x.kodeBahan === "P-CTL")); assert.equal(await issuesSemua(), 0);
});

test("A9. jalur HTTP: ADMIN 403; OWNER 201 lalu ulang 200; master dan tautan terbaca; catatan RING-style tanpa master lain tidak ikut terpetakan", async () => {
  const w = await dunia(); const badan = { bahan: dua(), soTanggal: HARI_INI, sumber: "KIRIM GILANG.xlsx (SO 4 Nov)", alasan: "Master baru bersama tautan SO untuk pengaman historis", rujukanHash: HASH };
  const h = { "Idempotency-Key": "http-master-0001" };
  const a = await w.ca.post("/api/production/posting-historis/pengaman/master-bertautan", badan, h); assert.equal(a.status, 403); assert.equal(await hitMaster(), 0);
  const o = await w.co.post("/api/production/posting-historis/pengaman/master-bertautan", badan, h); assert.equal(o.status, 201, JSON.stringify(o.body)); assert.equal(o.body.bahan.length, 2);
  const u = await w.co.post("/api/production/posting-historis/pengaman/master-bertautan", badan, h); assert.equal(u.status, 200); assert.equal(u.body.ulang, true);
  const tanpaKunci = await w.co.post("/api/production/posting-historis/pengaman/master-bertautan", badan); assert.equal(tanpaKunci.status, 428);
  assert.equal(await hitMaster(), 2); assert.equal(await hitTautan(), 2);
});

test("A10. KONTROL NEGATIF (jalur lama: buat master LALU tautkan): evaluasi di antaranya memetakan catatan dan rencana posting memuatnya TANPA pengaman — inilah celah yang ditutup A2/A3/A8", async () => {
  const w = await dunia();
  const m6 = await testPrisma.material.create({ data: { code: "KAYU-UJI-2X6X200", name: NAMA6, unit: "PCS", category: "RAW_MATERIAL" } });
  await seedBalance(m6.id, 20, { createdAt: WIB("2026-09-01"), unitCost: 30000 });
  await evaluasiUlang(testPrisma, {}); // jeda antara pembuatan dan tautan
  const p = await rencanakanPosting(testPrisma);
  assert.ok(p.transaksi.some((t) => t.kodeBahan === "KAYU-UJI-2X6X200"), "tanpa tautan atomik, catatan lama masuk rencana posting (celah nyata)");
  assert.equal(p.tertahan.length, 0); assert.ok(w.ctl);
});
