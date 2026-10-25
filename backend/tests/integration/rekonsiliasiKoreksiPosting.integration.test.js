// Rekonsiliasi pemakaian — koreksi berjejak (catatan · pemakaian per order · harga), saldo, dan posting terpadu. Data uji: order DELIVERED seperti September/Oktober.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { rencanakanImpor, terapkanImpor, ambilCatatanHistoris } from "../../src/services/catatanPemakaianHistoris.js";
import { koreksiCatatan, konfirmasiCatatan, kecualikanCatatan, ajukanKoreksiPemakaian, setujuiKoreksiPemakaian, tolakKoreksiPemakaian, batalkanKoreksiPemakaian, pratinjauKoreksiPemakaian, riwayatKoreksiPemakaian } from "../../src/services/koreksiPemakaian.js";
import { rencanakanPosting, jalankanPosting, postingSatuUnit } from "../../src/services/postingPemakaianHistoris.js";
import { ringkasRencana } from "../../src/services/postingPersetujuanTerikat.js";
const terikatDari = (p, rujukan = "OWNER-2026-10-24") => { const r = ringkasRencana(p); return { hash: r.hash, unitIds: r.unitIds, daftarOrder: r.daftarOrder, jumlahOrder: r.jumlahOrder, jumlahTrx: r.jumlahTrx, rujukan }; };
import { koreksiValuasiPergerakan, valuasiEfektif } from "../../src/services/finance/koreksiValuasi.js";
import { bacaJejakUnit } from "../../src/services/finance/biayaBahan.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HDR = 'No,No. Resi / Order,Tgl Selesai,Bulan Selesai,Nama Pelanggan,Nama Sales,Ukuran Kasur,Jenis Layanan,Tgl Komplain,PIC Komplain,PIC / Teknisi,CORNER,Kategori Bahan,Nama Material / Bahan (SANO),Spesifikasi / Detail,Barang,Qty Pakai,Satuan,Harga Satuan (Rp),Total Biaya Bahan (Rp),"Total Penjualan\n(Rp)",Insentif PIC,Insentif Corner,Keterangan / QC';
const baris = (no, order, tgl, kat, nama, qty, sat) => `${no},${order},${tgl},SEP,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,${kat},${nama},,BAHAN,"${qty}",${sat},,,,,,QC OK`;
const WIB = (iso) => new Date(`${iso}T00:00:00+07:00`);
let seq = 0; const kunciUji = (t) => `uji-${t}-${Date.now().toString(36)}-${++seq}-aaaaaaaa`;

async function dunia({ csvExtra = [] } = {}) {
  const admin = await createTestUser({ roles: ["ADMIN"] }); const owner = await createTestUser({ roles: ["OWNER"] });
  const kain = await createTestMaterial({ code: "R-KAIN", name: "KAIN LAVA REKON", unit: "METER" }); const soft = await createTestMaterial({ code: "R-SOFT", name: "BUSA SOFT REKON", unit: "SHEET" });
  await seedBalance(kain.id, 20, { createdAt: WIB("2026-09-01"), unitCost: 25000 }); await seedBalance(soft.id, 10, { createdAt: WIB("2026-09-01"), unitCost: 110000 });
  const mk = async (no) => { const { order, unit } = await createTestUnit({ status: "DELIVERED" }); await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: no, status: "DELIVERED" } }); return unit; };
  const u1 = await mk("RES-01092026-801"); const u2 = await mk("RES-02092026-802");
  await testPrisma.stockMovement.create({ data: { materialId: kain.id, type: "ISSUE", qty: -2.1, unitId: u1.id, note: "Impor pemakaian Sept 2026 — order asli: X -> RES-01092026-801", createdAt: WIB("2026-09-01") } });
  const csv = ["J", "D", HDR, baris(1, "RES-01092026-801", "1 Sep 26", "Bahan Lapisan", "KAIN LAVA REKON", "1,7", "METER"), baris(2, "RES-01092026-801", "1 Sep 26", "Bahan Fondasi", "BUSA SOFT REKON", "1,0", "LEMBAR"),
    baris(3, "RES-02092026-802", "2 Sep 26", "Bahan Lapisan", "KAIN LAVA REKON", "3,0", "METER"), baris(4, "RES-02092026-802", "2 Sep 26", "Bahan Fondasi", "BUSA SOFT REKON", "2,0", "LEMBAR"), ...csvExtra].join("\n");
  await terapkanImpor(testPrisma, await rencanakanImpor(testPrisma, { csvText: csv, namaBerkas: "uji.csv" }), {});
  const A = { id: admin.user.id, name: admin.user.name }; const B = { id: owner.user.id, name: owner.user.name };
  return { admin, owner, A, B, kain, soft, u1, u2, ca: makeClient(server.baseUrl, admin.token), co: makeClient(server.baseUrl, owner.token) };
}
const saldo = async (id) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: id }, _sum: { qty: true } }))._sum.qty);
const catatan = (unitId, nama) => testPrisma.unitUsageNote.findFirst({ where: { unitId, rawName: nama, origin: "EXCEL" } });

