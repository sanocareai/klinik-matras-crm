import express from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import sharp from "sharp";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { ROLE_PERMISSIONS } from "../constants/permissions.js";
import { rolesOf } from "../middleware/authorize.js";

// Peran valid — sumber kebenaran TUNGGAL adalah kunci ROLE_PERMISSIONS
// (constants/permissions.js), supaya daftar ini tidak pernah drift dari
// peran yang benar-benar dikenal sistem otorisasi.
const VALID_ROLES = Object.keys(ROLE_PERMISSIONS);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const avatarsDir = path.join(__dirname, "../../uploads/avatars");
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

// Upload avatar disimpan sementara di memori (bukan disk) — file ASLI tidak
// pernah ditulis ke disk, langsung dikompres+resize sharp ke ~256px lalu
// disimpan sebagai jpg. Beda dari pola upload.diskStorage di products.js
// karena di sini kita SELALU re-encode filenya (butuh buffer di memori utk
// diproses sharp), tidak sekadar menyimpan file asli apa adanya.
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Hanya file gambar yang diperbolehkan"));
    }
    cb(null, true);
  },
});

export const userRouter = express.Router();
userRouter.use(requireAuth);

// BUG (QA 1 Agustus 2026): SEBELUMNYA `req.user.role !== "ADMIN"` — field
// legacy JWT, bukan `roles` array dari sistem multi-role (D-010). Bikin
// user yang HANYA dapat ADMIN lewat halaman Pengguna & Peran (bukan field
// legacy) ditolak 403 di endpoint ini walau UI-nya sendiri (Pengguna.jsx)
// sudah benar mengizinkan mereka MEMBUKA halamannya — 403 baru muncul saat
// submit, membingungkan. rolesOf() sama dengan yang dipakai requirePermission
// di authorize.js, satu sumber kebenaran.
function adminOnly(req, res, next) {
  if (!rolesOf(req.user).includes("ADMIN")) return res.status(403).json({ error: "Hanya Admin yang bisa melakukan aksi ini" });
  next();
}

// GET / — daftar semua user (termasuk email untuk admin)
//
// `roles` di response adalah daftar peran EFEKTIF (Sano Hub, D-010) —
// dari tabel user_roles kalau user itu punya baris di sana, atau fallback
// ke role tunggal lama (`role`) kalau belum pernah disentuh sistem
// multi-role. Logika fallback ini SAMA PERSIS dengan loadRoles() di
// auth.js — harus tetap sinkron, supaya "role apa yang berlaku" tidak
// pernah berbeda antara halaman login dan halaman Pengguna & Peran.
userRouter.get("/", async (req, res) => {
  try {
    const isAdmin = rolesOf(req.user).includes("ADMIN");
    const [users, roleRows] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: isAdmin,
          role: true,
          avatarUrl: true,
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
      }),
      prisma.userRole.findMany({ select: { userId: true, role: true } }),
    ]);

    const rolesByUser = {};
    for (const r of roleRows) (rolesByUser[r.userId] ??= []).push(r.role);

    const withRoles = users.map((u) => ({
      ...u,
      roles: rolesByUser[u.id]?.length ? rolesByUser[u.id] : [u.role],
    }));
    res.json(withRoles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /me — profil sendiri
userRouter.get("/me", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, role: true, avatarUrl: true, createdAt: true },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — tambah user baru (admin only)
//
// Peran yang dipilih langsung DIMATERIALISASI ke user_roles saat pembuatan
// (bukan cuma diisi ke kolom `role` lama) — supaya user baru tidak pernah
// lewat jalur fallback loadRoles() sama sekali, dan konsisten dengan
// bagaimana /:id/roles mengelola peran untuk user yang sudah ada.
userRouter.post("/", adminOnly, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: "Nama, email, dan password wajib diisi" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password minimal 6 karakter" });
    }
    const chosenRole = role || "SALES";
    if (!VALID_ROLES.includes(chosenRole)) {
      return res.status(400).json({ error: "Peran tidak valid" });
    }

    const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (existing) return res.status(409).json({ error: "Email sudah terdaftar" });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          passwordHash,
          role: chosenRole,
        },
        select: { id: true, name: true, email: true, role: true, avatarUrl: true, createdAt: true },
      });
      await tx.userRole.create({ data: { userId: created.id, role: chosenRole, grantedById: req.user.id } });
      return created;
    });
    res.status(201).json({ ...user, roles: [chosenRole] });
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
      select: { id: true, name: true, email: true, role: true, avatarUrl: true },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /me/avatar — upload foto profil sendiri (multipart, field "file" —
// SAMA dengan field name yang dipakai uploadFile() di mobile/src/api.js).
// Kompres+resize ke ~256px pakai sharp, simpan sebagai jpg di
// backend/uploads/avatars/, hapus file avatar lama (kalau ada) supaya tidak
// menumpuk sampah di disk tiap ganti foto.
userRouter.post("/me/avatar", avatarUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File foto wajib diisi" });

    const filename = `${req.user.id}-${Date.now()}.jpg`;
    const filePath = path.join(avatarsDir, filename);
    await sharp(req.file.buffer)
      .resize(256, 256, { fit: "cover" })
      .jpeg({ quality: 80 })
      .toFile(filePath);

    const avatarUrl = `/uploads/avatars/${filename}`;

    const prevUser = await prisma.user.findUnique({ where: { id: req.user.id }, select: { avatarUrl: true } });
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl },
      select: { id: true, name: true, email: true, role: true, avatarUrl: true },
    });

    if (prevUser?.avatarUrl) {
      const prevPath = path.join(__dirname, "../..", prevUser.avatarUrl);
      fs.unlink(prevPath, () => {}); // fire-and-forget, jangan gagalkan request kalau hapus lama gagal
    }

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
      select: { id: true, name: true, email: true, role: true, avatarUrl: true, createdAt: true },
    });
    res.json(updated);
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "User tidak ditemukan" });
    res.status(500).json({ error: err.message });
  }
});

