// ─── AI STUDIO — SATU GILIRAN BALASAN AGENT ─────────────────────────────────
// Rakit prompt dari skill versi aktif + katalog live, panggil model, urai JSON,
// hitung biaya, jalankan cek keras. Pemanggil model DI-INJEKSI (`callModel`)
// supaya fungsi ini bisa dites tanpa jaringan.
import { buildSystemPrompt, TAHAP } from "./skillLoader.js";
import { runChecks, countPriceAsks } from "./checks.js";

// Harga per 1 juta token (USD). cacheRead ≈ 10% input; cacheWrite ≈ 1,25× input.
// ⚠️ Cek ulang di halaman harga Anthropic bila model/harga berubah.
export const PRICING = {
  "claude-haiku-5-5":  { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2.00, output: 10.0, cacheRead: 0.10, cacheWrite: 2.50 },
  "claude-opus-5-5":   { input: 4.00, output: 20.0, cacheRead: 0.20, cacheWrite: 5.00 },
};
export const MODELS = Object.keys(PRICING);

export function estimateCost(model, usage = {}) {
  const p = PRICING[model];
  if (!p) return 0;
  const m = 1_000_000;
  return (
    ((usage.inputTokens || 0) * p.input) / m +
    ((usage.outputTokens || 0) * p.output) / m +
    ((usage.cacheReadTokens || 0) * p.cacheRead) / m +
    ((usage.cacheCreateTokens || 0) * p.cacheWrite) / m
  );
}

// Ambil objek JSON dari jawaban model (toleran terhadap ```json … ``` atau
// teks pembuka). Gagal → null.
export function parseAgentJson(text = "") {
  const s = String(text);
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Paksa bentuk output supaya UI & cek tidak pernah crash karena model
// melewatkan field.
export function normalizeOutput(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const bubbles = (Array.isArray(o.bubbles) ? o.bubbles : [o.bubbles]).filter((b) => typeof b === "string" && b.trim()).slice(0, 4);
  return {
    bubbles,
    kirimKatalog: (Array.isArray(o.kirimKatalog) ? o.kirimKatalog : []).filter((k) => typeof k === "string").slice(0, 3),
    tahap: TAHAP.includes(o.tahap) ? o.tahap : "DIAGNOSA",
    dataTerkumpul: o.dataTerkumpul && typeof o.dataTerkumpul === "object" ? o.dataTerkumpul : {},
    rekomendasi: o.rekomendasi && typeof o.rekomendasi === "object" ? o.rekomendasi : { utama: null, alternatif: null },
    handover: { perlu: !!o.handover?.perlu, alasan: o.handover?.alasan || null, prioritas: o.handover?.prioritas || null },
    catatanInternal: typeof o.catatanInternal === "string" ? o.catatanInternal : "",
  };
}

// Riwayat sesi (StudioMessage[]) → messages Anthropic. Balasan agent dikirim
// balik sebagai JSON ringkas supaya model tahu tahap & data sebelumnya.
export function toModelMessages(history = []) {
  const msgs = [];
  for (const m of history) {
    if (m.role === "CUSTOMER") msgs.push({ role: "user", content: String(m.content?.text || "") });
    else if (m.role === "AGENT") {
      const c = m.content || {};
      msgs.push({ role: "assistant", content: JSON.stringify({ bubbles: c.bubbles || [], kirimKatalog: c.kirimKatalog || [], tahap: c.tahap, dataTerkumpul: c.dataTerkumpul || {} }) });
    }
  }
  return msgs;
}

/**
 * @param skillFiles   { path: isi } dari StudioSkillVersion.files
 * @param products     baris Product aktif
 * @param history      StudioMessage[] sebelum pesan ini (urut lama → baru)
 * @param customerText pesan customer terbaru
 * @param model        id model
 * @param callModel    async ({ model, systemPrompt, messages, maxTokens }) → { reply, usage }
 */
export async function runTurn({ skillFiles, products = [], history = [], customerText, model = "claude-haiku-5-5", callModel, mode = "playground" }) {
  if (!customerText?.trim()) throw new Error("Pesan customer kosong");
  if (typeof callModel !== "function") throw new Error("callModel wajib diisi");

  const systemPrompt = buildSystemPrompt(skillFiles, products, { mode });
  const messages = [...toModelMessages(history), { role: "user", content: customerText.trim() }];
  const { reply, usage = {} } = await callModel({ model, systemPrompt, messages, maxTokens: 4000 });

  const customerTexts = [...history.filter((m) => m.role === "CUSTOMER").map((m) => m.content?.text), customerText];
  return prosesBalasan({ reply, usage, model, products, customerText, customerTexts, mode });
}

/**
 * Draft copilot untuk satu percakapan Inbox. `konteks` = hasil rakitKonteksCopilot()
 * (kartu customer + contoh gaya + riwayat sudah jadi satu pesan user).
 */
export async function runCopilotDraft({ skillFiles, products = [], konteks, model = "claude-haiku-5-5", callModel }) {
  if (!konteks?.riwayat?.length) throw new Error("Percakapan belum punya pesan");
  if (typeof callModel !== "function") throw new Error("callModel wajib diisi");

  const systemPrompt = buildSystemPrompt(skillFiles, products, { mode: "copilot" });
  const { reply, usage = {} } = await callModel({ model, systemPrompt, messages: [{ role: "user", content: konteks.pesan }], maxTokens: 4000 });
  return prosesBalasan({ reply, usage, model, products, customerText: konteks.customerTerakhir, customerTexts: konteks.customerTexts, mode: "copilot" });
}

// Urai JSON → normalisasi → cek keras → biaya. Dipakai runTurn & runCopilotDraft.
function prosesBalasan({ reply, usage, model, products, customerText, customerTexts, mode }) {
  const parsed = parseAgentJson(reply);
  const output = normalizeOutput(parsed);
  // Bubble kosong sah bila agent menyerahkan ke sales, atau di mode copilot (mis. belum perlu follow-up).
  const parseOk = !!parsed && (output.bubbles.length > 0 || output.handover.perlu || mode === "copilot");
  if (!parseOk) {
    // Model tidak mengembalikan JSON → tampilkan apa adanya supaya sales bisa mengoreksi.
    output.bubbles = [String(reply || "").trim() || "(balasan kosong)"];
    output.catatanInternal = "⚠ Model tidak mengikuti format JSON.";
  }

  const checks = runChecks(output, { products, customerText, priceAsks: countPriceAsks(customerTexts), mode });
  if (!parseOk) checks.unshift({ kode: "FORMAT_JSON", lulus: false, pesan: "Model tidak mengikuti format JSON" });

  return { output: { ...output, checks }, usage, costUsd: estimateCost(model, usage), model };
}
