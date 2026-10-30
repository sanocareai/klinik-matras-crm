// D1 — koreksi catatan KILOAN yang salah berstatus BUKAN_STOK (aturan lama menangkap pola nama). Berizin, idempoten, berjejak; menahan catatan yang sudah punya keputusan/perubahan sejak audit;
// TIDAK membuat master/stok/penerimaan/harga/valuasi/jurnal; deploy kode saja tidak mengoreksi apa pun.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestUnit } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { rencanakanImpor, terapkanImpor, evaluasiUlang, keadaanEfektif, resetKeadaanEfektif } from "../../src/services/catatanPemakaianHistoris.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); resetKeadaanEfektif(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),Total Biaya Bahan (Rp),Foto,Catatan,Verifikasi,QC';
const baris = (no, order, nama, qty, sat) => `${no},${order},25 Sep 26,SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,Bahan Lapisan,${nama},,BAHAN,"${qty}",${sat},,,,,,QC OK`;
let seq = 0; const kunci = (t) => `d1-${t}-${Date.now().toString(36)}-${++seq}-aaaa`;

async function dunia() {
  const admin = await createTestUser({ roles: ["OWNER"] }); const adminBiasa = await createTestUser({ roles: ["ADMIN"] }); const gudang = await createTestUser({ roles: ["WAREHOUSE"] }); const sales = await createTestUser({ roles: ["SALES"] });
  const ordersNo = ["RES-24092026-801", "RES-24092026-802", "RES-24092026-803", "RES-24092026-804", "RES-24092026-805", "RES-24092026-806"];
  for (const no of ordersNo) { const { order } = await createTestUnit({ status: "DELIVERED" }); await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: no, status: "DELIVERED" } }); }
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akun = await testPrisma.finAccount.findFirst();
  const kat = await testPrisma.finPurchaseCategory.create({ data: { code: "UJI-D1", name: "Kategori Uji", accountId: akun.id } });
  await testPrisma.finPurchase.create({ data: { purchaseNumber: "PUR-23092026-035", date: new Date("2026-09-23"), amount: 1_680_000, description: "Memory foam kiloan", categoryId: kat.id, status: "DIBAYAR" } });
  const csv = ["JURNAL RINCIAN", "Data", HDR,
    baris(1, ordersNo[0], "MEMORY FOAM KILOAN", "4,0", "KG"), baris(2, ordersNo[1], "MEMORY FOAM KILOAN", "2,0", "KG"), baris(3, ordersNo[2], "MEMORY FOAM KILOAN", "2,0", "KG"), baris(4, ordersNo[3], "MEMORY FOAM KILOAN", "2,0", "KG"),
    baris(5, ordersNo[4], "BUSA LAMA", "1,0", "LEMBAR"), baris(6, ordersNo[5], "KAIN KILOAN LAMA", "3,0", "KG")].join("\n");
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: csv, namaBerkas: "d1.csv" }), {});
  // SIMULASI KEADAAN PRODUKSI: empat catatan KILOAN dulu di-BUKAN_STOK-kan oleh aturan lama (hanya peristiwa IMPOR, tanpa keputusan orang)
  const kil = await testPrisma.unitUsageNote.findMany({ where: { rawName: "MEMORY FOAM KILOAN" }, orderBy: { sourceRow: "asc" } });
  for (const n of kil) await testPrisma.unitUsageNote.update({ where: { id: n.id }, data: { state: "BUKAN_STOK", flags: [{ kode: "KOMPONEN_LAMA", tingkat: "INFO", teks: "Komponen lama dari kasur pelanggan, bukan stok Gudang.", aksi: "-", data: {} }] } });
  return { kil, a: makeClient(server.baseUrl, admin.token), g: makeClient(server.baseUrl, gudang.token), s: makeClient(server.baseUrl, sales.token), adm: makeClient(server.baseUrl, adminBiasa.token), admin: admin.user };
}
const R = "/api/production/catatan-historis/koreksi-kiloan";
const tabel = ["stock_movements", "fin_journal_entries", "fin_stock_movement_valuations", "material_harga_berlaku", "materials", "material_issues", "fin_inventory_openings", "goods_receipts", "stock_movement_biaya_operasional"];
const hitung = async () => Object.fromEntries(await Promise.all(tabel.map(async (t) => [t, Number((await testPrisma.$queryRawUnsafe(`select count(*)::int n from ${t}`))[0].n)])));
const snapLain = async (idsKecuali) => (await testPrisma.unitUsageNote.findMany({ where: { id: { notIn: idsKecuali } }, orderBy: { sourceKey: "asc" } })).map((n) => `${n.id}|${n.state}|${n.updatedAt.toISOString()}|${JSON.stringify(n.flags)}`).join("\n");

