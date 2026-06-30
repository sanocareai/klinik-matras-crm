import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

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
