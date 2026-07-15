// ─── WAVE 4B.0/4B.0.4 — REPLY ASSISTANT CONFIG & GUARDS ─────────────────────
// Dibaca DINAMIS dari process.env (bukan const import-time) supaya bisa di-toggle
// & di-test tanpa restart. Semua pengaman biaya/akses + pemilihan provider di sini.
import { AI_MODELS } from "../../config/aiModels.js";

// Kompat lama (single-model). Jangan dihapus — masih diekspor.
export const REPLY_MODEL = AI_MODELS.SANO_REPLY_ASSISTANT;

// Kuota generate LLM per hari, per-role. BLOCKED tidak dihitung sebagai pemakaian.
export const DAILY_LIMITS = { ADMIN: 100, SALES: 30 };
export function dailyLimitFor(role) {
  return DAILY_LIMITS[role] ?? DAILY_LIMITS.SALES;
}

// Master kill switch — REPLY_ASSISTANT_ENABLED=false mematikan fitur total.
export function isEnabled() {
  return String(process.env.REPLY_ASSISTANT_ENABLED ?? "true").toLowerCase() !== "false";
}

// Plafon biaya bulanan (USD). Kalau tercapai → fallback template (tidak panggil LLM).
export function maxMonthlyCostUsd() {
  const v = Number(process.env.MAX_AI_COST_USD_MONTH ?? 20);
  return Number.isFinite(v) && v > 0 ? v : 20;
}

// ─── WAVE 4B.0.4 — PEMILIHAN PROVIDER TERKONTROL (BUKAN routing otomatis) ────
// AI_REPLY_PROVIDER: claude (default) | openai | gemini. Produksi = claude.
export function replyProviderName() {
  return String(process.env.AI_REPLY_PROVIDER || "claude").toLowerCase();
}

// Provider KHUSUS kalibrasi — TERISOLASI dari produksi (dipakai harness saja).
// null = tidak dipakai. Tidak pernah memengaruhi jalur produksi.
export function calibrationProviderName() {
  const v = process.env.AI_REPLY_CALIBRATION_PROVIDER;
  return v ? String(v).toLowerCase() : null;
}

// Config per provider (SUMBER KEBENARAN model). Alias claude→anthropic.
const PROVIDER_CONFIG = {
  claude: AI_MODELS.SANO_REPLY_ASSISTANT_CLAUDE,
  anthropic: AI_MODELS.SANO_REPLY_ASSISTANT_CLAUDE,
  openai: AI_MODELS.SANO_REPLY_ASSISTANT_OPENAI,
};

// Resolusi nama → { provider (canonical), model }.
// Config = sumber kebenaran; ENV override HANYA untuk model (Keputusan #2):
//   OpenAI  → OPENAI_REPLY_MODEL, Gemini → GEMINI_REPLY_MODEL.
export function resolveProviderModel(name = replyProviderName()) {
  const n = String(name).toLowerCase();
  if (n === "gemini") {
    return { provider: "gemini", model: process.env.GEMINI_REPLY_MODEL || "gemini-2.5-flash" };
  }
  const cfg = PROVIDER_CONFIG[n] || PROVIDER_CONFIG.claude;
  let model = cfg.model;
  if (cfg.provider === "openai" && process.env.OPENAI_REPLY_MODEL) {
    model = process.env.OPENAI_REPLY_MODEL;
  }
  return { provider: cfg.provider, model };
}

// Objek config yang diinjeksi ke orchestrator. model = model provider AKTIF
// (default claude/haiku bila AI_REPLY_PROVIDER tak diset) → perilaku produksi identik.
export function loadConfig() {
  const { model } = resolveProviderModel();
  return {
    isEnabled,
    maxMonthlyCostUsd,
    dailyLimit: dailyLimitFor,
    model,
  };
}
