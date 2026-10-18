// KOREKSI PENERIMAAN BARANG YANG SUDAH MASUK STOK — DB terisolasi. Menguji: metadata langsung tercatat, koreksi stok sebagian/penuh/tambah/bahan/lokasi, pemohon≠penyetuju, idempotensi/retry,
// pembalikan ganda, transaksi lanjutan sebagai penghalang, saldo & movement, rollback transaksi, hak akses, DB (trigger/CHECK), dan TIDAK ada dampak Finance/Produksi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, createTestUnit } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const akun = async (roles) => { const u = await createTestUser({ roles }); return { ...u, c: makeClient(server.baseUrl, u.token) }; };
let n = 0; const kunci = () => `idem-koreksi-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`;
const API = "/api/inventory/koreksi";
const saldo = async (materialId) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId }, _sum: { qty: true } }))._sum.qty ?? 0);

/** GR non-PO berstatus COMPLETED dengan satu/lebih baris dan pergerakan RECEIPT asal (persis keadaan sesudah "Simpan ke Stok"). */
async function buatGR({ baris = [{ qty: 10 }], nomor = "GR-TES-1", lokasi = "GUDANG_UTAMA", supplier = "CV Salah Ketik", status = "COMPLETED" } = {}) {
  const lines = [];
  for (const b of baris) { const m = b.material ?? (await createTestMaterial({ unit: b.unit ?? "METER", name: b.nama ?? "Kain Koreksi" })); lines.push({ m, qty: b.qty }); }
  const gr = await testPrisma.goodsReceipt.create({ data: { receiptNumber: nomor, sourceType: "MANUAL", status, supplier, deliveryNote: "SJ-LAMA", notes: "catatan lama", receivedDate: new Date("2026-10-10T00:00:00Z"), lines: { create: lines.map((l) => ({ materialId: l.m.id, receivedQty: l.qty, acceptedQty: l.qty, rejectedQty: 0, condition: "baik", notes: "ok" })) } }, include: { lines: true } });
  const mov = [];
  if (status === "COMPLETED") for (const l of lines) mov.push(await testPrisma.stockMovement.create({ data: { materialId: l.m.id, type: "RECEIPT", qty: l.qty, location: lokasi, goodsReceiptId: gr.id, note: `Simpan ke Stok ${nomor}`, createdAt: new Date("2026-10-10T03:00:00Z") } }));
  return { gr, lines, mov, baris: (i = 0) => gr.lines.find((x) => x.materialId === lines[i].m.id) };
}
const pratinjau = (u, id, perubahan) => u.c.post(`${API}/goods-receipts/${id}/pratinjau`, { perubahan });
const ajukan = (u, id, perubahan, alasan = "Salah ketik jumlah saat Simpan ke Stok", k = kunci()) => u.c.post(`${API}/goods-receipts/${id}/ajukan`, { perubahan, alasan }, { "Idempotency-Key": k });
const hitungFinProd = async () => ({ jurnal: await testPrisma.finJournalEntry.count(), payments: await testPrisma.payment.count(), tagihan: await testPrisma.finSupplierBill.count(), po: await testPrisma.finPurchaseOrder.count(), unit: await testPrisma.unit.count(), issue: await testPrisma.materialIssue.count(), gap: await testPrisma.finPostingGap.count() });

test("hak akses: SALES ditolak; pembaca saja tidak boleh pratinjau/ajukan; hanya pemegang izin persetujuan yang boleh setujui/tolak", async () => {
  const sales = await akun(["SALES"]); const gudang = await akun(["WAREHOUSE"]); const lead = await akun(["PRODUCTION_LEAD"]);
  const { gr } = await buatGR();
  assert.equal((await sales.c.get(`${API}/cakupan`)).status, 403);
  assert.equal((await lead.c.get(`${API}/cakupan`)).status, 200, "PRODUCTION_LEAD memegang inventory:read");
  assert.equal((await pratinjau(lead, gr.id, { metadata: { notes: "x" } })).status, 403);
  assert.equal((await ajukan(lead, gr.id, { metadata: { notes: "x" } })).status, 403);
  const p = await ajukan(gudang, gr.id, { baris: [{ barisId: gr.lines[0].id, jumlahBaik: 7 }] }); assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal((await gudang.c.post(`${API}/${p.body.id}/setujui`, {})).status, 403, "Gudang memegang inventory:write, bukan izin persetujuan");
  assert.equal((await gudang.c.post(`${API}/${p.body.id}/tolak`, { catatan: "tidak sesuai" })).status, 403);
  assert.equal((await gudang.c.post(`${API}/00000000-0000-4000-8000-000000000000/batal`, {})).status, 404);
  assert.equal((await gudang.c.get(`${API}/bukan-uuid`)).status, 400);
});

test("jalur per dokumen: draf boleh diedit, sudah masuk stok → koreksi bertaut/alur resmi/diblokir; tidak ada Edit umum", async () => {
  const w = await akun(["WAREHOUSE"]);
  const d = await buatGR({ status: "DRAFT", nomor: "GR-DRAF" }); const c = await buatGR({ nomor: "GR-SELESAI" });
  const get = async (tipe, id) => (await w.c.get(`${API}/dokumen/${tipe}/${id}`));
  let r = await get("GOODS_RECEIPT", d.gr.id); assert.equal(r.body.jalur, "EDIT_DRAF"); assert.equal(r.body.pengaruh.stok, false);
  r = await get("GOODS_RECEIPT", c.gr.id); assert.equal(r.body.jalur, "KOREKSI_UI"); assert.equal(r.body.pengaruh.stok, true); assert.equal(r.body.pengaruh.finance, false); assert.ok(r.body.tindakan.some((t) => t.kode === "KOREKSI_PENERIMAAN"));
  const po = await testPrisma.goodsReceipt.update({ where: { id: c.gr.id }, data: {} }); // sumber PO disimulasikan lewat jalurDokumen: dites di unit
  const rej = await buatGR({ status: "REJECTED", nomor: "GR-TOLAK" }); r = await get("GOODS_RECEIPT", rej.gr.id); assert.equal(r.body.jalur, "FINAL");
  assert.equal((await get("BUKAN_TIPE", c.gr.id)).status, 400);
  assert.equal((await get("GOODS_RECEIPT", "00000000-0000-4000-8000-000000000000")).status, 404);
  const cakupan = (await w.c.get(`${API}/cakupan`)).body; assert.ok(cakupan.menu.length >= 15); assert.ok(cakupan.menu.every((x) => ["EDIT_DRAF", "KOREKSI_UI", "ALUR_RESMI", "DIBLOKIR", "FINAL"].includes(x.jalur)));
  assert.ok(cakupan.penghalang.BAHAN_SUDAH_BERGERAK.langkah.length > 10); assert.match(cakupan.batas, /tidak mengubah pembayaran/);
  void po;
});