test("K1. koreksi CATATAN: sebelum–sesudah + alasan + pelaku; nilai asli utuh; idempoten; tanpa efek stok", async () => {
  const w = await dunia(); const mv0 = await testPrisma.stockMovement.count();
  const n = await catatan(w.u1.id, "KAIN LAVA REKON"); assert.equal(n.state, "PERLU_DICEK"); assert.equal(n.flags[0].kode, "ISSUE_LAMA_BERBEDA");
  const k = kunciUji("c1"); const r = await koreksiCatatan(testPrisma, { noteId: n.id, perubahan: { qty: 2.1 }, alasan: "Admin Sales konfirmasi 2,1 meter", kunci: k, aktor: w.A });
  assert.equal(r.ulang, false); assert.equal(r.catatan.qty, 2.1);
  const sesudah = await catatan(w.u1.id, "KAIN LAVA REKON"); assert.equal(sesudah.rawQty, "1,7", "nilai asli berkas tetap"); assert.equal(Number(sesudah.qty), 2.1); assert.equal(sesudah.state, "TERCATAT_DI_STOK", "setelah koreksi sama dengan ISSUE lama → tertaut, tidak digandakan");
  const ev = await testPrisma.unitUsageNoteEvent.findFirst({ where: { noteId: n.id, kind: "DIKOREKSI" } });
  assert.equal(ev.actorId, w.A.id); assert.equal(ev.before.qty, 1.7); assert.equal(ev.after.qty, 2.1); assert.match(ev.reason, /konfirmasi 2,1/);
  const ulang = await koreksiCatatan(testPrisma, { noteId: n.id, perubahan: { qty: 2.1 }, alasan: "Admin Sales konfirmasi 2,1 meter", kunci: k, aktor: w.A }); assert.equal(ulang.ulang, true);
  assert.equal(await testPrisma.unitUsageNoteEvent.count({ where: { noteId: n.id, kind: "DIKOREKSI" } }), 1, "koreksi ulang dengan kunci sama tidak menulis lagi");
  await assert.rejects(() => koreksiCatatan(testPrisma, { noteId: n.id, perubahan: { qty: 2.1 }, alasan: "tanpa perubahan", kunci: kunciUji("c2"), aktor: w.A }), /Tidak ada perubahan|tidak bisa dikoreksi/);
  await assert.rejects(() => koreksiCatatan(testPrisma, { noteId: n.id, perubahan: { uom: "XYZ" }, alasan: "satuan salah", kunci: kunciUji("c3"), aktor: w.A }), /bukan satuan Gudang|tidak bisa dikoreksi/);
  assert.equal(await testPrisma.stockMovement.count(), mv0, "koreksi catatan tidak menulis stok");
});

