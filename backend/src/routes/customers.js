import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { generateOrderNumber } from "../services/orderNumberGenerator.js";

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
    include: {
      orders: {
        include: {
          items:         { orderBy: { sortOrder: "asc" } },
          weightEntries: { orderBy: { sortOrder: "asc" } },
        },
      },
      assignedSales: true,
      conversations: { orderBy: { lastMessageAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  const result = customers.map(({ orders, conversations, ...c }) => {
    // Sort by updatedAt — order yang paling baru diperbarui statusnya
    const sorted = [...orders].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const latest = sorted[0] || null;

    // Parse field dari notes JSON order terbaru (merk, ukuran, keluhan)
    let latestKeluhan = null, latestMerkKasur = null, latestUkuranKasur = null;
    if (latest?.notes) {
      try {
        const n = JSON.parse(latest.notes);
        latestKeluhan    = n.keluhanCustomer || null;
        latestMerkKasur  = n.merkKasur       || null;
        latestUkuranKasur = n.ukuranKasur    || null;
      } catch {}
    }

    // Gabung semua nama layanan dari items order terbaru jadi 1 string
    const latestLayanan = (latest?.items || [])
      .map((i) => i.layananName)
      .filter(Boolean)
      .join(", ") || null;

    // Riwayat komplain dari semua order
    const riwayatKomplain = orders
      .filter((o) => o.hasComplaint)
      .sort((a, b) => new Date(b.complaintDate) - new Date(a.complaintDate))
      .map((o) => ({
        orderId:        o.id,
        orderNumber:    o.orderNumber,
        complaintDate:  o.complaintDate,
        complaintDetail: o.complaintDetail,
      }));

    return {
      ...c,
      orderCount: orders.length,
      orderValue: orders.reduce((sum, o) => sum + o.value, 0),
      lastMessageAt: conversations[0]?.lastMessageAt || null,
      latestOrderStatus:   latest?.status        || null,
      latestOrderNumber:   latest?.orderNumber   || null,
      latestPaymentStatus: latest?.paymentStatus || null,
      latestBeratBadan:    latest?.beratBadan    || null,
      latestWeightEntries: latest?.weightEntries || [],
      latestKeluhan,
      latestMerkKasur,
      latestUkuranKasur,
      latestLayanan,
      pernahKomplain: riwayatKomplain.length > 0,
      riwayatKomplain,
    };
  });

  res.json(result);
});

customerRouter.get("/:id", async (req, res) => {
  const customer = await prisma.customer.findUnique({
    where: { id: req.params.id },
    include: {
      notes: { include: { author: true }, orderBy: { createdAt: "desc" } },
      orders: {
        orderBy: { updatedAt: "desc" },
        include: {
          items:         { orderBy: { sortOrder: "asc" } },
          weightEntries: { orderBy: { sortOrder: "asc" } },
        },
      },
      assignedSales: true,
    },
  });
  if (!customer) return res.status(404).json({ error: "Pelanggan tidak ditemukan" });

  // Kumpulkan semua keluhan dari semua order (non-kosong, urut terbaru)
  const allKeluhan = customer.orders
    .map((o) => {
      let keluhan = null;
      if (o.notes) { try { keluhan = JSON.parse(o.notes).keluhanCustomer || null; } catch {} }
      return keluhan ? { keluhan, tanggal: o.updatedAt || o.createdAt } : null;
    })
    .filter(Boolean);

  // Riwayat komplain
  const riwayatKomplain = customer.orders
    .filter((o) => o.hasComplaint)
    .sort((a, b) => new Date(b.complaintDate) - new Date(a.complaintDate))
    .map((o) => ({
      orderId:        o.id,
      orderNumber:    o.orderNumber,
      complaintDate:  o.complaintDate,
      complaintDetail: o.complaintDetail,
    }));

  res.json({ ...customer, allKeluhan, pernahKomplain: riwayatKomplain.length > 0, riwayatKomplain });
});

// Update data CRM: nama, phone, tags, pipeline stage, sales yang ditugaskan, dll
customerRouter.patch("/:id", async (req, res) => {
  const {
    name, phone, tags, pipelineStage, assignedSalesId, email, city,
    leadSource, leadSourceDetail, leadSourceConfirmed,
    customerType, healthStatus,
  } = req.body;

  // Cek duplikat nomor kalau diubah
  if (phone !== undefined && phone !== null) {
    const cleanPhone = phone.replace(/\D/g, "").replace(/^0/, "62") || null;
    if (cleanPhone) {
      const dup = await prisma.customer.findFirst({ where: { phone: cleanPhone, NOT: { id: req.params.id } } });
      if (dup) return res.status(409).json({ error: "Nomor WhatsApp sudah dipakai pelanggan lain" });
    }
  }

  const data = {
    ...(name !== undefined && { name }),
    ...(phone !== undefined && { phone: phone ? phone.replace(/\D/g, "").replace(/^0/, "62") || null : null }),
    ...(tags !== undefined && { tags }),
    ...(pipelineStage !== undefined && { pipelineStage }),
    ...(assignedSalesId !== undefined && { assignedSalesId }),
    ...(email !== undefined && { email }),
    ...(city !== undefined && { city }),
    ...(leadSourceDetail !== undefined && { leadSourceDetail: leadSourceDetail || null }),
    ...(leadSourceConfirmed !== undefined && { leadSourceConfirmed }),
    ...(customerType !== undefined && { customerType }),
    ...(healthStatus !== undefined && { healthStatus: healthStatus || null }),
  };

  // Kalau leadSource diubah manual → otomatis set confirmed = true
  if (leadSource !== undefined) {
    data.leadSource = leadSource;
    data.leadSourceConfirmed = true;
  }

  try {
    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data,
    });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// Catat order baru — value mulai 0, akan dihitung otomatis dari items
// orderNumber di-generate otomatis berdasarkan category (jangan kirim dari frontend)
customerRouter.post("/:id/orders", async (req, res) => {
  const { quantity, status, notes, beratBadan, category } = req.body;

  const cat = category || "LAYANAN";
  const orderNumber = await generateOrderNumber(cat);

  const order = await prisma.order.create({
    data: {
      customerId: req.params.id,
      value: 0,
      quantity: quantity ? Number(quantity) : 1,
      status: status || "PENDING",
      category: cat,
      orderNumber,
      notes,
      ...(beratBadan !== undefined && { beratBadan: beratBadan ? Number(beratBadan) : null }),
    },
    include: { items: true },
  });
  res.status(201).json(order);
});

// Update status / notes / orderNumber order
customerRouter.patch("/:id/orders/:orderId", async (req, res) => {
  const { status, notes, quantity, orderNumber } = req.body;
  const order = await prisma.order.update({
    where: { id: req.params.orderId },
    data: {
      ...(status      !== undefined && { status }),
      ...(notes       !== undefined && { notes }),
      ...(quantity    !== undefined && { quantity: Number(quantity) }),
      ...(orderNumber !== undefined && { orderNumber: orderNumber?.trim() || null }),
    },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  res.json(order);
});

// PATCH /api/notes/:id — edit catatan (hanya penulis asli atau ADMIN)
customerRouter.patch("/notes/:id", async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Catatan tidak boleh kosong" });

  try {
    const note = await prisma.note.findUnique({ where: { id: req.params.id } });
    if (!note) return res.status(404).json({ error: "Catatan tidak ditemukan" });

    const isOwner = note.authorId === req.user.id;
    const isAdmin = req.user.role === "ADMIN";
    if (!isOwner && !isAdmin) return res.status(403).json({ error: "Tidak punya akses edit catatan ini" });

    const updated = await prisma.note.update({
      where: { id: req.params.id },
      data: { content: content.trim() },
      include: { author: true },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notes/:id — hapus catatan (hanya penulis asli atau ADMIN)
customerRouter.delete("/notes/:id", async (req, res) => {
  try {
    const note = await prisma.note.findUnique({ where: { id: req.params.id } });
    if (!note) return res.status(404).json({ error: "Catatan tidak ditemukan" });

    const isOwner = note.authorId === req.user.id;
    const isAdmin = req.user.role === "ADMIN";
    if (!isOwner && !isAdmin) return res.status(403).json({ error: "Tidak punya akses hapus catatan ini" });

    await prisma.note.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
