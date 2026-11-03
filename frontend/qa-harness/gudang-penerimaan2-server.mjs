// QA Redesain Penerimaan (4 Nov 2026) — server backend ASLI (buildTestApp, tanpa penjadwal) di atas database SANDBOX terisolasi (nama wajib mengandung "test"), data uji deterministik untuk
// pengiriman bertahap / kelebihan / revisi PO / koreksi / pengganti / tata letak. Semua nama bahan & supplier = DATA SANDBOX. Dipakai bersama gudang-penerimaan2-skenario.cjs.
//   TEST_DATABASE_URL=postgresql://klinik:…@localhost:5432/klinik_matras_test_gudang_pen2_qa  (migrasi dulu: node backend/tests/integration/setup/bootstrapTestDb.js)
//   JWT_SECRET=… PORT=4480 OUT=C:/tmp/gud-qa/pen2 node frontend/qa-harness/gudang-penerimaan2-server.mjs
// Rute /qa/* hanya ada di server uji ini (membaca DB untuk bukti: stok, pergerakan, status dokumen, progres PO).
import "../../backend/tests/integration/setup/env.js";
import fs from "node:fs"; import path from "node:path";
import { testPrisma, truncateAll } from "../../backend/tests/integration/setup/testDb.js";
import { createTestUser, createTestMaterial } from "../../backend/tests/integration/setup/fixtures.js";
import { buildTestApp, startTestServer } from "../../backend/tests/integration/setup/testApp.js";
import { makeClient } from "../../backend/tests/integration/setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../backend/src/services/finance/accounts.js";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 4480); const OUT = process.env.OUT || "C:/tmp/gud-qa/pen2";
fs.mkdirSync(OUT, { recursive: true });
await truncateAll();
await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));

const bantu = await startTestServer(buildTestApp());
const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);
const kunci = () => ({ "Idempotency-Key": `sbx-${randomUUID()}` });

const T = {};
for (const [k, roles, nama] of [["gudang", ["WAREHOUSE"], "Gudang Sandbox"], ["finance", ["FINANCE"], "Finance Sandbox"], ["admin", ["ADMIN"], "Admin Sandbox"], ["approver", ["APPROVER"], "Approver Sandbox"], ["lihat", ["PRODUCTION_LEAD"], "Pemimpin Produksi Sandbox"]]) {
  const { user, token } = await createTestUser({ roles });
  await testPrisma.user.update({ where: { id: user.id }, data: { name: nama } });
  T[k] = { token, user: { id: user.id, name: nama, email: user.email, role: roles[0], roles, divisions: k === "gudang" ? ["WAREHOUSE"] : [] } };
}
fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(T, null, 2));
const c = (k) => makeClient(bantu.baseUrl, T[k].token);
const f = c("finance"); const g = c("gudang"); const ap = c("approver");

const sup = (code, name) => testPrisma.finSupplier.create({ data: { code, name, paymentTermType: "HARI", paymentTermDays: 30 } });
const sOcean = await sup("SBX-OCEAN", "PT Ocean Centra Sandbox"); const sMak = await sup("SBX-MAK", "CV Makmur Abadi Sandbox");

// Bahan: nama panjang meniru kasus nyata (kode == nama → kode disembunyikan) + bahan lain (kode berbeda dari nama → kode tampil).
const busa = await createTestMaterial({ code: "BUSA-OCEAN-D18-120X200X2CM", name: "BUSA OCEAN D18 120X200X2CM", unit: "PCS" });
const kainX = await createTestMaterial({ code: "SBX-KAIN-X", name: "Kain Oscar ivory", unit: "METER" });
const kainK = await createTestMaterial({ code: "SBX-LEM-K", name: "Lem SRI", unit: "PCS" });
const benangP = await createTestMaterial({ code: "SBX-BENANG-P", name: "Benang halus hitam", unit: "PCS" });
const busaG = await createTestMaterial({ code: "SBX-BUSA-G", name: "Busa rebonded R50", unit: "KG" });
const panjang = [];
const NAMA = ["Kain Oscar Premium Anti Air Warna Ivory Gading Lebar 150 cm Gulungan Besar Edisi Khusus Hotel Bintang Lima", "BUSA ROYAL FOAM D23 200X200X20CM ORIGINAL SUPER", "Lem Aica Aibon 5 KG Kaleng Besar Serbaguna Kuat", "Benang Jahit Nylon Industri Hitam 3000 Yard", "Resleting Kasur Premium 3 Meter Warna Putih Bersih", "Karet Gelang Besar Elastis Warna Kuning", "Kardus Packing Kasur Queen 160X200 Tebal Triple Wall", "Plastik Wrapping Kasur Bening Tebal 0.2 mm", "Label Woven Sano Care Premium 3 cm", "Handle Kasur Nylon Hitam Kuat 12 cm"];
for (let i = 0; i < NAMA.length; i++) panjang.push(await createTestMaterial({ code: `SBX-LONG-${String(i + 1).padStart(2, "0")}`, name: NAMA[i], unit: i % 2 ? "PCS" : "METER" }));

