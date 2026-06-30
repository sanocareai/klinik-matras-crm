import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { updateContactName } from "../services/wahaClient.js";

export const customerRouter = express.Router();
customerRouter.use(requireAuth);

// Buat pelanggan baru secara manual (wajib isi minimal phone atau instagramHandle)
customerRouter.post("/", async (req, res) => {
  const { name, phone, instagramHandle, city, email, leadSource } = req.body;

  const cleanPhone = phone?.trim() || null;
  const cleanHandle = instagramHandle?.trim() || null;

  if (!cleanPhone && !cleanHandle) {
    return res.status(400).json({ error: "Wajib isi nomor WhatsApp atau username Instagram" });
  }

  // Cek duplikat
  if (cleanPhone) {
    const exists = await prisma.customer.findUnique({ where: { phone: cleanPhone } });
    if (exists) return res.status(409).json({ error: "Nomor WhatsApp sudah terdaftar" });
  }
  if (cleanHandle) {
    const exists = await prisma.customer.findUnique({ where: { instagramHandle: cleanHandle } });
    if (exists) return res.status(409).json({ error: "Username Instagram sudah terdaftar" });
  }

  const customer = await prisma.customer.create({
    data: {
      name: name?.trim() || null,
      phone: cleanPhone,
      instagramHandle: cleanHandle,
      city: city?.trim() || null,
      email: email?.trim() || null,
      leadSource: leadSource || "OTHER",
    },
  });
  res.status(201).json(customer);
});

// Daftar semua pelanggan + agregat order + filter opsional
customerRouter.get("/", async (req, res) => {
  const { search, stage, source, sales } = req.query;

  const where = {};
  if (stage)  where.pipelineStage = stage;
  if (source) where.leadSource    = source;
  if (sales)  where.assignedSalesId = sales;
  if (search) {
    where.OR = [
      { name:            { contains: search, mode: "insensitive" } },
      { phone:           { contains: search } },
      { instagramHandle: { contains: search, mode: "insensitive" } },
      { email:           { contains: search, mode: "insensitive" } },
    ];
  }

  const customers = await prisma.customer.findMany({
    where,
    include: { orders: true, assignedSales: true, conversations: { orderBy: { lastMessageAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });

  const result = customers.map(({ orders, conversations, ...c }) => ({
    ...c,
    orderCount: orders.length,
    orderValue: orders.reduce((sum, o) => sum + o.value, 0),
    lastMessageAt: conversations[0]?.lastMessageAt || null,
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

  // Sync nama ke kontak WhatsApp (coba max 3 detik, kembalikan status ke frontend)
  let whatsappSyncStatus = "skipped";
  if (name !== undefined && name?.trim() && customer.phone) {
    try {
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 3000));
      const result = await Promise.race([updateContactName(customer.phone, name.trim()), timeoutPromise]);
      whatsappSyncStatus = result === true ? "success" : "failed";
    } catch {
      whatsappSyncStatus = "failed";
    }
  }

  res.json({ ...customer, whatsappSyncStatus });
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

// Riwayat semua percakapan pelanggan beserta pesannya (untuk tab Riwayat Chat di drawer)
customerRouter.get("/:id/conversations", async (req, res) => {
  const conversations = await prisma.conversation.findMany({
    where: { customerId: req.params.id },
    orderBy: { lastMessageAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  res.json(conversations);
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

// Update status / jenis layanan order
customerRouter.patch("/:id/orders/:orderId", async (req, res) => {
  const { status, notes } = req.body;
  const order = await prisma.order.update({
    where: { id: req.params.orderId },
    data: {
      ...(status !== undefined && { status }),
      ...(notes !== undefined && { notes }),
    },
  });
  res.json(order);
});