test("koreksi METADATA: langsung POSTED, alasan wajib, sebelum–sesudah tercatat, stok/jurnal/Produksi tidak berubah, idempoten", async () => {
  const w = await akun(["WAREHOUSE"]); const { gr, lines } = await buatGR();
  const awalFin = await hitungFinProd(); const awalMov = await testPrisma.stockMovement.count(); const awalSaldo = await saldo(lines[0].m.id);
  const perubahan = { metadata: { supplier: "CV Benar", deliveryNote: "SJ-BARU", notes: "catatan benar" }, baris: [{ barisId: gr.lines[0].id, kondisi: "sebagian lecet", catatan: "periksa ulang" }] };
  assert.equal((await ajukan(w, gr.id, perubahan, "x")).status, 400, "alasan terlalu pendek");
  assert.equal((await w.c.post(`${API}/goods-receipts/${gr.id}/ajukan`, { perubahan, alasan: "Salah ketik supplier saat input" })).status, 428, "Idempotency-Key wajib");
  const pv = await pratinjau(w, gr.id, perubahan); assert.equal(pv.status, 200); assert.equal(pv.body.boleh, true); assert.equal(pv.body.kind, "METADATA"); assert.equal(pv.body.dampak.stok, false); assert.equal(pv.body.operasi.length, 0);
  assert.equal((await testPrisma.warehouseCorrection.count()), 0, "pratinjau tidak menulis");
  const k = kunci(); const r = await ajukan(w, gr.id, perubahan, "Salah ketik supplier saat input", k); assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, "POSTED"); assert.equal(r.body.jenis, "METADATA"); assert.equal(r.body.pemohon.id, w.user.id); assert.deepEqual(r.body.perubahan.metadata.sebelum, { supplier: "CV Salah Ketik", deliveryNote: "SJ-LAMA", notes: "catatan lama" }); assert.deepEqual(r.body.perubahan.metadata.sesudah, { supplier: "CV Benar", deliveryNote: "SJ-BARU", notes: "catatan benar" });
  const grBaru = await testPrisma.goodsReceipt.findUnique({ where: { id: gr.id }, include: { lines: true } });
  assert.equal(grBaru.supplier, "CV Benar"); assert.equal(grBaru.deliveryNote, "SJ-BARU"); assert.equal(grBaru.status, "COMPLETED"); assert.equal(grBaru.lines[0].condition, "sebagian lecet"); assert.equal(grBaru.lines[0].acceptedQty, 10, "jumlah tidak berubah");
  assert.equal(await testPrisma.stockMovement.count(), awalMov, "tidak ada pergerakan"); assert.equal(await saldo(lines[0].m.id), awalSaldo); assert.deepEqual(await hitungFinProd(), awalFin, "Finance/Produksi tidak tersentuh");
  const ev = await testPrisma.activityEvent.findMany({ where: { entityType: "goods_receipt", entityId: gr.id, eventType: "DOCUMENT_CORRECTED" } }); assert.equal(ev.length, 1); assert.equal(ev[0].metadata.jenis, "METADATA");
  // retry dengan kunci sama: hasil sama, tanpa koreksi baru
  const ulang = await ajukan(w, gr.id, perubahan, "Salah ketik supplier saat input", k); assert.ok([200, 201].includes(ulang.status), "retry: hasil sama (200 atau replay 201)"); assert.equal(ulang.body.id, r.body.id); assert.equal(await testPrisma.warehouseCorrection.count(), 1);
  // kunci sama untuk dokumen lain ditolak
  const lain = await buatGR({ nomor: "GR-LAIN" }); assert.ok([409, 422].includes((await ajukan(w, lain.gr.id, { metadata: { notes: "z" } }, "Salah ketik catatan baris", k)).status), "kunci yang sama untuk dokumen/isi lain ditolak");
  // tidak ada perubahan → ditolak
  const sama = await pratinjau(w, gr.id, { metadata: { supplier: "CV Benar" } }); assert.equal(sama.body.boleh, false); assert.equal(sama.body.penghalang[0].kode, "TANPA_PERUBAHAN");
  // riwayat asal tetap terlihat
  const doc = (await w.c.get(`${API}/dokumen/GOODS_RECEIPT/${gr.id}`)).body; assert.equal(doc.riwayatKoreksi.length, 1); assert.equal(doc.riwayatKoreksi[0].perubahan.metadata.sebelum.supplier, "CV Salah Ketik");
});

