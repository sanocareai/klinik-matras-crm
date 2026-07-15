// ═══ WAVE 4B.0 — REPLY ASSISTANT ROUTES (internal, draft-only) ═══════════════
// Mounted di /api/ai (additive, TIDAK mengubah aiRouter). requireAuth + role-scope.
// Read-only kecuali baris audit ReplySuggestionLog. TIDAK mengirim WhatsApp.
import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { loadCustomerContext, buildCustomerIntelligence } from "../services/intelligence/index.js";
import { buildConversationContext } from "../services/intelligence/replyReadiness.js";
import { generateSuggestions } from "../services/replyAssistant/index.js";
import { getActiveProvider } from "../services/replyAssistant/providers/index.js";
import { canAccessCustomer } from "../services/replyAssistant/scope.js";
import { loadConfig, dailyLimitFor } from "../services/replyAssistant/config.js";

export const replyAssistantRouter = express.Router();
replyAssistantRouter.use(requireAuth);

function startOfTodayUTC(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function startOfTomorrowUTC(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}
function startOfMonthUTC(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const CONV_SELECT = {
  id: true,
  channel: true,
  sessionId: true,
  customerId: true,
  customer: {
    select: {
      id: true, name: true, phone: true, pipelineStage: true, assignedSalesId: true,
      orders: { select: { value: true, status: true, hasComplaint: true, createdAt: true } },
    },
  },
  messages: { orderBy: { createdAt: "desc" }, take: 10, select: { direction: true, content: true, createdAt: true } },
};

// POST /api/ai/reply-suggestions — draf balasan untuk 1 percakapan nyata.
replyAssistantRouter.post("/reply-suggestions", async (req, res) => {
  try {
    const { conversationId } = req.body || {};
    if (!conversationId) return res.status(400).json({ error: "conversationId wajib" });

    const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: CONV_SELECT });
    if (!conv || !conv.customer) return res.status(404).json({ error: "Percakapan/pelanggan tidak ditemukan" });

    // Role scoping — sama seperti /customers/:id/intelligence.
    if (!canAccessCustomer(conv.customer, req.user)) {
      return res.status(403).json({ error: "Tidak boleh mengakses percakapan ini" });
    }

    // Konteks intelligence (Wave 4A) + context ter-mask (maks 10 pesan, telepon di-mask).
    const ictx = await loadCustomerContext(prisma, conv.customerId);
    const intelligence = ictx ? buildCustomerIntelligence(ictx) : null;
    const recentMessages = [...conv.messages].reverse(); // kronologis
    const context = buildConversationContext({ conversation: conv, customer: conv.customer, recentMessages, intelligence });

    const deps = {
      config: loadConfig(),
      getProvider: () => getActiveProvider(),
      countToday: () =>
        prisma.replySuggestionLog.count({ where: { userId: req.user.id, blocked: false, createdAt: { gte: startOfTodayUTC() } } }),
      monthCostUsd: async () =>
        (await prisma.replySuggestionLog.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: startOfMonthUTC() } } }))._sum.costUsd || 0,
      writeAudit: (row) => prisma.replySuggestionLog.create({ data: row }),
    };

    const result = await generateSuggestions(
      { conversationId, customerId: conv.customerId, user: req.user, context },
      deps
    );
    res.json(result);
  } catch (err) {
    console.error("reply-suggestions error:", err);
    res.status(500).json({ error: "Gagal membuat draf balasan" });
  }
});

// GET /api/ai/reply-suggestions/quota — sisa kuota harian user.
replyAssistantRouter.get("/reply-suggestions/quota", async (req, res) => {
  try {
    const limit = dailyLimitFor(req.user.role);
    const used = await prisma.replySuggestionLog.count({
      where: { userId: req.user.id, blocked: false, createdAt: { gte: startOfTodayUTC() } },
    });
    res.json({ remaining: Math.max(0, limit - used), limit, resetsAt: startOfTomorrowUTC().toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Gagal memuat kuota" });
  }
});

// PATCH /api/ai/reply-suggestions/:id — transisi status/feedback dilaporkan UI (4B.1).
// Backend hanya izinkan transisi yang di-report klien; GENERATED/BLOCKED milik server.
const CLIENT_STATUS = ["COPIED", "EDITED", "SENT", "DISMISSED"];
const VALID_FEEDBACK = ["POSITIVE", "NEGATIVE"];
replyAssistantRouter.patch("/reply-suggestions/:id", async (req, res) => {
  try {
    const { status, feedback } = req.body || {};
    const row = await prisma.replySuggestionLog.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "Log tidak ditemukan" });
    if (row.userId !== req.user.id && req.user.role !== "ADMIN") {
      return res.status(403).json({ error: "Tidak boleh mengubah log ini" });
    }

    const data = {};
    if (status !== undefined) {
      if (!CLIENT_STATUS.includes(status)) return res.status(400).json({ error: "status tidak valid" });
      data.status = status;
    }
    if (feedback !== undefined) {
      if (feedback !== null && !VALID_FEEDBACK.includes(feedback)) return res.status(400).json({ error: "feedback tidak valid" });
      data.feedback = feedback;
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: "Tidak ada perubahan" });

    const updated = await prisma.replySuggestionLog.update({ where: { id: req.params.id }, data });
    res.json({ id: updated.id, status: updated.status, feedback: updated.feedback });
  } catch (err) {
    res.status(500).json({ error: "Gagal memperbarui log" });
  }
});
