// Goods Receipt — Warehouse Tahap 2B.
//
// Dokumen PROSES di depan ledger inventory yang sudah ada (routes/
// inventory.js). TIDAK PERNAH menyimpan angka stok sendiri — status
// berjalan DRAFT → SCHEDULED → ARRIVED → INSPECTION → READY_FOR_PUTAWAY →
// COMPLETED, dan baris stock_movements RECEIPT baru ditulis SATU KALI, saat
// putaway dikonfirmasi. Lihat catatan panjang di schema.prisma di atas
// model GoodsReceipt untuk alasan lengkapnya.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";

export const goodsReceiptRouter = express.Router();
goodsReceiptRouter.use(requireAuth);

class ReceiptError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (err instanceof ReceiptError) return res.status(err.statusCode).json({ error: err.message });
  if (err.code === "P2002") return res.status(409).json({ error: "Nomor receipt sudah dipakai" });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Goods receipt error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

const SOURCE_TYPES = [
  "PURCHASE_ORDER", "SUPPLIER_DELIVERY", "PRODUCTION_RETURN",
  "CUSTOMER_RETURN", "INTER_WAREHOUSE_TRANSFER", "MANUAL",
];

// Urutan maju yang sah. REJECTED dijangkau lewat endpoint terpisah
// (/reject) dari status mana pun sebelum COMPLETED — bukan bagian dari
// urutan maju ini.
const FORWARD_FLOW = ["DRAFT", "SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED"];

const receiptInclude = {
  lines: { include: { material: { select: { id: true, code: true, name: true, unit: true } } } },
  createdBy: { select: { id: true, name: true } },
};

function generateReceiptCode(date) {
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `GR-${dd}${mm}${yy}`;
}

// GET /api/inventory/goods-receipts?status=&sourceType=
goodsReceiptRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const { status, sourceType } = req.query;
    const receipts = await prisma.goodsReceipt.findMany({
      where: { ...(status && { status }), ...(sourceType && { sourceType }) },
      include: receiptInclude,
      orderBy: [{ createdAt: "desc" }],
    });
    res.json({ receipts });
  } catch (err) {
    handleErr(err, res);
  }
});