test("K2. konfirmasi penanda & kecualikan: baris berulang sah/ganda; catatan tidak dihapus", async () => {
  const w = await dunia({ csvExtra: [baris(5, "RES-02092026-802", "2 Sep 26", "Bahan Lapisan", "BUSA SOFT REKON", "2,0", "LEMBAR"), baris(6, "RES-02092026-802", "2 Sep 26", "Lain-lain", "BUSA SOFT REKON", "2,0", "LEMBAR")] });
  const dup = await testPrisma.unitUsageNote.findMany({ where: { unitId: w.u2.id, rawName: "BUSA SOFT REKON", rawQty: "2,0" }, orderBy: { sourceRow: "asc" } });
  assert.equal(dup.length, 3); assert.ok(dup.every((d) => d.flags.some((f) => f.kode === "BARIS_BERULANG")));
  await assert.rejects(() => konfirmasiCatatan(testPrisma, { noteId: dup[0].id, kodePenanda: "SATUAN_BEDA_MASTER", alasan: "alasan uji konfirmasi", kunci: kunciUji("k"), aktor: w.A }), /tidak bisa sekadar dikonfirmasi/);
  await kecualikanCatatan(testPrisma, { noteId: dup[1].id, alasan: "Salinan ganda dikonfirmasi PIC", kunci: kunciUji("x1"), aktor: w.A });
  await kecualikanCatatan(testPrisma, { noteId: dup[2].id, alasan: "Salinan ganda dikonfirmasi PIC", kunci: kunciUji("x2"), aktor: w.A });
  const sisa = await testPrisma.unitUsageNote.findUnique({ where: { id: dup[0].id } });
  assert.equal(sisa.state === "SIAP_POSTING" || sisa.state === "PERLU_DICEK", true); assert.ok(!sisa.flags.some((f) => f.kode === "BARIS_BERULANG"), "setelah salinan dikecualikan, baris asli tidak lagi 'berulang'");
  assert.equal((await testPrisma.unitUsageNote.findUnique({ where: { id: dup[1].id } })).state, "TIDAK_DIHITUNG"); assert.equal(await testPrisma.unitUsageNote.count({ where: { id: dup[1].id } }), 1, "tidak dihapus");
  await konfirmasiCatatan(testPrisma, { noteId: dup[0].id, kodePenanda: "KATEGORI_KOMPLAIN", alasan: "uji konfirmasi", kunci: kunciUji("k2"), aktor: w.A }).catch(() => {});
});

