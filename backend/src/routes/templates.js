import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { rolesOf } from "../middleware/authorize.js";

export const templateRouter = express.Router();
templateRouter.use(requireAuth);

// Revisi 26 Jul 2026: dulu file JSON polos (backend/data/templates.json),
// SEMUA user baca/tulis file yang SAMA tanpa kepemilikan — race condition
// nyata kalau 2 sales edit bersamaan (write terakhir menang, yang lain
// hilang tanpa jejak). Sekarang tabel MessageTemplate dengan kepemilikan
// eksplisit. Isi lama dipindah lewat scripts/migrate-templates-json.js.
// Lihat catatan panjang di schema.prisma.
//
// SKEMA VISIBILITAS:
//   - isShared=true  → "Template Tim": semua user bisa PAKAI, HANYA ADMIN
//     yang boleh membuat/mengedit/menghapus (kontinuitas nada komunikasi
//     perusahaan).
//   - isShared=false → "Template Saya": pribadi milik authorId, hanya
//     pemiliknya (atau ADMIN) yang boleh mengedit/menghapus.

function bisaKelola(tpl, user) {
  if (rolesOf(user).includes("ADMIN")) return true;
  return !tpl.isShared && tpl.authorId === user.id;
}

// GET /api/templates — Template Tim (isShared) + Template Saya (milik user
// yang login). SALES tidak pernah melihat template pribadi sales lain.
templateRouter.get("/", async (req, res) => {
  try {
    const templates = await prisma.messageTemplate.findMany({
      where: { OR: [{ isShared: true }, { authorId: req.user.id }] },
      include: { author: { select: { id: true, name: true } } },
      orderBy: [{ isShared: "desc" }, { createdAt: "asc" }],
    });
    res.json(templates.map((t) => ({ ...t, canManage: bisaKelola(t, req.user) })));
  } catch (err) {
    console.error("templates list error:", err);
    res.status(500).json({ error: "Gagal memuat template" });
  }
});

// POST /api/templates
// isShared HANYA dihormati kalau pengirimnya ADMIN — dipaksa di server
// (bukan cuma disembunyikan di UI), supaya SALES tidak bisa menambah ke
// daftar Template Tim lewat request API langsung.
templateRouter.post("/", async (req, res) => {
  const { nama, kategori, isi, isShared } = req.body;
  if (!nama?.trim() || !isi?.trim()) {
    return res.status(400).json({ error: "Nama dan isi template wajib diisi" });
  }
  try {
    const shared = rolesOf(req.user).includes("ADMIN") && !!isShared;
    const tpl = await prisma.messageTemplate.create({
      data: {
        nama: nama.trim(),
        kategori: kategori || "lainnya",
        isi: isi.trim(),
        isShared: shared,
        // Template TIM sengaja authorId=null (milik company, bukan 1
        // orang) — konsisten dengan template lama yang dimigrasikan lewat
        // scripts/migrate-templates-json.js.
        authorId: shared ? null : req.user.id,
      },
      include: { author: { select: { id: true, name: true } } },
    });
    res.status(201).json({ ...tpl, canManage: true });
  } catch (err) {
    console.error("template create error:", err);
    res.status(500).json({ error: "Gagal membuat template" });
  }
});

// PATCH /api/templates/:id — hanya pemilik (template pribadi) atau ADMIN.
templateRouter.patch("/:id", async (req, res) => {
  const { nama, kategori, isi, isShared } = req.body;
  try {
    const existing = await prisma.messageTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Template tidak ditemukan" });
    if (!bisaKelola(existing, req.user)) {
      return res.status(403).json({ error: "Ini bukan template Anda" });
    }

    const tpl = await prisma.messageTemplate.update({
      where: { id: req.params.id },
      data: {
        ...(nama     !== undefined && { nama: nama.trim() }),
        ...(kategori !== undefined && { kategori }),
        ...(isi      !== undefined && { isi: isi.trim() }),
        // Ubah status shared HANYA boleh ADMIN — sales tidak bisa
        // "mempromosikan" template pribadinya jadi milik tim sendiri.
        ...(isShared !== undefined && rolesOf(req.user).includes("ADMIN") && {
          isShared: !!isShared,
          authorId: isShared ? null : existing.authorId,
        }),
      },
      include: { author: { select: { id: true, name: true } } },
    });
    res.json({ ...tpl, canManage: true });
  } catch (err) {
    console.error("template update error:", err);
    res.status(500).json({ error: "Gagal memperbarui template" });
  }
});

// DELETE /api/templates/:id — hanya pemilik (template pribadi) atau ADMIN.
templateRouter.delete("/:id", async (req, res) => {
  try {
    const existing = await prisma.messageTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Template tidak ditemukan" });
    if (!bisaKelola(existing, req.user)) {
      return res.status(403).json({ error: "Ini bukan template Anda" });
    }
    await prisma.messageTemplate.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("template delete error:", err);
    res.status(500).json({ error: "Gagal menghapus template" });
  }
});