test("koreksi STOK sebagian: diajukan → menunggu; pemohon tidak bisa menyetujui sendiri; penyetuju lain → pergerakan pembalik bertaut; asal utuh; saldo benar; retry tidak menggandakan", async () => {
  const pemohon = await akun(["OWNER"]); const penyetuju = await akun(["OWNER"]); const { gr, lines, mov } = await buatGR({ baris: [{ qty: 10 }] });
  const m = lines[0].m; const awalFin = await hitungFinProd();
  const ubah = { baris: [{ barisId: gr.lines[0].id, jumlahBaik: 7 }] };
  const pv = await pratinjau(pemohon, gr.id, ubah); assert.equal(pv.body.boleh, true, JSON.stringify(pv.body.penghalang)); assert.equal(pv.body.kind, "STOCK"); assert.equal(pv.body.dampak.butuhPersetujuan, true);
  assert.equal(pv.body.operasi.length, 1); assert.equal(pv.body.operasi[0].jenis, "PEMBALIK"); assert.equal(pv.body.operasi[0].qty, -3); assert.equal(pv.body.baris[0].saldo.sebelum, 10); assert.equal(pv.body.baris[0].saldo.sesudah, 7);
  const k = kunci(); const aj = await ajukan(pemohon, gr.id, ubah, "Jumlah baik seharusnya 7, bukan 10 (salah hitung)", k); assert.equal(aj.status, 201, JSON.stringify(aj.body)); assert.equal(aj.body.status, "PENDING_APPROVAL");
  assert.equal(await saldo(m.id), 10, "belum ada pergerakan sebelum disetujui"); assert.equal(await testPrisma.stockMovement.count({ where: { correctionId: { not: null } } }), 0);
  assert.match(aj.body.nomor, /^KG-\d{6}-\d{2}$/);
  // satu koreksi tertunda per dokumen
  const dobel = await pratinjau(pemohon, gr.id, { baris: [{ barisId: gr.lines[0].id, jumlahBaik: 5 }] }); assert.equal(dobel.body.boleh, false); assert.ok(dobel.body.penghalang.some((x) => x.kode === "KOREKSI_TERTUNDA"));
  assert.equal((await ajukan(pemohon, gr.id, { baris: [{ barisId: gr.lines[0].id, jumlahBaik: 5 }] })).status, 409);
  // pemohon (pemegang izin persetujuan) tidak boleh menyetujui koreksinya sendiri
  const diri = await pemohon.c.post(`${API}/${aj.body.id}/setujui`, {}); assert.equal(diri.status, 403); assert.equal(diri.body.code, "PEMOHON_SAMA"); assert.equal(await saldo(m.id), 10);
  const diriTolak = await pemohon.c.post(`${API}/${aj.body.id}/tolak`, { catatan: "tidak jadi" }); assert.equal(diriTolak.status, 403);
  // penyetuju lain
  const ok = await penyetuju.c.post(`${API}/${aj.body.id}/setujui`, { catatan: "sesuai hitungan fisik" }); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.status, "POSTED"); assert.equal(ok.body.pemutus.id, penyetuju.user.id); assert.equal(ok.body.pemohon.id, pemohon.user.id);
  assert.equal(await saldo(m.id), 7); assert.equal(ok.body.pergerakan.length, 1); assert.equal(ok.body.pergerakan[0].qty, -3); assert.equal(ok.body.pergerakan[0].mengoreksi, mov[0].id);
  const asal = await testPrisma.stockMovement.findUnique({ where: { id: mov[0].id } }); assert.equal(Number(asal.qty), 10, "pergerakan asal TIDAK diubah"); assert.equal(asal.correctionId, null);
  const pb = await testPrisma.stockMovement.findUnique({ where: { id: ok.body.pergerakan[0].id } }); assert.equal(pb.type, "RECEIPT"); assert.equal(pb.goodsReceiptId, gr.id); assert.equal(pb.correctionId, aj.body.id); assert.equal(pb.correctsMovementId, mov[0].id); assert.equal(pb.createdById, penyetuju.user.id);
  const grAkhir = await testPrisma.goodsReceipt.findUnique({ where: { id: gr.id }, include: { lines: true } }); assert.equal(grAkhir.lines[0].acceptedQty, 10, "catatan asal tetap terlihat"); assert.equal(grAkhir.status, "COMPLETED");
  // retry: setujui lagi & ajukan ulang dengan kunci sama = hasil sama, tanpa pergerakan baru
  const lagi = await penyetuju.c.post(`${API}/${aj.body.id}/setujui`, {}); assert.equal(lagi.status, 200); assert.equal(lagi.body.ulang, true); assert.equal(await saldo(m.id), 7);
  const ulang = await ajukan(pemohon, gr.id, ubah, "Jumlah baik seharusnya 7, bukan 10 (salah hitung)", k); assert.ok([200, 201].includes(ulang.status)); assert.equal(ulang.body.id, aj.body.id); assert.equal(await testPrisma.stockMovement.count({ where: { correctionId: { not: null } } }), 1);
  assert.deepEqual(await hitungFinProd(), awalFin, "tidak ada dampak jurnal/pembayaran/tagihan/PO/unit/Material Issue");
  const ev = await testPrisma.activityEvent.findMany({ where: { entityType: "goods_receipt", entityId: gr.id, eventType: "DOCUMENT_CORRECTED" } }); assert.equal(ev.length, 1); assert.equal(ev[0].metadata.jenis, "STOCK"); assert.equal(ev[0].actorId, penyetuju.user.id);
});

test("persetujuan paralel: dua penyetuju bersamaan → tepat satu pergerakan; pembalikan ganda dicegah (penuh lalu ulang)", async () => {
  const a = await akun(["OWNER"]); const b = await akun(["OWNER"]); const c = await akun(["OWNER"]); const { gr, lines } = await buatGR({ baris: [{ qty: 8 }] }); const m = lines[0].m;
  const aj = await ajukan(a, gr.id, { baris: [{ barisId: gr.lines[0].id, jumlahBaik: 0 }] }, "Penerimaan ini salah input seluruhnya"); assert.equal(aj.status, 201, JSON.stringify(aj.body));
  const [r1, r2] = await Promise.all([b.c.post(`${API}/${aj.body.id}/setujui`, {}), c.c.post(`${API}/${aj.body.id}/setujui`, {})]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 200], "yang kalah mendapat hasil yang sama (idempoten)"); assert.equal([r1.body.ulang, r2.body.ulang].filter(Boolean).length, 1);
  assert.equal(await testPrisma.stockMovement.count({ where: { correctionId: aj.body.id } }), 1, "tepat satu pergerakan pembalik"); assert.equal(await saldo(m.id), 0);
  // pembalikan penuh kedua kali tidak mungkin: tidak ada perubahan; saldo tidak jadi negatif
  const lagi = await pratinjau(a, gr.id, { baris: [{ barisId: gr.lines[0].id, jumlahBaik: 0 }] }); assert.equal(lagi.body.boleh, false); assert.equal(lagi.body.penghalang[0].kode, "TANPA_PERUBAHAN");
  assert.equal((await ajukan(a, gr.id, { baris: [{ barisId: gr.lines[0].id, jumlahBaik: 0 }] }, "Coba balik lagi")).status, 409); assert.equal(await saldo(m.id), 0);
});