test("D1-1. deploy kode saja TIDAK mengoreksi: evaluasi ulang/keadaan efektif/impor ulang membiarkan 16 (di sini 4) catatan BUKAN_STOK dan tanpa peristiwa baru", async () => {
  const w = await dunia(); const ids = w.kil.map((n) => n.id);
  const e0 = await testPrisma.unitUsageNoteEvent.count();
  await evaluasiUlang(testPrisma, {}); resetKeadaanEfektif(); await keadaanEfektif(testPrisma);
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: ["JURNAL RINCIAN", "Data", HDR, baris(1, "RES-24092026-801", "MEMORY FOAM KILOAN", "4,0", "KG")].join("\n"), namaBerkas: "d1b.csv" }), {});
  const sesudah = await testPrisma.unitUsageNote.findMany({ where: { id: { in: ids } } });
  assert.ok(sesudah.every((n) => n.state === "BUKAN_STOK"), "tetap BUKAN_STOK tanpa koreksi D1"); assert.equal(await testPrisma.unitUsageNoteEvent.count(), e0, "tidak ada peristiwa baru");
});

test("D1-2. pratinjau baca-saja: memuat id + keadaan awal + sidik; komponen lama eksplisit (BUSA LAMA, KAIN KILOAN LAMA) TIDAK masuk; izin: Gudang boleh melihat, Sales tidak", async () => {
  const w = await dunia(); const n0 = await hitung(); const e0 = await testPrisma.unitUsageNoteEvent.count();
  const p = await w.a.get(`${R}/pratinjau`); assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.jumlah, 4); assert.equal(p.body.layak, 4); assert.equal(p.body.tertahan, 0); assert.equal(p.body.totalQty, 10);
  assert.deepEqual(p.body.manifest.map((m) => m.id).sort(), w.kil.map((n) => n.id).sort());
  const m = p.body.manifest[0]; assert.equal(m.keadaanAwal.state, "BUKAN_STOK"); assert.deepEqual(m.keadaanAwal.peristiwa, ["IMPOR"]); assert.match(m.sidik, /^[0-9a-f]{64}$/); assert.equal(m.keadaanAwal.materialId, null);
  assert.equal((await w.g.get(`${R}/pratinjau`)).status, 200, "Gudang (INVENTORY_READ) boleh melihat pratinjau"); assert.equal((await w.s.get(`${R}/pratinjau`)).status, 403);
  assert.deepEqual(await hitung(), n0); assert.equal(await testPrisma.unitUsageNoteEvent.count(), e0, "pratinjau tidak menulis");
});