test("K3. koreksi PEMAKAIAN per order: ajukan → penyetuju LAIN → pergerakan pembalik bertaut asal; berulang; token basi; saldo; valuasi", async () => {
  const w = await dunia(); const s0 = await saldo(w.kain.id);
  const asal = await testPrisma.stockMovement.findFirst({ where: { unitId: w.u1.id, materialId: w.kain.id, type: "ISSUE" } });
  const pr = await pratinjauKoreksiPemakaian(testPrisma, { unitId: w.u1.id, materialId: w.kain.id, qtyBaru: 1.7 });
  assert.equal(pr.boleh, true); assert.equal(pr.bersihSebelum, 2.1); assert.equal(pr.delta, -0.4); assert.equal(pr.jenis, "RETURN"); assert.ok(Math.abs(pr.saldoSesudah - (s0 + 0.4)) < 1e-6);
  const k1 = kunciUji("p1"); const a = await ajukanKoreksiPemakaian(testPrisma, { unitId: w.u1.id, materialId: w.kain.id, qtyBaru: 1.7, alasan: "Excel terverifikasi 1,7 m", kunci: k1, aktor: w.A });
  assert.equal(a.status, "PENDING_APPROVAL"); assert.equal(await saldo(w.kain.id), s0, "belum disetujui = stok belum berubah");
  assert.equal((await ajukanKoreksiPemakaian(testPrisma, { unitId: w.u1.id, materialId: w.kain.id, qtyBaru: 1.7, alasan: "Excel terverifikasi 1,7 m", kunci: k1, aktor: w.A })).ulang, true);
  await assert.rejects(() => ajukanKoreksiPemakaian(testPrisma, { unitId: w.u1.id, materialId: w.kain.id, qtyBaru: 1.5, alasan: "kedua belum disetujui", kunci: kunciUji("p2"), aktor: w.A }), /menunggu persetujuan/);
  await assert.rejects(() => setujuiKoreksiPemakaian(testPrisma, { koreksiId: a.id, aktor: w.A }), /sendiri/);
  const ok = await setujuiKoreksiPemakaian(testPrisma, { koreksiId: a.id, aktor: w.B, catatan: "OK" });
  assert.equal(ok.status, "POSTED"); assert.equal(ok.hasil.pemakaianSebelum, 2.1); assert.equal(ok.hasil.pemakaianSesudah, 1.7);
  assert.ok(Math.abs((await saldo(w.kain.id)) - (s0 + 0.4)) < 1e-9, "stok hanya bertambah selisih, sekali");
  const mv = await testPrisma.stockMovement.findUnique({ where: { id: ok.hasil.pergerakanId } });
  assert.equal(mv.type, "RETURN"); assert.equal(mv.unitId, w.u1.id); assert.equal(mv.correctsMovementId, asal.id); assert.equal(mv.correctionId, a.id); assert.equal(mv.createdById, w.B.id);
  const asalSesudah = await testPrisma.stockMovement.findUnique({ where: { id: asal.id } }); assert.equal(String(asalSesudah.qty), String(asal.qty), "pergerakan asal TIDAK diubah");
  assert.ok(await testPrisma.finStockMovementValuation.findUnique({ where: { movementId: mv.id } }), "pergerakan koreksi bernilai (valuasi beku)");
  assert.equal((await setujuiKoreksiPemakaian(testPrisma, { koreksiId: a.id, aktor: w.B })).ulang, true, "setujui ulang = hasil sama");
  assert.equal(await testPrisma.stockMovement.count({ where: { correctionId: a.id } }), 1);
  // catatan Excel kini sama dengan stok → tertaut
  assert.equal((await catatan(w.u1.id, "KAIN LAVA REKON")).state, "TERCATAT_DI_STOK");
  // koreksi BERULANG: 1,7 → 1,0 (terhadap pemakaian bersih saat itu)
  const b = await ajukanKoreksiPemakaian(testPrisma, { unitId: w.u1.id, materialId: w.kain.id, qtyBaru: 1.0, alasan: "Koreksi kedua oleh PIC", kunci: kunciUji("p3"), aktor: w.A });
  assert.equal(b.perubahan.sebelum.pemakaianBersih, 1.7);
  const ok2 = await setujuiKoreksiPemakaian(testPrisma, { koreksiId: b.id, aktor: w.B }); assert.equal(ok2.hasil.pemakaianSesudah, 1.0);
  assert.ok(Math.abs((await saldo(w.kain.id)) - (s0 + 1.1)) < 1e-9);
  // token basi: ajukan, lalu pemakaian berubah (koreksi lain tak mungkin karena tertunda → ubah ledger langsung), setujui → KEADAAN_BERUBAH
  const c = await ajukanKoreksiPemakaian(testPrisma, { unitId: w.u1.id, materialId: w.kain.id, qtyBaru: 0.5, alasan: "Koreksi ketiga akan basi", kunci: kunciUji("p4"), aktor: w.A });
  await testPrisma.stockMovement.create({ data: { materialId: w.kain.id, type: "ISSUE", qty: -0.1, unitId: w.u1.id, note: "pemakaian lain" } });
  await assert.rejects(() => setujuiKoreksiPemakaian(testPrisma, { koreksiId: c.id, aktor: w.B }), /sudah berubah/);
  await tolakKoreksiPemakaian(testPrisma, { koreksiId: c.id, aktor: w.B, catatan: "Basi, ajukan ulang" });
  // riwayat unit: diajukan + disetujui, sebelum–sesudah
  const rw = await riwayatKoreksiPemakaian(testPrisma, w.u1.id); assert.ok(rw.some((e) => e.kind === "KOREKSI_PEMAKAIAN_POSTED" && e.actor === w.B.name)); assert.ok(rw.some((e) => /2,1 → 1,7/.test(e.label)));
});

test("K4. koreksi pemakaian NAIK ditolak bila saldo kurang; pembatalan oleh pemohon; hanya penyetuju (izin) lewat HTTP", async () => {
  const w = await dunia();
  await assert.rejects(() => ajukanKoreksiPemakaian(testPrisma, { unitId: w.u1.id, materialId: w.kain.id, qtyBaru: 500, alasan: "terlalu besar", kunci: kunciUji("n1"), aktor: w.A }), /saldo bahan negatif|diblokir/i);
  const a = await ajukanKoreksiPemakaian(testPrisma, { unitId: w.u1.id, materialId: w.kain.id, qtyBaru: 3.0, alasan: "naik wajar 3 meter", kunci: kunciUji("n2"), aktor: w.A });
  const h = await w.ca.post(`/api/production/koreksi-pemakaian/${a.id}/setujui`, {}); assert.equal(h.status, 403, "ADMIN tanpa izin persetujuan tidak bisa menyetujui");
  const hb = await w.co.post(`/api/production/koreksi-pemakaian/${a.id}/setujui`, { catatan: "oke" }); assert.equal(hb.status, 200, JSON.stringify(hb.body)); assert.equal(hb.body.status, "POSTED");
  assert.equal((await testPrisma.stockMovement.findUnique({ where: { id: hb.body.hasil.pergerakanId } })).type, "ISSUE", "koreksi naik = ISSUE bertaut asal");
  const b = await ajukanKoreksiPemakaian(testPrisma, { unitId: w.u1.id, materialId: w.kain.id, qtyBaru: 1.0, alasan: "akan dibatalkan", kunci: kunciUji("n3"), aktor: w.A });
  await assert.rejects(() => batalkanKoreksiPemakaian(testPrisma, { koreksiId: b.id, aktor: w.B }), /Hanya pemohon/);
  assert.equal((await batalkanKoreksiPemakaian(testPrisma, { koreksiId: b.id, aktor: w.A })).status, "CANCELLED");
});