test("koreksi tambah jumlah, ganti bahan (sesatuan), ganti lokasi: operasi bertaut benar; satuan berbeda ditolak; baris tanpa jumlah baik tidak bisa ditambah stoknya", async () => {
  const a = await akun(["OWNER"]); const b = await akun(["OWNER"]);
  // tambah
  const t = await buatGR({ baris: [{ qty: 10 }], nomor: "GR-TAMBAH" });
  let aj = await ajukan(a, t.gr.id, { baris: [{ barisId: t.gr.lines[0].id, jumlahBaik: 12 }] }, "Barang datang 12, salah ketik 10"); assert.equal(aj.body.perubahan.baris[0].operasi[0].jenis, "SELISIH_TAMBAH");
  let ok = await b.c.post(`${API}/${aj.body.id}/setujui`, {}); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(await saldo(t.lines[0].m.id), 12); assert.equal(ok.body.pergerakan[0].qty, 2); assert.equal(ok.body.pergerakan[0].mengoreksi, t.mov[0].id);
  // ganti bahan (sesatuan)
  const asalM = await createTestMaterial({ unit: "METER", name: "Kain Salah" }); const benarM = await createTestMaterial({ unit: "METER", name: "Kain Benar" }); const roll = await createTestMaterial({ unit: "ROLL", name: "Kain Roll" });
  const g = await buatGR({ baris: [{ qty: 6, material: asalM }], nomor: "GR-BAHAN" });
  const beda = await pratinjau(a, g.gr.id, { baris: [{ barisId: g.gr.lines[0].id, bahanId: roll.id }] }); assert.equal(beda.body.boleh, false); assert.equal(beda.body.penghalang[0].kode, "SATUAN_BEDA");
  const tidakAda = await pratinjau(a, g.gr.id, { baris: [{ barisId: g.gr.lines[0].id, bahanId: "00000000-0000-4000-8000-000000000000" }] }); assert.equal(tidakAda.body.penghalang[0].kode, "BAHAN_PENGGANTI_TIDAK_VALID");
  aj = await ajukan(a, g.gr.id, { baris: [{ barisId: g.gr.lines[0].id, bahanId: benarM.id }] }, "Bahan yang diterima ternyata Kain Benar"); assert.equal(aj.status, 201, JSON.stringify(aj.body)); assert.deepEqual(aj.body.perubahan.baris[0].operasi.map((o) => o.jenis), ["PEMBALIK", "MASUK_BARU"]);
  ok = await b.c.post(`${API}/${aj.body.id}/setujui`, {}); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(await saldo(asalM.id), 0); assert.equal(await saldo(benarM.id), 6);
  const baru = await testPrisma.stockMovement.findFirst({ where: { correctionId: aj.body.id, materialId: benarM.id } }); assert.equal(baru.correctsMovementId, null, "bahan baru bukan pembalik"); assert.equal(baru.goodsReceiptId, g.gr.id);
  const pembalik = await testPrisma.stockMovement.findFirst({ where: { correctionId: aj.body.id, materialId: asalM.id } }); assert.equal(pembalik.correctsMovementId, g.mov[0].id); assert.equal(Number(pembalik.qty), -6);
  // ganti lokasi
  const l = await buatGR({ baris: [{ qty: 5 }], nomor: "GR-LOKASI", lokasi: "RAK-A" });
  aj = await ajukan(a, l.gr.id, { baris: [{ barisId: l.gr.lines[0].id, lokasi: "RAK-B" }] }, "Barang disimpan di RAK-B, bukan RAK-A"); assert.equal(aj.status, 201, JSON.stringify(aj.body));
  ok = await b.c.post(`${API}/${aj.body.id}/setujui`, {}); assert.equal(ok.status, 200); assert.equal(await saldo(l.lines[0].m.id), 5, "total tidak berubah");
  const byLok = await testPrisma.stockMovement.groupBy({ by: ["location"], where: { materialId: l.lines[0].m.id }, _sum: { qty: true } }); assert.deepEqual(Object.fromEntries(byLok.map((x) => [x.location, Number(x._sum.qty)])), { "RAK-A": 0, "RAK-B": 5 });
  // baris tanpa jumlah baik: tidak ada stok masuk → tidak boleh "ditambah"
  const nol = await buatGR({ baris: [{ qty: 4 }, { qty: 1 }], nomor: "GR-NOL" }); await testPrisma.goodsReceiptLine.update({ where: { id: nol.gr.lines[1].id }, data: { acceptedQty: 0, rejectedQty: 1 } });
  const noPv = await pratinjau(a, nol.gr.id, { baris: [{ barisId: nol.gr.lines[1].id, jumlahBaik: 3 }] }); assert.equal(noPv.body.boleh, false); assert.equal(noPv.body.penghalang[0].kode, "NILAI_TIDAK_VALID");
  // nilai tidak valid
  for (const v of [-1, "abc", 1.23456]) assert.equal((await pratinjau(a, nol.gr.id, { baris: [{ barisId: nol.gr.lines[0].id, jumlahBaik: v }] })).body.penghalang[0].kode, "NILAI_TIDAK_VALID", String(v));
});

