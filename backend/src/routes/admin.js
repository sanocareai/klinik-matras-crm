// Endpoint diagnostik internal — khusus ADMIN.
// Tujuan: cek kesehatan sinkronisasi satu nomor customer terhadap WAHA.

import express from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { fetchChatHistory } from "../services/wahaClient.js";
import { runReconciliation } from "../services/reconciliation.js";

export const adminRouter = express.Router();
adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

// GET /api/admin/diagnostics/customer/:phone
// Return: data DB customer + semua percakapan + 20 pesan terakhir per percakapan,
//         perbandingan langsung dengan WAHA, dan ringkasan discrepancy terakhir.
adminRouter.get("/diagnostics/customer/:phone", async (req, res) => {
  const { phone } = req.params;
  const cleanPhone = phone.replace(/[^0-9]/g, ""); // hanya angka, aman untuk lookup

  try {
    // Data customer + semua percakapan + pesan terakhir
    const customer = await prisma.customer.findUnique({
      where: { phone: cleanPhone },
      include: {
        conversations: {
          orderBy: { lastMessageAt: "desc" },
          include: {
            messages: {
              orderBy: { createdAt: "desc" },
              take: 20,
            },
          },
        },
      },
    });

    if (!customer) {
      return res.status(404).json({ error: `Customer dengan nomor ${cleanPhone} tidak ditemukan di DB` });
    }

    // Hitung total pesan di DB untuk konversasi aktif (non-resolved)
    const activeConv = customer.conversations.find(c => c.status !== "RESOLVED") || customer.conversations[0];
    const dbCount    = activeConv
      ? await prisma.message.count({ where: { conversationId: activeConv.id } })
      : 0;

    // Ambil pesan langsung dari WAHA (maks 50) — sessionId conversation aktif
    // kalau ada (fetchChatHistory fallback ke session lain sendiri).
    const wahaMessages = await fetchChatHistory(cleanPhone, activeConv?.sessionId || undefined, { maxMessages: 50, pageSize: 50 });
    const wahaCount    = wahaMessages.length;

    // Discrepancy terbaru untuk nomor ini
    const recentDiscrepancies = await prisma.syncDiscrepancy.findMany({
      where:   { phone: cleanPhone },
      orderBy: { checkedAt: "desc" },
      take:    5,
    });

    // UnresolvedMessage terkait nomor ini (kalau pernah gagal resolve)
    const unresolvedCount = await prisma.unresolvedMessage.count({
      where: {
        rawJid:   { contains: cleanPhone },
        resolved: false,
      },
    });

    res.json({
      customer: {
        id:             customer.id,
        name:           customer.name,
        phone:          customer.phone,
        pipelineStage:  customer.pipelineStage,
        leadSource:     customer.leadSource,
        createdAt:      customer.createdAt,
        conversationCount: customer.conversations.length,
      },
      conversations: customer.conversations.map(c => ({
        id:            c.id,
        status:        c.status,
        lastMessageAt: c.lastMessageAt,
        messageCount:  c.messages.length, // hanya 20 sampel
        recentMessages: c.messages.map(m => ({
          direction:  m.direction,
          content:    m.content?.slice(0, 100),
          externalId: m.externalId,
          createdAt:  m.createdAt,
        })),
      })),
      sync: {
        dbCount,
        wahaCount,
        difference:    Math.abs(wahaCount - dbCount),
        status:        Math.abs(wahaCount - dbCount) <= 2 ? "OK" : "DRIFT",
        wahaMessages: wahaMessages.slice(0, 10).map(m => ({
          id:     m.id,
          fromMe: m.fromMe,
          body:   m.body?.slice(0, 100),
          t:      m.timestamp,
        })),
      },
      recentDiscrepancies,
      unresolvedCount,
    });
  } catch (e) {
    console.error("[admin/diagnostics] Error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/diagnostics/unresolved
// Lihat daftar pesan yang gagal di-resolve (untuk audit manual)
adminRouter.get("/diagnostics/unresolved", async (req, res) => {
  try {
    const items = await prisma.unresolvedMessage.findMany({
      where:   { resolved: false },
      orderBy: { createdAt: "desc" },
      take:    50,
    });
    res.json({ total: items.length, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/diagnostics/reconcile
// Trigger rekonsiliasi manual (tidak perlu tunggu jam 2 pagi)
adminRouter.post("/diagnostics/reconcile", async (req, res) => {
  res.json({ message: "Rekonsiliasi dimulai di background — cek log server" });
  setImmediate(runReconciliation);
});
