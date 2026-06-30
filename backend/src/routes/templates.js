import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { requireAuth } from "../middleware/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "../../data/templates.json");

export const templateRouter = express.Router();
templateRouter.use(requireAuth);

const DEFAULT_TEMPLATES = [
  {
    id: "tpl-default-1",
    nama: "Salam Pembuka",
    kategori: "pembukaan",
    isi: "Halo! Selamat datang di Klinik Matras. Ada yang bisa kami bantu untuk kebutuhan kasur Anda? 😊",
  },
  {
    id: "tpl-default-2",
    nama: "Follow Up Pelanggan",
    kategori: "follow_up",
    isi: "Halo kak {nama_customer}, kami dari Klinik Matras ingin menanyakan apakah ada yang bisa kami bantu lebih lanjut?",
  },
  {
    id: "tpl-default-3",
    nama: "Konfirmasi Order Diterima",
    kategori: "konfirmasi",
    isi: "Baik kak {nama_customer}, pesanan sudah kami terima. Tim kami akan segera menghubungi untuk penjadwalan. Terima kasih! 🙏",
  },
  {
    id: "tpl-default-4",
    nama: "Order Siap Diambil",
    kategori: "konfirmasi",
    isi: "Kak {nama_customer}, kasur Anda sudah selesai diproses dan siap untuk pengambilan/pengiriman. Mohon konfirmasi waktu yang sesuai. 😊",
  },
  {
    id: "tpl-default-5",
    nama: "Ucapan Terima Kasih",
    kategori: "penutupan",
    isi: "Terima kasih sudah mempercayakan kebutuhan kasur Anda kepada Klinik Matras, kak {nama_customer}. Hubungi kami kembali jika ada yang perlu dibantu! 🌟",
  },
];

function readTemplates() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); }
  catch { return DEFAULT_TEMPLATES; }
}

function writeTemplates(data) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function generateId() {
  return "tpl-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// GET /api/templates
templateRouter.get("/", (req, res) => {
  res.json(readTemplates());
});

// POST /api/templates
templateRouter.post("/", (req, res) => {
  const { nama, kategori, isi } = req.body;
  if (!nama?.trim() || !isi?.trim()) {
    return res.status(400).json({ error: "Nama dan isi template wajib diisi" });
  }
  const templates = readTemplates();
  const tpl = {
    id: generateId(),
    nama: nama.trim(),
    kategori: kategori || "lainnya",
    isi: isi.trim(),
    createdAt: new Date().toISOString(),
  };
  templates.push(tpl);
  writeTemplates(templates);
  res.status(201).json(tpl);
});

// PATCH /api/templates/:id
templateRouter.patch("/:id", (req, res) => {
  const { nama, kategori, isi } = req.body;
  const templates = readTemplates();
  const idx = templates.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Template tidak ditemukan" });

  templates[idx] = {
    ...templates[idx],
    ...(nama !== undefined && { nama: nama.trim() }),
    ...(kategori !== undefined && { kategori }),
    ...(isi !== undefined && { isi: isi.trim() }),
    updatedAt: new Date().toISOString(),
  };
  writeTemplates(templates);
  res.json(templates[idx]);
});

// DELETE /api/templates/:id
templateRouter.delete("/:id", (req, res) => {
  const templates = readTemplates();
  const filtered = templates.filter((t) => t.id !== req.params.id);
  if (filtered.length === templates.length) {
    return res.status(404).json({ error: "Template tidak ditemukan" });
  }
  writeTemplates(filtered);
  res.json({ ok: true });
});
