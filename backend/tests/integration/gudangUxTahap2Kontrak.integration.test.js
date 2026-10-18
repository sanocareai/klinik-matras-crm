// UX GUDANG TAHAP 2 — penutup rilis: (1) stok kurang diperingatkan di Draf tetapi Konfirmasi keluar/Kirim menolak SECARA ATOMIK (termasuk dua transaksi bersamaan, multi-baris, lintas MI+ST);
// (2) kontrak API lama tetap jalan (klien tanpa `revisi`), kewajiban `alasanSelisih`, retry 200, konflik 409 berpesan jelas; (3) angka transfer: kirim, terima sebagian, ditemukan, susut tidak menghitung stok dua kali
// dan susut tidak membuat jurnal/valuasi/ISSUE. DB terisolasi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server; let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const MI = "/api/inventory/material-issues"; const ST = "/api/inventory/transfers";
async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const [a, b, lead] = await Promise.all(["WAREHOUSE", "WAREHOUSE", "PRODUCTION_LEAD"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const wh = await testPrisma.warehouse.create({ data: { code: `WH-KT-${++seq}`, name: "Gudang KT" } });
  const loc = (zone, locationType) => testPrisma.storageLocation.create({ data: { warehouseId: wh.id, zone, locationType, code: `${zone}-KT-${++seq}` } });
  const asal = await loc("RM", "RAW_MATERIAL_AREA"); const tujuan = await loc("WIP", "WIP_AREA");
  const busa = await createTestMaterial({ name: "Busa KT" }); const kain = await createTestMaterial({ name: "Kain KT" });
  await seedBalance(busa.id, 50); await seedBalance(kain.id, 20);
  return { g: c(a), g2: c(b), p: c(lead), asal, tujuan, busa, kain };
}
const stok = async (id) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: id }, _sum: { qty: true } }))._sum.qty ?? 0);
const mov = () => testPrisma.stockMovement.count(); const jurnal = () => testPrisma.finJournalEntry.count(); const valuasi = () => testPrisma.finStockMovementValuation.count();
const ambil = async (w, base, id) => (await w.g.get(`${base}/${id}`)).body;
const maju = async (w, base, id, ...ss) => { for (const s of ss) { const r = await w.g.patch(`${base}/${id}`, { status: s, revisi: (await ambil(w, base, id)).revisi }); assert.equal(r.status, 200, JSON.stringify(r.body)); } };
const buatMI = async (w, lines) => { const r = await w.g.post(MI, { sourceType: "MANUAL", department: "Produksi", lines }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; };
const siapkanMI = async (w, lines) => { const mi = await buatMI(w, lines); await maju(w, MI, mi.id, "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"); return mi; };
const buatST = async (w, lines) => { const r = await w.g.post(ST, { transferType: "ZONE_TO_ZONE", sourceLocationId: w.asal.id, destinationLocationId: w.tujuan.id, lines }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; };
const siapkanST = async (w, lines) => { const st = await buatST(w, lines); await maju(w, ST, st.id, "WAITING_APPROVAL", "APPROVED", "PICKED"); return st; };

test("stok kurang: Draf hanya diperingatkan; Konfirmasi keluar menolak (400, pesan jelas) dan multi-baris GAGAL UTUH — tanpa pergerakan, jurnal, valuasi, atau jumlah keluar tertulis", async () => {
  const w = await dunia();
  const draf = await buatMI(w, [{ materialId: w.busa.id, requestedQty: 500 }]); const d = await ambil(w, MI, draf.id);
  assert.equal(d.ketersediaan[0].cukup, false); assert.equal(d.status, "DRAFT");
  const baris = [{ materialId: w.busa.id, requestedQty: 10 }, { materialId: w.kain.id, requestedQty: 15 }];
  const mi = await siapkanMI(w, baris);
  await seedBalance(w.kain.id, -12); // fisik berkurang setelah dokumen disiapkan (mis. pemakaian jalur lain): kain 8, diminta 15
  const awal = { mov: await mov(), j: await jurnal(), v: await valuasi(), busa: await stok(w.busa.id), kain: await stok(w.kain.id) };
  const r = await w.g.post(`${MI}/${mi.id}/issue`, {}); assert.equal(r.status, 400); assert.match(r.body.error, /tidak cukup — tersedia 8, butuh 15/);
  assert.equal(await mov(), awal.mov); assert.equal(await jurnal(), awal.j); assert.equal(await valuasi(), awal.v); assert.equal(await stok(w.busa.id), awal.busa, "baris pertama (cukup) TIDAK ikut keluar");
  const sesudah = await testPrisma.materialIssue.findUnique({ where: { id: mi.id }, include: { lines: true } }); assert.equal(sesudah.status, "PICKED"); assert.ok(sesudah.lines.every((l) => l.issuedQty == null), "jumlah keluar tidak tertulis");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: mi.id, eventType: "DOCUMENT_POSTED" } }), 0);
  // jumlah keluar yang dioverride melebihi saldo juga ditolak; jumlah yang cukup lolos
  const lb = sesudah.lines.find((l) => l.materialId === w.busa.id); const lk = sesudah.lines.find((l) => l.materialId === w.kain.id);
  const lebih = await w.g.post(`${MI}/${mi.id}/issue`, { lines: [{ lineId: lb.id, issuedQty: 10 }, { lineId: lk.id, issuedQty: 9 }] }); assert.equal(lebih.status, 400);
  const ok = await w.g.post(`${MI}/${mi.id}/issue`, { lines: [{ lineId: lb.id, issuedQty: 10 }, { lineId: lk.id, issuedQty: 8 }] }); assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await stok(w.busa.id), awal.busa - 10); assert.equal(await stok(w.kain.id), 0);
});