async function po(supplier, lines, { orderDate = geser(-12), expected = geser(-1) } = {}) {
  const r = await f.post("/api/finance/purchase-orders", { supplierId: supplier.id, orderDate, expectedDate: expected, lines });
  if (r.status !== 201) throw new Error(`PO gagal: ${JSON.stringify(r.body)}`);
  const s = await f.post(`/api/finance/purchase-orders/${r.body.id}/approve`, {});
  if (s.status !== 200) throw new Error(`approve PO gagal: ${JSON.stringify(s.body)}`);
  return s.body;
}
const buatDraf = async (poId, expected = geser(-1), lines = undefined) => { const r = await g.post("/api/inventory/goods-receipts", { purchaseOrderId: poId, expectedDate: expected, ...(lines && { lines }) }); if (r.status !== 201) throw new Error(`draf gagal: ${JSON.stringify(r.body)}`); return r.body.receipt ?? r.body; };
const jadwalkan = async (id) => { const r = await g.patch(`/api/inventory/goods-receipts/${id}`, { status: "SCHEDULED" }); if (r.status !== 200) throw new Error(`jadwal: ${JSON.stringify(r.body)}`); };
const tiba = async (poId, receiptId, lines, tgl = geser(-3)) => { const r = await g.post(`/api/inventory/barang-akan-datang/${poId}/kedatangan`, { receiptId, penerima: "Budi Gudang", catatan: "Barang tiba utuh", tanggalTiba: tgl, lines }, kunci()); if (r.status !== 201) throw new Error(`tiba gagal: ${JSON.stringify(r.body)}`); return r.body.receiptId ?? receiptId; };
const periksa = async (grId, isiBaris, { simpan = true } = {}) => {
  let gr = (await g.get(`/api/inventory/goods-receipts/${grId}`)).body;
  const st = async (status) => { const r = await g.patch(`/api/inventory/goods-receipts/${grId}`, { status }); if (r.status !== 200) throw new Error(`${status}: ${JSON.stringify(r.body)}`); };
  if (gr.status === "ARRIVED") await st("INSPECTION");
  gr = (await g.get(`/api/inventory/goods-receipts/${grId}`)).body;
  for (const l of gr.lines) { const isi = isiBaris(l); if (!isi) continue; const r = await g.patch(`/api/inventory/goods-receipts/${grId}/lines/${l.id}`, isi); if (r.status !== 200) throw new Error(`baris: ${JSON.stringify(r.body)}`); }
  if (simpan) { await st("READY_FOR_PUTAWAY"); const p = await g.post(`/api/inventory/goods-receipts/${grId}/putaway`, {}); if (p.status !== 200) throw new Error(`putaway: ${JSON.stringify(p.body)}`); }
};

const ID = { po: {}, poNo: {}, gr: {}, grNo: {}, poLine: {} };
const catat = (kode, p) => { ID.po[kode] = p.id; ID.poNo[kode] = p.poNumber; ID.poLine[kode] = p.lines.map((l) => l.id); };
const catatGR = async (kode, id) => { ID.gr[kode] = id; ID.grNo[kode] = (await g.get(`/api/inventory/goods-receipts/${id}`)).body.receiptNumber; };

