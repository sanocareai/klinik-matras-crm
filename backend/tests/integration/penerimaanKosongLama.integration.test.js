// DOKUMEN KOSONG LAMA — penerimaan dari PO yang statusnya maju (mis. Siap Disimpan) tanpa kedatangan & tanpa jumlah (lahir sebelum Catat Barang Tiba wajib).
// Dikunci: (1) bendera "Siap Disimpan"/"Perlu diperiksa" mengikuti ISI, bukan status; (2) Simpan ke Stok menolak dokumen itu tanpa menulis apa pun;
// (3) Catat Barang Tiba MEMAKAI dokumen itu (satu pengiriman = satu penerimaan; tidak ada dokumen kedua), status kembali ke Tiba, audit mencatat status sebelumnya;
// (4) dokumen kosong yang punya stok/tagihan menempel TIDAK dipakai; (5) Tolak dokumen kosong tidak mengubah angka sisa PO;
// (6) alur lengkap sampai Simpan ke Stok: stok = jumlah baik, nilai = baik × harga PO, jurnal tidak ganda.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const H = 649_350;
const kunci = () => ({ "Idempotency-Key": `kosong-${randomUUID()}` });
const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const [fin, gudang] = await Promise.all(["FINANCE", "WAREHOUSE"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-ESA", name: "PT ESA BUMINDO", paymentTermType: "HARI", paymentTermDays: 30 } });
  const lem = await createTestMaterial({ code: "LEM-1037", name: "LEM I-SR 1037 13 KG", unit: "CAN" });
  return { f: c(fin), g: c(gudang), supplier, lem };
}
async function poDisetujui(w, { qty = 10 } = {}) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: geser(-8), expectedDate: geser(-2), lines: [{ materialId: w.lem.id, qty, unitPrice: H }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}
// Keadaan lama: penerimaan DRAFT dari PO yang statusnya digeser maju tanpa Catat Barang Tiba (tidak bisa lagi lewat API; ditanam langsung seperti data produksi).
async function dokumenKosongLama(w, po, status = "READY_FOR_PUTAWAY") {
  const r = await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await testPrisma.goodsReceipt.update({ where: { id: r.body.id }, data: { status } });
  return r.body;
}
const detailG = async (w, poId) => (await w.g.get(`/api/inventory/barang-akan-datang/${poId}`)).body;
const cacah = async () => ({ stok: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), penerimaan: await testPrisma.goodsReceipt.count() });

test("DOKUMEN KOSONG 'Siap Disimpan': bendera tidak menyala, Simpan ke Stok menolak tanpa menulis, angka PO tidak berubah, Tolak tidak mengubah sisa PO", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const gr = await dokumenKosongLama(w, po);
  const awal = await cacah();

  const g = await detailG(w, po.id);
  assert.ok(!g.bendera.some((b) => b.kode === "SIAP_DISIMPAN"), JSON.stringify(g.bendera));
  assert.ok(!g.bendera.some((b) => b.kode === "PERLU_DIPERIKSA"));
  assert.equal(g.statusAkanDatang.kode, "TERLAMBAT");
  const p = g.penerimaan.find((x) => x.id === gr.id);
  assert.equal(p.kosong, true);
  assert.equal(p.kedatanganDicatat, false);
  assert.deepEqual([g.lines[0].dipesan, g.lines[0].datang, g.lines[0].belumDatang, g.lines[0].belumDipenuhiSupplier, g.lines[0].masukStok], [10, 0, 10, 10, 0]);

  const s = await w.g.post(`/api/inventory/goods-receipts/${gr.id}/putaway`, {});
  assert.ok([400, 409].includes(s.status), `status ${s.status}`);
  assert.match(s.body.error, /Accepted Quantity|hasil inspeksi/);
  assert.deepEqual(await cacah(), awal, "penolakan Simpan ke Stok tidak menulis apa pun");

  // Tolak dokumen kosong: angka sisa PO TIDAK berubah (dokumen itu memang tidak menyumbang apa pun)
  const t = await w.g.patch(`/api/inventory/goods-receipts/${gr.id}/reject`, { reason: "Dokumen kosong lama (tanpa kedatangan)" });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  const g2 = await detailG(w, po.id);
  assert.deepEqual([g2.lines[0].dipesan, g2.lines[0].datang, g2.lines[0].belumDatang, g2.lines[0].belumDipenuhiSupplier, g2.lines[0].masukStok], [10, 0, 10, 10, 0]);
  assert.equal((await testPrisma.finPurchaseOrder.findUnique({ where: { id: po.id } })).status, "DISETUJUI", "status PO tidak berubah karena Tolak");
  assert.equal((await cacah()).stok, awal.stok); assert.equal((await cacah()).jurnal, awal.jurnal);
});

