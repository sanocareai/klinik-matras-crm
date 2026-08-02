// Gudang — Inventory v1 (Phase 3, PRD §8). Scope disepakati dengan Gilang
// 1 Agustus 2026: katalog material + ledger stock_movements + goods receipt
// + issue manual ke unit + stock opname. Lihat catatan lengkap di
// schema.prisma dan DECISIONS.md untuk apa yang SENGAJA ditunda.
//
// Stok TIDAK PERNAH disimpan sebagai angka — selalu dihitung ulang dari
// SUM(qty) ledger. Kalau kelak ada bug perhitungan stok, baris ledger-nya
// bisa ditelusuri satu per satu; angka mutable cuma bisa bilang "salah",
// tidak bisa bilang "salah di mana" (PRD §8.1).

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";

export const inventoryRouter = express.Router();
inventoryRouter.use(requireAuth);

class InventoryError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (err instanceof InventoryError) return res.status(err.statusCode).json({ error: err.message });
  if (err.code === "P2002") return res.status(409).json({ error: "Kode material sudah dipakai" });
  if (err.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("Inventory error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

const VALID_UNITS = ["PCS", "METER", "M3", "SHEET", "SPOOL", "KG"];
const VALID_CATEGORIES = ["RAW_MATERIAL", "WIP", "FINISHED_GOODS", "CONSUMABLE"];

function parseQty(input, { allowNegative = false } = {}) {
  const qty = Number(input);
  if (!Number.isFinite(qty) || qty === 0) throw new InventoryError("Jumlah wajib diisi dan tidak boleh nol");
  if (!allowNegative && qty < 0) throw new InventoryError("Jumlah harus lebih dari 0");
  return qty;
}

// ── Katalog material ────────────────────────────────────────────────────

// GET /api/inventory/materials?active=true
inventoryRouter.get("/materials", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const where = {};
    if (req.query.active === "true") where.active = true;
    // Tahap 2: filter kategori. `category=none` menyaring item yang BELUM
    // dikategorikan — sengaja bisa dicari, supaya katalog yang belum rapi
    // bisa dibereskan alih-alih tersembunyi.
    if (req.query.category === "none") where.category = null;
    else if (req.query.category) where.category = req.query.category;
    const materials = await prisma.material.findMany({ where, orderBy: { code: "asc" } });
    res.json(materials);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/materials { code, name, unit, serviceLine?, reorderPoint?, reorderQty? }
inventoryRouter.post("/materials", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { code, name, unit, serviceLine, category, reorderPoint, reorderQty } = req.body;
    if (!code?.trim() || !name?.trim()) throw new InventoryError("Kode dan nama material wajib diisi");
    if (!VALID_UNITS.includes(unit)) throw new InventoryError("Satuan tidak valid");
    if (serviceLine && !["SERVICE", "UPGRADE"].includes(serviceLine)) {
      throw new InventoryError("Lini layanan tidak valid");
    }
    if (category && !VALID_CATEGORIES.includes(category)) {
      throw new InventoryError("Kategori tidak valid");
    }
    const material = await prisma.material.create({
      data: {
        code: code.trim().toUpperCase(), name: name.trim(), unit, serviceLine: serviceLine || null,
        category: category || null,
        reorderPoint: reorderPoint != null && reorderPoint !== "" ? Number(reorderPoint) : null,
        reorderQty: reorderQty != null && reorderQty !== "" ? Number(reorderQty) : null,
      },
    });
    res.status(201).json(material);
  } catch (err) {
    handleErr(err, res);
  }
});

// PATCH /api/inventory/materials/:id { name?, active?, reorderPoint?, reorderQty? }
// TIDAK bisa ubah code/unit setelah dibuat (ledger sudah mengacu ke satuan
// itu; ganti satuan diam-diam akan membuat riwayat qty tidak bisa
// dibandingkan). reorderPoint/reorderQty kirim `null` eksplisit untuk
// MEMATIKAN alert material itu (beda dari `undefined` yang berarti "tidak
// diubah") — lihat catatan di schema.prisma.
inventoryRouter.patch("/materials/:id", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { name, active, category, reorderPoint, reorderQty } = req.body;
    if (category !== undefined && category !== null && category !== "" && !VALID_CATEGORIES.includes(category)) {
      throw new InventoryError("Kategori tidak valid");
    }
    const material = await prisma.material.update({
      where: { id: req.params.id },
      data: {
        ...(name?.trim() && { name: name.trim() }),
        ...(typeof active === "boolean" && { active }),
        // Sama polanya dengan reorderPoint: kirim null/"" eksplisit untuk
        // MENGOSONGKAN kategori, `undefined` berarti "tidak diubah".
        ...(category !== undefined && { category: category === "" || category === null ? null : category }),
        ...(reorderPoint !== undefined && { reorderPoint: reorderPoint === "" || reorderPoint === null ? null : Number(reorderPoint) }),
        ...(reorderQty !== undefined && { reorderQty: reorderQty === "" || reorderQty === null ? null : Number(reorderQty) }),
      },
    });
    res.json(material);
  } catch (err) {
    handleErr(err, res);
  }
});

