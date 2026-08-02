// Stock Adjustment (review-gated) — Warehouse Tahap 6.
//
// Beda dengan POST /inventory/movements/adjustment (satu langkah, langsung
// tertulis — TIDAK diubah, tetap dipakai Stock Count Tahap 5 & koreksi
// cepat Gudang.jsx): ini WAJIB approval sebelum ledger tersentuh. Lihat
// catatan panjang di schema.prisma di atas model StockAdjustmentRequest —
// SEMUA request wajib approval tanpa kecuali (tidak ada kolom harga untuk
// membedakan "tinggi/rendah nilai" secara jujur).

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";

export const stockAdjustmentRouter = express.Router();
stockAdjustmentRouter.use(requireAuth);

class AdjustmentError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (err instanceof AdjustmentError) return res.status(err.statusCode).json({ error: err.message });
  if (err.code === "P2002") return res.status(409).json({ error: "Nomor adjustment sudah dipakai" });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Stock adjustment error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

const ADJUSTMENT_TYPES = [
  "POSITIVE", "NEGATIVE", "COUNT_DIFFERENCE", "DAMAGE", "EXPIRY", "DATA_CORRECTION", "CONVERSION", "OTHER",
];
const FORWARD_FLOW = ["DRAFT", "WAITING_APPROVAL", "APPROVED"];

const requestInclude = {
  material: { select: { id: true, code: true, name: true, unit: true } },
  requestedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  postedBy: { select: { id: true, name: true } },
};

function generateCode(date) {
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `ADJ-${dd}${mm}${yy}`;
}

stockAdjustmentRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const { status, adjustmentType } = req.query;
    const requests = await prisma.stockAdjustmentRequest.findMany({
      where: { ...(status && { status }), ...(adjustmentType && { adjustmentType }) },
      include: requestInclude,
      orderBy: [{ createdAt: "desc" }],
    });
    res.json({ requests });
  } catch (err) {
    handleErr(err, res);
  }
});

stockAdjustmentRouter.get("/:id", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const request = await prisma.stockAdjustmentRequest.findUnique({ where: { id: req.params.id }, include: requestInclude });
    if (!request) return res.status(404).json({ error: "Adjustment request tidak ditemukan" });
    res.json(request);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/adjustments { materialId, adjustmentType, adjustmentQty, reason, notes? }
// beforeQty DISNAPSHOT dari saldo ledger BERJALAN saat request dibuat.
stockAdjustmentRouter.post("/", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { materialId, adjustmentType, adjustmentQty, reason, notes } = req.body;
    if (!materialId) throw new AdjustmentError("Item wajib dipilih");
    if (!ADJUSTMENT_TYPES.includes(adjustmentType)) throw new AdjustmentError("Adjustment type tidak valid");
    const qty = Number(adjustmentQty);
    if (!Number.isFinite(qty) || qty === 0) throw new AdjustmentError("Adjustment quantity wajib diisi dan tidak boleh nol");
    if (!reason?.trim()) throw new AdjustmentError("Alasan wajib diisi");

    const [{ balance }] = await prisma.$queryRaw`
      SELECT COALESCE(SUM(qty), 0)::float AS balance FROM stock_movements WHERE material_id = ${materialId}::uuid
    `;

    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const existing = await prisma.stockAdjustmentRequest.count({ where: { createdAt: { gte: startOfDay } } });
    const adjustmentNumber = `${generateCode(today)}-${String(existing + 1).padStart(2, "0")}`;

    const request = await prisma.stockAdjustmentRequest.create({
      data: {
        adjustmentNumber, adjustmentType, materialId, beforeQty: balance, adjustmentQty: qty,
        reason: reason.trim(), notes: notes || null, requestedById: req.user.id,
      },
      include: requestInclude,
    });
    res.status(201).json(request);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/adjustments/:id — transisi DRAFT → WAITING_APPROVAL →
// APPROVED (POSTED hanya lewat /post, karena menulis ledger).
// { status?, reason?, notes? }
stockAdjustmentRouter.patch("/:id", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const existing = await prisma.stockAdjustmentRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Adjustment request tidak ditemukan" });
    if (!FORWARD_FLOW.includes(existing.status)) {
      throw new AdjustmentError(`Request berstatus ${existing.status} tidak bisa diubah lewat sini`);
    }

    const { status, reason, notes } = req.body;
    const data = {};
    if (reason !== undefined) {
      if (!reason?.trim()) throw new AdjustmentError("Alasan tidak boleh dikosongkan");
      data.reason = reason.trim();
    }
    if (notes !== undefined) data.notes = notes || null;

    if (status) {
      const currentIdx = FORWARD_FLOW.indexOf(existing.status);
      const nextIdx = FORWARD_FLOW.indexOf(status);
      if (nextIdx === -1 || nextIdx !== currentIdx + 1) {
        throw new AdjustmentError(`Tidak bisa langsung ke status ${status} dari ${existing.status} — harus berurutan`);
      }
      data.status = status;
      if (status === "APPROVED") {
        data.approvedById = req.user.id;
        data.approvedAt = new Date();
      }
    }

    const request = await prisma.stockAdjustmentRequest.update({ where: { id: req.params.id }, data, include: requestInclude });
    res.json(request);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/adjustments/:id/post
// SATU-SATUNYA jalan request ini menulis ledger. Wajib APPROVED.
stockAdjustmentRouter.post("/:id/post", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const request = await prisma.stockAdjustmentRequest.findUnique({ where: { id: req.params.id }, include: requestInclude });
    if (!request) return res.status(404).json({ error: "Adjustment request tidak ditemukan" });
    if (request.status !== "APPROVED") throw new AdjustmentError("Hanya request berstatus Approved yang bisa diposting");

    const result = await prisma.$transaction(async (tx) => {
      await tx.stockMovement.create({
        data: {
          materialId: request.materialId, type: "ADJUSTMENT", qty: request.adjustmentQty,
          reason: request.reason, note: `Stock Adjustment ${request.adjustmentNumber}`,
          stockAdjustmentRequestId: request.id, createdById: req.user.id,
        },
      });
      return tx.stockAdjustmentRequest.update({
        where: { id: request.id },
        data: { status: "POSTED", postedById: req.user.id, postedAt: new Date() },
        include: requestInclude,
      });
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/adjustments/:id/cancel { reason }
stockAdjustmentRouter.patch("/:id/cancel", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const request = await prisma.stockAdjustmentRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ error: "Adjustment request tidak ditemukan" });
    if (request.status === "POSTED" || request.status === "CANCELLED") {
      throw new AdjustmentError(`Request berstatus ${request.status} tidak bisa dibatalkan`);
    }
    const { reason } = req.body;
    if (!reason?.trim()) throw new AdjustmentError("Alasan pembatalan wajib diisi");
    const updated = await prisma.stockAdjustmentRequest.update({
      where: { id: request.id },
      data: { status: "CANCELLED", notes: [request.notes, `Dibatalkan: ${reason.trim()}`].filter(Boolean).join(" — ") },
      include: requestInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});
