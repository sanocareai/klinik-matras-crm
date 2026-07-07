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

// PATCH /api/orders/:id — edit order (status, paymentStatus, notes, qty, orderNumber)
// value TIDAK bisa diubah langsung dari sini — dikontrol oleh items
orderRouter.patch("/:id", async (req, res) => {
  const { status, paymentStatus, quantity, notes, orderNumber,
          merkKasur, ukuranKasur, keluhanCustomer, jenisLayanan, hargaTotal } = req.body;
  try {
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        ...(status            !== undefined && { status }),
        ...(paymentStatus     !== undefined && { paymentStatus }),
        ...(quantity          !== undefined && { quantity: Number(quantity) }),
        ...(notes             !== undefined && { notes }),
        ...(orderNumber       !== undefined && { orderNumber: orderNumber?.trim() || null }),
        ...(merkKasur         !== undefined && { merkKasur }),
        ...(ukuranKasur       !== undefined && { ukuranKasur }),
        ...(keluhanCustomer   !== undefined && { keluhanCustomer }),
        ...(jenisLayanan      !== undefined && { jenisLayanan }),
        ...(hargaTotal        !== undefined && { value: hargaTotal ? Number(hargaTotal) : 0 }),
      },
      include: {
        items:         { orderBy: { sortOrder: "asc" } },
        weightEntries: { orderBy: { sortOrder: "asc" } },
      },
    });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/orders/:id — hapus order beserta items & weightEntries (cascade via FK)
orderRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.order.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/orders/:id/complaint — tandai order sebagai komplain
// Hanya bisa kalau status order sudah DELIVERED
orderRouter.patch("/:id/complaint", async (req, res) => {
  const { complaintDetail } = req.body;
  try {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (order.status !== "DELIVERED") {
      return res.status(400).json({ error: "Komplain hanya bisa dicatat setelah order berstatus DELIVERED (sudah terkirim/selesai)" });
    }

    const updated = await prisma.order.update({
      where: { id: req.params.id },
      data: {
        hasComplaint:    true,
        complaintDate:   new Date(),
        complaintDetail: complaintDetail?.trim() || null,
      },
    });
    res.json(updated);
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

// POST /api/orders/:id/weight-entries — tambah baris berat badan
orderRouter.post("/:id/weight-entries", async (req, res) => {
  const { label, beratKg, sortOrder } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: "Label wajib diisi" });
  if (!beratKg)       return res.status(400).json({ error: "Berat badan wajib diisi" });
  try {
    const entry = await prisma.orderWeightEntry.create({
      data: {
        orderId:   req.params.id,
        label:     label.trim(),
        beratKg:   Number(beratKg),
        sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
      },
    });
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/orders/weight-entries/:entryId — edit baris berat badan
orderRouter.patch("/weight-entries/:entryId", async (req, res) => {
  const { label, beratKg, sortOrder } = req.body;
  try {
    const entry = await prisma.orderWeightEntry.update({
      where: { id: req.params.entryId },
      data: {
        ...(label     !== undefined && { label: label.trim() }),
        ...(beratKg   !== undefined && { beratKg: Number(beratKg) }),
        ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
      },
    });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/orders/weight-entries/:entryId — hapus baris berat badan
orderRouter.delete("/weight-entries/:entryId", async (req, res) => {
  try {
    await prisma.orderWeightEntry.delete({ where: { id: req.params.entryId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
