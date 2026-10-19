// Dunia data representatif Pusat Kerja Gudang (UX Gudang Tahap 4) — dipakai tes integrasi DAN server QA browser (DB terisolasi saja, tidak pernah production).
import { randomUUID } from "node:crypto";
import { testPrisma } from "./testDb.js";

export const geser = (n) => new Date(Date.now() + 7 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);
export const tgl = (n) => new Date(`${geser(n)}T00:00:00Z`);
export const mundurHari = (n) => new Date(Date.now() - n * 86_400_000);

export const TIBA = { arrivedDate: tgl(-1), arrivalRecordedAt: new Date(), arrivalReceiver: "Budi", arrivalNote: "Tiba", arrivalWorkspace: "GUDANG", arrivalRevision: 1 };
export const nomor = (p, i) => `${p}-${String(i).padStart(4, "0")}`;

export async function isiData(w) {
  // 60 penerimaan terjadwal: 20 tanpa tanggal & tanpa PO, 20 jadwal LEWAT, 10 hari ini, 10 masa depan
  let i = 0; const buat = (data) => testPrisma.goodsReceipt.create({ data: { sourceType: "MANUAL", supplier: `Toko ${i % 7}`, createdById: w.gudang.user.id, ...data, receiptNumber: nomor("GR", ++i), lines: { create: [{ materialId: w.bahan.id, orderedQty: 5 }] } } });
  for (let k = 0; k < 20; k++) await buat({ status: "SCHEDULED" });
  for (let k = 0; k < 20; k++) await buat({ status: "SCHEDULED", expectedDate: tgl(-(k + 2)) });
  for (let k = 0; k < 10; k++) await buat({ status: "SCHEDULED", expectedDate: tgl(0) });
  for (let k = 0; k < 10; k++) await buat({ status: "SCHEDULED", expectedDate: tgl(k + 1) });
  // 15 barang tiba, 10 pemeriksaan (5 lengkap, 5 belum), 5 siap masuk stok (1 tanpa jumlah baik)
  for (let k = 0; k < 15; k++) await buat({ status: "ARRIVED", ...TIBA });
  for (let k = 0; k < 10; k++) { const g = await testPrisma.goodsReceipt.create({ data: { sourceType: "MANUAL", receiptNumber: nomor("GR", ++i), status: "INSPECTION", ...TIBA, lines: { create: [{ materialId: w.bahan.id, receivedQty: 5, ...(k < 5 ? { acceptedQty: 5, rejectedQty: 0 } : {}) }] } } }); void g; }
  for (let k = 0; k < 5; k++) await testPrisma.goodsReceipt.create({ data: { sourceType: "MANUAL", receiptNumber: nomor("GR", ++i), status: "READY_FOR_PUTAWAY", ...TIBA, lines: { create: [{ materialId: w.bahan.id, receivedQty: 5, acceptedQty: k === 0 ? 0 : 5, rejectedQty: 0 }] } } });
  // 10 penerimaan lama kosong (tanpa jumlah apa pun) tidak boleh dihitung
  for (let k = 0; k < 10; k++) await testPrisma.goodsReceipt.create({ data: { sourceType: "MANUAL", receiptNumber: nomor("GR", ++i), status: "ARRIVED", lines: { create: [{ materialId: w.bahan.id }] } } });
  // 30 permintaan bahan: 10 menunggu, 10 disetujui (5 butuh > saldo), 5 siap, 5 diambil; 5 di antaranya lewat tanggal dibutuhkan
  let m = 0; const mi = (status, extra = {}, qty = 2) => testPrisma.materialIssue.create({ data: { issueNumber: nomor("MI", ++m), sourceType: "MANUAL", department: "Produksi Meja", status, ...extra, lines: { create: [{ materialId: w.bahan.id, requestedQty: qty }] } } });
  for (let k = 0; k < 10; k++) await mi("WAITING_APPROVAL");
  for (let k = 0; k < 5; k++) await mi("APPROVED", { requiredDate: tgl(-3) });
  for (let k = 0; k < 5; k++) await mi("APPROVED", {}, 50); // butuh 50 > saldo 10
  for (let k = 0; k < 5; k++) await mi("READY_TO_PICK");
  for (let k = 0; k < 5; k++) await mi("PICKED");
  // Produksi V2 (productionPlanId terisi) tidak boleh dihitung di antrean Gudang: tidak ada rencana nyata → tidak dibuat
  // 12 transfer: 3 menunggu, 3 disetujui, 3 diambil, 3 jalan; + 2 selesai dengan selisih, 1 selesai tanpa selisih
  const wh = await testPrisma.warehouse.create({ data: { code: "WH", name: "Gudang" } });
  const a = await testPrisma.storageLocation.create({ data: { warehouseId: wh.id, code: "A1", zone: "RM", locationType: "RAW_MATERIAL_AREA" } }); const b = await testPrisma.storageLocation.create({ data: { warehouseId: wh.id, code: "B1", zone: "WIP", locationType: "WIP_AREA" } });
  let t = 0; const st = (status, qs = 1, qr = null) => testPrisma.stockTransfer.create({ data: { transferNumber: nomor("TR", ++t), transferType: "ZONE_TO_ZONE", sourceLocationId: a.id, destinationLocationId: b.id, status, lines: { create: [{ materialId: w.bahan2.id, qtySent: qs, qtyReceived: qr }] } } });
  for (const s of ["WAITING_APPROVAL", "APPROVED", "PICKED", "IN_TRANSIT"]) for (let k = 0; k < 3; k++) await st(s);
  await st("COMPLETED", 10, 8); await st("COMPLETED", 10, 7); await st("COMPLETED", 10, 10);
  // Stock Count
  await testPrisma.stockCount.create({ data: { countNumber: "CC-1", countType: "CYCLE_COUNT", countMethod: "BY_ITEM", status: "SCHEDULED", scheduledDate: tgl(-2) } });
  await testPrisma.stockCount.create({ data: { countNumber: "CC-2", countType: "CYCLE_COUNT", countMethod: "BY_ITEM", status: "SCHEDULED" } });
  await testPrisma.stockCount.create({ data: { countNumber: "CC-3", countType: "CYCLE_COUNT", countMethod: "BY_ITEM", status: "IN_PROGRESS" } });
  await testPrisma.stockCount.create({ data: { countNumber: "CC-4", countType: "FULL_STOCK_OPNAME", countMethod: "BY_ITEM", status: "WAITING_REVIEW", submittedAt: new Date() } });
  // koreksi menunggu (diajukan owner lain), penyesuaian menunggu
  const gr1 = await testPrisma.goodsReceipt.findFirst({ where: { status: "SCHEDULED" } });
  await testPrisma.warehouseCorrection.create({ data: { correctionNumber: "KG-1", docType: "GOODS_RECEIPT", docId: gr1.id, docNumber: gr1.receiptNumber, kind: "STOCK", status: "PENDING_APPROVAL", reason: "alasan uji koreksi dokumen penerimaan", changes: {}, preview: {}, docToken: "x", requestedById: w.gudang.user.id, idempotencyKey: randomUUID() } });
  await testPrisma.stockAdjustmentRequest.create({ data: { adjustmentNumber: "ADJ-1", materialId: w.bahan.id, adjustmentType: "COUNT_DIFFERENCE", beforeQty: 1, adjustmentQty: 1, reason: "uji", status: "WAITING_APPROVAL", requestedById: w.gudang.user.id } });
  // selesai terbaru
  await testPrisma.goodsReceipt.create({ data: { sourceType: "MANUAL", supplier: "PT Selesai", receiptNumber: nomor("GR", ++i), status: "COMPLETED", lines: { create: [{ materialId: w.bahan.id, acceptedQty: 1 }] } } });
  await testPrisma.materialIssue.create({ data: { issueNumber: nomor("MI", ++m), sourceType: "MANUAL", status: "ISSUED", issuedAt: new Date(), issuedById: w.gudang.user.id } });
  return { gr: i, mi: m, tr: t };
}
