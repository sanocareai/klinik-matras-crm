import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { requireAuth } from "../middleware/auth.js";
import { buildCoPilotPrompt } from "../services/coPilotPrompt.js";
import { detectHandoverSignal, generateHandoverSummary } from "../services/handoverDetector.js";
import { AI_MODELS } from "../config/aiModels.js";
import { chatWithModel, logChatUsage } from "../services/providers/index.js";
import { KNOWLEDGE_TOOLS } from "../services/knowledgeTools.js";
import * as openaiProvider  from "../services/providers/openaiProvider.js";
import * as geminiProvider  from "../services/providers/geminiProvider.js";
import { prisma } from "../db.js";

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE      = path.join(__dirname, "../../data/ai-models.json");
const SETTINGS_FILE  = path.join(__dirname, "../../data/ai-settings.json");
const FAQ_FILE       = path.join(__dirname, "../../data/faq.json");
const KB_DIR         = path.join(__dirname, "../../data/knowledge");
// meta.json di dalam KB_DIR agar konsisten dengan volume-mount di knowledge.js
const KB_META_FILE   = path.join(KB_DIR, "meta.json");

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

// Bangun konteks KB lengkap dari semua sumber aktif
// Dibaca seluruhnya (bukan keyword search) agar AI punya konteks penuh
async function buildKbContext() {
  const parts = [];

  // 1. Dokumen yang di-upload (maks 2000 char/dok)
  try {
    const meta = JSON.parse(fs.readFileSync(KB_META_FILE, "utf-8")).filter((d) => d.active);
    for (const doc of meta) {
      try {
        const resolvedPath = path.isAbsolute(doc.filePath)
          ? doc.filePath
          : path.join(KB_DIR, doc.filePath);
        const text = fs.readFileSync(resolvedPath, "utf-8");
        if (text.trim()) parts.push(`--- Dokumen: ${doc.name} ---\n${text.slice(0, 2000)}`);
      } catch {}
    }
  } catch {}

  // 2. FAQ
  try {
    const faqs = JSON.parse(fs.readFileSync(FAQ_FILE, "utf-8")).filter((f) => f.active !== false);
    if (faqs.length) {
      parts.push(`--- FAQ ---\n` + faqs.map((f) => `T: ${f.question}\nJ: ${f.answer}`).join("\n\n"));
    }
  } catch {}

  // 3. 4 kategori quick-add (maks 3000 char/file)
  const CAT_FILES = {
    "konsep-istilah-teknis.md": "Konsep & Istilah Teknis",
    "dunia-kasur-umum.md":      "Dunia Kasur Umum",
    "faq-tambahan.md":          "FAQ Tambahan",
    "insight-lapangan.md":      "Insight Lapangan",
  };
  for (const [filename, label] of Object.entries(CAT_FILES)) {
    try {
      const fp = path.join(KB_DIR, filename);
      if (!fs.existsSync(fp)) continue;
      const text = fs.readFileSync(fp, "utf-8").trim();
      if (!text.includes("\n## ")) continue; // skip kalau belum ada entri
      parts.push(`--- ${label} ---\n${text.slice(0, 3000)}`);
    } catch {}
  }

  if (!parts.length) return "";
  return `=== KNOWLEDGE BASE KLINIK MATRAS ===\n\n${parts.join("\n\n")}\n\n=== AKHIR KNOWLEDGE BASE ===`;
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

// GET /api/ai/playground/:modelConfigId/messages — riwayat chat Playground untuk 1 model
aiRouter.get("/playground/:modelConfigId/messages", async (req, res) => {
  try {
    const msgs = await prisma.playgroundMessage.findMany({
      where: { modelConfigId: req.params.modelConfigId },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/ai/playground/:modelConfigId/messages — hapus semua riwayat untuk 1 model
aiRouter.delete("/playground/:modelConfigId/messages", async (req, res) => {
  try {
    await prisma.playgroundMessage.deleteMany({
      where: { modelConfigId: req.params.modelConfigId },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/chat — proxy ke AI provider dengan system prompt + KB injection
// Body: { modelId, messages, systemPrompt?, useKb?, saveHistory?, modelMeta? }
//   systemPrompt: override persona (opsional, kalau kosong pakai persona di settings)
//   useKb: inject knowledge base context ke system prompt (default: ikut settings)
//   saveHistory: kalau true, simpan pesan ke PlaygroundMessage (AI Playground only)
aiRouter.post("/chat", async (req, res) => {
  const { modelId, messages, systemPrompt: promptOverride, useKb: useKbOverride, saveHistory, modelMeta } = req.body;
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

  // Inject seluruh KB ke system prompt kalau useKb aktif
  if (useKb) {
    const kbContext = await buildKbContext();
    if (kbContext) {
      // Kalau persona kosong, pakai instruksi default
      const base = systemPrompt.trim() ||
        "Kamu adalah asisten Klinik Matras yang ahli kasur sehat. Jawab HANYA berdasarkan informasi di Knowledge Base di atas. Kalau tidak ada informasi yang relevan, katakan dengan jujur.";
      // Bersihkan placeholder lama kalau masih ada
      const clean = base.replace(/\[DI SINI: konten Knowledge Base akan disisipkan otomatis oleh sistem\]/g, "").trim();
      systemPrompt = `${kbContext}\n\n---\n\n${clean}`;
    }
  }

  // Bersihkan messages — buang field UI-only (modelName, modelProvider, modelStr, dll)
  // yang ada di state frontend tapi ditolak oleh provider API
  const cleanMessages = messages.map(({ role, content }) => ({ role, content }));

  try {
    const { reply, usage } = await chatWithModel({
      provider:     m.provider,
      apiKey,
      model:        m.model || AI_MODELS.SANO_CHATBOT,
      systemPrompt,
      messages:     cleanMessages,
    });
    logChatUsage("/chat", m.provider, m.model, usage);

    // Simpan riwayat ke DB kalau diminta (AI Playground)
    if (saveHistory) {
      const lastUserMsg = messages[messages.length - 1];
      prisma.playgroundMessage.createMany({
        data: [
          { modelConfigId: modelId, role: "user", content: lastUserMsg.content },
          { modelConfigId: modelId, role: "assistant", content: reply,
            modelName: modelMeta?.name || null,
            modelProvider: m.provider,
            modelStr: m.model || null },
        ],
      }).catch((e) => console.error("[Playground] Gagal simpan riwayat:", e.message));
    }

    res.json({ content: reply });
  } catch (err) {
    res.status(500).json({ error: "Gagal menghubungi AI provider: " + err.message });
  }
});

// POST /api/ai/copilot-chat — AI Co-pilot internal untuk sales
// Body: { message, conversationHistory: [{role, content}], modelId? }
// modelId opsional — kalau tidak dikirim, pakai model aktif manapun yang ada API key
aiRouter.post("/copilot-chat", async (req, res) => {
  const { message, conversationHistory = [], modelId } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: "Pesan tidak boleh kosong" });

  const models = readModels();
  const m = (modelId && models.find((x) => x.id === modelId && x.encryptedKey))
         || models.find((x) => x.active && x.encryptedKey);
  if (!m) {
    return res.status(400).json({
      error: "Belum ada model AI yang dikonfigurasi. Silakan tambah model di menu Otomasi → AI Playground → Kelola Model.",
    });
  }

  let apiKey;
  try { apiKey = decrypt(m.encryptedKey); } catch {
    return res.status(500).json({ error: "Gagal membaca API key" });
  }

  let systemPrompt;
  try { systemPrompt = await buildCoPilotPrompt(req.user?.role); } catch (err) {
    return res.status(500).json({ error: "Gagal membangun prompt: " + err.message });
  }

  const kbContext = await buildKbContext();
  if (kbContext) systemPrompt = `${kbContext}\n\n---\n\n${systemPrompt}`;

  const messages = [
    ...conversationHistory.map(({ role, content }) => ({ role, content })),
    { role: "user", content: message },
  ];

  // KB tools hanya untuk ADMIN — berlaku di provider apapun
  const tools = req.user?.role === "ADMIN" ? KNOWLEDGE_TOOLS : [];

  try {
    const { reply, toolMeta } = await chatWithModel({
      provider:     m.provider,
      apiKey,
      model:        m.model || AI_MODELS.SANO_COPILOT,
      systemPrompt,
      messages,
      tools,
      user:         req.user,
    });
    res.json({ reply, toolMeta: toolMeta || null });
  } catch (err) {
    res.status(500).json({ error: "Gagal menghubungi AI: " + err.message });
  }
});

// POST /api/ai/handover-check — simulasi deteksi sinyal handover (SANDBOX ONLY — Fase C)
// ⚠️  Endpoint ini murni untuk testing di AI Playground. Belum tersambung ke WAHA/WhatsApp.
// Body: { messages: [{role, content}] }
aiRouter.post("/handover-check", async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages wajib diisi" });
  }

  const models = readModels();
  const m = models.find((x) => x.active && x.provider === "anthropic" && x.encryptedKey);
  if (!m) {
    return res.status(400).json({ error: "Belum ada model AI yang dikonfigurasi" });
  }

  let apiKey;
  try { apiKey = decrypt(m.encryptedKey); } catch {
    return res.status(500).json({ error: "Gagal membaca API key" });
  }

  const modelId = m.model || "claude-sonnet-4-6";

  try {
    const detection = await detectHandoverSignal(messages, apiKey, modelId);

    if (!detection.shouldHandover) {
      return res.json({ shouldHandover: false });
    }

    // Kalau sinyal terdeteksi, generate ringkasan otomatis untuk sales
    const summary = await generateHandoverSummary(
      messages, detection.reason, detection.priority, apiKey, modelId
    );

    res.json({ ...detection, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/draft-reply — generate 1 kalimat pembuka natural untuk sales (Context Banner)
// Body: { conversationHistory: [{role, content}], handoverNote? }
aiRouter.post("/draft-reply", async (req, res) => {
  const { conversationHistory = [], handoverNote = "" } = req.body;

  const models = readModels();
  const m = models.find((x) => x.active && x.provider === "anthropic" && x.encryptedKey);
  if (!m) return res.status(400).json({ error: "Belum ada model AI yang dikonfigurasi" });

  let apiKey;
  try { apiKey = decrypt(m.encryptedKey); }
  catch { return res.status(500).json({ error: "Gagal membaca API key" }); }

  const contextBlock = handoverNote ? `\n\nKonteks handover:\n${handoverNote}` : "";

  const systemPrompt =
    `Kamu adalah asisten sales Klinik Matras. Berdasarkan riwayat percakapan, ` +
    `buatkan SATU kalimat pembuka yang natural untuk melanjutkan. ` +
    `JANGAN menyapa ulang dari nol. JANGAN menanyakan hal yang sudah diketahui dari riwayat. ` +
    `Langsung lanjutkan dari konteks terakhir dengan hangat. ` +
    `Jawab HANYA dengan kalimat yang akan dikirim ke customer, tanpa penjelasan tambahan.` +
    contextBlock;

  const messages = [
    ...conversationHistory.slice(-10).map(({ role, content }) => ({ role, content })),
    { role: "user", content: "Buatkan 1 kalimat pembuka untuk melanjutkan percakapan ini." },
  ];

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: m.model || "claude-sonnet-4-6",
        max_tokens: 150,
        system: systemPrompt,
        messages,
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "Error dari AI" });
    res.json({ draft: data.content[0]?.text?.trim() || "" });
  } catch (err) {
    res.status(500).json({ error: "Gagal menghubungi AI: " + err.message });
  }
});

// GET /api/ai/debug-context — khusus ADMIN, lihat isi KB yang terbaca AI
aiRouter.get("/debug-context", (req, res, next) => {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Hanya admin" });
  next();
}, async (req, res) => {
  try {
    const kbContext = await buildKbContext();
    res.json({ kbContext, length: kbContext.length, isEmpty: kbContext.trim() === "" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/test-connection — test API key sebelum disimpan
aiRouter.post("/test-connection", async (req, res) => {
  const { provider, apiKey, model } = req.body;
  if (!provider || !apiKey) return res.status(400).json({ error: "provider dan apiKey wajib" });

  try {
    if (provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: model || "claude-haiku-4-5-20251001",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hi" }],
        }),
      });
      if (response.ok) return res.json({ ok: true });
      const d = await response.json();
      res.status(400).json({ error: d.error?.message || "API key tidak valid" });
    } else if (provider === "openai") {
      // Test dengan 1 request kecil ke OpenAI
      const { reply } = await openaiProvider.chat({
        apiKey,
        model: model || "gpt-4o-mini",
        systemPrompt: "",
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 5,
      });
      if (reply !== undefined) return res.json({ ok: true });
      res.status(400).json({ error: "API key tidak valid" });
    } else if (provider === "gemini") {
      // Test dengan 1 request kecil ke Google Gemini
      const { reply } = await geminiProvider.chat({
        apiKey,
        model: model || "gemini-2.5-flash",
        systemPrompt: "",
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 5,
      });
      if (reply !== undefined) return res.json({ ok: true });
      res.status(400).json({ error: "API key tidak valid" });
    } else {
      res.status(400).json({ error: `Provider "${provider}" belum didukung` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
