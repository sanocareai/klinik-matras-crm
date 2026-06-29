import express from "express";
import { prisma } from "../db.js";
import { cleanPhoneNumber } from "../services/wahaClient.js";

export const webhookRouter = express.Router();

// WAHA akan POST ke endpoint ini setiap ada event (pesan masuk, status sesi, dll)
// Daftarkan URL ini (https://domain-anda.com/api/webhooks/waha) saat membuat sesi WAHA.
webhookRouter.post("/waha", async (req, res) => {
  // Selalu balas 200 cepat dulu supaya WAHA tidak retry/duplikat karena timeout
  res.sendStatus(200);

  try {
    const { event, payload } = req.body;

    // Log payload mentah dulu saat development -- field bisa beda tergantung engine WAHA
    console.log("[WAHA webhook]", event, JSON.stringify(payload));

    if (event !== "message") return; // fokus dulu ke pesan masuk di Phase 1
    if (!payload || payload.fromMe) return; // abaikan pesan yang kita kirim sendiri

    const externalId = payload.id;
    const fromRaw = payload.from;
    const text = payload.body || "[media/pesan tidak didukung]";

    if (!externalId || !fromRaw) return;

    // Cegah duplikat: WAHA bisa kirim event yang sama lebih dari sekali
    const existing = await prisma.message.findUnique({ where: { externalId } });
    if (existing) return;

    const phone = cleanPhoneNumber(fromRaw);

    const customer = await prisma.customer.upsert({
      where: { phone },
      update: {},
      create: { phone, leadSource: "WHATSAPP_DIRECT" },
    });

    let conversation = await prisma.conversation.findFirst({
      where: { customerId: customer.id, channel: "WHATSAPP", status: { not: "RESOLVED" } },
      orderBy: { lastMessageAt: "desc" },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { customerId: customer.id, channel: "WHATSAPP" },
      });
    }

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: "INBOUND",
        content: text,
        externalId,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), status: "OPEN" },
    });
  } catch (err) {
    console.error("Gagal proses webhook WAHA:", err);
  }
});