test("Catat Barang Tiba MEMAKAI dokumen kosong lama (satu pengiriman = satu penerimaan) → periksa → Simpan ke Stok: stok = jumlah baik, nilai = baik × harga PO, jurnal tidak ganda", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const gr = await dokumenKosongLama(w, po, "INSPECTION");
  const awal = await cacah();

  const r = await w.g.post(`/api/inventory/barang-akan-datang/${po.id}/kedatangan`, { penerima: "Budi Gudang", catatan: "Lem tiba 10 kaleng", tanggalTiba: geser(-1), suratJalan: "SJ-ESA-77", lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: 10 }] }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.receiptId, gr.id, "dokumen kosong lama dipakai, bukan dokumen baru");
  assert.equal(await testPrisma.goodsReceipt.count(), awal.penerimaan, "tidak ada dokumen penerimaan kedua");
  const baris = await testPrisma.goodsReceipt.findUnique({ where: { id: gr.id } });
  assert.equal(baris.status, "ARRIVED"); assert.equal(baris.arrivalRevision, 1);
  const ev = await testPrisma.goodsReceiptEvent.findFirst({ where: { goodsReceiptId: gr.id, type: "KEDATANGAN_DICATAT" } });
  assert.equal(ev.before.status, "INSPECTION", "audit mencatat status sebelum dipakai ulang");
  assert.equal((await cacah()).stok, awal.stok, "mencatat kedatangan tidak menulis stok");

  // pemeriksaan fisik: 9 baik, 1 ditolak → Simpan ke Stok
  const detail = (await w.g.get(`/api/inventory/goods-receipts/${gr.id}`)).body;
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${gr.id}`, { status: "INSPECTION" })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${gr.id}/lines/${detail.lines[0].id}`, { acceptedQty: 9, rejectedQty: 1 })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${gr.id}`, { status: "READY_FOR_PUTAWAY" })).status, 200);
  const g = await detailG(w, po.id);
  assert.ok(g.bendera.some((b) => b.kode === "SIAP_DISIMPAN"), "ada barang baik → Siap Disimpan menyala");
  const sj = await w.g.post(`/api/inventory/goods-receipts/${gr.id}/putaway`, {});
  assert.equal(sj.status, 200, JSON.stringify(sj.body));

  const stok = await testPrisma.stockMovement.findMany({ where: { goodsReceiptId: gr.id } });
  assert.equal(stok.length, 1);
  assert.equal(Number(stok[0].qty), 9, "stok = jumlah baik (bukan datang)");
  const persediaan = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PERSEDIAAN_BAHAN } });
  const grni = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.UTANG_BELUM_DITAGIH } });
  const jurnal = await testPrisma.finJournalEntry.findMany({ where: { sourceId: gr.id }, include: { lines: true } });
  const nilai = 9 * H;
  const dr = jurnal.flatMap((j) => j.lines).filter((l) => l.accountId === persediaan.id).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  const cr = jurnal.flatMap((j) => j.lines).filter((l) => l.accountId === grni.id).reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);
  assert.equal(dr, nilai, "persediaan = baik × harga PO"); assert.equal(cr, nilai, "GRNI = baik × harga PO");
  assert.equal(jurnal.filter((j) => j.status === "POSTED").length, 1, "tepat satu jurnal penerimaan untuk dokumen ini");
  const prog = (await detailG(w, po.id)).lines[0];
  assert.deepEqual([prog.datang, prog.ditolak, prog.masukStok, prog.menungguPengganti, prog.belumDatang], [10, 1, 9, 1, 0]);
});

test("dokumen kosong yang punya stok atau tagihan menempel TIDAK dipakai: kedatangan membuat draf baru", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const gr = await dokumenKosongLama(w, po);
  // stok menempel pada dokumen itu (pelanggaran invarian yang tidak boleh ditebak) → bukan "kosong" yang aman dipakai
  await testPrisma.stockMovement.create({ data: { materialId: w.lem.id, type: "RECEIPT", qty: 1, goodsReceiptId: gr.id, reason: "uji" } });
  const r = await w.g.post(`/api/inventory/barang-akan-datang/${po.id}/kedatangan`, { penerima: "Budi Gudang", catatan: "Tiba", tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: 10 }] }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.notEqual(r.body.receiptId, gr.id);
  assert.equal((await testPrisma.goodsReceipt.findUnique({ where: { id: gr.id } })).status, "READY_FOR_PUTAWAY", "dokumen lama tidak disentuh");
});

test("penerimaan Siap Disimpan yang kedatangannya SUDAH dicatat tetapi belum ada jumlah baik: bukan 'Siap Disimpan' (Perlu Diperiksa) dan tidak dipakai ulang", async () => {
  const w = await dunia();
  const po = await poDisetujui(w);
  const r = await w.g.post(`/api/inventory/barang-akan-datang/${po.id}/kedatangan`, { penerima: "Budi Gudang", catatan: "Tiba", tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: 4 }] }, kunci());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${r.body.receiptId}`, { status: "INSPECTION" })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${r.body.receiptId}`, { status: "READY_FOR_PUTAWAY" })).status, 200);
  const g = await detailG(w, po.id);
  assert.ok(!g.bendera.some((b) => b.kode === "SIAP_DISIMPAN"), "tanpa jumlah baik tidak ada yang bisa disimpan");
  assert.ok(g.bendera.some((b) => b.kode === "PERLU_DIPERIKSA"));
  assert.equal(g.penerimaan[0].kosong, false);
  const lagi = await w.g.post(`/api/inventory/barang-akan-datang/${po.id}/kedatangan`, { penerima: "Budi", catatan: "Tiba lagi", tanggalTiba: geser(-1), lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: 6 }] }, kunci());
  assert.equal(lagi.status, 201, JSON.stringify(lagi.body));
  assert.notEqual(lagi.body.receiptId, r.body.receiptId, "pengiriman kedua = penerimaan kedua; yang sudah dicatat tidak ditimpa");
});
