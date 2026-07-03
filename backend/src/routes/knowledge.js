import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { VALID_CATEGORIES, CATEGORY_LABELS, appendToKbCategory, countEntries, parseEntries } from "../services/kbQuickAdd.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAQ_FILE   = path.join(__dirname, "../../data/faq.json");
const KB_DIR     = path.join(__dirname, "../../data/knowledge");
const META_FILE  = path.join(__dirname, "../../data/knowledge-meta.json");

// Pastikan direktori ada
if (!fs.existsSync(KB_DIR)) fs.mkdirSync(KB_DIR, { recursive: true });

const upload = multer({
  dest: KB_DIR,
  limits: { fileSize: 5 * 1024 * 1024 }, // max 5MB
  fileFilter: (req, file, cb) => {
    const allowed = [".txt", ".md", ".pdf"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error("Hanya file .txt, .md, dan .pdf yang diizinkan"));
  },
});

export const knowledgeRouter = express.Router();
knowledgeRouter.use(requireAuth);

function readMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, "utf-8")); } catch { return []; }
}
function writeMeta(data) {
  fs.writeFileSync(META_FILE, JSON.stringify(data, null, 2));
}
function readFaq() {
  try { return JSON.parse(fs.readFileSync(FAQ_FILE, "utf-8")); } catch { return []; }
}
function writeFaq(data) {
  fs.writeFileSync(FAQ_FILE, JSON.stringify(data, null, 2));
}

async function extractText(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === ".pdf") {
    try {
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
      const buf = fs.readFileSync(filePath);
      const result = await pdfParse(buf);
      return result.text;
    } catch { return ""; }
  }
  return fs.readFileSync(filePath, "utf-8");
}

// GET /api/knowledge/documents
knowledgeRouter.get("/documents", (req, res) => {
  res.json(readMeta());
});

// POST /api/knowledge/documents — upload file
knowledgeRouter.post("/documents", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "File tidak ditemukan" });

  try {
    const text = await extractText(req.file.path, req.file.originalname);
    const meta = readMeta();
    const doc = {
      id: Date.now().toString(),
      name: req.file.originalname,
      filePath: req.file.path,
      size: req.file.size,
      active: true,
      preview: text.slice(0, 500),
      uploadedAt: new Date().toISOString(),
    };
    meta.push(doc);
    writeMeta(meta);
    res.status(201).json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/knowledge/documents/:id — toggle active
knowledgeRouter.patch("/documents/:id", (req, res) => {
  const meta = readMeta();
  const idx = meta.findIndex((d) => d.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Dokumen tidak ditemukan" });
  Object.assign(meta[idx], req.body, { id: meta[idx].id });
  writeMeta(meta);
  res.json(meta[idx]);
});

// DELETE /api/knowledge/documents/:id
knowledgeRouter.delete("/documents/:id", (req, res) => {
  const meta = readMeta();
  const doc = meta.find((d) => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: "Tidak ditemukan" });

  try { if (doc.filePath && fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath); } catch {}
  writeMeta(meta.filter((d) => d.id !== req.params.id));
  res.json({ ok: true });
});

// GET /api/knowledge/documents/:id/content — isi penuh dokumen
knowledgeRouter.get("/documents/:id/content", async (req, res) => {
  const meta = readMeta();
  const doc = meta.find((d) => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: "Tidak ditemukan" });
  try {
    const text = await extractText(doc.filePath, doc.name);
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/knowledge/search?q=keyword
knowledgeRouter.get("/search", async (req, res) => {
  const q = (req.query.q || "").toLowerCase().trim();
  if (!q) return res.json([]);

  const results = [];
  const meta = readMeta().filter((d) => d.active);

  for (const doc of meta) {
    try {
      const text = await extractText(doc.filePath, doc.name);
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.toLowerCase().includes(q)) {
          results.push({ source: doc.name, docId: doc.id, snippet: line.trim().slice(0, 200) });
          if (results.length >= 10) break;
        }
      }
    } catch {}
  }

  // Juga cari di FAQ
  const faqs = readFaq().filter((f) => f.active !== false);
  for (const faq of faqs) {
    if (faq.question?.toLowerCase().includes(q) || faq.answer?.toLowerCase().includes(q)) {
      results.push({ source: "FAQ", docId: "faq-" + faq.id, snippet: `Q: ${faq.question}\nA: ${faq.answer}` });
    }
  }

  res.json(results);
});

// GET /api/knowledge/faq
knowledgeRouter.get("/faq", (req, res) => {
  res.json(readFaq());
});

// POST /api/knowledge/faq
knowledgeRouter.post("/faq", (req, res) => {
  const { question, answer } = req.body;
  if (!question || !answer) return res.status(400).json({ error: "Pertanyaan dan jawaban wajib diisi" });
  const faqs = readFaq();
  const item = { id: Date.now().toString(), question, answer, active: true, createdAt: new Date().toISOString() };
  faqs.push(item);
  writeFaq(faqs);
  res.status(201).json(item);
});

// PATCH /api/knowledge/faq/:id
knowledgeRouter.patch("/faq/:id", (req, res) => {
  const faqs = readFaq();
  const idx = faqs.findIndex((f) => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "FAQ tidak ditemukan" });
  Object.assign(faqs[idx], req.body, { id: faqs[idx].id });
  writeFaq(faqs);
  res.json(faqs[idx]);
});

// DELETE /api/knowledge/faq/:id
knowledgeRouter.delete("/faq/:id", (req, res) => {
  const faqs = readFaq();
  const filtered = faqs.filter((f) => f.id !== req.params.id);
  if (filtered.length === faqs.length) return res.status(404).json({ error: "Tidak ditemukan" });
  writeFaq(filtered);
  res.json({ ok: true });
});

// POST /api/knowledge/quick-add — ADMIN only, tambah entri ke salah satu 4 kategori tetap
knowledgeRouter.post("/quick-add", (req, res) => {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "Hanya admin yang bisa menambah ke Knowledge Base" });
  }
  const { category, title, content } = req.body;
  if (!category || !title || !content) {
    return res.status(400).json({ error: "category, title, dan content wajib diisi" });
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Kategori tidak valid. Pilih dari: ${VALID_CATEGORIES.join(", ")}` });
  }
  try {
    const entry = appendToKbCategory({ category, title, content, authorName: req.user.name });
    res.status(201).json({ ok: true, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/knowledge/categories — list 4 kategori tetap beserta jumlah entri masing-masing
knowledgeRouter.get("/categories", (req, res) => {
  res.json(
    VALID_CATEGORIES.map((cat) => ({
      category: cat,
      label: CATEGORY_LABELS[cat],
      count: countEntries(cat),
    }))
  );
});

// GET /api/knowledge/categories/:category/entries — daftar entri di satu kategori (terbaru dulu)
knowledgeRouter.get("/categories/:category/entries", (req, res) => {
  const { category } = req.params;
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "Kategori tidak valid" });
  }
  res.json(parseEntries(category));
});