test("dua Konfirmasi keluar bersamaan atas stok yang hanya cukup untuk satu: tepat satu berhasil, saldo tidak pernah minus, tidak ada pergerakan dari yang gagal", async () => {
  const w = await dunia();
  const a = await siapkanMI(w, [{ materialId: w.busa.id, requestedQty: 30 }]); const b = await siapkanMI(w, [{ materialId: w.busa.id, requestedQty: 30 }]);
  const [ra, rb] = await Promise.all([w.g.post(`${MI}/${a.id}/issue`, {}), w.g2.post(`${MI}/${b.id}/issue`, {})]);
  assert.deepEqual([ra.status, rb.status].sort(), [200, 400], JSON.stringify([ra.body, rb.body])); assert.match((ra.status === 400 ? ra : rb).body.error, /tidak cukup/);
  assert.equal(await stok(w.busa.id), 20); assert.equal(await testPrisma.stockMovement.count({ where: { materialId: w.busa.id, type: "ISSUE" } }), 1);
  const gagal = ra.status === 400 ? a : b; assert.equal((await testPrisma.materialIssue.findUnique({ where: { id: gagal.id } })).status, "PICKED", "yang kalah tetap Sudah diambil, bisa dicoba lagi/dibatalkan");
});

test("dua Kirim barang bersamaan atas stok yang hanya cukup untuk satu; dan Konfirmasi keluar + Kirim bersamaan lintas dokumen pada bahan yang sama — saldo tidak minus", async () => {
  const w = await dunia();
  const a = await siapkanST(w, [{ materialId: w.busa.id, qtySent: 30 }]); const b = await siapkanST(w, [{ materialId: w.busa.id, qtySent: 30 }]);
  const [ra, rb] = await Promise.all([w.g.post(`${ST}/${a.id}/dispatch`, {}), w.g2.post(`${ST}/${b.id}/dispatch`, {})]);
  assert.deepEqual([ra.status, rb.status].sort(), [200, 400], JSON.stringify([ra.body, rb.body])); assert.equal(await stok(w.busa.id), 20);
  assert.equal(await testPrisma.stockMovement.count({ where: { materialId: w.busa.id, type: "TRANSFER" } }), 1);
  const gagal = ra.status === 400 ? a : b; assert.equal((await testPrisma.stockTransfer.findUnique({ where: { id: gagal.id } })).status, "PICKED");
  // lintas dokumen: sisa 20; MI 15 + ST 15 bersamaan → satu menang
  const mi = await siapkanMI(w, [{ materialId: w.busa.id, requestedQty: 15 }]); const st = await siapkanST(w, [{ materialId: w.busa.id, qtySent: 15 }]);
  const [rm, rs] = await Promise.all([w.g.post(`${MI}/${mi.id}/issue`, {}), w.g2.post(`${ST}/${st.id}/dispatch`, {})]);
  assert.deepEqual([rm.status, rs.status].sort(), [200, 400], JSON.stringify([rm.body, rs.body])); assert.equal(await stok(w.busa.id), 5); assert.ok((await stok(w.busa.id)) >= 0);
});

