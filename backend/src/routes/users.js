import express from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

export const userRouter = express.Router();
userRouter.use(requireAuth);

function adminOnly(req, res, next) {
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Hanya Admin yang bisa melakukan aksi ini" });
  next();
}

// GET / — daftar semua user (termasuk email untuk admin)
userRouter.get("/", async (req, res) => {
  try {
    const isAdmin = req.user.role === "ADMIN";
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: isAdmin,
        role: true,
        createdAt: true,
        _count: {
          select: {
            notes: true,
            assignedCustomers: true,
            assignedConversations: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /me — profil sendiri
userRouter.get("/me", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — tambah user baru (admin only)
userRouter.post("/", adminOnly, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: "Nama, email, dan password wajib diisi" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password minimal 6 karakter" });
    }

    const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (existing) return res.status(409).json({ error: "Email sudah terdaftar" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        passwordHash,
        role: role || "SALES",
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /me — update profil sendiri
userRouter.patch("/me", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Nama tidak boleh kosong" });

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { name: name.trim() },
      select: { id: true, name: true, email: true, role: true },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /me/push-token — daftarkan Expo Push Token dari aplikasi mobile
// Upsert: token sama didaftar ulang tidak apa-apa, pindah user pun ditimpa
userRouter.post("/me/push-token", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token?.startsWith("ExponentPushToken")) {
      return res.status(400).json({ error: "Token push tidak valid" });
    }
    await prisma.pushToken.upsert({
      where:  { token },
      update: { userId: req.user.id },
      create: { token, userId: req.user.id },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /me/push-token — hapus token saat logout (device berhenti terima notif)
userRouter.delete("/me/push-token", async (req, res) => {
  try {
    const { token } = req.body;
    if (token) await prisma.pushToken.deleteMany({ where: { token } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /me/change-password — ganti password sendiri
userRouter.post("/me/change-password", async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Password lama dan baru wajib diisi" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password baru minimal 6 karakter" });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ error: "Password lama salah" });

    await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id — update user oleh admin (nama, role)
userRouter.patch("/:id", adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "Gunakan endpoint /me untuk update profil sendiri" });
    }
    const { name, role } = req.body;
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(name?.trim() && { name: name.trim() }),
        ...(role && { role }),
      },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    res.json(updated);
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "User tidak ditemukan" });
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/reset-password — reset password user oleh admin
userRouter.post("/:id/reset-password", adminOnly, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Password baru minimal 6 karakter" });
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "User tidak ditemukan" });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — hapus user (admin only, tidak bisa hapus diri sendiri)
userRouter.delete("/:id", adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "Tidak bisa menghapus akun sendiri" });
    }

    // Cek apakah user punya catatan (Note) — tidak bisa dihapus jika ada
    const noteCount = await prisma.note.count({ where: { authorId: req.params.id } });
    if (noteCount > 0) {
      return res.status(409).json({
        error: `User ini memiliki ${noteCount} catatan. Pindahkan atau hapus catatan tersebut terlebih dahulu.`
      });
    }

    // Set null dulu pada relasi opsional, lalu hapus
    await prisma.customer.updateMany({ where: { assignedSalesId: req.params.id }, data: { assignedSalesId: null } });
    await prisma.conversation.updateMany({ where: { assignedToId: req.params.id }, data: { assignedToId: null } });
    await prisma.user.delete({ where: { id: req.params.id } });

    res.json({ ok: true });
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "User tidak ditemukan" });
    res.status(500).json({ error: err.message });
  }
});
