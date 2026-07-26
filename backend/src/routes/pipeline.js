import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const pipelineRouter = express.Router();
pipelineRouter.use(requireAuth);

// GET /api/pipeline/board — pelanggan dikelompokkan per pipeline stage
pipelineRouter.get("/board", async (req, res) => {
  try {
    const customers = await prisma.customer.findMany({
      include: {
        orders: true,
        assignedSales: { select: { id: true, name: true } },
        // `id` percakapan terakhir dipilih supaya kartu Kanban bisa deep-link
        // langsung ke chat customer (?conv=<id>) — sebelumnya kartu tidak
        // punya jalan ke Inbox sama sekali, sales harus mencari manual.
        // type INDIVIDUAL: grup WA internal bukan percakapan customer.
        conversations: {
          where: { type: "INDIVIDUAL" },
          orderBy: { lastMessageAt: "desc" },
          take: 1,
          select: { id: true, lastMessageAt: true, unreadCount: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const now = Date.now();
    const STAGES = ["NEW", "QUALIFIED", "QUOTED", "BOOKED", "SCHEDULED", "COMPLETED", "PAID", "REVIEWED"];

    const board = {};
    STAGES.forEach((s) => { board[s] = []; });

    customers.forEach(({ orders, conversations, ...c }) => {
      const stage = c.pipelineStage || "NEW";
      const daysSince = Math.floor((now - new Date(c.updatedAt).getTime()) / 86_400_000);
      // CANCELLED dikecualikan dari nilai — konsisten dengan seluruh endpoint
      // lain (analytics, sales-report, GET /customers). Tanpa ini, total per
      // kolom Kanban (dan nilai di tiap kartu) bisa menghitung uang dari deal
      // yang sudah batal seolah masih berjalan.
      const ordersAktif = orders.filter((o) => o.status !== "CANCELLED");
      const totalValue = ordersAktif.reduce((sum, o) => sum + o.value, 0);
      const conv = conversations?.[0] || null;
      if (!board[stage]) board[stage] = [];
      board[stage].push({
        ...c,
        orderCount: ordersAktif.length,
        totalValue,
        daysSince,
        conversationId: conv?.id || null,
        lastMessageAt: conv?.lastMessageAt || null,
        unreadCount: conv?.unreadCount || 0,
        // Status order TERBARU — supaya kartu Kanban menunjukkan tahap
        // pengerjaan, bukan cuma stage penjualan. Dua hal berbeda: customer
        // bisa PAID sementara kasurnya masih PROCESSING.
        latestOrderStatus: orders.length
          ? orders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0].status
          : null,
      });
    });

    res.json(board);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
