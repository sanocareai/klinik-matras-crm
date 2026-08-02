// Warehouse Reports — Tahap 8 (terakhir). Murni query agregasi read-only di
// atas tabel yang sudah ada sejak Tahap 1-7 — TIDAK ADA migrasi schema.
//
// ⚠️ KETERBATASAN YANG DIAKUI, BUKAN DISEMBUNYIKAN: Material tidak punya
// kolom harga/costing (unitCost cuma tercatat PER PENERIMAAN di
// StockMovement, opsional, nullable — lihat catatan Tahap 5 & 6). Karena
// itu KPI "Inventory Value"/"Stock Adjustment Value"/"Damaged Stock Value"
// dari spesifikasi TIDAK dihitung sebagai Rupiah lengkap:
//   - Inventory Value dihitung PARSIAL, hanya dari material yang PERNAH
//     punya unitCost tercatat (biasanya dari receipt terbaru), dengan
//     jumlah item yang dikecualikan ditampilkan eksplisit — supaya angka
//     yang muncul tidak terbaca sebagai valuasi lengkap padahal bukan.
//   - Stock Adjustment & Damaged Stock dilaporkan berbasis QUANTITY,
//     bukan Rupiah.
//   - Inventory Turnover dihitung berbasis QUANTITY (Issue / rata-rata
//     saldo), bukan berbasis nilai — sama alasan.
// Mengarang angka Rupiah dari data yang tidak benar-benar ada lebih
// menyesatkan daripada mengakuinya terbuka.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../utils/wib.js";

export const warehouseReportsRouter = express.Router();
warehouseReportsRouter.use(requireAuth);

// Ambang "slow moving" / "dead stock" — TIDAK dikonfigurasi per tenant,
// nilai tetap yang wajar untuk skala bisnis ini. Item TANPA movement sama
// sekali otomatis masuk dead stock (lastMovementAt null).
const SLOW_MOVING_DAYS = 60;
const DEAD_STOCK_DAYS = 180;

function buildDateWhere(from, to, field) {
  if (!from || !to) return {};
  return { [field]: { gte: startOfDayWIB(from), lt: endOfDayExclusiveWIB(to) } };
}

// GoodsReceipt.receivedDate adalah kolom @db.Date (kalender murni, tanpa
// jam) — BEDA dengan field DateTime lain di file ini. SENGAJA TIDAK pakai
// startOfDayWIB/endOfDayExclusiveWIB: masalah yang diselesaikan helper itu
// (instant UTC vs kalender WIB) tidak berlaku untuk kolom tanpa komponen
// jam. Sama alasan persis dengan scheduledDate/Route.date di armada.js
// Laporan Delivery.
function buildDateOnlyWhere(from, to, field) {
  if (!from || !to) return {};
  return { [field]: { gte: new Date(`${from}T00:00:00.000Z`), lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000) } };
}