test("D1-3. terapkan: izin persetujuan (OWNER/FINANCE) + Idempotency-Key + alasan wajib; hasil PERLU_DICEK dengan penanda yang SAMA seperti klasifikasi baru; peristiwa berjejak; tanpa master/stok/penerimaan/harga/valuasi/jurnal; catatan lain tak disentuh; ulang tanpa duplikat", async () => {
  const w = await dunia(); const ids = w.kil.map((n) => n.id); const p = (await w.a.get(`${R}/pratinjau`)).body; const manifest = p.manifest.map((m) => ({ id: m.id, sidik: m.sidik }));
  const alasan = "Salah diklasifikasi BUKAN_STOK hanya karena kata KILOAN; bahan dibeli per kg (PUR-23092026-035)";
  assert.equal((await w.g.post(`${R}/terapkan`, { manifest, alasan }, { "Idempotency-Key": kunci("g") })).status, 403, "Gudang tak boleh menerapkan"); assert.equal((await w.s.post(`${R}/terapkan`, { manifest, alasan }, { "Idempotency-Key": kunci("s") })).status, 403); assert.equal((await w.adm.post(`${R}/terapkan`, { manifest, alasan }, { "Idempotency-Key": kunci("adm") })).status, 403, "ADMIN biasa tanpa izin persetujuan (hanya OWNER/FINANCE)");
  assert.equal((await w.a.post(`${R}/terapkan`, { manifest, alasan })).status, 428, "tanpa Idempotency-Key"); assert.equal((await w.a.post(`${R}/terapkan`, { manifest, alasan: "pendek" }, { "Idempotency-Key": kunci("p") })).status, 400, "alasan wajib");
  assert.equal((await w.a.post(`${R}/terapkan`, { manifest: [], alasan }, { "Idempotency-Key": kunci("m") })).status, 400, "manifest wajib");
  const n0 = await hitung(); const lainSebelum = await snapLain(ids); const e0 = await testPrisma.unitUsageNoteEvent.count(); const k = kunci("ok");
  const r = await w.a.post(`${R}/terapkan`, { manifest, alasan }, { "Idempotency-Key": k }); assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.ringkas, { diminta: 4, dikoreksi: 4, ulang: 0, ditahan: 0 });
  const sesudah = await testPrisma.unitUsageNote.findMany({ where: { id: { in: ids } }, orderBy: { sourceRow: "asc" } });
  for (const n of sesudah) { assert.equal(n.state, "PERLU_DICEK"); assert.deepEqual((n.flags ?? []).map((f) => f.kode).sort(), ["ASAL_PEMBELIAN_BERTULIS", "NAMA_TIDAK_DI_KATALOG"]); assert.equal(n.materialId, null); assert.equal(n.stockMovementId, null); assert.equal(n.rawName, "MEMORY FOAM KILOAN"); }
  // peristiwa tambahan berjejak
  assert.equal(await testPrisma.unitUsageNoteEvent.count(), e0 + 4);
  const ev = await testPrisma.unitUsageNoteEvent.findFirst({ where: { noteId: ids[0], kind: "DIKOREKSI" } });
  assert.equal(ev.reason, alasan); assert.equal(ev.actorId, w.admin.id); assert.equal(ev.idempotencyKey, `${k}:${ids[0]}`); assert.equal(ev.before.state, "BUKAN_STOK"); assert.deepEqual(ev.before.flags, ["KOMPONEN_LAMA"]); assert.match(ev.before.sidik, /^[0-9a-f]{64}$/);
  assert.equal(ev.after.state, "PERLU_DICEK"); assert.ok(ev.after.flags.includes("ASAL_PEMBELIAN_BERTULIS")); assert.equal(ev.after.buktiAsal[0].nomor, "PUR-23092026-035"); assert.match(ev.after.catatanBukti, /bukan bukti berat/);
  // tanpa efek samping lain
  assert.deepEqual(await hitung(), n0, "tidak ada master/stok/penerimaan/harga/valuasi/jurnal baru"); assert.equal(await snapLain(ids), lainSebelum, "catatan lain (BUSA LAMA, KAIN KILOAN LAMA, dst.) tidak disentuh");
  // ulang: kunci sama → tidak ada peristiwa baru; kunci lain → ditahan karena bukan lagi BUKAN_STOK
  const e1 = await testPrisma.unitUsageNoteEvent.count();
  const u1 = await w.a.post(`${R}/terapkan`, { manifest, alasan }, { "Idempotency-Key": k }); assert.equal(u1.status, 200); assert.deepEqual(u1.body.ringkas, { diminta: 4, dikoreksi: 0, ulang: 4, ditahan: 0 });
  const u2 = await w.a.post(`${R}/terapkan`, { manifest, alasan }, { "Idempotency-Key": kunci("lain") }); assert.equal(u2.status, 200); assert.equal(u2.body.ringkas.ditahan, 4); assert.ok(u2.body.ditahan.every((x) => x.kode === "BUKAN_LAGI_BUKAN_STOK"));
  assert.equal(await testPrisma.unitUsageNoteEvent.count(), e1, "tanpa duplikat");
  // tidak berbalik-balik: evaluasi ulang sesudah D1 tidak mengubah catatan itu lagi
  const ev0 = await testPrisma.unitUsageNoteEvent.count({ where: { noteId: { in: ids }, kind: "DIEVALUASI" } }); await evaluasiUlang(testPrisma, {});
  assert.equal(await testPrisma.unitUsageNoteEvent.count({ where: { noteId: { in: ids }, kind: "DIEVALUASI" } }), ev0, "keadaan hasil D1 stabil terhadap evaluasi ulang");
});

