import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { KNOWN_SESSIONS } from "../services/wahaClient.js";

export const dashboardRouter = express.Router();
dashboardRouter.use(requireAuth);

// 5 percakapan terbaru untuk widget "Percakapan terbaru" di Dashboard
dashboardRouter.get("/recent-conversations", async (req, res) => {
  const conversations = await prisma.conversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    include: {
      customer: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 5,
  });
  res.json(conversations);
});

// Awal periode "today"/"week"/"month" (waktu server, bukan UTC murni) —
// dipakai widget "Distribusi Chat CS-1 vs CS-2".
function sessionDistributionPeriodStart(period) {
  const now = new Date();
  if (period === "week") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6); // 7 hari termasuk hari ini
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (period === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

// Widget "Distribusi Chat CS-1 vs CS-2" — READ ONLY, tidak menyentuh logic
// pembuatan/update Customer atau Conversation manapun.
// newLeads: Customer baru (createdAt dalam periode) dikelompokkan lewat
// sessionId dari Conversation individual PERTAMA milik customer itu (bukan
// field langsung di Customer, lihat schema.prisma).
// totalActive: snapshot jumlah Conversation type=INDIVIDUAL per sessionId,
// tanpa filter tanggal.
dashboardRouter.get("/session-distribution", async (req, res) => {
  const period = ["today", "week", "month"].includes(req.query.period) ? req.query.period : "today";
  const start = sessionDistributionPeriodStart(period);

  const [newCustomers, activeGroups] = await Promise.all([
    prisma.customer.findMany({
      where: { createdAt: { gte: start } },
      select: {
        conversations: {
          where: { type: "INDIVIDUAL" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { sessionId: true },
        },
      },
    }),
    prisma.conversation.groupBy({
      by: ["sessionId"],
      where: { type: "INDIVIDUAL" },
      _count: { _all: true },
    }),
  ]);

  const newLeadsBySession = {};
  for (const c of newCustomers) {
    const sessionId = c.conversations[0]?.sessionId;
    if (!sessionId) continue;
    newLeadsBySession[sessionId] = (newLeadsBySession[sessionId] || 0) + 1;
  }

  const totalActiveBySession = {};
  for (const g of activeGroups) {
    if (!g.sessionId) continue;
    totalActiveBySession[g.sessionId] = g._count._all;
  }

  const result = KNOWN_SESSIONS.map((session) => ({
    session,
    newLeads: newLeadsBySession[session] || 0,
    totalActive: totalActiveBySession[session] || 0,
  }));

  res.json(result);
});

// Drill-down widget "Distribusi Lead per Sesi" — daftar lead 1 tanggal
// tertentu, klik dari card newLeads (session-distribution) atau card
// "Total Lead" existing. READ ONLY, sessionId sama seperti di atas
// (dari Conversation individual pertama milik customer).
dashboardRouter.get("/leads-detail", async (req, res) => {
  const dateParam = req.query.date;
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? new Date(`${dateParam}T00:00:00`) : new Date();
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const sessionFilter = ["CS-1", "CS-2"].includes(req.query.session) ? req.query.session : "all";

  const customers = await prisma.customer.findMany({
    where: { createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      phone: true,
      createdAt: true,
      conversations: {
        where: { type: "INDIVIDUAL" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true, sessionId: true },
      },
    },
  });

  const result = customers
    .map((c) => {
      const firstConv = c.conversations[0] || null;
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        createdAt: c.createdAt,
        sessionId: firstConv?.sessionId || null,
        conversationId: firstConv?.id || null,
      };
    })
    .filter((c) => sessionFilter === "all" || c.sessionId === sessionFilter);

  res.json(result);
});
