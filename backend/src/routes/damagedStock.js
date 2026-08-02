// Damaged Stock — Warehouse Tahap 6.
//
// Cuma resolusi DISPOSE & RETURN_TO_SUPPLIER yang menulis ledger (WASTE) —
// lihat catatan panjang di schema.prisma di atas model DamagedStockRecord.
// REWORK & RESTORE_TO_AVAILABLE tidak menulis apa pun: barangnya tidak
// pernah dianggap keluar dari saldo.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";

export const damagedStockRouter = express.Router();
damagedStockRouter.use(requireAuth);

class DamagedStockError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (err instanceof DamagedStockError) return res.status(err.statusCode).json({ error: err.message });
  if (err.code === "P2002") return res.status(409).json({ error: "Nomor record sudah dipakai" });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Damaged stock error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

const DAMAGE_CATEGORIES = [
  "TORN", "WET", "CONTAMINATED", "DEFORMED", "PACKAGING_DAMAGE",
  "EXPIRED", "PRODUCTION_DEFECT", "DELIVERY_DAMAGE", "OTHER",
];
const RESOLUTIONS = ["RETURN_TO_SUPPLIER", "REWORK", "DISPOSE", "RESTORE_TO_AVAILABLE"];
const STOCK_LEAVING_RESOLUTIONS = ["RETURN_TO_SUPPLIER", "DISPOSE"];

const recordInclude = {
  material: { select: { id: true, code: true, name: true, unit: true } },
  location: { select: { id: true, code: true } },
  reportedBy: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
};

function generateCode(date) {
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `DMG-${dd}${mm}${yy}`;
}

damagedStockRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const { status, damageCategory } = req.query;
    const records = await prisma.damagedStockRecord.findMany({
      where: { ...(status && { status }), ...(damageCategory && { damageCategory }) },
      include: recordInclude,
      orderBy: [{ createdAt: "desc" }],
    });
    res.json({ records });
  } catch (err) {
    handleErr(err, res);
  }
});

damagedStockRouter.get("/:id", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const record = await prisma.damagedStockRecord.findUnique({ where: { id: req.params.id }, include: recordInclude });
    if (!record) return res.status(404).json({ error: "Record tidak ditemukan" });
    res.json(record);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/damaged-stock { materialId, qty, damageCategory, locationId?, notes? }
damagedStockRouter.post("/", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { materialId, qty, damageCategory, locationId, notes } = req.body;
    if (!materialId) throw new DamagedStockError("Item wajib dipilih");
    if (!DAMAGE_CATEGORIES.includes(damageCategory)) throw new DamagedStockError("Damage category tidak valid");
    const qtyNum = Number(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) throw new DamagedStockError("Quantity wajib lebih dari 0");

    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const existing = await prisma.damagedStockRecord.count({ where: { createdAt: { gte: startOfDay } } });
    const recordNumber = `${generateCode(today)}-${String(existing + 1).padStart(2, "0")}`;

    const record = await prisma.damagedStockRecord.create({
      data: {
        recordNumber, materialId, qty: qtyNum, damageCategory,
        locationId: locationId || null, notes: notes || null, reportedById: req.user.id,
      },
      include: recordInclude,
    });
    res.status(201).json(record);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/damaged-stock/:id/inspect — "Request Inspection".
damagedStockRouter.patch("/:id/inspect", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const record = await prisma.damagedStockRecord.findUnique({ where: { id: req.params.id } });
    if (!record) return res.status(404).json({ error: "Record tidak ditemukan" });
    if (record.status !== "REPORTED") throw new DamagedStockError("Hanya record berstatus Reported yang bisa diminta inspeksi");
    const updated = await prisma.damagedStockRecord.update({
      where: { id: record.id },
      data: { status: "UNDER_INSPECTION" },
      include: recordInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/damaged-stock/:id/resolve { resolution, resolutionNote? }
// SATU-SATUNYA jalan record ini menulis ledger — dan hanya untuk dua dari
// empat resolusi (lihat catatan di schema.prisma).
damagedStockRouter.post("/:id/resolve", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const record = await prisma.damagedStockRecord.findUnique({ where: { id: req.params.id }, include: recordInclude });
    if (!record) return res.status(404).json({ error: "Record tidak ditemukan" });
    if (record.status === "RESOLVED") throw new DamagedStockError("Record ini sudah selesai");
    const { resolution, resolutionNote } = req.body;
    if (!RESOLUTIONS.includes(resolution)) throw new DamagedStockError("Resolusi tidak valid");

    const result = await prisma.$transaction(async (tx) => {
      if (STOCK_LEAVING_RESOLUTIONS.includes(resolution)) {
        await tx.stockMovement.create({
          data: {
            materialId: record.materialId, type: "WASTE", qty: -record.qty,
            reason: `${record.damageCategory} — ${resolution === "DISPOSE" ? "dibuang" : "diretur ke supplier"}`,
            note: `Damaged Stock ${record.recordNumber}`, damagedStockRecordId: record.id,
            createdById: req.user.id,
          },
        });
      }
      return tx.damagedStockRecord.update({
        where: { id: record.id },
        data: {
          status: "RESOLVED", resolution, resolutionNote: resolutionNote || null,
          resolvedById: req.user.id, resolvedAt: new Date(),
        },
        include: recordInclude,
      });
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});
