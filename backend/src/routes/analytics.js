import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const analyticsRouter = express.Router();
analyticsRouter.use(requireAuth);

// Bangun where clause dari query params ?from=YYYY-MM-DD&to=YYYY-MM-DD
function buildDateWhere(from, to, field = "createdAt") {
  if (!from || !to) return {};
  return { [field]: { gte: new Date(from + "T00:00:00.000Z"), lte: new Date(to + "T23:59:59.999Z") } };
}

function buildPrevRange(from, to) {
  if (!from || !to) return null;
  const f = new Date(from + "T00:00:00.000Z");
  const t = new Date(to + "T23:59:59.999Z");
  const diffMs = t - f;
  return {
    gte: new Date(f.getTime() - diffMs - 1),
    lte: new Date(f.getTime() - 1),
  };
}

analyticsRouter.get("/overview", async (req, res) => {
  try {
    const { from, to } = req.query;
    const orderWhere = buildDateWhere(from, to);
    const convWhere  = buildDateWhere(from, to);
    const custWhere  = buildDateWhere(from, to);
    const prevRange  = buildPrevRange(from, to);

    // Kalau ada date filter, hitung juga periode sebelumnya untuk persentase pertumbuhan
    const [
      totalCustomers, totalCustomersPrev,
      orderAgg, orderAggPrev,
      thisMonthAgg,
      leadSourceGroups,
      monthlyTrafficRaw,
      monthlyRevenueRaw,
      monthlyCustomersRaw,
      channelBreakdownRaw,
      customersWithOrdersCount,
    ] = await Promise.all([
      prisma.customer.count({ where: custWhere }),
      prevRange ? prisma.customer.count({ where: { createdAt: prevRange } }) : Promise.resolve(null),

      prisma.order.aggregate({
        where: { ...orderWhere, status: { not: "CANCELLED" } },
        _count: { _all: true },
        _sum: { value: true },
      }),
      prevRange
        ? prisma.order.aggregate({
            where: { createdAt: prevRange, status: { not: "CANCELLED" } },
            _count: { _all: true },
            _sum: { value: true },
          })
        : Promise.resolve(null),

      // thisMonth = range saat ini (atau bulan ini kalau tidak ada filter)
      (from && to)
        ? prisma.order.aggregate({
            where: { ...orderWhere, status: { not: "CANCELLED" } },
            _sum: { value: true },
          })
        : (async () => {
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);
            return prisma.order.aggregate({
              where: { createdAt: { gte: startOfMonth }, status: { not: "CANCELLED" } },
              _sum: { value: true },
            });
          })(),

      prisma.customer.groupBy({ by: ["leadSource"], _count: { _all: true }, where: custWhere }),

      prisma.$queryRaw`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') as month,
               COUNT(*)::int as count
        FROM "Conversation"
        WHERE "createdAt" >= NOW() - INTERVAL '6 months'
        GROUP BY 1
        ORDER BY 1
      `,

      // Pendapatan bulanan 6 bulan terakhir
      prisma.$queryRaw`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') as month,
               COALESCE(SUM(value), 0)::bigint as value
        FROM "Order"
        WHERE status != 'CANCELLED'
          AND "createdAt" >= NOW() - INTERVAL '6 months'
        GROUP BY 1
        ORDER BY 1
      `,

      // Pelanggan baru per bulan 6 bulan terakhir
      prisma.$queryRaw`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') as month,
               COUNT(*)::int as count
        FROM "Customer"
        WHERE "createdAt" >= NOW() - INTERVAL '6 months'
        GROUP BY 1
        ORDER BY 1
      `,

      // Channel breakdown percakapan
      prisma.conversation.groupBy({
        by: ["channel"],
        _count: { _all: true },
        where: convWhere,
      }),

      // Jumlah pelanggan yang punya minimal 1 order
      prisma.customer.count({
        where: {
          ...custWhere,
          orders: { some: { status: { not: "CANCELLED" } } },
        },
      }),
    ]);

    function growth(curr, prev) {
      if (prev === null || prev === undefined) return null;
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 100);
    }

    res.json({
      // Pelanggan
      newCustomers: totalCustomers,
      totalCustomers,
      growthCustomers: growth(totalCustomers, totalCustomersPrev),
      customersWithOrders: customersWithOrdersCount,

      // Order
      totalOrders: orderAgg._count._all,
      growthOrders: growth(orderAgg._count._all, orderAggPrev?._count._all ?? null),
      totalOrderValue: orderAgg._sum.value || 0,
      growthOrderValue: growth(orderAgg._sum.value || 0, orderAggPrev?._sum.value || null),
      thisMonthValue: thisMonthAgg._sum.value || 0,

      // Breakdown
      leadSourceBreakdown: leadSourceGroups.map((g) => ({
        leadSource: g.leadSource || "OTHER",
        count: g._count._all,
      })),
      channelBreakdown: channelBreakdownRaw.map((g) => ({
        channel: g.channel,
        count: g._count._all,
      })),

      // Tren bulanan
      monthlyRevenue: monthlyRevenueRaw.map((r) => ({ month: r.month, value: Number(r.value) })),
      monthlyCustomers: monthlyCustomersRaw.map((r) => ({ month: r.month, count: Number(r.count) })),
      monthlyTraffic: monthlyTrafficRaw,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

analyticsRouter.get("/performance", async (req, res) => {
  try {
    const { from, to } = req.query;
    const convWhere = buildDateWhere(from, to);

    const [totalConversations, openCount, resolvedCount] = await Promise.all([
      prisma.conversation.count({ where: convWhere }),
      prisma.conversation.count({ where: { ...convWhere, status: "OPEN" } }),
      prisma.conversation.count({ where: { ...convWhere, status: "RESOLVED" } }),
    ]);

    const closingRate = totalConversations > 0
      ? Math.round((resolvedCount / totalConversations) * 100)
      : 0;

    // Rata-rata response time: selisih pesan INBOUND pertama vs OUTBOUND pertama per conv
    let avgResponseMinutes = null;
    try {
      const result = await prisma.$queryRaw`
        SELECT AVG(EXTRACT(EPOCH FROM (o."createdAt" - i."createdAt")) / 60) as avg_minutes
        FROM (
          SELECT "conversationId", MIN("createdAt") as "createdAt"
          FROM "Message" WHERE direction = 'INBOUND'
          GROUP BY "conversationId"
        ) i
        JOIN (
          SELECT "conversationId", MIN("createdAt") as "createdAt"
          FROM "Message" WHERE direction = 'OUTBOUND'
          GROUP BY "conversationId"
        ) o ON i."conversationId" = o."conversationId"
        WHERE o."createdAt" > i."createdAt"
      `;
      avgResponseMinutes = result[0]?.avg_minutes
        ? Math.round(Number(result[0].avg_minutes))
        : null;
    } catch (_) {}

    res.json({ totalConversations, openCount, resolvedCount, closingRate, avgResponseMinutes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

analyticsRouter.get("/cs-performance", async (req, res) => {
  try {
    const { from, to } = req.query;
    const convWhere = buildDateWhere(from, to);

    const users = await prisma.user.findMany({ where: { role: { not: "ADMIN" } } });

    const rows = await Promise.all(
      users.map(async (u) => {
        const where = { ...convWhere, assignedToId: u.id };
        const [total, resolved, orderAgg] = await Promise.all([
          prisma.conversation.count({ where }),
          prisma.conversation.count({ where: { ...where, status: "RESOLVED" } }),
          prisma.order.aggregate({
            where: {
              ...(from && to ? { createdAt: { gte: new Date(from), lte: new Date(to) } } : {}),
              customer: { assignedSalesId: u.id },
              status: { not: "CANCELLED" },
            },
            _sum: { value: true },
          }),
        ]);

        let avgResponseMinutes = null;
        try {
          const result = await prisma.$queryRaw`
            SELECT AVG(EXTRACT(EPOCH FROM (o."createdAt" - i."createdAt")) / 60) as avg_minutes
            FROM (
              SELECT m."conversationId", MIN(m."createdAt") as "createdAt"
              FROM "Message" m
              JOIN "Conversation" c ON c.id = m."conversationId"
              WHERE m.direction = 'INBOUND' AND c."assignedToId" = ${u.id}
              GROUP BY m."conversationId"
            ) i
            JOIN (
              SELECT m."conversationId", MIN(m."createdAt") as "createdAt"
              FROM "Message" m
              JOIN "Conversation" c ON c.id = m."conversationId"
              WHERE m.direction = 'OUTBOUND' AND c."assignedToId" = ${u.id}
              GROUP BY m."conversationId"
            ) o ON i."conversationId" = o."conversationId"
            WHERE o."createdAt" > i."createdAt"
          `;
          avgResponseMinutes = result[0]?.avg_minutes
            ? Math.round(Number(result[0].avg_minutes))
            : null;
        } catch (_) {}

        return {
          userId: u.id,
          name: u.name,
          totalConversations: total,
          closingRate: total > 0 ? Math.round((resolved / total) * 100) : 0,
          avgResponseMinutes,
          totalOrderValue: orderAgg._sum.value || 0,
        };
      })
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Performance per sumber lead — untuk menghitung ROI per channel
analyticsRouter.get("/source-performance", async (req, res) => {
  try {
    const { from, to } = req.query;
    const custDateWhere = buildDateWhere(from, to);

    const sources = await prisma.customer.groupBy({
      by: ["leadSource"],
      where: custDateWhere,
      _count: { id: true },
    });

    const result = await Promise.all(sources.map(async (s) => {
      const [won, orderAgg] = await Promise.all([
        prisma.customer.count({
          where: { leadSource: s.leadSource, pipelineStage: "WON", ...custDateWhere },
        }),
        prisma.order.aggregate({
          where: {
            customer: { leadSource: s.leadSource, ...custDateWhere },
            status: { not: "CANCELLED" },
          },
          _sum: { value: true },
        }),
      ]);
      return {
        source:     s.leadSource,
        leads:      s._count.id,
        won,
        convRate:   s._count.id > 0 ? Math.round((won / s._count.id) * 100) : 0,
        totalValue: orderAgg._sum.value || 0,
      };
    }));

    // Urutkan dari leads terbanyak
    result.sort((a, b) => b.leads - a.leads);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

analyticsRouter.get("/pipeline-funnel", async (req, res) => {
  try {
    const stageGroups = await prisma.customer.groupBy({
      by: ["pipelineStage"],
      _count: { _all: true },
    });

    const stageValues = await Promise.all(
      stageGroups.map(async (g) => {
        const agg = await prisma.order.aggregate({
          where: {
            customer: { pipelineStage: g.pipelineStage },
            status: { not: "CANCELLED" },
          },
          _sum: { value: true },
        });
        return {
          stage: g.pipelineStage,
          count: g._count._all,
          value: agg._sum.value || 0,
        };
      })
    );

    const ORDER = ["LEAD", "QUALIFIED", "QUOTED", "WON", "LOST"];
    const sorted = ORDER.map((s) => stageValues.find((r) => r.stage === s) || { stage: s, count: 0, value: 0 });

    res.json(sorted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