test("PENGHALANG: bahan sudah bergerak/dihitung opname/stok tersedia kurang/dari PO/belum masuk stok/dijurnal/baris bahan ganda/ledger tak sinkron — dengan langkah penyelesaian nyata", async () => {
  const a = await akun(["OWNER"]);
  const kode = async (id, ubah) => (await pratinjau(a, id, ubah)).body.penghalang.map((x) => x.kode);
  // bahan sudah bergerak
  let g = await buatGR({ nomor: "GR-GERAK" }); const unit = await createTestUnit();
  await testPrisma.stockMovement.create({ data: { materialId: g.lines[0].m.id, type: "ISSUE", qty: -2, unitId: unit.id, note: "dipakai produksi", createdAt: new Date("2026-10-12T00:00:00Z") } });
  let r = await pratinjau(a, g.gr.id, { baris: [{ barisId: g.gr.lines[0].id, jumlahBaik: 6 }] }); assert.ok(r.body.penghalang.some((x) => x.kode === "BAHAN_SUDAH_BERGERAK")); const pg = r.body.penghalang.find((x) => x.kode === "BAHAN_SUDAH_BERGERAK"); assert.equal(pg.detail[0].jenis, "ISSUE"); assert.match(pg.langkah, /Penyesuaian Stok/);
  assert.equal((await ajukan(a, g.gr.id, { baris: [{ barisId: g.gr.lines[0].id, jumlahBaik: 6 }] })).status, 409);
  // metadata tetap boleh walau bahan sudah dipakai (tidak mengubah stok)
  assert.equal((await pratinjau(a, g.gr.id, { metadata: { notes: "catatan baru" } })).body.boleh, true);
  // dihitung opname
  g = await buatGR({ nomor: "GR-OPNAME" }); const sc = await testPrisma.stockCount.create({ data: { countNumber: "CC-TES-1", countType: "CYCLE_COUNT", countMethod: "BY_ITEM", status: "COMPLETED", startedAt: new Date("2026-10-11T00:00:00Z"), lines: { create: [{ materialId: g.lines[0].m.id, systemQty: 10, countedQty: 10 }] } } }); void sc;
  r = await pratinjau(a, g.gr.id, { baris: [{ barisId: g.gr.lines[0].id, jumlahBaik: 9 }] }); assert.ok(r.body.penghalang.some((x) => x.kode === "SUDAH_DIHITUNG_OPNAME" && x.detail[0].nomor === "CC-TES-1"));
  // stok tersedia kurang karena reservasi Material Issue APPROVED
  g = await buatGR({ nomor: "GR-RESERVASI", baris: [{ qty: 10 }] });
  await testPrisma.materialIssue.create({ data: { issueNumber: "MI-RES-1", sourceType: "MANUAL", status: "APPROVED", lines: { create: [{ materialId: g.lines[0].m.id, requestedQty: 8 }] } } });
  r = await pratinjau(a, g.gr.id, { baris: [{ barisId: g.gr.lines[0].id, jumlahBaik: 5 }] }); const kurang = r.body.penghalang.find((x) => x.kode === "STOK_TIDAK_CUKUP"); assert.ok(kurang); assert.equal(kurang.detail.dikurangi, 5); assert.equal(kurang.detail.tersedia, 2); assert.equal(kurang.detail.reservasi, 8);
  // penambahan tidak butuh stok tersedia
  assert.equal((await pratinjau(a, g.gr.id, { baris: [{ barisId: g.gr.lines[0].id, jumlahBaik: 11 }] })).body.boleh, true);
  // belum masuk stok / ditolak
  assert.deepEqual(await kode((await buatGR({ status: "READY_FOR_PUTAWAY", nomor: "GR-SIAP" })).gr.id, { baris: [] , metadata: { notes: "z" } }), ["BUKAN_COMPLETED"]);
  assert.deepEqual(await kode((await buatGR({ status: "REJECTED", nomor: "GR-TOLAK2" })).gr.id, { metadata: { notes: "z" } }), ["PENERIMAAN_DITOLAK"]);
  // dari PO: stok & bidang PO diarahkan ke alur resmi; catatan boleh
  const po = await testPrisma.finPurchaseOrder.create({ data: { poNumber: "PO-TES-1", orderDate: new Date("2026-10-01T00:00:00Z"), status: "DISETUJUI", supplier: { create: { code: "SUP-TES-1", name: "Supplier PO" } } } });
  g = await buatGR({ nomor: "GR-PO" }); await testPrisma.goodsReceipt.update({ where: { id: g.gr.id }, data: { purchaseOrderId: po.id, sourceType: "PURCHASE_ORDER" } });
  r = await pratinjau(a, g.gr.id, { baris: [{ barisId: g.gr.lines[0].id, jumlahBaik: 5 }], metadata: { supplier: "Lain" } }); assert.ok(r.body.penghalang.every((x) => x.kode === "DARI_PO")); assert.equal(r.body.dariPO, true); assert.match(r.body.penghalang[0].langkah, /Koreksi Kedatangan/);
  assert.equal((await pratinjau(a, g.gr.id, { metadata: { notes: "catatan gudang" } })).body.boleh, true);
  // sudah dijurnal
  g = await buatGR({ nomor: "GR-JURNAL" }); await testPrisma.finJournalEntry.create({ data: { entryNumber: "JV-TES-1", date: new Date("2026-10-10T00:00:00Z"), description: "Penerimaan", source: "PENERIMAAN_BAHAN", sourceId: g.gr.id, idempotencyKey: `PENERIMAAN_BAHAN:${g.gr.id}`, status: "POSTED" } });
  r = await pratinjau(a, g.gr.id, { baris: [{ barisId: g.gr.lines[0].id, jumlahBaik: 9 }] }); const j = r.body.penghalang.find((x) => x.kode === "JURNAL_FINANCE"); assert.ok(j); assert.match(j.langkah, /Finance/);
  assert.equal((await pratinjau(a, g.gr.id, { metadata: { notes: "catatan" } })).body.boleh, true, "metadata murni tidak menyentuh jurnal");
  assert.ok((await pratinjau(a, g.gr.id, { metadata: { receivedDate: "2026-10-09" } })).body.penghalang.some((x) => x.kode === "JURNAL_FINANCE"), "tanggal dokumen ikut tanggal jurnal");
  // baris bahan ganda & ledger tak sinkron
  const mm = await createTestMaterial({ unit: "PCS" }); g = await buatGR({ nomor: "GR-GANDA", baris: [{ qty: 3, material: mm }, { qty: 2, material: mm }] });
  assert.ok((await kode(g.gr.id, { baris: [{ barisId: g.gr.lines[0].id, jumlahBaik: 1 }] })).includes("BARIS_BAHAN_GANDA"));
  g = await buatGR({ nomor: "GR-SINKRON", baris: [{ qty: 5 }] }); await testPrisma.goodsReceiptLine.update({ where: { id: g.gr.lines[0].id }, data: { acceptedQty: 6 } });
  assert.ok((await kode(g.gr.id, { baris: [{ barisId: g.gr.lines[0].id, jumlahBaik: 4 }] })).includes("LEDGER_TIDAK_SINKRON"));
  // tanggal dokumen: masa depan / format salah
  g = await buatGR({ nomor: "GR-TGL" }); for (const v of ["2999-01-01", "bukan-tanggal", ""]) assert.ok((await kode(g.gr.id, { metadata: { receivedDate: v } })).includes("WAKTU_TIDAK_VALID"), v);
  // bidang tidak dikenal
  assert.equal((await pratinjau(a, g.gr.id, { metadata: { status: "DRAFT" } })).status, 400); assert.equal((await pratinjau(a, g.gr.id, { baris: [{ barisId: g.gr.lines[0].id, qty: 1 }] })).status, 400);
});

