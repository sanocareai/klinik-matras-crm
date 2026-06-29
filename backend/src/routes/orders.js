import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const orderRouter = express.Router();
orderRouter.use(requireAuth);

orderRouter.patch("/:id", async (req, res) => {
  const { status, value, quantity, notes } = req.body;
  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: {
      ...(status !== undefined && { status }),
      ...(value !== undefined && { value: Number(value) }),
      ...(quantity !== undefined && { quantity: Number(quantity) }),
      ...(notes !== undefined && { notes }),
    },
  });
  res.json(order);
});