goodsReceiptRouter.get("/:id", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const receipt = await prisma.goodsReceipt.findUnique({ where: { id: req.params.id }, include: receiptInclude });
    if (!receipt) return res.status(404).json({ error: "Goods receipt tidak ditemukan" });
    res.json(receipt);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/goods-receipts
// { sourceType, sourceReference?, supplier?, expectedDate?, notes?, lines: [{materialId, orderedQty?}] }
goodsReceiptRouter.post("/", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { sourceType, sourceReference, supplier, expectedDate, notes, lines } = req.body;
    if (!SOURCE_TYPES.includes(sourceType)) throw new ReceiptError("Source type tidak valid");
    if (!Array.isArray(lines) || lines.length === 0) throw new ReceiptError("Minimal satu item wajib diisi");
    for (const l of lines) {
      if (!l.materialId) throw new ReceiptError("Setiap baris wajib memilih item");
    }

    // Nomor berurut per tanggal: GR-DDMMYY-NN, sama pola dengan RTE-DDMMYY-NN
    // di armada.js — dihitung dari jumlah receipt yang SUDAH ADA hari itu,
    // cukup untuk volume harian yang realistis.
    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const existing = await prisma.goodsReceipt.count({ where: { createdAt: { gte: startOfDay } } });
    const receiptNumber = `${generateReceiptCode(today)}-${String(existing + 1).padStart(2, "0")}`;

    const receipt = await prisma.goodsReceipt.create({
      data: {
        receiptNumber, sourceType,
        sourceReference: sourceReference || null,
        supplier: supplier || null,
        expectedDate: expectedDate ? new Date(`${expectedDate}T00:00:00.000Z`) : null,
        notes: notes || null,
        createdById: req.user.id,
        lines: {
          create: lines.map((l) => ({
            materialId: l.materialId,
            orderedQty: l.orderedQty != null && l.orderedQty !== "" ? Number(l.orderedQty) : null,
          })),
        },
      },
      include: receiptInclude,
    });
    res.status(201).json(receipt);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/goods-receipts/:id
// Header fields + transisi status MAJU satu langkah pada satu waktu.
// { sourceReference?, supplier?, expectedDate?, receivedDate?, deliveryNote?, notes?, status? }
goodsReceiptRouter.patch("/:id", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const existing = await prisma.goodsReceipt.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Goods receipt tidak ditemukan" });
    if (existing.status === "COMPLETED" || existing.status === "REJECTED") {
      throw new ReceiptError(`Receipt berstatus ${existing.status} tidak bisa diubah lagi`);
    }

    const { sourceReference, supplier, expectedDate, receivedDate, deliveryNote, notes, status } = req.body;
    const data = {};
    if (sourceReference !== undefined) data.sourceReference = sourceReference || null;
    if (supplier !== undefined) data.supplier = supplier || null;
    if (expectedDate !== undefined) data.expectedDate = expectedDate ? new Date(`${expectedDate}T00:00:00.000Z`) : null;
    if (receivedDate !== undefined) data.receivedDate = receivedDate ? new Date(`${receivedDate}T00:00:00.000Z`) : null;
    if (deliveryNote !== undefined) data.deliveryNote = deliveryNote || null;
    if (notes !== undefined) data.notes = notes || null;

    if (status) {
      const currentIdx = FORWARD_FLOW.indexOf(existing.status);
      const nextIdx = FORWARD_FLOW.indexOf(status);
      if (nextIdx === -1) throw new ReceiptError("Status tidak valid");
      if (nextIdx !== currentIdx + 1) {
        throw new ReceiptError(`Tidak bisa langsung ke status ${status} dari ${existing.status} — harus berurutan`);
      }
      if (status === "COMPLETED") {
        throw new ReceiptError("Status COMPLETED hanya ditetapkan lewat putaway (POST /:id/putaway)");
      }
      data.status = status;
    }

    const receipt = await prisma.goodsReceipt.update({ where: { id: req.params.id }, data, include: receiptInclude });
    res.json(receipt);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/goods-receipts/:id/lines/:lineId
// Isi hasil kedatangan/inspeksi per baris. { receivedQty?, acceptedQty?, rejectedQty?, condition?, notes? }
goodsReceiptRouter.patch("/:id/lines/:lineId", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const receipt = await prisma.goodsReceipt.findUnique({ where: { id: req.params.id } });
    if (!receipt) return res.status(404).json({ error: "Goods receipt tidak ditemukan" });
    if (receipt.status === "COMPLETED" || receipt.status === "REJECTED") {
      throw new ReceiptError(`Receipt berstatus ${receipt.status} tidak bisa diubah lagi`);
    }
    const line = await prisma.goodsReceiptLine.findFirst({ where: { id: req.params.lineId, goodsReceiptId: receipt.id } });
    if (!line) return res.status(404).json({ error: "Baris item tidak ditemukan" });

    const { receivedQty, acceptedQty, rejectedQty, condition, notes } = req.body;
    const toNum = (v) => (v === undefined ? undefined : v === "" || v === null ? null : Number(v));
    const updated = await prisma.goodsReceiptLine.update({
      where: { id: line.id },
      data: {
        ...(receivedQty !== undefined && { receivedQty: toNum(receivedQty) }),
        ...(acceptedQty !== undefined && { acceptedQty: toNum(acceptedQty) }),
        ...(rejectedQty !== undefined && { rejectedQty: toNum(rejectedQty) }),
        ...(condition !== undefined && { condition: condition || null }),
        ...(notes !== undefined && { notes: notes || null }),
      },
      include: { material: { select: { id: true, code: true, name: true, unit: true } } },
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/goods-receipts/:id/putaway
// SATU-SATUNYA jalan sebuah baris goods receipt menjadi baris ledger nyata.
// Wajib status READY_FOR_PUTAWAY. Untuk tiap baris dengan acceptedQty > 0,
// membuat SATU StockMovement RECEIPT (qty positif, supplier dari header
// receipt, goodsReceiptId menempel) — lalu menutup receipt jadi COMPLETED.
// Dibungkus transaksi: kalau satu baris gagal, tidak ada ledger yang
// setengah tertulis.
goodsReceiptRouter.post("/:id/putaway", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const receipt = await prisma.goodsReceipt.findUnique({ where: { id: req.params.id }, include: receiptInclude });
    if (!receipt) return res.status(404).json({ error: "Goods receipt tidak ditemukan" });
    if (receipt.status !== "READY_FOR_PUTAWAY") {
      throw new ReceiptError("Hanya receipt berstatus Ready for Putaway yang bisa ditempatkan");
    }
    const diterima = receipt.lines.filter((l) => l.acceptedQty != null && l.acceptedQty > 0);
    if (diterima.length === 0) {
      throw new ReceiptError("Tidak ada baris dengan Accepted Quantity — isi hasil inspeksi dulu");
    }

    const { location } = req.body;
    const result = await prisma.$transaction(async (tx) => {
      for (const line of diterima) {
        await tx.stockMovement.create({
          data: {
            materialId: line.materialId, type: "RECEIPT", qty: line.acceptedQty,
            location: location || undefined, supplier: receipt.supplier || null,
            note: `Putaway ${receipt.receiptNumber}`, goodsReceiptId: receipt.id,
            createdById: req.user.id,
          },
        });
      }
      return tx.goodsReceipt.update({
        where: { id: receipt.id },
        data: { status: "COMPLETED", receivedDate: receipt.receivedDate || new Date() },
        include: receiptInclude,
      });
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/goods-receipts/:id/reject { reason }
goodsReceiptRouter.patch("/:id/reject", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const receipt = await prisma.goodsReceipt.findUnique({ where: { id: req.params.id } });
    if (!receipt) return res.status(404).json({ error: "Goods receipt tidak ditemukan" });
    if (receipt.status === "COMPLETED" || receipt.status === "REJECTED") {
      throw new ReceiptError(`Receipt berstatus ${receipt.status} tidak bisa ditolak`);
    }
    const { reason } = req.body;
    if (!reason?.trim()) throw new ReceiptError("Alasan penolakan wajib diisi");
    const updated = await prisma.goodsReceipt.update({
      where: { id: receipt.id },
      data: { status: "REJECTED", notes: [receipt.notes, `Ditolak: ${reason.trim()}`].filter(Boolean).join(" — ") },
      include: receiptInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});