test("angka transfer: kirim 8 → terima 6 → ditemukan 1 → susut 1: stok dihitung sekali (50−8+6+1=49); susut TANPA pergerakan/jurnal/valuasi/ISSUE; saldo perjalanan konsisten", async () => {
  const w = await dunia(); const st = await siapkanST(w, [{ materialId: w.busa.id, qtySent: 8 }]);
  const awal = { saldo: await stok(w.busa.id), mov: await mov(), j: await jurnal(), v: await valuasi() }; assert.equal(awal.saldo, 50);
  assert.equal((await w.g.post(`${ST}/${st.id}/dispatch`, {})).status, 200); assert.equal(await stok(w.busa.id), 42);
  let d = await ambil(w, ST, st.id); let sp = d.saldoPerjalanan[0]; assert.deepEqual([sp.sebelumKirim, sp.dikirim, sp.diterima, sp.sekarang], [50, 8, null, 42]);
  const baris = d.lines[0]; assert.equal((await w.g.post(`${ST}/${st.id}/receive`, { lines: [{ lineId: baris.id, qtyReceived: 6 }], alasanSelisih: "Dua lembar rusak di jalan" })).status, 200);
  assert.equal(await stok(w.busa.id), 48); d = await ambil(w, ST, st.id); sp = d.saldoPerjalanan[0]; assert.deepEqual([sp.sebelumKirim, sp.dikirim, sp.diterima, sp.ditemukan, sp.sekarang], [50, 8, 6, 0, 48]); assert.equal(d.selisih[0].kurang, 2);
  const K = () => `kunci-${randomUUID()}`;
  const f = await w.g.post(`${ST}/${st.id}/selisih`, { lineId: baris.id, jenis: "DITEMUKAN", qty: 1, alasan: "Ditemukan di mobil", kunci: K() }); assert.equal(f.status, 200, JSON.stringify(f.body));
  assert.equal(await stok(w.busa.id), 49); const mSetelahTemu = await mov();
  const s = await w.g.post(`${ST}/${st.id}/selisih`, { lineId: baris.id, jenis: "SUSUT", qty: 1, alasan: "Basah, dibuang", kunci: K() }); assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(await stok(w.busa.id), 49, "susut TIDAK mengubah saldo lagi (sudah berkurang saat kirim)"); assert.equal(await mov(), mSetelahTemu, "susut tanpa pergerakan stok");
  d = await ambil(w, ST, st.id); sp = d.saldoPerjalanan[0]; assert.deepEqual([sp.sebelumKirim, sp.dikirim, sp.diterima, sp.ditemukan, sp.sekarang], [50, 8, 6, 1, 49]);
  assert.equal(d.selisih[0].sisa, 0); assert.equal(d.selisih[0].diselesaikan, 2); assert.equal(d.tampilan.selisihTerbuka, 0);
  // identitas: saldo akhir = awal − dikirim + diterima + ditemukan; tiga pergerakan bertaut (−8, +6, +1), tidak ada lagi
  const bertaut = await testPrisma.stockMovement.findMany({ where: { stockTransferId: st.id }, orderBy: { createdAt: "asc" } }); assert.deepEqual(bertaut.map((m) => Number(m.qty)), [-8, 6, 1]);
  assert.equal(await stok(w.busa.id), awal.saldo - 8 + 6 + 1); assert.equal(await mov(), awal.mov + 3);
  assert.equal(await jurnal(), awal.j, "tidak ada jurnal otomatis (kerugian susut belum dicatat Finance)"); assert.equal(await valuasi(), awal.v, "tidak ada valuasi/HPP baru");
  assert.equal(await testPrisma.stockMovement.count({ where: { stockTransferId: st.id, OR: [{ type: "ISSUE" }, { unitId: { not: null } }] } }), 0, "bukan pemakaian produksi");
  assert.ok(d.jejak.some((j) => j.aksi === "SELISIH_DISELESAIKAN" && /pencatatan Finance belum dilakukan/.test(j.teks)), "jejak susut menyatakan Finance belum mencatat");
  assert.ok(d.jejak.some((j) => j.aksi === "SELISIH_DISELESAIKAN" && /saldo total bahan ditambah/.test(j.teks)), "label ditemukan memakai saldo TOTAL, bukan 'saldo tujuan'");
  // tidak bisa menyelesaikan lebih dari selisih (dua kali) walau jenis lain
  assert.equal((await w.g.post(`${ST}/${st.id}/selisih`, { lineId: baris.id, jenis: "DITEMUKAN", qty: 1, alasan: "lagi", kunci: K() })).body.kode, "MELEBIHI_SISA");
  assert.equal(await stok(w.busa.id), 49);
});

