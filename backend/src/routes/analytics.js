import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const analyticsRouter = express.Router();
analyticsRouter.use(requireAuth);

analyticsRouter.get("/overview", async (req, res) => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [totalCustomers, orderAgg, thisMonthAgg, leadSourceGroups, monthlyTrafficRaw] =
    await Promise.all([
      prisma.customer.count(),
      prisma.order.aggregate({ _count: { _all: true }, _sum: { value: true } }),
      prisma.order.aggregate({
        where: { createdAt: { gte: startOfMonth }, status: { not: "CANCELLED" } },
        _sum: { value: true },
      }),
      prisma.customer.groupBy({ by: ["leadSource"], _count: { _all: true } }),
      // Traffic bulanan: jumlah percakapan baru per bulan, 6 bulan terakhir
      prisma.$queryRaw`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') as month,
               COUNT(*)::int as count
        FROM "Conversation"
        WHERE "createdAt" >= NOW() - INTERVAL '6 months'
        GROUP BY 1
        ORDER BY 1
      `,
    ]);

  res.json({
    totalCustomers,
    totalOrders: orderAgg._count._all,
    totalOrderValue: orderAgg._sum.value || 0,
    thisMonthValue: thisMonthAgg._sum.value || 0,
    leadSourceBreakdown: leadSourceGroups.map((g) => ({
      leadSource: g.leadSource || "OTHER",
      count: g._count._all,
    })),
    monthlyTraffic: monthlyTrafficRaw,
  });
});