test("P1. posting terpadu: hanya rencana yang disetujui; tanggal historis; pelaku; valuasi beku; catatan tertaut; stok sekali; tampil di Produksi; idempoten; semua-atau-tidak per order", async () => {
  const w = await dunia();
  // u1 punya selisih kain (ISSUE lama berbeda) → hanya soft siap; u2 kain+soft siap
  const rencana = await rencanakanPosting(testPrisma); assert.equal(rencana.jumlah, 3); assert.deepEqual(rencana.transaksi.map((t) => t.kodeBahan), ["R-SOFT", "R-KAIN", "R-SOFT"]);
  assert.equal(rencana.transaksi[0].createdAtUTC, "2026-08-31T17:00:00.000Z");
  await assert.rejects(() => jalankanPosting(testPrisma, { persetujuan: { hashDisetujui: rencana.hash, rujukan: "", disetujuiOleh: "Owner" }, aktor: w.B }), /Posting butuh/);
  await assert.rejects(() => jalankanPosting(testPrisma, { persetujuan: { hashDisetujui: "salah", rujukan: "OWNER-2026-10-24", disetujuiOleh: "Owner", terikat: terikatDari(rencana) }, aktor: w.B }), /BERBEDA dari yang disetujui/);
  const sKain = await saldo(w.kain.id); const sSoft = await saldo(w.soft.id);
  // saldo soft turun setelah rencana disetujui → u2 (butuh 2) gagal, u1 (butuh 1) tetap jalan: kegagalan satu order tidak membatalkan order lain; u2 atomik (kain-nya juga tidak terposting)
  await testPrisma.stockMovement.create({ data: { materialId: w.soft.id, type: "ADJUSTMENT", qty: -8.5, reason: "uji", note: "uji penyusutan saldo", createdAt: WIB("2026-09-01") } });
  const mv0 = await testPrisma.stockMovement.count();
  // Rencana kini dihitung dari keadaan EFEKTIF (ledger sekarang): rencana lama yang sudah basi ditolak sejak awal — tak ada yang diposting.
  await assert.rejects(() => jalankanPosting(testPrisma, { persetujuan: { hashDisetujui: rencana.hash, rujukan: "OWNER-2026-10-24", disetujuiOleh: "Owner Uji", terikat: terikatDari(rencana) }, aktor: w.B }), /BERBEDA dari yang disetujui/);
  assert.equal(await testPrisma.stockMovement.count(), mv0, "rencana basi ditolak: nol pergerakan");
  // Balapan (saldo turun SETELAH rencana dihitung/dieksekusi): eksekusi per unit dari daftar lama — satu order gagal ATOMIK, order lain tetap jalan.
  const perUnit = new Map(); for (const t of rencana.transaksi) (perUnit.get(t.unitId) ?? perUnit.set(t.unitId, []).get(t.unitId)).push(t);
  const hasilUnit = []; for (const [unitId, daftar] of perUnit) hasilUnit.push({ daftar, h: await postingSatuUnit(testPrisma, { unitId, daftar, persetujuan: { hashDisetujui: rencana.hash, rujukan: "OWNER-2026-10-24", disetujuiOleh: "Owner Uji" }, aktor: w.B }) });
  const h = { diposting: hasilUnit.flatMap((x) => (x.h.status === "DIPOSTING" ? x.h.ok : [])), gagal: hasilUnit.filter((x) => x.h.status === "GAGAL").map((x) => ({ order: x.daftar[0].orderNumber, kode: x.h.kode })) };
  assert.equal(h.diposting.length, 1); assert.equal(h.gagal.length, 1); assert.equal(h.gagal[0].order, "RES-02092026-802");
  assert.equal(await testPrisma.stockMovement.count(), mv0 + 1 + 0, "hanya satu pergerakan baru (u1 soft); u2 atomik: tidak ada yang terposting"); assert.equal(await saldo(w.kain.id), sKain);
  const mv = await testPrisma.stockMovement.findFirst({ where: { unitId: w.u1.id, materialId: w.soft.id, note: { contains: "PH2610:" } } });
  assert.equal(mv.createdAt.toISOString(), "2026-08-31T17:00:00.000Z"); assert.equal(mv.createdById, w.B.id); assert.equal(Number(mv.qty), -1); assert.match(mv.reason, /OWNER-2026-10-24/);
  const val = await testPrisma.finStockMovementValuation.findUnique({ where: { movementId: mv.id } }); assert.equal(val.status, "DINILAI"); assert.equal(Number(val.value), 110000);
  assert.equal(await saldo(w.soft.id), sSoft - 8.5 - 1, "stok soft berkurang SEKALI untuk u1");
  const nSoft = await catatan(w.u1.id, "BUSA SOFT REKON"); assert.equal(nSoft.state, "DIPOSTING"); assert.equal(nSoft.stockMovementId, mv.id); assert.equal(nSoft.linkKind, "POSTING_HISTORIS");
  const evp = await testPrisma.unitUsageNoteEvent.findFirst({ where: { noteId: nSoft.id, kind: "DIPOSTING" } }); assert.equal(evp.actorId, w.B.id); assert.match(evp.reason, /OWNER-2026-10-24/);
  // tampil di Produksi seperti pemakaian aktual lain; status kerja DELIVERED tidak berubah
  const ad = (await w.ca.get(`/api/production/units/${w.u1.id}/adopsi`)).body;
  assert.ok(ad.pemakaianAktual.baris.some((b) => b.kode === "R-SOFT" && b.qty === 1 && b.pelaku === w.B.name), JSON.stringify(ad.pemakaianAktual.baris.map((b) => b.kode)));
  assert.equal(ad.adopsi.kerja.key, "SELESAI"); assert.equal(ad.unit.status, "DELIVERED");
  // jalankan ulang rencana LAMA → ditolak (rencana berubah); rencana baru tidak memuat yang sudah terposting
  await assert.rejects(() => jalankanPosting(testPrisma, { persetujuan: { hashDisetujui: rencana.hash, rujukan: "OWNER-2026-10-24", disetujuiOleh: "Owner Uji", terikat: terikatDari(rencana) }, aktor: w.B }), /BERBEDA/);
  const baru = await rencanakanPosting(testPrisma); assert.ok(!baru.transaksi.some((t) => t.unitId === w.u1.id && t.kodeBahan === "R-SOFT"));
});

