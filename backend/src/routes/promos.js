// Katalog kampanye promo (D-026, 20 Agustus 2026) — mis. "Merdeka dari Sakit
// Pinggang" diskon hingga 17%. Order.promoId cuma PENANDA untuk laporan,
// TIDAK menghitung ulang harga — lihat catatan panjang di schema.prisma.
//
// Siapa saja yang login boleh BACA (dropdown pilih promo di form order milik
// SEMUA sales) — yang admin-only cuma kelola katalognya (create/update).
// Pola sama dengan products.js (Galeri Produk).

import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { rolesOf } from "../middleware/authorize.js";

export const promoRouter = express.Router();
promoRouter.use(requireAuth);

function requireAdmin(req, res, next) {
  if (!rolesOf(req.user).includes("ADMIN")) {
    return res.status(403).json({ error: "Hanya admin yang bisa mengelola promo" });
  }
  next();
}

// GET /api/promos?active=true — daftar promo.
// ?active=true dipakai dropdown form order (cuma tawarkan promo yang
// sedang berjalan) — TANPA parameter itu, admin di Pengaturan > Promo tetap
// lihat SEMUA (termasuk yang sudah nonaktif, untuk riwayat).
//
// `_count.orders` + `orders._sum.value` disertakan SEKALIGUS di sini (bukan
// endpoint /summary terpisah) — daftar promo di production tidak akan
// pernah besar (puluhan, bukan ribuan), jadi satu query gabungan lebih
// simpel daripada dua endpoint yang harus disinkronkan manual di frontend.
promoRouter.get("/", async (req, res) => {
  try {
    const { active } = req.query;
    const promos = await prisma.promo.findMany({
      where: active === "true" ? { active: true } : undefined,
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Omzet per promo — CANCELLED dikecualikan, konsisten dengan seluruh
    // endpoint lain (Pipeline, GET /orders) yang tidak menghitung deal batal
    // sebagai nilai berjalan.
    const sums = await prisma.order.groupBy({
      by: ["promoId"],
      where: { promoId: { not: null }, status: { not: "CANCELLED" } },
      _sum: { value: true },
    });
    const sumByPromo = Object.fromEntries(sums.map((s) => [s.promoId, s._sum.value || 0]));

    res.json(promos.map((p) => ({
      ...p,
      orderCount: p._count.orders,
      totalValue: sumByPromo[p.id] || 0,
      _count: undefined,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/promos { code, name, discountPercent?, validFrom?, validUntil? }
promoRouter.post("/", requireAdmin, async (req, res) => {
  try {
    const { code, name, discountPercent, validFrom, validUntil } = req.body;
    if (!code?.trim())  return res.status(400).json({ error: "Kode promo wajib diisi" });
    if (!name?.trim())  return res.status(400).json({ error: "Nama promo wajib diisi" });

    const promo = await prisma.promo.create({
      data: {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        discountPercent: discountPercent !== undefined && discountPercent !== null && discountPercent !== ""
          ? Number(discountPercent) : null,
        validFrom:  validFrom  ? new Date(validFrom)  : null,
        validUntil: validUntil ? new Date(validUntil) : null,
        createdById: req.user.id,
      },
    });
    res.status(201).json(promo);
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "Kode promo ini sudah dipakai" });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/promos/:id — edit atau nonaktifkan (active: false).
promoRouter.patch("/:id", requireAdmin, async (req, res) => {
  try {
    const { code, name, discountPercent, validFrom, validUntil, active } = req.body;
    const promo = await prisma.promo.update({
      where: { id: req.params.id },
      data: {
        ...(code  !== undefined && { code: code.trim().toUpperCase() }),
        ...(name  !== undefined && { name: name.trim() }),
        ...(discountPercent !== undefined && {
          discountPercent: discountPercent === null || discountPercent === "" ? null : Number(discountPercent),
        }),
        ...(validFrom  !== undefined && { validFrom:  validFrom  ? new Date(validFrom)  : null }),
        ...(validUntil !== undefined && { validUntil: validUntil ? new Date(validUntil) : null }),
        ...(active !== undefined && { active: !!active }),
      },
    });
    res.json(promo);
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "Promo tidak ditemukan" });
    if (err.code === "P2002") return res.status(409).json({ error: "Kode promo ini sudah dipakai" });
    res.status(500).json({ error: err.message });
  }
});
