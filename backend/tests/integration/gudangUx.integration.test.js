// UX GUDANG TAHAP 1 — DB terisolasi. Kasus wajib: DUA PO BUSA OCEAN sebagai dokumen berbeda (dan satu PO dengan dua penerimaan, seperti keadaan nyata): satu dokumen uji Terjadwal BUKAN bukti barang tiba.
// Menguji: aksi yang relevan per status (ubah jadwal, kembali ke Draf, batalkan — tanpa menyentuh dokumen/PO/stok lain), koreksi setelah posting diarahkan ke jalur resmi (tanpa Undo), Beranda
// "yang perlu dikerjakan", Stok & Lokasi yang jujur (nol ≠ belum diketahui ≠ minus; batas minimum belum diatur), akurasi stok tanpa baseline, hak akses, dan tidak ada dampak stok/Finance/Produksi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { penghalangBatalTiba } from "../../src/services/penerimaanStatus.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const kunci = () => ({ "Idempotency-Key": `ux-${randomUUID()}` });
const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);
const GR = "/api/inventory/goods-receipts";

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const [fin, gudang, sales, lead, owner] = await Promise.all(["FINANCE", "WAREHOUSE", "SALES", "PRODUCTION_LEAD", "OWNER"].map((r) => createTestUser({ roles: [r] })));
  const c = (u) => makeClient(server.baseUrl, u.token);
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-OCEAN", name: "PT OCEAN CENTRA FURNINDO", paymentTermType: "HARI", paymentTermDays: 30 } });
  const o120 = await createTestMaterial({ code: "BUSA-OCEAN-D18-120X200X2CM", name: "Busa Ocean D18 120x200x2", unit: "SHEET" });
  const o160 = await createTestMaterial({ code: "BUSA-OCEAN-D18-160X200X2CM", name: "Busa Ocean D18 160x200x2", unit: "SHEET" });
  return { f: c(fin), g: c(gudang), s: c(sales), p: c(lead), o: c(owner), gudangId: gudang.user.id, supplier, o120, o160 };
}
async function poOcean(w, { tanggalPO = -20, estimasi = -1 } = {}) {
  const c = await w.f.post("/api/finance/purchase-orders", { supplierId: w.supplier.id, orderDate: geser(tanggalPO), expectedDate: geser(estimasi), lines: [{ materialId: w.o120.id, qty: 10, unitPrice: 100_000 }, { materialId: w.o160.id, qty: 40, unitPrice: 150_000 }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const s = await w.f.post(`/api/finance/purchase-orders/${c.body.id}/approve`, {}); assert.equal(s.status, 200, JSON.stringify(s.body));
  return s.body;
}
/** Penerimaan dari PO → Draf (lewat API, seperti Penerimaan Baru dari PO) lalu opsional dijadwalkan. */
async function grDariPO(w, po, { jadwal = geser(-1), jadwalkan = true } = {}) {
  const c = await w.g.post(GR, { purchaseOrderId: po.id, expectedDate: jadwal }); assert.equal(c.status, 201, JSON.stringify(c.body));
  if (jadwalkan) { const p = await w.g.patch(`${GR}/${c.body.id}`, { status: "SCHEDULED" }); assert.equal(p.status, 200, JSON.stringify(p.body)); return p.body; }
  return c.body;
}
const snap = async () => ({ mov: await testPrisma.stockMovement.count(), jurnal: await testPrisma.finJournalEntry.count(), gr: await testPrisma.goodsReceipt.count(), po: await testPrisma.finPurchaseOrder.count(), tagihan: await testPrisma.finSupplierBill.count(), payment: await testPrisma.payment.count(), unit: await testPrisma.unit.count() });
const catatTibaLangsung = (id) => testPrisma.goodsReceipt.update({ where: { id }, data: { arrivedDate: new Date(`${geser(-1)}T00:00:00Z`), arrivalRecordedAt: new Date(), arrivalReceiver: "Budi", arrivalNote: "Tiba", arrivalWorkspace: "GUDANG", arrivalRevision: 1 } });

test("DUA PO BUSA OCEAN berbeda: identitas jelas, dua-duanya Terjadwal BUKAN bukti barang tiba; Beranda menampilkan dua dokumen terpisah dan tidak menyimpulkan duplikat", async () => {
  const w = await dunia(); const poA = await poOcean(w); const poB = await poOcean(w); const awal = await snap();
  assert.notEqual(poA.poNumber, poB.poNumber, "dua PO berbeda");
  const gA = await grDariPO(w, poA); const gB = await grDariPO(w, poB);
  assert.notEqual(gA.receiptNumber, gB.receiptNumber); assert.equal(gA.purchaseOrder.poNumber, poA.poNumber); assert.equal(gB.purchaseOrder.poNumber, poB.poNumber);
  for (const g of [gA, gB]) { assert.equal(g.status, "SCHEDULED"); assert.equal(g.tampilan.kode, "TERJADWAL"); assert.equal(g.tampilan.pengaruhStok, "BELUM"); assert.match(g.tampilan.penjelasan, /Belum memengaruhi stok/); }
  assert.equal(await testPrisma.stockMovement.count(), awal.mov, "Terjadwal tidak menyentuh stok");
  // PO: belum ada yang datang (Terjadwal ≠ tiba)
  for (const po of [poA, poB]) { const d = (await w.g.get(`/api/inventory/barang-akan-datang/${po.id}`)).body; assert.ok(d.lines.every((l) => l.datang === 0 && l.masukStok === 0), "tidak ada barang tiba"); assert.ok(d.bendera.some((x) => x.kode === "MENUNGGU_KEDATANGAN"), "masih menunggu kedatangan"); assert.ok(!d.bendera.some((x) => ["PERLU_DIPERIKSA", "SIAP_DISIMPAN", "SELESAI"].includes(x.kode))); }
  // Beranda: dua PO terpisah, identitas lengkap, jadwal lewat → perlu dicatat tiba (bukan "sudah tiba")
  const b = (await w.g.get("/api/inventory/beranda")).body; const t = Object.fromEntries(b.tugas.map((x) => [x.kode, x]));
  assert.equal(t.AKAN_DATANG.jumlah, 2); assert.deepEqual(t.AKAN_DATANG.contoh.map((x) => x.judul).sort(), [poA.poNumber, poB.poNumber].sort());
  assert.equal(t.PERLU_DICATAT_TIBA.jumlah, 2); assert.deepEqual(t.PERLU_DICATAT_TIBA.contoh.map((x) => x.judul).sort(), [gA.receiptNumber, gB.receiptNumber].sort());
  for (const c of t.PERLU_DICATAT_TIBA.contoh) { assert.match(c.sub, /PO-/); assert.match(c.sub, /PT OCEAN CENTRA FURNINDO/); assert.match(c.sub, /dibuat/); assert.equal(c.status, "Terjadwal — menunggu barang tiba"); }
  assert.equal(t.BELUM_MASUK_STOK.jumlah, 0, "belum ada barang tiba");
  assert.match(b.definisi.PERLU_DICATAT_TIBA, /Bukan bukti barang sudah tiba/);
  assert.deepEqual(await snap(), { ...awal, gr: awal.gr + 2 }, "hanya dua penerimaan baru; stok/jurnal/tagihan/PO tidak berubah");
});

test("SATU PO dengan DUA penerimaan terjadwal (keadaan nyata): keduanya tetap dokumen berbeda dengan pembuat dan tanggal masing-masing; tidak digabung", async () => {
  const w = await dunia(); const po = await poOcean(w);
  const g1 = await grDariPO(w, po); const g2 = await grDariPO(w, po, { jadwal: geser(2) });
  assert.notEqual(g1.id, g2.id); assert.equal(g1.purchaseOrder.poNumber, g2.purchaseOrder.poNumber);
  const daftar = (await w.g.get(GR)).body.receipts.filter((r) => r.purchaseOrderId === po.id); assert.equal(daftar.length, 2);
  for (const r of daftar) { assert.ok(r.createdBy?.name); assert.ok(r.createdAt); assert.equal(r.tampilan.kode, "TERJADWAL"); assert.equal(r.lines.length, 2); }
  const b = (await w.g.get("/api/inventory/beranda")).body; const t = Object.fromEntries(b.tugas.map((x) => [x.kode, x]));
  assert.equal(t.AKAN_DATANG.jumlah, 1, "satu PO"); assert.equal(t.AKAN_DATANG.contoh[0].jumlahPenerimaan, 2, "dengan dua penerimaan");
  assert.equal(t.PERLU_DICATAT_TIBA.jumlah, 1, "hanya yang jadwalnya sudah jatuh tempo (g1), g2 jadwalnya besok lusa"); assert.equal(t.PERLU_DICATAT_TIBA.contoh[0].judul, g1.receiptNumber);
});

test("Terjadwal → ubah jadwal → kembali ke Draf → jadwalkan lagi → batalkan: langkah singkat, jejak ringan, dokumen/PO lain tidak tersentuh, aman diulang", async () => {
  const w = await dunia(); const poA = await poOcean(w); const poB = await poOcean(w);
  const gA = await grDariPO(w, poA); const gB = await grDariPO(w, poB); const awal = await snap();
  // ubah jadwal (langsung di detail): tercatat sebelum–sesudah
  const baru = geser(5); const ub = await w.g.patch(`${GR}/${gB.id}`, { expectedDate: baru }); assert.equal(ub.status, 200, JSON.stringify(ub.body)); assert.equal(String(ub.body.expectedDate).slice(0, 10), baru);
  const ev = await testPrisma.activityEvent.findMany({ where: { entityType: "goods_receipt", entityId: gB.id, eventType: "DOCUMENT_EDITED" } }); assert.ok(ev.some((e) => e.metadata.sesudah?.expectedDate?.startsWith(baru)), "perubahan jadwal tercatat");
  // kembali ke Draf
  const kd = await w.g.post(`${GR}/${gB.id}/kembali-draft`, { alasan: "Salah jadwalkan, ini hanya uji" }); assert.equal(kd.status, 200, JSON.stringify(kd.body)); assert.equal(kd.body.status, "DRAFT"); assert.equal(kd.body.tampilan.kode, "DRAF"); assert.deepEqual(kd.body.tampilan.aksi.map((a) => a.kode), ["UBAH_JADWAL", "JADWALKAN", "BATALKAN_JADWAL"]);
  assert.equal((await w.g.post(`${GR}/${gB.id}/kembali-draft`, {})).status, 200, "ulang pada Draf = hasil sama");
  const e2 = await testPrisma.activityEvent.findMany({ where: { entityId: gB.id, eventType: "DOCUMENT_EDITED" } }); const kembali = e2.filter((e) => e.metadata.aksi === "KEMBALI_KE_DRAF"); assert.equal(kembali.length, 1, "tepat satu jejak walau diulang"); assert.deepEqual(kembali[0].metadata.sesudah, { status: "DRAFT" }); assert.equal(kembali[0].actorId, w.gudangId);
  // jadwalkan lagi
  assert.equal((await w.g.patch(`${GR}/${gB.id}`, { status: "SCHEDULED" })).status, 200);
  // batalkan: alasan wajib & singkat
  assert.equal((await w.g.post(`${GR}/${gB.id}/batalkan-jadwal`, { alasan: "x" })).status, 400);
  const ba = await w.g.post(`${GR}/${gB.id}/batalkan-jadwal`, { alasan: "Dokumen uji, tidak jadi" }); assert.equal(ba.status, 200, JSON.stringify(ba.body)); assert.equal(ba.body.status, "REJECTED"); assert.equal(ba.body.tampilan.kode, "DIBATALKAN"); assert.equal(ba.body.tampilan.label, "Dibatalkan"); assert.deepEqual(ba.body.tampilan.aksi.map((x) => x.kode), ["PULIHKAN"], "hanya jalan pulih, bukan jadwal ulang diam-diam"); assert.match(ba.body.notes, /Dibatalkan sebelum barang tiba: Dokumen uji, tidak jadi/);
  const ulang = await w.g.post(`${GR}/${gB.id}/batalkan-jadwal`, { alasan: "Dokumen uji, tidak jadi" }); assert.equal(ulang.status, 200); assert.equal(ulang.body.ulang, true);
  assert.equal((await testPrisma.activityEvent.count({ where: { entityId: gB.id, eventType: "DOCUMENT_CANCELLED" } })), 1, "satu jejak pembatalan");
  assert.equal((await w.g.patch(`${GR}/${gB.id}`, { status: "SCHEDULED" })).status, 400, "dokumen dibatalkan tidak bisa dijadwalkan lagi");
  // dokumen lain & PO tidak tersentuh
  const a = (await w.g.get(`${GR}/${gA.id}`)).body; assert.equal(a.status, "SCHEDULED"); assert.equal(a.tampilan.kode, "TERJADWAL");
  assert.equal((await testPrisma.finPurchaseOrder.findUnique({ where: { id: poA.id } })).status, "DISETUJUI"); assert.equal((await testPrisma.finPurchaseOrder.findUnique({ where: { id: poB.id } })).status, "DISETUJUI");
  assert.deepEqual(await snap(), awal, "tidak ada dampak stok/jurnal/tagihan/pembayaran/PO/Produksi");
  // dokumen dibatalkan keluar dari 'akan datang' pada penerimaan tetapi PO-nya masih ditunggu; jadwal baru bisa dibuat
  const b = (await w.g.get("/api/inventory/beranda")).body; const t = Object.fromEntries(b.tugas.map((x) => [x.kode, x])); assert.equal(t.PERLU_DICATAT_TIBA.jumlah, 1); assert.equal(t.PERLU_DICATAT_TIBA.contoh[0].judul, gA.receiptNumber);
  const baruLagi = await w.g.post(GR, { purchaseOrderId: poB.id, expectedDate: geser(3) }); assert.equal(baruLagi.status, 201, "jadwal baru dari PO yang sama sesudah pembatalan");
});

test("pengaman: batal/kembali ke Draf DITOLAK bila barang sudah dicatat tiba, ada jumlah, atau sudah masuk stok — dengan penyebab; hak akses", async () => {
  const w = await dunia(); const po = await poOcean(w);
  const g = await grDariPO(w, po); await catatTibaLangsung(g.id);
  let r = await w.g.post(`${GR}/${g.id}/batalkan-jadwal`, { alasan: "coba batal" }); assert.equal(r.status, 409); assert.equal(r.body.code, "BARANG_SUDAH_DICATAT_TIBA"); assert.match(r.body.error, /Koreksi Kedatangan|tolak barang/i);
  r = await w.g.post(`${GR}/${g.id}/kembali-draft`, {}); assert.equal(r.status, 409); assert.equal(r.body.code, "BARANG_SUDAH_DICATAT_TIBA");
  // ada jumlah (tanpa tanggal tiba): tetap ditolak
  const po2 = await poOcean(w); const g2 = await grDariPO(w, po2); await testPrisma.goodsReceiptLine.update({ where: { id: (await testPrisma.goodsReceiptLine.findFirst({ where: { goodsReceiptId: g2.id } })).id }, data: { receivedQty: 3 } });
  r = await w.g.post(`${GR}/${g2.id}/batalkan-jadwal`, { alasan: "coba batal" }); assert.equal(r.status, 409); assert.equal(r.body.code, "SUDAH_ADA_JUMLAH");
  // sudah masuk stok → arahkan ke Koreksi (tanpa Undo)
  const nonPO = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-UX-SELESAI", sourceType: "MANUAL", status: "COMPLETED", lines: { create: [{ materialId: w.o120.id, acceptedQty: 2, receivedQty: 2 }] } } });
  r = await w.g.post(`${GR}/${nonPO.id}/batalkan-jadwal`, { alasan: "coba batal" }); assert.equal(r.status, 409); assert.match(r.body.error, /Koreksi/); assert.equal((await w.g.post(`${GR}/${nonPO.id}/kembali-draft`, {})).status, 409);
  // hak akses: pembaca & sales tidak bisa; tidak ada dokumen/PO yang berubah
  const g3 = await grDariPO(w, await poOcean(w));
  assert.equal((await w.p.post(`${GR}/${g3.id}/batalkan-jadwal`, { alasan: "tidak boleh" })).status, 403); assert.equal((await w.s.post(`${GR}/${g3.id}/kembali-draft`, {})).status, 403);
  assert.equal((await w.g.post(`${GR}/00000000-0000-4000-8000-000000000000/batalkan-jadwal`, { alasan: "tidak ada" })).status, 404); assert.equal((await w.g.post(`${GR}/bukan-uuid/kembali-draft`, {})).status, 400);
  assert.equal((await testPrisma.goodsReceipt.findUnique({ where: { id: g3.id } })).status, "SCHEDULED");
});

test("MATRIKS AKSI per status: hanya aksi yang relevan; sesudah masuk stok hanya Koreksi (PO → Koreksi Kedatangan resmi, tanpa PO → Koreksi penerimaan); tidak ada Undo/Hapus", async () => {
  const w = await dunia(); const po = await poOcean(w);
  const dokPO = (status, extra = {}) => testPrisma.goodsReceipt.create({ data: { receiptNumber: `GR-MX-${Math.random().toString(36).slice(2, 7)}`, sourceType: "PURCHASE_ORDER", purchaseOrderId: po.id, status, ...extra, lines: { create: [{ materialId: w.o120.id }] } } });
  const dokNon = (status) => testPrisma.goodsReceipt.create({ data: { receiptNumber: `GR-MN-${Math.random().toString(36).slice(2, 7)}`, sourceType: "MANUAL", status, lines: { create: [{ materialId: w.o120.id, ...(status === "REJECTED" ? { receivedQty: 3, rejectedQty: 3 } : {}) }] } } });
  const aksi = async (id) => (await w.g.get(`${GR}/${id}`)).body.tampilan;
  const kode = (t) => t.aksi.map((a) => a.kode);
  assert.deepEqual(kode(await aksi((await dokPO("DRAFT")).id)), ["UBAH_JADWAL", "JADWALKAN", "BATALKAN_JADWAL"]);
  assert.deepEqual(kode(await aksi((await dokPO("SCHEDULED")).id)), ["UBAH_JADWAL", "CATAT_TIBA", "KEMBALI_DRAFT", "BATALKAN_JADWAL"]);
  assert.deepEqual(kode(await aksi((await dokNon("SCHEDULED")).id)), ["UBAH_JADWAL", "TANDAI_TIBA", "KEMBALI_DRAFT", "BATALKAN_JADWAL"], "tanpa PO: tandai tiba, bukan catat kedatangan PO");
  for (const s of ["ARRIVED", "INSPECTION"]) assert.deepEqual(kode(await aksi((await dokPO(s)).id)), ["ISI_PEMERIKSAAN", "MAJUKAN", "KOREKSI_KEDATANGAN", "BATALKAN_TIBA", "TOLAK"], s);
  assert.deepEqual(kode(await aksi((await dokPO("READY_FOR_PUTAWAY")).id)), ["SIMPAN_KE_STOK", "ISI_PEMERIKSAAN", "KOREKSI_KEDATANGAN", "BATALKAN_TIBA", "TOLAK"]);
  assert.deepEqual(kode(await aksi((await dokNon("INSPECTION")).id)), ["ISI_PEMERIKSAAN", "MAJUKAN", "BATALKAN_TIBA", "TOLAK"], "tanpa PO tidak ada Koreksi Kedatangan");
  const selesaiPO = await aksi((await dokPO("COMPLETED")).id); assert.deepEqual(kode(selesaiPO), ["KOREKSI_KEDATANGAN"]); assert.equal(selesaiPO.pengaruhStok, "SUDAH"); assert.match(selesaiPO.penjelasan, /tidak dihapus/);
  const selesaiNon = await aksi((await dokNon("COMPLETED")).id); assert.deepEqual(kode(selesaiNon), ["KOREKSI_PENERIMAAN"]);
  assert.equal((await aksi((await dokNon("REJECTED")).id)).kode, "DITOLAK", "barang pernah tiba lalu ditolak = Ditolak");
  assert.equal((await aksi((await dokPO("REJECTED")).id)).kode, "DIBATALKAN", "tidak pernah berisi = Dibatalkan"); assert.deepEqual(kode(await aksi((await dokPO("REJECTED")).id)), ["PULIHKAN"], "Dibatalkan: bisa dipulihkan ke Draf");
  assert.deepEqual(kode(await aksi((await dokNon("REJECTED")).id)), ["BUAT_ULANG"], "Ditolak (pernah berisi): dibuat ulang dengan tautan riwayat, tidak dipulihkan di tempat");
  for (const s of ["DRAFT", "SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED", "REJECTED"]) { const t = await aksi((await dokPO(s)).id); assert.ok(!t.aksi.some((a) => /undo|hapus|delete|reversal/i.test(`${a.kode} ${a.label}`)), `${s}: tidak ada Undo/Hapus`); assert.equal(t.tahap.length, 5); }
  // tahap alur PO → jadwal → tiba → periksa → stok
  assert.deepEqual(["DRAFT", "SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED"].map((s) => null).length, 6);
  assert.deepEqual((await aksi((await dokPO("SCHEDULED")).id)).tahap.map((x) => x.label), ["PO disetujui", "Jadwal kedatangan", "Barang tiba", "Pemeriksaan", "Masuk stok"]);
  assert.equal((await aksi((await dokPO("SCHEDULED")).id)).tahapIndeks, 1); assert.equal((await aksi((await dokPO("READY_FOR_PUTAWAY")).id)).tahapIndeks, 3); assert.equal((await aksi((await dokPO("COMPLETED")).id)).tahapIndeks, 4);
  // jalur koreksi server sejalan: PO selesai → alur resmi, non-PO → koreksi bertaut, draf → edit
  const jalur = async (id) => (await w.g.get(`/api/inventory/koreksi/dokumen/GOODS_RECEIPT/${id}`)).body;
  assert.equal((await jalur((await dokPO("COMPLETED")).id)).jalur, "ALUR_RESMI"); assert.equal((await jalur((await dokNon("COMPLETED")).id)).jalur, "KOREKSI_UI"); assert.equal((await jalur((await dokPO("SCHEDULED")).id)).jalur, "EDIT_DRAF");
  assert.match((await jalur((await dokPO("SCHEDULED")).id)).langkah.join(" "), /Kembalikan ke Draf/);
});

test("Beranda: lima ringkasan memuat hitungan, definisi, tautan ke daftar relevan; baca-saja; hak akses; V2 Produksi tidak dihitung", async () => {
  const w = await dunia(); const po = await poOcean(w);
  const unit = await createTestUnit(); void unit;
  await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-UX-TIBA", sourceType: "MANUAL", status: "ARRIVED", lines: { create: [{ materialId: w.o120.id, receivedQty: 4 }] } } });
  await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-UX-SIAP", sourceType: "MANUAL", status: "READY_FOR_PUTAWAY", lines: { create: [{ materialId: w.o120.id, receivedQty: 4, acceptedQty: 4 }] } } });
  await testPrisma.materialIssue.create({ data: { issueNumber: "MI-UX-1", sourceType: "MANUAL", status: "WAITING_APPROVAL", lines: { create: [{ materialId: w.o120.id, requestedQty: 1 }] } } });
  await testPrisma.materialIssue.create({ data: { issueNumber: "MI-UX-DRAFT", sourceType: "MANUAL", status: "DRAFT", lines: { create: [{ materialId: w.o120.id, requestedQty: 1 }] } } });
  await testPrisma.stockCount.create({ data: { countNumber: "CC-UX-1", countType: "CYCLE_COUNT", countMethod: "BY_ITEM", status: "WAITING_REVIEW", submittedAt: new Date() } });
  await testPrisma.stockAdjustmentRequest.create({ data: { adjustmentNumber: "ADJ-UX-1", materialId: w.o120.id, adjustmentType: "COUNT_CORRECTION", beforeQty: 1, afterQty: 2, adjustmentQty: 1, reason: "uji", status: "WAITING_APPROVAL", requestedById: (await testPrisma.user.findFirst()).id } }).catch(() => null);
  const sebelum = await snap();
  const b = (await w.g.get("/api/inventory/beranda")).body; const t = Object.fromEntries(b.tugas.map((x) => [x.kode, x]));
  assert.deepEqual(b.tugas.map((x) => x.kode), ["AKAN_DATANG", "PERLU_DICATAT_TIBA", "BELUM_MASUK_STOK", "PERMINTAAN_BAHAN", "SELISIH_MENUNGGU"]);
  assert.equal(t.AKAN_DATANG.jumlah, 1); assert.equal(t.BELUM_MASUK_STOK.jumlah, 2); assert.match(t.BELUM_MASUK_STOK.rincian, /1 perlu diperiksa · 1 siap masuk stok/);
  assert.equal(t.PERMINTAAN_BAHAN.jumlah, 1, "hanya yang menunggu persetujuan/diambil/dikeluarkan; Draf belum diajukan"); assert.equal(t.PERMINTAAN_BAHAN.contoh[0].judul, "MI-UX-1");
  assert.ok(t.SELISIH_MENUNGGU.jumlah >= 1); assert.ok(t.SELISIH_MENUNGGU.contoh.some((x) => x.judul === "CC-UX-1"));
  for (const x of b.tugas) { assert.ok(x.tautan.startsWith("/warehouse/"), x.kode); assert.ok(x.tautanLabel && x.rincian && x.judul, x.kode); assert.ok(Array.isArray(x.contoh) && x.contoh.length <= 5); assert.equal(typeof x.ada, "boolean"); }
  assert.equal(t.BELUM_MASUK_STOK.tautan, "/warehouse/goods-receipt?tahap=belum-masuk-stok"); assert.equal(t.AKAN_DATANG.tautan, "/warehouse/barang-akan-datang");
  assert.deepEqual(await snap(), sebelum, "Beranda baca-saja");
  assert.equal((await w.s.get("/api/inventory/beranda")).status, 403); assert.equal((await w.p.get("/api/inventory/beranda")).status, 200, "pembaca boleh melihat"); assert.equal((await w.s.get("/api/inventory/beranda/stok")).status, 403);
  void po;
});

test("Stok & Lokasi jujur: belum ada catatan ≠ nol terhitung ≠ minus; batas minimum belum diatur ≠ 0; lokasi = penerimaan terakhir; nonaktif dipisah; kesimpulan hanya yang didukung data", async () => {
  const w = await dunia(); await testPrisma.material.deleteMany({ where: { id: { in: [w.o120.id, w.o160.id] } } }); // hanya bahan uji di bawah ini
  const mk = (code, extra = {}) => createTestMaterial({ code, name: `Bahan ${code}`, unit: "METER", ...extra });
  const belum = await mk("UX-BELUM"); const nol = await mk("UX-NOL"); const minus = await mk("UX-MINUS"); const ada = await mk("UX-ADA"); const tipis = await mk("UX-TIPIS", { reorderPoint: 10 }); const rp0 = await mk("UX-RP0", { reorderPoint: 0 }); const mati = await mk("UX-MATI", { active: false });
  const mv = (materialId, type, qty, extra = {}) => testPrisma.stockMovement.create({ data: { materialId, type, qty, ...extra } });
  await mv(nol.id, "RECEIPT", 5, { location: "RAK-N" }); await mv(nol.id, "ISSUE", -5);
  await mv(minus.id, "RECEIPT", 2); await mv(minus.id, "ADJUSTMENT", -9);
  await mv(ada.id, "RECEIPT", 40, { location: "RAK-A", createdAt: new Date("2026-10-01T00:00:00Z") }); await mv(ada.id, "RECEIPT", 10, { location: "RAK-B", createdAt: new Date("2026-10-09T00:00:00Z") });
  await mv(tipis.id, "RECEIPT", 7, { location: "RAK-T" }); await mv(rp0.id, "RECEIPT", 1); await mv(mati.id, "RECEIPT", 3);
  const r = (await w.g.get("/api/inventory/beranda/stok")).body; const by = Object.fromEntries(r.rows.map((x) => [x.kode, x]));
  assert.equal(by["UX-BELUM"].keadaan, "BELUM_ADA_CATATAN"); assert.equal(by["UX-BELUM"].saldo, null, "belum diketahui ≠ 0"); assert.equal(by["UX-BELUM"].lokasiTerakhir, null); assert.equal(by["UX-BELUM"].sumberAngka.jenis, "BELUM_ADA"); assert.equal(by["UX-BELUM"].batasMinimum, null);
  assert.equal(by["UX-NOL"].keadaan, "NOL_TERHITUNG"); assert.equal(by["UX-NOL"].saldo, 0); assert.equal(by["UX-MINUS"].keadaan, "MINUS"); assert.equal(by["UX-MINUS"].saldo, -7); assert.match(by["UX-MINUS"].keadaanLabel, /dihitung fisik/);
  assert.equal(by["UX-ADA"].keadaan, "ADA"); assert.equal(by["UX-ADA"].saldo, 50); assert.equal(by["UX-ADA"].lokasiTerakhir.lokasi, "RAK-B", "lokasi penerimaan TERAKHIR"); assert.match(by["UX-ADA"].lokasiTerakhir.catatan, /bukan saldo per lokasi/); assert.match(by["UX-ADA"].sumberAngka.teks, /2 pergerakan/);
  assert.equal(by["UX-TIPIS"].keadaan, "MENIPIS"); assert.equal(by["UX-TIPIS"].batasMinimum, 10); assert.equal(by["UX-RP0"].batasMinimum, 0, "batas 0 yang diatur ≠ belum diatur"); assert.equal(by["UX-MATI"].keadaan, "NONAKTIF");
  const s = r.ringkasan; assert.equal(s.terdaftar, 7); assert.equal(s.aktif, 6); assert.equal(s.nonaktif, 1); assert.equal(s.belumAdaCatatan, 1); assert.equal(s.nolTerhitung, 1); assert.equal(s.minus, 1); assert.equal(s.menipis, 1); assert.equal(s.batasMinimumDiatur, 2); assert.equal(s.batasMinimumBelumDiatur, 4);
  assert.match(s.kesimpulan.stokHabis, /1 bahan habis menurut pergerakan/); assert.match(s.kesimpulan.belumDiketahui, /belum punya catatan stok \(belum diketahui — bukan berarti habis\)/); assert.match(s.kesimpulan.minus, /bersaldo minus/); assert.match(s.kesimpulan.reorder, /1 dari 2 bahan ber-batas-minimum/);
  // tidak ada kesimpulan tak berdasar: tanpa satu pun batas minimum
  await testPrisma.material.updateMany({ data: { reorderPoint: null } });
  const r2 = (await w.g.get("/api/inventory/beranda/stok")).body; assert.match(r2.ringkasan.kesimpulan.reorder, /Batas minimum belum diatur untuk satu pun bahan/); assert.equal(r2.ringkasan.menipis, 0);
  // tanpa bahan terbukti habis
  await testPrisma.stockMovement.deleteMany({ where: { materialId: nol.id } }); const r3 = (await w.g.get("/api/inventory/beranda/stok")).body; assert.equal(r3.ringkasan.kesimpulan.stokHabis, "Belum ada bahan yang terbukti habis");
  assert.equal((await w.s.get("/api/inventory/beranda/stok")).status, 403);
});

test("akurasi stok: hitungan BASELINE (saldo pembuka) tidak dihitung; sampel kecil diberi penanda; ringkasan membedakan belum ada catatan/nol/minus", async () => {
  const w = await dunia(); const m = await createTestMaterial({ unit: "PCS" });
  const buat = (nomor, notes, lines) => testPrisma.stockCount.create({ data: { countNumber: nomor, countType: "FULL_STOCK_OPNAME", countMethod: "BY_ITEM", status: "COMPLETED", completedAt: new Date(), notes, lines: { create: lines.map(([s, c]) => ({ materialId: m.id, systemQty: s, countedQty: c })) } } });
  await buat("CC-UX-BASELINE", null, [[0, 5], [0, 7], [0, 3]]); await buat("CC-UX-OPNAME-2", "Backfill saldo pembuka dari Excel", [[0, 9]]);
  let r = (await w.g.get("/api/inventory/reports/summary")).body; assert.equal(r.stockAccuracy.totalCounted, 0); assert.equal(r.stockAccuracy.percentage, null, "baseline bukan ukuran akurasi (bukan 0,0%)"); assert.equal(r.stockAccuracy.dikecualikanBaseline, 2); assert.equal(r.stockAccuracy.sampelCukup, false);
  await buat("CC-UX-REAL-1", "hitung rutin", [[10, 10], [5, 4]]);
  r = (await w.g.get("/api/inventory/reports/summary")).body; assert.equal(r.stockAccuracy.totalCounted, 2); assert.equal(r.stockAccuracy.accurate, 1); assert.equal(r.stockAccuracy.percentage, 50); assert.equal(r.stockAccuracy.sampelCukup, false, "2 baris = contoh kecil");
  assert.equal(typeof r.totals.belumAdaCatatan, "number"); assert.equal(typeof r.totals.nolTerhitung, "number"); assert.equal(typeof r.totals.minus, "number"); assert.equal(typeof r.totals.batasMinimumBelumDiatur, "number"); assert.equal(r.totals.terdaftar, r.totals.totalItems + r.totals.inactive);
  assert.equal(r.totals.outOfStock, r.totals.belumAdaCatatan + r.totals.nolTerhitung + r.totals.minus, "'stok habis' lama = belum ada catatan + nol + minus (dirinci agar tidak menyesatkan)");
});

// ── Pemulihan dokumen: salah klik "Barang tiba", Dibatalkan, Ditolak ────────────────────────────────────────────
const tibaGudang = async (w, po, g, extra = {}) => {
  const baris = (await w.g.get(`${GR}/${g.id}`)).body.lines;
  return w.g.post(`/api/inventory/barang-akan-datang/${po.id}/kedatangan`, {
    receiptId: g.id, tanggalTiba: geser(-1), penerima: "Budi Gudang", catatan: "Barang tiba (uji)", lines: baris.map((l) => ({ purchaseOrderLineId: l.purchaseOrderLineId, jumlahDatang: Number(l.orderedQty) })), ...extra,
  }, kunci());
};
const kodeAksi = async (w, id) => (await w.g.get(`${GR}/${id}`)).body.tampilan.aksi.map((a) => a.kode);

test("SALAH KLIK 'Barang tiba': catatan tiba dibatalkan → kembali Terjadwal; catatan lama tersimpan utuh; tanpa pergerakan stok; aman diulang; bisa dicatat ulang", async () => {
  const w = await dunia(); const po = await poOcean(w); const g = await grDariPO(w, po);
  const t = await tibaGudang(w, po, g); assert.equal(t.status, 201, JSON.stringify(t.body));
  const sebelum = await snap();
  let d = (await w.g.get(`${GR}/${g.id}`)).body; assert.equal(d.status, "ARRIVED"); assert.ok((await kodeAksi(w, g.id)).includes("BATALKAN_TIBA"));
  // alasan wajib; hak akses
  assert.equal((await w.g.post(`${GR}/${g.id}/batalkan-tiba`, {})).status, 400);
  assert.equal((await w.s.post(`${GR}/${g.id}/batalkan-tiba`, { alasan: "tidak boleh" })).status, 403);
  const r = await w.g.post(`${GR}/${g.id}/batalkan-tiba`, { alasan: "salah klik, barang belum datang" }); assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, "SCHEDULED"); assert.equal(r.body.arrivedDate, null); assert.equal(r.body.arrivalRevision, 0);
  assert.ok(r.body.lines.every((l) => l.receivedQty === null && l.acceptedQty === null), "jumlah tiba dikosongkan"); assert.ok(r.body.lines.every((l) => Number(l.orderedQty) > 0), "jumlah jadwal utuh");
  assert.deepEqual(await snap(), sebelum, "tidak ada pergerakan stok/jurnal/dokumen baru");
  // jejak: catatan lama utuh di aktivitas + riwayat kedatangan tidak dihapus
  d = (await w.g.get(`${GR}/${g.id}`)).body; const j = d.jejak.find((x) => x.aksi === "TIBA_DIBATALKAN");
  assert.ok(j); assert.equal(j.alasan, "salah klik, barang belum datang"); assert.ok(j.oleh);
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityId: g.id, eventType: "DOCUMENT_EDITED", metadata: { path: ["aksi"], equals: "TIBA_DIBATALKAN" } } });
  assert.equal(ev.metadata.sebelum.penerima, "Budi Gudang"); assert.equal(ev.metadata.sebelum.revisi, 1); assert.equal(ev.metadata.sebelum.baris.length, 2);
  assert.equal(await testPrisma.goodsReceiptEvent.count({ where: { goodsReceiptId: g.id, type: "KEDATANGAN_DICATAT" } }), 1, "riwayat kedatangan tidak dihapus");
  // aman diulang (tidak menggandakan jejak) lalu dicatat tiba lagi dengan benar
  const ulang = await w.g.post(`${GR}/${g.id}/batalkan-tiba`, { alasan: "klik dua kali" }); assert.equal(ulang.status, 200);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: g.id, metadata: { path: ["aksi"], equals: "TIBA_DIBATALKAN" } } }), 1);
  assert.equal((await tibaGudang(w, po, g, { tanggalTiba: geser(0) })).status, 201); assert.equal((await w.g.get(`${GR}/${g.id}`)).body.status, "ARRIVED");
});

