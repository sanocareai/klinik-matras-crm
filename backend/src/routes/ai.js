import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { requireAuth } from "../middleware/auth.js";

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE      = path.join(__dirname, "../../data/ai-models.json");
const SETTINGS_FILE  = path.join(__dirname, "../../data/ai-settings.json");
const FAQ_FILE       = path.join(__dirname, "../../data/faq.json");
const KB_META_FILE   = path.join(__dirname, "../../data/knowledge-meta.json");
const KB_DIR         = path.join(__dirname, "../../data/knowledge");

// Placeholder di system prompt — akan diganti KB context saat chat
const KB_PLACEHOLDER = "[DI SINI: konten Knowledge Base akan disisipkan otomatis oleh sistem]";

export const aiRouter = express.Router();
aiRouter.use(requireAuth);

function getKey() {
  const secret = process.env.JWT_SECRET || "klinikmatras_secret_default";
  return Buffer.from(secret.padEnd(32, "0").slice(0, 32));
}

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

function decrypt(encoded) {
  const [ivHex, encHex] = encoded.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", getKey(), iv);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}

function maskKey(key) {
  if (!key || key.length < 8) return "***";
  return "***" + key.slice(-4);
}

function readModels() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); } catch { return []; }
}
function writeModels(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")); }
  catch { return { personaPrompt: "", useKb: true }; }
}
function writeSettings(data) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

// Ambil snippet relevan dari Knowledge Base berdasarkan query user
async function searchKb(query) {
  const results = [];
  const q = query.toLowerCase().slice(0, 200);
  if (!q) return results;

  // Cari di dokumen
  try {
    const meta = JSON.parse(fs.readFileSync(KB_META_FILE, "utf-8")).filter((d) => d.active);
    for (const doc of meta) {
      try {
        const text = fs.readFileSync(doc.filePath, "utf-8");
        const lines = text.split("\n");
        for (const line of lines) {
          if (line.toLowerCase().includes(q) && line.trim().length > 10) {
            results.push(`[${doc.name}] ${line.trim()}`);
            if (results.length >= 5) break;
          }
        }
      } catch {}
      if (results.length >= 5) break;
    }
  } catch {}

  // Cari di FAQ
  try {
    const faqs = JSON.parse(fs.readFileSync(FAQ_FILE, "utf-8")).filter((f) => f.active !== false);
    for (const faq of faqs) {
      if (faq.question?.toLowerCase().includes(q) || faq.answer?.toLowerCase().includes(q)) {
        results.push(`[FAQ] ${faq.question}: ${faq.answer}`);
        if (results.length >= 8) break;
      }
    }
  } catch {}

  return results;
}

// GET /api/ai/settings — persona prompt + toggle KB
aiRouter.get("/settings", (req, res) => {
  res.json(readSettings());
});

// PUT /api/ai/settings
aiRouter.put("/settings", (req, res) => {
  const current = readSettings();
  const updated = { ...current, ...req.body };
  writeSettings(updated);
  res.json(updated);
});

// GET /api/ai/models — return list dengan key ter-mask
aiRouter.get("/models", (req, res) => {
  const models = readModels().map(({ encryptedKey, ...m }) => ({
    ...m,
    apiKeyMasked: maskKey(encryptedKey ? "xxxxxxxxxxxx" : ""),
    hasKey: !!encryptedKey,
  }));
  res.json(models);
});