test("keadaan berubah antara pengajuan dan persetujuan: transaksi lanjutan menghalangi; koreksi tetap PENDING dan bisa ditolak/dibatalkan; tidak ada pergerakan", async () => {
  const a = await akun(["OWNER"]); const b = await akun(["OWNER"]); const { gr, lines } = await buatGR({ baris: [{ qty: 10 }] }); const m = lines[0].m; const unit = await createTestUnit();
  const aj = await ajukan(a, gr.id, { baris: [{ barisId: gr.lines[0].id, jumlahBaik: 8 }] }, "Jumlah baik seharusnya 8"); assert.equal(aj.status, 201);
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ISSUE", qty: -3, unitId: unit.id, note: "dipakai setelah koreksi diajukan" } });
  const ok = await b.c.post(`${API}/${aj.body.id}/setujui`, {}); assert.equal(ok.status, 409); assert.equal(ok.body.code, "BAHAN_SUDAH_BERGERAK"); assert.ok(ok.body.penghalang[0].langkah.length > 10);
  assert.equal(await saldo(m.id), 7, "saldo hanya dari ISSUE; tidak ada pergerakan koreksi"); assert.equal(await testPrisma.stockMovement.count({ where: { correctionId: { not: null } } }), 0);
  assert.equal((await testPrisma.warehouseCorrection.findUnique({ where: { id: aj.body.id } })).status, "PENDING_APPROVAL");
  assert.equal((await b.c.post(`${API}/${aj.body.id}/tolak`, { catatan: "x" })).status, 400, "alasan penolakan wajib (min 5)");
  const tolak = await b.c.post(`${API}/${aj.body.id}/tolak`, { catatan: "stok sudah dipakai produksi, ajukan penyesuaian" }); assert.equal(tolak.status, 200); assert.equal(tolak.body.status, "REJECTED"); assert.equal((await b.c.post(`${API}/${aj.body.id}/tolak`, { catatan: "stok sudah dipakai produksi" })).body.ulang, true);
  assert.equal((await b.c.post(`${API}/${aj.body.id}/setujui`, {})).status, 409, "koreksi final tidak bisa disetujui");
  // pemohon membatalkan miliknya; orang lain tidak bisa membatalkan
  const g2 = await buatGR({ nomor: "GR-BATAL", baris: [{ qty: 4 }] }); const a2 = await ajukan(a, g2.gr.id, { baris: [{ barisId: g2.gr.lines[0].id, jumlahBaik: 3 }] }, "Salah hitung satu unit");
  const orang = await akun(["WAREHOUSE"]); assert.equal((await orang.c.post(`${API}/${a2.body.id}/batal`, {})).status, 403);
  const batal = await a.c.post(`${API}/${a2.body.id}/batal`, { catatan: "salah ajukan" }); assert.equal(batal.status, 200); assert.equal(batal.body.status, "CANCELLED");
  // sesudah dibatalkan, koreksi baru dapat diajukan
  assert.equal((await ajukan(a, g2.gr.id, { baris: [{ barisId: g2.gr.lines[0].id, jumlahBaik: 3 }] }, "Ajukan ulang dengan benar")).status, 201);
});

test("rollback atomik: bila satu pergerakan gagal, SEMUA pergerakan koreksi, perubahan header, dan status koreksi dibatalkan bersama", async () => {
  const a = await akun(["OWNER"]); const b = await akun(["OWNER"]);
  const { gr, lines } = await buatGR({ baris: [{ qty: 10 }, { qty: 6 }], nomor: "GR-ROLLBACK" });
  const aj = await ajukan(a, gr.id, { metadata: { notes: "catatan sesudah koreksi" }, baris: [{ barisId: gr.lines[0].id, jumlahBaik: 4 }, { barisId: gr.lines[1].id, jumlahBaik: 2 }] }, "Dua baris salah hitung"); assert.equal(aj.status, 201, JSON.stringify(aj.body));
  const mB = lines[1].m.id;
  await testPrisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION tes_gagal_koreksi() RETURNS trigger AS $$ BEGIN IF NEW.material_id = '${mB}'::uuid AND NEW.correction_id IS NOT NULL THEN RAISE EXCEPTION 'gagal sengaja'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await testPrisma.$executeRawUnsafe(`CREATE TRIGGER tes_gagal_koreksi_trg BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION tes_gagal_koreksi()`);
  try {
    const gagal = await b.c.post(`${API}/${aj.body.id}/setujui`, {}); assert.equal(gagal.status, 500);
  } finally { await testPrisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS tes_gagal_koreksi_trg ON stock_movements"); await testPrisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS tes_gagal_koreksi()"); }
  assert.equal(await testPrisma.stockMovement.count({ where: { correctionId: { not: null } } }), 0, "pergerakan baris pertama ikut dibatalkan");
  assert.equal(await saldo(lines[0].m.id), 10); assert.equal(await saldo(mB), 6);
  assert.equal((await testPrisma.goodsReceipt.findUnique({ where: { id: gr.id } })).notes, "catatan lama", "header tidak berubah"); assert.equal((await testPrisma.warehouseCorrection.findUnique({ where: { id: aj.body.id } })).status, "PENDING_APPROVAL");
  assert.equal((await testPrisma.activityEvent.count({ where: { entityType: "goods_receipt", entityId: gr.id, eventType: "DOCUMENT_CORRECTED" } })), 0);
  // sesudah gangguan hilang, persetujuan ulang berhasil dan lengkap
  const ok = await b.c.post(`${API}/${aj.body.id}/setujui`, {}); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.pergerakan.length, 2); assert.equal(await saldo(lines[0].m.id), 4); assert.equal(await saldo(mB), 2);
  assert.equal((await testPrisma.goodsReceipt.findUnique({ where: { id: gr.id } })).notes, "catatan sesudah koreksi");
});