test("batalkan catatan tiba DITOLAK dengan sebab + langkah bila ada hasil pemeriksaan, sudah masuk stok, atau status salah; aksi tidak ditawarkan saat hasil pemeriksaan ada", async () => {
  const w = await dunia(); const po = await poOcean(w); const g = await grDariPO(w, po); assert.equal((await tibaGudang(w, po, g)).status, 201);
  const baris = (await w.g.get(`${GR}/${g.id}`)).body.lines[0];
  assert.equal((await w.g.patch(`${GR}/${g.id}`, { status: "INSPECTION" })).status, 200);
  assert.equal((await w.g.patch(`${GR}/${g.id}/lines/${baris.id}`, { acceptedQty: 5, rejectedQty: 0 })).status, 200);
  assert.ok(!(await kodeAksi(w, g.id)).includes("BATALKAN_TIBA"), "hasil pemeriksaan sudah diisi: tidak ditawarkan");
  const r = await w.g.post(`${GR}/${g.id}/batalkan-tiba`, { alasan: "coba batal" }); assert.equal(r.status, 409); assert.equal(r.body.code, "SUDAH_ADA_HASIL_PEMERIKSAAN"); assert.match(r.body.error, /Koreksi Kedatangan|Tolak barang/);
  assert.equal((await testPrisma.goodsReceipt.findUnique({ where: { id: g.id } })).status, "INSPECTION", "tidak berubah");
  const selesai = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-UX-PLH", sourceType: "MANUAL", status: "COMPLETED", lines: { create: [{ materialId: w.o120.id, acceptedQty: 2, receivedQty: 2 }] } } });
  const s = await w.g.post(`${GR}/${selesai.id}/batalkan-tiba`, { alasan: "coba batal" }); assert.equal(s.status, 409); assert.match(s.body.error, /Koreksi/);
  // penghalang murni: pergerakan, faktur, retur, pengganti — masing-masing dengan langkah penyelesaian
  const kosong = { lines: [{ acceptedQty: null, rejectedQty: null }] };
  assert.equal(penghalangBatalTiba(kosong, {}), null);
  for (const [ctx, kode] of [[{ pergerakan: 1 }, "SUDAH_ADA_PERGERAKAN_STOK"], [{ faktur: 1 }, "SUDAH_ADA_FAKTUR"], [{ retur: 1 }, "SUDAH_ADA_RETUR"], [{ pengganti: 1 }, "SUDAH_ADA_PENGGANTI"]]) {
    const h = penghalangBatalTiba(kosong, ctx); assert.equal(h.kode, kode); assert.ok(h.pesan && h.langkah, `${kode}: ada sebab dan langkah`);
  }
});