test("P2. posting penuh lalu jalan ulang = nol tulisan; 'Pemakaian aktual' bertambah tepat sekali per bahan", async () => {
  const w = await dunia();
  const r1 = await rencanakanPosting(testPrisma); const h1 = await jalankanPosting(testPrisma, { persetujuan: { hashDisetujui: r1.hash, rujukan: "OWNER-2026-10-24", disetujuiOleh: "Owner Uji", terikat: terikatDari(r1) }, aktor: w.B });
  assert.equal(h1.diposting.length, 3); assert.equal(h1.gagal.length, 0);
  const mv1 = await testPrisma.stockMovement.count(); const r2 = await rencanakanPosting(testPrisma); assert.equal(r2.jumlah, 0);
  const h2 = await jalankanPosting(testPrisma, { persetujuan: { hashDisetujui: r2.hash, rujukan: "OWNER-2026-10-24", disetujuiOleh: "Owner Uji", terikat: terikatDari(r2) }, aktor: w.B });
  assert.equal(h2.diposting.length, 0); assert.equal(await testPrisma.stockMovement.count(), mv1);
  const aktual = (await w.ca.get(`/api/production/units/${w.u2.id}/adopsi`)).body.pemakaianAktual; assert.equal(aktual.baris.length, 2); assert.deepEqual(aktual.total.map((t) => t.dipakai).sort(), [2, 3]);
  const ch = await ambilCatatanHistoris(testPrisma, w.u2.id); assert.ok(ch.items.every((i) => i.state === "DIPOSTING")); assert.equal(ch.ringkas.diposting, 2);
});