test("DB: koreksi final tidak bisa diubah/dihapus; pemohon=penyetuju ditolak CHECK; metadata harus POSTED; pergerakan koreksi wajib bertaut", async () => {
  const a = await akun(["OWNER"]); const b = await akun(["OWNER"]); const { gr } = await buatGR({ baris: [{ qty: 5 }] });
  const aj = await ajukan(a, gr.id, { baris: [{ barisId: gr.lines[0].id, jumlahBaik: 3 }] }, "Jumlah baik seharusnya 3");
  await assert.rejects(testPrisma.$executeRawUnsafe(`UPDATE warehouse_corrections SET reason = 'diubah diam-diam' WHERE id = '${aj.body.id}'::uuid`), /isi koreksi tidak boleh diubah/);
  await assert.rejects(testPrisma.$executeRawUnsafe(`DELETE FROM warehouse_corrections WHERE id = '${aj.body.id}'::uuid`), /append-only/);
  await assert.rejects(testPrisma.$executeRawUnsafe(`UPDATE warehouse_corrections SET status = 'POSTED', decided_by = '${a.user.id}', decided_at = now() WHERE id = '${aj.body.id}'::uuid`), /warehouse_corrections_keputusan_chk/, "pemohon = penyetuju ditolak DB");
  await assert.rejects(testPrisma.$executeRawUnsafe(`UPDATE warehouse_corrections SET status = 'RANDOM' WHERE id = '${aj.body.id}'::uuid`), /warehouse_corrections_jenis_chk/);
  await assert.rejects(testPrisma.$executeRawUnsafe(`UPDATE warehouse_corrections SET status = 'POSTED' WHERE id = '${aj.body.id}'::uuid`), /warehouse_corrections_keputusan_chk/, "keputusan tanpa waktu keputusan ditolak");
  const ok = await b.c.post(`${API}/${aj.body.id}/setujui`, {}); assert.equal(ok.status, 200);
  await assert.rejects(testPrisma.$executeRawUnsafe(`UPDATE warehouse_corrections SET decision_note = 'ubah' WHERE id = '${aj.body.id}'::uuid`), /sudah final/);
  await assert.rejects(testPrisma.$executeRawUnsafe(`INSERT INTO stock_movements (id, material_id, type, qty, location, corrects_movement_id) VALUES (gen_random_uuid(), '${(await testPrisma.material.findFirst()).id}'::uuid, 'RECEIPT', -1, 'X', '${(await testPrisma.stockMovement.findFirst()).id}'::uuid)`), /stock_movements_koreksi_chk/);
  const meta = await ajukan(a, gr.id, { metadata: { notes: "baru" } }, "Perbaiki catatan penerimaan"); assert.equal(meta.body.status, "POSTED");
  await assert.rejects(testPrisma.$executeRawUnsafe(`INSERT INTO warehouse_corrections (id, correction_number, doc_type, doc_id, doc_number, kind, status, reason, changes, preview, doc_token, idempotency_key) VALUES (gen_random_uuid(), 'KG-X', 'GOODS_RECEIPT', '${gr.id}'::uuid, 'X', 'METADATA', 'PENDING_APPROVAL', 'alasan cukup', '{}', '{}', 't', 'kunci-uji-12345')`), /warehouse_corrections_keputusan_chk/, "metadata tidak boleh menunggu persetujuan");
  await assert.rejects(testPrisma.$executeRawUnsafe(`INSERT INTO warehouse_corrections (id, correction_number, doc_type, doc_id, doc_number, kind, status, reason, changes, preview, doc_token, idempotency_key) VALUES (gen_random_uuid(), 'KG-Y', 'GOODS_RECEIPT', '${gr.id}'::uuid, 'X', 'STOCK', 'PENDING_APPROVAL', 'abc', '{}', '{}', 't', 'kunci-uji-67890')`), /warehouse_corrections_alasan_chk/);
});

test("GR di alur normal tetap berjalan: Simpan ke Stok menulis pergerakan asal tanpa tautan koreksi; saldo ledger tidak bergeser oleh fitur koreksi", async () => {
  const w = await akun(["WAREHOUSE"]); const m = await createTestMaterial({ unit: "METER" });
  const gr = await w.c.post("/api/inventory/goods-receipts", { sourceType: "MANUAL", supplier: "CV Normal", lines: [{ materialId: m.id }] }); assert.equal(gr.status, 201, JSON.stringify(gr.body));
  for (const s of ["SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"]) assert.equal((await w.c.patch(`/api/inventory/goods-receipts/${gr.body.id}`, { status: s })).status, 200, s);
  assert.equal((await w.c.patch(`/api/inventory/goods-receipts/${gr.body.id}/lines/${gr.body.lines[0].id}`, { receivedQty: 9, acceptedQty: 9, rejectedQty: 0 })).status, 200);
  const put = await w.c.post(`/api/inventory/goods-receipts/${gr.body.id}/putaway`, { location: "RAK-1" }); assert.equal(put.status, 200, JSON.stringify(put.body));
  const mv = await testPrisma.stockMovement.findMany({ where: { goodsReceiptId: gr.body.id } }); assert.equal(mv.length, 1); assert.equal(mv[0].correctionId, null); assert.equal(mv[0].correctsMovementId, null); assert.equal(await saldo(m.id), 9);
  // lalu koreksi bertaut bekerja pada penerimaan nyata hasil alur normal
  const o = await akun(["OWNER"]); const p = await akun(["OWNER"]);
  const aj = await ajukan(o, gr.body.id, { baris: [{ barisId: gr.body.lines[0].id, jumlahBaik: 8 }] }, "Satu unit rusak saat disimpan"); assert.equal(aj.status, 201, JSON.stringify(aj.body));
  const ok = await p.c.post(`${API}/${aj.body.id}/setujui`, {}); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(await saldo(m.id), 8);
  const semua = await testPrisma.stockMovement.findMany({ where: { goodsReceiptId: gr.body.id }, orderBy: { createdAt: "asc" } }); assert.deepEqual(semua.map((x) => Number(x.qty)), [9, -1]); assert.equal(semua[1].correctsMovementId, semua[0].id);
});

