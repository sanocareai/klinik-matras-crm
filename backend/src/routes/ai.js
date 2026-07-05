import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { requireAuth } from "../middleware/auth.js";
import { buildCoPilotPrompt } from "../services/coPilotPrompt.js";
import { appendToKbCategory, parseEntries, updateEntry, deleteEntry } from "../services/kbQuickAdd.js";
import { detectHandoverSignal, generateHandoverSummary } from "../services/handoverDetector.js";
import { AI_MODELS } from "../config/aiModels.js";
import { chatWithModel, logChatUsage, anthropicProvider } from "../services/providers/index.js";
import * as openaiProvider from "../services/providers/openaiProvider.js";

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

  try {
    const { reply, usage } = await chatWithModel({
      provider:     m.provider,
      apiKey,
      model:        m.model || AI_MODELS.SANO_CHATBOT,
      systemPrompt,
      messages,
    });
    logChatUsage("/chat", m.provider, m.model, usage);
    res.json({ content: reply });
  } catch (err) {
    res.status(500).json({ error: "Gagal menghubungi AI provider: " + err.message });
  }
});

// Definisi tool save_knowledge untuk Claude — hanya dikirim kalau user adalah ADMIN
const SAVE_KNOWLEDGE_TOOL = {
  name: "save_knowledge",
  description: "Simpan informasi baru ke Knowledge Base Klinik Matras. HANYA dipanggil kalau admin eksplisit minta tambah/simpan/catat info baru. Kategori yang tersedia: konsep-istilah-teknis (istilah teknis spesifik Sano), dunia-kasur-umum (industri kasur luas/merk lain/tren), faq-tambahan (FAQ customer), insight-lapangan (pola/insight umum dari sales — BUKAN data satu customer spesifik; kalau satu customer → sarankan catat di profil customer CRM).",
  input_schema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["konsep-istilah-teknis", "dunia-kasur-umum", "faq-tambahan", "insight-lapangan"],
        description: "Kategori Knowledge Base yang paling sesuai",
      },
      title: {
        type: "string",
        description: "Judul singkat dan jelas untuk entri ini",
      },
      content: {
        type: "string",
        description: "Isi informasi lengkap, terstruktur, dirangkum dari yang disampaikan admin",
      },
    },
    required: ["category", "title", "content"],
  },
};

const FIND_KNOWLEDGE_TOOL = {
  name: "find_knowledge_entry",
  description: "Cari entri Knowledge Base berdasarkan topik/judul. Panggil SEBELUM edit atau hapus. Gunakan category 'all' kalau tidak yakin di kategori mana.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Kata kunci untuk mencari judul/isi entri" },
      category: {
        type: "string",
        enum: ["konsep-istilah-teknis", "dunia-kasur-umum", "faq-tambahan", "insight-lapangan", "all"],
        description: "Kategori untuk dicari. Gunakan 'all' kalau tidak yakin.",
      },
    },
    required: ["query"],
  },
};

const EDIT_KNOWLEDGE_TOOL = {
  name: "edit_knowledge_entry",
  description: "Update entri Knowledge Base yang SUDAH ditemukan lewat find_knowledge_entry. HANYA panggil setelah admin konfirmasi entri yang benar dan isi baru.",
  input_schema: {
    type: "object",
    properties: {
      category: { type: "string", enum: ["konsep-istilah-teknis", "dunia-kasur-umum", "faq-tambahan", "insight-lapangan"] },
      entryIndex: { type: "number", description: "Index entri dari hasil find_knowledge_entry" },
      newTitle: { type: "string", description: "Judul baru (opsional, kosongi kalau tidak berubah)" },
      newContent: { type: "string", description: "Isi baru yang lengkap" },
    },
    required: ["category", "entryIndex", "newContent"],
  },
};

const DELETE_KNOWLEDGE_TOOL = {
  name: "delete_knowledge_entry",
  description: "Hapus entri Knowledge Base. WAJIB hanya setelah admin eksplisit konfirmasi 'ya, hapus' setelah melihat entri yang ditemukan. JANGAN panggil tanpa konfirmasi eksplisit.",
  input_schema: {
    type: "object",
    properties: {
      category: { type: "string", enum: ["konsep-istilah-teknis", "dunia-kasur-umum", "faq-tambahan", "insight-lapangan"] },
      entryIndex: { type: "number", description: "Index entri dari hasil find_knowledge_entry" },
    },
    required: ["category", "entryIndex"],
  },
};