// POST /api/ai/models — tambah model baru
aiRouter.post("/models", (req, res) => {
  const { name, provider, apiKey, model } = req.body;
  if (!name || !provider || !apiKey) return res.status(400).json({ error: "Nama, provider, dan API key wajib" });

  const models = readModels();
  const m = {
    id: Date.now().toString(),
    name,
    provider,
    model: model || (provider === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o"),
    encryptedKey: encrypt(apiKey),
    active: true,
    createdAt: new Date().toISOString(),
  };
  models.push(m);
  writeModels(models);
  const { encryptedKey, ...safe } = m;
  res.status(201).json({ ...safe, hasKey: true });
});

// PATCH /api/ai/models/:id
aiRouter.patch("/models/:id", (req, res) => {
  const models = readModels();
  const idx = models.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Model tidak ditemukan" });

  const { apiKey, ...rest } = req.body;
  Object.assign(models[idx], rest, { id: models[idx].id });
  if (apiKey) models[idx].encryptedKey = encrypt(apiKey);
  writeModels(models);

  const { encryptedKey, ...safe } = models[idx];
  res.json({ ...safe, hasKey: !!encryptedKey });
});

// DELETE /api/ai/models/:id
aiRouter.delete("/models/:id", (req, res) => {
  const models = readModels();
  const filtered = models.filter((m) => m.id !== req.params.id);
  if (filtered.length === models.length) return res.status(404).json({ error: "Tidak ditemukan" });
  writeModels(filtered);
  res.json({ ok: true });
});

// POST /api/ai/chat — proxy ke AI provider dengan system prompt + KB injection
// Body: { modelId, messages, systemPrompt?, useKb? }
//   systemPrompt: override persona (opsional, kalau kosong pakai persona di settings)
//   useKb: inject knowledge base context ke system prompt (default: ikut settings)
aiRouter.post("/chat", async (req, res) => {
  const { modelId, messages, systemPrompt: promptOverride, useKb: useKbOverride } = req.body;
  if (!modelId || !messages?.length) return res.status(400).json({ error: "modelId dan messages wajib" });

  const models = readModels();
  const m = models.find((x) => x.id === modelId);
  if (!m) return res.status(404).json({ error: "Model tidak ditemukan" });
  if (!m.encryptedKey) return res.status(400).json({ error: "API key belum dikonfigurasi" });

  let apiKey;
  try { apiKey = decrypt(m.encryptedKey); } catch {
    return res.status(500).json({ error: "Gagal mendekripsi API key" });
  }

  // Tentukan system prompt — pakai override jika ada, kalau tidak pakai persona tersimpan
  const settings  = readSettings();
  let systemPrompt = promptOverride ?? settings.personaPrompt ?? "";
  const useKb      = useKbOverride  ?? settings.useKb ?? true;

  // Inject KB context menggantikan placeholder di system prompt
  if (useKb && systemPrompt.includes(KB_PLACEHOLDER)) {
    const lastUserMsg = [...messages].reverse().find((msg) => msg.role === "user");
    const query = lastUserMsg?.content || "";
    const kbResults = await searchKb(query);
    const kbSection = kbResults.length > 0
      ? "INFORMASI DARI KNOWLEDGE BASE:\n" + kbResults.map((r, i) => `${i + 1}. ${r}`).join("\n")
      : "INFORMASI DARI KNOWLEDGE BASE:\n(Belum ada konten — tambahkan dokumen dan FAQ di halaman Knowledge Base)";
    systemPrompt = systemPrompt.replace(KB_PLACEHOLDER, kbSection);
  }

  try {
    if (m.provider === "anthropic") {
      const reqBody = {
        model: m.model || "claude-sonnet-4-6",
        max_tokens: 1024,
        messages,
      };
      if (systemPrompt.trim()) reqBody.system = systemPrompt;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(reqBody),
      });
      const data = await response.json();
      if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "Error dari Anthropic" });
      res.json({ content: data.content[0]?.text || "" });
    } else {
      res.status(400).json({ error: `Provider "${m.provider}" belum didukung di versi ini` });
    }
  } catch (err) {
    res.status(500).json({ error: "Gagal menghubungi AI provider: " + err.message });
  }
});

// POST /api/ai/test-connection — test API key sebelum disimpan
aiRouter.post("/test-connection", async (req, res) => {
  const { provider, apiKey } = req.body;
  if (!provider || !apiKey) return res.status(400).json({ error: "provider dan apiKey wajib" });

  try {
    if (provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hi" }],
        }),
      });
      if (response.ok) return res.json({ ok: true });
      const d = await response.json();
      res.status(400).json({ error: d.error?.message || "API key tidak valid" });
    } else {
      res.status(400).json({ error: `Provider "${provider}" belum didukung` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