// Pastikan user punya baris di user_roles SEBELUM dimutasi. Kalau tabel
// masih kosong untuk user ini (belum pernah disentuh sistem multi-role),
// isi dulu dengan role tunggal lamanya — supaya akses yang SUDAH ada tidak
// pernah hilang diam-diam hanya karena admin menambah SATU role baru
// (D-010: aditif, bukan menggantikan). Tanpa langkah ini, begitu tabel
// user_roles punya baris pertama, loadRoles()/rolesOf() berhenti membaca
// kolom `role` lama sama sekali (lihat catatan di authorize.js/auth.js).
async function materializeRoles(userId) {
  const count = await prisma.userRole.count({ where: { userId } });
  if (count > 0) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) return;
  await prisma.userRole.create({ data: { userId, role: user.role } }).catch((err) => {
    if (err.code !== "P2002") throw err; // race benign — baris sudah ada
  });
}

// POST /:id/roles — tambah SATU peran (aditif, D-010). admin only.
userRouter.post("/:id/roles", adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "Tidak bisa mengubah peran sendiri" });
    }
    const { role } = req.body;
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: "Peran tidak valid" });
    }
    await materializeRoles(req.params.id);
    await prisma.userRole.create({
      data: { userId: req.params.id, role, grantedById: req.user.id },
    }).catch((err) => {
      if (err.code !== "P2002") throw err; // sudah punya peran ini — no-op
    });
    const rows = await prisma.userRole.findMany({ where: { userId: req.params.id }, select: { role: true } });
    res.json({ roles: rows.map((r) => r.role) });
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "User tidak ditemukan" });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id/roles/:role — cabut SATU peran. admin only. Menolak kalau ini
// akan menyisakan user tanpa peran sama sekali (akun buntu — tidak dapat
// portal, tidak dapat permission apa pun).
userRouter.delete("/:id/roles/:role", adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "Tidak bisa mengubah peran sendiri" });
    }
    await materializeRoles(req.params.id);
    const count = await prisma.userRole.count({ where: { userId: req.params.id } });
    if (count <= 1) {
      return res.status(400).json({ error: "User harus punya minimal 1 peran" });
    }
    await prisma.userRole.deleteMany({ where: { userId: req.params.id, role: req.params.role } });
    const rows = await prisma.userRole.findMany({ where: { userId: req.params.id }, select: { role: true } });
    res.json({ roles: rows.map((r) => r.role) });
  } catch (err) {
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
