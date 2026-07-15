// ─── WAVE 4B.0 — REPLY ASSISTANT CONFIG & GUARDS ────────────────────────────
// Dibaca DINAMIS dari process.env (bukan const import-time) supaya bisa di-toggle
// & di-test tanpa restart. Semua pengaman biaya/akses terpusat di sini.
import { AI_MODELS } from "../../config/aiModels.js";

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

// Objek config yang diinjeksi ke orchestrator (memudahkan test).
export function loadConfig() {
  return {
    isEnabled,
    maxMonthlyCostUsd,
    dailyLimit: dailyLimitFor,
    model: REPLY_MODEL,
  };
}
