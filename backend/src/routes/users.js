import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const userRouter = express.Router();
userRouter.use(requireAuth);

// Daftar semua user (untuk dropdown filter & assignment)
userRouter.get("/", async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  res.json(users);
});

// Update profil sendiri (nama — fitur dasar, bisa dikembangkan nanti)
userRouter.patch("/me", async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nama tidak boleh kosong" });

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { name: name.trim() },
    select: { id: true, name: true, role: true },
  });
  res.json(updated);
});