test("DIBATALKAN dapat dipulihkan ke Draf (belum berdampak); Ditolak tidak dipulihkan di tempat → Buat penerimaan baru dengan riwayat saling tertaut; aman diulang", async () => {
  const w = await dunia(); const po = await poOcean(w); const sebelumAwal = await snap();
  // Dibatalkan → pulihkan
  const a = await grDariPO(w, po);
  assert.equal((await w.g.post(`${GR}/${a.id}/batalkan-jadwal`, { alasan: "uji coba Schedule" })).status, 200);
  assert.deepEqual(await kodeAksi(w, a.id), ["PULIHKAN"]);
  assert.equal((await w.s.post(`${GR}/${a.id}/pulihkan`, {})).status, 403);
  const p = await w.g.post(`${GR}/${a.id}/pulihkan`, { alasan: "salah batal" }); assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(p.body.status, "DRAFT");
  assert.deepEqual(await kodeAksi(w, a.id), ["UBAH_JADWAL", "JADWALKAN", "BATALKAN_JADWAL"]);
  assert.equal((await w.g.post(`${GR}/${a.id}/pulihkan`, {})).status, 200, "aman diulang");
  const jejak = (await w.g.get(`${GR}/${a.id}`)).body.jejak.map((x) => x.aksi); assert.deepEqual(jejak, ["JADWAL_DIBATALKAN", "DIPULIHKAN"], "jejak lengkap, tidak ada yang dihapus");
  assert.equal((await snap()).mov, sebelumAwal.mov, "tanpa pergerakan stok");
  // Ditolak (pernah tiba) → tidak bisa dipulihkan; buat ulang
  assert.equal((await w.g.patch(`${GR}/${a.id}`, { status: "SCHEDULED" })).status, 200);
  assert.equal((await tibaGudang(w, po, a)).status, 201);
  assert.equal((await w.g.patch(`${GR}/${a.id}/reject`, { reason: "salah tolak, ternyata utuh" })).status, 200);
  const dit = (await w.g.get(`${GR}/${a.id}`)).body; assert.equal(dit.tampilan.kode, "DITOLAK"); assert.deepEqual(dit.tampilan.aksi.map((x) => x.kode), ["BUAT_ULANG"]);
  const tolakPulih = await w.g.post(`${GR}/${a.id}/pulihkan`, {}); assert.equal(tolakPulih.status, 409); assert.equal(tolakPulih.body.code, "PERNAH_BERISI_BARANG");
  assert.equal((await w.g.post(`${GR}/${a.id}/buat-ulang`, {})).status, 400, "alasan wajib");
  assert.equal((await w.s.post(`${GR}/${a.id}/buat-ulang`, { alasan: "tidak boleh" })).status, 403);
  const hitungSebelum = (await snap()).gr;
  const b = await w.g.post(`${GR}/${a.id}/buat-ulang`, { alasan: "penolakan keliru, barang utuh" }); assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.notEqual(b.body.id, a.id); assert.equal(b.body.status, "DRAFT"); assert.equal(b.body.purchaseOrderId, po.id); assert.equal(b.body.dariNomor, a.receiptNumber); assert.match(b.body.notes, new RegExp(a.receiptNumber));
  assert.equal(b.body.lines.length, 2, "baris dari sisa PO"); assert.ok(b.body.lines.every((l) => l.receivedQty === null && Number(l.orderedQty) > 0));
  // dokumen lama TIDAK berubah; kedua dokumen saling menunjuk
  const lama = (await w.g.get(`${GR}/${a.id}`)).body; assert.equal(lama.status, "REJECTED");
  assert.deepEqual(lama.jejak.filter((x) => x.aksi === "DIBUAT_ULANG_MENJADI").map((x) => x.tautan.nomor), [b.body.receiptNumber]);
  const baru = (await w.g.get(`${GR}/${b.body.id}`)).body; assert.deepEqual(baru.jejak.map((x) => [x.aksi, x.tautan?.nomor]), [["DIBUAT_ULANG_DARI", a.receiptNumber]]);
  // aman diulang: tidak menggandakan
  const ulang = await w.g.post(`${GR}/${a.id}/buat-ulang`, { alasan: "klik dua kali" }); assert.equal(ulang.status, 200); assert.equal(ulang.body.id, b.body.id); assert.equal((await snap()).gr, hitungSebelum + 1);
  assert.equal((await snap()).mov, sebelumAwal.mov, "tidak ada pergerakan stok palsu"); assert.equal((await snap()).jurnal, sebelumAwal.jurnal);
  // PO sudah punya jadwal aktif lain → buat ulang dokumen ditolak lain diarahkan memakai jadwal itu
  const c = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-UX-TOLAK2", sourceType: "PURCHASE_ORDER", purchaseOrderId: po.id, status: "REJECTED", lines: { create: [{ materialId: w.o120.id, receivedQty: 3, rejectedQty: 3 }] } } });
  const bentrok = await w.g.post(`${GR}/${c.id}/buat-ulang`, { alasan: "coba lagi" }); assert.equal(bentrok.status, 409); assert.equal(bentrok.body.code, "SUDAH_ADA_JADWAL"); assert.match(bentrok.body.error, new RegExp(b.body.receiptNumber));
  // tanpa PO: baris disalin
  const non = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-UX-NONPO", sourceType: "MANUAL", supplier: "Toko X", status: "REJECTED", lines: { create: [{ materialId: w.o120.id, orderedQty: 7, receivedQty: 7, rejectedQty: 7 }] } } });
  const nb = await w.g.post(`${GR}/${non.id}/buat-ulang`, { alasan: "ulang tanpa PO" }); assert.equal(nb.status, 201); assert.equal(nb.body.purchaseOrderId, null); assert.equal(nb.body.lines.length, 1); assert.equal(Number(nb.body.lines[0].orderedQty), 7); assert.equal(nb.body.lines[0].receivedQty, null);
  // status lain tidak bisa dibuat ulang
  const jadwal = await grDariPO(w, await poOcean(w)); assert.equal((await w.g.post(`${GR}/${jadwal.id}/buat-ulang`, { alasan: "tidak perlu" })).status, 409);
});
