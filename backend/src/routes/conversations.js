import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { sendText } from "../services/wahaClient.js";

export const conversationRouter = express.Router();
conversationRouter.use(requireAuth);

// Daftar percakapan, terbaru duluan, lengkap dengan info pelanggan + pesan terakhir
// Optional query: ?status=OPEN|PENDING|RESOLVED
conversationRouter.get("/", async (req, res) => {
  const { status } = req.query;
  const where = status ? { status } : {};

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: "desc" },
    include: {
      customer: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 100,
  });
  res.json(conversations);
});

// Riwayat pesan dalam satu percakapan
conversationRouter.get("/:id/messages", async (req, res) => {
  const messages = await prisma.message.findMany({
    where: { conversationId: req.params.id },
    orderBy: { createdAt: "asc" },
  });
  res.json(messages);
});

// Kirim balasan -> simpan ke DB + kirim via WAHA
conversationRouter.post("/:id/messages", async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Pesan kosong" });

  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });
  if (!conversation) return res.status(404).json({ error: "Percakapan tidak ditemukan" });

  if (conversation.channel === "WHATSAPP") {
    if (!conversation.customer.phone) {
      return res.status(400).json({ error: "Nomor WhatsApp pelanggan tidak tersedia" });
    }
    await sendText(conversation.customer.phone, content);
  } else {
    return res.status(400).json({ error: "Channel ini belum didukung (Phase 2)" });
  }

  const message = await prisma.message.create({
    data: { conversationId: conversation.id, direction: "OUTBOUND", content },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  res.status(201).json(message);
});

// Update status / assignment percakapan
conversationRouter.patch("/:id", async (req, res) => {
  const { status, assignedToId } = req.body;
  const conversation = await prisma.conversation.update({
    where: { id: req.params.id },
    data: { ...(status && { status }), ...(assignedToId !== undefined && { assignedToId }) },
  });
  res.json(conversation);
});
