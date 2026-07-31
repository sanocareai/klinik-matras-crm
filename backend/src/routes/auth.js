import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { portalsFor } from "../middleware/authorize.js";

export const authRouter = express.Router();

// Ambil semua role user dari tabel user_roles (D-010).
//
// `user.role` yang lama TETAP dikirim dan TETAP dipakai kode yang sudah ada
// (requireAdmin, sidebar frontend). Ini penambahan, bukan penggantian —
// mengganti arti field yang dipakai 7 orang di jam kerja bukan langkah Phase 0.
//
// Fallback ke [user.role] kalau tabel user_roles kosong untuk user itu:
// backfill migrasi seharusnya sudah mengisinya, tapi user yang DIBUAT setelah
// migrasi lewat jalur lama (routes/users.js) belum tentu punya barisnya.
// Tanpa fallback, user baru langsung kehilangan seluruh akses.
async function loadRoles(user) {
  const rows = await prisma.userRole.findMany({
    where: { userId: user.id },
    select: { role: true },
  });
  const roles = rows.map((r) => r.role);
  return roles.length > 0 ? roles : [user.role];
}

authRouter.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "Email atau password salah" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Email atau password salah" });

    const roles = await loadRoles(user);

    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role, roles },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        roles,
        avatarUrl: user.avatarUrl,
        portals: portalsFor({ roles }),
      },
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// GET /api/auth/me — identitas + role + portal yang boleh dibuka.
//
// Dipakai landing page portal. Sengaja membaca role dari DATABASE, bukan dari
// token: kalau admin menambah/mencabut role seseorang, perubahannya berlaku
// begitu halaman di-refresh — tidak perlu menunggu token 7 hari kedaluwarsa.
authRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, role: true, avatarUrl: true },
    });
    if (!user) return res.status(401).json({ error: "User tidak ditemukan" });

    const roles = await loadRoles(user);
    res.json({ ...user, roles, portals: portalsFor({ roles }) });
  } catch (err) {
    console.error("Auth me error:", err.message);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});
