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

      // type = 'INDIVIDUAL' — grup WA internal (Grup Sales/Driver/Produksi)
      // BUKAN lead/customer, tidak boleh ikut hitungan traffic.
      prisma.$queryRaw`
        SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') as month,
               COUNT(*)::int as count
        FROM "Conversation"
        WHERE "createdAt" >= NOW() - INTERVAL '6 months'
          AND "type" = 'INDIVIDUAL'
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

      // Channel breakdown percakapan — hanya INDIVIDUAL, grup WA internal
      // bukan lead dan selalu channel WHATSAPP juga (akan skew breakdown).
      prisma.conversation.groupBy({
        by: ["channel"],
        _count: { _all: true },
        where: { ...convWhere, type: "INDIVIDUAL" },
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
    // type: INDIVIDUAL — grup WA internal bukan percakapan lead, tidak boleh
    // ikut menghitung Total Percakapan/Closing Rate di Laporan.
    const convWhere = { ...buildDateWhere(from, to), type: "INDIVIDUAL" };

    const [totalConversations, openCount, resolvedCount] = await Promise.all([
      prisma.conversation.count({ where: convWhere }),
      prisma.conversation.count({ where: { ...convWhere, status: "OPEN" } }),
      prisma.conversation.count({ where: { ...convWhere, status: "RESOLVED" } }),
    ]);

    const closingRate = totalConversations > 0
      ? Math.round((resolvedCount / totalConversations) * 100)
      : 0;

    // Rata-rata response time: selisih pesan INBOUND pertama vs OUTBOUND pertama per conv
    // (JOIN ke Conversation supaya grup WA internal tidak ikut terhitung)
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
        JOIN "Conversation" c ON c.id = i."conversationId"
        WHERE o."createdAt" > i."createdAt" AND c."type" = 'INDIVIDUAL'
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
    // type: INDIVIDUAL — grup WA internal (kalau pernah ke-assign lewat
    // takeover) tidak boleh ikut menghitung performa CS per sales.
    const convWhere = { ...buildDateWhere(from, to), type: "INDIVIDUAL" };

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
              WHERE m.direction = 'INBOUND' AND c."assignedToId" = ${u.id} AND c."type" = 'INDIVIDUAL'
              GROUP BY m."conversationId"
            ) i
            JOIN (
              SELECT m."conversationId", MIN(m."createdAt") as "createdAt"
              FROM "Message" m
              JOIN "Conversation" c ON c.id = m."conversationId"
              WHERE m.direction = 'OUTBOUND' AND c."assignedToId" = ${u.id} AND c."type" = 'INDIVIDUAL'
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
          avatarUrl: u.avatarUrl,
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

// GET /api/analytics/sales-performance?year=&month=
// Per-sales: totalOrderValue bulan itu, target dari SalesTarget, persentase pencapaian
analyticsRouter.get("/sales-performance", async (req, res) => {
  try {
    const year  = Number(req.query.year  || new Date().getFullYear());
    const month = Number(req.query.month || new Date().getMonth() + 1);

    // Rentang tanggal bulan yang diminta (timezone lokal server)
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth   = new Date(year, month, 1);    // exclusive

    const salesUsers = await prisma.user.findMany({
      where: { role: "SALES" },
      orderBy: { name: "asc" },
    });

    const targets = await prisma.salesTarget.findMany({ where: { year, month } });
    const targetMap = Object.fromEntries(targets.map((t) => [t.userId, t.targetValue]));

    const result = await Promise.all(salesUsers.map(async (u) => {
      const orderAgg = await prisma.order.aggregate({
        where: {
          customer: { assignedSalesId: u.id },
          status:   { not: "CANCELLED" },
          createdAt: { gte: startOfMonth, lt: endOfMonth },
        },
        _sum: { value: true },
      });

      const totalOrderValue  = orderAgg._sum.value || 0;
      const target           = targetMap[u.id] ?? 0;
      const percentToTarget  = target > 0 ? Math.round((totalOrderValue / target) * 100) : null;

      return { userId: u.id, name: u.name, avatarUrl: u.avatarUrl, totalOrderValue, target, percentToTarget };
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
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

// Order terbaru (untuk widget "Recent Orders" di Dashboard) — dibuat karena
// belum ada endpoint listing Order langsung, cuma agregat per-customer di
// GET /api/customers (lihat CLAUDE.md/riset dashboard redesign).
analyticsRouter.get("/recent-orders", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 8, 50);
  try {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        items: { orderBy: { sortOrder: "asc" }, select: { layananName: true } },
      },
    });

    const CATEGORY_FALLBACK = { BARU: "Kasur Baru", SEWA: "Kasur Sewa", LAYANAN: "Layanan" };

    const result = orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      customerId: o.customer?.id || null,
      customerName: o.customer?.name || o.customer?.phone || "Pelanggan",
      product: o.items.map((i) => i.layananName).filter(Boolean).join(", ") || CATEGORY_FALLBACK[o.category] || "Layanan",
      category: o.category,
      value: o.value,
      status: o.status,
      hasComplaint: o.hasComplaint,
      createdAt: o.createdAt,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 2B — DASHBOARD BAND 2 ("Sano Intelligence"), 3 endpoint READ-ONLY.
   Semua di bawah requireAuth (router-level, lihat atas). SCOPING per-role:
     ADMIN → seluruh tim; SALES → miliknya + yang belum diambil (claimable).
   TIDAK menyentuh WAHA/SSE/webhook/inbox/schema. Bentuk respons = kontrak di
   frontend features/dashboard/data/contracts.js.
   ═══════════════════════════════════════════════════════════════════════════ */

// Rupiah singkat untuk field `impact` (server tak punya util frontend).
function rpShort(n) {
  const v = n || 0;
  if (v >= 1_000_000) return "Rp" + (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "jt";
  if (v >= 1_000) return "Rp" + Math.round(v / 1_000) + "rb";
  return "Rp" + v;
}

// ── GET /analytics/follow-ups ──────────────────────────────────────────────
// Percakapan OPEN yang pesan TERAKHIRNYA dari customer (INBOUND) = menunggu
// balasan. Semua ditampilkan, diberi severity tier (>1j/>3j/>24j).
analyticsRouter.get("/follow-ups", async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const scope = role === "ADMIN"
      ? {}
      : { OR: [{ assignedToId: userId }, { assignedToId: null }] };

    const convos = await prisma.conversation.findMany({
      where: { status: "OPEN", type: "INDIVIDUAL", ...scope },
      select: {
        id: true, assignedToId: true, lastMessageAt: true, sessionId: true,
        customer: { select: { name: true } },
        assignedTo: { select: { name: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { direction: true, content: true } },
      },
      orderBy: { lastMessageAt: "asc" },
      take: 100,
    });

    const now = Date.now();
    const items = convos
      .filter((c) => c.messages[0]?.direction === "INBOUND") // customer menunggu kita
      .map((c) => {
        const waitingMinutes = Math.floor((now - new Date(c.lastMessageAt).getTime()) / 60000);
        const severity =
          waitingMinutes >= 1440 ? "critical" :
          waitingMinutes >= 180  ? "high" :
          waitingMinutes >= 60   ? "medium" : "low";
        return {
          id: c.id,
          customerName: c.customer?.name || "Tanpa nama",
          preview: c.messages[0]?.content || "",
          waitingMinutes,
          severity,
          nextAction: c.assignedToId ? "Balas" : "Ambil & balas",
          assignedTo: c.assignedTo?.name || null,
          unassigned: !c.assignedToId,
          sessionLabel: c.sessionId || "CS-1",
        };
      })
      .sort((a, b) => b.waitingMinutes - a.waitingMinutes)
      .slice(0, 20);

    res.json({ items });
  } catch (err) {
    console.error("follow-ups error:", err);
    res.status(500).json({ error: "Gagal memuat follow-up" });
  }
});

// ── GET /analytics/hot-leads ───────────────────────────────────────────────
// Skoring TRANSPARAN & bisa diatur — bobot di satu const. Kembalikan score +
// signals + reason + nextAction (bukan skor buram).
const HOT_WEIGHTS = {
  stage:   { QUOTED: 35, QUALIFIED: 20 },
  recency: [[30, 25], [120, 18], [360, 10], [1440, 5]], // [maxMenit, poin]
  intent:  { price: 15, catalog: 10, order: 12 },        // cap total 25
  unansweredBonus: 10,                                    // pesan terakhir INBOUND & nunggu >2j
};
const INTENT_RE = {
  price:   /harga|berapa|price|nego/i,
  catalog: /katalog|foto|gambar|brosur/i,
  order:   /order|beli|pesan|\bdp\b|bayar|checkout/i,
};

analyticsRouter.get("/hot-leads", async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const scope = role === "ADMIN"
      ? {}
      : { OR: [{ assignedSalesId: userId }, { assignedSalesId: null }] };
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

    const customers = await prisma.customer.findMany({
      where: {
        pipelineStage: { in: ["QUALIFIED", "QUOTED"] },
        ...scope,
        conversations: { some: { type: "INDIVIDUAL", lastMessageAt: { gt: sevenDaysAgo } } },
      },
      select: {
        id: true, name: true, phone: true, pipelineStage: true,
        assignedSales: { select: { name: true } },
        orders: { select: { value: true } },
        conversations: {
          where: { type: "INDIVIDUAL" },
          orderBy: { lastMessageAt: "desc" }, take: 1,
          select: {
            lastMessageAt: true, sessionId: true,
            messages: { orderBy: { createdAt: "desc" }, take: 1, select: { direction: true, content: true } },
          },
        },
      },
      take: 80,
    });

    const now = Date.now();
    const items = customers.map((c) => {
      const conv = c.conversations[0];
      const lastMsg = conv?.messages[0];
      const minsSince = conv ? Math.floor((now - new Date(conv.lastMessageAt).getTime()) / 60000) : 99999;
      const valueEstimate = c.orders.reduce((m, o) => Math.max(m, o.value || 0), 0);
      const text = lastMsg?.content || "";
      const signals = [];

      // — skoring transparan —
      let score = HOT_WEIGHTS.stage[c.pipelineStage] || 0;
      if (c.pipelineStage === "QUOTED") signals.push("Sudah dikirim penawaran");
      for (const [maxMin, pts] of HOT_WEIGHTS.recency) { if (minsSince <= maxMin) { score += pts; break; } }

      let intentPts = 0;
      if (INTENT_RE.price.test(text))   { intentPts += HOT_WEIGHTS.intent.price;   signals.push("Tanya harga"); }
      if (INTENT_RE.catalog.test(text)) { intentPts += HOT_WEIGHTS.intent.catalog; signals.push("Minta katalog/foto"); }
      if (INTENT_RE.order.test(text))   { intentPts += HOT_WEIGHTS.intent.order;   signals.push("Sinyal order"); }
      score += Math.min(intentPts, 25);

      const unanswered = lastMsg?.direction === "INBOUND" && minsSince > 120;
      if (unanswered) { score += HOT_WEIGHTS.unansweredBonus; signals.push(`Belum dibalas ${Math.floor(minsSince / 60)}j`); }

      score = Math.max(0, Math.min(100, Math.round(score)));
      const reason = unanswered ? "Sinyal beli, belum di-follow up"
        : c.pipelineStage === "QUOTED" ? "Sudah ditawari, minat tinggi" : "Prospek aktif, minat tinggi";
      const nextAction = INTENT_RE.price.test(text) ? "Follow up — kirim rincian harga"
        : INTENT_RE.catalog.test(text) ? "Kirim katalog + tanyakan ukuran"
        : c.pipelineStage === "QUOTED" ? "Tindak lanjuti penawaran" : "Tawarkan rekomendasi + jadwalkan";

      return {
        id: c.id, name: c.name || "Tanpa nama", phone: c.phone || "",
        stage: c.pipelineStage, score, reason, signals, nextAction,
        valueEstimate,
        assignedTo: c.assignedSales?.name || null,
        lastMessageAt: conv?.lastMessageAt || null,
        sessionLabel: conv?.sessionId || "CS-1",
      };
    })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    res.json({ items });
  } catch (err) {
    console.error("hot-leads error:", err);
    res.status(500).json({ error: "Gagal memuat hot leads" });
  }
});

// ── GET /analytics/recommendations ─────────────────────────────────────────
// Sintesis rule-based (BUKAN LLM) atas sinyal nyata → aksi terurut.
const SEV_RANK = { high: 0, med: 1, low: 2 };

analyticsRouter.get("/recommendations", async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const isAdmin = role === "ADMIN";
    const custScopeRel = isAdmin ? {} : { customer: { assignedSalesId: userId } };
    const convScope = isAdmin ? {} : { OR: [{ assignedToId: userId }, { assignedToId: null }] };
    const now = Date.now();

    // Kumpulkan sinyal (query kecil, paralel).
    const [openConvos, unassignedCount, readyOrders, complaintCount] = await Promise.all([
      prisma.conversation.findMany({
        where: { status: "OPEN", type: "INDIVIDUAL", ...convScope },
        select: { lastMessageAt: true, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { direction: true } } },
        take: 300,
      }),
      prisma.conversation.count({ where: { status: "OPEN", type: "INDIVIDUAL", assignedToId: null } }),
      prisma.order.findMany({ where: { status: "READY", ...custScopeRel }, select: { value: true } }),
      prisma.order.count({ where: { hasComplaint: true, ...custScopeRel } }),
    ]);

    const unansweredOver2h = openConvos.filter(
      (c) => c.messages[0]?.direction === "INBOUND" && (now - new Date(c.lastMessageAt).getTime()) > 2 * 3_600_000
    ).length;

    const items = [];
    if (unansweredOver2h > 0)
      items.push({ id: "followup", type: "followup", severity: "high", count: unansweredOver2h,
        title: `${unansweredOver2h} lead belum di-follow up`, detail: "Pesan terakhir dari customer >2 jam lalu, belum dibalas.",
        actionLabel: "Buka lead", href: "/inbox" });
    if (complaintCount > 0)
      items.push({ id: "complaint", type: "complaint", severity: "high", count: complaintCount,
        title: `${complaintCount} komplain perlu ditangani`, detail: "Komplain butuh telepon langsung — jangan biarkan menunggu.",
        actionLabel: "Lihat", href: "/customers" });
    if (isAdmin && unassignedCount > 0)
      items.push({ id: "unassigned", type: "unassigned", severity: "high", count: unassignedCount,
        title: `${unassignedCount} percakapan belum diambil`, detail: "Masuk antrean, belum ada sales yang klaim.",
        actionLabel: "Ambil sekarang", href: "/inbox" });
    if (readyOrders.length > 0) {
      const sum = readyOrders.reduce((s, o) => s + (o.value || 0), 0);
      items.push({ id: "order", type: "order", severity: "med", count: readyOrders.length,
        title: `${readyOrders.length} order siap dikonfirmasi`, detail: "Status siap kirim — hubungi customer untuk penjadwalan.",
        impact: sum > 0 ? `${rpShort(sum)} menunggu` : undefined, actionLabel: "Lihat order", href: "/customers" });
    }

    // Rule target: rep < 50% dengan sisa hari <= 12 (bulan berjalan).
    const d = new Date();
    const year = d.getFullYear(), month = d.getMonth() + 1;
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);
    const daysLeft = Math.ceil((monthEnd - d) / 86_400_000);
    if (daysLeft <= 12) {
      const targets = await prisma.salesTarget.findMany({
        where: { year, month, targetValue: { gt: 0 }, ...(isAdmin ? {} : { userId }) },
        include: { user: { select: { name: true } } },
      });
      for (const t of targets) {
        const agg = await prisma.order.aggregate({
          _sum: { value: true },
          where: { createdAt: { gte: monthStart, lt: monthEnd }, customer: { assignedSalesId: t.userId } },
        });
        const achieved = agg._sum.value || 0;
        const pct = Math.round((achieved / t.targetValue) * 100);
        if (pct < 50)
          items.push({ id: `target-${t.userId}`, type: "target", severity: "med",
            title: `Target ${t.user?.name || "sales"} ${pct}% · ${daysLeft} hari tersisa`,
            detail: "Perlu dorongan untuk mengejar target bulan ini.",
            impact: `${rpShort(t.targetValue - achieved)} di bawah target`,
            actionLabel: "Lihat performa", href: "/laporan" });
      }
    }

    items.sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
    res.json({ items: items.slice(0, 6) });
  } catch (err) {
    console.error("recommendations error:", err);
    res.status(500).json({ error: "Gagal memuat rekomendasi" });
  }
});
