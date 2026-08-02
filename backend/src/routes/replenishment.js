// Replenishment — Warehouse Tahap 7.
//
// Saran DIHITUNG on-the-fly (available ≤ reorderPoint), TIDAK PERNAH
// disimpan. Baru jadi baris nyata (ReplenishmentRequest) begitu "Create
// Request" diklik. TIDAK PERNAH menulis stock_movements sendiri — selesai
// artinya menaut ke GoodsReceipt yang sudah ada. Lihat catatan panjang di
// schema.prisma di atas model ReplenishmentRequest.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";

export const replenishmentRouter = express.Router();
replenishmentRouter.use(requireAuth);

class ReplenishmentError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (err instanceof ReplenishmentError) return res.status(err.statusCode).json({ error: err.message });
  if (err.code === "P2002") return res.status(409).json({ error: "Nomor request sudah dipakai" });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Replenishment error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

const SOURCES = ["MINIMUM_STOCK_RULE", "REORDER_POINT", "PRODUCTION_FORECAST", "SALES_DEMAND", "MANUAL_REQUEST", "LOCATION_REFILL"];
const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];
// DRAFT → WAITING_APPROVAL → APPROVED → ORDERED lewat PATCH biasa.
// COMPLETED HANYA lewat /link-receipt (menandai barang benar-benar tiba).
const FORWARD_FLOW = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "ORDERED"];

const requestInclude = {
  material: { select: { id: true, code: true, name: true, unit: true, reorderPoint: true, reorderQty: true } },
  requestedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  goodsReceipt: { select: { id: true, receiptNumber: true, status: true } },
};

function generateCode(date) {
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `RP-${dd}${mm}${yy}`;
}

