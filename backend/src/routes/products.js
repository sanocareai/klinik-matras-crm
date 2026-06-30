import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

export const productRouter = express.Router();
productRouter.use(requireAuth);

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
  const products = await prisma.product.findMany({
    where: { active: true },
    include: { images: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  res.json(products);
});

// ── GET /api/products/all — termasuk non-aktif (admin) ──────────────────────
productRouter.get("/all", requireAdmin, async (req, res) => {
  const products = await prisma.product.findMany({
    include: { images: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  res.json(products);
});

// ── POST /api/products — buat produk baru (admin) ───────────────────────────
productRouter.post("/", requireAdmin, async (req, res) => {
  const { name, description, category, price, priceUnit } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nama produk wajib diisi" });
  const count = await prisma.product.count();
  const product = await prisma.product.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      category: category?.trim() || null,
      price: price ? parseInt(price) : null,
      priceUnit: priceUnit?.trim() || null,
      sortOrder: count,
    },
    include: { images: true },
  });
  res.status(201).json(product);
});

// ── PATCH /api/products/:id — update produk (admin) ─────────────────────────
productRouter.patch("/:id", requireAdmin, async (req, res) => {
  const { name, description, category, price, priceUnit, active, sortOrder } = req.body;
  const data = {};
  if (name !== undefined)        data.name        = name.trim();
  if (description !== undefined) data.description = description?.trim() || null;
  if (category !== undefined)    data.category    = category?.trim() || null;
  if (price !== undefined)       data.price       = price ? parseInt(price) : null;
  if (priceUnit !== undefined)   data.priceUnit   = priceUnit?.trim() || null;
  if (active !== undefined)      data.active      = !!active;
  if (sortOrder !== undefined)   data.sortOrder   = parseInt(sortOrder);

  const product = await prisma.product.update({
    where: { id: req.params.id },
    data,
    include: { images: { orderBy: { sortOrder: "asc" } } },
  });
  res.json(product);
});

// ── DELETE /api/products/:id — hapus produk (admin) ─────────────────────────
productRouter.delete("/:id", requireAdmin, async (req, res) => {
  // Hapus file gambar fisik dulu
  const images = await prisma.productImage.findMany({ where: { productId: req.params.id } });
  for (const img of images) {
    const filename = img.url.split("/").pop();
    const filePath = path.join(productsDir, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  await prisma.product.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ── POST /api/products/:id/images — upload gambar (admin) ───────────────────
productRouter.post("/:id/images", requireAdmin, upload.array("images", 10), async (req, res) => {
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
});

// ── PATCH /api/products/images/:imageId — update label/urutan (admin) ───────
productRouter.patch("/images/:imageId", requireAdmin, async (req, res) => {
  const { label, sortOrder } = req.body;
  const data = {};
  if (label !== undefined)     data.label     = label?.trim() || null;
  if (sortOrder !== undefined) data.sortOrder = parseInt(sortOrder);
  const image = await prisma.productImage.update({
    where: { id: req.params.imageId },
    data,
  });
  res.json(image);
});

// ── DELETE /api/products/images/:imageId — hapus gambar (admin) ─────────────
productRouter.delete("/images/:imageId", requireAdmin, async (req, res) => {
  const image = await prisma.productImage.findUnique({ where: { id: req.params.imageId } });
  if (!image) return res.status(404).json({ error: "Gambar tidak ditemukan" });

  const filename = image.url.split("/").pop();
  const filePath = path.join(productsDir, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  await prisma.productImage.delete({ where: { id: req.params.imageId } });
  res.json({ ok: true });
});