test("D1-4. catatan yang sudah punya keputusan atau berubah SEJAK AUDIT ditahan; yang lain tetap dikoreksi", async () => {
  const w = await dunia(); const p = (await w.a.get(`${R}/pratinjau`)).body; const manifest = p.manifest.map((m) => ({ id: m.id, sidik: m.sidik }));
  const [n1, n2, n3, n4] = w.kil;
  await testPrisma.unitUsageNoteEvent.create({ data: { noteId: n2.id, kind: "DIKECUALIKAN", reason: "Dikecualikan oleh Admin Sales sesudah audit", actorId: w.admin.id, before: {}, after: {} } }); // keputusan baru
  await testPrisma.unitUsageNote.update({ where: { id: n3.id }, data: { evaluatedAt: new Date() } }); // perubahan sejak audit (updatedAt/evaluatedAt berubah → sidik beda)
  const alasan = "Koreksi klasifikasi KILOAN oleh Admin; bahan dibeli per kg"; const r = await w.a.post(`${R}/terapkan`, { manifest, alasan }, { "Idempotency-Key": kunci("t") });
  assert.equal(r.status, 201); assert.deepEqual(r.body.ringkas, { diminta: 4, dikoreksi: 2, ulang: 0, ditahan: 2 });
  const tahan = Object.fromEntries(r.body.ditahan.map((x) => [x.id, x.kode])); assert.equal(tahan[n2.id], "ADA_KEPUTUSAN_ATAU_PERUBAHAN"); assert.equal(tahan[n3.id], "BERUBAH_SEJAK_AUDIT");
  const st = Object.fromEntries((await testPrisma.unitUsageNote.findMany({ where: { id: { in: w.kil.map((n) => n.id) } } })).map((n) => [n.id, n.state]));
  assert.equal(st[n1.id], "PERLU_DICEK"); assert.equal(st[n4.id], "PERLU_DICEK"); assert.equal(st[n2.id], "BUKAN_STOK"); assert.equal(st[n3.id], "BUKAN_STOK");
});

test("D1-5. id di luar kandidat (BUSA LAMA / KAIN KILOAN LAMA = komponen lama eksplisit) tidak bisa dikoreksi lewat manifest buatan; sidik palsu ditahan", async () => {
  const w = await dunia(); const lama = await testPrisma.unitUsageNote.findMany({ where: { rawName: { in: ["BUSA LAMA", "KAIN KILOAN LAMA"] } } }); assert.equal(lama.length, 2); assert.ok(lama.every((n) => n.state === "BUKAN_STOK"));
  const palsu = [...lama.map((n) => ({ id: n.id, sidik: "0".repeat(64) })), { id: w.kil[0].id, sidik: "f".repeat(64) }];
  const r = await w.a.post(`${R}/terapkan`, { manifest: palsu, alasan: "Percobaan manifest palsu untuk uji penahan" }, { "Idempotency-Key": kunci("x") });
  assert.equal(r.status, 200); assert.equal(r.body.ringkas.dikoreksi, 0); assert.equal(r.body.ringkas.ditahan, 3);
  assert.deepEqual(r.body.ditahan.filter((x) => lama.some((n) => n.id === x.id)).map((x) => x.kode), ["BUKAN_KANDIDAT", "BUKAN_KANDIDAT"]); assert.equal(r.body.ditahan.find((x) => x.id === w.kil[0].id).kode, "BERUBAH_SEJAK_AUDIT");
  assert.ok((await testPrisma.unitUsageNote.findMany({ where: { id: { in: [...lama.map((n) => n.id), w.kil[0].id] } } })).every((n) => n.state === "BUKAN_STOK"));
});