// POST /api/ai/copilot-chat — AI Co-pilot internal untuk sales
// Body: { message, conversationHistory: [{role, content}] }
// Reuse model Anthropic pertama yang aktif & punya API key (konfigurasi dari AI Playground)
aiRouter.post("/copilot-chat", async (req, res) => {
  const { message, conversationHistory = [] } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: "Pesan tidak boleh kosong" });

  const models = readModels();
  const m = models.find((x) => x.active && x.provider === "anthropic" && x.encryptedKey);
  if (!m) {
    return res.status(400).json({
      error: "Belum ada model AI yang dikonfigurasi. Silakan tambah model di menu Otomasi → AI Playground → Kelola Model, lalu masukkan API key Anthropic.",
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

  // Tambahkan seluruh KB ke Co-pilot juga (sama seperti AI Playground)
  const kbContext = await buildKbContext();
  if (kbContext) systemPrompt = `${kbContext}\n\n---\n\n${systemPrompt}`;

  const messages = [
    ...conversationHistory.map(({ role, content }) => ({ role, content })),
    { role: "user", content: message },
  ];

  const copilotTools = req.user?.role === "ADMIN"
    ? [SAVE_KNOWLEDGE_TOOL, FIND_KNOWLEDGE_TOOL, EDIT_KNOWLEDGE_TOOL, DELETE_KNOWLEDGE_TOOL]
    : [];

  try {
    // Co-pilot selalu Anthropic (butuh tool use untuk KB management)
    const result = await anthropicProvider.chatWithTools({
      apiKey,
      model:        AI_MODELS.SANO_COPILOT,
      systemPrompt,
      messages,
      tools:        copilotTools,
    });
    logChatUsage("/copilot-chat", "anthropic", AI_MODELS.SANO_COPILOT, result.usage);

    // Handle tool use (save/find/edit/delete KB entries)
    if (result.toolBlock) {
      const toolBlock = result.toolBlock;
      let toolResultContent;
      let toolMeta = null;
      try {
        if (toolBlock.name === "save_knowledge") {
          const savedEntry = appendToKbCategory({ ...toolBlock.input, authorName: req.user.name });
          toolResultContent = JSON.stringify({ ok: true, category: savedEntry.category, title: savedEntry.title });
          toolMeta = { action: "saved", category: savedEntry.category, label: savedEntry.label, title: savedEntry.title };
        } else if (toolBlock.name === "find_knowledge_entry") {
          const cats = !toolBlock.input.category || toolBlock.input.category === "all"
            ? ["konsep-istilah-teknis", "dunia-kasur-umum", "faq-tambahan", "insight-lapangan"]
            : [toolBlock.input.category];
          const results = [];
          for (const cat of cats) {
            const q = toolBlock.input.query.toLowerCase();
            for (const e of parseEntries(cat)) {
              const score = (e.title.toLowerCase().includes(q) ? 2 : 0) +
                            (e.content.toLowerCase().includes(q) ? 1 : 0);
              if (score > 0) results.push({ ...e, category: cat, score });
            }
          }
          results.sort((a, b) => b.score - a.score);
          toolResultContent = JSON.stringify({ ok: true, results: results.slice(0, 5) });
        } else if (toolBlock.name === "edit_knowledge_entry") {
          const { category, entryIndex, newTitle, newContent } = toolBlock.input;
          const existing = parseEntries(category).find((e) => e.index === entryIndex);
          updateEntry(category, entryIndex, { title: newTitle || existing?.title || "Entri", content: newContent });
          toolResultContent = JSON.stringify({ ok: true, action: "updated", category, entryIndex });
          toolMeta = { action: "updated", category };
        } else if (toolBlock.name === "delete_knowledge_entry") {
          const { category, entryIndex } = toolBlock.input;
          deleteEntry(category, entryIndex);
          toolResultContent = JSON.stringify({ ok: true, action: "deleted", category, entryIndex });
          toolMeta = { action: "deleted", category };
        } else {
          toolResultContent = JSON.stringify({ ok: false, error: "Tool tidak dikenal" });
        }
      } catch (err) {
        toolResultContent = JSON.stringify({ ok: false, error: err.message });
      }

      // Lanjutkan percakapan dengan mengirim tool_result balik ke Claude
      const messages2 = [
        ...messages,
        { role: "assistant", content: result.rawContent },
        { role: "user", content: [{ type: "tool_result", tool_use_id: toolBlock.id, content: toolResultContent }] },
      ];
      const result2 = await anthropicProvider.chatWithTools({
        apiKey,
        model:  AI_MODELS.SANO_COPILOT,
        systemPrompt,
        messages: messages2,
        tools:  copilotTools,
      });
      logChatUsage("/copilot-chat[tool-result]", "anthropic", AI_MODELS.SANO_COPILOT, result2.usage);
      return res.json({ reply: result2.reply, toolMeta });
    }

    res.json({ reply: result.reply });
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
    ...conversationHistory.slice(-10),
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
    } else {
      res.status(400).json({ error: `Provider "${provider}" belum didukung` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