test("kontrak lama tetap jalan: klien tanpa `revisi`/`alasanSelisih` untuk alur normal; receive penuh tanpa selisih tidak perlu alasan; retry = 200 ulang:true; payload berbeda & alasan wajib = pesan jelas", async () => {
  const w = await dunia();
  // klien lama: PATCH status tanpa revisi, issue tanpa body, cancel tanpa revisi
  const mi = await buatMI(w, [{ materialId: w.busa.id, requestedQty: 5 }]);
  for (const s of ["WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"]) assert.equal((await w.g.patch(`${MI}/${mi.id}`, { status: s })).status, 200, s);
  assert.equal((await w.g.post(`${MI}/${mi.id}/issue`, {})).status, 200); const r2 = await w.g.post(`${MI}/${mi.id}/issue`, {}); assert.equal(r2.status, 200); assert.equal(r2.body.ulang, true);
  const st = await buatST(w, [{ materialId: w.busa.id, qtySent: 4 }]); for (const s of ["WAITING_APPROVAL", "APPROVED", "PICKED"]) assert.equal((await w.g.patch(`${ST}/${st.id}`, { status: s })).status, 200, s);
  assert.equal((await w.g.post(`${ST}/${st.id}/dispatch`, {})).status, 200); const rc = await w.g.post(`${ST}/${st.id}/receive`, {}); assert.equal(rc.status, 200, "receive penuh tanpa alasan"); assert.equal(rc.body.ulang ?? false, false);
  const rc2 = await w.g.post(`${ST}/${st.id}/receive`, {}); assert.equal(rc2.status, 200); assert.equal(rc2.body.ulang, true);
  // klien lama yang menerima sebagian tanpa alasan: 400 berpesan jelas + kode, TANPA efek
  const st2 = await siapkanST(w, [{ materialId: w.kain.id, qtySent: 4 }]); await w.g.post(`${ST}/${st2.id}/dispatch`, {}); const l2 = (await ambil(w, ST, st2.id)).lines[0]; const m0 = await mov();
  const tanpa = await w.g.post(`${ST}/${st2.id}/receive`, { lines: [{ lineId: l2.id, qtyReceived: 3 }] }); assert.equal(tanpa.status, 400); assert.equal(tanpa.body.kode, "ALASAN_TIDAK_VALID"); assert.match(tanpa.body.error, /Penyebab selisih wajib diisi/); assert.equal(await mov(), m0); assert.equal((await testPrisma.stockTransfer.findUnique({ where: { id: st2.id } })).status, "IN_TRANSIT");
  // lebih dari yang dikirim juga wajib bersebab
  assert.equal((await w.g.post(`${ST}/${st2.id}/receive`, { lines: [{ lineId: l2.id, qtyReceived: 5 }] })).status, 400);
  // 409 berpesan jelas & berkode
  const ok3 = await w.g.post(`${ST}/${st2.id}/receive`, { lines: [{ lineId: l2.id, qtyReceived: 3 }], alasanSelisih: "Hitung ulang di tujuan" }); assert.equal(ok3.status, 200);
  const k = await w.g.post(`${ST}/${st2.id}/receive`, { lines: [{ lineId: l2.id, qtyReceived: 4 }] }); assert.equal(k.status, 409); assert.equal(k.body.kode, "KONFLIK_PAYLOAD"); assert.match(k.body.error, /sudah diterima dengan jumlah yang berbeda/);
  assert.equal(await stok(w.kain.id), 20 - 4 + 3);
  const mi2 = await siapkanMI(w, [{ materialId: w.busa.id, requestedQty: 3 }]); const dm = await ambil(w, MI, mi2.id); const lm = dm.lines[0];
  assert.equal((await w.g.post(`${MI}/${mi2.id}/issue`, { lines: [{ lineId: lm.id, issuedQty: 3 }] })).status, 200);
  const km = await w.g.post(`${MI}/${mi2.id}/issue`, { lines: [{ lineId: lm.id, issuedQty: 2 }] }); assert.equal(km.status, 409); assert.equal(km.body.kode, "KONFLIK_PAYLOAD"); assert.match(km.body.error, /sudah dikeluarkan dengan jumlah yang berbeda/);
  const rv = await w.g.patch(`${MI}/${(await buatMI(w, [{ materialId: w.busa.id, requestedQty: 1 }])).id}`, { status: "WAITING_APPROVAL", revisi: "2000-01-01T00:00:00.000Z" }); assert.equal(rv.status, 409); assert.equal(rv.body.kode, "REVISI_BASI"); assert.match(rv.body.error, /sudah diubah sejak Anda membukanya/);
});

