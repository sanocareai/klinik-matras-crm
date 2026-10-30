// "SIMPAN KE STOK" TIDAK BOLEH DITOLAK KARENA SALDO AWAL MINUS — replika GR-141026-01 / PO-13102026-003 (15 Okt 2026), PostgreSQL sungguhan + HTTP.
// Kejadian nyata: LIST-WIBING-ABU (ROLL) bersaldo -388,5 (impor pemakaian historis ISSUE -30 x13 di atas baseline 1,5); penerimaan +5 ROLL ditolak dengan
// "Stok LIST-WIBING-ABU tidak cukup — tersedia -388.5, butuh 5" karena postStockMovement menolak SETIAP hasil akhir < 0, termasuk penambahan stok.
// Yang dikunci: (1) penerimaan positif pada saldo minus lolos dan menambah saldo apa adanya (tidak ada ADJUSTMENT/pembulatan diam-diam);
// (2) pengeluaran (qty<0) tetap ditolak, juga saat saldo sudah minus; (3) satuan: tanpa konversi (ROLL=ROLL) dan dengan konversi ROLL->METER (qty stok = baik x faktor);
// (4) kegagalan di tengah dokumen = rollback utuh, status tetap Siap Disimpan, retry sukses tepat sekali; (5) dua putaway paralel = satu posting; jurnal tepat satu = nilai baik x harga PO.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postStockMovement } from "../../src/services/inventoryLedger.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => {
  await testPrisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS uji_gagal_movement ON stock_movements").catch(() => {});
  await testPrisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS uji_gagal_movement_fn()").catch(() => {});
  await truncateAll();
});
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const kunci = () => ({ "Idempotency-Key": `minus-${randomUUID()}` });
const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  // Admin Finance (ADMIN + FINANCE, seperti akun produksi yang menyetujui PO): PO yang mengubah Harga Berlaku butuh izin harga berlaku.
  const [fin, gudang, admin] = await Promise.all([["FINANCE"], ["WAREHOUSE"], ["ADMIN", "FINANCE"]].map((r) => createTestUser({ roles: r })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-TBF", name: "TOKO BERSAMA FURNITURE", paymentTermType: "HARI", paymentTermDays: 30 } });
  return { f: c(fin), g: c(gudang), a: c(admin), supplier };
}
// Ledger historis: pemakaian diimpor tanpa penerimaan (seperti impor Sept 2026) -> saldo minus.
async function saldoAwal(materialId, qty) {
  await testPrisma.stockMovement.create({ data: { materialId, type: qty >= 0 ? "ADJUSTMENT" : "ISSUE", qty, location: "GUDANG_UTAMA", note: "Uji: saldo awal historis" } });
}
const saldo = async (materialId) => Number((await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${materialId}::uuid`)[0].s);

// PO disetujui -> kedatangan -> periksa (baik/tolak) -> Siap Disimpan. baris: [{ materialId, qty, harga, baik, tolak?, purchaseUnit?, faktor? }]
async function grSiapSimpan(w, baris) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: baris.map((b) => ({ materialId: b.materialId, qty: b.qty, unitPrice: b.harga })) });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const po = (await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {})).body;
  const dtg = await w.g.post(`/api/inventory/barang-akan-datang/${po.id}/kedatangan`, {
    penerima: "Budi Gudang", catatan: "uji", tanggalTiba: hariIni(), suratJalan: `SJ-${randomUUID().slice(0, 6)}`,
    lines: po.lines.map((l, i) => ({ purchaseOrderLineId: l.id, jumlahDatang: baris[i].qty })),
  }, kunci());
  assert.equal(dtg.status, 201, JSON.stringify(dtg.body));
  const grId = dtg.body.receiptId;
  const detail = (await w.g.get(`/api/inventory/goods-receipts/${grId}`)).body;
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${grId}`, { status: "INSPECTION" })).status, 200);
  for (const l of detail.lines) {
    const b = baris.find((x) => x.materialId === l.materialId);
    const r = await w.g.patch(`/api/inventory/goods-receipts/${grId}/lines/${l.id}`, { acceptedQty: b.baik, rejectedQty: b.tolak ?? 0 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${grId}`, { status: "READY_FOR_PUTAWAY" })).status, 200);
  return { po, grId };
}
const putaway = (w, grId) => w.g.post(`/api/inventory/goods-receipts/${grId}/putaway`, {});
const cacah = async (grId) => ({
  mov: await testPrisma.stockMovement.count({ where: { goodsReceiptId: grId } }),
  jurnal: await testPrisma.finJournalEntry.count({ where: { sourceId: grId } }),
  gr: (await testPrisma.goodsReceipt.findUnique({ where: { id: grId } })).status,
});

test("REPLIKA GR-141026-01: penerimaan ROLL pada saldo minus (-388,5 / -116,5) BERHASIL; saldo bertambah apa adanya; tanpa ADJUSTMENT; jurnal tepat satu = baik x harga PO", async () => {
  const w = await dunia();
  const abu = await createTestMaterial({ code: "LIST-WIBING-ABU", name: "LIST WIBING ABU", unit: "ROLL" });
  const coklat = await createTestMaterial({ code: "LIST-WIBING-COKLAT", name: "LIST WIBING COKLAT", unit: "ROLL" });
  const spanbon = await createTestMaterial({ code: "SPANBON-75GRAM", name: "SPANBON 75GRAM", unit: "METER" });
  const streples = await createTestMaterial({ code: "STREPLES-10-13", name: "STREPLES 10/13", unit: "PACK" });
  await saldoAwal(abu.id, 1.5); for (let i = 0; i < 13; i += 1) await saldoAwal(abu.id, -30);           // = -388.5
  await saldoAwal(coklat.id, 3.5); for (let i = 0; i < 4; i += 1) await saldoAwal(coklat.id, -30);       // = -116.5
  await saldoAwal(spanbon.id, 100); await saldoAwal(streples.id, 3);
  assert.equal(await saldo(abu.id), -388.5); assert.equal(await saldo(coklat.id), -116.5);

  const { grId } = await grSiapSimpan(w, [
    { materialId: spanbon.id, qty: 100, harga: 6700, baik: 100 },
    { materialId: abu.id, qty: 5, harga: 90000, baik: 5 },
    { materialId: coklat.id, qty: 10, harga: 85000, baik: 10 },
    { materialId: streples.id, qty: 10, harga: 27000, baik: 10 },
  ]);
  const adj0 = await testPrisma.stockMovement.count({ where: { type: "ADJUSTMENT" } });
  const r = await putaway(w, grId);
  assert.equal(r.status, 200, `Simpan ke Stok harus berhasil: ${JSON.stringify(r.body)}`);
  assert.equal(r.body.status, "COMPLETED");

  assert.equal(await saldo(abu.id), -383.5, "ABU -388,5 + 5");
  assert.equal(await saldo(coklat.id), -106.5, "COKLAT -116,5 + 10");
  assert.equal(await saldo(spanbon.id), 200); assert.equal(await saldo(streples.id), 13);
  const mov = await testPrisma.stockMovement.findMany({ where: { goodsReceiptId: grId }, orderBy: { createdAt: "asc" } });
  assert.equal(mov.length, 4); assert.ok(mov.every((m) => m.type === "RECEIPT" && Number(m.qty) > 0));
  assert.equal(await testPrisma.stockMovement.count({ where: { type: "ADJUSTMENT" } }), adj0, "tidak ada ADJUSTMENT/koreksi diam-diam");
  assert.equal(await testPrisma.stockMovement.count({ where: { materialId: abu.id } }), 15, "ledger ABU: 14 lama + 1 penerimaan");

  const jurnal = await testPrisma.finJournalEntry.findMany({ where: { sourceId: grId }, include: { lines: true } });
  assert.equal(jurnal.filter((j) => j.status === "POSTED").length, 1, "tepat satu jurnal");
  const persediaan = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PERSEDIAAN_BAHAN } });
  const nilai = 100 * 6700 + 5 * 90000 + 10 * 85000 + 10 * 27000;
  const dr = jurnal.flatMap((j) => j.lines).filter((l) => l.accountId === persediaan.id).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  assert.equal(dr, nilai, "Dr Persediaan = baik x harga PO");
});

test("PENGELUARAN tetap ditolak: saldo minus tidak boleh makin minus; pesan menyebut tersedia/butuh untuk keluar saja; penambahan (RECEIPT/RETURN/ADJUSTMENT +) lolos", async () => {
  await truncateAll();
  const m = await createTestMaterial({ code: "LIST-X", unit: "ROLL" });
  await saldoAwal(m.id, -388.5);
  const coba = (type, qty) => testPrisma.$transaction((tx) => postStockMovement(tx, { materialId: m.id, type, qty }));
  for (const [type, qty] of [["ISSUE", -1], ["WASTE", -0.5], ["ADJUSTMENT", -2], ["TRANSFER", -1], ["SUPPLIER_RETURN", -1]]) {
    await assert.rejects(() => coba(type, qty), (e) => /tidak cukup/.test(e.message) && /tersedia -388\.5/.test(e.message), `${type} ${qty} harus ditolak`);
  }
  assert.equal(await saldo(m.id), -388.5, "penolakan tidak menulis apa pun");
  await coba("RECEIPT", 5); assert.equal(await saldo(m.id), -383.5);
  await coba("RETURN", 1); assert.equal(await saldo(m.id), -382.5);
  await coba("ADJUSTMENT", 400); assert.equal(await saldo(m.id), 17.5);
  await assert.rejects(() => coba("ISSUE", -17.6), /tidak cukup/);
  await coba("ISSUE", -17.5); assert.equal(await saldo(m.id), 0, "keluar sampai tepat 0 tetap boleh");
});

test("SATUAN: baris berkonversi ROLL -> METER pada saldo METER minus: qty stok = baik x faktor, harga per METER eksak, lolos; tanpa konversi tetap qty apa adanya", async () => {
  const w = await dunia();
  const baru = { nama: "Kain Serat Uji", kategori: "Kain", jenis: "BAHAN_PRODUKSI", spesifikasi: "uji", satuanBeli: "ROLL", satuanStok: "METER", faktorKonversi: 50, namaSupplier: "KAIN SERAT", kodeSupplier: "KS-1", moq: 1, estimasiKirimHari: 3, lokasi: "Rak A1" };
  const c = await w.a.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), lines: [{ materialBaru: baru, qty: 2, unitPrice: 500000 }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const materialId = c.body.lines[0].materialId;
  assert.equal((await testPrisma.material.findUnique({ where: { id: materialId } })).unit, "METER");
  await saldoAwal(materialId, -400); // setelah +100 METER saldo MASIH minus (-300): inilah yang ditolak sebelum perbaikan
  const po = (await w.a.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {})).body;
  const dtg = await w.g.post(`/api/inventory/barang-akan-datang/${po.id}/kedatangan`, { penerima: "Budi", catatan: "uji", tanggalTiba: hariIni(), suratJalan: "SJ-K1", lines: [{ purchaseOrderLineId: po.lines[0].id, jumlahDatang: 2 }] }, kunci());
  assert.equal(dtg.status, 201, JSON.stringify(dtg.body));
  const grId = dtg.body.receiptId;
  const d = (await w.g.get(`/api/inventory/goods-receipts/${grId}`)).body;
  await w.g.patch(`/api/inventory/goods-receipts/${grId}`, { status: "INSPECTION" });
  assert.equal((await w.g.patch(`/api/inventory/goods-receipts/${grId}/lines/${d.lines[0].id}`, { acceptedQty: 2, rejectedQty: 0 })).status, 200);
  await w.g.patch(`/api/inventory/goods-receipts/${grId}`, { status: "READY_FOR_PUTAWAY" });

  const r = await putaway(w, grId);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const mov = await testPrisma.stockMovement.findFirst({ where: { goodsReceiptId: grId } });
  assert.equal(Number(mov.qty), 100, "2 ROLL x 50 = 100 METER");
  assert.equal(Number(mov.unitCostExact), 10000, "500.000 / 50 = 10.000 per METER");
  assert.equal(await saldo(materialId), -300, "-400 + 100 (tetap minus, apa adanya)");
  const jurnal = await testPrisma.finJournalEntry.findMany({ where: { sourceId: grId, status: "POSTED" }, include: { lines: true } });
  assert.equal(jurnal.length, 1);
  assert.equal(jurnal[0].lines.reduce((s, l) => s + Number(l.debit), 0), 2 * 500000, "nilai = baik(ROLL) x harga PO = 100 METER x 10.000");
});

test("RETRY & TEPAT SEKALI: kegagalan di baris ke-2 = rollback utuh (tanpa movement/jurnal, status tetap Siap Disimpan); setelah penyebab hilang, retry sukses TEPAT sekali; putaway ulang ditolak", async () => {
  const w = await dunia();
  const a = await createTestMaterial({ code: "MAT-RETRY-A", unit: "ROLL" });
  const b = await createTestMaterial({ code: "MAT-RETRY-B", unit: "ROLL" });
  await saldoAwal(a.id, -388.5); await saldoAwal(b.id, -10);
  const { grId } = await grSiapSimpan(w, [{ materialId: a.id, qty: 5, harga: 90000, baik: 5 }, { materialId: b.id, qty: 3, harga: 85000, baik: 3 }]);
  // Gangguan sementara pada material B saja (mis. galat infrastruktur): baris A sudah tertulis di dalam transaksi lalu baris B gagal.
  await testPrisma.$executeRawUnsafe(`CREATE FUNCTION uji_gagal_movement_fn() RETURNS trigger AS $$ BEGIN IF NEW.material_id = '${b.id}'::uuid THEN RAISE EXCEPTION 'gangguan uji'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await testPrisma.$executeRawUnsafe("CREATE TRIGGER uji_gagal_movement BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION uji_gagal_movement_fn()");
  const gagal = await putaway(w, grId);
  assert.ok(gagal.status >= 400, `harus gagal: ${gagal.status}`);
  assert.deepEqual(await cacah(grId), { mov: 0, jurnal: 0, gr: "READY_FOR_PUTAWAY" }, "rollback utuh: tidak ada stok/jurnal setengah jadi");
  assert.equal(await saldo(a.id), -388.5); assert.equal(await saldo(b.id), -10);

  await testPrisma.$executeRawUnsafe("DROP TRIGGER uji_gagal_movement ON stock_movements");
  const ok = await putaway(w, grId);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(await cacah(grId), { mov: 2, jurnal: 1, gr: "COMPLETED" });
  assert.equal(await saldo(a.id), -383.5); assert.equal(await saldo(b.id), -7);
  const lagi = await putaway(w, grId);
  assert.equal(lagi.status, 400, "putaway ulang ditolak (status bukan Siap Disimpan)");
  assert.match(lagi.body.error, /Siap Disimpan/);
  assert.deepEqual(await cacah(grId), { mov: 2, jurnal: 1, gr: "COMPLETED" }, "tidak bertambah");
});

test("DUA PUTAWAY PARALEL untuk GR yang sama pada saldo minus: tepat satu berhasil; movement dan jurnal tepat satu set", async () => {
  const w = await dunia();
  const a = await createTestMaterial({ code: "MAT-PAR-A", unit: "ROLL" });
  await saldoAwal(a.id, -388.5);
  const { grId } = await grSiapSimpan(w, [{ materialId: a.id, qty: 5, harga: 90000, baik: 5 }]);
  const hasil = await Promise.all([putaway(w, grId), putaway(w, grId), putaway(w, grId)]);
  const sukses = hasil.filter((x) => x.status === 200).length;
  assert.equal(sukses, 1, `status: ${hasil.map((x) => x.status).join(",")}`);
  assert.ok(hasil.filter((x) => x.status !== 200).every((x) => [400, 409].includes(x.status)));
  assert.deepEqual(await cacah(grId), { mov: 1, jurnal: 1, gr: "COMPLETED" });
  assert.equal(await saldo(a.id), -383.5, "ditambah SEKALI");
});
