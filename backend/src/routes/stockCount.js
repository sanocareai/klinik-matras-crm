// Stock Count / Stock Opname — Warehouse Tahap 5.
//
// v1 POST /inventory/movements/adjustment (satu langkah) TIDAK diubah. Ini
// dokumen di depannya untuk sesi hitung terjadwal, banyak item sekaligus,
// dengan blind count opsional. Lihat catatan panjang di schema.prisma di
// atas model StockCount.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";

export const stockCountRouter = express.Router();
stockCountRouter.use(requireAuth);

class CountError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (err instanceof CountError) return res.status(err.statusCode).json({ error: err.message });
  if (err.code === "P2002") return res.status(409).json({ error: "Nomor count sudah dipakai" });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Stock count error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

const COUNT_TYPES = ["CYCLE_COUNT", "FULL_STOCK_OPNAME"];
const COUNT_METHODS = ["BY_ITEM", "BY_CATEGORY", "BY_LOCATION", "BY_BATCH", "RANDOM_SAMPLING", "FULL_WAREHOUSE"];

const countInclude = {
  lines: { include: { material: { select: { id: true, code: true, name: true, unit: true } } } },
  assignedTo: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
};

function generateCountCode(date) {
  const d = new Date(date);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `CC-${dd}${mm}${yy}`;
}

stockCountRouter.get("/", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const { status, countType } = req.query;
    const counts = await prisma.stockCount.findMany({
      where: { ...(status && { status }), ...(countType && { countType }) },
      include: countInclude,
      orderBy: [{ createdAt: "desc" }],
    });
    res.json({ counts });
  } catch (err) {
    handleErr(err, res);
  }
});

