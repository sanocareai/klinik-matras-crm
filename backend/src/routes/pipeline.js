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
      },
      orderBy: { updatedAt: "desc" },
    });

    const now = Date.now();
    const STAGES = ["LEAD", "QUALIFIED", "QUOTED", "WON", "LOST"];

    const board = {};
    STAGES.forEach((s) => { board[s] = []; });

    customers.forEach(({ orders, ...c }) => {
      const stage = c.pipelineStage || "LEAD";
      const daysSince = Math.floor((now - new Date(c.updatedAt).getTime()) / 86_400_000);
      const totalValue = orders.reduce((sum, o) => sum + o.value, 0);
      if (!board[stage]) board[stage] = [];
      board[stage].push({ ...c, orderCount: orders.length, totalValue, daysSince });
    });

    res.json(board);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
