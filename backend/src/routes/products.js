import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { rolesOf } from "../middleware/authorize.js";

export const productRouter = express.Router();
productRouter.use(requireAuth);

// Sales sekarang boleh menambah produk Galeri sendiri (sebelumnya
// admin-only) supaya tidak perlu minta admin tiap kali ada produk/varian
// baru. TAPI edit/hapus produk tetap dibatasi: admin boleh apa saja, sales
// hanya boleh produk buatannya SENDIRI (createdById) — supaya sales tidak
// bisa mengubah harga/foto produk orang lain (termasuk katalog resmi admin).
async function requireOwnerOrAdmin(req, res, next) {
  if (rolesOf(req.user).includes("ADMIN")) return next();
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) return res.status(404).json({ error: "Produk tidak ditemukan" });
    if (product.createdById !== req.user.id) {
      return res.status(403).json({ error: "Produk ini dibuat orang lain — hanya admin atau pembuatnya yang bisa mengubah/menghapus" });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Sama seperti di atas, tapi untuk route bergantung pada :id GAMBAR
// (image), bukan :id PRODUK — perlu 1 join tambahan untuk cari pemiliknya.
async function requireImageOwnerOrAdmin(req, res, next) {
  if (rolesOf(req.user).includes("ADMIN")) return next();
  try {
    const image = await prisma.productImage.findUnique({
      where: { id: req.params.imageId },
      include: { product: true },
    });
    if (!image) return res.status(404).json({ error: "Gambar tidak ditemukan" });
    if (image.product.createdById !== req.user.id) {
      return res.status(403).json({ error: "Produk ini dibuat orang lain — hanya admin atau pembuatnya yang bisa mengubah/menghapus" });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const productsDir = path.join(__dirname, "../../data/products");
if (!fs.existsSync(productsDir)) fs.mkdirSync(productsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: productsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Hanya file gambar yang diperbolehkan"));
    }
    cb(null, true);
  },
});

// ── GET /api/products — list produk aktif (semua user) ──────────────────────
productRouter.get("/", async (req, res) => {
  try {
    const products = await prisma.product.findMany({
      where: { active: true },
      include: { images: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/products/all — termasuk non-aktif ───────────────────────────────
// Admin melihat SEMUA produk (buatan siapa pun). Sales hanya melihat produk
// buatannya SENDIRI di sini (dipakai halaman "Produk Saya") — daftar aktif
// biasa (GET /) sudah menampilkan produk semua orang yang aktif, jadi endpoint
// ini tidak perlu membocorkan draft/non-aktif milik sales lain.
productRouter.get("/all", async (req, res) => {
  try {
    const isAdmin = rolesOf(req.user).includes("ADMIN");
    const products = await prisma.product.findMany({
      where: isAdmin ? {} : { createdById: req.user.id },
      include: { images: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/products — buat produk baru (semua user login, termasuk sales) ─
productRouter.post("/", async (req, res) => {
  const { name, description, category, price, priceUnit } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nama produk wajib diisi" });
  try {
    const count = await prisma.product.count();
    const product = await prisma.product.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        category: category?.trim() || null,
        price: price ? parseInt(price) : null,
        priceUnit: priceUnit?.trim() || null,
        sortOrder: count,
        createdById: req.user.id,
      },
      include: { images: true },
    });
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/products/:id — update produk (admin, atau sales pembuatnya) ──
productRouter.patch("/:id", requireOwnerOrAdmin, async (req, res) => {
  const { name, description, category, price, priceUnit, active, sortOrder } = req.body;
  const data = {};
  if (name !== undefined)        data.name        = name.trim();
  if (description !== undefined) data.description = description?.trim() || null;
  if (category !== undefined)    data.category    = category?.trim() || null;
  if (price !== undefined)       data.price       = price ? parseInt(price) : null;
  if (priceUnit !== undefined)   data.priceUnit   = priceUnit?.trim() || null;
  if (active !== undefined)      data.active      = !!active;
  if (sortOrder !== undefined)   data.sortOrder   = parseInt(sortOrder);

  try {
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data,
      include: { images: { orderBy: { sortOrder: "asc" } } },
    });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/products/:id — hapus produk (admin, atau sales pembuatnya) ──
productRouter.delete("/:id", requireOwnerOrAdmin, async (req, res) => {
  try {
    const images = await prisma.productImage.findMany({ where: { productId: req.params.id } });
    for (const img of images) {
      const filename = img.url.split("/").pop();
      const filePath = path.join(productsDir, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await prisma.product.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/products/:id/images — upload gambar (admin, atau sales pembuatnya) ─
productRouter.post("/:id/images", requireOwnerOrAdmin, upload.array("images", 10), async (req, res) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) return res.status(404).json({ error: "Produk tidak ditemukan" });

    const files = req.files;
    if (!files?.length) return res.status(400).json({ error: "Tidak ada gambar yang diupload" });

    const existing = await prisma.productImage.count({ where: { productId: req.params.id } });
    const labels   = Array.isArray(req.body.labels) ? req.body.labels : [req.body.labels];

    const created = await Promise.all(files.map((file, i) =>
      prisma.productImage.create({
        data: {
          productId: req.params.id,
          url: `/media/products/${file.filename}`,
          label: labels[i]?.trim() || null,
          sortOrder: existing + i,
        },
      })
    ));
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/products/images/:imageId — update label/urutan (admin, atau sales pembuatnya) ─
productRouter.patch("/images/:imageId", requireImageOwnerOrAdmin, async (req, res) => {
  const { label, sortOrder } = req.body;
  const data = {};
  if (label !== undefined)     data.label     = label?.trim() || null;
  if (sortOrder !== undefined) data.sortOrder = parseInt(sortOrder);
  try {
    const image = await prisma.productImage.update({
      where: { id: req.params.imageId },
      data,
    });
    res.json(image);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/products/images/:imageId — hapus gambar (admin, atau sales pembuatnya) ─
productRouter.delete("/images/:imageId", requireImageOwnerOrAdmin, async (req, res) => {
  try {
    const image = await prisma.productImage.findUnique({ where: { id: req.params.imageId } });
    if (!image) return res.status(404).json({ error: "Gambar tidak ditemukan" });

    const filename = image.url.split("/").pop();
    const filePath = path.join(productsDir, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await prisma.productImage.delete({ where: { id: req.params.imageId } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
