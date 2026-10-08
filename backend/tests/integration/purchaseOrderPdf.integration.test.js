// PDF PURCHASE ORDER — endpoint GET /api/finance/purchase-orders/:id/pdf. Dikunci: izin (finance:read; Gudang/Produksi/Sales 403, tanpa token 401), 404 untuk id tak dikenal/tidak valid,
// isi PDF = angka PO di layar (total, nomor, supplier, termin, status, revisi), murni baca (stok, jurnal, PO, riwayat tidak berubah), unduhan inline dengan nama berkas dari nomor PO.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PDFParse } from "pdf-parse";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const [fin, admin, gudang, prod, sales, approver] = await Promise.all(["FINANCE", "ADMIN", "WAREHOUSE", "PRODUCTION_LEAD", "SALES", "APPROVER"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-ESA", name: "PT ESA BUMINDO", address: "Jl. Industri Raya C-12, Tangerang", phone: "021 5551 2345", email: "po@esa.test", paymentTermType: "HARI", paymentTermDays: 30 } });
  const lem = await createTestMaterial({ code: "LEM-1037", name: "LEM I-SR 1037 13 KG", unit: "KG" });
  return { f: c(fin), a: c(admin), g: c(gudang), p: c(prod), s: c(sales), ap: c(approver), fin, admin, approver, supplier, lem };
}
async function buatPO(w, qty = 10, harga = 43_290) {
  const r = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: hariIni(), notes: "Kirim sebelum Jumat", lines: [{ materialId: w.lem.id, qty, unitPrice: harga }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
const ambilPdf = (w, id, token = w.fin.token) => fetch(`${server.baseUrl}/api/finance/purchase-orders/${id}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
async function teks(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  const p = new PDFParse({ data: new Uint8Array(buf) });
  const r = await p.getText(); await p.destroy?.();
  return { buf, t: r.text.replace(/\s+/g, " ") };
}
const rp = (n) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const cacah = async () => ({ stok: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), po: JSON.stringify(await testPrisma.finPurchaseOrder.findMany({ orderBy: { id: "asc" } })), ev: await testPrisma.finPurchaseOrderEvent.count(), pdfAkt: await testPrisma.activityEvent.count() });

test("PDF PO: Finance mengunduh inline; isi = angka PO di layar; draf lalu disetujui lalu direvisi lalu dibatalkan mengikuti status & revisi; murni baca", async () => {
  const w = await dunia();
  const po = await buatPO(w);
  const awal = await cacah();

  let res = await ambilPdf(w, po.id);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.match(res.headers.get("content-disposition"), new RegExp(`^inline; filename="${po.poNumber}\.pdf"$`));
  assert.equal(res.headers.get("cache-control"), "no-store");
  let { buf, t } = await teks(res);
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  for (const x of ["PURCHASE ORDER", po.poNumber, "PT ESA BUMINDO", "SUP-ESA", "po@esa.test", "30 hari", "LEM I-SR 1037 13 KG", "LEM-1037", rp(po.totalDipesan), "STATUS: DRAF", "Kirim sebelum Jumat"]) assert.ok(t.includes(x), `draf memuat "${x}"`);
  assert.deepEqual(await cacah(), awal, "mengunduh PDF tidak menulis apa pun");

  // disetujui
  assert.equal((await w.f.post(`/api/finance/purchase-orders/${po.id}/approve`, {})).status, 200);
  ({ t } = await teks(await ambilPdf(w, po.id)));
  assert.ok(t.includes("STATUS: DISETUJUI") && t.includes("Disetujui oleh") && !t.includes("Revisi ke-"));
  // revisi jumlah → total & revisi ikut (angka sama dengan API)
  const rev = await w.ap.post(`/api/finance/purchase-orders/${po.id}/revisi-jumlah`, { lineId: po.lines[0].id, qty: 15, reason: "Tambah stok akhir bulan" });
  assert.equal(rev.status, 200, JSON.stringify(rev.body));
  const layar = (await w.f.get(`/api/finance/purchase-orders/${po.id}`)).body;
  assert.equal(layar.totalDipesan, 15 * 43_290);
  ({ t } = await teks(await ambilPdf(w, po.id)));
  assert.ok(t.includes(rp(layar.totalDipesan)) && t.includes("Revisi ke-1") && t.includes("15"), "total & revisi sama dengan layar");
  // dibatalkan
  assert.equal((await w.a.post(`/api/finance/purchase-orders/${po.id}/cancel`, { reason: "Supplier kehabisan stok" })).status, 200); // PO disetujui hanya bisa dibatalkan admin keuangan
  ({ t } = await teks(await ambilPdf(w, po.id)));
  assert.ok(t.includes("STATUS: DIBATALKAN") && t.includes("Supplier kehabisan stok"));
  assert.equal(await testPrisma.stockMovement.count(), awal.stok);
  assert.equal(await testPrisma.finJournalEntry.count(), awal.jurnal, "PDF/PO tidak membuat jurnal");
});

test("izin PDF PO: finance:read saja (Finance, Admin, Approver); Gudang, Produksi, Sales 403; tanpa token 401; id tak dikenal / bukan UUID 404", async () => {
  const w = await dunia();
  const po = await buatPO(w);
  assert.equal((await ambilPdf(w, po.id, null)).status, 401);
  for (const [nama, klien] of [["gudang", w.g], ["produksi", w.p], ["sales", w.s]]) {
    assert.equal((await klien.get(`/api/finance/purchase-orders/${po.id}/pdf`)).status, 403, nama);
  }
  for (const [nama, token] of [["finance", w.fin.token], ["admin", w.admin.token], ["approver", w.approver.token]]) {
    assert.equal((await ambilPdf(w, po.id, token)).status, 200, nama);
  }
  assert.equal((await ambilPdf(w, randomUUID())).status, 404);
  assert.equal((await ambilPdf(w, "bukan-uuid")).status, 404);
  // Gudang tetap tidak melihat harga lewat rute Gudang (PDF tidak membuka jalan baru)
  const gudangPo = JSON.stringify((await w.g.get(`/api/inventory/purchase-orders/${po.id}`)).body);
  assert.ok(!/unitPrice|hargaSatuan|nilaiDipesan|termin/i.test(gudangPo));
});