test("DRAF boleh diedit sesuai izin dan SETIAP perubahan meninggalkan jejak sebelum–sesudah (GR header+baris, Material Issue header+baris); tanpa perubahan tidak ada jejak", async () => {
  const w = await akun(["WAREHOUSE"]); const m = await createTestMaterial({ unit: "METER" });
  const gr = await w.c.post("/api/inventory/goods-receipts", { sourceType: "MANUAL", supplier: "CV Draf", lines: [{ materialId: m.id }] }); assert.equal(gr.status, 201);
  const ev = (type, id) => testPrisma.activityEvent.findMany({ where: { entityType: type, entityId: id, eventType: "DOCUMENT_EDITED" }, orderBy: { createdAt: "asc" } });
  assert.equal((await w.c.patch(`/api/inventory/goods-receipts/${gr.body.id}`, { notes: "catatan draf", deliveryNote: "SJ-1" })).status, 200);
  let e = await ev("goods_receipt", gr.body.id); assert.equal(e.length, 1); assert.equal(e[0].actorId, w.user.id); assert.deepEqual(e[0].metadata.sebelum, { notes: null, deliveryNote: null }); assert.deepEqual(e[0].metadata.sesudah, { notes: "catatan draf", deliveryNote: "SJ-1" }); assert.equal(e[0].metadata.aksi, "DRAF_DIUBAH");
  assert.equal((await w.c.patch(`/api/inventory/goods-receipts/${gr.body.id}`, { notes: "catatan draf" })).status, 200); assert.equal((await ev("goods_receipt", gr.body.id)).length, 1, "nilai sama = tanpa jejak baru");
  assert.equal((await w.c.patch(`/api/inventory/goods-receipts/${gr.body.id}/lines/${gr.body.lines[0].id}`, { condition: "baik", receivedQty: 5 })).status, 200);
  e = await ev("goods_receipt", gr.body.id); assert.equal(e.length, 2); assert.match(e[1].metadata.bagian, /^baris MAT-/); assert.deepEqual(e[1].metadata.sesudah, { condition: "baik", receivedQty: 5 });
  const unit = await createTestUnit();
  const mi = await w.c.post("/api/inventory/material-issues", { sourceType: "MANUAL", unitId: unit.id, lines: [{ materialId: m.id, requestedQty: 2 }] }); assert.equal(mi.status, 201, JSON.stringify(mi.body));
  assert.equal((await w.c.patch(`/api/inventory/material-issues/${mi.body.id}`, { notes: "perlu cepat", priority: "HIGH" })).status, 200);
  e = await ev("material_issue", mi.body.id); assert.equal(e.length, 1); assert.equal(e[0].metadata.sesudah.notes, "perlu cepat"); assert.equal(e[0].metadata.sesudah.priority, "HIGH");
  assert.equal((await w.c.patch(`/api/inventory/material-issues/${mi.body.id}/lines/${mi.body.lines[0].id}`, { notes: "ambil dari rak A" })).status, 200);
  e = await ev("material_issue", mi.body.id); assert.equal(e.length, 2); assert.equal(e[1].metadata.sesudah.notes, "ambil dari rak A");
  assert.equal((await w.c.get(`${API}/dokumen/MATERIAL_ISSUE/${mi.body.id}`)).body.jalur, "EDIT_DRAF");
  assert.equal(await testPrisma.stockMovement.count(), 0, "edit draf tidak menyentuh stok");
});

test("keadaan untuk formulir: jumlah BERSIH ledger (asal + koreksi), lokasi, bidang yang boleh, bisaMengajukan; berubah setelah koreksi diterapkan; hak baca saja", async () => {
  const o = await akun(["OWNER"]); const p = await akun(["OWNER"]); const lead = await akun(["PRODUCTION_LEAD"]); const sales = await akun(["SALES"]);
  const { gr } = await buatGR({ baris: [{ qty: 10 }], lokasi: "RAK-A" });
  let k = await lead.c.get(`${API}/goods-receipts/${gr.id}/keadaan`); assert.equal(k.status, 200, "pembaca boleh melihat keadaan"); assert.equal(k.body.bisaMengajukan, true); assert.equal(k.body.penerimaan.dariPO, false);
  assert.deepEqual(k.body.bidangMetadata, ["supplier", "sourceReference", "deliveryNote", "notes", "receivedDate"]); assert.equal(k.body.baris[0].jumlahBersih, 10); assert.equal(k.body.baris[0].lokasi, "RAK-A"); assert.equal(k.body.baris[0].bisaUbahStok, true); assert.equal(k.body.penerimaan.receivedDate, "2026-10-10");
  assert.equal((await sales.c.get(`${API}/goods-receipts/${gr.id}/keadaan`)).status, 403); assert.equal((await o.c.get(`${API}/goods-receipts/bukan-uuid/keadaan`)).status, 400); assert.equal((await o.c.get(`${API}/goods-receipts/00000000-0000-4000-8000-000000000000/keadaan`)).status, 404);
  const aj = await ajukan(o, gr.id, { baris: [{ barisId: gr.lines[0].id, jumlahBaik: 6 }] }, "Jumlah baik seharusnya 6");
  k = await o.c.get(`${API}/goods-receipts/${gr.id}/keadaan`); assert.equal(k.body.bisaMengajukan, false, "ada koreksi tertunda"); assert.equal(k.body.koreksiTertunda, 1); assert.equal(k.body.baris[0].jumlahBersih, 10, "belum diterapkan");
  assert.equal((await p.c.post(`${API}/${aj.body.id}/setujui`, {})).status, 200);
  k = await o.c.get(`${API}/goods-receipts/${gr.id}/keadaan`); assert.equal(k.body.bisaMengajukan, true); assert.equal(k.body.baris[0].jumlahBersih, 6, "bersih = asal + koreksi"); assert.equal(k.body.baris[0].jumlahBaikTercatat, 10, "catatan asal tetap");
  // dari PO: bidang metadata dibatasi dan stok tidak bisa diubah
  const po = await testPrisma.finPurchaseOrder.create({ data: { poNumber: "PO-KEADAAN", orderDate: new Date("2026-10-01T00:00:00Z"), status: "DISETUJUI", supplier: { create: { code: "SUP-KEADAAN", name: "Supplier" } } } });
  const g2 = await buatGR({ nomor: "GR-PO-KEADAAN" }); await testPrisma.goodsReceipt.update({ where: { id: g2.gr.id }, data: { purchaseOrderId: po.id, sourceType: "PURCHASE_ORDER" } });
  k = await o.c.get(`${API}/goods-receipts/${g2.gr.id}/keadaan`); assert.equal(k.body.penerimaan.dariPO, true); assert.deepEqual(k.body.bidangMetadata, ["notes"]); assert.equal(k.body.baris[0].bisaUbahStok, false);
  // belum masuk stok: tidak bisa diajukan
  const d = await buatGR({ status: "INSPECTION", nomor: "GR-INSPEKSI" }); assert.equal((await o.c.get(`${API}/goods-receipts/${d.gr.id}/keadaan`)).body.bisaMengajukan, false);
});