test("dampak ke Finance & dokumen lain: Kembalikan/Ubah isi/Selisih tidak membuat jurnal/valuasi; Konfirmasi keluar tetap satu jurnal HPP; koreksi dokumen tidak tersentuh", async () => {
  const w = await dunia(); const j0 = await jurnal(); const k0 = await testPrisma.warehouseCorrection.count();
  const mi = await siapkanMI(w, [{ materialId: w.busa.id, requestedQty: 5 }]);
  const r = await w.g.post(`${MI}/${mi.id}/kembalikan`, { alasan: "Salah ambil", revisi: (await ambil(w, MI, mi.id)).revisi }); assert.equal(r.status, 200);
  const dd = await ambil(w, MI, mi.id); assert.equal((await w.g.put(`${MI}/${mi.id}/isi`, { revisi: dd.revisi, lines: [{ materialId: w.busa.id, requestedQty: 6 }] })).status, 200);
  assert.equal(await jurnal(), j0); assert.equal(await testPrisma.warehouseCorrection.count(), k0); assert.equal(await stok(w.busa.id), 50);
  await maju(w, MI, mi.id, "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"); assert.equal((await w.g.post(`${MI}/${mi.id}/issue`, {})).status, 200);
  assert.equal(await stok(w.busa.id), 44); assert.equal(await testPrisma.stockMovement.count({ where: { materialIssueId: mi.id } }), 1); assert.equal(await testPrisma.warehouseCorrection.count(), k0);
});
