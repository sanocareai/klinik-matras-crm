import express from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { listSessionNumbers } from "../services/wahaClient.js";

// ── Router publik: GET /r/:slug (redirect ke WhatsApp) ──────────────────────
export const trackingRedirectRouter = express.Router();

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

trackingRedirectRouter.get("/:slug", async (req, res) => {
  const fallbackPhone = process.env.WAHA_BUSINESS_NUMBER || "";
  const fallbackUrl   = fallbackPhone ? `https://wa.me/${fallbackPhone}` : "/";
  try {
    const link = await prisma.trackedLink.findUnique({
      where: { slug: req.params.slug },
    });
    if (!link?.active) {
      return res.redirect(302, fallbackUrl);
    }
    await prisma.clickEvent.create({ data: { trackedLinkId: link.id } });
    const phone = link.targetPhone || fallbackPhone;
    const text  = encodeURIComponent(link.prefilledMessage);
    res.redirect(302, phone ? `https://wa.me/${phone}?text=${text}` : fallbackUrl);
  } catch (err) {
    console.error("[tracking redirect]", err.message);
    res.redirect(302, fallbackUrl);
  }
});

// ── Router admin: /api/tracking/* ───────────────────────────────────────────
export const trackingRouter = express.Router();
trackingRouter.use(requireAuth, requireAdmin);

// GET /api/tracking/links — list semua tracked link
trackingRouter.get("/links", async (req, res) => {
  try {
    const links = await prisma.trackedLink.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { clicks: true } },
      },
    });

    // Nomor yang benar-benar terdaftar di WAHA — untuk memperingatkan link
    // yang mengarah ke nomor tidak ada (lihat listSessionNumbers). null =
    // WAHA tidak bisa dihubungi, JANGAN tuduh link-nya salah.
    const nomorTerdaftar = await listSessionNumbers();
    const fallbackPhone = process.env.WAHA_BUSINESS_NUMBER || "";

    // Hitung jumlah klik yang berhasil dicocokkan ke customer (konversi)
    const result = await Promise.all(links.map(async (link) => {
      const converted = await prisma.clickEvent.count({
        where: { trackedLinkId: link.id, matchedCustomerId: { not: null } },
      });

      // targetPhone kosong = pakai WAHA_BUSINESS_NUMBER dari .env
      const effectivePhone = link.targetPhone || fallbackPhone;
      let phoneStatus = "TIDAK_DIKETAHUI";
      if (nomorTerdaftar) {
        if (!effectivePhone) phoneStatus = "KOSONG";
        else phoneStatus = nomorTerdaftar.includes(effectivePhone) ? "OK" : "TIDAK_TERDAFTAR";
      }

      return {
        ...link,
        effectivePhone,
        phoneFromFallback: !link.targetPhone,
        phoneStatus,
        totalClicks:   link._count.clicks,
        totalConverted: converted,
        convRate:      link._count.clicks > 0
          ? Math.round((converted / link._count.clicks) * 100)
          : 0,
      };
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tracking/links — buat tracking link baru
trackingRouter.post("/links", async (req, res) => {
  const { name, category, prefilledMessage, targetPhone, slug: rawSlug } = req.body;
  if (!name?.trim())     return res.status(400).json({ error: "Nama link wajib diisi" });
  if (!category)         return res.status(400).json({ error: "Kategori wajib dipilih" });

  const slug = rawSlug?.trim() ? slugify(rawSlug.trim()) : slugify(name.trim());
  if (!slug) return res.status(400).json({ error: "Slug tidak valid" });

  try {
    const link = await prisma.trackedLink.create({
      data: {
        slug,
        name: name.trim(),
        category,
        prefilledMessage: prefilledMessage?.trim() || "Halo Sano, saya mau konsultasi",
        targetPhone: targetPhone?.trim() || null,
      },
    });
    res.status(201).json({ ...link, totalClicks: 0, totalConverted: 0, convRate: 0 });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: `Slug "${slug}" sudah digunakan, coba nama yang berbeda` });
    }
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tracking/links/:id — update link
//
// SLUG BOLEH DIUBAH, TAPI SADARI RISIKONYA. Slug adalah alamat yang sudah
// dipublikasikan ke Google Ads/Meta. Kalau link sudah terpasang di iklan
// yang berjalan lalu slug-nya diganti, URL lama TIDAK error — dia diam-diam
// jatuh ke redirect fallback tanpa mencatat klik dan tanpa pesan prefilled.
// Customer tetap sampai ke WhatsApp, jadi dari luar terlihat normal, tapi
// atribusi campaign itu mati total tanpa ada yang sadar.
//
// Karena itu penggantian slug pada link YANG SUDAH PERNAH DIKLIK wajib
// disertai `confirmSlugChange: true` — biar tidak pernah terjadi karena
// tidak sengaja. Link yang belum pernah diklik (baru dibuat, belum
// dipasang di mana-mana) bebas diganti.
trackingRouter.patch("/links/:id", async (req, res) => {
  const { name, category, prefilledMessage, targetPhone, active, slug: rawSlug, confirmSlugChange } = req.body;
  const data = {};
  if (name !== undefined)             data.name             = name.trim();
  if (category !== undefined)         data.category         = category;
  if (prefilledMessage !== undefined) data.prefilledMessage = prefilledMessage?.trim() || "Halo Sano, saya mau konsultasi";
  if (targetPhone !== undefined)      data.targetPhone      = targetPhone?.trim() || null;
  if (active !== undefined)           data.active           = !!active;

  try {
    const existing = await prisma.trackedLink.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { clicks: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Link tidak ditemukan" });

    if (rawSlug !== undefined) {
      const slug = slugify(String(rawSlug).trim());
      if (!slug) return res.status(400).json({ error: "Slug tidak valid" });
      if (slug !== existing.slug) {
        if (existing._count.clicks > 0 && !confirmSlugChange) {
          return res.status(409).json({
            error: `Link ini sudah diklik ${existing._count.clicks}x — kemungkinan sudah terpasang di iklan yang berjalan. `
                 + `Mengganti slug akan mematikan pelacakan dari iklan itu tanpa pesan error. `
                 + `Pastikan URL di platform iklan ikut diperbarui, lalu ulangi dengan konfirmasi.`,
            needsConfirmation: true,
            totalClicks: existing._count.clicks,
          });
        }
        data.slug = slug;
      }
    }

    const link = await prisma.trackedLink.update({ where: { id: req.params.id }, data });
    res.json(link);
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Slug itu sudah dipakai link lain, pilih yang berbeda" });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tracking/links/:id
trackingRouter.delete("/links/:id", async (req, res) => {
  try {
    await prisma.clickEvent.deleteMany({ where: { trackedLinkId: req.params.id } });
    await prisma.trackedLink.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tracking/links/:id/stats
trackingRouter.get("/links/:id/stats", async (req, res) => {
  try {
    const link = await prisma.trackedLink.findUnique({ where: { id: req.params.id } });
    if (!link) return res.status(404).json({ error: "Link tidak ditemukan" });

    const [totalClicks, totalConverted] = await Promise.all([
      prisma.clickEvent.count({ where: { trackedLinkId: req.params.id } }),
      prisma.clickEvent.count({ where: { trackedLinkId: req.params.id, matchedCustomerId: { not: null } } }),
    ]);

    res.json({
      link,
      totalClicks,
      totalConverted,
      convRate: totalClicks > 0 ? Math.round((totalConverted / totalClicks) * 100) : 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
