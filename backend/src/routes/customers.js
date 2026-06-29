import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const customerRouter = express.Router();
customerRouter.use(requireAuth);

// Daftar semua pelanggan + agregat order, dipakai di halaman Customer 360
customerRouter.get("/", async (req, res) => {
  const customers = await prisma.customer.findMany({
    include: { orders: true, assignedSales: true },
    orderBy: { updatedAt: "desc" },
  });

  const result = customers.map(({ orders, ...c }) => ({
    ...c,
    orderCount: orders.length,
    orderValue: orders.reduce((sum, o) => sum + o.value, 0),
  }));

  res.json(result);
});

customerRouter.get("/:id", async (req, res) => {
  const customer = await prisma.customer.findUnique({
    where: { id: req.params.id },
    include: {
      notes: { include: { author: true }, orderBy: { createdAt: "desc" } },
      orders: { orderBy: { createdAt: "desc" } },
      assignedSales: true,
    },
  });
  if (!customer) return res.status(404).json({ error: "Pelanggan tidak ditemukan" });
  res.json(customer);
});

// Update data CRM: nama, tags, pipeline stage, sales yang ditugaskan, dll
customerRouter.patch("/:id", async (req, res) => {
  const { name, tags, pipelineStage, assignedSalesId, email, city, leadSource } = req.body;
  const customer = await prisma.customer.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(tags !== undefined && { tags }),
      ...(pipelineStage !== undefined && { pipelineStage }),
      ...(assignedSalesId !== undefined && { assignedSalesId }),
      ...(email !== undefined && { email }),
      ...(city !== undefined && { city }),
      ...(leadSource !== undefined && { leadSource }),
    },
  });
  res.json(customer);
});

customerRouter.post("/:id/notes", async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Catatan kosong" });

  const note = await prisma.note.create({
    data: { customerId: req.params.id, authorId: req.user.id, content },
    include: { author: true },
  });
  res.status(201).json(note);
});

// Catat order baru -- input manual dulu (belum ada integrasi e-commerce/POS)
customerRouter.post("/:id/orders", async (req, res) => {
  const { value, quantity, status, notes } = req.body;
  if (!value) return res.status(400).json({ error: "Nilai order wajib diisi" });

  const order = await prisma.order.create({
    data: {
      customerId: req.params.id,
      value: Number(value),
      quantity: quantity ? Number(quantity) : 1,
      status: status || "PENDING",
      notes,
    },
  });
  res.status(201).json(order);
});
