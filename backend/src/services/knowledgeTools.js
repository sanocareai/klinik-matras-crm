import { appendToKbCategory, parseEntries, updateEntry, deleteEntry } from "./kbQuickAdd.js";

const VALID_CATEGORIES = ["konsep-istilah-teknis", "dunia-kasur-umum", "faq-tambahan", "insight-lapangan"];

// Definisi tool dalam format netral — "parameters" bukan "input_schema"
export const KNOWLEDGE_TOOLS = [
  {
    name: "save_knowledge",
    description:
      "Simpan informasi baru ke Knowledge Base Klinik Matras. HANYA dipanggil kalau admin eksplisit minta tambah/simpan/catat info baru. " +
      "Kategori yang tersedia: konsep-istilah-teknis (istilah teknis spesifik Sano), dunia-kasur-umum (industri kasur luas/merk lain/tren), " +
      "faq-tambahan (FAQ customer), insight-lapangan (pola/insight umum dari sales — BUKAN data satu customer spesifik; kalau satu customer → sarankan catat di profil customer CRM).",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: VALID_CATEGORIES,
          description: "Kategori Knowledge Base yang paling sesuai",
        },
        title:   { type: "string", description: "Judul singkat dan jelas untuk entri ini" },
        content: { type: "string", description: "Isi informasi lengkap, terstruktur, dirangkum dari yang disampaikan admin" },
      },
      required: ["category", "title", "content"],
    },
  },
  {
    name: "find_knowledge_entry",
    description:
      "Cari entri Knowledge Base berdasarkan topik/judul. Panggil SEBELUM edit atau hapus. Gunakan category 'all' kalau tidak yakin di kategori mana.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Kata kunci untuk mencari judul/isi entri" },
        category: {
          type: "string",
          enum: [...VALID_CATEGORIES, "all"],
          description: "Kategori untuk dicari. Gunakan 'all' kalau tidak yakin.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "edit_knowledge_entry",
    description:
      "Update entri Knowledge Base yang SUDAH ditemukan lewat find_knowledge_entry. HANYA panggil setelah admin konfirmasi entri yang benar dan isi baru.",
    parameters: {
      type: "object",
      properties: {
        category:   { type: "string", enum: VALID_CATEGORIES },
        entryIndex: { type: "number", description: "Index entri dari hasil find_knowledge_entry" },
        newTitle:   { type: "string", description: "Judul baru (opsional, kosongi kalau tidak berubah)" },
        newContent: { type: "string", description: "Isi baru yang lengkap" },
      },
      required: ["category", "entryIndex", "newContent"],
    },
  },
  {
    name: "delete_knowledge_entry",
    description:
      "Hapus entri Knowledge Base. WAJIB hanya setelah admin eksplisit konfirmasi 'ya, hapus' setelah melihat entri yang ditemukan. JANGAN panggil tanpa konfirmasi eksplisit.",
    parameters: {
      type: "object",
      properties: {
        category:   { type: "string", enum: VALID_CATEGORIES },
        entryIndex: { type: "number", description: "Index entri dari hasil find_knowledge_entry" },
      },
      required: ["category", "entryIndex"],
    },
  },
];

// Converter ke format Anthropic (input_schema)
export function toAnthropicTools(tools) {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
}

// Converter ke format OpenAI / Gemini-via-OpenAI
export function toOpenAITools(tools) {
  return tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

// Eksekusi tool — user harus { role, name } dari req.user (double-guard ADMIN)
export async function executeKnowledgeTool(toolName, input, user) {
  if (user?.role !== "ADMIN") {
    return { ok: false, error: "Fitur ini hanya untuk admin.", meta: null };
  }

  try {
    if (toolName === "save_knowledge") {
      const saved = appendToKbCategory({ ...input, authorName: user.name });
      return {
        ok: true,
        category: saved.category,
        title:    saved.title,
        meta: { action: "saved", category: saved.category, label: saved.label, title: saved.title },
      };
    }

    if (toolName === "find_knowledge_entry") {
      const cats = !input.category || input.category === "all" ? VALID_CATEGORIES : [input.category];
      const results = [];
      for (const cat of cats) {
        const q = input.query.toLowerCase();
        for (const e of parseEntries(cat)) {
          const score = (e.title.toLowerCase().includes(q) ? 2 : 0) +
                        (e.content.toLowerCase().includes(q) ? 1 : 0);
          if (score > 0) results.push({ ...e, category: cat, score });
        }
      }
      results.sort((a, b) => b.score - a.score);
      return { ok: true, results: results.slice(0, 5), meta: null };
    }

    if (toolName === "edit_knowledge_entry") {
      const { category, entryIndex, newTitle, newContent } = input;
      const existing = parseEntries(category).find((e) => e.index === entryIndex);
      updateEntry(category, entryIndex, { title: newTitle || existing?.title || "Entri", content: newContent });
      return { ok: true, action: "updated", category, meta: { action: "updated", category } };
    }

    if (toolName === "delete_knowledge_entry") {
      const { category, entryIndex } = input;
      deleteEntry(category, entryIndex);
      return { ok: true, action: "deleted", category, meta: { action: "deleted", category } };
    }

    return { ok: false, error: "Tool tidak dikenal", meta: null };
  } catch (err) {
    return { ok: false, error: err.message, meta: null };
  }
}
