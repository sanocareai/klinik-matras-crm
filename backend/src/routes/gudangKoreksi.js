// KOREKSI KESALAHAN INPUT GUDANG — satu pintu untuk cakupan, jalur per dokumen, dan koreksi Penerimaan Barang yang sudah masuk stok.
//   GET  /api/inventory/koreksi/cakupan                  matriks cakupan per menu + daftar kode penghalang (inventory:read)
//   GET  /api/inventory/koreksi/dokumen/:tipe/:id        jalur koreksi dokumen (EDIT_DRAF | KOREKSI_UI | ALUR_RESMI | DIBLOKIR | FINAL) + riwayat koreksi (inventory:read)
//   GET  /api/inventory/koreksi/goods-receipts/:id/keadaan     keadaan untuk formulir koreksi (jumlah bersih ledger, lokasi, bidang yang boleh) (inventory:read)
//   POST /api/inventory/koreksi/goods-receipts/:id/pratinjau   dampak koreksi (READ ONLY; tidak menulis) (inventory:write)
//   POST /api/inventory/koreksi/goods-receipts/:id/ajukan      ajukan/terapkan koreksi — Idempotency-Key WAJIB, alasan wajib (inventory:write)
//   GET  /api/inventory/koreksi                          daftar koreksi (?status=&docId=)      GET /:id detail
//   POST /api/inventory/koreksi/:id/setujui | /tolak     penyetuju ≠ pemohon (inventory:adjustment_approve)
//   POST /api/inventory/koreksi/:id/batal                pemohon membatalkan selagi menunggu (inventory:write)
// Tidak ada endpoint yang menulis jurnal/pembayaran/tagihan Finance atau data Produksi.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { idempotency, wajibIdempotencyKey } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { JALUR, MATRIKS_MENU, PENGHALANG, TIPE, TIPE_DIKENAL, jalurDokumen } from "../services/warehouseCoverage.js";
import { KoreksiError, ajukanKoreksiGR, ambilKoreksi, batalkanKoreksi, daftarKoreksi, keadaanKoreksiGR, pratinjauKoreksiGR, setujuiKoreksi, tolakKoreksi } from "../services/warehouseCorrection.js";

export const gudangKoreksiRouter = express.Router();
gudangKoreksiRouter.use(requireAuth);
gudangKoreksiRouter.use(idempotency);

function galat(err, res) {
  if (err instanceof KoreksiError || typeof err?.statusCode === "number") return res.status(err.statusCode ?? 409).json({ error: err.message, ...(err.code && typeof err.code === "string" && { code: err.code }), ...(err.penghalang && { penghalang: err.penghalang }) });
  if (err?.code === "P2002") return res.status(409).json({ error: "Data bentrok — coba lagi", code: "BENTROK" });
  console.error("Koreksi gudang error:", err);
  return res.status(500).json({ error: pesanServerAman(err) });
}
const aktorDari = (req) => ({ id: req.user.id });

const PEMUAT = {
  [TIPE.GOODS_RECEIPT]: (id) => prisma.goodsReceipt.findUnique({ where: { id }, select: { id: true, receiptNumber: true, status: true, purchaseOrderId: true, sourceType: true } }).then((d) => d && { ...d, nomor: d.receiptNumber }),
  [TIPE.MATERIAL_ISSUE]: (id) => prisma.materialIssue.findUnique({ where: { id }, select: { id: true, issueNumber: true, status: true, productionPlanId: true, unitId: true } }).then((d) => d && { ...d, nomor: d.issueNumber }),
  [TIPE.STOCK_TRANSFER]: (id) => prisma.stockTransfer.findUnique({ where: { id }, select: { id: true, transferNumber: true, status: true } }).then((d) => d && { ...d, nomor: d.transferNumber }),
  [TIPE.RETURN_RECORD]: (id) => prisma.returnRecord.findUnique({ where: { id }, select: { id: true, returnNumber: true, status: true, resolution: true } }).then((d) => d && { ...d, nomor: d.returnNumber }),
  [TIPE.DAMAGED_STOCK]: (id) => prisma.damagedStockRecord.findUnique({ where: { id }, select: { id: true, recordNumber: true, status: true, resolution: true } }).then((d) => d && { ...d, nomor: d.recordNumber }),
  [TIPE.STOCK_ADJUSTMENT]: (id) => prisma.stockAdjustmentRequest.findUnique({ where: { id }, select: { id: true, adjustmentNumber: true, status: true } }).then((d) => d && { ...d, nomor: d.adjustmentNumber }),
  [TIPE.STOCK_COUNT]: (id) => prisma.stockCount.findUnique({ where: { id }, select: { id: true, countNumber: true, status: true } }).then((d) => d && { ...d, nomor: d.countNumber }),
  [TIPE.SUPPLIER_RETURN]: (id) => prisma.supplierReturn.findUnique({ where: { id }, select: { id: true, returnNumber: true, status: true } }).then((d) => d && { ...d, nomor: d.returnNumber }),
};