// S: PO 100 → datang 50 (UI) → periksa/simpan → penerimaan kedua 50. Dokumen awal: terjadwal untuk 100.
const poS = await po(sOcean, [{ materialId: busa.id, qty: 100, unitPrice: 55000 }]); catat("S", poS);
await catatGR("S1", (await (async () => { const d = await buatDraf(poS.id); await jadwalkan(d.id); return d; })()).id);
// X: PO 40; sudah datang 25 (disimpan ke stok); penerimaan kedua dijadwalkan untuk sisa 15 → UI mencoba 20 (melebihi).
const poX = await po(sMak, [{ materialId: kainX.id, qty: 40, unitPrice: 27000 }]); catat("X", poX);
{ const d = await buatDraf(poX.id, geser(-4), [{ purchaseOrderLineId: poX.lines[0].id, qty: 25 }]); await jadwalkan(d.id); const id = await tiba(poX.id, d.id, [{ purchaseOrderLineId: poX.lines[0].id, jumlahDatang: 25 }], geser(-4)); await periksa(id, (l) => ({ receivedQty: 25, acceptedQty: 25, rejectedQty: 0 })); await catatGR("X1", id); }
{ const d = await buatDraf(poX.id, geser(0)); await jadwalkan(d.id); await catatGR("X2", d.id); }
// K: salah ketik jumlah tiba (10, seharusnya 8) — belum diperiksa: koreksi sebelum putaway.
const poK = await po(sOcean, [{ materialId: kainK.id, qty: 10, unitPrice: 30000 }]); catat("K", poK);
{ const d = await buatDraf(poK.id); await jadwalkan(d.id); await catatGR("K", await tiba(poK.id, d.id, [{ purchaseOrderLineId: poK.lines[0].id, jumlahDatang: 10 }])); }
// P: sudah masuk stok (6) — koreksi hanya lewat jalur resmi.
const poP = await po(sMak, [{ materialId: benangP.id, qty: 6, unitPrice: 15000 }]); catat("P", poP);
{ const d = await buatDraf(poP.id); await jadwalkan(d.id); const id = await tiba(poP.id, d.id, [{ purchaseOrderLineId: poP.lines[0].id, jumlahDatang: 6 }]); await periksa(id, () => ({ receivedQty: 6, acceptedQty: 6, rejectedQty: 0 })); await catatGR("P", id); }
// G: 20 datang, 12 baik + 8 ditolak → menunggu pengganti 8.
const poG = await po(sOcean, [{ materialId: busaG.id, qty: 20, unitPrice: 35000 }]); catat("G", poG);
{ const d = await buatDraf(poG.id); await jadwalkan(d.id); const id = await tiba(poG.id, d.id, [{ purchaseOrderLineId: poG.lines[0].id, jumlahDatang: 20 }]); await periksa(id, () => ({ receivedQty: 20, acceptedQty: 12, rejectedQty: 8 })); await catatGR("G", id); }
// M: 10 item bernama panjang — tata letak (ARRIVED dengan hasil pemeriksaan sebagian).
const poM = await po(sOcean, panjang.map((m, i) => ({ materialId: m.id, qty: 10 * (i + 1), unitPrice: 10000 + i * 500 }))); catat("M", poM);
{ const d = await buatDraf(poM.id); await jadwalkan(d.id); await catatGR("M", await tiba(poM.id, d.id, poM.lines.map((l, i) => ({ purchaseOrderLineId: l.id, jumlahDatang: 5 * (i + 1) })))); }
// Satu PO dengan satu item bernama panjang (kasus laporan) yang masih terjadwal — daftar punya dokumen "Perlu tindakan" dan "Menunggu".
const poN = await po(sOcean, [{ materialId: busa.id, qty: 60, unitPrice: 55000 }, { materialId: panjang[0].id, qty: 30, unitPrice: 20000 }]); catat("N", poN);
{ const d = await buatDraf(poN.id, geser(2)); await jadwalkan(d.id); await catatGR("N", d.id); }
ID.bahan = { busa: busa.id, kainX: kainX.id, kainK: kainK.id, benangP: benangP.id, busaG: busaG.id };
fs.writeFileSync(path.join(OUT, "ids.json"), JSON.stringify(ID, null, 2));
await bantu.close();

const app = buildTestApp();
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/qa/state", async (req, res) => {
  const mats = await testPrisma.material.findMany({ select: { id: true, code: true } });
  const gerak = await testPrisma.stockMovement.findMany({ select: { materialId: true, type: true, qty: true, goodsReceiptId: true } });
  const stok = {}; for (const m of mats) { const mm = gerak.filter((x) => x.materialId === m.id); stok[m.code] = { saldo: mm.reduce((a, x) => a + Number(x.qty), 0), gerakan: mm.length }; }
  const grs = await testPrisma.goodsReceipt.findMany({ select: { id: true, receiptNumber: true, status: true, purchaseOrderId: true, createdAt: true, lines: { select: { id: true, orderedQty: true, receivedQty: true, acceptedQty: true, rejectedQty: true, purchaseOrderLineId: true } } }, orderBy: { createdAt: "asc" } });
  const pol = await testPrisma.finPurchaseOrderLine.findMany({ select: { id: true, purchaseOrderId: true, qty: true } });
  res.json({ stok, gerakanTotal: gerak.length, penerimaan: grs, poLines: pol.map((l) => ({ id: l.id, poId: l.purchaseOrderId, qty: Number(l.qty) })), jurnal: await testPrisma.finJournalEntry.count() });
});
app.listen(PORT, "127.0.0.1", () => console.log(`[qa-penerimaan2] server siap di http://127.0.0.1:${PORT} — DB ${process.env.TEST_DATABASE_URL.split("/").pop()}`));