stockCountRouter.get("/:id", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const count = await prisma.stockCount.findUnique({ where: { id: req.params.id }, include: countInclude });
    if (!count) return res.status(404).json({ error: "Stock count tidak ditemukan" });
    res.json(count);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/stock-counts
// { countType, countMethod, scheduledDate?, blindCount?, notes?, assignedToId?, lines: [{materialId}] }
stockCountRouter.post("/", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { countType, countMethod, scheduledDate, blindCount, notes, assignedToId, lines } = req.body;
    if (!COUNT_TYPES.includes(countType)) throw new CountError("Count type tidak valid");
    if (!COUNT_METHODS.includes(countMethod)) throw new CountError("Count method tidak valid");
    if (!Array.isArray(lines) || lines.length === 0) throw new CountError("Minimal satu item wajib diisi");
    for (const l of lines) {
      if (!l.materialId) throw new CountError("Setiap baris wajib memilih item");
    }

    const today = new Date();
    const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const existing = await prisma.stockCount.count({ where: { createdAt: { gte: startOfDay } } });
    const countNumber = `${generateCountCode(today)}-${String(existing + 1).padStart(2, "0")}`;

    const count = await prisma.stockCount.create({
      data: {
        countNumber, countType, countMethod,
        scheduledDate: scheduledDate ? new Date(`${scheduledDate}T00:00:00.000Z`) : null,
        blindCount: blindCount !== undefined ? !!blindCount : true,
        notes: notes || null,
        assignedToId: assignedToId || null,
        createdById: req.user.id,
        lines: { create: lines.map((l) => ({ materialId: l.materialId })) },
      },
      include: countInclude,
    });
    res.status(201).json(count);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/stock-counts/:id — header saja, TIDAK termasuk status
// (status berjalan lewat /start, /submit, /recount, /complete — masing-masing
// punya efek samping menulis ledger atau snapshot yang tidak cocok dengan
// PATCH generik satu-status-maju seperti dokumen lain).
stockCountRouter.patch("/:id", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const existing = await prisma.stockCount.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Stock count tidak ditemukan" });
    if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
      throw new CountError(`Count berstatus ${existing.status} tidak bisa diubah lagi`);
    }
    const { scheduledDate, blindCount, notes, assignedToId } = req.body;
    const data = {};
    if (scheduledDate !== undefined) data.scheduledDate = scheduledDate ? new Date(`${scheduledDate}T00:00:00.000Z`) : null;
    if (blindCount !== undefined) data.blindCount = !!blindCount;
    if (notes !== undefined) data.notes = notes || null;
    if (assignedToId !== undefined) data.assignedToId = assignedToId || null;

    const count = await prisma.stockCount.update({ where: { id: req.params.id }, data, include: countInclude });
    res.json(count);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/stock-counts/:id/start
// SCHEDULED → IN_PROGRESS. Snapshot systemQty SEKALI dari saldo ledger
// BERJALAN — baseline blind count, tidak dihitung ulang setelah ini.
stockCountRouter.post("/:id/start", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const count = await prisma.stockCount.findUnique({ where: { id: req.params.id }, include: countInclude });
    if (!count) return res.status(404).json({ error: "Stock count tidak ditemukan" });
    if (count.status !== "SCHEDULED") throw new CountError("Hanya count berstatus Scheduled yang bisa dimulai");

    const result = await prisma.$transaction(async (tx) => {
      for (const line of count.lines) {
        const [{ balance }] = await tx.$queryRaw`
          SELECT COALESCE(SUM(qty), 0)::float AS balance FROM stock_movements WHERE material_id = ${line.materialId}::uuid
        `;
        await tx.stockCountLine.update({ where: { id: line.id }, data: { systemQty: balance } });
      }
      return tx.stockCount.update({
        where: { id: count.id },
        data: { status: "IN_PROGRESS", startedAt: new Date() },
        include: countInclude,
      });
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/stock-counts/:id/lines/:lineId
// Isi hasil hitung fisik (countedQty) selama IN_PROGRESS, atau alasan
// selisih (reason) selama IN_PROGRESS/WAITING_REVIEW.
stockCountRouter.patch("/:id/lines/:lineId", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const count = await prisma.stockCount.findUnique({ where: { id: req.params.id } });
    if (!count) return res.status(404).json({ error: "Stock count tidak ditemukan" });
    if (!["IN_PROGRESS", "WAITING_REVIEW"].includes(count.status)) {
      throw new CountError(`Count berstatus ${count.status} tidak bisa diisi hasil hitungnya`);
    }
    const line = await prisma.stockCountLine.findFirst({ where: { id: req.params.lineId, stockCountId: count.id } });
    if (!line) return res.status(404).json({ error: "Baris item tidak ditemukan" });

    const { countedQty, reason, notes } = req.body;
    const toNum = (v) => (v === undefined ? undefined : v === "" || v === null ? null : Number(v));
    const updated = await prisma.stockCountLine.update({
      where: { id: line.id },
      data: {
        ...(countedQty !== undefined && { countedQty: toNum(countedQty) }),
        ...(reason !== undefined && { reason: reason || null }),
        ...(notes !== undefined && { notes: notes || null }),
      },
      include: { material: { select: { id: true, code: true, name: true, unit: true } } },
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/stock-counts/:id/submit
// IN_PROGRESS → WAITING_REVIEW. Wajib SEMUA baris sudah punya countedQty —
// count yang setengah jadi tidak bisa masuk review.
stockCountRouter.post("/:id/submit", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const count = await prisma.stockCount.findUnique({ where: { id: req.params.id }, include: countInclude });
    if (!count) return res.status(404).json({ error: "Stock count tidak ditemukan" });
    if (count.status !== "IN_PROGRESS") throw new CountError("Hanya count berstatus In Progress yang bisa disubmit");
    const belumDihitung = count.lines.filter((l) => l.countedQty == null);
    if (belumDihitung.length > 0) {
      throw new CountError(`${belumDihitung.length} item belum diisi hasil hitungnya`);
    }
    const updated = await prisma.stockCount.update({
      where: { id: count.id },
      data: { status: "WAITING_REVIEW", submittedAt: new Date() },
      include: countInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/stock-counts/:id/recount
// WAITING_REVIEW → IN_PROGRESS. systemQty TIDAK di-snapshot ulang — baseline
// tetap dari Start Count pertama.
stockCountRouter.post("/:id/recount", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const count = await prisma.stockCount.findUnique({ where: { id: req.params.id } });
    if (!count) return res.status(404).json({ error: "Stock count tidak ditemukan" });
    if (count.status !== "WAITING_REVIEW") throw new CountError("Hanya count berstatus Waiting Review yang bisa dihitung ulang");
    const updated = await prisma.stockCount.update({
      where: { id: count.id },
      data: { status: "IN_PROGRESS" },
      include: countInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/stock-counts/:id/complete
// SATU-SATUNYA jalan sebuah Stock Count menjadi baris ledger nyata. Wajib
// WAITING_REVIEW. Untuk tiap baris dengan countedQty ≠ systemQty, WAJIB
// reason terisi, lalu tulis SATU StockMovement ADJUSTMENT (qty = selisih).
// Baris tanpa selisih dilewati — tidak ada yang perlu disesuaikan.
stockCountRouter.post("/:id/complete", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const count = await prisma.stockCount.findUnique({ where: { id: req.params.id }, include: countInclude });
    if (!count) return res.status(404).json({ error: "Stock count tidak ditemukan" });
    if (count.status !== "WAITING_REVIEW") throw new CountError("Hanya count berstatus Waiting Review yang bisa diselesaikan");

    const berselisih = count.lines.filter((l) => Number(l.countedQty) !== Number(l.systemQty));
    for (const l of berselisih) {
      if (!l.reason?.trim()) throw new CountError(`Alasan wajib diisi untuk selisih pada ${l.material.code}`);
    }

    const result = await prisma.$transaction(async (tx) => {
      for (const line of berselisih) {
        const variance = Number(line.countedQty) - Number(line.systemQty);
        await tx.stockMovement.create({
          data: {
            materialId: line.materialId, type: "ADJUSTMENT", qty: variance,
            reason: line.reason.trim(), note: `Stock Count ${count.countNumber}`,
            stockCountId: count.id, createdById: req.user.id,
          },
        });
      }
      return tx.stockCount.update({
        where: { id: count.id },
        data: { status: "COMPLETED", reviewedById: req.user.id, completedAt: new Date() },
        include: countInclude,
      });
    });
    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/stock-counts/:id/cancel { reason }
stockCountRouter.patch("/:id/cancel", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const count = await prisma.stockCount.findUnique({ where: { id: req.params.id } });
    if (!count) return res.status(404).json({ error: "Stock count tidak ditemukan" });
    if (count.status === "COMPLETED" || count.status === "CANCELLED") {
      throw new CountError(`Count berstatus ${count.status} tidak bisa dibatalkan`);
    }
    const { reason } = req.body;
    if (!reason?.trim()) throw new CountError("Alasan pembatalan wajib diisi");
    const updated = await prisma.stockCount.update({
      where: { id: count.id },
      data: { status: "CANCELLED", notes: [count.notes, `Dibatalkan: ${reason.trim()}`].filter(Boolean).join(" — ") },
      include: countInclude,
    });
    res.json(updated);
  } catch (err) {
    handleErr(err, res);
  }
});
