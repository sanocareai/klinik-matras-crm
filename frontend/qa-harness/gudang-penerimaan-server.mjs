// QA Redesain Gudang — Fase 1 Penerimaan: server backend ASLI (buildTestApp, tanpa penjadwal) di atas database SANDBOX terisolasi (nama wajib mengandung "test"), data uji deterministik.
// Semua kode "SBX-…" = DATA SANDBOX. Dipakai bersama frontend/qa-harness/gudang-penerimaan-browser.cjs (Vite QA proxy → server ini).
//   TEST_DATABASE_URL=postgresql://klinik:…@localhost:5432/klinik_matras_test_gudang_qa  (migrasi dulu: node backend/tests/integration/setup/bootstrapTestDb.js)
//   JWT_SECRET=… PORT=4478 OUT=C:/tmp/gud-qa/db node frontend/qa-harness/gudang-penerimaan-server.mjs
// Rute /qa/* hanya ada di server uji ini (membaca DB untuk bukti: stok, pergerakan, jurnal, status dokumen).
import "../../backend/tests/integration/setup/env.js";
import fs from "node:fs"; import path from "node:path";
import { testPrisma, truncateAll } from "../../backend/tests/integration/setup/testDb.js";
import { createTestUser, createTestMaterial } from "../../backend/tests/integration/setup/fixtures.js";
import { buildTestApp } from "../../backend/tests/integration/setup/testApp.js";
import { makeClient } from "../../backend/tests/integration/setup/httpClient.js";
import { startTestServer } from "../../backend/tests/integration/setup/testApp.js";
import { ensureDefaultChartOfAccounts } from "../../backend/src/services/finance/accounts.js";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 4478); const OUT = process.env.OUT || "C:/tmp/gud-qa/db";
fs.mkdirSync(OUT, { recursive: true });
await truncateAll();
await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));

// Klien HTTP internal untuk menyiapkan data lewat API resmi (bukan menulis tabel langsung) — server sementara di port acak.
const bantu = await startTestServer(buildTestApp());
const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);
const kunci = () => ({ "Idempotency-Key": `sbx-${randomUUID()}` });

const T = {};
for (const [k, roles, nama] of [["gudang", ["WAREHOUSE"], "Gudang Sandbox"], ["finance", ["FINANCE"], "Finance Sandbox"], ["admin", ["ADMIN"], "Admin Sandbox"], ["approver", ["APPROVER"], "Approver Sandbox"], ["sales", ["SALES"], "Sales Sandbox"], ["lihat", ["PRODUCTION_LEAD"], "Pemimpin Produksi Sandbox"]]) {
  const { user, token } = await createTestUser({ roles });
  await testPrisma.user.update({ where: { id: user.id }, data: { name: nama } });
  T[k] = { token, user: { id: user.id, name: nama, email: user.email, role: roles[0], roles, divisions: k === "gudang" ? ["WAREHOUSE"] : [] } };
}
fs.writeFileSync(path.join(OUT, "tokens.json"), JSON.stringify(T, null, 2));
const c = (k) => makeClient(bantu.baseUrl, T[k].token);
const f = c("finance"); const g = c("gudang"); const ap = c("approver");

const sup = async (code, name) => testPrisma.finSupplier.create({ data: { code, name, paymentTermType: "HARI", paymentTermDays: 30 } });
const sSky = await sup("SBX-SKY", "PT Skyfoam (sandbox)"); const sJaya = await sup("SBX-JAYA", "PT Busa Jaya (sandbox)"); const sMak = await sup("SBX-MAK", "CV Makmur Abadi (sandbox)"); const sEsa = await sup("SBX-ESA", "PT Esa Bumindo (sandbox)");
const busa = await createTestMaterial({ code: "SBX-BUSA-R50", name: "Busa rebonded R50", unit: "KG" });
const lem = await createTestMaterial({ code: "SBX-LEM-SRI", name: "Lem SRI", unit: "PCS" });
const kain = await createTestMaterial({ code: "SBX-KAIN-OSCAR", name: "Kain Oscar ivory", unit: "METER" });
const benang = await createTestMaterial({ code: "SBX-BENANG", name: "Benang halus hitam", unit: "PCS" });
for (let i = 1; i <= 12; i++) await createTestMaterial({ code: `SBX-PAKU-${String(i).padStart(2, "0")}`, name: `Paku ${i} cm`, unit: "PCS" }); // supaya pemilih bahan punya kolom cari