// ── Saldo stok (dihitung, bukan disimpan) ───────────────────────────────

// GET /api/inventory/stock — saldo per material, dari agregat ledger.
inventoryRouter.get("/stock", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    // `category` & `lastMovementAt` ikut di-select (Tahap 2) supaya halaman
    // Stock & Material tidak perlu memanggil /materials terpisah lalu
    // menggabungkan dua daftar di frontend.
    const balances = await prisma.$queryRaw`
      SELECT m.id AS "materialId", m.code, m.name, m.unit, m.active, m.category,
             m.service_line AS "serviceLine",
             m.reorder_point AS "reorderPoint", m.reorder_qty AS "reorderQty",
             COALESCE(SUM(sm.qty), 0)::float AS balance,
             MAX(sm.created_at) AS "lastMovementAt"
      FROM materials m
      LEFT JOIN stock_movements sm ON sm.material_id = m.id
      GROUP BY m.id, m.code, m.name, m.unit, m.active, m.category,
               m.service_line, m.reorder_point, m.reorder_qty
      ORDER BY m.code ASC
    `;
    res.json(balances);
  } catch (err) {
    handleErr(err, res);
  }
});

// ── Pergerakan stok (ledger) ────────────────────────────────────────────

// GET /api/inventory/movements?materialId=&type=&limit=50
inventoryRouter.get("/movements", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const { materialId, type } = req.query;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const where = {};
    if (materialId) where.materialId = materialId;
    if (type) where.type = type;
    const movements = await prisma.stockMovement.findMany({
      where,
      include: {
        material: { select: { code: true, name: true, unit: true } },
        unit: { select: { unitCode: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    res.json(movements);
  } catch (err) {
    handleErr(err, res);
  }
});

async function assertMaterialActive(materialId) {
  const material = await prisma.material.findUnique({ where: { id: materialId } });
  if (!material) throw new InventoryError("Material tidak ditemukan", 404);
  if (!material.active) throw new InventoryError("Material ini sudah nonaktif");
  return material;
}

// POST /api/inventory/movements/receipt { materialId, qty, location?, unitCost?, supplier?, batchNumber?, note? }
// FR-I-01: goods receipt — qty, unit cost, supplier, batch.
inventoryRouter.post("/movements/receipt", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { materialId, location, unitCost, supplier, batchNumber, note } = req.body;
    await assertMaterialActive(materialId);
    const qty = parseQty(req.body.qty);
    const movement = await prisma.stockMovement.create({
      data: {
        materialId, type: "RECEIPT", qty, location: location || undefined,
        unitCost: unitCost != null ? Number(unitCost) : null,
        supplier: supplier || null, batchNumber: batchNumber || null, note: note || null,
        createdById: req.user.id,
      },
      include: { material: { select: { code: true, name: true, unit: true } } },
    });
    res.status(201).json(movement);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/movements/issue { materialId, qty, unitId, location?, note? }
// FR-P-08: material issue ke unit — mengurangi stok, tercatat qty aktual.
inventoryRouter.post("/movements/issue", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { materialId, unitId, location, note } = req.body;
    if (!unitId) throw new InventoryError("Unit tujuan wajib diisi untuk issue material");
    await assertMaterialActive(materialId);
    const unit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true } });
    if (!unit) throw new InventoryError("Unit tidak ditemukan", 404);
    const qty = parseQty(req.body.qty);
    const movement = await prisma.stockMovement.create({
      data: {
        materialId, type: "ISSUE", qty: -qty, unitId, location: location || undefined, note: note || null,
        createdById: req.user.id,
      },
      include: { material: { select: { code: true, name: true, unit: true } }, unit: { select: { unitCode: true } } },
    });
    res.status(201).json(movement);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/movements/return { materialId, qty, location?, unitId?, note? }
// Sisa material kembali ke gudang (mis. issue kelebihan, unit dibatalkan).
inventoryRouter.post("/movements/return", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { materialId, unitId, location, note } = req.body;
    await assertMaterialActive(materialId);
    const qty = parseQty(req.body.qty);
    const movement = await prisma.stockMovement.create({
      data: {
        materialId, type: "RETURN", qty, unitId: unitId || null, location: location || undefined,
        note: note || null, createdById: req.user.id,
      },
      include: { material: { select: { code: true, name: true, unit: true } } },
    });
    res.status(201).json(movement);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/movements/waste { materialId, qty, reason, location?, note? }
// WAJIB alasan — terbuang/rusak bukan angka tanpa penjelasan.
inventoryRouter.post("/movements/waste", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { materialId, reason, location, note } = req.body;
    if (!reason?.trim()) throw new InventoryError("Alasan wajib diisi untuk material terbuang");
    await assertMaterialActive(materialId);
    const qty = parseQty(req.body.qty);
    const movement = await prisma.stockMovement.create({
      data: {
        materialId, type: "WASTE", qty: -qty, reason: reason.trim(), location: location || undefined,
        note: note || null, createdById: req.user.id,
      },
      include: { material: { select: { code: true, name: true, unit: true } } },
    });
    res.status(201).json(movement);
  } catch (err) {
    handleErr(err, res);
  }
});

// POST /api/inventory/movements/adjustment { materialId, actualQty, location?, reason, note? }
// FR-I-06 (stock opname): admin/gudang input HASIL HITUNG FISIK, sistem
// menghitung selisih dari saldo sekarang dan mencatatnya sebagai satu baris
// ADJUSTMENT (±) — bukan qty mentah, supaya tidak salah tanda saat variance
// negatif (fisik lebih sedikit dari sistem, kasus paling umum).
inventoryRouter.post("/movements/adjustment", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const { materialId, location, reason, note } = req.body;
    if (!reason?.trim()) throw new InventoryError("Alasan wajib diisi untuk penyesuaian stok opname");
    await assertMaterialActive(materialId);
    const actualQty = Number(req.body.actualQty);
    if (!Number.isFinite(actualQty) || actualQty < 0) {
      throw new InventoryError("Hasil hitung fisik wajib angka 0 atau lebih");
    }
    const loc = location || "GUDANG_UTAMA";
    const [{ balance }] = await prisma.$queryRaw`
      SELECT COALESCE(SUM(qty), 0)::float AS balance FROM stock_movements
      WHERE material_id = ${materialId}::uuid AND location = ${loc}
    `;
    const variance = actualQty - balance;
    if (variance === 0) throw new InventoryError("Tidak ada selisih — hasil hitung sama dengan catatan sistem");
    const movement = await prisma.stockMovement.create({
      data: {
        materialId, type: "ADJUSTMENT", qty: variance, location: loc,
        reason: reason.trim(), note: note || null, createdById: req.user.id,
      },
      include: { material: { select: { code: true, name: true, unit: true } } },
    });
    res.status(201).json({ ...movement, previousBalance: balance, actualQty });
  } catch (err) {
    handleErr(err, res);
  }
});