gudangKoreksiRouter.get("/cakupan", requirePermission(P.INVENTORY_READ), (_req, res) => {
  res.json({ jalur: Object.values(JALUR), menu: MATRIKS_MENU, penghalang: Object.fromEntries(Object.entries(PENGHALANG).map(([k, v]) => [k, { pesan: v.pesan, langkah: v.langkah }])), batas: "Koreksi Gudang tidak mengubah pembayaran/jurnal/tagihan Finance dan tidak menciptakan QC, penerimaan fisik, atau pemakaian Produksi." });
});

gudangKoreksiRouter.get("/dokumen/:tipe/:id", requirePermission(P.INVENTORY_READ), wajibUuid(), async (req, res) => {
  try {
    const tipe = String(req.params.tipe);
    if (!TIPE_DIKENAL.includes(tipe)) return res.status(400).json({ error: "Jenis dokumen tidak dikenal", code: "TIPE_TIDAK_DIKENAL", tipe: TIPE_DIKENAL });
    const doc = await PEMUAT[tipe](req.params.id);
    if (!doc) return res.status(404).json({ error: "Dokumen tidak ditemukan" });
    const riwayat = tipe === TIPE.GOODS_RECEIPT ? (await daftarKoreksi(prisma, { docId: doc.id, docType: tipe, limit: 50 })).koreksi : [];
    res.json({ dokumen: { tipe, id: doc.id, nomor: doc.nomor, status: doc.status }, ...jalurDokumen(tipe, doc), riwayatKoreksi: riwayat });
  } catch (err) { galat(err, res); }
});

gudangKoreksiRouter.get("/goods-receipts/:id/keadaan", requirePermission(P.INVENTORY_READ), wajibUuid(), async (req, res) => {
  try { res.json(await keadaanKoreksiGR(prisma, req.params.id)); } catch (err) { galat(err, res); }
});

gudangKoreksiRouter.post("/goods-receipts/:id/pratinjau", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try { res.json({ pratinjau: true, ...(await pratinjauKoreksiGR(prisma, { receiptId: req.params.id, perubahan: req.body?.perubahan })) }); } catch (err) { galat(err, res); }
});

gudangKoreksiRouter.post("/goods-receipts/:id/ajukan", requirePermission(P.INVENTORY_WRITE), wajibUuid(), wajibIdempotencyKey, async (req, res) => {
  try {
    const hasil = await ajukanKoreksiGR(prisma, { receiptId: req.params.id, perubahan: req.body?.perubahan, alasan: req.body?.alasan, kunci: req.headers["idempotency-key"], aktor: aktorDari(req) });
    res.status(hasil.ulang ? 200 : 201).json(hasil);
  } catch (err) { galat(err, res); }
});

gudangKoreksiRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const status = ["PENDING_APPROVAL", "POSTED", "REJECTED", "CANCELLED"].includes(String(req.query.status)) ? String(req.query.status) : null;
    res.json(await daftarKoreksi(prisma, { status, docId: /^[0-9a-f-]{36}$/i.test(String(req.query.docId ?? "")) ? String(req.query.docId) : null, limit: Number(req.query.limit) || 100, offset: Number(req.query.offset) || 0 }));
  } catch (err) { galat(err, res); }
});

gudangKoreksiRouter.get("/:id", requirePermission(P.INVENTORY_READ), wajibUuid(), async (req, res) => {
  try { res.json(await ambilKoreksi(prisma, req.params.id)); } catch (err) { galat(err, res); }
});

gudangKoreksiRouter.post("/:id/setujui", requirePermission(P.INVENTORY_ADJUSTMENT_APPROVE), wajibUuid(), async (req, res) => {
  try { res.json(await setujuiKoreksi(prisma, { koreksiId: req.params.id, aktor: aktorDari(req), catatan: req.body?.catatan })); } catch (err) { galat(err, res); }
});
gudangKoreksiRouter.post("/:id/tolak", requirePermission(P.INVENTORY_ADJUSTMENT_APPROVE), wajibUuid(), async (req, res) => {
  try { res.json(await tolakKoreksi(prisma, { koreksiId: req.params.id, aktor: aktorDari(req), catatan: req.body?.catatan })); } catch (err) { galat(err, res); }
});
gudangKoreksiRouter.post("/:id/batal", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try { res.json(await batalkanKoreksi(prisma, { koreksiId: req.params.id, aktor: aktorDari(req), catatan: req.body?.catatan })); } catch (err) { galat(err, res); }
});