async function po(supplier, lines, { orderDate = geser(-10), expected = null } = {}) {
  const r = await f.post("/api/finance/purchase-orders", { supplierId: supplier.id, orderDate, ...(expected && { expectedDate: expected }), lines });
  if (r.status !== 201) throw new Error(`PO gagal: ${JSON.stringify(r.body)}`);
  const s = await f.post(`/api/finance/purchase-orders/${r.body.id}/approve`, {});
  if (s.status !== 200) throw new Error(`approve PO gagal: ${JSON.stringify(s.body)}`);
  return s.body;
}
const ID = { bahan: { busa: busa.id, lem: lem.id, kain: kain.id, benang: benang.id } };
// PO-A: item KG + item satuan beli DUS (1 DUS = 12 PCS) → konversi per item.
const poA = await po(sSky, [{ materialId: busa.id, qty: 10, unitPrice: 36000 }, { materialId: lem.id, qty: 5, unitPrice: 240000, satuanBeli: "BOX", faktorKonversi: "12" }], { expected: geser(-1) });
// PO-B: untuk jadwal baru lewat formulir.
const poB = await po(sJaya, [{ materialId: kain.id, qty: 40, unitPrice: 27000 }], { expected: geser(0) });
// PO-C: sebagian sudah masuk stok (12 dari 20 KG) → kandidat retur; sisa 8.
const poC = await po(sMak, [{ materialId: busa.id, qty: 20, unitPrice: 35000 }], { expected: geser(-3) });
const tiba = (poId, body) => g.post(`/api/inventory/barang-akan-datang/${poId}/kedatangan`, { penerima: "Budi Gudang", catatan: "Barang tiba utuh", tanggalTiba: geser(-4), ...body }, kunci());
const tC = await tiba(poC.id, { lines: [{ purchaseOrderLineId: poC.lines[0].id, jumlahDatang: 12 }] });
if (tC.status !== 201) throw new Error(`tiba C gagal: ${JSON.stringify(tC.body)}`);
const grC = (await g.get(`/api/inventory/goods-receipts/${tC.body.receiptId}`)).body;
for (const [st, extra] of [["INSPECTION"], ["READY_FOR_PUTAWAY"]]) { void extra; if (st === "READY_FOR_PUTAWAY") await g.patch(`/api/inventory/goods-receipts/${grC.id}/lines/${grC.lines[0].id}`, { acceptedQty: 12, rejectedQty: 0 }); const r = await g.patch(`/api/inventory/goods-receipts/${grC.id}`, { status: st }); if (r.status !== 200) throw new Error(`C ${st}: ${JSON.stringify(r.body)}`); }
const pC = await g.post(`/api/inventory/goods-receipts/${grC.id}/putaway`, {}); if (pC.status !== 200) throw new Error(`putaway C: ${JSON.stringify(pC.body)}`);
// Penerimaan siap simpan (tanpa PO) dan draf tanpa PO + penerimaan diperiksa, untuk variasi daftar.
const lineBebas = (m, qty) => ({ materialId: m.id, orderedQty: qty });
const mk = async (body) => { const r = await g.post("/api/inventory/goods-receipts", body); if (r.status !== 201) throw new Error(`GR gagal: ${JSON.stringify(r.body)}`); return r.body.receipt ?? r.body; };
const grSiap = await mk({ sourceType: "SUPPLIER_DELIVERY", supplier: sEsa.name, expectedDate: geser(-3), lines: [lineBebas(lem, 8)] });
await g.patch(`/api/inventory/goods-receipts/${grSiap.id}`, { status: "SCHEDULED" }); await g.patch(`/api/inventory/goods-receipts/${grSiap.id}`, { status: "ARRIVED" }); await g.patch(`/api/inventory/goods-receipts/${grSiap.id}`, { status: "INSPECTION" });
const grSiapDet = (await g.get(`/api/inventory/goods-receipts/${grSiap.id}`)).body;
await g.patch(`/api/inventory/goods-receipts/${grSiap.id}/lines/${grSiapDet.lines[0].id}`, { receivedQty: 8, acceptedQty: 8, rejectedQty: 0 });
await g.patch(`/api/inventory/goods-receipts/${grSiap.id}`, { status: "READY_FOR_PUTAWAY" });
const grDraf = await mk({ sourceType: "SUPPLIER_DELIVERY", supplier: "PT Ocean Centra (sandbox)", lines: [lineBebas(benang, 6)] });
const grJadwal = await mk({ sourceType: "SUPPLIER_DELIVERY", supplier: sMak.name, expectedDate: geser(-2), lines: [lineBebas(benang, 12)] });
await g.patch(`/api/inventory/goods-receipts/${grJadwal.id}`, { status: "SCHEDULED" });
Object.assign(ID, { po: { A: poA.id, B: poB.id, C: poC.id }, poNo: { A: poA.poNumber, B: poB.poNumber, C: poC.poNumber }, gr: { C: grC.id, siap: grSiap.id, draf: grDraf.id, jadwal: grJadwal.id }, grNo: { C: grC.receiptNumber, siap: grSiap.receiptNumber, draf: grDraf.receiptNumber, jadwal: grJadwal.receiptNumber }, line: { C: grC.lines[0].id }, poLine: { A: poA.lines.map((l) => l.id), B: poB.lines.map((l) => l.id), C: poC.lines.map((l) => l.id) } });
fs.writeFileSync(path.join(OUT, "ids.json"), JSON.stringify(ID, null, 2));
await bantu.close();

// Server QA utama + rute bukti DB.
const app = buildTestApp();
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/qa/state", async (req, res) => {
  const mats = await testPrisma.material.findMany({ where: { code: { startsWith: "SBX-" } }, select: { id: true, code: true } });
  const gerak = await testPrisma.stockMovement.findMany({ where: { materialId: { in: mats.map((m) => m.id) } }, select: { materialId: true, type: true, qty: true, goodsReceiptId: true } });
  const stok = {}; for (const m of mats) { const mm = gerak.filter((x) => x.materialId === m.id); stok[m.code] = { saldo: mm.reduce((a, x) => a + Number(x.qty), 0), gerakan: mm.length }; }
  const grs = await testPrisma.goodsReceipt.findMany({ select: { id: true, receiptNumber: true, status: true, purchaseOrderId: true, createdAt: true }, orderBy: { createdAt: "asc" } });
  const jurnal = await testPrisma.finJournalEntry.count();
  res.json({ stok, gerakanTotal: gerak.length, penerimaan: grs, jurnal });
});
app.get("/qa/penerimaan/:id", async (req, res) => {
  const gr = await testPrisma.goodsReceipt.findUnique({ where: { id: req.params.id }, include: { lines: true } });
  const gerak = await testPrisma.stockMovement.findMany({ where: { goodsReceiptId: req.params.id }, select: { materialId: true, type: true, qty: true } });
  res.json({ gr, gerak });
});
app.listen(PORT, "127.0.0.1", () => console.log(`[qa-gudang] server siap di http://127.0.0.1:${PORT} — DB ${process.env.TEST_DATABASE_URL.split("/").pop()}`));