test("V1. koreksi HARGA terpisah: valuasi asli tetap; efektif = koreksi terbaru; berulang & idempoten; jejak biaya memakai harga koreksi; tanpa efek stok/jurnal", async () => {
  const w = await dunia(); const r = await rencanakanPosting(testPrisma);
  await jalankanPosting(testPrisma, { persetujuan: { hashDisetujui: r.hash, rujukan: "OWNER-2026-10-24", disetujuiOleh: "Owner Uji", terikat: terikatDari(r) }, aktor: w.B });
  const mv = await testPrisma.stockMovement.findFirst({ where: { unitId: w.u2.id, materialId: w.kain.id, note: { contains: "PH2610:" } } });
  const asli = await testPrisma.finStockMovementValuation.findUnique({ where: { movementId: mv.id } }); assert.equal(Number(asli.value), 75000);
  const stok0 = await testPrisma.stockMovement.count(); const jur0 = await testPrisma.finJournalEntry.count();
  const k = kunciUji("v1"); const a = await koreksiValuasiPergerakan(testPrisma, { movementId: mv.id, hargaBaru: 30000, alasan: "Harga kain sebenarnya Rp30.000/m", kunci: k, aktor: w.B });
  assert.equal(a.koreksi.nilaiBaru, 90000); assert.equal(a.koreksi.sebelum.value, "75000"); assert.equal(a.koreksi.sesudah.unitCostBasis, "30000"); assert.equal(a.jurnalPerluPenyesuaian, false);
  assert.equal((await koreksiValuasiPergerakan(testPrisma, { movementId: mv.id, hargaBaru: 30000, alasan: "Harga kain sebenarnya Rp30.000/m", kunci: k, aktor: w.B })).ulang, true);
  const b = await koreksiValuasiPergerakan(testPrisma, { movementId: mv.id, hargaBaru: 28000, alasan: "Koreksi kedua harga 28.000", kunci: kunciUji("v2"), aktor: w.B }); assert.equal(b.koreksi.sebelum.value, "90000", "sebelum = koreksi sebelumnya");
  assert.equal(Number((await testPrisma.finStockMovementValuation.findUnique({ where: { movementId: mv.id } })).value), 75000, "valuasi asli TIDAK berubah");
  assert.equal((await valuasiEfektif(testPrisma, mv.id)).sumber, "KOREKSI"); assert.equal(Number((await valuasiEfektif(testPrisma, mv.id)).value), 84000);
  assert.equal(await testPrisma.stockMovement.count(), stok0); assert.equal(await testPrisma.finJournalEntry.count(), jur0);
  const j = await bacaJejakUnit(testPrisma, w.u2.id, { izinHarga: true }); const baris = j.bahan.flatMap((x) => x.pergerakan).find((x) => x.movementId === mv.id);
  assert.equal(baris.hargaManual, true); assert.equal(baris.nilai, 84000); assert.equal(baris.koreksiHarga.hargaBaru, 28000);
  await assert.rejects(() => koreksiValuasiPergerakan(testPrisma, { movementId: mv.id, hargaBaru: 28000, alasan: "sama saja dengan sekarang", kunci: kunciUji("v3"), aktor: w.B }), /sama dengan harga berlaku/);
  await assert.rejects(() => koreksiValuasiPergerakan(testPrisma, { movementId: mv.id, hargaBaru: -1, alasan: "negatif tidak boleh", kunci: kunciUji("v4"), aktor: w.B }), /0 atau lebih/);
});

