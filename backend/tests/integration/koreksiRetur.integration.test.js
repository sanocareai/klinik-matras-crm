// LINTAS FITUR — Koreksi Penerimaan × Retur Supplier & Debit Note (kandidat gabungan). Yang dikunci:
// (1) koreksi KUANTITAS pada baris dengan retur draf/keluar/selesai → 409 RETUR_AKTIF, lalu boleh setelah retur dibatalkan (+ trigger DB pagar terakhir);
// (2) koreksi lembar/kaitan pengganti pada baris yang punya retur TIDAK menyentuh kolom jumlah (tanpa galat trigger);
// (3) urutan: koreksi baik lalu retur → kapasitas retur memakai jumlah baru; jurnal/stok/GRNI/persediaan seimbang tanpa residual; rata-rata harga mengurangkan pembalik DAN retur;
// (4) retur pada penerimaan lain BUKAN pemakaian (koreksi sah); pemakaian Produksi sesudahnya memblokir (STOK_SUDAH_BERGERAK);
// (5) paralel koreksi vs retur: invarian stok = baik − diretur, persediaan = stok × harga.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { dasarHargaRataRata } from "../../src/services/finance/posting/inventory.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const H = 43_290;
const kunci = () => ({ "Idempotency-Key": `kr-${randomUUID()}` });
const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);
const BUKTI = ["https://contoh.invalid/foto.jpg"];

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const [fin, gudang, approver] = await Promise.all(["FINANCE", "WAREHOUSE", "APPROVER"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-ESA", name: "PT ESA BUMINDO", paymentTermType: "HARI", paymentTermDays: 30 } });
  const busa = await createTestMaterial({ code: "BUSA-R50", name: "Busa Rebonded R50", unit: "KG" });
  return { f: c(fin), g: c(gudang), ap: c(approver), supplier, busa };
}
async function poDisetujui(w, { qty = 10, harga = H, pendamping } = {}) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: geser(-20), lines: [{ materialId: w.busa.id, qty, unitPrice: harga, ...(pendamping && { pendamping }) }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {});
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}
async function terimaSimpan(w, po, jumlah, { baik = jumlah, tanggal = geser(-5), lembar } = {}) {
  const t = await w.g.post(`/api/inventory/barang-akan-datang/${po.id}/kedatangan`, { penerima: "Budi Gudang", catatan: "Barang tiba utuh", tanggalTiba: tanggal, suratJalan: `SJ-${jumlah}`, lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: jumlah, ...(lembar !== undefined && { jumlahPendamping: lembar }) }] }, kunci());
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const id = t.body.receiptId;
  const gr = (await w.g.get(`/api/inventory/goods-receipts/${id}`)).body;
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}`, { status: "INSPECTION" })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}/lines/${gr.lines[0].id}`, { acceptedQty: baik, rejectedQty: jumlah - baik })).status, 200);
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${id}`, { status: "READY_FOR_PUTAWAY" })).status, 200);
  const p = await w.g.post(`/api/inventory/goods-receipts/${id}/putaway`, {}); assert.equal(p.status, 200, JSON.stringify(p.body));
  return { receiptId: id, lineId: gr.lines[0].id };
}
const revisi = async (id) => (await testPrisma.goodsReceipt.findUnique({ where: { id }, select: { arrivalRevision: true } })).arrivalRevision;
const kor = (w, id, perubahan, rev, alasan = "Salah catat saat input") => w.g.post(`/api/inventory/barang-akan-datang/penerimaan/${id}/koreksi`, { revisi: rev, alasan, perubahan }, kunci());
const retur = (w, lineId, qty) => w.g.post("/api/inventory/retur-supplier", { reasonCode: "RUSAK", reason: "Busa pecah-pecah saat dibongkar", evidenceUrls: BUKTI, lines: [{ goodsReceiptLineId: lineId, qty }] }, kunci());
const keluar = (w, id) => w.g.post(`/api/inventory/retur-supplier/${id}/keluar`, { pic: "Budi Gudang", note: "Diserahkan ke kurir", proofUrls: BUKTI }, kunci());
async function saldo(systemKey) {
  const a = await testPrisma.finAccount.findUnique({ where: { systemKey } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: a.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Math.round((Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0)) * 100) / 100;
}
const stokTotal = async () => Number((await testPrisma.stockMovement.aggregate({ _sum: { qty: true } }))._sum.qty ?? 0);

test("RETUR AKTIF menolak koreksi kuantitas (draf, keluar/selesai) 409 RETUR_AKTIF; lembar & kaitan tetap boleh tanpa galat trigger; boleh setelah retur dibatalkan", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10, pendamping: { satuan: "LEMBAR", mode: "AKTUAL", estimasi: 2 } });
  const L = po.lines[0].id;
  const r = await terimaSimpan(w, po, 6, { lembar: 1 });
  const draf = (await retur(w, r.lineId, 1)).body;
  assert.ok(draf.returnId, JSON.stringify(draf));

  // retur DRAF
  const k1 = await kor(w, r.receiptId, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 5, jumlahBaik: 5 }] }, 1);
  assert.equal(k1.status, 409); assert.equal(k1.body.code, "RETUR_AKTIF"); assert.match(k1.body.error, /Draf/); assert.match(k1.body.arah, /Batalkan Retur Supplier/);
  // lembar saja → boleh (tidak menyentuh kolom jumlah → trigger tidak aktif); retur draf belum mengunci
  const lembar = await kor(w, r.receiptId, { lines: [{ purchaseOrderLineId: L, jumlahPendamping: 2 }] }, 1, "Hitung ulang lembar");
  assert.equal(lembar.status, 200, JSON.stringify(lembar.body));

  // barang KELUAR (tanpa faktur → langsung Selesai)
  const k = await keluar(w, draf.returnId);
  assert.equal(k.status, 200, JSON.stringify(k.body));
  const rev = await revisi(r.receiptId);
  const k2 = await kor(w, r.receiptId, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 5, jumlahBaik: 5 }] }, rev);
  assert.equal(k2.status, 409); assert.equal(k2.body.code, "RETUR_AKTIF"); assert.match(k2.body.error, /RTS-/);
  const k3 = await kor(w, r.receiptId, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 7 }] }, rev);
  assert.equal(k3.status, 409); assert.equal(k3.body.code, "RETUR_AKTIF");
  // lembar pada baris yang SUDAH punya retur keluar: tidak boleh memicu galat trigger DB (kolom jumlah tidak ditulis)
  const lembar2 = await kor(w, r.receiptId, { lines: [{ purchaseOrderLineId: L, jumlahPendamping: 3 }] }, rev, "Lembar dihitung ulang setelah retur");
  assert.equal(lembar2.status, 200, JSON.stringify(lembar2.body));
  assert.equal(Number((await testPrisma.goodsReceiptLine.findFirst({ where: { goodsReceiptId: r.receiptId } })).companionQty), 3);
  // PIC saja
  assert.equal((await kor(w, r.receiptId, { penerima: "Budi (ralat)" }, await revisi(r.receiptId), "Ralat PIC")).status, 200);
  // trigger DB tetap pagar terakhir
  await assert.rejects(testPrisma.goodsReceiptLine.update({ where: { id: r.lineId }, data: { acceptedQty: 5 } }), /Retur Supplier aktif/);

  // retur dibatalkan (barang kembali) → koreksi boleh
  const batal = await w.g.post(`/api/inventory/retur-supplier/${draf.returnId}/batal`, { reason: "Supplier menarik sendiri barangnya" }, kunci());
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  const ok = await kor(w, r.receiptId, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 5, jumlahBaik: 5 }] }, await revisi(r.receiptId), "Dus keenam salah hitung");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.jalur, "PEMBALIK_PENGGANTI");
});

test("URUTAN: koreksi baik 6→5 lalu retur 2 KG: kapasitas retur memakai jumlah baru; stok/persediaan/GRNI seimbang; rata-rata harga mengurangkan pembalik dan retur", async () => {
  const w = await dunia();
  const poA = await poDisetujui(w, { qty: 10, harga: 30_000 });
  await terimaSimpan(w, poA, 10, { tanggal: geser(-9) });
  const poB = await poDisetujui(w, { qty: 6, harga: 40_000 });
  const B = await terimaSimpan(w, poB, 6, { tanggal: geser(-4) });
  assert.deepEqual([await stokTotal(), await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN)], [16, 300_000 + 240_000]);

  const ok = await kor(w, B.receiptId, { lines: [{ purchaseOrderLineId: poB.lines[0].id, jumlahDatang: 5, jumlahBaik: 5 }] }, 1, "Dus keenam salah hitung");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([await stokTotal(), await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH)], [15, 300_000 + 200_000, -(300_000 + 200_000)]);
  let d = await dasarHargaRataRata(testPrisma, w.busa.id);
  assert.equal(Number(d.totalQty), 15); assert.equal(Number(d.totalNilai), 500_000);

  // retur 6 KG > 5 baru → ditolak jelas; 2 KG sah
  const lebih = await retur(w, B.lineId, 6);
  assert.equal(lebih.status, 409, JSON.stringify(lebih.body));
  const r2 = await retur(w, B.lineId, 2);
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  const k = await keluar(w, r2.body.returnId);
  assert.equal(k.status, 200, JSON.stringify(k.body));
  // stok 13; persediaan = 300.000 + 3×40.000; GRNI sama; tanpa residual
  assert.deepEqual([await stokTotal(), await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH)], [13, 300_000 + 120_000, -(300_000 + 120_000)]);
  d = await dasarHargaRataRata(testPrisma, w.busa.id);
  assert.equal(Number(d.totalQty), 13, "rata-rata: 10 + (6 − 6 pembalik + 5 pengganti − 2 retur)");
  assert.equal(Number(d.totalNilai), 420_000);
  // koreksi pada penerimaan yang sudah punya retur selesai ditolak
  const rev = await revisi(B.receiptId);
  const k3 = await kor(w, B.receiptId, { lines: [{ purchaseOrderLineId: poB.lines[0].id, jumlahDatang: 4, jumlahBaik: 4 }] }, rev);
  assert.equal(k3.status, 409); assert.equal(k3.body.code, "RETUR_AKTIF");
});

test("RETUR pada penerimaan LAIN bukan pemakaian dari kolam stok: koreksi penerimaan A tetap sah; Produksi (ISSUE) setelahnya memblokir; paritas stok/persediaan/GRNI terjaga", async () => {
  const w = await dunia();
  const poA = await poDisetujui(w, { qty: 5 });
  const A = await terimaSimpan(w, poA, 5, { tanggal: geser(-8) });
  const poB = await poDisetujui(w, { qty: 5 });
  const B = await terimaSimpan(w, poB, 5, { tanggal: geser(-3) });
  const r = await retur(w, B.lineId, 1);
  assert.equal((await keluar(w, r.body.returnId)).status, 200);
  const k = await kor(w, A.receiptId, { lines: [{ purchaseOrderLineId: poA.lines[0].id, jumlahDatang: 4, jumlahBaik: 4 }] }, 1);
  assert.equal(k.status, 200, JSON.stringify(k.body));
  // A: 10 − 1 (koreksi) ; B: 5 − 1 (retur) → stok 8; persediaan & GRNI = 8 × harga
  assert.deepEqual([await stokTotal(), await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH)], [8, 8 * H, -8 * H]);
  // Produksi memakai bahan sesudahnya → koreksi lagi diblokir (asal stok tak pasti)
  await testPrisma.stockMovement.create({ data: { materialId: w.busa.id, type: "ISSUE", qty: -2, reason: "Dipakai produksi (uji)", createdAt: new Date(Date.now() + 1000) } });
  const awal = { stok: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count() };
  const k2 = await kor(w, A.receiptId, { lines: [{ purchaseOrderLineId: poA.lines[0].id, jumlahDatang: 3, jumlahBaik: 3 }] }, 2);
  assert.equal(k2.status, 409); assert.equal(k2.body.code, "STOK_SUDAH_BERGERAK"); assert.match(k2.body.error, /ISSUE/);
  assert.deepEqual({ stok: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count() }, awal);
});

test("PARALEL koreksi vs retur pada baris yang sama: apa pun pemenangnya, stok = baik − diretur dan persediaan = stok × harga (tanpa residual, tanpa stok negatif)", async () => {
  const w = await dunia();
  const po = await poDisetujui(w, { qty: 10 });
  const L = po.lines[0].id;
  const r = await terimaSimpan(w, po, 6);
  const [ka, rb] = await Promise.all([
    kor(w, r.receiptId, { lines: [{ purchaseOrderLineId: L, jumlahDatang: 5, jumlahBaik: 5 }] }, 1),
    (async () => { const d = await retur(w, r.lineId, 2); if (d.status !== 201) return d; return { draf: d, keluar: await keluar(w, d.body.returnId) }; })(),
  ]);
  assert.ok([200, 409].includes(ka.status), JSON.stringify(ka.body));
  const baik = Number((await testPrisma.goodsReceiptLine.findFirst({ where: { goodsReceiptId: r.receiptId } })).acceptedQty);
  const diretur = Number((await testPrisma.supplierReturnLine.aggregate({ where: { supplierReturn: { status: { in: ["KELUAR", "SELESAI"] } } }, _sum: { qty: true } }))._sum.qty ?? 0);
  assert.equal(await stokTotal(), baik - diretur, `stok = baik(${baik}) − diretur(${diretur}); koreksi=${ka.status} retur=${JSON.stringify(rb.keluar?.status ?? rb.status)}`);
  assert.equal(await saldo(SYSTEM_KEYS.PERSEDIAAN_BAHAN), (baik - diretur) * H);
  assert.equal(await saldo(SYSTEM_KEYS.UTANG_BELUM_DITAGIH), -(baik - diretur) * H);
  assert.ok(await stokTotal() >= 0);
  if (ka.status === 200) assert.equal(baik, 5);
});