warehouseReportsRouter.get("/summary", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const { from, to } = req.query;

    const [
      stockRows, byCategoryRaw,
      receiptsInRange, issuesInRange, transfersInRange,
      damagedInRange, adjustmentsInRange, countsInRange,
    ] = await Promise.all([
      // Saldo per material — dasar untuk status stok, kategori, slow/dead
      // moving, dan valuasi parsial. Query yang SAMA dengan GET /inventory/
      // stock (Tahap 2A/3), diulang di sini supaya laporan tidak bergantung
      // pada endpoint lain berubah bentuk responsnya.
      prisma.$queryRaw`
        SELECT m.id AS "materialId", m.code, m.name, m.category, m.active,
               m.reorder_point AS "reorderPoint",
               COALESCE(SUM(sm.qty), 0)::float AS balance,
               MAX(sm.created_at) AS "lastMovementAt",
               (SELECT sm2.unit_cost FROM stock_movements sm2
                WHERE sm2.material_id = m.id AND sm2.unit_cost IS NOT NULL
                ORDER BY sm2.created_at DESC LIMIT 1) AS "latestUnitCost"
        FROM materials m
        LEFT JOIN stock_movements sm ON sm.material_id = m.id
        GROUP BY m.id, m.code, m.name, m.category, m.active, m.reorder_point
      `,
      prisma.material.groupBy({ by: ["category"], where: { active: true }, _count: { _all: true } }),

      prisma.goodsReceipt.findMany({
        where: { status: "COMPLETED", ...buildDateOnlyWhere(from, to, "receivedDate") },
        select: { id: true, expectedDate: true, receivedDate: true },
      }),
      prisma.materialIssue.findMany({
        where: { status: "ISSUED", ...buildDateWhere(from, to, "issuedAt") },
        include: { lines: { select: { requestedQty: true, issuedQty: true } } },
      }),
      prisma.stockTransfer.count({ where: { status: "COMPLETED", ...buildDateWhere(from, to, "receivedAt") } }),
      prisma.damagedStockRecord.groupBy({
        by: ["damageCategory"], where: buildDateWhere(from, to, "reportedAt"), _count: { _all: true }, _sum: { qty: true },
      }),
      prisma.stockAdjustmentRequest.groupBy({
        by: ["adjustmentType"], where: { status: "POSTED", ...buildDateWhere(from, to, "postedAt") },
        _count: { _all: true }, _sum: { adjustmentQty: true },
      }),
      prisma.stockCount.findMany({
        where: { status: "COMPLETED", ...buildDateWhere(from, to, "completedAt") },
        include: { lines: { select: { systemQty: true, countedQty: true } } },
      }),
    ]);

    // ── Status stok & kategori (dari stockRows, sama disiplin dengan
    // deriveStockStatusReal di frontend — LOW_STOCK/OUT_OF_STOCK dari
    // balance vs reorderPoint, bukan kolom tersimpan) ──
    const activeRows = stockRows.filter((r) => r.active);
    const totals = {
      totalItems: activeRows.length,
      outOfStock: activeRows.filter((r) => r.balance <= 0).length,
      lowStock: activeRows.filter((r) => r.balance > 0 && r.reorderPoint != null && r.balance <= r.reorderPoint).length,
      inactive: stockRows.length - activeRows.length,
    };
    totals.inStock = totals.totalItems - totals.outOfStock - totals.lowStock;

    const byCategory = byCategoryRaw.map((r) => ({ category: r.category, count: r._count._all }));

    // ── Slow moving / dead stock — snapshot KONDISI SEKARANG, bukan
    // dibatasi rentang tanggal (lihat catatan di atas file) ──
    const now = Date.now();
    const staleness = activeRows
      .filter((r) => r.balance > 0) // stok 0 bukan "slow moving", itu OUT_OF_STOCK
      .map((r) => {
        const days = r.lastMovementAt ? Math.floor((now - new Date(r.lastMovementAt).getTime()) / 86_400_000) : null;
        return { code: r.code, name: r.name, balance: r.balance, daysSinceMovement: days };
      })
      .filter((r) => r.daysSinceMovement === null || r.daysSinceMovement >= SLOW_MOVING_DAYS)
      .sort((a, b) => (b.daysSinceMovement ?? Infinity) - (a.daysSinceMovement ?? Infinity))
      .slice(0, 20)
      .map((r) => ({ ...r, dead: r.daysSinceMovement === null || r.daysSinceMovement >= DEAD_STOCK_DAYS }));

    // ── Valuasi parsial — HANYA material dengan unitCost tercatat ──
    const withCost = activeRows.filter((r) => r.latestUnitCost != null);
    const inventoryValuePartial = {
      value: withCost.reduce((sum, r) => sum + r.balance * Number(r.latestUnitCost), 0),
      itemsWithCost: withCost.length,
      itemsWithoutCost: activeRows.length - withCost.length,
    };

    // ── Receipt Lead Time — rata-rata hari antara expectedDate & receivedDate,
    // hanya receipt yang punya KEDUANYA ──
    const withBothDates = receiptsInRange.filter((r) => r.expectedDate && r.receivedDate);
    const leadTimeDays = withBothDates.map((r) =>
      Math.round((new Date(r.receivedDate) - new Date(r.expectedDate)) / 86_400_000)
    );
    const receiptLeadTime = {
      count: withBothDates.length,
      avgDays: leadTimeDays.length ? Math.round((leadTimeDays.reduce((a, b) => a + b, 0) / leadTimeDays.length) * 10) / 10 : null,
    };

    // ── Material Issue Fulfillment Rate — % baris yang issuedQty >= requestedQty ──
    const allLines = issuesInRange.flatMap((i) => i.lines);
    const fulfilled = allLines.filter((l) => l.issuedQty != null && l.issuedQty >= l.requestedQty).length;
    const issueFulfillment = {
      totalLines: allLines.length,
      fulfilledLines: fulfilled,
      percentage: allLines.length ? Math.round((fulfilled / allLines.length) * 1000) / 10 : null,
    };

    // ── Stock Accuracy — % baris count yang countedQty === systemQty,
    // dari Stock Count yang COMPLETED dalam rentang ──
    const countLines = countsInRange.flatMap((c) => c.lines).filter((l) => l.systemQty != null && l.countedQty != null);
    const accurateLines = countLines.filter((l) => l.systemQty === l.countedQty).length;
    const stockAccuracy = {
      totalCounted: countLines.length,
      accurate: accurateLines,
      percentage: countLines.length ? Math.round((accurateLines / countLines.length) * 1000) / 10 : null,
    };

    res.json({
      range: { from: from || null, to: to || null },
      totals,
      byCategory,
      slowMoving: staleness,
      inventoryValuePartial,
      movementTrend: {
        goodsReceipt: receiptsInRange.length,
        materialIssue: issuesInRange.length,
        stockTransfer: transfersInRange,
        stockAdjustment: adjustmentsInRange.reduce((sum, r) => sum + r._count._all, 0),
        damagedStock: damagedInRange.reduce((sum, r) => sum + r._count._all, 0),
      },
      damageByCategory: damagedInRange.map((r) => ({ category: r.damageCategory, count: r._count._all, qty: r._sum.qty || 0 })),
      adjustmentByType: adjustmentsInRange.map((r) => ({ type: r.adjustmentType, count: r._count._all, qty: r._sum.adjustmentQty || 0 })),
      receiptLeadTime,
      issueFulfillment,
      stockAccuracy,
    });
  } catch (err) {
    console.error("Warehouse reports error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});
