// Returns — Warehouse Tahap 6.
//
// Cuma resolusi RETURN_TO_AVAILABLE yang menulis ledger (RETURN, positif) —
// lihat catatan panjang di schema.prisma di atas model ReturnRecord. Lima
// resolusi lain sengaja tidak menulis apa pun.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";

export const returnRecordRouter = express.Router();
returnRecordRouter.use(requireAuth);

class ReturnRecordError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (err instanceof ReturnRecordError) return res.status(err.statusCode).json({ error: err.message });
  if (err.code === "P2002") return res.status(409).json({ error: "Nomor retur sudah dipakai" });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Return record error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

const RETURN_TYPES = ["CUSTOMER_RETURN", "DELIVERY_RETURN", "PRODUCTION_RETURN", "SUPPLIER_RETURN"];
const RESOLUTIONS = ["RETURN_TO_AVAILABLE", "QUARANTINE", "REWORK", "RETURN_TO_SUPPLIER", "DISPOSE", "REPLACE_PRODUCT"];
const FORWARD_FLOW = ["CREATED", "RECEIVED", "INSPECTION", "COMPLETED"];

const recordInclude = {
  material: { select: { id: true, code: true, name: true, unit: true } },
  createdBy: { select: { id: true, name: true } },
};

function generateCode(date) {
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `RTN-${dd}${mm}${yy}`;
}

returnRecordRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const { status, returnType } = req.query;
    const records = await prisma.returnRecord.findMany({
      where: { ...(status && { status }), ...(returnType && { returnType }) },
      include: recordInclude,
      orderBy: [{ createdAt: "desc" }],
    });
    res.json({ records });
  } catch (err) {
    handleErr(err, res);
  }
});

returnRecordRouter.get("/:id", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const record = await prisma.returnRecord.findUnique({ where: { id: req.params.id }, include: recordInclude });
    if (!record) return res.status(404).json({ error: "Retur tidak ditemukan" });
    res.json(record);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/returns { returnType, reference?, materialId, qty, condition?, notes? }
returnRecordRouter.post("/", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { returnType, reference, materialId, qty, condition, notes } = req.body;
    if (!RETURN_TYPES.includes(returnType)) throw new ReturnRecordError("Return type tidak valid");
    if (!materialId) throw new ReturnRecordError("Item wajib dipilih");
    const qtyNum = Number(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) throw new ReturnRecordError("Quantity wajib lebih dari 0");

    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const existing = await prisma.returnRecord.count({ where: { createdAt: { gte: startOfDay } } });
    const returnNumber = `${generateCode(today)}-${String(existing + 1).padStart(2, "0")}`;

    const record = await prisma.returnRecord.create({
      data: {
        returnNumber, returnType, reference: reference || null, materialId, qty: qtyNum,
        condition: condition || null, notes: notes || null, createdById: req.user.id,
      },
      include: recordInclude,
    });
    res.status(201).json(record);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/returns/:id — transisi CREATED → RECEIVED → INSPECTION
// (COMPLETED hanya lewat /complete, karena menulis ledger). { status?, inspectionNote? }
returnRecordRouter.patch("/:id", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const existing = await prisma.returnRecord.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Retur tidak ditemukan" });
    if (!FORWARD_FLOW.slice(0, -1).includes(existing.status)) {
      throw new ReturnRecordError(`Retur berstatus ${existing.status} tidak bisa diubah lewat sini`);
    }

    const { status, inspectionNote, condition, notes } = req.body;
    const data = {};
    if (inspectionNote !== undefined) data.inspectionNote = inspectionNote || null;
    if (condition !== undefined) data.condition = condition || null;
    if (notes !== undefined) data.notes = notes || null;

    if (status) {
      const currentIdx = FORWARD_FLOW.indexOf(existing.status);
      const nextIdx = FORWARD_FLOW.indexOf(status);
      if (nextIdx === -1 || nextIdx !== currentIdx + 1) {
        throw new ReturnRecordError(`Tidak bisa langsung ke status ${status} dari ${existing.status} — harus berurutan`);
      }
      if (status === "COMPLETED") throw new ReturnRecordError("Status COMPLETED hanya lewat POST /:id/complete");
      data.status = status;
      if (status === "RECEIVED") data.receivedAt = new Date();
      if (status === "INSPECTION") data.inspectedAt = new Date();
    }

    const record = await prisma.returnRecord.update({ where: { id: req.params.id }, data, include: recordInclude });
    res.json(record);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/returns/:id/complete { resolution }
// SATU-SATUNYA jalan retur ini menulis ledger — dan hanya untuk
// RETURN_TO_AVAILABLE.
returnRecordRouter.post("/:id/complete", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const record = await prisma.returnRecord.findUnique({ where: { id: req.params.id }, include: recordInclude });
    if (!record) return res.status(404).json({ error: "Retur tidak ditemukan" });
    if (record.status !== "INSPECTION") throw new ReturnRecordError("Hanya retur berstatus Inspection yang bisa diselesaikan");
    const { resolution } = req.body;
    if (!RESOLUTIONS.includes(resolution)) throw new ReturnRecordError("Resolusi tidak valid");

    const result = await prisma.$transaction(async (tx) => {
      if (resolution === "RETURN_TO_AVAILABLE") {
        await tx.stockMovement.create({
          data: {
            materialId: record.materialId, type: "RETURN", qty: record.qty,
            note: `Return ${record.returnNumber}`, returnRecordId: record.id,
            createdById: req.user.id,
          },
        });
      }
      return tx.returnRecord.update({
        where: { id: record.id },
        data: { status: "COMPLETED", resolution, completedAt: new Date() },
        include: recordInclude,
      });
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/returns/:id/cancel { reason }
returnRecordRouter.patch("/:id/cancel", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const record = await prisma.returnRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Retur tidak ditemukan" });
    if (record.status === "COMPLETED" || record.status === "CANCELLED") {
      throw new ReturnRecordError(`Retur berstatus ${record.status} tidak bisa dibatalkan`);
    }
    const { reason } = req.body;
    if (!reason?.trim()) throw new ReturnRecordError("Alasan pembatalan wajib diisi");
    const updated = await prisma.returnRecord.update({
      where: { id: record.id },
      data: { status: "CANCELLED", notes: [record.notes, `Dibatalkan: ${reason.trim()}`].filter(Boolean).join(" — ") },
      include: recordInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});