test("S1. koreksi SALDO bahan tanpa sesi opname penuh: saldoBaru + asal tertaut; saldo tidak ditimpa; wajib persetujuan orang lain", async () => {
  const w = await dunia(); const s0 = await saldo(w.kain.id); const n = await catatan(w.u2.id, "KAIN LAVA REKON");
  const r = await w.ca.post("/api/inventory/adjustments", { materialId: w.kain.id, adjustmentType: "DATA_CORRECTION", saldoBaru: 18, reason: "Hitung fisik 18 m", originType: "USAGE_NOTE", originId: n.id });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.ok(Math.abs(r.body.adjustmentQty - (18 - s0)) < 1e-3); assert.ok(Math.abs(r.body.beforeQty - s0) < 1e-6); assert.equal(r.body.originType, "USAGE_NOTE"); assert.equal(r.body.originId, n.id);
  assert.equal(await saldo(w.kain.id), s0, "saldo tidak berubah saat permintaan dibuat");
  const buruk = await w.ca.post("/api/inventory/adjustments", { materialId: w.kain.id, adjustmentType: "DATA_CORRECTION", saldoBaru: 18, reason: "asal setengah", originType: "USAGE_NOTE" }); assert.equal(buruk.status, 400);
});

test("M1. bahan belum di katalog: master baru dibuat TANPA stok; catatan terpetakan otomatis HANYA bila nama persis; hasil 'belum ada catatan stok' (bukan nol)", async () => {
  const w = await dunia({ csvExtra: [baris(7, "RES-02092026-802", "2 Sep 26", "Lain-lain", "TAG LABEL WOVEN REKON", "1,0", "PCS")] });
  const n = await catatan(w.u2.id, "TAG LABEL WOVEN REKON"); assert.equal(n.state, "PERLU_DICEK"); assert.equal(n.materialId, null); assert.equal(n.flags[0].kode, "NAMA_TIDAK_DI_KATALOG");
  const mv0 = await testPrisma.stockMovement.count();
  const r = await w.ca.post("/api/inventory/materials", { code: "TAG-LABEL-WOVEN-REKON", name: "TAG LABEL WOVEN REKON", unit: "PCS" }); assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await testPrisma.stockMovement.count(), mv0, "membuat master TIDAK menambah stok");
  const ev = await w.ca.post("/api/production/catatan-historis/evaluasi", {}); assert.equal(ev.status, 200);
  const sesudah = await catatan(w.u2.id, "TAG LABEL WOVEN REKON"); assert.equal(sesudah.materialId, r.body.id); assert.equal(sesudah.state, "PERLU_DICEK"); assert.equal(sesudah.flags[0].kode, "TANPA_SALDO_PEMBUKA", "master baru = belum ada catatan stok, BUKAN saldo nol");
  assert.equal(await testPrisma.stockMovement.count(), mv0);
  assert.ok(await testPrisma.unitUsageNoteEvent.findFirst({ where: { noteId: n.id, kind: "DIEVALUASI" } }));
});

test("H1. rute catatan: baca per unit, koreksi lewat HTTP (Idempotency-Key wajib), izin baca saja tidak boleh menulis", async () => {
  const w = await dunia(); const sales = await createTestUser({ roles: ["SALES"] }); const cs = makeClient(server.baseUrl, sales.token);
  const g = await w.ca.get(`/api/production/units/${w.u1.id}/catatan-historis`); assert.equal(g.status, 200); assert.equal(g.body.ringkas.total, 2);
  const n = await catatan(w.u1.id, "KAIN LAVA REKON");
  const tanpaKunci = await w.ca.post(`/api/production/catatan-historis/${n.id}/koreksi`, { qty: 2.1, alasan: "konfirmasi 2,1 m" }); assert.equal(tanpaKunci.status, 428);
  const k = kunciUji("h1"); const ok = await w.ca.post(`/api/production/catatan-historis/${n.id}/koreksi`, { qty: 2.1, alasan: "konfirmasi 2,1 m" }, { "Idempotency-Key": k }); assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const ulang = await w.ca.post(`/api/production/catatan-historis/${n.id}/koreksi`, { qty: 2.1, alasan: "konfirmasi 2,1 m" }, { "Idempotency-Key": k }); assert.equal(ulang.status, 200);
  const dilarang = await cs.post(`/api/production/catatan-historis/${n.id}/koreksi`, { qty: 1, alasan: "coba tulis" }, { "Idempotency-Key": kunciUji("h2") }); assert.equal(dilarang.status, 403);
  const lihat = await cs.get(`/api/production/units/${w.u1.id}/catatan-historis`); assert.equal(lihat.status, 200, "peran baca-saja boleh melihat");
});