// GET /api/inventory/replenishment/suggestions
// Material aktif dengan reorderPoint terisi DAN available ≤ reorderPoint,
// DIKURANGI material yang sudah punya request aktif (belum
// COMPLETED/REJECTED) — supaya tidak menyarankan hal yang sudah diajukan.
replenishmentRouter.get("/suggestions", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT m.id AS "materialId", m.code, m.name, m.unit,
             m.reorder_point AS "reorderPoint", m.reorder_qty AS "reorderQty",
             (COALESCE(SUM(sm.qty), 0) - COALESCE(res.reserved, 0))::float AS available
      FROM materials m
      LEFT JOIN stock_movements sm ON sm.material_id = m.id
      LEFT JOIN (
        SELECT mil.material_id, SUM(mil.requested_qty) AS reserved
        FROM material_issue_lines mil
        JOIN material_issues mi ON mi.id = mil.material_issue_id
        WHERE mi.status = ANY(ARRAY['APPROVED','READY_TO_PICK','PICKED']::"IssueStatus"[])
        GROUP BY mil.material_id
      ) res ON res.material_id = m.id
      WHERE m.active = true AND m.reorder_point IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM replenishment_requests rr
          WHERE rr.material_id = m.id AND rr.status NOT IN ('COMPLETED', 'REJECTED')
        )
      GROUP BY m.id, m.code, m.name, m.unit, m.reorder_point, m.reorder_qty, res.reserved
      HAVING (COALESCE(SUM(sm.qty), 0) - COALESCE(res.reserved, 0)) <= m.reorder_point
      ORDER BY m.code ASC
    `;
    res.json({ suggestions: rows });
  } catch (err) {
    handleErr(err, res);
  }
});

replenishmentRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const { status, source } = req.query;
    const requests = await prisma.replenishmentRequest.findMany({
      where: { ...(status && { status }), ...(source && { source }) },
      include: requestInclude,
      orderBy: [{ createdAt: "desc" }],
    });
    res.json({ requests });
  } catch (err) {
    handleErr(err, res);
  }
});

replenishmentRouter.get("/:id", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const request = await prisma.replenishmentRequest.findUnique({ where: { id: req.params.id }, include: requestInclude });
    if (!request) return res.status(404).json({ error: "Replenishment request tidak ditemukan" });
    res.json(request);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/replenishment
// { source, materialId, suggestedQty?, requiredDate?, priority?, supplier?, notes? }
// suggestedQty default ke Material.reorderQty kalau tidak dikirim.
// currentStockSnapshot/minimumStockSnapshot diambil dari kondisi BERJALAN.
replenishmentRouter.post("/", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { source, materialId, requiredDate, priority, supplier, notes } = req.body;
    if (!SOURCES.includes(source)) throw new ReplenishmentError("Source tidak valid");
    if (!materialId) throw new ReplenishmentError("Item wajib dipilih");
    if (priority && !PRIORITIES.includes(priority)) throw new ReplenishmentError("Priority tidak valid");

    const material = await prisma.material.findUnique({ where: { id: materialId } });
    if (!material) return res.status(404).json({ error: "Item tidak ditemukan" });

    const [{ balance }] = await prisma.$queryRaw`
      SELECT COALESCE(SUM(qty), 0)::float AS balance FROM stock_movements WHERE material_id = ${materialId}::uuid
    `;

    const suggestedQty = req.body.suggestedQty != null && req.body.suggestedQty !== ""
      ? Number(req.body.suggestedQty)
      : material.reorderQty;
    if (!Number.isFinite(suggestedQty) || suggestedQty <= 0) {
      throw new ReplenishmentError("Suggested quantity wajib diisi — item ini belum punya reorder quantity default");
    }

    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const existing = await prisma.replenishmentRequest.count({ where: { createdAt: { gte: startOfDay } } });
    const requestNumber = `${generateCode(today)}-${String(existing + 1).padStart(2, "0")}`;

    const request = await prisma.replenishmentRequest.create({
      data: {
        requestNumber, source, materialId,
        currentStockSnapshot: balance, minimumStockSnapshot: material.reorderPoint,
        suggestedQty, requiredDate: requiredDate ? new Date(`${requiredDate}T00:00:00.000Z`) : null,
        priority: priority || "NORMAL", supplier: supplier || null, notes: notes || null,
        requestedById: req.user.id,
      },
      include: requestInclude,
    });
    res.status(201).json(request);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/replenishment/:id
// Header (termasuk edit quantity/supplier — "Review quantity"/"Assign
// Supplier" dari spesifikasi) + transisi DRAFT..ORDERED satu langkah.
replenishmentRouter.patch("/:id", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const existing = await prisma.replenishmentRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Replenishment request tidak ditemukan" });
    if (existing.status === "COMPLETED" || existing.status === "REJECTED") {
      throw new ReplenishmentError(`Request berstatus ${existing.status} tidak bisa diubah lagi`);
    }

    const { suggestedQty, requiredDate, priority, supplier, notes, status } = req.body;
    const data = {};
    if (suggestedQty !== undefined) {
      const q = Number(suggestedQty);
      if (!Number.isFinite(q) || q <= 0) throw new ReplenishmentError("Suggested quantity wajib lebih dari 0");
      data.suggestedQty = q;
    }
    if (requiredDate !== undefined) data.requiredDate = requiredDate ? new Date(`${requiredDate}T00:00:00.000Z`) : null;
    if (priority !== undefined) {
      if (!PRIORITIES.includes(priority)) throw new ReplenishmentError("Priority tidak valid");
      data.priority = priority;
    }
    if (supplier !== undefined) data.supplier = supplier || null;
    if (notes !== undefined) data.notes = notes || null;

    if (status) {
      const currentIdx = FORWARD_FLOW.indexOf(existing.status);
      const nextIdx = FORWARD_FLOW.indexOf(status);
      if (nextIdx === -1 || nextIdx !== currentIdx + 1) {
        throw new ReplenishmentError(`Tidak bisa langsung ke status ${status} dari ${existing.status} — harus berurutan`);
      }
      data.status = status;
      if (status === "APPROVED") {
        data.approvedById = req.user.id;
        data.approvedAt = new Date();
      }
      if (status === "ORDERED") data.orderedAt = new Date();
    }

    const request = await prisma.replenishmentRequest.update({ where: { id: req.params.id }, data, include: requestInclude });
    res.json(request);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/replenishment/:id/link-receipt { goodsReceiptId }
// "Link to Goods Receipt" — menandai barang benar-benar tiba. Wajib
// ORDERED. TIDAK menulis stock_movements sendiri (GoodsReceipt yang sudah
// menulisnya lewat putaway-nya sendiri).
replenishmentRouter.post("/:id/link-receipt", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const request = await prisma.replenishmentRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ error: "Replenishment request tidak ditemukan" });
    if (request.status !== "ORDERED") throw new ReplenishmentError("Hanya request berstatus Ordered yang bisa ditautkan ke Goods Receipt");
    const { goodsReceiptId } = req.body;
    if (!goodsReceiptId) throw new ReplenishmentError("Goods Receipt wajib dipilih");
    const receipt = await prisma.goodsReceipt.findUnique({ where: { id: goodsReceiptId } });
    if (!receipt) return res.status(404).json({ error: "Goods Receipt tidak ditemukan" });

    const updated = await prisma.replenishmentRequest.update({
      where: { id: request.id },
      data: { status: "COMPLETED", goodsReceiptId },
      include: requestInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/replenishment/:id/reject { reason }
replenishmentRouter.patch("/:id/reject", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const request = await prisma.replenishmentRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ error: "Replenishment request tidak ditemukan" });
    if (request.status === "COMPLETED" || request.status === "REJECTED") {
      throw new ReplenishmentError(`Request berstatus ${request.status} tidak bisa ditolak`);
    }
    const { reason } = req.body;
    if (!reason?.trim()) throw new ReplenishmentError("Alasan penolakan wajib diisi");
    const updated = await prisma.replenishmentRequest.update({
      where: { id: request.id },
      data: { status: "REJECTED", rejectedReason: reason.trim() },
      include: requestInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});
