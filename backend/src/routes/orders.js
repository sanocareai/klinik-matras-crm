import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const orderRouter = express.Router();
orderRouter.use(requireAuth);

// Helper: hitung ulang Order.value = SUM semua items, update ke DB
async function syncOrderValue(orderId) {
  const agg = await prisma.orderItem.aggregate({
    where: { orderId },
    _sum: { harga: true },
  });
  const total = agg._sum.harga || 0;
  await prisma.order.update({ where: { id: orderId }, data: { value: total } });
  return total;
}

// PATCH /api/orders/:id — edit order (status, notes, qty)
// value TIDAK bisa diubah langsung dari sini — dikontrol oleh items
orderRouter.patch("/:id", async (req, res) => {
  const { status, quantity, notes } = req.body;
  try {
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        ...(status   !== undefined && { status }),
        ...(quantity !== undefined && { quantity: Number(quantity) }),
        ...(notes    !== undefined && { notes }),
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders/:orderId/items — tambah item layanan
orderRouter.post("/:orderId/items", async (req, res) => {
  const { layananName, harga, sortOrder } = req.body;
  if (!layananName?.trim()) return res.status(400).json({ error: "Nama layanan wajib diisi" });
  if (harga === undefined || harga === null) return res.status(400).json({ error: "Harga wajib diisi" });

  try {
    const item = await prisma.orderItem.create({
      data: {
        orderId: req.params.orderId,
        layananName: layananName.trim(),
        harga: Number(harga),
        sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
      },
    });
    const newTotal = await syncOrderValue(req.params.orderId);
    res.status(201).json({ item, orderValue: newTotal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/orders/items/:itemId — edit item layanan
orderRouter.patch("/items/:itemId", async (req, res) => {
  const { layananName, harga, sortOrder } = req.body;
  try {
    const item = await prisma.orderItem.update({
      where: { id: req.params.itemId },
      data: {
        ...(layananName !== undefined && { layananName: layananName.trim() }),
        ...(harga       !== undefined && { harga: Number(harga) }),
        ...(sortOrder   !== undefined && { sortOrder: Number(sortOrder) }),
      },
    });
    const newTotal = await syncOrderValue(item.orderId);
    res.json({ item, orderValue: newTotal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/orders/items/:itemId — hapus item layanan
orderRouter.delete("/items/:itemId", async (req, res) => {
  try {
    const item = await prisma.orderItem.delete({ where: { id: req.params.itemId } });
    const newTotal = await syncOrderValue(item.orderId);
    res.json({ ok: true, orderValue: newTotal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
